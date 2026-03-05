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
  maxDevicesPerBranch: number;   // e.g. 16 for Enphase IQ8
  microAcCurrentA: number;       // A per microinverter AC output
  // String inverter
  stringCount: number;
  stringCurrentA: number;        // A — Isc × 1.25
  // Common AC
  systemVoltageAC: number;       // 240
  acOutputCurrentA: number;      // A — total system AC output
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

// NEC 310.15(B)(2)(a) — Temperature derating
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
    const tableAmp = isDC ? (AMPACITY_90C[gauge] ?? 0) : (AMPACITY_75C[gauge] ?? 0);
    const effectiveAmpacity = tableAmp * tempDerating * conduitDerating;
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
  const lines = bundle.map(c => `${c.qty}#${c.gauge.replace('#', '').replace(' AWG', '')} ${c.color}`);
  if (isOpenAir) {
    return lines.join('\n') + '\n(OPEN AIR)';
  }
  const conduitAbbrev = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
    : conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
    : conduitType;
  return lines.join('\n') + `\nIN ${conduitSize} ${conduitAbbrev}`;
}

// ─── Build Segment ────────────────────────────────────────────────────────────

let segIdCounter = 0;

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
  conduitDerating: number
): SegmentScheduleRow {
  segIdCounter++;
  const id = `SEG-${String(segIdCounter).padStart(2, '0')}`;

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
  segIdCounter = 0;
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

    const branches = Math.ceil(input.moduleCount / input.maxDevicesPerBranch);
    const branchCurrentA = input.microAcCurrentA * input.maxDevicesPerBranch; // max per branch
    const totalCurrentA = input.microAcCurrentA * input.moduleCount;

    // Auto-size branch conductor gauge (open air, no conduit derating)
    const branchSizing = autoSizeGauge(branchCurrentA, roofAmbC, 2, false, '#10 AWG');
    const branchGauge = branchSizing.gauge;
    const branchOcpd = nextStandardOCPD(branchCurrentA * 1.25);
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
      branchSizing.effectiveAmpacity, branchSizing.tempDerating, 1.0
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
      jboxCombinerSizing.effectiveAmpacity, jboxCombinerSizing.tempDerating, jboxCombinerDerating
    ));

    // SEGMENT 3: AC Combiner → AC Disconnect (CONDUIT)
    // Feeder: all branches combined into single feeder
    // Conductors: 1 BLK + 1 RED + 1 WHT (neutral) + 1 GRN EGC
    const feederSizing = autoSizeGauge(totalCurrentA, ambientC, 3, false, '#10 AWG');
    const feederGauge = feederSizing.gauge;
    const feederOcpd = nextStandardOCPD(totalCurrentA * 1.25);
    const feederEgcGauge = getEGCGauge(feederOcpd);

    const seg3Bundle: ConductorBundle[] = [
      { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: totalCurrentA },
      { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: totalCurrentA },
      { qty: 1, gauge: feederGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: totalCurrentA },
      { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'COMBINER_TO_DISCO', 'AC COMBINER', 'AC DISCONNECT',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg3Bundle, rl.combinerToDisco,
      totalCurrentA, feederOcpd, conduitType,
      ambientC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.8', 'NEC 310.15', 'NEC 250.122'],
      feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating
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
      stringSizing.effectiveAmpacity, stringSizing.tempDerating, 1.0
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
      jboxInvSizing.effectiveAmpacity, jboxInvSizing.tempDerating, jboxInvDerating
    ));

    // SEGMENT 3: Inverter → AC Disconnect (CONDUIT)
    // AC feeder after DC→AC conversion
    const acCurrentA = input.acOutputCurrentA;
    const feederSizing = autoSizeGauge(acCurrentA, ambientC, 3, false, '#10 AWG');
    const feederGauge = feederSizing.gauge;
    const feederOcpd = nextStandardOCPD(acCurrentA * 1.25);
    const feederEgcGauge = getEGCGauge(feederOcpd);

    const seg3Bundle: ConductorBundle[] = [
      { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
      { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
      { qty: 1, gauge: feederGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
      { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
    ];

    segments.push(buildSegment(
      'INVERTER_TO_DISCO', 'STRING INVERTER', 'AC DISCONNECT',
      conduitType === 'EMT' ? 'EMT' : conduitType === 'PVC Sch 40' ? 'PVC_SCH40' : 'PVC_SCH80' as RacewayType,
      seg3Bundle, rl.inverterToDisco,
      acCurrentA, feederOcpd, conduitType,
      ambientC, sysV, input.maxACVoltageDropPct,
      ['NEC 690.8', 'NEC 310.15', 'NEC 250.122'],
      feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating
    ));
  }

  // ── COMMON DOWNSTREAM SEGMENTS ────────────────────────────────────────────
  // These are the same for both micro and string topologies

  const acCurrentA = input.acOutputCurrentA;
  const feederSizing = autoSizeGauge(acCurrentA, ambientC, 3, false, '#10 AWG');
  const feederGauge = feederSizing.gauge;
  const feederOcpd = nextStandardOCPD(acCurrentA * 1.25);
  const feederEgcGauge = getEGCGauge(feederOcpd);

  const feederBundle: ConductorBundle[] = [
    { qty: 1, gauge: feederGauge, color: 'BLK', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
    { qty: 1, gauge: feederGauge, color: 'RED', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
    { qty: 1, gauge: feederGauge, color: 'WHT', insulation: 'THWN-2', isCurrentCarrying: true, currentPerConductor: acCurrentA },
    { qty: 1, gauge: feederEgcGauge, color: 'GRN', insulation: 'THWN-2', isCurrentCarrying: false, currentPerConductor: 0 },
  ];

  const condRaceway: RacewayType = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC_SCH40'
    : 'PVC_SCH80';

  // SEGMENT: AC Disconnect → Production Meter
  segments.push(buildSegment(
    'DISCO_TO_METER', 'AC DISCONNECT', 'PRODUCTION METER',
    condRaceway, feederBundle, rl.discoToMeter,
    acCurrentA, feederOcpd, conduitType,
    ambientC, sysV, input.maxACVoltageDropPct,
    ['NEC 690.14', 'NEC 310.15'],
    feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating
  ));

  // SEGMENT: Production Meter → MSP
  segments.push(buildSegment(
    'METER_TO_MSP', 'PRODUCTION METER', 'MAIN SERVICE PANEL',
    condRaceway, feederBundle, rl.meterToMsp,
    acCurrentA, feederOcpd, conduitType,
    ambientC, sysV, input.maxACVoltageDropPct,
    ['NEC 705.12', 'NEC 310.15'],
    feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating
  ));

  // SEGMENT: MSP → Utility Grid
  segments.push(buildSegment(
    'MSP_TO_UTILITY', 'MAIN SERVICE PANEL', 'UTILITY GRID',
    condRaceway, feederBundle, rl.mspToUtility,
    acCurrentA, feederOcpd, conduitType,
    ambientC, sysV, input.maxACVoltageDropPct,
    ['NEC 705.12(B)', 'NEC 230'],
    feederSizing.effectiveAmpacity, feederSizing.tempDerating, feederSizing.conduitDerating
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
}