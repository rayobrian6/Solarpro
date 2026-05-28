/**
 * Barrel exports for geometry reconstruction module.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

// Types
export type {
  GeometryReconstructionAuthority,
  SourcePhoto,
  SegmentationMask,
  DepthMap,
  SfMPointCloud,
  PlaneCandidate,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  LineCandidateType,
  LineCandidate,
  RidgeLineCandidate,
  EaveLineCandidate,
  RakeLineCandidate,
  SegmentationClass,
  NormalizedPoint,
  SemanticSegmentationMask,
  StructuralLineType,
  StructuralLineCandidate,
  VanishingPointArtifact,
  ConsensusPlaneCandidate,
  GeometryReconstructionArtifact,
  ArtifactTypeDiscriminator,
  GeometryReconstructionInput,
  JobStatus,
  GeometryReconstructionJob,
  GeometryReconstructionResult,
  GeometryReconstructionService,
  ValidationResult,
} from './types';

export {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
  ARTIFACT_TYPE_DISCRIMINATORS,
  SEGMENTATION_CLASSES,
} from './types';

// Schemas / validators
export {
  validateAuthority,
  validateSegmentationMask,
  validateDepthMap,
  validateSfMPointCloud,
  validatePlaneCandidate,
  validateRoofPlaneCandidate,
  validateWallPlaneCandidate,
  validateLineCandidate,
  validateSemanticSegmentationMask,
  validateStructuralLineCandidate,
  validateVanishingPointArtifact,
  validateConsensusPlaneCandidate,
  validateGeometryReconstructionArtifact,
} from './schemas';

// Mock adapter
export {
  generateMockArtifacts,
  mockGeometryReconstructionService,
} from './mockAdapter';

// Async job manager (heartbeat)
export {
  HEARTBEAT_TIMEOUT_MS,
  STUCK_JOB_THRESHOLD_MS,
  PIPELINE_STAGES,
  isHeartbeatStale,
  isJobStuck,
  computeProgress,
  buildNewJob,
  transitionToRunning,
  advanceStage,
  transitionToCompleted,
  transitionToFailed,
  transitionToCancelled,
  updateJobHeartbeat,
  markJobRunning,
  markJobCompleted,
  markJobFailed,
  cancelJobInDb,
  markStaleJobsFailed,
  insertArtifactWithProvenance,
} from './asyncJobManager';

export type {
  HeartbeatInfo,
  PipelineStage,
} from './asyncJobManager';
