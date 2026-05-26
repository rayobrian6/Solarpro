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

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

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
           final_result, error, render_job_id
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
           final_result, error, render_job_id
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

  // Neon's sql tagged template returns rows[]; for UPDATE we check affected rows via the result metadata
  const affected = Array.isArray(result) ? result.length : (result as Record<string, unknown>).count as number;
  return affected > 0;
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
  `;
  const affected = Array.isArray(result) ? result.length : (result as Record<string, unknown>).count as number;
  return affected ?? 0;
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

  if (updatesForDb.length === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates: allCandidateFileIds.size,
      filesEligibleForUpdate,
      filesUpdated: 0,
      updates: [],
    };
  }

  // ── Step 6: Apply updates to site_survey_files table ──
  let filesUpdated = 0;
  try {
    const updatedFiles = await updateSiteSurveyFileLabels(surveyId, userId, updatesForDb);
    filesUpdated = updatedFiles.length;
    console.log(`[updatePhotoLabelsFromCandidates] Successfully updated ${filesUpdated} files in ${(Date.now() - startedAt)}ms`);
  } catch (err) {
    console.error(`[updatePhotoLabelsFromCandidates] Failed to update labels:`, err);
    throw err;
  }

  return {
    totalFiles: run.processedCount,
    filesWithCandidates: allCandidateFileIds.size,
    filesEligibleForUpdate,
    filesUpdated,
    updates,
  };
}
