// ============================================================================
// GET /api/mobile/debug-auth
//
// PHASE 4.15.3 / 4.15.5 — Temporary diagnostic endpoint.
//
// Returns environment variable status (NOT values) so you can confirm
// whether required env vars are set in the Vercel environment.
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
import { getDbReady } from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  const secret    = process.env.SOLARPRO_HANDOFF_SECRET ?? null;
  const secretOk  = !!secret && secret.length >= 32;

  // -- Service key vars ------------------------------------------------------
  const serviceApiKey = process.env.MOBILE_SERVICE_API_KEY?.trim() ?? null;
  const serviceUserId = process.env.MOBILE_SERVICE_USER_ID?.trim() ?? null;
  const surveyUserId  = process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() ?? null;

  // -- Env summary (no secret values exposed) --------------------------------
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

  // -- Request headers of interest -------------------------------------------
  const authHeader        = req.headers.get('authorization') ?? null;
  const forwardedEmail    = req.headers.get('x-mobile-user-email') ?? null;
  const bearerMatch       = authHeader?.match(/^Bearer\s+(.+)$/i);
  const token             = bearerMatch?.[1]?.trim() ?? null;

  const requestHeaders: Record<string, string> = {
    'x-mobile-user-email': forwardedEmail ?? '(not present)',
    'authorization':       authHeader ? `Bearer ...(len=${token?.length ?? 0})` : '(not present)',
  };

  // -- Email lookup test (if X-Mobile-User-Email is present) ----------------
  let emailLookup: Record<string, unknown> = { tested: false };
  if (forwardedEmail) {
    emailLookup = { tested: true, email: forwardedEmail };
    try {
      const sql = await getDbReady();
      const rows = await sql`
        SELECT id, email, name FROM users
         WHERE LOWER(email) = ${forwardedEmail.toLowerCase()}
         LIMIT 1
      `;
      if (rows.length > 0) {
        emailLookup.found      = true;
        emailLookup.userId     = rows[0].id;
        emailLookup.userName   = rows[0].name;
        emailLookup.result     = 'MATCH — this user would be authenticated';
      } else {
        emailLookup.found  = false;
        emailLookup.result = 'NO MATCH — email not found in SolarPro users table';
      }
    } catch (err) {
      emailLookup.error = err instanceof Error ? err.message : String(err);
      emailLookup.result = 'ERROR — DB lookup failed';
    }
  }

  // -- Optional token probe --------------------------------------------------
  let tokenProbe: Record<string, unknown> = { provided: false };

  if (token) {
    tokenProbe = { provided: true, len: token.length };

    // Service API key check (Path B)
    if (serviceApiKey) {
      const keyMatch = token === serviceApiKey;
      tokenProbe.serviceKeyCheck = {
        serviceKeySet:   true,
        serviceKeyLen:   serviceApiKey.length,
        tokenLen:        token.length,
        match:           keyMatch,
        tokenFirst8:     token.slice(0, 8),
        tokenLast8:      token.slice(-8),
        keyFirst8:       serviceApiKey.slice(0, 8),
        keyLast8:        serviceApiKey.slice(-8),
      };
      tokenProbe.serviceKeyResult = keyMatch
        ? 'MATCH — would authenticate as service_api_key'
        : 'NO MATCH — token does not equal MOBILE_SERVICE_API_KEY';
      if (keyMatch) {
        tokenProbe.serviceUserId = serviceUserId ?? surveyUserId ?? 'NOT SET (fallback)';
        tokenProbe.note = forwardedEmail
          ? 'X-Mobile-User-Email present — real userId would be resolved from email lookup above'
          : 'X-Mobile-User-Email NOT present — would fall back to MOBILE_SERVICE_USER_ID';
      }
    } else {
      tokenProbe.serviceKeyCheck  = { serviceKeySet: false };
      tokenProbe.serviceKeyResult = 'SKIPPED — MOBILE_SERVICE_API_KEY not set';
    }

    // JWT decode (no verification)
    try {
      const headerB64 = token.split('.')[0];
      const header    = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
      tokenProbe.header = header;
    } catch {
      tokenProbe.headerParseError = 'Could not decode JWT header (expected for service key tokens)';
    }

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
          : 'NO USER ID CLAIM FOUND',
        _expired: payload.exp
          ? payload.exp < Math.floor(Date.now() / 1000)
            ? `EXPIRED at ${new Date(payload.exp * 1000).toISOString()}`
            : `Valid until ${new Date(payload.exp * 1000).toISOString()}`
          : 'No exp claim',
      };
    } catch {
      tokenProbe.payloadParseError = 'Could not decode JWT payload (expected for service key tokens)';
    }

    // JWT verification
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
    ok:             secretOk,
    timestamp:      new Date().toISOString(),
    env,
    requestHeaders,
    emailLookup,
    tokenProbe,
    howItWorks: [
      '1. Mobile user logs in to site survey app with SolarPro credentials (email + password)',
      '2. Render issues JWT with {userId, email} from its own auth system',
      '3. Mobile app calls GET /api/mobile/clients with Bearer <render_jwt>',
      '4. Render requireAuth() verifies the JWT, populates req.authUser.email',
      '5. Render mobileClients.ts proxies to SolarPro with:',
      '     Authorization: Bearer <SOLARPRO_API_KEY>  (service key)',
      '     X-Mobile-User-Email: <user email>          (forwarded from req.authUser.email)',
      '6. SolarPro matches service key, looks up email in users table -> scoped userId',
      '7. SolarPro returns only clients/projects for that userId',
    ],
  }, { status: 200 });
}