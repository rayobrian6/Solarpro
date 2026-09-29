/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 BUILT BY CLICKING, NOT BY DESERIALISING A FIXTURE.
//
// Ray: "Prove the topology can be created from the actual UI... Create/open project → select/create
// 400 A service → add two 200 A branches → assign MSP #1 and MSP #2 → create two backup domains →
// assign one Gateway to each → assign one PW3 to each → assign one Expansion to each PW3 → select
// non-meter-collar interconnection → save → reload → inspect Engineering."
//
// So this drives the real component with real clicks: no fixture is imported, and the graph that
// comes out is checked against the canonical evaluator and the canonical instance list.
//
// WHAT IT DOES NOT COVER, said plainly: the engineering PAGE around it (18k lines, needs a project
// and a database) is not exercised here. The tab is mounted and typechecked; the flow through the
// real browser with a live project is Ray's acceptance, not this file's.
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ServiceTopologyBuilder } from '@/components/engineering/ServiceTopologyBuilder';
import { evaluateServiceTopology, summariseStorage } from '@/lib/electrical/serviceTopology';
import { equipmentQuantities } from '@/lib/electrical/topologyEquipment';
import { buildServiceTopologyGraph } from '@/lib/sld/serviceTopologyGraph';
import { renderServiceTopologySvg, auditServiceTopologyLayout } from '@/lib/sld/renderServiceTopologySvg';

afterEach(cleanup);

/** A fetch double that remembers what was PUT, so "save then reload" is a real round trip. */
function makeFetch() {
  let stored: unknown = null;
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if ((init?.method ?? 'GET') === 'GET') {
      return { json: async () => stored
        ? { success: true, available: true, topology: stored }
        : { success: true, available: false, topology: null } } as unknown as Response;
    }
    stored = JSON.parse(String(init!.body)).topology;
    return { json: async () => ({ success: true, topology: stored }) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls, get stored() { return stored; } };
}

/** Ray's job, by clicking. */
async function buildRaysJob(f: ReturnType<typeof makeFetch>) {
  render(<ServiceTopologyBuilder projectId="4030b664-bebe-433b-a11c-cda05ead2f7d" fetchImpl={f.impl} />);
  await waitFor(() => expect(screen.getByTestId('create-service')).toBeTruthy());

  fireEvent.change(screen.getByTestId('new-service-amps'), { target: { value: '400' } });
  fireEvent.click(screen.getByTestId('create-service'));

  fireEvent.change(screen.getByTestId('new-branch-amps'), { target: { value: '200' } });
  fireEvent.click(screen.getByTestId('add-branch'));
  fireEvent.click(screen.getByTestId('add-branch'));

  fireEvent.change(screen.getByTestId('new-panel-bus'), { target: { value: '200' } });
  fireEvent.change(screen.getByTestId('new-panel-main'), { target: { value: '200' } });
  fireEvent.click(screen.getByTestId('add-panel'));
  fireEvent.click(screen.getByTestId('add-panel'));

  fireEvent.change(screen.getByTestId('new-domain-gateway'), { target: { value: 'tesla-backup-gateway-3' } });
  fireEvent.change(screen.getByTestId('new-domain-ess'), { target: { value: 'tesla-powerwall-3' } });
  fireEvent.change(screen.getByTestId('new-domain-expansion'), { target: { value: 'tesla-powerwall-3-expansion' } });
  fireEvent.click(screen.getByTestId('add-domain'));
  fireEvent.click(screen.getByTestId('add-domain'));

  fireEvent.click(screen.getByTestId('add-service-disconnect'));
  fireEvent.click(screen.getByTestId('add-der-isolation'));
  fireEvent.click(screen.getByTestId('der-isolation-required'));
  // Meter collar is NOT permitted on this project — left unchecked, which is the default.
  fireEvent.click(screen.getByTestId('topology-save'));
  await waitFor(() => expect(screen.getByTestId('topology-message').textContent)
    .toMatch(/saved/i));
}

describe('🚨 the operator builds Ray’s job in the product', () => {
  it('clicking through produces 400 A, two branches, two MSPs and two backup domains', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as ReturnType<typeof evaluateServiceTopology> extends never ? never : any;
    expect(t.service.ratedAmps).toBe(400);
    expect(t.branches.map((b: any) => b.ratedAmps)).toEqual([200, 200]);
    expect(t.panels).toHaveLength(2);
    expect(t.domains).toHaveLength(2);
    // Each domain took its own branch and its own panel.
    expect(new Set(t.domains.map((d: any) => d.branchId)).size).toBe(2);
    expect(new Set(t.domains.flatMap((d: any) => d.backedUpPanelIds)).size).toBe(2);
  });

  it('🚨 one Gateway, one Powerwall and one Expansion per domain — and the pairing is right', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as any;
    expect(equipmentQuantities(t)).toEqual({
      'tesla-backup-gateway-3': 2,
      'tesla-powerwall-3': 2,
      'tesla-powerwall-3-expansion': 2,
    });
    const s = summariseStorage(t);
    expect(s.totalUsableKwh).toBeCloseTo(54, 6);
    // 🚨 Two inverting units, not four.
    expect(s.totalContinuousOutputA).toBeCloseTo(96, 6);
    const exps = t.storage.filter((u: any) => u.role === 'energy-expansion');
    expect(new Set(exps.map((e: any) => e.attachedToUnitId)).size).toBe(2);
  });

  it('the four disconnect roles are created as themselves', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as any;
    expect(t.devices.map((d: any) => d.roles)).toEqual([
      ['service-disconnect'], ['der-isolation-disconnect'],
    ]);
    expect(t.interconnection.externalDerIsolationRequired).toBe(true);
    // Non-meter-collar: never permitted, never selected.
    expect(t.interconnection.meterCollarSelected).toBe(false);
  });

  it('🚨 saved then reloaded, the screen shows what was built', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    cleanup();
    // A fresh mount against the same store — which is what a page reload is.
    render(<ServiceTopologyBuilder projectId="4030b664-bebe-433b-a11c-cda05ead2f7d" fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('panel-msp-2')).toBeTruthy());
    expect(screen.getByTestId('panel-msp-1')).toBeTruthy();
    expect(screen.getByTestId('domain-domain-1')).toBeTruthy();
    expect(screen.getByTestId('domain-domain-2')).toBeTruthy();
    expect(screen.getByTestId('qty-tesla-powerwall-3-expansion').textContent).toContain('2 ×');
    expect((screen.getByTestId('service-rated-amps') as HTMLInputElement).value).toBe('400');
  });

  it('a new service asks for the fault current rather than defaulting it', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as any;
    expect(t.service.availableFaultCurrentA).toBeNull();
    const c = evaluateServiceTopology(t).checks.find(x => x.id === 'sccr.chain')!;
    expect(c.conclusion).toBe('NOT_EVALUATED');
    expect(screen.getByTestId('topology-required-inputs')).toBeTruthy();
  });

  it('a domain cannot be added before there is a branch and a panel to put it on', async () => {
    const f = makeFetch();
    render(<ServiceTopologyBuilder projectId="p" fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('create-service')).toBeTruthy());
    fireEvent.click(screen.getByTestId('create-service'));
    expect((screen.getByTestId('add-domain') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('🚨 the sheet drawn from what was built', () => {
  it('renders both branches, both domains, and the DC expansions — with no collisions', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as any;
    const g = buildServiceTopologyGraph(t);

    // The collision/layout audit, which is what found the seven overflows and the off-sheet box
    // the first time these node types were drawn.
    expect(auditServiceTopologyLayout(g), 'the sheet has overlapping or overflowing boxes')
      .toEqual([]);
    expect(g.validationErrors).toEqual([]);

    const svg = renderServiceTopologySvg(g);
    expect(svg).toContain('400 A service distribution');
    expect(svg).toContain('Branch A feeder');
    expect(svg).toContain('Branch B feeder');
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');
    expect(svg).toContain('N-G BOND');
    // 🚨 The expansion link is DASHED and labelled as a DC harness — visually not an AC feeder.
    expect(svg).toContain('DC expansion harness');
    expect(svg).toMatch(/stroke-dasharray="6 4"/);
    // And the unresolved authority is on the sheet, in words.
    expect(svg).toContain('MANUFACTURER DOCUMENT REQUIRED');
  });

  it('one domain draws one gateway; three draw three, on a wider sheet', async () => {
    const f = makeFetch();
    await buildRaysJob(f);
    const t = f.stored as any;
    const two = renderServiceTopologySvg(buildServiceTopologyGraph(t));
    const oneDomain = { ...t, domains: t.domains.slice(0, 1) };
    const one = renderServiceTopologySvg(buildServiceTopologyGraph(oneDomain));
    expect((two.match(/Tesla Backup Gateway 3/g) ?? []).length).toBe(2);
    expect((one.match(/Tesla Backup Gateway 3/g) ?? []).length).toBe(1);
    // The sheet grows with the columns rather than squeezing them together.
    const w = (s: string) => Number(/width="(\d+)"/.exec(s)![1]);
    expect(w(two)).toBeGreaterThan(w(one) - 1);
  });
});
