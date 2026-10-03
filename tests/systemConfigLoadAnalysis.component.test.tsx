/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The System Config card renders the optional load analysis in its Engineering section, and each
// control writes the service graph through the page's `onWrite` — the same path the PUT route sits
// behind. (The PUT → GET → engineering round trip is proven in the .postgres test beside this one.)
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SystemConfigInterview } from '@/components/engineering/systemConfig/SystemConfigInterview';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerElectricalSystem, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerLoadAnalysisMethod, answerPanelDemand } from '@/lib/electrical/systemConfigLoadAnalysis';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult): ServiceTopology => {
  if (r.ok === false) throw new Error(r.refused);
  return r.topology;
};

function mount(t: ServiceTopology) {
  const writes: ServiceTopology[] = [];
  const interview = buildSystemConfigInterview({
    pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  });
  render(
    <SystemConfigInterview
      interview={interview} topology={t} pvArray={pv20} derivedStrings={[]}
      equipment={{ gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }}
      mode="manual" busy={false} error={null}
      onWrite={async next => { writes.push(next); return true; }}
      onRecordCoupling={async () => true}
      // The page always passes its pickers; the load analysis lives outside the Equipment card.
      equipmentSlot={<div data-testid="equipment-pickers" />} />,
  );
  return writes;
}

const house200 = () => ok(answerServiceRating(null, 200));

describe('the System Config card edits the optional load analysis', () => {
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
