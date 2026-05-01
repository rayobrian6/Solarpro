// GET /api/debug/auth
// Safe diagnostic endpoint — reveals cookie presence, expected name, session validity,
// auth secret fingerprint, environment, and dev-auth bypass status.
// Does NOT expose the actual token or secret.
// Listed as a PUBLIC_PATH in middleware so it can be reached even when unauthenticated.
//
// v47.59 additions:
//   - devAuthBypassed: is dev auth currently active for this request?
//   - devAuthAllowed: would dev auth be allowed given current env vars?
//   - vercelEnv: the ONLY reliable signal for Vercel preview vs production
//   - nodeEnv: reported for reference (always 'production' on Vercel — not a reliable guard)

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, verifyToken } from '@/lib/auth';
import { isDevAuthAllowed, getDevSessionUser } from '@/lib/dev-auth';
import { productionGuard } from '@/lib/security';

export async function GET(req: NextRequest) {
  // SECURITY: Block debug routes in production
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // --- Cookie inspection ---
  const rawCookieHeader = req.headers.get('cookie') || '';

  const token   = req.cookies.get(COOKIE_NAME)?.value ?? null;
  const session = token ? verifyToken(token) : null;

  // --- Auth secret presence check (no fingerprint exposed — v48.5 security hardening) ---
  let jwtSecretSet = false;
  try {
    jwtSecretSet = !!(process.env.JWT_SECRET);
  } catch { /* ignore */ }

  // --- Dev auth bypass status ---
  // isDevAuthAllowed() uses VERCEL_ENV (not NODE_ENV) as the production gate.
  // On Vercel, NODE_ENV=production for ALL env types (production + preview + development).
  // VERCEL_ENV is the only reliable signal.
  const devAuthBypassEnvSet = process.env.DEV_AUTH_BYPASS === 'true';
  const devAuthAllowed = isDevAuthAllowed();
  const devUser = getDevSessionUser(req.headers);
  const devAuthBypassed = devUser !== null;

  const result = {
    timestamp:              new Date().toISOString(),

    // ── Environment ──────────────────────────────────────────────
    // IMPORTANT: nodeEnv is always 'production' on Vercel for ALL deployment types.
    // Use vercelEnv to distinguish production vs preview vs development on Vercel.
    nodeEnv:                process.env.NODE_ENV ?? 'unknown',
    vercelEnv:              process.env.VERCEL_ENV ?? 'not_set (local dev)',

    // ── Cookie ────────────────────────────────────────────────────
    cookieHeaderPresent:    rawCookieHeader.length > 0,
    // SECURITY: allCookieNames removed — leaks request cookie names to unauthenticated callers.
    expectedCookieName:     COOKIE_NAME,
    hasAuthCookie:          !!token,
    tokenLength:            token ? token.length : 0,

    // ── Session ───────────────────────────────────────────────────
    // SECURITY: sessionUserId and sessionUserEmail removed — PII must not be returned
    // to unauthenticated callers even on preview deployments. Boolean validity is sufficient.
    sessionValid:           !!(session?.id),

    // ── Secret ───────────────────────────────────────────────────
    // v48.5: authSecretFingerprint removed — leaked JWT secret metadata to unauthenticated callers.
    // jwtSecretSet is sufficient to diagnose missing JWT_SECRET without exposing fingerprint data.
    jwtSecretSet,
    databaseUrlSet:         !!(process.env.DATABASE_URL),

    // ── Dev auth bypass ───────────────────────────────────────────
    // devAuthAllowed: true means VERCEL_ENV !== 'production' AND DEV_AUTH_BYPASS=true
    // devAuthBypassed: true means this request is currently using dev auth
    devAuthAllowed,
    devAuthBypassed,
    devAuthBypassEnvSet,

    // ── Diagnosis hints ──────────────────────────────────────────
    // If sessionValid=false and jwtSecretSet=false: JWT_SECRET missing in Vercel Settings
    // If sessionValid=false and jwtSecretSet=true: fingerprint mismatch between environments
    //   → ensure JWT_SECRET is the SAME value in Production + Preview + Development
    // If hasAuthCookie=false after login: Set-Cookie was stripped by proxy
    //   → check vercel.json and next.config headers() for Cache-Control on /api routes
    // If devAuthAllowed=false on preview: check VERCEL_ENV and DEV_AUTH_BYPASS
    //   → NODE_ENV is ALWAYS 'production' on Vercel — cannot be used as a guard
    diagnosisHints: [
      !jwtSecretSet
        ? 'CRITICAL: JWT_SECRET not set — Vercel Settings → Environment Variables → Add JWT_SECRET for Production + Preview + Development'
        : null,
      jwtSecretSet && !session && !!token
        ? 'WARNING: JWT_SECRET set but token verification failed — JWT_SECRET may differ between environments. Ensure same value in Production + Preview + Development.'
        : null,
      !token && !devAuthBypassed
        ? 'INFO: No auth cookie and dev bypass not active — user not logged in or cookie was stripped'
        : null,
      devAuthBypassEnvSet && !devAuthAllowed
        ? 'WARNING: DEV_AUTH_BYPASS=true but dev auth is NOT allowed — VERCEL_ENV=production detected. Bypass is intentionally blocked on production.'
        : null,
    ].filter(Boolean),
  };

  console.log('[DEBUG_AUTH]', JSON.stringify(result));

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Debug-Auth':  'true',
    },
  });
}