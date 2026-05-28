/**
 * Segmentation worker barrel exports.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export {
  runSegmentationWorker,
  runSegmentationFromReconstructionInput,
  SEGMENTATION_WORKER_VERSION,
} from './runSegmentationWorker';

export type {
  SegmentationWorkerInput,
  SegmentationWorkerOutput,
} from './runSegmentationWorker';

export {
  cleanMask,
  cleanSegmentationMask,
  douglasPeucker,
  convexHull,
  polygonArea,
  polygonPerimeter,
} from './maskCleanup';

export type {
  MaskCleanupConfig,
  MaskCleanupResult,
} from './maskCleanup';
