import crypto from 'crypto';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionRunResult,
} from './openSourcePhotoVisionWorker';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';

export const EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME = 'external-opencv-photo-vision-worker';
export const EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION = '0.1.0';
export const REQUESTED_EXTERNAL_CV_TOOLS = ['opencv_primitives', 'yolo_detection', 'tesseract_ocr', 'ocr_equipment_labels'] as const;

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_BATCH_TIMEOUT_MS = 80_000;

export interface ExternalOpenCvPhotoVisionHealth {
  status: 'ok' | string;
  schemaVersion?: string;
  toolName?: string;
  toolVersion?: string;
  tools?: Record<string, unknown>;
  authority?: Record<string, unknown>;
}

export interface ExternalOpenCvPhotoVisionUnavailableResult {
  available: false;
  reason: string;
  health: ExternalOpenCvPhotoVisionHealth | null;
}

export interface ExternalOpenCvPhotoVisionAvailableResult {
  available: true;
  health: ExternalOpenCvPhotoVisionHealth;
  run: OpenSourcePhotoVisionRunResult;
}

export type ExternalOpenCvPhotoVisionRunOutcome =
  | ExternalOpenCvPhotoVisionUnavailableResult
  | ExternalOpenCvPhotoVisionAvailableResult;

const DEFAULT_OPEN_SOURCE_PHOTO_VISION_WORKER_URL = 'https://solarpro.onrender.com';

export function getExternalOpenCvWorkerUrl(): string | null {
  const raw = process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_URL?.trim();
  if (!raw) return DEFAULT_OPEN_SOURCE_PHOTO_VISION_WORKER_URL;
  return raw.replace(/\/+$/, '');
}

export async function runExternalOpenCvPhotoVisionPass(input: {
  survey: Pick<SiteSurvey, 'id' | 'projectId'>;
  files: SiteSurveyFile[];
  createdAt?: string;
  workerUrl?: string | null;
  timeoutMs?: number;
}): Promise<ExternalOpenCvPhotoVisionRunOutcome> {
  // Explicit null means "no worker configured" (different from undefined which means "use default").
  // This allows tests to force the unavailable path without mocking getExternalOpenCvWorkerUrl.
  const workerUrl = input.workerUrl === null ? null : (input.workerUrl ?? getExternalOpenCvWorkerUrl());
  if (!workerUrl) {
    return { available: false, reason: 'external_worker_url_not_configured', health: null };
  }

  const healthTimeoutMs = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_HEALTH_TIMEOUT_MS || DEFAULT_HEALTH_TIMEOUT_MS);
  const health = await fetchHealth(workerUrl, healthTimeoutMs);
  if (!health || health.status !== 'ok') {
    return { available: false, reason: 'external_worker_health_unavailable', health };
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const photoFiles = input.files.filter(file => file.fileType === 'photo');

  // Batching: split photos into batches to stay within Render's ~90s request timeout.
  // Each batch is sent as a separate POST; results are aggregated into a single run.
  const batchSize = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  const batchTimeoutMs = Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_BATCH_TIMEOUT_MS || DEFAULT_BATCH_TIMEOUT_MS);
  const batches: SiteSurveyFile[][] = [];
  for (let i = 0; i < photoFiles.length; i += batchSize) {
    batches.push(photoFiles.slice(i, i + batchSize));
  }

  console.log(`[externalOpenCvPhotoVisionClient] surveyId=${input.survey.id} photoFiles=${photoFiles.length} batchSize=${batchSize} batches=${batches.length} batchTimeoutMs=${batchTimeoutMs}`);

  // If there is only one batch (or zero photos), send a single request as before.
  if (batches.length <= 1) {
    const job = {
      schemaVersion: 'solarpro_external_photo_vision_job_v1',
      surveyId: input.survey.id,
      projectId: input.survey.projectId ?? null,
      createdAt,
      requestedTools: [...REQUESTED_EXTERNAL_CV_TOOLS],
      files: photoFiles.map(file => ({
        fileId: file.id,
        fileUrl: file.fileUrl,
        filename: file.filename,
        contentType: file.mimeType ?? null,
      })),
    };
    const overallTimeoutMs = input.timeoutMs ?? Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const raw = await fetchJson(`${workerUrl}/v1/photo-vision/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
      timeoutMs: overallTimeoutMs,
    });
    const run = normalizeExternalRun(raw, input.survey, photoFiles, createdAt);
    return { available: true, health, run };
  }

  // Multi-batch: send each batch sequentially and aggregate results.
  const allFileResults: OpenSourcePhotoVisionFileResult[] = [];
  const batchErrors: string[] = [];
  let lastAvailability: OpenSourcePhotoVisionRunResult['availability'] | null = null;
  const batchStart = Date.now();

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batchFiles = batches[batchIndex];
    console.log(`[externalOpenCvPhotoVisionClient] Batch ${batchIndex + 1}/${batches.length}: sending ${batchFiles.length} files to worker...`);
    const job = {
      schemaVersion: 'solarpro_external_photo_vision_job_v1',
      surveyId: input.survey.id,
      projectId: input.survey.projectId ?? null,
      createdAt,
      requestedTools: [...REQUESTED_EXTERNAL_CV_TOOLS],
      files: batchFiles.map(file => ({
        fileId: file.id,
        fileUrl: file.fileUrl,
        filename: file.filename,
        contentType: file.mimeType ?? null,
      })),
    };
    try {
      const raw = await fetchJson(`${workerUrl}/v1/photo-vision/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
        timeoutMs: batchTimeoutMs,
      });
      const batchRun = normalizeExternalRun(raw, input.survey, batchFiles, createdAt);
      allFileResults.push(...batchRun.files);
      if (batchRun.availability) {
        lastAvailability = batchRun.availability;
      }
      console.log(`[externalOpenCvPhotoVisionClient] Batch ${batchIndex + 1}/${batches.length}: completed processed=${batchRun.processedCount} candidates=${batchRun.candidateCount} elapsed=${Date.now() - batchStart}ms`);
    } catch (batchErr) {
      const errMsg = batchErr instanceof Error ? batchErr.message : String(batchErr);
      console.error(`[externalOpenCvPhotoVisionClient] Batch ${batchIndex + 1}/${batches.length} failed:`, errMsg);
      batchErrors.push(`Batch ${batchIndex + 1} (${batchFiles.length} files): ${errMsg}`);
      // Mark failed files so they appear in the aggregate result with error status.
      for (const file of batchFiles) {
        allFileResults.push(makeFailedFileResult(input.survey, file, createdAt, errMsg));
      }
    }
  }

  // Aggregate all batch results into a single run.
  const run = aggregateBatchResults(allFileResults, input.survey, createdAt, lastAvailability, batchErrors);
  return { available: true, health, run };
}

export async function fetchHealth(workerUrl: string, timeoutMs: number): Promise<ExternalOpenCvPhotoVisionHealth | null> {
  try {
    return await fetchJson(`${workerUrl}/health`, { method: 'GET', timeoutMs }) as ExternalOpenCvPhotoVisionHealth;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs: number }): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`external worker ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

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
    extractionMethod: 'none',
  };
}

function aggregateBatchResults(
  fileResults: OpenSourcePhotoVisionFileResult[],
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  createdAt: string,
  availability: OpenSourcePhotoVisionRunResult['availability'] | null,
  batchErrors: string[],
): OpenSourcePhotoVisionRunResult {
  const candidates = fileResults.flatMap(file => file.candidates);
  const runHash = sha256(stable({
    surveyId: survey.id,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    batched: true,
    fileHashes: fileResults.map(file => ({ fileId: file.fileId, hash: file.metadata.sha256, candidates: file.candidates.map(c => c.deterministicHash) })),
  }));

  // Assign the aggregate runHash to all files and candidates.
  for (const file of fileResults) {
    file.runHash = runHash;
    for (const candidate of file.candidates) {
      candidate.runHash = runHash;
    }
  }

  return {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: survey.id,
    projectId: survey.projectId ?? null,
    toolName: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME,
    toolVersion: EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION,
    createdAt,
    processedCount: fileResults.filter(file => file.analyzed).length,
    failedCount: fileResults.filter(file => !file.analyzed).length,
    candidateCount: candidates.length,
    runHash,
    files: fileResults,
    candidates,
    availability: availability ?? {
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
    authority: noAuthority(),
    limitations: [
      ...baseLimitations(),
      ...(batchErrors.length > 0
        ? [`BATCH_PARTIAL_FAILURE: ${batchErrors.length} batch(es) failed. Errors: ${batchErrors.join('; ')}`]
        : []),
    ],
  };
}

function normalizeExternalRun(
  raw: unknown,
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  files: SiteSurveyFile[],
  createdAt: string,
): OpenSourcePhotoVisionRunResult {
  const value = asRecord(raw);
  const fileResults = Array.isArray(value.files) ? value.files.map(file => normalizeFileResult(file, survey, files, createdAt)) : [];
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
    authority: noAuthority(),
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
    ? value.candidates.map((candidate, index) => normalizeCandidate(candidate, survey, fileId, fileUrl, filename, createdAt, index)).filter((candidate): candidate is OpenSourcePhotoVisionCandidate => Boolean(candidate))
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
    candidates: candidates.map(candidate => ({ ...candidate, thumbnailDataUrl: typeof value.thumbnailDataUrl === 'string' && value.thumbnailDataUrl.startsWith('data:image/') ? value.thumbnailDataUrl : undefined })),
    limitations: normalizeStringArray(value.limitations, baseLimitations()),
    runHash: typeof value.runHash === 'string' ? value.runHash : sha256(stable({ surveyId: survey.id, fileId, error: value.error ?? null })),
    extractionMethod: typeof (value as Record<string, unknown>).extractionMethod === 'string' ? (value as Record<string, unknown>).extractionMethod as OpenSourcePhotoVisionFileResult['extractionMethod'] : 'none',
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

function noAuthority() {
  return {
    reviewOnly: true as const,
    nonAuthoritative: true as const,
    canonicalMutationAllowed: false as const,
    cadMutationAllowed: false as const,
    permitGenerationAllowed: false as const,
    bomMutationAllowed: false as const,
    engineeringWorkflowMutationAllowed: false as const,
  };
}

function baseLimitations(): string[] {
  return [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'External OpenCV, YOLO/Supervision, and Tesseract OCR worker outputs are review cues only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
    'Open3D and FreeCAD remain future stages and are not marked complete by this result.',
  ];
}
