// ============================================================
// syncProjectPipeline — Single orchestration point
// Reads layout from DB → rebuilds engineering model → writes
// artifacts to project_files → returns canonical PipelineResult
//
// This is the ONLY place that should orchestrate:
//   1. Load project
//   2. Load layout (source of truth)
//   3. Build design snapshot
//   4. Rebuild engineering model if stale (or force=true)
//   5. Build all artifact files
//   6. Write artifacts to project_files (upsert)
//   7. Compute workflow state
//   8. Build canonicalSnapshot and write to projects table
// ============================================================

import { getLayoutByProject, getProjectById, getDbReady } from '@/lib/db-neon';
import { buildDesignSnapshot } from './designSnapshot';
import { generateEngineeringReport } from './reportGenerator';
import { getProjectPhysicalData } from '@/lib/db-neon';
import { fetchSatelliteImage, isSatelliteImageValid } from '@/lib/permit/satelliteService';
import {
  getEngineeringReport,
  upsertEngineeringReport,
  generateReportId,
  isEngineeringReportStale,
} from './db-engineering';
import { buildAllArtifacts } from './artifactBuilders';
import type { EngineeringReport, DesignSnapshot } from './types';

// ── Return type ───────────────────────────────────────────────────────────────

export interface CanonicalSnapshot {
  layout: {
    panels:     Array<{ id: string; lat: number; lng: number; systemType?: string }>;
    roofPlanes: Array<{ id: string; azimuth: number; pitch: number }>;
    setbacks:   Array<{ type: string; widthM: number }>;
    systemType: 'roof' | 'ground_mount' | 'sol_fence';
  };
  engineering: {
    systemSizeKw:    number;
    panelCount:      number;
    productionKwh:   number;
  };
  electrical: {
    inverter:  string;
    stringing: Record<string, unknown> | null;
    voltage:   number;
    current:   number;
  };
  bom: {
    rails:          number;
    attachments:    number;
    clamps:         number;
    conduitLength:  number;
    wireLength:     number;
  };
  structural: {
    loads:             Record<string, unknown> | null;
    attachmentSpacing: number;
  };
  financial: {
    grossCost:      number;
    netCost:        number;
    monthlyPayment: number;
  };
  metadata: {
    address:   string;
    ahj:       string;
    timestamp: string;
    version:   string;
  };
}

export interface PipelineResult {
  // Overall
  success: boolean;
  projectId: string;

  // Layout ground truth
  layoutLoaded: boolean;
  layoutPanelCount: number;
  layoutRoofPlaneCount: number;
  layoutSystemSizeKw: number;
  layoutUpdatedAt: string;

  // Engineering model (derived from layout)
  engineeringUpdated: boolean;
  report: EngineeringReport;
  panelCount: number;        // canonical (always from layout)
  systemSizeKw: number;      // canonical (always from layout)
  panelModel: string;
  inverterModel: string;

  // Artifacts
  artifactsWritten: number;
  files: string[];

  // Workflow state (computed from data, not flags)
  workflow: {
    designComplete: boolean;
    engineeringComplete: boolean;
    artifactsReady: boolean;
  };

  // ── Canonical snapshot — single source of truth ──
  // Written to projects.canonical_snapshot after every successful pipeline run.
  // ALL downstream pages MUST read from this. NO recalculation allowed.
  canonicalSnapshot: CanonicalSnapshot;

  // Diagnostics
  wasRebuilt: boolean;
  designVersionId: string;
  errors: string[];
}

export interface PipelineMismatch {
  field: string;
  layoutValue: number | string;
  engineeringValue: number | string;
  severity: 'ERROR' | 'WARNING';
}

// ── Structured log helpers ────────────────────────────────────────────────────

function pipelineStart(projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_START]', { projectId, ts: new Date().toISOString(), ...meta });
}

function pipelineComplete(projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_COMPLETE]', { projectId, ts: new Date().toISOString(), ...meta });
}

function pipelineError(projectId: string, error: string, meta?: Record<string, unknown>) {
  console.error('[PIPELINE_ERROR]', { projectId, error, ts: new Date().toISOString(), ...meta });
}

function stageStart(stage: string, projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_STAGE_START]', { stage, projectId, ts: new Date().toISOString(), ...meta });
}

function stageComplete(stage: string, projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_STAGE_COMPLETE]', { stage, projectId, ts: new Date().toISOString(), ...meta });
}

function stageError(stage: string, projectId: string, error: string, meta?: Record<string, unknown>) {
  console.error('[PIPELINE_STAGE_ERROR]', { stage, projectId, error, ts: new Date().toISOString(), ...meta });
}


// ── buildCanonicalSnapshot ───────────────────────────────────────────────────────
// Builds the CanonicalSnapshot from layout + engineering report.
// This is the SINGLE SOURCE OF TRUTH for all downstream pages.

function buildCanonicalSnapshot(
  snapshot: DesignSnapshot,
  report: EngineeringReport,
  layoutPanelCount: number,
  layoutSystemSizeKw: number,
): CanonicalSnapshot {
  const elec = report.electrical;
  const stru = report.structural;
  const sys  = report.systemSummary;

  // BOM: derive from structural + electrical data
  const panelW      = snapshot.panel?.width  ?? 1.134;
  const panelH      = snapshot.panel?.height ?? 1.762;
  const railSpanFt  = 4.0;
  const totalRowW   = layoutPanelCount * (panelW * 3.281);     // meters → feet
  const rails       = Math.ceil(totalRowW / railSpanFt) * 2;   // 2 rails per row
  const maxAttachSpacing = 48;                                  // inches
  const attachments = Math.ceil((rails * railSpanFt * 12) / maxAttachSpacing);
  const clamps      = layoutPanelCount * 4;                    // 4 per panel, edge-adjusted
  const wireLength  = (elec?.dcWireGauge ? layoutPanelCount * 6 : 0);
  const conduitLength = Math.ceil(wireLength * 1.1);           // 10% slack

  return {
    layout: {
      panels:     snapshot.panels.map(p => ({
        id:         p.id,
        lat:        p.lat ?? 0,
        lng:        p.lng ?? 0,
        systemType: p.systemType ?? snapshot.systemType,
      })),
      roofPlanes: snapshot.roofSegments.map(r => ({
        id:      r.id,
        azimuth: r.azimuthDegrees,
        pitch:   r.pitchDegrees,
      })),
      setbacks: [],
      systemType: (snapshot.systemType === 'ground'
        ? 'ground_mount'
        : snapshot.systemType === 'fence'
          ? 'sol_fence'
          : 'roof') as 'roof' | 'ground_mount' | 'sol_fence',
    },
    engineering: {
      systemSizeKw:  layoutSystemSizeKw,
      panelCount:    layoutPanelCount,
      productionKwh: sys?.estimatedAnnualKwh ?? 0,
    },
    electrical: {
      inverter:  sys?.inverterModel ?? 'TBD',
      stringing: elec ? {
        stringCount:     elec.stringCount,
        panelsPerString: elec.panelsPerString,
        stringVoc:       elec.stringVoc,
        stringVmp:       elec.stringVmp,
      } : null,
      voltage:   elec?.dcVoltage      ?? 0,
      current:   elec?.stringIsc      ?? 0,
    },
    bom: {
      rails,
      attachments,
      clamps,
      conduitLength,
      wireLength,
    },
    structural: {
      loads: stru ? {
        windSpeedMph:       stru.windSpeedMph,
        groundSnowLoadPsf:  stru.groundSnowLoadPsf,
        seismicDesignCat:   stru.seismicZone,
      } : null,
      attachmentSpacing: stru?.attachmentSpacingFt ? stru.attachmentSpacingFt * 12 : 48,
    },
    financial: {
      grossCost:      0,   // populated by pricing engine outside pipeline
      netCost:        0,
      monthlyPayment: 0,
    },
    metadata: {
      address:   snapshot.address,
      ahj:       snapshot.ahj,
      timestamp: new Date().toISOString(),
      version:   '47326',
    },
  };
}

// ── upsertFile helper ─────────────────────────────────────────────────────────

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
    } catch (e2: unknown) {
      console.warn('[syncPipeline] upsertFile failed:', params.fileName, (e2 as Error).message);
      return false;
    }
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

/**
 * Sync the full project pipeline — the single canonical orchestrator.
 *
 * Stages:
 *   1. Load project from DB
 *   2. Load layout (source of truth for panel count + roof planes)
 *   3. Build design snapshot (deterministic hash of layout)
 *   4. Rebuild engineering model if stale or force=true
 *   5. Build artifact files (report, SLD, BOM, permit, estimate)
 *   6. Write artifacts to project_files (upsert)
 *   7. Compute workflow state from actual data
 *
 * @param projectId - UUID of the project
 * @param userId    - UUID of the authenticated user
 * @param force     - if true, always rebuild engineering model even if current
 */
export async function syncProjectPipeline(
  projectId: string,
  userId: string,
  force = false,
): Promise<PipelineResult> {
  const errors: string[] = [];
  pipelineStart(projectId, { force });

  // ── Stage 1: Load project ──────────────────────────────────────────────────
  stageStart('load_project', projectId);
  const project = await getProjectById(projectId, userId);
  if (!project) {
    const err = `Project not found: ${projectId}`;
    stageError('load_project', projectId, err);
    pipelineError(projectId, err);
    throw new Error(`[PIPELINE] ${err}`);
  }
  stageComplete('load_project', projectId, { projectName: project.name });

  // ── Stage 2: Load layout (canonical source) ────────────────────────────────
  stageStart('load_layout', projectId);
  const layout = await getLayoutByProject(projectId, userId);
  if (!layout || !layout.panels || layout.panels.length === 0) {
    const err = `No layout found for project ${projectId}. Design Studio must be used first.`;
    stageError('load_layout', projectId, err);
    pipelineError(projectId, err);
    throw new Error(`[PIPELINE] ${err}`);
  }

  const layoutPanelCount     = layout.panels.length;
  const layoutRoofPlaneCount = layout.roofPlanes?.length ?? 0;
  const layoutSystemSizeKw   = layout.systemSizeKw || parseFloat((layoutPanelCount * 0.4).toFixed(2));

  stageComplete('load_layout', projectId, {
    panelCount:      layoutPanelCount,
    roofPlaneCount:  layoutRoofPlaneCount,
    systemSizeKw:    layoutSystemSizeKw,
    layoutId:        layout.id,
    updatedAt:       layout.updatedAt,
  });

  // Keep legacy log code for backward compatibility with existing log searches
  console.log('[LAYOUT_LOADED]', {
    projectId,
    panelCount:     layoutPanelCount,
    roofPlaneCount: layoutRoofPlaneCount,
    systemSizeKw:   layoutSystemSizeKw,
    layoutId:       layout.id,
    updatedAt:      layout.updatedAt,
  });

  // ── Stage 3: Build design snapshot ────────────────────────────────────────
  stageStart('build_snapshot', projectId, { panelCount: layoutPanelCount });
  const snapshot = buildDesignSnapshot(project, layout);
  stageComplete('build_snapshot', projectId, { designVersionId: snapshot.designVersionId });

  // ── Stage 3b: Fetch satellite image (non-fatal) ──────────────────────────────────────────
  // Only fetch if snapshot doesn't already have a valid cached image
  if (!isSatelliteImageValid(snapshot.satelliteImageBase64)) {
    stageStart('fetch_satellite', projectId);
    try {
      // Error 5j fix: address is on Project type; siteAddress is on SiteOverview, not Project
      const address = project.address ?? project.name ?? '';
      const satResult = await fetchSatelliteImage({ address });
      if (!satResult.error) {
        snapshot.satelliteImageBase64 = satResult.imageBase64;
        snapshot.satelliteImageUrl    = satResult.imageUrl;
        snapshot.satelliteLat         = satResult.lat;
        snapshot.satelliteLng         = satResult.lng;
        stageComplete('fetch_satellite', projectId, {
          zoom:  satResult.zoom,
          lat:   satResult.lat,
          lng:   satResult.lng,
          bytes: satResult.imageBase64.length,
        });
      } else {
        stageComplete('fetch_satellite', projectId, { skipped: true, reason: satResult.error });
      }
    } catch (satErr: unknown) {
      // Non-fatal — satellite image is optional
      stageComplete('fetch_satellite', projectId, { skipped: true, reason: (satErr as Error)?.message });
    }
  } else {
    stageStart('fetch_satellite', projectId);
    stageComplete('fetch_satellite', projectId, { skipped: true, reason: 'cached' });
  }

  // ── Stage 4: Check staleness + rebuild if needed ───────────────────────────
  stageStart('engineering_sync', projectId, {
    designVersionId: snapshot.designVersionId,
    layoutPanelCount,
    force,
  });

  const isStale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
  let existingReport = await getEngineeringReport(projectId);
  let wasRebuilt = false;

  if (!existingReport || isStale || force) {
    const rebuildReason = !existingReport ? 'no_report' : isStale ? 'stale' : 'forced';

    console.log('[ENGINEERING_REBUILD_STARTED]', {
      projectId,
      reason:          rebuildReason,
      layoutPanelCount,
      designVersionId: snapshot.designVersionId,
    });
    stageStart('engineering_rebuild', projectId, {
      reason:          rebuildReason,
      layoutPanelCount,
      designVersionId: snapshot.designVersionId,
    });

    const reportId    = generateReportId();
    const _physData1  = await getProjectPhysicalData(projectId);
    existingReport    = generateEngineeringReport(snapshot, reportId, _physData1);
    await upsertEngineeringReport(existingReport, projectId);
    wasRebuilt = true;

    console.log('[ENGINEERING_REBUILD_COMPLETED]', {
      projectId,
      panelCount:    existingReport.systemSummary.panelCount,
      systemSizeKw:  existingReport.systemSummary.systemSizeKw,
      panelModel:    existingReport.systemSummary.panelModel,
      inverterModel: existingReport.systemSummary.inverterModel,
    });
    stageComplete('engineering_rebuild', projectId, {
      panelCount:    existingReport.systemSummary.panelCount,
      systemSizeKw:  existingReport.systemSummary.systemSizeKw,
      panelModel:    existingReport.systemSummary.panelModel,
      inverterModel: existingReport.systemSummary.inverterModel,
    });
  } else {
    stageComplete('engineering_sync', projectId, {
      status:       'current',
      panelCount:   existingReport.systemSummary.panelCount,
      systemSizeKw: existingReport.systemSummary.systemSizeKw,
    });
  }

  // ── Validate panel count sync (force-rebuild on mismatch) ──────────────────
  stageStart('validate_sync', projectId, {
    layoutPanelCount,
    engineeringPanelCount: existingReport!.systemSummary.panelCount,
  });

  const mismatches = validatePipelineSync(layoutPanelCount, existingReport!);
  for (const m of mismatches) {
    const msg = `[PIPELINE_MISMATCH] ${m.field}: layout=${m.layoutValue} engineering=${m.engineeringValue}`;
    if (m.severity === 'ERROR') {
      errors.push(msg);
      stageError('validate_sync', projectId, msg, { field: m.field, severity: m.severity });
      console.error(msg);
    } else {
      console.warn(msg);
    }
  }

  if (mismatches.length === 0) {
    stageComplete('validate_sync', projectId, { mismatches: 0 });
  }

  // Force rebuild on panel count mismatch
  if (mismatches.some(m => m.field === 'panelCount' && m.severity === 'ERROR')) {
    stageStart('engineering_force_rebuild', projectId, {
      reason:                'panel_count_mismatch',
      layoutPanelCount,
      engineeringPanelCount: existingReport!.systemSummary.panelCount,
    });
    console.error('[PIPELINE] Panel count mismatch — forcing engineering rebuild');

    const reportId2  = generateReportId();
    const _physData2 = await getProjectPhysicalData(projectId);
    existingReport   = generateEngineeringReport(snapshot, reportId2, _physData2);
    await upsertEngineeringReport(existingReport, projectId);
    wasRebuilt = true;

    stageComplete('engineering_force_rebuild', projectId, {
      panelCount:   layoutPanelCount,
      systemSizeKw: layoutSystemSizeKw,
    });
  }

  const report = existingReport!;

  // ── Stage 5 + 6: Build + write artifacts ──────────────────────────────────
  stageStart('write_artifacts', projectId, { panelCount: layoutPanelCount });

  let artifactsWritten = 0;
  const writtenFiles:  string[] = [];

  try {
    const sql       = await getDbReady();
    // Error 5j fix: clientId is on Project type; clientName should use project.client?.name
    const clientId  = project.clientId ?? null;
    const clientName = project.client?.name ?? project.name ?? 'Client';

    // Sanitize client name for filenames
    const clientSlug = clientName
      .replace(/[^a-zA-Z0-9\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 40) || 'Client';

    const reportDate = new Date().toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });

    const artifacts = buildAllArtifacts({
      report,
      projectId,
      clientName,
      clientSlug,
      reportDate,
      snapshot,   // pass snapshot so permit cover sheet gets satellite image
    });

    for (const artifact of artifacts) {
      const ok = await upsertFile(sql, {
        projectId,
        clientId,
        userId,
        fileName:  artifact.fileName,
        fileType:  artifact.fileType,
        mimeType:  artifact.mimeType,
        content:   artifact.content,
        notes:     artifact.notes,
      });
      if (ok) {
        artifactsWritten++;
        writtenFiles.push(artifact.fileName);
        console.log('[ARTIFACT_WRITTEN]', { projectId, fileName: artifact.fileName, fileType: artifact.fileType });
      } else {
        console.error('[ARTIFACT_WRITE_FAILED]', { projectId, fileName: artifact.fileName });
        errors.push(`Artifact write failed: ${artifact.fileName}`);
      }
    }

    stageComplete('write_artifacts', projectId, {
      artifactsWritten,
      files: writtenFiles,
    });
  } catch (artifactErr: unknown) {
    const msg = `Artifact stage failed: ${(artifactErr as Error).message}`;
    stageError('write_artifacts', projectId, msg);
    errors.push(msg);
    // Non-fatal — engineering model is valid even if artifact write fails
  }

  // ── Stage 7: Compute workflow state ───────────────────────────────────────
  stageStart('workflow_state', projectId);

  const workflow = {
    designComplete:      layoutPanelCount > 0,
    engineeringComplete: layoutPanelCount > 0 && !!report,
    artifactsReady:      artifactsWritten > 0,
  };

  stageComplete('workflow_state', projectId, workflow);

  // ── Done ──────────────────────────────────────────────────────────────────
  // ── Stage 8: Build + write canonicalSnapshot ──────────────────────────────────
  // This is the SINGLE SOURCE OF TRUTH written to projects.canonical_snapshot.
  // All downstream pages (proposal, engineering, planset) MUST read from here.
  // NO page is allowed to independently recalculate any of these values.
  stageStart('write_snapshot', projectId);

  // ── Validation gate (STEP 9 of directive) ──
  const validationErrors: string[] = [];
  if (layoutPanelCount === 0) validationErrors.push('panelCount=0');
  if (layoutSystemSizeKw <= 0) validationErrors.push('systemSizeKw<=0');
  if (!report.systemSummary?.inverterModel) validationErrors.push('inverter missing');
  const bomAttachments = Math.ceil((Math.ceil(layoutPanelCount * (1.134 * 3.281) / 4.0) * 2 * 4 * 12) / 48);
  if (bomAttachments <= 0) validationErrors.push('bom.attachments=0');

  if (validationErrors.length > 0) {
    console.warn('[VALIDATION_FAIL]', { projectId, ts: new Date().toISOString(), reasons: validationErrors });
  } else {
    console.log('[VALIDATION_PASS]', { projectId, ts: new Date().toISOString(), panelCount: layoutPanelCount, systemSizeKw: layoutSystemSizeKw });
  }

  const canonicalSnapshot = buildCanonicalSnapshot(snapshot, report, layoutPanelCount, layoutSystemSizeKw);

  // Write canonicalSnapshot to projects.canonical_snapshot (non-fatal)
  try {
    const snapshotSql = await getDbReady();
    await snapshotSql`
      UPDATE projects
      SET canonical_snapshot = ${JSON.stringify(canonicalSnapshot)}::jsonb,
          updated_at         = NOW()
      WHERE id      = ${projectId}
        AND user_id = ${userId}
    `;
    console.log('[SNAPSHOT_WRITTEN]', { projectId, ts: new Date().toISOString(), panelCount: layoutPanelCount, systemSizeKw: layoutSystemSizeKw, version: canonicalSnapshot.metadata.version });
    stageComplete('write_snapshot', projectId, { panelCount: layoutPanelCount, systemSizeKw: layoutSystemSizeKw });
  } catch (snapErr: unknown) {
    // Non-fatal: canonical_snapshot column may not exist yet — run /api/migrate to add it
    const msg = (snapErr as Error)?.message ?? String(snapErr);
    console.warn('[SNAPSHOT_WRITE_FAILED]', { projectId, reason: msg });
    stageComplete('write_snapshot', projectId, { skipped: true, reason: msg });
  }

  const result: PipelineResult = {
    success:              errors.length === 0,
    projectId,
    layoutLoaded:         true,
    layoutPanelCount,
    layoutRoofPlaneCount,
    layoutSystemSizeKw,
    layoutUpdatedAt:      layout.updatedAt,
    engineeringUpdated:   wasRebuilt,
    report,
    panelCount:           layoutPanelCount,   // always prefer layout count
    systemSizeKw:         layoutSystemSizeKw,
    panelModel:           report.systemSummary.panelModel,
    inverterModel:        report.systemSummary.inverterModel,
    artifactsWritten,
    files:                writtenFiles,
    workflow,
    wasRebuilt,
    designVersionId:      snapshot.designVersionId,
    canonicalSnapshot,
    errors,
  };

  pipelineComplete(projectId, {
    success:            result.success,
    panelCount:         result.panelCount,
    systemSizeKw:       result.systemSizeKw,
    wasRebuilt,
    artifactsWritten,
    files:              writtenFiles,
    workflowDesign:     workflow.designComplete,
    workflowEng:        workflow.engineeringComplete,
    workflowArtifacts:  workflow.artifactsReady,
    errors:             errors.length,
  });

  return result;
}

/**
 * Validate that layout and engineering model are in sync.
 */
function validatePipelineSync(
  layoutPanelCount: number,
  report: EngineeringReport
): PipelineMismatch[] {
  const mismatches: PipelineMismatch[] = [];
  const engPanelCount = report.systemSummary.panelCount;

  if (layoutPanelCount > 0 && engPanelCount !== layoutPanelCount) {
    mismatches.push({
      field:            'panelCount',
      layoutValue:      layoutPanelCount,
      engineeringValue: engPanelCount,
      severity:         'ERROR',
    });
  }

  return mismatches;
}