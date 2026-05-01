// ============================================================
// SLD Emblem Contracts — Anchor + Layout Definitions
// v1.0 — Foundation Phase (wiring-ready, not visually polished)
//
// ADDITIVE ONLY — does not modify any existing file.
// Safe to import alongside sld-symbols.ts, sld-types.ts,
// topology-engine.ts, sld-professional-renderer.ts.
//
// ANCHOR COORDINATE SYSTEM:
//   All anchor positions are RELATIVE (0.0 → 1.0)
//   x=0.0 = left edge,  x=1.0 = right edge
//   y=0.0 = top edge,   y=1.0 = bottom edge
//
// NAMING CONVENTION:
//   dc_in / dc_out  — DC power conductors
//   ac_in / ac_out  — AC power conductors
//   ac_l1 / ac_l2   — AC line conductors (named phase)
//   ac_n            — Neutral conductor
//   load            — Load-side output (panels)
//   line            — Line-side input (utility)
//   ground          — Equipment grounding conductor
//   com             — Communications / data
//
// FLOW DIRECTION CONVENTION:
//   left-to-right: source is left, load is right
//   top-to-bottom: source is top, load is bottom
// ============================================================

// ─── Anchor Point ─────────────────────────────────────────────────────────────
export interface AnchorPoint {
  /** Relative X position within emblem bounding box (0.0 → 1.0) */
  x: number;
  /** Relative Y position within emblem bounding box (0.0 → 1.0) */
  y: number;
  /** Which edge this anchor exits from — used for wire routing direction */
  edge: 'left' | 'right' | 'top' | 'bottom';
  /** Electrical domain of this connection */
  domain: 'DC' | 'AC' | 'GND' | 'COM';
  /** Human-readable label for the conductor at this point */
  label: string;
}

// ─── Layout Rules ─────────────────────────────────────────────────────────────
export interface EmblemLayoutRules {
  /** Primary flow direction for wiring engine routing */
  flowDirection: 'left-to-right' | 'top-to-bottom';
  /** Preferred horizontal gap between this emblem and the next (px, absolute) */
  preferredSpacingX: number;
  /** Preferred vertical gap between this emblem and the next (px, absolute) */
  preferredSpacingY: number;
  /** Which topology chains this emblem belongs to */
  topologyRoles: EmblemTopologyRole[];
}

export type EmblemTopologyRole =
  | 'dc_source'           // PV arrays
  | 'dc_protection'       // DC disconnects, fuses, combiners
  | 'dc_to_ac_conversion' // Inverters
  | 'ac_protection'       // AC disconnects, breakers
  | 'ac_distribution'     // MSP, sub-panels
  | 'ac_metering'         // Utility meter, production meter
  | 'ac_storage'          // AC-coupled batteries
  | 'dc_storage'          // DC-coupled batteries
  | 'grounding'           // Ground electrode, bonding
  | 'ac_source'           // Generator
  | 'transfer'            // ATS
  | 'gateway'             // BUI / comms gateway
  | 'wiring_junction';    // Junction boxes

// ─── Emblem Contract ──────────────────────────────────────────────────────────
export interface EmblemContract {
  /** Matches SLDSymbol.id in sld-symbols.ts */
  id: string;
  /** Display name */
  label: string;
  /**
   * Absolute pixel dimensions — matches sld-symbols.ts width/height.
   * Used to convert relative anchors to absolute coordinates.
   */
  width: number;
  height: number;
  /**
   * Named anchor points — RELATIVE coordinates (0→1).
   * At least one input + one output + ground (where applicable).
   */
  anchors: Record<string, AnchorPoint>;
  /** Layout and routing hints */
  layoutRules: EmblemLayoutRules;
}

// ─── Helper: resolve relative anchor to absolute pixel position ───────────────
export function resolveAnchor(
  contract: EmblemContract,
  anchorId: string,
  /** Absolute position of the emblem's top-left corner on the canvas */
  emblemOrigin: { x: number; y: number }
): { x: number; y: number } | null {
  const anchor = contract.anchors[anchorId];
  if (!anchor) {
    console.warn(`[SLD ANCHOR INIT] Missing anchor "${anchorId}" on emblem "${contract.id}"`);
    return null;
  }
  return {
    x: emblemOrigin.x + anchor.x * contract.width,
    y: emblemOrigin.y + anchor.y * contract.height,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMBLEM CONTRACT DEFINITIONS — All 18 SLD symbols
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. PV Array ──────────────────────────────────────────────────────────────
export const CONTRACT_PV_ARRAY: EmblemContract = {
  id: 'pv-array',
  label: 'PV Array',
  width: 200,
  height: 160,
  anchors: {
    dc_out_pos: { x: 1.0,  y: 0.375, edge: 'right',  domain: 'DC',  label: 'DC+' },
    dc_out_neg: { x: 1.0,  y: 0.625, edge: 'right',  domain: 'DC',  label: 'DC−' },
    ground:     { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['dc_source'],
  },
};

// ─── 2. String Inverter ───────────────────────────────────────────────────────
export const CONTRACT_INVERTER: EmblemContract = {
  id: 'inverter',
  label: 'String Inverter',
  width: 200,
  height: 170,
  anchors: {
    dc_in_pos:  { x: 0.0,  y: 0.353, edge: 'left',   domain: 'DC',  label: 'DC+ In' },
    dc_in_neg:  { x: 0.0,  y: 0.529, edge: 'left',   domain: 'DC',  label: 'DC− In' },
    ac_out_l1:  { x: 1.0,  y: 0.441, edge: 'right',  domain: 'AC',  label: 'L1 Out' },
    ac_out_n:   { x: 1.0,  y: 0.588, edge: 'right',  domain: 'AC',  label: 'N Out' },
    ground:     { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['dc_to_ac_conversion'],
  },
};

// ─── 3. Battery DC-Coupled ────────────────────────────────────────────────────
export const CONTRACT_BATTERY_DC: EmblemContract = {
  id: 'battery-dc',
  label: 'Battery (DC)',
  width: 180,
  height: 170,
  anchors: {
    dc_pos:  { x: 1.0,  y: 0.324, edge: 'right',  domain: 'DC',  label: 'DC+' },
    dc_neg:  { x: 1.0,  y: 0.471, edge: 'right',  domain: 'DC',  label: 'DC−' },
    ground:  { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['dc_storage'],
  },
};

// ─── 4. Battery AC-Coupled ────────────────────────────────────────────────────
export const CONTRACT_BATTERY_AC: EmblemContract = {
  id: 'battery-ac',
  label: 'Battery (AC)',
  width: 180,
  height: 170,
  anchors: {
    ac_l1:  { x: 1.0,  y: 0.324, edge: 'right',  domain: 'AC',  label: 'L1' },
    ac_n:   { x: 1.0,  y: 0.471, edge: 'right',  domain: 'AC',  label: 'N' },
    ground: { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['ac_storage'],
  },
};

// ─── 5. BUI / Enphase Gateway ─────────────────────────────────────────────────
export const CONTRACT_BUI: EmblemContract = {
  id: 'bui-enphase',
  label: 'BUI / Gateway',
  width: 180,
  height: 130,
  anchors: {
    ac_in:  { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'AC',  label: 'AC In' },
    ac_out: { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'AC',  label: 'AC Out' },
    com:    { x: 0.5,  y: 0.0,  edge: 'top',    domain: 'COM', label: 'Envoy' },
    ground: { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['gateway'],
  },
};

// ─── 6. Generator ─────────────────────────────────────────────────────────────
export const CONTRACT_GENERATOR: EmblemContract = {
  id: 'generator',
  label: 'Generator',
  width: 180,
  height: 200,
  anchors: {
    ac_l1:  { x: 1.0,  y: 0.400, edge: 'right',  domain: 'AC',  label: 'L1' },
    ac_l2:  { x: 1.0,  y: 0.525, edge: 'right',  domain: 'AC',  label: 'L2' },
    ac_n:   { x: 1.0,  y: 0.650, edge: 'right',  domain: 'AC',  label: 'N' },
    ground: { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['ac_source'],
  },
};

// ─── 7. AC Combiner ───────────────────────────────────────────────────────────
export const CONTRACT_AC_COMBINER: EmblemContract = {
  id: 'ac-combiner',
  label: 'AC Combiner',
  width: 180,
  height: 160,
  anchors: {
    ac_in_1: { x: 0.0,  y: 0.344, edge: 'left',   domain: 'AC',  label: 'Branch 1 In' },
    ac_in_2: { x: 0.0,  y: 0.500, edge: 'left',   domain: 'AC',  label: 'Branch 2 In' },
    ac_in_3: { x: 0.0,  y: 0.656, edge: 'left',   domain: 'AC',  label: 'Branch 3 In' },
    ac_out:  { x: 1.0,  y: 0.500, edge: 'right',  domain: 'AC',  label: 'AC Out' },
    ground:  { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['dc_protection'],
  },
};

// ─── 8. DC Disconnect ─────────────────────────────────────────────────────────
export const CONTRACT_DC_DISCONNECT: EmblemContract = {
  id: 'dc-disconnect',
  label: 'DC Disconnect',
  width: 120,
  height: 100,
  anchors: {
    dc_in:  { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'DC',  label: 'DC In' },
    dc_out: { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'DC',  label: 'DC Out' },
    ground: { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['dc_protection'],
  },
};

// ─── 9. AC Disconnect ─────────────────────────────────────────────────────────
export const CONTRACT_AC_DISCONNECT: EmblemContract = {
  id: 'ac-disconnect',
  label: 'AC Disconnect',
  width: 120,
  height: 100,
  anchors: {
    ac_in:  { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'AC',  label: 'AC In' },
    ac_out: { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'AC',  label: 'AC Out' },
    ground: { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['ac_protection'],
  },
};

// ─── 10. Fused Disconnect ─────────────────────────────────────────────────────
export const CONTRACT_FUSED_DISCONNECT: EmblemContract = {
  id: 'fused-disconnect',
  label: 'Fused Disconnect',
  width: 140,
  height: 100,
  anchors: {
    dc_in:  { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'DC',  label: 'DC In' },
    dc_out: { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'DC',  label: 'DC Out' },
    ground: { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['dc_protection'],
  },
};

// ─── 11. Ground Electrode ─────────────────────────────────────────────────────
export const CONTRACT_GROUND: EmblemContract = {
  id: 'ground',
  label: 'System Ground',
  width: 80,
  height: 90,
  anchors: {
    ground: { x: 0.5,  y: 0.0,  edge: 'top',    domain: 'GND', label: 'GND In' },
  },
  layoutRules: {
    flowDirection: 'top-to-bottom',
    preferredSpacingX: 40,
    preferredSpacingY: 20,
    topologyRoles: ['grounding'],
  },
};

// ─── 12. Fuse ─────────────────────────────────────────────────────────────────
export const CONTRACT_FUSE: EmblemContract = {
  id: 'fuse',
  label: 'Fuse',
  width: 100,
  height: 70,
  anchors: {
    in:  { x: 0.0,  y: 0.5,  edge: 'left',  domain: 'DC',  label: 'In' },
    out: { x: 1.0,  y: 0.5,  edge: 'right', domain: 'DC',  label: 'Out' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 40,
    preferredSpacingY: 20,
    topologyRoles: ['dc_protection'],
  },
};

// ─── 13. Circuit Breaker ──────────────────────────────────────────────────────
export const CONTRACT_BREAKER: EmblemContract = {
  id: 'breaker',
  label: 'Circuit Breaker',
  width: 100,
  height: 80,
  anchors: {
    in:  { x: 0.0,  y: 0.5,  edge: 'left',  domain: 'AC',  label: 'Line' },
    out: { x: 1.0,  y: 0.5,  edge: 'right', domain: 'AC',  label: 'Load' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 40,
    preferredSpacingY: 20,
    topologyRoles: ['ac_protection'],
  },
};

// ─── 14. Junction Box ─────────────────────────────────────────────────────────
export const CONTRACT_JUNCTION_BOX: EmblemContract = {
  id: 'junction-box',
  label: 'Junction Box',
  width: 100,
  height: 100,
  anchors: {
    left:   { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'AC',  label: 'Left' },
    right:  { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'AC',  label: 'Right' },
    top:    { x: 0.5,  y: 0.0,  edge: 'top',    domain: 'AC',  label: 'Top' },
    bottom: { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'AC',  label: 'Bottom' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 40,
    preferredSpacingY: 20,
    topologyRoles: ['wiring_junction'],
  },
};

// ─── 15. Main Service Panel (MSP) ─────────────────────────────────────────────
export const CONTRACT_MSP: EmblemContract = {
  id: 'msp',
  label: 'Main Service Panel',
  width: 160,
  height: 180,
  anchors: {
    line:      { x: 0.0,  y: 0.306, edge: 'left',   domain: 'AC',  label: 'Utility In' },
    pv_in:     { x: 0.0,  y: 0.500, edge: 'left',   domain: 'AC',  label: 'PV Backfeed' },
    load_out:  { x: 1.0,  y: 0.400, edge: 'right',  domain: 'AC',  label: 'Loads' },
    ground:    { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'N/G Bus' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['ac_distribution'],
  },
};

// ─── 16. Sub Panel ────────────────────────────────────────────────────────────
export const CONTRACT_SUB_PANEL: EmblemContract = {
  id: 'sub-panel',
  label: 'Sub Panel',
  width: 140,
  height: 150,
  anchors: {
    ac_in:  { x: 0.0,  y: 0.333, edge: 'left',   domain: 'AC',  label: 'Feeder In' },
    ac_out: { x: 1.0,  y: 0.333, edge: 'right',  domain: 'AC',  label: 'Loads' },
    ground: { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'N Bus' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['ac_distribution'],
  },
};

// ─── 17. Utility Meter ────────────────────────────────────────────────────────
export const CONTRACT_UTILITY_METER: EmblemContract = {
  id: 'utility-meter',
  label: 'Utility Meter',
  width: 120,
  height: 120,
  anchors: {
    line:    { x: 0.0,  y: 0.5,  edge: 'left',   domain: 'AC',  label: 'Utility In' },
    service: { x: 1.0,  y: 0.5,  edge: 'right',  domain: 'AC',  label: 'Service Out' },
    ground:  { x: 0.5,  y: 1.0,  edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 60,
    preferredSpacingY: 40,
    topologyRoles: ['ac_metering'],
  },
};

// ─── 18. ATS / Transfer Switch ────────────────────────────────────────────────
export const CONTRACT_ATS: EmblemContract = {
  id: 'ats',
  label: 'ATS',
  width: 160,
  height: 140,
  anchors: {
    util_in:  { x: 0.0,  y: 0.357, edge: 'left',   domain: 'AC',  label: 'Utility In' },
    gen_in:   { x: 0.0,  y: 0.643, edge: 'left',   domain: 'AC',  label: 'Generator In' },
    load_out: { x: 1.0,  y: 0.500, edge: 'right',  domain: 'AC',  label: 'Load Out' },
    ground:   { x: 0.5,  y: 1.0,   edge: 'bottom', domain: 'GND', label: 'EGC' },
  },
  layoutRules: {
    flowDirection: 'left-to-right',
    preferredSpacingX: 80,
    preferredSpacingY: 40,
    topologyRoles: ['transfer'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 — ELECTRICAL FLOW RULES
// ═══════════════════════════════════════════════════════════════════════════════

export type WireType = 'DC' | 'AC' | 'GROUND' | 'COM';

/**
 * Describes a required or allowed flow step between two emblem roles.
 * The wiring engine uses these rules to validate and auto-connect.
 */
export interface FlowRule {
  /** Human label for this rule */
  label: string;
  /** Emblem ID of the source */
  fromEmblemId: string;
  /** Anchor name on the source emblem */
  fromAnchor: string;
  /** Emblem ID of the destination */
  toEmblemId: string;
  /** Anchor name on the destination emblem */
  toAnchor: string;
  /** Wire type for this connection */
  wireType: WireType;
  /** NEC reference if applicable */
  necReference?: string;
  /** Whether this connection is required (vs optional) */
  required: boolean;
}

/**
 * DC Flow Rules — PV Array → DC Protection → Inverter
 * NEC 690 Article
 */
export const DC_FLOW_RULES: FlowRule[] = [
  {
    label: 'PV Array → DC Disconnect',
    fromEmblemId: 'pv-array',
    fromAnchor:   'dc_out_pos',
    toEmblemId:   'dc-disconnect',
    toAnchor:     'dc_in',
    wireType:     'DC',
    necReference: 'NEC 690.13',
    required:     true,
  },
  {
    label: 'PV Array → Fused Disconnect',
    fromEmblemId: 'pv-array',
    fromAnchor:   'dc_out_pos',
    toEmblemId:   'fused-disconnect',
    toAnchor:     'dc_in',
    wireType:     'DC',
    necReference: 'NEC 690.9',
    required:     false,
  },
  {
    label: 'DC Disconnect → Inverter DC In',
    fromEmblemId: 'dc-disconnect',
    fromAnchor:   'dc_out',
    toEmblemId:   'inverter',
    toAnchor:     'dc_in_pos',
    wireType:     'DC',
    necReference: 'NEC 690.15',
    required:     true,
  },
  {
    label: 'Fused Disconnect → Inverter DC In',
    fromEmblemId: 'fused-disconnect',
    fromAnchor:   'dc_out',
    toEmblemId:   'inverter',
    toAnchor:     'dc_in_pos',
    wireType:     'DC',
    necReference: 'NEC 690.9',
    required:     false,
  },
  {
    label: 'PV Array → Battery DC (DC-coupled)',
    fromEmblemId: 'pv-array',
    fromAnchor:   'dc_out_pos',
    toEmblemId:   'battery-dc',
    toAnchor:     'dc_pos',
    wireType:     'DC',
    necReference: 'NEC 706',
    required:     false,
  },
];

/**
 * AC Flow Rules — Inverter → AC Protection → Distribution → Metering
 * NEC 690, NEC 705, NEC 230
 */
export const AC_FLOW_RULES: FlowRule[] = [
  {
    label: 'Inverter AC Out → AC Combiner',
    fromEmblemId: 'inverter',
    fromAnchor:   'ac_out_l1',
    toEmblemId:   'ac-combiner',
    toAnchor:     'ac_in_1',
    wireType:     'AC',
    necReference: 'NEC 705.12',
    required:     false,
  },
  {
    label: 'Inverter AC Out → AC Disconnect',
    fromEmblemId: 'inverter',
    fromAnchor:   'ac_out_l1',
    toEmblemId:   'ac-disconnect',
    toAnchor:     'ac_in',
    wireType:     'AC',
    necReference: 'NEC 690.17',
    required:     true,
  },
  {
    label: 'AC Combiner → AC Disconnect',
    fromEmblemId: 'ac-combiner',
    fromAnchor:   'ac_out',
    toEmblemId:   'ac-disconnect',
    toAnchor:     'ac_in',
    wireType:     'AC',
    necReference: 'NEC 690.17',
    required:     false,
  },
  {
    label: 'AC Disconnect → MSP',
    fromEmblemId: 'ac-disconnect',
    fromAnchor:   'ac_out',
    toEmblemId:   'msp',
    toAnchor:     'pv_in',
    wireType:     'AC',
    necReference: 'NEC 705.12(D)',
    required:     true,
  },
  {
    label: 'MSP → Utility Meter',
    fromEmblemId: 'msp',
    fromAnchor:   'line',
    toEmblemId:   'utility-meter',
    toAnchor:     'service',
    wireType:     'AC',
    necReference: 'NEC 230',
    required:     true,
  },
  {
    label: 'Battery AC → MSP (AC-coupled)',
    fromEmblemId: 'battery-ac',
    fromAnchor:   'ac_l1',
    toEmblemId:   'msp',
    toAnchor:     'pv_in',
    wireType:     'AC',
    necReference: 'NEC 705.12(B)',
    required:     false,
  },
  {
    label: 'Generator → ATS',
    fromEmblemId: 'generator',
    fromAnchor:   'ac_l1',
    toEmblemId:   'ats',
    toAnchor:     'gen_in',
    wireType:     'AC',
    necReference: 'NEC 702',
    required:     false,
  },
  {
    label: 'ATS → MSP',
    fromEmblemId: 'ats',
    fromAnchor:   'load_out',
    toEmblemId:   'msp',
    toAnchor:     'line',
    wireType:     'AC',
    necReference: 'NEC 702',
    required:     false,
  },
];

/**
 * Ground Rules — All equipment to shared ground bus
 * NEC 250, NEC 690.43
 */
export const GROUND_FLOW_RULES: FlowRule[] = [
  {
    label: 'PV Array EGC → Ground',
    fromEmblemId: 'pv-array',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 690.43',
    required:     true,
  },
  {
    label: 'Inverter EGC → Ground',
    fromEmblemId: 'inverter',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 690.43',
    required:     true,
  },
  {
    label: 'MSP N/G Bus → Ground',
    fromEmblemId: 'msp',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 250.24',
    required:     true,
  },
  {
    label: 'DC Disconnect EGC → Ground',
    fromEmblemId: 'dc-disconnect',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 250.110',
    required:     true,
  },
  {
    label: 'AC Disconnect EGC → Ground',
    fromEmblemId: 'ac-disconnect',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 250.110',
    required:     true,
  },
  {
    label: 'Battery DC EGC → Ground',
    fromEmblemId: 'battery-dc',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 706.41',
    required:     false,
  },
  {
    label: 'Battery AC EGC → Ground',
    fromEmblemId: 'battery-ac',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 706.41',
    required:     false,
  },
  {
    label: 'Generator EGC → Ground',
    fromEmblemId: 'generator',
    fromAnchor:   'ground',
    toEmblemId:   'ground',
    toAnchor:     'ground',
    wireType:     'GROUND',
    necReference: 'NEC 250.34',
    required:     false,
  },
];

// ─── Combined Flow Rule Registry ─────────────────────────────────────────────
export const ALL_FLOW_RULES: FlowRule[] = [
  ...DC_FLOW_RULES,
  ...AC_FLOW_RULES,
  ...GROUND_FLOW_RULES,
];

// ─── Emblem Contract Registry ─────────────────────────────────────────────────
export const EMBLEM_CONTRACT_REGISTRY: Record<string, EmblemContract> = {
  'pv-array':          CONTRACT_PV_ARRAY,
  'inverter':          CONTRACT_INVERTER,
  'battery-dc':        CONTRACT_BATTERY_DC,
  'battery-ac':        CONTRACT_BATTERY_AC,
  'bui-enphase':       CONTRACT_BUI,
  'generator':         CONTRACT_GENERATOR,
  'ac-combiner':       CONTRACT_AC_COMBINER,
  'dc-disconnect':     CONTRACT_DC_DISCONNECT,
  'ac-disconnect':     CONTRACT_AC_DISCONNECT,
  'fused-disconnect':  CONTRACT_FUSED_DISCONNECT,
  'ground':            CONTRACT_GROUND,
  'fuse':              CONTRACT_FUSE,
  'breaker':           CONTRACT_BREAKER,
  'junction-box':      CONTRACT_JUNCTION_BOX,
  'msp':               CONTRACT_MSP,
  'sub-panel':         CONTRACT_SUB_PANEL,
  'utility-meter':     CONTRACT_UTILITY_METER,
  'ats':               CONTRACT_ATS,
};

/**
 * Safely look up an emblem contract.
 * Returns null (never throws) — fail-safe for wiring engine.
 */
export function getEmblemContract(emblemId: string): EmblemContract | null {
  const contract = EMBLEM_CONTRACT_REGISTRY[emblemId];
  if (!contract) {
    console.warn(`[SLD ANCHOR INIT] No contract registered for emblem "${emblemId}"`);
    return null;
  }
  return contract;
}