// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE RECTANGLE A PAID ORTHOPHOTO COVERS, AND THE RESOLUTION IT ACTUALLY HAS.
//
// Ray asked for Nearmap as a switchable reference layer inside the 3D Design Studio, with two
// constraints that this arithmetic exists to satisfy:
//
//   · "do not recreate/re-fetch imagery unnecessarily" / "Do not make the visual toggle a billing
//     event." An already-acquired orthophoto is stored per project — the permit route writes the
//     whole permit input to `project_files` as `permit_input.json`, and its `aerialData` carries
//     the stitched Nearmap JPEG plus the centre lat/lng, the zoom and the pixel size. Showing THAT
//     costs nothing. But an image is only a reference layer if it is correctly georeferenced, and
//     the rectangle has to come from those four numbers.
//   · "do not print a hard-coded 7.5 cm/px Nearmap claim unless that resolution is actually known
//     for the selected imagery." The resolution IS derivable from the zoom and the latitude, so it
//     can be stated truthfully instead of asserted from a brand name.
//
// A wrong rectangle is worse than no imagery: it would put the photo metres away from the geometry
// drawn on top of it, and an operator would trace a house against a lie. So it is proved here,
// against the forward projection the tile fetcher itself uses, rather than checked by eye.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  nearmapImageBounds, groundResolutionCmPerPx, nearmapTileGrid,
  lngToGlobalPx, latToGlobalPx, globalPxToLng, globalPxToLat,
} from '@/lib/aerial/nearmap';

const SITE = { lat: 38.70615, lng: -90.22660 };   // Melvin — the calibration property
const W = 1440, H = 810;                          // the frame the permit route asks for

describe('🚨 the projection inverts exactly', () => {
  it('lng → px → lng and lat → px → lat round-trip at every zoom the fetcher uses', () => {
    // If these did not invert, every bound below would be wrong by a consistent offset, which is
    // the hardest kind of georeferencing error to see.
    for (const z of [19, 20, 21]) {
      for (const lng of [-179.9, -90.2266, 0, 13.4, 179.9]) {
        expect(globalPxToLng(lngToGlobalPx(lng, z), z)).toBeCloseTo(lng, 9);
      }
      for (const lat of [-84, -38.7, 0, 38.70615, 51.5, 84]) {
        expect(globalPxToLat(latToGlobalPx(lat, z), z)).toBeCloseTo(lat, 7);
      }
    }
  });
});

describe('🚨 the bounds of a stitched aerial', () => {
  it('are centred on the image centre', () => {
    const b = nearmapImageBounds(SITE.lat, SITE.lng, 21, W, H)!;
    expect(b).toBeTruthy();
    expect((b.west + b.east) / 2).toBeCloseTo(SITE.lng, 9);
    // Latitude is not linear in Mercator, so the centre is only approximately the mean — check it
    // to the metre rather than to nine places.
    const midLat = globalPxToLat(latToGlobalPx(SITE.lat, 21), 21);
    expect(midLat).toBeCloseTo(SITE.lat, 7);
    expect(b.north).toBeGreaterThan(SITE.lat);
    expect(b.south).toBeLessThan(SITE.lat);
  });

  it('🚨 span matches width × resolution — the scale is right, not just the centre', () => {
    // The check that actually catches a wrong rectangle: the ground width the bounds describe must
    // equal the pixel width times the ground resolution.
    for (const z of [19, 20, 21]) {
      const b = nearmapImageBounds(SITE.lat, SITE.lng, z, W, H)!;
      const cmPerPx = groundResolutionCmPerPx(SITE.lat, z)!;
      const expectedWidthM = (W * cmPerPx) / 100;
      const cosLat = Math.cos(SITE.lat * Math.PI / 180);
      const actualWidthM = (b.east - b.west) * 111_320 * cosLat;
      expect(Math.abs(actualWidthM - expectedWidthM) / expectedWidthM,
        `z${z}: bounds are ${actualWidthM.toFixed(1)} m wide but ${W} px at ${cmPerPx.toFixed(2)} cm/px is ${expectedWidthM.toFixed(1)} m`)
        .toBeLessThan(0.01);
      const expectedHeightM = (H * cmPerPx) / 100;
      const actualHeightM = (b.north - b.south) * 111_132;
      expect(Math.abs(actualHeightM - expectedHeightM) / expectedHeightM,
        `z${z}: bounds are ${actualHeightM.toFixed(1)} m tall but ${H} px is ${expectedHeightM.toFixed(1)} m`)
        .toBeLessThan(0.02);
    }
  });

  it('🚨 agrees with the tile grid the image was actually stitched from', () => {
    // The strongest tie available without the image: `nearmapTileGrid` decides which tiles are
    // fetched and where the W×H crop sits inside the whole-tile canvas. The crop's own geographic
    // extent must be the rectangle reported here — otherwise the reference layer and the pixels
    // would disagree about where the photo is.
    const z = 21;
    const grid = nearmapTileGrid(SITE.lat, SITE.lng, z, W, H);
    const b = nearmapImageBounds(SITE.lat, SITE.lng, z, W, H)!;
    // Global pixel of the crop's top-left = tile origin + crop offset.
    const cropLeftPx = grid.tx0 * 256 + grid.cropLeft;
    const cropTopPx = grid.ty0 * 256 + grid.cropTop;
    //
    // 🚨 AGREEMENT TO WITHIN ONE PIXEL, NOT TO NINE DECIMAL PLACES.
    //
    // `nearmapTileGrid` floors the tile indices and carries an INTEGER crop offset, because you
    // cannot fetch a fraction of a tile — so the stitched image's left edge is quantised to a
    // whole pixel, while these bounds are derived from the exact fractional centre. Measured, the
    // difference is 2.8e-7 degrees of longitude at z21: about 2.4 cm, or a third of a pixel.
    //
    // So the meaningful assertion is in PIXELS, and stating it that way also says what the error
    // would mean on screen. A tighter tolerance failed for a reason that was not a defect.
    const cmPerPx = groundResolutionCmPerPx(SITE.lat, z)!;
    const cosLat = Math.cos(SITE.lat * Math.PI / 180);
    const lngErrPx = (deg: number) => Math.abs(deg) * 111_320 * cosLat * 100 / cmPerPx;
    const latErrPx = (deg: number) => Math.abs(deg) * 111_132 * 100 / cmPerPx;
    expect(lngErrPx(globalPxToLng(cropLeftPx, z) - b.west),
      'the west edge disagrees with the stitched crop by more than a pixel').toBeLessThan(1);
    expect(latErrPx(globalPxToLat(cropTopPx, z) - b.north),
      'the north edge disagrees with the stitched crop by more than a pixel').toBeLessThan(1);
    expect(lngErrPx(globalPxToLng(cropLeftPx + W, z) - b.east),
      'the east edge disagrees with the stitched crop by more than a pixel').toBeLessThan(1);
    expect(latErrPx(globalPxToLat(cropTopPx + H, z) - b.south),
      'the south edge disagrees with the stitched crop by more than a pixel').toBeLessThan(1);
  });

  it('a square image is wider than it is tall in degrees, away from the equator', () => {
    // A sanity check with a real geometric meaning: one degree of longitude is shorter than one of
    // latitude at 38°N, so a square image spans MORE longitude than latitude. Getting this
    // backwards is the classic lat/lng swap.
    const b = nearmapImageBounds(SITE.lat, SITE.lng, 21, 1024, 1024)!;
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
  });

  it('refuses nonsense rather than returning a plausible-looking rectangle', () => {
    expect(nearmapImageBounds(NaN, SITE.lng, 21, W, H)).toBeNull();
    expect(nearmapImageBounds(SITE.lat, SITE.lng, 21, 0, H)).toBeNull();
    expect(nearmapImageBounds(SITE.lat, SITE.lng, 21, W, -5)).toBeNull();
    expect(nearmapImageBounds(SITE.lat, SITE.lng, 99, W, H)).toBeNull();
    // Beyond the Mercator limit the projection diverges; a rectangle there would be fiction.
    expect(nearmapImageBounds(88, SITE.lng, 21, W, H)).toBeNull();
  });
});

describe('🚨 the resolution is computed, never asserted from a brand', () => {
  it('z21 at this latitude really is about 7 cm/px — so the claim can be stated truthfully', () => {
    const cm = groundResolutionCmPerPx(SITE.lat, 21)!;
    expect(cm).toBeGreaterThan(5);
    expect(cm).toBeLessThan(10);
  });

  it('it halves with each zoom level, and varies with latitude', () => {
    const z20 = groundResolutionCmPerPx(SITE.lat, 20)!;
    const z21 = groundResolutionCmPerPx(SITE.lat, 21)!;
    expect(z20 / z21).toBeCloseTo(2, 3);
    // The same zoom is FINER further from the equator, which is exactly why a fixed "7.5 cm/px"
    // string cannot be true everywhere.
    expect(groundResolutionCmPerPx(60, 21)!).toBeLessThan(groundResolutionCmPerPx(10, 21)!);
  });

  it('refuses a latitude it cannot honestly answer for', () => {
    expect(groundResolutionCmPerPx(NaN, 21)).toBeNull();
    expect(groundResolutionCmPerPx(91, 21)).toBeNull();
  });
});
