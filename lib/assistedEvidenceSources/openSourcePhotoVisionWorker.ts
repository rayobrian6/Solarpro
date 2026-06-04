/**
 * Open-source photo vision worker — real roof geometry extraction.
 *
 * Processes survey photos through a 512×512 Canny edge detection +
 * contour tracing pipeline to extract actual roof shapes, obstructions,
 * equipment, and structural lines.
 *
 * When OPENAI_API_KEY is available, GPT-4o Vision is used as a
 * supplementary geometry source for higher-accuracy roof plane polygons.
 *
 * All candidates are REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY.
 * They are operator review aids only and must not be used as canonical
 * evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import crypto from 'crypto';
import type { SiteSurvey, SiteSurveyFile } from '@/lib/db/surveys';
import {
  extractRoofGeometry,
  contourToNormalizedRegion,
  lineToNormalizedLine,
  contourToNormalizedPolygon,
  type ExtractedContour,
  type ExtractedLine,
  type ContourClassification,
  type RoofGeometryExtractionResult,
  EXTRACTION_SIZE,
} from './roofGeometryExtractor';
import {
  extractRoofGeometryWithVision,
  visionRoofPlaneToRegion,
  visionObstructionToRegion,
  visionEquipmentToRegion,
  visionStructuralLineToNormalizedLine,
  type VisionGeometryResult,
  type VisionRoofPlane,
  type VisionObstruction,
  type VisionEquipment,
  type VisionStructuralLine,
} from './openaiRoofGeometryExtractor';
import type { NormalizedRegion, NormalizedLine } from './overlayCoordinateConversion';

export const OPEN_SOURCE_PHOTO_VISION_TOOL_NAME = 'open-source-photo-vision-worker';
export const OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION = '2.0.0';

export type OpenSourcePhotoVisionToolName = typeof OPEN_SOURCE_PHOTO_VISION_TOOL_NAME | 'external-opencv-photo-vision-worker' | (string & {});
export type OpenSourcePhotoVisionToolVersion = typeof OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION | '1.0.0' | '0.1.0' | (string & {});

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 9_000;
const THUMB_SIZE = 160;

/** Classification → candidate type mapping. */
const CLASSIFICATION_TYPE_MAP: Record<ContourClassification, OpenSourcePhotoVisionCandidateType> = {
  probable_roof_plane: 'roof_edge_candidate',
  probable_wall_plane: 'wall_anchor_candidate',
  probable_obstruction: 'obstruction_candidate',
  probable_equipment: 'equipment_anchor_candidate',
  probable_ground_noise: 'rectangular_region_candidate',
  probable_sky_region: 'rectangular_region_candidate',
  // Facade
  probable_siding: 'rectangular_region_candidate',
  probable_window: 'rectangular_region_candidate',
  probable_door: 'rectangular_region_candidate',
  probable_garage_door: 'rectangular_region_candidate',
  probable_gutter: 'rectangular_region_candidate',
  probable_downspout: 'rectangular_region_candidate',
  probable_porch: 'rectangular_region_candidate',
  probable_deck: 'rectangular_region_candidate',
  // Site context
  probable_driveway: 'rectangular_region_candidate',
  probable_fence: 'rectangular_region_candidate',
  probable_bushes: 'rectangular_region_candidate',
  // Electrical/solar
  probable_ac_unit: 'equipment_anchor_candidate',
  probable_utility_meter: 'equipment_anchor_candidate',
  probable_existing_solar: 'equipment_anchor_candidate',
  // Occluder
  probable_vehicle: 'rectangular_region_candidate',
  probable_person: 'rectangular_region_candidate',
  // Condition
  probable_moss: 'rectangular_region_candidate',
  probable_damaged_area: 'rectangular_region_candidate',
  unknown: 'rectangular_region_candidate',
  // Phase 0 (P0-8.3): background regions — unclassifiable, mapped to generic candidate
  background: 'rectangular_region_candidate',
};

/** Classification → candidate category mapping. */
const CLASSIFICATION_CATEGORY_MAP: Record<ContourClassification, OpenSourcePhotoVisionCandidate['candidateCategory']> = {
  probable_roof_plane: 'roof_context',
  probable_wall_plane: 'structure_context',
  probable_obstruction: 'field_context',
  probable_equipment: 'electrical_context',
  probable_ground_noise: 'field_context',
  probable_sky_region: 'field_context',
  // Facade
  probable_siding: 'structure_context',
  probable_window: 'structure_context',
  probable_door: 'structure_context',
  probable_garage_door: 'structure_context',
  probable_gutter: 'structure_context',
  probable_downspout: 'structure_context',
  probable_porch: 'structure_context',
  probable_deck: 'structure_context',
  // Site context
  probable_driveway: 'field_context',
  probable_fence: 'field_context',
  probable_bushes: 'field_context',
  // Electrical/solar
  probable_ac_unit: 'electrical_context',
  probable_utility_meter: 'electrical_context',
  probable_existing_solar: 'electrical_context',
  // Occluder
  probable_vehicle: 'field_context',
  probable_person: 'field_context',
  // Condition
  probable_moss: 'quality',
  probable_damaged_area: 'quality',
  unknown: 'field_context',
  // Phase 0 (P0-8.3): background regions — unclassifiable, categorized as field context
  background: 'field_context',
};

export type OpenSourcePhotoVisionCandidateType =
  | 'edge_map_summary'
  | 'dominant_line_candidate'
  | 'rectangular_region_candidate'
  | 'equipment_anchor_candidate'
  | 'roof_edge_candidate'
  | 'wall_anchor_candidate'
  | 'obstruction_candidate'
  | 'ocr_availability_note'
  | (string & {});

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
  toolName: OpenSourcePhotoVisionToolName;
  toolVersion: OpenSourcePhotoVisionToolVersion;
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
  /** Which extraction method was used. */
  extractionMethod: 'sharp_contour_512' | 'openai_vision' | 'combined' | 'none';
}

export interface OpenSourcePhotoVisionRunResult {
  schemaVersion: 'open_source_photo_vision_run_v1';
  surveyId: string;
  projectId: string | null;
  toolName: OpenSourcePhotoVisionToolName;
  toolVersion: OpenSourcePhotoVisionToolVersion;
  createdAt: string;
  processedCount: number;
  failedCount: number;
  candidateCount: number;
  runHash: string;
  files: OpenSourcePhotoVisionFileResult[];
  candidates: OpenSourcePhotoVisionCandidate[];
  availability: {
    sharp?: string;
    opencv: string;
    yoloSupervision: string;
    tesseract: string;
    pythonWorker: string;
    open3d?: string;
    freecad?: string;
    [key: string]: string | undefined;
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

// ────────────────────────────────────────────────────────────────────────────
// Per-file analysis — real contour extraction
// ────────────────────────────────────────────────────────────────────────────

async function analyzeFile(
  survey: Pick<SiteSurvey, 'id' | 'projectId'>,
  file: SiteSurveyFile,
  createdAt: string,
): Promise<OpenSourcePhotoVisionFileResult> {
  try {
    const bytes = await fetchImageBuffer(file.fileUrl);
    const byteHash = sha256(bytes);

    // Dynamic import — sharp has native bindings, keep out of client-side webpack bundle
    const sharp = (await import('sharp')).default;
    const image = sharp(bytes, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;

    const thumb = await image
      .clone()
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();

    // ── Real geometry extraction at 512×512 ──────────────────────────────
    const geometry = await extractRoofGeometry(bytes);
    const qualityScore = scoreQuality(width, height, bytes.length, geometry.metrics.sharpness, geometry.metrics.brightness);

    // ── Optional OpenAI Vision extraction ─────────────────────────────────
    let visionResult: VisionGeometryResult | null = null;
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey && /^https?:\/\//i.test(file.fileUrl)) {
      try {
        visionResult = await extractRoofGeometryWithVision(file.fileUrl, file.id, openaiKey);
      } catch {
        // Vision extraction failed — continue with sharp-only results
        visionResult = null;
      }
    }

    // Determine extraction method
    const extractionMethod: OpenSourcePhotoVisionFileResult['extractionMethod'] =
      visionResult?.success ? 'combined' : 'sharp_contour_512';

    // Build edge summary from extraction metrics
    const edgeSummary = {
      edgePixelRatio: geometry.metrics.edgePixelRatio,
      horizontalStrength: geometry.metrics.horizontalStrength,
      verticalStrength: geometry.metrics.verticalStrength,
      diagonalStrength: geometry.metrics.diagonalStrength,
      denseRegionCount: geometry.contourCount,
    };

    const runHash = sha256(stable({
      fileId: file.id,
      surveyId: survey.id,
      byteHash,
      edgeSummary,
      contourCount: geometry.contourCount,
      lineCount: geometry.lineCount,
    }));

    // ── Build real candidates from extracted geometry ─────────────────────
    const candidates = buildCandidatesFromGeometry({
      survey,
      file,
      createdAt,
      runHash,
      byteHash,
      qualityScore,
      geometry,
      visionResult,
      imgW: geometry.extractionSize,
      imgH: geometry.extractionSize,
    });

    return {
      surveyId: survey.id,
      fileId: file.id,
      fileUrl: file.fileUrl,
      filename: file.filename,
      analyzed: true,
      error: null,
      metadata: {
        widthPx: width,
        heightPx: height,
        format: metadata.format ?? null,
        byteSize: bytes.length,
        sha256: byteHash,
        dominantBrightness: geometry.metrics.brightness,
        sharpnessScore: geometry.metrics.sharpness,
        qualityScore,
      },
      thumbnailDataUrl: `data:image/jpeg;base64,${thumb.toString('base64')}`,
      edgeSummary,
      candidates,
      limitations: baseLimitations(),
      runHash,
      extractionMethod,
    };
  } catch (error) {
    const runHash = sha256(stable({
      surveyId: survey.id,
      fileId: file.id,
      error: error instanceof Error ? error.message : String(error),
    }));
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
      extractionMethod: 'none',
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate builder — real geometry from contours + optional Vision
// ────────────────────────────────────────────────────────────────────────────

function buildCandidatesFromGeometry(input: {
  survey: Pick<SiteSurvey, 'id' | 'projectId'>;
  file: SiteSurveyFile;
  createdAt: string;
  runHash: string;
  byteHash: string;
  qualityScore: number;
  geometry: RoofGeometryExtractionResult;
  visionResult: VisionGeometryResult | null;
  imgW: number;
  imgH: number;
}): OpenSourcePhotoVisionCandidate[] {
  const { survey, file, createdAt, runHash, byteHash, qualityScore, geometry, visionResult, imgW, imgH } = input;

  const base = {
    surveyId: survey.id,
    fileId: file.id,
    fileUrl: file.fileUrl,
    filename: file.filename,
    toolName: OPEN_SOURCE_PHOTO_VISION_TOOL_NAME,
    toolVersion: OPEN_SOURCE_PHOTO_VISION_TOOL_VERSION,
    runHash,
    reviewStatus: 'review_required' as const,
    nonAuthoritative: true as const,
    createdAt,
  };

  const out: Omit<OpenSourcePhotoVisionCandidate, 'candidateId' | 'deterministicHash'>[] = [];

  // ── 1. Edge map summary (quality metadata candidate) ────────────────────
  out.push({
    ...base,
    candidateType: 'edge_map_summary',
    candidateCategory: 'quality',
    confidence: clamp(Math.round(geometry.metrics.edgePixelRatio * 220), 5, 85),
    summary: `512×512 Canny contour extraction: ${geometry.contourCount} contours, ${geometry.lineCount} lines detected.`,
    payload: {
      sourceImageSha256: byteHash,
      qualityScore,
      edgeSummary: {
        edgePixelRatio: geometry.metrics.edgePixelRatio,
        horizontalStrength: geometry.metrics.horizontalStrength,
        verticalStrength: geometry.metrics.verticalStrength,
        diagonalStrength: geometry.metrics.diagonalStrength,
        denseRegionCount: geometry.contourCount,
      },
      extractionMethod: 'sharp_contour_512',
      extractionSize: EXTRACTION_SIZE,
      contourCount: geometry.contourCount,
      lineCount: geometry.lineCount,
    },
    limitations: baseLimitations(),
  });

  // ── 2. Contour-based region candidates ──────────────────────────────────
  for (const contour of geometry.contours) {
    const candidateType = CLASSIFICATION_TYPE_MAP[contour.classification] ?? 'rectangular_region_candidate';
    const candidateCategory = CLASSIFICATION_CATEGORY_MAP[contour.classification] ?? 'field_context';
    const region = contourToNormalizedRegion(contour, imgW, imgH);
    const polygonVertices = contourToNormalizedPolygon(contour, imgW, imgH);

    // If OpenAI Vision found a matching roof plane, boost confidence
    let confidenceBoost = 0;
    if (visionResult?.success && contour.classification === 'probable_roof_plane') {
      const matchingPlane = findMatchingVisionPlane(contour, visionResult.roofPlanes);
      if (matchingPlane) {
        confidenceBoost = 15;
      }
    }

    out.push({
      ...base,
      candidateType,
      candidateCategory,
      confidence: clamp(contour.confidence + confidenceBoost, 10, 85),
      summary: `${contour.classification.replace(/_/g, ' ')} from 512×512 Canny contour extraction (area=${contour.area}, circularity=${contour.circularity}).`,
      payload: {
        sourceImageSha256: byteHash,
        contourIndex: contour.index,
        classification: contour.classification,
        region,
        polygonVertices,
        contourArea: contour.area,
        contourPerimeter: contour.perimeter,
        contourCircularity: contour.circularity,
        vertexCount: polygonVertices.length,
        source: 'canny_contour_512',
        extractionMethod: 'sharp_contour_512',
        ...(confidenceBoost > 0 ? { visionBoosted: true, visionBoostAmount: confidenceBoost } : {}),
      },
      region,
      limitations: [
        'Contour is pixel-derived from Canny edge detection at 512×512 — class is a heuristic review hint.',
        'Polygon vertices are available in payload.polygonVertices for polygon overlay rendering.',
        ...baseLimitations(),
      ],
    });
  }

  // ── 3. Line candidates from Hough-like detection ───────────────────────
  for (const line of geometry.lines) {
    const normalizedLine = lineToNormalizedLine(line, imgW, imgH);
    const lineCandidateType: OpenSourcePhotoVisionCandidateType =
      line.classification === 'ridge_line' || line.classification === 'eave_line' || line.classification === 'rake_line'
        ? 'roof_edge_candidate'
        : 'dominant_line_candidate';

    out.push({
      ...base,
      candidateType: lineCandidateType,
      candidateCategory: line.classification === 'wall_edge' ? 'structure_context' : 'roof_context',
      confidence: clamp(Math.round(line.strength * 82), 12, 80),
      summary: `${line.classification.replace(/_/g, ' ')} — ${line.orientation} line from Hough projection (length=${Math.round(line.length)}px).`,
      payload: {
        sourceImageSha256: byteHash,
        lineClassification: line.classification,
        lineOrientation: line.orientation,
        lineLength: line.length,
        lineStrength: line.strength,
        line: normalizedLine,
        source: 'hough_projection_512',
      },
      line: normalizedLine,
      limitations: [
        'Line is derived from Hough projection of Canny edge map — classification is heuristic.',
        ...baseLimitations(),
      ],
    });
  }

  // ── 4. OpenAI Vision candidates (if available) ──────────────────────────
  if (visionResult?.success) {
    // Roof plane polygons from GPT-4o Vision
    for (let i = 0; i < visionResult.roofPlanes.length; i++) {
      const plane = visionResult.roofPlanes[i];
      const region = visionRoofPlaneToRegion(plane);

      out.push({
        ...base,
        candidateType: 'roof_edge_candidate',
        candidateCategory: 'roof_context',
        confidence: clamp(Math.round(plane.confidence * 80), 20, 85),
        summary: `GPT-4o Vision roof plane "${plane.label}" (slope≈${plane.slopeDegrees ?? '?'}°, aspect≈${plane.aspectDegrees ?? '?'}°).`,
        payload: {
          sourceImageSha256: byteHash,
          visionPlaneIndex: i,
          visionPlaneLabel: plane.label,
          visionPlaneVertices: plane.vertices,
          visionSlopeDegrees: plane.slopeDegrees,
          visionAspectDegrees: plane.aspectDegrees,
          visionConfidence: plane.confidence,
          region,
          polygonVertices: plane.vertices.map(v => ({
            x: v.x,
            y: v.y,
            coordinateSystem: 'normalized_image_0_1000' as const,
          })),
          source: 'openai_vision_gpt4o',
          extractionMethod: 'openai_vision',
        },
        region,
        limitations: [
          'Roof plane polygon from GPT-4o Vision — AI-generated geometry, not measured.',
          'Slope and aspect are estimated by the model, not from physical measurement.',
          ...baseLimitations(),
        ],
      });
    }

    // Obstructions from GPT-4o Vision
    for (let i = 0; i < visionResult.obstructions.length; i++) {
      const obs = visionResult.obstructions[i];
      const region = visionObstructionToRegion(obs);

      out.push({
        ...base,
        candidateType: 'obstruction_candidate',
        candidateCategory: 'field_context',
        confidence: clamp(Math.round(obs.confidence * 75), 15, 80),
        summary: `GPT-4o Vision obstruction: ${obs.type} (confidence=${(obs.confidence * 100).toFixed(0)}%).`,
        payload: {
          sourceImageSha256: byteHash,
          visionObstructionIndex: i,
          visionObstructionType: obs.type,
          visionBbox: obs.bbox,
          visionConfidence: obs.confidence,
          region,
          source: 'openai_vision_gpt4o',
        },
        region,
        limitations: [
          `Obstruction type "${obs.type}" identified by GPT-4o Vision — AI-classified, not verified.`,
          ...baseLimitations(),
        ],
      });
    }

    // Equipment from GPT-4o Vision
    for (let i = 0; i < visionResult.equipment.length; i++) {
      const equip = visionResult.equipment[i];
      const region = visionEquipmentToRegion(equip);

      out.push({
        ...base,
        candidateType: 'equipment_anchor_candidate',
        candidateCategory: 'electrical_context',
        confidence: clamp(Math.round(equip.confidence * 75), 15, 80),
        summary: `GPT-4o Vision equipment: ${equip.type} (confidence=${(equip.confidence * 100).toFixed(0)}%).`,
        payload: {
          sourceImageSha256: byteHash,
          visionEquipmentIndex: i,
          visionEquipmentType: equip.type,
          visionBbox: equip.bbox,
          visionConfidence: equip.confidence,
          region,
          source: 'openai_vision_gpt4o',
        },
        region,
        limitations: [
          `Equipment type "${equip.type}" identified by GPT-4o Vision — AI-classified, not verified.`,
          ...baseLimitations(),
        ],
      });
    }

    // Structural lines from GPT-4o Vision
    for (let i = 0; i < visionResult.lines.length; i++) {
      const vLine = visionResult.lines[i];
      const normalizedLine = visionStructuralLineToNormalizedLine(vLine);

      out.push({
        ...base,
        candidateType: 'roof_edge_candidate',
        candidateCategory: 'roof_context',
        confidence: clamp(Math.round(vLine.confidence * 80), 15, 80),
        summary: `GPT-4o Vision structural line: ${vLine.type}.`,
        payload: {
          sourceImageSha256: byteHash,
          visionLineIndex: i,
          visionLineType: vLine.type,
          visionLineStart: vLine.start,
          visionLineEnd: vLine.end,
          visionConfidence: vLine.confidence,
          line: normalizedLine,
          source: 'openai_vision_gpt4o',
        },
        line: normalizedLine,
        limitations: [
          `Structural line type "${vLine.type}" from GPT-4o Vision — AI-identified, not measured.`,
          ...baseLimitations(),
        ],
      });
    }
  }

  // ── 5. OCR availability note ────────────────────────────────────────────
  out.push({
    ...base,
    candidateType: 'ocr_availability_note',
    candidateCategory: 'electrical_context',
    confidence: 10,
    summary: 'Tesseract OCR adapter is available but not executed in this bounded pass.',
    payload: { sourceImageSha256: byteHash, tesseractAvailable: true, executed: false },
    limitations: ['OCR was not executed; this note is diagnostic only.', ...baseLimitations()],
  });

  return out.map((candidate, index) => finalizeCandidate(candidate, index));
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find a Vision roof plane that roughly matches a contour's bounding box.
 * Used to boost confidence when both pipelines agree.
 */
function findMatchingVisionPlane(
  contour: ExtractedContour,
  planes: VisionRoofPlane[],
): VisionRoofPlane | null {
  const bb = contour.boundingBox;
  const cx = bb.x + bb.width / 2;
  const cy = bb.y + bb.height / 2;

  for (const plane of planes) {
    // Compute centroid of the vision plane's vertices
    const px = plane.vertices.reduce((sum, v) => sum + v.x, 0) / plane.vertices.length;
    const py = plane.vertices.reduce((sum, v) => sum + v.y, 0) / plane.vertices.length;

    // Check if centroids are within 20% of the image size
    const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
    if (dist < EXTRACTION_SIZE * 0.2) {
      return plane;
    }
  }
  return null;
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
    'Candidates are generated by 512×512 Canny contour extraction and heuristic classification — not from a trained ML model.',
    'When OPENAI_API_KEY is set, GPT-4o Vision supplements geometry extraction with AI-identified features.',
    'Candidates may guide operator review only and must not mutate canonical evidence or CAD state.',
  ];
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sha256(value: crypto.BinaryLike | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}
