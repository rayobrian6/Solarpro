// ============================================================
// SolarPro Drafting Engine — Core Types
// lib/drafting/types.ts
//
// ALL drawing functions consume DraftingInput.
// NO UI state. NO hardcoded values. NO HTML.
// Output is always raw SVG string.
// ============================================================

// ── System Type ──────────────────────────────────────────────

export type SysType = 'roof' | 'ground_mount' | 'solar_fence';

// ── Input Contract ───────────────────────────────────────────
// The engine consumes ONLY these three top-level objects.

export interface DraftingProject {
  systemType?: string;
  roofType?: string;
  roofPitch?: number;
  mountingSystem?: string;
  /** Selected mounting-system DB id — lets templates resolve real fastener specs. */
  mountingSystemId?: unknown;
  /** Canonical resolution (mountSystem etc.) — same source the sheet zones use. */
  _canonical?: unknown;
  /** Engineering-resolved attachment spacing (V4 mount layout), inches O.C. */
  resolvedAttachSpacingIn?: number;
  rafterSize?: string;
  rafterSpacing?: number;
  attachmentSpacing?: number;
  panelLengthIn?: number;
  panelWidthIn?: number;
  panelWeightLbs?: number;
  conduitType?: string;
  ahjWindSpeedMph?: number;
  ahjGroundSnowPsf?: number;
  ahjRoofSetbackIn?: number;
  ahjRidgeSetbackIn?: number;
  // Electrical
  inverterType?: string;
  // Equipment identity — the reference sets annotate the PLAN with real
  // make/model strings ("(N) 30 — JINKO JKM420N-54HL4-B (420W)"), not bubbles.
  moduleMfr?: string;
  moduleModel?: string;
  inverterMfr?: string;
  inverterModel?: string;
  // Roof obstructions (Nearmap AI / vision / manual) in fake-degree coords —
  // PV-2 draws the footprint + dashed keep-out ring + type label.
  roofObstructions?: Array<{
    lat: number;
    lng: number;
    radiusFt: number;
    clearanceFt: number;
    type: string;
  }>;
  // Panel GPS positions from 3D engine
  panelPositions?: Array<{
    id: string;
    lat: number;
    lng: number;
    x?: number;
    y?: number;
    tilt?: number;
    azimuth?: number;
    row?: number;
    col?: number;
    orientation?: string;
  }>;
  roofPlanes?: Array<{
    id: string;
    vertices: Array<{ lat: number; lng: number }>;
    pitch?: number;
    azimuth?: number;
    area?: number;
    edgeTypes?: string[];
    // CAD-solved extras (populated by adapter)
    _usablePolygon?: Array<{ x: number; y: number }>;
    _cadSolved?: boolean;
  }>;
}

export interface DraftingLayout {
  // Solar Fence
  fenceSegments?: Array<{
    id: string;
    startPoint: { lat: number; lng: number; x?: number; y?: number };
    endPoint:   { lat: number; lng: number; x?: number; y?: number };
    lengthFt:   number;
    azimuth:    number;
    panelCount: number;
    tilt?:      number;
    bifacial?:  boolean;
    label?:     string;
    // CAD-solved extras (populated by adapter)
    _cadPanels?: any[];
    _cadPosts?:  any[];
    _cadSolved?: boolean;
  }>;
  fenceTotalLengthFt?:   number;
  fenceGateOpenings?:    Array<{ positionFt: number; widthFt: number }>;
  fencePostSpacingFt?:   number;
  fencePostEmbedmentFt?: number;
  fenceRailCount?:       number;
  fencePanelHeightFt?:   number;

  // Ground Mount
  groundArrays?: Array<{
    id: string;
    rowCount:           number;
    panelsPerRow:       number;
    tiltDeg:            number;
    azimuth:            number;
    rowSpacingFt:       number;
    groundClearanceIn:  number;
    structureType:      string; // 'driven_pile' | 'concrete_pier' | 'ballast'
    pileDepthFt?:       number;
    pileSpacingFt?:     number;
    // GPS center (from input data, e.g. Google Solar API)
    center?:            { lat: number; lng: number };
    // CAD-solved extras (populated by adapter)
    _cadOriginX?: number;
    _cadOriginY?: number;
    _cadPanels?:   any[];
    _cadRows?:     any[];
    _cadSolved?:   boolean;
  }>;
  groundSetbackFt?: number;
}

export interface DraftingEngineering {
  totalDcKw:    number;
  totalAcKw:    number;
  totalPanels:  number;
  windSpeedMph?: number;
  groundSnowPsf?: number;
  panelWatts?:  number;
  panelVoc?:    number;
  panelIsc?:    number;
  // Structural calc results (if available)
  allowableRoofLoadPsf?: number;
  panelDeadLoadPsf?:     number;
  upliftForceLbs?:       number;
  shearForceLbs?:        number;
  momentFtLbs?:          number;
  // Electrical details (if available)
  inverters?: Array<{
    type?:     string;
    acOutputKw?: number;
    count?:    number;
  }>;
}

// ── Full Engine Input ─────────────────────────────────────────

export interface DraftingInput {
  project:     DraftingProject;
  layout:      DraftingLayout;
  engineering: DraftingEngineering;
}

// ── Drawing Primitive Options ─────────────────────────────────

export type LineClass =
  | 'line-struct'
  | 'line-panel'
  | 'line-dim'
  | 'line-hidden'
  | 'line-wind'
  | 'line-grade'
  | 'line-setbk'
  | 'line-conduit';

export interface TextOptions {
  anchor?:    'start' | 'middle' | 'end';
  fontSize?:  number;
  fontWeight?: 'normal' | 'bold' | '900';
  fill?:      string;
  rotate?:    number;        // degrees, applied around (x,y)
  letterSpacing?: number;
  italic?:    boolean;
}

// ── Dimension Options ─────────────────────────────────────────

export type DimOrientation = 'horizontal' | 'vertical';

export interface DimensionOptions {
  x1:          number;
  y1:          number;
  x2:          number;
  y2:          number;
  offset:      number;       // px offset from geometry line
  label:       string;       // e.g. "8'-0""
  orientation: DimOrientation;
  style?:      'tick' | 'arrow'; // default 'tick'
}

// ── Callout Options ───────────────────────────────────────────

export interface CalloutOptions {
  cx:     number;
  cy:     number;
  number: number;
  r?:     number;  // default 10
}

export interface LeaderOptions {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ── SVG Canvas ────────────────────────────────────────────────

export interface CanvasSize {
  width:  number;
  height: number;
}

// Standard canvas for planset drawings (matches draw-zone-body ratio)
export const CANVAS_STANDARD: CanvasSize = { width: 1060, height: 460 };
export const CANVAS_WIDE:     CanvasSize = { width: 1060, height: 520 };
export const CANVAS_TALL:     CanvasSize = { width: 800,  height: 520 };