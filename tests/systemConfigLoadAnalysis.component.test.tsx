/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The optional load analysis, clicked: each control writes the service graph through `apply` — the
// page's one write path, the same one the PUT route sits behind. (The PUT → GET → engineering round
// trip is proven in the .postgres test beside this one.)
//
// REWRITTEN FOR V3, NOT DELETED (2026-10-03). The analysis used to be edited in the five-card
// interview's Engineering Result card. Its home is now the Engineering Readiness panel's REVIEW
// ENGINEERING modal ("the optional load analysis editor. Detail lives here, not on the page."), so
// every case below opens that modal and proves the same behaviour there: the method is never
// assumed, a typo never deletes a stored figure, a FAIL is never quiet, and an optional analysis
// never turns the engineering amber by itself.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen as page, cleanup, fireEvent, waitFor, act, within } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerElectricalSystem, answerDistribution, answerInterconnection,
  answerIsolationRequired, answerAvailableFaultCurrent, answerPanel, answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { answerLoadAnalysisMethod, answerPanelDemand } from '@/lib/electrical/systemConfigLoadAnalysis';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { addProtectiveDevice, setSolarCoupling, updatePanel } from '@/lib/electrical/topologyAuthoring';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { applyVia } from '@/components/engineering/systemConfig/ItemEditor';

afterEach(cleanup);

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};

const interviewOf = (t: ServiceTopology) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: evaluateServiceTopology(t),
});

const NO_EQUIPMENT = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };

/** Everything below is asked inside Review Engineering: queries are scoped to that modal. */
const screen = {
  getByTestId: (id: string) => within(page.getByTestId('review-engineering')).getByTestId(id),
  queryByTestId: (id: string) => within(page.getByTestId('review-engineering')).queryByTestId(id),
  queryAllByTestId: (id: string | RegExp) => within(page.getByTestId('review-engineering')).queryAllByTestId(id),
};
const openReview = () => fireEvent.click(page.getByTestId('readiness-review'));

function mount(t: ServiceTopology) {
  const writes: ServiceTopology[] = [];
  render(
    <EngineeringReadinessPanel
      interview={interviewOf(t)} topology={t} pvArray={pv20} derivedStrings={[]} equipment={NO_EQUIPMENT}
      busy={false} apply={applyVia(async next => { writes.push(next); return true; })} />,
  );
  openReview();
  return writes;
}

/**
 * The page's loop, live: every write becomes the topology the panel is rebuilt from, as the page does
 * after its PUT. `setTopology` stands in for a change made elsewhere (another card, a reload).
 */
function mountLive(initial: ServiceTopology) {
  const writes: ServiceTopology[] = [];
  let setTopology: (t: ServiceTopology) => void = () => undefined;
  function Page() {
    const [t, setT] = useState(initial);
    setTopology = setT;
    return (
      <EngineeringReadinessPanel
        interview={interviewOf(t)} topology={t} pvArray={pv20} derivedStrings={[]} equipment={NO_EQUIPMENT}
        busy={false} apply={applyVia(async next => { writes.push(next); setT(next); return true; })} />
    );
  }
  render(<Page />);
  openReview();
  return { writes, setTopology: (t: ServiceTopology) => act(() => setTopology(t)) };
}

const settle = () => act(() => new Promise<void>(r => setTimeout(r, 0)));
const house200 = () => ok(answerServiceRating(null, 200));
/** Ray's two-panel job with the analysis added and MSP #1 = 92 A — a partial model. */
const partialRays = () => ok(answerPanelDemand(
  ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii')), 'msp-1', 92));
/** A 400 A, two-panel micro house with every required fact answered (Engineering reads Complete). */
const resolved400 = (): ServiceTopology => {
  let t = ok(answerServiceRating(null, 400));
  t = ok(answerDistribution(t, 'two-main-panels'));
  t = ok(answerInterconnection(t, 'load-side-busbar'));
  t = ok(answerIsolationRequired(t, false));
  t = ok(answerAvailableFaultCurrent(t, 10_000));
  // Existing or new is a required answer, never defaulted to new.
  t = ok(answerExistingService(t, { existing: false }));
  for (const p of t.panels) t = ok(answerPanel(t, p.id, { mainBreakerA: 200, busbarRatingA: 225 }));
  for (const p of t.panels) t = updatePanel(t, p.id, { sccrA: 22_000 });
  t = addProtectiveDevice(t, { label: 'Service disconnect', roles: ['service-disconnect'], ratedAmps: 400 }).topology;
  t = { ...t, devices: t.devices.map(d => ({ ...d, sccrA: 22_000, productId: 'eaton-dg224urk' })) };
  return setSolarCoupling(t, 'ac-coupled-inverter');
};

describe('Review Engineering edits the optional load analysis', () => {
  it('Add stays disabled until a method is chosen; choosing one writes exactly that method', async () => {
    const writes = mount(house200());
    expect(screen.getByTestId('interview-item-engineering.loads').getAttribute('data-state')).toBe('answered');
    const add = screen.getByTestId('answer-loads-add') as HTMLButtonElement;
    expect(add.disabled, 'a method was assumed').toBe(true);
    fireEvent.change(screen.getByTestId('answer-loads-method'), { target: { value: 'existing-dwelling-220-87' } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].loads).toEqual({ method: 'existing-dwelling-220-87', basis: '', byPanel: [], otherDemandA: null });
  });

  it('on a 3φ service NEC 220.82 is not in the picker, and the card says why', () => {
    mount(ok(answerElectricalSystem(house200(), 'wye-208')));
    const values = Array.from((screen.getByTestId('answer-loads-method') as HTMLSelectElement).options).map(o => o.value);
    expect(values).not.toContain('optional-220-82');
    expect(values).toContain('standard-220-part-iii');
    expect(screen.getByTestId('answer-loads-unavailable-optional-220-82').textContent).toMatch(/NEC 220\.82\(A\).*120\/208 V 3φ wye/);
  });

  it('one figure per panelboard: blurring MSP #2 writes that panel only; a partial model shows no subtotal', async () => {
    const t = ok(answerPanelDemand(ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii')), 'msp-1', 92));
    const writes = mount(t);
    // No per-path and no per-system inputs exist — only panelboards.
    expect(screen.queryAllByTestId(/^answer-loads-panel-/).map(e => e.getAttribute('data-testid')))
      .toEqual(['answer-loads-panel-msp-1', 'answer-loads-panel-msp-2']);
    const derived = screen.getByTestId('answer-loads-derived');
    expect(derived.getAttribute('data-complete')).toBe('no');
    expect(derived.textContent).toMatch(/cannot be summed until every panelboard has a figure \(1 of 2 entered\)/);
    expect(screen.queryByTestId('answer-loads-aggregate')).toBeNull();

    const input = screen.getByTestId('answer-loads-panel-msp-2') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].loads?.byPanel).toEqual([
      { panelId: 'msp-1', calculatedDemandA: 92 }, { panelId: 'msp-2', calculatedDemandA: 80 }]);
  });

  it('every panelboard entered: the sums are shown as SolarPro\'s, per path and per system', () => {
    let t = ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii'));
    t = ok(answerPanelDemand(ok(answerPanelDemand(t, 'msp-1', 92)), 'msp-2', 80));
    mount(t);
    expect(screen.getByTestId('answer-loads-derived').getAttribute('data-complete')).toBe('yes');
    expect(screen.getByTestId('answer-loads-aggregate').textContent).toContain('172.0 A');
    expect(screen.getByTestId('answer-loads-path-branch-a').textContent).toBe('200 A service path 1: 92.0 A');
    expect(screen.getByTestId('answer-loads-system-domain-b').textContent).toBe('System 2 backed-up load: 80.0 A');
    expect(screen.getByTestId('interview-item-engineering.loads.check.service.demand.site').getAttribute('data-state')).toBe('calculated');
  });

  it('Remove writes the graph with no load model', async () => {
    const writes = mount(ok(answerLoadAnalysisMethod(house200(), 'standard-220-part-iii')));
    fireEvent.click(screen.getByTestId('answer-loads-remove'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].loads).toBeNull();
  });
});

describe('a figure is deleted only by a deliberate blank', () => {
  it('🚨 something that is not a number (the field reads empty) is REFUSED — the stored 92 A is kept and shown', async () => {
    const writes = mount(partialRays());
    const input = screen.getByTestId('answer-loads-panel-msp-1') as HTMLInputElement;
    expect(input.value).toBe('92');
    // What a browser does with "92a" typed into a number field: value sanitizes to '' and
    // validity.badInput is true. (jsdom never sets badInput itself.)
    fireEvent.change(input, { target: { value: '' } });
    Object.defineProperty(input, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.blur(input);
    await settle();
    expect(writes, 'the stored figure was deleted').toEqual([]);
    expect(screen.getByTestId('answer-refusal').textContent).toMatch(/^MSP #1: enter a number of amperes\./);
    expect(input.value, 'the screen shows a figure the project does not hold').toBe('92');
  });

  it('…while an empty, valid field is the deliberate blank, and removes that panelboard’s figure', async () => {
    const writes = mount(partialRays());
    const input = screen.getByTestId('answer-loads-panel-msp-1') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].loads?.byPanel).toEqual([]);
  });

  it('a refused figure (zero, negative) is put back to what the project holds; the field sets no min of its own', async () => {
    const writes = mount(partialRays());
    const msp2 = screen.getByTestId('answer-loads-panel-msp-2') as HTMLInputElement;
    expect(msp2.hasAttribute('min'), 'zero is refused with a reason, not by the browser').toBe(false);
    fireEvent.change(msp2, { target: { value: '0' } });
    fireEvent.blur(msp2);
    await settle();
    expect(screen.getByTestId('answer-refusal').textContent).toMatch(/positive number of amperes/);
    expect(msp2.value).toBe('');
    const msp1 = screen.getByTestId('answer-loads-panel-msp-1') as HTMLInputElement;
    fireEvent.change(msp1, { target: { value: '-5' } });
    fireEvent.blur(msp1);
    await settle();
    expect(msp1.value).toBe('92');
    expect(writes).toEqual([]);
  });
});

describe('the method picked before Add is never a stale choice', () => {
  it('Add → Remove: the picker is empty again and Add is disabled until a method is chosen again', async () => {
    const { writes } = mountLive(house200());
    fireEvent.change(screen.getByTestId('answer-loads-method'), { target: { value: 'existing-dwelling-220-87' } });
    fireEvent.click(screen.getByTestId('answer-loads-add'));
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.click(screen.getByTestId('answer-loads-remove'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].loads).toBeNull();
    expect((screen.getByTestId('answer-loads-add') as HTMLButtonElement).disabled, 'a method was carried over').toBe(true);
    expect((screen.getByTestId('answer-loads-method') as HTMLSelectElement).value).toBe('');
  });

  it('a method picked, then no longer offered (the system became 3φ), is not a choice: Add is disabled', () => {
    const { setTopology } = mountLive(house200());
    fireEvent.change(screen.getByTestId('answer-loads-method'), { target: { value: 'optional-220-82' } });
    expect((screen.getByTestId('answer-loads-add') as HTMLButtonElement).disabled).toBe(false);
    setTopology(ok(answerElectricalSystem(house200(), 'wye-208')));
    expect((screen.getByTestId('answer-loads-add') as HTMLButtonElement).disabled, 'NEC 220.82 still armed on 3φ').toBe(true);
    expect((screen.getByTestId('answer-loads-method') as HTMLSelectElement).value).toBe('');
  });
});

describe('🚨 Review Engineering never lets a FAIL go quietly', () => {
  it('a failing analysis row says why (a red verdict with no reason is not a next step)', () => {
    mount(ok(answerPanelDemand(ok(answerLoadAnalysisMethod(buildRaysIntendedJob().topology, 'standard-220-part-iii')), 'msp-1', 250)));
    const row = screen.getByTestId('interview-item-engineering.loads');
    expect(row.getAttribute('data-state')).toBe('fails');
    expect(row.textContent).toMatch(/MSP #2 has no figure\. A partial load analysis is not a smaller load/);
    expect(row.textContent, 'an optional label beside a FAIL').not.toMatch(/nothing waits on it|— optional/i);
  });

  it('a recorded 450 A demand that FAILs: warned before the first figure, stated with its FAIL after it', async () => {
    const { writes } = mountLive(ok(answerLoadAnalysisMethod({ ...resolved400(), calculatedServiceDemandA: 450 }, 'standard-220-part-iii')));
    expect(screen.getByTestId('answer-loads-supersedes').textContent).toMatch(/demand recorded directly \(450\.0 A service demand\)/);
    expect(screen.getByTestId('interview-item-engineering.loads.recorded').textContent)
      .toMatch(/this FAIL would stop being reported without being resolved/);

    const input = screen.getByTestId('answer-loads-panel-msp-1');
    fireEvent.change(input, { target: { value: '92' } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));

    const row = screen.getByTestId('interview-item-engineering.loads.recorded');
    expect(row.getAttribute('data-state')).toBe('needs-verification');
    expect(row.textContent).toMatch(/no longer read\. It failed, and nothing evaluates that now — 450\.0 A calculated demand exceeds the 400 A service\./);
    expect(row.textContent).toMatch(/Nothing evaluates this demand now/);
    expect(screen.getByTestId('review-engineering-items').getAttribute('data-status')).toBe('needs-verification');
    expect(screen.queryByTestId('answer-loads-supersedes')).toBeNull();
  });

  it('an empty or partial analysis on a fully resolved job leaves the engineering Complete — and the job COMPLETE', () => {
    mount(ok(answerPanelDemand(ok(answerLoadAnalysisMethod(resolved400(), 'standard-220-part-iii')), 'msp-1', 92)));
    expect(screen.getByTestId('interview-item-engineering.loads').getAttribute('data-state')).toBe('answered');
    expect(screen.getByTestId('review-engineering-items').getAttribute('data-status')).toBe('complete');
    expect(screen.getByTestId('answer-loads-missing').textContent).toBe('MSP #2');
    // The optional analysis holds nothing up: no required answer, and the panel says so.
    expect(page.getByTestId('readiness-status').textContent).toMatch(/^(ELIGIBLE|COMPLETE)/);
    expect(page.queryByTestId('readiness-next-0')).toBeNull();
  });
});
