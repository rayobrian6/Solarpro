/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// ONE PICK, NO QUESTIONS — Ray, 2026-09-25.
//
// "I don't like that I have to be questioned why I choose whatever Envoy I want
// to. It's ridiculous."
//
// The System Configuration combiner card demanded a free-text reason, labelled
// every option "(not declared)" (a raw-string compare between two catalogues'
// spellings), opened an amber "state the authority" box with two more required
// fields — and an IQ8+ job's card said "This inverter declares: se-p401,
// se-p505, se-p730", SolarEdge optimizers, because a stale string-inverter id
// was looked up as if it were the micro.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import CombinerSelector from '@/components/engineering/CombinerSelector';
import { combinerCompatibilityFor, declaredCombinerPairing } from '@/lib/equipment/combinerCompatibility';
import { canonicalCombinerId } from '@/lib/equipment/combinerIdentity';

const SIX_C = 'enphase-iq-combiner-6c';
const FIVE_C = 'enphase-iq-combiner-5c';
const FOUR_C = 'enphase-iq-combiner-4c';

/** `selected` — the device the GET says the project already records. Like the
 *  database, a POST that answers success records its device and a later GET
 *  reads it back; a POST still held has recorded nothing yet.
 *  `failGet` — the GET throws (a network failure).
 *  `holdPost` — the POST is recorded at once but answers only on `releasePost()`.
 *  `refusePost` — the POST answers 429 (the shared `engineering` rate-limit
 *  bucket) and records nothing. */
function mockApi(opts: { selected?: string | null; failGet?: boolean; holdPost?: boolean; refusePost?: boolean } = {}) {
  let stored: string | null = opts.selected ?? null;
  const posts: any[] = [];
  const postUrls: string[] = [];
  const postInits: RequestInit[] = [];
  const gets: string[] = [];
  const gate = { release: () => {} };
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body); postUrls.push(String(url)); postInits.push(init);
      if (opts.holdPost) await new Promise<void>(res => { gate.release = () => res(); });
      if (opts.refusePost) {
        return { ok: false, status: 429,
          json: async () => ({ success: false, error: 'Too many requests.', code: 'RATE_LIMITED' }) } as unknown as Response;
      }
      stored = body.combinerDeviceId;
      return { ok: true, json: async () => ({
        success: true,
        selected: { combinerDeviceId: body.combinerDeviceId, manufacturer: 'Enphase', model: 'IQ Combiner 6C',
                    basis: null, selectedBy: 'ray', selectedAtIso: '2026-09-25T00:00:00.000Z' },
        history: [],
      }) } as unknown as Response;
    }
    if (!init?.method || init.method === 'GET') gets.push(String(url));
    if (opts.failGet) throw new Error('network down');
    const recorded = stored;
    return { ok: true, json: async () => ({
      success: true,
      selected: recorded
        ? { combinerDeviceId: recorded, manufacturer: 'Enphase', model: 'IQ Combiner',
            basis: null, selectedBy: 'ray', selectedAtIso: '2026-09-24T00:00:00.000Z' }
        : null,
      candidates: [
        { id: SIX_C, brand: 'Enphase', model: 'IQ Combiner 6C' },
        { id: FIVE_C, brand: 'Enphase', model: 'IQ Combiner 5C' },
        { id: FOUR_C, brand: 'Enphase', model: 'IQ Combiner 4C' },
      ],
      declaredCompatibleIds: ['enphase-iq-combiner-5', 'enphase-iq-gateway'],
      pairing: { inverterLabel: 'Enphase IQ8+', combinerIds: [FIVE_C] },
    }) } as unknown as Response;
  });
  return { fetchMock, posts, postUrls, postInits, gets, releasePost: () => gate.release() };
}

describe('CombinerSelector — one pick, no questions', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('asks for nothing: no reason, no authority, no "(not declared)"', async () => {
    const { fetchMock } = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<CombinerSelector projectId="p1" visible inverterId="enphase-iq8plus" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const text = view.container.textContent ?? '';
    expect(text).toContain('No combiner selected');
    expect(text).not.toContain('(not declared)');
    expect(text).not.toContain('Why this device');
    expect(text).not.toMatch(/state the\s+authority/i);
    expect(view.container.querySelectorAll('input').length).toBe(0);
    // The catalogue pairing is a quiet note, never a gate.
    expect(text).toContain('information only');
  });

  it('choosing a combiner saves it: exactly one POST, no basis, no override', async () => {
    vi.useFakeTimers();
    const { fetchMock, posts } = mockApi();
    vi.stubGlobal('fetch', fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible inverterId="enphase-iq8plus"
      onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    const select = view.container.querySelector('select')!;
    // Arrow-keying through the list fires change per option; only the settled pick is saved.
    fireEvent.change(select, { target: { value: FIVE_C } });
    fireEvent.change(select, { target: { value: FOUR_C } });
    fireEvent.change(select, { target: { value: SIX_C } });
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(posts).toHaveLength(1);
    expect(posts[0].combinerDeviceId).toBe(SIX_C);
    expect(posts[0]).not.toHaveProperty('basis');
    expect(posts[0]).not.toHaveProperty('compatibilityOverride');
    expect(reported[reported.length - 1]).toBe(SIX_C);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SELECTOR LIVES ONLY UNDER THE SYSTEM CONFIGURATION TAB — so it mounts and
// unmounts every time the operator comes and goes, and the page hides it for
// non-micro designs. Two defects rode on that:
//   1. A pick made inside the 450 ms settle window before clicking away was
//      never saved — unmount cancelled the timer and nothing else.
//   2. The project-change reset ran on EVERY mount, hidden or not, and reported
//      null; the page dropped the combiner its own loader had read (and the SLD
//      with it) every time the tab was revisited.
// ═══════════════════════════════════════════════════════════════════════════
describe('CombinerSelector — leaving the tab, coming back, hidden, switching project', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('a pick made just before leaving the tab is still saved — and the page is told', async () => {
    vi.useFakeTimers();
    const api = mockApi();
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible inverterId="enphase-iq8plus"
      onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    fireEvent.change(view.container.querySelector('select')!, { target: { value: FIVE_C } });
    // Well inside the settle window: the timer has not fired, nothing is sent.
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(api.posts).toHaveLength(0);

    reported.length = 0;
    view.unmount();
    await act(async () => { await vi.runAllTimersAsync(); });

    expect(api.posts, 'the pick must reach the server').toHaveLength(1);
    expect(api.posts[0]).toEqual({ combinerDeviceId: FIVE_C, inverterId: 'enphase-iq8plus' });
    expect(api.postUrls[0]).toContain('/api/projects/p1/combiner-selection');
    // So the request outlives a closing browser tab as well as a React tab.
    expect(api.postInits[0].keepalive).toBe(true);
    // The page carries the pick into the next SLD / permit payload — told once,
    // at unmount, and never again by a response landing afterwards.
    expect(reported).toEqual([FIVE_C]);
  });

  it('a save still in flight at unmount: the page is told at unmount, nothing is reported after', async () => {
    vi.useFakeTimers();
    const api = mockApi({ holdPost: true });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible inverterId="enphase-iq8plus"
      onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    fireEvent.change(view.container.querySelector('select')!, { target: { value: FIVE_C } });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(api.posts, 'the settle timer fired and the POST is in flight').toHaveLength(1);

    reported.length = 0;
    view.unmount();
    expect(reported).toEqual([FIVE_C]);

    api.releasePost();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported, 'a response landing after unmount must say nothing').toEqual([FIVE_C]);
    expect(api.posts, 'an in-flight pick is not sent a second time').toHaveLength(1);
  });

  it('coming back to the tab does not wipe the page\'s combiner — a remount is not a project change', async () => {
    vi.useFakeTimers();
    const api = mockApi({ selected: FIVE_C });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const props = { projectId: 'p1', visible: true, inverterId: 'enphase-iq8plus',
      onSelectionChanged: (id: string | null) => { reported.push(id); } };

    const first = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported, 'even the first mount does not open with a null').not.toContain(null);
    expect(reported).toContain(FIVE_C);
    first.unmount();

    reported.length = 0;
    render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported, 'the remount must not report null').not.toContain(null);
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.every(id => id === FIVE_C)).toBe(true);
    expect(api.posts).toHaveLength(0);
  });

  it('a failed read reports nothing — "could not find out" is not "nobody chose"', async () => {
    vi.useFakeTimers();
    const api = mockApi({ failGet: true });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    render(<CombinerSelector projectId="p1" visible onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(api.fetchMock).toHaveBeenCalled();
    expect(reported).toEqual([]);
  });

  it('a hidden selector never reports — not on mount, not on a project change, not on unmount', async () => {
    vi.useFakeTimers();
    const api = mockApi({ selected: FIVE_C });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible={false}
      onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(view.container.innerHTML).toBe('');

    await act(async () => {
      view.rerender(<CombinerSelector projectId="p2" visible={false} onSelectionChanged={id => reported.push(id)} />);
    });
    await act(async () => { await vi.runAllTimersAsync(); });
    view.unmount();

    expect(reported).toEqual([]);
    expect(api.fetchMock).not.toHaveBeenCalled();
  });

  it('a project change DOES reset — and a pick still settling for the old project is dropped unsent', async () => {
    vi.useFakeTimers();
    const api = mockApi({ selected: FOUR_C });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const view = render(<CombinerSelector projectId="p1" visible onSelectionChanged={id => reported.push(id)} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported).toContain(FOUR_C);
    fireEvent.change(view.container.querySelector('select')!, { target: { value: FIVE_C } });

    reported.length = 0;
    await act(async () => {
      view.rerender(<CombinerSelector projectId="p2" visible onSelectionChanged={id => reported.push(id)} />);
    });
    expect(reported[0], 'a project change reports null before anything else').toBeNull();

    await act(async () => { await vi.runAllTimersAsync(); });
    view.unmount();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(api.posts, 'the old project\'s unsettled pick is neither saved nor flushed').toHaveLength(0);
    expect(reported).not.toContain(FIVE_C);
  });

  // A READ MUST NOT OVERTAKE A WRITE. Leave the tab inside the settle window and
  // come straight back: the new instance's GET used to go out at once, reach the
  // database before the flushed POST committed, read the OLD device and report
  // it — the page then drew and priced that one while the permit read the new.
  it('coming straight back waits for the write the last visit left unanswered', async () => {
    vi.useFakeTimers();
    const api = mockApi({ selected: FOUR_C, holdPost: true });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const props = { projectId: 'p-race', visible: true, inverterId: 'enphase-iq8plus',
      onSelectionChanged: (id: string | null) => { reported.push(id); } };

    const first = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported).toEqual([FOUR_C]);
    fireEvent.change(first.container.querySelector('select')!, { target: { value: FIVE_C } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    first.unmount();
    expect(api.posts, 'the unmount flush sent the pick, and it is unanswered').toHaveLength(1);

    reported.length = 0;
    const readsBefore = api.gets.length;
    const second = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.gets.length, 'no read goes out while the write is unanswered').toBe(readsBefore);
    expect(second.container.textContent).toContain('loading');

    api.releasePost();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(api.gets.length, 'the read goes out once the write has answered').toBe(readsBefore + 1);
    expect(reported, 'the page is never put back on the old device').not.toContain(FOUR_C);
    expect(reported[reported.length - 1]).toBe(FIVE_C);
    expect(second.container.querySelector('select')!.value).toBe(FIVE_C);
  });

  // The page is told a flushed pick at unmount, before the server answers — an
  // unmounted selector cannot tell whether the page has since changed project,
  // so it may not report a late answer. When that write is REFUSED, the next
  // visit is where the page is put back on the record, and the operator is told.
  it('a pick flushed at unmount and refused: the next visit restores the record and says why — once', async () => {
    vi.useFakeTimers();
    const api = mockApi({ selected: FOUR_C, refusePost: true });
    vi.stubGlobal('fetch', api.fetchMock);
    const reported: Array<string | null> = [];
    const props = { projectId: 'p-refused', visible: true, inverterId: 'enphase-iq8plus',
      onSelectionChanged: (id: string | null) => { reported.push(id); } };

    const first = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    fireEvent.change(first.container.querySelector('select')!, { target: { value: FIVE_C } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    reported.length = 0;
    first.unmount();
    expect(reported, 'told at unmount, before the answer').toEqual([FIVE_C]);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(api.posts).toHaveLength(1);
    expect(reported, 'the refusal is not reported by an unmounted selector').toEqual([FIVE_C]);

    reported.length = 0;
    const second = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(reported, 'the page is put back on what the project records').toEqual([FOUR_C]);
    expect(second.container.querySelector('select')!.value).toBe(FOUR_C);
    expect(second.container.textContent).toContain('was not saved');
    expect(second.container.textContent).toContain('Too many requests.');

    second.unmount();
    const third = render(<CombinerSelector {...props} />);
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(third.container.textContent, 'said once, not on every visit').not.toContain('was not saved');
    expect(api.posts, 'nothing is re-sent on the operator\'s behalf').toHaveLength(1);
  });
});

describe('an IQ8+ job never reads SolarEdge optimizers as its combiner declaration', () => {
  it('a string-inverter id is not a combiner declaration', () => {
    expect(combinerCompatibilityFor(undefined, undefined, 'se-7600h')).toBeUndefined();
    expect(declaredCombinerPairing('se-7600h')).toBeNull();
  });
  it('the micro still resolves to its declared pairing', () => {
    const p = declaredCombinerPairing('enphase-iq8plus')!;
    expect(p.inverterLabel).toMatch(/Enphase/);
    expect(p.combinerIds).toContain(canonicalCombinerId('enphase-iq-combiner-5'));
    expect(p.combinerIds.every(Boolean)).toBe(true);
  });
});

describe('the downloaded permit package carries the pick', () => {
  it('handleGeneratePermitPackage sends selectedCombinerId like every other payload', () => {
    const page = readFileSync(join(process.cwd(), 'app/engineering/page.tsx'), 'utf8');
    const start = page.indexOf('const handleGeneratePermitPackage');
    const end = page.indexOf("/api/engineering/permit?format=pdf", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(page.slice(start, end)).toMatch(/selectedCombinerId:\s*projectCombinerId/);
  });
});
