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
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json({ success: false, error: 'fileId required' }, { status: 400 });
    }
    if (!isValidUUID(fileId)) {
      return NextResponse.json({ success: false, error: 'Invalid fileId format.' }, { status: 400 });
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
        // NOT 1. `inverter_qty` has never been written, and the device count is not a
        // stored scalar: the authority is the actual electrical topology —
        // `config_snapshot.inverters`, one entry per inverter with its own strings,
        // read against the manufacturer's capacity. Coalescing a missing value to 1
        // asserted a single inverter for every multi-inverter design ever saved.
        inverterQty:           run.inverter_qty ?? null,
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
        // 🚨 THIS USED TO READ `run.system_type || 'grid-tied'`, AND system_type WAS NEVER
        // WRITTEN. So every restore returned 'grid-tied' — a value outside the engineering
        // page's SystemType ('roof' | 'ground' | 'fence') — and the page applies it
        // unguarded as `patches.systemType`. Reopening a saved FENCE or GROUND design
        // therefore knocked it out of its own system type, and the next save wrote back
        // `mountType: 'Roof Mount'`, carrying the wrong mount into the permit packet and
        // the BOM's racking profile. NULL means not recorded; the page's hydration is
        // truthiness-guarded, so null leaves the live config's own value alone.
        systemType:            run.system_type || null,
        stringConfig:          run.string_config || [],
        configSnapshot:        run.config_snapshot || {},
        calcOutputs:           run.calc_outputs || {},
        generatedAt:           run.generated_at,
      },
      // 🚨 WHETHER THIS RUN CAN BE RESTORED AT ALL, stated rather than left to be inferred
      // from two nulls. When the identity is missing the page substitutes catalogue
      // defaults — STRING_INVERTERS[0] / MICROINVERTERS[0] for the inverter and
      // `qcells-peak-duo-400` for the panel — so a restore silently re-equips the design
      // and every downstream artefact (recalc, SLD, permit, equipment schedule, BOM,
      // pricing) is computed from equipment nobody chose, beside a stored BOM CSV that
      // describes the equipment that was. Runs saved before this route wrote the identity
      // columns cannot be restored faithfully, and a consumer needs to be able to say so
      // instead of guessing.
      equipmentIdentity: {
        panelId:    run.panel_id || null,
        inverterId: run.inverter_id || null,
        complete:   Boolean(run.panel_id) && Boolean(run.inverter_id),
        reason: Boolean(run.panel_id) && Boolean(run.inverter_id) ? null
          : 'This engineering run was saved before the selected panel and inverter were '
            + 'recorded on the run. Restoring it cannot reproduce the original equipment; '
            + 're-run the calculation from the live design instead of trusting a substitution.',
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