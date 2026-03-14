export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';

type RouteContext = { params: Promise<{id: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM proposals WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });

    const proposal = rows[0];
    // Increment view count in data_json
    const dataJson = (proposal.data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...dataJson, viewCount: ((dataJson.viewCount as number) || 0) + 1 });
    await sql`
      UPDATE proposals SET data_json = ${updatedDataJson}::jsonb, updated_at = NOW()
      WHERE id = ${id}
    `;

    return NextResponse.json({ success: true, data: proposal });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/proposals/[id]]', err);
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    // Require authenticated session
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify proposal exists AND belongs to the authenticated user (via projects JOIN)
    const owned = await sql`
      SELECT p.id
      FROM proposals p
      JOIN projects proj ON proj.id = p.project_id
      WHERE p.id = ${id}
        AND proj.user_id = ${user.id}
      LIMIT 1
    `;
    if (owned.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found or access denied' },
        { status: 403 }
      );
    }

    const body = await req.json() as Record<string, unknown>;

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const currentData = (existing[0].data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/proposals/[id]]', err);
  }
}