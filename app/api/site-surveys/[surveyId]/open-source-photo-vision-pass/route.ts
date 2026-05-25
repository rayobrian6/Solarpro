// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
//   → Creates an async job, returns { jobId } immediately.
//
// GET  /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → Processes one batch per call, then returns current job status/progress.
//   → Client polls repeatedly until status is "completed" or "failed".
//
// This "lazy processing" pattern ensures each request handler does a bounded
// amount of work (~10-15s per batch) and returns well within serverless
// function timeout limits. No fire-and-forget Promises that could be killed.
//
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyById,
  getSiteSurveyFiles,
  isValidUUID,
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import {
  createJob,
  getJob,
  processNextBatch,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

// ---------------------------------------------------------------------------
// POST — Create an async photo vision job
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const startedAt = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';
  console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} creating async job`);

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
    const photoFiles = files.filter(file => file.fileType === 'photo');
    console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} totalFiles=${files.length} photoFiles=${photoFiles.length} after ${(Date.now() - startedAt)}ms`);

    if (photoFiles.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No photo files found for this survey',
        meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: false }),
      }, { status: 400 });
    }

    // Create an async job — processing will happen during GET/poll requests
    const job = await createJob(surveyId, user.id, survey, photoFiles);
    console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} jobId=${job.jobId} created. Client should poll GET with jobId.`);

    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      surveyId,
      photoFileCount: photoFiles.length,
      totalBatches: job.totalBatches,
      message: 'Photo vision pass job created. Poll GET endpoint with jobId for progress and results.',
    });
  } catch (err) {
    console.error(`[POST open-source-photo-vision-pass] surveyId=${surveyId} FAILED after ${(Date.now() - startedAt)}ms:`, err);
    const message = err instanceof Error ? err.message : 'Failed to start photo vision pass';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to start photo vision pass',
        detail: message,
        meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: false }),
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// GET — Poll job status AND process next batch (lazy processing)
// Each poll request processes one batch (~10-15s), then returns status.
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';
  const jobId = req.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId query parameter' }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found. It may have expired or the server recycled. Please start a new pass.' }, { status: 404 });
  }

  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  // If job is already terminal, return final state
  if (job.status === 'completed') {
    return handleCompletedJob(job, surveyId);
  }

  if (job.status === 'failed') {
    return NextResponse.json({
      success: false,
      jobId: job.jobId,
      status: 'failed',
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  }

  // Job is pending/running — process the next batch
  try {
    const updatedJob = await processNextBatch(jobId);

    // Check if the job just completed
    if (updatedJob.status === 'completed') {
      return handleCompletedJob(updatedJob, surveyId);
    }

    if (updatedJob.status === 'failed') {
      return NextResponse.json({
        success: false,
        jobId: updatedJob.jobId,
        status: 'failed',
        error: updatedJob.error,
        createdAt: updatedJob.createdAt,
        completedAt: updatedJob.completedAt,
      });
    }

    // Still running — return progress
    return NextResponse.json({
      success: true,
      jobId: updatedJob.jobId,
      status: updatedJob.status,
      progress: {
        totalBatches: updatedJob.totalBatches,
        completedBatches: updatedJob.completedBatches,
        currentBatch: updatedJob.currentBatch,
        totalPhotoFiles: updatedJob.totalPhotoFiles,
        processedFiles: updatedJob.processedFiles,
      },
      createdAt: updatedJob.createdAt,
      updatedAt: updatedJob.updatedAt,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[GET open-source-photo-vision-pass] jobId=${jobId} processing error:`, errMsg);
    return NextResponse.json({
      success: false,
      jobId,
      status: 'failed',
      error: `Processing error: ${errMsg}`,
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Handle a completed job — format full results + persist to DB
// ---------------------------------------------------------------------------
async function handleCompletedJob(job: PhotoVisionJob, surveyId: string) {
  const run = job.result!;
  let stored = null;
  try {
    stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, job.userId, run);
  } catch (dbErr) {
    console.error('[GET open-source-photo-vision-pass] DB persist failed:', dbErr instanceof Error ? dbErr.message : String(dbErr));
  }

  const summary = uiSummary(run);
  console.log(`[GET open-source-photo-vision-pass] jobId=${job.jobId} completed: processed=${run.processedCount} failed=${run.failedCount} candidates=${run.candidateCount}`);

  return NextResponse.json({
    success: true,
    jobId: job.jobId,
    status: 'completed',
    data: {
      summary,
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
    meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: true }),
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
