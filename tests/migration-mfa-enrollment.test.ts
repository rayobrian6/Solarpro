// tests/migration-mfa-enrollment.test.ts
//
// Regression: migration readiness must resolve MFA enrollment from the CANONICAL
// users.mfa_enabled + users.mfa_secret_encrypted record (same source the
// Settings Security page uses), NOT the non-canonical admin_users table that no
// migration creates. A super_admin with an ACTIVE TOTP enrollment must read as
// mfaEnrolled:true; a genuinely unenrolled account must read as false.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';

vi.mock('@neondatabase/serverless', async () => {
  const m = await import('./__mocks__/neon-serverless');
  return { neon: m.neon, neonConfig: m.neonConfig, Pool: m.Pool, closePool: m.closePool, setTestSchema: m.setTestSchema };
});

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || '';
const HAS_TEST_DB = TEST_DATABASE_URL.length > 0;
const TEST_SCHEMA = 'migration_mfa_enrollment_test';
const describeOrSkip = HAS_TEST_DB ? describe : describe.skip;

const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT 'U', email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'super_admin', mfa_secret_encrypted TEXT,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE);`;

const ORIG: Record<string, string | undefined> = {};
let rawPool: Pool | null = null;

// ── Pure (no DB) ──────────────────────────────────────────────────────────────
describe('isMfaEnrolled — pure guards', () => {
  it('returns false for a null/empty user id (no DB access)', async () => {
    const { isMfaEnrolled } = await import('../lib/mfaEnrollment');
    expect(await isMfaEnrolled(null)).toBe(false);
    expect(await isMfaEnrolled(undefined)).toBe(false);
    expect(await isMfaEnrolled('')).toBe(false);
  });
});

// ── Real Postgres (canonical users table) ─────────────────────────────────────
describeOrSkip('migration readiness MFA enrollment — real Postgres (users table)', () => {
  beforeAll(async () => {
    if (!HAS_TEST_DB) return;
    for (const k of ['DATABASE_URL', 'MIGRATION_RUN_ALLOWED_ENVS', 'NODE_ENV', 'VERCEL_ENV']) if (!(k in ORIG)) ORIG[k] = process.env[k];
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.MIGRATION_RUN_ALLOWED_ENVS = 'development,test';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    const { setTestSchema } = await import('./__mocks__/neon-serverless');
    setTestSchema(TEST_SCHEMA);
    rawPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  }, 30000);

  afterAll(async () => {
    const { closePool } = await import('./__mocks__/neon-serverless');
    await closePool();
    if (rawPool) { try { const c = await rawPool.connect(); try { await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { c.release(); } } catch {} await rawPool.end(); rawPool = null; }
    for (const [k, v] of Object.entries(ORIG)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 30000);

  beforeEach(async () => {
    if (!rawPool) return;
    const c = await rawPool.connect();
    try {
      await c.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
      await c.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
      await c.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      for (const stmt of USERS_DDL.split(';').map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
    } finally { c.release(); }
  }, 15000);

  async function seedUser(id: string, opts: { enabled: boolean; secret: boolean }) {
    const c = await rawPool!.connect();
    try {
      await c.query(`SET search_path TO ${TEST_SCHEMA}, public`);
      await c.query(
        `INSERT INTO users (id, email, role, mfa_enabled, mfa_secret_encrypted) VALUES ($1,$2,'super_admin',$3,$4)`,
        [id, `${id}@x.com`, opts.enabled, opts.secret ? 'enc-secret-blob' : null],
      );
    } finally { c.release(); }
  }

  it('an enrolled super_admin (mfa_enabled + secret) reads mfaEnrolled:true', async () => {
    await seedUser('op-enrolled', { enabled: true, secret: true });
    const { isMfaEnrolled } = await import('../lib/mfaEnrollment');
    expect(await isMfaEnrolled('op-enrolled')).toBe(true);

    const { buildOperatorReadiness } = await import('../lib/migrations/operatorReadiness');
    const rd = await buildOperatorReadiness({ id: 'op-enrolled', role: 'super_admin' });
    expect(rd.mfaEnrolled).toBe(true);
    // The MFA blocker must be absent.
    expect(rd.blockers.some((b) => /MFA is not enrolled/i.test(b))).toBe(false);
  });

  it('DENIAL: a genuinely unenrolled account (mfa_enabled=false) reads mfaEnrolled:false', async () => {
    await seedUser('op-unenrolled', { enabled: false, secret: false });
    const { isMfaEnrolled } = await import('../lib/mfaEnrollment');
    expect(await isMfaEnrolled('op-unenrolled')).toBe(false);

    const { buildOperatorReadiness } = await import('../lib/migrations/operatorReadiness');
    const rd = await buildOperatorReadiness({ id: 'op-unenrolled', role: 'super_admin' });
    expect(rd.mfaEnrolled).toBe(false);
    expect(rd.blockers.some((b) => /MFA is not enrolled/i.test(b))).toBe(true);
  });

  it('DENIAL: mfa_enabled=true but NO secret reads false (incomplete enrollment)', async () => {
    await seedUser('op-partial', { enabled: true, secret: false });
    const { isMfaEnrolled } = await import('../lib/mfaEnrollment');
    expect(await isMfaEnrolled('op-partial')).toBe(false);
  });

  it('documents whether TEST_DATABASE_URL was available', () => {
    if (!HAS_TEST_DB) console.log('[mfa-enrollment] SKIPPED — TEST_DATABASE_URL not set.');
    expect(true).toBe(true);
  });
});
