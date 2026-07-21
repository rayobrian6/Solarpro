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
import { equipmentPanelToTypesPanel } from '@/lib/system/selectedEquipment';
import { designSubSystemBlocks } from '@/lib/system/designToEngineering';

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
    // P0-7 (DATA-AUTHORITY-AUDIT): this stamp sum is only the FALLBACK input —
    // upsertLayout owns the nameplate rule (subSystems map → equipment-db watts)
    // and overrides it for map-carrying projects. The authoritative value is
    // read back from savedLayout below and used everywhere downstream.
    const avgWatts = totalPanels > 0
      ? (panels as any[]).reduce((s: number, p: any) => s + (typeof p.wattage === 'number' ? p.wattage : 400), 0) / totalPanels
      : 400;
    const stampSizeKw = parseFloat((totalPanels * avgWatts / 1000).toFixed(2));

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
      systemSizeKw: stampSizeKw,
      mapCenter:  mapCenter  ?? existingLayout?.mapCenter,
      mapZoom:    mapZoom    ?? existingLayout?.mapZoom,
      designElectrical: designElectrical ?? (existingLayout as any)?.designElectrical,
    });

    // P0-7: the nameplate function inside upsertLayout is the ONE owner of
    // system size — everything downstream (logs, version snapshot, response)
    // reports what was actually persisted, never a second derivation.
    const systemSizeKw = savedLayout.systemSizeKw ?? stampSizeKw;

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

    // ── Full-duplex Design→Engineering: write the canonical panel ───────────────
    // The design auto-save is the reliable persist path (the production route only
    // fires when kW changes). When the design's panel differs from the canonical
    // selected_equipment (i.e. the designer changed it), write canonical — the
    // single source of truth that BOTH pages read (design on mount, engineering via
    // the canonical-panel reconciliation effect). Compared against canonical (not the
    // previous layout) so a diverged pair converges. Non-fatal.
    //
    // Wave 4A (contract §1.3/I-4): when the design carries a v2 per-sub split
    // (designElectrical.subSystems with >1 panel-bearing blocks), the old
    // PROJECT-WIDE panelId promotion is retired for this project. Instead:
    //  • each sub's equipment lands in selected_equipment.subSystems[key]
    //    (schemaVersion 2; upsertSelectedEquipment deep-merges per key), and
    //  • the flat panel write is SCOPED TO THE PRIMARY sub (blocks[0], fixed
    //    roof > ground > fence — §1.4): the flat mirror moves only when the
    //    PRIMARY sub's panel changed. This is deliberately NOT dropped: the
    //    engineering page's canonical-panel reconcile (page.tsx:2432, Wave
    //    3.3) re-pins exactly the primary sub's strings from the flat id with
    //    a composite `${key}:${panelId}` ref-guard — a primary-scoped flat
    //    write cooperates with it, while non-primary subs sync through the
    //    map, never through flat promotion.
    try {
      // Body's designElectrical ONLY (like the legacy write) — a layout save
      // that didn't re-author the electrical design must never re-promote a
      // stored design panel over a later engineering-side choice.
      const de = designElectrical as import('@/types').DesignElectrical | undefined;
      const blocks = designSubSystemBlocks(de);
      if (blocks) {
        const nowIso = new Date().toISOString();
        const subs: Record<string, unknown> = {};
        for (const b of blocks) {
          if (!b.panelId || !getPanelById(b.panelId)) continue; // resolvable ids only
          subs[b.key] = {
            key: b.key,
            panelId: b.panelId,
            ...(b.topology ? { topology: b.topology } : {}),
            ...(b.rackingId ? { mountingId: b.rackingId } : {}),
            source: 'design',
            updatedAt: nowIso,
          };
        }
        if (Object.keys(subs).length > 0) {
          const patch: Record<string, unknown> = {
            schemaVersion: 2, subSystems: subs, source: 'design', updatedAt: nowIso,
          };
          const primary = blocks[0];
          if (primary.panelId && subs[primary.key] && primary.panelId !== project.selectedPanel?.id) {
            const panel = getPanelById(primary.panelId);
            if (panel) {
              patch.panelId = panel.id;
              patch.panel = equipmentPanelToTypesPanel(panel);
            }
          }
          await upsertSelectedEquipment(projectId, user.id, patch);
          console.log('[layout/route] design subSystems → canonical (per-sub scoped)', {
            projectId, keys: Object.keys(subs), flatPanel: patch.panelId ?? null,
          });
        }
      } else {
        // Single-type design — legacy flat write, byte-identical.
        const newPanelId = de?.panelId as string | undefined;
        if (newPanelId && newPanelId !== project.selectedPanel?.id) {
          const panel = getPanelById(newPanelId);
          if (panel) {
            await upsertSelectedEquipment(projectId, user.id, {
              panelId: panel.id,
              panel: equipmentPanelToTypesPanel(panel),
              source: 'design',
              updatedAt: new Date().toISOString(),
            });
            console.log('[layout/route] design panel → canonical', { projectId, newPanelId });
          }
        }
      }
    } catch (propErr: unknown) {
      console.warn('[layout/route] design panel canonical write skipped (non-fatal):', (propErr as Error)?.message);
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