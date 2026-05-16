// ============================================================================
// GET /api/projects/[id]/physical-data
//
// Returns the project_physical_data row for a project, if one exists.
//
// Auth: requires valid session (same JWT auth as all project routes).
//       The project must belong to the authenticated user.
//
// Response 200 (data exists):
//   { success: true, data: ProjectPhysicalData }
//
// Response 200 (no data yet):
//   { success: true, data: null }
//
// Response 401: not authenticated
// Response 404: project not found or not owned by user
// Response 500: database error
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { getProjectPhysicalData } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // -- Auth ------------------------------------------------------------------
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Project ID required' }, { status: 400 });
  }

  // -- DB --------------------------------------------------------------------
  let sql;
  try {
    sql = await getDbReady();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[physical-data] DB connection failed: ${msg}`);
    return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 500 });
  }

  // -- Verify project ownership ---------------------------------------------
  try {
    const projectCheck = await sql`
      SELECT id FROM projects
       WHERE id = ${projectId}
         AND user_id = ${user.id}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[physical-data] project check failed: ${msg}`);
    return NextResponse.json({ success: false, error: 'Database error' }, { status: 500 });
  }

  // -- Fetch physical data ---------------------------------------------------
  try {
    const data = await getProjectPhysicalData(projectId);
    // data is null when no survey has been completed yet — this is normal,
    // not an error. The UI renders a "no data" CTA in that case.
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[physical-data] getProjectPhysicalData failed: ${msg}`);
    return NextResponse.json({ success: false, error: 'Failed to load physical data' }, { status: 500 });
  }
}