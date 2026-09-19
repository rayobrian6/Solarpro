/**
 * tests/regularizeOutline.test.ts
 *
 * "One plane is larger than the other after marking my points. Need to correct."
 *
 * Buildings are rectilinear; traces of them are not, because the clicks are
 * eyeballed on blurry imagery. Squaring the outline fixes the unequal halves at
 * their source rather than compensating for them downstream.
 *
 * The two assertions that matter most pull in opposite directions, and both are
 * here on purpose:
 *   • a sloppy near-rectangle MUST come out square, or the feature is pointless;
 *   • a genuinely angled wing MUST be left alone, or the feature silently
 *     destroys correct geometry, which is far worse than doing nothing.
 */

import { describe, it, expect } from 'vitest';
import { regularizeOutline, alignSharedRidge, joinSharedCorners, dominantAxis, type LatLng } from '@/lib/3d/regularizeOutline';

const LAT = 38.8306;
const LNG = -89.5343;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);
const dLat = (m: number) => m / M_PER_DEG_LAT;
const dLng = (m: number) => m / mPerDegLng;
const at = (northM: number, eastM: number): LatLng => ({ lat: LAT + dLat(northM), lng: LNG + dLng(eastM) });

/** Metres between two lat/lng points. */
function distM(a: LatLng, b: LatLng): number {
  return Math.hypot((a.lng - b.lng) * mPerDegLng, (a.lat - b.lat) * M_PER_DEG_LAT);
}

/** Interior angles of a ring, in degrees. */
function cornerAngles(ring: LatLng[]): number[] {
  return ring.map((_, i) => {
    const p = ring[(i - 1 + ring.length) % ring.length], c = ring[i], n = ring[(i + 1) % ring.length];
    const v1 = { x: (p.lng - c.lng) * mPerDegLng, y: (p.lat - c.lat) * M_PER_DEG_LAT };
    const v2 = { x: (n.lng - c.lng) * mPerDegLng, y: (n.lat - c.lat) * M_PER_DEG_LAT };
    const d = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return Math.acos(Math.max(-1, Math.min(1, d))) / DEG;
  });
}

describe('regularizeOutline', () => {
  it('squares up a sloppy near-rectangle', () => {
    // 16 x 10 with every corner visibly off, as an eyeballed trace on blurry
    // imagery actually looks — several degrees, not a fraction of one.
    const sloppy = [at(-5.4, -8.0), at(-4.3, 8.6), at(5.5, 7.4), at(4.6, -8.7)];
    const before = cornerAngles(sloppy);
    expect(Math.max(...before.map(a => Math.abs(a - 90)))).toBeGreaterThan(1.5);

    const r = regularizeOutline(sloppy);
    expect(r.changed).toBe(true);
    expect(r.report.snapped).toBeGreaterThanOrEqual(3);
    const after = cornerAngles(r.outline);
    expect(Math.max(...after.map(a => Math.abs(a - 90)))).toBeLessThan(0.5);
  });

  it('LEAVES A GENUINELY ANGLED WING ALONE', () => {
    // A 45-degree chamfer is architecture, not scatter. Straightening it would
    // destroy real geometry, and quietly — nobody re-measures a corner the
    // software "fixed". This is the assertion that keeps the tolerance honest.
    const chamfered = [at(-5, -8), at(-5, 8), at(5, 8), at(5, 0), at(0, -8)];
    const r = regularizeOutline(chamfered);
    const idx = 4; // the chamfer vertex
    expect(distM(r.outline[Math.min(idx, r.outline.length - 1)], chamfered[idx])).toBeLessThan(1.0);
    // The long axis-aligned walls may snap; the 45-degree run must survive.
    const angles = cornerAngles(r.outline);
    expect(angles.some(a => Math.abs(a - 90) > 20)).toBe(true);
  });

  it('collapses double-clicked vertices', () => {
    const doubled = [at(-5, -8), at(-5, -7.9), at(-5, 8), at(5, 8), at(5, -8)];
    const r = regularizeOutline(doubled);
    expect(r.report.removed).toBeGreaterThanOrEqual(1);
    expect(r.outline.length).toBeLessThan(doubled.length);
  });

  it('drops a redundant point partway along a straight wall', () => {
    const extra = [at(-5, -8), at(-5, 0), at(-5, 8), at(5, 8), at(5, -8)];
    const r = regularizeOutline(extra);
    expect(r.report.removed).toBeGreaterThanOrEqual(1);
    expect(r.outline.length).toBe(4);
  });

  it('preserves the footprint — area and centroid barely move', () => {
    // Squaring must not resize the building. A correction that changed the area
    // would change the panel count, which is the number the customer sees.
    const sloppy = [at(-5.1, -8.0), at(-4.7, 8.2), at(5.2, 7.8), at(4.8, -8.3)];
    const r = regularizeOutline(sloppy);
    const areaOf = (ring: LatLng[]) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        a += ((p.lng - LNG) * mPerDegLng) * ((q.lat - LAT) * M_PER_DEG_LAT)
           - ((q.lng - LNG) * mPerDegLng) * ((p.lat - LAT) * M_PER_DEG_LAT);
      }
      return Math.abs(a) / 2;
    };
    const before = areaOf(sloppy), after = areaOf(r.outline);
    expect(after).toBeGreaterThan(before * 0.95);
    expect(after).toBeLessThan(before * 1.05);
    expect(r.report.maxShiftM).toBeLessThan(1.0);
  });

  it('works on a building that is not axis-aligned', () => {
    // A house at 30 degrees to north is still rectilinear in its OWN frame.
    // Snapping to compass north would wreck it.
    const rot = 30 * DEG;
    const corners: Array<[number, number]> = [[-5, -8], [-5, 8], [5, 8], [5, -8]];
    // Deterministic scatter (no Math.random in tests — a flaky geometry test is
    // worse than no test).
    const jitter = [0.18, -0.14, 0.11, -0.16];
    const rotated = corners.map(([n, e], i) => at(
      n * Math.cos(rot) - e * Math.sin(rot) + jitter[i],
      n * Math.sin(rot) + e * Math.cos(rot) + jitter[(i + 2) % 4],
    ));
    const axis = dominantAxis(rotated);
    // Walls originally ran N-S and E-W (bearings 0 and 90); rotating the
    // building 30 degrees puts them at 30 and 120. Either is the same axis.
    expect(Math.min(Math.abs(axis - 30), Math.abs(axis - 120))).toBeLessThan(12);
    const r = regularizeOutline(rotated);
    const after = cornerAngles(r.outline);
    expect(Math.max(...after.map(a => Math.abs(a - 90)))).toBeLessThan(2);
  });

  it('returns the input unchanged for degenerate rings', () => {
    expect(regularizeOutline([]).changed).toBe(false);
    expect(regularizeOutline([at(0, 0), at(0, 1)]).changed).toBe(false);
    const nan = [at(0, 0), { lat: NaN, lng: LNG }, at(1, 1)];
    expect(regularizeOutline(nan).changed).toBe(false);
  });

  it('never returns fewer than 3 vertices', () => {
    const tiny = [at(0, 0), at(0, 0.05), at(0.05, 0.05), at(0.05, 0)];
    expect(regularizeOutline(tiny).outline.length).toBeGreaterThanOrEqual(3);
  });
});

describe('alignSharedRidge', () => {
  it('makes two halves agree on the ridge exactly', () => {
    const south = [at(-6, -8), at(-6, 8), at(0.12, 8.1), at(-0.09, -7.9)];
    const north = [at(-0.05, -8.05), at(0.08, 7.95), at(6, 8), at(6, -8)];
    const before = distM(south[3], north[0]);
    expect(before).toBeGreaterThan(0.01);

    const { a, b, alignedPairs } = alignSharedRidge(south, north);
    expect(alignedPairs).toBeGreaterThanOrEqual(2);
    // Every aligned pair now coincides.
    expect(distM(a[3], b[0])).toBeLessThan(1e-6);
    expect(distM(a[2], b[1])).toBeLessThan(1e-6);
  });

  it('does NOT touch corners that are nowhere near each other', () => {
    const south = [at(-6, -8), at(-6, 8), at(0, 8), at(0, -8)];
    const north = [at(0, -8), at(0, 8), at(6, 8), at(6, -8)];
    const { a } = alignSharedRidge(south, north);
    // The far eave corners must stay exactly where the user put them.
    expect(distM(a[0], south[0])).toBeLessThan(1e-9);
    expect(distM(a[1], south[1])).toBeLessThan(1e-9);
  });

  it('deliberately does not force the two halves to equal depth', () => {
    // Saltboxes, additions and lean-tos are real. Forcing symmetry would
    // silently destroy a correct trace of one.
    const shallow = [at(-4, -8), at(-4, 8), at(0, 8), at(0, -8)];
    const deep = [at(0, -8), at(0, 8), at(9, 8), at(9, -8)];
    const { a, b } = alignSharedRidge(shallow, deep);
    expect(distM(a[0], a[3])).toBeCloseTo(4, 1);
    expect(distM(b[0], b[3])).toBeCloseTo(9, 1);
  });

  it('does not mutate its inputs', () => {
    const south = [at(-6, -8), at(-6, 8), at(0.1, 8), at(-0.1, -8)];
    const snapshot = JSON.stringify(south);
    alignSharedRidge(south, [at(0, -8), at(0, 8), at(6, 8), at(6, -8)]);
    expect(JSON.stringify(south)).toBe(snapshot);
  });
});

describe('joinSharedCorners — clustered, not pairwise', () => {
  const ring = (pts: Array<[number, number]>) => pts.map(([n, e]) => at(n, e));

  it('lands THREE faces meeting at a peak on ONE point', () => {
    // The case pairwise averaging cannot do. A-B then A-C (moving A again) then
    // B-C leaves three corners chasing each other, order-dependently.
    const peakish: Array<[string, Array<[number, number]>]> = [
      ['a', [[-6, -6], [-6, 6], [0.15, 0.10]]],
      ['b', [[-6, 6], [6, 6], [-0.12, -0.08]]],
      ['c', [[6, 6], [6, -6], [0.05, -0.14]]],
    ];
    const input = new Map(peakish.map(([id, p]) => [id, ring(p)]));
    const { rings, joined } = joinSharedCorners(input);
    expect(joined).toBeGreaterThan(0);

    const peaks = ['a', 'b', 'c'].map(id => rings.get(id)![2]);
    // All three apex corners must now be the SAME point.
    expect(distM(peaks[0], peaks[1])).toBeLessThan(1e-6);
    expect(distM(peaks[1], peaks[2])).toBeLessThan(1e-6);
  });

  it('is order-independent', () => {
    const mk = (order: string[]) => {
      const m = new Map<string, LatLng[]>();
      const src: Record<string, Array<[number, number]>> = {
        a: [[-6, -6], [-6, 6], [0.15, 0.10]],
        b: [[-6, 6], [6, 6], [-0.12, -0.08]],
        c: [[6, 6], [6, -6], [0.05, -0.14]],
      };
      for (const id of order) m.set(id, ring(src[id]));
      return joinSharedCorners(m).rings;
    };
    const fwd = mk(['a', 'b', 'c']).get('a')![2];
    const rev = mk(['c', 'b', 'a']).get('a')![2];
    expect(distM(fwd, rev)).toBeLessThan(1e-6);
  });

  it('never collapses two corners of the SAME face together', () => {
    // That would delete a real edge. Merging duplicates within one face is the
    // regularizer's job, with its own much tighter tolerance.
    const skinny = new Map<string, LatLng[]>([
      ['a', ring([[0, 0], [0, 1.0], [5, 1.0], [5, 0]])],
      ['b', ring([[5, 0], [5, 1.0], [9, 1.0], [9, 0]])],
    ]);
    const { rings } = joinSharedCorners(skinny);
    const a = rings.get('a')!;
    // The 1.0 m wide end of face A must still be 1.0 m wide.
    expect(distM(a[0], a[1])).toBeGreaterThan(0.9);
  });

  it('leaves far-apart corners exactly where they were', () => {
    const far = new Map<string, LatLng[]>([
      ['a', ring([[-6, -6], [-6, 6], [0, 6], [0, -6]])],
      ['b', ring([[20, -6], [20, 6], [26, 6], [26, -6]])],
    ]);
    const before = JSON.stringify([...far.values()]);
    const { rings, joined } = joinSharedCorners(far);
    expect(joined).toBe(0);
    expect(JSON.stringify([...rings.values()])).toBe(before);
  });

  it('does not mutate its input', () => {
    const input = new Map<string, LatLng[]>([
      ['a', ring([[-6, -6], [-6, 6], [0.1, 6]])],
      ['b', ring([[-0.1, 6], [6, 6], [6, -6]])],
    ]);
    const snapshot = JSON.stringify([...input.values()]);
    joinSharedCorners(input);
    expect(JSON.stringify([...input.values()])).toBe(snapshot);
  });

  it('handles a single face and an empty map without throwing', () => {
    expect(joinSharedCorners(new Map()).joined).toBe(0);
    const one = new Map<string, LatLng[]>([['a', ring([[0, 0], [0, 5], [5, 5]])]]);
    expect(joinSharedCorners(one).joined).toBe(0);
  });
});
