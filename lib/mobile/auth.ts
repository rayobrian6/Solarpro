// ============================================================================
// lib/mobile/auth.ts
//
// PHASE 4.15.2 — Shared mobile Bearer JWT authentication helper.
//
// ALL /api/mobile/* routes MUST call resolveMobileUser() for auth.
// No exceptions — unauthenticated access is never permitted.
//
// Auth flow:
//   1. Session cookie  (SolarPro web user, same browser session)
//   2. Bearer JWT      (mobile field app, SOLARPRO_HANDOFF_SECRET-signed HS256)
//
// Returns:
//   MobileAuthResult   on success (userId + source)
//   null               on failure — caller MUST return mobileAuthError()
//
// All failure paths are logged with [MOBILE_AUTH_FAIL] tag so they are
// immediately visible in Vercel function logs.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { isValidUUID } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MobileAuthResult {
  userId: string;
  source: 'session_cookie' | 'bearer_jwt';
}

// ---------------------------------------------------------------------------
// resolveMobileUser
//
// Validates auth from session cookie OR Bearer JWT.
// Logs every failure path with structured [MOBILE_AUTH_FAIL] tags.
// Never throws. Returns null if auth is missing or invalid.
// ---------------------------------------------------------------------------
export function resolveMobileUser(
  req: NextRequest,
  routeLabel: string,
): MobileAuthResult | null {

  // ── Path A: Session cookie ─────────────────────────────────────────────────
  try {
    const sessionUser = getUserFromRequest(req);
    if (sessionUser?.id && isValidUUID(sessionUser.id)) {
      return { userId: sessionUser.id, source: 'session_cookie' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MOBILE_AUTH_FAIL] ${routeLabel} session cookie parse error: ${msg}`);
  }

  // ── Path B: Bearer JWT ─────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? null;

  // STEP 1 — Is the Authorization header present?
  if (!authHeader) {
    console.warn(`[MOBILE_AUTH_FAIL] ${routeLabel} — no Authorization header`);
    return null;
  }

  // STEP 2 — Does it match "Bearer <token>"?
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) {
    console.warn(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — Authorization header not Bearer format` +
      ` (received: "${authHeader.slice(0, 40)}...")`
    );
    return null;
  }

  const token = bearerMatch[1];
  console.log(`[MOBILE_AUTH] ${routeLabel} — Bearer token received (len=${token.length})`);

  // STEP 3 — Verify the JWT signature + expiry
  let decoded: ReturnType<typeof verifyHandoffToken>;
  try {
    decoded = verifyHandoffToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MOBILE_AUTH_FAIL] ${routeLabel} — JWT verify threw: ${msg}`);
    return null;
  }

  if (!decoded) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — verifyHandoffToken returned null ` +
      `(expired, wrong secret, or malformed JWT)`
    );
    return null;
  }

  // STEP 4 — Ensure solarpro_user_id claim is present and a valid UUID
  const uid = decoded.solarpro_user_id;
  if (!uid) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — JWT valid but missing solarpro_user_id claim. ` +
      `Claims present: ${Object.keys(decoded).join(', ')}`
    );
    return null;
  }
  if (!isValidUUID(uid)) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — solarpro_user_id "${uid}" is not a valid UUID`
    );
    return null;
  }

  console.log(`[MOBILE_AUTH] ${routeLabel} — authenticated userId=${uid} via bearer_jwt`);
  return { userId: uid, source: 'bearer_jwt' };
}

// ---------------------------------------------------------------------------
// mobileAuthError
//
// Returns a structured 401 JSON response with a human-readable reason.
// Always call this immediately when resolveMobileUser returns null.
// ---------------------------------------------------------------------------
export function mobileAuthError(routeLabel: string, req: NextRequest): NextResponse {
  const authHeader = req.headers.get('authorization') ?? null;

  const reason = !authHeader
    ? 'No Authorization header. Include: Authorization: Bearer <token>'
    : !authHeader.match(/^Bearer\s+/i)
    ? 'Authorization header must use Bearer scheme: Authorization: Bearer <token>'
    : 'Bearer token is invalid or expired. Re-authenticate to get a fresh token.';

  console.warn(`[MOBILE_AUTH_FAIL] ${routeLabel} — 401 returned: ${reason}`);

  return NextResponse.json(
    {
      error:   'auth_failed',
      message: reason,
      debug: {
        authHeaderPresent: !!authHeader,
        tokenPresent:      !!(authHeader?.match(/^Bearer\s+/i)),
      },
    },
    { status: 401 },
  );
}