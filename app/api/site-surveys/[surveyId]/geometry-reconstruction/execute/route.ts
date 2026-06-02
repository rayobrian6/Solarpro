/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/execute
 *
 * Background worker endpoint for executing the geometry reconstruction pipeline.
 *
 * NOTE: The /start route now runs the pipeline INLINE (maxDuration=300) and
 * returns 200 with results directly. This /execute endpoint is kept as a
 * fallback for:
 *   - Stale-job recovery: if a job is stuck in 'queued' or 'running' state
 *   - Manual retry: if the inline execution failed and needs to be re-run
 *   - Debugging: can be called directly to test the pipeline
 *
 * This endpoint is NOT called by the normal /start flow. The /start route
 * runs the pipeline directly and returns the result inline.
 *
 * Architecture (current):
 *   POST /start -> create job -> run pipeline inline -> return 200/500
 *   GET /status -> poll DB -> return progress
 *   POST /execute -> (fallback) run pipeline for a specific job
 *
 * WHY WE AWAIT DIRECTLY (not waitUntil):
 *   The /start route now runs the pipeline inline, so this endpoint is only
 *   used as a fallback. When called directly (e.g., for stale-job recovery),
 *   we await the pipeline directly to ensure outbound fetch calls to the
 *   SAM2 Render service are properly sustained for the full pipeline duration.
 *   This is critical — the old waitUntil() approach caused Render to never
 *   receive segmentation requests because waitUntil is designed for short-lived
 *   side effects, not long-running background jobs.
 *
 * Heartbeat protocol:
 *   - Initial heartbeat written when job is marked as running (stage='segmentation')
 *   - After each pipeline stage completes, currentStage + last_heartbeat_at are updated
 *   - A periodic heartbeat timer fires every 30s to prevent staleness during
 *     long-running stages (especially SAM2 segmentation which can take ~250s)
 *   - If the function times out or crashes, heartbeat staleness detection
 *     (HEARTBEAT_TIMEOUT_MS = 10min) will mark the job as failed
 *
 * Security: Requires X-Internal-Auth header matching INTERNAL_WORKER_AUTH_TOKEN.
 * This endpoint is NOT intended for external use -- it's an internal worker trigger.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Full 5-minute timeout — pipeline is awaited directly

import { NextRequest, NextResponse } from 'next/server';
import {
  updateReconstructionJobStatus,
  updateJobHeartbeatInDb,
  insertReconstructionArtifactsBatch,
  deleteArtifactsBySurvey,
  getSurveyOwnerId,
} from '@/lib/db/geometryReconstruction';
import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
import { warmupSAM2Service, isSAM2Enabled } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
import { adaptGeometryReconBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsBySurvey } from '@/lib/siteSurveys/unifiedGeometry';
import type { GeometryReconstructionInput } from '@/lib/siteSurveys/geometryReconstruction/types';

// Internal auth token -- must match the token used by /start route
const INTERNAL_AUTH_TOKEN = process.env.INTERNAL_WORKER_AUTH_TOKEN ?? 'geometry-recon-worker-2025';

/** Heartbeat interval: update last_heartbeat_at every 30s during pipeline execution. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Start a periodic heartbeat timer that updates the job's heartbeat in the DB.
 * Returns a cleanup function that stops the timer.
 *
 * This prevents the heartbeat from going stale during long-running stages
 * (especially SAM2 segmentation which can take ~250s for 10 photos).
 * Without this, the 10-minute staleness detector could falsely mark a
 * healthy job as failed if a single stage takes >10 minutes.
 *
 * The timer is best-effort: heartbeat failures are logged but don't crash the pipeline.
 */
function startHeartbeatTimer(jobId: string): () => void {
  const timer = setInterval(() => {
    updateJobHeartbeatInDb(jobId, 'running_heartbeat').catch(() => {
      // Best-effort: timer heartbeat failure should not affect the pipeline
    });
  }, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';
  const tRouteStart = Date.now();

  // -- Internal auth check ---------------------------------------------------
  const authToken = req.headers.get('X-Internal-Auth');
  if (authToken !== INTERNAL_AUTH_TOKEN) {
    console.warn(`[POST geometry-reconstruction/execute] Unauthorized execution attempt for survey=${surveyId}`);
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let jobId: string;
  let pipeline: string;
  let input: GeometryReconstructionInput;

  try {
    const body = await req.json();
    ({ jobId, pipeline, input } = body as {
      jobId: string;
      surveyId: string;
      pipeline: string;
      input: GeometryReconstructionInput;
    });

    if (!jobId || !surveyId || !pipeline || !input) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: jobId, surveyId, pipeline, input' },
        { status: 400 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  // -- Mark job as running with initial heartbeat ----------------------------
  try {
    await updateReconstructionJobStatus(jobId, 'running');
    // Set initial stage to 'segmentation' (first pipeline stage)
    await updateJobHeartbeatInDb(jobId, 'segmentation');
    console.info(
      `[POST geometry-reconstruction/execute] Job ${jobId} marked as running for pipeline=${pipeline}, survey=${surveyId}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[POST geometry-reconstruction/execute] Failed to mark job=${jobId} as running: ${msg}`);
    return NextResponse.json(
      { success: false, error: `Failed to mark job as running: ${msg}` },
      { status: 500 },
    );
  }

  // -- Fire SAM2 warmup as early as possible ---------------------------------
  // This triggers model loading on Render's cold start while we set up.
  const sam2WasEnabled = isSAM2Enabled();
  if (sam2WasEnabled) {
    console.info(
      `[POST geometry-reconstruction/execute] SAM2 is enabled — firing warmup ping to Render service`,
    );
  } else {
    console.warn(
      `[POST geometry-reconstruction/execute] SAM2_SERVICE_URL is NOT set — pipeline will use Canny as explicit backend (no Render calls)`,
    );
  }
  warmupSAM2Service();

  // -- Run the pipeline DIRECTLY (await, not waitUntil) ---------------------
  // This is the key fix: we await the pipeline directly instead of using
  // waitUntil(). This keeps the Node.js event loop alive and sustains
  // outbound fetch calls to the SAM2 Render service for the full pipeline
  // duration (up to 300s with Vercel Pro).
  //
  // The /start route's waitUntil(fetch('/execute')) will time out after 60s
  // (since /start has maxDuration=60), but this /execute function is a 
  // SEPARATE Vercel invocation with its own 300s lifetime. It continues 
  // running even after /start's waitUntil is cancelled.
  //
  // The client already received 202 from /start and is polling GET /status.

  const stopHeartbeat = startHeartbeatTimer(jobId);

  try {
    console.info(
      `[POST geometry-reconstruction/execute] Starting pipeline execution for job=${jobId}, pipeline=${pipeline} (SAM2 enabled: ${sam2WasEnabled})`,
    );

    // Select the appropriate pipeline runner based on the pipeline mode
    let pipelineResult;
    switch (pipeline) {
      case 'segmentation_only':
      case 'segmentation':
        await updateJobHeartbeatInDb(jobId, 'segmentation');
        pipelineResult = await runSegmentationOnlyPipeline(input);
        break;
      case 'depth_only':
      case 'depth_estimation':
        await updateJobHeartbeatInDb(jobId, 'segmentation');
        pipelineResult = await runDepthOnlyPipeline(input);
        break;
      case 'full':
      case 'line_extraction':
      case 'plane_extraction':
      case 'multi_view_fusion':
      default:
        pipelineResult = await runFullGeometryReconstructionPipeline(input);
        break;
    }

    const { artifacts, stages, totalDurationMs, segmentationBackend, sam2PhotoCount, failedPhotoCount, skippedPhotoCount, cannyPhotoCount, photoResults, budgetExhaustedReason } = pipelineResult;

    // Update currentStage based on the last completed pipeline stage.
    if (stages.length > 0) {
      const lastStage = stages[stages.length - 1].stage;
      const stageMap: Record<string, string> = {
        'segmentation': 'segmentation',
        'line_extraction': 'line_extraction',
        'vanishing_points': 'vanishing_point_estimation',
        'depth_estimation': 'depth_estimation',
        'plane_extraction': 'plane_extraction',
        'multi_view_fusion': 'multi_view_fusion',
        'photogrammetry': 'completed',
      };
      const dbStage = stageMap[lastStage] ?? lastStage;
      await updateJobHeartbeatInDb(jobId, dbStage);
    }

    // Log per-stage timing for debugging
    const stageSummary = stages.map(s => `${s.stage}=${s.durationMs}ms(${s.artifactCount} artifacts)`).join(', ');
    console.info(
      `[POST geometry-reconstruction/execute] Pipeline completed for job=${jobId}: ${totalDurationMs}ms total, backend=${segmentationBackend}, stages: [${stageSummary}]`,
    );

    const rawArtifactCount = artifacts.length;
    const rawConsensusPlaneCount = artifacts.filter(
      (artifact) => artifact.artifactType === 'consensus_plane_candidate',
    ).length;
    const rawPolygonArtifactCount = artifacts.filter(
      (artifact) => 'polygon' in artifact && Array.isArray(artifact.polygon) && artifact.polygon.length > 0,
    ).length;

    // Persist artifacts (clean up old artifacts first to avoid accumulation)
    // Resolve the survey owner's userId — needed for verifySurveyOwnership inside
    // insertReconstructionArtifactsBatch. We can't use 'system-worker' because
    // that's not a valid UUID and will fail the clients.user_id JOIN.
    const surveyOwnerUserId = await getSurveyOwnerId(surveyId);
    if (!surveyOwnerUserId) {
      throw new Error(`Survey owner not found for surveyId=${surveyId} — cannot persist artifacts`);
    }
    const tDbStart = Date.now();
    const deletedReconCount = await deleteArtifactsBySurvey(surveyId);
    if (deletedReconCount > 0) {
      console.info(
        `[POST geometry-reconstruction/execute] Deleted ${deletedReconCount} previous reconstruction artifacts for survey=${surveyId}`,
      );
    }
    const batchResult = await insertReconstructionArtifactsBatch(jobId, surveyId, surveyOwnerUserId, artifacts, pipeline);
    console.info(
      `[POST geometry-reconstruction/execute] Batch inserted ${batchResult.inserted}/${artifacts.length} reconstruction artifacts (failed=${batchResult.failed}) in ${Date.now() - tDbStart}ms`,
    );

    // Adapt Pipeline B artifacts into unified geometry table
    try {
      const tUnifiedStart = Date.now();
      const deletedCount = await deleteUnifiedArtifactsBySurvey(surveyId);
      if (deletedCount > 0) {
        console.info(
          `[POST geometry-reconstruction/execute] Deleted ${deletedCount} previous unified artifacts for survey=${surveyId}`,
        );
      }

      const adaptedArtifacts = adaptGeometryReconBundle(artifacts, surveyId);
      const writeResult = await writeUnifiedArtifacts(adaptedArtifacts);
      console.info(
        `[POST geometry-reconstruction/execute] Adapted ${adaptedArtifacts.length} Pipeline B artifacts to unified: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed} in ${Date.now() - tUnifiedStart}ms`,
      );
    } catch (adaptErr) {
      const errMsg = adaptErr instanceof Error ? adaptErr.message : String(adaptErr);
      console.error(
        `[POST geometry-reconstruction/execute] Failed to adapt Pipeline B artifacts to unified table (non-fatal): ${errMsg}`,
      );
    }

    // Mark job as completed
    await updateReconstructionJobStatus(jobId, 'completed');

    const routeDurationMs = Date.now() - tRouteStart;
    console.info(
      `[POST geometry-reconstruction/execute] Job ${jobId} completed successfully: ${rawArtifactCount} artifacts, ${totalDurationMs}ms pipeline, ${routeDurationMs}ms total route`,
    );

    // Return 200 with pipeline results
    return NextResponse.json({
      success: true,
      jobId,
      status: 'completed',
      artifactCount: rawArtifactCount,
      totalDurationMs,
      segmentationBackend,
      sam2PhotoCount,
      failedPhotoCount,
      skippedPhotoCount,
      cannyPhotoCount,
      budgetExhaustedReason,
    });

  } catch (pipelineErr) {
    // Pipeline execution failed -- mark job as failed, preserving partial artifacts
    const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
    console.error(`[POST geometry-reconstruction/execute] Pipeline execution failed for job=${jobId}: ${errMsg}`);
    try {
      await updateReconstructionJobStatus(jobId, 'failed');
    } catch (markFailedErr) {
      console.error(
        `[POST geometry-reconstruction/execute] Also failed to mark job=${jobId} as failed:`,
        markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr),
      );
    }

    return NextResponse.json({
      success: false,
      jobId,
      status: 'failed',
      error: errMsg,
    }, { status: 500 });

  } finally {
    // Always stop the heartbeat timer
    stopHeartbeat();
  }
}
