/**
 * tests/panelSurfaceClearance.test.ts
 *
 * DO THE PANELS SIT ON THE ROOF?
 *
 * Ray's second production failure was "Auto Layout generated panels visually
 * intersect / disappear into the roof surface". The audit that followed found the
 * reason no test caught it: **nothing anywhere in the suite asserted a panel's
 * elevation relative to the roof it was placed on.** Every layout test counted
 * panels, or checked a lat/lng fell inside a polygon — both of which are satisfied
 * perfectly by an array buried a storey underground.
 *
 * So this file asserts one geometric invariant, and only that:
 *
 *   for every placed panel:  (panelECEF - plane.origin3D) · plane.normal  ==  PANEL_OFFSET_ECEF
 *
 * That is a SIGNED distance along the plane normal. It is negative when a panel is
 * inside or below the roof, which is exactly the defect, and it cannot be satisfied
 * by a panel that is merely in the right place horizontally.
 *
 * 🚨 THESE TESTS MUST BE ABLE TO FAIL. Two of them reproduce real defects found on
 * `origin/master` — Set Origin re-basing the grid to ground level, and Set Direction
 * installing a non-planar grid axis — and the last one deliberately mutates a good
 * panel to prove the assertion is load-bearing rather than vacuous.
 */

import { describe, it, expect } from 'vitest';
import { buildRoofPlane3D, latLngToECEF } from '@/lib/roofPlane3D';
import { buildSurfaceGrid, PANEL_OFFSET_ECEF } from '@/lib/surfaceGeometry3D';
import type { PlacedPanel, RoofPlane } from '@/types';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

// 3 Melvin Drive — the property from the live project_versions trace that produced
// three site identities in 43 seconds. Using the real coordinates keeps the
// latitude-dependent ECEF arithmetic honest.
const LAT = 38.70615;
const LNG = -90.04625;
const mPerDegLng = M_PER_DEG_LAT * Math.cos(LAT * DEG);

const GROUND_M = 150;      // ellipsoidal ground height at the site
const EAVE_H   = GROUND_M + 5;
const TILT_DEG = 30;       // a real pitch — a flat plane would hide an off-plane axis
const WIDTH_M  = 12;       // along the eave
const DEPTH_M  = 8;        // up the slope

/**
 * A rectangular roof face, eave to the south, ridge to the north, pitched at
 * TILT_DEG. These are the ECEF points `finalizePlane3D` accumulates from picks.
 */
function traceTiltedFace(): { x: number; y: number; z: number }[] {
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(TILT_DEG * DEG);
  return [
    latLngToECEF(LAT - dLat, LNG - dLng, EAVE_H),   // SW, eave
    latLngToECEF(LAT - dLat, LNG + dLng, EAVE_H),   // SE, eave
    latLngToECEF(LAT + dLat, LNG + dLng, ridgeH),   // NE, ridge
    latLngToECEF(LAT + dLat, LNG - dLng, ridgeH),   // NW, ridge
  ];
}

/**
 * Signed distance from a panel to the plane it belongs to, along the plane normal.
 * Positive = above the roof surface. Negative = inside or below it.
 */
function clearanceM(panel: PlacedPanel, plane: RoofPlane): number {
  const n = plane.ecefFrame3D!.n;
  const o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

/**
 * How close to PANEL_OFFSET_ECEF the reconstructed clearance can possibly get.
 *
 * 🚨 THIS NUMBER IS MEASURED, NOT CHOSEN — do not tighten it, and do not loosen it.
 *
 * `buildSurfaceGridECEF` places each panel exactly on the plane in ECEF and then
 * stores it as lat/lng/height, with lat and lng ROUNDED TO 7 DECIMAL PLACES
 * (lib/surfaceGeometry3D.ts) while height keeps full precision. At this latitude
 * 1e-7° is 1.11 cm of latitude and 0.87 cm of longitude, so reconstructing the ECEF
 * point from what was stored moves it up to ~0.7 cm horizontally. On a pitched roof
 * that horizontal error tips into the plane normal as sin(tilt)·error — about 3.5 mm
 * on this 30° face, and the observed spread is 47.3–51.8 mm against a 50 mm target.
 *
 * So the floor is the STORED REPRESENTATION, not the geometry. 1 cm sits just above
 * it. It is still two to three ORDERS OF MAGNITUDE below the defects these tests
 * exist to catch — Set Origin missed the plane by ~5 m, Set Direction by up to ~2 m
 * — so nothing is being hidden by the slack.
 */
const COPLANARITY_TOL_M = 1e-2;

/** The invariant, as one call. Returns the worst offender so failures name a number. */
function worstClearance(panels: PlacedPanel[], plane: RoofPlane) {
  let worst = { deviationM: 0, clearanceM: PANEL_OFFSET_ECEF, id: '' };
  for (const p of panels) {
    const c = clearanceM(p, plane);
    const dev = Math.abs(c - PANEL_OFFSET_ECEF);
    if (dev > worst.deviationM) worst = { deviationM: dev, clearanceM: c, id: p.id };
  }
  return worst;
}

function fill(plane: RoofPlane, extra: Record<string, unknown> = {}): PlacedPanel[] {
  return buildSurfaceGrid({
    plane,
    groundElevM: GROUND_M,
    orientation: 'portrait',
    eaveSetbackM: 0.3, ridgeSetbackM: 0.3, sideSetbackM: 0.3,
    panelSpacingM: 0, rowSpacingM: 0,
    layoutId: 'test-layout',
    wattage: 400,
    ...extra,
  });
}

describe('panel surface clearance — panels sit ON the roof, never in it', () => {
  const plane = buildRoofPlane3D(traceTiltedFace());

  it('the fixture is a real tilted face with a usable grid', () => {
    // Guard the guard: if the fixture stopped producing panels, every assertion
    // below would pass vacuously over an empty array.
    expect(plane.createdFrom3D).toBe(true);
    expect(plane.origin3D).toBeTruthy();
    expect(plane.ecefFrame3D).toBeTruthy();
    expect(plane.pitch).toBeGreaterThan(25);
    expect(plane.pitch).toBeLessThan(35);
    expect(fill(plane).length).toBeGreaterThanOrEqual(4);
  });

  it('POSITIVE — a default fill puts every panel exactly PANEL_OFFSET_ECEF above the plane', () => {
    const panels = fill(plane);
    const worst = worstClearance(panels, plane);
    expect(worst.deviationM).toBeLessThan(COPLANARITY_TOL_M);
  });

  it('POSITIVE — no panel ever has negative clearance (none penetrates the roof)', () => {
    for (const p of fill(plane)) {
      expect(clearanceM(p, plane)).toBeGreaterThan(0);
    }
  });

  it('every panel carries a finite elevation — a heightless panel renders on the ellipsoid', () => {
    // `addPanelEntity` does `panel.height ?? 0` and `isValidCoord` accepts 0, so a
    // missing height is not a crash — it is an array placed at sea level. That is
    // why this is asserted explicitly rather than trusted.
    for (const p of fill(plane)) {
      expect(Number.isFinite(p.height)).toBe(true);
      expect(p.height!).toBeGreaterThan(GROUND_M);
    }
  });

  // ── REGRESSION: Set Origin re-based the whole grid to ground level ───────────
  //
  // `buildRoofPlane3D` stores `planeHeightAtCenterMeters: 0.0` on every plane it
  // mints. The Set Origin override read `plane.planeHeightAtCenterMeters ?? LEGACY_
  // PLANE_HEIGHT_M` — and 0.0 is not nullish, so the fallback could never fire and
  // the height collapsed to groundElevM. On origin/master this test fails by ~5 m.
  it('NEGATIVE — Set Origin keeps the grid ON the plane, not at ground elevation', () => {
    const panels = fill(plane, { customOriginLat: LAT - 0.00002, customOriginLng: LNG - 0.00004 });
    expect(panels.length).toBeGreaterThan(0);
    const worst = worstClearance(panels, plane);
    expect(worst.deviationM).toBeLessThan(COPLANARITY_TOL_M);
    for (const p of panels) expect(clearanceM(p, plane)).toBeGreaterThan(0);
  });

  it('NEGATIVE — Set Origin does not drop the array toward the ground plane', () => {
    const panels = fill(plane, { customOriginLat: LAT, customOriginLng: LNG });
    // The sharpest form of the old defect: every panel ends up near GROUND_M
    // instead of on the roof ~5 m above it.
    for (const p of panels) {
      expect(p.height! - GROUND_M).toBeGreaterThan(3);
    }
  });

  // ── REGRESSION: Set Direction installed a non-planar grid axis ───────────────
  //
  // The picked direction is a HORIZONTAL ENU vector. A horizontal vector does not
  // lie in a tilted plane, and it was installed verbatim as the grid u-axis, so
  // every panel was driven off the plane by uCenter·sin(tilt)·sin(theta) ALONG THE
  // ROW — a wedge that deepens with distance from the origin. An oblique direction
  // on a 30° face is the worst case; 45° maximises sin(theta) against a long row.
  it('NEGATIVE — Set Direction at an oblique angle keeps every panel coplanar', () => {
    const panels = fill(plane, { customDirX: Math.SQRT1_2, customDirY: Math.SQRT1_2 });
    expect(panels.length).toBeGreaterThan(0);
    const worst = worstClearance(panels, plane);
    expect(worst.deviationM).toBeLessThan(COPLANARITY_TOL_M);
    for (const p of panels) expect(clearanceM(p, plane)).toBeGreaterThan(0);
  });

  it('NEGATIVE — Set Direction along the eave is also coplanar (the easy case still holds)', () => {
    const panels = fill(plane, { customDirX: 1, customDirY: 0 });
    expect(worstClearance(panels, plane).deviationM).toBeLessThan(COPLANARITY_TOL_M);
  });

  it('a direction parallel to the plane normal has no in-plane part and is ignored, not honoured', () => {
    // Degenerate input must leave the plane's own frame in place rather than
    // installing a zero-length or NaN axis.
    const baseline = fill(plane);
    const panels = fill(plane, { customDirX: 0, customDirY: 0 });
    expect(panels.length).toBe(baseline.length);
    expect(worstClearance(panels, plane).deviationM).toBeLessThan(COPLANARITY_TOL_M);
  });

  // ── MUTATION: prove the assertion is load-bearing ────────────────────────────
  it('ADVERSARIAL — a panel pushed below the surface IS detected', () => {
    const panels = fill(plane);
    expect(panels.length).toBeGreaterThan(0);

    const n = plane.ecefFrame3D!.n;
    const victim = panels[Math.floor(panels.length / 2)];
    const p = latLngToECEF(victim.lat, victim.lng, victim.height!);
    // Push it 0.10 m along -n: still inside the roof polygon horizontally, still a
    // perfectly valid lat/lng, still counted by every count-based test — and now
    // 0.05 m INSIDE the roof. This is precisely what Ray saw.
    const sunk = { x: p.x - n.x * 0.10, y: p.y - n.y * 0.10, z: p.z - n.z * 0.10 };
    const o = plane.origin3D!;
    const sunkClearance = (sunk.x - o.x) * n.x + (sunk.y - o.y) * n.y + (sunk.z - o.z) * n.z;

    expect(sunkClearance).toBeLessThan(0);
    expect(Math.abs(sunkClearance - PANEL_OFFSET_ECEF)).toBeGreaterThan(COPLANARITY_TOL_M);
  });

  it('ADVERSARIAL — the invariant rejects an array placed at ground level', () => {
    // The exact shape of the Set Origin defect, constructed directly so the
    // assertion is proven to catch it independently of the code path that caused it.
    const panels = fill(plane).map(p => ({ ...p, height: GROUND_M }));
    const worst = worstClearance(panels, plane);
    expect(worst.deviationM).toBeGreaterThan(1);
    expect(clearanceM(panels[0], plane)).toBeLessThan(0);
  });
});
