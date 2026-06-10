/**
 * Render Background Worker — Geometry Reconstruction Pipeline Executor
 *
 * P1 — Execution Architecture: Render Background Worker
 *
 * This is the primary pipeline executor for Pipeline B. It runs as a
 * standalone Node.js service on Render (alongside the SAM2 service).
 *
 * Flow:
 *   1. Poll Neon DB for queued geometry reconstruction jobs
 *   2. Claim one job atomically (CAS on locked_by IS NULL)
 *   3. Execute the full Pipeline B
 *   4. Update heartbeat + currentStage every 30s
 *   5. Persist artifacts incrementally via P0 checkpoint system
 *   6. Mark job as completed/failed and release lock
 *
 * Why Render instead of Vercel?
 *   SAM2 on CPU takes ~53-95s per photo → 15 photos ÷ 2 concurrency = ~8 batches
 *   × ~55s = ~440s → exceeds Vercel's 300s hard limit. Render has no such
 *   constraint — jobs can run for as long as needed.
 *
 * BUILD: npx tsc -p worker/tsconfig.json
 * RUN:   node worker/dist/main.js
 *
 * Environment variables:
 *   DATABASE_URL            — Neon PostgreSQL connection string
 *   SAM2_SERVICE_URL        — SAM2 Python service URL on Render
 *   WORKER_POLL_INTERVAL_MS — Poll interval in ms (default: 5000)
 *   WORKER_ID               — Unique worker identifier (default: auto-generated)
 *   SHUTDOWN_TIMEOUT_MS     — Graceful shutdown timeout (default: 30000)
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import {
  claimNextQueuedJob,
  releaseJobLock,
  requeueJobForRetry,
  updateReconstructionJobStatus,
  updateJobHeartbeatInDb,
  updateJobStageDurations,
  updateJobFailureStage,
  insertReconstructionArtifactsBatch,
  deleteArtifactsByJob,
  getSurveyOwnerId,
} from '@/lib/db/geometryReconstruction';

import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
  type CheckpointCallback,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';

import { warmupSAM2Service, isSAM2Enabled } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
import { adaptGeometryReconBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry';
import type { GeometryReconstructionInput } from '@/lib/siteSurveys/geometryReconstruction/types';

// ── Configuration ────────────────────────────────────────────────────────────

const WORKER_ID = process.env.WORKER_ID ?? `render-worker-${process.env.HOSTNAME ?? 'local'}-${Date.now()}`;
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS ?? '5000', 10);
const HEARTBEAT_INTERVAL_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? '30000', 10);

// ── State ────────────────────────────────────────────────────────────────────

let isShuttingDown = false;
let currentJobId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ── Heartbeat ────────────────────────────────────────────────────────────────

function startHeartbeat(jobId: string, getStage: () => string): () => void {
  const timer = setInterval(() => {
    const stage = getStage();
    updateJobHeartbeatInDb(jobId, stage).catch(() => {
      // Best-effort
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer = timer;
  return () => {
    clearInterval(timer);
    heartbeatTimer = null;
  };
}

// ── Job Execution ────────────────────────────────────────────────────────────

async function executeJob(
  job: {
    id: string;
    surveyId: string;
    pipeline: string;
    input: GeometryReconstructionInput;
  },
): Promise<void> {
  const { id: jobId, surveyId, pipeline, input } = job;
  currentJobId = jobId;
  const tJobStart = Date.now();

  console.info(
    `[Worker ${WORKER_ID}] Executing job=${jobId} survey=${surveyId} pipeline=${pipeline} photos=${input.sourcePhotos.length}`,
  );

  // Resolve survey owner for artifact persistence
  let surveyOwnerUserId: string | null = null;
  try {
    surveyOwnerUserId = await getSurveyOwnerId(surveyId);
    if (!surveyOwnerUserId) {
      throw new Error(`Survey owner not found for surveyId=${surveyId}`);
    }
  } catch (ownerErr) {
    const msg = ownerErr instanceof Error ? ownerErr.message : String(ownerErr);
    console.error(`[Worker ${WORKER_ID}] ${msg}`);
    await updateReconstructionJobStatus(jobId, 'failed');
    await updateJobFailureStage(jobId, 'initialization');
    await releaseJobLock(jobId);
    currentJobId = null;
    return;
  }

  // Fire SAM2 warmup
  const sam2WasEnabled = isSAM2Enabled();
  if (sam2WasEnabled) {
    console.info(`[Worker ${WORKER_ID}] SAM2 enabled — firing warmup ping`);
  } else {
    console.warn(`[Worker ${WORKER_ID}] SAM2_SERVICE_URL not set — will use Canny as explicit backend`);
  }
  warmupSAM2Service();

  // Track latest stage for heartbeat + failure reporting
  let latestStage = 'segmentation';
  let latestStageDurations: Record<string, number> = {};

  // Start heartbeat
  const stopHeartbeat = startHeartbeat(jobId, () => latestStage);

  // Checkpoint callback: persists artifacts after each stage
  const checkpointCallback: CheckpointCallback = async (checkpoint) => {
    const { stage, stageArtifacts, stageDurations, elapsedMs, nextStage } = checkpoint;

    console.info(
      `[Worker ${WORKER_ID}] Checkpoint after stage=${stage}: ` +
      `${stageArtifacts.length} artifacts, ${elapsedMs}ms elapsed, nextStage=${nextStage}`,
    );

    if (nextStage) {
      latestStage = nextStage;
    }
    latestStageDurations = stageDurations;

    // Persist this stage's artifacts to DB immediately (best-effort)
    if (stageArtifacts.length > 0) {
      try {
        const batchResult = await insertReconstructionArtifactsBatch(
          jobId,
          surveyId,
          surveyOwnerUserId!,
          stageArtifacts,
          pipeline,
          stageDurations,
        );
        console.info(
          `[Worker ${WORKER_ID}] Checkpoint persisted ${batchResult.inserted}/${stageArtifacts.length} artifacts from stage=${stage}`,
        );
      } catch (insertErr) {
        const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr);
        console.error(
          `[Worker ${WORKER_ID}] Checkpoint insert failed for stage=${stage}: ${errMsg}`,
        );
        // Best-effort: checkpoint failure must NOT abort the pipeline
      }
    }

    // Update stageDurations + heartbeat on job record
    await updateJobStageDurations(jobId, stageDurations);
    if (nextStage) {
      await updateJobHeartbeatInDb(jobId, nextStage);
    }
  };

  try {
    // Execute the pipeline
    let pipelineResult;
    switch (pipeline) {
      case 'segmentation_only':
      case 'segmentation':
        await updateJobHeartbeatInDb(jobId, 'segmentation');
        pipelineResult = await runSegmentationOnlyPipeline(input, checkpointCallback);
        break;
      case 'depth_only':
      case 'depth_estimation':
        await updateJobHeartbeatInDb(jobId, 'segmentation');
        pipelineResult = await runDepthOnlyPipeline(input, checkpointCallback);
        break;
      case 'full':
      case 'line_extraction':
      case 'plane_extraction':
      case 'multi_view_fusion':
      default:
        pipelineResult = await runFullGeometryReconstructionPipeline(input, checkpointCallback);
        break;
    }

    const {
      artifacts, stages, totalDurationMs, stageDurations,
      segmentationBackend, sam2PhotoCount, failedPhotoCount,
      skippedPhotoCount, cannyPhotoCount, budgetExhaustedReason,
    } = pipelineResult;

    // Update currentStage from last completed stage
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
      latestStage = dbStage;
    }

    // Log summary
    const stageSummary = stages.map(s => `${s.stage}=${s.durationMs}ms(${s.artifactCount})`).join(', ');
    console.info(
      `[Worker ${WORKER_ID}] Pipeline completed for job=${jobId}: ${totalDurationMs}ms, backend=${segmentationBackend}, stages: [${stageSummary}]`,
    );

    // Final artifact persistence: replace checkpointed partials with complete set
    const deletedReconCount = await deleteArtifactsByJob(jobId);
    if (deletedReconCount > 0) {
      console.info(
        `[Worker ${WORKER_ID}] Replaced ${deletedReconCount} checkpointed artifacts with complete set`,
      );
    }
    const batchResult = await insertReconstructionArtifactsBatch(
      jobId, surveyId, surveyOwnerUserId!, artifacts, pipeline, stageDurations,
    );
    console.info(
      `[Worker ${WORKER_ID}] Batch inserted ${batchResult.inserted}/${artifacts.length} artifacts (failed=${batchResult.failed})`,
    );

    // Update final stageDurations
    await updateJobStageDurations(jobId, stageDurations);

    // Adapt Pipeline B artifacts into unified geometry table
    // Cleanup: remove stale Pipeline B artifacts BEFORE writing new ones.
    // Uses pipeline-scoped deletion (not survey-wide) to preserve artifacts
    // from other pipelines (photo_vision, google_solar_api, manual).
    try {
      const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');
      if (deletedCount > 0) {
        console.info(
          `[Worker ${WORKER_ID}] Cleaned up ${deletedCount} stale geometry_recon artifacts for survey=${surveyId} (pipeline-scoped, other pipelines preserved)`,
        );
      }
      const adaptedArtifacts = adaptGeometryReconBundle(artifacts, surveyId);
      const writeResult = await writeUnifiedArtifacts(adaptedArtifacts);
      console.info(
        `[Worker ${WORKER_ID}] Adapted ${adaptedArtifacts.length} artifacts to unified: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed}`,
      );
    } catch (adaptErr) {
      const errMsg = adaptErr instanceof Error ? adaptErr.message : String(adaptErr);
      console.error(
        `[Worker ${WORKER_ID}] Unified artifact adaptation failed (non-fatal): ${errMsg}`,
      );
    }

    // Mark job as completed and release lock
    await updateReconstructionJobStatus(jobId, 'completed');
    await releaseJobLock(jobId);

    const jobDurationMs = Date.now() - tJobStart;
    console.info(
      `[Worker ${WORKER_ID}] Job ${jobId} COMPLETED: ${artifacts.length} artifacts, ${jobDurationMs}ms total`,
    );

  } catch (pipelineErr) {
    // Pipeline failed — preserve partial artifacts
    const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
    console.error(`[Worker ${WORKER_ID}] Pipeline FAILED for job=${jobId}: ${errMsg}`);

    // Record failure metadata (best-effort)
    try {
      await updateJobStageDurations(jobId, latestStageDurations);
      await updateJobFailureStage(jobId, latestStage);
    } catch { /* best-effort */ }

    // Mark job as failed and release lock
    try {
      await updateReconstructionJobStatus(jobId, 'failed');
    } catch { /* best-effort */ }
    await releaseJobLock(jobId);

    console.info(
      `[Worker ${WORKER_ID}] Job ${jobId} FAILED at stage=${latestStage}. ` +
      `Checkpointed artifacts from earlier stages may be available in DB.`,
    );

  } finally {
    stopHeartbeat();
    currentJobId = null;
  }
}

// ── Polling Loop ─────────────────────────────────────────────────────────────

async function pollOnce(): Promise<void> {
  if (isShuttingDown) return;

  try {
    const job = await claimNextQueuedJob(WORKER_ID);
    if (job) {
      console.info(
        `[Worker ${WORKER_ID}] Claimed job=${job.id} survey=${job.surveyId} pipeline=${job.pipeline}`,
      );
      await executeJob(job);
    }
    // No job available — just wait and poll again
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Worker ${WORKER_ID}] Poll error: ${errMsg}`);
  }
}

function scheduleNextPoll(): void {
  if (isShuttingDown) return;
  pollTimer = setTimeout(async () => {
    await pollOnce();
    scheduleNextPoll();
  }, POLL_INTERVAL_MS);
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.info(`[Worker ${WORKER_ID}] Received ${signal} — initiating graceful shutdown`);

  // Stop polling for new jobs
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  // If we're currently executing a job, wait briefly for a near-done job to
  // finish, then REQUEUE it for retry instead of orphaning it (Priority 3 —
  // Issue 1: deploy_retry). The wait is bounded so the requeue DB write lands
  // before the platform escalates SIGTERM → SIGKILL (Render grace ~30s).
  if (currentJobId) {
    const waitMs = Math.max(0, Math.min(SHUTDOWN_TIMEOUT_MS, 25_000) - 5_000);
    console.info(
      `[Worker ${WORKER_ID}] Waiting up to ${waitMs}ms for current job=${currentJobId} to finish before requeue`,
    );
    const shutdownDeadline = Date.now() + waitMs;
    while (currentJobId && Date.now() < shutdownDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (currentJobId) {
      // Deploy interrupted an active job — requeue for retry, do not orphan.
      const jobId = currentJobId;
      try {
        const previousStatus = await requeueJobForRetry(jobId);
        console.info(
          `[Lifecycle] ${JSON.stringify({
            reclaimPath: 'deploy_retry',
            jobId,
            previousStatus: previousStatus ?? 'unknown',
            newStatus: 'queued',
            reason: `${signal} during active job`,
            worker: WORKER_ID,
            ts: new Date().toISOString(),
          })}`,
        );
      } catch (requeueErr) {
        console.error(
          `[Worker ${WORKER_ID}] Failed to requeue job=${jobId} on shutdown: ` +
          `${requeueErr instanceof Error ? requeueErr.message : String(requeueErr)}`,
        );
      }
    }
  }

  console.info(`[Worker ${WORKER_ID}] Shutdown complete`);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info(
    `[Worker ${WORKER_ID}] Starting Render background worker — ` +
    `pollInterval=${POLL_INTERVAL_MS}ms, SAM2=${isSAM2Enabled()}`,
  );

  // Register shutdown handlers
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Start polling
  scheduleNextPoll();
}

main().catch((err) => {
  console.error(`[Worker ${WORKER_ID}] Fatal error:`, err);
  process.exit(1);
});
