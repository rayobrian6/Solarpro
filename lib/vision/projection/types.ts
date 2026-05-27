// ============================================================================
// lib/vision/projection/types.ts — Projection Module Type Contracts
//
// Comprehensive type definitions for the Phase 4A homography-assisted
// roof-plane projection pipeline.
//
// ARCHITECTURE:
//   Photo (with EXIF) → Feature Matching → Homography Estimation → World Projection
//
// PROJECTION PRIORITY CHAIN (new → old):
//   1. homography_assisted  — camera model + known plane geometry (Phase 4A)
//   2. gps_azimuth_pitch   — GPS + compass bearing + tilt (original, now with EXIF FOV)
//   3. gps_centroid        — GPS only (original)
//   4. none                — (0,0) fallback (original)
//
// AUTHORITY SAFETY:
//   ALL Phase 4A outputs are CANDIDATE/PREVIEW-ONLY.
//   They NEVER mutate authoritative geometry, influence permits/NEC/BOM,
//   or bypass review-required enforcement.
//   FROZEN_AUTHORITY_FLAGS ensures all authority flags remain false.
//
// COORDINATE SYSTEMS:
//   ImageSpace:   pixel coordinates (0–width, 0–height)
//   Normalized:   0.0–1.0 fractions of image width/height
//   WorldSpace:   local XY meters from GPS origin (matches CAD engine geometry.ts)
// ============================================================================

import type { ExifData, ExifCameraParams, ExifGpsCoordinates } from '../exif/exifExtractor';

// ─── Feature Detection Types ──────────────────────────────────────────────────

/** Supported feature detector algorithms */
export type FeatureDetectorType = 'AKAZE' | 'SIFT' | 'ORB';

/** Quality rating for a feature matching result */
export type MatchQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'failed';

/** Result of feature detection on a single image */
export interface FeatureDetectionResult {
  /** Number of keypoints detected */
  keypointCount: number;
  /** Feature detector used */
  detector: FeatureDetectorType;
  /** Processing time in milliseconds */
  durationMs: number;
  /** Image dimensions */
  imageWidth: number;
  imageHeight: number;
  /** Whether detection succeeded */
  ok: true;
}

/** Result of feature matching between two images */
export interface FeatureMatchResult {
  /** Number of raw matches before filtering */
  rawMatchCount: number;
  /** Number of good matches after ratio test */
  goodMatchCount: number;
  /** Match quality rating */
  quality: MatchQuality;
  /** Match confidence 0.0–1.0 (computed from inlier ratio + count) */
  confidence: number;
  /** Feature detector used */
  detector: FeatureDetectorType;
  /** Processing time in milliseconds */
  durationMs: number;
  /** Whether matching succeeded (quality >= 'fair') */
  ok: boolean;
  /** Error message if matching failed */
  error?: string;
}

// ─── Homography Types ─────────────────────────────────────────────────────────

/** Result of homography estimation */
export interface HomographyResult {
  /** 3×3 homography matrix (row-major) */
  matrix: number[];
  /** Number of inlier matches that support this homography */
  inlierCount: number;
  /** Total matches tested */
  totalMatches: number;
  /** Inlier ratio (inlierCount / totalMatches) */
  inlierRatio: number;
  /** Confidence score 0.0–1.0 (based on inlier count + ratio + geometric validity) */
  confidence: number;
  /** Mean reprojection error in pixels */
  meanReprojectionError: number;
  /** Maximum reprojection error in pixels */
  maxReprojectionError: number;
  /** Whether the homography is geometrically valid (no extreme perspective distortion) */
  isGeometricallyValid: boolean;
  /** Method used for estimation */
  method: 'RANSAC' | 'LMEDS' | 'RHO';
  /** Processing time in milliseconds */
  durationMs: number;
  /** Whether estimation succeeded */
  ok: boolean;
  /** Error message if estimation failed */
  error?: string;
}

/** Reprojection error analysis for a set of point correspondences */
export interface ReprojectionErrorAnalysis {
  /** Mean error in pixels */
  meanError: number;
  /** Median error in pixels */
  medianError: number;
  /** Maximum error in pixels */
  maxError: number;
  /** Root mean square error */
  rmse: number;
  /** Number of points with error below threshold */
  inlierCount: number;
  /** Total points analyzed */
  totalCount: number;
  /** Inlier ratio */
  inlierRatio: number;
}

// ─── Projection Types ─────────────────────────────────────────────────────────

/** Projection methods available in the priority chain */
export type ProjectionMethod =
  | 'homography_assisted'  // Phase 4A: camera model + plane geometry
  | 'gps_azimuth_pitch'    // Original: GPS + compass + tilt
  | 'gps_centroid'         // Original: GPS only
  | 'none';                // Fallback: (0,0)

/** Result of projecting a detection from image space to world space */
export interface ProjectionResult {
  /** World X coordinate in meters from project origin */
  worldX: number;
  /** World Y coordinate in meters from project origin */
  worldY: number;
  /** Estimated footprint radius in meters */
  radiusM: number;
  /** Projection method used */
  method: ProjectionMethod;
  /** Confidence in this projection 0.0–1.0 */
  confidence: number;
  /** Reprojection error in pixels (if homography was used) */
  reprojectionError: number | null;
  /** Whether this is a candidate/preview result (always true for Phase 4A) */
  isCandidate: true;
  /** Whether human review is required before using this result */
  reviewRequired: true;
}

// ─── Authority Safety Types ────────────────────────────────────────────────────

/**
 * FROZEN authority flags — ALL must remain false.
 * These flags ensure Phase 4A outputs NEVER influence authoritative systems.
 *
 * CRITICAL CONSTRAINTS:
 *   - DO NOT build new CAD engine
 *   - DO NOT mutate authoritative geometry
 *   - DO NOT influence permits/NEC/BOM
 *   - DO NOT remove review-only enforcement
 *   - DO NOT fake confidence
 *   - ALL outputs are preview-only/candidate-only
 *   - ALL authority flags remain false
 *   - Fallback behavior preserves existing functionality
 */
export interface ProjectionAuthorityFlags {
  /** Whether this projection can modify CAD geometry — ALWAYS FALSE */
  canMutateCadGeometry: false;
  /** Whether this projection can influence permit calculations — ALWAYS FALSE */
  canInfluencePermits: false;
  /** Whether this projection can influence NEC compliance checks — ALWAYS FALSE */
  canInfluenceNec: false;
  /** Whether this projection can influence Bill of Materials — ALWAYS FALSE */
  canInfluenceBom: false;
  /** Whether this projection can be used without human review — ALWAYS FALSE */
  canBypassReview: false;
  /** Whether this projection's confidence is authoritative — ALWAYS FALSE */
  isConfidenceAuthoritative: false;
  /** Whether this projection can override manual entries — ALWAYS FALSE */
  canOverrideManual: false;
}

/** Singleton frozen authority flags — all false, always */
export const FROZEN_AUTHORITY_FLAGS: ProjectionAuthorityFlags = {
  canMutateCadGeometry: false,
  canInfluencePermits: false,
  canInfluenceNec: false,
  canInfluenceBom: false,
  canBypassReview: false,
  isConfidenceAuthoritative: false,
  canOverrideManual: false,
} as const;

/**
 * Runtime assertion that authority flags are safe (all false).
 * Call this at every projection output boundary.
 * Throws if any flag is true — fail-safe design.
 */
export function assertAuthorityFlagsSafe(flags: Partial<ProjectionAuthorityFlags> | Record<string, boolean | undefined>): void {
  const flagEntries = Object.entries(flags) as [keyof ProjectionAuthorityFlags, boolean | undefined][];

  for (const [key, value] of flagEntries) {
    if (value === true) {
      throw new Error(
        `AUTHORITY SAFETY VIOLATION: ProjectionAuthorityFlags.${key} is true. ` +
        `Phase 4A projections must NEVER have any authority flag set to true. ` +
        `All outputs are candidate/preview-only and require human review.`
      );
    }
  }
}

// ─── Photo-Plane Association ──────────────────────────────────────────────────

/** Association between a photo and a roof plane for homography estimation */
export interface PhotoPlaneAssociation {
  /** Photo file ID */
  fileId: string;
  /** Photo URL */
  fileUrl: string;
  /** Roof plane ID */
  roofPlaneId: string;
  /** EXIF data from the photo (if available) */
  exifData: ExifData | null;
  /** Confidence of this association 0.0–1.0 */
  associationConfidence: number;
  /** How the association was determined */
  associationMethod: 'gps_proximity' | 'photo_label' | 'user_assigned' | 'inferred';
}

// ─── Debug Visualization Types ────────────────────────────────────────────────

/** Request for debug visualization overlays */
export interface DebugVisualizationRequest {
  /** Whether to generate feature match overlays */
  showFeatureMatches: boolean;
  /** Whether to generate homography overlay */
  showHomography: boolean;
  /** Whether to generate projection overlay */
  showProjection: boolean;
  /** Maximum overlay image width in pixels */
  maxOverlayWidth: number;
  /** Output format for overlays */
  format: 'json_description' | 'svg' | 'png';
}

/** Description of a feature match overlay (debug only, not rendered) */
export interface FeatureMatchOverlayDescription {
  /** Number of keypoints in source image */
  sourceKeypointCount: number;
  /** Number of keypoints in target image */
  targetKeypointCount: number;
  /** Number of matches shown */
  matchCount: number;
  /** Match quality */
  quality: MatchQuality;
  /** Text description of overlay layout */
  description: string;
}

/** Description of a homography overlay (debug only, not rendered) */
export interface HomographyOverlayDescription {
  /** Number of inlier points */
  inlierCount: number;
  /** Mean reprojection error */
  meanReprojectionError: number;
  /** Corners of the projected region */
  projectedCorners: Array<{ x: number; y: number }>;
  /** Text description of overlay */
  description: string;
}

// ─── Default Parameters ───────────────────────────────────────────────────────

/** Default parameters for feature matching */
export const DEFAULT_FEATURE_MATCH_PARAMS = {
  /** Minimum number of good matches to consider matching successful */
  minGoodMatches: 10,
  /** Lowe's ratio test threshold (lower = stricter) */
  ratioTestThreshold: 0.75,
  /** Maximum distance in pixels for a match to be considered */
  maxMatchDistance: 300,
  /** Feature detector to try first */
  preferredDetector: 'AKAZE' as FeatureDetectorType,
  /** Fallback detector chain */
  fallbackDetectors: ['SIFT', 'ORB'] as FeatureDetectorType[],
} as const;

/** Default parameters for homography estimation */
export const DEFAULT_HOMOGRAPHY_PARAMS = {
  /** Minimum number of inliers to accept a homography */
  minInliers: 8,
  /** Minimum inlier ratio to accept a homography */
  minInlierRatio: 0.25,
  /** Minimum confidence to accept a homography */
  minConfidence: 0.35,
  /** Maximum reprojection error in pixels to consider a point an inlier */
  maxReprojectionErrorPx: 8.0,
  /** RANSAC confidence parameter */
  ransacConfidence: 0.995,
  /** Maximum iterations for RANSAC */
  ransacMaxIterations: 2000,
  /** Estimation method */
  method: 'RANSAC' as const,
} as const;

/** Default parameters for world projection */
export const DEFAULT_PROJECTION_PARAMS = {
  /** Minimum homography confidence to use homography-assisted projection */
  minHomographyConfidence: 0.35,
  /** Maximum reprojection error (px) for homography-assisted projection */
  maxReprojectionErrorPx: 8.0,
  /** Confidence boost factor when EXIF data supports the projection */
  exifConfidenceBoost: 1.15,
  /** Maximum world distance from photo GPS to accept projection (meters) */
  maxWorldDistanceM: 50,
} as const;
