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

function mockApi() {
  const posts: any[] = [];
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      return { ok: true, json: async () => ({
        success: true,
        selected: { combinerDeviceId: body.combinerDeviceId, manufacturer: 'Enphase', model: 'IQ Combiner 6C',
                    basis: null, selectedBy: 'ray', selectedAtIso: '2026-09-25T00:00:00.000Z' },
        history: [],
      }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({
      success: true, selected: null,
      candidates: [
        { id: SIX_C, brand: 'Enphase', model: 'IQ Combiner 6C' },
        { id: FIVE_C, brand: 'Enphase', model: 'IQ Combiner 5C' },
        { id: FOUR_C, brand: 'Enphase', model: 'IQ Combiner 4C' },
      ],
      declaredCompatibleIds: ['enphase-iq-combiner-5', 'enphase-iq-gateway'],
      pairing: { inverterLabel: 'Enphase IQ8+', combinerIds: [FIVE_C] },
    }) } as unknown as Response;
  });
  return { fetchMock, posts };
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
