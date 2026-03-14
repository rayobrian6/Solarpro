/**
 * GET /api/debug/layout?projectId=xxx
 * 
 * Debug endpoint — proves layout pipeline end-to-end.
 * Returns raw DB state of the layout for a given project.
 * Protected: requires valid session.
 * 
 * REMOVE THIS ROUTE once pipeline is verified.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const projectId = req.nextUrl.searchParams.get('projectId');

  try {
    const sql = await getDbReady();

    // 1. Total layout count for this user
    const totalLayouts = await sql`
      SELECT COUNT(*) as cnt FROM layouts WHERE user_id = ${user.id}
    `;

    // 2. All layouts for this user (summary)
    const allLayouts = await sql`
      SELECT 
        l.id,
        l.project_id,
        p.name as project_name,
        jsonb_array_length(COALESCE(l.panels, '[]'::jsonb)) as panel_count,
        CASE 
          WHEN l.roof_planes IS NULL THEN 'NULL'
          WHEN l.roof_planes::text = 'null' THEN 'null_json'
          ELSE jsonb_array_length(l.roof_planes)::text || ' planes'
        END as roof_planes_status,
        l.total_panels,
        l.system_size_kw,
        l.updated_at
      FROM layouts l
      LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.user_id = ${user.id}
      ORDER BY l.updated_at DESC
      LIMIT 20
    `;

    // 3. Specific project layout if projectId provided
    let specificLayout = null;
    let specificProject = null;
    if (projectId) {
      const layoutRows = await sql`
        SELECT * FROM layouts 
        WHERE project_id = ${projectId} AND user_id = ${user.id}
        ORDER BY updated_at DESC LIMIT 1
      `;
      
      const projectRows = await sql`
        SELECT id, name, address, system_type, status
        FROM projects
        WHERE id = ${projectId} AND user_id = ${user.id}
        LIMIT 1
      `;

      if (layoutRows.length > 0) {
        const r = layoutRows[0];
        const panels = r.panels as any[] ?? [];
        const roofPlanes = r.roof_planes as any[] ?? [];
        specificLayout = {
          id: r.id,
          projectId: r.project_id,
          panelCount: panels.length,
          totalPanels: r.total_panels,
          systemSizeKw: r.system_size_kw,
          roofPlaneCount: Array.isArray(roofPlanes) ? roofPlanes.length : 0,
          hasRoofPlanes: Array.isArray(roofPlanes) && roofPlanes.length > 0,
          // First 3 panels for verification
          samplePanels: panels.slice(0, 3).map((p: any) => ({
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            tilt: p.tilt,
            azimuth: p.azimuth,
          })),
          // First roof plane for verification
          sampleRoofPlane: Array.isArray(roofPlanes) && roofPlanes.length > 0 ? {
            id: roofPlanes[0].id,
            pitch: roofPlanes[0].pitch,
            azimuth: roofPlanes[0].azimuth,
            vertexCount: roofPlanes[0].vertices?.length ?? 0,
          } : null,
          updatedAt: r.updated_at,
        };
      }

      if (projectRows.length > 0) {
        specificProject = projectRows[0];
      }
    }

    // 4. DB schema check
    const schemaCols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'layouts' ORDER BY ordinal_position
    `;
    const colNames = schemaCols.map((c: any) => c.column_name);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      userId: user.id,
      db: {
        schema: {
          hasLayouts: true,
          columns: colNames,
          hasPanels: colNames.includes('panels'),
          hasRoofPlanes: colNames.includes('roof_planes'),
          hasMapCenter: colNames.includes('map_center'),
        },
        totalLayouts: Number(totalLayouts[0].cnt),
        allLayouts,
      },
      specificProject,
      specificLayout,
    });

  } catch (err: any) {
    console.error('[debug/layout] DB error:', err.message);
    return NextResponse.json({
      success: false,
      error: err.message,
    }, { status: 500 });
  }
}