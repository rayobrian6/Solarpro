/**
 * components/3d/tree/canopy.ts
 *
 * Pure-math + constants for the 2D tree placement cursor preview.
 *
 * The tree placement cursor shows a circle sized to the tree's actual canopy
 * radius — it is the user's "footprint preview" before they click. The canopy
 * radius is a number, not a React/JSX concept, and the math used to turn it
 * into a Cesium EllipseGraphics (semimajor/minor axes) and into Aurora-style
 * readouts (feet, diameter, area) is also pure.
 *
 * Keeping these out of the React component lets us unit-test the math in
 * `tests/treeCursor.test.ts` without spinning up a Cesium viewer, a DOM, or
 * jsdom. The single source of truth for the default canopy radius lives
 * here, and is consumed by TreeCursor.tsx (sizes the preview ellipse) and
 * by SolarEngine3D.tsx handleTreeClick (keeps the click-side primitive in
 * lockstep with the cursor footprint).
 *
 * Aurora parity (frame 0115): Aurora's cursor is a translucent light-blue
 * circle whose diameter matches the canopy of the tree the user is about
 * to place. We match the principle ("cursor diameter = canopy diameter"),
 * not the absolute size — Aurora's video tree happens to be larger than
 * Solarpro's 1.8m primitive, but the user must see OUR tree's footprint.
 */

const FT_PER_M = 3.28084;

/** Default canopy radius for the v64 tree primitive in SolarEngine3D.tsx.
 *  Lock-step with `foliageRadiusM` in handleTreeClick (currently 1.8). */
export const DEFAULT_TREE_CANOPY_RADIUS_M = 1.8;

/** Smallest valid canopy radius. Below this the cursor is sub-pixel and the
 *  Cesium ellipse degenerates (semiMajorAxis ≤ 0 throws in Cesium 1.138).
 *  0.05 m = 5 cm — a one-pixel ring on a 4K monitor at any reasonable zoom. */
export const MIN_TREE_CANOPY_RADIUS_M = 0.05;

/** Largest valid canopy radius. 30 m = ~98 ft — bigger than a mature oak.
 *  Above this the cursor stops being a "placement preview" and becomes a
 *  "shade zone overlay", which is a different feature. */
export const MAX_TREE_CANOPY_RADIUS_M = 30.0;

export type CanopyEllipseAxes = {
  /** Cesium EllipseGraphics.semiMajorAxis — meters. */
  semiMajorAxis: number;
  /** Cesium EllipseGraphics.semiMinorAxis — meters. */
  semiMinorAxis: number;
};

function assertValidRadiusM(radiusM: number): void {
  if (typeof radiusM !== 'number' || !Number.isFinite(radiusM)) {
    throw new RangeError(
      `Tree canopy radius must be a finite number (got ${String(radiusM)})`
    );
  }
  if (radiusM < MIN_TREE_CANOPY_RADIUS_M || radiusM > MAX_TREE_CANOPY_RADIUS_M) {
    throw new RangeError(
      `Tree canopy radius must be in [${MIN_TREE_CANOPY_RADIUS_M}, ${MAX_TREE_CANOPY_RADIUS_M}] m (got ${radiusM})`
    );
  }
}

/** Tree canopy diameter in meters (= 2 × radius). The Aurora cursor is sized
 *  to the diameter; matching that here keeps "you see what you place" intact. */
export function canopyDiameterM(radiusM: number = DEFAULT_TREE_CANOPY_RADIUS_M): number {
  assertValidRadiusM(radiusM);
  return radiusM * 2;
}

/** Tree canopy radius expressed in feet. Aurora's UI is imperial-first. */
export function canopyRadiusInFeet(radiusM: number = DEFAULT_TREE_CANOPY_RADIUS_M): number {
  assertValidRadiusM(radiusM);
  return radiusM * FT_PER_M;
}

/** Tree canopy footprint area in m² (πr²). Used by the future obstruction /
 *  shade-zone engine to test "does this cursor overlap a no-place polygon?". */
export function canopyFootprintAreaM2(radiusM: number = DEFAULT_TREE_CANOPY_RADIUS_M): number {
  assertValidRadiusM(radiusM);
  return Math.PI * radiusM * radiusM;
}

/** Convert a canopy radius into the two scalars Cesium's EllipseGraphics
 *  needs. A circular footprint is just equal semi-axes. Returns an object so
 *  future variants (elliptical canopies) can pass a non-circular shape
 *  without changing the TreeCursor component's prop contract. */
export function canopyRadiusToEllipseAxes(
  radiusM: number = DEFAULT_TREE_CANOPY_RADIUS_M
): CanopyEllipseAxes {
  assertValidRadiusM(radiusM);
  return { semiMajorAxis: radiusM, semiMinorAxis: radiusM };
}
