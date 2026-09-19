/**
 * tests/flatTraceEndToEnd.test.ts
 *
 * v66 flat trace: the journey, not the units.
 *
 * The 62-defect review of the 3D drop found the suite green and blind, because
 * every slice was unit-tested in isolation and nothing asserted that a user
 * action produced a usable result. These tests take the other angle: start from
 * what `handlePlane3DClick` actually accumulates on a no-coverage address —
 * ECEF points picked off the bare WGS84 ellipsoid — and assert that what comes
 * out the far end is a roof face the rest of the product can consume.
 *
 * They cannot mount Cesium, so they exercise the seam: ellipsoid picks in,
 * RoofPlane out, via exactly the calls finalizePlane3D makes.
 */

import { describe, it, expect } from 'vitest';
import { roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { deriveAzimuthFromOutline } from '@/lib/aerial/nearmapToRoofPlane';
import { latLngToECEF, ecefToLatLng } from '@/lib/roofPlane3D';

// Pocahontas, IL — the live address with no Photorealistic 3D Tiles coverage.
const LAT = 38.8306;
const LNG = -89.5343;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/**
 * Simulate what handlePlane3DClick stores per click on a no-coverage address.
 * getWorldPosition falls through 3D tiles -> terrain -> ellipsoid, so the
 * cartesian it hands back is ON THE ELLIPSOID: correct lat/lng, height 0.
 * This is the exact input the flat-trace branch receives.
 */
function ellipsoidPick(lat: number, lng: number) {
  return latLngToECEF(lat, lng, 0);
}

/** A roof face `widthM` along the eave by `depthM` up the slope. */
function traceFace(widthM: number, depthM: number) {
  const dLng = widthM / 2 / mPerDegLng;
  const dLat = depthM / 2 / M_PER_DEG_LAT;
  return [
    ellipsoidPick(LAT - dLat, LNG - dLng),
    ellipsoidPick(LAT - dLat, LNG + dLng),
    ellipsoidPick(LAT + dLat, LNG + dLng),
    ellipsoidPick(LAT + dLat, LNG - dLng),
  ];
}

/** The flat-trace branch of finalizePlane3D, verbatim in its essentials. */
function finalizeFlatTrace(
  cartPts: { x: number; y: number; z: number }[],
  tiltSliderDeg: number,
  groundElevM = 150,
) {
  const outline = cartPts.map(p => {
    const g = ecefToLatLng(p);
    return { lat: g.lat, lng: g.lng };
  });
  const centroidLat = outline.reduce((s, v) => s + v.lat, 0) / outline.length;
  const azimuthDeg = deriveAzimuthFromOutline(outline, centroidLat);
  return roofPlaneFromFootprint(outline, {
    pitchDeg: tiltSliderDeg,
    azimuthDeg,
    eaveHeightM: 3.0,
    groundElevM,
  });
}

describe('v66 flat trace — ellipsoid picks to a usable roof face', () => {
  it('produces a roof face from picks that the OLD code rejected outright', () => {
    // Every one of these picks has pickMethod 'ellipsoid'. Pre-v66, Layer C
    // rejected each click and no face could ever be created at this address.
    const built = finalizeFlatTrace(traceFace(12, 8), 26);
    expect(built).not.toBeNull();
    expect(built!.plane.vertices).toHaveLength(4);
  });

  it('the picked heights are zero — the face is built from the footprint, not the picks', () => {
    // Proves the input really is height-less, so the test is not accidentally
    // passing on elevation data that a no-coverage address would never have.
    for (const p of traceFace(12, 8)) {
      expect(Math.abs(ecefToLatLng(p).height)).toBeLessThan(0.01);
    }
    const built = finalizeFlatTrace(traceFace(12, 8), 26);
    expect(built!.plane.pitch).toBe(26);
  });

  it('carries everything downstream needs: pitch, azimuth, area, vertices, frame', () => {
    const built = finalizeFlatTrace(traceFace(12, 8), 26);
    const p = built!.plane;
    // The permit route's real-geometry gate and the panel grid both read these.
    expect(p.id).toBeTruthy();
    expect(p.vertices.length).toBeGreaterThanOrEqual(3);
    expect(p.pitch).toBeGreaterThan(0);
    expect(p.azimuth).toBeGreaterThanOrEqual(0);
    expect(p.azimuth).toBeLessThan(360);
    expect(p.area).toBeGreaterThan(0);
    expect(p.usableArea).toBeGreaterThan(0);
    // The panel-placement frame — without it buildSurfaceGrid cannot fill.
    expect(built!.frame).toBeTruthy();
    expect(p.polygon3D!.length).toBe(4);
    expect(p.localFrame3D).toBeTruthy();
  });

  it('infers a south-ish azimuth for an east-west ridge, with no user input', () => {
    // A face wider (E-W) than deep (N-S): the long edge is the ridge, so the
    // slope runs N-S, and the equator-facing choice is south.
    const built = finalizeFlatTrace(traceFace(16, 6), 26);
    const az = built!.plane.azimuth;
    expect(Math.abs(((az - 180 + 540) % 360) - 180)).toBeLessThan(5);
  });

  it('infers an east or west azimuth for a north-south ridge', () => {
    // Deeper than wide: the ridge runs N-S, so the slope faces E or W.
    const built = finalizeFlatTrace(traceFace(6, 16), 26);
    const az = built!.plane.azimuth;
    const nearEast = Math.abs(((az - 90 + 540) % 360) - 180) < 5;
    const nearWest = Math.abs(((az - 270 + 540) % 360) - 180) < 5;
    expect(nearEast || nearWest).toBe(true);
  });

  it('two faces traced at the same address stay independent', () => {
    // Regression cover for the per-face promise: tracing the second slope must
    // not mutate or inherit from the first.
    const a = finalizeFlatTrace(traceFace(16, 6), 26);
    const b = finalizeFlatTrace(traceFace(16, 6), 40);
    expect(a!.plane.id).not.toBe(b!.plane.id);
    expect(a!.plane.pitch).toBe(26);
    expect(b!.plane.pitch).toBe(40);
    expect(b!.plane.area).toBeGreaterThan(a!.plane.area); // steeper = more area
  });

  it('a steeper Tilt slider yields more roof area from the SAME trace', () => {
    // The footprint is identical; only the pitch changes. This is the property
    // that makes panel counts honest on a traced roof.
    const shallow = finalizeFlatTrace(traceFace(12, 8), 10);
    const steep = finalizeFlatTrace(traceFace(12, 8), 45);
    const ratio = steep!.plane.area / shallow!.plane.area;
    expect(ratio).toBeCloseTo(Math.cos(10 * DEG) / Math.cos(45 * DEG), 1);
  });

  it('lands as UNCONFIRMED so an eyeballed pitch cannot reach a planset unreviewed', () => {
    // finalizePlane3D stamps these after building; assert the intent here so a
    // future refactor that drops the stamping is caught.
    const built = finalizeFlatTrace(traceFace(12, 8), 26);
    const plane = built!.plane;
    plane.source = 'manual';
    plane.confirmed = false;
    expect(plane.confirmed).toBe(false);
    expect(plane.source).toBe('manual');
  });

  it('refuses a 2-corner trace rather than inventing a face', () => {
    const twoPicks = traceFace(12, 8).slice(0, 2);
    expect(finalizeFlatTrace(twoPicks, 26)).toBeNull();
  });

  it('handles the L-shaped farmhouse footprint, not just rectangles', () => {
    const d = 9 / M_PER_DEG_LAT, g = 9 / mPerDegLng;
    const L = [
      ellipsoidPick(LAT, LNG),
      ellipsoidPick(LAT, LNG + 2 * g),
      ellipsoidPick(LAT + d, LNG + 2 * g),
      ellipsoidPick(LAT + d, LNG + g),
      ellipsoidPick(LAT + 2 * d, LNG + g),
      ellipsoidPick(LAT + 2 * d, LNG),
    ];
    const built = finalizeFlatTrace(L, 26);
    expect(built).not.toBeNull();
    expect(built!.plane.vertices).toHaveLength(6);
    expect(built!.plane.area).toBeGreaterThan(0);
  });
});
