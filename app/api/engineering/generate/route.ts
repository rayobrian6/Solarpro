// ============================================================
// POST /api/engineering/generate
// Triggers engineering report generation from design engine data
// Called automatically when layout is saved, or manually
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject , handleRouteDbError } from '@/lib/db-neon';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import { upsertEngineeringReport, generateReportId, isEngineeringReportStale } from '@/lib/engineering/db-engineering';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, force = false } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    // Load project with full details
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Load layout
    const layout = await getLayoutByProject(projectId, user.id);
    if (!layout || !layout.panels || layout.panels.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No panel layout found. Please place panels in the Design Studio first.',
      }, { status: 400 });
    }

    // Build design snapshot (derives all data from design engine)
    const snapshot = buildDesignSnapshot(project, layout);

    // Check if report is already up-to-date (skip if not forced)
    if (!force) {
      const stale = await isEngineeringReportStale(projectId, snapshot.designVersionId);
      if (!stale) {
        return NextResponse.json({
          success: true,
          data: { message: 'Engineering report is already up-to-date', regenerated: false },
        });
      }
    }

    // Generate engineering report
    const reportId = generateReportId();
    const report = generateEngineeringReport(snapshot, reportId);

    // Save to database
    await upsertEngineeringReport(report, projectId);

    return NextResponse.json({
      success: true,
      data: {
        reportId: report.id,
        projectId,
        panelCount: report.systemSummary.panelCount,
        systemSizeKw: report.systemSummary.systemSizeKw,
        designVersionId: report.designVersionId,
        generatedAt: report.generatedAt,
        regenerated: true,
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[engineering/genera', err);
  }
}