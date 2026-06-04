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
  SYNTHETIC_ARTIFACT_AUTHORITY,
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
  SegmentationBackend,
  FacadeSubtype,
  SiteContextSubtype,
  ElectricalNodeSubtype,
  UnifiedConditionFlag,
} from './types';
import {
  FACADE_SEGMENTATION_CLASSES,
  SITE_CONTEXT_SEGMENTATION_CLASSES,
  ELECTRICAL_SEGMENTATION_CLASSES,
  OCCLUDER_SEGMENTATION_CLASSES,
  CONDITION_SEGMENTATION_CLASSES,
  VEGETATION_CLASSES,
  type SegmentationClass,
  type GeometryParticipationFlags,
} from '../geometryReconstruction/types';

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

// ─── Segmentation Backend Detection ──────────────────────────────────────

/**
 * Detect which segmentation backend produced a mask from its rawMask prefix.
 * - "sam2-" → SAM 2 (Meta's Segment Anything Model 2)
 * - "canny-contour-" → Canny edge detection fallback
 * - "heuristic-polygon-" → heuristic polygon generation (synthetic)
 * - undefined/other → null (unknown or legacy)
 */
function detectSegmentationBackend(rawMask: string | undefined): SegmentationBackend | null {
  if (!rawMask) return null;
  if (rawMask.startsWith('sam2-')) return 'sam2';
  if (rawMask.startsWith('canny-contour-')) return 'canny';
  return null;
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
    wall_bottom_edge: 'wall_bottom_edge',
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

/**
 * Detect whether a Pipeline B artifact is synthetic (produced by heuristic
 * implementation rather than a real ML model).
 *
 * Detection heuristic: if the limitations array contains any entry with
 * the word "heuristic", the artifact is synthetic. This matches the pattern
 * used by all heuristic workers in the geometry reconstruction pipeline.
 */
function isReconArtifactSynthetic(artifact: { limitations?: string[] }): boolean {
  return (artifact.limitations ?? []).some(
    lim => lim.toLowerCase().includes('heuristic')
  );
}

function makeReconProvenance(
  sourcePipeline: GeometrySourcePipeline,
  toolName: string,
  fileId: string | undefined,
  sourceFileIds: string[],
  workerVersion: string | undefined,
  artifactId: string | undefined,
  synthetic?: boolean,
  disclaimer?: string,
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
    ...(synthetic ? { synthetic: true as const, disclaimer: disclaimer ?? 'SYNTHETIC: Generated by heuristic implementation, not a real ML model' } : {}),
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
    segmentationBackend: null,
    facadeSubtype: null,
    siteContextSubtype: null,
    conditionFlags: null,
    isOccluder: null,
    semanticClass: null,
    sceneRole: null,
    isStructure: null,
    isTemporaryOccluder: null,
    isVegetation: null,
    isGroundSurface: null,
    cadRelevance: null,
    reviewRequired: null,
    excludeFromGeometry: null,
    geometryParticipation: null,
    reviewState: 'review_required',
    reviewNotes: null,
    priority: overrides.confidence !== undefined
      ? (overrides.confidence >= 80 ? 'high' : overrides.confidence >= 50 ? 'medium' : 'low')
      : 'medium',
    isSynthetic: false,
    obstructionMetadata: null,
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

  // Generate a polygon from the bbox for roof_plane and wall_plane artifacts.
  // Pipeline A rectangular_region_candidates are rectangular by definition,
  // so we can derive a 4-vertex polygon from the bounding box coordinates.
  // This gives the UnifiedGeometryOverlayRenderer actual polygon geometry
  // to render as filled shapes instead of just bounding box outlines.
  let polygon: GeometryPolygon | null = null;
  if (bbox && (geometryClass === 'roof_plane' || geometryClass === 'wall_plane')) {
    const cs = 'normalized_image_0_1000' as const;
    polygon = {
      vertices: [
        { x: bbox.x, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height, coordinateSystem: cs },
        { x: bbox.x, y: bbox.y + bbox.height, coordinateSystem: cs },
      ],
      coordinateSystem: cs,
    };
  }

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
    polygon,
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
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'segmentation_worker', artifact.fileId, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Segmentation mask produced by heuristic implementation, not a real ML model' : undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'segmentation_mask',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Segmentation mask (${artifact.width}×${artifact.height})` : `Segmentation mask (${artifact.width}×${artifact.height})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    depthResolution: { width: artifact.width, height: artifact.height },
    segmentationClass: Object.values(artifact.classLabels).join(', '),
    isSynthetic: isSynth,
  });
}

function adaptDepthMap(artifact: DepthMap, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'depth_worker', artifact.fileId, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Depth map produced by heuristic depth estimation, not a real depth model (MiDaS/DPT)' : undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'depth_map',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Depth map (${artifact.width}×${artifact.height}, ${artifact.depthMetric})` : `Depth map (${artifact.width}×${artifact.height}, ${artifact.depthMetric})`,
    limitations: [...artifact.limitations],
    depthResolution: { width: artifact.width, height: artifact.height },
    depthMetric: artifact.depthMetric,
    priority: 'low',
    isSynthetic: isSynth,
  });
}

function adaptSfMPointCloud(artifact: SfMPointCloud, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'sfm_worker', undefined, artifact.sourceFileIds, undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: SfM point cloud produced from heuristic inputs, not real multi-view stereo' : undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'point_cloud',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: SfM point cloud (${artifact.pointCount} points, ${artifact.sourcePhotoCount} photos)` : `SfM point cloud (${artifact.pointCount} points, ${artifact.sourcePhotoCount} photos)`,
    limitations: [...artifact.limitations],
    priority: 'low',
    isSynthetic: isSynth,
  });
}

function adaptPlaneCandidate(artifact: PlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', undefined, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Plane candidate produced by heuristic extraction, not real RANSAC' : undefined,
  );
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_plane',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})` : `Plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox: artifact.region ? regionToBBox(artifact.region) : null,
    planeType: 'roof',
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
    isSynthetic: isSynth,
  });
}

function adaptRoofPlaneCandidate(artifact: RoofPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', artifact.fileId, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Roof plane candidate produced by heuristic extraction, not real RANSAC on depth data' : undefined,
  );
  const bbox = artifact.region ? regionToBBox(artifact.region) : null;
  // Use the real polygon from the segmentation mask if available.
  // This carries the actual contour shape from Canny edge detection,
  // producing much more accurate overlays than the bbox-derived rectangle.
  // Fall back to bbox-derived polygon only if no real polygon exists.
  let polygon: GeometryPolygon | null = null;
  if (artifact.polygon && artifact.polygon.length >= 3) {
    polygon = reconPointsToPolygon(artifact.polygon);
  } else if (bbox) {
    const cs = 'normalized_image_0_1000' as const;
    polygon = {
      vertices: [
        { x: bbox.x, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height, coordinateSystem: cs },
        { x: bbox.x, y: bbox.y + bbox.height, coordinateSystem: cs },
      ],
      coordinateSystem: cs,
    };
  }
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_plane',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Roof plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})` : `Roof plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox,
    polygon,
    planeType: 'roof',
    pitchDegrees: artifact.slopeDegrees,
    azimuthDegrees: artifact.aspectDegrees,
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
    isSynthetic: isSynth,
  });
}

function adaptWallPlaneCandidate(artifact: WallPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'plane_extraction_worker', artifact.fileId, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Wall plane candidate produced by heuristic extraction' : undefined,
  );
  const bbox = artifact.region ? regionToBBox(artifact.region) : null;
  // Use the real polygon from the segmentation mask if available.
  // This carries the actual contour shape from Canny edge detection,
  // producing much more accurate overlays than the bbox-derived rectangle.
  // Fall back to bbox-derived polygon only if no real polygon exists.
  let polygon: GeometryPolygon | null = null;
  if (artifact.polygon && artifact.polygon.length >= 3) {
    polygon = reconPointsToPolygon(artifact.polygon);
  } else if (bbox) {
    const cs = 'normalized_image_0_1000' as const;
    polygon = {
      vertices: [
        { x: bbox.x, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y, coordinateSystem: cs },
        { x: bbox.x + bbox.width, y: bbox.y + bbox.height, coordinateSystem: cs },
        { x: bbox.x, y: bbox.y + bbox.height, coordinateSystem: cs },
      ],
      coordinateSystem: cs,
    };
  }
  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'wall_plane',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Wall plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})` : `Wall plane candidate (inliers: ${artifact.inlierCount}/${artifact.totalPoints})`,
    limitations: [...artifact.limitations],
    bbox,
    polygon,
    planeType: 'wall',
    azimuthDegrees: artifact.facingDirection ? null : null, // facingDirection is a string, not degrees
    normalVector: arrayToNormalVec(artifact.normal),
    inlierCount: artifact.inlierCount,
    totalPoints: artifact.totalPoints,
    isSynthetic: isSynth,
  });
}

function adaptLineCandidate(
  artifact: LineCandidate,
  surveyId: string,
): UnifiedGeometryArtifact {
  const lineSubtype = lineCandidateTypeToSubtype(artifact.artifactType);
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'line_extraction_worker', undefined, [], undefined, undefined,
    isSynth, isSynth ? 'SYNTHETIC: Line candidate produced by heuristic extraction, not real Hough transform' : undefined,
  );

  // LineCandidate has 3D startPoint/endPoint and optional 2D projection
  const lineSegment = artifact.projection
    ? normalizedLineToSegment(artifact.projection)
    : null;

  return makeEmptyArtifact({
    id: uuid(),
    surveyId,
    geometryClass: 'roof_line',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: ${lineSubtype} line candidate` : `${lineSubtype} line candidate`,
    limitations: [...artifact.limitations],
    lineSegment,
    lineSubtype,
    estimatedLengthM: artifact.estimatedLengthM ?? null,
    isSynthetic: isSynth,
  });
}

function adaptSemanticSegmentationMask(artifact: SemanticSegmentationMask, surveyId: string): UnifiedGeometryArtifact {
  // Detect synthetic artifacts: heuristic workers produce masks with
  // limitations containing "heuristic" markers and rawMask starting with "heuristic-polygon-"
  const isSynthetic = artifact.limitations.some(
    lim => lim.toLowerCase().includes('heuristic')
  ) || (typeof artifact.rawMask === 'string' && artifact.rawMask.startsWith('heuristic-polygon-'));

  const provenance = makeReconProvenance(
    'geometry_recon', 'segmentation_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
    isSynthetic, isSynthetic ? 'SYNTHETIC: Segmentation mask produced by heuristic polygon generation (generateHeuristicPolygon), not a real ML model' : undefined,
  );

  const authority = isSynthetic
    ? { ...SYNTHETIC_ARTIFACT_AUTHORITY }
    : { ...RAW_EVIDENCE_AUTHORITY };

  const segmentationBackend = detectSegmentationBackend(artifact.rawMask);
  const segClass = artifact.segmentationClass as SegmentationClass;

  // Semantic segmentation masks are metadata-only review artifacts.
  // Do not promote any semantic class into structural geometry here. Roof/wall
  // geometry may only come from the existing roof_plane/wall_plane candidate paths.
  const geometryClass: UnifiedGeometryClass = 'segmentation_mask';
  let electricalSubtype: ElectricalNodeSubtype | null = null;
  let facadeSubtype: FacadeSubtype | null = null;
  let siteContextSubtype: SiteContextSubtype | null = null;

  if (ELECTRICAL_SEGMENTATION_CLASSES.has(segClass)) {
    // Preserve electrical identity as review metadata on the mask only.
    const electricalMap: Partial<Record<SegmentationClass, ElectricalNodeSubtype>> = {
      utility_meter: 'utility_meter',
      main_service_panel: 'main_service_panel',
      disconnect: 'disconnect',
      conduit: 'conduit_run',
      inverter: 'inverter',
      battery: 'battery',
    };
    electricalSubtype = electricalMap[segClass] ?? 'unknown_electrical';
  } else if (FACADE_SEGMENTATION_CLASSES.has(segClass)) {
    // Facade classes stay as segmentation_mask but get a facadeSubtype
    const facadeMap: Partial<Record<SegmentationClass, FacadeSubtype>> = {
      siding: 'siding',
      window: 'window',
      door: 'door',
      garage_door: 'garage_door',
      fascia: 'fascia',
      soffit: 'soffit',
      gutter: 'gutter',
      downspout: 'downspout',
      porch: 'porch',
      deck: 'deck',
      steps: 'steps',
      railing: 'railing',
    };
    facadeSubtype = facadeMap[segClass] ?? 'unknown_facade';
  } else if (SITE_CONTEXT_SEGMENTATION_CLASSES.has(segClass)) {
    // Site context classes stay as segmentation_mask but get a siteContextSubtype
    const siteMap: Partial<Record<SegmentationClass, SiteContextSubtype>> = {
      grass: 'grass',
      overgrown_grass: 'overgrown_grass',
      sidewalk: 'sidewalk',
      driveway: 'driveway',
      gravel: 'gravel',
      fence: 'fence',
      bushes: 'bushes',
      vegetation_touching_structure: 'vegetation_touching_structure',
    };
    siteContextSubtype = siteMap[segClass] ?? 'unknown_site_context';
  }

  // Condition flags: propagate from artifact if present, or infer from condition classes
  let conditionFlags: UnifiedConditionFlag[] | null = artifact.conditionFlags ?? null;
  if (conditionFlags === null && CONDITION_SEGMENTATION_CLASSES.has(segClass)) {
    conditionFlags = [segClass as UnifiedConditionFlag];
  }

  // Occluder flag: propagate from artifact. Trucks/cars/trailers remain masks, never geometry.
  const isOccluder = artifact.isOccluder ?? (OCCLUDER_SEGMENTATION_CLASSES.has(segClass) || null);

  const isStructure = segClass === 'roof' || segClass === 'wall';
  const isTemporaryOccluder = OCCLUDER_SEGMENTATION_CLASSES.has(segClass);
  // Pass 3E: Use artifact's isVegetation flag when available, fall back to class-based inference
  const isVegetation = artifact.isVegetation ?? VEGETATION_CLASSES.has(segClass) ?? (segClass === 'tree' || segClass === 'trees' || segClass === 'bushes' || segClass === 'grass' || segClass === 'overgrown_grass' || segClass === 'vegetation_touching_structure');
  const isGroundSurface = segClass === 'ground' || segClass === 'grass' || segClass === 'overgrown_grass' || segClass === 'gravel' || segClass === 'driveway' || segClass === 'sidewalk';
  const sceneRole = isTemporaryOccluder
    ? 'temporary_occluder'
    : isVegetation
      ? 'vegetation'
      : isGroundSurface
        ? 'ground_surface'
        : facadeSubtype
          ? 'facade'
          : ELECTRICAL_SEGMENTATION_CLASSES.has(segClass)
            ? 'electrical_context'
            : isStructure
              ? 'structure'
              : siteContextSubtype
                ? 'site_context'
                : 'unknown';
  const cadRelevance = isStructure ? 'existing_pipeline_only' : sceneRole === 'unknown' ? 'none' : 'review_context';
  const reviewRequired = true;

  // Build label with class context
  const backendLabel = segmentationBackend === 'sam2' ? 'SAM 2' : segmentationBackend === 'canny' ? 'Canny' : 'Segmentation';
  const classLabel = electricalSubtype
    ? `Electrical context: ${segClass}`
    : isTemporaryOccluder
      ? `Occluder: ${segClass}`
      : facadeSubtype
        ? `Facade: ${segClass}`
        : siteContextSubtype || isGroundSurface
          ? `Site: ${segClass}`
          : segClass;

  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass,
    authority,
    provenance,
    confidence: artifact.confidence,
    label: isSynthetic
      ? `⚠️ Synthetic: ${classLabel}`
      : `${backendLabel} ${classLabel}`,
    limitations: [...artifact.limitations],
    bbox: regionToBBox(artifact.maskBounds),
    polygon: reconPointsToPolygon(artifact.polygon),
    depthResolution: artifact.maskWidth && artifact.maskHeight
      ? { width: artifact.maskWidth, height: artifact.maskHeight }
      : null,
    segmentationClass: artifact.segmentationClass,
    segmentationBackend,
    electricalSubtype,
    facadeSubtype,
    siteContextSubtype,
    conditionFlags,
    isOccluder,
    semanticClass: artifact.segmentationClass,
    sceneRole,
    isStructure,
    isTemporaryOccluder,
    isVegetation,
    isGroundSurface,
    cadRelevance,
    reviewRequired,
    excludeFromGeometry: artifact.excludeFromGeometry ?? null,
    geometryParticipation: artifact.participation
      ? {
          participatesInLines: artifact.participation.participatesInLines ?? null,
          participatesInPlanes: artifact.participation.participatesInPlanes ?? null,
          participatesInDepthFusion: artifact.participation.participatesInDepthFusion ?? null,
          participatesInPhotogrammetry: artifact.participation.participatesInPhotogrammetry ?? null,
        }
      : null,
    stageTimings: artifact.stageTimings ?? null,
    isSynthetic,
  });
}

function adaptStructuralLineCandidate(artifact: StructuralLineCandidate, surveyId: string): UnifiedGeometryArtifact {
  const lineSubtype = structuralLineTypeToSubtype(artifact.lineType);
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'line_extraction_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
    isSynth, isSynth ? 'SYNTHETIC: Structural line produced by heuristic extraction, not real Hough/model inference' : undefined,
  );
  const isWallBottomEdge = artifact.lineType === 'wall_bottom_edge';
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'roof_line',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth
      ? `⚠️ Synthetic: Structural ${artifact.lineType} line${isWallBottomEdge ? ' (foundation edge — review required)' : ''}`
      : `Structural ${artifact.lineType} line${isWallBottomEdge ? ' (foundation edge — review required)' : ''}`,
    limitations: [...artifact.limitations],
    lineSegment: {
      start: reconPointToGeometryPoint(artifact.start),
      end: reconPointToGeometryPoint(artifact.end),
      coordinateSystem: 'normalized_image_0_1000',
    },
    lineSubtype,
    reviewRequired: true,
    stageTimings: artifact.stageTimings ?? null,
    isSynthetic: isSynth,
  });
}

function adaptVanishingPoint(artifact: VanishingPointArtifact, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'vanishing_point_worker', artifact.fileId, [], artifact.workerVersion, artifact.id,
    isSynth, isSynth ? 'SYNTHETIC: Vanishing point produced by heuristic RANSAC on synthetic lines, not real perspective model' : undefined,
  );
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'vanishing_point',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Vanishing point (${artifact.direction}, inlier ratio: ${artifact.inlierRatio.toFixed(2)})` : `Vanishing point (${artifact.direction}, inlier ratio: ${artifact.inlierRatio.toFixed(2)})`,
    limitations: [...artifact.limitations],
    center: reconPointToGeometryPoint(artifact.point),
    priority: 'low',
    stageTimings: artifact.stageTimings ?? null,
    isSynthetic: isSynth,
  });
}

function adaptConsensusPlaneCandidate(artifact: ConsensusPlaneCandidate, surveyId: string): UnifiedGeometryArtifact {
  const isSynth = isReconArtifactSynthetic(artifact);
  const provenance = makeReconProvenance(
    'geometry_recon', 'multi_view_fusion_worker', undefined, artifact.sourceFileIds, artifact.workerVersion, artifact.id,
    isSynth, isSynth ? 'SYNTHETIC: Consensus plane produced from heuristic inputs, not real multi-view stereo' : undefined,
  );
  const planeType: PlaneType = artifact.planeType === 'wall' ? 'wall' : 'roof';
  return makeEmptyArtifact({
    id: artifact.id,
    surveyId,
    geometryClass: 'consensus_plane',
    authority: isSynth ? { ...SYNTHETIC_ARTIFACT_AUTHORITY } : { ...RAW_EVIDENCE_AUTHORITY },
    provenance,
    confidence: artifact.confidence,
    label: isSynth ? `⚠️ Synthetic: Consensus ${artifact.planeType} plane (${artifact.consensusPhotoCount} photos)` : `Consensus ${artifact.planeType} plane (${artifact.consensusPhotoCount} photos)`,
    limitations: [...artifact.limitations],
    polygon: reconPointsToPolygon(artifact.polygon),
    planeType,
    pitchDegrees: artifact.estimatedPitch ?? null,
    azimuthDegrees: artifact.estimatedAzimuth ?? null,
    normalVector: artifact.normalVector,
    consensusPhotoCount: artifact.consensusPhotoCount,
    stageTimings: artifact.stageTimings ?? null,
    isSynthetic: isSynth,
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
