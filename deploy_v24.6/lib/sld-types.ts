// ============================================================
// Permit-Grade Single-Line Diagram (SLD) Data Model
// IEEE electrical schematic — ANSI C (18×24) sheet layout
// ============================================================

// ─── Sheet / Title Block ──────────────────────────────────────────────────────

export interface SLDTitleBlock {
  projectName: string;
  clientName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  necVersion: string;           // e.g. "NEC 2023"
  systemSizeDC: string;         // e.g. "10.00 kW DC"
  systemSizeAC: string;         // e.g. "7.60 kW AC"
  sheetNumber: string;          // e.g. "E-1"
  totalSheets: string;          // e.g. "1"
  revision: string;             // e.g. "0"
  revisionDate: string;         // ISO date
  preparedBy: string;           // designer name
  preparedDate: string;         // ISO date
  checkedBy?: string;
  approvedBy?: string;
  drawingNumber?: string;       // e.g. "SLD-001"
  jurisdiction?: string;        // AHJ name
  permitNumber?: string;
  scale: string;                // e.g. "NTS" (not to scale)
}

// ─── Conductor Callout ────────────────────────────────────────────────────────

export interface ConductorCallout {
  hotCount: number;             // number of current-carrying conductors
  gauge: string;                // e.g. "#8 AWG"
  insulation: string;           // e.g. "THWN-2"
  egcGauge: string;             // e.g. "#10 AWG"
  conduitSize: string;          // e.g. '3/4"'
  conduitType: string;          // e.g. "EMT"
  formatted: string;            // e.g. "2#8 AWG THWN-2 + 1#10 GND in 3/4&quot; EMT"
  voltageDropPct: number;
  ampacity: number;
}

// ─── Equipment Nodes ─────────────────────────────────────────────────────────

export type SLDNodeType =
  | 'PV_ARRAY'
  | 'COMBINER_BOX'
  | 'DC_DISCONNECT'
  | 'RAPID_SHUTDOWN'
  | 'INVERTER'
  | 'AC_DISCONNECT'
  | 'PRODUCTION_METER'
  | 'MAIN_SERVICE_PANEL'
  | 'UTILITY_METER'
  | 'UTILITY_GRID'
  | 'BATTERY_STORAGE'
  | 'GROUNDING_ELECTRODE'
  | 'BONDING_JUMPER'
  | 'SURGE_PROTECTION';

export interface SLDNode {
  id: string;
  type: SLDNodeType;
  label: string;
  subLabel?: string;
  specs: Record<string, string>;  // key-value pairs shown on diagram
  necReference?: string;
  ulListing?: string;
  position?: { x: number; y: number }; // layout hint (0–1 normalized)
}

export interface PVArrayNode extends SLDNode {
  type: 'PV_ARRAY';
  arrayId: string;              // e.g. "1-1"
  panelCount: number;
  panelManufacturer: string;
  panelModel: string;
  panelWatts: number;
  stringVocSTC: number;
  stringVocCorrected: number;
  stringIsc: number;
  ocpdRating: number;
  dcWireCallout: ConductorCallout;
  tilt: number;
  azimuth: number;
}

export interface InverterNode extends SLDNode {
  type: 'INVERTER';
  inverterId: string;
  inverterType: 'string' | 'micro' | 'optimizer';
  manufacturer: string;
  model: string;
  acOutputKw: number;
  maxDcVoltage: number;
  efficiency: number;
  ulListing: string;
  rapidShutdownIntegrated: boolean;
  acWireCallout: ConductorCallout;
}

export interface MSPNode extends SLDNode {
  type: 'MAIN_SERVICE_PANEL';
  brand: string;
  ampRating: number;
  backfeedBreakerAmps: number;
  busbarRule: '120%' | 'supply-side';
  maxAllowedBackfeed: number;
}

export interface GroundingNode extends SLDNode {
  type: 'GROUNDING_ELECTRODE';
  electrodeType: string;        // e.g. "Ground Rod (2) 5/8&quot; × 8'"
  egcGauge: string;
  bondingJumperGauge: string;
}

// ─── Connections ──────────────────────────────────────────────────────────────

export type ConnectionType = 'DC' | 'AC' | 'GROUNDING' | 'BONDING' | 'COMMUNICATION';

export interface SLDConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: ConnectionType;
  conductor: ConductorCallout;
  label?: string;               // shown on diagram
  necReference?: string;
}

// ─── Grounding System ─────────────────────────────────────────────────────────

export interface GroundingSystem {
  egcGauge: string;             // Equipment Grounding Conductor
  egcPath: string[];            // node IDs in EGC path
  groundingElectrodeSystem: string; // description
  bondingJumperGauge: string;
  systemGroundingConductor: string;
  necReference: string;
}

// ─── Notes Block ──────────────────────────────────────────────────────────────

export interface SLDNote {
  number: number;
  text: string;
  necReference?: string;
}

// ─── Revision Block ───────────────────────────────────────────────────────────

export interface SLDRevision {
  rev: string;                  // e.g. "0", "1", "A"
  date: string;
  description: string;
  by: string;
}

// ─── Complete SLD Document ────────────────────────────────────────────────────

export interface SLDDocument {
  version: string;              // e.g. "3.0"
  generatedAt: string;          // ISO timestamp
  titleBlock: SLDTitleBlock;
  nodes: SLDNode[];
  connections: SLDConnection[];
  groundingSystem: GroundingSystem;
  notes: SLDNote[];
  revisions: SLDRevision[];

  // Computed summary for display
  summary: {
    totalDcKw: number;
    totalAcKw: number;
    dcAcRatio: number;
    totalPanels: number;
    totalInverters: number;
    systemVoltage: number;
    necVersion: string;
    hasBattery: boolean;
    hasRapidShutdown: boolean;
    hasProductionMeter: boolean;
  };
}

// ─── SLD Build Input (consumed from engineering calc output) ──────────────────

export interface SLDBuildInput {
  // Project info
  projectName: string;
  clientName: string;
  address: string;
  designer: string;
  date: string;
  necVersion: string;

  // Optional title block overrides (computed by renderer if not provided)
  systemSizeDC?: string;        // e.g. "10.00 kW DC"
  systemSizeAC?: string;        // e.g. "7.60 kW AC"
  sheetNumber?: string;         // e.g. "E-1"
  totalSheets?: string;         // e.g. "1"
  revision?: string;            // e.g. "0"
  preparedDate?: string;        // ISO date
  drawingNumber?: string;       // e.g. "SLD-001"
  jurisdiction?: string;        // AHJ name
  batteryModel?: string;        // battery model name
  notes?: string;               // engineering notes

  // ── V4 flat fields (topology-driven renderer) ──────────────────────────────
  // These optional fields are used by sld-v3-renderer; existing callers that
  // pass only calcResult/inverterSpecs/panelSpecs continue to work unchanged.
  topologyType?: string;        // TopologyType value, e.g. "STRING_INVERTER"
  drawingDate?: string;         // display date on title block, e.g. "2025-01-15"

  // Array / module summary
  totalPanels?: number;         // total module count across all arrays
  totalStrings?: number;        // total string count
  panelModel?: string;          // primary panel model name
  panelWatts?: number;          // panel STC wattage
  panelVoc?: number;            // panel open-circuit voltage (V)
  panelIsc?: number;            // panel short-circuit current (A)

  // DC wiring
  dcWireGauge?: string;         // e.g. "#10 AWG"
  dcOCPD?: number;              // DC OCPD rating (A)

  // Inverter summary (flat — for single-inverter or aggregate display)
  inverterModel?: string;       // primary inverter model name
  inverterManufacturer?: string; // primary inverter manufacturer
  acOutputKw?: number;          // total AC output (kW)

  // AC wiring
  acWireGauge?: string;         // e.g. "#8 AWG"
  acOCPD?: number;              // AC OCPD / breaker rating (A)
  acWireLength?: number;        // AC home-run length (ft)

  // MSP / backfeed
  backfeedAmps?: number;        // backfeed breaker size (A)

  // System config
  systemVoltage: number;
  mainPanelAmps: number;
  mainPanelBrand: string;
  utilityMeter: string;
  acDisconnect: boolean;
  dcDisconnect: boolean;
  productionMeter: boolean;
  rapidShutdown: boolean;
  conduitType: string;

  // Battery (optional)
  batteryBrand?: string;
  batteryCount?: number;
  batteryKwh?: number;
  batteryBackfeedA?: number;       // NEC 705.12(B) — battery backfeed breaker amps (AC-coupled)

  // Generator + ATS (optional)
  generatorBrand?: string;
  generatorModel?: string;
  generatorKw?: number;
  atsBrand?: string;
  atsModel?: string;
  atsAmpRating?: number;
  hasBackupInterface?: boolean;
  backupInterfaceBrand?: string;
  backupInterfaceModel?: string;

  // Engineering calc results (from runElectricalCalc)
  calcResult: {
    status: string;
    acWireGauge: string;
    acConductorCallout: string;
    acWireAmpacity: number;
    acVoltageDrop: number;
    groundingConductor: string;
    busbar: {
      backfeedBreakerRequired: number;
      busbarRule: string;
      maxAllowedBackfeed: number;
      passes: boolean;
    };
    conduitFill: {
      conduitSize: string;
      conduitType: string;
    };
    inverters: Array<{
      inverterId: number;
      type: string;
      acOutputKw: number;
      acOutputCurrentMax: number;
      acWireResult: {
        selectedGauge: string;
        conductorCallout: string;
        conduitSize: string;
        egcGauge: string;
        voltageDrop: number;
        effectiveAmpacity: number;
      };
      strings: Array<{
        stringId: number;
        panelCount: number;
        vocCorrected: number;
        iscSTC: number;
        ocpdRating: number;
        wireGauge: string;
        dcWireResult: {
          conductorCallout: string;
          voltageDrop: number;
          effectiveAmpacity: number;
        };
      }>;
    }>;
    autoResolutions: Array<{
      field: string;
      type: string;
      originalValue: string | number;
      resolvedValue: string | number;
      necReference: string;
      reason: string;
    }>;
  };

  // Equipment specs (from equipment-db)
  inverterSpecs: Array<{
    inverterId: string;
    manufacturer: string;
    model: string;
    acOutputKw: number;
    maxDcVoltage: number;
    efficiency: number;
    ulListing: string;
    rapidShutdownCompliant: boolean;
  }>;

  panelSpecs: Array<{
    panelId: string;
    manufacturer: string;
    model: string;
    watts: number;
    voc: number;
    isc: number;
    ulListing: string;
  }>;
}