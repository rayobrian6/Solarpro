// ============================================================
// AC Wire Auto-Sizing Engine
// NEC 690.8 / 310.15 — Iterative AWG selection
// No "upgrade wire gauge" message without resolution.
// ============================================================
//
// Algorithm:
//   1. requiredAmpacity = inverter.maxACOutputCurrent × 1.25  [NEC 690.8 / 705.12]
//   2. Apply temperature derating factor (NEC Table 310.15(B)(2)(a))
//   3. Apply conduit fill derating factor (NEC 310.15(C)(1))
//   4. effectiveAmpacity = tableAmpacity × tempDerating × conduitDerating
//   5. Start at #10 AWG → check effectiveAmpacity ≥ requiredAmpacity
//      If not → bump to #8 → #6 → #4 → #2 → #1 → #1/0 → #2/0
//   6. For each candidate gauge, also check voltage drop ≤ maxVDropPct
//      If voltage drop fails → continue bumping
//   7. Return selected gauge + full resolution log
//
// ============================================================

import {
  AWG_ORDER,
  getConductorSpec,
  getTempDeratingFactor,
  getConduitFillDeratingFactor,
  calcVoltageDrop,
  getSmallestConduit,
  getConductorArea,
} from './manufacturer-specs';
import { Conductor } from './equipment-db';

export interface WireAutoSizerInput {
  // Inverter parameters
  inverterMaxACOutputCurrent: number; // A — from inverter datasheet
  inverterACOutputKw: number;         // kW — for voltage drop calc
  systemVoltage: number;              // V — typically 240V single-phase

  // Environmental
  ambientTempC: number;               // °C — design max ambient
  rooftopTempAdderC?: number;         // °C — added for rooftop runs (default 0 for AC)

  // Run parameters
  onewayLengthFt: number;             // feet — one-way wire run length
  currentCarryingConductors: number;  // count — for conduit fill derating (typically 3 for 240V)
  conduitType: string;                // 'EMT', 'PVC Sch 40', etc.

  // Compliance thresholds
  maxVoltageDropPct: number;          // % — typically 2% for AC (NABCEP best practice)
  startingGauge?: string;             // default '#10 AWG' — start of iteration

  // Mode
  mode: 'AUTO' | 'MANUAL';
  manualGaugeOverride?: string;       // only used in MANUAL mode
}

export interface WireAutoSizerResult {
  // Selected conductor
  selectedGauge: string;
  selectedConductor: Conductor;

  // Calculated values
  requiredAmpacity: number;           // A — before derating
  tempDeratingFactor: number;
  conduitFillDeratingFactor: number;
  effectiveAmpacity: number;          // A — after all derating
  voltageDrop: number;                // %
  voltageDropVolts: number;           // V

  // Conduit sizing
  conduitSize: string;
  conduitFillPercent: number;

  // Status
  ampacityPass: boolean;
  voltageDropPass: boolean;
  overallPass: boolean;

  // Auto-sizing metadata
  wasAutoSized: boolean;              // true if gauge was bumped from starting gauge
  startingGauge: string;
  iterationsRequired: number;
  mode: 'AUTO' | 'MANUAL';

  // Full resolution log
  autoAdjustmentLog: WireAutoSizeStep[];

  // Conductor callout (permit-grade format)
  conductorCallout: string;           // e.g. "2#8 AWG THWN-2 + 1#10 GND in 3/4" EMT"
  egcGauge: string;
}

export interface WireAutoSizeStep {
  iteration: number;
  gauge: string;
  tableAmpacity: number;
  tempDerating: number;
  conduitDerating: number;
  effectiveAmpacity: number;
  requiredAmpacity: number;
  ampacityPass: boolean;
  voltageDrop: number;
  voltageDropPass: boolean;
  action: 'SELECTED' | 'BUMPED_AMPACITY' | 'BUMPED_VDROP' | 'FAILED';
  reason: string;
  necReference: string;
}

// ─── EGC sizing per NEC Table 250.122 ────────────────────────────────────────

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

// ─── Conductor callout formatter ──────────────────────────────────────────────

function formatConductorCallout(
  hotConductorCount: number,
  gauge: string,
  egcGauge: string,
  conduitSize: string,
  conduitType: string
): string {
  // Format: "2#8 AWG THWN-2 + 1#10 AWG GND in 3/4" EMT"
  const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
  const egcNum = egcGauge.replace('#', '').replace(' AWG', '');
  const conduitAbbrev = conduitType === 'EMT' ? 'EMT'
    : conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
    : conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
    : conduitType;
  return `${hotConductorCount}#${gaugeNum} AWG THWN-2 + 1#${egcNum} AWG GND in ${conduitSize} ${conduitAbbrev}`;
}

// ─── Main Auto-Sizing Function ────────────────────────────────────────────────

export function autoSizeACWire(input: WireAutoSizerInput): WireAutoSizerResult {
  const log: WireAutoSizeStep[] = [];

  // In MANUAL mode with override, just validate the specified gauge
  const startGauge = input.mode === 'MANUAL' && input.manualGaugeOverride
    ? input.manualGaugeOverride
    : (input.startingGauge ?? '#10 AWG');

  // NEC 690.8 / 705.12: 125% of inverter AC output current for continuous load
  const requiredAmpacity = input.inverterMaxACOutputCurrent * 1.25;

  // Effective ambient for AC conductors (no rooftop adder for AC runs typically)
  const effectiveAmbient = input.ambientTempC + (input.rooftopTempAdderC ?? 0);
  const tempDerating = getTempDeratingFactor(effectiveAmbient);
  const conduitDerating = getConduitFillDeratingFactor(input.currentCarryingConductors);

  // Determine starting index in AWG_ORDER
  const startIdx = AWG_ORDER.indexOf(startGauge);
  const searchStart = startIdx === -1 ? 2 : startIdx; // default to #10 AWG (index 2)

  let selectedGauge: string | null = null;
  let selectedConductor: Conductor | null = null;
  let iterations = 0;

  for (let i = searchStart; i < AWG_ORDER.length; i++) {
    const gauge = AWG_ORDER[i];
    const cond = getConductorSpec(gauge);
    if (!cond) continue;

    iterations++;

    // Use 75°C column for AC circuits (NEC 110.14(C) — equipment terminals rated 75°C)
    const tableAmpacity = cond.ampacity_75c;
    const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
    const ampacityPass = effectiveAmpacity >= requiredAmpacity;

    // Voltage drop check
    const vdrop = calcVoltageDrop(
      input.inverterMaxACOutputCurrent,
      input.onewayLengthFt,
      gauge,
      input.systemVoltage
    );
    const vdropPass = vdrop <= input.maxVoltageDropPct;

    let action: WireAutoSizeStep['action'];
    let reason: string;
    let necRef: string;

    if (!ampacityPass) {
      action = 'BUMPED_AMPACITY';
      reason = `Effective ampacity ${effectiveAmpacity.toFixed(1)}A (${tableAmpacity}A × ${tempDerating.toFixed(2)} temp × ${conduitDerating.toFixed(2)} conduit) < required ${requiredAmpacity.toFixed(1)}A. Bumping to next gauge.`;
      necRef = 'NEC 690.8 / 310.15';
    } else if (!vdropPass) {
      action = 'BUMPED_VDROP';
      reason = `Ampacity OK (${effectiveAmpacity.toFixed(1)}A ≥ ${requiredAmpacity.toFixed(1)}A) but voltage drop ${vdrop.toFixed(2)}% > ${input.maxVoltageDropPct}% limit. Bumping to next gauge.`;
      necRef = 'NEC 210.19 / NABCEP best practice';
    } else {
      action = 'SELECTED';
      reason = `Effective ampacity ${effectiveAmpacity.toFixed(1)}A ≥ required ${requiredAmpacity.toFixed(1)}A AND voltage drop ${vdrop.toFixed(2)}% ≤ ${input.maxVoltageDropPct}%. Selected.`;
      necRef = 'NEC 690.8 / 310.15 / 210.19';
    }

    log.push({
      iteration: iterations,
      gauge,
      tableAmpacity,
      tempDerating,
      conduitDerating,
      effectiveAmpacity,
      requiredAmpacity,
      ampacityPass,
      voltageDrop: vdrop,
      voltageDropPass: vdropPass,
      action,
      reason,
      necReference: necRef,
    });

    if (action === 'SELECTED') {
      selectedGauge = gauge;
      selectedConductor = cond;
      break;
    }

    // In MANUAL mode, don't auto-bump — just report the failure
    if (input.mode === 'MANUAL') {
      log[log.length - 1].action = 'FAILED';
      log[log.length - 1].reason = `MANUAL MODE: ${reason} Override accepted but non-compliant.`;
      selectedGauge = gauge;
      selectedConductor = cond;
      break;
    }
  }

  // Fallback if nothing selected (shouldn't happen with #2/0 AWG available)
  if (!selectedGauge || !selectedConductor) {
    selectedGauge = '#2/0 AWG';
    selectedConductor = getConductorSpec('#2/0 AWG')!;
    log.push({
      iteration: iterations + 1,
      gauge: selectedGauge,
      tableAmpacity: selectedConductor?.ampacity_75c ?? 0,
      tempDerating,
      conduitDerating,
      effectiveAmpacity: (selectedConductor?.ampacity_75c ?? 0) * tempDerating * conduitDerating,
      requiredAmpacity,
      ampacityPass: false,
      voltageDrop: 0,
      voltageDropPass: false,
      action: 'FAILED',
      reason: 'No compliant gauge found in standard table. Manual engineering review required.',
      necReference: 'NEC 310.15',
    });
  }

  // Final calculations for selected gauge
  const finalCond = selectedConductor!;
  const finalTableAmpacity = finalCond.ampacity_75c;
  const finalEffectiveAmpacity = finalTableAmpacity * tempDerating * conduitDerating;
  const finalVdrop = calcVoltageDrop(
    input.inverterMaxACOutputCurrent,
    input.onewayLengthFt,
    selectedGauge,
    input.systemVoltage
  );
  const finalVdropVolts = (finalVdrop / 100) * input.systemVoltage;

  // Conduit sizing for selected gauge
  // 240V single-phase: 2 hots + 1 neutral + 1 EGC = 4 conductors, 3 current-carrying
  // If conduit fill > 40%, upsize wire gauge until fill <= 40%
  const hotCount = input.currentCarryingConductors; // typically 3 (L1, L2, N)

  let finalGaugeForConduit = selectedGauge;
  let conduit = getSmallestConduit(input.conduitType, getConductorArea(selectedGauge) * (hotCount + 1));
  let conduitFillPct = conduit ? (getConductorArea(selectedGauge) * (hotCount + 1) / conduit.area) * 100 : 100;

  // Upsize wire if conduit fill exceeds 40% NEC limit
  const AWG_UPSIZE = ['#14 AWG','#12 AWG','#10 AWG','#8 AWG','#6 AWG','#4 AWG','#3 AWG','#2 AWG','#1 AWG','#1/0 AWG','#2/0 AWG','#3/0 AWG','#4/0 AWG'];
  let gaugeIdx = AWG_UPSIZE.indexOf(selectedGauge);
  while (conduitFillPct > 40 && gaugeIdx < AWG_UPSIZE.length - 1) {
    gaugeIdx++;
    finalGaugeForConduit = AWG_UPSIZE[gaugeIdx];
    const area = getConductorArea(finalGaugeForConduit) * (hotCount + 1);
    conduit = getSmallestConduit(input.conduitType, area);
    conduitFillPct = conduit ? (area / conduit.area) * 100 : 100;
  }

  const conduitSize = conduit?.tradeSize ?? '3/4"';

  // EGC sizing based on OCPD (use requiredAmpacity as proxy for OCPD)
  const egcGauge = getEGCGauge(Math.ceil(requiredAmpacity));

  // Conductor callout
  const callout = formatConductorCallout(
    hotCount,
    selectedGauge,
    egcGauge,
    conduitSize,
    input.conduitType
  );

  const ampacityPass = finalEffectiveAmpacity >= requiredAmpacity;
  const vdropPass = finalVdrop <= input.maxVoltageDropPct;

  return {
    selectedGauge,
    selectedConductor: finalCond,
    requiredAmpacity,
    tempDeratingFactor: tempDerating,
    conduitFillDeratingFactor: conduitDerating,
    effectiveAmpacity: finalEffectiveAmpacity,
    voltageDrop: finalVdrop,
    voltageDropVolts: finalVdropVolts,
    conduitSize,
    conduitFillPercent: conduitFillPct,
    ampacityPass,
    voltageDropPass: vdropPass,
    overallPass: ampacityPass && vdropPass,
    wasAutoSized: selectedGauge !== startGauge,
    startingGauge: startGauge,
    iterationsRequired: iterations,
    mode: input.mode,
    autoAdjustmentLog: log,
    conductorCallout: callout,
    egcGauge,
  };
}

// ─── DC String Wire Auto-Sizing ───────────────────────────────────────────────
// Separate function for DC string conductors (USE-2 / PV Wire, 90°C column)

export interface DCWireAutoSizerInput {
  stringId: string;
  maxCurrentNEC: number;          // A — Isc_corrected × 1.25 (from OCPD resolver)
  onewayLengthFt: number;
  systemVoltage: number;          // V — string Vmp for voltage drop
  ambientTempC: number;
  rooftopTempAdderC: number;      // DC strings are always on rooftop
  conduitType: string;
  maxVoltageDropPct: number;      // typically 3% for DC
  startingGauge?: string;         // default '#10 AWG'
  mode: 'AUTO' | 'MANUAL';
  manualGaugeOverride?: string;
}

export interface DCWireAutoSizerResult {
  stringId: string;
  selectedGauge: string;
  effectiveAmpacity: number;
  voltageDrop: number;
  overallPass: boolean;
  wasAutoSized: boolean;
  conductorCallout: string;
  autoAdjustmentLog: WireAutoSizeStep[];
}

export function autoSizeDCWire(input: DCWireAutoSizerInput): DCWireAutoSizerResult {
  const log: WireAutoSizeStep[] = [];
  const startGauge = input.mode === 'MANUAL' && input.manualGaugeOverride
    ? input.manualGaugeOverride
    : (input.startingGauge ?? '#10 AWG');

  // DC rooftop: use 90°C column with full rooftop temp adder
  const effectiveAmbient = input.ambientTempC + input.rooftopTempAdderC;
  const tempDerating = getTempDeratingFactor(effectiveAmbient);
  const conduitDerating = getConduitFillDeratingFactor(2); // 2 conductors per string (+ and -)

  const startIdx = AWG_ORDER.indexOf(startGauge);
  const searchStart = startIdx === -1 ? 2 : startIdx;

  let selectedGauge = startGauge;
  let iterations = 0;

  for (let i = searchStart; i < AWG_ORDER.length; i++) {
    const gauge = AWG_ORDER[i];
    const cond = getConductorSpec(gauge);
    if (!cond) continue;

    iterations++;

    // DC strings: use 90°C column (USE-2 / PV Wire rated 90°C)
    const tableAmpacity = cond.ampacity_90c;
    const effectiveAmpacity = tableAmpacity * tempDerating * conduitDerating;
    const ampacityPass = effectiveAmpacity >= input.maxCurrentNEC;

    const vdrop = calcVoltageDrop(
      input.maxCurrentNEC / 1.25, // use Isc_corrected (not × 1.25) for VD calc
      input.onewayLengthFt,
      gauge,
      input.systemVoltage
    );
    const vdropPass = vdrop <= input.maxVoltageDropPct;

    let action: WireAutoSizeStep['action'];
    let reason: string;

    if (!ampacityPass) {
      action = 'BUMPED_AMPACITY';
      reason = `DC: Effective ampacity ${effectiveAmpacity.toFixed(1)}A < required ${input.maxCurrentNEC.toFixed(1)}A. Bumping.`;
    } else if (!vdropPass) {
      action = 'BUMPED_VDROP';
      reason = `DC: Ampacity OK but voltage drop ${vdrop.toFixed(2)}% > ${input.maxVoltageDropPct}%. Bumping.`;
    } else {
      action = 'SELECTED';
      reason = `DC: Ampacity ${effectiveAmpacity.toFixed(1)}A ≥ ${input.maxCurrentNEC.toFixed(1)}A AND VD ${vdrop.toFixed(2)}% ≤ ${input.maxVoltageDropPct}%. Selected.`;
    }

    log.push({
      iteration: iterations,
      gauge,
      tableAmpacity,
      tempDerating,
      conduitDerating,
      effectiveAmpacity,
      requiredAmpacity: input.maxCurrentNEC,
      ampacityPass,
      voltageDrop: vdrop,
      voltageDropPass: vdropPass,
      action,
      reason,
      necReference: 'NEC 690.8 / 310.15',
    });

    selectedGauge = gauge;

    if (action === 'SELECTED' || input.mode === 'MANUAL') break;
  }

  const finalCond = getConductorSpec(selectedGauge);
  const finalAmpacity = finalCond
    ? finalCond.ampacity_90c * tempDerating * conduitDerating
    : 0;
  const finalVdrop = calcVoltageDrop(
    input.maxCurrentNEC / 1.25,
    input.onewayLengthFt,
    selectedGauge,
    input.systemVoltage
  );

  const gaugeNum = selectedGauge.replace('#', '').replace(' AWG', '');
  const callout = `2#${gaugeNum} AWG USE-2/PV Wire in ${input.conduitType}`;

  return {
    stringId: input.stringId,
    selectedGauge,
    effectiveAmpacity: finalAmpacity,
    voltageDrop: finalVdrop,
    overallPass: finalAmpacity >= input.maxCurrentNEC && finalVdrop <= input.maxVoltageDropPct,
    wasAutoSized: selectedGauge !== startGauge,
    conductorCallout: callout,
    autoAdjustmentLog: log,
  };
}
// ─── Per-Segment Calculation Engine ──────────────────────────────────────────
// Computes full NEC-compliant electrical values for each RUN_SEGMENT node
// in an SLDTopologyGraph. Populates all RunSegment fields in-place.
// ─────────────────────────────────────────────────────────────────────────────

import type { SLDTopologyGraph, RunSegment, SLDNode } from './topology-engine';

export interface SegmentCalcParams {
  // Environmental
  ambientTempC: number;           // design max ambient (°C)
  rooftopTempAdderC: number;      // added for rooftop DC runs
  // System
  systemVoltageAC: number;        // typically 240V
  systemVoltageDC: number;        // string Voc × 1.25
  // Inverter AC output
  inverterACOutputAmps: number;   // from inverter datasheet
  inverterACOutputKw: number;
  // DC string
  stringIscCorrected: number;     // Isc × 1.25 × temp correction
  // Run lengths (ft) — keyed by RunSegmentId
  runLengths: Record<string, number>;
  // Compliance thresholds
  maxACVoltageDropPct: number;    // typically 2%
  maxDCVoltageDropPct: number;    // typically 3%
}

export interface SegmentCalcResult {
  segmentId: string;
  conductorCallout: string;
  conduitSize: string;
  conduitFillPercent: number;
  ampacityPass: boolean;
  voltageDropPass: boolean;
  overallPass: boolean;
  necReferences: string[];
  // Full wire-sizer result for audit trail
  wiresizer?: WireAutoSizerResult;
}

/**
 * Calculate electrical values for a single RUN_SEGMENT node.
 * Updates the node.runSegment fields in-place and returns a summary.
 */
export function calcSegment(
  node: SLDNode,
  params: SegmentCalcParams
): SegmentCalcResult | null {
  if (node.type !== 'RUN_SEGMENT' || !node.runSegment) return null;

  const seg = node.runSegment;
  const isDC = seg.color === 'dc';
  const runLengthFt = params.runLengths[seg.id] ?? 20; // default 20ft if not specified

  // Determine current for this segment
  const current = isDC
    ? params.stringIscCorrected
    : params.inverterACOutputAmps;

  const voltage = isDC ? params.systemVoltageDC : params.systemVoltageAC;
  const maxVdrop = isDC ? params.maxDCVoltageDropPct : params.maxACVoltageDropPct;
  const tempAdder = isDC ? params.rooftopTempAdderC : 0;

  // Run the wire auto-sizer
  const wiresizer = autoSizeACWire({
    inverterMaxACOutputCurrent: current,
    inverterACOutputKw: isDC ? (current * voltage / 1000) : params.inverterACOutputKw,
    systemVoltage: voltage,
    ambientTempC: params.ambientTempC,
    rooftopTempAdderC: tempAdder,
    onewayLengthFt: runLengthFt,
    currentCarryingConductors: seg.conductorCount,
    conduitType: seg.conduitType,
    maxVoltageDropPct: maxVdrop,
    startingGauge: seg.conductorGauge,
    mode: 'AUTO',
  });

  // Update the RunSegment in-place with calculated values
  seg.conductorGauge = wiresizer.selectedGauge;
  seg.egcGauge = wiresizer.egcGauge;
  seg.conduitSize = wiresizer.conduitSize;
  seg.conduitFillPercent = wiresizer.conduitFillPercent;
  seg.onewayLengthFt = runLengthFt;
  seg.continuousCurrent = current;
  seg.requiredAmpacity = wiresizer.requiredAmpacity;
  seg.effectiveAmpacity = wiresizer.effectiveAmpacity;
  seg.tempDeratingFactor = wiresizer.tempDeratingFactor;
  seg.conduitFillDeratingFactor = wiresizer.conduitFillDeratingFactor;
  seg.ocpdAmps = Math.ceil(wiresizer.requiredAmpacity / 5) * 5; // round up to next 5A
  seg.voltageDropPct = wiresizer.voltageDrop;
  seg.voltageDropVolts = wiresizer.voltageDropVolts;
  seg.ampacityPass = wiresizer.ampacityPass;
  seg.voltageDropPass = wiresizer.voltageDropPass;
  seg.overallPass = wiresizer.overallPass;
  seg.conductorCallout = wiresizer.conductorCallout;

  // Build NEC references
  const refs = [...seg.necReferences];
  if (!refs.includes('NEC 690.8')) refs.push('NEC 690.8');
  if (!refs.includes('NEC 310.15')) refs.push('NEC 310.15');
  if (seg.neutralRequired && !refs.includes('NEC 200.6')) refs.push('NEC 200.6');
  seg.necReferences = refs;

  return {
    segmentId: seg.id,
    conductorCallout: seg.conductorCallout,
    conduitSize: seg.conduitSize,
    conduitFillPercent: seg.conduitFillPercent,
    ampacityPass: seg.ampacityPass,
    voltageDropPass: seg.voltageDropPass,
    overallPass: seg.overallPass,
    necReferences: seg.necReferences,
    wiresizer,
  };
}

/**
 * Calculate all RUN_SEGMENT nodes in an SLDTopologyGraph.
 * Mutates the graph nodes in-place (updates runSegment fields).
 * Returns a map of segmentId → SegmentCalcResult.
 */
export function calcAllSegments(
  graph: SLDTopologyGraph,
  params: SegmentCalcParams
): Map<string, SegmentCalcResult> {
  const results = new Map<string, SegmentCalcResult>();

  for (const node of graph.nodes) {
    if (node.type !== 'RUN_SEGMENT') continue;
    const result = calcSegment(node, params);
    if (result) {
      results.set(result.segmentId, result);
    }
  }

  return results;
}

/**
 * Build a permit-grade conduit schedule table data structure
 * from a calculated SLDTopologyGraph.
 */
export interface ConduitScheduleRow {
  raceway: string;          // e.g. 'C-1'
  segmentLabel: string;     // e.g. 'Roof Run (DC)'
  from: string;
  to: string;
  conduitType: string;
  conduitSize: string;
  conductors: string;       // e.g. '2#10 AWG THWN-2'
  egc: string;              // e.g. '1#10 AWG GND'
  neutral: string;          // e.g. '1#10 AWG N' or 'N/A'
  lengthFt: number;
  fillPercent: number;
  ampacity: string;         // e.g. '30A (derated)'
  ocpd: string;             // e.g. '30A CB'
  voltageDrop: string;      // e.g. '1.2%'
  pass: boolean;
}

export function buildConduitSchedule(
  graph: SLDTopologyGraph
): ConduitScheduleRow[] {
  const rows: ConduitScheduleRow[] = [];
  let racewayCtr = 1;

  // Build edge map for from/to labels
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  for (const edge of graph.edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) continue;

    // The RUN_SEGMENT is either from or to
    const runNode = fromNode.type === 'RUN_SEGMENT' ? fromNode : toNode;
    const deviceNode = fromNode.type === 'RUN_SEGMENT' ? toNode : fromNode;

    if (runNode.type !== 'RUN_SEGMENT' || !runNode.runSegment) continue;

    // Only emit one row per run segment (skip the second edge for each segment)
    if (rows.find(r => r.raceway.includes(runNode.id as string))) continue;

    const seg = runNode.runSegment;
    const gaugeNum = seg.conductorGauge.replace('#', '').replace(' AWG', '');
    const egcNum = seg.egcGauge.replace('#', '').replace(' AWG', '');

    // Find the other device connected to this run segment
    const connectedEdges = graph.edges.filter(
      e => e.from === runNode.id || e.to === runNode.id
    );
    const fromDevice = connectedEdges[0]
      ? nodeMap.get(connectedEdges[0].from === runNode.id ? connectedEdges[0].to : connectedEdges[0].from)
      : undefined;
    const toDevice = connectedEdges[1]
      ? nodeMap.get(connectedEdges[1].from === runNode.id ? connectedEdges[1].to : connectedEdges[1].from)
      : undefined;

    rows.push({
      raceway: `C-${racewayCtr++}`,
      segmentLabel: seg.label.replace(/\n/g, ' '),
      from: fromDevice?.label?.replace(/\n/g, ' ') ?? '—',
      to: toDevice?.label?.replace(/\n/g, ' ') ?? '—',
      conduitType: seg.conduitType,
      conduitSize: seg.conduitSize,
      conductors: `${seg.conductorCount}#${gaugeNum} AWG ${seg.conductorInsulation}`,
      egc: `1#${egcNum} AWG GND`,
      neutral: seg.neutralRequired ? `1#${gaugeNum} AWG N` : 'N/A',
      lengthFt: seg.onewayLengthFt,
      fillPercent: Math.round(seg.conduitFillPercent),
      ampacity: `${seg.effectiveAmpacity.toFixed(0)}A`,
      ocpd: `${seg.ocpdAmps}A`,
      voltageDrop: `${seg.voltageDropPct.toFixed(1)}%`,
      pass: seg.overallPass,
    });
  }

  return rows;
}
