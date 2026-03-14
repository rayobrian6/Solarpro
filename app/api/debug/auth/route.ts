// GET /api/debug/auth
// Safe diagnostic endpoint — reveals cookie presence, expected name, session validity,
// auth secret fingerprint, and environment. Does NOT expose the actual token or secret.
// Used to verify auth is working without reading Vercel logs.
// Listed as a PUBLIC_PATH in middleware so it can be reached even when unauthenticated.

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  // --- Cookie inspection ---
  const rawCookieHeader = req.headers.get('cookie') || '';
  const allCookieNames  = rawCookieHeader
    .split(';')
    .map(c => c.trim().split('=')[0].trim())
    .filter(Boolean);

  const token   = req.cookies.get(COOKIE_NAME)?.value ?? null;
  const session = token ? verifyToken(token) : null;

  // --- Auth secret fingerprint (no secret exposed) ---
  let secretFingerprint = 'NOT_SET';
  try {
    const secret = process.env.JWT_SECRET || '';
    if (secret) {
      const charSum    = secret.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % 9999;
      secretFingerprint = `len=${secret.length}_head=${secret.substring(0, 4)}_tail=${secret.slice(-4)}_sum=${charSum}`;
    }
  } catch { /* ignore */ }

  const result = {
    timestamp:             new Date().toISOString(),
    environment:           process.env.NODE_ENV ?? 'unknown',
    vercelEnv:             process.env.VERCEL_ENV ?? 'not_vercel',
    // Cookie
    cookieHeaderPresent:   rawCookieHeader.length > 0,
    allCookieNames,
    expectedCookieName:    COOKIE_NAME,
    hasAuthCookie:         !!token,
    tokenLength:           token ? token.length : 0,
    // Session
    sessionValid:          !!(session?.id),
    sessionUserId:         session?.id   ?? null,
    sessionUserEmail:      session?.email ?? null,
    // Secret
    authSecretFingerprint: secretFingerprint,
    jwtSecretSet:          !!(process.env.JWT_SECRET),
    databaseUrlSet:        !!(process.env.DATABASE_URL),
  };

  console.log('[DEBUG_AUTH]', JSON.stringify(result));

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Debug-Auth':  'true',
    },
  });
}