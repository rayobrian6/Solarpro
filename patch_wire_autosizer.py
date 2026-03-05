#!/usr/bin/env python3
"""Append per-segment calculation functions to wire-autosizer.ts"""

APPEND_CODE = '''
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
      segmentLabel: seg.label.replace(/\\n/g, ' '),
      from: fromDevice?.label?.replace(/\\n/g, ' ') ?? '—',
      to: toDevice?.label?.replace(/\\n/g, ' ') ?? '—',
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
'''

with open('/workspace/solarpro-v5/solarpro-v3.1/lib/wire-autosizer.ts', 'a', encoding='utf-8') as f:
    f.write(APPEND_CODE)

print("Done — appended per-segment calc functions to wire-autosizer.ts")