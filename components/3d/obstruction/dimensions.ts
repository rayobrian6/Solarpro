/**
 * components/3d/obstruction/dimensions.ts
 *
 * Pure math for the Aurora-parity "Add Obstruction" primitive — the
 * click-to-place block that drops a small rectangular prism (chimney,
 * vent, dormer) wherever the user clicks.
 *
 * ── Why this lives in its own file ─────────────────────────────────────────
 * All of the dimensional math is pure: defaults, clamps, footprint corner
 * math, and the point-in-rectangle test the panel-exclusion filter needs.
 * No React, no Cesium, no DOM. This lets `tests/obstruction.test.ts` lock
 * the behavior down with no fixtures and no canvas.
 *
 * The Cesium entity creation (PolygonGraphics + per-position height + label)
 * lives in `components/3d/SolarEngine3D.tsx` — this file is the math.
 *
 * ── Aurora parity ──────────────────────────────────────────────────────────
 * See components/3d/obstruction/DESIGN.md and
 * HANDOFF_2026-08-25_AURORA_ANALYSIS.md §1 / TIER 1 #7.
 *
 * Default footprint is 0.6m × 0.6m, default height is 1.0m — matches the
 * Aurora parity bar literal: "a small block (e.g. 0.6m × 0.6m × 1.0m,
 * configurable) at the click point."
 *
 * Coordinate convention:
 *   - Footprint corners are lat/lng in WGS84
 *   - 1° lat ≈ 111_320 m, 1° lng ≈ 111_320 * cos(lat) m
 *   - Heights are meters above the WGS84 ellipsoid (not above ground level)
 */

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLng(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/**
 * Default footprint width (east-west, meters). Matches the Aurora parity
 * bar literal ("0.6m × 0.6m × 1.0m"). Keep in lockstep with the
 * `newObstructionWidthM` useState default in SolarEngine3D.tsx and with the
 * "Default W × D × H" row in the right-panel info strip.
 */
export const DEFAULT_OBSTRUCTION_FOOTPRINT_W_M = 0.6;

/**
 * Default footprint depth (north-south, meters). See
 * `DEFAULT_OBSTRUCTION_FOOTPRINT_W_M` for the parity rationale.
 */
export const DEFAULT_OBSTRUCTION_FOOTPRINT_D_M = 0.6;

/**
 * Default prism height (meters above the click point). Matches the
 * Aurora parity bar literal.
 */
export const DEFAULT_OBSTRUCTION_HEIGHT_M = 1.0;

/**
 * Smallest sensible footprint dimension (width OR depth). Below 0.2m the
 * prism is a roof stain, not a feature; Cesium's PolygonGraphics also
 * degenerates on sub-decimeter edges.
 */
export const MIN_OBSTRUCTION_FOOTPRINT_M = 0.2;

/**
 * Largest sensible footprint dimension. Above 3m it's a shed, not an
 * obstruction — the user wants the v64 Block primitive, not Aurora's
 * "Add Obstruction".
 */
export const MAX_OBSTRUCTION_FOOTPRINT_M = 3.0;

/**
 * Smallest sensible prism height. Below 0.3m the prism is a roof stain.
 */
export const MIN_OBSTRUCTION_HEIGHT_M = 0.3;

/**
 * Largest sensible prism height. Above 5m it's a tower.
 */
export const MAX_OBSTRUCTION_HEIGHT_M = 5.0;

/**
 * Clamp a (widthM, depthM) footprint to the safe range. Pure, no I/O.
 *
 * @returns the same shape with both fields clamped to
 *          [MIN_OBSTRUCTION_FOOTPRINT_M, MAX_OBSTRUCTION_FOOTPRINT_M].
 */
export function clampObstructionFootprint(
  widthM: number,
  depthM: number,
): { widthM: number; depthM: number } {
  return {
    widthM: Math.max(
      MIN_OBSTRUCTION_FOOTPRINT_M,
      Math.min(MAX_OBSTRUCTION_FOOTPRINT_M, widthM),
    ),
    depthM: Math.max(
      MIN_OBSTRUCTION_FOOTPRINT_M,
      Math.min(MAX_OBSTRUCTION_FOOTPRINT_M, depthM),
    ),
  };
}

/**
 * Clamp a height to the safe range. Pure, no I/O.
 */
export function clampObstructionHeight(heightM: number): number {
  return Math.max(
    MIN_OBSTRUCTION_HEIGHT_M,
    Math.min(MAX_OBSTRUCTION_HEIGHT_M, heightM),
  );
}

export interface ObstructionFootprintPoint {
  lat: number;
  lng: number;
}

export interface ObstructionFootprint {
  /** South-west corner (min lat, min lng). */
  sw: ObstructionFootprintPoint;
  /** South-east corner (min lat, max lng). */
  se: ObstructionFootprintPoint;
  /** North-east corner (max lat, max lng). */
  ne: ObstructionFootprintPoint;
  /** North-west corner (max lat, min lng). */
  nw: ObstructionFootprintPoint;
}

/**
 * Build the 4 corner points of an obstruction rectangle centered on a
 * click point. The rectangle is **axis-aligned** (sides run east-west and
 * north-south, not rotated to the roof slope). Pure, deterministic, no I/O.
 *
 * The output is ordered SW → SE → NE → NW, the same order Cesium's
 * `PolygonHierarchy` expects (and the order the v64 Block primitive
 * uses internally).
 */
export function buildObstructionFootprint(
  centerLat: number,
  centerLng: number,
  widthM: number,
  depthM: number,
): ObstructionFootprint {
  // Guard: invalid inputs. We refuse to render a polygon on a non-finite
  // center; callers (e.g. SolarEngine3D) should already have validated
  // the click, but a defensive check here keeps the math safe.
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
    throw new RangeError(
      `buildObstructionFootprint: center must be finite (got ${centerLat}, ${centerLng})`,
    );
  }
  const { widthM: w, depthM: d } = clampObstructionFootprint(widthM, depthM);
  const halfW = w / 2;
  const halfD = d / 2;
  const dLat = halfD / METERS_PER_DEG_LAT;
  const dLng = halfW / metersPerDegLng(centerLat);
  return {
    sw: { lat: centerLat - dLat, lng: centerLng - dLng },
    se: { lat: centerLat - dLat, lng: centerLng + dLng },
    ne: { lat: centerLat + dLat, lng: centerLng + dLng },
    nw: { lat: centerLat + dLat, lng: centerLng - dLng },
  };
}

/**
 * Footprint area in m². Just `width * depth` — the rectangle is
 * axis-aligned so there's no rotation term. Pure.
 */
export function obstructionFootprintAreaM2(
  widthM: number,
  depthM: number,
): number {
  const { widthM: w, depthM: d } = clampObstructionFootprint(widthM, depthM);
  return w * d;
}

/**
 * Diagonal of the footprint in meters (`sqrt(w² + d²)`). Used by the
 * info-box readout. Pure.
 */
export function obstructionFootprintDiagonalM(
  widthM: number,
  depthM: number,
): number {
  const { widthM: w, depthM: d } = clampObstructionFootprint(widthM, depthM);
  return Math.sqrt(w * w + d * d);
}

/**
 * Test whether a (lat, lng) point falls inside the obstruction rectangle.
 *
 * The test uses the *axis-aligned* projection in meters relative to the
 * rectangle's center — not a great-circle distance — which matches the
 * way the rectangle is drawn (axis-aligned sides, not great-circle arcs).
 * For a 0.6m × 0.6m obstruction the curvature error is sub-millimeter,
 * so the simpler projection is correct.
 *
 * Returns `false` for non-finite inputs (so a bad click can't accidentally
 * clear every panel on the roof).
 */
export function pointInsideObstructionRectangle(
  pointLat: number,
  pointLng: number,
  centerLat: number,
  centerLng: number,
  widthM: number,
  depthM: number,
): boolean {
  if (
    !Number.isFinite(pointLat) || !Number.isFinite(pointLng) ||
    !Number.isFinite(centerLat) || !Number.isFinite(centerLng)
  ) {
    return false;
  }
  const { widthM: w, depthM: d } = clampObstructionFootprint(widthM, depthM);
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dxM = (pointLng - centerLng) * METERS_PER_DEG_LAT * cosLat;
  const dyM = (pointLat - centerLat) * METERS_PER_DEG_LAT;
  // A tiny slack (1mm) prevents floating-point edge cases from flicking
  // a panel right on the border in or out of the keep-out.
  return Math.abs(dxM) <= w / 2 + 0.001 && Math.abs(dyM) <= d / 2 + 0.001;
}
