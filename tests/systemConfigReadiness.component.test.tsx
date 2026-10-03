/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the question dialog, the Engineering Readiness panel, the guided strip and the
// Engineering Summary tiles, clicked.
//
// Ray: "At the bottom, one compact ENGINEERING READINESS panel… [Answer Next] opens a dialog with the
// highest-priority unresolved question, rendered with the same editor its home card uses; Save writes
// through the normal path; the dialog closes; engineering re-evaluates; a line says 'N required
// answers remain'." Every write here goes through `apply` — the page's one write path.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerDistribution, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerLoadAnalysisMethod, answerPanelDemand } from '@/lib/electrical/systemConfigLoadAnalysis';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import {
  findInterviewItem, nextActionLabel, readinessCounts, requiredQueue,
} from '@/lib/electrical/systemConfigPlacement';
import { QuestionDialog, applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { GuidedStrip, revealHomeCard, HIGHLIGHT_CLASSES } from '@/components/engineering/systemConfig/GuidedStrip';
import { EngineeringSummaryFacts, factSlug } from '@/components/engineering/systemConfig/EngineeringSummaryFacts';

afterEach(() => { cleanup(); vi.useRealTimers(); document.body.innerHTML = ''; });

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const PW3: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const NO_EQUIPMENT = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };
const house200 = () => ok(answerServiceRating(null, 200));
const interviewOf = (t: ServiceTopology) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: MICROS, evaluation: evaluateServiceTopology(t),
});
const raysInterview = () => {
  const rays = { ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const };
  return { rays, iv: buildSystemConfigInterview({
    pvArray: pv37, topology: rays, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
    equipment: PW3, evaluation: evaluateServiceTopology(rays),
    derivedStrings: [9, 9, 9, 8, 2].map(panelCount => ({ panelCount })),
  }) };
};
const ctxFor = (t: ServiceTopology | null, onWrite: (n: ServiceTopology, w: string) => Promise<boolean>): ItemEditorContext => ({
  topology: t, pvArray: pv20, derivedStrings: [], equipment: NO_EQUIPMENT, busy: false, apply: applyVia(onWrite),
});

/** The page's loop: every accepted write becomes the graph the interview is rebuilt from. */
function mountLivePanel(initial: ServiceTopology) {
  const writes: ServiceTopology[] = [];
  function Page() {
    const [t, setT] = useState(initial);
    const onWrite = async (next: ServiceTopology) => { writes.push(next); setT(next); return true; };
    return <EngineeringReadinessPanel {...ctxFor(t, onWrite)} interview={interviewOf(t)} />;
  }
  render(<Page />);
  return writes;
}

describe('QuestionDialog — one question, accessible, closes after a successful write', () => {
  it('title = the question, provenance chip, why / owner / blocks behind [?], the editor; a write closes it', async () => {
    const t = house200();
    const iv = interviewOf(t);
    const item = findInterviewItem(iv, 'behavior.interconnection')!;
    const writes: ServiceTopology[] = [];
    const onClose = vi.fn();
    render(<QuestionDialog {...ctxFor(t, async n => { writes.push(n); return true; })} item={item} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-testid')).toBe('question-dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!;
    expect(title.textContent).toBe('Where does the system connect to the service?');
    expect(screen.getByTestId('question-provenance').textContent).toBe('Not established');
    const help = screen.getByTestId('question-help');
    expect(help.tagName).toBe('DETAILS');
    expect(help.textContent).toContain('SolarPro never assumes a load-side breaker');
    expect(help.textContent).toContain('Answer from: Installer');
    expect(help.textContent).toContain('Blocks: interconnection check, SLD, permit');

    fireEvent.click(within(screen.getByTestId('answer-interconnection-load-side-busbar')).getByRole('radio'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pointsOfInterconnection.every(p => p.relationship === 'load-side-busbar')).toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a failed write does not close it; Escape and the close button do', async () => {
    const t = house200();
    const item = findInterviewItem(interviewOf(t), 'behavior.interconnection')!;
    const onClose = vi.fn();
    render(<QuestionDialog {...ctxFor(t, async () => false)} item={item} onClose={onClose} />);
    fireEvent.click(within(screen.getByTestId('answer-interconnection-supply-side')).getByRole('radio'));
    await act(async () => { await Promise.resolve(); });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('question-dialog-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('an item edited in several writes (a panel\'s main and busbar) stays open after the first, and says it saved', async () => {
    const two = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    const item = findInterviewItem(interviewOf(two), `service.panel.${two.panels[0].id}`)!;
    const onClose = vi.fn();
    const writes: ServiceTopology[] = [];
    render(<QuestionDialog {...ctxFor(two, async n => { writes.push(n); return true; })} item={item} onClose={onClose} />);
    fireEvent.change(screen.getByTestId(`answer-panel-main-${two.panels[0].id}`), { target: { value: '150' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].panels[0].mainBreakerA).toBe(150);
    expect(await screen.findByTestId('question-saved')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('question-dialog-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('🚨 a refused answer (load analysis typo) is shown in the dialog and never written', async () => {
    const t = ok(answerPanelDemand(ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii')), 'msp-1', 92));
    const item = findInterviewItem(interviewOf(t), 'engineering.loads')!;
    const writes: ServiceTopology[] = [];
    const onClose = vi.fn();
    render(<QuestionDialog {...ctxFor(t, async n => { writes.push(n); return true; })} item={item} onClose={onClose} />);
    const input = screen.getByTestId('answer-loads-panel-msp-1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.blur(input);
    await act(async () => { await Promise.resolve(); });
    expect(writes).toEqual([]);
    expect(screen.getByTestId('answer-refusal').textContent).toMatch(/^MSP #1: enter a number of amperes\./);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a fact with no editor says where it is answered; null closes it', () => {
    const t = house200();
    const item = findInterviewItem(interviewOf(t), 'engineering.needs.interconnection.solarCoupling')!;
    const { rerender } = render(<QuestionDialog {...ctxFor(t, async () => true)} item={item} onClose={() => undefined} />);
    expect(screen.getByTestId('question-no-editor').textContent).toMatch(/^Nothing to enter here/);
    rerender(<QuestionDialog {...ctxFor(t, async () => true)} item={null} onClose={() => undefined} />);
    expect(screen.queryByTestId('question-dialog')).toBeNull();
  });
});

describe('ENGINEERING READINESS — counts, release status, the top three, Answer Next', () => {
  it('Ray\'s job: the engine\'s own counts, BLOCKED with the queue\'s count, and the queue\'s top three', () => {
    const { rays, iv } = raysInterview();
    render(<EngineeringReadinessPanel {...ctxFor(rays, async () => true)} pvArray={pv37} interview={iv} />);
    const c = readinessCounts(iv.evaluation!.checks);
    expect(screen.getByTestId('readiness-counts').textContent).toBe(`${c.pass} PASS · ${c.fail} FAIL · ${c.notEvaluated} NOT EVALUATED`);
    expect(c).toEqual({ pass: 26, fail: 0, notEvaluated: 23 });
    const queue = requiredQueue(iv);
    expect(screen.getByTestId('readiness-status').textContent).toBe(`BLOCKED — ${queue.length} required answers`);
    expect([0, 1, 2].map(i => screen.getByTestId(`readiness-next-${i}`).getAttribute('data-item-id')))
      .toEqual(queue.slice(0, 3).map(q => q.id));
    expect(screen.getByTestId('readiness-next-0').textContent).toContain(nextActionLabel(queue[0]));
    expect(screen.queryByTestId('readiness-next-3')).toBeNull();
  });

  it('[Answer Next] asks the top required item, the save writes it, the dialog closes, and the panel says what remains', async () => {
    const writes = mountLivePanel(house200());
    const before = requiredQueue(interviewOf(house200()));
    expect(before[0].id).toBe('service.fault-current');
    fireEvent.click(screen.getByTestId('readiness-answer-next'));
    const dialog = screen.getByTestId('question-dialog');
    expect(dialog.querySelector('[data-item-id]')?.getAttribute('data-item-id')).toBe('service.fault-current');
    const ka = within(dialog).getByTestId('answer-fault-current');
    fireEvent.change(ka, { target: { value: '10' } });
    fireEvent.blur(ka);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].service.availableFaultCurrentA).toBe(10_000);
    await waitFor(() => expect(screen.queryByTestId('question-dialog')).toBeNull());
    // Engineering re-evaluated with the answer: the fault current is no longer asked, and the line
    // states the LIVE queue (the SCCR comparisons it unlocked now name what they need).
    const after = requiredQueue(interviewOf(writes[0]));
    expect(after.map(q => q.id)).not.toContain('service.fault-current');
    expect(screen.getByTestId('readiness-remaining').textContent).toBe(`${after.length} required answers remain`);
    expect(screen.getByTestId('readiness-status').textContent).toBe(`BLOCKED — ${after.length} required answers`);
    expect(screen.getByTestId('readiness-next-0').getAttribute('data-item-id')).toBe(after[0].id);
  });

  it('…and answering an item that unlocks nothing new drops the count by exactly one', async () => {
    const writes = mountLivePanel(house200());
    const before = requiredQueue(interviewOf(house200()));
    fireEvent.click(within(screen.getByTestId('readiness-next-1')).getByRole('button'));   // "Choose the interconnection method"
    const dialog = screen.getByTestId('question-dialog');
    expect(dialog.querySelector('[data-item-id]')?.getAttribute('data-item-id')).toBe('behavior.interconnection');
    fireEvent.click(within(within(dialog).getByTestId('answer-interconnection-load-side-busbar')).getByRole('radio'));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('question-dialog')).toBeNull());
    expect(screen.getByTestId('readiness-remaining').textContent).toBe(`${before.length - 1} required answers remain`);
  });

  it('[Review Engineering] — every check grouped FAIL / NOT EVALUATED / PASS with its code, the editors, the needs and their owners', () => {
    const { rays, iv } = raysInterview();
    render(<EngineeringReadinessPanel {...ctxFor(rays, async () => true)} pvArray={pv37} interview={iv} />);
    expect(screen.queryByTestId('review-engineering')).toBeNull();
    fireEvent.click(screen.getByTestId('readiness-review'));
    const review = screen.getByTestId('review-engineering');
    expect(review.getAttribute('role')).toBe('dialog');
    const c = readinessCounts(iv.evaluation!.checks);
    expect(within(review).queryByTestId('review-checks-FAIL')).toBeNull();   // none fail
    expect(within(review).getByTestId('review-checks-NOT_EVALUATED').getAttribute('data-count')).toBe(String(c.notEvaluated));
    expect(within(review).getByTestId('review-checks-PASS').getAttribute('data-count')).toBe(String(c.pass));
    expect(within(review).getAllByTestId('review-check')).toHaveLength(iv.evaluation!.checks.length);
    const busbar = within(review).getAllByTestId('review-check').find(r => r.getAttribute('data-check-id') === 'domain.busbar-705-12')!;
    expect(within(busbar).getByTestId('review-check-code').textContent).toBe('NEC 705.12(B)');
    // the disconnect role editors, the multi-gateway document (no editor), the optional load analysis
    expect(within(review).getByTestId('answer-disconnect-role-service-disconnect')).toBeTruthy();
    expect(within(review).getByTestId('answer-loads-method')).toBeTruthy();
    expect(within(review).getByTestId('interview-item-engineering.disconnect.multi-gateway-doc').querySelector('input,select,button')).toBeNull();
    // what the engineering still needs, with who owes it
    const sccr = within(review).getByTestId('review-need-service.existingEquipment.sccrA');
    expect(sccr.textContent).toContain('Field verify');
    // the whole required list, each answerable
    expect(within(review).getAllByTestId(/^review-required-/)).toHaveLength(requiredQueue(iv).length);
  });
});

describe('GUIDED MODE — one line', () => {
  it('names the count and exactly one next item — the queue\'s first — and [Answer] hands that item over', () => {
    const iv = interviewOf(house200());
    const onAnswer = vi.fn();
    render(<GuidedStrip interview={iv} onAnswer={onAnswer} />);
    const queue = requiredQueue(iv);
    const strip = screen.getByTestId('guided-strip');
    expect(strip.textContent).toBe(`GUIDED MODE·${queue.length} required answers·Next: ${nextActionLabel(queue[0])}Answer`);
    expect(screen.getAllByTestId('guided-answer')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('guided-answer'));
    expect(onAnswer).toHaveBeenCalledWith(queue[0]);
  });

  it('[Answer] scrolls to the home card and rings it for a few seconds; a card not on the page falls back to the panel', () => {
    vi.useFakeTimers();
    const card = document.createElement('div');
    card.id = 'sc-card-system-config';
    const scrolled = vi.fn();
    card.scrollIntoView = scrolled;
    const panel = document.createElement('section');
    panel.id = 'engineering-readiness';
    panel.scrollIntoView = vi.fn();
    document.body.append(card, panel);

    expect(revealHomeCard('behavior.interconnection', 3000)).toBe(card);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(card.getAttribute('data-highlight')).toBe('true');
    for (const c of HIGHLIGHT_CLASSES) expect(card.classList.contains(c)).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(card.getAttribute('data-highlight')).toBeNull();
    expect(card.classList.contains('ring-2')).toBe(false);

    // The Service card is not on this page: the readiness panel is revealed instead.
    expect(revealHomeCard('service.fault-current')).toBe(panel);
  });

  it('the strip and the panel read the same queue — the mode never changes the release state', () => {
    const iv = interviewOf(house200());
    render(<>
      <GuidedStrip interview={iv} onAnswer={() => undefined} />
      <EngineeringReadinessPanel {...ctxFor(house200(), async () => true)} interview={iv} />
    </>);
    const n = requiredQueue(iv).length;
    expect(screen.getByTestId('guided-count').textContent).toBe(`${n} required answers`);
    expect(screen.getByTestId('readiness-status').textContent).toBe(`BLOCKED — ${n} required answers`);
  });
});

describe('ENGINEERING SUMMARY — compact tiles, every fact once', () => {
  it('Ray\'s job: PANELS · PV DC · PV AC (N/A — DC coupled) · STRINGS · STORAGE · ESS OUTPUT · GATEWAYS · SERVICE', () => {
    const { iv } = raysInterview();
    render(<EngineeringSummaryFacts facts={iv.summaryFacts} />);
    const tiles = screen.getAllByTestId(/^summary-tile-/).map(t => t.getAttribute('data-testid'));
    expect(tiles).toEqual(['PANELS', 'PV DC', 'PV AC', 'STRINGS', 'STORAGE', 'ESS OUTPUT', 'GATEWAYS', 'SERVICE']
      .map(t => `summary-tile-${factSlug(t)}`));
    expect(screen.getByTestId('summary-fact-pv-modules').textContent).toBe('37');
    expect(screen.getByTestId('summary-fact-pv-dc-size').textContent).toBe('16.28 kW');
    expect(screen.getByTestId('summary-fact-pv-ac-output').textContent).toBe('N/A — DC coupled');
    expect(screen.getByTestId('summary-fact-pv-strings').textContent).toBe('5 (9 / 9 / 9 / 8 / 2)');
    expect(screen.getByTestId('summary-fact-storage').textContent).toBe('4 × Tesla Powerwall 3');
    expect(screen.getByTestId('summary-fact-ess-max-continuous-ac-output').textContent).toBe('46.08 kW (192 A)');
    expect(screen.getByTestId('summary-fact-backup-controllers').textContent).toBe('2 × Tesla Gateway 3');
    expect(screen.getByTestId('summary-fact-pv-inverter').textContent).toBe('None — DC coupled to storage');
    expect(screen.getByTestId('summary-fact-distribution').textContent).toBe('2 × 200 A main panels');
    // every fact rendered exactly once
    for (const f of iv.summaryFacts) expect(screen.getAllByTestId(`summary-fact-${factSlug(f.label)}`)).toHaveLength(1);
    // provenance on every tile; no PV AC kW figure anywhere
    const pvAc = screen.getByTestId('summary-tile-pv-ac');
    expect(pvAc.getAttribute('data-source')).toBe('Installer decision');
    expect(pvAc.querySelector('[title]')?.getAttribute('title')).toContain('PV AC output: N/A — DC coupled — Installer decision');
    expect(screen.getByTestId('engineering-summary-facts').textContent).not.toMatch(/\d+\.\d\d kW AC/);
  });

  it('a fact no tile names is still shown, once', () => {
    render(<EngineeringSummaryFacts facts={[{ label: 'PV architecture', value: 'Not decided', source: 'Not established' }]} />);
    expect(screen.getByTestId('summary-facts-rest').textContent).toContain('Not decided');
    expect(screen.getAllByTestId('summary-fact-pv-architecture')).toHaveLength(1);
  });
});
