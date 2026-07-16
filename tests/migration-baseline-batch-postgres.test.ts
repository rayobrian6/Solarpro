// tests/migration-baseline-batch-postgres.test.ts
//
// Commit 3 — Reviewed Baseline Batch: REAL PostgreSQL transactional behavior.
//
// Mirrors the established repo convention (phase1a2-postgres-integration.test.ts):
// gated on TEST_DATABASE_URL, runs in a unique disposable schema, SKIPS cleanly
// when no test database is available (never fails the suite). Validates the
// batch upsert SQL's actual transactional guarantees on real Postgres:
//   • the whole batch commits atomically,
//   • a mid-batch failure rolls the ENTIRE batch back (no partial baseline),
//   • re-recording the identical batch is idempotent (ON CONFLICT upsert).
//
// It exercises the SAME SQL contract that recordBaselineBatchRows emits, run
// through pg in the test schema (the ledger module binds neon to DATABASE_URL
// with unqualified names, so — exactly as phase1a2 does for DDL — we validate
// the SQL semantics directly against a real server).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { BOOTSTRAP_LEDGER_DDL } from '../lib/migrations/ledger';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'migration_baseline_batch_test';
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let pool: Pool | null = null;

async function exec(client: PoolClient, sql: string, params: unknown[] = []): Promise<unknown[]> {
  await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
  const res = await client.query(sql, params);
  return res.rows;
}

const UPSERT = `
  INSERT INTO migration_baseline (
    migration_identifier, environment, reconciliation_status,
    evidence_type, evidence_summary, reconciled_by
  ) VALUES ($1, $2, $3, 'MANUAL_VERIFICATION', $4, $5)
  ON CONFLICT (migration_identifier, environment)
  DO UPDATE SET
    reconciliation_status = EXCLUDED.reconciliation_status,
    evidence_type = EXCLUDED.evidence_type,
    evidence_summary = EXCLUDED.evidence_summary,
    reconciled_by = EXCLUDED.reconciled_by,
    reconciled_at = now()
`;

describeOrSkip('Commit 3: baseline batch — real Postgres transactional behavior', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (const stmt of BOOTSTRAP_LEDGER_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
        await client.query(stmt);
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!HAS_TEST_DB || !pool) return;
    const client = await pool.connect();
    try { await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); }
    finally { client.release(); await pool.end(); }
  });

  beforeEach(async () => {
    if (!HAS_TEST_DB || !pool) return;
    const client = await pool.connect();
    try { await exec(client, `DELETE FROM migration_baseline`); }
    finally { client.release(); }
  });

  it('commits the whole batch atomically', async () => {
    const client = await pool!.connect();
    try {
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      await client.query('BEGIN');
      await client.query(UPSERT, ['001', 'test', 'CONFIRMED_APPLIED', 'a', 'op']);
      await client.query(UPSERT, ['002', 'test', 'NOT_APPLICABLE', 'b', 'op']);
      await client.query('COMMIT');
      const rows = await exec(client, `SELECT migration_identifier FROM migration_baseline ORDER BY migration_identifier`);
      expect(rows.map((r: any) => r.migration_identifier)).toEqual(['001', '002']);
    } finally { client.release(); }
  });

  it('rolls the ENTIRE batch back when one entry violates a constraint (no partial baseline)', async () => {
    const client = await pool!.connect();
    try {
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      let threw = false;
      try {
        await client.query('BEGIN');
        await client.query(UPSERT, ['001', 'test', 'CONFIRMED_APPLIED', 'a', 'op']);
        // Invalid status → CHECK constraint violation aborts the transaction.
        await client.query(UPSERT, ['002', 'test', 'NOT_A_REAL_STATUS', 'b', 'op']);
        await client.query('COMMIT');
      } catch {
        threw = true;
        await client.query('ROLLBACK');
      }
      expect(threw).toBe(true);
      const rows = await exec(client, `SELECT count(*)::int AS c FROM migration_baseline`);
      expect((rows[0] as any).c).toBe(0); // 001 was rolled back too
    } finally { client.release(); }
  });

  it('is idempotent — re-recording the identical batch upserts to the same state', async () => {
    const client = await pool!.connect();
    try {
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (let pass = 0; pass < 2; pass++) {
        await client.query('BEGIN');
        await client.query(UPSERT, ['001', 'test', 'CONFIRMED_APPLIED', 'seen', 'op']);
        await client.query(UPSERT, ['074a', 'test', 'NOT_APPLICABLE', 'n/a', 'op']);
        await client.query('COMMIT');
      }
      const rows = await exec(client, `SELECT migration_identifier, reconciliation_status FROM migration_baseline ORDER BY migration_identifier`);
      expect(rows).toEqual([
        { migration_identifier: '001', reconciliation_status: 'CONFIRMED_APPLIED' },
        { migration_identifier: '074a', reconciliation_status: 'NOT_APPLICABLE' },
      ]);
    } finally { client.release(); }
  });

  it('documents whether TEST_DATABASE_URL was available', () => {
    if (!HAS_TEST_DB) {
      console.log('[baseline-batch-pg] SKIPPED — TEST_DATABASE_URL not set.');
    }
    expect(true).toBe(true);
  });
});
