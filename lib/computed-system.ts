// ============================================================
// ComputedSystem — Centralized Calculation Engine
// Single source of truth for all engineering data.
// All modules (SLD, BoM, Electrical, Conduit, Permit) read from this.
//
// NEC References:
//   690.7  — String voltage (Voc temperature correction)
//   690.8  — Circuit sizing (125% continuous load)
//   690.8(B) — AC branch circuit limits (max 16 micros per branch)
//   690.15 — DC Disconnect (NOT for microinverters)
//   310.16 — Wire ampacity table
//   250.122 — EGC sizing
//   Chapter 9 Table 1 — Conduit fill (40% max)
//   Chapter 9 Table 4 — Conduit dimensions
//   Chapter 9 Table 5 — Conductor areas
// ============================================================

import {
  buildSegmentSchedule,
  buildConductorCallout,
  calcBOMFromSegments,
  ConductorBundle,
  SegmentScheduleRow,
  SegmentScheduleInput,
  RacewayType,
} from './segment-schedule';

// ─── Equipment Spec ──────────────────────────────────────────────────────────

export type TopologyType =
  | 'MICROINVERTER'
  | 'STRING_INVERTER'
  | 'STRING_WITH_OPTIMIZER'
  | 'HYBRID_INVERTER'
  | 'DC_COUPLED_BATTERY'
  | 'AC_COUPLED_BATTERY';

export interface EquipmentSpec {
  id: string;
  manufacturer: string;
  model: string;
  type: 'microinverter' | 'string_inverter' | 'optimizer' | 'hybrid' | 'panel' | 'battery';
  architecture: TopologyType;
  // DC input
  dcInputs: {
    maxVoltage: number;       // V — max DC input voltage
    mpptVoltageMin: number;   // V
    mpptVoltageMax: number;   // V
    maxInputCurrentPerMppt: number; // A
    mpptCount: number;
  };
  // AC output
  acOutput: {
    ratedKw: number;
    maxCurrentAmps: number;   // A — from datasheet
    voltage: number;          // V — typically 240
    phases: 1 | 3;
  };
  // Microinverter-specific
  modulesPerDevice: number;   // 1 for most micros, 2 for IQ8D, etc.
  branchLimit: number;        // max devices per AC branch (NEC 690.8(B)) — 16 for Enphase
  // Panel-specific
  panelWatts?: number;
  panelVoc?: number;
  panelIsc?: number;
  panelVmp?: number;
  panelImp?: number;
  tempCoeffVoc?: number;      // %/°C (negative)
  tempCoeffIsc?: number;      // %/°C (positive)
  maxSeriesFuseRating?: number;
}

// ─── Run Segment ─────────────────────────────────────────────────────────────

export type RunSegmentId =
  | 'DC_STRING_RUN'
  | 'DC_DISCO_TO_INV_RUN'
  | 'ROOF_RUN'
  | 'BRANCH_RUN'
  | 'INV_TO_DISCO_RUN'
  | 'COMBINER_TO_DISCO_RUN'
  | 'DISCO_TO_METER_RUN'
  | 'METER_TO_MSP_RUN'
  | 'MSP_TO_UTILITY_RUN'
  | 'ARRAY_OPEN_AIR'
  | 'ARRAY_CONDUIT_RUN';

export interface RunSegment {
  id: RunSegmentId;
  label: string;
  from: string;               // device label
  to: string;                 // device label
  // Electrical
  conductorCount: number;     // current-carrying conductors
  wireGauge: string;          // e.g. '#10 AWG'
  conductorMaterial: 'CU' | 'AL';
  insulation: string;         // 'THWN-2' | 'USE-2' | 'PV Wire'
  egcGauge: string;           // Equipment Grounding Conductor
  neutralRequired: boolean;
  isOpenAir?: boolean;         // true for open-air runs (no conduit)
  // Conduit
  conduitType: string;        // 'EMT' | 'PVC Sch 40' | 'PVC Sch 80' | 'NONE'
  conduitSize: string;        // '3/4"' | '1"' etc.
  conduitFillPct: number;     // NEC Ch.9 Table 1 — max 40%
  onewayLengthFt: number;
  // Ampacity
  continuousCurrent: number;  // A — actual load
  requiredAmpacity: number;   // A — continuous × 1.25 (NEC 690.8)
  effectiveAmpacity: number;  // A — after derating
  tempDeratingFactor: number;
  conduitDeratingFactor: number;
  ocpdAmps: number;           // OCPD protecting this segment
  // Voltage drop
  voltageDropPct: number;
  voltageDropVolts: number;
  // Compliance
  ampacityPass: boolean;
  voltageDropPass: boolean;
  conduitFillPass: boolean;   // conduitFillPct <= 40%
  overallPass: boolean;
  necReferences: string[];
  // Display
  conductorCallout: string;   // permit-grade: '2#10 AWG THWN-2 + 1#10 AWG GND in 3/4" EMT'
  conductorBundle?: ConductorBundle[]; // structured bundle — from buildSegmentSchedule()
  color: 'dc' | 'ac' | 'gnd';
}

// ─── String Calculation ───────────────────────────────────────────────────────

export interface StringCalc {
  stringIndex: number;
  panelCount: number;
  // NEC 690.7 voltage
  vocSTC: number;             // V — panel Voc at STC
  vocCorrected: number;       // V — Voc × temp correction factor
  stringVoc: number;          // V — vocCorrected × panelCount
  stringVmp: number;          // V — Vmp × panelCount
  stringIsc: number;          // A — Isc × temp correction
  tempCorrectionFactor: number;
  designTempMin: number;      // °C
  // OCPD
  ocpdAmps: number;           // A — NEC 690.8: Isc × 1.25 → next standard
  // Compliance
  voltagePass: boolean;       // stringVoc <= inverter maxDcVoltage
  necReference: string;
}

// ─── Micro Branch Calculation ─────────────────────────────────────────────────

export interface MicroBranch {
  branchIndex: number;
  deviceCount: number;        // microinverters on this branch
  branchCurrentA: number;     // A — sum of micro AC output currents
  ocpdAmps: number;           // A — NEC 690.8: branchCurrent × 1.25 → next standard
  conductorCallout: string;
  necReference: string;       // 'NEC 690.8(B)'
}

// ─── Validation Issue ─────────────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  necReference: string;
  autoFixed: boolean;
  suggestion?: string;
}

// ─── ComputedSystem ───────────────────────────────────────────────────────────

export interface ComputedSystem {
  // ── Topology ──────────────────────────────────────────────────────────────
  topology: TopologyType;
  isMicro: boolean;
  isString: boolean;
  isOptimizer: boolean;

  // ── Equipment ─────────────────────────────────────────────────────────────
  inverterSpec: EquipmentSpec | null;
  panelSpec: EquipmentSpec | null;

  // ── Array Summary ─────────────────────────────────────────────────────────
  totalPanels: number;
  totalDcKw: number;          // kW — panels × watts
  totalAcKw: number;          // kW — from inverter(s)
  dcAcRatio: number;

  // ── String Inverter Specific ──────────────────────────────────────────────
  stringCount: number;        // NEC 690.7 auto-calculated
  panelsPerString: number;    // recommended
  lastStringPanels: number;   // may differ if not evenly divisible
  maxPanelsPerString: number; // from NEC 690.7 Voc limit
  strings: StringCalc[];      // per-string calculations

  // ── Microinverter Specific ────────────────────────────────────────────────
  microDeviceCount: number;   // = totalPanels (1 micro per panel for IQ8+)
  acBranchCount: number;      // ceil(microDeviceCount / branchLimit)
  microBranches: MicroBranch[];
  acBranchCurrentA: number;   // A per branch
  acBranchOcpdAmps: number;   // A — NEC 690.8

  // ── AC Electrical ─────────────────────────────────────────────────────────
  systemVoltageAC: number;    // 240
  acOutputCurrentA: number;   // A — total AC output
  acContinuousCurrentA: number; // A — × 1.25 (NEC 690.8)
  acOcpdAmps: number;         // A — next standard OCPD
  backfeedBreakerAmps: number; // A — for MSP interconnection
  interconnectionPass: boolean; // NEC 705.12(B) 120% rule

  // ── Wire & Conduit Runs ───────────────────────────────────────────────────
  runs: RunSegment[];         // ALL wiring runs — SLD reads from here
  runMap: Record<RunSegmentId, RunSegment>; // quick lookup
  segmentSchedule: SegmentScheduleRow[]; // canonical conductor bundle schedule

  // ── Conduit Schedule ─────────────────────────────────────────────────────
  conduitSchedule: ConduitScheduleRow[];

  // ── Equipment Schedule ────────────────────────────────────────────────────
  equipmentSchedule: EquipmentScheduleRow[];

  // ── BoM Quantities ────────────────────────────────────────────────────────
  bomQuantities: BomQuantities;

  // ── Validation ────────────────────────────────────────────────────────────
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  autoFixCount: number;
  isValid: boolean;           // no errors

  // ── Metadata ──────────────────────────────────────────────────────────────
  computedAt: string;         // ISO timestamp
  designTempMin: number;      // °C — from jurisdiction
  ambientTempC: number;       // °C — design max ambient
  rooftopTempAdderC: number;  // °C — for DC runs
}

export interface ConduitScheduleRow {
  raceway: string;            // 'C-1', 'C-2', etc.
  from: string;
  to: string;
  conduitType: string;
  conduitSize: string;
  conductors: string;         // '2#10 AWG THWN-2'
  egc: string;                // '1#10 AWG GND'
  neutral: string;            // '1#10 AWG N' or 'N/A'
  lengthFt: number;
  fillPct: number;
  ampacity: string;
  ocpd: string;
  voltageDrop: string;
  pass: boolean;
}

export interface EquipmentScheduleRow {
  tag: string;                // 'INV-1', 'AC-DISC-1', etc.
  description: string;
  manufacturer: string;
  model: string;
  qty: number;
  rating: string;
  necReference: string;
}

export interface BomQuantities {
  // Panels
  panels: number;
  panelModel: string;
  // Inverters
  inverters: number;          // string inverters OR microinverters
  inverterModel: string;
  // Microinverter-specific
  acCombiner: number;         // IQ Combiner or equivalent
  trunkCable: number;         // ft — AC trunk cable
  trunkCableTerminators: number;
  acBranchOcpd: number;       // qty of branch OCPDs
  // String-specific
  dcDisconnect: number;       // 0 for micro
  dcOcpd: number;             // qty of DC string OCPDs
  // Common
  acDisconnect: number;
  productionMeter: number;
  // Conduit (by type)
  conduitEMT: number;         // ft
  conduitPVC: number;         // ft
  // Wire (by gauge)
  wire10AWG: number;          // ft
  wire8AWG: number;           // ft
  wire6AWG: number;           // ft
  wire4AWG: number;           // ft
  // Racking
  railSections: number;
  midClamps: number;
  endClamps: number;
  lFeet: number;
  lagBolts: number;
  flashings: number;
}

// ─── Input to ComputedSystem ──────────────────────────────────────────────────

export interface ComputedSystemInput {
  // From ProjectConfig
  topology: 'string' | 'micro' | 'optimizer';
  totalPanels: number;
  panelWatts: number;
  panelVoc: number;
  panelIsc: number;
  panelVmp: number;
  panelImp: number;
  panelTempCoeffVoc: number;  // %/°C (negative, e.g. -0.26)
  panelTempCoeffIsc: number;  // %/°C (positive, e.g. 0.05)
  panelMaxSeriesFuse: number;
  panelModel: string;
  panelManufacturer: string;

  // Inverter
  inverterManufacturer: string;
  inverterModel: string;
  inverterAcKw: number;
  inverterMaxDcV: number;
  inverterMpptVmin: number;
  inverterMpptVmax: number;
  inverterMaxInputCurrentPerMppt: number;
  inverterMpptChannels: number;
  inverterAcCurrentMax: number;  // A — from datasheet
  inverterModulesPerDevice: number; // 1 for IQ8+, 2 for IQ8D
  inverterBranchLimit: number;   // 16 for Enphase

  // Environmental
  designTempMin: number;      // °C — coldest design temp (for Voc correction)
  ambientTempC: number;       // °C — max ambient (for ampacity derating)
  rooftopTempAdderC: number;  // °C — added for DC rooftop runs

  // Run lengths (ft) — user-specified or defaults
  runLengths: Partial<Record<RunSegmentId, number>>;

  // Conduit
  conduitType: string;        // 'EMT' | 'PVC Sch 40'

  // MSP
  mainPanelAmps: number;
  mainPanelBrand: string;
  panelBusRating: number;

  // Compliance thresholds
  maxACVoltageDropPct: number;  // typically 2%
  maxDCVoltageDropPct: number;  // typically 3%
}

// ─── NEC Tables ──────────────────────────────────────────────────────────────

// NEC 310.16 — Conductor ampacity at 75°C (copper, THWN-2)
const AMPACITY_TABLE_75C: Record<string, number> = {
  '#14 AWG': 15,
  '#12 AWG': 20,
  '#10 AWG': 30,
  '#8 AWG':  50,
  '#6 AWG':  65,
  '#4 AWG':  85,
  '#3 AWG':  100,
  '#2 AWG':  115,
  '#1 AWG':  130,
  '#1/0 AWG': 150,
  '#2/0 AWG': 175,
  '#3/0 AWG': 200,
  '#4/0 AWG': 230,
};

// NEC 310.16 — Conductor ampacity at 90°C (copper, USE-2/PV Wire)
const AMPACITY_TABLE_90C: Record<string, number> = {
  '#14 AWG': 25,
  '#12 AWG': 30,
  '#10 AWG': 40,
  '#8 AWG':  55,
  '#6 AWG':  75,
  '#4 AWG':  95,
  '#3 AWG':  115,
  '#2 AWG':  130,
  '#1 AWG':  145,
  '#1/0 AWG': 170,
  '#2/0 AWG': 195,
  '#3/0 AWG': 225,
  '#4/0 AWG': 260,
};

// AWG order from smallest to largest
const AWG_ORDER = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG',
  '#4 AWG', '#3 AWG', '#2 AWG', '#1 AWG',
  '#1/0 AWG', '#2/0 AWG', '#3/0 AWG', '#4/0 AWG',
];

// NEC 310.15(B)(2)(a) — Temperature derating factors (75°C conductors)
function getTempDerating(ambientC: number): number {
  if (ambientC <= 10) return 1.15;
  if (ambientC <= 15) return 1.12;
  if (ambientC <= 20) return 1.08;
  if (ambientC <= 25) return 1.04;
  if (ambientC <= 30) return 1.00;
  if (ambientC <= 35) return 0.96;
  if (ambientC <= 40) return 0.91;
  if (ambientC <= 45) return 0.87;
  if (ambientC <= 50) return 0.82;
  if (ambientC <= 55) return 0.76;
  if (ambientC <= 60) return 0.71;
  return 0.58;
}

// NEC 310.15(C)(1) — Conduit fill derating (current-carrying conductors)
function getConduitDerating(conductorCount: number): number {
  if (conductorCount <= 3) return 1.00;
  if (conductorCount <= 6) return 0.80;
  if (conductorCount <= 9) return 0.70;
  if (conductorCount <= 20) return 0.50;
  if (conductorCount <= 30) return 0.45;
  if (conductorCount <= 40) return 0.40;
  return 0.35;
}

// NEC 240.6 — Standard OCPD sizes
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];

function nextStandardOCPD(amps: number): number {
  return STANDARD_OCPD.find(s => s >= amps) ?? 400;
}

// NEC 250.122 — EGC sizing
function getEGCGauge(ocpdAmps: number): string {
  if (ocpdAmps <= 15)  return '#14 AWG';
  if (ocpdAmps <= 20)  return '#12 AWG';
  if (ocpdAmps <= 60)  return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  if (ocpdAmps <= 300) return '#4 AWG';
  if (ocpdAmps <= 400) return '#3 AWG';
  return '#2 AWG';
}

// NEC Chapter 9 Table 5 — Conductor cross-sectional areas (in²) for THWN-2
const CONDUCTOR_AREA_IN2: Record<string, number> = {
  '#14 AWG': 0.0097,
  '#12 AWG': 0.0133,
  '#10 AWG': 0.0211,
  '#8 AWG':  0.0366,
  '#6 AWG':  0.0507,
  '#4 AWG':  0.0824,
  '#3 AWG':  0.0973,
  '#2 AWG':  0.1158,
  '#1 AWG':  0.1562,
  '#1/0 AWG': 0.1855,
  '#2/0 AWG': 0.2223,
  '#3/0 AWG': 0.2660,
  '#4/0 AWG': 0.3237,
};

// NEC Chapter 9 Table 4 — Conduit internal areas (in²) at 40% fill
// Format: { conduitType: { tradeSize: totalArea } }
const CONDUIT_40PCT_AREA: Record<string, Record<string, number>> = {
  'EMT': {
    '1/2"': 0.122 * 0.40,
    '3/4"': 0.213 * 0.40,
    '1"':   0.346 * 0.40,
    '1-1/4"': 0.598 * 0.40,
    '1-1/2"': 0.814 * 0.40,
    '2"':   1.342 * 0.40,
    '2-1/2"': 2.343 * 0.40,
    '3"':   3.538 * 0.40,
  },
  'PVC Sch 40': {
    '1/2"': 0.122 * 0.40,
    '3/4"': 0.217 * 0.40,
    '1"':   0.355 * 0.40,
    '1-1/4"': 0.610 * 0.40,
    '1-1/2"': 0.829 * 0.40,
    '2"':   1.363 * 0.40,
    '2-1/2"': 2.361 * 0.40,
    '3"':   3.538 * 0.40,
  },
  'PVC Sch 80': {
    '1/2"': 0.093 * 0.40,
    '3/4"': 0.171 * 0.40,
    '1"':   0.285 * 0.40,
    '1-1/4"': 0.508 * 0.40,
    '1-1/2"': 0.695 * 0.40,
    '2"':   1.150 * 0.40,
    '2-1/2"': 2.018 * 0.40,
    '3"':   3.085 * 0.40,
  },
};

// Full conduit areas (100%) for fill % calculation
const CONDUIT_FULL_AREA: Record<string, Record<string, number>> = {
  'EMT': {
    '1/2"': 0.122, '3/4"': 0.213, '1"': 0.346, '1-1/4"': 0.598,
    '1-1/2"': 0.814, '2"': 1.342, '2-1/2"': 2.343, '3"': 3.538,
  },
  'PVC Sch 40': {
    '1/2"': 0.122, '3/4"': 0.217, '1"': 0.355, '1-1/4"': 0.610,
    '1-1/2"': 0.829, '2"': 1.363, '2-1/2"': 2.361, '3"': 3.538,
  },
  'PVC Sch 80': {
    '1/2"': 0.093, '3/4"': 0.171, '1"': 0.285, '1-1/4"': 0.508,
    '1-1/2"': 0.695, '2"': 1.150, '2-1/2"': 2.018, '3"': 3.085,
  },
};

function getSmallestConduit(conduitType: string, totalFillAreaIn2: number): { size: string; fillPct: number } {
  const table = CONDUIT_40PCT_AREA[conduitType] ?? CONDUIT_40PCT_AREA['EMT'];
  const fullTable = CONDUIT_FULL_AREA[conduitType] ?? CONDUIT_FULL_AREA['EMT'];
  const sizes = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"'];
  for (const size of sizes) {
    const maxFill = table[size] ?? 0;
    if (totalFillAreaIn2 <= maxFill) {
      const fullArea = fullTable[size] ?? 1;
      const fillPct = (totalFillAreaIn2 / fullArea) * 100;
      // BUG 2 FIX: Add validation logging for conduit sizing
      console.log(`[CONDUIT SIZING] selected_conduit_size: ${size}, calculated_fill_percent: ${fillPct.toFixed(1)}%`);
      return { size, fillPct };
    }
  }
  const fillPct = (totalFillAreaIn2 / (fullTable['3"'] ?? 3.538)) * 100;
  // BUG 2 FIX: Add validation logging for fallback case
  console.log(`[CONDUIT SIZING] selected_conduit_size: 3", calculated_fill_percent: ${fillPct.toFixed(1)}% (exceeds available sizes)`);
  return { size: '3"', fillPct };
}

// ─── Wire Auto-Sizer ──────────────────────────────────────────────────────────

interface WireSizeResult {
  gauge: string;
  egcGauge: string;
  conduitSize: string;
  conduitFillPct: number;
  effectiveAmpacity: number;
  tempDerating: number;
  conduitDerating: number;
  ocpdAmps: number;
  voltageDropPct: number;
  voltageDropVolts: number;
  ampacityPass: boolean;
  voltageDropPass: boolean;
  conduitFillPass: boolean;
  conductorCallout: string;
}

function calcVoltageDrop(
  currentA: number,
  onewayFt: number,
  gauge: string,
  voltageV: number,
  conductorCount: number = 2  // 2 for DC, 2 for single-phase AC (L-L)
): number {
  // Resistivity: copper at 75°C ≈ 12.9 Ω·cmil/ft
  // Circular mils per gauge
  const CMIL: Record<string, number> = {
    '#14 AWG': 4110, '#12 AWG': 6530, '#10 AWG': 10380, '#8 AWG': 16510,
    '#6 AWG': 26240, '#4 AWG': 41740, '#3 AWG': 52620, '#2 AWG': 66360,
    '#1 AWG': 83690, '#1/0 AWG': 105600, '#2/0 AWG': 133100,
    '#3/0 AWG': 167800, '#4/0 AWG': 211600,
  };
  const cmil = CMIL[gauge] ?? 10380;
  const resistivity = 12.9; // Ω·cmil/ft at 75°C copper
  const resistance = (resistivity * onewayFt * conductorCount) / cmil; // Ω
  const dropV = currentA * resistance;
  return (dropV / voltageV) * 100;
}

function autoSizeWire(
  continuousCurrent: number,
  onewayFt: number,
  conductorCount: number,
  conduitType: string,
  ambientC: number,
  systemVoltage: number,
  maxVDropPct: number,
  isDC: boolean = false,
  startGauge: string = '#10 AWG'
): WireSizeResult {
  const requiredAmpacity = continuousCurrent * 1.25; // NEC 690.8
  const tempDerating = getTempDerating(ambientC);
  const conduitDerating = getConduitDerating(conductorCount);

  const startIdx = Math.max(0, AWG_ORDER.indexOf(startGauge));

  for (let i = startIdx; i < AWG_ORDER.length; i++) {
    const gauge = AWG_ORDER[i];
    const tableAmpacity = isDC
      ? (AMPACITY_TABLE_90C[gauge] ?? 0)
      : (AMPACITY_TABLE_75C[gauge] ?? 0);
    const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
    const ampacityPass = effectiveAmpacity >= requiredAmpacity;

    const vdropPct = calcVoltageDrop(continuousCurrent, onewayFt, gauge, systemVoltage, conductorCount <= 2 ? 2 : 2);
    const vdropPass = vdropPct <= maxVDropPct;

    if (ampacityPass && vdropPass) {
      const ocpdAmps = nextStandardOCPD(requiredAmpacity);
      const egcGauge = getEGCGauge(ocpdAmps);

      // Conduit fill: conductorCount hot + 1 EGC
      // If fill > 40%, upsize wire gauge until fill <= 40%
      let finalGauge = gauge;
      let finalEgcGauge = egcGauge;
      let conduitSize = '';
      let fillPct = 0;

      for (let j = i; j < AWG_ORDER.length; j++) {
        finalGauge = AWG_ORDER[j];
        finalEgcGauge = getEGCGauge(nextStandardOCPD(requiredAmpacity));
        const hotArea = (CONDUCTOR_AREA_IN2[finalGauge] ?? 0.0211) * conductorCount;
        const egcArea = CONDUCTOR_AREA_IN2[finalEgcGauge] ?? 0.0211;
        const totalArea = hotArea + egcArea;
        const result = getSmallestConduit(conduitType, totalArea);
        conduitSize = result.size;
        fillPct = result.fillPct;
        if (fillPct <= 40) break;
      }

      const vdropVolts = (vdropPct / 100) * systemVoltage;
      const gaugeNum = finalGauge.replace('#', '').replace(' AWG', '');
      const egcNum = finalEgcGauge.replace('#', '').replace(' AWG', '');
      const conduitAbbrev = conduitType === 'EMT' ? 'EMT'
        : conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
        : conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
        : conduitType;
      const insulation = isDC ? 'USE-2/PV Wire' : 'THWN-2';
      const conductorCallout = `${conductorCount}#${gaugeNum} AWG ${insulation} + 1#${egcNum} AWG GND in ${conduitSize} ${conduitAbbrev}`;

      return {
        gauge: finalGauge,
        egcGauge: finalEgcGauge,
        conduitSize,
        conduitFillPct: fillPct,
        effectiveAmpacity,
        tempDerating,
        conduitDerating,
        ocpdAmps,
        voltageDropPct: vdropPct,
        voltageDropVolts: vdropVolts,
        ampacityPass: true,
        voltageDropPass: true,
        conduitFillPass: fillPct <= 40,
        conductorCallout,
      };
    }
  }

  // Fallback: largest gauge
  const gauge = '#4/0 AWG';
  const ocpdAmps = nextStandardOCPD(requiredAmpacity);
  const egcGauge = getEGCGauge(ocpdAmps);
  const hotArea = (CONDUCTOR_AREA_IN2[gauge] ?? 0.3237) * conductorCount;
  const egcArea = CONDUCTOR_AREA_IN2[egcGauge] ?? 0.0211;
  const { size: conduitSize, fillPct } = getSmallestConduit(conduitType, hotArea + egcArea);
  const vdropPct = calcVoltageDrop(continuousCurrent, onewayFt, gauge, systemVoltage);
  const vdropVolts = (vdropPct / 100) * systemVoltage;
  const tableAmpacity = isDC ? (AMPACITY_TABLE_90C[gauge] ?? 260) : (AMPACITY_TABLE_75C[gauge] ?? 230);
  const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
  const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
  const egcNum = egcGauge.replace('#', '').replace(' AWG', '');
  const conduitAbbrev = conduitType === 'EMT' ? 'EMT' : conduitType;
  const insulation = isDC ? 'USE-2/PV Wire' : 'THWN-2';

  return {
    gauge,
    egcGauge,
    conduitSize,
    conduitFillPct: fillPct,
    effectiveAmpacity,
    tempDerating,
    conduitDerating: getConduitDerating(conductorCount),
    ocpdAmps,
    voltageDropPct: vdropPct,
    voltageDropVolts: vdropVolts,
    ampacityPass: effectiveAmpacity >= requiredAmpacity,
    voltageDropPass: vdropPct <= maxVDropPct,
    conduitFillPass: fillPct <= 40,
    conductorCallout: `${conductorCount}#${gaugeNum} AWG ${insulation} + 1#${egcNum} AWG GND in ${conduitSize} ${conduitAbbrev}`,
  };
}
// ─── Open-Air Wire Auto-Sizer (BUG 1 FIX) ───────────────────────────────────────────────────────────────────────────────────
// For open-air segments (no conduit), calculate wire sizing without conduit fill constraints
// Uses free-air ampacity (no conduit derating) per NEC 690.31

function autoSizeOpenAirWire(
  continuousCurrent: number,
  onewayFt: number,
  conductorCount: number,
  ambientC: number,
  systemVoltage: number,
  maxVDropPct: number,
  isDC: boolean = false,
  startGauge: string = '#10 AWG'
): WireSizeResult {
  const requiredAmpacity = continuousCurrent * 1.25; // NEC 690.8
  const tempDerating = getTempDerating(ambientC);
  // No conduit derating for open-air (conduitDeratingFactor = 1.0)
  const conduitDerating = 1.0;

  const startIdx = Math.max(0, AWG_ORDER.indexOf(startGauge));

  for (let i = startIdx; i < AWG_ORDER.length; i++) {
    const gauge = AWG_ORDER[i];
    const tableAmpacity = isDC
      ? (AMPACITY_TABLE_90C[gauge] ?? 0)
      : (AMPACITY_TABLE_75C[gauge] ?? 0);
    const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
    const ampacityPass = effectiveAmpacity >= requiredAmpacity;

    const vdropPct = calcVoltageDrop(continuousCurrent, onewayFt, gauge, systemVoltage, conductorCount <= 2 ? 2 : 2);
    const vdropPass = vdropPct <= maxVDropPct;

    if (ampacityPass && vdropPass) {
      const ocpdAmps = nextStandardOCPD(requiredAmpacity);
      const egcGauge = getEGCGauge(ocpdAmps);

      const vdropVolts = (vdropPct / 100) * systemVoltage;
      const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
      const egcNum = egcGauge.replace('#', '').replace(' AWG', '');
      const insulation = isDC ? 'USE-2/PV Wire' : 'THWN-2';
      // Open-air callout with (OPEN AIR) indicator
      const conductorCallout = `${conductorCount}#${gaugeNum} AWG ${insulation} + 1#${egcNum} AWG GND (OPEN AIR)`;

      return {
        gauge,
        egcGauge,
        conduitSize: 'NONE',
        conduitFillPct: 0,
        effectiveAmpacity,
        tempDerating,
        conduitDerating,
        ocpdAmps,
        voltageDropPct: vdropPct,
        voltageDropVolts: vdropVolts,
        ampacityPass: true,
        voltageDropPass: true,
        conduitFillPass: true, // N/A for open-air
        conductorCallout,
      };
    }
  }

  // Fallback: largest gauge
  const gauge = '#4/0 AWG';
  const ocpdAmps = nextStandardOCPD(requiredAmpacity);
  const egcGauge = getEGCGauge(ocpdAmps);
  const vdropPct = calcVoltageDrop(continuousCurrent, onewayFt, gauge, systemVoltage);
  const vdropVolts = (vdropPct / 100) * systemVoltage;
  const tableAmpacity = isDC ? (AMPACITY_TABLE_90C[gauge] ?? 260) : (AMPACITY_TABLE_75C[gauge] ?? 230);
  const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
  const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
  const egcNum = egcGauge.replace('#', '').replace(' AWG', '');
  const insulation = isDC ? 'USE-2/PV Wire' : 'THWN-2';

  return {
    gauge,
    egcGauge,
    conduitSize: 'NONE',
    conduitFillPct: 0,
    effectiveAmpacity,
    tempDerating,
    conduitDerating: 1.0,
    ocpdAmps,
    voltageDropPct: vdropPct,
    voltageDropVolts: vdropVolts,
    ampacityPass: effectiveAmpacity >= requiredAmpacity,
    voltageDropPass: vdropPct <= maxVDropPct,
    conduitFillPass: true, // N/A for open-air
    conductorCallout: `${conductorCount}#${gaugeNum} AWG ${insulation} + 1#${egcNum} AWG GND (OPEN AIR)`,
  };
}

// ─── Main Computation Function ────────────────────────────────────────────────

export function computeSystem(input: ComputedSystemInput): ComputedSystem {
  const issues: ValidationIssue[] = [];
  const isMicro = input.topology === 'micro';
  const isOptimizer = input.topology === 'optimizer';
  const isString = input.topology === 'string' || isOptimizer;

  const topology: TopologyType = isMicro
    ? 'MICROINVERTER'
    : isOptimizer
    ? 'STRING_WITH_OPTIMIZER'
    : 'STRING_INVERTER';

  // ── Panel & Inverter Specs ─────────────────────────────────────────────────
  const panelSpec: EquipmentSpec = {
    id: 'panel',
    manufacturer: input.panelManufacturer,
    model: input.panelModel,
    type: 'panel',
    architecture: topology,
    dcInputs: { maxVoltage: 0, mpptVoltageMin: 0, mpptVoltageMax: 0, maxInputCurrentPerMppt: 0, mpptCount: 0 },
    acOutput: { ratedKw: input.panelWatts / 1000, maxCurrentAmps: input.panelIsc, voltage: 0, phases: 1 },
    modulesPerDevice: 1,
    branchLimit: 0,
    panelWatts: input.panelWatts,
    panelVoc: input.panelVoc,
    panelIsc: input.panelIsc,
    panelVmp: input.panelVmp,
    panelImp: input.panelImp,
    tempCoeffVoc: input.panelTempCoeffVoc,
    tempCoeffIsc: input.panelTempCoeffIsc,
    maxSeriesFuseRating: input.panelMaxSeriesFuse,
  };

  const inverterSpec: EquipmentSpec = {
    id: 'inverter',
    manufacturer: input.inverterManufacturer,
    model: input.inverterModel,
    type: isMicro ? 'microinverter' : isOptimizer ? 'optimizer' : 'string_inverter',
    architecture: topology,
    dcInputs: {
      maxVoltage: input.inverterMaxDcV,
      mpptVoltageMin: input.inverterMpptVmin,
      mpptVoltageMax: input.inverterMpptVmax,
      maxInputCurrentPerMppt: input.inverterMaxInputCurrentPerMppt,
      mpptCount: input.inverterMpptChannels,
    },
    acOutput: {
      ratedKw: input.inverterAcKw,
      maxCurrentAmps: input.inverterAcCurrentMax,
      voltage: 240,
      phases: 1,
    },
    modulesPerDevice: input.inverterModulesPerDevice,
    branchLimit: input.inverterBranchLimit,
  };

  // ── Array Summary ──────────────────────────────────────────────────────────
  const totalDcKw = (input.totalPanels * input.panelWatts) / 1000;
  const totalAcKw = isMicro
    ? (input.totalPanels / input.inverterModulesPerDevice) * input.inverterAcKw
    : input.inverterAcKw;
  const dcAcRatio = totalAcKw > 0 ? totalDcKw / totalAcKw : 0;

  // ── NEC 690.7 — String Voltage Calculation ─────────────────────────────────
  // Voc_corrected = Voc_STC × [1 + (tempCoeffVoc/100) × (Tmin - 25)]
  // tempCoeffVoc is in %/°C (negative), e.g. -0.26
  const tempDelta = input.designTempMin - 25; // negative for cold climates
  const tempCorrectionFactor = 1 + (input.panelTempCoeffVoc / 100) * tempDelta;
  const vocCorrected = input.panelVoc * tempCorrectionFactor;

  // Max panels per string: floor(inverterMaxDcV / vocCorrected)
  const maxPanelsPerString = Math.floor(input.inverterMaxDcV / vocCorrected);

  // ── String Count Calculation ───────────────────────────────────────────────
  let stringCount = 1;
  let panelsPerString = input.totalPanels;
  let lastStringPanels = input.totalPanels;
  const strings: StringCalc[] = [];

  if (isString) {
    // Auto-calculate optimal string count
    // Target: as few strings as possible while staying under maxPanelsPerString
    stringCount = Math.ceil(input.totalPanels / maxPanelsPerString);
    panelsPerString = Math.floor(input.totalPanels / stringCount);
    lastStringPanels = input.totalPanels - panelsPerString * (stringCount - 1);

    // Build per-string calculations
    for (let i = 0; i < stringCount; i++) {
      const pCount = i === stringCount - 1 ? lastStringPanels : panelsPerString;
      const stringVoc = vocCorrected * pCount;
      const stringVmp = input.panelVmp * pCount;
      // Isc correction: Isc_corrected = Isc × [1 + (tempCoeffIsc/100) × (Tmax - 25)]
      // Use max temp for Isc (conservative)
      const iscTempFactor = 1 + (input.panelTempCoeffIsc / 100) * (input.ambientTempC - 25);
      const stringIsc = input.panelIsc * iscTempFactor;
      const ocpdAmps = nextStandardOCPD(stringIsc * 1.25); // NEC 690.8

      const voltagePass = stringVoc <= input.inverterMaxDcV;
      if (!voltagePass) {
        issues.push({
          severity: 'error',
          code: 'NEC_690_7_VOLTAGE',
          message: `String ${i + 1}: Voc ${stringVoc.toFixed(1)}V exceeds inverter max ${input.inverterMaxDcV}V`,
          necReference: 'NEC 690.7',
          autoFixed: false,
          suggestion: `Reduce to max ${maxPanelsPerString} panels per string`,
        });
      }

      strings.push({
        stringIndex: i,
        panelCount: pCount,
        vocSTC: input.panelVoc,
        vocCorrected,
        stringVoc,
        stringVmp,
        stringIsc,
        tempCorrectionFactor,
        designTempMin: input.designTempMin,
        ocpdAmps,
        voltagePass,
        necReference: 'NEC 690.7',
      });
    }
  }

  // ── Microinverter Branch Calculation ──────────────────────────────────────
  const microDeviceCount = isMicro
    ? Math.ceil(input.totalPanels / input.inverterModulesPerDevice)
    : 0;
  const branchLimit = input.inverterBranchLimit || 16; // NEC 690.8(B) default
  const acBranchCount = isMicro ? Math.ceil(microDeviceCount / branchLimit) : 0;

  // Per-micro AC current: inverterAcKw × 1000 / 240V
  const perMicroCurrentA = isMicro ? (input.inverterAcKw * 1000) / 240 : 0;
  const microBranches: MicroBranch[] = [];
  let acBranchCurrentA = 0;
  let acBranchOcpdAmps = 0;

  if (isMicro) {
    // ── Balanced branch distribution ──────────────────────────────────────
    // Distribute microinverters as evenly as possible across branches.
    // e.g. 34 micros / 3 branches → 12 + 11 + 11  (NOT 16 + 16 + 2)
    // Base count = floor(total / branches), remainder branches get +1
    const basePerBranch = Math.floor(microDeviceCount / acBranchCount);
    const remainder     = microDeviceCount % acBranchCount;
    // First `remainder` branches get basePerBranch+1, rest get basePerBranch

    for (let b = 0; b < acBranchCount; b++) {
      const devicesOnBranch = b < remainder ? basePerBranch + 1 : basePerBranch;
      const branchCurrent = devicesOnBranch * perMicroCurrentA;
      const ocpd = nextStandardOCPD(branchCurrent * 1.25); // NEC 690.8

      // Validate: max 16 micros per branch (NEC 690.8(B))
      if (devicesOnBranch > branchLimit) {
        issues.push({
          severity: 'error',
          code: 'NEC_690_8B_BRANCH_LIMIT',
          message: `Branch ${b + 1}: ${devicesOnBranch} microinverters exceeds NEC 690.8(B) limit of ${branchLimit}`,
          necReference: 'NEC 690.8(B)',
          autoFixed: false,
        });
      }

      // Warn if branch is very small (< 4 micros) — may indicate poor design
      if (devicesOnBranch < 4 && acBranchCount > 1) {
        issues.push({
          severity: 'warning',
          code: 'MICRO_BRANCH_UNDERSIZED',
          message: `Branch ${b + 1}: only ${devicesOnBranch} microinverter${devicesOnBranch > 1 ? 's' : ''} — consider consolidating branches`,
          necReference: 'NEC 690.8(B)',
          autoFixed: false,
        });
      }

      const gaugeNum = '#10 AWG'.replace('#', '').replace(' AWG', '');
      microBranches.push({
        branchIndex: b,
        deviceCount: devicesOnBranch,
        branchCurrentA: +branchCurrent.toFixed(2),
        ocpdAmps: ocpd,
        conductorCallout: `3#${gaugeNum} AWG THWN-2 + 1#${gaugeNum} AWG GND`,
        necReference: 'NEC 690.8(B)',
      });
    }
    acBranchCurrentA = microBranches[0]?.branchCurrentA ?? 0;
    acBranchOcpdAmps = microBranches[0]?.ocpdAmps ?? 0;
  }

  // ── AC Electrical ──────────────────────────────────────────────────────────
  const systemVoltageAC = 240;
  const acOutputCurrentA = isMicro
    ? microDeviceCount * perMicroCurrentA
    : (input.inverterAcKw * 1000) / systemVoltageAC;
  const acContinuousCurrentA = acOutputCurrentA * 1.25; // NEC 690.8
  const acOcpdAmps = nextStandardOCPD(acContinuousCurrentA);
  const backfeedBreakerAmps = acOcpdAmps;

  // NEC 705.12(B) — 120% rule: backfeed + main ≤ 1.2 × busRating
  const interconnectionPass = (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
  if (!interconnectionPass) {
    issues.push({
      severity: 'error',
      code: 'NEC_705_12B_120PCT',
      message: `Interconnection: ${backfeedBreakerAmps}A backfeed + ${input.mainPanelAmps}A main = ${backfeedBreakerAmps + input.mainPanelAmps}A > 120% of ${input.panelBusRating}A bus (${Math.round(input.panelBusRating * 1.2)}A max)`,
      necReference: 'NEC 705.12(B)',
      autoFixed: false,
      suggestion: 'Consider supply-side tap (NEC 705.11) or panel upgrade',
    });
  }

  // ── Validate: micro + DC disconnect ───────────────────────────────────────
  // (This is a data validation — the UI should never send dcDisconnect=true for micro)
  if (isMicro) {
    issues.push({
      severity: 'info',
      code: 'MICRO_NO_DC_DISCO',
      message: 'Microinverter system: DC Disconnect (NEC 690.15) not applicable — DC-to-AC conversion at each panel',
      necReference: 'NEC 690.15',
      autoFixed: true,
    });
  }

  // ── Run Lengths (defaults if not specified) ────────────────────────────────
  const rl = input.runLengths;
  const defaultRunLengths: Record<RunSegmentId, number> = {
    DC_STRING_RUN: rl.DC_STRING_RUN ?? 50,
    DC_DISCO_TO_INV_RUN: rl.DC_DISCO_TO_INV_RUN ?? 10,
    ROOF_RUN: rl.ROOF_RUN ?? 30,
    BRANCH_RUN: rl.BRANCH_RUN ?? 50,
    INV_TO_DISCO_RUN: rl.INV_TO_DISCO_RUN ?? 20,
    COMBINER_TO_DISCO_RUN: rl.COMBINER_TO_DISCO_RUN ?? 20,
    DISCO_TO_METER_RUN: rl.DISCO_TO_METER_RUN ?? 15,
    METER_TO_MSP_RUN: rl.METER_TO_MSP_RUN ?? 10,
    MSP_TO_UTILITY_RUN: rl.MSP_TO_UTILITY_RUN ?? 5,
    ARRAY_OPEN_AIR: rl.ARRAY_OPEN_AIR ?? 30,
    ARRAY_CONDUIT_RUN: rl.ARRAY_CONDUIT_RUN ?? 20,
  };

  // ── Wire Sizing for Each Run ───────────────────────────────────────────────
  const runs: RunSegment[] = [];

  if (isMicro) {
    // ROOF_RUN: DC wiring from panels to microinverters (short, low voltage)
    // Each micro has its own DC input — typically #10 AWG PV Wire
    // BUG 1 FIX: Use open-air sizing (no conduit required per NEC 690.31)
    const roofRunAmb = input.ambientTempC + input.rooftopTempAdderC;
    const roofRunCurrent = input.panelIsc * 1.25; // NEC 690.8 per micro
    const roofWire = autoSizeOpenAirWire(
      roofRunCurrent,
      defaultRunLengths.ROOF_RUN,
      2, // 2 conductors (+ and -)
      roofRunAmb,
      input.panelVoc * input.inverterModulesPerDevice, // DC voltage per micro
      input.maxDCVoltageDropPct,
      true, // isDC
      '#10 AWG'
    );
    runs.push(makeRunSegment('ROOF_RUN', 'ROOF RUN (DC to Micro)', 'PV ARRAY', 'MICROINVERTERS', {
      conductorCount: 2,
      wireGauge: roofWire.gauge,
      insulation: 'USE-2/PV Wire',
      egcGauge: roofWire.egcGauge,
      neutralRequired: false,
      isOpenAir: true,
      conduitType: 'NONE',
      conduitSize: roofWire.conduitSize,
      conduitFillPct: roofWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.ROOF_RUN,
      continuousCurrent: roofRunCurrent,
      requiredAmpacity: roofRunCurrent * 1.25,
      effectiveAmpacity: roofWire.effectiveAmpacity,
      tempDeratingFactor: roofWire.tempDerating,
      conduitDeratingFactor: roofWire.conduitDerating,
      ocpdAmps: roofWire.ocpdAmps,
      voltageDropPct: roofWire.voltageDropPct,
      voltageDropVolts: roofWire.voltageDropVolts,
      ampacityPass: roofWire.ampacityPass,
      voltageDropPass: roofWire.voltageDropPass,
      conduitFillPass: roofWire.conduitFillPass,
      necReferences: ['NEC 690.31', 'NEC 690.8'],
      conductorCallout: roofWire.conductorCallout,
      color: 'dc',
    }));

    // BRANCH_RUN: AC trunk cable from microinverters to AC combiner
    // Current = sum of all micro AC outputs on the branch
    // BUG 1 FIX: Use open-air sizing (no conduit until junction box per NEC 690.31)
    const branchWire = autoSizeOpenAirWire(
      acBranchCurrentA,
      defaultRunLengths.BRANCH_RUN,
      3, // L1, L2, N
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#10 AWG'
    );
    runs.push(makeRunSegment('BRANCH_RUN', 'BRANCH RUN (AC Trunk)', 'MICROINVERTERS', 'AC COMBINER', {
      conductorCount: 3,
      wireGauge: branchWire.gauge,
      insulation: 'THWN-2',
      egcGauge: branchWire.egcGauge,
      neutralRequired: true,
      isOpenAir: true,
      conduitType: 'NONE',
      conduitSize: branchWire.conduitSize,
      conduitFillPct: branchWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.BRANCH_RUN,
      continuousCurrent: acBranchCurrentA,
      requiredAmpacity: acBranchCurrentA * 1.25,
      effectiveAmpacity: branchWire.effectiveAmpacity,
      tempDeratingFactor: branchWire.tempDerating,
      conduitDeratingFactor: branchWire.conduitDerating,
      ocpdAmps: acBranchOcpdAmps,
      voltageDropPct: branchWire.voltageDropPct,
      voltageDropVolts: branchWire.voltageDropVolts,
      ampacityPass: branchWire.ampacityPass,
      voltageDropPass: branchWire.voltageDropPass,
      conduitFillPass: branchWire.conduitFillPct <= 40,
      necReferences: ['NEC 690.8', 'NEC 690.8(B)', 'NEC 310.15'],
      conductorCallout: branchWire.conductorCallout,
      color: 'ac',
    }));

    // COMBINER_TO_DISCO_RUN: AC combiner to AC disconnect
    const combToDiscoWire = autoSizeWire(
      acOutputCurrentA,
      defaultRunLengths.COMBINER_TO_DISCO_RUN,
      3,
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#10 AWG'
    );
    runs.push(makeRunSegment('COMBINER_TO_DISCO_RUN', 'COMBINER TO AC DISCO', 'AC COMBINER', 'AC DISCONNECT', {
      conductorCount: 3,
      wireGauge: combToDiscoWire.gauge,
      insulation: 'THWN-2',
      egcGauge: combToDiscoWire.egcGauge,
      neutralRequired: true,
      conduitType: input.conduitType,
      conduitSize: combToDiscoWire.conduitSize,
      conduitFillPct: combToDiscoWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.COMBINER_TO_DISCO_RUN,
      continuousCurrent: acOutputCurrentA,
      requiredAmpacity: acContinuousCurrentA,
      effectiveAmpacity: combToDiscoWire.effectiveAmpacity,
      tempDeratingFactor: combToDiscoWire.tempDerating,
      conduitDeratingFactor: combToDiscoWire.conduitDerating,
      ocpdAmps: acOcpdAmps,
      voltageDropPct: combToDiscoWire.voltageDropPct,
      voltageDropVolts: combToDiscoWire.voltageDropVolts,
      ampacityPass: combToDiscoWire.ampacityPass,
      voltageDropPass: combToDiscoWire.voltageDropPass,
      conduitFillPass: combToDiscoWire.conduitFillPct <= 40,
      necReferences: ['NEC 690.8', 'NEC 310.15'],
      conductorCallout: combToDiscoWire.conductorCallout,
      color: 'ac',
    }));

  } else {
    // STRING INVERTER RUNS

    // DC_STRING_RUN: PV array to DC disconnect
    const dcRunAmb = input.ambientTempC + input.rooftopTempAdderC;
    const dcStringCurrent = strings[0]?.stringIsc ?? (input.panelIsc * 1.25);
    const dcWire = autoSizeWire(
      dcStringCurrent,
      defaultRunLengths.DC_STRING_RUN,
      2,
      input.conduitType,
      dcRunAmb,
      strings[0]?.stringVmp ?? (input.panelVmp * panelsPerString),
      input.maxDCVoltageDropPct,
      true,
      '#10 AWG'
    );
    runs.push(makeRunSegment('DC_STRING_RUN', 'DC STRING RUN (PV Wire)', 'PV ARRAY', 'DC DISCONNECT', {
      conductorCount: 2,
      wireGauge: dcWire.gauge,
      insulation: 'USE-2/PV Wire',
      egcGauge: dcWire.egcGauge,
      neutralRequired: false,
      conduitType: input.conduitType,
      conduitSize: dcWire.conduitSize,
      conduitFillPct: dcWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.DC_STRING_RUN,
      continuousCurrent: dcStringCurrent,
      requiredAmpacity: dcStringCurrent * 1.25,
      effectiveAmpacity: dcWire.effectiveAmpacity,
      tempDeratingFactor: dcWire.tempDerating,
      conduitDeratingFactor: dcWire.conduitDerating,
      ocpdAmps: strings[0]?.ocpdAmps ?? dcWire.ocpdAmps,
      voltageDropPct: dcWire.voltageDropPct,
      voltageDropVolts: dcWire.voltageDropVolts,
      ampacityPass: dcWire.ampacityPass,
      voltageDropPass: dcWire.voltageDropPass,
      conduitFillPass: dcWire.conduitFillPct <= 40,
      necReferences: ['NEC 690.31', 'NEC 690.8', 'NEC 690.7'],
      conductorCallout: dcWire.conductorCallout,
      color: 'dc',
    }));

    // DC_DISCO_TO_INV_RUN: DC disconnect to inverter
    const dcDiscoWire = autoSizeWire(
      dcStringCurrent,
      defaultRunLengths.DC_DISCO_TO_INV_RUN,
      2,
      input.conduitType,
      dcRunAmb,
      strings[0]?.stringVmp ?? (input.panelVmp * panelsPerString),
      input.maxDCVoltageDropPct,
      true,
      '#10 AWG'
    );
    runs.push(makeRunSegment('DC_DISCO_TO_INV_RUN', 'DC DISCO TO INVERTER', 'DC DISCONNECT', 'STRING INVERTER', {
      conductorCount: 2,
      wireGauge: dcDiscoWire.gauge,
      insulation: 'USE-2/PV Wire',
      egcGauge: dcDiscoWire.egcGauge,
      neutralRequired: false,
      conduitType: input.conduitType,
      conduitSize: dcDiscoWire.conduitSize,
      conduitFillPct: dcDiscoWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.DC_DISCO_TO_INV_RUN,
      continuousCurrent: dcStringCurrent,
      requiredAmpacity: dcStringCurrent * 1.25,
      effectiveAmpacity: dcDiscoWire.effectiveAmpacity,
      tempDeratingFactor: dcDiscoWire.tempDerating,
      conduitDeratingFactor: dcDiscoWire.conduitDerating,
      ocpdAmps: strings[0]?.ocpdAmps ?? dcDiscoWire.ocpdAmps,
      voltageDropPct: dcDiscoWire.voltageDropPct,
      voltageDropVolts: dcDiscoWire.voltageDropVolts,
      ampacityPass: dcDiscoWire.ampacityPass,
      voltageDropPass: dcDiscoWire.voltageDropPass,
      conduitFillPass: dcDiscoWire.conduitFillPct <= 40,
      necReferences: ['NEC 690.31', 'NEC 690.8'],
      conductorCallout: dcDiscoWire.conductorCallout,
      color: 'dc',
    }));

    // INV_TO_DISCO_RUN: Inverter to AC disconnect
    const invToDiscoWire = autoSizeWire(
      acOutputCurrentA,
      defaultRunLengths.INV_TO_DISCO_RUN,
      3,
      input.conduitType,
      input.ambientTempC,
      systemVoltageAC,
      input.maxACVoltageDropPct,
      false,
      '#10 AWG'
    );
    runs.push(makeRunSegment('INV_TO_DISCO_RUN', 'INVERTER TO AC DISCO', 'STRING INVERTER', 'AC DISCONNECT', {
      conductorCount: 3,
      wireGauge: invToDiscoWire.gauge,
      insulation: 'THWN-2',
      egcGauge: invToDiscoWire.egcGauge,
      neutralRequired: true,
      conduitType: input.conduitType,
      conduitSize: invToDiscoWire.conduitSize,
      conduitFillPct: invToDiscoWire.conduitFillPct,
      onewayLengthFt: defaultRunLengths.INV_TO_DISCO_RUN,
      continuousCurrent: acOutputCurrentA,
      requiredAmpacity: acContinuousCurrentA,
      effectiveAmpacity: invToDiscoWire.effectiveAmpacity,
      tempDeratingFactor: invToDiscoWire.tempDerating,
      conduitDeratingFactor: invToDiscoWire.conduitDerating,
      ocpdAmps: acOcpdAmps,
      voltageDropPct: invToDiscoWire.voltageDropPct,
      voltageDropVolts: invToDiscoWire.voltageDropVolts,
      ampacityPass: invToDiscoWire.ampacityPass,
      voltageDropPass: invToDiscoWire.voltageDropPass,
      conduitFillPass: invToDiscoWire.conduitFillPct <= 40,
      necReferences: ['NEC 690.8', 'NEC 310.15'],
      conductorCallout: invToDiscoWire.conductorCallout,
      color: 'ac',
    }));
  }

  // ── Common AC Runs (both topologies) ──────────────────────────────────────

  // DISCO_TO_METER_RUN
  const discoToMeterWire = autoSizeWire(
    acOutputCurrentA,
    defaultRunLengths.DISCO_TO_METER_RUN,
    3,
    input.conduitType,
    input.ambientTempC,
    systemVoltageAC,
    input.maxACVoltageDropPct,
    false,
    '#10 AWG'
  );
  runs.push(makeRunSegment('DISCO_TO_METER_RUN', 'AC DISCO TO METER', 'AC DISCONNECT', 'PRODUCTION METER', {
    conductorCount: 3,
    wireGauge: discoToMeterWire.gauge,
    insulation: 'THWN-2',
    egcGauge: discoToMeterWire.egcGauge,
    neutralRequired: true,
    conduitType: input.conduitType,
    conduitSize: discoToMeterWire.conduitSize,
    conduitFillPct: discoToMeterWire.conduitFillPct,
    onewayLengthFt: defaultRunLengths.DISCO_TO_METER_RUN,
    continuousCurrent: acOutputCurrentA,
    requiredAmpacity: acContinuousCurrentA,
    effectiveAmpacity: discoToMeterWire.effectiveAmpacity,
    tempDeratingFactor: discoToMeterWire.tempDerating,
    conduitDeratingFactor: discoToMeterWire.conduitDerating,
    ocpdAmps: acOcpdAmps,
    voltageDropPct: discoToMeterWire.voltageDropPct,
    voltageDropVolts: discoToMeterWire.voltageDropVolts,
    ampacityPass: discoToMeterWire.ampacityPass,
    voltageDropPass: discoToMeterWire.voltageDropPass,
    conduitFillPass: discoToMeterWire.conduitFillPct <= 40,
    necReferences: ['NEC 310.15'],
    conductorCallout: discoToMeterWire.conductorCallout,
    color: 'ac',
  }));

  // METER_TO_MSP_RUN
  const meterToMspWire = autoSizeWire(
    acOutputCurrentA,
    defaultRunLengths.METER_TO_MSP_RUN,
    3,
    input.conduitType,
    input.ambientTempC,
    systemVoltageAC,
    input.maxACVoltageDropPct,
    false,
    '#10 AWG'
  );
  runs.push(makeRunSegment('METER_TO_MSP_RUN', 'METER TO MSP', 'PRODUCTION METER', 'MAIN SERVICE PANEL', {
    conductorCount: 3,
    wireGauge: meterToMspWire.gauge,
    insulation: 'THWN-2',
    egcGauge: meterToMspWire.egcGauge,
    neutralRequired: true,
    conduitType: input.conduitType,
    conduitSize: meterToMspWire.conduitSize,
    conduitFillPct: meterToMspWire.conduitFillPct,
    onewayLengthFt: defaultRunLengths.METER_TO_MSP_RUN,
    continuousCurrent: acOutputCurrentA,
    requiredAmpacity: acContinuousCurrentA,
    effectiveAmpacity: meterToMspWire.effectiveAmpacity,
    tempDeratingFactor: meterToMspWire.tempDerating,
    conduitDeratingFactor: meterToMspWire.conduitDerating,
    ocpdAmps: acOcpdAmps,
    voltageDropPct: meterToMspWire.voltageDropPct,
    voltageDropVolts: meterToMspWire.voltageDropVolts,
    ampacityPass: meterToMspWire.ampacityPass,
    voltageDropPass: meterToMspWire.voltageDropPass,
    conduitFillPass: meterToMspWire.conduitFillPct <= 40,
    necReferences: ['NEC 310.15', 'NEC 705.12'],
    conductorCallout: meterToMspWire.conductorCallout,
    color: 'ac',
  }));

  // MSP_TO_UTILITY_RUN
  const mspToUtilWire = autoSizeWire(
    acOutputCurrentA,
    defaultRunLengths.MSP_TO_UTILITY_RUN,
    3,
    input.conduitType,
    input.ambientTempC,
    systemVoltageAC,
    input.maxACVoltageDropPct,
    false,
    '#10 AWG'
  );
  runs.push(makeRunSegment('MSP_TO_UTILITY_RUN', 'MSP TO UTILITY', 'MAIN SERVICE PANEL', 'UTILITY GRID', {
    conductorCount: 3,
    wireGauge: mspToUtilWire.gauge,
    insulation: 'THWN-2',
    egcGauge: mspToUtilWire.egcGauge,
    neutralRequired: true,
    conduitType: input.conduitType,
    conduitSize: mspToUtilWire.conduitSize,
    conduitFillPct: mspToUtilWire.conduitFillPct,
    onewayLengthFt: defaultRunLengths.MSP_TO_UTILITY_RUN,
    continuousCurrent: acOutputCurrentA,
    requiredAmpacity: acContinuousCurrentA,
    effectiveAmpacity: mspToUtilWire.effectiveAmpacity,
    tempDeratingFactor: mspToUtilWire.tempDerating,
    conduitDeratingFactor: mspToUtilWire.conduitDerating,
    ocpdAmps: acOcpdAmps,
    voltageDropPct: mspToUtilWire.voltageDropPct,
    voltageDropVolts: mspToUtilWire.voltageDropVolts,
    ampacityPass: mspToUtilWire.ampacityPass,
    voltageDropPass: mspToUtilWire.voltageDropPass,
    conduitFillPass: mspToUtilWire.conduitFillPct <= 40,
    necReferences: ['NEC 310.15'],
    conductorCallout: mspToUtilWire.conductorCallout,
    color: 'ac',
  }));

  // ── Validate conduit fill on all runs ─────────────────────────────────────
  for (const run of runs) {
    if (!run.conduitFillPass) {
      issues.push({
        severity: 'error',
        code: 'NEC_CH9_CONDUIT_FILL',
        message: `${run.label}: Conduit fill ${run.conduitFillPct.toFixed(1)}% exceeds 40% limit in ${run.conduitSize} ${run.conduitType}`,
        necReference: 'NEC Chapter 9 Table 1',
        autoFixed: false,
        suggestion: 'Upsize conduit or reduce conductor count',
      });
    }
  }

  // ── Run Map ────────────────────────────────────────────────────────────────
  const runMap = {} as Record<RunSegmentId, RunSegment>;
  for (const run of runs) {
    runMap[run.id] = run;
  }

  // ── Build Segment Schedule (canonical conductor bundle logic) ──────────────
  // buildSegmentSchedule() is the single source of truth for ALL wiring.
  // SLD, conduit sizing, and BOM must all derive from this output.
  const segmentScheduleInput: SegmentScheduleInput = {
    topology: input.topology,
    moduleCount: input.totalPanels,
    maxDevicesPerBranch: input.inverterBranchLimit || 16,
    microAcCurrentA: isMicro ? perMicroCurrentA : 0,
    stringCount: isString ? stringCount : 0,
    stringCurrentA: isString ? (strings[0]?.stringIsc ?? input.panelIsc * 1.25) : 0,
    systemVoltageAC,
    acOutputCurrentA,
    feederGauge: '#10 AWG',   // will be auto-sized inside buildSegmentSchedule
    egcGauge: '#10 AWG',      // will be auto-sized inside buildSegmentSchedule
    conduitType: input.conduitType,
    runLengths: {
      arrayToJbox:      defaultRunLengths.ARRAY_OPEN_AIR,
      jboxToCombiner:   defaultRunLengths.ARRAY_CONDUIT_RUN,
      jboxToInverter:   defaultRunLengths.DC_STRING_RUN,
      combinerToDisco:  defaultRunLengths.COMBINER_TO_DISCO_RUN,
      inverterToDisco:  defaultRunLengths.INV_TO_DISCO_RUN,
      discoToMeter:     defaultRunLengths.DISCO_TO_METER_RUN,
      meterToMsp:       defaultRunLengths.METER_TO_MSP_RUN,
      mspToUtility:     defaultRunLengths.MSP_TO_UTILITY_RUN,
    },
    ambientTempC: input.ambientTempC,
    rooftopTempAdderC: input.rooftopTempAdderC,
    maxACVoltageDropPct: input.maxACVoltageDropPct,
    maxDCVoltageDropPct: input.maxDCVoltageDropPct,
  };
  const segmentSchedule = buildSegmentSchedule(segmentScheduleInput);

  // Back-populate conductorBundle and update conductorCallout on each RunSegment
  // Map segment types to RunSegmentIds for cross-reference
  const segTypeToRunId: Record<string, string> = {
    'ARRAY_TO_JBOX':     isMicro ? 'BRANCH_RUN' : 'DC_STRING_RUN',
    'JBOX_TO_COMBINER':  'BRANCH_RUN',
    'JBOX_TO_INVERTER':  'DC_DISCO_TO_INV_RUN',
    'COMBINER_TO_DISCO': 'COMBINER_TO_DISCO_RUN',
    'INVERTER_TO_DISCO': 'INV_TO_DISCO_RUN',
    'DISCO_TO_METER':    'DISCO_TO_METER_RUN',
    'METER_TO_MSP':      'METER_TO_MSP_RUN',
    'MSP_TO_UTILITY':    'MSP_TO_UTILITY_RUN',
  };
  for (const seg of segmentSchedule) {
    const runId = segTypeToRunId[seg.segmentType];
    if (runId && runMap[runId as RunSegmentId]) {
      const run = runMap[runId as RunSegmentId];
      run.conductorBundle = seg.conductorBundle;
      // Update conductorCallout to use the new bundle format
      run.conductorCallout = seg.conductorCallout;
    }
  }

  // ── Conduit Schedule ──────────────────────────────────────────────────────
  const conduitSchedule: ConduitScheduleRow[] = runs.map((run, idx) => ({
    raceway: `C-${idx + 1}`,
    from: run.from,
    to: run.to,
    conduitType: run.conduitType,
    conduitSize: run.conduitSize,
    conductors: `${run.conductorCount}#${run.wireGauge.replace('#', '').replace(' AWG', '')} AWG ${run.insulation}`,
    egc: `1#${run.egcGauge.replace('#', '').replace(' AWG', '')} AWG GND`,
    neutral: run.neutralRequired ? `1#${run.wireGauge.replace('#', '').replace(' AWG', '')} AWG N` : 'N/A',
    lengthFt: run.onewayLengthFt,
    fillPct: Math.round(run.conduitFillPct),
    ampacity: `${run.effectiveAmpacity.toFixed(0)}A`,
    ocpd: `${run.ocpdAmps}A`,
    voltageDrop: `${run.voltageDropPct.toFixed(1)}%`,
    pass: run.overallPass,
  }));

  // ── Equipment Schedule ────────────────────────────────────────────────────
  const equipmentSchedule: EquipmentScheduleRow[] = [];

  if (isMicro) {
    equipmentSchedule.push(
      { tag: 'PV-1', description: 'PV Modules', manufacturer: input.panelManufacturer, model: input.panelModel, qty: input.totalPanels, rating: `${input.panelWatts}W`, necReference: 'NEC 690.4' },
      { tag: 'MICRO-1', description: 'Microinverters', manufacturer: input.inverterManufacturer, model: input.inverterModel, qty: microDeviceCount, rating: `${(input.inverterAcKw * 1000).toFixed(0)}W AC`, necReference: 'NEC 690.4' },
      { tag: 'COMB-1', description: 'AC Combiner / IQ Combiner', manufacturer: input.inverterManufacturer, model: 'IQ Combiner 4C', qty: 1, rating: `${acOcpdAmps}A`, necReference: 'NEC 690.9' },
      { tag: 'AC-DISC-1', description: 'AC Disconnect', manufacturer: '', model: 'Non-Fused AC Disconnect', qty: 1, rating: `${acOcpdAmps}A / 240V`, necReference: 'NEC 690.14' },
      { tag: 'METER-1', description: 'Production Meter', manufacturer: 'Utility', model: 'Revenue Grade Meter', qty: 1, rating: '240V AC', necReference: 'NEC 705.12' },
      { tag: 'MSP-1', description: 'Main Service Panel', manufacturer: input.mainPanelBrand, model: `${input.mainPanelAmps}A Panel`, qty: 1, rating: `${input.mainPanelAmps}A / 120/240V`, necReference: 'NEC 705.12(B)' },
    );
  } else {
    equipmentSchedule.push(
      { tag: 'PV-1', description: 'PV Modules', manufacturer: input.panelManufacturer, model: input.panelModel, qty: input.totalPanels, rating: `${input.panelWatts}W`, necReference: 'NEC 690.4' },
      { tag: 'INV-1', description: 'String Inverter', manufacturer: input.inverterManufacturer, model: input.inverterModel, qty: 1, rating: `${input.inverterAcKw}kW AC`, necReference: 'NEC 690.4' },
      { tag: 'DC-DISC-1', description: 'DC Disconnect', manufacturer: '', model: 'DC Disconnect Switch', qty: 1, rating: `${strings[0]?.ocpdAmps ?? 20}A / ${Math.round(strings[0]?.stringVoc ?? 600)}V DC`, necReference: 'NEC 690.15' },
      { tag: 'AC-DISC-1', description: 'AC Disconnect', manufacturer: '', model: 'Non-Fused AC Disconnect', qty: 1, rating: `${acOcpdAmps}A / 240V`, necReference: 'NEC 690.14' },
      { tag: 'METER-1', description: 'Production Meter', manufacturer: 'Utility', model: 'Revenue Grade Meter', qty: 1, rating: '240V AC', necReference: 'NEC 705.12' },
      { tag: 'MSP-1', description: 'Main Service Panel', manufacturer: input.mainPanelBrand, model: `${input.mainPanelAmps}A Panel`, qty: 1, rating: `${input.mainPanelAmps}A / 120/240V`, necReference: 'NEC 705.12(B)' },
    );
  }

  // ── BoM Quantities ────────────────────────────────────────────────────────
  // Wire quantities: runLength × conductorCount × 1.15 (15% waste factor)
  const WASTE_FACTOR = 1.15;

  function wireQtyByGauge(gauge: string): number {
    return runs
      .filter(r => r.wireGauge === gauge)
      .reduce((sum, r) => sum + r.onewayLengthFt * r.conductorCount * WASTE_FACTOR, 0);
  }

  function conduitQtyByType(type: string): number {
    return runs
      .filter(r => r.conduitType === type)
      .reduce((sum, r) => sum + r.onewayLengthFt * WASTE_FACTOR, 0);
  }

  // Segment-based BOM quantities (canonical — uses conductorBundle[])
  const segBOM = calcBOMFromSegments(segmentSchedule, input.conduitType);

  const bomQuantities: BomQuantities = {
    panels: input.totalPanels,
    panelModel: `${input.panelManufacturer} ${input.panelModel}`,
    inverters: isMicro ? microDeviceCount : 1,
    inverterModel: `${input.inverterManufacturer} ${input.inverterModel}`,
    // Micro-specific
    acCombiner: isMicro ? 1 : 0,
    trunkCable: isMicro ? Math.round(defaultRunLengths.BRANCH_RUN * acBranchCount * WASTE_FACTOR) : 0,
    trunkCableTerminators: isMicro ? acBranchCount * 2 : 0,
    acBranchOcpd: isMicro ? acBranchCount : 0,
    // String-specific
    dcDisconnect: isMicro ? 0 : 1,
    dcOcpd: isMicro ? 0 : stringCount,
    // Common
    acDisconnect: 1,
    productionMeter: 1,
    // Conduit — derived from segmentSchedule (canonical, 1.15 slack factor)
    conduitEMT: Math.round(segBOM.conduitByType['EMT'] ?? conduitQtyByType('EMT')),
    conduitPVC: Math.round((segBOM.conduitByType['PVC Sch 40'] ?? 0) + (segBOM.conduitByType['PVC Sch 80'] ?? 0) || conduitQtyByType('PVC Sch 40') + conduitQtyByType('PVC Sch 80')),
    // Wire by gauge — derived from segmentSchedule conductorBundle[] (canonical)
    wire10AWG: Math.round(segBOM.wireByGauge['#10 AWG'] ?? wireQtyByGauge('#10 AWG')),
    wire8AWG:  Math.round(segBOM.wireByGauge['#8 AWG']  ?? wireQtyByGauge('#8 AWG')),
    wire6AWG:  Math.round(segBOM.wireByGauge['#6 AWG']  ?? wireQtyByGauge('#6 AWG')),
    wire4AWG:  Math.round(segBOM.wireByGauge['#4 AWG']  ?? wireQtyByGauge('#4 AWG')),
    // Racking (rough estimates — layout engine provides exact)
    railSections: Math.ceil(input.totalPanels / 4),
    midClamps: input.totalPanels * 2,
    endClamps: Math.ceil(input.totalPanels / 4) * 4,
    lFeet: Math.ceil(input.totalPanels / 2),
    lagBolts: Math.ceil(input.totalPanels / 2) * 2,
    flashings: Math.ceil(input.totalPanels / 2),
  };

  // ── Final Validation Summary ───────────────────────────────────────────────
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const autoFixCount = issues.filter(i => i.autoFixed).length;

  // ── DEBUG_ENGINEERING structured logging ──────────────────────────────────
  if (process.env.DEBUG_ENGINEERING === '1' || process.env.NODE_ENV === 'development') {
    const primaryAcRun = runs.find(r =>
      r.id === 'COMBINER_TO_DISCO_RUN' || r.id === 'INV_TO_DISCO_RUN'
    );
    console.log('[DEBUG_ENGINEERING]', JSON.stringify({
      ts:              new Date().toISOString(),
      topology,
      totalPanels:     input.totalPanels,
      systemVoltageAC,
      acOutputCurrentA:    +acOutputCurrentA.toFixed(2),
      acContinuousCurrentA: +acContinuousCurrentA.toFixed(2),
      acOcpdAmps,
      primaryAcRun: primaryAcRun ? {
        id:             primaryAcRun.id,
        wireGauge:      primaryAcRun.wireGauge,
        egcGauge:       primaryAcRun.egcGauge,
        conduitSize:    primaryAcRun.conduitSize,
        conduitFillPct: +( primaryAcRun.conduitFillPct ?? 0).toFixed(1),
        ocpdAmps:       primaryAcRun.ocpdAmps,
        ampacityPass:   primaryAcRun.ampacityPass,
        voltageDropPct: +( primaryAcRun.voltageDropPct ?? 0).toFixed(2),
      } : null,
      runs: runs.map(r => ({
        id:          r.id,
        wireGauge:   r.wireGauge,
        egcGauge:    r.egcGauge,
        conduitSize: r.conduitSize,
        fillPct:     +( r.conduitFillPct ?? 0).toFixed(1),
        ocpdAmps:    r.ocpdAmps,
      })),
      errorCount,
      warningCount,
      issues: issues.map(i => ({ severity: i.severity, code: i.code, autoFixed: i.autoFixed })),
    }));
  }

  // ─── BUG 6 FIX: Data Propagation Validation ─────────────────────────────────────────────────────────────────────────────
  // Verify all engineering outputs reference the same runSegments[] data source

  // Check 1: Conduit schedule synchronized with runSegments
  const runsWithConduit = runs.filter(r => r.conduitType !== 'NONE' && r.conduitSize !== 'NONE');
  if (conduitSchedule.length > 0 && runsWithConduit.length !== conduitSchedule.length) {
    issues.push({
      severity: 'warning',
      code: 'ENGINEERING_STATE_DESYNC',
      message: `Conduit schedule (${conduitSchedule.length}) does not match runSegments with conduit (${runsWithConduit.length})`,
      necReference: 'DATA_INTEGRITY',
      autoFixed: false,
    });
    console.warn('[ENGINEERING_STATE_DESYNC] Conduit schedule mismatch');
  }

  // Check 2: BOM quantities derived from runSegments
  if (bomQuantities.trunkCable > 0 && isMicro) {
    const branchRun = runs.find(r => r.id === 'BRANCH_RUN');
    if (branchRun) {
      const expectedTrunkCable = Math.round(branchRun.onewayLengthFt * acBranchCount * 1.15);
      if (Math.abs(bomQuantities.trunkCable - expectedTrunkCable) > 20) {
        issues.push({
          severity: 'info',
          code: 'BOM_DERIVATION_CHECK',
          message: `BOM trunk cable (${bomQuantities.trunkCable}ft) differs from calculated (${expectedTrunkCable}ft)`,
          necReference: 'DATA_DERIVATION',
          autoFixed: false,
        });
      }
    }
  }

  console.log(`[DATA_PROPAGATION] Validated: ${runs.length} runSegments -> ${conduitSchedule.length} conduit rows -> ${equipmentSchedule.length} equipment items`);

  // ─────────────────────────────────────────────────────────────────────────

  return {
    topology,
    isMicro,
    isString,
    isOptimizer,
    inverterSpec,
    panelSpec,
    totalPanels: input.totalPanels,
    totalDcKw,
    totalAcKw,
    dcAcRatio,
    stringCount,
    panelsPerString,
    lastStringPanels,
    maxPanelsPerString,
    strings,
    microDeviceCount,
    acBranchCount,
    microBranches,
    acBranchCurrentA,
    acBranchOcpdAmps,
    systemVoltageAC,
    acOutputCurrentA,
    acContinuousCurrentA,
    acOcpdAmps,
    backfeedBreakerAmps,
    interconnectionPass,
    runs,
    runMap,
    segmentSchedule,
    conduitSchedule,
    equipmentSchedule,
    bomQuantities,
    issues,
    errorCount,
    warningCount,
    autoFixCount,
    isValid: errorCount === 0,
    computedAt: new Date().toISOString(),
    designTempMin: input.designTempMin,
    ambientTempC: input.ambientTempC,
    rooftopTempAdderC: input.rooftopTempAdderC,
  };
}

// ─── Helper: Make RunSegment ──────────────────────────────────────────────────

function makeRunSegment(
  id: RunSegmentId,
  label: string,
  from: string,
  to: string,
  fields: Omit<RunSegment, 'id' | 'label' | 'from' | 'to' | 'conductorMaterial' | 'overallPass'>
): RunSegment {
  const ampacityPass = fields.ampacityPass ?? true;
  const voltageDropPass = fields.voltageDropPass ?? true;
  const conduitFillPass = fields.conduitFillPass ?? true;
  const isOpenAir = fields.isOpenAir ?? false;
  return {
    id,
    label,
    from,
    to,
    conductorMaterial: 'CU',
    overallPass: ampacityPass && voltageDropPass && conduitFillPass,
    ...fields,
  };
}

// ─── Convenience: Build Input from Engineering Page Config ────────────────────

export interface EngineeringPageConfig {
  topology: 'string' | 'micro' | 'optimizer';
  totalPanels: number;
  panelId: string;
  inverterId: string;
  inverterType: 'string' | 'micro' | 'optimizer';
  deviceRatioOverride?: number;
  conduitType: string;
  wireLength: number;
  mainPanelAmps: number;
  mainPanelBrand: string;
  panelBusRating: number;
  designTempMin?: number;
  ambientTempC?: number;
  rooftopTempAdderC?: number;
  runLengths?: Partial<Record<RunSegmentId, number>>;
}

// ─── Export helper for system voltage ────────────────────────────────────────
export const SYSTEM_VOLTAGE_AC = 240;

// ─── Re-export for convenience ────────────────────────────────────────────────
export { nextStandardOCPD, getEGCGauge, getTempDerating, getConduitDerating, getSmallestConduit };