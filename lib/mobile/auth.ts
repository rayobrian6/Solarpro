// ============================================================================
// lib/mobile/auth.ts
//
// PHASE 4.15.2 / 4.15.3 / 4.15.5 — Shared mobile Bearer JWT authentication helper.
//
// ALL /api/mobile/* routes MUST call resolveMobileUser() for auth.
// No exceptions — unauthenticated access is never permitted.
//
// Auth flow (tried in order):
//   1. Session cookie      (SolarPro web user, same browser session)
//   2. Service API key     (Render backend proxy, MOBILE_SERVICE_API_KEY)
//      - When matched, reads X-Mobile-User-Email header forwarded by Render
//      - Looks up that email in SolarPro users table to get real userId
//      - Falls back to MOBILE_SERVICE_USER_ID only if email missing/unmatched
//   3. Bearer JWT          (handoff JWT, SOLARPRO_HANDOFF_SECRET-signed HS256)
//
// Service-to-service flow (Render -> SolarPro):
//   Mobile App logs in with SolarPro credentials -> Render JWT has {userId, email}
//   Render backend proxies /api/mobile/clients to SolarPro with:
//     Authorization: Bearer <SOLARPRO_API_KEY>   (service key)
//     X-Mobile-User-Email: <user email>          (forwarded from req.authUser.email)
//   SolarPro looks up the email in users table -> scopes query to that user
//
// Returns:
//   MobileAuthResult   on success (userId + source)
//   null               on failure — caller MUST return mobileAuthError()
//
// All failure paths are logged with [MOBILE_AUTH_FAIL] tag.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { getDbReady, isValidUUID } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MobileAuthResult {
  userId: string;
  source: 'session_cookie' | 'service_api_key' | 'bearer_jwt';
}

// ---------------------------------------------------------------------------
// resolveMobileUser
//
// Validates auth from session cookie OR Bearer JWT.
// Logs every failure path with structured [MOBILE_AUTH_FAIL] tags.
// Never throws. Returns null if auth is missing or invalid.
// ---------------------------------------------------------------------------
export async function resolveMobileUser(
  req: NextRequest,
  routeLabel: string,
): Promise<MobileAuthResult | null> {

  // -- Path A: Session cookie ------------------------------------------------
  try {
    const sessionUser = getUserFromRequest(req);
    if (sessionUser?.id && isValidUUID(sessionUser.id)) {
      return { userId: sessionUser.id, source: 'session_cookie' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MOBILE_AUTH_FAIL] ${routeLabel} session cookie parse error: ${msg}`);
  }

  // -- Path B: Service-to-service API key (Render backend -> SolarPro) ------
  //
  // Render proxies mobile requests to SolarPro using SOLARPRO_API_KEY as Bearer.
  // Render also forwards the logged-in user's email as X-Mobile-User-Email.
  // We match the service key, then resolve userId from the forwarded email.
  const authHeader  = req.headers.get('authorization') ?? null;
  // IMPORTANT: trim() both sides to eliminate any whitespace/newline edge cases
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  // Accept either MOBILE_SERVICE_API_KEY (canonical) or SOLARPRO_API_KEY (Render alias).
  // Both sides must hold the same secret — Render sends SOLARPRO_API_KEY as the Bearer,
  // SolarPro validates it against whichever of these env vars is set.
  const serviceApiKey =
    (process.env.MOBILE_SERVICE_API_KEY?.trim() || process.env.SOLARPRO_API_KEY?.trim()) ?? null;

  // Diagnostic log for service key path
  if (serviceApiKey) {
    const keySource = process.env.MOBILE_SERVICE_API_KEY?.trim()
      ? 'MOBILE_SERVICE_API_KEY'
      : 'SOLARPRO_API_KEY';
    console.log(
      `[MOBILE_AUTH] ${routeLabel} Path B check (source=${keySource}): ` +
      `serviceKey(len=${serviceApiKey.length} first8=${serviceApiKey.slice(0,8)}) ` +
      `bearer(len=${bearerToken?.length ?? 0} first8=${bearerToken?.slice(0,8) ?? 'n/a'}) ` +
      `match=${bearerToken === serviceApiKey}`
    );
  } else {
    console.warn(`[MOBILE_AUTH] ${routeLabel} Path B: neither MOBILE_SERVICE_API_KEY nor SOLARPRO_API_KEY set in env`);
  }

  if (serviceApiKey && bearerToken && bearerToken === serviceApiKey) {

    // -- Try to resolve real user from forwarded email ----------------------
    const forwardedEmail = req.headers.get('x-mobile-user-email')?.trim().toLowerCase() ?? null;

    if (forwardedEmail) {
      console.log(`[MOBILE_AUTH] ${routeLabel} service key matched — resolving userId from email: ${forwardedEmail}`);
      try {
        const sql = await getDbReady();
        const rows = await sql`
          SELECT id FROM users
           WHERE LOWER(email) = ${forwardedEmail}
           LIMIT 1
        `;

        if (rows.length > 0) {
          const userId = rows[0].id as string;
          console.log(`[MOBILE_AUTH] ${routeLabel} — authenticated via service_api_key + email userId=${userId}`);
          return { userId, source: 'service_api_key' };
        }

        console.warn(
          `[MOBILE_AUTH_FAIL] ${routeLabel} — service key matched but email "${forwardedEmail}" ` +
          `not found in SolarPro users table. Falling back to MOBILE_SERVICE_USER_ID.`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[MOBILE_AUTH_FAIL] ${routeLabel} — service key matched but DB email lookup failed: ${msg}. ` +
          `Falling back to MOBILE_SERVICE_USER_ID.`
        );
      }
    } else {
      console.warn(
        `[MOBILE_AUTH] ${routeLabel} — service key matched but X-Mobile-User-Email header is missing. ` +
        `Falling back to MOBILE_SERVICE_USER_ID. ` +
        `Ensure Render backend forwards req.authUser.email as X-Mobile-User-Email.`
      );
    }

    // -- Fallback: use configured service account user ID -------------------
    const serviceUserId =
      process.env.MOBILE_SERVICE_USER_ID?.trim() ||
      process.env.SURVEY_INGEST_DEFAULT_USER_ID?.trim() ||
      null;

    if (!serviceUserId || !isValidUUID(serviceUserId)) {
      console.error(
        `[MOBILE_AUTH_FAIL] ${routeLabel} — service API key matched but ` +
        `X-Mobile-User-Email not resolved AND ` +
        `MOBILE_SERVICE_USER_ID / SURVEY_INGEST_DEFAULT_USER_ID is not set or not a valid UUID. ` +
        `Set MOBILE_SERVICE_USER_ID in Vercel to a valid SolarPro user UUID.`
      );
      return null;
    }

    console.log(`[MOBILE_AUTH] ${routeLabel} — authenticated via service_api_key (fallback) userId=${serviceUserId}`);
    return { userId: serviceUserId, source: 'service_api_key' };
  }

  // -- Path C: Bearer JWT (handoff token) -----------------------------------

  // STEP 1 — Is the Authorization header present?
  if (!authHeader) {
    console.warn(`[MOBILE_AUTH_FAIL] ${routeLabel} — no Authorization header`);
    return null;
  }

  // STEP 2 — Does it match "Bearer <token>"?
  if (!bearerToken) {
    console.warn(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — Authorization header not Bearer format` +
      ` (received: "${authHeader.slice(0, 40)}...")`
    );
    return null;
  }

  const token = bearerToken;
  console.log(`[MOBILE_AUTH] ${routeLabel} — Bearer token received (len=${token.length}), attempting JWT verify`);

  // STEP 3 — Verify the JWT signature + expiry
  const handoffSecretPresent = !!process.env.SOLARPRO_HANDOFF_SECRET;
  const handoffSecretLen     = process.env.SOLARPRO_HANDOFF_SECRET?.length ?? 0;

  if (!handoffSecretPresent) {
    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — SOLARPRO_HANDOFF_SECRET is not set in environment. ` +
      `Add this env var in Vercel -> Settings -> Environment Variables.`
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
    let tokenAlg = 'unknown';
    try {
      const headerB64 = token.split('.')[0];
      const header = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
      tokenAlg = header.alg ?? 'unknown';
    } catch { /* ignore */ }

    console.error(
      `[MOBILE_AUTH_FAIL] ${routeLabel} — verifyHandoffToken returned null. ` +
      `Secret IS set (len=${handoffSecretLen}). Token alg=${tokenAlg}. ` +
      `Likely causes: (1) wrong secret, (2) token expired, (3) non-HS256 algorithm.`
    );
    return null;
  }

  console.log(`[MOBILE_AUTH_DEBUG] ${routeLabel} decoded claims:`, JSON.stringify(decoded));

  // STEP 4 — Extract userId from any supported claim name
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

  if (!isValidUUID(uid)) {
    console.warn(
      `[MOBILE_AUTH_WARN] ${routeLabel} — non-UUID userId received: "${uid}". ` +
      `Allowing through (compatibility mode).`
    );
  }

  console.log(`[MOBILE_AUTH] ${routeLabel} — authenticated userId=${uid} via bearer_jwt`);
  return { userId: uid, source: 'bearer_jwt' };
}

// ---------------------------------------------------------------------------
// mobileAuthError
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