/**
 * tests/phase1b1-membership-lifecycle.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 3: Membership Lifecycle Correction
 *
 * These tests verify the corrected membership lifecycle model:
 *
 *   1. removeMember() now soft-deletes (status='removed') instead of hard
 *      DELETE. The row is retained for audit trail integrity (ADR-001,
 *      Threat Model T-12).
 *   2. The 'removed' status is a valid membership status (migration 106
 *      adds it to the CHECK constraint).
 *   3. removed_at and removed_by audit fields are populated on removal.
 *   4. Removed members are excluded from active membership queries
 *      (isMember, getMembersByOrg, countActiveOwners, etc.).
 *   5. A removed member can be re-added (addMember reactivates the row
 *      instead of returning ALREADY_MEMBER).
 *   6. The active org context is invalidated when a member is removed.
 *   7. joined_at is populated on member creation and re-add.
 *   8. Last-owner protection still works with the soft-delete model.
 *   9. Suspending a member also invalidates the active org context.
 *
 * These tests run against a real PostgreSQL test database. They are gated
 * on TEST_DATABASE_URL — if the env var is not set, all tests skip gracefully.
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

const TEST_SCHEMA = 'phase1b1_membership_lifecycle_test';

const MIGRATION_016 = join(process.cwd(), 'lib', 'migrations', '016_organizations.sql');
const MIGRATION_105 = join(
  process.cwd(),
  'lib',
  'migrations',
  '105_organization_authority_foundation.sql',
);
const MIGRATION_106 = join(
  process.cwd(),
  'lib',
  'migrations',
  '106_membership_org_lifecycle_correction.sql',
);

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let rawPool: Pool | null = null;

// Minimal users table DDL (provides the FK target for organizations.owner_id
// and organization_members.user_id).
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
  process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = 'true';
  process.env.ENTERPRISE_ORG_MEMBERSHIP_WRITE_ENABLED = 'true';
  process.env.ENTERPRISE_ACTIVE_ORG_CONTEXT_ENABLED = 'true';
  process.env.ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED = 'true';
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
async function createTestUser(name: string, email: string, role = 'user'): Promise<string> {
  const id = randomUUID();
  await rawExec(
    `INSERT INTO users (id, name, email, role) VALUES ('${id}', '${name}', '${email}', '${role}')`,
  );
  return id;
}

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1B.1 — Membership Lifecycle Tests (Workstream 3)', () => {
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

    const client = await rawPool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

      await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      await client.query(USERS_DDL);

      const migration016 = readFileSync(MIGRATION_016, 'utf-8');
      await client.query(migration016);

      const migration105 = readFileSync(MIGRATION_105, 'utf-8');
      await client.query(migration105);

      const migration106 = readFileSync(MIGRATION_106, 'utf-8');
      await client.query(migration106);
    } finally {
      client.release();
    }
  }, 30000);

  // ════════════════════════════════════════════════════════════════════════
  // Section 1: removeMember() soft-deletes instead of hard DELETE
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 1: removeMember() soft-deletes (status=removed, not hard DELETE)', () => {
    it('sets status to removed instead of deleting the row', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 1', 'owner1-lc@test.com');
      const memberId = await createTestUser('Member 1', 'member1-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Remove the member
      const result = await removeMember(orgId, memberId, ownerId);
      expect(result.ok).toBe(true);

      // The row must still exist (soft-delete, not hard delete)
      const rows = await rawExec(
        `SELECT status FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('removed');
    });

    it('populates removed_at and removed_by on removal', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 2', 'owner2-lc@test.com');
      const memberId = await createTestUser('Member 2', 'member2-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await removeMember(orgId, memberId, ownerId);

      const rows = await rawExec(
        `SELECT removed_at, removed_by FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0].removed_at).not.toBeNull();
      expect(String(rows[0].removed_by)).toBe(ownerId);
    });

    it('removed member is no longer an active member (isMember returns false)', async () => {
      const { createOrganizationWithOwner, addMember, removeMember, isMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 3', 'owner3-lc@test.com');
      const memberId = await createTestUser('Member 3', 'member3-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 3', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      expect(await isMember(orgId, memberId)).toBe(true);

      await removeMember(orgId, memberId, ownerId);
      expect(await isMember(orgId, memberId)).toBe(false);
    });

    it('removed member is excluded from getMembersByOrg (active)', async () => {
      const { createOrganizationWithOwner, addMember, removeMember, getMembersByOrg } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 4', 'owner4-lc@test.com');
      const memberId = await createTestUser('Member 4', 'member4-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 4', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await removeMember(orgId, memberId, ownerId);

      // Default status filter is 'active' — removed members should be excluded
      const activeMembers = await getMembersByOrg(orgId);
      const memberIds = activeMembers.map((m) => m.userId);
      expect(memberIds).not.toContain(memberId);
      expect(memberIds).toContain(ownerId); // owner still present
    });

    it('removed member appears in getMembersByOrg when querying all statuses', async () => {
      const { createOrganizationWithOwner, addMember, removeMember, getMembersByOrg } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 5', 'owner5-lc@test.com');
      const memberId = await createTestUser('Member 5', 'member5-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 5', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await removeMember(orgId, memberId, ownerId);

      // Query all members regardless of status — the removed member should appear
      const allMembers = await getMembersByOrg(orgId, 'all');
      const memberIds = allMembers.map((m) => m.userId);
      expect(memberIds).toContain(memberId);

      // Verify the status is 'removed'
      const removedMember = allMembers.find((m) => m.userId === memberId);
      expect(removedMember?.status).toBe('removed');
    });

    it('removing an already-removed member is idempotent (no error)', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 6', 'owner6-lc@test.com');
      const memberId = await createTestUser('Member 6', 'member6-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 6', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await removeMember(orgId, memberId, ownerId);

      // Remove again — should succeed (idempotent)
      const result2 = await removeMember(orgId, memberId, ownerId);
      expect(result2.ok).toBe(true);
    });

    it('removing a non-existent member returns NOT_A_MEMBER', async () => {
      const { createOrganizationWithOwner, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 7', 'owner7-lc@test.com');
      const strangerId = await createTestUser('Stranger', 'stranger-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 7', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await removeMember(orgId, strangerId, ownerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_A_MEMBER');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 2: Re-adding a removed member (reactivation)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 2: Re-adding a removed member', () => {
    it('addMember reactivates a removed member instead of returning ALREADY_MEMBER', async () => {
      const { createOrganizationWithOwner, addMember, removeMember, getMembership } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 8', 'owner8-lc@test.com');
      const memberId = await createTestUser('Member 8', 'member8-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 8', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add, then remove
      await addMember(orgId, memberId, 'member');
      await removeMember(orgId, memberId, ownerId);

      // Verify removed
      const removedMembership = await getMembership(orgId, memberId);
      expect(removedMembership?.status).toBe('removed');

      // Re-add — should reactivate, not return ALREADY_MEMBER
      const readdResult = await addMember(orgId, memberId, 'admin');
      expect(readdResult.ok).toBe(true);
      if (!readdResult.ok) return;

      // Verify the membership is now active with the new role
      const reactivated = await getMembership(orgId, memberId);
      expect(reactivated?.status).toBe('active');
      expect(reactivated?.role).toBe('admin');

      // Verify removed_at and removed_by are cleared
      expect(reactivated?.removedAt).toBeNull();
      expect(reactivated?.removedBy).toBeNull();
    });

    it('re-adding a removed member updates joined_at', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 9', 'owner9-lc@test.com');
      const memberId = await createTestUser('Member 9', 'member9-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 9', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Capture the raw DB joined_at as text (full microsecond precision).
      // The pg driver returns timestamptz as a JS Date, and String(Date)
      // truncates to second precision — casting to ::text in SQL preserves
      // microsecond precision for a reliable before/after comparison.
      const beforeRows = await rawExec(
        `SELECT joined_at::text AS joined_at_text FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      const originalJoinedAt = String(beforeRows[0].joined_at_text);

      await removeMember(orgId, memberId, ownerId);
      // Allow time to pass so the re-join timestamp is different
      await new Promise((resolve) => setTimeout(resolve, 50));
      await addMember(orgId, memberId, 'member');

      // Query raw joined_at again for full-precision comparison
      const afterRows = await rawExec(
        `SELECT joined_at::text AS joined_at_text FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      const newJoinedAt = String(afterRows[0].joined_at_text);

      // joined_at should be updated (re-join time) — the ::text cast gives
      // microsecond precision, so even a 50ms gap produces a different value
      expect(newJoinedAt).not.toBe(originalJoinedAt);
    });

    it('addMember still returns ALREADY_MEMBER for an active member', async () => {
      const { createOrganizationWithOwner, addMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 10', 'owner10-lc@test.com');
      const memberId = await createTestUser('Member 10', 'member10-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 10', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Adding again while active should return ALREADY_MEMBER
      const result = await addMember(orgId, memberId, 'admin');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('ALREADY_MEMBER');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 3: joined_at lifecycle field
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 3: joined_at lifecycle field', () => {
    it('joined_at is populated when a member is added', async () => {
      const { createOrganizationWithOwner, addMember, getMembership } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 11', 'owner11-lc@test.com');
      const memberId = await createTestUser('Member 11', 'member11-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 11', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      const membership = await getMembership(orgId, memberId);
      expect(membership?.joinedAt).not.toBeNull();
    });

    it('joined_at is populated for the org owner', async () => {
      const { createOrganizationWithOwner, getMembership } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 12', 'owner12-lc@test.com');
      const orgResult = await createOrganizationWithOwner('Lifecycle Org 12', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const membership = await getMembership(orgId, ownerId);
      expect(membership?.joinedAt).not.toBeNull();
    });

    it('migration 106 backfills joined_at from accepted_at or created_at', async () => {
      // Insert a membership row directly (simulating pre-migration-106 data),
      // then apply migration 106 and verify joined_at is backfilled.
      const ownerId = await createTestUser('Owner 13', 'owner13-lc@test.com');

      // Create an org directly
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Backfill Org', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // Insert a membership without joined_at (simulating pre-106 state)
      const memberId = await createTestUser('Member 13', 'member13-lc@test.com');
      await rawExec(
        `INSERT INTO organization_members (organization_id, user_id, role, status, accepted_at, created_at, updated_at)
         VALUES ('${orgId}', '${memberId}', 'member', 'active', now(), now(), now())`,
      );

      // Verify joined_at is null before backfill
      const beforeRows = await rawExec(
        `SELECT joined_at FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      expect(beforeRows[0].joined_at).toBeNull();

      // Apply migration 106 backfill
      const migration106 = readFileSync(MIGRATION_106, 'utf-8');
      const client = await rawPool!.connect();
      try {
        await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);
        await client.query(migration106);
      } finally {
        client.release();
      }

      // Verify joined_at is now backfilled
      const afterRows = await rawExec(
        `SELECT joined_at FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${memberId}'`,
      );
      expect(afterRows[0].joined_at).not.toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 4: Active org context invalidation on removal/suspension
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 4: Active org context invalidation on removal/suspension', () => {
    it('removing a member clears their active org context for that org', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');
      const { setActiveOrg, getActiveOrgContextRow } = await import(
        '@/lib/organizations/context'
      );

      const ownerId = await createTestUser('Owner 14', 'owner14-lc@test.com');
      const memberId = await createTestUser('Member 14', 'member14-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 14', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Set active org context
      const setActiveResult = await setActiveOrg(memberId, orgId);
      expect(setActiveResult.ok).toBe(true);

      // Verify context exists
      const contextBefore = await getActiveOrgContextRow(memberId);
      expect(contextBefore).not.toBeNull();
      expect(contextBefore?.organizationId).toBe(orgId);

      // Remove the member
      await removeMember(orgId, memberId, ownerId);

      // Context should be cleared
      const contextAfter = await getActiveOrgContextRow(memberId);
      expect(contextAfter).toBeNull();
    });

    it('suspending a member clears their active org context for that org', async () => {
      const { createOrganizationWithOwner, addMember, suspendMember } =
        await import('@/lib/organizations/memberships');
      const { setActiveOrg, getActiveOrgContextRow } = await import(
        '@/lib/organizations/context'
      );

      const ownerId = await createTestUser('Owner 15', 'owner15-lc@test.com');
      const memberId = await createTestUser('Member 15', 'member15-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 15', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Set active org context
      await setActiveOrg(memberId, orgId);
      const contextBefore = await getActiveOrgContextRow(memberId);
      expect(contextBefore).not.toBeNull();

      // Suspend the member
      await suspendMember(orgId, memberId, ownerId);

      // Context should be cleared
      const contextAfter = await getActiveOrgContextRow(memberId);
      expect(contextAfter).toBeNull();
    });

    it('removing a member does not affect their active org context for a different org', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');
      const { setActiveOrg, getActiveOrgContextRow } = await import(
        '@/lib/organizations/context'
      );

      const ownerId = await createTestUser('Owner 16', 'owner16-lc@test.com');
      const memberId = await createTestUser('Member 16', 'member16-lc@test.com');

      const org1Result = await createOrganizationWithOwner('Lifecycle Org 16a', ownerId);
      const org2Result = await createOrganizationWithOwner('Lifecycle Org 16b', ownerId);
      if (!org1Result.ok || !org2Result.ok) return;
      const org1Id = org1Result.data.organization.id;
      const org2Id = org2Result.data.organization.id;

      // Add member to both orgs
      await addMember(org1Id, memberId, 'member');
      await addMember(org2Id, memberId, 'member');

      // Set active org context to org2
      await setActiveOrg(memberId, org2Id);

      // Remove member from org1
      await removeMember(org1Id, memberId, ownerId);

      // Context for org2 should still be intact
      const context = await getActiveOrgContextRow(memberId);
      expect(context).not.toBeNull();
      expect(context?.organizationId).toBe(org2Id);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 5: Last-owner protection with soft-delete model
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 5: Last-owner protection with soft-delete model', () => {
    it('cannot remove the last owner (soft-delete still enforces protection)', async () => {
      const { createOrganizationWithOwner, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Last Owner 1', 'lastowner1-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 17', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await removeMember(orgId, ownerId, ownerId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('CANNOT_REMOVE_LAST_OWNER');

      // Verify the owner is still active (not soft-deleted)
      const rows = await rawExec(
        `SELECT status FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${ownerId}'`,
      );
      expect(rows[0].status).toBe('active');
    });

    it('can remove a second owner when there are multiple owners (soft-delete)', async () => {
      const { createOrganizationWithOwner, addMember, changeMemberRole, removeMember, countActiveOwners } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Primary Owner 2', 'primaryowner2-lc@test.com');
      const secondOwnerId = await createTestUser('Second Owner 2', 'secondowner2-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 18', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, secondOwnerId, 'member');
      await changeMemberRole(orgId, secondOwnerId, 'owner');

      // Now there are 2 owners
      expect(await countActiveOwners(orgId)).toBe(2);

      // Remove the second owner — should succeed
      const result = await removeMember(orgId, secondOwnerId, ownerId);
      expect(result.ok).toBe(true);

      // Only 1 active owner remains
      expect(await countActiveOwners(orgId)).toBe(1);

      // The second owner's row is soft-deleted (status='removed')
      const rows = await rawExec(
        `SELECT status FROM organization_members WHERE organization_id = '${orgId}' AND user_id = '${secondOwnerId}'`,
      );
      expect(rows[0].status).toBe('removed');
    });

    it('a removed owner does not count as an active owner', async () => {
      const { createOrganizationWithOwner, addMember, changeMemberRole, removeMember, countActiveOwners } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Primary Owner 3', 'primaryowner3-lc@test.com');
      const secondOwnerId = await createTestUser('Second Owner 3', 'secondowner3-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 19', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, secondOwnerId, 'member');
      await changeMemberRole(orgId, secondOwnerId, 'owner');
      expect(await countActiveOwners(orgId)).toBe(2);

      await removeMember(orgId, secondOwnerId, ownerId);

      // The removed owner should not count
      expect(await countActiveOwners(orgId)).toBe(1);

      // Now the remaining owner cannot be removed (last owner protection)
      const result = await removeMember(orgId, ownerId, ownerId);
      expect(result.ok).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 6: Legacy compatibility on removal
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 6: Legacy compatibility on removal', () => {
    it('removing a member clears users.org_id if it pointed to this org', async () => {
      const { createOrganizationWithOwner, addMember, removeMember } =
        await import('@/lib/organizations/memberships');

      const ownerId = await createTestUser('Owner 17', 'owner17-lc@test.com');
      const memberId = await createTestUser('Member 17', 'member17-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Lifecycle Org 20', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Set legacy pointer
      await rawExec(
        `UPDATE users SET org_id = '${orgId}', org_role = 'member' WHERE id = '${memberId}'`,
      );

      await removeMember(orgId, memberId, ownerId);

      // Legacy pointer should be cleared
      const userRows = await rawExec(`SELECT org_id FROM users WHERE id = '${memberId}'`);
      expect(userRows[0].org_id).toBeNull();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Section 7: Organization lifecycle (archived status)
  // ════════════════════════════════════════════════════════════════════════

  describe('Section 7: Organization lifecycle (archived status)', () => {
    it("'archived' is a valid organization status", async () => {
      const ownerId = await createTestUser('Archive Owner 1', 'archiveowner1-lc@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Archive Org 1', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // Setting status to 'archived' should succeed (migration 106 allows it)
      await rawExec(
        `UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`,
      );

      const rows = await rawExec(`SELECT status, archived_at FROM organizations WHERE id = '${orgId}'`);
      expect(rows[0].status).toBe('archived');
      expect(rows[0].archived_at).not.toBeNull();
    });

    it('getOrganization() excludes archived orgs (treats as terminal)', async () => {
      const { getOrganization } = await import('@/lib/organizations/service');
      const ownerId = await createTestUser('Archive Owner 2', 'archiveowner2-lc@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Archive Org 2', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // Archive the org
      await rawExec(`UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`);

      // getOrganization should return null (excluded)
      const org = await getOrganization(orgId);
      expect(org).toBeNull();
    });

    it('getOrganization() with includeDeleted=true returns archived orgs', async () => {
      const { getOrganization } = await import('@/lib/organizations/service');
      const ownerId = await createTestUser('Archive Owner 3', 'archiveowner3-lc@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Archive Org 3', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      await rawExec(`UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`);

      const org = await getOrganization(orgId, true);
      expect(org).not.toBeNull();
      expect(org?.status).toBe('archived');
      expect(org?.archivedAt).not.toBeNull();
    });

    it('getOrganization() still excludes deleted orgs (backward compat)', async () => {
      const { getOrganization } = await import('@/lib/organizations/service');
      const ownerId = await createTestUser('Delete Owner 4', 'deleteowner4-lc@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Delete Org 4', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // Use legacy 'deleted' status
      await rawExec(`UPDATE organizations SET status = 'deleted', deleted_at = now() WHERE id = '${orgId}'`);

      const org = await getOrganization(orgId);
      expect(org).toBeNull();
    });

    it('authorize() denies access to an archived org (org_archived)', async () => {
      const { createOrganizationWithOwner, addMember } =
        await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Archive Owner 5', 'archiveowner5-lc@test.com');
      const memberId = await createTestUser('Archive Member 5', 'archivemember5-lc@test.com');

      const orgResult = await createOrganizationWithOwner('Archive Org 5', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // Archive the org
      await rawExec(`UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`);

      // Even an active member should be denied (org is archived)
      const result = await authorize(memberId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('org_archived');
    });

    it('archived_at column exists on organizations', async () => {
      const rows = await rawExec(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'organizations'
          AND column_name = 'archived_at'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe('timestamp with time zone');
    });

    it('removed_at and removed_by columns exist on organization_members', async () => {
      const rows = await rawExec(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'organization_members'
          AND column_name IN ('removed_at', 'removed_by', 'joined_at')
        ORDER BY column_name
      `);
      expect(rows.length).toBe(3);
      const colNames = rows.map((r) => r.column_name);
      expect(colNames).toContain('joined_at');
      expect(colNames).toContain('removed_at');
      expect(colNames).toContain('removed_by');
    });
  });
});
