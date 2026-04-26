// ============================================================
// POST /api/pipeline/run
// Full pipeline execution endpoint.
// Delegates to syncProjectPipeline() — the canonical orchestrator —
// then builds a detailed diagnostic result for the UI.
//
// Called by the "RUN PROJECT PIPELINE" button in the engineering page.
// ============================================================

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, getProjectById, getLayoutByProject, handleRouteDbError } from '@/lib/db-neon';
import { syncProjectPipeline } from '@/lib/engineering/syncPipeline';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PipelineStepResult {
  step:    number;
  name:    string;
  status:  'ok' | 'warning' | 'error' | 'skipped';
  message: string;
  data?:   Record<string, any>;
}

export interface PipelineRunResult {
  success:    boolean;
  projectId:  string;
  runAt:      string;
  durationMs: number;

  steps: PipelineStepResult[];

  // Subsystem summaries
  layout: {
    exists:       boolean;
    panels:       number;
    roofPlanes:   number;
    arrays:       number;
    systemSizeKw: number;
    layoutSaved:  boolean;
    updatedAt:    string;
  };

  engineering: {
    exists:                    boolean;
    systemSizeKw:              number;
    moduleCount:               number;
    inverterCount:             number;
    panelModel:                string;
    inverterModel:             string;
    engineeringModelGenerated: boolean;
    wasRebuilt:                boolean;
    designVersionId:           string;
  };

  artifacts: {
    bomGenerated:      boolean;
    sldGenerated:      boolean;
    structuralCalcs:   boolean;
    permitPacket:      boolean;
    engineeringReport: boolean;
    filesWritten:      number;
    fileNames:         string[];
  };

  permit: {
    sheetsExpected:  number;
    sheetsGenerated: number;
    totalPanels:     number;
    systemKw:        number;
    ready:           boolean;
  };

  clientFiles: {
    artifactRegistryEntries: number;
    visibleWorkspaceFiles:   number;
    fileNames:               string[];
  };

  workflow: {
    designComplete:      boolean;
    engineeringComplete: boolean;
    permitReady:         boolean;
    filesReady:          boolean;
  };

  mismatches: Array<{
    code:             string;
    field:            string;
    layoutValue:      number | string;
    engineeringValue: number | string;
    severity:         'ERROR' | 'WARNING';
    message:          string;
  }>;

  errors: string[];
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  const user    = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const body      = await req.json().catch(() => ({}));
  const projectId = body.projectId as string;
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
  }

  const steps:      PipelineStepResult[]            = [];
  const errors:     string[]                        = [];
  const mismatches: PipelineRunResult['mismatches'] = [];

  // Default subsystem summaries — filled in from pipeline result below
  let layoutResult:      PipelineRunResult['layout']      = { exists: false, panels: 0, roofPlanes: 0, arrays: 0, systemSizeKw: 0, layoutSaved: false, updatedAt: '' };
  let engineeringResult: PipelineRunResult['engineering'] = { exists: false, systemSizeKw: 0, moduleCount: 0, inverterCount: 0, panelModel: '', inverterModel: '', engineeringModelGenerated: false, wasRebuilt: false, designVersionId: '' };
  let artifactResult:    PipelineRunResult['artifacts']   = { bomGenerated: false, sldGenerated: false, structuralCalcs: false, permitPacket: false, engineeringReport: false, filesWritten: 0, fileNames: [] };
  let permitResult:      PipelineRunResult['permit']      = { sheetsExpected: 13, sheetsGenerated: 0, totalPanels: 0, systemKw: 0, ready: false };
  let clientFilesResult: PipelineRunResult['clientFiles'] = { artifactRegistryEntries: 0, visibleWorkspaceFiles: 0, fileNames: [] };
  let workflowResult:    PipelineRunResult['workflow']    = { designComplete: false, engineeringComplete: false, permitReady: false, filesReady: false };

  function addStep(n: number, name: string, status: PipelineStepResult['status'], msg: string, data?: Record<string, any>) {
    steps.push({ step: n, name, status, message: msg, data });
    if (status === 'error') errors.push(`[Step ${n}] ${name}: ${msg}`);
    console.log(`[PIPELINE_STEP_${n}]`, { name, status, message: msg, projectId, ...(data ?? {}) });
    if (status === 'ok') {
      console.log('[PIPELINE_STAGE_COMPLETE]', { stage: name, step: n, projectId, message: msg });
    } else if (status === 'error') {
      console.error('[PIPELINE_STAGE_ERROR]', { stage: name, step: n, projectId, message: msg });
    } else if (status === 'warning') {
      console.warn('[PIPELINE_STAGE_ERROR]', { stage: name, step: n, projectId, message: msg, severity: 'warning' });
    }
  }

  try {
    // ── Pre-flight: verify project + layout exist before delegating ───────────
    // (gives better error messages for Steps 1-2 in the UI)
    const sql     = await getDbReady();
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      addStep(1, 'Load Project Data', 'error', `Project ${projectId} not found or access denied`);
      return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
    }
    addStep(1, 'Load Project Data', 'ok', `Loaded project: ${project.name ?? projectId}`, { projectName: project.name, projectId });

    const layout = await getLayoutByProject(projectId, user.id);
    if (!layout || !layout.panels || layout.panels.length === 0) {
      addStep(2, 'Load Layout', 'error', 'No layout found. Open Design Studio, place panels, and save layout first.');
      return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
    }

    const panelCount     = layout.panels.length;
    const roofPlaneCount = layout.roofPlanes?.length ?? 0;
    const arrayCount     = new Set((layout.panels as any[]).map((p: any) => p.systemType ?? 'roof')).size;
    const systemSizeKw   = layout.systemSizeKw ?? parseFloat((panelCount * 0.4).toFixed(2));

    layoutResult = {
      exists:       true,
      panels:       panelCount,
      roofPlanes:   roofPlaneCount,
      arrays:       arrayCount,
      systemSizeKw,
      layoutSaved:  true,
      updatedAt:    layout.updatedAt ?? '',
    };

    addStep(2, 'Load Layout', 'ok',
      `Layout loaded: ${panelCount} panels, ${roofPlaneCount} roof planes, ${systemSizeKw} kW`,
      { panelCount, roofPlaneCount, arrayCount, systemSizeKw, layoutId: layout.id }
    );

    // Validate layout
    if (panelCount === 0) {
      addStep(3, 'Validate Layout', 'error', 'Layout has 0 panels — no design saved');
    } else if (roofPlaneCount === 0) {
      addStep(3, 'Validate Layout', 'warning', `${panelCount} panels found but no roof planes — roof setbacks may be missing`);
    } else {
      addStep(3, 'Validate Layout', 'ok', `Layout valid: ${panelCount} panels across ${roofPlaneCount} roof plane(s)`);
    }

    // ── Delegate Steps 4-8 to syncProjectPipeline() ───────────────────────────
    // This is the single canonical orchestrator. It handles:
    //   4. Rebuild engineering model if stale
    //   5. Build design snapshot (internal)
    //   6. Generate artifact files (engineering report, SLD, BOM, permit, estimate)
    //   7. Write artifacts to project_files (upsert)
    console.log('[PIPELINE_STAGE_START]', { stage: 'sync_pipeline', step: '4-8', projectId });
    const pipelineResult = await syncProjectPipeline(projectId, user.id);

    const report         = pipelineResult.report;
    const inverterCount  = report.equipmentSchedule?.inverters?.length ?? 0;
    const writtenFiles   = pipelineResult.files;
    const filesWritten   = pipelineResult.artifactsWritten;

    // Fill engineering subsystem summary from pipeline result
    engineeringResult = {
      exists:                    true,
      systemSizeKw:              pipelineResult.systemSizeKw,
      moduleCount:               pipelineResult.panelCount,
      inverterCount,
      panelModel:                pipelineResult.panelModel,
      inverterModel:             pipelineResult.inverterModel,
      engineeringModelGenerated: true,
      wasRebuilt:                pipelineResult.wasRebuilt,
      designVersionId:           pipelineResult.designVersionId,
    };

    addStep(4, 'Rebuild Engineering Model',
      pipelineResult.wasRebuilt ? 'ok' : 'ok',
      pipelineResult.wasRebuilt
        ? `Rebuilt — ${pipelineResult.panelCount} panels, ${pipelineResult.systemSizeKw} kW, ${pipelineResult.panelModel}`
        : `Model current — ${pipelineResult.panelCount} panels, ${pipelineResult.systemSizeKw} kW`,
      { panelCount: pipelineResult.panelCount, systemSizeKw: pipelineResult.systemSizeKw, wasRebuilt: pipelineResult.wasRebuilt }
    );

    const computedKw = parseFloat((panelCount * 0.4).toFixed(2));
    addStep(5, 'Compute System Size', 'ok',
      `${panelCount} panels × 400W = ${computedKw} kW DC`,
      { panels: panelCount, wattsPerPanel: 400, systemSizeKw: computedKw }
    );

    // Fill artifact subsystem summary from pipeline result
    artifactResult = {
      bomGenerated:      writtenFiles.some(n => n.startsWith('BOM_')),
      sldGenerated:      writtenFiles.some(n => n.startsWith('SLD_')),
      structuralCalcs:   !!(report.structural),
      permitPacket:      writtenFiles.some(n => n.startsWith('Permit_Packet_')),
      engineeringReport: writtenFiles.some(n => n.startsWith('Engineering_Report_')),
      filesWritten,
      fileNames:         writtenFiles,
    };

    if (filesWritten === 5) {
      addStep(6, 'Generate Artifacts', 'ok',
        `All 5 artifact files written to project workspace`,
        { filesWritten, fileNames: writtenFiles }
      );
    } else if (filesWritten > 0) {
      addStep(6, 'Generate Artifacts', 'warning',
        `Generated ${filesWritten}/5 artifact files`,
        { filesWritten, fileNames: writtenFiles }
      );
    } else {
      addStep(6, 'Generate Artifacts', 'error',
        `Zero artifact files written — check server logs`,
        { filesWritten }
      );
    }

    addStep(7, 'Generate BOM',
      artifactResult.bomGenerated ? 'ok' : 'error',
      artifactResult.bomGenerated
        ? `BOM written — ${panelCount} panels, ${inverterCount} inverter(s)`
        : 'BOM could not be written to project_files'
    );

    addStep(8, 'Generate SLD',
      artifactResult.sldGenerated ? 'ok' : 'warning',
      artifactResult.sldGenerated
        ? 'SLD written to project workspace'
        : 'SLD write failed — electrical data may be missing'
    );

    // Propagate any pipeline errors into our error list
    for (const e of pipelineResult.errors) {
      if (!errors.includes(e)) errors.push(e);
    }

    // ── Step 9: Permit readiness check ────────────────────────────────────────
    const EXPECTED_SHEETS = 13;
    let sheetsPopulated   = 0;
    if (report.systemSummary) sheetsPopulated += 3;
    if (panelCount > 0)       sheetsPopulated += 2;
    if (report.electrical)    sheetsPopulated += 3;
    if (report.structural)    sheetsPopulated += 1;
    if (report.systemSummary) sheetsPopulated += 4;

    const permitReady = panelCount > 0 && artifactResult.permitPacket;
    artifactResult.permitPacket = permitReady;
    permitResult = {
      sheetsExpected:  EXPECTED_SHEETS,
      sheetsGenerated: sheetsPopulated,
      totalPanels:     panelCount,
      systemKw:        systemSizeKw,
      ready:           permitReady,
    };
    addStep(9, 'Generate Permit Sheets',
      permitReady ? 'ok' : 'error',
      permitReady
        ? `Permit packet written — ${panelCount} panels, ${systemSizeKw} kW, ~${sheetsPopulated}/${EXPECTED_SHEETS} sheets`
        : 'Permit blocked — permit packet could not be written (check artifact generation)',
      { sheetsExpected: EXPECTED_SHEETS, sheetsPopulated, panelCount }
    );

    // ── Step 10: Read artifact registry (verify what is now in DB) ────────────
    let registryFiles: any[] = [];
    try {
      registryFiles = await sql`
        SELECT id, file_name, file_type, file_size, upload_date, engineering_run_id
        FROM project_files
        WHERE project_id = ${projectId} AND user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    } catch {
      try {
        registryFiles = await sql`
          SELECT id, file_name, file_type, file_size, upload_date
          FROM project_files
          WHERE project_id = ${projectId} AND user_id = ${user.id}
          ORDER BY created_at DESC
        `;
      } catch { /* ignore */ }
    }

    const registryCount = registryFiles.length;
    clientFilesResult   = {
      artifactRegistryEntries: registryCount,
      visibleWorkspaceFiles:   registryCount,
      fileNames:               registryFiles.map((f: any) => f.file_name),
    };

    addStep(10, 'Update Artifact Registry',
      registryCount > 0 ? 'ok' : 'warning',
      registryCount > 0
        ? `Registry has ${registryCount} file(s) — client workspace populated`
        : 'Registry still empty after artifact write — check upsertFile errors',
      { count: registryCount, files: registryFiles.map((f: any) => f.file_name) }
    );

    // ── Step 11: Compute workflow state ───────────────────────────────────────
    workflowResult = {
      designComplete:      panelCount > 0,
      engineeringComplete: panelCount > 0 && engineeringResult.engineeringModelGenerated,
      permitReady,
      filesReady:          registryCount > 0,
    };
    addStep(11, 'Update Workflow State', 'ok',
      `Design: ${workflowResult.designComplete ? '✓' : '✗'} | Engineering: ${workflowResult.engineeringComplete ? '✓' : '✗'} | Permit: ${workflowResult.permitReady ? '✓' : '✗'} | Files: ${workflowResult.filesReady ? '✓' : '✗'}`,
      workflowResult
    );

    // ── Mismatch detection ────────────────────────────────────────────────────
    const engPanelCount = engineeringResult.moduleCount;
    if (panelCount > 0 && engPanelCount !== panelCount) {
      const m = {
        code:             'PIPELINE_MISMATCH_ENGINEERING_MODEL_STALE',
        field:            'panelCount',
        layoutValue:      panelCount,
        engineeringValue: engPanelCount,
        severity:         'ERROR' as const,
        message:          `Layout has ${panelCount} panels but engineering model has ${engPanelCount}. Engineering model is stale.`,
      };
      mismatches.push(m);
      errors.push(`[PIPELINE_MISMATCH] ${m.message}`);
      console.error('[PIPELINE_MISMATCH]', { projectId, ...m });
    }

    if (filesWritten === 0) {
      const m = {
        code:             'PIPELINE_ARTIFACT_WRITE_FAILED',
        field:            'artifactFiles',
        layoutValue:      'engineering complete',
        engineeringValue: '0 files written',
        severity:         'ERROR' as const,
        message:          'Pipeline ran but zero artifact files were written to project_files. Check upsertFile errors in server logs.',
      };
      mismatches.push(m);
      errors.push(`[PIPELINE_ARTIFACT_WRITE_FAILED] ${m.message}`);
      console.error('[PIPELINE_ARTIFACT_WRITE_FAILED]', { projectId });
    } else if (filesWritten < 5) {
      mismatches.push({
        code:             'PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC',
        field:            'artifactFiles',
        layoutValue:      5,
        engineeringValue: filesWritten,
        severity:         'WARNING' as const,
        message:          `Pipeline wrote ${filesWritten}/5 artifact files.`,
      });
    }

    return buildResponse(
      errors.length === 0, projectId, startMs,
      steps, layoutResult, engineeringResult, artifactResult,
      permitResult, clientFilesResult, workflowResult, mismatches, errors
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error).message : String(err);
    errors.push(msg);
    addStep(0, 'Pipeline Fatal Error', 'error', msg);
    console.error('[PIPELINE_ERROR]', { projectId, error: msg });
    return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
  }
}

function buildResponse(
  success: boolean,
  projectId: string,
  startMs: number,
  steps: PipelineStepResult[],
  layout: PipelineRunResult['layout'],
  engineering: PipelineRunResult['engineering'],
  artifacts: PipelineRunResult['artifacts'],
  permit: PipelineRunResult['permit'],
  clientFiles: PipelineRunResult['clientFiles'],
  workflow: PipelineRunResult['workflow'],
  mismatches: PipelineRunResult['mismatches'],
  errors: string[]
): NextResponse {
  const result: PipelineRunResult = {
    success,
    projectId,
    runAt:      new Date().toISOString(),
    durationMs: Date.now() - startMs,
    steps,
    layout,
    engineering,
    artifacts,
    permit,
    clientFiles,
    workflow,
    mismatches,
    errors,
  };
  return NextResponse.json(result, { status: success ? 200 : 207 });
}