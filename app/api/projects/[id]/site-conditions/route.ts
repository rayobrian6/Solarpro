import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

type RouteContext = { params: Promise<{id: string}> };


export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    const projectId = parseInt(id);

    // Verify user has access to this project
    const sql = await getDbReady();
    const projectCheck = await sql`
      SELECT user_id FROM projects WHERE id = ${projectId}
    `;

    if (projectCheck.length === 0 || projectCheck[0].user_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Get site conditions
    const siteResult = await sql`
      SELECT * FROM site_conditions WHERE project_id = ${projectId}
    `;

    if (siteResult.length === 0) {
      return NextResponse.json({ success: false, error: 'Site conditions not configured' }, { status: 404 });
    }

    const site = siteResult[0];

    // Get electrical config from logs
    const electricalLogs = await sql`
      SELECT field_name, auto_value FROM auto_config_log
      WHERE project_id = ${projectId} AND field_name IN (
        'ac_breaker_size', 'minimum_wire_gauge', 'egc_size', 'voltage_drop_percent',
        'conduit_fill', 'conduit_size', 'dc_ocpd', 'required_conductor_ampacity', 'conductor_type'
      )
    `;

    const electrical: Record<string, any> = {};
    for (const row of electricalLogs) {
      electrical[row.field_name] = row.auto_value;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...site,
        electrical,
      },
    });
  } catch (error: unknown) {
    return handleRouteDbError('app/api/projects/[id]/site-conditions/route.ts', error);
  }
}