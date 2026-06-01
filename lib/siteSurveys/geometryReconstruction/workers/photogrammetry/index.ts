/**
 * Photogrammetry worker barrel exports.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

export {
  runPhotogrammetryWorker,
  runPhotogrammetryFromReconstructionInput,
  PHOTOGRAMMETRY_WORKER_VERSION,
} from './runPhotogrammetryWorker';

export type {
  PhotogrammetryWorkerInput,
  PhotogrammetryWorkerOutput,
} from './runPhotogrammetryWorker';

export {
  unprojectDepthMap,
  unprojectDepthMapDefault,
  intrinsicsFromFOV,
  defaultPhoneIntrinsics,
} from './depthUnprojection';

export type {
  CameraIntrinsics,
  CameraExtrinsics,
  Point3D,
  UnprojectionResult,
  UnprojectionOptions,
} from './depthUnprojection';

export {
  fuseDepthMaps,
  alignDepthMaps,
  voxelGridFilter,
  removeStatisticalOutliers,
} from './depthFusion';

export type {
  AlignmentParams,
  DepthFusionResult,
  DepthFusionOptions,
} from './depthFusion';

export {
  meshFromDepth,
  fitPlaneRansac,
  triangulatePoints2D,
} from './meshFromDepth';

export type {
  Triangle,
  FittedPlane,
  MeshPatch,
  MeshFromDepthResult,
  MeshFromDepthOptions,
} from './meshFromDepth';
