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
