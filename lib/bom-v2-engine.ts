// ============================================================
// BOM Engine V4 — Registry-Driven, Brand-Agnostic
// Derives entirely from: equipment registry + topology + system state
// NO hardcoded Enphase/SolarEdge/brand conditionals
// Adding a new manufacturer = add registry entry only
// ============================================================

import { SystemState, BOMLineItem, BOMCategory } from './system-state';
import { SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, RACKING_SYSTEMS, OPTIMIZERS } from './equipment-db';
import { getRegistryEntry, evaluateQuantityFormula } from './equipment-registry';
import { detectTopology, normalizeTopology, TopologyContext } from './topology-engine';
import { resolveAccessories, ResolutionContext, calcAttachmentCount, sizeACDisconnect } from './accessory-resolver';
import { EngineeringModel } from './electrical-calc';

// ─── BOM Stage Types ──────────────────────────────────────────────────────────

export type BOMStage =
  | 'stage1_array'
  | 'stage2_dc_wiring'
  | 'stage3_inverter'
  | 'stage4_ac_wiring'
  | 'stage5_interconnection'
  | 'stage6_structural'
  | 'stage7_monitoring';

export interface BOMLineItemV2 {
  id: string;
  stage: BOMStage;
  stageLabel: string;
  category: BOMCategory;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: string;
  derivedFrom: string;
  formula: string;
  necReference?: string;
  unitCost?: number;
  totalCost?: number;
}

export interface BOMResultV2 {
  items: BOMLineItemV2[];
  byStage: Record<BOMStage, BOMLineItemV2[]>;
  totalItems: number;
  generatedAt: string;
  systemSummary: {
    totalPanels: number;
    totalDcKw: number;
    totalAcKw: number;
    topologyType: string;
    topologyLabel: string;
    inverterManufacturer: string;
    inverterModel: string;
    mountManufacturer: string;
    mountModel: string;
  };
}

// ─── Stage Labels ─────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<BOMStage, string> = {
  stage1_array:           'Stage 1 — Array',
  stage2_dc_wiring:       'Stage 2 — DC Wiring',
  stage3_inverter:        'Stage 3 — Inverter & Ecosystem',
  stage4_ac_wiring:       'Stage 4 — AC Wiring',
  stage5_interconnection: 'Stage 5 — Interconnection',
  stage6_structural:      'Stage 6 — Structural Hardware',
  stage7_monitoring:      'Stage 7 — Monitoring & Labels',
};

// ─── ID Counter ───────────────────────────────────────────────────────────────

let idCounter = 1;
function nextId(): string { return `bom-${(idCounter++).toString().padStart(4, '0')}`; }

function item(
  stage: BOMStage,
  category: BOMCategory,
  manufacturer: string,
  model: string,
  quantity: number,
  unit: string,
  derivedFrom: string,
  formula: string,
  opts: Partial<BOMLineItemV2> = {},
): BOMLineItemV2 {
  return {
    id: nextId(),
    stage,
    stageLabel: STAGE_LABELS[stage],
    category,
    manufacturer,
    model,
    partNumber: opts.partNumber ?? '',
    description: opts.description ?? `${manufacturer} ${model}`,
    quantity,
    unit,
    derivedFrom,
    formula,
    ...opts,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nextStandardBreaker(amps: number): number {
  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];
  return sizes.find(s => s >= amps) ?? Math.ceil(amps / 10) * 10;
}

function calcRailFt(panelCount: number, panelWidthIn = 41.7): number {
  const panelsPerRow = Math.ceil(panelCount / 2);
  const railIn = panelsPerRow * panelWidthIn + 12;
  return Math.ceil((railIn / 12) * 2);
}

function calcConduitFt(wireLength: number): number {
  return Math.ceil(wireLength * 1.15);
}

// ─── Main BOM Generator ───────────────────────────────────────────────────────

export function generateBOMV2(state: SystemState, engineeringModel?: EngineeringModel): BOMResultV2 {
  idCounter = 1;
  const items: BOMLineItemV2[] = [];

  // ── System Quantities ──────────────────────────────────────────────────────
  const totalPanels = state.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.panelCount, 0), 0);
  const totalStrings = state.inverters.reduce((sum, inv) => sum + inv.strings.length, 0);
  const totalInverters = state.inverters.length;

  // ── Equipment Specs ────────────────────────────────────────────────────────
  const firstPanelId = state.inverters[0]?.strings[0]?.panelId ?? 'qcells-peak-duo-400';
  const firstInvId = state.inverters[0]?.inverterId ?? 'se-7600h';

  const panelSpec = SOLAR_PANELS.find(p => p.id === firstPanelId) ?? SOLAR_PANELS[0];
  const racking = RACKING_SYSTEMS.find(r => r.id === state.mountingId) ?? RACKING_SYSTEMS[0];

  // ── Topology Detection (registry-driven, no brand checks) ─────────────────
  const topoCtx: TopologyContext = {
    inverterId: firstInvId,
    rackingId: state.mountingId,
    moduleCount: totalPanels,
    stringCount: totalStrings,
    inverterCount: totalInverters,
  };
  const topoResult = detectTopology(topoCtx);
  const topology = normalizeTopology(topoResult.topology);
  const mountTopology = topoResult.mountTopology ? normalizeTopology(topoResult.mountTopology) : null;

  const isMicro = topology === 'MICROINVERTER' || topology === 'AC_COUPLED_BATTERY';
  const isOptimizer = topology === 'STRING_WITH_OPTIMIZER' || topology === 'HYBRID_INVERTER' || topology === 'DC_COUPLED_BATTERY';
  const isGroundMount = mountTopology === 'GROUND_MOUNT_FIXED_TILT' || mountTopology === 'GROUND_MOUNT_DRIVEN_PILE';
  const isDrivenPile = mountTopology === 'GROUND_MOUNT_DRIVEN_PILE' ||
    racking?.systemType === 'ground';
  const isRailLess = mountTopology === 'ROOF_RAIL_LESS';

  // ── Inverter Spec ──────────────────────────────────────────────────────────
  const invSpec = isMicro
    ? (MICROINVERTERS.find(i => i.id === firstInvId) as any ?? MICROINVERTERS[0])
    : (STRING_INVERTERS.find(i => i.id === firstInvId) as any ?? STRING_INVERTERS[0]);

  const invEntry = getRegistryEntry(firstInvId);
  const invManufacturer = invEntry?.manufacturer ?? invSpec?.manufacturer ?? 'Unknown';
  const invModel = invEntry?.model ?? invSpec?.model ?? 'Unknown';

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalDcKw = (totalPanels * (panelSpec?.watts ?? 400)) / 1000;
  const totalAcKw = state.inverters.reduce((sum, inv) => {
    const spec = isMicro
      ? MICROINVERTERS.find(i => i.id === inv.inverterId)
      : STRING_INVERTERS.find(i => i.id === inv.inverterId);
    const kw = (spec as any)?.acOutputKw ?? ((spec as any)?.acOutputW ? (spec as any).acOutputW / 1000 : 7.6);
    return sum + kw;
  }, 0);

  const wireLength = state.inverters[0]?.strings[0]?.wireLength ?? 50;
  const acWireGauge = state.conductorSizing?.acWireGauge ?? '#8 AWG';
  const conduitType = state.conductorSizing?.conduitType ?? 'EMT';
  const roofType = state.structuralData?.roofType ?? 'shingle';
  const attachmentSpacing = state.structuralData?.attachmentSpacing ?? 48;

  // ── Resolve accessories from registry ─────────────────────────────────────
  const resCtx: ResolutionContext = {
    inverterId: firstInvId,
    rackingId: state.mountingId,
    moduleCount: totalPanels,
    stringCount: totalStrings,
    inverterCount: totalInverters,
    branchCount: totalStrings,
    systemKw: totalDcKw,
    roofType,
    mountType: isGroundMount ? 'ground' : 'roof',
    attachmentCount: calcAttachmentCount(totalPanels, attachmentSpacing),
  };
  const resolution = resolveAccessories(resCtx);

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 1 — ARRAY
  // ══════════════════════════════════════════════════════════════════════════

  // Panels
  items.push(item('stage1_array', 'panels',
    panelSpec?.manufacturer ?? 'Q CELLS',
    `${panelSpec?.model ?? 'Q.PEAK DUO 400W'} (${panelSpec?.watts ?? 400}W)`,
    totalPanels, 'ea', 'totalPanels', `${totalPanels} panels`,
    { necReference: 'NEC 690.4', partNumber: panelSpec?.id ?? '' }));

  // Optimizers (from registry resolution — any brand)
  const optimizerAcc = resolution.accessories.find(a => a.category === 'optimizer');
  if (optimizerAcc) {
    items.push(item('stage1_array', 'optimizers',
      optimizerAcc.manufacturer, optimizerAcc.model,
      optimizerAcc.quantity, 'ea',
      optimizerAcc.derivedFrom, optimizerAcc.quantityFormula,
      { necReference: 'NEC 690.8', partNumber: optimizerAcc.partNumber }));
  }

  // Microinverters (from registry — any brand)
  if (isMicro) {
    items.push(item('stage1_array', 'inverters',
      invManufacturer, invModel,
      totalPanels, 'ea',
      `${invManufacturer} microinverter topology`, `${totalPanels} modules × 1`,
      { necReference: 'NEC 690.6', partNumber: invEntry?.id ?? '' }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 2 — DC WIRING
  // ══════════════════════════════════════════════════════════════════════════

  if (!isMicro) {
    // DC wire
    const dcWireLength = wireLength * totalStrings * 2 + 20;
    items.push(item('stage2_dc_wiring', 'wire', 'Generic',
      '#10 AWG USE-2/PV Wire',
      dcWireLength, 'lf',
      'wireLength × strings × 2 + slack',
      `${wireLength}ft × ${totalStrings} strings × 2 + 20ft slack`,
      { necReference: 'NEC 690.31' }));

    // MC4 connectors
    items.push(item('stage2_dc_wiring', 'misc', 'Staubli',
      'MC4 Connector Pair',
      totalStrings * 2, 'ea',
      '2 pairs per string', `${totalStrings} strings × 2`,
      { necReference: 'NEC 690.33' }));

    // DC OCPD fuses (combiner required if >1 string per inverter)
    const stringsPerInv = Math.max(...state.inverters.map(inv => inv.strings.length));
    if (stringsPerInv > 1) {
      items.push(item('stage2_dc_wiring', 'misc', 'Midnite Solar',
        '15A DC Fuse (Class T)',
        totalStrings, 'ea',
        '1 per string (combiner required)', `${totalStrings} strings`,
        { necReference: 'NEC 690.9' }));
    }

    // DC Disconnect (from registry resolution)
    const dcDiscAcc = resolution.accessories.find(a => a.category === 'dc_disconnect');
    if (dcDiscAcc && state.dcDisconnect !== false) {
      items.push(item('stage2_dc_wiring', 'disconnects',
        dcDiscAcc.manufacturer, dcDiscAcc.model,
        dcDiscAcc.quantity, 'ea',
        dcDiscAcc.derivedFrom, dcDiscAcc.quantityFormula,
        { necReference: dcDiscAcc.necReference ?? 'NEC 690.15', partNumber: dcDiscAcc.partNumber }));
    }

    // Rapid Shutdown (from registry — only if not integrated)
    const rsdAcc = resolution.accessories.find(a => a.category === 'rapid_shutdown');
    if (rsdAcc && !isOptimizer) {
      items.push(item('stage2_dc_wiring', 'misc',
        rsdAcc.manufacturer, rsdAcc.model,
        rsdAcc.quantity, 'ea',
        rsdAcc.derivedFrom, rsdAcc.quantityFormula,
        { necReference: rsdAcc.necReference ?? 'NEC 690.12', partNumber: rsdAcc.partNumber }));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 3 — INVERTER & ECOSYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  // String inverter (not micro)
  if (!isMicro) {
    items.push(item('stage3_inverter', 'inverters',
      invManufacturer, invModel,
      totalInverters, 'ea',
      '1 per inverter config', `${totalInverters} inverters`,
      { necReference: 'NEC 690.4', partNumber: invEntry?.id ?? '' }));
  }

  // Ecosystem accessories from registry (gateway, combiner, trunk cable, terminators, etc.)
  // These are resolved brand-agnostically — works for ANY manufacturer
  const ecosystemCategories = ['gateway', 'combiner', 'trunk_cable', 'terminator', 'monitoring'];
  for (const cat of ecosystemCategories) {
    const acc = resolution.accessories.find(a => a.category === cat);
    if (acc) {
      items.push(item('stage3_inverter', 'misc',
        acc.manufacturer, acc.model,
        acc.quantity, 'ea',
        acc.derivedFrom, acc.quantityFormula,
        { necReference: acc.necReference ?? 'NEC 690.4', partNumber: acc.partNumber,
          description: acc.description }));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 4 — AC WIRING
  // ══════════════════════════════════════════════════════════════════════════

  const acWireRun = wireLength + 20;
  items.push(item('stage4_ac_wiring', 'wire', 'Generic',
    `${acWireGauge} THWN-2`,
    acWireRun * 2, 'lf',
    'wireLength × 2 conductors + slack',
    `${wireLength}ft + 20ft slack × 2`,
    { necReference: 'NEC 310.15' }));

  items.push(item('stage4_ac_wiring', 'wire', 'Generic',
    `${acWireGauge.replace('#', '#').replace(' AWG', '')} AWG Green THWN-2 (EGC)`,
    acWireRun, 'lf',
    '1 EGC per run', `${acWireRun}ft`,
    { necReference: 'NEC 250.122' }));

  const conduitLength = calcConduitFt(wireLength + 20);
  const conduitSize = '3/4"';
  items.push(item('stage4_ac_wiring', 'conduit', 'Generic',
    `${conduitSize} ${conduitType}`,
    conduitLength, 'lf',
    'wireLength × 1.15 fitting allowance',
    `${wireLength + 20}ft × 1.15`,
    { necReference: 'NEC 358' }));

  items.push(item('stage4_ac_wiring', 'conduit', 'Generic',
    `${conduitSize} ${conduitType} Connector`,
    Math.ceil(conduitLength / 10), 'ea',
    '1 per 10ft conduit', `ceil(${conduitLength}/10)`,
    { necReference: 'NEC 358' }));

  // AC Disconnect (from registry resolution — sized correctly for any topology)
  // If engineeringModel is provided, use it as single source of truth (Issue 1 & 2 fix)
  const acDiscAcc = resolution.accessories.find(a => a.category === 'ac_disconnect');
  if (acDiscAcc && state.acDisconnect !== false) {
    if (engineeringModel) {
      // Use canonical engineeringModel — single source of truth
      const discType = engineeringModel.disconnectType;
      const discAmps = engineeringModel.disconnectRating;
      const discLabel = discType === 'fused' ? 'Fusible' : 'Non-Fusible';
      items.push(item('stage4_ac_wiring', 'disconnects',
        acDiscAcc.manufacturer, `${discAmps}A ${discLabel} AC Disconnect Switch`,
        1, 'ea',
        'engineeringModel.disconnectRating',
        `${discAmps}A ${discLabel} — NEC 690.14`,
        { necReference: 'NEC 690.14', partNumber: `DU${discAmps}${discType === 'fused' ? 'FB' : 'RB'}` }));
      // Add fuses only if fused disconnect (NEC 690.9)
      if (discType === 'fused' && engineeringModel.fuseSize !== null && engineeringModel.fuseCount > 0) {
        items.push(item('stage4_ac_wiring', 'disconnects',
          'Littelfuse', `${engineeringModel.fuseSize}A, 250V, Class R Fuse`,
          engineeringModel.fuseCount, 'ea',
          'engineeringModel.fuseSize × fuseCount',
          `${engineeringModel.fuseSize}A = 2/3 × ${discAmps}A disconnect (NEC 690.9)`,
          { necReference: 'NEC 690.9', partNumber: `LLNRK${engineeringModel.fuseSize}SP` }));
      }
    } else {
      // Fallback: size AC disconnect based on actual AC output (no engineeringModel available)
      const totalAcAmps = totalAcKw * 1000 / 240;
      const acDiscAmps = sizeACDisconnect(totalAcAmps);
      items.push(item('stage4_ac_wiring', 'disconnects',
        acDiscAcc.manufacturer, `${acDiscAmps}A Non-Fusible AC Disconnect Switch`,
        1, 'ea',
        acDiscAcc.derivedFrom,
        `${acDiscAmps}A = ceil(${totalAcAmps.toFixed(1)}A × 125%)`,
        { necReference: 'NEC 690.14', partNumber: `DU${acDiscAmps}RB` }));
    }
  }

  // Production meter
  if (state.productionMeter) {
    items.push(item('stage4_ac_wiring', 'monitoring', 'Emporia',
      'Energy Vue 3 Production Meter',
      1, 'ea', '1 per system', 'system requirement',
      { necReference: 'NEC 690.54' }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 5 — INTERCONNECTION
  // ══════════════════════════════════════════════════════════════════════════

  const backfeedAmps = nextStandardBreaker(totalAcKw * 1000 / 240 * 1.25);
  items.push(item('stage5_interconnection', 'disconnects',
    state.mainPanelBrand ?? 'Square D',
    `${backfeedAmps}A 2-Pole Breaker (Backfeed)`,
    1, 'ea', '1 per system',
    `${backfeedAmps}A = NEC 705.12 backfeed`,
    { necReference: 'NEC 705.12' }));

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 6 — STRUCTURAL HARDWARE
  // ══════════════════════════════════════════════════════════════════════════

  if (isDrivenPile) {
    // Ground mount driven pile
    const pileAcc = resolution.accessories.find(a => a.category === 'driven_pile');
    if (pileAcc) {
      items.push(item('stage6_structural', 'racking_hardware',
        pileAcc.manufacturer, pileAcc.model,
        pileAcc.quantity, 'ea',
        pileAcc.derivedFrom, pileAcc.quantityFormula,
        { necReference: 'ASCE 7-22', partNumber: pileAcc.partNumber }));
    }

    // Ground mount rail
    const railFt = calcRailFt(totalPanels);
    const railSectionFt = 14;
    const railSections = Math.ceil(railFt / railSectionFt);
    items.push(item('stage6_structural', 'racking_rail',
      racking?.manufacturer ?? 'IronRidge',
      `${racking?.model ?? 'GFT'} Rail — ${railSectionFt * 12}" Section`,
      railSections, 'ea',
      `ceil(${railFt}ft / ${railSectionFt}ft)`,
      `${totalPanels} panels → ${railFt}ft rail → ${railSections} sections`,
      { necReference: 'IBC 2021' }));

  } else if (isRailLess) {
    // Rail-less roof mount
    const attachAcc = resolution.accessories.find(a => a.category === 'attachment');
    if (attachAcc) {
      items.push(item('stage6_structural', 'racking_hardware',
        attachAcc.manufacturer, attachAcc.model,
        attachAcc.quantity, 'ea',
        attachAcc.derivedFrom, attachAcc.quantityFormula,
        { necReference: 'ASCE 7-22', partNumber: attachAcc.partNumber }));
    }

    const flashAcc = resolution.accessories.find(a => a.category === 'flashing');
    if (flashAcc) {
      items.push(item('stage6_structural', 'flashing',
        flashAcc.manufacturer, flashAcc.model,
        flashAcc.quantity, 'ea',
        flashAcc.derivedFrom, flashAcc.quantityFormula,
        { necReference: 'IBC 2021', partNumber: flashAcc.partNumber }));
    }

  } else {
    // Rail-based roof mount (default)
    const railFt = calcRailFt(totalPanels);
    const railSectionFt = 14;
    const railSections = Math.ceil(railFt / railSectionFt);

    items.push(item('stage6_structural', 'racking_rail',
      racking?.manufacturer ?? 'IronRidge',
      `${racking?.model ?? 'XR100'} Rail System — ${railSectionFt * 12}" (${railSectionFt}ft) Section`,
      railSections, 'ea',
      `ceil(${railFt}ft / ${railSectionFt}ft)`,
      `${totalPanels} panels → ${railFt}ft rail → ${railSections} sections`,
      { necReference: 'IBC 2021' }));

    // L-feet / attachments (from registry or calculated)
    const attachAcc = resolution.accessories.find(a => a.category === 'attachment');
    const attachCount = attachAcc?.quantity ?? calcAttachmentCount(totalPanels, attachmentSpacing);

    items.push(item('stage6_structural', 'racking_hardware',
      racking?.manufacturer ?? 'IronRidge',
      'L-Foot with Lag Bolt',
      attachCount, 'ea',
      `ceil(railLength / ${attachmentSpacing}") + 2 ends`,
      `ceil(${railFt * 12}" / ${attachmentSpacing}") + 2`,
      { necReference: 'ASCE 7-22' }));

    // Rail splices
    items.push(item('stage6_structural', 'racking_hardware',
      racking?.manufacturer ?? 'IronRidge',
      'Rail Splice',
      Math.max(0, railSections - 2), 'ea',
      'railSections - 2', `${railSections} sections - 2`,
      { necReference: 'IBC 2021' }));

    // End clamps
    const endClampAcc = resolution.accessories.find(a => a.category === 'end_clamp');
    items.push(item('stage6_structural', 'racking_hardware',
      racking?.manufacturer ?? 'IronRidge',
      'End Clamp',
      endClampAcc?.quantity ?? totalStrings * 4, 'ea',
      '4 per string (2 rails × 2 ends)', `${totalStrings} strings × 4`,
      { necReference: 'IBC 2021' }));

    // Mid clamps
    const midClampAcc = resolution.accessories.find(a => a.category === 'mid_clamp');
    items.push(item('stage6_structural', 'racking_hardware',
      racking?.manufacturer ?? 'IronRidge',
      'Mid Clamp',
      midClampAcc?.quantity ?? Math.max(0, totalPanels - totalStrings) * 2, 'ea',
      '(panels - strings) × 2', `(${totalPanels} - ${totalStrings}) × 2`,
      { necReference: 'IBC 2021' }));

    // Lag bolts
    items.push(item('stage6_structural', 'racking_hardware', 'Generic',
      '5/16" × 3" Lag Bolt with EPDM Washer',
      attachCount, 'ea',
      '1 per L-foot', `${attachCount} attachments`,
      { necReference: 'ASCE 7-22' }));

    // Flashing (shingle/tile only)
    if (roofType === 'shingle' || roofType === 'tile') {
      const flashAcc = resolution.accessories.find(a => a.category === 'flashing');
      items.push(item('stage6_structural', 'flashing',
        flashAcc?.manufacturer ?? 'QuickMount PV',
        roofType === 'tile' ? 'Tile Replacement Mount' : 'Classic Mount Flashing',
        flashAcc?.quantity ?? attachCount, 'ea',
        '1 per attachment', `${attachCount} attachments`,
        { necReference: 'IBC 2021' }));
    }
  }

  // Grounding (all topologies)
  items.push(item('stage6_structural', 'grounding', 'Erico',
    '5/8" × 8ft Copper-Clad Ground Rod',
    2, 'ea', '2 per system (NEC 250.52)', 'system requirement',
    { necReference: 'NEC 250.52' }));

  items.push(item('stage6_structural', 'grounding', 'Burndy',
    'Ground Rod Clamp',
    2, 'ea', '1 per ground rod', '2 rods',
    { necReference: 'NEC 250.52' }));

  items.push(item('stage6_structural', 'grounding', 'Ilsco',
    'Lay-In Lug (EGC)',
    totalInverters * 2, 'ea', '2 per inverter', `${totalInverters} inverters × 2`,
    { necReference: 'NEC 250.122' }));

  const railFt = calcRailFt(totalPanels);
  const bondingWireLength = Math.ceil(railFt * 1.2);
  items.push(item('stage6_structural', 'grounding', 'Generic',
    '#6 AWG Bare Copper (Bonding)',
    bondingWireLength, 'lf', 'railLength × 1.2', `${railFt}ft × 1.2`,
    { necReference: 'NEC 690.47' }));

  // Wire management
  items.push(item('stage6_structural', 'misc',
    racking?.manufacturer ?? 'IronRidge',
    'Wire Management Clip',
    totalPanels * 2, 'ea', '2 per panel', `${totalPanels} × 2`,
    { necReference: 'NEC 690.31' }));

  // ══════════════════════════════════════════════════════════════════════════
  // STAGE 7 — MONITORING & LABELS
  // ══════════════════════════════════════════════════════════════════════════

  items.push(item('stage7_monitoring', 'labels', 'Brady',
    'NEC 690 Solar PV Label Set',
    1, 'set', '1 per system', 'system requirement',
    { necReference: 'NEC 690.31(G)' }));

  items.push(item('stage7_monitoring', 'labels', 'Brady',
    'AC Disconnect Label',
    1, 'ea', '1 per system', 'system requirement',
    { necReference: 'NEC 690.14' }));

  items.push(item('stage7_monitoring', 'labels', 'Brady',
    'Rapid Shutdown Label',
    1, 'ea', '1 per system', 'system requirement',
    { necReference: 'NEC 690.12' }));

  // ── Group by stage ─────────────────────────────────────────────────────────
  const byStage: Record<BOMStage, BOMLineItemV2[]> = {
    stage1_array: [],
    stage2_dc_wiring: [],
    stage3_inverter: [],
    stage4_ac_wiring: [],
    stage5_interconnection: [],
    stage6_structural: [],
    stage7_monitoring: [],
  };
  items.forEach(i => { byStage[i.stage].push(i); });

  return {
    items,
    byStage,
    totalItems: items.length,
    generatedAt: new Date().toISOString(),
    systemSummary: {
      totalPanels,
      totalDcKw,
      totalAcKw,
      topologyType: topology,
      topologyLabel: topoResult.reason,
      inverterManufacturer: invManufacturer,
      inverterModel: invModel,
      mountManufacturer: racking?.manufacturer ?? 'IronRidge',
      mountModel: racking?.model ?? 'XR100',
    },
  };
}