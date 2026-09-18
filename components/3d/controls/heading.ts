/**
 * components/3d/controls/heading.ts
 *
 * Pure heading math for the Canvas Control Strip's compass widget.
 *
 * Cesium's `viewer.camera.heading` is the compass bearing of the camera
 * **look direction**, in radians, 0 = looking north, increasing clockwise.
 * The compass widget draws its needle with the N tip at the top in local
 * coordinates; the needle group must rotate by `−headingDeg` in screen
 * space so the N tip ends up pointing to true north on the map.
 *
 * Coordinate convention (matches the existing bottom-right compass in
 * SolarEngine3D.tsx:10562: `transform: rotate(${-cameraHeadingDeg}deg)`).
 *
 * No React, no DOM, no Cesium import — 100% testable in Vitest.
 *
 * Design doc: components/3d/controls/DESIGN.md §3.
 */

/**
 * Convert a Cesium camera heading (radians) into a CSS rotation angle
 * (degrees) for the compass needle.
 *
 * Result is always in `[0, 360)` so the CSS `transform: rotate(...)`
 * is stable (no `-0deg` vs `0deg` quirks, no negative values).
 *
 * - `heading = 0` (looking north)  → `0deg` (N at top, no rotation).
 * - `heading = π/2` (looking east) → `270deg` (N rotates 270° CW to land at left).
 * - `heading = π` (looking south)  → `180deg` (N at bottom).
 * - `heading = -π/4` (looking NW)  → `45deg` (N rotates 45° CW to land NE).
 */
export function headingToCompassRotationDeg(headingRad: number): number {
  if (!isFinite(headingRad)) return 0;
  const deg = (headingRad * 180) / Math.PI;
  const wrapped = ((-deg % 360) + 360) % 360;
  return wrapped;
}

/**
 * Eight-wind compass label for a heading in degrees.
 *
 * - `0°`   → `'N'`
 * - `45°`  → `'NE'`
 * - `90°`  → `'E'`
 * - `135°` → `'SE'`
 * - `180°` → `'S'`
 * - `225°` → `'SW'`
 * - `270°` → `'W'`
 * - `315°` → `'NW'`
 *
 * The `22.5°` half-bin width matches the existing bottom-right compass
 * readout in SolarEngine3D.tsx:10588–10595.
 */
export type Cardinal =
  | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export function headingToCardinal(headingDeg: number): Cardinal {
  if (!isFinite(headingDeg)) return 'N';
  const h = ((headingDeg % 360) + 360) % 360;
  if (h < 22.5 || h >= 337.5) return 'N';
  if (h < 67.5)  return 'NE';
  if (h < 112.5) return 'E';
  if (h < 157.5) return 'SE';
  if (h < 202.5) return 'S';
  if (h < 247.5) return 'SW';
  if (h < 292.5) return 'W';
  return 'NW';
}

/**
 * Normalize a heading (radians) to `[0, 2π)`. Defensive helper for callers
 * that want to feed a raw `viewer.camera.heading` into downstream math
 * (e.g. the cardinal label, which works in degrees anyway).
 */
export function normalizeHeadingRad(headingRad: number): number {
  if (!isFinite(headingRad)) return 0;
  const TWO_PI = 2 * Math.PI;
  return ((headingRad % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Normalize a heading (degrees) to `[0, 360)`. Defensive helper.
 */
export function normalizeHeadingDeg(headingDeg: number): number {
  if (!isFinite(headingDeg)) return 0;
  return ((headingDeg % 360) + 360) % 360;
}
