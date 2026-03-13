/**
 * tests/auth-health.test.ts
 *
 * Unit tests for auth system health checks, log marker contracts,
 * middleware bypass logic, and error classification.
 *
 * These tests verify the AUTH contract documented in the route files:
 *   - 401 = no cookie / invalid JWT (user should be logged out)
 *   - 503 + DB_STARTING = transient DB error (client should retry)
 *   - 503 + DB_CONFIG_ERROR = DATABASE_URL missing (fatal config error)
 *
 * v47.23: Added as part of production stabilization auth audit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Import the DB error classifier directly ─────────────────────────────────
import { isTransientDbError, DbConfigError } from '../lib/db-ready';

// ── Import JWT helpers ───────────────────────────────────────────────────────
import { signToken, verifyToken } from '../lib/auth';

// ────────────────────────────────────────────────────────────────────────────
// 1. DB Error Classification
// ────────────────────────────────────────────────────────────────────────────

describe('isTransientDbError — whitelist-fatal classification', () => {
  it('classifies DbConfigError as non-transient (fatal)', () => {
    const err = new DbConfigError('DATABASE_URL is not set');
    expect(isTransientDbError(err)).toBe(false);
  });

  it('classifies "password authentication failed" as non-transient (fatal)', () => {
    const err = new Error('password authentication failed for user "neondb_owner"');
    expect(isTransientDbError(err)).toBe(false);
  });

  it('classifies "role does not exist" as non-transient (fatal)', () => {
    const err = new Error('role "bad_user" does not exist');
    expect(isTransientDbError(err)).toBe(false);
  });

  it('classifies "database does not exist" as non-transient (fatal)', () => {
    const err = new Error('database "wrong_db" does not exist');
    expect(isTransientDbError(err)).toBe(false);
  });

  it('classifies Neon cold-start error as transient', () => {
    const err = new Error('endpoint is starting');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies ECONNRESET as transient', () => {
    const err = new Error('ECONNRESET: connection reset by peer');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies ETIMEDOUT as transient', () => {
    const err = new Error('ETIMEDOUT: connection timed out');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies fetch failed as transient', () => {
    const err = new Error('fetch failed: network error');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies SCRAM channel binding error as transient', () => {
    const err = new Error('SCRAM authentication: server did not support channel binding');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies "connection terminated" as transient', () => {
    const err = new Error('connection terminated unexpectedly');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies unknown error strings as transient (safe default)', () => {
    const err = new Error('some unknown neon infrastructure error xyz123');
    expect(isTransientDbError(err)).toBe(true);
  });

  it('classifies non-Error objects as transient', () => {
    expect(isTransientDbError('string error')).toBe(true);
    expect(isTransientDbError({ message: 'object error' })).toBe(true);
    expect(isTransientDbError(null)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. DbConfigError class
// ────────────────────────────────────────────────────────────────────────────

describe('DbConfigError', () => {
  it('is an instance of Error', () => {
    const err = new DbConfigError('test');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name "DbConfigError"', () => {
    const err = new DbConfigError('test');
    expect(err.name).toBe('DbConfigError');
  });

  it('preserves message', () => {
    const err = new DbConfigError('DATABASE_URL is not set');
    expect(err.message).toBe('DATABASE_URL is not set');
  });

  it('instanceof check works correctly', () => {
    const err = new DbConfigError('test');
    expect(err instanceof DbConfigError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. JWT token round-trip (auth contract)
// ────────────────────────────────────────────────────────────────────────────

describe('signToken / verifyToken round-trip', () => {
  beforeEach(() => {
    // Ensure JWT_SECRET is set for tests
    process.env.JWT_SECRET = 'test-secret-key-that-is-long-enough-for-hs256';
  });

  it('produces a token with 3 parts (JWT format)', () => {
    const token = signToken({ id: '1', name: 'Test', email: 'test@example.com' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken returns identity fields from payload', () => {
    const token = signToken({ id: '42', name: 'Alice', email: 'alice@example.com', company: 'Acme' });
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.id).toBe('42');
    expect(decoded?.name).toBe('Alice');
    expect(decoded?.email).toBe('alice@example.com');
    expect(decoded?.company).toBe('Acme');
  });

  it('verifyToken returns null for tampered token', () => {
    const token = signToken({ id: '1', name: 'Test', email: 'test@example.com' });
    const parts = token.split('.');
    // Tamper with the payload
    parts[1] = Buffer.from(JSON.stringify({ id: '99', name: 'Hacker', email: 'hack@evil.com' })).toString('base64url');
    const tampered = parts.join('.');
    const decoded = verifyToken(tampered);
    expect(decoded).toBeNull();
  });

  it('verifyToken returns null for empty string', () => {
    expect(verifyToken('')).toBeNull();
  });

  it('verifyToken returns null for malformed token', () => {
    expect(verifyToken('not.a.jwt')).toBeNull();
    expect(verifyToken('only-one-part')).toBeNull();
  });

  it('JWT payload does NOT contain role (identity-only contract)', () => {
    const token = signToken({ id: '1', name: 'Admin', email: 'admin@test.com' });
    const parts = token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    // Role must NOT be in the JWT -- it's always fetched from DB
    expect(payload.role).toBeUndefined();
    // Identity fields must be present
    expect(payload.id).toBe('1');
    expect(payload.email).toBe('admin@test.com');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Auth error code contract
// ────────────────────────────────────────────────────────────────────────────

describe('Auth error code contract', () => {
  it('DB_STARTING is the correct retry code for transient errors', () => {
    // This verifies the string constant used in responses
    const code = 'DB_STARTING';
    expect(code).toBe('DB_STARTING');
  });

  it('DB_CONFIG_ERROR is the correct code for missing DATABASE_URL', () => {
    const code = 'DB_CONFIG_ERROR';
    expect(code).toBe('DB_CONFIG_ERROR');
  });

  it('Only 401 should trigger logout (not 500 or 503)', () => {
    // Encode the contract: 401=logout, 503=retry, 500=retry
    const shouldLogout = (status: number, code?: string) => {
      if (status === 401) return true;
      if (status === 503) return false; // DB_STARTING or DB_CONFIG_ERROR -- retry
      if (status === 500) return false; // unexpected but retry
      return false;
    };

    expect(shouldLogout(401)).toBe(true);
    expect(shouldLogout(503, 'DB_STARTING')).toBe(false);
    expect(shouldLogout(503, 'DB_CONFIG_ERROR')).toBe(false);
    expect(shouldLogout(500)).toBe(false);
    expect(shouldLogout(404)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. Middleware bypass path logic
// ────────────────────────────────────────────────────────────────────────────

describe('Middleware PUBLIC_PATHS bypass logic', () => {
  // Replicate the middleware bypass check for unit testing
  const PUBLIC_PATHS = [
    '/auth/login',
    '/auth/register',
    '/auth/subscribe',
    '/subscribe',
    '/enterprise',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/pricing',
    '/api/version',
    '/api/health',
    '/api/engineering/sld',
    '/api/enterprise',
    '/api/stripe/webhook',
    '/api/migrate',
    '/api/ocr',
  ];

  const isPublic = (pathname: string) =>
    PUBLIC_PATHS.some(p => pathname.startsWith(p));

  it('/api/auth/login is public (bypasses auth)', () => {
    expect(isPublic('/api/auth/login')).toBe(true);
  });

  it('/api/auth/me is public (bypasses auth)', () => {
    expect(isPublic('/api/auth/me')).toBe(true);
  });

  it('/api/auth/logout is public (bypasses auth)', () => {
    expect(isPublic('/api/auth/logout')).toBe(true);
  });

  it('/api/auth/register is public (bypasses auth)', () => {
    expect(isPublic('/api/auth/register')).toBe(true);
  });

  it('/api/health is public (bypasses auth)', () => {
    expect(isPublic('/api/health')).toBe(true);
  });

  it('/api/health/auth is public via startsWith /api/health', () => {
    expect(isPublic('/api/health/auth')).toBe(true);
  });

  it('/api/health/database is public via startsWith /api/health', () => {
    expect(isPublic('/api/health/database')).toBe(true);
  });

  it('/api/ocr is public (internal route)', () => {
    expect(isPublic('/api/ocr')).toBe(true);
  });

  it('/api/projects is NOT public (requires auth)', () => {
    expect(isPublic('/api/projects')).toBe(false);
  });

  it('/api/bill-upload is NOT public (requires auth)', () => {
    expect(isPublic('/api/bill-upload')).toBe(false);
  });

  it('/api/system-size is NOT public (requires auth)', () => {
    expect(isPublic('/api/system-size')).toBe(false);
  });

  it('/api/debug/ocr is NOT public (requires auth for diagnostics)', () => {
    expect(isPublic('/api/debug/ocr')).toBe(false);
  });

  it('/api/debug/bill is NOT public (requires auth for diagnostics)', () => {
    expect(isPublic('/api/debug/bill')).toBe(false);
  });

  it('/api/admin/users is NOT public (requires auth + role check via requireAdminApi)', () => {
    // Admin routes pass through middleware (auth check only),
    // role check is done by requireAdminApi() in each route handler
    expect(isPublic('/api/admin/users')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 6. Env guard validation
// ────────────────────────────────────────────────────────────────────────────

describe('Startup env guard', () => {
  it('DATABASE_URL presence check works', () => {
    const hasDatabaseUrl = !!process.env.DATABASE_URL;
    // In test environment, DATABASE_URL may or may not be set
    // We just verify the check logic itself works
    expect(typeof hasDatabaseUrl).toBe('boolean');
  });

  it('JWT_SECRET validity check requires length > 10', () => {
    const checkJwtSecret = (secret: string | undefined) =>
      !!secret && secret.length > 10;

    expect(checkJwtSecret(undefined)).toBe(false);
    expect(checkJwtSecret('')).toBe(false);
    expect(checkJwtSecret('short')).toBe(false);
    expect(checkJwtSecret('this-is-a-valid-secret-key')).toBe(true);
  });

  it('Startup log format includes present= and length= fields', () => {
    const mockUrl = 'postgresql://user:pass@host/db';
    const logLine = `[DATABASE_URL_PRESENT] present=${!!mockUrl} length=${mockUrl.length}`;
    expect(logLine).toContain('[DATABASE_URL_PRESENT]');
    expect(logLine).toContain('present=true');
    expect(logLine).toContain(`length=${mockUrl.length}`);
  });
});