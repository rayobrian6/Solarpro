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
