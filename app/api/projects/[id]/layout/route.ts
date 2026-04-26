export const dynamic   = 'force-dynamic';
export const runtime   = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion, handleRouteDbError, getDbReady } from '@/lib/db-neon';
import { syncProjectPipeline } from '@/lib/engineering/syncPipeline';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const projectId = id;
    const project = await getProjectById(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const body = await req.json();
    const {
      panels, mapCenter, mapZoom, systemType,
      roofPlanes, groundTilt, groundAzimuth, rowSpacing, groundHeight,
      fenceAzimuth, fenceHeight, fenceLine, bifacialOptimized,
      changeSummary
    } = body;

    // STEP 2 -- API RECEIVED LAYOUT LOGGING
    console.log('[API RECEIVED LAYOUT]', {
      projectId,
      panelCount:     Array.isArray(panels)    ? panels.length    : 'NOT_ARRAY',
      roofPlaneCount: Array.isArray(roofPlanes) ? roofPlanes.length : (roofPlanes === undefined ? 'undefined' : 'NOT_ARRAY'),
      hasRoofPlanes:  Array.isArray(roofPlanes) && roofPlanes.length > 0,
      systemType,
      mapCenter,
    });

    if (!panels || !Array.isArray(panels)) {
      return NextResponse.json({ success: false, error: 'panels array required' }, { status: 400 });
    }

    // Get existing layout for defaults
    const existingLayout = await getLayoutByProject(projectId, user.id);

    const totalPanels  = panels.length;
    // v47.161: Use actual panel wattage from the panels array instead of hardcoded 400W.
    // Fence panels (Philadelphia Solar 430W) and custom panels were previously under-reported.
    const avgWatts = totalPanels > 0
      ? (panels as any[]).reduce((s: number, p: any) => s + (typeof p.wattage === 'number' ? p.wattage : 400), 0) / totalPanels
      : 400;
    const systemSizeKw = parseFloat((totalPanels * avgWatts / 1000).toFixed(2));

    // UPSERT layout — never destructive
    // FIX v47.318: Priority order for systemType:
    //   1. systemType from request body (most specific — user just chose this)
    //   2. project.systemType from DB projects table (authoritative project record)
    //   3. existingLayout.systemType — BUT only if it's not 'roof' (the default/fallback)
    //      because rowToLayout() defaults NULL to 'roof', which would hide fence/ground projects
    //   4. Final fallback: 'roof'
    const existingLayoutSysType = existingLayout?.systemType;
    const resolvedSysType = systemType
      || (project.systemType && project.systemType !== 'roof' ? project.systemType : undefined)
      || (existingLayoutSysType && existingLayoutSysType !== 'roof' ? existingLayoutSysType : undefined)
      || project.systemType
      || 'roof';
    const savedLayout = await upsertLayout({
      projectId,
      userId:     user.id,
      systemType: resolvedSysType,
      panels,
      roofPlanes:         roofPlanes         ?? existingLayout?.roofPlanes,
      groundTilt:         groundTilt         ?? existingLayout?.groundTilt         ?? 20,
      groundAzimuth:      groundAzimuth      ?? existingLayout?.groundAzimuth      ?? 180,
      rowSpacing:         rowSpacing         ?? existingLayout?.rowSpacing         ?? 1.5,
      groundHeight:       groundHeight       ?? existingLayout?.groundHeight       ?? 0.6,
      fenceAzimuth:       fenceAzimuth       ?? existingLayout?.fenceAzimuth,
      fenceHeight:        fenceHeight        ?? existingLayout?.fenceHeight,
      fenceLine:          fenceLine          ?? existingLayout?.fenceLine,
      bifacialOptimized:  bifacialOptimized  ?? existingLayout?.bifacialOptimized  ?? false,
      totalPanels,
      systemSizeKw,
      mapCenter:  mapCenter  ?? existingLayout?.mapCenter,
      mapZoom:    mapZoom    ?? existingLayout?.mapZoom,
    });

    // STEP 3 -- DB WRITE CONFIRMATION LOGGING
    console.log('[LAYOUT SAVED TO DB]', {
      projectId,
      layoutId:       savedLayout.id,
      panelCount:     savedLayout.panels?.length ?? 0,
      roofPlaneCount: savedLayout.roofPlanes?.length ?? 0,
      hasRoofPlanes:  !!(savedLayout.roofPlanes && savedLayout.roofPlanes.length > 0),
      systemSizeKw,
    });

    // FIX v47.218 / v47.318: Sync projects.system_type with the layout's resolved system type
    // This repairs any project where system_type was corrupted (e.g., wrongly set to 'roof')
    // Only update if systemType differs from what's already in the project row
    // FIX v47.318: Use resolvedSysType (already computed above with correct priority)
    const resolvedSystemType = resolvedSysType;
    if (resolvedSystemType && resolvedSystemType !== project.systemType) {
      console.log(`[layout/route] Syncing project system_type: ${project.systemType} → ${resolvedSystemType}`);
      try {
        const sql = await getDbReady();
        await sql`
          UPDATE projects SET system_type = ${resolvedSystemType}, updated_at = NOW()
          WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
        `;
      } catch (syncErr) {
        console.error('[layout/route] Failed to sync project system_type (non-critical):', syncErr);
      }
    }

    // Save version snapshot (async, non-blocking for response)
    saveProjectVersion({
      projectId,
      userId: user.id,
      snapshot: {
        projectId,
        projectName: project.name,
        layout:      savedLayout,
        savedAt:     new Date().toISOString(),
      },
      panelsCount:   totalPanels,
      systemSizeKw,
      changeSummary: changeSummary || `Saved ${totalPanels} panels (${systemSizeKw} kW)`,
    }).catch(err => console.error('[version snapshot]', err));

    // ── Run full pipeline synchronously ───────────────────────────────────────
    // Replaces the old setTimeout fire-and-forget pattern.
    // syncProjectPipeline is the canonical orchestrator:
    //   1. Loads the newly saved layout
    //   2. Rebuilds engineering model if stale
    //   3. Writes all artifact files to project_files
    //   4. Returns structured result
    let pipelineResult = null;
    if (totalPanels > 0) {
      try {
        pipelineResult = await syncProjectPipeline(projectId, user.id);
        console.log('[layout/route] Pipeline completed:', {
          projectId,
          panelCount:       pipelineResult.panelCount,
          artifactsWritten: pipelineResult.artifactsWritten,
          wasRebuilt:       pipelineResult.wasRebuilt,
          errors:           pipelineResult.errors.length,
        });
      } catch (pipelineErr: unknown) {
        // Non-fatal: layout was saved successfully; log and continue
        console.error('[layout/route] Pipeline failed (non-critical):', pipelineErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        projectId,
        layoutId:     savedLayout.id,
        panelCount:   totalPanels,
        systemSizeKw,
        savedAt:      new Date().toISOString(),
        pipeline:     pipelineResult ? {
          wasRebuilt:       pipelineResult.wasRebuilt,
          artifactsWritten: pipelineResult.artifactsWritten,
          files:            pipelineResult.files,
          errors:           pipelineResult.errors,
        } : null,
      },
    });
  } catch (error: unknown) {
    return handleRouteDbError('[POST /api/pr', error);
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const project = await getProjectById(id, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const layout = await getLayoutByProject(id, user.id);
    return NextResponse.json({ success: true, data: layout });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/pr', error);
  }
}