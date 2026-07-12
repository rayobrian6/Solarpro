// tests/migration-temporary-activation-postgres.test.ts
//
// Commit 4 — Bounded Activation: REAL PostgreSQL gate + expiry + relock.
//
// Gated on TEST_DATABASE_URL (skips cleanly with no test DB, same convention as
// phase1a2). Validates the SQL semantics the bounded-activation gate depends on,
// against a real server in a disposable schema:
//   • a bounded window in the FUTURE ⇒ permitted,
//   • a bounded window in the PAST ⇒ NOT permitted (fail-safe, server-derived,
//     not UI-timer-dependent),
//   • a NULL expiry (legacy indefinite) ⇒ permitted (backward compatible),
//   • the auto-relock UPDATE transitions an expired EXECUTION_ENABLED row back
//     to BASELINE_VERIFIED and clears the window,
//   • the bounded-activation column is added idempotently (ADD COLUMN IF NOT
//     EXISTS) to a pre-Commit-4 table.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { BOOTSTRAP_LEDGER_DDL } from '../lib/migrations/ledger';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'migration_activation_test';
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let pool: Pool | null = null;

async function q(client: PoolClient, sql: string, params: unknown[] = []): Promise<any[]> {
  await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
  return (await client.query(sql, params)).rows;
}

// The exact predicate the gate uses: permitted iff EXECUTION_ENABLED and NOT
// (a bounded window that has passed).
const GATE_PERMITTED = `
  SELECT (
    lifecycle_state = 'EXECUTION_ENABLED'
    AND NOT (execution_enabled_expires_at IS NOT NULL AND execution_enabled_expires_at <= now())
  ) AS permitted
  FROM governance_lifecycle WHERE environment = 'test' LIMIT 1
`;

describeOrSkip('Commit 4: bounded activation — real Postgres gate + relock', () => {
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
    } finally { client.release(); }
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
    try { await q(client, `DELETE FROM governance_lifecycle`); }
    finally { client.release(); }
  });

  async function seed(expiresSql: string) {
    const client = await pool!.connect();
    try {
      await q(client,
        `INSERT INTO governance_lifecycle (environment, lifecycle_state, execution_enabled_at, execution_enabled_expires_at)
         VALUES ('test', 'EXECUTION_ENABLED', now(), ${expiresSql})`);
    } finally { client.release(); }
  }

  it('a FUTURE bounded window is permitted', async () => {
    await seed(`now() + interval '10 minutes'`);
    const client = await pool!.connect();
    try { expect((await q(client, GATE_PERMITTED))[0].permitted).toBe(true); }
    finally { client.release(); }
  });

  it('a PAST bounded window is NOT permitted (fail-safe)', async () => {
    await seed(`now() - interval '1 minute'`);
    const client = await pool!.connect();
    try { expect((await q(client, GATE_PERMITTED))[0].permitted).toBe(false); }
    finally { client.release(); }
  });

  it('a NULL expiry (legacy indefinite) is permitted (backward compatible)', async () => {
    await seed(`NULL`);
    const client = await pool!.connect();
    try { expect((await q(client, GATE_PERMITTED))[0].permitted).toBe(true); }
    finally { client.release(); }
  });

  it('auto-relock transitions an EXPIRED window back to BASELINE_VERIFIED and clears it', async () => {
    await seed(`now() - interval '1 minute'`);
    const client = await pool!.connect();
    try {
      const relocked = await q(client, `
        UPDATE governance_lifecycle
        SET lifecycle_state = 'BASELINE_VERIFIED',
            execution_enabled_by = null, execution_enabled_at = null,
            execution_enabled_expires_at = null, last_state_change_at = now()
        WHERE environment = 'test' AND lifecycle_state = 'EXECUTION_ENABLED'
          AND execution_enabled_expires_at IS NOT NULL AND execution_enabled_expires_at <= now()
        RETURNING lifecycle_state`);
      expect(relocked).toHaveLength(1);
      const row = (await q(client, `SELECT lifecycle_state, execution_enabled_expires_at FROM governance_lifecycle WHERE environment='test'`))[0];
      expect(row.lifecycle_state).toBe('BASELINE_VERIFIED');
      expect(row.execution_enabled_expires_at).toBeNull();
    } finally { client.release(); }
  });

  it('ADD COLUMN IF NOT EXISTS is idempotent (upgrade path)', async () => {
    const client = await pool!.connect();
    try {
      // Runs twice with no error; column present afterward.
      await q(client, `ALTER TABLE governance_lifecycle ADD COLUMN IF NOT EXISTS execution_enabled_expires_at TIMESTAMPTZ`);
      await q(client, `ALTER TABLE governance_lifecycle ADD COLUMN IF NOT EXISTS execution_enabled_expires_at TIMESTAMPTZ`);
      const cols = await q(client, `
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='${TEST_SCHEMA}' AND table_name='governance_lifecycle'
          AND column_name='execution_enabled_expires_at'`);
      expect(cols).toHaveLength(1);
    } finally { client.release(); }
  });

  it('documents whether TEST_DATABASE_URL was available', () => {
    if (!HAS_TEST_DB) console.log('[activation-pg] SKIPPED — TEST_DATABASE_URL not set.');
    expect(true).toBe(true);
  });
});
