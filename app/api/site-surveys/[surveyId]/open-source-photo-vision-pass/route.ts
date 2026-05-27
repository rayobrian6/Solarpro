// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass
//   → Creates a job in DB + submits ALL photos to Render → returns jobId instantly.
//   → Render processes all photos in batches internally, writes progress to Neon DB.
//   → Deduplicates: if an active job exists for this survey, returns its ID.
//   → Rate limits: max 3 active jobs per user.
//
// GET  /api/site-surveys/[surveyId]/open-source-photo-vision-pass?jobId=xxx
//   → PURE DB READ — instant status/progress. No Render communication.
//   → For completed jobs: returns immediately with raw worker results.
//     Heavy post-processing (candidate persistence, label updates, obstruction
//     registration, Vision classification, Phase 4A aggregation) runs in a
//     fire-and-forget background function guarded by finalization_status.
//     Subsequent polls read stored finalization results from DB.
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
  markFinalizationStarted,
  markFinalizationComplete,
  markFinalizationFailed,
  type PhotoVisionJob,
  type FinalizationStatus,
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
//
// For completed jobs, returns IMMEDIATELY with raw worker results.
// Heavy post-processing is tracked via finalization_status:
//   - 'pending': kick off background finalization, return raw results
//   - 'running': return raw results + finalizationStatus='running'
//   - 'complete': return raw results + stored finalization results
//   - 'failed': return raw results + finalization error
// ---------------------------------------------------------------------------
export async function GET(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const getStart = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';
  const jobId = req.nextUrl.searchParams.get('jobId');

  console.log(`[cv-pass:get:start] surveyId=${surveyId} jobId=${jobId}`);

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

  console.log(`[cv-pass:worker-status] jobId=${jobId} status=${job.status} finalizationStatus=${job.finalizationStatus}`);

  // Completed job — return full results (lightweight, with background finalization)
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
// Handle a completed job — returns IMMEDIATELY with raw worker results.
//
// Finalization (heavy post-processing) is tracked by finalization_status:
//   'pending'  → kick off background finalization, return raw results
//   'running'  → return raw results + finalizationStatus='running'
//   'complete' → return raw results + stored finalization results
//   'failed'   → return raw results + finalization error
// ---------------------------------------------------------------------------
async function handleCompletedJob(job: PhotoVisionJob, surveyId: string) {
  const handleStart = Date.now();
  const run = job.result!;

  // ── Determine finalization state and act accordingly ──
  let finalizationStatus: FinalizationStatus = job.finalizationStatus;
  let finalizationResult: Record<string, unknown> | null = job.finalizationResult;
  let finalizationError: string | null = job.finalizationError;

  if (finalizationStatus === 'pending') {
    // Try to claim the finalization slot (CAS prevents duplicate runs)
    const claimed = await markFinalizationStarted(job.jobId);
    if (claimed) {
      // We won the race — fire-and-forget background finalization
      console.log(`[cv-pass:get:start] jobId=${job.jobId} finalization claimed, kicking off background finalization`);
      finalizeInBackground(job, surveyId);
      finalizationStatus = 'running';
    } else {
      // Another request is already finalizing — re-read status
      const refreshed = await getJob(job.jobId);
      if (refreshed) {
        finalizationStatus = refreshed.finalizationStatus;
        finalizationResult = refreshed.finalizationResult;
        finalizationError = refreshed.finalizationError;
      }
    }
  }

  // Build the raw worker result response (always returned, regardless of finalization state)
  const summary = uiSummary(run);
  const elapsed = Date.now() - handleStart;
  console.log(`[cv-pass:get:end] jobId=${job.jobId} completed: processed=${run.processedCount} failed=${run.failedCount} candidates=${run.candidateCount} finalizationStatus=${finalizationStatus} elapsed=${elapsed}ms`);

  return NextResponse.json({
    success: true,
    jobId: job.jobId,
    status: 'completed',
    finalizationStatus,
    data: {
      summary,
      run: summarizeOpenSourcePhotoVisionRun(run),
      // If finalization is complete, include its stored results
      stored: (finalizationResult?.stored as Record<string, unknown> | null) ?? null,
      labelUpdate: (finalizationResult?.labelUpdate as Record<string, unknown> | null) ?? null,
      phase4a: (finalizationResult?.phase4a as Record<string, unknown> | null) ?? null,
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
    finalizationError: finalizationStatus === 'failed' ? finalizationError : undefined,
    meta: noMutationMeta({ workerUnavailable: false, sourceImageBytesProcessed: true }),
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
}

// ---------------------------------------------------------------------------
// Background finalization — runs OUTSIDE the request/response cycle.
// All steps have structured timing logs with the requested markers.
// Idempotent: guarded by finalization_status CAS in markFinalizationStarted().
// ---------------------------------------------------------------------------
function finalizeInBackground(job: PhotoVisionJob, surveyId: string) {
  // Fire-and-forget — errors are caught and stored in finalization_error
  const bgPromise = (async () => {
    const bgStart = Date.now();
    const run = job.result!;
    const runHash = run.runHash;
    console.log(`[cv-pass:persist:start] jobId=${job.jobId} runHash=${runHash} starting background finalization`);

    const finalizationResult: Record<string, unknown> = {};

    try {
      // ── Step 1: Persist candidates to DB ──
      const persistStart = Date.now();
      let stored = null;
      try {
        stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, job.userId, run);
        console.log(`[cv-pass:persist:end] jobId=${job.jobId} runHash=${runHash} stored=${!!stored} duration=${Date.now() - persistStart}ms`);
      } catch (dbErr) {
        console.error(`[cv-pass:persist:end] jobId=${job.jobId} runHash=${runHash} DB persist FAILED: ${dbErr instanceof Error ? dbErr.message : String(dbErr)} duration=${Date.now() - persistStart}ms`);
      }
      finalizationResult.stored = stored;

      // ── Step 2: Auto-assign photo labels from YOLO/OCR candidates ──
      const labelStart = Date.now();
      let labelUpdateResult = null;
      try {
        labelUpdateResult = await updatePhotoLabelsFromCandidates(surveyId, job.userId, run);
        console.log(`[cv-pass:label-update:end] jobId=${job.jobId} runHash=${runHash} filesWithCandidates=${labelUpdateResult.filesWithCandidates} filesUpdated=${labelUpdateResult.filesUpdated} duration=${Date.now() - labelStart}ms`);
      } catch (labelErr) {
        console.error(`[cv-pass:label-update:end] jobId=${job.jobId} runHash=${runHash} FAILED: ${labelErr instanceof Error ? labelErr.message : String(labelErr)} duration=${Date.now() - labelStart}ms`);
      }
      finalizationResult.labelUpdate = labelUpdateResult;

      // ── Step 3: Obstruction registration (already inside updatePhotoLabelsFromCandidates,
      //    but we log it here as a logical step for timing) ──
      if (labelUpdateResult?.obstructionRegistration) {
        console.log(`[cv-pass:obstruction-registration:end] jobId=${job.jobId} runHash=${runHash} obstructions=${labelUpdateResult.obstructionRegistration.totalObstructions} roofPhotos=${labelUpdateResult.obstructionRegistration.roofPhotosProcessed}`);
      }

      // ── Step 4: Vision classification (already inside updatePhotoLabelsFromCandidates,
      //    but we log it here as a logical step for timing) ──
      if (labelUpdateResult?.visionClassification) {
        console.log(`[cv-pass:vision-classification:end] jobId=${job.jobId} runHash=${runHash} classified=${labelUpdateResult.visionClassification.totalClassified}`);
      }

      // ── Step 5: Phase 4A aggregation ──
      const phase4aStart = Date.now();
      console.log(`[phase4a:start] jobId=${job.jobId} runHash=${runHash} starting Phase 4A aggregation`);
      let aggregationResult = null;
      try {
        const projectId = run.projectId ?? job.surveyId;
        const photoVisionResults = convertWorkerResultToPhotoVisionResults(run, projectId);

        // Enrich photo contexts with survey data
        const surveyFiles = await getSiteSurveyFiles(surveyId);
        const photoFiles = surveyFiles.filter(f => f.fileType === 'photo');

        // Build per-roof-plane reference image lookup
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
              referenceImageUrl: null,
            });

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
        const phase4aDuration = Date.now() - phase4aStart;
        console.log(`[phase4a:end] jobId=${job.jobId} runHash=${runHash} obstructions=${aggregationResult.obstructions.length} electrical=${aggregationResult.electricalNodes.length} corrections=${aggregationResult.planeCorrections.length} duration=${phase4aDuration}ms`);
      } catch (aggErr) {
        const phase4aDuration = Date.now() - phase4aStart;
        console.error(`[phase4a:end] jobId=${job.jobId} runHash=${runHash} Phase 4A aggregation FAILED (non-fatal): ${aggErr instanceof Error ? aggErr.message : String(aggErr)} duration=${phase4aDuration}ms`);
      }

      // ── Build Phase 4A diagnostics shape ──
      if (aggregationResult) {
        // Compute projection method counts from the log
        const logLines = aggregationResult.log;
        const projectionMethodCounts: Record<string, number> = {};
        const fallbackReasonCounts: Record<string, number> = {};

        // Extract projection method counts from world detections info in the log
        // The aggregator tracks homographyAttempts/successes internally; we parse from log
        let homographyAttempted = false;
        let homographySucceeded = false;
        let avgProjectionConfidence = 0;
        let avgReprojectionError: number | null = null;

        for (const line of logLines) {
          // Parse "projected=HOM/COUNT" from log
          const projMatch = line.match(/projected=(\d+)\/(\d+)/);
          if (projMatch) {
            projectionMethodCounts['homography_assisted'] = parseInt(projMatch[1], 10);
            const total = parseInt(projMatch[2], 10);
            projectionMethodCounts['gps_azimuth_pitch'] = total - parseInt(projMatch[1], 10);
            homographyAttempted = true;
            homographySucceeded = parseInt(projMatch[1], 10) > 0;
          }
          // Parse avgConf
          const confMatch = line.match(/avgConf=([\d.]+)/);
          if (confMatch) {
            avgProjectionConfidence = parseFloat(confMatch[1]);
          }
          // Parse BUDGET_EXHAUSTED
          if (line.includes('BUDGET_EXHAUSTED')) {
            fallbackReasonCounts['budget_exhausted'] = 1;
          }
          // Parse homographyAttempts
          if (line.includes('homographyAttempts=')) {
            homographyAttempted = true;
          }
        }

        finalizationResult.phase4a = {
          status: 'complete' as const,
          photosProcessed: aggregationResult.photosProcessed,
          rawDetectionCount: aggregationResult.rawDetectionCount,
          obstructionNodes: aggregationResult.obstructions.length,
          electricalNodes: aggregationResult.electricalNodes.length,
          planeCorrections: aggregationResult.planeCorrections.length,
          classCounts: aggregationResult.classCounts,
          hasHighConfidenceDetections: aggregationResult.hasHighConfidenceDetections,
          projectionMethodCounts,
          fallbackReasonCounts,
          homographyAttempted,
          homographySucceeded,
          avgProjectionConfidence,
          avgReprojectionError,
          durationMs: Date.now() - phase4aStart,
          logSample: aggregationResult.log.slice(-5),
        };
      } else {
        finalizationResult.phase4a = {
          status: 'failed' as const,
          error: 'Phase 4A aggregation did not produce results',
          projectionMethodCounts: {},
          fallbackReasonCounts: {},
          homographyAttempted: false,
          homographySucceeded: false,
          avgProjectionConfidence: 0,
          avgReprojectionError: null,
          durationMs: Date.now() - phase4aStart,
          logSample: [],
        };
      }

      // ── Mark finalization complete ──
      await markFinalizationComplete(job.jobId, finalizationResult);
      const bgDuration = Date.now() - bgStart;
      console.log(`[cv-pass:get:end] jobId=${job.jobId} runHash=${runHash} background finalization complete: duration=${bgDuration}ms`);
    } catch (fatalErr) {
      const bgDuration = Date.now() - bgStart;
      const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
      console.error(`[cv-pass:get:end] jobId=${job.jobId} runHash=${runHash} background finalization FATAL: ${errMsg} duration=${bgDuration}ms`);
      try {
        await markFinalizationFailed(job.jobId, errMsg);
      } catch (markErr) {
        console.error(`[cv-pass:get:end] jobId=${job.jobId} failed to mark finalization as failed:`, markErr);
      }
    }
  })();

  // Attach a catch handler to prevent unhandled rejection warnings
  bgPromise.catch(() => { /* already handled inside */ });
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
