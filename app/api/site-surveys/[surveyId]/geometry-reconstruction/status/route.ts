/**
 * GET /api/site-surveys/[surveyId]/geometry-reconstruction/status
 *
 * Poll geometry reconstruction job status.
 * Returns current job status, progress, and (when completed) artifacts.
 *
 * This is the polling endpoint for the async pipeline pattern:
 *   POST /start → returns 202 { jobId }
 *   GET /status?jobId=xxx → polls for progress
 *
 * Reads from DB only — no pipeline execution, no external service calls.
 * Response time is typically <50ms.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { getSiteSurveyById } from '@/lib/db-neon';
import { getReconstructionJobById, getArtifactsBySurvey } from '@/lib/db/geometryReconstruction';
import { computeProgress } from '@/lib/siteSurveys/geometryReconstruction/asyncJobManager';

// Pipeline stages in order (from asyncJobManager)
const STAGE_ORDER = ['queued', 'segmentation', 'mask_cleanup', 'line_extraction', 'vanishing_point_estimation', 'plane_extraction', 'depth_estimation', 'multi_view_fusion', 'completed'] as const;

export async function GET(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const surveyId = params?.surveyId ?? 'unknown';
  const jobId = req.nextUrl.searchParams.get('jobId');

  try {
    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!isValidUUID(surveyId)) {
      return NextResponse.json({ success: false, error: 'Invalid survey ID' }, { status: 400 });
    }

    const survey = await getSiteSurveyById(surveyId, user.id);
    if (!survey) {
      return NextResponse.json({ success: false, error: 'Survey not found' }, { status: 404 });
    }

    // If jobId is provided, fetch that specific job
    if (jobId) {
      const job = await getReconstructionJobById(jobId);
      if (!job) {
        return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
      }

      // Verify the job belongs to this survey
      if (job.surveyId !== surveyId) {
        return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
      }

      const progress = computeProgress(job.currentStage);

      // Build response based on job status
      const response: Record<string, unknown> = {
        success: true,
        jobId: job.id,
        status: job.status,
        currentStage: job.currentStage,
        progress: Math.round(progress * 100) / 100, // 0-1
        pipeline: job.pipeline,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
        lastHeartbeatAt: job.lastHeartbeatAt,
        workerVersion: job.workerVersion,
      };

      // When completed, include artifacts and summary
      if (job.status === 'completed') {
        const result = await getArtifactsBySurvey(surveyId, user.id);

        // Group artifacts by type
        const grouped: Record<string, number> = {};
        for (const artifact of result.artifacts) {
          grouped[artifact.artifactType] = (grouped[artifact.artifactType] ?? 0) + 1;
        }

        response.artifacts = result.artifacts;
        response.artifactCount = result.artifactCount;
        response.groupedArtifactCounts = grouped;
      }

      // When failed, include error context
      if (job.status === 'failed') {
        response.error = 'Pipeline execution failed. Check job artifacts for partial results.';
      }

      // Check for stale heartbeat (running but no update for >10 minutes)
      if (job.status === 'running' && job.lastHeartbeatAt) {
        const heartbeatAge = Date.now() - new Date(job.lastHeartbeatAt).getTime();
        if (heartbeatAge > 10 * 60 * 1000) {
          response.warning = 'Job heartbeat is stale (>10 minutes). The worker may have crashed.';
          response.heartbeatAgeMs = heartbeatAge;
        }
      }

      return NextResponse.json(response);
    }

    // No jobId — return latest job status for this survey
    const result = await getArtifactsBySurvey(surveyId, user.id);
    const job = result.job;

    const grouped: Record<string, number> = {};
    for (const artifact of result.artifacts) {
      grouped[artifact.artifactType] = (grouped[artifact.artifactType] ?? 0) + 1;
    }

    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: job.status,
      currentStage: job.currentStage,
      progress: computeProgress(job.currentStage),
      pipeline: job.pipeline,
      artifacts: job.status === 'completed' ? result.artifacts : [],
      artifactCount: result.artifactCount,
      groupedArtifactCounts: grouped,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[GET geometry-reconstruction/status] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
