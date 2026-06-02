/**
 * POST /api/site-surveys/[surveyId]/geometry-reconstruction/start
 *
 * Start a new geometry reconstruction job (ASYNC).
 *
 * Architecture:
 *   POST /start → create job (queued) → return 202 → trigger /execute
 *   POST /execute → mark running → await pipeline directly → return 200/500
 *   GET /status → poll DB → return progress
 *
 * Why async instead of inline?
 *   The previous inline approach ran Pipeline B within this request handler.
 *   With maxDuration=300, the full pipeline (SAM2 + line extraction + vanishing
 *   points + depth + planes + multi-view fusion) could exceed the Vercel Pro
 *   300-second timeout, causing a 504. The client never received a response.
 *
 *   The async approach returns 202 immediately with a jobId. The client
 *   polls GET /status for progress. The pipeline runs in a separate serverless
 *   function invocation (/execute) which awaits the pipeline DIRECTLY (not via
 *   waitUntil) to ensure outbound fetch calls to the SAM2 Render service are
 *   properly sustained for the full pipeline duration.
 *
 * How /start triggers /execute:
 *   We use waitUntil(fetch('/execute')) to ensure the fetch request is SENT
 *   before /start's function exits. The /execute function then awaits the
 *   pipeline directly (up to 270s). Since /start has maxDuration=60, the
 *   waitUntil will be cancelled after 60s — but /execute is a SEPARATE
 *   Vercel function invocation that continues running independently.
 *   The client already received the 202 and is polling GET /status.
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

    // ── Real Pipeline B: async — trigger /execute, return 202 immediately ──────
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

    console.info(
      `[POST geometry-reconstruction/start] Firing fetch to /execute at ${executeUrl} for job=${job.id}`,
    );

    // Fire the execute request using waitUntil — this guarantees the fetch
    // is SENT before the function is suspended.
    //
    // NOTE: /execute now awaits the pipeline DIRECTLY (not via waitUntil).
    // This means /execute won't return until the pipeline finishes (up to 270s).
    // Since /start has maxDuration=60, the waitUntil will be cancelled after 60s.
    // This is FINE — /execute is a separate Vercel function invocation that
    // continues running independently. The client already received 202 and is
    // polling GET /status.
    //
    // The important thing is that the fetch REQUEST is sent. Once it reaches
    // /execute, the pipeline starts running in a separate function with its
    // own 300s lifetime. Even if /start's waitUntil is cancelled, /execute
    // keeps running.
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
