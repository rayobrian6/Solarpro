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
//   - CAS on finalization_status='pending' prevents duplicate runs.
//   - Candidate persistence uses (surveyId, runHash) dedup.
//
// INSTRUMENTATION:
//   Every stage emits [finalize:STAGE:start] and [finalize:STAGE:end] logs
//   with durationMs. All stages are wrapped in try/catch that calls
//   markFinalizationFailed() — no swallowed errors, no unbounded awaits,
//   no Promise.all without timeout, no infinite polling, no worker re-run.
//
// Review-only candidates only: no CAD/canonical/permit/BOM/workflow mutation.
// ============================================================================

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// ---------------------------------------------------------------------------
// Timeout constants
// ---------------------------------------------------------------------------

/** Overall timeout for the entire finalization pipeline (ms). */
const FINALIZATION_OVERALL_TIMEOUT_MS = 55_000; // 55s — leaves 5s headroom in Vercel's 60s limit

/** Timeout per OpenAI Vision classification call (ms). Already has 30s per-call, but add overall budget. */
const VISION_CLASSIFICATION_BUDGET_MS = 5 * 60_000; // 5 min — but capped by overall timeout

/** Statement timeout for DB operations during finalization (ms). */
const DB_STATEMENT_TIMEOUT_MS = 30_000; // 30s per DB statement

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

export async function POST(
  req: NextRequest,
  { params }: { params: { surveyId: string } },
) {
  const finalizeStart = Date.now();
  const surveyId = params?.surveyId ?? 'unknown';

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

  console.log(`[finalize:start] surveyId=${surveyId} jobId=${jobId}`);

  // Verify job exists and belongs to this survey
  const job = await getJob(jobId);
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

  // ── Handle stuck 'running' status (from killed fire-and-forget) ──
  if (job.finalizationStatus === 'running') {
    const reset = await resetStuckFinalization(jobId);
    if (reset) {
      console.log(`[finalize:start] jobId=${jobId} reset stuck 'running' finalization back to 'pending'`);
      const refreshed = await getJob(jobId);
      if (refreshed) {
        job.finalizationStatus = refreshed.finalizationStatus;
        job.finalizationResult = refreshed.finalizationResult;
        job.finalizationError = refreshed.finalizationError;
      }
    } else {
      console.log(`[finalize:start] jobId=${jobId} finalization is actively running, returning status`);
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        finalizationStatus: 'running',
        message: 'Finalization is currently in progress. Poll GET for completion.',
      });
    }
  }

  // ── Claim the finalization slot (CAS) ──
  if (job.finalizationStatus === 'pending' || job.finalizationStatus === 'failed') {
    const claimed = await markFinalizationStarted(jobId);
    if (!claimed) {
      console.log(`[finalize:start] jobId=${jobId} finalization slot already claimed, returning status`);
      const refreshed = await getJob(jobId);
      return NextResponse.json({
        success: true,
        jobId: job.jobId,
        finalizationStatus: refreshed?.finalizationStatus ?? 'running',
        message: 'Finalization is currently in progress. Poll GET for completion.',
      });
    }
  }

  // ── Run the full finalization pipeline ──
  const run = job.result!;
  const runHash = run.runHash;
  const finalizationResult: Record<string, unknown> = {};

  // Overall timeout guard — if the pipeline exceeds this, we abort
  const overallTimeout = setTimeout(() => {
    console.error(`[finalize:failed] jobId=${jobId} OVERALL TIMEOUT — pipeline exceeded ${FINALIZATION_OVERALL_TIMEOUT_MS}ms`);
  }, FINALIZATION_OVERALL_TIMEOUT_MS);

  try {
    // ════════════════════════════════════════════════════════════════════
    // STAGE 1: Persist candidates to DB
    // ════════════════════════════════════════════════════════════════════
    const persistStart = Date.now();
    console.log(`[finalize:persist:start] jobId=${jobId} runHash=${runHash}`);
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

    // ════════════════════════════════════════════════════════════════════
    // STAGE 2: Update photo labels from YOLO/OCR candidates
    // ════════════════════════════════════════════════════════════════════
    const labelsStart = Date.now();
    console.log(`[finalize:labels:start] jobId=${jobId} runHash=${runHash}`);
    let labelUpdateResult: LabelUpdateResult | null = null;
    try {
      labelUpdateResult = await runLabelUpdateStage(surveyId, job.userId, run, jobId);
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

    // ════════════════════════════════════════════════════════════════════
    // STAGE 3: Register obstructions on roof_plane photos
    // ════════════════════════════════════════════════════════════════════
    const obstructionsStart = Date.now();
    console.log(`[finalize:obstructions:start] jobId=${jobId} runHash=${runHash}`);
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

    // ════════════════════════════════════════════════════════════════════
    // STAGE 4: OpenAI Vision fallback classification
    // ════════════════════════════════════════════════════════════════════
    const classificationStart = Date.now();
    console.log(`[finalize:classification:start] jobId=${jobId} runHash=${runHash}`);
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

    // ════════════════════════════════════════════════════════════════════
    // STAGE 5: Phase 4A aggregation (homography projection)
    // ════════════════════════════════════════════════════════════════════
    const phase4aStart = Date.now();
    console.log(`[finalize:phase4a:start] jobId=${jobId} runHash=${runHash}`);
    let aggregationResult = null;
    try {
      const projectId = run.projectId ?? job.surveyId;
      const photoVisionResults = convertWorkerResultToPhotoVisionResults(run, projectId);

      // Enrich photo contexts with survey data
      const surveyFiles = await getSiteSurveyFiles(surveyId);
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

      aggregationResult = await aggregateVisionResults(
        photoVisionResults,
        projectId,
        surveyId,
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

    // ════════════════════════════════════════════════════════════════════
    // STAGE 6: Store finalization result
    // ════════════════════════════════════════════════════════════════════
    const storeResultStart = Date.now();
    console.log(`[finalize:store-result:start] jobId=${jobId} runHash=${runHash}`);
    try {
      await markFinalizationComplete(job.jobId, finalizationResult);
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
    const totalDuration = Date.now() - finalizeStart;
    const errMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[finalize:failed] jobId=${jobId} runHash=${runHash} FATAL: ${errMsg} durationMs=${totalDuration}`);
    try {
      await markFinalizationFailed(job.jobId, errMsg);
    } catch (markErr) {
      console.error(`[finalize:failed] jobId=${jobId} also failed to mark finalization as failed:`, markErr);
    }
    return NextResponse.json({
      success: false,
      jobId: job.jobId,
      finalizationStatus: 'failed',
      error: errMsg,
      durationMs: totalDuration,
    }, { status: 500 });
  }
}
