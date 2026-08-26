/**
 * tests/roofActions.test.ts
 *
 * Pure-math tests for the v66+ Lift Roofs / Flatten Roofs quick actions.
 *
 * What this guards:
 *   - liftRoofs is a no-op when lidar is null
 *   - liftRoofs sets each primitive's heightM to the LiDAR elevation at its centroid
 *   - liftRoofs leaves a primitive unchanged when its centroid has no LiDAR coverage
 *   - flattenRoofs is a no-op when lidar is null
 *   - flattenRoofs sets all primitives to the same average elevation
 *   - flattenRoofs ignores primitives with no LiDAR coverage in the average
 *   - flattenRoofs is a no-op when no centroid has coverage
 *   - primitiveCentroid averages footprint points correctly
 *   - primitiveCentroid throws on empty input
 *   - primitiveCentroid works for a single point
 *   - both functions return a new array (no input mutation)
 *
 * These tests do NOT need Cesium, a browser, or a 3D scene — they just
 * verify the math + the no-op contract.
 */

import { describe, it, expect } from 'vitest';
import {
  liftRoofs,
  flattenRoofs,
  primitiveCentroid,
  type RoofPrimitive,
  type LidarData,
} from '@/lib/3d/roofActions';

// ─── Test fixtures ─────────────────────────────────────────────────────────

/** A tiny canned LidarData that returns the elevation at (lat, lng)
 *  from a dictionary. Easy to reason about, easy to test edge cases. */
function makeLidar(map: Record<string, number>): LidarData {
  return {
    getElevationAt(lat: number, lng: number): number | null {
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      return key in map ? map[key] : null;
    },
  };
}

/** A RoofPrimitive at a known centroid. Default height is 6m (typical 1-story eave). */
function makePrim(
  id: string,
  centroidLat: number,
  centroidLng: number,
  heightM = 6,
  kind: 'block' | 'gable' | 'hip' = 'block',
): RoofPrimitive {
  return { id, kind, centroidLat, centroidLng, heightM };
}

// ─── primitiveCentroid ────────────────────────────────────────────────────

describe('roofActions — primitiveCentroid', () => {
  it('averages lat and lng of footprint points', () => {
    const c = primitiveCentroid([
      { lat: 38.8, lng: -77.0 },
      { lat: 38.9, lng: -77.1 },
      { lat: 38.85, lng: -77.05 },
    ]);
    expect(c.centroidLat).toBeCloseTo((38.8 + 38.9 + 38.85) / 3, 10);
    expect(c.centroidLng).toBeCloseTo((-77.0 + -77.1 + -77.05) / 3, 10);
  });

  it('returns the point itself when given a single point', () => {
    const c = primitiveCentroid([{ lat: 38.818, lng: -77.082 }]);
    expect(c.centroidLat).toBe(38.818);
    expect(c.centroidLng).toBe(-77.082);
  });

  it('works for the gable/hip case: 2 eave corners (SW + NE)', () => {
    const sw = { lat: 38.818, lng: -77.082 };
    const ne = { lat: 38.820, lng: -77.080 };
    const c = primitiveCentroid([sw, ne]);
    expect(c.centroidLat).toBeCloseTo(38.819, 10);
    expect(c.centroidLng).toBeCloseTo(-77.081, 10);
  });

  it('throws on empty input (programming error, not a silent zero)', () => {
    expect(() => primitiveCentroid([])).toThrow(/at least 1 point/);
  });
});

// ─── liftRoofs ────────────────────────────────────────────────────────────

describe('roofActions — liftRoofs', () => {
  it('is a no-op (returns unchanged heights) when lidar is null', () => {
    const prims = [makePrim('a', 38.8, -77.0, 6), makePrim('b', 38.9, -77.1, 8)];
    const out = liftRoofs(prims, null);
    expect(out).toHaveLength(2);
    expect(out[0].heightM).toBe(6);
    expect(out[1].heightM).toBe(8);
    expect(out[0].id).toBe('a');
    expect(out[1].id).toBe('b');
  });

  it('returns an empty array when primitives is empty', () => {
    const lidar = makeLidar({});
    expect(liftRoofs([], lidar)).toEqual([]);
  });

  it('sets each primitive heightM to the LiDAR elevation at its centroid', () => {
    const lidar = makeLidar({
      '38.80000,-77.00000': 142.5,
      '38.90000,-77.10000': 145.2,
      '38.85000,-77.05000': 143.8,
    });
    const prims = [
      makePrim('a', 38.8, -77.0, 6),
      makePrim('b', 38.9, -77.1, 8),
      makePrim('c', 38.85, -77.05, 10),
    ];
    const out = liftRoofs(prims, lidar);
    expect(out[0].heightM).toBeCloseTo(142.5, 6);
    expect(out[1].heightM).toBeCloseTo(145.2, 6);
    expect(out[2].heightM).toBeCloseTo(143.8, 6);
  });

  it('leaves a primitive unchanged when its centroid has no LiDAR coverage', () => {
    const lidar = makeLidar({
      '38.80000,-77.00000': 142.5,
    });
    const prims = [
      makePrim('a', 38.8, -77.0, 6),
      makePrim('b', 38.9, -77.1, 8),
    ];
    const out = liftRoofs(prims, lidar);
    expect(out[0].heightM).toBeCloseTo(142.5, 6);
    expect(out[1].heightM).toBe(8);
  });

  it('treats NaN from lidar as "no coverage" (defensive)', () => {
    const lidar: LidarData = { getElevationAt: () => NaN };
    const prims = [makePrim('a', 38.8, -77.0, 6)];
    const out = liftRoofs(prims, lidar);
    expect(out[0].heightM).toBe(6);
  });

  it('does NOT mutate the input array or its primitive objects', () => {
    const lidar = makeLidar({ '38.80000,-77.00000': 142.5 });
    const prim = makePrim('a', 38.8, -77.0, 6);
    const prims = [prim];
    const out = liftRoofs(prims, lidar);
    expect(prims[0].heightM).toBe(6);
    expect(prim.heightM).toBe(6);
    expect(out[0]).not.toBe(prim);
    expect(out[0].heightM).toBeCloseTo(142.5, 6);
  });

  it('preserves the primitive kind (block / gable / hip)', () => {
    const lidar = makeLidar({ '38.80000,-77.00000': 142.5 });
    const prims: RoofPrimitive[] = [
      { id: 'a', kind: 'block', centroidLat: 38.8, centroidLng: -77.0, heightM: 6 },
      { id: 'b', kind: 'gable', centroidLat: 38.8, centroidLng: -77.0, heightM: 6 },
      { id: 'c', kind: 'hip',   centroidLat: 38.8, centroidLng: -77.0, heightM: 6 },
    ];
    const out = liftRoofs(prims, lidar);
    expect(out[0].kind).toBe('block');
    expect(out[1].kind).toBe('gable');
    expect(out[2].kind).toBe('hip');
  });
});

// ─── flattenRoofs ─────────────────────────────────────────────────────────

describe('roofActions — flattenRoofs', () => {
  it('is a no-op (returns unchanged heights) when lidar is null', () => {
    const prims = [makePrim('a', 38.8, -77.0, 6), makePrim('b', 38.9, -77.1, 8)];
    const out = flattenRoofs(prims, null);
    expect(out[0].heightM).toBe(6);
    expect(out[1].heightM).toBe(8);
  });

  it('returns an empty array when primitives is empty', () => {
    const lidar = makeLidar({});
    expect(flattenRoofs([], lidar)).toEqual([]);
  });

  it('sets all primitives to the average of their centroid LiDAR elevations', () => {
    const lidar = makeLidar({
      '38.80000,-77.00000': 142.0,
      '38.90000,-77.10000': 144.0,
      '38.85000,-77.05000': 146.0,
    });
    const prims = [
      makePrim('a', 38.8, -77.0, 6),
      makePrim('b', 38.9, -77.1, 8),
      makePrim('c', 38.85, -77.05, 10),
    ];
    const out = flattenRoofs(prims, lidar);
    expect(out[0].heightM).toBeCloseTo(144, 6);
    expect(out[1].heightM).toBeCloseTo(144, 6);
    expect(out[2].heightM).toBeCloseTo(144, 6);
  });

  it('excludes primitives with no coverage from the average (but still flattens them)', () => {
    const lidar = makeLidar({
      '38.80000,-77.00000': 140.0,
      '38.90000,-77.10000': 144.0,
    });
    const prims = [
      makePrim('a', 38.8, -77.0, 6),
      makePrim('b', 38.9, -77.1, 8),
      makePrim('c', 38.85, -77.05, 10),
    ];
    const out = flattenRoofs(prims, lidar);
    expect(out[0].heightM).toBeCloseTo(142, 6);
    expect(out[1].heightM).toBeCloseTo(142, 6);
    expect(out[2].heightM).toBeCloseTo(142, 6);
  });

  it('is a no-op when no centroid has LiDAR coverage', () => {
    const lidar = makeLidar({});
    const prims = [makePrim('a', 38.8, -77.0, 6), makePrim('b', 38.9, -77.1, 8)];
    const out = flattenRoofs(prims, lidar);
    expect(out[0].heightM).toBe(6);
    expect(out[1].heightM).toBe(8);
  });

  it('handles a single-primitive case (average = that one value)', () => {
    const lidar = makeLidar({ '38.80000,-77.00000': 137.42 });
    const out = flattenRoofs([makePrim('only', 38.8, -77.0, 6)], lidar);
    expect(out[0].heightM).toBeCloseTo(137.42, 6);
  });

  it('does NOT mutate the input array or its primitive objects', () => {
    const lidar = makeLidar({
      '38.80000,-77.00000': 140.0,
      '38.90000,-77.10000': 144.0,
    });
    const a = makePrim('a', 38.8, -77.0, 6);
    const b = makePrim('b', 38.9, -77.1, 8);
    const prims = [a, b];
    const out = flattenRoofs(prims, lidar);
    expect(prims[0].heightM).toBe(6);
    expect(prims[1].heightM).toBe(8);
    expect(a.heightM).toBe(6);
    expect(b.heightM).toBe(8);
    expect(out[0]).not.toBe(a);
    expect(out[1]).not.toBe(b);
    expect(out[0].heightM).toBeCloseTo(142, 6);
    expect(out[1].heightM).toBeCloseTo(142, 6);
  });
});

// ─── Aurora parity scenarios ───────────────────────────────────────────────

describe('roofActions — Aurora parity scenarios', () => {
  it('"Lift Roofs" produces a different height for each segment (matches Aurora: every drawn roof sits flush on the rainbow mesh)', () => {
    const lidar = makeLidar({
      '38.81800,-77.08200': 142.5,
      '38.82000,-77.08000': 145.2,
    });
    const prims = [
      makePrim('low-roof',   38.818, -77.082, 6),
      makePrim('high-roof',  38.820, -77.080, 6),
    ];
    const lifted = liftRoofs(prims, lidar);
    expect(lifted[0].heightM).not.toBe(lifted[1].heightM);
    expect(lifted[0].heightM).toBeCloseTo(142.5, 6);
    expect(lifted[1].heightM).toBeCloseTo(145.2, 6);
  });

  it('"Flatten Roofs" forces a level plane across all segments (matches Aurora: flattening a non-flat site)', () => {
    const lidar = makeLidar({
      '38.81800,-77.08200': 140.0,
      '38.82000,-77.08000': 142.0,
      '38.82200,-77.07800': 144.0,
    });
    const prims = [
      makePrim('a', 38.818, -77.082, 6),
      makePrim('b', 38.820, -77.080, 6),
      makePrim('c', 38.822, -77.078, 6),
    ];
    const flat = flattenRoofs(prims, lidar);
    expect(flat[0].heightM).toBeCloseTo(142, 6);
    expect(flat[1].heightM).toBeCloseTo(142, 6);
    expect(flat[2].heightM).toBeCloseTo(142, 6);
    expect(flat[0].heightM).toBe(flat[1].heightM);
    expect(flat[1].heightM).toBe(flat[2].heightM);
  });

  it('both actions are no-ops when LiDAR is not loaded (Aurora only shows the buttons when LiDAR is active)', () => {
    const prims = [makePrim('a', 38.818, -77.082, 6)];
    const before = prims[0].heightM;
    expect(liftRoofs(prims, null)[0].heightM).toBe(before);
    expect(flattenRoofs(prims, null)[0].heightM).toBe(before);
  });
});
