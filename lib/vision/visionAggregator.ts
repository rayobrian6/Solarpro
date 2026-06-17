// ============================================================================
// lib/vision/visionAggregator.ts — Vision Detection Aggregation Engine
//
// VERSION: VISION_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   PhotoVisionResult[] (from ar_detections / inference run)
//     → aggregateVisionResults()  ← YOU ARE HERE
//     → VisionAggregationResult
//     → adaptPhotoVisionCandidate() (unified geometry pipeline)
//
// RESPONSIBILITIES:
//   1. Accept an array of per-photo inference results
//   2. Filter detections below confidence thresholds (confidenceGate)
//   3. Project image-space detections → world-space XY coordinates
//   4. Cluster nearby same-class detections → single ObstructionNode / ElectricalNode
//   5. Assign detections to roof planes (by GPS proximity or label matching)
//   6. Derive PlaneCorrections from roof geometry detections
//   7. Return VisionAggregationResult with full audit log
//
// PROJECTION STRATEGY (Phase 4A — 4-tier priority chain):
//   Priority 0 (NEW): homography_assisted
//     — Single-photo homography from matched features → image→world projection
//     — Gated by ENABLE_HOMOGRAPHY_PROJECTION env var (default: true)
//     — All outputs are candidate/preview-only (FROZEN_AUTHORITY_FLAGS)
//     — Requires: photo URL (fileUrl), roof plane reference geometry, OpenCV worker
//
//   Priority 1: gps_azimuth_pitch
//     — Full geometric projection from photo GPS + azimuth + pitch
//     — Requires: GPS coords + azimuth (pitch optional, defaults to 0°)
//
//   Priority 2: gps_centroid
//     — Place at photo GPS position (no angular projection)
//     — Requires: GPS coords only
//
//   Priority 3: none
//     — No position information (0,0 fallback)
//     — Used when no GPS data is available
//
// NON-BREAKING GUARANTEE:
//   - If photos array is empty → returns empty VisionAggregationResult
//   - If projection fails for any photo → detection placed at photo GPS centroid
//   - NEVER throws — all errors caught; partial results always returned
//   - Phase 4A homography failure silently falls back to gps_azimuth_pitch
// ============================================================================

import {
  VISION_PIPELINE_VERSION,
  CLUSTER_RADIUS_M,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  OBSTRUCTION_CLASS_DEFAULTS,
  type PhotoVisionResult,
  type VisionAggregationResult,
  type WorldDetection,
  type ObstructionNode,
  type ElectricalNode,
  type PlaneCorrection,
  type DetectionClass,
  type ObstructionClass,
  type ElectricalClass,
  type RoofGeometryClass,
  type VisionDetection,
  type PhotoContext,
  type ConfidenceThresholds,
} from './types';

import { latLngToXY, dist2D, centroid, type Point2D } from '@/lib/cad/geometry';

// ── Phase 4A imports ────────────────────────────────────────────────────────
import { extractExifFromUrl, computeFieldOfView, getDefaultSmartphoneFov, clearExifCache, type ExifData, type ExifCameraParams } from './exif/exifExtractor';
import { projectWithHomography, estimateRadiusFromProjection, HOMOGRAPHY_MIN_INLIERS, HOMOGRAPHY_MIN_CONFIDENCE, HOMOGRAPHY_MAX_REPROJ_ERROR_PX, HOMOGRAPHY_CONFIDENCE_BOOST, type HomographyProjectionAttempt } from './projection/homographyPipeline';
import { matchFeaturesWithFallback } from './projection/featureMatching';
import { FROZEN_AUTHORITY_FLAGS, assertAuthorityFlagsSafe, type ProjectionAuthorityFlags, type FeatureMatchResult } from './projection/types';

// ── Constants ───────────────────────────────────────────────────────────────

/** Estimated horizontal field of view of a smartphone camera (degrees) */
const HFOV_DEG = 65;

/** Estimated vertical field of view of a smartphone camera (degrees) */
const VFOV_DEG = 50;

/** Estimated camera height above ground when taking a roof photo (meters) */
const CAMERA_HEIGHT_M = 1.6;

/** Fallback ground distance when projection math fails (meters) */
const FALLBACK_DISTANCE_M = 5.0;

/** Default story height estimate (meters) per floor for wall-mounted electrical */
const STORY_HEIGHT_M = 3.0;

const DEG = Math.PI / 180;

// ── Phase 4A constants ──────────────────────────────────────────────────────

/**
 * Master toggle for Phase 4A homography-assisted projection.
 * Set ENABLE_HOMOGRAPHY_PROJECTION=false to disable homography entirely
 * and fall back to the legacy 3-tier projection chain.
 * Default: true (homography enabled).
 */
const ENABLE_HOMOGRAPHY_PROJECTION = process.env.ENABLE_HOMOGRAPHY_PROJECTION !== 'false';

/**
 * Maximum time budget for aggregation in milliseconds.
 * If aggregation exceeds this budget, remaining detections fall back to
 * non-homography projection (gps_azimuth_pitch / gps_centroid / none).
 * Set to 40s to leave headroom within Vercel's 60s function timeout.
 * Override with AGGREGATION_BUDGET_MS env var.
 */
const AGGREGATION_BUDGET_MS = parseInt(process.env.AGGREGATION_BUDGET_MS ?? '40000', 10);

// ── Classification helpers ──────────────────────────────────────────────────

const OBSTRUCTION_CLASSES = new Set<string>([
  'vent', 'skylight', 'hvac_unit', 'chimney', 'pipe_jack',
  'dormer', 'solar_tube', 'antenna', 'other_obstruction',
]);

const ELECTRICAL_CLASSES = new Set<string>([
  'meter_socket', 'main_panel', 'disconnect', 'sub_panel', 'service_entry',
]);

const ROOF_GEOMETRY_CLASSES = new Set<string>([
  'roof_edge', 'ridge_line', 'valley_line', 'gutter_line', 'hip_line',
]);

function isObstructionClass(c: string): c is ObstructionClass {
  return OBSTRUCTION_CLASSES.has(c);
}

function isElectricalClass(c: string): c is ElectricalClass {
  return ELECTRICAL_CLASSES.has(c);
}

function isRoofGeometryClass(c: string): c is RoofGeometryClass {
  return ROOF_GEOMETRY_CLASSES.has(c);
}

function isKnownClass(c: string): c is DetectionClass {
  return isObstructionClass(c) || isElectricalClass(c) || isRoofGeometryClass(c);
}

// ── Confidence gating ───────────────────────────────────────────────────────

function meetsThreshold(
  detection: VisionDetection,
  thresholds: ConfidenceThresholds,
): boolean {
  const cls = detection.class as DetectionClass;
  const classThreshold = thresholds.byClass[cls] ?? thresholds.default;
  return detection.confidence >= classThreshold;
}

// ── Phase 4A: Homography-assisted projection ────────────────────────────────

/**
 * Attempt homography-assisted projection for a single detection.
 *
 * This is the Phase 4A entry point. It tries to:
 *   1. Extract EXIF data from the photo URL (fileUrl)
 *   2. Compute field of view from EXIF camera params or use smartphone defaults
 *   3. Run feature matching against a reference image (if available)
 *   4. Pass matched points + detection + EXIF to projectWithHomography()
 *   5. Validate the result against quality thresholds
 *   6. Assert authority safety flags at every output boundary
 *
 * All outputs carry FROZEN_AUTHORITY_FLAGS (candidate/preview-only).
 * If any step fails, the function returns success=false with a fallbackMethod,
 * allowing the caller to fall back to the next projection tier.
 *
 * SAFETY: assertAuthorityFlagsSafe() is called at every output boundary.
 */
async function attemptHomographyProjection(
  detection: VisionDetection,
  ctx: PhotoContext,
  origin: { lat: number; lng: number },
  log: string[],
  featureMatchCache?: Map<string, { matchedPoints: { source: Array<{ x: number; y: number }>; target: Array<{ x: number; y: number }> } | null; logMsg: string }>,
  statsCallbacks?: {
    onFeatureMatchComplete?: (durationMs: number) => void;
    onFeatureMatchCacheHit?: () => void;
    onHomographyComplete?: (durationMs: number) => void;
  },
): Promise<HomographyProjectionAttempt> {

  const FAILED: HomographyProjectionAttempt = {
    success: false,
    projection: null,
    homography: null,
    exifUsed: false,
    boostedConfidence: null,
    fallbackMethod: 'none',
    fallbackReason: undefined,
  };

  // ── Gate: master toggle ──────────────────────────────────────────────────
  if (!ENABLE_HOMOGRAPHY_PROJECTION) {
    return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'homography_projection_disabled' };
  }

  // ── Gate: photo URL required ─────────────────────────────────────────────
  const photoUrl = ctx.fileUrl;
  if (!photoUrl) {
    return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'missing_reference_image' };
  }

  // ── Gate: GPS coords required for origin anchoring ───────────────────────
  if (ctx.lat == null || ctx.lng == null) {
    return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'missing_gps_coords' };
  }

  try {
    // ── Step 1: Extract EXIF from photo ─────────────────────────────────────
    let exifData: ExifData | null = null;
    try {
      exifData = await extractExifFromUrl(photoUrl);
      log.push(`[aggregator:4A] EXIF extracted from ${photoUrl.substring(0, 60)}… focalLength=${exifData.camera?.focalLength35mmEquiv ?? 'n/a'} gps=(${exifData.gps?.latitude?.toFixed(6) ?? 'n/a'},${exifData.gps?.longitude?.toFixed(6) ?? 'n/a'})`);
    } catch (exifErr) {
      log.push(`[aggregator:4A] EXIF extraction failed: ${exifErr} — will use default FOV`);
      // Non-fatal: we can proceed with default smartphone FOV
    }

    // ── Step 2: Try feature matching against reference image ──
    // Feature matching requires a reference image URL.
    // Priority chain for referenceImageUrl:
    //   1. ctx.referenceImageUrl (explicitly set from roof plane reference / CAD raster / orthographic)
    //   2. null → no reference image available → skip feature matching
    let matchedPoints: {
      source: Array<{ x: number; y: number }>;
      target: Array<{ x: number; y: number }>;
    } | null = null;

    const referenceImageUrl = ctx.referenceImageUrl;
    if (referenceImageUrl) {
      // Use feature-match cache to avoid redundant HTTP calls for the same (photoUrl, referenceImageUrl) pair
      const cacheKey = `${photoUrl}::${referenceImageUrl}`;
      const cached = featureMatchCache?.get(cacheKey);
      if (cached) {
        matchedPoints = cached.matchedPoints;
        log.push(cached.logMsg);
        statsCallbacks?.onFeatureMatchCacheHit?.();
      } else {
        // Cache miss — perform feature matching
        const fmStartMs = Date.now();
        try {
          const matchResult = await matchFeaturesWithFallback(photoUrl, referenceImageUrl, {
            minGoodMatches: HOMOGRAPHY_MIN_INLIERS,
            minConfidence: HOMOGRAPHY_MIN_CONFIDENCE,
          });
          const fmDurationMs = Date.now() - fmStartMs;
          statsCallbacks?.onFeatureMatchComplete?.(fmDurationMs);

          if (matchResult.ok && matchResult.matchedPoints) {
            matchedPoints = matchResult.matchedPoints;
            const logMsg = `[aggregator:4A:feature-match] SUCCEEDED in ${fmDurationMs}ms goodMatches=${matchResult.goodMatchCount} confidence=${matchResult.confidence.toFixed(3)} detector=${matchResult.detector}`;
            log.push(logMsg);
            featureMatchCache?.set(cacheKey, { matchedPoints: matchResult.matchedPoints, logMsg });
          } else {
            const logMsg = `[aggregator:4A:feature-match] FAILED in ${fmDurationMs}ms: ${matchResult.error ?? `quality=${matchResult.quality} confidence=${matchResult.confidence.toFixed(3)}`} — homography will fall back gracefully`;
            log.push(logMsg);
            // Cache the failure too — no point retrying the same failed pair
            featureMatchCache?.set(cacheKey, { matchedPoints: null, logMsg });
          }
        } catch (matchErr) {
          const fmDurationMs = Date.now() - fmStartMs;
          statsCallbacks?.onFeatureMatchComplete?.(fmDurationMs);
          const logMsg = `[aggregator:4A:feature-match] ERROR in ${fmDurationMs}ms: ${matchErr} — homography will fall back gracefully`;
          log.push(logMsg);
          featureMatchCache?.set(cacheKey, { matchedPoints: null, logMsg });
        }
      }
    } else {
      log.push(`[aggregator:4A] No reference image URL available (referenceImageUrl is null) — skipping feature matching, homography will fall back gracefully`);
    }

    // ── Step 3: Run homography projection pipeline ──────────────────────────
    // projectWithHomography handles: EXIF → FOV → homography → world projection
    const homStartMs = Date.now();
    log.push(`[aggregator:4A:homography] START detection=${detection.class}`);
    const attempt = await projectWithHomography(
      {
        class: detection.class,
        confidence: detection.confidence,
        bbox: detection.bbox,
      },
      matchedPoints,
      exifData,
    );

    const homDurationMs = Date.now() - homStartMs;
    statsCallbacks?.onHomographyComplete?.(homDurationMs);
    log.push(`[aggregator:4A:homography] END durationMs=${homDurationMs} success=${attempt.success}`);

        // ── Step 4: Validate result ─────────────────────────────────────────────
    if (!attempt.success || !attempt.projection) {
      log.push(`[aggregator:4A] Homography projection unsuccessful — falling back to ${attempt.fallbackMethod}`);
      return attempt;
    }

    // ── Step 5: Quality gates on homography result ──────────────────────────
    if (attempt.homography) {
      if (attempt.homography.inlierCount < HOMOGRAPHY_MIN_INLIERS) {
        log.push(`[aggregator:4A] Insufficient inliers: ${attempt.homography.inlierCount} < ${HOMOGRAPHY_MIN_INLIERS} — falling back`);
        return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'insufficient_inliers' };
      }

      if (attempt.homography.confidence < HOMOGRAPHY_MIN_CONFIDENCE) {
        log.push(`[aggregator:4A] Low confidence: ${attempt.homography.confidence.toFixed(3)} < ${HOMOGRAPHY_MIN_CONFIDENCE} — falling back`);
        return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'low_confidence' };
      }

      if (attempt.homography.meanReprojectionError > HOMOGRAPHY_MAX_REPROJ_ERROR_PX) {
        log.push(`[aggregator:4A] High reprojection error: ${attempt.homography.meanReprojectionError.toFixed(2)}px > ${HOMOGRAPHY_MAX_REPROJ_ERROR_PX}px — falling back`);
        return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'reprojection_error_too_high' };
      }
    }

    // ── Step 6: Authority safety assertion ──────────────────────────────────
    // ALL Phase 4A outputs are candidate/preview-only.
    try {
      assertAuthorityFlagsSafe(FROZEN_AUTHORITY_FLAGS);
    } catch (authorityErr) {
      log.push(`[aggregator:4A] CRITICAL: Authority flags violation — ${authorityErr}`);
      return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'authority_flags_violation' };
    }

    const proj = attempt.projection;
    log.push(`[aggregator:4A:projection] SUCCESS world=(${proj.worldX.toFixed(2)},${proj.worldY.toFixed(2)}) radiusM=${proj.radiusM.toFixed(2)} confidence=${proj.confidence.toFixed(3)} method=${proj.method} reprojErr=${proj.reprojectionError?.toFixed(2) ?? 'n/a'}px`);

    return attempt;

  } catch (err) {
    log.push(`[aggregator:4A] Homography pipeline error: ${err} — falling back to ${_inferFallbackMethod(ctx)}`);
    return { ...FAILED, fallbackMethod: _inferFallbackMethod(ctx), fallbackReason: 'homography_pipeline_error' };
  }
}

/**
 * Infer the best fallback projection method based on available PhotoContext data.
 */
function _inferFallbackMethod(ctx: PhotoContext): 'gps_azimuth_pitch' | 'gps_centroid' | 'none' {
  if (ctx.lat != null && ctx.lng != null && ctx.azimuth != null) {
    return 'gps_azimuth_pitch';
  }
  if (ctx.lat != null && ctx.lng != null) {
    return 'gps_centroid';
  }
  return 'none';
}

// ── World projection (4-tier priority chain) ────────────────────────────────

/**
 * Project a single detection from image-space to world-space XY (meters).
 * Returns the world position, radius, projection method, and optional
 * Phase 4A confidence/reprojection metadata.
 *
 * PRIORITY CHAIN (Phase 4A):
 *   0. homography_assisted — single-photo homography projection (NEW)
 *   1. gps_azimuth_pitch   — GPS + azimuth + pitch geometric projection
 *   2. gps_centroid         — place at photo GPS position
 *   3. none                 — no position information (0,0 fallback)
 *
 * Each tier is attempted in order; failure falls through to the next.
 * Phase 4A homography is attempted first when ENABLE_HOMOGRAPHY_PROJECTION
 * is true and the required inputs (fileUrl, GPS) are available.
 */
async function projectDetectionToWorld(
  detection: VisionDetection,
  ctx: PhotoContext,
  origin: { lat: number; lng: number },
  log: string[],
  options?: {
    skipHomography?: boolean;
    featureMatchCache?: Map<string, { matchedPoints: { source: Array<{ x: number; y: number }>; target: Array<{ x: number; y: number }> } | null; logMsg: string }>;
    onFeatureMatchComplete?: (durationMs: number) => void;
    onFeatureMatchCacheHit?: () => void;
    onHomographyComplete?: (durationMs: number) => void;
    onHomographyAttempt?: (success: boolean) => void;
  },
): Promise<{ worldX: number; worldY: number; radiusM: number; method: WorldDetection['projectionMethod']; _projectionConfidence?: number; _reprojectionError?: number | null }> {
  const bbox = detection.bbox;

  // ── Tier 0: Homography-assisted projection (Phase 4A) ─────────────────────
  if (ENABLE_HOMOGRAPHY_PROJECTION && ctx.fileUrl && !options?.skipHomography) {
    const homAttempt = await attemptHomographyProjection(
      detection, ctx, origin, log,
      options?.featureMatchCache,
      {
        onFeatureMatchComplete: options?.onFeatureMatchComplete,
        onFeatureMatchCacheHit: options?.onFeatureMatchCacheHit,
        onHomographyComplete: options?.onHomographyComplete,
      },
    );
    options?.onHomographyAttempt?.(homAttempt.success);
    if (homAttempt.success && homAttempt.projection) {
      const proj = homAttempt.projection;
      return {
        worldX: proj.worldX,
        worldY: proj.worldY,
        radiusM: proj.radiusM,
        method: 'homography_assisted',
        _projectionConfidence: homAttempt.boostedConfidence ?? proj.confidence,
        _reprojectionError: proj.reprojectionError,
      };
    }
    // Homography failed — log the reason and fall through
    log.push(`[aggregator:4A] Homography skipped — falling back to ${homAttempt.fallbackMethod}`);
  }

  // ── Tier 1: GPS + azimuth + pitch → full projection ──────────────────────
  if (
    ctx.lat != null && ctx.lng != null &&
    ctx.azimuth != null
  ) {
    try {
      const photoXY = latLngToXY(ctx.lat, ctx.lng, origin.lat, origin.lng);
      const pitch = ctx.pitch ?? 0; // degrees from horizontal (0 = looking horizontally)

      // Angular offset of detection center from photo center
      const dAz = (bbox.x - 0.5) * HFOV_DEG;   // +East
      const dEl = -(bbox.y - 0.5) * VFOV_DEG;  // +Up (image y flipped)

      const bearingDeg = ((ctx.azimuth + dAz) + 360) % 360;
      const bearingRad = bearingDeg * DEG;

      // Estimate ground distance using camera geometry
      const totalPitchDeg = pitch + dEl;
      let groundDistM: number;
      if (Math.abs(totalPitchDeg) > 5 && totalPitchDeg < 85) {
        groundDistM = CAMERA_HEIGHT_M / Math.tan(totalPitchDeg * DEG);
        groundDistM = Math.max(0.5, Math.min(groundDistM, 30)); // clamp to sane range
      } else {
        groundDistM = FALLBACK_DISTANCE_M;
      }

      // East/North components
      const worldX = photoXY.x + Math.sin(bearingRad) * groundDistM;
      const worldY = photoXY.y + Math.cos(bearingRad) * groundDistM;

      // Estimate footprint radius from bbox size
      const bboxWidthM = bbox.width * groundDistM * Math.tan((HFOV_DEG / 2) * DEG) * 2;
      const radiusM = Math.max(0.10, bboxWidthM / 2);

      return { worldX, worldY, radiusM, method: 'gps_azimuth_pitch' };
    } catch (err) {
      log.push(`[aggregator] projection failed for ${detection.class}: ${err} — falling back to GPS centroid`);
    }
  }

  // ── Tier 2: GPS only → place at photo GPS position ──────────────────────
  if (ctx.lat != null && ctx.lng != null) {
    const photoXY = latLngToXY(ctx.lat, ctx.lng, origin.lat, origin.lng);
    const cls = detection.class as DetectionClass;
    const defaults = isObstructionClass(cls)
      ? OBSTRUCTION_CLASS_DEFAULTS[cls as ObstructionClass]
      : { radiusM: 0.40, heightFt: 2.0, setbackIn: 18 };
    return { worldX: photoXY.x, worldY: photoXY.y, radiusM: defaults.radiusM, method: 'gps_centroid' };
  }

  // ── Tier 3: No GPS — use (0,0) fallback (will be filtered in post-processing)
  return { worldX: 0, worldY: 0, radiusM: 0.40, method: 'none' };
}

// ── Roof plane assignment ────────────────────────────────────────────────────

/**
 * Assign a detection to a roof plane based on:
 *   1. Explicit label match (ctx.label contains plane id or compass direction)
 *   2. GPS proximity to plane centroid
 *   3. Fallback: null
 */
function assignToRoofPlane(
  worldX: number,
  worldY: number,
  ctx: PhotoContext,
  roofPlanes: Array<{ id: string; centroidX: number; centroidY: number }>,
): string | null {
  if (roofPlanes.length === 0) return null;

  // Explicit assignment: the survey told us which plane this photo belongs to.
  // Only roofPlaneId is used here, so don't gate it on ctx.label being set.
  if (ctx.roofPlaneId) {
    const match = roofPlanes.find(p => p.id === ctx.roofPlaneId);
    if (match) return match.id;
  }

  // GPS proximity: find closest plane centroid
  let closest: string | null = null;
  let closestDist = Infinity;
  for (const plane of roofPlanes) {
    const d = dist2D({ x: worldX, y: worldY }, { x: plane.centroidX, y: plane.centroidY });
    if (d < closestDist) {
      closestDist = d;
      closest = plane.id;
    }
  }

  // Only assign if within 15m of a plane centroid (loose threshold)
  return closestDist <= 15 ? closest : null;
}

// ── Spatial clustering ───────────────────────────────────────────────────────

interface ClusterInput {
  cls: string;
  worldX: number;
  worldY: number;
  radiusM: number;
  confidence: number;
  detectionId: string;
  roofPlaneId: string | null;
  source: WorldDetection;
}

/**
 * Merge nearby same-class detections into clusters.
 * Within a cluster, the highest-confidence detection wins for position.
 */
function clusterDetections(detections: ClusterInput[]): Array<{
  cls: string;
  worldX: number;
  worldY: number;
  radiusM: number;
  confidence: number;
  count: number;
  ids: string[];
  roofPlaneId: string | null;
  sources: WorldDetection[];
}> {
  const clusters: Array<{
    cls: string;
    members: ClusterInput[];
  }> = [];

  for (const det of detections) {
    // Find an existing cluster of same class within CLUSTER_RADIUS_M
    const existing = clusters.find(c => {
      if (c.cls !== det.cls) return false;
      // Compare against cluster centroid (mean of member positions)
      const members = c.members;
      const cx = members.reduce((s, m) => s + m.worldX, 0) / members.length;
      const cy = members.reduce((s, m) => s + m.worldY, 0) / members.length;
      return dist2D({ x: det.worldX, y: det.worldY }, { x: cx, y: cy }) <= CLUSTER_RADIUS_M;
    });

    if (existing) {
      existing.members.push(det);
    } else {
      clusters.push({ cls: det.cls, members: [det] });
    }
  }

  return clusters.map(c => {
    // Best member = highest confidence
    const best = c.members.reduce((a, b) => a.confidence >= b.confidence ? a : b);
    return {
      cls: c.cls,
      worldX: best.worldX,
      worldY: best.worldY,
      radiusM: Math.max(...c.members.map(m => m.radiusM)),
      confidence: best.confidence,
      count: c.members.length,
      ids: c.members.map(m => m.detectionId).filter(Boolean),
      roofPlaneId: best.roofPlaneId,
      sources: c.members.map(m => m.source),
    };
  });
}

// ── ID generation ────────────────────────────────────────────────────────────

/** Generate a deterministic id from class + world position (for stability) */
function makeNodeId(cls: string, worldX: number, worldY: number): string {
  const x = Math.round(worldX * 10) / 10;
  const y = Math.round(worldY * 10) / 10;
  return `${cls}_${x}_${y}`.replace(/\./g, 'p').replace(/-/g, 'n');
}

// ── Main aggregator ─────────────────────────────────────────────────────────

export interface AggregatorOptions {
  /** Override default confidence thresholds */
  thresholds?: Partial<ConfidenceThresholds>;
  /** Project GPS origin (defaults to centroid of all photo GPS positions) */
  origin?: { lat: number; lng: number };
  /** Roof plane data for assignment */
  roofPlanes?: Array<{ id: string; lat: number; lng: number }>;
}

/**
 * aggregateVisionResults — the main aggregation function.
 *
 * Takes per-photo inference results, filters, projects, clusters, and
 * returns a complete VisionAggregationResult.
 *
 * NON-BREAKING: Returns an empty result (no obstructions, no nodes) if
 * photos array is empty or all detections fail thresholds.
 *
 * Phase 4A NOTE (breaking change — async):
 *   This function is now ASYNC because homography projection requires
 *   network calls (EXIF extraction, Python worker for feature matching).
 *   All existing callers must `await` the result.
 *   The function signature changed from sync to async but the output
 *   shape is identical — only the projection method may now be
 *   'homography_assisted' and WorldDetection may carry optional
 *   _projectionConfidence and _reprojectionError fields.
 */
export async function aggregateVisionResults(
  photos: PhotoVisionResult[],
  projectId: string,
  surveyId: string,
  options: AggregatorOptions = {},
): Promise<VisionAggregationResult> {
  const log: string[] = [];
  const startMs = Date.now();

  log.push(`[aggregator:4A:start] projectId=${projectId} surveyId=${surveyId} photos=${photos.length} homography=${ENABLE_HOMOGRAPHY_PROJECTION} budget=${AGGREGATION_BUDGET_MS}ms`);

  // ── Phase 4A: Initialize EXIF cache ───────────────────────────────────────
  // Pre-warm the EXIF cache by extracting EXIF for all photo URLs in parallel.
  // This is a best-effort optimization; failures are non-fatal.
  // ── Phase 4A: Pre-warm EXIF cache and feature-match cache ─────────────
  // Block on EXIF pre-warming so that per-detection calls hit cache.
  // Feature-match cache is populated lazily per (photoUrl, referenceImageUrl) pair.
  const featureMatchCache = new Map<string, { matchedPoints: { source: Array<{ x: number; y: number }>; target: Array<{ x: number; y: number }> } | null; logMsg: string }>();
  let featureMatchCacheHits = 0;
  let featureMatchCacheMisses = 0;

  if (ENABLE_HOMOGRAPHY_PROJECTION) {
    const photoUrls = photos
      .map(pv => pv.photoContext.fileUrl)
      .filter((url): url is string => typeof url === 'string' && url.length > 0);
    const uniquePhotoUrls = [...new Set(photoUrls)];

    if (uniquePhotoUrls.length > 0) {
      log.push(`[aggregator:4A] Pre-warming EXIF cache for ${uniquePhotoUrls.length} unique photo URLs`);
      const exifStartMs = Date.now();
      /** Budget for EXIF pre-warming (ms). Don't spend more than 20% of the total budget on pre-warming. */
      const EXIF_PREWARM_BUDGET_MS = Math.min(10_000, AGGREGATION_BUDGET_MS * 0.2);
      // Pre-warm in parallel with concurrency limit (5 at a time)
      const EXIF_CONCURRENCY = 5;
      let exifBudgetExhausted = false;
      for (let i = 0; i < uniquePhotoUrls.length; i += EXIF_CONCURRENCY) {
        if (exifBudgetExhausted) {
          log.push(`[aggregator:4A] EXIF pre-warming budget exhausted at ${Date.now() - exifStartMs}ms — ${uniquePhotoUrls.length - i} URLs skipped`);
          break;
        }
        const batch = uniquePhotoUrls.slice(i, i + EXIF_CONCURRENCY);
        // Each batch gets a timeout: remaining budget or 15s per URL, whichever is less
        const remainingBudget = EXIF_PREWARM_BUDGET_MS - (Date.now() - exifStartMs);
        if (remainingBudget <= 0) {
          exifBudgetExhausted = true;
          log.push(`[aggregator:4A] EXIF pre-warming budget exhausted at ${Date.now() - exifStartMs}ms — ${uniquePhotoUrls.length - i} URLs skipped`);
          break;
        }
        const batchTimeoutMs = Math.min(remainingBudget, batch.length * 15_000);
        await Promise.race([
          Promise.allSettled(batch.map(async (url) => {
            try { await extractExifFromUrl(url); } catch { /* non-fatal */ }
          })),
          new Promise<void>(resolve => setTimeout(resolve, batchTimeoutMs)),
        ]);
      }
      log.push(`[aggregator:4A] EXIF cache pre-warmed in ${Date.now() - exifStartMs}ms`);
    }
  }

  // ── Empty guard ────────────────────────────────────────────────────────────
  if (photos.length === 0) {
    log.push('[aggregator] No photos provided — returning empty result');
    return _emptyResult(projectId, surveyId, log);
  }

  // ── Merge thresholds ──────────────────────────────────────────────────────
  const thresholds: ConfidenceThresholds = {
    default: options.thresholds?.default ?? DEFAULT_CONFIDENCE_THRESHOLDS.default,
    byClass: {
      ...DEFAULT_CONFIDENCE_THRESHOLDS.byClass,
      ...options.thresholds?.byClass,
    },
  };

  // ── Resolve GPS origin ────────────────────────────────────────────────────
  let origin = options.origin;
  if (!origin) {
    const gpsPoints: Array<{ lat: number; lng: number }> = [];
    for (const pv of photos) {
      if (pv.photoContext.lat != null && pv.photoContext.lng != null) {
        gpsPoints.push({ lat: pv.photoContext.lat, lng: pv.photoContext.lng });
      }
    }
    if (gpsPoints.length > 0) {
      origin = {
        lat: gpsPoints.reduce((s, p) => s + p.lat, 0) / gpsPoints.length,
        lng: gpsPoints.reduce((s, p) => s + p.lng, 0) / gpsPoints.length,
      };
      log.push(`[aggregator] GPS origin resolved from ${gpsPoints.length} photo GPS points: ${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
    } else {
      origin = { lat: 0, lng: 0 };
      log.push('[aggregator] WARNING: No photo GPS data available — using (0,0) origin');
    }
  }

  // ── Build roof plane lookup ───────────────────────────────────────────────
  const roofPlaneLookup: Array<{ id: string; centroidX: number; centroidY: number }> = [];
  if (options.roofPlanes) {
    for (const plane of options.roofPlanes) {
      const xy = latLngToXY(plane.lat, plane.lng, origin.lat, origin.lng);
      roofPlaneLookup.push({ id: plane.id, centroidX: xy.x, centroidY: xy.y });
    }
  }

  // ── Phase 4A: Stats tracking ──────────────────────────────────────────────
  let totalFeatureMatchMs = 0;
  let homographyAttempts = 0;
  let homographySuccesses = 0;
  let totalHomographyMs = 0;
  let budgetExhausted = false;

  // ── Process each photo (async for homography) ─────────────────────────────
  let totalRaw = 0;
  let totalFiltered = 0;
  const allWorldDetections: WorldDetection[] = [];

  for (const pv of photos) {
    const detections = pv.inferenceResult.detections ?? [];
    totalRaw += detections.length;

    for (const det of detections) {
      // Hard timeout: if we've been running for 2x the budget, break out entirely
      const hardTimeoutMs = Date.now() - startMs;
      if (hardTimeoutMs > AGGREGATION_BUDGET_MS * 2) {
        log.push(`[aggregator:4A] HARD_TIMEOUT at ${hardTimeoutMs}ms (2x budget=${AGGREGATION_BUDGET_MS * 2}ms) — stopping detection loop, ${allWorldDetections.length} detections processed so far`);
        break;
      }

      // Skip unknown classes
      if (!isKnownClass(det.class)) {
        totalFiltered++;
        log.push(`[aggregator] SKIP unknown class="${det.class}" conf=${det.confidence.toFixed(2)}`);
        continue;
      }

      // Confidence gate
      if (!meetsThreshold(det, thresholds)) {
        totalFiltered++;
        continue;
      }

      // Project to world (now async for Phase 4A homography)
      // Budget guard: skip homography for remaining detections if budget exhausted
      const elapsedMs = Date.now() - startMs;
      const skipHomography = ENABLE_HOMOGRAPHY_PROJECTION && budgetExhausted;
      if (ENABLE_HOMOGRAPHY_PROJECTION && elapsedMs > AGGREGATION_BUDGET_MS && !budgetExhausted) {
        budgetExhausted = true;
        log.push(`[aggregator:4A] BUDGET_EXHAUSTED at ${elapsedMs}ms (budget=${AGGREGATION_BUDGET_MS}ms) — remaining detections will use fast projection`);
      }
      const proj = await projectDetectionToWorld(det, pv.photoContext, origin, log, {
        skipHomography: budgetExhausted,
        featureMatchCache,
        onFeatureMatchComplete: (durationMs) => { totalFeatureMatchMs += durationMs; featureMatchCacheMisses++; },
        onFeatureMatchCacheHit: () => { featureMatchCacheHits++; },
        onHomographyComplete: (durationMs) => { totalHomographyMs += durationMs; },
        onHomographyAttempt: (success) => { homographyAttempts++; if (success) homographySuccesses++; },
      });

      // Skip zero-GPS projections for obstructions (they're meaningless without location)
      if (proj.method === 'none' && isObstructionClass(det.class)) {
        totalFiltered++;
        log.push(`[aggregator] SKIP obstruction ${det.class} — no GPS context`);
        continue;
      }

      // Assign to roof plane
      const roofPlaneId = assignToRoofPlane(
        proj.worldX, proj.worldY,
        pv.photoContext,
        roofPlaneLookup,
      );

      const wd: WorldDetection = {
        class: det.class as DetectionClass,
        confidence: det.confidence,
        worldX: proj.worldX,
        worldY: proj.worldY,
        radiusM: proj.radiusM,
        roofPlaneId,
        source: pv.photoContext,
        rawDetection: det,
        projectionMethod: proj.method,
        // Phase 4A optional fields (undefined for non-homography projections)
        _projectionConfidence: proj._projectionConfidence,
        _reprojectionError: proj._reprojectionError,
      };

      allWorldDetections.push(wd);
    }
  }

  log.push(`[aggregator] World detections: total_raw=${totalRaw} filtered=${totalFiltered} projected=${allWorldDetections.length}`);

  // ── Log Phase 4A stats ────────────────────────────────────────────────────
  if (ENABLE_HOMOGRAPHY_PROJECTION) {
    const homCount = allWorldDetections.filter(d => d.projectionMethod === 'homography_assisted').length;
    const homAvgConf = homCount > 0
      ? (allWorldDetections.filter(d => d.projectionMethod === 'homography_assisted').reduce((s, d) => s + (d._projectionConfidence ?? 0), 0) / homCount)
      : 0;
    const avgFeatureMatchMs = featureMatchCacheMisses > 0 ? Math.round(totalFeatureMatchMs / featureMatchCacheMisses) : 0;
    const avgHomographyMs = homographyAttempts > 0 ? Math.round(totalHomographyMs / homographyAttempts) : 0;
    log.push(`[aggregator:4A:end] totalMs=${Date.now() - startMs} homographyAttempts=${homographyAttempts} successes=${homographySuccesses} projected=${homCount}/${allWorldDetections.length} avgConf=${homAvgConf.toFixed(3)}`);
    log.push(`[aggregator:4A:end] featureMatch: cacheHits=${featureMatchCacheHits} cacheMisses=${featureMatchCacheMisses} totalMs=${totalFeatureMatchMs} avgMs=${avgFeatureMatchMs}`);
    log.push(`[aggregator:4A:end] homography: attempts=${homographyAttempts} totalMs=${totalHomographyMs} avgMs=${avgHomographyMs}`);
    if (budgetExhausted) {
      log.push(`[aggregator:4A:end] BUDGET_EXHAUSTED — ${allWorldDetections.filter(d => d.projectionMethod !== 'homography_assisted').length} detections used fallback`);
    }
  }

  // ── Split by type ──────────────────────────────────────────────────────────
  const obstructionDetections = allWorldDetections.filter(d => isObstructionClass(d.class));
  const electricalDetections  = allWorldDetections.filter(d => isElectricalClass(d.class));
  const geometryDetections    = allWorldDetections.filter(d => isRoofGeometryClass(d.class));

  // ── Cluster obstructions ──────────────────────────────────────────────────
  const obsClusters = clusterDetections(
    obstructionDetections.map(d => ({
      cls: d.class,
      worldX: d.worldX,
      worldY: d.worldY,
      radiusM: d.radiusM,
      confidence: d.confidence,
      detectionId: d.rawDetection.detection_id ?? '',
      roofPlaneId: d.roofPlaneId,
      source: d,
    })),
  );

  const obstructions: ObstructionNode[] = obsClusters.map(c => {
    const cls = c.cls as ObstructionClass;
    const defaults = OBSTRUCTION_CLASS_DEFAULTS[cls] ?? OBSTRUCTION_CLASS_DEFAULTS.other_obstruction;
    return {
      id: makeNodeId(cls, c.worldX, c.worldY),
      type: cls,
      worldX: c.worldX,
      worldY: c.worldY,
      radiusM: c.radiusM,
      heightFt: defaults.heightFt,
      setbackIn: defaults.setbackIn,
      confidence: c.confidence,
      detectionCount: c.count,
      roofPlaneId: c.roofPlaneId,
      sourceDetectionIds: c.ids,
      source: 'promoted_canonical' as const,
    };
  });

  log.push(`[aggregator] Obstructions: ${obstructions.length} nodes from ${obstructionDetections.length} detections`);

  // ── Cluster electrical nodes ───────────────────────────────────────────────
  const elecClusters = clusterDetections(
    electricalDetections.map(d => ({
      cls: d.class,
      worldX: d.worldX,
      worldY: d.worldY,
      radiusM: d.radiusM,
      confidence: d.confidence,
      detectionId: d.rawDetection.detection_id ?? '',
      roofPlaneId: d.roofPlaneId,
      source: d,
    })),
  );

  // Determine primary interconnect: prefer main_panel, then disconnect, then meter_socket
  const PRIMARY_PRIORITY: ElectricalClass[] = ['main_panel', 'disconnect', 'meter_socket', 'sub_panel', 'service_entry'];
  let primaryAssigned = false;

  const electricalNodes: ElectricalNode[] = elecClusters
    .sort((a, b) => {
      const ai = PRIMARY_PRIORITY.indexOf(a.cls as ElectricalClass);
      const bi = PRIMARY_PRIORITY.indexOf(b.cls as ElectricalClass);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(c => {
      const cls = c.cls as ElectricalClass;
      const isPrimary = !primaryAssigned && PRIMARY_PRIORITY.includes(cls);
      if (isPrimary) primaryAssigned = true;

      // Estimate story from photo label or world Y (rough heuristic)
      const storyGuess = c.sources.some(s => s.source.label?.includes('2') || s.source.label?.includes('second')) ? 2 : 1;

      return {
        id: makeNodeId(cls, c.worldX, c.worldY),
        type: cls,
        worldX: c.worldX,
        worldY: c.worldY,
        story: storyGuess,
        confidence: c.confidence,
        detectionCount: c.count,
        sourceDetectionIds: c.ids,
        isPrimaryInterconnect: isPrimary,
        source: 'promoted_canonical' as const,
      };
    });

  log.push(`[aggregator] Electrical nodes: ${electricalNodes.length} nodes from ${electricalDetections.length} detections`);

  // ── Derive plane corrections from geometry detections ─────────────────────
  const planeCorrections: PlaneCorrection[] = _derivePlaneCorrections(
    geometryDetections,
    roofPlaneLookup,
    origin,
    log,
  );

  log.push(`[aggregator] Plane corrections: ${planeCorrections.length}`);

  // ── Class counts ───────────────────────────────────────────────────────────
  const classCounts: Record<string, number> = {};
  for (const d of allWorldDetections) {
    classCounts[d.class] = (classCounts[d.class] ?? 0) + 1;
  }

  const hasHighConfidenceDetections =
    obstructions.some(o => o.confidence >= 0.70) ||
    electricalNodes.some(e => e.confidence >= 0.70);

  const durationMs = Date.now() - startMs;
  log.push(`[aggregator] DONE durationMs=${durationMs} obstructions=${obstructions.length} electrical=${electricalNodes.length} planeCorrections=${planeCorrections.length}`);

  return {
    projectId,
    surveyId,
    aggregatedAt: new Date().toISOString(),
    pipelineVersion: VISION_PIPELINE_VERSION,
    obstructions,
    electricalNodes,
    planeCorrections,
    photosProcessed: photos.length,
    rawDetectionCount: totalRaw,
    filteredCount: totalFiltered,
    classCounts,
    log,
    hasHighConfidenceDetections,
  };
}

// ── Plane correction derivation ──────────────────────────────────────────────

/**
 * Derive PlaneCorrections from roof geometry class detections.
 *
 * Current strategy: if ridge_line or gutter_line detections are significantly
 * offset from a roof plane centroid in a consistent direction, flag a
 * polygon_offset correction.
 *
 * This is a conservative first implementation — corrections are only flagged
 * when confidence is high (>= 0.70) and at least 2 detections agree.
 */
function _derivePlaneCorrections(
  geometryDetections: WorldDetection[],
  roofPlanes: Array<{ id: string; centroidX: number; centroidY: number }>,
  origin: { lat: number; lng: number },
  log: string[],
): PlaneCorrection[] {
  const corrections: PlaneCorrection[] = [];

  if (geometryDetections.length === 0 || roofPlanes.length === 0) return corrections;

  // Group geometry detections by roof plane
  const byPlane = new Map<string, WorldDetection[]>();
  for (const d of geometryDetections) {
    if (!d.roofPlaneId) continue;
    const existing = byPlane.get(d.roofPlaneId) ?? [];
    existing.push(d);
    byPlane.set(d.roofPlaneId, existing);
  }

  for (const [planeId, dets] of byPlane) {
    const plane = roofPlanes.find(p => p.id === planeId);
    if (!plane) continue;

    // Ridge corrections: ridge_line detections should be near the plane top
    const ridgeDets = dets.filter(d => d.class === 'ridge_line' && d.confidence >= 0.70);
    if (ridgeDets.length >= 2) {
      const avgX = ridgeDets.reduce((s, d) => s + d.worldX, 0) / ridgeDets.length;
      const avgY = ridgeDets.reduce((s, d) => s + d.worldY, 0) / ridgeDets.length;
      const offsetX = avgX - plane.centroidX;
      const offsetY = avgY - plane.centroidY;
      const offsetMag = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

      if (offsetMag > 1.5) {
        corrections.push({
          roofPlaneId: planeId,
          correctionType: 'polygon_offset',
          offsetX: offsetX * 0.5, // conservative: apply 50% of detected offset
          offsetY: offsetY * 0.5,
          confidence: Math.min(...ridgeDets.map(d => d.confidence)),
          sourceClass: 'ridge_line',
        });
        log.push(`[aggregator] PlaneCorrection polygon_offset planeId=${planeId} offsetMag=${offsetMag.toFixed(2)}m`);
      }
    }
  }

  return corrections;
}

// ── Empty result helper ──────────────────────────────────────────────────────

function _emptyResult(
  projectId: string,
  surveyId: string,
  log: string[],
): VisionAggregationResult {
  return {
    projectId,
    surveyId,
    aggregatedAt: new Date().toISOString(),
    pipelineVersion: VISION_PIPELINE_VERSION,
    obstructions: [],
    electricalNodes: [],
    planeCorrections: [],
    photosProcessed: 0,
    rawDetectionCount: 0,
    filteredCount: 0,
    classCounts: {},
    log,
    hasHighConfidenceDetections: false,
  };
}
