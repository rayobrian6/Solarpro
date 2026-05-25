// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
// Operator-triggered OSS photo vision pass.
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyById,
  getSiteSurveyFiles,
  isValidUUID,
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import { runOpenSourcePhotoVisionWorker } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

export async function POST(
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
    if (!survey) return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });

    const files = await getSiteSurveyFiles(surveyId);
    const run = await runOpenSourcePhotoVisionWorker({ survey, files });
    const stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, user.id, run);

    return NextResponse.json({
      success: true,
      data: {
        run: summarizeOpenSourcePhotoVisionRun(run),
        stored,
        files: run.files.map(file => ({
          surveyId: file.surveyId,
          fileId: file.fileId,
          fileUrl: file.fileUrl,
          filename: file.filename,
          analyzed: file.analyzed,
          error: file.error,
          metadata: file.metadata,
          edgeSummary: file.edgeSummary,
          candidateCount: file.candidates.length,
          thumbnailDataUrl: file.thumbnailDataUrl,
          limitations: file.limitations,
          runHash: file.runHash,
        })),
      },
      meta: {
        operatorTriggered: true,
        reviewOnly: true,
        nonAuthoritative: true,
        sourceImageBytesProcessed: true,
        openAiVisionUsed: false,
        canonicalManifestMutationPerformed: false,
        canonicalGeometryMutationPerformed: false,
        cadMutationPerformed: false,
        projectPhysicalDataMutationPerformed: false,
        permitGenerationTriggered: false,
        bomMutationPerformed: false,
        engineeringWorkflowMutationPerformed: false,
      },
    });
  } catch (err) {
    console.error('[POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to run open-source photo vision pass' },
      { status: 500 },
    );
  }
}
