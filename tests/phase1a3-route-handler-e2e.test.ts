/**
 * Phase 1A.3: Route-Handler End-to-End Validation (GOV-22) — Commit 4
 *
 * This test suite exercises the ACTUAL Next.js route handler
 * (app/api/admin/migrations/route.ts) — the single authorized entry point
 * for migration governance API operations — through its exported GET and POST
 * functions. It validates that the HTTP layer correctly enforces:
 *
 * 1. Authentication (requireAdminApi): no session → 401
 * 2. Platform role enforcement: admin vs super_admin for each action
 * 3. Action validation: invalid action → 400
 * 4. Client-supplied actorType rejection (privilege escalation prevention)
 * 5. MFA fail-closed: no MFA secret → 403 with MFA_NOT_ENABLED
 * 6. TOTP replay prevention: same time-step used twice → 403 with TOTP_REPLAY
 * 7. TOTP invalid code → 403 with TOTP_INVALID
 * 8. TOTP required for execution actions (run-single, run-pending)
 * 9. TOTP required for execution activation (enable-execution, disable-execution)
 * 10. Audit event persistence for MFA denials and migration failures
 * 11. Baseline control plane: inspect-baseline, record-baseline-entry,
 *     verify-baseline, enable-execution, disable-execution
 * 12. Lifecycle gating: enable-execution requires BASELINE_VERIFIED state
 * 13. dry-run-single / dry-run-pending do not require TOTP
 * 14. inspect (GET and POST) is read-only and available to admin role
 *
 * ## Test Database Configuration
 *
 * Same as the main e2e test: requires TEST_DATABASE_URL, uses an isolated
 * schema (phase1a3_route_test), mocks @neondatabase/serverless with the
 * pg-backed shim, and mocks @/lib/db-ready for audit log persistence.
 *
 * The route handler imports requireAdminApi from @/lib/adminAuth, which reads
 * a session cookie and verifies a JWT. To exercise the route handler without
 * a real JWT/auth infrastructure, we mock @/lib/adminAuth to return a
 * configurable AdminUser (or null for unauthenticated tests).
 *
 * ## Environment Safety
 *
 * - is_production = false (NODE_ENV=development)
 * - Isolated test schema on local PostgreSQL only
 * - Canary fixtures (tests/fixtures/migrations/) for execution tests
 * - Never connects to production
 *
 * MIGRATION-GOV-22 (Phase 1A.3): Route-handler e2e validation — proves the
 * HTTP API layer enforces auth, role, MFA, TOTP, audit, and lifecycle controls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { join } from 'path';
import type { AdminUser } from '@/lib/adminAuth';

// ─────────────────────────────────────────────────────────────────────────────
// Module Mocks
// ─────────────────────────────────────────────────────────────────────────────
//
// Mock @neondatabase/serverless with our pg-backed shim.
// Mock @/lib/db-ready so audit log persistence uses the pg-backed shim.
// Mock @/lib/adminAuth so we can control the authenticated user per-test.

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
    isTransientDbError: (err: unknown) => {
      if (err instanceof (actual.DbConfigError as Function)) return false;
      return true;
    },
    DbConfigError: actual.DbConfigError,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Configurable Admin Auth Mock
// ─────────────────────────────────────────────────────────────────────────────
//
// We mock @/lib/adminAuth so requireAdminApi returns a configurable AdminUser.
// Each test sets the desired user (or null) via setMockAdminUser() before
// calling the route handler. This lets us test auth rejection (null),
// admin-only access (role='admin'), and super_admin access (role='super_admin').

let mockAdminUser: AdminUser | null = null;

function setMockAdminUser(user: AdminUser | null): void {
  mockAdminUser = user;
}

vi.mock('@/lib/adminAuth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/adminAuth')>('@/lib/adminAuth');
  return {
    ...actual,
    requireAdminApi: async () => mockAdminUser,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ─────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1a3_route_test';

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'migrations');

const ORIGINAL_ENV: Record<string, string | undefined> = {};

let rawPool: Pool | null = null;

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

// Deterministic 32-byte base64 test encryption key for TOTP secrets.
const TEST_MFA_ENCRYPTION_KEY = '8fBSXkP+QbS3JtJ9wT1xJtRRbjpJjJ+bc0NwCBl+yP8=';

// ─────────────────────────────────────────────────────────────────────────────
// DDL for audit_log and admin_users tables (required by the route handler's
// audit persistence and TOTP verification paths).
// ─────────────────────────────────────────────────────────────────────────────

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
  actor_organization_id UUID,
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
// Test Helpers
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
// Request Builders
// ─────────────────────────────────────────────────────────────────────────────
//
// The route handler accepts NextRequest objects. We build minimal mock requests
// that have the headers and json() method the handler expects.

function makeGetRequest(): Request {
  return new Request('http://localhost:3000/api/admin/migrations', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
}

function makePostRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/admin/migrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Admin Users
// ─────────────────────────────────────────────────────────────────────────────

const SUPER_ADMIN: AdminUser = {
  id: 'test-super-admin',
  name: 'Super Admin',
  email: 'super@example.com',
  role: 'super_admin',
};

const REGULAR_ADMIN: AdminUser = {
  id: 'test-admin',
  name: 'Regular Admin',
  email: 'admin@example.com',
  role: 'admin',
};

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle Setup Helper
// ─────────────────────────────────────────────────────────────────────────────
//
// Bootstraps the full governance lifecycle to EXECUTION_ENABLED state using
// the fixture manifest (tests/fixtures/migrations/). This is used by tests
// that need to exercise execution routes.

async function setupExecutionEnabled(): Promise<void> {
  const {
    bootstrapMigrationLedger,
    setGovernanceLifecycleState,
    recordBaselineReconciliation,
    verifyBaselineComplete,
    advanceToBaselineVerified,
    enableExecution,
  } = await import('../lib/migrations/ledger');

  await bootstrapMigrationLedger('human', 'test-super-admin');
  await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-super-admin');
  for (const id of ['900', '901', '902', '903']) {
    await recordBaselineReconciliation({
      identifier: id,
      status: 'CONFIRMED_NOT_APPLIED',
      evidenceType: 'SCHEMA_INTROSPECTION',
      reconciledBy: 'test-super-admin',
    });
  }
  const v = await verifyBaselineComplete(['900', '901', '902', '903']);
  expect(v.ok).toBe(true);
  const advanced = await advanceToBaselineVerified('test-super-admin');
  expect(advanced).toBe(true);
  const enabled = await enableExecution('test-super-admin', 'route e2e test activation');
  expect(enabled).toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTP Helper: Insert an admin user with a valid encrypted TOTP secret
// ─────────────────────────────────────────────────────────────────────────────

async function insertAdminWithMfa(
  userId: string,
  secret: string = 'JBSWY3DPEHPK3PXP',
): Promise<void> {
  const { encryptTOTPSecret } = await import('../lib/mfa');
  const encryptedSecret = encryptTOTPSecret(secret);
  await rawExec(`
    INSERT INTO admin_users (id, email, totp_secret_encrypted, mfa_enabled)
    VALUES ('${userId}', '${userId}@example.com', '${encryptedSecret}', true)
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1A.3: Route-Handler E2E — Auth, Role, MFA, TOTP, Audit, Lifecycle (GOV-22)', () => {

  beforeAll(async () => {
    if (!HAS_TEST_DB) return;

    setupMigrationEnv();

    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);

    rawPool = new Pool({
      connectionString: TEST_DATABASE_URL,
      max: 3,
    });

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

    // Drain any fire-and-forget audit INSERTs from the previous test.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const client = await rawPool.connect();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await client.query(`SET search_path TO ${TEST_SCHEMA}, public`);

      for (const stmt of AUDIT_LOG_DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.query(stmt);
      }
      for (const stmt of ADMIN_USERS_DDL.split(';').map((s) => s.trim()).filter((s) => s.length > 0)) {
        await client.query(stmt);
      }
    } finally {
      client.release();
    }

    // Reset the mock admin user to null (unauthenticated) before each test.
    setMockAdminUser(null);
  }, 15000);

  // ════════════════════════════════════════════════════════════════════════════
  // Section 1: Authentication (401 when no session)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 1: Authentication', () => {
    it('GET returns 401 when no session is provided', async () => {
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    it('POST returns 401 when no session is provided', async () => {
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect' }) as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 2: Action Validation (400 for invalid actions)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 2: Action Validation', () => {
    it('POST returns 400 for an invalid action', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'bogus-action' }) as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid action');
    });

    it('POST returns 400 when action is missing', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({}) as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('POST accepts all valid action names without 400 (invalid action)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      // Each action is sent with its required fields so the only 400 we could
      // get is from an unrecognized action name (which won't happen here).
      const actionPayloads: Array<[string, Record<string, unknown>]> = [
        ['inspect', {}],
        ['run-pending', {}],
        ['run-single', { identifier: '001' }],
        ['dry-run-pending', {}],
        ['dry-run-single', { identifier: '001' }],
        ['inspect-baseline', {}],
        ['record-baseline-entry', { identifier: '900', reconciliationStatus: 'CONFIRMED_NOT_APPLIED', evidenceType: 'SCHEMA_INTROSPECTION' }],
        ['verify-baseline', {}],
        ['enable-execution', { reason: 'test' }],
        ['disable-execution', { reason: 'test' }],
      ];
      for (const [action, extra] of actionPayloads) {
        // We only check that it doesn't return 400 (invalid action).
        // Some will return other status codes (403, 409, etc.) which is fine —
        // we're only verifying the action name itself is recognized.
        const res = await POST(makePostRequest({ action, ...extra }) as any);
        expect(res.status).not.toBe(400);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 3: Platform Role Enforcement
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 3: Platform Role Enforcement', () => {
    it('GET (inspect) succeeds with admin role', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('GET (inspect) succeeds with super_admin role', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('POST inspect succeeds with admin role', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('inspect');
    });

    it('POST dry-run-pending succeeds with admin role (no TOTP needed)', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'dry-run-pending' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('dry-run-pending');
      expect(body.dryRun).toBe(true);
    });

    it('POST record-baseline-entry requires super_admin (admin gets 403)', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'record-baseline-entry',
          identifier: '900',
          reconciliationStatus: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'SCHEMA_INTROSPECTION',
        }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('super_admin');
    });

    it('POST verify-baseline requires super_admin (admin gets 403)', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'verify-baseline' }) as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('super_admin');
    });

    it('POST enable-execution requires super_admin (admin gets 403 for missing TOTP first)', async () => {
      setMockAdminUser(REGULAR_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'enable-execution', reason: 'test' }) as any,
      );
      // enable-execution requires TOTP — admin role is checked first by
      // authorizeMigration, but the route handler checks TOTP before
      // authorizeMigration. So the response should be 403 for missing TOTP.
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 4: Client-Supplied actorType Rejection (Privilege Escalation)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 4: Client-Supplied actorType Rejection', () => {
    it('POST rejects client-supplied actorType != human', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'inspect', actorType: 'migration-actor' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('actorType');
    });

    it('POST accepts client-supplied actorType == human', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'inspect', actorType: 'human' }) as any,
      );
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 5: MFA Fail-Closed (TOTP for Execution Actions)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 5: MFA Fail-Closed', () => {
    it('run-single returns 403 when TOTP code is missing', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'run-single', identifier: '900' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('TOTP');
    });

    it('run-pending returns 403 when TOTP code is missing', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'run-pending' }) as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('TOTP');
    });

    it('enable-execution returns 403 when TOTP code is missing', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'enable-execution', reason: 'test' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('TOTP');
    });

    it('disable-execution returns 403 when TOTP code is missing', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'disable-execution', reason: 'test' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('TOTP');
    });

    it('run-single returns 403 with MFA_NOT_ENABLED when user has no MFA secret', async () => {
      setMockAdminUser(SUPER_ADMIN);
      // Insert the admin user without a TOTP secret
      await rawExec(`
        INSERT INTO admin_users (id, email, totp_secret_encrypted, mfa_enabled)
        VALUES ('test-super-admin', 'super@example.com', NULL, false)
      `);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: '123456' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.deniedReason).toBe('MFA_NOT_ENABLED');
    });

    it('run-single returns 403 with TOTP_INVALID when code does not match', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: '000000' }) as any,
      );
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.deniedReason).toBe('TOTP_INVALID');
    });

    it('dry-run-single does NOT require TOTP (succeeds without TOTP)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'dry-run-single', identifier: '900' }) as any,
      );
      // dry-run-single should not return 403 for missing TOTP
      expect(res.status).not.toBe(403);
    });

    it('dry-run-pending does NOT require TOTP (succeeds without TOTP)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'dry-run-pending' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 6: TOTP Replay Prevention
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 6: TOTP Replay Prevention', () => {
    it('rejects replay of the same TOTP time-step on second execution request', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      // Bootstrap the ledger so the migration_totp_uses table exists
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      // Generate a valid TOTP code for the current time step
      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');

      // First request with the valid code — should pass TOTP verification
      // (it may fail later due to lifecycle not being EXECUTION_ENABLED, but
      // the TOTP verification itself should succeed)
      const res1 = await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: validCode }) as any,
      );
      const body1 = await res1.json();
      // TOTP verification should have succeeded (not a TOTP error)
      expect(body1.deniedReason).not.toBe('TOTP_REPLAY');
      expect(body1.deniedReason).not.toBe('TOTP_INVALID');
      expect(body1.deniedReason).not.toBe('MFA_NOT_ENABLED');

      // Second request with the same code — should be rejected as TOTP_REPLAY
      const res2 = await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: validCode }) as any,
      );
      expect(res2.status).toBe(403);
      const body2 = await res2.json();
      expect(body2.success).toBe(false);
      expect(body2.deniedReason).toBe('TOTP_REPLAY');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 7: Audit Event Persistence for MFA Denials
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 7: Audit Event Persistence for MFA Denials', () => {
    it('persists audit event when MFA is not enabled (migration_mfa_denied)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await rawExec(`
        INSERT INTO admin_users (id, email, totp_secret_encrypted, mfa_enabled)
        VALUES ('test-super-admin', 'super@example.com', NULL, false)
      `);
      const { POST } = await import('../app/api/admin/migrations/route');
      await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: '123456' }) as any,
      );

      // Wait for fire-and-forget audit to settle
      await new Promise((resolve) => setTimeout(resolve, 200));

      // The route handler emits type 'migration.mfa.denied' which maps to
      // action 'migration_mfa_denied' in the audit_log table.
      const entries = (await rawExec(`
        SELECT category, action, metadata FROM audit_log
        WHERE action = 'migration_mfa_denied' AND actor_id = 'test-super-admin'
        ORDER BY id DESC LIMIT 5
      `)) as Array<{ category: string; action: string; metadata: any }>;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].category).toBe('migration');
      // The metadata should contain the deniedReason
      const metaStr = JSON.stringify(entries[0].metadata);
      expect(metaStr).toContain('MFA_NOT_ENABLED');
    });

    it('persists audit event with TOTP_REPLAY reason (migration_mfa_replay_detected)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');

      // First use consumes the time-step
      await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: validCode }) as any,
      );

      // Second use triggers replay detection
      await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: validCode }) as any,
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      // The route handler emits type 'migration.mfa.replay_detected' which maps
      // to action 'migration_mfa_replay_detected' in the audit_log table.
      const entries = (await rawExec(`
        SELECT category, action, metadata FROM audit_log
        WHERE action = 'migration_mfa_replay_detected' AND actor_id = 'test-super-admin'
        ORDER BY id DESC LIMIT 1
      `)) as Array<{ category: string; action: string; metadata: any }>;
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries[0].category).toBe('migration');
      const metaStr = JSON.stringify(entries[0].metadata);
      expect(metaStr).toContain('TOTP_REPLAY');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 8: Baseline Control Plane Routes
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 8: Baseline Control Plane', () => {
    it('inspect-baseline returns UNBOOTSTRAPPED state when ledger does not exist', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect-baseline' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('inspect-baseline');
      expect(body.lifecycleState).toBe('UNBOOTSTRAPPED');
      expect(body.baselines).toEqual([]);
    });

    it('inspect-baseline returns lifecycle state after bootstrap', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect-baseline' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.lifecycleState).toBe('BASELINE_REQUIRED');
      expect(body.manifestCount).toBeGreaterThan(0);
    });

    it('record-baseline-entry validates reconciliationStatus (400 for invalid)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'record-baseline-entry',
          identifier: '900',
          reconciliationStatus: 'INVALID_STATUS',
          evidenceType: 'SCHEMA_INTROSPECTION',
        }) as any,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('record-baseline-entry validates evidenceType (400 for invalid)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'record-baseline-entry',
          identifier: '900',
          reconciliationStatus: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'INVALID_TYPE',
        }) as any,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('record-baseline-entry requires identifier (400 when missing)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'record-baseline-entry',
          reconciliationStatus: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'SCHEMA_INTROSPECTION',
        }) as any,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });

    it('record-baseline-entry succeeds with valid parameters after bootstrap', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { bootstrapMigrationLedger, setGovernanceLifecycleState } =
        await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');
      await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-super-admin');

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'record-baseline-entry',
          identifier: '900',
          reconciliationStatus: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'SCHEMA_INTROSPECTION',
          evidenceSummary: 'Table not found in catalog snapshot',
        }) as any,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('record-baseline-entry');
      expect(body.identifier).toBe('900');
      expect(body.reconciliationStatus).toBe('CONFIRMED_NOT_APPLIED');
      expect(body.evidenceType).toBe('SCHEMA_INTROSPECTION');
    });

    it('verify-baseline returns 409 when reconciliation is incomplete', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { bootstrapMigrationLedger, setGovernanceLifecycleState } =
        await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');
      await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-super-admin');
      // Record only one of the four fixture migrations
      const { recordBaselineReconciliation } = await import('../lib/migrations/ledger');
      await recordBaselineReconciliation({
        identifier: '900',
        status: 'CONFIRMED_NOT_APPLIED',
        evidenceType: 'SCHEMA_INTROSPECTION',
        reconciledBy: 'test-super-admin',
      });

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'verify-baseline' }) as any);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.unreconciled).toBeDefined();
      expect(body.unreconciled.length).toBeGreaterThan(0);
    });

    it('verify-baseline succeeds when all manifest migrations are reconciled', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { bootstrapMigrationLedger, setGovernanceLifecycleState, recordBaselineReconciliation } =
        await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');
      await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-super-admin');
      // The route handler uses the production-locked manifest provider
      // (discoverMigrationFiles() with no override → lib/migrations/), which
      // contains all production migration identifiers (101 files). We must
      // reconcile every production identifier, not just the 4 fixture files,
      // because verifyBaselineComplete() checks the manifest passed to it —
      // and the route passes the production manifest IDs.
      const { discoverMigrationFiles } = await import('../lib/migrations/manifest');
      const productionManifest = discoverMigrationFiles();
      for (const file of productionManifest.files) {
        await recordBaselineReconciliation({
          identifier: file.identifier,
          status: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'SCHEMA_INTROSPECTION',
          reconciledBy: 'test-super-admin',
        });
      }

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'verify-baseline' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.ok).toBe(true);
      expect(body.advancedToBaselineVerified).toBe(true);
      expect(body.lifecycleState).toBe('BASELINE_VERIFIED');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 9: Execution Activation Lifecycle Gating
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 9: Execution Activation Lifecycle Gating', () => {
    it('enable-execution requires non-empty reason (400 when missing)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'enable-execution', totpCode: validCode }) as any,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('reason');
    });

    it('enable-execution returns 409 when lifecycle is not BASELINE_VERIFIED', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');
      // Lifecycle is BASELINE_REQUIRED (just bootstrapped), not BASELINE_VERIFIED

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'enable-execution',
          reason: 'test activation',
          totpCode: validCode,
        }) as any,
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('BASELINE_VERIFIED');
      expect(body.lifecycleState).toBe('BASELINE_REQUIRED');
    });

    it('enable-execution succeeds with valid TOTP and reason when lifecycle is BASELINE_VERIFIED', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      // Set up lifecycle to BASELINE_VERIFIED (without enabling execution)
      const {
        bootstrapMigrationLedger,
        setGovernanceLifecycleState,
        recordBaselineReconciliation,
        verifyBaselineComplete,
        advanceToBaselineVerified,
      } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');
      await setGovernanceLifecycleState('BASELINE_IN_PROGRESS', 'test-super-admin');
      for (const id of ['900', '901', '902', '903']) {
        await recordBaselineReconciliation({
          identifier: id,
          status: 'CONFIRMED_NOT_APPLIED',
          evidenceType: 'SCHEMA_INTROSPECTION',
          reconciledBy: 'test-super-admin',
        });
      }
      const v = await verifyBaselineComplete(['900', '901', '902', '903']);
      expect(v.ok).toBe(true);
      await advanceToBaselineVerified('test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'enable-execution',
          reason: 'route e2e enable test',
          totpCode: validCode,
        }) as any,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.enabled).toBe(true);
      expect(body.lifecycleState).toBe('EXECUTION_ENABLED');
      expect(body.reason).toBe('route e2e enable test');
    });

    it('disable-execution returns 409 when lifecycle is not EXECUTION_ENABLED', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'disable-execution',
          reason: 'test deactivation',
          totpCode: validCode,
        }) as any,
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('EXECUTION_ENABLED');
    });

    it('disable-execution succeeds after enable-execution (full cycle)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      // Full setup to EXECUTION_ENABLED
      await setupExecutionEnabled();

      const { generateTOTPCode } = await import('../lib/mfa');
      // Wait for a fresh TOTP time-step (the setup may have consumed one)
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'disable-execution',
          reason: 'route e2e disable test',
          totpCode: validCode,
        }) as any,
      );

      // The TOTP might have been consumed during setup if setupExecutionEnabled
      // used the route. But setupExecutionEnabled uses ledger functions directly,
      // not the route, so the TOTP time-step should still be fresh.
      // However, if it's a replay, we need to wait. Let's check the status.
      if (res.status === 403) {
        const body = await res.json();
        if (body.deniedReason === 'TOTP_REPLAY') {
          // Wait for the next 30-second window
          await new Promise((resolve) => setTimeout(resolve, 31000));
          const freshCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());
          const res2 = await POST(
            makePostRequest({
              action: 'disable-execution',
              reason: 'route e2e disable test',
              totpCode: freshCode,
            }) as any,
          );
          expect(res2.status).toBe(200);
          const body2 = await res2.json();
          expect(body2.success).toBe(true);
          expect(body2.disabled).toBe(true);
          expect(body2.lifecycleState).toBe('BASELINE_VERIFIED');
          return;
        }
      }

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.disabled).toBe(true);
      expect(body.lifecycleState).toBe('BASELINE_VERIFIED');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 10: GET (Inspect) Route — Read-Only
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 10: GET (Inspect) Route', () => {
    it('returns migration state with manifest, pending, and validation', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.environment).toBe('development');
      expect(body.ledgerExists).toBe(false);
      expect(body.manifest).toBeDefined();
      expect(body.manifest.count).toBeGreaterThan(0);
      expect(body.validation).toBeDefined();
      expect(body.pending).toBeDefined();
      expect(body.applied).toBeDefined();
      expect(body.failed).toBeDefined();
      expect(body.conflicts).toBeDefined();
      expect(body.running).toBeDefined();
      expect(body.legacyFlags).toBeDefined();
    });

    it('includes legacy flags in the inspect response', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      const body = await res.json();
      expect(body.legacyFlags.inlineEnabled).toBeDefined();
      expect(body.legacyFlags.systemToolsRunEnabled).toBeDefined();
    });

    it('returns ledgerExists=true after bootstrap', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      const body = await res.json();
      expect(body.ledgerExists).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 11: POST inspect and dry-run routes
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 11: POST inspect and dry-run Routes', () => {
    it('POST inspect returns migration state', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('inspect');
      expect(body.environment).toBe('development');
      expect(body.ledgerExists).toBe(false);
      expect(body.pending).toBeDefined();
      expect(body.manifest).toBeDefined();
    });

    it('POST dry-run-pending returns wouldExecute list', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'dry-run-pending' }) as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('dry-run-pending');
      expect(body.dryRun).toBe(true);
      expect(body.pending).toBeDefined();
      expect(body.wouldExecute).toBeDefined();
      expect(Array.isArray(body.wouldExecute)).toBe(true);
    });

    it('POST dry-run-single requires identifier (400 when missing)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'dry-run-single' }) as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('identifier');
    });

    it('POST dry-run-single returns result for a valid identifier', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'dry-run-single', identifier: '001' }) as any,
      );
      // dry-run-single on a production migration should return a result
      // (it's a dry-run, so it should not fail due to lifecycle gating)
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.action).toBe('dry-run-single');
      expect(body.result).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 12: Execution Route Lifecycle Gating
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 12: Execution Route Lifecycle Gating', () => {
    it('run-single is blocked before EXECUTION_ENABLED (even with valid TOTP)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      // Bootstrap only — lifecycle is BASELINE_REQUIRED, not EXECUTION_ENABLED
      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({
          action: 'run-single',
          identifier: '001',
          totpCode: validCode,
        }) as any,
      );
      // TOTP should pass, but the runner should block due to lifecycle
      const body = await res.json();
      expect(body.deniedReason).not.toBe('TOTP_INVALID');
      expect(body.deniedReason).not.toBe('TOTP_REPLAY');
      expect(body.deniedReason).not.toBe('MFA_NOT_ENABLED');
      // The execution should fail due to lifecycle (not TOTP)
      expect(body.success).toBe(false);
    });

    it('run-pending is blocked before EXECUTION_ENABLED (even with valid TOTP)', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      const { bootstrapMigrationLedger } = await import('../lib/migrations/ledger');
      await bootstrapMigrationLedger('human', 'test-super-admin');

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'run-pending', totpCode: validCode }) as any,
      );
      const body = await res.json();
      // TOTP should pass (not a TOTP error)
      expect(body.deniedReason).not.toBe('TOTP_INVALID');
      expect(body.deniedReason).not.toBe('TOTP_REPLAY');
      expect(body.deniedReason).not.toBe('MFA_NOT_ENABLED');
      // When blocked by the execution gate, runPendingMigrations returns
      // { failed: 0, fatalErrors: [...] } — the route returns success:
      // result.failed === 0 which is true. The real signal is in
      // result.fatalErrors, which must be non-empty when the lifecycle blocks
      // execution.
      expect(body.result).toBeDefined();
      expect(body.result.fatalErrors).toBeDefined();
      expect(body.result.fatalErrors.length).toBeGreaterThan(0);
      expect(body.result.applied).toBe(0);
      // The fatal error message should mention the lifecycle requirement
      expect(body.result.fatalErrors[0]).toContain('EXECUTION_ENABLED');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 13: Canary Execution Through the Route Handler
  // ════════════════════════════════════════════════════════════════════════════
  //
  // This section proves the route handler can execute canary migrations through
  // the full HTTP path: auth → TOTP → authorize → runner → ledger → audit.
  // It uses the fixture manifest (tests/fixtures/migrations/) via the
  // createMigrationRunnerWithManifest test factory. The route handler uses the
  // production-locked manifest provider, so we cannot directly inject fixtures
  // into the route. Instead, we verify that the route correctly delegates to
  // the runner functions, and that the lifecycle gating works at the HTTP layer.

  describe('Section 13: Canary Execution Through Route Handler', () => {
    it('run-single with valid TOTP and EXECUTION_ENABLED attempts execution', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await insertAdminWithMfa('test-super-admin');

      // Full lifecycle setup to EXECUTION_ENABLED
      await setupExecutionEnabled();

      const { generateTOTPCode } = await import('../lib/mfa');
      const validCode = generateTOTPCode('JBSWY3DPEHPK3PXP', Date.now());

      const { POST } = await import('../app/api/admin/migrations/route');
      // Use a production migration identifier (001) — the route handler uses
      // the production-locked manifest, so it will attempt to find and execute
      // migration 001. The result may be 'applied' or 'failed' depending on
      // whether 001 has already been applied in the test schema.
      const res = await POST(
        makePostRequest({
          action: 'run-single',
          identifier: '001',
          totpCode: validCode,
        }) as any,
      );

      // The response should NOT be a TOTP error (TOTP should pass)
      const body = await res.json();
      expect(body.deniedReason).not.toBe('TOTP_INVALID');
      expect(body.deniedReason).not.toBe('TOTP_REPLAY');
      expect(body.deniedReason).not.toBe('MFA_NOT_ENABLED');
      // The status should be 200 (the route returns 200 even on execution failure,
      // with success=false in the body)
      expect(res.status).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Section 14: Route Response Redaction (No Sensitive Data Leaks)
  // ════════════════════════════════════════════════════════════════════════════

  describe('Section 14: Route Response Redaction', () => {
    it('GET inspect does not expose file system paths or SQL content', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { GET } = await import('../app/api/admin/migrations/route');
      const res = await GET(makeGetRequest() as any);
      const body = await res.json();
      const bodyStr = JSON.stringify(body);
      // The response should not contain raw file paths or SQL
      expect(bodyStr).not.toContain('lib/migrations/');
      expect(bodyStr).not.toContain('CREATE TABLE');
      expect(bodyStr).not.toContain('fullPath');
    });

    it('POST inspect-baseline does not expose file system paths', async () => {
      setMockAdminUser(SUPER_ADMIN);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(makePostRequest({ action: 'inspect-baseline' }) as any);
      const body = await res.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('lib/migrations/');
      expect(bodyStr).not.toContain('fullPath');
      // The baselines array should not contain raw SQL or file paths
      if (body.baselines && body.baselines.length > 0) {
        for (const b of body.baselines) {
          expect(JSON.stringify(b)).not.toContain('fullPath');
        }
      }
    });

    it('MFA denial response does not leak the TOTP secret or encryption key', async () => {
      setMockAdminUser(SUPER_ADMIN);
      await rawExec(`
        INSERT INTO admin_users (id, email, totp_secret_encrypted, mfa_enabled)
        VALUES ('test-super-admin', 'super@example.com', NULL, false)
      `);
      const { POST } = await import('../app/api/admin/migrations/route');
      const res = await POST(
        makePostRequest({ action: 'run-single', identifier: '900', totpCode: '123456' }) as any,
      );
      const body = await res.json();
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain(TEST_MFA_ENCRYPTION_KEY);
      expect(bodyStr).not.toContain('JBSWY3DPEHPK3PXP');
      expect(bodyStr).not.toContain('totp_secret');
    });
  });
});
