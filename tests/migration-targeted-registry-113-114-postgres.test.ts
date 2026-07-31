/**
 * Targeted authority-registry deployment (migrations 113 + 114) — real-PostgreSQL
 * validation.
 *
 * Migration 113 creates manufacturer_document_registry (the versioned authority-
 * document store, W4 §8). Migration 114 creates equipment_reconciliation_audit +
 * snapshot_digest_invalidations (the immutable reconciliation-audit tables, W4
 * §7). Both are additive CREATE-TABLE-only DDL: idempotent, non-destructive, seed
 * no rows. This suite exercises the dedicated `execute-registry-113` and
 * `execute-reconciliation-114` route actions + their identifier-scoped bounded
 * permits against an isolated local PostgreSQL schema and proves:
 *
 *   1. Absent-table detection + execution of 113 through the CANONICAL runner.
 *   2. Absent-tables detection + execution of 114 (BOTH tables) via the runner.
 *   3. Idempotency — a second targeted run is a safe no-op (alreadyApplied).
 *   4. Durable audit of the targeted execution.
 *   5. Relock — lifecycle is not EXECUTION_ENABLED and baseline is NOT verified.
 *   6. The bounded permit authorizes ONLY its own identifier — a 113 permit
 *      cannot run 114/108/102/anything, and vice versa; retired ids (108, 109-
 *      112) are no longer allowlisted at all.
 *   7. The ordinary full-baseline execution route stays blocked.
 *
 * Requires TEST_DATABASE_URL. Skipped otherwise. Never connects to production.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
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
const TEST_SCHEMA = 'targeted_registry_113_114_test';
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
async function bootstrapLedger(): Promise<void> {
  const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
  await bootstrapMigrationLedger('human', 'test-super-admin');
}
async function runRegistry(action: string, offsetMs = 0, reason = 'deploy authority registry'): Promise<{ status: number; body: any }> {
  const { POST } = await import('../app/api/admin/migrations/route');
  const res = await POST(makePost({ action, reason, totpCode: await codeAt(offsetMs), productionConfirmation: 'production' }) as any);
  return { status: res.status, body: await res.json() };
}

describeOrSkip('Targeted authority-registry deployment (113 + 114) — real Postgres', () => {
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
    await bootstrapLedger(); // Ray bootstraps before running 113/114 (real flow).
    vi.restoreAllMocks();
  }, 20000);

  // 1 ─ Absent-table apply of 113 via the canonical runner.
  it('detects the absent table and applies 113 through the canonical runner', async () => {
    const before = await rawExec(`SELECT to_regclass('manufacturer_document_registry') IS NOT NULL AS present`);
    expect(before[0].present).toBe(false);

    const { status, body } = await runRegistry('execute-registry-113');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.identifier).toBe('113');
    expect(body.verification.idempotent).toBe(true);
    expect(body.verification.nonDestructive).toBe(true);
    expect(body.verification.tablesMatchExpected).toBe(true);
    expect(body.tablesPresentAfter).toBe(true);
    expect(body.ledger?.status).toBe('applied');
    expect(body.runHistory.some((r: any) => r.status === 'applied')).toBe(true);

    const after = await rawExec(`SELECT to_regclass('manufacturer_document_registry') IS NOT NULL AS present`);
    expect(after[0].present).toBe(true);
    const ledger = await rawExec(`SELECT status FROM schema_migrations WHERE migration_identifier = '113'`);
    expect(ledger[0]?.status).toBe('applied');
    const runs = await rawExec(`SELECT status FROM schema_migration_runs WHERE migration_identifier = '113' AND status = 'applied'`);
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  // 2 ─ Absent-tables apply of 114 (BOTH tables) via the canonical runner.
  it('applies 114 and creates BOTH reconciliation tables', async () => {
    const { status, body } = await runRegistry('execute-reconciliation-114');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.identifier).toBe('114');
    expect(body.tablesPresentAfter).toBe(true);
    expect(body.ledger?.status).toBe('applied');

    const a = await rawExec(`SELECT to_regclass('equipment_reconciliation_audit') IS NOT NULL AS present`);
    const b = await rawExec(`SELECT to_regclass('snapshot_digest_invalidations') IS NOT NULL AS present`);
    expect(a[0].present).toBe(true);
    expect(b[0].present).toBe(true);
    const ledger = await rawExec(`SELECT status FROM schema_migrations WHERE migration_identifier = '114'`);
    expect(ledger[0]?.status).toBe('applied');
  });

  // 3 ─ Idempotency.
  it('is idempotent — a second targeted run of 113 is a safe no-op', async () => {
    const first = await runRegistry('execute-registry-113', 0);
    expect(first.body.success).toBe(true);
    // Second run with a NEXT-step code (avoid a same-window TOTP replay).
    const second = await runRegistry('execute-registry-113', 30_000);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.alreadyApplied).toBe(true);
    // Still exactly one applied ledger row.
    const ledger = await rawExec(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_identifier = '113' AND status = 'applied'`);
    expect(ledger[0].n).toBe(1);
  });

  // 4 ─ Durable audit.
  it('writes a durable audit record for the targeted execution', async () => {
    await runRegistry('execute-registry-113');
    await new Promise((r) => setTimeout(r, 200)); // drain fire-and-forget audit
    const rows = await rawExec(`
      SELECT action, metadata::text AS meta FROM audit_log
      WHERE action IN ('migration_run_completed', 'migration_applied', 'migration_governance_state_change')
      ORDER BY id DESC LIMIT 20`);
    const has113 = rows.some((r) => r.meta && r.meta.includes('113'));
    expect(has113).toBe(true);
  });

  // 5 ─ Relock; baseline NOT verified.
  it('relocks — lifecycle is not EXECUTION_ENABLED and baseline is not verified', async () => {
    const { body } = await runRegistry('execute-reconciliation-114');
    expect(body.relock.relocked).toBe(true);
    expect(body.relock.baselineVerified).toBe(false);
    const { getGovernanceLifecycleState } = await import('../lib/migrations/ledger');
    const life = await getGovernanceLifecycleState();
    expect(life).not.toBe('EXECUTION_ENABLED');
    expect(life).not.toBe('BASELINE_VERIFIED');
  });

  // 6 ─ The bounded permit authorizes ONLY its own identifier.
  it('scopes the bounded permit to exactly its own identifier', async () => {
    const { isTargetedPermitValid, authorizeMigration, runSinglePendingMigration } = await import('../lib/migrations/runner');
    const now = Date.now();

    // Own-identifier permits are valid.
    expect(isTargetedPermitValid({ identifier: '113', issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, '113')).toBe(true);
    expect(isTargetedPermitValid({ identifier: '114', issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, '114')).toBe(true);

    // A 113 permit cannot run 114 (and vice versa).
    expect(isTargetedPermitValid({ identifier: '113', issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, '114')).toBe(false);
    expect(isTargetedPermitValid({ identifier: '114', issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, '113')).toBe(false);

    // Retired / non-allowlisted identifiers are rejected even with a matching permit.
    for (const id of ['108', '109', '110', '111', '112', '102', '015']) {
      expect(isTargetedPermitValid({ identifier: id, issuedAtMs: now, ttlMs: 60_000, reason: 'x' }, id)).toBe(false);
      // Through the canonical runner, such a permit does NOT bypass the gate
      // (lifecycle is BASELINE_REQUIRED) — execution is blocked.
      const auth = authorizeMigration({ action: 'execute', actorType: 'human', actorId: 'test-super-admin', adminUser: SUPER_ADMIN, dryRun: false, totpVerified: true });
      const res = await runSinglePendingMigration(id, { dryRun: false, authorization: auth, targetedPermit: { identifier: id, issuedAtMs: Date.now(), ttlMs: 60_000, reason: 'x' } } as any);
      expect(res.status).toBe('failed');
      expect(res.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');
    }

    // A 113 permit used to run 114 through the runner is also blocked.
    const auth2 = authorizeMigration({ action: 'execute', actorType: 'human', actorId: 'test-super-admin', adminUser: SUPER_ADMIN, dryRun: false, totpVerified: true });
    const cross = await runSinglePendingMigration('114', { dryRun: false, authorization: auth2, targetedPermit: { identifier: '113', issuedAtMs: Date.now(), ttlMs: 60_000, reason: 'x' } } as any);
    expect(cross.status).toBe('failed');
    expect(cross.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');

    // An expired own-identifier permit is invalid.
    expect(isTargetedPermitValid({ identifier: '113', issuedAtMs: Date.now() - 600_000, ttlMs: 60_000, reason: 'x' }, '113')).toBe(false);
  });

  // 7 ─ The ordinary full-baseline execution route stays blocked.
  it('keeps the ordinary full-baseline execution route blocked', async () => {
    const { POST } = await import('../app/api/admin/migrations/route');
    // Ordinary run-single (no targeted permit) — blocked because the lifecycle
    // is BASELINE_REQUIRED (baseline not verified, execution not enabled).
    const single = await POST(makePost({ action: 'run-single', identifier: '113', totpCode: await codeAt(0) }) as any);
    const sBody = await single.json();
    expect(sBody.success).toBe(false);
    expect(sBody.result?.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');

    // Ordinary run-pending — applies NOTHING (the lifecycle gate blocks every
    // pending migration).
    const pending = await POST(makePost({ action: 'run-pending', totpCode: await codeAt(30_000) }) as any);
    const pBody = await pending.json();
    expect(pBody.result?.applied ?? 0).toBe(0);
    const applied = await rawExec(`SELECT count(*)::int AS n FROM schema_migrations WHERE status = 'applied'`);
    expect(applied[0].n).toBe(0);
  });
});
