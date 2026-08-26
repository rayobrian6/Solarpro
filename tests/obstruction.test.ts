/**
 * tests/obstruction.test.ts
 *
 * Pure-math tests for the v66 (obstruction-primitive) Aurora-parity
 * "Add Obstruction" primitive. The math lives in
 * `components/3d/obstruction/dimensions.ts` and is called from
 * `components/3d/SolarEngine3D.tsx` (handleObstructionClick) and
 * `lib/surfaceGeometry3D.ts` (removeObstructedPanels).
 *
 * These tests do NOT need Cesium, a browser, or a 3D scene — they just
 * verify the geometry is mathematically correct.
 *
 * What this guards:
 *   - The Aurora parity bar literal: defaults are exactly 0.6 / 0.6 / 1.0 m.
 *   - Footprint corner math is centered, axis-aligned, and the four
 *     corners are equidistant from the click point in each axis.
 *   - The clamp range is the documented [0.2, 3.0] × [0.2, 3.0] × [0.3, 5.0] box.
 *   - The point-in-rectangle test is correct (true inside, false outside,
 *     false on edge-flicker, false for non-finite inputs).
 *   - The 0.6 × 0.6 m footprint covers an area of 0.36 m² exactly and
 *     has a diagonal of 0.6 * sqrt(2) ≈ 0.8485 m.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OBSTRUCTION_FOOTPRINT_W_M,
  DEFAULT_OBSTRUCTION_FOOTPRINT_D_M,
  DEFAULT_OBSTRUCTION_HEIGHT_M,
  MIN_OBSTRUCTION_FOOTPRINT_M,
  MAX_OBSTRUCTION_FOOTPRINT_M,
  MIN_OBSTRUCTION_HEIGHT_M,
  MAX_OBSTRUCTION_HEIGHT_M,
  clampObstructionFootprint,
  clampObstructionHeight,
  buildObstructionFootprint,
  obstructionFootprintAreaM2,
  obstructionFootprintDiagonalM,
  pointInsideObstructionRectangle,
} from '@/components/3d/obstruction';

const ALEX_LAT = 38.818;     // Alexandria VA — typical suburban address
const ALEX_LNG = -77.082;

// ─── Defaults — Aurora parity bar literal ─────────────────────────────────

describe('obstruction — Aurora parity defaults', () => {
  it('DEFAULT_OBSTRUCTION_FOOTPRINT_W_M is exactly 0.6 (parity bar literal)', () => {
    expect(DEFAULT_OBSTRUCTION_FOOTPRINT_W_M).toBe(0.6);
  });

  it('DEFAULT_OBSTRUCTION_FOOTPRINT_D_M is exactly 0.6 (parity bar literal)', () => {
    expect(DEFAULT_OBSTRUCTION_FOOTPRINT_D_M).toBe(0.6);
  });

  it('DEFAULT_OBSTRUCTION_HEIGHT_M is exactly 1.0 (parity bar literal)', () => {
    expect(DEFAULT_OBSTRUCTION_HEIGHT_M).toBe(1.0);
  });

  it('clamp range for footprint is [0.2, 3.0] m (per DESIGN.md §2.1)', () => {
    expect(MIN_OBSTRUCTION_FOOTPRINT_M).toBe(0.2);
    expect(MAX_OBSTRUCTION_FOOTPRINT_M).toBe(3.0);
  });

  it('clamp range for height is [0.3, 5.0] m (per DESIGN.md §2.1)', () => {
    expect(MIN_OBSTRUCTION_HEIGHT_M).toBe(0.3);
    expect(MAX_OBSTRUCTION_HEIGHT_M).toBe(5.0);
  });
});

// ─── Footprint clamp ─────────────────────────────────────────────────────

describe('obstruction — clampObstructionFootprint', () => {
  it('passes through values inside the safe range', () => {
    const c = clampObstructionFootprint(1.0, 2.0);
    expect(c.widthM).toBe(1.0);
    expect(c.depthM).toBe(2.0);
  });

  it('clamps width below 0.2m up to 0.2m', () => {
    const c = clampObstructionFootprint(0.05, 1.0);
    expect(c.widthM).toBe(0.2);
    expect(c.depthM).toBe(1.0);
  });

  it('clamps width above 3.0m down to 3.0m', () => {
    const c = clampObstructionFootprint(99, 1.0);
    expect(c.widthM).toBe(3.0);
    expect(c.depthM).toBe(1.0);
  });

  it('clamps both axes independently (a too-narrow, a too-wide)', () => {
    const c = clampObstructionFootprint(0.1, 50);
    expect(c.widthM).toBe(0.2);
    expect(c.depthM).toBe(3.0);
  });

  it('clamps negative inputs up to the floor (defensive)', () => {
    const c = clampObstructionFootprint(-5, -5);
    expect(c.widthM).toBe(0.2);
    expect(c.depthM).toBe(0.2);
  });
});

// ─── Height clamp ────────────────────────────────────────────────────────

describe('obstruction — clampObstructionHeight', () => {
  it('passes through values inside the safe range', () => {
    expect(clampObstructionHeight(0.5)).toBe(0.5);
    expect(clampObstructionHeight(1.0)).toBe(1.0);
    expect(clampObstructionHeight(2.5)).toBe(2.5);
    expect(clampObstructionHeight(5.0)).toBe(5.0);
  });

  it('clamps heights below 0.3m up to 0.3m', () => {
    expect(clampObstructionHeight(0)).toBe(0.3);
    expect(clampObstructionHeight(-2)).toBe(0.3);
  });

  it('clamps heights above 5.0m down to 5.0m', () => {
    expect(clampObstructionHeight(7)).toBe(5.0);
    expect(clampObstructionHeight(99)).toBe(5.0);
  });
});

// ─── Footprint corner math ───────────────────────────────────────────────

describe('obstruction — buildObstructionFootprint', () => {
  it('returns 4 corner points (sw, se, ne, nw)', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 0.6, 0.6);
    expect(fp.sw).toBeDefined();
    expect(fp.se).toBeDefined();
    expect(fp.ne).toBeDefined();
    expect(fp.nw).toBeDefined();
    expect(typeof fp.sw.lat).toBe('number');
    expect(typeof fp.sw.lng).toBe('number');
  });

  it('the 4 corners are centered on the click point (lat + lng mean = click point)', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 0.6, 0.6);
    const meanLat = (fp.sw.lat + fp.se.lat + fp.ne.lat + fp.nw.lat) / 4;
    const meanLng = (fp.sw.lng + fp.se.lng + fp.ne.lng + fp.nw.lng) / 4;
    expect(meanLat).toBeCloseTo(ALEX_LAT, 9);
    expect(meanLng).toBeCloseTo(ALEX_LNG, 9);
  });

  it('a 0.6m × 0.6m footprint is axis-aligned: all 4 corners share exactly 2 latitudes and 2 longitudes', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 0.6, 0.6);
    const lats = [fp.sw.lat, fp.se.lat, fp.ne.lat, fp.nw.lat].sort();
    const lngs = [fp.sw.lng, fp.se.lng, fp.ne.lng, fp.nw.lng].sort();
    // Two unique latitudes (south, north) and two unique longitudes (west, east)
    expect(new Set(lats).size).toBe(2);
    expect(new Set(lngs).size).toBe(2);
  });

  it('the SW corner is exactly the smaller lat and smaller lng', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 0.6, 0.6);
    expect(fp.sw.lat).toBeLessThan(fp.ne.lat);
    expect(fp.sw.lng).toBeLessThan(fp.ne.lng);
  });

  it('the NE corner is exactly the larger lat and larger lng', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 0.6, 0.6);
    expect(fp.ne.lat).toBeGreaterThan(fp.sw.lat);
    expect(fp.ne.lng).toBeGreaterThan(fp.sw.lng);
  });

  it('a wider-than-deep footprint (1.0m × 0.4m) has the wider dimension along lng', () => {
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 1.0, 0.4);
    const dLng = Math.abs(fp.ne.lng - fp.sw.lng);
    const dLat = Math.abs(fp.ne.lat - fp.sw.lat);
    // dLng should be larger than dLat in absolute lat/lng space
    expect(dLng).toBeGreaterThan(dLat);
  });

  it('throws a RangeError when center is non-finite (defensive guard)', () => {
    expect(() => buildObstructionFootprint(NaN, ALEX_LNG, 0.6, 0.6)).toThrow(RangeError);
    expect(() => buildObstructionFootprint(ALEX_LAT, Infinity, 0.6, 0.6)).toThrow(RangeError);
  });

  it('respects out-of-range dimensions by clamping (defensive — caller should already clamp)', () => {
    // Even if a caller passes a 99m width, we still produce a valid (clamped) rectangle
    const fp = buildObstructionFootprint(ALEX_LAT, ALEX_LNG, 99, 0.6);
    // The footprint's lng span is now capped at 3.0m (MAX_OBSTRUCTION_FOOTPRINT_M)
    const dLng = Math.abs(fp.ne.lng - fp.sw.lng);
    // 3.0 m / metersPerDegLng(ALEX_LAT) ≈ 3.0 / 86772 ≈ 3.457e-5
    expect(dLng).toBeLessThan(4e-5);
  });
});

// ─── Area / diagonal readouts ────────────────────────────────────────────

describe('obstruction — footprint area and diagonal', () => {
  it('the 0.6 × 0.6 m Aurora default covers exactly 0.36 m²', () => {
    expect(obstructionFootprintAreaM2(0.6, 0.6)).toBeCloseTo(0.36, 10);
  });

  it('a 1.0 × 2.0 m footprint covers exactly 2.0 m²', () => {
    expect(obstructionFootprintAreaM2(1.0, 2.0)).toBeCloseTo(2.0, 10);
  });

  it('a 0.6 × 0.6 m footprint has a diagonal of 0.6 * sqrt(2) ≈ 0.8485 m', () => {
    expect(obstructionFootprintDiagonalM(0.6, 0.6)).toBeCloseTo(0.6 * Math.SQRT2, 10);
  });

  it('a 3-4-5 right triangle is the canonical 0.6 × 0.8 → 1.0 m diagonal', () => {
    expect(obstructionFootprintDiagonalM(0.6, 0.8)).toBeCloseTo(1.0, 10);
  });
});

// ─── Point-in-rectangle test (panel removal) ─────────────────────────────

describe('obstruction — pointInsideObstructionRectangle', () => {
  it('returns true for a point exactly at the center', () => {
    expect(
      pointInsideObstructionRectangle(ALEX_LAT, ALEX_LNG, ALEX_LAT, ALEX_LNG, 0.6, 0.6),
    ).toBe(true);
  });

  it('returns true for a point 0.1m east of center (inside a 0.6m box)', () => {
    // 0.1m east of ALEX_LNG at ALEX_LAT
    const dLng = 0.1 / (111_320 * Math.cos((ALEX_LAT * Math.PI) / 180));
    expect(
      pointInsideObstructionRectangle(
        ALEX_LAT,
        ALEX_LNG + dLng,
        ALEX_LAT,
        ALEX_LNG,
        0.6,
        0.6,
      ),
    ).toBe(true);
  });

  it('returns false for a point 5m east of center (well outside a 0.6m box)', () => {
    const dLng = 5 / (111_320 * Math.cos((ALEX_LAT * Math.PI) / 180));
    expect(
      pointInsideObstructionRectangle(
        ALEX_LAT,
        ALEX_LNG + dLng,
        ALEX_LAT,
        ALEX_LNG,
        0.6,
        0.6,
      ),
    ).toBe(false);
  });

  it('returns false for a point 5m north of center (well outside a 0.6m box)', () => {
    const dLat = 5 / 111_320;
    expect(
      pointInsideObstructionRectangle(
        ALEX_LAT + dLat,
        ALEX_LNG,
        ALEX_LAT,
        ALEX_LNG,
        0.6,
        0.6,
      ),
    ).toBe(false);
  });

  it('returns true for a point on the edge (within the 1mm slack)', () => {
    // Right on the east edge: 0.3m east of center (0.6m / 2)
    const dLng = 0.3 / (111_320 * Math.cos((ALEX_LAT * Math.PI) / 180));
    expect(
      pointInsideObstructionRectangle(
        ALEX_LAT,
        ALEX_LNG + dLng,
        ALEX_LAT,
        ALEX_LNG,
        0.6,
        0.6,
      ),
    ).toBe(true);
  });

  it('returns false for non-finite point (defensive — bad click cannot wipe the roof)', () => {
    expect(
      pointInsideObstructionRectangle(NaN, ALEX_LNG, ALEX_LAT, ALEX_LNG, 0.6, 0.6),
    ).toBe(false);
    expect(
      pointInsideObstructionRectangle(ALEX_LAT, Infinity, ALEX_LAT, ALEX_LNG, 0.6, 0.6),
    ).toBe(false);
    expect(
      pointInsideObstructionRectangle(ALEX_LAT, ALEX_LNG, NaN, ALEX_LNG, 0.6, 0.6),
    ).toBe(false);
  });

  it('returns false for a point far outside a wider rectangle too', () => {
    expect(
      pointInsideObstructionRectangle(ALEX_LAT + 1, ALEX_LNG, ALEX_LAT, ALEX_LNG, 3.0, 3.0),
    ).toBe(false);
  });
});

// ─── Aurora parity: end-to-end click-place math ──────────────────────────

describe('obstruction — Aurora parity click-place round-trip', () => {
  it('a 0.6×0.6×1.0 chimney placed at a known lat/lng produces the documented corner offsets', () => {
    const center = { lat: ALEX_LAT, lng: ALEX_LNG };
    const fp = buildObstructionFootprint(center.lat, center.lng, 0.6, 0.6);

    // metersPerDegLng at ALEX_LAT ≈ 86772, so 0.3m east = 0.3 / 86772 ≈ 3.4567e-6 deg
    const expectedHalfLng = 0.3 / (111_320 * Math.cos((ALEX_LAT * Math.PI) / 180));
    const expectedHalfLat = 0.3 / 111_320;

    expect(fp.sw.lng).toBeCloseTo(center.lng - expectedHalfLng, 9);
    expect(fp.ne.lng).toBeCloseTo(center.lng + expectedHalfLng, 9);
    expect(fp.sw.lat).toBeCloseTo(center.lat - expectedHalfLat, 9);
    expect(fp.ne.lat).toBeCloseTo(center.lat + expectedHalfLat, 9);
  });

  it('a panel at the center is inside the prism; a panel 1m away is not', () => {
    const center = { lat: ALEX_LAT, lng: ALEX_LNG };
    // Panel A: exactly at the center
    expect(
      pointInsideObstructionRectangle(center.lat, center.lng, center.lat, center.lng, 0.6, 0.6),
    ).toBe(true);
    // Panel B: 1m east of center — outside the 0.6m wide prism
    const dLng = 1 / (111_320 * Math.cos((ALEX_LAT * Math.PI) / 180));
    expect(
      pointInsideObstructionRectangle(center.lat, center.lng + dLng, center.lat, center.lng, 0.6, 0.6),
    ).toBe(false);
  });
});
