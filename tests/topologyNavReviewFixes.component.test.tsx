/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 CLOSURE SLICE 1 — REVIEW FIXES, CLICKED.
//
//   · The Advanced service model editor sits in Review Engineering BESIDE System Config editors that
//     write the same graph. It edits the PAGE's graph (no private copy), and a Save over a graph that
//     moved since its edit began is refused — the SCCR answered a moment earlier is never reverted.
//   · A read that FAILED is not an empty project: no create flow, no Save over the stored service.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useRef, useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import { buildSystemConfigInterview, type InterviewEquipment } from '@/lib/electrical/systemConfigInterview';
import {
  answerAvailableFaultCurrent, answerDistribution, answerServiceRating, type AnswerResult,
} from '@/lib/electrical/systemConfigAnswers';
import { resolvePvArrayDesign } from '@/lib/electrical/pvArrayDesign';
import { evaluateServiceTopology, type ServiceTopology } from '@/lib/electrical/serviceTopology';
import { applyVia, guardGraphRead, type GraphRead, type ItemEditorContext } from '@/components/engineering/systemConfig/ItemEditor';
import { EngineeringReadinessPanel } from '@/components/engineering/systemConfig/EngineeringReadinessPanel';
import { ServiceTopologyBuilder } from '@/components/engineering/ServiceTopologyBuilder';

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';
const ok = (r: AnswerResult): ServiceTopology => { if (r.ok === false) throw new Error(r.refused); return r.topology; };
const pvArray = resolvePvArrayDesign({ placedModuleCount: 20, selectedPanelId: 'panel-fence-ps1' });
const MICROS: InterviewEquipment = { pvInverter: { state: 'SELECTED', label: 'Enphase IQ8M', kind: 'micro' }, storage: null, gateway: null };

interface Store { t: ServiceTopology | null; puts: ServiceTopology[] }

/**
 * The Engineering page's loop, reduced: ONE graph in state, read from the store; every write goes
 * through `guardGraphRead(write)` — PUT, mark the graph 'loading', re-read it — exactly as
 * `writeInterviewAnswer` does. The builder is mounted as the page mounts it (`host`).
 */
function Page({ store, initialRead = 'loaded' }: { store: Store; initialRead?: GraphRead }) {
  const [graph, setGraph] = useState<ServiceTopology | null>(store.t);
  const [read, setRead] = useState<GraphRead>(initialRead);
  const readRef = useRef(read);
  readRef.current = read;
  const write = guardGraphRead(async (next: ServiceTopology) => {
    store.t = next; store.puts.push(next);
    readRef.current = 'loading'; setRead('loading');
    // The re-read lands on a later tick, as the page's fetch does.
    setTimeout(() => { setGraph(store.t); setRead('loaded'); }, 0);
    return true;
  }, () => readRef.current);
  const ctx: ItemEditorContext = {
    topology: graph, pvArray, derivedStrings: [], busy: read !== 'loaded' && read !== 'absent', apply: applyVia(write),
    equipment: { gatewayProductId: null, storageProductId: null, storageLabel: null, totalUnits: 0 }, graphRead: read,
  };
  const iv = buildSystemConfigInterview({ pvArray, topology: graph, coupling: null, couplingIsDecision: false,
    architectureConflict: false, equipment: MICROS, evaluation: graph ? evaluateServiceTopology(graph) : null });
  return (
    <EngineeringReadinessPanel {...ctx} interview={iv}
      advancedEditor={<ServiceTopologyBuilder projectId={PROJECT}
                                              host={{ topology: graph, read, save: next => write(next, 'the service model (Advanced editor)') }} />} />
  );
}

function openAdvanced() {
  fireEvent.click(screen.getByTestId('readiness-review'));
  const box = screen.getByTestId('review-advanced-editor') as HTMLDetailsElement;
  box.open = true; fireEvent(box, new Event('toggle'));
}

describe('🚨 the Advanced editor never writes a stale copy over an answer given beside it', () => {
  it('an SCCR answered in Review Engineering, then a builder edit begun BEFORE it: Save is refused, the SCCR stays', async () => {
    const store: Store = { t: ok(answerAvailableFaultCurrent(ok(answerServiceRating(null, 200)), 10_000)), puts: [] };
    render(<Page store={store} />);
    openAdvanced();
    await waitFor(() => expect(screen.getByTestId('topology-edit')).toBeTruthy());

    // 1. The builder edit begins on the graph as it stands.
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('node-msp-1'));
    fireEvent.change(within(screen.getByTestId('node-inspector')).getByTestId('inspector-panel-bus'), { target: { value: '225' } });

    // 2. The installer answers the panel SCCR in the needs list above it (the one write path).
    const sccr = within(screen.getByTestId('review-needs')).getByTestId('answer-panel-sccr-msp-1');
    fireEvent.change(sccr, { target: { value: '22' } });
    fireEvent.blur(sccr);
    await waitFor(() => expect(store.t!.panels[0].sccrA).toBe(22_000));
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });

    // 3. Save the builder's edit — begun on the graph BEFORE the SCCR: refused, nothing written.
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/changed since this edit began/));
    expect(store.puts).toHaveLength(1);
    expect(store.t!.panels[0].sccrA).toBe(22_000);
    expect(store.t!.panels[0].busbarRatingA).not.toBe(225);

    // 4. Discard takes up the current record — the SCCR is in it — and the same edit then saves.
    fireEvent.click(screen.getByTestId('topology-discard'));
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('node-msp-1'));
    fireEvent.change(within(screen.getByTestId('node-inspector')).getByTestId('inspector-panel-bus'), { target: { value: '225' } });
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(store.puts).toHaveLength(2));
    expect(store.t!.panels[0].busbarRatingA).toBe(225);
    expect(store.t!.panels[0].sccrA, 'the Advanced editor wrote back a copy without the SCCR').toBe(22_000);
  });

  it('an answer given in view mode is followed: the builder shows the page\'s re-read graph, and its next save keeps it', async () => {
    const store: Store = { t: ok(answerAvailableFaultCurrent(ok(answerServiceRating(null, 200)), 10_000)), puts: [] };
    render(<Page store={store} />);
    openAdvanced();
    await waitFor(() => expect(screen.getByTestId('topology-edit')).toBeTruthy());
    const sccr = within(screen.getByTestId('review-needs')).getByTestId('answer-panel-sccr-msp-1');
    fireEvent.change(sccr, { target: { value: '22' } });
    fireEvent.blur(sccr);
    await waitFor(() => expect(store.t!.panels[0].sccrA).toBe(22_000));
    await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('node-msp-1'));
    fireEvent.change(within(screen.getByTestId('node-inspector')).getByTestId('inspector-panel-bus'), { target: { value: '225' } });
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(store.puts).toHaveLength(2));
    expect(store.t!.panels[0].busbarRatingA).toBe(225);
    expect(store.t!.panels[0].sccrA).toBe(22_000);
  });
});

describe('🚨 a failed read is not an empty project — nothing is created or saved over it', () => {
  it('hosted: the page\'s read FAILED ⇒ no create flow, no wizard, nothing written', async () => {
    const t0 = ok(answerAvailableFaultCurrent(ok(answerDistribution(ok(answerServiceRating(null, 400)), 'two-main-panels')), 10_000));
    const store: Store = { t: t0, puts: [] };
    render(<ServiceTopologyBuilder projectId={PROJECT}
                                   host={{ topology: null, read: 'failed', save: async n => { store.puts.push(n); return true; } }} />);
    expect(screen.getByTestId('topology-unread').textContent).toMatch(/could not be read/);
    expect(screen.queryByTestId('service-topology-wizard')).toBeNull();
    expect(screen.queryByTestId('create-service')).toBeNull();
    expect(store.puts).toHaveLength(0);
  });

  it('standalone: its OWN GET fails (500) ⇒ no create flow; the stored 400 A / two-panel service is never replaced', async () => {
    const puts: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'GET') { puts.push(String(init?.body)); return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) };
    }) as unknown as typeof fetch;
    render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId('topology-unread')).toBeTruthy());
    expect(screen.queryByTestId('create-service')).toBeNull();
    expect(screen.queryByTestId('service-topology-wizard')).toBeNull();
    expect(screen.getByTestId('topology-message').textContent).toMatch(/could not be read/);
    expect(puts).toEqual([]);
  });

  it('standalone: a project with genuinely nothing recorded still gets the create flow', async () => {
    const fetchImpl = (async () => ({ json: async () => ({ success: true, available: false, topology: null }) })) as unknown as typeof fetch;
    render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId('service-topology-wizard')).toBeTruthy());
    expect(screen.queryByTestId('topology-unread')).toBeNull();
  });
});
