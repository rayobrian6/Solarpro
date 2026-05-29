// ============================================================================
// Async Photo Vision Job Manager — PostgreSQL-backed (v0.4)
//
// Production architecture:
//   POST creates a job record in DB + submits ALL files to Render → returns jobId instantly.
//   Render processes all photos in batches internally, writing progress to Neon DB directly.
//   GET just reads DB status (instant — no Render communication).
//   Client polls GET every few seconds for progress.
//
// This eliminates Vercel's 60s timeout from the critical processing path entirely.
// ============================================================================

import crypto from 'crypto';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionRunResult,
} from './openSourcePhotoVisionWorker';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import { updateSiteSurveyFileLabels } from '@/lib/db/surveys';
import {
  EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
  EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
  getExternalOpenCvWorkerUrl,
} from './externalOpenCvPhotoVisionClient';
import { getDbReady } from '@/lib/db/core';
import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/categoryRegistry';
import {
  getEvidenceCategoryForCandidate,
  extractYoloClassNameFromPayload,
  buildCandidateCountSummaries,
  classifyFileFromCandidates,
  type FilenameCandidateSummary,
} from './yoloToEvidenceMapper';
import {
  registerObstructionsForSurvey,
  type ObstructionRegistrationResult,
} from './roofObstructionRegistration';
import {
  classifyUnclassifiedPhotosWithVision,
  type VisionClassificationBatchResult,
} from './openaiVisionClassifier';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type FinalizationStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';

export interface PhotoVisionJob {
  jobId: string;
  surveyId: string;
  userId: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  totalBatches: number;
  currentBatch: number;
  completedBatches: number;
  totalPhotoFiles: number;
  processedFiles: number;
  result: OpenSourcePhotoVisionRunResult | null;
  error: string | null;
  renderJobId: string | null;
  // Finalization tracking (migration 075)
  finalizationStatus: FinalizationStatus;
  finalizationResult: Record<string, unknown> | null;
  finalizationError: string | null;
  finalizationStartedAt: number | null;
  finalizationCompletedAt: number | null;
  // Finalization stage + heartbeat (migration 076)
  finalizationStage: string | null;
  finalizationLastHeartbeatAt: number | null;
}

// ---------------------------------------------------------------------------
// Create a new job in the database AND submit to Render
// This is the ONLY function that communicates with Render — everything else
// is pure DB reads.
// ---------------------------------------------------------------------------
export async function createAndSubmitJob(
  surveyId: string,
  userId: string,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  photoFiles: SiteSurveyFile[],
): Promise<{ job: PhotoVisionJob; renderSubmitOk: boolean; renderError?: string }> {
  const sql = await getDbReady();
  const jobId = `job_${surveyId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batchSize = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_SIZE || 2);
  const totalBatches = Math.ceil(photoFiles.length / batchSize);

  const createdAtISO = new Date().toISOString();

  // Store survey + photoFiles as the job input
  const jobInput = {
    survey: { id: survey.id, projectId: survey.projectId ?? null },
    photoFiles: photoFiles.map(f => ({
      id: f.id,
      fileUrl: f.fileUrl,
      filename: f.filename,
      mimeType: f.mimeType ?? null,
      fileType: f.fileType,
    })),
    batchSize,
    createdAtISO,
  };

  // Create job in DB first
  await sql`
    INSERT INTO photo_vision_jobs (
      job_id, survey_id, user_id, status, job_input,
      total_batches, current_batch, completed_batches,
      total_photo_files, processed_files
    ) VALUES (
      ${jobId}, ${surveyId}, ${userId}, 'pending', ${JSON.stringify(jobInput)},
      ${totalBatches}, 0, 0, ${photoFiles.length}, 0
    )
  `;

  const job: PhotoVisionJob = {
    jobId,
    surveyId,
    userId,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    totalBatches,
    currentBatch: 0,
    completedBatches: 0,
    totalPhotoFiles: photoFiles.length,
    processedFiles: 0,
    result: null,
    error: null,
    renderJobId: null,
    finalizationStatus: 'pending',
    finalizationResult: null,
    finalizationError: null,
    finalizationStartedAt: null,
    finalizationCompletedAt: null,
    finalizationStage: null,
    finalizationLastHeartbeatAt: null,
  };

  // Submit ALL files to Render in one POST
  let renderSubmitOk = false;
  let renderError: string | undefined;
  let renderJobId: string | undefined;

  try {
    const workerUrl = getExternalOpenCvWorkerUrl();
    if (!workerUrl) {
      renderError = 'External worker URL not configured';
    } else {
      const jobPayload = {
        schemaVersion: 'solarpro_external_photo_vision_job_v1',
        surveyId: survey.id,
        projectId: survey.projectId ?? null,
        createdAt: createdAtISO,
        jobId,  // Vercel job ID so Render can write to DB
        requestedTools: ['opencv_primitives', 'yolo_detection', 'tesseract_ocr', 'ocr_equipment_labels'],
        files: photoFiles.map(file => ({
          fileId: file.id,
          fileUrl: file.fileUrl,
          filename: file.filename,
          contentType: file.mimeType ?? null,
        })),
      };

      console.log(`[asyncJobManager] Job ${jobId}: submitting ${photoFiles.length} files to Render in one POST`);

      const submitRes = await fetch(`${workerUrl}/v1/photo-vision/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobPayload),
        signal: AbortSignal.timeout(30_000), // 30s to submit (should be instant 202)
      });

      if (submitRes.status === 202) {
        const submitJson = await submitRes.json() as Record<string, unknown>;
        renderJobId = submitJson.renderJobId as string;
        renderSubmitOk = true;
        console.log(`[asyncJobManager] Job ${jobId}: Render accepted, renderJobId=${renderJobId}`);
      } else {
        const errorText = await submitRes.text().catch(() => 'unknown error');
        renderError = `Render returned ${submitRes.status}: ${errorText.slice(0, 200)}`;
        console.error(`[asyncJobManager] Job ${jobId}: Render submit failed: ${renderError}`);
      }
    }
  } catch (err) {
    renderError = err instanceof Error ? err.message : String(err);
    console.error(`[asyncJobManager] Job ${jobId}: Render submit error: ${renderError}`);
  }

  // Update DB with render_job_id
  if (renderJobId) {
    await sql`
      UPDATE photo_vision_jobs
      SET render_job_id = ${renderJobId}, updated_at = NOW()
      WHERE job_id = ${jobId}
    `;
    job.renderJobId = renderJobId;
  }

  // If Render submit failed, mark job as failed
  if (!renderSubmitOk) {
    await sql`
      UPDATE photo_vision_jobs
      SET status = 'failed', error = ${renderError || 'Failed to submit to Render worker'}, updated_at = NOW()
      WHERE job_id = ${jobId}
    `;
    job.status = 'failed';
    job.error = renderError || 'Failed to submit to Render worker';
  }

  return { job, renderSubmitOk, renderError };
}

// ---------------------------------------------------------------------------
// Get job from database (lightweight — skips large JSONB columns)
// ---------------------------------------------------------------------------
export async function getJob(jobId: string): Promise<PhotoVisionJob | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT job_id, survey_id, user_id, status,
           EXTRACT(EPOCH FROM created_at)::bigint * 1000 AS created_at_ms,
           EXTRACT(EPOCH FROM updated_at)::bigint * 1000 AS updated_at_ms,
           EXTRACT(EPOCH FROM completed_at)::bigint * 1000 AS completed_at_ms,
           total_batches, current_batch, completed_batches,
           total_photo_files, processed_files,
           final_result, error, render_job_id,
           finalization_status,
           finalization_result,
           finalization_error,
           EXTRACT(EPOCH FROM finalization_started_at)::bigint * 1000 AS finalization_started_at_ms,
           EXTRACT(EPOCH FROM finalization_completed_at)::bigint * 1000 AS finalization_completed_at_ms,
           finalization_stage,
           EXTRACT(EPOCH FROM finalization_last_heartbeat_at)::bigint * 1000 AS finalization_last_heartbeat_at_ms
    FROM photo_vision_jobs
    WHERE job_id = ${jobId}
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    jobId: row.job_id as string,
    surveyId: row.survey_id as string,
    userId: row.user_id as string,
    status: row.status as JobStatus,
    createdAt: Number(row.created_at_ms) || Date.now(),
    updatedAt: Number(row.updated_at_ms) || Date.now(),
    completedAt: row.completed_at_ms ? Number(row.completed_at_ms) : null,
    totalBatches: Number(row.total_batches) || 0,
    currentBatch: Number(row.current_batch) || 0,
    completedBatches: Number(row.completed_batches) || 0,
    totalPhotoFiles: Number(row.total_photo_files) || 0,
    processedFiles: Number(row.processed_files) || 0,
    result: row.final_result as OpenSourcePhotoVisionRunResult | null,
    error: row.error as string | null,
    renderJobId: (row.render_job_id as string) || null,
    finalizationStatus: (row.finalization_status as FinalizationStatus) || 'pending',
    finalizationResult: (row.finalization_result as Record<string, unknown> | null) || null,
    finalizationError: (row.finalization_error as string | null) || null,
    finalizationStartedAt: row.finalization_started_at_ms ? Number(row.finalization_started_at_ms) : null,
    finalizationCompletedAt: row.finalization_completed_at_ms ? Number(row.finalization_completed_at_ms) : null,
    finalizationStage: (row.finalization_stage as string | null) || null,
    finalizationLastHeartbeatAt: row.finalization_last_heartbeat_at_ms ? Number(row.finalization_last_heartbeat_at_ms) : null,
  };
}

// ---------------------------------------------------------------------------
// Find an existing active (pending/running) job for a survey
// ---------------------------------------------------------------------------
export async function findActiveJobForSurvey(surveyId: string): Promise<PhotoVisionJob | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT job_id, survey_id, user_id, status,
           EXTRACT(EPOCH FROM created_at)::bigint * 1000 AS created_at_ms,
           EXTRACT(EPOCH FROM updated_at)::bigint * 1000 AS updated_at_ms,
           EXTRACT(EPOCH FROM completed_at)::bigint * 1000 AS completed_at_ms,
           total_batches, current_batch, completed_batches,
           total_photo_files, processed_files,
           final_result, error, render_job_id,
           finalization_status,
           finalization_result,
           finalization_error,
           EXTRACT(EPOCH FROM finalization_started_at)::bigint * 1000 AS finalization_started_at_ms,
           EXTRACT(EPOCH FROM finalization_completed_at)::bigint * 1000 AS finalization_completed_at_ms,
           finalization_stage,
           EXTRACT(EPOCH FROM finalization_last_heartbeat_at)::bigint * 1000 AS finalization_last_heartbeat_at_ms
    FROM photo_vision_jobs
    WHERE survey_id = ${surveyId} AND status IN ('pending', 'running')
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, unknown>;
  return {
    jobId: row.job_id as string,
    surveyId: row.survey_id as string,
    userId: row.user_id as string,
    status: row.status as JobStatus,
    createdAt: Number(row.created_at_ms) || Date.now(),
    updatedAt: Number(row.updated_at_ms) || Date.now(),
    completedAt: row.completed_at_ms ? Number(row.completed_at_ms) : null,
    totalBatches: Number(row.total_batches) || 0,
    currentBatch: Number(row.current_batch) || 0,
    completedBatches: Number(row.completed_batches) || 0,
    totalPhotoFiles: Number(row.total_photo_files) || 0,
    processedFiles: Number(row.processed_files) || 0,
    result: row.final_result as OpenSourcePhotoVisionRunResult | null,
    error: row.error as string | null,
    renderJobId: (row.render_job_id as string) || null,
    finalizationStatus: (row.finalization_status as FinalizationStatus) || 'pending',
    finalizationResult: (row.finalization_result as Record<string, unknown> | null) || null,
    finalizationError: (row.finalization_error as string | null) || null,
    finalizationStartedAt: row.finalization_started_at_ms ? Number(row.finalization_started_at_ms) : null,
    finalizationCompletedAt: row.finalization_completed_at_ms ? Number(row.finalization_completed_at_ms) : null,
    finalizationStage: (row.finalization_stage as string | null) || null,
    finalizationLastHeartbeatAt: row.finalization_last_heartbeat_at_ms ? Number(row.finalization_last_heartbeat_at_ms) : null,
  };
}

// ---------------------------------------------------------------------------
// Count active jobs for a user (for rate limiting)
// ---------------------------------------------------------------------------
export async function countActiveJobsForUser(userId: string): Promise<number> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT COUNT(*) AS cnt
    FROM photo_vision_jobs
    WHERE user_id = ${userId} AND status IN ('pending', 'running')
  `;
  return Number((rows[0] as Record<string, unknown>)?.cnt ?? 0);
}

// ---------------------------------------------------------------------------
// Cancel a job (mark as failed in DB + best-effort cancel on Render)
// ---------------------------------------------------------------------------
export async function cancelJob(jobId: string): Promise<boolean> {
  const sql = await getDbReady();

  // Get render_job_id so we can cancel on Render too
  const rows = await sql`
    SELECT render_job_id FROM photo_vision_jobs WHERE job_id = ${jobId} AND status IN ('pending', 'running')
  `;
  const renderJobId = rows.length ? (rows[0] as Record<string, unknown>)?.render_job_id as string | null : null;

  // Mark as failed in DB
  const result = await sql`
    UPDATE photo_vision_jobs
    SET status = 'failed', error = 'Cancelled by user', completed_at = NOW(), updated_at = NOW()
    WHERE job_id = ${jobId} AND status IN ('pending', 'running')
    RETURNING job_id
  `;

  // Best-effort cancel on Render
  if (renderJobId) {
    try {
      const workerUrl = getExternalOpenCvWorkerUrl();
      if (workerUrl) {
        await fetch(`${workerUrl}/v1/photo-vision/jobs/${renderJobId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5_000),
        });
      }
    } catch {
      // Ignore Render cancel errors
    }
  }

  // Neon serverless returns rows[] — RETURNING makes affected rows visible
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Mark stale jobs as failed (running > 60 min)
// ---------------------------------------------------------------------------
export async function markStaleJobsFailed(): Promise<number> {
  const sql = await getDbReady();
  const result = await sql`
    UPDATE photo_vision_jobs
    SET status = 'failed', error = 'Job timed out (running > 30 minutes)', completed_at = NOW(), updated_at = NOW()
    WHERE status = 'running' AND updated_at < NOW() - INTERVAL '60 minutes'
    RETURNING job_id
  `;
  return result.length;
}

// ---------------------------------------------------------------------------
// Update photo labels from YOLO/OCR candidates (v0.4 — filename-aggregated)
//
// This function is called after a photo vision run completes to auto-assign
// photo labels from high-confidence YOLO object detection and heuristic candidates.
//
// Algorithm:
// 1. Load fileId → filename mapping from site_survey_files
// 2. Build candidate count summaries AGGREGATED BY FILENAME (not file_id)
//    — This fixes the duplicate row problem where each photo has ~7 file_id rows
// 3. Group object_detection candidates by file_id, pick highest per file
// 4. Check which files currently have NULL/empty labels
// 5. Apply multi-heuristic classification using classifyFileFromCandidates()
//    — Combines YOLO (per file_id) + roof_edge_count (per filename) + diversity (per filename)
// 6. Apply updates to site_survey_files table
//
// Returns: Summary of updates performed
// ---------------------------------------------------------------------------
export interface UpdatePhotoLabelsFromCandidatesResult {
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
  obstructionRegistration?: ObstructionRegistrationResult | null;
  visionClassification?: VisionClassificationBatchResult | null;
}

export async function updatePhotoLabelsFromCandidates(
  surveyId: string,
  userId: string,
  run: OpenSourcePhotoVisionRunResult,
): Promise<UpdatePhotoLabelsFromCandidatesResult> {
  const startedAt = Date.now();
  const sql = await getDbReady();

  // Confidence threshold from env var (default: 0.55)
  // Set to 0.55 to accommodate YOLOv8-nano which produces lower confidence scores (0.55-0.70 range)
  // Each class-specific threshold in YOLO_CLASS_TO_EVIDENCE_CATEGORY acts as a floor
  const minConfidenceThreshold = Number(process.env.PHOTO_VISION_AUTO_LABEL_MIN_CONFIDENCE || 0.55);

  console.log(`[updatePhotoLabelsFromCandidates] surveyId=${surveyId} runHash=${run.runHash} minConfidence=${minConfidenceThreshold} totalCandidates=${run.candidates.length}`);

  // ── Step 1: Load fileId → filename mapping from site_survey_files ──
  // This is needed to aggregate candidates by filename (unique photo)
  // instead of by file_id (which has ~7 duplicate rows per photo)
  const fileIdToFilename = new Map<string, string>();
  const allCandidateFileIds = new Set(run.candidates.map(c => c.fileId));

  if (allCandidateFileIds.size > 0) {
    // Query in batches to avoid SQL parameter limits
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
  console.log(`[updatePhotoLabelsFromCandidates] Loaded ${fileIdToFilename.size} fileId→filename mappings (from ${allCandidateFileIds.size} candidate fileIds)`);

  // ── Step 2: Build candidate count summaries AGGREGATED BY FILENAME ──
  // This is the critical fix: instead of per-file_id (5-16 roof edges),
  // we aggregate by filename (50-80 roof edges) for meaningful heuristics
  const filenameSummaries = buildCandidateCountSummaries(run.candidates, fileIdToFilename);
  console.log(`[updatePhotoLabelsFromCandidates] Built ${filenameSummaries.size} filename summaries (aggregated from ${allCandidateFileIds.size} file_ids)`);

  // Log filename-level roof edge counts for debugging
  for (const [filename, summary] of filenameSummaries.entries()) {
    const roofEdgeCount = summary.candidateTypeCounts['roof_edge_candidate'] ?? 0;
    if (roofEdgeCount > 0) {
      console.log(`[updatePhotoLabelsFromCandidates] ${filename}: roof_edge=${roofEdgeCount}, total=${summary.totalCandidates}, types=${summary.distinctTypes}, dominant=${summary.dominantType}(${summary.dominantRatio.toFixed(2)})`);
    }
  }

  // ── Step 3: Group object_detection candidates by file_id, pick highest per file ──
  const objectDetectionByFile = new Map<string, OpenSourcePhotoVisionCandidate>();
  for (const candidate of run.candidates) {
    if (candidate.candidateType !== 'object_detection') continue;

    // Normalize confidence from 0-100 scale (Render worker) to 0-1 scale (mapper expectation)
    const normalizedCandidate = {
      ...candidate,
      confidence: candidate.confidence / 100,
    };

    const fileId = candidate.fileId;
    const existing = objectDetectionByFile.get(fileId);

    if (!existing || normalizedCandidate.confidence > existing.confidence) {
      objectDetectionByFile.set(fileId, normalizedCandidate);
    }
  }

  console.log(`[updatePhotoLabelsFromCandidates] Found ${objectDetectionByFile.size} files with object_detection candidates (out of ${run.processedCount} processed)`);

  // Pre-compute object_detection classification per file_id
  const objDetClassificationByFileId = new Map<string, {
    category: SurveyEvidenceCategory | null;
    confidence: number;
    yoloClass: string | null;
  }>();
  for (const [fileId, candidate] of objectDetectionByFile.entries()) {
    const category = getEvidenceCategoryForCandidate(candidate, minConfidenceThreshold);
    const yoloClass = extractYoloClassNameFromPayload(candidate.payload);
    objDetClassificationByFileId.set(fileId, {
      category,
      confidence: candidate.confidence,
      yoloClass,
    });
  }

  // ── Step 4: Check which files currently have NULL/empty labels ──
  const filesWithoutLabelsMap = new Map<string, { filename: string | null; label: string | null }>();
  // Collect ALL file_ids from filename summaries
  const allFileIdsFromSummaries: string[] = [];
  for (const summary of filenameSummaries.values()) {
    for (const fileId of summary.fileIds) {
      allFileIdsFromSummaries.push(fileId);
    }
  }

  if (allFileIdsFromSummaries.length > 0) {
    // Query in batches
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
  console.log(`[updatePhotoLabelsFromCandidates] ${filesEligibleForUpdate} files are eligible for label update (have no existing label)`);

  if (filesEligibleForUpdate === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates: allCandidateFileIds.size,
      filesEligibleForUpdate: 0,
      filesUpdated: 0,
      updates: [],
    };
  }

  // ── Step 5: Apply multi-heuristic classification per filename ──
  const updates: UpdatePhotoLabelsFromCandidatesResult['updates'] = [];
  const updatesForDb: Array<{ fileId: string; label: string }> = [];

  for (const [filename, summary] of filenameSummaries.entries()) {
    // Classify all file_ids in this filename group
    const classifications = classifyFileFromCandidates(summary, objDetClassificationByFileId);

    for (const classification of classifications) {
      // Skip if file already has a label
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

        updatesForDb.push({
          fileId: classification.fileId,
          label: classification.category,
        });

        console.log(`[updatePhotoLabelsFromCandidates] ${classification.fileId} (${filenameStr}) → ${classification.category} via ${classification.method}: ${classification.details}`);
      }
    }
  }

  console.log(`[updatePhotoLabelsFromCandidates] Prepared ${updatesForDb.length} label updates (from ${filenameSummaries.size} unique filenames)`);

  // Log method breakdown
  const methodBreakdown: Record<string, number> = {};
  for (const u of updates) {
    methodBreakdown[u.candidateType] = (methodBreakdown[u.candidateType] ?? 0) + 1;
  }
  console.log(`[updatePhotoLabelsFromCandidates] Method breakdown: ${JSON.stringify(methodBreakdown)}`);

  // Log unique filenames per category
  const categoryFilenames: Record<string, Set<string>> = {};
  for (const u of updates) {
    if (!categoryFilenames[u.newLabel]) categoryFilenames[u.newLabel] = new Set();
    categoryFilenames[u.newLabel].add(u.filename || 'unknown');
  }
  for (const [cat, fnames] of Object.entries(categoryFilenames)) {
    console.log(`[updatePhotoLabelsFromCandidates] ${cat}: ${fnames.size} unique filenames (${fnames.size * 7} expected file_id rows)`);
  }

  let filesUpdated = 0;
  if (updatesForDb.length === 0) {
    // No label updates, but still register obstructions and run Vision fallback
    console.log(`[updatePhotoLabelsFromCandidates] No heuristic label updates needed, proceeding to obstruction registration and Vision fallback`);
    // Fall through to Steps 7 and 8 below
  } else {

    // ── Step 6: Apply updates to site_survey_files table ──
    try {
      const updatedFiles = await updateSiteSurveyFileLabels(surveyId, userId, updatesForDb);
      filesUpdated = updatedFiles.length;
      console.log(`[updatePhotoLabelsFromCandidates] Successfully updated ${filesUpdated} files in ${(Date.now() - startedAt)}ms`);
    } catch (err) {
      console.error(`[updatePhotoLabelsFromCandidates] Failed to update labels:`, err);
      throw err;
    }

  } // end of else (updatesForDb.length > 0)

  // ─── Step 7: Register obstructions on roof_plane photos ───
  // After label updates are applied, extract obstruction candidate data
  // from roof_plane photos and store deduplicated obstruction records.
  let obstructionRegistration: ObstructionRegistrationResult | null = null;
  try {
    obstructionRegistration = await registerObstructionsForSurvey(
      surveyId,
      run,
      fileIdToFilename,
    );
    console.log(`[updatePhotoLabelsFromCandidates] Obstruction registration: ${obstructionRegistration.totalObstructions} obstructions across ${obstructionRegistration.roofPhotosProcessed} roof photos`);
  } catch (err) {
    console.error(`[updatePhotoLabelsFromCandidates] Obstruction registration failed (non-fatal):`, err);
    // Obstruction registration failure should not block the pipeline
  }

  // ─── Step 8: OpenAI Vision fallback for remaining unclassified photos ───
  // If any photos still lack labels after heuristic classification,
  // use GPT-4o Vision as a fallback classifier. This is especially
  // important for main_service_panel detection, which YOLO cannot handle.
  let visionClassification: VisionClassificationBatchResult | null = null;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (openaiApiKey) {
    try {
      visionClassification = await classifyUnclassifiedPhotosWithVision(
        surveyId,
        openaiApiKey,
      );
      console.log(`[updatePhotoLabelsFromCandidates] Vision classification: ${visionClassification.totalClassified} photos classified, ${visionClassification.estimatedCost.toFixed(4)} estimated cost`);
    } catch (err) {
      console.error(`[updatePhotoLabelsFromCandidates] Vision classification failed (non-fatal):`, err);
      // Vision classification failure should not block the pipeline
    }
  } else {
    console.log(`[updatePhotoLabelsFromCandidates] OPENAI_API_KEY not set, skipping Vision fallback classification`);
  }

  return {
    totalFiles: run.processedCount,
    filesWithCandidates: allCandidateFileIds.size,
    filesEligibleForUpdate,
    filesUpdated,
    updates,
    obstructionRegistration,
    visionClassification,
  };
}

// ---------------------------------------------------------------------------
// Finalization status management (migration 075)
// These functions track the post-processing state so the GET route can
// return immediately while heavy work runs in the background.
// ---------------------------------------------------------------------------

/**
 * Mark finalization as started. Uses a CAS (compare-and-swap) on
 * finalization_status IN ('pending', 'failed', 'skipped') to prevent duplicate
 * finalization runs while allowing retry of failed/skipped jobs.
 * Returns true if the update was applied (i.e. this caller won the race).
 *
 * NOTE: Previously only matched 'pending', which prevented retry of 'failed' jobs.
 * Now also matches 'failed' and 'skipped' so they can be re-finalized.
 * Clears finalization_error on retry to avoid stale error messages.
 */
export async function markFinalizationStarted(jobId: string): Promise<boolean> {
  const sql = await getDbReady();
  // CRITICAL: Neon serverless driver (without fullResults:true) returns rows[]
  // for UPDATE. Without RETURNING, rows[] is always empty regardless of whether
  // rows were affected. Adding RETURNING job_id makes the UPDATE return the
  // primary key of affected rows, so result.length > 0 means the CAS succeeded.
  const result = await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'running',
        finalization_started_at = NOW(),
        finalization_error = NULL,
        updated_at = NOW()
    WHERE job_id = ${jobId}
      AND finalization_status IN ('pending', 'failed', 'skipped')
    RETURNING job_id
  `;
  const claimed = result.length > 0;
  if (!claimed) {
    // Debug: re-read the row to show why CAS failed
    try {
      const debugRows = await sql`
        SELECT job_id, status, finalization_status, finalization_started_at, finalization_error
        FROM photo_vision_jobs
        WHERE job_id = ${jobId}
      `;
      const dbg = debugRows[0] as Record<string, unknown> | undefined;
      console.error(
        `[markFinalizationStarted] CAS FAILED for jobId=${jobId}. ` +
        `DB state: status=${dbg?.status} finalization_status=${dbg?.finalization_status} ` +
        `finalization_started_at=${dbg?.finalization_started_at} finalization_error=${dbg?.finalization_error}`
      );
    } catch (dbgErr) {
      console.error(`[markFinalizationStarted] CAS FAILED for jobId=${jobId}, and debug re-read also failed:`, dbgErr);
    }
  }
  return claimed;
}

/**
 * Mark finalization as complete and store the finalization result.
 */
export async function markFinalizationComplete(
  jobId: string,
  finalizationResult: Record<string, unknown>,
): Promise<void> {
  const sql = await getDbReady();
  await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'complete',
        finalization_result = ${JSON.stringify(finalizationResult)},
        finalization_completed_at = NOW(),
        updated_at = NOW()
    WHERE job_id = ${jobId}
  `;
}

/**
 * Mark finalization as failed with an error message.
 */
export async function markFinalizationFailed(
  jobId: string,
  error: string,
): Promise<void> {
  const sql = await getDbReady();
  await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'failed',
        finalization_error = ${error},
        finalization_completed_at = NOW(),
        updated_at = NOW()
    WHERE job_id = ${jobId}
  `;
}

/**
 * Reset finalization_status from 'running' back to 'pending' for a specific job.
 * This handles the case where a previous Vercel function invocation set
 * finalization_status='running' but was killed before completing the work
 * (Vercel terminates serverless functions after the response is sent).
 * Returns true if the reset was applied.
 */
export async function resetStuckFinalization(jobId: string): Promise<boolean> {
  const sql = await getDbReady();
  // Only reset if finalization has been running for more than 2 minutes
  // (prevents resetting a genuinely in-flight finalization from the /finalize route)
  const result = await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'pending',
        finalization_started_at = NULL,
        finalization_error = NULL,
        updated_at = NOW()
    WHERE job_id = ${jobId}
      AND finalization_status = 'running'
      AND finalization_started_at < NOW() - INTERVAL '2 minutes'
    RETURNING job_id
  `;
  return result.length > 0;
}

/**
 * Reset ALL jobs with stuck finalization (running > 5 minutes).
 * Called as housekeeping by the GET route.
 * Returns the number of jobs reset.
 */
export async function resetAllStuckFinalizations(): Promise<number> {
  const sql = await getDbReady();
  const result = await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'pending',
        finalization_started_at = NULL,
        finalization_error = NULL,
        updated_at = NOW()
    WHERE finalization_status = 'running'
      AND finalization_started_at < NOW() - INTERVAL '5 minutes'
    RETURNING job_id
  `;
  return result.length;
}

/**
 * Update finalization stage and heartbeat for a running job.
 * Called at each stage boundary so that stuck finalizations are visible
 * in the DB without relying on logs alone.
 */
export async function updateFinalizationStage(
  jobId: string,
  stage: string,
): Promise<void> {
  const sql = await getDbReady();
  await sql`
    UPDATE photo_vision_jobs
    SET finalization_stage = ${stage},
        finalization_last_heartbeat_at = NOW(),
        updated_at = NOW()
    WHERE job_id = ${jobId}
  `;
}

/**
 * Reset finalization_status from 'running' or 'failed' back to 'pending'.
 * Used by the ?retry=1 path to explicitly retry a stuck or failed finalization.
 * Only resets 'running' if it has been running for more than 2 minutes
 * (to avoid resetting a genuinely in-flight finalization).
 * Always resets 'failed' (explicit retry intent).
 * Returns true if the reset was applied.
 */
export async function resetStuckOrFailedFinalization(jobId: string): Promise<boolean> {
  const sql = await getDbReady();
  // Reset 'failed' unconditionally (explicit retry), or 'running' only if stale (>2min)
  const result = await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'pending',
        finalization_started_at = NULL,
        finalization_error = NULL,
        finalization_stage = NULL,
        finalization_last_heartbeat_at = NULL,
        updated_at = NOW()
    WHERE job_id = ${jobId}
      AND (
        finalization_status = 'failed'
        OR (finalization_status = 'running' AND finalization_started_at < NOW() - INTERVAL '2 minutes')
      )
    RETURNING job_id
  `;
  return result.length > 0;
}

/**
 * Reset finalization_status from 'complete' back to 'pending'.
 * Used by the ?retry=1 path to explicitly re-run a completed finalization
 * (e.g. to re-execute Stage 1.5 unify after a code fix).
 * Also clears finalizationResult so the pipeline produces fresh results.
 * Returns true if the reset was applied.
 */
export async function resetCompletedFinalization(jobId: string): Promise<boolean> {
  const sql = await getDbReady();
  const result = await sql`
    UPDATE photo_vision_jobs
    SET finalization_status = 'pending',
        finalization_started_at = NULL,
        finalization_error = NULL,
        finalization_stage = NULL,
        finalization_last_heartbeat_at = NULL,
        finalization_result = NULL,
        updated_at = NOW()
    WHERE job_id = ${jobId}
      AND finalization_status = 'complete'
    RETURNING job_id
  `;
  return result.length > 0;
}
