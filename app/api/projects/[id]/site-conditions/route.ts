import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

type RouteContext = { params: Promise<{id: string}> };

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// UUID format validation
function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }

    // BUG-21-06 FIX: Projects use UUID strings, not integers.
    // parseInt(uuid) always returns NaN, making ownership checks unreliable.
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID' }, { status: 400 });
    }

    const projectId = id; // use the UUID string directly

    // Verify user has access to this project
    const sql = await getDbReady();
    const projectCheck = await sql`
      SELECT id FROM projects
      WHERE id = ${projectId}
        AND user_id = ${user.id}
        AND deleted_at IS NULL
    `;

    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Get site conditions — select only known columns to prevent data overfetch
    const siteResult = await sql`
      SELECT id, project_id, created_at, updated_at,
             roof_type, roof_material, roof_age, roof_pitch,
             attic_access, electrical_panel_location, main_breaker_amps,
             notes, custom_fields
      FROM site_conditions
      WHERE project_id = ${projectId}
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

    const electrical: Record<string, unknown> = {};
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