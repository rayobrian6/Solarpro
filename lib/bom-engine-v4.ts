// ============================================================
// BOM Intelligence Engine V4
// Derives BOM from: equipment registry + topology + mount +
//                   conduit type + wiring runs + jurisdiction
// NO static templates. All items derived from registry rules.
// Quantities auto-update on any input change.
// ============================================================

import {
  TopologyType,
  getRegistryEntryV4,
  evaluateQuantityFormulaV4,
  normalizeTopologyV4,
  EQUIPMENT_REGISTRY_V4,
  EquipmentRegistryEntry,
} from './equipment-registry-v4';

import {
  resolveTopology,
  TopologyManagerContext,
  BOMStageDefinition,
} from './topology-manager';

import type { RunSegment } from './computed-system';

// ─── BOM Stage IDs ────────────────────────────────────────────────────────────

export type BOMStageId =
  | 'array'
  | 'dc'
  | 'inverter'
  | 'ac'
  | 'structural'
  | 'monitoring'
  | 'labels';

// ─── BOM Line Item ────────────────────────────────────────────────────────────

export interface BOMLineItemV4 {
  id: string;
  stageId: BOMStageId;
  stageLabel: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'ft' | 'lf' | 'roll' | 'set' | 'lot';
  unitCost?: number;
  totalCost?: number;
  necReference?: string;
  derivedFrom: string;
  formula?: string;
  notes?: string;
  required: boolean;
}

// ─── BOM Generation Input ─────────────────────────────────────────────────────

export interface BOMGenerationInputV4 {
  // Equipment selection
  inverterId: string;
  optimizerId?: string;
  rackingId?: string;
  batteryId?: string;
  panelId?: string;

  // System sizing
  moduleCount: number;
  deviceCount?: number;       // micro: ceil(panelCount / modulesPerDevice); if omitted falls back to moduleCount
  stringCount: number;
  inverterCount: number;
  systemKw: number;

  // Wiring
  dcWireGauge: string;
  acWireGauge: string;
  dcWireLength: number;       // feet (DC home run)
  acWireLength: number;       // feet (AC home run)
  conduitType: 'EMT' | 'PVC' | 'RMC' | 'LFMC';
  conduitSizeInch: string;    // e.g. "3/4"
  
  // ComputedSystem.runs — single source of truth for wire/conduit quantities
  runs?:                   RunSegment[];

  // Structural
  roofType: string;
  attachmentCount: number;    // computed from layout
  railSections: number;       // computed from layout

  // Layout (Phase 3 - Future Layout Engine)
  rowCount?: number;          // number of rows in array layout
  columnCount?: number;       // columns per row
  layoutOrientation?: 'portrait' | 'landscape';

  // Electrical
  mainPanelAmps: number;
  backfeedAmps: number;
  acOCPD: number;
  dcOCPD: number;

  // Jurisdiction
  jurisdiction?: string;
  requiresProductionMeter?: boolean;
  requiresACDisconnect?: boolean;
  requiresDCDisconnect?: boolean;
  requiresRapidShutdown?: boolean;

  // Labels (NEC 690.31, 690.54, 690.56)
  requiresWarningLabels?: boolean;
}

// ─── BOM Generation Result ────────────────────────────────────────────────────

export interface BOMGenerationResultV4 {
  items: BOMLineItemV4[];
  stages: BOMStageResult[];
  totalLineItems: number;
  totalCost?: number;
  generatedAt: string;
  topology: TopologyType;
  topologyLabel: string;
  derivationLog: BOMDerivationEntry[];
  warnings: string[];
  complianceNotes: string[];
}

export interface BOMStageResult {
  id: BOMStageId;
  label: string;
  order: number;
  items: BOMLineItemV4[];
  itemCount: number;
}

export interface BOMDerivationEntry {
  stageId: BOMStageId;
  category: string;
  item: string;
  quantity: number;
  derivedFrom: string;
  formula: string;
  necReference?: string;
}

// ─── Standard OCPD Sizes ──────────────────────────────────────────────────────

function nextStandardBreaker(amps: number): number {
  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200]; // NEC 240.6(A) — 110A added
  return sizes.find(s => s >= amps) ?? Math.ceil(amps / 10) * 10;
}

// ─── Wire Length with Fitting Allowance ──────────────────────────────────────

function conduitLength(wireLength: number, fittingAllowance = 1.15): number {
  return Math.ceil(wireLength * fittingAllowance);
}

// ─── ID Generator ─────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId(): string {
  return `bom-v4-${(++_idCounter).toString().padStart(4, '0')}`;
}

// ─── Stage Label Map ──────────────────────────────────────────────────────────

const STAGE_LABELS: Record<BOMStageId, string> = {
  array:      'Stage 1 — Array',
  dc:         'Stage 2 — DC',
  inverter:   'Stage 3 — Inverter',
  ac:         'Stage 4 — AC',
  structural: 'Stage 5 — Structural',
  monitoring: 'Stage 6 — Monitoring',
  labels:     'Stage 7 — Labels',
};

const STAGE_ORDER: Record<BOMStageId, number> = {
  array: 1, dc: 2, inverter: 3, ac: 4, structural: 5, monitoring: 6, labels: 7,
};

// ─── Main BOM Generation Function ────────────────────────────────────────────

export function generateBOMV4(input: BOMGenerationInputV4): BOMGenerationResultV4 {
  _idCounter = 0;
  const items: BOMLineItemV4[] = [];
  const log: BOMDerivationEntry[] = [];
  const warnings: string[] = [];
  const complianceNotes: string[] = [];

  // Resolve topology
  const topoCtx: TopologyManagerContext = {
    inverterId: input.inverterId,
    optimizerId: input.optimizerId,
    rackingId: input.rackingId,
    batteryId: input.batteryId,
    moduleCount: input.moduleCount,
    stringCount: input.stringCount,
    inverterCount: input.inverterCount,
    roofType: input.roofType,
  };
  const topoResult = resolveTopology(topoCtx);
  const topology = topoResult.topology;
  const norm = normalizeTopologyV4(topology);

  const formulaCtx = {
    modules: input.moduleCount,
    strings: input.stringCount,
    inverters: input.inverterCount,
    branches: input.stringCount,
    railSections: input.railSections,
    attachments: input.attachmentCount,
    systemKw: input.systemKw,
  };

  // Get equipment entries
  const inverterEntry = getRegistryEntryV4(input.inverterId);
  const optimizerEntry = input.optimizerId ? getRegistryEntryV4(input.optimizerId) : undefined;
  const rackingEntry = input.rackingId ? getRegistryEntryV4(input.rackingId) : undefined;
  const batteryEntry = input.batteryId ? getRegistryEntryV4(input.batteryId) : undefined;
  const panelEntry = input.panelId ? getRegistryEntryV4(input.panelId) : undefined;

  // ── STAGE 1: ARRAY ──────────────────────────────────────────────────────────

  // Solar Panels
  if (panelEntry) {
    items.push(addItem('array', panelEntry.category, panelEntry.manufacturer, panelEntry.model,
      panelEntry.partNumber ?? panelEntry.id.toUpperCase(),
      `${panelEntry.electricalSpecs.watts ?? ''}W Solar Panel`,
      input.moduleCount, 'ea', 'NEC 690', 'moduleCount', 'modules', true));
    log.push({ stageId: 'array', category: 'solar_panel', item: 'Solar Panels',
      quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690' });
  } else {
    items.push(addItem('array', 'solar_panel', 'TBD', 'Solar Panel (specify model)',
      'PANEL-TBD', 'Solar Panel', input.moduleCount, 'ea', 'NEC 690', 'moduleCount', 'modules', true));
  }

  // Microinverters (if MICROINVERTER topology)
  // PHASE 1 FIX: use deviceCount (ceil(panels/modulesPerDevice)), NOT moduleCount
  if (norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY') {
    const microQty = input.deviceCount ?? input.moduleCount;
    if (inverterEntry) {
      items.push(addItem('array', 'microinverter', inverterEntry.manufacturer, inverterEntry.model,
        inverterEntry.partNumber ?? inverterEntry.id,
        `Microinverter — ${inverterEntry.electricalSpecs.acOutputKw ?? ''}kW AC output`,
        microQty, 'ea', 'NEC 690', 'deviceCount', 'ceil(panels/modulesPerDevice)', true));
      log.push({ stageId: 'array', category: 'microinverter', item: inverterEntry.model,
        quantity: microQty, derivedFrom: 'deviceCount', formula: 'ceil(panels/modulesPerDevice)', necReference: 'NEC 690' });
    }
  }

  // Optimizers (if STRING_WITH_OPTIMIZER or HYBRID or DC_COUPLED)
  if ((norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY') && optimizerEntry) {
    items.push(addItem('array', 'optimizer', optimizerEntry.manufacturer, optimizerEntry.model,
      optimizerEntry.partNumber ?? optimizerEntry.id,
      `DC Power Optimizer — 1 per module`,
      input.moduleCount, 'ea', 'NEC 690.8', 'moduleCount', 'modules', true));
    log.push({ stageId: 'array', category: 'optimizer', item: optimizerEntry.model,
      quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690.8' });
  }

  // ── STAGE 2: DC ─────────────────────────────────────────────────────────────

  const isMicro = norm === 'MICROINVERTER' || norm === 'AC_COUPLED_BATTERY';

  if (isMicro) {
    // ISSUE 4 FIX: AC Trunk Cable uses deviceCount (not moduleCount)
    // branchCount = ceil(deviceCount / microPerBranch) where microPerBranch = 16
    const microPerBranch = 16;
    const trunkDeviceCount = input.deviceCount ?? input.moduleCount;
    const trunkSections = Math.ceil(trunkDeviceCount / microPerBranch);
    items.push(addItem('dc', 'trunk_cable', 'Enphase', 'Q Cable 240V',
      'Q-12-10-240', 'AC Trunk Cable — 1 section per 16 microinverters',
      trunkSections, 'ea', 'NEC 690.31', 'ceil(deviceCount/16)', 'ceil(deviceCount / 16)', true));
    log.push({ stageId: 'dc', category: 'trunk_cable', item: 'Q Cable 240V',
      quantity: trunkSections, derivedFrom: 'ceil(deviceCount/16)', formula: 'ceil(deviceCount / 16)', necReference: 'NEC 690.31' });

    // Terminators
    const terminators = trunkSections * 2;
    items.push(addItem('dc', 'terminator', 'Enphase', 'Q Cable Terminator',
      'Q-TERM-10-240', 'Trunk cable terminator — 2 per trunk section',
      terminators, 'ea', 'NEC 690.31', 'ceil(modules/16)*2', 'ceil(modules / 16) * 2', true));
    log.push({ stageId: 'dc', category: 'terminator', item: 'Q Cable Terminator',
      quantity: terminators, derivedFrom: 'trunkSections*2', formula: 'ceil(modules / 16) * 2', necReference: 'NEC 690.31' });

  } else {
    // DC Wire (string inverter topology)
    const dcWireQty = conduitLength(input.dcWireLength * 2); // 2 conductors (+ and -)
    items.push(addItem('dc', 'wire', 'Southwire', `${input.dcWireGauge} USE-2 PV Wire`,
      `USE2-${input.dcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${input.dcWireGauge} USE-2 PV Wire — DC home run`,
      dcWireQty, 'ft', 'NEC 690.31', 'dcWireLength × 2 × 1.15', `${input.dcWireLength} × 2 × 1.15`, true));
    log.push({ stageId: 'dc', category: 'wire', item: `${input.dcWireGauge} USE-2`,
      quantity: dcWireQty, derivedFrom: 'dcWireLength × 2 conductors × 1.15 fitting', formula: 'dcWireLength * 2 * 1.15', necReference: 'NEC 690.31' });

    // DC Conduit
    const dcConduitQty = conduitLength(input.dcWireLength);
    items.push(addItem('dc', 'conduit', 'Generic', `${input.conduitSizeInch}" ${input.conduitType} Conduit`,
      `${input.conduitType}-${input.conduitSizeInch.replace('/', '-')}`,
      `${input.conduitSizeInch}" ${input.conduitType} conduit — DC home run`,
      dcConduitQty, 'ft', 'NEC 690.31', 'dcWireLength × 1.15', `${input.dcWireLength} × 1.15`, true));

    // DC Disconnect
    if (input.requiresDCDisconnect !== false) {
      items.push(addItem('dc', 'disconnect', 'Square D', `${input.dcOCPD}A DC Disconnect`,
        'DU30RB', `${input.dcOCPD}A DC disconnect switch per NEC 690.15`,
        input.inverterCount, 'ea', 'NEC 690.15', 'inverterCount', 'inverters', true));
      log.push({ stageId: 'dc', category: 'dc_disconnect', item: `${input.dcOCPD}A DC Disconnect`,
        quantity: input.inverterCount, derivedFrom: 'inverterCount', formula: 'inverters', necReference: 'NEC 690.15' });
    }

    // Rapid Shutdown (string inverter without integrated RSD)
    const rsdIntegrated = inverterEntry?.electricalSpecs?.rapidShutdownCompliant ?? false;
    const isOptimizer = norm === 'STRING_WITH_OPTIMIZER';
    if (input.requiresRapidShutdown !== false && !rsdIntegrated && !isOptimizer) {
      items.push(addItem('dc', 'rapid_shutdown', 'Tigo', 'TS4-A-F Rapid Shutdown',
        'TS4-A-F', 'Rapid shutdown device per NEC 690.12 — 1 per module',
        input.moduleCount, 'ea', 'NEC 690.12', 'moduleCount', 'modules', true));
      log.push({ stageId: 'dc', category: 'rapid_shutdown', item: 'TS4-A-F',
        quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690.12' });
      complianceNotes.push('NEC 690.12: Rapid shutdown devices added — 1 per module (Tigo TS4-A-F)');
    } else if (rsdIntegrated || isOptimizer) {
      complianceNotes.push(`NEC 690.12: Rapid shutdown integrated in ${isOptimizer ? 'optimizers' : inverterEntry?.model ?? 'inverter'}`);
    }
  }

  // ── STAGE 3: INVERTER ────────────────────────────────────────────────────────

  if (!isMicro && inverterEntry) {
    items.push(addItem('inverter', inverterEntry.category, inverterEntry.manufacturer, inverterEntry.model,
      inverterEntry.partNumber ?? inverterEntry.id,
      `${inverterEntry.electricalSpecs.acOutputKw ?? ''}kW ${inverterEntry.category === 'string_inverter' ? 'String Inverter' : 'Inverter'}`,
      input.inverterCount, 'ea', 'NEC 690', 'inverterCount', 'inverters', true));
    log.push({ stageId: 'inverter', category: inverterEntry.category, item: inverterEntry.model,
      quantity: input.inverterCount, derivedFrom: 'inverterCount', formula: 'inverters', necReference: 'NEC 690' });
  }

  // Battery
  if (batteryEntry) {
    items.push(addItem('inverter', 'battery', batteryEntry.manufacturer, batteryEntry.model,
      batteryEntry.partNumber ?? batteryEntry.id,
      `Battery Storage System — ${batteryEntry.electricalSpecs.acOutputKw ?? ''}kW`,
      1, 'ea', 'NEC 706', 'perSystem', '1', true));
    log.push({ stageId: 'inverter', category: 'battery', item: batteryEntry.model,
      quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 706' });
  }

  // Gateway (optimizer or microinverter topology)
  const needsGateway = norm === 'STRING_WITH_OPTIMIZER' || norm === 'MICROINVERTER' ||
    norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY' || norm === 'AC_COUPLED_BATTERY';
  if (needsGateway) {
    // Find gateway from inverter accessories
    const gatewayAcc = inverterEntry?.requiredAccessories.find(a => a.category === 'gateway');
    if (gatewayAcc) {
      items.push(addItem('monitoring', 'gateway', gatewayAcc.defaultManufacturer ?? 'TBD',
        gatewayAcc.defaultModel ?? 'Gateway', gatewayAcc.defaultPartNumber ?? 'GW-TBD',
        'Communication/monitoring gateway', 1, 'ea', gatewayAcc.necReference ?? 'NEC 690.4',
        'perSystem', '1', true));
      log.push({ stageId: 'monitoring', category: 'gateway', item: gatewayAcc.defaultModel ?? 'Gateway',
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: gatewayAcc.necReference });
    }
  }

  // Combiner (microinverter topology)
  if (isMicro) {
    const combinerAcc = inverterEntry?.requiredAccessories.find(a => a.category === 'combiner');
    if (combinerAcc) {
      items.push(addItem('inverter', 'combiner', combinerAcc.defaultManufacturer ?? 'TBD',
        combinerAcc.defaultModel ?? 'AC Combiner', combinerAcc.defaultPartNumber ?? 'COMB-TBD',
        'AC branch combiner — aggregates branch circuits', 1, 'ea',
        combinerAcc.necReference ?? 'NEC 690.4', 'perSystem', '1', true));
    }
    
    // BUG 3 FIX: Junction Box — derive from runSegments
    // Count segments ending at 'JUNCTION BOX', 'AC COMBINER', or 'COMBINER'
    let junctionBoxQty = 0;
    if (input.runs && input.runs.length > 0) {
      junctionBoxQty = input.runs.filter(r => 
        r.to === 'JUNCTION BOX' || r.to === 'AC COMBINER' || r.to === 'COMBINER'
      ).length;
    }
    // Fallback: at least 1 junction box per system if not derived from runs
    if (junctionBoxQty === 0) {
      junctionBoxQty = Math.ceil((input.deviceCount ?? input.moduleCount) / 16);
    }
    if (junctionBoxQty > 0) {
      items.push(addItem('ac', 'junction_box', 'TBD', 'PV Junction Box',
        'JB-PV-6', 'PV wire junction box — transitions open-air to conduit',
        junctionBoxQty, 'ea', 'NEC 690.31', 'runSegments.to=JUNCTION BOX', 'ceil(deviceCount/16)', true));
      log.push({ stageId: 'ac', category: 'junction_box', item: 'PV Junction Box',
        quantity: junctionBoxQty, derivedFrom: 'runSegments', formula: 'segments ending at JUNCTION BOX', necReference: 'NEC 690.31' });
      complianceNotes.push(`NEC 690.31: ${junctionBoxQty} junction box(es) — transitions open-air PV wire to conduit`);
    }
  }

  // ── STAGE 4: AC ──────────────────────────────────────────────────────────────

  // AC Wire & Conduit — use ComputedSystem.runs as single source of truth
  let acWireQty: number;
  let acConduitQty: number;
  let acWireDerivation: string;

  // Derive acWireGauge from runs when available (single source of truth)
  let resolvedAcWireGauge = input.acWireGauge ?? '#8 AWG';
  let resolvedConduitSize = input.conduitSizeInch ?? '3/4';

  if (input.runs && input.runs.length > 0) {
    // Get AC feeder run for gauge/conduit size
    const acRuns = input.runs.filter(r =>
      !r.isUtilityOwned && // Exclude utility-owned service conductors from BOM
      (r.color === 'ac' ||
      r.id === 'COMBINER_TO_DISCO_RUN' ||
      r.id === 'INV_TO_DISCO_RUN' ||
      r.id === 'DISCO_TO_METER_RUN')
      // METER_TO_MSP_RUN removed — no separate production meter per industry standard
    );
    const primaryAcRun = input.runs.find(r =>
      r.id === 'COMBINER_TO_DISCO_RUN' || r.id === 'INV_TO_DISCO_RUN'
    ) ?? acRuns[0];

    if (primaryAcRun) {
      resolvedAcWireGauge = primaryAcRun.wireGauge;
      resolvedConduitSize = primaryAcRun.conduitSize.replace('"', '');
    }

    // Derive wire length from runSegments: Σ(segment.length × (conductors + 1 EGC) × 1.15)
    acWireQty = acRuns.reduce((sum, r) =>
      sum + Math.ceil(r.onewayLengthFt * (r.conductorCount + 1) * 1.15), 0);
    // Derive conduit length from runSegments: Σ(segment.length × 1.15)
    acConduitQty = acRuns.reduce((sum, r) =>
      sum + Math.ceil(r.onewayLengthFt * 1.15), 0);
    acWireDerivation = 'Σ(runSegments.length × (conductors+1) × 1.15)';
  } else {
    // Fallback: AC home run has 4 conductors: L1, L2, N (current-carrying) + EGC
    acWireQty = conduitLength(input.acWireLength * 4);
    acConduitQty = conduitLength(input.acWireLength);
    acWireDerivation = 'acWireLength × 4 × 1.15';
  }

  // AC Wire item — gauge derived from ComputedSystem.runs
  items.push(addItem('ac', 'wire', 'Southwire', `${resolvedAcWireGauge} THWN-2`,
    `THWN2-${resolvedAcWireGauge.replace('#', '').replace(' AWG', '')}`,
    `${resolvedAcWireGauge} THWN-2 — AC home run (3 CC + 1 EGC = 4 conductors)`,
    acWireQty, 'ft', 'NEC 310.15 / 250.122', acWireDerivation, `${input.acWireLength} × 4 × 1.15`, true));
  log.push({ stageId: 'ac', category: 'wire', item: `${resolvedAcWireGauge} THWN-2`,
    quantity: acWireQty, derivedFrom: acWireDerivation, formula: 'acWireLength * 4 * 1.15', necReference: 'NEC 310.15 / 250.122' });

  // AC Conduit item — size derived from ComputedSystem.runs
  items.push(addItem('ac', 'conduit', 'Generic', `${resolvedConduitSize}" ${input.conduitType} Conduit`,
    `${input.conduitType}-${resolvedConduitSize.replace('/', '-')}`,
    `${resolvedConduitSize}" ${input.conduitType} conduit — AC home run`,
    acConduitQty, 'ft', 'NEC 358', 'Σ(runSegments.length × 1.15)', `${input.acWireLength} × 1.15`, true));

  // AC Disconnect
  if (input.requiresACDisconnect !== false) {
    const acDiscAmps = nextStandardBreaker(input.acOCPD);
    items.push(addItem('ac', 'disconnect', 'Square D', `${acDiscAmps}A AC Disconnect`,
      'DU30RB', `${acDiscAmps}A AC disconnect switch per NEC 690.14`,
      1, 'ea', 'NEC 690.14', 'perSystem', '1', true));
    log.push({ stageId: 'ac', category: 'ac_disconnect', item: `${acDiscAmps}A AC Disconnect`,
      quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 690.14' });
    complianceNotes.push(`NEC 690.14: AC disconnect ${acDiscAmps}A — sized for ${input.acOCPD}A backfeed`);
  }

  // Backfeed Breaker
  const backfeedAmps = nextStandardBreaker(input.backfeedAmps);
  items.push(addItem('ac', 'breaker', 'Square D', `${backfeedAmps}A Backfeed Breaker`,
    `QO${backfeedAmps}`,
    `${backfeedAmps}A 2-pole backfeed breaker — NEC 705.12 120% rule`,
    1, 'ea', 'NEC 705.12', 'perSystem', '1', true));
  log.push({ stageId: 'ac', category: 'breaker', item: `${backfeedAmps}A Backfeed Breaker`,
    quantity: 1, derivedFrom: 'backfeedAmps', formula: 'nextStandardBreaker(backfeedAmps)', necReference: 'NEC 705.12' });
  complianceNotes.push(`NEC 705.12: Backfeed breaker ${backfeedAmps}A — verify 120% rule: (${input.mainPanelAmps}A × 120%) ≥ (${input.mainPanelAmps}A + ${backfeedAmps}A)`);

  // Production Meter
  if (input.requiresProductionMeter) {
    items.push(addItem('ac', 'meter', 'Itron', 'Production Meter',
      'ITRON-PROD-1', 'Revenue-grade production meter', 1, 'ea', 'NEC 690.4', 'perSystem', '1', false));
  }

  // ── STAGE 5: STRUCTURAL ──────────────────────────────────────────────────────

  if (rackingEntry) {
    // Primary racking system
    items.push(addItem('structural', 'racking', rackingEntry.manufacturer, rackingEntry.model,
      rackingEntry.partNumber ?? rackingEntry.id,
      `${rackingEntry.manufacturer} ${rackingEntry.model} — ${rackingEntry.structuralSpecs?.requiresRail ? 'rail-based' : 'rail-less'} mount`,
      1, 'lot', rackingEntry.iccEsReport ?? 'IBC 2021', 'perSystem', '1', true));
    log.push({ stageId: 'structural', category: 'racking', item: rackingEntry.model,
      quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: rackingEntry.iccEsReport });

    // Resolve all racking accessories
    for (const acc of rackingEntry.requiredAccessories) {
      // Check conditional
      if (acc.conditional) {
        const conditionMet = evaluateConditionBOM(acc.conditional, input.roofType);
        if (!conditionMet) continue;
      }

      let qty = 1;
      if (acc.quantityRule === 'formula' && acc.quantityFormula) {
        qty = evaluateQuantityFormulaV4(acc.quantityFormula, {
          ...formulaCtx,
          attachments: input.attachmentCount,
          railSections: input.railSections,
        });
      } else if (acc.quantityRule === 'perModule') {
        qty = input.moduleCount;
      } else if (acc.quantityRule === 'perString') {
        qty = input.stringCount;
      } else if (acc.quantityRule === 'perAttachment') {
        qty = input.attachmentCount;
      } else if (acc.quantityRule === 'perSystem') {
        qty = 1;
      }

      if (acc.quantityMultiplier) qty *= acc.quantityMultiplier;
      qty = Math.ceil(qty);

      if (qty > 0) {
        items.push(addItem('structural', acc.category,
          acc.defaultManufacturer ?? rackingEntry.manufacturer,
          acc.defaultModel ?? acc.description,
          acc.defaultPartNumber ?? 'TBD',
          acc.description,
          qty, 'ea', acc.necReference ?? 'IBC 2021',
          acc.quantityFormula ?? acc.quantityRule,
          acc.quantityFormula ?? acc.quantityRule,
          acc.required));
        log.push({ stageId: 'structural', category: acc.category,
          item: acc.defaultModel ?? acc.description, quantity: qty,
          derivedFrom: acc.quantityFormula ?? acc.quantityRule,
          formula: acc.quantityFormula ?? acc.quantityRule,
          necReference: acc.necReference });
      }
    }
  }

  // Grounding wire (always required)
  const groundWireQty = conduitLength(input.acWireLength);
  items.push(addItem('structural', 'wire', 'Southwire', '#6 AWG Bare Copper Ground',
    'BARE-CU-6', '#6 AWG bare copper grounding conductor',
    groundWireQty, 'ft', 'NEC 690.43', 'acWireLength × 1.15', `${input.acWireLength} × 1.15`, true));

  // ── STAGE 6: MONITORING ──────────────────────────────────────────────────────

  // Gateway already added above in Stage 3 if needed
  // Add monitoring accessories from inverter entry
  if (inverterEntry) {
    const monitoringAcc = inverterEntry.requiredAccessories.find(a => a.category === 'monitoring');
    if (monitoringAcc) {
      items.push(addItem('monitoring', 'monitoring',
        monitoringAcc.defaultManufacturer ?? inverterEntry.manufacturer,
        monitoringAcc.defaultModel ?? 'Monitoring System',
        monitoringAcc.defaultPartNumber ?? 'MON-TBD',
        monitoringAcc.description, 1, 'ea',
        monitoringAcc.necReference ?? 'NEC 690.4', 'perSystem', '1', false));
    }
  }

  // ── STAGE 7: LABELS ──────────────────────────────────────────────────────────

  if (input.requiresWarningLabels !== false) {
    // NEC 690.31 — DC conductor labels
    items.push(addItem('labels', 'label', 'HellermannTyton', 'DC Conductor Label Set',
      'LABEL-DC-SET', 'DC conductor warning labels per NEC 690.31',
      input.stringCount * 2, 'ea', 'NEC 690.31', 'stringCount × 2', 'strings * 2', true));

    // NEC 690.54 — Equipment labels
    items.push(addItem('labels', 'label', 'HellermannTyton', 'PV System Warning Label',
      'LABEL-PV-WARN', 'PV system warning label per NEC 690.54',
      1, 'ea', 'NEC 690.54', 'perSystem', '1', true));

    // NEC 690.56 — Rapid shutdown label
    if (input.requiresRapidShutdown !== false) {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Rapid Shutdown Label',
        'LABEL-RSD', 'Rapid shutdown label per NEC 690.56',
        1, 'ea', 'NEC 690.56', 'perSystem', '1', true));
    }

    // NEC 705.12 — Backfeed breaker label
    items.push(addItem('labels', 'label', 'HellermannTyton', 'Backfeed Breaker Label',
      'LABEL-BF', 'Backfeed breaker label per NEC 705.12',
      1, 'ea', 'NEC 705.12', 'perSystem', '1', true));

    // Disconnecting means label
    items.push(addItem('labels', 'label', 'HellermannTyton', 'Disconnecting Means Label',
      'LABEL-DISC', 'Disconnecting means label per NEC 690.13',
      input.inverterCount + 1, 'ea', 'NEC 690.13', 'inverterCount + 1', 'inverters + 1', true));

    log.push({ stageId: 'labels', category: 'label', item: 'Warning Label Set',
      quantity: 5, derivedFrom: 'NEC 690.31, 690.54, 690.56, 705.12, 690.13', formula: 'perSystem', necReference: 'NEC 690' });
  }

  // ── Build Stage Results ───────────────────────────────────────────────────────

  const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
  for (const item of items) {
    if (!stageMap.has(item.stageId)) stageMap.set(item.stageId, []);
    stageMap.get(item.stageId)!.push(item);
  }

  const stages: BOMStageResult[] = (Object.keys(STAGE_LABELS) as BOMStageId[]).map(id => ({
    id,
    label: STAGE_LABELS[id],
    order: STAGE_ORDER[id],
    items: stageMap.get(id) ?? [],
    itemCount: stageMap.get(id)?.length ?? 0,
  })).sort((a, b) => a.order - b.order);

  return {
    items,
    stages,
    totalLineItems: items.length,
    generatedAt: new Date().toISOString(),
    topology,
    topologyLabel: topoResult.label,
    derivationLog: log,
    warnings,
    complianceNotes,
  };
}

// ─── Helper: Add Item ─────────────────────────────────────────────────────────

function addItem(
  stageId: BOMStageId,
  category: string,
  manufacturer: string,
  model: string,
  partNumber: string,
  description: string,
  quantity: number,
  unit: BOMLineItemV4['unit'],
  necReference: string,
  derivedFrom: string,
  formula: string,
  required: boolean,
  notes?: string
): BOMLineItemV4 {
  return {
    id: nextId(),
    stageId,
    stageLabel: STAGE_LABELS[stageId],
    category,
    manufacturer,
    model,
    partNumber,
    description,
    quantity: Math.max(0, Math.ceil(quantity)),
    unit,
    necReference,
    derivedFrom,
    formula,
    required,
    notes,
  };
}

// ─── Helper: Evaluate Conditional ────────────────────────────────────────────

function evaluateConditionBOM(condition: string, roofType: string): boolean {
  const parts = condition.split('||').map(p => p.trim());
  return parts.some(part => {
    const match = part.match(/roofType\s*===\s*(\w+)/);
    if (match) return roofType === match[1];
    return false;
  });
}

// ─── BOM Export Helpers ───────────────────────────────────────────────────────

export function bomToCSV(result: BOMGenerationResultV4): string {
  const header = ['Stage', 'Category', 'Manufacturer', 'Model', 'Part Number', 'Description', 'Qty', 'Unit', 'NEC Ref', 'Required', 'Derived From'];
  const rows = result.items.map(item => [
    item.stageLabel,
    item.category,
    item.manufacturer,
    item.model,
    item.partNumber,
    item.description,
    String(item.quantity),
    item.unit,
    item.necReference ?? '',
    item.required ? 'Yes' : 'No',
    item.derivedFrom,
  ]);
  return [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
}

export function bomToMarkdown(result: BOMGenerationResultV4): string {
  const lines: string[] = [
    `# Bill of Materials`,
    `**Topology:** ${result.topologyLabel}`,
    `**Generated:** ${new Date(result.generatedAt).toLocaleString()}`,
    `**Total Line Items:** ${result.totalLineItems}`,
    '',
  ];

  for (const stage of result.stages) {
    if (stage.items.length === 0) continue;
    lines.push(`## ${stage.label}`);
    lines.push('');
    lines.push('| # | Manufacturer | Model | Part Number | Description | Qty | Unit | NEC Ref |');
    lines.push('|---|---|---|---|---|---|---|---|');
    stage.items.forEach((item, i) => {
      lines.push(`| ${i + 1} | ${item.manufacturer} | ${item.model} | ${item.partNumber} | ${item.description} | ${item.quantity} | ${item.unit} | ${item.necReference ?? ''} |`);
    });
    lines.push('');
  }

  if (result.complianceNotes.length > 0) {
    lines.push('## Compliance Notes');
    result.complianceNotes.forEach(note => lines.push(`- ${note}`));
    lines.push('');
  }

  return lines.join('\n');
}