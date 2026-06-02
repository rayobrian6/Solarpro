/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/execute
 *
 * Background worker endpoint for executing the geometry reconstruction pipeline.
 *
 * This endpoint is called by the /start route via fire-and-forget fetch()
 * after creating a job record. It runs the pipeline outside the original
 * Vercel request lifecycle, preventing 504 timeout errors.
 *
 * Security: Requires X-Internal-Auth header matching INTERNAL_WORKER_AUTH_TOKEN.
 * This endpoint is NOT intended for external use — it's an internal worker trigger.
 *
 * Architecture:
 *   POST /start → create job → return 202 → fire fetch(/execute)
 *   POST /execute → mark running → run pipeline → write artifacts → mark completed
 *   GET /status → poll DB → return progress
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Full 5-minute timeout for pipeline execution

import { NextRequest, NextResponse } from 'next/server';
import {
  updateReconstructionJobStatus,
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
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry';
import type { GeometryReconstructionInput } from '@/lib/siteSurveys/geometryReconstruction/types';

// Internal auth token — must match the token used by /start route
const INTERNAL_AUTH_TOKEN = process.env.INTERNAL_WORKER_AUTH_TOKEN ?? 'geometry-recon-worker-2025';

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';

  // ── Internal auth check ─────────────────────────────────────────────────
  const authToken = req.headers.get('X-Internal-Auth');
  if (authToken !== INTERNAL_AUTH_TOKEN) {
    console.warn(`[POST geometry-reconstruction/execute] Unauthorized execution attempt for survey=${surveyId}`);
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { jobId, pipeline, input } = body as {
      jobId: string;
      surveyId: string;
      pipeline: string;
      input: GeometryReconstructionInput;
    };

    if (!jobId || !surveyId || !pipeline || !input) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: jobId, surveyId, pipeline, input' },
        { status: 400 },
      );
    }

    console.info(
      `[POST geometry-reconstruction/execute] Starting pipeline execution for job=${jobId}, pipeline=${pipeline}, survey=${surveyId}`,
    );

    // Mark job as running
    await updateReconstructionJobStatus(jobId, 'running');

    // Fire SAM2 warmup as early as possible
    warmupSAM2Service();

    try {
      // Select the appropriate pipeline runner based on the pipeline mode
      let pipelineResult;
      switch (pipeline) {
        case 'segmentation_only':
        case 'segmentation':
          pipelineResult = await runSegmentationOnlyPipeline(input);
          break;
        case 'depth_only':
        case 'depth_estimation':
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
        const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');
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

      return NextResponse.json({
        success: true,
        jobId,
        status: 'completed',
        pipelineStages: stages,
        totalDurationMs,
        summary: {
          sourcePhotoCount: input.sourcePhotos.length,
          rawArtifactCount,
          rawConsensusPlaneCount,
          rawPolygonArtifactCount,
          segmentationBackend,
          sam2PhotoCount,
          failedPhotoCount,
          skippedPhotoCount,
          cannyPhotoCount,
          photoResults,
          budgetExhaustedReason,
        },
      });
    } catch (pipelineErr) {
      // Pipeline execution failed — mark job as failed
      const errMsg = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr);
      console.error(`[POST geometry-reconstruction/execute] Pipeline execution failed for job=${jobId}: ${errMsg}`);
      await updateReconstructionJobStatus(jobId, 'failed');
      return NextResponse.json(
        { success: false, error: `Pipeline execution failed: ${errMsg}`, jobId },
        { status: 500 },
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST geometry-reconstruction/execute] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
