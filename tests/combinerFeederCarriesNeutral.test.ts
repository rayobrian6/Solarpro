// ============================================================================
// The Envoy feeder carries a NEUTRAL — Ray, 2026-09-25.
//
// "The envoy to disconnect is wrong. It needs to carry a neutral."
//
// The engine already pulled one: COMBINER_TO_DISCO_RUN's bundle is BLK + RED +
// WHT (role NEUTRAL_IMBALANCE_ONLY) + GRN, conduit fill and both BOMs count
// it. Only the LABEL dropped it — buildConductorCallout counted
// current-carrying conductors (the DERATING count, where an imbalance-only
// neutral correctly does not count, NEC 310.15(E)(1)) and printed "2×#8". The
// disconnect → MSP run read "3×#8" only because its neutral was never given a
// role. The permit E-1 (no engine runs) printed "3#…" but drew no N line.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeSystem } from '../lib/computed-system';
import { buildConductorCallout, conductorBundle, isGroundingConductor } from '../lib/segment-schedule';
import { renderSLDProfessional, type SLDProfessionalInput } from '../lib/sld-professional-renderer';
import { csMicroInput, csStringInput } from './goldens/wave0-fixtures';

const micro32 = () => computeSystem({
  ...csMicroInput(), totalPanels: 32, inverterModel: 'IQ8+', inverterAcKw: 0.29, inverterBranchLimit: 16,
} as any);

const lead = (callout?: string) => (callout ?? '').split('\n')[0];
const leadingCount = (callout?: string) => Number(/^(\d+)×/.exec(lead(callout))?.[1] ?? NaN);

describe('the combiner → disconnect feeder is L1 + L2 + N', () => {
  it('its callout counts the neutral (3×), matching the bundle, fill and BOM count', () => {
    const cs = micro32();
    const run = cs.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    expect(run).toBeTruthy();
    expect(lead(run.conductorCallout)).toMatch(/^3×#\d+ THWN-2$/);
    expect(run.conductorBundle?.some(c => c.color === 'WHT')).toBe(true);
    expect(run.conductorCount).toBe(3);
    expect(run.neutralRequired).toBe(true);
  });

  it('the neutral is still NOT a current-carrying conductor for derating (310.15(E)(1))', () => {
    const cs = micro32();
    const run = cs.runs.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    const wht = run.conductorBundle!.find(c => c.color === 'WHT')!;
    expect(wht.role).toBe('NEUTRAL_IMBALANCE_ONLY');
    expect(wht.isCurrentCarrying).toBe(false);
  });

  it('feeder label count == installed count, on every feeder run', () => {
    const cs = micro32();
    for (const id of ['COMBINER_TO_DISCO_RUN', 'DISCO_TO_METER_RUN']) {
      const run = cs.runs.find(r => r.id === id);
      if (!run) continue;
      const installed = (run.conductorBundle ?? []).filter(c => !isGroundingConductor(c)).reduce((n, c) => n + c.qty, 0);
      expect(leadingCount(run.conductorCallout), id).toBe(installed);
    }
  });

  it('IQ Cable branch circuits stay two-wire (L1, L2) — no neutral on a branch', () => {
    const cs = micro32();
    for (const b of cs.microBranches) expect(lead(b.conductorCallout)).toMatch(/^2×#\d+ THWN-2$/);
    const homerun = cs.segmentSchedule.find(s => s.segmentType === 'JBOX_TO_COMBINER');
    if (homerun) expect(homerun.conductorBundle.some(c => c.color === 'WHT')).toBe(false);
  });

  it('string jobs are unchanged (no neutral in the bundle → none printed)', () => {
    const cs = computeSystem(csStringInput());
    const run = cs.runs.find(r => r.id === 'INV_TO_DISCO_RUN')!;
    expect(lead(run.conductorCallout)).toMatch(/^2×#\d+ THWN-2$/);
  });
});

describe('buildConductorCallout — installed count, grouped by gauge', () => {
  it('counts an imbalance-only neutral and prints a reduced neutral as its own group', () => {
    const same = [
      conductorBundle({ qty: 1, gauge: '#8 AWG', color: 'BLK', insulation: 'THWN-2', role: 'LINE', currentPerConductor: 30 }),
      conductorBundle({ qty: 1, gauge: '#8 AWG', color: 'RED', insulation: 'THWN-2', role: 'LINE', currentPerConductor: 30 }),
      conductorBundle({ qty: 1, gauge: '#8 AWG', color: 'WHT', insulation: 'THWN-2', role: 'NEUTRAL_IMBALANCE_ONLY', currentPerConductor: 0 }),
      conductorBundle({ qty: 1, gauge: '#10 AWG', color: 'GRN', insulation: 'THWN-2', role: 'EQUIPMENT_GROUNDING', currentPerConductor: 0 }),
    ];
    expect(buildConductorCallout(same, '3/4"', 'EMT', false)).toBe('3×#8 THWN-2\n1×#10 GRN EGC\nIN 3/4" EMT');
    const reduced = [...same.slice(0, 2),
      conductorBundle({ qty: 1, gauge: '#10 AWG', color: 'WHT', insulation: 'THWN-2', role: 'NEUTRAL_IMBALANCE_ONLY', currentPerConductor: 0 }),
      same[3]];
    expect(lead(buildConductorCallout(reduced, '3/4"', 'EMT', false))).toBe('2×#8 THWN-2 + 1×#10 THWN-2 (N)');
  });
});

// ── The drawings ─────────────────────────────────────────────────────────────
const BASE = {
  projectName: 'NEUTRAL', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275', designer: 'T',
  drawingDate: '2026-09-25', drawingNumber: 'N-1', revision: 'A', scale: 'NOT TO SCALE',
  panelModel: 'Tesla TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
  dcWireGauge: '#10', dcConduitType: 'EMT', mainPanelAmps: 200, utilityName: 'Ameren', interconnection: 'LOAD_SIDE',
  hasProductionMeter: false, hasBattery: false, batteryModel: '', batteryKwh: 0,
};
const microSld = (over: Partial<SLDProfessionalInput> = {}): SLDProfessionalInput => ({
  ...BASE, topologyType: 'MICROINVERTER', ecosystemTopology: 'micro', selectedBrand: 'enphase',
  integratedDcDisconnect: false, totalModules: 32, totalStrings: 0, deviceCount: 32,
  dcOCPD: 0, inverterModel: 'IQ8+', inverterManufacturer: 'Enphase',
  acOutputKw: 9.28, acOutputAmps: 38.7, acWireGauge: '#8', acConduitType: 'EMT',
  acOCPD: 50, backfeedAmps: 50, rapidShutdownIntegrated: true, ...over,
} as SLDProfessionalInput);
const stringSld = (): SLDProfessionalInput => ({
  ...BASE, topologyType: 'STRING_INVERTER', ecosystemTopology: 'string', selectedBrand: 'fronius',
  integratedDcDisconnect: false, totalModules: 20, totalStrings: 2, dcOCPD: 20,
  inverterModel: 'Primo 8.2-1', inverterManufacturer: 'Fronius',
  acOutputKw: 7.6, acOutputAmps: 31.7, acWireGauge: '#8', acConduitType: 'EMT',
  acOCPD: 40, backfeedAmps: 40, rapidShutdownIntegrated: false,
} as SLDProfessionalInput);

describe('the SLD draws and labels the neutral', () => {
  it('engineering SLD (engine runs): feeder reads 3×, never 2×; disconnect shows the unswitched N', () => {
    const cs = micro32();
    const svg = renderSLDProfessional(microSld({ runs: cs.runs, microBranches: cs.microBranches } as any));
    expect(svg).toMatch(/3×#\d+ THWN-2/);
    expect(svg).not.toMatch(/>2×#8 THWN-2</);
    expect(svg).toContain('N — UNSWITCHED');
  });

  it('permit E-1 style (no runs): a micro feeder still draws the neutral through the disconnect', () => {
    expect(renderSLDProfessional(microSld())).toContain('N — UNSWITCHED');
  });

  it('a string job draws no neutral pass-through (its feeder has none to buy)', () => {
    expect(renderSLDProfessional(stringSld())).not.toContain('N — UNSWITCHED');
  });
});
