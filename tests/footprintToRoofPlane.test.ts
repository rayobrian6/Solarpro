/**
 * tests/footprintToRoofPlane.test.ts
 *
 * The 2D → 3D bridge: a flat traced outline plus a pitch and azimuth must
 * produce the same quality of RoofPlane that tracing on 3D tiles produces.
 *
 * The load-bearing assertion is the AREA one. A traced outline is the plan view
 * of a roof face; the real face is 1/cos(pitch) larger. Get that wrong and every
 * no-coverage design under-counts panels — 29% on a 39° roof — while looking
 * completely plausible. So we assert the ratio numerically, not just that a
 * plane came back.
 *
 * Coordinates are Pocahontas, IL (38.83 N, -89.53 W) — the live no-3D-coverage
 * address this path exists for.
 */

import { describe, it, expect } from 'vitest';
import {
  roofPlaneFromFootprint,
  clampPitch,
  normalizeAzimuth,
} from '@/lib/3d/footprintToRoofPlane';
import { ecefToLatLng } from '@/lib/roofPlane3D';

const LAT = 38.83;
const LNG = -89.53;
const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

/** A rectangle `widthM` east-west by `depthM` north-south, centred on LAT/LNG. */
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

const flatSlope = (over = {}) => ({
  pitchDeg: 0, azimuthDeg: 180, eaveHeightM: 3, groundElevM: 150, ...over,
});

describe('roofPlaneFromFootprint', () => {
  // ── It produces a real plane at all, with no 3D coverage ──────────────────

  it('builds a pitched plane from a flat outline — the whole point', () => {
    const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 26, azimuthDeg: 180 }));
    expect(r).not.toBeNull();
    expect(r!.plane.vertices).toHaveLength(4);
    expect(r!.plane.area).toBeGreaterThan(0);
  });

  it('reports back exactly the pitch and azimuth the user gave it', () => {
    // A fitting residual must never surface as a different number in the
    // sidebar than the installer typed.
    const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 26.5, azimuthDeg: 217 }));
    expect(r!.plane.pitch).toBeCloseTo(26.5, 6);
    expect(r!.plane.azimuth).toBeCloseTo(217, 6);
  });

  // ── THE area property: plan view vs. true roof ────────────────────────────

  it('returns TRUE SLOPE AREA, not footprint area (1/cos pitch)', () => {
    const W = 12, D = 8;
    const footprintM2 = W * D;

    const flat = roofPlaneFromFootprint(rect(W, D), flatSlope({ pitchDeg: 0 }));
    expect(flat!.plane.area).toBeCloseTo(footprintM2, 0);

    for (const pitch of [15, 26, 39, 45]) {
      const r = roofPlaneFromFootprint(rect(W, D), flatSlope({ pitchDeg: pitch }));
      const expected = footprintM2 / Math.cos(pitch * DEG);
      // Within 1% — the ECEF round trip introduces a little curvature error.
      expect(r!.plane.area).toBeGreaterThan(expected * 0.99);
      expect(r!.plane.area).toBeLessThan(expected * 1.01);
    }
  });

  it('a 39 degree roof is ~29% larger than its footprint — the panel-count case', () => {
    const flat = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 0 }));
    const steep = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 39 }));
    const ratio = steep!.plane.area / flat!.plane.area;
    expect(ratio).toBeGreaterThan(1.28);
    expect(ratio).toBeLessThan(1.30);
  });

  // ── The eave direction the panel grid needs ──────────────────────────────

  it('eave direction is perpendicular to the downslope azimuth', () => {
    for (const az of [0, 90, 180, 270, 217]) {
      const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ azimuthDeg: az, pitchDeg: 25 }));
      const dsE = Math.sin(az * DEG), dsN = Math.cos(az * DEG);
      const dot = r!.eaveDirENU.x * dsE + r!.eaveDirENU.y * dsN;
      expect(Math.abs(dot)).toBeLessThan(1e-9);
      expect(Math.hypot(r!.eaveDirENU.x, r!.eaveDirENU.y)).toBeCloseTo(1, 9);
    }
  });

  // ── Anchoring: the eave is the low edge, at the height the user gave ──────

  it('the most-downslope edge IS the eave, at the given height, and the ridge rises from it', () => {
    // South-facing (az 180): downslope runs south, so the SOUTH edge is the
    // eave and the NORTH edge is the ridge, higher by depth*tan(pitch).
    // Asserted against the real ECEF geometry, not restated arithmetic.
    const D = 8, pitch = 30, eave = 3, ground = 150;
    const r = roofPlaneFromFootprint(
      rect(12, D), flatSlope({ pitchDeg: pitch, azimuthDeg: 180, eaveHeightM: eave, groundElevM: ground }),
    );
    const pts = r!.plane.polygon3D!.map(p => ({ ...ecefToLatLng(p) }));
    const south = pts.reduce((a, b) => (b.lat < a.lat ? b : a));
    const north = pts.reduce((a, b) => (b.lat > a.lat ? b : a));

    // buildRoofPlane3D lifts the whole face by a small SURFACE_OFFSET along the
    // normal, so compare the RISE rather than the absolute eave height.
    const rise = north.height - south.height;
    expect(rise).toBeCloseTo(D * Math.tan(pitch * DEG), 1); // 8*tan(30) = 4.62m
    expect(north.height).toBeGreaterThan(south.height);

    // The eave sits at ground + eaveHeight, within the surface offset.
    expect(south.height).toBeGreaterThan(ground + eave - 0.5);
    expect(south.height).toBeLessThan(ground + eave + 0.5);
  });

  it('flips which edge is the eave when the azimuth flips', () => {
    // North-facing (az 0): the NORTH edge becomes the low one.
    const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 30, azimuthDeg: 0 }));
    const pts = r!.plane.polygon3D!.map(p => ({ ...ecefToLatLng(p) }));
    const south = pts.reduce((a, b) => (b.lat < a.lat ? b : a));
    const north = pts.reduce((a, b) => (b.lat > a.lat ? b : a));
    expect(south.height).toBeGreaterThan(north.height);
  });

  it('a flat roof (pitch 0) still produces a usable plane', () => {
    const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 0 }));
    expect(r).not.toBeNull();
    expect(r!.plane.pitch).toBe(0);
  });

  // ── Refusing to guess ────────────────────────────────────────────────────

  it('returns null rather than a shard for degenerate input', () => {
    expect(roofPlaneFromFootprint([], flatSlope())).toBeNull();
    expect(roofPlaneFromFootprint([{ lat: LAT, lng: LNG }], flatSlope())).toBeNull();
    expect(roofPlaneFromFootprint(rect(12, 8).slice(0, 2), flatSlope())).toBeNull();
    // Slivers under the 0.5m threshold in either direction.
    expect(roofPlaneFromFootprint(rect(12, 0.2), flatSlope())).toBeNull();
    expect(roofPlaneFromFootprint(rect(0.2, 12), flatSlope())).toBeNull();
  });

  it('returns null on non-finite coordinates instead of emitting NaN geometry', () => {
    const bad = [
      { lat: LAT, lng: LNG },
      { lat: NaN, lng: LNG },
      { lat: LAT + 0.001, lng: LNG + 0.001 },
    ];
    expect(roofPlaneFromFootprint(bad, flatSlope())).toBeNull();
  });

  it('handles a non-rectangular traced outline (an L-shaped face)', () => {
    const d = 10 / M_PER_DEG_LAT, g = 10 / mPerDegLng;
    const L = [
      { lat: LAT, lng: LNG },
      { lat: LAT, lng: LNG + 2 * g },
      { lat: LAT + d, lng: LNG + 2 * g },
      { lat: LAT + d, lng: LNG + g },
      { lat: LAT + 2 * d, lng: LNG + g },
      { lat: LAT + 2 * d, lng: LNG },
    ];
    const r = roofPlaneFromFootprint(L, flatSlope({ pitchDeg: 22 }));
    expect(r).not.toBeNull();
    expect(r!.plane.vertices).toHaveLength(6);
    expect(r!.plane.area).toBeGreaterThan(0);
  });

  // ── Input hygiene ────────────────────────────────────────────────────────

  it('clamps pitch to the range buildRoofPlane3D enforces', () => {
    expect(clampPitch(-5)).toBe(0);
    expect(clampPitch(85)).toBe(60);
    expect(clampPitch(26)).toBe(26);
    expect(clampPitch(NaN)).toBe(0);
  });

  it('normalizes azimuth into [0,360)', () => {
    expect(normalizeAzimuth(-90)).toBe(270);
    expect(normalizeAzimuth(450)).toBe(90);
    expect(normalizeAzimuth(360)).toBe(0);
    expect(normalizeAzimuth(NaN)).toBe(180);
  });

  it('an out-of-range pitch is clamped on the returned plane too', () => {
    const r = roofPlaneFromFootprint(rect(12, 8), flatSlope({ pitchDeg: 85 }));
    expect(r!.plane.pitch).toBe(60);
  });
});
