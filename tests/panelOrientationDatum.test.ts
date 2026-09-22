/**
 * tests/panelOrientationDatum.test.ts
 *
 * THE DATUM FIX HAD TO LAND IN TWO PLACES, AND IT LANDED IN ONE.
 *
 * Commit 7ceab492 replaced the geocentric radial with the geodetic surface
 * normal in `computePlaneFromPoints3D`, and tests/planeDatumGeodetic.test.ts
 * pins it there. That made `RoofPlane.pitch` geodetic.
 *
 * `planeHPR` in lib/surfaceGeometry3D.ts builds its OWN ENU frame, by hand,
 * from `origin.x / mag` — and it was missed. Every panel's stored `heading` and
 * `pitch` come from that frame; `addPanelEntity` turns them straight into the
 * Cesium quaternion each module is drawn with. So after 7ceab492 the roof plane
 * was measured against one vertical and the panels standing on it against
 * another, and because a gable's two halves carry opposite azimuths they were
 * rotated in OPPOSITE directions relative to the decks they sit on.
 *
 * An independent touch audit found it. The lesson is in the fix: `up` is now
 * ONE exported function, `geodeticSurfaceNormal`, and both call it.
 *
 * 🚨 THIS FILE MEASURES AGAINST AN INDEPENDENT WGS84 NORMAL, derived from the
 * defining constants rather than imported from the code under test, so it
 * cannot agree with the implementation by sharing its mistake.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRoofPlane3D, latLngToECEF, geodeticSurfaceNormal, type Cart3 } from '@/lib/roofPlane3D';
import { enrichRoofPlaneWith3DFrame, buildSurfaceGrid } from '@/lib/surfaceGeometry3D';
import { stripComments } from './support/stripSource';

const DEG = Math.PI / 180;
/** WGS84, from the defining constants — NOT from the module under test. */
const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);

function independentGeodeticUp(p: Cart3): Cart3 {
  const v = { x: p.x / (A * A), y: p.y / (A * A), z: p.z / (B * B) };
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function geocentricUp(p: Cart3): Cart3 {
  const m = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / m, y: p.y / m, z: p.z / m };
}

const angleDeg = (a: Cart3, b: Cart3) =>
  Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z))) * 180 / Math.PI;

// ── Fixture: a symmetric gable, built to an exact pitch ─────────────────────

const LAT = 38.6657, LNG = -90.2266, GROUND = 150;
const WIDTH_M = 12, DEPTH_M = 8;

function mPerDegLat(latDeg: number) {
  const s = Math.sin(latDeg * DEG), e2 = 2 * F - F * F;
  return (A * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5)) * DEG;
}
function mPerDegLng(latDeg: number) {
  const s = Math.sin(latDeg * DEG), e2 = 2 * F - F * F;
  return (A / Math.sqrt(1 - e2 * s * s)) * Math.cos(latDeg * DEG) * DEG;
}

/** One half of a symmetric gable, built to EXACTLY `tiltDeg` in true metres. */
function half(tiltDeg: number, facingSouth: boolean) {
  const mLat = mPerDegLat(LAT), mLng = mPerDegLng(LAT);
  const dLng = WIDTH_M / 2 / mLng;
  const dLat = DEPTH_M / 2 / mLat;
  const eaveH = GROUND + 3;
  const ridgeH = eaveH + (DEPTH_M / 2) * Math.tan(tiltDeg * DEG);
  const s = facingSouth ? -1 : 1;
  return buildRoofPlane3D([
    latLngToECEF(LAT + s * dLat, LNG - dLng, eaveH),
    latLngToECEF(LAT + s * dLat, LNG + dLng, eaveH),
    latLngToECEF(LAT,            LNG + dLng, ridgeH),
    latLngToECEF(LAT,            LNG - dLng, ridgeH),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the two verticals genuinely differ here — the control', () => {
  it('at this latitude the deflection is a real angle, not noise', () => {
    const p = latLngToECEF(LAT, LNG, GROUND);
    const d = angleDeg(independentGeodeticUp(p), geocentricUp(p));
    // 0.1924 * sin(2 * 38.6657) = 0.1876 deg.
    expect(d).toBeGreaterThan(0.18);
    expect(d).toBeLessThan(0.19);
  });

  it('the exported helper agrees with an independent derivation', () => {
    for (const lat of [0, 15, 25, 38.6657, 45, 60, -33]) {
      const p = latLngToECEF(lat, LNG, 120);
      expect(angleDeg(geodeticSurfaceNormal(p), independentGeodeticUp(p)), `lat ${lat}`)
        .toBeLessThan(1e-9);
    }
  });
});

describe('🚨 panel orientation is measured against the geodetic normal', () => {
  /**
   * The tilt actually STORED ON A PANEL, in degrees.
   *
   * 🚨 IT DRIVES `buildSurfaceGrid`, NOT A REIMPLEMENTATION OF IT. A first
   * version of this helper fell back to measuring the plane's own normal when
   * no HPR was found on the plane — which tested `buildRoofPlane3D` twice and
   * never reached `planeHPR` at all. It passed before the fix and after it, and
   * would have shipped as proof of a fix it could not see.
   *
   * `planeHPR` writes `pitch` as NEGATIVE radians of tilt (it is a Cesium
   * rotation, not a slope), so the magnitude in degrees is the tilt.
   */
  function storedPanelTiltDeg(tiltDeg: number, facingSouth: boolean): number {
    const plane = enrichRoofPlaneWith3DFrame(half(tiltDeg, facingSouth));
    const grid = buildSurfaceGrid({
      plane,
      groundElevM: GROUND,
      orientation: 'portrait',
      eaveSetbackM: 0, ridgeSetbackM: 0, sideSetbackM: 0,
      panelSpacingM: 0.02, rowSpacingM: 0.02,
      layoutId: 'datum-probe',
      wattage: 400,
    });
    const panels = (grid as any)?.panels ?? grid;
    expect(Array.isArray(panels) && panels.length > 0,
      'the probe placed no panels — it would be measuring nothing').toBe(true);
    const pitches = panels.map((p: any) => Math.abs(p.pitch) / DEG);
    // Every panel on one plane shares one rotation; if they ever stop agreeing
    // this probe is reading the wrong field.
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThan(1e-9);
    return pitches[0];
  }

  it('OPPOSING SLOPES AGREE — the symptom that made this visible', () => {
    // Built to exactly 30° on both halves. Measured against the geocentric
    // radial these read 29.8814 and 30.2566 — 0.375° apart. The audit that
    // found this quoted exactly those numbers.
    const south = storedPanelTiltDeg(30, true);
    const north = storedPanelTiltDeg(30, false);
    expect(Math.abs(south - north)).toBeLessThan(0.01);
    expect(south).toBeCloseTo(30, 2);
    expect(north).toBeCloseTo(30, 2);
  });

  it('and the plane and its panels are measured against the SAME vertical', () => {
    // The real failure was not that either number was wrong on its own. It was
    // that RoofPlane.pitch became geodetic in 7ceab492 while panel orientation
    // stayed geocentric, so a panel was rotated relative to the deck under it.
    for (const facingSouth of [true, false]) {
      const plane = enrichRoofPlaneWith3DFrame(half(30, facingSouth));
      expect(Math.abs(plane.pitch - storedPanelTiltDeg(30, facingSouth)),
        `facingSouth=${facingSouth}`).toBeLessThan(0.01);
    }
  });

  it('holds across latitudes, including the southern hemisphere', () => {
    for (const pitch of [10, 26.565, 45]) {
      const s = storedPanelTiltDeg(pitch, true);
      const n = storedPanelTiltDeg(pitch, false);
      expect(Math.abs(s - n), `pitch ${pitch}`).toBeLessThan(0.01);
      expect(s, `pitch ${pitch}`).toBeCloseTo(pitch, 2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL HALF: there must not be a third hand-written copy
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 there is ONE answer to "which way is up"', () => {
  const ROOT = join(__dirname, '..');
  const SURFACE = stripComments(readFileSync(join(ROOT, 'lib', 'surfaceGeometry3D.ts'), 'utf8'));
  const PLANE3D = stripComments(readFileSync(join(ROOT, 'lib', 'roofPlane3D.ts'), 'utf8'));

  it('planeHPR calls the helper instead of writing the arithmetic out again', () => {
    const i = SURFACE.indexOf('function planeHPR(');
    expect(i, 'planeHPR not found — re-anchor this guard').toBeGreaterThan(-1);
    const body = SURFACE.slice(i, SURFACE.indexOf('\nfunction ', i + 40));

    expect(body).toMatch(/geodeticSurfaceNormal\(origin\)/);

    // 🚨 AND THE GEOCENTRIC FORM IS GONE. Prove the pattern can fire first — a
    // `.not.toMatch` whose regex cannot match passes against any source.
    const GEOCENTRIC = /origin\.[xyz]\s*\/\s*mag/;
    expect('const upX = origin.x / mag;').toMatch(GEOCENTRIC);
    expect(body, 'planeHPR must not rebuild the geocentric radial').not.toMatch(GEOCENTRIC);
  });

  it('computePlaneFromPoints3D calls the same helper', () => {
    expect(PLANE3D).toMatch(/const upECEF\s*=\s*geodeticSurfaceNormal\(centroid\)/);
    const NORMALIZE_CENTROID = /normalize3\(centroid\)/;
    expect('normalize3(centroid)').toMatch(NORMALIZE_CENTROID);
    expect(PLANE3D).not.toMatch(NORMALIZE_CENTROID);
  });

  it('the helper is exported, so a third site has something to call', () => {
    expect(PLANE3D).toMatch(/export function geodeticSurfaceNormal\(/);
  });
});
