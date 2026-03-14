// ============================================================
// syncProjectPipeline — Single orchestration point
// Reads layout from DB → rebuilds engineering model → returns
// canonical EngineeredProject for use by engineering page,
// permit generator, and artifact generation.
// ============================================================

import { getLayoutByProject, getProjectById } from '@/lib/db-neon';
import { buildDesignSnapshot } from './designSnapshot';
import { generateEngineeringReport } from './reportGenerator';
import {
  getEngineeringReport,
  upsertEngineeringReport,
  generateReportId,
  isEngineeringReportStale,
} from './db-engineering';
import type { EngineeringReport } from './types';

export interface PipelineResult {
  // Layout ground truth
  layoutPanelCount: number;
  layoutRoofPlaneCount: number;
  layoutSystemSizeKw: number;
  layoutUpdatedAt: string;

  // Engineering model (derived from layout)
  report: EngineeringReport;
  panelCount: number;        // canonical
  systemSizeKw: number;      // canonical
  panelModel: string;
  inverterModel: string;

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

function stageStart(stage: string, projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_STAGE_START]', { stage, projectId, ...meta });
}

function stageComplete(stage: string, projectId: string, meta?: Record<string, unknown>) {
  console.log('[PIPELINE_STAGE_COMPLETE]', { stage, projectId, ...meta });
}

function stageError(stage: string, projectId: string, error: string, meta?: Record<string, unknown>) {
  console.error('[PIPELINE_STAGE_ERROR]', { stage, projectId, error, ...meta });
}

/**
 * Sync the full project pipeline:
 * 1. Read latest layout from DB
 * 2. Build/rebuild engineering model if stale
 * 3. Return canonical EngineeredProject
 *
 * This is the authoritative source of truth for:
 * - panel count
 * - system size
 * - roof segments
 * - equipment model strings
 */
export async function syncProjectPipeline(
  projectId: string,
  userId: string
): Promise<PipelineResult> {
  const errors: string[] = [];

  // ── Stage 1: Load project ─────────────────────────────────────────────────
  stageStart('load_project', projectId);
  const project = await getProjectById(projectId, userId);
  if (!project) {
    const err = `Project not found: ${projectId}`;
    stageError('load_project', projectId, err);
    throw new Error(`[PIPELINE] ${err}`);
  }
  stageComplete('load_project', projectId, { projectName: project.name });

  // ── Stage 2: Load layout (canonical source) ───────────────────────────────
  stageStart('load_layout', projectId);
  const layout = await getLayoutByProject(projectId, userId);
  if (!layout || !layout.panels || layout.panels.length === 0) {
    const err = `No layout found for project ${projectId}. Design Studio must be used first.`;
    stageError('load_layout', projectId, err);
    throw new Error(`[PIPELINE] ${err}`);
  }

  const layoutPanelCount = layout.panels.length;
  const layoutRoofPlaneCount = layout.roofPlanes?.length ?? 0;
  const layoutSystemSizeKw = layout.systemSizeKw || parseFloat((layoutPanelCount * 0.4).toFixed(2));

  stageComplete('load_layout', projectId, {
    panelCount: layoutPanelCount,
    roofPlaneCount: layoutRoofPlaneCount,
    systemSizeKw: layoutSystemSizeKw,
    layoutId: layout.id,
    updatedAt: layout.updatedAt,
  });

  // Keep legacy log code for backward compatibility with existing log searches
  console.log('[LAYOUT_LOADED]', {
    projectId,
    panelCount: layoutPanelCount,
    roofPlaneCount: layoutRoofPlaneCount,
    systemSizeKw: layoutSystemSizeKw,
    layoutId: layout.id,
    updatedAt: layout.updatedAt,
  });

  // ── Stage 3: Build design snapshot ───────────────────────────────────────
  stageStart('build_snapshot', projectId, { panelCount: layoutPanelCount });
  const snapshot = buildDesignSnapshot(project, layout);
  stageComplete('build_snapshot', projectId, { designVersionId: snapshot.designVersionId });

  // ── Stage 4: Check staleness + rebuild if needed ──────────────────────────
  stageStart('engineering_sync', projectId, {
    designVersionId: snapshot.designVersionId,
    layoutPanelCount,
  });

  const isStale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
  let existingReport = await getEngineeringReport(projectId);
  let wasRebuilt = false;

  if (!existingReport || isStale) {
    const rebuildReason = !existingReport ? 'no_report' : 'stale';

    // Keep legacy log codes for backward compatibility
    console.log('[ENGINEERING_REBUILD_STARTED]', {
      projectId,
      reason: rebuildReason,
      layoutPanelCount,
      designVersionId: snapshot.designVersionId,
    });
    stageStart('engineering_rebuild', projectId, {
      reason: rebuildReason,
      layoutPanelCount,
      designVersionId: snapshot.designVersionId,
    });

    const reportId = generateReportId();
    existingReport = generateEngineeringReport(snapshot, reportId);
    await upsertEngineeringReport(existingReport, projectId);
    wasRebuilt = true;

    console.log('[ENGINEERING_REBUILD_COMPLETED]', {
      projectId,
      panelCount: existingReport.systemSummary.panelCount,
      systemSizeKw: existingReport.systemSummary.systemSizeKw,
      panelModel: existingReport.systemSummary.panelModel,
      inverterModel: existingReport.systemSummary.inverterModel,
    });
    stageComplete('engineering_rebuild', projectId, {
      panelCount: existingReport.systemSummary.panelCount,
      systemSizeKw: existingReport.systemSummary.systemSizeKw,
      panelModel: existingReport.systemSummary.panelModel,
      inverterModel: existingReport.systemSummary.inverterModel,
    });
  } else {
    stageComplete('engineering_sync', projectId, {
      status: 'current',
      panelCount: existingReport.systemSummary.panelCount,
      systemSizeKw: existingReport.systemSummary.systemSizeKw,
    });
  }

  const report = existingReport!;

  // ── Stage 5: Validate pipeline sync ──────────────────────────────────────
  stageStart('validate_sync', projectId, {
    layoutPanelCount,
    engineeringPanelCount: report.systemSummary.panelCount,
  });

  const mismatches = validatePipelineSync(layoutPanelCount, report);
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

  // ── Stage 6: Force rebuild on panel count mismatch ────────────────────────
  if (mismatches.some(m => m.field === 'panelCount' && m.severity === 'ERROR')) {
    stageStart('engineering_force_rebuild', projectId, {
      reason: 'panel_count_mismatch',
      layoutPanelCount,
      engineeringPanelCount: report.systemSummary.panelCount,
    });
    console.error('[PIPELINE] Panel count mismatch — forcing engineering rebuild');

    const reportId2 = generateReportId();
    const rebuilt = generateEngineeringReport(snapshot, reportId2);
    await upsertEngineeringReport(rebuilt, projectId);

    stageComplete('engineering_force_rebuild', projectId, {
      panelCount: layoutPanelCount,
      systemSizeKw: layoutSystemSizeKw,
    });

    return {
      layoutPanelCount,
      layoutRoofPlaneCount,
      layoutSystemSizeKw,
      layoutUpdatedAt: layout.updatedAt,
      report: rebuilt,
      panelCount: layoutPanelCount,
      systemSizeKw: layoutSystemSizeKw,
      panelModel: rebuilt.systemSummary.panelModel,
      inverterModel: rebuilt.systemSummary.inverterModel,
      wasRebuilt: true,
      designVersionId: snapshot.designVersionId,
      errors,
    };
  }

  return {
    layoutPanelCount,
    layoutRoofPlaneCount,
    layoutSystemSizeKw,
    layoutUpdatedAt: layout.updatedAt,
    report,
    panelCount: layoutPanelCount,   // always prefer layout count
    systemSizeKw: layoutSystemSizeKw,
    panelModel: report.systemSummary.panelModel,
    inverterModel: report.systemSummary.inverterModel,
    wasRebuilt,
    designVersionId: snapshot.designVersionId,
    errors,
  };
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
      field: 'panelCount',
      layoutValue: layoutPanelCount,
      engineeringValue: engPanelCount,
      severity: 'ERROR',
    });
  }

  return mismatches;
}