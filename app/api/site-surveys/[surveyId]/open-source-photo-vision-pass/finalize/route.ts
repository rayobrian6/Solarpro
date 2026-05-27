// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass/finalize
//
// Runs heavy post-processing for a completed photo vision job:
//   1. Persist candidates to DB
//   2. Update photo labels from YOLO/OCR candidates
//   3. Register obstructions
//   4. OpenAI Vision fallback classification
//   5. Phase 4A aggregation (homography projection)
//
// This route is called EXPLICITLY by the UI after the worker completes.
// The GET polling route only reads finalization_status/result from DB —
// it never runs heavy work.
//
// Idempotency:
//   - If finalization_status='complete', returns stored results immediately.
//   - If finalization_status='running' (stale >2min), resets to 'pending' first.
//   - CAS on finalization_status='pending' prevents duplicate runs.
//   - Candidate persistence uses (surveyId, runHash) dedup.
//
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  isValidUUID,
  getSiteSurveyFiles,
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
} from '@/lib/db-neon';
import {
  getJob,
  markFinalizationStarted,
  markFinalizationComplete,
  markFinalizationFailed,
  resetStuckFinalization,
  updatePhotoLabelsFromCandidates,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import { convertWorkerResultToPhotoVisionResults, enrichPhotoContextWithSurveyData, resolveReferenceImageUrl } from '@/lib/vision/workerResultConverter';
import { aggregateVisionResults } from '@/lib/vision/visionAggregator';

// ---------------------------------------------------------------------------
// POST — Run finalization for a completed job
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const finalizeStart = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';

  // Auth check
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
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

  console.log(`[finalize:start] surveyId=${surveyId} jobId=${jobId}`);

  // Verify job exists and belongs to this survey
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }
  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  // Job must be completed to finalize
  if (job.status !== 'completed') {
    return NextResponse.json({
      success: false,
      error: `Job status is '${job.status}', expected 'completed'. Finalization can only run on completed jobs.`,
      jobId: job.jobId,
      status: job.status,
      finalizationStatus: job.finalizationStatus,
    }, { status: 400 });
  }

  // ── Idempotency: already finalized? Return stored results ──
  if (job.finalizationStatus === 'complete' && job.finalizationResult) {
    console.log(`[finalize:complete] jobId=${jobId} already finalized (idempotent return)`);
    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      finalizationStatus: 'complete',
      finalizationResult: job.finalizationResult,
      durationMs: Date.now() - finalizeStart,
    });
  }

  // ── Handle stuck 'running' status (from killed fire-and-forget) ──
  if (job.finalizationStatus === 'running') {
    const reset = await resetStuckFinalization(jobId);
    if (reset) {
      console.log(`[finalize:start] jobId=${jobId} reset stuck 'running' finalization back to 'pending'`);
      // Re-read job after reset
      const refreshed = await getJob(jobId);
      if (refreshed) {
        job.finalizationStatus = refreshed.finalizationStatus;
        job.finalizationResult = refreshed.finalizationResult;
        job.finalizationError = refreshed.finalizationError;
      }
    } else {
      // Still genuinely running (<2min) — another request is finalizing right now
      console.log(`[finalize:start] jobId=${jobId} finalization is actively running, returning status`);
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        finalizationStatus: 'running',
        message: 'Finalization is currently in progress. Poll GET for completion.',
      });
    }
  }

  // ── Claim the finalization slot (CAS) ──
  if (job.finalizationStatus === 'pending' || job.finalizationStatus === 'failed') {
    const claimed = await markFinalizationStarted(jobId);
    if (!claimed) {
      // Another request claimed it first
      console.log(`[finalize:start] jobId=${jobId} finalization slot already claimed, returning status`);
      const refreshed = await getJob(jobId);
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        finalizationStatus: refreshed?.finalizationStatus ?? 'running',
        message: 'Finalization is currently in progress. Poll GET for completion.',
      });
    }
  }

  // ── Run the full finalization pipeline ──
  const run = job.result!;
  const runHash = run.runHash;
  const finalizationResult: Record<string, unknown> = {};

  try {
    // ── Step 1: Persist candidates to DB ──
    const persistStart = Date.now();
    let stored = null;
    try {
      stored = await replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, job.userId, run);
      console.log(`[finalize:persist:end] jobId=${jobId} runHash=${runHash} stored=${!!stored} duration=${Date.now() - persistStart}ms`);
    } catch (dbErr) {
      console.error(`[finalize:persist:end] jobId=${jobId} runHash=${runHash} FAILED: ${dbErr instanceof Error ? dbErr.message : String(dbErr)} duration=${Date.now() - persistStart}ms`);
    }
    finalizationResult.stored = stored;

    // ── Step 2: Update photo labels from YOLO/OCR candidates ──
    const labelStart = Date.now();
    let labelUpdateResult = null;
    try {
      labelUpdateResult = await updatePhotoLabelsFromCandidates(surveyId, job.userId, run);
      console.log(`[finalize:labels:end] jobId=${jobId} runHash=${runHash} filesWithCandidates=${labelUpdateResult.filesWithCandidates} filesUpdated=${labelUpdateResult.filesUpdated} duration=${Date.now() - labelStart}ms`);
    } catch (labelErr) {
      console.error(`[finalize:labels:end] jobId=${jobId} runHash=${runHash} FAILED: ${labelErr instanceof Error ? labelErr.message : String(labelErr)} duration=${Date.now() - labelStart}ms`);
    }
    finalizationResult.labelUpdate = labelUpdateResult
      ? {
          filesWithCandidates: labelUpdateResult.filesWithCandidates,
          filesUpdated: labelUpdateResult.filesUpdated,
          visionClassified: labelUpdateResult.visionClassification?.totalClassified ?? 0,
        }
      : null;

    // ── Step 3: Phase 4A aggregation ──
    const phase4aStart = Date.now();
    console.log(`[finalize:phase4a:start] jobId=${jobId} runHash=${runHash} starting Phase 4A aggregation`);
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
      console.log(`[finalize:phase4a:end] jobId=${jobId} runHash=${runHash} obstructions=${aggregationResult.obstructions.length} electrical=${aggregationResult.electricalNodes.length} corrections=${aggregationResult.planeCorrections.length} duration=${phase4aDuration}ms`);
    } catch (aggErr) {
      const phase4aDuration = Date.now() - phase4aStart;
      console.error(`[finalize:phase4a:end] jobId=${jobId} runHash=${runHash} FAILED (non-fatal): ${aggErr instanceof Error ? aggErr.message : String(aggErr)} duration=${phase4aDuration}ms`);
    }

    // ── Build Phase 4A diagnostics shape ──
    if (aggregationResult) {
      const logLines = aggregationResult.log;
      const projectionMethodCounts: Record<string, number> = {};
      const fallbackReasonCounts: Record<string, number> = {};
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
          fallbackReasonCounts['budget_exhausted'] = (fallbackReasonCounts['budget_exhausted'] ?? 0) + 1;
        }
        // Parse homographyAttempts
        if (line.includes('homographyAttempts=')) {
          homographyAttempted = true;
        }
        // Parse fallback reasons from projection function
        if (line.includes('homography_projection_disabled')) {
          fallbackReasonCounts['homography_projection_disabled'] = (fallbackReasonCounts['homography_projection_disabled'] ?? 0) + 1;
        }
        if (line.includes('missing_reference_image')) {
          fallbackReasonCounts['missing_reference_image'] = (fallbackReasonCounts['missing_reference_image'] ?? 0) + 1;
        }
        if (line.includes('missing_gps_coords')) {
          fallbackReasonCounts['missing_gps_coords'] = (fallbackReasonCounts['missing_gps_coords'] ?? 0) + 1;
        }
        if (line.includes('insufficient_inliers')) {
          fallbackReasonCounts['insufficient_inliers'] = (fallbackReasonCounts['insufficient_inliers'] ?? 0) + 1;
        }
        if (line.includes('reprojection_error_too_high')) {
          fallbackReasonCounts['reprojection_error_too_high'] = (fallbackReasonCounts['reprojection_error_too_high'] ?? 0) + 1;
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
    const totalDuration = Date.now() - finalizeStart;
    console.log(`[finalize:complete] jobId=${jobId} runHash=${runHash} totalDuration=${totalDuration}ms`);

    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      finalizationStatus: 'complete',
      finalizationResult,
      durationMs: totalDuration,
    });
  } catch (fatalErr) {
    const totalDuration = Date.now() - finalizeStart;
    const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[finalize:failed] jobId=${jobId} runHash=${runHash} FATAL: ${errMsg} duration=${totalDuration}ms`);
    try {
      await markFinalizationFailed(job.jobId, errMsg);
    } catch (markErr) {
      console.error(`[finalize:failed] jobId=${jobId} also failed to mark finalization as failed:`, markErr);
    }
    return NextResponse.json({
      success: false,
      jobId: job.jobId,
      finalizationStatus: 'failed',
      error: errMsg,
      durationMs: totalDuration,
    }, { status: 500 });
  }
}
