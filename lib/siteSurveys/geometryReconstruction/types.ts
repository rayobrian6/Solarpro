/**
 * Geometry reconstruction types — research spike scaffold.
 *
 * All artifacts are review-only operator aids. They must NEVER be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

// ---------------------------------------------------------------------------
// Re-export coordinate types from overlayCoordinateConversion for convenience
// ---------------------------------------------------------------------------

export type { NormalizedRegion, NormalizedLine } from '@/lib/assistedEvidenceSources/overlayCoordinateConversion';

// ---------------------------------------------------------------------------
// Authority envelope
// ---------------------------------------------------------------------------

/** Authority envelope — review-only, never authoritative. */
export interface GeometryReconstructionAuthority {
  /** This artifact is for operator review only. */
  reviewOnly: true;
  /** This artifact is not authoritative geometry. */
  nonAuthoritative: true;
  /** Must always be false — reconstruction artifacts cannot mutate CAD. */
  cadMutationAllowed: false;
  /** Must always be false — reconstruction artifacts cannot generate permits. */
  permitGenerationAllowed: false;
  /** Must always be false — reconstruction artifacts cannot mutate BOM. */
  bomMutationAllowed: false;
}

/** Frozen authority envelope — every artifact carries this exact value. */
export const REVIEW_ONLY_AUTHORITY: GeometryReconstructionAuthority = {
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
} as const;

/** Base limitations every artifact bundle must include. */
export const BASE_LIMITATIONS: readonly string[] = [
  'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
  'These artifacts are operator review aids only and cannot mutate CAD, permits, BOM, or engineering workflows.',
] as const;

// ---------------------------------------------------------------------------
// Source photo
// ---------------------------------------------------------------------------

/** A source photo fed into reconstruction. */
export interface SourcePhoto {
  fileId: string;
  fileUrl: string;
  filename: string | null;
  /** EXIF or user-provided camera angle metadata if available. */
  captureMetadata?: {
    altitude?: number;
    azimuth?: number;
    pitch?: number;
    fov?: number;
  };
}

// ---------------------------------------------------------------------------
// Artifact types
// ---------------------------------------------------------------------------

/** Segmentation mask artifact — per-pixel class labels. */
export interface SegmentationMask {
  artifactType: 'segmentation_mask';
  fileId: string;
  /** Width of the mask grid. */
  width: number;
  /** Height of the mask grid. */
  height: number;
  /** Flat Uint16 array (row-major) of class IDs. Stored as base64 or JSON. */
  maskData: string;
  /** Class ID → human-readable label. */
  classLabels: Record<number, string>;
  /** Optional bounding region in normalized coords. */
  region?: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion;
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Depth map artifact — per-pixel estimated depth. */
export interface DepthMap {
  artifactType: 'depth_map';
  fileId: string;
  width: number;
  height: number;
  /** Flat Float32 array (row-major) of depth values. Stored as base64. */
  depthData: string;
  /** Metric the depth values represent (e.g., "meters", "disparity"). */
  depthMetric: string;
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** SfM point cloud from multi-view reconstruction. */
export interface SfMPointCloud {
  artifactType: 'sfm_point_cloud';
  /** Number of 3D points. */
  pointCount: number;
  /** Flat Float32 array [x,y,z,x,y,z,...] in local coordinates. Stored as base64. */
  pointsData: string;
  /** Number of source photos used. */
  sourcePhotoCount: number;
  /** IDs of source photos. */
  sourceFileIds: string[];
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** A plane candidate extracted from geometry. */
export interface PlaneCandidate {
  artifactType: 'plane_candidate';
  /** Normal vector [nx, ny, nz]. */
  normal: [number, number, number];
  /** Distance from origin along normal. */
  d: number;
  /** Inlier count from RANSAC. */
  inlierCount: number;
  /** Total points tested. */
  totalPoints: number;
  /** Bounding region in a reference photo (normalized coords). */
  region?: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion;
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Roof plane candidate — specialized plane (does not extend PlaneCandidate due to discriminator narrowing). */
export interface RoofPlaneCandidate {
  artifactType: 'roof_plane_candidate';
  /** Normal vector [nx, ny, nz]. */
  normal: [number, number, number];
  /** Distance from origin along normal. */
  d: number;
  /** Inlier count from RANSAC. */
  inlierCount: number;
  /** Total points tested. */
  totalPoints: number;
  /** Bounding region in a reference photo (normalized coords). */
  region?: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion;
  /** Estimated slope in degrees. */
  slopeDegrees: number;
  /** Estimated aspect/azimuth in degrees. */
  aspectDegrees: number;
  /** Ridge/eave/rake associations. */
  associatedLineIds: string[];
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Wall plane candidate — specialized plane (does not extend PlaneCandidate due to discriminator narrowing). */
export interface WallPlaneCandidate {
  artifactType: 'wall_plane_candidate';
  /** Normal vector [nx, ny, nz]. */
  normal: [number, number, number];
  /** Distance from origin along normal. */
  d: number;
  /** Inlier count from RANSAC. */
  inlierCount: number;
  /** Total points tested. */
  totalPoints: number;
  /** Bounding region in a reference photo (normalized coords). */
  region?: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion;
  /** Estimated height in meters (if derivable). */
  estimatedHeightM?: number;
  /** Which direction the wall faces. */
  facingDirection?: string;
  /** Ridge/eave/rake associations. */
  associatedLineIds: string[];
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Line candidate types. */
export type LineCandidateType = 'ridge_line_candidate' | 'eave_line_candidate' | 'rake_line_candidate';

/** A structural line candidate. */
export interface LineCandidate {
  artifactType: LineCandidateType;
  /** 3D start point [x, y, z]. */
  startPoint: [number, number, number];
  /** 3D end point [x, y, z]. */
  endPoint: [number, number, number];
  /** 2D projection onto a reference photo (normalized coords). */
  projection?: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedLine;
  /** Length in meters (if derivable). */
  estimatedLengthM?: number;
  confidence: number;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Convenience aliases. */
export type RidgeLineCandidate = LineCandidate & { artifactType: 'ridge_line_candidate' };
export type EaveLineCandidate = LineCandidate & { artifactType: 'eave_line_candidate' };
export type RakeLineCandidate = LineCandidate & { artifactType: 'rake_line_candidate' };

// ---------------------------------------------------------------------------
// Semantic segmentation — polygon-based masks (Phase 1)
// ---------------------------------------------------------------------------

/** Semantic class labels for segmentation. */
export type SegmentationClass =
  | 'roof'
  | 'wall'
  | 'sky'
  | 'tree'
  | 'ground'
  | 'obstruction'
  | 'equipment';

/** All recognized segmentation classes. */
export const SEGMENTATION_CLASSES: readonly SegmentationClass[] = [
  'roof',
  'wall',
  'sky',
  'tree',
  'ground',
  'obstruction',
  'equipment',
] as const;

/** A 2D point in normalized image coordinates (0-1000). */
export interface NormalizedPoint {
  x: number;
  y: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/** Semantic segmentation mask — polygon-based per-class mask. */
export interface SemanticSegmentationMask {
  artifactType: 'semantic_segmentation_mask';
  /** Unique artifact ID. */
  id: string;
  /** Source file this mask was derived from. */
  fileId: string;
  /** Semantic class of this mask region. */
  segmentationClass: SegmentationClass;
  /** Polygon outline in normalized image coordinates. */
  polygon: NormalizedPoint[];
  /** Confidence score (0-100). */
  confidence: number;
  /** Bounding region of the mask in normalized coords. */
  maskBounds: import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion;
  /** Raw mask data (grid-based) before polygon conversion. Stored as base64. */
  rawMask?: string;
  /** Cleaned mask data after cleanup pipeline. Stored as base64. */
  cleanedMask?: string;
  /** Width of the mask grid (for raw/cleaned). */
  maskWidth?: number;
  /** Height of the mask grid (for raw/cleaned). */
  maskHeight?: number;
  /** Worker version that produced this artifact. */
  workerVersion: string;
  /** Timings for each processing stage (ms). */
  stageTimings?: Record<string, number>;
  /** Authority envelope — always review-only. */
  authority: GeometryReconstructionAuthority;
  /** Limitations and disclaimers. */
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Structural line candidate — extended line types (Phase 3)
// ---------------------------------------------------------------------------

/** Extended structural line type including wall_vertical. */
export type StructuralLineType = 'ridge' | 'eave' | 'rake' | 'wall_vertical';

/** A structural line candidate with 2D image-space coordinates. */
export interface StructuralLineCandidate {
  artifactType: 'structural_line_candidate';
  /** Unique artifact ID. */
  id: string;
  /** Source file this line was detected on. */
  fileId: string;
  /** Type of structural line. */
  lineType: StructuralLineType;
  /** Start point in normalized image coordinates. */
  start: NormalizedPoint;
  /** End point in normalized image coordinates. */
  end: NormalizedPoint;
  /** Confidence score (0-100). */
  confidence: number;
  /** ID of the source segmentation mask this line was derived from. */
  sourceMaskId?: string;
  /** Worker version that produced this artifact. */
  workerVersion: string;
  /** Timings for each processing stage (ms). */
  stageTimings?: Record<string, number>;
  /** Authority envelope — always review-only. */
  authority: GeometryReconstructionAuthority;
  /** Limitations and disclaimers. */
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Vanishing point artifact (Phase 4)
// ---------------------------------------------------------------------------

/** A vanishing point estimated from line clustering. */
export interface VanishingPointArtifact {
  artifactType: 'vanishing_point';
  /** Unique artifact ID. */
  id: string;
  /** Source file this VP was estimated from. */
  fileId: string;
  /** Vanishing point direction label. */
  direction: 'x' | 'y' | 'vertical';
  /** Estimated vanishing point in normalized image coordinates. */
  point: NormalizedPoint;
  /** Number of lines supporting this VP. */
  supportingLineCount: number;
  /** IDs of supporting lines. */
  supportingLineIds: string[];
  /** RANSAC inlier ratio (0-1). */
  inlierRatio: number;
  /** Confidence score (0-100). */
  confidence: number;
  /** Worker version that produced this artifact. */
  workerVersion: string;
  /** Timings for each processing stage (ms). */
  stageTimings?: Record<string, number>;
  /** Authority envelope — always review-only. */
  authority: GeometryReconstructionAuthority;
  /** Limitations and disclaimers. */
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Consensus plane candidate — multi-photo fusion (Phase 7)
// ---------------------------------------------------------------------------

/** A plane candidate derived from multi-photo consensus. */
export interface ConsensusPlaneCandidate {
  artifactType: 'consensus_plane_candidate';
  /** Unique artifact ID. */
  id: string;
  /** Plane type. */
  planeType: 'roof' | 'wall';
  /** Polygon outline in normalized image coordinates (on reference photo). */
  polygon: NormalizedPoint[];
  /** Normal vector. */
  normalVector: { x: number; y: number; z: number };
  /** Estimated pitch in degrees (roof planes only). */
  estimatedPitch?: number;
  /** Estimated azimuth in degrees. */
  estimatedAzimuth?: number;
  /** Confidence score (0-100). */
  confidence: number;
  /** IDs of source masks that contributed. */
  sourceMaskIds: string[];
  /** IDs of source photos. */
  sourceFileIds: string[];
  /** Number of photos that agreed on this plane. */
  consensusPhotoCount: number;
  /** Worker version that produced this artifact. */
  workerVersion: string;
  /** Timings for each processing stage (ms). */
  stageTimings?: Record<string, number>;
  /** Authority envelope — always review-only. */
  authority: GeometryReconstructionAuthority;
  /** Limitations and disclaimers. */
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Artifact union
// ---------------------------------------------------------------------------

/** Union of all geometry reconstruction artifact types. */
export type GeometryReconstructionArtifact =
  | SegmentationMask
  | DepthMap
  | SfMPointCloud
  | PlaneCandidate
  | RoofPlaneCandidate
  | WallPlaneCandidate
  | LineCandidate
  | SemanticSegmentationMask
  | StructuralLineCandidate
  | VanishingPointArtifact
  | ConsensusPlaneCandidate;

/** Discriminator values for the artifact union. */
export const ARTIFACT_TYPE_DISCRIMINATORS = [
  'segmentation_mask',
  'depth_map',
  'sfm_point_cloud',
  'plane_candidate',
  'roof_plane_candidate',
  'wall_plane_candidate',
  'ridge_line_candidate',
  'eave_line_candidate',
  'rake_line_candidate',
  'semantic_segmentation_mask',
  'structural_line_candidate',
  'vanishing_point',
  'consensus_plane_candidate',
] as const;

export type ArtifactTypeDiscriminator = (typeof ARTIFACT_TYPE_DISCRIMINATORS)[number];

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

/** Job input. */
export interface GeometryReconstructionInput {
  surveyId: string;
  sourcePhotos: SourcePhoto[];
  /** Which pipeline to run. */
  pipeline: 'full' | 'segmentation_only' | 'depth_only' | 'mock' | 'segmentation' | 'line_extraction' | 'plane_extraction' | 'depth_estimation' | 'multi_view_fusion';
  /** Optional config overrides. */
  config?: Record<string, unknown>;
}

/** Job status. */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** A reconstruction job. */
export interface GeometryReconstructionJob {
  id: string;
  surveyId: string;
  status: JobStatus;
  pipeline: string;
  input: GeometryReconstructionInput;
  artifacts: GeometryReconstructionArtifact[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Current pipeline stage (e.g. 'segmentation', 'line_extraction', 'plane_extraction'). */
  currentStage: string | null;
  /** Last heartbeat timestamp — used to detect stuck/in-flight jobs. */
  lastHeartbeatAt: string | null;
  /** Worker version that is processing or processed this job. */
  workerVersion: string | null;
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

/** Reconstruction result bundle. */
export interface GeometryReconstructionResult {
  schemaVersion: 'geometry_reconstruction_result_v1';
  job: GeometryReconstructionJob;
  artifactCount: number;
  artifacts: GeometryReconstructionArtifact[];
  authority: GeometryReconstructionAuthority;
  limitations: string[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Service interface for geometry reconstruction workers. */
export interface GeometryReconstructionService {
  /** Start a new reconstruction job. */
  startJob(input: GeometryReconstructionInput): Promise<GeometryReconstructionJob>;
  /** Get job status + artifacts. */
  getJobStatus(jobId: string): Promise<GeometryReconstructionJob | null>;
  /** Get all artifacts for a survey. */
  getArtifactsForSurvey(surveyId: string, userId: string): Promise<GeometryReconstructionResult>;
  /** Cancel a running job. */
  cancelJob(jobId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/** Result of validating a payload against a schema. */
export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: string[] };
