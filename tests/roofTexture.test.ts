/**
 * tests/roofTexture.test.ts
 *
 * The aerial texture must line up with the roof face, or the house gets
 * somebody else's roof painted on it — which looks worse than a flat colour
 * and is harder to notice is wrong.
 *
 * The alignment rests entirely on the web-mercator tile math below, so that is
 * what gets pinned. The canvas compositing needs a DOM and is exercised in the
 * browser instead.
 */

import { describe, it, expect } from 'vitest';
import {
  lngToTileX,
  latToTileY,
  tileRangeForBounds,
  pickZoomForBounds,
  cropRectForBounds,
  boundsOf,
  esriTileUrl,
} from '@/lib/3d/roofTexture';

// Pocahontas IL — the rural address Google Solar imagery does NOT cover.
const LAT = 38.8306;
const LNG = -89.5343;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

function roofRing(widthM: number, depthM: number) {
  const dLng = widthM / 2 / mPerDegLng;
  const dLat = depthM / 2 / M_PER_DEG_LAT;
  return [
    { lat: LAT - dLat, lng: LNG - dLng },
    { lat: LAT - dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG - dLng },
  ];
}

describe('web mercator tile math', () => {
  it('matches known reference values at zoom 0 and 1', () => {
    expect(lngToTileX(-180, 0)).toBeCloseTo(0, 9);
    expect(lngToTileX(0, 1)).toBeCloseTo(1, 9);
    expect(lngToTileX(180, 0)).toBeCloseTo(1, 9);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 9); // equator is the middle
  });

  it('tile Y increases SOUTHWARD — the inversion that flips a texture if missed', () => {
    const z = 18;
    expect(latToTileY(LAT + 0.001, z)).toBeLessThan(latToTileY(LAT, z));
    expect(latToTileY(LAT - 0.001, z)).toBeGreaterThan(latToTileY(LAT, z));
  });

  it('tile X increases EASTWARD', () => {
    const z = 18;
    expect(lngToTileX(LNG + 0.001, z)).toBeGreaterThan(lngToTileX(LNG, z));
  });

  it('a tile range covers its bounds on every side', () => {
    const b = boundsOf(roofRing(16, 10))!;
    const z = 19;
    const { x0, x1, y0, y1 } = tileRangeForBounds(b, z);
    expect(x0).toBeLessThanOrEqual(Math.floor(lngToTileX(b.west, z)));
    expect(x1).toBeGreaterThanOrEqual(Math.floor(lngToTileX(b.east, z)));
    expect(y0).toBeLessThanOrEqual(Math.floor(latToTileY(b.north, z)));
    expect(y1).toBeGreaterThanOrEqual(Math.floor(latToTileY(b.south, z)));
  });
});

describe('zoom selection', () => {
  it('picks the sharpest zoom that stays within the tile budget', () => {
    const b = boundsOf(roofRing(16, 10))!;
    const z = pickZoomForBounds(b, 19, 24);
    expect(z).toBe(19); // a house at z19 is a couple of tiles
    const { x0, x1, y0, y1 } = tileRangeForBounds(b, z);
    expect((x1 - x0 + 1) * (y1 - y0 + 1)).toBeLessThanOrEqual(24);
  });

  it('backs off for a large building rather than firing hundreds of requests', () => {
    const huge = boundsOf(roofRing(4000, 4000))!;
    const z = pickZoomForBounds(huge, 19, 24);
    expect(z).toBeLessThan(19);
    const { x0, x1, y0, y1 } = tileRangeForBounds(huge, z);
    expect((x1 - x0 + 1) * (y1 - y0 + 1)).toBeLessThanOrEqual(24);
  });

  it('never returns a zoom above the cap', () => {
    const b = boundsOf(roofRing(8, 6))!;
    expect(pickZoomForBounds(b, 17, 24)).toBeLessThanOrEqual(17);
  });
});

describe('crop rectangle — where texture alignment actually lives', () => {
  it('the crop sits inside the composed mosaic', () => {
    const b = boundsOf(roofRing(16, 10))!;
    const z = pickZoomForBounds(b);
    const { sx, sy, sw, sh, mosaicW, mosaicH } = cropRectForBounds(b, z);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sw).toBeGreaterThan(0);
    expect(sh).toBeGreaterThan(0);
    expect(sx + sw).toBeLessThanOrEqual(mosaicW + 1e-6);
    expect(sy + sh).toBeLessThanOrEqual(mosaicH + 1e-6);
  });

  it('crop aspect equals the GROUND aspect — the texture is not stretched', () => {
    // Worth stating precisely, because it is the reason this works with no
    // custom texture coordinates: mercator stretches Y by 1/cos(lat), and the
    // metres-per-degree-longitude conversion shrinks X by cos(lat). The two
    // cancel exactly, so a crop taken in tile space has the same aspect ratio
    // as the roof has on the ground. If they ever stopped cancelling, every
    // roof texture would be subtly stretched — visible, but easy to explain
    // away as "the imagery is just like that".
    for (const [widthM, depthM] of [[16, 10], [30, 8], [8, 30], [12, 12]]) {
      const b = boundsOf(roofRing(widthM, depthM), 0)!;
      const z = pickZoomForBounds(b);
      const { sw, sh } = cropRectForBounds(b, z);
      expect(sw / sh).toBeCloseTo(widthM / depthM, 2);
    }
  });

  it('a wider face yields a wider crop', () => {
    const wide = boundsOf(roofRing(30, 8), 0)!;
    const tall = boundsOf(roofRing(8, 30), 0)!;
    const zw = pickZoomForBounds(wide), zt = pickZoomForBounds(tall);
    const cw = cropRectForBounds(wide, zw), ct = cropRectForBounds(tall, zt);
    expect(cw.sw / cw.sh).toBeGreaterThan(1);
    expect(ct.sw / ct.sh).toBeLessThan(1);
  });
});

describe('bounds', () => {
  it('pads outward so the face is not cut off at its own edge', () => {
    const ring = roofRing(16, 10);
    const b = boundsOf(ring, 0.02)!;
    expect(b.north).toBeGreaterThan(Math.max(...ring.map(v => v.lat)));
    expect(b.south).toBeLessThan(Math.min(...ring.map(v => v.lat)));
    expect(b.east).toBeGreaterThan(Math.max(...ring.map(v => v.lng)));
    expect(b.west).toBeLessThan(Math.min(...ring.map(v => v.lng)));
  });

  it('returns null for degenerate rings instead of a zero-area texture', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }, { lat: LAT, lng: LNG }])).toBeNull();
    expect(boundsOf([
      { lat: LAT, lng: LNG }, { lat: NaN, lng: LNG }, { lat: LAT + 0.001, lng: LNG + 0.001 },
    ])).toBeNull();
  });
});

describe('tile URL', () => {
  it('uses ESRI z/y/x order — x and y swapped gives a roof from elsewhere', () => {
    expect(esriTileUrl(19, 123, 456)).toContain('/MapServer/tile/19/456/123');
  });

  it('needs no API key, which is why it works at a rural address', () => {
    const url = esriTileUrl(19, 1, 2);
    expect(url).not.toContain('key=');
    expect(url).not.toContain('token');
    expect(url.startsWith('https://')).toBe(true);
  });
});
