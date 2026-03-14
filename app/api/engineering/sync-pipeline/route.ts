// ============================================================
// GET /api/engineering/sync-pipeline?projectId=xxx
// 
// Single endpoint that orchestrates the complete pipeline:
// DB layout → engineering model → returns canonical state
//
// Called by engineering page on load and by permit preflight.
// Returns the authoritative engineered project state.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getLayoutByProject, getProjectById, handleRouteDbError } from '@/lib/db-neon';
import { syncProjectPipeline } from '@/lib/engineering/syncPipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    // Run full pipeline sync
    const result = await syncProjectPipeline(projectId, user.id);

    // PERMIT_PREFLIGHT log
    console.log('[PERMIT_PREFLIGHT]', {
      projectId,
      layoutPanelCount:      result.layoutPanelCount,
      layoutRoofPlaneCount:  result.layoutRoofPlaneCount,
      layoutSystemSizeKw:    result.layoutSystemSizeKw,
      engineeringPanelCount: result.report.systemSummary.panelCount,
      engineeringSystemKw:   result.report.systemSummary.systemSizeKw,
      panelModel:            result.panelModel,
      inverterModel:         result.inverterModel,
      wasRebuilt:            result.wasRebuilt,
      errors:                result.errors,
    });

    return NextResponse.json({
      success: true,
      data: {
        // Layout ground truth
        layout: {
          panelCount:     result.layoutPanelCount,
          roofPlaneCount: result.layoutRoofPlaneCount,
          systemSizeKw:   result.layoutSystemSizeKw,
          updatedAt:      result.layoutUpdatedAt,
        },
        // Engineering model
        engineering: {
          panelCount:   result.panelCount,
          systemSizeKw: result.systemSizeKw,
          panelModel:   result.panelModel,
          inverterModel: result.inverterModel,
          report:       result.report,
        },
        // Pipeline metadata
        wasRebuilt:      result.wasRebuilt,
        designVersionId: result.designVersionId,
        errors:          result.errors,
        hasErrors:       result.errors.length > 0,
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Check if it's a "no layout" error — return structured response not 500
    if (msg.includes('No layout found')) {
      return NextResponse.json({
        success: false,
        error: 'NO_LAYOUT',
        message: msg,
        needsDesign: true,
      }, { status: 404 });
    }
    return handleRouteDbError('[sync-pipeline]', err);
  }
}