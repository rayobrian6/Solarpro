// ═══════════════════════════════════════════════════════════════════════════
// "UP" IS THE GEODETIC SURFACE NORMAL, NOT THE DIRECTION TO THE EARTH'S CENTRE.
//
// `computePlaneFromPoints3D` built its ENU frame from `normalize3(centroid)` —
// the GEOCENTRIC radial. On an oblate ellipsoid that differs from true local up
// by up to 0.1924°, as sin(2·latitude), and EVERY pitch and azimuth in this
// application is measured against that vector.
//
// It survived for years because it is not a uniform bias. It is a deflection in
// a fixed compass direction, so it adds to a north-facing slope and subtracts
// from a south-facing one. The visible symptom was therefore not "every roof is
// 0.19° out" — which nobody would notice — but "the two halves of one symmetric
// gable disagree", which is wrong in a way an engineer has to question:
//
//     slope A  30.2565°     slope B  29.8813°     truth  30.0000°
//
// `roofPlanes[0].pitch` is the array tilt lib/pvwatts.ts reads, so which half
// sorted first moved the production estimate.
//
// These tests measure against an INDEPENDENT computation of the WGS84 normal,
// derived from the ellipsoid's defining constants rather than from the function
// under test, so they cannot agree with it by sharing its mistake.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computePlaneFromPoints3D, latLngToECEF, type Cart3 } from '@/lib/roofPlane3D';

const DEG = Math.PI / 180;
/** WGS84, from the defining constants — NOT imported from the module under test. */
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);

/** The true geodetic surface normal at an ECEF point: the ellipsoid gradient. */
function geodeticUp(p: Cart3): Cart3 {
  const v = { x: p.x / (A * A), y: p.y / (A * A), z: p.z / (B * B) };
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** The GEOCENTRIC radial — what the code used to use. Kept so the tests can
 *  show the two genuinely differ at the latitudes being tested. */
function geocentricUp(p: Cart3): Cart3 {
  const m = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / m, y: p.y / m, z: p.z / m };
}

function angleBetweenDeg(a: Cart3, b: Cart3): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
  return Math.acos(Math.min(1, d)) * 180 / Math.PI;
}

/**
 * A planar face tilted by `pitchDeg`, falling toward `azDeg`, built by lifting
 * corners in TRUE local metres so the geometry itself is exact.
 */
function face(latDeg: number, lngDeg: number, pitchDeg: number, azDeg: number, sizeM = 10): Cart3[] {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - (2 * F - F * F) * s * s;
  const mLat = (A * (1 - (2 * F - F * F)) / Math.pow(w, 1.5)) * DEG;
  const mLng = (A / Math.sqrt(w)) * Math.cos(latDeg * DEG) * DEG;
  // Downslope unit vector in (east, north).
  const dE = Math.sin(azDeg * DEG), dN = Math.cos(azDeg * DEG);
  const tan = Math.tan(pitchDeg * DEG);
  const corners: Array<[number, number]> = [
    [-sizeM / 2, -sizeM / 2], [sizeM / 2, -sizeM / 2], [sizeM / 2, sizeM / 2], [-sizeM / 2, sizeM / 2],
  ];
  return corners.map(([e, n]) => {
    const along = e * dE + n * dN;              // + = further downslope = lower
    return latLngToECEF(latDeg + n / mLat, lngDeg + e / mLng, 100 - along * tan);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('🚨 the two verticals genuinely differ — the control for everything below', () => {
  it.each([15, 25, 38.6657, 45, 52, 60])('at %s°N the deflection is non-trivial', (lat) => {
    const p = latLngToECEF(lat, -89.9, 100);
    const d = angleBetweenDeg(geodeticUp(p), geocentricUp(p));
    // Peaks at 45°, where it is ~0.1924°, and vanishes at the equator and poles.
    expect(d).toBeGreaterThan(0.04);
    expect(d).toBeLessThan(0.2);
  });

  it('…and vanishes at the equator, where the old code was accidentally right', () => {
    const p = latLngToECEF(0, -89.9, 100);
    expect(angleBetweenDeg(geodeticUp(p), geocentricUp(p))).toBeLessThan(1e-9);
  });
});

describe('🚨 tilt is measured against the geodetic normal', () => {
  it.each([15, 25, 38.6657, 45, 52, 60, -33])(
    'at %s° a 30° face reports 30°, not 30° ± the deflection',
    (lat) => {
      for (const az of [0, 90, 180, 270]) {
        const f = computePlaneFromPoints3D(face(lat, -89.9, 30, az));
        expect(f.tiltDeg, `lat ${lat} az ${az}`).toBeCloseTo(30, 2);
      }
    },
  );

  it('🚨 OPPOSING SLOPES AGREE — the symptom that made this visible', () => {
    // A north-facing and a south-facing slope at the same pitch. The deflection
    // is a fixed direction, so it USED to add to one and subtract from the
    // other: measured 30.2565 and 29.8813, 0.376° apart, which is exactly
    // 2 × 0.1924 × sin(2φ).
    for (const lat of [25, 38.6657, 45, 52]) {
      const north = computePlaneFromPoints3D(face(lat, -89.9, 30, 0));
      const south = computePlaneFromPoints3D(face(lat, -89.9, 30, 180));
      expect(Math.abs(north.tiltDeg - south.tiltDeg), `lat ${lat}`).toBeLessThan(0.01);
    }
  });

  it('a flat face reads flat, so the `pitch > 0` guards downstream can work', () => {
    // It used to read ~0.19° — strictly positive, so it slipped past every
    // guard written to catch a flattened face. See tests/squareUpPreservesPitch.
    for (const lat of [25, 38.6657, 45]) {
      expect(computePlaneFromPoints3D(face(lat, -89.9, 0, 180)).tiltDeg).toBeLessThan(0.001);
    }
  });

  it('the fitted normal actually IS perpendicular to the geodetic up by tilt', () => {
    // The independent check: the angle between the fitted normal and the true
    // WGS84 normal must equal the reported tilt.
    for (const lat of [25, 45, 60]) {
      for (const pitch of [10, 30, 45]) {
        const pts = face(lat, -89.9, pitch, 135);
        const f = computePlaneFromPoints3D(pts);
        const c = {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
          z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
        };
        expect(angleBetweenDeg(f.normal, geodeticUp(c)), `lat ${lat} pitch ${pitch}`)
          .toBeCloseTo(f.tiltDeg, 2);
      }
    }
  });
});

describe('azimuth survives the datum change', () => {
  it.each([0, 45, 90, 135, 180, 225, 270, 315])('a face falling toward %s° says so', (az) => {
    const f = computePlaneFromPoints3D(face(38.6657, -89.9, 30, az));
    const gap = Math.abs(((f.azimuthDeg - az) % 360 + 360) % 360);
    expect(Math.min(gap, 360 - gap), `reported ${f.azimuthDeg.toFixed(2)}`).toBeLessThan(0.5);
  });
});
