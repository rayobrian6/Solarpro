/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE ENGINEERING PAGE'S READERS OF AN APPLIED 120% REMEDY, RENDERED.
//
// Review finding: the page wiring was checked only by source regexes, so `scheduledRemedies = []`, a
// dropped compliance row, or an [Answer Next] that opened nothing for the derate's load calculation
// all stayed green. These are the components the page renders (components/engineering/
// BusbarRemedyRows.tsx) and the ItemEditor route [Answer Next] takes — each proved by what it shows
// for a graph with and without the remedy.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import {
  answerBusbarRemedy, answerPanel, answerInterconnection, answerServiceRating, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { evaluateServiceTopology, REMEDY_LOAD_CALCULATION_TOKEN, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { complianceInterconnection } from '@/lib/electrical/systemConfigLegacyInterconnection';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { allInterviewItems } from '@/lib/electrical/systemConfigPlacement';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import {
  RemedyApplyPointer, ComplianceProposedWorkRow, ScheduleRemedyRows,
} from '@/components/engineering/BusbarRemedyRows';
import { ItemEditor, applyVia } from '@/components/engineering/systemConfig/ItemEditor';

afterEach(cleanup);

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const failing = () => buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;
const derated = (a = 150) => ok(answerBusbarRemedy(failing(), 'msp-1', { kind: 'replace-main-breaker', mainBreakerA: a }));
const upgraded = (a = 225) => ok(answerBusbarRemedy(failing(), 'msp-1', { kind: 'replace-panelboard', busbarRatingA: a }));
const pvOnly = () => ok(answerPanel(ok(answerInterconnection(ok(answerServiceRating(null, 200)), 'load-side-busbar')),
  'msp-1', { mainBreakerA: 200, busbarRatingA: 100 }));

describe('the compliance alternative points at [Apply] only where there is one', () => {
  it('a failing backed-up panel: the pointer is a button, and clicking it only navigates', () => {
    const onOpen = vi.fn();
    render(<RemedyApplyPointer topology={failing()} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId('electrical-apply-remedy'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('electrical-apply-remedy-unavailable')).toBeNull();
  });

  it('🚨 a PV-only load-side job: no [Apply] exists on the Service card, so none is promised', () => {
    render(<RemedyApplyPointer topology={pvOnly()} onOpen={() => undefined} />);
    expect(screen.queryByTestId('electrical-apply-remedy')).toBeNull();
    expect(screen.getByTestId('electrical-apply-remedy-unavailable').textContent).toMatch(/No \[Apply\] for this configuration yet/);
  });

  it('no graph at all: nothing to apply either', () => {
    render(<RemedyApplyPointer topology={null} onOpen={() => undefined} />);
    expect(screen.queryByTestId('electrical-apply-remedy')).toBeNull();
  });
});

describe('the compliance result\'s proposed-work line', () => {
  it('states the applied remedy the request carried; nothing without one', () => {
    const ic = complianceInterconnection({ method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, derated(150));
    const { rerender } = render(<ComplianceProposedWorkRow proposedWork={ic.proposedWork} />);
    expect(screen.getByTestId('compliance-proposed-work').textContent)
      .toBe('Proposed work (120% remedy)Main service panel: Replacement main breaker 150 A — replaces the installed 200 A main');
    rerender(<ComplianceProposedWorkRow proposedWork={complianceInterconnection(
      { method: 'LOAD_SIDE', busRating: 200, mainBreaker: 200 }, failing()).proposedWork} />);
    expect(screen.queryByTestId('compliance-proposed-work')).toBeNull();
  });
});

describe('the Equipment Schedule\'s (N) rows', () => {
  const table = (t: ServiceTopology | null) => render(<table><tbody><ScheduleRemedyRows topology={t} /></tbody></table>);

  it('one (N) row per panel with applied work, worded as the work', () => {
    table(derated(150));
    const row = screen.getByTestId('schedule-remedy-msp-1');
    expect(row.textContent).toBe('(N) Main service panel — proposed workReplacement main breaker 150 A — replaces the installed 200 A main150A mainNEC 705.12(B)');
    cleanup();
    table(upgraded(225));
    expect(screen.getByTestId('schedule-remedy-msp-1').textContent).toContain('225A bus / 200A main');
  });

  it('no row without [Apply]', () => {
    table(failing());
    expect(screen.queryByTestId('schedule-remedy-msp-1')).toBeNull();
  });
});

describe('🚨 [Answer Next] on a derate\'s load calculation opens the load analysis — and writes through apply', () => {
  const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
  const NO_EQUIPMENT = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };
  const itemOf = (t: ServiceTopology, id: string) => allInterviewItems(buildSystemConfigInterview({
    pvArray: pv20, topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
    equipment: { pvInverter: { state: 'NONE', label: null, kind: null }, storage: null, gateway: null },
    evaluation: evaluateServiceTopology(t),
  })).find(i => i.id === id);

  it('the item is routed to the load analysis editor, and choosing a method writes the graph', async () => {
    const t = derated(150);
    const item = itemOf(t, `engineering.needs.${REMEDY_LOAD_CALCULATION_TOKEN}msp-1`)!;
    expect(item).toBeTruthy();
    const writes: ServiceTopology[] = [];
    render(<ItemEditor item={item} topology={t} pvArray={pv20} derivedStrings={[]} equipment={NO_EQUIPMENT}
      busy={false} apply={applyVia(async next => { writes.push(next); return true; })} />);
    const method = screen.getByTestId('answer-loads-method') as HTMLSelectElement;
    const choice = [...method.options].find(o => o.value !== '')!.value;
    fireEvent.change(method, { target: { value: choice } });
    fireEvent.click(screen.getByTestId('answer-loads-add'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].loads?.method).toBe(choice);
    // The remedy is untouched by the answer — the load analysis is a separate record.
    expect(writes[0].panels[0].remedy).toEqual({ kind: 'replace-main-breaker', mainBreakerA: 150 });
  });

  it('without a derate there is no such item to route', () => {
    expect(itemOf(failing(), `engineering.needs.${REMEDY_LOAD_CALCULATION_TOKEN}msp-1`)).toBeUndefined();
  });
});
