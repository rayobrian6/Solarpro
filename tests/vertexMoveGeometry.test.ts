/**
 * tests/vertexMoveGeometry.test.ts
 *
 * THE IN-PLANE INVARIANT, AND THE TWO WAYS A CORNER DRAG CORRUPTS A ROOF.
 *
 * Moving a roof corner is allowed to change ONE thing: the outline. If it can
 * also change the pitch, the azimuth, the face's height or its id, then it is
 * not an outline edit — it is an untraceable edit to whatever the permit quotes.
 *
 *   1. PITCH AND AZIMUTH. The Newell fit in `computePlaneFromPoints3D` takes the
 *      best-fit normal across ALL corners. Hand it a ring with one corner lifted
 *      off the plane and it does not reject it — it absorbs the excursion by
 *      tilting the WHOLE face by a fraction of it. `plane.pitch` reaches the
 *      planset and the structural engine, so the roof the installer shaped and
 *      the pitch the permit quotes would disagree permanently, with no single
 *      corner to blame. `inPlaneTarget` drops the normal component by
 *      construction, which is what makes this class of defect unreachable
 *      rather than merely unlikely.
 *
 *   2. THE HEIGHT RATCHET. `computePlaneFromPoints3D` lifts its output
 *      SURFACE_OFFSET_M along the normal unconditionally. Re-fitting points that
 *      were ALREADY lifted raises the face another 12 cm EVERY time — Stitch did
 *      exactly this and floated the roof, and every panel on it, a little higher
 *      per press, with no obvious cause. A corner drag re-fits the ring on every
 *      release, so it is the same trap with a faster trigger.
 *
 * Everything here is at Granite City's latitude, 38.67N. That is not decoration:
 * `tests/vertexHandles.test.ts` checks its pick maths at latitude 0, where the
 * sphere it approximates the Earth with coincides with the ellipsoid, so the
 * error it exists to have is exactly zero in its own fixture. A geodesy test at
 * the equator proves nothing about a roof in Illinois.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRoofPlane3D,
  computePlaneFromPoints3D,
  latLngToECEF,
  ecefToLatLng,
  sub3, add3, scale3, dot3, cross3, mag3, normalize3,
  type Cart3,
} from '@/lib/roofPlane3D';
import {
  inPlaneTarget,
  movedPlanVertices,
  detectPlanLiftM,
  projectIntoFace,
  faceUVToEcef,
  ringToFaceUV,
  nearestVertexAlongRay,
  handleRadiusM,
  ringMoved,
  ringAreaM2,
  HANDLE_MIN_RADIUS_M,
  HANDLE_MAX_RADIUS_M,
  type FaceBasis,
} from '@/lib/3d/vertexMove';
import { roofPlanesSignature, SIGNED_FIELDS } from '@/lib/roofPlanesSignature';

const SITE_LAT = 38.67;
const SITE_LNG = -90.15;

/**
 * A real 6:12 (26.57 deg) south-facing face, built through the SAME authority
 * the product uses, so the fixture cannot be more convenient than reality.
 */
function buildFace() {
  const pitchRad = Math.atan(6 / 12);
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);
  // 10 m along the eave (east-west), 6 m up the slope (north-south in plan).
  const eaveM = 10, runM = 6;
  const rise = runM * Math.tan(pitchRad);
  const baseH = 30;
  const corners: Cart3[] = [
    latLngToECEF(SITE_LAT,                      SITE_LNG,                     baseH),
    latLngToECEF(SITE_LAT,                      SITE_LNG + eaveM / mPerDegLng, baseH),
    latLngToECEF(SITE_LAT + runM / mPerDegLat,  SITE_LNG + eaveM / mPerDegLng, baseH + rise),
    latLngToECEF(SITE_LAT + runM / mPerDegLat,  SITE_LNG,                      baseH + rise),
  ];
  const plane = buildRoofPlane3D(corners);
  const basis: FaceBasis = {
    origin: plane.origin3D!,
    u: plane.ecefFrame3D!.u,
    v: plane.ecefFrame3D!.v,
    n: plane.ecefFrame3D!.n,
  };
  return { plane, basis, ring: plane.polygon3D as Cart3[] };
}

describe('the face fixture is a real roof, not a convenient one', () => {
  it('is a 6:12 face at 38.67N with a planar ring', () => {
    const { plane, basis, ring } = buildFace();
    expect(plane.pitch).toBeGreaterThan(26);
    expect(plane.pitch).toBeLessThan(27.2);
    for (const p of ring) {
      // Every corner sits in the plane through origin3D: the premise the whole
      // gesture rests on.
      expect(Math.abs(dot3(sub3(p, basis.origin), basis.n))).toBeLessThan(1e-6);
    }
  });
});

describe('🚨 the move is (du, dv, 0) — the zero is the design', () => {
  it('drops the out-of-plane component for rays swept far off nadir', () => {
    const { basis, ring } = buildFace();
    const p0 = ring[2];

    // Sweep a cursor target that is DELIBERATELY off the plane, as a pick ray
    // hit would be if anything upstream were sloppy, and at large obliquity.
    // This is the case a sphere-of-the-equatorial-radius approximation gets
    // wrong by kilometres and its own equatorial fixture cannot see.
    const up = normalize3(p0);
    const east = normalize3(cross3({ x: 0, y: 0, z: 1 }, up));
    const north = normalize3(cross3(up, east));

    for (let deg = 0; deg <= 80; deg += 5) {
      for (const sign of [1, -1]) {
        const rad = (deg * Math.PI) / 180;
        // A point 12 m away in plan, plus a deliberate vertical excursion that
        // grows with the obliquity — the worst case for an off-nadir drag.
        const offset = add3(
          add3(scale3(east, sign * 12 * Math.cos(rad)), scale3(north, sign * 12 * Math.sin(rad))),
          scale3(up, sign * 4 * Math.sin(rad)),
        );
        const hit = add3(p0, offset);
        const moved = inPlaneTarget(p0, hit, basis);
        const outOfPlane = dot3(sub3(moved, p0), basis.n);
        expect(Math.abs(outOfPlane), `(P1 - P0).n must vanish at ${deg} deg`).toBeLessThan(1e-9);
      }
    }
  });

  it('and the moved corner stays in the face plane, not merely near it', () => {
    const { basis, ring } = buildFace();
    const p0 = ring[0];
    const hit = add3(p0, { x: 3.1, y: -4.2, z: 9.7 });
    const moved = inPlaneTarget(p0, hit, basis);
    expect(Math.abs(dot3(sub3(moved, basis.origin), basis.n))).toBeLessThan(1e-6);
  });

  it('keeps the in-plane part of the delta exactly — it constrains, it does not damp', () => {
    const { basis, ring } = buildFace();
    const p0 = ring[1];
    const want = add3(p0, add3(scale3(basis.u, 2.5), scale3(basis.v, -1.25)));
    const moved = inPlaneTarget(p0, want, basis);
    const d = sub3(moved, p0);
    expect(dot3(d, basis.u)).toBeCloseTo(2.5, 9);
    expect(dot3(d, basis.v)).toBeCloseTo(-1.25, 9);
  });
});

describe('🚨 pitch, azimuth and the frame cannot move on an outline edit', () => {
  it('a 1.8 m corner move leaves the ECEF normal BIT-IDENTICAL', () => {
    // 🚨 THE ECEF NORMAL IS THE ASSERTION THAT MATTERS, and it is exact.
    // `pitch` and `azimuth` are the same normal READ OUT against local up, and
    // local up is not the same direction in two different places — see the case
    // below. The frame is the thing panels are placed on and the thing a stale
    // triad corrupts, so it is pinned to nine places, not to a tolerance.
    const { basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, add3(scale3(basis.u, 1.8), scale3(basis.v, 0.9))), basis) : p);

    const rebuilt = buildRoofPlane3D(moved, { surfaceOffsetM: 0 });
    expect(rebuilt.ecefFrame3D!.n.x).toBeCloseTo(basis.n.x, 9);
    expect(rebuilt.ecefFrame3D!.n.y).toBeCloseTo(basis.n.y, 9);
    expect(rebuilt.ecefFrame3D!.n.z).toBeCloseTo(basis.n.z, 9);
  });

  it('pitch and azimuth move only by the GEODETIC term, which is ~1e-6 deg', () => {
    // 🚨 THIS IS NOT FLOAT NOISE AND IT IS NOT A DEFECT — it is measured, and
    // writing it down is cheaper than someone re-deriving it from a red test.
    //
    // `computePlaneFromPoints3D` takes tilt as acos of the ENU z-component of
    // the normal, and it builds that ENU basis from
    // `geodeticSurfaceNormal(centroid)` — local up at the RING'S CENTROID.
    // Moving a corner moves the centroid, and local up rotates by roughly
    // (centroid shift) / (Earth radius). A 0.5 m shift is 8e-8 rad, i.e. about
    // 4e-6 degrees. The plane did not tilt; the ruler it is read against did.
    //
    // 4e-6 deg is 0.015 arcseconds. At 6:12 it is a rise change of 3 parts per
    // billion — far below the 0.1 deg the planset prints, let alone anything a
    // structural engineer or a pitch gauge can distinguish. The bound is set at
    // 1e-4 so a REAL tilt — the out-of-plane control below moves it by more than
    // half a degree — still fails loudly.
    const { plane, basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, add3(scale3(basis.u, 1.8), scale3(basis.v, 0.9))), basis) : p);

    const rebuilt = buildRoofPlane3D(moved, { surfaceOffsetM: 0 });
    expect(Math.abs(rebuilt.pitch - plane.pitch)).toBeLessThan(1e-4);
    expect(Math.abs(rebuilt.azimuth - plane.azimuth)).toBeLessThan(1e-4);
  });

  it('but an OUT-OF-PLANE corner DOES tilt the whole face — the defect being prevented', () => {
    // This is the control. If this case ever stops changing the pitch, the
    // invariant above has become vacuous and proves nothing.
    const { plane, basis, ring } = buildFace();
    const bad = ring.map((p, i) => (i === 2 ? add3(p, scale3(basis.n, 1.0)) : p));
    const rebuilt = buildRoofPlane3D(bad, { surfaceOffsetM: 0 });
    expect(Math.abs(rebuilt.pitch - plane.pitch)).toBeGreaterThan(0.5);
  });

  it('the area changes by exactly the triangle the corner swept', () => {
    const { plane, basis, ring } = buildFace();
    const uv0 = ringToFaceUV(ring, basis);
    const before = ringAreaM2(uv0);

    const SHIFT_M = 2.0;
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, SHIFT_M)), basis) : p);
    const after = ringAreaM2(ringToFaceUV(moved, basis));

    // 🚨 THE SWEPT AREA IS MEASURED IN THE FACE'S OWN PLANE, NOT IN PLAN.
    //
    // Displacing corner i by d changes a shoelace area by exactly
    // 0.5 * |d x (P(i+1) - P(i-1))| — the triangle the corner sweeps against the
    // chord joining its two neighbours. Note the SPAN is taken from the ring as
    // the fit returned it: `buildRoofPlane3D` re-orders corners relative to the
    // input, so hard-coding "the next corner is 6 m up the slope" would be
    // asserting an accident of ordering.
    //
    // It is also a SLOPED length. The 6 m run is a PLAN dimension; up a 26.57
    // deg slope it is 6/cos(tilt) = 6.71 m. Quoting the plan number would be
    // wrong by 12%, which is the same mistake as quoting a pitched roof's area
    // from its footprint — and is exactly why `area` is a shoelace in the
    // plane's own UV basis rather than anything taken from lat/lng.
    const i = 2;
    const n = uv0.length;
    const prev = uv0[(i - 1 + n) % n];
    const next = uv0[(i + 1) % n];
    const spanE = next.e - prev.e, spanN = next.n - prev.n;
    const expectedSweep = 0.5 * Math.abs(SHIFT_M * spanN - 0 * spanE);   // d = (SHIFT, 0)
    expect(expectedSweep, 'the neighbour chord has a real cross-slope component')
      .toBeGreaterThan(6);
    expect(before - after, 'the corner swept the triangle against its neighbour chord')
      .toBeCloseTo(expectedSweep, 6);

    const rebuilt = buildRoofPlane3D(moved, { surfaceOffsetM: 0 });
    expect(rebuilt.area).toBeCloseTo(after, 6);
    // 🚨 And it is NOT the old area. `RoofPlaneReshapeUpdate` carries no `area`
    // field, so today a reshape leaves `plane.area` at its pre-reshape value.
    // See the commit path: the vertex move emits the rebuilt area itself.
    expect(Math.abs(rebuilt.area - plane.area)).toBeGreaterThan(6);
  });

  it('the ECEF ring keeps its ORDER through a re-fit — the commit depends on it', () => {
    // The commit pairs `newRing[i]` with `vertices0[i]` and with
    // `built.polygon3D[i]`. If a re-fit ever re-ordered corners, that pairing
    // would silently scramble the plan record.
    const { basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, 2.0)), basis) : p);
    const rebuilt = buildRoofPlane3D(moved, { surfaceOffsetM: 0 });
    expect(rebuilt.polygon3D).toHaveLength(moved.length);
    for (let i = 0; i < moved.length; i++) {
      expect(mag3(sub3(rebuilt.polygon3D![i] as Cart3, moved[i])),
        `corner ${i} moved or was re-ordered by the re-fit`).toBeLessThan(1e-6);
    }
  });
});

describe('🚨 the PLAN record — unmoved corners must not move at all', () => {
  it('only the dragged corner changes; the other three are byte-identical', () => {
    // 🚨 THIS IS THE CASE `built.vertices` FAILS. `surfaceOffsetM: 0` stops the
    // 12 cm height ratchet AND stops the plan-record un-lift, so the rebuilt
    // `vertices` are the LIFTED ring's lat/lng — every corner slid down-slope by
    // offset*sin(tilt). `movedPlanVertices` keeps the untouched ones exactly.
    const { plane, basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, 1.5)), basis) : p);

    const out = movedPlanVertices(plane.vertices, ring, moved, 2, plane.normal3D!);
    expect(out).not.toBeNull();
    for (let i = 0; i < plane.vertices.length; i++) {
      if (i === 2) continue;
      expect(out![i], `corner ${i} moved and nobody dragged it`).toEqual(plane.vertices[i]);
    }
    expect(out![2]).not.toEqual(plane.vertices[2]);
  });

  it('and the naive path really does move all four — the control', () => {
    // Without this, the case above could pass against a no-op.
    const { plane, basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, 1.5)), basis) : p);
    const naive = buildRoofPlane3D(moved, { surfaceOffsetM: 0 }).vertices;

    let slid = 0;
    for (let i = 0; i < plane.vertices.length; i++) {
      if (i === 2) continue;
      const dM = Math.hypot(
        (naive[i].lat - plane.vertices[i].lat) * 111_132,
        (naive[i].lng - plane.vertices[i].lng) * 111_320 * Math.cos((SITE_LAT * Math.PI) / 180),
      );
      if (dM > 0.02) slid++;
      // And the amount is the predicted offset*sin(tilt).
      expect(dM).toBeCloseTo(0.12 * Math.sin(Math.atan(6 / 12)), 2);
    }
    expect(slid, 'the naive plan record no longer slides — re-check whether this fix is still needed')
      .toBe(3);
  });

  it('🚨 untouched corners are PRESERVED, not recomputed and hoped to match', () => {
    // 🚨 THIS CASE EXISTS BECAUSE A MUTATION SURVIVED THE ONE ABOVE.
    //
    // Replacing the per-corner copy with a per-corner recomputation —
    // `ecefToLatLng(unlift(newRing[i]))` for every i, not just the dragged one —
    // leaves every assertion in this file green. On the fixture face it is an
    // equivalent mutant: the stored record round-trips through the measured
    // lift exactly, so recomputing an untouched corner returns the same float.
    //
    // It stops being equivalent the moment a face's record does NOT round-trip.
    // `detectPlanLiftM` picks whichever candidate reproduces the stored
    // vertices MOST CLOSELY, not one that reproduces them exactly — Stitch and
    // `buildRoofPlane3D` disagree about the convention on purpose, and a record
    // that predates either carries whatever it carries. On such a face,
    // recomputing silently rewrites three corners nobody dragged, onto the
    // permit site plan, which is precisely the defect this function was
    // written to avoid. "Preserve" and "recompute accurately" are the same
    // answer only while the arithmetic happens to agree.
    //
    // So: a record deliberately nudged off any lift convention, and the
    // untouched corners must still come back byte-for-byte.
    const { plane, basis, ring } = buildFace();
    const offRecord = plane.vertices.map((v, i) => ({
      ...v,
      // ~7 cm of "this came from somewhere else", well above float noise and
      // well below anything that would change which candidate lift wins.
      lat: v.lat + (i % 2 === 0 ? 6e-7 : -6e-7),
      lng: v.lng + (i % 2 === 0 ? -6e-7 : 6e-7),
    }));

    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, 1.5)), basis) : p);
    const out = movedPlanVertices(offRecord, ring, moved, 2, plane.normal3D!)!;
    expect(out).not.toBeNull();

    for (let i = 0; i < offRecord.length; i++) {
      if (i === 2) continue;
      expect(out[i].lat, `corner ${i} was recomputed instead of carried over`)
        .toBe(offRecord[i].lat);
      expect(out[i].lng, `corner ${i} was recomputed instead of carried over`)
        .toBe(offRecord[i].lng);
    }

    // And the control: on this same off-record face, a recomputation really
    // would have moved them — so the assertion above is not vacuous.
    const liftM = detectPlanLiftM(offRecord, ring, plane.normal3D!);
    const recomputed = buildRoofPlane3D(ring, { surfaceOffsetM: liftM }).vertices;
    const drift = Math.hypot(
      (recomputed[0].lat - offRecord[0].lat) * 111_132,
      (recomputed[0].lng - offRecord[0].lng) * 111_320 * Math.cos((SITE_LAT * Math.PI) / 180),
    );
    expect(drift, 'the off-record fixture is not actually off-record — this case proves nothing')
      .toBeGreaterThan(0.01);
  });

  it('the moved corner lands where the drag put it, in plan', () => {
    const { plane, basis, ring } = buildFace();
    const SHIFT = 1.5;
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, SHIFT)), basis) : p);
    const out = movedPlanVertices(plane.vertices, ring, moved, 2, plane.normal3D!)!;

    // The plan displacement of the moved corner is the plan projection of an
    // in-plane shift along the eave, which is horizontal — so it is the full
    // SHIFT, not a foreshortened one.
    const mPerDegLng = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);
    const dM = Math.hypot(
      (out[2].lat - plane.vertices[2].lat) * 111_132,
      (out[2].lng - plane.vertices[2].lng) * mPerDegLng,
    );
    expect(dM).toBeCloseTo(SHIFT, 1);
  });

  it('the face\'s own lift convention is measured, not assumed', () => {
    const { plane, ring } = buildFace();
    // A face from buildRoofPlane3D carries UN-lifted vertices, so the detected
    // convention is the full surface offset.
    expect(detectPlanLiftM(plane.vertices, ring, plane.normal3D!)).toBeCloseTo(0.12, 6);

    // A face whose plan record was written WITHOUT un-lifting — which is what
    // Stitch deliberately does, to keep a shared ridge shared — reads as 0.
    const stitchStyle = ring.map(p => {
      const g = ecefToLatLng(p);
      return { lat: g.lat, lng: g.lng };
    });
    expect(detectPlanLiftM(stitchStyle, ring, plane.normal3D!)).toBe(0);
  });

  it('a mismatched ring length is refused rather than silently mis-paired', () => {
    const { plane, ring } = buildFace();
    expect(movedPlanVertices(plane.vertices.slice(0, 3), ring, ring, 0, plane.normal3D!)).toBeNull();
    expect(movedPlanVertices(plane.vertices, ring, ring, 99, plane.normal3D!)).toBeNull();
  });
});

describe('🚨 surfaceOffsetM: 0 — the 12 cm-per-press ratchet, pinned', () => {
  it('re-fitting an already-lifted ring ten times does not move the face', () => {
    const { basis, ring } = buildFace();
    let current: Cart3[] = ring.map(p => ({ ...p }));
    const h0 = ecefToLatLng(current[0]).height;
    for (let i = 0; i < 10; i++) {
      current = buildRoofPlane3D(current, { surfaceOffsetM: 0 }).polygon3D as Cart3[];
    }
    const h1 = ecefToLatLng(current[0]).height;
    expect(Math.abs(h1 - h0), 'the face drifted vertically across repeated re-fits').toBeLessThan(0.005);
    // And the normal did not creep either.
    const frame = computePlaneFromPoints3D(current, { surfaceOffsetM: 0 });
    expect(Math.abs(dot3(frame.normal, basis.n) - 1)).toBeLessThan(1e-9);
  });

  it('and the DEFAULT offset is the ratchet — the control for the case above', () => {
    const { ring } = buildFace();
    let current: Cart3[] = ring.map(p => ({ ...p }));
    const h0 = ecefToLatLng(current[0]).height;
    for (let i = 0; i < 10; i++) {
      current = buildRoofPlane3D(current).polygon3D as Cart3[];   // no surfaceOffsetM
    }
    const h1 = ecefToLatLng(current[0]).height;
    expect(h1 - h0).toBeGreaterThan(1.0);   // 10 x 12 cm
  });

  it('no cumulative drift in the outline across repeated re-fits either', () => {
    const { ring } = buildFace();
    let current: Cart3[] = ring.map(p => ({ ...p }));
    for (let i = 0; i < 10; i++) {
      current = buildRoofPlane3D(current, { surfaceOffsetM: 0 }).polygon3D as Cart3[];
    }
    // Corner order can rotate through the re-fit, so compare as a set.
    for (const p of ring) {
      const best = current.reduce((b, q) => (mag3(sub3(q, p)) < mag3(sub3(b, p)) ? q : b));
      expect(mag3(sub3(best, p))).toBeLessThan(0.01);
    }
  });
});

describe('the grab is geometric and picks the nearest handle', () => {
  it('a ray aimed at a corner from straight above hits that corner', () => {
    const { ring } = buildFace();
    const target = ring[1];
    const up = normalize3(target);
    const origin = add3(target, scale3(up, 400));
    const grab = nearestVertexAlongRay(origin, scale3(up, -1), ring, 0.5);
    expect(grab).not.toBeNull();
    expect(grab!.index).toBe(1);
  });

  it('a ray aimed at empty roof grabs nothing — an unresolved press must start no drag', () => {
    const { ring, basis } = buildFace();
    const centre = ring.reduce((a, p) => add3(a, scale3(p, 1 / ring.length)), { x: 0, y: 0, z: 0 });
    const up = normalize3(centre);
    const grab = nearestVertexAlongRay(add3(centre, scale3(up, 400)), scale3(up, -1), ring, 0.5);
    expect(grab, 'the middle of the face is not a handle').toBeNull();
    expect(basis.n).toBeDefined();
  });

  it('when two handles are on the ray, the NEAR one wins', () => {
    // Look along the line joining two corners from outside: both spheres are on
    // the ray, and taking the first in array order would be a coin toss.
    const { ring } = buildFace();
    const a = ring[0], b = ring[1];
    const dir = normalize3(sub3(b, a));
    const origin = sub3(a, scale3(dir, 50));
    const grab = nearestVertexAlongRay(origin, dir, ring, 0.5);
    expect(grab!.index).toBe(0);

    const backwards = nearestVertexAlongRay(add3(b, scale3(dir, 50)), scale3(dir, -1), ring, 0.5);
    expect(backwards!.index).toBe(1);
  });

  it('the handle sphere tracks the drawn dot and is bounded at both ends', () => {
    const fov = (60 * Math.PI) / 180;
    const near = handleRadiusM(20, 800, fov);
    const far = handleRadiusM(400, 800, fov);
    expect(far).toBeGreaterThan(near);
    expect(handleRadiusM(0.001, 800, fov)).toBe(HANDLE_MIN_RADIUS_M);
    expect(handleRadiusM(1e9, 800, fov)).toBe(HANDLE_MAX_RADIUS_M);
    expect(handleRadiusM(NaN, 800, fov)).toBe(HANDLE_MIN_RADIUS_M);
  });
});

describe('🚨 a moved corner PERSISTS — the autosave must see it', () => {
  it('the roof-plane signature changes when a corner moves', () => {
    // `vertices` is a SIGNED field, so emitting the rebuilt plan ring is what
    // schedules the save. `polygon3D`, `origin3D` and `ecefFrame3D` are NOT
    // signed — they ride along in the payload, which is fine here only because
    // `vertices` always moves with them on this gesture.
    //
    // Pinned so that nobody "optimises" the commit into writing only the ECEF
    // ring: that version would look completely correct on screen, right up
    // until the reload that silently discards every corner edit ever made.
    // Built exactly the way the commit builds it: the id is preserved and the
    // plan ring comes from `movedPlanVertices`, so the signature moves because
    // the GEOMETRY moved and for no other reason.
    const { plane, basis, ring } = buildFace();
    const moved = ring.map((p, i) =>
      i === 2 ? inPlaneTarget(p, add3(p, scale3(basis.u, 1.5)), basis) : p);
    const rebuilt = buildRoofPlane3D(moved, { surfaceOffsetM: 0 });
    rebuilt.id = plane.id;
    rebuilt.vertices = movedPlanVertices(plane.vertices, ring, moved, 2, rebuilt.normal3D!)!;

    expect(roofPlanesSignature([rebuilt])).not.toBe(roofPlanesSignature([plane]));
    expect(SIGNED_FIELDS).toContain('vertices');
  });

  it('🚨 so a no-op drag must be stopped BEFORE the rebuild, and it is', () => {
    // `roofPlanesSignature` is raw JSON of the signed fields — no rounding. So
    // an ECEF-to-lat/lng round trip that differs in its last digits IS a
    // different signature, and a commit that ran on an unmoved corner would
    // schedule a save for an edit nobody made.
    //
    // The recomputed corner is faithful to well under a millimetre...
    const { plane, ring } = buildFace();
    const rebuiltSame = movedPlanVertices(plane.vertices, ring, ring, 2, plane.normal3D!)!;
    const mPerDegLng = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);
    const dM = Math.hypot(
      (rebuiltSame[2].lat - plane.vertices[2].lat) * 111_132,
      (rebuiltSame[2].lng - plane.vertices[2].lng) * mPerDegLng,
    );
    expect(dM).toBeLessThan(0.001);

    // ...but faithful is not identical, so the guard cannot be "the signature
    // will happen to match". It is `ringMoved`, checked before anything is
    // built, and it is what makes a click on a handle cost nothing.
    expect(ringMoved(ring, ring.map(p => ({ ...p })))).toBe(false);
  });
});

describe('round-tripping through the face basis is exact', () => {
  it('ECEF to (u,v) and back returns the same point', () => {
    const { basis, ring } = buildFace();
    for (const p of ring) {
      const at = projectIntoFace(p, basis);
      const back = faceUVToEcef({ u: at.u, v: at.v }, basis);
      expect(mag3(sub3(back, p))).toBeLessThan(1e-6);
    }
  });

  it('a no-op drag is detected as a no-op, and a real one is not', () => {
    const { basis, ring } = buildFace();
    expect(ringMoved(ring, ring.map(p => ({ ...p })))).toBe(false);
    const nudged = ring.map((p, i) => (i === 0 ? add3(p, scale3(basis.u, 0.001)) : p));
    expect(ringMoved(ring, nudged), 'a 1 mm drag is not an edit').toBe(false);
    const real = ring.map((p, i) => (i === 0 ? add3(p, scale3(basis.u, 0.4)) : p));
    expect(ringMoved(ring, real)).toBe(true);
  });
});
