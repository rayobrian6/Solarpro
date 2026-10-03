/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The per-system equipment editors, clicked: they offer only what the catalogue says fits, and write
// through the answer functions to `apply` — the page's one write path.
//
// REWRITTEN FOR V3, NOT DELETED (2026-10-03). These used to render inside the five-card interview's
// Equipment section. They now render through `ItemEditor` — the one editor switch every card and
// dialog uses — and through `QuestionDialog` (the Battery card's per-system dialog / [Answer Next]).
// What they prove is unchanged: each system has its own controls, a write changes THAT system only,
// a battery with no catalogue fact reads NOT EVALUATED, and "Only the panels I choose" writes one
// system behind the panel chosen.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerDistribution, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { addBackupDomain } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { NOT_EVALUATED_MFR } from '@/lib/electrical/systemConfigSystemEquipment';
import { findInterviewItem, homeOf, allInterviewItems } from '@/lib/electrical/systemConfigPlacement';
import { ItemEditor, QuestionDialog, applyVia } from '@/components/engineering/systemConfig/ItemEditor';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult) => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function interviewOf(t: ServiceTopology, storageLabel = 'Tesla Powerwall 3') {
  return buildSystemConfigInterview({
    pvArray, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
      storage: { label: storageLabel, count: 4, pvInput: false, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Gateway', count: 1 },
    },
    evaluation: null,
  });
}

/** Every item the Battery card / System Configuration card asks, through the one editor switch. */
function mount(t: ServiceTopology, storageLabel = 'Tesla Powerwall 3', storageProductId = 'tesla-powerwall-3') {
  const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => true);
  const iv = interviewOf(t, storageLabel);
  const items = allInterviewItems(iv).filter(i => i.id.startsWith('equipment.system.') || i.id === 'behavior.backup');
  render(
    <div>
      {items.map(item => (
        <div key={item.id} data-testid={`card-item-${item.id}`} data-home={homeOf(item.id)}>
          <ItemEditor item={item} topology={t} pvArray={pvArray} derivedStrings={[]} busy={false}
                      equipment={{ gatewayProductId: 'tesla-backup-gateway-3', storageProductId, storageLabel, totalUnits: 4 }}
                      apply={applyVia(onWrite)} />
        </div>
      ))}
    </div>,
  );
  return onWrite;
}
const optionValues = (testid: string) =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).filter(o => !o.disabled).map(o => o.value);

describe('each system\'s equipment is asked in the Battery card, through the one editor', () => {
  it('each of Ray\'s systems has its controller, battery and expansion controls, at home in Battery Storage', () => {
    mount(buildRaysIntendedJob().topology);
    for (const d of ['domain-a', 'domain-b']) {
      const card = screen.getByTestId(`card-item-equipment.system.equip.${d}`);
      expect(card.getAttribute('data-home')).toBe('battery');
      expect(within(card).getByTestId(`answer-system-equipment-gateway-${d}`)).toBeTruthy();
      expect(within(card).getByTestId(`answer-system-equipment-expansion-${d}`)).toBeTruthy();
    }
    expect(optionValues('answer-system-equipment-gateway-domain-a').sort())
      .toEqual(['tesla-backup-gateway-2', 'tesla-backup-gateway-3']);
  });

  it('System 1 → 3 batteries → Record writes THAT system through apply, System 2 untouched', async () => {
    const t = buildRaysIntendedJob().topology;
    const onWrite = mount(t);
    fireEvent.change(screen.getByTestId('answer-system-equipment-ess-count-domain-a'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('answer-system-equipment-save-domain-a'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    const count = (id: string) => next.domains.find(d => d.id === id)!.storageUnitIds
      .filter(u => next.storage.find(s => s.id === u)?.role === 'inverter-unit').length;
    expect([count('domain-a'), count('domain-b')]).toEqual([3, 2]);
  });

  it('the same per-system editor in a dialog: Record writes that system and the dialog closes', async () => {
    const t = buildRaysIntendedJob().topology;
    const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => true);
    const onClose = vi.fn();
    render(<QuestionDialog item={findInterviewItem(interviewOf(t), 'equipment.system.equip.domain-b')} topology={t}
                           pvArray={pvArray} derivedStrings={[]} busy={false} apply={applyVia(onWrite)} onClose={onClose}
                           equipment={{ gatewayProductId: 'tesla-backup-gateway-3', storageProductId: 'tesla-powerwall-3', storageLabel: 'Tesla Powerwall 3', totalUnits: 4 }} />);
    const dialog = screen.getByTestId('question-dialog');
    fireEvent.change(within(dialog).getByTestId('answer-system-equipment-ess-count-domain-b'), { target: { value: '1' } });
    fireEvent.click(within(dialog).getByTestId('answer-system-equipment-save-domain-b'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    const count = (id: string) => next.domains.find(d => d.id === id)!.storageUnitIds
      .filter(u => next.storage.find(s => s.id === u)?.role === 'inverter-unit').length;
    expect([count('domain-a'), count('domain-b')]).toEqual([2, 1]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a battery the catalogue carries no controller fact for says NOT EVALUATED and offers no controller', () => {
    const base = ok(answerServiceRating(null, 200));
    const t = addBackupDomain(base, {
      branchId: base.branches[0].id, panelIds: [base.panels[0].id], gatewayProductId: 'tesla-backup-gateway-3',
      storageProductIds: ['franklin-apower-15'],
    }).topology;
    mount(t, 'FranklinWH aPower 2', 'franklin-apower-15');
    expect(screen.getByTestId('answer-system-equipment-gateway-note-domain-1').textContent).toContain(NOT_EVALUATED_MFR);
    expect(optionValues('answer-system-equipment-gateway-domain-1')).toEqual([]);
  });
});

describe('"What is backed up?" on two panels (System Configuration card)', () => {
  it('Only the panels I choose → MSP #2 with 2 batteries → Record writes one system behind MSP #2', async () => {
    const two = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    const onWrite = mount(two);
    expect(screen.getByTestId('card-item-behavior.backup').getAttribute('data-home')).toBe('systemConfig');
    fireEvent.click(within(screen.getByTestId('answer-system-equipment-backup-panels')).getByRole('radio'));
    fireEvent.click(screen.getByTestId('answer-system-equipment-backup-panel-msp-2'));
    fireEvent.change(screen.getByTestId('answer-system-equipment-backup-units-msp-2'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('answer-system-equipment-backup-save'));
    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1));
    const next = onWrite.mock.calls[0][0];
    expect(next.domains.map(d => d.backedUpPanelIds)).toEqual([['msp-2']]);
    expect(next.storage).toHaveLength(2);
    expect(next.panels.map(p => p.backedUp)).toEqual([false, true]);
  });
});
