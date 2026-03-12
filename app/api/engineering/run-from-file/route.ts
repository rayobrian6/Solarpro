// ============================================================
// GET /api/engineering/run-from-file?fileId=xxx
// Returns the engineering_run config associated with a
// project_files record — used for reverse hydration.
// When a user opens a generated engineering file, this endpoint
// returns the full config_snapshot so the engineering page can
// restore the exact system configuration used to generate it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Look up the file and verify ownership
    const fileRows = await sql`
      SELECT
        pf.id,
        pf.file_name,
        pf.file_type,
        pf.project_id,
        pf.client_id,
        pf.engineering_run_id,
        pf.upload_date,
        p.user_id AS project_user_id
      FROM project_files pf
      JOIN projects p ON p.id = pf.project_id
      WHERE pf.id = ${fileId}
        AND p.deleted_at IS NULL
    `;

    if (fileRows.length === 0) {
      return NextResponse.json({ success: false, error: 'File not found' }, { status: 404 });
    }

    const file = fileRows[0];

    // Verify ownership (user must own the project, or be super_admin)
    if (file.project_user_id !== user.id) {
      // Check if user is super_admin via DB
      const roleCheck = await sql`SELECT role FROM users WHERE id = ${user.id}`;
      const isSuperAdmin = roleCheck[0]?.role === 'super_admin';
      if (!isSuperAdmin) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      }
    }

    if (!file.engineering_run_id) {
      return NextResponse.json({
        success: false,
        error: 'No engineering run associated with this file',
        fileId,
        fileName: file.file_name,
      }, { status: 404 });
    }

    // Load the engineering run
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
      WHERE id = ${file.engineering_run_id}
    `;

    if (runRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Engineering run record not found',
        engineeringRunId: file.engineering_run_id,
      }, { status: 404 });
    }

    const run = runRows[0];

    // Also fetch all sibling files from the same run (for display)
    const siblingFiles = await sql`
      SELECT id, file_name, file_type, mime_type, upload_date
      FROM project_files
      WHERE engineering_run_id = ${file.engineering_run_id}
        AND project_id = ${file.project_id}
      ORDER BY upload_date DESC
    `;

    return NextResponse.json({
      success: true,
      fileId,
      fileName: file.file_name,
      projectId: file.project_id,
      engineeringRunId: file.engineering_run_id,
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
      siblingFiles: siblingFiles.map((f: any) => ({
        id:         f.id,
        fileName:   f.file_name,
        fileType:   f.file_type,
        mimeType:   f.mime_type,
        uploadDate: f.upload_date,
      })),
    });

  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/engineering/run-from-file]', err);
  }
}