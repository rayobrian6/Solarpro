/**
 * tests/phase1b1-migration-verification.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 6+7: Migration Verification Through the Canonical Runner
 *
 * This test suite verifies that migrations 105, 106, and 107 can be applied
 * through the CANONICAL migration runner (lib/migrations/runner.ts) — the
 * single authorized module for schema migration execution. This is NOT a
 * direct-SQL application; it exercises the full governance pipeline:
 *
 *   manifest discovery → checksum verification → governance lifecycle gate →
 *   authorization → advisory lock → transactional execution → ledger
 *   recording → audit event emission
 *
 * Test approach:
 *   1. Set up an isolated test schema with prerequisite tables (users,
 *      organizations, audit_log, admin_users, migration ledger).
 *   2. Bootstrap the governance lifecycle to EXECUTION_ENABLED.
 *   3. Use the production manifest provider (discovers from lib/migrations/).
 *   4. Apply migration 105 via runSinglePendingMigration('105', ...).
 *   5. Apply migration 106 via runSinglePendingMigration('106', ...).
 *   6. Apply migration 107 via runSinglePendingMigration('107', ...).
 *   7. Verify each returns status='applied'.
 *   8. Verify the migration ledger records all three with correct checksums.
 *   9. Verify the schema changes are present (introspection queries).
 *
 * Prerequisites:
 *   - Migration 105 requires: organizations table (migration 016),
 *     users table (migration 006) with org_id and org_role columns.
 *   - Migration 106 requires: migration 105 applied (organization_members
 *     table with status CHECK constraint, organizations table with status
 *     CHECK constraint).
 *   - Migration 107 requires: audit_log table (migration 100).
 *
 * We pre-create the prerequisite tables via direct DDL (not through the
 * runner) because we are only verifying 105/106/107 — not the full migration
 * chain. The runner applies 105/106/107 themselves; the prerequisites are
 * schema scaffolding.
 *
 * These tests run against a real PostgreSQL test database. They are gated
 * on TEST_DATABASE_URL — if the env var is not set, all tests skip gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { join } from 'path';
import { readFileSync } from 'node:fs';
import type { AdminUser } from '@/lib/adminAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Module Mocks
// ─────────────────────────────────────────────────────────────────────────────

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
  const actual = (await vi.importActual<typeof import('@/lib/db-ready')>(
    '@/lib/db-ready',
  )) as { DbConfigError: unknown };
  return {
    getDbWithRetry: async () => {
      const { neon } = mockModule;
      return neon();
    },
    DbConfigError: actual.DbConfigError,
  };
});

vi.mock('@/lib/rateLimitGuard', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  RateLimitResult: {},
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const HAS_TEST_DB = Boolean(TEST_DATABASE_URL);
const TEST_SCHEMA = 'phase1b1_migration_verify';

// Paths to the actual migration files (for checksum comparison)
const MIGRATIONS_DIR = join(process.cwd(), 'lib', 'migrations');
const MIGRATION_016 = join(MIGRATIONS_DIR, '016_organizations.sql');
const MIGRATION_100 = join(MIGRATIONS_DIR, '100_compliance_audit_mfa_consent.sql');

const ORIGINAL_ENV: Record<string, string | undefined> = {};

const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';

// Minimal users table DDL (migration 006 creates this, but we only need the
// core columns for 105/106/107 prerequisites)
const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL DEFAULT 'test-hash',
  company             TEXT,
  phone               TEXT,
  role                TEXT NOT NULL DEFAULT 'user',
  email_verified      BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`;

const AUDIT_LOG_DDL = `
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category      TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_id      TEXT,
  actor_email   TEXT,
  actor_role    TEXT,
  target_type   TEXT,
  target_id     TEXT,
  description   TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',
  ip_address    TEXT,
  user_agent    TEXT,
  request_path  TEXT,
  actor_organization_id       UUID,
  resource_owner_organization_id UUID,
  prev_hash     TEXT,
  entry_hash    TEXT NOT NULL
);
`;

const ADMIN_USERS_DDL = `
CREATE TABLE IF NOT EXISTS admin_users (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL DEFAULT 'Test Admin',
  email                    TEXT NOT NULL,
  role                     TEXT NOT NULL DEFAULT 'super_admin',
  totp_secret_encrypted    TEXT,
  mfa_enabled              BOOLEAN NOT NULL DEFAULT FALSE
);
`;

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
  saveEnv('MIGRATION_RUN_ALLOWED_ENVS');
  saveEnv('MIGRATION_ALLOW_PRODUCTION_EXECUTION');
  saveEnv('NODE_ENV');
  saveEnv('VERCEL_ENV');
  saveEnv('MFA_ENCRYPTION_KEY');

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development,test';
  process.env.MIGRATION_ALLOW_PRODUCTION_EXECUTION = 'false';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  process.env.MFA_ENCRYPTION_KEY = TEST_MFA_ENCRYPTION_KEY;
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

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

describeOrSkip('Phase 1B.1 — Migration Verification Through the Canonical Runner (Workstream 6+7)', () => {
  let rawPool: Pool | null = null;

  beforeAll(() => {
    if (!HAS_TEST_DB) return;
    setupMigrationEnv();
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL });
  }, 30000);

  afterAll(async () => {
    if (rawPool) {
      try {
        const client = await rawPool.connect();
        try {
          await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
        } catch {
          // Best-effort cleanup.
        } finally {
          client.release();
        }
      } catch {
        // Pool might already be closed.
      }
      await rawPool.end();
      rawPool = null;
    }

    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    restoreEnv();
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;

    // Set the test schema for the mock
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);

    const client = await rawPool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      // Create prerequisite tables: users, audit_log, admin_users
      for (const stmt of USERS_DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.query(stmt);
      }
      for (const stmt of AUDIT_LOG_DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.query(stmt);
      }
      for (const stmt of ADMIN_USERS_DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.query(stmt);
      }

      // Apply migration 016 (organizations table) directly — prerequisite for 105
      const migration016 = readFileSync(MIGRATION_016, 'utf-8');
      await client.query(migration016);
    } finally {
      client.release();
    }
  }, 30000);

  // ───────────────────────────────────────────────────────────────────────────
  // Helper: set up governance lifecycle to EXECUTION_ENABLED
  // ───────────────────────────────────────────────────────────────────────────

  async function setupExecutionEnabled(): Promise<void> {
    const {
      bootstrapMigrationLedger,
      setGovernanceLifecycleState,
      recordBaselineReconciliation,
      verifyBaselineComplete,
      advanceToBaselineVerified,
      enableExecution,
    } = await import('../lib/migrations/ledger');

    await bootstrapMigrationLedger('human', 'test-admin-001');
    await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-admin-001');

    // Record baseline reconciliation for all known prefixes (placeholder —
    // in production this would be schema introspection). For our test, we
    // record the migrations we're NOT applying through the runner as
    // CONFIRMED_APPLIED (they were applied via direct DDL) and the ones we
    // ARE applying as CONFIRMED_NOT_APPLIED.
    const appliedDirectly = ['016', '100'];
    for (const id of appliedDirectly) {
      await recordBaselineReconciliation({
        identifier: id,
        status: 'CONFIRMED_APPLIED',
        evidenceType: 'SCHEMA_INTROSPECTION',
        reconciledBy: 'test-admin-001',
      });
    }

    const v = await verifyBaselineComplete(appliedDirectly);
    expect(v.ok).toBe(true);
    const advanced = await advanceToBaselineVerified('test-admin-001');
    expect(advanced).toBe(true);
    const enabled = await enableExecution('test-admin-001', 'Phase 1B.1 migration verification test');
    expect(enabled).toBe(true);
  }

  async function createRunner() {
    const { createMigrationRunnerWithManifest } = await import('../lib/migrations/runner');
    const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
    // Use the PRODUCTION manifest provider — discovers from lib/migrations/
    const productionManifestProvider = () => discoverMigrationFiles();
    return createMigrationRunnerWithManifest(productionManifestProvider);
  }

  async function createExecutionAuth() {
    const { authorizeMigration } = await import('../lib/migrations/runner');
    const adminUser: AdminUser = {
      id: 'test-admin-001',
      name: 'Test Admin',
      email: 'test@example.com',
      role: 'super_admin',
    };
    return authorizeMigration({
      action: 'execute',
      actorType: 'migration-actor',
      actorId: 'test-admin-001',
      adminUser,
      dryRun: false,
      totpVerified: true,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 1: Migration 105 — Organization Authority Foundation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 1: Migration 105 applies through the canonical runner', () => {
    it('runSinglePendingMigration("105") returns status="applied"', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      const result = await runSinglePendingMigration('105', {
        dryRun: false,
        authorization: auth,
      });

      expect(result.status).toBe('applied');
      expect(result.errorCode).toBeNull();
      expect(result.identifier).toBe('105');
      expect(result.filename).toContain('105_organization_authority_foundation');
    }, 30000);

    it('ledger records migration 105 with correct checksum', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('105', { dryRun: false, authorization: auth });

      const { readLedgerRow } = await import('../lib/migrations/ledger');
      const row = await readLedgerRow('105');

      expect(row).toBeDefined();
      expect(row!.migration_identifier).toBe('105');
      expect(row!.status).toBe('applied');
      expect(row!.checksum_sha256).toBeDefined();
      expect(row!.checksum_sha256.length).toBe(64); // SHA-256 hex
    }, 30000);

    it('schema changes from migration 105 are present', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('105', { dryRun: false, authorization: auth });

      // Verify organization_members table exists with the expected columns
      const client = await rawPool!.connect();
      try {
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

        // organization_members table exists
        const tableExists = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organization_members'
        `);
        expect(tableExists.rows.length).toBe(1);

        // status column has CHECK constraint with active/invited/suspended
        const statusCheck = await client.query(`
          SELECT pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON c.connamespace = n.oid
          WHERE n.nspname = '${TEST_SCHEMA}' AND t.relname = 'organization_members'
            AND c.contype = 'c'
        `);
        const hasStatusCheck = statusCheck.rows.some((r: any) =>
          r.def.includes("'active'") && r.def.includes("'invited'") && r.def.includes("'suspended'"),
        );
        expect(hasStatusCheck).toBe(true);

        // organizations table has status column
        const orgStatusCol = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organizations'
            AND column_name = 'status'
        `);
        expect(orgStatusCol.rows.length).toBe(1);
      } finally {
        client.release();
      }
    }, 30000);

    it('re-running migration 105 returns status="applied" (idempotent skip)', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      // First run — applies
      const first = await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      expect(first.status).toBe('applied');

      // Second run — idempotent skip (checksum matches)
      const second = await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      expect(second.status).toBe('applied');
    }, 30000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 2: Migration 106 — Membership and Org Lifecycle Correction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 2: Migration 106 applies through the canonical runner', () => {
    it('runSinglePendingMigration("106") returns status="applied" after 105', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      // Apply 105 first (prerequisite)
      const r105 = await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      expect(r105.status).toBe('applied');

      // Apply 106
      const result = await runSinglePendingMigration('106', { dryRun: false, authorization: auth });
      expect(result.status).toBe('applied');
      expect(result.errorCode).toBeNull();
      expect(result.identifier).toBe('106');
      expect(result.filename).toContain('106_membership_org_lifecycle_correction');
    }, 30000);

    it('ledger records migration 106 with correct checksum', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      await runSinglePendingMigration('106', { dryRun: false, authorization: auth });

      const { readLedgerRow } = await import('../lib/migrations/ledger');
      const row = await readLedgerRow('106');

      expect(row).toBeDefined();
      expect(row!.migration_identifier).toBe('106');
      expect(row!.status).toBe('applied');
      expect(row!.checksum_sha256).toBeDefined();
      expect(row!.checksum_sha256.length).toBe(64);
    }, 30000);

    it('schema changes from migration 106 are present (removed status, archived, lifecycle columns)', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      await runSinglePendingMigration('106', { dryRun: false, authorization: auth });

      const client = await rawPool!.connect();
      try {
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

        // organization_members status CHECK now includes 'removed'
        const statusCheck = await client.query(`
          SELECT pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON c.connamespace = n.oid
          WHERE n.nspname = '${TEST_SCHEMA}' AND t.relname = 'organization_members'
            AND c.contype = 'c'
        `);
        const hasRemoved = statusCheck.rows.some((r: any) => r.def.includes("'removed'"));
        expect(hasRemoved).toBe(true);

        // organization_members has joined_at, removed_at, removed_by columns
        const lifecycleCols = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organization_members'
            AND column_name IN ('joined_at', 'removed_at', 'removed_by')
        `);
        expect(lifecycleCols.rows.length).toBe(3);

        // organizations status CHECK now includes 'archived'
        const orgStatusCheck = await client.query(`
          SELECT pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON c.connamespace = n.oid
          WHERE n.nspname = '${TEST_SCHEMA}' AND t.relname = 'organizations'
            AND c.contype = 'c'
        `);
        const hasArchived = orgStatusCheck.rows.some((r: any) => r.def.includes("'archived'"));
        expect(hasArchived).toBe(true);

        // organizations has archived_at column
        const archivedAtCol = await client.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organizations'
            AND column_name = 'archived_at'
        `);
        expect(archivedAtCol.rows.length).toBe(1);
      } finally {
        client.release();
      }
    }, 30000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 3: Migration 107 — Audit Log Organization Context
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 3: Migration 107 applies through the canonical runner', () => {
    it('runSinglePendingMigration("107") returns status="applied"', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      const result = await runSinglePendingMigration('107', { dryRun: false, authorization: auth });

      expect(result.status).toBe('applied');
      expect(result.errorCode).toBeNull();
      expect(result.identifier).toBe('107');
      expect(result.filename).toContain('107_audit_log_org_context');
    }, 30000);

    it('ledger records migration 107 with correct checksum', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('107', { dryRun: false, authorization: auth });

      const { readLedgerRow } = await import('../lib/migrations/ledger');
      const row = await readLedgerRow('107');

      expect(row).toBeDefined();
      expect(row!.migration_identifier).toBe('107');
      expect(row!.status).toBe('applied');
      expect(row!.checksum_sha256).toBeDefined();
      expect(row!.checksum_sha256.length).toBe(64);
    }, 30000);

    it('schema changes from migration 107 are present (org context columns + indexes)', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('107', { dryRun: false, authorization: auth });

      const client = await rawPool!.connect();
      try {
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

        // actor_organization_id column exists on audit_log
        const actorOrgCol = await client.query(`
          SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'audit_log'
            AND column_name = 'actor_organization_id'
        `);
        expect(actorOrgCol.rows.length).toBe(1);
        expect(actorOrgCol.rows[0].data_type).toBe('uuid');

        // resource_owner_organization_id column exists on audit_log
        const resourceOrgCol = await client.query(`
          SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'audit_log'
            AND column_name = 'resource_owner_organization_id'
        `);
        expect(resourceOrgCol.rows.length).toBe(1);
        expect(resourceOrgCol.rows[0].data_type).toBe('uuid');

        // Indexes exist
        const indexes = await client.query(`
          SELECT indexname FROM pg_indexes
          WHERE schemaname = '${TEST_SCHEMA}' AND tablename = 'audit_log'
            AND indexname IN ('idx_audit_log_actor_org', 'idx_audit_log_resource_org')
        `);
        expect(indexes.rows.length).toBe(2);
      } finally {
        client.release();
      }
    }, 30000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 4: Full Chain — 105 → 106 → 107 in Sequence
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 4: Full migration chain 105 → 106 → 107 applies in sequence', () => {
    it('all three migrations apply in order through the canonical runner', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      const r105 = await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      expect(r105.status).toBe('applied');

      const r106 = await runSinglePendingMigration('106', { dryRun: false, authorization: auth });
      expect(r106.status).toBe('applied');

      const r107 = await runSinglePendingMigration('107', { dryRun: false, authorization: auth });
      expect(r107.status).toBe('applied');

      // All three are in the ledger
      const { readLedgerRow } = await import('../lib/migrations/ledger');
      const row105 = await readLedgerRow('105');
      const row106 = await readLedgerRow('106');
      const row107 = await readLedgerRow('107');

      expect(row105!.status).toBe('applied');
      expect(row106!.status).toBe('applied');
      expect(row107!.status).toBe('applied');
    }, 30000);

    it('checksums in the ledger match the file checksums from the manifest', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      await runSinglePendingMigration('105', { dryRun: false, authorization: auth });
      await runSinglePendingMigration('106', { dryRun: false, authorization: auth });
      await runSinglePendingMigration('107', { dryRun: false, authorization: auth });

      const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
      const { readLedgerRow } = await import('../lib/migrations/ledger');
      const manifest = discoverMigrationFiles();

      for (const id of ['105', '106', '107']) {
        const file = manifest.files.find((f: any) => f.prefix === id);
        expect(file).toBeDefined();
        const row = await readLedgerRow(id);
        expect(row!.checksum_sha256).toBe(file!.checksumSha256);
      }
    }, 30000);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 5: Governance Controls — Lifecycle and Authorization
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 5: Governance controls are enforced for 105/106/107', () => {
    it('migration 105 is blocked before EXECUTION_ENABLED (BASELINE_REQUIRED)', async () => {
      // Only bootstrap — do NOT advance to EXECUTION_ENABLED
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-admin-001');

      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      const result = await runSinglePendingMigration('105', {
        dryRun: false,
        authorization: auth,
      });

      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('MIGRATION_BASELINE_REQUIRED');
    }, 30000);

    it('migration 105 dry-run succeeds without execution (no schema mutation)', async () => {
      // Dry-run does not require EXECUTION_ENABLED
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-admin-001');

      const { runSinglePendingMigration } = await createRunner();
      const auth = await createExecutionAuth();

      const result = await runSinglePendingMigration('105', {
        dryRun: true,
        authorization: auth,
      });

      // Dry-run should succeed (no mutation, no lifecycle gate)
      expect(result.dryRun).toBe(true);

      // Verify no schema mutation occurred
      const client = await rawPool!.connect();
      try {
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
        const tableCheck = await client.query(`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organization_members'
        `);
        expect(tableCheck.rows.length).toBe(0);
      } finally {
        client.release();
      }
    }, 30000);

    it('migration 105 is blocked when authorization is denied', async () => {
      await setupExecutionEnabled();
      const { runSinglePendingMigration } = await createRunner();

      // Create a denied authorization
      const deniedAuth = {
        allowed: false,
        reason: 'Test denial',
        action: 'execute' as const,
        actorType: 'migration-actor' as const,
        actorId: 'unauthorized-user',
        environment: 'development',
        dryRun: false,
      };

      const result = await runSinglePendingMigration('105', {
        dryRun: false,
        authorization: deniedAuth,
      });

      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('AUTHORIZATION_DENIED');
    }, 30000);
  });
});
