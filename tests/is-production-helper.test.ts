/**
 * tests/is-production-helper.test.ts
 *
 * Unit tests for the `isProduction()` helper in lib/env.ts — the SINGLE
 * SOURCE OF TRUTH for the Secure-cookie flag and the dev-auth hard-block.
 *
 * BACKGROUND (audit §2 #2):
 *   Vercel sets NODE_ENV=production for ALL deployment types
 *   (Production, Preview, Development CLI). Using NODE_ENV as the
 *   production gate was the source of the v47.57 dev-auth regression and
 *   was also wrong for the Secure-cookie flag in `lib/auth.ts`. The fix
 *   was to centralize the production-gate decision in `isProduction()`,
 *   which prefers VERCEL_ENV when set and falls back to NODE_ENV only
 *   for non-Vercel hosting.
 *
 * TRUTH TABLE (the tests below assert each cell of this):
 *
 *   VERCEL_ENV    | NODE_ENV       | isProduction()
 *   --------------|----------------|---------------
 *   'production'  | 'production'   | true   ← Vercel production deploy
 *   'production'  | 'development'  | true   ← Vercel production deploy, unlikely but possible
 *   'production'  | (unset)        | true   ← Vercel production deploy
 *   'preview'     | 'production'   | false  ← Vercel preview (Secure cookies still OK, but not "production")
 *   'development' | 'production'   | false  ← Vercel dev CLI
 *   'preview'     | 'development'  | false
 *   (unset)       | 'production'   | true   ← local w/ `next build && next start`
 *   (unset)       | 'development'  | false  ← local dev
 *   (unset)       | (unset)        | false  ← unset default
 *
 * No DB / Redis / network needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isProduction } from '../lib/env';

// `process.env.NODE_ENV` is typed as the literal union
// `'development' | 'production' | 'test'`, which makes direct assignment
// and `delete` a TypeScript error. The established pattern in this repo
// (see tests/migration-batch-execution-postgres.test.ts) is to cast the
// whole `process.env` to `Record<string, string | undefined>` for the
// duration of the test. This helper keeps the cast in one place so the
// test body reads naturally.
type LooseEnv = Record<string, string | undefined>;
const env = process.env as LooseEnv;

describe('isProduction() — VERCEL_ENV-aware production gate', () => {
  // Snapshot the env so each test can mutate freely without leaking.
  const SAVED: LooseEnv = {
    VERCEL_ENV:  process.env.VERCEL_ENV,
    NODE_ENV:    process.env.NODE_ENV,
    VERCEL:      process.env.VERCEL,
  };

  beforeEach(() => {
    // Start each test from a clean slate.
    delete env.VERCEL_ENV;
    delete env.NODE_ENV;
    delete env.VERCEL;
  });

  afterEach(() => {
    // Restore the original env.
    for (const [k, v] of Object.entries(SAVED)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  });

  // ── VERCEL_ENV=production: ALWAYS production (overrides NODE_ENV) ─────────
  describe("VERCEL_ENV === 'production'", () => {
    beforeEach(() => { env.VERCEL_ENV = 'production'; });

    it('returns true when NODE_ENV is also production (Vercel prod deploy)', () => {
      env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
    });

    it('returns true when NODE_ENV is development (defensive — should not happen but should still be safe)', () => {
      env.NODE_ENV = 'development';
      expect(isProduction()).toBe(true);
    });

    it('returns true when NODE_ENV is unset', () => {
      delete env.NODE_ENV;
      expect(isProduction()).toBe(true);
    });

    it('returns true when NODE_ENV is test (defensive — dev running tests against prod-like env)', () => {
      env.NODE_ENV = 'test';
      expect(isProduction()).toBe(true);
    });
  });

  // ── VERCEL_ENV=preview: NOT production, even though NODE_ENV=production ───
  describe("VERCEL_ENV === 'preview'", () => {
    beforeEach(() => { env.VERCEL_ENV = 'preview'; });

    it('returns false when NODE_ENV is production (Vercel preview deploy)', () => {
      // This is the exact bug pattern from v47.57 — old code returned
      // true here because NODE_ENV=production. The fix is to prefer
      // VERCEL_ENV when set.
      env.NODE_ENV = 'production';
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV is development', () => {
      env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV is unset', () => {
      delete env.NODE_ENV;
      expect(isProduction()).toBe(false);
    });
  });

  // ── VERCEL_ENV=development: NOT production ────────────────────────────────
  describe("VERCEL_ENV === 'development'", () => {
    beforeEach(() => { env.VERCEL_ENV = 'development'; });

    it('returns false when NODE_ENV is production (Vercel dev CLI)', () => {
      env.NODE_ENV = 'production';
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV is development', () => {
      env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });
  });

  // ── VERCEL_ENV unset (local / non-Vercel hosting) ────────────────────────
  describe('VERCEL_ENV is unset (local dev / non-Vercel hosting)', () => {
    it('returns true when NODE_ENV=production (e.g. local `next build && next start`)', () => {
      delete env.VERCEL_ENV;
      env.NODE_ENV = 'production';
      expect(isProduction()).toBe(true);
    });

    it('returns false when NODE_ENV=development (local dev server)', () => {
      delete env.VERCEL_ENV;
      env.NODE_ENV = 'development';
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV is unset (CI without explicit env)', () => {
      delete env.VERCEL_ENV;
      delete env.NODE_ENV;
      expect(isProduction()).toBe(false);
    });

    it('returns false when NODE_ENV=test (Vitest default)', () => {
      delete env.VERCEL_ENV;
      env.NODE_ENV = 'test';
      expect(isProduction()).toBe(false);
    });
  });
});

// ── Regression guard: NO `NODE_ENV === 'production'` in auth path ───────────
describe('Regression guard: auth-path files no longer use NODE_ENV as the Secure gate', () => {
  it('lib/auth.ts: makeSessionCookie / clearSessionCookie do not use NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'lib', 'auth.ts'),
      'utf8',
    );
    // The old pattern was: `process.env.NODE_ENV === 'production'`.
    // The new pattern is: `isProduction()` from '@/lib/env'.
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    // The new helper must be used.
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });

  it('app/api/auth/login: no Secure flag uses raw NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'app', 'api', 'auth', 'login', 'route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });

  it('app/api/auth/logout: no Secure flag uses raw NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'app', 'api', 'auth', 'logout', 'route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });

  it('app/api/auth/register: no Secure flag uses raw NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'app', 'api', 'auth', 'register', 'route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });

  it('app/api/auth/mfa/setup: no Secure flag uses raw NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'app', 'api', 'auth', 'mfa', 'setup', 'route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });

  it('app/api/auth/mfa/verify: no Secure flag uses raw NODE_ENV', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '..', 'app', 'api', 'auth', 'mfa', 'verify', 'route.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/isProduction\s*\(\s*\)/);
  });
});
