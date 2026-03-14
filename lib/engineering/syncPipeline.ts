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

  // Step 1: Load project
  const project = await getProjectById(projectId, userId);
  if (!project) {
    throw new Error(`[PIPELINE] Project not found: ${projectId}`);
  }

  // Step 2: Load layout — this is the canonical source
  const layout = await getLayoutByProject(projectId, userId);
  if (!layout || !layout.panels || layout.panels.length === 0) {
    throw new Error(`[PIPELINE] No layout found for project ${projectId}. Design Studio must be used first.`);
  }

  const layoutPanelCount = layout.panels.length;
  const layoutRoofPlaneCount = layout.roofPlanes?.length ?? 0;
  const layoutSystemSizeKw = layout.systemSizeKw || parseFloat((layoutPanelCount * 0.4).toFixed(2));

  console.log('[LAYOUT_LOADED]', {
    projectId,
    panelCount: layoutPanelCount,
    roofPlaneCount: layoutRoofPlaneCount,
    systemSizeKw: layoutSystemSizeKw,
    layoutId: layout.id,
    updatedAt: layout.updatedAt,
  });

  // Step 3: Build design snapshot from layout
  const snapshot = buildDesignSnapshot(project, layout);

  // Step 4: Check if engineering report is stale
  const isStale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
  let existingReport = await getEngineeringReport(projectId);

  let wasRebuilt = false;

  if (!existingReport || isStale) {
    console.log('[ENGINEERING_REBUILD_STARTED]', {
      projectId,
      reason: !existingReport ? 'no_report' : 'stale',
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
  }

  const report = existingReport!;

  // Step 5: Validate — layout must match engineering model
  const mismatches = validatePipelineSync(layoutPanelCount, report);
  for (const m of mismatches) {
    const msg = `[PIPELINE_MISMATCH] ${m.field}: layout=${m.layoutValue} engineering=${m.engineeringValue}`;
    if (m.severity === 'ERROR') {
      errors.push(msg);
      console.error(msg);
    } else {
      console.warn(msg);
    }
  }

  // Step 6: If mismatch on panel count, force rebuild
  if (mismatches.some(m => m.field === 'panelCount' && m.severity === 'ERROR')) {
    console.error('[PIPELINE] Panel count mismatch — forcing engineering rebuild');
    const reportId2 = generateReportId();
    const rebuilt = generateEngineeringReport(snapshot, reportId2);
    await upsertEngineeringReport(rebuilt, projectId);
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