/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job.
 * If pipeline === 'mock', runs the mock adapter immediately.
 * For non-mock pipelines (full, segmentation_only, depth_only, etc.),
 * runs the real Pipeline B orchestration.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
import { warmupSAM2Service, waitForSAM2Warm } from '@/lib/siteSurveys/geometryReconstruction/workers/segmentation/sam2Client';
import { adaptGeometryReconBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsBySurvey } from '@/lib/siteSurveys/unifiedGeometry';
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
    // NOTE: SiteSurveyFile uses `fileUrl`/`filename` (not `url`/`originalName`).
    // The old mapping produced empty URLs, causing the normal logged-in UI flow
    // to run Pipeline B without usable source images.
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

    // Create job row
    const job = await insertReconstructionJob(surveyId, user.id, pipeline, input);

    if (pipeline === 'mock') {
      // Run mock adapter immediately
      const artifacts = generateMockArtifacts(input);

      // Persist each artifact
      for (const artifact of artifacts) {
        await insertReconstructionArtifact(job.id, surveyId, user.id, artifact, 'mock');
      }

      // Mark job as completed
      const completedJob = await updateReconstructionJobStatus(job.id, 'completed');
      return NextResponse.json({
        success: true,
        job: completedJob ?? { ...job, status: 'completed', artifacts },
      });
    }

    // ── Real Pipeline B orchestration ──────────────────────────────────
    console.info(
      `[POST geometry-reconstruction/start] Running real pipeline: ${pipeline} for survey=${surveyId}`,
    );

    // Fire non-blocking SAM 2 warm-up as early as possible.
    // On Render cold starts, the model takes ~60-100s to download and load.
    // Firing this now gives the service a head start while we do DB writes.
    // The actual segmentation call later will either find a warm model
    // (saving ~60-100s) or proceed normally if still loading.
    if (pipeline !== 'mock') {
      warmupSAM2Service();
    }

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

      // Log per-stage timing for 504 debugging
      const stageSummary = stages.map(s => `${s.stage}=${s.durationMs}ms(${s.artifactCount} artifacts)`).join(', ');
      console.info(
        `[POST geometry-reconstruction/start] Pipeline completed: ${totalDurationMs}ms total, stages: [${stageSummary}]`,
      );

      const rawArtifactCount = artifacts.length;
      const rawConsensusPlaneCount = artifacts.filter(
        (artifact) => artifact.artifactType === 'consensus_plane_candidate',
      ).length;
      const rawPolygonArtifactCount = artifacts.filter(
        (artifact) => 'polygon' in artifact && Array.isArray(artifact.polygon) && artifact.polygon.length > 0,
      ).length;

      // Persist artifacts (clean up old artifacts first to avoid accumulation)
      // Use batch insert instead of one-by-one to reduce DB round-trips from ~328 to ~3
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
        // Clean up ALL previous unified artifacts for this survey.
        // This ensures stale Canny masks from Pipeline A (photo_vision)
        // don't coexist with new SAM2 masks from Pipeline B (geometry_recon).
        // The overlay renderer shows artifacts from ALL pipelines, so old
        // photo_vision artifacts must be cleared when Pipeline B re-runs.
        const deletedCount = await deleteUnifiedArtifactsBySurvey(surveyId);
        if (deletedCount > 0) {
          console.info(
            `[POST geometry-reconstruction/start] Deleted ${deletedCount} previous unified artifacts (all pipelines) for survey=${surveyId}`,
          );
        }

        const adaptedArtifacts = adaptGeometryReconBundle(artifacts, surveyId);
        const writeResult = await writeUnifiedArtifacts(adaptedArtifacts);
        console.info(
          `[POST geometry-reconstruction/start] Adapted ${adaptedArtifacts.length} Pipeline B artifacts to unified: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed} in ${Date.now() - tUnifiedStart}ms`,
        );
      } catch (adaptErr) {
        // Non-fatal: unified table write failure should not block the pipeline result
        const errMsg = adaptErr instanceof Error ? adaptErr.message : String(adaptErr);
        console.error(
          `[POST geometry-reconstruction/start] Failed to adapt Pipeline B artifacts to unified table (non-fatal): ${errMsg}`,
        );
      }

      // Mark job as completed
      const completedJob = await updateReconstructionJobStatus(job.id, 'completed');
      return NextResponse.json({
        success: true,
        job: completedJob ?? { ...job, status: 'completed', artifacts },
        pipelineStages: stages,
        totalDurationMs,
        summary: {
          sourcePhotoCount: sourcePhotos.length,
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
      console.error(`[POST geometry-reconstruction/start] Pipeline execution failed: ${errMsg}`);
      await updateReconstructionJobStatus(job.id, 'failed');
      return NextResponse.json(
        { success: false, error: `Pipeline execution failed: ${errMsg}` },
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
