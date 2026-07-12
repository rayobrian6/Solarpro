/**
 * tests/phase1b1-route-enforcement.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 2: Authorization Enforcement Safety
 *
 * These tests verify that authorization enforcement is fail-closed: once
 * the authority master switch (ENTERPRISE_ORG_AUTHORITY_ENABLED) is on,
 * denied decisions are ALWAYS enforced — regardless of the
 * ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED flag. This corrects the Phase 1B
 * defect where enforce*() functions only threw when the enforcement flag was
 * true, creating an advisory fall-through that allowed denied actions to
 * proceed when the flag was false.
 *
 * Coverage areas:
 *   1. enforceAuthz() always throws AuthzError on denied (regardless of flag)
 *   2. enforceMemberAction() always throws AuthzError on denied (regardless of flag)
 *   3. GET /api/organizations/[id]/members enforces denial even when enforcement flag is off
 *   4. POST /api/organizations/[id]/members enforces denial even when enforcement flag is off
 *   5. PATCH /api/organizations/[id]/members/[userId] enforces denial even when flag is off
 *   6. DELETE /api/organizations/[id]/members/[userId] enforces denial even when flag is off
 *
 * These tests run against a real PostgreSQL test database. They are gated
 * on TEST_DATABASE_URL — if the env var is not set, all tests skip gracefully.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

// ============================================================================
// Module Mocks — route all Neon SQL to the local pg test database
// ============================================================================

vi.mock('@neondatabase/serverless', async () => {
  const mockModule = await import('./__mocks__/neon-serverless');
  return {
    neon: mockModule.neon,
    neonConfig: mockModule.neonConfig,
  };
});

vi.mock('@/lib/db-ready', async () => {
  const mockModule = await import('./__mocks__/neon-serverless');
  return {
    getDbWithRetry: async () => mockModule.neon(),
    isDbReady: () => true,
  };
});

// Mock @/lib/rateLimitGuard — always allows in tests
vi.mock('@/lib/rateLimitGuard', () => ({
  rateLimitGuard: async () => ({ blocked: false, response: undefined }),
}));

// Mock @/lib/auth — getUserFromRequest returns a configurable test user
interface MockSessionUser {
  id: string;
  name: string;
  email: string;
  company?: string;
}

let mockSessionUser: MockSessionUser | null = null;

function setMockUser(user: MockSessionUser | null): void {
  mockSessionUser = user;
}

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getUserFromRequest: () => mockSessionUser,
  };
});

// ============================================================================
// Test Database Configuration
// ============================================================================

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b1_route_enforcement_test';

const MIGRATION_016 = join(process.cwd(), 'lib', 'migrations', '016_organizations.sql');
const MIGRATION_105 = join(
  process.cwd(),
  'lib',
  'migrations',
  '105_organization_authority_foundation.sql',
);

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let rawPool: Pool | null = null;

// Minimal users table DDL (same as the authority boundary test)
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

// ============================================================================
// Environment Management
// ============================================================================

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function saveEnv(key: string): void {
  if (!(key in ORIGINAL_ENV)) {
    ORIGINAL_ENV[key] = key in process.env ? process.env[key] : undefined;
  }
}

/**
 * Set up test environment with authority enabled but enforcement flag
 * configurable. The key test scenario is: authority ON, enforcement OFF —
 * denied decisions must still block the action.
 */
function setupTestEnv(enforcementEnabled: boolean): void {
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
  process.env.ENTERPRISE_ORG_AUTHZ_ENFORCEMENT_ENABLED = enforcementEnabled ? 'true' : 'false';
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

// ============================================================================
// Raw SQL helper (for setup and assertions, bypassing the Neon shim)
// ============================================================================

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

/** Create a NextRequest with the mock user's session. */
function makeRequest(method: string, body?: unknown): NextRequest {
  const url = 'http://localhost:3000/api/organizations/test/members';
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

// ============================================================================
// Test Suite
// ============================================================================

describeOrSkip('Phase 1B.1 — Route Enforcement Safety Tests (Workstream 2)', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;

    // Start with enforcement enabled for initial setup
    setupTestEnv(true);

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
    } finally {
      client.release();
    }
  }, 30000);

  // ════════════════════════════════════════════════════════════════════════════
  // Section 1: enforceAuthz() always throws on denied (regardless of flag)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 1: enforceAuthz() always throws on denied', () => {
    it('throws AuthzError when denied and enforcement flag is ON', async () => {
      setupTestEnv(true);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { enforceAuthz, AuthzError } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Owner', 'owner_s1a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s1a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S1A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      await expect(enforceAuthz(outsiderId, orgId, 'member:view')).rejects.toThrow();
      try {
        await enforceAuthz(outsiderId, orgId, 'member:view');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthzError);
        expect((e as InstanceType<typeof AuthzError>).reason).toBe('not_a_member');
      }
    });

    it('throws AuthzError when denied and enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { enforceAuthz, AuthzError } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Owner', 'owner_s1b@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s1b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S1B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Key test: enforcement flag is OFF, but enforceAuthz MUST still throw
      await expect(enforceAuthz(outsiderId, orgId, 'member:view')).rejects.toThrow();
      try {
        await enforceAuthz(outsiderId, orgId, 'member:view');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthzError);
        expect((e as InstanceType<typeof AuthzError>).reason).toBe('not_a_member');
      }
    });

    it('does NOT throw when allowed (enforcement flag OFF)', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { enforceAuthz } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Owner', 'owner_s1c@test.com');

      const orgResult = await createOrganizationWithOwner('Org S1C', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      // Owner is a member with owner role — should be allowed, no throw
      await expect(enforceAuthz(ownerId, orgId, 'member:view')).resolves.toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 2: enforceMemberAction() always throws on denied (regardless of flag)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 2: enforceMemberAction() always throws on denied', () => {
    it('throws AuthzError when denied and enforcement flag is ON', async () => {
      setupTestEnv(true);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { enforceMemberAction, AuthzError } = await import(
        '@/lib/organizations/authorization'
      );

      const ownerId = await createTestUser('Owner', 'owner_s2a@test.com');
      const memberId = await createTestUser('Member', 'member_s2a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s2a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S2A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      // Outsider tries to remove a member — must be denied
      await expect(
        enforceMemberAction(outsiderId, orgId, memberId, 'remove'),
      ).rejects.toThrow();
      try {
        await enforceMemberAction(outsiderId, orgId, memberId, 'remove');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthzError);
      }
    });

    it('throws AuthzError when denied and enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { enforceMemberAction, AuthzError } = await import(
        '@/lib/organizations/authorization'
      );

      const ownerId = await createTestUser('Owner', 'owner_s2b@test.com');
      const memberId = await createTestUser('Member', 'member_s2b@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s2b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S2B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      // Key test: enforcement flag is OFF, but enforceMemberAction MUST still throw
      await expect(
        enforceMemberAction(outsiderId, orgId, memberId, 'remove'),
      ).rejects.toThrow();
      try {
        await enforceMemberAction(outsiderId, orgId, memberId, 'remove');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthzError);
      }
    });

    it('does NOT throw when allowed (enforcement flag OFF)', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { enforceMemberAction } = await import('@/lib/organizations/authorization');

      const ownerId = await createTestUser('Owner', 'owner_s2c@test.com');
      const memberId = await createTestUser('Member', 'member_s2c@test.com');

      const orgResult = await createOrganizationWithOwner('Org S2C', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      // Owner removes a member — should be allowed, no throw
      await expect(
        enforceMemberAction(ownerId, orgId, memberId, 'remove'),
      ).resolves.toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 3: GET /api/organizations/[id]/members route enforcement
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 3: GET /members route enforces denial even when enforcement flag is off', () => {
    it('returns 403 for non-member when enforcement flag is ON', async () => {
      setupTestEnv(true);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { GET } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s3a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s3a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S3A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s3a@test.com' });

      const req = makeRequest('GET');
      const res = await GET(req, { params: { id: orgId } });
      expect(res.status).toBe(403);
    });

    it('returns 403 for non-member when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { GET } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s3b@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s3b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S3B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s3b@test.com' });

      // Key test: enforcement flag is OFF, but the route MUST still deny
      const req = makeRequest('GET');
      const res = await GET(req, { params: { id: orgId } });
      expect(res.status).toBe(403);
    });

    it('returns 200 for member when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { GET } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s3c@test.com');

      const orgResult = await createOrganizationWithOwner('Org S3C', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser({ id: ownerId, name: 'Owner', email: 'owner_s3c@test.com' });

      const req = makeRequest('GET');
      const res = await GET(req, { params: { id: orgId } });
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 4: POST /api/organizations/[id]/members route enforcement
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 4: POST /members route enforces denial even when enforcement flag is off', () => {
    it('returns 403 for non-member trying to invite when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { POST } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s4a@test.com');
      const memberId = await createTestUser('Member', 'member_s4a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s4a@test.com');
      const targetId = await createTestUser('Target', 'target_s4a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S4A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s4a@test.com' });

      // Key test: enforcement flag is OFF, but the route MUST still deny
      const req = makeRequest('POST', { userId: targetId, role: 'member' });
      const res = await POST(req, { params: { id: orgId } });
      expect(res.status).toBe(403);
    });

    it('returns 201 for owner inviting a member when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { POST } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s4b@test.com');
      const targetId = await createTestUser('Target', 'target_s4b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S4B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser({ id: ownerId, name: 'Owner', email: 'owner_s4b@test.com' });

      const req = makeRequest('POST', { userId: targetId, role: 'member' });
      const res = await POST(req, { params: { id: orgId } });
      expect(res.status).toBe(201);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 5: PATCH /api/organizations/[id]/members/[userId] route enforcement
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 5: PATCH /members/[userId] enforces denial even when enforcement flag is off', () => {
    it('returns 403 for non-member trying to change role when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { PATCH } = await import('@/app/api/organizations/[id]/members/[userId]/route');

      const ownerId = await createTestUser('Owner', 'owner_s5a@test.com');
      const memberId = await createTestUser('Member', 'member_s5a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s5a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S5A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s5a@test.com' });

      // Key test: enforcement flag is OFF, but the route MUST still deny
      const req = makeRequest('PATCH', { role: 'admin' });
      const res = await PATCH(req, { params: { id: orgId, userId: memberId } });
      expect(res.status).toBe(403);
    });

    it('returns 403 for non-member trying to suspend when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { PATCH } = await import('@/app/api/organizations/[id]/members/[userId]/route');

      const ownerId = await createTestUser('Owner', 'owner_s5b@test.com');
      const memberId = await createTestUser('Member', 'member_s5b@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s5b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S5B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s5b@test.com' });

      const req = makeRequest('PATCH', { action: 'suspend' });
      const res = await PATCH(req, { params: { id: orgId, userId: memberId } });
      expect(res.status).toBe(403);
    });

    it('returns 200 for owner changing a member role when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { PATCH } = await import('@/app/api/organizations/[id]/members/[userId]/route');

      const ownerId = await createTestUser('Owner', 'owner_s5c@test.com');
      const memberId = await createTestUser('Member', 'member_s5c@test.com');

      const orgResult = await createOrganizationWithOwner('Org S5C', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: ownerId, name: 'Owner', email: 'owner_s5c@test.com' });

      const req = makeRequest('PATCH', { role: 'admin' });
      const res = await PATCH(req, { params: { id: orgId, userId: memberId } });
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 6: DELETE /api/organizations/[id]/members/[userId] route enforcement
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 6: DELETE /members/[userId] enforces denial even when enforcement flag is off', () => {
    it('returns 403 for non-member trying to remove when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { DELETE } = await import('@/app/api/organizations/[id]/members/[userId]/route');

      const ownerId = await createTestUser('Owner', 'owner_s6a@test.com');
      const memberId = await createTestUser('Member', 'member_s6a@test.com');
      const outsiderId = await createTestUser('Outsider', 'outsider_s6a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S6A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: outsiderId, name: 'Outsider', email: 'outsider_s6a@test.com' });

      // Key test: enforcement flag is OFF, but the route MUST still deny
      const req = makeRequest('DELETE');
      const res = await DELETE(req, { params: { id: orgId, userId: memberId } });
      expect(res.status).toBe(403);
    });

    it('returns 200 for owner removing a member when enforcement flag is OFF', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner, addMember } = await import(
        '@/lib/organizations/memberships'
      );
      const { DELETE } = await import('@/app/api/organizations/[id]/members/[userId]/route');

      const ownerId = await createTestUser('Owner', 'owner_s6b@test.com');
      const memberId = await createTestUser('Member', 'member_s6b@test.com');

      const orgResult = await createOrganizationWithOwner('Org S6B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      const addResult = await addMember(orgId, memberId, 'member', ownerId);
      if (!addResult.ok) return;

      setMockUser({ id: ownerId, name: 'Owner', email: 'owner_s6b@test.com' });

      const req = makeRequest('DELETE');
      const res = await DELETE(req, { params: { id: orgId, userId: memberId } });
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 7: Regression — flags cannot convert denial to allow
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 7: Flags cannot convert a denial to an allow', () => {
    it('returns 401 when no user session (regardless of flags)', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { GET } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s7a@test.com');

      const orgResult = await createOrganizationWithOwner('Org S7A', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser(null);

      const req = makeRequest('GET');
      const res = await GET(req, { params: { id: orgId } });
      expect(res.status).toBe(401);
    });

    it('platform admin without membership is denied (enforcement flag OFF)', async () => {
      setupTestEnv(false);
      const { createOrganizationWithOwner } = await import('@/lib/organizations/memberships');
      const { GET } = await import('@/app/api/organizations/[id]/members/route');

      const ownerId = await createTestUser('Owner', 'owner_s7b@test.com');
      const adminId = await createTestUser('Platform Admin', 'admin_s7b@test.com', 'admin');

      const orgResult = await createOrganizationWithOwner('Org S7B', ownerId);
      if (!orgResult.ok) return;
      const orgId = orgResult.data.organization.id;

      setMockUser({ id: adminId, name: 'Platform Admin', email: 'admin_s7b@test.com' });

      // Platform admin without org membership must be denied (ADR-004)
      const req = makeRequest('GET');
      const res = await GET(req, { params: { id: orgId } });
      expect(res.status).toBe(403);
    });
  });
});
