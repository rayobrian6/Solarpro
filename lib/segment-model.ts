// ============================================================
// CANONICAL SEGMENT MODEL — BUILD v16
// Single source of truth for all electrical segments.
// SLD, BOM, Conductor Schedule, and Equipment Schedule
// must ALL derive from this model.
// ============================================================

/**
 * Segment Type Classification
 * Every run segment must be one of these canonical types.
 */
export enum SegmentType {
  // Open-air segments (no conduit)
  ARRAY_OPEN_AIR = 'ARRAY_OPEN_AIR',
  
  // Branch circuit segments (sized by branch current)
  BRANCH_HOMERUN = 'BRANCH_HOMERUN',
  
  // Feeder segments (sized by total AC output current)
  AC_COMBINER_FEEDER = 'AC_COMBINER_FEEDER',
  AC_DISCONNECT_FEEDER = 'AC_DISCONNECT_FEEDER',
  INVERTER_OUTPUT = 'INVERTER_OUTPUT',
  
  // Interconnection segments
  LOAD_SIDE_TAP_SEGMENT = 'LOAD_SIDE_TAP_SEGMENT',
  BACKFED_BREAKER_SEGMENT = 'BACKFED_BREAKER_SEGMENT',
  SUPPLY_SIDE_TAP_SEGMENT = 'SUPPLY_SIDE_TAP_SEGMENT',
  
  // DC segments
  DC_STRING_RUN = 'DC_STRING_RUN',
  DC_COMBINER_RUN = 'DC_COMBINER_RUN',
  DC_DISCO_TO_INV_RUN = 'DC_DISCO_TO_INV_RUN',
  
  // Utility segments
  UTILITY_SERVICE_ENTRANCE = 'UTILITY_SERVICE_ENTRANCE',
}

/**
 * Interconnection Type
 * Must be respected by segment generation and SLD rendering.
 */
export enum InterconnectionType {
  BACKFED_BREAKER = 'Backfed Breaker',
  LOAD_SIDE_TAP = 'Load Side Tap',
  SUPPLY_SIDE_TAP = 'Supply Side Tap',
  LINE_SIDE_TAP = 'Line Side Tap',
}

/**
 * Conductor Definition
 */
export interface Conductor {
  qty: number;                    // Quantity in bundle
  gauge: string;                  // e.g., '#10 AWG', '#6 AWG'
  insulation: string;             // e.g., 'THWN-2', 'USE-2', 'PV Wire'
  color: 'BLK' | 'RED' | 'WHI' | 'GRN' | 'BLU' | 'YEL';
  isCurrentCarrying: boolean;     // true for hot conductors, false for EGC
  currentPerConductor: number;    // A — current on each conductor
}

/**
 * Conductor Bundle
 * Complete set of conductors for a segment.
 */
export interface ConductorBundle {
  conductors: Conductor[];
  totalCurrentCarrying: number;   // Sum of qty for current-carrying conductors
  totalAreaIn2: number;           // For conduit fill calculation
}

/**
 * Segment Interface
 * The canonical electrical segment definition.
 */
export interface Segment {
  id: string;                     // Unique segment ID
  type: SegmentType;              // Canonical segment type
  label: string;                  // Display label
  fromNode: string;               // Equipment node name (from)
  toNode: string;                 // Equipment node name (to)
  
  // Electrical parameters
  conductorBundle: ConductorBundle;
  conduitType: string;            // 'EMT', 'PVC Sch 40', 'PVC Sch 80', 'NONE'
  conduitSize: string;            // e.g., '3/4"', '1"', '1-1/2"'
  fillPercent: number;            // NEC Ch.9 Table 1 — max 40%
  onewayLengthFt: number;
  
  // Current and ampacity
  continuousCurrent: number;      // A — actual load current
  requiredAmpacity: number;       // A — continuous × 1.25 (NEC 690.8)
  effectiveAmpacity: number;      // A — after temp + conduit derating
  tempDeratingFactor: number;
  conduitDeratingFactor: number;
  ocpdAmps: number;               // OCPD protecting this segment
  
  // Voltage drop
  voltageDropPct: number;
  voltageDropVolts: number;
  systemVoltage: number;          // V — 240V for AC, Vmp for DC
  
  // NEC compliance
  necReferences: string[];
  
  // Validation
  ampacityPass: boolean;
  voltageDropPass: boolean;
  conduitFillPass: boolean;
  overallPass: boolean;
  
  // Interconnection-specific
  interconnectionType?: InterconnectionType;
  isUtilityOwned?: boolean;       // true for utility service entrance
  
  // Display
  conductorCallout: string;       // Permit-grade: '3×#10 BLK + 3×#10 RED + 1×#10 GRN IN 1" EMT — 31% fill'
}

/**
 * Segment Builder Input
 * All configuration needed to build segments.
 */
export interface SegmentBuilderInput {
  // Topology
  topology: 'micro' | 'string' | 'optimizer';
  totalModules: number;
  
  // Module parameters
  panelVoc: number;
  panelVmp: number;
  panelIsc: number;
  panelImp: number;
  panelWatts: number;
  
  // Inverter parameters
  inverterAcOutputA: number;       // AC output current per inverter
  inverterAcOutputW: number;       // AC output power per inverter
  inverterCount: number;
  
  // Branch configuration (micro)
  branchCount?: number;           // Number of AC branches
  maxMicrosPerBranch?: number;    // NEC 690.8(B): max 16
  
  // String configuration (string)
  stringCount?: number;
  
  // Ambient conditions
  ambientTempC: number;
  rooftopTempAdderC: number;
  
  // Conduit and wire
  conduitType: string;            // 'EMT', 'PVC Sch 40', 'PVC Sch 80'
  
  // Run lengths
  runLengths: {
    arrayToJbox: number;
    jboxToCombiner: number;
    jboxToInverter: number;
    combinerToDisco: number;
    inverterToDisco: number;
    discoToMsp: number;
    mspToUtility: number;
  };
  
  // Voltage drop limits
  maxACVoltageDropPct: number;
  maxDCVoltageDropPct: number;
  
  // Interconnection
  interconnectionType: InterconnectionType;
  
  // Main service panel
  mainPanelAmps: number;
  mainBusRating: number;
  mainBreakerAmps: number;
}

/**
 * Segment Builder Output
 */
export interface SegmentBuilderOutput {
  segments: Segment[];
  interconnectionPass: boolean;    // NEC 705.12(B) 120% rule for backfed breaker
  issues: EngineeringIssue[];
}

/**
 * Engineering Issue
 */
export interface EngineeringIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  necReference?: string;
  segmentId?: string;
  suggestion?: string;
}