// ═══════════════════════════════════════════════════════════════════════════
// THE STANDALONE IQ GATEWAY MUST BE BOUGHT AS WHAT GOES ON THE WALL.
//
// "Whatever Envoy I want" (Ray, 2026-09-25). A standalone IQ Gateway has no
// busbar: the AC branch circuits land on 2-pole breakers in a PV AC combiner
// panel, and the gateway is its own box fed from its own breaker in that panel
// (lib/equipment/integratedBos.ts → 'enphase-iq-gateway-standalone').
//
// Measured before the repair, for a gateway pick:
//   · the engineering BOM bought the gateway AND the inverter row's legacy
//     "IQ Combiner 4C" under a fabricated SKU (ENV-IQ-C4C-240) — a second
//     combiner no drawing shows;
//   · the permit BOM deleted that and bought NO landing box at all;
//   · nothing bought a branch breaker, the gateway's supply breaker, its supply
//     conductors or the NEMA 3R box an indoor-rated gateway needs outdoors;
//   · the CT line told the crew the gateway "integrates production metering",
//     so its loose production CT reads as already installed.
//
// Every assertion here is about the ROWS a buyer and a crew read. The IQ
// Combiner 5C is the control: its BOM must not move at all.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import type { CADModel } from '@/lib/cad/types';
import { roofProject } from '../test-fixtures/roofProject';
import {
  generateBOMV4,
  standaloneGatewayBom,
  isStandaloneGatewayPlan,
  isStandaloneGatewayBomLine,
  STANDALONE_GATEWAY_BOM_BASIS,
  type BOMGenerationInputV4,
  type BOMLineItemV4,
} from '@/lib/bom-engine-v4';
import { generateBOMForPermit, type PermitBOMItem } from '@/lib/permit/utils/bomForPermit';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { buildConductorAuthority } from '@/lib/permit/utils/conductorAuthority';
import { permitInterconnectionToken } from '@/lib/permit/utils/interconnectionRule';
import { resolveIntegratedEquipment } from '@/lib/equipment/integratedBos';
import { resolveDesignMetering } from '@/lib/equipment/designMetering';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';
import type { SubSystemEquipment, SubSystemKey } from '@/lib/system/subSystemEquipment';

const STANDALONE = 'enphase-iq-gateway-standalone';
const LEGACY_4C_SKU = 'ENV-IQ-C4C-240';

/** 32 × IQ8+ → ceil(32 / 13) = 3 AC branches (the trunk plan's own count). */
function micro(over: Partial<BOMGenerationInputV4> = {}): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 32, deviceCount: 32, stringCount: 0, inverterCount: 32, systemKw: 13,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 64, railSections: 20,
    mainPanelAmps: 200, backfeedAmps: 60, acOCPD: 60, dcOCPD: 20,
    systemType: 'roof', rackingId: 'ironridge-xr100', topologyType: 'MICROINVERTER',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    ...over,
  } as BOMGenerationInputV4;
}

/** The rows the standalone topology is made of (and the rows it must not add).
 *  Stage-scoped: the service-side backfeed breaker (Stage 4) and the truck-stock
 *  spare breaker are not this topology's, and neither is the AC feeder wire. */
const BOS_CATEGORIES = new Set(['combiner', 'gateway', 'breaker', 'wire', 'enclosure', 'metering_ct']);
function bosRows<T extends { category: string; stageId?: string; model: string }>(items: T[]): T[] {
  return items.filter(i => BOS_CATEGORIES.has(i.category)
    && (i.stageId === 'inverter' || i.stageId === 'monitoring'));
}

/** What a buyer reads off a row — everything except row ids and render labels. */
const rowView = (i: BOMLineItemV4 | PermitBOMItem) => ({
  stageId: i.stageId, category: i.category, manufacturer: i.manufacturer, model: i.model,
  partNumber: i.partNumber, quantity: i.quantity, unit: i.unit, description: i.description,
  necReference: i.necReference, derivedFrom: i.derivedFrom, formula: i.formula,
  required: i.required, authorityStateHint: i.authorityStateHint,
});
const byKey = (a: ReturnType<typeof rowView>, b: ReturnType<typeof rowView>) =>
  `${a.stageId}|${a.category}|${a.model}`.localeCompare(`${b.stageId}|${b.category}|${b.model}`);

const isLegacy4C = (i: { partNumber?: string; model?: string }) =>
  i.partNumber === LEGACY_4C_SKU || /IQ Combiner 4C/i.test(String(i.model ?? ''));

// ════════════════════════════════════════════════════════════════════
// CONTROL — the discriminators are real.
// ════════════════════════════════════════════════════════════════════
describe('control — the defect this guards against is reachable', () => {
  it('whatever combiner accessory the IQ8+ registry row carries, a standalone pick never buys it', () => {
    // The registry row's combiner accessory is the fallback the engine reaches
    // for when nothing integrated was emitted — today the fabricated legacy 4C
    // (ENV-IQ-C4C-240). This asserts against WHATEVER it carries, not that it
    // carries the fabricated SKU: pinning the defect here would turn this test
    // red the day someone correctly deletes it, and push them to restore it.
    // Once no accessory is left, there is nothing for a standalone pick to buy
    // by mistake and the check has nothing to guard.
    const acc = getRegistryEntryV4('enphase-iq8plus')?.requiredAccessories
      .find(a => a.category === 'combiner');
    if (acc) {
      const bom = generateBOMV4(micro({ selectedCombinerId: STANDALONE }));
      expect(bom.items.some(i =>
        (!!acc.defaultPartNumber && i.partNumber === acc.defaultPartNumber)
        || (!!acc.defaultModel && i.model === acc.defaultModel))).toBe(false);
    }
  });

  it('the standalone selection resolves to the two-box plan the BOM builds from', () => {
    const plan = resolveIntegratedEquipment({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8PLUS-72-2-US', isMicro: true,
      totalDevices: 32, branchCount: 3, hasBattery: false, selectedCombinerId: STANDALONE,
    });
    expect(isStandaloneGatewayPlan(plan)).toBe(true);
    expect(plan.aggregation?.id).toBe('pv-ac-combiner-125');
    expect(plan.gateway?.partNumber).toBe('ENV2-IQ-AM1-240');
  });

  it('an IQ Combiner plan is not a standalone plan, and the builder emits nothing for it', () => {
    const plan = resolveIntegratedEquipment({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8PLUS-72-2-US', isMicro: true,
      totalDevices: 32, branchCount: 3, hasBattery: false, selectedCombinerId: 'enphase-iq-combiner-5c',
    });
    expect(isStandaloneGatewayPlan(plan)).toBe(false);
    expect(standaloneGatewayBom(plan, { branchCount: 3 }).items).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
// ENGINE — single-system path. 32 × IQ8+ → 3 branches.
// ════════════════════════════════════════════════════════════════════
describe('engineering BOM (single system) — 32 × IQ8+ on a standalone IQ Gateway', () => {
  const bom = generateBOMV4(micro({ selectedCombinerId: STANDALONE }));
  const rows = bosRows(bom.items);
  const cat = (c: string) => rows.filter(i => i.category === c);

  it('buys the IQ Gateway once, by its IEEE 1547:2018 part number', () => {
    const gw = cat('gateway');
    expect(gw).toHaveLength(1);
    expect(gw[0].manufacturer).toBe('Enphase');
    expect(gw[0].model).toBe('IQ Gateway');
    expect(gw[0].partNumber).toBe('ENV2-IQ-AM1-240');
    expect(gw[0].quantity).toBe(1);
    expect(gw[0].stageId).toBe('monitoring');
  });

  it('buys ONE landing box — the 125 A PV AC combiner panel, generic, FIELD-VERIFY — and no legacy 4C', () => {
    const comb = cat('combiner');
    expect(comb).toHaveLength(1);
    expect(comb[0].model).toBe('125A PV AC Combiner Panel');
    expect(comb[0].partNumber).toBe('—');
    expect(comb[0].description).toMatch(/FIELD-VERIFY/);
    expect(comb[0].authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    expect(bom.items.filter(isLegacy4C)).toEqual([]);
  });

  it('3 branches → 3 × 2P 20 A branch breakers + 1 × 2P 15 A gateway supply breaker, match panel', () => {
    const brk = cat('breaker');
    const branch = brk.filter(b => /PV branch/.test(b.model));
    const supply = brk.filter(b => /IQ Gateway supply/.test(b.model));
    expect(branch).toHaveLength(1);
    expect(branch[0].model).toMatch(/2P 20A/);
    expect(branch[0].quantity).toBe(3);
    expect(supply).toHaveLength(1);
    expect(supply[0].model).toMatch(/2P 15A/);
    expect(supply[0].quantity).toBe(1);
    for (const b of brk) {
      expect(b.description).toMatch(/Match the panel manufacturer and type — FIELD VERIFY/);
      expect(b.authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
    }
  });

  it('buys the gateway supply conductors — #14 L1/L2/N + #14 EGC — as a FIELD-VERIFY estimate', () => {
    const w = rows.filter(i => i.category === 'wire');
    const hot = w.find(i => i.partNumber === 'THWN2-14');
    const egc = w.find(i => i.partNumber === 'THWN2-GRN-14');
    // Bounded by the 5 ft production-CT lead: 5 × 3 × 1.15 and 5 × 1.15.
    expect(hot?.quantity).toBe(18);
    expect(hot?.description).toMatch(/L1, L2, N/);
    expect(egc?.quantity).toBe(6);
    for (const r of [hot, egc]) {
      expect(r?.description).toMatch(/FIELD VERIFY length/);
      expect(r?.authorityStateHint).toBe('ESTIMATED_FIELD_VERIFY');
    }
  });

  it('lists a NEMA 3R enclosure for the indoor-rated gateway — conditional, never counted as bought', () => {
    const enc = cat('enclosure');
    expect(enc).toHaveLength(1);
    expect(enc[0].description).toMatch(/^IF MOUNTED OUTDOORS — FIELD VERIFY/);
    expect(enc[0].required).toBe(false);
    expect(enc[0].authorityStateHint).toBe('CANDIDATE_NON_ORDERABLE');
  });

  it('buys the 2 consumption CTs through the metering composer, and NO production CT (it ships in the box)', () => {
    const ct = cat('metering_ct');
    expect(ct.map(c => `${c.partNumber}×${c.quantity}`)).toEqual(['CT-200-SPLIT×2']);
    expect(bom.items.some(i => i.partNumber === 'CT-200-SOLID')).toBe(false);
    expect(cat('gateway')[0].description).toMatch(/CT-200-SOLID production CT \(in the box — no separate line\)/);
  });

  it('no row tells the crew the gateway "integrates production metering"', () => {
    const ct = cat('metering_ct')[0];
    expect(ct.description).not.toMatch(/integrates production metering/);
    expect(ct.description).toMatch(/IQ Gateway ships one field-installed production CT \(CT-200-SOLID\) but NO consumption CTs/);
    expect(bom.warnings.join('\n')).not.toMatch(/integrates production metering/);
  });

  it('the production CT placement and lead it states are the metering composer\'s, not a second derivation', () => {
    // The composer (designMetering) decides where the gateway's CT goes and
    // whether its lead may be extended; E-1 draws that. The BOM must repeat it,
    // and size the supply run from the same lead — read the composer here too,
    // so a change to its rule moves this expectation with it.
    const plan = resolveIntegratedEquipment({
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8PLUS-72-2-US', isMicro: true,
      totalDevices: 32, branchCount: 3, hasBattery: false, selectedCombinerId: STANDALONE,
    });
    const drawing = resolveDesignMetering({ plan, interconnectionRaw: 'SUPPLY_SIDE_TAP' }).drawing;
    const lead = drawing?.leads?.find(l => l.channel === 'production');
    // Precondition: Enphase QIG 140-00210-03 — a 5 ft production-CT lead, "Do not extend".
    expect(drawing?.production?.where).toBe('landing-panel-field');
    expect(lead).toMatchObject({ maxLengthFt: 5, extendable: false });

    expect(cat('gateway')[0].description)
      .toContain(`installed on L1 in the PV AC combiner panel on its ${lead!.maxLengthFt} ft lead (do not extend).`);
    const hot = rows.find(i => i.partNumber === 'THWN2-14');
    expect(hot?.formula).toBe(`${lead!.maxLengthFt} ft × 3 conductors (L1, L2, N) × 1.15`);
  });

  it('every topology row carries the one builder basis, so the permit reconcile can recognise it', () => {
    const own = rows.filter(r => r.category !== 'metering_ct');
    expect(own.length).toBe(7);
    for (const r of own) {
      expect(isStandaloneGatewayBomLine(r)).toBe(true);
      expect(r.derivedFrom).toBe(STANDALONE_GATEWAY_BOM_BASIS);
    }
  });
});

describe('engineering BOM — the landing panel and its breakers follow the branch count', () => {
  const at = (branchCount: number) => {
    const bom = generateBOMV4(micro({ selectedCombinerId: STANDALONE, branchCount }));
    const brk = bom.items.filter(i => i.category === 'breaker' && i.stageId === 'inverter');
    return {
      panel: bom.items.find(i => i.category === 'combiner')?.model,
      branchBreakers: brk.find(b => /PV branch/.test(b.model))?.quantity,
      supplyBreakers: brk.find(b => /IQ Gateway supply/.test(b.model))?.quantity,
      warnings: bom.warnings,
    };
  };

  it.each([
    [3, '125A PV AC Combiner Panel'],
    [5, '125A PV AC Combiner Panel'],
    [6, '200A PV AC Combiner Panel'],
    [8, '225A PV AC Combiner Panel'],
  ])('%i branches → %s, one branch breaker per branch + one supply breaker', (n, panel) => {
    const r = at(n);
    expect(r.panel).toBe(panel);
    expect(r.branchBreakers).toBe(n);
    expect(r.supplyBreakers).toBe(1);
  });

  it('a panel the breakers overload is reported, not silently bought', () => {
    // 11 × 20 A + 15 A = 235 A on the largest (225 A) panel.
    expect(at(11).warnings.join('\n')).toMatch(/235 A\) exceed its 225 A busbar/);
  });
});

// ════════════════════════════════════════════════════════════════════
// The landing panel names only a disconnect the same BOM buys.
// ════════════════════════════════════════════════════════════════════
describe('the PV AC combiner panel row follows whether the design has an AC disconnect', () => {
  const panelOf = (items: Array<{ category: string; description?: string }>) =>
    items.find(i => i.category === 'combiner')?.description ?? '';

  it('with a disconnect (the default): the row says it feeds it, and the disconnect is bought', () => {
    const bom = generateBOMV4(micro({ selectedCombinerId: STANDALONE }));
    expect(panelOf(bom.items)).toMatch(/; feeds the AC disconnect\. /);
    expect(bom.items.some(i => i.category === 'disconnect')).toBe(true);
  });

  it('without one: no disconnect is bought, and the row does not claim one', () => {
    const bom = generateBOMV4(micro({ selectedCombinerId: STANDALONE, requiresACDisconnect: false }));
    expect(bom.items.some(i => i.category === 'disconnect')).toBe(false);
    expect(panelOf(bom.items)).not.toMatch(/feeds the AC disconnect/);
    expect(panelOf(bom.items))
      .toMatch(/feeds the service point of interconnection \(no separate AC disconnect in this design\)/);
  });

  it('the permit reconcile reads the same flag from the project', () => {
    const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project.selectedCombinerId = STANDALONE;
    p.project.acDisconnect = false;
    const bom = generateBOMForPermit(p, cad);
    expect(bom.some(i => i.category === 'disconnect')).toBe(false);
    expect(panelOf(bom)).toMatch(/no separate AC disconnect in this design/);
  });
});

// ════════════════════════════════════════════════════════════════════
// ENGINE — per-brand-group (hybrid) path. It must buy exactly what the
// single-system path buys for the same branch count; only the stamp differs.
// ════════════════════════════════════════════════════════════════════
describe('engineering BOM (per brand group) — agrees with the single-system path', () => {
  const NOW = '2026-09-26T00:00:00.000Z';
  const sub = (key: SubSystemKey, over: Partial<SubSystemEquipment>): SubSystemEquipment =>
    ({ key, source: 'engineering', updatedAt: NOW, ...over }) as SubSystemEquipment;
  const hybrid = generateBOMV4({
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405',
    moduleCount: 74, deviceCount: 48, stringCount: 2, inverterCount: 49,
    systemKw: 30, acOutputKw: 25,
    dcWireGauge: '#10 AWG', acWireGauge: '#6 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 96, railSections: 24,
    mainPanelAmps: 200, backfeedAmps: 0, acOCPD: 60, dcOCPD: 30,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
    includeTruckStock: false, includeSuggestedTools: false,
    subSystemCounts: { roof: 48, ground: 26, fence: 0 },
    selectedCombinerId: STANDALONE,
    subSystemEquipment: {
      roof: sub('roof', {
        panelId: 'rec-alpha-pure-r-405', inverterId: 'enphase-iq8plus', topology: 'micro',
        ecosystemBrand: 'enphase', mountingId: 'ironridge-xr100', roofType: 'shingle',
        env: { rooftopTempAdderC: 30 },
      }),
      ground: sub('ground', {
        panelId: 'qcells-q-peak-duo-400', inverterId: 'solis-s6-eh1p-7p6k-us', topology: 'string',
        ecosystemBrand: 'solis', trenchRunLengthFt: 80, env: { rooftopTempAdderC: 0, wireLengthFt: 120 },
      }),
    },
  } as BOMGenerationInputV4);
  // 48 × IQ8+ → ceil(48 / 13) = 4 branches, on both paths.
  const single = generateBOMV4(micro({
    selectedCombinerId: STANDALONE, moduleCount: 48, deviceCount: 48, inverterCount: 48,
  }));

  it('the roof lane buys the same standalone rows, row for row, as a roof-only job', () => {
    const h = bosRows(hybrid.items).map(rowView).sort(byKey);
    const s = bosRows(single.items).map(rowView).sort(byKey);
    expect(h.length).toBeGreaterThan(0);
    expect(h).toEqual(s);
    expect(h.find(r => r.category === 'breaker' && /PV branch/.test(r.model))?.quantity).toBe(4);
  });

  it('every one of those rows is stamped to the roof sub-system', () => {
    for (const r of bosRows(hybrid.items)) expect(r.subSystem, `${r.category} ${r.model}`).toBe('roof');
  });

  it('and neither path buys the legacy 4C', () => {
    expect(hybrid.items.filter(isLegacy4C)).toEqual([]);
    expect(single.items.filter(isLegacy4C)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
// PERMIT BOM — the reconcile follows the plan's devices, and agrees with
// the engineering BOM for the same design.
// ════════════════════════════════════════════════════════════════════
describe('permit BOM — 12 × IQ8M on a standalone IQ Gateway', () => {
  const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
  const fixture = (selectedCombinerId?: string) => {
    const p = JSON.parse(JSON.stringify(roofProject));
    if (selectedCombinerId) p.project.selectedCombinerId = selectedCombinerId;
    return p;
  };
  const fx = fixture(STANDALONE);
  const bom = generateBOMForPermit(fx, cad);
  const rows = bosRows(bom);
  const branches = buildConductorAuthority(fx, cad).subSystems
    .filter(s => s.isMicro).reduce((n, s) => n + s.microBranches.length, 0);

  it('the plan the sheets print is the standalone plan (precondition)', () => {
    expect(isStandaloneGatewayPlan(buildIntegratedEquipment(fx, cad))).toBe(true);
    expect(branches).toBeGreaterThan(0);
  });

  it('keeps the landing panel the old reconcile deleted, beside the gateway — once each', () => {
    expect(rows.filter(r => r.category === 'combiner').map(r => r.model)).toEqual(['125A PV AC Combiner Panel']);
    expect(rows.filter(r => r.category === 'gateway').map(r => r.partNumber)).toEqual(['ENV2-IQ-AM1-240']);
    expect(bom.filter(isLegacy4C)).toEqual([]);
  });

  it('buys one branch breaker per branch the sheets draw, the supply breaker, and the CTs exactly once', () => {
    const brk = rows.filter(r => r.category === 'breaker');
    expect(brk.find(b => /PV branch/.test(b.model))?.quantity).toBe(branches);
    expect(brk.find(b => /IQ Gateway supply/.test(b.model))?.quantity).toBe(1);
    expect(rows.filter(r => r.category === 'metering_ct').map(c => `${c.partNumber}×${c.quantity}`))
      .toEqual(['CT-200-SPLIT×2']);
  });

  it('the classifier keeps every generic / conditional row out of the procurement total', () => {
    const state = (pred: (r: PermitBOMItem) => boolean) => rows.find(pred)?.procurement?.authorityState;
    expect(state(r => r.category === 'combiner')).toBe('CANDIDATE_NON_ORDERABLE');
    expect(state(r => r.category === 'breaker')).toBe('CANDIDATE_NON_ORDERABLE');
    expect(state(r => r.category === 'enclosure')).toBe('CANDIDATE_NON_ORDERABLE');
    expect(state(r => r.partNumber === 'THWN2-14')).toBe('ESTIMATED_FIELD_VERIFY');
  });

  it('prints exactly the rows the engineering BOM prints for the same design', () => {
    const engine = generateBOMV4({
      ...micro({
        inverterId: 'enphase-iq8m', moduleCount: 12, deviceCount: 12, inverterCount: 12,
        branchCount: branches, selectedCombinerId: STANDALONE,
      }),
      interconnectionMethod: permitInterconnectionToken(fx.project.interconnectionMethod),
    } as BOMGenerationInputV4);
    const p = rows.map(rowView).sort(byKey);
    const e = bosRows(engine.items).map(rowView).sort(byKey);
    // panel, 2 breakers, 2 conductors, gateway, enclosure, consumption CTs
    expect(p.length).toBe(8);
    expect(p).toEqual(e);
  });
});

// ════════════════════════════════════════════════════════════════════
// CONTROLS — an IQ Combiner project's BOM does not move.
// ════════════════════════════════════════════════════════════════════
describe('control — an IQ Combiner 5C project buys exactly what it bought before', () => {
  const auto = generateBOMV4(micro());
  const picked = generateBOMV4(micro({ selectedCombinerId: 'enphase-iq-combiner-5c' }));
  const view = (b: ReturnType<typeof generateBOMV4>) =>
    b.items.map(i => `${i.stageId}|${i.category}|${i.manufacturer}|${i.model}|${i.partNumber}|${i.quantity}|${i.unit}|${i.description}`);

  it('the paired 5C and the selected 5C produce the same BOM, row for row', () => {
    // IQ8+ pairs with the 5C, so the selection must change nothing at all.
    expect(view(picked)).toEqual(view(auto));
    expect(picked.warnings).toEqual(auto.warnings);
  });

  it('one 5C row, worded as before, and none of the standalone rows', () => {
    const rows = bosRows(picked.items);
    expect(rows.map(r => `${r.category}|${r.model}|${r.partNumber}|${r.description}`))
      .toEqual(['combiner|IQ Combiner 5C|X-IQ-AM1-240-5C|Integrated Combiner · Gateway · Metering']);
    expect(picked.items.some(isStandaloneGatewayBomLine)).toBe(false);
    expect(picked.items.some(i => i.category === 'enclosure')).toBe(false);
    expect(picked.items.some(isLegacy4C)).toBe(false);
  });

  it('the permit reconcile for an unselected 5C project still emits the plan device the old way', () => {
    const cad = { systemType: 'roof', totalPanels: 12, totalDcKw: 5.16 } as CADModel;
    const p = JSON.parse(JSON.stringify(roofProject));
    const bom = generateBOMForPermit(p, cad);
    expect(bosRows(bom).map(r => `${r.category}|${r.model}|${r.partNumber}|${r.description}`))
      .toEqual(['combiner|IQ Combiner 5C|X-IQ-AM1-240-5C|Integrated Combiner · Gateway · Metering — 4 branch positions']);
    expect(bom.some(isStandaloneGatewayBomLine)).toBe(false);
  });
});

describe('control — the metering rows of the other IQ Combiners', () => {
  it('the 6C still buys its 2 consumption CTs, and its CT line still says "integrates" — true of the 6C', () => {
    const bom = generateBOMV4(micro({ selectedCombinerId: 'enphase-iq-combiner-6c' }));
    const ct = bom.items.filter(i => i.category === 'metering_ct');
    expect(ct.map(c => `${c.partNumber}×${c.quantity}`)).toEqual(['CT-200-SPLIT×2']);
    expect(ct[0].description).toMatch(/IQ Combiner 6C integrates production metering but ships NO consumption CTs/);
  });

  it('DELIBERATE CHANGE: the 4C ships its consumption CTs in the box, so the BOM no longer buys a second pair', () => {
    // IQ Combiner 4/4C data sheet IQC-4-4C-DSH-00217-5.0, "What's in the box":
    // two consumption CTs ship with it. It used to buy CT-200-SPLIT × 2 on top.
    const bom = generateBOMV4(micro({ selectedCombinerId: 'enphase-iq-combiner-4c' }));
    expect(bom.items.filter(i => i.category === 'metering_ct')).toEqual([]);
    expect(bom.warnings.join('\n')).not.toMatch(/CT-200-SPLIT/);
    expect(bom.items.filter(i => i.category === 'combiner').map(i => i.partNumber)).toEqual(['X-IQ-AM1-240-4C']);
  });
});
