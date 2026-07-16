// tests/migration-operator-execution-postgres.test.ts
//
// Commit 5 — Reviewed single-migration execution: REAL PostgreSQL orchestration.
//
// Gated on TEST_DATABASE_URL (skips cleanly with no test DB). Uses the same
// pg-backed neon shim + fixture-migration harness as the Phase 1A.3 e2e suite.
// Proves the full reviewed-single flow against a real server, exactly as the
// route orchestrates it:
//   bounded activation → canonical dry-run → canonical real run →
//   success VERIFIED FROM LEDGER + RUN HISTORY (not the return value alone) →
//   auto-relock to BASELINE_VERIFIED → the migration is then ALREADY_APPLIED.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { join } from 'path';
import type { AdminUser } from '@/lib/adminAuth';
import {
  buildExecutionIdentity,
  computeExecutionDigest,
  assessExecutionEligibility,
} from '../lib/migrations/executionReview';

// Route neon() through the pg-backed shim (same as the e2e/edge harnesses).
vi.mock('@neondatabase/serverless', async () => {
  const m = await import('./__mocks__/neon-serverless');
  return { neon: m.neon, neonConfig: m.neonConfig, Pool: m.Pool, closePool: m.closePool, setTestSchema: m.setTestSchema };
});
vi.mock('@/lib/db-ready', async () => {
  const m = await import('./__mocks__/neon-serverless');
  const actual = (await vi.importActual<typeof import('@/lib/db-ready')>('@/lib/db-ready')) as { DbConfigError: unknown };
  return {
    getDbWithRetry: async () => m.neon(),
    isTransientDbError: (err: unknown) => !(err instanceof (actual.DbConfigError as Function)),
    DbConfigError: actual.DbConfigError,
  };
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'migration_exec_single_test';
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'migrations');
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;
const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';

const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT, actor_email TEXT,
  actor_role TEXT, target_type TEXT, target_id TEXT, description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', ip_address TEXT, user_agent TEXT, request_path TEXT,
  actor_organization_id UUID, resource_owner_organization_id UUID,
  prev_hash TEXT, entry_hash TEXT NOT NULL
);`;
const ADMIN_USERS_DDL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'Test Admin', email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin', totp_secret_encrypted TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE
);`;

const ORIG: Record<string, string | undefined> = {};
let rawPool: Pool | null = null;

function setupEnv() {
  for (const k of ['DATABASE_URL', 'MIGRATION_RUN_ALLOWED_ENVS', 'MIGRATION_ALLOW_PRODUCTION_EXECUTION', 'NODE_ENV', 'VERCEL_ENV', 'MFA_ENCRYPTION_KEY']) {
    if (!(k in ORIG)) ORIG[k] = process.env[k];
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development,test';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'false';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
}
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIG)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

describeOrSkip('Commit 5: reviewed single execution — real Postgres orchestration', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    setupEnv();
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });

    // Isolation: bootstrap's existence check (information_schema.tables) is not
    // schema-qualified, so a `schema_migrations` left in ANY schema by a prior
    // suite would false-positive and skip table creation in our schema. Drop
    // every non-system schema that carries governance tables, and any stray
    // governance tables in public. (Mirrors the e2e harness's schema cleanup.)
    const c = await rawPool.connect();
    try {
      const rows = await c.query(`
        SELECT DISTINCT table_schema FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')`);
      for (const r of rows.rows as Array<{ table_schema: string }>) {
        if (r.table_schema === 'public') {
          for (const t of ['schema_migrations', 'schema_migration_runs', 'migration_baseline', 'governance_lifecycle', 'migration_totp_uses']) {
            await c.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
          }
        } else {
          await c.query(`DROP SCHEMA IF EXISTS ${r.table_schema} CASCADE`);
        }
      }
    } finally { c.release(); }
  }, 30000);

  afterAll(async () => {
    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    if (rawPool) {
      try { const c = await rawPool.connect(); try { await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { c.release(); } } catch {}
      await rawPool.end(); rawPool = null;
    }
    restoreEnv();
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;
    await new Promise((r) => setTimeout(r, 50));
    const c = await rawPool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await c.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await c.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (const stmt of (AUDIT_LOG_DDL + ADMIN_USERS_DDL).split(';').map((s) => s.trim()).filter(Boolean)) {
        await c.query(stmt);
      }
    } finally { c.release(); }
  }, 15000);

  async function setupBoundedExecution(): Promise<void> {
    const l = await import('../lib/migrations/ledger');
    await l.bootstrapMigrationLedger('human', 'test-admin-001');
    await l.setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-admin-001');
    for (const id of ['900', '901', '902', '903']) {
      await l.recordBaselineReconciliation({ identifier: id, status: 'CONFIRMED_NOT_APPLIED', evidenceType: 'SCHEMA_INTROSPECTION', reconciledBy: 'test-admin-001' });
    }
    expect((await l.verifyBaselineComplete(['900', '901', '902', '903'])).ok).toBe(true);
    expect(await l.advanceToBaselineVerified('test-admin-001')).toBe(true);
    const en = await l.enableExecutionTemporary('test-admin-001', 'reviewed single execution test', 15);
    expect(en.success).toBe(true);
  }

  async function fixtureRunner() {
    const { createMigrationRunnerWithManifest } = await import('../lib/migrations/runner');
    const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
    return createMigrationRunnerWithManifest(() => discoverMigrationFiles(FIXTURES_DIR));
  }
  async function execAuth() {
    const { authorizeMigration } = await import('../lib/migrations/runner');
    const adminUser: AdminUser = { id: 'test-admin-001', name: 'T', email: 't@x.com', role: 'super_admin' };
    return authorizeMigration({ action: 'execute', actorType: 'migration-actor', actorId: 'test-admin-001', adminUser, dryRun: false, totpVerified: true });
  }

  it('dry-run → canonical run → verify from ledger+run-history → auto-relock', async () => {
    await setupBoundedExecution();
    const runner = await fixtureRunner();
    const auth = await execAuth();
    const l = await import('../lib/migrations/ledger');

    // A valid bounded window is present.
    expect((await l.readExecutionActivation()).active).toBe(true);

    // Dry-run first — NOT execution proof.
    const dry = await runner.runSinglePendingMigration('900', { dryRun: true, authorization: auth });
    expect(dry.dryRun).toBe(true);
    // Dry-run did not apply: ledger row is not 'applied'.
    expect((await l.readLedgerRow('900'))?.status ?? 'pending').not.toBe('applied');

    // Real execution — ONLY through the canonical runner.
    const exec = await runner.runSinglePendingMigration('900', { dryRun: false, authorization: auth });

    // Success verified from the LEDGER + run history (not the return value alone).
    const ledgerRow = await l.readLedgerRow('900');
    const history = await l.readMigrationRunHistory('900', 5);
    expect(ledgerRow?.status).toBe('applied');
    expect(history.some((r) => r.status === 'applied' && r.execution_id === exec.executionId)).toBe(true);

    // The canary table actually exists in the DB (real transactional apply).
    const c = await rawPool!.connect();
    try {
      await c.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      const t = await c.query(`SELECT to_regclass('${TEST_SCHEMA}.canary_900_test_table') AS t`);
      expect(t.rows[0].t).not.toBeNull();
    } finally { c.release(); }

    // Auto-relock after execution.
    expect(await l.disableExecution('test-admin-001', 'auto-relock after reviewed single execution of 900')).toBe(true);
    expect(await l.getGovernanceLifecycleState()).toBe('BASELINE_VERIFIED');
    // Window is gone → gate denies further execution.
    expect((await l.assertExecutionPermitted(false)).permitted).toBe(false);
  });

  it('digest is bound to the REAL fixture checksum; a changed checksum invalidates it', async () => {
    const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
    const { getCurrentEnvironment } = await import('../lib/migrations/runner');
    const f = discoverMigrationFiles(FIXTURES_DIR).files.find((x) => x.identifier === '900')!;
    const id = buildExecutionIdentity({ environment: getCurrentEnvironment(), identifier: '900', filename: f.filename, checksumSha256: f.checksumSha256, transactionMode: f.transactionMode });
    const digest = computeExecutionDigest(id);
    expect(digest).toHaveLength(64);
    const tampered = computeExecutionDigest(buildExecutionIdentity({ ...id, checksumSha256: 'f'.repeat(64) }));
    expect(tampered).not.toBe(digest);
  });

  it('after a successful run the migration is ALREADY_APPLIED → ineligible to re-run', async () => {
    await setupBoundedExecution();
    const runner = await fixtureRunner();
    const auth = await execAuth();
    const l = await import('../lib/migrations/ledger');
    await runner.runSinglePendingMigration('900', { dryRun: false, authorization: auth });

    const row = await l.readLedgerRow('900');
    const e = assessExecutionEligibility({
      foundInManifest: true,
      currentStatus: (row?.status ?? null) as any,
      hasChecksumConflict: false,
      transactionMode: 'REQUIRED',
      baselineStatus: 'CONFIRMED_NOT_APPLIED',
      hasValidActivationWindow: true,
      environmentAllowed: true,
      isProduction: false,
      productionExecutionAllowed: false,
    });
    expect(e.eligible).toBe(false);
    expect(e.blockReasons).toContain('ALREADY_APPLIED');
  });

  it('documents whether TEST_DATABASE_URL was available', () => {
    if (!HAS_TEST_DB) console.log('[exec-single-pg] SKIPPED — TEST_DATABASE_URL not set.');
    expect(true).toBe(true);
  });
});
