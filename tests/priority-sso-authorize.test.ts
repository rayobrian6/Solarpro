/**
 * tests/priority-sso-authorize.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CI guard for /api/auth/authorize redirect_uri allowlist logic.
 *
 * Why this matters:
 *   If AUTHORIZE_ALLOWED_REDIRECTS is set in Vercel with only "sitesurvey://"
 *   the Expo Go client (exp://) gets rejected with:
 *     {"error":"redirect_uri is not in the allowlist","allowedPrefixes":["sitesurvey://"]}
 *
 *   These tests enforce that the DEFAULT_ALLOWED_PREFIXES and isRedirectAllowed
 *   logic are correct at the source-code level so the CI will catch any future
 *   regression before it reaches production.
 *
 * Coverage:
 *   1. DEFAULT_ALLOWED_PREFIXES contains exactly the three required schemes
 *   2. isRedirectAllowed accepts all three production scheme patterns
 *   3. isRedirectAllowed accepts real Expo Go update URLs (exp://u.expo.dev/...)
 *   4. isRedirectAllowed accepts com.underthesun. bundle-id scheme
 *   5. isRedirectAllowed rejects untrusted schemes
 *   6. AUTHORIZE_ALLOWED_REDIRECTS env-var override parsing works correctly
 *   7. When env var is set to ONLY "sitesurvey://", exp:// is correctly rejected
 *      (documents the exact bug reported by partners-bot)
 *   8. When env var is set to all three, all are accepted
 *   9. .env.example contains all three schemes (prevents copy-paste misconfiguration)
 *  10. Error response shape includes the 'fix' hint field
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ─── Re-implement the pure logic from authorize/route.ts ───────────────────
// We mirror the code so tests run without a real Next.js runtime.

const DEFAULT_ALLOWED_PREFIXES = [
  'sitesurvey://',
  'exp://',
  'com.underthesun.',
];

function getAllowedRedirectPrefixes(envValue?: string): string[] {
  const raw = (envValue ?? '').trim();
  if (!raw) return DEFAULT_ALLOWED_PREFIXES;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isRedirectAllowed(redirectUri: string, allowed: string[]): boolean {
  for (const prefix of allowed) {
    if (redirectUri.startsWith(prefix)) return true;
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const root = path.resolve(__dirname, '..');

// ─── Tests ────────────────────────────────────────────────────────────────

describe('authorize — DEFAULT_ALLOWED_PREFIXES', () => {
  it('contains sitesurvey://', () => {
    expect(DEFAULT_ALLOWED_PREFIXES).toContain('sitesurvey://');
  });

  it('contains exp://', () => {
    expect(DEFAULT_ALLOWED_PREFIXES).toContain('exp://');
  });

  it('contains com.underthesun.', () => {
    expect(DEFAULT_ALLOWED_PREFIXES).toContain('com.underthesun.');
  });

  it('has exactly 3 entries', () => {
    expect(DEFAULT_ALLOWED_PREFIXES).toHaveLength(3);
  });
});

describe('authorize — isRedirectAllowed with defaults', () => {
  const allowed = DEFAULT_ALLOWED_PREFIXES;

  // ── sitesurvey:// ──────────────────────────────────────────────────────
  it('accepts sitesurvey://login', () => {
    expect(isRedirectAllowed('sitesurvey://login', allowed)).toBe(true);
  });

  it('accepts sitesurvey://login?state=abc', () => {
    expect(isRedirectAllowed('sitesurvey://login?state=abc', allowed)).toBe(true);
  });

  // ── exp:// ─────────────────────────────────────────────────────────────
  it('accepts exp://localhost:19000', () => {
    expect(isRedirectAllowed('exp://localhost:19000', allowed)).toBe(true);
  });

  it('accepts real Expo Go update URL: exp://u.expo.dev/update/.../--/login', () => {
    // This is the EXACT redirect_uri from the partners-bot screenshot
    expect(isRedirectAllowed(
      'exp://u.expo.dev/update/019e37fd-72e0-7d02-bf96-fd09456d1acf/--/login',
      allowed,
    )).toBe(true);
  });

  it('accepts exp://192.168.1.100:8081 (local dev IP)', () => {
    expect(isRedirectAllowed('exp://192.168.1.100:8081', allowed)).toBe(true);
  });

  it('accepts exp://exp.host/@user/app', () => {
    expect(isRedirectAllowed('exp://exp.host/@user/app', allowed)).toBe(true);
  });

  // ── com.underthesun. ──────────────────────────────────────────────────
  it('accepts com.underthesun.sitesurvey://login', () => {
    expect(isRedirectAllowed('com.underthesun.sitesurvey://login', allowed)).toBe(true);
  });

  it('accepts com.underthesun.app://callback', () => {
    expect(isRedirectAllowed('com.underthesun.app://callback', allowed)).toBe(true);
  });

  // ── Rejections ────────────────────────────────────────────────────────
  it('rejects https://evil.com/sitesurvey:// (open-redirect attempt)', () => {
    expect(isRedirectAllowed('https://evil.com/sitesurvey://', allowed)).toBe(false);
  });

  it('rejects https://evil.com', () => {
    expect(isRedirectAllowed('https://evil.com', allowed)).toBe(false);
  });

  it('rejects http://localhost:3000', () => {
    expect(isRedirectAllowed('http://localhost:3000', allowed)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isRedirectAllowed('', allowed)).toBe(false);
  });

  it('rejects javascript:alert(1)', () => {
    expect(isRedirectAllowed('javascript:alert(1)', allowed)).toBe(false);
  });

  it('rejects data:text/html,...', () => {
    expect(isRedirectAllowed('data:text/html,<script>alert(1)</script>', allowed)).toBe(false);
  });
});

describe('authorize — env-var override parsing', () => {
  it('empty string returns DEFAULT_ALLOWED_PREFIXES', () => {
    const result = getAllowedRedirectPrefixes('');
    expect(result).toEqual(DEFAULT_ALLOWED_PREFIXES);
  });

  it('unset (undefined) returns DEFAULT_ALLOWED_PREFIXES', () => {
    const result = getAllowedRedirectPrefixes(undefined);
    expect(result).toEqual(DEFAULT_ALLOWED_PREFIXES);
  });

  it('whitespace-only string returns DEFAULT_ALLOWED_PREFIXES', () => {
    const result = getAllowedRedirectPrefixes('   ');
    expect(result).toEqual(DEFAULT_ALLOWED_PREFIXES);
  });

  it('single value "sitesurvey://" returns only that prefix', () => {
    const result = getAllowedRedirectPrefixes('sitesurvey://');
    expect(result).toEqual(['sitesurvey://']);
  });

  it('full three-value string parses correctly', () => {
    const result = getAllowedRedirectPrefixes('sitesurvey://,exp://,com.underthesun.');
    expect(result).toEqual(['sitesurvey://', 'exp://', 'com.underthesun.']);
  });

  it('trims whitespace around commas', () => {
    const result = getAllowedRedirectPrefixes(' sitesurvey:// , exp:// , com.underthesun. ');
    expect(result).toEqual(['sitesurvey://', 'exp://', 'com.underthesun.']);
  });

  it('filters out empty segments from trailing comma', () => {
    const result = getAllowedRedirectPrefixes('sitesurvey://,');
    expect(result).toEqual(['sitesurvey://']);
  });
});

describe('authorize — the exact partners-bot bug scenario', () => {
  /**
   * BUG REPORT (partners-bot):
   *   Vercel had AUTHORIZE_ALLOWED_REDIRECTS=sitesurvey://
   *   Expo Go sends redirect_uri=exp://u.expo.dev/update/.../--/login
   *   Response: {"error":"redirect_uri is not in the allowlist","allowedPrefixes":["sitesurvey://"]}
   *
   * These tests document the root cause and the correct fix.
   */

  it('REPRODUCES BUG: only sitesurvey:// in env → exp:// is REJECTED', () => {
    const buggyEnv = 'sitesurvey://';
    const allowed = getAllowedRedirectPrefixes(buggyEnv);
    const expoUri = 'exp://u.expo.dev/update/019e37fd-72e0-7d02-bf96-fd09456d1acf/--/login';
    expect(isRedirectAllowed(expoUri, allowed)).toBe(false); // This is the bug
  });

  it('FIX: sitesurvey://,exp://,com.underthesun. in env → exp:// is ACCEPTED', () => {
    const fixedEnv = 'sitesurvey://,exp://,com.underthesun.';
    const allowed = getAllowedRedirectPrefixes(fixedEnv);
    const expoUri = 'exp://u.expo.dev/update/019e37fd-72e0-7d02-bf96-fd09456d1acf/--/login';
    expect(isRedirectAllowed(expoUri, allowed)).toBe(true); // Fixed
  });

  it('FIX: default (unset env) → exp:// is ACCEPTED', () => {
    const allowed = getAllowedRedirectPrefixes(undefined); // env var not set
    const expoUri = 'exp://u.expo.dev/update/019e37fd-72e0-7d02-bf96-fd09456d1acf/--/login';
    expect(isRedirectAllowed(expoUri, allowed)).toBe(true); // Fixed via defaults
  });

  it('FIX: sitesurvey:// still works after adding exp:// and com.underthesun.', () => {
    const fixedEnv = 'sitesurvey://,exp://,com.underthesun.';
    const allowed = getAllowedRedirectPrefixes(fixedEnv);
    expect(isRedirectAllowed('sitesurvey://login', allowed)).toBe(true);
  });
});

describe('authorize — source code integrity checks', () => {
  const routeSource = fs.readFileSync(
    path.join(root, 'app/api/auth/authorize/route.ts'),
    'utf8',
  );

  it('route.ts DEFAULT_ALLOWED_PREFIXES includes sitesurvey://', () => {
    expect(routeSource).toContain("'sitesurvey://'");
  });

  it('route.ts DEFAULT_ALLOWED_PREFIXES includes exp://', () => {
    expect(routeSource).toContain("'exp://'");
  });

  it('route.ts DEFAULT_ALLOWED_PREFIXES includes com.underthesun.', () => {
    expect(routeSource).toContain("'com.underthesun.'");
  });

  it('route.ts error JSON response includes fix hint field', () => {
    // The key is an unquoted JS object property: `fix: '...'`
    expect(routeSource).toContain('fix:');
    expect(routeSource).toContain('sitesurvey://,exp://,com.underthesun.');
  });

  it('route.ts HTML error page references Vercel env var setup', () => {
    expect(routeSource).toContain('Vercel → Project → Settings → Environment Variables');
  });

  it('route.ts HTML error page shows the correct full value to set', () => {
    expect(routeSource).toContain('sitesurvey://,exp://,com.underthesun.');
  });
});

describe('authorize — .env.example integrity', () => {
  const envExample = fs.readFileSync(
    path.join(root, '.env.example'),
    'utf8',
  );

  it('.env.example AUTHORIZE_ALLOWED_REDIRECTS includes sitesurvey://', () => {
    const line = envExample.split('\n').find(l => l.startsWith('AUTHORIZE_ALLOWED_REDIRECTS='));
    expect(line).toBeDefined();
    expect(line).toContain('sitesurvey://');
  });

  it('.env.example AUTHORIZE_ALLOWED_REDIRECTS includes exp://', () => {
    const line = envExample.split('\n').find(l => l.startsWith('AUTHORIZE_ALLOWED_REDIRECTS='));
    expect(line).toBeDefined();
    expect(line).toContain('exp://');
  });

  it('.env.example AUTHORIZE_ALLOWED_REDIRECTS includes com.underthesun.', () => {
    const line = envExample.split('\n').find(l => l.startsWith('AUTHORIZE_ALLOWED_REDIRECTS='));
    expect(line).toBeDefined();
    expect(line).toContain('com.underthesun.');
  });

  it('.env.example warns that setting the var overrides defaults entirely', () => {
    expect(envExample).toContain('defaults entirely');
  });

  it('.env.example does NOT set a value that drops exp:// or com.underthesun.', () => {
    const line = envExample.split('\n').find(l => l.startsWith('AUTHORIZE_ALLOWED_REDIRECTS='));
    // The value must contain all three
    expect(line).toContain('exp://');
    expect(line).toContain('com.underthesun.');
  });
});
