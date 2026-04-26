// ═══════════════════════════════════════════════════════════════════════
// System Definition Layer — Single Source of Truth for Solar System Config
//
// NON-BREAKING ADDITION — does not modify any existing logic.
// All geometry, electrical, and structural generators can derive
// their configuration from this standardized definition.
//
// ARCHITECTURE:
//   ProjectData → buildSystemDefinition() → SystemDefinition
//     → CAD engine, rail generator, placement engine, permit engine
//
// FUTURE-SAFE:
//   mountType field supports fixed_tilt, pole_mount, tracker
//   without breaking current fixed_tilt-only ground mount logic.
// ═══════════════════════════════════════════════════════════════════════

// ── Core Types ──────────────────────────────────────────────────────────

/** Solar system type — matches existing canonical pipeline values */
export type SystemType = 'roof' | 'ground' | 'fence';

/** Mount sub-type — extensible for future hardware variants */
export type MountType = 'fixed_tilt' | 'pole_mount' | 'tracker';

/** Panel orientation in the array */
export type PanelOrientation = 'portrait' | 'landscape';

/** Rail mounting direction on the structure */
export type RailOrientation = 'horizontal' | 'vertical';

/** Inverter topology */
// v47.418 — 'hybrid' added as first-class member. 'ecoflow' remains as a
// legacy alias (lib/system/normalizedInverter.ts mapLegacyTopology maps
// it to 'hybrid'). Sol-Ark / EcoFlow PowerOcean and any other hybrid
// (battery-capable) inverter should emit 'hybrid' going forward.
export type InverterType = 'micro' | 'string' | 'optimizer' | 'hybrid' | 'ecoflow';

/** Ground mount racking style — matches existing GroundSystemStyle */
export type RackingStyle = 'pipe' | 'ironridge';

// ── Panel Definition ────────────────────────────────────────────────────

export interface PanelDefinition {
  /** Panel width in inches */
  widthIn: number;
  /** Panel height/length in inches */
  heightIn: number;
  /** Panel wattage (STC) */
  wattage: number;
  /** Panel orientation in the array */
  orientation: PanelOrientation;
  /** Panel weight in lbs (for structural calcs) */
  weightLbs?: number;
  /** Panel Voc (for string sizing) */
  voc?: number;
  /** Panel Isc (for overcurrent protection) */
  isc?: number;
  /** Manufacturer name */
  manufacturer?: string;
  /** Model name */
  model?: string;
}

// ── Layout Definition ───────────────────────────────────────────────────

export interface LayoutDefinition {
  /** Array tilt angle in degrees from horizontal */
  tilt: number;
  /** Array azimuth in degrees (0=N, 180=S) */
  azimuth: number;
  /** Row-to-row spacing in feet */
  rowSpacing: number;
  /** Minimum elevation/clearance above grade in feet (ground mount) */
  elevation?: number;
  /** Site setback in feet */
  setbackFt?: number;
  /** Total panel count */
  totalPanels?: number;
}

// ── Structure Definition ────────────────────────────────────────────────

export interface StructureDefinition {
  /** Pillar/pile spacing in feet */
  pillarSpacing?: number;
  /** Rail orientation on the structure */
  railOrientation: RailOrientation;
  /** Clamp/attachment spacing in inches */
  clampSpacing?: number;
  /** Racking style (ground mount specific) */
  rackingStyle?: RackingStyle;
  /** Rafter size (roof specific) */
  rafterSize?: string;
  /** Rafter spacing in inches (roof specific) */
  rafterSpacing?: number;
  /** Attachment spacing in inches (roof specific) */
  attachmentSpacing?: number;
  /** Roof type (roof specific) */
  roofType?: string;
  /** Roof pitch in degrees (roof specific) */
  roofPitch?: number;
  /** Ground mount structure type */
  groundStructureType?: string;
  /** Pile embedment depth in feet */
  pileDepthFt?: number;
}

// ── Electrical Definition ───────────────────────────────────────────────

export interface ElectricalDefinition {
  /** Inverter topology type */
  inverterType: InverterType;
  /** Panels per string (string/optimizer topology) */
  stringSize?: number;
  /** Total DC system power in kW */
  totalDcKw?: number;
  /** Total AC system power in kW */
  totalAcKw?: number;
  /** Main service panel amperage */
  mainPanelAmps?: number;
  /** Inverter manufacturer */
  inverterManufacturer?: string;
  /** Inverter model */
  inverterModel?: string;
  /** Inverter AC output in kW */
  inverterAcOutputKw?: number;
}

// ── System Definition (Top-Level) ───────────────────────────────────────

// ── Vision-Sourced Obstruction / Electrical Types (NON-BREAKING additions) ─────────────────────────────────────
// Re-declared here (not imported from lib/vision/types.ts) to keep SystemDefinition
// free of a circular dependency on the vision pipeline.
// RULE: Keep in sync with ObstructionNode / ElectricalNode in lib/vision/types.ts.

/** Roof obstruction detected via vision pipeline or entered manually */
export interface SysDefObstruction {
  id: string;
  type: string;           // ObstructionClass value — string to avoid circular import
  worldX: number;         // meters from project GPS origin
  worldY: number;         // meters from project GPS origin
  radiusM: number;        // footprint radius in meters
  heightFt: number;       // height above roof deck in feet
  setbackIn: number;      // NEC/AHJ required setback in inches
  confidence: number;     // 0.0–1.0
  roofPlaneId: string | null;
  source: 'vision' | 'manual' | 'merged';
}

/** Electrical node (panel, meter, disconnect) with world position */
export interface SysDefElectricalNode {
  id: string;
  type: string;           // ElectricalClass value — string to avoid circular import
  worldX: number;
  worldY: number;
  story: number;
  confidence: number;
  isPrimaryInterconnect: boolean;
  source: 'vision' | 'manual' | 'merged';
}

/** Correction to a GPS-derived roof plane polygon */
export interface SysDefPlaneCorrection {
  roofPlaneId: string;
  correctionType: 'polygon_offset' | 'azimuth_correction' | 'pitch_correction' | 'edge_trim';
  offsetX?: number;
  offsetY?: number;
  azimuthDeltaDeg?: number;
  pitchDeltaDeg?: number;
  confidence: number;
  sourceClass: string;    // RoofGeometryClass value — string to avoid circular import
}

export interface SystemDefinition {
  /** Primary system type */
  systemType: SystemType;

  /** Mount sub-type — defaults to 'fixed_tilt' for ground, undefined for roof/fence */
  mountType?: MountType;

  /** Panel specifications */
  panel: PanelDefinition;

  /** Array layout parameters */
  layout: LayoutDefinition;

  /** Structural/mounting configuration */
  structure: StructureDefinition;

  /** Electrical topology and sizing */
  electrical: ElectricalDefinition;

  // ── Vision-sourced additions (all optional — fully non-breaking) ───────────

  /**
   * Roof obstructions detected via vision pipeline or entered manually.
   * Used by CAD engine for panel collision avoidance and fire setback buffers.
   * undefined = vision not yet run; [] = run but none found.
   */
  obstructions?: SysDefObstruction[];

  /**
   * Electrical nodes (panel, meter, disconnect) with world positions.
   * Used by conduitRouting.ts to determine optimal conduit path.
   */
  electricalNodes?: SysDefElectricalNode[];

  /**
   * Corrections to GPS-derived roof plane polygons from vision detections.
   * Applied by CAD engine when confidence >= PLANE_CORRECTION_MIN_CONFIDENCE.
   */
  planeCorrections?: SysDefPlaneCorrection[];

  /**
   * ISO timestamp of last vision patch.
   * undefined = vision pipeline has not yet run for this project.
   */
  visionPatchedAt?: string;
}

// ── Default Constants ───────────────────────────────────────────────────

const DEFAULT_PANEL_WIDTH_IN  = 40;
const DEFAULT_PANEL_HEIGHT_IN = 66;
const DEFAULT_PANEL_WATTAGE   = 400;
const DEFAULT_PANEL_WEIGHT    = 44;
const DEFAULT_TILT            = 25;
const DEFAULT_AZIMUTH         = 180;
const DEFAULT_ROW_SPACING_FT  = 12;
const DEFAULT_MAIN_PANEL_AMPS = 200;

// ── Builder ─────────────────────────────────────────────────────────────

/**
 * Input shape for buildSystemDefinition.
 * Matches the subset of PermitInputShape / project data used
 * by CAD engine, placement engine, and permit generator.
 *
 * Deliberately loose — accepts any project payload shape.
 */
export interface SystemDefinitionInput {
  project?: {
    systemType?: string;
    roofType?: string;
    roofPitch?: number;
    mountingSystem?: string;
    mountingSystemId?: string;
    rafterSize?: string;
    rafterSpacing?: number;
    attachmentSpacing?: number;
    panelLengthIn?: number;
    panelWidthIn?: number;
    panelWeightLbs?: number;
    panelVoc?: number;
    panelIsc?: number;
    mainPanelAmps?: number;
    wireLength?: number;
    [key: string]: any;
  };
  system?: {
    totalDcKw?: number;
    totalAcKw?: number;
    totalPanels?: number;
    topology?: string;
    inverters?: Array<{
      manufacturer?: string;
      model?: string;
      type?: string;
      acOutputKw?: number;
      strings?: Array<{
        panelManufacturer?: string;
        panelModel?: string;
        panelWatts?: number;
        panelVoc?: number;
        panelIsc?: number;
        panelCount?: number;
        [key: string]: any;
      }>;
      [key: string]: any;
    }>;
    [key: string]: any;
  };
  layout?: {
    type?: string;
    systemType?: string;
    groundArrays?: Array<{
      tiltDeg?: number;
      azimuth?: number;
      rowSpacingFt?: number;
      groundClearanceIn?: number;
      structureType?: string;
      pileDepthFt?: number;
      pileSpacingFt?: number;
      panelsPerRow?: number;
      rowCount?: number;
      [key: string]: any;
    }>;
    fenceSegments?: Array<any>;
    groundSetbackFt?: number;
    [key: string]: any;
  };
}

/**
 * Resolve the canonical system type from project/layout data.
 * Mirrors the priority logic in cadEngine.ts resolveCADSystemType().
 */
export function resolveSystemType(input: SystemDefinitionInput): SystemType {
  // Priority 1: layout.type (canonical — set by buildCanonical)
  const layoutType = (input.layout?.type || '').toLowerCase().trim();
  if (layoutType === 'solar_fence' || layoutType === 'fence') return 'fence';
  if (layoutType === 'ground_mount' || layoutType === 'ground') return 'ground';
  if (layoutType === 'roof') return 'roof';

  // Priority 2: project.systemType
  const raw = (input.project?.systemType || '').toLowerCase().trim();
  if (raw === 'solar_fence' || raw === 'fence') return 'fence';
  if (raw === 'ground_mount' || raw === 'ground') return 'ground';
  if (raw === 'roof') return 'roof';

  // Priority 3: layout data inference
  if ((input.layout?.fenceSegments?.length ?? 0) > 0) return 'fence';
  if ((input.layout?.groundArrays?.length ?? 0) > 0) return 'ground';

  return 'roof';
}

/**
 * Resolve inverter topology from system data.
 * Mirrors the logic in permit/utils/helpers.ts resolveTopology().
 */
function resolveInverterType(input: SystemDefinitionInput): InverterType {
  const inv0 = input.system?.inverters?.[0];
  const invType = (inv0?.type || '').toLowerCase().trim();
  if (invType === 'micro' || invType === 'microinverter') return 'micro';
  if (invType === 'optimizer' || invType === 'power_optimizer') return 'optimizer';
  if (invType === 'string') return 'string';

  const brand = (inv0?.manufacturer || '').toLowerCase();
  const model = (inv0?.model || '').toLowerCase();
  if (brand.includes('enphase') || model.includes('iq8') || model.includes('iq7')) return 'micro';
  if (brand.includes('solaredge') || model.includes('optimizer')) return 'optimizer';

  const rawTopo = (input.system?.topology || '').toLowerCase().trim();
  if (rawTopo.includes('micro')) return 'micro';
  if (rawTopo.includes('optimizer')) return 'optimizer';
  if (rawTopo === 'string') return 'string';

  return 'micro';
}

/**
 * Resolve panel orientation from ground mount arrays or defaults.
 */
function resolvePanelOrientation(input: SystemDefinitionInput, systemType: SystemType): PanelOrientation {
  // Ground mount: landscape by default (industry standard for fixed tilt)
  if (systemType === 'ground') return 'landscape';
  // Fence: portrait (vertical panels)
  if (systemType === 'fence') return 'portrait';
  // Roof: portrait by default
  return 'portrait';
}

/**
 * Resolve rail orientation from system type and structure.
 */
function resolveRailOrientation(systemType: SystemType, orientation: PanelOrientation): RailOrientation {
  // Ground mount with landscape panels: horizontal rails (perpendicular to tilt axis)
  if (systemType === 'ground' && orientation === 'landscape') return 'horizontal';
  // Roof: typically horizontal rails for portrait panels
  if (systemType === 'roof') return 'horizontal';
  // Fence: vertical rails
  if (systemType === 'fence') return 'vertical';
  return 'horizontal';
}

/**
 * Build a SystemDefinition from project/system/layout data.
 *
 * This is the primary entry point. It reads scattered config values
 * from the input payload and normalizes them into a single structure.
 *
 * NON-BREAKING: This function only READS existing data — it does not
 * modify or replace any existing pipeline logic.
 */
export function buildSystemDefinition(input: SystemDefinitionInput): SystemDefinition {
  const systemType = resolveSystemType(input);
  const inverterType = resolveInverterType(input);
  const orientation = resolvePanelOrientation(input, systemType);
  const railOrientation = resolveRailOrientation(systemType, orientation);

  // ── Panel specs from equipment data ──
  const inv0 = input.system?.inverters?.[0];
  const str0 = inv0?.strings?.[0];

  const panel: PanelDefinition = {
    widthIn:      input.project?.panelWidthIn ?? DEFAULT_PANEL_WIDTH_IN,
    heightIn:     input.project?.panelLengthIn ?? DEFAULT_PANEL_HEIGHT_IN,
    wattage:      str0?.panelWatts ?? DEFAULT_PANEL_WATTAGE,
    orientation,
    weightLbs:    input.project?.panelWeightLbs ?? DEFAULT_PANEL_WEIGHT,
    voc:          str0?.panelVoc ?? input.project?.panelVoc,
    isc:          str0?.panelIsc ?? input.project?.panelIsc,
    manufacturer: str0?.panelManufacturer,
    model:        str0?.panelModel,
  };

  // ── Layout from ground arrays or defaults ──
  const gArr0 = input.layout?.groundArrays?.[0];

  const layout: LayoutDefinition = {
    tilt:         gArr0?.tiltDeg ?? input.project?.roofPitch ?? DEFAULT_TILT,
    azimuth:      gArr0?.azimuth ?? DEFAULT_AZIMUTH,
    rowSpacing:   gArr0?.rowSpacingFt ?? DEFAULT_ROW_SPACING_FT,
    elevation:    gArr0?.groundClearanceIn ? gArr0.groundClearanceIn / 12 : undefined,
    setbackFt:    input.layout?.groundSetbackFt ?? 5,
    totalPanels:  input.system?.totalPanels,
  };

  // ── Structure ──
  const structure: StructureDefinition = {
    pillarSpacing:      gArr0?.pileSpacingFt,
    railOrientation,
    clampSpacing:       input.project?.attachmentSpacing,
    rackingStyle:       systemType === 'ground' ? 'pipe' : undefined,
    rafterSize:         input.project?.rafterSize,
    rafterSpacing:      input.project?.rafterSpacing,
    attachmentSpacing:  input.project?.attachmentSpacing,
    roofType:           input.project?.roofType,
    roofPitch:          input.project?.roofPitch,
    groundStructureType: gArr0?.structureType,
    pileDepthFt:        gArr0?.pileDepthFt,
  };

  // ── Electrical ──
  const electrical: ElectricalDefinition = {
    inverterType,
    stringSize:            inverterType !== 'micro' ? str0?.panelCount : undefined,
    totalDcKw:             input.system?.totalDcKw,
    totalAcKw:             input.system?.totalAcKw,
    mainPanelAmps:         input.project?.mainPanelAmps ?? DEFAULT_MAIN_PANEL_AMPS,
    inverterManufacturer:  inv0?.manufacturer,
    inverterModel:         inv0?.model,
    inverterAcOutputKw:    inv0?.acOutputKw,
  };

  // ── Mount type (future-safe) ──
  let mountType: MountType | undefined;
  if (systemType === 'ground') {
    // Currently all ground mounts are fixed_tilt.
    // Future: resolve from input.project.mountType or layout metadata.
    mountType = 'fixed_tilt';
  }

  return {
    systemType,
    mountType,
    panel,
    layout,
    structure,
    electrical,
  };
}