// ============================================================================
// GET /api/survey/lookup-data?token=<handoff_jwt>
//
// v47.438 - Returns the client and project list for the on-device picker
// in standalone surveys.
//
// Called by the survey app at load time when standalone=true is detected in
// the JWT claims. The field worker uses this data to pick which client or
// project their survey belongs to before advancing past Step 1.
//
// Auth: Handoff JWT (verifyHandoffToken). No session cookie required.
//   - Token must be valid and not expired.
//   - solarpro_user_id claim is used to scope the DB query.
//   - Only works for standalone JWTs (project_id === "__standalone__").
//     Regular project-specific tokens return 400.
//
// Response shape:
//   {
//     success: true,
//     data: {
//       clients: [{ id, name, address }],
//       projects: [{ id, name, clientId, clientName, address }]
//     }
//   }
//
// Lightweight query: only fetches the fields needed for the picker (id, name,
// address, client_id). Does NOT load productions/proposals/layouts.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { verifyHandoffToken } from '@/lib/survey/handoff/tokenMinter';
import { STANDALONE_PROJECT_ID } from '@/lib/survey/v2/types';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import type { SurveyLookupClient, SurveyLookupProject } from '@/lib/survey/v2/types';

export async function GET(req: NextRequest) {
  try {
    // -- Extract token from query string ------------------------------------
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'token query parameter is required' },
        { status: 400 },
      );
    }

    // -- Verify the handoff JWT ---------------------------------------------
    const claims = verifyHandoffToken(token);
    if (!claims) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired survey token' },
        { status: 401 },
      );
    }

    // -- Only standalone surveys need lookup data ---------------------------
    // Regular project-specific tokens already have project_id in the JWT.
    if (claims.project_id !== STANDALONE_PROJECT_ID && !claims.standalone) {
      return NextResponse.json(
        { success: false, error: 'This endpoint is only for standalone surveys' },
        { status: 400 },
      );
    }

    // -- Validate user identity from token ----------------------------------
    const userId = claims.solarpro_user_id;
    if (!userId || !isValidUUID(userId)) {
      return NextResponse.json(
        { success: false, error: 'Token missing valid user identity' },
        { status: 401 },
      );
    }

    const sql = await getDbReady();

    // -- Fetch clients (lightweight: id, name, address only) ---------------
    const clientRows = await sql`
      SELECT
        id,
        name,
        COALESCE(NULLIF(TRIM(address), ''), '') AS address
      FROM clients
      WHERE user_id = ${userId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `;

    const clients: SurveyLookupClient[] = clientRows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      address: String(r.address ?? ''),
    }));

    // Build a client name map for denormalization into projects
    const clientNameMap = new Map<string, string>();
    for (const c of clients) {
      clientNameMap.set(c.id, c.name);
    }

    // -- Fetch projects (lightweight: id, name, client_id, address only) ---
    // Join clients to get client name for display in the picker.
    const projectRows = await sql`
      SELECT
        p.id,
        p.name,
        p.client_id,
        COALESCE(NULLIF(TRIM(p.address), ''), '') AS address,
        c.name AS client_name
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id AND c.user_id = p.user_id
      WHERE p.user_id = ${userId}
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
      {
        success: true,
        data: { clients, projects },
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/survey/lookup-data]', err);
  }
}