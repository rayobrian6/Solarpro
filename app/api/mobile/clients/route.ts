// ============================================================================
// GET /api/mobile/clients
//
// Returns the list of clients owned by the authenticated user.
// Called by the mobile field app BEFORE starting a survey so the
// field tech can select which client this survey belongs to.
//
// Auth: Bearer token (SOLARPRO_HANDOFF_SECRET signed JWT) OR session cookie.
//   - Accepts the same handoff JWT used by the survey submit flow.
//   - solarpro_user_id claim used to scope the DB query.
//
// Response 200:
//   { success: true, data: { clients: SurveyLookupClient[] } }
//
// Response 401: missing or invalid token
// Response 500: DB error
//
// This endpoint is the canonical mobile client list.
// It REPLACES /api/survey/lookup-data (disabled).
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import type { SurveyLookupClient } from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Resolve userId from either session cookie or handoff JWT Bearer token
// ---------------------------------------------------------------------------
function resolveUserId(req: NextRequest): string | null {
  // 1. Session cookie (SolarPro web user)
  const sessionUser = getUserFromRequest(req);
  if (sessionUser?.id && isValidUUID(sessionUser.id)) {
    return sessionUser.id;
  }

  // 2. Bearer token (mobile app with handoff JWT)
  const authHeader = req.headers.get('authorization') ?? '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const token = bearerMatch[1];
    const claims = verifyHandoffToken(token);
    if (claims?.solarpro_user_id && isValidUUID(claims.solarpro_user_id)) {
      return claims.solarpro_user_id;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 },
      );
    }

    const userId = resolveUserId(req);
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Provide a session cookie or Bearer token.' },
        { status: 401 },
      );
    }

    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id,
        name,
        COALESCE(NULLIF(TRIM(address), ''), '') AS address
      FROM clients
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `;

    const clients: SurveyLookupClient[] = rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      address: String(r.address ?? ''),
    }));

    return NextResponse.json(
      { clients },
      { status: 200 },
    );
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/mobile/clients]', err);
  }
}