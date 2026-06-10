// GET /api/debug/auth
// Safe diagnostic endpoint — reveals cookie presence, expected name, session validity,
// and dev-auth bypass status.
// Does NOT expose the actual token, secret values, or infrastructure configuration.
// Listed as a PUBLIC_PATH in middleware so it can be reached even when unauthenticated.
//
// SECURITY (v49 hardening):
//   - Removed jwtSecretSet, databaseUrlSet from unauthenticated response
//     (attackers on preview deployments could use this to plan attacks)
//   - Removed vercelEnv, nodeEnv from unauthenticated response
//     (reveals deployment environment type to unauthenticated callers)
//   - These values are still logged server-side for operator diagnostics

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

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

  // --- Auth secret presence check (for server-side logging only) ---
  let jwtSecretSet = false;
  try {
    jwtSecretSet = !!(process.env.JWT_SECRET);
  } catch { /* ignore */ }

  // --- Dev auth bypass status ---
  const devAuthBypassEnvSet = process.env.DEV_AUTH_BYPASS === 'true';
  const devAuthAllowed = isDevAuthAllowed();
  const devUser = getDevSessionUser(req.headers);
  const devAuthBypassed = devUser !== null;

  // SECURITY: Infrastructure details removed from unauthenticated response.
  // These are logged server-side for operator diagnostics.
  const infraForLogging = {
    jwtSecretSet,
    databaseUrlSet: !!(process.env.DATABASE_URL),
    vercelEnv:      process.env.VERCEL_ENV ?? 'not_set',
    nodeEnv:        process.env.NODE_ENV ?? 'unknown',
  };

  const result = {
    timestamp:              new Date().toISOString(),

    // ── Cookie ──────────────────────────────────────────────────────
    cookieHeaderPresent:    rawCookieHeader.length > 0,
    expectedCookieName:     COOKIE_NAME,
    hasAuthCookie:          !!token,
    tokenLength:            token ? token.length : 0,

    // ── Session ─────────────────────────────────────────────────────
    sessionValid:           !!(session?.id),

    // ── Dev auth bypass ─────────────────────────────────────────────
    // devAuthAllowed/devAuthBypassed are safe to expose — they only
    // indicate whether dev bypass is active, not what secrets are set.
    devAuthAllowed,
    devAuthBypassed,
    devAuthBypassEnvSet,

    // ── Diagnosis hints ──────────────────────────────────────────────
    diagnosisHints: [
      !jwtSecretSet
        ? 'CRITICAL: JWT_SECRET not set — add JWT_SECRET in Vercel Settings for Production + Preview + Development'
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

  // Log full infrastructure details server-side (not in response)
  console.log('[DEBUG_AUTH]', JSON.stringify({ ...result, ...infraForLogging }));

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Debug-Auth':  'true',
    },
  });
}
