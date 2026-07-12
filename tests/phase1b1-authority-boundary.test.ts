/**
 * tests/phase1b1-authority-boundary.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 1: Remove Standing Platform-Admin Tenant Access
 *
 * These tests verify that platform admin/super_admin roles do NOT bypass
 * org-scoped authorization. A platform admin without org membership is
 * denied, identical to any other non-member. This corrects the Phase 1B
 * defect where isPlatformAdmin() returned an immediate allow in authorize(),
 * authorizeMemberAction(), and authorizeRoleChange().
 *
 * Coverage areas:
 *   1. authorize() denies platform admin/super_admin without org membership
 *   2. authorize() allows platform admin WITH org membership (based on org role)
 *   3. authorizeMemberAction() denies platform admin without org membership
 *   4. authorizeRoleChange() denies platform admin without org membership
 *   5. isSupportElevationActive() returns false (fail-closed boundary)
 *   6. isPlatformAdminUser() identifies platform admins but does not grant access
 *   7. Org status deny reasons (org_archived replaces org_deleted)
 *
 * These tests run against a real PostgreSQL test database. They are gated
 * on TEST_DATABASE_URL — if the env var is not set, all tests skip gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ──────────────────────────────────────────────────────────────────────────────
// Module Mocks — route all Neon SQL to the local pg test database
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ──────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b1_authority_boundary_test';

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

// Minimal users table DDL (same as the adversarial test — provides the FK
// target for organizations.owner_id and organization_members.user_id).
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

// ──────────────────────────────────────────────────────────────────────────────
// Environment Management
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Raw SQL helper (for setup and assertions, bypassing the Neon shim)
// ──────────────────────────────────────────────────────────────────────────────

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

/** Set a user's platform role. */
async function setUserRole(userId: string, role: string): Promise<void> {
  await rawExec(`UPDATE users SET role = '${role}' WHERE id = '${userId}'`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1B.1 — Authority Boundary Tests (Workstream 1)', () => {
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

  // ════════════════════════════════════════════════════════════════════════════
  // Section 1: authorize() — platform admin denied without membership
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 1: authorize() denies platform admins without org membership', () => {
    it('denies super_admin without org membership (not_a_member)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Org Owner', 'orgowner1@test.com');
      const superAdminId = await createTestUser(
        'Super Admin',
        'superadmin1@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Boundary Org 1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // super_admin is NOT a member of this org — must be denied
      const result = await authorize(superAdminId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      // The deny reason must be not_a_member (not allowed via bypass)
      expect(result.reason).toBe('not_a_member');
    });

    it('denies admin without org membership (not_a_member)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Org Owner 2', 'orgowner2@test.com');
      const adminId = await createTestUser('Platform Admin', 'admin1@test.com', 'admin');

      const orgResult = await createOrganizationWithOwner('Boundary Org 2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await authorize(adminId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });

    it('denies super_admin for member:invite action without org membership', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Org Owner 3', 'orgowner3@test.com');
      const superAdminId = await createTestUser(
        'Super Admin 2',
        'superadmin2@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Boundary Org 3', ownerId);
      if (!orgResult.ok) return;

      const result = await authorize(
        superAdminId,
        orgResult.data.organization.id,
        'member:invite',
      );
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });

    it('denies super_admin for org:edit_settings without org membership', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Org Owner 4', 'orgowner4@test.com');
      const superAdminId = await createTestUser(
        'Super Admin 3',
        'superadmin3@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Boundary Org 4', ownerId);
      if (!orgResult.ok) return;

      const result = await authorize(
        superAdminId,
        orgResult.data.organization.id,
        'org:edit_settings',
      );
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 2: authorize() — platform admin WITH membership uses org role
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 2: authorize() allows platform admin with org membership (org role governs)', () => {
    it('allows super_admin who is an active member with sufficient org role', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Member Org Owner', 'memorgown@test.com');
      const superAdminId = await createTestUser(
        'Member Super Admin',
        'memsuperadmin@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Member Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add the super_admin as a member with 'admin' org role
      await addMember(orgId, superAdminId, 'admin');

      // super_admin is a member with admin org role — org:view is allowed
      const result = await authorize(superAdminId, orgId, 'org:view');
      expect(result.allowed).toBe(true);
    });

    it('denies super_admin member with insufficient org role for owner-only action', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Owner Only Org Owner', 'ownonly@test.com');
      const superAdminId = await createTestUser(
        'Viewer Super Admin',
        'viewersuperadmin@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Owner Only Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Add super_admin as a viewer (lowest org role)
      await addMember(orgId, superAdminId, 'viewer');

      // org:edit_settings is owner-only — super_admin with viewer role denied
      const result = await authorize(superAdminId, orgId, 'org:edit_settings');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('insufficient_role');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 3: authorizeMemberAction() — platform admin denied without membership
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 3: authorizeMemberAction() denies platform admins without membership', () => {
    it('denies super_admin from removing a member without org membership', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorizeMemberAction } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('MA Org Owner', 'maorgown@test.com');
      const memberId = await createTestUser('MA Member', 'mamember@test.com');
      const superAdminId = await createTestUser(
        'MA Super Admin',
        'masuperadmin@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('MA Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // super_admin is NOT a member — cannot remove anyone
      const result = await authorizeMemberAction(superAdminId, orgId, memberId, 'remove');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      // authorizeMemberAction first calls authorize() which denies with not_a_member
      expect(result.reason).toBe('not_a_member');
    });

    it('denies admin from changing a member role without org membership', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorizeRoleChange } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('RC Org Owner', 'rcorgown@test.com');
      const memberId = await createTestUser('RC Member', 'rcmember@test.com');
      const adminId = await createTestUser('RC Platform Admin', 'rcadmin@test.com', 'admin');

      const orgResult = await createOrganizationWithOwner('RC Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      // admin is NOT a member — cannot change roles
      const result = await authorizeRoleChange(adminId, orgId, memberId, 'admin');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });

    it('denies super_admin from suspending a member without org membership', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorizeMemberAction } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Susp Org Owner', 'susporgown@test.com');
      const memberId = await createTestUser('Susp Member', 'suspmember@test.com');
      const superAdminId = await createTestUser(
        'Susp Super Admin',
        'suspsuperadmin@test.com',
        'super_admin',
      );

      const orgResult = await createOrganizationWithOwner('Susp Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      const result = await authorizeMemberAction(superAdminId, orgId, memberId, 'suspend');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 4: Support elevation boundary
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 4: Support elevation boundary (fail-closed)', () => {
    it('isSupportElevationActive() returns false by default (fail-closed)', async () => {
      const { isSupportElevationActive } = await import('@/lib/organizations/authorization');
      expect(isSupportElevationActive()).toBe(false);
    });

    it('isSupportElevationActive() returns false even when all feature flags are enabled', async () => {
      // All feature flags are enabled in setupTestEnv()
      const { isSupportElevationActive } = await import('@/lib/organizations/authorization');
      expect(isSupportElevationActive()).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 5: isPlatformAdminUser() — informational only
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 5: isPlatformAdminUser() is informational only', () => {
    it('returns true for super_admin user', async () => {
      const { isPlatformAdminUser } = await import('@/lib/organizations/authorization');
      const superAdminId = await createTestUser(
        'Info Super Admin',
        'infospa@test.com',
        'super_admin',
      );
      expect(await isPlatformAdminUser(superAdminId)).toBe(true);
    });

    it('returns true for admin user', async () => {
      const { isPlatformAdminUser } = await import('@/lib/organizations/authorization');
      const adminId = await createTestUser('Info Admin', 'infospa2@test.com', 'admin');
      expect(await isPlatformAdminUser(adminId)).toBe(true);
    });

    it('returns false for regular user', async () => {
      const { isPlatformAdminUser } = await import('@/lib/organizations/authorization');
      const userId = await createTestUser('Info Regular User', 'infospa3@test.com', 'user');
      expect(await isPlatformAdminUser(userId)).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 6: Org status deny reason (org_archived replaces org_deleted)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 6: Org status deny reasons', () => {
    it('denies with org_suspended for a suspended org', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Suspended Org Owner', 'susporgown2@test.com');
      const orgResult = await createOrganizationWithOwner('Suspended Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Suspend the org via raw SQL
      await rawExec(`UPDATE organizations SET status = 'suspended' WHERE id = '${orgId}'`);

      const result = await authorize(ownerId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('org_suspended');
    });

    it('denies with org_archived for an archived org', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Archived Org Owner', 'archorgown@test.com');
      const orgResult = await createOrganizationWithOwner('Archived Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Archive the org via raw SQL (Phase 1B still uses 'deleted' in the DB
      // CHECK constraint; authorize() treats both 'archived' and 'deleted' as
      // org_archived deny reason. This test uses 'deleted' since migration 105
      // hasn't been corrected yet — migration 106 will add 'archived'.)
      await rawExec(`UPDATE organizations SET status = 'deleted' WHERE id = '${orgId}'`);

      const result = await authorize(ownerId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('org_archived');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 7: Regular users still denied (regression — bypass removal
  // must not break existing deny behavior for non-admin users)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 7: Regular users denied without membership (regression)', () => {
    it('denies regular user without org membership (not_a_member)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Reg Owner', 'regown@test.com');
      const nonMemberId = await createTestUser('Reg NonMember', 'regnonmember@test.com', 'user');

      const orgResult = await createOrganizationWithOwner('Reg Boundary Org', ownerId);
      if (!orgResult.ok) return;

      const result = await authorize(nonMemberId, orgResult.data.organization.id, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('not_a_member');
    });

    it('allows regular user who is an active member with sufficient org role', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Reg2 Owner', 'reg2own@test.com');
      const memberId = await createTestUser('Reg2 Member', 'reg2member@test.com', 'user');

      const orgResult = await createOrganizationWithOwner('Reg2 Boundary Org', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');

      const result = await authorize(memberId, orgId, 'org:view');
      expect(result.allowed).toBe(true);
    });
  });
});
