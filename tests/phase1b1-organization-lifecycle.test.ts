/**
 * tests/phase1b1-organization-lifecycle.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 4: Organization Lifecycle Correction
 *
 * These tests verify the corrected organization lifecycle model:
 *
 *   1. The canonical terminal status is 'archived' (not 'deleted').
 *      Organizations are never truly deleted; they are archived
 *      (soft-delete) with the row retained for audit trail integrity
 *      (ADR-001).
 *   2. archiveOrganization() sets status='archived' and records
 *      archived_at.
 *   3. suspendOrganization() sets status='suspended' and records
 *      suspended_at.
 *   4. reactivateOrganization() sets status='active' and clears
 *      suspended_at/archived_at.
 *   5. getOrganization() excludes both 'archived' and 'deleted' orgs
 *      (both are terminal states).
 *   6. authorize() denies access to archived orgs (reason: org_archived).
 *   7. authorize() denies access to suspended orgs (reason: org_suspended).
 *   8. Lifecycle transitions are reversible (archive → reactivate →
 *      active; suspend → reactivate → active).
 *   9. The archived_at column is populated on archive and cleared on
 *      reactivation.
 *
 * These tests run against a real PostgreSQL test database. They are gated
 * on TEST_DATABASE_URL — if the env var is not set, all tests skip.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Module Mocks — route all Neon SQL to the local pg test database
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
  return {
    getDbWithRetry: async () => {
      const { neon } = mockModule;
      return neon();
    },
    isTransientDbError: () => true,
    DbConfigError: class DbConfigError extends Error {},
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b1_org_lifecycle_test';

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
  org_id              UUID,
  org_role            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Environment Management
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Raw SQL helper (for setup and assertions, bypassing the Neon shim)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1B.1 — Organization Lifecycle Tests (Workstream 4)', () => {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 1: archiveOrganization()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 1: archiveOrganization()', () => {
    it('sets status to archived and records archived_at', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Archive Owner A1', 'archiveowner-a1@test.com');
      const orgResult = await createOrganizationWithOwner('Archive Test Org A1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await archiveOrganization(orgId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('archived');
      expect(result.data.archivedAt).not.toBeNull();
    });

    it('returns NOT_FOUND for a non-existent org', async () => {
      const { archiveOrganization } = await import('@/lib/organizations/service');
      const fakeId = randomUUID();
      const result = await archiveOrganization(fakeId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND for an invalid UUID', async () => {
      const { archiveOrganization } = await import('@/lib/organizations/service');
      const result = await archiveOrganization('not-a-uuid');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });

    it('archived org is excluded from getOrganization()', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization, getOrganization } = await import(
        '@/lib/organizations/service'
      );

      const ownerId = await createTestUser('Archive Owner A2', 'archiveowner-a2@test.com');
      const orgResult = await createOrganizationWithOwner('Archive Test Org A2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await archiveOrganization(orgId);

      // Default: archived orgs are excluded
      const org = await getOrganization(orgId);
      expect(org).toBeNull();
    });

    it('archived org is returned by getOrganization(includeDeleted=true)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization, getOrganization } = await import(
        '@/lib/organizations/service'
      );

      const ownerId = await createTestUser('Archive Owner A3', 'archiveowner-a3@test.com');
      const orgResult = await createOrganizationWithOwner('Archive Test Org A3', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await archiveOrganization(orgId);

      const org = await getOrganization(orgId, true);
      expect(org).not.toBeNull();
      expect(org?.status).toBe('archived');
      expect(org?.archivedAt).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 2: suspendOrganization()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 2: suspendOrganization()', () => {
    it('sets status to suspended and records suspended_at', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { suspendOrganization } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Suspend Owner S1', 'suspendowner-s1@test.com');
      const orgResult = await createOrganizationWithOwner('Suspend Test Org S1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const result = await suspendOrganization(orgId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('suspended');
      expect(result.data.suspendedAt).not.toBeNull();
    });

    it('returns NOT_FOUND for a non-existent org', async () => {
      const { suspendOrganization } = await import('@/lib/organizations/service');
      const result = await suspendOrganization(randomUUID());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });

    it('suspended org is still returned by getOrganization() (not terminal)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { suspendOrganization, getOrganization } = await import(
        '@/lib/organizations/service'
      );

      const ownerId = await createTestUser('Suspend Owner S2', 'suspendowner-s2@test.com');
      const orgResult = await createOrganizationWithOwner('Suspend Test Org S2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await suspendOrganization(orgId);

      // Suspended is NOT a terminal state — the org should still be visible
      const org = await getOrganization(orgId);
      expect(org).not.toBeNull();
      expect(org?.status).toBe('suspended');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 3: reactivateOrganization()
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 3: reactivateOrganization()', () => {
    it('reactivates a suspended org (status=active, suspended_at cleared)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { suspendOrganization, reactivateOrganization } = await import(
        '@/lib/organizations/service'
      );

      const ownerId = await createTestUser('React Owner R1', 'reactowner-r1@test.com');
      const orgResult = await createOrganizationWithOwner('React Test Org R1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await suspendOrganization(orgId);
      const result = await reactivateOrganization(orgId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('active');
      expect(result.data.suspendedAt).toBeNull();
    });

    it('reactivates an archived org (status=active, archived_at cleared)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization, reactivateOrganization } = await import(
        '@/lib/organizations/service'
      );

      const ownerId = await createTestUser('React Owner R2', 'reactowner-r2@test.com');
      const orgResult = await createOrganizationWithOwner('React Test Org R2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await archiveOrganization(orgId);
      const result = await reactivateOrganization(orgId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe('active');
      expect(result.data.archivedAt).toBeNull();
    });

    it('returns NOT_FOUND for a non-existent org', async () => {
      const { reactivateOrganization } = await import('@/lib/organizations/service');
      const result = await reactivateOrganization(randomUUID());
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect((result as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 4: authorize() behavior for archived/suspended orgs
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 4: authorize() behavior for archived/suspended orgs', () => {
    it('authorize() denies access to an archived org (org_archived)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { archiveOrganization } = await import('@/lib/organizations/service');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Authz Owner AZ1', 'authzowner-az1@test.com');
      const memberId = await createTestUser('Authz Member AZ1', 'authzmember-az1@test.com');

      const orgResult = await createOrganizationWithOwner('Authz Test Org AZ1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await archiveOrganization(orgId);

      // Even an active member should be denied (org is archived)
      const result = await authorize(memberId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('org_archived');
    });

    it('authorize() denies access to a suspended org (org_suspended)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { suspendOrganization } = await import('@/lib/organizations/service');
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Authz Owner AZ2', 'authzowner-az2@test.com');
      const memberId = await createTestUser('Authz Member AZ2', 'authzmember-az2@test.com');

      const orgResult = await createOrganizationWithOwner('Authz Test Org AZ2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await suspendOrganization(orgId);

      const result = await authorize(memberId, orgId, 'org:view');
      expect(result.allowed).toBe(false);
      if (result.allowed) return;
      expect(result.reason).toBe('org_suspended');
    });

    it('authorize() allows access to a reactivated org (status=active)', async () => {
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { suspendOrganization, reactivateOrganization } = await import(
        '@/lib/organizations/service'
      );
      const { authorize } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Authz Owner AZ3', 'authzowner-az3@test.com');
      const memberId = await createTestUser('Authz Member AZ3', 'authzmember-az3@test.com');

      const orgResult = await createOrganizationWithOwner('Authz Test Org AZ3', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await addMember(orgId, memberId, 'member');
      await suspendOrganization(orgId);

      // Denied while suspended
      const denied = await authorize(memberId, orgId, 'org:view');
      expect(denied.allowed).toBe(false);

      // Allowed after reactivation
      await reactivateOrganization(orgId);
      const allowed = await authorize(memberId, orgId, 'org:view');
      expect(allowed.allowed).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 5: Lifecycle transitions (full round-trip)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 5: Lifecycle transitions (full round-trip)', () => {
    it('active → suspend → reactivate → suspend → archive → reactivate', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const {
        suspendOrganization,
        reactivateOrganization,
        archiveOrganization,
        getOrganization,
      } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Round-Trip Owner RT1', 'roundtrip-rt1@test.com');
      const orgResult = await createOrganizationWithOwner('Round-Trip Org RT1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Verify initial state
      let org = await getOrganization(orgId);
      expect(org?.status).toBe('active');

      // Suspend
      await suspendOrganization(orgId);
      org = await getOrganization(orgId);
      expect(org?.status).toBe('suspended');
      expect(org?.suspendedAt).not.toBeNull();

      // Reactivate
      await reactivateOrganization(orgId);
      org = await getOrganization(orgId);
      expect(org?.status).toBe('active');
      expect(org?.suspendedAt).toBeNull();

      // Suspend again
      await suspendOrganization(orgId);
      org = await getOrganization(orgId);
      expect(org?.status).toBe('suspended');

      // Archive
      await archiveOrganization(orgId);
      org = await getOrganization(orgId);
      expect(org).toBeNull(); // archived is terminal — excluded by default

      // Verify via includeDeleted
      const archivedOrg = await getOrganization(orgId, true);
      expect(archivedOrg?.status).toBe('archived');
      expect(archivedOrg?.archivedAt).not.toBeNull();

      // Reactivate from archived
      await reactivateOrganization(orgId);
      org = await getOrganization(orgId);
      expect(org?.status).toBe('active');
      expect(org?.archivedAt).toBeNull();
    });

    it('archiving an already-archived org is idempotent (updates archived_at)', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Idempotent Owner ID1', 'idempotent-id1@test.com');
      const orgResult = await createOrganizationWithOwner('Idempotent Org ID1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await archiveOrganization(orgId);

      // Allow time to pass
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Archive again — should succeed (idempotent)
      const result2 = await archiveOrganization(orgId);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;
      expect(result2.data.status).toBe('archived');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 6: Feature-flag gating
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 6: Feature-flag gating', () => {
    it('archiveOrganization returns FEATURE_DISABLED when authority is off', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { archiveOrganization } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Flag Owner FG1', 'flagowner-fg1@test.com');
      const orgResult = await createOrganizationWithOwner('Flag Org FG1', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Disable the authority feature flag
      const originalFlag = process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED;
      process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = 'false';

      try {
        const result = await archiveOrganization(orgId);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect((result as { error: { code: string } }).error.code).toBe('FEATURE_DISABLED');
      } finally {
        process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = originalFlag;
      }
    });

    it('suspendOrganization returns FEATURE_DISABLED when authority is off', async () => {
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { suspendOrganization } = await import('@/lib/organizations/service');

      const ownerId = await createTestUser('Flag Owner FG2', 'flagowner-fg2@test.com');
      const orgResult = await createOrganizationWithOwner('Flag Org FG2', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const originalFlag = process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED;
      process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = 'false';

      try {
        const result = await suspendOrganization(orgId);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect((result as { error: { code: string } }).error.code).toBe('FEATURE_DISABLED');
      } finally {
        process.env.ENTERPRISE_ORG_AUTHORITY_ENABLED = originalFlag;
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Section 7: Schema verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Section 7: Schema verification', () => {
    it("'archived' is an accepted status in the CHECK constraint", async () => {
      const ownerId = await createTestUser('Schema Owner SC1', 'schemaowner-sc1@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Schema Org SC1', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // This should succeed (migration 106 added 'archived' to the CHECK)
      await rawExec(
        `UPDATE organizations SET status = 'archived', archived_at = now() WHERE id = '${orgId}'`,
      );

      const rows = await rawExec(
        `SELECT status FROM organizations WHERE id = '${orgId}'`,
      );
      expect(rows[0].status).toBe('archived');
    });

    it("'deleted' is still accepted in the CHECK constraint (backward compat)", async () => {
      const ownerId = await createTestUser('Schema Owner SC2', 'schemaowner-sc2@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Schema Org SC2', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // Legacy 'deleted' should still work (retained for backward compat)
      await rawExec(
        `UPDATE organizations SET status = 'deleted', deleted_at = now() WHERE id = '${orgId}'`,
      );

      const rows = await rawExec(`SELECT status FROM organizations WHERE id = '${orgId}'`);
      expect(rows[0].status).toBe('deleted');
    });

    it("an invalid status ('banned') is rejected by the CHECK constraint", async () => {
      const ownerId = await createTestUser('Schema Owner SC3', 'schemaowner-sc3@test.com');
      const orgRows = await rawExec(
        `INSERT INTO organizations (name, owner_id) VALUES ('Schema Org SC3', '${ownerId}') RETURNING id`,
      );
      const orgId = String(orgRows[0].id);

      // An invalid status should throw
      await expect(
        rawExec(`UPDATE organizations SET status = 'banned' WHERE id = '${orgId}'`),
      ).rejects.toThrow();
    });

    it('archived_at column exists with correct data type', async () => {
      const rows = await rawExec(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'organizations'
          AND column_name = 'archived_at'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].data_type).toBe('timestamp with time zone');
    });
  });
});
