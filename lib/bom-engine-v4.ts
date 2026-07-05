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
import { getGeneratorById, getATSById, getBackupInterfaceById } from './equipment-db';
// MASTER TASK: deriveStructuralBOM removed from V4 — now called in API route merge layer
import type { BOMLineItemV4, BOMStageId, BOMSystemType } from './bom-types-v4';

// ─── BOM shared line/stage types are defined in ./bom-types-v4 ─────────────

export type { BOMLineItemV4, BOMStageId, BOMSystemType } from './bom-types-v4';

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
  acOutputKw?: number;        // AC nameplate kW — sizes AC-side gear (disconnect/fuse/backfeed); systemKw is DC and oversizes them

  // Wiring
  dcWireGauge: string;
  acWireGauge: string;
  dcWireLength: number;       // feet (DC home run, INCLUDES trenchRunLengthFt for ground/fence)
  trenchRunLengthFt?: number; // feet — buried ground/fence array→service portion (NEC 300.5 PVC); subset of dcWireLength
  acWireLength: number;       // feet (AC home run)
  conduitType: 'EMT' | 'PVC' | 'RMC' | 'LFMC';
  conduitSizeInch: string;    // e.g. "3/4"
  
  // ComputedSystem.runs — single source of truth for wire/conduit quantities
  runs?:                   RunSegment[];
  
  // ComputedSystem.bomQuantities — pre-calculated wire/conduit quantities from segmentSchedule
  // When provided, these are used DIRECTLY for wire line items (guarantees exact match with summary cards)
  bomQuantities?: {
    wire10AWG?: number;
    wire8AWG?: number;
    wire6AWG?: number;
    wire4AWG?: number;
    conduitEMT?: number;
    conduitPVC?: number;
  };

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
  acVoltage?: number;         // AC system voltage (default: 240V)
  dcVoltage?: number;         // DC string voltage (default: 400V)
  phases?: number;            // 1 or 3 phase (default: 1)
  moduleWatts?: number;       // module wattage (for BOM display)

  // Jurisdiction
  jurisdiction?: string;
  requiresProductionMeter?: boolean;
  requiresACDisconnect?: boolean;
  requiresDCDisconnect?: boolean;
  requiresRapidShutdown?: boolean;

  // Labels (NEC 690.31, 690.54, 690.56)
  requiresWarningLabels?: boolean;

  // Interconnection method — controls whether backfed breaker appears in BOM
  // 'LOAD_SIDE' | 'SUPPLY_SIDE_TAP' | 'MAIN_BREAKER_DERATE' | 'PANEL_UPGRADE' | 'BACKFED_BREAKER'
  interconnectionMethod?: string;
  panelBusRating?: number;  // For NEC 705.12(B) 120% rule calculation

  // Generator / ATS / BUI — for BOM line items
  generatorId?: string;
  atsId?: string;
  backupInterfaceId?: string;
  generatorKw?: number;
  atsAmpRating?: number;
  backupInterfaceMaxA?: number;
  generatorWireLength?: number;  // ft — distance from generator to ATS, drives the whip cable line item
  batteryCount?: number;        // qty of battery units

  // System type — enables fence/ground structural BOM via bom-system-profiles
  systemType?: BOMSystemType;

  // Error 7b fix: topologyType accessed via `(input as any).topologyType` in debug log
  topologyType?: TopologyType;

  // Fence structural input (from CADFenceModel)
  fenceData?: {
    totalPosts: number;
    postSpacingFt: number;
    postEmbedFt: number;
    postHeightFt: number;
    railCount: number;
    totalFenceLengthFt: number;
    segmentCount: number;
    gateCount: number;
    gateWidthsFt: number[];
    solarSectionCount: number;
    vinylSectionCount: number;
    panelWidthFt: number;
    panelHeightFt: number;
  };

  // Ground structural input (from CADGroundArray / structural engine)
  groundData?: {
    pileCount: number;
    pileSpacingFt: number;
    pileEmbedmentFt: number;
    structureType: string;
    rowCount: number;
    panelsPerRow: number;
    arrayWidthFt: number;
    railsPerRow: number;
    groundClearanceFt: number;
  };
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
  inverter:   'Stage 3 — Inverter / Storage / Combiner',
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
  console.log('[V4 RECEIVED]', {
    rackingId: input.rackingId,
    roofType: input.roofType,
    attachmentCount: input.attachmentCount,
    railSections: input.railSections,
    moduleCount: input.moduleCount,
    topologyType: input.topologyType,
  });
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

  // FIX v57.2: For microinverter topology, stringCount=0 (no DC strings).
  // Structural rail/clamp formulas use 'strings' as a proxy for "rows of modules".
  // Compute effectiveRows: use explicit rowCount if provided, else derive from
  // railSections (2 rails per row) or estimate ceil(modules / 4) as default.
  // This ensures rails, end-clamps, and mid-clamps produce correct non-zero quantities.
  const isMicroTopo = norm === 'MICROINVERTER' || norm === 'AC_MODULE';
  const effectiveRows: number = isMicroTopo && input.stringCount === 0
    ? (input.rowCount
        ?? (input.railSections > 0 ? Math.round(input.railSections / 2) : null)
        ?? Math.max(1, Math.ceil(input.moduleCount / 4)))
    : (input.stringCount > 0 ? input.stringCount : Math.max(1, Math.ceil(input.moduleCount / 4)));

  const formulaCtx = {
    modules: input.moduleCount,
    strings: effectiveRows,           // FIX v57.2: use effectiveRows, not raw stringCount
    inverters: input.inverterCount,
    branches: effectiveRows,          // branches = rows for micro (AC branch per row)
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
  // v58.7 FIX: Guard against string_inverter being passed as optimizerId.
  // When inverterId='se-11400h' is mistakenly sent as optimizerId (legacy/no-peripheral config),
  // getRegistryEntryV4('se-11400h') returns category='string_inverter' — NOT an optimizer.
  // Using it in Stage 1 shows SE11400H×36 as if it were an optimizer peripheral (WRONG).
  // Fix: only use optimizerEntry if category === 'optimizer'.
  // Fallback: use default optimizer from inverterEntry.requiredAccessories.
  const safeOptimizerEntry = (() => {
    // Case 1: Valid optimizer peripheral passed explicitly — use it
    if (optimizerEntry && optimizerEntry.category === 'optimizer') return optimizerEntry;
    // Case 2: optimizerEntry is wrong category (e.g. string_inverter ID passed as optimizerId)
    // OR no optimizerId sent — look up default optimizer from inverter's requiredAccessories
    if (inverterEntry && (norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY')) {
      const defaultOptimizerAcc = inverterEntry.requiredAccessories.find((a: any) => a.category === 'optimizer');
      if (defaultOptimizerAcc) {
        // Find optimizer in registry by matching manufacturer + part number
        const found = EQUIPMENT_REGISTRY_V4.find((e: any) =>
          e.category === 'optimizer' &&
          e.manufacturer === defaultOptimizerAcc.defaultManufacturer &&
          (e.partNumber === defaultOptimizerAcc.defaultPartNumber || e.model?.includes(defaultOptimizerAcc.defaultModel?.split(' ')[0] ?? ''))
        );
        if (found) {
          console.warn('[BOM V4] safeOptimizerEntry fallback to inverter default:', found.id,
            optimizerEntry ? '(optimizerId was wrong category: ' + optimizerEntry.category + ')' : '(no optimizerId sent)');
          return found;
        }
      }
    }
    return undefined;
  })();
  if ((norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY') && safeOptimizerEntry) {
    items.push(addItem('array', 'optimizer', safeOptimizerEntry.manufacturer, safeOptimizerEntry.model,
      safeOptimizerEntry.partNumber ?? safeOptimizerEntry.id,
      `DC Power Optimizer — 1 per module`,
      input.moduleCount, 'ea', 'NEC 690.8', 'moduleCount', 'modules', true));
    log.push({ stageId: 'array', category: 'optimizer', item: safeOptimizerEntry.model,
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
    // DC Wire (string inverter topology) — defensive defaults for all wire/conduit fields
    const resolvedDcWireGauge   = input.dcWireGauge   ?? '#10 AWG';
    const resolvedDcWireLength  = input.dcWireLength  ?? 50;
    const resolvedConduitType   = input.conduitType   ?? 'EMT';
    const resolvedDcConduitSize = input.conduitSizeInch ?? '3/4';
    const dcWireQty = conduitLength(resolvedDcWireLength * 2); // 2 conductors (+ and -)
    items.push(addItem('dc', 'wire', 'Southwire', `${resolvedDcWireGauge} USE-2 PV Wire`,
      `USE2-${resolvedDcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${resolvedDcWireGauge} USE-2 PV Wire — DC home run`,
      dcWireQty, 'ft', 'NEC 690.31', 'dcWireLength × 2 × 1.15', `${resolvedDcWireLength} × 2 × 1.15`, true));
    log.push({ stageId: 'dc', category: 'wire', item: `${resolvedDcWireGauge} USE-2`,
      quantity: dcWireQty, derivedFrom: 'dcWireLength × 2 conductors × 1.15 fitting', formula: 'dcWireLength * 2 * 1.15', necReference: 'NEC 690.31' });

    // DC Conduit. For ground/fence the buried array→service portion (trench) uses
    // underground-rated PVC Sch 40 (NEC 300.5, min 18" burial); the above-ground
    // portion uses the standard conduit type. trenchRunLengthFt is a subset of
    // resolvedDcWireLength (the page already folded it into the DC home run).
    const _trenchFt      = Math.max(0, Math.min(input.trenchRunLengthFt ?? 0, resolvedDcWireLength));
    const _aboveGroundDc = Math.max(0, resolvedDcWireLength - _trenchFt);
    if (_aboveGroundDc > 0) {
      const dcConduitQty = conduitLength(_aboveGroundDc);
      items.push(addItem('dc', 'conduit', 'Generic', `${resolvedDcConduitSize}" ${resolvedConduitType} Conduit`,
        `${resolvedConduitType}-${resolvedDcConduitSize.replace('/', '-')}`,
        `${resolvedDcConduitSize}" ${resolvedConduitType} conduit — DC home run`,
        dcConduitQty, 'ft', 'NEC 690.31', 'dcWireLength × 1.15', `${_aboveGroundDc} × 1.15`, true));
    }
    if (_trenchFt > 0) {
      const pvcQty = conduitLength(_trenchFt);
      items.push(addItem('dc', 'conduit', 'Cantex', `${resolvedDcConduitSize}" PVC Sch 40 — Underground`,
        `PVC40-${resolvedDcConduitSize.replace('/', '-')}`,
        `${resolvedDcConduitSize}" PVC Sch 40 underground conduit — buried DC trench run (NEC 300.5, min 18" burial)`,
        pvcQty, 'ft', 'NEC 300.5', 'trenchRunLengthFt × 1.15', `${_trenchFt} × 1.15`, true));
    }

    // DC Disconnect
    if (input.requiresDCDisconnect !== false) {
      // DC disconnect: part number derived from dcOCPD (e.g. DU30RB = 30A, DU60RB = 60A)
      const dcDiscAmps = nextStandardBreaker(input.dcOCPD > 0 ? input.dcOCPD : 30);
      const dcDiscPartNum = `DU${dcDiscAmps}RB`;
      items.push(addItem('dc', 'disconnect', 'Square D', `${dcDiscAmps}A DC Disconnect`,
        dcDiscPartNum, `${dcDiscAmps}A DC disconnect switch per NEC 690.15`,
        input.inverterCount, 'ea', 'NEC 690.15', 'inverterCount', 'inverters', true));
      log.push({ stageId: 'dc', category: 'dc_disconnect', item: `${dcDiscAmps}A DC Disconnect`,
        quantity: input.inverterCount, derivedFrom: 'inverterCount', formula: 'inverters', necReference: 'NEC 690.15' });
    }

    // Rapid Shutdown (string inverter without integrated RSD)
    // NEC 690.12 applies to PV circuits ON or IN buildings. A free-standing
    // ground-mount or fence array is not on a building, so module-level rapid
    // shutdown is NOT required (NEC 690.12(B)(2)). Don't force per-module RSD there.
    const rsdIntegrated = inverterEntry?.electricalSpecs?.rapidShutdownCompliant ?? false;
    const isOptimizer = norm === 'STRING_WITH_OPTIMIZER';
    const _rsdExemptMount = input.systemType === 'ground' || input.systemType === 'fence';
    if (input.requiresRapidShutdown !== false && !rsdIntegrated && !isOptimizer && !_rsdExemptMount) {
      items.push(addItem('dc', 'rapid_shutdown', 'Tigo', 'TS4-A-F Rapid Shutdown',
        'TS4-A-F', 'Rapid shutdown device per NEC 690.12 — 1 per module',
        input.moduleCount, 'ea', 'NEC 690.12', 'moduleCount', 'modules', true));
      log.push({ stageId: 'dc', category: 'rapid_shutdown', item: 'TS4-A-F',
        quantity: input.moduleCount, derivedFrom: 'moduleCount', formula: 'modules', necReference: 'NEC 690.12' });
      complianceNotes.push('NEC 690.12: Rapid shutdown devices added — 1 per module (Tigo TS4-A-F)');
    } else if (_rsdExemptMount) {
      complianceNotes.push(`NEC 690.12(B)(2): module-level rapid shutdown not required — ${input.systemType} array is not on/in a building`);
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
    const batQty = input.batteryCount && input.batteryCount > 1 ? input.batteryCount : 1;
    items.push(addItem('inverter', 'battery', batteryEntry.manufacturer, batteryEntry.model,
      batteryEntry.partNumber ?? batteryEntry.id,
      `Battery Storage System — ${batteryEntry.electricalSpecs.acOutputKw ?? ''}kW`,
      batQty, 'ea', 'NEC 706', 'batteryCount', String(batQty), true));
    log.push({ stageId: 'inverter', category: 'battery', item: batteryEntry.model,
      quantity: batQty, derivedFrom: 'batteryCount', formula: String(batQty), necReference: 'NEC 706' });
  }

  // Generator — add to BOM if configured (NEC 702 Optional Standby Systems)
  if (input.generatorId) {
    const gen = getGeneratorById(input.generatorId);
    if (gen) {
      items.push(addItem('inverter', 'generator', gen.manufacturer, gen.model,
        input.generatorId.toUpperCase(),
        `Standby Generator — ${gen.ratedOutputKw}kW / ${gen.fuelType.replace('_', ' ')} / ${gen.outputBreakerA}A output breaker`,
        1, 'ea', 'NEC 702', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'generator', item: gen.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 702' });
    }
  } else if (input.generatorKw && input.generatorKw > 0) {
    // Fallback: no ID but kW provided
    items.push(addItem('inverter', 'generator', 'TBD', `${input.generatorKw}kW Standby Generator`,
      'GEN-TBD',
      `Standby Generator — ${input.generatorKw}kW — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702', 'perSystem', '1', true));
  }

  // ATS — add to BOM if configured (NEC 702.5 Transfer Equipment)
  if (input.atsId) {
    const ats = getATSById(input.atsId);
    if (ats) {
      items.push(addItem('inverter', 'ats', ats.manufacturer, ats.model,
        input.atsId.toUpperCase(),
        `Automatic Transfer Switch — ${ats.ampRating}A / ${ats.voltageV}V${ats.serviceEntranceRated ? ' — Service Entrance Rated' : ''}`,
        1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'ats', item: ats.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 702.5' });
    }
  } else if (input.atsAmpRating && input.atsAmpRating > 0) {
    // Fallback: no ID but amp rating provided
    items.push(addItem('inverter', 'ats', 'TBD', `${input.atsAmpRating}A Automatic Transfer Switch`,
      'ATS-TBD',
      `Automatic Transfer Switch — ${input.atsAmpRating}A — NEC 702.5: Transfer Equipment Required`,
      1, 'ea', 'NEC 702.5', 'perSystem', '1', true));
  }

  // Backup Interface Unit (BUI) — add to BOM if configured (NEC 706 / NEC 230.82)
  if (input.backupInterfaceId) {
    const bui = getBackupInterfaceById(input.backupInterfaceId);
    if (bui) {
      const isIQSC3 = bui.model?.toLowerCase().includes('sc3') || bui.model?.toLowerCase().includes('system controller 3');
      items.push(addItem('inverter', 'backup_interface', bui.manufacturer, bui.model,
        input.backupInterfaceId.toUpperCase(),
        `Backup Interface Unit${isIQSC3 ? ' / ATS (Service Entrance Rated)' : ''} — ${bui.maxContinuousOutputA}A / 240V`,
        1, 'ea', isIQSC3 ? 'NEC 706 / NEC 230.82' : 'NEC 706', 'perSystem', '1', true));
      log.push({ stageId: 'inverter', category: 'backup_interface', item: bui.model,
        quantity: 1, derivedFrom: 'perSystem', formula: '1', necReference: 'NEC 706' });
    }
  } else if (input.backupInterfaceMaxA && input.backupInterfaceMaxA > 0) {
    // Fallback: no ID but max amps provided
    items.push(addItem('inverter', 'backup_interface', 'TBD', `${input.backupInterfaceMaxA}A Backup Interface Unit`,
      'BUI-TBD',
      `Backup Interface Unit — ${input.backupInterfaceMaxA}A / 240V — NEC 706`,
      1, 'ea', 'NEC 706', 'perSystem', '1', true));
  }

  // Generator whip wire — driven by generatorWireLength (distance gen → ATS).
  // Gauge pulled from the canonical generator's outputWireGaugeMin in equipment-db;
  // quantity uses the same 15% fitting allowance as conduit runs elsewhere.
  if (input.generatorId && input.generatorWireLength && input.generatorWireLength > 0) {
    const gen = getGeneratorById(input.generatorId);
    const gauge = gen?.outputWireGaugeMin ?? '#6 AWG';
    const ft = Math.ceil(input.generatorWireLength * 1.15);
    const unitCost = 1.85; // ballpark THWN-2 copper per-ft; align with distributor at next price refresh
    items.push(addItem(
      'inverter',
      'wire',
      'Generic',
      gauge,
      `WHIP-${gauge.replace(/\s|#/g, '')}`,
      `Generator-to-ATS whip cable, ${gauge} THWN-2`,
      ft,
      'ft',
      'NEC 702.4, NEC 215',
      `config.generatorWireLength = ${input.generatorWireLength} ft × 1.15 fitting allowance`,
      `${input.generatorWireLength} ft × 1.15 = ${ft} ft`,
      true,
      undefined,
      unitCost,
      ft * unitCost,
    ));
    log.push({ stageId: 'inverter', category: 'wire', item: `Generator whip ${gauge}`,
      quantity: ft, derivedFrom: 'generatorWireLength', formula: `${input.generatorWireLength} × 1.15`, necReference: 'NEC 702.4, NEC 215' });
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

  // Wire & Conduit — use ComputedSystem.runs as single source of truth
  // Generate ONE line item per wire gauge and ONE per conduit type/size
  // This ensures BOM line items match the summary card quantities (wire10AWG, wire8AWG, etc.)

  if (input.runs && input.runs.length > 0) {
    // ── All customer-owned runs (exclude utility-owned service conductors) ──
    // Error 7b fix: RunSegment already declares wireGauge, egcGauge, conductorCount,
    // onewayLengthFt, conduitType, conduitSize, isUtilityOwned, id — no `as any` needed.
    const allBomRuns = input.runs.filter(r => !r.isUtilityOwned);

    // ── DC wire runs (ROOF_RUN for micro, DC_STRING_RUN / DC_DISCO_TO_INV_RUN for string) ──
    // For string topology, DC wire is already added in Stage 2 (USE-2 PV wire).
    // For micro topology, ROOF_RUN is open-air DC wiring — add as separate BOM line item.
    const dcRunIds = new Set(['ROOF_RUN', 'DC_STRING_RUN', 'DC_DISCO_TO_INV_RUN']);
    const dcBomRuns = allBomRuns.filter(r => dcRunIds.has(r.id));
    const acBomRuns = allBomRuns.filter(r => !dcRunIds.has(r.id));

    // ── Group DC runs by wire gauge → one line item per gauge (micro only, matches calcBOMFromSegments) ──
    // Key insight: EGC can be a DIFFERENT gauge than DC conductors
    if (isMicro && dcBomRuns.length > 0) {
      const dcGaugeMap = new Map<string, { qty: number; runIds: string[] }>();
      
      for (const r of dcBomRuns) {
        const gauge: string = r.wireGauge ?? '#10 AWG';
        const egcGauge: string = r.egcGauge ?? '#10 AWG';
        const conductors: number = r.conductorCount ?? 2;
        const length: number = r.onewayLengthFt ?? 30;
        
        // Add DC conductor quantity (gauge = wireGauge)
        const dcQty = Math.ceil(length * conductors * 1.15);
        const dcExisting = dcGaugeMap.get(gauge);
        if (dcExisting) {
          dcExisting.qty += dcQty;
          dcExisting.runIds.push(r.id);
        } else {
          dcGaugeMap.set(gauge, { qty: dcQty, runIds: [r.id] });
        }
        
        // Add EGC quantity (gauge = egcGauge, may differ from wireGauge)
        const egcQty = Math.ceil(length * 1 * 1.15);
        const egcExisting = dcGaugeMap.get(egcGauge);
        if (egcExisting) {
          egcExisting.qty += egcQty;
          if (!egcExisting.runIds.includes(r.id)) {
            egcExisting.runIds.push(r.id);
          }
        } else {
          dcGaugeMap.set(egcGauge, { qty: egcQty, runIds: [r.id] });
        }
      }
      
      for (const [gauge, { qty, runIds }] of dcGaugeMap.entries()) {
        const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
        items.push(addItem('dc', 'wire', 'Southwire', `${gauge} USE-2/THWN-2`,
          `USE2-${gaugeNum}`,
          `${gauge} USE-2 — DC roof wiring (open-air, panels to microinverters)`,
          qty, 'ft', 'NEC 690.31',
          'Sum(length x conductors x 1.15)',
          `${gauge} DC runs x 1.15`, true));
        log.push({ stageId: 'dc', category: 'wire', item: `${gauge} USE-2`,
          quantity: qty, derivedFrom: runIds.join(', '),
          formula: 'Sum(length x conductors x 1.15)', necReference: 'NEC 690.31' });
      }
    }

    // ── Group AC runs by wire gauge → one line item per gauge (matches calcBOMFromSegments) ──
    // Produces separate line items for #10, #8, #6, #4 AWG matching summary cards
    // Key insight: EGC can be a DIFFERENT gauge than hot conductors
    // - Hot/neutral: length × conductorCount × 1.15 of wireGauge
    // - EGC: length × 1 × 1.15 of egcGauge (may differ from wireGauge)
    const wireGaugeMap = new Map<string, { qty: number; runIds: string[] }>();
    
    for (const r of acBomRuns) {
      const gauge: string = r.wireGauge ?? input.acWireGauge ?? '#8 AWG';
      const egcGauge: string = r.egcGauge ?? '#10 AWG';
      const conductors: number = r.conductorCount ?? 3;
      const length: number = r.onewayLengthFt ?? 50;
      
      // Add hot/neutral conductor quantity (gauge = wireGauge)
      const hotQty = Math.ceil(length * conductors * 1.15);
      const hotExisting = wireGaugeMap.get(gauge);
      if (hotExisting) {
        hotExisting.qty += hotQty;
        hotExisting.runIds.push(r.id);
      } else {
        wireGaugeMap.set(gauge, { qty: hotQty, runIds: [r.id] });
      }
      
      // Add EGC quantity (gauge = egcGauge, may differ from wireGauge)
      // EGC is always 1 conductor per run
      const egcQty = Math.ceil(length * 1 * 1.15);
      const egcExisting = wireGaugeMap.get(egcGauge);
      if (egcExisting) {
        egcExisting.qty += egcQty;
        if (!egcExisting.runIds.includes(r.id)) {
          egcExisting.runIds.push(r.id);
        }
      } else {
        wireGaugeMap.set(egcGauge, { qty: egcQty, runIds: [r.id] });
      }
    }

    // Emit one wire line item per gauge (sorted: smaller AWG number = larger wire = first)
    const sortedGauges = [...wireGaugeMap.entries()].sort((a, b) => {
      const numA = parseInt(a[0].replace('#', '').replace(' AWG', '')) || 99;
      const numB = parseInt(b[0].replace('#', '').replace(' AWG', '')) || 99;
      return numA - numB;
    });

    for (const [gauge, { qty, runIds }] of sortedGauges) {
      const gaugeNum = gauge.replace('#', '').replace(' AWG', '');
      const runLabel = runIds.join(', ');
      items.push(addItem('ac', 'wire', 'Southwire', `${gauge} THWN-2`,
        `THWN2-${gaugeNum}`,
        `${gauge} THWN-2 — AC wiring (${runLabel})`,
        qty, 'ft', 'NEC 310.15 / 250.122',
        `Sum(length x conductors x 1.15)`,
        `${gauge} wire runs x 1.15`, true));
      log.push({ stageId: 'ac', category: 'wire', item: `${gauge} THWN-2`,
        quantity: qty, derivedFrom: runLabel,
        formula: 'Sum(length x conductors x 1.15)', necReference: 'NEC 310.15 / 250.122' });
    }

    // ── Group ALL runs by conduit type+size → one conduit line item per type/size ──
    const conduitMap = new Map<string, { qty: number; type: string; size: string }>();
    for (const r of allBomRuns) {
      const cType: string = r.conduitType ?? input.conduitType ?? 'EMT';
      const cSize: string = (r.conduitSize ?? `${input.conduitSizeInch ?? '3/4'}"`).replace('"', '');
      const key = `${cType}-${cSize}`;
      const qty = Math.ceil((r.onewayLengthFt ?? 30) * 1.15);
      const existing = conduitMap.get(key);
      if (existing) {
        existing.qty += qty;
      } else {
        conduitMap.set(key, { qty, type: cType, size: cSize });
      }
    }

    for (const [, { qty, type, size }] of conduitMap.entries()) {
      items.push(addItem('ac', 'conduit', 'Generic', `${size}" ${type} Conduit`,
        `${type}-${size.replace('/', '-')}`,
        `${size}" ${type} conduit — all runs`,
        qty, 'ft', 'NEC 358',
        'Sum(allRuns.length x 1.15)',
        `${size}" ${type} x 1.15`, true));
    }

  } else {
    // ── Fallback when no runs provided ──
    const resolvedAcWireGauge = input.acWireGauge ?? '#8 AWG';
    const resolvedConduitSize = input.conduitSizeInch ?? '3/4';
    // AC home run: 3 current-carrying conductors + 1 EGC = 4 total
    const acWireQty = conduitLength(input.acWireLength * 4);
    const acConduitQty = conduitLength(input.acWireLength);

    items.push(addItem('ac', 'wire', 'Southwire', `${resolvedAcWireGauge} THWN-2`,
      `THWN2-${resolvedAcWireGauge.replace('#', '').replace(' AWG', '')}`,
      `${resolvedAcWireGauge} THWN-2 — AC home run (3 CC + 1 EGC = 4 conductors)`,
      acWireQty, 'ft', 'NEC 310.15 / 250.122',
      'acWireLength x 4 x 1.15', `${input.acWireLength} x 4 x 1.15`, true));
    log.push({ stageId: 'ac', category: 'wire', item: `${resolvedAcWireGauge} THWN-2`,
      quantity: acWireQty, derivedFrom: 'acWireLength x 4 conductors x 1.15 fitting',
      formula: 'acWireLength * 4 * 1.15', necReference: 'NEC 310.15 / 250.122' });

    items.push(addItem('ac', 'conduit', 'Generic', `${resolvedConduitSize}" ${input.conduitType} Conduit`,
      `${input.conduitType}-${resolvedConduitSize.replace('/', '-')}`,
      `${resolvedConduitSize}" ${input.conduitType} conduit — AC home run`,
      acConduitQty, 'ft', 'NEC 358',
      'acWireLength x 1.15', `${input.acWireLength} x 1.15`, true));
  }

  // ── Conduit Fittings (NEC 300.15 / 358.30) ─────────────────────────────────
  // Auto-derived from total conduit length across all runs.
  // Rule of thumb: 1 connector + 1 coupling per 10 ft of conduit.
  {
    const totalConduitFt = (() => {
      if (input.runs && input.runs.length > 0) {
        return input.runs
          .filter(r => !r.isUtilityOwned)
          .reduce((sum: number, r) =>
            sum + Math.ceil((r.onewayLengthFt ?? 30) * 1.15), 0);
      }
      return conduitLength(input.acWireLength);
    })();

    const conduitType = input.conduitType ?? 'EMT';
    const conduitSize = input.conduitSizeInch ?? '3/4';

    // Connectors — 1 per 10 ft (termination at each end + mid-run joins)
    const connQty = Math.max(2, Math.ceil(totalConduitFt / 10));
    items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Connector`,
      `${conduitType}-CONN-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} set-screw connector — NEC 300.15`,
      connQty, 'ea', 'NEC 300.15 / 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

    // Couplings — 1 per 10 ft (joins 10-ft sticks)
    const couplingQty = Math.max(1, Math.ceil(totalConduitFt / 10));
    items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} Coupling`,
      `${conduitType}-COUP-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} coupling — joins conduit sticks`,
      couplingQty, 'ea', 'NEC 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

    // Insulated bushings — 1 per conduit termination end (min 2 per run segment)
    const bushingQty = Math.max(2, Math.ceil(totalConduitFt / 50) * 2);
    items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" Insulated Bushing`,
      `BUSH-INS-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" insulated throat bushing — protects conductors at conduit end per NEC 300.15`,
      bushingQty, 'ea', 'NEC 300.15', 'ceil(totalConduitFt/50)*2', `ceil(${totalConduitFt}/50)*2`, true));

    // One-hole straps — 1 per 10 ft (NEC 358.30 support every 10 ft)
    const strapQty = Math.max(2, Math.ceil(totalConduitFt / 10));
    items.push(addItem('ac', 'conduit_fitting', 'Raco/Allied', `${conduitSize}" ${conduitType} One-Hole Strap`,
      `${conduitType}-STRAP-${conduitSize.replace('/', '-')}`,
      `${conduitSize}" ${conduitType} one-hole strap — NEC 358.30 support every 10 ft`,
      strapQty, 'ea', 'NEC 358.30', 'ceil(totalConduitFt / 10)', `ceil(${totalConduitFt} / 10)`, true));

    log.push({ stageId: 'ac', category: 'conduit_fitting', item: 'Conduit Fittings Set',
      quantity: connQty + couplingQty + bushingQty + strapQty,
      derivedFrom: 'totalConduitFt',
      formula: 'connectors + couplings + bushings + straps derived from total conduit footage',
      necReference: 'NEC 300.15 / 358.30' });
  }

  // Interconnection method — needed for fused/non-fused disconnect decision
  // (also used below in Backfeed Breaker section)
  const interconMethod = String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
  const isSupplySideTap = interconMethod === 'SUPPLY_SIDE_TAP' ||
    interconMethod.includes('SUPPLY_SIDE') ||
    interconMethod.includes('LINE_SIDE') ||
    interconMethod.includes('LINE_TAP');

  // ── AC Disconnect Sizing Engine — NEC 690.14 / 705.60 / 705.11 ─────────────
  //
  // ONE combined disconnect for the whole system (NEC 690.14).
  // Sizing:
  //   1. Continuous current = systemKw × 1000 ÷ voltage  (NEC 705.60)
  //   2. Required amps      = continuous × 1.25           (125% continuous load rule)
  //   3. Fuse size          = next standard fuse ≥ required amps (fused disconnect only)
  //   4. Enclosure size     = next standard enclosure ≥ required amps
  //      Standard enclosures: 30A, 60A, 100A, 200A, 400A, 600A
  //
  // Fused vs Non-Fused:
  //   SUPPLY_SIDE_TAP (NEC 705.11) → FUSED — disconnect IS the OCPD (no panel breaker)
  //   LOAD_SIDE / MAIN_BREAKER_DERATE / PANEL_UPGRADE (NEC 705.12) → NON-FUSED
  //     — backfed breaker at panel IS the OCPD; disconnect just interrupts
  //
  if (input.requiresACDisconnect !== false) {
    const acVoltage = input.acVoltage ?? 240;

    // Step 1-2: Continuous current × 125% — from AC nameplate (DC kW would oversize the disco/fuse)
    const acContCurrent = ((input.acOutputKw ?? input.systemKw) * 1000) / acVoltage;
    const acRequiredAmps = acContCurrent * 1.25;

    // Step 3: Determine fused or non-fused from interconnection method
    const isFusedDisc = isSupplySideTap; // supply-side = fused; load-side = non-fused

    // Step 4: Standard sizes
    const STD_FUSE_SIZES   = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];
    const STD_ENCLOSURES   = [30, 60, 100, 200, 400, 600];
    const nextFuse         = (a: number) => STD_FUSE_SIZES.find(f => f >= a) ?? Math.ceil(a / 10) * 10;
    const nextEnclosure    = (a: number) => STD_ENCLOSURES.find(e => e >= a) ?? Math.ceil(a / 100) * 100;

    // Fuse size = next standard fuse ≥ required amps (fused only)
    const fuseAmps = isFusedDisc ? nextFuse(acRequiredAmps) : null;

    // Enclosure size = next standard enclosure ≥ required amps
    // For fused: enclosure must hold the fuse, so enclosure ≥ fuse amps
    // For non-fused: enclosure ≥ required amps
    const enclosureRequirement = isFusedDisc ? (fuseAmps ?? acRequiredAmps) : acRequiredAmps;
    const acDiscAmps = nextEnclosure(enclosureRequirement);

    // Part number:
    //   Non-fused: Square D DU{amps}RB  (e.g. DU60RB, DU100RB)
    //   Fused:     Eaton DPF2{code}RP   (30A→DPF221RP, 60A→DPF222RP, 100A→DPF222RB, 200A→DPF224RB)
    const nonFusedPartNum = `DU${acDiscAmps}RB`;
    const fusedPartNumMap: Record<number, string> = {
      30: 'DPF221RP', 60: 'DPF222RP', 100: 'DPF222RB', 200: 'DPF224RB',
    };
    const fusedPartNum = fusedPartNumMap[acDiscAmps] ?? `DPF-${acDiscAmps}A`;
    const acDiscPartNum = isFusedDisc ? fusedPartNum : nonFusedPartNum;
    const acDiscMfr     = isFusedDisc ? 'Eaton' : 'Square D';
    const discTypeLabel = isFusedDisc ? 'Fusible' : 'Non-Fusible';

    items.push(addItem('ac', 'disconnect', acDiscMfr,
      `${acDiscAmps}A ${discTypeLabel} AC Disconnect`,
      acDiscPartNum,
      `${acDiscAmps}A ${discTypeLabel} AC disconnect — NEC 690.14` +
        (isFusedDisc ? ` / NEC 705.11 supply-side (fuse: ${fuseAmps}A)` : ' / NEC 705.12 load-side'),
      1, 'ea', 'NEC 690.14', 'perSystem',
      `nextEnclosure(${acRequiredAmps.toFixed(1)}A × 1.25) = ${acDiscAmps}A`, true));

    // Add fuse line item for fused disconnect
    if (isFusedDisc && fuseAmps !== null) {
      items.push(addItem('ac', 'fuse', 'Littelfuse',
        `${fuseAmps}A Class RK5 Fuse`,
        `LLNRK${fuseAmps}SP`,
        `${fuseAmps}A 250V Class RK5 time-delay fuse — 2 per fused disconnect (NEC 690.9)`,
        2, 'ea', 'NEC 690.9', 'perSystem', '2 per fused disconnect', true));
      log.push({ stageId: 'ac', category: 'fuse', item: `${fuseAmps}A Class RK5 Fuse`,
        quantity: 2, derivedFrom: 'fused disconnect',
        formula: `nextFuse(continuous × 1.25) = ${fuseAmps}A × 2 poles`,
        necReference: 'NEC 690.9' });
    }

    log.push({ stageId: 'ac', category: 'ac_disconnect', item: `${acDiscAmps}A ${discTypeLabel} AC Disconnect`,
      quantity: 1, derivedFrom: 'perSystem',
      formula: `nextEnclosure(${acContCurrent.toFixed(1)}A × 1.25 = ${acRequiredAmps.toFixed(1)}A) = ${acDiscAmps}A enclosure`,
      necReference: 'NEC 690.14' });
    complianceNotes.push(
      `NEC 690.14 / NEC 705.60: 1× ${acDiscAmps}A ${discTypeLabel} disconnect — ` +
      `${acContCurrent.toFixed(1)}A output × 1.25 = ${acRequiredAmps.toFixed(1)}A → ${acDiscAmps}A enclosure` +
      (isFusedDisc ? ` + ${fuseAmps}A fuse (NEC 705.11 supply-side)` : ' (NEC 705.12 load-side)')
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Backfeed Breaker — NEC 705.12(B) Load-Side vs NEC 705.11 Supply-Side
  //
  // NEC interconnection methods:
  //   LOAD_SIDE (NEC 705.12(B))    → backfed breaker in main load center.
  //                                   120% rule: (busRating × 1.2) − mainAmps.
  //                                   FIX v57.3: Was incorrectly skipping breaker
  //                                   for LOAD_SIDE. NEC 705.12(B) REQUIRES it.
  //   BACKFED_BREAKER              → alias for LOAD_SIDE (same NEC code path).
  //   SUPPLY_SIDE_TAP (NEC 705.11) → line-side tap before main breaker.
  //                                   No backfed breaker in load center.
  //   MAIN_BREAKER_DERATE          → main breaker derated per 705.12(B)(3).
  //                                   No separate backfed breaker BOM item.
  //   PANEL_UPGRADE                → new panel with headroom.
  //                                   No dedicated backfed breaker.
  // ─────────────────────────────────────────────────────────────────────────
  // interconMethod and isSupplySideTap already declared above (before AC Disconnect block)
  // LOAD_SIDE and BACKFED_BREAKER both require a backfed breaker per NEC 705.12(B)
  const isLoadSide = interconMethod === 'LOAD_SIDE' ||
    interconMethod === 'BACKFED_BREAKER' ||
    (interconMethod.includes('BACKFED') && !interconMethod.includes('SUPPLY')) ||
    (interconMethod.includes('LOAD') && !interconMethod.includes('SUPPLY'));
  // Main breaker derate or panel upgrade — no separate backfed breaker
  const isMainBreakerDerate = interconMethod === 'MAIN_BREAKER_DERATE';
  const isPanelUpgrade = interconMethod === 'PANEL_UPGRADE';

  if (isLoadSide) {
    // NEC 705.12(B) — backfed breaker required in main load center. Enforce 120% rule.
    const busRating    = input.panelBusRating ?? input.mainPanelAmps ?? 200;
    const mainAmps     = input.mainPanelAmps ?? 200;
    const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
    // If backfeedAmps not provided (0 or missing), derive from system kW:
    // NEC 705.12(B): continuous AC output current × 1.25 → next standard breaker
    const derivedBackfeedAmps = (input.backfeedAmps ?? 0) > 0
      ? input.backfeedAmps
      : ((input.acOutputKw ?? input.systemKw) * 1000 / (input.acVoltage ?? 240)) * 1.25;
    const requestedBreaker = nextStandardBreaker(derivedBackfeedAmps);
    const backfeedAmps = Math.min(requestedBreaker, maxPVBreaker);
    if (requestedBreaker > maxPVBreaker) {
      warnings.push(
        `NEC 705.12(B) VIOLATION: Requested ${requestedBreaker}A backfeed exceeds 120% max (${maxPVBreaker}A) ` +
        `for ${busRating}A bus / ${mainAmps}A main. ` +
        `BOM capped to ${backfeedAmps}A — use SUPPLY_SIDE_TAP (NEC 705.11) to use full ${requestedBreaker}A.`
      );
    }
    items.push(addItem('ac', 'breaker', 'Square D', `${backfeedAmps}A Backfeed Breaker`,
      `QO${backfeedAmps}`,
      `${backfeedAmps}A 2-pole backfeed breaker — NEC 705.12(B) load-side (bus: ${busRating}A, max: ${maxPVBreaker}A)`,
      1, 'ea', 'NEC 705.12(B)', 'perSystem', '1', true));
    log.push({ stageId: 'ac', category: 'breaker', item: `${backfeedAmps}A Backfeed Breaker`,
      quantity: 1, derivedFrom: 'backfeedAmps',
      formula: 'min(nextStandardBreaker(backfeedAmps), floor(busRating×1.2−mainPanelAmps))',
      necReference: 'NEC 705.12(B)' });
    complianceNotes.push(
      `NEC 705.12(B): Backfeed breaker ${backfeedAmps}A — 120% rule: (${busRating}A × 1.2) − ${mainAmps}A = ${maxPVBreaker}A max`
    );
  } else if (isSupplySideTap) {
    // NEC 705.11 — supply-side tap, no backfed breaker in load center
    complianceNotes.push(
      `NEC 705.11: Supply-side tap — no backfed breaker in load center. ` +
      `Connection is utility-side (before main breaker). OCPD is at utility service.`
    );
  } else if (isMainBreakerDerate) {
    // NEC 705.12(B)(3) — main breaker derated, no separate backfed breaker
    complianceNotes.push(
      `NEC 705.12(B)(3): Main breaker derate — main OCPD derated to allow PV backfeed. ` +
      `No dedicated backfed breaker in BOM.`
    );
  } else if (isPanelUpgrade) {
    // Panel upgrade — new panel has headroom, no dedicated backfed breaker needed
    complianceNotes.push(
      `NEC 705.12(B): Panel upgrade — new load center with sufficient headroom. ` +
      `No dedicated backfed breaker required.`
    );
  }

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

  // ── Grounding Electrode System (NEC 250.52 / 690.43 / 250.66) ───────────────
  // EGC: Equipment Grounding Conductor — runs inside conduit alongside AC conductors
  {
    const egcLength = conduitLength(input.acWireLength);
    // EGC gauge: NEC 250.122 — based on OCPD size
    const ocpdForEgc = input.acOCPD > 0 ? input.acOCPD : nextStandardBreaker(
      ((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25
    );
    const egcGauge = ocpdForEgc <= 60 ? '#10 AWG' : ocpdForEgc <= 100 ? '#8 AWG' : '#6 AWG';
    items.push(addItem('structural', 'wire', 'Southwire', `${egcGauge} THWN-2 Green EGC`,
      `THWN2-GRN-${egcGauge.replace('#', '').replace(' AWG', '')}`,
      `${egcGauge} green THWN-2 equipment grounding conductor — NEC 250.122`,
      egcLength, 'ft', 'NEC 690.43 / 250.122', 'acWireLength × 1.15', `${input.acWireLength} × 1.15`, true));
    log.push({ stageId: 'structural', category: 'wire', item: `${egcGauge} EGC`,
      quantity: egcLength, derivedFrom: 'acWireLength × 1.15',
      formula: 'acWireLength * 1.15', necReference: 'NEC 690.43 / 250.122' });
  }

  // Ground Rod & GEC — NEC 250.52(A)(5) / 250.66
  // Required for grounding electrode system unless existing ground rod on site
  {
    // Ground rod: 8-ft copper-clad per NEC 250.52(A)(5)
    items.push(addItem('structural', 'grounding', 'Erico/Harger', '5/8" × 8 ft Copper-Clad Ground Rod',
      'GR-5/8-8',
      '5/8" × 8 ft copper-clad steel ground rod — NEC 250.52(A)(5)',
      1, 'ea', 'NEC 250.52(A)(5)', 'perSystem', '1', true));

    // Ground rod clamp
    items.push(addItem('structural', 'grounding', 'Erico/Harger', '5/8" Ground Rod Acorn Clamp',
      'GRC-5/8',
      '5/8" ground rod acorn clamp — bonds GEC to ground rod per NEC 250.70',
      1, 'ea', 'NEC 250.70', 'perSystem', '1', true));

    // GEC: Grounding Electrode Conductor — NEC 250.66
    // Sized by largest service conductor or 6 AWG minimum for PV systems ≤ 200A
    const gecOcpd = input.acOCPD > 0 ? input.acOCPD
      : nextStandardBreaker(((input.acOutputKw ?? input.systemKw) * 1000) / (input.acVoltage ?? 240) * 1.25);
    const gecGauge = gecOcpd <= 60 ? '#6 AWG' : gecOcpd <= 100 ? '#4 AWG' : '#2 AWG';
    const gecLength = 50; // standard 50-ft run from inverter to grounding electrode
    items.push(addItem('structural', 'wire', 'Southwire', `${gecGauge} Bare Copper GEC`,
      `BARE-CU-${gecGauge.replace('#', '').replace(' AWG', '')}`,
      `${gecGauge} bare copper grounding electrode conductor — NEC 250.66`,
      gecLength, 'ft', 'NEC 250.66', 'perSystem', '50', true));

    log.push({ stageId: 'structural', category: 'grounding', item: 'Grounding Electrode System',
      quantity: 3, derivedFrom: 'perSystem',
      formula: '1 ground rod + 1 clamp + 50ft GEC',
      necReference: 'NEC 250.52 / 250.66 / 250.70' });
    complianceNotes.push(
      `NEC 250.52(A)(5): 5/8"×8ft copper-clad ground rod + acorn clamp + ${gecGauge} GEC (50ft) required`
    );
  }

  // STAGE 5b REMOVED (MASTER TASK): Structural items now handled by merge layer.
  // V4 engine owns ONLY electrical. Structural (fence/ground) is derived by
  // v47.432: bom-system-profiles.ts now generates these items directly; bom-merge.ts
  // was deleted in Stage 8.1 (only bom-engine-v4 remains as the canonical BOM engine).
  // See: app/api/engineering/bom/route.ts

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

  // SolarEdge RS485 communication cables — 1 per inverter to SEG-HUB-1 gateway
  // Required for all SolarEdge optimizer-based systems (STRING_WITH_OPTIMIZER topology)
  if (inverterEntry && inverterEntry.manufacturer === 'SolarEdge' &&
      (norm === 'STRING_WITH_OPTIMIZER' || norm === 'HYBRID_INVERTER' || norm === 'DC_COUPLED_BATTERY')) {
    const rs485Qty = Math.max(1, input.inverterCount ?? 1);
    items.push(addItem('monitoring', 'communication_cable', 'SolarEdge', 'RS485 Communication Cable',
      'SE-RS485-10FT',
      `RS485 communication cable — inverter to SEG-HUB-1 gateway (${rs485Qty} inverter${rs485Qty > 1 ? 's' : ''})`,
      rs485Qty, 'ea', 'NEC 690.4', 'inverterCount', 'inverters', true));
    log.push({ stageId: 'monitoring', category: 'communication_cable', item: 'RS485 Communication Cable',
      quantity: rs485Qty, derivedFrom: 'inverterCount', formula: 'inverters',
      necReference: 'NEC 690.4' });
    complianceNotes.push(
      `SolarEdge RS485: ${rs485Qty} communication cable(s) required — inverter(s) to SEG-HUB-1 gateway`
    );
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

    // Point-of-interconnection label — method-specific. A supply-side tap job
    // has no backfeed breaker; ordering a "backfeed breaker label" for it
    // contradicted E-1/PV-4A ("Backfed Breaker: N/A — Tap Connection").
    if (String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase() === 'SUPPLY_SIDE_TAP') {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Supply-Side Tap POI Label',
        'LABEL-SST', 'Point-of-interconnection label per NEC 705.10 (supply-side tap, NEC 705.11)',
        1, 'ea', 'NEC 705.10', 'perSystem', '1', true));
    } else {
      items.push(addItem('labels', 'label', 'HellermannTyton', 'Backfeed Breaker Label',
        'LABEL-BF', 'Backfeed breaker label per NEC 705.12',
        1, 'ea', 'NEC 705.12', 'perSystem', '1', true));
    }

    // Disconnecting means label — NEC 690.13 labels the DISCONNECTING MEANS
    // (AC disco + point of interconnection), not every inverter: the old
    // inverterCount+1 derivation printed "qty 53" for a 52-micro job.
    const discLabelQty = (input.requiresACDisconnect !== false ? 1 : 0)
      + (input.requiresDCDisconnect ? 1 : 0) + 1;   // +1 = point of interconnection
    items.push(addItem('labels', 'label', 'HellermannTyton', 'Disconnecting Means Label',
      'LABEL-DISC', 'Disconnecting means label per NEC 690.13',
      discLabelQty, 'ea', 'NEC 690.13', 'disconnecting means (AC/DC disco + POI)', 'AC disco + DC disco + POI', true));

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
  notes?: string,
  unitCost?: number,
  totalCost?: number
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
    unitCost,
    totalCost,
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