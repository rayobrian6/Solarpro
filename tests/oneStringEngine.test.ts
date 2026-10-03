// ═══════════════════════════════════════════════════════════════════════════
// 🚨 ONE STRING ENGINE, AND IT NEVER CERTIFIES A STRING THE EQUIPMENT CANNOT TAKE (closure brief §2/§3).
//
// Review findings on the first closure pass, each pinned here on the pure functions:
//   · the engine treated a chosen PV inverter as ONE unit and ignored its DC input (a 7.6 kW inverter
//     "ENGINEERED" with 16.28 kW DC), compared ONE module's current with the per-MPPT limit while laying
//     two strings on that MPPT, and checked nothing but the 25-module ceiling on optimizer strings
//     (25 × 440 W = 11,000 W on a 6,000 W string);
//   · when it said INFEASIBLE the writers stored the whole array as one string, which the runtime guard
//     "repaired" from defaulted facts into 19 of 37 modules;
//   · `resizeFleetStrings`, project load, the restored-run and hydration paths and the normalizer still
//     strung through `sizeSystemFromBrand` — a second engine that disagreed on 41 of 48 inverters;
//   · the Design Studio handoff and the permit backfill handed a project nobody equipped the topology
//     default 'se-7600h' with Design Studio's 10-module chunks;
//   · a micro entry with no device counted as an endpoint.
// Every number below comes from the catalogue (lib/equipment-db.ts) or the project's own thermal basis.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  canonicalStringPartition, checkStringPartition, fleetEntryHasEndpoint, parallelStringsPerMppt,
  resolveStringEndpoint, sheetStringPartition, storedFleetPartition, stringModuleFacts, withoutUnresolvedEntries,
  type StringEndpoint,
} from '@/lib/electrical/canonicalStrings';
import {
  canonicalFleetEntries, entryStringsFor, fleetUnitsFor, resizeFleetStrings,
} from '@/lib/system/fleetStringWriters';
import { electricallyNormalizeInverterConfig } from '@/lib/system/electricalNormalize';
import { buildInverterConfig, buildStringConfig } from '@/lib/system/buildInverterConfig';
import { assignStrings } from '@/lib/stringAssignment';
import {
  buildDesignElectricalBlock, designElectricalToEngineering, designToPermitInverters,
} from '@/lib/system/designToEngineering';
import { SOLAR_PANELS, STRING_INVERTERS, getInverterById } from '@/lib/equipment-db';
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';
import { computeSystem } from '@/lib/computed-system';

const FENCE = SOLAR_PANELS.find(p => p.id === 'panel-fence-ps1')!;
const facts = stringModuleFacts(FENCE)!;
const T = getThermalDesignBasis({ state: 'IL', address: '238 N Warwick Ave, Peoria, IL' }).minDesignTempC;
const ep = (inverterId: string, inverterType = 'string') => resolveStringEndpoint({ inverterId, inverterType });
const pvEp = (inverterId: string, inverterType = 'string') =>
  ep(inverterId, inverterType) as Extract<StringEndpoint, { kind: 'pv-inverter' }>;
const engineer = (inverterId: string, inverterType = 'string', moduleCount = 37) =>
  canonicalStringPartition({ moduleCount, module: facts, designTempMin: T, endpoint: ep(inverterId, inverterType) });
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

describe('🚨 the engine respects every published limit — per unit, per MPPT, per string', () => {
  it('the facts these tests use are the catalogue\'s', () => {
    expect([FENCE.voc, FENCE.vmp, FENCE.isc, FENCE.imp, FENCE.watts]).toEqual([51.2, 42.8, 10.92, 10.28, 440]);
    expect(T).toBe(-23);
    expect(getInverterById('tesla-solar-inverter-7p6k')!.dcInputKwMax).toBe(12.92);
    expect(getInverterById('growatt-min-11400tl-xh-us')!.maxShortCircuitCurrent).toBe(16.9);
  });

  it('a chosen inverter is a MODEL: 16.28 kW DC is laid across the units whose DC inputs take it', () => {
    for (const id of ['tesla-solar-inverter-7p6k', 'growatt-min-7600tl-xh-us', 'fronius-primo-8.2']) {
      const r = engineer(id);
      expect(r.status, id).toBe('ENGINEERED');
      if (r.status !== 'ENGINEERED') continue;
      const cap = getInverterById(id)!.dcInputKwMax;
      expect(r.units, id).toBeGreaterThan(1);
      expect(sum(r.strings)).toBe(37);
      for (const unit of r.perUnit) expect(sum(unit) * 0.44, id).toBeLessThanOrEqual(cap + 1e-9);
    }
  });

  it('parallel strings ADD their current on the MPPT they share — 2 × 10.92 A on a 16.9 A input is refused', () => {
    const w = pvEp('growatt-min-11400tl-xh-us').window;
    expect(parallelStringsPerMppt(w, facts)).toEqual({ n: 1, limitedBy: expect.stringContaining('16.9 A') });
    // The old single-module comparison certified 10/10/10/7 on ONE unit's 3 MPPTs (two strings on one).
    const c = checkStringPartition({ strings: [10, 10, 10, 7], module: facts, window: w, designTempMin: T });
    expect(c.violations.join(' ')).toMatch(/4 strings need 4 inputs.*provides 3.*16\.9 A per MPPT/);
    const r = engineer('growatt-min-11400tl-xh-us');
    expect(r.status).toBe('ENGINEERED');
    if (r.status !== 'ENGINEERED') return;
    for (const unit of r.perUnit) expect(unit.length).toBeLessThanOrEqual(w.mpptChannels * 1);
  });

  it('optimizer strings stay inside the string power limit (DC bus × optimizer output) and the 8-optimizer minimum', () => {
    const w = pvEp('se-7600h', 'optimizer').window;
    expect(w.maxStringPowerW).toBe(400 * 15);   // SE7600H 400 V bus × SolarEdge P-series 15 A
    const old = checkStringPartition({ strings: [25, 12], module: facts, window: w, designTempMin: T, topology: 'optimizer' });
    expect(old.violations.join(' ')).toMatch(/11000 W exceeds the 6000 W optimizer string power limit/);
    for (const id of ['se-7600h', 'se-10000h', 'se-11400h', 'se-6000h', 'se-3800h']) {
      const r = engineer(id, 'optimizer');
      expect(r.status, id).toBe('ENGINEERED');
      if (r.status !== 'ENGINEERED') continue;
      const cap = Math.floor(pvEp(id, 'optimizer').window.maxStringPowerW! / 440);
      expect(sum(r.strings)).toBe(37);
      for (const n of r.strings) {
        expect(n, id).toBeLessThanOrEqual(cap);
        expect(n, id).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('every ENGINEERED layout across the catalogue re-checks clean against its own window, units included', () => {
    for (const inv of STRING_INVERTERS) {
      for (const type of inv.id.startsWith('se-') ? ['optimizer', 'string'] : ['string']) {
        const r = engineer(inv.id, type);
        if (r.status !== 'ENGINEERED') continue;
        const e = pvEp(inv.id, type);
        const c = checkStringPartition({ strings: r.strings, unitOf: r.unitOf, units: r.units, module: facts,
          window: e.window, designTempMin: T, topology: e.topology });
        expect(c.violations, `${inv.id}/${type}`).toEqual([]);
        expect(sum(r.strings), inv.id).toBe(37);
      }
    }
  });

  it('when NO layout fits it says why — a module whose Imp exceeds every input is INFEASIBLE on any number of units', () => {
    const r = engineer('sma-sb-7.7');
    expect(r.status).toBe('INFEASIBLE');
    if (r.status !== 'INFEASIBLE') return;
    expect(r.reason).toMatch(/Imp 10\.28 A exceeds the 10 A operating limit per MPPT/);
  });
});

describe('🚨 the writers: one engine, no partition when it says no', () => {
  const w = (inverterId: string, inverterType = 'string') =>
    ({ inverterId, inverterType, moduleCount: 37, panel: FENCE, designTempMin: T });

  it('INFEASIBLE ⇒ NO partition (never the whole array as one string), with the engine\'s reason', () => {
    expect(entryStringsFor(w('sma-sb-7.7'))).toBeNull();
    const u = fleetUnitsFor(w('sma-sb-7.7'));
    expect(u.units).toBeNull();
    expect('kind' in u && u.kind).toBe('not-engineered');
    expect(canonicalFleetEntries({ ...w('sma-sb-7.7'), inverterType: 'string' }).entries).toBeNull();
  });

  it('a chosen inverter gets one fleet entry per unit, distinct ids, every module carried', () => {
    const r = canonicalFleetEntries({ ...w('tesla-solar-inverter-7p6k'), inverterType: 'string',
      stringFields: { panelId: 'panel-fence-ps1' }, idPrefix: 'inv-x' });
    expect(r.entries).not.toBeNull();
    const entries = r.entries!;
    expect(entries.length).toBeGreaterThan(1);
    expect(new Set(entries.map(e => e.id)).size).toBe(entries.length);
    expect(new Set(entries.flatMap(e => e.strings.map(s => s.id))).size).toBe(entries.flatMap(e => e.strings).length);
    expect(sum(entries.flatMap(e => e.strings.map(s => s.panelCount)))).toBe(37);
    expect(entries.every(e => e.inverterId === 'tesla-solar-inverter-7p6k')).toBe(true);
  });

  it('resizeFleetStrings IS the canonical engine — same partition for every catalogued inverter, and it always covers the array', () => {
    for (const inv of STRING_INVERTERS) {
      const r = resizeFleetStrings({ inverter: { inverterId: inv.id, type: 'string' }, moduleCount: 37, panel: FENCE, designTempMin: T });
      const c = engineer(inv.id);
      if (c.status === 'ENGINEERED') {
        expect(r?.map(s => s.panelCount), inv.id).toEqual(c.strings);
        expect(r?.map(s => s.inverterIndex), inv.id).toEqual(c.unitOf);
        expect(sum(r!.map(s => s.panelCount))).toBe(37);
      } else {
        expect(r, inv.id).toBeNull();
      }
    }
    // The finding's own case: SE7600H at 37 × 440 W was resized to 12/12/12 (36 modules).
    const se = resizeFleetStrings({ inverter: { inverterId: 'se-7600h', type: 'optimizer' }, moduleCount: 37, panel: FENCE, designTempMin: T });
    expect(sum(se!.map(s => s.panelCount))).toBe(37);
  });

  it('the runtime normalizer never "repairs" a 1 × 37 it cannot string — no 10 / 9, no dropped modules', () => {
    const entry = buildInverterConfig({ inverterId: 'sma-sb-7.7', type: 'string',
      strings: [buildStringConfig({ index: 0, panelCount: 37, panelId: 'panel-fence-ps1' })] });
    const out = electricallyNormalizeInverterConfig({ inverters: [entry] }, { designTempMin: T });
    expect(out.rebuiltCount).toBe(0);
    expect(out.config.inverters).toEqual([entry]);
    // A repairable 1 × 37 is re-strung by the engine across its units — all 37 modules kept.
    const solark = buildInverterConfig({ inverterId: 'solark-12k-2p', type: 'string',
      strings: [buildStringConfig({ index: 0, panelCount: 37, panelId: 'panel-fence-ps1' })] });
    const fixed = electricallyNormalizeInverterConfig({ inverters: [solark] }, { designTempMin: T });
    const all = (fixed.config.inverters as typeof solark[]).flatMap(i => i.strings.map(s => s.panelCount));
    expect(sum(all)).toBe(37);
    expect(all).toEqual((engineer('solark-12k-2p') as { strings: number[] }).strings);
  });
});

describe('🚨 nothing chosen is nothing chosen — the design handoff, the permit backfill, a device-less micro', () => {
  const panels = Array.from({ length: 37 }, (_, i) => ({
    id: `pnl-${i}`, layoutId: 'lo', lat: 0, lng: 0, x: i, y: 0, tilt: 90, azimuth: 180,
    wattage: 440, bifacialGain: 0, row: 0, col: i, systemType: 'fence',
  }));
  // Exactly what Design Studio saves with its defaults (topology 'string', modulesPerString 10).
  const sa = assignStrings(panels as never, { modulesPerString: 10, topology: 'string', modulesPerDevice: 1 } as never);
  const byPanel: Record<string, number> = {};
  for (const pid in sa.byPanelId) byPanel[pid] = sa.byPanelId[pid].stringIndex;
  const de = buildDesignElectricalBlock({
    panels: panels as never, assignmentByPanelId: byPanel, topology: 'string', inverterBrand: 'SolarEdge',
    modulesPerString: 10, rackingId: 'ironridge-xr100', panelId: 'panel-fence-ps1', deviceCount: sa.deviceCount,
    generatedAt: '2026-10-03T00:00:00Z',
  } as never);

  it('the Design Studio handoff names no inverter when nobody chose one (it named se-7600h)', () => {
    expect(de.strings.map(s => s.panelCount)).toEqual([10, 10, 10, 7]);   // the studio's chunks
    const h = designElectricalToEngineering(de, { selectedInverterId: undefined });
    expect(h.inverterId).toBe('');
    expect(fleetEntryHasEndpoint({ inverterId: h.inverterId, type: h.inverterType })).toBe(false);
  });

  it('the permit backfill writes NO inverter from design_electrical without one — and strings a pinned one through the engine', () => {
    expect(designToPermitInverters(de, { selectedInverterId: undefined, designTempMin: T })).toBeNull();
    const pinned = designToPermitInverters(de, { selectedInverterId: 'solark-12k-2p', designTempMin: T })!;
    const strings = pinned.flatMap(i => i.strings.map(s => s.panelCount));
    expect(strings).toEqual((engineer('solark-12k-2p') as { strings: number[] }).strings);
    expect(strings).not.toEqual([10, 10, 10, 7]);
  });

  it('a micro entry with no catalogued device is NOT an endpoint (it was rated 37 × 0.290 kW)', () => {
    expect(resolveStringEndpoint({ inverterId: '', inverterType: 'micro' }).kind).toBe('none');
    expect(resolveStringEndpoint({ inverterId: 'not-a-micro', inverterType: 'micro' }).kind).toBe('none');
    expect(resolveStringEndpoint({ inverterId: 'se-7600h', inverterType: 'micro' }).kind).toBe('none');
    const noDevice = { inverterId: '', type: 'micro' };
    expect(fleetEntryHasEndpoint(noDevice)).toBe(false);
    expect(withoutUnresolvedEntries([noDevice]).kept).toEqual([]);
    expect(fleetUnitsFor({ inverterId: '', inverterType: 'micro', moduleCount: 37, panel: FENCE, designTempMin: T }).units).toBeNull();
    // Control: a catalogued micro still carries its modules (devices, not strings).
    expect(fleetUnitsFor({ inverterId: 'enphase-iq8a', inverterType: 'micro', moduleCount: 37, panel: FENCE, designTempMin: T }).units).toEqual([[37]]);
  });
});

describe('🚨 the engine states no strings for a chosen inverter it cannot string — no equal-split fallback', () => {
  it('computeSystem with pvStringsNotEngineered: no strings, no DC string run, the reason as an error; the AC side stands', () => {
    const inv = getInverterById('sma-sb-7.7')!;
    const input = {
      topology: 'string', solarCoupling: null, totalPanels: 37,
      panelWatts: FENCE.watts, panelVoc: FENCE.voc, panelIsc: FENCE.isc, panelVmp: FENCE.vmp, panelImp: FENCE.imp,
      panelTempCoeffVoc: FENCE.tempCoeffVoc, panelTempCoeffIsc: 0.05, panelMaxSeriesFuse: 20,
      panelModel: FENCE.model, panelManufacturer: FENCE.manufacturer,
      inverterManufacturer: inv.manufacturer, inverterModel: inv.model, inverterAcKw: inv.acOutputKw, inverterCount: 1,
      inverterMaxDcV: inv.maxDcVoltage, inverterMpptVmin: inv.mpptVoltageMin, inverterMpptVmax: inv.mpptVoltageMax,
      inverterMaxInputCurrentPerMppt: inv.maxInputCurrentPerMppt, inverterMpptChannels: inv.mpptChannels,
      inverterAcCurrentMax: inv.acOutputCurrentMax, inverterModulesPerDevice: 1, inverterBranchLimit: 16,
      designTempMin: T, ambientTempC: 35, rooftopTempAdderC: 0, runLengths: {}, conduitType: 'EMT',
      mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200, interconnectionMethod: 'LOAD_SIDE',
      systemType: 'fence', maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3, batteryIds: [],
    };
    const cs = computeSystem({ ...input, pvStringsNotEngineered: true } as never);
    expect(cs.stringCount).toBe(0);
    expect(cs.strings).toEqual([]);
    expect(cs.runs.map(r => r.id)).not.toContain('DC_STRING_RUN');
    expect(cs.issues.map(i => i.code)).toContain('PV_STRINGS_NOT_ENGINEERED');
    expect(cs.totalAcKw).toBeCloseTo(7.7, 6);
    // Control: without the flag the engine invents its own ceil(37 / max) equal split.
    const old = computeSystem(input as never);
    expect(old.stringCount).toBeGreaterThan(0);
  });
});

describe('🚨 the sheet\'s partition is the card\'s', () => {
  const fleetOf = (id: string, perUnit: number[][]) =>
    storedFleetPartition(perUnit.map((u, i) => ({ id: `inv-${i}`, inverterId: id, type: 'string',
      strings: u.map(panelCount => ({ panelCount, panelId: 'panel-fence-ps1' })) })));

  it('a valid stored fleet for THIS endpoint is drawn as stored; anything else gets the engine\'s', () => {
    const c = engineer('growatt-min-7600tl-xh-us') as { perUnit: number[][]; strings: number[] };
    const stored = fleetOf('growatt-min-7600tl-xh-us', c.perUnit);
    const a = sheetStringPartition({ endpoint: ep('growatt-min-7600tl-xh-us'), moduleCount: 37, module: facts, designTempMin: T, fleet: stored });
    expect(a.source).toBe('fleet');
    expect(a.strings).toEqual(c.strings);
    // A different valid installer layout of the same model is drawn as the installer stored it.
    const mine = fleetOf('growatt-min-7600tl-xh-us', [[9, 9], [10, 9]]);
    expect(sheetStringPartition({ endpoint: ep('growatt-min-7600tl-xh-us'), moduleCount: 37, module: facts, designTempMin: T, fleet: mine }).strings)
      .toEqual([9, 9, 10, 9]);
    // Another model's fleet, an invalid one, or one that does not cover the array: the engine's.
    for (const f of [fleetOf('fronius-primo-8.2', [[10, 10], [10, 7]]), fleetOf('growatt-min-7600tl-xh-us', [[20, 17]]),
      fleetOf('growatt-min-7600tl-xh-us', [[9, 9], [9, 9]])]) {
      const r = sheetStringPartition({ endpoint: ep('growatt-min-7600tl-xh-us'), moduleCount: 37, module: facts, designTempMin: T, fleet: f });
      expect(r.source).toBe('canonical');
      expect(r.strings).toEqual(c.strings);
    }
  });

  it('no endpoint ⇒ no partition, whatever is stored', () => {
    const r = sheetStringPartition({ endpoint: ep(''), moduleCount: 37, module: facts, designTempMin: T,
      fleet: storedFleetPartition([{ inverterId: '', type: 'string', strings: [{ panelCount: 20 }, { panelCount: 17 }] }]) });
    expect(r.source).toBe('none');
    expect(storedFleetPartition([{ inverterId: '', type: 'string', strings: [{ panelCount: 20 }] }])).toEqual([]);
  });
});
