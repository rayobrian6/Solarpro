// ═══════════════════════════════════════════════════════════════════════════
// THE BROWSER'S MAP-TILE CACHE — ONE CACHE, AND NOW TWO READERS.
//
// 🚨 WHY IT MOVED OUT OF DesignStudio.tsx.
//
// Ray, live: "I am in the 3D environment right now. There is no visible Nearmap toggle. I can
// still only access Nearmap from the 2D environment." The 2D canvas has always been able to show
// Nearmap — it fetches Vert tiles through `/api/admin/nearmap-tile/{z}/{x}/{y}` and keeps them in
// a module-level cache. Those tiles are PAID FOR and they are already in memory. The 3D studio
// could not see them only because the cache was a private const inside the 2D component.
//
// So the cache lives here and both read it. The 2D canvas fills it exactly as before; the 3D
// studio composes what is already there onto the ground as a reference surface. That satisfies
// the two standing rules at once — "Do not build a second Nearmap acquisition path. Nearmap is
// expensive." and "Do not make the visual toggle a billing event." — because composing costs
// nothing at all: `composeCachedTiles` issues no request of any kind and returns null rather
// than fetching anything when the tiles are not already here.
//
// The key carries the provider (lib/map/tileKey.ts), so Google tiles and Nearmap tiles coexist
// and a composite is never built out of the wrong provider's pixels.
// ═══════════════════════════════════════════════════════════════════════════

import { parseTileKey } from './tileKey';
import { TILE_SIZE, tileRangeBounds, type ImageBounds } from './webMercator';

/** Tile images keyed `provider/z/x/y`. Values carry `_loaded` / `_source` from the fetcher. */
export const TILE_CACHE: Map<string, HTMLImageElement> = new Map();

/** Keys with a request in flight — prevents duplicate fetches of the same tile. */
export const TILE_INFLIGHT: Set<string> = new Set();

export const TILE_CACHE_MAX = 512;   // LRU eviction above this count

export function evictTileCache(): void {
  if (TILE_CACHE.size <= TILE_CACHE_MAX) return;
  const toDelete = TILE_CACHE.size - TILE_CACHE_MAX;
  let deleted = 0;
  for (const key of TILE_CACHE.keys()) {
    TILE_CACHE.delete(key);
    TILE_INFLIGHT.delete(key);
    if (++deleted >= toDelete) break;
  }
}

/**
 * THE BIGGEST HOLE-FREE SQUARE OF TILES AROUND A CENTRE.
 *
 * 🚨 A COMPOSITE WITH HOLES IN IT IS A LIE ABOUT THE GROUND. The cache holds whatever the 2D
 * canvas happened to need — a ragged region that depends on where the user panned. Taking its
 * bounding box and drawing what exists would leave blank squares over real ground, and an
 * operator tracing a roof against a reference photo cannot tell a missing tile from a flat roof.
 *
 * So the composite is grown outward from the centre and stops at the first incomplete ring.
 * Pure, and separated from the canvas work so it can be proved without a DOM.
 *
 * @param has         does a tile exist at (x, y)
 * @param cx, cy      the centre tile
 * @param maxRadius   hard cap on the half-width, in tiles
 * @returns the square as {x0, y0, size} in tiles, or null if the centre itself is missing
 */
export function largestCompleteSquare(
  has: (x: number, y: number) => boolean,
  cx: number, cy: number, maxRadius: number,
): { x0: number; y0: number; size: number } | null {
  if (!has(cx, cy)) return null;
  let r = 0;
  while (r < maxRadius) {
    const next = r + 1;
    let complete = true;
    for (let x = cx - next; x <= cx + next && complete; x++) {
      for (let y = cy - next; y <= cy + next; y++) {
        // Only the new ring has to be checked; the interior was complete at the last step.
        if (Math.abs(x - cx) !== next && Math.abs(y - cy) !== next) continue;
        if (!has(x, y)) { complete = false; break; }
      }
    }
    if (!complete) break;
    r = next;
  }
  return { x0: cx - r, y0: cy - r, size: 2 * r + 1 };
}

export interface CachedTileComposite {
  /** The stitched image, as a data URL. */
  dataUrl: string;
  /** Exactly the ground it covers — whole tiles, so no crop quantisation. */
  bounds: ImageBounds;
  zoom: number;
  tileCount: number;
  widthPx: number;
  heightPx: number;
}

/** A loaded, drawable tile image. `_loaded` is stamped by the fetcher on a real decode. */
function drawable(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && (img as unknown as { _loaded?: boolean })._loaded === true
    && img.naturalWidth > 0 && img.naturalHeight > 0;
}

/**
 * 🚨 THE KEY SAYS WHAT WAS ASKED FOR. `_source` SAYS WHAT ARRIVED.
 *
 * They are not always the same, and the difference is a masquerade waiting to happen. In
 * `DesignStudio.loadTiles` the cache key is built from the REQUESTED provider, and on a Nearmap
 * request that fails — no key, no coverage, a 403 for a non-admin — `img.onerror` runs
 * `tryEsri()` and `commitTile('esri')` stores the ESRI image under the `nearmap/z/x/y` key it
 * already had. The 2D canvas is honest about that (its badge reads ✓E), but a composite built
 * from those keys alone would put ESRI pixels on the ground under a label that says Nearmap —
 * "Never masquerade one provider as another", committed in the quietest possible way.
 *
 * So a tile counts only if the fetcher recorded that THIS provider is what actually came back.
 */
function cameFrom(img: HTMLImageElement, provider: string): boolean {
  return (img as unknown as { _source?: string })._source === provider;
}

/**
 * COMPOSE THE TILES THIS SESSION HAS ALREADY PAID FOR — AND FETCH NOTHING.
 *
 * Returns null when the cache holds nothing usable for this provider. It never requests a tile,
 * which is the whole point: the 3D imagery toggle must not be able to spend.
 *
 * @param provider  the tile provider whose pixels to use, e.g. 'nearmap'
 * @param centre    optional lat/lng to grow the composite around; the median tile otherwise
 * @param maxPx     cap on the composite's edge length in pixels (keeps the data URL sane)
 */
/**
 * THE TILES THAT REALLY ARE THIS PROVIDER'S, GROUPED BY ZOOM — `"x/y"` → image.
 *
 * Separated from the drawing so the decision that matters can be proved without a canvas. It is
 * the decision that keeps a Nearmap label honest: a key names what was REQUESTED, `_source`
 * names what arrived, and a tile counts only when both say this provider.
 */
export function usableTilesByZoom(provider: string): Map<number, Map<string, HTMLImageElement>> {
  const byZoom = new Map<number, Map<string, HTMLImageElement>>();
  TILE_CACHE.forEach((img, key) => {
    const p = parseTileKey(key);
    if (!p || p.provider !== provider) return;
    if (!drawable(img) || !cameFrom(img, provider)) return;
    let g = byZoom.get(p.z);
    if (!g) { g = new Map(); byZoom.set(p.z, g); }
    g.set(`${p.x}/${p.y}`, img);
  });
  return byZoom;
}

export function composeCachedTiles(
  provider: string,
  centre?: { lat: number; lng: number } | null,
  maxPx = 2048,
): CachedTileComposite | null {
  if (typeof document === 'undefined') return null;

  const byZoom = usableTilesByZoom(provider);
  if (byZoom.size === 0) return null;

  // The sharpest zoom that actually has tiles — a reference photo exists to be zoomed into.
  const zoom = Math.max(...byZoom.keys());
  const grid = byZoom.get(zoom)!;

  // Centre tile: the one covering the requested point if it is cached, otherwise the median of
  // what is there (which is where the user has been looking).
  const coords = [...grid.keys()].map(k => {
    const [x, y] = k.split('/').map(Number);
    return { x, y };
  });
  let cx: number, cy: number;
  const want = centre && Number.isFinite(centre.lat) && Number.isFinite(centre.lng)
    ? {
        x: Math.floor(((centre.lng + 180) / 360) * 2 ** zoom),
        y: Math.floor((0.5 - Math.log(
              (1 + Math.sin(centre.lat * Math.PI / 180)) /
              (1 - Math.sin(centre.lat * Math.PI / 180))) / (4 * Math.PI)) * 2 ** zoom),
      }
    : null;
  if (want && grid.has(`${want.x}/${want.y}`)) {
    cx = want.x; cy = want.y;
  } else {
    const xs = coords.map(c => c.x).sort((a, b) => a - b);
    const ys = coords.map(c => c.y).sort((a, b) => a - b);
    cx = xs[Math.floor(xs.length / 2)];
    cy = ys[Math.floor(ys.length / 2)];
  }

  const maxRadius = Math.max(0, Math.floor((Math.floor(maxPx / TILE_SIZE) - 1) / 2));
  const square = largestCompleteSquare((x, y) => grid.has(`${x}/${y}`), cx, cy, maxRadius);
  if (!square) return null;

  const bounds = tileRangeBounds(zoom, square.x0, square.y0, square.size, square.size);
  if (!bounds) return null;

  const px = square.size * TILE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let drawn = 0;
  for (let i = 0; i < square.size; i++) {
    for (let j = 0; j < square.size; j++) {
      const img = grid.get(`${square.x0 + i}/${square.y0 + j}`);
      if (!img) continue;
      try { ctx.drawImage(img, i * TILE_SIZE, j * TILE_SIZE, TILE_SIZE, TILE_SIZE); drawn++; } catch { /* tainted */ }
    }
  }
  if (drawn !== square.size * square.size) return null;

  let dataUrl: string;
  // A cross-origin tile would taint the canvas and throw here. Every provider this app uses is
  // proxied same-origin, so that is a real failure rather than something to paper over.
  try { dataUrl = canvas.toDataURL('image/jpeg', 0.9); } catch { return null; }
  if (!dataUrl.startsWith('data:image/')) return null;

  return { dataUrl, bounds, zoom, tileCount: drawn, widthPx: px, heightPx: px };
}
