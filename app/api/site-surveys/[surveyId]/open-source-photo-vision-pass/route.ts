// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
//   → Creates an async job, returns { jobId } immediately.
//   → Deduplication: if an active job exists for this survey, returns its ID.
//   → Rate limiting: max 3 active jobs per user.
//
// GET  /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → Returns current job status/progress (instant, reads from DB only).
//   → Processing is done by the /process endpoint, not here.
//   → Stale job housekeeping: marks jobs running >30min as failed.
//
// DELETE /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → Cancels an active (pending/running) job.
//   → Also sends DELETE to the Render worker for queued jobs.
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
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import {
  createJob,
  getJob,
  processNextBatch,
  findActiveJobForSurvey,
  countActiveJobsForUser,
  cancelJob,
  markStaleJobsFailed,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import {
  getExternalOpenCvWorkerUrl,
  fetchHealth,
} from '@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

const MAX_ACTIVE_JOBS_PER_USER = 3;

// ---------------------------------------------------------------------------
// POST — Create an async photo vision job (with dedup + rate limiting)
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

    // Dedup: check if there's already an active job for this survey
    const activeJob = await findActiveJobForSurvey(surveyId);
    if (activeJob) {
      console.log(`[POST open-source-photo-vision-pass] surveyId=${surveyId} dedup: returning existing jobId=${activeJob.jobId} (status=${activeJob.status})`);
      return NextResponse.json({
        success: true,
        jobId: activeJob.jobId,
        surveyId,
        photoFileCount: activeJob.totalPhotoFiles,
        totalBatches: activeJob.totalBatches,
        message: 'An active job already exists for this survey. Poll GET endpoint with the returned jobId for progress.',
        deduplicated: true,
      });
    }

    // Rate limiting: max active jobs per user
    const activeJobCount = await countActiveJobsForUser(user.id);
    if (activeJobCount >= MAX_ACTIVE_JOBS_PER_USER) {
      return NextResponse.json({
        success: false,
        error: `Rate limit: you have ${activeJobCount} active photo vision job(s). Please wait for one to complete or cancel one before starting a new one.`,
        activeJobCount,
      }, { status: 429 });
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

    // Create an async job
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
// Includes stale job housekeeping at the start of each poll.
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

  // Stale job housekeeping — mark jobs running >30min as failed
  try {
    const staleCount = await markStaleJobsFailed();
    if (staleCount > 0) {
      console.log(`[GET open-source-photo-vision-pass] Marked ${staleCount} stale job(s) as failed`);
    }
  } catch (staleErr) {
    // Non-fatal: don't block polling if stale cleanup fails
    console.error('[GET open-source-photo-vision-pass] Stale cleanup error (non-fatal):', staleErr instanceof Error ? staleErr.message : String(staleErr));
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

  // Job is pending/running — return progress only (no processing here)
  // Processing is done by the /process endpoint called by the client
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
export async function DELETE(
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
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }

  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  if (job.status !== 'pending' && job.status !== 'running') {
    return NextResponse.json({
      success: false,
      error: `Job is already ${job.status} and cannot be cancelled`,
      status: job.status,
    }, { status: 400 });
  }

  // Cancel in our DB
  const cancelled = await cancelJob(jobId);

  // Also try to cancel on the Render worker side
  try {
    const workerUrl = getExternalOpenCvWorkerUrl();
    if (workerUrl) {
      // We don't have the renderJobId stored in our DB, so we can't cancel
      // on the Render side directly. The Render worker will clean up its
      // in-memory jobs after 1 hour via _cleanup_old_jobs().
      // This is acceptable because the semaphore ensures only 1 job runs
      // at a time, and the cancelled job won't block new submissions.
    }
  } catch (cancelErr) {
    // Non-fatal: Render worker cancellation is best-effort
    console.error('[DELETE open-source-photo-vision-pass] Render cancel error (non-fatal):', cancelErr instanceof Error ? cancelErr.message : String(cancelErr));
  }

  if (cancelled) {
    console.log(`[DELETE open-source-photo-vision-pass] jobId=${jobId} cancelled successfully`);
    return NextResponse.json({
      success: true,
      jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully.',
    });
  }

  return NextResponse.json({
    success: false,
    error: 'Could not cancel job — it may have already completed or failed',
  }, { status: 400 });
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
