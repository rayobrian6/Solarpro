import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getProjectVersion, upsertLayout, saveProjectVersion , handleRouteDbError } from '@/lib/db-neon';
import { Layout } from '@/types';

type RouteContext = { params: Promise<{id: string; versionId: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id, versionId } = await context.params;
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
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

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

    // Restore the layout from the snapshot
    const restoredLayout = await upsertLayout({
      projectId: id,
      userId: user.id,
      systemType: snapshotLayout.systemType,
      panels: snapshotLayout.panels || [],
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