/**
 * tests/treeCursor.test.ts
 *
 * Pure-math tests for the 2D tree placement cursor preview.
 *
 * The cursor's footprint is the tree's canopy radius. The math that turns
 * that radius into Cesium ellipse axes, feet readouts, footprint area, and
 * diameter lives in `components/3d/tree/canopy.ts`. This file locks the
 * math so:
 *   - the cursor stays in lockstep with the tree primitive
 *   - the default radius constant matches the v64 tree primitive (1.8m)
 *   - degenerate radii (negative, zero, NaN) fail loudly instead of
 *     silently breaking the Cesium ellipse
 *
 * No Cesium import, no DOM, no jsdom — vitest's default `node` environment.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TREE_CANOPY_RADIUS_M,
  MIN_TREE_CANOPY_RADIUS_M,
  MAX_TREE_CANOPY_RADIUS_M,
  canopyDiameterM,
  canopyRadiusInFeet,
  canopyFootprintAreaM2,
  canopyRadiusToEllipseAxes,
} from '@/components/3d/tree/canopy';

// ─── Default constant ─────────────────────────────────────────────────────

describe('canopy — DEFAULT_TREE_CANOPY_RADIUS_M', () => {
  it('matches the v64 tree primitive in SolarEngine3D.tsx (1.8 m)', () => {
    expect(DEFAULT_TREE_CANOPY_RADIUS_M).toBe(1.8);
  });

  it('is within the allowed radius range', () => {
    expect(DEFAULT_TREE_CANOPY_RADIUS_M).toBeGreaterThanOrEqual(MIN_TREE_CANOPY_RADIUS_M);
    expect(DEFAULT_TREE_CANOPY_RADIUS_M).toBeLessThanOrEqual(MAX_TREE_CANOPY_RADIUS_M);
  });

  it('MIN/MAX bounds form a sensible non-degenerate range', () => {
    expect(MIN_TREE_CANOPY_RADIUS_M).toBeGreaterThan(0);
    expect(MAX_TREE_CANOPY_RADIUS_M).toBeGreaterThan(MIN_TREE_CANOPY_RADIUS_M);
  });
});

// ─── Diameter (cursor diameter = 2r) ──────────────────────────────────────

describe('canopy — canopyDiameterM (cursor diameter)', () => {
  it('default 1.8 m radius → 3.6 m diameter (≈ 11.8 ft)', () => {
    expect(canopyDiameterM()).toBeCloseTo(3.6, 10);
  });

  it('explicit radius doubles correctly', () => {
    expect(canopyDiameterM(1.8)).toBeCloseTo(3.6, 10);
    expect(canopyDiameterM(2.5)).toBeCloseTo(5.0, 10);
    expect(canopyDiameterM(0.5)).toBeCloseTo(1.0, 10);
  });

  it('matches Aurora parity: cursor diameter = canopy diameter', () => {
    const r = DEFAULT_TREE_CANOPY_RADIUS_M;
    expect(canopyDiameterM(r)).toBeCloseTo(2 * r, 10);
  });
});

// ─── Feet (Aurora-style imperial readout) ─────────────────────────────────

describe('canopy — canopyRadiusInFeet', () => {
  it('default 1.8 m radius → ≈ 5.9055 ft', () => {
    expect(canopyRadiusInFeet()).toBeCloseTo(5.9055, 3);
  });

  it('respects the 3.28084 ft/m constant exactly', () => {
    expect(canopyRadiusInFeet(1.0)).toBeCloseTo(3.28084, 5);
    expect(canopyRadiusInFeet(10.0)).toBeCloseTo(32.8084, 4);
  });
});

// ─── Footprint area (πr²) ────────────────────────────────────────────────

describe('canopy — canopyFootprintAreaM2 (πr²)', () => {
  it('default 1.8 m radius → π × 1.8² ≈ 10.1787 m²', () => {
    expect(canopyFootprintAreaM2()).toBeCloseTo(Math.PI * 1.8 * 1.8, 6);
  });

  it('respects the πr² formula for explicit radii', () => {
    expect(canopyFootprintAreaM2(1.0)).toBeCloseTo(Math.PI, 6);
    expect(canopyFootprintAreaM2(2.0)).toBeCloseTo(4 * Math.PI, 6);
    expect(canopyFootprintAreaM2(0.5)).toBeCloseTo(0.25 * Math.PI, 6);
  });

  it('is monotonic in r (bigger tree → bigger footprint)', () => {
    const a1 = canopyFootprintAreaM2(1.0);
    const a2 = canopyFootprintAreaM2(2.0);
    const a3 = canopyFootprintAreaM2(3.0);
    expect(a1).toBeLessThan(a2);
    expect(a2).toBeLessThan(a3);
  });
});

// ─── Ellipse axes (Cesium EllipseGraphics contract) ──────────────────────

describe('canopy — canopyRadiusToEllipseAxes (Cesium contract)', () => {
  it('default radius produces a perfect circle (semiMajor == semiMinor)', () => {
    const axes = canopyRadiusToEllipseAxes();
    expect(axes.semiMajorAxis).toBe(1.8);
    expect(axes.semiMinorAxis).toBe(1.8);
  });

  it('explicit radius produces equal axes (still a circle)', () => {
    const axes = canopyRadiusToEllipseAxes(2.5);
    expect(axes.semiMajorAxis).toBe(2.5);
    expect(axes.semiMinorAxis).toBe(2.5);
  });

  it('axes are strictly positive (Cesium rejects ≤ 0)', () => {
    const axes = canopyRadiusToEllipseAxes(0.1);
    expect(axes.semiMajorAxis).toBeGreaterThan(0);
    expect(axes.semiMinorAxis).toBeGreaterThan(0);
  });

  it('returns an object with both keys (avoids destructuring surprises)', () => {
    const axes = canopyRadiusToEllipseAxes(1.0);
    expect(Object.keys(axes).sort()).toEqual(['semiMajorAxis', 'semiMinorAxis']);
  });
});

// ─── Input validation ─────────────────────────────────────────────────────

describe('canopy — input validation', () => {
  it('rejects NaN', () => {
    expect(() => canopyDiameterM(NaN)).toThrow(RangeError);
    expect(() => canopyRadiusInFeet(NaN)).toThrow(RangeError);
    expect(() => canopyFootprintAreaM2(NaN)).toThrow(RangeError);
    expect(() => canopyRadiusToEllipseAxes(NaN)).toThrow(RangeError);
  });

  it('rejects Infinity and -Infinity', () => {
    expect(() => canopyDiameterM(Infinity)).toThrow(RangeError);
    expect(() => canopyDiameterM(-Infinity)).toThrow(RangeError);
  });

  it('rejects zero', () => {
    expect(() => canopyDiameterM(0)).toThrow(RangeError);
  });

  it('rejects negative radii', () => {
    expect(() => canopyDiameterM(-1.0)).toThrow(RangeError);
    expect(() => canopyRadiusInFeet(-0.5)).toThrow(RangeError);
    expect(() => canopyFootprintAreaM2(-2.0)).toThrow(RangeError);
    expect(() => canopyRadiusToEllipseAxes(-1.8)).toThrow(RangeError);
  });

  it('rejects radii below the minimum (sub-pixel ring)', () => {
    expect(() => canopyDiameterM(0.001)).toThrow(RangeError);
  });

  it('rejects radii above the maximum (>30m is a shade-zone, not a cursor)', () => {
    expect(() => canopyDiameterM(100.0)).toThrow(RangeError);
    expect(() => canopyDiameterM(MAX_TREE_CANOPY_RADIUS_M + 0.01)).toThrow(RangeError);
  });

  it('accepts the boundary values', () => {
    expect(() => canopyDiameterM(MIN_TREE_CANOPY_RADIUS_M)).not.toThrow();
    expect(() => canopyDiameterM(MAX_TREE_CANOPY_RADIUS_M)).not.toThrow();
  });
});
