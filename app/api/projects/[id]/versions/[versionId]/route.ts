export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getProjectVersion, upsertLayout, saveProjectVersion , handleRouteDbError, isValidUUID} from '@/lib/db-neon';
import { Layout } from '@/types';
import { repairPanelElevations } from '@/lib/surfaceGeometry3D';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type RouteContext = { params: Promise<{id: string; versionId: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id, versionId } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
    if (!isValidUUID(versionId)) {
      return NextResponse.json({ success: false, error: 'Invalid version ID format.' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const project = await getProjectById(id, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const version = await getProjectVersion(id, versionId, user.id);
    if (!version) return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });

    return NextResponse.json({ success: true, data: version });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/pr', err);
  }
}

// POST to restore a version
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id, versionId } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
    if (!isValidUUID(versionId)) {
      return NextResponse.json({ success: false, error: 'Invalid version ID format.' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

    const project = await getProjectById(id, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const version = await getProjectVersion(id, versionId, user.id);
    if (!version) return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });

    // Extract layout from snapshot
    const snapshot = version.snapshot as Record<string, unknown>;
    const snapshotLayout = snapshot.layout as Partial<Layout> | undefined;

    if (!snapshotLayout) {
      return NextResponse.json({ success: false, error: 'Version has no layout data' }, { status: 400 });
    }

    // 🚨 A SNAPSHOT TAKEN BEFORE THE TRIM WAS FIXED HAS NO PANEL ELEVATIONS.
    //
    // `app/api/projects/[id]/layout/route.ts` used to strip `height` out of
    // every version snapshot, on the premise that omitted fields are
    // "re-computed at render time". Nothing re-computes it. That was fixed
    // FORWARD ONLY — every snapshot taken before the fix still carries
    // height-less panels, and restoring one writes them over the live design:
    // drawn at sea level before `hasUsableElevation`, not drawn AT ALL after
    // it, and the route said `success: true` either way. The user loses a
    // design they could see and gets one they cannot.
    //
    // The repair is deterministic and uses the placement authority: a panel
    // sits one mount stack above its own plane, so its elevation at its own
    // lat/lng is recoverable from the plane it already names. Nothing about
    // WHERE the panel is gets invented.
    //
    // A panel that names no plane — a 2D-engine panel, or one whose plane is
    // missing from the snapshot — cannot be repaired, and is NOT written. The
    // restore is REFUSED instead, because overwriting a visible design with an
    // invisible one is worse than declining to restore.
    const snapshotPanels = (snapshotLayout.panels || []) as import('@/types').PlacedPanel[];
    const snapshotPlanes = (snapshotLayout.roofPlanes || []) as import('@/types').RoofPlane[];
    const rackingId = (snapshotLayout as { designElectrical?: { rackingId?: string } })
      .designElectrical?.rackingId;
    const repair = repairPanelElevations(snapshotPanels, snapshotPlanes, rackingId);

    if (repair.unrepairable.length > 0) {
      console.error('[versions/restore] REFUSED — unplaceable panels', {
        projectId: id, versionId, unrepairable: repair.unrepairable.length,
      });
      return NextResponse.json({
        success: false,
        refused: true,
        code: 'LAYOUT_RESTORE_UNPLACEABLE',
        error:
          `Version ${version.versionNumber} holds ${repair.unrepairable.length} panel(s) with no ` +
          `elevation and no roof plane to recover one from. Restoring it would replace the current ` +
          `design with one that cannot be drawn. Nothing has been written.`,
        data: {
          unrepairablePanelCount: repair.unrepairable.length,
          repairablePanelCount: repair.repaired.length,
          totalPanelCount: snapshotPanels.length,
        },
      }, { status: 409 });
    }

    if (repair.repaired.length > 0) {
      console.warn('[versions/restore] repaired panel elevations from the snapshot roof planes', {
        projectId: id, versionId, repaired: repair.repaired.length,
      });
    }

    // Restore the layout from the snapshot
    const restoredLayout = await upsertLayout({
      projectId: id,
      userId: user.id,
      systemType: snapshotLayout.systemType,
      panels: repair.panels,
      roofPlanes: snapshotLayout.roofPlanes,
      groundTilt: snapshotLayout.groundTilt,
      groundAzimuth: snapshotLayout.groundAzimuth,
      rowSpacing: snapshotLayout.rowSpacing,
      groundHeight: snapshotLayout.groundHeight,
      fenceAzimuth: snapshotLayout.fenceAzimuth,
      fenceHeight: snapshotLayout.fenceHeight,
      fenceLine: snapshotLayout.fenceLine,
      bifacialOptimized: snapshotLayout.bifacialOptimized,
      totalPanels: snapshotLayout.totalPanels,
      systemSizeKw: snapshotLayout.systemSizeKw,
      mapCenter: snapshotLayout.mapCenter,
      mapZoom: snapshotLayout.mapZoom,
      // 🚨 THE ARCHIVE MUST TRAVEL WITH THE ROOF IT DESCRIBES.
      //
      // These four were omitted, and `undefined` means KEEP STORED — so a
      // restore overwrote `roof_planes` from the snapshot while leaving
      // `site_archives` (and the `activeSiteKey` inside it) naming a DIFFERENT
      // property. rowToLayout's activeSitePlanes() then filtered out every
      // restored plane, handed lib/pvwatts.ts an empty array to read
      // `roofPlanes[0].pitch` from, and logged the total loss of the roof as a
      // "repair". Restoring a version deleted the roof.
      //
      // It also 500'd on any snapshot taken at a property change: those carry
      // `panels: []` (the panels moved into the archive), and without the
      // archive the LAYOUT_SUBSYSTEM_WIPE guard correctly refuses the save.
      // Phase 2 mints such a version on every property change, so the restore
      // button was permanently broken for exactly the versions it creates.
      //
      // A pre-123 snapshot has no siteArchives; `undefined` keeps whatever is
      // stored, and the backstop in lib/db/core.ts (never filter a roof down to
      // nothing) covers the resulting disagreement.
      siteArchives: (snapshotLayout as { siteArchives?: unknown }).siteArchives,
      obstructions: snapshotLayout.obstructions,
      measurements: snapshotLayout.measurements,
      designElectrical: snapshotLayout.designElectrical,
    });

    // Save a new version recording the restore
    await saveProjectVersion({
      projectId: id,
      userId: user.id,
      snapshot: {
        projectId: id,
        projectName: project.name,
        layout: restoredLayout,
        restoredFromVersion: version.versionNumber,
        savedAt: new Date().toISOString(),
      },
      panelsCount: restoredLayout.totalPanels,
      systemSizeKw: restoredLayout.systemSizeKw,
      changeSummary: `Restored from version ${version.versionNumber}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        restoredLayout,
        restoredFromVersion: version.versionNumber,
        message: `Successfully restored version ${version.versionNumber}`,
      },
    });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/pr', err);
  }
}