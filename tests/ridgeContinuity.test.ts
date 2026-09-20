/**
 * tests/ridgeContinuity.test.ts
 *
 * TWO FACES THAT SHARE A RIDGE MUST STILL SHARE IT ON THE DRAWING.
 *
 * WHY THIS FILE EXISTS — A METHOD FAILURE, NOT JUST A CODE ONE
 * -----------------------------------------------------------
 * Asked whether the 0.12 m render lift was permit-grade, I measured ONE face,
 * found `area`, `pitch` and `azimuth` invariant to 1e-14, and reported that the
 * roof datum could not reach engineering output. The measurement was right. The
 * inference was wrong, and the gap was structural: **every geometry invariant in
 * this suite was asserted WITHIN a single face, and none BETWEEN faces.**
 *
 * The lift translates each face along its own NORMAL. A normal is not vertical,
 * so the lift has a horizontal component of `offset·sin(tilt)` pointing
 * down-slope — along that face's own azimuth. Per face that is a rigid
 * translation and invisible to any per-face invariant. But the two halves of a
 * gable have OPPOSITE azimuths, so they slide APART, and their shared ridge
 * splits by twice it:
 *
 *     4:12  (18.43°)   7.6 cm
 *     6:12  (26.57°)  10.8 cm
 *     10:12 (39.81°)  15.4 cm
 *
 * `plane.vertices` carries no height — it is the plan-view record, and it is
 * what lib/cad/buildCADFromSurvey.ts and lib/cad/roof/roofCAD.ts draw as plan
 * polygons and setback bands. So the split was drawn on the permit site plan,
 * and `joinSharedCorners`' 1.5 m tolerance meant nothing downstream noticed.
 *
 * An invariant that holds per-object says nothing about the relationships
 * between objects. This file asserts the relationship.
 */

import { describe, it, expect } from 'vitest';
import { buildRoofPlane3D, latLngToECEF, SURFACE_OFFSET_M } from '@/lib/roofPlane3D';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

const LAT = 38.70615;
const LNG = -90.04625;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

const EAVE_H = 155;
const WIDTH_M = 12;  // ridge length, E–W
const DEPTH_M = 8;   // slope run of each face, N–S

/**
 * A gable roof: two faces meeting at a ridge that runs E–W along `LAT`.
 * The south face falls away southward, the north face northward, so their
 * azimuths are opposed — which is the whole point of the fixture.
 */
function gable(tiltDeg: number) {
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(tiltDeg * DEG);
  const ridgeW = latLngToECEF(LAT, LNG - dLng, ridgeH);
  const ridgeE = latLngToECEF(LAT, LNG + dLng, ridgeH);
  return {
    south: [latLngToECEF(LAT - dLat, LNG - dLng, EAVE_H), latLngToECEF(LAT - dLat, LNG + dLng, EAVE_H), ridgeE, ridgeW],
    north: [latLngToECEF(LAT + dLat, LNG - dLng, EAVE_H), latLngToECEF(LAT + dLat, LNG + dLng, EAVE_H), ridgeE, ridgeW],
  };
}

/** Plan-view distance in metres between two lat/lng points. */
function planDistM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lng - b.lng) * mPerDegLng);
}

/** The two vertices of a face that lie on the ridge line (lat ≈ LAT). */
function ridgeVerts(p: { vertices: Array<{ lat: number; lng: number }> }) {
  return p.vertices.filter(v => Math.abs(v.lat - LAT) < 0.00005).sort((x, y) => x.lng - y.lng);
}

const PITCHES: Array<[string, number]> = [
  ['4:12', 18.4349],
  ['6:12', 26.5651],
  ['10:12', 39.8056],
];

describe('the fixture really is a gable with opposed faces', () => {
  it.each(PITCHES)('%s — the two faces face opposite ways', (_label, tilt) => {
    const { south, north } = gable(tilt);
    const ps = buildRoofPlane3D(south);
    const pn = buildRoofPlane3D(north);
    // Opposed azimuths are what make the lift push them apart rather than along.
    const delta = Math.abs(((ps.azimuth - pn.azimuth) % 360 + 360) % 360);
    expect(Math.min(delta, 360 - delta)).toBeGreaterThan(170);
    expect(ridgeVerts(ps)).toHaveLength(2);
    expect(ridgeVerts(pn)).toHaveLength(2);
  });
});

describe('🚨 a shared ridge stays shared', () => {
  it.each(PITCHES)('%s — both ridge corners coincide in plan view', (_label, tilt) => {
    const { south, north } = gable(tilt);
    const rs = ridgeVerts(buildRoofPlane3D(south));
    const rn = ridgeVerts(buildRoofPlane3D(north));

    // Sub-millimetre. The only residual is the 7-dp coordinate storage quantum.
    expect(planDistM(rs[0], rn[0])).toBeLessThan(1e-3);
    expect(planDistM(rs[1], rn[1])).toBeLessThan(1e-3);
  });

  it('the ridge stays shared for a flat roof too (the degenerate case)', () => {
    const { south, north } = gable(0);
    const rs = ridgeVerts(buildRoofPlane3D(south));
    const rn = ridgeVerts(buildRoofPlane3D(north));
    expect(planDistM(rs[0], rn[0])).toBeLessThan(1e-3);
  });

  it('and when the caller opts out of the lift entirely', () => {
    const { south, north } = gable(26.5651);
    const rs = ridgeVerts(buildRoofPlane3D(south, { surfaceOffsetM: 0 }));
    const rn = ridgeVerts(buildRoofPlane3D(north, { surfaceOffsetM: 0 }));
    expect(planDistM(rs[0], rn[0])).toBeLessThan(1e-3);
  });
});

describe('🚨 ADVERSARIAL — the split, reproduced from the lifted geometry', () => {
  it.each(PITCHES)('%s — polygon3D (which KEEPS the lift) still shows it', (_label, tilt) => {
    // polygon3D is the render/placement geometry and is SUPPOSED to be lifted.
    // Reading the ridge out of it reproduces the old defect exactly, which both
    // proves the mechanism and proves these assertions are load-bearing rather
    // than vacuously true of any two rectangles.
    const { south, north } = gable(tilt);
    const ps = buildRoofPlane3D(south);
    const pn = buildRoofPlane3D(north);

    const llOf = (p: { x: number; y: number; z: number }) => {
      // Inverse of latLngToECEF is not needed precisely here — compare the two
      // faces' lifted ridge points directly in ECEF instead.
      return p;
    };
    const ridgeEcef = (pl: typeof ps) =>
      pl.polygon3D!.map(llOf).filter((_p, i) => [2, 3].includes(i));

    const a = ridgeEcef(ps)[0];
    const b = ridgeEcef(pn)[0];
    const sep = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

    // Two faces, each lifted 0.12 m along opposing normals: the separation is
    // 2·offset·sin(tilt) horizontally plus the vertical parts cancelling, i.e.
    // exactly 2·offset·sin(tilt) for opposed normals sharing a ridge line.
    const expected = 2 * SURFACE_OFFSET_M * Math.sin(tilt * DEG);
    expect(Math.abs(sep - expected)).toBeLessThan(5e-3);
    expect(sep).toBeGreaterThan(0.07); // and it is centimetres, not noise
  });
});

describe('the fix did not disturb what was already correct', () => {
  it.each(PITCHES)('%s — area, pitch and azimuth are unchanged by the lift', (_label, tilt) => {
    const { south } = gable(tilt);
    const lifted = buildRoofPlane3D(south);
    const unlifted = buildRoofPlane3D(south, { surfaceOffsetM: 0 });
    expect(Math.abs(lifted.area - unlifted.area)).toBeLessThan(1e-6);
    expect(Math.abs(lifted.pitch - unlifted.pitch)).toBeLessThan(1e-6);
    expect(Math.abs(lifted.azimuth - unlifted.azimuth)).toBeLessThan(1e-6);
  });

  it('polygon3D and origin3D KEEP the lift — rendering and placement are untouched', () => {
    const { south } = gable(26.5651);
    const lifted = buildRoofPlane3D(south);
    const unlifted = buildRoofPlane3D(south, { surfaceOffsetM: 0 });
    const n = unlifted.normal3D!;
    const d =
      (lifted.origin3D!.x - unlifted.origin3D!.x) * n.x +
      (lifted.origin3D!.y - unlifted.origin3D!.y) * n.y +
      (lifted.origin3D!.z - unlifted.origin3D!.z) * n.z;
    expect(Math.abs(d - SURFACE_OFFSET_M)).toBeLessThan(1e-6);
  });
});
