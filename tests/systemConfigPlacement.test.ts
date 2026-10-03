// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — where each question lives, and the ONE list of what is still required.
//
// Ray: "We do not want a second questionnaire layered on top of System Config… At the bottom, one
// compact ENGINEERING READINESS panel." `lib/electrical/systemConfigPlacement.ts` decides each item's
// home card and the ordered required queue the guided strip, [Answer Next] and the readiness panel
// all read. The interview itself (relevance, answers, release) is unchanged and is the engine here.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  buildSystemConfigInterview, type InterviewEquipment, type InterviewInput,
} from '@/lib/electrical/systemConfigInterview';
import {
  CARD_ANCHOR, homeOf, nextActionLabel, readinessCounts, releaseStatus, requiredQueue, findInterviewItem,
  isRequiredUnresolved,
} from '@/lib/electrical/systemConfigPlacement';
import {
  answerServiceRating, answerDistribution, answerInterconnection, answerIsolationRequired,
  answerAvailableFaultCurrent, answerPanel, answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { answerLoadAnalysisMethod, answerPanelDemand } from '@/lib/electrical/systemConfigLoadAnalysis';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { addProtectiveDevice, setSolarCoupling, updatePanel } from '@/lib/electrical/topologyAuthoring';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });

const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const PW3: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const base = (over: Partial<InterviewInput>): InterviewInput => ({
  pvArray: pv20, topology: null, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: MICROS, evaluation: null, derivedStrings: null, ...over,
});
const withEval = (t: ServiceTopology, over: Partial<InterviewInput> = {}) =>
  buildSystemConfigInterview(base({ topology: t, evaluation: evaluateServiceTopology(t), ...over }));

const house200 = () => ok(answerServiceRating(null, 200));
const rays = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });
const raysInterview = () => withEval(rays(), {
  pvArray: pv37, coupling: 'dc-coupled-storage', couplingIsDecision: true, equipment: PW3,
  derivedStrings: [9, 9, 9, 8, 2].map(panelCount => ({ panelCount })),
});
/** A 400 A, two-panel micro house with every required fact answered. */
const resolved400 = (): ServiceTopology => {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerInterconnection(t, 'load-side-busbar'));
  t = ok(answerIsolationRequired(t, false));
  t = ok(answerAvailableFaultCurrent(t, 10_000));
  // Existing or new is answered too — an unanswered one is a required answer, never "new".
  t = ok(answerExistingService(t, { existing: false }));
  for (const p of t.panels) t = ok(answerPanel(t, p.id, { mainBreakerA: 200, busbarRatingA: 225 }));
  for (const p of t.panels) t = updatePanel(t, p.id, { sccrA: 22_000 });
  t = addProtectiveDevice(t, { label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: 400 }).topology;
  t = { ...t, devices: t.devices.map(d => ({ ...d, sccrA: 22_000, productId: 'eaton-dg224urk' })) };
  return setSolarCoupling(t, 'ac-coupled-inverter');
};

describe('every item has ONE home card (the spec\'s table)', () => {
  it.each([
    ['design.pv-array', 'summary'],
    ['design.module-conflict', 'readiness'],
    ['design.assignment-stale', 'readiness'],
    ['service.rating', 'service'], ['service.system', 'service'], ['service.distribution', 'service'],
    ['service.panel.msp-2', 'service'], ['service.fault-current', 'service'], ['service.existing', 'service'],
    ['engineering.needs.service.existingEquipment.sccrA', 'service'],
    ['engineering.needs.service.existingOrNew', 'service'],
    ['equipment.storage', 'battery'], ['equipment.gateway', 'battery'],
    ['equipment.system.equip.domain-a', 'battery'], ['equipment.system.landing.domain-b', 'battery'],
    ['behavior.storage-landing', 'battery'],
    ['equipment.pv-inverter', 'inverters'], ['behavior.pv-connection', 'inverters'], ['behavior.pv-landing', 'inverters'],
    // With one inverting unit behavior.pv-landing is not asked, so the engine's own need is the
    // question — answered by the card's String assignment editor, never a dead end in readiness.
    ['engineering.needs.pv.stringAssignment', 'inverters'],
    ['behavior.backup', 'systemConfig'], ['behavior.systems', 'systemConfig'], ['behavior.interconnection', 'systemConfig'],
    ['behavior.utility.meter-collar', 'systemConfig'], ['behavior.isolation', 'systemConfig'],
    ['engineering.disconnect.der-isolation-disconnect', 'systemConfig'],
    ['engineering.disconnect.service-disconnect', 'readiness'], ['engineering.disconnect.gateway-isolation', 'readiness'],
    ['engineering.disconnect.ess-disconnect', 'readiness'], ['engineering.disconnect.multi-gateway-doc', 'readiness'],
    ['engineering.loads', 'readiness'], ['engineering.loads.recorded', 'readiness'],
    ['engineering.domain.busbar-705-12.domain:domain-a', 'readiness'],
    ['engineering.needs.sccr:agg-1', 'readiness'], ['engineering.needs.service.availableFaultCurrentA', 'readiness'],
    ['engineering.overall', 'readiness'],
  ] as const)('%s → %s', (id, home) => {
    expect(homeOf(id)).toBe(home);
  });

  it('every home has a stable anchor id on the page', () => {
    expect(CARD_ANCHOR).toEqual({
      summary: 'sc-card-summary', service: 'sc-card-service', battery: 'sc-card-battery',
      inverters: 'sc-card-inverters', systemConfig: 'sc-card-system-config', readiness: 'engineering-readiness',
    });
  });
});

describe('the required queue — one ordered list, nothing asked twice', () => {
  it('the 200 A micro house: every open question, plus the required engineering items, service first', () => {
    const iv = withEval(house200());
    const q = requiredQueue(iv).map(i => i.id);
    expect(q).toEqual([
      'service.fault-current', 'service.existing',   // service — existing or new is asked, never assumed new
      'behavior.interconnection', 'behavior.isolation', // system configuration
      'engineering.needs.interconnection.solarCoupling', 'engineering.disconnect.service-disconnect', // readiness
    ]);
    for (const open of iv.openQuestions) expect(q).toContain(open.id);
    // The same fact the engine waits on, already asked by a question in the queue, is not asked twice.
    expect(q).not.toContain('engineering.needs.service.availableFaultCurrentA');
    expect(q).not.toContain('engineering.needs.service.existingOrNew');
    expect(q).not.toContain('engineering.needs.interconnection.externalDerIsolationRequired');
    // A ruling that blocks nothing yet (no collar chosen) is not a required answer.
    expect(q).not.toContain('behavior.utility.meter-collar');
    expect(q).not.toContain('engineering.overall');
  });

  it('Ray\'s DC-coupled job: strings, AIC/SCCR and isolation acceptance are required — in card order', () => {
    const iv = raysInterview();
    const queue = requiredQueue(iv);
    const ids = queue.map(i => i.id);
    expect(ids).toContain('behavior.pv-landing');
    expect(ids).toContain('behavior.isolation');
    // 🚨 ONE SITE VISIT IS ONE ACTION: the five existing-equipment readings (model, both arrangements,
    // AIC/SCCR, read on site) are ONE next action that opens the Verify dialog — never five answers.
    const ee = queue.filter(i => i.id.startsWith('engineering.needs.service.existingEquipment.'));
    expect(ee).toHaveLength(1);
    expect(nextActionLabel(ee[0])).toBe('Verify the existing service equipment (5 items)');
    // deduped against the questions that ask them
    expect(ids).not.toContain('engineering.needs.pv.stringAssignment');
    expect(ids).not.toContain('engineering.needs.interconnection.isolationArrangementAccepted');
    expect(ids).not.toContain('engineering.needs.service.availableFaultCurrentA');
    // a manufacturer question with nothing waiting on it (no blocks, no required check) is not required
    expect(ids).not.toContain('engineering.disconnect.ess-disconnect');
    // service → battery → inverters → systemConfig → readiness, never back
    const order = ['service', 'battery', 'inverters', 'systemConfig', 'readiness'];
    const homes = queue.map(i => order.indexOf(homeOf(i.id)));
    expect(homes).toEqual([...homes].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(queue.map(nextActionLabel)).toEqual(expect.arrayContaining([
      'Assign PV strings to storage inputs', 'Verify the existing service equipment (5 items)',
      'Confirm utility isolation acceptance',
    ]));
  });

  it('a design conflict comes before everything else', () => {
    const conflict = resolvePvArrayDesign({ placedModuleCount: 37, placedModuleWatts: 440, selectedPanelId: 'panel-cs2' });
    const iv = withEval(house200(), { pvArray: conflict });
    const q = requiredQueue(iv);
    expect(q[0].id).toBe('design.module-conflict');
    expect(nextActionLabel(q[0])).toBe('Resolve the module conflict with Design');
  });

  it('🚨 the optional load analysis never enters — empty, partial or complete; a FAILING one does', () => {
    const none = withEval(resolved400());
    const partial = withEval(ok(answerPanelDemand(ok(answerLoadAnalysisMethod(resolved400(), 'standard-220-part-iii')), 'msp-1', 92)));
    for (const iv of [none, partial]) {
      expect(requiredQueue(iv).filter(i => i.id.startsWith('engineering.loads'))).toEqual([]);
    }
    expect(requiredQueue(partial)).toEqual([]);
    // Control: a FAIL is not optional to fix (the load-analysis module's own rule) — but its verdict
    // rows are verdicts, never questions.
    const failing = withEval(ok(answerPanelDemand(ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii')), 'msp-1', 250)),
      { equipment: PW3 });
    const loads = requiredQueue(failing).filter(i => i.id.startsWith('engineering.loads'));
    expect(loads.map(i => i.id)).toEqual(['engineering.loads']);
    expect(isRequiredUnresolved({ id: 'engineering.loads.check.service.demand.site', section: 'engineering', question: 'x', state: 'fails' })).toBe(false);
  });
});

describe('the next action is said in installer words', () => {
  it('short, specific labels', () => {
    const iv = withEval(house200());
    const label = (id: string) => nextActionLabel(findInterviewItem(iv, id)!);
    expect(label('service.fault-current')).toBe('Get the available fault current from the utility');
    expect(label('behavior.interconnection')).toBe('Choose the interconnection method');
    expect(label('behavior.isolation')).toBe('Record the utility isolation requirement');
    expect(label('engineering.disconnect.service-disconnect')).toBe('Add the service disconnect');
    const two = withEval(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')));
    const panel = two.sections.flatMap(s => s.items).find(i => i.id.startsWith('service.panel.'))!;
    expect(nextActionLabel(panel)).toMatch(/^Enter MSP #1 main breaker and busbar$/);
  });
});

describe('PASS / FAIL / NOT EVALUATED and the release status', () => {
  it('counts every engine check once (Ray\'s job: 26 · 0 · 23)', () => {
    const iv = raysInterview();
    expect(iv.evaluation, 'the interview carries the evaluation it was built from').not.toBeNull();
    const c = readinessCounts(iv.evaluation!.checks);
    expect(c).toEqual({ pass: 26, fail: 0, notEvaluated: 23 });
    expect(c.pass + c.fail + c.notEvaluated).toBe(iv.evaluation!.checks.length);
    expect(readinessCounts(null)).toEqual({ pass: 0, fail: 0, notEvaluated: 0 });
  });

  it('BLOCKED — N required answers, where N is the queue', () => {
    const iv = withEval(house200());
    const s = releaseStatus(iv);
    expect(s).toEqual({ kind: 'BLOCKED', label: 'BLOCKED — 6 required answers', count: 6 });
  });

  it('release-eligible with something still to review is ELIGIBLE, never COMPLETE', () => {
    const iv = withEval(house200());
    const reviewing = {
      ...iv,
      release: { drawable: true, releaseReady: true, blockers: [] },
      sections: iv.sections.map(s => ({ ...s, items: s.items.map(i => (i.id === 'behavior.utility.meter-collar' ? i
        : { ...i, state: 'answered' as const })) })),
      openQuestions: [],
    };
    expect(releaseStatus(reviewing)).toEqual({ kind: 'ELIGIBLE', label: 'ELIGIBLE — 1 item to review', count: 1 });
    const done = { ...reviewing, sections: reviewing.sections.map(s => ({ ...s, items: s.items.map(i => ({ ...i, state: 'answered' as const })) })) };
    expect(releaseStatus(done)).toEqual({ kind: 'COMPLETE', label: 'COMPLETE', count: 0 });
  });
});

describe('the Engineering Summary facts the tiles need (PV AC, GATEWAYS)', () => {
  const fact = (iv: ReturnType<typeof buildSystemConfigInterview>, label: string) => iv.summaryFacts.find(f => f.label === label);

  it('DC coupled ⇒ PV AC is N/A — DC coupled, never a kW figure', () => {
    const f = fact(raysInterview(), 'PV AC output');
    expect(f).toEqual({ label: 'PV AC output', value: 'N/A — DC coupled', source: 'Installer decision' });
  });

  it('a chosen inverter states its catalogue AC rating; with none, "not evaluated" — never a default', () => {
    const rated = buildSystemConfigInterview(base({ equipment: { ...MICROS, pvInverter: { ...MICROS.pvInverter, acKw: 6.4 } } }));
    expect(fact(rated, 'PV AC output')).toEqual({ label: 'PV AC output', value: '6.40 kW', source: 'Manufacturer specification' });
    const unrated = buildSystemConfigInterview(base({}));
    expect(fact(unrated, 'PV AC output')?.value).toMatch(/^Not evaluated/);
    expect(fact(unrated, 'PV AC output')?.source).toBe('Not established');
    const undecided = buildSystemConfigInterview(base({ equipment: { pvInverter: { state: 'UNDECIDED' }, storage: null, gateway: null } }));
    expect(fact(undecided, 'PV AC output')?.value).toBe('Not established — no PV inverter chosen');
    const noPv = buildSystemConfigInterview(base({ pvArray: resolvePvArrayDesign({ placedModuleCount: 0, layoutTotalPanels: 0 }) }));
    expect(fact(noPv, 'PV AC output')?.value).toBe('N/A — no PV');
  });

  it('GATEWAYS: stated per product when chosen; storage that needs one and has none says so; no storage, no line', () => {
    expect(fact(raysInterview(), 'Backup controllers')?.value).toBe('2 × Tesla Gateway 3');
    const missing = buildSystemConfigInterview(base({ equipment: { ...PW3, gateway: null } }));
    expect(fact(missing, 'Backup controllers')).toEqual({
      label: 'Backup controllers', value: 'None selected — the storage requires one', source: 'Not established' });
    const notNeeded = buildSystemConfigInterview(base({ equipment: { ...PW3, storage: { ...PW3.storage!, requiresGateway: false }, gateway: null } }));
    expect(fact(notNeeded, 'Backup controllers')?.value).toBe('None — not required by the storage');
    expect(fact(buildSystemConfigInterview(base({})), 'Backup controllers')).toBeUndefined();
  });
});
