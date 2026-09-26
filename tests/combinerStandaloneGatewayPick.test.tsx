/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// "WHATEVER ENVOY I WANT" — INCLUDING A GATEWAY ON ITS OWN (2026-09-26).
//
// The standalone IQ Gateway used to be unreachable: the bare gateway cannot be
// the combiner (nowhere for the branches to land, so the SLD drew the breakers
// inside the Envoy while the BOM bought a different box), and so nothing
// offered it. It is now offered as ONE option — 'enphase-iq-gateway-standalone',
// the gateway in its own enclosure PLUS the PV AC combiner panel the branches
// land in — in the same picker, stored under the same `combinerDeviceId`, with
// no extra field and no question (Ray, 2026-09-25: one pick, never questioned).
//
// This file pins the UI half:
//   · the System Configuration selector lists it under its own heading and
//     POSTs exactly its id — and never offers the bare gateway;
//   · the ecosystem picker's Envoy row offers it too, under the same heading,
//     and an Apply carries it;
//   · the store accepts it and still refuses the bare gateway, by name;
//   · what the engineering page prints for it comes from the one resolver
//     answer (sldCombinerFields), naming the panel as the combiner.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import CombinerSelector from '@/components/engineering/CombinerSelector';
import EcosystemPicker, { type EcosystemApplyPayload } from '@/components/engineering/EcosystemPicker';
import {
  getBosDevice,
  isSelectableCombiner,
  listCombiners,
  planLandingDevice,
} from '@/lib/equipment/integratedBos';
import {
  COMBINER_PICK_GROUP_LABELS,
  groupCombinerChoices,
  planCombinerSelection,
  type CombinerDeviceFacts,
} from '@/lib/combinerSelection/service';
import { sldCombinerFields } from '@/lib/equipment/sldCombinerFields';
import { stripComments, stripCommentsAndStrings } from './support/stripSource';

const STANDALONE = 'enphase-iq-gateway-standalone';
const BARE_GATEWAY = 'enphase-iq-gateway';
const FIVE_C = 'enphase-iq-combiner-5c';
const IQ8_PLUS = 'enphase-iq8plus';

/** The GET's candidates, built exactly as the route builds them. */
const routeCandidates = () =>
  listCombiners().map(d => ({ id: d.id, brand: d.brand, model: d.model, kind: d.kind }));

/** A combiner-selection API: GET answers with `candidates`, a POST records its
 *  device and echoes the record the way the route does. */
function mockApi(candidates: Array<{ id: string; brand: string; model: string; kind?: string }>) {
  let stored: string | null = null;
  const posts: any[] = [];
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      stored = body.combinerDeviceId;
      const d = getBosDevice(stored ?? undefined);
      return { ok: true, json: async () => ({
        success: true,
        selected: { combinerDeviceId: stored, manufacturer: d?.brand ?? '', model: d?.model ?? '',
                    basis: null, selectedBy: 'ray', selectedAtIso: '2026-09-26T00:00:00.000Z' },
        history: [],
      }) } as unknown as Response;
    }
    const d = getBosDevice(stored ?? undefined);
    return { ok: true, json: async () => ({
      success: true,
      selected: stored
        ? { combinerDeviceId: stored, manufacturer: d?.brand ?? '', model: d?.model ?? '',
            basis: null, selectedBy: 'ray', selectedAtIso: '2026-09-26T00:00:00.000Z' }
        : null,
      candidates,
      declaredCompatibleIds: ['enphase-iq-combiner-5', BARE_GATEWAY],
      pairing: { inverterLabel: 'Enphase IQ8+', combinerIds: [FIVE_C] },
    }) } as unknown as Response;
  });
  return { fetchMock, posts };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the catalogue half — what the pickers are handed', () => {
  it('the standalone topology is a selectable combiner; the bare gateway is not', () => {
    expect(isSelectableCombiner(STANDALONE)).toBe(true);
    expect(isSelectableCombiner(BARE_GATEWAY)).toBe(false);
    const ids = routeCandidates().map(c => c.id);
    expect(ids).toContain(STANDALONE);
    expect(ids).not.toContain(BARE_GATEWAY);
  });

  it('the pickers file it apart from the IQ Combiners — and a combiner-only list is untouched', () => {
    const g = groupCombinerChoices(routeCandidates());
    expect(g.standalone.map(c => c.id)).toEqual([STANDALONE]);
    expect(g.integrated.map(c => c.id)).toContain(FIVE_C);
    expect(g.integrated.every(c => c.kind === 'integrated_combiner')).toBe(true);
    // A reader that does not say the kind files everything as a combiner — what
    // every choice was before the standalone option existed.
    const bare: Array<{ id: string; kind?: string }> = [{ id: FIVE_C }, { id: 'x' }];
    expect(groupCombinerChoices(bare)).toEqual({ integrated: bare, standalone: [] });
  });

  it('the route sends the kind with every candidate, from listCombiners()', () => {
    const ROUTE = stripCommentsAndStrings(readFileSync(
      join(__dirname, '..', 'app', 'api', 'projects', '[id]', 'combiner-selection', 'route.ts'), 'utf8'));
    expect(ROUTE).toMatch(/candidates:\s*listCombiners\(\)\.map\(d => \(\{[^}]*kind:\s*d\.kind/);
  });
});

describe('🚨 the store records the standalone pick — and still refuses the bare gateway', () => {
  const routeLookup = (id: string): CombinerDeviceFacts | null => {
    const d = getBosDevice(id);
    return d
      ? { id: d.id, manufacturer: d.brand, model: d.model, modelNumber: null, isSelectableCombiner: isSelectableCombiner(d.id) }
      : null;
  };
  const pick = (deviceId: string) => planCombinerSelection({
    deviceId, lookupDevice: routeLookup, inverterId: IQ8_PLUS, declaredCompatibleIds: null,
    actor: { id: 'ray@example.com', kind: 'user' }, atIso: '2026-09-26T12:00:00.000Z', basis: null, current: null,
  });

  it('one pick, recorded under combinerDeviceId, with no text at all', () => {
    const r = pick(STANDALONE);
    expect(r.refusals).toEqual([]);
    expect(r.next!.active!.combinerDeviceId).toBe(STANDALONE);
    expect(r.next!.active!.basis).toBeNull();
    // No second field carries the topology: the id is the whole answer.
    expect(Object.keys(r.next!.active!).sort()).toEqual(Object.keys(pick(FIVE_C).next!.active!).sort());
  });

  it('the bare gateway is refused by name, and pointed at both ways to have that Envoy', () => {
    const r = pick(BARE_GATEWAY);
    expect(r.ok).toBe(false);
    const msg = r.refusals.find(x => x.code === 'NOT_A_SELECTABLE_COMBINER')?.message ?? '';
    expect(msg).toMatch(/IQ Gateway \(Envoy\) built in/);
    expect(msg).toContain(getBosDevice(STANDALONE)!.model);
    expect(msg).not.toMatch(/reason|authority|basis|justif/i);
  });
});

describe('CombinerSelector — the standalone gateway is one option in the same list', () => {
  it('lists it under its own heading, never the bare gateway, and POSTs exactly its id', async () => {
    vi.useFakeTimers();
    const { fetchMock, posts } = mockApi(routeCandidates());
    vi.stubGlobal('fetch', fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible inverterId={IQ8_PLUS}
      onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });

    const select = view.container.querySelector('select')!;
    const values = Array.from(select.options).map(o => o.value);
    expect(values).toContain(STANDALONE);
    expect(values).not.toContain(BARE_GATEWAY);

    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.map(g => g.label)).toEqual([
      COMBINER_PICK_GROUP_LABELS.integrated, COMBINER_PICK_GROUP_LABELS.standalone,
    ]);
    expect(Array.from(groups[1].querySelectorAll('option')).map(o => o.value)).toEqual([STANDALONE]);
    expect(Array.from(groups[0].querySelectorAll('option')).map(o => o.value)).not.toContain(STANDALONE);
    // The option names both boxes it puts on the wall.
    const opt = Array.from(select.options).find(o => o.value === STANDALONE)!;
    expect(opt.textContent).toMatch(/IQ Gateway \(standalone\) \+ PV AC combiner panel/);

    fireEvent.change(select, { target: { value: STANDALONE } });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(posts).toEqual([{ combinerDeviceId: STANDALONE, inverterId: IQ8_PLUS }]);
    expect(reported[reported.length - 1]).toBe(STANDALONE);

    const text = view.container.textContent ?? '';
    // The recorded pick reads as what it is, and the note says what it draws —
    // information, not a question: still no inputs anywhere.
    expect(text).toContain('Enphase IQ Gateway (standalone) + PV AC combiner panel');
    expect(text).toMatch(/Drawn as two boxes/);
    expect(text).toContain('information only');
    expect(view.container.querySelectorAll('input').length).toBe(0);
  });

  it('a list with no standalone option renders flat, exactly as before', async () => {
    vi.useFakeTimers();
    const onlyCombiners = routeCandidates().filter(c => c.kind === 'integrated_combiner');
    const { fetchMock } = mockApi(onlyCombiners);
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CombinerSelector projectId="p1" visible inverterId={IQ8_PLUS} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(view.container.querySelectorAll('optgroup').length).toBe(0);
    expect(view.container.textContent).toContain(
      'Each IQ Combiner has the IQ Gateway (Envoy) built in. Any one can be selected — the catalogue pairs');
    expect(view.container.textContent).not.toMatch(/standalone/i);
  });
});

describe('EcosystemPicker — the Envoy row offers the standalone gateway too', () => {
  const openEnphase = (currentCombinerId: string | null = null) => {
    const applied: EcosystemApplyPayload[] = [];
    const view = render(<EcosystemPicker onApply={p => applied.push(p)} currentCombinerId={currentCombinerId} />);
    fireEvent.click(view.getByText('Enphase'));
    return { view, applied };
  };
  const envoySelect = (container: HTMLElement) => {
    const s = Array.from(container.querySelectorAll('select'))
      .find(el => Array.from(el.options).some(o => o.value === FIVE_C));
    expect(s, 'no Envoy select rendered').toBeTruthy();
    return s as HTMLSelectElement;
  };

  it('offers it under the same heading as the System Configuration card — never the bare gateway', () => {
    const { view } = openEnphase();
    const s = envoySelect(view.container);
    const values = Array.from(s.options).map(o => o.value);
    expect(values).toContain(STANDALONE);
    expect(values).not.toContain(BARE_GATEWAY);
    const standaloneGroup = Array.from(s.querySelectorAll('optgroup'))
      .find(g => g.label === COMBINER_PICK_GROUP_LABELS.standalone);
    expect(standaloneGroup, 'no standalone heading').toBeTruthy();
    expect(Array.from(standaloneGroup!.querySelectorAll('option')).map(o => o.value)).toEqual([STANDALONE]);
    expect(view.container.textContent).toMatch(/Your pick becomes/);
  });

  it('picking it is what the Apply carries', () => {
    const { view, applied } = openEnphase();
    fireEvent.change(envoySelect(view.container), { target: { value: STANDALONE } });
    fireEvent.click(view.getByText(/Apply Enphase System/));
    expect(applied[0].selections.combinerId).toBe(STANDALONE);
  });

  it('the expert Kit Builder offers and carries it as well', () => {
    const { view, applied } = openEnphase();
    fireEvent.click(view.getByText('Customize individually'));
    fireEvent.change(envoySelect(view.container), { target: { value: STANDALONE } });
    fireEvent.click(view.getByText(/Apply Enphase Ecosystem/));
    expect(applied[0].selections.combinerId).toBe(STANDALONE);
  });

  it("a project that already records it: the keep option names it", () => {
    const { view } = openEnphase(STANDALONE);
    const first = envoySelect(view.container).options[0];
    expect(first.value).toBe('');
    expect(first.textContent).toMatch(/keep Enphase IQ Gateway \(standalone\) \+ PV AC combiner panel/);
  });
});

describe('🚨 what the engineering page prints for it is the one resolver answer', () => {
  // The page's `pageMetering` is exactly this call (app/engineering/page.tsx).
  const fields = (selectedCombinerId: string) => sldCombinerFields({
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8+', inverterId: IQ8_PLUS,
    isMicro: true, totalDevices: 24, branchCount: 3, hasBattery: false,
    selectedCombinerId, interconnectionRaw: 'LOAD_SIDE', ungroundedConductorCount: 2,
    consumptionCtLocation: null,
  });

  it('the combiner it names is the PV AC combiner panel; the gateway is named beside it', () => {
    const f = fields(STANDALONE);
    const landing = planLandingDevice(f.plan)!;
    expect(landing.kind).toBe('ac_combiner');
    // COMB-1, the Diagram badge and the CT hint all read these.
    expect(f.combinerModel).toBe(`${landing.brand} ${landing.model}`);
    expect(f.standaloneGateway?.label).toBe(`${f.plan.gateway!.brand} ${f.plan.gateway!.model}`);
    expect(f.standaloneGateway?.landingLabel).toBe(f.combinerModel);
    // CT-1: the gateway's consumption CTs are a separate purchase.
    expect(f.meteringDrawing?.consumption?.supplied).toBe('order-separately');
  });

  it('every existing pick: the landing device is the brains, and no gateway row exists', () => {
    for (const d of listCombiners().filter(c => c.kind === 'integrated_combiner')) {
      const f = fields(d.id);
      expect(planLandingDevice(f.plan)?.id, d.id).toBe(f.plan.brains?.id);
      expect('standaloneGateway' in f, d.id).toBe(false);
    }
  });

  it('the page reads COMB-1 through planLandingDevice and adds ENVOY-1 only for a standalone gateway', () => {
    const PAGE = stripCommentsAndStrings(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));
    expect(PAGE).toMatch(/const _b = planLandingDevice\(pageMetering\.plan\)/);
    expect(PAGE).not.toMatch(/pageMetering\.plan\.brains \?\? pageMetering\.plan\.devices\[0\]/);
    expect(PAGE).toMatch(/const _sgw = \/\^COMB-\/\.test\(row0\.tag\) \? pageMetering\?\.standaloneGateway : undefined;\s*if \(!_sgw\) return _tr;/);
    // Not GW-n: the engine tags a battery's backup gateway GW-n on the same table.
    // The key is a string literal, so the identifier scan above blanks it; strip
    // comments ONLY — a raw read would still pass with the row commented out.
    const NO_COMMENTS = stripComments(readFileSync(join(__dirname, '..', 'app', 'engineering', 'page.tsx'), 'utf8'));
    expect(NO_COMMENTS).toContain('<tr key="ENVOY-1"');
  });
});
