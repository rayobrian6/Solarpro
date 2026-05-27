// ============================================================================
// lib/vision/projection/index.ts — Barrel Exports
//
// Re-exports all Phase 4A projection module components.
// Import from './projection' to access the full projection pipeline.
// ============================================================================

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  FeatureDetectorType,
  FeatureMatchResult,
  MatchQuality,
  FeatureDetectionResult,
  HomographyResult,
  ReprojectionErrorAnalysis,
  ProjectionResult,
  ProjectionMethod,
  ProjectionAuthorityFlags,
  PhotoPlaneAssociation,
  DebugVisualizationRequest,
  FeatureMatchOverlayDescription,
  HomographyOverlayDescription,
} from './types';

export {
  FROZEN_AUTHORITY_FLAGS,
  assertAuthorityFlagsSafe,
  DEFAULT_FEATURE_MATCH_PARAMS,
  DEFAULT_HOMOGRAPHY_PARAMS,
  DEFAULT_PROJECTION_PARAMS,
} from './types';

// ─── Feature Matching ────────────────────────────────────────────────────────
export {
  matchFeatures,
  matchFeaturesWithFallback,
  assessMatchQuality,
  calculateMatchConfidence,
  selectDetector,
  matchAgainstMultiple,
} from './featureMatching';

export type { BatchMatchResult } from './featureMatching';

// ─── Homography Pipeline ─────────────────────────────────────────────────────
export {
  estimateHomography,
  estimateHomographyFromMatches,
  validateHomographyResult,
  isHomographyGeometricallyValid,
  projectPointWithHomography,
  projectBBoxWithHomography,
  computeReprojectionErrors,
  projectWithHomography,
  estimateRadiusFromProjection,
  HOMOGRAPHY_MIN_INLIERS,
  HOMOGRAPHY_MIN_CONFIDENCE,
  HOMOGRAPHY_MAX_REPROJ_ERROR_PX,
  HOMOGRAPHY_CONFIDENCE_BOOST,
} from './homographyPipeline';

export type { HomographyProjectionAttempt } from './homographyPipeline';

// ─── Debug Visualization ─────────────────────────────────────────────────────
export {
  isDebugModeEnabled,
  describeFeatureMatchOverlay,
  describeHomographyOverlay,
  generateDebugSummary,
  generateMatchSvg,
} from './debugVisualization';

export type { DebugSummary } from './debugVisualization';
