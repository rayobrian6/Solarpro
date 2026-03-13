/**
 * lib/env.ts — Centralized Environment Variable Module
 *
 * Single source of truth for all environment variable access in the application.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DESIGN PRINCIPLES                                                      │
 * │                                                                         │
 * │  1. TYPED ACCESSORS — all env vars are accessed through typed           │
 * │     getter functions, never raw process.env.XYZ scattered in code.     │
 * │                                                                         │
 * │  2. FAIL-FAST — required vars throw at call time with a clear message. │
 * │     This surfaces misconfigured deployments immediately on first        │
 * │     request rather than failing silently with a cryptic DB error.       │
 * │                                                                         │
 * │  3. LAZY — vars are read at call time (not module load time) so that   │
 * │     Next.js build does not fail when vars are absent in CI.             │
 * │     Use assertEnv() in next.config.js to fail the BUILD if needed.     │
 * │                                                                         │
 * │  4. OBSERVABLE — logEnvStatus() produces a single structured log line  │
 * │     per cold start so you can verify all vars in Vercel logs instantly. │
 * │                                                                         │
 * │  5. DB CONNECTION CACHING — lib/db-ready.ts already maintains a        │
 * │     module-level Neon executor singleton (one neon(url) call per        │
 * │     cold start) plus a warm-cache flag that skips the SELECT 1 probe    │
 * │     on subsequent requests. No further caching is needed here.          │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * REQUIRED VARIABLES (app cannot function without these):
 *   DATABASE_URL          — Neon PostgreSQL connection string
 *   JWT_SECRET            — JWT session signing secret (32+ chars)
 *
 * RECOMMENDED VARIABLES (degraded functionality if missing):
 *   OPENAI_API_KEY        — AI bill extraction
 *   GOOGLE_MAPS_API_KEY   — Geocoding + utility rate detection
 *   RESEND_API_KEY        — Transactional email (password reset, etc.)
 *   NEXT_PUBLIC_BASE_URL  — Production base URL for email links + Stripe
 *
 * USAGE:
 *   import { getDatabaseUrl, getJwtSecret, getResendApiKey } from '@/lib/env';
 *   const url  = getDatabaseUrl();    // throws if missing
 *   const key  = getResendApiKey();   // returns null if missing
 *   const base = getBaseUrl();        // returns fallback if missing
 */

// Re-export the validation utilities — single import point for callers
export {
  validateEnv,
  assertEnv,
  logEnvStatus,
  getMissingVars,
  type EnvValidationResult,
} from '@/lib/env-check';

// ── Required variable accessors ───────────────────────────────────────────────
// These THROW if the variable is missing. Call them in request handlers,
// never at module load time (to keep Next.js build working in CI with stubs).

/**
 * Returns DATABASE_URL.
 * Throws a descriptive error if it is missing or is the placeholder value.
 *
 * Note: lib/db-ready.ts calls this internally — you rarely need to call it
 * directly. Use getDbReady() from lib/db-neon.ts for database access.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url === 'YOUR_NEON_DATABASE_URL_HERE') {
    console.error(
      '\n[ENV] DATABASE_URL is not configured.\n' +
      '  → Add it to: Vercel → Project → Settings → Environment Variables\n' +
      '  → Get it from: https://console.neon.tech → your project → Connection string\n'
    );
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return url;
}

/**
 * Returns JWT_SECRET.
 * Throws if missing. Never log or expose this value.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error(
      '\n[ENV] JWT_SECRET is not configured.\n' +
      '  → Add it to: Vercel → Project → Settings → Environment Variables\n' +
      '  → Value: any random 32+ character string\n'
    );
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

// ── Recommended variable accessors ───────────────────────────────────────────
// These return null (or a sensible default) if missing and log a warning.
// Features that depend on them should degrade gracefully.

/**
 * Returns OPENAI_API_KEY or null if not configured.
 * When null, AI bill extraction falls back to Tesseract OCR.
 */
export function getOpenAiApiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith('sk-YOUR')) {
    console.warn('[ENV] OPENAI_API_KEY not set — AI bill extraction disabled, Tesseract fallback active');
    return null;
  }
  return key;
}

/**
 * Returns GOOGLE_MAPS_API_KEY or null if not configured.
 * When null, geocoding and utility rate detection are disabled.
 */
export function getGoogleMapsApiKey(): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    // Warn only in non-test environments to keep test output clean
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[ENV] GOOGLE_MAPS_API_KEY not set — geocoding disabled');
    }
    return null;
  }
  return key;
}

/**
 * Returns RESEND_API_KEY or null if not configured.
 * When null, sendEmail() falls back to console.log (dev mode).
 * In production this means password reset emails are NEVER sent.
 */
export function getResendApiKey(): string | null {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 're_YOUR_RESEND_API_KEY_HERE') {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[ENV] RESEND_API_KEY not set in production — transactional emails will NOT be sent.\n' +
        '  → Add it to: Vercel → Project → Settings → Environment Variables\n' +
        '  → Get it from: https://resend.com/api-keys\n'
      );
    }
    return null;
  }
  return key;
}

/**
 * Returns the production base URL for constructing absolute URLs
 * (email reset links, Stripe callbacks, etc.).
 *
 * Priority order:
 *   1. NEXT_PUBLIC_APP_URL    — explicit production override
 *   2. NEXT_PUBLIC_BASE_URL   — used by Stripe routes
 *   3. VERCEL_URL             — auto-set by Vercel (may be preview/ephemeral URL)
 *   4. Hard-coded fallback    — solarpro-v31.vercel.app
 *
 * Never returns a trailing slash.
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.NEXT_PUBLIC_BASE_URL) {
    return process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    const url = `https://${process.env.VERCEL_URL}`;
    if (/[a-f0-9]{8,}/.test(process.env.VERCEL_URL)) {
      console.warn(
        '[ENV] VERCEL_URL appears to be an ephemeral preview deployment URL.\n' +
        '  → Email reset links may point to the wrong domain.\n' +
        '  → Fix: set NEXT_PUBLIC_BASE_URL=https://solarpro-v31.vercel.app in Vercel env vars.'
      );
    }
    return url;
  }
  return 'https://solarpro-v31.vercel.app';
}

// ── Informational accessors ───────────────────────────────────────────────────

/** Returns the current Node environment. */
export function getNodeEnv(): 'development' | 'production' | 'test' {
  return (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test';
}

/** Returns true when running in a Vercel environment. */
export function isVercel(): boolean {
  return !!process.env.VERCEL;
}

/** Returns true when running in a Vercel production environment. */
export function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

/** Returns MIGRATE_SECRET or null. */
export function getMigrateSecret(): string | null {
  return process.env.MIGRATE_SECRET ?? null;
}