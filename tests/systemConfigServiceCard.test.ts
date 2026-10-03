// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the EXISTING ELECTRICAL SERVICE card's pure parts.
//
//   · answerExistingService records what the [Verify] dialog reads off the assembly — catalog number,
//     main / feeder arrangement, AIC / SCCR, read on site — in ONE answer, and the engine's own
//     field-verification needs disappear exactly as they are read. Blank is "not read", never "".
//   · serviceCardLayout: a plain 200 A / one-MSP house has no distribution question and one panel
//     row; a 400 A service is asked how it is split, and two MSPs give two rows.
//   · panelBusbarCheck reads the ENGINE's NEC 705.12(B) verdict for one panel; busbarRemedies offers
//     derate-main / upgrade-bus only on a FAIL, each stating the allowance by the one formula.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  answerExistingService, answerServiceRating, answerDistribution, answerPanel, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  BUSBAR_RATINGS, MAIN_BREAKER_RATINGS, busbarRemedies, existingNeedField, existingRecordedFacts, existingServiceNeeds,
  panelBusbarCheck, panelRecordedFacts, serviceCardLayout, withRecorded, withoutPresetPanelRatings,
} from '@/lib/electrical/systemConfigServiceCard';
import { allInterviewItems, homeOf } from '@/lib/electrical/systemConfigPlacement';

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const interviewOf = (t: ServiceTopology | null) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: t ? evaluateServiceTopology(t) : null,
});
const existingCheck = (t: ServiceTopology) =>
  evaluateServiceTopology(t).checks.find(c => c.id === 'service.existing-equipment')!;

describe('answerExistingService — everything read off the assembly, in one answer', () => {
  const rays = buildRaysIntendedJob().topology;

  it('Ray\'s existing Eaton assembly: the engine names the five things still to read, the card owns them', () => {
    const needs = existingServiceNeeds(interviewOf(rays)).map(i => existingNeedField(i.id));
    expect(needs).toEqual(['catalogNumber', 'mainArrangement', 'feederArrangement', 'sccrA', 'verified']);
    for (const i of existingServiceNeeds(interviewOf(rays))) expect(homeOf(i.id)).toBe('service');
    expect(existingCheck(rays).conclusion).toBe('NOT_EVALUATED');
  });

  it('records catalog number, arrangements, AIC / SCCR and "read on site" in one write — and the check passes', () => {
    const r = answerExistingService(rays, {
      existing: true, catalogNumber: ' CHU2040M200 ', mainArrangement: 'Meter-main, two 200 A main breakers',
      feederArrangement: 'One 200 A feeder to each MSP', sccrA: 22_000, verified: true,
    });
    const t = ok(r);
    expect(t.service.existingEquipment).toEqual({
      manufacturer: 'Eaton', catalogNumber: 'CHU2040M200', mainArrangement: 'Meter-main, two 200 A main breakers',
      feederArrangement: 'One 200 A feeder to each MSP', sccrA: 22_000, verified: true,
    });
    expect(r.ok && r.did).toBe('Existing service equipment — catalog number, main arrangement, feeder arrangement, '
      + 'AIC / SCCR recorded — read on site');
    expect(existingCheck(t).conclusion).toBe('PASS');
    expect(existingServiceNeeds(interviewOf(t))).toEqual([]);
  });

  it('only what was read leaves the engine\'s list; "read on site" is never derived from the fields', () => {
    const t = ok(answerExistingService(rays, { existing: true, sccrA: 22_000 }));
    expect(existingServiceNeeds(interviewOf(t)).map(i => existingNeedField(i.id)))
      .toEqual(['catalogNumber', 'mainArrangement', 'feederArrangement', 'verified']);
    const filled = ok(answerExistingService(t, {
      existing: true, catalogNumber: 'X', mainArrangement: 'Y', feederArrangement: 'Z',
    }));
    expect(filled.service.existingEquipment?.verified).toBe(false);
    expect(existingCheck(filled).requires).toEqual(['service.existingEquipment.verified']);
  });

  it('a blank field is "not read" (null), so the engine keeps naming it — never an empty string', () => {
    const t = ok(answerExistingService(ok(answerExistingService(rays, { existing: true, catalogNumber: 'X' })),
      { existing: true, catalogNumber: '   ', sccrA: null }));
    expect(t.service.existingEquipment?.catalogNumber).toBeNull();
    expect(t.service.existingEquipment?.sccrA).toBeNull();
    expect(existingCheck(t).requires).toContain('service.existingEquipment.catalogNumber');
  });

  it('🚨 an AIC that is not a positive number of amperes is refused, not stored', () => {
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = answerExistingService(rays, { existing: true, sccrA: bad });
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.refused).toMatch(/^The AIC \/ SCCR must be a positive number/);
    }
  });

  it('fields not named are kept; existing: false says the service equipment is new', () => {
    const t = ok(answerExistingService(rays, { existing: true, sccrA: 10_000 }));
    expect(ok(answerExistingService(t, { existing: true, verified: true })).service.existingEquipment?.sccrA).toBe(10_000);
    expect(ok(answerExistingService(t, { existing: false })).service.existingEquipment).toBeNull();
    expect(existingServiceNeeds(interviewOf(ok(answerExistingService(t, { existing: false }))))).toEqual([]);
  });
});

describe('serviceCardLayout — the card shows what the interview asks, and nothing else', () => {
  it('no graph yet: only the rating', () => {
    const l = serviceCardLayout(interviewOf(null), null);
    expect(l.rating?.state).toBe('needs-answer');
    expect([l.system, l.distribution, l.faultCurrent, l.existing]).toEqual([null, null, null, null]);
    expect(l.panels).toEqual([]);
  });

  it('a plain 200 A house: one compact panel row, NO distribution question, not multi-panel', () => {
    const t = ok(answerServiceRating(null, 200));
    const l = serviceCardLayout(interviewOf(t), t);
    expect(l.distribution).toBeNull();
    expect(l.panels.map(p => p.panel.id)).toEqual(['msp-1']);
    expect(l.panels[0].item?.id).toBe('service.panel.msp-1');
    expect(l.multiPanel).toBe(false);
    expect(l.faultCurrent?.id).toBe('service.fault-current');
    // 🚨 Nobody has said whether the equipment is existing or new: it is asked, never answered "new".
    expect(l.existing).toMatchObject({ state: 'needs-answer', source: 'Not established' });
    expect(l.existing?.answer).toBeUndefined();
  });

  it('400 A: asked how it is split; two 200 A main panels give two MSP rows', () => {
    const t400 = ok(answerServiceRating(null, 400));
    const l = serviceCardLayout(interviewOf(t400), t400);
    expect(l.distribution?.options?.map(o => o.value)).toEqual(['one-main-panel', 'two-main-panels', 'custom']);
    expect(l.distribution?.state).toBe('needs-answer');
    expect(l.panels).toEqual([]);
    const two = ok(answerDistribution(t400, 'two-main-panels'));
    const l2 = serviceCardLayout(interviewOf(two), two);
    expect(l2.distribution?.value).toBe('two-main-panels');
    expect(l2.panels.map(p => p.panel.label)).toEqual(['MSP #1', 'MSP #2']);
    expect(l2.multiPanel).toBe(true);
  });
});

describe('the 120% rule on THIS panel — the engine\'s verdict, and its remedies only on a FAIL', () => {
  // A Powerwall 3 landed on a 200 A bus behind a 200 A main: 48 A of backfeed, 40 A allowed.
  const failing = buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;
  const checks = evaluateServiceTopology(failing).checks;

  it('reads the engine\'s FAIL for the panel the system backs up', () => {
    const c = panelBusbarCheck(failing, checks, 'msp-1');
    expect(c?.conclusion).toBe('FAIL');
    expect(c?.detail).toBe('48.0 A of backfeed exceeds the 40.0 A allowed on a 200 A bus with a 200 A main.');
    expect(panelBusbarCheck(failing, checks, 'nope')).toBeNull();
    expect(panelBusbarCheck(failing, null, 'msp-1')).toBeNull();
  });

  it('per panel: on Ray\'s job MSP #1 reads System 1\'s verdict and MSP #2 reads System 2\'s', () => {
    const rays = buildRaysIntendedJob().topology;
    const rc = evaluateServiceTopology(rays).checks;
    expect(panelBusbarCheck(rays, rc, 'msp-1')?.scope).toBe('domain:domain-a');
    expect(panelBusbarCheck(rays, rc, 'msp-2')?.scope).toBe('domain:domain-b');
    expect(panelBusbarCheck(rays, rc, 'msp-1')?.conclusion).toBe('PASS');
    expect(busbarRemedies(rays.panels[0], panelBusbarCheck(rays, rc, 'msp-1'))).toBeNull();
  });

  it('a panel no system backs up has no 120% verdict from the graph — and no remedy', () => {
    const t = ok(answerServiceRating(null, 200));
    const c = panelBusbarCheck(t, evaluateServiceTopology(t).checks, 'msp-1');
    expect(c).toBeNull();
    expect(busbarRemedies(t.panels[0], c)).toBeNull();
  });

  it('on a FAIL: derate the main (175 A allows 65 A) or upgrade the bus (225 A allows 70 A)', () => {
    const r = busbarRemedies(failing.panels[0], panelBusbarCheck(failing, checks, 'msp-1'))!;
    expect(r.derateMain[0]).toEqual({ amps: 175, allowsA: 65 });
    expect(r.derateMain.map(x => x.amps)).toEqual([175, 150, 125, 110, 100]);
    expect(r.upgradeBus).toEqual([{ amps: 225, allowsA: 70 }, { amps: 320, allowsA: 184 }, { amps: 400, allowsA: 280 }]);
  });

  // The card lists these as proposed work and never writes them; once the work is done, the
  // installed rating recorded on the panel is what the engine re-checks — and the allowances agree.
  it('…and once the remedy is installed and recorded through answerPanel, the engine\'s verdict is PASS', () => {
    const derated = ok(answerPanel(failing, 'msp-1', { mainBreakerA: 175 }));
    const c = panelBusbarCheck(derated, evaluateServiceTopology(derated).checks, 'msp-1');
    expect(c?.conclusion).toBe('PASS');
    expect(busbarRemedies(derated.panels[0], c)).toBeNull();
    const upgraded = ok(answerPanel(failing, 'msp-1', { busbarRatingA: 225 }));
    expect(panelBusbarCheck(upgraded, evaluateServiceTopology(upgraded).checks, 'msp-1')?.conclusion).toBe('PASS');
  });

  it('no remedy is offered for a rating nobody entered', () => {
    const c = panelBusbarCheck(failing, checks, 'msp-1');
    expect(busbarRemedies({ ...failing.panels[0], mainBreakerA: null }, c)).toBeNull();
    expect(busbarRemedies({ ...failing.panels[0], busbarRatingA: null }, c)).toBeNull();
  });
});

describe('rating ladders', () => {
  it('the main breaker ladder is NEC 240.6(A) sizes plus the busbar ladder — 175 A is offered, 320 A kept', () => {
    expect(MAIN_BREAKER_RATINGS).toContain(175);
    expect(MAIN_BREAKER_RATINGS).toContain(320);
    expect(MAIN_BREAKER_RATINGS).not.toContain(55);
    expect([...MAIN_BREAKER_RATINGS]).toEqual([...MAIN_BREAKER_RATINGS].sort((a, b) => a - b));
  });

  it('a select always offers the value the graph records', () => {
    expect(withRecorded(BUSBAR_RATINGS, 180)).toContain(180);
    expect(withRecorded(BUSBAR_RATINGS, 200)).toEqual([...BUSBAR_RATINGS]);
    expect(withRecorded(BUSBAR_RATINGS, null)).toEqual([...BUSBAR_RATINGS]);
  });
});

describe('never a preset where a reading belongs, and never a silent discard', () => {
  it('withoutPresetPanelRatings: the panel the preset built keeps its place and label, but main / bus are asked', () => {
    const r = withoutPresetPanelRatings(answerServiceRating(null, 200));
    const t = ok(r);
    expect(t.panels.map(p => [p.label, p.mainBreakerA, p.busbarRatingA])).toEqual([['MSP #1', null, null]]);
    expect(r.ok && r.did).toBe('200 A service with one 200 A main panel; MSP #1 — main breaker and busbar to be read off the panel label');
    // Read back, the row is a question — not "Installer entered".
    expect(serviceCardLayout(interviewOf(t), t).panels[0].item).toMatchObject({ state: 'needs-answer', source: 'Not established' });
  });

  it('…a distribution rebuild likewise; a refusal and a graph with no panels pass through untouched', () => {
    const two = ok(withoutPresetPanelRatings(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')));
    expect(two.branches.map(b => b.ratedAmps)).toEqual([200, 200]);
    expect(two.panels.map(p => [p.mainBreakerA, p.busbarRatingA])).toEqual([[null, null], [null, null]]);
    const refused = answerDistribution(buildRaysIntendedJob().topology, 'one-main-panel');
    expect(refused.ok).toBe(false);
    expect(withoutPresetPanelRatings(refused)).toBe(refused);
    const bare = answerServiceRating(null, 400);
    expect(withoutPresetPanelRatings(bare)).toBe(bare);
  });

  it('panelRecordedFacts: one line per panel that has anything recorded', () => {
    const t = ok(answerPanel(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')), 'msp-2',
      { mainBreakerA: null, busbarRatingA: null, manufacturer: 'Eaton' }));
    expect(panelRecordedFacts(t)).toEqual(['MSP #1: Main 200 A · Bus 200 A', 'MSP #2: Eaton']);
    expect(panelRecordedFacts(ok(withoutPresetPanelRatings(answerServiceRating(null, 200))))).toEqual([]);
    expect(panelRecordedFacts(null)).toEqual([]);
  });

  it('existingRecordedFacts: what a site visit read — empty when nothing was', () => {
    const rays = buildRaysIntendedJob().topology;
    expect(existingRecordedFacts(rays.service.existingEquipment)).toEqual(['Eaton']);
    const read = ok(answerExistingService(rays, { existing: true, sccrA: 22_000, verified: true }));
    expect(existingRecordedFacts(read.service.existingEquipment)).toEqual(['Eaton', '22 kA AIC', 'read on site']);
    expect(existingRecordedFacts(ok(answerExistingService(ok(answerServiceRating(null, 200)), { existing: true }))
      .service.existingEquipment)).toEqual([]);
    expect(existingRecordedFacts(null)).toEqual([]);
  });
});

describe('a split the rating no longer asks about is never stranded', () => {
  const two400 = () => ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));

  it('400 A → 200 A with two MSPs: the distribution stays, FAILS in the engine\'s own words, and offers one panel', () => {
    const t = ok(answerServiceRating(two400(), 200));
    const iv = interviewOf(t);
    expect(allInterviewItems(iv).find(i => i.id === 'service.distribution')).toBeUndefined();   // no longer asked
    const branchSum = iv.evaluation!.checks.find(c => c.id === 'service.branch-sum')!;
    expect(branchSum.conclusion).toBe('FAIL');
    const d = serviceCardLayout(iv, t).distribution!;
    expect(d).toMatchObject({
      id: 'service.distribution', state: 'fails', value: null, why: branchSum.detail, answer: '2 main panels (200 A + 200 A)',
    });
    expect(d.options).toEqual([{ value: 'one-main-panel', label: 'One 200 A main panel' }]);
  });

  it('a 400 A single branch left on a 200 A service is stranded too (one branch, but it FAILS the rating)', () => {
    const t = ok(answerServiceRating(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'one-main-panel')), 200));
    expect(serviceCardLayout(interviewOf(t), t).distribution).toMatchObject({ state: 'fails', answer: 'One 400 A main panel' });
  });

  it('the asked question on a split that no longer fits (two 200 A on 320 A) FAILS with nothing pressed', () => {
    const t = ok(answerServiceRating(two400(), 320));
    const d = serviceCardLayout(interviewOf(t), t).distribution!;
    expect(d.state).toBe('fails');
    expect(d.value).toBeNull();
    expect(d.options?.map(o => o.value)).toEqual(['one-main-panel', 'two-main-panels', 'custom']);
  });

  it('a plain 200 A house and a fitting 400 A split are untouched', () => {
    const h = ok(answerServiceRating(null, 200));
    expect(serviceCardLayout(interviewOf(h), h).distribution).toBeNull();
    const t = two400();
    expect(serviceCardLayout(interviewOf(t), t).distribution).toMatchObject({ state: 'answered', value: 'two-main-panels' });
  });
});
