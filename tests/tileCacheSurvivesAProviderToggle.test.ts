// ═══════════════════════════════════════════════════════════════════════════
// 🚨 EVERY IMAGERY-PROVIDER CLICK WIPED THE TILE CACHE — the exact "blind reacquire on a
// display toggle" Ray named, on a metered paid endpoint.
//
// `components/design/DesignStudio.tsx` kept a module-level `TILE_CACHE` keyed `"z/x/y"`, with no
// provider component. That forced the provider button to clear the whole cache, or Google tiles
// would have been drawn as Nearmap:
//
//     setTileProvider(p);
//     TILE_CACHE.clear(); TILE_INFLIGHT.clear(); setMapTiles(new Map());
//
// So Nearmap → Google → Nearmap discarded every Nearmap tile and re-requested all of them:
// `loadTiles` skips a key only when `TILE_CACHE.has(key) && _loaded`, and the clear removed it.
// The needed[] grid is `(ceil(W/256)+3) × (ceil(H/256)+3)`, so on a 1600×900 canvas that is
// 10 × 7 = 70 tile requests per toggle-back. The only thing between that and 70 paid Nearmap
// calls was the proxy's `Cache-Control: private, max-age=86400` — a per-browser HTTP cache,
// defeated by a hard reload, devtools "Disable cache", a private window, cache eviction, or any
// second viewer, and invisible to any quota accounting.
//
// WHY THIS IS A UNIT TEST AND NOT ONLY A BROWSER ONE. The browser spec
// (e2e/nearmap-toggle-does-not-rebuy-imagery.spec.ts) is the real cost proof, but it can only
// measure where imagery actually loads: the Nearmap proxy is admin-gated, this machine has no
// NEARMAP_API_KEY, and the harness's own `X-Dev-Auth` header makes ArcGIS reject ESRI in
// preflight — so no 2D provider loads and nothing enters the cache to be re-used. That spec
// therefore SKIPS with a stated reason rather than passing vacuously. This file asserts the
// mechanism itself, and it discriminates here.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tileKey, parseTileKey } from '@/lib/map/tileKey';

const ROOT = join(__dirname, '..');
const STUDIO = join(ROOT, 'components', 'design', 'DesignStudio.tsx');

/** The file with comments stripped — the comments quote the defect verbatim. */
function studioCode(): string {
  return readFileSync(STUDIO, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
}

describe('🚨 the tile cache key carries the provider', () => {
  it('PRECONDITION: the component imports these very helpers', () => {
    // Otherwise this suite would be testing a module the studio does not use.
    expect(readFileSync(STUDIO, 'utf8'))
      .toMatch(/import \{ tileKey, parseTileKey \} from '@\/lib\/map\/tileKey'/);
  });

  it('🚨 the same tile from two providers is two different cache entries', () => {
    // This is the whole point: with the old `"z/x/y"` key these collided, which is why the
    // cache had to be cleared on every provider change.
    expect(tileKey('nearmap', 21, 100, 200)).not.toBe(tileKey('google', 21, 100, 200));
  });

  it('the key round-trips', () => {
    for (const p of ['auto', 'google', 'esri', 'nearmap']) {
      const k = tileKey(p, 21, 335123, 214567);
      expect(parseTileKey(k)).toEqual({ provider: p, z: 21, x: 335123, y: 214567 });
    }
  });

  it('parses from the END, so a provider id is not confused for a coordinate', () => {
    // Defensive: parsing from the front would read the provider as `z` and yield NaN.
    const parsed = parseTileKey('some/odd/provider/19/1/2');
    expect(parsed).toEqual({ provider: 'some/odd/provider', z: 19, x: 1, y: 2 });
  });

  it('a malformed key is rejected rather than producing NaN coordinates', () => {
    expect(parseTileKey('19/1/2')).toBeNull();        // no provider segment
    expect(parseTileKey('nearmap/a/b/c')).toBeNull(); // non-numeric coordinates
    expect(parseTileKey('')).toBeNull();
  });
});

describe('🚨 a provider toggle no longer discards paid imagery', () => {
  it('🚨 the provider button does not clear the tile cache', () => {
    // Scoped to the provider-button handler so the location-change clears — which are a
    // different decision — are not caught by this.
    const src = studioCode();
    const at = src.indexOf("['auto', 'google', 'esri', 'nearmap']");
    expect(at, 'the provider toggle is gone — this assertion would pass vacuously').toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(handler, 'the provider button still clears TILE_CACHE, so switching back re-buys tiles')
      .not.toMatch(/TILE_CACHE\.clear\(\)/);
    expect(handler, 'the button no longer changes the provider at all').toMatch(/setTileProvider\(p\)/);
  });

  it('the needed[] grid and both readers use the provider-qualified key', () => {
    const src = studioCode();
    expect(src, 'needed[] still builds a bare z/x/y key')
      .not.toMatch(/needed\.push\(`\$\{fetchZoom\}\/\$\{tileX/);
    expect(src).toMatch(/needed\.push\(tileKey\(tileProvider, fetchZoom/);
    // Both the loader and the redraw must parse it; a bare split would read the provider as z.
    expect((src.match(/parseTileKey\(key\)/g) || []).length,
      'one of the two key readers still parses the key by hand').toBeGreaterThanOrEqual(2);
    expect(src, "the old hand parse is still present")
      .not.toMatch(/const \[fz, ftx, fty\] = key\.split\('\/'\)\.map\(Number\)/);
  });

  it("🚨 the redraw skips other providers' tiles, so coexistence is not a visual bug", () => {
    // Keeping every provider's tiles is only safe if the canvas draws just the active one's —
    // otherwise Google tiles would be painted under a Nearmap selection.
    expect(studioCode(), 'the redraw would paint every cached provider on top of each other')
      .toMatch(/if \(kp !== tileProvider\) return;/);
  });
});
