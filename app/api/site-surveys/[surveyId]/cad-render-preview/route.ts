// ============================================================================
// GET /api/site-surveys/[surveyId]/cad-render-preview
// Read-only professional CAD/SVG preview package for survey review workbench.
// ============================================================================

export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyById,
  getSiteSurveyFiles,
  isValidUUID,
} from '@/lib/db-neon';
import { buildProfessionalSurveyReadinessReport } from '@/lib/siteSurvey/professionalSurveyReadinessReport';
import { analyzeSurveyPhotosOpenSource } from '@/lib/siteSurvey/photoIntelligence';
import { buildProfessionalPlanSetRenderPackage } from '@/lib/siteSurvey/planSetRenderOutput';

export async function GET(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { surveyId } = params;
    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    const files = await getSiteSurveyFiles(surveyId);
    const photoAnalysis = await analyzeSurveyPhotosOpenSource(files.filter(file => file.fileType === 'photo'));
    const readinessReport = buildProfessionalSurveyReadinessReport(survey, files, photoAnalysis);
    const renderPackage = buildProfessionalPlanSetRenderPackage(readinessReport);
    const defaultSheet = renderPackage.sheets.find(sheet => sheet.sheetNumber === 'A-101') ?? renderPackage.sheets[0] ?? null;

    return NextResponse.json({
      success: true,
      data: {
        readiness: {
          schemaVersion: readinessReport.schemaVersion,
          readinessState: readinessReport.readinessState,
          source: readinessReport.source,
          labels: readinessReport.labels,
          summaries: readinessReport.summaries,
          renderReadiness: readinessReport.renderReadiness,
          noAuthorityEnforcement: readinessReport.noAuthorityEnforcement,
        },
        renderPackage: {
          schemaVersion: renderPackage.schemaVersion,
          mode: renderPackage.mode,
          sourceSurveyId: renderPackage.sourceSurveyId,
          sourceRenderReadinessHash: renderPackage.sourceRenderReadinessHash,
          packageHash: renderPackage.packageHash,
          summary: renderPackage.summary,
          previewManifest: renderPackage.previewManifest,
          noAuthorityEnforcement: renderPackage.noAuthorityEnforcement,
          deterministicNotes: renderPackage.deterministicNotes,
        },
        sheets: renderPackage.sheets.map(sheet => ({
          sheetId: sheet.sheetId,
          sheetNumber: sheet.sheetNumber,
          sheetType: sheet.sheetType,
          title: sheet.title,
          width: sheet.width,
          height: sheet.height,
          svg: sheet.svg,
          layerOrder: sheet.layerOrder,
          annotations: sheet.annotations,
          renderHash: sheet.renderHash,
          noAuthorityEnforcement: sheet.noAuthorityEnforcement,
        })),
        defaultSheetNumber: defaultSheet?.sheetNumber ?? null,
      },
      meta: {
        readOnly: true,
        previewOnly: true,
        nonAuthoritative: true,
        cadSolverExecuted: false,
        cadMutationPerformed: false,
        canonicalGeometryMutationPerformed: false,
        dbWritesPerformed: false,
        downstreamTriggered: false,
        photoAnalysisEngine: 'sharp_sha256_perceptual_hash_laplacian_v1',
      },
    });
  } catch (err) {
    console.error('[GET /api/site-surveys/[surveyId]/cad-render-preview]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to build read-only survey CAD render preview' },
      { status: 500 },
    );
  }
}
