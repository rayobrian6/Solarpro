/**
 * v62 — Regression test for the 3D Plane / Custom Array / Mark Plane "wonky
 * panels on bare 2D maps" bug.
 *
 * Bug recap (see lib/roofPlane3D.ts `is3DTilesPickMethod` doc-comment for the
 * full chain): on an address with no Google Photorealistic 3D Tiles, the viewer
 * falls back to satellite imagery + WGS84 ellipsoid. Every click in plane3d /
 * mark_plane mode lands on the ellipsoid (h=0), and computePlaneFromPoints3D
 * produces a horizontal frame with an arbitrary u-axis. buildSurfaceGrid then
 * places panels on that horizontal frame, misaligned with the user's traced
 * polygon — visually "wonky".
 *
 * This test pins down THREE invariants that must hold so the bug can never
 * silently regress:
 *
 *   1. `is3DTilesPickMethod` (the centralized guard) accepts ONLY '3dtiles'.
 *      Terrain and ellipsoid picks — the very signals that drive the bug —
 *      must be rejected so the mode-entry guard in SolarEngine3D.tsx (Layer A)
 *      and the click-time defense in handlePlane3DClick (Layer C) stay
 *      consistent and can't drift apart.
 *
 *   2. `computePlaneFromPoints3D` on 3 synthetic WGS84-ellipsoid points
 *      (lat/lng spread of ~14 m, h=0) yields tiltDeg < 1° — the geometric
 *      signature of the bug. A future change to the plane-from-points math
 *      that stops producing a near-horizontal frame on bare-map inputs would
 *      silently mask the bug; this assertion catches that drift.
 *
 *   3. The same function on 3 real-roof-style points (varying h across the
 *      footprint) yields tiltDeg > 1°. The fix's classification must not
 *      reject legitimate 3D-tile traces — this asserts the normal path is
 *      untouched.
 *
 * Together these three invariants document the bug shape and the fix's
 * classification rule.
 */

import { describe, it, expect } from 'vitest';

import {
  is3DTilesPickMethod,
  computePlaneFromPoints3D,
  latLngToECEF,
} from './roofPlane3D';

// ─── 1. Pickmethod guard ────────────────────────────────────────────────────

describe('is3DTilesPickMethod (v62 3D-plane no-tiles guard)', () => {
  it("returns true only for '3dtiles'", () => {
    expect(is3DTilesPickMethod('3dtiles')).toBe(true);
  });

  it("rejects the bare-map fallback chain ('terrain', 'ellipsoid')", () => {
    // These are the exact pickMethods getWorldPosition returns when no 3D
    // tiles are loaded — the bug's input. They MUST be rejected.
    expect(is3DTilesPickMethod('terrain')).toBe(false);
    expect(is3DTilesPickMethod('ellipsoid')).toBe(false);
  });

  it('rejects null / undefined / empty / unknown pickMethods', () => {
    expect(is3DTilesPickMethod(null)).toBe(false);
    expect(is3DTilesPickMethod(undefined)).toBe(false);
    expect(is3DTilesPickMethod('')).toBe(false);
    expect(is3DTilesPickMethod('none')).toBe(false);
    // Defensive against accidental string drift ('3d_tiles', 'threeDTiles', etc.)
    expect(is3DTilesPickMethod('3Dtiles')).toBe(false);
    expect(is3DTilesPickMethod('3D')).toBe(false);
  });
});

// ─── 2 + 3. Geometric signature of the bug ───────────────────────────────────

// Site: lat 38.5°, lng -82.6° (real Ohio coords — arbitrary, doesn't matter).
// Pick span: 0.0001° lat ≈ 11.1 m, 0.0001° lng at 38.5° ≈ 8.7 m → triangle
// spans ~14 m, comfortably a roof-sized footprint.
const SITE_LAT = 38.5;
const SITE_LNG = -82.6;

describe('computePlaneFromPoints3D — bare-map vs real-roof classification', () => {
  it('produces a near-horizontal frame (tilt < 1°) for 3 WGS84-ellipsoid points — the bug signature', () => {
    // Three "clicks" on a bare 2D map → all h=0, all on the WGS84 ellipsoid.
    const pts = [
      latLngToECEF(SITE_LAT,        SITE_LNG,        0),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG + 0.0001, 0),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG - 0.0001, 0),
    ];
    const frame = computePlaneFromPoints3D(pts);
    // Bug signature: Newell normal on 3 ellipsoid points is ≈ radial up →
    // tiltDeg ≈ 0°. Locked tight (< 1°) so future math tweaks that let the
    // tilt climb above a couple of degrees without restoring roof alignment
    // get caught.
    expect(frame.tiltDeg).toBeLessThan(1);
    // Flat-plane branch of azimuthDeg defaults to 180 (south-facing).
    expect(frame.azimuthDeg).toBe(180);
  });

  it('produces a tilted frame (tilt > 1°) for 3 real-roof points with varying height', () => {
    // Three "clicks" on a real 3D tile roof → varying h (10 / 8 / 9 m).
    const pts = [
      latLngToECEF(SITE_LAT,          SITE_LNG,          10),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG + 0.0001,  8),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG - 0.0001,  9),
    ];
    const frame = computePlaneFromPoints3D(pts);
    // Real-roof signature: roof surface has actual elevation variation, so
    // the Newell normal has a horizontal component → tiltDeg > 1°.
    // (We don't assert exact degrees — the buildRoofPlane3D path clamps
    // pitch to [0, 60] downstream — but tilt > 1° proves the normal case
    // is not regressed by this fix.)
    expect(frame.tiltDeg).toBeGreaterThan(1);
  });

  it('preserves the orthonormal frame on degenerate (bare-map) input — wonky alignment, not crash', () => {
    // This documents the EXACT shape of the bug: the frame is stable (no
    // NaN, no collapse), but its u-axis is arbitrary on bare-map input.
    // A future "fix" that crashes on this input instead of producing a
    // wonky frame would be a regression of the stable-degrade guarantee.
    const pts = [
      latLngToECEF(SITE_LAT,          SITE_LNG,          0),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG + 0.0001, 0),
      latLngToECEF(SITE_LAT + 0.0001, SITE_LNG - 0.0001, 0),
    ];
    const frame = computePlaneFromPoints3D(pts);

    // All frame vectors are finite.
    for (const v of [frame.origin, frame.normal, frame.u, frame.v,
                     frame.normalENU, frame.uENU, frame.vENU]) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.y)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
    }

    // u and v are unit-length.
    const uLen = Math.hypot(frame.u.x, frame.u.y, frame.u.z);
    const vLen = Math.hypot(frame.v.x, frame.v.y, frame.v.z);
    const nLen = Math.hypot(frame.normal.x, frame.normal.y, frame.normal.z);
    expect(Math.abs(uLen - 1)).toBeLessThan(1e-9);
    expect(Math.abs(vLen - 1)).toBeLessThan(1e-9);
    expect(Math.abs(nLen - 1)).toBeLessThan(1e-9);

    // u · v ≈ 0, u · n ≈ 0, v · n ≈ 0 (orthogonal frame).
    const uv = frame.u.x * frame.v.x + frame.u.y * frame.v.y + frame.u.z * frame.v.z;
    const un = frame.u.x * frame.normal.x + frame.u.y * frame.normal.y + frame.u.z * frame.normal.z;
    const vn = frame.v.x * frame.normal.x + frame.v.y * frame.normal.y + frame.v.z * frame.normal.z;
    expect(Math.abs(uv)).toBeLessThan(1e-9);
    expect(Math.abs(un)).toBeLessThan(1e-9);
    expect(Math.abs(vn)).toBeLessThan(1e-9);

    // All projected points lie on the plane (dot with normal ≈ SURFACE_OFFSET_M
    // because the projection lifts them by SURFACE_OFFSET_M along n).
    for (const p of frame.projectedPts) {
      const d = { x: p.x - frame.origin.x, y: p.y - frame.origin.y, z: p.z - frame.origin.z };
      const along = d.x * frame.normal.x + d.y * frame.normal.y + d.z * frame.normal.z;
      expect(along).toBeLessThan(1e-6);
    }
  });
});