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
import { getProjectPhysicalData } from '@/lib/db-neon';
import { upsertEngineeringReport, generateReportId, isEngineeringReportStale } from '@/lib/engineering/db-engineering';
import { fromPhysicalData } from '@/lib/siteSurvey/fromPhysicalData';
import { normalizeSurvey } from '@/lib/siteSurvey/normalizeSurvey';
import { enrichSurvey } from '@/lib/siteSurvey/enrichSurvey';
import { applyToSystemDefinition } from '@/lib/siteSurvey/applyToSystemDefinition';
import { buildSystemDefinition } from '@/lib/system/systemDefinition';
import type { EnrichedSiteSurvey } from '@/lib/siteSurvey/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
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
    const physicalData = await getProjectPhysicalData(projectId);

    // Phase 1+2: Survey pipeline overlay (non-destructive, fully guarded)
    let enrichedSurvey: EnrichedSiteSurvey | null = null;
    try {
      if (physicalData) {
        const physDataRow = {
          roof_material:           physicalData.roof_material,
          roof_age_years:          physicalData.roof_age_years,
          roof_condition:          physicalData.roof_condition,
          rafter_spacing_in:       physicalData.rafter_spacing_in,
          main_panel_rating_amps:  physicalData.panel_rating_amps,
          panel_brand:             physicalData.panel_brand,
          interconnection_point:   physicalData.interconnection_point,
        };
        const raw = await fromPhysicalData(projectId, physDataRow);
        if (!raw) throw new Error('fromPhysicalData returned null');
        const norm     = normalizeSurvey(raw);
        const enriched = enrichSurvey(norm);
        enrichedSurvey = enriched;

        const systemDef = buildSystemDefinition({
          project: {
            systemType:    (project as any).systemType ?? 'roof',
            roofType:      physicalData.roof_material ?? 'shingle',
            rafterSpacing: physicalData.rafter_spacing_in ?? 24,
            mainPanelAmps: physicalData.panel_rating_amps ?? 200,
          },
          system: {
            totalPanels: layout.totalPanels ?? ((layout as any).panels?.length ?? 0),
            totalDcKw:   (layout as any).systemSizeKw ?? 0,
          },
          layout: { systemType: (project as any).systemType ?? 'roof' },
        });

        const { definition, context } = applyToSystemDefinition(systemDef, enriched);

        if (process.env.NODE_ENV !== 'production' || context.overriddenFields.length > 0) {
          console.log('[SURVEY APPLIED]', {
            projectId,
            overriddenFields: context.overriddenFields,
            skippedFields:    context.skippedFields,
            systemType:       definition.systemType,
            azimuth:          definition.layout.azimuth,
            tilt:             definition.layout.tilt,
            mainPanelAmps:    definition.electrical.mainPanelAmps,
            roofType:         definition.structure.roofType,
            photos:           enriched.derived.photoCounts.total,
          });
        }
      }
    } catch (surveyErr) {
      console.warn('[SURVEY PIPELINE] generate skipped (non-fatal):', (surveyErr as Error).message);
    }

    const report = generateEngineeringReport(snapshot, reportId, physicalData, enrichedSurvey);

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