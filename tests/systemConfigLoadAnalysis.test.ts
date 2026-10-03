// ═══════════════════════════════════════════════════════════════════════════
// The optional full load analysis in System Config — `lib/electrical/systemConfigLoadAnalysis.ts`.
//
// Ray's law, each a case below:
//   · OPTIONAL: absent, it is a known fact, never a question, and never a release blocker.
//   · ASKED ONCE: one figure per panelboard; path and system figures are SUMS (resolveDemands).
//   · A PARTIAL MODEL IS NOT A SMALLER LOAD: no subtotal, ever.
//   · Present and read by a check ⇒ the item states that check's conclusion, FAIL included.
//   · The method is the installer's, and a method the electrical system cannot use is not offered.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { buildSystemConfigInterview, type InterviewInput } from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerElectricalSystem, answerDistribution, answerInterconnection,
  answerIsolationRequired, answerAvailableFaultCurrent, answerPanel,
} from '@/lib/electrical/systemConfigAnswers';
import {
  buildLoadAnalysisItems, describeLoadAnalysis, loadMethodChoices, loadMethodUnavailableBecause,
  answerLoadAnalysisMethod, answerPanelDemand, answerRemoveLoadAnalysis,
  LOAD_ANALYSIS_ITEM_ID, LOAD_CONSUMING_CHECK_IDS, RECORDED_DEMAND_ITEM_ID,
} from '@/lib/electrical/systemConfigLoadAnalysis';
import { addProtectiveDevice, setSolarCoupling, updatePanel } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import {
  evaluateServiceTopology, SERVICE_PHASES, servicePhaseInfo, type ServiceTopology, type LoadCalculationMethod,
} from '@/lib/electrical/serviceTopology';
import type { AnswerResult } from '@/lib/electrical/systemConfigAnswers';

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};
const input = (t: ServiceTopology | null, withEval = true): InterviewInput => ({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: t && withEval ? evaluateServiceTopology(t) : null,
});
const interview = (t: ServiceTopology | null) => buildSystemConfigInterview(input(t));
const item = (t: ServiceTopology | null, id = LOAD_ANALYSIS_ITEM_ID) =>
  interview(t).sections.flatMap(s => s.items).find(i => i.id === id);
const loadIds = (t: ServiceTopology) =>
  interview(t).sections.flatMap(s => s.items.map(i => i.id)).filter(i => i.startsWith('engineering.loads'));

const house200 = () => ok(answerServiceRating(null, 200));
/** Ray's job: 400 A, two 200 A paths, MSP #1 and MSP #2, one backed-up system per panel. */
const rays = () => buildRaysIntendedJob().topology;
const withFigures = (t: ServiceTopology, method: LoadCalculationMethod, figures: Record<string, number>) => {
  let next = ok(answerLoadAnalysisMethod(t, method));
  for (const [panelId, a] of Object.entries(figures)) next = ok(answerPanelDemand(next, panelId, a));
  return next;
};
/**
 * A 400 A house on micros, split into two 200 A main panels (MSP #1, MSP #2), with EVERY required
 * fact answered: the Engineering card reads Complete and the job is release-ready without any load
 * analysis. The control against which an optional analysis must change nothing by itself.
 */
const resolved400 = (): ServiceTopology => {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerInterconnection(t, 'load-side-busbar'));
  t = ok(answerIsolationRequired(t, false));
  t = ok(answerAvailableFaultCurrent(t, 10_000));
  for (const p of t.panels) t = ok(answerPanel(t, p.id, { mainBreakerA: 200, busbarRatingA: 225 }));
  for (const p of t.panels) t = updatePanel(t, p.id, { sccrA: 22_000 });
  t = addProtectiveDevice(t, { label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: 400 }).topology;
  t = { ...t, devices: t.devices.map(d => ({ ...d, sccrA: 22_000, productId: 'eaton-dg224urk' })) };
  return setSolarCoupling(t, 'ac-coupled-inverter');
};
const engineering = (t: ServiceTopology) => interview(t).sections.find(s => s.id === 'engineering')!;

describe('optional: absent, it is a known fact — never a question, never a blocker', () => {
  it('no service yet ⇒ not asked at all (the service rating is the question)', () => {
    expect(buildLoadAnalysisItems(input(null))).toEqual([]);
  });

  it('a 200 A house with no analysis reads "None — optional", answered, and adds nothing to release', () => {
    const t = house200();
    const q = item(t);
    expect(q?.state).toBe('answered');
    expect(q?.answer).toMatch(/^None — optional/);
    expect(q?.section).toBe('engineering');
    // Only the item itself: no verdict rows for a calculation nobody supplied.
    expect(loadIds(t)).toEqual([LOAD_ANALYSIS_ITEM_ID]);
    const iv = interview(t);
    expect(iv.openQuestions.map(o => o.id)).not.toContain(LOAD_ANALYSIS_ITEM_ID);
    expect(iv.release.blockers.join(' ')).not.toMatch(/load/i);
  });

  it('every load item lives in the Engineering section, before the overall verdict that is the card summary', () => {
    const t = withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92, 'msp-2': 80 });
    const eng = interview(t).sections.find(s => s.id === 'engineering')!;
    const loadsAt = eng.items.findIndex(i => i.id === LOAD_ANALYSIS_ITEM_ID);
    expect(loadsAt).toBeGreaterThanOrEqual(0);
    expect(eng.items[eng.items.length - 1].id).toBe('engineering.overall');
    expect(eng.summary).toBe(eng.items[eng.items.length - 1].answer);
    expect(buildLoadAnalysisItems(input(t)).every(i => i.section === 'engineering')).toBe(true);
  });
});

describe('the method is the installer\'s — never assumed', () => {
  it('a method SolarPro does not record is refused, and the graph is untouched', () => {
    for (const t of [house200(), withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92 })]) {
      const loadsBefore = JSON.stringify(t.loads ?? null);
      const r = answerLoadAnalysisMethod(t, 'nec-made-up' as LoadCalculationMethod);
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refused).toBe('\'nec-made-up\' is not a load calculation method SolarPro records.');
      expect(JSON.stringify(t.loads ?? null)).toBe(loadsBefore);
    }
  });

  it('a panel figure before the analysis exists is REFUSED (setPanelLoad alone would default to NEC 220.82)', () => {
    const r = answerPanelDemand(house200(), 'msp-1', 90);
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toMatch(/choose its method/i);
  });

  it('adding it with a chosen method records that method and no figures', () => {
    const t = ok(answerLoadAnalysisMethod(house200(), 'standard-220-part-iii'));
    expect(t.loads).toEqual({ method: 'standard-220-part-iii', basis: '', byPanel: [], otherDemandA: null });
  });

  it('a service with no panelboard yet (400 A, distribution unanswered) cannot take an analysis', () => {
    const svc400 = ok(answerServiceRating(null, 400));
    expect(svc400.panels).toHaveLength(0);
    const r = answerLoadAnalysisMethod(svc400, 'standard-220-part-iii');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toMatch(/per panelboard/);
  });

  it('changing the method keeps every figure entered', () => {
    const t = withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92 });
    const next = ok(answerLoadAnalysisMethod(t, 'engineer-supplied'));
    expect(next.loads?.method).toBe('engineer-supplied');
    expect(next.loads?.byPanel).toEqual([{ panelId: 'msp-1', calculatedDemandA: 92 }]);
  });
});

describe('a partial model is not a smaller load', () => {
  const partial = () => withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92 });

  it('one of two panelboards entered ⇒ "cannot be summed", no aggregate, no path, no system figure', () => {
    const t = partial();
    expect(describeLoadAnalysis(t).sums).toBeNull();
    const q = item(t)!;
    expect(q.answer).toContain('1 of 2 panelboards with a figure');
    expect(q.answer).toContain('cannot be summed until every panelboard has a figure');
    expect(q.answer).not.toMatch(/aggregate/);
    expect(q.answer, 'a subtotal leaked').not.toMatch(/92(\.0)? A/);
    expect(q.why).toMatch(/MSP #2 has no figure/);
    // No verdict rows that would advertise a partial sum.
    expect(loadIds(t)).toEqual([LOAD_ANALYSIS_ITEM_ID]);
  });

  it('…and it is NOT a needs-answer, and adds NO release blocker or open question of its own', () => {
    const before = interview(rays());
    const after = interview(partial());
    expect(item(partial())?.state).not.toBe('needs-answer');
    expect(after.openQuestions.map(o => o.id)).toEqual(before.openQuestions.map(o => o.id));
    expect(after.release.blockers).toEqual(before.release.blockers);
    expect(after.release.releaseReady).toBe(before.release.releaseReady);
  });

  it('🚨 an empty or partial analysis leaves the Engineering card exactly as it was on a fully resolved job', () => {
    const t = resolved400();
    expect(engineering(t).status, 'fixture: every required fact is answered').toBe('complete');
    expect(interview(t).release.releaseReady, 'fixture').toBe(true);
    const empty = ok(answerLoadAnalysisMethod(t, 'standard-220-part-iii'));
    const half = ok(answerPanelDemand(empty, 'msp-1', 92));
    for (const [name, x] of [['empty', empty], ['partial', half]] as const) {
      expect(engineering(x).status, `${name} analysis turned the Engineering card`).toBe(engineering(t).status);
      // The installer's own entry — not amber.
      expect(item(x)?.state, name).toBe('answered');
      expect(interview(x).release, name).toEqual(interview(t).release);
    }
    // The reason is kept, for the installer to read.
    expect(item(half)?.answer).toContain('cannot be summed until every panelboard has a figure');
    expect(item(half)?.why).toMatch(/^MSP #2 has no figure\. A partial load analysis is not a smaller load/);
    expect(item(half)?.why).toMatch(/Optional: nothing waits on it\.$/);
  });

  it('…needs-verification is kept for what needs it: a method this system cannot use, no evaluation in hand', () => {
    const half = withFigures(resolved400(), 'standard-220-part-iii', { 'msp-1': 92 });
    expect(buildLoadAnalysisItems(input(half, false))[0].state).toBe('needs-verification');
    const wrongMethod = ok(answerElectricalSystem(withFigures(house200(), 'optional-220-82', { 'msp-1': 90 }), 'wye-208'));
    expect(item(wrongMethod)?.state).toBe('needs-verification');
  });

  it('the engine agrees: the model\'s own check is NOT EVALUATED, never a pass on half a house', () => {
    const c = evaluateServiceTopology(partial()).checks.find(x => x.id === 'load.calculation')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
  });

  it('blanking a figure removes it — the sums become unknown again, never zero', () => {
    const whole = withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92, 'msp-2': 80 });
    expect(describeLoadAnalysis(whole).sums).not.toBeNull();
    const blanked = ok(answerPanelDemand(whole, 'msp-2', null));
    expect(blanked.loads?.byPanel.map(l => l.panelId)).toEqual(['msp-1']);
    expect(describeLoadAnalysis(blanked).sums).toBeNull();
  });

  it('zero, negative and non-numbers are refused, not stored', () => {
    const t = ok(answerLoadAnalysisMethod(house200(), 'standard-220-part-iii'));
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(answerPanelDemand(t, 'msp-1', bad).ok, String(bad)).toBe(false);
    }
    expect(answerPanelDemand(t, 'no-such-panel', 90).ok).toBe(false);
  });
});

describe('every panelboard entered ⇒ SolarPro sums the rest, and the item states what the checks concluded', () => {
  const whole = () => withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 92, 'msp-2': 80 });

  it('aggregate, per path and per backed-up system are SUMS of the two panel figures', () => {
    const s = describeLoadAnalysis(whole()).sums!;
    expect(s.aggregateA).toBe(172);
    expect(s.paths.map(p => [p.label, p.demandA])).toEqual([['200 A service path 1', 92], ['200 A service path 2', 80]]);
    expect(s.systems.map(p => [p.label, p.demandA])).toEqual([['System 1', 92], ['System 2', 80]]);
    expect(item(whole())?.answer).toBe('Standard calculation — NEC 220 Part III · 2 of 2 panelboards with a figure · 172.0 A aggregate');
  });

  it('the checks that read it are stated with the engine\'s own conclusion; all pass ⇒ calculated', () => {
    const t = whole();
    expect(item(t)?.state).toBe('calculated');
    const demand = item(t, 'engineering.loads.check.service.demand.site');
    expect(demand?.state).toBe('calculated');
    expect(demand?.answer).toBe('PASS — 172.0 A calculated demand against a 400 A service.');
    expect(item(t, 'engineering.loads.check.domain.backed-up-load.domain:domain-a')?.answer)
      .toMatch(/^PASS — 92\.0 A of backed-up load, summed from the load model/);
    expect(item(t, 'engineering.loads.check.branch.demand.branch:branch-b')?.answer).toMatch(/^PASS — 80\.0 A on a 200 A branch/);
  });

  it('demand over the service ⇒ the item FAILS, because the evaluation says FAIL', () => {
    const t = withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 350, 'msp-2': 80 });
    expect(item(t)?.state).toBe('fails');
    expect(item(t, 'engineering.loads.check.service.demand.site')?.answer).toBe('FAIL — 430.0 A calculated demand exceeds the 400 A service.');
    expect(item(t, 'engineering.loads.check.branch.demand.branch:branch-a')?.state).toBe('fails');
    expect(interview(t).release.blockers.some(b => /engineering checks? fail/.test(b))).toBe(true);
  });

  it('a FAIL is never hidden behind "partial": one panel over its path, the other not entered', () => {
    const t = withFigures(rays(), 'standard-220-part-iii', { 'msp-1': 250 });
    expect(describeLoadAnalysis(t).sums).toBeNull();
    expect(item(t)?.state).toBe('fails');
    expect(item(t, 'engineering.loads.check.branch.demand.branch:branch-a')?.answer).toMatch(/^FAIL — 250\.0 A exceeds the 200 A branch/);
    // The passing / unevaluated rest of a partial model is still not advertised.
    expect(item(t, 'engineering.loads.check.service.demand.site')).toBeUndefined();
  });

  it('every consuming check id is one the engine really emits (a rename cannot hide a verdict)', () => {
    const emitted = new Set(evaluateServiceTopology(rays()).checks.map(c => c.id));
    for (const id of LOAD_CONSUMING_CHECK_IDS) expect(emitted.has(id), id).toBe(true);
  });

  it('removing it returns to "None — optional"; the design still evaluates', () => {
    const t = ok(answerRemoveLoadAnalysis(whole()));
    expect(t.loads).toBeNull();
    expect(item(t)?.state).toBe('answered');
    expect(item(t)?.answer).toMatch(/^None — optional/);
    expect(answerRemoveLoadAnalysis(t).ok).toBe(false);
  });

  it('a demand recorded directly (no model) is what the engineering reads, and the item says so', () => {
    const t = { ...house200(), calculatedServiceDemandA: 150 };
    const q = item(t)!;
    expect(q.answer).toBe('No load analysis — 150.0 A service demand recorded directly');
    expect(item(t, 'engineering.loads.check.service.demand.site')?.answer).toMatch(/^PASS — 150\.0 A/);
  });

  it('without an evaluation in hand, entered figures are never claimed as calculated', () => {
    const t = whole();
    const [q] = buildLoadAnalysisItems(input(t, false));
    expect(q.state).toBe('needs-verification');
  });
});

describe('the method respects the electrical system — gated exactly as the engine gates it', () => {
  it('120/240 V split phase is offered every method', () => {
    expect(loadMethodChoices('split-240').available.map(o => o.value)).toEqual([
      'standard-220-part-iii', 'optional-220-82', 'existing-dwelling-220-87', 'engineer-supplied']);
    expect(loadMethodChoices('split-240').unavailable).toEqual([]);
  });

  it('on every other system NEC 220.82 is NOT offered, and the reason names the system and NEC 220.82(A)', () => {
    for (const phase of SERVICE_PHASES.filter(p => p !== 'split-240')) {
      const c = loadMethodChoices(phase);
      expect(c.available.map(o => o.value), phase).not.toContain('optional-220-82');
      expect(c.unavailable.map(o => o.value), phase).toEqual(['optional-220-82']);
      expect(c.unavailable[0].why).toContain('NEC 220.82(A)');
      expect(c.unavailable[0].why).toContain(servicePhaseInfo(phase).label);
    }
  });

  it('…and recording it there is refused, with the same reason', () => {
    const t3 = ok(answerElectricalSystem(house200(), 'wye-208'));
    const r = answerLoadAnalysisMethod(t3, 'optional-220-82');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.refused).toBe(loadMethodUnavailableBecause('optional-220-82', 'wye-208'));
    expect(item(t3)?.options?.map(o => o.value)).not.toContain('optional-220-82');
  });

  it('the gate and the engine never disagree: unavailable ⇔ the engine refuses to run the model', () => {
    for (const phase of SERVICE_PHASES) {
      for (const method of ['standard-220-part-iii', 'optional-220-82', 'existing-dwelling-220-87', 'engineer-supplied'] as const) {
        const base = ok(answerElectricalSystem(house200(), phase));
        const t: ServiceTopology = { ...base, loads: { method, basis: '', byPanel: [{ panelId: 'msp-1', calculatedDemandA: 90 }], otherDemandA: null } };
        const c = evaluateServiceTopology(t).checks.find(x => x.id === 'load.calculation')!;
        const engineRefuses = c.conclusion === 'NOT_EVALUATED' && /CALCULATION METHOD NOT YET SUPPORTED/.test(c.detail);
        expect(loadMethodUnavailableBecause(method, phase) !== null, `${phase} × ${method}`).toBe(engineRefuses);
      }
    }
  });

  it('a 220.82 analysis recorded before the system changed reads "does not apply", says why, and keeps its figures', () => {
    const split = withFigures(house200(), 'optional-220-82', { 'msp-1': 90 });
    const t3 = ok(answerElectricalSystem(split, 'wye-208'));
    const q = item(t3)!;
    expect(q.state).toBe('needs-verification');
    expect(q.answer).toContain('does not apply to 120/208 V 3φ wye');
    expect(q.why).toBe(loadMethodUnavailableBecause('optional-220-82', 'wye-208'));
    // The engine's refusal is stated, not hidden.
    expect(item(t3, 'engineering.loads.check.load.calculation.site')?.answer).toMatch(/CALCULATION METHOD NOT YET SUPPORTED/);
    const fixed = ok(answerLoadAnalysisMethod(t3, 'standard-220-part-iii'));
    expect(fixed.loads?.byPanel).toEqual([{ panelId: 'msp-1', calculatedDemandA: 90 }]);
    expect(item(fixed)?.answer).not.toMatch(/does not apply/);
  });
});

describe('🚨 a demand recorded directly is never replaced in silence', () => {
  // 450 A recorded straight onto a 400 A service: the engine FAILs it and release is blocked by it.
  // The engine reads a load model as soon as it holds ONE figure, and a partial model sums to nothing,
  // so the first figure on a two-panel job would make that FAIL simply stop being reported.
  const over = (): ServiceTopology => ({ ...resolved400(), calculatedServiceDemandA: 450 });
  const FAILED = '450.0 A calculated demand exceeds the 400 A service.';

  it('control: with no analysis the recorded 450 A FAILs, and the release says so', () => {
    const t = over();
    expect(item(t, 'engineering.loads.check.service.demand.site')?.answer).toBe(`FAIL — ${FAILED}`);
    expect(interview(t).release.blockers).toEqual(['1 engineering check fail.']);
    // Nothing supersedes it yet, so there is nothing to warn about.
    expect(item(t, RECORDED_DEMAND_ITEM_ID)).toBeUndefined();
  });

  it('before the first figure: still read, still failing, and the item says the first figure supersedes it', () => {
    const t = ok(answerLoadAnalysisMethod(over(), 'standard-220-part-iii'));
    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.state).toBe('fails');
    expect(r.answer).toBe('The demand recorded directly (450.0 A service demand) is read until the first panelboard '
      + `figure is entered, which supersedes it. It fails — ${FAILED}`);
    expect(r.why).toMatch(/so this FAIL would stop being reported without being resolved\.$/);
    expect(item(t)?.answer).toContain('the demand recorded directly (450.0 A service demand) is read until the first figure');
    expect(interview(t).release.blockers).toEqual(['1 engineering check fail.']);
  });

  it('after the first figure: the engine no longer fails it — and the interview states the FAIL it no longer reads', () => {
    const t = withFigures(over(), 'standard-220-part-iii', { 'msp-1': 92 });
    // The hole, exactly: the engine reads the half-entered model and the FAIL is gone from it.
    expect(evaluateServiceTopology(t).checks.find(c => c.id === 'service.demand')?.conclusion).toBe('NOT_EVALUATED');
    expect(t.calculatedServiceDemandA, 'the recorded figure is kept, not deleted').toBe(450);

    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.state).toBe('needs-verification');
    expect(r.answer).toBe('The demand recorded directly (450.0 A service demand) is superseded by this analysis and '
      + `no longer read. It failed, and nothing evaluates that now — ${FAILED}`);
    expect(r.why).toMatch(/^Nothing evaluates this demand now\./);
    expect(r.why).toMatch(/remove the analysis and the recorded demand is read again\.$/);
    expect(item(t)?.answer).toContain('supersedes the demand recorded directly (450.0 A service demand)');
    expect(item(t)?.why, 'an optional label over a hidden FAIL').not.toMatch(/nothing waits on it/);
    // The Engineering card cannot read Complete over a FAIL that was stopped being read, not resolved.
    expect(engineering(t).status).toBe('needs-verification');
  });

  it('every panelboard entered: the analysis replaces it — still stated, no longer amber, its own verdict governs', () => {
    const t = withFigures(over(), 'standard-220-part-iii', { 'msp-1': 92, 'msp-2': 80 });
    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.state).toBe('answered');
    expect(r.answer).toContain(`superseded by this analysis and no longer read. It failed — ${FAILED} Now evaluated from the analysis:`);
    expect(item(t, 'engineering.loads.check.service.demand.site')?.answer)
      .toBe('PASS — 172.0 A calculated demand against a 400 A service.');
    expect(engineering(t).status).toBe('complete');
  });

  it('removing the analysis reads the recorded demand again, and its FAIL is back', () => {
    const t = ok(answerRemoveLoadAnalysis(withFigures(over(), 'standard-220-part-iii', { 'msp-1': 92 })));
    expect(item(t, 'engineering.loads.check.service.demand.site')?.state).toBe('fails');
    expect(interview(t).release.blockers).toEqual(['1 engineering check fail.']);
  });

  it('a recorded demand on a service path is named by that path, with the engine\'s own FAIL', () => {
    const base = resolved400();
    const t = withFigures({ ...base, branches: base.branches.map(b => b.id === base.branches[0].id
      ? { ...b, calculatedDemandA: 250 } : b) }, 'standard-220-part-iii', { 'msp-2': 80 });
    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.state).toBe('needs-verification');
    expect(r.answer).toBe(`The demand recorded directly (250.0 A on ${base.branches[0].label}) is superseded by this `
      + 'analysis and no longer read. It failed, and nothing evaluates that now — 250.0 A exceeds the 200 A branch.');
  });

  it('a recorded FAIL on a path the analysis now evaluates is not called "unread" — the row agrees with the engine', () => {
    // Second review round: with MSP #1 (the only panel on that path) entered, the engine evaluates the
    // path from the model, yet the row said "Nothing evaluates this demand now" beside the engine's verdict.
    const base = resolved400();
    const t = withFigures({ ...base, branches: base.branches.map(b => b.id === base.branches[0].id
      ? { ...b, calculatedDemandA: 250 } : b) }, 'standard-220-part-iii', { 'msp-1': 92 });
    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.answer).not.toMatch(/nothing evaluates that now/);
    expect(r.answer).toMatch(/It failed — 250\.0 A exceeds the 200 A branch\. Now evaluated from the analysis: .* — PASS\./);
    expect(r.state, 'amber over a path the engine evaluates and passes').toBe('answered');
    expect(r.why ?? '').not.toMatch(/Nothing evaluates this demand now/);
  });

  it('a recorded demand that passed is still disclosed, but nothing turns amber', () => {
    const t = withFigures({ ...resolved400(), calculatedServiceDemandA: 150 }, 'standard-220-part-iii', { 'msp-1': 92 });
    const r = item(t, RECORDED_DEMAND_ITEM_ID)!;
    expect(r.state).toBe('answered');
    expect(r.answer).toBe('The demand recorded directly (150.0 A service demand) is superseded by this analysis and '
      + 'no longer read.');
    expect(engineering(t).status).toBe('complete');
  });
});
