/**
 * Mask cleanup pipeline — transforms raw segmentation masks into clean
 * polygon outlines suitable for downstream geometry extraction.
 *
 * Cleanup stages:
 * 1. Hole filling — closes small interior gaps in masks
 * 2. Tiny region removal — removes regions smaller than a threshold
 * 3. Island removal — removes disconnected fragments
 * 4. Contour smoothing — simplifies jagged polygon boundaries
 *
 * All operations work on NormalizedPoint[] polygons in the
 * normalized_image_0_1000 coordinate system.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { NormalizedPoint, SemanticSegmentationMask } from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for the mask cleanup pipeline. */
export interface MaskCleanupConfig {
  /** Minimum area (in normalized² units) for a region to be kept. Default: 500 */
  minRegionArea?: number;
  /** Smoothing factor for Douglas-Peucker simplification (0-1000 coords). Default: 15 */
  smoothingEpsilon?: number;
  /** Whether to fill holes. Default: true */
  fillHoles?: boolean;
  /** Whether to remove islands. Default: true */
  removeIslands?: boolean;
  /** Maximum number of polygon points after simplification. Default: 50 */
  maxPolygonPoints?: number;
}

const DEFAULT_CONFIG: Required<MaskCleanupConfig> = {
  minRegionArea: 500,
  smoothingEpsilon: 15,
  fillHoles: true,
  removeIslands: true,
  maxPolygonPoints: 50,
};

// ---------------------------------------------------------------------------
// Geometric utilities
// ---------------------------------------------------------------------------

/**
 * Compute the signed area of a polygon using the shoelace formula.
 * Positive = counter-clockwise, negative = clockwise.
 */
function polygonSignedArea(polygon: NormalizedPoint[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return area / 2;
}

/**
 * Compute the absolute area of a polygon.
 */
export function polygonArea(polygon: NormalizedPoint[]): number {
  return Math.abs(polygonSignedArea(polygon));
}

/**
 * Compute the perimeter of a polygon.
 */
export function polygonPerimeter(polygon: NormalizedPoint[]): number {
  let perimeter = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = polygon[j].x - polygon[i].x;
    const dy = polygon[j].y - polygon[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  return perimeter;
}

/**
 * Compute the centroid of a polygon.
 */
function polygonCentroid(polygon: NormalizedPoint[]): { x: number; y: number } {
  let cx = 0;
  let cy = 0;
  let signedArea = 0;

  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = polygon[i].x * polygon[j].y - polygon[j].x * polygon[i].y;
    signedArea += cross;
    cx += (polygon[i].x + polygon[j].x) * cross;
    cy += (polygon[i].y + polygon[j].y) * cross;
  }

  signedArea /= 2;
  if (Math.abs(signedArea) < 1e-10) {
    // Degenerate polygon — return average of points
    const avgX = polygon.reduce((s, p) => s + p.x, 0) / n;
    const avgY = polygon.reduce((s, p) => s + p.y, 0) / n;
    return { x: avgX, y: avgY };
  }

  cx /= (6 * signedArea);
  cy /= (6 * signedArea);
  return { x: cx, y: cy };
}

/**
 * Check if a polygon is convex.
 */
function isConvex(polygon: NormalizedPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const k = (i + 2) % n;
    const cross = (polygon[j].x - polygon[i].x) * (polygon[k].y - polygon[j].y)
      - (polygon[j].y - polygon[i].y) * (polygon[k].x - polygon[j].x);

    if (cross !== 0) {
      if (sign === 0) {
        sign = cross > 0 ? 1 : -1;
      } else if ((cross > 0 ? 1 : -1) !== sign) {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Cleanup stages
// ---------------------------------------------------------------------------

/**
 * Stage 1: Hole filling.
 *
 * For polygon-based masks, "holes" manifest as interior concavities that
 * represent small gaps. This stage detects and fills small concavities
 * by checking if the polygon can be simplified to a convex hull with
 * minimal area change.
 *
 * For the current heuristic implementation, this removes interior
 * concavities that are smaller than the configured threshold.
 */
function fillHoles(polygon: NormalizedPoint[], config: Required<MaskCleanupConfig>): NormalizedPoint[] {
  // If the polygon is already convex, no holes to fill
  if (isConvex(polygon)) return polygon;

  // For concave polygons, check if convex hull would be a reasonable approximation
  // (i.e., the convex hull area is within 30% of the original area)
  const originalArea = polygonArea(polygon);
  const hull = convexHull(polygon);
  const hullArea = polygonArea(hull);

  if (hullArea <= originalArea * 1.3) {
    return hull;
  }

  // Otherwise, try removing small concavities by simplifying
  return douglasPeucker(polygon, config.smoothingEpsilon / 3);
}

/**
 * Stage 2: Tiny region removal.
 *
 * Removes polygons whose area is below the minimum threshold.
 * Returns null if the region should be removed.
 */
function removeTinyRegions(
  polygon: NormalizedPoint[],
  minRegionArea: number,
): NormalizedPoint[] | null {
  const area = polygonArea(polygon);
  if (area < minRegionArea) {
    return null;
  }
  return polygon;
}

/**
 * Stage 3: Island removal.
 *
 * In the polygon-based approach, "islands" are small polygons that are
 * far from the centroid of the main mask. This stage checks if the
 * polygon centroid is reasonable (within the normalized image bounds)
 * and the polygon is not an outlier fragment.
 *
 * For a single polygon, this primarily checks that the polygon covers
 * a meaningful region of the image.
 */
function removeIslands(polygon: NormalizedPoint[]): NormalizedPoint[] | null {
  const centroid = polygonCentroid(polygon);

  // Check that centroid is within reasonable bounds
  // (not too close to edges, which suggests a fragment)
  if (centroid.x < 5 || centroid.x > 995 || centroid.y < 5 || centroid.y > 995) {
    // Edge fragment — check if it's large enough to be meaningful
    const area = polygonArea(polygon);
    if (area < 2000) {
      return null;
    }
  }

  return polygon;
}

/**
 * Stage 4: Contour smoothing using Douglas-Peucker algorithm.
 *
 * Simplifies the polygon by removing points that are within epsilon
 * of the line connecting their neighbors.
 */
function smoothContour(
  polygon: NormalizedPoint[],
  config: Required<MaskCleanupConfig>,
): NormalizedPoint[] {
  let smoothed = douglasPeucker(polygon, config.smoothingEpsilon);

  // Ensure minimum 3 points for a valid polygon
  if (smoothed.length < 3) {
    smoothed = polygon.slice(0, 3);
  }

  // Truncate to max polygon points
  if (smoothed.length > config.maxPolygonPoints) {
    smoothed = smoothed.slice(0, config.maxPolygonPoints);
  }

  return smoothed;
}

// ---------------------------------------------------------------------------
// Douglas-Peucker simplification
// ---------------------------------------------------------------------------

/**
 * Simplify a polygon using the Douglas-Peucker algorithm.
 * Removes points that are within epsilon distance of the line
 * connecting their neighbors.
 */
export function douglasPeucker(points: NormalizedPoint[], epsilon: number): NormalizedPoint[] {
  if (points.length <= 3) return [...points];

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);

    // Combine (remove duplicate point at junction)
    return [...left.slice(0, -1), ...right];
  }

  // All intermediate points are within epsilon — simplify to just endpoints
  return [first, last];
}

/**
 * Compute perpendicular distance from point p to line segment (a, b).
 */
function perpendicularDistance(p: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // a and b are the same point
    const ddx = p.x - a.x;
    const ddy = p.y - a.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }

  // Project p onto line ab, clamped to segment
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  const ddx = p.x - projX;
  const ddy = p.y - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

// ---------------------------------------------------------------------------
// Convex hull (Graham scan)
// ---------------------------------------------------------------------------

/**
 * Compute the convex hull of a set of points using the Graham scan algorithm.
 */
export function convexHull(points: NormalizedPoint[]): NormalizedPoint[] {
  if (points.length <= 3) return [...points];

  // Find the lowest point (leftmost if tie)
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[pivot].y || (points[i].y === points[pivot].y && points[i].x < points[pivot].x)) {
      pivot = i;
    }
  }

  // Swap pivot to first position
  const sorted = [...points];
  [sorted[0], sorted[pivot]] = [sorted[pivot], sorted[0]];
  const pivotPoint = sorted[0];

  // Sort by polar angle from pivot
  const rest = sorted.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a.y - pivotPoint.y, a.x - pivotPoint.x);
    const angleB = Math.atan2(b.y - pivotPoint.y, b.x - pivotPoint.x);
    if (angleA !== angleB) return angleA - angleB;
    // If same angle, sort by distance (closer first)
    const distA = (a.x - pivotPoint.x) ** 2 + (a.y - pivotPoint.y) ** 2;
    const distB = (b.x - pivotPoint.x) ** 2 + (b.y - pivotPoint.y) ** 2;
    return distA - distB;
  });

  // Build hull using Graham scan
  const hull: NormalizedPoint[] = [pivotPoint];
  for (const point of rest) {
    while (hull.length > 1) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      if (cross <= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(point);
  }

  return hull;
}

// ---------------------------------------------------------------------------
// Main cleanup pipeline
// ---------------------------------------------------------------------------

/** Result of mask cleanup. */
export interface MaskCleanupResult {
  /** The cleaned polygon (null if the mask was too small/fragmented). */
  cleanedPolygon: NormalizedPoint[] | null;
  /** The original polygon before cleanup. */
  originalPolygon: NormalizedPoint[];
  /** Whether the polygon was modified during cleanup. */
  wasModified: boolean;
  /** Stages that were applied. */
  appliedStages: string[];
  /** Timings for each stage (ms). */
  stageTimings: Record<string, number>;
}

/**
 * Run the mask cleanup pipeline on a single polygon.
 *
 * Returns null in cleanedPolygon if the polygon was too small
 * or too fragmented to be useful.
 */
export function cleanMask(
  polygon: NormalizedPoint[],
  config?: MaskCleanupConfig,
): MaskCleanupResult {
  const resolvedConfig = { ...DEFAULT_CONFIG, ...config };
  const appliedStages: string[] = [];
  const stageTimings: Record<string, number> = {};
  let current = [...polygon];
  let wasModified = false;

  // Stage 1: Hole filling
  if (resolvedConfig.fillHoles) {
    const t0 = Date.now();
    const filled = fillHoles(current, resolvedConfig);
    stageTimings['hole_filling'] = Date.now() - t0;
    if (filled !== current) {
      current = filled;
      wasModified = true;
    }
    appliedStages.push('hole_filling');
  }

  // Stage 2: Tiny region removal
  {
    const t0 = Date.now();
    const cleaned = removeTinyRegions(current, resolvedConfig.minRegionArea);
    stageTimings['tiny_region_removal'] = Date.now() - t0;
    if (cleaned === null) {
      return {
        cleanedPolygon: null,
        originalPolygon: [...polygon],
        wasModified: true,
        appliedStages,
        stageTimings,
      };
    }
    if (cleaned !== current) {
      current = cleaned;
      wasModified = true;
    }
    appliedStages.push('tiny_region_removal');
  }

  // Stage 3: Island removal
  if (resolvedConfig.removeIslands) {
    const t0 = Date.now();
    const cleaned = removeIslands(current);
    stageTimings['island_removal'] = Date.now() - t0;
    if (cleaned === null) {
      return {
        cleanedPolygon: null,
        originalPolygon: [...polygon],
        wasModified: true,
        appliedStages,
        stageTimings,
      };
    }
    if (cleaned !== current) {
      current = cleaned;
      wasModified = true;
    }
    appliedStages.push('island_removal');
  }

  // Stage 4: Contour smoothing
  {
    const t0 = Date.now();
    const smoothed = smoothContour(current, resolvedConfig);
    stageTimings['contour_smoothing'] = Date.now() - t0;
    if (smoothed.length !== current.length) {
      wasModified = true;
    } else {
      for (let i = 0; i < smoothed.length; i++) {
        if (smoothed[i].x !== current[i].x || smoothed[i].y !== current[i].y) {
          wasModified = true;
          break;
        }
      }
    }
    current = smoothed;
    appliedStages.push('contour_smoothing');
  }

  return {
    cleanedPolygon: current,
    originalPolygon: [...polygon],
    wasModified,
    appliedStages,
    stageTimings,
  };
}

/**
 * Run the mask cleanup pipeline on a SemanticSegmentationMask,
 * producing a new mask with the cleaned polygon and updated fields.
 *
 * Returns null if the mask was too small/fragmented to keep.
 */
export function cleanSegmentationMask(
  mask: SemanticSegmentationMask,
  config?: MaskCleanupConfig,
): SemanticSegmentationMask | null {
  const result = cleanMask(mask.polygon, config);

  if (result.cleanedPolygon === null) {
    return null;
  }

  // Recompute mask bounds for cleaned polygon
  const bounds = computeMaskBounds(result.cleanedPolygon);

  return {
    ...mask,
    polygon: result.cleanedPolygon,
    maskBounds: bounds,
    cleanedMask: `cleaned-${mask.id}`,
    // Preserve rawMask from original if it existed
    rawMask: mask.rawMask ?? mask.cleanedMask,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMaskBounds(polygon: NormalizedPoint[]): import('@/lib/assistedEvidenceSources/overlayCoordinateConversion').NormalizedRegion {
  let xMin = 1000;
  let yMin = 1000;
  let xMax = 0;
  let yMax = 0;

  for (const pt of polygon) {
    if (pt.x < xMin) xMin = pt.x;
    if (pt.y < yMin) yMin = pt.y;
    if (pt.x > xMax) xMax = pt.x;
    if (pt.y > yMax) yMax = pt.y;
  }

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
    coordinateSystem: 'normalized_image_0_1000',
  };
}
