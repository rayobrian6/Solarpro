/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job.
 *
 * P1 — Execution Architecture: Render Background Worker
 *   - Creates job record with status='queued'
 *   - Returns 202 + jobId IMMEDIATELY (no pipeline execution)
 *   - Render worker polls DB for queued jobs, claims, and executes pipeline
 *   - Frontend polls GET /status for progress
 *
 * Why NOT inline anymore?
 *   SAM2 on CPU takes ~53-95s per photo → 15 photos ÷ 2 concurrency = ~8 batches
 *   × ~55s = ~440s → exceeds Vercel's 300s hard limit → pipeline dies during
 *   segmentation → zero artifacts persisted. The P0 checkpoint design fires
 *   AFTER each complete stage, but segmentation itself takes >300s, so the
 *   checkpoint never fires. Moving execution to a Render background worker
 *   eliminates the Vercel timeout constraint entirely.
 *
 * Mock pipeline: runs synchronously for backward compatibility (fast, no SAM2).
 * All other pipelines: create job → return 202 → worker executes asynchronously.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    console.info(
      `[POST geometry-reconstruction/start] Job ${job.id} created for pipeline=${pipeline}, ` +
      `${sourcePhotos.length} source photos. Status='queued'. Worker will pick up asynchronously.`,
    );

    // ── Mock pipeline: run synchronously for backward compatibility ────────────
    // Mock is fast (<1s) and doesn't call SAM2, so it's safe to run inline.
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

    // ── Real Pipeline B: return 202 immediately, worker executes async ────────
    // The Render background worker polls DB for queued jobs, claims this job,
    // and runs the full pipeline (segmentation → line extraction → vanishing
    // points → depth → planes → multi-view fusion → photogrammetry).
    //
    // Frontend should poll GET /status?jobId=<jobId> for progress.
    // The worker updates heartbeat, currentStage, and persists artifacts
    // incrementally via the P0 checkpoint system.
    return NextResponse.json({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: `Job created. Worker will process pipeline='${pipeline}' asynchronously. Poll GET /status?jobId=${job.id} for progress.`,
    }, { status: 202 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST geometry-reconstruction/start] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
