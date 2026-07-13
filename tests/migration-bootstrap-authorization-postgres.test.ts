/**
 * Bootstrap authorization scoping — real-PostgreSQL validation.
 *
 * Bootstrap is governance INITIALIZATION (create the ledger tables, record and
 * verify the historical baseline). It runs no numbered SQL and executes no
 * migration. The execution allowlist (MIGRATION_RUN_ALLOWED_ENVS) and the
 * production two-key (MIGRATION_ALLOW_PRODUCTION_EXECUTION=true) are the
 * ACTUAL-EXECUTION gate and must NOT apply to bootstrap or baseline governance
 * — previously authorizeMigration applied them to both `execute` AND `bootstrap`,
 * making a fresh production environment impossible to bootstrap.
 *
 * These tests exercise the real route handler + governance ledger against an
 * isolated local PostgreSQL schema and prove:
 *   1. Production bootstrap succeeds with the execution allowlist EMPTY.
 *   2. Production bootstrap succeeds while MIGRATION_ALLOW_PRODUCTION_EXECUTION=false.
 *   3. Bootstrap executes NO numbered SQL (0 rows in schema_migrations).
 *   4. Bootstrap still requires super_admin + fresh TOTP + reason + typed
 *      production confirmation.
 *   5. Actual migration execution stays blocked when production is not allowlisted.
 *   6. Actual migration execution stays blocked when production execution is disabled.
 *   7. Baseline evidence / recording / verification do not require execution
 *      activation or the execution allowlist.
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
const TEST_SCHEMA = 'bootstrap_authz_test';
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
const REGULAR_ADMIN: AdminUser = { id: 'test-admin', name: 'Regular Admin', email: 'admin@example.com', role: 'admin' };

function saveEnv(k: string): void { if (!(k in ORIGINAL_ENV)) ORIGINAL_ENV[k] = process.env[k]; }
function baseEnv(): void {
  ['DATABASE_URL', 'MIGRATION_RUN_ALLOWED_ENVS', 'MIGRATION_ALLOW_PRODUCTION_EXECUTION', 'NODE_ENV', 'VERCEL_ENV', 'MFA_ENCRYPTION_KEY'].forEach(saveEnv);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
}
function restoreEnv(): void { for (const [k, v] of Object.entries(ORIGINAL_ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

/** Configure the environment gate for a test. */
function setEnv(opts: { vercelEnv?: string; allowlist?: string; allowProd?: boolean }): void {
  if (opts.vercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = opts.vercelEnv;
  process.env.MIGRATION_RUN_ALLOWED_ENVS = opts.allowlist ?? '';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = opts.allowProd ? 'true' : 'false';
}

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
async function code(atMs: number = Date.now()): Promise<string> {
  const { generateTOTPCode } = await import('../lib/mfa');
  return generateTOTPCode(TOTP_SECRET, atMs);
}
async function bootstrapProd(reason = 'prod recovery'): Promise<Response> {
  const { POST } = await import('../app/api/admin/migrations/route');
  return POST(makePost({ action: 'bootstrap', reason, totpCode: await code(), productionConfirmation: 'production' }) as any) as unknown as Response;
}

describeOrSkip('Bootstrap authorization scoping — real Postgres', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    baseEnv();
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
    setEnv({ vercelEnv: 'production', allowlist: '', allowProd: false }); // production, execution locked down
    setMockAdminUser(SUPER_ADMIN);
    await insertAdminWithMfa('test-super-admin');
    vi.restoreAllMocks();
  }, 15000);

  // 1 ─ Production bootstrap succeeds with the execution allowlist EMPTY.
  it('production bootstrap succeeds with an empty execution allowlist', async () => {
    setEnv({ vercelEnv: 'production', allowlist: '', allowProd: false });
    const res = await bootstrapProd();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.lifecycleState).toBe('BASELINE_REQUIRED');
  });

  // 2 ─ Production bootstrap succeeds while MIGRATION_ALLOW_PRODUCTION_EXECUTION=false.
  it('production bootstrap succeeds while production execution is disabled', async () => {
    setEnv({ vercelEnv: 'production', allowlist: 'production', allowProd: false });
    expect(process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION).toBe('false');
    const res = await bootstrapProd();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  // 3 ─ Bootstrap executes NO numbered SQL.
  it('bootstrap executes no numbered migration SQL', async () => {
    setEnv({ vercelEnv: 'production', allowlist: '', allowProd: false });
    expect((await bootstrapProd().then((r) => r.json())).success).toBe(true);
    // The ledger table exists but holds ZERO migration rows — nothing was applied.
    const ledgerCount = await rawExec(`SELECT count(*)::int AS n FROM schema_migrations`);
    expect(ledgerCount[0].n).toBe(0);
    // No run-history rows either.
    const runs = await rawExec(`SELECT count(*)::int AS n FROM schema_migration_runs`);
    expect(runs[0].n).toBe(0);
    // Governance was initialized (baseline required), which is the only mutation.
    const life = await rawExec(`SELECT lifecycle_state FROM governance_lifecycle WHERE environment='production'`);
    expect(life[0].lifecycle_state).toBe('BASELINE_REQUIRED');
  });

  // 4 ─ Bootstrap requires super_admin + fresh TOTP + reason + typed prod confirmation.
  describe('bootstrap still enforces its own bar', () => {
    it('rejects a non-super_admin (403)', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      await rawExec(`INSERT INTO users (id, email, mfa_secret_encrypted, mfa_enabled) VALUES ('test-admin','admin@example.com','x',true)`);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePost({ action: 'bootstrap', reason: 'x', totpCode: await code(), productionConfirmation: 'production' }) as any);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/super_admin/i);
    });
    it('rejects a missing TOTP code (403)', async () => {
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePost({ action: 'bootstrap', reason: 'x', productionConfirmation: 'production' }) as any);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toMatch(/TOTP/i);
    });
    it('rejects an invalid TOTP code (403)', async () => {
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePost({ action: 'bootstrap', reason: 'x', totpCode: '000000', productionConfirmation: 'production' }) as any);
      expect(res.status).toBe(403);
      expect((await res.json()).deniedReason).toBe('TOTP_INVALID');
    });
    it('rejects a missing reason (400)', async () => {
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePost({ action: 'bootstrap', totpCode: await code(), productionConfirmation: 'production' }) as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/reason/i);
    });
    it('rejects production bootstrap without typed production confirmation (400)', async () => {
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePost({ action: 'bootstrap', reason: 'x', totpCode: await code() }) as any);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/productionConfirmation/i);
    });
  });

  // 5 ─ Actual execution stays blocked when production is not allowlisted.
  it('blocks actual migration execution when production is not allowlisted', async () => {
    setEnv({ vercelEnv: 'production', allowlist: '', allowProd: false });
    // Bootstrap the governance ledger first (so the execution path reaches the
    // env gate rather than a missing-table error).
    const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
    await bootstrapMigrationLedger('human', 'test-super-admin');
    const { POST } = await import('../app/api/admin/migrations/route');
    const res = await POST(makePost({ action: 'run-single', identifier: '108', totpCode: await code() }) as any);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/allowlist|MIGRATION_RUN_ALLOWED_ENVS/i);
  });

  // 6 ─ Actual execution stays blocked when production execution is disabled.
  it('blocks actual migration execution when production execution is disabled', async () => {
    // Allowlist includes production, but the two-key flag is false.
    setEnv({ vercelEnv: 'production', allowlist: 'production', allowProd: false });
    const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
    await bootstrapMigrationLedger('human', 'test-super-admin');
    const { POST } = await import('../app/api/admin/migrations/route');
    const res = await POST(makePost({ action: 'run-single', identifier: '108', totpCode: await code() }) as any);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Production migration execution is disabled/i);
  });

  // 7 ─ Baseline governance needs no execution activation / allowlist.
  it('baseline evidence, recording, and verification do not require execution activation', async () => {
    setEnv({ vercelEnv: 'production', allowlist: '', allowProd: false }); // execution fully locked
    const { POST } = await import('../app/api/admin/migrations/route');

    // Bootstrap first (governance init).
    expect((await bootstrapProd().then((r) => r.json())).success).toBe(true);

    // Read-only evidence generation: no TOTP, no activation, no allowlist.
    const ev = await POST(makePost({ action: 'generate-baseline-evidence' }) as any);
    expect(ev.status).toBe(200);
    expect((await ev.json()).success).toBe(true);

    // Baseline recording: governance mutation, not execution — no allowlist gate.
    const rec = await POST(makePost({ action: 'record-baseline-entry', identifier: '108', reconciliationStatus: 'CONFIRMED_APPLIED', evidenceType: 'SCHEMA_INTROSPECTION' }) as any);
    expect(rec.status).toBe(200);
    expect((await rec.json()).success).toBe(true);

    // Verify-baseline: it reaches its reconciliation logic (it will report
    // unreconciled real-manifest migrations) — the point is it is NOT blocked by
    // the execution allowlist / production two-key. So it must NOT 403.
    const ver = await POST(makePost({ action: 'verify-baseline' }) as any);
    expect(ver.status).not.toBe(403);
    const vbody = await ver.json();
    if (!vbody.success) {
      // A reconciliation-completeness 409, never an execution-gate error.
      expect(ver.status).toBe(409);
      expect(JSON.stringify(vbody)).not.toMatch(/allowlist|Production migration execution is disabled/i);
    }
  });
});
