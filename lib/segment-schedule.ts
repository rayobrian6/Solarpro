// ============================================================
// Segment Schedule Builder — Canonical Conductor Bundle Logic
// buildSegmentSchedule(systemTopology) is the single source of
// truth for ALL wiring. SLD, conduit sizing, and BOM must all
// derive from this output.
//
// NEC References:
//   690.31   — PV source/output circuit wiring methods
//   690.8    — Circuit sizing (125% continuous load)
//   690.8(B) — AC branch circuit limits
//   310.15   — Ampacity tables
//   250.122  — EGC sizing
//   Ch9 T4   — Conduit internal areas
//   Ch9 T5   — Conductor cross-sectional areas
// ============================================================

// ─── Conductor Bundle ────────────────────────────────────────────────────────
// Represents one or more identical conductors in a raceway

export interface ConductorBundle {
  qty: number;           // number of conductors of this type
  gauge: string;         // '#10 AWG', '#6 AWG', etc.
  color: 'BLK' | 'RED' | 'WHT' | 'GRN' | 'BLU' | 'GRY';
  insulation: string;    // 'THWN-2' | 'USE-2/PV Wire' | 'XHHW-2'
  isCurrentCarrying: boolean; // false for EGC/neutral (affects derating)
  currentPerConductor: number; // A — for derating calculation
}

// ─── Segment Types ───────────────────────────────────────────────────────────

export type SegmentType =
  | 'ARRAY_TO_JBOX'          // modules → junction box (open air)
  | 'JBOX_TO_COMBINER'       // junction box → AC combiner (conduit)
  | 'JBOX_TO_INVERTER'       // junction box → string inverter (conduit)
  | 'COMBINER_TO_DISCO'      // AC combiner → AC disconnect (conduit)
  | 'INVERTER_TO_DISCO'      // string inverter → AC disconnect (conduit)
  | 'DISCO_TO_METER'         // AC disconnect → production meter (conduit)
  | 'METER_TO_MSP'           // production meter → MSP (conduit)
  | 'MSP_TO_UTILITY';        // MSP → utility grid (conduit)

export type RacewayType = 'OPEN_AIR' | 'EMT' | 'PVC_SCH40' | 'PVC_SCH80' | 'RMC';

// ─── Segment Schedule Row ────────────────────────────────────────────────────

export interface SegmentScheduleRow {
  id: string;                  // unique identifier e.g. 'SEG-01'
  segmentType: SegmentType;
  fromNode: string;            // e.g. 'PV ARRAY', 'JUNCTION BOX'
  toNode: string;              // e.g. 'JUNCTION BOX', 'AC COMBINER'
  raceway: RacewayType;
  conductorBundle: ConductorBundle[];
  onewayLengthFt: number;
  // Calculated
  totalCurrentCarryingConductors: number;
  totalConductorAreaIn2: number;
  conduitSize: string;         // '3/4"', '1"', etc. — 'N/A' for OPEN_AIR
  fillPercent: number;         // 0 for OPEN_AIR
  ocpdAmps: number;
  continuousCurrent: number;   // A — max current in segment
  requiredAmpacity: number;    // A — continuousCurrent × 1.25
  effectiveAmpacity: number;   // A — after derating
  tempDeratingFactor: number;
  conduitDeratingFactor: number;
  voltageDropPct: number;
  voltageDropVolts: number;
  // Display
  conductorCallout: string;    // permit-grade multi-line callout
  necReferences: string[];
  ampacityPass: boolean;
  voltageDropPass: boolean;
  conduitFillPass: boolean;
  overallPass: boolean;
}

// ─── Input to buildSegmentSchedule ───────────────────────────────────────────

export interface SegmentScheduleInput {
  topology: 'micro' | 'string' | 'optimizer';
  // Array
  moduleCount: number;
  // Microinverter
  maxDevicesPerBranch: number;   // NEC 690.8(B) hard limit (e.g. 16 for Enphase IQ8)
  microAcCurrentA: number;       // A per microinverter AC output (nominal, from datasheet)
  manufacturerMaxPerBranch20A?: number; // Manufacturer-specified max per 20A branch (overrides NEC calc)
  manufacturerMaxPerBranch30A?: number; // Manufacturer-specified max per 30A branch
  // String inverter
  stringCount: number;
  stringCurrentA: number;        // A — Isc × 1.25
  // Common AC
  systemVoltageAC: number;       // 240
  acOutputCurrentA: number;      // A — total system AC output
  mainPanelAmps: number;         // A — service panel rating (e.g. 200A) for MSP_TO_UTILITY sizing
  // Feeder sizing
  feederGauge: string;           // '#6 AWG', '#4 AWG', etc.
  egcGauge: string;              // '#10 AWG', '#8 AWG', etc.
  // Conduit
  conduitType: string;           // 'EMT' | 'PVC Sch 40' | 'PVC Sch 80'
  // Run lengths (ft)
  runLengths: {
    arrayToJbox: number;
    jboxToCombiner: number;
    jboxToInverter: number;
    combinerToDisco: number;
    inverterToDisco: number;
    discoToMeter: number;
    meterToMsp: number;
    mspToUtility: number;
  };
  // Electrical environment
  ambientTempC: number;
  rooftopTempAdderC: number;
  maxACVoltageDropPct: number;
  maxDCVoltageDropPct: number;
}

// ─── NEC Tables ──────────────────────────────────────────────────────────────

// NEC Chapter 9 Table 5 — Conductor areas (in²) for THWN-2
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

// NEC Chapter 9 Table 4 — Conduit full internal areas (in²)
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

const CONDUIT_SIZES = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"'];

// NEC 310.15(B)(2) Table — Ambient Temperature Correction Factors (NEC 2023)
// (was 310.15(B)(2)(a) in NEC 2020)
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

// NEC 310.15(C)(1) — Conduit fill derating
function getConduitDerating(currentCarryingCount: number): number {
  if (currentCarryingCount <= 3) return 1.00;
  if (currentCarryingCount <= 6) return 0.80;
  if (currentCarryingCount <= 9) return 0.70;
  if (currentCarryingCount <= 20) return 0.50;
  if (currentCarryingCount <= 30) return 0.45;
  if (currentCarryingCount <= 40) return 0.40;
  return 0.35;
}

// NEC 240.6 — Standard OCPD sizes (all standard sizes, used for feeder/service sizing)
const STANDARD_OCPD = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];
function nextStandardOCPD(amps: number): number {
  return STANDARD_OCPD.find(s => s >= amps) ?? 400;
}

// 240V double-pole breaker sizes available in residential/commercial panels.
// These are the ONLY sizes stocked for 2-pole branch circuits.
// 25A, 30A, 35A etc. are single-pole sizes — NOT available as 240V 2-pole breakers.
const STANDARD_OCPD_240V_2POLE = [20, 40, 60, 100, 125, 150, 200];
function next240VBreakerSize(amps: number): number {
  return STANDARD_OCPD_240V_2POLE.find(s => s >= amps) ?? 200;
}

// Calculate max devices per branch that fits within a target 240V breaker size.
// NEC 690.8: branch OCPD >= 125% of branch continuous current.
// So: maxDevices = floor(breakerAmps / (1.25 × perDeviceCurrentA))
// Also capped at NEC 690.8(B) hard limit (default 16 for Enphase IQ8).
function maxDevicesForBreaker(breakerAmps: number, perDeviceCurrentA: number, hardLimit: number): number {
  if (perDeviceCurrentA <= 0) return hardLimit;
  const maxByOCPD = Math.floor(breakerAmps / (perDeviceCurrentA * 1.25));
  return Math.min(maxByOCPD, hardLimit);
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

// NEC 310.16 — 75°C ampacity table
const AMPACITY_75C: Record<string, number> = {
  '#14 AWG': 20, '#12 AWG': 25, '#10 AWG': 35, '#8 AWG': 50,
  '#6 AWG': 65, '#4 AWG': 85, '#3 AWG': 100, '#2 AWG': 115,
  '#1 AWG': 130, '#1/0 AWG': 150, '#2/0 AWG': 175,
  '#3/0 AWG': 200, '#4/0 AWG': 230,
};

// NEC 310.16 — 90°C ampacity table (for USE-2/PV Wire DC)
const AMPACITY_90C: Record<string, number> = {
  '#14 AWG': 25, '#12 AWG': 30, '#10 AWG': 40, '#8 AWG': 55,
  '#6 AWG': 75, '#4 AWG': 95, '#3 AWG': 115, '#2 AWG': 130,
  '#1 AWG': 150, '#1/0 AWG': 170, '#2/0 AWG': 195,
  '#3/0 AWG': 225, '#4/0 AWG': 260,
};

const AWG_ORDER = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG',
  '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG', '#4/0 AWG',
];

// ─── Conduit Sizing ───────────────────────────────────────────────────────────

function calcConduitSize(
  conductorBundle: ConductorBundle[],
  conduitType: string
): { size: string; fillPercent: number; totalAreaIn2: number } {
  // Sum all conductor areas
  const totalAreaIn2 = conductorBundle.reduce((sum, c) => {
    const area = CONDUCTOR_AREA_IN2[c.gauge] ?? 0.0211;
    return sum + area * c.qty;
  }, 0);

  const fullTable = CONDUIT_FULL_AREA[conduitType] ?? CONDUIT_FULL_AREA['EMT'];

  for (const size of CONDUIT_SIZES) {
    const fullArea = fullTable[size] ?? 0;
    const fillPct = (totalAreaIn2 / fullArea) * 100;
    if (fillPct <= 40) {
      console.log(`[CONDUIT SIZING] selected_conduit_size: ${size}, calculated_fill_percent: ${fillPct.toFixed(1)}%`);
      return { size, fillPercent: fillPct, totalAreaIn2 };
    }
  }

  // Fallback: 3"
  const fullArea = fullTable['3"'] ?? 3.538;
  const fillPct = (totalAreaIn2 / fullArea) * 100;
  console.log(`[CONDUIT SIZING] selected_conduit_size: 3", calculated_fill_percent: ${fillPct.toFixed(1)}% (exceeds standard sizes)`);
  return { size: '3"', fillPercent: fillPct, totalAreaIn2 };
}

// ─── Voltage Drop ─────────────────────────────────────────────────────────────

function calcVoltageDrop(
  currentA: number,
  onewayFt: number,
  gauge: string,
  voltageV: number,
  conductorCount: number = 2
): number {
  const CMIL: Record<string, number> = {
    '#14 AWG': 4110, '#12 AWG': 6530, '#10 AWG': 10380, '#8 AWG': 16510,
    '#6 AWG': 26240, '#4 AWG': 41740, '#3 AWG': 52620, '#2 AWG': 66360,
    '#1 AWG': 83690, '#1/0 AWG': 105600, '#2/0 AWG': 133100,
    '#3/0 AWG': 167800, '#4/0 AWG': 211600,
  };
  const cmil = CMIL[gauge] ?? 10380;
  const resistivity = 12.9; // Ω·cmil/ft at 75°C copper
  const resistance = (resistivity * onewayFt * conductorCount) / cmil;
  const dropV = currentA * resistance;
  return (dropV / voltageV) * 100;
}

// ─── Auto-size wire gauge ─────────────────────────────────────────────────────

function autoSizeGauge(
  continuousCurrent: number,
  ambientC: number,
  currentCarryingCount: number,
  isDC: boolean = false,
  startGauge: string = '#10 AWG'
): { gauge: string; effectiveAmpacity: number; tempDerating: number; conduitDerating: number } {
  const requiredAmpacity = continuousCurrent * 1.25;
  const tempDerating = getTempDerating(ambientC);
  const conduitDerating = getConduitDerating(currentCarryingCount);
  const startIdx = Math.max(0, AWG_ORDER.indexOf(startGauge));

  for (let i = startIdx; i < AWG_ORDER.length; i++) {
    const gauge = AWG_ORDER[i];
    // NEC 310.15(B)(2): For THWN-2 (90°C rated), derate from 90°C column,
    // then cap at 75°C termination limit per NEC 110.14(C).
    // For DC (USE-2/PV Wire), use 90°C directly.
    const amp90 = AMPACITY_90C[gauge] ?? 0;
    const amp75 = AMPACITY_75C[gauge] ?? 0;
    const derated = amp90 * tempDerating * conduitDerating;
    const effectiveAmpacity = isDC ? derated : Math.min(derated, amp75);
    if (effectiveAmpacity >= requiredAmpacity) {
      return { gauge, effectiveAmpacity, tempDerating, conduitDerating };
    }
  }
  return { gauge: '#4/0 AWG', effectiveAmpacity: 230 * tempDerating * conduitDerating, tempDerating, conduitDerating };
}

// ─── Build Conductor Callout ──────────────────────────────────────────────────

export function buildConductorCallout(
  bundle: ConductorBundle[],
  conduitSize: string,
  conduitType: string,
  isOpenAir: boolean
): string {
  // Build concise conductor description: e.g., "2×#6 THWN-2"
  const hotCount = bundle.filter(c => c.isCurrentCarrying && c.color !== 'GRN').reduce((s, c) => s + c.qty, 0);
  const primaryGauge = bundle.find(c => c.isCurrentCarrying && c.color !== 'GRN')?.gauge ?? '#10 AWG';
  const gaugeNum = primaryGauge.replace('#', '').replace(' AWG', '');
  const insulation = bundle[0]?.insulation ?? 'THWN-2';
  const conductorDesc = `${hotCount}×#${gaugeNum} ${insulation}`;
  
  if (isOpenAir) {
    return `${conductorDesc} (OPEN AIR)`;
  }
  const conduitAbbrev = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC'
    : conduitType === 'PVC Sch 80' ? 'PVC'
    : conduitType;
  return `${conductorDesc} · ${conduitSize} ${conduitAbbrev}`;
}

// ─── Build Segment ────────────────────────────────────────────────────────────

// segIdCounter moved inside buildSegmentSchedule() to eliminate module-level mutable state
// and prevent race conditions in concurrent requests. See buildSegmentSchedule() below.

function buildSegment(
  segmentType: SegmentType,
  fromNode: string,
  toNode: string,
  raceway: RacewayType,
  conductorBundle: ConductorBundle[],
  onewayLengthFt: number,
  continuousCurrent: number,
  ocpdAmps: number,
  conduitType: string,
  ambientC: number,
  systemVoltage: number,
  maxVDropPct: number,
  necReferences: string[],
  effectiveAmpacity: number,
  tempDerating: number,
  conduitDerating: number,
  segId: number  // passed in from buildSegmentSchedule() local counter
): SegmentScheduleRow {
  const id = `SEG-${String(segId).padStart(2, '0')}`;

  const isOpenAir = raceway === 'OPEN_AIR';
  const totalCurrentCarrying = conductorBundle.filter(c => c.isCurrentCarrying).reduce((s, c) => s + c.qty, 0);

  // Conduit sizing
  let conduitSize = 'N/A';
  let fillPercent = 0;
  let totalAreaIn2 = 0;
  if (!isOpenAir) {
    const result = calcConduitSize(conductorBundle, conduitType);
    conduitSize = result.size;
    fillPercent = result.fillPercent;
    totalAreaIn2 = result.totalAreaIn2;
  }

  // Voltage drop — use largest current-carrying gauge
  const hotConductors = conductorBundle.filter(c => c.isCurrentCarrying && c.color !== 'GRN');
  const primaryGauge = hotConductors[0]?.gauge ?? '#10 AWG';
  const vdropPct = calcVoltageDrop(continuousCurrent, onewayLengthFt, primaryGauge, systemVoltage, 2);
  const vdropVolts = (vdropPct / 100) * systemVoltage;

  const requiredAmpacity = continuousCurrent * 1.25;
  const ampacityPass = effectiveAmpacity >= requiredAmpacity;
  const voltageDropPass = vdropPct <= maxVDropPct;
  const conduitFillPass = isOpenAir || fillPercent <= 40;

  const conductorCallout = buildConductorCallout(conductorBundle, conduitSize, conduitType, isOpenAir);

  return {
    id,
    segmentType,
    fromNode,
    toNode,
    raceway,
    conductorBundle,
    onewayLengthFt,
    totalCurrentCarryingConductors: totalCurrentCarrying,
    totalConductorAreaIn2: totalAreaIn2,
    conduitSize,
    fillPercent,
    ocpdAmps,
    continuousCurrent,
    requiredAmpacity,
    effectiveAmpacity,
    tempDeratingFactor: tempDerating,
    conduitDeratingFactor: conduitDerating,
    voltageDropPct: vdropPct,
    voltageDropVolts: vdropVolts,
    conductorCallout,
    necReferences,
    ampacityPass,
    voltageDropPass,
    conduitFillPass,
    overallPass: ampacityPass && voltageDropPass && conduitFillPass,
  };
}

// ─── Main: buildSegmentSchedule ───────────────────────────────────────────────

export function buildSegmentSchedule(input: SegmentScheduleInput): SegmentScheduleRow[] {
  // Local counter — eliminates module-level mutable state race condition
  // Each call to buildSegmentSchedule() gets its own isolated counter.
  let segIdCounter = 0;
  const nextSegId = () => ++segIdCounter;
  const segments: SegmentScheduleRow[] = [];
  const rl = input.runLengths;
  const conduitType = input.conduitType;
  const ambientC = input.ambientTempC;
  const roofAmbC = input.ambientTempC + input.rooftopTempAdderC;
  const sysV = input.systemVoltageAC;

  if (input.topology === 'micro') {
    // ── MICROINVERTER SYSTEM ──────────────────────────────────────────────────
    //
    // branches = ceil(moduleCount / maxDevicesPerBranch)
    // Each branch: L1 + L2 conductors (2 hot per branch)
    // All branches share 1 EGC
    //
    // SEGMENT 1: ARRAY → JUNCTION BOX (OPEN AIR)
    //   N branches × 2 hots + 1 EGC
    //   e.g. 3 branches → 3 BLK + 3 RED + 1 GRN

    // ── Branch sizing: ONLY 20A or 30A for branch circuits (#10 AWG) ────────
    // Branch circuits use #10 AWG trunk cable — max 30A per NEC 240.4(D).
    // 40A+ are feeder sizes, NOT valid branch breaker sizes for #10 AWG trunk.
    //
    // Strategy: try 20A first, then 30A. Pick whichever gives most balanced
    // branch distribution. If tie, prefer fewer branches (30A = fewer branches).
    //
    // Priority for max devices per breaker size:
    //   1. Manufacturer-specified limit (AP Systems DS3 series — from datasheet)
    //   2. NEC 125% calculation: floor(breakerAmps / (1.25 x perDeviceA))
    //   3. Hard NEC 690.8(B) limit
    const totalCurrentA = input.microAcCurrentA * input.moduleCount;
    const deviceCount = input.moduleCount; // total microinverter devices

    // Helper: get max devices per branch for a given breaker size
    const maxDevForBreaker = (breakerAmps: number): number => {
      if (breakerAmps === 20 && input.manufacturerMaxPerBranch20A && input.manufacturerMaxPerBranch20A > 0) {
        return Math.min(input.manufacturerMaxPerBranch20A, input.maxDevicesPerBranch);
      }
      if (breakerAmps === 30 && input.manufacturerMaxPerBranch30A && input.manufacturerMaxPerBranch30A > 0) {
        return Math.min(input.manufacturerMaxPerBranch30A, input.maxDevicesPerBranch);
      }
      return input.microAcCurrentA > 0
        ? Math.min(Math.floor(breakerAmps / (input.microAcCurrentA * 1.25)), input.maxDevicesPerBranch)
        : input.maxDevicesPerBranch;
    };

    // Helper: compute branch imbalance for a given max-per-branch
    const branchImbalance = (maxPerBranch: number): number => {
      if (maxPerBranch < 1) return Infinity;
      const numBranches = Math.ceil(deviceCount / maxPerBranch);
      const remainder = deviceCount % numBranches;
      return remainder === 0 ? 0 : 1;
    };

    // ONLY 20A and 30A are valid branch breaker sizes for #10 AWG trunk cable
    const CANDIDATE_BREAKERS = [20, 30];
    let branchOcpd = 20;
    let maxDevPerBranch = 0;

    const validCandidates: Array<{amps: number; maxDev: number; imbalance: number; numBranches: number}> = [];
    for (const sz of CANDIDATE_BREAKERS) {
      const maxDev = maxDevForBreaker(sz);
      if (maxDev >= 1) {
        const numBranches = Math.ceil(deviceCount / maxDev);
        validCandidates.push({ amps: sz, maxDev, imbalance: branchImbalance(maxDev), numBranches });
        if (validCandidates.length >= 2) break;
      }
    }

    if (validCandidates.length === 0) {
      // Fallback: if even 30A can't fit 1 device, use 30A with 1 device per branch
      // This should never happen with real microinverters (max ~3.7A per device)
      branchOcpd = 30; maxDevPerBranch = 1;
    } else if (validCandidates.length === 1) {
      branchOcpd = validCandidates[0].amps;
      maxDevPerBranch = validCandidates[0].maxDev;
    } else {
      const [a, b] = validCandidates;
      // Pick: lower imbalance wins; tie -> fewer branches; tie -> smaller breaker (a)
      const pick = (a.imbalance < b.imbalance) ? a
        : (b.imbalance < a.imbalance) ? b
        : (a.numBranches <= b.numBranches) ? a
        : a;
      branchOcpd = pick.amps;
      maxDevPerBranch = pick.maxDev;
    }

    // Branches = ceil(total devices / max devices per branch)
    const branches = Math.ceil(deviceCount / maxDevPerBranch);
    // Actual devices on largest branch (balanced distribution)
    const devicesPerBranch = Math.ceil(deviceCount / branches);
    const branchCurrentA = input.microAcCurrentA * devicesPerBranch;

    // Final OCPD verification — ensure chosen breaker covers actual branch current.
    // IMPORTANT: Branch circuits MUST stay on 20A or 30A (#10 AWG, NEC 240.4(D)).
    // The balance algorithm already chose branchOcpd (20 or 30). Only bump up to 30A
    // if the actual branch current × 1.25 exceeds the chosen breaker — never above 30A.
    const requiredOcpd = next240VBreakerSize(branchCurrentA * 1.25);
    if (requiredOcpd > branchOcpd) {
      branchOcpd = Math.min(requiredOcpd, 30); // cap at 30A for branch circuits
    }

    // Auto-size branch conductor gauge (open air, no conduit derating)
    const branchSizing = autoSizeGauge(branchCurrentA, roofAmbC, 2, false, '#10 AWG');
    const branchGauge = branchSizing.gauge;
    const branchEgcGauge = getEGCGauge(branchOcpd);

    // SEGMENT 1: Array → Junction Box (OPEN AIR)
    const seg1Bundle: ConductorBundle[] = [
      { qty: branches, gauge: branchGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
      { qty: branches, gauge: branchGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
      { qty: 1, gauge: branchEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'ARRAY_TO_JBOX', 'PV ARRAY', 'JUNCTION BOX',
      'OPEN_AIR', seg1Bundle, rl.arrayToJbox,
      branchCurrentA, branchOcpd, conduitType,
      roofAmbC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.31', 'NEC 690.8(B)'],
      branchSizing.effectiveAmpacity, branchSizing.tempDerating, 1.0,
      nextSegId()
    ));

    // SEGMENT 2: Junction Box → AC Combiner (CONDUIT)
    // Same bundle as segment 1 — conductors continue in conduit
    // Current-carrying count for derating = branches × 2 (L1 + L2 per branch)
    const jboxCombinerCCC = branches * 2;
    const jboxCombinerDerating = getConduitDerating(jboxCombinerCCC);
    const jboxCombinerSizing = autoSizeGauge(branchCurrentA, ambientC, jboxCombinerCCC, false, '#10 AWG');

    const seg2Bundle: ConductorBundle[] = [
      { qty: branches, gauge: jboxCombinerSizing.gauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
      { qty: branches, gauge: jboxCombinerSizing.gauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
      { qty: 1, gauge: branchEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'JBOX_TO_COMBINER', 'JUNCTION BOX', 'AC COMBINER',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg2Bundle, rl.jboxToCombiner,
      branchCurrentA, branchOcpd, conduitType,
      ambientC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.31', 'NEC 690.8(B)', 'NEC 310.15'],
      jboxCombinerSizing.effectiveAmpacity, jboxCombinerSizing.tempDerating, jboxCombinerDerating,
      nextSegId()
    ));

    // SEGMENT 3: AC Combiner → AC Disconnect (CONDUIT)
    // Feeder: all branches combined into single feeder
    // 240V split-phase microinverter output: L1 (BLK) + L2 (RED) + N (WHT) + EGC (GRN)
    // Neutral IS required: microinverters produce 120/240V split-phase; neutral carries
    // imbalance current and is required by NEC 200.3 and utility interconnection rules.
    // Lands on LOAD side of AC disconnect (combiner feeds load terminals).
    // NEC 200.3: neutral required for 120/240V split-phase; 3 current-carrying conductors (L1+L2+N)
    const feederSizing = autoSizeGauge(totalCurrentA, ambientC, 3, false, '#10 AWG');
    const feederGauge = feederSizing.gauge;
    const feederOcpd = nextStandardOCPD(totalCurrentA * 1.25);
    const feederEgcGauge = getEGCGauge(feederOcpd);

    const seg3Bundle: ConductorBundle[] = [
      { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: totalCurrentA },
      { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: totalCurrentA },
      { qty: 1, gauge: feederGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: 0 },  // neutral
      { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'COMBINER_TO_DISCO', 'AC COMBINER', 'AC DISCONNECT (LOAD SIDE)',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg3Bundle, rl.combinerToDisco,
      totalCurrentA, feederOcpd, conduitType,
      ambientC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.8', 'NEC 310.15', 'NEC 250.122', 'NEC 200.3'],
      feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating,
      nextSegId()
    ));

  } else {
    // ── STRING INVERTER SYSTEM ────────────────────────────────────────────────
    //
    // strings = design algorithm
    // Each string: + conductor + - conductor
    // All strings share 1 EGC
    //
    // SEGMENT 1: ARRAY → JUNCTION BOX (OPEN AIR)
    //   N strings × 2 conductors + 1 EGC
    //   e.g. 3 strings → 3 RED + 3 BLK + 1 GRN

    const strings = input.stringCount;
    const stringCurrentA = input.stringCurrentA; // already × 1.25 per NEC 690.8

    // Auto-size string conductor gauge (open air, no conduit derating)
    const stringSizing = autoSizeGauge(stringCurrentA, roofAmbC, 2, true, '#10 AWG');
    const stringGauge = stringSizing.gauge;
    const stringOcpd = nextStandardOCPD(stringCurrentA * 1.25);
    const stringEgcGauge = getEGCGauge(stringOcpd);

    // SEGMENT 1: Array → Junction Box (OPEN AIR)
    const seg1Bundle: ConductorBundle[] = [
      { qty: strings, gauge: stringGauge, color: 'RED', insulation: 'USE-2/PV Wire', isCurrentCarrying: true, currentPerConductor: stringCurrentA },
      { qty: strings, gauge: stringGauge, color: 'BLK', insulation: 'USE-2/PV Wire', isCurrentCarrying: true, currentPerConductor: stringCurrentA },
      { qty: 1, gauge: stringEgcGauge, color: 'GRN', insulation: 'USE-2/PV Wire', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'ARRAY_TO_JBOX', 'PV ARRAY', 'JUNCTION BOX',
      'OPEN_AIR', seg1Bundle, rl.arrayToJbox,
      stringCurrentA, stringOcpd, conduitType,
      roofAmbC, sysV, input.maxDCVoltageDropPct,
      ['NEC 690.31', 'NEC 690.8'],
      stringSizing.effectiveAmpacity, stringSizing.tempDerating, 1.0,
      nextSegId()
    ));

    // SEGMENT 2: Junction Box → Inverter (CONDUIT)
    // Same bundle continues in conduit
    const jboxInvCCC = strings * 2;
    const jboxInvDerating = getConduitDerating(jboxInvCCC);
    const jboxInvSizing = autoSizeGauge(stringCurrentA, ambientC, jboxInvCCC, true, '#10 AWG');

    const seg2Bundle: ConductorBundle[] = [
      { qty: strings, gauge: jboxInvSizing.gauge, color: 'RED', insulation: 'USE-2/PV Wire', isCurrentCarrying: true, currentPerConductor: stringCurrentA },
      { qty: strings, gauge: jboxInvSizing.gauge, color: 'BLK', insulation: 'USE-2/PV Wire', isCurrentCarrying: true, currentPerConductor: stringCurrentA },
      { qty: 1, gauge: stringEgcGauge, color: 'GRN', insulation: 'USE-2/PV Wire', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'JBOX_TO_INVERTER', 'JUNCTION BOX', 'STRING INVERTER',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg2Bundle, rl.jboxToInverter,
      stringCurrentA, stringOcpd, conduitType,
      ambientC, sysV, input.maxDCVoltageDropPct,
      ['NEC 690.31', 'NEC 690.8', 'NEC 310.15'],
      jboxInvSizing.effectiveAmpacity, jboxInvSizing.tempDerating, jboxInvDerating,
      nextSegId()
    ));

    // SEGMENT 3: Inverter → AC Disconnect (CONDUIT)
    // AC feeder after DC→AC conversion
    // 240V split-phase PV output: L1 (BLK) + L2 (RED) + EGC (GRN) — NO neutral
    // NEC 690.8: PV AC output circuits are ungrounded 2-wire 240V; neutral NOT required
    const acCurrentA = input.acOutputCurrentA;
    const feederSizing = autoSizeGauge(acCurrentA, ambientC, 2, false, '#10 AWG');
    const feederGauge = feederSizing.gauge;
    const feederOcpd = nextStandardOCPD(acCurrentA * 1.25);
    const feederEgcGauge = getEGCGauge(feederOcpd);

    const seg3Bundle: ConductorBundle[] = [
      { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
      { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
      { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'INVERTER_TO_DISCO', 'STRING INVERTER', 'AC DISCONNECT',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg3Bundle, rl.inverterToDisco,
      acCurrentA, feederOcpd, conduitType,
      ambientC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.8', 'NEC 310.15', 'NEC 250.122'],
      feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating,
      nextSegId()
    ));
  }

  // ── COMMON DOWNSTREAM SEGMENTS ────────────────────────────────────────────
  // These are the same for both micro and string topologies.
  // 240V split-phase: L1 (BLK) + L2 (RED) + N (WHT) + EGC (GRN)
  // Neutral IS required: interconnection to MSP is 120/240V split-phase service.
  // DISCO LINE SIDE: conductor from MSP/interconnection lands on LINE (top) terminals of AC disco.
  // DISCO LOAD SIDE: conductor from combiner lands on LOAD (bottom) terminals of AC disco.

  const acCurrentA = input.acOutputCurrentA;
  // NEC 200.3: neutral required for 120/240V split-phase interconnection; 3 current-carrying conductors (L1+L2+N)
  const feederSizing = autoSizeGauge(acCurrentA, ambientC, 3, false, '#10 AWG');
  const feederGauge = feederSizing.gauge;
  const feederOcpd = nextStandardOCPD(acCurrentA * 1.25);
  const feederEgcGauge = getEGCGauge(feederOcpd);

  // Feeder bundle: L1 + L2 + N + EGC
  const feederBundle: ConductorBundle[] = [
    { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
    { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
    { qty: 1, gauge: feederGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: 0 },  // neutral
    { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
  ];

  const condRaceway: RacewayType = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC_SCH40'
    : 'PVC_SCH80';

  // SEGMENT: AC Disconnect LINE SIDE → MSP
  // This conductor makes the actual grid interconnection.
  // Lands on LINE (top/arc-shield) side of AC disconnect — utility side.
  // Per industry standard: utility installs bidirectional meter for net metering;
  // Enphase IQ Gateway provides production monitoring. No secondary production meter on plan sets.
  segments.push(buildSegment(
    'DISCO_TO_METER', 'AC DISCONNECT (LINE SIDE)', 'MAIN SERVICE PANEL',
    condRaceway, feederBundle, rl.discoToMeter,
    acCurrentA, feederOcpd, conduitType,
    ambientC, sysV, input.maxACVoltageDropPct,
    ['NEC 690.14', 'NEC 705.12', 'NEC 310.15', 'NEC 200.3'],
    feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating,
    nextSegId()
  ));

  // SEGMENT: MSP → Utility Meter (utility-owned service entrance — shown for reference only)
  // NEC 230.42 / NEC 230.54 — service entrance conductors sized for full service rating.
  // Sized for mainPanelAmps (e.g. 200A service), NOT PV feeder current.
  // NEC 230.42(A): service conductors sized for calculated load, no 125% multiplier.
  // For 200A service: #2/0 AWG THWN-2 (200A at 75°C) is the standard utility conductor.
  // These are utility-owned conductors; shown on SLD for completeness only.
  const serviceAmps = input.mainPanelAmps || 200;
  // Size service conductors directly to service rating (no 125% — NEC 230.42, not 690.8)
  const serviceGauge = serviceAmps <= 100 ? '#3 AWG'
    : serviceAmps <= 125 ? '#1 AWG'
    : serviceAmps <= 150 ? '#1/0 AWG'
    : serviceAmps <= 200 ? '#2/0 AWG'   // #2/0 AWG = 200A at 75°C per NEC 310.16
    : serviceAmps <= 250 ? '#3/0 AWG'
    : '#4/0 AWG';
  const serviceSizing = { gauge: serviceGauge, effectiveAmpacity: serviceAmps, tempDerating: 1.0, conduitDerating: 1.0 };
  const serviceEgcGauge = getEGCGauge(serviceAmps);

  const serviceBundle: ConductorBundle[] = [
    { qty: 1, gauge: serviceGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: serviceAmps },
    { qty: 1, gauge: serviceGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: serviceAmps },
    { qty: 1, gauge: serviceGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: 0 },  // neutral
    { qty: 1, gauge: serviceEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
  ];

  segments.push(buildSegment(
    'MSP_TO_UTILITY', 'MAIN SERVICE PANEL', 'UTILITY METER',
    condRaceway, serviceBundle, rl.mspToUtility,
    serviceAmps, serviceAmps, conduitType,
    ambientC, sysV, input.maxACVoltageDropPct,
    ['NEC 230.42', 'NEC 230.54'],
    serviceSizing.effectiveAmpacity, serviceSizing.tempDerating, serviceSizing.conduitDerating,
    nextSegId()
  ));

  console.log(`[SEGMENT_SCHEDULE] Built ${segments.length} segments for ${input.topology} topology`);
  return segments;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export interface SegmentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSegmentSchedule(
  segments: SegmentScheduleRow[],
  sldConductorCounts?: Record<string, number>
): SegmentValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check each segment passes
  for (const seg of segments) {
    if (!seg.ampacityPass) {
      errors.push(`[${seg.id}] ${seg.fromNode}→${seg.toNode}: Ampacity FAIL (${seg.effectiveAmpacity.toFixed(1)}A < ${seg.requiredAmpacity.toFixed(1)}A required)`);
    }
    if (!seg.voltageDropPass) {
      warnings.push(`[${seg.id}] ${seg.fromNode}→${seg.toNode}: Voltage drop WARN (${seg.voltageDropPct.toFixed(2)}%)`);
    }
    if (!seg.conduitFillPass) {
      errors.push(`[${seg.id}] ${seg.fromNode}→${seg.toNode}: Conduit fill FAIL (${seg.fillPercent.toFixed(1)}% > 40%)`);
    }
  }

  // ENGINEERING_STATE_DESYNC check
  if (sldConductorCounts) {
    for (const seg of segments) {
      const sldCount = sldConductorCounts[seg.id];
      if (sldCount !== undefined) {
        const scheduleCount = seg.conductorBundle.reduce((s, c) => s + c.qty, 0);
        if (sldCount !== scheduleCount) {
          errors.push(`ENGINEERING_STATE_DESYNC: Segment ${seg.id} SLD shows ${sldCount} conductors but schedule has ${scheduleCount}`);
          console.error(`[ENGINEERING_STATE_DESYNC] Segment ${seg.id}: SLD=${sldCount}, schedule=${scheduleCount}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── BOM Wire/Conduit Quantities from Segments ────────────────────────────────

export interface SegmentBOMQuantities {
  wireByGauge: Record<string, number>;   // gauge → total feet
  conduitByType: Record<string, number>; // conduitType → total feet
  junctionBoxes: number;
}

export function calcBOMFromSegments(
  segments: SegmentScheduleRow[],
  conduitType: string
): SegmentBOMQuantities {
  const wireByGauge: Record<string, number> = {};
  const conduitByType: Record<string, number> = {};
  let junctionBoxes = 0;

  const SLACK = 1.15; // 15% slack factor per prompt

  for (const seg of segments) {
    // Wire quantities: length × qty per conductor type
    for (const c of seg.conductorBundle) {
      const key = c.gauge;
      const qty = Math.ceil(seg.onewayLengthFt * c.qty * SLACK);
      wireByGauge[key] = (wireByGauge[key] ?? 0) + qty;
    }

    // Conduit quantities: length × 1.15 (only for conduit segments)
    if (seg.raceway !== 'OPEN_AIR') {
      const conduitFt = Math.ceil(seg.onewayLengthFt * SLACK);
      conduitByType[conduitType] = (conduitByType[conduitType] ?? 0) + conduitFt;
    }

    // Count junction boxes (segments ending at JUNCTION BOX)
    if (seg.toNode === 'JUNCTION BOX') {
      junctionBoxes++;
    }
  }

  return { wireByGauge, conduitByType, junctionBoxes };
}// cache bust Fri Mar  6 19:32:21 UTC 2026
