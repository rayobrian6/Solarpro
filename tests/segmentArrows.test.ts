/**
 * tests/segmentArrows.test.ts
 *
 * Pure-math tests for the per-segment yellow normal-direction arrows
 * (Aurora Smart Roof parity). The math lives in lib/3d/segmentArrows.ts
 * and is consumed by components/3d/segments/SegmentArrowOverlay.ts.
 *
 * These tests do NOT need Cesium, a browser, or a 3D scene — they
 * just verify the geometry is mathematically correct.
 */

import { describe, it, expect } from 'vitest';
import {
  midpoint,
  defaultOutwardNormal,
  bearingOf,
  flipNormalDir,
  buildSegmentsFromPoints,
} from '@/lib/3d/segmentArrows';

const ALEX_LAT = 38.818;
const ALEX_LNG = -77.082;

function dot(
  a: { east: number; north: number },
  b: { east: number; north: number },
): number {
  return a.east * b.east + a.north * b.north;
}
function length(v: { east: number; north: number }): number {
  return Math.hypot(v.east, v.north);
}

// ─── midpoint ──────────────────────────────────────────────────────────

describe('segmentArrows — midpoint', () => {
  it('midpoint of two points is the mean of their coords', () => {
    const m = midpoint(
      { lat: 38.8, lng: -77.0 },
      { lat: 38.9, lng: -77.1 },
    );
    expect(m.lat).toBeCloseTo(38.85, 10);
    expect(m.lng).toBeCloseTo(-77.05, 10);
  });

  it('midpoint of identical points is that point', () => {
    const m = midpoint(
      { lat: 38.818, lng: -77.082 },
      { lat: 38.818, lng: -77.082 },
    );
    expect(m.lat).toBe(38.818);
    expect(m.lng).toBe(-77.082);
  });
});

// ─── defaultOutwardNormal ─────────────────────────────────────────────

describe('segmentArrows — defaultOutwardNormal', () => {
  it('is a unit vector (length = 1) for a non-degenerate edge', () => {
    const n = defaultOutwardNormal(
      { lat: ALEX_LAT, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG + 0.001 },
      null,
      ALEX_LAT,
    );
    expect(length(n)).toBeCloseTo(1.0, 9);
  });

  it('is perpendicular to the edge', () => {
    const a = { lat: ALEX_LAT, lng: ALEX_LNG };
    const b = { lat: ALEX_LAT, lng: ALEX_LNG + 0.01 }; // due-east edge
    const n = defaultOutwardNormal(a, b, null, ALEX_LAT);
    expect(Math.abs(n.east)).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(n.north) - 1)).toBeLessThan(1e-9);
  });

  it('points away from the polygon centroid (right-hand rule)', () => {
    const NW = { lat: 38.819, lng: -77.083 };
    const NE = { lat: 38.819, lng: -77.081 };
    const SE = { lat: 38.817, lng: -77.081 };
    const SW = { lat: 38.817, lng: -77.083 };
    const centroid = { lat: 38.818, lng: -77.082 };
    const refLat = centroid.lat;
    // Top edge NW→NE: centroid is below (south), outward = north.
    const topNormal = defaultOutwardNormal(NW, NE, centroid, refLat);
    expect(topNormal.north).toBeGreaterThan(0);
    // Right edge NE→SE: centroid is to the west, outward = east.
    const rightNormal = defaultOutwardNormal(NE, SE, centroid, refLat);
    expect(rightNormal.east).toBeGreaterThan(0);
    // Bottom edge SE→SW: outward = south.
    const bottomNormal = defaultOutwardNormal(SE, SW, centroid, refLat);
    expect(bottomNormal.north).toBeLessThan(0);
    // Left edge SW→NW: outward = west.
    const leftNormal = defaultOutwardNormal(SW, NW, centroid, refLat);
    expect(leftNormal.east).toBeLessThan(0);
  });

  it('falls back to a deterministic side when centroid is null', () => {
    const a = { lat: ALEX_LAT, lng: ALEX_LNG };
    const b = { lat: ALEX_LAT, lng: ALEX_LNG + 0.01 };
    const n = defaultOutwardNormal(a, b, null, ALEX_LAT);
    expect(n.north).toBeGreaterThan(0);
    expect(Math.abs(n.east)).toBeLessThan(1e-9);
  });

  it('returns a zero vector (safely) for a degenerate zero-length edge', () => {
    const p = { lat: ALEX_LAT, lng: ALEX_LNG };
    const n = defaultOutwardNormal(p, p, null, ALEX_LAT);
    expect(n.east).toBe(0);
    expect(n.north).toBe(0);
  });

  it('is unit-length at any latitude (cos scaling does not break unit-ness)', () => {
    const equator = defaultOutwardNormal(
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      null,
      0,
    );
    expect(length(equator)).toBeCloseTo(1.0, 9);
    const high = defaultOutwardNormal(
      { lat: 60, lng: 0 },
      { lat: 60, lng: 1 },
      null,
      60,
    );
    expect(length(high)).toBeCloseTo(1.0, 9);
  });
});

// ─── flipNormalDir ────────────────────────────────────────────────────

describe('segmentArrows — flipNormalDir', () => {
  it('flip(1) is -1', () => {
    expect(flipNormalDir(1)).toBe(-1);
  });
  it('flip(-1) is 1', () => {
    expect(flipNormalDir(-1)).toBe(1);
  });
  it('is its own inverse: flip(flip(d)) === d', () => {
    expect(flipNormalDir(flipNormalDir(1))).toBe(1);
    expect(flipNormalDir(flipNormalDir(-1))).toBe(-1);
  });
});

// ─── bearingOf ────────────────────────────────────────────────────────

describe('segmentArrows — bearingOf', () => {
  it('north-pointing vector has bearing 0', () => {
    expect(bearingOf({ east: 0, north: 1 })).toBeCloseTo(0, 9);
  });
  it('east-pointing vector has bearing +π/2', () => {
    expect(bearingOf({ east: 1, north: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });
  it('south-pointing vector has bearing ±π (in [-π, π])', () => {
    const b = bearingOf({ east: 0, north: -1 });
    expect(Math.abs(b)).toBeCloseTo(Math.PI, 9);
  });
  it('west-pointing vector has bearing -π/2', () => {
    expect(bearingOf({ east: -1, north: 0 })).toBeCloseTo(-Math.PI / 2, 9);
  });
  it('NE-pointing vector (45°) has bearing +π/4', () => {
    const s = Math.SQRT1_2;
    expect(bearingOf({ east: s, north: s })).toBeCloseTo(Math.PI / 4, 9);
  });
  it('bearing is independent of vector length (only direction matters)', () => {
    const a = bearingOf({ east: 3, north: 4 });
    const b = bearingOf({ east: 6, north: 8 });
    expect(a).toBeCloseTo(b, 9);
  });
});

// ─── buildSegmentsFromPoints ──────────────────────────────────────────

describe('segmentArrows — buildSegmentsFromPoints', () => {
  it('returns [] for an empty point list', () => {
    expect(buildSegmentsFromPoints([], new Set(), 'face-1')).toEqual([]);
  });
  it('returns [] for a single point (no edges yet)', () => {
    const pts = [{ lat: ALEX_LAT, lng: ALEX_LNG }];
    expect(buildSegmentsFromPoints(pts, new Set(), 'face-1')).toEqual([]);
  });
  it('returns 1 segment for 2 points, with stable id "seg-0"', () => {
    const pts = [
      { lat: ALEX_LAT, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG },
    ];
    const segs = buildSegmentsFromPoints(pts, new Set(), 'face-1');
    expect(segs).toHaveLength(1);
    expect(segs[0].id).toBe('seg-0');
    expect(segs[0].faceId).toBe('face-1');
    expect(segs[0].normalDir).toBe(1);
  });
  it('returns N-1 segments for N points with monotonically increasing ids', () => {
    const pts = [
      { lat: ALEX_LAT, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG + 0.001 },
      { lat: ALEX_LAT, lng: ALEX_LNG + 0.001 },
    ];
    const segs = buildSegmentsFromPoints(pts, new Set(), 'face-1');
    expect(segs).toHaveLength(3);
    expect(segs.map(s => s.id)).toEqual(['seg-0', 'seg-1', 'seg-2']);
  });
  it('respects flippedIds: the segment listed in the set gets normalDir = -1', () => {
    const pts = [
      { lat: ALEX_LAT, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG },
      { lat: ALEX_LAT + 0.001, lng: ALEX_LNG + 0.001 },
    ];
    const flipped = new Set(['seg-1']);
    const segs = buildSegmentsFromPoints(pts, flipped, 'face-1');
    expect(segs).toHaveLength(2);
    expect(segs[0].normalDir).toBe(1);
    expect(segs[1].normalDir).toBe(-1);
  });
  it('does not auto-close a polygon — the closing edge is the caller\'s job', () => {
    const NW = { lat: 38.819, lng: -77.083 };
    const NE = { lat: 38.819, lng: -77.081 };
    const SE = { lat: 38.817, lng: -77.081 };
    const SW = { lat: 38.817, lng: -77.083 };
    const segs = buildSegmentsFromPoints([NW, NE, SE, SW], new Set(), 'face-1');
    expect(segs).toHaveLength(3);
  });
  it('emits the same faceId on every segment of the call', () => {
    const segs = buildSegmentsFromPoints(
      [
        { lat: ALEX_LAT, lng: ALEX_LNG },
        { lat: ALEX_LAT + 0.001, lng: ALEX_LNG },
      ],
      new Set(),
      'face-hip-east',
    );
    expect(segs[0].faceId).toBe('face-hip-east');
  });
});

// ─── Roundtrip ────────────────────────────────────────────────────────

describe('segmentArrows — roundtrip', () => {
  it('the normal at normalDir=1 and normalDir=-1 are negatives of each other', () => {
    const a = { lat: ALEX_LAT, lng: -77.082 };
    const b = { lat: ALEX_LAT, lng: -77.080 };
    const centroid = { lat: ALEX_LAT, lng: -77.081 };
    const nPlus  = defaultOutwardNormal(a, b, centroid, ALEX_LAT);
    const nMinus = { east: -nPlus.east, north: -nPlus.north };
    expect(dot(nPlus, nMinus)).toBeCloseTo(-1, 9);
    const bPlus  = bearingOf(nPlus);
    const bMinus = bearingOf(nMinus);
    const diff = Math.abs(((bPlus - bMinus) + Math.PI) % (2 * Math.PI) - Math.PI);
    expect(diff).toBeCloseTo(Math.PI, 6);
  });
});
