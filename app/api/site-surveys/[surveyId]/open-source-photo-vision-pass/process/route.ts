// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass/process
//
// Processes N batches for an async photo vision job, then returns progress.
// Called by the client in a loop until the job completes.
// This keeps each Vercel function invocation well under 60s.
//
// The main GET route only reads DB status (instant). This route does the
// actual Render worker communication and batch processing.
//
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getJob,
  processNextBatch,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import {
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';

const MAX_BATCHES_PER_TICK = 3; // Process 3 batches per invocation (~30-45s total)

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';

  // Auth check
  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const jobId = body.jobId as string | undefined;
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'jobId is required' }, { status: 400 });
  }

  // Verify job exists and belongs to this survey
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }
  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  // If job is already terminal, return status without processing
  if (job.status === 'completed' || job.status === 'failed') {
    if (job.status === 'completed' && job.result) {
      return handleCompletedJob(job, surveyId);
    }
    return NextResponse.json({
      success: false,
      jobId: job.jobId,
      status: job.status,
      error: job.error,
      progress: {
        totalBatches: job.totalBatches,
        completedBatches: job.completedBatches,
        currentBatch: job.currentBatch,
        totalPhotoFiles: job.totalPhotoFiles,
        processedFiles: job.processedFiles,
      },
    });
  }

  // Process N batches
  try {
    const updatedJob = await processNextBatch(jobId, MAX_BATCHES_PER_TICK);

    if (updatedJob.status === 'completed') {
      const fullJob = await getJob(updatedJob.jobId);
      return handleCompletedJob(fullJob ?? updatedJob, surveyId);
    }

    if (updatedJob.status === 'failed') {
      return NextResponse.json({
        success: false,
        jobId: updatedJob.jobId,
        status: 'failed',
        error: updatedJob.error,
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
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[process] jobId=${jobId} error:`, errMsg);
    return NextResponse.json({
      success: false,
      jobId,
      status: 'failed',
      error: `Processing error: ${errMsg}`,
    }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Completed job handler (same pattern as main route)
// ---------------------------------------------------------------------------
async function handleCompletedJob(job: PhotoVisionJob, surveyId: string) {
  const run = job.result!;
  let stored = null;
  try {
    stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, job.userId, run);
  } catch (dbErr) {
    console.error('[process] DB persist failed:', dbErr instanceof Error ? dbErr.message : String(dbErr));
  }

  const candidateTypeCounts: Record<string, number> = {};
  for (const candidate of run.candidates) {
    candidateTypeCounts[candidate.candidateType] = (candidateTypeCounts[candidate.candidateType] ?? 0) + 1;
  }
  const summary = {
    processedFileCount: run.processedCount,
    failedFileCount: run.failedCount,
    candidateCount: run.candidateCount,
    candidateTypeCounts,
    unavailableDiagnostics: Object.entries(run.availability)
      .filter(([, value]) => typeof value === 'string' && value.includes('unavailable'))
      .map(([tool, value]) => `${tool}: ${value}`),
    runHash: run.runHash,
  };

  console.log(`[process] jobId=${job.jobId} completed: processed=${run.processedCount} failed=${run.failedCount} candidates=${run.candidateCount}`);

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
    meta: { reviewOnly: true, nonAuthoritative: true, canonicalMutationAllowed: false, cadMutationAllowed: false, permitGenerationAllowed: false, bomMutationAllowed: false, engineeringWorkflowMutationAllowed: false, workerUnavailable: false, sourceImageBytesProcessed: true },
    progress: {
      totalBatches: job.totalBatches,
      completedBatches: job.completedBatches,
      currentBatch: job.currentBatch,
      totalPhotoFiles: job.totalPhotoFiles,
      processedFiles: job.processedFiles,
    },
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
}
