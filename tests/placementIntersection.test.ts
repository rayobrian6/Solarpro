/**
 * tests/placementIntersection.test.ts
 *
 * WHERE DID THE USER POINT? — proven without a GPU.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIVE FAILURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Tree -> click ground -> NO TREE APPEARS."
 *   "I also attempted to place a Chimney. It appears that Chimney may also not
 *    be wired end-to-end. Treat this as evidence that the problem may be
 *    broader than Tree."
 *
 * It was broader. Five handlers — obstruction, add-row, extend-row, snap-panel
 * and surface-select — each resolved their click with a bare
 * `viewer.scene.pickPosition(screenPos)`. That reads the depth buffer, so it
 * answers only where something has already been drawn and only where the depth
 * texture exists. On a property with no Google photorealistic mesh the buffer is
 * empty, the call returns undefined, and the handler returns having built
 * nothing. Two of the five did not even print a message.
 *
 * 🚨 THE WHOLE POINT OF THIS MODULE IS THAT IT NEEDS NOTHING RENDERED, so the
 * whole point of this file is that it proves the answer with plain numbers — no
 * Cesium, no canvas, no WebGL, no mocks of any of them. If these pass, a click
 * lands correctly on a machine whose driver has no depth texture at all.
 */

import { describe, it, expect } from 'vitest';
import {
  intersectRayWithFace,
  nearestFaceAlongRay,
  intersectRayWithGeocentricSphere,
  projectPointOntoFace,
  signedDistanceToFace,
  pointInRing2D,
  ringInFaceFrame,
  normalize,
  type PlanarFace,
  type Vec3,
} from '@/lib/3d/placementIntersection';

// ── helpers ─────────────────────────────────────────────────────────────────

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z);
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a: Vec3, k: number): Vec3 => v(a.x * k, a.y * k, a.z * k);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const unit = (a: Vec3) => normalize(a)!;

/**
 * A rectangular face `w` × `d`, centred on `origin`, whose frame is (u, v) and
 * whose normal is u × v. The frame origin is the face CENTRE, so the ring runs
 * from -w/2 to +w/2 — which is how the engine's own renderables are built.
 */
function rect(id: string, origin: Vec3, u: Vec3, vv: Vec3, w: number, d: number): PlanarFace {
  const U = unit(u);
  const V = unit(vv);
  const N = unit(cross(U, V));
  const corner = (su: number, sv: number) =>
    add(origin, add(mul(U, (su * w) / 2), mul(V, (sv * d) / 2)));
  return {
    id,
    origin,
    u: U,
    v: V,
    n: N,
    corners: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
  };
}

/** WGS84 lat/lng/height -> ECEF, so the precision tests run at real magnitudes. */
function ecef(latDeg: number, lngDeg: number, h: number): Vec3 {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return v(
    (N + h) * Math.cos(lat) * Math.cos(lng),
    (N + h) * Math.cos(lat) * Math.sin(lng),
    (N * (1 - e2) + h) * Math.sin(lat),
  );
}

/** Local east/north/up unit vectors at a geodetic point. */
function enu(latDeg: number, lngDeg: number) {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  const east = v(-Math.sin(lng), Math.cos(lng), 0);
  const north = v(
    -Math.sin(lat) * Math.cos(lng),
    -Math.sin(lat) * Math.sin(lng),
    Math.cos(lat),
  );
  const up = cross(east, north);
  return { east, north, up: unit(up) };
}

// A real address: the site the gauntlet keeps returning to.
const LAT = 38.7067;
const LNG = -90.1512;

// ═══════════════════════════════════════════════════════════════════════════
describe('a ray meets a face', () => {
  const face = rect('f1', v(0, 0, 10), v(1, 0, 0), v(0, 1, 0), 8, 6); // horizontal, 8×6, at z=10

  it('a ray straight down from above lands on the face centre', () => {
    const hit = intersectRayWithFace(v(0, 0, 40), v(0, 0, -1), face);
    expect(hit).not.toBeNull();
    expect(hit!.faceId).toBe('f1');
    expect(dist(hit!.point, v(0, 0, 10))).toBeLessThan(1e-9);
    expect(hit!.distanceAlongRay).toBeCloseTo(30, 9);
    expect(hit!.u).toBeCloseTo(0, 9);
    expect(hit!.v).toBeCloseTo(0, 9);
  });

  it('an off-centre ray reports where on the face it landed', () => {
    const hit = intersectRayWithFace(v(3, -2, 40), v(0, 0, -1), face);
    expect(hit!.u).toBeCloseTo(3, 9);
    expect(hit!.v).toBeCloseTo(-2, 9);
  });

  it('a ray outside the ring misses', () => {
    // 8×6 centred at the origin: |u| <= 4, |v| <= 3. u = 5 is off the edge.
    expect(intersectRayWithFace(v(5, 0, 40), v(0, 0, -1), face)).toBeNull();
    expect(intersectRayWithFace(v(0, 4, 40), v(0, 0, -1), face)).toBeNull();
  });

  it('🚨 a ray parallel to the plane misses instead of returning a wild point', () => {
    // The ill-conditioned case: denom -> 0 makes t explode. Returning a hit here
    // would place an object kilometres away from the cursor.
    expect(intersectRayWithFace(v(0, 0, 40), v(1, 0, 0), face)).toBeNull();
    expect(intersectRayWithFace(v(0, 0, 10), v(0, 1, 0), face)).toBeNull();
  });

  it('🚨 a face BEHIND the camera is not a hit', () => {
    // Looking up, away from a face that is below. Without the t > 0 guard the
    // algebra happily reports the intersection behind the viewer.
    expect(intersectRayWithFace(v(0, 0, 40), v(0, 0, 1), face)).toBeNull();
  });

  it('the hit lies ON the plane, for a tilted face', () => {
    // A 6/12 pitch (26.57°) deck.
    const tilt = Math.atan(6 / 12);
    const u = v(1, 0, 0);
    const vv = v(0, Math.cos(tilt), Math.sin(tilt));
    const sloped = rect('porch', v(0, 0, 4), u, vv, 10, 7);
    const hit = intersectRayWithFace(v(1.5, 0.5, 60), v(0, 0, -1), sloped);
    expect(hit).not.toBeNull();
    expect(Math.abs(signedDistanceToFace(hit!.point, sloped))).toBeLessThan(1e-9);
  });

  it('degenerate input returns null rather than throwing', () => {
    const bad: PlanarFace = { ...face, corners: [v(0, 0, 0), v(1, 0, 0)] };
    expect(intersectRayWithFace(v(0, 0, 40), v(0, 0, -1), bad)).toBeNull();
    expect(intersectRayWithFace(v(NaN, 0, 40), v(0, 0, -1), face)).toBeNull();
    expect(intersectRayWithFace(v(0, 0, 40), v(0, 0, 0), face)).toBeNull();
    expect(intersectRayWithFace(v(0, 0, 40), v(0, 0, -1), { ...face, n: v(0, 0, 0) })).toBeNull();
    expect(intersectRayWithFace(v(0, 0, 40), v(0, 0, -1), null as any)).toBeNull();
  });

  it('the ray direction need not be normalised — the distance is still metres', () => {
    const a = intersectRayWithFace(v(0, 0, 40), v(0, 0, -1), face);
    const b = intersectRayWithFace(v(0, 0, 40), v(0, 0, -17), face);
    expect(b!.distanceAlongRay).toBeCloseTo(a!.distanceAlongRay, 9);
    expect(dist(a!.point, b!.point)).toBeLessThan(1e-9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the NEAREST face wins, not the first one in the array', () => {
  // The real shape this guards: a garage deck at 4 m under a main roof at 8 m.
  // Iteration order is whatever order the faces happen to sit in, so taking the
  // first match put a chimney on whichever face was added first.
  const low = rect('garage', v(0, 0, 4), v(1, 0, 0), v(0, 1, 0), 20, 20);
  const high = rect('main', v(0, 0, 8), v(1, 0, 0), v(0, 1, 0), 20, 20);

  it('picks the face the camera can actually see', () => {
    const hit = nearestFaceAlongRay(v(0, 0, 50), v(0, 0, -1), [low, high]);
    expect(hit!.faceId).toBe('main');
  });

  it('…and gives the same answer whatever order the faces arrive in', () => {
    const a = nearestFaceAlongRay(v(0, 0, 50), v(0, 0, -1), [low, high]);
    const b = nearestFaceAlongRay(v(0, 0, 50), v(0, 0, -1), [high, low]);
    expect(a!.faceId).toBe(b!.faceId);
    expect(a!.faceId).toBe('main');
  });

  it('a camera BELOW both sees the lower one first', () => {
    const hit = nearestFaceAlongRay(v(0, 0, 0), v(0, 0, 1), [high, low]);
    expect(hit!.faceId).toBe('garage');
  });

  it('a ray that hits only the lower face returns the lower face', () => {
    // 🚨 THIS IS THE DETACHED-GARAGE CASE. The main roof is 20×20 centred at the
    // origin; the garage is offset so part of it sticks out beyond the main
    // roof's footprint. A click out there must find the garage, not nothing.
    const garage = rect('detached', v(30, 0, 4), v(1, 0, 0), v(0, 1, 0), 12, 8);
    const hit = nearestFaceAlongRay(v(30, 0, 50), v(0, 0, -1), [high, garage]);
    expect(hit!.faceId).toBe('detached');
  });

  it('no faces, or no hit, is null — never a throw and never a guess', () => {
    expect(nearestFaceAlongRay(v(0, 0, 50), v(0, 0, -1), [])).toBeNull();
    expect(nearestFaceAlongRay(v(0, 0, 50), v(0, 0, -1), null as any)).toBeNull();
    expect(nearestFaceAlongRay(v(500, 500, 50), v(0, 0, -1), [low, high])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the eave pad', () => {
  const face = rect('f', v(0, 0, 10), v(1, 0, 0), v(0, 1, 0), 8, 6);

  it('a click 10 cm past the edge is a click on the roof', () => {
    // |u| <= 4; 4.1 is 10 cm out.
    expect(intersectRayWithFace(v(4.1, 0, 40), v(0, 0, -1), face, { padM: 0.25 })).not.toBeNull();
  });

  it('…but a click a metre out is not', () => {
    expect(intersectRayWithFace(v(5, 0, 40), v(0, 0, -1), face, { padM: 0.25 })).toBeNull();
  });

  it('with no pad, the ring is the ring', () => {
    expect(intersectRayWithFace(v(4.1, 0, 40), v(0, 0, -1), face)).toBeNull();
  });

  it('🚨 the pad does not fold a non-convex ring shut', () => {
    // An L-shaped face. The notch is OUTSIDE the roof, and a pad implemented by
    // offsetting the ring would fold at the reflex corner and swallow it.
    const L: PlanarFace = {
      id: 'L',
      origin: v(0, 0, 10),
      u: v(1, 0, 0),
      v: v(0, 1, 0),
      n: v(0, 0, 1),
      corners: [
        v(0, 0, 10), v(10, 0, 10), v(10, 4, 10),
        v(4, 4, 10), v(4, 10, 10), v(0, 10, 10),
      ],
    };
    // (8, 8) sits in the notch — well clear of every edge.
    expect(pointInRing2D(8, 8, ringInFaceFrame(L), 0.25)).toBe(false);
    // …while a point inside the arm is inside.
    expect(pointInRing2D(2, 8, ringInFaceFrame(L), 0.25)).toBe(true);
    // …and a point just outside an edge is picked up by the pad.
    expect(pointInRing2D(10.1, 2, ringInFaceFrame(L), 0.25)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 ECEF magnitudes — where the arithmetic could quietly fall apart', () => {
  // Everything above runs at unit scale. Real coordinates are ~6.37e6 m, and a
  // roof face is 10 m across: the ratio is 1e-6, which is where a naive
  // formulation loses the answer in the mantissa. A chimney 30 cm from where it
  // was clicked is a chimney on the wrong side of a panel row.
  const { east, north, up } = enu(LAT, LNG);
  const ground = ecef(LAT, LNG, 140); // St Louis-ish elevation
  const roofCentre = add(ground, mul(up, 6.2));

  it('a 6/12 roof face at a real address is hit to sub-millimetre', () => {
    const tilt = Math.atan(6 / 12);
    const along = unit(add(mul(north, Math.cos(tilt)), mul(up, Math.sin(tilt))));
    const face = rect('roof', roofCentre, east, along, 12, 9);

    // A camera 300 m up, looking straight down at a point 2 m east of centre.
    const target = add(roofCentre, mul(east, 2));
    const camera = add(target, mul(up, 300));
    const hit = intersectRayWithFace(camera, mul(up, -1), face);

    expect(hit).not.toBeNull();
    // The ray is vertical through a point 2 m east, so the hit is that point
    // projected onto the sloped plane.
    expect(hit!.u).toBeCloseTo(2, 6);
    expect(Math.abs(signedDistanceToFace(hit!.point, face))).toBeLessThan(1e-3);
    expect(hit!.distanceAlongRay).toBeGreaterThan(290);
    expect(hit!.distanceAlongRay).toBeLessThan(310);
  });

  it('an oblique camera — the angle where depth picking was least reliable', () => {
    const face = rect('deck', roofCentre, east, north, 12, 9);
    const target = add(roofCentre, add(mul(east, -3), mul(north, 1.5)));
    // 40 m up and 60 m to the south: about 34° above the horizon.
    const camera = add(target, add(mul(up, 40), mul(north, -60)));
    const hit = intersectRayWithFace(camera, sub(target, camera), face);

    expect(hit).not.toBeNull();
    expect(dist(hit!.point, target)).toBeLessThan(1e-3);
    expect(hit!.u).toBeCloseTo(-3, 5);
    expect(hit!.v).toBeCloseTo(1.5, 5);
  });

  it('two stacked real roofs still resolve to the upper one', () => {
    const main = rect('main', add(ground, mul(up, 7)), east, north, 16, 11);
    const porch = rect('porch', add(ground, mul(up, 3)), east, north, 16, 11);
    const camera = add(ground, mul(up, 400));
    const hit = nearestFaceAlongRay(camera, mul(up, -1), [porch, main]);
    expect(hit!.faceId).toBe('main');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 the ground is a surface even when nothing is drawn', () => {
  // This is the Tree case. No tileset, no terrain, no entity — just a known
  // elevation, which is enough to intersect a ray with.
  const R = 6371000;

  it('a ray from above meets the ground at the ground radius', () => {
    const camera = v(0, 0, R + 500);
    const p = intersectRayWithGeocentricSphere(camera, v(0, 0, -1), R);
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.x, p!.y, p!.z)).toBeCloseTo(R, 6);
    expect(dist(p!, v(0, 0, R))).toBeLessThan(1e-6);
  });

  it('🚨 it returns the NEAR hit — the side of the earth the camera is on', () => {
    // A sphere has two intersections. The far one is on the opposite side of the
    // planet, which would place the tree several thousand kilometres away.
    const camera = v(0, 0, R + 1000);
    const p = intersectRayWithGeocentricSphere(camera, v(0, 0, -1), R)!;
    expect(p.z).toBeGreaterThan(0);
    expect(dist(p, camera)).toBeCloseTo(1000, 6);
  });

  it('an oblique ray meets it further away, and still on the sphere', () => {
    const camera = v(0, 0, R + 300);
    const dir = unit(v(1, 0, -1));
    const p = intersectRayWithGeocentricSphere(camera, dir, R)!;
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(R, 5);
    expect(p.x).toBeGreaterThan(0);
  });

  it('a ray pointing at the sky misses', () => {
    expect(intersectRayWithGeocentricSphere(v(0, 0, R + 500), v(0, 0, 1), R)).toBeNull();
  });

  it('a ray that passes over the horizon misses', () => {
    // Horizontal from 500 m up, which clears the sphere entirely.
    expect(intersectRayWithGeocentricSphere(v(0, 0, R + 500), v(1, 0, 0), R)).toBeNull();
  });

  it('the elevation is honoured: a higher ground radius is met sooner', () => {
    // The camera must clear both surfaces for this comparison to mean anything.
    const camera = v(0, 0, R + 4000);
    const atGround = intersectRayWithGeocentricSphere(camera, v(0, 0, -1), R)!;
    const atDenver = intersectRayWithGeocentricSphere(camera, v(0, 0, -1), R + 1600)!;
    // A site 1600 m up is met 1600 m earlier. Ignoring this is what put a traced
    // roof hundreds of pixels from where it was drawn at Denver elevations.
    expect(dist(camera, atDenver)).toBeCloseTo(dist(camera, atGround) - 1600, 5);
  });

  it('🚨 a camera INSIDE the ground sphere gets null, not the far side of Earth', () => {
    // 🚨 THIS TEST FOUND A LIVE LANDMINE AND IS KEPT AS THE PROOF.
    //
    // A ray meets a sphere twice. With the origin inside, the near root is behind
    // the camera and the far root is the shell's inside face. The first version
    // fell through to that root and returned a point 12,744 km away — a tree on
    // the opposite side of the planet, silently, with no error.
    //
    // It was reachable: the engine passed a MEAN earth radius, and at 38.7° N a
    // mean-radius sphere sits ~1.4 km above the real ground, so a camera 300 m up
    // was inside it on every single call.
    const camera = v(0, 0, R + 500);
    expect(intersectRayWithGeocentricSphere(camera, v(0, 0, -1), R + 1600)).toBeNull();
    // Far enough below to be underground, not merely a stale elevation.
    expect(intersectRayWithGeocentricSphere(v(0, 0, R - 50), v(0, 0, -1), R)).toBeNull();
  });

  it('…but a camera sitting essentially on the surface still places', () => {
    // A ground elevation stale by a metre must not disarm the tool.
    const p = intersectRayWithGeocentricSphere(v(0, 0, R - 0.5), v(1, 0, -0.02), R);
    expect(p).not.toBeNull();
    expect(Math.hypot(p!.x, p!.y, p!.z)).toBeCloseTo(R, 3);
  });

  it('bad input is null, not a throw', () => {
    expect(intersectRayWithGeocentricSphere(v(NaN, 0, 0), v(0, 0, -1), R)).toBeNull();
    expect(intersectRayWithGeocentricSphere(v(0, 0, R + 1), v(0, 0, 0), R)).toBeNull();
    expect(intersectRayWithGeocentricSphere(v(0, 0, R + 1), v(0, 0, -1), 0)).toBeNull();
    expect(intersectRayWithGeocentricSphere(v(0, 0, R + 1), v(0, 0, -1), -5)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('projection helpers', () => {
  const tilt = Math.atan(4 / 12);
  const face = rect('f', v(0, 0, 5), v(1, 0, 0), v(0, Math.cos(tilt), Math.sin(tilt)), 10, 10);

  it('projecting a point onto the plane leaves it on the plane', () => {
    const p = v(2, 1, 40);
    const onPlane = projectPointOntoFace(p, face)!;
    expect(Math.abs(signedDistanceToFace(onPlane, face))).toBeLessThan(1e-9);
  });

  it('the signed distance is positive above and negative below', () => {
    const above = add(face.origin, mul(face.n, 3));
    const below = add(face.origin, mul(face.n, -3));
    expect(signedDistanceToFace(above, face)).toBeCloseTo(3, 9);
    expect(signedDistanceToFace(below, face)).toBeCloseTo(-3, 9);
    expect(signedDistanceToFace(face.origin, face)).toBeCloseTo(0, 9);
  });

  it('a point already on the plane is unmoved by projection', () => {
    const p = add(face.origin, add(mul(face.u, 2), mul(face.v, -1)));
    expect(dist(projectPointOntoFace(p, face)!, p)).toBeLessThan(1e-9);
  });

  it('bad input is null/NaN rather than a throw', () => {
    expect(projectPointOntoFace(v(NaN, 0, 0), face)).toBeNull();
    expect(projectPointOntoFace(v(0, 0, 0), { ...face, n: v(0, 0, 0) })).toBeNull();
    expect(Number.isNaN(signedDistanceToFace(v(NaN, 0, 0), face))).toBe(true);
  });

  it('normalize refuses a zero-length vector instead of returning NaNs', () => {
    expect(normalize(v(0, 0, 0))).toBeNull();
    expect(normalize(v(NaN, 1, 1))).toBeNull();
    const n = normalize(v(3, 4, 0))!;
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('the ring test itself', () => {
  const square: Array<[number, number]> = [[0, 0], [4, 0], [4, 4], [0, 4]];

  it('inside, outside, and the degenerate cases', () => {
    expect(pointInRing2D(2, 2, square)).toBe(true);
    expect(pointInRing2D(5, 2, square)).toBe(false);
    expect(pointInRing2D(-1, 2, square)).toBe(false);
    expect(pointInRing2D(2, 2, [[0, 0], [1, 1]])).toBe(false);
    expect(pointInRing2D(2, 2, null as any)).toBe(false);
    expect(pointInRing2D(NaN, 2, square)).toBe(false);
  });

  it('winding order does not change the answer', () => {
    const reversed = [...square].reverse() as Array<[number, number]>;
    expect(pointInRing2D(2, 2, reversed)).toBe(true);
    expect(pointInRing2D(9, 9, reversed)).toBe(false);
  });

  it('ringInFaceFrame round-trips a face to its own coordinates', () => {
    const f = rect('r', v(100, 200, 300), v(1, 0, 0), v(0, 1, 0), 6, 4);
    const ring = ringInFaceFrame(f);
    expect(ring).toHaveLength(4);
    // Centred frame: corners at (±3, ±2).
    for (const [u, vv] of ring) {
      expect(Math.abs(u)).toBeCloseTo(3, 9);
      expect(Math.abs(vv)).toBeCloseTo(2, 9);
    }
    expect(pointInRing2D(0, 0, ring)).toBe(true);
    expect(pointInRing2D(3.5, 0, ring)).toBe(false);
  });
});
