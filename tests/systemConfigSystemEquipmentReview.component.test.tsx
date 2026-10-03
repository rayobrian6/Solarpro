/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// The per-system equipment editors, after review:
//   · a controller or battery that does not fit is shown by its NAME, and "not evaluated" where the
//     catalogue carries no fact — never a raw catalogue key;
//   · a failed save keeps what the installer typed (the draft is cleared only when the PUT succeeded).
//
// REWRITTEN FOR V3, NOT DELETED (2026-10-03): rendered through `ItemEditor` — the one editor switch
// the cards and dialogs share — instead of the removed five-card SystemConfigInterview.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { buildSystemConfigInterview } from '@/lib/electrical/systemConfigInterview';
import { answerServiceRating, type AnswerResult } from '@/lib/electrical/systemConfigAnswers';
import { addBackupDomain } from '@/lib/electrical/topologyAuthoring';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import { allInterviewItems } from '@/lib/electrical/systemConfigPlacement';
import { ItemEditor, applyVia } from '@/components/engineering/systemConfig/ItemEditor';
import type { ServiceTopology } from '@/lib/electrical/serviceTopology';

afterEach(cleanup);

const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-std440' });
const ok = (r: AnswerResult) => { if (r.ok === false) throw new Error(r.refused); return r.topology; };

function mount(t: ServiceTopology, onWriteResult = true) {
  const onWrite = vi.fn(async (_next: ServiceTopology, _what: string) => onWriteResult);
  const interview = buildSystemConfigInterview({
    pvArray, topology: t, coupling: null, couplingIsDecision: false, architectureConflict: false,
    equipment: {
      pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' },
      storage: { label: 'Battery', count: 2, pvInput: false, backupCapable: true, requiresGateway: true },
      gateway: { label: 'Gateway', count: 1 },
    },
    evaluation: null,
  });
  const items = allInterviewItems(interview).filter(i => i.id.startsWith('equipment.system.'));
  render(
    <div>
      {items.map(item => (
        <ItemEditor key={item.id} item={item} topology={t} pvArray={pvArray} derivedStrings={[]} busy={false}
                    equipment={{ gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 2 }}
                    apply={applyVia(onWrite)} />
      ))}
    </div>,
  );
  return onWrite;
}
const oneSystem = (gw: string, ess: string) => {
  const base = ok(answerServiceRating(null, 200));
  return addBackupDomain(base, {
    branchId: base.branches[0].id, panelIds: [base.panels[0].id], gatewayProductId: gw, storageProductIds: [ess, ess],
  }).topology;
};
const disabledTexts = (testid: string) =>
  Array.from((screen.getByTestId(testid) as HTMLSelectElement).options).filter(o => o.disabled).map(o => o.textContent);

describe('[nit] what does not fit is shown by name, in the right words', () => {
  it('a controller the catalogue does not list for the battery: its name, "not listed as fitting"', () => {
    mount(oneSystem('enphase-iq-system-controller-3', 'tesla-powerwall-3'));
    expect(disabledTexts('answer-system-equipment-gateway-domain-1'))
      .toEqual(['Enphase IQ System Controller 3 — not listed as fitting']);
  });

  it('a battery with no compatibility fact: the controller and the battery by name, "not evaluated"', () => {
    mount(oneSystem('tesla-backup-gateway-3', 'franklin-apower-15'));
    const gw = disabledTexts('answer-system-equipment-gateway-domain-1');
    expect(gw).toEqual(['Tesla Backup Gateway 3 — compatibility not evaluated']);
    const ess = disabledTexts('answer-system-equipment-ess-domain-1');
    expect(ess).toHaveLength(1);
    expect(ess[0]).toMatch(/^FranklinWH .* — compatibility not evaluated$/);
    expect([...gw, ...ess].join(' ')).not.toMatch(/tesla-backup-gateway-3|franklin-apower-15/);
  });
});

describe('[nit] a failed save keeps what the installer typed', () => {
  it('the PUT fails ⇒ the 3 typed is still there; the PUT succeeds ⇒ the form follows the graph again', async () => {
    const t = buildRaysIntendedJob().topology;
    const failing = mount(t, false);
    const count = () => (screen.getByTestId('answer-system-equipment-ess-count-domain-a') as HTMLInputElement).value;
    fireEvent.change(screen.getByTestId('answer-system-equipment-ess-count-domain-a'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('answer-system-equipment-save-domain-a'));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(count(), 'the failed write threw away the installer\'s answer').toBe('3');
    expect((screen.getByTestId('answer-system-equipment-save-domain-a') as HTMLButtonElement).disabled).toBe(false);
    cleanup();

    const succeeding = mount(t, true);
    fireEvent.change(screen.getByTestId('answer-system-equipment-ess-count-domain-a'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('answer-system-equipment-save-domain-a'));
    await waitFor(() => expect(succeeding).toHaveBeenCalledTimes(1));
    // The page re-renders with the written graph; until then the cleared draft shows the recorded 2.
    await waitFor(() => expect(count()).toBe('2'));
  });

  it('the shared editor switch does not import the writers the per-system editor replaced', () => {
    const src = readFileSync(resolve(process.cwd(), 'components/engineering/systemConfig/ItemEditor.tsx'), 'utf8');
    const end = src.indexOf("from '@/lib/electrical/systemConfigAnswers'");
    expect(end, 'ItemEditor no longer imports the answer writers at all').toBeGreaterThan(0);
    const imports = src.slice(src.lastIndexOf('import {', end), end);
    // the slice really is that import (the service writers moved to cards/ServiceControls.tsx)
    expect(imports).toMatch(/\banswerInterconnection\b/);
    expect(imports).not.toMatch(/\banswerBackup\b/);
    expect(imports).not.toMatch(/\banswerSystemBatteries\b/);
  });
});
