/**
 * Depth estimation worker barrel exports.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export {
  runDepthWorker,
  runDepthFromReconstructionInput,
  DEPTH_WORKER_VERSION,
} from './runDepthWorker';

export type {
  DepthWorkerInput,
  DepthWorkerOutput,
  DepthFromReconstructionOutput,
} from './runDepthWorker';

export {
  estimateDepthWithMidas,
  isMidasEnabled,
  checkMidasHealth,
} from './midasClient';

export type {
  MidasDepthResult,
} from './midasClient';

export {
  decodeDepthMap,
  computeDepthStats,
  depthGridToRGBA,
  rgbaToBase64PNG,
  depthMapToHeatmapDataURL,
} from './depthMapDecode';

export type {
  ColormapName,
  DepthStatistics,
  DepthHeatmapOptions,
} from './depthMapDecode';

export {
  generateDepthQualityReport,
  isDepthUsableFor,
} from './depthQualityReport';

export type {
  DepthQualityGrade,
  DepthQualityReport,
  DepthQualityDimensions,
  DepthPurpose,
} from './depthQualityReport';

export {
  DepthCache,
  getGlobalDepthCache,
  resetGlobalDepthCache,
} from './depthCache';

export type {
  DepthCacheKey,
  DepthCacheEntry,
  DepthCacheStats,
  DepthCacheOptions,
} from './depthCache';

export {
  extractDepthPlanes,
} from './depthPlaneExtraction';

export type {
  DepthPlaneCandidate,
  DepthPlaneOptions,
  DepthPlaneExtractionResult,
} from './depthPlaneExtraction';

// Phase 0 — Depth-Class Contradiction Detection (WP-2)
export {
  isPhase0DepthContradictionEnabled,
  computeMaskMeanDepth,
  suggestReclassification,
  detectDepthContradictions,
  applyContradictionPenalty,
} from './depthContradictionDetector';

export type {
  DepthContradictionDetectorInput,
  DepthContradictionDetectorOutput,
} from './depthContradictionDetector';

export {
  DEPTH_CLASS_RANGES,
  computeDepthDeviation,
  classifyDeviation,
} from './depthContradictionRanges';

export type {
  DepthClassRange,
} from './depthContradictionRanges';
