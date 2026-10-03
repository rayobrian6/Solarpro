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
import { answerServiceRating, answerDistribution, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { buildNormalResidence200A } from '@/lib/electrical/fixtures/normalResidence200a';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { QuestionDialog, applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { ExistingElectricalServiceCard } from '@/components/engineering/systemConfig/cards/ExistingElectricalServiceCard';

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
    expect((screen.getByTestId('svc-existing') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('svc-existing-new')).toBeTruthy();
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
    expect(writes[0].next.panels.map(p => [p.mainBreakerA, p.busbarRatingA])).toEqual([[200, 200]]);
    expect(await screen.findByTestId('svc-panel-main-msp-1')).toBeTruthy();
    expect(screen.queryAllByTestId(/^svc-distribution-/)).toHaveLength(0);
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
    expect((screen.getByTestId('svc-existing') as HTMLInputElement).checked).toBe(true);
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

  it('declaring the equipment existing — and new again — is one checkbox; the manufacturer is edited on the line', async () => {
    const writes = mountLiveCard(house200());
    fireEvent.click(screen.getByTestId('svc-existing'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.service.existingEquipment?.verified).toBe(false);
    const mfr = await screen.findByTestId('svc-existing-mfr');
    fireEvent.change(mfr, { target: { value: 'Square D' } });
    fireEvent.blur(mfr);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].next.service.existingEquipment?.manufacturer).toBe('Square D');
    fireEvent.click(screen.getByTestId('svc-existing'));
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2].next.service.existingEquipment).toBeNull();
  });
});

describe('the 120% rule — remedies on a FAIL, as edits of THAT panel', () => {
  const failing = () => buildNormalResidence200A({ storageConnection: 'backed-up-panel-busbar' }).topology;

  it('a failing panel says why and offers derate-main / upgrade-bus; derating to 175 A writes the main and the FAIL clears', async () => {
    const writes = mountLiveCard(failing());
    const fail = screen.getByTestId('svc-panel-busbar-fail-msp-1');
    expect(fail.textContent).toContain('48.0 A of backfeed exceeds the 40.0 A allowed');
    expect(fail.textContent).toContain('NEC 705.12(B)');
    const derate = screen.getByTestId('svc-remedy-derate-msp-1') as HTMLSelectElement;
    expect([...derate.options].map(o => o.textContent)[1]).toBe('175 A — allows 65 A');
    fireEvent.change(derate, { target: { value: '175' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels[0].mainBreakerA).toBe(175);
    expect(writes[0].next.panels[0].busbarRatingA).toBe(200);
    await waitFor(() => expect(screen.queryByTestId('svc-panel-busbar-fail-msp-1')).toBeNull());
    expect((screen.getByTestId('svc-panel-main-msp-1') as HTMLSelectElement).value).toBe('175');
  });

  it('…or upgrading the busbar writes the bus, not the main', async () => {
    const writes = mountLiveCard(failing());
    fireEvent.change(screen.getByTestId('svc-remedy-bus-msp-1'), { target: { value: '225' } });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].next.panels[0].busbarRatingA).toBe(225);
    expect(writes[0].next.panels[0].mainBreakerA).toBe(200);
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
    expect((within(editor).getByTestId('answer-existing-service') as HTMLInputElement).checked).toBe(true);
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

describe('the page: the card is back where the Main Service Panel card was, on the one write path', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
  const tab = page.slice(page.indexOf("{activeTab === 'config' ? ((() => {"), page.indexOf("{activeTab === 'service' ? ("));

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

  it('🚨 no `?? 200` "Max PV" strip came back with the card', () => {
    expect(tab).not.toMatch(/Max PV:/);
    expect(tab).not.toContain('data-testid="panel-main-amps"');
  });
});
