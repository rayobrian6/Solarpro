/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 BUILT THE WAY AN ELECTRICIAN TALKS, NOT BY DESERIALISING A FIXTURE.
//
// Ray tested the first Service Topology screen in Dev and rejected its UX:
//
//   "Right now the page exposes the internal graph-building primitives directly... This is too
//    difficult to operate on a real job."
//   "Ray should think: 400 amp service, two 200 amp panels, back up both, one Gateway/Powerwall
//    stack per panel. SolarPro translates that into the graph. Ray should not have to think: create
//    branch object → create panel object → create domain object → resolve semantic role."
//   "Start with no topology. Ray should be able to create the intended system without understanding
//    graph internals."
//
// So the first block below IS that: six answers, no graph vocabulary, and the graph that comes out
// is checked against the canonical evaluator, the canonical instance list and the canonical sheet.
// The second block proves the ADVANCED primitives are still there, because Ray also said "Do not
// remove advanced editing capability. Put it behind the visual model."
//
// WHAT IT DOES NOT COVER, said plainly: the engineering PAGE around it (18k lines, needs a project
// and a database) is not exercised here. The tab is mounted and typechecked; the flow through the
// real browser with a live project is Ray's acceptance, not this file's. (Since closure slice 1 the
// builder is no longer a tab: it is the Advanced service model editor inside Review Engineering —
// tests/serviceTopologyLeftTheNavigation*.)
// ═══════════════════════════════════════════════════════════════════════════
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ServiceTopologyBuilder } from '@/components/engineering/ServiceTopologyBuilder';
import { evaluateServiceTopology, summariseStorage } from '@/lib/electrical/serviceTopology';
import { equipmentQuantities } from '@/lib/electrical/topologyEquipment';
import { buildServiceTopologyGraph } from '@/lib/sld/serviceTopologyGraph';
import { renderServiceTopologySvg, auditServiceTopologyLayout } from '@/lib/sld/renderServiceTopologySvg';

afterEach(cleanup);

const PROJECT = '4030b664-bebe-433b-a11c-cda05ead2f7d';

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

const next = () => fireEvent.click(screen.getByTestId('wizard-next'));

/**
 * Ray's job, answered in his own words:
 *   400 A service → two 200 A main panels → back up both → Gateway 3 + PW3 + 1 Expansion each
 *   → meter collar prohibited → service disconnect + utility DER isolation → save.
 */
async function buildRaysJobGuided(f: ReturnType<typeof makeFetch>) {
  render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={f.impl} />);
  await waitFor(() => expect(screen.getByTestId('service-topology-wizard')).toBeTruthy());

  // 1 — SERVICE
  fireEvent.click(screen.getByTestId('wizard-service-400'));
  next();

  // 2 — DISTRIBUTION
  fireEvent.click(within(screen.getByTestId('wizard-dist-two-main-panels')).getByRole('radio'));
  next();

  // 3 — BACKUP: both panels, which is how the preset created them.
  expect(screen.getByTestId('wizard-backup-msp-1')).toBeTruthy();
  expect(screen.getByTestId('wizard-backup-msp-2')).toBeTruthy();
  next();

  // 4 — EQUIPMENT: one stack per domain.
  for (const d of ['domain-1', 'domain-2']) {
    fireEvent.change(screen.getByTestId(`wizard-${d}-gateway`),
      { target: { value: 'tesla-backup-gateway-3' } });
    fireEvent.change(screen.getByTestId(`wizard-${d}-ess`),
      { target: { value: 'tesla-powerwall-3' } });
    fireEvent.change(screen.getByTestId(`wizard-${d}-expansion`),
      { target: { value: 'tesla-powerwall-3-expansion' } });
  }
  next();

  // 5 — INTERCONNECTION: the project prohibits a meter collar, so it becomes unavailable.
  fireEvent.change(screen.getByTestId('wizard-meter-collar-permitted'), { target: { value: 'no' } });
  expect(screen.getByTestId('wizard-meter-collar-blocked')).toBeTruthy();
  expect((within(screen.getByTestId('wizard-ic-meter-collar')).getByRole('radio') as HTMLInputElement)
    .disabled).toBe(true);
  fireEvent.click(screen.getByTestId('wizard-der-isolation-required'));
  next();

  // 6 — DISCONNECTS, by role.
  fireEvent.click(within(screen.getByTestId('wizard-role-service-disconnect')).getByRole('checkbox'));
  fireEvent.click(within(screen.getByTestId('wizard-role-der-isolation-disconnect')).getByRole('checkbox'));

  fireEvent.click(screen.getByTestId('wizard-finish'));
  await waitFor(() => expect(screen.getByTestId('topology-summary')).toBeTruthy());
  fireEvent.click(screen.getByTestId('topology-save'));
  await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));
}

describe('🚨 Ray builds his job through the guided flow', () => {
  it('six answers produce 400 A, two branches, two MSPs and two backup domains', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    const t = f.stored as any;
    expect(t.service.ratedAmps).toBe(400);
    expect(t.branches.map((b: any) => b.ratedAmps)).toEqual([200, 200]);
    expect(t.panels).toHaveLength(2);
    expect(t.domains).toHaveLength(2);
    expect(new Set(t.domains.map((d: any) => d.branchId)).size).toBe(2);
    expect(new Set(t.domains.flatMap((d: any) => d.backedUpPanelIds)).size).toBe(2);
    // 🚨 THE FEED IS RECORDED, not left for the SLD to infer from ordinal position.
    expect(t.branches.map((b: any) => b.panelIds)).toEqual([['msp-1'], ['msp-2']]);
  });

  it('🚨 one Gateway, one Powerwall and one Expansion per domain — and the pairing is right', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
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

  it('the four disconnect roles are created as themselves, and a prohibited collar stays unselected',
    async () => {
      const f = makeFetch();
      await buildRaysJobGuided(f);
      const t = f.stored as any;
      expect(t.devices.map((d: any) => d.roles)).toEqual([
        ['service-disconnect'], ['der-isolation-disconnect'],
      ]);
      expect(t.interconnection.externalDerIsolationRequired).toBe(true);
      expect(t.interconnection.meterCollarPermitted).toBe(false);
      expect(t.interconnection.meterCollarSelected).toBe(false);
    });

  it('🚨 the summary bar says what SolarPro understood, before any engineering text', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    const bar = screen.getByTestId('topology-summary').textContent ?? '';
    // 🚨 THE SYSTEM AS IT IS DESCRIBED ON SITE. This used to read "2 backup domains · 2 gateways",
    // and Ray could not find his own installation in it: a branch, a panel and a backup domain are
    // three names for one 200 A system to the person installing it.
    expect(bar).toContain('400 A service');
    expect(bar).toContain('Two 200 A systems');
    expect(bar).toContain('2 Tesla Backup Gateway 3');
    expect(bar).toContain('2 Tesla Powerwall 3');
    expect(bar).toContain('2 Expansion');
    expect(bar).toContain('54.0 kWh');
    expect(bar).toContain('96 A');
    expect(bar).toContain('1 external isolation switch');
    // The engineering counts are kept, underneath, for a plan reviewer.
    expect(screen.getByTestId('topology-engineering-counts').textContent)
      .toContain('2 service branches');
    // 🚨 NOT "8 INPUTS REQUIRED". Ray: "Do not say `8 inputs required` when several are calculations
    // or optional." Required and optional are counted apart, in two sentences.
    const count = screen.getByTestId('topology-needs-count').textContent ?? '';
    expect(count).toMatch(/\d+ required items? unresolved/);
    expect(count).toMatch(/1 optional calculation not provided/);
    expect(count).not.toMatch(/inputs? required/);
  });

  it('🚨 the visual topology shows the system without reading engineering text', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    const map = screen.getByTestId('service-topology-map');
    expect(within(map).getByTestId('node-service').textContent).toContain('400 A');
    for (const id of ['branch-1', 'branch-2', 'msp-1', 'msp-2', 'domain-1', 'domain-2']) {
      expect(within(map).getByTestId(`node-${id}`)).toBeTruthy();
    }
    const d1 = within(map).getByTestId('node-domain-1').textContent ?? '';
    expect(d1).toContain('Tesla Backup Gateway 3');
    expect(d1).toContain('Tesla Powerwall 3');
    // 🚨 "Do not show it as another inverter."
    expect(d1).toContain('DC expansion — no AC output, no breaker');
  });

  it('🚨 clicking a box edits that box — and there is no "Main Panel Amps" anywhere', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    // The service inspector opens on the node that was just built, showing its OWN rating.
    fireEvent.click(screen.getByTestId('node-service'));
    expect((screen.getByTestId('inspector-service-amps') as HTMLSelectElement).value).toBe('400');
    // One control per number: the free-text box appears only for a rating the picker cannot offer.
    expect(screen.queryByTestId('inspector-service-amps-custom')).toBeNull();
    fireEvent.change(screen.getByTestId('inspector-service-amps'), { target: { value: 'custom' } });

    fireEvent.click(screen.getByTestId('node-msp-1'));
    const inspector = screen.getByTestId('node-inspector');
    expect(inspector.textContent).toContain('MSP #1');
    fireEvent.change(within(inspector).getByTestId('inspector-panel-bus'), { target: { value: '225' } });
    expect((within(screen.getByTestId('node-inspector'))
      .getByTestId('inspector-panel-bus') as HTMLInputElement).value).toBe('225');
    expect(screen.getByTestId('service-topology-builder').textContent)
      .not.toMatch(/Main Panel Amps/i);
  });

  it('🚨 a NEEDS INPUT item takes Ray to the field that answers it', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    const needs = screen.getByTestId('topology-needs-input');
    expect(needs.textContent).toMatch(/NEEDS INPUT — \d+ required items? unresolved/);
    // And the optional one is named as optional, in its own clause.
    expect(needs.textContent).toMatch(/optional calculation not provided/);
    // The available fault current is the site's, and it lives on the service node.
    fireEvent.click(within(needs).getByTestId('need-service.availableFaultCurrentA'));
    const field = screen.getByTestId('inspector-fault-current') as HTMLInputElement;
    expect(field.placeholder).toMatch(/REQUIRED/);
    fireEvent.change(field, { target: { value: '22000' } });

    // Answering it removes THAT requirement and nothing else — and the engineering conclusion is
    // still NOT_EVALUATED, because supplying the fault current reveals the next missing thing
    // (every interrupting rating in the chain) rather than turning an unknown into a pass.
    await waitFor(() => expect(
      screen.queryByTestId('need-service.availableFaultCurrentA')).toBeNull());
    expect(screen.getByTestId('topology-needs-input').textContent).toContain('Interrupting rating');
    expect(screen.getByTestId('topology-summary').textContent).toContain('NOT EVALUATED');
  });

  it('🚨 the manufacturer document nobody holds is still surfaced, not resolved by the new UX',
    async () => {
      const f = makeFetch();
      await buildRaysJobGuided(f);
      const t = f.stored as any;
      const check = evaluateServiceTopology(t).checks.find(c => c.id === 'metering.multi-gateway')!;
      expect(check.conclusion).toBe('NOT_EVALUATED');
      expect(screen.getByTestId('topology-needs-input').textContent)
        .toContain('Manufacturer multi-gateway metering document');
      // And on the domain cards, because that is where the CTs are drawn.
      expect(screen.getByTestId('node-domain-1').textContent).toMatch(/Needs input/);
    });

  it('🚨 saved then reloaded, the screen shows what was built', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    cleanup();
    // A fresh mount against the same store — which is what a page reload is.
    render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('node-msp-2')).toBeTruthy());
    expect(screen.getByTestId('node-msp-1')).toBeTruthy();
    expect(screen.getByTestId('node-domain-1')).toBeTruthy();
    expect(screen.getByTestId('node-domain-2')).toBeTruthy();
    expect(screen.getByTestId('topology-summary').textContent).toContain('400 A service');
    expect(screen.getByTestId('qty-tesla-powerwall-3-expansion').textContent).toContain('2 ×');
  });
});

/**
 * 🚨 THE JOB AS IT STANDS ON 2026-10-01, answered in Ray's own words:
 *   400 A → two 200 A main panels → back up both → Gateway 3 + TWO PW3 + a generation panel each
 *   → solar DC into the batteries → one safety switch per path → save.
 *
 * Every step is a question an installer can answer without knowing the word "domain".
 */
async function buildCurrentJobGuided(f: ReturnType<typeof makeFetch>) {
  render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={f.impl} />);
  await waitFor(() => expect(screen.getByTestId('service-topology-wizard')).toBeTruthy());

  fireEvent.click(screen.getByTestId('wizard-service-400'));
  next();
  fireEvent.click(within(screen.getByTestId('wizard-dist-two-main-panels')).getByRole('radio'));
  next();
  next();   // both panels backed up, as the preset created them

  // EQUIPMENT: two Powerwalls per system, NO expansions, and each pair in its own panel.
  for (const d of ['domain-1', 'domain-2']) {
    fireEvent.change(screen.getByTestId(`wizard-${d}-gateway`),
      { target: { value: 'tesla-backup-gateway-3' } });
    fireEvent.change(screen.getByTestId(`wizard-${d}-ess`),
      { target: { value: 'tesla-powerwall-3' } });
    fireEvent.change(screen.getByTestId(`wizard-${d}-ess-count`), { target: { value: '2' } });
  }
  // 🚨 THE PHYSICAL QUESTION, ANSWERED — not a checkbox ticked.
  //
  // This was `getByRole('checkbox')`, and Ray's real project is why it is not any more: an unticked
  // checkbox is indistinguishable from a decision not to use a generation panel, so his saved graph
  // has none and every surface has been describing a design missing two physical panelboards. The
  // control now asks how the battery AC circuits are combined, with no default.
  fireEvent.click(within(screen.getByTestId('wizard-storage-connection-der-aggregation-panel'))
    .getByRole('radio'));
  next();

  // INTERCONNECTION: how the solar connects, then how the systems reach the service.
  fireEvent.click(within(screen.getByTestId('wizard-coupling-dc-coupled-storage')).getByRole('radio'));
  fireEvent.click(within(screen.getByTestId('wizard-arrangement-independent-branch')).getByRole('radio'));
  fireEvent.change(screen.getByTestId('wizard-meter-collar-permitted'), { target: { value: 'no' } });
  fireEvent.click(screen.getByTestId('wizard-der-isolation-required'));
  next();

  // DISCONNECTS: one safety switch on each 200 A path.
  fireEvent.click(within(screen.getByTestId('wizard-isolation-one-per-path')).getByRole('radio'));
  fireEvent.click(within(screen.getByTestId('wizard-role-service-disconnect')).getByRole('checkbox'));

  fireEvent.click(screen.getByTestId('wizard-finish'));
  await waitFor(() => expect(screen.getByTestId('topology-summary')).toBeTruthy());
  fireEvent.click(screen.getByTestId('topology-save'));
  await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));
}

describe('🚨 the CURRENT job, built through the guided flow', () => {
  it('four full Powerwalls, zero Expansions, two generation panels, DC coupled', async () => {
    const f = makeFetch();
    await buildCurrentJobGuided(f);
    const t = f.stored as any;
    expect(equipmentQuantities(t)).toEqual({
      'tesla-backup-gateway-3': 2,
      'tesla-powerwall-3': 4,
    });
    const s = summariseStorage(t);
    expect(s.inverterUnitCount).toBe(4);
    expect(s.expansionUnitCount).toBe(0);
    expect(s.totalUsableKwh).toBeCloseTo(54, 6);
    // 🚨 192 A, not 96: four inverting units on nearly the same energy.
    expect(s.totalContinuousOutputA).toBeCloseTo(192, 6);

    // One generation panel per system, each taking only its own pair.
    expect(t.aggregationPanels).toHaveLength(2);
    for (const d of t.domains) {
      const own = t.aggregationPanels.filter((p: any) => p.domainId === d.id);
      expect(own).toHaveLength(1);
      expect(own[0].feedsNodeId).toBe(d.gateway.id);
      expect(own[0].inputs.map((i: any) => i.sourceId).sort()).toEqual([...d.storageUnitIds].sort());
      expect(own[0].busbarRatingA).toBe(125);
    }

    expect(t.solarCoupling).toBe('dc-coupled-storage');
    // One switch per path, each IN LINE ahead of its own gateway.
    const iso = t.devices.filter((d: any) => d.roles.includes('der-isolation-disconnect'));
    expect(iso).toHaveLength(2);
    expect(iso.map((d: any) => d.ratedAmps)).toEqual([200, 200]);
    for (const d of iso) expect(d.inlineOnNodeId).toBeTruthy();
  });

  it('the summary bar reads the current job back in the installer\'s words', async () => {
    const f = makeFetch();
    await buildCurrentJobGuided(f);
    const bar = screen.getByTestId('topology-summary').textContent ?? '';
    expect(bar).toContain('400 A service');
    expect(bar).toContain('Two 200 A systems');
    expect(bar).toContain('4 Tesla Powerwall 3');
    expect(bar).toContain('54.0 kWh');
    expect(bar).toContain('192 A');
    expect(bar).toContain('2 external isolation switches');
    expect(bar).toContain('2 generation panels — one per system');
    expect(bar).toContain('PV DC coupled to Tesla Powerwall 3');
    // 🚨 AND NO EXPANSION COUNT, because there are none.
    expect(bar).not.toContain('Expansion');
  });

  it('🚨 the solar coupling is editable AFTER save, without the wizard', async () => {
    const f = makeFetch();
    await buildCurrentJobGuided(f);
    // View → click a node → edit. The interconnection node carries the project's coupling.
    fireEvent.click(screen.getByTestId('node-interconnection'));
    await waitFor(() => expect(screen.getByTestId('node-inspector')).toBeTruthy());
    fireEvent.click(within(screen.getByTestId('ic-coupling-ac-coupled-inverter')).getByRole('radio'));
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() =>
      expect((f.stored as any).solarCoupling).toBe('ac-coupled-inverter'));
  });
});

describe('🚨 a SAVED topology can be reopened and EDITED', () => {
  // Ray, after live testing: "Ray saved a topology and then had no obvious way to edit it. Fix this.
  // Required lifecycle: View topology → Edit topology → change equipment/service/interconnection →
  // Save changes → view."
  //
  // The old screen had no modes: a saved design landed straight in the editing surface with no Edit
  // to press, no Save changes to finish with and nothing to discard — so there was no moment at
  // which Ray could tell whether he was looking at the saved design or his unsaved changes.

  /** Build and save Ray's job, then remount — which is what reopening the project is. */
  async function saveThenReopen() {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    cleanup();
    render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('node-msp-2')).toBeTruthy());
    return f;
  }

  it('reopens in VIEW mode, with an Edit button and no editor', async () => {
    await saveThenReopen();
    expect(screen.getByTestId('topology-edit')).toBeTruthy();
    // Nothing that changes the design is on screen until it is asked for.
    expect(screen.queryByTestId('node-inspector')).toBeNull();
    expect(screen.queryByTestId('topology-save')).toBeNull();
    expect(screen.queryByTestId('advanced-toggle')).toBeNull();
  });

  it('Edit → change → Save changes → back to view, and the change was stored', async () => {
    const f = await saveThenReopen();
    fireEvent.click(screen.getByTestId('topology-edit'));
    expect(screen.getByTestId('node-inspector')).toBeTruthy();

    fireEvent.click(screen.getByTestId('node-msp-1'));
    fireEvent.change(within(screen.getByTestId('node-inspector')).getByTestId('inspector-panel-bus'),
      { target: { value: '225' } });
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));

    // Back in view, and what is in the store is the edit.
    expect(screen.queryByTestId('topology-save')).toBeNull();
    expect(screen.getByTestId('topology-edit')).toBeTruthy();
    expect((f.stored as any).panels.find((p: any) => p.id === 'msp-1').busbarRatingA).toBe(225);
  });

  it('🚨 clicking a box in the diagram is itself the way into editing', async () => {
    await saveThenReopen();
    // Ray: "The visual diagram itself should remain editable by clicking: service / branch / panel /
    // switch / Gateway / Powerwall / Expansion."
    expect(screen.queryByTestId('node-inspector')).toBeNull();
    fireEvent.click(screen.getByTestId('node-domain-1'));
    const inspector = screen.getByTestId('node-inspector');
    // The LABEL, which is what the diagram shows — the id is `domain-1`.
    expect(inspector.textContent).toContain('System 1 — backup domain');
    expect(screen.getByTestId('topology-save')).toBeTruthy();
  });

  it('🚨 Discard restores the saved design rather than keeping the edit', async () => {
    const f = await saveThenReopen();
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('node-service'));
    fireEvent.change(screen.getByTestId('inspector-service-amps'), { target: { value: '600' } });
    expect(screen.getByTestId('topology-summary').textContent).toContain('600 A service');

    fireEvent.click(screen.getByTestId('topology-discard'));
    await waitFor(() =>
      expect(screen.getByTestId('topology-summary').textContent).toContain('400 A service'));
    // And nothing was written on the way past.
    expect(f.calls.filter(c => c.startsWith('PUT'))).toHaveLength(1);
  });

  it('🚨 the guided flow REOPENS on the existing graph — it is not the only way to edit, '
     + 'and it is still a way to edit', async () => {
    const f = await saveThenReopen();
    fireEvent.click(screen.getByTestId('topology-edit'));
    fireEvent.click(screen.getByTestId('topology-guided'));
    const wiz = screen.getByTestId('service-topology-wizard');
    expect(wiz.textContent).toContain('editing this service');
    // It opened ON the saved design: the panels it offers to back up are the ones that exist.
    expect(within(wiz).getByTestId('wizard-backup-msp-1')).toBeTruthy();
    expect(within(wiz).getByTestId('wizard-backup-msp-2')).toBeTruthy();

    // Walk to the safety-switch step and choose one per system.
    next(); next(); next();
    fireEvent.click(within(screen.getByTestId('wizard-isolation-one-per-path')).getByRole('radio'));
    // 🚨 TWO DEVICES, EACH RATED FOR ITS OWN PATH — not one 400 A device because the service is
    // 400 A. And acceptance is a separate, unanswered question.
    const summary = screen.getByTestId('wizard-isolation-summary').textContent ?? '';
    expect(summary).toContain('2 disconnects');
    expect(summary).toContain('both systems independently isolated');
    expect(summary).toContain('200 A');
    expect(screen.getByTestId('wizard-isolation-unverified').textContent)
      .toContain('needs verification');

    fireEvent.click(screen.getByTestId('wizard-finish'));
    await waitFor(() => expect(screen.queryByTestId('service-topology-wizard')).toBeNull());
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));

    const t = f.stored as any;
    const iso = t.devices.filter((d: any) => d.roles.includes('der-isolation-disconnect'));
    expect(iso).toHaveLength(2);
    expect(iso.map((d: any) => d.ratedAmps)).toEqual([200, 200]);
    // Each one names the gateway it is in line ahead of — the field that makes opening it mean
    // something.
    expect(iso.every((d: any) => !!d.inlineOnNodeId)).toBe(true);
    expect(new Set(iso.map((d: any) => d.inlineOnNodeId)).size).toBe(2);
    expect(t.interconnection.isolationArrangementAccepted ?? null).toBeNull();
  });

  it('🚨 the optional load analysis is entered ONCE, and the branches derive from it', async () => {
    await saveThenReopen();
    fireEvent.click(screen.getByTestId('node-service'));
    const loads = screen.getByTestId('inspector-loads');
    expect(loads.textContent).toContain('optional');
    fireEvent.click(within(loads).getByTestId('inspector-add-loads'));

    fireEvent.change(screen.getByTestId('inspector-load-msp-1'), { target: { value: '118' } });
    // 🚨 A PARTIAL MODEL IS NOT A SMALLER LOAD, and the screen says so where the total would go.
    expect(screen.getByTestId('inspector-loads').textContent)
      .toContain('cannot be summed until every panelboard');
    fireEvent.change(screen.getByTestId('inspector-load-msp-2'), { target: { value: '96' } });
    expect(screen.getByTestId('inspector-loads').textContent).toContain('214.0 A aggregate');

    // And the branch shows its share as DERIVED — there is no second box to type it into.
    fireEvent.click(screen.getByTestId('node-branch-1'));
    const branch = screen.getByTestId('node-inspector');
    expect(within(branch).getByTestId('inspector-branch-demand-derived').textContent)
      .toContain('118.0 A');
    expect(within(branch).queryByTestId('inspector-branch-demand')).toBeNull();
  });

  it('🚨 the existing service assembly is a thing to READ, and is never priced', async () => {
    const f = await saveThenReopen();
    fireEvent.click(screen.getByTestId('node-service'));
    fireEvent.click(screen.getByTestId('inspector-service-existing'));
    const block = screen.getByTestId('inspector-existing-equipment');
    expect(block.textContent).toContain('configuration to verify');
    fireEvent.change(within(block).getByTestId('inspector-existing-mfr'),
      { target: { value: 'Eaton' } });
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));

    const t = f.stored as any;
    expect(t.service.existingEquipment.manufacturer).toBe('Eaton');
    expect(t.service.existingEquipment.verified).toBe(false);
    // Ray: "Do not automatically add replacement 400 A service distribution equipment."
    expect(Object.keys(equipmentQuantities(t)).sort()).toEqual([
      'tesla-backup-gateway-3', 'tesla-powerwall-3', 'tesla-powerwall-3-expansion',
    ]);
  });
});

describe('🚨 the 400 A split is obvious without reading a sentence', () => {
  it('one 200 A branch on a 400 A service shows the unassigned half and offers the action', async () => {
    const f = makeFetch();
    render(<ServiceTopologyBuilder projectId={PROJECT} fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('service-topology-wizard')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wizard-service-400'));
    next();
    fireEvent.click(within(screen.getByTestId('wizard-dist-one-main-panel')).getByRole('radio'));
    next(); next(); next(); next();
    fireEvent.click(screen.getByTestId('wizard-finish'));
    await waitFor(() => expect(screen.getByTestId('topology-summary')).toBeTruthy());

    // The one-main-panel preset on a 400 A service makes ONE 400 A branch — fully allocated, so
    // nothing is claimed to be missing. The confusing case is the half-built one:
    fireEvent.click(screen.getByTestId('node-branch-1'));
    fireEvent.change(screen.getByTestId('inspector-branch-amps'), { target: { value: '200' } });

    const alloc = screen.getByTestId('topology-allocation').textContent ?? '';
    expect(alloc).toContain('400 A service');
    expect(alloc).toContain('200 A allocated');
    expect(alloc).toContain('200 A unassigned');

    fireEvent.click(screen.getByTestId('complete-the-service'));
    await waitFor(() => expect(screen.queryByTestId('topology-allocation')).toBeNull());
    expect(screen.getByTestId('node-branch-2')).toBeTruthy();
  });
});

describe('advanced editing is preserved, behind the visual model', () => {
  it('the primitives still build a graph, and they are not the default workflow', async () => {
    const f = makeFetch();
    render(<ServiceTopologyBuilder projectId="p" fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('service-topology-wizard')).toBeTruthy());

    // Advanced is behind a disclosure, not in front of the operator.
    expect(screen.getByTestId('advanced-toggle').textContent).toBe('Advanced topology');
    fireEvent.change(screen.getByTestId('new-service-amps'), { target: { value: '320' } });
    fireEvent.click(screen.getByTestId('create-service'));
    await waitFor(() => expect(screen.getByTestId('topology-summary')).toBeTruthy());

    fireEvent.change(screen.getByTestId('new-branch-amps'), { target: { value: '160' } });
    fireEvent.click(screen.getByTestId('add-branch'));
    fireEvent.change(screen.getByTestId('new-panel-bus'), { target: { value: '200' } });
    fireEvent.change(screen.getByTestId('new-panel-main'), { target: { value: '150' } });
    fireEvent.click(screen.getByTestId('add-panel'));
    fireEvent.change(screen.getByTestId('new-domain-gateway'),
      { target: { value: 'tesla-backup-gateway-3' } });
    fireEvent.change(screen.getByTestId('new-domain-ess'), { target: { value: 'tesla-powerwall-3' } });
    fireEvent.click(screen.getByTestId('add-domain'));
    fireEvent.click(screen.getByTestId('add-service-disconnect'));
    fireEvent.click(screen.getByTestId('topology-save'));
    await waitFor(() => expect(screen.getByTestId('topology-message').textContent).toMatch(/saved/i));

    const t = f.stored as any;
    expect(t.service.ratedAmps).toBe(320);
    expect(t.branches).toHaveLength(1);
    expect(t.domains).toHaveLength(1);
    expect(t.devices[0].roles).toEqual(['service-disconnect']);
  });

  it('a domain cannot be added before there is a branch and a panel to put it on', async () => {
    const f = makeFetch();
    render(<ServiceTopologyBuilder projectId="p" fetchImpl={f.impl} />);
    await waitFor(() => expect(screen.getByTestId('create-service')).toBeTruthy());
    fireEvent.click(screen.getByTestId('create-service'));
    await waitFor(() => expect(screen.getByTestId('add-domain')).toBeTruthy());
    expect((screen.getByTestId('add-domain') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('🚨 the sheet drawn from what was built', () => {
  it('renders both branches, both domains, and the DC expansions — with no collisions', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
    const t = f.stored as any;
    const g = buildServiceTopologyGraph(t);

    // The collision/layout audit, which is what found the seven overflows and the off-sheet box
    // the first time these node types were drawn.
    expect(auditServiceTopologyLayout(g), 'the sheet has overlapping or overflowing boxes')
      .toEqual([]);
    expect(g.validationErrors).toEqual([]);

    const svg = renderServiceTopologySvg(g);
    // The label is composed by `serviceRatingLabel` now, so an unrated service reads
    // "NOT ESTABLISHED distribution" instead of printing `null A`.
    expect(svg).toContain('400 A distribution');
    expect(svg).toContain('200 A service path 1 feeder');
    expect(svg).toContain('200 A service path 2 feeder');
    expect(svg).toContain('MSP #1');
    expect(svg).toContain('MSP #2');
    expect(svg).toContain('N-G BOND');
    // 🚨 The expansion link is DASHED and labelled as a DC harness — visually not an AC feeder.
    expect(svg).toContain('DC expansion harness');
    expect(svg).toMatch(/stroke-dasharray="6 4"/);
    // And the unresolved authority is on the sheet, in words.
    expect(svg).toContain('MANUFACTURER DOCUMENT REQUIRED');
  });

  it('one domain draws one gateway; two draw two, on a wider sheet', async () => {
    const f = makeFetch();
    await buildRaysJobGuided(f);
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
