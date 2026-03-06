// ============================================================
// SEGMENT BUILDER — BUILD v16
// Single source of truth for all electrical segments.
// Calculates conductor bundles, conduit sizing, and compliance.
// ============================================================

import {
  Segment,
  SegmentType,
  InterconnectionType,
  Conductor,
  ConductorBundle,
  SegmentBuilderInput,
  SegmentBuilderOutput,
  EngineeringIssue,
} from './segment-model';

// NEC 310.16 75°C Ampacity Table
const AMPACITY_TABLE_75C: Record<string, number> = {
  '#14 AWG': 20,
  '#12 AWG': 25,
  '#10 AWG': 35,
  '#8 AWG': 50,
  '#6 AWG': 65,
  '#4 AWG': 85,
  '#3 AWG': 100,
  '#2 AWG': 115,
  '#1 AWG': 130,
  '1/0 AWG': 150,
  '2/0 AWG': 175,
  '3/0 AWG': 200,
  '4/0 AWG': 230,
  '250 kcmil': 255,
};

// Standard OCPD ratings
const STANDARD_OCPD: number[] = [15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400];

// Conductor area in square inches (NEC Ch.9 Table 5)
const CONDUCTOR_AREA_IN2: Record<string, number> = {
  '#14': 0.0097,
  '#12': 0.0133,
  '#10': 0.0211,
  '#8': 0.0366,
  '#6': 0.0507,
  '#4': 0.0824,
  '#3': 0.0973,
  '#2': 0.1158,
  '#1': 0.1302,
  '1/0': 0.1563,
  '2/0': 0.1873,
  '3/0': 0.2266,
  '4/0': 0.2719,
  '250': 0.3167,
  '300': 0.3718,
  '350': 0.4236,
  '500': 0.6178,
};

// Conduit area in square inches (NEC Ch.9 Table 4)
const CONDUIT_AREA_IN2: Record<string, number> = {
  '1/2"': 0.304,
  '3/4"': 0.533,
  '1"': 0.868,
  '1-1/4"': 1.493,
  '1-1/2"': 2.036,
  '2"': 3.356,
  '2-1/2"': 4.860,
  '3"': 7.928,
};

// ============================================================
// Helper Functions
// ============================================================

function nextStandardOCPD(requiredAmps: number): number {
  return STANDARD_OCPD.find(rating => rating >= requiredAmps) ?? 300;
}

function getTempDerating(
  ambientTempC: number,
  insulation: string
): number {
  // NEC 310.15(B)(2)(a) — THWN-2 rated 90°C
  const maxTempC = 90;
  if (ambientTempC > maxTempC) {
    throw new Error(`Ambient temp ${ambientTempC}°C exceeds conductor rating ${maxTempC}°C`);
  }
  
  // Derating factor from NEC 310.15(B)(1) table
  const deratingTable: Record<number, number> = {
    26: 1.00,
    27: 1.00,
    28: 1.00,
    29: 1.00,
    30: 1.00,
    31: 1.00,
    32: 0.96,
    33: 0.94,
    34: 0.91,
    35: 0.88,
    36: 0.85,
    37: 0.82,
    38: 0.80,
    39: 0.76,
    40: 0.73,
    41: 0.70,
    42: 0.67,
    43: 0.64,
    44: 0.61,
    45: 0.58,
    46: 0.55,
    47: 0.51,
    48: 0.47,
    49: 0.44,
    50: 0.41,
  };
  
  const tempRounded = Math.floor(ambientTempC);
  return deratingTable[tempRounded] ?? 0.41;
}

function getConduitDerating(currentCarryingCount: number): number {
  // NEC 310.15(B)(3)(a)
  if (currentCarryingCount <= 3) return 1.0;
  if (currentCarryingCount <= 6) return 0.8;
  if (currentCarryingCount <= 9) return 0.7;
  if (currentCarryingCount <= 12) return 0.5;
  if (currentCarryingCount <= 20) return 0.45;
  if (currentCarryingCount <= 30) return 0.4;
  if (currentCarryingCount <= 40) return 0.35;
  return 0.3;
}

function autoSizeConductor(
  requiredAmpacity: number,
  ambientTempC: number,
  currentCarryingCount: number,
  minGauge: string = '#10 AWG'
): { gauge: string; effectiveAmpacity: number; tempDerating: number; conduitDerating: number; } {
  const tempDerating = getTempDerating(ambientTempC, 'THWN-2');
  const conduitDerating = getConduitDerating(currentCarryingCount);
  const combinedDerating = tempDerating * conduitDerating;
  
  // Try gauges from minGauge upward
  const gauges = ['#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG', '#3 AWG', '#2 AWG', '#1 AWG', '1/0 AWG', '2/0 AWG', '3/0 AWG', '4/0 AWG'];
  const startIndex = gauges.indexOf(minGauge);
  
  for (let i = startIndex; i < gauges.length; i++) {
    const gauge = gauges[i];
    const baseAmpacity = AMPACITY_TABLE_75C[gauge];
    const effective = baseAmpacity * combinedDerating;
    
    if (effective >= requiredAmpacity) {
      return { gauge, effectiveAmpacity: effective, tempDerating, conduitDerating };
    }
  }
  
  // If we get here, even 4/0 is not enough
  return { gauge: '4/0 AWG', effectiveAmpacity: AMPACITY_TABLE_75C['4/0 AWG'] * combinedDerating, tempDerating, conduitDerating };
}

function getEGCGauge(ocpdAmps: number): string {
  // NEC 250.122
  if (ocpdAmps <= 20) return '#14 AWG';
  if (ocpdAmps <= 60) return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  if (ocpdAmps <= 300) return '#4 AWG';
  if (ocpdAmps <= 400) return '#3 AWG';
  if (ocpdAmps <= 500) return '#2 AWG';
  if (ocpdAmps <= 800) return '#1/0 AWG';
  return '2/0 AWG';
}

function calcVoltageDrop(
  current: number,
  lengthFt: number,
  gauge: string,
  voltage: number,
  conductorCount: number
): { percent: number; volts: number } {
  // Simple approximation using Ohm's law
  // Resistance per 1000 ft (approximate for copper)
  const resistancePer1000ft: Record<string, number> = {
    '#14': 3.07,
    '#12': 1.93,
    '#10': 1.21,
    '#8': 0.778,
    '#6': 0.491,
    '#4': 0.308,
    '#3': 0.245,
    '#2': 0.194,
    '#1': 0.154,
    '1/0': 0.122,
    '2/0': 0.0967,
    '3/0': 0.0766,
    '4/0': 0.0608,
    '250': 0.0477,
  };
  
  const gaugeNum = gauge.replace(' AWG', '').replace(' AWG', '');
  const rPer1000ft = resistancePer1000ft[gaugeNum] ?? 0.0608;
  
  // Round trip = 2 × one-way length
  const totalLengthFt = lengthFt * 2;
  const totalResistance = (rPer1000ft * totalLengthFt) / 1000;
  const voltageDrop = current * totalResistance;
  const percentDrop = (voltageDrop / voltage) * 100;
  
  return { percent: percentDrop, volts: voltageDrop };
}

function calcConduitSize(bundle: ConductorBundle, conduitType: string): { size: string; fillPercent: number } {
  const bundleArea = bundle.totalAreaIn2;
  const maxFillPercent = 0.40; // NEC Ch.9 Table 1
  
  const conduitSizes = ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"'];
  
  for (const size of conduitSizes) {
    const conduitArea = CONDUIT_AREA_IN2[size];
    const fillPercent = bundleArea / conduitArea;
    
    if (fillPercent <= maxFillPercent) {
      return { size, fillPercent };
    }
  }
  
  // If we get here, 3" is not enough
  return { size: '3"', fillPercent: bundleArea / CONDUIT_AREA_IN2['3"'] };
}

function buildConductorCallout(bundle: ConductorBundle, conduitSize: string, conduitType: string, fillPercent: number): string {
  // Build permit-grade callout: "3×#10 BLK + 3×#10 RED + 1×#10 GRN IN 1" EMT — 31% fill"
  
  // Group conductors by gauge and color
  const groups = new Map<string, number>();
  for (const c of bundle.conductors) {
    const key = `${c.gauge} ${c.color}`;
    groups.set(key, (groups.get(key) || 0) + c.qty);
  }
  
  // Build callout parts
  const parts: string[] = [];
  for (const [key, qty] of groups.entries()) {
    parts.push(`${qty}×${key}`);
  }
  
  const conductorPart = parts.join(' + ');
  const conduitPart = conduitType !== 'NONE' ? `IN ${conduitSize} ${conduitType}` : 'OPEN AIR';
  const fillPart = conduitType !== 'NONE' ? ` — ${Math.round(fillPercent * 100)}% fill` : '';
  
  return `${conductorPart} ${conduitPart}${fillPart}`;
}

// ============================================================
// Main Segment Builder
// ============================================================

export function buildSegments(input: SegmentBuilderInput): SegmentBuilderOutput {
  const segments: Segment[] = [];
  const issues: EngineeringIssue[] = [];
  
  // ============================================================
  // MICROINVERTER TOPOLOGY
  // ============================================================
  
  if (input.topology === 'micro') {
    const branchCount = input.branchCount || 1;
    const maxMicrosPerBranch = input.maxMicrosPerBranch || 16;
    const microsPerBranch = Math.ceil(input.totalModules / branchCount);
    
    // Validate branch count
    if (microsPerBranch > maxMicrosPerBranch) {
      issues.push({
        severity: 'error',
        code: 'NEC_690_8B_BRANCH_LIMIT',
        message: `${microsPerBranch} micros per branch exceeds NEC 690.8(B) limit of ${maxMicrosPerBranch}`,
        necReference: 'NEC 690.8(B)',
        suggestion: `Increase branch count to at least ${Math.ceil(input.totalModules / maxMicrosPerBranch)}`,
      });
    }
    
    // Branch current (per branch circuit)
    const perMicroCurrentA = input.inverterAcOutputA;
    const branchCurrentA = perMicroCurrentA * microsPerBranch;
    const branchRequiredAmpacity = branchCurrentA * 1.25;
    
    // Branch conductors — open-air run from array to roof j-box
    const branchOpenAirSizing = autoSizeConductor(branchRequiredAmpacity, input.ambientTempC + input.rooftopTempAdderC, 2, '#10 AWG');
    const branchEgcGauge = getEGCGauge(nextStandardOCPD(branchRequiredAmpacity));
    
    const branchBundle: ConductorBundle = {
      conductors: [
        { qty: branchCount, gauge: branchOpenAirSizing.gauge, insulation: 'THWN-2', color: 'BLK', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
        { qty: branchCount, gauge: branchOpenAirSizing.gauge, insulation: 'THWN-2', color: 'RED', isCurrentCarrying: true, currentPerConductor: branchCurrentA },
        { qty: 1, gauge: branchEgcGauge, insulation: 'THWN-2', color: 'GRN', isCurrentCarrying: false, currentPerConductor: 0 },
      ],
      totalCurrentCarrying: branchCount * 2,
      totalAreaIn2: branchCount * 2 * CONDUCTOR_AREA_IN2[branchOpenAirSizing.gauge.replace(' AWG', '')] + CONDUCTOR_AREA_IN2[branchEgcGauge.replace(' AWG', '')],
    };
    
    // Branch voltage drop
    const branchVdrop = calcVoltageDrop(branchCurrentA, input.runLengths.arrayToJbox, branchOpenAirSizing.gauge, 240, 2);
    
    // SEGMENT 1: ARRAY_OPEN_AIR
    segments.push({
      id: 'ARRAY_OPEN_AIR',
      type: SegmentType.ARRAY_OPEN_AIR,
      label: 'ARRAY TO J-BOX (OPEN AIR)',
      fromNode: 'PV ARRAY WITH MICROINVERTERS',
      toNode: 'ROOF JUNCTION BOX',
      conductorBundle: branchBundle,
      conduitType: 'NONE',
      conduitSize: 'NONE',
      fillPercent: 0,
      onewayLengthFt: input.runLengths.arrayToJbox,
      continuousCurrent: branchCurrentA,
      requiredAmpacity: branchRequiredAmpacity,
      effectiveAmpacity: branchOpenAirSizing.effectiveAmpacity,
      tempDeratingFactor: branchOpenAirSizing.tempDerating,
      conduitDeratingFactor: 1.0,
      ocpdAmps: nextStandardOCPD(branchRequiredAmpacity),
      voltageDropPct: branchVdrop.percent,
      voltageDropVolts: branchVdrop.volts,
      systemVoltage: 240,
      necReferences: ['NEC 690.31', 'NEC 690.8(B)'],
      ampacityPass: branchOpenAirSizing.effectiveAmpacity >= branchRequiredAmpacity,
      voltageDropPass: branchVdrop.percent <= input.maxACVoltageDropPct,
      conduitFillPass: true,
      overallPass: branchOpenAirSizing.effectiveAmpacity >= branchRequiredAmpacity && branchVdrop.percent <= input.maxACVoltageDropPct,
      conductorCallout: buildConductorCallout(branchBundle, 'NONE', 'NONE', 0),
      phase: '1Ø',
      conductorMaterial: 'CU',
    });
    
    // Branch homerun — conduit from roof j-box to AC combiner
    const branchHomerunSizing = autoSizeConductor(branchRequiredAmpacity, input.ambientTempC, branchBundle.totalCurrentCarrying, '#10 AWG');
    const branchConduitSizing = calcConduitSize(branchBundle, input.conduitType);
    const branchHomerunVdrop = calcVoltageDrop(branchCurrentA, input.runLengths.jboxToCombiner, branchHomerunSizing.gauge, 240, 2);
    
    // SEGMENT 2: BRANCH_HOMERUN
    segments.push({
      id: 'BRANCH_HOMERUN',
      type: SegmentType.BRANCH_HOMERUN,
      label: 'J-BOX TO AC COMBINER (BRANCH HOMERUN)',
      fromNode: 'ROOF JUNCTION BOX',
      toNode: 'AC COMBINER',
      conductorBundle: branchBundle,
      conduitType: input.conduitType,
      conduitSize: branchConduitSizing.size,
      fillPercent: branchConduitSizing.fillPercent,
      onewayLengthFt: input.runLengths.jboxToCombiner,
      continuousCurrent: branchCurrentA,
      requiredAmpacity: branchRequiredAmpacity,
      effectiveAmpacity: branchHomerunSizing.effectiveAmpacity,
      tempDeratingFactor: branchHomerunSizing.tempDerating,
      conduitDeratingFactor: branchHomerunSizing.conduitDerating,
      ocpdAmps: nextStandardOCPD(branchRequiredAmpacity),
      voltageDropPct: branchHomerunVdrop.percent,
      voltageDropVolts: branchHomerunVdrop.volts,
      systemVoltage: 240,
      necReferences: ['NEC 690.31', 'NEC 690.8(B)', 'NEC 310.15'],
      ampacityPass: branchHomerunSizing.effectiveAmpacity >= branchRequiredAmpacity,
      voltageDropPass: branchHomerunVdrop.percent <= input.maxACVoltageDropPct,
      conduitFillPass: branchConduitSizing.fillPercent <= 0.40,
      overallPass: branchHomerunSizing.effectiveAmpacity >= branchRequiredAmpacity && branchHomerunVdrop.percent <= input.maxACVoltageDropPct && branchConduitSizing.fillPercent <= 0.40,
      conductorCallout: buildConductorCallout(branchBundle, branchConduitSizing.size, input.conduitType, branchConduitSizing.fillPercent),
      phase: '1Ø',
      conductorMaterial: 'CU',
    });
    
    // Feeder current — total AC output from all branches
    const totalAcCurrentA = input.inverterAcOutputA * input.inverterCount;
    const feederRequiredAmpacity = totalAcCurrentA * 1.25;
    const feederSizing = autoSizeConductor(feederRequiredAmpacity, input.ambientTempC, 2, '#6 AWG');
    const feederEgcGauge = getEGCGauge(nextStandardOCPD(feederRequiredAmpacity));
    
    const feederBundle: ConductorBundle = {
      conductors: [
        { qty: 1, gauge: feederSizing.gauge, insulation: 'THWN-2', color: 'BLK', isCurrentCarrying: true, currentPerConductor: totalAcCurrentA },
        { qty: 1, gauge: feederSizing.gauge, insulation: 'THWN-2', color: 'RED', isCurrentCarrying: true, currentPerConductor: totalAcCurrentA },
        { qty: 1, gauge: feederEgcGauge, insulation: 'THWN-2', color: 'GRN', isCurrentCarrying: false, currentPerConductor: 0 },
      ],
      totalCurrentCarrying: 2,
      totalAreaIn2: 2 * CONDUCTOR_AREA_IN2[feederSizing.gauge.replace(' AWG', '')] + CONDUCTOR_AREA_IN2[feederEgcGauge.replace(' AWG', '')],
    };
    
    const feederVdrop = calcVoltageDrop(totalAcCurrentA, input.runLengths.combinerToDisco, feederSizing.gauge, 240, 2);
    const feederConduitSizing = calcConduitSize(feederBundle, input.conduitType);
    
    // SEGMENT 3: AC_COMBINER_FEEDER
    segments.push({
      id: 'AC_COMBINER_FEEDER',
      type: SegmentType.AC_COMBINER_FEEDER,
      label: 'AC COMBINER TO AC DISCONNECT',
      fromNode: 'AC COMBINER',
      toNode: 'AC DISCONNECT',
      conductorBundle: feederBundle,
      conduitType: input.conduitType,
      conduitSize: feederConduitSizing.size,
      fillPercent: feederConduitSizing.fillPercent,
      onewayLengthFt: input.runLengths.combinerToDisco,
      continuousCurrent: totalAcCurrentA,
      requiredAmpacity: feederRequiredAmpacity,
      effectiveAmpacity: feederSizing.effectiveAmpacity,
      tempDeratingFactor: feederSizing.tempDerating,
      conduitDeratingFactor: feederSizing.conduitDerating,
      ocpdAmps: nextStandardOCPD(feederRequiredAmpacity),
      voltageDropPct: feederVdrop.percent,
      voltageDropVolts: feederVdrop.volts,
      systemVoltage: 240,
      necReferences: ['NEC 690.8', 'NEC 310.15', 'NEC 250.122'],
      ampacityPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity,
      voltageDropPass: feederVdrop.percent <= input.maxACVoltageDropPct,
      conduitFillPass: feederConduitSizing.fillPercent <= 0.40,
      overallPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity && feederVdrop.percent <= input.maxACVoltageDropPct && feederConduitSizing.fillPercent <= 0.40,
      conductorCallout: buildConductorCallout(feederBundle, feederConduitSizing.size, input.conduitType, feederConduitSizing.fillPercent),
      phase: '1Ø',
      conductorMaterial: 'CU',
    });
    
    // ============================================================
    // INTERCONNECTION SEGMENT
    // ============================================================
    
    const discoMspVdrop = calcVoltageDrop(totalAcCurrentA, input.runLengths.discoToMsp, feederSizing.gauge, 240, 2);
    const discoMspConduitSizing = calcConduitSize(feederBundle, input.conduitType);
    
    // Validate NEC 705.12(B) 120% rule for backfed breaker
    let interconnectionPass = true;
    const maxPVBreaker = Math.floor(input.mainBusRating * 1.2 - input.mainBreakerAmps);
    
    if (input.interconnectionType === InterconnectionType.BACKFED_BREAKER) {
      const computedPVBreaker = nextStandardOCPD(feederRequiredAmpacity);
      if (computedPVBreaker > maxPVBreaker) {
        interconnectionPass = false;
        issues.push({
          severity: 'error',
          code: 'NEC_705_12B_120PCT_VIOLATION',
          message: `Computed PV breaker ${computedPVBreaker}A exceeds NEC 705.12(B) limit of ${maxPVBreaker}A (${input.mainBusRating}A bus × 1.2 - ${input.mainBreakerAmps}A main)`,
          necReference: 'NEC 705.12(B)',
          suggestion: `Consider load-side tap or main breaker derate to ${Math.ceil(input.mainBusRating * 1.2 - computedPVBreaker)}A`,
        });
      }
    }
    
    // SEGMENT 4: INTERCONNECTION (based on type)
    if (input.interconnectionType === InterconnectionType.LOAD_SIDE_TAP) {
      // Load-side tap — no breaker in MSP, tap directly on bus
      segments.push({
        id: 'LOAD_SIDE_TAP_SEGMENT',
        type: SegmentType.LOAD_SIDE_TAP_SEGMENT,
        label: 'AC DISCONNECT TO LOAD SIDE TAP',
        fromNode: 'AC DISCONNECT',
        toNode: 'MAIN SERVICE PANEL (LOAD SIDE TAP)',
        conductorBundle: feederBundle,
        conduitType: input.conduitType,
        conduitSize: discoMspConduitSizing.size,
        fillPercent: discoMspConduitSizing.fillPercent,
        onewayLengthFt: input.runLengths.discoToMsp,
        continuousCurrent: totalAcCurrentA,
        requiredAmpacity: feederRequiredAmpacity,
        effectiveAmpacity: feederSizing.effectiveAmpacity,
        tempDeratingFactor: feederSizing.tempDerating,
        conduitDeratingFactor: feederSizing.conduitDerating,
        ocpdAmps: nextStandardOCPD(feederRequiredAmpacity),
        voltageDropPct: discoMspVdrop.percent,
        voltageDropVolts: discoMspVdrop.volts,
        systemVoltage: 240,
        necReferences: ['NEC 690.14', 'NEC 705.12(B)', 'NEC 310.15'],
        ampacityPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity,
        voltageDropPass: discoMspVdrop.percent <= input.maxACVoltageDropPct,
        conduitFillPass: discoMspConduitSizing.fillPercent <= 0.40,
        overallPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity && discoMspVdrop.percent <= input.maxACVoltageDropPct && discoMspConduitSizing.fillPercent <= 0.40,
        interconnectionType: input.interconnectionType,
        conductorCallout: buildConductorCallout(feederBundle, discoMspConduitSizing.size, input.conduitType, discoMspConduitSizing.fillPercent),
        phase: '1Ø',
        conductorMaterial: 'CU',
      });
    } else if (input.interconnectionType === InterconnectionType.BACKFED_BREAKER) {
      // Backfed breaker — PV breaker in MSP
      segments.push({
        id: 'BACKFED_BREAKER_SEGMENT',
        type: SegmentType.BACKFED_BREAKER_SEGMENT,
        label: `AC DISCONNECT TO BACKFED BREAKER (${maxPVBreaker}A MAX PER NEC 705.12(B))`,
        fromNode: 'AC DISCONNECT',
        toNode: 'MAIN SERVICE PANEL (BACKFED BREAKER)',
        conductorBundle: feederBundle,
        conduitType: input.conduitType,
        conduitSize: discoMspConduitSizing.size,
        fillPercent: discoMspConduitSizing.fillPercent,
        onewayLengthFt: input.runLengths.discoToMsp,
        continuousCurrent: totalAcCurrentA,
        requiredAmpacity: feederRequiredAmpacity,
        effectiveAmpacity: feederSizing.effectiveAmpacity,
        tempDeratingFactor: feederSizing.tempDerating,
        conduitDeratingFactor: feederSizing.conduitDerating,
        ocpdAmps: Math.min(nextStandardOCPD(feederRequiredAmpacity), maxPVBreaker),
        voltageDropPct: discoMspVdrop.percent,
        voltageDropVolts: discoMspVdrop.volts,
        systemVoltage: 240,
        necReferences: ['NEC 690.14', 'NEC 705.12(B)', 'NEC 310.15'],
        ampacityPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity,
        voltageDropPass: discoMspVdrop.percent <= input.maxACVoltageDropPct,
        conduitFillPass: discoMspConduitSizing.fillPercent <= 0.40,
        overallPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity && discoMspVdrop.percent <= input.maxACVoltageDropPct && discoMspConduitSizing.fillPercent <= 0.40,
        interconnectionType: input.interconnectionType,
        conductorCallout: buildConductorCallout(feederBundle, discoMspConduitSizing.size, input.conduitType, discoMspConduitSizing.fillPercent),
        phase: '1Ø',
        conductorMaterial: 'CU',
      });
    } else if (input.interconnectionType === InterconnectionType.SUPPLY_SIDE_TAP || input.interconnectionType === InterconnectionType.LINE_SIDE_TAP) {
      segments.push({
        id: 'SUPPLY_SIDE_TAP_SEGMENT',
        type: SegmentType.SUPPLY_SIDE_TAP_SEGMENT,
        label: 'AC DISCONNECT TO SUPPLY SIDE TAP',
        fromNode: 'AC DISCONNECT',
        toNode: 'UTILITY SERVICE (SUPPLY SIDE)',
        conductorBundle: feederBundle,
        conduitType: input.conduitType,
        conduitSize: discoMspConduitSizing.size,
        fillPercent: discoMspConduitSizing.fillPercent,
        onewayLengthFt: input.runLengths.discoToMsp,
        continuousCurrent: totalAcCurrentA,
        requiredAmpacity: feederRequiredAmpacity,
        effectiveAmpacity: feederSizing.effectiveAmpacity,
        tempDeratingFactor: feederSizing.tempDerating,
        conduitDeratingFactor: feederSizing.conduitDerating,
        ocpdAmps: nextStandardOCPD(feederRequiredAmpacity),
        voltageDropPct: discoMspVdrop.percent,
        voltageDropVolts: discoMspVdrop.volts,
        systemVoltage: 240,
        necReferences: ['NEC 705.11', 'NEC 230.82', 'NEC 310.15'],
        ampacityPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity,
        voltageDropPass: discoMspVdrop.percent <= input.maxACVoltageDropPct,
        conduitFillPass: discoMspConduitSizing.fillPercent <= 0.40,
        overallPass: feederSizing.effectiveAmpacity >= feederRequiredAmpacity && discoMspVdrop.percent <= input.maxACVoltageDropPct && discoMspConduitSizing.fillPercent <= 0.40,
        interconnectionType: input.interconnectionType,
        conductorCallout: buildConductorCallout(feederBundle, discoMspConduitSizing.size, input.conduitType, discoMspConduitSizing.fillPercent),
        phase: '1Ø',
        conductorMaterial: 'CU',
      });
    }
    
    // SEGMENT 5: UTILITY_SERVICE_ENTRANCE (shown for reference only, not in BOM)
    segments.push({
      id: 'UTILITY_SERVICE_ENTRANCE',
      type: SegmentType.UTILITY_SERVICE_ENTRANCE,
      label: 'UTILITY SERVICE ENTRANCE (BY UTILITY)',
      fromNode: 'MAIN SERVICE PANEL',
      toNode: 'UTILITY METER',
      conductorBundle: {
        conductors: [
          { qty: 1, gauge: '#2 AWG', insulation: 'THWN-2', color: 'BLK', isCurrentCarrying: true, currentPerConductor: input.mainBreakerAmps },
          { qty: 1, gauge: '#2 AWG', insulation: 'THWN-2', color: 'RED', isCurrentCarrying: true, currentPerConductor: input.mainBreakerAmps },
          { qty: 1, gauge: '#2 AWG', insulation: 'THWN-2', color: 'WHI', isCurrentCarrying: true, currentPerConductor: 0 }, // Neutral
          { qty: 1, gauge: '#4 AWG', insulation: 'THWN-2', color: 'GRN', isCurrentCarrying: false, currentPerConductor: 0 },
        ],
        totalCurrentCarrying: 3,
        totalAreaIn2: 3 * CONDUCTOR_AREA_IN2['2'] + CONDUCTOR_AREA_IN2['4'],
      },
      conduitType: 'EMT',
      conduitSize: '2"',
      fillPercent: 0,
      onewayLengthFt: input.runLengths.mspToUtility,
      continuousCurrent: input.mainBreakerAmps,
      requiredAmpacity: input.mainBreakerAmps,
      effectiveAmpacity: AMPACITY_TABLE_75C['#2 AWG'],
      tempDeratingFactor: 1.0,
      conduitDeratingFactor: 1.0,
      ocpdAmps: input.mainBreakerAmps,
      voltageDropPct: 0,
      voltageDropVolts: 0,
      systemVoltage: 240,
      necReferences: ['NEC 230.42', 'NEC 230.54'],
      ampacityPass: true,
      voltageDropPass: true,
      conduitFillPass: true,
      overallPass: true,
      isUtilityOwned: true,
      conductorCallout: 'UTILITY-OWNED SERVICE CONDUCTORS — NOT IN PV BOM',
      phase: '1Ø',
      conductorMaterial: 'CU',
    });
  }
  
  // ============================================================
  // STRING INVERTER TOPOLOGY (TODO)
  // ============================================================
  
  // String inverter segments will be added in next phase
  
  return {
    segments,
    interconnectionPass: issues.filter(i => i.code === 'NEC_705_12B_120PCT_VIOLATION').length === 0,
    issues,
  };
}