// ═══════════════════════════════════════════════════════════════════════════
// THE 2D MAP TILE CACHE KEY — and the provider is part of it.
//
// 🚨 WHY THE PROVIDER IS IN THE KEY. `components/design/DesignStudio.tsx` keeps a module-level
// `TILE_CACHE`. Its key used to be `"z/x/y"` with no provider component, which forced the
// imagery-provider button to clear the entire cache on every click — otherwise Google tiles
// would have been drawn as Nearmap:
//
//     setTileProvider(p);
//     TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map());
//
// So Nearmap → Google → Nearmap threw away every Nearmap tile and re-requested all of them:
// `loadTiles` skips a key only when `TILE_CACHE.has(key) && _loaded`, and the clear had removed
// it. The grid is `(ceil(W/256)+3) × (ceil(H/256)+3)`, so on a 1600×900 canvas that is 10 × 7 =
// 70 tile requests per toggle-back — against a METERED, PAID endpoint. The only thing between
// that and 70 paid Nearmap calls was the proxy's `Cache-Control: private, max-age=86400`: a
// per-browser HTTP cache, defeated by a hard reload, devtools "Disable cache", a private window,
// cache eviction, or any second viewer, and invisible to any quota accounting.
//
// With the provider in the key, tiles from different providers coexist, nothing has to be
// discarded in order to switch, and the redraw simply skips keys that are not the active
// provider's. Ray's requirement, verbatim: "Repeated display toggles must not blindly reacquire
// the same imagery."
//
// These live here rather than inside the component so they can be tested directly — see
// tests/tileCacheSurvivesAProviderToggle.test.ts.
// ═══════════════════════════════════════════════════════════════════════════

export interface ParsedTileKey {
  provider: string;
  z: number;
  x: number;
  y: number;
}

/** The cache key for one tile of one provider. */
export function tileKey(provider: string, z: number, x: number, y: number): string {
  return `${provider}/${z}/${x}/${y}`;
}

/**
 * Read a key back, or null if it is not one.
 *
 * Parsed from the END so a provider id containing a '/' cannot shift the coordinates, and
 * non-numeric coordinates are rejected rather than becoming NaN — a NaN `z` would silently fail
 * the redraw's `fz !== fetchZoom` check and the tile would never be drawn.
 */
export function parseTileKey(key: string): ParsedTileKey | null {
  const parts = key.split('/');
  if (parts.length < 4) return null;
  const [zs, xs, ys] = parts.slice(-3);
  const z = Number(zs), x = Number(xs), y = Number(ys);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (zs === '' || xs === '' || ys === '') return null;
  const provider = parts.slice(0, -3).join('/');
  if (!provider) return null;
  return { provider, z, x, y };
}
