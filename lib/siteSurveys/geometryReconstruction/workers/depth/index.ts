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
