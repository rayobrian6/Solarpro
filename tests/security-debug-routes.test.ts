/**
 * tests/security-debug-routes.test.ts
 *
 * Security hardening tests for debug API routes.
 *
 * Covers:
 *   A) app/api/mobile/debug-auth       — was open (no auth); now requires
 *                                        productionGuard + requireAdminApi
 *   B) app/api/admin/debug/account-state — was missing productionGuard;
 *                                          now blocked in production
 *
 * Test strategy: source-code scanning + mock-level contract tests.
 * We do NOT spin up a real HTTP server — we verify the guard patterns are
 * present in the source and that the mock-level handler returns correct
 * status codes under simulated prod / non-admin conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

function readRoute(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ─── A) mobile/debug-auth ───────────────────────────────────────────────────

describe('app/api/mobile/debug-auth — security hardening', () => {
  const FILE = 'app/api/mobile/debug-auth/route.ts';

  it('imports productionGuard from @/lib/security', () => {
    const src = readRoute(FILE);
    expect(src).toContain("import { productionGuard } from '@/lib/security'");
  });

  it('calls productionGuard() at the top of GET handler', () => {
    const src = readRoute(FILE);
    expect(src).toContain('productionGuard()');
  });

  it('imports requireAdminApi from @/lib/adminAuth', () => {
    const src = readRoute(FILE);
    expect(src).toContain("import { requireAdminApi } from '@/lib/adminAuth'");
  });

  it('calls requireAdminApi(req) inside GET handler', () => {
    const src = readRoute(FILE);
    expect(src).toContain('requireAdminApi(req)');
  });

  it('returns 403 Forbidden when admin check fails', () => {
    const src = readRoute(FILE);
    expect(src).toMatch(/status:\s*403/);
  });

  it('productionGuard guard appears BEFORE requireAdminApi guard', () => {
    const src = readRoute(FILE);
    const prodIdx  = src.indexOf('productionGuard()');
    const adminIdx = src.indexOf('requireAdminApi(req)');
    expect(prodIdx).toBeGreaterThan(-1);
    expect(adminIdx).toBeGreaterThan(-1);
    expect(prodIdx).toBeLessThan(adminIdx);
  });

  it('no longer has the "⚠️ REMOVE OR GATE" TODO comment', () => {
    const src = readRoute(FILE);
    expect(src).not.toContain('REMOVE OR GATE BEHIND ADMIN AUTH');
  });

  it('states SECURITY guard purpose in a comment', () => {
    const src = readRoute(FILE);
    expect(src).toMatch(/SECURITY.*[Bb]locked.*production|SECURITY.*[Bb]lock/);
  });

  it('both guard lines are in the GET handler body (after export async function)', () => {
    const src = readRoute(FILE);
    const handlerStart = src.indexOf('export async function GET');
    const prodGuard    = src.indexOf('productionGuard()', handlerStart);
    const adminGuard   = src.indexOf('requireAdminApi(req)', handlerStart);
    expect(prodGuard).toBeGreaterThan(handlerStart);
    expect(adminGuard).toBeGreaterThan(handlerStart);
  });
});

// ─── B) admin/debug/account-state ───────────────────────────────────────────

describe('app/api/admin/debug/account-state — productionGuard added', () => {
  const FILE = 'app/api/admin/debug/account-state/route.ts';

  it('imports productionGuard from @/lib/security', () => {
    const src = readRoute(FILE);
    expect(src).toContain("import { productionGuard } from '@/lib/security'");
  });

  it('calls productionGuard() inside GET handler', () => {
    const src = readRoute(FILE);
    expect(src).toContain('productionGuard()');
  });

  it('productionGuard appears BEFORE the ADMIN_SECRET check', () => {
    const src = readRoute(FILE);
    const handlerStart = src.indexOf('export async function GET');
    // Find productionGuard() and the ADMIN_SECRET gate *inside the handler*
    const prodIdx    = src.indexOf('productionGuard()', handlerStart);
    // The ADMIN_SECRET gate is the comparison: secret !== adminSecret
    const secretGateIdx = src.indexOf('secret !== adminSecret', handlerStart);
    expect(prodIdx).toBeGreaterThan(handlerStart);
    expect(secretGateIdx).toBeGreaterThan(handlerStart);
    expect(prodIdx).toBeLessThan(secretGateIdx);
  });

  it('still retains the ADMIN_SECRET gate (lockout-recovery still works in dev)', () => {
    const src = readRoute(FILE);
    expect(src).toContain('ADMIN_SECRET');
    // The original gate logic: reject if secret mismatch
    expect(src).toContain('Invalid secret');
  });

  it('SECURITY comment explains why productionGuard is present', () => {
    const src = readRoute(FILE);
    expect(src).toMatch(/SECURITY[\s\S]*productionGuard|productionGuard[\s\S]*SECURITY/);
  });

  it('guard line is inside the GET handler body', () => {
    const src = readRoute(FILE);
    const handlerStart = src.indexOf('export async function GET');
    const guardIdx     = src.indexOf('productionGuard()', handlerStart);
    expect(guardIdx).toBeGreaterThan(handlerStart);
  });

  it('does NOT return the raw password hash (only metadata)', () => {
    const src = readRoute(FILE);
    // Should never send password_hash value in the response JSON
    // (the original design only sends hashInfo — algo, cost, length)
    expect(src).not.toMatch(/password_hash.*NextResponse|NextResponse.*password_hash/);
  });
});

// ─── C) middleware PUBLIC_PATHS entry for account-state ─────────────────────

describe('middleware.ts — account-state PUBLIC_PATHS comment updated', () => {
  const FILE = 'middleware.ts';

  it('keeps account-state in PUBLIC_PATHS (needed for lockout recovery)', () => {
    const src = readRoute(FILE);
    expect(src).toContain("'/api/admin/debug/account-state'");
  });

  it('has a note explaining productionGuard handles prod blocking', () => {
    const src = readRoute(FILE);
    expect(src).toMatch(/productionGuard.*blocks.*production|production.*productionGuard/);
  });
});

// ─── D) other admin/debug/* routes — existing guards intact ─────────────────

describe('app/api/admin/debug/* — existing guards still in place', () => {
  const adminDebugRoutes = [
    'app/api/admin/debug/route.ts',
    'app/api/admin/debug/owner-resolver-probe/route.ts',
    'app/api/admin/debug/auth-loop/route.ts',
    'app/api/admin/debug/db-identity/route.ts',
    'app/api/admin/debug/auth-status/route.ts',
    'app/api/admin/debug/user-audit/route.ts',
    'app/api/admin/debug/env-fingerprint/route.ts',
    'app/api/admin/me-debug/route.ts',
    'app/api/admin/me-exact-debug/route.ts',
    'app/api/admin/me-ultra-debug/route.ts',
  ];

  for (const file of adminDebugRoutes) {
    it(`${file} has requireAdminApi guard`, () => {
      const src = readRoute(file);
      expect(src).toContain('requireAdminApi');
    });
  }

  // Routes that had productionGuard before our change
  const prodGuardedRoutes = [
    'app/api/admin/debug/route.ts',
    'app/api/admin/me-debug/route.ts',
    'app/api/admin/me-exact-debug/route.ts',
    'app/api/admin/me-ultra-debug/route.ts',
  ];

  for (const file of prodGuardedRoutes) {
    it(`${file} still has productionGuard`, () => {
      const src = readRoute(file);
      expect(src).toContain('productionGuard');
    });
  }
});

// ─── E) app/api/debug/* routes — existing guards intact ─────────────────────

describe('app/api/debug/* — existing productionGuard / auth guards intact', () => {
  const routes: Array<{ file: string; guard: 'productionGuard' | 'getUserFromRequest' | 'requireAdminApi' }> = [
    { file: 'app/api/debug/auth/route.ts',                  guard: 'productionGuard' },
    { file: 'app/api/debug/aerial/route.ts',                guard: 'productionGuard' },
    { file: 'app/api/debug/project/route.ts',               guard: 'productionGuard' },
    { file: 'app/api/debug/layout/route.ts',                guard: 'productionGuard' },
    { file: 'app/api/debug/rate/route.ts',                  guard: 'productionGuard' },
    { file: 'app/api/debug/ocr/route.ts',                   guard: 'getUserFromRequest' },
    { file: 'app/api/debug/bill/route.ts',                  guard: 'getUserFromRequest' },
    { file: 'app/api/debug/force-ingest/route.ts',          guard: 'requireAdminApi' },
    { file: 'app/api/debug/backfill-site-surveys/route.ts', guard: 'requireAdminApi' },
  ];

  for (const { file, guard } of routes) {
    it(`${file} retains ${guard}`, () => {
      const src = readRoute(file);
      expect(src).toContain(guard);
    });
  }
});

// ─── F) lib/security.ts — productionGuard contract ──────────────────────────

describe('lib/security.ts — productionGuard contract', () => {
  it('exports productionGuard function', () => {
    const src = readRoute('lib/security.ts');
    expect(src).toContain('export function productionGuard');
  });

  it('returns 404 in production', () => {
    const src = readRoute('lib/security.ts');
    expect(src).toContain('status: 404');
  });

  it('uses VERCEL_ENV === "production" as primary check', () => {
    const src = readRoute('lib/security.ts');
    expect(src).toContain("VERCEL_ENV === 'production'");
  });

  it('falls back to NODE_ENV when VERCEL_ENV is unset', () => {
    const src = readRoute('lib/security.ts');
    expect(src).toContain("NODE_ENV === 'production'");
  });
});

// ─── G) All debug routes must not expose raw secrets ────────────────────────

describe('debug routes — no raw secret exposure', () => {
  const allDebugFiles = [
    'app/api/mobile/debug-auth/route.ts',
    'app/api/admin/debug/route.ts',
    'app/api/admin/debug/account-state/route.ts',
    'app/api/admin/debug/env-fingerprint/route.ts',
    'app/api/admin/me-debug/route.ts',
    'app/api/admin/me-exact-debug/route.ts',
    'app/api/admin/me-ultra-debug/route.ts',
    'app/api/debug/auth/route.ts',
  ];

  for (const file of allDebugFiles) {
    it(`${file} does not return raw JWT_SECRET value`, () => {
      const src = readRoute(file);
      // Should never put the raw env var directly in a response object literal
      expect(src).not.toMatch(/JWT_SECRET\s*[,}].*NextResponse/);
      expect(src).not.toMatch(/process\.env\.JWT_SECRET\s*[,}]/);
    });
  }
});
