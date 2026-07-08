export const dynamic   = 'force-dynamic';
export const runtime   = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion, handleRouteDbError, getDbReady, isValidUUID, upsertSelectedEquipment } from '@/lib/db-neon';
import { syncProjectPipeline } from '@/lib/engineering/syncPipeline';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { getPanelById } from '@/lib/equipment-db';
import { equipmentPanelToTypesPanel, applyPanelToEngineeringConfig } from '@/lib/system/selectedEquipment';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
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
      designElectrical,
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
      designElectrical: designElectrical ?? (existingLayout as any)?.designElectrical,
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

    // ── Full-duplex Design→Engineering: propagate a DESIGN panel change ─────────
    // The design auto-save is the reliable persist path (the production route only
    // fires when kW changes). When the designer changes the PANEL, flow it into (1)
    // the canonical selected_equipment store (design's source of truth, also drives
    // the pipeline rebuild below) and (2) the saved engineering_config's per-string
    // panelId, so the Engineering page reflects it on next load. Guarded on an
    // ACTUAL change vs the previous design panel, so merely moving panels never
    // clobbers a deliberate engineering-only panel choice. Non-fatal.
    try {
      const newPanelId = designElectrical?.panelId as string | undefined;
      const prevPanelId = (existingLayout as { designElectrical?: { panelId?: string } } | null)?.designElectrical?.panelId;
      if (newPanelId && newPanelId !== prevPanelId) {
        const panel = getPanelById(newPanelId);
        if (panel) {
          await upsertSelectedEquipment(projectId, user.id, {
            panelId: panel.id,
            panel: equipmentPanelToTypesPanel(panel),
            source: 'design',
            updatedAt: new Date().toISOString(),
          });
        }
        const updatedCfg = applyPanelToEngineeringConfig(project.engineeringConfig, newPanelId);
        if (updatedCfg) {
          const sql = await getDbReady();
          await sql`
            UPDATE projects
            SET engineering_config = ${JSON.stringify(updatedCfg)}::jsonb, engineering_updated_at = NOW()
            WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
          `;
        }
        console.log('[layout/route] design panel change propagated', { projectId, newPanelId, engConfigUpdated: !!updatedCfg });
      }
    } catch (propErr: unknown) {
      console.warn('[layout/route] design panel propagation skipped (non-fatal):', (propErr as Error)?.message);
    }

    // Save version snapshot (async, non-blocking for response).
    // PERF FIX: Strip heavy per-panel computed fields (ECEF vectors, legacy pixel coords)
    // before storing. These are re-computed at render time and bloat each snapshot row.
    // We retain all fields needed for restore: lat/lng, tilt, azimuth, wattage, planeId,
    // gridRow/gridCol, orientation, systemType, arrayId, and the metric coordinate fields.
    const trimmedPanels = (savedLayout.panels ?? []).map((p) => ({
      id: p.id,
      layoutId: p.layoutId,
      lat: p.lat,
      lng: p.lng,
      xFeet: p.xFeet,
      yFeet: p.yFeet,
      widthFeet: p.widthFeet,
      heightFeet: p.heightFeet,
      tilt: p.tilt,
      azimuth: p.azimuth,
      wattage: p.wattage,
      bifacialGain: p.bifacialGain,
      row: p.row,
      col: p.col,
      systemType: p.systemType,
      arrayId: p.arrayId,
      orientation: p.orientation,
      planeId: p.planeId,
      gridRow: p.gridRow,
      gridCol: p.gridCol,
      placementType: p.placementType,
      layoutSource: p.layoutSource,
      // Note: ecefNx/Ny/Nz, ecefUx/Uy/Uz, x, y, xMeters, yMeters intentionally omitted
      // (re-computed at render time — not needed for version restore)
    }));
    const trimmedLayout = { ...savedLayout, panels: trimmedPanels };
    saveProjectVersion({
      projectId,
      userId: user.id,
      snapshot: {
        projectId,
        projectName: project.name,
        layout:      trimmedLayout,
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
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
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