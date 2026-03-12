import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject, upsertLayout, saveProjectVersion , handleRouteDbError } from '@/lib/db-neon';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import { upsertEngineeringReport, generateReportId, isEngineeringReportStale } from '@/lib/engineering/db-engineering';

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

    // Auto-trigger engineering report generation (async, non-blocking)
    // Engineering derives all data from the design engine — no manual entry needed
    if (totalPanels > 0) {
      (async () => {
        try {
          const snapshot = buildDesignSnapshot(project, savedLayout);
          const stale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
          if (stale) {
            const reportId = generateReportId();
            const report = generateEngineeringReport(snapshot, reportId);
            await upsertEngineeringReport(report, projectId);
            console.log(`[engineering] Auto-generated report for project ${projectId}: ${totalPanels} panels, ${systemSizeKw}kW`);
          }
        } catch (engErr: unknown) {
          console.error('[engineering] Auto-generation failed (non-critical):', engErr);
        }
      })();
    }

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