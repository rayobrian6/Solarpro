/**
 * A RESHAPED ROOF FACE MUST REPORT THE AREA IT NOW HAS.
 *
 * Square Up, Stitch, the flat-trace rebuild and the standalone face nudge all
 * reshape a face's geometry and emit it back to DesignStudio as a
 * `RoofPlaneReshapeUpdate`. That shape carries the new outline, the new plane
 * frame, the new pitch and the new azimuth — and no area. DesignStudio merges
 * it with a spread and re-enriches through `enrichRoofPlaneWithLECS`, which
 * recomputes the centroid, the local (feet) vertices and the longest-edge
 * bearing. Nothing recomputed `area` or `usableArea`, so a face that was halved
 * on screen kept reporting its pre-reshape area for ever.
 *
 * That number is not cosmetic:
 *   • lib/siteSurvey/enrichSurvey.ts picks the PRIMARY roof plane by `p.area`,
 *     so a stale value can nominate the wrong face;
 *   • the same file derives `totalAreaSqFt` / the usable-area estimate from it,
 *     which becomes `cad.roof.planes[].areaSqM` in lib/cad/buildCADFromSurvey.ts;
 *   • lib/3d/footprintToRoofPlane.ts reports it as `slopeAreaM2`.
 *
 * ONE AUTHORITY. The expected value here is never re-derived by hand: it is
 * whatever `buildRoofPlane3D` — the function that decides what a roof plane's
 * area is — returns for the same reshaped geometry. The closed-form checks
 * below exist only to prove that authority is itself measuring true SLOPE area
 * (width × slope length), not the plan-view footprint, so a regression that
 * silently swapped one for the other could not pass by agreeing with itself.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { enrichRoofPlaneWithLECS } from '@/lib/roofGeometry';
import type { RoofPlane } from '@/types';

// ─── A synthetic, exactly-known roof face ───────────────────────────────────
// Site is arbitrary. The face is a rectangle: `RUN_M` of horizontal run from
// eave to ridge, `WIDTH_M` along the eave, rising `RISE_M` over the run.
//   slope length = hypot(RUN_M, RISE_M)
//   true slope area = WIDTH_M × slope length
// Plan (footprint) area is WIDTH_M × RUN_M — deliberately different, so a
// plan-area formula cannot pass these assertions.
const SITE_LAT = 38.5;
const SITE_LNG = -82.6;
const EAVE_H_M = 5;
const RISE_M   = 3;
const RUN_M    = 6;
const WIDTH_M  = 10;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((SITE_LAT * Math.PI) / 180);

const dLat = (m: number) => m / M_PER_DEG_LAT;
const dLng = (m: number) => m / M_PER_DEG_LNG;

/** Four ECEF corners of a rectangular face `widthM` wide across the eave. */
function faceCorners(widthM: number) {
  const ridgeH = EAVE_H_M + RISE_M;
  return [
    latLngToECEF(SITE_LAT,                 SITE_LNG,                  EAVE_H_M),
    latLngToECEF(SITE_LAT,                 SITE_LNG + dLng(widthM),   EAVE_H_M),
    latLngToECEF(SITE_LAT + dLat(RUN_M),   SITE_LNG + dLng(widthM),   ridgeH),
    latLngToECEF(SITE_LAT + dLat(RUN_M),   SITE_LNG,                  ridgeH),
  ];
}

const SLOPE_LEN_M = Math.hypot(RUN_M, RISE_M);
const trueSlopeAreaM2 = (widthM: number) => widthM * SLOPE_LEN_M;

/**
 * Exactly the merge DesignStudio's `onRoofPlanesStitched` performs: spread the
 * stored plane, overwrite the fields the reshape emits, re-enrich. Mirrored
 * here (rather than imported) because the handler is an inline closure inside
 * the component; the source-text assertion at the bottom pins the mirror to the
 * real one.
 */
function applyReshape(stored: RoofPlane, reshaped: RoofPlane): RoofPlane {
  return enrichRoofPlaneWithLECS({
    ...stored,
    vertices:     reshaped.vertices,
    localFrame3D: reshaped.localFrame3D,
    ...(reshaped.polygon3D   ? { polygon3D:   reshaped.polygon3D   } : {}),
    ...(reshaped.origin3D    ? { origin3D:    reshaped.origin3D    } : {}),
    ...(reshaped.normal3D    ? { normal3D:    reshaped.normal3D    } : {}),
    ...(typeof reshaped.pitch   === 'number' ? { pitch:   reshaped.pitch   } : {}),
    ...(typeof reshaped.azimuth === 'number' ? { azimuth: reshaped.azimuth } : {}),
    ...(reshaped.ecefFrame3D ? { ecefFrame3D: reshaped.ecefFrame3D } : {}),
  });
}

describe('roof-plane area survives a reshape', () => {
  it('buildRoofPlane3D measures TRUE SLOPE area, not the plan footprint', () => {
    // The oracle for everything below. If this ever starts agreeing with the
    // plan area (WIDTH_M × RUN_M = 60 m²) the authority itself has regressed.
    const plane = buildRoofPlane3D(faceCorners(WIDTH_M));
    expect(plane.area).toBeCloseTo(trueSlopeAreaM2(WIDTH_M), 0); // ≈ 67.08 m²
    expect(plane.area).toBeGreaterThan(WIDTH_M * RUN_M + 5);     // ≫ 60 m² plan
  });

  it('reports the RESHAPED area after the face is halved', () => {
    const stored   = buildRoofPlane3D(faceCorners(WIDTH_M));
    const reshaped = buildRoofPlane3D(faceCorners(WIDTH_M / 2));

    // Sanity: the reshape really did halve the face.
    expect(reshaped.area).toBeCloseTo(trueSlopeAreaM2(WIDTH_M / 2), 0);
    expect(stored.area / reshaped.area).toBeCloseTo(2, 1);

    const merged = applyReshape(stored, reshaped);

    // THE DEFECT: `merged.area` was `stored.area` — the pre-reshape value.
    expect(merged.area).toBeCloseTo(reshaped.area, 3);
    expect(merged.area).toBeCloseTo(trueSlopeAreaM2(WIDTH_M / 2), 0);
    expect(merged.usableArea).toBeCloseTo(reshaped.usableArea, 3);
  });

  it('reports the RESHAPED area after the face is widened', () => {
    // The opposite direction, so a fix that merely shrinks cannot pass.
    const stored   = buildRoofPlane3D(faceCorners(WIDTH_M));
    const reshaped = buildRoofPlane3D(faceCorners(WIDTH_M * 1.5));

    const merged = applyReshape(stored, reshaped);

    expect(merged.area).toBeCloseTo(trueSlopeAreaM2(WIDTH_M * 1.5), 0);
    expect(merged.area).toBeGreaterThan(stored.area);
  });

  it('is a NO-OP on a face that was never reshaped', () => {
    // Re-enriching a plane straight out of buildRoofPlane3D must return the
    // identical number. Anything else would move every stored design on load.
    const plane = buildRoofPlane3D(faceCorners(WIDTH_M));
    const again = enrichRoofPlaneWithLECS(plane);
    expect(again.area).toBe(plane.area);
    expect(again.usableArea).toBe(plane.usableArea);
  });

  it('leaves a 2D-only plane (no 3D geometry) exactly as it was', () => {
    // Hand-drawn / Nearmap planes reach enrichRoofPlaneWithLECS before any 3D
    // frame is attached, and their area comes from another authority. Nothing
    // here may overwrite it.
    const flat: RoofPlane = {
      id: 'flat-1',
      vertices: [
        { lat: SITE_LAT,                 lng: SITE_LNG                 },
        { lat: SITE_LAT,                 lng: SITE_LNG + dLng(WIDTH_M) },
        { lat: SITE_LAT + dLat(RUN_M),   lng: SITE_LNG + dLng(WIDTH_M) },
        { lat: SITE_LAT + dLat(RUN_M),   lng: SITE_LNG                 },
      ],
      pitch: 26.57,
      azimuth: 180,
      area: 999,
      usableArea: 777,
    };
    const out = enrichRoofPlaneWithLECS(flat);
    expect(out.area).toBe(999);
    expect(out.usableArea).toBe(777);
  });

  it('the live reshape handler still merges through enrichRoofPlaneWithLECS', () => {
    // The mirror above is only faithful while DesignStudio's stitched-plane
    // handler re-enriches. If that call moves, this test is measuring nothing.
    const src = readFileSync(
      path.join(process.cwd(), 'components', 'design', 'DesignStudio.tsx'),
      'utf8',
    );
    const handlerAt = src.indexOf('onRoofPlanesStitched={(updates) =>');
    expect(handlerAt, 'onRoofPlanesStitched handler must exist').toBeGreaterThan(-1);
    const body = src.slice(handlerAt, handlerAt + 6000);
    expect(body).toContain('enrichRoofPlaneWithLECS({');
  });
});
