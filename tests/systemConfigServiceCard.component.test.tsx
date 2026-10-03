/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the EXISTING ELECTRICAL SERVICE card, clicked.
//
// Ray: "service in Service". The left-column card (where the old Main Service Panel card was) asks
// the service rating, the electrical system, the distribution (only when it is asked), one row per
// panelboard, the available fault current and the existing equipment's field verification
// ([Verify] → a compact dialog). A plain 200 A / one-MSP house shows NO multi-panel controls. A
// failing 120% check offers derate-main / upgrade-bus as edits of that panel.
//
// Every write goes through `apply` — the page's one write path — and the harness below is the page's
// loop: each accepted write becomes the graph the interview and the engine are rebuilt from.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import {
  answerServiceRating, answerDistribution, answerExistingService, answerPanel, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import {
  QuestionDialog, applyVia, guardGraphRead, type ItemEditorContext,
} from '@/components/engineering/systemConfig/ItemEditor';
import { ExistingElectricalServiceCard } from '@/components/engineering/systemConfig/cards/ExistingElectricalServiceCard';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const NO_EQUIPMENT = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };
const interviewOf = (t: ServiceTopology | null) => buildSystemConfigInterview({
  pvArray: pv20, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
  equipment: { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null },
  evaluation: t ? evaluateServiceTopology(t) : null,
});
const ctxFor = (t: ServiceTopology | null, onWrite: (n: ServiceTopology, w: string) => Promise<boolean>): ItemEditorContext => ({
  topology: t, pvArray: pv20, derivedStrings: [], equipment: NO_EQUIPMENT, busy: false, apply: applyVia(onWrite),
});
const house200 = () => ok(answerServiceRating(null, 200));
const rays = () => buildRaysIntendedJob().topology;
const flush = () => act(async () => { await Promise.resolve(); });

/** The page's loop: every accepted write is the next graph; the interview + engine are rebuilt from it. */
function mountLiveCard(initial: ServiceTopology | null, opts: { graphRead?: 'loading' | 'absent' | 'failed' | 'loaded' } = {}) {
  const writes: Array<{ next: ServiceTopology; what: string }> = [];
  function Page() {
    const [t, setT] = useState(initial);
    const onWrite = async (next: ServiceTopology, what: string) => { writes.push({ next, what }); setT(next); return true; };
    return (
      <div id="sc-card-service">
        <ExistingElectricalServiceCard {...ctxFor(t, onWrite)} interview={interviewOf(t)} graphRead={opts.graphRead} />
      </div>
    );
  }
  render(<Page />);
  return writes;
}

describe('a plain 200 A house — compact, and NO multi-panel controls', () => {
  it('rating, electrical system, one compact MSP row, fault current, existing equipment — nothing about splitting', () => {
    mountLiveCard(house200());
    expect((screen.getByTestId('svc-rating') as HTMLSelectElement).value).toBe('200');
    expect((screen.getByTestId('svc-system') as HTMLSelectElement).value).toBe('split-240');
    expect(screen.queryByTestId('svc-system-descriptor')).toBeNull();
    expect(screen.queryByTestId('svc-distribution')).toBeNull();
    expect(screen.queryAllByTestId(/^svc-distribution-/)).toHaveLength(0);
    expect(screen.getByTestId('svc-panels').getAttribute('data-multi')).toBe('false');
    expect(screen.getAllByTestId(/^svc-panel-main-/)).toHaveLength(1);
    expect((screen.getByTestId('svc-panel-main-msp-1') as HTMLSelectElement).value).toBe('200');
    expect((screen.getByTestId('svc-panel-bus-msp-1') as HTMLSelectElement).value).toBe('200');
    expect(screen.getByTestId('svc-fault-current')).toBeTruthy();
    expect((screen.getByTestId('svc-existing') as HTMLSelectElement).value).toBe('unanswered');
    expect(screen.getByTestId('svc-existing-unanswered')).toBeTruthy();
    expect(screen.queryByTestId('svc-existing-new')).toBeNull();
    expect(screen.queryByTestId('svc-verify')).toBeNull();
    // No 120% verdict exists for an un-backed-up panel, so no remedy is offered.
    expect(screen.queryByTestId('svc-panel-busbar-fail-msp-1')).toBeNull();
  });

  it('no graph yet: the rating is the one question, and answering it builds the one-panel service', async () => {
    const writes = mountLiveCard(null, { graphRead: 'absent' });
    expect(screen.getByTestId('svc-start')).toBeTruthy();
    expect(screen.queryByTestId('svc-system')).toBeNull();
    fireEvent.change(screen.getByTestId('svc-rating'), { target: { value: '200' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.ratedAmps).toBe(200);
    expect(writes[0].next.panels.map(p => p.label)).toEqual(['MSP #1']);
    expect(await screen.findByTestId('svc-panel-main-msp-1')).toBeTruthy();
    expect(screen.queryAllByTestId(/^svc-distribution-/)).toHaveLength(0);
  });

  it('🚨 the panel built from the rating has NO preset main / bus: they are read off its label, and the row asks for them', async () => {
    const writes = mountLiveCard(null, { graphRead: 'absent' });
    fireEvent.change(screen.getByTestId('svc-rating'), { target: { value: '200' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    // Before: main = bus = 200 was written, read back as "Installer entered", and the 120% check ran on it.
    expect(writes[0].next.panels.map(p => [p.mainBreakerA, p.busbarRatingA])).toEqual([[null, null]]);
    expect(writes[0].what).toBe('200 A service with one 200 A main panel; MSP #1 — main breaker and busbar to be read off the panel label');
    const row = await screen.findByTestId('svc-panel-msp-1');
    expect(row.getAttribute('data-state')).toBe('needs-answer');
    expect((screen.getByTestId('svc-panel-main-msp-1') as HTMLSelectElement).value).toBe('');
    expect((screen.getByTestId('svc-panel-bus-msp-1') as HTMLSelectElement).value).toBe('');
    // …and the row says so: where its figures came from, on every row.
    expect(screen.getByTestId('svc-panel-source-msp-1').getAttribute('data-source')).toBe('Not established');
  });

  it('every panel row carries its provenance chip — a recorded row says who entered it', () => {
    mountLiveCard(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')));
    expect(screen.getByTestId('svc-panel-source-msp-1').getAttribute('data-source')).toBe('Installer entered');
    expect(screen.getByTestId('svc-panel-source-msp-2').getAttribute('data-source')).toBe('Installer entered');
  });

  it('🚨 existing or new NOT ANSWERED is the open question — never "new", never "Installer entered"', () => {
    mountLiveCard(house200());
    const select = screen.getByTestId('svc-existing') as HTMLSelectElement;
    expect([...select.options].map(o => [o.value, o.textContent]))
      .toEqual([['unanswered', 'Not answered'], ['existing', 'Existing — keep it'], ['new', 'New service equipment']]);
    expect(select.value).toBe('unanswered');
    expect(screen.getByTestId('svc-existing-line').getAttribute('data-state')).toBe('needs-answer');
    expect(screen.getByTestId('svc-existing-source').getAttribute('data-source')).toBe('Not established');
    const line = screen.getByTestId('svc-existing-unanswered').textContent!;
    expect(line).toContain('SolarPro assumes neither');
    expect(line).not.toMatch(/as new/);
  });

  it('🚨 a service that could not be READ is not "no service": nothing can be answered over it', async () => {
    const writes = mountLiveCard(null, { graphRead: 'failed' });
    const rating = screen.getByTestId('svc-rating') as HTMLSelectElement;
    expect(rating.disabled).toBe(true);
    expect(screen.getByTestId('svc-unread').textContent).toMatch(/could not be read/);
    fireEvent.change(rating, { target: { value: '200' } });
    await flush();
    expect(writes).toEqual([]);
  });

  it('while the graph is being re-read, the card does not edit a stale copy of it', () => {
    mountLiveCard(house200(), { graphRead: 'loading' });
    for (const id of ['svc-rating', 'svc-system', 'svc-panel-main-msp-1', 'svc-panel-bus-msp-1', 'svc-fault-current']) {
      expect((screen.getByTestId(id) as HTMLInputElement).disabled, id).toBe(true);
    }
  });
});

describe('400 A — the split is asked here, and the MSP rows appear', () => {
  it('Two 200 A main panels → two MSP rows, each its own main / bus / manufacturer', async () => {
    const writes = mountLiveCard(ok(answerServiceRating(null, 400)));
    expect(screen.getByTestId('svc-distribution').getAttribute('data-state')).toBe('needs-answer');
    expect(screen.queryByTestId('svc-panels')).toBeNull();
    fireEvent.click(screen.getByTestId('svc-distribution-two-main-panels'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels.map(p => p.label)).toEqual(['MSP #1', 'MSP #2']);
    await screen.findByTestId('svc-panel-main-msp-2');
    expect(screen.getByTestId('svc-panels').getAttribute('data-multi')).toBe('true');
    expect(screen.getByTestId('svc-distribution-two-main-panels').getAttribute('aria-pressed')).toBe('true');
    // Clicking the recorded answer again writes nothing.
    fireEvent.click(screen.getByTestId('svc-distribution-two-main-panels'));
    await flush();
    expect(writes).toHaveLength(1);
  });

  it('each row writes ITS panel — never the service rating, never the other panel', async () => {
    const two = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    const writes = mountLiveCard(two);
    fireEvent.change(screen.getByTestId('svc-panel-main-msp-2'), { target: { value: '175' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels.map(p => p.mainBreakerA)).toEqual([two.panels[0].mainBreakerA, 175]);
    expect(writes[0].next.service.ratedAmps).toBe(400);
    fireEvent.change(screen.getByTestId('svc-panel-bus-msp-1'), { target: { value: '225' } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].next.panels.map(p => p.busbarRatingA)).toEqual([225, two.panels[1].busbarRatingA]);
    const mfr = screen.getByTestId('svc-panel-mfr-msp-1');
    fireEvent.change(mfr, { target: { value: ' Eaton ' } });
    fireEvent.blur(mfr);
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].next.panels[0].manufacturer).toBe('Eaton');
    // Unchanged on blur ⇒ no write.
    fireEvent.blur(screen.getByTestId('svc-panel-mfr-msp-1'));
    await flush();
    expect(writes).toHaveLength(3);
  });

  it('🚨 re-splitting a service that has backup systems on it is REFUSED in the card, and nothing is written', async () => {
    const writes = mountLiveCard(rays());
    fireEvent.click(screen.getByTestId('svc-distribution-one-main-panel'));
    await flush();
    expect(writes).toEqual([]);
    expect(screen.getByTestId('svc-refusal').textContent).toMatch(/already has backup systems or generation panels/);
  });

  it('a three-phase service states its own system — no separate workflow', async () => {
    const writes = mountLiveCard(house200());
    fireEvent.change(screen.getByTestId('svc-system'), { target: { value: 'wye-208' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.phase).toBe('wye-208');
    expect(writes[0].next.service.voltage).toBe(208);
    expect((await screen.findByTestId('svc-system-descriptor')).textContent).toBe('3φ · 4-wire (A, B, C, N)');
  });
});

describe('re-splitting never silently throws away what the installer entered', () => {
  const t400 = () => ok(answerServiceRating(null, 400));
  const twoWithEaton = () => ok(answerPanel(ok(answerDistribution(t400(), 'two-main-panels')), 'msp-1', { manufacturer: 'Eaton' }));

  it('"Other / custom" is not offered: it builds no branch and the card has nothing to collect them with', () => {
    mountLiveCard(t400());
    expect(screen.getByTestId('svc-distribution-one-main-panel')).toBeTruthy();
    expect(screen.getByTestId('svc-distribution-two-main-panels')).toBeTruthy();
    expect(screen.queryByTestId('svc-distribution-custom')).toBeNull();
  });

  it('a recorded custom split (three panels) is stated as what it is, not as an unanswered question', () => {
    mountLiveCard(ok(answerDistribution(t400(), 'three-main-panels')));
    expect(screen.getByTestId('svc-distribution-recorded').textContent).toMatch(/^Recorded: Three/);
    expect(screen.getAllByTestId(/^svc-panel-main-/)).toHaveLength(3);
  });

  it('🚨 One ↔ Two main panels with panel data recorded ASKS, listing what goes; Keep writes nothing', async () => {
    const writes = mountLiveCard(twoWithEaton());
    fireEvent.click(screen.getByTestId('svc-distribution-one-main-panel'));
    await flush();
    expect(writes).toEqual([]);
    const lost = [...screen.getByTestId('svc-confirm-distribution-lost').querySelectorAll('li')].map(li => li.textContent);
    expect(lost).toEqual(['MSP #1: Main 200 A · Bus 200 A · Eaton', 'MSP #2: Main 200 A · Bus 200 A']);
    fireEvent.click(screen.getByTestId('svc-confirm-distribution-no'));
    await flush();
    expect(writes).toEqual([]);
    expect(screen.getAllByTestId(/^svc-panel-main-/)).toHaveLength(2);

    fireEvent.click(screen.getByTestId('svc-distribution-one-main-panel'));
    fireEvent.click(screen.getByTestId('svc-confirm-distribution-yes'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.branches.map(b => b.ratedAmps)).toEqual([400]);
    // The rebuilt panel is asked, not presumed.
    expect(writes[0].next.panels.map(p => [p.mainBreakerA, p.busbarRatingA, p.manufacturer ?? null])).toEqual([[null, null, null]]);
  });

  it('a split with nothing recorded on it yet is rebuilt in one click, with blank panels', async () => {
    const writes = mountLiveCard(t400());
    fireEvent.click(screen.getByTestId('svc-distribution-two-main-panels'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels.map(p => [p.mainBreakerA, p.busbarRatingA])).toEqual([[null, null], [null, null]]);
    expect(screen.queryByTestId('svc-confirm-distribution')).toBeNull();
  });

  it('🚨 lowering the rating does not strand a split: 400 A → 200 A keeps the control, says why it FAILS, and collapses it', async () => {
    const two = ok(answerDistribution(t400(), 'two-main-panels'));
    const writes = mountLiveCard(two);
    fireEvent.change(screen.getByTestId('svc-rating'), { target: { value: '200' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels).toHaveLength(2);
    // Before: the distribution control vanished (the interview asks it only above 225 A) with both MSPs still on a 200 A service.
    const dist = await screen.findByTestId('svc-distribution');
    expect(dist.getAttribute('data-state')).toBe('fails');
    expect(screen.getByTestId('svc-distribution-fails').textContent).toMatch(/^2 branches total 400 A, which exceeds the 200 A service rating/);
    expect(screen.getByTestId('svc-distribution-recorded').textContent).toBe('Recorded: 2 main panels (200 A + 200 A)');
    expect(screen.getByTestId('svc-distribution-one-main-panel').textContent).toBe('One 200 A main panel');
    fireEvent.click(screen.getByTestId('svc-distribution-one-main-panel'));
    fireEvent.click(screen.getByTestId('svc-confirm-distribution-yes'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].next.service.ratedAmps).toBe(200);
    expect(writes[1].next.branches.map(b => b.ratedAmps)).toEqual([200]);
    await waitFor(() => expect(screen.queryByTestId('svc-distribution')).toBeNull());
    expect(evaluateServiceTopology(writes[1].next).checks.find(c => c.id === 'service.branch-sum')?.conclusion).toBe('PASS');
  });
});

describe('available fault current — the utility\'s number, compact', () => {
  it('10 kA is written as 10 000 A; a typo is refused, restored and never written', async () => {
    const writes = mountLiveCard(house200());
    const ka = screen.getByTestId('svc-fault-current') as HTMLInputElement;
    fireEvent.change(ka, { target: { value: '10' } });
    fireEvent.blur(ka);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.availableFaultCurrentA).toBe(10_000);

    const again = screen.getByTestId('svc-fault-current') as HTMLInputElement;
    expect(again.value).toBe('10');
    fireEvent.change(again, { target: { value: '' } });
    Object.defineProperty(again, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.blur(again);
    await flush();
    expect(writes).toHaveLength(1);
    expect(again.value).toBe('10');
    expect(screen.getByTestId('svc-refusal').textContent).toMatch(/^Available fault current: enter a number/);
  });
});

describe('existing service equipment — "Field verification N items required [Verify]"', () => {
  it('Ray\'s Eaton assembly: the line names the manufacturer and the engine\'s five owed items', () => {
    mountLiveCard(rays());
    expect((screen.getByTestId('svc-existing') as HTMLSelectElement).value).toBe('existing');
    expect((screen.getByTestId('svc-existing-mfr') as HTMLInputElement).value).toBe('Eaton');
    expect(screen.getByTestId('svc-existing-status').textContent).toBe('Field verification 5 items required');
    expect(screen.getByTestId('svc-existing-line').getAttribute('data-state')).toBe('needs-verification');
  });

  it('[Verify] opens a compact dialog; one Save records every field in one write; the count drops to "Field verified"', async () => {
    const writes = mountLiveCard(rays());
    fireEvent.click(screen.getByTestId('svc-verify'));
    const dialog = screen.getByTestId('svc-verify-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent)
      .toBe('Verify the existing service equipment — Eaton');
    for (const f of ['catalogNumber', 'mainArrangement', 'feederArrangement', 'sccrA', 'verified']) {
      expect(within(dialog).getByTestId(`svc-verify-needed-${f}`)).toBeTruthy();
    }
    fireEvent.change(within(dialog).getByTestId('svc-verify-catalogNumber'), { target: { value: 'CHU2040M200' } });
    fireEvent.change(within(dialog).getByTestId('svc-verify-mainArrangement'), { target: { value: 'Meter-main, two 200 A mains' } });
    fireEvent.change(within(dialog).getByTestId('svc-verify-feederArrangement'), { target: { value: 'One feeder to each MSP' } });
    fireEvent.change(within(dialog).getByTestId('svc-verify-sccrA'), { target: { value: '22' } });
    fireEvent.click(within(dialog).getByTestId('svc-verify-verified'));
    fireEvent.click(within(dialog).getByTestId('svc-verify-save'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.existingEquipment).toEqual({
      manufacturer: 'Eaton', catalogNumber: 'CHU2040M200', mainArrangement: 'Meter-main, two 200 A mains',
      feederArrangement: 'One feeder to each MSP', sccrA: 22_000, verified: true,
    });
    await waitFor(() => expect(screen.queryByTestId('svc-verify-dialog')).toBeNull());
    expect(screen.getByTestId('svc-existing-status').textContent).toBe('Field verified');
    expect(screen.getByTestId('svc-existing-line').getAttribute('data-state')).toBe('answered');
  });

  it('a partial read leaves exactly what was not read; reopening shows what was recorded', async () => {
    const writes = mountLiveCard(rays());
    fireEvent.click(screen.getByTestId('svc-verify'));
    fireEvent.change(screen.getByTestId('svc-verify-sccrA'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('svc-verify-save'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.existingEquipment?.sccrA).toBe(10_000);
    expect(writes[0].next.service.existingEquipment?.verified).toBe(false);
    await waitFor(() => expect(screen.getByTestId('svc-existing-status').textContent).toBe('Field verification 4 items required'));
    fireEvent.click(screen.getByTestId('svc-verify'));
    expect((screen.getByTestId('svc-verify-sccrA') as HTMLInputElement).value).toBe('10');
    expect(screen.queryByTestId('svc-verify-needed-sccrA')).toBeNull();
    expect(screen.getByTestId('svc-verify-needed-catalogNumber')).toBeTruthy();
  });

  it('🚨 an AIC typo is refused inside the dialog, the dialog stays open, nothing is written', async () => {
    const writes = mountLiveCard(rays());
    fireEvent.click(screen.getByTestId('svc-verify'));
    const sccr = screen.getByTestId('svc-verify-sccrA') as HTMLInputElement;
    Object.defineProperty(sccr, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.click(screen.getByTestId('svc-verify-save'));
    await flush();
    expect(writes).toEqual([]);
    expect(within(screen.getByTestId('svc-verify-dialog')).getByTestId('svc-refusal').textContent).toMatch(/^AIC \/ SCCR: enter/);
  });

  it('each of the three answers is one choice, written through apply as itself; with nothing read off it, no confirmation', async () => {
    const writes = mountLiveCard(house200());
    const select = () => screen.getByTestId('svc-existing') as HTMLSelectElement;
    fireEvent.change(select(), { target: { value: 'existing' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.existingOrNew).toBe('existing');
    expect(writes[0].next.service.existingEquipment?.verified).toBe(false);
    expect(await screen.findByTestId('svc-existing-mfr')).toBeTruthy();
    expect(select().value).toBe('existing');

    fireEvent.change(select(), { target: { value: 'new' } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].next.service.existingOrNew).toBe('new');
    expect(writes[1].next.service.existingEquipment).toBeNull();
    expect(screen.queryByTestId('svc-confirm-existing')).toBeNull();
    await waitFor(() => expect(select().value).toBe('new'));
    expect(screen.getByTestId('svc-existing-new').textContent).toContain('make and ratings are not recorded');
    expect(screen.getByTestId('svc-existing-source').getAttribute('data-source')).toBe('Installer entered');
    expect(screen.queryByTestId('svc-verify')).toBeNull();

    // …and "not answered" is an answer the graph keeps — taking it back does not leave "new" behind.
    fireEvent.change(select(), { target: { value: 'unanswered' } });
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].next.service.existingOrNew).toBe('unanswered');
    expect(writes[2].next.service.existingEquipment).toBeNull();
    await waitFor(() => expect(select().value).toBe('unanswered'));
    expect(screen.getByTestId('svc-existing-source').getAttribute('data-source')).toBe('Not established');
  });

  it('🚨 leaving "existing" once something was read off it ASKS first: Keep writes nothing, the confirmation discards', async () => {
    const writes = mountLiveCard(house200());
    fireEvent.change(screen.getByTestId('svc-existing'), { target: { value: 'existing' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    const mfr = await screen.findByTestId('svc-existing-mfr');
    fireEvent.change(mfr, { target: { value: 'Square D' } });
    fireEvent.blur(mfr);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].next.service.existingEquipment?.manufacturer).toBe('Square D');

    fireEvent.change(screen.getByTestId('svc-existing'), { target: { value: 'new' } });
    await flush();
    expect(writes).toHaveLength(2);
    expect((screen.getByTestId('svc-existing') as HTMLSelectElement).value).toBe('existing');
    expect(screen.getByTestId('svc-confirm-existing-lost').textContent).toBe('Square D');
    fireEvent.click(screen.getByTestId('svc-confirm-existing-no'));
    await flush();
    expect(writes).toHaveLength(2);
    expect(screen.queryByTestId('svc-confirm-existing')).toBeNull();

    fireEvent.change(screen.getByTestId('svc-existing'), { target: { value: 'new' } });
    fireEvent.click(screen.getByTestId('svc-confirm-existing-yes'));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].next.service.existingEquipment).toBeNull();
    expect(writes[2].next.service.existingOrNew).toBe('new');
  });

  it('🚨 taking a read assembly back to "not answered" asks too, and records not-answered — never new', async () => {
    const writes = mountLiveCard(rays());
    fireEvent.change(screen.getByTestId('svc-existing'), { target: { value: 'unanswered' } });
    await flush();
    expect(writes).toEqual([]);
    expect(screen.getByTestId('svc-confirm-existing').textContent).toContain('not answered');
    fireEvent.click(screen.getByTestId('svc-confirm-existing-yes'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.existingOrNew).toBe('unanswered');
    expect(writes[0].next.service.existingEquipment).toBeNull();
  });

  it('…and on a field-verified Eaton assembly the confirmation names everything the site visit read', async () => {
    const verified = ok(answerExistingService(rays(), {
      existing: true, catalogNumber: 'CHU2040M200', mainArrangement: 'Meter-main, two 200 A mains',
      feederArrangement: 'One feeder to each MSP', sccrA: 22_000, verified: true,
    }));
    const writes = mountLiveCard(verified);
    fireEvent.change(screen.getByTestId('svc-existing'), { target: { value: 'new' } });
    await flush();
    expect(writes).toEqual([]);
    const lost = [...screen.getByTestId('svc-confirm-existing-lost').querySelectorAll('li')].map(li => li.textContent);
    expect(lost).toEqual(['Eaton', 'CHU2040M200', 'main: Meter-main, two 200 A mains', 'feeders: One feeder to each MSP',
      '22 kA AIC', 'read on site']);
  });
});

describe('the 120% rule — remedies on a FAIL, as PROPOSED WORK, never as the panel\'s reading', () => {
  const failing = () => buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;

  it('a failing panel says why and lists derate-main / upgrade-bus with their allowances and what each entails', () => {
    mountLiveCard(failing());
    const fail = screen.getByTestId('svc-panel-busbar-fail-msp-1');
    expect(fail.textContent).toContain('48.0 A of backfeed exceeds the 40.0 A allowed');
    expect(fail.textContent).toContain('NEC 705.12(B)');
    expect(fail.textContent).toContain('proposed work, not recorded as this panel\'s rating');
    const derate = screen.getByTestId('svc-remedy-derate-msp-1').textContent!;
    expect(derate).toMatch(/^Derate the main breaker — 175 A allows 65 A · 150 A allows 90 A/);
    expect(derate).toContain('replacement main breaker');
    expect(derate).toContain('load calculation');
    const bus = screen.getByTestId('svc-remedy-bus-msp-1').textContent!;
    expect(bus).toMatch(/^Upgrade the busbar — 225 A allows 70 A · 320 A allows 184 A/);
    expect(bus).toContain('replacement panelboard');
  });

  it('🚨 nothing in the FAIL writes: a derate is not a reading — the installed 200 A main stays recorded and the FAIL stays', async () => {
    const writes = mountLiveCard(failing());
    const fail = screen.getByTestId('svc-panel-busbar-fail-msp-1');
    // Before: a "Derate main to [175 ▼]" select wrote mainBreakerA = 175 as if it were read off the
    // panel, the FAIL became a PASS and nothing recorded that a breaker had to be bought.
    expect(fail.querySelectorAll('select, input, button')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('svc-remedy-derate-msp-1'));
    fireEvent.click(screen.getByTestId('svc-remedy-bus-msp-1'));
    await flush();
    expect(writes).toEqual([]);
    expect((screen.getByTestId('svc-panel-main-msp-1') as HTMLSelectElement).value).toBe('200');
    expect(screen.getByTestId('svc-panel-busbar-fail-msp-1')).toBeTruthy();
  });

  it('once the work is done, recording the installed main in the row is what the engine re-checks', async () => {
    const writes = mountLiveCard(failing());
    fireEvent.change(screen.getByTestId('svc-panel-main-msp-1'), { target: { value: '175' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels[0].mainBreakerA).toBe(175);
    await waitFor(() => expect(screen.queryByTestId('svc-panel-busbar-fail-msp-1')).toBeNull());
  });

  it('a passing panel offers no remedy (Ray\'s job: storage aggregated elsewhere)', () => {
    mountLiveCard(rays());
    expect(screen.queryAllByTestId(/^svc-panel-busbar-fail-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^svc-remedy-/)).toHaveLength(0);
  });
});

describe('[Answer Next] asks the existing-equipment items with the SAME form the card uses', () => {
  it('the AIC / SCCR need opens the verify form with that field marked; Save writes it and the dialog closes', async () => {
    const t = rays();
    const item = findInterviewItem(interviewOf(t), 'engineering.needs.service.existingEquipment.sccrA')!;
    expect(item).toBeTruthy();
    const writes: ServiceTopology[] = [];
    const onClose = vi.fn();
    render(<QuestionDialog {...ctxFor(t, async n => { writes.push(n); return true; })} item={item} onClose={onClose} />);
    const editor = screen.getByTestId('question-editor');
    expect(within(editor).getByTestId('svc-verify-needed-sccrA')).toBeTruthy();
    expect(within(editor).queryByTestId('svc-verify-needed-catalogNumber')).toBeNull();
    fireEvent.change(within(editor).getByTestId('svc-verify-sccrA'), { target: { value: '22' } });
    fireEvent.click(within(editor).getByTestId('svc-verify-save'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].service.existingEquipment?.sccrA).toBe(22_000);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('service.existing in the dialog: declare it existing, name it, and verify it — one editor', () => {
    const t = rays();
    const item = findInterviewItem(interviewOf(t), 'service.existing')!;
    render(<QuestionDialog {...ctxFor(t, async () => true)} item={item} onClose={() => undefined} />);
    const editor = screen.getByTestId('question-editor');
    expect((within(editor).getByTestId('answer-existing-service') as HTMLSelectElement).value).toBe('existing');
    expect(within(editor).getByTestId('svc-verify-form')).toBeTruthy();
  });

  it('with no existing equipment recorded, an existing-equipment need has no editor (nothing to verify)', () => {
    const t = ok(answerServiceRating(null, 200));
    const item = { id: 'engineering.needs.service.existingEquipment.sccrA', section: 'engineering' as const,
      question: 'Existing service equipment — AIC / SCCR from its nameplate', state: 'needs-verification' as const };
    render(<QuestionDialog {...ctxFor(t, async () => true)} item={item} onClose={() => undefined} />);
    expect(screen.queryByTestId('svc-verify-form')).toBeNull();
    expect(screen.getByTestId('question-no-editor').textContent).toMatch(/Existing Electrical Service/);
  });
});

describe('[Answer Next] / the question dialog asks a service question with the CARD\'S controls', () => {
  const dialogFor = (t: ServiceTopology, itemId: string, writes: ServiceTopology[] = []) => {
    const item = findInterviewItem(interviewOf(t), itemId)!;
    expect(item, itemId).toBeTruthy();
    render(<QuestionDialog {...ctxFor(t, async n => { writes.push(n); return true; })} item={item} onClose={() => undefined} />);
    return { writes, editor: screen.getByTestId('question-editor') };
  };

  it('🚨 a 175 A main (bus not yet entered) reads as 175 A in the dialog, not as blank', () => {
    const t = ok(answerPanel(house200(), 'msp-1', { mainBreakerA: 175, busbarRatingA: null }));
    const { editor } = dialogFor(t, 'service.panel.msp-1');
    const main = within(editor).getByTestId('answer-panel-main-msp-1') as HTMLSelectElement;
    // Before: the dialog offered only [100…400] and showed '—' while the graph held 175.
    expect(main.value).toBe('175');
    expect([...main.options].map(o => o.value)).toContain('175');
    expect(within(editor).getByTestId('answer-panel-msp-1').getAttribute('data-state')).toBe('needs-answer');
  });

  it('a recorded off-ladder service rating is offered as recorded', () => {
    const t = ok(answerServiceRating(house200(), 250));
    const { editor } = dialogFor(t, 'service.rating');
    expect((within(editor).getByTestId('answer-service-rating') as HTMLSelectElement).value).toBe('250');
  });

  it('🚨 a fault-current typo is REFUSED in the dialog (it used to be silently ignored) and never written', async () => {
    const { writes, editor } = dialogFor(house200(), 'service.fault-current');
    const ka = within(editor).getByTestId('answer-fault-current') as HTMLInputElement;
    fireEvent.change(ka, { target: { value: '' } });
    Object.defineProperty(ka, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.blur(ka);
    await flush();
    expect(writes).toEqual([]);
    expect(screen.getByTestId('answer-refusal').textContent).toMatch(/^Available fault current: enter a number/);
  });

  it('the distribution question offers what the card offers — no dead-end "Other / custom"', () => {
    const { editor } = dialogFor(ok(answerServiceRating(null, 400)), 'service.distribution');
    expect(within(editor).getByTestId('answer-distribution-two-main-panels').tagName).toBe('BUTTON');
    expect(within(editor).queryByTestId('answer-distribution-custom')).toBeNull();
  });

  it('a rating answered in the dialog builds the panel without preset ratings, exactly as the card does', async () => {
    const writes: ServiceTopology[] = [];
    render(<QuestionDialog {...ctxFor(null, async n => { writes.push(n); return true; })}
                           item={findInterviewItem(interviewOf(null), 'service.rating')!} onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('answer-service-rating'), { target: { value: '200' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].panels.map(p => [p.mainBreakerA, p.busbarRatingA])).toEqual([[null, null]]);
  });

  it('declaring an existing assembly new from the dialog asks first, as the card does', async () => {
    const { writes, editor } = dialogFor(rays(), 'service.existing');
    fireEvent.change(within(editor).getByTestId('answer-existing-service'), { target: { value: 'new' } });
    await flush();
    expect(writes).toEqual([]);
    expect(within(editor).getByTestId('answer-confirm-existing-lost').textContent).toBe('Eaton');
  });

  it('🚨 an unanswered existing-or-new is asked in the dialog with the card\'s select, and the answer is written as itself', async () => {
    const { writes, editor } = dialogFor(house200(), 'service.existing');
    const select = within(editor).getByTestId('answer-existing-service') as HTMLSelectElement;
    expect(select.value).toBe('unanswered');
    fireEvent.change(select, { target: { value: 'new' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].service.existingOrNew).toBe('new');
    expect(writes[0].service.existingEquipment).toBeNull();
  });
});

describe('🚨 the ONE write path refuses while the graph is unread — whichever control asks', () => {
  const FAILED = 'The service could not be read. Nothing is written over it until it can be — reload to try again.';

  it('Readiness [Answer Next] after a FAILED read: the top item is the rating, and answering it writes NOTHING', async () => {
    // The page's composition: applyVia(guardGraphRead(writeInterviewAnswer, () => svcTopologyReadRef.current, …), …).
    const writes: ServiceTopology[] = [];
    const refused: string[] = [];
    const apply = applyVia(guardGraphRead(async n => { writes.push(n); return true; }, () => 'failed', w => refused.push(w)));
    // busy: false and no graphRead — the guard is in the write path, not only in what the UI disables.
    render(<EngineeringReadinessPanel topology={null} pvArray={pv20} derivedStrings={[]} equipment={NO_EQUIPMENT}
                                      busy={false} apply={apply} interview={interviewOf(null)} />);
    expect(screen.getByTestId('readiness-next-0').getAttribute('data-item-id')).toBe('service.rating');
    fireEvent.click(screen.getByTestId('readiness-answer-next'));
    fireEvent.change(within(screen.getByTestId('question-dialog')).getByTestId('answer-service-rating'), { target: { value: '200' } });
    await flush();
    // Before: a fresh 200 A one-panel graph was PUT over the stored one nobody could read.
    expect(writes).toEqual([]);
    expect(refused).toEqual([FAILED]);
  });

  it('…and the dialog says why, with its editor disabled', () => {
    render(<EngineeringReadinessPanel {...ctxFor(null, async () => true)} graphRead="failed" interview={interviewOf(null)} />);
    fireEvent.click(screen.getByTestId('readiness-answer-next'));
    expect(screen.getByTestId('question-unread').textContent).toBe(FAILED);
    expect((screen.getByTestId('answer-service-rating') as HTMLSelectElement).disabled).toBe(true);
  });

  it('🚨 no lost update: the second edit in a multi-field dialog waits for the first to come back from the store', async () => {
    const writes: ServiceTopology[] = [];
    let reload: () => void = () => undefined;
    function Page() {
      const [t, setT] = useState<ServiceTopology>(house200());
      const [read, setRead] = useState<'loading' | 'loaded'>('loaded');
      const readRef = React.useRef<'loading' | 'loaded'>(read);
      readRef.current = read;
      // The page: a PUT that succeeds marks the graph in hand stale until the re-read lands.
      const onWrite = async (next: ServiceTopology) => {
        writes.push(next);
        readRef.current = 'loading'; setRead('loading');
        reload = () => { setT(next); setRead('loaded'); };
        return true;
      };
      const ctx = { ...ctxFor(t, onWrite), apply: applyVia(guardGraphRead(onWrite, () => readRef.current)), graphRead: read };
      return <QuestionDialog {...ctx} item={findInterviewItem(interviewOf(t), 'service.panel.msp-1')} onClose={() => undefined} />;
    }
    render(<Page />);
    fireEvent.change(screen.getByTestId('answer-panel-main-msp-1'), { target: { value: '175' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    // The GET has not returned: the graph in hand still says 200 A. An edit now would PUT main 200 back.
    fireEvent.change(screen.getByTestId('answer-panel-bus-msp-1'), { target: { value: '225' } });
    await flush();
    expect(writes).toHaveLength(1);
    expect(screen.getByTestId('question-unread').textContent).toMatch(/^The service is being read/);
    await act(async () => { reload(); });
    fireEvent.change(screen.getByTestId('answer-panel-bus-msp-1'), { target: { value: '225' } });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].panels[0]).toMatchObject({ mainBreakerA: 175, busbarRatingA: 225 });
  });
});

describe('the page: the card is back where the Main Service Panel card was, on the one write path', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
  // The System Config tab body ends where the next tab's begins (Service Topology is no longer a tab).
  const tab = page.slice(page.indexOf("{activeTab === 'config' ? ((() => {"), page.indexOf("{activeTab === 'compliance' ? ((() => {"));
  it('the slice is the System Config tab body, not the rest of the file', () => {
    expect(page.indexOf("{activeTab === 'compliance' ? ((() => {")).toBeGreaterThan(page.indexOf("{activeTab === 'config' ? ((() => {"));
  });

  it('left column: after Project Information, before the PV AC Output Circuit, wrapped in #sc-card-service', () => {
    const card = tab.indexOf('id="sc-card-service"');
    expect(card).toBeGreaterThan(tab.indexOf('LEFT COLUMN'));
    expect(card).toBeGreaterThan(tab.indexOf('Project Information'));
    expect(card).toBeLessThan(tab.indexOf('Section 2: PV AC Output Circuit'));
    expect(card).toBeLessThan(tab.indexOf('CENTER COLUMN'));
    expect(tab.slice(card, card + 400)).toMatch(
      /<ExistingElectricalServiceCard \{\.\.\.interviewEditorContext\} interview=\{systemConfigInterview\}\s*error=\{_svcError\} graphRead=\{svcTopologyRead\} \/>/);
  });

  it('its writes take the page\'s one write path, which mirrors the first panel into the legacy config', () => {
    expect(page).toContain('const applyInterviewAnswer = applyVia(writeInterviewAnswer, setInterviewRefusal);');
    expect(page).toContain('apply: applyInterviewAnswer,');
    expect(page).toContain('if (p0?.mainBreakerA != null && p0.mainBreakerA !== config.mainPanelAmps) patch.mainPanelAmps = p0.mainBreakerA;');
    expect(page).toContain('if (p0?.busbarRatingA != null && p0.busbarRatingA !== config.panelBusRating) patch.panelBusRating = p0.busbarRatingA;');
    expect(page).toContain('if (p0?.manufacturer && p0.manufacturer !== config.mainPanelBrand) patch.mainPanelBrand = p0.manufacturer;');
  });

  it('🚨 the page guards its ONE write path on the read state, disables every editor while unread, and marks a written graph stale', () => {
    // The guard wraps writeInterviewAnswer itself, so the card, the dialog, the guided strip and
    // the readiness panel all get it — not only the card's own apply.
    expect(page).toMatch(/const writeInterviewAnswer = guardGraphRead\(async \(next: NonNullable<typeof svcTopology>, what: string\) => \{/);
    expect(page).toContain('}, () => svcTopologyReadRef.current, why => setInterviewRefusal(why));');
    expect(page).toContain('svcTopologyReadRef.current = svcTopologyRead;');
    expect(page).toContain('busy: _svcSaving || !!_archResolving || unreadGraphRefusal(svcTopologyRead) !== null,');
    expect(page).toContain('graphRead: svcTopologyRead,');
    // A successful PUT marks the graph in hand stale in the same batch that clears _svcSaving.
    const put = page.slice(page.indexOf('const writeTopology = async'), page.indexOf('const writeInterviewAnswer'));
    const stale = put.indexOf("svcTopologyReadRef.current = 'loading';");
    expect(stale).toBeGreaterThan(0);
    expect(put.indexOf("setSvcTopologyRead('loading');")).toBeGreaterThan(stale);
    expect(put.indexOf('setSvcTopologyReloadKey(k => k + 1);')).toBeGreaterThan(stale);
  });

  it('🚨 no `?? 200` "Max PV" strip came back with the card', () => {
    expect(tab).not.toMatch(/Max PV:/);
    expect(tab).not.toContain('data-testid="panel-main-amps"');
  });
});
