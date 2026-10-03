// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A COMMERCIAL SERVICE IS NOT A HOUSE, AND NOTHING MAY QUIETLY TURN IT INTO ONE.
//
// Gauntlet step 15: structural readiness for three-phase / commercial services. SolarPro does not
// engineer them yet, and this file does not pretend it does. It proves three narrower things:
//
//   1. The graph can REPRESENT them: 277/480 V wye, 240 V delta, 120/240 V high-leg delta and an
//      'Other / custom' system all survive save → reload with their phase and voltage intact.
//   2. Nothing COERCES them. The stored-graph reader used to turn every phase it did not recognise
//      into 'split-240' (and the voltage into 240), so a commercial service reloaded as a house. An
//      unrecognised phase now reads back as 'custom'; only an ABSENT phase means split phase.
//   3. The engineering is HONEST about them. Every phase-dependent check on a system whose method is
//      not implemented reads NOT_EVALUATED — "CALCULATION METHOD NOT YET SUPPORTED" — naming the
//      system, so a three-phase service can never fold to PASS on residential rules.
//
// Measured before writing the gate: `evaluateServiceTopology` never reads `service.voltage` and never
// derives a current from a power. Its ampere comparisons (branch sum, busbar 705.12(B), OCPDs, SCCR)
// are the same arithmetic on any system and stay evaluated. What is residential is the system-level
// method itself, the NEC 220.82 dwelling calculation (120/240 V or 208Y/120 V three-wire only) and
// a bonding model that assumes a neutral. Those are the checks asserted below.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildCommercial480Wye, buildCommercialService,
} from '@/lib/electrical/fixtures/commercial480Wye';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import {
  evaluateServiceTopology, servicePhaseInfo, serviceRatingLabel, SERVICE_PHASES,
  type ServiceTopology, type TopologyCheck,
} from '@/lib/electrical/serviceTopology';
import { createServiceTopology, setPanelLoad } from '@/lib/electrical/topologyAuthoring';
import {
  parseServiceTopology, serialiseServiceTopology, type ServiceTopologyReadMode,
} from '@/lib/db/serviceTopology';
import { buildServiceOverview } from '@/lib/electrical/topologyOverview';

const NOT_SUPPORTED = 'CALCULATION METHOD NOT YET SUPPORTED';

/** Through JSON, exactly as the column stores it. */
const roundTrip = (t: ServiceTopology, mode: ServiceTopologyReadMode = 'active'): ServiceTopology =>
  parseServiceTopology(JSON.parse(JSON.stringify(serialiseServiceTopology(t))), mode)!.topology;

/** A stored commercial graph with its service edited the way a newer build or a hand edit would. */
function storedWithService(patch: Record<string, unknown>, drop: string[] = []): unknown {
  const raw = JSON.parse(JSON.stringify(serialiseServiceTopology(buildCommercial480Wye().topology)));
  Object.assign(raw.topology.service, patch);
  for (const k of drop) delete raw.topology.service[k];
  return raw;
}

const check = (t: ServiceTopology, id: string): TopologyCheck | undefined =>
  evaluateServiceTopology(t).checks.find(c => c.id === id);

/** Checks that are not the honest "not supported" answer — the ones that actually ran. */
const ranChecks = (t: ServiceTopology): TopologyCheck[] =>
  evaluateServiceTopology(t).checks.filter(c => !c.detail.includes(NOT_SUPPORTED));

/** Wording only a residential formula would produce. */
const RESIDENTIAL_WORDING = /\b240\s?V\b|120\/240|split[\s-]phase|\b1Ø/i;

describe('the descriptor: one label table for every surface', () => {
  it('names each system the way an installer does', () => {
    expect(SERVICE_PHASES.map(p => servicePhaseInfo(p).label)).toEqual([
      '120/240 V split phase', '120/208 V 3φ wye', '277/480 V 3φ wye', '240 V 3φ delta',
      '120/240 V high-leg delta', 'Other / custom',
    ]);
    expect(SERVICE_PHASES.filter(p => servicePhaseInfo(p).residentialSplitPhase)).toEqual(['split-240']);
    expect(servicePhaseInfo('delta-240')).toMatchObject({ phaseCount: 3, lineToLineV: 240, hasNeutral: false });
    expect(servicePhaseInfo('custom')).toMatchObject({ phaseCount: null, lineToLineV: null, hasNeutral: null });
  });

  it('🚨 the authoring voltage follows the phase instead of defaulting to 240', () => {
    expect(createServiceTopology({ ratedAmps: 800, phase: 'wye-480' }).service.voltage).toBe(480);
    expect(createServiceTopology({ ratedAmps: 400, phase: 'wye-208' }).service.voltage).toBe(208);
    expect(createServiceTopology({ ratedAmps: 200 }).service).toMatchObject({ phase: 'split-240', voltage: 240 });
  });
});

describe('(a) serialise → parse keeps the system', () => {
  it('🚨 800 A 277/480 V wye comes back as 800 A 277/480 V wye, on every read mode', () => {
    const { topology } = buildCommercial480Wye();
    expect(topology.service).toMatchObject({ ratedAmps: 800, voltage: 480, phase: 'wye-480' });
    for (const mode of ['active', 'as-issued', 'as-sent'] as const) {
      const back = roundTrip(topology, mode);
      expect(back.service, mode).toMatchObject({ ratedAmps: 800, voltage: 480, phase: 'wye-480' });
      expect(back.generation.map(g => g.label), mode).toEqual(['PV inverter (three-phase)']);
    }
  });

  it.each(['delta-240', 'high-leg-delta-240'] as const)('%s survives the round trip', phase => {
    const back = roundTrip(buildCommercialService({ phase }).topology);
    expect(back.service).toMatchObject({ phase, voltage: 240, ratedAmps: 800 });
  });

  it('an "Other / custom" system keeps its own voltage', () => {
    const back = roundTrip(buildCommercialService({ phase: 'custom', voltage: 600 }).topology);
    expect(back.service).toMatchObject({ phase: 'custom', voltage: 600 });
  });
});

describe('(b) 🚨 an unrecognised stored phase is NOT split phase', () => {
  it.each(['corner-grounded-delta-480', 'wye-600', 'WYE-480', '3-phase', '', 480])(
    'stored phase %j reads back as custom and keeps its voltage', phase => {
      const back = parseServiceTopology(storedWithService({ phase }))!.topology;
      expect(back.service.phase).toBe('custom');
      expect(back.service.phase).not.toBe('split-240');
      expect(back.service.voltage).toBe(480);
      // And the reloaded graph is engineered as an unknown system, not as a house.
      expect(check(back, 'service.calculation-method')?.conclusion).toBe('NOT_EVALUATED');
    });
});

describe('(c) control: an ABSENT phase is a legacy residential graph', () => {
  it('no phase, no voltage → 120/240 V split phase, exactly as before', () => {
    const back = parseServiceTopology(storedWithService({}, ['phase', 'voltage']))!.topology;
    expect(back.service).toMatchObject({ phase: 'split-240', voltage: 240 });
    expect(check(back, 'service.calculation-method')).toBeUndefined();
  });

  it('a null phase is absent too, and a stored voltage is still kept', () => {
    const back = parseServiceTopology(storedWithService({ phase: null, voltage: 240 }))!.topology;
    expect(back.service).toMatchObject({ phase: 'split-240', voltage: 240 });
  });

  it('a known phase with no stored voltage takes the voltage the phase implies', () => {
    const back = parseServiceTopology(storedWithService({ phase: 'wye-208' }, ['voltage']))!.topology;
    expect(back.service).toMatchObject({ phase: 'wye-208', voltage: 208 });
  });
});

describe('(d) 🚨 the 800 A 277/480 V fixture is never evaluated as a 240 V house', () => {
  const { topology, switchboardId } = buildCommercial480Wye();

  it('the system-level method is NOT_EVALUATED, named, and keeps the job from folding to PASS', () => {
    const ev = evaluateServiceTopology(topology);
    const c = ev.checks.find(x => x.id === 'service.calculation-method');
    expect(c?.conclusion).toBe('NOT_EVALUATED');
    expect(c?.detail).toContain(NOT_SUPPORTED);
    expect(c?.detail).toContain('277/480 V 3φ wye');
    expect(c?.requires).toEqual(['calculation-method:wye-480']);
    expect(ev.overall).not.toBe('PASS');
  });

  it('the service reads 800 A, never 200 A', () => {
    expect(serviceRatingLabel(topology)).toBe('800 A');
    const sum = check(topology, 'service.branch-sum');
    expect(sum?.conclusion).toBe('PASS');
    expect(sum?.detail).toContain('800 A service');
    expect(evaluateServiceTopology(topology).checks.filter(c => /\b200 A\b/.test(c.detail))).toEqual([]);
  });

  it('no check that actually ran used 240 V or split-phase wording', () => {
    expect(ranChecks(topology).filter(c => RESIDENTIAL_WORDING.test(c.detail)).map(c => c.id))
      .toEqual([]);
  });

  it('bonding IS supported on a four-wire wye: it has a neutral, and the bond follows the disconnect', () => {
    const c = check(topology, 'bonding.location');
    expect(c?.conclusion).toBe('PASS');
    expect(c?.detail).toContain('800 A main service disconnect');
  });

  it('🚨 an NEC 220.82 dwelling load model is not passed on this system, nor is anything summed from it', () => {
    // `setPanelLoad` creates the model as 220.82 unless told otherwise — the residential default.
    const t = setPanelLoad(topology, switchboardId, 500);
    expect(t.loads?.method).toBe('optional-220-82');
    for (const id of ['load.calculation', 'service.demand', 'branch.demand']) {
      const c = check(t, id);
      expect(c?.conclusion, id).toBe('NOT_EVALUATED');
      expect(c?.detail, id).toContain(NOT_SUPPORTED);
      expect(c?.detail, id).toContain('220.82');
    }
  });

  it('control: a Part III load model is not voltage-scoped, so the demand still evaluates', () => {
    const t = setPanelLoad(topology, switchboardId, 500, { method: 'standard-220-part-iii' });
    expect(check(t, 'load.calculation')?.conclusion).toBe('PASS');
    expect(check(t, 'service.demand')?.conclusion).toBe('PASS');
    expect(check(t, 'service.demand')?.detail).toContain('800 A service');
  });

  it('the needs-input screen files it as not-yet-supported, in words, not as a label to go and read', () => {
    const o = buildServiceOverview(topology);
    expect(o.summary.phaseLabel).toBe('277/480 V 3φ wye');
    const item = o.requiredInputs.find(i => i.key === 'calculation-method:wye-480');
    expect(item?.owner).toBe('not-yet-supported');
    expect(item?.label).toBe('Calculation method for 277/480 V 3φ wye (not yet supported)');
  });
});

describe('(e) delta and custom: the same honesty', () => {
  it.each([
    ['delta-240', '240 V 3φ delta', 'This system has no neutral conductor.'],
    ['custom', 'Other / custom', 'Whether this system has a neutral conductor is not recorded.'],
  ] as const)('%s', (phase, label, bondingReason) => {
    const { topology } = buildCommercialService({ phase, ...(phase === 'custom' ? { voltage: 600 } : {}) });
    const method = check(topology, 'service.calculation-method');
    expect(method?.conclusion).toBe('NOT_EVALUATED');
    expect(method?.detail).toContain(`${NOT_SUPPORTED} — ${label}.`);

    const bonding = check(topology, 'bonding.location');
    expect(bonding?.conclusion).toBe('NOT_EVALUATED');
    expect(bonding?.detail).toContain(NOT_SUPPORTED);
    expect(bonding?.detail).toContain(bondingReason);

    expect(serviceRatingLabel(topology)).toBe('800 A');
    expect(evaluateServiceTopology(topology).overall).not.toBe('PASS');
    expect(ranChecks(topology).filter(c => RESIDENTIAL_WORDING.test(c.detail)).map(c => c.id))
      .toEqual([]);
  });

  it('every non-split system gets the method check; a high-leg delta keeps its (neutral) bonding', () => {
    for (const phase of SERVICE_PHASES.filter(p => p !== 'split-240')) {
      const { topology } = buildCommercialService({ phase, ...(phase === 'custom' ? { voltage: 600 } : {}) });
      expect(check(topology, 'service.calculation-method')?.conclusion, phase).toBe('NOT_EVALUATED');
    }
    expect(check(buildCommercialService({ phase: 'high-leg-delta-240' }).topology, 'bonding.location')
      ?.conclusion).toBe('PASS');
  });
});

describe('control: the residential evaluation is untouched', () => {
  it('the 200 A house carries no not-supported check, and its 220.82 load model still passes', () => {
    const { topology } = buildNormalResidence200A();
    expect(evaluateServiceTopology(topology).checks.filter(c => c.detail.includes(NOT_SUPPORTED)))
      .toEqual([]);
    const msp = topology.panels[0].id;
    expect(check(setPanelLoad(topology, msp, 120), 'load.calculation')?.conclusion).toBe('PASS');
  });
});
