/**
 * tests/sharedEdgeAzimuth.test.ts
 *
 * "They are recognizing the same plane. Point the slope south. This is a north
 *  south facing gable roof. The system needs to be able to recognize that
 *  automatically."
 *
 * Both halves of Ray's gable came out sloping the same way, because each face's
 * azimuth was derived from its OWN longest edge in isolation: two wide
 * rectangles either side of a ridge both answer "south". The information was
 * never in a single face — it is in the relationship between two faces that
 * share an edge, and a gable's halves slope AWAY from each other across it.
 *
 * These tests pin that. The headline one is "opposite, not identical".
 */

import { describe, it, expect } from 'vitest';
import { deriveAzimuthsFromSharedEdges, type ExtrusionFace } from '@/lib/3d/buildingExtrusion';
import { ecefToLatLng, latLngToECEF } from '@/lib/roofPlane3D';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';

const LAT = 38.8306;
const LNG = -89.5343;
const GROUND = 150;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

const dLat = (m: number) => m / M_PER_DEG_LAT;
const dLng = (m: number) => m / mPerDegLng;

/** Build a face from a plan-view ring, as the Building view does. */
function face(id: string, ring: Array<{ lat: number; lng: number }>, pitch = 30, az = 180): ExtrusionFace {
  const built = roofPlaneFromFootprint(ring, {
    pitchDeg: pitch, azimuthDeg: az, eaveHeightM: 3, groundElevM: GROUND,
  });
  expect(built, `face ${id} should build`).not.toBeNull();
  return { id, polygon3D: built!.plane.polygon3D! };
}

/**
 * Ray's roof: a gable whose ridge runs EAST-WEST, so the two halves face north
 * and south. `widthM` runs along the ridge, `depthM` is each half's slope run.
 */
function eastWestRidgeGable(widthM = 16, southDepthM = 6, northDepthM = 6) {
  const halfW = dLng(widthM / 2);
  const ridgeLat = LAT;
  const south = [
    { lat: ridgeLat - dLat(southDepthM), lng: LNG - halfW },
    { lat: ridgeLat - dLat(southDepthM), lng: LNG + halfW },
    { lat: ridgeLat, lng: LNG + halfW },
    { lat: ridgeLat, lng: LNG - halfW },
  ];
  const north = [
    { lat: ridgeLat, lng: LNG - halfW },
    { lat: ridgeLat, lng: LNG + halfW },
    { lat: ridgeLat + dLat(northDepthM), lng: LNG + halfW },
    { lat: ridgeLat + dLat(northDepthM), lng: LNG - halfW },
  ];
  return [face('south', south), face('north', north)];
}

const bearingDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
/** The wrong answer this test file exists to prevent. */
const ALWAYS_SOUTH = () => 180;

describe('azimuth from the shared ridge', () => {
  it('gives a gable OPPOSITE slopes, not two identical ones', () => {
    const faces = eastWestRidgeGable();
    const az = deriveAzimuthsFromSharedEdges(faces, ALWAYS_SOUTH);
    const s = az.get('south')!, n = az.get('north')!;
    expect(bearingDelta(s, n)).toBeGreaterThan(178); // back to back
    expect(bearingDelta(s, n)).toBeLessThanOrEqual(180);
  });

  it('points the south half SOUTH and the north half NORTH', () => {
    const az = deriveAzimuthsFromSharedEdges(eastWestRidgeGable(), ALWAYS_SOUTH);
    expect(bearingDelta(az.get('south')!, 180)).toBeLessThan(2);
    expect(bearingDelta(az.get('north')!, 0)).toBeLessThan(2);
  });

  it('a NORTH-SOUTH ridge gives east and west halves', () => {
    // Ridge runs N-S, so the halves face east and west.
    const halfD = dLat(8);
    const w = [
      { lat: LAT - halfD, lng: LNG - dLng(6) }, { lat: LAT - halfD, lng: LNG },
      { lat: LAT + halfD, lng: LNG },           { lat: LAT + halfD, lng: LNG - dLng(6) },
    ];
    const e = [
      { lat: LAT - halfD, lng: LNG }, { lat: LAT - halfD, lng: LNG + dLng(6) },
      { lat: LAT + halfD, lng: LNG + dLng(6) }, { lat: LAT + halfD, lng: LNG },
    ];
    const az = deriveAzimuthsFromSharedEdges([face('west', w), face('east', e)], ALWAYS_SOUTH);
    expect(bearingDelta(az.get('west')!, 270)).toBeLessThan(2);
    expect(bearingDelta(az.get('east')!, 90)).toBeLessThan(2);
  });

  it('still works when the two halves are UNEQUAL — Ray\'s blurry-imagery case', () => {
    // He said: "one plane is larger than the other after marking my points".
    // Asymmetry must not change which way each half slopes.
    const az = deriveAzimuthsFromSharedEdges(eastWestRidgeGable(16, 4, 9), ALWAYS_SOUTH);
    expect(bearingDelta(az.get('south')!, 180)).toBeLessThan(3);
    expect(bearingDelta(az.get('north')!, 0)).toBeLessThan(3);
  });

  it('tolerates a ridge the user clicked slightly apart on the two halves', () => {
    const [s, n] = eastWestRidgeGable();
    // Nudge the north half's ridge corners ~15 cm, as two separate traces would.
    const nudged: ExtrusionFace = {
      id: 'north',
      polygon3D: n.polygon3D.map((p, i) => (i === 0 || i === 1 ? { x: p.x + 0.1, y: p.y + 0.1, z: p.z } : p)),
    };
    const az = deriveAzimuthsFromSharedEdges([s, nudged], ALWAYS_SOUTH);
    expect(bearingDelta(az.get('south')!, az.get('north')!)).toBeGreaterThan(170);
  });

  it('falls back for a LONE face — a shed roof has no ridge to reason from', () => {
    const [only] = eastWestRidgeGable();
    const az = deriveAzimuthsFromSharedEdges([only], () => 217);
    expect(az.get('south')).toBe(217);
  });

  it('handles four hip faces — each slopes away from its own shared edge', () => {
    // A pyramid hip: four triangles meeting at a peak. Each shares two edges
    // with neighbours; each must slope outward, roughly 90 degrees apart.
    const r = 7;
    const peak = { lat: LAT, lng: LNG };
    const corners = [
      { lat: LAT - dLat(r), lng: LNG - dLng(r) },
      { lat: LAT - dLat(r), lng: LNG + dLng(r) },
      { lat: LAT + dLat(r), lng: LNG + dLng(r) },
      { lat: LAT + dLat(r), lng: LNG - dLng(r) },
    ];
    const faces = corners.map((c, i) =>
      face('hip' + i, [c, corners[(i + 1) % 4], peak], 30, 180));
    const az = deriveAzimuthsFromSharedEdges(faces, ALWAYS_SOUTH);
    const all = faces.map(f => az.get(f.id)!);
    expect(all.every(a => isFinite(a))).toBe(true);
    // No two adjacent hip faces may share an azimuth — that was the bug.
    for (let i = 0; i < 4; i++) {
      expect(bearingDelta(all[i], all[(i + 1) % 4])).toBeGreaterThan(30);
    }
  });

  it('returns an empty map for no faces rather than throwing', () => {
    expect(deriveAzimuthsFromSharedEdges([], ALWAYS_SOUTH).size).toBe(0);
  });
});

describe('un-stitched hand traces — the "two south facing planes" bug', () => {
  it('still finds the ridge when the halves are traced 1m apart', () => {
    // Ray traces each half separately by eye on blurry imagery, so before he
    // stitches, the two halves do NOT share a corner within 35 cm. At the wall
    // tolerance no ridge was found, both halves fell back to the per-face
    // guess, and BOTH came out south. The adjacency tolerance is now 1.6 m,
    // matching what Stitch already treats as "the same corner".
    const W = 16;
    const [s, n] = eastWestRidgeGable(W, 6, 6);
    // Shift the north half 1 m north — a realistic miss.
    const drifted: ExtrusionFace = {
      id: 'north',
      polygon3D: n.polygon3D.map(p => {
        const g = ecefToLatLng(p);
        return latLngToECEF(g.lat + 1 / 111320, g.lng, g.height);
      }),
    };
    const az = deriveAzimuthsFromSharedEdges([s, drifted], ALWAYS_SOUTH);
    expect(bearingDelta(az.get('south')!, az.get('north')!)).toBeGreaterThan(170);
    expect(bearingDelta(az.get('south')!, 180)).toBeLessThan(10);
    expect(bearingDelta(az.get('north')!, 0)).toBeLessThan(10);
  });

  it('a 1m gap DEFEATED the old 0.35m tolerance — both came out south', () => {
    // Documents the regression explicitly, so nobody "tidies" the two
    // tolerances back into one constant.
    const W = 16;
    const [s, n] = eastWestRidgeGable(W, 6, 6);
    const drifted: ExtrusionFace = {
      id: 'north',
      polygon3D: n.polygon3D.map(p => {
        const g = ecefToLatLng(p);
        return latLngToECEF(g.lat + 1 / 111320, g.lng, g.height);
      }),
    };
    const tight = deriveAzimuthsFromSharedEdges([s, drifted], ALWAYS_SOUTH,
      { sharedEdgeToleranceM: 0.35 });
    expect(tight.get('south')).toBe(180);
    expect(tight.get('north')).toBe(180); // both south — the bug
  });

  it('does not fuse two genuinely separate buildings', () => {
    // The looser tolerance must not make a garage 20 m away a neighbour of the
    // house and start reasoning about a ridge between them.
    const W = 16;
    const [s] = eastWestRidgeGable(W, 6, 6);
    const faraway: ExtrusionFace = {
      id: 'garage',
      polygon3D: s.polygon3D.map(p => {
        const g = ecefToLatLng(p);
        return latLngToECEF(g.lat + 20 / 111320, g.lng, g.height);
      }),
    };
    const az = deriveAzimuthsFromSharedEdges([s, faraway], () => 217);
    // Neither shares an edge, so both take the caller's estimate.
    expect(az.get('south')).toBe(217);
    expect(az.get('garage')).toBe(217);
  });
});
