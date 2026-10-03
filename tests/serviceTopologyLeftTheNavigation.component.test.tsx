/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1, CLICKED — every installer decision the Service Topology tab used to be the only
// home of is answered in a System Config card, writes the graph through `apply` (the page's one write
// path), and is read back when the interview is rebuilt from the written graph.
//
//   · a PW3's commissioned output setting   → Battery card (one system: under the count; more than
//     one: per system behind [Configure systems differently])
//   · the generation panels' part / busbar / SCCR → Battery card [Select Equipment] (inline in Manual)
//   · a panelboard's SCCR                     → the panel row (Service card / Answer Next)
//   · the PV coupling where no question asks it → the question dialog, through `onRecordCoupling`
//   · the graph editor itself                 → only inside Review Engineering, behind a disclosure,
//     saving through the host's write path
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import {
  answerAvailableFaultCurrent, answerBackup, answerDistribution, answerServiceRating, answerStorageLanding,
  answerSystemsArrangement, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { outputConfigOf, systemEquipmentFacts } from '@/lib/electrical/systemConfigSystemEquipment';
import { GENERATION_PANELS_ITEM_ID } from '@/lib/electrical/systemConfigGenerationPanels';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { QuestionDialog, applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { BatteryStorageCard } from '@/components/engineering/systemConfig/cards/BatteryStorageCard';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { ServiceTopologyBuilder } from '@/components/engineering/ServiceTopologyBuilder';
import type { BatterySelection } from '@/lib/electrical/systemConfigBatteryCard';
import type { ControlMode } from '@/types';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pvArray = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const PW3_EQ: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const interviewOf = (t: ServiceTopology, eq: InterviewEquipment = PW3_EQ) => buildSystemConfigInterview({
  pvArray, topology: t, coupling: eq === MICROS ? null : 'dc-coupled-storage', couplingIsDecision: eq !== MICROS,
  architectureConflict: false, equipment: eq, evaluation: evaluateServiceTopology(t),
});
const EQUIPMENT = { gatewayProductId: GW3, storageProductId: PW3, storageLabel: 'Tesla Powerwall 3', totalUnits: 4 };
const SELECTION: BatterySelection = { batteryId: PW3, batteryCount: 4, batteryKwh: 13.5, backupControllerId: GW3, backupInterfaceId: '' };
const units = (t: ServiceTopology, domainId: string) => systemEquipmentFacts(t, t.domains.find(d => d.id === domainId)!).inverting;
const oneSystem = () => ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 2 }));

/**
 * The page's loop: every accepted write becomes the graph the interview is REBUILT from, exactly as
 * `writeInterviewAnswer` re-reads the graph and the page rebuilds `systemConfigInterview`.
 */
function LiveBattery({ initial, mode = 'auto', writes }: { initial: ServiceTopology; mode?: ControlMode; writes: ServiceTopology[] }) {
  const [t, setT] = useState(initial);
  const onWrite = async (next: ServiceTopology) => { writes.push(next); setT(next); return true; };
  return (
    <BatteryStorageCard interview={interviewOf(t)} controlMode={mode} topology={t} pvArray={pvArray} derivedStrings={[]}
                        busy={false} apply={applyVia(onWrite)} equipment={EQUIPMENT} selection={SELECTION}
                        onSelectionChange={() => {}} pvKw={16.28} />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
describe('Battery card — the commissioned output setting', () => {
  it('one system: "Commissioned at" under the count, written through apply, read back after the rebuild', async () => {
    const writes: ServiceTopology[] = [];
    render(<LiveBattery initial={oneSystem()} writes={writes} />);
    const sel = screen.getByTestId('bat-output-setting') as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect(Array.from(sel.options).map(o => o.value)).toEqual(['', '5.8', '7.6', '10', '11.5']);
    expect(sel.options[0].textContent).toBe('Not recorded — sized at 11.5 kW');
    fireEvent.change(sel, { target: { value: '7.6' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(writes).toHaveLength(1));
    const d = writes[0].domains[0];
    expect(outputConfigOf(writes[0], d)).toBe(7.6);
    expect(units(writes[0], d.id).map(u => [u.continuousOutputA, u.ocpdA])).toEqual([[31.7, 40], [31.7, 40]]);
    // The interview is rebuilt from the written graph — the control reads the decision back.
    await waitFor(() => expect((screen.getByTestId('bat-output-setting') as HTMLSelectElement).value).toBe('7.6'));
  });

  it('more than one system: per system, only behind [Configure systems differently], writing THAT system', async () => {
    const writes: ServiceTopology[] = [];
    render(<LiveBattery initial={buildRaysIntendedJob().topology} writes={writes} />);
    expect(screen.queryByTestId('bat-output-setting')).toBeNull();
    expect(screen.queryByTestId('bat-system-output-domain-a')).toBeNull();
    fireEvent.click(screen.getByTestId('bat-configure-differently'));
    const a = screen.getByTestId('bat-system-output-domain-a') as HTMLSelectElement;
    expect(a.value).toBe('11.5');
    fireEvent.change(a, { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-a'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(units(writes[0], 'domain-a').every(u => u.outputConfigKw === 10 && u.continuousOutputA === 41.7)).toBe(true);
    expect(units(writes[0], 'domain-b').every(u => u.outputConfigKw === 11.5 && u.continuousOutputA === 48)).toBe(true);
    await waitFor(() => expect((screen.getByTestId('bat-system-output-domain-a') as HTMLSelectElement).value).toBe('10'));
  });

  it('a battery whose manufacturer publishes no settings shows no control at all', () => {
    const t = ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', {
      gatewayProductId: 'enphase-iq-system-controller-3', storageProductId: 'enphase-iq-battery-5p', totalUnits: 2 }));
    render(<LiveBattery initial={t} writes={[]} />);
    expect(screen.getByTestId('bat-card').getAttribute('data-record')).toBe('service-graph');
    expect(screen.queryByTestId('bat-output-setting')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('Battery card — the generation panels the AC aggregation answer built', () => {
  const twoSystemsWithPanels = () => {
    let t = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    t = ok(answerBackup(t, 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 4,
      unitsPerPanel: { 'msp-1': 2, 'msp-2': 2 } }));
    t = ok(answerStorageLanding(t, 'der-aggregation-panel'));
    return ok(answerSystemsArrangement(t, 'independent-branch'));
  };

  it('no generation panel ⇒ no row', () => {
    render(<LiveBattery initial={oneSystem()} writes={[]} />);
    expect(screen.queryByTestId('bat-generation-row')).toBeNull();
  });

  it('[Select Equipment] → the dialog; a part, its busbar and SCCR each write the graph; the row reads the rebuild', async () => {
    const writes: ServiceTopology[] = [];
    render(<LiveBattery initial={twoSystemsWithPanels()} writes={writes} />);
    const row = screen.getByTestId('bat-generation-row');
    expect(row.getAttribute('data-state')).toBe('needs-answer');
    expect(screen.getByTestId('bat-generation-summary').textContent).toBe('2 · parts not selected');
    fireEvent.click(screen.getByTestId('bat-generation-select'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('[data-item-id]')!.getAttribute('data-item-id')).toBe(GENERATION_PANELS_ITEM_ID);
    // The engine's requirement, read — never the service rating.
    expect(within(dialog).getByTestId('answer-generation-requirement-agg-1').textContent)
      .toBe('Requirement: 125 A output OCPD and busbar for 96 A of DER · 2 breaker positions');
    for (const id of ['agg-1', 'agg-2']) {
      const part = within(dialog).getByTestId(`answer-generation-part-${id}`);
      fireEvent.change(part, { target: { value: 'Eaton BR816L125RP' } });
      fireEvent.blur(part);
      await waitFor(() => expect(writes.at(-1)!.aggregationPanels.find(a => a.id === id)!.productId).toBe('Eaton BR816L125RP'));
      const bus = screen.getByTestId(`answer-generation-bus-${id}`);
      fireEvent.change(bus, { target: { value: '125' } });
      fireEvent.blur(bus);
      await waitFor(() => expect(writes.at(-1)!.aggregationPanels.find(a => a.id === id)!.busbarRatingA).toBe(125));
      const sccr = screen.getByTestId(`answer-generation-sccr-${id}`);
      fireEvent.change(sccr, { target: { value: '10000' } });
      fireEvent.blur(sccr);
      await waitFor(() => expect(writes.at(-1)!.aggregationPanels.find(a => a.id === id)!.sccrA).toBe(10_000));
    }
    // The dialog stays open across the several writes and says it saved.
    expect(screen.getByTestId('question-saved')).toBeTruthy();
    fireEvent.click(screen.getByTestId('question-dialog-done'));
    await waitFor(() => expect(screen.getByTestId('bat-generation-row').getAttribute('data-state')).toBe('answered'));
    expect(screen.getByTestId('bat-generation-summary').textContent).toBe('2 · parts selected');
  });

  it('Manual mode: the same editor inline in the card', () => {
    render(<LiveBattery initial={twoSystemsWithPanels()} mode="manual" writes={[]} />);
    expect(screen.queryByTestId('bat-generation-row')).toBeNull();
    expect(within(screen.getByTestId('bat-generation-inline')).getByTestId('answer-generation-part-agg-2')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
const ctxFor = (t: ServiceTopology | null, onWrite: (n: ServiceTopology) => Promise<boolean>,
  over: Partial<ItemEditorContext> = {}): ItemEditorContext => ({
  topology: t, pvArray, derivedStrings: [], busy: false, apply: applyVia(async n => onWrite(n)),
  equipment: { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }, ...over,
});

describe('the question dialog answers what only the tab could', () => {
  it('a panelboard\'s SCCR — the panel row, in kA, written in amperes', async () => {
    const t = ok(answerAvailableFaultCurrent(ok(answerServiceRating(null, 200)), 10_000));
    const item = findInterviewItem(interviewOf(t, MICROS), 'engineering.needs.sccr:msp-1')!;
    const writes: ServiceTopology[] = [];
    render(<QuestionDialog {...ctxFor(t, async n => { writes.push(n); return true; })} item={item} onClose={() => {}} />);
    const input = within(screen.getByTestId('question-editor')).getByTestId('answer-panel-sccr-msp-1');
    fireEvent.change(input, { target: { value: '22' } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].panels[0].sccrA).toBe(22_000);
  });

  it('the Service card\'s panel row shows SCCR only once the fault current makes the chain need it', () => {
    const t = ok(answerServiceRating(null, 200));
    const iv = interviewOf(t, MICROS);
    render(<QuestionDialog {...ctxFor(t, async () => true)} item={findInterviewItem(iv, 'service.panel.msp-1')!} onClose={() => {}} />);
    expect(screen.queryByTestId('answer-panel-sccr-msp-1')).toBeNull();
  });

  it('"How does the new solar connect?" on a job with no storage — recorded through onRecordCoupling', async () => {
    const t = ok(answerServiceRating(null, 200));
    const item = findInterviewItem(interviewOf(t, MICROS), 'engineering.needs.interconnection.solarCoupling')!;
    const onRecordCoupling = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<QuestionDialog {...ctxFor(t, async () => true, { onRecordCoupling })} item={item} onClose={onClose} />);
    fireEvent.click(within(screen.getByTestId('answer-pv-coupling-ac-coupled-inverter')).getByRole('radio'));
    await waitFor(() => expect(onRecordCoupling).toHaveBeenCalledWith('ac-coupled-inverter'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the graph editor is a diagnostic surface: Review Engineering only, behind a disclosure', () => {
  const t = () => ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', { gatewayProductId: GW3, storageProductId: PW3, totalUnits: 2 }));

  it('not on the panel; inside Review Engineering, closed and NOT mounted until opened; labelled for what it is', () => {
    const topology = t();
    render(<EngineeringReadinessPanel {...ctxFor(topology, async () => true)} interview={interviewOf(topology)}
                                      advancedEditor={<div data-testid="the-advanced-editor">graph editor</div>} />);
    expect(screen.queryByTestId('review-advanced-editor')).toBeNull();
    fireEvent.click(screen.getByTestId('readiness-review'));
    const box = screen.getByTestId('review-advanced-editor');
    expect(screen.getByTestId('review-advanced-editor-toggle').textContent).toBe('Advanced service model editor');
    expect(box.textContent).toMatch(/For unusual systems only/);
    expect(screen.queryByTestId('the-advanced-editor')).toBeNull();
    (box as HTMLDetailsElement).open = true;
    fireEvent(box, new Event('toggle'));
    expect(screen.getByTestId('the-advanced-editor')).toBeTruthy();
  });

  it('without an editor handed in, Review Engineering shows no such section', () => {
    const topology = t();
    render(<EngineeringReadinessPanel {...ctxFor(topology, async () => true)} interview={interviewOf(topology)} />);
    fireEvent.click(screen.getByTestId('readiness-review'));
    expect(screen.queryByTestId('review-advanced-editor')).toBeNull();
  });

  it('the builder saves through the host\'s write path (onSave) — never its own PUT', async () => {
    const stored = buildRaysIntendedJob().topology;
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return { json: async () => ({ success: true, available: true, topology: stored }) } as unknown as Response;
    }) as unknown as typeof fetch;
    const onSave = vi.fn(async () => true);
    render(<ServiceTopologyBuilder projectId="4030b664-bebe-433b-a11c-cda05ead2f7d" fetchImpl={fetchImpl} onSave={onSave} />);
    await waitFor(() => expect(screen.getByTestId('topology-edit')).toBeTruthy());
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('node-msp-1'));
    fireEvent.change(within(screen.getByTestId('node-inspector')).getByTestId('inspector-panel-bus'), { target: { value: '225' } });
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = (onSave.mock.calls[0] as unknown as [ServiceTopology])[0];
    expect(saved.panels.find(p => p.id === 'msp-1')!.busbarRatingA).toBe(225);
    expect(calls.filter(c => c.startsWith('PUT'))).toEqual([]);
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toBe('Service model saved.'));
    expect(screen.queryByTestId('topology-save')).toBeNull();
  });

  it('a save the host refuses keeps the edit on screen, in edit mode', async () => {
    const stored = buildRaysIntendedJob().topology;
    const fetchImpl = (async () => ({ json: async () => ({ success: true, available: true, topology: stored }) }) as unknown as Response) as unknown as typeof fetch;
    render(<ServiceTopologyBuilder projectId="4030b664-bebe-433b-a11c-cda05ead2f7d" fetchImpl={fetchImpl} onSave={async () => false} />);
    await waitFor(() => expect(screen.getByTestId('topology-edit')).toBeTruthy());
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/Not saved/));
    expect(screen.getByTestId('topology-save')).toBeTruthy();
  });
});
