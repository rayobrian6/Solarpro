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

import { describe, it, expect, vi } from 'vitest';
import { assignStrings, branchPlanPanelsOf } from '../lib/stringAssignment';
import { planMicroBranches, microMaxPerBranch } from '../lib/permit/utils/branching';
import {
  resolveDesignMicro, resolveStudioMicros, engineeredMicroId, designElectricalToEngineering, buildDesignElectricalBlock,
} from '../lib/system/designToEngineering';
import { buildConductorAuthority } from '../lib/permit/utils/conductorAuthority';
import { ensureSubSystemShape } from '../lib/system/subSystemEquipment';
import { MICROINVERTERS } from '../lib/equipment-db';

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

// ============================================================================
// The studio plans with the ENGINEERED micro — Ray, 2026-09-25.
//
// The studio planned with resolveDesignMicro(its own inverter pick): IQ8+ at 13
// per branch unless that pick was a micro. E-1 plans with the micro engineering
// recorded, and on a hybrid with EACH sub's own (conductorAuthority). An IQ8M
// job's 34 panels painted 12/11/11 against E-1's 9/9/8/8; 24 fence panels on an
// engineered IQ8A painted 12/12 against 8/8/8.
// ============================================================================

/** Panels on planes of the given sizes, stamped with the given system type. */
function planes(spec: Array<[string, number, number, string]>): any[] {
  const out: any[] = [];
  let n = 0;
  spec.forEach(([planeId, count, az, systemType], pi) => {
    for (let i = 0; i < count; i++) {
      out.push({
        id: `q${n++}`, planeId, azimuth: az, systemType,
        row: Math.floor(i / 6), col: i % 6,
        lat: 38.6 + pi * 0.0003 + Math.floor(i / 6) * 0.00001, lng: -90.2 + (i % 6) * 0.00001,
      });
    }
  });
  return out;
}

/** What the studio does: resolve the per-sub micros, then plan with them. */
function studioPlan(panels: any[], keys: Array<'roof' | 'ground' | 'fence'>, engineeringConfig?: unknown, extra: Record<string, unknown> = {}) {
  const micros = resolveStudioMicros(keys, { id: 'se-7600h' }, { engineeringConfig, ...extra });
  const r = assignStrings(panels, {
    topology: 'micro', modulesPerString: 10, modulesPerDevice: 1,
    microModelId: micros[0].id, microModel: micros[0].model, microManufacturer: micros[0].manufacturer,
    microBySubSystem: Object.fromEntries(micros.map(m => [m.key, m] as const)),
  });
  return { micros, r };
}

/** The minimum PermitInput buildConductorAuthority needs — the E-1 / PV-2B plan. */
function permitInput(panels: any[], inverters: any[], subSystems?: unknown): any {
  return {
    project: { panelPositions: branchPlanPanelsOf(panels), ...(subSystems ? { subSystems } : {}) },
    system: { topology: 'microinverter', totalPanels: panels.length, totalAcKw: panels.length * 0.33, inverters },
    compliance: {},
  };
}
const permitMicro = (model: string, acOutputKw: number, subSystemKey?: string) => ({
  manufacturer: 'Enphase', model, type: 'micro', acOutputKw, strings: [],
  ...(subSystemKey ? { subSystemKey } : {}),
});

/**
 * What the engineering page posts for E-1: its HYDRATED config
 * (ensureSubSystemShape at every load boundary) — the fleet, named from the
 * catalogue and carrying the tags hydration stamped, as system.inverters, and
 * the §1.1 map as project.subSystems.
 */
function pagePermitInput(panels: any[], config: any, presentKeys: Array<'roof' | 'ground' | 'fence'>): any {
  const hyd: any = ensureSubSystemShape(config, { cadSystemType: 'roof', presentKeys });
  const inverters = (hyd.inverters ?? []).map((inv: any) => {
    const m = MICROINVERTERS.find(x => x.id === inv.inverterId)!;
    return permitMicro(m.model, m.acOutputW / 1000, inv.subSystemKey);
  });
  return permitInput(panels, inverters, hyd.subSystems);
}

/** The conductor authority's per-sub plan: [key, micro model, branch sizes]. */
const perSubPlan = (auth: any) =>
  auth.subSystems.map((s: any) => [s.key, s.equipment.inverterModel, s.microBranches.map((b: any) => b.deviceCount)]);

describe('studio branches use the ENGINEERED micro, not the studio pick', () => {
  const iq8mConfig = {
    systemType: 'roof',
    inverters: [{ id: 'inv-0', inverterId: 'enphase-iq8m', type: 'micro', strings: [{ panelCount: 34 }] }],
  };

  it('34 panels engineered on IQ8M → 9/9/8/8, exactly planMicroBranches and E-1', () => {
    const panels = planes([['r1', 15, 180, 'roof'], ['r2', 10, 90, 'roof'], ['r3', 9, 270, 'roof']]);
    const { micros, r } = studioPlan(panels, ['roof'], iq8mConfig);
    expect(micros).toEqual([{ key: 'roof', id: 'enphase-iq8m', model: 'IQ8M', manufacturer: 'Enphase', source: 'engineering' }]);
    expect(r.strings.map(s => s.panelCount)).toEqual([9, 9, 8, 8]);
    expect(r.maxPerBranch).toBe(11);

    const plan = planMicroBranches(branchPlanPanelsOf(panels), 'IQ8M', 'Enphase');
    expect(r.strings.map(s => s.panelCount)).toEqual(plan.sizes);
    for (const p of panels) expect(r.byPanelId[p.id].stringIndex, p.id).toBe(plan.assign.get(p.id));

    const auth = buildConductorAuthority(permitInput(panels, [permitMicro('IQ8M', 0.33)]), null);
    expect(auth.microBranches.map(b => b.deviceCount)).toEqual(r.strings.map(s => s.panelCount));
  });

  it('with nothing engineered it is the catalogue default, and says so', () => {
    const panels = planes([['r1', 15, 180, 'roof'], ['r2', 10, 90, 'roof'], ['r3', 9, 270, 'roof']]);
    const { micros, r } = studioPlan(panels, ['roof'], undefined);
    expect(micros[0].source).toBe('catalogue-default');
    expect(micros[0].model).toBe('IQ8+');
    expect(r.strings.map(s => s.panelCount)).toEqual([12, 11, 11]);
    // A micro the studio picked is a design pick — still not "engineering".
    expect(resolveStudioMicros(['roof'], { id: 'enphase-iq8h' }, null)[0])
      .toMatchObject({ id: 'enphase-iq8h', source: 'design-pick' });
    // …and the engineered micro outranks it.
    expect(resolveStudioMicros(['roof'], { id: 'enphase-iq8h' }, { engineeringConfig: iq8mConfig })[0])
      .toMatchObject({ id: 'enphase-iq8m', source: 'engineering' });
  });

  it('reads the fleet, then engineering_config.subSystems, then selected_equipment.subSystems — micros only', () => {
    expect(engineeredMicroId({ engineeringConfig: iq8mConfig }, 'roof', ['roof'])).toBe('enphase-iq8m');
    expect(engineeredMicroId({ engineeringConfig: { subSystems: { roof: { key: 'roof', inverterId: 'enphase-iq8a' } } } }, 'roof', ['roof']))
      .toBe('enphase-iq8a');
    expect(engineeredMicroId({ selectedEquipmentSubSystems: { roof: { key: 'roof', inverterId: 'enphase-iq8h' } } }, 'roof', ['roof']))
      .toBe('enphase-iq8h');
    // A string inverter engineered on the sub is not a micro for it.
    expect(engineeredMicroId({ engineeringConfig: { inverters: [{ inverterId: 'se-7600h', type: 'string' }] } }, 'roof', ['roof']))
      .toBeUndefined();
    expect(engineeredMicroId(null, 'roof', ['roof'])).toBeUndefined();
    expect(engineeredMicroId({ engineeringConfig: 'garbage' }, 'roof', ['roof'])).toBeUndefined();
  });

  it('the design record keeps resolveDesignMicro — only the branch PLAN takes the engineered micro', () => {
    // The block seeds engineering and the permit backfill; planning with the
    // engineered micro must not start recording it.
    const panels = planes([['r1', 15, 180, 'roof'], ['r2', 10, 90, 'roof'], ['r3', 9, 270, 'roof']]);
    const { micros, r } = studioPlan(panels, ['roof'], iq8mConfig);
    expect(micros[0].id).toBe('enphase-iq8m');
    const assignmentByPanelId: Record<string, number> = {};
    for (const id in r.byPanelId) assignmentByPanelId[id] = r.byPanelId[id].stringIndex;
    // What DesignStudio's buildDesignElectrical writes, the pick at its se-7600h default.
    const block = buildDesignElectricalBlock({
      panels, assignmentByPanelId, topology: 'micro', inverterBrand: 'Enphase', modulesPerString: 10,
      microModelId: resolveDesignMicro({ id: 'se-7600h' }).id,
      deviceCount: r.deviceCount, generatedAt: '2026-09-25T00:00:00.000Z',
    });
    expect(block.microModelId).toBe('enphase-iq8plus');
    expect(block.strings.map(s => s.panelCount)).toEqual([9, 9, 8, 8]);
    expect(designElectricalToEngineering(block).inverterId).toBe('enphase-iq8plus');
  });
});

describe('hybrid: each micro sub is planned with ITS OWN recorded micro, as E-1 plans it', () => {
  // 20 roof panels on IQ8M, 24 fence panels on IQ8A.
  const hybridPanels = () => planes([['r1', 12, 180, 'roof'], ['r2', 8, 90, 'roof'], ['f1', 24, 180, 'fence']]);
  const hybridConfig = {
    systemType: 'roof',
    inverters: [
      { id: 'inv-roof', inverterId: 'enphase-iq8m', type: 'micro', subSystemKey: 'roof', strings: [{ panelCount: 20, subSystemKey: 'roof' }] },
      { id: 'inv-fence', inverterId: 'enphase-iq8a', type: 'micro', subSystemKey: 'fence', strings: [{ panelCount: 24, subSystemKey: 'fence' }] },
    ],
  };

  it('24 fence panels on IQ8A are 8/8/8 — never 12/12 on the roof\'s micro', () => {
    const panels = hybridPanels();
    const { micros, r } = studioPlan(panels, ['roof', 'fence'], hybridConfig);
    expect(micros.map(m => [m.key, m.model, m.source])).toEqual([
      ['roof', 'IQ8M', 'engineering'], ['fence', 'IQ8A', 'engineering'],
    ]);
    expect(r.strings.map(s => s.panelCount)).toEqual([10, 10, 8, 8, 8]);
    expect(r.microPlans?.map(p => [p.key, p.model, p.maxPerBranch, p.panelCount])).toEqual([
      ['roof', 'IQ8M', 11, 20], ['fence', 'IQ8A', 11, 24],
    ]);
    // A fence panel never shares a branch with a roof panel.
    const fenceBranches = new Set(panels.filter(p => p.systemType === 'fence').map(p => r.byPanelId[p.id].stringIndex));
    const roofBranches = new Set(panels.filter(p => p.systemType === 'roof').map(p => r.byPanelId[p.id].stringIndex));
    for (const b of fenceBranches) expect(roofBranches.has(b)).toBe(false);
  });

  it('equals the conductor authority\'s per-sub plan, sub for sub', () => {
    const panels = hybridPanels();
    const { r } = studioPlan(panels, ['roof', 'fence'], hybridConfig);
    const auth = buildConductorAuthority(pagePermitInput(panels, hybridConfig, ['roof', 'fence']), null);
    expect(auth.isHybrid).toBe(true);
    expect(perSubPlan(auth)).toEqual([
      ['roof', 'IQ8M', r.strings.slice(0, 2).map(s => s.panelCount)],
      ['fence', 'IQ8A', r.strings.slice(2).map(s => s.panelCount)],
    ]);
    expect(auth.microBranches.map(b => b.deviceCount)).toEqual(r.strings.map(s => s.panelCount));
  });

  it('the fence reads its micro from the map when its fleet is gone; an untagged fleet inherits systemType', () => {
    const panels = hybridPanels();
    const config = {
      systemType: 'roof',
      inverters: [{ id: 'inv-0', inverterId: 'enphase-iq8m', type: 'micro', strings: [{ panelCount: 20 }] }],
      subSystems: { fence: { key: 'fence', inverterId: 'enphase-iq8a', topology: 'micro' } },
    };
    const { micros, r } = studioPlan(panels, ['roof', 'fence'], config);
    expect(micros.map(m => m.id)).toEqual(['enphase-iq8m', 'enphase-iq8a']);
    expect(r.strings.map(s => s.panelCount)).toEqual([10, 10, 8, 8, 8]);
    const auth = buildConductorAuthority(pagePermitInput(panels, config, ['roof', 'fence']), null);
    expect(perSubPlan(auth)).toEqual([['roof', 'IQ8M', [10, 10]], ['fence', 'IQ8A', [8, 8, 8]]]);
  });

  it('a sub with no fleet of its own plans with the micro the page\'s hydration gives it — what E-1 prints', () => {
    // No §1.1 map stored: the engineering page's ensureSubSystemShape fills one
    // entry per present sub from inverters[0] and posts it as project.subSystems,
    // so E-1 plans the fence on the fleet's IQ8M. Reading the raw row, the studio
    // planned it on the catalogue IQ8+ (12/12) and called that "not engineered".
    const panels = hybridPanels();
    const config = { systemType: 'roof', inverters: [hybridConfig.inverters[0]] };
    const { micros, r } = studioPlan(panels, ['roof', 'fence'], config);
    expect(micros.map(m => [m.key, m.model, m.source])).toEqual([
      ['roof', 'IQ8M', 'engineering'], ['fence', 'IQ8M', 'engineering'],
    ]);
    expect(r.strings.map(s => s.panelCount)).toEqual([10, 10, 8, 8, 8]);
    const auth = buildConductorAuthority(pagePermitInput(panels, config, ['roof', 'fence']), null);
    expect(perSubPlan(auth)).toEqual([['roof', 'IQ8M', [10, 10]], ['fence', 'IQ8M', [8, 8, 8]]]);
    expect(auth.microBranches.map(b => b.deviceCount)).toEqual(r.strings.map(s => s.panelCount));
  });

  it('a degenerate single migration map is re-synthesised per sub as the page does — and warns once, not per sub', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const panels = hybridPanels();
      // The pre-contract collapse: the whole fleet under the fence, one 'migration' entry.
      const config = {
        systemType: 'fence',
        inverters: [{ id: 'inv-0', inverterId: 'enphase-iq8m', type: 'micro', strings: [{ panelCount: 24 }] }],
        subSystems: {
          fence: { key: 'fence', inverterId: 'enphase-iq8m', topology: 'micro', source: 'migration', updatedAt: '2026-01-01T00:00:00.000Z' },
        },
      };
      const { micros, r } = studioPlan(panels, ['roof', 'fence'], config);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(micros.map(m => [m.key, m.model, m.source])).toEqual([
        ['roof', 'IQ8M', 'engineering'], ['fence', 'IQ8M', 'engineering'],
      ]);
      expect(r.microPlans?.map(p => [p.key, p.maxPerBranch])).toEqual([['roof', 11], ['fence', 11]]);
      const auth = buildConductorAuthority(pagePermitInput(panels, config, ['roof', 'fence']), null);
      expect(perSubPlan(auth)).toEqual([['roof', 'IQ8M', [10, 10]], ['fence', 'IQ8M', [8, 8, 8]]]);
      expect(auth.microBranches.map(b => b.deviceCount)).toEqual(r.strings.map(s => s.panelCount));
    } finally {
      warn.mockRestore();
    }
  });

  it('a sub engineering has recorded no micro for falls back to the catalogue default, labelled', () => {
    const panels = hybridPanels();
    // The fence is on the §1.1 map, drawn before its equipment was picked.
    const { micros, r } = studioPlan(panels, ['roof', 'fence'], {
      systemType: 'roof',
      inverters: [hybridConfig.inverters[0]],
      subSystems: {
        roof: { key: 'roof', inverterId: 'enphase-iq8m', topology: 'micro', source: 'engineering', updatedAt: '2026-09-25T00:00:00.000Z' },
        fence: { key: 'fence', source: 'engineering', updatedAt: '2026-09-25T00:00:00.000Z' },
      },
    });
    expect(micros.map(m => [m.key, m.model, m.source])).toEqual([
      ['roof', 'IQ8M', 'engineering'], ['fence', 'IQ8+', 'catalogue-default'],
    ]);
    expect(r.strings.map(s => s.panelCount)).toEqual([10, 10, 12, 12]);
    // Nothing engineered at all: every sub is the catalogue default.
    expect(studioPlan(panels, ['roof', 'fence'], undefined).micros.map(m => m.source))
      .toEqual(['catalogue-default', 'catalogue-default']);
  });

  it('one micro on every sub plans byte-identically to planMicroBranches over the whole array', () => {
    const panels = hybridPanels();
    const same = { id: 'enphase-iq8plus', model: 'IQ8+', manufacturer: 'Enphase' };
    const r = assignStrings(panels, {
      topology: 'micro', modulesPerString: 10, modulesPerDevice: 1,
      microModelId: same.id, microModel: same.model, microManufacturer: same.manufacturer,
      microBySubSystem: { roof: same, fence: same },
    });
    const plan = planMicroBranches(branchPlanPanelsOf(panels), 'IQ8+', 'Enphase');
    expect(r.strings.map(s => s.panelCount)).toEqual(plan.sizes.filter(n => n > 0));
    for (const p of panels) expect(r.byPanelId[p.id].stringIndex, p.id).toBe(plan.assign.get(p.id));
  });
});
