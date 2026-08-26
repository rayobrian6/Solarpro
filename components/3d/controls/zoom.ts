/**
 * components/3d/controls/zoom.ts
 *
 * Pure zoom math for the Canvas Control Strip's Zoom + / − buttons.
 *
 * The existing wheel-zoom in SolarEngine3D.tsx:1751, 1867 uses
 * `ZOOM_FACTOR = 0.15` (15% of current orbit radius per notch). The
 * strip's buttons reuse the same factor so wheel + buttons feel
 * identical. The result is clamped to the same range the orbit
 * controller already enforces (`[1.5, 50000]` meters, line 1671 of
 * SolarEngine3D.tsx).
 *
 * No React, no DOM, no Cesium import — 100% testable in Vitest.
 *
 * Design doc: components/3d/controls/DESIGN.md §4.
 */

/** ±15% of current radius per click. Matches the wheel-zoom in SolarEngine3D. */
export const ZOOM_STEP_FACTOR = 0.15;

/** Minimum orbit radius (meters). Matches the orbit clamp in SolarEngine3D.tsx:1671. */
export const MIN_RADIUS_M = 1.5;

/** Maximum orbit radius (meters). Matches the orbit clamp in SolarEngine3D.tsx:1671. */
export const MAX_RADIUS_M = 50_000;

/** Zoom direction. +1 = step OUT (increase radius), −1 = step IN (decrease). */
export type ZoomDirection = 1 | -1;

/**
 * Compute the next orbit radius after one zoom step.
 *
 *   next = current * (1 + direction * factor)
 *
 * Result is clamped to `[min, max]`. Garbage input (`NaN`, `Infinity`,
 * negative, zero) collapses to `min` so the camera never lands in a
 * broken state.
 *
 * @param currentRadius  Current orbit radius in meters. Must be > 0.
 * @param direction      +1 to zoom out, −1 to zoom in.
 * @param factor         Step size as a fraction of current. Default 0.15.
 * @param min            Lower clamp. Default `MIN_RADIUS_M = 1.5`.
 * @param max            Upper clamp. Default `MAX_RADIUS_M = 50_000`.
 */
export function computeZoomedRadius(
  currentRadius: number,
  direction: ZoomDirection,
  factor: number = ZOOM_STEP_FACTOR,
  min: number = MIN_RADIUS_M,
  max: number = MAX_RADIUS_M,
): number {
  if (!isFinite(currentRadius) || currentRadius <= 0) return min;
  if (!isFinite(factor) || factor < 0) factor = ZOOM_STEP_FACTOR;
  const raw = currentRadius * (1 + direction * factor);
  if (!isFinite(raw)) return min;
  if (raw < min) return min;
  if (raw > max) return max;
  return raw;
}
