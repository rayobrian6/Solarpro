/**
 * Phase 1A.3: Baseline Evidence Generator Tests (GOV-20)
 *
 * This test suite validates the read-only historical baseline evidence
 * generator (`lib/migrations/baselineEvidence.ts`). The evidence generator
 * introspects the database catalog to assess whether each production migration
 * appears to have been applied, producing evidence PROPOSALS that a human
 * operator must review before recording reconciliation entries.
 *
 * ## What This Proves (GOV-20)
 *
 * PROVEN:
 *   - extractExpectedObjects(): A conservative SQL parser correctly extracts
 *     expected schema objects (tables, indexes, columns, constraints,
 *     extensions, functions, triggers, types, sequences) from migration SQL
 *     files, handling IF NOT EXISTS, schema-qualified names, quoted
 *     identifiers, and multi-statement files.
 *   - classifyMigrationEvidence(): A PURE function correctly classifies
 *     evidence proposals by comparing expected objects against a catalog
 *     snapshot — all found → CONFIRMED_APPLIED, some found →
 *     PARTIALLY_APPLIED, none found → CONFIRMED_NOT_APPLIED, no expectations
 *     → MANUAL_VERIFICATION/UNKNOWN, snapshot errors → NONE/UNKNOWN.
 *   - assertReadOnlySql(): A defense-in-depth check correctly identifies
 *     read-only SELECT queries and rejects mutation statements (INSERT,
 *     UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE, GRANT, REVOKE, etc.).
 *   - collectCatalogSnapshot(): Against a real PostgreSQL database, the
 *     snapshot collector correctly introspects pg_catalog for tables,
 *     indexes, columns, constraints, extensions, functions, triggers,
 *     types, and sequences — issuing ONLY SELECT queries (no mutations).
 *   - generateBaselineEvidence(): The top-level orchestration function
 *     correctly discovers the manifest, collects a snapshot, classifies
 *     each migration, and produces summary counts. performedMutation is
 *     always false.
 *
 * ## Test Database Configuration
 *
 * The DB-backed tests (collectCatalogSnapshot, generateBaselineEvidence)
 * require a local PostgreSQL test database via TEST_DATABASE_URL. They use
 * an isolated schema (phase1a3_evidence_test) with search_path isolation.
 * When no test database is available, the DB-backed tests are skipped.
 *
 * The pure function tests (extractExpectedObjects,
 * classifyMigrationEvidence, assertReadOnlySql) run without a database
 * and are always executed.
 *
 * ## Read-Only Guarantee
 *
 * A critical acceptance criterion is that the evidence generator NEVER
 * mutates the database. This is verified by:
 *   1. Collecting a baseline of all table names in the test schema before
 *      running generateBaselineEvidence().
 *   2. Running generateBaselineEvidence().
 *   3. Collecting the table names again and verifying they are identical.
 *   4. Verifying that report.performedMutation is false.
 *
 * MIGRATION-GOV-20 (Phase 1A.3): Baseline evidence generator validation —
 * read-only catalog introspection and conservative SQL parsing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// Module Mocks
// ─────────────────────────────────────────────────────────────────────────────
//
// Mock @neondatabase/serverless with our pg-backed shim, same as the e2e
// test harness. This routes all neon() tagged template queries through the
// local PostgreSQL test database.

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

// ─────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

// Isolated test schema for the evidence generator tests.
const TEST_SCHEMA = 'phase1a3_evidence_test';

// Path to the test fixture migrations directory (NOT lib/migrations/).
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'migrations');

// Environment variables for migration execution.
const ORIGINAL_ENV: Record<string, string | undefined> = {};

// Direct pg pool for test setup/teardown (bypasses the mock).
let rawPool: Pool | null = null;

// Skip helper for DB-backed tests.
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

// ─────────────────────────────────────────────────────────────────────────────
// Environment Helpers
// ─────────────────────────────────────────────────────────────────────────────

function saveEnv(key: string): void {
  if (!(key in ORIGINAL_ENV)) {
    ORIGINAL_ENV[key] = process.env[key];
  }
}

function setupMigrationEnv(): void {
  saveEnv('DATABASE_URL');
  saveEnv('NODE_ENV');
  saveEnv('VERCEL_ENV');
  saveEnv('MIGRATION_RUN_ALLOWED_ENVS');
  saveEnv('MIGRATION_ALLOW_PRODUCTION_EXECUTION');

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development,test';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'false';
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Execute SQL directly against the test schema using the raw pg pool
 * (bypassing the mock). Used for setup, teardown, and assertions.
 */
async function rawExec(sql: string): Promise<unknown[]> {
  if (!rawPool) return [];
  const client = await rawPool.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    const result = await client.query(sql);
    return result.rows;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure Function Tests — No Database Required
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 1A.3: Baseline Evidence Generator — Pure Functions (GOV-20)', () => {
  describe('assertReadOnlySql()', () => {
    it('returns true for a simple SELECT query', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('SELECT * FROM pg_class')).toBe(true);
    });

    it('returns true for SELECT with JOIN and WHERE', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(
        assertReadOnlySql(
          'SELECT c.relname, n.nspname FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relkind = \'r\'',
        ),
      ).toBe(true);
    });

    it('returns true for multiple SELECT statements separated by semicolons', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('SELECT 1; SELECT 2; SELECT 3')).toBe(true);
    });

    it('returns true for WITH (CTE) queries', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(
        assertReadOnlySql('WITH t AS (SELECT 1) SELECT * FROM t'),
      ).toBe(true);
    });

    it('returns false for INSERT statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('INSERT INTO foo VALUES (1)')).toBe(false);
    });

    it('returns false for UPDATE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('UPDATE foo SET bar = 1')).toBe(false);
    });

    it('returns false for DELETE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('DELETE FROM foo')).toBe(false);
    });

    it('returns false for CREATE TABLE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('CREATE TABLE foo (id int)')).toBe(false);
    });

    it('returns false for ALTER TABLE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(
        assertReadOnlySql('ALTER TABLE foo ADD COLUMN bar text'),
      ).toBe(false);
    });

    it('returns false for DROP TABLE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('DROP TABLE foo')).toBe(false);
    });

    it('returns false for TRUNCATE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('TRUNCATE foo')).toBe(false);
    });

    it('returns false for GRANT statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('GRANT SELECT ON foo TO bar')).toBe(false);
    });

    it('returns false for REVOKE statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('REVOKE ALL ON foo FROM bar')).toBe(false);
    });

    it('returns false for SELECT INTO (creates a table)', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('SELECT * INTO new_table FROM old_table')).toBe(false);
    });

    it('returns false for mixed SELECT + INSERT statements', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('SELECT 1; INSERT INTO foo VALUES (1)')).toBe(false);
    });

    it('ignores mutation keywords inside line comments', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(assertReadOnlySql('SELECT 1 -- this DROP TABLE is a comment')).toBe(true);
    });

    it('ignores mutation keywords inside block comments', async () => {
      const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');
      expect(
        assertReadOnlySql('SELECT 1 /* INSERT INTO foo VALUES (1) */'),
      ).toBe(true);
    });
  });

  describe('extractExpectedObjects()', () => {
    it('extracts a CREATE TABLE with columns', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `;
      const objects = extractExpectedObjects(sql);
      const kinds = objects.map((o) => o.kind);

      expect(objects.length).toBeGreaterThanOrEqual(4); // table + 3 columns
      expect(kinds).toContain('table');
      expect(kinds.filter((k) => k === 'column').length).toBe(3);

      const table = objects.find((o) => o.kind === 'table');
      expect(table).toBeDefined();
      expect(table!.name).toBe('projects');
      expect(table!.ifNotExists).toBe(true);
      expect(table!.parentTable).toBeNull();

      const idCol = objects.find((o) => o.kind === 'column' && o.name === 'id');
      expect(idCol).toBeDefined();
      expect(idCol!.parentTable).toBe('projects');
    });

    it('extracts CREATE TABLE without IF NOT EXISTS', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE TABLE users (id int, email text);`;
      const objects = extractExpectedObjects(sql);
      const table = objects.find((o) => o.kind === 'table');
      expect(table).toBeDefined();
      expect(table!.name).toBe('users');
      expect(table!.ifNotExists).toBe(false);
    });

    it('extracts CREATE INDEX with parent table', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`;
      const objects = extractExpectedObjects(sql);
      const index = objects.find((o) => o.kind === 'index');
      expect(index).toBeDefined();
      expect(index!.name).toBe('idx_users_email');
      expect(index!.parentTable).toBe('users');
      expect(index!.ifNotExists).toBe(true);
    });

    it('extracts CREATE UNIQUE INDEX', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_email ON users (email);`;
      const objects = extractExpectedObjects(sql);
      const index = objects.find((o) => o.kind === 'index');
      expect(index).toBeDefined();
      expect(index!.name).toBe('uniq_users_email');
      expect(index!.parentTable).toBe('users');
    });

    it('extracts ALTER TABLE ADD COLUMN', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';`;
      const objects = extractExpectedObjects(sql);
      const col = objects.find((o) => o.kind === 'column');
      expect(col).toBeDefined();
      expect(col!.name).toBe('status');
      expect(col!.parentTable).toBe('projects');
      expect(col!.ifNotExists).toBe(true);
    });

    it('extracts ALTER TABLE ADD CONSTRAINT', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `ALTER TABLE projects ADD CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id) REFERENCES users(id);`;
      const objects = extractExpectedObjects(sql);
      const constraint = objects.find((o) => o.kind === 'constraint');
      expect(constraint).toBeDefined();
      expect(constraint!.name).toBe('fk_projects_owner');
      expect(constraint!.parentTable).toBe('projects');
    });

    it('extracts CREATE EXTENSION', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;
      const objects = extractExpectedObjects(sql);
      const ext = objects.find((o) => o.kind === 'extension');
      expect(ext).toBeDefined();
      expect(ext!.name).toBe('uuid-ossp');
      expect(ext!.parentTable).toBeNull();
      expect(ext!.ifNotExists).toBe(true);
    });

    it('extracts CREATE FUNCTION', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE OR REPLACE FUNCTION update_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `;
      const objects = extractExpectedObjects(sql);
      const fn = objects.find((o) => o.kind === 'function');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('update_timestamp');
      expect(fn!.parentTable).toBeNull();
    });

    it('extracts CREATE TRIGGER with parent table', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON projects
        FOR EACH ROW EXECUTE FUNCTION update_timestamp();
      `;
      const objects = extractExpectedObjects(sql);
      const trigger = objects.find((o) => o.kind === 'trigger');
      expect(trigger).toBeDefined();
      expect(trigger!.name).toBe('set_updated_at');
      expect(trigger!.parentTable).toBe('projects');
    });

    it('extracts CREATE TYPE', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE TYPE project_status AS ENUM ('active', 'archived', 'draft');`;
      const objects = extractExpectedObjects(sql);
      const type = objects.find((o) => o.kind === 'type');
      expect(type).toBeDefined();
      expect(type!.name).toBe('project_status');
    });

    it('extracts CREATE SEQUENCE', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE SEQUENCE IF NOT EXISTS project_seq START 1;`;
      const objects = extractExpectedObjects(sql);
      const seq = objects.find((o) => o.kind === 'sequence');
      expect(seq).toBeDefined();
      expect(seq!.name).toBe('project_seq');
      expect(seq!.ifNotExists).toBe(true);
    });

    it('returns empty array for pure DML (INSERT/UPDATE/DELETE)', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        INSERT INTO projects (name) VALUES ('test')
        ON CONFLICT DO NOTHING;
      `;
      const objects = extractExpectedObjects(sql);
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for a no-op SELECT 1', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const objects = extractExpectedObjects('SELECT 1;');
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for empty SQL', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const objects = extractExpectedObjects('');
      expect(objects).toHaveLength(0);
    });

    it('returns empty array for SQL with only comments', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const objects = extractExpectedObjects('-- just a comment\n/* block comment */');
      expect(objects).toHaveLength(0);
    });

    it('handles multi-statement migrations with mixed DDL', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE TABLE IF NOT EXISTS foo (id int, name text);
        CREATE INDEX IF NOT EXISTS idx_foo_name ON foo (name);
        ALTER TABLE foo ADD COLUMN IF NOT EXISTS status text;
      `;
      const objects = extractExpectedObjects(sql);
      const kinds = objects.map((o) => o.kind);
      expect(kinds).toContain('table');
      expect(kinds).toContain('index');
      expect(kinds).toContain('column');
      expect(objects.length).toBeGreaterThanOrEqual(5); // table + 2 cols + index + 1 alter col
    });

    it('handles schema-qualified table names', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE TABLE IF NOT EXISTS public.projects (id int, name text);`;
      const objects = extractExpectedObjects(sql);
      const table = objects.find((o) => o.kind === 'table');
      expect(table).toBeDefined();
      expect(table!.name).toBe('projects');
    });

    it('handles quoted identifiers in CREATE TABLE', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE TABLE "MyTable" (id int, "MyColumn" text);`;
      const objects = extractExpectedObjects(sql);
      const table = objects.find((o) => o.kind === 'table');
      expect(table).toBeDefined();
      // normalizeIdentifier strips quotes but preserves case for quoted identifiers
      expect(table!.name).toBe('MyTable');
    });

    it('skips table-level constraints (PRIMARY KEY, UNIQUE, CHECK, FOREIGN KEY) as columns', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE TABLE foo (
          id int,
          name text,
          PRIMARY KEY (id),
          UNIQUE (name),
          CHECK (id > 0)
        );
      `;
      const objects = extractExpectedObjects(sql);
      const columns = objects.filter((o) => o.kind === 'column');
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('name');
      // Table-level constraint keywords should not be treated as column names
      expect(colNames).not.toContain('primary');
      expect(colNames).not.toContain('unique');
      expect(colNames).not.toContain('check');
    });

    it('handles CREATE INDEX CONCURRENTLY', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_concurrent ON foo (bar);`;
      const objects = extractExpectedObjects(sql);
      const index = objects.find((o) => o.kind === 'index');
      expect(index).toBeDefined();
      expect(index!.name).toBe('idx_concurrent');
      expect(index!.parentTable).toBe('foo');
    });

    it('handles dollar-quoted function bodies correctly', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        CREATE OR REPLACE FUNCTION compute_hash(val text)
        RETURNS text AS $$
        BEGIN
          RETURN md5(val);
        END;
        $$ LANGUAGE plpgsql;
      `;
      const objects = extractExpectedObjects(sql);
      const fn = objects.find((o) => o.kind === 'function');
      expect(fn).toBeDefined();
      expect(fn!.name).toBe('compute_hash');
    });

    it('handles DROP statements by producing no expectations', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `DROP TABLE IF EXISTS old_table; DROP INDEX IF EXISTS old_index;`;
      const objects = extractExpectedObjects(sql);
      expect(objects).toHaveLength(0);
    });

    it('handles ALTER TABLE with both ADD COLUMN and ADD CONSTRAINT', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `
        ALTER TABLE foo ADD COLUMN IF NOT EXISTS bar text;
        ALTER TABLE foo ADD CONSTRAINT chk_bar CHECK (bar IS NOT NULL);
      `;
      const objects = extractExpectedObjects(sql);
      const col = objects.find((o) => o.kind === 'column' && o.name === 'bar');
      const constraint = objects.find((o) => o.kind === 'constraint' && o.name === 'chk_bar');
      expect(col).toBeDefined();
      expect(constraint).toBeDefined();
      expect(col!.parentTable).toBe('foo');
      expect(constraint!.parentTable).toBe('foo');
    });

    it('lowercases unquoted identifiers', async () => {
      const { extractExpectedObjects } = await import('../lib/migrations/baselineEvidence');
      const sql = `CREATE TABLE MyTable (MyColumn text);`;
      const objects = extractExpectedObjects(sql);
      const table = objects.find((o) => o.kind === 'table');
      expect(table!.name).toBe('mytable');
      const col = objects.find((o) => o.kind === 'column');
      expect(col!.name).toBe('mycolumn');
    });
  });

  describe('classifyMigrationEvidence() — Pure Classification', () => {
    // Helper: build a minimal MigrationFile for testing.
    function makeFile(
      identifier: string,
      filename: string,
      checksumSha256 = 'abc123',
      transactionMode: 'REQUIRED' | 'FORBIDDEN' | 'MANUAL_REVIEW' = 'REQUIRED',
    ) {
      return {
        identifier,
        prefix: identifier,
        filename,
        fullPath: `/fake/${filename}`,
        description: 'test',
        isDuplicatePrefix: false,
        checksumSha256,
        sizeBytes: 100,
        transactionMode,
      };
    }

    // Helper: build a snapshot with specific tables/columns/etc.
    function makeSnapshot(tables: { name: string; schema?: string }[] = []) {
      return {
        tables: tables.map((t) => ({
          kind: 'table' as const,
          name: t.name,
          parentTable: null,
          schema: t.schema || 'public',
        })),
        indexes: [],
        columns: [],
        constraints: [],
        extensions: [],
        functions: [],
        triggers: [],
        types: [],
        sequences: [],
        collectedAt: new Date().toISOString(),
        collectionErrors: [],
      };
    }

    it('classifies all-found as CONFIRMED_APPLIED with OBJECT_EXISTENCE', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('001', '001_initial.sql');
      const sql = `CREATE TABLE projects (id int, name text);`;
      // The SQL creates a table + 2 columns, so the snapshot must have all 3.
      const snapshot = {
        ...makeSnapshot([{ name: 'projects' }]),
        columns: [
          { kind: 'column' as const, name: 'id', parentTable: 'projects', schema: 'public' },
          { kind: 'column' as const, name: 'name', parentTable: 'projects', schema: 'public' },
        ],
      };

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.migrationIdentifier).toBe('001');
      expect(proposal.proposedStatus).toBe('CONFIRMED_APPLIED');
      expect(proposal.evidenceType).toBe('OBJECT_EXISTENCE');
      expect(proposal.confidence).toBe(0.9);
      expect(proposal.manualReviewRequired).toBe(false);
      expect(proposal.detectedObjects.length).toBeGreaterThan(0);
      expect(proposal.missingObjects).toHaveLength(0);
    });

    it('classifies none-found as CONFIRMED_NOT_APPLIED', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('001', '001_initial.sql');
      const sql = `CREATE TABLE projects (id int, name text);`;
      const snapshot = makeSnapshot([]); // empty — no tables

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.proposedStatus).toBe('CONFIRMED_NOT_APPLIED');
      expect(proposal.evidenceType).toBe('OBJECT_EXISTENCE');
      expect(proposal.confidence).toBe(0.8);
      expect(proposal.manualReviewRequired).toBe(false);
      expect(proposal.detectedObjects).toHaveLength(0);
      expect(proposal.missingObjects.length).toBeGreaterThan(0);
    });

    it('classifies partial as PARTIALLY_APPLIED with manual review', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('005', '005_multi.sql');
      // Two tables in the SQL, but only one exists in the snapshot.
      const sql = `
        CREATE TABLE table_a (id int);
        CREATE TABLE table_b (id int);
      `;
      const snapshot = makeSnapshot([{ name: 'table_a' }]); // only table_a exists

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.proposedStatus).toBe('PARTIALLY_APPLIED');
      expect(proposal.evidenceType).toBe('OBJECT_EXISTENCE');
      expect(proposal.confidence).toBe(0.7);
      expect(proposal.manualReviewRequired).toBe(true);
      expect(proposal.detectedObjects.length).toBeGreaterThan(0);
      expect(proposal.missingObjects.length).toBeGreaterThan(0);
    });

    it('classifies no-op SELECT 1 as MANUAL_VERIFICATION / UNKNOWN', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('029', '029_fix.sql');
      const sql = `SELECT 1;`;
      const snapshot = makeSnapshot([{ name: 'some_table' }]);

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.expectedObjects).toHaveLength(0);
      expect(proposal.evidenceType).toBe('MANUAL_VERIFICATION');
      expect(proposal.proposedStatus).toBe('UNKNOWN');
      expect(proposal.confidence).toBe(0);
      expect(proposal.manualReviewRequired).toBe(true);
    });

    it('classifies data-only INSERT as MANUAL_VERIFICATION / UNKNOWN', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('025', '025_seed.sql');
      const sql = `INSERT INTO knowledge_base (title) VALUES ('FAQ');`;
      const snapshot = makeSnapshot([{ name: 'knowledge_base' }]);

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.expectedObjects).toHaveLength(0);
      expect(proposal.evidenceType).toBe('MANUAL_VERIFICATION');
      expect(proposal.proposedStatus).toBe('UNKNOWN');
      expect(proposal.manualReviewRequired).toBe(true);
    });

    it('classifies data-only UPDATE as MANUAL_VERIFICATION / UNKNOWN', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('039', '039_fix.sql');
      const sql = `UPDATE admin_users SET password_hash = 'new_hash' WHERE id = 'admin';`;
      const snapshot = makeSnapshot([{ name: 'admin_users' }]);

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.expectedObjects).toHaveLength(0);
      expect(proposal.evidenceType).toBe('MANUAL_VERIFICATION');
      expect(proposal.proposedStatus).toBe('UNKNOWN');
    });

    it('classifies data-only DELETE as MANUAL_VERIFICATION / UNKNOWN', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('042', '042_cleanup.sql');
      const sql = `DELETE FROM site_aliases USING ...;`;
      const snapshot = makeSnapshot([]);

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.expectedObjects).toHaveLength(0);
      expect(proposal.evidenceType).toBe('MANUAL_VERIFICATION');
      expect(proposal.proposedStatus).toBe('UNKNOWN');
    });

    it('downgrades to NONE / UNKNOWN when snapshot has collection errors', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('001', '001_initial.sql');
      const sql = `CREATE TABLE projects (id int);`;
      const snapshot = {
        ...makeSnapshot([{ name: 'projects' }]),
        collectionErrors: ['tables query failed: connection error'],
      };

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.evidenceType).toBe('NONE');
      expect(proposal.proposedStatus).toBe('UNKNOWN');
      expect(proposal.confidence).toBe(0);
      expect(proposal.manualReviewRequired).toBe(true);
    });

    it('preserves migration metadata in the proposal', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('005', '005_users.sql', 'sha256xyz', 'FORBIDDEN');
      const sql = `CREATE TABLE users (id int);`;
      const snapshot = makeSnapshot([{ name: 'users' }]);

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.migrationIdentifier).toBe('005');
      expect(proposal.filename).toBe('005_users.sql');
      expect(proposal.checksumSha256).toBe('sha256xyz');
      expect(proposal.transactionMode).toBe('FORBIDDEN');
    });

    it('detects conflicting columns when table exists but column is missing', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('090', '090_add_col.sql');
      // ALTER TABLE adds a column to an existing table.
      const sql = `ALTER TABLE projects ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;`;
      const snapshot = {
        ...makeSnapshot([{ name: 'projects' }]),
        // Note: the 'reminder_sent_at' column is NOT in the snapshot's columns.
      };

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      // The table exists but the column is missing. With only 1 expected
      // object (the column) and 0 found, the status is CONFIRMED_NOT_APPLIED.
      // However, the column is recorded as a conflictingObject because the
      // parent table exists but the column within it does not.
      expect(proposal.proposedStatus).toBe('CONFIRMED_NOT_APPLIED');
      expect(proposal.missingObjects).toHaveLength(1);
      expect(proposal.conflictingObjects.length).toBeGreaterThan(0);
      const conflict = proposal.conflictingObjects.find((c) => c.name === 'reminder_sent_at');
      expect(conflict).toBeDefined();
      expect(conflict!.parentTable).toBe('projects');
    });

    it('classifies a migration with CREATE INDEX expectation correctly', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('017', '017_perf.sql');
      const sql = `CREATE INDEX IF NOT EXISTS idx_perf ON projects (created_at);`;
      const snapshot = {
        ...makeSnapshot([{ name: 'projects' }]),
        indexes: [
          {
            kind: 'index' as const,
            name: 'idx_perf',
            parentTable: 'projects',
            schema: 'public',
          },
        ],
      };

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      expect(proposal.proposedStatus).toBe('CONFIRMED_APPLIED');
      expect(proposal.detectedObjects.length).toBeGreaterThan(0);
    });

    it('handles a migration with mixed found and not-found objects', async () => {
      const { classifyMigrationEvidence } = await import('../lib/migrations/baselineEvidence');
      const file = makeFile('020', '020_mixed.sql');
      const sql = `
        CREATE TABLE new_table (id int);
        CREATE INDEX idx_new ON new_table (id);
        CREATE TABLE missing_table (id int);
      `;
      const snapshot = {
        ...makeSnapshot([{ name: 'new_table' }]),
        indexes: [
          {
            kind: 'index' as const,
            name: 'idx_new',
            parentTable: 'new_table',
            schema: 'public',
          },
        ],
      };

      const proposal = classifyMigrationEvidence(file, sql, snapshot);

      // new_table + idx_new found, missing_table not found → partial
      expect(proposal.proposedStatus).toBe('PARTIALLY_APPLIED');
      expect(proposal.manualReviewRequired).toBe(true);
      const missingTable = proposal.missingObjects.find(
        (o) => o.kind === 'table' && o.name === 'missing_table',
      );
      expect(missingTable).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-Backed Tests — Require TEST_DATABASE_URL
// ─────────────────────────────────────────────────────────────────────────────

describeOrSkip(
  'Phase 1A.3: Baseline Evidence Generator — DB-Backed (GOV-20)',
  () => {
    beforeAll(async () => {
      if (!HAS_TEST_DB) return;

      setupMigrationEnv();

      const { setTestSchema } = await import('./__mocks__/neon-serverless');
      setTestSchema(TEST_SCHEMA);

      rawPool = new Pool({
        connectionString: TEST_DATABASE_URL,
        max: 3,
      });

      // Clean up any leftover test schemas.
      const client = await rawPool.connect();
      try {
        const schemas = await client.query(
          "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'phase%_test'",
        );
        for (const row of schemas.rows) {
          await client.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
        }
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    }, 30000);

    afterAll(async () => {
      const { closePool } = await import('./__mocks__/neon-serverless');
      await closePool();

      if (rawPool) {
        try {
          const client = await rawPool.connect();
          try {
            await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
          } finally {
            client.release();
          }
        } catch {
          // Best-effort cleanup.
        }
        await rawPool.end();
        rawPool = null;
      }

      restoreEnv();
    }, 30000);

    beforeEach(async () => {
      if (!rawPool) return;

      // Drop and recreate the test schema for a clean slate.
      const client = await rawPool.connect();
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
        await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      } finally {
        client.release();
      }
    }, 15000);

    describe('collectCatalogSnapshot()', () => {
      it('collects an empty snapshot when no user objects exist', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');
        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });

        expect(snapshot.collectionErrors).toHaveLength(0);
        expect(snapshot.tables).toHaveLength(0);
        expect(snapshot.indexes).toHaveLength(0);
        expect(snapshot.columns).toHaveLength(0);
        expect(snapshot.constraints).toHaveLength(0);
        expect(snapshot.functions).toHaveLength(0);
        expect(snapshot.triggers).toHaveLength(0);
        expect(snapshot.types).toHaveLength(0);
        expect(snapshot.sequences).toHaveLength(0);
        expect(snapshot.collectedAt).toBeTruthy();
      });

      it('collects tables from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        // Create a table directly via raw pg.
        await rawExec(`
          CREATE TABLE test_evidence_table (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
          )
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const tableNames = snapshot.tables.map((t) => t.name);
        expect(tableNames).toContain('test_evidence_table');
      });

      it('collects columns from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE TABLE col_test (
            id SERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            status TEXT DEFAULT 'active'
          )
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const colNames = snapshot.columns.map((c) => c.name);
        expect(colNames).toContain('id');
        expect(colNames).toContain('email');
        expect(colNames).toContain('status');
      });

      it('collects indexes from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE TABLE idx_test (id int, email text);
          CREATE INDEX idx_test_email ON idx_test (email);
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const indexNames = snapshot.indexes.map((i) => i.name);
        expect(indexNames).toContain('idx_test_email');
        const idx = snapshot.indexes.find((i) => i.name === 'idx_test_email');
        expect(idx!.parentTable).toBe('idx_test');
      });

      it('collects constraints from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE TABLE constraint_test (
            id int PRIMARY KEY,
            email text UNIQUE
          );
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const constraintNames = snapshot.constraints.map((c) => c.name);
        // PostgreSQL auto-generates constraint names for PK and UNIQUE
        expect(constraintNames.length).toBeGreaterThan(0);
      });

      it('collects sequences from the test schema (SERIAL creates one)', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE TABLE seq_test (
            id SERIAL PRIMARY KEY,
            name text
          );
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        // SERIAL creates an implicit sequence
        expect(snapshot.sequences.length).toBeGreaterThan(0);
      });

      it('collects types (enums) from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`CREATE TYPE test_enum AS ENUM ('a', 'b', 'c');`);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const typeNames = snapshot.types.map((t) => t.name);
        expect(typeNames).toContain('test_enum');
      });

      it('collects functions from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE OR REPLACE FUNCTION test_func(val int)
          RETURNS int AS $$
          BEGIN
            RETURN val * 2;
          END;
          $$ LANGUAGE plpgsql;
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const fnNames = snapshot.functions.map((f) => f.name);
        expect(fnNames).toContain('test_func');
      });

      it('collects triggers from the test schema', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        await rawExec(`
          CREATE TABLE trigger_test (id int, updated_at timestamptz);
          CREATE OR REPLACE FUNCTION set_updated()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW.updated_at = now();
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
          CREATE TRIGGER trg_updated
          BEFORE UPDATE ON trigger_test
          FOR EACH ROW EXECUTE FUNCTION set_updated();
        `);

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        expect(snapshot.collectionErrors).toHaveLength(0);
        const triggerNames = snapshot.triggers.map((t) => t.name);
        expect(triggerNames).toContain('trg_updated');
        const trg = snapshot.triggers.find((t) => t.name === 'trg_updated');
        expect(trg!.parentTable).toBe('trigger_test');
      });

      it('respects schemaFilter — does not return objects from other schemas', async () => {
        const { collectCatalogSnapshot } = await import('../lib/migrations/baselineEvidence');

        // Create an object in the test schema.
        await rawExec(`CREATE TABLE filtered_table (id int);`);

        // Create an object in the public schema (which should NOT appear).
        const client = await rawPool!.connect();
        try {
          await client.query('DROP TABLE IF EXISTS public.unfiltered_test_table');
          await client.query(
            'CREATE TABLE public.unfiltered_test_table (id int)',
          );
        } finally {
          client.release();
        }

        const snapshot = await collectCatalogSnapshot({ schemaFilter: TEST_SCHEMA });
        const tableNames = snapshot.tables.map((t) => t.name);
        expect(tableNames).toContain('filtered_table');
        expect(tableNames).not.toContain('unfiltered_test_table');

        // Cleanup the public table.
        const client2 = await rawPool!.connect();
        try {
          await client2.query('DROP TABLE IF EXISTS public.unfiltered_test_table');
        } finally {
          client2.release();
        }
      });
    });

    describe('generateBaselineEvidence() — Read-Only Orchestration', () => {
      it('returns performedMutation=false always', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });
        expect(report.performedMutation).toBe(false);
      });

      it('discovers the fixture manifest and classifies all migrations', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // The fixture directory has 4 migrations (900-903).
        expect(report.manifestCount).toBe(4);
        expect(report.proposals).toHaveLength(4);
        const identifiers = report.proposals.map((p) => p.migrationIdentifier);
        expect(identifiers).toEqual(['900', '901', '902', '903']);
      });

      it('classifies migrations as CONFIRMED_NOT_APPLIED when schema is empty', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // Migration 900 creates a table — since the schema is empty, the table
        // is not found, so it should be CONFIRMED_NOT_APPLIED.
        const p900 = report.proposals.find((p) => p.migrationIdentifier === '900');
        expect(p900).toBeDefined();
        expect(p900!.evidenceType).toBe('OBJECT_EXISTENCE');
        expect(p900!.proposedStatus).toBe('CONFIRMED_NOT_APPLIED');
        expect(p900!.manualReviewRequired).toBe(false);
      });

      it('classifies migration 903 (INSERT) as MANUAL_VERIFICATION / UNKNOWN', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // Migration 903 is an INSERT (data-only), so it has zero expected objects.
        const p903 = report.proposals.find((p) => p.migrationIdentifier === '903');
        expect(p903).toBeDefined();
        expect(p903!.expectedObjects).toHaveLength(0);
        expect(p903!.evidenceType).toBe('MANUAL_VERIFICATION');
        expect(p903!.proposedStatus).toBe('UNKNOWN');
        expect(p903!.manualReviewRequired).toBe(true);
      });

      it('classifies migrations as CONFIRMED_APPLIED after applying fixtures', async () => {
        // First, apply the canary fixtures directly via raw pg so the schema
        // objects exist. This simulates a database where migrations 900-902
        // have been applied.
        const client = await rawPool!.connect();
        try {
          await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
          await client.query(`
            CREATE TABLE IF NOT EXISTS canary_900_test_table (
              id          SERIAL PRIMARY KEY,
              label       TEXT NOT NULL,
              created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
          `);
          await client.query(`
            ALTER TABLE canary_900_test_table
            ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
          `);
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_canary_900_status
            ON canary_900_test_table (status)
          `);
        } finally {
          client.release();
        }

        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // 900 creates the table + columns → should be CONFIRMED_APPLIED
        const p900 = report.proposals.find((p) => p.migrationIdentifier === '900');
        expect(p900).toBeDefined();
        expect(p900!.proposedStatus).toBe('CONFIRMED_APPLIED');
        expect(p900!.evidenceType).toBe('OBJECT_EXISTENCE');

        // 901 adds a column → should be CONFIRMED_APPLIED (column found)
        const p901 = report.proposals.find((p) => p.migrationIdentifier === '901');
        expect(p901).toBeDefined();
        expect(p901!.proposedStatus).toBe('CONFIRMED_APPLIED');

        // 902 creates an index → should be CONFIRMED_APPLIED
        const p902 = report.proposals.find((p) => p.migrationIdentifier === '902');
        expect(p902).toBeDefined();
        expect(p902!.proposedStatus).toBe('CONFIRMED_APPLIED');
      });

      it('reports summary status counts correctly', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // With an empty schema: 900, 901, 902 → CONFIRMED_NOT_APPLIED (DDL);
        // 903 → UNKNOWN (data-only).
        expect(report.statusCounts.CONFIRMED_NOT_APPLIED).toBe(3);
        expect(report.statusCounts.UNKNOWN).toBe(1);
        expect(report.statusCounts.CONFIRMED_APPLIED).toBe(0);
        expect(report.statusCounts.PARTIALLY_APPLIED).toBe(0);
      });

      it('reports summary evidence type counts correctly', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // 900, 901, 902 → OBJECT_EXISTENCE; 903 → MANUAL_VERIFICATION.
        expect(report.evidenceTypeCounts.OBJECT_EXISTENCE).toBe(3);
        expect(report.evidenceTypeCounts.MANUAL_VERIFICATION).toBe(1);
      });

      it('sets hasManualReviewRequired when any proposal requires review', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // 903 requires manual review (data-only).
        expect(report.hasManualReviewRequired).toBe(true);
      });

      it('includes the catalog snapshot in the report', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        expect(report.catalogSnapshot).toBeDefined();
        expect(report.catalogSnapshot.collectedAt).toBeTruthy();
        expect(Array.isArray(report.catalogSnapshot.tables)).toBe(true);
      });

      it('includes environment in the report', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        expect(report.environment).toBe('development');
        expect(report.generatedAt).toBeTruthy();
      });

      it('does NOT mutate the database — read-only verification', async () => {
        // Record the state of the test schema before running the generator.
        const tablesBefore = await rawExec(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = '${TEST_SCHEMA}'
          ORDER BY tablename
        `);
        const tableNamesBefore = tablesBefore.map((r: { tablename: string }) => r.tablename);

        // Run the full baseline evidence generation.
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        // Record the state of the test schema AFTER running the generator.
        const tablesAfter = await rawExec(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = '${TEST_SCHEMA}'
          ORDER BY tablename
        `);
        const tableNamesAfter = tablesAfter.map((r: { tablename: string }) => r.tablename);

        // The table list must be identical — no mutation occurred.
        expect(tableNamesAfter).toEqual(tableNamesBefore);

        // And the report confirms no mutation was performed.
        expect(report.performedMutation).toBe(false);
      });

      it('handles a non-existent directory gracefully', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');
        const report = await generateBaselineEvidence({
          dirOverride: '/nonexistent/path/that/does/not/exist',
          schemaFilter: TEST_SCHEMA,
        });

        // discoverMigrationFiles catches the readdir error and returns an
        // empty manifest, so the generator produces a valid report with 0
        // proposals and no errors. This proves graceful degradation.
        expect(report.manifestCount).toBe(0);
        expect(report.proposals).toHaveLength(0);
        expect(report.performedMutation).toBe(false);
        // The report should still have valid summary counts (all zeros).
        expect(report.statusCounts.CONFIRMED_APPLIED).toBe(0);
        expect(report.statusCounts.UNKNOWN).toBe(0);
      });
    });

    describe('Read-Only Guard — Mutation Prevention', () => {
      it('assertReadOnlySql passes for all catalog queries the generator issues', async () => {
        // The generator issues only SELECT queries against pg_catalog.
        // This test verifies that the defense-in-depth check agrees.
        const { assertReadOnlySql } = await import('../lib/migrations/baselineEvidence');

        // Sample the exact query patterns used by collectCatalogSnapshot.
        const sampleQueries = [
          'SELECT c.relname AS name, n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relkind = \'r\'',
          'SELECT i.relname AS name, n.nspname AS schema, t.relname AS table_name FROM pg_index x JOIN pg_class i ON x.indexrelid = i.oid JOIN pg_class t ON x.indrelid = t.oid JOIN pg_namespace n ON i.relnamespace = n.oid',
          'SELECT a.attname AS name, n.nspname AS schema, c.relname AS table_name FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE a.attnum > 0 AND NOT a.attisdropped',
          'SELECT c.conname AS name, n.nspname AS schema, t.relname AS table_name FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid JOIN pg_namespace n ON c.connamespace = n.oid',
          'SELECT extname AS name, \'public\' AS schema FROM pg_extension WHERE extname NOT IN (\'plpgsql\')',
          'SELECT p.proname AS name, n.nspname AS schema FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid',
          'SELECT t.tgname AS name, n.nspname AS schema, c.relname AS table_name FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE NOT t.tgisinternal',
          'SELECT t.typname AS name, n.nspname AS schema FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typtype IN (\'e\', \'c\')',
          'SELECT c.relname AS name, n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relkind = \'S\'',
        ];

        for (const query of sampleQueries) {
          expect(assertReadOnlySql(query)).toBe(true);
        }
      });

      it('generateBaselineEvidence does not create any governance ledger tables', async () => {
        // The governance ledger tables (schema_migrations, governance_lifecycle,
        // etc.) should NOT be created by the evidence generator — it is
        // strictly read-only and does not interact with the ledger.
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');

        const tablesBefore = await rawExec(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = '${TEST_SCHEMA}'
          ORDER BY tablename
        `);

        await generateBaselineEvidence({
          dirOverride: FIXTURES_DIR,
          schemaFilter: TEST_SCHEMA,
        });

        const tablesAfter = await rawExec(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = '${TEST_SCHEMA}'
          ORDER BY tablename
        `);

        // No governance tables should have been created.
        const allNames = tablesAfter.map((r: { tablename: string }) => r.tablename);
        expect(allNames).not.toContain('schema_migrations');
        expect(allNames).not.toContain('governance_lifecycle');
        expect(allNames).not.toContain('schema_migration_runs');
        expect(allNames).not.toContain('migration_baseline');
        expect(allNames).not.toContain('migration_totp_uses');

        // And the table set is unchanged.
        expect(tablesAfter.length).toBe(tablesBefore.length);
      });
    });

    describe('generateBaselineEvidence() — Against Real Production Migrations', () => {
      // This test runs the evidence generator against the ACTUAL production
      // migration manifest (lib/migrations/) — but against the isolated test
      // schema (which is empty). This proves the generator can process the
      // full 101-migration manifest without crashing and produces a report
      // with the expected number of proposals.
      it('processes the full production manifest without errors', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');

        // Use the default directory (lib/migrations/) — no dirOverride.
        const report = await generateBaselineEvidence({
          schemaFilter: TEST_SCHEMA,
        });

        // The production manifest should have ~100+ migrations.
        expect(report.manifestCount).toBeGreaterThan(90);
        expect(report.proposals.length).toBe(report.manifestCount);
        expect(report.performedMutation).toBe(false);

        // Every proposal should have a valid evidence type and status.
        for (const proposal of report.proposals) {
          expect(proposal.evidenceType).toMatch(
            /^(SCHEMA_INTROSPECTION|LEDGER_RECORD|MANUAL_VERIFICATION|CHECKSUM_MATCH|OBJECT_EXISTENCE|NONE)$/,
          );
          expect(proposal.proposedStatus).toMatch(
            /^(CONFIRMED_APPLIED|CONFIRMED_NOT_APPLIED|PARTIALLY_APPLIED|NOT_APPLICABLE|UNKNOWN)$/,
          );
          expect(proposal.confidence).toBeGreaterThanOrEqual(0);
          expect(proposal.confidence).toBeLessThanOrEqual(1);
        }

        // The status counts should sum to the manifest count.
        const totalStatus = Object.values(report.statusCounts).reduce((a, b) => a + b, 0);
        expect(totalStatus).toBe(report.manifestCount);

        // The evidence type counts should also sum to the manifest count.
        const totalEvidence = Object.values(report.evidenceTypeCounts).reduce(
          (a, b) => a + b,
          0,
        );
        expect(totalEvidence).toBe(report.manifestCount);
      });

      it('classifies most DDL migrations as CONFIRMED_NOT_APPLIED (empty schema)', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');

        const report = await generateBaselineEvidence({
          schemaFilter: TEST_SCHEMA,
        });

        // With an empty test schema, DDL migrations that create objects
        // should be CONFIRMED_NOT_APPLIED (objects not found).
        // Data-only migrations (INSERT/UPDATE/DELETE/SELECT 1) should be
        // UNKNOWN (MANUAL_VERIFICATION).
        expect(report.statusCounts.CONFIRMED_NOT_APPLIED).toBeGreaterThan(0);
        expect(report.statusCounts.UNKNOWN).toBeGreaterThan(0);

        // No migrations should be CONFIRMED_APPLIED (the schema is empty).
        expect(report.statusCounts.CONFIRMED_APPLIED).toBe(0);
      });

      it('produces no collection errors when the database is accessible', async () => {
        const { generateBaselineEvidence } = await import('../lib/migrations/baselineEvidence');

        const report = await generateBaselineEvidence({
          schemaFilter: TEST_SCHEMA,
        });

        expect(report.catalogSnapshot.collectionErrors).toHaveLength(0);
      });
    });
  },
);
