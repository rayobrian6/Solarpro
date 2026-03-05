// ============================================================
// Bill of Materials Auto-Sourcing Engine
// Derives BOM from: roof type + racking + inverter ecosystem
//                   + jurisdiction + conduit type + wire length
// No static templates. All items derived from SystemState.
// ============================================================

import { SystemState, BOMLineItem, BOMCategory, TopologyType } from './system-state';
import { SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, RACKING_SYSTEMS } from './equipment-db';

export interface BOMGenerationResult {
  items: BOMLineItem[];
  totalLineItems: number;
  categories: BOMCategory[];
  generatedAt: string;
  derivationLog: BOMDerivationEntry[];
  warnings: string[];
}

export interface BOMDerivationEntry {
  category: BOMCategory;
  item: string;
  quantity: number;
  derivedFrom: string;
  formula: string;
}

// ─── Rail Length Calculation ──────────────────────────────────────────────────

function calcRailLengthFt(panelCount: number, panelWidthIn: number, rowsPerRail: number = 1): number {
  // 2 rails per row, panels side by side
  const panelsPerRow = Math.ceil(panelCount / 2);
  const railLengthIn = panelsPerRow * panelWidthIn + 12; // 6" overhang each end
  return Math.ceil((railLengthIn / 12) * rowsPerRail * 2); // 2 rails
}

// ─── Conduit Length Calculation ───────────────────────────────────────────────

function calcConduitLengthFt(wireLength: number, fittingAllowance: number = 1.15): number {
  return Math.ceil(wireLength * fittingAllowance);
}

// ─── Standard OCPD sizes ─────────────────────────────────────────────────────

function nextStandardBreaker(amps: number): number {
  const sizes = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 125, 150, 175, 200];
  return sizes.find(s => s >= amps) ?? Math.ceil(amps / 10) * 10;
}

// ─── Main BOM Generation Function ────────────────────────────────────────────

export function generateBOM(state: SystemState): BOMGenerationResult {
  const items: BOMLineItem[] = [];
  const log: BOMDerivationEntry[] = [];
  const warnings: string[] = [];
  let idCounter = 1;

  const nextId = () => `bom-${(idCounter++).toString().padStart(4, '0')}`;

  const totalPanels = state.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.panelCount, 0), 0);

  const totalStrings = state.inverters.reduce((sum, inv) => sum + inv.strings.length, 0);
  const totalInverters = state.inverters.length;

  // Get panel spec
  const firstPanelId = state.inverters[0]?.strings[0]?.panelId ?? 'qcells-peak-duo-400';
  const panelSpec = SOLAR_PANELS.find(p => p.id === firstPanelId);
  const panelWidthIn = panelSpec?.width ?? 41.7;
  const panelLengthIn = panelSpec?.length ?? 70.9;
  const panelWatts = panelSpec?.watts ?? 400;

  // Get racking spec
  const rackingSpec = RACKING_SYSTEMS.find(r => r.id === state.mountingId);

  // Get inverter spec
  const firstInvId = state.inverters[0]?.inverterId ?? 'se-7600h';
  const invSpec = STRING_INVERTERS.find(i => i.id === firstInvId) ??
                  MICROINVERTERS.find(i => i.id === firstInvId);

  // ── 1. SOLAR PANELS ──────────────────────────────────────────────────────
  items.push({
    id: nextId(),
    category: 'panels',
    manufacturer: panelSpec?.manufacturer ?? 'Q CELLS',
    model: panelSpec?.model ?? 'Q.PEAK DUO BLK ML-G10+ 400W',
    partNumber: firstPanelId.toUpperCase(),
    description: `${panelWatts}W Solar Panel — ${panelSpec?.cellType ?? 'mono-PERC'}`,
    quantity: totalPanels,
    unit: 'ea',
    derivedFrom: `inverters[].strings[].panelCount`,
    necReference: 'NEC 690',
  });
  log.push({ category: 'panels', item: 'Solar Panels', quantity: totalPanels, derivedFrom: 'string configs', formula: 'sum(panelCount per string)' });

  // ── 2. INVERTERS ─────────────────────────────────────────────────────────
  if (state.topologyType === 'MICRO') {
    const microSpec = MICROINVERTERS.find(m => m.id === firstInvId);
    items.push({
      id: nextId(),
      category: 'inverters',
      manufacturer: microSpec?.manufacturer ?? 'Enphase',
      model: microSpec?.model ?? 'IQ8+',
      partNumber: firstInvId.toUpperCase(),
      description: `${microSpec?.acOutputW ?? 295}W Microinverter`,
      quantity: totalPanels, // 1 per panel
      unit: 'ea',
      derivedFrom: 'topologyType=MICRO: 1 per panel',
      necReference: 'NEC 690',
    });
    log.push({ category: 'inverters', item: 'Microinverters', quantity: totalPanels, derivedFrom: 'topology=MICRO', formula: '1 per panel' });
  } else {
    const strInvSpec = STRING_INVERTERS.find(i => i.id === firstInvId);
    items.push({
      id: nextId(),
      category: 'inverters',
      manufacturer: strInvSpec?.manufacturer ?? 'SolarEdge',
      model: strInvSpec?.model ?? 'SE7600H-US',
      partNumber: firstInvId.toUpperCase(),
      description: `${strInvSpec?.acOutputKw ?? 7.6}kW String Inverter`,
      quantity: totalInverters,
      unit: 'ea',
      derivedFrom: 'inverters[] count',
      necReference: 'NEC 690',
    });
    log.push({ category: 'inverters', item: 'String Inverters', quantity: totalInverters, derivedFrom: 'inverter configs', formula: 'count(inverters)' });
  }

  // ── 3. OPTIMIZERS (if STRING_OPTIMIZER topology) ──────────────────────────
  if (state.topologyType === 'STRING_OPTIMIZER' && state.optimizers.length > 0) {
    const optModelId = state.optimizers[0]?.optimizerModelId ?? 'se-p401';
    items.push({
      id: nextId(),
      category: 'optimizers',
      manufacturer: 'SolarEdge',
      model: 'P401 Power Optimizer',
      partNumber: 'P401-5R2MRM',
      description: 'Per-module DC power optimizer',
      quantity: totalPanels,
      unit: 'ea',
      derivedFrom: 'topologyType=STRING_OPTIMIZER: 1 per panel',
      necReference: 'NEC 690',
    });
    log.push({ category: 'optimizers', item: 'Power Optimizers', quantity: totalPanels, derivedFrom: 'topology=STRING_OPTIMIZER', formula: '1 per panel' });
  }

  // ── 4. RACKING RAILS ─────────────────────────────────────────────────────
  const railLengthFt = calcRailLengthFt(totalPanels, panelWidthIn);
  const railModel = rackingSpec?.model ?? 'XR100 Rail';
  const railMfr = rackingSpec?.manufacturer ?? 'IronRidge';

  items.push({
    id: nextId(),
    category: 'racking_rail',
    manufacturer: railMfr,
    model: `${railModel} — 168" (14ft) Section`,
    partNumber: 'XR100-168B',
    description: `Aluminum mounting rail — ${railLengthFt}ft total`,
    quantity: Math.ceil(railLengthFt / 14), // 14ft sections
    unit: 'ea',
    derivedFrom: `roofType:${state.structuralData.roofType}, panelCount:${totalPanels}`,
    necReference: 'UL 2703',
  });
  log.push({ category: 'racking_rail', item: 'Rail Sections', quantity: Math.ceil(railLengthFt / 14), derivedFrom: 'panel layout', formula: 'ceil(railLengthFt / 14ft per section)' });

  // ── 5. RACKING HARDWARE ───────────────────────────────────────────────────

  // L-feet / attachments (based on attachment spacing)
  const attachSpacingFt = state.structuralData.attachmentSpacing / 12;
  const lFeetCount = Math.ceil(railLengthFt / attachSpacingFt) + 4; // +4 for ends
  const roofType = state.structuralData.roofType;

  // Attachment hardware varies by roof type
  const attachmentHardware = getAttachmentHardware(roofType, railMfr);
  items.push({
    id: nextId(),
    category: 'racking_hardware',
    manufacturer: attachmentHardware.manufacturer,
    model: attachmentHardware.model,
    partNumber: attachmentHardware.partNumber,
    description: attachmentHardware.description,
    quantity: lFeetCount,
    unit: 'ea',
    derivedFrom: `roofType:${roofType}, attachmentSpacing:${state.structuralData.attachmentSpacing}"`,
    necReference: 'IBC 2021',
  });
  log.push({ category: 'racking_hardware', item: 'Attachment Hardware', quantity: lFeetCount, derivedFrom: 'roof type + attachment spacing', formula: 'ceil(railLength / attachSpacing) + 4' });

  // Rail splices (1 per rail section join)
  const railSections = Math.ceil(railLengthFt / 14);
  const spliceCount = Math.max(0, railSections - 2); // splices between sections
  if (spliceCount > 0) {
    items.push({
      id: nextId(),
      category: 'racking_hardware',
      manufacturer: railMfr,
      model: 'Rail Splice',
      partNumber: 'XR-SPLICE-100',
      description: 'Aluminum rail splice connector',
      quantity: spliceCount,
      unit: 'ea',
      derivedFrom: `railSections:${railSections}`,
    });
  }

  // End clamps (2 per row end × 2 rails × rows)
  const rows = Math.ceil(totalPanels / Math.ceil(totalPanels / 2));
  const endClampCount = rows * 4; // 2 ends × 2 rails
  items.push({
    id: nextId(),
    category: 'racking_hardware',
    manufacturer: railMfr,
    model: 'End Clamp',
    partNumber: 'EC-35-50',
    description: `End clamp for ${panelSpec?.thickness ?? 1.57}" panel frame`,
    quantity: endClampCount,
    unit: 'ea',
    derivedFrom: `rows:${rows}`,
  });

  // Mid clamps (between panels in each row)
  const midClampCount = Math.max(0, totalPanels - rows) * 2; // 2 rails
  if (midClampCount > 0) {
    items.push({
      id: nextId(),
      category: 'racking_hardware',
      manufacturer: railMfr,
      model: 'Mid Clamp',
      partNumber: 'MC-35-50',
      description: `Mid clamp for ${panelSpec?.thickness ?? 1.57}" panel frame`,
      quantity: midClampCount,
      unit: 'ea',
      derivedFrom: `totalPanels:${totalPanels}, rows:${rows}`,
    });
  }

  // Lag bolts (1 per L-foot)
  items.push({
    id: nextId(),
    category: 'racking_hardware',
    manufacturer: 'Generic',
    model: '5/16" × 3" Lag Bolt with EPDM Washer',
    partNumber: 'LAG-516-3-EPDM',
    description: 'Structural lag bolt with EPDM sealing washer',
    quantity: lFeetCount,
    unit: 'ea',
    derivedFrom: `attachmentCount:${lFeetCount}`,
    necReference: 'IBC 2021',
  });

  // ── 6. FLASHING ───────────────────────────────────────────────────────────
  if (roofType === 'shingle' || roofType === 'tile') {
    const flashingHardware = getFlashingHardware(roofType);
    items.push({
      id: nextId(),
      category: 'flashing',
      manufacturer: flashingHardware.manufacturer,
      model: flashingHardware.model,
      partNumber: flashingHardware.partNumber,
      description: flashingHardware.description,
      quantity: lFeetCount,
      unit: 'ea',
      derivedFrom: `roofType:${roofType}, penetrations:${lFeetCount}`,
      necReference: 'IBC 2021 / Manufacturer requirement',
    });
  }

  // ── 7. CONDUIT ────────────────────────────────────────────────────────────
  const conduitType = state.conductorSizing.conduitType;
  const conduitSize = state.conductorSizing.conduitSize;
  const wireLength = state.inverters[0]?.strings[0]?.wireLength ?? 50;
  const acWireLength = wireLength; // use same for AC run estimate
  const conduitLengthFt = calcConduitLengthFt(acWireLength + wireLength); // DC + AC runs

  items.push({
    id: nextId(),
    category: 'conduit',
    manufacturer: 'Generic',
    model: `${conduitSize} ${conduitType}`,
    partNumber: `${conduitType.replace(' ', '-')}-${conduitSize.replace('"', 'in')}`,
    description: `${conduitSize} ${conduitType} conduit`,
    quantity: conduitLengthFt,
    unit: 'lf',
    derivedFrom: `conduitType:${conduitType}, wireLength:${wireLength}ft DC + ${acWireLength}ft AC`,
    necReference: 'NEC Chapter 3',
  });

  // Conduit fittings (connectors, couplings — ~1 per 10ft)
  items.push({
    id: nextId(),
    category: 'conduit',
    manufacturer: 'Generic',
    model: `${conduitSize} ${conduitType} Connector`,
    partNumber: `${conduitType.replace(' ', '-')}-CONN-${conduitSize.replace('"', 'in')}`,
    description: `${conduitSize} ${conduitType} connectors and couplings`,
    quantity: Math.ceil(conduitLengthFt / 10),
    unit: 'ea',
    derivedFrom: `conduitLength:${conduitLengthFt}ft`,
  });

  // ── 8. WIRE ───────────────────────────────────────────────────────────────

  // DC wire (PV Wire / USE-2) — per string
  const dcWireGauge = state.inverters[0]?.strings[0]?.wireGauge ?? '#10 AWG';
  const dcWireLengthFt = state.inverters.reduce((sum, inv) =>
    sum + inv.strings.reduce((s, str) => s + str.wireLength * 2, 0), 0); // ×2 for +/-

  items.push({
    id: nextId(),
    category: 'wire',
    manufacturer: 'Generic',
    model: `${dcWireGauge} USE-2/PV Wire`,
    partNumber: `PV-WIRE-${dcWireGauge.replace('#', '').replace(' AWG', '')}`,
    description: `${dcWireGauge} USE-2/PV Wire — DC string wiring`,
    quantity: dcWireLengthFt,
    unit: 'lf',
    derivedFrom: `strings[].wireLength × 2 (pos + neg)`,
    necReference: 'NEC 690.31',
  });

  // AC wire (THWN-2) — from inverter to MSP
  const acWireGauge = state.conductorSizing.acWireGauge;
  const acWireLengthFt = acWireLength * 3; // 2 hots + neutral (or 2 hots for 240V)

  items.push({
    id: nextId(),
    category: 'wire',
    manufacturer: 'Generic',
    model: `${acWireGauge} THWN-2`,
    partNumber: `THWN2-${acWireGauge.replace('#', '').replace(' AWG', '')}`,
    description: `${acWireGauge} THWN-2 — AC output wiring`,
    quantity: acWireLengthFt,
    unit: 'lf',
    derivedFrom: `conductorSizing.acWireGauge, wireLength:${acWireLength}ft × 3 conductors`,
    necReference: 'NEC 310.15',
  });

  // EGC wire
  const egcGauge = state.conductorSizing.groundingConductor;
  items.push({
    id: nextId(),
    category: 'wire',
    manufacturer: 'Generic',
    model: `${egcGauge} Green THWN-2 (EGC)`,
    partNumber: `EGC-${egcGauge.replace('#', '').replace(' AWG', '')}`,
    description: `${egcGauge} Equipment Grounding Conductor`,
    quantity: Math.ceil(acWireLength * 1.1),
    unit: 'lf',
    derivedFrom: `NEC 250.122, wireLength:${acWireLength}ft`,
    necReference: 'NEC 250.122',
  });

  // ── 9. DISCONNECTS ────────────────────────────────────────────────────────

  if (state.acDisconnect) {
    const acAmps = nextStandardBreaker(
      (invSpec as any)?.acOutputCurrentMax ?? 32
    );
    items.push({
      id: nextId(),
      category: 'disconnects',
      manufacturer: 'Square D',
      model: `${acAmps}A AC Disconnect Switch`,
      partNumber: `DU${acAmps}RB`,
      description: `${acAmps}A 240V AC disconnect — NEC 690.14`,
      quantity: totalInverters,
      unit: 'ea',
      derivedFrom: `acDisconnect:true, inverterACOutput:${(invSpec as any)?.acOutputCurrentMax ?? 32}A`,
      necReference: 'NEC 690.14',
    });
  }

  if (state.dcDisconnect && state.topologyType !== 'MICRO') {
    items.push({
      id: nextId(),
      category: 'disconnects',
      manufacturer: 'Square D',
      model: '30A DC Disconnect Switch',
      partNumber: 'DU30RB',
      description: '30A 600VDC disconnect — NEC 690.15',
      quantity: totalInverters,
      unit: 'ea',
      derivedFrom: `dcDisconnect:true, topology:${state.topologyType}`,
      necReference: 'NEC 690.15',
    });
  }

  // Backfeed breaker for MSP
  const totalAcAmps = state.inverters.reduce((sum, inv) => {
    const spec = STRING_INVERTERS.find(i => i.id === inv.inverterId) ??
                 MICROINVERTERS.find(i => i.id === inv.inverterId);
    return sum + ((spec as any)?.acOutputCurrentMax ?? 32);
  }, 0);
  const backfeedAmps = nextStandardBreaker(totalAcAmps * 1.25);

  items.push({
    id: nextId(),
    category: 'disconnects',
    manufacturer: 'Square D',
    model: `${backfeedAmps}A 2-Pole Breaker (Backfeed)`,
    partNumber: `QO${backfeedAmps}2`,
    description: `${backfeedAmps}A backfeed breaker for MSP — NEC 705.12`,
    quantity: 1,
    unit: 'ea',
    derivedFrom: `totalACAmps:${totalAcAmps.toFixed(1)}A × 125% = ${backfeedAmps}A`,
    necReference: 'NEC 705.12',
  });

  // ── 10. COMBINERS ─────────────────────────────────────────────────────────

  if (totalStrings > 2 && state.topologyType !== 'MICRO') {
    items.push({
      id: nextId(),
      category: 'combiners',
      manufacturer: 'Midnite Solar',
      model: `MNPV${Math.min(totalStrings + 2, 12)}-MC4 Combiner Box`,
      partNumber: `MNPV${Math.min(totalStrings + 2, 12)}-MC4`,
      description: `${totalStrings}-string DC combiner box with fusing`,
      quantity: 1,
      unit: 'ea',
      derivedFrom: `totalStrings:${totalStrings} > 2`,
      necReference: 'NEC 690.8',
    });
  }

  // ── 11. MONITORING ────────────────────────────────────────────────────────

  if (state.productionMeter) {
    items.push({
      id: nextId(),
      category: 'monitoring',
      manufacturer: 'Emporia Energy',
      model: 'Vue 3 Production Meter',
      partNumber: 'EMP-VUE3-PRO',
      description: 'Revenue-grade production meter — kWh monitoring',
      quantity: 1,
      unit: 'ea',
      derivedFrom: 'productionMeter:true',
      necReference: 'NEC 690.54',
    });
  }

  // Add ecosystem monitoring (gateway)
  const gatewayComponent = state.ecosystemComponents.find(c => c.category === 'gateway');
  if (gatewayComponent) {
    items.push({
      id: nextId(),
      category: 'monitoring',
      manufacturer: gatewayComponent.manufacturer,
      model: gatewayComponent.model,
      partNumber: gatewayComponent.partNumber,
      description: `${gatewayComponent.manufacturer} monitoring gateway`,
      quantity: gatewayComponent.quantity,
      unit: 'ea',
      derivedFrom: `ecosystemComponent:${gatewayComponent.requiredBy}`,
    });
  }

  // ── 12. GROUNDING HARDWARE ────────────────────────────────────────────────

  // Ground rods (2 required per NEC 250.52)
  items.push({
    id: nextId(),
    category: 'grounding',
    manufacturer: 'Erico',
    model: '5/8" × 8ft Copper-Clad Ground Rod',
    partNumber: 'ERITECH-58-8',
    description: '5/8" × 8ft copper-clad ground rod — NEC 250.52',
    quantity: 2,
    unit: 'ea',
    derivedFrom: 'NEC 250.52: minimum 2 ground rods required',
    necReference: 'NEC 250.52',
  });

  // Ground rod clamps
  items.push({
    id: nextId(),
    category: 'grounding',
    manufacturer: 'Burndy',
    model: 'Ground Rod Clamp',
    partNumber: 'GRC-58',
    description: '5/8" ground rod clamp',
    quantity: 2,
    unit: 'ea',
    derivedFrom: '1 per ground rod',
    necReference: 'NEC 250.70',
  });

  // Equipment grounding lugs (1 per inverter + 1 per racking section)
  const lugCount = totalInverters + Math.ceil(railLengthFt / 14);
  items.push({
    id: nextId(),
    category: 'grounding',
    manufacturer: 'Ilsco',
    model: 'Lay-In Lug (EGC)',
    partNumber: 'GBL-4/0',
    description: 'Equipment grounding conductor lug',
    quantity: lugCount,
    unit: 'ea',
    derivedFrom: `inverters:${totalInverters} + railSections:${Math.ceil(railLengthFt / 14)}`,
    necReference: 'NEC 250.8',
  });

  // Bonding wire for racking (bare copper)
  items.push({
    id: nextId(),
    category: 'grounding',
    manufacturer: 'Generic',
    model: '#6 AWG Bare Copper (Bonding)',
    partNumber: 'BARE-CU-6',
    description: '#6 AWG bare copper bonding conductor for racking',
    quantity: Math.ceil(railLengthFt * 1.2),
    unit: 'lf',
    derivedFrom: `railLength:${railLengthFt}ft × 1.2 (bonding path)`,
    necReference: 'NEC 690.43 / 250.119',
  });

  // ── 13. LABELS ────────────────────────────────────────────────────────────

  items.push({
    id: nextId(),
    category: 'labels',
    manufacturer: 'Brady',
    model: 'NEC 690 Solar PV Label Set',
    partNumber: 'BRADY-PV-SET',
    description: 'Required NEC 690 labels: AC/DC disconnect, rapid shutdown, backfeed breaker, array, conduit',
    quantity: 1,
    unit: 'set',
    derivedFrom: 'NEC 690.31, 690.12, 705.12',
    necReference: 'NEC 690.31(G)',
  });

  // ── 14. RAPID SHUTDOWN ────────────────────────────────────────────────────

  if (state.rapidShutdown && state.topologyType !== 'MICRO') {
    // For non-Enphase systems, add rapid shutdown device
    const hasIntegratedRSD = state.ecosystemComponents.some(c => c.category === 'rapid_shutdown');
    if (!hasIntegratedRSD) {
      items.push({
        id: nextId(),
        category: 'misc',
        manufacturer: 'Tigo',
        model: 'TS4-A-F Rapid Shutdown',
        partNumber: 'TS4-A-F',
        description: 'Module-level rapid shutdown device — NEC 690.12',
        quantity: totalPanels,
        unit: 'ea',
        derivedFrom: `rapidShutdown:true, topology:${state.topologyType}`,
        necReference: 'NEC 690.12',
      });
    }
  }

  // ── 15. MISC ──────────────────────────────────────────────────────────────

  // Wire management clips
  items.push({
    id: nextId(),
    category: 'misc',
    manufacturer: 'IronRidge',
    model: 'Wire Management Clip',
    partNumber: 'WMC-01',
    description: 'Wire management clips for rail-mounted wiring',
    quantity: Math.ceil(totalPanels * 2),
    unit: 'ea',
    derivedFrom: `totalPanels:${totalPanels} × 2`,
  });

  // MC4 connectors (2 per panel for DC wiring)
  items.push({
    id: nextId(),
    category: 'misc',
    manufacturer: 'Stäubli',
    model: 'MC4 Connector Pair',
    partNumber: 'MC4-PAIR',
    description: 'MC4 connector pairs for DC string wiring',
    quantity: totalPanels * 2,
    unit: 'ea',
    derivedFrom: `totalPanels:${totalPanels} × 2 connectors`,
    necReference: 'NEC 690.33',
  });

  const categories = [...new Set(items.map(i => i.category))] as BOMCategory[];

  return {
    items,
    totalLineItems: items.length,
    categories,
    generatedAt: new Date().toISOString(),
    derivationLog: log,
    warnings,
  };
}

// ─── Attachment Hardware by Roof Type ─────────────────────────────────────────

function getAttachmentHardware(roofType: string, railMfr: string): {
  manufacturer: string; model: string; partNumber: string; description: string;
} {
  switch (roofType) {
    case 'shingle':
      return { manufacturer: 'IronRidge', model: 'L-Foot with Lag Bolt', partNumber: 'LFT-01', description: 'L-foot mount with 5/16" × 3" lag bolt for asphalt shingle' };
    case 'tile':
      return { manufacturer: 'QuickMount PV', model: 'Tile Hook', partNumber: 'QMTILE-01', description: 'Tile hook mount for concrete/clay tile' };
    case 'metal_standing_seam':
      return { manufacturer: 'S-5!', model: 'S-5! PVKIT 2.0', partNumber: 'S5-PVKIT2', description: 'Standing seam clamp — no penetrations' };
    case 'metal_corrugated':
      return { manufacturer: 'SnapNrack', model: 'Series 100 Corrugated Mount', partNumber: 'SNR-100-CORR', description: 'Corrugated metal mount with EPDM seal' };
    case 'flat_tpo':
    case 'flat_epdm':
    case 'flat_gravel':
      return { manufacturer: 'Esdec', model: 'FlatFix Fusion Ballast', partNumber: 'ESDEC-FF-01', description: 'Ballasted flat roof mount — no penetrations' };
    default:
      return { manufacturer: 'IronRidge', model: 'L-Foot', partNumber: 'LFT-01', description: 'Standard L-foot mount' };
  }
}

// ─── Flashing Hardware by Roof Type ──────────────────────────────────────────

function getFlashingHardware(roofType: string): {
  manufacturer: string; model: string; partNumber: string; description: string;
} {
  switch (roofType) {
    case 'shingle':
      return { manufacturer: 'QuickMount PV', model: 'Classic Mount Flashing', partNumber: 'QM-FLASH-01', description: 'EPDM-sealed flashing for asphalt shingle penetrations' };
    case 'tile':
      return { manufacturer: 'QuickMount PV', model: 'Tile Replacement Mount', partNumber: 'QM-TILE-FLASH', description: 'Tile replacement flashing with integrated mount' };
    default:
      return { manufacturer: 'Generic', model: 'EPDM Flashing', partNumber: 'EPDM-FLASH', description: 'EPDM rubber flashing for roof penetrations' };
  }
}