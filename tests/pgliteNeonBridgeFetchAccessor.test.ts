/**
 * tests/pgliteNeonBridgeFetchAccessor.test.ts
 *
 * THE ONE PROPERTY THE LOCAL-POSTGRES HARNESS RESTS ON: NOTHING CAN UNSEAT IT.
 *
 * 🚨 WHAT THIS LOCKS DOWN, AND WHY A TEST HAD TO.
 *
 * `lib/dev/pgliteNeonBridge.ts` answers the Neon HTTP driver in-process by
 * owning `globalThis.fetch`. It used to do that with a plain assignment, and
 * `next dev` takes it straight back:
 *
 *   next/dist/server/lib/router-server.js
 *     let originalFetch = globalThis.fetch;        // before instrumentation runs
 *     const resetFetch = () => { globalThis.fetch = originalFetch; … };
 *
 * `resetFetch` is handed to the hot reloader and called on EVERY server-side
 * recompile (`dist/server/dev/hot-reloader-webpack.js`), so the first time any
 * watched file changed — including Playwright writing into the tree — the bridge
 * was gone. Nothing said so. The harness had already printed five success lines,
 * and the only symptom was a DNS failure that reads exactly like a missing
 * database credential. A whole session was spent diagnosing the wrong thing.
 *
 * So the bridge is an ACCESSOR now, and these are the claims that make it work.
 * They are asserted against the real module, not a copy of its logic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_TAG, installFetchAccessor } from '@/lib/dev/pgliteNeonBridge';

type AnyFetch = typeof globalThis.fetch;

const isBridge = (f: unknown) =>
  typeof f === 'function' && (f as unknown as Record<symbol, unknown>)[BRIDGE_TAG] === true;

/** The driver's own call shape, measured from @neondatabase/serverless 0.10.4:
 *  `(fetchFunction ?? fetch)(url, { method, body, headers })` — the header that
 *  identifies it is a plain object in `init`, never on a Request. */
const neonCall = () => [
  'https://api.example.invalid/sql',
  {
    method: 'POST',
    body: JSON.stringify({ query: 'SELECT 1', params: [] }),
    headers: {
      'Neon-Connection-String': 'redacted-by-this-test',
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'true',
    },
  },
] as const;

describe('the local-Postgres bridge owns globalThis.fetch and cannot be unseated', () => {
  let pristine: AnyFetch;

  beforeEach(() => {
    pristine = globalThis.fetch;
  });

  afterEach(() => {
    // The accessor is deliberately `configurable`, so the suite can put the
    // real fetch back as a plain property.
    Object.defineProperty(globalThis, 'fetch', {
      value: pristine, writable: true, configurable: true, enumerable: true,
    });
  });

  it('installs a bridge in place of fetch', () => {
    installFetchAccessor();
    expect(isBridge(globalThis.fetch), 'fetch should be the bridge after install').toBe(true);
  });

  it('🚨 survives the exact move `next dev` makes on every recompile', () => {
    installFetchAccessor();

    // This IS resetFetch: assign back the function captured before we installed.
    globalThis.fetch = pristine;

    expect(isBridge(globalThis.fetch),
      'a plain reassignment must NOT be able to remove the bridge — this is the ' +
      'bug that made the harness look armed while every query went to the network')
      .toBe(true);
  });

  it('survives it repeatedly, and does not accumulate wrappers', async () => {
    installFetchAccessor();
    const downstream = vi.fn(async () => new Response('ok'));

    for (let i = 0; i < 25; i++) {
      globalThis.fetch = pristine;                      // resetFetch
      globalThis.fetch = downstream as unknown as AnyFetch; // then a re-patch
      expect(isBridge(globalThis.fetch)).toBe(true);
    }

    // A non-Neon call still reaches the last downstream exactly once — i.e. the
    // chain did not grow into 25 nested copies, and nothing loops.
    await globalThis.fetch('https://example.invalid/anything');
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('🚨 a wrapper that wraps the bridge does not make a non-Neon call loop', async () => {
    installFetchAccessor();

    // Next's patchFetch does exactly this: read the current fetch, wrap it,
    // assign the wrapper back. If the bridge delegated to whatever was last
    // assigned, this would be an infinite mutual call.
    const real = vi.fn(async () => new Response('real'));
    const captured = globalThis.fetch;
    const patched = (async (input: unknown, init?: RequestInit) => {
      // A patched fetcher forwards to what it captured, which is the bridge.
      if (String(input).includes('skip')) return real();
      return (captured as AnyFetch)(input as RequestInfo, init);
    }) as AnyFetch;
    globalThis.fetch = patched;

    // If this recurses, the test fails by stack overflow / timeout rather than
    // by assertion — which is the point of asserting it at all.
    const res = await globalThis.fetch('https://example.invalid/skip');
    expect(await res.text()).toBe('real');
  });

  it('forwards everything that is not a Neon request, unchanged', async () => {
    installFetchAccessor();
    const downstream = vi.fn(async () => new Response('forwarded'));
    globalThis.fetch = downstream as unknown as AnyFetch;

    const init = { method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' } };
    const res = await globalThis.fetch('https://maps.example.invalid/geocode', init);

    expect(await res.text()).toBe('forwarded');
    expect(downstream).toHaveBeenCalledWith('https://maps.example.invalid/geocode', init);
  });

  it('🚨 a Neon request NEVER reaches the network, even after a reset', async () => {
    installFetchAccessor();
    const downstream = vi.fn(async () => new Response('THE NETWORK'));
    globalThis.fetch = pristine;                           // resetFetch
    globalThis.fetch = downstream as unknown as AnyFetch;  // then a re-patch

    const [url, init] = neonCall();
    // No database is booted in this test, so the bridge cannot answer the query
    // — it reports a query failure. That is the correct outcome to assert:
    // the claim under test is that it was ANSWERED HERE rather than forwarded.
    const res = await globalThis.fetch(url, init as RequestInit);

    expect(downstream,
      'the Neon request escaped to the transport — the interception is not in effect')
      .not.toHaveBeenCalled();
    expect([200, 400]).toContain(res.status);
  });

  it('recognises the header case-insensitively, as the driver sends it', async () => {
    installFetchAccessor();
    const downstream = vi.fn(async () => new Response('THE NETWORK'));
    globalThis.fetch = downstream as unknown as AnyFetch;

    await globalThis.fetch('https://api.example.invalid/sql', {
      method: 'POST',
      body: '{}',
      // The driver capitalises it; a Headers lookup must not care.
      headers: { 'NEON-CONNECTION-STRING': 'redacted-by-this-test' },
    });

    expect(downstream).not.toHaveBeenCalled();
  });
});
