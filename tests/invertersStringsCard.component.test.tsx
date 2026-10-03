/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the INVERTERS & STRINGS card, clicked.
//
// Ray: "When PV inverter = None and the PV is DC coupled to storage, the card shows a compact block:
// PV STRINGS · 37 modules · 5 strings (9/9/9/8/2) · DC coupled to Powerwall 3 · String assignment
// [Review] — NOT seven permanent dropdowns. [Review] opens a dialog: 'String i (n modules) → [PW3 #k]'
// rows + 'Recommended assignment available [Accept] [Edit]'." The recommendation is written ONLY when
// the installer clicks Accept; every write goes through `apply` (the page's one write path).
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerBackup, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { invertingUnits } from '@/lib/electrical/storageStringAssignment';
import { QuestionDialog, applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { InvertersStringsDecisions } from '@/components/engineering/systemConfig/cards/InvertersStringsCard';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const RAYS_STRINGS = [9, 9, 9, 8, 2];
const PW3: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const PW3_SELECTION = { gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', storageLabel: 'Tesla Powerwall 3', totalUnits: 4 };
const raysJob = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });
const interviewOf = (t: ServiceTopology, eq: InterviewEquipment = PW3, strings = RAYS_STRINGS) => buildSystemConfigInterview({
  pvArray: pv37, topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
  equipment: eq, evaluation: evaluateServiceTopology(t), derivedStrings: strings.map(panelCount => ({ panelCount })),
});

/** The page's loop: an accepted write becomes the graph the interview and the card are rebuilt from. */
function mountCard(initial: ServiceTopology, opts: {
  strings?: number[]; onRecordCoupling?: (c: string) => Promise<boolean>; equipment?: InterviewEquipment;
} = {}) {
  const writes: ServiceTopology[] = [];
  const strings = opts.strings ?? RAYS_STRINGS;
  function Page() {
    const [t, setT] = useState(initial);
    const ctx: ItemEditorContext = {
      topology: t, pvArray: pv37, derivedStrings: strings, equipment: PW3_SELECTION, busy: false,
      apply: applyVia(async n => { writes.push(n); setT(n); return true; }),
      onRecordCoupling: opts.onRecordCoupling,
    };
    return (
      <div id="sc-card-inverters">
        <InvertersStringsDecisions {...ctx} interview={interviewOf(t, opts.equipment, strings)}
                                   coupling="dc-coupled-storage" pvInverterState={(opts.equipment ?? PW3).pvInverter.state} />
      </div>
    );
  }
  const view = render(<Page />);
  return { writes, view };
}

describe('Ray\'s DC-coupled job — one compact PV STRINGS block, not a wall of dropdowns', () => {
  it('states the strings, the coupling and the open assignment in one line; the only control on the card is the PV connection', () => {
    const { view } = mountCard(raysJob());
    const block = screen.getByTestId('inv-strings-summary');
    expect(block.textContent).toContain('PV STRINGS');
    expect(block.textContent).toContain('37 modules');
    expect(screen.getByTestId('inv-strings-count').textContent).toBe('5 strings (9/9/9/8/2)');
    expect(block.textContent).toContain('DC coupled to Tesla Powerwall 3');
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Not assigned');
    expect(screen.getByTestId('inv-string-status').getAttribute('data-state')).toBe('needs-answer');
    expect(screen.getByTestId('inv-string-recommended-hint').textContent).toBe('Recommended assignment available');
    // No permanent per-string dropdowns: one select on the card, and it is the PV connection.
    const selects = view.container.querySelectorAll('select');
    expect(selects).toHaveLength(1);
    expect(selects[0].getAttribute('data-testid')).toBe('inv-pv-connection-select');
    expect(screen.queryByTestId('inv-string-dialog')).toBeNull();
  });

  it('"PV inverter: None — DC coupled to storage" is stated as the installer\'s decision', () => {
    mountCard(raysJob());
    const line = screen.getByTestId('inv-pv-inverter');
    expect(line.textContent).toContain('None — DC coupled to storage');
    expect(line.getAttribute('data-state')).toBe('answered');
    expect(within(line).getByTitle('Installer decision')).toBeTruthy();
  });

  it('"PV connection [DC coupled to <storage> ▼ | Through an external PV inverter]" records through the architecture route', async () => {
    const recorded: string[] = [];
    const { writes } = mountCard(raysJob(), { onRecordCoupling: async c => { recorded.push(c); return true; } });
    const select = screen.getByTestId('inv-pv-connection-select') as HTMLSelectElement;
    expect(select.value).toBe('dc-coupled-storage');
    expect([...select.options].map(o => o.textContent)).toEqual(['DC coupled to Tesla Powerwall 3', 'Through an external PV inverter']);
    fireEvent.change(select, { target: { value: 'ac-coupled-inverter' } });
    await waitFor(() => expect(recorded).toEqual(['ac-coupled-inverter']));
    expect(writes).toHaveLength(0);   // the coupling is never written to the graph by this card
  });
});

describe('[Review] → the String assignment dialog: recommended, written only on Accept', () => {
  it('opening it writes nothing; Accept writes the recommendation once, closes, and the card reads Assigned', async () => {
    const { writes } = mountCard(raysJob());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const dialog = screen.getByTestId('inv-string-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent)
      .toContain('which Tesla Powerwall 3 receives each PV string?');
    // "String i (n modules) → [unit ▼]" rows, empty: nothing is recorded, and nothing is filled in.
    for (let i = 1; i <= 5; i++) expect((screen.getByTestId(`inv-string-${i}`) as HTMLSelectElement).value).toBe('');
    expect(within(dialog).getByText('Recommended assignment available')).toBeTruthy();
    expect(screen.getByTestId('inv-string-recommended-units').textContent).toContain('Tesla Powerwall 3 #4');
    expect(writes).toHaveLength(0);

    fireEvent.click(screen.getByTestId('inv-string-accept'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(invertingUnits(writes[0]).map(u => u.pvDcStcKw)).toEqual([3.96, 3.96, 3.96, 4.4]);
    await waitFor(() => expect(screen.queryByTestId('inv-string-dialog')).toBeNull());
    expect(screen.getByTestId('inv-string-status').getAttribute('data-state')).toBe('answered');
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Assigned — 4 of 4 units carry PV');
    expect(screen.queryByTestId('inv-string-recommended-hint')).toBeNull();
  });

  it('reopened, the recorded landing is read back into the rows and named as the recommendation — no second Accept', async () => {
    mountCard(raysJob());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.click(screen.getByTestId('inv-string-accept'));
    await waitFor(() => expect(screen.queryByTestId('inv-string-dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const ids = invertingUnits(raysJob()).map(u => u.id);
    expect([1, 2, 3, 4, 5].map(i => (screen.getByTestId(`inv-string-${i}`) as HTMLSelectElement).value))
      .toEqual([ids[0], ids[1], ids[2], ids[3], ids[3]]);
    expect(screen.getByTestId('inv-string-recommendation').getAttribute('data-matches-recorded')).toBe('true');
    expect(screen.queryByTestId('inv-string-accept')).toBeNull();
  });

  it('[Edit] puts the recommendation in the rows; the installer moves one string and Save records THAT', async () => {
    const { writes } = mountCard(raysJob());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const save = screen.getByTestId('inv-string-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);   // five strings unassigned
    expect(screen.getByTestId('inv-string-unassigned').textContent).toBe('5 strings not assigned');
    fireEvent.click(screen.getByTestId('inv-string-edit'));
    expect(writes).toHaveLength(0);     // Edit is not a write
    const ids = invertingUnits(raysJob()).map(u => u.id);
    fireEvent.change(screen.getByTestId('inv-string-5'), { target: { value: ids[0] } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(invertingUnits(writes[0]).map(u => u.pvDcStcKw)).toEqual([4.84, 3.96, 3.96, 3.52]);
  });

  it('Save is refused while a unit is over its published MPPT count — the reason is named, nothing is written', async () => {
    // Eight strings (5×7 + 2 = 37) all on unit #1 — six MPPT inputs.
    const strings = [5, 5, 5, 5, 5, 5, 5, 2];
    const { writes } = mountCard(raysJob(), { strings });
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const ids = invertingUnits(raysJob()).map(u => u.id);
    strings.forEach((_, i) => fireEvent.change(screen.getByTestId(`inv-string-${i + 1}`), { target: { value: ids[0] } }));
    expect(screen.getByTestId('inv-string-violations').textContent).toMatch(/has 6 MPPT inputs; 8 strings are assigned to it\./);
    expect(screen.getByTestId('inv-string-unit-1').className).toContain('text-rose-300');
    const save = screen.getByTestId('inv-string-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    await act(async () => { await Promise.resolve(); });
    expect(writes).toHaveLength(0);
  });

  it('a writer\'s refusal (strings that lose modules) is shown in the dialog and never written', async () => {
    // 9+9+9+8 = 35 of the 37 Design placed: answerPvLanding refuses.
    const { writes } = mountCard(raysJob(), { strings: [9, 9, 9, 8] });
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.click(screen.getByTestId('inv-string-accept'));
    expect((await screen.findByTestId('answer-refusal')).textContent).toContain('cover 35 modules; Design placed 37');
    expect(writes).toHaveLength(0);
    expect(screen.getByTestId('inv-string-dialog')).toBeTruthy();
  });

  it('Escape and × close it without writing', () => {
    const { writes } = mountCard(raysJob());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('inv-string-dialog')).toBeNull();
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.click(screen.getByTestId('inv-string-dialog-close'));
    expect(screen.queryByTestId('inv-string-dialog')).toBeNull();
    expect(writes).toHaveLength(0);
  });
});

describe('the same editor wherever behavior.pv-landing is asked', () => {
  it('[Answer Next] / the guided strip (QuestionDialog) renders the String assignment editor; Accept writes and closes', async () => {
    const t = raysJob();
    const item = findInterviewItem(interviewOf(t), 'behavior.pv-landing')!;
    expect(item.state).toBe('needs-answer');
    const writes: ServiceTopology[] = [];
    const onClose = vi.fn();
    render(<QuestionDialog topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} equipment={PW3_SELECTION} busy={false}
                           apply={applyVia(async n => { writes.push(n); return true; })} item={item} onClose={onClose} />);
    const editor = within(screen.getByTestId('question-editor'));
    expect(editor.getByTestId('inv-string-editor')).toBeTruthy();
    expect(editor.getByText('Recommended assignment available')).toBeTruthy();
    expect(writes).toHaveLength(0);
    fireEvent.click(editor.getByTestId('inv-string-accept'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(invertingUnits(writes[0]).map(u => u.pvDcStcKw)).toEqual([3.96, 3.96, 3.96, 4.4]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('only where it applies', () => {
  it('a job with a chosen PV inverter and no storage: no strings block, no None line, no PV connection', () => {
    const t = ok(answerServiceRating(null, 200));
    const iv = buildSystemConfigInterview({
      pvArray: pv37, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
      equipment: MICROS, evaluation: evaluateServiceTopology(t),
    });
    const { container } = render(
      <InvertersStringsDecisions topology={t} pvArray={pv37} derivedStrings={[]} busy={false}
                                 equipment={{ gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }}
                                 apply={async () => true} interview={iv} coupling={null} pvInverterState="SELECTED" />);
    expect(container.innerHTML).toBe('');
  });

  it('one Powerwall 3 on a 200 A house: the interview does not ask which unit, but the unit\'s landing is still recorded from [Review]', async () => {
    const one = { ...ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 1,
    })), solarCoupling: 'dc-coupled-storage' as const };
    expect(findInterviewItem(interviewOf(one), 'behavior.pv-landing')).toBeNull();
    const before = evaluateServiceTopology(one).checks.find(c => c.id === 'pv.dc-input');
    expect(before?.conclusion).toBe('NOT_EVALUATED');
    const { writes } = mountCard(one);
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Not assigned');
    fireEvent.click(screen.getByTestId('inv-string-review'));
    fireEvent.click(screen.getByTestId('inv-string-accept'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(invertingUnits(writes[0]).map(u => u.pvDcStcKw)).toEqual([16.28]);
    expect(evaluateServiceTopology(writes[0]).checks.find(c => c.id === 'pv.dc-input')?.conclusion).toBe('PASS');
    await waitFor(() => expect(screen.getByTestId('inv-string-status').textContent).toBe('Assigned — 1 of 1 unit carries PV'));
  });
});

describe('the page mounts the card\'s decisions inside the Inverters & Strings card, on the one write path', () => {
  const page = readFileSync(resolve(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
  it('inside #sc-card-inverters, before the fleet rows, with the shared editor context and the live interview', () => {
    const card = page.indexOf('id="sc-card-inverters"');
    const mount = page.indexOf('<InvertersStringsDecisions {...interviewEditorContext} interview={systemConfigInterview}');
    expect(card).toBeGreaterThan(0);
    expect(mount).toBeGreaterThan(card);
    expect(mount).toBeLessThan(page.indexOf('{/* Branch Visualization', card));
    const tag = page.slice(mount, page.indexOf('/>', mount));
    expect(tag).toContain('coupling={electrical?.solarCoupling ?? null}');
    expect(tag).toContain('pvInverterState={interviewEquipment.pvInverter.state}');
  });
});
