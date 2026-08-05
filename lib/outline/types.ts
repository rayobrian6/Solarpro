// lib/outline/types.ts
// Type definitions for the design outline feature.
// The outline is a 2D representation of a roof + house footprint that gets
// lifted into a 3D scene in the design studio.

/**
 * A 2D point in world space (meters).
 * x = easting, y = northing (plan-view convention, +y is "up the page").
 */
export type Point2D = [number, number];

export interface OutlinePolygon {
  /** Ordered vertices. The polygon is closed implicitly (last -> first). */
  vertices: Point2D[];
  /** True once the user has finished drawing (double-click or Close button). */
  closed: boolean;
}

export interface OutlineDocument {
  roof: OutlinePolygon;
  house: OutlinePolygon;
  /** Roof slab thickness, meters. Default 0.3 (~1 ft). */
  roofHeightM: number;
  /** House wall height (ground to eave), meters. Default 2.5 (~8 ft). */
  houseHeightM: number;
  /** Distance the house footprint is offset out from the roof edge, meters.
   *  Default 0.6 (~2 ft) which is a typical eave overhang. */
  houseOffsetM: number;
}

export const DEFAULT_OUTLINE: OutlineDocument = {
  roof: { vertices: [], closed: false },
  house: { vertices: [], closed: false },
  roofHeightM: 0.3,
  houseHeightM: 2.5,
  houseOffsetM: 0.6,
};

/**
 * A closed polygon as an array of [x,y] tuples.
 * Returns null if the input has fewer than 3 vertices or isn't closed.
 */
export function polygonPoints(p: OutlinePolygon): Point2D[] | null {
  if (!p.closed || p.vertices.length < 3) return null;
  return p.vertices;
}

/**
 * Default rectangle polygon, centered on (cx, cy), with given width/height.
 * Used for the auto-generated house footprint when the user hasn't drawn one.
 */
export function defaultRectangle(
  cx: number,
  cy: number,
  widthM: number,
  heightM: number,
): Point2D[] {
  const hw = widthM / 2;
  const hh = heightM / 2;
  return [
    [cx - hw, cy - hh],
    [cx + hw, cy - hh],
    [cx + hw, cy + hh],
    [cx - hw, cy + hh],
  ];
}

/**
 * Axis-aligned bounding box of a polygon (or null if empty).
 */
export function polygonBounds(
  pts: Point2D[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (pts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Expand an axis-aligned polygon outward by `offset` meters on all sides.
 * Used to compute the default house footprint from the roof outline.
 */
export function expandPolygon(
  pts: Point2D[],
  offset: number,
): Point2D[] {
  const b = polygonBounds(pts);
  if (!b) return [];
  return [
    [b.minX - offset, b.minY - offset],
    [b.maxX + offset, b.minY - offset],
    [b.maxX + offset, b.maxY + offset],
    [b.minX - offset, b.maxY + offset],
  ];
}
