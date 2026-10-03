// ═══════════════════════════════════════════════════════════════════════════
// 🚨 PHYSICAL MODULES KNOWN ≠ STRING ARCHITECTURE KNOWN (closure brief §2/§3/§5).
//
// Found in the browser on a fresh project — 37 × panel-fence-ps1 placed in Design, no PV inverter,
// no storage — the Inverters & Strings card read "String Inverter · 37 panels · 16.28 kW DC ·
// 2 strings (20/17 panels)". Console-traced on the production page:
//
//   1. Smart Defaults fired on the FACTORY fleet before the project loaded (`projectId: null`,
//      `systemPanelCount = 10` — the factory string's own count), seeding a 10-module Enphase fleet
//      and stamping `selectedBrand: 'enphase'`, `defaultsApplied`, `isUserControlled`.
//   2. The project load wrote an inverter-less entry carrying a `Math.min(37, 14)` split (14/14/9).
//   3. The sync-pipeline PANEL COUNT FIX, holding the stale micro fleet in its closure, took its
//      micro branch and wrote ONE 37-module string onto the loaded inverter-less entry.
//   4. The v61.6 runtime guard handed that 1 × 37 to `electricallyNormalizeInverterConfig`, which
//      found no brand profile for an empty id and split it at CONSERVATIVE_MAX_PANELS_PER_STRING = 20
//      → 20 / 17. Autosave stored it (`engineering_config.inverters[0]`, `inverterId: ''`).
//
// This file pins the invariant at the writers and in the one string engine; the routes are driven
// on PostgreSQL in tests/noStringingWithoutAnEndpoint.postgres.test.ts and the card in
// tests/noStringingWithoutAnEndpoint.component.test.tsx.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import {
  canonicalStringPartition, checkStringPartition, fleetEntryHasEndpoint, lengthFirstValidPartition,
  resolveStringEndpoint, storageWindow, withoutUnresolvedEntries,
} from '@/lib/electrical/canonicalStrings';
import { entryStringsFor, resizeFleetStrings } from '@/lib/system/fleetStringWriters';
import { electricallyNormalizeInverterConfig } from '@/lib/system/electricalNormalize';
import { buildInverterConfig, buildStringConfig } from '@/lib/system/buildInverterConfig';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { dcStringLimits, type DcStringLimits } from '@/lib/electrical/dcStringLimits';
import { deriveStorageDcStrings } from '@/lib/electrical/storageDcStrings';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { invertingUnits, recommendStringAssignment } from '@/lib/electrical/storageStringAssignment';
import { BATTERIES, SOLAR_PANELS, STRING_INVERTERS } from '@/lib/equipment-db';
import { generateStringConfig, inverterSpecsFromRegistry, moduleSpecsFromRegistry } from '@/lib/string-generator';
import { getThermalDesignBasis } from '@/lib/permit/utils/designTemps';

const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const m = pv37.module!;
const FENCE = SOLAR_PANELS.find(p => p.id === 'panel-fence-ps1')! as typeof SOLAR_PANELS[number] & { tempCoeffPmax: number };
const PW3 = BATTERIES.find(b => b.id === 'tesla-powerwall-3')!;
const raysJob = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });
const raysLimits = () => dcStringLimits(raysJob() as never, 'dc-coupled-storage')!;
// Peoria, IL — the project's own thermal basis (the authority the page, the SLD and the plan set share).
const BASIS = getThermalDesignBasis({ state: 'IL', address: '238 N Warwick Ave, Peoria, IL' });
const facts = {
  voc: m.voc, vmp: m.vmp, isc: m.isc, imp: m.imp, watts: m.watts, tempCoeffVoc: m.tempCoeffVoc,
  maxSeriesFuseRating: m.maxSeriesFuseRating,
};
const fresh = (strings: number[], inverterId = '') => buildInverterConfig({
  inverterId, type: 'string',
  strings: strings.map((panelCount, index) => buildStringConfig({ index, panelCount, panelId: 'panel-fence-ps1' })),
});

/** The page's computeSystem input for the fresh project (no inverter): its 600 V / 7.6 kW fallbacks. */
function freshPageInput(over: Partial<ComputedSystemInput> = {}): ComputedSystemInput {
  return {
    topology: 'string', solarCoupling: null, totalPanels: 37,
    panelWatts: m.watts, panelVoc: m.voc, panelIsc: m.isc, panelVmp: m.vmp, panelImp: m.imp,
    panelTempCoeffVoc: m.tempCoeffVoc, panelTempCoeffIsc: m.tempCoeffIsc, panelMaxSeriesFuse: m.maxSeriesFuseRating,
    panelModel: m.model, panelManufacturer: m.manufacturer,
    inverterManufacturer: '', inverterModel: '⚠ INVERTER NOT SELECTED', inverterAcKw: 7.6, inverterCount: 1,
    inverterMaxDcV: 600, inverterMpptVmin: 100, inverterMpptVmax: 480, inverterMaxInputCurrentPerMppt: 13.5,
    inverterMpptChannels: 2, inverterAcCurrentMax: 32, inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: BASIS.minDesignTempC, ambientTempC: BASIS.maxDesignTempC, rooftopTempAdderC: 0,
    runLengths: {}, conduitType: 'EMT', mainPanelAmps: 200, mainPanelBrand: 'Square D', panelBusRating: 200,
    interconnectionMethod: 'LOAD_SIDE', systemType: 'fence',
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3, batteryIds: [],
    ...over,
  } as ComputedSystemInput;
}

describe('🚨 no receiving endpoint ⇒ no string partition, anywhere', () => {
  it('nothing chosen is NO endpoint: an empty id, an id the catalogue does not hold, DC coupling to storage with no PV input', () => {
    expect(resolveStringEndpoint({ inverterId: '', inverterType: 'string' }).kind).toBe('none');
    expect(resolveStringEndpoint({ inverterId: 'not-in-the-catalogue', inverterType: 'string' }).kind).toBe('none');
    expect(resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: null }).kind).toBe('none');
    // Controls: real receiving equipment IS an endpoint.
    expect(resolveStringEndpoint({ inverterId: 'fronius-primo-8.2', inverterType: 'string' }).kind).toBe('pv-inverter');
    expect(resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: raysLimits() }).kind).toBe('storage-dc-input');
    expect(resolveStringEndpoint({ inverterId: 'enphase-iq8a', inverterType: 'micro' }).kind).toBe('microinverter');
  });

  it('every catalogued PV inverter IS an endpoint (the rule never mistakes a real inverter for "none")', () => {
    const none = STRING_INVERTERS.filter(i => !fleetEntryHasEndpoint({ inverterId: i.id, type: 'string' })).map(i => i.id);
    expect(none).toEqual([]);
  });

  it('the engine answers UNRESOLVED — with no partition — for no endpoint, and NOT_APPLICABLE for microinverters', () => {
    const none = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ inverterId: '', inverterType: 'string' }) });
    expect(none.status).toBe('UNRESOLVED');
    expect('strings' in none).toBe(false);
    const micro = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ inverterId: 'enphase-iq8a', inverterType: 'micro' }) });
    expect(micro.status).toBe('NOT_APPLICABLE');
    expect('strings' in micro).toBe(false);
  });

  it('a writer creating an entry with no PV inverter writes NO entry; a micro carries its modules on one; a chosen inverter is engineered', () => {
    expect(entryStringsFor({ inverterId: '', inverterType: 'string', moduleCount: 37, panel: FENCE, designTempMin: BASIS.minDesignTempC })).toBeNull();
    expect(entryStringsFor({ inverterId: 'enphase-iq8a', inverterType: 'micro', moduleCount: 37, panel: FENCE, designTempMin: BASIS.minDesignTempC })).toEqual([37]);
    const chosen = entryStringsFor({ inverterId: 'fronius-primo-8.2', inverterType: 'string', moduleCount: 37, panel: FENCE, designTempMin: BASIS.minDesignTempC })!;
    expect(chosen.reduce((a, b) => a + b, 0)).toBe(37);
    expect(chosen.length).toBeGreaterThan(1);
  });

  it('the PANEL COUNT FIX / per-sub rebuild sizes NOTHING for an inverter-less fleet — not even with a brand in hand', () => {
    // "FIX 2" sized an inverter-less fleet from `selectedBrand`, then fell back to a 14-cap even split.
    for (const selectedBrand of [undefined, 'enphase', 'fronius', 'sma', 'solaredge']) {
      expect(resizeFleetStrings({ inverter: { inverterId: '', type: 'string' }, moduleCount: 37, systemType: 'fence',
        panel: FENCE, designTempMin: BASIS.minDesignTempC, selectedBrand }), `brand ${selectedBrand}`).toBeNull();
    }
    expect(resizeFleetStrings({ inverter: null, moduleCount: 37, systemType: 'fence', panel: FENCE,
      designTempMin: BASIS.minDesignTempC, selectedBrand: 'fronius' })).toBeNull();
    // Control: the fleet's own chosen inverter is sized, and the strings cover the array.
    const sized = resizeFleetStrings({ inverter: { inverterId: 'fronius-primo-8.2', type: 'string' }, moduleCount: 37,
      systemType: 'fence', panel: FENCE, designTempMin: BASIS.minDesignTempC })!;
    expect(sized.reduce((a, s) => a + s.panelCount, 0)).toBe(37);
  });

  it('the runtime normalizer never re-splits an inverter-less 1 × 37 into the "conservative" 20 / 17', () => {
    const out = electricallyNormalizeInverterConfig({ inverters: [fresh([37])] });
    expect(out.rebuiltCount).toBe(0);
    expect((out.config.inverters as ReturnType<typeof fresh>[])[0].strings.map(s => s.panelCount)).not.toEqual([20, 17]);
  });

  it('a STORED 20 / 17 on an inverter-less entry (projects saved before the fix) is dropped on load, never resurrected', () => {
    const stored = [fresh([20, 17])];
    const { kept, dropped } = withoutUnresolvedEntries(stored);
    expect(kept).toEqual([]);
    expect(dropped.map(d => d.strings.map(s => s.panelCount))).toEqual([[20, 17]]);
    // Control: a chosen inverter's partition is kept, and a micro carrier too.
    const chosen = fresh([10, 10, 9, 8], 'fronius-primo-8.2');
    const micro = buildInverterConfig({ inverterId: 'enphase-iq8a', type: 'micro',
      strings: [buildStringConfig({ index: 0, panelCount: 37, panelId: 'panel-fence-ps1' })] });
    expect(withoutUnresolvedEntries([chosen, micro]).kept).toEqual([chosen, micro]);
  });

  it('the engine states no strings, no PV AC rating, no PV backfeed and no 120% verdict with nothing chosen', () => {
    const cs = computeSystem(freshPageInput({ pvEndpointUnresolved: true }));
    expect(cs.strings).toEqual([]);
    expect(cs.stringCount).toBe(0);
    expect(cs.totalAcKw).toBe(0);
    expect(cs.backfeedBreakerAmps).toBe(0);
    expect(cs.acOcpdAmps).toBe(0);
    expect(cs.interconnectionPass).toBe(false);
    expect(cs.interconnectionRefusal).toMatch(/NOT EVALUATED — no PV inverter/);
    const ids = cs.runs.map(r => r.id);
    for (const id of ['DC_STRING_RUN', 'DC_DISCO_TO_INV_RUN', 'INV_TO_DISCO_RUN', 'DISCO_TO_METER_RUN']) expect(ids).not.toContain(id);
    expect(cs.equipmentSchedule.map(r => r.tag)).not.toContain('INV-1');
    expect(cs.issues.map(i => i.code)).toContain('PV_ENDPOINT_UNRESOLVED');
    // Control — the same input WITHOUT the flag is the defect: strings and a 7.6 kW inverter nobody chose.
    const old = computeSystem(freshPageInput());
    expect(old.strings.length).toBeGreaterThan(0);
    expect(old.totalAcKw).toBe(7.6);
    expect(old.runs.map(r => r.id)).toContain('INV_TO_DISCO_RUN');
  });

  it('microinverters follow their own architecture: devices and AC branches, never DC strings', () => {
    const cs = computeSystem(freshPageInput({
      topology: 'micro', inverterManufacturer: 'Enphase', inverterModel: 'IQ8A', inverterAcKw: 0.349,
      inverterMaxDcV: 60, inverterMpptVmin: 16, inverterMpptVmax: 60, inverterAcCurrentMax: 1.45,
      inverterBranchLimit: 13, pvEndpointUnresolved: true,
    }));
    expect(cs.strings).toEqual([]);
    expect(cs.microDeviceCount).toBe(37);
    expect(cs.acBranchCount).toBeGreaterThan(0);
  });
});

describe('🚨 with an endpoint: ONE engine, every string inside the published limits', () => {
  it('Ray\'s DC-coupled job: the canonical partition IS the SLD route\'s (9 / 9 / 9 / 8 / 2)', () => {
    const lim = raysLimits();
    const r = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: lim }) });
    expect(r.status).toBe('ENGINEERED');
    if (r.status !== 'ENGINEERED') return;
    expect(r.strings).toEqual([9, 9, 9, 8, 2]);
    expect(r.adjustedForValidity).toBe(false);
    expect(deriveStorageDcStrings({ moduleCount: 37, module: facts, limits: lim, designTempMin: BASIS.minDesignTempC }))
      .toEqual(r.strings);
  });

  it('every string of 9 / 9 / 9 / 8 / 2 is inside the Powerwall 3 PV input — cold Voc AND the hot-weather MPPT minimum', () => {
    // Every number from the catalogue: module `panel-fence-ps1` (Voc 51.2 V, Vmp 42.8 V, Isc 10.92 A,
    // Imp 10.28 A, tempCoeffVoc −0.30 %/°C, tempCoeffPmax −0.34 %/°C, no tempCoeffVmp published) and
    // Powerwall 3 `pvInput` (input 60–550 V, MPPT 60–480 V, 6 MPPTs, Imp 15 A — 13 A unless the unit is
    // labelled 15 A IMP — Isc 19 A, 20 kW STC per unit).
    expect([FENCE.voc, FENCE.vmp, FENCE.isc, FENCE.imp, FENCE.tempCoeffVoc]).toEqual([51.2, 42.8, 10.92, 10.28, -0.30]);
    expect(PW3.pvInput).toMatchObject({ inputVdc: [60, 550], mpptVdc: [60, 480], mppts: 6, maxIscPerMpptA: 19 });
    const lim = raysLimits();
    expect(lim).toMatchObject({ maxDcVoltage: 550, mpptVoltageMin: 60, mpptChannels: 24, maxIscPerMpptA: 19 });
    const { checks, violations, bounds } = checkStringPartition({ strings: [9, 9, 9, 8, 2], module: facts,
      window: storageWindow(lim), designTempMin: BASIS.minDesignTempC });
    expect(violations).toEqual([]);
    // Cold: 9 modules at the site's design low, the longest string — under the 550 V input maximum.
    const longest = checks[0];
    expect(longest.coldVoc).toBeLessThanOrEqual(550);
    expect(longest.coldVoc).toBeCloseTo(9 * 51.2 * (1 + (-0.30 / 100) * (BASIS.minDesignTempC - 25)), 6);
    // Hot: the 2-module string at the engine's hot-cell basis (75 °C; Vmp coefficient = Voc's, none
    // published) — 2 × 42.8 × (1 − 0.003 × 50) = 72.76 V ≥ 60 V MPPT / input minimum.
    const two = checks[4];
    expect(two.modules).toBe(2);
    expect(two.hotVmp).toBeCloseTo(72.76, 2);
    expect(two.hotVmp).toBeGreaterThanOrEqual(60);
    expect(bounds.minPanelsPerString).toBe(2);
    // Even with the module's Pmax coefficient as a more pessimistic Vmp proxy (−0.34 %/°C) the 2-module
    // string stays inside: 2 × 42.8 × (1 − 0.0034 × 50) = 71.05 V.
    expect(2 * FENCE.vmp * (1 + (FENCE.tempCoeffPmax / 100) * 50)).toBeCloseTo(71.05, 2);
    expect(2 * FENCE.vmp * (1 + (FENCE.tempCoeffPmax / 100) * 50)).toBeGreaterThanOrEqual(PW3.pvInput!.mpptVdc[0]);
    // …and at the site's own design high, a cooler cell: the ASHRAE 2 % high + a 45 °C-NOCT rise.
    const siteCell = BASIS.maxDesignTempC + (45 - 20) * 1.25;
    expect(2 * FENCE.vmp * (1 + (FENCE.tempCoeffVoc / 100) * (siteCell - 25))).toBeGreaterThan(72.76);
    // Current: one string per MPPT — the module's 10.92 A Isc under the 19 A limit, 10.28 A Imp under 13 A.
    expect(FENCE.isc).toBeLessThanOrEqual(PW3.pvInput!.maxIscPerMpptA);
    expect(FENCE.imp).toBeLessThanOrEqual(13);
    // Five strings on 24 MPPTs, and a valid per-unit assignment inside each unit's 20 kW STC.
    const rec = recommendStringAssignment({ strings: [9, 9, 9, 8, 2], moduleWatts: 440, units: invertingUnits(raysJob() as never) });
    expect(rec.ok).toBe(true);
  });

  it('a layout that would break a published limit is never returned: the engine\'s own remainder is replaced, same style', () => {
    // A window whose MPPT minimum needs ≥ 3 modules (hot Vmp 36.38 V/module ⇒ ceil(100 / 36.38) = 3):
    // length-first 9 × 4 leaves 1, the borrow gives 8 + 2, and the generator keeps a 2-module string
    // with only a WARNING. That is an invalid string; the canonical engine returns a valid one instead.
    const lim: DcStringLimits = { ...raysLimits(), mpptVoltageMin: 100 };
    const raw = generateStringConfig({ totalModules: 37, designTempMin: BASIS.minDesignTempC, topology: 'string',
      moduleSpecs: moduleSpecsFromRegistry(facts),
      inverterSpecs: inverterSpecsFromRegistry({ maxDcVoltage: lim.maxDcVoltage, mpptVoltageMin: lim.mpptVoltageMin,
        mpptVoltageMax: lim.mpptVoltageMax, mpptChannels: lim.mpptChannels, maxInputCurrent: lim.maxInputCurrentPerMppt }) });
    const rawCounts = raw.strings.map(s => s.panelsInString);
    expect(Math.min(...rawCounts), 'control: the generator alone emits a string below the MPPT minimum').toBeLessThan(3);
    const r = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: lim }) });
    expect(r.status).toBe('ENGINEERED');
    if (r.status !== 'ENGINEERED') return;
    expect(r.adjustedForValidity).toBe(true);
    expect(r.strings).toEqual([9, 9, 9, 7, 3]);
    expect(Math.min(...r.strings)).toBeGreaterThanOrEqual(3);
    expect(lengthFirstValidPartition(37, 3, 9, 24)).toEqual([9, 9, 9, 7, 3]);
  });

  it('when no layout fits, the engine says so (INFEASIBLE) instead of emitting one', () => {
    const lim: DcStringLimits = { ...raysLimits(), mpptChannels: 1, unitCount: 1 };
    const r = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ coupling: 'dc-coupled-storage', storageLimits: lim }) });
    expect(r.status).toBe('INFEASIBLE');
    expect('strings' in r).toBe(false);
  });

  it('a chosen PV inverter is strung inside its own catalogued window', () => {
    const r = canonicalStringPartition({ moduleCount: 37, module: facts, designTempMin: BASIS.minDesignTempC,
      endpoint: resolveStringEndpoint({ inverterId: 'fronius-primo-8.2', inverterType: 'string' }) });
    expect(r.status).toBe('ENGINEERED');
    if (r.status !== 'ENGINEERED') return;
    expect(r.strings.reduce((a, b) => a + b, 0)).toBe(37);
    for (const c of r.checks) {
      expect(c.coldVoc).toBeLessThanOrEqual(600);
      expect(c.hotVmp).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('🚨 the page\'s writers obey the rule (source guards on the live lines)', () => {
  const page = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));

  it('Smart Defaults never fires on the factory fleet before the project has loaded', () => {
    const at = page.indexOf('if (config.defaultsApplied && !subSystemCounts.isHybrid) return;');
    expect(at).toBeGreaterThan(0);
    expect(page.slice(at - 200, at)).toMatch(/if \(!isHydrated\) return;\s*$/);
    // …and a loaded project with no PV inverter is UNDECIDED, not "uninitialized".
    expect(page).toMatch(/if \(config\.inverters\.length === 0\) return;\s*const primary = config\.inverters\[0\];/);
  });

  it('project load: no PV inverter ⇒ no fleet entry and no partition (no even split anywhere)', () => {
    expect(page).toMatch(/if \(panelCount <= 0 \|\| _nsEndpoint\.kind === 'none'\) \{\s*patches\.inverters = \[\];/);
    expect(page).not.toMatch(/Math\.min\((panelCount|_pcPc|targetCount), 14\)/);
    expect(page).not.toMatch(/_nsPps|_rfPps|_pcPps/);
  });

  it('every hydration path drops a stored partition with no PV inverter', () => {
    expect(page.match(/withoutUnresolvedEntries\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(page).toMatch(/const _unres = withoutUnresolvedEntries\(merged\.inverters as InverterConfig\[\]\);/);
  });

  it('the PANEL COUNT FIX decides from the state it writes, and sizes only a chosen inverter', () => {
    expect(page).toMatch(/setConfig\(prev => prev\.inverters\[0\]\?\.type !== 'micro' \? prev : \(\{/);
    expect(page).toMatch(/const _pcEngStrings = resizeFleetStrings\(\{/);
    expect(page).not.toMatch(/_pcSizingInput\.selectedBrand/);
  });

  it('the runtime guard drops an endpoint-less entry instead of handing it to the 1×N re-splitter', () => {
    const at = page.indexOf('const _unresolved = withoutUnresolvedEntries(config.inverters);');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(page.indexOf('const needsElecHeal = config.inverters.some'));
  });

  it('the Auto-Apply button applies the canonical engine, not a Math.ceil split', () => {
    expect(page).not.toMatch(/Math\.round\(totalPanelsForInv \/ clampedRec\)/);
    expect(page).not.toMatch(/Math\.ceil\(totalPanelsForInv \/ autoStrings\)/);
    expect(page).toMatch(/const _autoRes = canonicalStringPartition\(\{/);
  });

  it('the page engine and its payloads consume no partition without an endpoint', () => {
    expect(page).toMatch(/const pvEndpointUnresolved = !dcLim && topology !== 'micro' && !fleet\.some\(inv => fleetEntryHasEndpoint\(inv\)\);/);
    expect(page).toMatch(/stringCount:\s+firstInv\?\.type === 'micro' \? 0 : cs\.stringCount,/);
    expect(page).not.toMatch(/: 'String Inverter',/);
    expect(page).not.toMatch(/inverterMaxDcV: invData\?\.maxDcVoltage \|\| 600/);
  });

  it('no phantom inverter row: an endpoint-less entry renders the "choose a PV inverter" state', () => {
    expect(page).toMatch(/if \(!fleetEntryHasEndpoint\(inv\)\) \{\s*return \(\s*<React\.Fragment key=\{inv\.id\}>/);
    expect(page).toMatch(/data-testid="inv-fleet-row-pending"/);
  });
});
