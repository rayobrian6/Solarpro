/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// System Config V3 — the SYSTEM CONFIGURATION card, clicked.
//
// Ray: "The existing System Config sections must become smarter and absorb the engineering questions
// that naturally belong there." The right-column card keeps its project settings and absorbs the
// architecture: PV architecture (stated, asked on Inverters & Strings), backup, how the systems
// connect, ONE interconnection control over the service graph (replacing the four-button grid that
// offered 120% remedies as connection types), the meter-collar ruling beside the utility meter, and
// UTILITY ISOLATION with its equipment behind [Select Equipment].
//
// Every write goes through `apply` (the page's one write path) and is fed back into the interview, as
// the page does; the legacy `config.interconnectionMethod` scalar follows the graph.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerDistribution, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { selectionPairOf } from '@/lib/electrical/systemConfigSystemEquipment';
import { updatePointOfInterconnection } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign, type PvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { evaluateServiceTopology, type ServiceTopology, type SolarCoupling } from '@/lib/electrical/serviceTopology';
import { anchorOf, findInterviewItem } from '@/lib/electrical/systemConfigPlacement';
import { applyVia, type SystemEquipmentSelection } from '@/components/engineering/systemConfig/ItemEditor';
import {
  MeterCollarControl, SystemArchitectureControls,
} from '@/components/engineering/systemConfig/cards/SystemConfigurationControls';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pv20 = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const pv37 = resolvePvArrayDesign({ placedModuleCount: 37, selectedPanelId: 'panel-fence-ps1' });
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };
const PW3: InterviewEquipment = {
  pvInverter: { state: 'NONE' },
  storage: { label: 'Tesla Powerwall 3', count: 4, pvInput: true, backupCapable: true, requiresGateway: true },
  gateway: { label: 'Tesla Gateway 3', count: 2 },
};
const NO_SELECTION: SystemEquipmentSelection = { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 };
const house200 = () => ok(answerServiceRating(null, 200));
const house400two = () => ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
const rays = () => ({ ...buildRaysIntendedJob().topology, solarCoupling: 'dc-coupled-storage' as const });
const raysSelection = (t: ServiceTopology): SystemEquipmentSelection => {
  const pair = selectionPairOf(t);
  return { gatewayProductId: pair.gateway?.productId ?? null, storageProductId: pair.unit?.productId ?? null,
    storageLabel: 'Tesla Powerwall 3', totalUnits: 4 };
};

interface Mount {
  topology: ServiceTopology | null;
  pvArray?: PvArrayDesign;
  equipment?: InterviewEquipment;
  coupling?: SolarCoupling | null;
  selection?: SystemEquipmentSelection;
  legacy?: string;
  legacyBusbarFails?: boolean;
  expanded?: boolean;
  /** The server refuses every write (PUT /service-topology 4xx / network) with this page error. */
  failWith?: string;
}

/** The card as the page mounts it: every accepted write becomes the graph the interview is rebuilt from. */
function mountCard(m: Mount) {
  const writes: ServiceTopology[] = [];
  const mirrored: string[] = [];
  const onGoToCard = vi.fn();
  const pvArray = m.pvArray ?? pv20;
  function Page() {
    const [t, setT] = useState<ServiceTopology | null>(m.topology);
    const [legacy, setLegacy] = useState<string>(m.legacy ?? 'UNRESOLVED');
    const coupling = m.coupling ?? null;
    const interview = buildSystemConfigInterview({
      pvArray, topology: t, coupling, couplingIsDecision: coupling !== null, architectureConflict: false,
      equipment: m.equipment ?? MICROS, evaluation: t ? evaluateServiceTopology(t) : null,
    });
    const props = {
      interview, topology: t, pvArray, derivedStrings: [], equipment: m.selection ?? NO_SELECTION, busy: false,
      apply: applyVia(async (next: ServiceTopology) => {
        if (m.failWith) return false;
        writes.push(next); setT(next); return true;
      }),
      error: m.failWith ?? null,
      legacyInterconnectionMethod: legacy,
      onLegacyInterconnection: (token: string) => { mirrored.push(token); setLegacy(token); },
      onGoToCard,
    };
    return (
      <div className="grid grid-cols-2">
        <MeterCollarControl {...props} className="col-span-2" />
        <SystemArchitectureControls {...props} expanded={m.expanded} legacyBusbarFails={m.legacyBusbarFails} />
        <output data-testid="legacy-scalar">{legacy}</output>
      </div>
    );
  }
  render(<Page />);
  return { writes, mirrored, onGoToCard };
}

const optionValues = (testid: string) =>
  [...(screen.getByTestId(testid) as HTMLSelectElement).options].map(o => o.value).filter(Boolean);
const valueOf = (testid: string) => (screen.getByTestId(testid) as HTMLSelectElement).value;
const pick = (testid: string, value: string) => fireEvent.change(screen.getByTestId(testid), { target: { value } });

describe('INTERCONNECTION — one control over the service graph', () => {
  it('without a service graph: "Set the existing service first →" goes to the Service card, and nothing else is asked', () => {
    const { onGoToCard } = mountCard({ topology: null });
    expect(screen.getByTestId('sys-interconnection-set-service').getAttribute('href')).toBe('#sc-card-service');
    fireEvent.click(screen.getByTestId('sys-interconnection-set-service'));
    expect(onGoToCard).toHaveBeenCalledWith('service.rating');
    expect(anchorOf(onGoToCard.mock.calls[0][0])).toBe('sc-card-service');
    for (const id of ['sys-interconnection', 'sys-backup', 'sys-systems', 'sys-isolation', 'sys-meter-collar']) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
  });

  it('a write the server refuses is shown on the card — the select does not fail silently', async () => {
    const { writes, mirrored } = mountCard({ topology: house200(), failWith: 'Could not save the service: 401' });
    expect(screen.queryByTestId('sys-refusal')).toBeNull();
    pick('sys-interconnection', 'load-side-busbar');
    await waitFor(() => expect(screen.getByTestId('sys-refusal').textContent).toContain('Could not save the service: 401'));
    expect(writes).toHaveLength(0);
    expect(mirrored).toHaveLength(0);
  });

  it('a plain 200 A house: the interview\'s connection choices only — no 120% remedy offered as a connection type, no backup, no systems', () => {
    mountCard({ topology: house200() });
    const iv = buildSystemConfigInterview({ pvArray: pv20, topology: house200(), coupling: null, couplingIsDecision: false,
      architectureConflict: false, equipment: MICROS, evaluation: evaluateServiceTopology(house200()) });
    expect(optionValues('sys-interconnection')).toEqual(findInterviewItem(iv, 'behavior.interconnection')!.options!.map(o => o.value));
    expect(optionValues('sys-interconnection')).toEqual(['load-side-busbar', 'supply-side', 'load-side-feeder-tap', 'meter-collar']);
    expect(valueOf('sys-interconnection')).toBe('');   // nothing chosen for the installer
    expect(screen.getByTestId('sys-interconnection-row').getAttribute('data-state')).toBe('needs-answer');
    const card = screen.getByTestId('sys-architecture').textContent ?? '';
    expect(card).not.toMatch(/derate|upgrade/i);
    expect(screen.queryByTestId('sys-backup')).toBeNull();
    expect(screen.queryByTestId('sys-systems')).toBeNull();
  });

  it('choosing load side writes the graph and mirrors LOAD_SIDE onto the legacy scalar; supply side follows the same way', async () => {
    const { writes, mirrored } = mountCard({ topology: house200() });
    pick('sys-interconnection', 'load-side-busbar');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pointsOfInterconnection.length).toBeGreaterThan(0);
    expect(writes[0].pointsOfInterconnection.every(p => p.relationship === 'load-side-busbar')).toBe(true);
    await waitFor(() => expect(mirrored).toEqual(['LOAD_SIDE']));
    expect(valueOf('sys-interconnection')).toBe('load-side-busbar');
    expect(screen.getByTestId('sys-interconnection-code').textContent).toBe('NEC 705.12(B)');

    pick('sys-interconnection', 'supply-side');
    await waitFor(() => expect(writes).toHaveLength(2));
    await waitFor(() => expect(mirrored).toEqual(['LOAD_SIDE', 'SUPPLY_SIDE_TAP']));
    expect(screen.getByTestId('legacy-scalar').textContent).toBe('SUPPLY_SIDE_TAP');
    expect(screen.getByTestId('sys-interconnection-code').textContent).toBe('NEC 705.11');
  });

  it('🚨 a 120% remedy already recorded survives a load-side answer, and reads as a remedy, not a connection', async () => {
    const { writes, mirrored } = mountCard({ topology: house200(), legacy: 'MAIN_BREAKER_DERATE' });
    expect(screen.getByTestId('sys-interconnection-remedy').textContent).toBe('120% remedy recorded: Main breaker derate');
    pick('sys-interconnection', 'load-side-busbar');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(mirrored).toEqual([]);
    expect(screen.getByTestId('legacy-scalar').textContent).toBe('MAIN_BREAKER_DERATE');
  });

  it('a 120% FAIL is flagged on the card and points to the remedies on the Service card', () => {
    const { onGoToCard } = mountCard({ topology: house200(), legacyBusbarFails: true });
    expect(screen.getByTestId('sys-busbar-violation').textContent).toBe('120% VIOLATION');
    fireEvent.click(screen.getByTestId('sys-busbar-remedies'));
    expect(anchorOf(onGoToCard.mock.calls[0][0])).toBe('sc-card-service');
  });

  it('an earlier legacy pick that never reached the graph is named, not adopted', () => {
    const { writes } = mountCard({ topology: house200(), legacy: 'LOAD_SIDE' });
    expect(valueOf('sys-interconnection')).toBe('');
    expect(screen.getByTestId('sys-interconnection-legacy').textContent).toContain('Load-side backfeed');
    expect(writes).toEqual([]);
  });
});

describe('METER COLLAR — beside the utility meter, only while it matters', () => {
  it('"not permitted" withdraws a chosen collar, removes it from the choices, and the legacy scalar leaves METER_COLLAR', async () => {
    const { writes, mirrored } = mountCard({ topology: house200() });
    expect(valueOf('sys-meter-collar')).toBe('unknown');
    expect(screen.getByTestId('sys-meter-collar-row').getAttribute('data-state')).toBe('needs-verification');
    pick('sys-interconnection', 'meter-collar');
    await waitFor(() => expect(mirrored).toEqual(['METER_COLLAR']));
    // chosen while the utility has not ruled: NEEDS VERIFICATION, never answered
    expect(screen.getByTestId('sys-interconnection-row').getAttribute('data-state')).toBe('needs-verification');
    expect(screen.getByTestId('sys-interconnection-note').textContent).toContain('permission not established');

    pick('sys-meter-collar', 'not-permitted');
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].interconnection.meterCollarPermitted).toBe(false);
    expect(writes[1].interconnection.meterCollarSelected).toBe(false);
    expect(writes[1].pointsOfInterconnection.every(p => p.relationship === 'unresolved')).toBe(true);
    await waitFor(() => expect(mirrored).toEqual(['METER_COLLAR', 'UNRESOLVED']));
    expect(optionValues('sys-interconnection')).not.toContain('meter-collar');
    expect(valueOf('sys-interconnection')).toBe('');
    expect(valueOf('sys-meter-collar')).toBe('not-permitted');
  });

  it('is not asked once the system connects another way and nobody has recorded a ruling', async () => {
    const { writes } = mountCard({ topology: house200() });
    expect(screen.getByTestId('sys-meter-collar')).toBeTruthy();
    pick('sys-interconnection', 'supply-side');
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('sys-meter-collar')).toBeNull());
  });
});

describe('Ray\'s job — PV architecture stated, backup and systems from the graph', () => {
  const mountRays = (extra: Partial<Mount> = {}) => {
    const t = rays();
    return mountCard({ topology: t, pvArray: pv37, equipment: PW3, coupling: 'dc-coupled-storage',
      selection: raysSelection(t), ...extra });
  };

  it('PV ARCHITECTURE is a stated fact with a way to the Inverters & Strings card — never asked here', () => {
    const { onGoToCard } = mountRays();
    expect(screen.getByTestId('sys-pv-architecture').textContent).toBe('DC coupled to Tesla Powerwall 3');
    expect(screen.queryByTestId('answer-pv-connection-dc-coupled-storage')).toBeNull();
    expect(screen.getByTestId('sys-pv-architecture-row').querySelector('select,input')).toBeNull();
    expect(screen.getByTestId('sys-pv-architecture-link').getAttribute('href')).toBe('#sc-card-inverters');
    fireEvent.click(screen.getByTestId('sys-pv-architecture-link'));
    expect(anchorOf(onGoToCard.mock.calls[0][0])).toBe('sc-card-inverters');
  });

  it('BACKUP, SYSTEMS CONNECT and INTERCONNECTION read the graph; the code for an integrated connection is the listing', () => {
    mountRays();
    expect(valueOf('sys-backup')).toBe('whole');
    expect(optionValues('sys-backup')).toEqual(['whole', 'panels', 'none']);
    expect(valueOf('sys-systems')).toBe('independent-branch');
    expect(valueOf('sys-interconnection')).toBe('manufacturer-integrated');
    expect(screen.getByTestId('sys-interconnection-code').textContent).toBe('Governed by the manufacturer’s listing');
  });

  it('"Only the panels I choose" opens the per-panel backup editor and writes nothing until it is saved', async () => {
    const { writes } = mountRays();
    pick('sys-backup', 'panels');
    const dialog = await screen.findByTestId('question-dialog');
    expect(dialog.querySelector('[data-item-id]')?.getAttribute('data-item-id')).toBe('behavior.backup');
    const msp2 = within(dialog).getByTestId('answer-system-equipment-backup-panel-msp-2') as HTMLInputElement;
    expect(msp2.checked).toBe(true);
    expect(writes).toEqual([]);
    // Taking MSP #2 out removes System 2, which has its isolation switch and point of interconnection
    // on it: the writer refuses, the dialog says so, and nothing is written.
    fireEvent.click(msp2);
    fireEvent.click(within(dialog).getByTestId('answer-system-equipment-backup-save'));
    expect((await within(dialog).findByTestId('answer-refusal')).textContent).toMatch(/^Taking MSP #2 out of backup removes System 2/);
    expect(writes).toEqual([]);
    fireEvent.click(within(dialog).getByTestId('question-dialog-close'));
    expect(screen.queryByTestId('question-dialog')).toBeNull();
  });

  it('points recorded differently per system: said so (not "not established"), and one answer sets them all', async () => {
    const t0 = rays();
    const [p1, p2] = t0.pointsOfInterconnection;
    const mixed = updatePointOfInterconnection(updatePointOfInterconnection(t0, p1.id, { relationship: 'load-side-busbar' }),
      p2.id, { relationship: 'supply-side' });
    const { writes, mirrored } = mountCard({ topology: mixed, pvArray: pv37, equipment: PW3, coupling: 'dc-coupled-storage',
      selection: raysSelection(mixed) });
    expect(valueOf('sys-interconnection')).toBe('');
    expect((screen.getByTestId('sys-interconnection') as HTMLSelectElement).selectedOptions[0].textContent)
      .toBe('Differs per system — choose one for all…');
    expect(screen.getByTestId('sys-interconnection-note').textContent)
      .toBe('Breaker in the panel (load side) · Line-side tap ahead of the main (supply side)');
    pick('sys-interconnection', 'supply-side');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].pointsOfInterconnection.map(p => p.relationship)).toEqual(['supply-side', 'supply-side']);
    await waitFor(() => expect(mirrored).toEqual(['SUPPLY_SIDE_TAP']));
  });

  it('SYSTEMS CONNECT writes the arrangement through the graph', async () => {
    const { writes } = mountRays();
    pick('sys-systems', 'common-aggregation');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].interconnection.derArrangement).toBe('common-aggregation');
    expect(valueOf('sys-systems')).toBe('common-aggregation');
  });

  it('UTILITY ISOLATION: required · quantity · arrangement · status on the card; position, part, rating and SCCR only behind [Select Equipment]', async () => {
    const { writes } = mountRays();
    const iso = screen.getByTestId('sys-isolation');
    expect(valueOf('sys-isolation-required')).toBe('yes');
    expect(screen.getByTestId('sys-isolation-quantity').textContent).toBe('2');
    expect(valueOf('sys-isolation-arrangement')).toBe('one-per-path');
    expect((screen.getByTestId('sys-isolation-arrangement') as HTMLSelectElement).selectedOptions[0].textContent).toBe('One per 200 A system');
    expect(valueOf('sys-isolation-accepted')).toBe('unknown');
    expect((screen.getByTestId('sys-isolation-accepted') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Requires confirmation');
    expect(screen.getByTestId('sys-isolation-equipment-summary').textContent).toBe('2 switches · parts not selected');
    // the switch detail is NOT on the card
    expect(within(iso).queryAllByTestId(/^answer-disconnect-/)).toHaveLength(0);

    fireEvent.click(screen.getByTestId('sys-isolation-equipment'));
    const dialog = await screen.findByTestId('question-dialog');
    expect(within(dialog).getByTestId('answer-disconnect-role-der-isolation-disconnect')).toBeTruthy();
    const part = within(dialog).getByTestId('answer-disconnect-part-knife-a');
    fireEvent.change(part, { target: { value: 'DU224RB' } });
    fireEvent.blur(part);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].devices.find(d => d.id === 'knife-a')?.productId).toBe('DU224RB');
    // several writes edit one switch: the dialog stays open and says it saved
    expect(await within(dialog).findByTestId('question-saved')).toBeTruthy();
    fireEvent.click(within(dialog).getByTestId('question-dialog-done'));
    expect(screen.getByTestId('sys-isolation-equipment-summary').textContent).toBe('2 switches · 1 of 2 parts selected');

    pick('sys-isolation-accepted', 'yes');
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].interconnection.isolationArrangementAccepted).toBe(true);
  });

  it('MANUAL mode: the switch editor and the per-panel backup detail are expanded inline, still inside the card', () => {
    mountRays({ expanded: true });
    expect(screen.queryByTestId('sys-isolation-equipment')).toBeNull();
    const inline = screen.getByTestId('sys-isolation-equipment-inline');
    expect(within(inline).getByTestId('answer-disconnect-role-der-isolation-disconnect')).toBeTruthy();
    expect(screen.getByTestId('sys-backup-detail').textContent).toContain('MSP #2 — backed up by System 2');
  });
});

describe('UTILITY ISOLATION on a service being set up', () => {
  it('a 400 A two-path service: "Yes" records the requirement, then the arrangement places one switch per path', async () => {
    const { writes } = mountCard({ topology: house400two() });
    expect(valueOf('sys-isolation-required')).toBe('unknown');
    expect(screen.queryByTestId('sys-isolation-arrangement')).toBeNull();
    pick('sys-isolation-required', 'yes');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].interconnection.externalDerIsolationRequired).toBe(true);
    expect(screen.getByTestId('sys-isolation-quantity').textContent).toBe('None placed');
    expect(valueOf('sys-isolation-arrangement')).toBe('');
    expect(screen.queryByTestId('sys-isolation-accepted')).toBeNull();
    pick('sys-isolation-arrangement', 'one-per-path');
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].devices.filter(d => d.roles.includes('der-isolation-disconnect'))).toHaveLength(2);
    expect(screen.getByTestId('sys-isolation-quantity').textContent).toBe('2');
    expect(valueOf('sys-isolation-accepted')).toBe('unknown');
  });

  it('a single-path house: "Yes" places its one switch (there is one place it can go); no arrangement is asked', async () => {
    const { writes } = mountCard({ topology: house200() });
    pick('sys-isolation-required', 'yes');
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.getByTestId('sys-isolation-quantity').textContent).toBe('1');
    expect(screen.queryByTestId('sys-isolation-arrangement')).toBeNull();
  });
});

describe('a writer\'s refusal is shown on the card and never written', () => {
  it('whole-home backup with no backup controller chosen', async () => {
    const { writes } = mountCard({ topology: house400two(), pvArray: pv37, equipment: { ...PW3, gateway: null },
      coupling: 'dc-coupled-storage', selection: { ...NO_SELECTION, storageLabel: 'Tesla Powerwall 3', totalUnits: 4 } });
    expect(valueOf('sys-backup')).toBe('');
    pick('sys-backup', 'whole');
    expect((await screen.findByTestId('sys-refusal')).textContent).toMatch(/^Choose the backup controller \/ gateway/);
    expect(writes).toEqual([]);
  });
});

describe('the page mounts the card controls where the old grid was', () => {
  const page = readFileSync(resolve(__dirname, '../app/engineering/page.tsx'), 'utf8');
  const start = page.indexOf('id="sc-card-system-config"');
  const card = page.slice(start, page.indexOf('{/* ── Quick Design Notes ── */}', start));

  it('the four-button Interconnection Method grid is gone — no remedy is a connection type', () => {
    expect(start).toBeGreaterThan(0);
    expect(card).not.toMatch(/className="eng-label[^"]*">\s*Interconnection Method/);
    expect(card).not.toContain('_icOptions');
    expect(card).not.toMatch(/value:\s*'MAIN_BREAKER_DERATE'|value:\s*'PANEL_UPGRADE'/);
    expect(card).not.toContain('interconnectionMethod: opt.value');
  });

  it('one interconnection control over the graph, mirrored onto config.interconnectionMethod; the meter collar beside the meter', () => {
    expect(card).toMatch(/<SystemArchitectureControls \{\.\.\.interviewEditorContext\} interview=\{systemConfigInterview\}/);
    expect(card).toMatch(/expanded=\{controlMode === 'manual'\}/);
    // The scalar mirror is the page's write path (writeInterviewAnswer), not a card callback — so the
    // dialog, Guided [Answer] and Answer Next mirror it too (tests/systemConfigLegacyInterconnection.test.ts).
    expect(card).not.toContain('onLegacyInterconnection=');
    expect((card.match(/legacyInterconnectionMethod=\{config\.interconnectionMethod\}/g) ?? [])).toHaveLength(2);
    const meter = card.indexOf('>Utility Meter</label>');
    const collar = card.indexOf('<MeterCollarControl');
    expect(meter).toBeGreaterThan(0);
    expect(collar).toBeGreaterThan(meter);
    expect(collar).toBeLessThan(card.indexOf('Mounting System'));
  });

  it('keeps the project settings: system type, utility meter, mounting, combiner, consumption CTs, engineering mode', () => {
    for (const s of ['<CombinerSelector', 'System Type', '>Utility Meter</label>', 'Mounting System', 'Consumption CTs', 'Engineering Mode']) {
      expect(card, s).toContain(s);
    }
  });
});
