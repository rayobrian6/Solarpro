// ============================================================================
// GET /api/mobile/clients/:clientId/projects
//
// Returns the list of projects under a specific client, scoped to the
// authenticated user. Called by the mobile field app after the tech selects
// a client, so they can optionally associate the survey with a specific project.
//
// Auth: Bearer token (handoff JWT) OR session cookie (same as /api/mobile/clients).
//
// Path param:
//   clientId: UUID of the client
//
// Response 200:
//   { success: true, data: { projects: SurveyLookupProject[] } }
//
// Response 400: invalid clientId
// Response 401: missing or invalid auth
// Response 404: client not found or not owned by user
// Response 500: DB error
//
// This endpoint is the canonical mobile project list for a given client.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import type { SurveyLookupProject } from '@/lib/survey/v2/types';

// ---------------------------------------------------------------------------
// Resolve userId from either session cookie or handoff JWT Bearer token
// ---------------------------------------------------------------------------
function resolveUserId(req: NextRequest): string | null {
  const sessionUser = getUserFromRequest(req);
  if (sessionUser?.id && isValidUUID(sessionUser.id)) {
    return sessionUser.id;
  }

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

export async function GET(
  req: NextRequest,
  { params }: { params: { clientId: string } },
) {
  try {
    const { clientId } = params;

    if (!clientId || !isValidUUID(clientId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid client ID.' },
        { status: 400 },
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

    // Verify the client belongs to this user
    const clientRows = await sql`
      SELECT id, name FROM clients
      WHERE id = ${clientId}
        AND user_id = ${userId}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (!clientRows.length) {
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
        AND p.user_id = ${userId}
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC
    `;

    const projects: SurveyLookupProject[] = projectRows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      clientId: r.client_id ? String(r.client_id) : null,
      clientName: r.client_name ? String(r.client_name) : null,
      address: String(r.address ?? ''),
    }));

    return NextResponse.json(
      { success: true, data: { projects } },
      { status: 200 },
    );
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/mobile/clients/:clientId/projects]', err);
  }
}