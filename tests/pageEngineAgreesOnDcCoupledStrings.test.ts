// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE PAGE'S ENGINE AND THE SHEET DERIVE THE SAME STRINGS FOR A DC-COUPLED JOB.
//
// The engineering page's `computeSystem` input took every DC limit from the first inverter in the
// fleet and defaulted it when there was none: 600 V max, a 100–480 V MPPT window, 2 channels, a
// 400 W / 41.6 V module. On Ray's DC-coupled job (no standalone inverter, by decision) that sized
// the Sizing tab's and the summary's strings against equipment the design does not have, while the
// SLD route sized them against the Powerwall 3's published PV input.
//
// The page now passes the canonical coupling and `dcStringLimits` — the same window both SLD routes
// use — and the Design array's module. This drives `computeSystem` with exactly the fields the page
// builds and asserts it lands inside the Powerwall 3 window and covers all 37 modules, with the
// control that the old defaulted input does NOT (so the guard can see the defect it exists for).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { computeSystem, type ComputedSystemInput } from '@/lib/computed-system';
import { dcStringLimits } from '@/lib/electrical/dcStringLimits';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';

const topo = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
const pv = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const m = pv.module!;

function pageInput(dc: ReturnType<typeof dcStringLimits>, coupling: ComputedSystemInput['solarCoupling']): ComputedSystemInput {
  return {
    topology: 'string', solarCoupling: coupling, totalPanels: pv.moduleCount!,
    panelWatts: m.watts, panelVoc: m.voc, panelIsc: m.isc, panelVmp: m.vmp, panelImp: m.imp,
    panelTempCoeffVoc: m.tempCoeffVoc, panelTempCoeffIsc: m.tempCoeffIsc, panelMaxSeriesFuse: m.maxSeriesFuseRating,
    panelModel: m.model, panelManufacturer: m.manufacturer,
    inverterManufacturer: '', inverterModel: '⚠ INVERTER NOT SELECTED', inverterAcKw: 7.6, inverterCount: 1,
    inverterMaxDcV: dc?.maxDcVoltage ?? 600, inverterMpptVmin: dc?.mpptVoltageMin ?? 100,
    inverterMpptVmax: dc?.mpptVoltageMax ?? 480, inverterMaxInputCurrentPerMppt: dc?.maxInputCurrentPerMppt ?? 13.5,
    inverterMpptChannels: dc?.mpptChannels ?? 2, inverterAcCurrentMax: 32,
    inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: -22, ambientTempC: 33, rooftopTempAdderC: 0,
    runLengths: {}, conduitType: 'EMT', mainPanelAmps: 400, mainPanelBrand: 'Eaton', panelBusRating: 200,
    interconnectionMethod: 'UNRESOLVED', systemType: 'fence',
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3, batteryIds: [],
  } as ComputedSystemInput;
}

describe('the page engine on Ray\'s DC-coupled job', () => {
  const dc = dcStringLimits(topo as never, 'dc-coupled-storage');

  it('the storage publishes the DC window the page now passes', () => {
    expect(dc).not.toBeNull();
    expect(dc!.maxDcVoltage).toBeLessThanOrEqual(600);
    expect(dc!.mpptChannels).toBeGreaterThanOrEqual(6);
  });

  it('strings cover exactly the 37 Design modules and stay inside the Powerwall 3 input maximum', () => {
    const cs = computeSystem(pageInput(dc, 'dc-coupled-storage'));
    const counts = cs.strings.map(s => s.panelCount);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(37);
    for (const s of cs.strings) expect(s.vocCorrected * s.panelCount).toBeLessThanOrEqual(dc!.maxDcVoltage + 1e-6);
    expect(cs.topology).toBe('DC_COUPLED_BATTERY');
  });

  it('control: the old defaulted input (600 V phantom inverter) sizes strings the Powerwall 3 cannot accept', () => {
    const cs = computeSystem(pageInput(null, null));
    const worst = Math.max(...cs.strings.map(s => s.vocCorrected * s.panelCount));
    expect(worst, 'without the storage window the page sized strings past 550 V').toBeGreaterThan(550);
  });
});

describe('…and the page hands the engine NOTHING that overrides that derivation (production-build finding)', () => {
  // On the production build, Ray's job showed "String 1 (20 modules) · String 2 (17 modules)" in System
  // Config while the sheet drew 9 / 9 / 9 / 8 / 2: the page passed the fleet's stored string lengths
  // (sized for no device) as `configStringPanelCounts`, which the engine adopts verbatim.
  const dc = dcStringLimits(topo as never, 'dc-coupled-storage');

  it('control: handed the stale 20 / 17 layout, the engine adopts it — past the Powerwall 3 window', () => {
    const cs = computeSystem({ ...pageInput(dc, 'dc-coupled-storage'), totalStrings: 2, configStringPanelCounts: [20, 17] });
    expect(cs.strings.map(x => x.panelCount)).toEqual([20, 17]);
    expect(Math.max(...cs.strings.map(x => x.vocCorrected * x.panelCount))).toBeGreaterThan(dc!.maxDcVoltage);
  });

  it('ONE partitioner: the page hands the engine the SLD route\'s own derivation (9 / 9 / 9 / 8 / 2)', async () => {
    // The production page, once it stopped adopting 20 / 17, derived 7 / 7 / 7 / 7 / 9 itself while the
    // sheet drew 9 / 9 / 9 / 8 / 2 — two partitioners. The page now calls the route's derivation.
    const { deriveStorageDcStrings } = await import('@/lib/electrical/storageDcStrings');
    const counts = deriveStorageDcStrings({ moduleCount: 37, module: m, limits: dc!, designTempMin: -22 });
    expect(counts).toEqual([9, 9, 9, 8, 2]);   // what tests/designArrayReachesTheSheet sees on the sheet
    const cs = computeSystem({ ...pageInput(dc, 'dc-coupled-storage'), totalStrings: counts!.length, configStringPanelCounts: counts! });
    expect(cs.strings.map(x => x.panelCount)).toEqual([9, 9, 9, 8, 2]);
    // Control: left to itself the engine partitions differently — the disagreement this closes.
    expect(computeSystem(pageInput(dc, 'dc-coupled-storage')).strings.map(x => x.panelCount)).not.toEqual([9, 9, 9, 8, 2]);
  });

  it('the page passes no fleet layout and no fleet module when the strings land on the storage', () => {
    const page = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));
    expect(page).toMatch(/totalStrings: dcLim\s*\?\s*dcStrings\?\.length/);
    expect(page).toMatch(/configStringPanelCounts: dcLim\s*\?\s*\(dcStrings \?\? undefined\)/);
    expect(page).toMatch(/const dcStrings: number\[\] \| null = dcLim && panelData && csPanels > 0\s*\?\s*deriveStorageDcStrings\(/);
    expect(page).toMatch(/const panelData = dcLim \? \(pvModule \?\? strPanel\) : \(strPanel \?\? pvModule\);/);
    // …and the SLD request carries no brand to size a phantom inverter from.
    expect(page).toMatch(/selectedBrand:\s+pvOnStorageDc \? undefined : config\.selectedBrand,/);
  });
});
