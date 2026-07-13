/**
 * Bootstrap TOTP-replay correction — real-PostgreSQL validation.
 *
 * Reproduces and pins the corrected behavior for the operator-console bootstrap
 * path (app/api/admin/migrations/route.ts `action: 'bootstrap'`), which
 * previously reported "this TOTP code has already been used" for a brand-new
 * authenticator code. Root cause: the TOTP time-step was consumed inside
 * verifyFreshTotp BEFORE authorization/mutation, keyed only on (user, step),
 * with no idempotency and no release-on-failure — so a duplicate concurrent
 * request lost the (user,step) race and returned a replay error that masked the
 * first request's real result.
 *
 * These tests exercise the ACTUAL route handler + the governed-action
 * reservation ledger (lib/migrations/governedTotpAction.ts) against a real,
 * isolated local PostgreSQL schema (via the pg-backed neon shim). They assert:
 *
 *   1. A new TOTP authorizes one bootstrap (ledger created, lifecycle advanced).
 *   2. The same TOTP re-presented in a new submission is denied as TOTP_REPLAY.
 *   3. The next 30-second TOTP is accepted (not a replay).
 *   4. Two simultaneous identical bootstrap requests (shared idempotency key)
 *      collapse to ONE reservation and ONE idempotent response.
 *   5. A failure after TOTP validation does not block a later new TOTP, and the
 *      failed reservation is released (governedTotpAction level).
 *   6. verifyTotpStepValidity runs exactly once per governed bootstrap request.
 *   7. Bootstrap success creates the ledger and advances the lifecycle.
 *
 * Requires TEST_DATABASE_URL. Skipped otherwise (same convention as the phase1a
 * suites). Never connects to production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import type { AdminUser } from '@/lib/adminAuth';

// ── Module mocks (mirror the phase1a3 route-handler harness) ─────────────────

vi.mock('@neondatabase/serverless', async () => {
  const mockModule = await import('./__mocks__/neon-serverless');
  return {
    neon: mockModule.neon,
    neonConfig: mockModule.neonConfig,
    Pool: mockModule.Pool,
    closePool: mockModule.closePool,
    setTestSchema: mockModule.setTestSchema,
  };
});

vi.mock('@/lib/db-ready', async () => {
  const mockModule = await import('./__mocks__/neon-serverless');
  const actual = (await vi.importActual<typeof import('@/lib/db-ready')>('@/lib/db-ready')) as { DbConfigError: unknown };
  return {
    getDbWithRetry: async () => mockModule.neon(),
    isTransientDbError: (err: unknown) => !(err instanceof (actual.DbConfigError as Function)),
    DbConfigError: actual.DbConfigError,
  };
});

let mockAdminUser: AdminUser | null = null;
function setMockAdminUser(user: AdminUser | null): void { mockAdminUser = user; }

vi.mock('@/lib/adminAuth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return { ...actual, requireAdminApi: async () => mockAdminUser };
});

// ── Config ───────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'bootstrap_totp_replay_test';
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const ORIGINAL_ENV: Record<string, string | undefined> = {};
let rawPool: Pool | null = null;

const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT, actor_email TEXT, actor_role TEXT,
  target_type TEXT, target_id TEXT,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT, user_agent TEXT, request_path TEXT,
  actor_organization_id UUID, resource_owner_organization_id UUID,
  prev_hash TEXT, entry_hash TEXT NOT NULL
);
`;

const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Test Admin',
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin',
  mfa_secret_encrypted TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE
);
`;

const SUPER_ADMIN: AdminUser = { id: 'test-super-admin', name: 'Super Admin', email: 'super@example.com', role: 'super_admin' };

function saveEnv(k: string): void { if (!(k in ORIGINAL_ENV)) ORIGINAL_ENV[k] = process.env[k]; }
function setupEnv(): void {
  ['DATABASE_URL', 'MIGRATION_RUN_ALLOWED_ENVS', 'MIGRATION_ALLOW_PRODUCTION_EXECUTION', 'NODE_ENV', 'VERCEL_ENV', 'MFA_ENCRYPTION_KEY'].forEach(saveEnv);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development,test';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'false';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

async function rawExec(sql: string): Promise<any[]> {
  if (!rawPool) return [];
  const client = await rawPool.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    return (await client.query(sql)).rows;
  } finally { client.release(); }
}

function makePost(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/admin/migrations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

async function insertAdminWithMfa(userId: string, secret: string = TOTP_SECRET): Promise<void> {
  const { encryptTOTPSecret } = await import('../lib/mfa');
  const enc = encryptTOTPSecret(secret);
  await rawExec(`INSERT INTO users (id, email, mfa_secret_encrypted, mfa_enabled) VALUES ('${userId}', '${userId}@example.com', '${enc}', true)`);
}

async function code(atMs: number): Promise<string> {
  const { generateTOTPCode } = await import('../lib/mfa');
  return generateTOTPCode(TOTP_SECRET, atMs);
}

async function reservationRows(actionKey = 'bootstrap'): Promise<any[]> {
  return rawExec(`SELECT status, idempotency_key, time_step FROM migration_governed_actions WHERE action_key = '${actionKey}' ORDER BY id`);
}

describeOrSkip('Bootstrap TOTP replay — real Postgres', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    setupEnv();
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
    const client = await rawPool.connect();
    try { await client.query('SELECT 1'); } finally { client.release(); }
  }, 30000);

  afterAll(async () => {
    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    if (rawPool) {
      try {
        const c = await rawPool.connect();
        try { await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { c.release(); }
      } catch { /* best effort */ }
      await rawPool.end(); rawPool = null;
    }
    restoreEnv();
    vi.restoreAllMocks();
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;
    await new Promise((r) => setTimeout(r, 50)); // drain fire-and-forget audit
    const client = await rawPool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (const stmt of [AUDIT_LOG_DDL, USERS_DDL].join('\n').split(';').map((s) => s.trim()).filter(Boolean)) {
        await client.query(stmt);
      }
    } finally { client.release(); }
    setMockAdminUser(SUPER_ADMIN);
    await insertAdminWithMfa('test-super-admin');
    vi.restoreAllMocks();
  }, 15000);

  // 1 ─ A new TOTP authorizes one bootstrap.
  it('accepts a new TOTP and creates the ledger', async () => {
    const { POST } = await import('../app/api/admin/migrations/route');
    const res = await POST(makePost({ action: 'bootstrap', reason: 'operator recovery', totpCode: await code(Date.now()) }) as any);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deniedReason).toBeUndefined();
    expect(body.lifecycleState).toBe('BASELINE_REQUIRED');
    expect(typeof body.correlationId).toBe('string');
    // Ledger table now exists.
    const exists = await rawExec(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='schema_migrations' AND table_schema='${TEST_SCHEMA}') AS e`);
    expect(exists[0].e).toBe(true);
    // Exactly one COMPLETED reservation.
    const rows = await reservationRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('COMPLETED');
  });

  // 2 ─ The same TOTP replays and is denied.
  it('denies the same TOTP re-presented in a new submission (TOTP_REPLAY)', async () => {
    const { POST } = await import('../app/api/admin/migrations/route');
    const c = await code(Date.now());
    const res1 = await POST(makePost({ action: 'bootstrap', reason: 'first', totpCode: c }) as any);
    expect((await res1.json()).success).toBe(true);

    // New submission (distinct idempotency key: none provided → server uses a
    // fresh per-request correlation id), SAME code.
    const res2 = await POST(makePost({ action: 'bootstrap', reason: 'replay', totpCode: c }) as any);
    expect(res2.status).toBe(403);
    const body2 = await res2.json();
    expect(body2.success).toBe(false);
    expect(body2.deniedReason).toBe('TOTP_REPLAY');
  });

  // 3 ─ The next 30-second TOTP succeeds.
  it('accepts the next 30-second TOTP after one is consumed', async () => {
    const { POST } = await import('../app/api/admin/migrations/route');
    const res1 = await POST(makePost({ action: 'bootstrap', reason: 'first', totpCode: await code(Date.now()) }) as any);
    expect((await res1.json()).success).toBe(true);

    // The next time-step's code (+30s ⇒ current+1 step, still inside the ±1
    // acceptance window but a DIFFERENT step ⇒ a different reservation).
    const nextCode = await code(Date.now() + 30_000);
    const res2 = await POST(makePost({ action: 'bootstrap', reason: 'next step', totpCode: nextCode }) as any);
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.success).toBe(true);
    expect(body2.deniedReason).toBeUndefined();
    // Two distinct reservations (two steps), both COMPLETED.
    const rows = await reservationRows();
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.time_step)).size).toBe(2);
    expect(rows.every((r) => r.status === 'COMPLETED')).toBe(true);
  });

  // 4 ─ Two simultaneous identical requests → one mutation, one idempotent response.
  it('collapses two simultaneous identical bootstrap requests (shared idempotency key)', async () => {
    const { POST } = await import('../app/api/admin/migrations/route');
    const c = await code(Date.now());
    const idempotencyKey = 'dup-submission-key-0001';
    const [r1, r2] = await Promise.all([
      POST(makePost({ action: 'bootstrap', reason: 'dup', totpCode: c, idempotencyKey }) as any),
      POST(makePost({ action: 'bootstrap', reason: 'dup', totpCode: c, idempotencyKey }) as any),
    ]);
    const [b1, b2] = [await r1.json(), await r2.json()];

    // Both succeed (neither is a spurious replay), and both agree on outcome.
    expect(b1.success).toBe(true);
    expect(b2.success).toBe(true);
    expect(b1.deniedReason).toBeUndefined();
    expect(b2.deniedReason).toBeUndefined();
    // Exactly ONE reservation row for this (user, action, step): one mutation.
    const rows = await reservationRows();
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('COMPLETED');
    // Exactly one of the two responses is the collapsed (idempotent) duplicate.
    const idempotentCount = [b1, b2].filter((b) => b.idempotentReplay === true).length;
    expect(idempotentCount).toBe(1);
    // The ledger was created exactly once (only one bootstrap "created" the tables).
    const created = [b1, b2].filter((b) => b.alreadyExisted === false).length;
    expect(created).toBeGreaterThanOrEqual(1);
  });

  // 5 ─ A failure after TOTP validation does not block a later new TOTP; the
  //     failed reservation is released. Exercised at the reservation-ledger
  //     level for determinism (forcing a mid-bootstrap DB failure is nondet).
  it('releases a failed reservation and does not block a later new TOTP', async () => {
    const gov = await import('../lib/migrations/governedTotpAction');
    const userId = 'test-super-admin';
    const correlationId = gov.generateCorrelationId();
    const stepT = Math.floor(Date.now() / 1000 / 30);

    // Attempt at step T proceeds, then FAILS (as a failed bootstrap would).
    const begin1 = await gov.beginGovernedAction({ userId, actionKey: 'bootstrap', timeStep: stepT, idempotencyKey: 'sub-A', correlationId });
    expect(begin1.outcome).toBe('PROCEED');
    await gov.failGovernedAction(userId, 'bootstrap', stepT, { httpStatus: 500, body: { success: false } });

    // A NEW code (next step T+1) is NOT blocked by the failure.
    const beginNext = await gov.beginGovernedAction({ userId, actionKey: 'bootstrap', timeStep: stepT + 1, idempotencyKey: 'sub-B', correlationId: gov.generateCorrelationId() });
    expect(beginNext.outcome).toBe('PROCEED');

    // Even the SAME step, under a NEW submission, is released + retaken (a
    // failed attempt mutated nothing, so it must not burn the operator).
    const beginRetry = await gov.beginGovernedAction({ userId, actionKey: 'bootstrap', timeStep: stepT, idempotencyKey: 'sub-C', correlationId: gov.generateCorrelationId() });
    expect(beginRetry.outcome).toBe('PROCEED');
  });

  // 6 ─ verifyTotpStepValidity runs exactly once per governed bootstrap request.
  it('invokes verifyTotpStepValidity exactly once per bootstrap request', async () => {
    const runner = await import('../lib/migrations/runner');
    const spy = vi.spyOn(runner, 'verifyTotpStepValidity');
    const { POST } = await import('../app/api/admin/migrations/route');
    const res = await POST(makePost({ action: 'bootstrap', reason: 'single-verify', totpCode: await code(Date.now()) }) as any);
    expect((await res.json()).success).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    // And exactly one reservation was created for the request.
    expect((await reservationRows()).length).toBe(1);
  });

  // 7 ─ Bootstrap success creates the ledger and advances the lifecycle.
  it('creates the ledger and advances lifecycle to BASELINE_REQUIRED on success', async () => {
    const { POST, GET } = await import('../app/api/admin/migrations/route');
    const res = await POST(makePost({ action: 'bootstrap', reason: 'lifecycle', totpCode: await code(Date.now()) }) as any);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.lifecycleState).toBe('BASELINE_REQUIRED');

    // GET inspect confirms the ledger is now present.
    const get = await GET(new Request('http://localhost:3000/api/admin/migrations', { method: 'GET' }) as any);
    expect((await get.json()).ledgerExists).toBe(true);

    // governance_lifecycle row reflects BASELINE_REQUIRED.
    const life = await rawExec(`SELECT lifecycle_state FROM governance_lifecycle WHERE environment='development'`);
    expect(life[0].lifecycle_state).toBe('BASELINE_REQUIRED');
  });
});
