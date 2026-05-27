// ============================================================================
// lib/vision/projection/homographyPipeline.ts — Homography Estimation & Projection
//
// Full homography estimation and image-to-world projection pipeline.
//
// PIPELINE:
//   1. Receive matched keypoints from featureMatching.ts
//   2. Estimate homography matrix using RANSAC
//   3. Validate homography (geometric sanity + reprojection error)
//   4. Project detection bboxes from image space to world space
//   5. Return ProjectionResult with confidence and authority flags
//
// HOMOGRAPHY ESTIMATION:
//   Uses the Python OpenCV worker's cv2.findHomography(pts1, pts2, cv2.RANSAC)
//   The 3x3 matrix H maps: world_pt = H * image_pt (homogeneous coords)
//
// PROJECTION FORMULA:
//   Given homography H and image point (u, v):
//     p = H * [u, v, 1]^T
//     world_x = p[0] / p[2]  (perspective divide)
//     world_y = p[1] / p[2]
//
// VALIDATION:
//   - Minimum inlier count (>= HOMOGRAPHY_MIN_INLIERS)
//   - Minimum confidence (>= HOMOGRAPHY_MIN_CONFIDENCE)
//   - Maximum reprojection error (<= HOMOGRAPHY_MAX_REPROJ_ERROR_PX)
//   - Geometric validity (no extreme perspective distortion)
//
// AUTHORITY SAFETY:
//   ALL outputs have:
//     isCandidate: true
//     reviewRequired: true
//     All FROZEN_AUTHORITY_FLAGS = false
//   Projections NEVER mutate authoritative geometry.
//
// ============================================================================

import {
  type HomographyResult,
  type ProjectionResult,
  type ProjectionMethod,
  type ReprojectionErrorAnalysis,
  FROZEN_AUTHORITY_FLAGS,
  assertAuthorityFlagsSafe,
  DEFAULT_HOMOGRAPHY_PARAMS,
  DEFAULT_PROJECTION_PARAMS,
} from './types';

import type { FeatureMatchResult } from './types';

import type { ExifData, ExifCameraParams } from '../exif/exifExtractor';
import { computeFieldOfView, getDefaultSmartphoneFov } from '../exif/exifExtractor';

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Minimum number of inliers to accept a homography */
export const HOMOGRAPHY_MIN_INLIERS = 8;

/** Minimum confidence to accept a homography */
export const HOMOGRAPHY_MIN_CONFIDENCE = 0.35;

/** Maximum mean reprojection error in pixels */
export const HOMOGRAPHY_MAX_REPROJ_ERROR_PX = 8.0;

/** Confidence boost when EXIF data is available and consistent */
export const HOMOGRAPHY_CONFIDENCE_BOOST = 1.15;

/** Default OpenCV worker URL */
const DEFAULT_OPEN_SOURCE_PHOTO_VISION_WORKER_URL = 'https://solarpro.onrender.com';

/** Request timeout for worker calls (15 seconds) */
const WORKER_TIMEOUT_MS = 15_000;

// ─── Worker Communication ─────────────────────────────────────────────────────

/** Request to estimate homography on the Python worker */
interface HomographyEstimateRequest {
  /** Source image keypoints (normalized 0–1) */
  sourcePoints: Array<{ x: number; y: number }>;
  /** Target image keypoints (normalized 0–1) */
  targetPoints: Array<{ x: number; y: number }>;
  /** Estimation method */
  method: 'RANSAC' | 'LMEDS' | 'RHO';
  /** RANSAC reprojection threshold in pixels */
  ransacReprojThreshold: number;
  /** Maximum RANSAC iterations */
  maxIterations: number;
  /** RANSAC confidence */
  confidence: number;
}

/** Response from the Python worker homography endpoint */
interface HomographyEstimateResponse {
  success: boolean;
  /** 3x3 homography matrix (row-major, 9 elements) */
  matrix?: number[];
  /** Number of inlier matches */
  inlierCount?: number;
  /** Total matches */
  totalMatches?: number;
  /** Mean reprojection error */
  meanReprojectionError?: number;
  /** Max reprojection error */
  maxReprojectionError?: number;
  /** Inlier mask (boolean array) */
  inlierMask?: boolean[];
  /** Processing time on worker (ms) */
  workerDurationMs?: number;
  /** Error message */
  error?: string;
}

/**
 * Call the Python worker to estimate homography.
 */
async function callWorkerEstimateHomography(
  request: HomographyEstimateRequest,
  workerUrl: string,
): Promise<HomographyEstimateResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);

  try {
    const response = await fetch(`${workerUrl}/vision/estimate-homography`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Worker returned HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    return data as HomographyEstimateResponse;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: `Worker request timed out after ${WORKER_TIMEOUT_MS}ms` };
    }
    return { success: false, error: `Worker request failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Homography Estimation ────────────────────────────────────────────────────

/**
 * Estimate a homography matrix from matched feature points.
 *
 * @param sourcePoints - Keypoints in source image (normalized 0–1)
 * @param targetPoints - Corresponding keypoints in target image (normalized 0–1)
 * @param options - Estimation parameters
 * @returns Homography result with validation status
 *
 * SAFETY: Never throws. Returns failed HomographyResult on errors.
 */
export async function estimateHomography(
  sourcePoints: Array<{ x: number; y: number }>,
  targetPoints: Array<{ x: number; y: number }>,
  options?: {
    method?: 'RANSAC' | 'LMEDS' | 'RHO';
    ransacReprojThreshold?: number;
    maxIterations?: number;
    confidence?: number;
    workerUrl?: string;
  },
): Promise<HomographyResult> {
  const startMs = Date.now();
  const method = options?.method ?? DEFAULT_HOMOGRAPHY_PARAMS.method;
  const ransacReprojThreshold = options?.ransacReprojThreshold ?? DEFAULT_HOMOGRAPHY_PARAMS.maxReprojectionErrorPx;
  const maxIterations = options?.maxIterations ?? DEFAULT_HOMOGRAPHY_PARAMS.ransacMaxIterations;
  const confidence = options?.confidence ?? DEFAULT_HOMOGRAPHY_PARAMS.ransacConfidence;
  const workerUrl = options?.workerUrl ?? getWorkerUrl();

  try {
    // Validate input
    if (sourcePoints.length < 4 || targetPoints.length < 4) {
      return {
        matrix: [],
        inlierCount: 0,
        totalMatches: Math.min(sourcePoints.length, targetPoints.length),
        inlierRatio: 0,
        confidence: 0,
        meanReprojectionError: Infinity,
        maxReprojectionError: Infinity,
        isGeometricallyValid: false,
        method,
        durationMs: Date.now() - startMs,
        ok: false,
        error: `Need at least 4 point correspondences, got ${Math.min(sourcePoints.length, targetPoints.length)}`,
      };
    }

    if (sourcePoints.length !== targetPoints.length) {
      return {
        matrix: [],
        inlierCount: 0,
        totalMatches: 0,
        inlierRatio: 0,
        confidence: 0,
        meanReprojectionError: Infinity,
        maxReprojectionError: Infinity,
        isGeometricallyValid: false,
        method,
        durationMs: Date.now() - startMs,
        ok: false,
        error: 'Source and target point arrays must have the same length',
      };
    }

    const request: HomographyEstimateRequest = {
      sourcePoints,
      targetPoints,
      method,
      ransacReprojThreshold,
      maxIterations,
      confidence,
    };

    const response = await callWorkerEstimateHomography(request, workerUrl);

    if (!response.success || !response.matrix) {
      return {
        matrix: [],
        inlierCount: response.inlierCount ?? 0,
        totalMatches: response.totalMatches ?? sourcePoints.length,
        inlierRatio: 0,
        confidence: 0,
        meanReprojectionError: Infinity,
        maxReprojectionError: Infinity,
        isGeometricallyValid: false,
        method,
        durationMs: Date.now() - startMs,
        ok: false,
        error: response.error ?? 'Homography estimation failed on worker',
      };
    }

    const totalMatches = response.totalMatches ?? sourcePoints.length;
    const inlierCount = response.inlierCount ?? 0;
    const inlierRatio = totalMatches > 0 ? inlierCount / totalMatches : 0;
    const meanReprojErr = response.meanReprojectionError ?? Infinity;
    const maxReprojErr = response.maxReprojectionError ?? Infinity;

    // Compute confidence
    let homographyConfidence = computeHomographyConfidence(inlierCount, inlierRatio, meanReprojErr);

    // Check geometric validity
    const isGeometricallyValid = isHomographyGeometricallyValid(response.matrix);

    // Apply validity penalty
    if (!isGeometricallyValid) {
      homographyConfidence *= 0.3;
    }

    const ok = inlierCount >= HOMOGRAPHY_MIN_INLIERS &&
               homographyConfidence >= HOMOGRAPHY_MIN_CONFIDENCE &&
               meanReprojErr <= HOMOGRAPHY_MAX_REPROJ_ERROR_PX &&
               isGeometricallyValid;

    return {
      matrix: response.matrix,
      inlierCount,
      totalMatches,
      inlierRatio,
      confidence: homographyConfidence,
      meanReprojectionError: meanReprojErr,
      maxReprojectionError: maxReprojErr,
      isGeometricallyValid,
      method,
      durationMs: Date.now() - startMs,
      ok,
      error: ok ? undefined : `Homography quality insufficient: inliers=${inlierCount} (min=${HOMOGRAPHY_MIN_INLIERS}), conf=${homographyConfidence.toFixed(3)} (min=${HOMOGRAPHY_MIN_CONFIDENCE}), reprojErr=${meanReprojErr.toFixed(1)}px (max=${HOMOGRAPHY_MAX_REPROJ_ERROR_PX})`,
    };
  } catch (err) {
    return {
      matrix: [],
      inlierCount: 0,
      totalMatches: sourcePoints.length,
      inlierRatio: 0,
      confidence: 0,
      meanReprojectionError: Infinity,
      maxReprojectionError: Infinity,
      isGeometricallyValid: false,
      method,
      durationMs: Date.now() - startMs,
      ok: false,
      error: `Homography estimation exception: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Estimate homography from an existing FeatureMatchResult that includes
 * matched point coordinates.
 */
export async function estimateHomographyFromMatches(
  matchResult: FeatureMatchResult,
  matchedPoints?: {
    source: Array<{ x: number; y: number }>;
    target: Array<{ x: number; y: number }>;
  },
  options?: {
    method?: 'RANSAC' | 'LMEDS' | 'RHO';
    workerUrl?: string;
  },
): Promise<HomographyResult> {
  // If no matched points provided, we can't estimate homography
  if (!matchedPoints || matchedPoints.source.length < 4) {
    return {
      matrix: [],
      inlierCount: 0,
      totalMatches: matchResult.goodMatchCount,
      inlierRatio: 0,
      confidence: 0,
      meanReprojectionError: Infinity,
      maxReprojectionError: Infinity,
      isGeometricallyValid: false,
      method: options?.method ?? 'RANSAC',
      durationMs: 0,
      ok: false,
      error: `Insufficient matched points for homography: ${matchedPoints?.source.length ?? 0} (need >= 4)`,
    };
  }

  return estimateHomography(
    matchedPoints.source,
    matchedPoints.target,
    options,
  );
}

// ─── Homography Validation ────────────────────────────────────────────────────

/**
 * Compute confidence score for a homography result.
 *
 * Based on:
 *   - Inlier count (more = better, with diminishing returns)
 *   - Inlier ratio (higher = more geometrically consistent)
 *   - Reprojection error (lower = more accurate)
 *
 * CONFIDENCE IS NEVER FAKED.
 */
function computeHomographyConfidence(
  inlierCount: number,
  inlierRatio: number,
  meanReprojError: number,
): number {
  // Inlier count confidence (logarithmic scaling)
  const countConf = Math.min(1.0, Math.log2(inlierCount + 1) / Math.log2(33));

  // Inlier ratio confidence (squared to penalize low ratios)
  const ratioConf = Math.pow(inlierRatio, 0.7);

  // Reprojection error confidence (inverse, with floor at 0)
  let errorConf = 0.5;
  if (meanReprojError < 2.0) {
    errorConf = 1.0;
  } else if (meanReprojError < 4.0) {
    errorConf = 0.8;
  } else if (meanReprojError < 6.0) {
    errorConf = 0.6;
  } else if (meanReprojError < 8.0) {
    errorConf = 0.4;
  } else if (meanReprojError < 12.0) {
    errorConf = 0.2;
  } else {
    errorConf = 0.0;
  }

  // Weighted combination
  return Math.min(1.0, countConf * 0.35 + ratioConf * 0.35 + errorConf * 0.30);
}

/**
 * Check if a homography matrix is geometrically valid.
 *
 * A valid homography should not:
 *   - Have extreme scale differences (indicates degenerate case)
 *   - Produce negative or near-zero determinant (reflection or singular)
 *   - Have extreme perspective distortion (vanishing point too close)
 */
export function isHomographyGeometricallyValid(matrix: number[]): boolean {
  if (matrix.length !== 9) return false;

  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = matrix;

  // Check determinant (should be positive and not too small)
  const det = h00 * (h11 * h22 - h12 * h21) -
              h01 * (h10 * h22 - h12 * h20) +
              h02 * (h10 * h21 - h11 * h20);

  if (Math.abs(det) < 1e-10) return false;  // Singular
  if (det < 0) return false;  // Reflection

  // Check scale consistency (diagonal elements should be same order of magnitude)
  const scaleX = Math.sqrt(h00 * h00 + h10 * h10);
  const scaleY = Math.sqrt(h01 * h01 + h11 * h11);

  if (scaleX < 0.01 || scaleY < 0.01) return false;  // Extreme downscale
  if (scaleX > 100 || scaleY > 100) return false;     // Extreme upscale

  const scaleRatio = Math.max(scaleX, scaleY) / Math.min(scaleX, scaleY);
  if (scaleRatio > 10) return false;  // Extreme anisotropy

  // Check perspective distortion (h20, h21 should be small relative to h22)
  if (Math.abs(h22) < 1e-10) return false;
  const perspectiveRatio = Math.max(Math.abs(h20), Math.abs(h21)) / Math.abs(h22);
  if (perspectiveRatio > 0.5) return false;  // Extreme perspective

  return true;
}

/**
 * Validate a complete HomographyResult against quality thresholds.
 */
export function validateHomographyResult(result: HomographyResult): {
  valid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (result.inlierCount < HOMOGRAPHY_MIN_INLIERS) {
    reasons.push(`Inlier count ${result.inlierCount} < minimum ${HOMOGRAPHY_MIN_INLIERS}`);
  }
  if (result.confidence < HOMOGRAPHY_MIN_CONFIDENCE) {
    reasons.push(`Confidence ${result.confidence.toFixed(3)} < minimum ${HOMOGRAPHY_MIN_CONFIDENCE}`);
  }
  if (result.meanReprojectionError > HOMOGRAPHY_MAX_REPROJ_ERROR_PX) {
    reasons.push(`Reprojection error ${result.meanReprojectionError.toFixed(1)}px > maximum ${HOMOGRAPHY_MAX_REPROJ_ERROR_PX}px`);
  }
  if (!result.isGeometricallyValid) {
    reasons.push('Homography failed geometric validity check');
  }

  return { valid: reasons.length === 0, reasons };
}

// ─── Point Projection ─────────────────────────────────────────────────────────

/**
 * Project a single point from image space to world space using a homography matrix.
 *
 * Formula: world = H * [u, v, 1]^T, then perspective divide.
 *
 * @param imageX - X coordinate in image space (0–1 normalized or pixel)
 * @param imageY - Y coordinate in image space (0–1 normalized or pixel)
 * @param homography - 3x3 homography matrix (row-major)
 * @returns World coordinates { worldX, worldY }
 */
export function projectPointWithHomography(
  imageX: number,
  imageY: number,
  homography: number[],
): { worldX: number; worldY: number } | null {
  if (homography.length !== 9) return null;

  const [h00, h01, h02, h10, h11, h12, h20, h21, h22] = homography;

  // Apply homography: p = H * [x, y, 1]^T
  const px = h00 * imageX + h01 * imageY + h02;
  const py = h10 * imageX + h11 * imageY + h12;
  const pz = h20 * imageX + h21 * imageY + h22;

  // Perspective divide
  if (Math.abs(pz) < 1e-10) return null;

  return {
    worldX: px / pz,
    worldY: py / pz,
  };
}

/**
 * Project a bounding box from image space to world space using homography.
 *
 * Projects all four corners of the bbox, then computes:
 *   - World centroid (mean of corner projections)
 *   - World radius (max distance from centroid to any corner)
 *
 * @param bbox - Bounding box in normalized coordinates (0–1)
 * @param homography - 3x3 homography matrix (row-major)
 * @returns World projection with centroid and radius
 */
export function projectBBoxWithHomography(
  bbox: { x: number; y: number; width: number; height: number },
  homography: number[],
): ProjectionResult | null {
  // Compute four corners
  const left = bbox.x - bbox.width / 2;
  const right = bbox.x + bbox.width / 2;
  const top = bbox.y - bbox.height / 2;
  const bottom = bbox.y + bbox.height / 2;

  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  const projectedCorners = corners.map(c => projectPointWithHomography(c.x, c.y, homography));

  // Check all corners projected successfully
  if (projectedCorners.some(p => p === null)) return null;

  const validCorners = projectedCorners as Array<{ worldX: number; worldY: number }>;

  // Compute centroid
  const worldX = validCorners.reduce((s, c) => s + c.worldX, 0) / validCorners.length;
  const worldY = validCorners.reduce((s, c) => s + c.worldY, 0) / validCorners.length;

  // Compute radius (max distance from centroid to any corner)
  let maxDist = 0;
  for (const c of validCorners) {
    const dx = c.worldX - worldX;
    const dy = c.worldY - worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) maxDist = dist;
  }

  const radiusM = Math.max(0.10, maxDist);

  // Enforce authority safety — ALL Phase 4A outputs are candidate-only
  assertAuthorityFlagsSafe(FROZEN_AUTHORITY_FLAGS);

  return {
    worldX,
    worldY,
    radiusM,
    method: 'homography_assisted',
    confidence: 0,  // Will be set by the calling function
    reprojectionError: null,  // Will be computed separately
    isCandidate: true,
    reviewRequired: true,
  };
}

// ─── Reprojection Error Computation ───────────────────────────────────────────

/**
 * Compute reprojection errors for a set of point correspondences.
 *
 * For each correspondence (src → tgt), computes:
 *   projected = H * src
 *   error = ||projected - tgt||
 */
export function computeReprojectionErrors(
  sourcePoints: Array<{ x: number; y: number }>,
  targetPoints: Array<{ x: number; y: number }>,
  homography: number[],
): ReprojectionErrorAnalysis {
  const errors: number[] = [];

  for (let i = 0; i < sourcePoints.length; i++) {
    const projected = projectPointWithHomography(sourcePoints[i].x, sourcePoints[i].y, homography);
    if (projected) {
      const dx = projected.worldX - targetPoints[i].x;
      const dy = projected.worldY - targetPoints[i].y;
      errors.push(Math.sqrt(dx * dx + dy * dy));
    }
  }

  if (errors.length === 0) {
    return {
      meanError: Infinity,
      medianError: Infinity,
      maxError: Infinity,
      rmse: Infinity,
      inlierCount: 0,
      totalCount: sourcePoints.length,
      inlierRatio: 0,
    };
  }

  const sorted = [...errors].sort((a, b) => a - b);
  const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length);

  const inlierThreshold = DEFAULT_HOMOGRAPHY_PARAMS.maxReprojectionErrorPx;
  const inlierCount = errors.filter(e => e <= inlierThreshold).length;

  return {
    meanError: mean,
    medianError: median,
    maxError: max,
    rmse,
    inlierCount,
    totalCount: sourcePoints.length,
    inlierRatio: inlierCount / sourcePoints.length,
  };
}

// ─── Complete Projection Pipeline ─────────────────────────────────────────────

/**
 * Result of the full homography-assisted projection attempt.
 */
export interface HomographyProjectionAttempt {
  /** Whether homography-assisted projection succeeded */
  success: boolean;
  /** Projection result (if successful) */
  projection: ProjectionResult | null;
  /** Homography result details */
  homography: HomographyResult | null;
  /** EXIF data used (if any) */
  exifUsed: boolean;
  /** Confidence after EXIF boost (if applicable) */
  boostedConfidence: number | null;
  /**
   * Fallback method recommended if homography fails (legacy field for projection chain).
   * For Phase 4A failures, see fallbackReason for specific error details.
   */
  fallbackMethod: ProjectionMethod;
  /**
   * Specific reason why homography failed (Phase 4A diagnostic).
   * Only populated when success=false.
   * Values: "missing_reference_image", "feature_matching_failed", "homography_worker_failed", "insufficient_inliers", "reprojection_error_too_high"
   */
  fallbackReason?: string;
}

/**
 * Attempt homography-assisted projection for a single detection.
 *
 * This is the top-level function that the visionAggregator calls
 * as the first step in the 4-tier projection priority chain.
 *
 * Steps:
 *   1. Check if EXIF data is available (for FOV and camera model)
 *   2. If matched points available, estimate homography
 *   3. Validate homography against quality thresholds
 *   4. Project detection bbox to world coordinates
 *   5. Apply EXIF confidence boost if applicable
 *   6. Return result with authority safety flags enforced
 *
 * If homography fails, returns success=false with the recommended
 * fallback method (gps_azimuth_pitch, gps_centroid, or none).
 */
export async function projectWithHomography(
  detection: {
    class: string;
    confidence: number;
    bbox: { x: number; y: number; width: number; height: number };
  },
  matchedPoints: {
    source: Array<{ x: number; y: number }>;
    target: Array<{ x: number; y: number }>;
  } | null,
  exifData: ExifData | null,
  options?: {
    workerUrl?: string;
    homographyMethod?: 'RANSAC' | 'LMEDS' | 'RHO';
  },
): Promise<HomographyProjectionAttempt> {
  // Step 1: Determine fallback method based on available metadata
  let fallbackMethod: ProjectionMethod = 'none';
  if (exifData?.gps) {
    fallbackMethod = 'gps_azimuth_pitch';
  }

  // Step 2: If no matched points, homography is impossible
  if (!matchedPoints || matchedPoints.source.length < 4) {
    return {
      success: false,
      projection: null,
      homography: null,
      exifUsed: false,
      boostedConfidence: null,
      fallbackMethod,
      fallbackReason: matchedPoints ? 'insufficient_inliers' : 'feature_matching_failed',
    };
  }

  // Step 3: Estimate homography
  const homography = await estimateHomography(
    matchedPoints.source,
    matchedPoints.target,
    {
      method: options?.homographyMethod ?? 'RANSAC',
      workerUrl: options?.workerUrl,
    },
  );

  if (!homography.ok) {
    return {
      success: false,
      projection: null,
      homography,
      exifUsed: false,
      boostedConfidence: null,
      fallbackMethod,
      fallbackReason: 'homography_worker_failed',
    };
  }

  // Step 4: Project bbox to world coordinates
  const projection = projectBBoxWithHomography(detection.bbox, homography.matrix);

  if (!projection) {
    return {
      success: false,
      projection: null,
      homography,
      exifUsed: false,
      boostedConfidence: null,
      fallbackMethod,
      fallbackReason: 'reprojection_error_too_high',
    };
  }

  // Step 5: Compute projection confidence
  let projectionConfidence = homography.confidence;

  // Apply EXIF confidence boost if EXIF data is available and consistent
  let exifUsed = false;
  let boostedConfidence: number | null = null;

  if (exifData?.camera) {
    const fov = computeFieldOfView(exifData.camera);
    if (fov && fov.confidence >= 0.5) {
      // EXIF FOV is consistent with our projection — boost confidence
      projectionConfidence *= HOMOGRAPHY_CONFIDENCE_BOOST;
      projectionConfidence = Math.min(1.0, projectionConfidence);
      boostedConfidence = projectionConfidence;
      exifUsed = true;
    }
  }

  // Step 6: Apply confidence and authority flags
  const finalProjection: ProjectionResult = {
    ...projection,
    confidence: projectionConfidence,
    reprojectionError: homography.meanReprojectionError,
    isCandidate: true,      // ALWAYS true for Phase 4A
    reviewRequired: true,    // ALWAYS true for Phase 4A
  };

  // Authority safety assertion at output boundary
  assertAuthorityFlagsSafe(FROZEN_AUTHORITY_FLAGS);

  return {
    success: true,
    projection: finalProjection,
    homography,
    exifUsed,
    boostedConfidence,
    fallbackMethod,
  };
}

// ─── Radius Estimation ────────────────────────────────────────────────────────

/**
 * Estimate the world-space radius of a detection from its projection.
 *
 * Uses the homography to project the bbox corners and measure the
 * resulting footprint. Falls back to a default if projection is unreliable.
 */
export function estimateRadiusFromProjection(
  bbox: { x: number; y: number; width: number; height: number },
  homography: number[],
  imageWidth: number,
  imageHeight: number,
): number {
  const left = bbox.x - bbox.width / 2;
  const right = bbox.x + bbox.width / 2;
  const top = bbox.y - bbox.height / 2;
  const bottom = bbox.y + bbox.height / 2;

  // Project all four corners
  const corners = [
    projectPointWithHomography(left, top, homography),
    projectPointWithHomography(right, top, homography),
    projectPointWithHomography(right, bottom, homography),
    projectPointWithHomography(left, bottom, homography),
  ];

  const validCorners = corners.filter((c): c is { worldX: number; worldY: number } => c !== null);

  if (validCorners.length < 2) {
    // Can't compute from projection — use default
    return 0.40;
  }

  // Compute side lengths
  const dx = Math.abs(validCorners[0].worldX - validCorners[validCorners.length - 1].worldX);
  const dy = Math.abs(validCorners[0].worldY - validCorners[validCorners.length - 1].worldY);

  // Use the smaller dimension as radius estimate
  const minSide = Math.min(dx, dy);
  const radius = minSide / 2;

  // Clamp to reasonable range
  return Math.max(0.10, Math.min(radius, 5.0));
}

// ─── Worker URL Resolution ────────────────────────────────────────────────────

function getWorkerUrl(): string {
  return process.env.OPEN_SOURCE_PHOTO_VISION_WORKER_URL ?? DEFAULT_OPEN_SOURCE_PHOTO_VISION_WORKER_URL;
}
