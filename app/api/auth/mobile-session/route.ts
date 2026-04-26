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
//   jti:   uuid (one-time use)
//
// Signed with SOLARPRO_HANDOFF_SECRET (same secret as handoff tokens).
//
// The /mobile-login page calls this after confirming the session, then
// redirects to sitesurvey://login?token=<jwt> to hand control to the app.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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
  const exp = iat + 10 * 60; // 10 minutes

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

  console.log(`[mobile-session] minted SSO token for userId=${user.id} email=${user.email} jti=${jti}`);

  return NextResponse.json({ token }, { status: 200 });
}