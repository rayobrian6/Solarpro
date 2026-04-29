// ============================================================================
// GET /api/auth/authorize
//
// OAuth-style authorize endpoint for external apps (e.g. the Mobile Site
// Survey app). This is the canonical SSO entry point.
//
// FLOW:
//   1. External app opens:
//        https://solarpro.solutions/api/auth/authorize?
//          redirect_uri=sitesurvey://login&state=<random>
//
//   2. If the request has a valid SolarPro session cookie, this endpoint:
//        - Mints a short-lived (10 min) HS256 JWT with ALL identity claims
//          required by the mobile app
//        - Records the jti in mobile_sso_used_jtis for replay protection
//        - Redirects (302) to:
//            <redirect_uri>?token=<jwt>&state=<state>
//
//   3. If there is NO session, redirects to /auth/login?next=<this-url>
//      so the user logs in first and then gets redirected back here.
//
// JWT claims (the EXACT contract for B and C to trust):
//   {
//     "sub":              user.id                (subject - UUID)
//     "solarpro_user_id": user.id                (mirrored for clarity)
//     "email":            user.email
//     "name":             user.name
//     "iat":              <now>
//     "exp":              <now + 600>
//     "jti":              <uuid>                 (one-time, tracked in DB)
//   }
//
// SECURITY:
//   - redirect_uri is validated against AUTHORIZE_ALLOWED_REDIRECTS env var
//     (comma-separated allowlist of exact prefixes). Default allowlist:
//       sitesurvey://
//   - This PREVENTS open-redirect abuse.
//   - JWT signed with SOLARPRO_HANDOFF_SECRET (HS256, >=32 chars).
//   - jti recorded in mobile_sso_used_jtis; mobile app MUST mark it consumed
//     on first use via POST /api/users/solarpro-sso (existing endpoint).
//
// This endpoint is CSRF-safe because it is GET-only and purely issues a
// bearer token - it does not mutate any user-owned state.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SSO_TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes

// ---------------------------------------------------------------------------
// getAllowedRedirectPrefixes
//
// Reads AUTHORIZE_ALLOWED_REDIRECTS (comma-separated) and returns a trimmed
// list. Falls back to a safe default that only allows the mobile app's
// sitesurvey:// scheme.
// ---------------------------------------------------------------------------
function getAllowedRedirectPrefixes(): string[] {
  const raw = (process.env.AUTHORIZE_ALLOWED_REDIRECTS ?? 'sitesurvey://').trim();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// isRedirectAllowed
//
// Returns true when redirect_uri begins with at least one allowed prefix.
// Exact prefix match - do NOT do substring match (that would allow
// https://evil.com/sitesurvey:// to sneak through).
// ---------------------------------------------------------------------------
function isRedirectAllowed(redirectUri: string, allowed: string[]): boolean {
  for (const prefix of allowed) {
    if (redirectUri.startsWith(prefix)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  // -- Rate limit -----------------------------------------------------------
  const rl = await checkRateLimit('mobile-session', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
  }

  // -- Parse query params ---------------------------------------------------
  const { searchParams } = new URL(req.url);
  const redirectUri = searchParams.get('redirect_uri')?.trim() ?? '';
  const state = searchParams.get('state')?.trim() ?? '';

  if (!redirectUri) {
    return NextResponse.json(
      { error: 'redirect_uri query parameter is required' },
      { status: 400 },
    );
  }

  // -- Validate redirect_uri against allowlist ------------------------------
  const allowedPrefixes = getAllowedRedirectPrefixes();
  if (!isRedirectAllowed(redirectUri, allowedPrefixes)) {
    console.warn(
      `[authorize] rejected redirect_uri="${redirectUri}" — not in allowlist ` +
      `(${allowedPrefixes.join(', ')})`,
    );
    return NextResponse.json(
      {
        error: 'redirect_uri is not in the allowlist',
        allowedPrefixes,
      },
      { status: 400 },
    );
  }

  // -- Check session --------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    // Not logged in - bounce to the SolarPro login page with ?next=<this-url>
    // so that after login the user returns here and completes the authorize.
    const nextUrl = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    const loginUrl = new URL('/auth/login', req.nextUrl.origin);
    loginUrl.searchParams.set('next', nextUrl);
    return NextResponse.redirect(loginUrl, { status: 302 });
  }

  // -- Env check ------------------------------------------------------------
  const secret = process.env.SOLARPRO_HANDOFF_SECRET?.trim();
  if (!secret || secret.length < 32) {
    console.error('[authorize] SOLARPRO_HANDOFF_SECRET missing or < 32 chars');
    return NextResponse.json(
      { error: 'SSO not configured on server' },
      { status: 500 },
    );
  }

  // -- Mint SSO JWT ---------------------------------------------------------
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SSO_TOKEN_TTL_SECONDS;

  const claims = {
    sub: user.id,
    solarpro_user_id: user.id,
    email: user.email,
    name: user.name ?? '',
    iat,
    exp,
    jti,
  };

  let token: string;
  try {
    token = jwt.sign(claims, secret, {
      algorithm: 'HS256',
      noTimestamp: true, // iat set manually
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[authorize] JWT signing failed: ${msg}`);
    return NextResponse.json(
      { error: 'Failed to mint SSO token' },
      { status: 500 },
    );
  }

  // -- Record jti for replay protection -------------------------------------
  try {
    const sql = await getDbReady();
    const expiresAt = new Date(exp * 1000).toISOString();
    await sql`
      INSERT INTO mobile_sso_used_jtis (jti, user_id, used_at, expires_at)
      VALUES (${jti}, ${user.id}, NOW(), ${expiresAt})
      ON CONFLICT (jti) DO NOTHING
    `;
    // Opportunistic cleanup of expired rows (non-blocking)
    sql`DELETE FROM mobile_sso_used_jtis WHERE expires_at < NOW()`.catch(() => {});
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[authorize] jti recording failed: ${msg}`);
    return NextResponse.json(
      { error: 'Failed to record session' },
      { status: 500 },
    );
  }

  // -- Log (no PII) ---------------------------------------------------------
  console.log(
    `[authorize] issued SSO token userId=${user.id} jti=${jti} redirect=${redirectUri}`,
  );

  // -- Build redirect URL ---------------------------------------------------
  // We cannot use URL class for sitesurvey:// (custom scheme), so build manually.
  const joiner = redirectUri.includes('?') ? '&' : '?';
  const parts = [`token=${encodeURIComponent(token)}`];
  if (state) parts.push(`state=${encodeURIComponent(state)}`);
  const target = `${redirectUri}${joiner}${parts.join('&')}`;

  return NextResponse.redirect(target, { status: 302 });
}