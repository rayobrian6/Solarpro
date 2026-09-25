/**
 * tests/vertexMoveValidation.test.ts
 *
 * WHAT A CORNER DRAG IS NOT ALLOWED TO PRODUCE.
 *
 * Three refusals, and they are not interchangeable:
 *
 *   MIN EDGE   — CLAMPS. The corner keeps following the cursor in the direction
 *                it is still free in. A drag that goes dead near a limit reads
 *                as a broken tool, and direct manipulation that stops
 *                responding is worse than one that resists.
 *
 *   SELF-INTERSECTION — REFUSES. There is no useful clamped position near a
 *                bow-tie: the nearest legal point is on the far side of the edge
 *                being dragged through. This is the expensive one. A
 *                self-intersecting QUADRILATERAL still looks like a
 *                quadrilateral, and the measured consequences on a footprint
 *                were a 12x8 m rectangle at 38.67N asking for 30 deg coming out
 *                as 69.19 m2 at 60 deg instead of 110.77 m2 at 30 deg — 38% less
 *                roof, double the pitch, azimuths 53 deg out — reported as
 *                valid. That flows into the panel grid, the tilt PVWatts reads,
 *                the BOM and the permit drawing.
 *
 *   MIN AREA   — REFUSES. A face collapsed to a sliver divides by zero somewhere
 *                downstream rather than failing where it was caused.
 *
 * 🚨 THE TESTED FUNCTION IS DELIBERATELY NOT `validateVertexMove` from
 * `lib/3d/vertexHandlesMath.ts`. That one takes a spec describing a
 * Block/Gable/Hip/Tree primitive, works in lat/lng, and has NO
 * self-intersection test at all — the one check above that can prevent a
 * silently wrong permit.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveVertexMove,
  ringAreaM2,
  MIN_FACE_AREA_M2,
} from '@/lib/3d/vertexMove';
import { MIN_SECTION_EDGE_M, ringIsSimple, segmentsCross } from '@/lib/3d/buildingSection';

/** A 12 x 8 m rectangle in the face's own (u,v) metres, wound counter-clockwise. */
const RECT = [
  { e: 0,  n: 0 },
  { e: 12, n: 0 },
  { e: 12, n: 8 },
  { e: 0,  n: 8 },
];

describe('the shared self-intersection authority', () => {
  it('ringIsSimple accepts a rectangle and rejects the reading-order bow-tie', () => {
    expect(ringIsSimple(RECT)).toBe(true);
    // NW, NE, SW, SE — the natural mis-click, and a bow-tie.
    expect(ringIsSimple([
      { e: 0, n: 8 }, { e: 12, n: 8 }, { e: 0, n: 0 }, { e: 12, n: 0 },
    ])).toBe(false);
  });

  it('counts TOUCHING, not only strict crossing', () => {
    // A corner landing exactly ON the opposite edge does not enclose a
    // building either, and the first version of this guard let four such
    // footprints through.
    expect(segmentsCross({ e: 0, n: 0 }, { e: 10, n: 0 }, { e: 5, n: 0 }, { e: 5, n: 5 })).toBe(true);
    expect(ringIsSimple([{ e: 0, n: 0 }, { e: 1, n: 0 }])).toBe(false);
  });
});

describe('minimum edge CLAMPS rather than refusing', () => {
  it('a corner dragged onto its neighbour is held half a metre away', () => {
    const r = resolveVertexMove(RECT, 1, { e: 0.05, n: 0.0 });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.clamped).toBe(true);
    const d = Math.hypot(r.point.e - RECT[0].e, r.point.n - RECT[0].n);
    expect(d).toBeCloseTo(MIN_SECTION_EDGE_M, 6);
    expect(MIN_SECTION_EDGE_M).toBe(0.5);
  });

  it('clamping is against BOTH neighbours, not just the first one checked', () => {
    const r = resolveVertexMove(RECT, 1, { e: 0.05, n: 0.02 });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const dPrev = Math.hypot(r.point.e - RECT[0].e, r.point.n - RECT[0].n);
    const dNext = Math.hypot(r.point.e - RECT[2].e, r.point.n - RECT[2].n);
    expect(dPrev).toBeGreaterThanOrEqual(MIN_SECTION_EDGE_M - 1e-6);
    expect(dNext).toBeGreaterThanOrEqual(MIN_SECTION_EDGE_M - 1e-6);
  });

  it('a corner landing EXACTLY on its neighbour still resolves — no divide by zero', () => {
    const r = resolveVertexMove(RECT, 1, { e: 0, n: 0 });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(Number.isFinite(r.point.e)).toBe(true);
    expect(Number.isFinite(r.point.n)).toBe(true);
    expect(Math.hypot(r.point.e - RECT[0].e, r.point.n - RECT[0].n)).toBeCloseTo(MIN_SECTION_EDGE_M, 6);
  });

  it('a move well clear of both neighbours is not clamped at all', () => {
    const r = resolveVertexMove(RECT, 1, { e: 15, n: -2 });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.clamped).toBe(false);
    expect(r.point).toEqual({ e: 15, n: -2 });
  });
});

describe('🚨 self-intersection REFUSES — the bow-tie must not commit', () => {
  it('dragging corner 0 across the far edge folds the ring and is refused', () => {
    // (0,0) -> (0,16) sends edge P0-P1 clean through the opposite edge P2-P3,
    // which crosses it at e=6. That is the fold.
    const r = resolveVertexMove(RECT, 0, { e: 0, n: 16 });
    expect(r.status).toBe('refused');
    if (r.status === 'ok') return;
    expect(r.refusal).toBe('SELF_INTERSECTING');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('and the refusal is about the RING, not about the distance moved', () => {
    // 🚨 THE SAME CORNER MOVED JUST AS FAR, OUTWARD, IS PERFECTLY LEGAL — and
    // so is a move that makes the face non-convex. A guard that refused on
    // distance, or on convexity, would make the feature useless on exactly the
    // faces that need it: automation gets the roof 90% right and the 10% fix is
    // usually an L-shape or a clipped corner.
    expect(resolveVertexMove(RECT, 0, { e: 0, n: -16 }).status).toBe('ok');
    // Non-convex but simple: corner 0 pulled INTO the rectangle.
    const dented = resolveVertexMove(RECT, 0, { e: 6, n: 4 });
    expect(dented.status).toBe('ok');
  });

  it('a corner dragged exactly onto the opposite edge is refused too', () => {
    const r = resolveVertexMove(RECT, 0, { e: 12, n: 4 });
    expect(r.status).toBe('refused');
  });
});

describe('minimum area REFUSES', () => {
  it('collapsing a triangle to a sliver is refused', () => {
    const tri = [{ e: 0, n: 0 }, { e: 4, n: 0 }, { e: 2, n: 3 }];
    const r = resolveVertexMove(tri, 2, { e: 2, n: 0.05 });
    expect(r.status).toBe('refused');
    if (r.status === 'ok') return;
    expect(r.refusal).toBe('AREA_TOO_SMALL');
  });

  it('the floor is well below any real roof face', () => {
    expect(MIN_FACE_AREA_M2).toBeLessThan(1);
    expect(ringAreaM2(RECT)).toBe(96);
  });

  it('a big but legal shrink is still allowed', () => {
    const r = resolveVertexMove(RECT, 2, { e: 1.0, n: 1.0 });
    expect(r.status).toBe('ok');
  });
});

describe('degenerate inputs are refused rather than crashing', () => {
  it('a two-point ring cannot be edited', () => {
    const r = resolveVertexMove([{ e: 0, n: 0 }, { e: 1, n: 0 }], 0, { e: 2, n: 2 });
    expect(r.status).toBe('refused');
    if (r.status === 'ok') return;
    expect(r.refusal).toBe('RING_TOO_SHORT');
  });

  it('two neighbours closer together than the minimum edge refuse rather than loop', () => {
    // prev and next are 0.2 m apart, so no point satisfies both discs by
    // alternating projection. The bounded loop must exit and SAY so.
    const tight = [{ e: 0, n: 0 }, { e: 5, n: 5 }, { e: 0.2, n: 0 }, { e: -5, n: 5 }];
    const r = resolveVertexMove(tight, 1, { e: 0.1, n: 0.0 });
    if (r.status !== 'ok') {
      expect(['EDGE_UNRESOLVABLE', 'SELF_INTERSECTING', 'AREA_TOO_SMALL']).toContain(r.refusal);
    } else {
      // If it did resolve, it must genuinely satisfy both bounds — the one
      // thing that must never happen is a silent violation.
      expect(Math.hypot(r.point.e - 0, r.point.n - 0)).toBeGreaterThanOrEqual(MIN_SECTION_EDGE_M - 1e-6);
      expect(Math.hypot(r.point.e - 0.2, r.point.n - 0)).toBeGreaterThanOrEqual(MIN_SECTION_EDGE_M - 1e-6);
    }
  });

  it('the returned ring is the candidate, with only the moved corner changed', () => {
    const r = resolveVertexMove(RECT, 3, { e: -2, n: 9 });
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.ring).toHaveLength(4);
    expect(r.ring[0]).toEqual(RECT[0]);
    expect(r.ring[1]).toEqual(RECT[1]);
    expect(r.ring[2]).toEqual(RECT[2]);
    expect(r.ring[3]).toEqual(r.point);
    // And the input was not mutated.
    expect(RECT[3]).toEqual({ e: 0, n: 8 });
  });
});
