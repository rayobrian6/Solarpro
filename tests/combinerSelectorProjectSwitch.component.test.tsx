/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// A COMBINER SELECTION IS NOT PORTABLE BETWEEN PROJECTS.
//
// The propagation repair made `selectedCombinerId` the HIGHEST authority in the
// resolver: once it is set, nothing downstream may substitute anything else.
// That is correct, and it is exactly why a STALE one is now dangerous rather
// than merely untidy. Before this fix it was not a default that could be
// overridden — it WON, and project A's equipment decision would be asserted on
// project B's drawings, BOM and permit package.
//
// Two carriers of that staleness, one per test:
//   1. CombinerSelector kept reporting the OLD project's device for the whole
//      round-trip of the new project's fetch (it reports on load, and load is
//      async). The window is small, and a generate inside it is silent.
//   2. The selector is mounted only for MICRO designs. Switching to a string
//      design UNMOUNTS it, so it never reports again at all and the parent's
//      last-known value persists indefinitely — no window, just permanent.
//
// The component's contract is therefore: on a project change, say NOTHING IS
// SELECTED first, and only then go and find out. A moment of "not selected" is
// true. A moment of the wrong device is not.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';
import CombinerSelector from '@/components/engineering/CombinerSelector';

const FOUR_C = 'enphase-iq-combiner-4c';

/** The GET the selector issues, resolved per project id. */
function mockFetch(byProject: Record<string, string | null>) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const m = String(url).match(/\/api\/projects\/([^/]+)\/combiner-selection/);
    const pid = m?.[1] ?? '';
    const id = byProject[pid] ?? null;
    return {
      ok: true,
      json: async () => ({
        success: true,
        selected: id
          ? {
              combinerDeviceId: id, manufacturer: 'Enphase', model: 'IQ Combiner 4C',
              basis: 'on the truck', selectedBy: 'ray', selectedAtIso: '2026-09-22T00:00:00.000Z',
              compatibility: { declaredCompatibleIds: null, declaredCompatible: false, source: 'x' },
              compatibilityOverride: null,
            }
          : null,
        candidates: [{ id: FOUR_C, brand: 'Enphase', model: 'IQ Combiner 4C' }],
        declaredCompatibleIds: null,
      }),
    } as unknown as Response;
  });
}

describe('CombinerSelector — a project switch must not leak the previous selection', () => {
  let reported: Array<string | null>;

  beforeEach(() => { reported = []; });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('reports null the moment the project id changes, BEFORE the new fetch lands', async () => {
    // Project A has a selection; project B has none. A never-resolving fetch for
    // B holds the component in exactly the window the bug lived in.
    let releaseB: (() => void) | null = null;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/project-b/')) {
        await new Promise<void>(res => { releaseB = res; });
      }
      return (await mockFetch({ 'project-a': FOUR_C, 'project-b': null })(url)) as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <CombinerSelector projectId="project-a" visible onSelectionChanged={id => reported.push(id)} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(reported, 'project A must report its recorded device').toContain(FOUR_C);

    reported = [];
    await act(async () => {
      view.rerender(
        <CombinerSelector projectId="project-b" visible onSelectionChanged={id => reported.push(id)} />,
      );
    });

    // B's fetch is still in flight. The ONLY honest answer right now is null.
    expect(reported, 'a project change must report something immediately').not.toHaveLength(0);
    expect(reported[0]).toBeNull();
    expect(reported, 'project A\'s device must not be reported for project B').not.toContain(FOUR_C);
    releaseB?.();
  });

  it('a FAILED fetch for the new project leaves nothing selected, not the old device', async () => {
    // The load path swallows errors on purpose — "the panel stays empty rather
    // than asserting anything". It did not stay empty: with no reset, a network
    // failure on project B left project A's device both DISPLAYED and REPORTED,
    // permanently, with no further request coming to correct it. That is the
    // same staleness as the in-flight window but with no upper bound on it.
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/project-b/')) throw new Error('network down');
      return (await mockFetch({ 'project-a': FOUR_C })(url)) as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const view = render(
      <CombinerSelector projectId="project-a" visible onSelectionChanged={id => reported.push(id)} />,
    );
    await act(async () => { await Promise.resolve(); });
    expect(reported).toContain(FOUR_C);

    reported = [];
    await act(async () => {
      view.rerender(
        <CombinerSelector projectId="project-b" visible onSelectionChanged={id => reported.push(id)} />,
      );
      await Promise.resolve(); await Promise.resolve();
    });

    // Settled, and it will not change again. The last word must be null.
    expect(reported[reported.length - 1]).toBeNull();
    expect(reported).not.toContain(FOUR_C);
    // ...and the panel must not still be SHOWING project A's device either.
    expect(view.container.textContent).toContain('No combiner selected');
    expect(view.container.textContent).not.toContain('IQ Combiner 4C');
  });
});
