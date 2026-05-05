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
// Resolve userId from either session cookie or handoff JWT Bearer token.
// PHASE 4.15.1: returns { userId, debugInfo } so caller can log exactly
// what happened at each step.
// ---------------------------------------------------------------------------
interface ResolveResult {
  userId: string | null;
  authHeader: string | null;
  rawToken: string | null;
  source: 'session_cookie' | 'bearer_jwt' | 'none';
  jwtError: string | null;
  decoded: Record<string, unknown> | null;
}

function resolveUserIdDebug(req: NextRequest): ResolveResult {
  const result: ResolveResult = {
    userId:     null,
    authHeader: null,
    rawToken:   null,
    source:     'none',
    jwtError:   null,
    decoded:    null,
  };

  // ── STEP 1: Log incoming auth header ──────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? null;
  result.authHeader = authHeader;
  console.log('[GET /api/mobile/clients] AUTH HEADER:', authHeader ?? '(none)');

  // ── Path A: Session cookie (SolarPro web user) ───────────────────────────
  const sessionUser = getUserFromRequest(req);
  if (sessionUser?.id && isValidUUID(sessionUser.id)) {
    result.userId = sessionUser.id;
    result.source = 'session_cookie';
    console.log('[GET /api/mobile/clients] AUTH SOURCE: session_cookie — userId:', sessionUser.id);
    return result;
  }

  // ── Path B: Bearer token (mobile app handoff JWT) ────────────────────────
  // ── STEP 2: Extract and log token ─────────────────────────────────────────
  if (authHeader) {
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch?.[1] ?? null;
    result.rawToken = token;
    console.log('[GET /api/mobile/clients] TOKEN:', token ? `${token.slice(0, 40)}...` : '(no bearer token found)');

    if (token) {
      // ── STEP 3: Verify JWT and log result ───────────────────────────────
      try {
        const decoded = verifyHandoffToken(token);
        console.log('[GET /api/mobile/clients] DECODED:', JSON.stringify(decoded));
        result.decoded = decoded as unknown as Record<string, unknown> | null;

        if (decoded?.solarpro_user_id && isValidUUID(decoded.solarpro_user_id as string)) {
          result.userId = decoded.solarpro_user_id as string;
          result.source = 'bearer_jwt';
          console.log('[GET /api/mobile/clients] AUTH SOURCE: bearer_jwt — userId:', result.userId);
        } else {
          const reason = !decoded
            ? 'verifyHandoffToken returned null (invalid/expired token or wrong secret)'
            : !decoded.solarpro_user_id
            ? 'JWT decoded OK but solarpro_user_id claim is missing'
            : `solarpro_user_id "${decoded.solarpro_user_id}" is not a valid UUID`;
          result.jwtError = reason;
          console.error('[GET /api/mobile/clients] JWT ERROR:', reason);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.jwtError = msg;
        console.error('[GET /api/mobile/clients] JWT ERROR:', msg);
      }
    } else {
      const reason = 'Authorization header present but does not match "Bearer <token>" pattern';
      result.jwtError = reason;
      console.error('[GET /api/mobile/clients] JWT ERROR:', reason);
    }
  } else {
    console.log('[GET /api/mobile/clients] No Authorization header — no Bearer token to verify');
  }

  return result;
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

    // ── Resolve + debug-log auth ─────────────────────────────────────────────
    const authResult = resolveUserIdDebug(req);

    // ── STEP 4: Return structured 401 if auth failed ─────────────────────────
    if (!authResult.userId) {
      console.error('[GET /api/mobile/clients] AUTH FAILED — returning 401', {
        authHeader:  authResult.authHeader ?? '(none)',
        tokenPresent: !!authResult.rawToken,
        jwtError:    authResult.jwtError ?? 'no token or cookie',
      });

      return NextResponse.json(
        {
          error:   'auth_failed',
          message: authResult.jwtError ?? 'Authentication required. Provide a session cookie or Bearer token.',
          debug: {
            authHeaderPresent: !!authResult.authHeader,
            tokenPresent:      !!authResult.rawToken,
            source:            authResult.source,
            reason:            authResult.jwtError ?? 'No valid session cookie and no Bearer token found',
          },
        },
        { status: 401 },
      );
    }

    // ── Fetch clients ─────────────────────────────────────────────────────────
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        id,
        name,
        COALESCE(NULLIF(TRIM(address), ''), '') AS address
      FROM clients
      WHERE user_id = ${authResult.userId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `;

    const clients: SurveyLookupClient[] = rows.map((r) => ({
      id:      String(r.id),
      name:    String(r.name),
      address: String(r.address ?? ''),
    }));

    console.log(`[GET /api/mobile/clients] OK — returned ${clients.length} clients for userId=${authResult.userId}`);

    return NextResponse.json(
      { clients },
      { status: 200 },
    );
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/mobile/clients]', err);
  }
}