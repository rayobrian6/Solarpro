// ============================================================================
// GET /api/mobile/clients/:clientId/projects
//
// Returns the list of projects under a specific client, scoped to the
// authenticated user. Called by the mobile field app after the tech selects
// a client, so they can optionally associate the survey with a specific project.
//
// Auth: Bearer token (service key from Render) OR session cookie.
//   - All auth validated by resolveMobileUser() in lib/mobile/auth.ts
//   - Render forwards X-Mobile-User-Email so SolarPro resolves the correct user
//   - Returns 401 with structured error if missing or invalid — NO exceptions
//
// Path param:
//   clientId: UUID of the client
//
// Response 200:
//   { projects: SurveyLookupProject[] }
//
// Response 400: invalid clientId
// Response 401: missing or invalid auth (structured error + server log)
// Response 404: client not found or not owned by user
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
import type { SurveyLookupProject } from '@/lib/survey/v2/types';

const ROUTE = '[GET /api/mobile/clients/:clientId/projects]';

export async function GET(
  req: NextRequest,
  { params }: { params: { clientId: string } },
) {
  try {
    // -- Rate limit ----------------------------------------------------------
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 },
      );
    }

    // -- Validate path param -------------------------------------------------
    const { clientId } = params;
    if (!clientId || !isValidUUID(clientId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid client ID.' },
        { status: 400 },
      );
    }

    // -- Auth (REQUIRED — no exceptions) ------------------------------------
    const auth = await resolveMobileUser(req, ROUTE);
    if (!auth) {
      return mobileAuthError(ROUTE, req);
    }

    // Guard: DB queries require a valid UUID user_id.
    if (!isValidUUID(auth.userId)) {
      console.error(`${ROUTE} — userId "${auth.userId}" is not a valid UUID; cannot query DB`);
      return NextResponse.json(
        { error: 'auth_failed', message: `User ID "${auth.userId}" is not a valid UUID.` },
        { status: 401 },
      );
    }

    // -- DB queries ----------------------------------------------------------
    const sql = await getDbReady();

    // Verify the client belongs to this user
    const clientRows = await sql`
      SELECT id, name FROM clients
      WHERE id      = ${clientId}
        AND user_id = ${auth.userId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!clientRows.length) {
      console.warn(`${ROUTE} 404 — clientId=${clientId} not found for userId=${auth.userId}`);
      return NextResponse.json(
        { success: false, error: 'Client not found.' },
        { status: 404 },
      );
    }

    // Fetch projects for this client
    const projectRows = await sql`
      SELECT
        p.id,
        p.name,
        p.client_id,
        COALESCE(NULLIF(TRIM(p.address), ''), '') AS address,
        c.name AS client_name
      FROM projects p
      JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
      WHERE p.client_id = ${clientId}
        AND p.user_id   = ${auth.userId}
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `;

    const projects: SurveyLookupProject[] = projectRows.map((r) => ({
      id:          String(r.id),
      name:        String(r.name),
      clientId:    r.client_id   ? String(r.client_id)   : null,
      clientName:  r.client_name ? String(r.client_name) : null,
      // snake_case aliases for mobile app compatibility
      client_id:   r.client_id   ? String(r.client_id)   : null,
      client_name: r.client_name ? String(r.client_name) : null,
      address:     String(r.address ?? ''),
    }));

    console.log(
      `${ROUTE} OK — ${projects.length} projects for clientId=${clientId}` +
      ` userId=${auth.userId} via ${auth.source}`
    );

    return NextResponse.json({ projects }, { status: 200 });
  } catch (err: unknown) {
    return handleRouteDbError(ROUTE, err);
  }
}