/** @vitest-environment jsdom */
// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE 3D STUDIO SHOWS THE NEARMAP IMAGERY THIS SESSION HAS ALREADY PAID FOR — AND BUYS NONE.
//
// Ray, live: "I am in the 3D environment right now. There is no visible Nearmap toggle. I can
// still only access Nearmap from the 2D environment." Two things were wrong. The control was
// unfindable (fixed in components/3d/mapSource/ImageryToggle.tsx, proved in the browser), and
// there was nothing for it to show unless the project had generated a permit package.
//
// The 2D canvas has been fetching Nearmap Vert tiles through the metered proxy all along and
// keeping them in a module-level cache. Those pixels are bought. The 3D studio could not see
// them only because the cache was a private const inside DesignStudio.tsx. It now lives in
// lib/map/tileCache.ts and both read it.
//
// THE TWO RULES THIS FILE HOLDS THE COMPOSER TO:
//
//   1. "Do not build a second Nearmap acquisition path... Do not make the visual toggle a
//      billing event." — the composer must NEVER issue a request. It returns null when the
//      tiles are not already here.
//   2. "Never masquerade one provider as another." — the cache KEY records what was asked for;
//      `_source` records what came back. On a 403 the 2D fetcher substitutes ESRI and stores it
//      under the Nearmap key. Composing from the key alone would paint ESRI on the ground under
//      a Nearmap label.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TILE_CACHE, TILE_INFLIGHT, TILE_CACHE_MAX, evictTileCache,
  largestCompleteSquare, composeCachedTiles, usableTilesByZoom,
} from '@/lib/map/tileCache';
import { tileKey } from '@/lib/map/tileKey';
import {
  tileRangeBounds, globalPxToLng, globalPxToLat, lngToGlobalPx, latToGlobalPx, TILE_SIZE,
} from '@/lib/map/webMercator';

const Z = 21;
const SITE = { lat: 38.70615, lng: -90.22660 };

/** A stand-in for a decoded tile image, stamped the way `loadTiles` stamps one. */
function fakeTile(source: string): HTMLImageElement {
  const img = { naturalWidth: 256, naturalHeight: 256, _loaded: true, _source: source };
  return img as unknown as HTMLImageElement;
}

function seed(provider: string, source: string, x0: number, y0: number, n: number) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      TILE_CACHE.set(tileKey(provider, Z, x0 + i, y0 + j), fakeTile(source));
    }
  }
}

describe('🚨 the largest HOLE-FREE square of tiles', () => {
  const has = (set: Set<string>) => (x: number, y: number) => set.has(`${x}/${y}`);

  it('is just the centre when nothing surrounds it', () => {
    expect(largestCompleteSquare(has(new Set(['5/5'])), 5, 5, 4))
      .toEqual({ x0: 5, y0: 5, size: 1 });
  });

  it('is null when the centre itself is missing — not an empty rectangle somewhere else', () => {
    expect(largestCompleteSquare(has(new Set(['6/6'])), 5, 5, 4)).toBeNull();
  });

  it('grows to the full ring and stops at the first HOLE', () => {
    // A complete 5x5 with one tile of the OUTER ring missing: the answer must be the 3x3, not
    // the bounding box. A composite that spanned the hole would draw blank ground, and an
    // operator cannot tell a missing tile from a flat roof.
    const set = new Set<string>();
    for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) set.add(`${x}/${y}`);
    set.delete('3/7');
    expect(largestCompleteSquare(has(set), 5, 5, 8)).toEqual({ x0: 4, y0: 4, size: 3 });
  });

  it('respects the radius cap even when more tiles are available', () => {
    const set = new Set<string>();
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) set.add(`${x}/${y}`);
    expect(largestCompleteSquare(has(set), 5, 5, 2)).toEqual({ x0: 3, y0: 3, size: 5 });
  });
});

describe('🚨 a whole-tile rectangle knows exactly what ground it covers', () => {
  it('its edges are the tile edges, with no crop quantisation', () => {
    const b = tileRangeBounds(Z, 100, 200, 3, 3)!;
    expect(b.west).toBeCloseTo(globalPxToLng(100 * TILE_SIZE, Z), 12);
    expect(b.east).toBeCloseTo(globalPxToLng(103 * TILE_SIZE, Z), 12);
    expect(b.north).toBeCloseTo(globalPxToLat(200 * TILE_SIZE, Z), 12);
    expect(b.south).toBeCloseTo(globalPxToLat(203 * TILE_SIZE, Z), 12);
    expect(b.north).toBeGreaterThan(b.south);
    expect(b.east).toBeGreaterThan(b.west);
  });

  it('contains the point the tiles were chosen around', () => {
    const tx = Math.floor(lngToGlobalPx(SITE.lng, Z) / TILE_SIZE);
    const ty = Math.floor(latToGlobalPx(SITE.lat, Z) / TILE_SIZE);
    const b = tileRangeBounds(Z, tx - 1, ty - 1, 3, 3)!;
    expect(SITE.lng).toBeGreaterThan(b.west);
    expect(SITE.lng).toBeLessThan(b.east);
    expect(SITE.lat).toBeGreaterThan(b.south);
    expect(SITE.lat).toBeLessThan(b.north);
  });

  it('refuses nonsense rather than returning a plausible rectangle', () => {
    expect(tileRangeBounds(Z, 1, 1, 0, 3)).toBeNull();
    expect(tileRangeBounds(NaN, 1, 1, 3, 3)).toBeNull();
    expect(tileRangeBounds(99, 1, 1, 3, 3)).toBeNull();
  });
});

describe('🚨 composing costs nothing, ever', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TILE_CACHE.clear(); TILE_INFLIGHT.clear();
    fetchSpy = vi.fn(() => Promise.reject(new Error('the composer must never fetch')));
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
  });
  afterEach(() => { TILE_CACHE.clear(); TILE_INFLIGHT.clear(); });

  it('returns null on an empty cache without asking for a single tile', () => {
    expect(composeCachedTiles('nearmap', SITE)).toBeNull();
    expect(fetchSpy, 'the composer issued a network request').not.toHaveBeenCalled();
  });

  // 🚨 THESE ASSERT ON `usableTilesByZoom`, NOT ON `composeCachedTiles`, AND THAT IS DELIBERATE.
  //
  // The first version of this block called the composer and expected null. It passed with the
  // provider filter DELETED — because jsdom has no 2D canvas context, so the composer returns
  // null for a reason that has nothing to do with the assertion. A blind test. The decision that
  // keeps the label honest is the tile selection, so the tile selection is what is measured.
  const usable = (provider: string) => {
    let n = 0;
    usableTilesByZoom(provider).forEach(g => { n += g.size; });
    return n;
  };

  it('🚨 refuses ESRI pixels that were cached under a NEARMAP key', () => {
    // This is what the 2D canvas does on a 403: `tryEsri()` then `commitTile('esri')`, stored
    // under the key that was REQUESTED. Composing from the key alone would show ESRI imagery
    // with a Nearmap label on it.
    const tx = Math.floor(lngToGlobalPx(SITE.lng, Z) / TILE_SIZE);
    const ty = Math.floor(latToGlobalPx(SITE.lat, Z) / TILE_SIZE);
    seed('nearmap', 'esri', tx - 1, ty - 1, 3);
    expect(TILE_CACHE.size, 'the fixture did not populate the cache').toBe(9);
    expect(usable('nearmap'),
      'tiles the fetcher recorded as ESRI were accepted as Nearmap pixels').toBe(0);
    expect(composeCachedTiles('nearmap', SITE)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts the same tiles once they really did come from Nearmap', () => {
    // The other half of the discrimination: with `_source` set to nearmap the very same nine
    // tiles ARE usable, so the test above is measuring provenance and not simply refusing
    // everything.
    const tx = Math.floor(lngToGlobalPx(SITE.lng, Z) / TILE_SIZE);
    const ty = Math.floor(latToGlobalPx(SITE.lat, Z) / TILE_SIZE);
    seed('nearmap', 'nearmap', tx - 1, ty - 1, 3);
    expect(usable('nearmap')).toBe(9);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores another provider entirely', () => {
    const tx = Math.floor(lngToGlobalPx(SITE.lng, Z) / TILE_SIZE);
    const ty = Math.floor(latToGlobalPx(SITE.lat, Z) / TILE_SIZE);
    seed('google', 'google', tx - 1, ty - 1, 3);
    expect(usable('nearmap')).toBe(0);
    expect(usable('google')).toBe(9);
    expect(composeCachedTiles('nearmap', SITE)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a tile that never decoded is not usable pixels', () => {
    const tx = Math.floor(lngToGlobalPx(SITE.lng, Z) / TILE_SIZE);
    const ty = Math.floor(latToGlobalPx(SITE.lat, Z) / TILE_SIZE);
    TILE_CACHE.set(tileKey('nearmap', Z, tx, ty),
      { naturalWidth: 0, naturalHeight: 0, _loaded: false, _source: 'nearmap' } as unknown as HTMLImageElement);
    expect(usable('nearmap')).toBe(0);
    expect(composeCachedTiles('nearmap', SITE)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the cache the 2D canvas fills still behaves as it did', () => {
  beforeEach(() => { TILE_CACHE.clear(); TILE_INFLIGHT.clear(); });
  afterEach(() => { TILE_CACHE.clear(); TILE_INFLIGHT.clear(); });

  it('evicts oldest-first above the cap, and drops the inflight marker with it', () => {
    for (let i = 0; i < TILE_CACHE_MAX + 10; i++) {
      const k = tileKey('nearmap', Z, i, 0);
      TILE_CACHE.set(k, fakeTile('nearmap'));
      TILE_INFLIGHT.add(k);
    }
    evictTileCache();
    expect(TILE_CACHE.size).toBe(TILE_CACHE_MAX);
    // The first ten inserted are the ones gone — insertion order, as before.
    expect(TILE_CACHE.has(tileKey('nearmap', Z, 0, 0))).toBe(false);
    expect(TILE_INFLIGHT.has(tileKey('nearmap', Z, 0, 0))).toBe(false);
    expect(TILE_CACHE.has(tileKey('nearmap', Z, TILE_CACHE_MAX + 9, 0))).toBe(true);
  });

  it('a provider switch does not have to throw anything away — the key carries the provider', () => {
    TILE_CACHE.set(tileKey('nearmap', Z, 5, 5), fakeTile('nearmap'));
    TILE_CACHE.set(tileKey('google', Z, 5, 5), fakeTile('google'));
    expect(TILE_CACHE.size, 'the two providers collided on one key').toBe(2);
  });
});
