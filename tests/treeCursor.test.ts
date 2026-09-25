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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { presetFor } from '@/lib/3d/obstructionPresets';
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

/* ───────────────────────────────────────────────────────────────────────────
 * AND THE PREVIEW MUST BE THE SIZE OF THE TREE YOU WILL GET.
 *
 * 🚨 IT WAS NOT. `SolarEngine3D` passed the CONSTANT 1.8 m default while the
 * Tree preset places a 6.0 m wide canopy — a 3.0 m radius. The circle the
 * installer aimed with was FORTY PER CENT of the footprint that appeared, and
 * dragging the Width slider changed the tree but not the preview of it.
 *
 * A preview that under-reports its own size is worse than no preview, because
 * it is aimed with and it is believed. Aiming is the cursor's entire purpose.
 *
 * The second half of the defect: `TreeCursor` deliberately refused to react to
 * `canopyRadiusM` at all, because re-creating the Cesium entity on every change
 * was expensive. CallbackPropertys over a ref remove that trade-off — the size
 * is live and nothing is recreated — so the prop can now be trusted.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('the tree cursor previews the armed size, live', () => {
  const ROOT = join(__dirname, '..');
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const ENGINE = stripComments(read('components/3d/SolarEngine3D.tsx'));
  const CURSOR = stripComments(read('components/3d/tree/TreeCursor.tsx'));

  it('the Tree preset really is wider than the old constant — this is the defect', () => {
    const preset = presetFor('tree');
    expect(preset.widthM).toBe(6);
    // Half the width is the radius of a round site object.
    expect(preset.widthM / 2).toBe(3);
    expect(DEFAULT_TREE_CANOPY_RADIUS_M).toBe(1.8);
    // The preview was 1.8 against a real 3.0 — 60% of the radius, 36% of area.
    expect(DEFAULT_TREE_CANOPY_RADIUS_M).toBeLessThan(preset.widthM / 2);
  });

  it('the engine passes the ARMED width, not a constant', () => {
    const i = ENGINE.indexOf('<TreeCursor');
    expect(i, 'the TreeCursor mount was not found').toBeGreaterThan(-1);
    const mount = ENGINE.slice(i, i + 700);
    expect(mount, 'the preview must follow the width the user set')
      .toMatch(/newObstructionWidthM \/ 2/);
    // A bare constant here is the defect returning.
    expect(mount).not.toMatch(/canopyRadiusM=\{TREE_CANOPY_RADIUS_M\}/);
  });

  it('it still has a sane fallback while the width box is mid-edit', () => {
    const i = ENGINE.indexOf('<TreeCursor');
    const mount = ENGINE.slice(i, i + 700);
    expect(mount).toMatch(/isFinite\(newObstructionWidthM\) && newObstructionWidthM > 0/);
    expect(mount).toMatch(/: TREE_CANOPY_RADIUS_M/);
  });

  it('🚨 the size is LIVE — axes are callbacks over a ref, not baked at creation', () => {
    expect(CURSOR, 'a ref the render refreshes').toMatch(/const radiusRef = useRef<number>/);
    expect(CURSOR).toMatch(/radiusRef\.current = isFinite\(canopyRadiusM\)/);
    expect(CURSOR, 'semiMajorAxis must be read per frame')
      .toMatch(/semiMajorAxis: new C\.CallbackProperty\(\(\) => axes\(\)\.semiMajorAxis, false\)/);
    expect(CURSOR, 'semiMinorAxis must be read per frame')
      .toMatch(/semiMinorAxis: new C\.CallbackProperty\(\(\) => axes\(\)\.semiMinorAxis, false\)/);
  });

  it('and the entity is NOT recreated on a size change', () => {
    // Re-creating the preview on every keystroke in the width box is the cost
    // the old code was avoiding; the callbacks are what make that unnecessary.
    const i = CURSOR.lastIndexOf('}, [active, viewer]);');
    expect(i, 'the effect deps changed — check the entity is still not rebuilt')
      .toBeGreaterThan(-1);
  });

  it('the ref refuses a degenerate radius rather than passing it to Cesium', () => {
    // canopyRadiusToEllipseAxes throws on <= 0; the ref clamps first so a
    // half-typed width cannot take the preview down.
    expect(CURSOR).toMatch(/canopyRadiusM > 0\s*\?\s*canopyRadiusM\s*:\s*DEFAULT_TREE_CANOPY_RADIUS_M/);
    expect(() => canopyRadiusToEllipseAxes(0)).toThrow();
  });
});
