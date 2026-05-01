// ============================================================================
// lib/vision/types.ts — Vision Pipeline Canonical Type Contracts
//
// VERSION: VISION_PIPELINE_VERSION = 1
//
// ARCHITECTURE:
//   Photos (project_files)
//     → yoloClient.inferRoboflowFromPath()  (app backend, calls VISION_SERVICE_URL)
//     → ar_detections (app DB)     ← raw detections stored here
//     → visionAggregator.ts        ← YOU ARE HERE (aggregation + world projection)
//     → VisionAggregationResult    ← fed into visionPatch.ts
//     → patchSystemDefinitionFromVision() → SystemDefinition (obstructions, electrical)
//     → CAD engine (collision avoidance, conduit routing)
//
// DETECTION CLASSES:
//   Roof obstructions: vent, skylight, hvac_unit, chimney, pipe_jack, dormer
//   Electrical nodes:  meter_socket, main_panel, disconnect, sub_panel, service_entry
//   Roof geometry:     roof_edge, ridge_line, valley_line, gutter_line, hip_line
//
// COORDINATE SYSTEMS:
//   ImageSpace:  pixel coordinates (x, y) normalized 0–1 or absolute px
//   WorldSpace:  local XY meters from GPS origin (matches CAD engine geometry.ts)
//   GeoSpace:    WGS84 lat/lng
//
// RULES:
//   - NEVER import from CAD engine types here (unidirectional dependency)
//   - NEVER import from SystemDefinition here
//   - All confidence values are 0.0–1.0
//   - All world coordinates are meters from project origin
// ============================================================================

// ─── Version ─────────────────────────────────────────────────────────────────

export const VISION_PIPELINE_VERSION = 1 as const;

// ─── Detection Classes ───────────────────────────────────────────────────────

/**
 * Roof obstruction classes — physical objects on the roof that affect
 * panel placement, setbacks, and fire pathways.
 */
export type ObstructionClass =
  | 'vent'            // plumbing/exhaust vent pipe
  | 'skylight'        // roof skylight (any size)
  | 'hvac_unit'       // HVAC condenser or rooftop unit
  | 'chimney'         // brick/metal chimney stack
  | 'pipe_jack'       // metal pipe jack/boot
  | 'dormer'          // dormer window structure
  | 'solar_tube'      // sun tunnel / tubular skylight
  | 'antenna'         // TV antenna or dish
  | 'other_obstruction'; // catch-all

/**
 * Electrical node classes — equipment relevant to conduit routing,
 * interconnection point selection, and NEC 705.12 compliance.
 */
export type ElectricalClass =
  | 'meter_socket'    // utility meter
  | 'main_panel'      // main electrical service panel
  | 'disconnect'      // AC disconnect switch
  | 'sub_panel'       // sub-panel / load center
  | 'service_entry';  // service entrance point (overhead or underground)

/**
 * Roof geometry classes — structural boundaries used to validate or
 * correct GPS-derived roof plane polygons.
 */
export type RoofGeometryClass =
  | 'roof_edge'       // eave or rake edge
  | 'ridge_line'      // peak ridge
  | 'valley_line'     // valley between planes
  | 'gutter_line'     // gutter / fascia line
  | 'hip_line';       // hip rafter line

/** Union of all detection classes */
export type DetectionClass = ObstructionClass | ElectricalClass | RoofGeometryClass;

// ─── Vision Raw Detection (YOLOv8) ────────────────────────────────────────────

/**
 * VisionBoundingBox — normalized bounding box from the YOLOv8 inference service.
 * All values are 0.0–1.0 fractions of image width/height.
 * x, y = center point; width, height = box dimensions.
 */
export interface VisionBoundingBox {
  x: number;       // center x (0–1)
  y: number;       // center y (0–1)
  width: number;   // box width (0–1)
  height: number;  // box height (0–1)
}

/**
 * VisionDetection — single detection returned by the YOLOv8 inference service.
 * Matches the shape returned by yoloClient.ts (POST /vision/infer detections[]).
 */
export interface VisionDetection {
  /** Detection class label (matches DetectionClass union) */
  class: string;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Bounding box in image coordinates */
  bbox: VisionBoundingBox;
  /** Raw detection id (optional) */
  detection_id?: string;
}

/**
 * VisionInferenceResult — response from the in-house YOLOv8 inference service.
 * Matches the InferResponse shape returned by services/vision/server.py.
 */
export interface VisionInferenceResult {
  /** Array of per-object detections */
  detections: VisionDetection[];
  /** Total detection count (== detections.length) */
  detectionCount: number;
  /** Server-side inference latency in milliseconds */
  inferenceMs: number;
  /** Path/name of the model checkpoint used */
  modelPath: string;
}

/**
 * @deprecated Use VisionDetection instead.
 * Alias kept for backward compatibility with existing call-sites.
 */
export type RoboflowDetection = VisionDetection;

/**
 * @deprecated Use VisionInferenceResult instead.
 * Alias kept for backward compatibility with existing call-sites.
 */
export type RoboflowInferenceResult = VisionInferenceResult;

/**
 * @deprecated Use VisionBoundingBox instead.
 * Alias kept for backward compatibility with existing call-sites.
 */
export type RoboflowBoundingBox = VisionBoundingBox;

// ─── Photo Metadata (context for world projection) ───────────────────────────

/**
 * PhotoContext — metadata attached to each survey photo that enables
 * mapping from image-space detections to world-space coordinates.
 *
 * Sources:
 *   - GPS: from photo EXIF or survey metadata
 *   - azimuth: compass bearing when photo was taken (degrees 0=N)
 *   - pitch: camera tilt from horizontal (degrees, 0=horizontal, 90=straight down)
 *   - label: human/app-assigned label (e.g. "north_elevation", "roof_plane_1")
 */
export interface PhotoContext {
  /** Absolute URL or relative path (matches project_files.url) */
  fileUrl: string;
  /** project_files.id */
  fileId: string;
  /** Photo GPS lat (from EXIF or survey form) */
  lat?: number | null;
  /** Photo GPS lng (from EXIF or survey form) */
  lng?: number | null;
  /** Camera azimuth when photo was taken (degrees, 0=N, 90=E) */
  azimuth?: number | null;
  /** Camera pitch from horizontal (degrees) */
  pitch?: number | null;
  /** App-assigned slot/label (e.g. "roof_north", "panel_main", "meter") */
  label?: string | null;
  /** Inferred roof plane id this photo is associated with */
  roofPlaneId?: string | null;
  /** Image pixel dimensions (if known) */
  imageDims?: { width: number; height: number } | null;
}

// ─── World-Projected Detection ───────────────────────────────────────────────

/**
 * WorldDetection — a detection that has been projected from image-space
 * into the project's local XY coordinate system (meters from GPS origin).
 *
 * Projection method depends on available metadata:
 *   - GPS + azimuth + pitch: full 3D projection
 *   - GPS only: detection placed at photo GPS position (centroid)
 *   - No GPS: detection placed at roof plane centroid (fallback)
 */
export interface WorldDetection {
  /** Detection class */
  class: DetectionClass;
  /** Confidence 0.0–1.0 */
  confidence: number;
  /** World X coordinate in meters from project origin */
  worldX: number;
  /** World Y coordinate in meters from project origin */
  worldY: number;
  /** Estimated footprint radius in meters (from bbox size + distance estimate) */
  radiusM: number;
  /** Roof plane id this detection is assigned to (null = not on a roof plane) */
  roofPlaneId: string | null;
  /** Source photo context */
  source: PhotoContext;
  /** Raw detection that produced this world detection */
  rawDetection: VisionDetection;
  /** Projection method used (for audit/debug) */
  projectionMethod: 'gps_azimuth_pitch' | 'gps_centroid' | 'plane_centroid' | 'none';
}

// ─── Aggregated Obstruction ───────────────────────────────────────────────────

/**
 * ObstructionNode — a deduplicated, world-positioned obstruction
 * ready to be written into SystemDefinition.obstructions[].
 *
 * Multiple WorldDetections of the same class within clusterRadiusM
 * are merged into a single ObstructionNode (highest-confidence wins).
 */
export interface ObstructionNode {
  /** Unique id (generated, stable across runs for same position) */
  id: string;
  /** Obstruction class */
  type: ObstructionClass;
  /** World X in meters from project GPS origin */
  worldX: number;
  /** World Y in meters from project GPS origin */
  worldY: number;
  /** Estimated footprint radius in meters */
  radiusM: number;
  /** Estimated height above roof deck in feet (class-default if unknown) */
  heightFt: number;
  /** NEC/AHJ required setback in inches (class-default + AHJ override) */
  setbackIn: number;
  /** Confidence score of best supporting detection (0.0–1.0) */
  confidence: number;
  /** Number of detections merged into this node */
  detectionCount: number;
  /** Roof plane id this obstruction sits on */
  roofPlaneId: string | null;
  /** Source detection ids for traceability */
  sourceDetectionIds: string[];
  /** Whether this node came from vision inference vs manual survey entry */
  source: 'vision' | 'manual' | 'merged';
}

// ─── Electrical Node ─────────────────────────────────────────────────────────

/**
 * ElectricalNode — a detected electrical component with world position.
 * Used by conduitRouting.ts to determine optimal conduit path.
 */
export interface ElectricalNode {
  /** Unique id */
  id: string;
  /** Electrical component type */
  type: ElectricalClass;
  /** World X in meters from project GPS origin */
  worldX: number;
  /** World Y in meters from project GPS origin */
  worldY: number;
  /** Floor/story this node is on (1 = ground floor, 2 = second story) */
  story: number;
  /** Confidence score (0.0–1.0) */
  confidence: number;
  /** Number of detections merged into this node */
  detectionCount: number;
  /** Source detection ids */
  sourceDetectionIds: string[];
  /** Whether this is the primary interconnection target */
  isPrimaryInterconnect: boolean;
  /** Source */
  source: 'vision' | 'manual' | 'merged';
}

// ─── Plane Correction ────────────────────────────────────────────────────────

/**
 * PlaneCorrection — a vision-detected adjustment to a GPS-derived roof plane.
 * Applied as an override layer in the CAD engine when confidence is high enough.
 *
 * Example: GPS-derived plane polygon is offset by 2m; vision detects the
 * actual ridge line and corrects the polygon vertices.
 */
export interface PlaneCorrection {
  /** Roof plane id being corrected */
  roofPlaneId: string;
  /** Type of correction */
  correctionType: 'polygon_offset' | 'azimuth_correction' | 'pitch_correction' | 'edge_trim';
  /** XY offset to apply (meters) */
  offsetX?: number;
  offsetY?: number;
  /** Azimuth correction (degrees) */
  azimuthDeltaDeg?: number;
  /** Pitch correction (degrees) */
  pitchDeltaDeg?: number;
  /** Confidence of this correction (0.0–1.0) */
  confidence: number;
  /** Source geometry class that triggered this correction */
  sourceClass: RoofGeometryClass;
}

// ─── Vision Aggregation Result ────────────────────────────────────────────────

/**
 * VisionAggregationResult — the output of visionAggregator.ts.
 * This is the complete vision intelligence package for a project.
 *
 * Fed directly into patchSystemDefinitionFromVision() in visionPatch.ts.
 */
export interface VisionAggregationResult {
  /** Project UUID */
  projectId: string;
  /** Survey external id (from app) */
  surveyId: string;
  /** ISO timestamp when aggregation was run */
  aggregatedAt: string;
  /** Pipeline version for cache invalidation */
  pipelineVersion: typeof VISION_PIPELINE_VERSION;

  /** Deduplicated, world-projected obstructions */
  obstructions: ObstructionNode[];
  /** Detected electrical nodes */
  electricalNodes: ElectricalNode[];
  /** Roof plane corrections derived from geometry detections */
  planeCorrections: PlaneCorrection[];

  /** Total photos processed */
  photosProcessed: number;
  /** Total raw detections before deduplication */
  rawDetectionCount: number;
  /** Detections filtered below confidence threshold */
  filteredCount: number;

  /** Per-class detection counts (after filtering) */
  classCounts: Record<string, number>;

  /** Audit log messages */
  log: string[];

  /** Whether any detections met the minimum confidence threshold */
  hasHighConfidenceDetections: boolean;
}

// ─── Per-Photo Vision Result ──────────────────────────────────────────────────

/**
 * PhotoVisionResult — result of running inference on a single photo.
 * Stored in ar_detections (app DB) and used as input to visionAggregator.
 */
export interface PhotoVisionResult {
  /** photo file id (project_files.id) */
  fileId: string;
  /** photo URL */
  fileUrl: string;
  /** project id */
  projectId: string;
  /** survey id */
  surveyId: string;
  /** raw YOLOv8 inference result from vision service */
  inferenceResult: VisionInferenceResult;
  /** photo metadata used for projection */
  photoContext: PhotoContext;
  /** ISO timestamp */
  inferredAt: string;
  /** model id used */
  modelId: string;
  /** inference duration ms */
  durationMs: number;
}

// ─── Confidence Thresholds ────────────────────────────────────────────────────

/**
 * ConfidenceThresholds — per-class minimum confidence values.
 * Detections below these thresholds are filtered before world projection.
 * Higher thresholds for safety-critical classes (fire setbacks, electrical).
 */
export interface ConfidenceThresholds {
  /** Default threshold for any class not explicitly listed */
  default: number;
  /** Per-class overrides */
  byClass: Partial<Record<DetectionClass, number>>;
}

/** Default confidence thresholds used by confidenceGate.ts */
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  default: 0.55,
  byClass: {
    // Roof obstructions — standard confidence
    vent:                 0.55,
    skylight:             0.60,
    hvac_unit:            0.55,
    chimney:              0.65, // higher: misidentification affects fire setbacks
    pipe_jack:            0.50,
    dormer:               0.65,
    solar_tube:           0.55,
    antenna:              0.50,
    other_obstruction:    0.70, // very high: catch-all must be confident

    // Electrical nodes — high confidence (affects NEC compliance)
    meter_socket:         0.70,
    main_panel:           0.70,
    disconnect:           0.65,
    sub_panel:            0.65,
    service_entry:        0.65,

    // Roof geometry — high confidence (affects polygon correction)
    roof_edge:            0.60,
    ridge_line:           0.65,
    valley_line:          0.60,
    gutter_line:          0.55,
    hip_line:             0.60,
  },
};

// ─── Default Physical Dimensions by Class ────────────────────────────────────

/**
 * Default estimated physical dimensions and setbacks by detection class.
 * Used when exact measurements are not available from the photo.
 * All heights in feet, radii in meters, setbacks in inches.
 */
export interface ClassDefaults {
  radiusM: number;       // footprint radius in meters
  heightFt: number;      // height above roof deck in feet
  setbackIn: number;     // NEC/AHJ required setback in inches
}

export const OBSTRUCTION_CLASS_DEFAULTS: Record<ObstructionClass, ClassDefaults> = {
  vent:               { radiusM: 0.15, heightFt: 1.0,  setbackIn: 12 },
  skylight:           { radiusM: 0.50, heightFt: 0.5,  setbackIn: 18 },
  hvac_unit:          { radiusM: 0.75, heightFt: 3.0,  setbackIn: 36 },
  chimney:            { radiusM: 0.60, heightFt: 4.0,  setbackIn: 18 },
  pipe_jack:          { radiusM: 0.12, heightFt: 0.5,  setbackIn: 12 },
  dormer:             { radiusM: 1.20, heightFt: 6.0,  setbackIn: 36 },
  solar_tube:         { radiusM: 0.20, heightFt: 0.3,  setbackIn: 12 },
  antenna:            { radiusM: 0.30, heightFt: 3.0,  setbackIn: 18 },
  other_obstruction:  { radiusM: 0.40, heightFt: 2.0,  setbackIn: 18 },
};

// ─── Cluster Radius ────────────────────────────────────────────────────────────

/**
 * Detections of the same class within this radius (meters) are merged
 * into a single ObstructionNode / ElectricalNode during aggregation.
 */
export const CLUSTER_RADIUS_M = 0.8;

// ─── Vision Pipeline Status ───────────────────────────────────────────────────

/**
 * VisionPipelineStatus — stored in project_vision_status table (if present)
 * or as JSON in project.survey_meta['visionStatus'].
 */
export interface VisionPipelineStatus {
  projectId: string;
  surveyId: string;
  /** Current pipeline stage */
  stage:
    | 'queued'
    | 'inferring'
    | 'aggregating'
    | 'patching_sysdef'
    | 'rebuilding_cad'
    | 'complete'
    | 'failed'
    | 'skipped_no_photos';
  /** ISO timestamp of last stage transition */
  updatedAt: string;
  /** Error message if stage = 'failed' */
  error?: string;
  /** Summary from last completed aggregation */
  lastResult?: Pick<VisionAggregationResult,
    'obstructions' | 'electricalNodes' | 'photosProcessed' | 'rawDetectionCount' | 'hasHighConfidenceDetections'
  >;
}