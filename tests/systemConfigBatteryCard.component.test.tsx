/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The Battery Storage card, clicked (System Config V3 — "Battery edits in Battery").
//
//   · Before the service graph has a backup system, the project selection is edited as before, plus
//     the backup controller — offered only from what the catalogue lists with the battery, and
//     dropped when the battery changes to one it is not listed with.
//   · Once the graph has systems it is the record: Ray's job reads 4 batteries across 2 systems,
//     2 controllers, and one line per system. The quantity is NOT an input with more than one
//     system — a count is changed per system, never split.
//   · Per-system editing (controller, batteries, expansions, where its AC circuits land) lives only
//     behind [Configure systems differently] — inline in Manual mode — and writes THAT system.
//   · "AC aggregation" is asked once and writes every system; a system combined in a shared panel
//     is refused by the writer, shown in the card, and never written.
//   · One system: the card's own controls edit it (quantity, expansion packs).
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerSystemsArrangement, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { systemEquipmentFacts } from '@/lib/electrical/systemConfigSystemEquipment';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { applyVia } from '@/components/engineering/systemConfig/ItemEditor';
import { BatteryStorageCard } from '@/components/engineering/systemConfig/cards/BatteryStorageCard';
import type { BatterySelection } from '@/lib/electrical/systemConfigBatteryCard';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { ControlMode } from '@/types';

afterEach(cleanup);

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const GW2 = 'tesla-backup-gateway-2';
const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult) => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function interviewOf(t: ServiceTopology | null, storage = true) {
  return buildSystemConfigInterview({
    pvArray, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
      storage: storage ? { label: 'Tesla Powerwall 3', count: 4, pvInput: false, backupCapable: true, requiresGateway: true } : null,
      gateway: t && t.domains.length > 0 ? { label: 'Tesla Backup Gateway 3', count: t.domains.length } : null,
    },
    evaluation: null,
  });
}

function mount(t: ServiceTopology | null, opts: { mode?: ControlMode; selection?: Partial<BatterySelection> } = {}) {
  const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => true);
  const onSelectionChange = vi.fn();
  const selection: BatterySelection = { batteryId: PW3, batteryCount: 4, batteryKwh: 13.5, backupInterfaceId: '', ...opts.selection };
  render(
    <BatteryStorageCard interview={interviewOf(t)} controlMode={opts.mode ?? 'auto'} topology={t} pvArray={pvArray}
                        derivedStrings={[]} busy={false} apply={applyVia(onWrite)}
                        equipment={{ gatewayProductId: GW3, storageProductId: PW3, storageLabel: 'Tesla Powerwall 3', totalUnits: 4 }}
                        selection={selection} onSelectionChange={onSelectionChange} pvKw={8.8} />,
  );
  return { onWrite, onSelectionChange };
}
const options = (testid: string) =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).filter(o => !o.disabled).map(o => o.value);
const countsOf = (t: ServiceTopology) => t.domains.map(d => systemEquipmentFacts(t, d).inverting.length);

describe('before the service graph has a backup system: the project selection', () => {
  it('the controller is offered only from what the catalogue lists with the battery, × one', () => {
    const { onSelectionChange } = mount(null);
    expect(screen.getByTestId('bat-card').getAttribute('data-record')).toBe('selection');
    expect((screen.getByTestId('bat-qty') as HTMLInputElement).value).toBe('4');
    expect(options('bat-controller').filter(Boolean).sort()).toEqual([GW2, GW3]);
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('—');
    expect(screen.queryByTestId('bat-grouping')).toBeNull();
    fireEvent.change(screen.getByTestId('bat-controller'), { target: { value: GW3 } });
    expect(onSelectionChange).toHaveBeenCalledWith({ backupInterfaceId: GW3 });
  });

  it('changing the battery drops a controller the catalogue does not list with it — and picks none', () => {
    const { onSelectionChange } = mount(null, { selection: { backupInterfaceId: GW3 } });
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('1');
    fireEvent.change(screen.getByTestId('bat-model'), { target: { value: 'enphase-iq-battery-5p' } });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      batteryId: 'enphase-iq-battery-5p', batteryCount: 4, batteryKwh: 5, backupInterfaceId: '',
    }));
  });

  it('a battery the catalogue lists with no backup controller says NOT EVALUATED and offers none', () => {
    mount(null, { selection: { batteryId: 'generac-pwrcell-9', batteryKwh: 9 } });
    expect(screen.getByTestId('bat-controller-note').textContent).toMatch(/NOT EVALUATED — MANUFACTURER INFORMATION REQUIRED/);
    expect(options('bat-controller').filter(Boolean)).toEqual([]);
  });

  it('expansion packs the catalogue lists are named, to be recorded per system', () => {
    mount(null);
    expect(screen.getByTestId('bat-expansions').textContent).toMatch(/Powerwall 3 Expansion/);
  });
});

describe('the graph has backup systems: the graph is the record (Ray\'s job)', () => {
  it('totals from the graph, one controller per system, one compact line per system', () => {
    mount(buildRaysIntendedJob().topology, { selection: { batteryCount: 1 } });
    expect(screen.getByTestId('bat-card').getAttribute('data-record')).toBe('service-graph');
    // The graph says 4 — the selection's stale 1 is not shown.
    const qty = screen.getByTestId('bat-qty');
    expect(qty.tagName, 'with two systems the total is read, never typed and split').toBe('OUTPUT');
    expect(qty.textContent).toMatch(/^4/);
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('2');
    expect(screen.getByTestId('bat-total-kwh').textContent).toBe('54.0');
    expect(screen.getByTestId('bat-grouping').textContent).toMatch(/Battery grouping · 2 systems/);
    expect(screen.getByTestId('bat-system-domain-a').textContent).toBe('System 1 · 2 × Powerwall 3 · 1 × Backup Gateway 3');
    expect(screen.getByTestId('bat-system-domain-b').textContent).toBe('System 2 · 2 × Powerwall 3 · 1 × Backup Gateway 3');
  });

  it('per-system editing is hidden until [Configure systems differently], then writes THAT system', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology, { mode: 'guided' });
    expect(screen.queryByTestId('answer-system-equipment-ess-count-domain-a')).toBeNull();
    expect(screen.queryByTestId('bat-system-landing-domain-a')).toBeNull();
    fireEvent.click(screen.getByTestId('bat-configure-differently'));
    fireEvent.change(screen.getByTestId('answer-system-equipment-ess-count-domain-a'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('answer-system-equipment-save-domain-a'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(countsOf(onWrite.mock.calls[0][0])).toEqual([3, 2]);
  });

  it('Manual mode shows each system\'s detail inline, with no toggle', () => {
    mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    expect(screen.queryByTestId('bat-configure-differently')).toBeNull();
    expect(screen.getByTestId('bat-grouping').getAttribute('data-expanded')).toBe('true');
    for (const d of ['domain-a', 'domain-b']) {
      expect(screen.getByTestId(`answer-system-equipment-gateway-${d}`)).toBeTruthy();
      expect(screen.getByTestId(`bat-system-landing-${d}`)).toBeTruthy();
    }
  });

  it('a system\'s own landing writes that system only', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    fireEvent.change(screen.getByTestId('bat-system-landing-domain-b'), { target: { value: 'backed-up-panel-busbar' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(onWrite.mock.calls[0][0].domains.map(d => d.storageConnection)).toEqual(['der-aggregation-panel', 'backed-up-panel-busbar']);
  });

  it('the controller asked once: Record for every system writes both, each keeping its count', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology);
    expect(screen.queryByTestId('bat-record')).toBeNull();
    fireEvent.change(screen.getByTestId('bat-controller'), { target: { value: GW2 } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    expect(next.domains.map(d => d.gateway.productId)).toEqual([GW2, GW2]);
    expect(countsOf(next)).toEqual([2, 2]);
  });

  it('AC aggregation is asked once and writes every system in one write', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology);
    // Ray's job: each pair of Powerwalls lands in its own generation panel.
    expect((screen.getByTestId('bat-aggregation') as HTMLSelectElement).value).toBe('der-aggregation-panel');
    fireEvent.change(screen.getByTestId('bat-aggregation'), { target: { value: 'gateway-panelboard' } });
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(onWrite.mock.calls[0][0].domains.map(d => d.storageConnection)).toEqual(['gateway-panelboard', 'gateway-panelboard']);
  });

  it('systems combined in one shared generation panel: the writer\'s refusal is shown, nothing is written', async () => {
    const t = ok(answerSystemsArrangement(buildRaysIntendedJob().topology, 'common-aggregation'));
    const { onWrite } = mount(t);
    fireEvent.change(screen.getByTestId('bat-aggregation'), { target: { value: 'der-aggregation-panel' } });
    await waitFor(() => expect(screen.getByTestId('bat-refusal').textContent).toMatch(/combined with the other systems/));
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe('one backup system: the card\'s own controls edit it', () => {
  const single = () => buildTesla400ATwoGateway({ collapseToSingleGateway: true, powerwallsPerSystem: 2, expansionsPerSystem: 0 }).topology;

  it('no grouping; quantity is an input; Record writes the system\'s new count', async () => {
    const { onWrite } = mount(single());
    expect(screen.queryByTestId('bat-grouping')).toBeNull();
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('1');
    fireEvent.change(screen.getByTestId('bat-qty'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(countsOf(onWrite.mock.calls[0][0])).toEqual([3]);
  });

  it('expansion packs: the one expansion the catalogue lists for the battery, one per battery', async () => {
    const { onWrite } = mount(single());
    fireEvent.change(screen.getByTestId('bat-expansions'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    const f = systemEquipmentFacts(next, next.domains[0]);
    expect([f.inverting.length, f.expansions.length, f.expansionProductId]).toEqual([2, 1, 'tesla-powerwall-3-expansion']);
  });

  it('more expansion packs than batteries is refused in the card, not written', async () => {
    const { onWrite } = mount(single());
    fireEvent.change(screen.getByTestId('bat-expansions'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(screen.getByTestId('bat-refusal').textContent).toMatch(/harnessed to one battery/));
    expect(onWrite).not.toHaveBeenCalled();
    // What the installer typed is kept for them to correct.
    expect((within(screen.getByTestId('bat-card')).getByTestId('bat-expansions') as HTMLInputElement).value).toBe('3');
  });
});
