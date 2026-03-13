// ============================================================
// GET /api/engineering/latest-run?projectId=xxx
// Returns the most recent engineering_run for a project.
// Used when navigating to /engineering?projectId= to restore
// the last known engineering configuration for that project.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify project ownership
    const projectCheck = await sql`
      SELECT id, user_id FROM projects
      WHERE id = ${projectId}
        AND deleted_at IS NULL
    `;

    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Verify ownership
    if (projectCheck[0].user_id !== user.id) {
      const roleCheck = await sql`SELECT role FROM users WHERE id = ${user.id}`;
      const isSuperAdmin = roleCheck[0]?.role === 'super_admin';
      if (!isSuperAdmin) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    // Check if engineering_runs table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'engineering_runs'
      ) AS exists
    `;

    if (!tableCheck[0]?.exists) {
      return NextResponse.json({
        success: true,
        hasRun: false,
        run: null,
        message: 'No engineering runs found (table does not exist yet)',
      });
    }

    // Get the most recent run for this project
    const runRows = await sql`
      SELECT
        id,
        project_id,
        user_id,
        client_id,
        system_size_kw,
        panel_count,
        annual_production_kwh,
        panel_id,
        panel_model,
        panel_wattage,
        inverter_id,
        inverter_model,
        inverter_type,
        inverter_qty,
        mounting_id,
        mount_type,
        main_panel_rating,
        backfeed_breaker,
        interconnection_method,
        wire_gauge,
        conduit_type,
        rapid_shutdown,
        ac_disconnect,
        dc_disconnect,
        utility_name,
        utility_id,
        state_code,
        address,
        ahj,
        roof_pitch,
        system_type,
        string_config,
        config_snapshot,
        calc_outputs,
        generated_at,
        created_at
      FROM engineering_runs
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (runRows.length === 0) {
      return NextResponse.json({
        success: true,
        hasRun: false,
        run: null,
        message: 'No engineering runs found for this project',
      });
    }

    const run = runRows[0];

    // Get files associated with this run
    const runFiles = await sql`
      SELECT id, file_name, file_type, mime_type, upload_date
      FROM project_files
      WHERE engineering_run_id = ${run.id}
        AND project_id = ${projectId}
      ORDER BY upload_date DESC
    `;

    return NextResponse.json({
      success: true,
      hasRun: true,
      run: {
        id:                    run.id,
        projectId:             run.project_id,
        systemSizeKw:          parseFloat(run.system_size_kw) || 0,
        panelCount:            run.panel_count || 0,
        annualProductionKwh:   run.annual_production_kwh || null,
        panelId:               run.panel_id || null,
        panelModel:            run.panel_model || null,
        panelWattage:          run.panel_wattage || null,
        inverterId:            run.inverter_id || null,
        inverterModel:         run.inverter_model || null,
        inverterType:          run.inverter_type || 'string',
        inverterQty:           run.inverter_qty || 1,
        mountingId:            run.mounting_id || null,
        mountType:             run.mount_type || null,
        mainPanelRating:       run.main_panel_rating || null,
        backfeedBreaker:       run.backfeed_breaker || null,
        interconnectionMethod: run.interconnection_method || null,
        wireGauge:             run.wire_gauge || null,
        conduitType:           run.conduit_type || null,
        rapidShutdown:         run.rapid_shutdown ?? true,
        acDisconnect:          run.ac_disconnect ?? true,
        dcDisconnect:          run.dc_disconnect ?? true,
        utilityName:           run.utility_name || null,
        utilityId:             run.utility_id || null,
        stateCode:             run.state_code || null,
        address:               run.address || null,
        ahj:                   run.ahj || null,
        roofPitch:             run.roof_pitch || null,
        systemType:            run.system_type || 'grid-tied',
        stringConfig:          run.string_config || [],
        configSnapshot:        run.config_snapshot || {},
        calcOutputs:           run.calc_outputs || {},
        generatedAt:           run.generated_at,
      },
      files: runFiles.map((f: any) => ({
        id:         f.id,
        fileName:   f.file_name,
        fileType:   f.file_type,
        mimeType:   f.mime_type,
        uploadDate: f.upload_date,
      })),
    });

  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/engineering/latest-run]', err);
  }
}