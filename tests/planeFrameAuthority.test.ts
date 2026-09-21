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
import {
  buildSurfaceGrid, computeEcefFrameForLegacyPlane, resolvePlaneGeometry, extendRow, addRow,
  repairPanelElevations, hasUsableElevation,
} from '@/lib/surfaceGeometry3D';
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
    // A reconstruction from `vertices` would sit offset·sin(tilt) = 5.1 cm
    // up-slope of `polygon3D` in plan, and the grid snap turned that into 2.4 cm
    // of height — measured, and for a while merely BOUNDED here, which is how a
    // 5 cm disagreement between two branches of one function got written down as
    // a tolerance. `polygonFromVerticesOnFrame` reconstructs the lift instead,
    // so the two branches now agree outright and this asserts that rather than
    // excusing it.
    //
    // The floor is the 7-decimal lat/lng quantum the reconstruction round-trips
    // through: half a unit in the last place, in both axes, tipped into the
    // normal by sin(tilt).
    const ROUNDING_M = (Math.pow(10, -7) / 2) * M_LAT * Math.SQRT2 * Math.sin(25 * DEG) + 1e-4;

    const whole = fill(face);
    const partial = fill({ ...face, polygon3D: undefined } as unknown as RoofPlane);
    expect(partial.length,
      'the two runs must fill the same cells — a different COUNT means the frame ' +
      'itself changed, not just the clip outline',
    ).toBe(whole.length);

    // 🚨 GUARD THE COMPARISON. `Math.max(...[])` is -Infinity, which is less
    // than any bound, so two empty arrays would have satisfied everything below
    // — and `expect(0).toBe(0)` above would have agreed with them.
    expect(whole.length, 'the intact face placed nothing').toBeGreaterThan(2);
    expect(partial.length, 'the stripped face placed nothing').toBeGreaterThan(2);

    const h1 = whole.map(p => p.height!).sort((a, b) => a - b);
    const h2 = partial.map(p => p.height!).sort((a, b) => a - b);
    const worst = Math.max(...h1.map((h, i) => Math.abs(h - h2[i])));
    expect(Number.isFinite(worst), 'nothing was compared').toBe(true);
    expect(worst, `worst height difference ${worst.toFixed(5)} m`).toBeLessThan(ROUNDING_M);
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

describe('every placement path in the file resolves the face the same way', () => {
  /**
   * 🚨 THE FILE ANSWERED "WHERE IS THIS FACE" FOUR DIFFERENT WAYS.
   *
   *   buildSurfaceGrid   needed createdFrom3D + origin3D + ecefFrame3D + polygon3D
   *   placeSinglePanel   needed ecefFrame3D + origin3D, and passed NO ground
   *                      elevation to the legacy fallback — about 128 m low
   *   extendRow          needed ecefFrame3D + origin3D for the FRAME and
   *                      `plane.polygon3D ?? legacy` for the BOUNDARY, so a
   *                      panel placed on the roof was tested against an outline
   *                      at ground level
   *   addRow             the same two-field test
   *
   * So the same face got panels on the roof from one tool and underground from
   * another. They all call `resolvePlaneGeometry` now, and this asserts the
   * consequence rather than the call: every path puts a panel one mount stack
   * above the SAME plane, for every plane shape.
   */
  const MOUNTS = ['ironridge-xr100', 'ironridge-xr1000', 'rooftech-mini-s'];

  function shapes(): Array<[string, RoofPlane]> {
    const full = tracedFace();
    const noPoly = { ...full, polygon3D: undefined } as unknown as RoofPlane;
    const twoD = {
      id: 'legacy-2d', vertices: full.vertices, pitch: full.pitch, azimuth: full.azimuth,
      area: full.area, usableArea: full.usableArea,
      centroidLat: full.centroidLat, centroidLng: full.centroidLng,
      planeHeightAtCenterMeters: 5.2,
    } as unknown as RoofPlane;
    return [['full 3D', full], ['3D without polygon3D', noPoly], ['legacy 2D', twoD]];
  }

  for (const [name, plane] of shapes()) {
    for (const mount of MOUNTS) {
      it(`${name} · ${mount} — the grid and the row tools agree on the plane`, () => {
        const stack = moduleStackHeightM(mount);
        const geom = resolvePlaneGeometry(plane, GROUND_M);
        const n = geom.ecefFrame3D.n, o = geom.origin3D;
        const above = (pt: { lat: number; lng: number; height?: number }) => {
          const e = latLngToECEF(pt.lat, pt.lng, pt.height!);
          return (e.x - o.x) * n.x + (e.y - o.y) * n.y + (e.z - o.z) * n.z;
        };

        const grid = buildSurfaceGrid({
          plane, groundElevM: GROUND_M, orientation: 'portrait',
          eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
          panelSpacingM: 0, rowSpacingM: 0, layoutId: 'agree', wattage: 400,
          mountingSystemId: mount,
        } as never);
        expect(grid.length, 'the grid placed nothing — nothing is being compared').toBeGreaterThan(2);
        for (const p of grid) {
          expect(Math.abs(above(p) - stack), `grid panel ${p.id} at ${above(p).toFixed(3)} m`)
            .toBeLessThan(0.02);
        }

        // 🚨 `if (extended)` WAS THE VACUUM, AND I WROTE IT.
        // extendRow takes its FRAME from the plane's origin and used to take its
        // BOUNDARY from a ground-level rebuild, so on a face that had lost its
        // polygon it placed the panel correctly and then REJECTED it for being
        // "outside roof polygon" — tens of metres below. The observable symptom
        // is not a misplaced panel, it is NO PANEL, and a conditional
        // assertion cannot see that. Requiring the row to extend is what
        // detects it: the first mutation run of this test passed because of
        // exactly that `if`.
        // Leave room, or "no panel" is the CORRECT answer and the assertion
        // below would be a different kind of wrong. The grid packs the face to
        // its setbacks, so the last column is dropped to make a gap the row
        // tool can legitimately fill.
        const maxCol = Math.max(...grid.map((p: any) => p.col ?? 0));
        const withGap = grid.filter((p: any) => (p.col ?? 0) < maxCol);
        expect(withGap.length, 'dropping the last column left nothing').toBeGreaterThan(1);

        const extended = extendRow(withGap as never, plane, GROUND_M, 'portrait', 'agree', 400, mount);
        expect(extended,
          'extendRow refused to extend a row on a face it had just placed panels on — ' +
          'it is testing the new panel against an outline resolved differently from the frame',
        ).toBeTruthy();
        expect(Math.abs(above(extended!) - stack),
          `extendRow put its panel ${above(extended!).toFixed(3)} m above the plane`,
        ).toBeLessThan(0.02);

        const added = addRow(withGap as never, plane, GROUND_M, 'portrait', 'agree', 400, undefined, mount);
        expect(added && added.length, 'addRow placed no row at all').toBeTruthy();
        for (const p of added!) {
          expect(Math.abs(above(p) - stack), `addRow panel ${p.id} at ${above(p).toFixed(3)} m`)
            .toBeLessThan(0.02);
        }
      });
    }
  }
});

describe('a version snapshot that lost its panel elevations', () => {
  /**
   * 🚨 THE SNAPSHOT FIX WAS FORWARD-ONLY, AND I CALLED IT CLOSED.
   *
   * The layout route used to strip `height` out of every version snapshot. That
   * is fixed, but every snapshot taken BEFORE the fix still carries height-less
   * panels — and restoring one writes them over the live design. Drawn at sea
   * level before `hasUsableElevation`; not drawn AT ALL after it; `success:
   * true` either way.
   *
   * `repairPanelElevations` recovers the elevation from the plane the panel
   * already names, using the same rule as placement: one mount stack above the
   * face. It invents nothing about WHERE the panel is.
   */
  const MOUNT = 'ironridge-xr100';

  function filled() {
    const face = tracedFace();
    const panels = buildSurfaceGrid({
      plane: face, groundElevM: GROUND_M, orientation: 'portrait',
      eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
      panelSpacingM: 0, rowSpacingM: 0, layoutId: 'snap', wattage: 400,
      mountingSystemId: MOUNT,
    } as never);
    return { face, panels };
  }

  it('the fixture is a real filled face — the repair has something to recover', () => {
    const { panels } = filled();
    expect(panels.length).toBeGreaterThan(10);
    expect(panels.every(p => hasUsableElevation(p))).toBe(true);
  });

  it('🚨 a height-less panel set is restored to the SAME elevations it had', () => {
    const { face, panels } = filled();
    // Exactly what the old trim produced: every field but `height`.
    const stripped = panels.map(p => { const { height, ...rest } = p as never as Record<string, unknown>; void height; return rest; });

    const r = repairPanelElevations(stripped as never, [face], MOUNT, GROUND_M);
    expect(r.unrepairable, 'every panel names this plane, so none is unrepairable').toEqual([]);
    expect(r.repaired.length, 'every panel needed repair').toBe(panels.length);
    expect(r.panels.every(p => hasUsableElevation(p)), 'and every one has an elevation now').toBe(true);

    // 🚨 THE STRONG FORM: not "near the roof" but the SAME NUMBER, to the only
    // precision the record can carry. The repair reads the same authority the
    // placement engine wrote from, so the round trip is lossless EXCEPT for the
    // one thing the snapshot genuinely quantises: `lat`/`lng` are stored at 7
    // decimal places while `height` kept full precision. Recovering the height
    // at the ROUNDED position moves it by the horizontal error times the slope:
    //
    //     (0.5e-7 deg) x 111320 m/deg x sqrt(2)  =  7.87 mm horizontally
    //     7.87 mm x tan(25 deg)                  =  3.67 mm of height
    //
    // Measured: 2.1 mm. The bound is derived from the quantum, not chosen to
    // make this pass — a real regression is orders larger (31 m, 34 m, 0.12 m
    // are the failures this family has produced).
    const ROUNDING_HORIZ_M = (Math.pow(10, -7) / 2) * M_LAT * Math.SQRT2;
    const TOL_M = ROUNDING_HORIZ_M * Math.tan(25 * DEG) + 1e-5;
    for (let i = 0; i < panels.length; i++) {
      expect(Math.abs(r.panels[i].height! - panels[i].height!),
        `panel ${panels[i].id} came back ${r.panels[i].height!.toFixed(4)} m, was ${panels[i].height!.toFixed(4)} m`,
      ).toBeLessThan(TOL_M);
    }
  });

  it('🚨 a panel that names NO plane is refused, not invented', () => {
    const { face, panels } = filled();
    const stripped = panels.map((p, i) => {
      const { height, ...rest } = p as never as Record<string, unknown>;
      void height;
      return i === 2 ? { ...rest, planeId: undefined } : rest;
    });
    const r = repairPanelElevations(stripped as never, [face], MOUNT, GROUND_M);
    expect(r.unrepairable.length, 'the orphan panel must be reported, not given a height').toBe(1);
    expect(r.unrepairable[0]).toBe(String(panels[2].id));
  });

  it('🚨 a panel whose plane is MISSING from the snapshot is refused too', () => {
    const { panels } = filled();
    const stripped = panels.map(p => { const { height, ...rest } = p as never as Record<string, unknown>; void height; return rest; });
    const r = repairPanelElevations(stripped as never, [], MOUNT, GROUND_M);
    expect(r.unrepairable.length, 'no planes at all means nothing is repairable').toBe(panels.length);
    expect(r.repaired).toEqual([]);
  });

  it('a panel that already HAS an elevation is left exactly alone', () => {
    const { face, panels } = filled();
    const r = repairPanelElevations(panels as never, [face], MOUNT, GROUND_M);
    expect(r.repaired, 'nothing needed repair').toEqual([]);
    expect(r.unrepairable, 'and nothing was unrepairable').toEqual([]);
    for (let i = 0; i < panels.length; i++) {
      expect(r.panels[i].height).toBe(panels[i].height);
    }
  });
});
