#!/usr/bin/env python3
"""Append RUN_SEGMENT topology model to topology-engine.ts"""

APPEND_CODE = '''
// ─── RUN_SEGMENT Topology Model ──────────────────────────────────────────────
// NON-NEGOTIABLE: Every device-to-device connection MUST have an explicit
// RUN_SEGMENT node between them. No direct device-to-device edges allowed.
//
// Full topology path (microinverter example):
//   PV_ARRAY → ROOF_RUN → MICROINVERTERS → BRANCH_RUN → AC_COMBINER
//   → COMBINER_TO_DISCO_RUN → AC_DISCONNECT → DISCO_TO_METER_RUN
//   → PRODUCTION_METER → METER_TO_MSP_RUN → MAIN_SERVICE_PANEL
//   → MSP_TO_UTILITY_RUN → UTILITY_GRID
// ─────────────────────────────────────────────────────────────────────────────

export type SLDNodeType =
  | 'PV_ARRAY'
  | 'MICROINVERTERS'
  | 'STRING_INVERTER'
  | 'OPTIMIZER_ARRAY'
  | 'SOLADECK'
  | 'ROOF_JBOX'
  | 'AC_COMBINER'
  | 'AC_DISCONNECT'
  | 'DC_DISCONNECT'
  | 'PRODUCTION_METER'
  | 'MAIN_SERVICE_PANEL'
  | 'UTILITY_GRID'
  | 'BATTERY'
  | 'GATEWAY'
  | 'RUN_SEGMENT';   // ← the mandatory connector node

export type RunSegmentId =
  | 'ROOF_RUN'
  | 'BRANCH_RUN'
  | 'COMBINER_TO_DISCO_RUN'
  | 'DISCO_TO_METER_RUN'
  | 'METER_TO_MSP_RUN'
  | 'MSP_TO_UTILITY_RUN'
  | 'DC_STRING_RUN'
  | 'DC_COMBINER_RUN'
  | 'DC_DISCO_TO_INV_RUN'
  | 'INV_TO_DISCO_RUN'
  | 'CUSTOM_RUN';

export interface RunSegment {
  id: RunSegmentId | string;
  label: string;
  // Electrical parameters (populated by calcAllSegments)
  conductorCount: number;          // number of current-carrying conductors
  conductorGauge: string;          // e.g. '#10 AWG'
  conductorMaterial: 'CU' | 'AL';
  conductorInsulation: string;     // 'THWN-2' | 'USE-2' | 'PV Wire'
  egcGauge: string;                // Equipment Grounding Conductor gauge
  neutralRequired: boolean;
  conduitType: string;             // 'EMT' | 'PVC Sch 40' | 'PVC Sch 80'
  conduitSize: string;             // '3/4"' | '1"' etc.
  conduitFillPercent: number;      // NEC Ch.9 Table 1 — max 40%
  onewayLengthFt: number;
  // Ampacity
  continuousCurrent: number;       // A — actual load current
  requiredAmpacity: number;        // A — continuous × 1.25 (NEC 690.8)
  effectiveAmpacity: number;       // A — after temp + conduit derating
  tempDeratingFactor: number;
  conduitFillDeratingFactor: number;
  ocpdAmps: number;                // OCPD protecting this segment
  // Voltage drop
  voltageDropPct: number;
  voltageDropVolts: number;
  // Compliance
  ampacityPass: boolean;
  voltageDropPass: boolean;
  overallPass: boolean;
  necReferences: string[];
  // Display
  conductorCallout: string;        // permit-grade: '2#10 AWG THWN-2 + 1#10 AWG GND in 3/4" EMT'
  color: 'dc' | 'ac' | 'gnd';
}

export interface SLDNode {
  id: string;
  type: SLDNodeType;
  label: string;
  // Device info (for device nodes)
  manufacturer?: string;
  model?: string;
  qty?: number;
  ratedVoltage?: string;
  ratedCurrent?: string;
  ratedPower?: string;
  ocpdRating?: string;
  necReference?: string;
  // Run segment data (for RUN_SEGMENT nodes)
  runSegment?: RunSegment;
  // Layout hints
  layoutOrder: number;             // 0 = top (PV), higher = lower on diagram
}

export interface SLDEdge {
  from: string;   // SLDNode.id
  to: string;     // SLDNode.id
  // INVARIANT: at least one of from/to must be a RUN_SEGMENT node
  // Direct device-to-device edges are FORBIDDEN
}

export interface SLDTopologyGraph {
  nodes: SLDNode[];
  edges: SLDEdge[];
  // Validation
  hasDirectDeviceEdges: boolean;   // must be false for permit-grade SLD
  validationErrors: string[];
}

// ─── Topology Graph Builder ───────────────────────────────────────────────────

export interface SLDGraphInput {
  topology: TopologyType;
  // Array
  totalModules: number;
  totalStrings: number;
  panelModel: string;
  panelWatts: number;
  panelVoc: number;
  panelIsc: number;
  // Inverter
  inverterManufacturer: string;
  inverterModel: string;
  acOutputKw: number;
  acOutputAmps: number;
  // Optional devices
  optimizerManufacturer?: string;
  optimizerModel?: string;
  gatewayModel?: string;
  batteryModel?: string;
  batteryManufacturer?: string;
  batteryKwh?: number;
  // Panel
  mainPanelAmps: number;
  mainPanelBrand?: string;
  backfeedAmps: number;
  // Wire defaults (will be refined by calcAllSegments)
  dcWireGauge: string;
  dcConduitType: string;
  acWireGauge: string;
  acConduitType: string;
  acWireLength: number;
  dcOCPD: number;
  acOCPD: number;
}

function makeRunNode(
  id: RunSegmentId | string,
  label: string,
  order: number,
  partial: Partial<RunSegment> = {}
): SLDNode {
  const seg: RunSegment = {
    id,
    label,
    conductorCount: partial.conductorCount ?? 2,
    conductorGauge: partial.conductorGauge ?? '#10 AWG',
    conductorMaterial: partial.conductorMaterial ?? 'CU',
    conductorInsulation: partial.conductorInsulation ?? 'THWN-2',
    egcGauge: partial.egcGauge ?? '#10 AWG',
    neutralRequired: partial.neutralRequired ?? false,
    conduitType: partial.conduitType ?? 'EMT',
    conduitSize: partial.conduitSize ?? '3/4"',
    conduitFillPercent: partial.conduitFillPercent ?? 0,
    onewayLengthFt: partial.onewayLengthFt ?? 0,
    continuousCurrent: partial.continuousCurrent ?? 0,
    requiredAmpacity: partial.requiredAmpacity ?? 0,
    effectiveAmpacity: partial.effectiveAmpacity ?? 0,
    tempDeratingFactor: partial.tempDeratingFactor ?? 1.0,
    conduitFillDeratingFactor: partial.conduitFillDeratingFactor ?? 1.0,
    ocpdAmps: partial.ocpdAmps ?? 0,
    voltageDropPct: partial.voltageDropPct ?? 0,
    voltageDropVolts: partial.voltageDropVolts ?? 0,
    ampacityPass: partial.ampacityPass ?? true,
    voltageDropPass: partial.voltageDropPass ?? true,
    overallPass: partial.overallPass ?? true,
    necReferences: partial.necReferences ?? [],
    conductorCallout: partial.conductorCallout ?? '',
    color: partial.color ?? 'ac',
  };
  return {
    id,
    type: 'RUN_SEGMENT',
    label,
    layoutOrder: order,
    runSegment: seg,
  };
}

function validateGraph(nodes: SLDNode[], edges: SLDEdge[]): { hasDirectDeviceEdges: boolean; validationErrors: string[] } {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const errors: string[] = [];
  let hasDirectDeviceEdges = false;

  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    if (!fromNode || !toNode) {
      errors.push(`Edge references unknown node: ${edge.from} → ${edge.to}`);
      continue;
    }
    // INVARIANT: at least one endpoint must be RUN_SEGMENT
    if (fromNode.type !== 'RUN_SEGMENT' && toNode.type !== 'RUN_SEGMENT') {
      hasDirectDeviceEdges = true;
      errors.push(
        `VIOLATION: Direct device-to-device edge: ${edge.from} (${fromNode.type}) → ${edge.to} (${toNode.type}). ` +
        `A RUN_SEGMENT node is required between every pair of devices.`
      );
    }
  }

  return { hasDirectDeviceEdges, validationErrors: errors };
}

// ─── Microinverter Topology Graph ─────────────────────────────────────────────

function buildMicroinverterGraph(inp: SLDGraphInput): SLDTopologyGraph {
  const panelsPerBranch = Math.round(inp.totalModules / inp.totalStrings);
  const branchCurrentA = panelsPerBranch * (inp.acOutputKw * 1000 / 240 / inp.totalModules);

  const nodes: SLDNode[] = [
    // 0 — PV Array
    {
      id: 'PV_ARRAY',
      type: 'PV_ARRAY',
      label: 'PV ARRAY',
      manufacturer: '',
      model: inp.panelModel,
      qty: inp.totalModules,
      ratedVoltage: `${inp.panelVoc}Voc`,
      ratedCurrent: `${inp.panelIsc}A Isc`,
      ratedPower: `${inp.panelWatts}W`,
      layoutOrder: 0,
    },
    // 1 — ROOF_RUN (DC wiring from panels to microinverters)
    makeRunNode('ROOF_RUN', 'ROOF RUN\n(DC Wiring)', 1, {
      conductorCount: 2,
      conductorInsulation: 'PV Wire',
      conduitType: inp.dcConduitType,
      conductorGauge: inp.dcWireGauge,
      color: 'dc',
      necReferences: ['NEC 690.31', 'NEC 690.8'],
    }),
    // 2 — Microinverters
    {
      id: 'MICROINVERTERS',
      type: 'MICROINVERTERS',
      label: 'MICROINVERTERS',
      manufacturer: inp.inverterManufacturer,
      model: inp.inverterModel,
      qty: inp.totalModules,
      ratedVoltage: '240V AC',
      ratedCurrent: `${(inp.acOutputKw * 1000 / 240 / inp.totalModules).toFixed(1)}A ea`,
      ratedPower: `${(inp.acOutputKw * 1000 / inp.totalModules).toFixed(0)}W ea`,
      layoutOrder: 2,
    },
    // 3 — BRANCH_RUN (AC trunk cable from micros to combiner)
    makeRunNode('BRANCH_RUN', 'BRANCH RUN\n(AC Trunk)', 3, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 690.8', 'NEC 310.15'],
    }),
    // 4 — AC Combiner
    {
      id: 'AC_COMBINER',
      type: 'AC_COMBINER',
      label: 'AC COMBINER',
      manufacturer: inp.inverterManufacturer,
      model: inp.gatewayModel ?? 'IQ Combiner',
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${inp.acOCPD}A`,
      ocpdRating: `${inp.acOCPD}A`,
      necReference: 'NEC 690.9',
      layoutOrder: 4,
    },
    // 5 — COMBINER_TO_DISCO_RUN
    makeRunNode('COMBINER_TO_DISCO_RUN', 'COMBINER TO\nDISCO RUN', 5, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 690.8', 'NEC 310.15'],
    }),
    // 6 — AC Disconnect
    {
      id: 'AC_DISCONNECT',
      type: 'AC_DISCONNECT',
      label: 'AC DISCONNECT',
      manufacturer: '',
      model: 'Non-Fused AC Disconnect',
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${inp.acOCPD}A`,
      ocpdRating: `${inp.acOCPD}A`,
      necReference: 'NEC 690.14',
      layoutOrder: 6,
    },
    // 7 — DISCO_TO_METER_RUN
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO\nMETER RUN', 7, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    // 8 — Production Meter
    {
      id: 'PRODUCTION_METER',
      type: 'PRODUCTION_METER',
      label: 'PRODUCTION METER',
      manufacturer: 'Utility',
      model: 'Revenue Grade Meter',
      qty: 1,
      ratedVoltage: '240V AC',
      necReference: 'NEC 705.12',
      layoutOrder: 8,
    },
    // 9 — METER_TO_MSP_RUN
    makeRunNode('METER_TO_MSP_RUN', 'METER TO\nMSP RUN', 9, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15', 'NEC 705.12'],
    }),
    // 10 — Main Service Panel
    {
      id: 'MAIN_SERVICE_PANEL',
      type: 'MAIN_SERVICE_PANEL',
      label: 'MAIN SERVICE PANEL',
      manufacturer: inp.mainPanelBrand ?? '',
      model: `${inp.mainPanelAmps}A Panel`,
      qty: 1,
      ratedVoltage: '120/240V AC',
      ratedCurrent: `${inp.mainPanelAmps}A`,
      ocpdRating: `${inp.backfeedAmps}A Backfeed`,
      necReference: 'NEC 705.12(B)',
      layoutOrder: 10,
    },
    // 11 — MSP_TO_UTILITY_RUN
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO\nUTILITY RUN', 11, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    // 12 — Utility Grid
    {
      id: 'UTILITY_GRID',
      type: 'UTILITY_GRID',
      label: 'UTILITY GRID',
      manufacturer: 'Utility',
      model: '120/240V Single Phase',
      qty: 1,
      ratedVoltage: '120/240V',
      layoutOrder: 12,
    },
  ];

  // Edges — every connection goes through a RUN_SEGMENT
  const edges: SLDEdge[] = [
    { from: 'PV_ARRAY',            to: 'ROOF_RUN' },
    { from: 'ROOF_RUN',            to: 'MICROINVERTERS' },
    { from: 'MICROINVERTERS',      to: 'BRANCH_RUN' },
    { from: 'BRANCH_RUN',          to: 'AC_COMBINER' },
    { from: 'AC_COMBINER',         to: 'COMBINER_TO_DISCO_RUN' },
    { from: 'COMBINER_TO_DISCO_RUN', to: 'AC_DISCONNECT' },
    { from: 'AC_DISCONNECT',       to: 'DISCO_TO_METER_RUN' },
    { from: 'DISCO_TO_METER_RUN',  to: 'PRODUCTION_METER' },
    { from: 'PRODUCTION_METER',    to: 'METER_TO_MSP_RUN' },
    { from: 'METER_TO_MSP_RUN',    to: 'MAIN_SERVICE_PANEL' },
    { from: 'MAIN_SERVICE_PANEL',  to: 'MSP_TO_UTILITY_RUN' },
    { from: 'MSP_TO_UTILITY_RUN',  to: 'UTILITY_GRID' },
  ];

  const { hasDirectDeviceEdges, validationErrors } = validateGraph(nodes, edges);
  return { nodes, edges, hasDirectDeviceEdges, validationErrors };
}

// ─── String Inverter Topology Graph ──────────────────────────────────────────

function buildStringInverterGraph(inp: SLDGraphInput): SLDTopologyGraph {
  const nodes: SLDNode[] = [
    // 0 — PV Array
    {
      id: 'PV_ARRAY',
      type: 'PV_ARRAY',
      label: 'PV ARRAY',
      model: inp.panelModel,
      qty: inp.totalModules,
      ratedVoltage: `${inp.panelVoc}Voc`,
      ratedCurrent: `${inp.panelIsc}A Isc`,
      ratedPower: `${inp.panelWatts}W`,
      layoutOrder: 0,
    },
    // 1 — DC_STRING_RUN (PV Wire from array to DC disconnect)
    makeRunNode('DC_STRING_RUN', 'DC STRING RUN\n(PV Wire)', 1, {
      conductorCount: 2,
      conductorInsulation: 'USE-2/PV Wire',
      conduitType: inp.dcConduitType,
      conductorGauge: inp.dcWireGauge,
      color: 'dc',
      necReferences: ['NEC 690.31', 'NEC 690.8'],
    }),
    // 2 — DC Disconnect
    {
      id: 'DC_DISCONNECT',
      type: 'DC_DISCONNECT',
      label: 'DC DISCONNECT',
      model: 'DC Disconnect Switch',
      qty: 1,
      ratedVoltage: `${Math.round(inp.panelVoc * 1.25 * Math.round(inp.totalModules / inp.totalStrings))}V max`,
      ratedCurrent: `${inp.dcOCPD}A`,
      ocpdRating: `${inp.dcOCPD}A`,
      necReference: 'NEC 690.15',
      layoutOrder: 2,
    },
    // 3 — DC_DISCO_TO_INV_RUN
    makeRunNode('DC_DISCO_TO_INV_RUN', 'DC DISCO TO\nINVERTER RUN', 3, {
      conductorCount: 2,
      conductorInsulation: 'USE-2/PV Wire',
      conduitType: inp.dcConduitType,
      conductorGauge: inp.dcWireGauge,
      color: 'dc',
      necReferences: ['NEC 690.31'],
    }),
    // 4 — String Inverter
    {
      id: 'STRING_INVERTER',
      type: 'STRING_INVERTER',
      label: 'STRING INVERTER',
      manufacturer: inp.inverterManufacturer,
      model: inp.inverterModel,
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${(inp.acOutputKw * 1000 / 240).toFixed(1)}A`,
      ratedPower: `${inp.acOutputKw}kW`,
      necReference: 'NEC 690.4',
      layoutOrder: 4,
    },
    // 5 — INV_TO_DISCO_RUN
    makeRunNode('INV_TO_DISCO_RUN', 'INVERTER TO\nAC DISCO RUN', 5, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 690.8', 'NEC 310.15'],
    }),
    // 6 — AC Disconnect
    {
      id: 'AC_DISCONNECT',
      type: 'AC_DISCONNECT',
      label: 'AC DISCONNECT',
      model: 'Non-Fused AC Disconnect',
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${inp.acOCPD}A`,
      ocpdRating: `${inp.acOCPD}A`,
      necReference: 'NEC 690.14',
      layoutOrder: 6,
    },
    // 7 — DISCO_TO_METER_RUN
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO\nMETER RUN', 7, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    // 8 — Production Meter
    {
      id: 'PRODUCTION_METER',
      type: 'PRODUCTION_METER',
      label: 'PRODUCTION METER',
      manufacturer: 'Utility',
      model: 'Revenue Grade Meter',
      qty: 1,
      ratedVoltage: '240V AC',
      necReference: 'NEC 705.12',
      layoutOrder: 8,
    },
    // 9 — METER_TO_MSP_RUN
    makeRunNode('METER_TO_MSP_RUN', 'METER TO\nMSP RUN', 9, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15', 'NEC 705.12'],
    }),
    // 10 — Main Service Panel
    {
      id: 'MAIN_SERVICE_PANEL',
      type: 'MAIN_SERVICE_PANEL',
      label: 'MAIN SERVICE PANEL',
      manufacturer: inp.mainPanelBrand ?? '',
      model: `${inp.mainPanelAmps}A Panel`,
      qty: 1,
      ratedVoltage: '120/240V AC',
      ratedCurrent: `${inp.mainPanelAmps}A`,
      ocpdRating: `${inp.backfeedAmps}A Backfeed`,
      necReference: 'NEC 705.12(B)',
      layoutOrder: 10,
    },
    // 11 — MSP_TO_UTILITY_RUN
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO\nUTILITY RUN', 11, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    // 12 — Utility Grid
    {
      id: 'UTILITY_GRID',
      type: 'UTILITY_GRID',
      label: 'UTILITY GRID',
      model: '120/240V Single Phase',
      qty: 1,
      ratedVoltage: '120/240V',
      layoutOrder: 12,
    },
  ];

  const edges: SLDEdge[] = [
    { from: 'PV_ARRAY',            to: 'DC_STRING_RUN' },
    { from: 'DC_STRING_RUN',       to: 'DC_DISCONNECT' },
    { from: 'DC_DISCONNECT',       to: 'DC_DISCO_TO_INV_RUN' },
    { from: 'DC_DISCO_TO_INV_RUN', to: 'STRING_INVERTER' },
    { from: 'STRING_INVERTER',     to: 'INV_TO_DISCO_RUN' },
    { from: 'INV_TO_DISCO_RUN',    to: 'AC_DISCONNECT' },
    { from: 'AC_DISCONNECT',       to: 'DISCO_TO_METER_RUN' },
    { from: 'DISCO_TO_METER_RUN',  to: 'PRODUCTION_METER' },
    { from: 'PRODUCTION_METER',    to: 'METER_TO_MSP_RUN' },
    { from: 'METER_TO_MSP_RUN',    to: 'MAIN_SERVICE_PANEL' },
    { from: 'MAIN_SERVICE_PANEL',  to: 'MSP_TO_UTILITY_RUN' },
    { from: 'MSP_TO_UTILITY_RUN',  to: 'UTILITY_GRID' },
  ];

  const { hasDirectDeviceEdges, validationErrors } = validateGraph(nodes, edges);
  return { nodes, edges, hasDirectDeviceEdges, validationErrors };
}

// ─── Optimizer Topology Graph ─────────────────────────────────────────────────

function buildOptimizerGraph(inp: SLDGraphInput): SLDTopologyGraph {
  const nodes: SLDNode[] = [
    {
      id: 'PV_ARRAY',
      type: 'OPTIMIZER_ARRAY',
      label: 'PV ARRAY\n+ OPTIMIZERS',
      manufacturer: inp.optimizerManufacturer ?? '',
      model: `${inp.panelModel} + ${inp.optimizerModel ?? 'Optimizer'}`,
      qty: inp.totalModules,
      ratedVoltage: `${inp.panelVoc}Voc`,
      ratedCurrent: `${inp.panelIsc}A Isc`,
      ratedPower: `${inp.panelWatts}W`,
      layoutOrder: 0,
    },
    makeRunNode('DC_STRING_RUN', 'DC STRING RUN\n(Optimizer Output)', 1, {
      conductorCount: 2,
      conductorInsulation: 'USE-2/PV Wire',
      conduitType: inp.dcConduitType,
      conductorGauge: inp.dcWireGauge,
      color: 'dc',
      necReferences: ['NEC 690.31', 'NEC 690.8'],
    }),
    {
      id: 'DC_DISCONNECT',
      type: 'DC_DISCONNECT',
      label: 'DC DISCONNECT',
      model: 'DC Disconnect Switch',
      qty: 1,
      ratedVoltage: 'Fixed Vout (Optimizer)',
      ratedCurrent: `${inp.dcOCPD}A`,
      ocpdRating: `${inp.dcOCPD}A`,
      necReference: 'NEC 690.15',
      layoutOrder: 2,
    },
    makeRunNode('DC_DISCO_TO_INV_RUN', 'DC DISCO TO\nINVERTER RUN', 3, {
      conductorCount: 2,
      conductorInsulation: 'USE-2/PV Wire',
      conduitType: inp.dcConduitType,
      conductorGauge: inp.dcWireGauge,
      color: 'dc',
      necReferences: ['NEC 690.31'],
    }),
    {
      id: 'STRING_INVERTER',
      type: 'STRING_INVERTER',
      label: 'STRING INVERTER\n(w/ Optimizer)',
      manufacturer: inp.inverterManufacturer,
      model: inp.inverterModel,
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${(inp.acOutputKw * 1000 / 240).toFixed(1)}A`,
      ratedPower: `${inp.acOutputKw}kW`,
      necReference: 'NEC 690.4',
      layoutOrder: 4,
    },
    makeRunNode('INV_TO_DISCO_RUN', 'INVERTER TO\nAC DISCO RUN', 5, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 690.8', 'NEC 310.15'],
    }),
    {
      id: 'AC_DISCONNECT',
      type: 'AC_DISCONNECT',
      label: 'AC DISCONNECT',
      model: 'Non-Fused AC Disconnect',
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${inp.acOCPD}A`,
      ocpdRating: `${inp.acOCPD}A`,
      necReference: 'NEC 690.14',
      layoutOrder: 6,
    },
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO\nMETER RUN', 7, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    {
      id: 'PRODUCTION_METER',
      type: 'PRODUCTION_METER',
      label: 'PRODUCTION METER',
      manufacturer: 'Utility',
      model: 'Revenue Grade Meter',
      qty: 1,
      ratedVoltage: '240V AC',
      necReference: 'NEC 705.12',
      layoutOrder: 8,
    },
    makeRunNode('METER_TO_MSP_RUN', 'METER TO\nMSP RUN', 9, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15', 'NEC 705.12'],
    }),
    {
      id: 'MAIN_SERVICE_PANEL',
      type: 'MAIN_SERVICE_PANEL',
      label: 'MAIN SERVICE PANEL',
      manufacturer: inp.mainPanelBrand ?? '',
      model: `${inp.mainPanelAmps}A Panel`,
      qty: 1,
      ratedVoltage: '120/240V AC',
      ratedCurrent: `${inp.mainPanelAmps}A`,
      ocpdRating: `${inp.backfeedAmps}A Backfeed`,
      necReference: 'NEC 705.12(B)',
      layoutOrder: 10,
    },
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO\nUTILITY RUN', 11, {
      conductorCount: 3,
      conductorInsulation: 'THWN-2',
      conduitType: inp.acConduitType,
      conductorGauge: inp.acWireGauge,
      neutralRequired: true,
      color: 'ac',
      necReferences: ['NEC 310.15'],
    }),
    {
      id: 'UTILITY_GRID',
      type: 'UTILITY_GRID',
      label: 'UTILITY GRID',
      model: '120/240V Single Phase',
      qty: 1,
      ratedVoltage: '120/240V',
      layoutOrder: 12,
    },
  ];

  const edges: SLDEdge[] = [
    { from: 'PV_ARRAY',            to: 'DC_STRING_RUN' },
    { from: 'DC_STRING_RUN',       to: 'DC_DISCONNECT' },
    { from: 'DC_DISCONNECT',       to: 'DC_DISCO_TO_INV_RUN' },
    { from: 'DC_DISCO_TO_INV_RUN', to: 'STRING_INVERTER' },
    { from: 'STRING_INVERTER',     to: 'INV_TO_DISCO_RUN' },
    { from: 'INV_TO_DISCO_RUN',    to: 'AC_DISCONNECT' },
    { from: 'AC_DISCONNECT',       to: 'DISCO_TO_METER_RUN' },
    { from: 'DISCO_TO_METER_RUN',  to: 'PRODUCTION_METER' },
    { from: 'PRODUCTION_METER',    to: 'METER_TO_MSP_RUN' },
    { from: 'METER_TO_MSP_RUN',    to: 'MAIN_SERVICE_PANEL' },
    { from: 'MAIN_SERVICE_PANEL',  to: 'MSP_TO_UTILITY_RUN' },
    { from: 'MSP_TO_UTILITY_RUN',  to: 'UTILITY_GRID' },
  ];

  const { hasDirectDeviceEdges, validationErrors } = validateGraph(nodes, edges);
  return { nodes, edges, hasDirectDeviceEdges, validationErrors };
}

// ─── Public Builder ───────────────────────────────────────────────────────────

export function buildSLDTopologyGraph(inp: SLDGraphInput): SLDTopologyGraph {
  const norm = normalizeTopology(inp.topology);
  switch (norm) {
    case 'MICROINVERTER':
    case 'AC_COUPLED_BATTERY':
      return buildMicroinverterGraph(inp);
    case 'STRING_WITH_OPTIMIZER':
    case 'HYBRID_INVERTER':
    case 'DC_COUPLED_BATTERY':
      return buildOptimizerGraph(inp);
    case 'STRING_INVERTER':
    default:
      return buildStringInverterGraph(inp);
  }
}
'''

with open('/workspace/solarpro-v5/solarpro-v3.1/lib/topology-engine.ts', 'a', encoding='utf-8') as f:
    f.write(APPEND_CODE)

print("Done — appended RUN_SEGMENT topology model to topology-engine.ts")