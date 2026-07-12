/**
 * tests/phase1b-organization-schema.test.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 2: Schema Migration and PostgreSQL Constraint Tests
 *
 * This test validates the migration 105_organization_authority_foundation.sql
 * against an isolated PostgreSQL test schema. It verifies:
 *
 *   1. All new tables and columns are created correctly
 *   2. CHECK constraints enforce the role and status vocabularies
 *   3. UNIQUE constraints prevent duplicate memberships
 *   4. The compatibility backfill mirrors existing users.org_id into
 *      organization_members
 *   5. Foreign key cascades work correctly (org/user deletion)
 *   6. The active_organization_context enforces one-active-org-per-user
 *   7. Indexes are created for common query patterns
 *   8. The updated_at trigger fires on membership changes
 *
 * These tests use the real PostgreSQL test database (NOT a mock) to validate
 * actual constraint behavior. They are gated on TEST_DATABASE_URL — if the
 * env var is not set, all tests skip gracefully.
 *
 * The production Neon serverless driver communicates via HTTP/WebSocket and
 * cannot connect to local PostgreSQL. We use the `pg` Pool directly for both
 * setup and assertions, and read the migration SQL from the file on disk.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b_org_schema_test';

// Path to the migration file under test.
const MIGRATION_FILE = join(process.cwd(), 'lib', 'migrations', '105_organization_authority_foundation.sql');
const MIGRATION_106_FILE = join(process.cwd(), 'lib', 'migrations', '106_membership_org_lifecycle_correction.sql');

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let pool: Pool | null = null;

/**
 * Execute SQL in the test schema.
 */
async function exec(sql: string): Promise<Record<string, unknown>[]> {
  if (!pool) return [];
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    const result = await client.query(sql);
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Execute a multi-statement SQL script in the test schema.
 * The pg client's query() can handle multiple statements in a single call
 * when the statements are separated by semicolons.
 */
async function execScript(sql: string): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
    await client.query(sql);
  } finally {
    client.release();
  }
}

/**
 * Prerequisite DDL: users table (simplified from migration 006).
 * Only includes columns needed by the migration 105 foreign keys and backfill.
 */
const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  company         TEXT,
  role            TEXT NOT NULL DEFAULT 'user',
  plan            TEXT NOT NULL DEFAULT 'starter',
  org_id          UUID,
  org_role        TEXT NOT NULL DEFAULT 'owner',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
`;

/**
 * Prerequisite DDL: organizations table (from migration 016).
 * This must match the existing schema so migration 105's ALTER TABLE
 * statements work correctly.
 */
const ORGANIZATIONS_DDL = `
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan          TEXT NOT NULL DEFAULT 'contractor',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_id);
`;

/**
 * Prerequisite DDL: org_invites table (from migration 016).
 */
const ORG_INVITES_DDL = `
CREATE TABLE IF NOT EXISTS org_invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days'
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(invited_email);
CREATE INDEX IF NOT EXISTS idx_org_invites_token ON org_invites(token);
`;

/**
 * Read the migration SQL from disk.
 */
function readMigration(): string {
  return readFileSync(MIGRATION_FILE, 'utf-8');
}

/**
 * Read the Phase 1B.1 lifecycle correction migration (106) from disk.
 */
function readMigration106(): string {
  return readFileSync(MIGRATION_106_FILE, 'utf-8');
}

/**
 * Set up a fresh test schema with prerequisite tables, then apply the migration.
 */
async function setupSchema(): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    // Drop and recreate the test schema.
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Install gen_random_uuid() in the schema (PostgreSQL 15 has it in pgcrypto
    // by default, but ensure it's available).
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // Create prerequisite tables.
    await client.query(USERS_DDL);
    await client.query(ORGANIZATIONS_DDL);
    await client.query(ORG_INVITES_DDL);
  } finally {
    client.release();
  }
}

/**
 * Apply the migration SQL to the test schema.
 * Applies migration 105 followed by the Phase 1B.1 lifecycle correction
 * migration 106, so the schema reflects the corrected final state.
 */
async function applyMigration(): Promise<void> {
  const migrationSql = readMigration();
  await execScript(migrationSql);
  const migration106Sql = readMigration106();
  await execScript(migration106Sql);
}

/**
 * Insert test data: users and an organization.
 */
async function insertTestData(): Promise<{ userId: string; memberId: string; orgId: string }> {
  const client = await pool!.connect();
  try {
    await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

    // Create an owner user
    const ownerResult = await client.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Test Owner', 'owner@test.com', 'dummyhash')
      RETURNING id
    `);
    const userId = ownerResult.rows[0].id;

    // Create a member user (pre-existing org_id on users table for backfill test)
    const memberResult = await client.query(`
      INSERT INTO users (name, email, password_hash)
      VALUES ('Test Member', 'member@test.com', 'dummyhash')
      RETURNING id
    `);
    const memberId = memberResult.rows[0].id;

    // Create an organization owned by the owner
    const orgResult = await client.query(`
      INSERT INTO organizations (name, owner_id)
      VALUES ('Test Org', $1)
      RETURNING id
    `, [userId]);
    const orgId = orgResult.rows[0].id;

    // Set org_id on both users to simulate the legacy 1:1 model
    await client.query(`UPDATE users SET org_id = $1, org_role = 'owner' WHERE id = $2`, [orgId, userId]);
    await client.query(`UPDATE users SET org_id = $1, org_role = 'member' WHERE id = $2`, [orgId, memberId]);

    return { userId, memberId, orgId };
  } finally {
    client.release();
  }
}

describeOrSkip('Phase 1B: Organization Authority Schema (Migration 105)', () => {

  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    pool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 3,
    });
  });

  afterAll(async () => {
    if (pool) {
      // Clean up the test schema.
      try {
        const client = await pool.connect();
        await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
        client.release();
      } catch {
        // Best-effort cleanup.
      }
      await pool.end();
      pool = null;
    }
  });

  beforeEach(async () => {
    if (!HAS_TEST_DB) return;
    await setupSchema();
  });

  // ── Table Creation Tests ──────────────────────────────────────────

  describe('Table creation', () => {
    it('should create the organization_members table', async () => {
      await applyMigration();
      const rows = await exec(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organization_members'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].table_name).toBe('organization_members');
    });

    it('should create the active_organization_context table', async () => {
      await applyMigration();
      const rows = await exec(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'active_organization_context'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].table_name).toBe('active_organization_context');
    });

    it('should add status, suspended_at, deleted_at, archived_at, slug, settings columns to organizations', async () => {
      await applyMigration();
      const rows = await exec(`
        SELECT column_name, data_type, column_default
        FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}' AND table_name = 'organizations'
        ORDER BY ordinal_position
      `);
      const colNames = rows.map(r => r.column_name);
      expect(colNames).toContain('status');
      expect(colNames).toContain('suspended_at');
      expect(colNames).toContain('deleted_at');
      expect(colNames).toContain('archived_at');
      expect(colNames).toContain('slug');
      expect(colNames).toContain('settings');

      const statusCol = rows.find(r => r.column_name === 'status');
      expect(statusCol?.data_type).toBe('text');
      expect(statusCol?.column_default).toContain('active');
    });
  });

  // ── Constraint Tests ──────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it('should enforce organization_members role vocabulary (owner, admin, member, viewer)', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // Valid roles should succeed
      for (const role of ['owner', 'admin', 'member', 'viewer']) {
        await exec(`DELETE FROM organization_members WHERE user_id = '${userId}' AND organization_id = '${orgId}'`);
        await exec(`
          INSERT INTO organization_members (organization_id, user_id, role)
          VALUES ('${orgId}', '${userId}', '${role}')
        `);
      }

      // Invalid role should fail
      await exec(`DELETE FROM organization_members WHERE user_id = '${userId}' AND organization_id = '${orgId}'`);
      await expect(exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'superadmin')
      `)).rejects.toThrow();
    });

    it('should enforce organization_members status vocabulary (active, invited, suspended, removed)', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // Valid statuses should succeed (including 'removed' added by migration 106)
      for (const status of ['active', 'invited', 'suspended', 'removed']) {
        await exec(`DELETE FROM organization_members WHERE user_id = '${userId}' AND organization_id = '${orgId}'`);
        await exec(`
          INSERT INTO organization_members (organization_id, user_id, role, status)
          VALUES ('${orgId}', '${userId}', 'member', '${status}')
        `);
      }

      // Invalid status should fail
      await exec(`DELETE FROM organization_members WHERE user_id = '${userId}' AND organization_id = '${orgId}'`);
      await expect(exec(`
        INSERT INTO organization_members (organization_id, user_id, role, status)
        VALUES ('${orgId}', '${userId}', 'member', 'banned')
      `)).rejects.toThrow();
    });

    it('should enforce organizations status vocabulary (active, suspended, deleted, archived)', async () => {
      await applyMigration();
      const { userId } = await insertTestData();

      // Create a new org to test status changes
      const orgRows = await exec(`
        INSERT INTO organizations (name, owner_id)
        VALUES ('Status Test Org', '${userId}')
        RETURNING id
      `);
      const orgId = orgRows[0].id;

      // Valid statuses (including 'archived' added by migration 106)
      await exec(`UPDATE organizations SET status = 'suspended', suspended_at = now() WHERE id = '${orgId}'`);
      await exec(`UPDATE organizations SET status = 'active', suspended_at = NULL WHERE id = '${orgId}'`);
      await exec(`UPDATE organizations SET status = 'deleted', deleted_at = now() WHERE id = '${orgId}'`);
      await exec(`UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`);

      // Invalid status should fail
      await expect(exec(`UPDATE organizations SET status = 'banned' WHERE id = '${orgId}'`)).rejects.toThrow();
    });

    it('should enforce active_organization_context set_by vocabulary', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      for (const setBy of ['user', 'system', 'default']) {
        await exec(`DELETE FROM active_organization_context WHERE user_id = '${userId}'`);
        await exec(`
          INSERT INTO active_organization_context (user_id, organization_id, set_by)
          VALUES ('${userId}', '${orgId}', '${setBy}')
        `);
      }

      await exec(`DELETE FROM active_organization_context WHERE user_id = '${userId}'`);
      await expect(exec(`
        INSERT INTO active_organization_context (user_id, organization_id, set_by)
        VALUES ('${userId}', '${orgId}', 'automatic')
      `)).rejects.toThrow();
    });
  });

  // ── Unique Constraint Tests ───────────────────────────────────────

  describe('UNIQUE constraints', () => {
    it('should prevent duplicate organization_members (same org + user)', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // First insert succeeds
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'admin')
      `);

      // Second insert with same org+user fails (UNIQUE violation)
      await expect(exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'member')
      `)).rejects.toThrow();
    });

    it('should allow a user to belong to multiple organizations', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // Create a second org
      const org2Rows = await exec(`
        INSERT INTO organizations (name, owner_id)
        VALUES ('Second Org', '${userId}')
        RETURNING id
      `);
      const org2Id = org2Rows[0].id;

      // Membership in first org
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'member')
      `);

      // Membership in second org — should succeed (different org)
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${org2Id}', '${userId}', 'owner')
      `);

      const memberships = await exec(`
        SELECT organization_id, role FROM organization_members
        WHERE user_id = '${userId}' ORDER BY organization_id
      `);
      expect(memberships.length).toBe(2);
    });

    it('should enforce one active_organization_context per user', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // Create a second org
      const org2Rows = await exec(`
        INSERT INTO organizations (name, owner_id)
        VALUES ('Second Org', '${userId}')
        RETURNING id
      `);
      const org2Id = org2Rows[0].id;

      // First active org context
      await exec(`
        INSERT INTO active_organization_context (user_id, organization_id)
        VALUES ('${userId}', '${orgId}')
      `);

      // Second active org context for same user fails
      await expect(exec(`
        INSERT INTO active_organization_context (user_id, organization_id)
        VALUES ('${userId}', '${org2Id}')
      `)).rejects.toThrow();
    });

    it('should enforce unique slug on organizations (when non-null)', async () => {
      await applyMigration();
      const { userId } = await insertTestData();

      const org1Rows = await exec(`
        INSERT INTO organizations (name, owner_id, slug)
        VALUES ('Slug Test 1', '${userId}', 'my-company')
        RETURNING id
      `);

      // Duplicate slug should fail
      await expect(exec(`
        INSERT INTO organizations (name, owner_id, slug)
        VALUES ('Slug Test 2', '${userId}', 'my-company')
      `)).rejects.toThrow();

      // Null slugs are allowed (multiple nulls OK)
      await exec(`
        INSERT INTO organizations (name, owner_id, slug)
        VALUES ('No Slug Org 1', '${userId}', NULL)
      `);
      await exec(`
        INSERT INTO organizations (name, owner_id, slug)
        VALUES ('No Slug Org 2', '${userId}', NULL)
      `);
    });
  });

  // ── Backfill Tests ────────────────────────────────────────────────

  describe('Compatibility backfill', () => {
    it('should mirror existing users.org_id memberships into organization_members', async () => {
      const { userId, memberId, orgId } = await insertTestData();

      // Apply migration (which includes the backfill INSERT)
      await applyMigration();

      // Check that the owner was backfilled
      const ownerMemberships = await exec(`
        SELECT role, status FROM organization_members
        WHERE user_id = '${userId}' AND organization_id = '${orgId}'
      `);
      expect(ownerMemberships.length).toBe(1);
      expect(ownerMemberships[0].role).toBe('owner');
      expect(ownerMemberships[0].status).toBe('active');

      // Check that the member was backfilled
      const memberMemberships = await exec(`
        SELECT role, status FROM organization_members
        WHERE user_id = '${memberId}' AND organization_id = '${orgId}'
      `);
      expect(memberMemberships.length).toBe(1);
      expect(memberMemberships[0].role).toBe('member');
      expect(memberMemberships[0].status).toBe('active');
    });

    it('should be idempotent (running migration twice does not duplicate memberships)', async () => {
      const { userId, orgId } = await insertTestData();
      await applyMigration();

      // Run the backfill INSERT again
      const backfillSql = `
        INSERT INTO organization_members (organization_id, user_id, role, status, accepted_at, created_at)
        SELECT u.org_id, u.id,
               CASE WHEN u.org_role = 'owner' THEN 'owner' ELSE 'member' END,
               'active', now(), COALESCE(o.created_at, now())
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        WHERE u.org_id IS NOT NULL
        ON CONFLICT (organization_id, user_id) DO NOTHING;
      `;
      await execScript(backfillSql);

      // Should still have exactly one membership for this user+org
      const memberships = await exec(`
        SELECT COUNT(*)::int as cnt FROM organization_members
        WHERE user_id = '${userId}' AND organization_id = '${orgId}'
      `);
      expect(memberships[0].cnt).toBe(1);
    });

    it('should not backfill users with null org_id', async () => {
      const { userId } = await insertTestData();

      // Create a user with no org
      await exec(`
        INSERT INTO users (name, email, password_hash)
        VALUES ('No Org User', 'noorg@test.com', 'dummyhash')
      `);

      await applyMigration();

      // The no-org user should have no memberships
      const noOrgMemberships = await exec(`
        SELECT COUNT(*)::int as cnt FROM organization_members
        WHERE user_id = (SELECT id FROM users WHERE email = 'noorg@test.com')
      `);
      expect(noOrgMemberships[0].cnt).toBe(0);
    });
  });

  // ── Foreign Key Cascade Tests ─────────────────────────────────────

  describe('Foreign key cascades', () => {
    it('should cascade delete organization_members when org is deleted', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // Add an explicit membership
      await exec(`DELETE FROM organization_members WHERE organization_id = '${orgId}'`);
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'admin')
      `);

      // Delete the org
      await exec(`DELETE FROM organizations WHERE id = '${orgId}'`);

      // Membership should be gone
      const memberships = await exec(`
        SELECT COUNT(*)::int as cnt FROM organization_members
        WHERE organization_id = '${orgId}'
      `);
      expect(memberships[0].cnt).toBe(0);
    });

    it('should cascade delete organization_members when user is deleted', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      // The owner_id FK on organizations prevents deleting the owner directly.
      // Create a non-owner member first.
      const memberRows = await exec(`
        INSERT INTO users (name, email, password_hash, org_id, org_role)
        VALUES ('Cascade Test User', 'cascade@test.com', 'dummyhash', '${orgId}', 'member')
        RETURNING id
      `);
      const cascadeUserId = memberRows[0].id;

      await exec(`DELETE FROM organization_members WHERE user_id = '${cascadeUserId}'`);
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${cascadeUserId}', 'member')
      `);

      // Delete the user
      await exec(`DELETE FROM users WHERE id = '${cascadeUserId}'`);

      // Membership should be gone
      const memberships = await exec(`
        SELECT COUNT(*)::int as cnt FROM organization_members
        WHERE user_id = '${cascadeUserId}'
      `);
      expect(memberships[0].cnt).toBe(0);
    });

    it('should cascade delete active_organization_context when user is deleted', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      await exec(`
        INSERT INTO active_organization_context (user_id, organization_id)
        VALUES ('${userId}', '${orgId}')
      `);

      // Need to handle the organizations.owner_id FK: set owner to a different user first
      const newOwnerRows = await exec(`
        INSERT INTO users (name, email, password_hash)
        VALUES ('New Owner', 'newowner@test.com', 'dummyhash')
        RETURNING id
      `);
      await exec(`UPDATE organizations SET owner_id = '${newOwnerRows[0].id}' WHERE id = '${orgId}'`);

      await exec(`DELETE FROM users WHERE id = '${userId}'`);

      const contexts = await exec(`
        SELECT COUNT(*)::int as cnt FROM active_organization_context
        WHERE user_id = '${userId}'
      `);
      expect(contexts[0].cnt).toBe(0);
    });
  });

  // ── Trigger Tests ─────────────────────────────────────────────────

  describe('Triggers', () => {
    it('should update updated_at on organization_members changes', async () => {
      await applyMigration();
      const { userId, orgId } = await insertTestData();

      await exec(`DELETE FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${userId}'`);
      await exec(`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES ('${orgId}', '${userId}', 'member')
      `);

      // Get the initial updated_at
      const before = await exec(`
        SELECT updated_at FROM organization_members
        WHERE organization_id = '${orgId}' AND user_id = '${userId}'
      `);
      expect(before.length).toBe(1);
      const beforeTs = new Date(before[0].updated_at as string).getTime();

      // Wait a moment to ensure timestamp differs
      await new Promise(r => setTimeout(r, 50));

      // Update the role
      await exec(`
        UPDATE organization_members SET role = 'admin'
        WHERE organization_id = '${orgId}' AND user_id = '${userId}'
      `);

      // Check updated_at changed
      const after = await exec(`
        SELECT updated_at, role FROM organization_members
        WHERE organization_id = '${orgId}' AND user_id = '${userId}'
      `);
      expect(after.length).toBe(1);
      expect(after[0].role).toBe('admin');
      const afterTs = new Date(after[0].updated_at as string).getTime();
      expect(afterTs).toBeGreaterThan(beforeTs);
    });
  });

  // ── Index Verification Tests ──────────────────────────────────────

  describe('Indexes', () => {
    it('should create all required indexes', async () => {
      await applyMigration();

      const indexes = await exec(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}'
        AND tablename IN ('organization_members', 'active_organization_context', 'organizations')
        ORDER BY indexname
      `);
      const indexNames = indexes.map(r => String(r.indexname));

      // organization_members indexes
      expect(indexNames).toContain('idx_organization_members_org');
      expect(indexNames).toContain('idx_organization_members_user');
      expect(indexNames).toContain('idx_organization_members_org_owner');
      expect(indexNames).toContain('idx_organization_members_org_admin');
      expect(indexNames).toContain('idx_organization_members_org_invited');

      // active_organization_context indexes
      expect(indexNames).toContain('idx_active_organization_context_user');

      // organizations slug index
      expect(indexNames).toContain('idx_organizations_slug');

      // Unique constraint indexes
      expect(indexNames.some(n => n.includes('organization_members') && n.includes('org_user'))).toBe(true);
      expect(indexNames.some(n => n.includes('active_organization_context') && n.includes('user'))).toBe(true);
    });
  });

  // ── Idempotency Tests ─────────────────────────────────────────────

  describe('Idempotency', () => {
    it('should be safe to apply the migration twice', async () => {
      await applyMigration();

      // Applying again should not error (IF NOT EXISTS / IF EXISTS guards)
      await expect(applyMigration()).resolves.not.toThrow();
    });
  });

  // ── Migration File Validation ─────────────────────────────────────

  describe('Migration file validation', () => {
    it('should read the migration file from the expected path', () => {
      const content = readMigration();
      expect(content.length).toBeGreaterThan(1000);
      expect(content).toContain('organization_members');
      expect(content).toContain('active_organization_context');
    });

    it('should not contain transaction-incompatible statements', () => {
      const content = readMigration();
      // No CONCURRENTLY, no VACUUM, no CREATE/DROP DATABASE
      expect(content).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
      expect(content).not.toMatch(/\bREINDEX\b/i);
      expect(content).not.toMatch(/\bVACUUM\b/i);
      expect(content).not.toMatch(/CREATE\s+DATABASE/i);
      expect(content).not.toMatch(/DROP\s+DATABASE/i);
    });

    it('should retain users.org_id and users.org_role (not drop them)', () => {
      const content = readMigration();
      expect(content).not.toMatch(/DROP\s+COLUMN.*org_id/i);
      expect(content).not.toMatch(/DROP\s+COLUMN.*org_role/i);
    });
  });
});
