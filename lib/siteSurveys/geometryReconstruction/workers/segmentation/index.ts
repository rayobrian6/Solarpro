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
