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
  /** Photo classification label from the survey file (e.g. 'roof_plane', 'overview'). Used to prioritize SAM 2 processing for roof-domain photos. */
  label?: string | null;
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

/** Mesh artifact — triangulated surface from depth-based reconstruction. */
export interface MeshArtifact {
  artifactType: 'mesh';
  /** Unique artifact ID. */
  id: string;
  /** Flat Float32 array [x,y,z,x,y,z,...] of vertex positions. Stored as base64. */
  verticesData: string;
  /** Flat Uint32 array [v0,v1,v2,v0,v1,v2,...] of triangle indices. Stored as base64. */
  trianglesData: string;
  /** Number of vertices. */
  vertexCount: number;
  /** Number of triangles. */
  triangleCount: number;
  /** Total estimated surface area (in relative depth units). */
  estimatedArea: number;
  /** Number of fitted planes this mesh was constructed from. */
  planeCount: number;
  /** IDs of source photos used. */
  sourceFileIds: string[];
  /** Confidence score (0-100). */
  confidence: number;
  /** Worker version that produced this artifact. */
  workerVersion: string;
  /** Authority envelope — always review-only. */
  authority: GeometryReconstructionAuthority;
  /** Limitations and disclaimers. */
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
  /** Polygon outline from segmentation mask (real contour geometry, not bbox-derived). */
  polygon?: NormalizedPoint[];
  /** Source segmentation mask ID this plane was derived from. */
  sourceMaskId?: string;
  /** Source file ID for overlay rendering. */
  fileId?: string;
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
  /** Polygon outline from segmentation mask (real contour geometry, not bbox-derived). */
  polygon?: NormalizedPoint[];
  /** Source segmentation mask ID this plane was derived from. */
  sourceMaskId?: string;
  /** Source file ID for overlay rendering. */
  fileId?: string;
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

// ---------------------------------------------------------------------------
// Segmentation class taxonomy — expanded for residential site survey
// ---------------------------------------------------------------------------

/**
 * Facade segmentation classes — visible house features relevant for
 * solar site assessment (conduit routing, mounting, setback).
 */
export type FacadeSegmentationClass =
  | 'siding' | 'window' | 'door' | 'garage_door' | 'fascia' | 'soffit'
  | 'gutter' | 'downspout' | 'porch' | 'deck' | 'steps' | 'railing'
  | 'chimney' | 'vent_pipe' | 'skylight';

/**
 * Site context segmentation classes — ground-level features that
 * affect installation planning and access.
 */
export type SiteContextSegmentationClass =
  | 'grass' | 'overgrown_grass' | 'sidewalk' | 'driveway' | 'gravel'
  | 'fence' | 'bushes' | 'trees' | 'vegetation_touching_structure';

/**
 * Electrical/solar segmentation classes — existing infrastructure
 * critical for solar system design and interconnection.
 */
export type ElectricalSegmentationClass =
  | 'utility_meter' | 'main_service_panel' | 'disconnect' | 'conduit'
  | 'inverter' | 'battery' | 'ac_unit' | 'existing_solar_panel';

/**
 * Occluder segmentation classes — objects to IGNORE for geometry
 * purposes. Kept for review/display but NEVER fed to downstream
 * geometry stages (line extraction, plane extraction, etc.).
 */
export type OccluderSegmentationClass =
  | 'car' | 'truck' | 'trailer' | 'person' | 'ladder' | 'trash_can'
  | 'tools' | 'temporary_materials';

/**
 * Condition segmentation classes — quality/condition indicators
 * that affect installation feasibility or require remediation.
 */
export type ConditionSegmentationClass =
  | 'moss' | 'algae' | 'damaged_siding' | 'blocked_access' | 'muddy_work_area';

/**
 * Legacy segmentation classes — the original 7 classes kept for
 * backward compatibility with existing artifacts and DB data.
 */
export type LegacySegmentationClass = 'roof' | 'wall' | 'sky' | 'tree' | 'ground' | 'obstruction' | 'equipment' | 'background';

/** Semantic class labels for segmentation — expanded from 7 to 33 classes. */
export type SegmentationClass =
  | LegacySegmentationClass
  | FacadeSegmentationClass
  | SiteContextSegmentationClass
  | ElectricalSegmentationClass
  | OccluderSegmentationClass
  | ConditionSegmentationClass;

/** All recognized segmentation classes. */
export const SEGMENTATION_CLASSES: readonly SegmentationClass[] = [
  // Legacy (original 7 + background for unknown/unclassified regions)
  'roof', 'wall', 'sky', 'tree', 'ground', 'obstruction', 'equipment', 'background',
  // Facade
  'siding', 'window', 'door', 'garage_door', 'fascia', 'soffit',
  'gutter', 'downspout', 'porch', 'deck', 'steps', 'railing',
  'chimney', 'vent_pipe', 'skylight',
  // Site context
  'grass', 'overgrown_grass', 'sidewalk', 'driveway', 'gravel',
  'fence', 'bushes', 'trees', 'vegetation_touching_structure',
  // Electrical/solar
  'utility_meter', 'main_service_panel', 'disconnect', 'conduit',
  'inverter', 'battery', 'ac_unit', 'existing_solar_panel',
  // Occluder
  'car', 'truck', 'trailer', 'person', 'ladder', 'trash_can',
  'tools', 'temporary_materials',
  // Condition
  'moss', 'algae', 'damaged_siding', 'blocked_access', 'muddy_work_area',
] as const;

// ---------------------------------------------------------------------------
// Segmentation class category sets — for filtering and classification
// ---------------------------------------------------------------------------

/** Facade classes — visible house features relevant for site assessment. */
export const FACADE_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'siding', 'window', 'door', 'garage_door', 'fascia', 'soffit',
  'gutter', 'downspout', 'porch', 'deck', 'steps', 'railing',
  'chimney', 'vent_pipe', 'skylight',
] as const);

/** Site context classes — ground-level features that affect installation planning. */
export const SITE_CONTEXT_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'grass', 'overgrown_grass', 'sidewalk', 'driveway', 'gravel',
  'fence', 'bushes', 'trees', 'vegetation_touching_structure',
] as const);

/** Electrical/solar classes — existing infrastructure relevant to system design. */
export const ELECTRICAL_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'utility_meter', 'main_service_panel', 'disconnect', 'conduit',
  'inverter', 'battery', 'ac_unit', 'existing_solar_panel',
] as const);

/** Occluder classes — objects to IGNORE for geometry, flag for review only. */
export const OCCLUDER_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'car', 'truck', 'trailer', 'person', 'ladder', 'trash_can',
  'tools', 'temporary_materials',
] as const);

/** Condition flag classes — quality/condition indicators. */
export const CONDITION_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'moss', 'algae', 'damaged_siding', 'blocked_access', 'muddy_work_area',
] as const);

/**
 * Classes that ARE relevant for solar site assessment geometry.
 * These pass through the SAM2 filter and produce UnifiedGeometryArtifacts.
 *
 * Expanded from {roof, wall, obstruction, equipment} to include:
 * - Facade features (affect mounting, conduit routing, setback)
 * - Electrical/solar (existing infrastructure)
 * - Condition flags (affect installation feasibility)
 * - Vegetation touching structure (clearance issue)
 * - Fence/bushes (may affect access planning)
 *
 * NOT included (filtered out before artifact creation):
 * - Sky, ground, tree (already filtered — not useful for site assessment)
 * - Grass, sidewalk, driveway, gravel (site context, not geometry)
 * - Car, truck, person, etc. (occluders — not structural)
 */
export const SOLAR_RELEVANT_SEGMENTATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  // Legacy roof-relevant
  'roof', 'wall', 'obstruction', 'equipment',
  // Facade — relevant for conduit routing, mounting points, setback
  'siding', 'window', 'door', 'garage_door', 'fascia', 'soffit',
  'gutter', 'downspout', 'porch', 'deck', 'steps', 'railing',
  // Roof penetrations — critical for solar placement and structural review
  'chimney', 'vent_pipe', 'skylight',
  // Electrical/solar — critical for system design
  'utility_meter', 'main_service_panel', 'disconnect', 'conduit',
  'inverter', 'battery', 'ac_unit', 'existing_solar_panel',
  // Condition — affects installation decisions
  'moss', 'algae', 'damaged_siding', 'blocked_access', 'muddy_work_area',
  // Vegetation touching structure — clearance issue
  'vegetation_touching_structure',
  // Bushes/fence — may affect access planning
  'fence', 'bushes',
] as const);

// ---------------------------------------------------------------------------
// Condition flags — quality indicators on segmentation masks
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Geometry participation controls — Pass 3E
// ---------------------------------------------------------------------------

/**
 * Geometry participation flags — control which downstream stages a
 * segmentation mask may feed into. These are metadata-only fields that
 * prevent non-structural masks (sky, vegetation, vehicles, etc.) from
 * contaminating geometry extraction while keeping them available for
 * overlay rendering and obstruction/shading context.
 *
 * All fields default to true for backward compatibility — existing masks
 * without these fields participate in all stages. Only masks that
 * explicitly set flags=false are excluded from specific stages.
 */
export interface GeometryParticipationFlags {
  /** Whether this mask feeds into structural line extraction (Hough lines, ridge/eave/rake). */
  participatesInLines?: boolean;
  /** Whether this mask feeds into plane extraction (roof planes, wall planes). */
  participatesInPlanes?: boolean;
  /** Whether this mask feeds into depth fusion (MiDaS depth map alignment). */
  participatesInDepthFusion?: boolean;
  /** Whether this mask feeds into photogrammetry (SfM point cloud, mesh reconstruction). */
  participatesInPhotogrammetry?: boolean;
}

/**
 * Per-class geometry participation defaults.
 * Controls which downstream stages each segmentation class may feed into.
 * These defaults are applied when masks are created in the segmentation worker.
 *
 * Design principles:
 * - Roof/wall/fascia/soffit/gutter/chimney: full participation (structure surfaces)
 * - Sky: no participation at all (giant sky polygons poison geometry)
 * - Vegetation: no lines/planes/depth (trees are obstruction context only, not geometry)
 * - Vehicles/occluders: no participation (temporary objects, not structural)
 * - Ground/hardscape: no lines/planes (flat surfaces produce spurious horizontal lines)
 * - Condition flags (moss, algae): no geometry (quality indicators, not surfaces)
 * - Electrical equipment: no geometry (existing infrastructure, not structural surface)
 */
export const GEOMETRY_PARTICIPATION_DEFAULTS: Readonly<Record<SegmentationClass, GeometryParticipationFlags>> = {
  // ── Structure surfaces: full participation ──
  roof:   { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  wall:   { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  siding: { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  fascia: { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  soffit: { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  gutter: { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  chimney:   { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  vent_pipe: { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },
  skylight:  { participatesInLines: true, participatesInPlanes: true, participatesInDepthFusion: true, participatesInPhotogrammetry: true },

  // ── Sky: NO participation (giant sky masks poison all geometry stages) ──
  sky: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Vegetation: obstruction/shading context only, NOT geometry ──
  tree:                        { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  trees:                       { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  bushes:                      { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  vegetation_touching_structure: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  grass:                       { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  overgrown_grass:             { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  moss:                        { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },
  algae:                       { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: true },

  // ── Ground / hardscape: no lines or planes (spurious horizontal lines) ──
  ground:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  driveway: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  gravel:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  sidewalk: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },

  // ── Vehicles: no participation (temporary objects, not structural) ──
  car:    { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  truck:  { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  trailer: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Occluder / temporary: no participation ──
  person:             { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  ladder:             { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  trash_can:          { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  tools:              { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  temporary_materials: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Facade openings: no geometry (openings are voids, not surfaces) ──
  window:      { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  door:        { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  garage_door: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },

  // ── Facade non-structure: porch/deck/steps/railing are site context ──
  porch:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  deck:    { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  steps:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  railing: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  fence:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },

  // ── Electrical / solar: no geometry (existing infrastructure, not surfaces) ──
  ac_unit:              { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  existing_solar_panel: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  utility_meter:        { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  main_service_panel:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  disconnect:           { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  conduit:              { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  inverter:             { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  battery:              { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Downspout: no geometry ──
  downspout: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: true,  participatesInPhotogrammetry: true },

  // ── Condition flags: no geometry (quality indicators, not surfaces) ──
  damaged_siding: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  blocked_access: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
  muddy_work_area: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Legacy catch-alls ──
  obstruction: { participatesInLines: true,  participatesInPlanes: true,  participatesInDepthFusion: true,  participatesInPhotogrammetry: true },
  equipment:   { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },

  // ── Background: unknown/unclassified regions — NO participation in any geometry stage ──
  // Introduced in Phase 0 (P0-8.1) to replace null-skip behavior for unclassified masks.
  // Background masks are filtered from Pipeline B by SOLAR_RELEVANT_SEGMENTATION_CLASSES
  // but remain available for overlay display and manual review.
  background: { participatesInLines: false, participatesInPlanes: false, participatesInDepthFusion: false, participatesInPhotogrammetry: false },
};

/**
 * Vegetation segmentation classes — these produce obstruction/shading context
 * but must NEVER produce structural geometry (lines, planes, depth fusion).
 * Vegetation masks remain viewable as overlays and participate in photogrammetry
 * for scene context, but are excluded from all geometry extraction stages.
 */
export const VEGETATION_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'tree',
  'trees',
  'bushes',
  'vegetation_touching_structure',
  'grass',
  'overgrown_grass',
  'moss',
  'algae',
] as const);

/**
 * Maximum fraction of the total image area that a sky mask may occupy
 * before being excluded from geometry participation. Giant sky masks
 * (often 40-70% of the image) produce huge polygons that contaminate
 * downstream geometry stages with spurious boundary lines and
 * incorrect plane associations.
 *
 * Sky masks below this threshold are kept but still have all
 * participation flags set to false (they never participate in geometry).
 * Sky masks above this threshold are additionally marked with
 * excludeFromGeometry=true to signal that they should be suppressed
 * entirely from geometry processing, even as occluder context.
 *
 * The threshold is generous (80%) to avoid suppressing legitimate
 * small-sky regions in tight framing. The real problem is the
 * giant "background" sky masks that span 40-70% of the image.
 */
export const MAX_MASK_AREA_FRACTION_SKY = 0.80;

/**
 * Structure classes that may produce structural geometry (lines, planes).
 * Used by the structure boundary tightening logic (Pass 3E Task D) to
 * identify which masks are structure candidates that should be scrutinized.
 */
export const STRUCTURE_CANDIDATE_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'roof', 'wall', 'siding', 'fascia', 'soffit', 'gutter', 'chimney',
  'vent_pipe', 'skylight', 'porch', 'deck', 'steps', 'railing',
] as const);

/**
 * Minimum confidence for a structure mask to survive boundary tightening.
 * Masks below this threshold are likely fragmentary detections from
 * low-contrast boundaries or partial occlusion. Set at 25 (out of 100)
 * to suppress the weakest fragments while preserving moderate detections.
 *
 * Pass 3E Task D: suppress low-confidence structure fragments.
 */
export const MIN_STRUCTURE_CONFIDENCE = 25;

/**
 * Minimum mask area (in normalized 0-1000 coordinate units squared) for a
 * wall-class mask to survive boundary tightening. Wall fragments smaller
 * than this are typically disconnected noise or edge artifacts rather than
 * meaningful structural surfaces.
 *
 * 1000 normalized² = ~0.1% of image area, which is roughly a 32×32 pixel
 * region in a 1000×1000 normalized image — too small for reliable geometry.
 *
 * Pass 3E Task D: suppress tiny disconnected wall fragments.
 */
export const MIN_WALL_MASK_AREA = 1000;

/**
 * Maximum overlap fraction between a structure mask and sky masks before
 * the structure mask is suppressed. A structure mask that overlaps heavily
 * with sky (>40%) is likely a false detection at the roof-sky boundary
 * where SAM2 bleeds structure classification into the sky region.
 *
 * Pass 3E Task D: suppress sky-overlapping structure masks.
 */
export const MAX_SKY_OVERLAP_FRACTION = 0.40;

/**
 * Maximum overlap fraction between a roof mask and vegetation masks before
 * the roof mask is suppressed. A roof mask that overlaps heavily with
 * vegetation (>50%) is likely a misclassification where tree canopy has
 * been partially classified as roof surface, which would produce
 * spurious roof planes in the geometry pipeline.
 *
 * Pass 3E Task D: suppress roof fragments merged with vegetation.
 */
export const MAX_ROOF_VEGETATION_OVERLAP_FRACTION = 0.50;

/** Condition flags detected on a segmentation mask region. */
export type ConditionFlag =
  | 'moss' | 'algae' | 'damaged_siding' | 'blocked_access' | 'muddy_work_area';

/** All valid condition flag values (for validation). */
export const CONDITION_FLAGS: readonly ConditionFlag[] = [
  'moss', 'algae', 'damaged_siding', 'blocked_access', 'muddy_work_area',
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
  /**
   * Condition flags detected on this mask region.
   * Populated when the mask's segmentationClass is a condition class,
   * OR when a secondary detection finds condition indicators on a
   * structural mask (e.g., moss on a roof mask).
   * Null/undefined when no conditions detected.
   */
  conditionFlags?: ConditionFlag[] | null;
  /**
   * Whether this mask represents an occluder that should be ignored
   * for geometry purposes. Occluder masks (car, person, ladder, etc.)
   * are kept for review/display but NEVER fed to downstream geometry
   * stages (line extraction, plane extraction, etc.).
   */
  isOccluder?: boolean | null;
  /**
   * Whether this mask should be entirely excluded from geometry
   * processing, even as occluder context. Set to true for giant
   * sky masks that span most of the image and would poison geometry
   * stages. The mask remains viewable as an overlay but is
   * completely suppressed from line extraction, plane extraction,
   * depth fusion, and photogrammetry.
   *
   * Pass 3E — Sky Containment.
   */
  excludeFromGeometry?: boolean | null;
  /**
   * Geometry participation flags — control which downstream stages
   * this mask feeds into. These are metadata-only fields that prevent
   * non-structural masks from contaminating geometry extraction while
   * keeping them available for overlay rendering and obstruction/shading.
   *
   * When absent, defaults are determined by GEOMETRY_PARTICIPATION_DEFAULTS
   * based on the segmentationClass. When present, the explicit values
   * override the class defaults.
   *
   * Pass 3E — Geometry Participation Controls.
   */
  participation?: GeometryParticipationFlags | null;
  /**
   * Whether this mask represents vegetation. Vegetation masks are
   * useful for solar obstruction/shading analysis but must NEVER
   * produce structural geometry (lines, planes). Vegetation masks
   * have participatesInLines=false, participatesInPlanes=false,
   * and participatesInDepthFusion=false by default.
   *
   * Set to true for classes in VEGETATION_CLASSES.
   *
   * Pass 3E — Vegetation Containment.
   */
  isVegetation?: boolean | null;
}

// ---------------------------------------------------------------------------
// Structural line candidate — extended line types (Phase 3)
// ---------------------------------------------------------------------------

/** Extended structural line type including wall_vertical and wall_bottom_edge. */
export type StructuralLineType = 'ridge' | 'eave' | 'rake' | 'valley' | 'hip' | 'wall_vertical' | 'wall_bottom_edge';

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
  | MeshArtifact
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
  'mesh',
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
  /** Per-stage duration breakdown in milliseconds: { "segmentation": 12345, "line_extraction": 678, ... } */
  stageDurations: Record<string, number> | null;
  /** Stage where the pipeline failed (null if completed or not started yet). */
  failureStage: string | null;
  /** Worker identity that claimed this job (e.g. 'render-worker-abc123'). Null if unclaimed. */
  lockedBy: string | null;
  /** When this job was claimed by a worker. Null if unclaimed. */
  lockedAt: string | null;
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
