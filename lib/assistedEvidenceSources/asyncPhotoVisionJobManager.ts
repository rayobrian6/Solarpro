// ============================================================================
// Async Photo Vision Job Manager — PostgreSQL-backed (v0.3)
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
import {
  getEvidenceCategoryForCandidate,
  extractYoloClassNameFromPayload,
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
// Update photo labels from YOLO/OCR candidates (Option 1 implementation)
//
// This function is called after a photo vision run completes to auto-assign
// photo labels from high-confidence YOLO object detection and OCR candidates.
//
// Algorithm:
// 1. Group object_detection candidates by file_id
// 2. For each file, pick the highest-confidence object_detection candidate
// 3. Map the YOLO class name to an evidence category using yoloToEvidenceMapper
// 4. Update site_survey_files.label for files where label is currently NULL
// 5. Only update files with confidence >= threshold (default: 0.70)
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

  // Confidence threshold from env var (default: 0.70)
  const minConfidenceThreshold = Number(process.env.PHOTO_VISION_AUTO_LABEL_MIN_CONFIDENCE || 0.70);

  console.log(`[updatePhotoLabelsFromCandidates] surveyId=${surveyId} runHash=${run.runHash} minConfidence=${minConfidenceThreshold}`);

  // Step 1: Group object_detection candidates by file_id, pick highest-confidence per file
  const candidatesByFile = new Map<string, OpenSourcePhotoVisionCandidate>();
  for (const candidate of run.candidates) {
    // Only consider object_detection candidates (not ocr_text, edge_map_summary, etc.)
    if (candidate.candidateType !== 'object_detection') continue;

    // Normalize confidence from 0-100 scale (Render worker) to 0-1 scale (mapper expectation)
    // The Render worker (main.py) stores confidence as integer 0-100, but the mapper expects 0-1
    const normalizedCandidate = {
      ...candidate,
      confidence: candidate.confidence / 100,
    };

    const fileId = candidate.fileId;
    const existing = candidatesByFile.get(fileId);

    // Keep the highest-confidence candidate for each file
    if (!existing || normalizedCandidate.confidence > existing.confidence) {
      candidatesByFile.set(fileId, normalizedCandidate);
    }
  }

  const filesWithCandidates = candidatesByFile.size;
  console.log(`[updatePhotoLabelsFromCandidates] Found ${filesWithCandidates} files with object_detection candidates (out of ${run.processedCount} processed)`);

  if (filesWithCandidates === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates: 0,
      filesEligibleForUpdate: 0,
      filesUpdated: 0,
      updates: [],
    };
  }

  // Step 2: Check which files currently have NULL labels (only update those)
  // Build a safe IN clause for Neon's tagged template literals
  const fileIdsWithCandidates = Array.from(candidatesByFile.keys());

  // Neon tagged templates don't support `IN ${sql(array)}` directly.
  // Use a loop approach to check each file, or batch query with OR conditions.
  // For safety and simplicity, query files individually (typically < 50 files).
  const filesWithoutLabelsMap = new Map<string, { filename: string | null; label: string | null }>();
  for (const fileId of fileIdsWithCandidates) {
    const rows = await sql`
      SELECT id, filename, label
      FROM site_survey_files
      WHERE id = ${fileId}
        AND survey_id = ${surveyId}
        AND (label IS NULL OR label = '')
    `;
    for (const row of rows as Record<string, unknown>[]) {
      filesWithoutLabelsMap.set(row.id as string, {
        filename: row.filename as string | null,
        label: row.label as string | null,
      });
    }
  }

  const filesEligibleForUpdate = filesWithoutLabelsMap.size;
  console.log(`[updatePhotoLabelsFromCandidates] ${filesEligibleForUpdate} files are eligible for label update (have no existing label)`);

  if (filesEligibleForUpdate === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates,
      filesEligibleForUpdate: 0,
      filesUpdated: 0,
      updates: [],
    };
  }

  // Step 3: Map candidates to evidence categories and prepare updates
  const updates: UpdatePhotoLabelsFromCandidatesResult['updates'] = [];
  const updatesForDb: Array<{ fileId: string; label: string }> = [];

  for (const [fileId, candidate] of candidatesByFile.entries()) {
    // Skip if file already has a label
    if (!filesWithoutLabelsMap.has(fileId)) continue;

    // Map candidate to evidence category
    const category = getEvidenceCategoryForCandidate(candidate, minConfidenceThreshold);

    if (category) {
      const yoloClassName = extractYoloClassNameFromPayload(candidate.payload);
      const filename = filesWithoutLabelsMap.get(fileId)!.filename;

      updates.push({
        fileId,
        filename,
        oldLabel: null,
        newLabel: category,
        candidateType: candidate.candidateType,
        candidateClass: yoloClassName,
        confidence: candidate.confidence, // Already normalized to 0-1 scale in Step 1
      });

      updatesForDb.push({
        fileId,
        label: category,
      });
    }
  }

  console.log(`[updatePhotoLabelsFromCandidates] Prepared ${updatesForDb.length} label updates`);

  if (updatesForDb.length === 0) {
    return {
      totalFiles: run.processedCount,
      filesWithCandidates,
      filesEligibleForUpdate,
      filesUpdated: 0,
      updates: [],
    };
  }

  // Step 4: Apply updates to site_survey_files table
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
    filesWithCandidates,
    filesEligibleForUpdate,
    filesUpdated,
    updates,
  };
}