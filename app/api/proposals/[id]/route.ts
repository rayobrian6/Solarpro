export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

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

    // -- View count: only increment for public/unauthenticated requests --------
    // Authenticated installers previewing their own proposals should NOT inflate
    // the count. We check for a valid auth session; if none exists (homeowner
    // following a share link), we increment.
    // Also accept an explicit ?track=1 query param from the public view page as
    // an additional confirmation that this is a real client view.
    const user = getUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const trackParam = searchParams.get('track');
    const shouldTrack = !user || trackParam === '1';

    if (shouldTrack) {
      const dataJson = (proposal.data_json as Record<string, unknown>) || {};
      const updatedDataJson = JSON.stringify({
        ...dataJson,
        viewCount: ((dataJson.viewCount as number) || 0) + 1,
      });
      await sql`
        UPDATE proposals SET data_json = ${updatedDataJson}::jsonb, updated_at = NOW()
        WHERE id = ${id}
      `;
    }

    // v48.5: read dbUtilityRate from data_json cache (set at POST creation) — no live DB call
    const dataJson2 = (proposal.data_json as Record<string, unknown>) || {};
    const dbUtilityRate = typeof dataJson2.dbUtilityRate === 'number' ? dataJson2.dbUtilityRate : null;

    return NextResponse.json({ success: true, data: { ...proposal, dbUtilityRate } });
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

// PATCH — partial update (status, title rename)
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(req);
    const { id } = await context.params;
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const sql = await getDbReady();
    const body = await req.json() as Record<string, unknown>;

    // Public token-based status update (homeowner view page) — no auth required.
    // Only 'viewed' and 'accepted' are allowed via this path; full edits still require ownership.
    const tokenParam = req.nextUrl.searchParams.get('token');
    const PUBLIC_STATUSES = new Set(['viewed', 'accepted']);
    if (!user && tokenParam && typeof body.status === 'string' && PUBLIC_STATUSES.has(body.status)) {
      const rows = await sql`
        SELECT id, share_token FROM proposals WHERE id = ${id} LIMIT 1
      `;
      if (!rows.length) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
      if (rows[0].share_token !== tokenParam) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 403 });
      }
      await sql`
        UPDATE proposals
        SET status = ${body.status},
            updated_at = NOW()
        WHERE id = ${id}
      `;
      return NextResponse.json({ success: true });
    }

    // Authenticated path — full update
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Ownership check — proposals.user_id
    const owned = await sql`SELECT id FROM proposals WHERE id = ${id} AND user_id = ${user.id} LIMIT 1`;
    if (owned.length === 0) return NextResponse.json({ success: false, error: 'Not found or access denied' }, { status: 403 });

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
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
    return handleRouteDbError('[PATCH /api/proposals/[id]]', err);
  }
}

// DELETE — hard delete, owner only
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const sql = await getDbReady();

    // Only delete proposals owned by this user
    const result = await sql`
      DELETE FROM proposals
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found or access denied' }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/proposals/[id]]', err);
  }
}