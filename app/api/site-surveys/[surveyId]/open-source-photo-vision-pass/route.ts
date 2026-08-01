// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
//   → Creates a job in DB + submits ALL photos to Render → returns jobId instantly.
//   → Render processes all photos in batches internally, writes progress to Neon DB.
//   → Deduplicates: if an active job exists for this survey, returns its ID.
//   → Rate limits: max 3 active jobs per user.
//
// GET  /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → PURE DB READ — instant status/progress. No Render communication.
//   → For completed jobs: returns raw worker results + finalization status/result.
//     Heavy post-processing runs via the explicit /finalize route (called by UI).
//     This route NEVER runs heavy work — it only reads from DB.
//
// DELETE /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → Cancels an active job (DB + best-effort Render cancel).
//
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
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import {
  createAndSubmitJob,
  getJob,
  findActiveJobForSurvey,
  countActiveJobsForUser,
  cancelJob,
  markStaleJobsFailed,
  resetAllStuckFinalizations,
  type PhotoVisionJob,
  type FinalizationStatus,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import {
  getExternalOpenCvWorkerUrl,
  fetchHealth,
} from '@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

const MAX_ACTIVE_JOBS_PER_USER = 3;

// ---------------------------------------------------------------------------
// POST — Create async job + submit ALL photos to Render (returns instantly)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
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

    // Deduplication: if there's already an active job for this survey, return it
    const existingJob = await findActiveJobForSurvey(surveyId);
    if (existingJob) {
      console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} existing active job found: ${existingJob.jobId} (status=${existingJob.status})`);
      return NextResponse.json({
        success: true,
        jobId: existingJob.jobId,
        surveyId,
        photoFileCount: existingJob.totalPhotoFiles,
        totalBatches: existingJob.totalBatches,
        message: 'An active job already exists for this survey. Poll GET endpoint with jobId for progress.',
        existingJob: true,
      });
    }

    // Rate limiting
    const activeJobCount = await countActiveJobsForUser(user.id);
    if (activeJobCount >= MAX_ACTIVE_JOBS_PER_USER) {
      return NextResponse.json({
        success: false,
        error: `You have ${activeJobCount} active photo vision job(s). Please wait for them to complete before starting more.`,
        meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: false }),
      }, { status: 429 });
    }

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

    // Check worker health before creating the job
    const workerUrl = getExternalOpenCvWorkerUrl();
    if (!workerUrl) {
      return NextResponse.json({
        success: false,
        error: 'External CV worker URL not configured',
        meta: noMutationMeta({ workerUnavailable: true, sourceImageBytesProcessed: false }),
      }, { status: 503 });
    }
    const health = await fetchHealth(workerUrl, 15_000);
    if (!health || health.status !== 'ok') {
      return NextResponse.json({
        success: false,
        error: `External CV worker unavailable: ${health?.status ?? 'no response'}`,
        meta: noMutationMeta({ workerUnavailable: true, sourceImageBytesProcessed: false }),
      }, { status: 503 });
    }

    // Create job in DB + submit ALL files to Render in one POST
    const { job, renderSubmitOk, renderError } = await createAndSubmitJob(surveyId, user.id, survey, photoFiles);

    if (!renderSubmitOk) {
      return NextResponse.json({
        success: false,
        error: `Failed to submit to Render worker: ${renderError}`,
        jobId: job.jobId,
        meta: noMutationMeta({ workerUnavailable: true, sourceImageBytesProcessed: false }),
      }, { status: 502 });
    }

    console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} jobId=${job.jobId} created and submitted to Render. Client should poll GET with jobId.`);

    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      surveyId,
      photoFileCount: photoFiles.length,
      totalBatches: job.totalBatches,
      message: 'Photo vision pass job created and submitted to worker. Poll GET endpoint with jobId for progress and results.',
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
// GET — PURE DB READ for job status/progress (instant, no Render communication)
//
// For completed jobs, returns raw worker results + finalization status.
// Heavy post-processing runs via POST /finalize (called by the UI explicitly).
// This route NEVER runs heavy work — it only reads from DB.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const getStart = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';
  const jobId = req.nextUrl.searchParams.get('jobId');

  console.log(`[cv-pass:get:start] surveyId=${surveyId} jobId=${jobId}`);

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId query parameter' }, { status: 400 });
  }

  // Housekeeping: mark stale jobs as failed + reset stuck finalizations
  try {
    const staleCount = await markStaleJobsFailed();
    if (staleCount > 0) {
      console.log(`[cv-pass:get:start] Marked ${staleCount} stale job(s) as failed`);
    }
  } catch {
    // Don't fail the poll if housekeeping fails
  }
  try {
    const resetCount = await resetAllStuckFinalizations();
    if (resetCount > 0) {
      console.log(`[cv-pass:get:start] Reset ${resetCount} stuck finalization(s) from 'running' to 'pending'`);
    }
  } catch {
    // Don't fail the poll if housekeeping fails
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found. It may have expired or the server recycled. Please start a new pass.' }, { status: 404 });
  }

  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  console.log(`[cv-pass:worker-status] jobId=${jobId} status=${job.status} finalizationStatus=${job.finalizationStatus}`);

  // Completed job — return raw worker results + finalization state
  if (job.status === 'completed') {
    return handleCompletedJob(job, surveyId, getStart);
  }

  // Failed job
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

  // Pending/running — return progress (instant DB read)
  const elapsed = Date.now() - getStart;
  console.log(`[cv-pass:get:end] jobId=${jobId} status=${job.status} elapsed=${elapsed}ms`);
  return NextResponse.json({
    success: true,
    jobId: job.jobId,
    status: job.status,
    progress: {
      totalBatches: job.totalBatches,
      completedBatches: job.completedBatches,
      currentBatch: job.currentBatch,
      totalPhotoFiles: job.totalPhotoFiles,
      processedFiles: job.processedFiles,
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

// ---------------------------------------------------------------------------
// DELETE — Cancel an active job
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const surveyId = params?.surveyId ?? 'unknown';
  const jobId = req.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Missing jobId query parameter' }, { status: 400 });
  }

  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }

  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  const cancelled = await cancelJob(jobId);
  if (cancelled) {
    console.log(`[DELETE open-source-photo-vision-pass] jobId=${jobId} cancelled by user`);
    return NextResponse.json({
      success: true,
      jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully.',
    });
  }

  return NextResponse.json({
    success: false,
    jobId,
    error: 'Job could not be cancelled (it may have already completed or failed)',
  }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Handle a completed job — PURE DB READ, returns immediately.
//
// Returns raw worker results + finalization status/result from DB.
// The UI calls POST /finalize explicitly to trigger heavy processing.
// This function NEVER runs heavy work.
// ---------------------------------------------------------------------------
function handleCompletedJob(job: PhotoVisionJob, surveyId: string, getStart: number) {
  const run = job.result!;
  const summary = uiSummary(run);
  const elapsed = Date.now() - getStart;

  console.log(`[cv-pass:get:end] jobId=${job.jobId} completed: processed=${run.processedCount} failed=${run.failedCount} candidates=${run.candidateCount} finalizationStatus=${job.finalizationStatus} elapsed=${elapsed}ms`);

  return NextResponse.json({
    success: true,
    jobId: job.jobId,
    status: 'completed',
    finalizationStatus: job.finalizationStatus,
    data: {
      summary,
      run: summarizeOpenSourcePhotoVisionRun(run),
      // If finalization is complete, include its stored results
      stored: (job.finalizationResult?.stored as Record<string, unknown> | null) ?? null,
      labelUpdate: (job.finalizationResult?.labelUpdate as Record<string, unknown> | null) ?? null,
      phase4a: (job.finalizationResult?.phase4a as Record<string, unknown> | null) ?? null,
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
    finalizationError: job.finalizationStatus === 'failed' ? job.finalizationError : undefined,
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
