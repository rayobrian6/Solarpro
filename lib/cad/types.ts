// ============================================================
// SolarPro CAD Engine — Core Types
// lib/cad/types.ts
//
// CADModel is the SINGLE SOURCE OF TRUTH output from the CAD engine.
// It is consumed ONLY by adaptCADToDrafting() — never by templates directly.
//
// Templates receive DraftingInput (unchanged interface).
// The CAD engine populates DraftingInput from CADModel.
// ============================================================

import type { Point2D, BBox } from './geometry';

// ── System Type (mirrors DraftingEngine) ─────────────────────
export type CADSystemType = 'roof' | 'ground_mount' | 'solar_fence';

// ── CAD Panel ────────────────────────────────────────────────
// A single panel placed in CAD space (local meters, XY).

export interface CADPanel {
  id:          string;
  x:           number;   // center X (meters, local)
  y:           number;   // center Y (meters, local)
  widthM:      number;   // panel width in meters
  heightM:     number;   // panel height in meters
  orientation: 'portrait' | 'landscape';
  row:         number;
  col:         number;
  planeId?:    string;   // roof plane ID (roof only)
  arrayId?:    string;   // ground array ID (ground only)
  segmentId?:  string;   // fence segment ID (fence only)
}

// ── CAD Roof Plane ───────────────────────────────────────────

export interface CADRoofPlane {
  id:             string;
  polygon:        Point2D[];   // local XY meters — raw plane boundary
  usablePolygon:  Point2D[];   // local XY meters — after setbacks applied
  pitch:          number;      // degrees
  azimuth:        number;      // degrees
  areaSqM:        number;
  setbacks: {
    eaveM:   number;
    ridgeM:  number;
    rakeM:   number;
  };
  panels:         CADPanel[];
  dimensions: {
    widthM:     number;
    heightM:    number;
    panelCountX: number;
    panelCountY: number;
  };
  /** Obstructions on this roof plane (subset of CADModel.obstructions) */
  obstructions?:  CADObstruction[];
}

// ── CAD Ground Array ─────────────────────────────────────────

export interface CADGroundArray {
  id:            string;
  originX:       number;       // local XY origin
  originY:       number;
  rows:          CADGroundRow[];
  panels:        CADPanel[];
  tiltDeg:       number;
  azimuth:       number;
  rowSpacingM:   number;
  groundClearanceM: number;
  structureType: string;
  pileDepthM:    number;
  pileSpacingM:  number;
  dimensions: {
    arrayWidthM:  number;
    arrayDepthM:  number;
    rowCount:     number;
    panelsPerRow: number;
  };
}

export interface CADGroundRow {
  id:      string;
  rowIndex: number;
  x:       number;   // row left X (local meters)
  y:       number;   // row Y (local meters)
  widthM:  number;
  panels:  CADPanel[];
}

// ── CAD Fence ────────────────────────────────────────────────

export interface CADFenceSegment {
  id:         string;
  startX:     number;   // local XY meters
  startY:     number;
  endX:       number;
  endY:       number;
  lengthM:    number;
  azimuth:    number;
  panelCount: number;
  panels:     CADPanel[];
  posts:      CADFencePost[];
  tiltDeg:    number;
  bifacial:   boolean;
  label:      string;
}

export interface CADFencePost {
  id:      string;
  x:       number;
  y:       number;
  embedM:  number;
  heightM: number;
}

// ── Fence Sections (user-controlled section system) ─────────
// Each fence segment is divided into sections. Users control the type
// of each section: solar panels, gates, or vinyl (non-solar).
// No automatic gap-filling — all sections are intentional.

export type FenceSectionType = 'solar' | 'gate' | 'vinyl';

export interface CADFenceSection {
  id:         string;
  segmentId:  string;       // parent fence segment
  index:      number;       // section order within segment (0-based)
  type:       FenceSectionType;
  startM:     number;       // offset from segment start (meters)
  widthM:     number;       // section width along fence line
  heightM:    number;       // section height (matches fence height)
  x:          number;       // local XY center position (meters)
  y:          number;
  panelCount: number;       // panels in this section (0 for gate/vinyl)
}

// ── CAD Dimensions (attached to model, rendered by engine) ───

export interface CADDimension {
  id:     string;
  type:   'horizontal' | 'vertical' | 'angular';
  x1:     number;
  y1:     number;
  x2:     number;
  y2:     number;
  valueFt: number;
  label:  string;
  level:  1 | 2 | 3;   // 1=panel, 2=array, 3=overall
}

// ── CAD Obstruction (vision-sourced) ──────────────────────────────────
// Represents a roof obstruction in the CAD model.
// Placed by roofCAD.ts using SystemDefinition.obstructions[].
// The CAD engine renders these as exclusion zones and avoids placing panels
// within (radiusM + setbackM) of each obstruction center.

export interface CADObstruction {
  id:          string;
  type:        string;         // ObstructionClass value
  x:           number;         // center X (local meters)
  y:           number;         // center Y (local meters)
  radiusM:     number;         // physical footprint radius
  setbackM:    number;         // required clearance from footprint edge (NEC/AHJ)
  totalRadiusM: number;        // radiusM + setbackM (total exclusion radius)
  heightFt:    number;         // height above roof deck
  roofPlaneId: string | null;  // which plane this sits on
  /** Source of this obstruction data.
   *  - 'promoted_canonical': Passed through unified geometry pipeline + human review (PREFERRED)
   *  - 'manual': User-entered obstruction (ACCEPTABLE)
   *  - 'merged': Merged from multiple sources after review (ACCEPTABLE)
   *  Raw 'vision' source is no longer allowed — must go through canonical bridge.
   */
  source:      'promoted_canonical' | 'manual' | 'merged';
  confidence:  number;         // 0.0–1.0
}

// ── CAD Electrical Node ────────────────────────────
// Represents a detected electrical component in the CAD model.
// Used by conduitRouting.ts as a routing target / waypoint.

export interface CADElectricalNode {
  id:                   string;
  type:                 string;    // ElectricalClass value
  x:                    number;    // local meters
  y:                    number;    // local meters
  story:                number;    // floor/story (1=ground)
  isPrimaryInterconnect: boolean;  // main conduit target
  /** Source of this electrical node data.
   *  - 'promoted_canonical': Passed through unified geometry pipeline + human review (PREFERRED)
   *  - 'manual': User-entered node (ACCEPTABLE)
   *  - 'merged': Merged from multiple sources after review (ACCEPTABLE)
   *  Raw 'vision' source is no longer allowed — must go through canonical bridge.
   */
  source:               'promoted_canonical' | 'manual' | 'merged';
  confidence:           number;
}

// ── CAD Conduit Route ────────────────────────────────────────────────
// Output of conduitRouting.ts. Represents the planned conduit path
// from the array drop point to the electrical panel.

export interface CADConduitWaypoint {
  x:      number;   // local meters
  y:      number;   // local meters
  label?: string;   // 'array_drop', 'roof_edge', 'panel', etc.
}

export interface CADConduitRoute {
  id:              string;
  waypoints:       CADConduitWaypoint[];
  totalLengthM:    number;
  bendCount:       number;
  targetNodeId:    string;   // ElectricalNode id
  routeMethod:     'vision_guided' | 'shortest_path' | 'fallback_straight';
  warnings:        string[];
}

// ── CAD Model ────────────────────────────────────────────────
// Top-level output from generateCADLayout().

export interface CADModel {
  systemType:  CADSystemType;
  version:     string;

  // System-specific geometry. Single-system: only one populated.
  // HYBRID (Phase 1): all present sections populated — see `hybrid` below.
  roof?:   CADRoofModel;
  ground?: CADGroundModel;
  fence?:  CADFenceModel;

  /** Hybrid (multi-system) metadata — present ONLY when the design spans >1
   *  system type. Each grafted section's local XY is relative to its OWN
   *  origin (recorded here) — renderers drawing sections together (site plan)
   *  must re-project using these origins vs the base originLat/originLng. */
  hybrid?: {
    sections: Array<{
      key: 'roof' | 'ground' | 'fence';
      originLat: number; originLng: number;
      totalPanels: number; dcKw: number;
    }>;
  };

  // Aggregated metrics
  totalPanels:  number;
  totalDcKw:    number;
  panelWidthM:  number;
  panelHeightM: number;

  // GPS origin used for local XY projection.
  // All local XY values in this model are relative to this origin.
  // Required for correct lat/lng inverse conversion in adapter.
  originLat:   number;
  originLng:   number;

  // Bounding box of entire solved layout (local meters)
  bounds: BBox;

  // Computed dimensions for drafting engine
  dimensions: CADDimension[];

  // Solve metadata
  solveMs:   number;
  warnings:  string[];

  // System Definition — standardized system config (v48)
  // Populated by generateCADLayout() from input data.
  // Downstream consumers can read this instead of scattered input fields.
  systemDefinition?: import('@/lib/system/systemDefinition').SystemDefinition;

  // Vision-sourced layers (optional — present only when vision pipeline has run)

  /** Roof obstructions detected via vision, projected to local XY */
  obstructions?: CADObstruction[];

  /** Electrical nodes detected via vision, projected to local XY */
  electricalNodes?: CADElectricalNode[];

  /** Planned conduit routes (from conduitRouting.ts) */
  conduitRoutes?: CADConduitRoute[];

  /** Merge audit metadata (populated by mergeCADModels) */
  _surveyMeta?: {
    applied: string[];
    skipped: string[];
    mergedAt: string;
  };
}

// ── System-specific model wrappers ───────────────────────────

export interface CADRoofModel {
  planes:       CADRoofPlane[];
  totalPanels:  number;
  setbackIn:    number;
  ridgeSetbackIn: number;
}

export interface CADGroundModel {
  arrays:       CADGroundArray[];
  totalPanels:  number;
  setbackFt:    number;
}

export interface CADFenceModel {
  segments:         CADFenceSegment[];
  totalPanels:      number;
  totalLengthM:     number;
  postSpacingM:     number;
  postEmbedM:       number;
  panelHeightM:     number;
  railCount:        number;
  gateOpenings:     Array<{ positionM: number; widthM: number }>;
  sections:         CADFenceSection[];  // user-controlled fence sections
}