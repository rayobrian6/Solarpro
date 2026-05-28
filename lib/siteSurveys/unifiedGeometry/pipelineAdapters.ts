// ============================================================================
// lib/siteSurveys/unifiedGeometry/pipelineAdapters.ts
//
// Pipeline adapters — convert artifacts from Pipeline A (Photo Vision) and
// Pipeline B (Geometry Reconstruction) into UnifiedGeometryArtifact instances.
//
// These adapters are the ONLY way raw pipeline artifacts enter the unified
// geometry system. Every adapter stamps the output with:
//   - authority: RAW_EVIDENCE_AUTHORITY (or MOCK_ARTIFACT_AUTHORITY for mock)
//   - provenance: full provenance chain with sourcePipeline, toolName, etc.
//   - geometryClass: the canonical unified class
//
// NON-NEGOTIABLE: Adapted artifacts always start at raw_evidence authority.
// They cannot skip to a higher authority state. Promotion happens separately
// through the promotion workflow (promotion.ts).
// ============================================================================

import { v4 as uuid } from 'uuid';
import type {
  OpenSourcePhotoVisionCandidate,
  OpenSourcePhotoVisionLine,
  OpenSourcePhotoVisionRegion,
  OpenSourcePhotoVisionCandidateType,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';
import type {
  GeometryReconstructionArtifact,
  SegmentationMask,
  DepthMap,
  SfMPointCloud,
  PlaneCandidate,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  LineCandidate,
  SemanticSegmentationMask,
  StructuralLineCandidate,
  VanishingPointArtifact,
  ConsensusPlaneCandidate,
  NormalizedPoint as ReconNormalizedPoint,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import type { NormalizedLine, NormalizedRegion } from '@/lib/assistedEvidenceSources/overlayCoordinateConversion';
import type { GeometryCandidateSignal } from '@/lib/assistedEvidenceSources/geometryCandidateTypes';
import {
  RAW_EVIDENCE_AUTHORITY,
  MOCK_ARTIFACT_AUTHORITY,
} from './authority';
import type { UnifiedGeometryAuthority } from './authority';
import type {
  UnifiedGeometryArtifact,
  UnifiedGeometryClass,
  GeometryPoint2D,
  GeometryPolygon,
  GeometryBBox,
  GeometryLineSegment,
  GeometryNormalVector,
  GeometryProvenance,
  GeometrySourcePipeline,
  RoofLineSubtype,
  ObstructionSubtype,
  PlaneType,
  ObstructionCadImpact,
} from './types';

// ─── Pipeline A Candidate Type → Unified Geometry Class Mapping ─────────────

/**
 * Maps Pipeline A candidate types to canonical unified geometry classes.
 * Some Pipeline A types don't have a direct geometry mapping (e.g., ocr_availability_note)
 * and are mapped to 'unknown' for provenance tracking.
 */
const PIPELINE_A_CLASS_MAP: Record<string, UnifiedGeometryClass> = {
  edge_map_summary:           'unknown',
  dominant_line_candidate:    'roof_line',
  rectangular_region_candidate: 'roof_plane',
  equipment_anchor_candidate: 'electrical_node',
  roof_edge_candidate:        'roof_line',
  wall_anchor_candidate:      'wall_plane',
  obstruction_candidate:      'obstruction',
  ocr_availability_note:      'unknown',
};

// ─── Pipeline B Artifact Type → Unified Geometry Class Mapping ──────────────

/**
 * Maps Pipeline B artifact discriminators to canonical unified geometry classes.
 */
const PIPELINE_B_CLASS_MAP: Record<string, UnifiedGeometryClass> = {
  segmentation_mask:            'segmentation_mask',
  depth_map:                    'depth_map',
  sfm_point_cloud:              'point_cloud',
  plane_candidate:              'roof_plane',
  roof_plane_candidate:         'roof_plane',
  wall_plane_candidate:         'wall_plane',
  ridge_line_candidate:         'roof_line',
  eave_line_candidate:          'roof_line',
  rake_line_candidate:          'roof_line',
  semantic_segmentation_mask:   'segmentation_mask',
  structural_line_candidate:    'roof_line',
  vanishing_point:              'vanishing_point',
  consensus_plane_candidate:    'consensus_plane',
};

// ─── Coordinate Helpers ─────────────────────────────────────────────────────

/**
 * Convert a Pipeline A region (normalized_image_0_1000) to a unified GeometryBBox.
 */
function regionToBBox(region: OpenSourcePhotoVisionRegion | NormalizedRegion): GeometryBBox {
  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a Pipeline A line (normalized_image_0_1000) to a unified GeometryLineSegment.
 */
function pipelineALineToSegment(line: OpenSourcePhotoVisionLine): GeometryLineSegment {
  return {
    start: { x: line.x1, y: line.y1, coordinateSystem: 'normalized_image_0_1000' },
    end: { x: line.x2, y: line.y2, coordinateSystem: 'normalized_image_0_1000' },
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a Pipeline B NormalizedLine to a unified GeometryLineSegment.
 */
function normalizedLineToSegment(line: NormalizedLine): GeometryLineSegment {
  return {
    start: { x: line.x1, y: line.y1, coordinateSystem: 'normalized_image_0_1000' },
    end: { x: line.x2, y: line.y2, coordinateSystem: 'normalized_image_0_1000' },
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a Pipeline B NormalizedPoint (from reconstruction types) to a unified GeometryPoint2D.
 */
function reconPointToGeometryPoint(pt: ReconNormalizedPoint): GeometryPoint2D {
  return { x: pt.x, y: pt.y, coordinateSystem: 'normalized_image_0_1000' };
}

/**
 * Convert a Pipeline B polygon (array of NormalizedPoint) to a unified GeometryPolygon.
 */
function reconPointsToPolygon(pts: ReconNormalizedPoint[]): GeometryPolygon {
  return {
    vertices: pts.map(reconPointToGeometryPoint),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert a Pipeline B normal vector [nx, ny, nz] to a unified GeometryNormalVector.
 */
function arrayToNormalVec(normal: [number, number, number]): GeometryNormalVector {
  return { x: normal[0], y: normal[1], z: normal[2] };
}

// ─── Line Type → RoofLineSubtype Mapping ────────────────────────────────────

/**
 * Map Pipeline B structural line types to canonical RoofLineSubtype.
 */
function structuralLineTypeToSubtype(lineType: string): RoofLineSubtype | null {
  const map: Record<string, RoofLineSubtype> = {
    ridge: 'ridge',
    eave: 'eave',
    rake: 'rake',
    hip: 'hip',
    valley: 'valley',
    wall_vertical: 'wall_vertical',
  };
  return map[lineType] ?? null;
}

/**
 * Map Pipeline B LineCandidateType to canonical RoofLineSubtype.
 */
function lineCandidateTypeToSubtype(artifactType: string): RoofLineSubtype {
  const map: Record<string, RoofLineSubtype> = {
    ridge_line_candidate: 'ridge',
    eave_line_candidate: 'eave',
    rake_line_candidate: 'rake',
  };
  return map[artifactType] ?? 'ridge'; // fallback
}

/**
 * Infer RoofLineSubtype from a Pipeline A line's orientation.
 * This is a best-effort heuristic; Pipeline A doesn't classify line subtypes.
 */
function orientationToLineSubtype(orientation: string): RoofLineSubtype | null {
  if (orientation === 'horizontal') return 'eave'; // likely eave/ridge
  if (orientation === 'vertical') return 'rake';   // likely rake/wall edge
  return null; // diagonal — cannot infer
}

/**
 * Infer an ObstructionSubtype from Pipeline A candidate payload data.
 * Pipeline A doesn't classify obstruction subtypes, so we use heuristic hints.
 */
function inferObstructionSubtype(payload: Record<string, unknown>): ObstructionSubtype {
  const typeHint = payload.obstructionType as string | undefined;
  if (typeHint) {
    const normalized = typeHint.toLowerCase().replace(/[\s-]/g, '_');
    const known: Record<string, ObstructionSubtype> = {
      plumbing_vent: 'plumbing_vent',
      exhaust_vent: 'exhaust_vent',
      chimney: 'chimney',
      skylight: 'skylight',
      hvac: 'hvac_unit',
      antenna: 'antenna',
      satellite_dish: 'satellite_dish',
      roof_jack: 'roof_jack',
      weatherhead: 'weatherhead',
      solar_tube: 'solar_tube',
      dormer: 'dormer',
    };
    if (known[normalized]) return known[normalized];
  }
  return 'unknown_obstruction';
}

// ─── Provenance Helper ──────────────────────────────────────────────────────

function makeReconProvenance(
  sourcePipeline: GeometrySourcePipeline,
  toolName: string,
  fileId: string | undefined,
  sourceFileIds: string[],
  workerVersion: string | undefined,
  artifactId: string | undefined,
): GeometryProvenance {
  return {
    sourcePipeline,
    toolName,
    toolVersion: workerVersion ?? 'unknown',
    runHash: `recon-${artifactId ?? uuid().slice(0, 8)}`,
    sourceFileIds: fileId ? [fileId, ...sourceFileIds] : sourceFileIds,
    derivedFromArtifactIds: [],
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    workerVersion: workerVersion ?? null,
  };
}

// ─── Empty Artifact Template ────────────────────────────────────────────────

/**
 * Create a UnifiedGeometryArtifact with all optional fields set to null.
 * Callers fill in the fields they need. This avoids repetitive boilerplate.
 */
function makeEmptyArtifact(overrides: Partial<UnifiedGeometryArtifact> & Pick<UnifiedGeometryArtifact, 'id' | 'surveyId' | 'geometryClass' | 'authority' | 'provenance' | 'confidence' | 'label' | 'limitations'>): UnifiedGeometryArtifact {
  return {
    bbox: null,
    polygon: null,
    lineSegment: null,
    center: null,
    planeType: null,
    pitchDegrees: null,
    azimuthDegrees: null,
    normalVector: null,
    areaSqM: null,
    inlierCount: null,
    totalPoints: null,
    lineSubtype: null,
    estimatedLengthM: null,
    obstructionSubtype: null,
    radiusM: null,
    setbackM: null,
    heightFt: null,
    roofPlaneId: null,
    cadImpact: null,
    electricalSubtype: null,
    story: null,
    isPrimaryInterconnect: null,
    depthResolution: null,
    depthMetric: null,
    consensusPhotoCount: null,
    segmentationClass: null,
    reviewState: 'review_required',
    reviewNotes: null,
    priority: overrides.confidence !== undefined
      ? (overrides.confidence >= 80 ? 'high' : overrides.confidence >= 50 ? 'medium' : 'low')
      : 'medium',
    stageTimings: null,
    ...overrides,
  };
}

// ─── Pipeline A Adapter ─────────────────────────────────────────────────────

/**
 * Adapt a Pipeline A (Photo Vision) candidate into a UnifiedGeometryArtifact.
 *
 * The output always starts at raw_evidence authority.
 * The geometryClass is derived from the candidateType mapping.
 * Provenance is fully preserved.
 */
export function adaptPhotoVisionCandidate(
  candidate: OpenSourcePhotoVisionCandidate,
  surveyId: string,
): UnifiedGeometryArtifact {
  const geometryClass = PIPELINE_A_CLASS_MAP[candidate.candidateType] ?? 'unknown';
  const isMock = candidate.toolName.includes('mock') || candidate.toolName.includes('test');

  const provenance: GeometryProvenance = {
    sourcePipeline: isMock ? 'mock' : 'photo_vision',
    toolName: candidate.toolName,
    toolVersion: candidate.toolVersion,
    runHash: candidate.runHash,
    sourceFileIds: [candidate.fileId],
    derivedFromArtifactIds: [],
    createdAt: candidate.createdAt,
    reviewedBy: null,
    reviewedAt: null,
    workerVersion: null,
  };

  const authority: UnifiedGeometryAuthority = isMock
    ? { ...MOCK_ARTIFACT_AUTHORITY }
    : { ...RAW_EVIDENCE_AUTHORITY };

  // Build geometry fields based on geometry class
  const bbox = candidate.region ? regionToBBox(candidate.region) : null;
  const lineSegment = candidate.line ? pipelineALineToSegment(candidate.line) : null;
  const center = bbox
    ? { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2, coordinateSystem: 'normalized_image_0_1000' as const }
    : null;

  // Class-specific field population
  const lineSubtype = candidate.line
    ? orientationToLineSubtype(candidate.line.orientation)
    : null;

  const obstructionSubtype = geometryClass === 'obstruction'
    ? inferObstructionSubtype(candidate.payload)
    : null;

  const planeType: PlaneType | null = geometryClass === 'roof_plane'
    ? 'roof'
    : geometryClass === 'wall_plane'
      ? 'wall'
      : null;

  return makeEmptyArtifact({
    id: candidate.candidateId,
    surveyId,
    geometryClass,
    authority,
    provenance,
    confidence: candidate.confidence,
    label: candidate.summary ?? `${candidate.candidateType} (Pipeline A)`,
    limitations: [...candidate.limitations],
    bbox,
    lineSegment,
    center,
    planeType,
    lineSubtype,
    obstructionSubtype,
    priority: candidate.confidence >= 80 ? 'high' : candidate.confidence >= 50 ? 'medium' : 'low',
  });
}

// ─── Pipeline B Adapters ────────────────────────────────────────────────────

/**
 * Adapt a Pipeline B (Geometry Reconstruction) artifact into a UnifiedGeometryArtifact.
 *
 * Dispatches to the appropriate specialized adapter based on artifactType.
 */
export function adaptGeometryReconArtifact(
  artifact: GeometryReconstructionArtifact,
  surveyId: string,
): UnifiedGeometryArtifact {
  switch (artifact.artifactType) {
    case 'segmentation_mask':            return adaptSegmentationMask(artifact, surveyId);
    case 'depth_map':                    return adaptDepthMap(artifact, surveyId);
    case 'sfm_point_cloud':              return adaptSfMPointCloud(artifact, surveyId);
    case 'plane_candidate':              return adaptPlaneCandidate(artifact, surveyId);
    case 'roof_plane_candidate':         return adaptRoofPlaneCandidate(artifact, surveyId);
    case 'wall_plane_candidate':         return adaptWallPlaneCandidate(artifact, surveyId);
    case 'ridge_line_candidate':         return adaptLineCandidate(artifact, surveyId);
    case 'eave_line_candidate':          return adaptLineCandidate(artifact, surveyId);
    case 'rake_line_candidate':          return adaptLineCandidate(artifact, surveyId);
    case 'semantic_segmentation_mask':   return adaptSemanticSegmentationMask(artifact, surveyId);
    case 'structural_line_candidate':    return adaptStructuralLineCandidate(artifact, surveyId);
    case 'vanishing_point':              return adaptVanishingPoint(artifact, surveyId);
    case 'consensus_plane_candidate':    return adaptConsensusPlaneCandidate(artifact, surveyId);
    default:
      // Unknown artifact type — map to 'unknown' geometry class
      return adaptUnknownArtifact(artifact, surveyId);
  }
}

// ─── Individual Pipeline B Adapters ─────────────────────────────────────────

function adaptSegmentationMask(artifact: SegmentationMask, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'segmentation_worker', artifact.fileId, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'segmentation_mask',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Segmentation mask (${artifact.width}×${artifact.height})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    depthResolution: { width: artifact.width, height: artifact.height },
    segmentationClass: Object.values(artifact.classLabels).join(', '),
  });
}

function adaptDepthMap(artifact: DepthMap, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'depth_worker', artifact.fileId, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'depth_map',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Depth map (${artifact.width}×${artifact.height}, ${artifact.depthMetric})`,
    limitations: [...artifact.limitations],
    depthResolution: { width: artifact.width, height: artifact.height },
    depthMetric: artifact.depthMetric,
    priority: 'low',
  });
}

function adaptSfMPointCloud(artifact: SfMPointCloud, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'sfm_worker', undefined, artifact.sourceFileIds, undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'point_cloud',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `SfM point cloud (${artifact.pointCount} points, ${artifact.sourcePhotoCount} photos)`,
    limitations: [...artifact.limitations],
    priority: 'low',
  });
}

function adaptPlaneCandidate(artifact: PlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', undefined, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_plane',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    planeType: 'roof',
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
  });
}

function adaptRoofPlaneCandidate(artifact: RoofPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', undefined, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_plane',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Roof plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    planeType: 'roof',
    pitchDegrees: artifact.slopeDegrees,
    azimuthDegrees: artifact.aspectDegrees,
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
  });
}

function adaptWallPlaneCandidate(artifact: WallPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', undefined, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'wall_plane',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Wall plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    planeType: 'wall',
    azimuthDegrees: artifact.facingDirection ? null : null, // facingDirection is a string, not degrees
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
  });
}

function adaptLineCandidate(
  artifact: LineCandidate,
  surveyId: string,
): UnifiedGeometryArtifact {
  const lineSubtype = lineCandidateTypeToSubtype(artifact.artifactType);
  const provenance = makeReconProvenance(
    'geometry_recon', 'line_extraction_worker', undefined, [], undefined, undefined,
  );

  // LineCandidate has 3D startPoint/endPoint and optional 2D projection
  const lineSegment = artifact.projection
    ? normalizedLineToSegment(artifact.projection)
    : null;

  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_line',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `${lineSubtype} line candidate`,
    limitations: [...artifact.limitations],
    lineSegment,
    lineSubtype,
    estimatedLengthM: artifact.estimatedLengthM ?? null,
  });
}

function adaptSemanticSegmentationMask(artifact: SemanticSegmentationMask, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'segmentation_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
  );
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'segmentation_mask',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Semantic segmentation (${artifact.segmentationClass})`,
    limitations: [...artifact.limitations],
    bbox: regionToBBox(artifact.maskBounds),
    polygon: reconPointsToPolygon(artifact.polygon),
    depthResolution: artifact.maskWidth && artifact.maskHeight
      ? { width: artifact.maskWidth, height: artifact.maskHeight }
      : null,
    segmentationClass: artifact.segmentationClass,
    stageTimings: artifact.stageTimings ?? null,
  });
}

function adaptStructuralLineCandidate(artifact: StructuralLineCandidate, surveyId: string): UnifiedGeometryArtifact {
  const lineSubtype = structuralLineTypeToSubtype(artifact.lineType);
  const provenance = makeReconProvenance(
    'geometry_recon', 'line_extraction_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
  );
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'roof_line',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Structural ${artifact.lineType} line`,
    limitations: [...artifact.limitations],
    lineSegment: {
      start: reconPointToGeometryPoint(artifact.start),
      end: reconPointToGeometryPoint(artifact.end),
      coordinateSystem: 'normalized_image_0_1000',
    },
    lineSubtype,
    stageTimings: artifact.stageTimings ?? null,
  });
}

function adaptVanishingPoint(artifact: VanishingPointArtifact, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'vanishing_point_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
  );
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'vanishing_point',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Vanishing point (${artifact.direction}, inlier ratio: ${artifact.inlierRatio.toFixed(2)})`,
    limitations: [...artifact.limitations],
    center: reconPointToGeometryPoint(artifact.point),
    priority: 'low',
    stageTimings: artifact.stageTimings ?? null,
  });
}

function adaptConsensusPlaneCandidate(artifact: ConsensusPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'multi_view_fusion_worker', undefined, artifact.sourceFileIds, artifact.workerVersion, artifact.id,
  );
  const planeType: PlaneType = artifact.planeType === 'wall' ? 'wall' : 'roof';
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'consensus_plane',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: `Consensus ${artifact.planeType} plane (${artifact.consensusPhotoCount} photos)`,
    limitations: [...artifact.limitations],
    polygon: reconPointsToPolygon(artifact.polygon),
    planeType,
    pitchDegrees: artifact.estimatedPitch ?? null,
    azimuthDegrees: artifact.estimatedAzimuth ?? null,
    normalVector: artifact.normalVector,
    consensusPhotoCount: artifact.consensusPhotoCount,
    stageTimings: artifact.stageTimings ?? null,
  });
}

function adaptUnknownArtifact(artifact: GeometryReconstructionArtifact, surveyId: string): UnifiedGeometryArtifact {
  const provenance = makeReconProvenance(
    'geometry_recon', 'unknown_worker', undefined, [], undefined, undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'unknown',
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence ?? 0,
    label: `Unknown artifact (${(artifact as any).artifactType ?? 'no-type'})`,
    limitations: [...(artifact.limitations ?? [])],
    priority: 'low',
  });
}

// ─── Geometry Candidate Signal Adapter (very limited provenance) ────────────

/**
 * Adapt a GeometryCandidateSignal (from the boundary-constrained candidate
 * runtime) into a UnifiedGeometryArtifact. These signals carry almost no
 * geometry — they are coarse review hints only.
 */
export function adaptGeometryCandidateSignal(
  signal: GeometryCandidateSignal,
  surveyId: string,
  sourceFileId: string,
  toolName: string,
  toolVersion: string,
  runHash: string,
): UnifiedGeometryArtifact {
  const provenance: GeometryProvenance = {
    sourcePipeline: 'photo_vision',
    toolName,
    toolVersion,
    runHash,
    sourceFileIds: [sourceFileId],
    derivedFromArtifactIds: [],
    createdAt: new Date().toISOString(),
    reviewedBy: null,
    reviewedAt: null,
    workerVersion: null,
  };

  return makeEmptyArtifact({
    id: signal.signalId,
    surveyId,
    geometryClass: 'obstruction', // GeometryCandidateLabel is 'possible_obstruction_candidate' only
    authority: { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: signal.confidence,
    label: signal.label,
    limitations: [...signal.limitationRefs],
    obstructionSubtype: 'unknown_obstruction',
    priority: signal.confidence >= 80 ? 'high' : signal.confidence >= 50 ? 'medium' : 'low',
  });
}

// ─── Batch Adaptation Helpers ───────────────────────────────────────────────

/**
 * Adapt all Pipeline A candidates from a stored bundle.
 */
export function adaptPhotoVisionBundle(
  candidates: OpenSourcePhotoVisionCandidate[],
  surveyId: string,
): UnifiedGeometryArtifact[] {
  return candidates.map(c => adaptPhotoVisionCandidate(c, surveyId));
}

/**
 * Adapt all Pipeline B artifacts from a reconstruction result.
 */
export function adaptGeometryReconBundle(
  artifacts: GeometryReconstructionArtifact[],
  surveyId: string,
): UnifiedGeometryArtifact[] {
  return artifacts.map(a => adaptGeometryReconArtifact(a, surveyId));
}
