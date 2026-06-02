/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/execute
 *
 * Background worker endpoint for executing the geometry reconstruction pipeline.
 *
 * This endpoint is triggered by the /start route via waitUntil(fetch()).
 * It marks the job as running, returns 200 immediately, then uses waitUntil()
 * to run the pipeline in the background. This gives the pipeline the full
 * serverless function lifetime (up to 300s with Vercel Pro) without blocking
 * the /start route's response.
 *
 * Architecture:
 *   POST /start -> create job (queued) -> return 202 -> waitUntil(fetch(/execute))
 *   POST /execute -> mark running -> return 200 -> waitUntil(run pipeline)
 *   GET /status -> poll DB -> return progress
 *
 * Heartbeat protocol:
 *   - Initial heartbeat written when job is marked as running (stage='segmentation')
 *   - After each pipeline stage completes, currentStage + last_heartbeat_at are updated
 *   - A periodic heartbeat timer fires every 30s to prevent staleness during
 *     long-running stages (especially SAM2 segmentation which can take ~250s)
 *   - If the function times out or crashes, heartbeat staleness detection
 *     (HEARTBEAT_TIMEOUT_MS = 10min) will mark the job as failed
 *
 * If the pipeline fails or times out:
 *   - On failure: job is marked as 'failed' with partial artifacts preserved
 *   - On timeout: heartbeat staleness detector marks job as 'failed'
 *   - In both cases: the client sees an explicit failure via GET /status
 *
 * Security: Requires X-Internal-Auth header matching INTERNAL_WORKER_AUTH_TOKEN.
 * This endpoint is NOT intended for external use -- it's an internal worker trigger.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Full 5-minute timeout -- pipeline runs via waitUntil

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import {
  updateReconstructionJobStatus,
  updateJobHeartbeatInDb,
  insertReconstructionArtifactsBatch,
  deleteArtifactsBySurvey,
} from '@/lib/db/geometryReconstruction';
import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
import { warmupSAM2Service } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
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

  // -- Return 200 immediately, then run pipeline via waitUntil ---------------
  // This is the key change: we return 200 so the /start route's waitUntil(fetch)
  // resolves quickly. The pipeline then runs in the background using this
  // function's own waitUntil, which has the full 300s timeout.
  const response = NextResponse.json({
    success: true,
    jobId,
    status: 'running',
    message: 'Pipeline execution started. Use GET /status to monitor progress.',
  });

  // Fire SAM2 warmup as early as possible
  warmupSAM2Service();

  // Run the pipeline in the background using waitUntil
  waitUntil(
    (async () => {
      // Start periodic heartbeat timer to prevent staleness during long stages
      const stopHeartbeat = startHeartbeatTimer(jobId);

      try {
        console.info(
          `[POST geometry-reconstruction/execute] Starting pipeline execution for job=${jobId}, pipeline=${pipeline}`,
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
        // The pipeline returns a `stages` array with each stage name; we map
        // the last stage name to the DB's current_stage column so that
        // GET /status can show which stage the pipeline reached.
        if (stages.length > 0) {
          const lastStage = stages[stages.length - 1].stage;
          // Map pipeline stage names to DB stage names (pipeline uses slightly
          // different names than the PIPELINE_STAGES array in asyncJobManager)
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
          `[POST geometry-reconstruction/execute] Pipeline completed for job=${jobId}: ${totalDurationMs}ms total, stages: [${stageSummary}]`,
        );

        const rawArtifactCount = artifacts.length;
        const rawConsensusPlaneCount = artifacts.filter(
          (artifact) => artifact.artifactType === 'consensus_plane_candidate',
        ).length;
        const rawPolygonArtifactCount = artifacts.filter(
          (artifact) => 'polygon' in artifact && Array.isArray(artifact.polygon) && artifact.polygon.length > 0,
        ).length;

        // Persist artifacts (clean up old artifacts first to avoid accumulation)
        const tDbStart = Date.now();
        const deletedReconCount = await deleteArtifactsBySurvey(surveyId);
        if (deletedReconCount > 0) {
          console.info(
            `[POST geometry-reconstruction/execute] Deleted ${deletedReconCount} previous reconstruction artifacts for survey=${surveyId}`,
          );
        }
        const batchResult = await insertReconstructionArtifactsBatch(jobId, surveyId, 'system-worker', artifacts, pipeline);
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

        console.info(
          `[POST geometry-reconstruction/execute] Job ${jobId} completed successfully: ${rawArtifactCount} artifacts, ${totalDurationMs}ms`,
        );
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
      } finally {
        // Always stop the heartbeat timer
        stopHeartbeat();
      }
    })()
  );

  return response;
}
