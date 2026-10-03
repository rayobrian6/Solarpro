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
import {
  answerServiceRating, answerBackup, answerPvLanding, answerAvailableFaultCurrent, answerStorageLanding,
  answerExistingService, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { findInterviewItem, homeOf, requiredQueue } from '@/lib/electrical/systemConfigPlacement';
import { invertingUnits, recommendStringAssignment } from '@/lib/electrical/storageStringAssignment';
import { QuestionDialog, applyVia, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { InvertersStringsDecisions } from '@/components/engineering/systemConfig/cards/InvertersStringsCard';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';

// Every call the card and the editor make to the recommender is counted (and passed straight through),
// so "it is not recomputed on every page render" is a measurement, not a reading of the deps array.
const recommendCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/lib/electrical/storageStringAssignment', async (orig) => {
  const m = await orig<typeof import('@/lib/electrical/storageStringAssignment')>();
  return {
    ...m,
    recommendStringAssignment: (...a: Parameters<typeof m.recommendStringAssignment>) => {
      recommendCalls.n++;
      return m.recommendStringAssignment(...a);
    },
  };
});

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

// ── Review fixes ────────────────────────────────────────────────────────────

const CONFLICT_EQ: InterviewEquipment = { ...PW3, pvInverter: { state: 'CONFLICT' } };
/** The page in conflict: `_archUnresolved` ⇒ pvInverter CONFLICT ⇒ both PV items read 'fails'. */
const conflictInterview = (t: ServiceTopology) => buildSystemConfigInterview({
  pvArray: pv37, topology: t, coupling: 'dc-coupled-storage', couplingIsDecision: false, architectureConflict: true,
  equipment: CONFLICT_EQ, evaluation: evaluateServiceTopology(t), derivedStrings: RAYS_STRINGS.map(panelCount => ({ panelCount })),
});

describe('an architecture in conflict is resolved in ONE place on the card', () => {
  it('with the card\'s conflict banner offering the resolution: the PV lines defer to it — no second control, no repeated sentence, no second error', () => {
    const t = raysJob();
    const iv = conflictInterview(t);
    expect(findInterviewItem(iv, 'behavior.pv-connection')!.state).toBe('fails');
    const recorded: string[] = [];
    const { container } = render(
      <InvertersStringsDecisions topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} busy={false}
                                 equipment={PW3_SELECTION} apply={async () => true} interview={iv}
                                 onRecordCoupling={async c => { recorded.push(c); return true; }}
                                 coupling="dc-coupled-storage" pvInverterState="CONFLICT"
                                 conflictResolvedAbove connectionError="The architecture route refused." />);
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(screen.queryByTestId('inv-pv-connection-select')).toBeNull();
    const line = screen.getByTestId('inv-pv-conflict');
    expect(line.getAttribute('data-state')).toBe('fails');
    expect(line.textContent).toContain('In conflict — resolve the electrical configuration conflict above.');
    // The banner states the conflict and prints the route's error; the card repeats neither.
    expect(container.textContent).not.toContain('the project records an inverter AND an architecture');
    expect(container.textContent).not.toContain('The architecture route refused.');
    expect(screen.queryByTestId('inv-strings-summary')).toBeNull();
    expect(recorded).toEqual([]);
  });

  it('with no banner control above: the card\'s select is the one control — nothing pre-selected, and EITHER side records (even the one on file)', async () => {
    const t = raysJob();
    const recorded: string[] = [];
    render(
      <InvertersStringsDecisions topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} busy={false}
                                 equipment={PW3_SELECTION} apply={async () => true} interview={conflictInterview(t)}
                                 onRecordCoupling={async c => { recorded.push(c); return true; }}
                                 coupling="dc-coupled-storage" pvInverterState="CONFLICT"
                                 connectionError="The architecture route refused." />);
    const select = screen.getByTestId('inv-pv-connection-select') as HTMLSelectElement;
    expect(screen.getByTestId('inv-pv-connection').getAttribute('data-state')).toBe('fails');
    // The recorded coupling is one side of the conflict, not an answer — it is not pre-selected.
    expect(select.value).toBe('');
    expect([...select.options].map(o => o.textContent))
      .toEqual(['Choose…', 'DC coupled to Tesla Powerwall 3', 'Through an external PV inverter']);
    fireEvent.change(select, { target: { value: 'dc-coupled-storage' } });
    await waitFor(() => expect(recorded).toEqual(['dc-coupled-storage']));
    // The route's error, once.
    expect(screen.getAllByText('The architecture route refused.')).toHaveLength(1);
  });

  it('[Answer Next] on the conflict (QuestionDialog): no side pre-checked, and the one on file can be chosen', async () => {
    const t = raysJob();
    const item = findInterviewItem(conflictInterview(t), 'behavior.pv-connection')!;
    const recorded: string[] = [];
    render(<QuestionDialog topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} equipment={PW3_SELECTION} busy={false}
                           apply={async () => true} onRecordCoupling={async c => { recorded.push(c); return true; }}
                           item={item} onClose={() => {}} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.some(r => r.checked)).toBe(false);
    fireEvent.click(within(screen.getByTestId('answer-pv-connection-dc-coupled-storage')).getByRole('radio'));
    await waitFor(() => expect(recorded).toEqual(['dc-coupled-storage']));
  });
});

describe('a recorded landing that no longer matches the array is stale, not absent', () => {
  it('Design grows 37 → 38 modules after Accept: "Recorded 16.28 kW does not match the 16.72 kW array — review"', () => {
    const t = raysJob();
    const rec = recommendStringAssignment({ strings: RAYS_STRINGS, moduleWatts: 440, units: invertingUnits(t) });
    if (rec.ok === false) throw new Error(rec.reason);
    const landed = ok(answerPvLanding(t, rec.perUnit, 440, 37));
    const pv38 = resolvePvArrayDesign({ placedModuleCount: 38, selectedPanelId: 'panel-fence-ps1' });
    const strings38 = [9, 9, 9, 9, 2];
    const iv = buildSystemConfigInterview({
      pvArray: pv38, topology: landed, coupling: 'dc-coupled-storage', couplingIsDecision: true, architectureConflict: false,
      equipment: PW3, evaluation: evaluateServiceTopology(landed), derivedStrings: strings38.map(panelCount => ({ panelCount })),
    });
    render(<InvertersStringsDecisions topology={landed} pvArray={pv38} derivedStrings={strings38} busy={false}
                                      equipment={PW3_SELECTION} apply={async () => true} interview={iv}
                                      coupling="dc-coupled-storage" pvInverterState="NONE" />);
    const status = screen.getByTestId('inv-string-status');
    expect(status.getAttribute('data-state')).toBe('stale');
    expect(status.textContent).toBe('Recorded 16.28 kW does not match the 16.72 kW array — review');
    expect(screen.getByTestId('inv-strings-summary').getAttribute('data-assigned')).toBe('false');
  });

  it('control: nothing recorded still reads "Not assigned"', () => {
    mountCard(raysJob());
    expect(screen.getByTestId('inv-string-status').getAttribute('data-state')).toBe('needs-answer');
    expect(screen.getByTestId('inv-string-status').textContent).toBe('Not assigned');
  });
});

describe('the String assignment dialog is honest about what the record holds', () => {
  it('a landing read back from the graph says it was read back from each unit\'s recorded kW', async () => {
    mountCard(raysJob());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    expect(screen.queryByTestId('inv-string-readback-note')).toBeNull();   // nothing recorded yet
    fireEvent.click(screen.getByTestId('inv-string-accept'));
    await waitFor(() => expect(screen.queryByTestId('inv-string-dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('inv-string-review'));
    expect(screen.getByTestId('inv-string-recommendation').textContent).toContain('Recorded — matches the recommended assignment');
    expect(screen.getByTestId('inv-string-readback-note').textContent).toMatch(/recorded kW per unit/);
  });
});

describe('the recommendation is not recomputed on every page render', () => {
  it('a fresh-but-equal strings array (the page maps computedSystem.strings inline each render) costs no new search', () => {
    const t = raysJob();
    const iv = interviewOf(t);
    const props = {
      topology: t, pvArray: pv37, busy: false, equipment: PW3_SELECTION, apply: async () => true, interview: iv,
      coupling: 'dc-coupled-storage' as const, pvInverterState: 'NONE' as const,
    };
    const view = render(<InvertersStringsDecisions {...props} derivedStrings={[...RAYS_STRINGS]} />);
    const afterMount = recommendCalls.n;
    view.rerender(<InvertersStringsDecisions {...props} derivedStrings={[...RAYS_STRINGS]} />);
    view.rerender(<InvertersStringsDecisions {...props} derivedStrings={[...RAYS_STRINGS]} />);
    expect(recommendCalls.n).toBe(afterMount);
    // …nor in the dialog's editor while it is open.
    fireEvent.click(screen.getByTestId('inv-string-review'));
    const afterOpen = recommendCalls.n;
    view.rerender(<InvertersStringsDecisions {...props} derivedStrings={[...RAYS_STRINGS]} />);
    view.rerender(<InvertersStringsDecisions {...props} derivedStrings={[...RAYS_STRINGS]} />);
    expect(recommendCalls.n).toBe(afterOpen);
    // A real change of strings IS recomputed.
    view.rerender(<InvertersStringsDecisions {...props} derivedStrings={[9, 9, 9, 9, 1]} />);
    expect(recommendCalls.n).toBeGreaterThan(afterOpen);
  });
});

describe('one Powerwall 3: the unit\'s landing is asked where the strings are, never a dead end', () => {
  const oneUnit = () => {
    const base = { ...ok(answerBackup(ok(answerServiceRating(null, 200)), 'whole', {
      gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', totalUnits: 1,
    })), solarCoupling: 'dc-coupled-storage' as const };
    // The service and battery questions above it in the queue, answered — so the strings are next.
    const service = ok(answerExistingService(ok(answerAvailableFaultCurrent(base, 10_000)), { existing: false }));
    return ok(answerStorageLanding(service, 'gateway-panelboard'));
  };
  const ONE: InterviewEquipment = { ...PW3, storage: { ...PW3.storage!, count: 1 }, gateway: { label: 'Tesla Gateway 3', count: 1 } };

  it('"Assign PV strings to storage inputs" is homed on Inverters & Strings, and [Answer Next] opens the String assignment editor', async () => {
    expect(homeOf('engineering.needs.pv.stringAssignment')).toBe('inverters');
    const writes: ServiceTopology[] = [];
    function Page() {
      const [t, setT] = useState(oneUnit());
      return (
        <EngineeringReadinessPanel topology={t} pvArray={pv37} derivedStrings={RAYS_STRINGS} busy={false}
                                   equipment={{ ...PW3_SELECTION, totalUnits: 1 }} interview={interviewOf(t, ONE)}
                                   apply={applyVia(async n => { writes.push(n); setT(n); return true; })} />
      );
    }
    render(<Page />);
    expect(findInterviewItem(interviewOf(oneUnit(), ONE), 'behavior.pv-landing')).toBeNull();
    expect(requiredQueue(interviewOf(oneUnit(), ONE))[0].id).toBe('engineering.needs.pv.stringAssignment');
    expect(screen.getByTestId('readiness-next-0').textContent).toContain('Assign PV strings to storage inputs');
    expect(screen.getByTestId('readiness-next-0').textContent).toContain('Inverters & Strings');
    fireEvent.click(screen.getByTestId('readiness-answer-next'));
    const dialog = screen.getByTestId('question-dialog');
    expect(screen.queryByTestId('question-no-editor')).toBeNull();
    const editor = within(within(dialog).getByTestId('question-editor'));
    expect(editor.getByTestId('inv-string-editor')).toBeTruthy();
    fireEvent.click(editor.getByTestId('inv-string-accept'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(invertingUnits(writes[0]).map(u => u.pvDcStcKw)).toEqual([16.28]);
    await waitFor(() => expect(screen.queryByTestId('question-dialog')).toBeNull());
    // Answered: the need is gone from the queue.
    expect(requiredQueue(interviewOf(writes[0], ONE)).map(i => i.id)).not.toContain('engineering.needs.pv.stringAssignment');
  });
});

describe('no dead imports in the card\'s files (eslint\'s no-unused-vars is off in this repo)', () => {
  const FILES = [
    'components/engineering/systemConfig/ItemEditor.tsx',
    'components/engineering/systemConfig/StringAssignmentEditor.tsx',
    'components/engineering/systemConfig/cards/InvertersStringsCard.tsx',
    'lib/electrical/storageStringAssignment.ts',
  ];
  it.each(FILES)('%s uses every name it imports', (file) => {
    const src = readFileSync(resolve(process.cwd(), file), 'utf8');
    const names: string[] = [];
    for (const m of src.matchAll(/^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+'[^']+';/gm)) {
      const clause = m[1];
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces) {
        for (const part of braces[1].split(',').map(x => x.trim()).filter(Boolean)) {
          names.push(part.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim());
        }
      }
      const def = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
      if (def && !def.startsWith('*')) names.push(...def.split(/\s+/).filter(Boolean));
    }
    expect(names.length).toBeGreaterThan(0);
    // `React` is the repo's convention for JSX files (the automatic runtime does not reference it).
    const unused = names.filter(n => n !== 'React' && (src.match(new RegExp(`\\b${n}\\b`, 'g')) ?? []).length < 2);
    expect(unused).toEqual([]);
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

  it('the conflict is resolved in one place: the card defers to the banner exactly when the banner offers the resolution, and the error prints once', () => {
    const card = page.indexOf('id="sc-card-inverters"');
    const mount = page.indexOf('<InvertersStringsDecisions {...interviewEditorContext} interview={systemConfigInterview}');
    const tag = page.slice(mount, page.indexOf('/>', mount));
    expect(tag).toContain('conflictResolvedAbove={_archBannerResolves}');
    expect(tag).toContain('connectionError={_archBannerShown ? null : _archResolveError}');
    // The banner is drawn by the same condition the card is told about — one expression, not two copies.
    const banner = page.slice(card, mount);
    expect(banner).toContain('{_archBannerShown && _archOrigin ? (');
    expect(banner).toContain('data-testid="config-inverter-provenance"');
    const decl = page.indexOf('const _archBannerShown =');
    expect(decl).toBeGreaterThan(0);
    expect(page.slice(decl, page.indexOf(';', decl)))
      .toMatch(/electrical\?\.hasExternalInverter && _archOrigin\s*&& \(_archUnresolved \|\| _archOrigin\.kind === 'AUTO_SUGGESTED_LEGACY'\)/);
    const resolves = page.indexOf('const _archBannerResolves =');
    expect(page.slice(resolves, page.indexOf(';', resolves)))
      .toMatch(/_archBannerShown && _archUnresolved && \(electrical\?\.architectureChoices\?\.length \?\? 0\) > 0/);
  });
});
