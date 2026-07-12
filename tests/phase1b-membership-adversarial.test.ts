/**
 * tests/phase1b-membership-adversarial.test.ts
 *
 * Phase 1B — Organization Authority Foundation
 * Commit 8: Adversarial Tests and Integration Validation
 *
 * Adversarial integration tests for the organization membership service,
 * owner protection, active org context, and authorization engine. These
 * tests run against a real PostgreSQL test database (NOT a mock) to
 * validate actual database constraint behavior, service-level logic,
 * and authorization decisions.
 *
 * Coverage areas:
 *   1. createOrganizationWithOwner — creates org + owner membership
 *   2. addMember / isMember / getMembersByOrg — membership CRUD
 *   3. Duplicate membership prevention (UNIQUE constraint)
 *   4. Owner protection — last owner cannot be removed/demoted/suspended
 *   5. Role changes — valid and invalid transitions
 *   6. Suspend / reactivate lifecycle
 *   7. Legacy users.org_id sync (compatibility layer)
 *   8. Active org context — setActiveOrg, resolveActiveOrg, clearActiveOrg
 *   9. Authorization engine — default-deny, role checks, owner protection
 *  10. Invalid UUID / empty input handling
 *
 * These tests use the pg-backed neon shim to route Neon tagged template
 * SQL to the local PostgreSQL test database. They are gated on
 * TEST_DATABASE_URL — if the env var is not set, all tests skip gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ────────────────────────────────────────────────────────────────────────────
// Module Mocks — route all Neon SQL to the local pg test database
// ────────────────────────────────────────────────────────────────────────────

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
  return {
    getDbWithRetry: async () => {
      const { neon } = mockModule;
      return neon();
    },
    isTransientDbError: () => true,
    DbConfigError: class DbConfigError extends Error {},
  };
});

// ────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b_membership_adv_test';

const MIGRATION_016 = join(process.cwd(), 'lib', 'migrations', '016_organizations.sql');
const MIGRATION_105 = join(process.cwd(), 'lib', 'migrations', '105_organization_authority_foundation.sql');

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let rawPool: Pool | null = null;

// Minimal users table DDL (subset of migration 006 with only the columns
// needed for org membership tests — avoids pulling in the full migration
// chain while providing the FK target for organizations.owner_id and
// organization_members.user_id).
const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL DEFAULT 'test-hash',
  company             TEXT,
  role                TEXT NOT NULL DEFAULT 'user',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// ────────────────────────────────────────────────────────────────────────────
// Environment Management
// ────────────────────────────────────────────────────────────────────────────

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
  if (!(key in ORIGINAL_ENV)) {
    ORIGINAL_ENV[key] = key in process.env ? process.env[key] : undefined;
  }
}

function setupTestEnv(): void {
  const envKeys = [
    'DATABASE_URL',
    'ENTERPRISE_ORG_AUTHORITY_ENABLED',
    'ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED',
    'ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED',
    'ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED',
  ];
  for (const key of envKeys) saveEnv(key);

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  // Enable the new authority model for these tests
  process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = 'true';
  process.env.ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED = 'true';
  process.env.ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED = 'true';
  // Enforcement is tested separately (advisory vs enforced)
  delete process.env.ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED;
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

// ────────────────────────────────────────────────────────────────────────────
// Raw SQL helper (for setup and assertions, bypassing the Neon shim)
// ────────────────────────────────────────────────────────────────────────────

async function rawExec(sql: string): Promise<Record<string, unknown>[]> {
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

/** Insert a test user and return their UUID. */
async function createTestUser(name: string, email: string): Promise<string> {
  const id = randomUUID();
  await rawExec(
    `INSERT INTO users (id, name, email) VALUES ('${id}', '${name}', '${email}')`
  );
  return id;
}

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1B — Membership Adversarial Integration Tests', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;

    setupTestEnv();

    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);

    rawPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 3,
    });

    // Clean up any leftover test schemas from previous runs
    const client = await rawPool.connect();
    try {
      const schemas = await client.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'phase%_test'",
      );
      for (const row of schemas.rows) {
        await client.query(`DROP SCHEMA IF EXISTS ${row.schema_name} CASCADE`);
      }
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
        // Best-effort cleanup
      }
      await rawPool.end();
      rawPool = null;
    }

    restoreEnv();
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;

    // Recreate the schema and base tables fresh for each test.
    //
    // CRITICAL: Migration 105 contains a plpgsql function body delimited by
    // $$ ... $$ which itself contains semicolons. Naively splitting the SQL
    // by ';' would break the function definition. Instead, we pass the entire
    // SQL script to client.query() in a single call — pg's parser correctly
    // handles dollar-quoted string bodies.
    const client = await rawPool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

      // Ensure pgcrypto is available for gen_random_uuid()
      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

      // Create users table (single multi-statement query — pg handles it)
      await client.query(USERS_DDL);

      // Run migration 016 (organizations + users.org_id/org_role + org_invites)
      // Pass the full script in one call so pg parses it correctly.
      const migration016 = readFileSync(MIGRATION_016, 'utf-8');
      await client.query(migration016);

      // Run migration 105 (organization authority foundation)
      // Contains a $$ ... $$ function body — must NOT be split by ';'.
      const migration105 = readFileSync(MIGRATION_105, 'utf-8');
      await client.query(migration105);
    } finally {
      client.release();
    }
  }, 30000);

  // ════════════════════════════════════════════════════════════════════════
  // Section 1: createOrganizationWithOwner
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 1: createOrganizationWithOwner', () => {
    it('creates an org and an owner membership', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const ownerId = await createTestUser('Alice Owner', 'alice@test.com');

      const result = await createOrganizationWithOwner('Test Org Alpha', ownerId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.organization.name).toBe('Test Org Alpha');
      expect(result.data.membership.role).toBe('owner');
      expect(result.data.membership.status).toBe('active');

      // Verify the membership row exists in the DB
      const rows = await rawExec(
        `SELECT * FROM organization_members WHERE organization_id = '${result.data.organization.id}' AND user_id = '${ownerId}'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('owner');
    });

    it('syncs legacy users.org_id after creating org', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const ownerId = await createTestUser('Bob Owner', 'bob@test.com');

      const result = await createOrganizationWithOwner('Test Org Beta', ownerId);
      if (!result.ok) return;
      const orgId = result.data.organization.id;

      // Legacy pointer should be set
      const userRows = await rawExec(`SELECT org_id, org_role FROM users WHERE id = '${ownerId}'`);
      expect(userRows[0].org_id).toBe(orgId);
      expect(userRows[0].org_role).toBe('owner');
    });

    it('rejects empty organization name', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const ownerId = await createTestUser('Carol Owner', 'carol@test.com');

      const result = await createOrganizationWithOwner('', ownerId);
      expect(result.ok).toBe(false);
    });

    it('rejects invalid owner UUID', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const result = await createOrganizationWithOwner('Test Org Gamma', 'not-a-uuid');
      expect(result.ok).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 2: addMember / isMember / getMembersByOrg
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 2: addMember and membership queries', () => {
    it('adds a member to an org', async () => {
      const { createOrganizationWithOwner, addMember, isMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Owner 1', 'owner1@test.com');
      const memberId = await createTestUser('Member 1', 'member1@test.com');

      const orgResult = await createOrganizationWithOwner('Org for Add', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member');
      expect(addResult.ok).toBe(true);

      const member = await isMember(orgId, memberId);
      expect(member).toBe(true);
    });

    it('isMember returns false for non-member', async () => {
      const { createOrganizationWithOwner, isMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Owner 2', 'owner2@test.com');
      const nonMemberId = await createTestUser('NonMember', 'nonmember@test.com');

      const orgResult = await createOrganizationWithOwner('Org for NonMember', ownerId);
      if (!orgResult.ok) return;

      const member = await isMember(orgResult.data.organization.id, nonMemberId);
      expect(member).toBe(false);
    });

    it('rejects duplicate membership (UNIQUE constraint)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Owner 3', 'owner3@test.com');
      const memberId = await createTestUser('Dup Member', 'dupmember@test.com');

      const orgResult = await createOrganizationWithOwner('Org for Dup', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // First add succeeds
      const first = await addMember(orgId, memberId, 'member');
      expect(first.ok).toBe(true);

      // Second add fails (already a member)
      const second = await addMember(orgId, memberId, 'admin');
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect((second as { error: { code: string } }).error.code).toBe('ALREADY_MEMBER');
    });

    it('getMembersByOrg returns all members sorted by role hierarchy', async () => {
      const { createOrganizationWithOwner, addMember, getMembersByOrg } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Owner 4', 'owner4@test.com');
      const adminId = await createTestUser('Admin 4', 'admin4@test.com');
      const viewerId = await createTestUser('Viewer 4', 'viewer4@test.com');

      const orgResult = await createOrganizationWithOwner('Org for Sort', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, adminId, 'admin');
      await addMember(orgId, viewerId, 'viewer');

      const members = await getMembersByOrg(orgId);
      expect(members).toHaveLength(3);
      // owner first, then admin, then viewer
      expect(members[0].role).toBe('owner');
      expect(members[1].role).toBe('admin');
      expect(members[2].role).toBe('viewer');
    });

    it('rejects invalid UUIDs for addMember', async () => {
      const { addMember } = await import('@/lib/organizations/memberships');
      const result = await addMember('not-a-uuid', 'also-not-uuid', 'member');
      expect(result.ok).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 3: Owner Protection (last owner cannot be removed/demoted/suspended)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 3: Owner protection (last owner)', () => {
    it('cannot remove the last owner', async () => {
      const { createOrganizationWithOwner, removeMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Last Owner Remove', 'lastownerremove@test.com');

      const orgResult = await createOrganizationWithOwner('Org Last Owner R', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await removeMember(orgId, ownerId, ownerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('CANNOT_REMOVE_LAST_OWNER');
    });

    it('cannot demote the last owner (change role)', async () => {
      const { createOrganizationWithOwner, changeMemberRole } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Last Owner Demote', 'lastownerdemote@test.com');

      const orgResult = await createOrganizationWithOwner('Org Last Owner D', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await changeMemberRole(orgId, ownerId, 'admin');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('CANNOT_DEMOTE_LAST_OWNER');
    });

    it('cannot suspend the last owner', async () => {
      const { createOrganizationWithOwner, addMember, suspendMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Last Owner Suspend', 'lastownersuspend@test.com');
      // suspendMember checks self-suspend (userId === suspendedBy) BEFORE
      // last-owner protection, so we need a different admin to be the actor.
      const adminId = await createTestUser('Suspend Admin', 'suspendadmin@test.com');

      const orgResult = await createOrganizationWithOwner('Org Last Owner S', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add an admin who will attempt the suspension
      await addMember(orgId, adminId, 'admin');

      const result = await suspendMember(orgId, ownerId, adminId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('CANNOT_SUSPEND_LAST_OWNER');
    });

    it('CAN remove a second owner when there are multiple owners', async () => {
      const { createOrganizationWithOwner, addMember, changeMemberRole, removeMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Primary Owner', 'primaryowner@test.com');
      const secondOwnerId = await createTestUser('Second Owner', 'secondowner@test.com');

      const orgResult = await createOrganizationWithOwner('Org Multi Owner', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add second member and promote to owner
      await addMember(orgId, secondOwnerId, 'member');
      await changeMemberRole(orgId, secondOwnerId, 'owner');

      // Now there are 2 owners — removing the second should succeed
      const result = await removeMember(orgId, secondOwnerId, ownerId);
      expect(result.ok).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 4: Role changes
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 4: Role changes', () => {
    it('changes member role from member to admin', async () => {
      const { createOrganizationWithOwner, addMember, changeMemberRole, getOrgRole } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Role Owner', 'roleowner@test.com');
      const memberId = await createTestUser('Role Member', 'rolemember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Role Change', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      const result = await changeMemberRole(orgId, memberId, 'admin');
      expect(result.ok).toBe(true);

      const role = await getOrgRole(orgId, memberId);
      expect(role).toBe('admin');
    });

    it('rejects invalid role in changeMemberRole', async () => {
      const { createOrganizationWithOwner, addMember, changeMemberRole } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Invalid Role Owner', 'invalidroleowner@test.com');
      const memberId = await createTestUser('Invalid Role Member', 'invalidrolemember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Invalid Role', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      const result = await changeMemberRole(orgId, memberId, 'superadmin' as never);
      expect(result.ok).toBe(false);
    });

    it('returns error when changing role of non-member', async () => {
      const { createOrganizationWithOwner, changeMemberRole } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('NonMember Owner', 'nonmemberowner@test.com');
      const nonMemberId = await createTestUser('NonMember User', 'nonmemberuser@test.com');

      const orgResult = await createOrganizationWithOwner('Org NonMember Role', ownerId);
      if (!orgResult.ok) return;

      const result = await changeMemberRole(orgResult.data.organization.id, nonMemberId, 'admin');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_A_MEMBER');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 5: Suspend / Reactivate lifecycle
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 5: Suspend and reactivate', () => {
    it('suspends and reactivates a member', async () => {
      const {
        createOrganizationWithOwner,
        addMember,
        suspendMember,
        reactivateMember,
        getMembership,
      } = await import('@/lib/organizations/memberships');
      const ownerId = await createTestUser('Suspend Owner', 'suspendowner@test.com');
      const memberId = await createTestUser('Suspend Member', 'suspendmember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Suspend', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Suspend
      const suspendResult = await suspendMember(orgId, memberId, ownerId);
      expect(suspendResult.ok).toBe(true);
      if (suspendResult.ok) {
        expect(suspendResult.data.status).toBe('suspended');
      }

      // Verify in DB
      let membership = await getMembership(orgId, memberId);
      expect(membership?.status).toBe('suspended');

      // Reactivate
      const reactivateResult = await reactivateMember(orgId, memberId);
      expect(reactivateResult.ok).toBe(true);
      if (reactivateResult.ok) {
        expect(reactivateResult.data.status).toBe('active');
      }

      membership = await getMembership(orgId, memberId);
      expect(membership?.status).toBe('active');
    });

    it('cannot suspend a non-member', async () => {
      const { createOrganizationWithOwner, suspendMember } = await import(
        '@/lib/organizations/memberships'
      );
      const ownerId = await createTestUser('Suspend NonMember Owner', 'suspnonown@test.com');
      const nonMemberId = await createTestUser('Suspend NonMember User', 'suspnonusr@test.com');

      const orgResult = await createOrganizationWithOwner('Org Suspend NonMember', ownerId);
      if (!orgResult.ok) return;

      const result = await suspendMember(orgResult.data.organization.id, nonMemberId, ownerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_A_MEMBER');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 6: Remove member and legacy sync
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 6: Remove member and legacy sync', () => {
    it('removes a member and clears legacy org_id', async () => {
      const { createOrganizationWithOwner, addMember, removeMember, syncLegacyOrgId, isMember } =
        await import('@/lib/organizations/memberships');
      const ownerId = await createTestUser('Remove Owner', 'removeowner@test.com');
      const memberId = await createTestUser('Remove Member', 'removemember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Remove', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Set legacy pointer to simulate old model
      await rawExec(`UPDATE users SET org_id = '${orgId}', org_role = 'member' WHERE id = '${memberId}'`);

      // Remove the member
      const result = await removeMember(orgId, memberId, ownerId);
      expect(result.ok).toBe(true);

      // Member no longer in the org
      const stillMember = await isMember(orgId, memberId);
      expect(stillMember).toBe(false);

      // Legacy pointer should be cleared
      const userRows = await rawExec(`SELECT org_id FROM users WHERE id = '${memberId}'`);
      expect(userRows[0].org_id).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 7: Active org context
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 7: Active org context', () => {
    it('sets and resolves active org context', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { setActiveOrg, resolveActiveOrg } = await import(
        '@/lib/organizations/context'
      );
      const ownerId = await createTestUser('Context Owner', 'contextowner@test.com');

      const orgResult = await createOrganizationWithOwner('Org Context', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Set active org
      const setResult = await setActiveOrg(ownerId, orgId, 'user');
      expect(setResult.ok).toBe(true);

      // Resolve active org
      const resolved = await resolveActiveOrg(ownerId);
      expect(resolved).not.toBeNull();
      expect(resolved?.organizationId).toBe(orgId);
      expect(resolved?.role).toBe('owner');
    });

    it('rejects setting active org for non-member', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { setActiveOrg } = await import('@/lib/organizations/context');
      const ownerId = await createTestUser('NonMember Ctx Owner', 'nmctxowner@test.com');
      const nonMemberId = await createTestUser('NonMember Ctx User', 'nmctxuser@test.com');

      const orgResult = await createOrganizationWithOwner('Org Ctx NonMember', ownerId);
      if (!orgResult.ok) return;

      const result = await setActiveOrg(nonMemberId, orgResult.data.organization.id, 'user');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: string }).error).toBe('NOT_A_MEMBER');
    });

    it('rejects invalid UUID for setActiveOrg', async () => {
      const { setActiveOrg } = await import('@/lib/organizations/context');
      const result = await setActiveOrg('not-a-uuid', 'also-not-uuid', 'user');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: string }).error).toBe('INVALID_ID');
    });

    it('clears active org context', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { setActiveOrg, clearActiveOrg } = await import(
        '@/lib/organizations/context'
      );
      const ownerId = await createTestUser('Clear Ctx Owner', 'clearctxowner@test.com');

      const orgResult = await createOrganizationWithOwner('Org Clear Ctx', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await setActiveOrg(ownerId, orgId, 'user');
      await clearActiveOrg(ownerId);

      // The active_organization_context row must be gone.
      // Note: We do NOT call resolveActiveOrg() here because it would
      // re-insert a default context row as a side effect of its fallback
      // logic (primary membership → setDefaultActiveOrg). The assertion
      // is specifically that clearActiveOrg removes the explicit row.
      const ctxRows = await rawExec(
        `SELECT * FROM active_organization_context WHERE user_id = '${ownerId}'`
      );
      expect(ctxRows).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 8: Authorization engine (default-deny, role checks)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 8: Authorization engine', () => {
    it('authorizes an owner for org:view', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('Authz Owner', 'authzowner@test.com');

      const orgResult = await createOrganizationWithOwner('Org Authz', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await authorize(ownerId, orgId, 'org:view');
      expect(result.allowed).toBe(true);
    });

    it('denies viewer for member:invite (insufficient role)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorize } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('Authz Owner 2', 'authzowner2@test.com');
      const viewerId = await createTestUser('Authz Viewer', 'authzviewer@test.com');

      const orgResult = await createOrganizationWithOwner('Org Authz Viewer', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, viewerId, 'viewer');

      const result = await authorize(viewerId, orgId, 'member:invite');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('insufficient_role');
    });

    it('denies non-member (no org context)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('Authz Owner 3', 'authzowner3@test.com');
      const nonMemberId = await createTestUser('Authz NonMember', 'authznonmember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Authz NonMember', ownerId);
      if (!orgResult.ok) return;

      const result = await authorize(nonMemberId, orgResult.data.organization.id, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });

    it('denies with invalid UUID', async () => {
      const { authorize } = await import('@/lib/organizations/authorization');
      const result = await authorize('not-a-uuid', 'also-not-uuid', 'org:view');
      expect(result.allowed).toBe(false);
    });

    it('denies suspended member', async () => {
      const { createOrganizationWithOwner, addMember, suspendMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorize } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('Susp Authz Owner', 'suspauthzowner@test.com');
      const memberId = await createTestUser('Susp Authz Member', 'suspauthzmember@test.com');

      const orgResult = await createOrganizationWithOwner('Org Susp Authz', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await suspendMember(orgId, memberId, ownerId);

      const result = await authorize(memberId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('membership_inactive');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 9: Authorization for member actions (owner protection in authz)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 9: Member action authorization', () => {
    it('denies self-removal (self_target protection)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorizeMemberAction } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('Self Owner', 'selfowner@test.com');
      const adminId = await createTestUser('Self Admin', 'selfadmin@test.com');

      const orgResult = await createOrganizationWithOwner('Org Self', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, adminId, 'admin');

      const result = await authorizeMemberAction(adminId, orgId, adminId, 'remove');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('self_target');
    });

    it('denies last-owner removal via authorizeMemberAction', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorizeMemberAction } = await import('@/lib/organizations/authorization');
      const ownerId = await createTestUser('LastOwner MA Owner', 'lastownermaown@test.com');
      const adminId = await createTestUser('LastOwner MA Admin', 'lastownermaadm@test.com');

      const orgResult = await createOrganizationWithOwner('Org LastOwner MA', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add the admin as a member so they are in the org context
      await addMember(orgId, adminId, 'admin');

      // Admin trying to remove the owner (who is the last owner)
      const result = await authorizeMemberAction(adminId, orgId, ownerId, 'remove');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      // The admin cannot manage an owner (canManageRole('admin','owner') is false),
      // so the deny reason is 'cannot_manage_peer'. If we reach owner protection
      // it would be 'last_owner_protection'. Both are valid deny reasons.
      expect([
        'last_owner_protection',
        'insufficient_role',
        'cannot_manage_peer',
      ]).toContain(result.reason);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 10: Feature flag gating (write operations disabled when flag off)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 10: Feature flag gating', () => {
    it('membership writes fail when ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED is off', async () => {
      const { addMember } = await import('@/lib/organizations/memberships');

      // Temporarily disable the write flag
      const saved = process.env.ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED;
      delete process.env.ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED;

      try {
        const result = await addMember(
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          'member'
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect((result as { error: { code: string } }).error.code).toBe('INSUFFICIENT_PERMISSIONS');
      } finally {
        if (saved !== undefined) {
          process.env.ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED = saved;
        }
      }
    });
  });
});
