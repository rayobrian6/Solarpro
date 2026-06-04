/**
 * Payload validators for geometry reconstruction artifacts.
 *
 * Each validator checks required fields, types, the artifactType discriminator,
 * and enforces that authority mutation flags are all false.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  GeometryReconstructionAuthority,
  SegmentationMask,
  DepthMap,
  SfMPointCloud,
  PlaneCandidate,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  LineCandidate,
  LineCandidateType,
  SemanticSegmentationMask,
  SegmentationClass,
  StructuralLineCandidate,
  StructuralLineType,
  VanishingPointArtifact,
  ConsensusPlaneCandidate,
  MeshArtifact,
  GeometryReconstructionArtifact,
  ArtifactTypeDiscriminator,
  ValidationResult,
} from './types';
import { ARTIFACT_TYPE_DISCRIMINATORS, SEGMENTATION_CLASSES, CONDITION_FLAGS, type ConditionFlag } from './types';

// ---------------------------------------------------------------------------
// Authority validation
// ---------------------------------------------------------------------------

/** Validate that an authority envelope has all mutation flags set to false. */
export function validateAuthority(authority: unknown): ValidationResult<GeometryReconstructionAuthority> {
  const errors: string[] = [];

  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { valid: false, errors: ['authority must be a non-null object'] };
  }

  const auth = authority as Record<string, unknown>;

  if (auth.reviewOnly !== true) {
    errors.push('authority.reviewOnly must be true');
  }
  if (auth.nonAuthoritative !== true) {
    errors.push('authority.nonAuthoritative must be true');
  }
  if (auth.cadMutationAllowed !== false) {
    errors.push('authority.cadMutationAllowed must be false');
  }
  if (auth.permitGenerationAllowed !== false) {
    errors.push('authority.permitGenerationAllowed must be false');
  }
  if (auth.bomMutationAllowed !== false) {
    errors.push('authority.bomMutationAllowed must be false');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      reviewOnly: true,
      nonAuthoritative: true,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Common field validators
// ---------------------------------------------------------------------------

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(item => typeof item === 'string');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function assertNumber(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
  } else if (!isNumber(payload[field])) {
    errors.push(`Field "${field}" must be a number, got ${typeof payload[field]}`);
  }
}

function assertString(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
  } else if (!isString(payload[field])) {
    errors.push(`Field "${field}" must be a string, got ${typeof payload[field]}`);
  }
}

function assertStringArray(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
  } else if (!isStringArray(payload[field])) {
    errors.push(`Field "${field}" must be a string[]`);
  }
}

function assertNumberTuple(payload: Record<string, unknown>, field: string, len: number, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
    return;
  }
  const val = payload[field];
  if (!Array.isArray(val) || val.length !== len || !val.every(isNumber)) {
    errors.push(`Field "${field}" must be a tuple of ${len} numbers`);
  }
}

function assertConfidence(payload: Record<string, unknown>, errors: string[]): void {
  assertNumber(payload, 'confidence', errors);
  if ('confidence' in payload && isNumber(payload.confidence)) {
    if (payload.confidence < 0 || payload.confidence > 100) {
      errors.push('confidence must be between 0 and 100');
    }
  }
}

function assertAuthority(payload: Record<string, unknown>, errors: string[]): void {
  if (!('authority' in payload)) {
    errors.push('Missing required field: authority');
    return;
  }
  const authResult = validateAuthority(payload.authority);
  if (!authResult.valid) {
    errors.push(...(authResult as { valid: false; errors: string[] }).errors);
  }
}

function assertLimitations(payload: Record<string, unknown>, errors: string[]): void {
  assertStringArray(payload, 'limitations', errors);
}

// ---------------------------------------------------------------------------
// Artifact type discriminators
// ---------------------------------------------------------------------------

const SEGMENTATION_MASK_TYPES: readonly ArtifactTypeDiscriminator[] = ['segmentation_mask'];
const DEPTH_MAP_TYPES: readonly ArtifactTypeDiscriminator[] = ['depth_map'];
const SFM_POINT_CLOUD_TYPES: readonly ArtifactTypeDiscriminator[] = ['sfm_point_cloud'];
const PLANE_CANDIDATE_TYPES: readonly ArtifactTypeDiscriminator[] = ['plane_candidate'];
const ROOF_PLANE_TYPES: readonly ArtifactTypeDiscriminator[] = ['roof_plane_candidate'];
const WALL_PLANE_TYPES: readonly ArtifactTypeDiscriminator[] = ['wall_plane_candidate'];
const LINE_CANDIDATE_TYPES: readonly LineCandidateType[] = ['ridge_line_candidate', 'eave_line_candidate', 'rake_line_candidate'];

// ---------------------------------------------------------------------------
// Per-type validators
// ---------------------------------------------------------------------------

/** Validate a SegmentationMask payload. */
export function validateSegmentationMask(payload: unknown): ValidationResult<SegmentationMask> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'segmentation_mask') {
    errors.push(`artifactType must be "segmentation_mask", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'fileId', errors);
  assertNumber(p, 'width', errors);
  assertNumber(p, 'height', errors);
  assertString(p, 'maskData', errors);
  if ('classLabels' in p) {
    if (!isRecord(p.classLabels)) {
      errors.push('classLabels must be a Record<number, string>');
    }
  } else {
    errors.push('Missing required field: classLabels');
  }
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as SegmentationMask };
}

/** Validate a DepthMap payload. */
export function validateDepthMap(payload: unknown): ValidationResult<DepthMap> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'depth_map') {
    errors.push(`artifactType must be "depth_map", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'fileId', errors);
  assertNumber(p, 'width', errors);
  assertNumber(p, 'height', errors);
  assertString(p, 'depthData', errors);
  assertString(p, 'depthMetric', errors);
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as DepthMap };
}

/** Validate an SfMPointCloud payload. */
export function validateSfMPointCloud(payload: unknown): ValidationResult<SfMPointCloud> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'sfm_point_cloud') {
    errors.push(`artifactType must be "sfm_point_cloud", got "${String(p.artifactType)}"`);
  }
  assertNumber(p, 'pointCount', errors);
  assertString(p, 'pointsData', errors);
  assertNumber(p, 'sourcePhotoCount', errors);
  assertStringArray(p, 'sourceFileIds', errors);
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as SfMPointCloud };
}

/** Validate a MeshArtifact payload. */
export function validateMeshArtifact(payload: unknown): ValidationResult<MeshArtifact> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'mesh') {
    errors.push(`artifactType must be "mesh", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'id', errors);
  assertString(p, 'verticesData', errors);
  assertString(p, 'trianglesData', errors);
  assertNumber(p, 'vertexCount', errors);
  assertNumber(p, 'triangleCount', errors);
  assertNumber(p, 'estimatedArea', errors);
  assertNumber(p, 'planeCount', errors);
  assertStringArray(p, 'sourceFileIds', errors);
  assertConfidence(p, errors);
  assertString(p, 'workerVersion', errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as MeshArtifact };
}

/** Validate a PlaneCandidate payload. */
export function validatePlaneCandidate(payload: unknown): ValidationResult<PlaneCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'plane_candidate') {
    errors.push(`artifactType must be "plane_candidate", got "${String(p.artifactType)}"`);
  }
  assertNumberTuple(p, 'normal', 3, errors);
  assertNumber(p, 'd', errors);
  assertNumber(p, 'inlierCount', errors);
  assertNumber(p, 'totalPoints', errors);
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as PlaneCandidate };
}

/** Validate a RoofPlaneCandidate payload. */
export function validateRoofPlaneCandidate(payload: unknown): ValidationResult<RoofPlaneCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'roof_plane_candidate') {
    errors.push(`artifactType must be "roof_plane_candidate", got "${String(p.artifactType)}"`);
  }
  assertNumberTuple(p, 'normal', 3, errors);
  assertNumber(p, 'd', errors);
  assertNumber(p, 'inlierCount', errors);
  assertNumber(p, 'totalPoints', errors);
  assertNumber(p, 'slopeDegrees', errors);
  assertNumber(p, 'aspectDegrees', errors);
  assertStringArray(p, 'associatedLineIds', errors);
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as RoofPlaneCandidate };
}

/** Validate a WallPlaneCandidate payload. */
export function validateWallPlaneCandidate(payload: unknown): ValidationResult<WallPlaneCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'wall_plane_candidate') {
    errors.push(`artifactType must be "wall_plane_candidate", got "${String(p.artifactType)}"`);
  }
  assertNumberTuple(p, 'normal', 3, errors);
  assertNumber(p, 'd', errors);
  assertNumber(p, 'inlierCount', errors);
  assertNumber(p, 'totalPoints', errors);
  if ('estimatedHeightM' in p && p.estimatedHeightM !== undefined && !isNumber(p.estimatedHeightM)) {
    errors.push('estimatedHeightM must be a number if present');
  }
  if ('facingDirection' in p && p.facingDirection !== undefined && !isString(p.facingDirection)) {
    errors.push('facingDirection must be a string if present');
  }
  assertStringArray(p, 'associatedLineIds', errors);
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as WallPlaneCandidate };
}

/** Validate a LineCandidate payload. */
export function validateLineCandidate(payload: unknown): ValidationResult<LineCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  const validTypes: LineCandidateType[] = ['ridge_line_candidate', 'eave_line_candidate', 'rake_line_candidate'];
  if (!validTypes.includes(p.artifactType as LineCandidateType)) {
    errors.push(`artifactType must be one of ${validTypes.join(', ')}, got "${String(p.artifactType)}"`);
  }
  assertNumberTuple(p, 'startPoint', 3, errors);
  assertNumberTuple(p, 'endPoint', 3, errors);
  if ('estimatedLengthM' in p && p.estimatedLengthM !== undefined && !isNumber(p.estimatedLengthM)) {
    errors.push('estimatedLengthM must be a number if present');
  }
  assertConfidence(p, errors);
  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as LineCandidate };
}

// ---------------------------------------------------------------------------
// Normalized point validation helper
// ---------------------------------------------------------------------------

function assertNormalizedPoint(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
    return;
  }
  const val = payload[field];
  if (!isRecord(val)) {
    errors.push(`Field "${field}" must be an object with x, y, coordinateSystem`);
    return;
  }
  const pt = val as Record<string, unknown>;
  if (!isNumber(pt.x)) {
    errors.push(`Field "${field}.x" must be a number`);
  }
  if (!isNumber(pt.y)) {
    errors.push(`Field "${field}.y" must be a number`);
  }
  if (pt.coordinateSystem !== 'normalized_image_0_1000') {
    errors.push(`Field "${field}.coordinateSystem" must be "normalized_image_0_1000"`);
  }
}

function assertNormalizedPointArray(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
    return;
  }
  const val = payload[field];
  if (!Array.isArray(val) || val.length === 0) {
    errors.push(`Field "${field}" must be a non-empty array of NormalizedPoint objects`);
    return;
  }
  for (let i = 0; i < val.length; i++) {
    if (!isRecord(val[i])) {
      errors.push(`Field "${field}[${i}] must be an object with x, y, coordinateSystem`);
      continue;
    }
    const pt = val[i] as Record<string, unknown>;
    if (!isNumber(pt.x)) {
      errors.push(`Field "${field}[${i}].x must be a number`);
    }
    if (!isNumber(pt.y)) {
      errors.push(`Field "${field}[${i}].y must be a number`);
    }
    if (pt.coordinateSystem !== 'normalized_image_0_1000') {
      errors.push(`Field "${field}[${i}].coordinateSystem must be "normalized_image_0_1000"`);
    }
  }
}

function assertNormalizedRegion(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (!(field in payload)) {
    errors.push(`Missing required field: ${field}`);
    return;
  }
  const val = payload[field];
  if (!isRecord(val)) {
    errors.push(`Field "${field}" must be a NormalizedRegion object`);
    return;
  }
  const region = val as Record<string, unknown>;
  assertNumber(region, 'x', errors);
  assertNumber(region, 'y', errors);
  assertNumber(region, 'width', errors);
  assertNumber(region, 'height', errors);
  if (region.coordinateSystem !== 'normalized_image_0_1000') {
    errors.push(`Field "${field}.coordinateSystem" must be "normalized_image_0_1000"`);
  }
}

function assertOptionalString(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (field in payload && payload[field] !== undefined && !isString(payload[field])) {
    errors.push(`Field "${field}" must be a string if present`);
  }
}

function assertOptionalNumber(payload: Record<string, unknown>, field: string, errors: string[]): void {
  if (field in payload && payload[field] !== undefined && !isNumber(payload[field])) {
    errors.push(`Field "${field}" must be a number if present`);
  }
}

// ---------------------------------------------------------------------------
// New artifact type validators (Phase 1+)
// ---------------------------------------------------------------------------

/** Validate a SemanticSegmentationMask payload. */
export function validateSemanticSegmentationMask(payload: unknown): ValidationResult<SemanticSegmentationMask> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'semantic_segmentation_mask') {
    errors.push(`artifactType must be "semantic_segmentation_mask", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'id', errors);
  assertString(p, 'fileId', errors);

  // Validate segmentationClass
  if (!('segmentationClass' in p)) {
    errors.push('Missing required field: segmentationClass');
  } else if (!isString(p.segmentationClass) || !SEGMENTATION_CLASSES.includes(p.segmentationClass as SegmentationClass)) {
    errors.push(`segmentationClass must be one of: ${SEGMENTATION_CLASSES.join(', ')}, got "${String(p.segmentationClass)}"`);
  }

  assertNormalizedPointArray(p, 'polygon', errors);
  assertConfidence(p, errors);
  assertNormalizedRegion(p, 'maskBounds', errors);
  assertOptionalString(p, 'rawMask', errors);
  assertOptionalString(p, 'cleanedMask', errors);
  assertOptionalNumber(p, 'maskWidth', errors);
  assertOptionalNumber(p, 'maskHeight', errors);
  assertString(p, 'workerVersion', errors);

  // stageTimings is optional
  if ('stageTimings' in p && p.stageTimings !== undefined) {
    if (!isRecord(p.stageTimings)) {
      errors.push('stageTimings must be a Record<string, number> if present');
    } else {
      const timings = p.stageTimings as Record<string, unknown>;
      for (const key of Object.keys(timings)) {
        if (!isNumber(timings[key])) {
          errors.push(`stageTimings["${key}"] must be a number`);
        }
      }
    }
  }

  assertAuthority(p, errors);
  assertLimitations(p, errors);

  // conditionFlags is optional — if present, must be an array of valid ConditionFlag values
  if ('conditionFlags' in p && p.conditionFlags !== undefined && p.conditionFlags !== null) {
    if (!Array.isArray(p.conditionFlags)) {
      errors.push('conditionFlags must be an array if present');
    } else {
      for (const flag of p.conditionFlags as unknown[]) {
        if (!isString(flag) || !CONDITION_FLAGS.includes(flag as ConditionFlag)) {
          errors.push(`conditionFlags entry must be one of: ${CONDITION_FLAGS.join(', ')}, got "${String(flag)}"`);
        }
      }
    }
  }

  // isOccluder is optional — if present, must be boolean
  if ('isOccluder' in p && p.isOccluder !== undefined && p.isOccluder !== null) {
    if (typeof p.isOccluder !== 'boolean') {
      errors.push('isOccluder must be a boolean if present');
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as SemanticSegmentationMask };
}

/** Validate a StructuralLineCandidate payload. */
export function validateStructuralLineCandidate(payload: unknown): ValidationResult<StructuralLineCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'structural_line_candidate') {
    errors.push(`artifactType must be "structural_line_candidate", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'id', errors);
  assertString(p, 'fileId', errors);

  // Validate lineType
  const validLineTypes: StructuralLineType[] = ['ridge', 'eave', 'rake', 'valley', 'hip', 'wall_vertical', 'wall_bottom_edge'];
  if (!('lineType' in p)) {
    errors.push('Missing required field: lineType');
  } else if (!isString(p.lineType) || !validLineTypes.includes(p.lineType as StructuralLineType)) {
    errors.push(`lineType must be one of: ${validLineTypes.join(', ')}, got "${String(p.lineType)}"`);
  }

  assertNormalizedPoint(p, 'start', errors);
  assertNormalizedPoint(p, 'end', errors);
  assertConfidence(p, errors);
  assertOptionalString(p, 'sourceMaskId', errors);
  assertString(p, 'workerVersion', errors);

  // stageTimings is optional
  if ('stageTimings' in p && p.stageTimings !== undefined) {
    if (!isRecord(p.stageTimings)) {
      errors.push('stageTimings must be a Record<string, number> if present');
    }
  }

  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as StructuralLineCandidate };
}

/** Validate a VanishingPointArtifact payload. */
export function validateVanishingPointArtifact(payload: unknown): ValidationResult<VanishingPointArtifact> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'vanishing_point') {
    errors.push(`artifactType must be "vanishing_point", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'id', errors);
  assertString(p, 'fileId', errors);

  // Validate direction
  const validDirections = ['x', 'y', 'vertical'];
  if (!('direction' in p)) {
    errors.push('Missing required field: direction');
  } else if (!isString(p.direction) || !validDirections.includes(p.direction)) {
    errors.push(`direction must be one of: ${validDirections.join(', ')}, got "${String(p.direction)}"`);
  }

  assertNormalizedPoint(p, 'point', errors);
  assertNumber(p, 'supportingLineCount', errors);
  assertStringArray(p, 'supportingLineIds', errors);

  // Validate inlierRatio (0-1)
  assertNumber(p, 'inlierRatio', errors);
  if ('inlierRatio' in p && isNumber(p.inlierRatio)) {
    if (p.inlierRatio < 0 || p.inlierRatio > 1) {
      errors.push('inlierRatio must be between 0 and 1');
    }
  }

  assertConfidence(p, errors);
  assertString(p, 'workerVersion', errors);

  // stageTimings is optional
  if ('stageTimings' in p && p.stageTimings !== undefined) {
    if (!isRecord(p.stageTimings)) {
      errors.push('stageTimings must be a Record<string, number> if present');
    }
  }

  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as VanishingPointArtifact };
}

/** Validate a ConsensusPlaneCandidate payload. */
export function validateConsensusPlaneCandidate(payload: unknown): ValidationResult<ConsensusPlaneCandidate> {
  const errors: string[] = [];
  if (!isRecord(payload)) return { valid: false, errors: ['Payload must be a non-null object'] };
  const p = payload as Record<string, unknown>;

  if (p.artifactType !== 'consensus_plane_candidate') {
    errors.push(`artifactType must be "consensus_plane_candidate", got "${String(p.artifactType)}"`);
  }
  assertString(p, 'id', errors);

  // Validate planeType
  const validPlaneTypes = ['roof', 'wall'];
  if (!('planeType' in p)) {
    errors.push('Missing required field: planeType');
  } else if (!isString(p.planeType) || !validPlaneTypes.includes(p.planeType)) {
    errors.push(`planeType must be one of: ${validPlaneTypes.join(', ')}, got "${String(p.planeType)}"`);
  }

  assertNormalizedPointArray(p, 'polygon', errors);

  // Validate normalVector
  if (!('normalVector' in p)) {
    errors.push('Missing required field: normalVector');
  } else if (!isRecord(p.normalVector)) {
    errors.push('normalVector must be an object with x, y, z');
  } else {
    const nv = p.normalVector as Record<string, unknown>;
    assertNumber(nv, 'x', errors);
    assertNumber(nv, 'y', errors);
    assertNumber(nv, 'z', errors);
  }

  assertOptionalNumber(p, 'estimatedPitch', errors);
  assertOptionalNumber(p, 'estimatedAzimuth', errors);
  assertConfidence(p, errors);
  assertStringArray(p, 'sourceMaskIds', errors);
  assertStringArray(p, 'sourceFileIds', errors);
  assertNumber(p, 'consensusPhotoCount', errors);
  assertString(p, 'workerVersion', errors);

  // stageTimings is optional
  if ('stageTimings' in p && p.stageTimings !== undefined) {
    if (!isRecord(p.stageTimings)) {
      errors.push('stageTimings must be a Record<string, number> if present');
    }
  }

  assertAuthority(p, errors);
  assertLimitations(p, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, data: p as unknown as ConsensusPlaneCandidate };
}

// ---------------------------------------------------------------------------
// Union validator
// ---------------------------------------------------------------------------

/** Validator map keyed by artifactType discriminator. */
const VALIDATOR_MAP: Record<ArtifactTypeDiscriminator, (payload: unknown) => ValidationResult<GeometryReconstructionArtifact>> = {
  segmentation_mask: (p) => {
    const r = validateSegmentationMask(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  depth_map: (p) => {
    const r = validateDepthMap(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  sfm_point_cloud: (p) => {
    const r = validateSfMPointCloud(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  mesh: (p) => {
    const r = validateMeshArtifact(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  plane_candidate: (p) => {
    const r = validatePlaneCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  roof_plane_candidate: (p) => {
    const r = validateRoofPlaneCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  wall_plane_candidate: (p) => {
    const r = validateWallPlaneCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  ridge_line_candidate: (p) => {
    const r = validateLineCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  eave_line_candidate: (p) => {
    const r = validateLineCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  rake_line_candidate: (p) => {
    const r = validateLineCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  semantic_segmentation_mask: (p) => {
    const r = validateSemanticSegmentationMask(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  structural_line_candidate: (p) => {
    const r = validateStructuralLineCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  vanishing_point: (p) => {
    const r = validateVanishingPointArtifact(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
  consensus_plane_candidate: (p) => {
    const r = validateConsensusPlaneCandidate(p);
    return r.valid ? { valid: true, data: r.data } : r as ValidationResult<GeometryReconstructionArtifact>;
  },
};

/** Validate any geometry reconstruction artifact by its discriminator. */
export function validateGeometryReconstructionArtifact(payload: unknown): ValidationResult<GeometryReconstructionArtifact> {
  if (!isRecord(payload)) {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Record<string, unknown>;

  if (!('artifactType' in p) || typeof p.artifactType !== 'string') {
    return { valid: false, errors: ['Missing or invalid artifactType discriminator'] };
  }

  const discriminator = p.artifactType as string;

  if (!ARTIFACT_TYPE_DISCRIMINATORS.includes(discriminator as ArtifactTypeDiscriminator)) {
    return {
      valid: false,
      errors: [`Unknown artifactType: "${discriminator}". Must be one of: ${ARTIFACT_TYPE_DISCRIMINATORS.join(', ')}`],
    };
  }

  return VALIDATOR_MAP[discriminator as ArtifactTypeDiscriminator](payload);
}
