// ============================================================
// POST /api/pipeline/run
// Full pipeline execution endpoint.
// Runs all 11 pipeline steps and returns a complete diagnostic.
// Called by the "RUN PROJECT PIPELINE" button in Client Files.
//
// v47.58 FIX (BP-3): Steps 6-9 now WRITE real artifact files to
// project_files using buildAllArtifacts() from artifactBuilders.ts.
// Previously these steps only checked boolean flags and wrote nothing.
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
import { buildAllArtifacts } from '@/lib/engineering/artifactBuilders';

// ── Types ──────────────────────────────────────────────────────────────────────

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
    filesWritten:        number;
    fileNames:           string[];
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

// ── upsertFile helper (mirrors save-outputs pattern exactly) ──────────────────

function buf(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

async function upsertFile(sql: any, params: {
  projectId: string;
  clientId:  string | null;
  userId:    string;
  fileName:  string;
  fileType:  string;
  mimeType:  string;
  content:   string;
  notes:     string;
}): Promise<boolean> {
  try {
    const b = buf(params.content);
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${params.projectId}, ${params.clientId}, ${params.userId},
         ${params.fileName}, ${params.fileType}, ${b.length},
         ${params.mimeType}, ${b}, ${params.notes})
      ON CONFLICT (project_id, user_id, file_name)
      DO UPDATE SET
        client_id   = EXCLUDED.client_id,
        file_type   = EXCLUDED.file_type,
        file_size   = EXCLUDED.file_size,
        mime_type   = EXCLUDED.mime_type,
        file_data   = EXCLUDED.file_data,
        notes       = EXCLUDED.notes,
        upload_date = NOW()
    `;
    return true;
  } catch {
    // Fallback: unique constraint may not exist yet — use DELETE+INSERT
    try {
      const b2 = buf(params.content);
      await sql`
        DELETE FROM project_files
        WHERE project_id = ${params.projectId}
          AND user_id    = ${params.userId}
          AND file_name  = ${params.fileName}
      `;
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${params.projectId}, ${params.clientId}, ${params.userId},
           ${params.fileName}, ${params.fileType}, ${b2.length},
           ${params.mimeType}, ${b2}, ${params.notes})
      `;
      return true;
    } catch (e2: any) {
      console.warn('[pipeline/run] upsertFile failed:', params.fileName, e2.message);
      return false;
    }
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

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
  let artifactResult:    PipelineRunResult['artifacts']   = { bomGenerated: false, sldGenerated: false, structuralCalcs: false, permitPacket: false, engineeringReport: false, filesWritten: 0, fileNames: [] };
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

    // ── Step 1: Load project data ──────────────────────────────────────────────
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      step(1, 'Load Project Data', 'error', `Project ${projectId} not found or access denied`);
      return buildResponse(false, projectId, startMs, steps, layoutResult, engineeringResult, artifactResult, permitResult, clientFilesResult, workflowResult, mismatches, errors);
    }
    step(1, 'Load Project Data', 'ok', `Loaded project: ${project.name ?? projectId}`, { projectName: project.name, projectId });

    // ── Step 2: Load layout ────────────────────────────────────────────────────
    console.log('[LAYOUT_LOADED]', { projectId, step: 2 });
    const layout = await getLayoutByProject(projectId, user.id);
    if (!layout || !layout.panels || layout.panels.length === 0) {
      step(2, 'Load Layout', 'error', 'No layout found. Open Design Studio, place panels, and save layout first.');
      layoutResult = { exists: false, panels: 0, roofPlanes: 0, arrays: 0, systemSizeKw: 0, layoutSaved: false, updatedAt: '' };
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

    step(2, 'Load Layout', 'ok', `Layout loaded: ${panelCount} panels, ${roofPlaneCount} roof planes, ${systemSizeKw} kW`, {
      panelCount, roofPlaneCount, arrayCount, systemSizeKw, layoutId: layout.id,
    });

    // ── Step 3: Validate layout ────────────────────────────────────────────────
    if (panelCount === 0) {
      step(3, 'Validate Layout', 'error', 'Layout has 0 panels — no design saved');
    } else if (roofPlaneCount === 0) {
      step(3, 'Validate Layout', 'warning', `${panelCount} panels found but no roof planes — roof setbacks may be missing`);
    } else {
      step(3, 'Validate Layout', 'ok', `Layout valid: ${panelCount} panels across ${roofPlaneCount} roof plane(s)`);
    }

    // ── Step 4: Rebuild engineering model ─────────────────────────────────────
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

    // ── Step 5: Compute system size ────────────────────────────────────────────
    const computedKw = parseFloat((panelCount * 0.4).toFixed(2));
    step(5, 'Compute System Size', 'ok', `${panelCount} panels × 400W = ${computedKw} kW DC`, {
      panels: panelCount, wattsPerPanel: 400, systemSizeKw: computedKw,
    });

    // ── Step 6-8: Generate and WRITE all 5 artifact files to project_files ─────
    // v47.58 FIX (BP-3): Previously steps 6-9 only checked boolean flags and
    // wrote nothing. Now we call buildAllArtifacts() and upsert every file.
    console.log('[ARTIFACT_GENERATION_STARTED]', { projectId, step: '6-8' });

    // Resolve client name and slug from project data
    const rawClientName = project.name ?? 'Client';
    const clientSlug    = rawClientName.replace(/[^a-z0-9]/gi, '_');
    const reportDate    = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Resolve client_id from project (may be null)
    const resolvedClientId = (project as any).clientId ?? null;

    // Build all 5 artifact files from the engineering report
    const artifactFiles = buildAllArtifacts({
      report:     existingReport,
      projectId,
      clientName: rawClientName,
      clientSlug,
      reportDate,
    });

    // Write each artifact file to project_files (upsert)
    const writtenFileNames: string[] = [];
    let writeErrors = 0;

    for (const artifact of artifactFiles) {
      const ok = await upsertFile(sql, {
        projectId,
        clientId:  resolvedClientId,
        userId:    user.id,
        fileName:  artifact.fileName,
        fileType:  artifact.fileType,
        mimeType:  artifact.mimeType,
        content:   artifact.content,
        notes:     artifact.notes,
      });
      if (ok) {
        writtenFileNames.push(artifact.fileName);
        console.log('[ARTIFACT_WRITTEN]', { projectId, fileName: artifact.fileName, fileType: artifact.fileType });
      } else {
        writeErrors++;
        console.error('[ARTIFACT_WRITE_FAILED]', { projectId, fileName: artifact.fileName });
      }
    }

    const filesWritten = writtenFileNames.length;
    console.log('[ARTIFACT_GENERATION_COMPLETED]', { projectId, filesWritten, writeErrors });

    // Populate artifactResult from what was actually written
    artifactResult = {
      bomGenerated:      writtenFileNames.some(n => n.startsWith('BOM_')),
      sldGenerated:      writtenFileNames.some(n => n.startsWith('SLD_')),
      structuralCalcs:   !!(existingReport.structural),
      permitPacket:      writtenFileNames.some(n => n.startsWith('Permit_Packet_')),
      engineeringReport: writtenFileNames.some(n => n.startsWith('Engineering_Report_')),
      filesWritten,
      fileNames:         writtenFileNames,
    };

    if (writeErrors > 0) {
      step(6, 'Generate Artifacts', 'warning',
        `Generated ${filesWritten}/5 artifact files (${writeErrors} write error(s))`,
        { filesWritten, writeErrors, fileNames: writtenFileNames }
      );
    } else if (filesWritten === 5) {
      step(6, 'Generate Artifacts', 'ok',
        `All 5 artifact files written to project workspace`,
        { filesWritten, fileNames: writtenFileNames }
      );
    } else {
      step(6, 'Generate Artifacts', 'error',
        `Only ${filesWritten}/5 artifact files written — check server logs`,
        { filesWritten, fileNames: writtenFileNames }
      );
    }

    // Individual artifact steps for diagnostic granularity
    step(7, 'Generate BOM',
      artifactResult.bomGenerated ? 'ok' : 'error',
      artifactResult.bomGenerated
        ? `BOM written — ${panelCount} panels, ${inverterCount} inverter(s)`
        : 'BOM could not be written to project_files'
    );

    step(8, 'Generate SLD',
      artifactResult.sldGenerated ? 'ok' : 'warning',
      artifactResult.sldGenerated
        ? 'SLD written to project workspace'
        : 'SLD write failed — electrical data may be missing'
    );

    // ── Step 9: Generate permit sheets ────────────────────────────────────────
    const EXPECTED_SHEETS = 13;
    let sheetsPopulated = 0;
    if (existingReport.systemSummary)  sheetsPopulated += 3;
    if (panelCount > 0)                sheetsPopulated += 2;
    if (existingReport.electrical)     sheetsPopulated += 3;
    if (existingReport.structural)     sheetsPopulated += 1;
    if (existingReport.systemSummary)  sheetsPopulated += 4;

    const permitReady = panelCount > 0 && artifactResult.permitPacket;
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
        ? `Permit packet written — ${panelCount} panels, ${systemSizeKw} kW, ~${sheetsPopulated}/${EXPECTED_SHEETS} sheets`
        : 'Permit blocked — permit packet could not be written (check artifact generation)',
      { sheetsExpected: EXPECTED_SHEETS, sheetsPopulated, panelCount }
    );

    // ── Step 10: Read artifact registry (verify what is now in DB) ────────────
    console.log('[REGISTRY_READ_STARTED]', { projectId, step: 10 });
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
    clientFilesResult = {
      artifactRegistryEntries: registryCount,
      visibleWorkspaceFiles:   registryCount,
      fileNames:               registryFiles.map((f: any) => f.file_name),
    };

    console.log('[REGISTRY_READ_COMPLETED]', { projectId, registryCount });
    step(10, 'Update Artifact Registry', registryCount > 0 ? 'ok' : 'warning',
      registryCount > 0
        ? `Registry has ${registryCount} file(s) — client workspace populated`
        : 'Registry still empty after artifact write — check upsertFile errors',
      { count: registryCount, files: registryFiles.map((f: any) => f.file_name) }
    );

    // ── Step 11: Update workflow state ────────────────────────────────────────
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

    // ── Mismatch detection ────────────────────────────────────────────────────
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
      const m = {
        code:             'PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC',
        field:            'artifactFiles',
        layoutValue:      5,
        engineeringValue: filesWritten,
        severity:         'WARNING' as const,
        message:          `Pipeline wrote ${filesWritten}/5 artifact files. Missing: ${['Engineering_Report', 'SLD', 'BOM', 'Permit_Packet', 'System_Estimate'].filter(n => !writtenFileNames.some(f => f.startsWith(n))).join(', ')}.`,
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