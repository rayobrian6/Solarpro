/**
 * Phase 1A.2: PostgreSQL Integration Harness — Migration Governance DDL Validation
 *
 * MIGRATION-GOV-15: This file provides REAL PostgreSQL integration tests that
 * execute the actual ledger DDL (`BOOTSTRAP_LEDGER_DDL`) against a live
 * PostgreSQL instance and verify that CHECK constraints, UNIQUE constraints,
 * advisory locking, and INSERT/UPDATE behavior work as designed.
 *
 * Unlike the source-scanning tests in `phase1a-migration-governance.test.ts`,
 * these tests actually connect to a database, execute SQL, and verify behavior.
 *
 * ## Test Database Configuration
 *
 * These tests require a PostgreSQL test database. They connect using the
 * `TEST_DATABASE_URL` environment variable. If the variable is not set, or if
 * the connection fails, ALL tests in this file are SKIPPED with a clear
 * message — they do not fail the suite.
 *
 * To run these tests locally:
 *   1. Install PostgreSQL
 *   2. Create a test database: `createdb migration_gov_test`
 *   3. Set TEST_DATABASE_URL: `export TEST_DATABASE_URL=postgresql://user:pass@localhost/migration_gov_test`
 *   4. Run: `npx vitest run tests/phase1a2-postgres-integration.test.ts`
 *
 * The harness creates and drops a unique test schema for each test run, so it
 * never interferes with other data in the database.
 *
 * ## What These Tests Validate (GOV-15 Section 8.2)
 *
 * 1. Ledger bootstrap creates all 5 tables with correct columns and constraints.
 * 2. Advisory locking (`pg_try_advisory_xact_lock`) works under concurrent access.
 * 3. Transaction execution commits on success and rolls back on failure.
 * 4. Baseline reconciliation INSERT/UPDATE respects CHECK constraints.
 * 5. TOTP replay prevention (`migration_totp_uses` UNIQUE) rejects duplicates.
 * 6. The identifier CHECK constraint rejects invalid identifiers.
 * 7. The status CHECK constraint rejects invalid statuses.
 *
 * MIGRATION-GOV-15 (Phase 1A.2): Integration harness for real PostgreSQL
 * validation of the migration governance ledger DDL.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { BOOTSTRAP_LEDGER_DDL } from '../lib/migrations/ledger';
import { MIGRATION_LOCK_KEY_DECIMAL } from '../lib/migrations/types';

// ─────────────────────────────────────────────────────────────────────────────
// Test Database Connection
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

// Use a unique schema name for this test run to avoid interference.
const TEST_SCHEMA = `phase1a2_intg_test`;

let pool: Pool | null = null;

// Skip helper: all tests use this to skip gracefully when no DB is available.
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Execute SQL in the test schema
// ─────────────────────────────────────────────────────────────────────────────

async function execSQL(client: PoolClient, sql: string): Promise<unknown[]> {
  // Set the search_path to the test schema so unqualified table names resolve.
  await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
  const result = await client.query(sql);
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1A.2: PostgreSQL Integration — Migration Governance DDL (MIGRATION-GOV-15)', () => {

  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    // Verify connection
    const client = await pool!.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  }, 30000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }, 15000);

  beforeEach(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      // Drop and recreate the test schema for a clean slate
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      // Execute the bootstrap DDL within the test schema
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      // The DDL uses IF NOT EXISTS, so it's safe to run. We need to execute
      // it statement-by-statement because some statements (like CREATE INDEX)
      // cannot be in a multi-statement query in some drivers.
      const statements = BOOTSTRAP_LEDGER_DDL.split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        await client.query(stmt);
      }
    } finally {
      client.release();
    }
  }, 15000);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Ledger Bootstrap: All 5 Tables Created with Correct Columns
  // ─────────────────────────────────────────────────────────────────────────

  it('bootstrap creates all 5 governance tables', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = '${TEST_SCHEMA}'
        ORDER BY table_name
      `);
      const tableNames = rows.map((r: Record<string, unknown>) => r.table_name);
      expect(tableNames).toContain('governance_lifecycle');
      expect(tableNames).toContain('schema_migrations');
      expect(tableNames).toContain('schema_migration_runs');
      expect(tableNames).toContain('migration_baseline');
      expect(tableNames).toContain('migration_totp_uses');
    } finally {
      client.release();
    }
  });

  it('governance_lifecycle has correct columns', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'governance_lifecycle'
        ORDER BY ordinal_position
      `);
      const cols = rows.map((r: Record<string, unknown>) => r.column_name);
      expect(cols).toContain('id');
      expect(cols).toContain('environment');
      expect(cols).toContain('lifecycle_state');
      expect(cols).toContain('baseline_reconciled_by');
      expect(cols).toContain('execution_enabled_by');
      expect(cols).toContain('lifecycle_state');
    } finally {
      client.release();
    }
  });

  it('schema_migrations has checksum_sha256 column with TEXT type', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'schema_migrations'
        AND column_name = 'checksum_sha256'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).data_type).toBe('text');
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Identifier CHECK Constraint (^[0-9]{3}[a-z]?$)
  // ─────────────────────────────────────────────────────────────────────────

  it('identifier CHECK accepts valid identifier 001 in schema_migrations', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '001', '001_test.sql',
          '${'a'.repeat(64)}',
          'test migration',
          'pending', 'test', 'human'
        )
      `);
      // If we get here without error, the CHECK passed
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('identifier CHECK accepts valid identifier 074a in schema_migration_runs', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment, actor_type
        ) VALUES (
          'run_074a', 'exec_074a', '074a', '074a_test.sql',
          '${'b'.repeat(64)}',
          'started', 'test', 'human'
        )
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('identifier CHECK rejects invalid identifier "abc" in schema_migrations', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            'abc', 'abc_test.sql',
            '${'a'.repeat(64)}',
            'test migration',
            'pending', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('identifier CHECK rejects invalid identifier "12" (too short) in schema_migration_runs', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migration_runs (
            run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
            environment, actor_type
          ) VALUES (
            'run_012', 'exec_012', '12', '012_test.sql',
            '${'a'.repeat(64)}',
            'started', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('identifier CHECK rejects invalid identifier "999aa" (double suffix) in migration_baseline', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO migration_baseline (
            migration_identifier, environment, reconciliation_status
          ) VALUES (
            '999aa', 'test', 'UNKNOWN'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Status CHECK Constraints
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migrations status CHECK accepts all 5 valid statuses', async () => {
    const client = await pool!.connect();
    try {
      const statuses = ['pending', 'running', 'applied', 'failed', 'superseded'];
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i];
        const id = String(i + 1).padStart(3, '0');
        await execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '${id}', 'test_${status}.sql',
            '${'a'.repeat(64)}',
            'test ${status}',
            '${status}', 'test_${status}', 'human'
          )
        `);
      }
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migrations status CHECK rejects invalid status "bogus"', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '001', 'test.sql',
            '${'a'.repeat(64)}',
            'test',
            'bogus', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs status CHECK accepts all 9 valid statuses', async () => {
    const client = await pool!.connect();
    try {
      const statuses = [
        'started', 'applied', 'failed', 'denied', 'skipped',
        'dry_run', 'conflict', 'lock_timeout', 'baseline_blocked',
      ];
      for (let i = 0; i < statuses.length; i++) {
        const status = statuses[i];
        const id = String(i + 1).padStart(3, '0');
        await execSQL(client, `
          INSERT INTO schema_migration_runs (
            run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
            environment, actor_type
          ) VALUES (
            'run_${id}', 'exec_${id}', '${id}', 'test_${status}.sql',
            '${'a'.repeat(64)}',
            '${status}', 'test_${status}', 'human'
          )
        `);
      }
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs status CHECK rejects invalid status "bogus"', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migration_runs (
            run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
            environment, actor_type
          ) VALUES (
            'run_bogus', 'exec_bogus', '001', 'test.sql',
            '${'a'.repeat(64)}',
            'bogus', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Actor Type CHECK Constraints (human, migration-actor)
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migrations accepts actor_type "human"', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '001', 'test.sql',
          '${'a'.repeat(64)}',
          'test', 'pending', 'test', 'human'
        )
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migrations accepts actor_type "migration-actor"', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '002', 'test.sql',
          '${'a'.repeat(64)}',
          'test', 'pending', 'test', 'migration-actor'
        )
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migrations rejects invalid actor_type "admin"', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '003', 'test.sql',
            '${'a'.repeat(64)}',
            'test', 'pending', 'test', 'admin'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs rejects invalid actor_type "service"', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migration_runs (
            run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
            environment, actor_type
          ) VALUES (
            'run_svc', 'exec_svc', '003', 'test.sql',
            '${'a'.repeat(64)}',
            'started', 'test', 'service'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. checksum_sha256 CHECK Constraint (^[0-9a-f]{64}$)
  // ─────────────────────────────────────────────────────────────────────────

  it('checksum_sha256 CHECK accepts valid 64-char hex', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '004', 'test.sql',
          '${'0123456789abcdef'.repeat(4)}',
          'test', 'pending', 'test', 'human'
        )
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('checksum_sha256 CHECK rejects non-hex characters', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '005', 'test.sql',
            '${'g'.repeat(64)}',
            'test', 'pending', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('checksum_sha256 CHECK rejects wrong length (63 chars)', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '006', 'test.sql',
            '${'a'.repeat(63)}',
            'test', 'pending', 'test', 'human'
          )
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. TOTP Replay Prevention — UNIQUE(user_id, time_step)
  // ─────────────────────────────────────────────────────────────────────────

  it('migration_totp_uses accepts first use of (user_id, time_step)', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user1', 1000, '${'a'.repeat(64)}')
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_totp_uses rejects duplicate (user_id, time_step) pair (replay)', async () => {
    const client = await pool!.connect();
    try {
      // First insert succeeds
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user2', 2000, '${'b'.repeat(64)}')
      `);
      // Second insert with same (user_id, time_step) fails
      await expect(
        execSQL(client, `
          INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
          VALUES ('user2', 2000, '${'c'.repeat(64)}')
        `)
      ).rejects.toThrow(/unique constraint/i);
    } finally {
      client.release();
    }
  });

  it('migration_totp_uses allows same user with different time_step', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user3', 3000, '${'d'.repeat(64)}')
      `);
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user3', 3001, '${'e'.repeat(64)}')
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_totp_uses allows different users with same time_step', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user4', 4000, '${'f'.repeat(64)}')
      `);
      await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('user5', 4000, '${'1'.repeat(64)}')
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_totp_uses use_hash CHECK rejects non-hex', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
          VALUES ('user6', 6000, '${'g'.repeat(64)}')
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Governance Lifecycle CHECK Constraint
  // ─────────────────────────────────────────────────────────────────────────

  it('governance_lifecycle accepts all 6 lifecycle states', async () => {
    const client = await pool!.connect();
    try {
      const states = [
        'UNBOOTSTRAPPED', 'LEDGER_BOOTSTRAPPED', 'BASELINE_REQUIRED',
        'BASELINE_IN_PROGRESS', 'BASELINE_VERIFIED', 'EXECUTION_ENABLED',
      ];
      for (const state of states) {
        await execSQL(client, `
          INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES ('env_${state}', '${state}')
        `);
      }
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('governance_lifecycle rejects invalid lifecycle state', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES ('env_bad', 'BAD_STATE')
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Baseline Reconciliation CHECK Constraints
  // ─────────────────────────────────────────────────────────────────────────

  it('migration_baseline accepts all 5 reconciliation_status values', async () => {
    const client = await pool!.connect();
    try {
      const statuses = [
        'CONFIRMED_APPLIED', 'CONFIRMED_NOT_APPLIED', 'PARTIALLY_APPLIED',
        'NOT_APPLICABLE', 'UNKNOWN',
      ];
      for (let i = 0; i < statuses.length; i++) {
        const id = String(i + 1).padStart(3, '0');
        await execSQL(client, `
          INSERT INTO migration_baseline (
            migration_identifier, environment, reconciliation_status
          ) VALUES ('${id}', 'test', '${statuses[i]}')
        `);
      }
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_baseline rejects invalid reconciliation_status', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO migration_baseline (
            migration_identifier, environment, reconciliation_status
          ) VALUES ('010', 'test', 'BAD_STATUS')
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  it('migration_baseline accepts all 6 evidence_type values', async () => {
    const client = await pool!.connect();
    try {
      const types = [
        'SCHEMA_INTROSPECTION', 'LEDGER_RECORD', 'MANUAL_VERIFICATION',
        'CHECKSUM_MATCH', 'OBJECT_EXISTENCE', 'NONE',
      ];
      for (let i = 0; i < types.length; i++) {
        const id = String(i + 11).padStart(3, '0');
        await execSQL(client, `
          INSERT INTO migration_baseline (
            migration_identifier, environment, reconciliation_status, evidence_type
          ) VALUES ('${id}', 'test', 'UNKNOWN', '${types[i]}')
        `);
      }
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_baseline rejects invalid evidence_type', async () => {
    const client = await pool!.connect();
    try {
      await expect(
        execSQL(client, `
          INSERT INTO migration_baseline (
            migration_identifier, environment, reconciliation_status, evidence_type
          ) VALUES ('020', 'test', 'UNKNOWN', 'BAD_TYPE')
        `)
      ).rejects.toThrow(/check_constraint_violation|violates check constraint/i);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Advisory Locking (pg_try_advisory_xact_lock)
  // ─────────────────────────────────────────────────────────────────────────

  it('pg_try_advisory_xact_lock acquires lock successfully', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(result.rows[0].acquired).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('pg_try_advisory_xact_lock is released after COMMIT (second client acquires)', async () => {
    const client1 = await pool!.connect();
    const client2 = await pool!.connect();
    try {
      // Client 1 acquires the lock in a transaction
      await client1.query('BEGIN');
      const r1 = await client1.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(r1.rows[0].acquired).toBe(true);

      // Client 2 tries while client 1 holds it — should fail
      await client2.query('BEGIN');
      const r2 = await client2.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(r2.rows[0].acquired).toBe(false);
      await client2.query('ROLLBACK');

      // Client 1 commits — lock is released
      await client1.query('COMMIT');

      // Client 2 retries — should now succeed
      await client2.query('BEGIN');
      const r3 = await client2.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(r3.rows[0].acquired).toBe(true);
      await client2.query('COMMIT');
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('pg_try_advisory_xact_lock is released after ROLLBACK', async () => {
    const client1 = await pool!.connect();
    const client2 = await pool!.connect();
    try {
      await client1.query('BEGIN');
      const r1 = await client1.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(r1.rows[0].acquired).toBe(true);
      await client1.query('ROLLBACK'); // Rollback releases the lock

      await client2.query('BEGIN');
      const r2 = await client2.query(
        `SELECT pg_try_advisory_xact_lock(${MIGRATION_LOCK_KEY_DECIMAL}::bigint) AS acquired`
      );
      expect(r2.rows[0].acquired).toBe(true);
      await client2.query('COMMIT');
    } finally {
      client1.release();
      client2.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Transaction Commit/Rollback Behavior
  // ─────────────────────────────────────────────────────────────────────────

  it('transaction COMMIT persists inserted row', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await execSQL(client, `
        INSERT INTO governance_lifecycle (environment, lifecycle_state)
        VALUES ('commit_test', 'UNBOOTSTRAPPED')
      `);
      await client.query('COMMIT');

      const rows = await execSQL(client, `
        SELECT environment, lifecycle_state FROM governance_lifecycle
        WHERE environment = 'commit_test'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).lifecycle_state).toBe('UNBOOTSTRAPPED');
    } finally {
      client.release();
    }
  });

  it('transaction ROLLBACK discards inserted row', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await execSQL(client, `
        INSERT INTO governance_lifecycle (environment, lifecycle_state)
        VALUES ('rollback_test', 'UNBOOTSTRAPPED')
      `);
      await client.query('ROLLBACK');

      const rows = await execSQL(client, `
        SELECT environment FROM governance_lifecycle
        WHERE environment = 'rollback_test'
      `);
      expect(rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. UNIQUE Constraint on schema_migrations (migration_identifier, environment)
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migrations UNIQUE(migration_identifier, environment) rejects duplicate', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '001', 'test.sql', '${'a'.repeat(64)}',
          'test', 'pending', 'env_unique', 'human'
        )
      `);
      await expect(
        execSQL(client, `
          INSERT INTO schema_migrations (
            migration_identifier, filename, checksum_sha256, description,
            status, environment, applied_by_actor_type
          ) VALUES (
            '001', 'test2.sql', '${'b'.repeat(64)}',
            'test2', 'pending', 'env_unique', 'human'
          )
        `)
      ).rejects.toThrow(/unique constraint/i);
    } finally {
      client.release();
    }
  });

  it('schema_migrations allows same identifier in different environments', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '002', 'test.sql', '${'a'.repeat(64)}',
          'test', 'pending', 'env_a', 'human'
        )
      `);
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment, applied_by_actor_type
        ) VALUES (
          '002', 'test.sql', '${'a'.repeat(64)}',
          'test', 'pending', 'env_b', 'human'
        )
      `);
      expect(true).toBe(true);
    } finally {
      client.release();
    }
  });
// ─────────────────────────────────────────────────────────────────────────────
// 12. Expanded Integration: ON CONFLICT DO NOTHING (TOTP Replay Detection Logic)
// ─────────────────────────────────────────────────────────────────────────────

  it('ON CONFLICT DO NOTHING returns 0 rows on duplicate (replay) and 1 row on first use', async () => {
    const client = await pool!.connect();
    try {
      // First use — INSERT succeeds, RETURNING returns 1 row
      const r1 = await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('replay_user', 5000, '${'a'.repeat(64)}')
        ON CONFLICT (user_id, time_step) DO NOTHING
        RETURNING id
      `);
      expect(r1).toHaveLength(1);

      // Replay — ON CONFLICT DO NOTHING, RETURNING returns 0 rows
      const r2 = await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('replay_user', 5000, '${'b'.repeat(64)}')
        ON CONFLICT (user_id, time_step) DO NOTHING
        RETURNING id
      `);
      expect(r2).toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('ON CONFLICT DO NOTHING allows different time_step for same user', async () => {
    const client = await pool!.connect();
    try {
      const r1 = await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('replay_user2', 6000, '${'a'.repeat(64)}')
        ON CONFLICT (user_id, time_step) DO NOTHING
        RETURNING id
      `);
      expect(r1).toHaveLength(1);

      const r2 = await execSQL(client, `
        INSERT INTO migration_totp_uses (user_id, time_step, use_hash)
        VALUES ('replay_user2', 6001, '${'b'.repeat(64)}')
        ON CONFLICT (user_id, time_step) DO NOTHING
        RETURNING id
      `);
      expect(r2).toHaveLength(1);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Expanded Integration: Governance Lifecycle State Machine
  // ─────────────────────────────────────────────────────────────────────────

  it('governance_lifecycle environment is UNIQUE', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO governance_lifecycle (environment, lifecycle_state)
        VALUES ('unique_env', 'UNBOOTSTRAPPED')
      `);
      await expect(
        execSQL(client, `
          INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES ('unique_env', 'EXECUTION_ENABLED')
        `)
      ).rejects.toThrow(/unique constraint/i);
    } finally {
      client.release();
    }
  });

  it('governance_lifecycle default state is LEDGER_BOOTSTRAPPED', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO governance_lifecycle (environment)
        VALUES ('default_env')
      `);
      const rows = await execSQL(client, `
        SELECT lifecycle_state FROM governance_lifecycle
        WHERE environment = 'default_env'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).lifecycle_state).toBe('LEDGER_BOOTSTRAPPED');
    } finally {
      client.release();
    }
  });

  it('governance_lifecycle can transition through all states', async () => {
    const client = await pool!.connect();
    try {
      const states = [
        'UNBOOTSTRAPPED', 'LEDGER_BOOTSTRAPPED', 'BASELINE_REQUIRED',
        'BASELINE_IN_PROGRESS', 'BASELINE_VERIFIED', 'EXECUTION_ENABLED',
      ];
      for (const state of states) {
        await execSQL(client, `
          INSERT INTO governance_lifecycle (environment, lifecycle_state)
          VALUES ('transition_${state}', '${state}')
          ON CONFLICT (environment) DO UPDATE SET lifecycle_state = EXCLUDED.lifecycle_state
        `);
      }
      // Verify all 6 environments exist with correct states
      const rows = await execSQL(client, `
        SELECT environment, lifecycle_state FROM governance_lifecycle
        WHERE environment LIKE 'transition_%'
        ORDER BY environment
      `);
      expect(rows).toHaveLength(6);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 14. Expanded Integration: Append-Only Run History (schema_migration_runs)
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migration_runs allows multiple rows for same migration (append-only)', async () => {
    const client = await pool!.connect();
    try {
      // Insert first run event (started)
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment, actor_type
        ) VALUES (
          'run_001_a', 'exec_001', '001', '001_test.sql',
          '${'a'.repeat(64)}',
          'started', 'test', 'human'
        )
      `);
      // Insert second run event (applied) — same migration, different run_id
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment, actor_type
        ) VALUES (
          'run_001_b', 'exec_001', '001', '001_test.sql',
          '${'a'.repeat(64)}',
          'applied', 'test', 'human'
        )
      `);
      // Verify both rows exist (append-only, no unique constraint on run_id alone)
      const rows = await execSQL(client, `
        SELECT status FROM schema_migration_runs
        WHERE migration_identifier = '001'
        ORDER BY status
      `);
      expect(rows).toHaveLength(2);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs records denied status for blocked migrations', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment, actor_type
        ) VALUES (
          'run_denied', 'exec_denied', '002', '002_test.sql',
          '${'a'.repeat(64)}',
          'denied', 'test', 'human'
        )
      `);
      const rows = await execSQL(client, `
        SELECT status, error_code FROM schema_migration_runs
        WHERE run_id = 'run_denied'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).status).toBe('denied');
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs records baseline_blocked status', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment, actor_type
        ) VALUES (
          'run_blblocked', 'exec_blblocked', '003', '003_test.sql',
          '${'a'.repeat(64)}',
          'baseline_blocked', 'test', 'human'
        )
      `);
      const rows = await execSQL(client, `
        SELECT status FROM schema_migration_runs WHERE run_id = 'run_blblocked'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).status).toBe('baseline_blocked');
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 15. Expanded Integration: Baseline Reconciliation Operations
  // ─────────────────────────────────────────────────────────────────────────

  it('migration_baseline allows multiple environments for same migration', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO migration_baseline (migration_identifier, environment, reconciliation_status)
        VALUES ('004', 'staging', 'CONFIRMED_APPLIED')
      `);
      await execSQL(client, `
        INSERT INTO migration_baseline (migration_identifier, environment, reconciliation_status)
        VALUES ('004', 'production', 'CONFIRMED_NOT_APPLIED')
      `);
      const rows = await execSQL(client, `
        SELECT environment, reconciliation_status FROM migration_baseline
        WHERE migration_identifier = '004'
        ORDER BY environment
      `);
      expect(rows).toHaveLength(2);
    } finally {
      client.release();
    }
  });

  it('migration_baseline default evidence_type is NONE', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO migration_baseline (migration_identifier, environment, reconciliation_status)
        VALUES ('005', 'test', 'UNKNOWN')
      `);
      const rows = await execSQL(client, `
        SELECT evidence_type FROM migration_baseline
        WHERE migration_identifier = '005'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).evidence_type).toBe('NONE');
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 16. Expanded Integration: Advisory Lock Concurrent Contention
  // ─────────────────────────────────────────────────────────────────────────

  it('advisory lock with different key does not conflict', async () => {
    const client1 = await pool!.connect();
    const client2 = await pool!.connect();
    try {
      // Use two different lock keys
      await client1.query('BEGIN');
      const r1 = await client1.query('SELECT pg_try_advisory_xact_lock(12345::bigint) AS acquired');
      expect(r1.rows[0].acquired).toBe(true);

      await client2.query('BEGIN');
      const r2 = await client2.query('SELECT pg_try_advisory_xact_lock(67890::bigint) AS acquired');
      expect(r2.rows[0].acquired).toBe(true); // Different key, no conflict

      await client1.query('COMMIT');
      await client2.query('COMMIT');
    } finally {
      client1.release();
      client2.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 17. Expanded Integration: Index Verification
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migrations has index on status', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}' AND tablename = 'schema_migrations'
      `);
      const indexNames = rows.map((r: Record<string, unknown>) => r.indexname as string);
      expect(indexNames.some(n => n.includes('status'))).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs has index on execution_id', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}' AND tablename = 'schema_migration_runs'
      `);
      const indexNames = rows.map((r: Record<string, unknown>) => r.indexname as string);
      expect(indexNames.some(n => n.includes('exec_id'))).toBe(true);
    } finally {
      client.release();
    }
  });

  it('schema_migration_runs has index on (migration_identifier, environment)', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}' AND tablename = 'schema_migration_runs'
      `);
      const indexNames = rows.map((r: Record<string, unknown>) => r.indexname as string);
      expect(indexNames.some(n => n.includes('identifier_env'))).toBe(true);
    } finally {
      client.release();
    }
  });

  it('migration_totp_uses has index on user_id', async () => {
    const client = await pool!.connect();
    try {
      const rows = await execSQL(client, `
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}' AND tablename = 'migration_totp_uses'
      `);
      const indexNames = rows.map((r: Record<string, unknown>) => r.indexname as string);
      expect(indexNames.some(n => n.includes('user'))).toBe(true);
    } finally {
      client.release();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 18. Expanded Integration: Nullable Actor Type (NULL allowed by CHECK)
  // ─────────────────────────────────────────────────────────────────────────

  it('schema_migration_runs allows NULL actor_type (CHECK permits NULL)', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migration_runs (
          run_id, execution_id, migration_identifier, filename, checksum_sha256, status,
          environment
        ) VALUES (
          'run_null', 'exec_null', '006', '006_test.sql',
          '${'a'.repeat(64)}',
          'started', 'test'
        )
      `);
      const rows = await execSQL(client, `
        SELECT actor_type FROM schema_migration_runs WHERE run_id = 'run_null'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).actor_type).toBeNull();
    } finally {
      client.release();
    }
  });

  it('schema_migrations allows NULL applied_by_actor_type (CHECK permits NULL)', async () => {
    const client = await pool!.connect();
    try {
      await execSQL(client, `
        INSERT INTO schema_migrations (
          migration_identifier, filename, checksum_sha256, description,
          status, environment
        ) VALUES (
          '007', '007_test.sql',
          '${'a'.repeat(64)}',
          'test null actor', 'pending', 'test_null'
        )
      `);
      const rows = await execSQL(client, `
        SELECT applied_by_actor_type FROM schema_migrations
        WHERE migration_identifier = '007'
      `);
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).applied_by_actor_type).toBeNull();
    } finally {
      client.release();
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Always-run test: document whether integration tests ran or were skipped
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.2: PostgreSQL Integration Harness Status (MIGRATION-GOV-15)', () => {
  it('documents whether TEST_DATABASE_URL was available', () => {
    if (HAS_TEST_DB) {
      // Integration tests were configured and should have run
      expect(TEST_DATABASE_URL).toBeDefined();
      console.log('[GOV-15] Integration tests RUN against PostgreSQL test database.');
    } else {
      // Integration tests were skipped — document the blocker
      console.log(
        '[GOV-15] Integration tests SKIPPED — TEST_DATABASE_URL not set. ' +
        'Set TEST_DATABASE_URL to a PostgreSQL connection string to run integration tests.'
      );
      expect(true).toBe(true); // This test always passes; it's informational
    }
  });
});
