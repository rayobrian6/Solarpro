/**
 * tests/planeFrameAuthority.test.ts
 *
 * A FACE THAT KNOWS ITS OWN FRAME MUST NOT BE GUESSED AT.
 *
 * `buildSurfaceGrid` used to resolve a plane's geometry with one all-or-nothing
 * test:
 *
 *     if (createdFrom3D && origin3D && ecefFrame3D && polygon3D?.length >= 3)
 *         use them
 *     else
 *         computeEcefFrameForLegacyPlane(plane, groundElevM)
 *
 * The fallback rebuilds the frame from
 * `planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M`, and `buildRoofPlane3D`
 * writes **0.0** into that field on purpose — a "don't read me, read origin3D"
 * sentinel. `??` keeps a real 0. So a 3D face that had lost only its OUTLINE,
 * while still carrying a perfectly good origin and frame, had its entire array
 * placed at GROUND ELEVATION:
 *
 *     WITH polygon3D    55 panels at 163.79 m
 *     WITHOUT polygon3D 55 panels at 129.58 m      (measured, ground = 128 m)
 *
 * Thirty-four metres below the roof, no error, correct panel count — the same
 * signature as every other defect in this family.
 *
 * 🚨 AND THE FILE DISAGREED WITH ITSELF. `placeSinglePanel`, `extendRow` and
 * `addRow` ask only for `ecefFrame3D && origin3D`. The same face therefore got
 * panels on the roof from one tool and underground from another — two answers
 * to "does this face have a usable 3D frame?" inside one file, which is the
 * condition `lib/roofMountDatum.ts` exists to end for the mount stack.
 *
 * The frame and the outline are separate facts and are now resolved separately.
 */

import { describe, it, expect } from 'vitest';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { buildSurfaceGrid, computeEcefFrameForLegacyPlane } from '@/lib/surfaceGeometry3D';
import { moduleStackHeightM } from '@/lib/roofMountDatum';
import type { RoofPlane } from '@/types';

const DEG = Math.PI / 180;
const LAT = 38.6657, LNG = -90.2266;
const M_LAT = 111_320;
const GROUND_M = 128;   // ellipsoidal ground at the demo site
const EAVE_M   = 160;   // the roof itself — 32 m above it
const MOUNT    = 'ironridge-xr100';
const STACK    = moduleStackHeightM(MOUNT);

function tracedFace(): RoofPlane {
  const mLng = M_LAT * Math.cos(LAT * DEG);
  const dLng = 7 / mLng, dLat = 4.5 / M_LAT;
  const ridge = EAVE_M + 9 * Math.tan(25 * DEG);
  return buildRoofPlane3D([
    latLngToECEF(LAT - dLat, LNG - dLng, EAVE_M),
    latLngToECEF(LAT - dLat, LNG + dLng, EAVE_M),
    latLngToECEF(LAT + dLat, LNG + dLng, ridge),
    latLngToECEF(LAT + dLat, LNG - dLng, ridge),
  ]);
}

function fill(plane: RoofPlane) {
  return buildSurfaceGrid({
    plane,
    groundElevM: GROUND_M,
    orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0, rowSpacingM: 0,
    layoutId: 'frame-authority',
    wattage: 400,
    mountingSystemId: MOUNT,
  } as never);
}

/** Signed height of a panel above the plane it belongs to, along its normal. */
function clearanceM(panel: { lat: number; lng: number; height?: number }, plane: RoofPlane) {
  const n = plane.ecefFrame3D!.n, o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

describe('a plane keeps its own frame when only its outline is missing', () => {
  const face = tracedFace();

  it('the fixture is the shape the defect needs, and the sentinel is really 0', () => {
    // Guard the guard. If buildRoofPlane3D ever starts writing a real height
    // here, the fallback stops being catastrophic and this file must be re-read
    // rather than silently continuing to pass.
    expect(face.planeHeightAtCenterMeters,
      'buildRoofPlane3D writes 0.0 as a "use origin3D instead" sentinel').toBe(0);
    expect(face.origin3D).toBeTruthy();
    expect(face.ecefFrame3D).toBeTruthy();
    expect(face.polygon3D?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(face.createdFrom3D).toBe(true);
  });

  it('🚨 a face that lost polygon3D still places its panels on the ROOF', () => {
    const whole = fill(face);
    expect(whole.length, 'the intact face must fill, or nothing is being compared')
      .toBeGreaterThan(10);

    const stripped = { ...face, polygon3D: undefined } as unknown as RoofPlane;
    const partial = fill(stripped);
    expect(partial.length, 'the stripped face must still fill').toBeGreaterThan(0);

    for (const p of partial) {
      expect(Math.abs(clearanceM(p, face) - STACK),
        `panel ${p.id} is ${clearanceM(p, face).toFixed(2)} m above the face it belongs to; ` +
        `one mount stack is ${STACK} m. A value near ${(GROUND_M - EAVE_M).toFixed(0)} m means ` +
        'the frame was rebuilt from the 0.0 sentinel and the array is at ground level.',
      ).toBeLessThan(0.02);
    }
  });

  it('🚨 the same cells are filled, and at the same height to within the known plan offset', () => {
    // The strongest honest form. The FRAME decides the height, so the two runs
    // must agree on the panel set; the OUTLINE decides the clip, and the two
    // outlines are not identical by design:
    //
    //   polygon3D  is the LIFTED render outline (SURFACE_OFFSET_M along n)
    //   vertices   is the PLAN record, taken BEFORE that lift on purpose —
    //              deriving it from the lifted points slid every face down-slope
    //              by offset·sin(tilt) and SPLIT the ridge on the permit plan.
    //
    // So a reconstruction from `vertices` sits offset·sin(tilt) = 5.1 cm up-slope
    // of `polygon3D` in plan. The grid start can move by that much along v, which
    // shows up in height as at most another sin(tilt). Measured: 2.4 cm. The
    // bound below is the plan offset itself, derived — not a number chosen to
    // make this pass.
    const PLAN_OFFSET_M = 0.12 * Math.sin(25 * DEG);   // SURFACE_OFFSET_M · sin(tilt)

    const whole = fill(face);
    const partial = fill({ ...face, polygon3D: undefined } as unknown as RoofPlane);
    expect(partial.length,
      'the two runs must fill the same cells — a different COUNT means the frame ' +
      'itself changed, not just the clip outline',
    ).toBe(whole.length);

    const h1 = whole.map(p => p.height!).sort((a, b) => a - b);
    const h2 = partial.map(p => p.height!).sort((a, b) => a - b);
    const worst = Math.max(...h1.map((h, i) => Math.abs(h - h2[i])));
    expect(worst, `worst height difference ${worst.toFixed(4)} m`).toBeLessThan(PLAN_OFFSET_M);
    // And nowhere near the 32 m the old fallback produced.
    expect(worst).toBeLessThan(0.1);
  });

  it('the legacy rebuild really does land at ground level — the fallback is the hazard', () => {
    // Not a hypothetical. This is what the old code called, with the same input.
    const legacy = computeEcefFrameForLegacyPlane(
      { ...face, polygon3D: undefined } as unknown as RoofPlane,
      GROUND_M,
    );
    // Measure the rebuilt origin against the true face.
    const n = face.ecefFrame3D!.n, o = face.origin3D!;
    const d = (legacy.origin3D.x - o.x) * n.x + (legacy.origin3D.y - o.y) * n.y + (legacy.origin3D.z - o.z) * n.z;
    expect(Math.abs(d),
      'computeEcefFrameForLegacyPlane rebuilds a 3D face tens of metres off, because ' +
      'planeHeightAtCenterMeters is the 0.0 sentinel. That is why the resolution above ' +
      'must not fall through to it when the plane has its own frame.',
    ).toBeGreaterThan(5);
  });

  it('a genuinely 2D plane still uses the legacy rebuild — this is not over-fitted', () => {
    // A plane with no 3D geometry at all has a MEANINGFUL planeHeightAtCenterMeters
    // and must keep using it. Removing the fallback entirely would break every
    // Google-Solar 2D face.
    const twoD: RoofPlane = {
      id: 'legacy-2d',
      vertices: face.vertices,
      pitch: face.pitch,
      azimuth: face.azimuth,
      area: face.area,
      usableArea: face.usableArea,
      centroidLat: face.centroidLat,
      centroidLng: face.centroidLng,
      planeHeightAtCenterMeters: 5.2,   // a real height above ground
    } as unknown as RoofPlane;
    const panels = fill(twoD);
    expect(panels.length, 'a 2D plane must still fill').toBeGreaterThan(0);
    // 128 + 5.2 + one mount stack, give or take the grid.
    const h = panels[0].height!;
    expect(h, `a 2D face should land near ${GROUND_M + 5.2} m, got ${h.toFixed(2)}`)
      .toBeGreaterThan(GROUND_M + 4);
    expect(h).toBeLessThan(GROUND_M + 7);
  });
});

describe('a legacy 2D face lies on the plane it declares', () => {
  /**
   * 🚨 IT DID NOT, AND THE ERROR GREW WITH THE ROOF.
   *
   * `computeEcefFrameForLegacyPlane` computes each corner's HEIGHT with a
   * flat-earth projection (metres per degree, times cos(lat)) and then hands it
   * to `latLngToECEF`, which places it on the curved ellipsoid. The corners
   * therefore did not lie on the plane the same function returns:
   *
   *     14 x  9 m at 25 deg     5.3 mm
   *     28 x 18 m at 25 deg    10.6 mm
   *     14 x  9 m at 40 deg     8.0 mm
   *
   * Panels are placed from `origin3D` and the deck is drawn by re-fitting
   * `polygon3D`, so that residual became a direct disagreement between the
   * modules and the roof under them — small here, unbounded on a commercial
   * face, and on the same axis as every other defect in this family.
   */
  const cases: Array<[number, number, number]> = [
    [25, 14, 9], [25, 28, 18], [40, 14, 9], [10, 14, 9], [45, 40, 25],
  ];

  function twoDFace(tiltDeg: number, widthM: number, depthM: number): RoofPlane {
    const mLng = M_LAT * Math.cos(LAT * DEG);
    const dLng = widthM / 2 / mLng, dLat = depthM / 2 / M_LAT;
    return {
      id: `legacy-${tiltDeg}-${widthM}x${depthM}`,
      pitch: tiltDeg, azimuth: 180,
      vertices: [
        { lat: LAT - dLat, lng: LNG - dLng }, { lat: LAT - dLat, lng: LNG + dLng },
        { lat: LAT + dLat, lng: LNG + dLng }, { lat: LAT + dLat, lng: LNG - dLng },
      ],
      area: widthM * depthM, usableArea: widthM * depthM * 0.75,
      centroidLat: LAT, centroidLng: LNG,
      planeHeightAtCenterMeters: 5.2,
    } as unknown as RoofPlane;
  }

  for (const [tilt, w, d] of cases) {
    it(`🚨 ${w}x${d} m at ${tilt}° — every corner is ON the declared plane`, () => {
      const legacy = computeEcefFrameForLegacyPlane(twoDFace(tilt, w, d), GROUND_M);
      expect(legacy.polygon3D.length, 'the fixture produced no polygon').toBeGreaterThanOrEqual(3);
      const o = legacy.origin3D, n = legacy.ecefFrame3D.n;
      const worst = Math.max(...legacy.polygon3D.map(c =>
        Math.abs((c.x - o.x) * n.x + (c.y - o.y) * n.y + (c.z - o.z) * n.z)));
      // Float noise only. The pre-fix values are listed above; 1e-6 is three
      // orders below the smallest of them, so this cannot pass on a regression.
      expect(worst, `worst corner is ${(worst * 1000).toFixed(3)} mm off its own plane`)
        .toBeLessThan(1e-6);
    });
  }

  it('and the corners still describe the same FOOTPRINT — this is a projection, not a shrink', () => {
    // Guard against the lazy fix: collapsing the polygon onto a point would
    // satisfy every assertion above.
    const legacy = computeEcefFrameForLegacyPlane(twoDFace(25, 14, 9), GROUND_M);
    const o = legacy.origin3D, u = legacy.ecefFrame3D.u, v = legacy.ecefFrame3D.v;
    const uv = legacy.polygon3D.map(c => {
      const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z;
      return { u: dx * u.x + dy * u.y + dz * u.z, v: dx * v.x + dy * v.y + dz * v.z };
    });
    const uSpan = Math.max(...uv.map(p => p.u)) - Math.min(...uv.map(p => p.u));
    const vSpan = Math.max(...uv.map(p => p.v)) - Math.min(...uv.map(p => p.v));
    // 14 m along the eave; 9 m of PLAN depth becomes 9/cos(25°) on the slope.
    expect(uSpan, `u span ${uSpan.toFixed(3)} m`).toBeGreaterThan(13);
    expect(uSpan).toBeLessThan(15);
    expect(vSpan, `v span ${vSpan.toFixed(3)} m`).toBeGreaterThan(8);
    expect(vSpan).toBeLessThan(11);
  });
});
