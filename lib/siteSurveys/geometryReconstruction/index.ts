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
  validateGeometryReconstructionArtifact,
} from './schemas';

// Mock adapter
export {
  generateMockArtifacts,
  mockGeometryReconstructionService,
} from './mockAdapter';
