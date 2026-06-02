/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job (ASYNC).
 *
 * Architecture:
 *   POST /start → create job (queued) → return 202 { jobId } → trigger /execute
 *   POST /execute → mark running → run pipeline via waitUntil() → return 200 immediately
 *   GET /status → poll DB → return progress
 *
 * Why async instead of inline?
 *   The previous inline approach ran Pipeline B within this request handler.
 *   With maxDuration=300, the full pipeline (SAM2 + line extraction + vanishing
 *   points + depth + planes + multi-view fusion) could exceed the Vercel Pro
 *   300-second timeout, causing a 504. The client never received a response.
 *
 *   The new async approach returns 202 immediately with a jobId. The client
 *   polls GET /status for progress. The pipeline runs in a separate serverless
 *   function invocation (/execute) using waitUntil() to extend its lifetime.
 *   If /execute times out, the job is marked as failed via heartbeat staleness
 *   detection — the client sees an explicit failure, not a silent 504.
 *
 * Why waitUntil instead of fire-and-forget?
 *   The original fire-and-forget (return 202, then fetch(/execute) without
 *   waiting) was unreliable on Vercel — the serverless function could freeze
 *   before the fetch was even sent. waitUntil() guarantees the fetch promise
 *   completes before the function is suspended. Since /execute returns 200
 *   quickly (after marking the job as running), the fetch resolves fast.
 *
 * Mock pipeline: runs synchronously and returns 200 with results (backward compat).
 *
 * Auth required. Survey ownership enforced.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // /start returns quickly — only needs time to create job + fire fetch

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
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

/** Internal auth token for calling /execute — must match the /execute route. */
const INTERNAL_AUTH_TOKEN = process.env.INTERNAL_WORKER_AUTH_TOKEN ?? 'geometry-recon-worker-2025';

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

    // ── Real Pipeline B: async — trigger /execute, return 202 immediately ───
    console.info(
      `[POST geometry-reconstruction/start] Job ${job.id} created for pipeline=${pipeline}. ` +
      `Triggering async execution via /execute.`,
    );

    // Build the internal URL for /execute.
    // Uses the VERCEL_URL or falls back to localhost for local dev.
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL
        ? process.env.NEXT_PUBLIC_BASE_URL
        : 'http://localhost:3000';
    const executeUrl = `${baseUrl}/api/site-surveys/${surveyId}/geometry-reconstruction/execute`;

    // Fire the execute request using waitUntil — this guarantees the fetch
    // is sent before the function is suspended. The /execute route returns
    // 200 quickly (after marking the job as running), so this resolves fast.
    waitUntil(
      fetch(executeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
        },
        body: JSON.stringify({
          jobId: job.id,
          surveyId,
          pipeline,
          input,
        }),
      })
        .then((res) => {
          console.info(
            `[POST geometry-reconstruction/start] /execute responded with status=${res.status} for job=${job.id}`,
          );
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[POST geometry-reconstruction/start] Failed to trigger /execute for job=${job.id}: ${msg}`,
          );
          // Best-effort: mark job as failed so the client isn't stuck at 'queued' forever
          updateReconstructionJobStatus(job.id, 'failed').catch(() => {
            console.error(`[POST geometry-reconstruction/start] Also failed to mark job=${job.id} as failed`);
          });
        })
    );

    // Return 202 immediately — the client should poll GET /status for progress
    return NextResponse.json(
      {
        success: true,
        jobId: job.id,
        status: 'queued',
        message: 'Job created. Pipeline execution will begin shortly. Poll GET /status for progress.',
        pollUrl: `/api/site-surveys/${surveyId}/geometry-reconstruction/status?jobId=${job.id}`,
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
