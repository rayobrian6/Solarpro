/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job.
 *
 * RUNS PIPELINE INLINE (maxDuration=300):
 *   - Creates job record with status='running'
 *   - Executes the pipeline directly within this request
 *   - Returns results when complete (200) or error (500)
 *   - Client can also poll GET /status for progress
 *   - Mock pipeline runs synchronously for backward compatibility
 *
 * P0 — Execution Stability (checkpoint persistence):
 *   - After each pipeline stage, the checkpointCallback persists that
 *     stage's artifacts to DB immediately via insertReconstructionArtifactsBatch.
 *   - If the pipeline times out or crashes, already-checkpointed artifacts
 *     survive in the database — no work is lost.
 *   - On successful completion, checkpointed artifacts are replaced with
 *     the complete set (deleteArtifactsByJob + full batch insert).
 *   - On failure, partial artifacts are preserved and the failure stage is
 *     recorded on the job record.
 *
 * Why inline instead of waitUntil(fetch('/execute'))?
 *   The waitUntil(fetch('/execute')) pattern was fundamentally broken.
 *   waitUntil() is designed for short-lived side effects (analytics, logging),
 *   NOT for triggering long-running background jobs. When /start returned 202,
 *   the waitUntil promise was cancelled after the function's 60s timeout,
 *   which aborted the outbound fetch to /execute BEFORE it could even be
 *   delivered. The /execute function was never invoked, leaving the job stuck
 *   at 'queued' forever with zero logs and no Render/SAM2 calls.
 *
 *   The fire-and-forget pattern (pre-waitUntil) had the same problem:
 *   when /start returned 202, the serverless function could freeze/terminate
 *   before the background fetch completed.
 *
 *   Running inline guarantees the pipeline actually executes. With
 *   maxDuration=300 on Vercel Pro, the full pipeline (SAM2 segmentation
 *   + line extraction + vanishing points + depth + planes + multi-view fusion)
 *   fits within the 300-second window.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Full 5-minute timeout — pipeline runs in this request

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getSiteSurveyById, getSiteSurveyFiles, GetSiteSurveyByIdOptions } from '@/lib/db-neon';
import {
  insertReconstructionJob,
  updateReconstructionJobStatus,
  insertReconstructionArtifact,
  insertReconstructionArtifactsBatch,
  deleteArtifactsByJob,
  deleteArtifactsBySurvey,
  updateJobHeartbeatInDb,
  updateJobStageDurations,
  updateJobFailureStage,
} from '@/lib/db/geometryReconstruction';
import { generateMockArtifacts } from '@/lib/siteSurveys/geometryReconstruction/mockAdapter';
import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
import type { CheckpointCallback, PipelineCheckpoint } from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
import { warmupSAM2Service, isSAM2Enabled } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
import { adaptGeometryReconBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsBySurvey } from '@/lib/siteSurveys/unifiedGeometry';
import type { GeometryReconstructionInput, SourcePhoto } from '@/lib/siteSurveys/geometryReconstruction/types';

/** Heartbeat interval: update last_heartbeat_at every 30s during pipeline execution. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Start a periodic heartbeat timer that updates the job's heartbeat in the DB.
 * The timer includes the current pipeline stage name for progress tracking.
 * Returns a cleanup function that stops the timer AND exposes the latest stage
 * so the catch block can determine which stage the pipeline was in when it failed.
 */
function startHeartbeatTimer(
  jobId: string,
  getStage: () => string,
): () => void {
  const timer = setInterval(() => {
    const currentStage = getStage();
    updateJobHeartbeatInDb(jobId, currentStage).catch(() => {
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
  console.log(`[POST geometry-reconstruction/start] surveyId=${surveyId}`);

  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id, {
      bypassOwnershipCheck: user.id === 'dev-user-bypass-001',
    } as GetSiteSurveyByIdOptions);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // Parse request body
    const body = await req.json().catch(() => ({}));
    const pipeline = body.pipeline ?? 'mock';
    const sourceFileIds: string[] = body.sourceFileIds ?? [];

    // Get survey photo files to build source photos.
    const files = await getSiteSurveyFiles(surveyId);
    const selectedFiles = sourceFileIds.length > 0
      ? files.filter((f) => sourceFileIds.includes(f.id))
      : files;
    const sourcePhotos: SourcePhoto[] = selectedFiles
      .filter((f) => f.fileType === 'photo' && Boolean(f.fileUrl))
      .map((f) => ({
        fileId: f.id,
        fileUrl: f.fileUrl,
        filename: f.filename ?? null,
        label: f.label ?? null,
      }));

    if (sourcePhotos.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No survey photos with usable file URLs were found for geometry reconstruction.' },
        { status: 400 },
      );
    }

    const input: GeometryReconstructionInput = {
      surveyId,
      sourcePhotos,
      pipeline,
    };

    // Create job row — status='queued'
    const job = await insertReconstructionJob(surveyId, user.id, pipeline, input);

    // ── Mock pipeline: run synchronously for backward compatibility ──────────
    if (pipeline === 'mock') {
      const artifacts = generateMockArtifacts(input);
      for (const artifact of artifacts) {
        await insertReconstructionArtifact(job.id, surveyId, user.id, artifact, 'mock');
      }
      const completedJob = await updateReconstructionJobStatus(job.id, 'completed');
      return NextResponse.json({
        success: true,
        job: completedJob ?? { ...job, status: 'completed', artifacts },
      });
    }

    // ── Real Pipeline B: run inline with checkpoint persistence ──────────────
    console.info(
      `[POST geometry-reconstruction/start] Job ${job.id} created for pipeline=${pipeline}. ` +
      `Running pipeline inline with checkpoint persistence.`,
    );

    // Mark job as running with initial heartbeat
    await updateReconstructionJobStatus(job.id, 'running');
    await updateJobHeartbeatInDb(job.id, 'segmentation');

    // Fire SAM2 warmup as early as possible
    const sam2WasEnabled = isSAM2Enabled();
    if (sam2WasEnabled) {
      console.info(
        `[POST geometry-reconstruction/start] SAM2 is enabled — firing warmup ping to Render service`,
      );
    } else {
      console.warn(
        `[POST geometry-reconstruction/start] SAM2_SERVICE_URL is NOT set — pipeline will use Canny as explicit backend (no Render calls)`,
      );
    }
    warmupSAM2Service();

    // ── Track the latest checkpoint stage for heartbeat and failure reporting ──
    let latestStage: string = 'segmentation';
    let latestStageDurations: Record<string, number> = {};

    // ── Create checkpoint callback that persists artifacts incrementally ────
    // After each pipeline stage, this callback:
    // 1. Inserts the stage's artifacts to DB immediately
    // 2. Updates the job's current stage in the heartbeat
    // 3. Updates the job's stage_durations JSONB
    // This ensures no work is lost if the pipeline times out or crashes.
    const checkpointCallback: CheckpointCallback = async (checkpoint: PipelineCheckpoint) => {
      const { stage, stageArtifacts, stageDurations, elapsedMs } = checkpoint;

      // Track the latest stage for heartbeat + failure reporting
      latestStage = stage;
      latestStageDurations = stageDurations;

      console.info(
        `[POST geometry-reconstruction/start] Checkpoint after stage=${stage}: ` +
        `${stageArtifacts.length} stage artifacts, ${elapsedMs}ms elapsed, ` +
        `next=${checkpoint.nextStage}`,
      );

      // Persist this stage's artifacts to DB immediately (incremental insert)
      if (stageArtifacts.length > 0) {
        try {
          const batchResult = await insertReconstructionArtifactsBatch(
            job.id,
            surveyId,
            user.id,
            stageArtifacts,
            pipeline,
            stageDurations,
            'p0-checkpoint',
          );
          console.info(
            `[POST geometry-reconstruction/start] Checkpoint persisted ${batchResult.inserted}/${stageArtifacts.length} ` +
            `artifacts for stage=${stage} (failed=${batchResult.failed})`,
          );
        } catch (insertErr) {
          // Best-effort: checkpoint failure must NOT abort the pipeline.
          // The artifacts are still in-memory and will be persisted on the
          // final write if the pipeline completes successfully.
          console.error(
            `[POST geometry-reconstruction/start] Checkpoint insert failed for stage=${stage}:`,
            insertErr instanceof Error ? insertErr.message : String(insertErr),
          );
        }
      }

      // Update job heartbeat with current stage
      await updateJobHeartbeatInDb(job.id, stage);

      // Update stage_durations on job record (best-effort)
      await updateJobStageDurations(job.id, stageDurations);
    };

    // Start heartbeat timer for long-running pipeline stages.
    // The timer reads latestStage to include the current stage name.
    const stopHeartbeat = startHeartbeatTimer(job.id, () => latestStage);

    try {
      console.info(
        `[POST geometry-reconstruction/start] Starting pipeline execution for job=${job.id}, pipeline=${pipeline} (SAM2 enabled: ${sam2WasEnabled})`,
      );

      // Select the appropriate pipeline runner based on the pipeline mode,
      // passing the checkpoint callback for incremental persistence
      let pipelineResult;
      switch (pipeline) {
        case 'segmentation_only':
        case 'segmentation':
          await updateJobHeartbeatInDb(job.id, 'segmentation');
          pipelineResult = await runSegmentationOnlyPipeline(input, checkpointCallback);
          break;
        case 'depth_only':
        case 'depth_estimation':
          await updateJobHeartbeatInDb(job.id, 'segmentation');
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
        artifacts,
        stages,
        totalDurationMs,
        stageDurations,
        segmentationBackend,
        sam2PhotoCount,
        failedPhotoCount,
        skippedPhotoCount,
        cannyPhotoCount,
        photoResults,
        budgetExhaustedReason,
      } = pipelineResult;

      // Update latestStageDurations with the final pipeline result
      latestStageDurations = stageDurations;

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
        await updateJobHeartbeatInDb(job.id, dbStage);
      }

      // Log per-stage timing for debugging
      const stageSummary = stages.map(s => `${s.stage}=${s.durationMs}ms(${s.artifactCount} artifacts)`).join(', ');
      console.info(
        `[POST geometry-reconstruction/start] Pipeline completed for job=${job.id}: ${totalDurationMs}ms total, backend=${segmentationBackend}, stages: [${stageSummary}]`,
      );

      const rawArtifactCount = artifacts.length;
      const rawConsensusPlaneCount = artifacts.filter(
        (artifact) => artifact.artifactType === 'consensus_plane_candidate',
      ).length;
      const rawPolygonArtifactCount = artifacts.filter(
        (artifact) => 'polygon' in artifact && Array.isArray(artifact.polygon) && artifact.polygon.length > 0,
      ).length;

      // ── Persist complete artifacts ──────────────────────────────────────
      // Pipeline completed successfully. Replace checkpointed partial artifacts
      // with the complete set from the full pipeline run.
      // We use deleteArtifactsByJob (not deleteArtifactsBySurvey) to preserve
      // artifacts from other jobs on the same survey.
      const tDbStart = Date.now();
      const deletedReconCount = await deleteArtifactsByJob(job.id);
      if (deletedReconCount > 0) {
        console.info(
          `[POST geometry-reconstruction/start] Replaced ${deletedReconCount} checkpointed artifacts for job=${job.id} with complete set`,
        );
      }
      const batchResult = await insertReconstructionArtifactsBatch(
        job.id,
        surveyId,
        user.id,
        artifacts,
        pipeline,
        stageDurations,
        'p0-final',
      );
      console.info(
        `[POST geometry-reconstruction/start] Batch inserted ${batchResult.inserted}/${artifacts.length} reconstruction artifacts (failed=${batchResult.failed}) in ${Date.now() - tDbStart}ms`,
      );

      // Update stage_durations on the job record (final, complete version)
      await updateJobStageDurations(job.id, stageDurations);

      // Adapt Pipeline B artifacts into unified geometry table
      try {
        const tUnifiedStart = Date.now();
        const deletedCount = await deleteUnifiedArtifactsBySurvey(surveyId, user.id);
        if (deletedCount > 0) {
          console.info(
            `[POST geometry-reconstruction/start] Deleted ${deletedCount} previous unified artifacts for survey=${surveyId}`,
          );
        }

        const adaptedArtifacts = adaptGeometryReconBundle(artifacts, surveyId);
        const writeResult = await writeUnifiedArtifacts(adaptedArtifacts);
        console.info(
          `[POST geometry-reconstruction/start] Adapted ${adaptedArtifacts.length} Pipeline B artifacts to unified: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed} in ${Date.now() - tUnifiedStart}ms`,
        );
      } catch (adaptErr) {
        const errMsg = adaptErr instanceof Error ? adaptErr.message : String(adaptErr);
        console.error(
          `[POST geometry-reconstruction/start] Failed to adapt Pipeline B artifacts to unified table (non-fatal): ${errMsg}`,
        );
      }

      // Mark job as completed
      await updateReconstructionJobStatus(job.id, 'completed');

      const routeDurationMs = Date.now() - tRouteStart;
      console.info(
        `[POST geometry-reconstruction/start] Job ${job.id} completed successfully: ${rawArtifactCount} artifacts, ${totalDurationMs}ms pipeline, ${routeDurationMs}ms total route`,
      );

      // Return 200 with full results — UI can use this directly
      return NextResponse.json({
        success: true,
        jobId: job.id,
        status: 'completed',
        pipelineStages: stages,
        totalDurationMs,
        stageDurations,
        summary: {
          rawArtifactCount,
          rawConsensusPlaneCount,
          rawPolygonArtifactCount,
          segmentationBackend,
          sam2PhotoCount,
          failedPhotoCount,
          skippedPhotoCount,
          cannyPhotoCount,
          budgetExhaustedReason,
        },
        photoResults,
        artifacts: [],
      });

    } catch (pipelineErr) {
      // Pipeline execution failed — preserve partial artifacts and record failure
      const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
      console.error(`[POST geometry-reconstruction/start] Pipeline execution failed for job=${job.id}: ${errMsg}`);

      // Record which stage the pipeline was in when it failed
      // (best-effort — these must not throw and mask the original error)
      try {
        await updateJobStageDurations(job.id, latestStageDurations);
      } catch { /* best-effort */ }
      try {
        await updateJobFailureStage(job.id, latestStage);
      } catch { /* best-effort */ }

      // Mark job as failed
      try {
        await updateReconstructionJobStatus(job.id, 'failed');
      } catch (markFailedErr) {
        console.error(
          `[POST geometry-reconstruction/start] Also failed to mark job=${job.id} as failed:`,
          markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr),
        );
      }

      // Note: Checkpointed artifacts from earlier stages are already in the DB
      // and are NOT deleted on failure — they survive as partial results that
      // the user can inspect for debugging.

      return NextResponse.json({
        success: false,
        jobId: job.id,
        status: 'failed',
        failureStage: latestStage,
        stageDurations: latestStageDurations,
        error: errMsg,
      }, { status: 500 });

    } finally {
      stopHeartbeat();
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST geometry-reconstruction/start] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
