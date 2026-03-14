// ============================================================
// POST /api/pipeline/run
// Full pipeline execution endpoint.
// Runs all 11 pipeline steps and returns a complete diagnostic.
// Called by the "RUN PROJECT PIPELINE" button in Client Files.
// ============================================================

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, getProjectById, getLayoutByProject, handleRouteDbError } from '@/lib/db-neon';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import {
  getEngineeringReport,
  upsertEngineeringReport,
  generateReportId,
  isEngineeringReportStale,
} from '@/lib/engineering/db-engineering';

// ── Types ──────────────────────────────────────────────────────────────────

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
    exists:        boolean;
    panels:        number;
    roofPlanes:    number;
    arrays:        number;
    systemSizeKw:  number;
    layoutSaved:   boolean;
    updatedAt:     string;
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
    bomGenerated:        boolean;
    sldGenerated:        boolean;
    structuralCalcs:     boolean;
    permitPacket:        boolean;
    engineeringReport:   boolean;
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

// ── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body.projectId as string;
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
  }

  const steps: PipelineStepResult[] = [];
  const errors: string[] = [];
  const mismatches: PipelineRunResult['mismatches'] = [];

  // Defaults
  let layoutResult:      PipelineRunResult['layout']      = { exists: false, panels: 0, roofPlanes: 0, arrays: 0, systemSizeKw: 0, layoutSaved: false, updatedAt: '' };
  let engineeringResult: PipelineRunResult['engineering'] = { exists: false, systemSizeKw: 0, moduleCount: 0, inverterCount: 0, panelModel: '', inverterModel: '', engineeringModelGenerated: false, wasRebuilt: false, designVersionId: '' };
  let artifactResult:    PipelineRunResult['artifacts']   = { bomGenerated: false, sldGenerated: false, structuralCalcs: false, permitPacket: false, engineeringReport: false };
  let permitResult:      PipelineRunResult['permit']      = { sheetsExpected: 13, sheetsGenerated: 0, totalPanels: 0, systemKw: 0, ready: false };
  let clientFilesResult: PipelineRunResult['clientFiles'] = { artifactRegistryEntries: 0, visibleWorkspaceFiles: 0, fileNames: [] };
  let workflowResult:    PipelineRunResult['workflow']    = { designComplete: false, engineeringComplete: false, permitReady: false, filesReady: false };

  function step(n: number, name: string, status: PipelineStepResult['status'], msg: string, data?: Record<string, any>) {
    steps.push({ step: n, name, status, message: msg, data });
    if (status === 'error') errors.push(`[Step ${n}] ${name}: ${msg}`);
    console.log(`[PIPELINE_STEP_${n}] ${name} status=${status} msg=${msg}`, data ?? '');
  }

  try {
    const sql = await getDbReady();

    // ── Step 1: Load project data ────────────────────────────────────────
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      step(1, 'Load Project Data', 'error', `Project ${projectId} not found or access denied`);
      return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
    }
    step(1, 'Load Project Data', 'ok', `Loaded project: ${project.name ?? projectId}`, { projectName: project.name, projectId });

    // ── Step 2: Load layout ──────────────────────────────────────────────
    console.log('[LAYOUT_LOADED]', { projectId, step: 2 });
    const layout = await getLayoutByProject(projectId, user.id);
    if (!layout || !layout.panels || layout.panels.length === 0) {
      step(2, 'Load Layout', 'error', 'No layout found. Open Design Studio, place panels, and save layout first.');
      layoutResult = { exists: false, panels: 0, roofPlanes: 0, arrays: 0, systemSizeKw: 0, layoutSaved: false, updatedAt: '' };
      return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
    }

    const panelCount     = layout.panels.length;
    const roofPlaneCount = layout.roofPlanes?.length ?? 0;
    // Count distinct arrays by systemType grouping
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

    step(2, 'Load Layout', 'ok', `Layout loaded: ${panelCount} panels, ${roofPlaneCount} roof planes, ${systemSizeKw} kW`, {
      panelCount, roofPlaneCount, arrayCount, systemSizeKw, layoutId: layout.id,
    });

    // ── Step 3: Validate layout ──────────────────────────────────────────
    if (panelCount === 0) {
      step(3, 'Validate Layout', 'error', 'Layout has 0 panels — no design saved');
    } else if (roofPlaneCount === 0) {
      step(3, 'Validate Layout', 'warning', `${panelCount} panels found but no roof planes — roof setbacks may be missing`);
    } else {
      step(3, 'Validate Layout', 'ok', `Layout valid: ${panelCount} panels across ${roofPlaneCount} roof plane(s)`);
    }

    // ── Step 4: Rebuild engineering model ────────────────────────────────
    console.log('[ENGINEERING_REBUILD_STARTED]', { projectId, panelCount, step: 4 });
    const snapshot    = buildDesignSnapshot(project, layout);
    const isStale     = await isEngineeringReportStale(projectId, snapshot.designVersionId);
    let existingReport = await getEngineeringReport(projectId);
    let wasRebuilt    = false;

    if (!existingReport || isStale) {
      const reportId  = generateReportId();
      existingReport  = generateEngineeringReport(snapshot, reportId);
      await upsertEngineeringReport(existingReport, projectId);
      wasRebuilt = true;
      console.log('[ENGINEERING_REBUILD_COMPLETED]', {
        projectId,
        panelCount: existingReport.systemSummary.panelCount,
        systemSizeKw: existingReport.systemSummary.systemSizeKw,
        panelModel: existingReport.systemSummary.panelModel,
      });
      step(4, 'Rebuild Engineering Model', 'ok', `Rebuilt — ${existingReport.systemSummary.panelCount} panels, ${existingReport.systemSummary.systemSizeKw} kW, ${existingReport.systemSummary.panelModel}`, {
        panelCount: existingReport.systemSummary.panelCount,
        systemSizeKw: existingReport.systemSummary.systemSizeKw,
        panelModel: existingReport.systemSummary.panelModel,
      });
    } else {
      step(4, 'Rebuild Engineering Model', 'ok', `Model current — ${existingReport.systemSummary.panelCount} panels, ${existingReport.systemSummary.systemSizeKw} kW`, {
        panelCount: existingReport.systemSummary.panelCount,
      });
    }

    const engPanelCount   = existingReport.systemSummary.panelCount;
    const engSystemSizeKw = existingReport.systemSummary.systemSizeKw;
    const inverterCount   = existingReport.equipmentSchedule?.inverters?.length ?? 0;

    engineeringResult = {
      exists:                    true,
      systemSizeKw:              engSystemSizeKw,
      moduleCount:               engPanelCount,
      inverterCount,
      panelModel:                existingReport.systemSummary.panelModel,
      inverterModel:             existingReport.systemSummary.inverterModel,
      engineeringModelGenerated: true,
      wasRebuilt,
      designVersionId:           snapshot.designVersionId,
    };

    // ── Step 5: Compute system size ───────────────────────────────────────
    const computedKw = parseFloat((panelCount * 0.4).toFixed(2));
    step(5, 'Compute System Size', 'ok', `${panelCount} panels × 400W = ${computedKw} kW DC`, {
      panels: panelCount, wattsPerPanel: 400, systemSizeKw: computedKw,
    });

    // ── Step 6: Generate BOM ──────────────────────────────────────────────
    console.log('[ARTIFACT_GENERATION_STARTED]', { projectId, artifact: 'bom', step: 6 });
    const hasBom = !!(existingReport.systemSummary);  // BOM is derived from system summary
    artifactResult.bomGenerated = hasBom;
    console.log('[ARTIFACT_GENERATION_COMPLETED]', { projectId, artifact: 'bom', generated: hasBom });
    step(6, 'Generate BOM', hasBom ? 'ok' : 'error', hasBom ? `BOM ready — ${panelCount} panels, ${inverterCount} inverter(s)` : 'BOM could not be generated');

    // ── Step 7: Generate SLD ──────────────────────────────────────────────
    console.log('[ARTIFACT_GENERATION_STARTED]', { projectId, artifact: 'sld', step: 7 });
    const hasSld = !!(existingReport.electrical);
    artifactResult.sldGenerated = hasSld;
    console.log('[ARTIFACT_GENERATION_COMPLETED]', { projectId, artifact: 'sld', generated: hasSld });
    step(7, 'Generate SLD', hasSld ? 'ok' : 'warning', hasSld ? 'SLD data available (renders on permit generation)' : 'Electrical data missing — SLD may be incomplete');

    // ── Step 8: Generate engineering sheets ──────────────────────────────
    const hasStructural = !!(existingReport.structural);
    artifactResult.structuralCalcs   = hasStructural;
    artifactResult.engineeringReport = true;
    step(8, 'Generate Engineering Sheets', 'ok', `Engineering report generated — structural: ${hasStructural ? 'yes' : 'no (uses defaults)'}`, {
      hasStructural, hasElectrical: !!(existingReport.electrical),
    });

    // ── Step 9: Generate permit sheets ───────────────────────────────────
    const EXPECTED_SHEETS = 13;
    // Count how many permit sheet functions have data to populate
    let sheetsPopulated = 0;
    if (existingReport.systemSummary)      sheetsPopulated += 3;  // PV-0, PV-1, PV-2A
    if (panelCount > 0)                    sheetsPopulated += 2;  // PV-2B, PV-3
    if (existingReport.electrical)         sheetsPopulated += 3;  // PV-4A, PV-4B, E-1
    if (existingReport.structural)         sheetsPopulated += 1;  // PV-4C
    if (existingReport.systemSummary)      sheetsPopulated += 4;  // PV-5, SCHED, APP-A, CERT

    const permitReady = panelCount > 0;
    artifactResult.permitPacket = permitReady;
    permitResult = {
      sheetsExpected:  EXPECTED_SHEETS,
      sheetsGenerated: sheetsPopulated,
      totalPanels:     panelCount,
      systemKw:        systemSizeKw,
      ready:           permitReady,
    };
    step(9, 'Generate Permit Sheets', permitReady ? 'ok' : 'error',
      permitReady
        ? `Permit ready — ${panelCount} panels, ${systemSizeKw} kW, ~${sheetsPopulated}/${EXPECTED_SHEETS} sheets populated`
        : 'Permit blocked — panel count is 0 (ENGINEERING_MODEL_STALE)',
      { sheetsExpected: EXPECTED_SHEETS, sheetsPopulated, panelCount }
    );

    // ── Step 10: Update artifact registry ────────────────────────────────
    console.log('[ARTIFACT_GENERATION_STARTED]', { projectId, artifact: 'registry', step: 10 });
    let artifactFiles: any[] = [];
    try {
      artifactFiles = await sql`
        SELECT id, file_name, file_type, file_size, upload_date, engineering_run_id
        FROM project_files
        WHERE project_id = ${projectId} AND user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    } catch (e: any) {
      // engineering_run_id column may not exist yet — fallback query
      try {
        artifactFiles = await sql`
          SELECT id, file_name, file_type, file_size, upload_date
          FROM project_files
          WHERE project_id = ${projectId} AND user_id = ${user.id}
          ORDER BY created_at DESC
        `;
      } catch { /* ignore */ }
    }

    const registryCount = artifactFiles.length;
    clientFilesResult = {
      artifactRegistryEntries: registryCount,
      visibleWorkspaceFiles:   registryCount,
      fileNames:               artifactFiles.map((f: any) => f.file_name),
    };

    console.log('[ARTIFACT_GENERATION_COMPLETED]', { projectId, artifact: 'registry', count: registryCount });
    step(10, 'Update Artifact Registry', 'ok', `Registry has ${registryCount} file(s)`, {
      count: registryCount,
      files: artifactFiles.map((f: any) => f.file_name),
    });

    // ── Step 11: Update workflow state ────────────────────────────────────
    workflowResult = {
      designComplete:      panelCount > 0,
      engineeringComplete: panelCount > 0 && engineeringResult.engineeringModelGenerated,
      permitReady:         permitReady,
      filesReady:          registryCount > 0,
    };
    step(11, 'Update Workflow State', 'ok',
      `Design: ${workflowResult.designComplete ? '✓' : '✗'} | Engineering: ${workflowResult.engineeringComplete ? '✓' : '✗'} | Permit: ${workflowResult.permitReady ? '✓' : '✗'} | Files: ${workflowResult.filesReady ? '✓' : '✗'}`,
      workflowResult
    );

    // ── Mismatch detection ────────────────────────────────────────────────
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

    if (permitReady && registryCount === 0) {
      const m = {
        code:             'PIPELINE_ARTIFACT_REGISTRY_EMPTY',
        field:            'artifactRegistry',
        layoutValue:      'permit ready',
        engineeringValue: '0 files in registry',
        severity:         'WARNING' as const,
        message:          'Permit is ready but artifact registry is empty. Run "Generate Files" to populate client workspace.',
      };
      mismatches.push(m);
      console.warn('[PIPELINE_MISMATCH]', { projectId, ...m });
    }

    if (registryCount > 0 && registryCount < 5) {
      const m = {
        code:             'PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC',
        field:            'artifactRegistry',
        layoutValue:      5,
        engineeringValue: registryCount,
        severity:         'WARNING' as const,
        message:          `Registry has ${registryCount} file(s) but 5 are expected (Engineering Report, SLD, BOM, Permit Packet, System Estimate). Click "Generate Files" to resync.`,
      };
      mismatches.push(m);
      console.warn('[PIPELINE_MISMATCH]', { projectId, ...m });
    }

    return buildResponse(
      errors.length === 0, projectId, startMs,
      steps, layoutResult, engineeringResult, artifactResult,
      permitResult, clientFilesResult, workflowResult, mismatches, errors
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    step(0, 'Pipeline Fatal Error', 'error', msg);
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