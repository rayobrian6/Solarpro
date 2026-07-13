/**
 * Targeted Nearmap recovery (migration 108) — real-PostgreSQL validation.
 *
 * Migration 102 created the durable nearmap_ai_cache table (lat/lng columns);
 * migration 108 adds the proximity index nearmap_ai_cache_lat_lng_idx that the
 * fail-closed cache needs so re-renders stop re-billing the metered AI quota.
 * Production evidence: 102 CONFIRMED_APPLIED, 108 CONFIRMED_NOT_APPLIED. This
 * suite exercises the dedicated `execute-nearmap-108` route action + the
 * 108-scoped bounded permit against an isolated local PostgreSQL schema and
 * proves:
 *
 *   1. Dependency verification denies when 102's table/columns are absent.
 *   2. Absent-index detection + execution through the CANONICAL runner.
 *   3. Idempotency — a second targeted run is a safe no-op.
 *   4. Durable audit of the targeted execution.
 *   5. Relock — lifecycle is not EXECUTION_ENABLED and baseline is NOT verified.
 *   6. The bounded permit authorizes ONLY 108 — every other identifier (015,
 *      040, 042, 102, 105, 106, 107) is denied.
 *   7. The ordinary full-baseline execution route stays blocked.
 *
 * Requires TEST_DATABASE_URL. Skipped otherwise. Never connects to production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminUser } from '@/lib/adminAuth';

vi.mock('@neondatabase/serverless', async () => {
  const m = await import('./__mocks__/neon-serverless');
  return { neon: m.neon, neonConfig: m.neonConfig, Pool: m.Pool, closePool: m.closePool, setTestSchema: m.setTestSchema };
});
vi.mock('@/lib/db-ready', async () => {
  const m = await import('./__mocks__/neon-serverless');
  const actual = (await vi.importActual<typeof import('@/lib/db-ready')>('@/lib/db-ready')) as { DbConfigError: unknown };
  return { getDbWithRetry: async () => m.neon(), isTransientDbError: (e: unknown) => !(e instanceof (actual.DbConfigError as Function)), DbConfigError: actual.DbConfigError };
});
let mockAdminUser: AdminUser | null = null;
function setMockAdminUser(u: AdminUser | null): void { mockAdminUser = u; }
vi.mock('@/lib/adminAuth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return { ...actual, requireAdminApi: async () => mockAdminUser };
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'targeted_nearmap_108_test';
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const ORIGINAL_ENV: Record<string, string | undefined> = {};
let rawPool: Pool | null = null;

const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL, action TEXT NOT NULL,
  actor_id TEXT, actor_email TEXT, actor_role TEXT,
  target_type TEXT, target_id TEXT, description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', ip_address TEXT, user_agent TEXT, request_path TEXT,
  actor_organization_id UUID, resource_owner_organization_id UUID,
  prev_hash TEXT, entry_hash TEXT NOT NULL
);`;
const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Test Admin', email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin', mfa_secret_encrypted TEXT, mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE
);`;

const SUPER_ADMIN: AdminUser = { id: 'test-super-admin', name: 'Super Admin', email: 'super@example.com', role: 'super_admin' };

function saveEnv(k: string): void { if (!(k in ORIGINAL_ENV)) ORIGINAL_ENV[k] = process.env[k]; }
function setupEnv(): void {
  ['DATABASE_URL', 'MIGRATION_RUN_ALLOWED_ENVS', 'MIGRATION_ALLOW_PRODUCTION_EXECUTION', 'NODE_ENV', 'VERCEL_ENV', 'MFA_ENCRYPTION_KEY'].forEach(saveEnv);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
  // Production, execution unlocked (the targeted path still requires this bar).
  process.env.VERCEL_ENV = 'production';
  process.env.MIGRATION_RUN_ALLOWED_ENVS = 'production';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'true';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
}
function restoreEnv(): void { for (const [k, v] of Object.entries(ORIGINAL_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

async function rawExec(sql: string): Promise<any[]> {
  if (!rawPool) return [];
  const c = await rawPool.connect();
  try { await c.query(`SET search_path TO ${TEST_SCHEMA}, public`); return (await c.query(sql)).rows; } finally { c.release(); }
}
function makePost(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/admin/migrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function insertAdminWithMfa(userId: string): Promise<void> {
  const { encryptTOTPSecret } = await import('../lib/mfa');
  const enc = encryptTOTPSecret(TOTP_SECRET);
  await rawExec(`INSERT INTO users (id, email, mfa_secret_encrypted, mfa_enabled) VALUES ('${userId}', '${userId}@example.com', '${enc}', true)`);
}
async function codeAt(offsetMs = 0): Promise<string> {
  const { generateTOTPCode } = await import('../lib/mfa');
  return generateTOTPCode(TOTP_SECRET, Date.now() + offsetMs);
}
/** Simulate "migration 102 already applied in production" by running its exact
 *  SQL into the isolated test schema. */
async function apply102(): Promise<void> {
  const sql102 = readFileSync(join(process.cwd(), 'lib', 'migrations', '102_nearmap_ai_cache.sql'), 'utf8');
  await rawExec(sql102);
}
async function bootstrapLedger(): Promise<void> {
  const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
  await bootstrapMigrationLedger('human', 'test-super-admin');
}
async function runTargeted(offsetMs = 0, reason = 'nearmap quota recovery'): Promise<{ status: number; body: any }> {
  const { POST } = await import('../app/api/admin/migrations/route');
  const res = await POST(makePost({ action: 'execute-nearmap-108', reason, totpCode: await codeAt(offsetMs), productionConfirmation: 'production' }) as any);
  return { status: res.status, body: await res.json() };
}

describeOrSkip('Targeted Nearmap recovery (migration 108) — real Postgres', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    setupEnv();
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
    const c = await rawPool.connect(); try { await c.query('SELECT 1'); } finally { c.release(); }
  }, 30000);

  afterAll(async () => {
    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    if (rawPool) {
      try { const c = await rawPool.connect(); try { await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { c.release(); } } catch { /* best effort */ }
      await rawPool.end(); rawPool = null;
    }
    restoreEnv();
    vi.restoreAllMocks();
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;
    await new Promise((r) => setTimeout(r, 50));
    const c = await rawPool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await c.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await c.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (const s of [AUDIT_LOG_DDL, USERS_DDL].join('\n').split(';').map((x) => x.trim()).filter(Boolean)) await c.query(s);
    } finally { c.release(); }
    setupEnv();
    setMockAdminUser(SUPER_ADMIN);
    await insertAdminWithMfa('test-super-admin');
    await bootstrapLedger(); // Ray bootstraps before running 108 (real flow).
    vi.restoreAllMocks();
  }, 20000);

  // 1 ─ Dependency verification.
  it('denies when the dependency (102) table/columns are absent', async () => {
    // 102 NOT applied — nearmap_ai_cache does not exist.
    const { status, body } = await runTargeted();
    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/dependency|nearmap_ai_cache|102/i);
    expect(body.verification?.dependencyPresent).toBe(false);
  });

  // 2 ─ Absent-index detection + execution via the canonical runner.
  it('detects the absent index and applies 108 through the canonical runner', async () => {
    await apply102();
    // Precondition: index absent.
    const before = await rawExec(`SELECT to_regclass('nearmap_ai_cache_lat_lng_idx') IS NOT NULL AS present`);
    expect(before[0].present).toBe(false);

    const { status, body } = await runTargeted();
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.verification.indexAbsentBefore).toBe(true);
    expect(body.verification.idempotent).toBe(true);
    expect(body.verification.nonDestructive).toBe(true);
    expect(body.verification.dependencyPresent).toBe(true);

    // Ledger + run-history say applied.
    expect(body.ledger?.status).toBe('applied');
    expect(body.runHistory.some((r: any) => r.status === 'applied')).toBe(true);
    expect(body.indexPresentAfter).toBe(true);

    // The actual index now exists on the expected table.
    const after = await rawExec(`SELECT to_regclass('nearmap_ai_cache_lat_lng_idx') IS NOT NULL AS present`);
    expect(after[0].present).toBe(true);
    // Ledger row for 108 is applied.
    const ledger = await rawExec(`SELECT status FROM schema_migrations WHERE migration_identifier = '108'`);
    expect(ledger[0]?.status).toBe('applied');
    // Run-history has an applied record for 108.
    const runs = await rawExec(`SELECT status FROM schema_migration_runs WHERE migration_identifier = '108' AND status = 'applied'`);
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  // 3 ─ Idempotency.
  it('is idempotent — a second targeted run is a safe no-op', async () => {
    await apply102();
    const first = await runTargeted(0);
    expect(first.body.success).toBe(true);
    // Second run with a NEXT-step code (avoid a same-window TOTP replay).
    const second = await runTargeted(30_000);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.alreadyApplied).toBe(true);
    // Still exactly one applied ledger row.
    const ledger = await rawExec(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_identifier = '108' AND status = 'applied'`);
    expect(ledger[0].n).toBe(1);
  });

  // 4 ─ Durable audit.
  it('writes a durable audit record for the targeted execution', async () => {
    await apply102();
    await runTargeted();
    await new Promise((r) => setTimeout(r, 200)); // drain fire-and-forget audit
    const rows = await rawExec(`
      SELECT action, metadata::text AS meta FROM audit_log
      WHERE action IN ('migration_run_completed', 'migration_applied', 'migration_governance_state_change')
      ORDER BY id DESC LIMIT 20`);
    const has108 = rows.some((r) => r.meta && r.meta.includes('108'));
    expect(has108).toBe(true);
  });

  // 5 ─ Relock; baseline NOT verified.
  it('relocks — lifecycle is not EXECUTION_ENABLED and baseline is not verified', async () => {
    await apply102();
    const { body } = await runTargeted();
    expect(body.relock.relocked).toBe(true);
    expect(body.relock.baselineVerified).toBe(false);
    const { getGovernanceLifecycleState } = await import('../lib/migrations/ledger');
    const life = await getGovernanceLifecycleState();
    expect(life).not.toBe('EXECUTION_ENABLED');
    expect(life).not.toBe('BASELINE_VERIFIED');
  });

  // 6 ─ The bounded permit authorizes ONLY 108.
  it('denies the bounded permit for every identifier other than 108', async () => {
    const { isTargetedPermitValid, authorizeMigration, runSinglePendingMigration } = await import('../lib/migrations/runner');
    const now = Date.now();
    for (const id of ['015', '040', '042', '102', '105', '106', '107']) {
      // A permit naming a non-108 identifier is invalid.
      expect(isTargetedPermitValid({ identifier: id, issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, id)).toBe(false);
      // A 108 permit used to run a different identifier is invalid.
      expect(isTargetedPermitValid({ identifier: '108', issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, id)).toBe(false);

      // Through the canonical runner, a non-108 permit does NOT bypass the gate
      // (lifecycle is BASELINE_REQUIRED) — execution is blocked.
      const auth = authorizeMigration({ action: 'execute', actorType: 'human', actorId: 'test-super-admin', adminUser: SUPER_ADMIN, dryRun: false, totpVerified: true });
      const res = await runSinglePendingMigration(id, { dryRun: false, authorization: auth, targetedPermit: { identifier: id, issuedAtMs: Date.now(), ttlMs: 60_000, reason: 'x' } } as any);
      expect(res.status).toBe('failed');
      expect(res.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');
    }
    // An expired 108 permit is invalid.
    expect(isTargetedPermitValid({ identifier: '108', issuedAtMs: Date.now() - 600_000, ttlMs: 60_000, reason: 'x' }, '108')).toBe(false);
    // A 108 permit IS valid for 108.
    expect(isTargetedPermitValid({ identifier: '108', issuedAtMs: Date.now(), ttlMs: 60_000, reason: 'x' }, '108')).toBe(true);
  });

  // 7 ─ The ordinary full-baseline execution route stays blocked.
  it('keeps the ordinary full-baseline execution route blocked', async () => {
    await apply102();
    const { POST } = await import('../app/api/admin/migrations/route');
    // Ordinary run-single (no targeted permit) — blocked because the lifecycle
    // is BASELINE_REQUIRED (baseline not verified, execution not enabled).
    const single = await POST(makePost({ action: 'run-single', identifier: '108', totpCode: await codeAt(0) }) as any);
    const sBody = await single.json();
    expect(sBody.success).toBe(false);
    expect(sBody.result?.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');

    // Ordinary run-pending — applies NOTHING (the lifecycle gate blocks every
    // pending migration). run-pending reports failed=0 when nothing runs, so the
    // real proof is that zero migrations were applied.
    const pending = await POST(makePost({ action: 'run-pending', totpCode: await codeAt(30_000) }) as any);
    const pBody = await pending.json();
    expect(pBody.result?.applied ?? 0).toBe(0);
    // No migration was actually applied to the ledger by the ordinary route.
    const applied = await rawExec(`SELECT count(*)::int AS n FROM schema_migrations WHERE status = 'applied'`);
    expect(applied[0].n).toBe(0);
  });
});
