// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
// Operator-triggered external OSS OpenCV + YOLO/Supervision CV worker pass.
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
import { runExternalOpenCvPhotoVisionPass } from '@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

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
    const outcome = await runExternalOpenCvPhotoVisionPass({ survey, files });

    if (outcome.available === false) {
      return NextResponse.json({
        success: false,
        error: 'External CV photo vision worker unavailable',
        detail: outcome.reason,
        data: {
          workerHealth: outcome.health,
          summary: unavailableSummary(surveyId, outcome.reason),
        },
        meta: noMutationMeta({ workerUnavailable: true, sourceImageBytesProcessed: false }),
      }, { status: 503 });
    }

    const run = outcome.run;
    let stored = null;
    try {
      stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, user.id, run);
    } catch (dbErr) {
      // The open_source_photo_vision_candidates table may not exist yet
      // (migration 023 not run). Log the error but still return the run
      // results so the UI can display candidates from the transient run.
      console.error('[POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass] DB persist failed (table may not exist):', dbErr instanceof Error ? dbErr.message : String(dbErr));
    }

    const summary = uiSummary(run);

    return NextResponse.json({
      success: true,
      data: {
        summary,
        run: summarizeOpenSourcePhotoVisionRun(run),
        stored,
        workerHealth: outcome.health,
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
      meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: true }),
    });
  } catch (err) {
    console.error('[POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass]', err);
    const message = err instanceof Error ? err.message : 'Failed to run external OpenCV photo vision pass';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to run external OpenCV photo vision pass',
        detail: message,
        meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: false }),
      },
      { status: 500 },
    );
  }
}

function uiSummary(run: OpenSourcePhotoVisionRunResult) {
  const candidateTypeCounts: Record<string, number> = {};
  for (const candidate of run.candidates) {
    candidateTypeCounts[candidate.candidateType] = (candidateTypeCounts[candidate.candidateType] ?? 0) + 1;
  }
  return {
    processedFileCount: run.processedCount,
    failedFileCount: run.failedCount,
    candidateCount: run.candidateCount,
    candidateTypeCounts,
    unavailableDiagnostics: Object.entries(run.availability)
      .filter(([, value]) => typeof value === 'string' && value.includes('unavailable'))
      .map(([tool, value]) => `${tool}: ${value}`),
    runHash: run.runHash,
  };
}

function unavailableSummary(surveyId: string, reason: string) {
  return {
    processedFileCount: 0,
    failedFileCount: 0,
    candidateCount: 0,
    candidateTypeCounts: {},
    unavailableDiagnostics: [`externalCvWorker: ${reason}`],
    runHash: `unavailable:${surveyId}`,
  };
}

function noMutationMeta(extra: { workerUnavailable: boolean; sourceImageBytesProcessed: boolean }) {
  return {
    operatorTriggered: true,
    reviewOnly: true,
    nonAuthoritative: true,
    externalWorker: true,
    openAiVisionUsed: false,
    canonicalManifestMutationPerformed: false,
    canonicalGeometryMutationPerformed: false,
    cadMutationPerformed: false,
    projectPhysicalDataMutationPerformed: false,
    permitGenerationTriggered: false,
    bomMutationPerformed: false,
    engineeringWorkflowMutationPerformed: false,
    ...extra,
  };
}
