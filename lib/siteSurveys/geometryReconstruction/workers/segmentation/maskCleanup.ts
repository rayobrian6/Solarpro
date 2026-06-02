/**
 * Mask cleanup pipeline — transforms raw segmentation masks into clean
 * polygon outlines suitable for downstream geometry extraction.
 *
 * Cleanup stages:
 * 1. Hole filling — closes small interior gaps in masks
 * 2. Tiny region removal — removes regions smaller than a threshold
 * 3. Island removal — removes disconnected fragments
 * 4. Contour smoothing — simplifies jagged polygon boundaries
 * 5. Architectural angle snapping — enforces architecturally-valid angles
 *    (0°, 90°, roof slopes) on polygon edges for definitive lines
 *
 * ARCHITECTURAL TRUTHS:
 * Architecture has geometric truths that segmentation should enforce,
 * not just reproduce pixel boundaries:
 * - Gutters = TRUE LEVEL (horizontal)
 * - Bottom of siding = TRUE LEVEL (horizontal)
 * - Window sills = TRUE LEVEL (horizontal)
 * - Ridge/valley lines = STRAIGHT
 * - Wall corners = TRUE VERTICAL (90°)
 * - Foundation top = TRUE LEVEL
 * - Soffit underside = TRUE LEVEL
 *
 * All operations work on NormalizedPoint[] polygons in the
 * normalized_image_0_1000 coordinate system.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type { NormalizedPoint, SemanticSegmentationMask, SegmentationClass } from '../../types';
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
  /** Whether to apply architectural angle snapping. Default: true */
  architecturalSnap?: boolean;
  /** Angle tolerance in degrees for snapping to architectural angles. Default: 10 */
  architecturalSnapTolerance?: number;
  /** The segmentation class of the mask being cleaned (used for class-specific rules). */
  segmentationClass?: SegmentationClass;
}

const DEFAULT_CONFIG: Required<MaskCleanupConfig> = {
  minRegionArea: 500,
  smoothingEpsilon: 15,
  fillHoles: true,
  removeIslands: true,
  maxPolygonPoints: 50,
  architecturalSnap: true,
  architecturalSnapTolerance: 10,
  segmentationClass: 'unknown' as SegmentationClass,
};

// ---------------------------------------------------------------------------
// Architectural angle definitions
// ---------------------------------------------------------------------------

/**
 * Architecturally valid angles (degrees) for polygon edge snapping.
 *
 * These represent the geometric truths of residential construction:
 * - 0° / 180° = LEVEL (horizontal): gutters, sills, soffits, foundations, eaves
 * - 90° = VERTICAL: wall corners, downspouts, wall edges
 * - Roof slopes: common residential pitch angles
 *   - ~18° (4/12 pitch)
 *   - ~27° (6/12 pitch)
 *   - ~34° (8/12 pitch)
 *   - ~45° (12/12 pitch)
 *   - ~53° (14/12 pitch — steep)
 *   - ~60° (20/12 pitch — very steep/A-frame)
 *
 * Lines in architecture follow these angles because buildings are
 * constructed with plumb bobs, levels, and framing squares.
 * A "blobby" segmentation mask that produces a 7° line where the gutter
 * should be is WRONG — the architect built it at 0°.
 */
export const ARCHITECTURAL_ANGLES: readonly number[] = [
  0,     // Level / horizontal
  18,    // 4/12 roof pitch
  27,    // 6/12 roof pitch
  34,    // 8/12 roof pitch
  45,    // 12/12 roof pitch (perfect diagonal)
  53,    // 14/12 roof pitch (steep)
  60,    // 20/12 roof pitch (very steep / A-frame)
  90,    // Vertical / plumb
];

/**
 * Angles to also consider as complements (180° - angle).
 * E.g., an 18° rake going the other direction appears as 162°.
 */
const ARCHITECTURAL_ANGLES_WITH_COMPLEMENTS: readonly number[] = [
  0, 18, 27, 34, 45, 53, 60, 90,
  120, 127, 135, 146, 153, 162, 180,
];

/**
 * Which segmentation classes should have LEVEL enforcement on
 * their horizontal edges. These classes represent features that
 * architects build perfectly level.
 */
const LEVEL_ENFORCED_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'gutter', 'soffit', 'fascia', 'siding', 'window', 'door',
  'foundation', 'porch', 'deck', 'steps', 'railing',
  'garage_door', 'retaining_wall', 'awning', 'carport',
] as const);

/**
 * Which segmentation classes should have VERTICAL enforcement on
 * their vertical edges. These features are built plumb (vertical).
 */
const VERTICAL_ENFORCED_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'wall', 'siding', 'door', 'window', 'downspout', 'pillar', 'column',
  'chimney', 'vent_pipe', 'flue', 'utility_pole', 'fence',
] as const);

/**
 * Which segmentation classes should have ROOF SLOPE enforcement.
 * These features have edges at architecturally-valid roof pitches.
 */
const ROOF_SLOPE_ENFORCED_CLASSES: ReadonlySet<SegmentationClass> = new Set([
  'roof', 'dormer', 'awning', 'pergola', 'carport',
] as const);

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
// Angle computation and snapping
// ---------------------------------------------------------------------------

/**
 * Compute the angle of a polygon edge in degrees.
 * In screen coordinates (y-down): 0° = right, 90° = up, 180° = left, 270° = down.
 * Normalized to [0, 180) for undirected lines.
 */
function edgeAngleDeg(start: NormalizedPoint, end: NormalizedPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y; // y-down screen coordinates
  let angle = Math.atan2(-dy, dx) * (180 / Math.PI); // negate dy for standard math convention
  if (angle < 0) angle += 360;
  // Normalize to [0, 180) — lines are undirected
  let normalized = angle % 180;
  if (normalized < 0) normalized += 180;
  return normalized;
}

/**
 * Find the nearest architecturally-valid angle to a given edge angle.
 * Returns the snapped angle and the angular distance from the original.
 * If no architectural angle is within tolerance, returns null (no snap).
 */
function findNearestArchitecturalAngle(
  angleDeg: number,
  tolerance: number,
  enforceLevel: boolean,
  enforceVertical: boolean,
  enforceRoofSlopes: boolean,
): { snappedAngle: number; delta: number } | null {
  // Determine which architectural angles are valid based on class
  const candidateAngles: number[] = [];

  if (enforceLevel) {
    candidateAngles.push(0, 180); // Level/horizontal
  }
  if (enforceVertical) {
    candidateAngles.push(90); // Vertical/plumb
  }
  if (enforceRoofSlopes) {
    candidateAngles.push(...ARCHITECTURAL_ANGLES.filter(a => a !== 0 && a !== 90));
    candidateAngles.push(...ARCHITECTURAL_ANGLES_WITH_COMPLEMENTS.filter(
      a => a !== 0 && a !== 90 && a !== 180
    ));
  }

  // If no specific enforcement, use all architectural angles
  if (!enforceLevel && !enforceVertical && !enforceRoofSlopes) {
    candidateAngles.push(...ARCHITECTURAL_ANGLES_WITH_COMPLEMENTS);
  }

  // Find nearest
  let bestAngle: number | null = null;
  let bestDelta = Infinity;

  for (const candidate of candidateAngles) {
    // Compute angular distance considering the circular nature of angles
    let delta = Math.abs(angleDeg - candidate);
    // Handle wrap-around: 0° and 180° are the same for undirected lines
    if (delta > 90) delta = 180 - delta;

    if (delta < bestDelta) {
      bestDelta = delta;
      bestAngle = candidate;
    }
  }

  if (bestAngle === null || bestDelta > tolerance) {
    return null; // No architectural angle within tolerance
  }

  return { snappedAngle: bestAngle, delta: bestDelta };
}

/**
 * Snap a polygon edge to the nearest architecturally-valid angle.
 *
 * This rotates the endpoint around the start point so the edge
 * aligns with the nearest valid architectural angle (if within tolerance).
 *
 * The snap preserves the edge length by keeping the endpoint at the same
 * distance from the start point, just at the snapped angle.
 */
function snapEdgeToArchitecturalAngle(
  start: NormalizedPoint,
  end: NormalizedPoint,
  snappedAngle: number,
): NormalizedPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 0.5) return end; // Too short to snap meaningfully

  // Convert snapped angle back to screen coordinates (y-down)
  // snappedAngle is in [0, 180) undirected, so we need to determine
  // which direction (original or complement) to use
  const originalAngle = Math.atan2(-(end.y - start.y), end.x - start.x);
  const originalDeg = originalAngle * (180 / Math.PI);
  let originalNormalized = originalDeg % 180;
  if (originalNormalized < 0) originalNormalized += 180;

  // Choose the directed angle closest to the original
  const directedOriginal = originalDeg < 0 ? originalDeg + 360 : originalDeg;

  // Try both the snapped angle and its complement (180° - snapped)
  const candidates = [snappedAngle, 180 - snappedAngle];
  let bestDirectedAngle = directedOriginal;
  let bestDelta = Infinity;

  for (const candidate of candidates) {
    // Also try adding 360 for wrap-around
    for (const offset of [0, 360, -360]) {
      const directed = candidate + offset;
      const delta = Math.abs(directed - directedOriginal);
      const deltaWrap = Math.abs(Math.abs(directed - directedOriginal) - 360);
      const minDelta = Math.min(delta, deltaWrap);
      if (minDelta < bestDelta) {
        bestDelta = minDelta;
        bestDirectedAngle = directed;
      }
    }
  }

  // Convert back to radians and compute new endpoint
  const radians = bestDirectedAngle * (Math.PI / 180);
  const newEnd: NormalizedPoint = {
    x: start.x + length * Math.cos(radians),
    y: start.y - length * Math.sin(radians), // negate because y-down
    coordinateSystem: 'normalized_image_0_1000',
  };

  return newEnd;
}

// ---------------------------------------------------------------------------
// Architectural angle snapping stage
// ---------------------------------------------------------------------------

/**
 * Apply architectural angle snapping to a polygon.
 *
 * For each edge of the polygon, check if its angle is close to an
 * architecturally-valid angle (0°, 90°, roof slopes). If so, snap
 * the edge to the exact architectural angle.
 *
 * The snap is controlled by the segmentation class:
 * - Gutter, soffit, siding, etc. → enforce LEVEL (0°) on horizontal edges
 * - Wall, siding, chimney, etc. → enforce VERTICAL (90°) on vertical edges
 * - Roof, dormer, etc. → enforce ROOF SLOPES on diagonal edges
 *
 * This is the key difference between "computer vision output" (faithfully
 * reproducing pixel boundaries) and "site intelligence" (inferring
 * architectural intent and rendering the geometry the architect intended).
 */
function applyArchitecturalSnap(
  polygon: NormalizedPoint[],
  config: Required<MaskCleanupConfig>,
): NormalizedPoint[] {
  if (polygon.length < 3) return polygon;

  const tolerance = config.architecturalSnapTolerance;
  const segClass = config.segmentationClass;

  // Determine which enforcements apply based on segmentation class
  const enforceLevel = LEVEL_ENFORCED_CLASSES.has(segClass as SegmentationClass);
  const enforceVertical = VERTICAL_ENFORCED_CLASSES.has(segClass as SegmentationClass);
  const enforceRoofSlopes = ROOF_SLOPE_ENFORCED_CLASSES.has(segClass as SegmentationClass);

  // If no specific enforcement for this class, apply general snapping
  // with all architectural angles (but with a wider tolerance acceptance)
  const hasSpecificEnforcement = enforceLevel || enforceVertical || enforceRoofSlopes;

  const snapped: NormalizedPoint[] = polygon.map(p => ({ ...p }));
  let anySnapped = false;

  for (let i = 0; i < polygon.length; i++) {
    const start = snapped[i];
    const end = snapped[(i + 1) % polygon.length];
    const angle = edgeAngleDeg(start, end);

    const result = findNearestArchitecturalAngle(
      angle,
      tolerance,
      enforceLevel,
      enforceVertical,
      enforceRoofSlopes,
    );

    if (result !== null) {
      const newEnd = snapEdgeToArchitecturalAngle(start, end, result.snappedAngle);
      // Only apply if the snap is meaningful (endpoint moved)
      const dx = newEnd.x - end.x;
      const dy = newEnd.y - end.y;
      const shift = Math.sqrt(dx * dx + dy * dy);
      if (shift > 0.5) { // At least 0.5 normalized units of shift
        snapped[(i + 1) % polygon.length] = newEnd;
        anySnapped = true;
      }
    }
  }

  // After snapping, re-apply Douglas-Peucker with a smaller epsilon
  // to clean up any artifacts from the angle snapping
  if (anySnapped) {
    return douglasPeucker(snapped, config.smoothingEpsilon / 2);
  }

  return snapped;
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

  // Stage 5: Architectural angle snapping
  // THE KEY STAGE: Enforce architectural truths on polygon edges.
  // Gutters → LEVEL, Walls → VERTICAL, Roof → valid pitches.
  if (resolvedConfig.architecturalSnap) {
    const t0 = Date.now();
    const snapped = applyArchitecturalSnap(current, resolvedConfig);
    stageTimings['architectural_snap'] = Date.now() - t0;
    if (snapped !== current) {
      // Check if actually modified
      let snapModified = snapped.length !== current.length;
      if (!snapModified) {
        for (let i = 0; i < snapped.length; i++) {
          if (Math.abs(snapped[i].x - current[i].x) > 0.5 ||
              Math.abs(snapped[i].y - current[i].y) > 0.5) {
            snapModified = true;
            break;
          }
        }
      }
      if (snapModified) {
        current = snapped;
        wasModified = true;
      }
    }
    appliedStages.push('architectural_snap');
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
  // Pass the segmentation class to the cleanup pipeline for
  // class-specific architectural angle enforcement
  const configWithClass: MaskCleanupConfig = {
    ...config,
    segmentationClass: mask.segmentationClass,
  };

  const result = cleanMask(mask.polygon, configWithClass);

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
