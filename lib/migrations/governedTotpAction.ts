// lib/migrations/governedTotpAction.ts
//
// Governed-mutation idempotency + TOTP-step reservation ledger.
//
// PURPOSE (bootstrap TOTP-replay correction): a single valid, fresh TOTP code
// must authorize exactly ONE governed mutation attempt, while accidental
// DUPLICATE requests (double-click / retry / a browser that fires the same
// submission twice) must COLLAPSE onto that single attempt instead of being
// mistaken for a malicious replay.
//
// The prior design consumed the TOTP time-step inside verifyFreshTotp BEFORE
// authorization and BEFORE the mutation ran, keyed only on (user_id, time_step)
// with no idempotency and no release-on-failure. Consequences observed in the
// field:
//   * A duplicate concurrent bootstrap POST lost the (user,time_step) race and
//     came back "TOTP already used" — the operator saw a replay error for a
//     brand-new code, and the FIRST request's real error was hidden behind the
//     duplicate's replay response.
//   * Any failure AFTER the code was recorded (an authorization rejection, or a
//     failed bootstrap) still burned that time-step.
//
// This module is the corrected authority. It is NOT frozen MFA logic: it holds
// no secret and performs no TOTP crypto (validity is checked by
// verifyTotpStepValidity in runner.ts, which uses the frozen lib/mfa.ts). It
// only records reservations, keyed by the exact tuple the replay ledger must be
// tied to: (user, governed action, accepted TOTP time-step) plus a
// non-reversible code fingerprint and the client idempotency key.
//
// Reservation lifecycle for one (user_id, action_key, time_step):
//   begin  -> IN_FLIGHT     (the first legitimate submission proceeds)
//   success-> COMPLETED     (the step is PERMANENTLY consumed)
//   failure-> FAILED        (stores the failure response; a *new* submission
//                            transparently releases + retakes it, so a failed
//                            attempt never burns the operator's next code)
//
// begin() outcomes on a pre-existing reservation:
//   same idempotency key         -> IDEMPOTENT (return the stored response;
//                                    this is how a duplicate surfaces the FIRST
//                                    request's real result instead of a replay)
//   different key + COMPLETED     -> REPLAY (a genuinely different submission
//                                    re-presenting an already-consumed code)
//   different key + FAILED        -> release + retake -> PROCEED (a failed
//                                    attempt does not block a later attempt)
//   different key + IN_FLIGHT     -> REPLAY (a concurrent, non-idempotent
//                                    attempt on the same step — fail safe)

import { neon } from '@neondatabase/serverless';
import { createHash, randomBytes } from 'node:crypto';

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — cannot record governed action.');
  return neon(url);
}

/**
 * Self-creating reservation table. Governed-action reservations are bootstrap
 * INFRASTRUCTURE (like the ledger DDL), not a numbered migration, so this must
 * exist BEFORE the very first bootstrap can run in a fresh environment. It is
 * created on demand, idempotently, independent of the schema_migrations ledger.
 */
const GOVERNED_ACTIONS_DDL = `
CREATE TABLE IF NOT EXISTS migration_governed_actions (
  id               BIGSERIAL PRIMARY KEY,
  idempotency_key  TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  action_key       TEXT NOT NULL,
  time_step        BIGINT NOT NULL,
  code_fingerprint TEXT NOT NULL
    CHECK (code_fingerprint ~ '^[0-9a-f]{64}$'),
  status           TEXT NOT NULL DEFAULT 'IN_FLIGHT'
    CHECK (status IN ('IN_FLIGHT', 'COMPLETED', 'FAILED')),
  response_json    JSONB,
  correlation_id   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  CONSTRAINT migration_governed_actions_reservation_unique
    UNIQUE (user_id, action_key, time_step)
);
CREATE INDEX IF NOT EXISTS migration_governed_actions_idem_idx
  ON migration_governed_actions (idempotency_key);
`;

let ddlEnsured = false;

// Postgres error codes for objects that already exist. `CREATE TABLE/INDEX IF
// NOT EXISTS` is NOT atomic against a concurrent creator: two sessions can both
// pass the existence check and then one fails inserting into the catalog. When
// two duplicate bootstrap requests race to self-create this reservation table,
// swallowing these means "a concurrent creator won" — the table exists either
// way, which is exactly the desired end state.
const ALREADY_EXISTS_CODES = new Set(['42P07', '42P06', '42710', '23505']);

async function ensureTable(): Promise<void> {
  const sql = getRawSql();
  // Run every call in tests (schema is dropped/recreated between them); cache
  // the happy path in production where the schema is stable.
  if (ddlEnsured && process.env.NODE_ENV === 'production') return;
  for (const stmt of GOVERNED_ACTIONS_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    try {
      await sql(stmt, []);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (!code || !ALREADY_EXISTS_CODES.has(code)) throw e;
      // Concurrent creator won — the object exists; continue.
    }
  }
  ddlEnsured = true;
}

/** A sanitized, per-request correlation id for log/audit correlation. */
export function generateCorrelationId(): string {
  return `req_${randomBytes(8).toString('hex')}`;
}

/**
 * A non-reversible fingerprint of the accepted code's identity. It binds a
 * reservation to the exact (user, action, time-step) without ever storing the
 * TOTP code or anything derived from the MFA secret.
 */
export function codeFingerprint(userId: string, actionKey: string, timeStep: number): string {
  return createHash('sha256').update(`${userId}:${actionKey}:${timeStep}`).digest('hex');
}

/** A stored governed-action response (status + parsed JSON body). */
export interface StoredGovernedResponse {
  httpStatus: number;
  body: unknown;
}

export type GovernedBeginResult =
  | { outcome: 'PROCEED'; correlationId: string; timeStep: number }
  | { outcome: 'REPLAY'; correlationId: string; timeStep: number }
  | { outcome: 'IDEMPOTENT'; correlationId: string; timeStep: number; stored: StoredGovernedResponse };

interface ExistingRow {
  status: 'IN_FLIGHT' | 'COMPLETED' | 'FAILED';
  idempotency_key: string;
  response_json: unknown;
}

async function readReservation(
  userId: string,
  actionKey: string,
  timeStep: number,
): Promise<ExistingRow | null> {
  const sql = getRawSql();
  const rows = (await sql`
    SELECT status, idempotency_key, response_json
    FROM migration_governed_actions
    WHERE user_id = ${userId} AND action_key = ${actionKey} AND time_step = ${timeStep}
    LIMIT 1
  `) as ExistingRow[];
  return rows[0] ?? null;
}

async function tryInsertReservation(p: {
  userId: string; actionKey: string; timeStep: number;
  idempotencyKey: string; correlationId: string; fingerprint: string;
}): Promise<boolean> {
  const sql = getRawSql();
  const rows = (await sql`
    INSERT INTO migration_governed_actions
      (idempotency_key, user_id, action_key, time_step, code_fingerprint, status, correlation_id)
    VALUES
      (${p.idempotencyKey}, ${p.userId}, ${p.actionKey}, ${p.timeStep}, ${p.fingerprint}, 'IN_FLIGHT', ${p.correlationId})
    ON CONFLICT (user_id, action_key, time_step) DO NOTHING
    RETURNING id
  `) as Array<{ id: number }>;
  return rows.length > 0;
}

function toStored(row: ExistingRow): StoredGovernedResponse {
  const rj = row.response_json as { httpStatus?: number; body?: unknown } | null;
  if (rj && typeof rj === 'object' && typeof rj.httpStatus === 'number') {
    return { httpStatus: rj.httpStatus, body: rj.body };
  }
  // A row that has not stored a response yet (still IN_FLIGHT past our wait).
  return {
    httpStatus: 202,
    body: { success: false, inProgress: true, error: 'A duplicate request is still being processed. Retry shortly.' },
  };
}

const IN_FLIGHT_WAIT_MS = 100;
const IN_FLIGHT_MAX_WAITS = 30; // ~3s ceiling for a same-key duplicate to converge

/**
 * Reserve one governed-mutation attempt for (user, actionKey, timeStep).
 *
 * @returns PROCEED (caller runs the mutation, then MUST call
 *          completeGovernedAction on success or failGovernedAction on failure),
 *          IDEMPOTENT (caller returns the stored response verbatim), or REPLAY
 *          (caller denies).
 */
export async function beginGovernedAction(p: {
  userId: string;
  actionKey: string;
  timeStep: number;
  idempotencyKey: string;
  correlationId: string;
}): Promise<GovernedBeginResult> {
  await ensureTable();
  const fingerprint = codeFingerprint(p.userId, p.actionKey, p.timeStep);

  const inserted = await tryInsertReservation({ ...p, fingerprint });
  if (inserted) {
    return { outcome: 'PROCEED', correlationId: p.correlationId, timeStep: p.timeStep };
  }

  // A reservation already exists for this (user, action, step). Decide by the
  // idempotency key and the reservation's current status.
  for (let attempt = 0; attempt <= IN_FLIGHT_MAX_WAITS; attempt++) {
    const row = await readReservation(p.userId, p.actionKey, p.timeStep);

    // The winner may have released a FAILED reservation between our INSERT and
    // this read; retake it.
    if (!row) {
      const retook = await tryInsertReservation({ ...p, fingerprint });
      if (retook) return { outcome: 'PROCEED', correlationId: p.correlationId, timeStep: p.timeStep };
      continue; // someone else retook it — loop to re-read.
    }

    const sameSubmission = row.idempotency_key === p.idempotencyKey;

    if (sameSubmission) {
      // Duplicate of THIS submission (the classic double-send). Collapse onto
      // the winner: return whatever it recorded. This is what makes the
      // duplicate surface the first request's REAL result rather than a replay.
      if (row.status === 'COMPLETED' || row.status === 'FAILED') {
        return { outcome: 'IDEMPOTENT', correlationId: p.correlationId, timeStep: p.timeStep, stored: toStored(row) };
      }
      // Still IN_FLIGHT — wait briefly for the winner to settle, then re-read.
      if (attempt < IN_FLIGHT_MAX_WAITS) {
        await new Promise((r) => setTimeout(r, IN_FLIGHT_WAIT_MS));
        continue;
      }
      return { outcome: 'IDEMPOTENT', correlationId: p.correlationId, timeStep: p.timeStep, stored: toStored(row) };
    }

    // A DIFFERENT submission is re-using this (user, action, step).
    if (row.status === 'COMPLETED') {
      // Genuine replay of an already-consumed code.
      return { outcome: 'REPLAY', correlationId: p.correlationId, timeStep: p.timeStep };
    }
    if (row.status === 'FAILED') {
      // The prior attempt failed and mutated nothing — release + retake so a
      // failed bootstrap never burns the operator's next legitimate attempt.
      await releaseFailedReservation(p.userId, p.actionKey, p.timeStep);
      const retook = await tryInsertReservation({ ...p, fingerprint });
      if (retook) return { outcome: 'PROCEED', correlationId: p.correlationId, timeStep: p.timeStep };
      continue;
    }
    // IN_FLIGHT under a different key — a concurrent, non-idempotent attempt on
    // the same step. Fail safe: deny as replay.
    return { outcome: 'REPLAY', correlationId: p.correlationId, timeStep: p.timeStep };
  }

  // Exhausted waits without resolution — deny rather than risk a double run.
  return { outcome: 'REPLAY', correlationId: p.correlationId, timeStep: p.timeStep };
}

/** Mark a reservation COMPLETED and store its response. The step is now
 *  permanently consumed. */
export async function completeGovernedAction(
  userId: string,
  actionKey: string,
  timeStep: number,
  response: StoredGovernedResponse,
): Promise<void> {
  const sql = getRawSql();
  await sql`
    UPDATE migration_governed_actions
    SET status = 'COMPLETED', response_json = ${JSON.stringify(response)}::jsonb, completed_at = now()
    WHERE user_id = ${userId} AND action_key = ${actionKey} AND time_step = ${timeStep}
  `;
}

/** Mark a reservation FAILED and store its (failure) response. Same-submission
 *  duplicates read this back idempotently; a NEW submission releases + retakes
 *  it (see beginGovernedAction). */
export async function failGovernedAction(
  userId: string,
  actionKey: string,
  timeStep: number,
  response: StoredGovernedResponse,
): Promise<void> {
  const sql = getRawSql();
  await sql`
    UPDATE migration_governed_actions
    SET status = 'FAILED', response_json = ${JSON.stringify(response)}::jsonb, completed_at = now()
    WHERE user_id = ${userId} AND action_key = ${actionKey} AND time_step = ${timeStep}
  `;
}

async function releaseFailedReservation(
  userId: string,
  actionKey: string,
  timeStep: number,
): Promise<void> {
  const sql = getRawSql();
  await sql`
    DELETE FROM migration_governed_actions
    WHERE user_id = ${userId} AND action_key = ${actionKey} AND time_step = ${timeStep}
      AND status = 'FAILED'
  `;
}
