// ============================================================================
// lib/siteSurveys/unifiedGeometry/types.ts
//
// UNIFIED GEOMETRY CANONICAL TYPES — the single type contract for all geometry
// artifacts in SolarPro, regardless of which pipeline produced them.
//
// This replaces and unifies overlapping types from:
//   - Pipeline A: OverlayCandidate, RefinedCandidate, RoofObstructionRecord
//   - Pipeline B: GeometryReconstructionArtifact (13 subtypes)
//   - Evidence: EvidenceDerivedCandidateV1, SurveyEvidenceItem
//   - Candidate: GeometryCandidateSignal
//
// COORDINATE SYSTEM:
//   All geometry uses normalized_image_0_1000 (0-1000 scale).
//   World-space coordinates are in local meters (XY from CAD engine).
//   The unified types support both via the coordinateSystem discriminator.
// ============================================================================

import type {
  UnifiedGeometryAuthority,
  UnifiedGeometryAuthorityState,
} from './authority';

// ────────────────────────────────────────────────────────────────────────────
// Coordinate System
// ────────────────────────────────────────────────────────────────────────────

/**
 * Coordinate systems used in geometry artifacts.
 * - normalized_image_0_1000: Pixel coordinates normalized to 0-1000 range
 * - local_meters_xy: World-space coordinates in local meters (CAD space)
 */
export type GeometryCoordinateSystem = 'normalized_image_0_1000' | 'local_meters_xy';

/**
 * A 2D point in a specific coordinate system.
 */
export interface GeometryPoint2D {
  x: number;
  y: number;
  coordinateSystem: GeometryCoordinateSystem;
}

/**
 * A 2D polygon (closed) in a specific coordinate system.
 */
export interface GeometryPolygon {
  vertices: GeometryPoint2D[];
  coordinateSystem: GeometryCoordinateSystem;
}

/**
 * A 2D bounding box in a specific coordinate system.
 */
export interface GeometryBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: GeometryCoordinateSystem;
}

/**
 * A 2D line segment in a specific coordinate system.
 */
export interface GeometryLineSegment {
  start: GeometryPoint2D;
  end: GeometryPoint2D;
  coordinateSystem: GeometryCoordinateSystem;
}

/**
 * A 3D normal vector for plane orientation.
 */
export interface GeometryNormalVector {
  x: number;
  y: number;
  z: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Geometry Artifact Classification
// ────────────────────────────────────────────────────────────────────────────

/**
 * Canonical geometry class — unified across both pipelines.
 *
 * Replaces:
 *   - Pipeline A: RefinedGeometryClass (probable_roof_plane, probable_wall_plane, etc.)
 *   - Pipeline B: artifactType (roof_plane_candidate, wall_plane_candidate, etc.)
 *   - Pipeline A: candidateType (obstruction_candidate, roof_edge_candidate, etc.)
 */
export type UnifiedGeometryClass =
  | 'roof_plane'
  | 'wall_plane'
  | 'roof_line'
  | 'obstruction'
  | 'electrical_node'
  | 'segmentation_mask'
  | 'depth_map'
  | 'point_cloud'
  | 'vanishing_point'
  | 'consensus_plane'
  | 'ground_plane'
  | 'unknown';

/**
 * Roof line subtypes — the canonical line types for solar CAD.
 */
export type RoofLineSubtype = 'ridge' | 'eave' | 'rake' | 'hip' | 'valley' | 'wall_vertical' | 'wall_bottom_edge';

/**
 * Obstruction subtypes — canonical classification for solar CAD.
 */
export type ObstructionSubtype =
  | 'plumbing_vent'
  | 'exhaust_vent'
  | 'chimney'
  | 'skylight'
  | 'hvac_unit'
  | 'antenna'
  | 'satellite_dish'
  | 'roof_jack'
  | 'weatherhead'
  | 'solar_tube'
  | 'dormer'
  | 'ac_unit'
  | 'existing_solar_panel'
  | 'unknown_obstruction';

/**
 * Electrical node subtypes — canonical classification for solar CAD.
 */
export type ElectricalNodeSubtype =
  | 'main_service_panel'
  | 'subpanel'
  | 'meter'
  | 'utility_meter'
  | 'disconnect'
  | 'junction_box'
  | 'conduit'
  | 'conduit_run'
  | 'grounding'
  | 'inverter'
  | 'battery'
  | 'unknown_electrical';

/**
 * Facade subtypes — building envelope features relevant to solar installation.
 * These are review-only; they do NOT enter the CAD pipeline.
 */
export type FacadeSubtype =
  | 'siding'
  | 'window'
  | 'door'
  | 'garage_door'
  | 'fascia'
  | 'soffit'
  | 'gutter'
  | 'downspout'
  | 'porch'
  | 'deck'
  | 'steps'
  | 'railing'
  | 'unknown_facade';

/**
 * Site context subtypes — ground-level features relevant to solar site assessment.
 * These are review-only; they do NOT enter the CAD pipeline.
 */
export type SiteContextSubtype =
  | 'grass'
  | 'overgrown_grass'
  | 'sidewalk'
  | 'driveway'
  | 'gravel'
  | 'fence'
  | 'bushes'
  | 'vegetation_touching_structure'
  | 'unknown_site_context';

/** Semantic role assigned to a segmentation mask. Review metadata only. */
export type SemanticSceneRole =
  | 'structure'
  | 'facade'
  | 'vegetation'
  | 'ground_surface'
  | 'temporary_occluder'
  | 'site_context'
  | 'electrical_context'
  | 'unknown';

/** How relevant a semantic mask is to downstream CAD. Metadata only; never promotion authority. */
export type SemanticCadRelevance = 'none' | 'review_context' | 'existing_pipeline_only';

/**
 * Condition flags — quality/condition indicators on geometry artifacts.
 * These are review-only annotations; they do NOT enter the CAD pipeline.
 */
export type UnifiedConditionFlag =
  | 'moss'
  | 'algae'
  | 'damaged_siding'
  | 'blocked_access'
  | 'muddy_work_area';

/**
 * Plane type discriminator.
 */
export type PlaneType = 'roof' | 'wall' | 'ground';

/**
 * Segmentation backend that produced this mask.
 * Used to visually distinguish SAM 2 masks from Canny edge-detection masks
 * in the overlay renderer. Null for non-segmentation artifacts or legacy data.
 */
export type SegmentationBackend = 'sam2' | 'canny';

// ────────────────────────────────────────────────────────────────────────────
// Source Pipeline Provenance
// ────────────────────────────────────────────────────────────────────────────

/**
 * Which pipeline produced this artifact.
 * This is provenance metadata — it does NOT affect authority.
 */
export type GeometrySourcePipeline =
  | 'photo_vision'              // Pipeline A — OpenCV/YOLO/OCR
  | 'geometry_recon'            // Pipeline B — Segmentation/SfM/Depth
  | 'google_solar_api'          // Pipeline C — Google Solar API buildingInsights
  | 'obstruction_registration'  // Obstruction detection pipeline
  | 'manual'                    // Human-entered
  | 'merged'                    // Merged from multiple pipelines
  | 'mock';                     // Test/mock data

/**
 * Provenance record for a geometry artifact.
 * Every artifact must preserve its full provenance chain.
 */
export interface GeometryProvenance {
  /** Which pipeline produced this artifact */
  sourcePipeline: GeometrySourcePipeline;

  /** Tool name within the pipeline (e.g., 'opencv_contour', 'yolo_v8', 'mock_adapter') */
  toolName: string;

  /** Tool version */
  toolVersion: string;

  /** Run hash for deterministic identification */
  runHash: string;

  /** Source file IDs that contributed to this artifact */
  sourceFileIds: string[];

  /** Source artifact IDs that this was derived from (for promotion chain) */
  derivedFromArtifactIds: string[];

  /** Timestamp when this artifact was created */
  createdAt: string;

  /** User ID of the operator who reviewed/promoted (null if not yet reviewed) */
  reviewedBy: string | null;

  /** Timestamp of the most recent review/promotion */
  reviewedAt: string | null;

  /** Worker version that produced this artifact */
  workerVersion: string | null;

  /**
   * Whether this artifact was produced by a synthetic/heuristic implementation
   * rather than a real ML model or human input.
   *
   * Synthetic artifacts CANNOT be promoted to canonical geometry and CANNOT
   * enter the CAD pipeline, regardless of their authority state.
   *
   * When true, `disclaimer` MUST also be set with a human-readable explanation.
   */
  synthetic?: boolean;

  /**
   * Human-readable disclaimer explaining why this artifact is synthetic.
   * Only meaningful when `synthetic=true`.
   *
   * Example: 'SYNTHETIC: Generated by heuristic implementation, not a real ML model'
   */
  disclaimer?: string;

  /**
   * Marker indicating this artifact was backfilled from a legacy data store.
   * Used during migration to track data origin.
   */
  backfilledFrom?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Unified Geometry Artifact
// ────────────────────────────────────────────────────────────────────────────

/**
 * The unified geometry artifact — the canonical type for ALL geometry
 * artifacts in SolarPro, regardless of pipeline.
 *
 * This replaces:
 *   - Pipeline A: OverlayCandidate, RefinedCandidate
 *   - Pipeline B: GeometryReconstructionArtifact (13 subtypes)
 *   - Evidence: EvidenceDerivedCandidateV1
 *   - Candidate: GeometryCandidateSignal
 *
 * The `geometryClass` discriminator determines which optional fields
 * are populated. The `authority` envelope determines what the artifact
 * can and cannot do.
 */
export interface UnifiedGeometryArtifact {
  /** Unique artifact ID */
  id: string;

  /** Survey this artifact belongs to */
  surveyId: string;

  /** Canonical geometry classification */
  geometryClass: UnifiedGeometryClass;

  /** Unified authority envelope */
  authority: UnifiedGeometryAuthority;

  /** Full provenance chain */
  provenance: GeometryProvenance;

  /** Confidence score (0-100) */
  confidence: number;

  /** Human-readable label for this artifact */
  label: string;

  /** Limitations that apply to this artifact */
  limitations: string[];

  // ── Geometry fields (populated based on geometryClass) ──

  /** Bounding box (most artifacts) */
  bbox: GeometryBBox | null;

  /** Polygon outline (planes, segmentation masks, consensus planes) */
  polygon: GeometryPolygon | null;

  /** Line segment (roof lines) */
  lineSegment: GeometryLineSegment | null;

  /** Center point (obstructions, electrical nodes) */
  center: GeometryPoint2D | null;

  // ── Plane-specific fields ──

  /** Plane type (roof_plane, wall_plane) */
  planeType: PlaneType | null;

  /** Pitch/slope in degrees */
  pitchDegrees: number | null;

  /** Azimuth in degrees */
  azimuthDegrees: number | null;

  /** Normal vector (for 3D orientation) */
  normalVector: GeometryNormalVector | null;

  /** Area in square meters (if computable) */
  areaSqM: number | null;

  /** Inlier count for plane fitting */
  inlierCount: number | null;

  /** Total points sampled for plane fitting */
  totalPoints: number | null;

  // ── Line-specific fields ──

  /** Roof line subtype */
  lineSubtype: RoofLineSubtype | null;

  /** Estimated line length in meters */
  estimatedLengthM: number | null;

  // ── Obstruction-specific fields ──

  /** Obstruction subtype */
  obstructionSubtype: ObstructionSubtype | null;

  /** Physical footprint radius in meters */
  radiusM: number | null;

  /** Required clearance from footprint edge in meters */
  setbackM: number | null;

  /** Height above roof deck in feet */
  heightFt: number | null;

  /** Roof plane ID this obstruction sits on */
  roofPlaneId: string | null;

  /** CAD impact flags */
  cadImpact: ObstructionCadImpact | null;

  /**
   * Full obstruction metadata from the registration pipeline.
   * Only populated for geometryClass === 'obstruction' artifacts that were
   * migrated from site_survey_files.obstruction_data via dual-write or backfill.
   * Null for all other artifact types or for pre-migration obstruction artifacts.
   */
  obstructionMetadata: ObstructionMetadata | null;

  // ── Electrical-specific fields ──

  /** Electrical node subtype */
  electricalSubtype: ElectricalNodeSubtype | null;

  /** Floor/story number */
  story: number | null;

  /** Whether this is the primary interconnect point */
  isPrimaryInterconnect: boolean | null;

  // ── Depth map fields ──

  /** Depth map resolution */
  depthResolution: { width: number; height: number } | null;

  /** Depth metric type */
  depthMetric: string | null;

  // ── Consensus fields ──

  /** Number of source photos that agree on this consensus */
  consensusPhotoCount: number | null;

  // ── Segmentation mask fields ──

  /** Segmentation class label */
  segmentationClass: string | null;

  /** Segmentation backend that produced this mask ('sam2' or 'canny'). Null for non-segmentation artifacts. */
  segmentationBackend: SegmentationBackend | null;

  // ── Facade-specific fields (review-only, not CAD-safe) ──

  /** Facade subtype for building envelope features */
  facadeSubtype: FacadeSubtype | null;

  // ── Site context fields (review-only, not CAD-safe) ──

  /** Site context subtype for ground-level features */
  siteContextSubtype: SiteContextSubtype | null;

  // ── Condition & occluder flags (review-only annotations) ──

  /** Condition flags detected on this artifact (moss, damage, access issues) */
  conditionFlags: UnifiedConditionFlag[] | null;

  /** Whether this artifact represents an occluder that blocks view of structure */
  isOccluder: boolean | null;

  // ── Semantic classification metadata (review-only; not CAD/geometry authority) ──

  /** Semantic class attached to a mask. Mirrors segmentationClass for mask artifacts. */
  semanticClass?: string | null;

  /** Scene role for semantic mask review/display. */
  sceneRole?: SemanticSceneRole | null;

  /** True only for classes that describe existing structural surfaces. Metadata only. */
  isStructure?: boolean | null;

  /** True for temporary occluders such as truck/car/trailer/person/ladder. */
  isTemporaryOccluder?: boolean | null;

  /** True for vegetation classes such as tree/bush/grass. */
  isVegetation?: boolean | null;

  /** True for ground/site-surface classes such as grass/gravel/driveway. */
  isGroundSurface?: boolean | null;

  /** CAD relevance hint. Does not create or promote CAD geometry. */
  cadRelevance?: SemanticCadRelevance | null;

  /** Whether a human should review the semantic label/mask. */
  reviewRequired?: boolean | null;

  // ── Review state ──

  /** Current review state */
  reviewState: 'review_required' | 'accepted' | 'rejected';

  /** Review notes from human operator */
  reviewNotes: string | null;

  /** Priority for review queue */
  priority: 'high' | 'medium' | 'low';

  // ── Synthetic flag ──

  /**
   * Whether this artifact was produced by a synthetic/heuristic implementation.
   *
   * When true:
   *   - The artifact CANNOT be promoted to canonical geometry
   *   - The artifact CANNOT enter the CAD pipeline
   *   - Any UI displaying this artifact MUST show a visible badge:
   *     "⚠️ Synthetic — Awaiting real model"
   *   - The provenance.synthetic field is also true
   *   - The provenance.disclaimer field contains a human-readable explanation
   *
   * This field is the UI-facing contract for synthetic artifact labeling.
   * The canonical bridge enforces the runtime guard via provenance.synthetic.
   */
  isSynthetic: boolean;

  // ── Stage timing (for performance tracking) ──

  /** Pipeline stage timings in milliseconds */
  stageTimings: Record<string, number> | null;
}

/**
 * ObstructionMetadata — a JSONB-storable snapshot of the full RoofObstructionRecord
 * from the obstruction registration pipeline. Stored in the obstruction_metadata
 * column of unified_geometry_artifacts so that the unified table becomes the single
 * source of truth for obstruction data (replacing site_survey_files.obstruction_data).
 *
 * Design principle: This is a COPY of the data, not a reference. The unified artifact
 * owns this data once written. Changes to RoofObstructionRecord's source table should
 * be dual-written during Phase B, then backfilled in Phase C.
 *
 * Every field mirrors RoofObstructionRecord in roofObstructionRegistration.ts.
 * String-literal union types are re-declared here rather than imported, to keep the
 * unified geometry module self-contained and avoid circular dependencies.
 */
export interface ObstructionMetadata {
  /** Unique identifier for this obstruction (deterministic_hash from vision candidate) */
  id: string;
  /** The filename of the roof_plane photo this obstruction was found on */
  sourceFilename: string;
  /** The file_id of the representative file used for extraction */
  sourceFileId: string;
  /** Bounding box region in normalized coordinates */
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
    coordinateSystem: 'normalized_image_0_1000';
  };
  /** Center point in normalized coordinates */
  center: {
    x: number;
    y: number;
    coordinateSystem: 'normalized_image_0_1000';
  };
  /** Area in normalized units (0-1,000,000 scale) */
  areaNormalized: number;
  /** Aspect ratio (width / height) */
  aspectRatio: number;
  /** Size bucket category */
  sizeBucket: 'tiny' | 'small' | 'medium' | 'large' | 'huge';
  /** Orientation hint based on geometry */
  orientationHint: 'horizontal' | 'vertical' | 'square' | 'diagonal' | 'irregular';
  /** Distance from nearest image edge (0-1000 scale) */
  edgeDistance: number;
  /** Edge proximity category */
  edgeProximity: 'center' | 'near_center' | 'edge' | 'corner';
  /** Roof-plane quadrant */
  quadrant: 'nw' | 'ne' | 'sw' | 'se' | 'unknown';
  /** Setback buffer category */
  setbackBuffer: 'standard' | 'reduced' | 'none';
  /** Confidence score from the vision worker (0-100 scale) */
  confidence: number;
  /** Source detection method */
  detectionMethod: 'opencv_contour' | 'yolo_detection' | 'hybrid' | 'manual' | 'unknown';
  /** Any limitations or caveats about this detection */
  limitations: string[];
  /** Source photo URL for traceability */
  sourcePhotoUrl: string | null;
  /** Source image SHA256 for cache invalidation */
  sourceImageSha256: string | null;
  /** Region index from the vision worker */
  regionIndex: number;
  /** Review state (default: review_required) */
  reviewState: 'review_required' | 'accepted' | 'rejected';
  /** Classification of the obstruction */
  obstructionType: string | null;
  /** Priority level for CAD considerations */
  priority: 'high' | 'medium' | 'low';
  /** CAD block hint for representation */
  cadBlockHint: string;
  /** Obstruction footprint shape hint */
  obstructionFootprintHint: string;
  /** Clearance radius hint */
  clearanceRadiusHint: string;
  /** Setback category hint */
  setbackCategoryHint: 'standard' | 'reduced' | 'none';
  /** Layout avoidance priority (1-10, higher = more important to avoid) */
  layoutAvoidancePriority: number;
  /** Whether this obstruction requires human review */
  requiresHumanReview: boolean;
  /** Whether this obstruction can affect panel placement */
  canAffectPanelPlacement: boolean;
  /** Whether this obstruction can affect fire pathway */
  canAffectFirePathway: boolean;
  /** Whether this obstruction can affect conduit path */
  canAffectConduitPath: boolean;
  /** Whether this obstruction can affect structural attachment */
  canAffectStructuralAttachment: boolean;
}

/**
 * CAD impact flags for obstructions.
 * These flags indicate which CAD systems are affected by this obstruction.
 */
export interface ObstructionCadImpact {
  canAffectPanelPlacement: boolean;
  canAffectFirePathway: boolean;
  canAffectConduitPath: boolean;
  canAffectStructuralAttachment: boolean;
  layoutAvoidancePriority: 'high' | 'medium' | 'low';
  cadBlockHint: string | null;
  obstructionFootprintHint: string | null;
  clearanceRadiusHint: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Unified Geometry Evidence Bundle
// ────────────────────────────────────────────────────────────────────────────

/**
 * The unified geometry evidence bundle — consumes artifacts from BOTH pipelines
 * and presents them as a single cross-referenced collection.
 *
 * This is the bridge between the two pipelines. It groups artifacts by:
 *   1. Source photo — which survey photo(s) contributed
 *   2. Geometry class — what kind of geometry (roof plane, obstruction, etc.)
 *   3. Authority state — what the artifact can do
 *
 * Downstream consumers (review workflow, CAD engine) consume THIS type,
 * not individual pipeline types.
 */
export interface UnifiedGeometryEvidenceBundle {
  /** Schema version */
  schemaVersion: 'unified_geometry_evidence_bundle_v1';

  /** Survey ID */
  surveyId: string;

  /** All artifacts from both pipelines, unified */
  artifacts: UnifiedGeometryArtifact[];

  /** Cross-reference: artifacts grouped by source file ID */
  artifactsBySourceFile: Record<string, string[]>;

  /** Cross-reference: artifacts grouped by geometry class */
  artifactsByGeometryClass: Record<UnifiedGeometryClass, string[]>;

  /** Cross-reference: artifacts grouped by authority state */
  artifactsByAuthorityState: Record<UnifiedGeometryAuthorityState, string[]>;

  /** Counts by pipeline source */
  pipelineCounts: {
    photoVision: number;
    geometryRecon: number;
    googleSolarApi: number;
    obstructionRegistration: number;
    manual: number;
    merged: number;
    mock: number;
  };

  /** Counts by review state */
  reviewStateCounts: {
    reviewRequired: number;
    accepted: number;
    rejected: number;
  };

  /** Quality summary from geometry intelligence (if available) */
  intelligenceSummary: GeometryIntelligenceSummary | null;

  /** Authority envelope for the entire bundle */
  authority: UnifiedGeometryAuthority;

  /** Bundle creation timestamp */
  createdAt: string;
}

/**
 * Lightweight intelligence summary for the evidence bundle.
 * Populated from GeometryIntelligenceReportV1 (once wired).
 */
export interface GeometryIntelligenceSummary {
  /** Overall quality score (0-100) */
  qualityScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Number of risk signals */
  riskSignalCount: number;
  /** Top risk signals */
  topRisks: string[];
  /** Number of discrepancy clusters between pipelines */
  discrepancyClusterCount: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Promotion Record
// ────────────────────────────────────────────────────────────────────────────

/**
 * A record of a promotion action — when an artifact transitions from one
 * authority state to another.
 *
 * This creates an immutable audit trail for every promotion.
 */
export interface GeometryPromotionRecord {
  /** Unique promotion ID */
  id: string;

  /** The artifact being promoted */
  artifactId: string;

  /** Previous authority state */
  fromState: UnifiedGeometryAuthorityState;

  /** New authority state */
  toState: UnifiedGeometryAuthorityState;

  /** User who performed the promotion */
  promotedBy: string;

  /** Timestamp */
  promotedAt: string;

  /** Review notes */
  notes: string | null;

  /** Whether this promotion was validated by the intelligence report */
  intelligenceValidated: boolean;

  /** Any warnings from the intelligence report */
  intelligenceWarnings: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Canonical Building Model (v1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The Canonical Building Model — the SINGLE SOURCE OF TRUTH for building
 * geometry that the CAD engine consumes.
 *
 * This model is constructed ONLY from promoted_canonical artifacts.
 * It cannot be created from raw or review-only artifacts.
 *
 * The CAD engine reads this model and only this model to produce:
 *   - CADModel (layout solve output)
 *   - Permit plan sets
 *   - BOM/cost calculations
 */
export interface CanonicalBuildingModel {
  /** Schema version */
  schemaVersion: 'canonical_building_model_v1';

  /** Survey ID */
  surveyId: string;

  /** Authority — must be promoted_canonical or cad_safe */
  authority: UnifiedGeometryAuthority;

  /** All roof planes in the building */
  roofPlanes: CanonicalRoofPlane[];

  /** All wall planes in the building */
  wallPlanes: CanonicalWallPlane[];

  /** All obstructions on the building */
  obstructions: CanonicalObstruction[];

  /** All electrical nodes on the building */
  electricalNodes: CanonicalElectricalNode[];

  /** All structural lines (ridges, eaves, rakes) */
  structuralLines: CanonicalStructuralLine[];

  /** Building metadata */
  metadata: CanonicalBuildingMetadata;

  /** Provenance chain — which promoted artifacts built this model */
  provenance: {
    artifactIds: string[];
    promotionRecordIds: string[];
    builtAt: string;
    builtBy: 'automated' | 'manual';
  };
}

/**
 * Canonical roof plane — promoted and review-verified.
 */
export interface CanonicalRoofPlane {
  id: string;
  polygon?: GeometryPolygon;  // local_meters_xy — undefined when source artifact lacks geometry
  /** If true, the source artifact had neither polygon nor bbox.
   *  Downstream consumers (CAD bridge, permit engine) MUST reject or flag
   *  degraded planes — never silently use them for layout generation. */
  degradedNoGeometry?: boolean;
  pitchDegrees: number;
  azimuthDegrees: number;
  areaSqM: number;
  normalVector: GeometryNormalVector;
  sourceArtifactId: string;  // links back to the promoted artifact
  setbackDefaults: {
    eaveM: number;
    ridgeM: number;
    rakeM: number;
  };
}

/**
 * Canonical wall plane — promoted and review-verified.
 */
export interface CanonicalWallPlane {
  id: string;
  polygon?: GeometryPolygon;  // local_meters_xy — undefined when source artifact lacks geometry
  /** If true, the source artifact had neither polygon nor bbox.
   *  Downstream consumers MUST reject or flag degraded planes. */
  degradedNoGeometry?: boolean;
  estimatedHeightM: number | null;
  facingDirection: string | null;
  sourceArtifactId: string;
}

/**
 * Canonical obstruction — promoted and review-verified.
 * Replaces CADObstruction with source='promoted_canonical' only.
 */
export interface CanonicalObstruction {
  id: string;
  type: ObstructionSubtype;
  center: GeometryPoint2D;  // local_meters_xy
  radiusM: number;
  setbackM: number;
  totalRadiusM: number;
  heightFt: number;
  roofPlaneId: string | null;
  source: 'promoted_canonical';  // ONLY this value — no 'vision' or 'manual'
  confidence: number;
  sourceArtifactId: string;
  cadImpact: ObstructionCadImpact | null;
}

/**
 * Canonical electrical node — promoted and review-verified.
 * Replaces CADElectricalNode with source='promoted_canonical' only.
 */
export interface CanonicalElectricalNode {
  id: string;
  type: ElectricalNodeSubtype;
  center: GeometryPoint2D;  // local_meters_xy
  story: number;
  isPrimaryInterconnect: boolean;
  source: 'promoted_canonical';  // ONLY this value
  confidence: number;
  sourceArtifactId: string;
}

/**
 * Canonical structural line — promoted and review-verified.
 */
export interface CanonicalStructuralLine {
  id: string;
  lineSubtype: RoofLineSubtype;
  lineSegment: GeometryLineSegment;  // local_meters_xy
  estimatedLengthM: number | null;
  sourceArtifactId: string;
}

/**
 * Building metadata — general properties of the building model.
 */
export interface CanonicalBuildingMetadata {
  /** Building type classification */
  buildingType: 'residential' | 'commercial' | 'unknown';
  /** Number of stories */
  stories: number;
  /** Roof type classification */
  roofType: 'gable' | 'hip' | 'flat' | 'shed' | 'gambrel' | 'mansard' | 'unknown';
  /** Primary roof pitch in degrees */
  primaryPitchDegrees: number | null;
  /** Primary roof azimuth in degrees */
  primaryAzimuthDegrees: number | null;
  /** Building footprint area in square meters */
  footprintAreaSqM: number | null;
  /** Address snapshot */
  addressSnapshot: string | null;
  /** GPS coordinates */
  latitude: number | null;
  longitude: number | null;
}
