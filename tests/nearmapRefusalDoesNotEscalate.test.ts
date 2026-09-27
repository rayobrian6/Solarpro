// ═══════════════════════════════════════════════════════════════════════════
// 🚨 BEING OVER QUOTA TRIGGERED TWO MORE FULL TILE GRIDS.
//
// `lib/aerial/nearmap.ts` fetches Nearmap Vert tiles and stitches them. Its zoom loop treated
// "zero usable tiles" as a ZOOM problem:
//
//     const zooms = opts.zoom ? [opts.zoom] : [21, 20, 19];
//     ...
//     if (composites.length === 0) continue;      // <- retried at z20, then z19
//
// but the function's own closing comment already knew the other causes: "403 = key
// invalid/unauthorized for Vert tiles; 429 = over quota/rate limit". A 403 or 429 makes `r.ok`
// false for every tile, so `composites.length === 0` and the retry fired.
//
// The arithmetic, on the real call the permit route makes (`widthPx: 1440, heightPx: 810`):
// a 1440×810 frame spans ceil(1440/256)=6 (worst case 7) tile columns and ceil(810/256)=4
// (worst case 5) rows, so 24–35 tiles per grid. Three zooms is up to ~105 live paid tile GETs
// on a request that had ALREADY BEEN REFUSED — and `fetchAerialRoofData` is called twice per
// permit generate, so up to ~210. Nothing remembered the refusal either, so the identical storm
// repeated on every subsequent generate for that address.
//
// `lib/providers/types.ts` states the rule this broke: a metered external must never fail open.
// The AI half of this same module has had a durable guard for a while — `nearmapCache.ts` writes
// an EMPTY_SENTINEL so "no coverage / error" never retries — and the IMAGERY half was never
// given one.
//
// WHAT IS ASSERTED HERE. Every tile request is counted through a stubbed `fetch`, so the test is
// free and deterministic and never touches Nearmap:
//   · a REFUSAL (401/403/429) costs ONE grid, not three, and never retries a lower zoom;
//   · a second call for the same location after a refusal costs ZERO requests;
//   · a COVERAGE GAP (404 / blank tiles) still escalates, because for that a lower zoom is a
//     legitimate remedy and suppressing it would be a different defect.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 🚨 ONLY THE PRE-EXISTING SYMBOLS ARE IMPORTED STATICALLY.
//
// The refusal memory is new, so importing it at the top would make this whole file fail to
// RESOLVE against the unrepaired module — and "the module did not load" is not a proof that the
// escalation was fixed. It would fail for the wrong reason and tell us nothing about the request
// count, which is the thing that costs money. The count assertions below therefore depend only
// on `fetchNearmapStaticAerial` and the pure `nearmapTileGrid`, and the two cases that need the
// refusal memory reach for it dynamically and say so if it is missing.
import { fetchNearmapStaticAerial, nearmapTileGrid } from '@/lib/aerial/nearmap';

type RefusalApi = {
  nearmapImageryRefusal?: (lat: number, lng: number) => { kinds: string; ageMs: number } | null;
  _resetNearmapImageryRefusals?: () => void;
};
const refusalApi = async (): Promise<RefusalApi> =>
  (await import('@/lib/aerial/nearmap')) as unknown as RefusalApi;
/** The recorded refusal, or undefined when the module has no refusal memory at all. */
async function refusalFor(lat: number, lng: number) {
  const api = await refusalApi();
  if (typeof api.nearmapImageryRefusal !== 'function') return undefined;
  return api.nearmapImageryRefusal(lat, lng);
}

/** The frame the permit route asks for — lib/permit/sections/sitePlan.ts. */
const W = 1440, H = 810;
const LAT = 38.70615, LNG = -90.22660;

const realFetch = globalThis.fetch;
let tileRequests: string[] = [];

/** Count tile GETs and answer every one with `status`. */
function stubTiles(status: number, body: Uint8Array = new Uint8Array(2048)) {
  tileRequests = [];
  globalThis.fetch = (async (url: unknown) => {
    tileRequests.push(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => body.buffer.slice(0),
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(async () => {
  process.env.NEARMAP_API_KEY = 'test-key-not-a-real-credential';
  const api = await refusalApi();
  api._resetNearmapImageryRefusals?.();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  (await refusalApi())._resetNearmapImageryRefusals?.();
});

describe('🚨 PRECONDITION — one grid is a lot of paid requests', () => {
  it('the permit frame really is 24–35 tiles at z21', () => {
    // If this ever shrinks to a couple of tiles the finding is about a different cost.
    const n = nearmapTileGrid(LAT, LNG, 21, W, H).tiles.length;
    expect(n).toBeGreaterThanOrEqual(24);
    expect(n).toBeLessThanOrEqual(35);
  });
});

describe('🚨 a refusal costs ONE grid, not three', () => {
  for (const status of [429, 403, 401]) {
    it(`🚨 ${status} does not retry lower zooms`, async () => {
      stubTiles(status);
      const out = await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
      expect(out, 'a refused fetch must not return an image').toBeNull();

      const oneGrid = nearmapTileGrid(LAT, LNG, 21, W, H).tiles.length;
      expect(tileRequests.length,
        `${status} cost ${tileRequests.length} requests; one grid is ${oneGrid}, and retrying `
        + `z20 and z19 would be about ${oneGrid * 3}`).toBe(oneGrid);
      // And it must be the FIRST zoom only — no z20/z19 in the URLs.
      expect(tileRequests.some(u => /\/20\/|\/19\//.test(u)),
        'a lower zoom was requested after a refusal').toBe(false);
    });
  }

  it('🚨 and the refusal is remembered, so the next call costs NOTHING', async () => {
    stubTiles(429);
    await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    const afterFirst = tileRequests.length;
    expect(afterFirst).toBeGreaterThan(0);

    // The permit route calls fetchAerialRoofData TWICE per generate — this is that second call.
    tileRequests = [];
    const second = await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    expect(second).toBeNull();
    expect(tileRequests.length,
      `the second call after a refusal issued ${tileRequests.length} more paid requests`).toBe(0);

    const refusal = await refusalFor(LAT, LNG);
    expect(refusal, 'the module has no refusal memory, or the refusal was not recorded').toBeTruthy();
    expect(refusal!.kinds).toContain('429');
  });

  it('the memory is per-location — a different address is still attempted', async () => {
    stubTiles(429);
    await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    tileRequests = [];
    await fetchNearmapStaticAerial(LAT + 0.05, LNG + 0.05, { widthPx: W, heightPx: H });
    expect(tileRequests.length,
      'a refusal at one address suppressed a different address').toBeGreaterThan(0);
  });
});

describe('a coverage gap is a real zoom problem and still escalates', () => {
  it('404 tiles retry the lower zooms', async () => {
    // Suppressing this would be a different defect: for a rural address with no z21 coverage,
    // z20 and z19 are the legitimate remedy and the whole reason the loop exists.
    stubTiles(404);
    const out = await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    expect(out).toBeNull();
    expect(tileRequests.some(u => /\/20\//.test(u)), 'z20 was not attempted after a 404').toBe(true);
    expect(tileRequests.some(u => /\/19\//.test(u)), 'z19 was not attempted after a 404').toBe(true);
    // And a coverage gap is NOT remembered as a refusal — it is not an authorization problem.
    expect(await refusalFor(LAT, LNG) ?? null).toBeNull();
  });

  it('blank placeholder tiles (200 but tiny) also still escalate', async () => {
    // nearmap.ts treats a body under 500 bytes as a blank/placeholder tile.
    stubTiles(200, new Uint8Array(100));
    await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    expect(tileRequests.some(u => /\/19\//.test(u)), 'z19 was not attempted after blank tiles').toBe(true);
    expect(await refusalFor(LAT, LNG) ?? null).toBeNull();
  });
});

describe('no key is not a refusal', () => {
  it('a missing NEARMAP_API_KEY costs zero requests and is not remembered as a refusal', async () => {
    delete process.env.NEARMAP_API_KEY;
    stubTiles(200);
    const out = await fetchNearmapStaticAerial(LAT, LNG, { widthPx: W, heightPx: H });
    expect(out).toBeNull();
    expect(tileRequests.length, 'tiles were requested without a key').toBe(0);
    // Not a refusal: the moment a key is configured the address must be attempted.
    expect(await refusalFor(LAT, LNG) ?? null).toBeNull();
  });
});
