/**
 * tests/verticalDragMath.test.ts
 *
 * DRAGGING A VERTICAL HANDLE MUST ACTUALLY MEASURE THE DRAG.
 *
 * The block-height drag in SolarEngine3D computed
 *
 *     const t            = (centroid.z - ray.origin.z) / dir.z;
 *     const cursorYWorld =  ray.origin.z + dir.z * t;
 *
 * Substitute `t` into the second line and it reduces to `centroid.z`, for EVERY
 * cursor position. `dyWorld` was therefore always 0, the prism never moved, and
 * the status bar reported a height the whole time — "↕ Block height: 6.0m" from
 * the first pixel of the drag to the last. An audit measured a residual of
 * exactly 0.000e+0 m across 143 simulated cursor positions.
 *
 * It also measured against ECEF z — the direction to the pole — which is only
 * "up" on the equator.
 *
 * This file reproduces BOTH the old arithmetic and the new, on real Cesium
 * geometry, so the difference is measured rather than asserted.
 */

import { describe, it, expect } from 'vitest';
import * as C from 'cesium';

const LAT = 38.73, LNG = -90.23, GROUND = 150, START_H = 6;

/** The block's anchor: its centroid, at ground + start height. */
const anchor = C.Cartesian3.fromDegrees(LNG, LAT, GROUND + START_H);

/**
 * A cursor ray looking down at the anchor from the south-west, offset
 * vertically by `screenDy` metres at the anchor's distance — which is what
 * moving the mouse up or down does.
 */
function rayLookingAt(screenDy: number): C.Ray {
  const eye = C.Cartesian3.fromDegrees(LNG - 0.0006, LAT - 0.0006, GROUND + 60);
  const target = C.Cartesian3.fromDegrees(LNG, LAT, GROUND + START_H + screenDy);
  const dir = C.Cartesian3.normalize(
    C.Cartesian3.subtract(target, eye, new C.Cartesian3()), new C.Cartesian3());
  return new C.Ray(eye, dir);
}

/** THE OLD ARITHMETIC, reproduced verbatim. */
function legacyCursorY(ray: C.Ray, centroid: C.Cartesian3): number | null {
  const dir = ray.direction;
  const upDot = dir.z;
  if (Math.abs(upDot) < 0.001) return null;
  const t = (centroid.z - ray.origin.z) / upDot;
  if (t <= 0) return null;
  return ray.origin.z + dir.z * t;
}

/** THE FIX: closest approach between the cursor ray and the local vertical. */
function rayHeightAlongVertical(ray: C.Ray, anchorPt: C.Cartesian3): number | null {
  const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(anchorPt, new C.Cartesian3());
  if (!up) return null;
  const d = ray.direction;
  const w0 = C.Cartesian3.subtract(ray.origin, anchorPt, new C.Cartesian3());
  const b = C.Cartesian3.dot(d, up);
  const denom = 1 - b * b;
  if (Math.abs(denom) < 1e-6) return null;
  const dd = C.Cartesian3.dot(d, w0);
  const ee = C.Cartesian3.dot(up, w0);
  const u = (ee - b * dd) / denom;
  return isFinite(u) ? u : null;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the old arithmetic could only ever return the centroid', () => {
  it('every cursor position produces the SAME number — a residual of zero', () => {
    const vals: number[] = [];
    for (let dy = -20; dy <= 20; dy += 0.5) {
      const v = legacyCursorY(rayLookingAt(dy), anchor);
      if (v != null) vals.push(v);
    }
    expect(vals.length, 'the sweep produced nothing to measure').toBeGreaterThan(50);
    const spread = Math.max(...vals) - Math.min(...vals);
    // Not "small". ZERO, to floating point.
    expect(spread).toBeLessThan(1e-6);
    // …and the number is the centroid's own ECEF z.
    expect(vals[0]).toBeCloseTo(anchor.z, 6);
  });
});

describe('the replacement tracks the cursor', () => {
  it('🚨 moving the cursor up by N metres raises the height by N metres', () => {
    const u0 = rayHeightAlongVertical(rayLookingAt(0), anchor)!;
    expect(u0).not.toBeNull();

    for (const dy of [-8, -3, -0.5, 0.5, 3, 8]) {
      const u = rayHeightAlongVertical(rayLookingAt(dy), anchor)!;
      const delta = u - u0;
      // The ray is aimed at a point dy metres above the anchor, so the closest
      // approach to the vertical is dy metres along it.
      expect(delta, `cursor ${dy} m`).toBeCloseTo(dy, 2);
    }
  });

  it('it is monotonic, so the drag never reverses under the cursor', () => {
    let prev = -Infinity;
    for (let dy = -15; dy <= 15; dy += 0.5) {
      const u = rayHeightAlongVertical(rayLookingAt(dy), anchor)!;
      expect(u).toBeGreaterThan(prev);
      prev = u;
    }
  });

  it('it refuses when the camera looks straight along the handle', () => {
    // Directly overhead: the ray and the vertical are parallel, so there is no
    // closest approach to speak of and a drag has no meaning.
    const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new C.Cartesian3());
    const eye = C.Cartesian3.add(
      anchor, C.Cartesian3.multiplyByScalar(up, 400, new C.Cartesian3()), new C.Cartesian3());
    const dir = C.Cartesian3.negate(up, new C.Cartesian3());
    expect(rayHeightAlongVertical(new C.Ray(eye, dir), anchor)).toBeNull();
  });

  it('🚨 it measures the LOCAL vertical, not ECEF z', () => {
    // ECEF z points at the NORTH POLE. Local up points away from the Earth's
    // surface. The angle between them is (90° − latitude), so at 38.73° N they
    // are 51.27° apart — measured below rather than asserted from memory,
    // because a first version of this test said 38.7° and failed. ECEF z is
    // only "up" on the equator, and is exactly HORIZONTAL at the pole.
    const up = C.Ellipsoid.WGS84.geodeticSurfaceNormal(anchor, new C.Cartesian3());
    const zAxis = new C.Cartesian3(0, 0, 1);
    const angle = Math.acos(Math.abs(C.Cartesian3.dot(up, zAxis))) * 180 / Math.PI;
    expect(angle).toBeCloseTo(90 - LAT, 0);
    expect(angle).toBeGreaterThan(50);

    // A drag measured against ECEF z is therefore short by cos of that angle —
    // 37% at this latitude, before the no-op above is even considered.
    expect(Math.cos(angle * Math.PI / 180)).toBeLessThan(0.65);
  });
});

describe('🚨 the handle position is a coordinate, not a height', () => {
  it('writing a metres-above-ground number into ECEF z moves it 3,969 km', () => {
    // The old code built `new Cartesian3(centroid.x, centroid.y, newHeight + 0.3)`
    // — keeping the ECEF x and y, which are millions of metres, and replacing
    // z with a small local number. The handle left the planet on the first
    // mouse-move, so the drag had nothing to hold.
    const broken = new C.Cartesian3(anchor.x, anchor.y, START_H + 0.3);
    const drift = C.Cartesian3.distance(anchor, broken);
    expect(drift).toBeGreaterThan(3_900_000);
    expect(drift).toBeLessThan(4_100_000);
  });

  it('…and rebuilding it from the anchor lat/lng puts it where it belongs', () => {
    const carto = C.Cartographic.fromCartesian(anchor);
    const groundM = carto.height - START_H;
    expect(groundM).toBeCloseTo(GROUND, 3);

    const fixed = C.Cartesian3.fromRadians(
      carto.longitude, carto.latitude, groundM + (START_H + 4) + 0.3);
    // Four metres taller plus the 0.3 m clearance — and nothing else moved.
    expect(C.Cartesian3.distance(anchor, fixed)).toBeCloseTo(4.3, 2);
    const back = C.Cartographic.fromCartesian(fixed);
    expect(C.Math.toDegrees(back.latitude)).toBeCloseTo(LAT, 9);
    expect(C.Math.toDegrees(back.longitude)).toBeCloseTo(LNG, 9);
  });
});
