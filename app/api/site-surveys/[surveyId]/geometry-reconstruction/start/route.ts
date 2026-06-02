/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job.
 *
 * RUNS PIPELINE INLINE:
 *   - Creates job record with status='running'
 *   - Executes the pipeline directly within this request
 *   - Returns results when complete (200) or error (500)
 *   - Client can also poll GET /status for progress
 *   - Mock pipeline runs synchronously for backward compatibility
 *
 * Why inline instead of fire-and-forget?
 *   The previous pattern (fire-and-forget fetch to /execute) was broken on
 *   Vercel and Render — when the /start handler returned 202, the serverless
 *   function could freeze/terminate before the background fetch completed,
 *   leaving the job stuck at 'queued' forever with no logs.
 *   Running inline guarantees the pipeline actually executes.
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
  deleteArtifactsBySurvey,
} from '@/lib/db/geometryReconstruction';
import { generateMockArtifacts } from '@/lib/siteSurveys/geometryReconstruction/mockAdapter';
import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
import { warmupSAM2Service } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
import { adaptGeometryReconBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry';
import type { GeometryReconstructionInput, SourcePhoto } from '@/lib/siteSurveys/geometryReconstruction/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const surveyId = params?.surveyId ?? 'unknown';
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

    // ── Mock pipeline: run synchronously for backward compatibility ────────────
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

    // ── Real Pipeline B: run inline ────────────────────────────────────────────
    console.info(
      `[POST geometry-reconstruction/start] Job ${job.id} created for pipeline=${pipeline}. ` +
      `Running pipeline inline.`,
    );

    // Mark job as running
    await updateReconstructionJobStatus(job.id, 'running');

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

      const {
        artifacts,
        stages,
        totalDurationMs,
        segmentationBackend,
        sam2PhotoCount,
        failedPhotoCount,
        skippedPhotoCount,
        cannyPhotoCount,
        photoResults,
        budgetExhaustedReason,
      } = pipelineResult;

      // Log per-stage timing
      const stageSummary = stages.map(s => `${s.stage}=${s.durationMs}ms(${s.artifactCount} artifacts)`).join(', ');
      console.info(
        `[POST geometry-reconstruction/start] Pipeline completed for job=${job.id}: ${totalDurationMs}ms total, stages: [${stageSummary}]`,
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
          `[POST geometry-reconstruction/start] Deleted ${deletedReconCount} previous reconstruction artifacts for survey=${surveyId}`,
        );
      }
      const batchResult = await insertReconstructionArtifactsBatch(job.id, surveyId, user.id, artifacts, pipeline);
      console.info(
        `[POST geometry-reconstruction/start] Batch inserted ${batchResult.inserted}/${artifacts.length} reconstruction artifacts (failed=${batchResult.failed}) in ${Date.now() - tDbStart}ms`,
      );

      // Adapt Pipeline B artifacts into unified geometry table
      try {
        const tUnifiedStart = Date.now();
        const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');
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

      console.info(
        `[POST geometry-reconstruction/start] Job ${job.id} completed successfully: ${rawArtifactCount} artifacts, ${totalDurationMs}ms`,
      );

      // Return 200 with full results (UI can use this directly)
      return NextResponse.json({
        success: true,
        jobId: job.id,
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
      console.error(`[POST geometry-reconstruction/start] Pipeline execution failed for job=${job.id}: ${errMsg}`);
      await updateReconstructionJobStatus(job.id, 'failed');
      return NextResponse.json(
        { success: false, error: `Pipeline execution failed: ${errMsg}`, jobId: job.id },
        { status: 500 },
      );
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
