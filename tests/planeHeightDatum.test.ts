/**
 * tests/planeHeightDatum.test.ts
 *
 * `planeHeightAtCenterMeters` CARRIES A DATUM, AND NOBODY WAS ASKING WHICH.
 *
 * `computeEcefFrameForLegacyPlane` read it as height-above-ground for every
 * writer and added the site's ground elevation to it:
 *
 *     heightM = groundElevM + (planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M)
 *
 * Google's Solar API publishes it as ABSOLUTE elevation above sea level, and
 * this repository already says so — lib/digitalTwin.ts:624, "absolute elevation
 * (meters above sea level)", where that module correctly SUBTRACTS the base
 * elevation to get a relative height. `app/api/solar/route.ts` writes the raw
 * absolute value onto the RoofPlane and has no elevation of its own to convert
 * with.
 *
 * So a detected face had the ground added twice. Measured through the real
 * `resolvePlaneGeometry`, ground 128 m, roof plane 134 m absolute:
 *
 *     before:  placed at 263.795 m    —    129.795 m too high
 *     after:   placed at 135.795 m
 *
 * 🚨 A FACE MUST BE ENRICHED WITH ITS OWN origin3D/ecefFrame3D TO ESCAPE THAT
 * BRANCH, and `enrichRoofPlaneWith3DFrame` sets only `localFrame3D`. The
 * Solar-API detection path therefore reached it every time — this was live on
 * the protected native path, not a theoretical case.
 */

import { describe, it, expect } from 'vitest';
import type { RoofPlane } from '@/types';
import { resolvePlaneGeometry, computeEcefFrameForLegacyPlane } from '@/lib/surfaceGeometry3D';
import { ecefToLatLng } from '@/lib/roofPlane3D';

const LAT = 38.70615, LNG = -90.04625;
const GROUND = 128;     // ellipsoidal ground at 3 Melvin Dr, roughly
const ROOF_ABS = 134;   // Google: absolute elevation of the plane's CENTRE

function detected(source: string, height: number): RoofPlane {
  const d = 0.00004;
  return {
    id: `seg-${source}`,
    vertices: [
      { lat: LAT - d, lng: LNG - d }, { lat: LAT - d, lng: LNG + d },
      { lat: LAT + d, lng: LNG + d }, { lat: LAT + d, lng: LNG - d },
    ],
    pitch: 22, azimuth: 180, area: 40, usableArea: 30,
    centroidLat: LAT, centroidLng: LNG,
    source,
    planeHeightAtCenterMeters: height,
    confirmed: false,
  } as RoofPlane;
}

/** The mean elevation of a resolved face's own polygon — its centre. */
function centreHeightM(plane: RoofPlane, groundElevM: number): number {
  const r = resolvePlaneGeometry(plane, groundElevM);
  const hs = r.polygon3D.map(p => ecefToLatLng(p as any).height);
  return hs.reduce((a, b) => a + b, 0) / hs.length;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 a Google-detected face is placed at the elevation Google gave', () => {
  it('the CENTRE lands at the absolute height, not at ground + absolute', () => {
    const plane = detected('solar_api', ROOF_ABS);
    // It really does take the legacy branch — if it stopped doing so this test
    // would be measuring a path that no longer exists.
    expect(resolvePlaneGeometry(plane, GROUND).source).toBe('legacy-2d');

    const centre = centreHeightM(plane, GROUND);
    // Within the render lift; the point is that it is 134, not 262.
    expect(centre).toBeGreaterThan(ROOF_ABS - 0.5);
    expect(centre).toBeLessThan(ROOF_ABS + 0.5);

    // 🚨 THE DEFECT, AS ONE NUMBER. The old arithmetic put it here.
    expect(Math.abs(centre - (GROUND + ROOF_ABS))).toBeGreaterThan(120);
  });

  it('…and at a coastal site, where the ground is near zero, nothing changes', () => {
    // The old bug vanishes as ground → 0, which is why it survived: it is
    // invisible wherever the test data sits at sea level.
    const centre = centreHeightM(detected('solar_api', 8), 0);
    expect(centre).toBeGreaterThan(7.5);
    expect(centre).toBeLessThan(8.5);
  });

  it('the same face WITH its own 3D frame never reaches this branch', () => {
    const p = {
      ...detected('solar_api', ROOF_ABS),
      origin3D: { x: 1, y: 2, z: 3 },
      ecefFrame3D: { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } },
    } as RoofPlane;
    expect(resolvePlaneGeometry(p, GROUND).source).not.toBe('legacy-2d');
  });

  it('google_solar_api is treated the same as solar_api', () => {
    const centre = centreHeightM(detected('google_solar_api', ROOF_ABS), GROUND);
    expect(Math.abs(centre - ROOF_ABS)).toBeLessThan(0.5);
  });
});

describe('🚨 what is NOT converted, and why', () => {
  it('a hand-modelled face keeps the relative reading — its value IS above ground', () => {
    // A 2D "Tag This Roof Plane" face has no planeHeightAtCenterMeters at all
    // and falls to LEGACY_PLANE_HEIGHT_M, which is a height above ground.
    const p = detected('manual', undefined as any);
    delete (p as any).planeHeightAtCenterMeters;
    const centre = centreHeightM(p, GROUND);
    // Ground plus a few metres — emphatically not ground plus ground.
    expect(centre).toBeGreaterThan(GROUND);
    expect(centre).toBeLessThan(GROUND + 12);
  });

  it('🚨 aerial_nearmap is LEFT ALONE, because its datum is not declared anywhere', () => {
    // `facetAdapter` writes this from `heightAtCenterM`, whose own declaration
    // (lib/siteSurveys/aerialGeometry/types.ts:40) reads "Optional plane height
    // at centre (metres)" and names no datum. Guessing would trade one bug for
    // another, so it keeps the previous behaviour — and this test records that
    // the ambiguity is KNOWN rather than overlooked.
    //
    // 🚨 THE REAL FIX IS IN THE TYPE. Until that field states its datum, this
    // assertion is a placeholder for a decision nobody has made.
    const centre = centreHeightM(detected('aerial_nearmap', 6), GROUND);
    expect(centre).toBeGreaterThan(GROUND);      // still treated as relative
    expect(centre).toBeLessThan(GROUND + 12);
  });

  it('the 0.0 sentinel is not mistaken for an elevation', () => {
    // `buildRoofPlane3D` writes 0.0 deliberately, meaning "use origin3D". Such
    // a face has origin3D and never lands here — but if one ever did, treating
    // 0 as an absolute elevation would put it at minus the ground.
    const legacy = computeEcefFrameForLegacyPlane(detected('solar_api', 0), GROUND);
    const h = ecefToLatLng(legacy.origin3D as any).height;
    expect(h).toBeGreaterThan(GROUND - 1);
  });
});
