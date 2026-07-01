import { describe, it, expect } from 'vitest';
import { lngToGlobalPx, latToGlobalPx, nearmapTileGrid } from './nearmap';

describe('Nearmap Web-Mercator tile math', () => {
  it('maps lng/lat to global px (known anchors)', () => {
    // lng 0 → half the world; lng -180 → 0; lng 180 → full width.
    const z = 21, world = 256 * 2 ** z;
    expect(lngToGlobalPx(0, z)).toBeCloseTo(world / 2, 3);
    expect(lngToGlobalPx(-180, z)).toBeCloseTo(0, 3);
    expect(lngToGlobalPx(180, z)).toBeCloseTo(world, 3);
    // lat 0 (equator) → half the world in Y.
    expect(latToGlobalPx(0, z)).toBeCloseTo(world / 2, 2);
  });

  it('builds a tile grid that covers the requested WxH centred on the point', () => {
    const g = nearmapTileGrid(38.7009, -90.1487, 21, 1024, 1024);
    // crop region must fit inside the whole-tile canvas
    expect(g.cropLeft).toBeGreaterThanOrEqual(0);
    expect(g.cropTop).toBeGreaterThanOrEqual(0);
    expect(g.cropLeft + g.W).toBeLessThanOrEqual(g.canvasW);
    expect(g.cropTop + g.H).toBeLessThanOrEqual(g.canvasH);
    // every tile placed at a 256-multiple offset, all within the canvas
    for (const t of g.tiles) {
      expect(t.left % 256).toBe(0);
      expect(t.top % 256).toBe(0);
      expect(t.left).toBeLessThan(g.canvasW);
      expect(t.top).toBeLessThan(g.canvasH);
    }
    // 1024px needs ~5 tiles per axis
    const xs = new Set(g.tiles.map(t => t.x)).size;
    expect(xs).toBeGreaterThanOrEqual(4);
    expect(xs).toBeLessThanOrEqual(6);
  });

  it('centres the crop: the point sits at ~W/2,H/2', () => {
    const z = 21, W = 800, H = 800;
    const lat = 38.7009, lng = -90.1487;
    const g = nearmapTileGrid(lat, lng, z, W, H);
    const cx = lngToGlobalPx(lng, z) - g.tx0 * 256;
    const cy = latToGlobalPx(lat, z) - g.ty0 * 256;
    expect(cx - g.cropLeft).toBeCloseTo(W / 2, 0);
    expect(cy - g.cropTop).toBeCloseTo(H / 2, 0);
  });
});
