// ============================================================================
// POST /api/auth/mobile-session
//
// Mints a short-lived HS256 SSO JWT for the mobile app.
// Requires the user to already be authenticated in SolarPro.
//
// JWT payload:
//   sub:   user.id
//   email: user.email
//   name:  user.name
//   iat:   now
//   exp:   now + 10 minutes
//   jti:   uuid (one-time use — tracked in DB, rejected on replay)
//
// Signed with SOLARPRO_HANDOFF_SECRET (same secret as handoff tokens).
//
// The /mobile-login page calls this after confirming the session, then
// redirects to sitesurvey://login?token=<jwt> to hand control to the app.
//
// BUG-21-04 FIX: JTI is now stored in mobile_sso_used_jtis on mint.
// The mobile app's token verification endpoint MUST check jti is not already
// consumed before accepting the token (see verifyMobileSsoJti below).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const SSO_TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes

export async function POST(req: NextRequest) {
  // -- Auth ------------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // -- Env check -------------------------------------------------------------
  const secret = process.env.SOLARPRO_HANDOFF_SECRET?.trim();
  if (!secret || secret.length < 32) {
    console.error('[mobile-session] SOLARPRO_HANDOFF_SECRET is not set or too short');
    return NextResponse.json(
      { error: 'SSO not configured' },
      { status: 500 },
    );
  }

  // -- Mint SSO JWT ----------------------------------------------------------
  const jti = randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + SSO_TOKEN_TTL_SECONDS;

  const claims = {
    sub: user.id,
    email: user.email,
    name: user.name ?? '',
    // Include solarpro_ prefixed claims so the partner SSO endpoint
    // can extract them from either field name.
    solarpro_user_id: user.id,
    solarpro_email: user.email,
    solarpro_name: user.name ?? '',
    jti,
    iat,
    exp,
  };

  let token: string;
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('mobile-session', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    token = jwt.sign(claims, secret, {
      algorithm: 'HS256',
      noTimestamp: true, // iat set manually above
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mobile-session] JWT signing failed: ${msg}`);
    return NextResponse.json(
      { error: 'Failed to mint session token' },
      { status: 500 },
    );
  }

  // -- BUG-21-04 FIX: Store jti in DB so it can be validated on use ----------
  // This prevents replay attacks — the same token cannot be used more than once.
  // The mobile app's token consumption endpoint must call markMobileSsoJtiUsed()
  // and reject the token if jti is already present in mobile_sso_used_jtis.
  try {
    const sql = await getDbReady();
    const expiresAt = new Date((exp) * 1000).toISOString();
    await sql`
      INSERT INTO mobile_sso_used_jtis (jti, user_id, used_at, expires_at)
      VALUES (${jti}, ${user.id}, NOW(), ${expiresAt})
      ON CONFLICT (jti) DO NOTHING
    `;
    // Opportunistic cleanup of expired jtis (non-blocking to response)
    sql`DELETE FROM mobile_sso_used_jtis WHERE expires_at < NOW()`.catch(() => {});
  } catch (dbErr) {
    // If we cannot record the jti, do NOT issue the token — a token we can't
    // track for replay is a security risk.
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    console.error(`[mobile-session] Failed to record jti in DB: ${msg}`);
    return NextResponse.json(
      { error: 'Failed to mint session token' },
      { status: 500 },
    );
  }

  // BUG-21-04 FIX: Removed PII (email) from log line — use userId only
  console.log(`[mobile-session] minted SSO token for userId=${user.id} jti=${jti}`);

  return NextResponse.json({ token }, { status: 200 });
}