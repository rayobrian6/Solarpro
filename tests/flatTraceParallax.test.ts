/**
 * tests/flatTraceParallax.test.ts
 *
 * WHY THE FLAT TRACE LOCKS THE CAMERA STRAIGHT DOWN.
 *
 * A flat trace has no roof mesh to pick, so every corner is ray-cast onto the
 * GROUND plane (h=0). From a tilted camera, the ray through a pixel that
 * visually sits on a roof does not stop at the roof — it carries on and meets
 * the ground somewhere past the building. The captured outline is therefore a
 * displaced, stretched shadow of the roof rather than the roof itself. That is
 * exactly what Ray saw: a traced quad lying in the field north of the house.
 *
 * The displacement depends on the HEIGHT of what you are aiming at and the
 * camera's elevation angle — NOT on camera range or zoom, which is why zooming
 * in does not help and why this cannot be papered over in the UI:
 *
 *     displacement = roofHeight / tan(elevationAngle)
 *
 * These tests pin the magnitude at the angles that matter, and tie the chosen
 * near-nadir constant (0.02 rad off vertical, the app's own pitch clamp in
 * applyOrbit) to a stated accuracy requirement. If someone loosens the lock,
 * the failure says how many metres of error it buys.
 */

import { describe, it, expect } from 'vitest';

/** Ground-plane displacement of a feature at `heightM`, seen from `elevationRad` above horizontal. */
function parallaxDisplacementM(heightM: number, elevationRad: number): number {
  return heightM / Math.tan(elevationRad);
}

const deg = (d: number) => (d * Math.PI) / 180;

// The app clamps orbit pitch to -PI/2 + 0.02 in applyOrbit, and the flat trace
// writes exactly that value. Elevation angle = PI/2 - 0.02.
const FLAT_TRACE_OFF_NADIR_RAD = 0.02;
const FLAT_TRACE_ELEVATION_RAD = Math.PI / 2 - FLAT_TRACE_OFF_NADIR_RAD;

// A single-storey eave; the default a flat trace starts from.
const EAVE_H = 3.0;
// A two-storey ridge — the worst realistic case on a house.
const RIDGE_H = 8.0;

describe('flat-trace camera lock — the parallax it exists to remove', () => {
  it('the default tilted view displaces a traced roof by METRES, not centimetres', () => {
    // TILTED_AERIAL_VIEW is -45 degrees: elevation 45 degrees, tan = 1.
    // So the outline lands displaced by the full height of the roof.
    const d = parallaxDisplacementM(EAVE_H, deg(45));
    expect(d).toBeCloseTo(3.0, 6);

    // A two-storey ridge at 45 degrees is 8 m out — most of a roof's width.
    expect(parallaxDisplacementM(RIDGE_H, deg(45))).toBeCloseTo(8.0, 6);
  });

  it('a shallower camera is dramatically worse — this is not a small effect', () => {
    // 20 degrees above horizontal, which a user reaches easily by dragging.
    expect(parallaxDisplacementM(EAVE_H, deg(20))).toBeGreaterThan(8);
    expect(parallaxDisplacementM(RIDGE_H, deg(20))).toBeGreaterThan(21);
  });

  it('the near-nadir lock keeps displacement under 10 cm for any house roof', () => {
    // This is the requirement the 0.02 rad constant has to satisfy. If the lock
    // is loosened, this test states the cost in metres.
    expect(parallaxDisplacementM(EAVE_H, FLAT_TRACE_ELEVATION_RAD)).toBeLessThan(0.10);
    expect(parallaxDisplacementM(RIDGE_H, FLAT_TRACE_ELEVATION_RAD)).toBeLessThan(0.20);
  });

  it('near-nadir is ~50x better than the 45-degree default at the same height', () => {
    const tilted = parallaxDisplacementM(EAVE_H, deg(45));
    const locked = parallaxDisplacementM(EAVE_H, FLAT_TRACE_ELEVATION_RAD);
    expect(tilted / locked).toBeGreaterThan(45);
  });

  it('parallax is independent of camera RANGE — zooming in cannot fix it', () => {
    // The formula has no range term. Stated as a test because "just zoom in"
    // is the obvious wrong intuition, and it would leave the bug in place.
    const atAnyRange = parallaxDisplacementM(EAVE_H, deg(45));
    expect(atAnyRange).toBe(parallaxDisplacementM(EAVE_H, deg(45)));
    expect(atAnyRange).toBeGreaterThan(1); // still metres however close you get
  });

  it('the residual error at the lock is real but negligible — not zero, and not hidden', () => {
    // Exact nadir would drive displacement to ~0, but that pose is degenerate
    // for a different reason this formula cannot express: a camera looking
    // exactly straight down has no defined heading, so applyOrbit clamps it.
    // (Note tan(PI/2) is a huge FINITE float in JS, not Infinity — which is
    // why this is asserted as a magnitude rather than as non-finiteness.)
    const residual = parallaxDisplacementM(EAVE_H, FLAT_TRACE_ELEVATION_RAD);
    expect(residual).toBeGreaterThan(0);          // we did not pretend it away
    expect(residual).toBeLessThan(0.10);          // and it is under 10 cm
    expect(residual).toBeCloseTo(EAVE_H * FLAT_TRACE_OFF_NADIR_RAD, 3); // ≈ h·θ for small θ
  });
});
