import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { nearmapTileGrid, lngToGlobalPx, latToGlobalPx, stitchAndCropTiles } from './nearmap';

// Regression for the "house not centred" planset bug: in a single sharp chain,
// .composite() is applied at the END of the pipeline (after .extract()), so the
// old one-pass stitch cropped the BLANK canvas and pasted tiles un-shifted —
// the scene rendered offset by (cropLeft, cropTop), i.e. up to 255px / ~15m.
// stitchAndCropTiles must place every ground pixel where the tile math says.

const LAT = 38.7061396, LNG = -90.0462533; // 3 Melvin Dr — the real repro case
const Z = 21, W = 640, H = 360;

/** Deterministic solid colour for tile (x,y). 16-step spacing survives JPEG. */
const tileColor = (x: number, y: number) => ({ r: (x % 16) * 16, g: (y % 16) * 16, b: 128 });

describe('stitchAndCropTiles', () => {
  it('renders each ground pixel from the tile the Web-Mercator math assigns it', async () => {
    const grid = nearmapTileGrid(LAT, LNG, Z, W, H);
    // sanity: this centre has a NON-ZERO crop offset, else the bug is invisible
    expect(grid.cropLeft + grid.cropTop).toBeGreaterThan(20);

    const composites = await Promise.all(grid.tiles.map(async (t) => ({
      input: await sharp({
        create: { width: 256, height: 256, channels: 3 as const, background: tileColor(t.x, t.y) },
      }).png().toBuffer(),
      left: t.left,
      top: t.top,
    })));

    const jpeg = await stitchAndCropTiles(sharp, grid, composites);
    const meta = await sharp(jpeg).metadata();
    expect(meta.width).toBe(W);
    expect(meta.height).toBe(H);

    const raw = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
    const ch = raw.info.channels;
    const px = (x: number, y: number) => {
      const i = (y * W + x) * ch;
      return { r: raw.data[i], g: raw.data[i + 1], b: raw.data[i + 2] };
    };

    // Sample the centre + two corners-ish points, nudged off tile boundaries
    // (JPEG ringing at colour edges would flake the assertion).
    const samples: Array<[number, number]> = [[W / 2, H / 2], [40, 40], [W - 41, H - 41]];
    for (let [sx, sy] of samples) {
      let gx = grid.tx0 * 256 + grid.cropLeft + sx;
      let gy = grid.ty0 * 256 + grid.cropTop + sy;
      if (gx % 256 < 8 || gx % 256 > 248) { sx += 12; gx += 12; }
      if (gy % 256 < 8 || gy % 256 > 248) { sy += 12; gy += 12; }
      const want = tileColor(Math.floor(gx / 256), Math.floor(gy / 256));
      const got = px(Math.round(sx), Math.round(sy));
      expect(Math.abs(got.r - want.r), `r @ ${sx},${sy}`).toBeLessThanOrEqual(8);
      expect(Math.abs(got.g - want.g), `g @ ${sx},${sy}`).toBeLessThanOrEqual(8);
      expect(Math.abs(got.b - want.b), `b @ ${sx},${sy}`).toBeLessThanOrEqual(8);
    }

    // And the exact centre must NOT be what the OLD shifted code would draw
    // there (the tile that sits cropLeft/cropTop earlier), unless they collide.
    const gxOld = grid.tx0 * 256 + W / 2;
    const gyOld = grid.ty0 * 256 + H / 2;
    const oldColor = tileColor(Math.floor(gxOld / 256), Math.floor(gyOld / 256));
    const gxNew = grid.tx0 * 256 + grid.cropLeft + W / 2;
    const gyNew = grid.ty0 * 256 + grid.cropTop + H / 2;
    const newColor = tileColor(Math.floor(gxNew / 256), Math.floor(gyNew / 256));
    if (oldColor.r !== newColor.r || oldColor.g !== newColor.g) {
      const got = px(W / 2, H / 2);
      const matchesOld = Math.abs(got.r - oldColor.r) <= 8 && Math.abs(got.g - oldColor.g) <= 8;
      expect(matchesOld, 'centre pixel still shows the pre-fix shifted scene').toBe(false);
    }
  });
});
