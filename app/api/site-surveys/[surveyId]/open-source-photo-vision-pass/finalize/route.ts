// ============================================================================
// POST /api/site-surveys/[surveyId]/open-source-photo-vision-pass/finalize
//
// Runs heavy post-processing for a completed photo vision job:
//   1. Persist candidates to DB
//   2. Update photo labels from YOLO/OCR candidates
//   3. Register obstructions
//   4. OpenAI Vision fallback classification
//   5. Phase 4A aggregation (homography projection)
//
// This route is called EXPLICITLY by the UI after the worker completes.
// The GET polling route only reads finalization_status/result from DB —
// it never runs heavy work.
//
// Idempotency:
//   - If finalization_status='complete', returns stored results immediately.
//   - If finalization_status='running' (stale >2min), resets to 'pending' first.
//   - CAS on finalization_status IN ('pending','failed','skipped') prevents duplicate runs
//     while allowing retry of failed/skipped jobs.
//   - Candidate persistence uses (surveyId, runHash) dedup.
//
// Retry Mode:
//   - POST /finalize?retry=1 resets 'failed' or stale 'running' (>2min) back to 'pending'
//     and then re-runs the full pipeline.
//   - POST /finalize?retry=1 also resets 'complete' back to 'pending', allowing re-execution
//     of the entire finalization pipeline (e.g. to re-run Stage 1.5 unify after a code fix).
//
// Dry-Run Mode:
//   - POST /finalize?dryRun=1 returns the stage plan without executing or writing anything.
//   - Useful for debugging why finalization isn't progressing.
//
// INSTRUMENTATION:
//   Every stage emits [finalize:STAGE:start] and [finalize:STAGE:end] logs
//   with durationMs. All stages are wrapped in try/catch that calls
//   markFinalizationFailed() — no swallowed errors, no unbounded awaits,
//   no Promise.all without timeout, no infinite polling, no worker re-run.
//
// CRITICAL INVARIANT:
//   Once CAS claim succeeds (finalization_status='running'), EVERY line of code
//   after that point MUST be inside a single try/catch/finally that guarantees
//   markFinalizationFailed() is called on ANY error or abort. The function
//   MUST NOT leave finalization_status='running' when it exits.
//
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getSiteSurveyFiles,
  replaceOpenSourcePhotoVisionCandidatesForSurveyRun,
} from '@/lib/db-neon';
import {
  getJob,
  markFinalizationStarted,
  markFinalizationComplete,
  markFinalizationFailed,
  resetStuckFinalization,
  resetStuckOrFailedFinalization,
  resetCompletedFinalization,
  updateFinalizationStage,
  type PhotoVisionJob,
} from '@/lib/assistedEvidenceSources/asyncPhotoVisionJobManager';
import {
  buildCandidateCountSummaries,
  classifyFileFromCandidates,
  getEvidenceCategoryForCandidate,
  extractYoloClassNameFromPayload,
} from '@/lib/assistedEvidenceSources/yoloToEvidenceMapper';
import { convertWorkerResultToPhotoVisionResults, enrichPhotoContextWithSurveyData, resolveReferenceImageUrl } from '@/lib/vision/workerResultConverter';
import { aggregateVisionResults } from '@/lib/vision/visionAggregator';
import { registerObstructionsForSurvey, type ObstructionRegistrationResult } from '@/lib/assistedEvidenceSources/roofObstructionRegistration';
import { classifyUnclassifiedPhotosWithVision, type VisionClassificationBatchResult } from '@/lib/assistedEvidenceSources/openaiVisionClassifier';
import type { OpenSourcePhotoVisionRunResult, OpenSourcePhotoVisionCandidate } from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import { updateSiteSurveyFileLabels } from '@/lib/db/surveys';
import { getDbReady } from '@/lib/db/core';
import { adaptPhotoVisionBundle } from '@/lib/siteSurveys/unifiedGeometry/pipelineAdapters';
import { writeUnifiedArtifacts, deleteUnifiedArtifactsByPipeline } from '@/lib/siteSurveys/unifiedGeometry';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

// ---------------------------------------------------------------------------
// Timeout constants
// ---------------------------------------------------------------------------

/** Overall timeout for the entire finalization pipeline (ms). */
const FINALIZATION_OVERALL_TIMEOUT_MS = 290_000; // 290s — leaves headroom in Vercel's 300s limit (Pro plan)

/** Timeout per OpenAI Vision classification call (ms). Already has 30s per-call, but add overall budget. */
const VISION_CLASSIFICATION_BUDGET_MS = 5 * 60_000; // 5 min — but capped by overall timeout

/** Statement timeout for DB operations during finalization (ms). */
const DB_STATEMENT_TIMEOUT_MS = 30_000; // 30s per DB statement

/** Timeout for lightweight DB reads (getJob, CAS claim, etc.) */
const DB_READ_TIMEOUT_MS = 10_000; // 10s for simple reads

/** Timeout for Phase 4A aggregation (outer timeout). */
const PHASE4A_AGGREGATION_TIMEOUT_MS = 40_000; // 40s — matches internal AGGREGATION_BUDGET_MS

/** Vercel serverless hard kill is at 60s. We must call markFinalizationFailed() before that. */
const VERCEL_GRACE_PERIOD_MS = 52_000; // 52s — gives 3s to write the 'failed' status to DB

// ---------------------------------------------------------------------------
// Helper: run a function with an overall timeout guard
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Sub-stage: Label updates (Steps 1–6 of updatePhotoLabelsFromCandidates)
// Extracted so we can log [finalize:labels:start/end] separately.
// ---------------------------------------------------------------------------

interface LabelUpdateResult {
  totalFiles: number;
  filesWithCandidates: number;
  filesEligibleForUpdate: number;
  filesUpdated: number;
  updates: Array<{
    fileId: string;
    filename: string | null;
    oldLabel: string | null;
    newLabel: string;
    candidateType: string;
    candidateClass: string | null;
    confidence: number;
  }>;
}

async function runLabelUpdateStage(
  surveyId: string,
  userId: string,
  run: OpenSourcePhotoVisionRunResult,
  jobId: string,
): Promise<LabelUpdateResult> {
  const sql = await getDbReady();
  const minConfidenceThreshold = Number(process.env.PHOTO_VISION_AUTO_LABEL_MIN_CONFIDENCE || 0.55);

  // Step 1: Load fileId → filename mapping
  const fileIdToFilename = new Map<string, string>();
  const allCandidateFileIds = new Set(run.candidates.map(c => c.fileId));

  if (allCandidateFileIds.size > 0) {
    const fileIdArray = Array.from(allCandidateFileIds);
    const BATCH_SIZE = 100;
    for (let i = 0; i < fileIdArray.length; i += BATCH_SIZE) {
      const batch = fileIdArray.slice(i, i + BATCH_SIZE);
      const rows = await sql`
        SELECT id, filename
        FROM site_survey_files
        WHERE survey_id = ${surveyId}
          AND id = ANY(${batch}::uuid[])
      `;
      for (const row of rows as Record<string, unknown>[]) {
        const id = row.id as string;
        const filename = row.filename as string | null;
        if (filename) {
          fileIdToFilename.set(id, filename);
        }
      }
    }
  }
  console.log(`[finalize:labels] jobId=${jobId} Loaded ${fileIdToFilename.size} fileId→filename mappings`);

  // Step 2: Build candidate count summaries aggregated by filename
  const filenameSummaries = buildCandidateCountSummaries(run.candidates, fileIdToFilename);

  // Step 3: Group object_detection candidates by file_id, pick highest per file
  const objectDetectionByFile = new Map<string, OpenSourcePhotoVisionCandidate>();
  for (const candidate of run.candidates) {
    if (candidate.candidateType !== 'object_detection') continue;
    const normalizedCandidate = { ...candidate, confidence: candidate.confidence / 100 };
    const fileId = candidate.fileId;
    const existing = objectDetectionByFile.get(fileId);
    if (!existing || normalizedCandidate.confidence > existing.confidence) {
      objectDetectionByFile.set(fileId, normalizedCandidate);
    }
  }

  // Pre-compute object_detection classification per file_id
  const objDetClassificationByFileId = new Map<string, {
    category: SurveyEvidenceCategory | null;
    confidence: number;
    yoloClass: string | null;
  }>();
  for (const [fileId, candidate] of objectDetectionByFile.entries()) {
    const category = getEvidenceCategoryForCandidate(candidate, minConfidenceThreshold);
    const yoloClass = extractYoloClassNameFromPayload(candidate.payload);
    objDetClassificationByFileId.set(fileId, { category, confidence: candidate.confidence, yoloClass });
  }

  // Step 4: Check which files currently have NULL/empty labels
  const filesWithoutLabelsMap = new Map<string, { filename: string | null; label: string | null }>();
  const allFileIdsFromSummaries: string[] = [];
  for (const summary of filenameSummaries.values()) {
    for (const fileId of summary.fileIds) {
      allFileIdsFromSummaries.push(fileId);
    }
  }

  if (allFileIdsFromSummaries.length > 0) {
    const BATCH_SIZE = 100;
    for (let i = 0; i < allFileIdsFromSummaries.length; i += BATCH_SIZE) {
      const batch = allFileIdsFromSummaries.slice(i, i + BATCH_SIZE);
      const rows = await sql`
        SELECT id, filename, label
        FROM site_survey_files
        WHERE survey_id = ${surveyId}
          AND id = ANY(${batch}::uuid[])
          AND (label IS NULL OR label = '')
      `;
      for (const row of rows as Record<string, unknown>[]) {
        filesWithoutLabelsMap.set(row.id as string, {
          filename: row.filename as string | null,
          label: row.label as string | null,
        });
      }
    }
  }

  const filesEligibleForUpdate = filesWithoutLabelsMap.size;
  console.log(`[finalize:labels] jobId=${jobId} ${filesEligibleForUpdate} files eligible for label update`);

  if (filesEligibleForUpdate === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates: allCandidateFileIds.size,
      filesEligibleForUpdate: 0,
      filesUpdated: 0,
      updates: [],
    };
  }

  // Step 5: Apply multi-heuristic classification per filename
  const updates: LabelUpdateResult['updates'] = [];
  const updatesForDb: Array<{ fileId: string; label: string }> = [];

  for (const [filename, summary] of filenameSummaries.entries()) {
    const classifications = classifyFileFromCandidates(summary, objDetClassificationByFileId);
    for (const classification of classifications) {
      if (!filesWithoutLabelsMap.has(classification.fileId)) continue;
      if (classification.category) {
        const fileInfo = filesWithoutLabelsMap.get(classification.fileId);
        const filenameStr = fileInfo?.filename ?? classification.filename;
        updates.push({
          fileId: classification.fileId,
          filename: filenameStr,
          oldLabel: null,
          newLabel: classification.category,
          candidateType: classification.method || 'unknown',
          candidateClass: objDetClassificationByFileId.get(classification.fileId)?.yoloClass ?? null,
          confidence: classification.confidence,
        });
        updatesForDb.push({ fileId: classification.fileId, label: classification.category });
      }
    }
  }

  console.log(`[finalize:labels] jobId=${jobId} Prepared ${updatesForDb.length} label updates`);

  // Step 6: Apply updates to site_survey_files table
  let filesUpdated = 0;
  if (updatesForDb.length > 0) {
    const updatedFiles = await updateSiteSurveyFileLabels(surveyId, userId, updatesForDb);
    filesUpdated = updatedFiles.length;
    console.log(`[finalize:labels] jobId=${jobId} Applied ${filesUpdated} label updates to DB`);
  }

  return {
    totalFiles: run.processedCount,
    filesWithCandidates: allCandidateFileIds.size,
    filesEligibleForUpdate,
    filesUpdated,
    updates,
  };
}

// ---------------------------------------------------------------------------
// POST — Run finalization for a completed job
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, props: { params: Promise<{ surveyId: string }> }) {
  const params = await props.params;
  const finalizeStart = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';

  // ── Parse query params ──
  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
  const isRetry = req.nextUrl.searchParams.get('retry') === '1';

  if (dryRun) {
    console.log(`[finalize:dry-run:start] surveyId=${surveyId}`);
  }
  if (isRetry) {
    console.log(`[finalize:retry] surveyId=${surveyId} explicit retry requested`);
  }

  // Auth check
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const jobId = body.jobId as string | undefined;
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'jobId is required' }, { status: 400 });
  }

  console.log(`[finalize:start] surveyId=${surveyId} jobId=${jobId} dryRun=${dryRun} retry=${isRetry}`);

  // ── Verify job exists and belongs to this survey ──
  console.log(`[finalize:get-job:start] jobId=${jobId}`);
  const job = await withTimeout(getJob(jobId), DB_READ_TIMEOUT_MS, 'finalize:get-job');
  console.log(`[finalize:get-job:end] jobId=${jobId} found=${!!job} status=${job?.status} finalizationStatus=${job?.finalizationStatus}`);

  if (!job) {
    return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
  }
  if (job.surveyId !== surveyId) {
    return NextResponse.json({ success: false, error: 'Job does not belong to this survey' }, { status: 403 });
  }

  // Job must be completed to finalize
  if (job.status !== 'completed') {
    return NextResponse.json({
      success: false,
      error: `Job status is '${job.status}', expected 'completed'. Finalization can only run on completed jobs.`,
      jobId: job.jobId,
      status: job.status,
      finalizationStatus: job.finalizationStatus,
    }, { status: 400 });
  }

  // ── Handle 'complete' status with ?retry=1 — reset to 'pending' so pipeline re-runs ──
  // This must come BEFORE the idempotency guard, otherwise retrying a completed finalization
  // would return the cached result without re-executing (e.g. to re-run Stage 1.5 unify).
  if (job.finalizationStatus === 'complete' && isRetry) {
    console.log(`[finalize:retry-complete] jobId=${jobId} resetting complete→pending for retry`);
    const reset = await withTimeout(resetCompletedFinalization(jobId), DB_READ_TIMEOUT_MS, 'finalize:retry-complete');
    if (reset) {
      console.log(`[finalize:retry-complete] jobId=${jobId} reset succeeded, re-reading job`);
      const refreshed = await withTimeout(getJob(jobId), DB_READ_TIMEOUT_MS, 'finalize:get-job-after-complete-retry');
      if (refreshed) {
        job.finalizationStatus = refreshed.finalizationStatus;
        job.finalizationResult = refreshed.finalizationResult;
        job.finalizationError = refreshed.finalizationError;
      }
    } else {
      console.log(`[finalize:retry-complete] jobId=${jobId} reset failed — status may have changed`);
    }
  }

  // ── Idempotency: already finalized? Return stored results ──
  if (job.finalizationStatus === 'complete' && job.finalizationResult) {
    console.log(`[finalize:complete] jobId=${jobId} already finalized (idempotent return)`);
    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      finalizationStatus: 'complete',
      finalizationResult: job.finalizationResult,
      durationMs: Date.now() - finalizeStart,
    });
  }

  // ── Handle stuck 'running' status (from killed Vercel function) ──
  // If ?retry=1, use resetStuckOrFailedFinalization which also resets 'failed' unconditionally
  if (job.finalizationStatus === 'running') {
    console.log(`[finalize:reset-stuck:start] jobId=${jobId} retry=${isRetry}`);
    const reset = isRetry
      ? await withTimeout(resetStuckOrFailedFinalization(jobId), DB_READ_TIMEOUT_MS, 'finalize:reset-stuck-or-failed')
      : await withTimeout(resetStuckFinalization(jobId), DB_READ_TIMEOUT_MS, 'finalize:reset-stuck');
    console.log(`[finalize:reset-stuck:end] jobId=${jobId} reset=${reset}`);
    if (reset) {
      console.log(`[finalize:start] jobId=${jobId} reset stuck 'running' finalization back to 'pending'`);
      const refreshed = await withTimeout(getJob(jobId), DB_READ_TIMEOUT_MS, 'finalize:get-job-after-reset');
      if (refreshed) {
        job.finalizationStatus = refreshed.finalizationStatus;
        job.finalizationResult = refreshed.finalizationResult;
        job.finalizationError = refreshed.finalizationError;
      }
    } else {
      // Still actively running (or not yet stale enough for non-retry path)
      console.log(`[finalize:start] jobId=${jobId} finalization is actively running, returning status`);
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        finalizationStatus: 'running',
        finalizationStage: job.finalizationStage,
        finalizationLastHeartbeatAt: job.finalizationLastHeartbeatAt,
        finalizationStartedAt: job.finalizationStartedAt,
        message: 'Finalization is currently in progress. Poll GET for completion.',
      });
    }
  }

  // ── Handle 'failed' status with ?retry=1 ──
  if (job.finalizationStatus === 'failed' && isRetry) {
    console.log(`[finalize:retry-reset:start] jobId=${jobId} resetting failed→pending for retry`);
    const reset = await withTimeout(resetStuckOrFailedFinalization(jobId), DB_READ_TIMEOUT_MS, 'finalize:retry-reset');
    if (reset) {
      console.log(`[finalize:retry-reset:end] jobId=${jobId} reset succeeded`);
      const refreshed = await withTimeout(getJob(jobId), DB_READ_TIMEOUT_MS, 'finalize:get-job-after-retry-reset');
      if (refreshed) {
        job.finalizationStatus = refreshed.finalizationStatus;
        job.finalizationResult = refreshed.finalizationResult;
        job.finalizationError = refreshed.finalizationError;
      }
    } else {
      console.log(`[finalize:retry-reset:end] jobId=${jobId} reset failed — may have changed state`);
    }
  }

  // ── Claim the finalization slot (CAS) ──
  // CAS now matches 'pending', 'failed', and 'skipped' — allows retry of failed/skipped jobs
  if (job.finalizationStatus === 'pending' || job.finalizationStatus === 'failed' || job.finalizationStatus === 'skipped') {
    console.log(`[finalize:cas-claim:start] jobId=${jobId} currentStatus=${job.finalizationStatus}`);
    const claimed = await withTimeout(markFinalizationStarted(jobId), DB_READ_TIMEOUT_MS, 'finalize:cas-claim');
    console.log(`[finalize:cas-claim:end] jobId=${jobId} claimed=${claimed}`);
    if (!claimed) {
      // CAS failed — re-read the job to return actual status/result/error
      console.log(`[finalize:cas-claim:failed] jobId=${jobId} CAS claim failed for finalizationStatus=${job.finalizationStatus}`);
      const refreshed = await withTimeout(getJob(jobId), DB_READ_TIMEOUT_MS, 'finalize:get-job-after-cas');
      return NextResponse.json({
        success: false,
        jobId: job.jobId,
        finalizationStatus: refreshed?.finalizationStatus ?? job.finalizationStatus,
        finalizationResult: refreshed?.finalizationResult ?? job.finalizationResult,
        finalizationError: refreshed?.finalizationError ?? job.finalizationError,
        finalizationStage: refreshed?.finalizationStage ?? job.finalizationStage,
        finalizationLastHeartbeatAt: refreshed?.finalizationLastHeartbeatAt ?? job.finalizationLastHeartbeatAt,
        message: `CAS claim failed. Current finalization status: ${refreshed?.finalizationStatus ?? job.finalizationStatus}. Use ?retry=1 to force retry.`,
      }, { status: 409 });
    }
    // CAS claim succeeded!
    console.log(`[finalize:cas-claim:success] jobId=${jobId} finalization_status is now 'running'`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRITICAL: From this point forward, EVERY line of code is inside a single
  // try/catch/finally that guarantees markFinalizationFailed() on any error.
  // The function MUST NOT leave finalization_status='running' when it exits.
  // ═══════════════════════════════════════════════════════════════════════════

  // Overall timeout guard — uses AbortController to actually abort the pipeline
  const abortController = new AbortController();

  // Vercel grace-period handler: detect approaching 60s limit and mark failed
  // before the function is killed. This runs at VERCEL_GRACE_PERIOD_MS (52s)
  // to give us 8s to write the 'failed' status to DB before Vercel kills us at 60s.
  let vercelGracePeriodFired = false;
  const vercelGracePeriodTimeout = setTimeout(async () => {
    vercelGracePeriodFired = true;
    console.error(`[finalize:vercel-grace-period] jobId=${jobId} Approaching Vercel 60s limit at ${Date.now() - finalizeStart}ms, marking failed`);
    try {
      await markFinalizationFailed(jobId, `Vercel grace period: finalization exceeded ${VERCEL_GRACE_PERIOD_MS}ms, aborting to prevent stuck 'running' state`);
    } catch (markErr) {
      console.error(`[finalize:vercel-grace-period] jobId=${jobId} Failed to mark finalization as failed during grace period:`, markErr);
    }
    abortController.abort();
  }, VERCEL_GRACE_PERIOD_MS);

  // Overall timeout fires at 55s as a secondary safety net
  const overallTimeout = setTimeout(() => {
    console.error(`[finalize:failed] jobId=${jobId} OVERALL TIMEOUT — pipeline exceeded ${FINALIZATION_OVERALL_TIMEOUT_MS}ms, aborting`);
    abortController.abort();
  }, FINALIZATION_OVERALL_TIMEOUT_MS);

  // Helper to check if we should abort
  function checkAbort(stageName: string) {
    if (abortController.signal.aborted) {
      throw new Error(`Finalization aborted during ${stageName}: overall timeout exceeded ${FINALIZATION_OVERALL_TIMEOUT_MS}ms`);
    }
  }

  // Helper to write stage + heartbeat, with best-effort error handling
  async function heartbeat(stage: string) {
    try {
      await updateFinalizationStage(jobId, stage);
    } catch (hbErr) {
      // Heartbeat failure must NOT crash the pipeline
      console.error(`[finalize:heartbeat:failed] jobId=${jobId} stage=${stage} error:`, hbErr instanceof Error ? hbErr.message : String(hbErr));
    }
  }

  try {
    // ── Guard: job.result must exist ──
    if (!job.result) {
      const errMsg = `Cannot finalize: job.result is null. The worker may not have stored results for this job.`;
      console.error(`[finalize:guard] jobId=${jobId} ${errMsg}`);
      throw new Error(errMsg);
    }

    const run = job.result;
    const runHash = run.runHash;
    const finalizationResult: Record<string, unknown> = {};

    // ── Dry-run: return the stage plan without executing ──
    if (dryRun) {
      const stagePlan = [
        { stage: 1, name: 'persist', description: 'Persist candidates to DB', timeoutMs: DB_STATEMENT_TIMEOUT_MS, fatal: true },
        { stage: 1.5, name: 'unify', description: 'Adapt Pipeline A candidates into unified geometry table', timeoutMs: 120_000, fatal: false },
        { stage: 2, name: 'labels', description: 'Update photo labels from YOLO/OCR candidates', timeoutMs: DB_STATEMENT_TIMEOUT_MS, fatal: true },
        { stage: 3, name: 'obstructions', description: 'Register obstructions on roof_plane photos', timeoutMs: DB_STATEMENT_TIMEOUT_MS, fatal: false },
        { stage: 4, name: 'classification', description: 'OpenAI Vision fallback classification', timeoutMs: VISION_CLASSIFICATION_BUDGET_MS, fatal: false, skipped: !process.env.OPENAI_API_KEY },
        { stage: 5, name: 'phase4a', description: 'Phase 4A aggregation (homography projection)', timeoutMs: PHASE4A_AGGREGATION_TIMEOUT_MS, fatal: false },
        { stage: 6, name: 'store-result', description: 'Store finalization result in DB', timeoutMs: DB_READ_TIMEOUT_MS, fatal: true },
      ];
      const totalDurationEstimate = stagePlan.reduce((sum, s) => sum + s.timeoutMs, 0);
      console.log(`[finalize:dry-run:end] jobId=${jobId} stages=${stagePlan.length}`);
      // Dry-run does NOT modify finalization_status, so reset it back
      await markFinalizationFailed(jobId, 'Dry-run mode — no actual finalization performed');
      return NextResponse.json({
        success: true,
        dryRun: true,
        jobId: job.jobId,
        surveyId,
        finalizationStatus: job.finalizationStatus,
        jobStatus: job.status,
        candidateCount: run.candidates.length,
        processedCount: run.processedCount,
        failedCount: run.failedCount,
        stagePlan,
        overallTimeoutMs: FINALIZATION_OVERALL_TIMEOUT_MS,
        vercelGracePeriodMs: VERCEL_GRACE_PERIOD_MS,
        totalDurationEstimateMs: totalDurationEstimate,
        warning: totalDurationEstimate > FINALIZATION_OVERALL_TIMEOUT_MS
          ? `Sum of stage timeouts (${totalDurationEstimate}ms) exceeds overall timeout (${FINALIZATION_OVERALL_TIMEOUT_MS}ms). Stages may be cut short.`
          : undefined,
      });
    }

    // ── Begin stages ──
    console.log(`[finalize:stages:begin] jobId=${jobId} runHash=${runHash} candidates=${run.candidates.length} processedCount=${run.processedCount}`);
    await heartbeat('stages-begin');

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1: Persist candidates to DB
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-persist');
    const persistStart = Date.now();
    console.log(`[finalize:persist:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('persist');
    let stored: unknown = null;
    try {
      stored = await withTimeout(
        replaceOpenSourcePhotoVisionCandidatesForSurveyRun(surveyId, job.userId, run),
        DB_STATEMENT_TIMEOUT_MS,
        'finalize:persist',
      );
      console.log(`[finalize:persist:end] jobId=${jobId} runHash=${runHash} stored=${!!stored} durationMs=${Date.now() - persistStart}`);
    } catch (persistErr) {
      const durationMs = Date.now() - persistStart;
      const errMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
      console.error(`[finalize:persist:end] jobId=${jobId} runHash=${runHash} FAILED: ${errMsg} durationMs=${durationMs}`);
      // Persist failure is FATAL — candidates are the foundation for all downstream stages
      throw persistErr;
    }
    finalizationResult.stored = stored;


    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1.5: Adapt Pipeline A candidates into unified geometry table
    // ═══════════════════════════════════════════════════════════════════════
    // This stage bridges Pipeline A (Photo Vision) into the Unified Geometry
    // system. It adapts all candidates through adaptPhotoVisionCandidate()
    // and writes them to the unified_geometry_artifacts table with
    // sourcePipeline='photo_vision'. This makes them visible in the
    // UNIFIED GEOMETRY panel under "Photo Vision: N".
    //
    // This is NON-FATAL — if it fails, the UI will still show data through
    // the FALLBACK path (on-the-fly adaptation from source tables).
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-unify');
    const unifyStart = Date.now();
    console.log(`[finalize:unify:start] jobId=${jobId} runHash=${runHash} candidates=${run.candidates.length}`);
    await heartbeat('unify');
    try {
      // Clean up any previous photo_vision artifacts for this survey
      // (handles re-finalization with ?retry=1)
      const deletedCount = await deleteUnifiedArtifactsByPipeline(surveyId, 'photo_vision');
      if (deletedCount > 0) {
        console.log(`[finalize:unify] jobId=${jobId} Deleted ${deletedCount} previous photo_vision artifacts`);
      }

      // Adapt all Pipeline A candidates through the adapter
      const adaptedArtifacts = adaptPhotoVisionBundle(run.candidates, surveyId);

      // Write all adapted artifacts to the unified table (batch INSERT — may take up to 2min for large candidate sets)
      const writeResult = await withTimeout(
        writeUnifiedArtifacts(adaptedArtifacts),
        120_000,
        'finalize:unify',
      );

      console.log(`[finalize:unify:end] jobId=${jobId} runHash=${runHash} adapted=${adaptedArtifacts.length} inserted=${writeResult.inserted} skipped=${writeResult.skipped} failed=${writeResult.failed} durationMs=${Date.now() - unifyStart}`);
      finalizationResult.unifiedWrite = {
        adapted: adaptedArtifacts.length,
        inserted: writeResult.inserted,
        skipped: writeResult.skipped,
        failed: writeResult.failed,
      };
    } catch (unifyErr) {
      const durationMs = Date.now() - unifyStart;
      const errMsg = unifyErr instanceof Error ? unifyErr.message : String(unifyErr);
      console.error(`[finalize:unify:end] jobId=${jobId} runHash=${runHash} FAILED (non-fatal): ${errMsg} durationMs=${durationMs}`);
      // Unification failure is NON-FATAL — the FALLBACK path in the bundle route
      // will adapt on-the-fly from the source tables.
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2: Update photo labels from YOLO/OCR candidates
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-labels');
    const labelsStart = Date.now();
    console.log(`[finalize:labels:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('labels');
    let labelUpdateResult: LabelUpdateResult | null = null;
    try {
      labelUpdateResult = await withTimeout(
        runLabelUpdateStage(surveyId, job.userId, run, jobId),
        DB_STATEMENT_TIMEOUT_MS,
        'finalize:labels',
      );
      console.log(`[finalize:labels:end] jobId=${jobId} runHash=${runHash} filesWithCandidates=${labelUpdateResult.filesWithCandidates} filesUpdated=${labelUpdateResult.filesUpdated} durationMs=${Date.now() - labelsStart}`);
    } catch (labelErr) {
      const durationMs = Date.now() - labelsStart;
      const errMsg = labelErr instanceof Error ? labelErr.message : String(labelErr);
      console.error(`[finalize:labels:end] jobId=${jobId} runHash=${runHash} FAILED: ${errMsg} durationMs=${durationMs}`);
      // Label failure is FATAL — downstream stages depend on labels being set
      throw labelErr;
    }
    finalizationResult.labelUpdate = labelUpdateResult
      ? {
          filesWithCandidates: labelUpdateResult.filesWithCandidates,
          filesUpdated: labelUpdateResult.filesUpdated,
        }
      : null;

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 3: Register obstructions on roof_plane photos
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-obstructions');
    const obstructionsStart = Date.now();
    console.log(`[finalize:obstructions:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('obstructions');
    let obstructionRegistration: ObstructionRegistrationResult | null = null;
    try {
      // Build fileId→filename map (needed by registerObstructionsForSurvey)
      const sql = await getDbReady();
      const allCandidateFileIds = new Set(run.candidates.map(c => c.fileId));
      const fileIdToFilename = new Map<string, string>();
      if (allCandidateFileIds.size > 0) {
        const fileIdArray = Array.from(allCandidateFileIds);
        const BATCH_SIZE = 100;
        for (let i = 0; i < fileIdArray.length; i += BATCH_SIZE) {
          const batch = fileIdArray.slice(i, i + BATCH_SIZE);
          const rows = await sql`
            SELECT id, filename
            FROM site_survey_files
            WHERE survey_id = ${surveyId}
              AND id = ANY(${batch}::uuid[])
          `;
          for (const row of rows as Record<string, unknown>[]) {
            const id = row.id as string;
            const filename = row.filename as string | null;
            if (filename) fileIdToFilename.set(id, filename);
          }
        }
      }

      obstructionRegistration = await withTimeout(
        registerObstructionsForSurvey(surveyId, run, fileIdToFilename),
        DB_STATEMENT_TIMEOUT_MS,
        'finalize:obstructions',
      );
      console.log(`[finalize:obstructions:end] jobId=${jobId} runHash=${runHash} totalObstructions=${obstructionRegistration.totalObstructions} roofPhotosProcessed=${obstructionRegistration.roofPhotosProcessed} durationMs=${Date.now() - obstructionsStart}`);
    } catch (obsErr) {
      const durationMs = Date.now() - obstructionsStart;
      const errMsg = obsErr instanceof Error ? obsErr.message : String(obsErr);
      console.error(`[finalize:obstructions:end] jobId=${jobId} runHash=${runHash} FAILED (non-fatal): ${errMsg} durationMs=${durationMs}`);
      // Obstruction registration failure is NON-FATAL — continue to classification
    }
    finalizationResult.obstructionRegistration = obstructionRegistration
      ? { totalObstructions: obstructionRegistration.totalObstructions, roofPhotosProcessed: obstructionRegistration.roofPhotosProcessed }
      : null;

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 4: OpenAI Vision fallback classification
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-classification');
    const classificationStart = Date.now();
    console.log(`[finalize:classification:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('classification');
    let visionClassification: VisionClassificationBatchResult | null = null;
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      try {
        visionClassification = await withTimeout(
          classifyUnclassifiedPhotosWithVision(surveyId, openaiApiKey),
          VISION_CLASSIFICATION_BUDGET_MS,
          'finalize:classification',
        );
        console.log(`[finalize:classification:end] jobId=${jobId} runHash=${runHash} totalClassified=${visionClassification.totalClassified} estimatedCost=${visionClassification.estimatedCost.toFixed(4)} durationMs=${Date.now() - classificationStart}`);
      } catch (classErr) {
        const durationMs = Date.now() - classificationStart;
        const errMsg = classErr instanceof Error ? classErr.message : String(classErr);
        console.error(`[finalize:classification:end] jobId=${jobId} runHash=${runHash} FAILED (non-fatal): ${errMsg} durationMs=${durationMs}`);
        // Vision classification failure is NON-FATAL — continue to Phase 4A
      }
    } else {
      console.log(`[finalize:classification:end] jobId=${jobId} runHash=${runHash} SKIPPED (OPENAI_API_KEY not set) durationMs=${Date.now() - classificationStart}`);
    }
    finalizationResult.visionClassification = visionClassification
      ? { totalClassified: visionClassification.totalClassified, estimatedCost: visionClassification.estimatedCost }
      : null;

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 5: Phase 4A aggregation (homography projection)
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-phase4a');
    const phase4aStart = Date.now();
    console.log(`[finalize:phase4a:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('phase4a');
    let aggregationResult = null;
    try {
      const projectId = run.projectId ?? job.surveyId;
      const photoVisionResults = convertWorkerResultToPhotoVisionResults(run, projectId);

      // Enrich photo contexts with survey data
      const surveyFiles = await withTimeout(
        getSiteSurveyFiles(surveyId),
        DB_READ_TIMEOUT_MS,
        'finalize:phase4a:get-survey-files',
      );
      const photoFiles = surveyFiles.filter(f => f.fileType === 'photo');

      // Build per-roof-plane reference image lookup
      const roofPlaneReferenceImages: Record<string, string> = {};
      for (const sf of photoFiles) {
        const planeId = (sf as unknown as Record<string, unknown>).roofPlaneId as string | null | undefined;
        const refUrl = (sf as unknown as Record<string, unknown>).referenceImageUrl as string | null | undefined;
        if (planeId && refUrl) {
          roofPlaneReferenceImages[planeId] = refUrl;
        }
      }

      for (const pvr of photoVisionResults) {
        const surveyFile = photoFiles.find(sf => sf.id === pvr.fileId);
        if (surveyFile) {
          const surveyFileAny = surveyFile as unknown as Record<string, unknown>;
          const surveyRoofPlaneId = surveyFileAny.roofPlaneId as string | null ?? null;
          enrichPhotoContextWithSurveyData(pvr, {
            fileId: surveyFile.id,
            lat: surveyFileAny.lat as number | null ?? null,
            lng: surveyFileAny.lng as number | null ?? null,
            azimuth: surveyFileAny.azimuth as number | null ?? null,
            pitch: surveyFileAny.pitch as number | null ?? null,
            label: surveyFile.label ?? null,
            roofPlaneId: surveyRoofPlaneId,
            referenceImageUrl: null,
          });

          const resolvedRefUrl = resolveReferenceImageUrl({
            roofPlaneReferenceImages,
            roofPlaneId: surveyRoofPlaneId,
            cadSvgRasterUrl: (run as unknown as Record<string, unknown>).cadSvgRasterUrl as string | null ?? null,
            orthographicArtifactUrl: (run as unknown as Record<string, unknown>).orthographicArtifactUrl as string | null ?? null,
            surveySelectedReferenceUrl: surveyFileAny.referenceImageUrl as string | null ?? null,
          });
          pvr.photoContext.referenceImageUrl = resolvedRefUrl;
        }
      }

      aggregationResult = await withTimeout(
        aggregateVisionResults(photoVisionResults, projectId, surveyId),
        PHASE4A_AGGREGATION_TIMEOUT_MS,
        'finalize:phase4a:aggregate',
      );
      const phase4aDuration = Date.now() - phase4aStart;
      console.log(`[finalize:phase4a:end] jobId=${jobId} runHash=${runHash} obstructions=${aggregationResult.obstructions.length} electrical=${aggregationResult.electricalNodes.length} corrections=${aggregationResult.planeCorrections.length} durationMs=${phase4aDuration}`);
    } catch (aggErr) {
      const phase4aDuration = Date.now() - phase4aStart;
      const errMsg = aggErr instanceof Error ? aggErr.message : String(aggErr);
      console.error(`[finalize:phase4a:end] jobId=${jobId} runHash=${runHash} FAILED (non-fatal): ${errMsg} durationMs=${phase4aDuration}`);
    }

    // ── Build Phase 4A diagnostics shape ──
    if (aggregationResult) {
      const logLines = aggregationResult.log;
      const projectionMethodCounts: Record<string, number> = {};
      const fallbackReasonCounts: Record<string, number> = {};
      let homographyAttempted = false;
      let homographySucceeded = false;
      let avgProjectionConfidence = 0;
      let avgReprojectionError: number | null = null;

      for (const line of logLines) {
        const projMatch = line.match(/projected=(\d+)\/(\d+)/);
        if (projMatch) {
          projectionMethodCounts['homography_assisted'] = parseInt(projMatch[1], 10);
          const total = parseInt(projMatch[2], 10);
          projectionMethodCounts['gps_azimuth_pitch'] = total - parseInt(projMatch[1], 10);
          homographyAttempted = true;
          homographySucceeded = parseInt(projMatch[1], 10) > 0;
        }
        const confMatch = line.match(/avgConf=([\d.]+)/);
        if (confMatch) {
          avgProjectionConfidence = parseFloat(confMatch[1]);
        }
        if (line.includes('BUDGET_EXHAUSTED')) {
          fallbackReasonCounts['budget_exhausted'] = (fallbackReasonCounts['budget_exhausted'] ?? 0) + 1;
        }
        if (line.includes('homographyAttempts=')) {
          homographyAttempted = true;
        }
        if (line.includes('homography_projection_disabled')) {
          fallbackReasonCounts['homography_projection_disabled'] = (fallbackReasonCounts['homography_projection_disabled'] ?? 0) + 1;
        }
        if (line.includes('missing_reference_image')) {
          fallbackReasonCounts['missing_reference_image'] = (fallbackReasonCounts['missing_reference_image'] ?? 0) + 1;
        }
        if (line.includes('missing_gps_coords')) {
          fallbackReasonCounts['missing_gps_coords'] = (fallbackReasonCounts['missing_gps_coords'] ?? 0) + 1;
        }
        if (line.includes('insufficient_inliers')) {
          fallbackReasonCounts['insufficient_inliers'] = (fallbackReasonCounts['insufficient_inliers'] ?? 0) + 1;
        }
        if (line.includes('reprojection_error_too_high')) {
          fallbackReasonCounts['reprojection_error_too_high'] = (fallbackReasonCounts['reprojection_error_too_high'] ?? 0) + 1;
        }
      }

      finalizationResult.phase4a = {
        status: 'complete' as const,
        photosProcessed: aggregationResult.photosProcessed,
        rawDetectionCount: aggregationResult.rawDetectionCount,
        obstructionNodes: aggregationResult.obstructions.length,
        electricalNodes: aggregationResult.electricalNodes.length,
        planeCorrections: aggregationResult.planeCorrections.length,
        classCounts: aggregationResult.classCounts,
        hasHighConfidenceDetections: aggregationResult.hasHighConfidenceDetections,
        projectionMethodCounts,
        fallbackReasonCounts,
        homographyAttempted,
        homographySucceeded,
        avgProjectionConfidence,
        avgReprojectionError,
        durationMs: Date.now() - phase4aStart,
        logSample: aggregationResult.log.slice(-5),
      };
    } else {
      finalizationResult.phase4a = {
        status: 'failed' as const,
        error: 'Phase 4A aggregation did not produce results',
        projectionMethodCounts: {},
        fallbackReasonCounts: {},
        homographyAttempted: false,
        homographySucceeded: false,
        avgProjectionConfidence: 0,
        avgReprojectionError: null,
        durationMs: Date.now() - phase4aStart,
        logSample: [],
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 6: Store finalization result
    // ═══════════════════════════════════════════════════════════════════════
    checkAbort('pre-store-result');
    const storeResultStart = Date.now();
    console.log(`[finalize:store-result:start] jobId=${jobId} runHash=${runHash}`);
    await heartbeat('store-result');
    try {
      await withTimeout(
        markFinalizationComplete(job.jobId, finalizationResult),
        DB_READ_TIMEOUT_MS,
        'finalize:store-result',
      );
      console.log(`[finalize:store-result:end] jobId=${jobId} runHash=${runHash} durationMs=${Date.now() - storeResultStart}`);
    } catch (storeErr) {
      const durationMs = Date.now() - storeResultStart;
      const errMsg = storeErr instanceof Error ? storeErr.message : String(storeErr);
      console.error(`[finalize:store-result:end] jobId=${jobId} runHash=${runHash} FAILED: ${errMsg} durationMs=${durationMs}`);
      // If we can't store the result, the finalization is effectively failed
      throw storeErr;
    }

    // ── Complete ──
    clearTimeout(overallTimeout);
    clearTimeout(vercelGracePeriodTimeout);
    const totalDuration = Date.now() - finalizeStart;
    console.log(`[finalize:complete] jobId=${jobId} runHash=${runHash} totalDurationMs=${totalDuration}`);

    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      finalizationStatus: 'complete',
      finalizationResult,
      durationMs: totalDuration,
    });

  } catch (fatalErr) {
    clearTimeout(overallTimeout);
    clearTimeout(vercelGracePeriodTimeout);
    const totalDuration = Date.now() - finalizeStart;
    const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    const isAborted = abortController.signal.aborted;
    const stage = job.finalizationStage ?? 'unknown';
    console.error(`[finalize:failed] jobId=${jobId} stage=${stage} FATAL: ${errMsg} durationMs=${totalDuration} aborted=${isAborted} vercelGracePeriodFired=${vercelGracePeriodFired}`);

    // Always mark finalization as failed — this is the CRITICAL guarantee
    // If vercelGracePeriodFired already marked it, this is a no-op (idempotent)
    try {
      await markFinalizationFailed(job.jobId, `stage=${stage}: ${errMsg}`);
    } catch (markErr) {
      console.error(`[finalize:failed] jobId=${jobId} also failed to mark finalization as failed:`, markErr);
    }

    return NextResponse.json({
      success: false,
      jobId: job.jobId,
      finalizationStatus: 'failed',
      error: errMsg,
      stage,
      durationMs: totalDuration,
      aborted: isAborted || undefined,
      vercelGracePeriodFired: vercelGracePeriodFired || undefined,
    }, { status: 500 });
  }
}
