// tests/migration-batch-execution-postgres.test.ts
//
// Commit 6 — Reviewed batch execution: REAL PostgreSQL orchestration.
//
// Gated on TEST_DATABASE_URL. Uses the pg-backed neon shim + fixture-migration
// harness. Replicates the route's batch orchestration (canonical order,
// stop-on-first-failure, verify from ledger, remaining stay pending, auto-relock)
// against a real server. The fixtures form a dependency chain (901 adds a column
// to 900's table), so a batch [901, 902] WITHOUT 900 applied gives a genuine
// mid-batch execution FAILURE.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { join } from 'path';
import type { AdminUser } from '@/lib/adminAuth';
import { canonicalizeExecutionBatch, batchExecutionOrder } from '../lib/migrations/executionBatch';

vi.mock('@neondatabase/serverless', async () => {
  const m = await import('./__mocks__/neon-serverless');
  return { neon: m.neon, neonConfig: m.neonConfig, Pool: m.Pool, closePool: m.closePool, setTestSchema: m.setTestSchema };
});
vi.mock('@/lib/db-ready', async () => {
  const m = await import('./__mocks__/neon-serverless');
  const actual = (await vi.importActual<typeof import('@/lib/db-ready')>('@/lib/db-ready')) as { DbConfigError: unknown };
  return { getDbWithRetry: async () => m.neon(), isTransientDbError: (e: unknown) => !(e instanceof (actual.DbConfigError as Function)), DbConfigError: actual.DbConfigError };
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'migration_exec_batch_test';
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'migrations');
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;
const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';

const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(), category TEXT NOT NULL,
  action TEXT NOT NULL, actor_id TEXT, actor_email TEXT, actor_role TEXT, target_type TEXT,
  target_id TEXT, description TEXT NOT NULL, metadata JSONB DEFAULT '{}', ip_address TEXT,
  user_agent TEXT, request_path TEXT, actor_organization_id UUID, resource_owner_organization_id UUID,
  prev_hash TEXT, entry_hash TEXT NOT NULL);`;
const ADMIN_USERS_DDL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'T', email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin', totp_secret_encrypted TEXT, mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE);`;

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
function restoreEnv() { for (const [k, v] of Object.entries(ORIG)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }

describeOrSkip('Commit 6: reviewed batch execution — real Postgres orchestration', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    setupEnv();
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    // Isolation: drop any schema/public governance tables left by prior suites
    // (bootstrap's existence check is not schema-qualified).
    const c = await rawPool.connect();
    try {
      const rows = await c.query(`SELECT DISTINCT table_schema FROM information_schema.tables WHERE table_name='schema_migrations' AND table_schema NOT IN ('pg_catalog','information_schema')`);
      for (const r of rows.rows as Array<{ table_schema: string }>) {
        if (r.table_schema === 'public') {
          for (const t of ['schema_migrations', 'schema_migration_runs', 'migration_baseline', 'governance_lifecycle', 'migration_totp_uses']) await c.query(`DROP TABLE IF EXISTS public.${t} CASCADE`);
        } else await c.query(`DROP SCHEMA IF EXISTS ${r.table_schema} CASCADE`);
      }
    } finally { c.release(); }
  }, 30000);

  afterAll(async () => {
    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    if (rawPool) { try { const c = await rawPool.connect(); try { await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { c.release(); } } catch {} await rawPool.end(); rawPool = null; }
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
      for (const stmt of (AUDIT_LOG_DDL + ADMIN_USERS_DDL).split(';').map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
    } finally { c.release(); }
  }, 15000);

  async function setupBounded() {
    const l = await import('../lib/migrations/ledger');
    await l.bootstrapMigrationLedger('human', 'test-admin-001');
    await l.setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-admin-001');
    for (const id of ['900', '901', '902', '903']) await l.recordBaselineReconciliation({ identifier: id, status: 'CONFIRMED_NOT_APPLIED', evidenceType: 'SCHEMA_INTROSPECTION', reconciledBy: 'test-admin-001' });
    await l.advanceToBaselineVerified('test-admin-001');
    expect((await l.enableExecutionTemporary('test-admin-001', 'batch test', 15)).success).toBe(true);
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
  // Mirror the route's batch loop: canonical order, stop-on-first-failure,
  // verify each from the ledger.
  async function runBatch(selected: string[]) {
    const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
    const l = await import('../lib/migrations/ledger');
    const runner = await fixtureRunner();
    const auth = await execAuth();
    const files = discoverMigrationFiles(FIXTURES_DIR).files;
    const batch = canonicalizeExecutionBatch({
      environment: 'development',
      serverEntries: files.map((f, i) => ({ identifier: f.identifier, filename: f.filename, checksumSha256: f.checksumSha256, transactionMode: f.transactionMode, order: i })),
      selectedIdentifiers: selected,
    });
    const order = batchExecutionOrder(batch);
    const results: Array<{ id: string; status: string }> = [];
    let stopped = false;
    for (const id of order) {
      if (stopped) { results.push({ id, status: 'not_run' }); continue; }
      const row = await l.readLedgerRow(id);
      if (row?.status === 'applied') { results.push({ id, status: 'blocked' }); stopped = true; continue; }
      await runner.runSinglePendingMigration(id, { dryRun: true, authorization: auth });
      await runner.runSinglePendingMigration(id, { dryRun: false, authorization: auth });
      const after = await l.readLedgerRow(id);
      const ok = after?.status === 'applied';
      results.push({ id, status: ok ? 'applied' : 'failed' });
      if (!ok) stopped = true;
    }
    await l.disableExecution('test-admin-001', 'auto-relock after batch');
    return { order, results, lifecycle: await l.getGovernanceLifecycleState() };
  }

  it('all-applied: [900,901,902,903] run in canonical order and all apply', async () => {
    await setupBounded();
    const { order, results, lifecycle } = await runBatch(['903', '900', '902', '901']); // scrambled input
    expect(order).toEqual(['900', '901', '902', '903']);                                 // canonical
    expect(results.every((r) => r.status === 'applied')).toBe(true);
    expect(lifecycle).toBe('BASELINE_VERIFIED'); // auto-relocked
  });

  it('stop-on-first-failure: [901,902] without 900 → 901 FAILS, 902 not_run, remaining pending, auto-relock', async () => {
    await setupBounded();
    const l = await import('../lib/migrations/ledger');
    const { results, lifecycle } = await runBatch(['901', '902']); // 901 needs 900's table → fails
    expect(results.find((r) => r.id === '901')!.status).toBe('failed');
    expect(results.find((r) => r.id === '902')!.status).toBe('not_run');
    // 902 never applied → remains pending in the ledger (no row / not applied).
    const row902 = await l.readLedgerRow('902');
    expect(row902?.status ?? 'pending').not.toBe('applied');
    expect(lifecycle).toBe('BASELINE_VERIFIED'); // auto-relocked even on failure
  });

  it('documents whether TEST_DATABASE_URL was available', () => {
    if (!HAS_TEST_DB) console.log('[exec-batch-pg] SKIPPED — TEST_DATABASE_URL not set.');
    expect(true).toBe(true);
  });
});
