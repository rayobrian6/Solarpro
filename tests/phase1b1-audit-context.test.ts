/**
 * tests/phase1b1-audit-context.test.ts
 *
 * Phase 1B.1 — Organization Authority Boundary and Lifecycle Correction
 * Workstream 5: Tenant-Aware Audit Context (ADR-013, T-08)
 *
 * These tests verify that the audit_log table now carries organization context
 * and that the hash chain is partitioned per-org (ADR-013 Option B):
 *
 *   1. Migration 107 adds actor_organization_id and resource_owner_organization_id
 *      columns to audit_log (T-08 fix).
 *   2. writeAuditLog() stores org context in both columns.
 *   3. Per-org hash chain partitioning: each org's prev_hash links to the
 *      previous entry WITH THE SAME actor_organization_id. Platform-level
 *      events (NULL org) form a separate chain.
 *   4. verifyAuditChain() accepts an optional orgId parameter to verify
 *      only that org's chain.
 *   5. queryAuditLog() supports filtering by actor_organization_id and
 *      resource_owner_organization_id (tenant-scoped compliance queries).
 *   6. auditOrgAuthorityEvent() fails-closed — throws if the audit write fails.
 *   7. logAuthzDecision() routes through the structured audit log with
 *      actor_organization_id set (no longer console.warn-only).
 *   8. Organization-specific audit actions exist in the AuditAction vocabulary.
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

vi.mock('@/lib/rateLimitGuard', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  RateLimitResult: class {},
}));

// ────────────────────────────────────────────────────────────────────────────
// Test Database Configuration
// ────────────────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;

const TEST_SCHEMA = 'phase1b1_audit_context_test';

const MIGRATION_100 = join(
  process.cwd(),
  'lib',
  'migrations',
  '100_compliance_audit_mfa_consent.sql',
);
const MIGRATION_107 = join(
  process.cwd(),
  'lib',
  'migrations',
  '107_audit_log_org_context.sql',
);

const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

let rawPool: Pool | null = null;

// Minimal users table DDL
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

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describeOrSkip('Phase 1B.1 — Tenant-Aware Audit Context (Workstream 5, ADR-013, T-08)', () => {
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

      // Apply migration 100 (creates audit_log table)
      const migration100 = readFileSync(MIGRATION_100, 'utf-8');
      await client.query(migration100);

      // Apply migration 107 (adds org context columns to audit_log)
      const migration107 = readFileSync(MIGRATION_107, 'utf-8');
      await client.query(migration107);
    } finally {
      client.release();
    }
  }, 30000);

  // ══════════════════════════════════════════════════════════════════════════
  // Section 1: Schema — Migration 107 adds org context columns
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 1: Migration 107 — org context columns exist', () => {
    it('actor_organization_id column exists on audit_log', async () => {
      const rows = await rawExec(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'audit_log'
          AND column_name = 'actor_organization_id'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].column_name).toBe('actor_organization_id');
      expect(rows[0].data_type).toBe('uuid');
    });

    it('resource_owner_organization_id column exists on audit_log', async () => {
      const rows = await rawExec(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'audit_log'
          AND column_name = 'resource_owner_organization_id'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].column_name).toBe('resource_owner_organization_id');
      expect(rows[0].data_type).toBe('uuid');
    });

    it('actor_organization_id column is nullable (platform-level events)', async () => {
      const rows = await rawExec(`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = '${TEST_SCHEMA}'
          AND table_name = 'audit_log'
          AND column_name = 'actor_organization_id'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].is_nullable).toBe('YES');
    });

    it('indexes for org-scoped queries exist', async () => {
      const rows = await rawExec(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${TEST_SCHEMA}'
          AND tablename = 'audit_log'
          AND indexname IN ('idx_audit_log_actor_org', 'idx_audit_log_resource_org')
      `);
      expect(rows.length).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 2: writeAuditLog stores org context
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 2: writeAuditLog stores org context', () => {
    it('stores actor_organization_id when provided', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      const hash = await writeAuditLog({
        category: 'admin',
        action: 'organization_archived',
        description: 'Test org archived event',
        actor_id: 'test-user-1',
        actor_email: 'test@test.com',
        actor_role: 'admin',
        target_type: 'organization',
        target_id: orgId,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgId,
        resource_owner_organization_id: orgId,
      });

      expect(hash).not.toBeNull();

      const rows = await rawExec(`
        SELECT actor_organization_id, resource_owner_organization_id
        FROM audit_log
        WHERE entry_hash = '${hash}'
      `);
      expect(rows.length).toBe(1);
      expect(String(rows[0].actor_organization_id)).toBe(orgId);
      expect(String(rows[0].resource_owner_organization_id)).toBe(orgId);
    });

    it('stores NULL org context for platform-level events', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      const hash = await writeAuditLog({
        category: 'auth',
        action: 'login_success',
        description: 'Platform-level login event',
        actor_id: 'test-user-2',
        actor_email: 'platform@test.com',
        actor_role: 'user',
        target_type: 'user',
        target_id: 'test-user-2',
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: null,
        resource_owner_organization_id: null,
      });

      expect(hash).not.toBeNull();

      const rows = await rawExec(`
        SELECT actor_organization_id, resource_owner_organization_id
        FROM audit_log
        WHERE entry_hash = '${hash}'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].actor_organization_id).toBeNull();
      expect(rows[0].resource_owner_organization_id).toBeNull();
    });

    it('entry_hash is computed over org context fields (tamper evidence)', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      // Two entries with identical content EXCEPT org context should have
      // different entry_hash values — the org context is part of the hash input.
      const orgA = randomUUID();
      const orgB = randomUUID();

      const hashA = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Same description',
        actor_id: 'same-user',
        actor_email: 'same@test.com',
        actor_role: 'admin',
        target_type: 'organization',
        target_id: 'same-target',
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      });

      // Use a specific timestamp to ensure same timestamp for both
      const sameTime = new Date('2025-01-01T00:00:00.000Z');
      const hashAControlled = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Same description',
        actor_id: 'same-user',
        actor_email: 'same@test.com',
        actor_role: 'admin',
        target_type: 'organization',
        target_id: 'same-target',
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      }, sameTime);

      const hashB = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Same description',
        actor_id: 'same-user',
        actor_email: 'same@test.com',
        actor_role: 'admin',
        target_type: 'organization',
        target_id: 'same-target',
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgB,
        resource_owner_organization_id: orgB,
      }, sameTime);

      // Same org, same content, same timestamp → same hash
      expect(hashA).not.toBeNull();
      expect(hashB).not.toBeNull();
      // hashA (auto timestamp) vs hashAControlled (fixed timestamp) will differ
      // because timestamp is part of the hash. But hashAControlled vs hashB
      // share the same timestamp — they should differ ONLY because of org context.
      expect(hashAControlled).not.toBe(hashB);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 3: Per-org hash chain partitioning
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 3: Per-org hash chain partitioning (ADR-013)', () => {
    it('events for different orgs do not chain to each other', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();
      const orgB = randomUUID();

      // Write an event for orgA
      const hashA1 = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Org A event 1',
        actor_id: 'user-a',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgA,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      });

      // Write an event for orgB — should NOT chain to orgA's entry
      const hashB1 = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Org B event 1',
        actor_id: 'user-b',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgB,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgB,
        resource_owner_organization_id: orgB,
      });

      // Verify: orgB's entry should have prev_hash = NULL (first in its chain)
      // NOT orgA's entry_hash
      const rowsB = await rawExec(`
        SELECT prev_hash FROM audit_log
        WHERE entry_hash = '${hashB1}'
      `);
      expect(rowsB.length).toBe(1);
      expect(rowsB[0].prev_hash).toBeNull();
    });

    it('events for the same org chain to each other', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();

      const hashA1 = await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Org A event 1',
        actor_id: 'user-a',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgA,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      });

      const hashA2 = await writeAuditLog({
        category: 'admin',
        action: 'organization_archived',
        description: 'Org A event 2',
        actor_id: 'user-a',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgA,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      });

      // Verify: orgA's second entry should chain to orgA's first entry
      const rowsA2 = await rawExec(`
        SELECT prev_hash FROM audit_log
        WHERE entry_hash = '${hashA2}'
      `);
      expect(rowsA2.length).toBe(1);
      expect(rowsA2[0].prev_hash).toBe(hashA1);
    });

    it('platform-level events (NULL org) form a separate chain', async () => {
      const { writeAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();

      // Org A event
      await writeAuditLog({
        category: 'admin',
        action: 'organization_updated',
        description: 'Org A event',
        actor_id: 'user-a',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgA,
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgA,
        resource_owner_organization_id: orgA,
      });

      // Platform event — should NOT chain to org A's entry
      const platformHash = await writeAuditLog({
        category: 'auth',
        action: 'login_success',
        description: 'Platform login',
        actor_id: 'user-platform',
        actor_email: null,
        actor_role: null,
        target_type: 'user',
        target_id: 'user-platform',
        metadata: {},
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: null,
        resource_owner_organization_id: null,
      });

      // Platform event should have prev_hash = NULL (first in platform chain)
      const rows = await rawExec(`
        SELECT prev_hash FROM audit_log
        WHERE entry_hash = '${platformHash}'
      `);
      expect(rows.length).toBe(1);
      expect(rows[0].prev_hash).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 4: verifyAuditChain per-org verification
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 4: verifyAuditChain per-org verification', () => {
    it('verifies a specific org chain in isolation', async () => {
      const { writeAuditLog, verifyAuditChain } = await import('@/lib/auditLog');

      const orgA = randomUUID();
      const orgB = randomUUID();

      // Write 2 events for orgA
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'A1', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });
      await writeAuditLog({
        category: 'admin', action: 'organization_archived',
        description: 'A2', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });

      // Write 1 event for orgB
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'B1', actor_id: 'u2', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgB, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgB, resource_owner_organization_id: orgB,
      });

      // Verify orgA's chain — should see 2 entries, all valid
      const resultA = await verifyAuditChain(undefined, orgA);
      expect(resultA.valid).toBe(true);
      expect(resultA.totalEntries).toBe(2);
      expect(resultA.brokenLinks.length).toBe(0);
      expect(resultA.tamperedEntries.length).toBe(0);

      // Verify orgB's chain — should see 1 entry
      const resultB = await verifyAuditChain(undefined, orgB);
      expect(resultB.valid).toBe(true);
      expect(resultB.totalEntries).toBe(1);
    });

    it('verifying a non-existent org returns 0 entries (valid)', async () => {
      const { verifyAuditChain } = await import('@/lib/auditLog');

      const result = await verifyAuditChain(undefined, randomUUID());
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
    });

    it('verifies the platform-level chain (null org) in isolation', async () => {
      const { writeAuditLog, verifyAuditChain } = await import('@/lib/auditLog');

      const orgA = randomUUID();

      // Platform event
      await writeAuditLog({
        category: 'auth', action: 'login_success',
        description: 'Platform login', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'user', target_id: 'u1', metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: null, resource_owner_organization_id: null,
      });

      // Org event (should NOT appear in platform chain)
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'Org event', actor_id: 'u2', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });

      // Verify platform chain — should see 1 entry only
      const result = await verifyAuditChain(undefined, null);
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 5: queryAuditLog org filtering
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 5: queryAuditLog tenant-scoped filtering', () => {
    it('filters by actor_organization_id', async () => {
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();
      const orgB = randomUUID();

      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'A1', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'B1', actor_id: 'u2', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgB, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgB, resource_owner_organization_id: orgB,
      });

      const orgAEntries = await queryAuditLog({ actor_organization_id: orgA });
      expect(orgAEntries.length).toBe(1);
      expect(orgAEntries[0].actor_organization_id).toBe(orgA);

      const orgBEntries = await queryAuditLog({ actor_organization_id: orgB });
      expect(orgBEntries.length).toBe(1);
      expect(orgBEntries[0].actor_organization_id).toBe(orgB);
    });

    it('filters by resource_owner_organization_id', async () => {
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();
      const orgB = randomUUID();

      // Event where actor is in orgA but resource belongs to orgB
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'Cross-org event', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgB, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgB,
      });

      const byResource = await queryAuditLog({ resource_owner_organization_id: orgB });
      expect(byResource.length).toBe(1);
      expect(String(byResource[0].resource_owner_organization_id)).toBe(orgB);
    });

    it('returns entries with org context fields populated', async () => {
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgA = randomUUID();

      await writeAuditLog({
        category: 'admin', action: 'organization_created',
        description: 'Org created', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });

      // Write a second entry so the chain has a non-null prev_hash
      await writeAuditLog({
        category: 'admin', action: 'organization_updated',
        description: 'Org updated', actor_id: 'u1', actor_email: null, actor_role: null,
        target_type: 'organization', target_id: orgA, metadata: {},
        ip_address: null, user_agent: null, request_path: null,
        actor_organization_id: orgA, resource_owner_organization_id: orgA,
      });

      const entries = await queryAuditLog({ actor_organization_id: orgA });
      expect(entries.length).toBe(2);
      const entry = entries.find(e => e.action === 'organization_updated')!;
      expect(entry.actor_organization_id).not.toBeNull();
      expect(entry.resource_owner_organization_id).not.toBeNull();
      expect(entry.entry_hash).not.toBeNull();
      // The second entry chains to the first, so prev_hash is non-null
      expect(entry.prev_hash).not.toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 6: auditOrgAuthorityEvent fail-closed
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 6: auditOrgAuthorityEvent fail-closed', () => {
    it('returns entry hash on successful write', async () => {
      const { auditOrgAuthorityEvent } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      const hash = await auditOrgAuthorityEvent(
        'organization_membership_removed',
        'Member removed from org',
        {
          actor_id: 'admin-user',
          actor_email: 'admin@test.com',
          actor_role: 'admin',
          actor_organization_id: orgId,
          resource_owner_organization_id: orgId,
        },
        'organization_member',
        'removed-user-id',
        { reason: 'policy_violation' },
      );

      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('writes org context to the audit_log table', async () => {
      const { auditOrgAuthorityEvent } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      await auditOrgAuthorityEvent(
        'organization_membership_role_changed',
        'Role changed from member to admin',
        {
          actor_id: 'owner-user',
          actor_email: 'owner@test.com',
          actor_role: 'owner',
          actor_organization_id: orgId,
          resource_owner_organization_id: orgId,
        },
        'organization_member',
        'target-user-id',
        { oldRole: 'member', newRole: 'admin' },
      );

      const rows = await rawExec(`
        SELECT actor_organization_id, action, target_type, target_id
        FROM audit_log
        WHERE action = 'organization_membership_role_changed'
      `);
      expect(rows.length).toBe(1);
      expect(String(rows[0].actor_organization_id)).toBe(orgId);
      expect(rows[0].target_type).toBe('organization_member');
      expect(rows[0].target_id).toBe('target-user-id');
    });

    it('throws AUDIT_WRITE_FAILED when audit_log table is unavailable', async () => {
      const { auditOrgAuthorityEvent } = await import('@/lib/auditLog');

      // Drop the audit_log table to simulate unavailability
      await rawExec('DROP TABLE audit_log CASCADE');

      const orgId = randomUUID();
      await expect(
        auditOrgAuthorityEvent(
          'organization_membership_removed',
          'Should fail-closed',
          {
            actor_id: 'admin-user',
            actor_email: 'admin@test.com',
            actor_role: 'admin',
            actor_organization_id: orgId,
            resource_owner_organization_id: orgId,
          },
          'organization_member',
          'target-user-id',
          {},
        ),
      ).rejects.toThrow(/AUDIT_WRITE_FAILED/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 7: Organization-specific audit actions exist
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 7: Organization audit action vocabulary', () => {
    it('organization lifecycle actions are valid AuditAction values', async () => {
      // We verify by writing entries with these actions and confirming they
      // are accepted (no type error at compile time, no DB constraint error).
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      const actions = [
        'organization_created',
        'organization_updated',
        'organization_archived',
        'organization_suspended',
        'organization_reactivated',
      ];

      for (const action of actions) {
        await writeAuditLog({
          category: 'admin',
          action: action as any,
          description: `Test: ${action}`,
          actor_id: 'test-user',
          actor_email: null,
          actor_role: null,
          target_type: 'organization',
          target_id: orgId,
          metadata: {},
          ip_address: null,
          user_agent: null,
          request_path: null,
          actor_organization_id: orgId,
          resource_owner_organization_id: orgId,
        });
      }

      const entries = await queryAuditLog({ target_id: orgId });
      expect(entries.length).toBe(actions.length);
      const writtenActions = entries.map(e => e.action).sort();
      expect(writtenActions).toEqual([...actions].sort());
    });

    it('membership lifecycle actions are valid AuditAction values', async () => {
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      const actions = [
        'organization_membership_invited',
        'organization_membership_added',
        'organization_membership_removed',
        'organization_membership_suspended',
        'organization_membership_reactivated',
        'organization_membership_role_changed',
      ];

      for (const action of actions) {
        await writeAuditLog({
          category: 'admin',
          action: action as any,
          description: `Test: ${action}`,
          actor_id: 'test-user',
          actor_email: null,
          actor_role: null,
          target_type: 'organization_member',
          target_id: 'member-uuid',
          metadata: {},
          ip_address: null,
          user_agent: null,
          request_path: null,
          actor_organization_id: orgId,
          resource_owner_organization_id: orgId,
        });
      }

      const entries = await queryAuditLog({ target_id: 'member-uuid' });
      expect(entries.length).toBe(actions.length);
    });

    it('organization_authz_decision action is a valid AuditAction', async () => {
      const { writeAuditLog, queryAuditLog } = await import('@/lib/auditLog');

      const orgId = randomUUID();
      await writeAuditLog({
        category: 'admin',
        action: 'organization_authz_decision',
        description: 'Authz decision logged',
        actor_id: 'test-user',
        actor_email: null,
        actor_role: null,
        target_type: 'organization',
        target_id: orgId,
        metadata: { allowed: false, reason: 'not_a_member' },
        ip_address: null,
        user_agent: null,
        request_path: null,
        actor_organization_id: orgId,
        resource_owner_organization_id: orgId,
      });

      const entries = await queryAuditLog({ action: 'organization_authz_decision' as any });
      expect(entries.length).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Section 8: logAuthzDecision routes through structured audit
  // ══════════════════════════════════════════════════════════════════════════

  describe('Section 8: logAuthzDecision structured audit routing', () => {
    it('writes to audit_log with org context (not just console.warn)', async () => {
      const { logAuthzDecision } = await import(
        '@/lib/organizations/authorization'
      );
      const { queryAuditLog } = await import('@/lib/auditLog');

      const userId = randomUUID();
      const orgId = randomUUID();

      // Insert the user so the FK constraint (if any) is satisfied
      await rawExec(
        `INSERT INTO users (id, name, email) VALUES ('${userId}', 'Test User', 'logauthz@test.com')`,
      );

      // Log an allowed decision
      await logAuthzDecision(userId, orgId, 'members:read', { allowed: true, reason: 'allowed' });

      const entries = await queryAuditLog({ action: 'organization_authz_decision' as any });
      expect(entries.length).toBeGreaterThanOrEqual(1);

      const entry = entries.find(e => e.actor_id === userId);
      expect(entry).toBeDefined();
      expect(entry!.actor_organization_id).toBe(orgId);
      expect(entry!.resource_owner_organization_id).toBe(orgId);
      expect(entry!.metadata).toHaveProperty('allowed', true);
    });

    it('logs denied decisions with reason in metadata', async () => {
      const { logAuthzDecision } = await import(
        '@/lib/organizations/authorization'
      );
      const { queryAuditLog } = await import('@/lib/auditLog');

      const userId = randomUUID();
      const orgId = randomUUID();

      await logAuthzDecision(userId, orgId, 'members:write', {
        allowed: false,
        reason: 'not_a_member',
        detail: 'You are not a member of this organization',
      });

      const entries = await queryAuditLog({ action: 'organization_authz_decision' as any });
      const entry = entries.find(e => e.actor_id === userId);
      expect(entry).toBeDefined();
      expect(entry!.metadata).toHaveProperty('allowed', false);
      expect(entry!.metadata).toHaveProperty('reason', 'not_a_member');
    });
  });
});
