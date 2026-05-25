// ============================================================================
// Async Photo Vision Job Manager
//
// Manages in-memory job state for the async photo vision pass.
//
// Architecture:
//   POST creates a job record and returns jobId immediately.
//   Each GET/poll request processes ONE batch of photos, then returns status.
//   This "lazy processing" pattern ensures work happens within the
//   serverless function's lifecycle — no fire-and-forget Promises
//   that could be killed when the function responds.
//
//   The client polls every 3 seconds. Each poll processes 5 photos (~10s),
//   so the GET handler always returns within ~15s — well within any timeout.
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
  fetchHealth,
} from './externalOpenCvPhotoVisionClient';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PhotoVisionJob {
  jobId: string;
  surveyId: string;
  userId: string;
  status: JobStatus;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  completedAt: number | null;
  // Survey/files data (needed for batch processing)
  survey: Pick<SiteSurvey, 'id' | 'projectId'>;
  photoFiles: SiteSurveyFile[];
  batchSize: number;
  // Progress tracking
  totalBatches: number;
  currentBatch: number; // 0-indexed, next batch to process
  completedBatches: number;
  totalPhotoFiles: number;
  processedFiles: number;
  // Accumulated results
  allFileResults: OpenSourcePhotoVisionFileResult[];
  batchErrors: string[];
  lastAvailability: OpenSourcePhotoVisionRunResult['availability'] | null;
  createdAtISO: string;
  // Final result (populated on completion)
  result: OpenSourcePhotoVisionRunResult | null;
  error: string | null;
  // Health check result (cached from first poll)
  healthChecked: boolean;
  healthOk: boolean;
}

// In-memory job store.
// Vercel Fluid keeps instances warm, so this survives across poll requests
// for the typical processing window (a few minutes).
const jobs = new Map<string, PhotoVisionJob>();

// Auto-cleanup: remove jobs older than 30 minutes
const JOB_TTL_MS = 30 * 60 * 1000;

function cleanupOldJobs(): void {
  const now = Date.now();
  for (const [jobId, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) {
      jobs.delete(jobId);
    }
  }
}

export function createJob(
  surveyId: string,
  userId: string,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  photoFiles: SiteSurveyFile[],
): PhotoVisionJob {
  cleanupOldJobs();
  const jobId = `job_${surveyId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const batchSize = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_SIZE || 5);
  const totalBatches = Math.ceil(photoFiles.length / batchSize);
  const job: PhotoVisionJob = {
    jobId,
    surveyId,
    userId,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    survey,
    photoFiles,
    batchSize,
    totalBatches,
    currentBatch: 0,
    completedBatches: 0,
    totalPhotoFiles: photoFiles.length,
    processedFiles: 0,
    allFileResults: [],
    batchErrors: [],
    lastAvailability: null,
    createdAtISO: new Date().toISOString(),
    result: null,
    error: null,
    healthChecked: false,
    healthOk: false,
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): PhotoVisionJob | undefined {
  return jobs.get(jobId);
}

/**
 * Process the next batch for a job. Called by the GET/poll handler.
 * Processes ONE batch of photos (typically 5) by sending them to the
 * external Render worker, then returns the updated job.
 *
 * This ensures each poll request does a bounded amount of work
 * (~10-15s per batch) and always returns within serverless function timeout.
 *
 * Returns the updated job state.
 */
export async function processNextBatch(jobId: string): Promise<PhotoVisionJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  // If job is already complete, just return it
  if (job.status === 'completed' || job.status === 'failed') {
    return job;
  }

  // First poll: check worker health
  if (!job.healthChecked) {
    const workerUrl = getExternalOpenCvWorkerUrl();
    if (!workerUrl) {
      job.status = 'failed';
      job.error = 'External worker URL not configured';
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      return job;
    }
    const health = await fetchHealth(workerUrl, 15_000);
    if (!health || health.status !== 'ok') {
      job.status = 'failed';
      job.error = `External CV worker health check failed: ${health?.status ?? 'no response'}`;
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      return job;
    }
    job.healthChecked = true;
    job.healthOk = true;
  }

  // Mark as running
  job.status = 'running';
  job.updatedAt = Date.now();

  // Get the next batch of files to process
  const batchIndex = job.currentBatch;
  const startIdx = batchIndex * job.batchSize;
  const endIdx = Math.min(startIdx + job.batchSize, job.photoFiles.length);
  const batchFiles = job.photoFiles.slice(startIdx, endIdx);

  if (batchFiles.length === 0) {
    // No more batches — finalize the job
    finalizeJob(job);
    return job;
  }

  console.log(`[asyncJobManager] Job ${jobId}: processing batch ${batchIndex + 1}/${job.totalBatches} (${batchFiles.length} files)`);

  const workerUrl = getExternalOpenCvWorkerUrl()!;
  const batchTimeoutMs = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_TIMEOUT_MS || 80_000);

  try {
    const jobPayload = {
      schemaVersion: 'solarpro_external_photo_vision_job_v1',
      surveyId: job.survey.id,
      projectId: job.survey.projectId ?? null,
      createdAt: job.createdAtISO,
      requestedTools: ['opencv_primitives', 'yolo_detection', 'tesseract_ocr', 'ocr_equipment_labels'],
      files: batchFiles.map(file => ({
        fileId: file.id,
        fileUrl: file.fileUrl,
        filename: file.filename,
        contentType: file.mimeType ?? null,
      })),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), batchTimeoutMs);
    let raw: unknown;
    try {
      const res = await fetch(`${workerUrl}/v1/photo-vision/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobPayload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`external worker ${res.status}`);
      raw = await res.json();
    } finally {
      clearTimeout(timer);
    }

    // Normalize the batch result
    const batchRun = normalizeExternalRun(raw, job.survey, batchFiles, job.createdAtISO);
    job.allFileResults.push(...batchRun.files);
    if (batchRun.availability) {
      job.lastAvailability = batchRun.availability;
    }
    job.processedFiles = job.allFileResults.filter(f => f.analyzed).length;

    console.log(`[asyncJobManager] Job ${jobId}: batch ${batchIndex + 1}/${job.totalBatches} completed. processed=${batchRun.processedCount} candidates=${batchRun.candidateCount}`);
  } catch (batchErr) {
    const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
    console.error(`[asyncJobManager] Job ${jobId}: batch ${batchIndex + 1}/${job.totalBatches} failed:`, errMsg);
    job.batchErrors.push(`Batch ${batchIndex + 1} (${batchFiles.length} files): ${errMsg}`);
    // Mark failed files
    for (const file of batchFiles) {
      job.allFileResults.push(makeFailedFileResult(job.survey, file, job.createdAtISO, errMsg));
    }
  }

  // Advance to next batch
  job.currentBatch = batchIndex + 1;
  job.completedBatches = job.currentBatch;
  job.updatedAt = Date.now();

  // Check if all batches are done
  if (job.currentBatch >= job.totalBatches) {
    finalizeJob(job);
  }

  return job;
}

function finalizeJob(job: PhotoVisionJob): void {
  const candidates = job.allFileResults.flatMap(file => file.candidates);
  const runHash = sha256(stable({
    surveyId: job.survey.id,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    batched: true,
    fileHashes: job.allFileResults.map(file => ({
      fileId: file.fileId,
      hash: file.metadata.sha256,
      candidates: file.candidates.map(c => c.deterministicHash),
    })),
  }));

  // Assign the aggregate runHash to all files and candidates
  for (const file of job.allFileResults) {
    file.runHash = runHash;
    for (const candidate of file.candidates) {
      candidate.runHash = runHash;
    }
  }

  const baseLimitations = [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'External OpenCV, YOLO/Supervision, and Tesseract OCR worker outputs are review cues only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
    'Open3D and FreeCAD remain future stages and are not marked complete by this result.',
  ];

  job.result = {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: job.survey.id,
    projectId: job.survey.projectId ?? null,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    createdAt: job.createdAtISO,
    processedCount: job.allFileResults.filter(file => file.analyzed).length,
    failedCount: job.allFileResults.filter(file => !file.analyzed).length,
    candidateCount: candidates.length,
    runHash,
    files: job.allFileResults,
    candidates,
    availability: job.lastAvailability ?? {
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
      ...baseLimitations,
      ...(job.batchErrors.length > 0
        ? [`BATCH_PARTIAL_FAILURE: ${job.batchErrors.length} batch(es) failed. Errors: ${job.batchErrors.join('; ')}`]
        : []),
    ],
  };

  job.status = 'completed';
  job.completedAt = Date.now();
  job.updatedAt = Date.now();
  job.processedFiles = job.result.processedCount;

  console.log(`[asyncJobManager] Job ${job.jobId} finalized: processed=${job.result.processedCount} failed=${job.result.failedCount} candidates=${job.result.candidateCount}`);
}

// ---------------------------------------------------------------------------
// Helper functions (duplicated from externalOpenCvPhotoVisionClient to avoid
// circular dependency issues and keep this module self-contained)
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
