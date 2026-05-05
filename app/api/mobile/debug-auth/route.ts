// ============================================================================
// GET /api/mobile/debug-auth
//
// PHASE 4.15.3 — Temporary diagnostic endpoint.
//
// Returns environment variable status (NOT values) so you can confirm
// whether SOLARPRO_HANDOFF_SECRET is set in the Vercel environment
// without exposing any secrets.
//
// Also accepts an optional Bearer token and reports exactly why it
// passes or fails verification — useful for diagnosing mobile auth issues.
//
// ⚠️  REMOVE OR GATE BEHIND ADMIN AUTH before going to production.
// ============================================================================

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';

export async function GET(req: NextRequest) {
  const secret    = process.env.SOLARPRO_HANDOFF_SECRET ?? null;
  const secretOk  = !!secret && secret.length >= 32;

  // ── Service key vars ──────────────────────────────────────────────────────
  const serviceApiKey = process.env.MOBILE_SERVICE_API_KEY?.trim() ?? null;
  const serviceUserId = process.env.MOBILE_SERVICE_USER_ID?.trim() ?? null;
  const surveyUserId  = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() ?? null;

  // ── Env summary (no secret values exposed) ───────────────────────────────
  const env: Record<string, string> = {
    SOLARPRO_HANDOFF_SECRET: !secret
      ? 'NOT SET'
      : secret.length < 32
      ? `TOO SHORT (${secret.length} chars, need >=32)`
      : `SET (len=${secret.length})`,
    JWT_SECRET: process.env.JWT_SECRET
      ? `SET (len=${process.env.JWT_SECRET.length})`
      : 'NOT SET',
    DATABASE_URL: process.env.DATABASE_URL
      ? 'SET'
      : 'NOT SET',
    MOBILE_SERVICE_API_KEY: !serviceApiKey
      ? 'NOT SET'
      : `SET (len=${serviceApiKey.length}, first4=${serviceApiKey.slice(0,4)}, last4=${serviceApiKey.slice(-4)})`,
    MOBILE_SERVICE_USER_ID: !serviceUserId
      ? 'NOT SET'
      : `SET (val=${serviceUserId})`,
    SURVEY_INGEST_DEFAULT_USER_ID: !surveyUserId
      ? 'NOT SET'
      : `SET (val=${surveyUserId})`,
    NODE_ENV:   process.env.NODE_ENV   ?? '(unset)',
    VERCEL_ENV: process.env.VERCEL_ENV ?? '(unset)',
  };

  // ── Optional token probe ──────────────────────────────────────────────────
  const authHeader  = req.headers.get('authorization') ?? null;
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token       = bearerMatch?.[1] ?? null;

  let tokenProbe: Record<string, unknown> = { provided: false };

  if (token) {
    tokenProbe = { provided: true, len: token.length };

    // ── Service API key check (Path B) ────────────────────────────────────
    if (serviceApiKey) {
      const keyMatch = token === serviceApiKey;
      tokenProbe.serviceKeyCheck = {
        serviceKeySet:   true,
        serviceKeyLen:   serviceApiKey.length,
        tokenLen:        token.length,
        match:           keyMatch,
        // partial values for debugging (safe - short prefix/suffix only)
        tokenFirst8:     token.slice(0, 8),
        tokenLast8:      token.slice(-8),
        keyFirst8:       serviceApiKey.slice(0, 8),
        keyLast8:        serviceApiKey.slice(-8),
      };
      if (keyMatch) {
        tokenProbe.serviceKeyResult = 'MATCH — would authenticate as service_api_key';
        tokenProbe.serviceUserId    = serviceUserId ?? surveyUserId ?? 'NOT SET';
      } else {
        tokenProbe.serviceKeyResult = 'NO MATCH — token does not equal MOBILE_SERVICE_API_KEY';
      }
    } else {
      tokenProbe.serviceKeyCheck = { serviceKeySet: false };
      tokenProbe.serviceKeyResult = 'SKIPPED — MOBILE_SERVICE_API_KEY not set';
    }

    // ── JWT decode (no verification) to see algorithm ─────────────────────
    try {
      const headerB64 = token.split('.')[0];
      const header    = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
      tokenProbe.header = header;
    } catch {
      tokenProbe.headerParseError = 'Could not decode JWT header (token is not a JWT - expected for service key)';
    }

    // ── JWT decode payload ────────────────────────────────────────────────
    try {
      const payloadB64 = token.split('.')[1];
      const payload    = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
      tokenProbe.claims = {
        ...payload,
        _userIdClaim: payload.solarpro_user_id
          ? `solarpro_user_id = "${payload.solarpro_user_id}"`
          : payload.userId
          ? `userId = "${payload.userId}"`
          : payload.sub
          ? `sub = "${payload.sub}"`
          : 'NO USER ID CLAIM FOUND (solarpro_user_id / userId / sub all missing)',
        _expired: payload.exp
          ? payload.exp < Math.floor(Date.now() / 1000)
            ? `EXPIRED at ${new Date(payload.exp * 1000).toISOString()}`
            : `Valid until ${new Date(payload.exp * 1000).toISOString()}`
          : 'No exp claim',
      };
    } catch {
      tokenProbe.payloadParseError = 'Could not decode JWT payload (not a JWT - expected for service key)';
    }

    // ── JWT verification ──────────────────────────────────────────────────
    if (!secretOk) {
      tokenProbe.jwtVerification = 'SKIPPED — SOLARPRO_HANDOFF_SECRET not set or too short';
    } else {
      try {
        const decoded = verifyHandoffToken(token);
        if (decoded) {
          tokenProbe.jwtVerification = 'VALID — token verified successfully';
          tokenProbe.jwtUserId =
            decoded.solarpro_user_id ??
            (decoded as unknown as Record<string,unknown>).userId as string ??
            (decoded as unknown as Record<string,unknown>).sub    as string ??
            '(no user id claim)';
        } else {
          tokenProbe.jwtVerification =
            'INVALID — verifyHandoffToken returned null. ' +
            'Secret IS set. Token is either expired, signed with a different secret, ' +
            'or uses a non-HS256 algorithm.';
        }
      } catch (err) {
        tokenProbe.jwtVerification = `ERROR — ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return NextResponse.json({
    ok:         secretOk,
    timestamp:  new Date().toISOString(),
    env,
    tokenProbe,
    instructions: secretOk
      ? 'SOLARPRO_HANDOFF_SECRET is set. If tokens still fail, the mobile app secret does not match.'
      : 'ACTION REQUIRED: Set SOLARPRO_HANDOFF_SECRET in Vercel -> Project Settings -> Environment Variables. ' +
        'Use the same secret that is configured in the mobile app.',
  }, { status: 200 });
}