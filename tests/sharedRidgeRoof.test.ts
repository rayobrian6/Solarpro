/**
 * tests/sharedRidgeRoof.test.ts
 *
 * "These specific roof planes need to be uniform but they are not... I think
 *  the relative height and pitch are wrong."
 *
 * Each face used to be built independently: its own eave, its own pitch, its own
 * traced depth. Two faces with the SAME pitch and DIFFERENT depths reach
 * DIFFERENT ridge heights, so the roof cannot close — the halves look
 * mismatched and the ridge exists at two heights at once. Eyeballed clicks on
 * blurry imagery always produce unequal depths, so this happened every time.
 *
 * A real roof has one ridge at one height. These tests pin that: both halves
 * MEET, whatever the trace looked like, and each face's pitch follows from its
 * own depth rather than being imposed on it.
 */

import { describe, it, expect } from 'vitest';
import { roofPlaneFromFootprintAndRidge, roofPlaneFromFootprint } from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng } from '@/lib/roofPlane3D';

const LAT = 38.8306;
const LNG = -89.5343;
const GROUND = 150;
const EAVE = 3;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);
const dLat = (m: number) => m / M_PER_DEG_LAT;
const dLng = (m: number) => m / mPerDegLng;

/** Ridge running east-west through LAT, `widthM` long. */
const ridgeA = (widthM: number) => ({ lat: LAT, lng: LNG - dLng(widthM / 2) });
const ridgeB = (widthM: number) => ({ lat: LAT, lng: LNG + dLng(widthM / 2) });

/** A half-roof running `depthM` south (or north) of the ridge. */
function half(widthM: number, depthM: number, north: boolean) {
  const s = north ? 1 : -1;
  return [
    { lat: LAT, lng: LNG - dLng(widthM / 2) },
    { lat: LAT, lng: LNG + dLng(widthM / 2) },
    { lat: LAT + s * dLat(depthM), lng: LNG + dLng(widthM / 2) },
    { lat: LAT + s * dLat(depthM), lng: LNG - dLng(widthM / 2) },
  ];
}

const heights = (poly: { x: number; y: number; z: number }[]) =>
  poly.map(p => ecefToLatLng(p).height - GROUND);

describe('shared-ridge roof construction', () => {
  it('UNEQUAL halves still meet at the ridge — the uniformity bug', () => {
    const W = 16, ridgeH = 6;
    // 4 m one side, 9 m the other: what an eyeballed trace actually produces.
    const s = roofPlaneFromFootprintAndRidge(half(W, 4, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: ridgeH, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const n = roofPlaneFromFootprintAndRidge(half(W, 9, true), ridgeA(W), ridgeB(W),
      { ridgeHeightM: ridgeH, eaveHeightM: EAVE, groundElevM: GROUND })!;
    expect(s).not.toBeNull();
    expect(n).not.toBeNull();

    // Both faces reach the ridge height at their ridge edge, and come down to
    // the eave height at their eave. Each sits SURFACE_OFFSET_M (0.12 m) above
    // the nominal plane, lifted along its own normal by buildRoofPlane3D so
    // panels do not z-fight with the mesh — so the vertical excess is
    // 0.12*cos(pitch), up to 0.12 m. Asserted as a band rather than rounded
    // away, because the offset differs per face (the steeper half sits lower)
    // and silently absorbing it would hide a real mismatch.
    const OFF = 0.12;
    const topS = Math.max(...heights(s.plane.polygon3D!));
    const topN = Math.max(...heights(n.plane.polygon3D!));
    expect(topS).toBeGreaterThanOrEqual(ridgeH - 1e-6);
    expect(topS).toBeLessThanOrEqual(ridgeH + OFF + 1e-6);
    expect(topN).toBeGreaterThanOrEqual(ridgeH - 1e-6);
    expect(topN).toBeLessThanOrEqual(ridgeH + OFF + 1e-6);
    expect(Math.min(...heights(s.plane.polygon3D!))).toBeGreaterThanOrEqual(EAVE - 1e-6);
    expect(Math.min(...heights(n.plane.polygon3D!))).toBeGreaterThanOrEqual(EAVE - 1e-6);

    // THE POINT OF THE WHOLE EXERCISE: the two ridges agree. Before this, the
    // same pitch on unequal depths put them metres apart.
    expect(Math.abs(topN - topS)).toBeLessThan(OFF + 1e-6);
  });

  it('the OLD independent construction leaves the halves metres apart', () => {
    // Reconstructs the bug so the difference is unmistakable. Same pitch on both
    // halves, different depths -> different ridge heights -> no closure.
    const W = 16, pitch = 25;
    const s = roofPlaneFromFootprint(half(W, 4, false),
      { pitchDeg: pitch, azimuthDeg: 180, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const n = roofPlaneFromFootprint(half(W, 9, true),
      { pitchDeg: pitch, azimuthDeg: 0, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const topS = Math.max(...heights(s.plane.polygon3D!));
    const topN = Math.max(...heights(n.plane.polygon3D!));
    // 5 m of extra depth at 25 degrees is ~2.3 m of ridge mismatch.
    expect(Math.abs(topN - topS)).toBeGreaterThan(2);
  });

  it('each face gets the pitch its own depth implies', () => {
    const W = 16, ridgeH = 6, rise = ridgeH - EAVE;
    const shallow = roofPlaneFromFootprintAndRidge(half(W, 9, true), ridgeA(W), ridgeB(W),
      { ridgeHeightM: ridgeH, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const steep = roofPlaneFromFootprintAndRidge(half(W, 4, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: ridgeH, eaveHeightM: EAVE, groundElevM: GROUND })!;
    expect(shallow.plane.pitch).toBeCloseTo(Math.atan(rise / 9) * 180 / Math.PI, 0);
    expect(steep.plane.pitch).toBeCloseTo(Math.atan(rise / 4) * 180 / Math.PI, 0);
    // The deeper half is necessarily the shallower one.
    expect(shallow.plane.pitch).toBeLessThan(steep.plane.pitch);
  });

  it('EQUAL halves come out with equal pitch — symmetry is preserved', () => {
    const W = 16;
    const s = roofPlaneFromFootprintAndRidge(half(W, 6, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 6, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const n = roofPlaneFromFootprintAndRidge(half(W, 6, true), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 6, eaveHeightM: EAVE, groundElevM: GROUND })!;
    expect(s.plane.pitch).toBeCloseTo(n.plane.pitch, 1);
    expect(s.plane.area).toBeCloseTo(n.plane.area, 0);
  });

  it('the two halves slope in opposite directions', () => {
    const W = 16;
    const s = roofPlaneFromFootprintAndRidge(half(W, 6, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 6, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const n = roofPlaneFromFootprintAndRidge(half(W, 6, true), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 6, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const delta = Math.abs(((s.plane.azimuth - n.plane.azimuth + 540) % 360) - 180);
    expect(delta).toBeGreaterThan(178);
    expect(Math.abs(((s.plane.azimuth - 180 + 540) % 360) - 180)).toBeLessThan(2);
    expect(Math.abs(((n.plane.azimuth - 0 + 540) % 360) - 180)).toBeLessThan(2);
  });

  it('a flat roof (ridge at eave height) is valid and reports 0 pitch', () => {
    const W = 16;
    const f = roofPlaneFromFootprintAndRidge(half(W, 6, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: EAVE, eaveHeightM: EAVE, groundElevM: GROUND })!;
    expect(f).not.toBeNull();
    expect(f.plane.pitch).toBeCloseTo(0, 3);
  });

  it('refuses impossible or degenerate input instead of emitting a shard', () => {
    const W = 16;
    const good = { ridgeHeightM: 6, eaveHeightM: EAVE, groundElevM: GROUND };
    // Ridge below the eave is not a roof.
    expect(roofPlaneFromFootprintAndRidge(half(W, 6, false), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 1, eaveHeightM: EAVE, groundElevM: GROUND })).toBeNull();
    // Zero-length ridge.
    expect(roofPlaneFromFootprintAndRidge(half(W, 6, false), ridgeA(W), ridgeA(W), good)).toBeNull();
    // Too few corners.
    expect(roofPlaneFromFootprintAndRidge(half(W, 6, false).slice(0, 2), ridgeA(W), ridgeB(W), good)).toBeNull();
    // Non-finite coordinate.
    const bad = [...half(W, 6, false)];
    bad[1] = { lat: NaN, lng: LNG };
    expect(roofPlaneFromFootprintAndRidge(bad, ridgeA(W), ridgeB(W), good)).toBeNull();
  });

  it('the face stays planar — every corner lies on one plane', () => {
    // Height falls linearly with perpendicular distance from the ridge, which IS
    // a plane. If it stopped being planar, panels would not sit flat on it.
    const W = 16;
    const r = roofPlaneFromFootprintAndRidge(half(W, 7, true), ridgeA(W), ridgeB(W),
      { ridgeHeightM: 6.5, eaveHeightM: EAVE, groundElevM: GROUND })!;
    const hs = heights(r.plane.polygon3D!);
    // Two at the ridge, two at the eave, nothing in between for a rectangle.
    const atRidge = hs.filter(h => Math.abs(h - 6.5) < 0.25).length;
    const atEave = hs.filter(h => Math.abs(h - EAVE) < 0.25).length;
    expect(atRidge).toBe(2);
    expect(atEave).toBe(2);
  });
});
