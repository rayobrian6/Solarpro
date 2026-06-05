/**
 * Segmentation worker — produces polygon-based semantic segmentation masks
 * from survey photos using SAM 2 (Meta's Segment Anything Model 2).
 *
 * Architecture decisions:
 * - PRIMARY: SAM 2 Automatic Mask Generation via Python microservice
 *   (deployed on Render). Produces semantic region masks with
 *   model-predicted confidence scores.
 * - EXPLICIT CANNY: When SAM2_SERVICE_URL is not configured, Canny edge
 *   detection at 512×512 is used as an explicit backend (NOT a fallback).
 *   When SAM2 is configured but fails, NO Canny fallback occurs — the
 *   failure is reported honestly instead of producing garbage visuals.
 * - Photos are prioritized by label so roof-domain photos get SAM 2 first
 * - All masks carry review-only authority — never authoritative geometry
 * - Raw mask data is preserved alongside cleaned polygon outlines
 * - The SAM 2 service URL is configured via SAM2_SERVICE_URL env var
 * - SAM 2 cold start is handled via warm-up ping + poll-based waiting
 *
 * DESIGN PHILOSOPHY: No silent fallback to Canny. If SAM 2 fails for a
 * photo, the user sees "FAILED" — not garbage Canny visuals pretending to
 * be real segmentation. Canny is only used as an explicit backend when
 * SAM 2 is not configured at all (no SAM2_SERVICE_URL set).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  GeometryReconstructionInput,
  SemanticSegmentationMask,
  SegmentationClass,
  NormalizedPoint,
  GeometryReconstructionArtifact,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS, SEGMENTATION_CLASSES, OCCLUDER_SEGMENTATION_CLASSES, GEOMETRY_PARTICIPATION_DEFAULTS, VEGETATION_CLASSES, MAX_MASK_AREA_FRACTION_SKY, STRUCTURE_CANDIDATE_CLASSES, MIN_STRUCTURE_CONFIDENCE, MIN_WALL_MASK_AREA, MAX_SKY_OVERLAP_FRACTION, MAX_ROOF_VEGETATION_OVERLAP_FRACTION } from '../../types';
import type { GeometryParticipationFlags } from '../../types';
import { validateSemanticSegmentationMask } from '../../schemas';
import {
  extractRoofGeometry,
  contourToNormalizedPolygon,
  type ContourClassification,
  type RoofGeometryExtractionResult,
  type ExtractedContour,
} from '@/lib/assistedEvidenceSources/roofGeometryExtractor';
import {
  segmentWithSAM2,
  mapSAM2ClassHint,
  isSAM2Enabled,
  checkSAM2Health,
  waitForSAM2Warm,
  isPhase0BackgroundClassEnabled,
  SOLAR_RELEVANT_SEGMENTATION_CLASSES,
  type SAM2MaskResult,
} from './sam2Client';

// ---------------------------------------------------------------------------
// Geometry participation and containment logic — Pass 3E
// ---------------------------------------------------------------------------

/**
 * Compute geometry participation flags for a mask based on its segmentation class.
 * Uses GEOMETRY_PARTICIPATION_DEFAULTS as the source of truth for per-class rules.
 * Returns the participation flags and whether the mask should be excluded from
 * geometry entirely (giant sky masks).
 *
 * Pass 3E — Tasks A, B, C: Sky containment, geometry participation, vegetation containment.
 */
export function computeGeometryParticipation(
  segmentationClass: SegmentationClass,
  maskBounds: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
): {
  participation: GeometryParticipationFlags;
  excludeFromGeometry: boolean;
  isVegetation: boolean;
} {
  // Look up class-specific defaults
  const defaults = GEOMETRY_PARTICIPATION_DEFAULTS[segmentationClass] ?? {
    participatesInLines: true,
    participatesInPlanes: true,
    participatesInDepthFusion: true,
    participatesInPhotogrammetry: true,
  };

  const participation: GeometryParticipationFlags = { ...defaults };

  // Task A — Sky Containment: check if this is a giant sky mask
  let excludeFromGeometry = false;
  if (segmentationClass === 'sky') {
    // Compute mask area fraction relative to total image area
    // maskBounds and image dimensions are in normalized_image_0_1000 coords
    // where the image spans 0-1000 in both axes
    const IMAGE_NORM_AREA = 1000 * 1000; // total normalized image area
    const maskArea = maskBounds.width * maskBounds.height;
    const areaFraction = maskArea / IMAGE_NORM_AREA;

    if (areaFraction > MAX_MASK_AREA_FRACTION_SKY) {
      excludeFromGeometry = true;
      console.info(
        `[Pass3E] Giant sky mask suppressed: area=${maskArea.toFixed(0)} (${(areaFraction * 100).toFixed(1)}% of image), exceeds MAX_MASK_AREA_FRACTION_SKY=${MAX_MASK_AREA_FRACTION_SKY}`,
      );
    }
  }

  // Task C — Vegetation Containment: check if this is a vegetation mask
  const isVegetation = VEGETATION_CLASSES.has(segmentationClass);

  return { participation, excludeFromGeometry, isVegetation };
}

// ---------------------------------------------------------------------------
// Structure boundary tightening — Pass 3E Task D
// ---------------------------------------------------------------------------

/**
 * Suppress weak structure masks that would produce spurious geometry.
 *
 * Four suppression rules (all gating-only, NO new segmentation classes):
 * 1. Sky-overlapping structure masks: structure mask whose bounding box
 *    overlaps >MAX_SKY_OVERLAP_FRACTION with any sky mask's bounding box.
 * 2. Low-confidence structure fragments: structure mask with confidence
 *    <MIN_STRUCTURE_CONFIDENCE.
 * 3. Tiny disconnected wall fragments: wall-class mask with bounding box
 *    area <MIN_WALL_MASK_AREA.
 * 4. Roof fragments merged with vegetation: roof mask whose bounding box
 *    overlaps >MAX_ROOF_VEGETATION_OVERLAP_FRACTION with any vegetation mask.
 * 5. Lower-scene false roof masks: roof-class masks shaped/positioned like
 *    vehicles, garage doors, or giant sky regions are kept for review but
 *    blocked from geometry participation.
 *
 * Suppressed masks are NOT deleted — they get excludeFromGeometry=true and
 * all participation flags set to false, so they remain as viewable overlays
 * but do not feed any downstream geometry stage.
 */
export function suppressWeakStructureMasks(masks: SemanticSegmentationMask[]): SemanticSegmentationMask[] {
  if (masks.length === 0) return masks;

  // Pre-compute sky masks and vegetation masks for overlap checks
  const skyMasks = masks.filter(m => m.segmentationClass === 'sky' && m.excludeFromGeometry !== true);
  const vegetationMasks = masks.filter(m => m.isVegetation === true);

  let suppressedCount = 0;
  const result: SemanticSegmentationMask[] = [];

  for (const mask of masks) {
    // Only scrutinize structure candidate classes
    if (!STRUCTURE_CANDIDATE_CLASSES.has(mask.segmentationClass)) {
      result.push(mask);
      continue;
    }

    // Already excluded from geometry (e.g. giant sky mask) — don't double-suppress
    if (mask.excludeFromGeometry === true) {
      result.push(mask);
      continue;
    }

    let suppress = false;
    let reason = '';

    // Rule 1: Sky-overlapping structure mask
    if (skyMasks.length > 0 && !suppress) {
      const maskArea = mask.maskBounds.width * mask.maskBounds.height;
      if (maskArea > 0) {
        let overlapArea = 0;
        for (const sky of skyMasks) {
          // Axis-aligned bounding box intersection
          const xOverlap = Math.max(0,
            Math.min(mask.maskBounds.x + mask.maskBounds.width, sky.maskBounds.x + sky.maskBounds.width)
            - Math.max(mask.maskBounds.x, sky.maskBounds.x),
          );
          const yOverlap = Math.max(0,
            Math.min(mask.maskBounds.y + mask.maskBounds.height, sky.maskBounds.y + sky.maskBounds.height)
            - Math.max(mask.maskBounds.y, sky.maskBounds.y),
          );
          overlapArea += xOverlap * yOverlap;
        }
        const overlapFraction = overlapArea / maskArea;
        if (overlapFraction > MAX_SKY_OVERLAP_FRACTION) {
          suppress = true;
          reason = `sky overlap ${(overlapFraction * 100).toFixed(1)}% > ${MAX_SKY_OVERLAP_FRACTION * 100}%`;
        }
      }
    }

    // Rule 2: Low-confidence structure fragment
    if (!suppress && mask.confidence < MIN_STRUCTURE_CONFIDENCE) {
      suppress = true;
      reason = `confidence ${mask.confidence} < ${MIN_STRUCTURE_CONFIDENCE}`;
    }

    // Rule 3: Tiny disconnected wall fragment
    if (!suppress && mask.segmentationClass === 'wall') {
      const maskArea = mask.maskBounds.width * mask.maskBounds.height;
      if (maskArea < MIN_WALL_MASK_AREA) {
        suppress = true;
        reason = `wall area ${maskArea.toFixed(0)} < ${MIN_WALL_MASK_AREA}`;
      }
    }

    // Rule 4: Roof fragment merged with vegetation
    if (!suppress && mask.segmentationClass === 'roof' && vegetationMasks.length > 0) {
      const maskArea = mask.maskBounds.width * mask.maskBounds.height;
      if (maskArea > 0) {
        let overlapArea = 0;
        for (const veg of vegetationMasks) {
          const xOverlap = Math.max(0,
            Math.min(mask.maskBounds.x + mask.maskBounds.width, veg.maskBounds.x + veg.maskBounds.width)
            - Math.max(mask.maskBounds.x, veg.maskBounds.x),
          );
          const yOverlap = Math.max(0,
            Math.min(mask.maskBounds.y + mask.maskBounds.height, veg.maskBounds.y + veg.maskBounds.height)
            - Math.max(mask.maskBounds.y, veg.maskBounds.y),
          );
          overlapArea += xOverlap * yOverlap;
        }
        const overlapFraction = overlapArea / maskArea;
        if (overlapFraction > MAX_ROOF_VEGETATION_OVERLAP_FRACTION) {
          suppress = true;
          reason = `roof-veg overlap ${(overlapFraction * 100).toFixed(1)}% > ${MAX_ROOF_VEGETATION_OVERLAP_FRACTION * 100}%`;
        }
      }
    }

    // Rule 5: Roof-shaped false positives from overview photos
    if (!suppress && mask.segmentationClass === 'roof') {
      const maskArea = mask.maskBounds.width * mask.maskBounds.height;
      const centerY = mask.maskBounds.y + mask.maskBounds.height / 2;
      const bottomY = mask.maskBounds.y + mask.maskBounds.height;
      const widthToHeight = mask.maskBounds.width / Math.max(mask.maskBounds.height, 1);

      const lowerForegroundLike =
        centerY > 520
        && bottomY > 650
        && mask.maskBounds.y > 300
        && maskArea > 25_000
        && maskArea < 260_000
        && widthToHeight > 1.3;

      const garageDoorLike =
        centerY > 430
        && bottomY > 620
        && mask.maskBounds.y > 300
        && maskArea > 15_000
        && maskArea < 180_000
        && mask.maskBounds.height > 80
        && widthToHeight > 1.15;

      const skyLikeUpperMass =
        mask.maskBounds.y < 120
        && centerY < 360
        && maskArea > 220_000
        && mask.maskBounds.height > 250
        && widthToHeight > 1.2;

      if (lowerForegroundLike || garageDoorLike || skyLikeUpperMass) {
        suppress = true;
        reason = lowerForegroundLike
          ? `lower foreground roof-like mask area=${maskArea.toFixed(0)} centerY=${centerY.toFixed(0)}`
          : garageDoorLike
            ? `garage-door-like roof mask area=${maskArea.toFixed(0)} centerY=${centerY.toFixed(0)}`
            : `upper sky-like roof mask area=${maskArea.toFixed(0)} centerY=${centerY.toFixed(0)}`;
      }
    }

    if (suppress) {
      suppressedCount++;
      console.info(
        `[Pass3E] Weak structure mask suppressed: class=${mask.segmentationClass} id=${mask.id} reason=${reason}`,
      );
      // Suppress: mark as excluded from geometry, set all participation flags to false
      result.push({
        ...mask,
        excludeFromGeometry: true,
        participation: {
          participatesInLines: false,
          participatesInPlanes: false,
          participatesInDepthFusion: false,
          participatesInPhotogrammetry: false,
        },
      });
    } else {
      result.push(mask);
    }
  }

  if (suppressedCount > 0) {
    console.info(
      `[Pass3E] Structure boundary tightening: ${suppressedCount} weak structure masks suppressed out of ${masks.filter(m => STRUCTURE_CANDIDATE_CLASSES.has(m.segmentationClass)).length} structure candidates`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const SEGMENTATION_WORKER_VERSION = '5.4.0-pass3e-containment-participation';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const SEGMENTATION_WORKER_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Segmentation masks are generated by SAM 2.1 Automatic Mask Generation when the SAM2_SERVICE_URL is configured and reachable.',
  'When SAM 2 fails for a photo, NO fallback masks are produced — the failure is reported honestly instead of degrading to Canny edge detection.',
  'Canny edge detection is used as an explicit backend ONLY when SAM2_SERVICE_URL is not configured — it is never a silent fallback.',
  'Polygon outlines are simplified via Douglas-Peucker — approximations of actual mask boundaries.',
  'SAM 2 mask confidence blends predicted IoU (40%) + stability score (60%), scaled to 0-100.',
  'Canny confidence reflects contour-based heuristic certainty, not model prediction quality.',
  'Class hints (roof, wall, sky, etc.) are geometry + position heuristics applied to SAM 2 masks — SAM 2 itself is class-agnostic.',
  'Photos are prioritized by label: roof_plane, roof_edge, ridge, obstructions, roof_surface, overview get SAM 2 first.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the segmentation worker. */
export interface SegmentationWorkerInput {
  surveyId: string;
  sourcePhotos: { fileId: string; fileUrl: string; filename: string | null; label?: string | null }[];
  /** Optional config overrides. */
  config?: {
    /** Minimum confidence threshold for masks (0-100). Default: 30 */
    minConfidence?: number;
    /** Whether to include raw mask data in output. Default: true */
    includeRawMask?: boolean;
    /** Maximum number of polygon points per mask. Default: 50 */
    maxPolygonPoints?: number;
  };
}

// -----------------------------------------------------------------------
// Per-photo segmentation result — honest failure reporting
// -----------------------------------------------------------------------

/** Per-photo status after segmentation attempt. */
export type PhotoSegmentationStatus =
  | 'sam2_success'       // SAM 2 processed this photo successfully
  | 'sam2_failed'        // SAM 2 was attempted but failed (service error, timeout, etc.)
  | 'skipped_budget'     // SAM 2 budget exhausted — this photo was not attempted
  | 'skipped_timeout'    // Stage deadline reached — this photo was not attempted
  | 'skipped_warmup'     // SAM 2 warm-up failed — no photos attempted at all
  | 'skipped_not_configured'; // SAM2_SERVICE_URL not set — Canny-only mode

/** Per-photo segmentation result for honest reporting. */
export interface PhotoSegmentationResult {
  fileId: string;
  filename: string | null;
  label: string | null;
  status: PhotoSegmentationStatus;
  /** Number of masks produced (0 for any non-success status). */
  maskCount: number;
  /** Human-readable reason for failure/skip (null for success). */
  reason: string | null;
}

/** Output of the segmentation worker. */
export interface SegmentationWorkerOutput {
  artifacts: SemanticSegmentationMask[];
  stageTimings: Record<string, number>;
  workerVersion: string;
  /**
   * Pre-fetched image bytes keyed by fileId.
   * Passed to the depth worker to avoid redundant re-fetching
   * (saves ~10-20s per photo on slow Vercel Blob downloads).
   */
  imageBytesMap: Record<string, Buffer>;
  /** Which segmentation backend was used: 'sam2' or 'canny'. */
  backend: 'sam2' | 'canny';
  /** Number of photos processed with SAM 2 successfully. */
  sam2PhotoCount: number;
  /** Number of photos where SAM 2 was attempted but failed. */
  failedPhotoCount: number;
  /** Number of photos skipped (budget exhausted, timeout, warm-up failure, etc.). */
  skippedPhotoCount: number;
  /** Number of photos processed with Canny (only when SAM2 not configured). */
  cannyPhotoCount: number;
  /** SAM 2 model info if available. */
  sam2ModelInfo: {
    modelId: string;
    device: string;
    cudaAvailable: boolean;
    inferenceResolution?: string;
  } | null;
  /** Honest per-photo results — no silent fallbacks. */
  photoResults: PhotoSegmentationResult[];
  /** Why SAM2 budget was exhausted (null if not exhausted). */
  budgetExhaustedReason: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline throughput limits (prevent 504 timeout)
// ---------------------------------------------------------------------------

/**
 * Maximum number of source photos to process.
 * Processing 30+ photos with heavy extraction + 6 downstream stages
 * causes 504 timeouts on Vercel (maxDuration=300s). Capping at 15
 * keeps total pipeline time under 4 minutes while still covering
 * most meaningful angles of a house.
 */
const MAX_SOURCE_PHOTOS = 15;

/**
 * Maximum number of source photos to process with SAM 2.
 * SAM 2 on Render Pro (CPU, 2 vCPU) with tiny+INT8 encoder + rapid-loop decode
 * takes ~22s per photo for ONNX inference at 384px (measured on Render).
 * The tiny+INT8 encoder dominates runtime (~17s, was ~40s with small FP32),
 * decoder is ~4.5s with rapid-loop (was ~11s).
 * With 2-batch concurrency, each batch of 2 photos takes ~22s (parallel).
 * 15 photos / 2 = 8 batches x 22s ~ 172s, plus ~28s overhead ~ 200s total.
 * This fits within Vercel's maxDuration=300s hard limit with 100s buffer.
 *
 * PREVIOUS: MAX_SAM2_PHOTOS=10 with ~45s/photo (small FP32 encoder) ~ 250s.
 * Now with tiny+INT8 encoder (~22s/photo), 15 photos fits in ~200s.
 * User requirement is "minimum 8 to 15" - 15 now fits in 300s.
 */
const MAX_SAM2_PHOTOS = 15;

/**
 * Maximum total segmentation masks to produce across ALL photos.
 * With 12 regions per photo × 15 photos = 180 theoretical max,
 * but classification filtering reduces this. Hard cap prevents
 * downstream stages (line extraction, plane extraction, etc.) from
 * exploding into thousands of artifacts.
 *
 * Each photo produces ~8-12 roof-relevant masks after filtering,
 * so 15 photos × 12 = 180 roof-relevant masks (after filtering).
 * 300 gives headroom for edge cases without risking downstream explosion.
 */
const MAX_TOTAL_MASKS = 300;

// Inline execution still needs a Vercel-safe segmentation cap. The Render
// background worker gets a longer cap through getSegmentationStageTimeoutMs().
type EnvRecord = Record<string, string | undefined>;

const DEFAULT_INLINE_SEGMENTATION_STAGE_TIMEOUT_MS = 260_000;
const DEFAULT_BACKGROUND_SEGMENTATION_STAGE_TIMEOUT_MS = 600_000;
const MIN_SAM2_PHOTO_REMAINING_MS = 50_000;

function parsePositiveDurationMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isGeometryBackgroundWorkerRuntime(env: EnvRecord = process.env): boolean {
  const workerFlag = env.GEOMETRY_RECONSTRUCTION_WORKER?.toLowerCase();
  const serviceName = env.RENDER_SERVICE_NAME?.toLowerCase() ?? '';
  const workerId = env.WORKER_ID?.toLowerCase() ?? '';

  return (
    workerFlag === 'true' ||
    workerFlag === '1' ||
    serviceName === 'geometry-reconstruction-worker' ||
    workerId.startsWith('render-worker-')
  );
}

/**
 * Maximum wall-clock time for segmentation.
 *
 * Inline execution keeps the 260s cap so Vercel fallback requests still leave
 * room for downstream stages. Render background workers get a longer default
 * because real SAM2 batches can exceed the earlier estimate.
 */
export function getSegmentationStageTimeoutMs(env: EnvRecord = process.env): number {
  return (
    parsePositiveDurationMs(env.GEOMETRY_SEGMENTATION_STAGE_TIMEOUT_MS) ??
    (isGeometryBackgroundWorkerRuntime(env)
      ? DEFAULT_BACKGROUND_SEGMENTATION_STAGE_TIMEOUT_MS
      : DEFAULT_INLINE_SEGMENTATION_STAGE_TIMEOUT_MS)
  );
}

const SEGMENTATION_STAGE_TIMEOUT_MS = getSegmentationStageTimeoutMs();

/**
 * Photo labels that get SAM 2 priority. These are roof-domain and
 * site-overview labels that produce the most valuable segmentation
 * masks for geometry reconstruction. Photos with these labels are
 * processed with SAM 2 first; remaining photos are skipped (not Canny).
 *
 * Priority order: roof_plane > roof_edge > ridge > obstructions >
 * roof_surface > overview. Within the same priority level, photos
 * are processed in their original order.
 */
const SAM2_PRIORITY_LABELS: readonly string[] = [
  'roof_plane',
  'roof_edge',
  'ridge',
  'obstructions',
  'roof_surface',
  'overview',
];

/**
 * Compute a sort priority for a photo label. Lower number = higher priority.
 * Labels in SAM2_PRIORITY_LABELS get their index position (0-5).
 * Unlabeled or unrecognized labels get priority 99 (lowest).
 */
function sam2PhotoPriority(label: string | null | undefined): number {
  if (!label) return 99;
  const idx = SAM2_PRIORITY_LABELS.indexOf(label);
  return idx >= 0 ? idx : 99;
}


/** Maps ContourClassification from the extractor to SegmentationClass. */
const CONTOUR_TO_SEGMENTATION_CLASS: Record<ContourClassification, SegmentationClass | null> = {
  // Legacy
  probable_roof_plane: 'roof',
  probable_wall_plane: 'wall',
  probable_obstruction: 'obstruction',
  probable_equipment: 'equipment',
  probable_ground_noise: 'ground',
  probable_sky_region: 'sky',
  // Facade
  probable_siding: 'siding',
  probable_window: 'window',
  probable_door: 'door',
  probable_garage_door: 'garage_door',
  probable_gutter: 'gutter',
  probable_downspout: 'downspout',
  probable_porch: 'porch',
  probable_deck: 'deck',
  // Site context
  probable_driveway: 'driveway',
  probable_fence: 'fence',
  probable_bushes: 'bushes',
  // Electrical/solar
  probable_ac_unit: 'ac_unit',
  probable_utility_meter: 'utility_meter',
  probable_existing_solar: 'existing_solar_panel',
  // Occluder
  probable_vehicle: 'car',
  probable_person: 'person',
  // Condition
  probable_moss: 'moss',
  probable_damaged_area: 'damaged_siding',
  // Catch-all
  unknown: null, // Skip unknown classifications
  // Phase 0 (P0-8.3): Canny fallback routes unclassifiable contours to
  // 'background' instead of 'probable_roof_plane' when PHASE0_CANNY_BACKGROUND_FIX
  // is enabled. Background masks are created but excluded from Pipeline B.
  background: 'background',
};

// ---------------------------------------------------------------------------
// Sub-stage checkpoint — persists artifacts after each SAM2 batch
// ---------------------------------------------------------------------------

/**
 * Sub-stage checkpoint emitted after each batch of photos is processed
 * during the segmentation stage. This enables incremental persistence
 * of segmentation masks before the entire stage completes.
 *
 * Without sub-stage checkpoints, the P0 checkpoint system fires only
 * AFTER segmentation completes — but segmentation itself takes 200-440s,
 * so if the process dies mid-segmentation, zero artifacts survive.
 * With sub-stage checkpoints, each batch of 2 photos (~20-40s) produces
 * artifacts that are persisted immediately.
 *
 * P1 — Execution Architecture: Render Background Worker
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */
export interface SegmentationBatchCheckpoint {
  /** Which batch this is (0-indexed). */
  batchIndex: number;
  /** Total photos in this batch. */
  batchSize: number;
  /** Artifacts produced by this batch only. */
  batchArtifacts: SemanticSegmentationMask[];
  /** All artifacts accumulated so far across all batches. */
  allArtifacts: SemanticSegmentationMask[];
  /** Photos successfully processed so far. */
  photosProcessed: number;
  /** Total photos to process. */
  photosTotal: number;
  /** Elapsed time since segmentation stage start in ms. */
  elapsedMs: number;
}

/**
 * Callback invoked after each SAM2 batch completes during segmentation.
 * Used for sub-stage checkpoint persistence — the caller can persist
 * batch artifacts to DB immediately, ensuring no work is lost if the
 * process is killed during the long-running segmentation stage.
 *
 * The callback is best-effort: if it throws, the segmentation worker
 * logs the error but continues processing. Checkpoint failures must NOT
 * abort the segmentation stage.
 */
export type SegmentationBatchCallback = (
  checkpoint: SegmentationBatchCheckpoint,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Main worker function (async — uses sharp for real extraction)
// ---------------------------------------------------------------------------

/**
 * Run the segmentation worker on a set of survey photos.
 *
 * For each source photo:
 * 1. Try SAM 2 Automatic Mask Generation (if SAM2_SERVICE_URL is configured)
 * 2. If SAM 2 succeeds → produce SAM2 masks (emerald green in overlay)
 * 3. If SAM 2 fails → produce NO masks, record honest failure reason
 * 4. If SAM 2 budget exhausted → skip photo, record skip reason
 * 5. If SAM2_SERVICE_URL not configured → use Canny (explicit backend)
 *
 * DESIGN PHILOSOPHY: No silent fallback to Canny. If SAM2 fails, the user
 * sees "FAILED" — not garbage Canny visuals pretending to be real segmentation.
 * Canny is only used as an explicit backend when SAM2 is not configured at all.
 */
export async function runSegmentationWorker(
  input: SegmentationWorkerInput,
  batchCallback?: SegmentationBatchCallback,
): Promise<SegmentationWorkerOutput> {
  const timings: Record<string, number> = {};
  const artifacts: SemanticSegmentationMask[] = [];
  const photoResults: PhotoSegmentationResult[] = [];
  const imageBytesMap: Record<string, Buffer> = {};
  let sam2PhotoCount = 0;
  let failedPhotoCount = 0;
  let skippedPhotoCount = 0;
  let cannyPhotoCount = 0;
  let sam2ModelInfo: SegmentationWorkerOutput['sam2ModelInfo'] = null;

  const minConfidence = input.config?.minConfidence ?? 30;
  const includeRawMask = input.config?.includeRawMask ?? true;
  const maxPolygonPoints = input.config?.maxPolygonPoints ?? 50;
  // SAM 2 masks retain more polygon detail because the model produces
  // accurate segment boundaries — Canny contours are lower quality and
  // benefit from aggressive simplification. Higher polygon point counts
  // preserve the precise mask boundaries needed for line extraction:
  // the line extraction worker classifies polygon EDGES as ridges/eaves/rakes,
  // so more detailed polygons → more accurate structural lines.
  const sam2MaxPolygonPoints = Math.max(maxPolygonPoints, 200);

  const sam2Enabled = isSAM2Enabled();

  // Stage 1: Initialize and validate input
  const t0 = Date.now();
  const rawPhotos = input.sourcePhotos.slice(0, MAX_SOURCE_PHOTOS);
  if (rawPhotos.length === 0) {
    timings['initialization'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: SEGMENTATION_WORKER_VERSION,
      imageBytesMap: {},
      backend: sam2Enabled ? 'sam2' : 'canny',
      sam2PhotoCount: 0,
      failedPhotoCount: 0,
      skippedPhotoCount: 0,
      cannyPhotoCount: 0,
      sam2ModelInfo: null,
      photoResults: [],
      budgetExhaustedReason: null,
    };
  }

  // ── SAM 2 PRIORITY SORT ─────────────────────────────────────────
  // Sort photos so that roof-domain labels (roof_plane, roof_edge, etc.)
  // are processed first with SAM 2. This ensures the limited SAM2 budget
  // (MAX_SAM2_PHOTOS=10) is spent on the most valuable photos for geometry
  // reconstruction rather than arbitrary upload-order photos.
  //
  // The sort is stable: photos with the same priority keep their original
  // relative order. Unlabeled photos go to the end.
  const sourcePhotos = [...rawPhotos].sort((a, b) => {
    const pa = sam2PhotoPriority(a.label);
    const pb = sam2PhotoPriority(b.label);
    return pa - pb;
  });

  if (sam2Enabled) {
    const labeledCount = sourcePhotos.filter((p) => sam2PhotoPriority(p.label) < 99).length;
    const roofLabels = sourcePhotos
      .filter((p) => sam2PhotoPriority(p.label) < 99)
      .map((p) => `${p.label}(${p.fileId.slice(0, 8)})`);
    console.info(
      `[SAM2] Photo priority sort: ${sourcePhotos.length} photos — ${labeledCount} with priority labels [${roofLabels.join(', ')}], ${sourcePhotos.length - labeledCount} unlabeled/other. First ${Math.min(MAX_SAM2_PHOTOS, sourcePhotos.length)} photos will get SAM 2.`,
    );
  }

  // ── SAM 2 TIME BUDGET (declared early for use in warm-up + Stage 2) ────────
  let sam2BudgetRemaining = sam2Enabled ? MAX_SAM2_PHOTOS : 0;
  let sam2BudgetExhaustedReason: string | null = null;

  // Log which backend will be attempted
  if (sam2Enabled) {
    console.info(`[SAM2] Segmentation worker: SAM 2 enabled — will warm up service then process photos`);

    // ── CRITICAL: Wait for SAM2 model to load before processing photos ────
    // On Render cold starts, the SAM2 service downloads the model from HuggingFace
    // and loads it into memory. During this time, ALL /segment requests return 502.
    // By polling /health until model_loaded=true, we ensure the model is warm
    // before we send real segmentation requests.
    //
    // The warm-up ping (sent earlier from the route handler) triggers model loading.
    // This poll confirms it's ready. If the service was already warm, this returns
    // immediately (~100ms). If cold, it waits up to 60s for the model to load.
    //
    // IMPORTANT: We cap warm-up at 60s to leave time for actual
    // photo processing within the 260s SEGMENTATION_STAGE_TIMEOUT_MS budget.
    // If warm-up exceeds 120s, ALL photos are skipped — no Canny, honest failure.
    const warmupDeadline = t0 + 60_000; // 60s from pipeline start — Pro plan model is cached after first load
    const warmupResult = await waitForSAM2Warm(warmupDeadline);
    if (warmupResult) {
      console.info(
        `[SAM2] Service is WARM — model_loaded=true, device=${warmupResult.device}, model_id=${warmupResult.model_id}`,
      );
    } else {
      console.warn(
        `[SAM2] Service warm-up timed out — ALL photos skipped, no masks will be produced`,
      );
      sam2BudgetRemaining = 0;
      sam2BudgetExhaustedReason = 'warmup_timeout';
    }
  } else {
    console.info(`[SAM2] Segmentation worker: SAM 2 not configured — using Canny as explicit backend`);
  }
  timings['initialization'] = Date.now() - t0;

  // ── If warm-up failed, record ALL photos as skipped and return early ──
  if (sam2Enabled && sam2BudgetExhaustedReason === 'warmup_timeout') {
    for (const photo of sourcePhotos) {
      photoResults.push({
        fileId: photo.fileId,
        filename: photo.filename ?? null,
        label: photo.label ?? null,
        status: 'skipped_warmup',
        maskCount: 0,
        reason: 'SAM 2 service warm-up timed out after 120s — no segmentation possible',
      });
      skippedPhotoCount++;
    }
    timings['mask_generation'] = 0;
    console.warn(
      `[SAM2] Segmentation stage: ALL ${sourcePhotos.length} photos skipped — SAM2 warm-up failed`,
    );
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: SEGMENTATION_WORKER_VERSION,
      imageBytesMap: {},
      backend: 'sam2',
      sam2PhotoCount: 0,
      failedPhotoCount: 0,
      skippedPhotoCount,
      cannyPhotoCount: 0,
      sam2ModelInfo: null,
      photoResults,
      budgetExhaustedReason: sam2BudgetExhaustedReason,
    };
  }

  // Stage 2: Extract geometry from each photo
  // ── SAM 2 CONCURRENT BATCH PROCESSING ────────────────────────────
  // SAM 2 on Render Pro (CPU, 2 vCPU) with rapid-loop decode takes ~16-20s
  // per photo for ONNX inference at 384px (points_per_side=8).
  // The SAM2 service uses ThreadPoolExecutor(max_workers=2), so it CAN
  // process 2 inference requests concurrently. With 4GB RAM on Pro,
  // 2 concurrent ONNX small-model inferences at 384px use ~3GB total.
  //
  // Strategy: process photos in concurrent batches of 2, sending both
  // SAM2 requests simultaneously. This halves the wall-clock time for
  // the segmentation stage: 15 photos ÷ 2 concurrency = 8 batches × ~20s
  // = ~160s total (fits within the 260s SEGMENTATION_STAGE_TIMEOUT_MS).
  //
  // Without concurrency: 15 × 20s = 300s (exceeds 260s stage timeout).
  // With 2x concurrency: 15 ÷ 2 × 20s ≈ 160s (fits with 100s buffer).
  //
  // If SAM2 fails for a photo → NO masks, record honest failure.
  // If SAM2 budget exhausted → skip remaining photos, record skip reason.
  // If SAM2 not configured → use Canny as explicit backend (not fallback).
  // Also enforce a wall-clock deadline: if we've spent too long, skip the rest.
  const SEGMENTATION_CONCURRENCY = 2; // Match SAM2 service ThreadPoolExecutor max_workers
  const segmentationDeadline = t0 + SEGMENTATION_STAGE_TIMEOUT_MS;

  const t1 = Date.now();

  // ── Helper: process a single photo with SAM2 ──────────────────────────
  // Extracted from the old sequential loop so we can call it concurrently.
  // Returns the photo result + any artifacts produced + image bytes.
  interface PhotoProcessResult {
    photoResult: PhotoSegmentationResult;
    newArtifacts: SemanticSegmentationMask[];
    imageBytes: Buffer | null;
    budgetUsed: number;  // 1 if SAM2 was attempted (success or fail), 0 if skipped
    sam2ModelInfoCandidate: SegmentationWorkerOutput['sam2ModelInfo'];
  }

  async function processSAM2Photo(
    photo: { fileId: string; fileUrl: string; filename: string | null; label?: string | null },
  ): Promise<PhotoProcessResult> {
    const remainingMs = segmentationDeadline - Date.now();
    const useSAM2 = sam2Enabled && sam2BudgetRemaining > 0 && remainingMs > MIN_SAM2_PHOTO_REMAINING_MS;

    if (!useSAM2 && sam2Enabled && sam2BudgetRemaining <= 0 && !sam2BudgetExhaustedReason) {
      sam2BudgetExhaustedReason = 'max_photos_reached';
      return {
        photoResult: {
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: 'skipped_budget',
          maskCount: 0,
          reason: `SAM 2 budget exhausted (${MAX_SAM2_PHOTOS} photos already processed) — not attempted`,
        },
        newArtifacts: [],
        imageBytes: null,
        budgetUsed: 0,
        sam2ModelInfoCandidate: null,
      };
    }

    if (!useSAM2 && sam2Enabled && sam2BudgetExhaustedReason) {
      return {
        photoResult: {
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: sam2BudgetExhaustedReason.startsWith('stage_timeout') ? 'skipped_timeout' : 'skipped_budget',
          maskCount: 0,
          reason: `SAM 2 skipped: ${sam2BudgetExhaustedReason}`,
        },
        newArtifacts: [],
        imageBytes: null,
        budgetUsed: 0,
        sam2ModelInfoCandidate: null,
      };
    }

    if (!sam2Enabled) {
      // CANNY EXPLICIT BACKEND (SAM2 not configured)
      try {
        cannyPhotoCount++;
        const geometry = await extractGeometryFromPhoto(photo.fileUrl);
        let contourIndex = 0;
        const newArtifacts: SemanticSegmentationMask[] = [];
        for (const contour of geometry.contours) {
          const segmentationClass = CONTOUR_TO_SEGMENTATION_CLASS[contour.classification];
          if (segmentationClass === null) continue;

          // Phase 0 (P0-8.3): background masks from Canny bypass minConfidence
          // filter — they exist for overlay display and review, not for pipeline
          // processing. Their confidence (20) is intentionally below the default
          // minConfidence (30) to prevent them from entering geometry stages.
          const isBackground = segmentationClass === 'background';
          if (!isBackground && contour.confidence < minConfidence) continue;
          const polygon = contourToNormalizedPolygon(contour, geometry.extractionSize, geometry.extractionSize);
          const truncatedPolygon = polygon.slice(0, maxPolygonPoints);
          const maskBounds = computeMaskBounds(truncatedPolygon);
          // Pass 3E — compute geometry participation flags, sky containment, vegetation containment
          const geoParticipation = computeGeometryParticipation(segmentationClass, maskBounds, geometry.extractionSize, geometry.extractionSize);
          const mask: SemanticSegmentationMask = {
            artifactType: 'semantic_segmentation_mask',
            id: `seg-${photo.fileId}-${segmentationClass}-${contourIndex}-${SEGMENTATION_WORKER_VERSION}`,
            fileId: photo.fileId,
            segmentationClass,
            polygon: truncatedPolygon,
            confidence: contour.confidence,
            maskBounds,
            workerVersion: SEGMENTATION_WORKER_VERSION,
            authority: { ...REVIEW_ONLY_AUTHORITY },
            limitations: [...SEGMENTATION_WORKER_LIMITATIONS],
            isOccluder: OCCLUDER_SEGMENTATION_CLASSES.has(segmentationClass) || null,
            participation: geoParticipation.participation,
            excludeFromGeometry: geoParticipation.excludeFromGeometry || null,
            isVegetation: geoParticipation.isVegetation || null,
          };
          if (includeRawMask) {
            mask.rawMask = `canny-contour-${segmentationClass}-area${contour.area}`;
            mask.maskWidth = geometry.extractionSize;
            mask.maskHeight = geometry.extractionSize;
          }
          const validationResult = validateSemanticSegmentationMask(mask);
          if (validationResult.valid) {
            newArtifacts.push(validationResult.data);
          }
          contourIndex++;
        }
        return {
          photoResult: {
            fileId: photo.fileId,
            filename: photo.filename ?? null,
            label: photo.label ?? null,
            status: 'skipped_not_configured',
            maskCount: newArtifacts.length,
            reason: 'SAM 2 not configured (SAM2_SERVICE_URL not set) — Canny backend used',
          },
          newArtifacts,
          imageBytes: null,
          budgetUsed: 0,
          sam2ModelInfoCandidate: null,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        return {
          photoResult: {
            fileId: photo.fileId,
            filename: photo.filename ?? null,
            label: photo.label ?? null,
            status: 'sam2_failed',
            maskCount: 0,
            reason: `Unhandled error: ${errMsg}`,
          },
          newArtifacts: [],
          imageBytes: null,
          budgetUsed: 0,
          sam2ModelInfoCandidate: null,
        };
      }
    }

    // ── SAM 2 PATH ──
    console.info(
      `[SAM2] Processing photo ${photo.fileId} (${photo.filename ?? 'unnamed'}, label=${photo.label ?? 'none'}) — attempting SAM 2 (budget=${sam2BudgetRemaining} remaining, ${Math.round(remainingMs / 1000)}s left)`,
    );

    try {
      const sam2FromPhotoResult = await segmentWithSAM2FromPhoto(photo.fileUrl);
      let imageBytes: Buffer | null = null;
      if (sam2FromPhotoResult !== null) {
        imageBytes = sam2FromPhotoResult.imageBytes;
      }

      if (sam2FromPhotoResult !== null && sam2FromPhotoResult.sam2Result !== null) {
        // ── SAM 2 SUCCESS — produce masks ──
        const sam2Result = sam2FromPhotoResult.sam2Result;
        let masksProduced = 0;
        let filteredNonRoof = 0;
        const newArtifacts: SemanticSegmentationMask[] = [];

        for (const mask of sam2Result.masks) {
          const segmentationClass = mapSAM2ClassHint(mask.classHint);
          if (segmentationClass === null) continue;

          // Phase 0 (P0-8.2): background masks are created for overlay display
          // and review but are excluded from Pipeline B geometry processing.
          // When PHASE0_BACKGROUND_CLASS is OFF, unknown hints return null and
          // the mask is skipped entirely (continue above). When ON, they return
          // 'background' and computeGeometryParticipation() assigns
          // excludeFromGeometry: true, which the artifact stores via
          // geoParticipation.excludeFromGeometry || null.
          const isBackground = segmentationClass === 'background';

          if (!SOLAR_RELEVANT_SEGMENTATION_CLASSES.has(segmentationClass) && !isBackground) {
            filteredNonRoof++;
            continue;
          }

          if (mask.confidence < minConfidence) continue;

          const truncatedPolygon = mask.polygon.slice(0, sam2MaxPolygonPoints);
          const maskBounds = computeMaskBounds(truncatedPolygon);

          // Pass 3E — compute geometry participation flags, sky containment, vegetation containment
          const geoParticipation = computeGeometryParticipation(segmentationClass, maskBounds, sam2Result.imageWidth, sam2Result.imageHeight);
          const artifact: SemanticSegmentationMask = {
            artifactType: 'semantic_segmentation_mask',
            id: `seg-${photo.fileId}-${segmentationClass}-${mask.maskIndex}-${SEGMENTATION_WORKER_VERSION}`,
            fileId: photo.fileId,
            segmentationClass,
            polygon: truncatedPolygon,
            confidence: mask.confidence,
            maskBounds,
            workerVersion: SEGMENTATION_WORKER_VERSION,
            authority: { ...REVIEW_ONLY_AUTHORITY },
            limitations: [...SEGMENTATION_WORKER_LIMITATIONS],
            isOccluder: OCCLUDER_SEGMENTATION_CLASSES.has(segmentationClass) || null,
            participation: geoParticipation.participation,
            excludeFromGeometry: geoParticipation.excludeFromGeometry || null,
            isVegetation: geoParticipation.isVegetation || null,
          };

          if (includeRawMask) {
            artifact.rawMask = `sam2-${segmentationClass}-area${Math.round(mask.area)}-stability${mask.stabilityScore}`;
            artifact.maskWidth = sam2Result.imageWidth;
            artifact.maskHeight = sam2Result.imageHeight;
          }

          const validationResult = validateSemanticSegmentationMask(artifact);
          if (validationResult.valid) {
            newArtifacts.push(validationResult.data);
            masksProduced++;
          }
        }

        console.info(
          `[SAM2] Photo ${photo.fileId} (${photo.label ?? 'unlabeled'}): SAM 2 SUCCESS — ${masksProduced} masks (filtered ${filteredNonRoof} non-roof)`,
        );
        return {
          photoResult: {
            fileId: photo.fileId,
            filename: photo.filename ?? null,
            label: photo.label ?? null,
            status: 'sam2_success',
            maskCount: masksProduced,
            reason: null,
          },
          newArtifacts,
          imageBytes,
          budgetUsed: 1,
          sam2ModelInfoCandidate: sam2Result.modelInfo,
        };
      }

      // ── SAM 2 FAILED — NO fallback to Canny. Record honest failure. ──
      console.warn(
        `[SAM2] Photo ${photo.fileId} (${photo.label ?? 'unlabeled'}): SAM 2 FAILED — no masks produced for this photo`,
      );
      return {
        photoResult: {
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: 'sam2_failed',
          maskCount: 0,
          reason: 'SAM 2 service call failed — no masks produced',
        },
        newArtifacts: [],
        imageBytes,
        budgetUsed: 1, // Budget was consumed even though it failed
        sam2ModelInfoCandidate: null,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[SAM2] Photo ${photo.fileId}: UNHANDLED ERROR — ${errMsg}`);
      return {
        photoResult: {
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: 'sam2_failed',
          maskCount: 0,
          reason: `Unhandled error: ${errMsg}`,
        },
        newArtifacts: [],
        imageBytes: null,
        budgetUsed: 1,
        sam2ModelInfoCandidate: null,
      };
    }
  }

  // ── CONCURRENT BATCH PROCESSING ────────────────────────────────────────
  // Process photos in batches of SEGMENTATION_CONCURRENCY (2) to overlap
  // image fetch + SAM2 inference between pairs of photos.
  // The SAM2 service has ThreadPoolExecutor(max_workers=2) so it can
  // process 2 requests concurrently — both requests are sent at the same
  // time, and both run inference in parallel on the service side.
  let photoIndex = 0;
  let batchIndex = 0;
  while (photoIndex < sourcePhotos.length) {
    // Check global limits before starting a new batch
    if (artifacts.length >= MAX_TOTAL_MASKS) {
      console.info(
        `Segmentation worker: reached MAX_TOTAL_MASKS=${MAX_TOTAL_MASKS}, stopping after ${artifacts.length} masks`,
      );
      // Record remaining unprocessed photos as skipped
      for (let i = photoIndex; i < sourcePhotos.length; i++) {
        const photo = sourcePhotos[i];
        photoResults.push({
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: 'skipped_budget',
          maskCount: 0,
          reason: `MAX_TOTAL_MASKS reached (${MAX_TOTAL_MASKS}) — not attempted`,
        });
        skippedPhotoCount++;
      }
      break;
    }

    // Check segmentation stage deadline
    const remainingMs = segmentationDeadline - Date.now();
    if (sam2Enabled && remainingMs <= MIN_SAM2_PHOTO_REMAINING_MS && !sam2BudgetExhaustedReason) {
      const elapsedMs = Date.now() - t1;
      console.warn(
        `[SAM2] Segmentation stage TIMEOUT after ${elapsedMs}ms — skipping remaining photos`,
      );
      sam2BudgetRemaining = 0;
      sam2BudgetExhaustedReason = `stage_timeout_after_${elapsedMs}ms`;
      // Record remaining unprocessed photos as skipped
      for (let i = photoIndex; i < sourcePhotos.length; i++) {
        const photo = sourcePhotos[i];
        photoResults.push({
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: 'skipped_timeout',
          maskCount: 0,
          reason: `SAM 2 stage timeout after ${elapsedMs}ms — not attempted`,
        });
        skippedPhotoCount++;
      }
      break;
    }

    // Determine batch size: min(concurrency, remaining photos, remaining budget)
    const batchSize = Math.min(
      SEGMENTATION_CONCURRENCY,
      sourcePhotos.length - photoIndex,
      sam2Enabled ? sam2BudgetRemaining : sourcePhotos.length - photoIndex,
    );

    if (batchSize <= 0) {
      // No budget left — record remaining photos as skipped
      for (let i = photoIndex; i < sourcePhotos.length; i++) {
        const photo = sourcePhotos[i];
        if (!sam2BudgetExhaustedReason) {
          sam2BudgetExhaustedReason = 'max_photos_reached';
        }
        photoResults.push({
          fileId: photo.fileId,
          filename: photo.filename ?? null,
          label: photo.label ?? null,
          status: sam2BudgetExhaustedReason.startsWith('stage_timeout') ? 'skipped_timeout' : 'skipped_budget',
          maskCount: 0,
          reason: `SAM 2 skipped: ${sam2BudgetExhaustedReason}`,
        });
        skippedPhotoCount++;
      }
      break;
    }

    // Get the batch of photos
    const batch = sourcePhotos.slice(photoIndex, photoIndex + batchSize);

    if (batch.length > 1) {
      console.info(
        `[SAM2] Starting concurrent batch of ${batch.length} photos (budget=${sam2BudgetRemaining} remaining, ${Math.round(remainingMs / 1000)}s left)`,
      );
    }

    // Process the batch concurrently using Promise.all
    const batchResults = await Promise.all(
      batch.map((photo) => processSAM2Photo(photo)),
    );

    // Integrate results from the batch
    for (const result of batchResults) {
      photoResults.push(result.photoResult);

      // Update budget
      sam2BudgetRemaining -= result.budgetUsed;

      // Update counts
      if (result.photoResult.status === 'sam2_success') {
        sam2PhotoCount++;
        if (result.sam2ModelInfoCandidate && !sam2ModelInfo) {
          sam2ModelInfo = result.sam2ModelInfoCandidate;
        }
      } else if (result.photoResult.status === 'sam2_failed') {
        failedPhotoCount++;
      } else if (result.photoResult.status.startsWith('skipped_')) {
        skippedPhotoCount++;
      }

      // Collect artifacts (respecting MAX_TOTAL_MASKS)
      for (const artifact of result.newArtifacts) {
        if (artifacts.length < MAX_TOTAL_MASKS) {
          artifacts.push(artifact);
        }
      }

      // Store image bytes for depth worker
      if (result.imageBytes !== null) {
        imageBytesMap[result.photoResult.fileId] = result.imageBytes;
      }
    }

    // ── Sub-stage checkpoint: persist batch artifacts immediately ──────────
    // P1 — Each SAM2 batch takes ~20-40s. Without this checkpoint, if the
    // process is killed mid-segmentation, all artifacts from completed
    // batches are lost. With this, artifacts from each batch survive.
    if (batchCallback && artifacts.length > 0) {
      try {
        await batchCallback({
          batchIndex,
          batchSize: batch.length,
          batchArtifacts: batchResults.flatMap((r) => r.newArtifacts),
          allArtifacts: [...artifacts],
          photosProcessed: photoIndex + batch.length,
          photosTotal: sourcePhotos.length,
          elapsedMs: Date.now() - t1,
        });
      } catch (callbackErr) {
        const cbMsg = callbackErr instanceof Error ? callbackErr.message : String(callbackErr);
        console.warn(
          `[SAM2] Sub-stage checkpoint failed for batch=${batchIndex}: ${cbMsg} (non-fatal)`,
        );
      }
    }

    photoIndex += batch.length;
    batchIndex++;
  }

  // Record mask_generation timing (t1 was set at start of Stage 2)
  timings['mask_generation'] = Date.now() - t1;

  // Log segmentation summary — honest counts
  const backend = sam2Enabled ? 'sam2' : 'canny';
  console.info(
    `[SAM2] Segmentation stage complete: ${artifacts.length} masks in ${timings['mask_generation']}ms — backend=${backend} sam2_success=${sam2PhotoCount} failed=${failedPhotoCount} skipped=${skippedPhotoCount} canny=${cannyPhotoCount} out of ${sourcePhotos.length} total${sam2BudgetExhaustedReason ? ` (budget_exhausted: ${sam2BudgetExhaustedReason})` : ''}`,
  );

  // Stage 4: Post-validation pass
  const t2 = Date.now();
  const validatedArtifacts = artifacts.filter((artifact) => {
    const result = validateSemanticSegmentationMask(artifact);
    return result.valid;
  });
  timings['validation'] = Date.now() - t2;

  // Stage 5: Structure boundary tightening — Pass 3E Task D
  // Suppress weak structure masks (sky-overlapping, low-confidence, tiny,
  // vegetation-merged) so they don't feed downstream geometry stages.
  const t3 = Date.now();
  const tightenedArtifacts = suppressWeakStructureMasks(validatedArtifacts);
  timings['boundary_tightening'] = Date.now() - t3;

  return {
    artifacts: tightenedArtifacts,
    stageTimings: timings,
    workerVersion: SEGMENTATION_WORKER_VERSION,
    imageBytesMap,
    backend: sam2PhotoCount > 0 ? 'sam2' : (cannyPhotoCount > 0 ? 'canny' : 'sam2'),
    sam2PhotoCount,
    failedPhotoCount,
    skippedPhotoCount,
    cannyPhotoCount,
    sam2ModelInfo,
    photoResults,
    budgetExhaustedReason: sam2BudgetExhaustedReason,
  };
}

// ---------------------------------------------------------------------------
// URL helper for logging (avoids logging full URLs with tokens)
// ---------------------------------------------------------------------------

/**
 * Extract the hostname from a URL for safe logging.
 * Returns the full URL string if parsing fails.
 */
function tryExtractHost(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url.slice(0, 80);
  }
}

// ---------------------------------------------------------------------------
// Geometry extraction helpers
// ---------------------------------------------------------------------------

/** Result from segmentWithSAM2FromPhoto — includes pre-fetched image bytes for reuse by depth worker. */
interface SAM2FromPhotoResult {
  sam2Result: import('./sam2Client').SAM2SegmentationResult;
  /** Raw image bytes fetched from URL — reuse for MiDaS depth to avoid re-download. */
  imageBytes: Buffer;
}

/**
 * Extract geometry from a photo URL using the SAM 2 service.
 * Fetches image bytes, sends them to SAM 2, and returns the result
 * alongside the raw image bytes (for reuse by the depth worker).
 * Returns null if SAM 2 is unavailable or fails — caller records honest failure.
 */
async function segmentWithSAM2FromPhoto(
  fileUrl: string,
): Promise<SAM2FromPhotoResult | null> {
  const t0 = Date.now();
  const urlHost = tryExtractHost(fileUrl);

  try {
    // Fetch image bytes
    console.info(`[SAM2] Image fetch: START — ${urlHost} (timeout=30s)`);
    const response = await fetch(fileUrl, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const fetchElapsedMs = Date.now() - t0;
      console.warn(
        `[SAM2] Image fetch: FAILED — HTTP ${response.status} in ${fetchElapsedMs}ms from ${urlHost}`,
      );
      throw new Error(`Failed to fetch image: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const fetchElapsedMs = Date.now() - t0;
    console.info(
      `[SAM2] Image fetch: OK — ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)}KB) in ${fetchElapsedMs}ms from ${urlHost}`,
    );

    // Call SAM 2 service (with 502/503 retry built in)
    // Use min_area_fraction=0.005 (matching the Python env var SAM2_MIN_MASK_AREA_FRACTION).
    // Previously hardcoded to 0.02, which filtered out legitimate small roof masks
    // (e.g. a dormer or shed roof occupying 1-3% of the image). The Python side
    // already filters at 0.005, so double-filtering at 0.02 on the TS side was
    // discarding valid masks. The roof_only=true param is set in sam2Client.ts
    // to filter non-roof masks on the Python side.
    const sam2Result = await segmentWithSAM2(bytes, 0.005, 30);
    const totalElapsedMs = Date.now() - t0;

    if (sam2Result !== null) {
      console.info(
        `[SAM2] Photo pipeline: SUCCESS — ${sam2Result.masks.length} masks, total=${totalElapsedMs}ms (fetch=${fetchElapsedMs}ms, service=${sam2Result.processingTimeMs}ms)`,
      );
      // ── Instrumentation logging (Pass 1 tuning) ──
      if (sam2Result.filterImpact) {
        const fi = sam2Result.filterImpact;
        console.info(
          `[SAM2] Filter impact: raw=${fi.raw_masks ?? '?'} area=${fi.removed_by_area ?? 0} poly=${fi.removed_by_polygon_points ?? 0} roof_only=${fi.removed_by_roof_only ?? 0} max=${fi.removed_by_max_masks ?? 0} → ${fi.remaining ?? sam2Result.masks.length}`,
        );
      }
      if (sam2Result.filteredMasksMetadata && sam2Result.filteredMasksMetadata.length > 0) {
        const filteredClasses: Record<string, number> = {};
        for (const fm of sam2Result.filteredMasksMetadata) {
          filteredClasses[fm.class_hint] = (filteredClasses[fm.class_hint] ?? 0) + 1;
        }
        console.info(
          `[SAM2] Filtered mask metadata: ${sam2Result.filteredMasksMetadata.length} removed — ${JSON.stringify(filteredClasses)}`,
        );
      }
      return { sam2Result, imageBytes: bytes };
    } else {
      console.warn(
        `[SAM2] Photo pipeline: SAM2 service returned null after ${totalElapsedMs}ms (fetch=${fetchElapsedMs}ms) — recording honest failure`,
      );
      // Still return the image bytes for depth worker reuse even if SAM2 failed
      return { sam2Result, imageBytes: bytes };
    }
  } catch (error) {
    const elapsedMs = Date.now() - t0;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    console.warn(
      `[SAM2] Photo pipeline: FAILED${isTimeout ? ' (FETCH TIMEOUT at 30s)' : ''} in ${elapsedMs}ms — ${message}`,
    );
    return null;
  }
}

/**
 * Extract geometry from a photo URL using the roofGeometryExtractor.
 * Handles fetch errors gracefully and returns an empty result on failure.
 * Only used when SAM2 is not configured (Canny as explicit backend).
 */
async function extractGeometryFromPhoto(fileUrl: string): Promise<RoofGeometryExtractionResult> {
  const t0 = Date.now();
  const urlHost = tryExtractHost(fileUrl);

  // Fetch image bytes
  console.info(`[SAM2] Canny image fetch: START — ${urlHost} (timeout=30s)`);
  const response = await fetch(fileUrl, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const fetchElapsedMs = Date.now() - t0;
    console.warn(
      `[SAM2] Canny image fetch: FAILED — HTTP ${response.status} in ${fetchElapsedMs}ms from ${urlHost}`,
    );
    throw new Error(`Failed to fetch image: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const fetchElapsedMs = Date.now() - t0;
  console.info(
    `[SAM2] Canny image fetch: OK — ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)}KB) in ${fetchElapsedMs}ms from ${urlHost}`,
  );

  // Run real contour extraction
  const result = await extractRoofGeometry(bytes);
  const totalElapsedMs = Date.now() - t0;
  console.info(
    `[SAM2] Canny extraction: ${result.contours.length} contours in ${totalElapsedMs}ms (fetch=${fetchElapsedMs}ms)`,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Bounding box computation
// ---------------------------------------------------------------------------

/**
 * Compute the bounding box of a polygon in normalized coordinates,
 * returning a NormalizedRegion (x, y, width, height, coordinateSystem).
 */
function computeMaskBounds(polygon: NormalizedPoint[]): import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion {
  let xMin = 1000;
  let yMin = 1000;
  let xMax = 0;
  let yMax = 0;

  for (const pt of polygon) {
    if (pt.x < xMin) xMin = pt.x;
    if (pt.y < yMin) yMin = pt.y;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y > yMax) yMax = pt.y;
  }

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput
// ---------------------------------------------------------------------------

/**
 * Run the segmentation worker from a standard GeometryReconstructionInput.
 * Converts the input format and delegates to runSegmentationWorker.
 * Returns only the artifacts (backward-compatible).
 */
export async function runSegmentationFromReconstructionInput(
  input: GeometryReconstructionInput,
  batchCallback?: SegmentationBatchCallback,
): Promise<GeometryReconstructionArtifact[]> {
  const workerInput: SegmentationWorkerInput = {
    surveyId: input.surveyId,
    sourcePhotos: input.sourcePhotos.map((p) => ({
      fileId: p.fileId,
      fileUrl: p.fileUrl,
      filename: p.filename,
      label: p.label ?? null,
    })),
    config: input.config as SegmentationWorkerInput['config'] | undefined,
  };

  const output = await runSegmentationWorker(workerInput, batchCallback);
  return output.artifacts;
}

/**
 * Run the segmentation worker from a standard GeometryReconstructionInput
 * and return the FULL output (including backend info for SAM 2 tracking).
 */
export async function runSegmentationFullOutput(
  input: GeometryReconstructionInput,
  batchCallback?: SegmentationBatchCallback,
): Promise<SegmentationWorkerOutput> {
  const workerInput: SegmentationWorkerInput = {
    surveyId: input.surveyId,
    sourcePhotos: input.sourcePhotos.map((p) => ({
      fileId: p.fileId,
      fileUrl: p.fileUrl,
      filename: p.filename,
      label: p.label ?? null,
    })),
    config: input.config as SegmentationWorkerInput['config'] | undefined,
  };

  return runSegmentationWorker(workerInput, batchCallback);
}
