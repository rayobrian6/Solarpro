/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The System Config card, clicked: the per-system equipment editors render in the Equipment section
// (beside the page's equipment slot, which used to replace every editor there), offer only what the
// catalogue says fits, and write through the answer functions to `onWrite` — the page's PUT.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { SystemConfigInterview } from '@/components/engineering/systemConfig/SystemConfigInterview';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, answerDistribution, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { addBackupDomain } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { NOT_EVALUATED_MFR } from '@/lib/electrical/systemConfigSystemEquipment';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult) => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function mount(t: ServiceTopology, storageLabel = 'Tesla Powerwall 3', storageProductId = 'tesla-powerwall-3') {
  const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => true);
  const interview = buildSystemConfigInterview({
    pvArray, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
      storage: { label: storageLabel, count: 4, pvInput: false, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Gateway', count: 1 },
    },
    evaluation: null,
  });
  render(
    <SystemConfigInterview
      interview={interview} topology={t} pvArray={pvArray} derivedStrings={[]}
      equipment={{ gatewayProductId: 'tesla-backup-gateway-3', storageProductId, storageLabel, totalUnits: 4 }}
      mode="manual" busy={false} error={null} onWrite={onWrite} onRecordCoupling={async () => true}
      equipmentSlot={<a data-testid="interview-goto-equipment" href="#x">Choose or change equipment</a>}
    />,
  );
  return onWrite;
}
const optionValues = (testid: string) =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).filter(o => !o.disabled).map(o => o.value);

describe('the Equipment section renders its editors beside the equipment slot', () => {
  it('each of Ray\'s systems has its controller, battery and expansion controls — and the slot is still there', () => {
    mount(buildRaysIntendedJob().topology);
    const eq = screen.getByTestId('interview-section-equipment');
    expect(within(eq).getByTestId('interview-goto-equipment')).toBeTruthy();
    for (const d of ['domain-a', 'domain-b']) {
      expect(within(eq).getByTestId(`answer-system-equipment-gateway-${d}`)).toBeTruthy();
      expect(within(eq).getByTestId(`answer-system-equipment-expansion-${d}`)).toBeTruthy();
    }
    expect(optionValues('answer-system-equipment-gateway-domain-a').sort())
      .toEqual(['tesla-backup-gateway-2', 'tesla-backup-gateway-3']);
  });

  it('System 1 → 3 batteries → Record writes THAT system through onWrite, System 2 untouched', async () => {
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

describe('"What is backed up?" on two panels', () => {
  it('Only the panels I choose → MSP #2 with 2 batteries → Record writes one system behind MSP #2', async () => {
    const two = ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels'));
    const onWrite = mount(two);
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
