// ============================================================================
// GET /api/mobile/clients
//
// Returns the list of clients owned by the authenticated user.
// Called by the mobile field app BEFORE starting a survey so the
// field tech can select which client this survey belongs to.
//
// Auth: Bearer token (SOLARPRO_HANDOFF_SECRET signed JWT) OR session cookie.
//   - All auth validated by resolveMobileUser() in lib/mobile/auth.ts
//   - Returns 401 with structured error if missing or invalid — NO exceptions
//
// Response 200:
//   { clients: SurveyLookupClient[] }
//
// Response 401: missing or invalid token (structured error + server log)
// Response 429: rate limited
// Response 500: DB error
// ============================================================================

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { resolveMobileUser, mobileAuthError } from '@/lib/mobile/auth';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import type { SurveyLookupClient } from '@/lib/survey/v2/types';

const ROUTE = '[GET /api/mobile/clients]';

export async function GET(req: NextRequest) {
  try {
    // -- Rate limit ----------------------------------------------------------
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 },
      );
    }

    // -- Auth (REQUIRED — no exceptions) ------------------------------------
    // DIAGNOSTIC: log service key env state before calling resolveMobileUser
    const _svcKeyTrimmed = process.env.MOBILE_SERVICE_API_KEY?.trim() ?? null;
    const _svcKeySet     = !!_svcKeyTrimmed;
    const _svcKeyLen     = _svcKeyTrimmed?.length ?? 0;
    const _svcUserIdSet  = !!process.env.MOBILE_SERVICE_USER_ID;
    const _authHdr       = req.headers.get('authorization') ?? '(none)';
    const _bearerTok     = _authHdr.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
    const _bearerLen     = _bearerTok?.length ?? 0;
    const _keysMatch     = _svcKeyTrimmed && _bearerTok ? (_bearerTok === _svcKeyTrimmed) : false;
    console.log(
      `${ROUTE} [DIAG] svcKeySet=${_svcKeySet} svcKeyLen=${_svcKeyLen} ` +
      `svcUserIdSet=${_svcUserIdSet} bearerLen=${_bearerLen} ` +
      `bearerFirst8=${_bearerTok?.slice(0,8) ?? 'n/a'} ` +
      `keyFirst8=${_svcKeyTrimmed?.slice(0,8) ?? 'n/a'} ` +
      `directMatch=${_keysMatch}`
    );

    const auth = resolveMobileUser(req, ROUTE);
    if (!auth) {
      return mobileAuthError(ROUTE, req);
    }

    // Guard: DB queries require a valid UUID user_id.
    // resolveMobileUser warns but allows non-UUID ids through (compat layer).
    // If we can't cast to UUID, return a clear 401 instead of a DB cast error.
    if (!isValidUUID(auth.userId)) {
      console.error(`${ROUTE} — userId "${auth.userId}" is not a valid UUID; cannot query DB`);
      return NextResponse.json(
        { error: 'auth_failed', message: `User ID "${auth.userId}" is not a valid UUID. Token must include a UUID user identity claim.` },
        { status: 401 },
      );
    }

    // -- DB query ------------------------------------------------------------
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id,
        name,
        COALESCE(NULLIF(TRIM(address), ''), '') AS address
      FROM clients
      WHERE user_id = ${auth.userId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `;

    const clients: SurveyLookupClient[] = rows.map((r) => ({
      id:      String(r.id),
      name:    String(r.name),
      address: String(r.address ?? ''),
    }));

    console.log(`${ROUTE} OK — ${clients.length} clients for userId=${auth.userId} via ${auth.source}`);

    return NextResponse.json({ clients }, { status: 200 });
  } catch (err: unknown) {
    return handleRouteDbError(ROUTE, err);
  }
}