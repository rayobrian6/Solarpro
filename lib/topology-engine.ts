// ============================================================
// Topology Engine V4
// Pure topology detection from equipment selection.
// NO brand-specific conditionals. Uses equipment registry only.
// ============================================================

import {
  TopologyType,
  getRegistryEntry,
  getTopologyForEquipment,
  EQUIPMENT_REGISTRY,
  EquipmentRegistryEntry,
} from './equipment-registry';

// Re-export TopologyType for consumers
export type { TopologyType };

// ─── Topology Context ─────────────────────────────────────────────────────────

export interface TopologyContext {
  inverterId: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;
  moduleCount: number;
  stringCount: number;
  inverterCount: number;
}

// ─── Topology Detection Result ────────────────────────────────────────────────

export interface TopologyDetectionResult {
  topology: TopologyType;
  mountTopology: TopologyType | null;
  confidence: 'definitive' | 'inferred';
  reason: string;
  requiredAccessoryCategories: string[];
  sldStructure: SLDStructure;
  bomStructure: BOMStructure;
  complianceFlags: ComplianceFlag[];
}

// ─── SLD Structure ────────────────────────────────────────────────────────────

export interface SLDStructure {
  hasDCOptimizers: boolean;
  hasDCString: boolean;
  hasACBranch: boolean;
  hasCombiner: boolean;
  hasDCDisconnect: boolean;
  hasACDisconnect: boolean;
  hasGateway: boolean;
  hasBattery: boolean;
  dcVoltageClass: 'low' | 'medium' | 'high'; // <60V | 60-480V | >480V
  acBranchCount: number;
}

// ─── BOM Structure ────────────────────────────────────────────────────────────

export interface BOMStructure {
  includeOptimizers: boolean;
  includeTrunkCable: boolean;
  includeTerminators: boolean;
  includeGateway: boolean;
  includeCombiner: boolean;
  includeDCDisconnect: boolean;
  includeACDisconnect: boolean;
  includeRapidShutdown: boolean;
  includeDrivenPiles: boolean;
  includeRailSystem: boolean;
  includeLagBolts: boolean;
  includeFlashing: boolean;
}

// ─── Compliance Flag ──────────────────────────────────────────────────────────

export interface ComplianceFlag {
  ruleId: string;
  description: string;
  necReference: string;
  autoSatisfied: boolean;
}

// ─── Topology Normalization ───────────────────────────────────────────────────
// Maps legacy topology aliases to canonical V4 types

export function normalizeTopology(t: TopologyType): TopologyType {
  const map: Record<string, TopologyType> = {
    'STRING':           'STRING_INVERTER',
    'STRING_OPTIMIZER': 'STRING_WITH_OPTIMIZER',
    'MICRO':            'MICROINVERTER',
    'HYBRID':           'HYBRID_INVERTER',
  };
  return map[t] ?? t;
}

// ─── Main Topology Detection ──────────────────────────────────────────────────

export function detectTopology(ctx: TopologyContext): TopologyDetectionResult {
  const inverterEntry = getRegistryEntry(ctx.inverterId);
  const optimizerEntry = ctx.optimizerId ? getRegistryEntry(ctx.optimizerId) : undefined;
  const rackingEntry = ctx.rackingId ? getRegistryEntry(ctx.rackingId) : undefined;
  const batteryEntry = ctx.batteryId ? getRegistryEntry(ctx.batteryId) : undefined;

  // 1. Determine primary topology from inverter registry entry
  let topology: TopologyType = inverterEntry
    ? normalizeTopology(inverterEntry.topologyType)
    : 'STRING_INVERTER';

  // 2. Override: if optimizer explicitly selected + string inverter → STRING_WITH_OPTIMIZER
  if (optimizerEntry && topology === 'STRING_INVERTER') {
    topology = 'STRING_WITH_OPTIMIZER';
  }

  // 3. Override: if battery selected + hybrid inverter → DC_COUPLED_BATTERY
  if (batteryEntry && topology === 'HYBRID_INVERTER') {
    topology = 'DC_COUPLED_BATTERY';
  }

  // 4. Override: if battery selected + microinverter → AC_COUPLED_BATTERY
  if (batteryEntry && topology === 'MICROINVERTER') {
    topology = 'AC_COUPLED_BATTERY';
  }

  // 5. Mount topology from racking entry
  const mountTopology: TopologyType | null = rackingEntry?.mountTopology
    ? normalizeTopology(rackingEntry.mountTopology as TopologyType)
    : null;

  // 6. Build required accessory categories from all selected equipment
  const requiredAccessoryCategories = buildRequiredAccessoryCategories(
    inverterEntry, optimizerEntry, rackingEntry, batteryEntry
  );

  // 7. Build SLD structure
  const sldStructure = buildSLDStructure(topology, ctx);

  // 8. Build BOM structure
  const bomStructure = buildBOMStructure(topology, mountTopology, rackingEntry);

  // 9. Build compliance flags
  const complianceFlags = buildComplianceFlags(topology, inverterEntry);

  const reason = buildReason(topology, inverterEntry, optimizerEntry, rackingEntry);

  return {
    topology,
    mountTopology,
    confidence: inverterEntry ? 'definitive' : 'inferred',
    reason,
    requiredAccessoryCategories,
    sldStructure,
    bomStructure,
    complianceFlags,
  };
}

// ─── Helper: Required Accessory Categories ───────────────────────────────────

function buildRequiredAccessoryCategories(
  inverter?: EquipmentRegistryEntry,
  optimizer?: EquipmentRegistryEntry,
  racking?: EquipmentRegistryEntry,
  battery?: EquipmentRegistryEntry,
): string[] {
  const categories = new Set<string>();

  for (const entry of [inverter, optimizer, racking, battery]) {
    if (!entry) continue;
    for (const acc of entry.requiredAccessories) {
      if (acc.required) categories.add(acc.category);
    }
  }

  return Array.from(categories);
}

// ─── Helper: SLD Structure ────────────────────────────────────────────────────

function buildSLDStructure(topology: TopologyType, ctx: TopologyContext): SLDStructure {
  const norm = normalizeTopology(topology);

  switch (norm) {
    case 'MICROINVERTER':
    case 'AC_COUPLED_BATTERY':
      return {
        hasDCOptimizers: false,
        hasDCString: false,
        hasACBranch: true,
        hasCombiner: true,
        hasDCDisconnect: false,
        hasACDisconnect: true,
        hasGateway: true,
        hasBattery: norm === 'AC_COUPLED_BATTERY',
        dcVoltageClass: 'low',
        acBranchCount: ctx.stringCount,
      };

    case 'STRING_WITH_OPTIMIZER':
      return {
        hasDCOptimizers: true,
        hasDCString: true,
        hasACBranch: false,
        hasCombiner: ctx.stringCount > 2,
        hasDCDisconnect: true,
        hasACDisconnect: true,
        hasGateway: true,
        hasBattery: false,
        dcVoltageClass: 'medium',
        acBranchCount: 0,
      };

    case 'HYBRID_INVERTER':
    case 'DC_COUPLED_BATTERY':
      return {
        hasDCOptimizers: true,
        hasDCString: true,
        hasACBranch: false,
        hasCombiner: ctx.stringCount > 2,
        hasDCDisconnect: true,
        hasACDisconnect: true,
        hasGateway: true,
        hasBattery: true,
        dcVoltageClass: 'medium',
        acBranchCount: 0,
      };

    case 'STRING_INVERTER':
    default:
      return {
        hasDCOptimizers: false,
        hasDCString: true,
        hasACBranch: false,
        hasCombiner: ctx.stringCount > 2,
        hasDCDisconnect: true,
        hasACDisconnect: true,
        hasGateway: false,
        hasBattery: false,
        dcVoltageClass: 'high',
        acBranchCount: 0,
      };
  }
}

// ─── Helper: BOM Structure ────────────────────────────────────────────────────

function buildBOMStructure(
  topology: TopologyType,
  mountTopology: TopologyType | null,
  racking?: EquipmentRegistryEntry,
): BOMStructure {
  const norm = normalizeTopology(topology);
  const isMicro = norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY';
  const isOptimizer = norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY';
  const isGroundMount = mountTopology === 'GROUND_MOUNT_FIXED_TILT' || mountTopology === 'GROUND_MOUNT_DRIVEN_PILE';
  const isRailLess = mountTopology === 'ROOF_RAIL_LESS';
  const isDrivenPile = mountTopology === 'GROUND_MOUNT_DRIVEN_PILE' ||
    racking?.structuralSpecs?.foundationType === 'driven_pile';

  return {
    includeOptimizers: isOptimizer,
    includeTrunkCable: isMicro,
    includeTerminators: isMicro,
    includeGateway: isMicro || isOptimizer,
    includeCombiner: isMicro,
    includeDCDisconnect: !isMicro,
    includeACDisconnect: true,
    includeRapidShutdown: !isMicro && !isOptimizer, // optimizers/micros have integrated RSD
    includeDrivenPiles: isDrivenPile,
    includeRailSystem: !isRailLess && !isDrivenPile,
    includeLagBolts: !isDrivenPile,
    includeFlashing: !isGroundMount,
  };
}

// ─── Helper: Compliance Flags ─────────────────────────────────────────────────

function buildComplianceFlags(
  topology: TopologyType,
  inverter?: EquipmentRegistryEntry,
): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  const norm = normalizeTopology(topology);

  // NEC 690.12 — Rapid Shutdown
  const rsdIntegrated = inverter?.electricalSpecs?.rapidShutdownCompliant ?? false;
  flags.push({
    ruleId: 'NEC_690_12_RSD',
    description: 'Rapid shutdown required for rooftop PV systems',
    necReference: 'NEC 690.12',
    autoSatisfied: rsdIntegrated ||
      norm === 'MICROINVERTER' ||
      norm === 'STRING_WITH_OPTIMIZER',
  });

  // NEC 690.15 — DC Disconnect
  flags.push({
    ruleId: 'NEC_690_15_DC_DISC',
    description: 'DC disconnect required for string inverter systems',
    necReference: 'NEC 690.15',
    autoSatisfied: norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY',
  });

  // NEC 690.14 — AC Disconnect
  flags.push({
    ruleId: 'NEC_690_14_AC_DISC',
    description: 'AC disconnect required for all PV systems',
    necReference: 'NEC 690.14',
    autoSatisfied: false, // always needs explicit sizing
  });

  // NEC 690.4 — Equipment listing
  flags.push({
    ruleId: 'NEC_690_4_LISTING',
    description: 'All equipment must be listed for PV use',
    necReference: 'NEC 690.4',
    autoSatisfied: !!inverter?.ulListing,
  });

  return flags;
}

// ─── Helper: Reason String ────────────────────────────────────────────────────

function buildReason(
  topology: TopologyType,
  inverter?: EquipmentRegistryEntry,
  optimizer?: EquipmentRegistryEntry,
  racking?: EquipmentRegistryEntry,
): string {
  const parts: string[] = [];

  if (inverter) {
    parts.push(`${inverter.manufacturer} ${inverter.model} → ${topology}`);
  } else {
    parts.push(`No inverter in registry → defaulting to ${topology}`);
  }

  if (optimizer) {
    parts.push(`+ ${optimizer.manufacturer} ${optimizer.model} optimizer`);
  }

  if (racking) {
    parts.push(`+ ${racking.manufacturer} ${racking.model} (${racking.mountTopology ?? 'roof'})`);
  }

  return parts.join(', ');
}

// ─── Topology Transition Validator ───────────────────────────────────────────

export interface TopologyTransition {
  from: TopologyType;
  to: TopologyType;
  fieldsToReset: string[];
  fieldsToAdd: string[];
  warnings: string[];
}

export function validateTopologyTransition(
  from: TopologyType,
  to: TopologyType,
): TopologyTransition {
  const normFrom = normalizeTopology(from);
  const normTo = normalizeTopology(to);

  const fieldsToReset: string[] = [];
  const fieldsToAdd: string[] = [];
  const warnings: string[] = [];

  // FROM micro → anything else
  if (normFrom === 'MICROINVERTER') {
    fieldsToReset.push('trunkCable', 'terminators', 'combiner', 'acBranchOCPD');
    fieldsToAdd.push('dcDisconnect', 'dcStringOCPD');
    warnings.push('Switching from microinverter: AC branch components removed, DC string components added');
  }

  // TO micro
  if (normTo === 'MICROINVERTER') {
    fieldsToReset.push('dcDisconnect', 'dcStringOCPD', 'stringWireGauge', 'optimizers');
    fieldsToAdd.push('trunkCable', 'terminators', 'combiner', 'gateway');
    warnings.push('Switching to microinverter: DC string components removed, AC branch components added');
  }

  // FROM optimizer → string (no optimizer)
  if (normFrom === 'STRING_WITH_OPTIMIZER' && normTo === 'STRING_INVERTER') {
    fieldsToReset.push('optimizers', 'optimizerGateway');
    fieldsToAdd.push('rapidShutdown');
    warnings.push('Switching from optimizer topology: optimizers removed, rapid shutdown device required');
  }

  // TO optimizer
  if (normTo === 'STRING_WITH_OPTIMIZER' && normFrom === 'STRING_INVERTER') {
    fieldsToReset.push('rapidShutdown');
    fieldsToAdd.push('optimizers', 'optimizerGateway');
    warnings.push('Switching to optimizer topology: rapid shutdown integrated, optimizers added per module');
  }

  // Ground mount transitions
  if (normTo === 'GROUND_MOUNT_DRIVEN_PILE' || normTo === 'GROUND_MOUNT_FIXED_TILT') {
    fieldsToReset.push('lagBolts', 'lFeet', 'flashing', 'railSections');
    fieldsToAdd.push('drivenPiles', 'groundMountRail');
    warnings.push('Ground mount selected: roof attachment hardware replaced with driven pile foundation');
  }

  if ((normFrom === 'GROUND_MOUNT_DRIVEN_PILE' || normFrom === 'GROUND_MOUNT_FIXED_TILT') &&
      (normTo === 'ROOF_RAIL_BASED' || normTo === 'ROOF_RAIL_LESS')) {
    fieldsToReset.push('drivenPiles', 'groundMountRail');
    fieldsToAdd.push('lagBolts', 'lFeet', 'flashing');
    warnings.push('Switching to roof mount: ground mount hardware replaced with roof attachment hardware');
  }

  return { from, to, fieldsToReset, fieldsToAdd, warnings };
}

// ─── Topology Display Labels ──────────────────────────────────────────────────

export const TOPOLOGY_LABELS: Record<string, string> = {
  'STRING':                   'String Inverter',
  'STRING_INVERTER':          'String Inverter',
  'STRING_OPTIMIZER':         'String + Optimizer',
  'STRING_WITH_OPTIMIZER':    'String + Optimizer',
  'MICRO':                    'Microinverter',
  'MICROINVERTER':            'Microinverter',
  'AC_MODULE':                'AC Module',
  'HYBRID':                   'Hybrid Inverter',
  'HYBRID_INVERTER':          'Hybrid Inverter',
  'DC_COUPLED_BATTERY':       'DC-Coupled Battery',
  'AC_COUPLED_BATTERY':       'AC-Coupled Battery',
  'GROUND_MOUNT_FIXED_TILT':  'Ground Mount (Fixed Tilt)',
  'GROUND_MOUNT_DRIVEN_PILE': 'Ground Mount (Driven Pile)',
  'ROOF_RAIL_BASED':          'Roof Mount (Rail)',
  'ROOF_RAIL_LESS':           'Roof Mount (Rail-Less)',
};

export function getTopologyLabel(t: TopologyType): string {
  return TOPOLOGY_LABELS[t] ?? t;
}
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
    makeRunNode('ROOF_RUN', 'ROOF RUN (DC Wiring)', 1, {
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
    makeRunNode('BRANCH_RUN', 'BRANCH RUN (AC Trunk)', 3, {
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
    makeRunNode('COMBINER_TO_DISCO_RUN', 'COMBINER TO DISCO RUN', 5, {
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
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO METER RUN', 7, {
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
    makeRunNode('METER_TO_MSP_RUN', 'METER TO MSP RUN', 9, {
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
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO UTILITY RUN', 11, {
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
    makeRunNode('DC_STRING_RUN', 'DC STRING RUN (PV Wire)', 1, {
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
    makeRunNode('DC_DISCO_TO_INV_RUN', 'DC DISCO TO INVERTER RUN', 3, {
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
    makeRunNode('INV_TO_DISCO_RUN', 'INVERTER TO AC DISCO RUN', 5, {
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
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO METER RUN', 7, {
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
    makeRunNode('METER_TO_MSP_RUN', 'METER TO MSP RUN', 9, {
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
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO UTILITY RUN', 11, {
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
      label: 'PV ARRAY + OPTIMIZERS',
      manufacturer: inp.optimizerManufacturer ?? '',
      model: `${inp.panelModel} + ${inp.optimizerModel ?? 'Optimizer'}`,
      qty: inp.totalModules,
      ratedVoltage: `${inp.panelVoc}Voc`,
      ratedCurrent: `${inp.panelIsc}A Isc`,
      ratedPower: `${inp.panelWatts}W`,
      layoutOrder: 0,
    },
    makeRunNode('DC_STRING_RUN', 'DC STRING RUN (Optimizer Output)', 1, {
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
    makeRunNode('DC_DISCO_TO_INV_RUN', 'DC DISCO TO INVERTER RUN', 3, {
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
      label: 'STRING INVERTER (w/ Optimizer)',
      manufacturer: inp.inverterManufacturer,
      model: inp.inverterModel,
      qty: 1,
      ratedVoltage: '240V AC',
      ratedCurrent: `${(inp.acOutputKw * 1000 / 240).toFixed(1)}A`,
      ratedPower: `${inp.acOutputKw}kW`,
      necReference: 'NEC 690.4',
      layoutOrder: 4,
    },
    makeRunNode('INV_TO_DISCO_RUN', 'INVERTER TO AC DISCO RUN', 5, {
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
    makeRunNode('DISCO_TO_METER_RUN', 'DISCO TO METER RUN', 7, {
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
    makeRunNode('METER_TO_MSP_RUN', 'METER TO MSP RUN', 9, {
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
    makeRunNode('MSP_TO_UTILITY_RUN', 'MSP TO UTILITY RUN', 11, {
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
