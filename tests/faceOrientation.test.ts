/**
 * tests/faceOrientation.test.ts
 *
 * The orientation a face reports must come from the geometry that is drawn.
 *
 * This feeds the shading that makes a pitched roof look pitched. Ray's report —
 * "it just built another flat plane just higher" — is what a correctly pitched
 * roof ALSO looks like when every polygon is painted the same flat colour, so
 * the shading has to be driven by the real normal. If it were driven by the
 * stored plane.pitch instead, a face that had been flattened upstream would
 * still be shaded as though tilted, and the picture would hide the bug.
 *
 * So these tests pin the round trip: build a face at a known pitch and azimuth
 * through the real pipeline, then confirm reading its geometry back returns the
 * same numbers — and that a genuinely flat face reports flat.
 */

import { describe, it, expect } from 'vitest';
import { faceOrientation } from '@/lib/3d/buildingExtrusion';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { latLngToECEF } from '@/lib/roofPlane3D';

const LAT = 38.8306;
const LNG = -89.5343;
const GROUND = 150;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

function rect(widthM: number, depthM: number) {
  const dLng = widthM / 2 / mPerDegLng;
  const dLat = depthM / 2 / M_PER_DEG_LAT;
  return [
    { lat: LAT - dLat, lng: LNG - dLng },
    { lat: LAT - dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG + dLng },
    { lat: LAT + dLat, lng: LNG - dLng },
  ];
}

function faceAt(pitchDeg: number, azimuthDeg: number) {
  const built = roofPlaneFromFootprint(rect(14, 8), {
    pitchDeg, azimuthDeg, eaveHeightM: 3, groundElevM: GROUND,
  });
  expect(built).not.toBeNull();
  return built!.plane.polygon3D!;
}

/** Angular distance between two compass bearings, in degrees. */
const bearingDelta = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('faceOrientation reads the geometry, not a stored label', () => {
  it('recovers the pitch a face was built with', () => {
    for (const pitch of [0, 10, 22.6, 30, 39, 45]) {
      const { tiltDeg } = faceOrientation(faceAt(pitch, 180));
      expect(tiltDeg).toBeCloseTo(pitch, 0);
    }
  });

  it('recovers the azimuth a face was built with', () => {
    for (const az of [0, 90, 180, 270, 217]) {
      const { azimuthDeg } = faceOrientation(faceAt(30, az));
      expect(bearingDelta(azimuthDeg, az)).toBeLessThan(1.5);
    }
  });

  it('reports a FLAT face as flat — it must not invent a pitch', () => {
    // The honesty case. If the geometry is horizontal, shading must say so
    // rather than borrowing a number from elsewhere.
    const flat = rect(14, 8).map(v => latLngToECEF(v.lat, v.lng, GROUND + 3));
    const { tiltDeg } = faceOrientation(flat);
    expect(tiltDeg).toBeLessThan(0.5);
  });

  it('two opposing slopes of a gable report opposite azimuths', () => {
    // This is exactly the pair in Ray's screenshot. With no lighting they paint
    // identically; with shading they must differ, and that starts here.
    const south = faceOrientation(faceAt(39, 180));
    const north = faceOrientation(faceAt(39, 0));
    expect(south.tiltDeg).toBeCloseTo(north.tiltDeg, 0);
    expect(bearingDelta(south.azimuthDeg, north.azimuthDeg)).toBeGreaterThan(178);
  });

  it('a vertical wall reports 90 degrees', () => {
    // Walls are shaded by the same path, so they have to come back vertical.
    const a = latLngToECEF(LAT, LNG - 0.0001, GROUND + 3);
    const b = latLngToECEF(LAT, LNG + 0.0001, GROUND + 3);
    const bBot = latLngToECEF(LAT, LNG + 0.0001, GROUND);
    const aBot = latLngToECEF(LAT, LNG - 0.0001, GROUND);
    const { tiltDeg } = faceOrientation([a, b, bBot, aBot]);
    expect(tiltDeg).toBeGreaterThan(89);
    expect(tiltDeg).toBeLessThanOrEqual(90.5);
  });

  it('winding direction does not change the reported orientation', () => {
    // A reversed ring must not report the supplement of the true tilt.
    const poly = faceAt(39, 180);
    const forward = faceOrientation(poly);
    const reversed = faceOrientation([...poly].reverse());
    expect(reversed.tiltDeg).toBeCloseTo(forward.tiltDeg, 3);
    expect(bearingDelta(reversed.azimuthDeg, forward.azimuthDeg)).toBeLessThan(1);
  });

  it('degenerate input returns a neutral orientation instead of NaN', () => {
    expect(faceOrientation([])).toEqual({ tiltDeg: 0, azimuthDeg: 180 });
    expect(faceOrientation([{ x: 1, y: 2, z: 3 }])).toEqual({ tiltDeg: 0, azimuthDeg: 180 });
    const collinear = [
      latLngToECEF(LAT, LNG, GROUND),
      latLngToECEF(LAT, LNG + 0.0001, GROUND),
      latLngToECEF(LAT, LNG + 0.0002, GROUND),
    ];
    const o = faceOrientation(collinear);
    expect(Number.isFinite(o.tiltDeg)).toBe(true);
    expect(Number.isFinite(o.azimuthDeg)).toBe(true);
  });
});
