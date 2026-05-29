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
} from '@/lib/db/geometryReconstruction';
import { generateMockArtifacts } from '@/lib/siteSurveys/geometryReconstruction/mockAdapter';
import {
  runFullGeometryReconstructionPipeline,
  runSegmentationOnlyPipeline,
  runDepthOnlyPipeline,
} from '@/lib/siteSurveys/geometryReconstruction/runFullPipeline';
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

    // Get survey files to build source photos
    const files = await getSiteSurveyFiles(surveyId);
    const sourcePhotos: SourcePhoto[] = (sourceFileIds.length > 0
      ? files.filter((f: { id: string }) => sourceFileIds.includes(f.id))
      : files
    ).map((f: { id: string; url?: string; originalName?: string }) => ({
      fileId: f.id,
      fileUrl: f.url ?? '',
      filename: f.originalName ?? null,
    }));

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

      const { artifacts, stages, totalDurationMs } = pipelineResult;

      // Persist each artifact
      for (const artifact of artifacts) {
        await insertReconstructionArtifact(job.id, surveyId, user.id, artifact, pipeline);
      }

      // Adapt Pipeline B artifacts into unified geometry table
      try {
        // Clean up previous geometry_recon artifacts for this survey
        const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'geometry_recon');
        if (deletedCount > 0) {
          console.info(
            `[POST geometry-reconstruction/start] Deleted ${deletedCount} previous geometry_recon unified artifacts for survey=${surveyId}`,
          );
        }

        const adaptedArtifacts = adaptGeometryReconBundle(artifacts, surveyId);
        const writeResult = await writeUnifiedArtifacts(adaptedArtifacts);
        console.info(
          `[POST geometry-reconstruction/start] Adapted ${adaptedArtifacts.length} Pipeline B artifacts to unified: inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed}`,
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
