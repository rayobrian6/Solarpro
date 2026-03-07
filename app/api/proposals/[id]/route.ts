import { NextRequest, NextResponse } from 'next/server';
import { getDb, isValidUUID } from '@/lib/db-neon';

type RouteContext = { params: Promise<{id: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }
    const sql = getDb();
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
  } catch (err) {
    console.error('[GET /api/proposals/[id]]', err);
    return NextResponse.json({ success: false, error: 'Failed to fetch proposal' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }
    const body = await req.json();
    const sql = getDb();

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    if (existing.length === 0) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });

    const currentData = (existing[0].data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${body.title ?? null}, name),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[PUT /api/proposals/[id]]', err);
    return NextResponse.json({ success: false, error: 'Failed to update proposal' }, { status: 500 });
  }
}