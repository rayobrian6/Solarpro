import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion } from '@/lib/db-neon';

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

    if (!panels || !Array.isArray(panels)) {
      return NextResponse.json({ success: false, error: 'panels array required' }, { status: 400 });
    }

    // Get existing layout for defaults
    const existingLayout = await getLayoutByProject(projectId, user.id);

    const totalPanels = panels.length;
    const systemSizeKw = parseFloat((totalPanels * 0.4).toFixed(2));

    // UPSERT layout — never destructive
    const savedLayout = await upsertLayout({
      projectId,
      userId: user.id,
      systemType: systemType || existingLayout?.systemType || project.systemType || 'roof',
      panels,
      roofPlanes: roofPlanes ?? existingLayout?.roofPlanes,
      groundTilt: groundTilt ?? existingLayout?.groundTilt ?? 20,
      groundAzimuth: groundAzimuth ?? existingLayout?.groundAzimuth ?? 180,
      rowSpacing: rowSpacing ?? existingLayout?.rowSpacing ?? 1.5,
      groundHeight: groundHeight ?? existingLayout?.groundHeight ?? 0.6,
      fenceAzimuth: fenceAzimuth ?? existingLayout?.fenceAzimuth,
      fenceHeight: fenceHeight ?? existingLayout?.fenceHeight,
      fenceLine: fenceLine ?? existingLayout?.fenceLine,
      bifacialOptimized: bifacialOptimized ?? existingLayout?.bifacialOptimized ?? false,
      totalPanels,
      systemSizeKw,
      mapCenter: mapCenter ?? existingLayout?.mapCenter,
      mapZoom: mapZoom ?? existingLayout?.mapZoom,
    });

    // Save version snapshot (async, non-blocking for response)
    saveProjectVersion({
      projectId,
      userId: user.id,
      snapshot: {
        projectId,
        projectName: project.name,
        layout: savedLayout,
        savedAt: new Date().toISOString(),
      },
      panelsCount: totalPanels,
      systemSizeKw,
      changeSummary: changeSummary || `Saved ${totalPanels} panels (${systemSizeKw} kW)`,
    }).catch(err => console.error('[version snapshot]', err));

    return NextResponse.json({
      success: true,
      data: {
        projectId,
        layoutId: savedLayout.id,
        panelCount: totalPanels,
        systemSizeKw,
        savedAt: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    console.error('[POST /api/projects/[id]/layout]', error);
    const message = error instanceof Error ? error.message : 'Failed to save layout';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
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
    console.error('[GET /api/projects/[id]/layout]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch layout' }, { status: 500 });
  }
}