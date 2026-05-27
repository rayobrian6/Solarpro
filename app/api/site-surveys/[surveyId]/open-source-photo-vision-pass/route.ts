// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
//   → Creates a job in DB + submits ALL photos to Render → returns jobId instantly.
//   → Render processes all photos in batches internally, writes progress to Neon DB.
//   → Deduplicates: if an active job exists for this survey, returns its ID.
//   → Rate limits: max 3 active jobs per user.
//
// GET  /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → PURE DB READ — instant status/progress. No Render communication.
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
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
  summarizeOpenSourcePhotoVisionRun,
} from '@/lib/db-neon';
import {
  createAndSubmitJob,
  getJob,
  findActiveJobForSurvey,
  countActiveJobsForUser,
  cancelJob,
  markStaleJobsFailed,
  updatePhotoLabelsFromCandidates,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import {
  getExternalOpenCvWorkerUrl,
  fetchHealth,
} from '@/lib/assistedEvidenceSources/externalOpenCvPhotoVisionClient';
import type { OpenSourcePhotoVisionRunResult } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import { convertWorkerResultToPhotoVisionResults, enrichPhotoContextWithSurveyData, resolveReferenceImageUrl } from '@/lib/vision/workerResultConverter';
import { aggregateVisionResults } from '@/lib/vision/visionAggregator';

const MAX_ACTIVE_JOBS_PER_USER = 3;

// ---------------------------------------------------------------------------
// POST — Create async job + submit ALL photos to Render (returns instantly)
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

  // Housekeeping: mark stale jobs as failed
  try {
    const staleCount = await markStaleJobsFailed();
    if (staleCount > 0) {
      console.log(`[GET open-source-photo-vision-pass] Marked ${staleCount} stale job(s) as failed`);
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

  // Completed job — return full results
  if (job.status === 'completed') {
    return handleCompletedJob(job, surveyId);
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

  // Auto-assign photo labels from YOLO/OCR candidates (Option 1)
  let labelUpdateResult = null;
  try {
    labelUpdateResult = await updatePhotoLabelsFromCandidates(surveyId, job.userId, run);
    console.log(`[GET open-source-photo-vision-pass] Photo label auto-update: filesWithCandidates=${labelUpdateResult.filesWithCandidates}, filesUpdated=${labelUpdateResult.filesUpdated}`);
  } catch (labelErr) {
    console.error('[GET open-source-photo-vision-pass] Photo label auto-update failed:', labelErr instanceof Error ? labelErr.message : String(labelErr));
    // Don't fail the response if label update fails — it's a secondary optimization
  }

  // ── Phase 4A: Convert worker results → PhotoVisionResult[] → aggregateVisionResults ──
  let aggregationResult = null;
  try {
    const projectId = run.projectId ?? job.surveyId; // Fallback to surveyId if projectId is null
    const photoVisionResults = convertWorkerResultToPhotoVisionResults(run, projectId);

    // Enrich photo contexts with survey data (GPS, azimuth, pitch, label, roofPlaneId)
    // Then resolve referenceImageUrl via the 5-tier priority chain
    const surveyFiles = await getSiteSurveyFiles(surveyId);
    const photoFiles = surveyFiles.filter(f => f.fileType === 'photo');

    // Build per-roof-plane reference image lookup from survey/project data
    const roofPlaneReferenceImages: Record<string, string> = {};
    for (const sf of photoFiles) {
      const planeId = (sf as unknown as Record<string, unknown>).roofPlaneId as string | null | undefined;
      const refUrl = (sf as unknown as Record<string, unknown>).referenceImageUrl as string | null | undefined;
      if (planeId && refUrl) {
        roofPlaneReferenceImages[planeId] = refUrl;
      }
    }

    for (const pvr of photoVisionResults) {
      const surveyFile = photoFiles.find(sf => sf.id === pvr.fileId);
      if (surveyFile) {
        const surveyFileAny = surveyFile as unknown as Record<string, unknown>;
        const surveyRoofPlaneId = surveyFileAny.roofPlaneId as string | null ?? null;
        enrichPhotoContextWithSurveyData(pvr, {
          fileId: surveyFile.id,
          lat: surveyFileAny.lat as number | null ?? null,
          lng: surveyFileAny.lng as number | null ?? null,
          azimuth: surveyFileAny.azimuth as number | null ?? null,
          pitch: surveyFileAny.pitch as number | null ?? null,
          label: surveyFile.label ?? null,
          roofPlaneId: surveyRoofPlaneId,
          referenceImageUrl: null, // Will be resolved by priority chain below
        });

        // Resolve referenceImageUrl via priority chain:
        // 1. Roof plane reference image → 2. CAD/SVG raster → 3. Orthographic artifact → 4. Survey-selected reference photo → 5. null
        const resolvedRefUrl = resolveReferenceImageUrl({
          roofPlaneReferenceImages,
          roofPlaneId: surveyRoofPlaneId,
          cadSvgRasterUrl: (run as unknown as Record<string, unknown>).cadSvgRasterUrl as string | null ?? null,
          orthographicArtifactUrl: (run as unknown as Record<string, unknown>).orthographicArtifactUrl as string | null ?? null,
          surveySelectedReferenceUrl: surveyFileAny.referenceImageUrl as string | null ?? null,
        });
        pvr.photoContext.referenceImageUrl = resolvedRefUrl;
      }
    }

    aggregationResult = await aggregateVisionResults(
      photoVisionResults,
      projectId,
      surveyId,
    );
    console.log(`[GET open-source-photo-vision-pass] Phase 4A aggregation: obstructions=${aggregationResult.obstructions.length} electrical=${aggregationResult.electricalNodes.length} corrections=${aggregationResult.planeCorrections.length}`);
  } catch (aggErr) {
    console.error('[GET open-source-photo-vision-pass] Phase 4A aggregation failed (non-fatal):', aggErr instanceof Error ? aggErr.message : String(aggErr));
    // Non-fatal: aggregation failure should not prevent returning the raw worker results
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
      labelUpdate: labelUpdateResult,
      phase4a: aggregationResult ? {
        photosProcessed: aggregationResult.photosProcessed,
        rawDetectionCount: aggregationResult.rawDetectionCount,
        obstructionNodes: aggregationResult.obstructions.length,
        electricalNodes: aggregationResult.electricalNodes.length,
        planeCorrections: aggregationResult.planeCorrections.length,
        classCounts: aggregationResult.classCounts,
        hasHighConfidenceDetections: aggregationResult.hasHighConfidenceDetections,
        logSample: aggregationResult.log.slice(-5),
      } : null,
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
