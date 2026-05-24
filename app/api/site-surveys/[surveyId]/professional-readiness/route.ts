// ============================================================================
// GET /api/site-surveys/[surveyId]/professional-readiness
//
// Read-only Professional Site Survey Parser V1 integration endpoint.
//
// This route derives an operator-facing readiness report from an authorized
// survey row + files. It intentionally performs no writes, executes no CAD
// solver, mutates no CAD state, and triggers no engineering/permit/BOM flows.
// ============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getSiteSurveyById, getSiteSurveyFiles, isValidUUID } from '@/lib/db-neon';
import { buildProfessionalSurveyReadinessReport } from '@/lib/siteSurvey/professionalSurveyReadinessReport';
import { analyzeSurveyPhotosOpenSource } from '@/lib/siteSurvey/photoIntelligence';

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
    const report = buildProfessionalSurveyReadinessReport(survey, files, photoAnalysis);

    return NextResponse.json({
      success: true,
      data: report,
      meta: {
        readOnly: true,
        previewOnly: true,
        nonAuthoritative: true,
        cadSolverExecuted: false,
        cadMutationPerformed: false,
        downstreamTriggered: false,
        photoAnalysisEngine: 'sharp_sha256_perceptual_hash_laplacian_v1',
      },
    });
  } catch (err) {
    console.error('[GET /api/site-surveys/[surveyId]/professional-readiness]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to build professional survey readiness report' },
      { status: 500 },
    );
  }
}
