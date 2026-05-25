import crypto from 'crypto';
import sharp from 'sharp';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';

export const OPEN_SOURCE_PHOTO_VISION_TOOL_NAME = 'open-source-photo-vision-worker';
export const OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION = '1.0.0';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 9_000;
const EDGE_SIZE = 96;
const THUMB_SIZE = 160;

export type OpenSourcePhotoVisionCandidateType =
  | 'edge_map_summary'
  | 'dominant_line_candidate'
  | 'rectangular_region_candidate'
  | 'equipment_anchor_candidate'
  | 'roof_edge_candidate'
  | 'wall_anchor_candidate'
  | 'obstruction_candidate'
  | 'ocr_availability_note';

export interface OpenSourcePhotoVisionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: 'normalized_image_0_1000';
}

export interface OpenSourcePhotoVisionLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  strength: number;
  coordinateSystem: 'normalized_image_0_1000';
}

export interface OpenSourcePhotoVisionCandidate {
  candidateId: string;
  surveyId: string;
  fileId: string;
  fileUrl: string;
  filename: string | null;
  candidateType: OpenSourcePhotoVisionCandidateType;
  candidateCategory: 'quality' | 'roof_context' | 'electrical_context' | 'structure_context' | 'field_context';
  confidence: number;
  summary: string;
  payload: Record<string, unknown>;
  region?: OpenSourcePhotoVisionRegion;
  line?: OpenSourcePhotoVisionLine;
  limitations: string[];
  reviewStatus: 'review_required';
  nonAuthoritative: true;
  toolName: typeof OPEN_SOURCE_PHOTO_VISION_TOOL_NAME;
  toolVersion: typeof OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION;
  runHash: string;
  deterministicHash: string;
  createdAt: string;
}

export interface OpenSourcePhotoVisionFileResult {
  surveyId: string;
  fileId: string;
  fileUrl: string;
  filename: string | null;
  analyzed: boolean;
  error: string | null;
  metadata: {
    widthPx: number | null;
    heightPx: number | null;
    format: string | null;
    byteSize: number;
    sha256: string | null;
    dominantBrightness: number | null;
    sharpnessScore: number | null;
    qualityScore: number | null;
  };
  thumbnailDataUrl: string | null;
  edgeSummary: {
    edgePixelRatio: number;
    horizontalStrength: number;
    verticalStrength: number;
    diagonalStrength: number;
    denseRegionCount: number;
  } | null;
  candidates: OpenSourcePhotoVisionCandidate[];
  limitations: string[];
  runHash: string;
}

export interface OpenSourcePhotoVisionRunResult {
  schemaVersion: 'open_source_photo_vision_run_v1';
  surveyId: string;
  projectId: string | null;
  toolName: typeof OPEN_SOURCE_PHOTO_VISION_TOOL_NAME;
  toolVersion: typeof OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION;
  createdAt: string;
  processedCount: number;
  failedCount: number;
  candidateCount: number;
  runHash: string;
  files: OpenSourcePhotoVisionFileResult[];
  candidates: OpenSourcePhotoVisionCandidate[];
  availability: {
    sharp: 'available';
    opencv: 'unavailable_next_runtime_adapter_not_configured';
    yoloSupervision: 'unavailable_model_worker_not_configured';
    tesseract: 'available_optional_not_executed_in_this_pass';
    pythonWorker: 'unavailable_not_configured';
  };
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    canonicalMutationAllowed: false;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
    engineeringWorkflowMutationAllowed: false;
  };
  limitations: string[];
}

interface PixelAnalysis {
  brightness: number;
  sharpness: number;
  edgeSummary: NonNullable<OpenSourcePhotoVisionFileResult['edgeSummary']>;
  lines: OpenSourcePhotoVisionLine[];
  regions: OpenSourcePhotoVisionRegion[];
}

export async function runOpenSourcePhotoVisionWorker(input: {
  survey: Pick<SiteSurvey, 'id' | 'projectId'>;
  files: SiteSurveyFile[];
  createdAt?: string;
}): Promise<OpenSourcePhotoVisionRunResult> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const photoFiles = input.files.filter(file => file.fileType === 'photo');
  const files = await Promise.all(photoFiles.map(file => analyzeFile(input.survey, file, createdAt)));
  const candidates = files.flatMap(file => file.candidates);
  const runHash = sha256(stable({
    surveyId: input.survey.id,
    projectId: input.survey.projectId ?? null,
    toolName: OPEN_SOURCE_PHOTO_VISION_TOOL_NAME,
    toolVersion: OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION,
    fileHashes: files.map(file => ({ fileId: file.fileId, hash: file.metadata.sha256, candidates: file.candidates.map(c => c.deterministicHash) })),
  }));
  return {
    schemaVersion: 'open_source_photo_vision_run_v1',
    surveyId: input.survey.id,
    projectId: input.survey.projectId ?? null,
    toolName: OPEN_SOURCE_PHOTO_VISION_TOOL_NAME,
    toolVersion: OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION,
    createdAt,
    processedCount: files.filter(file => file.analyzed).length,
    failedCount: files.filter(file => !file.analyzed).length,
    candidateCount: candidates.length,
    runHash,
    files,
    candidates,
    availability: {
      sharp: 'available',
      opencv: 'unavailable_next_runtime_adapter_not_configured',
      yoloSupervision: 'unavailable_model_worker_not_configured',
      tesseract: 'available_optional_not_executed_in_this_pass',
      pythonWorker: 'unavailable_not_configured',
    },
    authority: noAuthority(),
    limitations: baseLimitations(),
  };
}

async function analyzeFile(survey: Pick<SiteSurvey, 'id' | 'projectId'>, file: SiteSurveyFile, createdAt: string): Promise<OpenSourcePhotoVisionFileResult> {
  try {
    const bytes = await fetchImageBuffer(file.fileUrl);
    const byteHash = sha256(bytes);
    const image = sharp(bytes, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;
    const thumb = await image.clone().resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    const pixels = await analyzePixels(bytes);
    const qualityScore = scoreQuality(width, height, bytes.length, pixels.sharpness, pixels.brightness);
    const runHash = sha256(stable({ fileId: file.id, surveyId: survey.id, byteHash, edgeSummary: pixels.edgeSummary, lines: pixels.lines, regions: pixels.regions }));
    const candidates = buildCandidates({ survey, file, createdAt, runHash, byteHash, qualityScore, pixels });
    return {
      surveyId: survey.id,
      fileId: file.id,
      fileUrl: file.fileUrl,
      filename: file.filename,
      analyzed: true,
      error: null,
      metadata: { widthPx: width, heightPx: height, format: metadata.format ?? null, byteSize: bytes.length, sha256: byteHash, dominantBrightness: pixels.brightness, sharpnessScore: pixels.sharpness, qualityScore },
      thumbnailDataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}`,
      edgeSummary: pixels.edgeSummary,
      candidates,
      limitations: baseLimitations(),
      runHash,
    };
  } catch (error) {
    const runHash = sha256(stable({ surveyId: survey.id, fileId: file.id, error: error instanceof Error ? error.message : String(error) }));
    return {
      surveyId: survey.id,
      fileId: file.id,
      fileUrl: file.fileUrl,
      filename: file.filename,
      analyzed: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'Open-source photo vision analysis failed',
      metadata: { widthPx: null, heightPx: null, format: null, byteSize: 0, sha256: null, dominantBrightness: null, sharpnessScore: null, qualityScore: null },
      thumbnailDataUrl: null,
      edgeSummary: null,
      candidates: [],
      limitations: ['Image bytes could not be fetched or decoded; no candidates emitted for this file.', ...baseLimitations()],
      runHash,
    };
  }
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) survey photo URLs can be analyzed by the OSS worker.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image fetch failed with HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_IMAGE_BYTES) throw new Error(`Image exceeds max OSS worker byte limit (${contentLength} > ${MAX_IMAGE_BYTES}).`);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`Image exceeds max OSS worker byte limit (${arrayBuffer.byteLength} > ${MAX_IMAGE_BYTES}).`);
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

async function analyzePixels(bytes: Buffer): Promise<PixelAnalysis> {
  const { data, info } = await sharp(bytes, { failOn: 'none' }).rotate().resize(EDGE_SIZE, EDGE_SIZE, { fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  let brightnessSum = 0;
  let sharpnessSum = 0;
  let edgeCount = 0;
  const rowScores = new Array(h).fill(0);
  const colScores = new Array(w).fill(0);
  const diagScores = new Array(w + h).fill(0);
  const dense = new Map<string, number>();
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x;
      const center = data[idx] ?? 0;
      brightnessSum += center;
      const gx = Math.abs((data[idx + 1] ?? center) - (data[idx - 1] ?? center));
      const gy = Math.abs((data[idx + w] ?? center) - (data[idx - w] ?? center));
      const edge = gx + gy;
      sharpnessSum += edge;
      if (edge > 54) {
        edgeCount += 1;
        rowScores[y] += gy;
        colScores[x] += gx;
        diagScores[x + Math.round(y / 2)] += Math.abs(gx - gy);
        const cell = `${Math.floor(x / 16)}:${Math.floor(y / 16)}`;
        dense.set(cell, (dense.get(cell) ?? 0) + 1);
      }
    }
  }
  const sampleCount = Math.max(1, (w - 2) * (h - 2));
  const horizontalStrength = normalizeMax(rowScores);
  const verticalStrength = normalizeMax(colScores);
  const diagonalStrength = normalizeMax(diagScores);
  const edgeSummary = {
    edgePixelRatio: round(edgeCount / sampleCount, 4),
    horizontalStrength,
    verticalStrength,
    diagonalStrength,
    denseRegionCount: [...dense.values()].filter(count => count >= 18).length,
  };
  return {
    brightness: Math.round(brightnessSum / sampleCount),
    sharpness: Math.round(sharpnessSum / sampleCount),
    edgeSummary,
    lines: topLines(rowScores, colScores, diagScores, w, h),
    regions: denseRegions(dense, w, h),
  };
}

function topLines(rows: number[], cols: number[], diags: number[], w: number, h: number): OpenSourcePhotoVisionLine[] {
  const lines: OpenSourcePhotoVisionLine[] = [];
  for (const y of topIndexes(rows, 3)) lines.push({ x1: 0, y1: norm(y, h), x2: 1000, y2: norm(y, h), orientation: 'horizontal', strength: strength(rows[y] ?? 0, rows), coordinateSystem: 'normalized_image_0_1000' });
  for (const x of topIndexes(cols, 3)) lines.push({ x1: norm(x, w), y1: 0, x2: norm(x, w), y2: 1000, orientation: 'vertical', strength: strength(cols[x] ?? 0, cols), coordinateSystem: 'normalized_image_0_1000' });
  for (const d of topIndexes(diags, 2)) lines.push({ x1: norm(Math.max(0, d - h / 2), w), y1: 0, x2: norm(Math.min(w, d), w), y2: 1000, orientation: 'diagonal', strength: strength(diags[d] ?? 0, diags), coordinateSystem: 'normalized_image_0_1000' });
  return lines.filter(line => line.strength >= 0.18).slice(0, 8);
}

function denseRegions(dense: Map<string, number>, w: number, h: number): OpenSourcePhotoVisionRegion[] {
  return [...dense.entries()]
    .filter(([, count]) => count >= 18)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key]) => {
      const [cx, cy] = key.split(':').map(Number);
      return { x: norm(cx * 16, w), y: norm(cy * 16, h), width: norm(16, w), height: norm(16, h), coordinateSystem: 'normalized_image_0_1000' as const };
    });
}

function buildCandidates(input: { survey: Pick<SiteSurvey, 'id' | 'projectId'>; file: SiteSurveyFile; createdAt: string; runHash: string; byteHash: string; qualityScore: number; pixels: PixelAnalysis }): OpenSourcePhotoVisionCandidate[] {
  const { survey, file, createdAt, runHash, byteHash, qualityScore, pixels } = input;
  const base = { surveyId: survey.id, fileId: file.id, fileUrl: file.fileUrl, filename: file.filename, toolName: OPEN_SOURCE_PHOTO_VISION_TOOL_NAME, toolVersion: OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION, runHash, reviewStatus: 'review_required', nonAuthoritative: true, createdAt } satisfies Pick<OpenSourcePhotoVisionCandidate, 'surveyId' | 'fileId' | 'fileUrl' | 'filename' | 'toolName' | 'toolVersion' | 'runHash' | 'reviewStatus' | 'nonAuthoritative' | 'createdAt'>;
  const out: Omit<OpenSourcePhotoVisionCandidate, 'candidateId' | 'deterministicHash'>[] = [];
  out.push({ ...base, candidateType: 'edge_map_summary', candidateCategory: 'quality', confidence: clamp(Math.round(pixels.edgeSummary.edgePixelRatio * 220), 5, 85), summary: 'Open-source edge map summary from decoded image pixels.', payload: { sourceImageSha256: byteHash, qualityScore, edgeSummary: pixels.edgeSummary }, limitations: baseLimitations() });
  pixels.lines.forEach((line, index) => out.push({ ...base, candidateType: line.orientation === 'horizontal' ? 'roof_edge_candidate' : 'dominant_line_candidate', candidateCategory: line.orientation === 'horizontal' ? 'roof_context' : 'structure_context', confidence: clamp(Math.round(line.strength * 82), 12, 72), summary: `${line.orientation} dominant line candidate from edge projections.`, payload: { sourceImageSha256: byteHash, lineIndex: index, line, source: 'edge_projection' }, line, limitations: ['Line is a pixel-derived review cue, not a measured roof edge.', ...baseLimitations()] }));
  pixels.regions.forEach((region, index) => {
    const electricalHint = /meter|panel|msp|main|inverter|electrical/i.test(`${file.label ?? ''} ${file.filename ?? ''}`);
    const type: OpenSourcePhotoVisionCandidateType = electricalHint ? 'equipment_anchor_candidate' : index % 2 === 0 ? 'rectangular_region_candidate' : 'obstruction_candidate';
    out.push({ ...base, candidateType: type, candidateCategory: electricalHint ? 'electrical_context' : 'field_context', confidence: clamp(34 + pixels.edgeSummary.denseRegionCount * 4 - index * 3, 18, 68), summary: `${type.replace(/_/g, ' ')} from dense edge region in image bytes.`, payload: { sourceImageSha256: byteHash, regionIndex: index, region, source: 'dense_edge_component', filenameLabelHintUsedForCategoryOnly: electricalHint }, region, limitations: ['Region is pixel-derived from edges but class is only a review hint.', ...baseLimitations()] });
  });
  out.push({ ...base, candidateType: 'ocr_availability_note', candidateCategory: 'electrical_context', confidence: 10, summary: 'Tesseract OCR adapter is available but not executed in this bounded pass.', payload: { sourceImageSha256: byteHash, tesseractAvailable: true, executed: false }, limitations: ['OCR was not executed; this note is diagnostic only.', ...baseLimitations()] });
  return out.map((candidate, index) => finalizeCandidate(candidate, index));
}

function finalizeCandidate(candidate: Omit<OpenSourcePhotoVisionCandidate, 'candidateId' | 'deterministicHash'>, index: number): OpenSourcePhotoVisionCandidate {
  const deterministicHash = sha256(stable({ ...candidate, createdAt: 'stable-created-at' }));
  return { ...candidate, candidateId: `ospv_${deterministicHash.slice(0, 24)}_${index + 1}`, deterministicHash };
}

function scoreQuality(width: number | null, height: number | null, bytes: number, sharpness: number, brightness: number): number {
  const megapixels = width && height ? (width * height) / 1_000_000 : 0;
  const sizeScore = Math.min(24, Math.round(megapixels * 8)) + Math.min(16, Math.round(bytes / 300_000));
  const sharpScore = Math.min(35, Math.round(sharpness * 1.6));
  const brightScore = brightness >= 45 && brightness <= 220 ? 25 : 10;
  return clamp(sizeScore + sharpScore + brightScore, 0, 100);
}

function baseLimitations(): string[] {
  return [
    'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
    'No roof plane, obstruction map, equipment location, measurement, permit input, BOM input, or engineering fact is created.',
    'Native OpenCV/YOLO/Supervision workers are not configured in this runtime; this pass uses sharp pixel processing only.',
    'Candidates may guide operator review only and must not mutate canonical evidence or CAD state.',
  ];
}

function noAuthority() { return { reviewOnly: true as const, nonAuthoritative: true as const, canonicalMutationAllowed: false as const, cadMutationAllowed: false as const, permitGenerationAllowed: false as const, bomMutationAllowed: false as const, engineeringWorkflowMutationAllowed: false as const }; }
function topIndexes(values: number[], count: number): number[] { return values.map((value, index) => ({ value, index })).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, count).map(item => item.index); }
function normalizeMax(values: number[]): number { const max = Math.max(0, ...values); const sum = values.reduce((a, b) => a + b, 0); return round(max / Math.max(1, sum), 4); }
function strength(value: number, values: number[]): number { return round(value / Math.max(1, Math.max(...values)), 4); }
function norm(value: number, denom: number): number { return clamp(Math.round((value / Math.max(1, denom)) * 1000), 0, 1000); }
function round(value: number, places: number): number { const factor = 10 ** places; return Math.round(value * factor) / factor; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function sha256(value: crypto.BinaryLike | string): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`; }
