export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/clients/[id]/proposals
 * Returns all proposals associated with projects that belong to this client.
 * Joins proposals → projects → clients to verify ownership.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid client ID' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = await getDbReady();

    // Verify client ownership
    const clientRows = await sql`
      SELECT id FROM clients WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL LIMIT 1
    `;
    if (!clientRows[0]) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }

    // Get proposals via their linked project's clientId
    const rows = await sql`
      SELECT
        pr.id,
        pr.project_id,
        p.name   AS project_name,
        pr.title,
        pr.status,
        pr.prepared_date,
        pr.valid_until,
        pr.sent_at,
        pr.sent_to_email,
        (pr.data_json -> 'costEstimate' ->> 'netCost')::numeric  AS net_cost
      FROM proposals pr
      JOIN projects p ON p.id = pr.project_id
      WHERE p.client_id   = ${id}
        AND p.user_id     = ${user.id}
        AND pr.deleted_at IS NULL
      ORDER BY pr.prepared_date DESC NULLS LAST, pr.created_at DESC
      LIMIT 200
    `;

    return NextResponse.json({ success: true, data: rows });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/clients/[id]/proposals]', err);
  }
}
