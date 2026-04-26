// ============================================================
// GET /api/engineering/report?projectId=xxx
// Fetches the latest engineering report for a project
// Also handles auto-generation if no report exists
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getLayoutByProject , handleRouteDbError } from '@/lib/db-neon';
import { buildDesignSnapshot } from '@/lib/engineering/designSnapshot';
import { generateEngineeringReport } from '@/lib/engineering/reportGenerator';
import { getProjectPhysicalData } from '@/lib/db-neon';
import { getEngineeringReport, upsertEngineeringReport, generateReportId, isEngineeringReportStale } from '@/lib/engineering/db-engineering';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    // Load project
    const project = await getProjectById(projectId, user.id);
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Load layout
    const layout = await getLayoutByProject(projectId, user.id);
    if (!layout || !layout.panels || layout.panels.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No panel layout found',
        needsDesign: true,
      }, { status: 404 });
    }

    // Build snapshot to check version
    const snapshot = buildDesignSnapshot(project, layout);

    // Check if existing report is stale
    const stale = await isEngineeringReportStale(projectId, snapshot.designVersionId);

    // Try to get existing report
    let report = await getEngineeringReport(projectId);

    // Auto-generate if missing or stale
    if (!report || stale) {
      const reportId = generateReportId();
      const physicalData = await getProjectPhysicalData(projectId);
      report = generateEngineeringReport(snapshot, reportId, physicalData);
      await upsertEngineeringReport(report, projectId);
    }

    return NextResponse.json({
      success: true,
      data: {
        report,
        isStale: stale,
        designVersionId: snapshot.designVersionId,
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[engineering/rep', err);
  }
}