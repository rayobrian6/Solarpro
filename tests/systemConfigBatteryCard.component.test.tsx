/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The Battery Storage card, clicked (System Config V3 — "Battery edits in Battery").
//
//   · Before the service graph has a backup system, the project selection is edited as before, plus
//     the backup controller — offered only from what the catalogue lists with the battery, recorded
//     in `backupControllerId` (NEVER the legacy BUI field), dropped when the battery changes to one
//     it is not listed with, and called out when another writer left it beside such a battery.
//   · Once the graph has systems it is the record: Ray's job reads 4 batteries across 2 systems,
//     2 controllers, and one line per system. The quantity is NOT an input with more than one
//     system — a count is changed per system, never split. The storage total is the graph's.
//   · Per-system editing (controller, batteries, expansions, where its AC circuits land — never the
//     battery model) lives only behind [Configure systems differently] — inline in Manual mode — and
//     writes THAT system. A job whose systems hold different batteries is flagged.
//   · "AC aggregation" is asked once and writes every system; a system combined in a shared panel
//     is refused by the writer, shown in the card, and never written.
//   · An edit that would leave every system with no battery is refused; a write the page could not
//     save is said in the card.
//   · One system: the card's own controls edit it (quantity, expansion packs).
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerSystemsArrangement, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { answerSystemEquipment, systemEquipmentFacts } from '@/lib/electrical/systemConfigSystemEquipment';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob, buildTesla400ATwoGateway } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { applyVia } from '@/components/engineering/systemConfig/ItemEditor';
import { BatteryStorageCard, BatteryOffNote, EMPTIES_EVERY_SYSTEM } from '@/components/engineering/systemConfig/cards/BatteryStorageCard';
import type { BatterySelection } from '@/lib/electrical/systemConfigBatteryCard';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';
import type { ControlMode } from '@/types';

afterEach(cleanup);

const PW3 = 'tesla-powerwall-3';
const GW3 = 'tesla-backup-gateway-3';
const GW2 = 'tesla-backup-gateway-2';
const SC3 = 'enphase-iq-system-controller-3';
const IQ5P = 'enphase-iq-battery-5p';
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

function mount(t: ServiceTopology | null, opts: {
  mode?: ControlMode; selection?: Partial<BatterySelection>; writes?: boolean; error?: string | null;
} = {}) {
  const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => opts.writes ?? true);
  const onSelectionChange = vi.fn();
  const selection: BatterySelection = {
    batteryId: PW3, batteryCount: 4, batteryKwh: 13.5, backupControllerId: '', backupInterfaceId: '', ...opts.selection,
  };
  render(
    <BatteryStorageCard interview={interviewOf(t)} controlMode={opts.mode ?? 'auto'} topology={t} pvArray={pvArray}
                        derivedStrings={[]} busy={false} apply={applyVia(onWrite)} error={opts.error}
                        equipment={{ gatewayProductId: GW3, storageProductId: selection.batteryId || null, storageLabel: 'Tesla Powerwall 3', totalUnits: 4 }}
                        selection={selection} onSelectionChange={onSelectionChange} pvKw={8.8} />,
  );
  return { onWrite, onSelectionChange };
}
const options = (testid: string) =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).filter(o => !o.disabled).map(o => o.value);
const countsOf = (t: ServiceTopology) => t.domains.map(d => systemEquipmentFacts(t, d).inverting.length);

describe('before the service graph has a backup system: the project selection', () => {
  it('the controller is offered only from what the catalogue lists with the battery, × one — recorded in backupControllerId', () => {
    const { onSelectionChange } = mount(null);
    expect(screen.getByTestId('bat-card').getAttribute('data-record')).toBe('selection');
    expect((screen.getByTestId('bat-qty') as HTMLInputElement).value).toBe('4');
    expect(options('bat-controller').filter(Boolean).sort()).toEqual([GW2, GW3]);
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('—');
    expect(screen.queryByTestId('bat-grouping')).toBeNull();
    fireEvent.change(screen.getByTestId('bat-controller'), { target: { value: GW3 } });
    // 🚨 [blocking] never the legacy BUI field the engines turn into a feeder and a second gateway row.
    expect(onSelectionChange).toHaveBeenCalledWith({ backupControllerId: GW3 });
    expect(onSelectionChange.mock.calls.flat().some(p => 'backupInterfaceId' in p)).toBe(false);
  });

  it('changing the battery drops a controller the catalogue does not list with it — and picks none', () => {
    const { onSelectionChange } = mount(null, { selection: { backupControllerId: GW3 } });
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('1');
    fireEvent.change(screen.getByTestId('bat-model'), { target: { value: IQ5P } });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      batteryId: IQ5P, batteryCount: 4, batteryKwh: 5, backupControllerId: '',
    }));
  });

  it('[should-fix] a controller another writer left beside a battery it does not fit is called out, and not counted', () => {
    // The ecosystem picker moved the battery to an IQ Battery 5P and left Gateway 3 behind.
    mount(null, { selection: { batteryId: IQ5P, batteryKwh: 5, backupControllerId: GW3 } });
    expect(screen.getByTestId('bat-controller-unlisted').textContent).toMatch(/does not list Tesla Backup Gateway 3 with Enphase IQ Battery 5P/);
    expect(screen.getByTestId('bat-controller-qty').textContent).toBe('—');
    expect(options('bat-controller')).not.toContain(GW3);
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
    expect(screen.queryByTestId('bat-mixed')).toBeNull();
    expect(screen.queryByTestId('bat-awaiting')).toBeNull();
  });

  it('per-system editing is hidden until [Configure systems differently], then writes THAT system', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology, { mode: 'guided' });
    expect(screen.queryByTestId('bat-system-qty-domain-a')).toBeNull();
    expect(screen.queryByTestId('bat-system-landing-domain-a')).toBeNull();
    fireEvent.click(screen.getByTestId('bat-configure-differently'));
    fireEvent.change(screen.getByTestId('bat-system-qty-domain-a'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-a'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(countsOf(onWrite.mock.calls[0][0])).toEqual([3, 2]);
  });

  it('[should-fix] per system: controller, batteries and expansions — never a per-system battery model', () => {
    mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    for (const d of ['domain-a', 'domain-b']) {
      const row = screen.getByTestId(`bat-system-edit-${d}`);
      expect(within(row).getByTestId(`bat-system-controller-${d}`)).toBeTruthy();
      expect(within(row).getByTestId(`bat-system-qty-${d}`)).toBeTruthy();
      expect(within(row).getByTestId(`bat-system-expansions-${d}`)).toBeTruthy();
      // The only selects in a system's row are its controller and where its AC circuits land.
      const selects = Array.from(row.querySelectorAll('select')).map(s => s.getAttribute('data-testid'));
      expect(selects).toEqual([`bat-system-controller-${d}`, `bat-system-landing-${d}`]);
      expect(within(row).queryByTestId(`answer-system-equipment-ess-${d}`)).toBeNull();
    }
  });

  it('a system\'s own controller writes that system only', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    expect(options('bat-system-controller-domain-b').sort()).toEqual([GW2, GW3]);
    fireEvent.change(screen.getByTestId('bat-system-controller-domain-b'), { target: { value: GW2 } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-b'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    expect(next.domains.map(d => d.gateway.productId)).toEqual([GW3, GW2]);
    expect(countsOf(next)).toEqual([2, 2]);
  });

  it('Manual mode shows each system\'s detail inline, with no toggle', () => {
    mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    expect(screen.queryByTestId('bat-configure-differently')).toBeNull();
    expect(screen.getByTestId('bat-grouping').getAttribute('data-expanded')).toBe('true');
    for (const d of ['domain-a', 'domain-b']) {
      expect(screen.getByTestId(`bat-system-controller-${d}`)).toBeTruthy();
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

describe('[should-fix] the card never leaves the two stores disagreeing silently', () => {
  it('(a) zeroing the LAST system holding batteries is refused — the graph cannot hold "no battery" as a count', async () => {
    const half = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-a', { storageUnits: 0 }));
    const { onWrite } = mount(half, { mode: 'manual' });
    fireEvent.change(screen.getByTestId('bat-system-qty-domain-b'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-b'));
    await waitFor(() => expect(screen.getByTestId('bat-refusal').textContent).toBe(EMPTIES_EVERY_SYSTEM));
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('(a) control: zeroing one system while another still holds batteries is written', async () => {
    const { onWrite } = mount(buildRaysIntendedJob().topology, { mode: 'manual' });
    fireEvent.change(screen.getByTestId('bat-system-qty-domain-a'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-a'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    expect(countsOf(onWrite.mock.calls[0][0])).toEqual([0, 2]);
  });

  it('(b) systems holding different batteries are flagged against the one-battery selection', () => {
    const mixed = ok(answerSystemEquipment(buildRaysIntendedJob().topology, 'domain-b', { gatewayProductId: SC3, storageProductId: IQ5P }));
    mount(mixed);
    const flag = screen.getByTestId('bat-mixed').textContent ?? '';
    expect(flag).toMatch(/2 × Tesla Powerwall 3, 2 × Enphase IQ Battery 5P/);
    expect(flag).toMatch(/4 batteries · Tesla Powerwall 3/);
    expect((screen.getByTestId('bat-model') as HTMLSelectElement).value, 'asked once for every system').toBe('');
  });

  it('(c) the storage total counts the expansion packs (54.0, not the selection\'s 2 × 13.5)', () => {
    mount(buildTesla400ATwoGateway({ powerwallsPerSystem: 1, expansionsPerSystem: 1 }).topology,
      { selection: { batteryCount: 2, batteryKwh: 13.5 } });
    expect(screen.getByTestId('bat-total-kwh').textContent).toBe('54.0');
  });

  it('no system holds a battery yet: said, the model is the selection\'s, and a system\'s count records that battery', async () => {
    let empty = buildRaysIntendedJob().topology;
    empty = ok(answerSystemEquipment(empty, 'domain-a', { storageUnits: 0 }));
    empty = ok(answerSystemEquipment(empty, 'domain-b', { storageUnits: 0 }));
    const { onWrite, onSelectionChange } = mount(empty, { mode: 'manual' });
    expect(screen.getByTestId('bat-awaiting').textContent).toMatch(/No system holds a battery yet — the selection is 4 × Tesla Powerwall 3/);
    fireEvent.change(screen.getByTestId('bat-system-qty-domain-a'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('bat-system-record-domain-a'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    expect(countsOf(next)).toEqual([2, 0]);
    expect(systemEquipmentFacts(next, next.domains[0]).storageProductId).toBe(PW3);
    // The model for every system, while none holds one, is the selection's — no graph write.
    fireEvent.change(screen.getByTestId('bat-model'), { target: { value: IQ5P } });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({ batteryId: IQ5P }));
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});

describe('[should-fix] a write the page could not save is said in the card', () => {
  it('the PUT failed: the page\'s error is shown here, and what the installer typed is kept', async () => {
    const single = buildTesla400ATwoGateway({ collapseToSingleGateway: true, powerwallsPerSystem: 2, expansionsPerSystem: 0 }).topology;
    const { onWrite } = mount(single, { writes: false, error: 'Could not update the service: 500' });
    expect(screen.queryByTestId('bat-error')).toBeNull();
    fireEvent.change(screen.getByTestId('bat-qty'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(screen.getByTestId('bat-error').textContent).toBe('Could not update the service: 500'));
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId('bat-qty') as HTMLInputElement).value).toBe('3');
  });
});

describe('Battery Storage OFF while the service record still holds batteries', () => {
  it('says how many, and where they are removed; nothing when the record holds none', () => {
    render(<BatteryOffNote topology={buildRaysIntendedJob().topology} />);
    expect(screen.getByTestId('bat-off-graph-note').textContent).toMatch(/still holds 4 batteries in 2 backup systems/);
    cleanup();
    render(<BatteryOffNote topology={null} />);
    expect(screen.queryByTestId('bat-off-graph-note')).toBeNull();
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

  it('[should-fix] (a) Quantity 0 + Record on the only system is refused, not written', async () => {
    const { onWrite } = mount(single());
    fireEvent.change(screen.getByTestId('bat-qty'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('bat-record'));
    await waitFor(() => expect(screen.getByTestId('bat-refusal').textContent).toBe(EMPTIES_EVERY_SYSTEM));
    expect(onWrite).not.toHaveBeenCalled();
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
