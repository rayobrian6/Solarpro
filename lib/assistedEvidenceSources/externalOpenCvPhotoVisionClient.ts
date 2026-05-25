import crypto from 'crypto';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionRunResult,
} from './openSourcePhotoVisionWorker';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';

export const EXTERNAL_OPENCV_PHOTO_VISION_TOOL_NAME = 'external-opencv-photo-vision-worker';
export const EXTERNAL_OPENCV_PHOTO_VISION_TOOL_VERSION = '0.1.0';

const DEFAULT_TIMEOUT_MS = 30_000;

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

export function getExternalOpenCvWorkerUrl(): string | null {
  const raw = process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export async function runExternalOpenCvPhotoVisionPass(input: {
  survey: Pick<SiteSurvey, 'id' | 'projectId'>;
  files: SiteSurveyFile[];
  createdAt?: string;
  workerUrl?: string | null;
  timeoutMs?: number;
}): Promise<ExternalOpenCvPhotoVisionRunOutcome> {
  const workerUrl = input.workerUrl ?? getExternalOpenCvWorkerUrl();
  if (!workerUrl) {
    return { available: false, reason: 'external_worker_url_not_configured', health: null };
  }

  const timeoutMs = input.timeoutMs ?? Number(process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const health = await fetchHealth(workerUrl, timeoutMs);
  if (!health || health.status !== 'ok') {
    return { available: false, reason: 'external_worker_health_unavailable', health };
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const photoFiles = input.files.filter(file => file.fileType === 'photo');
  const job = {
    schemaVersion: 'solarpro_external_photo_vision_job_v1',
    surveyId: input.survey.id,
    projectId: input.survey.projectId ?? null,
    createdAt,
    files: photoFiles.map(file => ({
      fileId: file.id,
      fileUrl: file.fileUrl,
      filename: file.filename,
      contentType: file.mimeType ?? null,
    })),
  };

  const raw = await fetchJson(`${workerUrl}/v1/photo-vision/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
    timeoutMs,
  });

  const run = normalizeExternalRun(raw, input.survey, photoFiles, createdAt);
  return { available: true, health, run };
}

async function fetchHealth(workerUrl: string, timeoutMs: number): Promise<ExternalOpenCvPhotoVisionHealth | null> {
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
    availability: {
      sharp: 'available_next_app_thumbnail_fallback',
      opencv: 'available_external_worker',
      yoloSupervision: 'unavailable_stage_2_not_implemented',
      tesseract: 'unavailable_stage_3_not_implemented_in_this_pass',
      pythonWorker: 'available_external_docker_worker',
      open3d: 'unavailable_future_stage_not_implemented',
      freecad: 'unavailable_future_stage_not_implemented',
    },
    authority: noAuthority(),
    limitations: baseLimitations(),
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
    candidates,
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
  const region = normalizeRegion(value.region ?? payload.region);
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
    summary: typeof value.summary === 'string' ? value.summary : 'External OpenCV review candidate.',
    payload: {
      ...payload,
      externalWorker: true,
      stage: 'stage_1_opencv_edges_lines_contours',
      sourceToolName: toolName,
      sourceToolVersion: toolVersion,
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
    'Stage 1 external OpenCV worker output is a review cue only and cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
    'YOLO/Supervision, OCR/Tesseract, Open3D, and FreeCAD remain future stages and are not marked complete by this result.',
  ];
}
