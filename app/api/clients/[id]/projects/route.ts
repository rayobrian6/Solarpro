export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/clients/[id]/projects
 * Returns all projects for this client (lightweight — no full data_json expansion).
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

    const rows = await sql`
      SELECT
        p.id,
        p.name,
        p.status,
        p.homeowner_stage,
        (p.data_json -> 'layout' ->> 'systemSizeKw')::numeric AS system_size_kw,
        p.created_at,
        p.updated_at
      FROM projects p
      WHERE p.client_id  = ${id}
        AND p.user_id    = ${user.id}
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
      LIMIT 200
    `;

    return NextResponse.json({ success: true, data: rows });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/clients/[id]/projects]', err);
  }
}
