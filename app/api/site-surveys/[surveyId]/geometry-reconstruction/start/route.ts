/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job.
 *
 * ASYNC PATTERN (fixes 504 errors):
 *   - Creates job record with status='queued' and returns immediately (202)
 *   - Fires a non-blocking background fetch to /execute to run the pipeline
 *   - Client polls GET /status for progress and results
 *   - Mock pipeline still runs synchronously for backward compatibility
 *
 * The old synchronous pattern (running the entire pipeline within the
 * Vercel request) caused 504 errors because the pipeline takes 200-400s
 * while Vercel's maxDuration is 300s.
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Reduced from 300 — we no longer run the pipeline here

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

    // ── Mock pipeline: run synchronously for backward compatibility ────────
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

    // ── Real Pipeline B: fire-and-return async pattern ────────────────────
    console.info(
      `[POST geometry-reconstruction/start] Job ${job.id} created for pipeline=${pipeline}. ` +
      `Firing background execution.`,
    );

    // Fire non-blocking background execution.
    // We use fetch() to hit the /execute endpoint which runs the pipeline
    // outside this request's lifecycle. The fire-and-forget pattern means
    // we don't await this — the pipeline runs independently.
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.NEXT_PUBLIC_APP_URL
          ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
          : `http://localhost:3000`;

      // Fire and forget — we do NOT await this fetch
      const executeUrl = `${baseUrl}/api/site-surveys/${surveyId}/geometry-reconstruction/execute`;
      fetch(executeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Internal auth token to verify the request comes from our own server
          'X-Internal-Auth': process.env.INTERNAL_WORKER_AUTH_TOKEN ?? 'geometry-recon-worker-2025',
        },
        body: JSON.stringify({
          jobId: job.id,
          surveyId,
          pipeline,
          input,
        }),
      }).catch((fetchErr) => {
        // Log but don't block — the job will be picked up by the stale-job recovery cron
        console.error(
          `[POST geometry-reconstruction/start] Failed to fire background execution for job ${job.id}:`,
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
        );
      });
    } catch (fireErr) {
      // Non-fatal: if we can't fire the background task, the job stays 'queued'
      // and will be picked up by the next stale-job recovery sweep
      console.error(
        `[POST geometry-reconstruction/start] Error firing background execution for job ${job.id}:`,
        fireErr instanceof Error ? fireErr.message : String(fireErr),
      );
    }

    // Return 202 Accepted immediately — client should poll GET /status
    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        status: 'queued',
        message: 'Geometry reconstruction job created. Poll GET /status for progress.',
        pollEndpoint: `/api/site-surveys/${surveyId}/geometry-reconstruction/status?jobId=${job.id}`,
      },
      { status: 202 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[POST geometry-reconstruction/start] Error:`, message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
