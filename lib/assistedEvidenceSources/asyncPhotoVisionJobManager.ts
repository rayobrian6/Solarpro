// ============================================================================
// Async Photo Vision Job Manager — PostgreSQL-backed + Render polling
//
// Manages job state for the async photo vision pass using Neon PostgreSQL.
// Each batch is sent to the Render worker which now returns 202 Accepted
// instantly with a renderJobId. This manager then polls the Render worker's
// GET /v1/photo-vision/jobs/{renderJobId} endpoint until the batch completes.
//
// Key changes from v0.1:
//   - POST to Render returns 202 + renderJobId (no more blocking 8-12s)
//   - pollRenderJob() polls Render GET with exponential backoff
//   - JSONB append-only writes (|| operator) — never re-reads file_results
//   - findActiveJobForSurvey() — dedup before creating new jobs
//   - countActiveJobsForUser() — per-user rate limiting
//   - cancelJob() — mark a job as failed with "Cancelled by user"
//   - markStaleJobsFailed() — auto-fail jobs running >30 minutes
// ============================================================================

import crypto from 'crypto';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionRunResult,
} from './openSourcePhotoVisionWorker';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import {
  EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
  EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
  getExternalOpenCvWorkerUrl,
} from './externalOpenCvPhotoVisionClient';
import { getDbReady } from '@/lib/db/core';

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
}

// ---------------------------------------------------------------------------
// Create a new job in the database
// ---------------------------------------------------------------------------
export async function createJob(
  surveyId: string,
  userId: string,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  photoFiles: SiteSurveyFile[],
): Promise<PhotoVisionJob> {
  const sql = await getDbReady();
  const jobId = `job_${surveyId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batchSize = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_SIZE || 2);
  const totalBatches = Math.ceil(photoFiles.length / batchSize);

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
    createdAtISO: new Date().toISOString(),
  };

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

  return {
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
  };
}

// ---------------------------------------------------------------------------
// Get job from database
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
           final_result, error
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
  };
}

// ---------------------------------------------------------------------------
// Find active job for a survey (for dedup)
// ---------------------------------------------------------------------------
export async function findActiveJobForSurvey(surveyId: string): Promise<PhotoVisionJob | null> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT job_id, survey_id, user_id, status,
           EXTRACT(EPOCH FROM created_at)::bigint * 1000 AS created_at_ms,
           EXTRACT(EPOCH FROM updated_at)::bigint * 1000 AS updated_at_ms,
           total_batches, current_batch, completed_batches,
           total_photo_files, processed_files
    FROM photo_vision_jobs
    WHERE survey_id = ${surveyId}
      AND status IN ('pending', 'running')
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
    completedAt: null,
    totalBatches: Number(row.total_batches) || 0,
    currentBatch: Number(row.current_batch) || 0,
    completedBatches: Number(row.completed_batches) || 0,
    totalPhotoFiles: Number(row.total_photo_files) || 0,
    processedFiles: Number(row.processed_files) || 0,
    result: null,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Count active jobs for a user (for rate limiting)
// ---------------------------------------------------------------------------
export async function countActiveJobsForUser(userId: string): Promise<number> {
  const sql = await getDbReady();
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM photo_vision_jobs
    WHERE user_id = ${userId}
      AND status IN ('pending', 'running')
  `;
  const row = rows[0] as Record<string, unknown>;
  return Number(row.cnt) || 0;
}

// ---------------------------------------------------------------------------
// Cancel a job — marks it as failed with "Cancelled by user"
// ---------------------------------------------------------------------------
export async function cancelJob(jobId: string): Promise<boolean> {
  const sql = await getDbReady();
  const result = await sql`
    UPDATE photo_vision_jobs
    SET status = 'failed',
        error = 'Cancelled by user',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE job_id = ${jobId}
      AND status IN ('pending', 'running')
  `;
  return (result.count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Mark stale jobs as failed — jobs running >30 minutes
// ---------------------------------------------------------------------------
export async function markStaleJobsFailed(): Promise<number> {
  const sql = await getDbReady();
  const result = await sql`
    UPDATE photo_vision_jobs
    SET status = 'failed',
        error = 'Job exceeded 30 minute timeout (stale)',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE status IN ('pending', 'running')
      AND updated_at < NOW() - INTERVAL '30 minutes'
  `;
  return Number(result.count ?? 0);
}

// ---------------------------------------------------------------------------
// Poll the Render worker for a submitted batch job
// POST → get renderJobId (202 Accepted), then poll GET until completed/failed
// ---------------------------------------------------------------------------
async function pollRenderJob(
  workerUrl: string,
  jobPayload: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  // Step 1: POST batch to Render, get 202 + renderJobId
  const postRes = await fetch(`${workerUrl}/v1/photo-vision/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobPayload),
  });

  if (!postRes.ok) {
    throw new Error(`Render worker POST returned ${postRes.status}`);
  }

  const postData = await postRes.json() as Record<string, unknown>;
  const renderJobId = postData.renderJobId as string;

  if (!renderJobId) {
    // Fallback: if the worker somehow returns the result synchronously (old behavior)
    if (postData.schemaVersion && postData.files) {
      return postData;
    }
    throw new Error('Render worker did not return a renderJobId');
  }

  // Step 2: Poll GET /v1/photo-vision/jobs/{renderJobId} with exponential backoff
  const startTime = Date.now();
  let delay = 2000; // start at 2s (YOLO+OCR takes ~8-12s minimum, no point checking sooner)

  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, delay));

    const getRes = await fetch(`${workerUrl}/v1/photo-vision/jobs/${renderJobId}`);
    if (!getRes.ok) {
      // Non-fatal: worker may be temporarily unreachable, retry
      delay = Math.min(delay * 1.5, 4_000);
      continue;
    }

    const getData = await getRes.json() as Record<string, unknown>;
    const renderStatus = getData.status as string;

    if (renderStatus === 'completed') {
      return getData.result as Record<string, unknown>;
    }

    if (renderStatus === 'failed') {
      const err = getData.error ?? 'Render worker processing failed';
      throw new Error(typeof err === 'string' ? err : String(err));
    }

    if (renderStatus === 'cancelled') {
      throw new Error('Render worker job was cancelled');
    }

    if (renderStatus === 'not_found') {
      throw new Error('Render worker job not found (may have expired)');
    }

    // Still queued or processing — increase delay (1s → 1.5s → 2.25s → cap 4s)
    delay = Math.min(delay * 1.5, 4_000);
  }

  throw new Error(`Render worker polling timed out after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Process the next batch for a job — called by the GET/poll handler.
// Now uses JSONB append-only writes (|| operator) instead of re-reading
// file_results, and polls the Render worker asynchronously.
// ---------------------------------------------------------------------------
export async function processNextBatch(jobId: string, maxBatchesPerPoll = 2): Promise<PhotoVisionJob> {
  const sql = await getDbReady();

  // Load job metadata only — do NOT read the growing file_results JSONB
  const rows = await sql`
    SELECT job_id, survey_id, user_id, status,
           job_input, current_batch, total_batches, completed_batches,
           total_photo_files, processed_files,
           batch_errors, last_availability
    FROM photo_vision_jobs WHERE job_id = ${jobId}
  `;
  if (!rows.length) throw new Error(`Job ${jobId} not found`);
  const row = rows[0] as Record<string, unknown>;

  const status = row.status as string;
  if (status === 'completed' || status === 'failed') {
    return (await getJob(jobId))!;
  }

  // Parse job input
  const jobInput = typeof row.job_input === 'string' ? JSON.parse(row.job_input) : row.job_input as Record<string, unknown>;
  const survey = jobInput.survey as Pick<SiteSurvey, 'id' | 'projectId'>;
  const allPhotoFiles = (jobInput.photoFiles as SiteSurveyFile[]) || [];
  const batchSize = Number(jobInput.batchSize) || 1;
  const createdAtISO = (jobInput.createdAtISO as string) || new Date().toISOString();

  const currentBatch = Number(row.current_batch) || 0;
  const totalBatches = Number(row.total_batches) || 0;
  const totalPhotoFiles = Number(row.total_photo_files) || 0;

  // Parse batch_errors and last_availability (small, OK to read)
  const batchErrorsRaw = typeof row.batch_errors === 'string' ? JSON.parse(row.batch_errors) : row.batch_errors;
  const batchErrors: string[] = Array.isArray(batchErrorsRaw) ? batchErrorsRaw : [];
  const lastAvailability = row.last_availability
    ? (typeof row.last_availability === 'string' ? JSON.parse(row.last_availability) : row.last_availability)
    : null;

  const workerUrl = getExternalOpenCvWorkerUrl();
  if (!workerUrl) {
    await failJobInDb(jobId, 'External worker URL not configured');
    return (await getJob(jobId))!;
  }

  // Mark as running
  await sql`
    UPDATE photo_vision_jobs
    SET status = 'running', updated_at = NOW()
    WHERE job_id = ${jobId}
  `;

  // Process up to maxBatchesPerPoll batches
  const renderTimeoutMs = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_TIMEOUT_MS || 60_000);
  let batchIdx = currentBatch;
  let batchesProcessedThisPoll = 0;
  let newProcessedFiles = Number(row.processed_files) || 0;

  while (batchIdx < totalBatches && batchesProcessedThisPoll < maxBatchesPerPoll) {
    const startIdx = batchIdx * batchSize;
    const endIdx = Math.min(startIdx + batchSize, allPhotoFiles.length);
    const batchFiles = allPhotoFiles.slice(startIdx, endIdx);

    if (batchFiles.length === 0) break;

    console.log(`[asyncJobManager] Job ${jobId}: processing batch ${batchIdx + 1}/${totalBatches} (${batchFiles.length} files) [poll batch ${batchesProcessedThisPoll + 1}/${maxBatchesPerPoll}]`);

    try {
      const jobPayload = {
        schemaVersion: 'solarpro_external_photo_vision_job_v1',
        surveyId: survey.id,
        projectId: survey.projectId ?? null,
        createdAt: createdAtISO,
        requestedTools: ['opencv_primitives', 'yolo_detection', 'tesseract_ocr', 'ocr_equipment_labels'],
        files: batchFiles.map(file => ({
          fileId: file.id,
          fileUrl: file.fileUrl,
          filename: file.filename,
          contentType: file.mimeType ?? null,
        })),
      };

      // Use async Render polling instead of synchronous fetch
      const raw = await pollRenderJob(workerUrl, jobPayload, renderTimeoutMs);

      // Normalize the batch result
      const batchRun = normalizeExternalRun(raw, survey, batchFiles, createdAtISO);
      const batchFileResults = batchRun.files;

      // JSONB append-only write — don't re-read file_results, just append
      await sql`
        UPDATE photo_vision_jobs
        SET file_results = COALESCE(file_results, '[]'::jsonb) || ${JSON.stringify(batchFileResults)}::jsonb,
            last_availability = ${batchRun.availability ? JSON.stringify({ ...(lastAvailability || {}), ...batchRun.availability }) : null}::jsonb,
            updated_at = NOW()
        WHERE job_id = ${jobId}
      `;

      newProcessedFiles += batchFileResults.filter(f => f.analyzed).length;

      console.log(`[asyncJobManager] Job ${jobId}: batch ${batchIdx + 1}/${totalBatches} completed. processed=${batchRun.processedCount} candidates=${batchRun.candidateCount}`);
    } catch (batchErr) {
      const isTimeout = batchErr instanceof Error && batchErr.message.includes('timed out');
      const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      console.error(`[asyncJobManager] Job ${jobId}: batch ${batchIdx + 1}/${totalBatches} failed${isTimeout ? ' (TIMEOUT)' : ''}:`, errMsg);

      batchErrors.push(`Batch ${batchIdx + 1} (${batchFiles.length} files): ${errMsg}`);

      // Append failed file results using JSONB || operator
      const failedResults = batchFiles.map(file => makeFailedFileResult(survey, file, createdAtISO, errMsg));
      await sql`
        UPDATE photo_vision_jobs
        SET file_results = COALESCE(file_results, '[]'::jsonb) || ${JSON.stringify(failedResults)}::jsonb,
            batch_errors = COALESCE(batch_errors, '[]'::jsonb) || ${JSON.stringify([errMsg])}::jsonb,
            updated_at = NOW()
        WHERE job_id = ${jobId}
      `;
    }

    batchIdx++;
    batchesProcessedThisPoll++;
  }

  // Update job progress
  const newCurrentBatch = batchIdx;
  const newCompletedBatches = batchIdx;
  const isComplete = newCurrentBatch >= totalBatches;

  if (isComplete) {
    await finalizeJobInDb(jobId, batchErrors, lastAvailability, survey, createdAtISO);
  } else {
    await sql`
      UPDATE photo_vision_jobs
      SET current_batch = ${newCurrentBatch},
          completed_batches = ${newCompletedBatches},
          processed_files = ${newProcessedFiles},
          batch_errors = ${JSON.stringify(batchErrors)}::jsonb,
          updated_at = NOW()
      WHERE job_id = ${jobId}
    `;
  }

  // Return lightweight job status — avoid re-reading file_results JSONB
  const statusRow = await sql`
    SELECT status, error,
           EXTRACT(EPOCH FROM created_at)::bigint * 1000 AS created_at_ms,
           EXTRACT(EPOCH FROM completed_at)::bigint * 1000 AS completed_at_ms
    FROM photo_vision_jobs
    WHERE job_id = ${jobId}
  `;
  const sRow = statusRow[0] as Record<string, unknown>;
  const finalStatus = (sRow?.status ?? 'running') as JobStatus;
  const finalError = (sRow?.error ?? null) as string | null;

  return {
    jobId,
    surveyId: row.survey_id as string,
    userId: row.user_id as string,
    status: finalStatus,
    createdAt: Number(sRow?.created_at_ms) || Date.now(),
    updatedAt: Date.now(),
    completedAt: sRow?.completed_at_ms ? Number(sRow.completed_at_ms) : null,
    totalBatches,
    currentBatch: newCurrentBatch,
    completedBatches: newCompletedBatches,
    totalPhotoFiles,
    processedFiles: newProcessedFiles,
    result: null,
    error: finalError,
  };
}

// ---------------------------------------------------------------------------
// Fail a job in the database
// ---------------------------------------------------------------------------
async function failJobInDb(jobId: string, error: string): Promise<void> {
  const sql = await getDbReady();
  await sql`
    UPDATE photo_vision_jobs
    SET status = 'failed', error = ${error}, completed_at = NOW(), updated_at = NOW()
    WHERE job_id = ${jobId}
  `;
}

// ---------------------------------------------------------------------------
// Finalize a completed job — read file_results only at completion time,
// build the aggregate run result, and write final_result
// ---------------------------------------------------------------------------
async function finalizeJobInDb(
  jobId: string,
  batchErrors: string[],
  lastAvailability: Record<string, unknown> | null,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  createdAtISO: string,
): Promise<void> {
  const sql = await getDbReady();

  // Read file_results only now, at completion time
  const rows = await sql`
    SELECT file_results, processed_files FROM photo_vision_jobs WHERE job_id = ${jobId}
  `;
  if (!rows.length) return;

  const row = rows[0] as Record<string, unknown>;
  const fileResultsRaw = typeof row.file_results === 'string' ? JSON.parse(row.file_results) : row.file_results;
  const allFileResults: OpenSourcePhotoVisionFileResult[] = Array.isArray(fileResultsRaw) ? fileResultsRaw : [];
  const candidates = allFileResults.flatMap(file => file.candidates);

  const runHash = sha256(stable({
    surveyId: survey.id,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    batched: true,
    fileHashes: allFileResults.map(file => ({
      fileId: file.fileId,
      hash: file.metadata.sha256,
      candidates: file.candidates.map(c => c.deterministicHash),
    })),
  }));

  for (const file of allFileResults) {
    file.runHash = runHash;
    for (const candidate of file.candidates) {
      candidate.runHash = runHash;
    }
  }

  const baseLimits = [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'External OpenCV, YOLO/Supervision, and Tesseract OCR worker outputs are review cues only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
    'Open3D and FreeCAD remain future stages and are not marked complete by this result.',
  ];

  const result: OpenSourcePhotoVisionRunResult = {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: survey.id,
    projectId: survey.projectId ?? null,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    createdAt: createdAtISO,
    processedCount: allFileResults.filter(file => file.analyzed).length,
    failedCount: allFileResults.filter(file => !file.analyzed).length,
    candidateCount: candidates.length,
    runHash,
    files: allFileResults,
    candidates,
    availability: (lastAvailability as OpenSourcePhotoVisionRunResult['availability']) ?? {
      sharp: 'available_next_app_thumbnail_fallback',
      opencv: 'available_external_worker',
      yoloSupervision: 'unavailable_batch_fallback',
      yolo: 'unavailable_batch_fallback',
      supervision: 'unavailable_batch_fallback',
      tesseract: 'unavailable_batch_fallback',
      pythonWorker: 'available_external_docker_worker',
      open3d: 'unavailable_future_stage_not_implemented',
      freecad: 'unavailable_future_stage_not_implemented',
    },
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      canonicalMutationAllowed: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
    },
    limitations: [
      ...baseLimits,
      ...(batchErrors.length > 0
        ? [`BATCH_PARTIAL_FAILURE: ${batchErrors.length} batch(es) failed. Errors: ${batchErrors.join('; ')}`]
        : []),
    ],
  };

  const processedFiles = result.processedCount;

  await sql`
    UPDATE photo_vision_jobs
    SET status = 'completed',
        current_batch = total_batches,
        completed_batches = total_batches,
        processed_files = ${processedFiles},
        final_result = ${JSON.stringify(result)}::jsonb,
        batch_errors = ${JSON.stringify(batchErrors)}::jsonb,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE job_id = ${jobId}
  `;

  console.log(`[asyncJobManager] Job ${jobId} finalized: processed=${result.processedCount} failed=${result.failedCount} candidates=${result.candidateCount}`);
}

// ---------------------------------------------------------------------------
// Normalize helpers
// ---------------------------------------------------------------------------

function makeFailedFileResult(
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  file: SiteSurveyFile,
  createdAt: string,
  error: string,
): OpenSourcePhotoVisionFileResult {
  const runHash = sha256(stable({ surveyId: survey.id, fileId: file.id, error }));
  return {
    surveyId: survey.id,
    fileId: file.id,
    fileUrl: file.fileUrl,
    filename: file.filename,
    analyzed: false,
    error: error.slice(0, 300),
    metadata: { widthPx: null, heightPx: null, format: null, byteSize: 0, sha256: null, dominantBrightness: null, sharpnessScore: null, qualityScore: null },
    thumbnailDataUrl: null,
    edgeSummary: null,
    candidates: [],
    limitations: [`Batch request failed; no candidates emitted for this file.`, ...baseLimitations()],
    runHash,
  };
}

function baseLimitations(): string[] {
  return [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'External OpenCV, YOLO/Supervision, and Tesseract OCR worker outputs are review cues only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
    'Open3D and FreeCAD remain future stages and are not marked complete by this result.',
  ];
}

function normalizeExternalRun(
  raw: unknown,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  files: SiteSurveyFile[],
  createdAt: string,
): OpenSourcePhotoVisionRunResult {
  const value = asRecord(raw);
  const fileResults = Array.isArray(value.files) ? value.files.map((file: unknown) => normalizeFileResult(file, survey, files, createdAt)) : [];
  const candidates = fileResults.flatMap(file => file.candidates);
  const toolName = typeof value.toolName === 'string' && value.toolName ? value.toolName : EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME;
  const toolVersion = typeof value.toolVersion === 'string' && value.toolVersion ? value.toolVersion : EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION;
  const runHash = typeof value.runHash === 'string' && value.runHash ? value.runHash : sha256(stable({ surveyId: survey.id, toolName, toolVersion, files: fileResults.map(file => ({ fileId: file.fileId, hash: file.metadata.sha256, candidates: file.candidates.map(c => c.deterministicHash) })) }));

  return {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: survey.id,
    projectId: survey.projectId ?? null,
    toolName,
    toolVersion,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : createdAt,
    processedCount: fileResults.filter(file => file.analyzed).length,
    failedCount: fileResults.filter(file => !file.analyzed).length,
    candidateCount: candidates.length,
    runHash,
    files: fileResults.map(file => ({ ...file, runHash })),
    candidates: candidates.map(candidate => ({ ...candidate, runHash })),
    availability: normalizeAvailability(value.availability),
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      canonicalMutationAllowed: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
    },
    limitations: baseLimitations(),
  };
}

function normalizeAvailability(value: unknown): OpenSourcePhotoVisionRunResult['availability'] {
  const raw = asRecord(value);
  const yolo = typeof raw.yolo === 'string' ? raw.yolo : typeof raw.yoloSupervision === 'string' ? raw.yoloSupervision : 'unavailable_yolo_diagnostics_missing';
  const supervision = typeof raw.supervision === 'string' ? raw.supervision : yolo.includes('available') && !yolo.includes('unavailable') ? 'available_with_yolo_worker' : 'unavailable_supervision_diagnostics_missing';
  return {
    sharp: 'available_next_app_thumbnail_fallback',
    opencv: typeof raw.opencv === 'string' ? raw.opencv : 'available_external_worker',
    yoloSupervision: typeof raw.yoloSupervision === 'string' ? raw.yoloSupervision : yolo,
    yolo,
    supervision,
    tesseract: typeof raw.tesseract === 'string' ? raw.tesseract : 'unavailable_tesseract_diagnostics_missing',
    pythonWorker: typeof raw.pythonWorker === 'string' ? raw.pythonWorker : 'available_external_docker_worker',
    open3d: typeof raw.open3d === 'string' ? raw.open3d : 'unavailable_future_stage_not_implemented',
    freecad: typeof raw.freecad === 'string' ? raw.freecad : 'unavailable_future_stage_not_implemented',
  };
}

function normalizeFileResult(raw: unknown, survey: Pick<SiteSurvey, 'id' | 'projectId'>, files: SiteSurveyFile[], createdAt: string): OpenSourcePhotoVisionFileResult {
  const value = asRecord(raw);
  const fileId = typeof value.fileId === 'string' ? value.fileId : '';
  const sourceFile = files.find(file => file.id === fileId);
  const fileUrl = typeof value.fileUrl === 'string' ? value.fileUrl : sourceFile?.fileUrl ?? '';
  const filename = typeof value.filename === 'string' ? value.filename : sourceFile?.filename ?? null;
  const metadata = asRecord(value.metadata);
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map((candidate: unknown, index: number) => normalizeCandidate(candidate, survey, fileId, fileUrl, filename, createdAt, index)).filter((candidate: unknown): candidate is OpenSourcePhotoVisionCandidate => Boolean(candidate))
    : [];
  return {
    surveyId: survey.id,
    fileId,
    fileUrl,
    filename,
    analyzed: value.analyzed === true,
    error: typeof value.error === 'string' ? value.error : null,
    metadata: {
      widthPx: nullableNumber(metadata.widthPx),
      heightPx: nullableNumber(metadata.heightPx),
      format: typeof metadata.format === 'string' ? metadata.format : null,
      byteSize: numberOrZero(metadata.byteSize),
      sha256: typeof metadata.sha256 === 'string' ? metadata.sha256 : null,
      dominantBrightness: nullableNumber(metadata.dominantBrightness),
      sharpnessScore: nullableNumber(metadata.sharpnessScore),
      qualityScore: nullableNumber(metadata.qualityScore),
    },
    thumbnailDataUrl: typeof value.thumbnailDataUrl === 'string' && value.thumbnailDataUrl.startsWith('data:image/') ? value.thumbnailDataUrl : null,
    edgeSummary: normalizeEdgeSummary(value.edgeSummary),
    candidates: candidates.map((candidate: OpenSourcePhotoVisionCandidate) => ({ ...candidate, thumbnailDataUrl: typeof value.thumbnailDataUrl === 'string' && value.thumbnailDataUrl.startsWith('data:image/') ? value.thumbnailDataUrl : undefined })),
    limitations: normalizeStringArray(value.limitations, baseLimitations()),
    runHash: typeof value.runHash === 'string' ? value.runHash : sha256(stable({ surveyId: survey.id, fileId, error: value.error ?? null })),
  };
}

function normalizeCandidate(raw: unknown, survey: Pick<SiteSurvey, 'id' | 'projectId'>, fileId: string, fileUrl: string, filename: string | null, createdAt: string, index: number): OpenSourcePhotoVisionCandidate | null {
  const value = asRecord(raw);
  const candidateType = typeof value.candidateType === 'string' ? value.candidateType : 'edge_map_summary';
  const candidateCategory = normalizeCandidateCategory(value.candidateCategory);
  const payload = asRecord(value.payload);
  const line = normalizeLine(value.line ?? payload.line);
  const region = normalizeRegion(value.region ?? value.bbox ?? payload.region ?? payload.bbox);
  const toolName = typeof value.toolName === 'string' && value.toolName ? value.toolName : EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME;
  const toolVersion = typeof value.toolVersion === 'string' && value.toolVersion ? value.toolVersion : EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION;
  const base = {
    surveyId: survey.id,
    fileId,
    fileUrl,
    filename,
    candidateType,
    candidateCategory,
    confidence: clamp(Math.round(numberOrZero(value.confidence)), 0, 100),
    summary: typeof value.summary === 'string' ? value.summary : candidateType === 'ocr_text' ? 'External Tesseract OCR text review candidate.' : candidateType === 'object_detection' ? 'External YOLO/Supervision object detection review candidate.' : 'External OpenCV review candidate.',
    payload: {
      ...payload,
      externalWorker: true,
      stage: candidateType === 'ocr_text' ? 'stage_3_tesseract_ocr_text_detection' : candidateType === 'object_detection' ? 'stage_2_yolo_supervision_semantic_detection' : 'stage_1_opencv_edges_lines_contours',
      sourceToolName: toolName,
      sourceToolVersion: toolVersion,
      sourceModel: typeof value.sourceModel === 'string' ? value.sourceModel : typeof payload.sourceModel === 'string' ? payload.sourceModel : null,
      modelVersion: typeof value.modelVersion === 'string' ? value.modelVersion : typeof payload.modelVersion === 'string' ? payload.modelVersion : null,
      semanticCategory: typeof value.category === 'string' ? value.category : typeof payload.semanticCategory === 'string' ? payload.semanticCategory : null,
      ocrText: candidateType === 'ocr_text' ? stringOrNull(value.text) ?? stringOrNull(payload.text) ?? stringOrNull(payload.cleanedText) : null,
      text: candidateType === 'ocr_text' ? stringOrNull(value.text) ?? stringOrNull(payload.text) ?? stringOrNull(payload.cleanedText) : stringOrNull(payload.text),
      cleanedText: candidateType === 'ocr_text' ? stringOrNull(payload.cleanedText) ?? stringOrNull(value.text) ?? stringOrNull(payload.text) : stringOrNull(payload.cleanedText),
      hints: Array.isArray(payload.hints) ? payload.hints : [],
      sourceCrop: asRecord(payload.sourceCrop),
      reviewRequired: true,
      region: region ?? null,
      line: line ?? null,
    },
    ...(region ? { region } : {}),
    ...(line ? { line } : {}),
    limitations: normalizeStringArray(value.limitations, baseLimitations()),
    reviewStatus: 'review_required' as const,
    nonAuthoritative: true as const,
    toolName,
    toolVersion,
    runHash: typeof value.runHash === 'string' ? value.runHash : 'pending-run-hash',
    deterministicHash: typeof value.deterministicHash === 'string' ? value.deterministicHash : '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : createdAt,
  };
  const deterministicHash = base.deterministicHash || sha256(stable({ ...base, createdAt: 'stable-created-at', deterministicHash: 'stable' }));
  return {
    ...base,
    candidateId: typeof value.candidateId === 'string' && value.candidateId ? value.candidateId : `ospv_${deterministicHash.slice(0, 24)}_${index + 1}`,
    deterministicHash,
  } satisfies OpenSourcePhotoVisionCandidate;
}

function normalizeCandidateCategory(value: unknown): OpenSourcePhotoVisionCandidate['candidateCategory'] {
  return value === 'quality' || value === 'roof_context' || value === 'electrical_context' || value === 'structure_context' || value === 'field_context' ? value : 'field_context';
}

function normalizeLine(value: unknown): OpenSourcePhotoVisionCandidate['line'] | undefined {
  const line = asRecord(value);
  if (!line) return undefined;
  const x1 = nullableNumber(line.x1), y1 = nullableNumber(line.y1), x2 = nullableNumber(line.x2), y2 = nullableNumber(line.y2);
  if ([x1, y1, x2, y2].some(v => v === null)) return undefined;
  const orientation = line.orientation === 'horizontal' || line.orientation === 'vertical' || line.orientation === 'diagonal' ? line.orientation : 'diagonal';
  return { x1: x1!, y1: y1!, x2: x2!, y2: y2!, orientation, strength: clamp(nullableNumber(line.strength) ?? 0.1, 0, 1), coordinateSystem: 'normalized_image_0_1000' };
}

function normalizeRegion(value: unknown): OpenSourcePhotoVisionCandidate['region'] | undefined {
  const region = asRecord(value);
  if (!region) return undefined;
  const x = nullableNumber(region.x), y = nullableNumber(region.y), width = nullableNumber(region.width), height = nullableNumber(region.height);
  if ([x, y, width, height].some(v => v === null)) return undefined;
  return { x: x!, y: y!, width: width!, height: height!, coordinateSystem: 'normalized_image_0_1000' };
}

function normalizeEdgeSummary(value: unknown): OpenSourcePhotoVisionFileResult['edgeSummary'] {
  const edge = asRecord(value);
  if (!edge) return null;
  return {
    edgePixelRatio: nullableNumber(edge.edgePixelRatio) ?? 0,
    horizontalStrength: nullableNumber(edge.horizontalStrength) ?? 0,
    verticalStrength: nullableNumber(edge.verticalStrength) ?? 0,
    diagonalStrength: nullableNumber(edge.diagonalStrength) ?? 0,
    denseRegionCount: nullableNumber(edge.denseRegionCount) ?? 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown): number {
  return nullableNumber(value) ?? 0;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  return JSON.stringify(value, Object.keys(flattenKeys(value)).sort());
}

function flattenKeys(value: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out[key] = true;
      flattenKeys(child, out);
    }
  }
  return out;
}
