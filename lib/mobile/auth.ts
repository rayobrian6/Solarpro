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
  //
  // Check SOLARPRO_HANDOFF_SECRET first so we can give a precise error.
  // verifyHandoffToken silently returns null when the secret is missing —
  // we surface that clearly here so it shows up in logs.
  const handoffSecretPresent = !!process.env.SOLARPRO_HANDOFF_SECRET;
  const handoffSecretLen     = process.env.SOLARPRO_HANDOFF_SECRET?.length ?? 0;

  if (!handoffSecretPresent) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — SOLARPRO_HANDOFF_SECRET is not set in environment. ` +
      `Add this env var in Vercel → Settings → Environment Variables. ` +
      `It must match the secret used to sign tokens in the mobile app.`
    );
    return null;
  }

  if (handoffSecretLen < 32) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — SOLARPRO_HANDOFF_SECRET is too short ` +
      `(${handoffSecretLen} chars, minimum 32). Update the env var.`
    );
    return null;
  }

  let decoded: ReturnType<typeof verifyHandoffToken>;
  try {
    decoded = verifyHandoffToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MOBILE_AUTH_FAIL] ${routeLabel} — JWT verify threw: ${msg}`);
    return null;
  }

  if (!decoded) {
    // Secret is set but token still failed — decode header to get more info
    let tokenAlg = 'unknown';
    try {
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
      tokenAlg = header.alg ?? 'unknown';
    } catch { /* ignore */ }

    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — verifyHandoffToken returned null. ` +
      `Secret IS set (len=${handoffSecretLen}). Token alg=${tokenAlg}. ` +
      `Likely causes: (1) wrong secret value — secret used to sign token ` +
      `does not match SOLARPRO_HANDOFF_SECRET in Vercel env, ` +
      `(2) token expired, (3) token signed with different algorithm than HS256.`
    );
    return null;
  }

  // STEP 4 — Debug: log full decoded payload (temp, aids mobile compat debugging)
  console.log(`[MOBILE_AUTH_DEBUG] ${routeLabel} decoded claims:`, JSON.stringify(decoded));

  // STEP 5 — Extract userId from any of the supported claim names.
  //
  // COMPATIBILITY LAYER (Phase 4.15.3):
  //   Mobile tokens may use any of these claim names depending on which
  //   version of the mobile app / token minter produced them.
  //   Future phase will standardize all tokens to solarpro_user_id only.
  //
  //   Priority: solarpro_user_id → userId → sub
  const d   = decoded as unknown as Record<string, unknown>;
  const uid = (d.solarpro_user_id ?? d.userId ?? d.sub) as string | undefined;

  if (!uid) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — JWT valid but no user identity claim found. ` +
      `Checked: solarpro_user_id, userId, sub. ` +
      `Claims present: ${Object.keys(decoded).join(', ')}`
    );
    return null;
  }

  // UUID format check — warn but DO NOT reject (compatibility layer)
  if (!isValidUUID(uid)) {
    console.warn(
      `[MOBILE_AUTH_WARN] ${routeLabel} — non-UUID userId received: "${uid}". ` +
      `Allowing through (compatibility mode). Standardize token to use UUID in future.`
    );
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