// ============================================================
// GET /api/debug/project?id=<projectId>
// Full project pipeline state diagnostic endpoint.
// Returns: layout summary, engineering summary, artifact registry,
//          workflow state, permit inputs summary.
// Protected: requires valid session + project ownership.
// ============================================================

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, getProjectById, getLayoutByProject, handleRouteDbError } from '@/lib/db-neon';
import { getEngineeringReport } from '@/lib/engineering/db-engineering';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const projectId = req.nextUrl.searchParams.get('id') || req.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ success: false, error: 'id or projectId parameter required' }, { status: 400 });
    }

    const sql = await getDbReady();

    // ── 1. Project ──────────────────────────────────────────────────────
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found or access denied' }, { status: 404 });
    }

    // ── 2. Layout ───────────────────────────────────────────────────────
    const layout = await getLayoutByProject(projectId, user.id);
    const panelCount     = layout?.panels?.length ?? 0;
    const roofPlaneCount = layout?.roofPlanes?.length ?? 0;
    const systemSizeKw   = layout?.systemSizeKw ?? parseFloat((panelCount * 0.4).toFixed(2));

    const layoutSummary = {
      exists:      !!layout,
      id:          layout?.id ?? null,
      panels:      panelCount,
      roofPlanes:  roofPlaneCount,
      systemSizeKw,
      systemType:  layout?.systemType ?? null,
      updatedAt:   layout?.updatedAt ?? null,
      // First 3 panels for spot-check
      samplePanels: (layout?.panels as any[])?.slice(0, 3).map((p: any) => ({
        id: p.id, lat: p.lat, lng: p.lng, tilt: p.tilt, azimuth: p.azimuth,
      })) ?? [],
    };

    // ── 3. Engineering model ────────────────────────────────────────────
    const engReport = await getEngineeringReport(projectId);
    const designVersionId = layout ? buildDesignSnapshot(project, layout).designVersionId : null;

    const engineeringSummary = {
      exists:          !!engReport,
      panelCount:      engReport?.systemSummary?.panelCount ?? 0,
      systemSizeKw:    engReport?.systemSummary?.systemSizeKw ?? 0,
      panelModel:      engReport?.systemSummary?.panelModel ?? null,
      inverterModel:   engReport?.systemSummary?.inverterModel ?? null,
      designVersionId: engReport?.designVersionId ?? null,
      currentVersionId: designVersionId,
      isStale:         !!(designVersionId && engReport?.designVersionId && designVersionId !== engReport.designVersionId),
      inverters:       engReport?.equipmentSchedule?.inverters?.length ?? 0,
    };

    // ── 4. Artifact registry ────────────────────────────────────────────
    let artifactFiles: any[] = [];
    try {
      artifactFiles = await sql`
        SELECT id, file_name, file_type, file_size, upload_date, engineering_run_id
        FROM project_files
        WHERE project_id = ${projectId} AND user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    } catch {
      artifactFiles = await sql`
        SELECT id, file_name, file_type, file_size, upload_date
        FROM project_files
        WHERE project_id = ${projectId} AND user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    }

    const artifactRegistry = {
      totalFiles: artifactFiles.length,
      files:      artifactFiles.map((f: any) => ({
        id:               f.id,
        name:             f.file_name,
        type:             f.file_type,
        sizeBytes:        f.file_size,
        uploadDate:       f.upload_date,
        engineeringRunId: f.engineering_run_id ?? null,
      })),
      hasBom:              artifactFiles.some((f: any) => f.file_name?.includes('BOM')),
      hasSld:              artifactFiles.some((f: any) => f.file_name?.includes('SLD')),
      hasEngineeringReport:artifactFiles.some((f: any) => f.file_name?.includes('Engineering')),
      hasPermitPacket:     artifactFiles.some((f: any) => f.file_name?.includes('Permit')),
      hasSystemEstimate:   artifactFiles.some((f: any) => f.file_name?.includes('Estimate')),
    };

    // ── 5. Permit inputs summary ────────────────────────────────────────
    const permitInputs = {
      totalPanels:    panelCount,
      systemDcKw:     systemSizeKw,
      panelModel:     engReport?.systemSummary?.panelModel ?? 'Not set',
      inverterModel:  engReport?.systemSummary?.inverterModel ?? 'Not set',
      address:        (project as any).address ?? (project as any).bill_data?._address ?? 'Not set',
      city:           (project as any).city ?? (project as any).bill_data?._city ?? 'Not set',
      stateCode:      (project as any).stateCode ?? (project as any).bill_data?._stateCode ?? 'Not set',
      roofPlanes:     roofPlaneCount,
      sheetsExpected: 13,
      blocked:        panelCount === 0,
      blockedReason:  panelCount === 0 ? 'ENGINEERING_MODEL_STALE: totalPanels=0' : null,
    };

    // ── 6. Workflow state ───────────────────────────────────────────────
    const workflowState = {
      designComplete:      panelCount > 0,
      engineeringComplete: panelCount > 0 && !!engReport,
      permitReady:         panelCount > 0,
      filesReady:          artifactFiles.length > 0,
      note:                'Completion derived from actual data — not project.status field',
    };

    // ── 7. Mismatch detection ───────────────────────────────────────────
    const mismatches: Array<{ field: string; layoutValue: any; engineeringValue: any; code: string }> = [];

    if (panelCount > 0 && engReport && engReport.systemSummary.panelCount !== panelCount) {
      mismatches.push({
        code:             'PIPELINE_MISMATCH_ENGINEERING_MODEL_STALE',
        field:            'panelCount',
        layoutValue:      panelCount,
        engineeringValue: engReport.systemSummary.panelCount,
      });
    }

    if (artifactFiles.length > 0 && artifactFiles.length < 5) {
      mismatches.push({
        code:             'PIPELINE_ARTIFACT_REGISTRY_OUT_OF_SYNC',
        field:            'artifactRegistry',
        layoutValue:      5,
        engineeringValue: artifactFiles.length,
      });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      projectId,
      projectName: (project as any).name ?? projectId,
      layout:      layoutSummary,
      engineering: engineeringSummary,
      artifacts:   artifactRegistry,
      permitInputs,
      workflow:    workflowState,
      mismatches,
    });

  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/debug/project]', err);
  }
}