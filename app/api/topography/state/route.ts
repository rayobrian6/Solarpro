// ============================================================================
// GET /api/topography/state?projectId=XXX
//
// Returns TopographyState JSON for the admin topography audit view.
//
// Auth: requires valid session (same JWT auth as all admin routes).
//       The project must belong to the authenticated user.
//
// Response 200: { success: true, data: TopographyState }
// Response 400: missing projectId
// Response 401: not authenticated
// Response 404: project not found or not owned by user
// Response 500: DB error
//
// READ-ONLY — this route never writes to any table.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';
import { getTopographyState } from '@/lib/topography/getTopographyState';

export async function GET(req: NextRequest) {
  // -- Auth ------------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  // -- Params ----------------------------------------------------------------
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId')?.trim() ?? '';

  if (!projectId) {
    return NextResponse.json(
      { success: false, error: 'projectId is required' },
      { status: 400 },
    );
  }
  if (!isValidUUID(projectId)) {
    return NextResponse.json({ success: false, error: 'Invalid projectId format.' }, { status: 400 });
  }

  // -- Verify project ownership (security: prevent cross-user data leaks) ----
  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[topography/state] DB connection failed:', msg);
    return NextResponse.json(
      { success: false, error: 'Database unavailable' },
      { status: 500 },
    );
  }

  try {
    const rows = await sql`
      SELECT id FROM projects
       WHERE id = ${projectId}
         AND user_id = ${user.id}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 },
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[topography/state] project ownership check failed:', msg);
    return NextResponse.json(
      { success: false, error: 'Database error' },
      { status: 500 },
    );
  }

  // -- Fetch topography state ------------------------------------------------
  // getTopographyState never throws — errors are captured inside the result.
  const state = await getTopographyState(projectId);

  return NextResponse.json({ success: true, data: state });
}