// ============================================================================
// Design Studio micro groups ARE the plan set's AC branches — Ray, 2026-09-25.
//
// The studio chunked micro panels by its "Modules / string" number (default
// 10, up to 30; the Melvin fixture stores 14 — over the IQ8+ max of 13) and
// labelled them "String N", while the plan set's E-1 drew 11/11/10 from
// planMicroBranches. Now micro groups come from the SAME planner with the SAME
// panel projection the permit payload sends, so the studio shows the branches
// the drawings will print.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { assignStrings, branchPlanPanelsOf } from '../lib/stringAssignment';
import { planMicroBranches, microMaxPerBranch } from '../lib/permit/utils/branching';
import { resolveDesignMicro } from '../lib/system/designToEngineering';

// 32 panels on three planes (15 / 10 / 7), with the stamps a placed panel carries.
function layout(): any[] {
  const out: any[] = [];
  const planes: Array<[string, number, number]> = [['plane-a', 15, 180], ['plane-b', 10, 90], ['plane-c', 7, 270]];
  let n = 0;
  planes.forEach(([planeId, count, az], pi) => {
    for (let i = 0; i < count; i++) {
      out.push({
        id: `p${n++}`, planeId, azimuth: az, systemType: 'roof',
        row: Math.floor(i / 5), col: i % 5,
        lat: 38.6 + pi * 0.0002 + Math.floor(i / 5) * 0.00001, lng: -90.2 + (i % 5) * 0.00001,
      });
    }
  });
  return out;
}

const micro = (panels: any[], model: string, mfr: string, extra: Record<string, unknown> = {}) =>
  assignStrings(panels, { topology: 'micro', modulesPerString: 10, modulesPerDevice: 1,
    microModelId: 'x', microModel: model, microManufacturer: mfr, ...extra });

describe('studio micro groups == plan-set branches', () => {
  it('32 × IQ8+ → Branch 1..3 of 11/11/10, panel-for-panel the plan set\'s assignment', () => {
    const panels = layout();
    const r = micro(panels, 'IQ8+', 'Enphase');
    expect(r.strings.map(s => s.panelCount)).toEqual([11, 11, 10]);
    expect(r.strings.map(s => s.label)).toEqual(['Branch 1', 'Branch 2', 'Branch 3']);
    expect(r.maxPerBranch).toBe(13);
    const plan = planMicroBranches(branchPlanPanelsOf(panels), 'IQ8+', 'Enphase');
    for (const p of panels) expect(r.byPanelId[p.id].stringIndex, p.id).toBe(plan.assign.get(p.id));
  });

  it('no group exceeds the per-model max, whatever Modules/string or paint overrides say', () => {
    const panels = layout();
    for (const [model, mfr] of [['IQ8+', 'Enphase'], ['IQ8A', 'Enphase'], ['IQ8H', 'Enphase'], ['IQ8M', 'Enphase']]) {
      const max = microMaxPerBranch(model, mfr);
      for (const mps of [10, 14, 30]) {
        const r = micro(panels, model, mfr, { modulesPerString: mps, overrides: { p0: 0, p1: 0, p2: 0, p20: 0 } });
        expect(Math.max(...r.strings.map(s => s.panelCount)), `${model} mps=${mps}`).toBeLessThanOrEqual(max);
        expect(r.strings.reduce((s, x) => s + x.panelCount, 0)).toBe(32);
      }
    }
  });

  it('string and optimizer grouping is unchanged (Modules/string chunks, per plane)', () => {
    const panels = layout();
    const s = assignStrings(panels, { topology: 'string', modulesPerString: 10 });
    expect(s.strings.map(x => x.panelCount)).toEqual([10, 5, 10, 7]);
    expect(s.strings[0].label).toBe('String 1');
    expect(s.maxPerBranch).toBeUndefined();
  });

  it('the studio never plans or records a string inverter as the micro', () => {
    expect(resolveDesignMicro({ id: 'se-7600h' }).id).toBe('enphase-iq8plus');
    expect(resolveDesignMicro({ id: 'enphase-iq8a' }).model).toBe('IQ8A');
    expect(resolveDesignMicro(null).manufacturer).toBe('Enphase');
  });
});
