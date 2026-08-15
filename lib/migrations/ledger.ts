// lib/migrations/ledger.ts
//
// Phase 1A — Migration Governance Foundation (MIGRATION-GOV-01)
// Phase 1A.1 — Operational Hardening (MIGRATION-GOV-02..08)
//
// The migration governance database ledger: creation (bootstrap), reading
// (inspection), recording results, governance lifecycle state, and append-only
// attempt history.
//
// Bootstrap problem: The ledger must exist before it can record ordinary
// migrations. bootstrapMigrationLedger() creates the tables via a fixed,
// idempotent DDL that runs outside the normal migration flow. This bootstrap is
// itself guarded by the advisory lock and authorization.
//
// Append-only history (MIGRATION-GOV-03): The `schema_migration_runs` table is
// INSERT-only. Each migration attempt produces a new row (or rows) — never
// an UPDATE or DELETE. The `schema_migrations` table is the current-state
// table (one row per migration+environment) and IS updated to reflect the
// latest state, but the full attempt history is preserved in
// `schema_migration_runs`.
//
// Advisory locking: We use pg_try_advisory_xact_lock (transaction-scoped,
// bounded timeout) rather than pg_advisory_xact_lock (which blocks
// indefinitely). The lock key is passed as a decimal string and cast to BIGINT
// in PostgreSQL to avoid JavaScript Number precision loss (MIGRATION-GOV-06).

import { neon } from '@neondatabase/serverless';
import {
  MigrationLedgerRow,
  MigrationRunRow,
  MigrationRunStatus,
  MigrationStatus,
  MigrationAuditEvent,
  MigrationAuditEventType,
  MigrationActorType,
  MigrationGovernanceLifecycle,
  BaselineReconciliationStatus,
  BaselineEvidenceType,
  MigrationBaselineRow,
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_KEY_DECIMAL,
} from './types';
import { getNodeEnv } from '@/lib/env';
import { writeAuditLog, writeAuditLogDetailed, AuditCategory, AuditAction, type AuditWriteResult } from '@/lib/auditLog';

/**
 * The fixed bootstrap DDL that creates the migration governance tables.
 *
 * This is idempotent (IF NOT EXISTS) and is the ONLY DDL that runs outside the
 * normal migration transaction flow. It is executed by bootstrapMigrationLedger()
 * before any pending-migration logic.
 *
 * Three tables are created:
 *
 * 1. `governance_lifecycle` — The governance state for each environment.
 *    One row per environment. Records the lifecycle state
 *    (UNBOOTSTRAPPED → ... → EXECUTION_ENABLED) and who advanced it.
 *
 * 2. `schema_migrations` — The current-state table. One row per
 *    (migration_identifier, environment) pair. Reflects the LATEST known state
 *    of each migration. Updated on each attempt to reflect the latest status.
 *    Has CHECK constraints on status, checksum format, identifier grammar, and
 *    actor type (MIGRATION-GOV-08).
 *
 * 3. `schema_migration_runs` — The append-only attempt history. One row per
 *    event (started/applied/failed/denied/skipped/dry_run/conflict/
 *    lock_timeout/baseline_blocked). INSERT-only — never
 *    UPDATE or DELETE. Preserves the full history of every attempt
 *    (MIGRATION-GOV-03). Status vocabulary expanded in Phase 1A.2
 *    (MIGRATION-GOV-14) to record exact outcomes for all denied/blocked
 *    paths (MIGRATION-GOV-18).
 */
export const BOOTSTRAP_LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS governance_lifecycle (
  id                        SERIAL PRIMARY KEY,
  environment               TEXT NOT NULL UNIQUE,
  lifecycle_state           TEXT NOT NULL DEFAULT 'LEDGER_BOOTSTRAPPED'
    CHECK (lifecycle_state IN (
      'UNBOOTSTRAPPED',
      'LEDGER_BOOTSTRAPPED',
      'BASELINE_REQUIRED',
      'BASELINE_IN_PROGRESS',
      'BASELINE_VERIFIED',
      'EXECUTION_ENABLED'
    )),
  baseline_reconciled_by    TEXT,
  baseline_reconciled_at    TIMESTAMPTZ,
  execution_enabled_by      TEXT,
  execution_enabled_at      TIMESTAMPTZ,
  -- Bounded activation window (Commit 4). NULL = no bounded window (legacy
  -- indefinite enable). When set and in the past, the execution gate treats
  -- EXECUTION_ENABLED as disabled (fail-safe, not UI-timer-dependent).
  execution_enabled_expires_at TIMESTAMPTZ,
  last_state_change_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id                      SERIAL PRIMARY KEY,
  migration_identifier    TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  description             TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'applied', 'failed', 'superseded')),
  started_at              TIMESTAMPTZ,
  applied_at              TIMESTAMPTZ,
  failed_at               TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  environment             TEXT NOT NULL,
  applied_by_actor_type   TEXT
    CHECK (applied_by_actor_type IS NULL OR applied_by_actor_type IN ('human', 'migration-actor')),
  applied_by_actor_id     TEXT,
  execution_id            TEXT,
  error_code              TEXT,
  error_summary           TEXT,
  rollback_reference      TEXT,
  last_run_id             INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schema_migrations_env_identifier_unique
    UNIQUE (migration_identifier, environment)
);

CREATE INDEX IF NOT EXISTS schema_migrations_status_idx
  ON schema_migrations (status);

CREATE TABLE IF NOT EXISTS schema_migration_runs (
  id                      SERIAL PRIMARY KEY,
  run_id                  TEXT NOT NULL,
  execution_id            TEXT NOT NULL,
  migration_identifier    TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  filename                TEXT NOT NULL,
  checksum_sha256         TEXT NOT NULL
    CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  environment             TEXT NOT NULL,
  status                  TEXT NOT NULL
    CHECK (status IN ('started', 'applied', 'failed', 'denied', 'skipped',
                     'dry_run', 'conflict', 'lock_timeout', 'baseline_blocked')),
  actor_type              TEXT
    CHECK (actor_type IS NULL OR actor_type IN ('human', 'migration-actor')),
  actor_id                TEXT,
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  execution_duration_ms   INTEGER,
  error_code              TEXT,
  error_summary           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schema_migration_runs_exec_id_idx
  ON schema_migration_runs (execution_id);
CREATE INDEX IF NOT EXISTS schema_migration_runs_identifier_env_idx
  ON schema_migration_runs (migration_identifier, environment);
CREATE INDEX IF NOT EXISTS schema_migration_runs_status_idx
  ON schema_migration_runs (status);

CREATE TABLE IF NOT EXISTS migration_baseline (
  id                        SERIAL PRIMARY KEY,
  migration_identifier      TEXT NOT NULL
    CHECK (migration_identifier ~ '^[0-9]{3}[a-z]?$'),
  environment               TEXT NOT NULL,
  reconciliation_status     TEXT NOT NULL
    CHECK (reconciliation_status IN (
      'CONFIRMED_APPLIED',
      'CONFIRMED_NOT_APPLIED',
      'PARTIALLY_APPLIED',
      'NOT_APPLICABLE',
      'UNKNOWN'
    )),
  evidence_type             TEXT NOT NULL DEFAULT 'NONE'
    CHECK (evidence_type IN (
      'SCHEMA_INTROSPECTION',
      'LEDGER_RECORD',
      'MANUAL_VERIFICATION',
      'CHECKSUM_MATCH',
      'OBJECT_EXISTENCE',
      'NONE'
    )),
  evidence_summary          TEXT,
  reconciled_by             TEXT,
  reconciled_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT migration_baseline_env_identifier_unique
    UNIQUE (migration_identifier, environment)
);

CREATE INDEX IF NOT EXISTS migration_baseline_status_idx
  ON migration_baseline (reconciliation_status);

-- TOTP replay prevention table (MIGRATION-GOV-05, Phase 1A.1 Issue 6).
-- Records which TOTP time-steps have been used for migration mutations.
-- A (user_id, time_step) pair can only be used once for a mutation. This
-- prevents replay of the same TOTP code for a second mutation within the
-- same 30-second window. The code itself is NOT stored — only a hash of
-- the (user_id, time_step) pair, to avoid storing any sensitive value.
CREATE TABLE IF NOT EXISTS migration_totp_uses (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  time_step       BIGINT NOT NULL,
  use_hash        TEXT NOT NULL
    CHECK (use_hash ~ '^[0-9a-f]{64}$'),
  used_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_id    TEXT,
  CONSTRAINT migration_totp_uses_user_step_unique
    UNIQUE (user_id, time_step)
);

CREATE INDEX IF NOT EXISTS migration_totp_uses_user_idx
  ON migration_totp_uses (user_id);
CREATE INDEX IF NOT EXISTS migration_totp_uses_used_at_idx
  ON migration_totp_uses (used_at);
`;

/**
 * Map a MigrationAuditEventType to the corresponding durable AuditAction in
 * lib/auditLog.ts. This allows migration governance events to be persisted to
 * the tamper-evident audit_log table with hash-chain integrity (MIGRATION-GOV-08).
 */
const MIGRATION_EVENT_TO_AUDIT_ACTION: Record<MigrationAuditEventType, AuditAction> = {
  'migration.inspect': 'data_read',
  'migration.bootstrap.started': 'migration_bootstrap_started',
  'migration.bootstrap.completed': 'migration_bootstrap_completed',
  'migration.bootstrap.failed': 'migration_bootstrap_failed',
  'migration.run.started': 'migration_run_started',
  'migration.run.completed': 'migration_run_completed',
  'migration.run.failed': 'migration_run_failed',
  'migration.migration.applied': 'migration_applied',
  'migration.migration.failed': 'migration_failed',
  'migration.migration.skipped': 'migration_skipped',
  'migration.migration.started': 'migration_started',
  'migration.conflict.detected': 'migration_conflict_detected',
  'migration.checksum_mismatch': 'migration_checksum_mismatch',
  'migration.lock_denied': 'migration_lock_denied',
  'migration.lock_acquired': 'migration_lock_acquired',
  'migration.legacy.invoked': 'migration_legacy_invoked',
  'migration.baseline.started': 'migration_baseline_started',
  'migration.baseline.completed': 'migration_baseline_completed',
  'migration.baseline.failed': 'migration_baseline_failed',
  'migration.governance.state_change': 'migration_governance_state_change',
  'migration.governance.execution_denied': 'migration_governance_execution_denied',
  'migration.mfa.denied': 'migration_mfa_denied',
  'migration.mfa.replay_detected': 'migration_mfa_replay_detected',
  'migration.transaction_mode.review_required': 'migration_transaction_mode_review_required',
  'migration.execution_blocked_non_transactional': 'migration_execution_blocked_non_transactional',
  'manifest.duplicate_prefix': 'data_read',
};

/**
 * Persist a migration audit event to the durable audit_log table via
 * writeAuditLog (hash-chain integrity). This is the durable persistence path
 * for migration governance events (MIGRATION-GOV-08).
 *
 * This function is fire-and-forget: it never throws. If the audit_log table is
 * unavailable or the write fails, writeAuditLog itself falls back to console
 * logging. The console emission in emitAuditEvent ensures observability even
 * when the durable store is unreachable.
 *
 * @returns The entry hash on success, null on failure.
 */
async function persistMigrationAuditEvent(event: MigrationAuditEvent): Promise<string | null> {
  return (await persistMigrationAuditEventDetailed(event)).entryHash;
}

/** The same persistence, with the outcome preserved. */
async function persistMigrationAuditEventDetailed(event: MigrationAuditEvent): Promise<AuditWriteResult> {
  const action = MIGRATION_EVENT_TO_AUDIT_ACTION[event.type] ?? 'data_read';
  const description = `Migration governance event: ${event.type}`;
  const targetType = event.migrationIdentifier ? 'migration' : 'migration_governance';
  const targetId = event.migrationIdentifier ?? event.executionId ?? null;
  const metadata: Record<string, unknown> = {
    eventType: event.type,
    executionId: event.executionId,
    migrationIdentifier: event.migrationIdentifier,
    filename: event.filename,
    actorType: event.actorType,
    environment: event.environment,
    ...event.details,
  };
  return writeAuditLogDetailed({
    category: 'migration',
    action,
    description,
    actor_id: event.actorId,
    actor_email: null,
    actor_role: null,
    target_type: targetType,
    target_id: targetId,
    metadata,
    ip_address: null,
    user_agent: null,
    request_path: null,
    actor_organization_id: null,
    resource_owner_organization_id: null,
  });
}

/**
 * Emit a structured audit event to the console (supplemental telemetry) AND
 * persist it to the durable audit_log table (MIGRATION-GOV-08).
 *
 * Phase 1A.1 logs audit events as structured JSON to console as supplemental
 * telemetry AND persists them to the tamper-evident audit_log table via
 * lib/auditLog.ts writeAuditLog (hash-chain integrity). The console emission
 * is synchronous and never throws. The durable persistence is fire-and-forget
 * (initiated but not awaited) so it does not block the calling code path;
 * writeAuditLog itself handles failures gracefully (falls back to console).
 *
 * This function is the single audit emission point for the migration governance
 * subsystem. All migration.* events flow through here.
 *
 * MIGRATION-GOV-10 (Phase 1A.2): For MUTATION paths (schema changes,
 * lifecycle transitions, execution activation), use emitAuditEventAsync()
 * instead. That function awaits the durable persistence and returns whether
 * it succeeded, allowing the caller to fail-closed if the audit record
 * cannot be written. This fire-and-forget variant is for read-only/inspection
 * events where losing the audit record is acceptable.
 */
export function emitAuditEvent(event: Omit<MigrationAuditEvent, 'timestamp'>): void {
  const fullEvent: MigrationAuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log line — parseable by log aggregators. Synchronous.
  console.log(JSON.stringify({ level: 'audit', ...fullEvent }));

  // Durable persistence to audit_log table (fire-and-forget, never throws).
  // The .catch() ensures no unhandled promise rejection propagates.
  persistMigrationAuditEvent(fullEvent).catch(() => {
    // writeAuditLog already falls back to console on failure; this catch is a
    // safety net for any unexpected error in the promise chain itself.
  });
}

/**
 * Emit a structured audit event AND await durable persistence (fail-closed).
 *
 * MIGRATION-GOV-10 (Phase 1A.2): For MUTATION paths (schema changes,
 * lifecycle transitions, execution activation/deactivation), the audit
 * record MUST be durably persisted. If the persistence fails, the caller
 * must be informed so it can fail-closed — the mutation should be treated
 * as failed (or blocked) rather than proceeding with a lost audit record.
 *
 * This function:
 * 1. Emits the structured JSON log line (synchronous, never throws).
 * 2. Awaits the durable persistence to the audit_log table.
 * 3. Returns { persisted: boolean, entryHash: string | null }.
 *
 * If persisted is false, the caller MUST treat the operation as failed
 * and record an AUDIT_PERSISTENCE_FAILED error.
 *
 * @param event The audit event (without timestamp — added automatically).
 * @returns { persisted: boolean, entryHash: string | null }
 */
export async function emitAuditEventAsync(
  event: Omit<MigrationAuditEvent, 'timestamp'>,
): Promise<{ persisted: boolean; entryHash: string | null; error: string | null; orgContextDegraded: boolean }> {
  const fullEvent: MigrationAuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  // Structured JSON log line — parseable by log aggregators. Synchronous.
  console.log(JSON.stringify({ level: 'audit', ...fullEvent }));

  try {
    // THE REASON IS CARRIED, not discarded. This boundary returned a bare
    // `{persisted:false}`, so every AUDIT_PERSISTENCE_FAILED the runner reported
    // — 113 in July, 119 in August — said an audit write had failed and could
    // not say why. The cause was one line of PostgreSQL: `column
    // "actor_organization_id" does not exist` (migration 107 unapplied). Two
    // weeks of a governance incident nobody could act on, because the string was
    // thrown away here.
    const r = await persistMigrationAuditEventDetailed(fullEvent);
    return {
      persisted: r.persisted,
      entryHash: r.entryHash,
      error: r.error,
      orgContextDegraded: r.orgContextDegraded,
    };
  } catch (err: unknown) {
    // writeAuditLogDetailed catches internally; this is the safety net.
    return {
      persisted: false, entryHash: null,
      error: err instanceof Error ? err.message : String(err),
      orgContextDegraded: false,
    };
  }
}

/**
 * Get the current environment name for ledger recording.
 *
 * Uses VERCEL_ENV if available, falls back to NODE_ENV.
 */
export function getCurrentEnvironment(): string {
  return (process.env.VERCEL_ENV || getNodeEnv() || 'development').toLowerCase();
}

/**
 * Get a raw Neon SQL executor (bypasses the getDbReady retry layer).
 *
 * The ledger operations use neon() directly because they need precise control
 * over transaction boundaries and advisory locks. The retry/cold-start logic in
 * getDbReady is not appropriate for the ledger's bootstrap and lock operations.
 */
function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — cannot connect to the database for migration ledger operations.');
  }
  return neon(url);
}

/**
 * Check whether the schema_migrations ledger table exists.
 */
export async function ledgerExists(): Promise<boolean> {
  const sql = getRawSql();
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'schema_migrations'
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

/**
 * Bootstrap the migration governance ledger tables.
 *
 * This creates the tables if they do not exist, using the fixed idempotent DDL.
 * It acquires an advisory lock first (to prevent concurrent bootstraps) and
 * emits audit events. After creating the tables, it initializes the
 * governance_lifecycle row for the current environment to BASELINE_REQUIRED.
 *
 * @param actorType The type of actor performing the bootstrap.
 * @param actorId The actor's identifier.
 * @returns An object indicating success/failure.
 */
export async function bootstrapMigrationLedger(
  actorType: MigrationActorType = 'migration-actor',
  actorId: string | null = null,
): Promise<{ success: boolean; alreadyExisted: boolean; error?: string }> {
  const environment = getCurrentEnvironment();
  const executionId = `bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  emitAuditEvent({
    type: 'migration.bootstrap.started',
    actorType,
    actorId,
    environment,
    executionId,
    migrationIdentifier: null,
    filename: null,
    details: {},
  });

  try {
    const sql = getRawSql();

    // Check if it already exists (fast path).
    const existsRows = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
      ) AS exists
    `;
    const alreadyExisted = Boolean(existsRows[0]?.exists);

    if (alreadyExisted) {
      // Commit 4: upgrade legacy environments in-place (idempotent ADD COLUMN
      // IF NOT EXISTS) so the bounded-activation column always exists after any
      // bootstrap, even when the tables predate it.
      await ensureGovernanceSchemaCurrent();
      emitAuditEvent({
        type: 'migration.bootstrap.completed',
        actorType,
        actorId,
        environment,
        executionId,
        migrationIdentifier: null,
        filename: null,
        details: { alreadyExisted: true },
      });
      return { success: true, alreadyExisted: true };
    }

    // Acquire advisory lock and create the tables in a single transaction.
    // pg_try_advisory_xact_lock is transaction-scoped — released on commit/rollback.
    // The lock key is passed as a decimal string and cast to BIGINT to preserve
    // full 64-bit precision (MIGRATION-GOV-06).
    //
    // NEON TRANSACTION CONSTRAINT: the callback must be SYNCHRONOUS and return an
    // array of query promises. No `await` inside the callback. We build the array
    // of queries (lock + all DDL statements + lifecycle init) and return it.
    const statements = BOOTSTRAP_LEDGER_DDL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    await sql.transaction((txn) => [
      // First query: acquire the transaction-scoped advisory lock (bounded).
      // Use pg_try_advisory_xact_lock with the exact 64-bit key as a BIGINT cast.
      txn`SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint)`,
      // Subsequent queries: the bootstrap DDL statements.
      ...statements.map((stmt) => txn(stmt, [])),
      // Initialize the governance lifecycle row for this environment.
      txn`INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES (${environment}, 'BASELINE_REQUIRED')
          ON CONFLICT (environment) DO NOTHING`,
    ]);

    emitAuditEvent({
      type: 'migration.bootstrap.completed',
      actorType,
      actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: { alreadyExisted: false, created: true, lifecycleState: 'BASELINE_REQUIRED' },
    });

    return { success: true, alreadyExisted: false };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emitAuditEvent({
      type: 'migration.bootstrap.failed',
      actorType,
      actorId,
      environment,
      executionId,
      migrationIdentifier: null,
      filename: null,
      details: { error: errorMsg },
    });
    return { success: false, alreadyExisted: false, error: errorMsg };
  }
}

/**
 * Idempotently bring the governance schema up to date (Commit 4). Adds the
 * bounded-activation column to environments bootstrapped before it existed.
 * Governance tables are bootstrap infrastructure, not numbered migrations, so
 * this is safe to run any time and requires no numbered migration. Never
 * throws — returns false on failure (caller decides).
 */
export async function ensureGovernanceSchemaCurrent(): Promise<boolean> {
  try {
    const sql = getRawSql();
    await sql`
      ALTER TABLE governance_lifecycle
        ADD COLUMN IF NOT EXISTS execution_enabled_expires_at TIMESTAMPTZ
    `;
    return true;
  } catch {
    return false;
  }
}

/** The runtime activation snapshot for the current environment (Commit 4). */
export interface ExecutionActivationStatus {
  /** EXECUTION_ENABLED and NOT past its bounded expiry. */
  active: boolean;
  lifecycleState: MigrationGovernanceLifecycle | 'UNBOOTSTRAPPED';
  enabledAt: string | null;
  enabledBy: string | null;
  /** Bounded-window expiry, or null (legacy indefinite / not activated). */
  expiresAt: string | null;
  /** A bounded window exists and is in the past. */
  expired: boolean;
  secondsRemaining: number;
}

/**
 * Read the execution activation status, column-safe against environments not
 * yet upgraded (probes information_schema for the expiry column). Fail-closed:
 * on any error returns an inactive snapshot.
 */
export async function readExecutionActivation(): Promise<ExecutionActivationStatus> {
  const environment = getCurrentEnvironment();
  const inactive: ExecutionActivationStatus = {
    active: false, lifecycleState: 'UNBOOTSTRAPPED', enabledAt: null,
    enabledBy: null, expiresAt: null, expired: false, secondsRemaining: 0,
  };
  try {
    const sql = getRawSql();
    const colRows = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'governance_lifecycle'
          AND column_name = 'execution_enabled_expires_at'
      ) AS has_expiry
    ` as Array<{ has_expiry: boolean }>;
    const hasExpiry = Boolean(colRows[0]?.has_expiry);
    const rows = (hasExpiry
      ? await sql`
          SELECT lifecycle_state, execution_enabled_at, execution_enabled_by,
                 execution_enabled_expires_at AS expires_at,
                 (execution_enabled_expires_at IS NOT NULL
                   AND execution_enabled_expires_at <= now()) AS is_expired,
                 GREATEST(0, EXTRACT(EPOCH FROM (execution_enabled_expires_at - now())))::int AS secs
          FROM governance_lifecycle WHERE environment = ${environment} LIMIT 1`
      : await sql`
          SELECT lifecycle_state, execution_enabled_at, execution_enabled_by,
                 NULL AS expires_at, FALSE AS is_expired, 0 AS secs
          FROM governance_lifecycle WHERE environment = ${environment} LIMIT 1`
    ) as Array<Record<string, unknown>>;
    const r = rows[0];
    if (!r) return inactive;
    const lifecycleState = (r.lifecycle_state as MigrationGovernanceLifecycle) ?? 'UNBOOTSTRAPPED';
    const expiresAt = r.expires_at ? String(r.expires_at) : null;
    const expired = Boolean(r.is_expired);
    // Commit 4 (fail-closed correction): a valid activation REQUIRES a bounded
    // window with a future expiry. EXECUTION_ENABLED with a NULL expiry (a
    // legacy indefinite enable) is NOT active — indefinite activation is no
    // longer a permitted path.
    return {
      active: lifecycleState === 'EXECUTION_ENABLED' && expiresAt !== null && !expired,
      lifecycleState,
      enabledAt: r.execution_enabled_at ? String(r.execution_enabled_at) : null,
      enabledBy: r.execution_enabled_by ? String(r.execution_enabled_by) : null,
      expiresAt,
      expired,
      secondsRemaining: Number(r.secs) || 0,
    };
  } catch {
    return inactive;
  }
}

/**
 * Get the current governance lifecycle state for this environment.
 *
 * @returns The lifecycle state, or null if the governance_lifecycle table
 *          does not exist or has no row for this environment.
 */
export async function getGovernanceLifecycleState(): Promise<MigrationGovernanceLifecycle | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    const rows = await sql`
      SELECT lifecycle_state FROM governance_lifecycle
      WHERE environment = ${environment}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].lifecycle_state as MigrationGovernanceLifecycle;
  } catch {
    // Table may not exist yet.
    return null;
  }
}

/**
 * Set the governance lifecycle state for this environment.
 *
 * Updates the governance_lifecycle row for the current environment. If no row
 * exists, inserts one. Emits a governance state change audit event.
 *
 * @param newState The new lifecycle state.
 * @param changedBy The actor ID that initiated the change.
 * @returns True if the update succeeded.
 */
export async function setGovernanceLifecycleState(
  newState: MigrationGovernanceLifecycle,
  changedBy: string | null,
): Promise<boolean> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    // Use INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING to inspect exactly
    // how many rows were affected. A transition returns true ONLY when exactly
    // one lifecycle row was created or updated for this environment
    // (Gap 2 corrective patch: false-success elimination).
    const rows = await sql`
      INSERT INTO governance_lifecycle (
        environment, lifecycle_state, last_state_change_at,
        baseline_reconciled_by, baseline_reconciled_at
      ) VALUES (
        ${environment}, ${newState}, now(),
        ${newState === 'BASELINE_VERIFIED' || newState === 'EXECUTION_ENABLED' ? changedBy : null},
        ${newState === 'BASELINE_VERIFIED' || newState === 'EXECUTION_ENABLED' ? new Date() : null}
      )
      ON CONFLICT (environment) DO UPDATE SET
        lifecycle_state = EXCLUDED.lifecycle_state,
        baseline_reconciled_by = CASE
          WHEN EXCLUDED.lifecycle_state IN ('BASELINE_VERIFIED', 'EXECUTION_ENABLED') THEN EXCLUDED.baseline_reconciled_by
          ELSE governance_lifecycle.baseline_reconciled_by
        END,
        baseline_reconciled_at = CASE
          WHEN EXCLUDED.lifecycle_state IN ('BASELINE_VERIFIED', 'EXECUTION_ENABLED') THEN EXCLUDED.baseline_reconciled_at
          ELSE governance_lifecycle.baseline_reconciled_at
        END,
        last_state_change_at = now()
      RETURNING lifecycle_state
    `;

    // Inspect the returned rows: exactly one row must have been created or
    // updated, and it must reflect the requested new state.
    if (!Array.isArray(rows) || rows.length !== 1) {
      return false;
    }
    const updatedState = rows[0]?.lifecycle_state as MigrationGovernanceLifecycle | undefined;
    if (updatedState !== newState) {
      return false;
    }

    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null,
      actorId: changedBy,
      environment,
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { newState, changedBy },
    });

    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Historical baseline reconciliation (MIGRATION-GOV-02, Phase 1A.1 Issue 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a single migration's baseline reconciliation status.
 *
 * This is called during the baseline reconciliation workflow. The operator
 * (or automated introspection tool) classifies each migration's historical
 * applied state for the current environment. There is NO bulk mark-all-applied
 * function \u2014 each migration must be individually reconciled with evidence.
 *
 * The row is upserted (one row per migration+environment). If a row already
 * exists for this migration in this environment, it is updated to reflect the
 * latest reconciliation. The append-only run history is NOT affected \u2014
 * baseline reconciliation records evidence about the PAST, not about a run.
 *
 * @param params.identifier     The migration identifier (NNN or NNNx grammar).
 * @param params.status         The reconciliation status.
 * @param params.evidenceType   The type of evidence supporting the status.
 * @param params.evidenceSummary Optional human-readable evidence description.
 * @param params.reconciledBy   The actor ID who performed the reconciliation.
 * @returns true on success, false on failure.
 */
export async function recordBaselineReconciliation(params: {
  identifier: string;
  status: BaselineReconciliationStatus;
  evidenceType: BaselineEvidenceType;
  evidenceSummary?: string | null;
  reconciledBy: string | null;
}): Promise<boolean> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    await sql`
      INSERT INTO migration_baseline (
        migration_identifier, environment, reconciliation_status,
        evidence_type, evidence_summary, reconciled_by
      ) VALUES (
        ${params.identifier}, ${environment}, ${params.status},
        ${params.evidenceType}, ${params.evidenceSummary ?? null}, ${params.reconciledBy}
      )
      ON CONFLICT (migration_identifier, environment)
      DO UPDATE SET
        reconciliation_status = EXCLUDED.reconciliation_status,
        evidence_type = EXCLUDED.evidence_type,
        evidence_summary = EXCLUDED.evidence_summary,
        reconciled_by = EXCLUDED.reconciled_by,
        reconciled_at = now()
    `;

    emitAuditEvent({
      type: 'migration.baseline.completed',
      actorType: null,
      actorId: params.reconciledBy,
      environment,
      executionId: null,
      migrationIdentifier: params.identifier,
      filename: null,
      details: {
        reconciliationStatus: params.status,
        evidenceType: params.evidenceType,
        evidenceSummary: params.evidenceSummary,
        reconciledBy: params.reconciledBy,
      },
    });

    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emitAuditEvent({
      type: 'migration.baseline.failed',
      actorType: null,
      actorId: params.reconciledBy,
      environment,
      executionId: null,
      migrationIdentifier: params.identifier,
      filename: null,
      details: { error: errorMsg, status: params.status },
    });
    return false;
  }
}

/**
 * Record an ENTIRE reviewed baseline batch in ONE transaction (Commit 3).
 *
 * All upserts commit together or roll back together — a single-entry failure
 * aborts the whole batch (no partial baseline). Idempotent: re-recording the
 * identical batch upserts to the same values via ON CONFLICT. Throws on failure
 * so the caller (recordBaselineBatch) can report TRANSACTION_FAILED and record
 * nothing.
 *
 * The evidence_type is server-fixed to MANUAL_VERIFICATION (a reviewed batch's
 * evidence source is the operator, never a client claim); evidence_summary is
 * the operator's note.
 */
export async function recordBaselineBatchRows(
  entries: Array<{
    identifier: string;
    status: BaselineReconciliationStatus;
    notes: string;
  }>,
  reconciledBy: string | null,
): Promise<void> {
  if (entries.length === 0) throw new Error('recordBaselineBatchRows: empty batch');
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  // Neon transaction: build the array of parameterized upserts; executed
  // atomically. Any rejection rolls the whole transaction back.
  await sql.transaction((txn) =>
    entries.map((e) => txn`
      INSERT INTO migration_baseline (
        migration_identifier, environment, reconciliation_status,
        evidence_type, evidence_summary, reconciled_by
      ) VALUES (
        ${e.identifier}, ${environment}, ${e.status},
        'MANUAL_VERIFICATION', ${e.notes.length > 0 ? e.notes : null}, ${reconciledBy}
      )
      ON CONFLICT (migration_identifier, environment)
      DO UPDATE SET
        reconciliation_status = EXCLUDED.reconciliation_status,
        evidence_type = EXCLUDED.evidence_type,
        evidence_summary = EXCLUDED.evidence_summary,
        reconciled_by = EXCLUDED.reconciled_by,
        reconciled_at = now()
    `),
  );
}

/**
 * Read the baseline reconciliation status for a single migration in the
 * current environment.
 *
 * @param identifier The migration identifier.
 * @returns The baseline row, or null if no reconciliation has been recorded.
 */
export async function readBaselineReconciliation(
  identifier: string,
): Promise<MigrationBaselineRow | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    const rows = await sql`
      SELECT id, migration_identifier, environment, reconciliation_status,
             evidence_type, evidence_summary, reconciled_by, reconciled_at,
             created_at
      FROM migration_baseline
      WHERE migration_identifier = ${identifier}
        AND environment = ${environment}
    `;
    return (rows[0] as MigrationBaselineRow) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read all baseline reconciliation rows for the current environment.
 *
 * @returns A map of migration identifier \u2192 baseline row.
 */
export async function readAllBaselineReconciliations(): Promise<
  Record<string, MigrationBaselineRow>
> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    const rows = await sql`
      SELECT id, migration_identifier, environment, reconciliation_status,
             evidence_type, evidence_summary, reconciled_by, reconciled_at,
             created_at
      FROM migration_baseline
      WHERE environment = ${environment}
    `;
    const map: Record<string, MigrationBaselineRow> = {};
    for (const row of rows as MigrationBaselineRow[]) {
      map[row.migration_identifier] = row;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Verify that all migrations in the manifest have been reconciled and that
 * none have a blocking status (UNKNOWN or PARTIALLY_APPLIED).
 *
 * This is the gate that must pass before the lifecycle can advance from
 * BASELINE_IN_PROGRESS to BASELINE_VERIFIED. A migration is considered
 * "reconciled" if it has a baseline row with a non-blocking status
 * (CONFIRMED_APPLIED, CONFIRMED_NOT_APPLIED, or NOT_APPLICABLE).
 *
 * UNKNOWN and PARTIALLY_APPLIED are blocking statuses: they indicate that the
 * historical state of the migration could not be determined, and executing
 * migrations on top of an unknown base is unsafe.
 *
 * @param manifestIdentifiers The full list of migration identifiers from the
 *                             manifest.
 * @returns An object with: ok (boolean), unreconciled (identifiers with no
 *          baseline row), blocking (identifiers with UNKNOWN/PARTIALLY_APPLIED).
 */
export async function verifyBaselineComplete(
  manifestIdentifiers: string[],
): Promise<{
  ok: boolean;
  unreconciled: string[];
  blocking: string[];
}> {
  const baselines = await readAllBaselineReconciliations();
  const unreconciled: string[] = [];
  const blocking: string[] = [];

  for (const identifier of manifestIdentifiers) {
    const baseline = baselines[identifier];
    if (!baseline) {
      unreconciled.push(identifier);
    } else if (
      baseline.reconciliation_status === 'UNKNOWN' ||
      baseline.reconciliation_status === 'PARTIALLY_APPLIED'
    ) {
      blocking.push(identifier);
    }
  }

  return {
    ok: unreconciled.length === 0 && blocking.length === 0,
    unreconciled,
    blocking,
  };
}

/**
 * Advance the governance lifecycle to BASELINE_VERIFIED.
 *
 * This should only be called after verifyBaselineComplete() returns ok=true.
 * The caller is responsible for verifying completeness; this function records
 * the state change. It sets baseline_reconciled_by/at.
 *
 * Gap 2 corrective patch: this function now enforces that the current lifecycle
 * state is BASELINE_IN_PROGRESS before transitioning. The previous
 * implementation delegated to setGovernanceLifecycleState() which uses an
 * upsert (INSERT ... ON CONFLICT DO UPDATE) that would succeed regardless of
 * the current state. We now use a guarded UPDATE ... RETURNING that only
 * transitions from BASELINE_IN_PROGRESS, and we inspect the returned rows to
 * confirm exactly one row was transitioned.
 *
 * @param reconciledBy The actor who verified the baseline.
 * @returns true on success, false on failure or invalid predecessor state.
 */
export async function advanceToBaselineVerified(
  reconciledBy: string | null,
): Promise<boolean> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    // Only transition from BASELINE_IN_PROGRESS to BASELINE_VERIFIED.
    // Use RETURNING to inspect the number of rows actually updated.
    const rows = await sql`
      UPDATE governance_lifecycle
      SET lifecycle_state = 'BASELINE_VERIFIED',
          baseline_reconciled_by = ${reconciledBy},
          baseline_reconciled_at = now(),
          last_state_change_at = now()
      WHERE environment = ${environment}
        AND lifecycle_state = 'BASELINE_IN_PROGRESS'
      RETURNING lifecycle_state
    `;

    // Exactly one row must have been transitioned to BASELINE_VERIFIED.
    if (!Array.isArray(rows) || rows.length !== 1) {
      return false;
    }
    const updatedState = rows[0]?.lifecycle_state as MigrationGovernanceLifecycle | undefined;
    if (updatedState !== 'BASELINE_VERIFIED') {
      return false;
    }

    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null,
      actorId: reconciledBy,
      environment,
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { newState: 'BASELINE_VERIFIED', changedBy: reconciledBy },
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Advance the governance lifecycle to EXECUTION_ENABLED.
 *
 * This transitions from BASELINE_VERIFIED to EXECUTION_ENABLED, recording
 * who enabled execution, when, and the reason provided. Once in
 * EXECUTION_ENABLED, migrations can be applied via the canonical runner.
 *
 * MIGRATION-GOV-09 (Phase 1A.2): The transition requires a reason string.
 * The reason is recorded in the audit event for traceability. The caller
 * (API route) is responsible for TOTP verification before calling this
 * function.
 *
 * @param enabledBy The actor who enabled execution.
 * @param reason A human-readable reason for enabling execution (required,
 *               non-empty).
 * @returns true on success, false on failure or invalid reason.
 */
export async function enableExecution(
  enabledBy: string | null,
  reason?: string,
): Promise<boolean> {
  if (!reason || reason.trim().length === 0) {
    emitAuditEvent({
      type: 'migration.governance.execution_denied',
      actorType: null,
      actorId: enabledBy,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { reason: 'ENABLE_EXECUTION_REASON_REQUIRED' },
    });
    return false;
  }

  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    // Update the execution_enabled_by/at columns and transition to
    // EXECUTION_ENABLED. The WHERE clause ensures we can only transition
    // from BASELINE_VERIFIED — not from any other state.
    //
    // Gap 2 corrective patch: use RETURNING to inspect the number of rows
    // actually updated. The previous implementation returned true even when
    // zero rows were affected (e.g. when the lifecycle was in
    // BASELINE_REQUIRED, the UPDATE matched nothing but the function still
    // reported success). We now return true ONLY when exactly one row was
    // transitioned to EXECUTION_ENABLED.
    const rows = await sql`
      UPDATE governance_lifecycle
      SET execution_enabled_by = ${enabledBy},
          execution_enabled_at = now(),
          lifecycle_state = 'EXECUTION_ENABLED',
          last_state_change_at = now()
      WHERE environment = ${environment}
        AND lifecycle_state = 'BASELINE_VERIFIED'
      RETURNING lifecycle_state
    `;

    // Inspect the returned rows: exactly one row must have been transitioned
    // to EXECUTION_ENABLED. Zero rows (wrong predecessor state) or more than
    // one (should be impossible due to the unique environment constraint, but
    // defense-in-depth) both result in false.
    if (!Array.isArray(rows) || rows.length !== 1) {
      return false;
    }
    const updatedState = rows[0]?.lifecycle_state as MigrationGovernanceLifecycle | undefined;
    if (updatedState !== 'EXECUTION_ENABLED') {
      return false;
    }

    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null,
      actorId: enabledBy,
      environment,
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: {
        newState: 'EXECUTION_ENABLED',
        changedBy: enabledBy,
        reason: reason.trim(),
      },
    });

    return true;
  } catch {
    return false;
  }
}

/** Bounded-activation limits (Commit 4). */
export const ACTIVATION_DEFAULT_MINUTES = 10;
export const ACTIVATION_MAX_MINUTES = 15;
export const ACTIVATION_MIN_MINUTES = 1;

/** Clamp a requested activation duration into [MIN, MAX]. Absent (null/
 *  undefined/'') or non-finite input → default. A client can never exceed MAX. */
export function clampActivationMinutes(requested: unknown): number {
  if (requested === null || requested === undefined || requested === '') {
    return ACTIVATION_DEFAULT_MINUTES;
  }
  const n = Number(requested);
  if (!Number.isFinite(n)) return ACTIVATION_DEFAULT_MINUTES;
  return Math.max(ACTIVATION_MIN_MINUTES, Math.min(ACTIVATION_MAX_MINUTES, Math.floor(n)));
}

/**
 * Enable execution for a BOUNDED window (Commit 4). Replaces indefinite
 * activation: sets execution_enabled_expires_at = now() + clamped(duration).
 * The server clamps the duration to [1,15] minutes (default 10) — a client can
 * never exceed the maximum. Transitions ONLY from BASELINE_VERIFIED (same
 * predecessor guard as enableExecution). Returns the granted window on success.
 *
 * TOTP + reason + super_admin + env authorization are enforced by the route
 * BEFORE this is called; this function owns the durable state + audit.
 */
export async function enableExecutionTemporary(
  enabledBy: string | null,
  reason: string | undefined,
  requestedMinutes: unknown,
): Promise<{ success: boolean; expiresAt: string | null; grantedMinutes: number; error?: string }> {
  const grantedMinutes = clampActivationMinutes(requestedMinutes);
  if (!reason || reason.trim().length === 0) {
    emitAuditEvent({
      type: 'migration.governance.execution_denied',
      actorType: null, actorId: enabledBy, environment: getCurrentEnvironment(),
      executionId: null, migrationIdentifier: null, filename: null,
      details: { reason: 'ENABLE_EXECUTION_REASON_REQUIRED' },
    });
    return { success: false, expiresAt: null, grantedMinutes, error: 'REASON_REQUIRED' };
  }

  // Ensure the bounded-activation column exists (upgrades legacy environments).
  const upgraded = await ensureGovernanceSchemaCurrent();
  if (!upgraded) {
    return { success: false, expiresAt: null, grantedMinutes, error: 'SCHEMA_UPGRADE_FAILED' };
  }

  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    const rows = await sql`
      UPDATE governance_lifecycle
      SET execution_enabled_by = ${enabledBy},
          execution_enabled_at = now(),
          execution_enabled_expires_at = now() + make_interval(mins => ${grantedMinutes}),
          lifecycle_state = 'EXECUTION_ENABLED',
          last_state_change_at = now()
      WHERE environment = ${environment}
        AND lifecycle_state = 'BASELINE_VERIFIED'
      RETURNING lifecycle_state, execution_enabled_expires_at AS expires_at
    ` as Array<{ lifecycle_state: string; expires_at: string }>;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].lifecycle_state !== 'EXECUTION_ENABLED') {
      return { success: false, expiresAt: null, grantedMinutes, error: 'WRONG_PREDECESSOR_STATE' };
    }
    const expiresAt = String(rows[0].expires_at);
    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null, actorId: enabledBy, environment,
      executionId: null, migrationIdentifier: null, filename: null,
      details: {
        newState: 'EXECUTION_ENABLED', changedBy: enabledBy, reason: reason.trim(),
        bounded: true, grantedMinutes, expiresAt,
      },
    });
    return { success: true, expiresAt, grantedMinutes };
  } catch (err) {
    return { success: false, expiresAt: null, grantedMinutes, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Disable execution and return the governance lifecycle to BASELINE_VERIFIED.
 *
 * This transitions from EXECUTION_ENABLED back to BASELINE_VERIFIED, blocking
 * all further migration execution until execution is re-enabled. The
 * transition requires a reason string for audit traceability.
 *
 * MIGRATION-GOV-09 (Phase 1A.2): This is the inverse of enableExecution().
 * The caller (API route) is responsible for TOTP verification before calling
 * this function.
 *
 * @param disabledBy The actor who disabled execution.
 * @param reason A human-readable reason for disabling execution (required,
 *               non-empty).
 * @returns true on success, false on failure or invalid reason.
 */
export async function disableExecution(
  disabledBy: string | null,
  reason?: string,
): Promise<boolean> {
  if (!reason || reason.trim().length === 0) {
    emitAuditEvent({
      type: 'migration.governance.execution_denied',
      actorType: null,
      actorId: disabledBy,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { reason: 'DISABLE_EXECUTION_REASON_REQUIRED' },
    });
    return false;
  }

  const sql = getRawSql();
  const environment = getCurrentEnvironment();

  try {
    // Gap 2 corrective patch: use RETURNING to inspect the number of rows
    // actually updated. The previous implementation returned true even when
    // zero rows were affected (e.g. when the lifecycle was in
    // BASELINE_VERIFIED, the UPDATE matched nothing but the function still
    // reported success). We now return true ONLY when exactly one row was
    // transitioned from EXECUTION_ENABLED to BASELINE_VERIFIED.
    // Clear the bounded-activation window too (Commit 4). Column-safe: ensure
    // it exists first so legacy environments don't error on the SET.
    await ensureGovernanceSchemaCurrent();
    const rows = await sql`
      UPDATE governance_lifecycle
      SET lifecycle_state = 'BASELINE_VERIFIED',
          execution_enabled_by = null,
          execution_enabled_at = null,
          execution_enabled_expires_at = null,
          last_state_change_at = now()
      WHERE environment = ${environment}
        AND lifecycle_state = 'EXECUTION_ENABLED'
      RETURNING lifecycle_state
    `;

    // Inspect the returned rows: exactly one row must have been
    // transitioned to BASELINE_VERIFIED. Zero rows (wrong predecessor
    // state, e.g. not in EXECUTION_ENABLED) or more than one both result
    // in false.
    if (!Array.isArray(rows) || rows.length !== 1) {
      return false;
    }
    const updatedState = rows[0]?.lifecycle_state as MigrationGovernanceLifecycle | undefined;
    if (updatedState !== 'BASELINE_VERIFIED') {
      return false;
    }

    emitAuditEvent({
      type: 'migration.governance.state_change',
      actorType: null,
      actorId: disabledBy,
      environment,
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: {
        newState: 'BASELINE_VERIFIED',
        changedBy: disabledBy,
        reason: reason.trim(),
        action: 'disable_execution',
      },
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Assert that the current environment is in a state that permits migration
 * execution.
 *
 * MIGRATION-GOV-09 (Phase 1A.2): Only EXECUTION_ENABLED permits schema
 * mutation. BASELINE_VERIFIED is NOT an execution-permitting state.
 *
 * This is the execution gate called by the runner before applying any
 * migration. If the lifecycle is not in an execution-permitting state, the
 * runner must return a MIGRATION_BASELINE_REQUIRED error and NOT execute.
 *
 * Dry-run is exempt: dry-runs never mutate the database and are always
 * allowed for inspection/planning purposes.
 *
 * Behavior by lifecycle state (MIGRATION-GOV-09, Phase 1A.2):
 * - UNBOOTSTRAPPED:       not permitted (no ledger exists)
 * - LEDGER_BOOTSTRAPPED:  not permitted (baseline not started)
 * - BASELINE_REQUIRED:    not permitted (baseline reconciliation required)
 * - BASELINE_IN_PROGRESS: not permitted (baseline reconciliation in progress)
 * - BASELINE_VERIFIED:    NOT permitted (baseline complete but execution not
 *                          yet explicitly activated — operator must call
 *                          enable-execution to transition to EXECUTION_ENABLED)
 * - EXECUTION_ENABLED:    permitted (execution explicitly activated)
 *
 * Only EXECUTION_ENABLED permits schema mutation. BASELINE_VERIFIED is a
 * distinct state meaning "reconciliation is complete and ready for
 * activation" — it is NOT an execution-permitting state.
 *
 * @param dryRun If true, always returns permitted=true (dry-run exempt).
 * @returns permitted (boolean) and the current lifecycle state.
 */
export async function assertExecutionPermitted(
  dryRun: boolean,
): Promise<{
  permitted: boolean;
  lifecycleState: MigrationGovernanceLifecycle;
}> {
  // Dry-run is always permitted \u2014 it never mutates the database.
  if (dryRun) {
    const lifecycle = await getGovernanceLifecycleState().catch(() => null);
    return {
      permitted: true,
      lifecycleState: lifecycle ?? 'UNBOOTSTRAPPED',
    };
  }

  const lifecycle = await getGovernanceLifecycleState().catch(() => null);

  // If we cannot read the lifecycle state, assume the worst (not bootstrapped).
  if (!lifecycle) {
    return {
      permitted: false,
      lifecycleState: 'UNBOOTSTRAPPED',
    };
  }

  // MIGRATION-GOV-09 (Phase 1A.2): Only EXECUTION_ENABLED permits schema
  // mutation. BASELINE_VERIFIED is a readiness state, not an execution state.
  // The operator must explicitly activate execution via enable-execution
  // (with TOTP + reason) before any migration can be applied.
  //
  // Commit 4 (bounded activation, fail-closed): EXECUTION_ENABLED alone is not
  // sufficient — a VALID BOUNDED WINDOW is required. Permitted iff the lifecycle
  // is EXECUTION_ENABLED AND there is a non-null expiry that is still in the
  // future. Two states fail closed and are auto-relocked to BASELINE_VERIFIED:
  //   • EXPIRED    — a bounded window whose time has passed;
  //   • INDEFINITE — EXECUTION_ENABLED with a NULL expiry (a legacy enable).
  // Indefinite production-capable activation is no longer a permitted path.
  // Enforcement is server-side and does NOT rely on any UI timer.
  const activation = await readExecutionActivation().catch(() => null);
  const expired = activation?.expired === true;
  const indefinite = lifecycle === 'EXECUTION_ENABLED' && (activation?.expiresAt ?? null) === null;
  const hasValidWindow = activation?.active === true; // EXECUTION_ENABLED + future non-null expiry
  const permitted = lifecycle === 'EXECUTION_ENABLED' && hasValidWindow;

  // Auto-relock any invalid activation (expired OR indefinite) to
  // BASELINE_VERIFIED (opportunistic; never blocks the gate result). This makes
  // "invalid activation behaves as disabled" durable + audited.
  if (lifecycle === 'EXECUTION_ENABLED' && (expired || indefinite)) {
    try {
      const sql = getRawSql();
      const environment = getCurrentEnvironment();
      const relocked = await sql`
        UPDATE governance_lifecycle
        SET lifecycle_state = 'BASELINE_VERIFIED',
            execution_enabled_by = null,
            execution_enabled_at = null,
            execution_enabled_expires_at = null,
            last_state_change_at = now()
        WHERE environment = ${environment}
          AND lifecycle_state = 'EXECUTION_ENABLED'
          AND (execution_enabled_expires_at IS NULL
               OR execution_enabled_expires_at <= now())
        RETURNING lifecycle_state
      ` as unknown[];
      if (Array.isArray(relocked) && relocked.length === 1) {
        emitAuditEvent({
          type: 'migration.governance.state_change',
          actorType: null, actorId: null, environment,
          executionId: null, migrationIdentifier: null, filename: null,
          details: {
            newState: 'BASELINE_VERIFIED',
            reason: indefinite ? 'ACTIVATION_INDEFINITE_FAIL_CLOSED' : 'ACTIVATION_EXPIRED',
            autoRelock: true,
          },
        });
      }
    } catch { /* relock is best-effort; the gate already denies */ }
  }

  if (!permitted) {
    emitAuditEvent({
      type: 'migration.governance.execution_denied',
      actorType: null,
      actorId: null,
      environment: getCurrentEnvironment(),
      executionId: null,
      migrationIdentifier: null,
      filename: null,
      details: { lifecycleState: lifecycle, activationExpired: expired, activationIndefinite: indefinite },
    });
  }

  return { permitted, lifecycleState: lifecycle };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTP replay prevention (MIGRATION-GOV-05, Phase 1A.1 Issue 6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a TOTP time-step as used for a migration mutation.
 *
 * This prevents replay of the same TOTP code for a second mutation within the
 * same 30-second time window. The (user_id, time_step) pair is unique — if a
 * row already exists for this user and time-step, the INSERT fails (via the
 * unique constraint), and the caller should deny the mutation.
 *
 * The TOTP code itself is NOT stored. We store only a SHA-256 hash of the
 * (user_id, time_step) pair as a secondary integrity check. No sensitive value
 * (the actual TOTP code, the MFA secret, or any derived value) is persisted.
 *
 * @param userId       The admin user ID who provided the TOTP code.
 * @param timeStep     The TOTP time-step (floor(timestamp / 30)) that was used.
 * @param executionId  The execution ID of the migration run (for audit
 *                     correlation).
 * @returns true if the time-step was successfully recorded (first use),
 *          false if it was already used (replay detected).
 */
export async function recordTotpUse(
  userId: string,
  timeStep: number,
  executionId: string | null,
): Promise<boolean> {
  const sql = getRawSql();

  // Hash the (user_id, time_step) pair for integrity. We do NOT store the
  // TOTP code or any value derived from the secret.
  const { createHash } = await import('node:crypto');
  const useHash = createHash('sha256')
    .update(`${userId}:${timeStep}`)
    .digest('hex');

  try {
    // ON CONFLICT DO NOTHING: if the (user_id, time_step) pair already exists,
    // no row is inserted and RETURNING returns no rows. If it's a new pair,
    // a row is inserted and RETURNING returns its id.
    const rows = await sql`
      INSERT INTO migration_totp_uses (user_id, time_step, use_hash, execution_id)
      VALUES (${userId}, ${timeStep}, ${useHash}, ${executionId})
      ON CONFLICT (user_id, time_step) DO NOTHING
      RETURNING id
    `;
    // If we got a row back, it was a new insert (first use — not a replay).
    // If no row, the pair already existed (replay detected).
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check whether a TOTP time-step has already been used for a migration
 * mutation by this user.
 *
 * This is a read-only check that can be used before recording to detect
 * replay attempts. However, the authoritative check is the INSERT in
 * recordTotpUse() — there is a race window between this check and the INSERT.
 * For true replay prevention, use recordTotpUse() and check its return value.
 *
 * @param userId   The admin user ID.
 * @param timeStep The TOTP time-step to check.
 * @returns true if the time-step has already been used (replay), false if not.
 */
export async function isTotpTimeStepUsed(
  userId: string,
  timeStep: number,
): Promise<boolean> {
  const sql = getRawSql();

  try {
    const rows = await sql`
      SELECT id FROM migration_totp_uses
      WHERE user_id = ${userId} AND time_step = ${timeStep}
      LIMIT 1
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Record a migration run event in the append-only `schema_migration_runs` table.
 *
 * This is INSERT-only — it never updates or deletes existing rows. Each call
 * creates a new row preserving the full attempt history (MIGRATION-GOV-03).
 *
 * @param params The run event parameters.
 * @returns The ID of the inserted run row, or null on failure.
 */
export async function recordMigrationRunEvent(params: {
  executionId: string;
  identifier: string;
  filename: string;
  checksumSha256: string;
  status: MigrationRunStatus;
  actorType: MigrationActorType;
  actorId: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
}): Promise<number | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const rows = await sql`
      INSERT INTO schema_migration_runs (
        run_id, execution_id, migration_identifier, filename, checksum_sha256,
        environment, status, actor_type, actor_id, started_at, completed_at,
        execution_duration_ms, error_code, error_summary
      ) VALUES (
        ${runId}, ${params.executionId}, ${params.identifier}, ${params.filename},
        ${params.checksumSha256}, ${environment}, ${params.status},
        ${params.actorType}, ${params.actorId},
        ${params.startedAt ?? null}, ${params.completedAt ?? null},
        ${params.durationMs ?? null}, ${params.errorCode ?? null}, ${params.errorSummary ?? null}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a migration result in the ledger.
 *
 * This updates the current-state row in `schema_migrations` (one row per
 * migration+environment) to reflect the latest status, AND inserts a new row
 * in the append-only `schema_migration_runs` history table. The history row
 * preserves the full attempt details — the current-state row reflects only
 * the latest state (MIGRATION-GOV-03).
 *
 * Status transitions (current-state table):
 * - `pending` → `running` (at start, via markMigrationRunning)
 * - `running` → `applied` (on success)
 * - `running` → `failed` (on failure)
 * - `applied` → `superseded` (explicit administrative deprecation only)
 */
export async function recordMigrationResult(params: {
  identifier: string;
  filename: string;
  checksumSha256: string;
  description: string;
  status: MigrationStatus;
  executionId: string;
  startedAt: Date | null;
  durationMs: number | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  actorType: MigrationActorType;
  actorId: string | null;
}): Promise<void> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const now = new Date();
  const appliedAt = params.status === 'applied' ? now : null;
  const failedAt = params.status === 'failed' ? now : null;

  // First, insert the append-only run history row.
  const runId = await recordMigrationRunEvent({
    executionId: params.executionId,
    identifier: params.identifier,
    filename: params.filename,
    checksumSha256: params.checksumSha256,
    status: params.status === 'applied' ? 'applied'
      : params.status === 'failed' ? 'failed'
      : params.status === 'superseded' ? 'skipped'
      : 'failed',
    actorType: params.actorType,
    actorId: params.actorId,
    startedAt: params.startedAt,
    completedAt: now,
    durationMs: params.durationMs,
    errorCode: params.errorCode ?? null,
    errorSummary: params.errorSummary ?? null,
  });

  // Then, upsert the current-state row to reflect the latest status.
  await sql`
    INSERT INTO schema_migrations (
      migration_identifier, filename, checksum_sha256, description,
      status, started_at, applied_at, failed_at, execution_duration_ms,
      environment, applied_by_actor_type, applied_by_actor_id, execution_id,
      error_code, error_summary, last_run_id
    ) VALUES (
      ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
      ${params.status}, ${params.startedAt ?? null}, ${appliedAt}, ${failedAt}, ${params.durationMs},
      ${environment}, ${params.actorType}, ${params.actorId}, ${params.executionId},
      ${params.errorCode ?? null}, ${params.errorSummary ?? null}, ${runId}
    )
    ON CONFLICT (migration_identifier, environment)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      started_at = EXCLUDED.started_at,
      applied_at = EXCLUDED.applied_at,
      failed_at = EXCLUDED.failed_at,
      execution_duration_ms = EXCLUDED.execution_duration_ms,
      applied_by_actor_type = EXCLUDED.applied_by_actor_type,
      applied_by_actor_id = EXCLUDED.applied_by_actor_id,
      execution_id = EXCLUDED.execution_id,
      error_code = EXCLUDED.error_code,
      error_summary = EXCLUDED.error_summary,
      last_run_id = EXCLUDED.last_run_id
  `;
}

/**
 * Read all ledger rows for the current environment.
 */
export async function readLedgerRows(): Promise<Record<string, MigrationLedgerRow>> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const rows = await sql`
    SELECT * FROM schema_migrations WHERE environment = ${environment}
  `;
  const result: Record<string, MigrationLedgerRow> = {};
  for (const row of rows) {
    result[row.migration_identifier] = row as unknown as MigrationLedgerRow;
  }
  return result;
}

/**
 * Read the ledger row for a specific migration in the current environment.
 */
export async function readLedgerRow(identifier: string): Promise<MigrationLedgerRow | null> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const rows = await sql`
    SELECT * FROM schema_migrations
    WHERE migration_identifier = ${identifier} AND environment = ${environment}
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as MigrationLedgerRow;
}

/**
 * Read the append-only attempt history for a specific migration in the
 * current environment. Returns rows in chronological order (oldest first).
 *
 * This reads from `schema_migration_runs`, which is INSERT-only and preserves
 * the full history of every attempt (MIGRATION-GOV-03).
 *
 * @param identifier The migration identifier.
 * @param limit Optional maximum number of rows to return (most recent first if limited).
 * @returns An array of run history rows.
 */
export async function readMigrationRunHistory(
  identifier: string,
  limit?: number,
): Promise<MigrationRunRow[]> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    if (limit !== undefined) {
      const rows = await sql`
        SELECT * FROM schema_migration_runs
        WHERE migration_identifier = ${identifier} AND environment = ${environment}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows as unknown as MigrationRunRow[];
    }
    const rows = await sql`
      SELECT * FROM schema_migration_runs
      WHERE migration_identifier = ${identifier} AND environment = ${environment}
      ORDER BY created_at ASC
    `;
    return rows as unknown as MigrationRunRow[];
  } catch {
    // Table may not exist yet.
    return [];
  }
}

/**
 * Read the append-only attempt history for all migrations in the current
 * environment.
 *
 * @param limit Optional maximum number of rows to return (most recent first).
 * @returns An array of run history rows.
 */
export async function readAllMigrationRunHistory(limit?: number): Promise<MigrationRunRow[]> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  try {
    if (limit !== undefined) {
      const rows = await sql`
        SELECT * FROM schema_migration_runs
        WHERE environment = ${environment}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      return rows as unknown as MigrationRunRow[];
    }
    const rows = await sql`
      SELECT * FROM schema_migration_runs
      WHERE environment = ${environment}
      ORDER BY created_at ASC
    `;
    return rows as unknown as MigrationRunRow[];
  } catch {
    return [];
  }
}

/**
 * Mark a migration as `running` in the current-state ledger (at the start of
 * execution), and record a `started` event in the append-only run history.
 *
 * The current-state upsert updates the `schema_migrations` row to reflect
 * the latest attempt starting. The run history INSERT preserves the record
 * that this attempt began (MIGRATION-GOV-03, MIGRATION-GOV-10).
 *
 * The `started` run history row is recorded BEFORE the transaction begins,
 * so it survives even if the process crashes mid-execution.
 */
export async function markMigrationRunning(params: {
  identifier: string;
  filename: string;
  checksumSha256: string;
  description: string;
  executionId: string;
  actorType: MigrationActorType;
  actorId: string | null;
}): Promise<void> {
  const sql = getRawSql();
  const environment = getCurrentEnvironment();
  const now = new Date();

  // Record the STARTED event in the append-only run history FIRST.
  // This ensures the attempt is recorded before execution begins, so it
  // survives even if the process crashes mid-execution (MIGRATION-GOV-10).
  const runId = await recordMigrationRunEvent({
    executionId: params.executionId,
    identifier: params.identifier,
    filename: params.filename,
    checksumSha256: params.checksumSha256,
    status: 'started',
    actorType: params.actorType,
    actorId: params.actorId,
    startedAt: now,
    completedAt: null,
  });

  // Then upsert the current-state row to reflect the latest attempt starting.
  await sql`
    INSERT INTO schema_migrations (
      migration_identifier, filename, checksum_sha256, description,
      status, started_at, environment, applied_by_actor_type,
      applied_by_actor_id, execution_id, last_run_id
    ) VALUES (
      ${params.identifier}, ${params.filename}, ${params.checksumSha256}, ${params.description},
      'running', ${now}, ${environment}, ${params.actorType},
      ${params.actorId}, ${params.executionId}, ${runId}
    )
    ON CONFLICT (migration_identifier, environment)
    DO UPDATE SET
      filename = EXCLUDED.filename,
      checksum_sha256 = EXCLUDED.checksum_sha256,
      description = EXCLUDED.description,
      status = 'running',
      started_at = EXCLUDED.started_at,
      applied_by_actor_type = EXCLUDED.applied_by_actor_type,
      applied_by_actor_id = EXCLUDED.applied_by_actor_id,
      execution_id = EXCLUDED.execution_id,
      error_code = NULL,
      error_summary = NULL,
      last_run_id = EXCLUDED.last_run_id
  `;
}
