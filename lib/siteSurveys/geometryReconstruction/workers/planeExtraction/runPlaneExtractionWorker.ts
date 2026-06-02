/**
 * Plane extraction worker — produces RoofPlaneCandidate and WallPlaneCandidate
 * artifacts from segmentation masks, structural lines, vanishing points,
 * and optional depth map data.
 *
 * Approach (v1 — heuristic only):
 * 1. Group segmentation masks by class (roof, wall)
 * 2. For each mask, find supporting lines that overlap with the mask region
 * 3. Estimate plane normal from vanishing point directions and line orientations
 * 4. Compute plane parameters (slope, aspect for roofs; height, facing for walls)
 * 5. Assign confidence based on line support, mask quality, and VP consistency
 *
 * Approach (v2 — depth-augmented):
 * When DepthMap artifacts are available (from Stage 4), the worker runs
 * extractDepthPlanes() to detect planar regions via flood-fill segmentation
 * on the depth grid. These depth-derived planes are then:
 *   - Mapped to RoofPlaneCandidate (orientation='slanted') or
 *     WallPlaneCandidate (orientation='vertical')
 *   - Augmented with heuristic line/VP parameters where overlap exists
 *   - Confidence-blended between depth and heuristic signals
 *   - Heuristic-only planes that have no depth overlap are kept as fallback
 *
 * Approach (v3 — architectural truth boundaries):
 * Instead of using raw blobby mask polygons as plane boundaries, v3 constructs
 * plane boundaries from the INTERSECTION POINTS of structural lines that bound
 * the plane region. This produces architecturally truthful polygons:
 *   - Roof boundaries from ridge/eave/rake/valley/hip line intersections
 *   - Wall boundaries from eave/wall_vertical/gutter/sill/foundation intersections
 *   - Level enforcement: gutters, sills, eaves, foundations snapped to true horizontal
 *   - Vertical enforcement: walls, pillars, chimneys snapped to true vertical
 *   - Graceful fallback: if insufficient line data, falls back to mask polygon
 *
 * The heuristic path remains the default when depth data is absent, ensuring
 * the pipeline never breaks when models are unavailable.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  StructuralLineType,
  VanishingPointArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  NormalizedPoint,
  GeometryReconstructionArtifact,
  GeometryReconstructionInput,
  NormalizedRegion,
  DepthMap,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';
import {
  extractDepthPlanes,
} from '../depth/depthPlaneExtraction';
import type {
  DepthPlaneCandidate,
  DepthPlaneOptions,
  DepthPlaneExtractionResult,
} from '../depth/depthPlaneExtraction';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const PLANE_EXTRACTION_WORKER_VERSION = '3.0.0-plane-extraction-line-boundaries';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const PLANE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Plane extraction is heuristic when depth data is unavailable — not from RANSAC or model inference.',
  'Plane boundaries are constructed from structural line intersections where available, falling back to raw mask polygons.',
  'Architectural truth enforcement snaps level edges (gutters, sills, eaves) to true horizontal and vertical edges (walls, pillars) to true vertical.',
  'When depth maps are available, planes are derived from flood-fill segmentation on depth gradients.',
  'Depth-derived normals are estimated from depth gradient direction, not from 3D measurements.',
  'Slope and aspect are approximations based on depth gradient geometry or heuristic line orientations.',
  'Depth convention: higher values = farther from camera. Orientation depends on gradient magnitude.',
] as const;

const PLANE_EXTRACTION_LIMITATIONS_DEPTH = [
  ...BASE_LIMITATIONS,
  'Plane extracted from depth-aware flood-fill segmentation — not from RANSAC on 3D point clouds.',
  'Plane boundaries are constructed from structural line intersections where available, enforcing architectural truth (level/vertical).',
  'Depth is monocular relative (not metric) — plane parameters are approximations, not survey-grade.',
  'Depth convention: higher values = farther from camera. Orientation classified by gradient magnitude.',
  'Slope and aspect estimated from depth gradient direction — more reliable than heuristic but not CAD.',
  'Heuristic line/VP parameters are blended with depth-derived parameters when overlap exists.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the plane extraction worker. */
export interface PlaneExtractionWorkerInput {
  surveyId: string;
  /** Segmentation masks to extract planes from. */
  masks: SemanticSegmentationMask[];
  /** Structural lines for plane boundary detection. */
  lines: StructuralLineCandidate[];
  /** Vanishing points for perspective estimation. */
  vanishingPoints: VanishingPointArtifact[];
  /** Optional depth map artifacts (from Stage 4). When provided, depth-aware
   *  plane extraction runs first and augments/replaces heuristic results. */
  depthMaps?: DepthMap[];
  /** Whether MiDaS was used to produce the depth maps (from DepthWorkerOutput). */
  usedMidas?: boolean;
  /** Optional config overrides. */
  config?: {
    /** Minimum confidence threshold for planes (0-100). Default: 25 */
    minConfidence?: number;
    /** Whether to require supporting lines for plane extraction. Default: false */
    requireSupportingLines?: boolean;
    /** Options for depth-aware plane extraction (ignored when depthMaps is empty). */
    depthPlaneOptions?: DepthPlaneOptions;
  };
}

/** Output of the plane extraction worker. */
export interface PlaneExtractionWorkerOutput {
  artifacts: Array<RoofPlaneCandidate | WallPlaneCandidate>;
  stageTimings: Record<string, number>;
  workerVersion: string;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Check if a point is inside a polygon (ray casting). */
function pointInPolygon(point: NormalizedPoint, polygon: NormalizedPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Check if two polygons overlap (centroid of one inside the other). */
function polygonsOverlap(a: NormalizedPoint[], b: NormalizedPoint[]): boolean {
  // Quick check: centroid of a in b
  const centroidA = polygonCentroid(a);
  if (pointInPolygon(centroidA, b)) return true;

  // Check centroid of b in a
  const centroidB = polygonCentroid(b);
  if (pointInPolygon(centroidB, a)) return true;

  return false;
}

/** Compute centroid of a polygon. */
function polygonCentroid(polygon: NormalizedPoint[]): NormalizedPoint {
  const n = polygon.length;
  const cx = polygon.reduce((s, p) => s + p.x, 0) / n;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / n;
  return { x: cx, y: cy, coordinateSystem: 'normalized_image_0_1000' };
}

/** Compute the bounding box of a polygon. */
function polygonBounds(polygon: NormalizedPoint[]): NormalizedRegion {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of polygon) {
    if (p.x < xMin) xMin = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.x > xMax) xMax = p.x;
    if (p.y > yMax) yMax = p.y;
  }
  return {
    x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/** Distance from a point to a line segment (for overlap checking). */
function pointToSegmentDist(p: NormalizedPoint, a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) {
    const ddx = p.x - a.x, ddy = p.y - a.y;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx, projY = a.y + t * dy;
  const ddx = p.x - projX, ddy = p.y - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/** Check if a line overlaps with a mask polygon. */
function lineOverlapsMask(line: StructuralLineCandidate, mask: SemanticSegmentationMask): boolean {
  const polygon = mask.polygon;
  if (polygon.length < 3) return false;

  // Check if either endpoint is inside the polygon
  if (pointInPolygon(line.start, polygon) || pointInPolygon(line.end, polygon)) {
    return true;
  }

  // Check if the line segment intersects with any polygon edge
  // or if any polygon vertex is close to the line segment
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];

    // Check if the line segment intersects with this polygon edge
    if (segmentsIntersect(line.start, line.end, a, b)) {
      return true;
    }
  }

  // Check if the line segment's midpoint is inside the polygon
  const midX = (line.start.x + line.end.x) / 2;
  const midY = (line.start.y + line.end.y) / 2;
  const midpoint: NormalizedPoint = { x: midX, y: midY, coordinateSystem: 'normalized_image_0_1000' };
  if (pointInPolygon(midpoint, polygon)) {
    return true;
  }

  // Check if any polygon vertex is close to the line segment
  const centroid = polygonCentroid(polygon);
  if (pointToSegmentDist(centroid, line.start, line.end) < 50) {
    return true;
  }

  return false;
}

/** Check if two line segments intersect. */
function segmentsIntersect(
  p1: NormalizedPoint, p2: NormalizedPoint,
  p3: NormalizedPoint, p4: NormalizedPoint,
): boolean {
  const d1 = cross2D(p3, p4, p1);
  const d2 = cross2D(p3, p4, p2);
  const d3 = cross2D(p1, p2, p3);
  const d4 = cross2D(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Check collinear cases
  if (Math.abs(d1) < 1e-10 && onSegment(p3, p1, p4)) return true;
  if (Math.abs(d2) < 1e-10 && onSegment(p3, p2, p4)) return true;
  if (Math.abs(d3) < 1e-10 && onSegment(p1, p3, p2)) return true;
  if (Math.abs(d4) < 1e-10 && onSegment(p1, p4, p2)) return true;

  return false;
}

/** Cross product of vectors (p1→p2) × (p1→p3). */
function cross2D(p1: NormalizedPoint, p2: NormalizedPoint, p3: NormalizedPoint): number {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

/** Check if point q lies on segment p1-p2 (assumes collinearity). */
function onSegment(p1: NormalizedPoint, q: NormalizedPoint, p2: NormalizedPoint): boolean {
  return q.x <= Math.max(p1.x, p2.x) && q.x >= Math.min(p1.x, p2.x) &&
         q.y <= Math.max(p1.y, p2.y) && q.y >= Math.min(p1.y, p2.y);
}

// ---------------------------------------------------------------------------
// Line intersection → polygon boundary construction (v3 architectural truth)
// ---------------------------------------------------------------------------

/**
 * Line types that form the BOUNDARY of a roof plane.
 * These lines define the edges of a roof region — their intersection
 * points become the vertices of the plane polygon.
 */
const ROOF_BOUNDARY_LINE_TYPES: StructuralLineType[] = [
  'ridge', 'eave', 'rake', 'valley', 'hip',
  'chimney_edge', 'dormer_ridge', 'dormer_rake',
];

/**
 * Line types that form the BOUNDARY of a wall plane.
 * These lines define the edges of a wall region — their intersection
 * points become the vertices of the wall polygon.
 */
const WALL_BOUNDARY_LINE_TYPES: StructuralLineType[] = [
  'eave', 'wall_vertical', 'gutter_line', 'sill_line',
  'soffit_line', 'fascia_line', 'foundation_line',
];

/**
 * Line types that are LEVEL (horizontal) and define truth-level
 * boundaries. These should produce polygon edges at exactly 0°
 * in image space.
 */
const LEVEL_LINE_TYPES: StructuralLineType[] = [
  'eave', 'ridge', 'gutter_line', 'sill_line', 'soffit_line',
  'foundation_line', 'retaining_wall_line', 'dormer_ridge',
];

/**
 * Line types that are VERTICAL and define truth-vertical
 * boundaries.
 */
const VERTICAL_LINE_TYPES: StructuralLineType[] = [
  'wall_vertical',
];

/**
 * Compute the intersection point of two infinite lines defined by
 * segments (a1→a2) and (b1→b2). Returns null if lines are parallel.
 */
function lineLineIntersection(
  a1: NormalizedPoint, a2: NormalizedPoint,
  b1: NormalizedPoint, b2: NormalizedPoint,
): NormalizedPoint | null {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // parallel or near-parallel

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  return {
    x: a1.x + t * d1x,
    y: a1.y + t * d1y,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Compute the intersection of two finite line segments.
 * Returns the intersection point only if it lies within both segments
 * (within tolerance). Tolerance is in normalized coordinates (0-1000 scale).
 */
function segmentSegmentIntersection(
  a1: NormalizedPoint, a2: NormalizedPoint,
  b1: NormalizedPoint, b2: NormalizedPoint,
  tolerance: number = 30, // ~3% of image width
): NormalizedPoint | null {
  const pt = lineLineIntersection(a1, a2, b1, b2);
  if (!pt) return null;

  // Check that intersection point is within tolerance of both segments
  const dA = pointToSegmentDist(pt, a1, a2);
  const dB = pointToSegmentDist(pt, b1, b2);
  if (dA > tolerance || dB > tolerance) return null;

  // Clamp to reasonable image bounds [−50, 1050] (slight overflow allowed)
  pt.x = Math.max(-50, Math.min(1050, pt.x));
  pt.y = Math.max(-50, Math.min(1050, pt.y));

  return pt;
}

/**
 * Sort polygon vertices into counter-clockwise order using the
 * centroid and atan2. This produces a well-formed polygon from
 * a set of unordered intersection vertices.
 */
function sortVerticesCCW(vertices: NormalizedPoint[]): NormalizedPoint[] {
  if (vertices.length < 3) return vertices;
  const cx = vertices.reduce((s, p) => s + p.x, 0) / vertices.length;
  const cy = vertices.reduce((s, p) => s + p.y, 0) / vertices.length;
  return [...vertices].sort((a, b) => {
    return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
  });
}

/**
 * Remove duplicate vertices (within tolerance distance).
 * Prevents degenerate polygons with repeated near-identical points.
 */
function deduplicateVertices(vertices: NormalizedPoint[], tolerance: number = 15): NormalizedPoint[] {
  if (vertices.length <= 1) return vertices;
  const result: NormalizedPoint[] = [vertices[0]];
  for (let i = 1; i < vertices.length; i++) {
    const last = result[result.length - 1];
    const dx = vertices[i].x - last.x;
    const dy = vertices[i].y - last.y;
    if (Math.sqrt(dx * dx + dy * dy) > tolerance) {
      result.push(vertices[i]);
    }
  }
  // Check wrap-around
  if (result.length > 1) {
    const dx = result[0].x - result[result.length - 1].x;
    const dy = result[0].y - result[result.length - 1].y;
    if (Math.sqrt(dx * dx + dy * dy) < tolerance) {
      result.pop();
    }
  }
  return result;
}

/**
 * Compute a plane boundary polygon from the intersection points
 * of structural lines that bound the plane region.
 *
 * This is the core architectural-truth function: instead of using
 * the raw blobby segmentation mask polygon, we construct the plane
 * boundary from where the structural lines (ridges, eaves, rakes,
 * valleys, hips, etc.) intersect each other.
 *
 * Algorithm:
 * 1. Select boundary-relevant lines for the plane class (roof vs wall)
 * 2. Compute pairwise intersection points between all boundary lines
 * 3. Filter intersections to those within the mask region (anchor to reality)
 * 4. Add line endpoints that fall within the mask region
 * 5. Deduplicate and sort vertices into CCW order
 * 6. If insufficient vertices, fall back to mask polygon
 *
 * The resulting polygon has architecturally truthful edges: gutters
 * are level, ridges are straight, corners are at line intersections.
 */
function constructPlaneBoundaryFromLines(
  mask: SemanticSegmentationMask,
  associatedLines: StructuralLineCandidate[],
  isRoof: boolean,
  fallbackPolygon: NormalizedPoint[] | undefined,
): NormalizedPoint[] | undefined {
  const polygon = mask.polygon;
  if (polygon.length < 3) return fallbackPolygon;

  // Step 1: Select boundary-relevant lines
  const boundaryTypes = isRoof ? ROOF_BOUNDARY_LINE_TYPES : WALL_BOUNDARY_LINE_TYPES;
  const boundaryLines = associatedLines.filter(l => boundaryTypes.includes(l.lineType));

  // If no boundary lines, fall back to mask polygon
  if (boundaryLines.length < 2) {
    console.info(
      `[PlaneBoundary] ${isRoof ? 'Roof' : 'Wall'} mask ${mask.id}: ` +
      `only ${boundaryLines.length} boundary lines, using mask polygon`,
    );
    return fallbackPolygon;
  }

  // Step 2: Compute pairwise intersection points
  const intersections: NormalizedPoint[] = [];
  for (let i = 0; i < boundaryLines.length; i++) {
    for (let j = i + 1; j < boundaryLines.length; j++) {
      const li = boundaryLines[i];
      const lj = boundaryLines[j];

      // Skip same-type pairs that are parallel (e.g., two ridge lines)
      if (li.lineType === lj.lineType && isApproximatelyParallel(li, lj)) {
        continue;
      }

      const pt = segmentSegmentIntersection(li.start, li.end, lj.start, lj.end);
      if (pt) {
        intersections.push(pt);
      }
    }
  }

  // Step 3: Filter intersections to those near the mask region
  // A point is "near" if it's inside the mask polygon or within 80 normalized
  // units of the mask centroid (ensures we don't include far-away intersections)
  const maskCentroid = polygonCentroid(polygon);
  const maxDist = 400; // max distance from centroid to accept (40% of image)
  const nearIntersections = intersections.filter(pt => {
    // Prefer points inside the mask polygon
    if (pointInPolygon(pt, polygon)) return true;
    // Accept points close to the mask region
    const dx = pt.x - maskCentroid.x;
    const dy = pt.y - maskCentroid.y;
    return Math.sqrt(dx * dx + dy * dy) < maxDist;
  });

  // Step 4: Add line endpoints that fall within or near the mask region
  const lineEndpoints: NormalizedPoint[] = [];
  for (const line of boundaryLines) {
    for (const pt of [line.start, line.end]) {
      if (pointInPolygon(pt, polygon)) {
        lineEndpoints.push(pt);
      } else {
        // Accept endpoints close to the polygon boundary
        let minDist = Infinity;
        for (let k = 0; k < polygon.length; k++) {
          const d = pointToSegmentDist(pt, polygon[k], polygon[(k + 1) % polygon.length]);
          if (d < minDist) minDist = d;
        }
        if (minDist < 80) { // within 8% of image dimension
          lineEndpoints.push(pt);
        }
      }
    }
  }

  // Combine all vertices
  const allVertices = [...nearIntersections, ...lineEndpoints];

  // Step 5: Deduplicate and sort
  const deduped = deduplicateVertices(allVertices);
  const sorted = sortVerticesCCW(deduped);

  // Step 6: Validate — need at least 3 vertices for a meaningful polygon
  if (sorted.length < 3) {
    console.info(
      `[PlaneBoundary] ${isRoof ? 'Roof' : 'Wall'} mask ${mask.id}: ` +
      `only ${sorted.length} line-derived vertices (${intersections.length} intersections, ` +
      `${lineEndpoints.length} endpoints), using mask polygon`,
    );
    return fallbackPolygon;
  }

  // Compute area of the constructed polygon to sanity-check it
  const area = polygonArea(sorted);
  const maskArea = polygonArea(polygon);

  // If the line-constructed polygon is less than 10% or more than 500% of
  // the mask area, something went wrong — fall back
  if (maskArea > 0 && (area < maskArea * 0.1 || area > maskArea * 5)) {
    console.info(
      `[PlaneBoundary] ${isRoof ? 'Roof' : 'Wall'} mask ${mask.id}: ` +
      `line polygon area=${area.toFixed(0)} vs mask area=${maskArea.toFixed(0)}, ` +
      `using mask polygon`,
    );
    return fallbackPolygon;
  }

  console.info(
    `[PlaneBoundary] ${isRoof ? 'Roof' : 'Wall'} mask ${mask.id}: ` +
    `constructed polygon from ${boundaryLines.length} boundary lines → ` +
    `${intersections.length} intersections, ${lineEndpoints.length} endpoints → ` +
    `${sorted.length} vertices (mask had ${polygon.length})`,
  );

  return sorted;
}

/**
 * Check if two structural lines are approximately parallel.
 * Used to skip intersection computation for parallel same-type lines.
 */
function isApproximatelyParallel(a: StructuralLineCandidate, b: StructuralLineCandidate): boolean {
  const dxA = a.end.x - a.start.x, dyA = a.end.y - a.start.y;
  const dxB = b.end.x - b.start.x, dyB = b.end.y - b.start.y;
  const lenA = Math.sqrt(dxA * dxA + dyA * dyA);
  const lenB = Math.sqrt(dxB * dxB + dyB * dyB);
  if (lenA < 1e-10 || lenB < 1e-10) return false;

  // Cross product of unit direction vectors
  const cross = (dxA / lenA) * (dyB / lenB) - (dyA / lenA) * (dxB / lenB);
  return Math.abs(cross) < 0.15; // ~8.5° tolerance for "approximately parallel"
}

/**
 * Compute the signed area of a polygon (normalized coordinates).
 * Used for sanity-checking constructed polygon sizes.
 * Returns absolute area regardless of winding direction.
 */
function polygonArea(polygon: NormalizedPoint[]): number {
  let area = 0;
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }
  return Math.abs(area / 2);
}

/**
 * Enforce architectural truth on a polygon derived from line intersections:
 * edges that should be level (0°) or vertical (90°) are snapped to exact
 * angles. This ensures that gutters are truly level, walls are truly
 * vertical, etc.
 *
 * Works by checking each edge's angle against the class-specific
 * enforcement rules and snapping endpoints if within tolerance.
 */
function enforceArchitecturalTruth(
  polygon: NormalizedPoint[] | undefined,
  segmentationClass: string,
  snapTolerance: number = 10, // degrees
): NormalizedPoint[] | undefined {
  if (!polygon || polygon.length < 3) return polygon;

  // Determine which angle constraints apply
  const shouldEnforceLevel = LEVEL_ENFORCED_CLASSES_FOR_PLANES.has(segmentationClass);
  const shouldEnforceVertical = VERTICAL_ENFORCED_CLASSES_FOR_PLANES.has(segmentationClass);

  if (!shouldEnforceLevel && !shouldEnforceVertical) return polygon;

  const result = polygon.map(p => ({ ...p })); // deep copy

  for (let i = 0; i < result.length; i++) {
    const j = (i + 1) % result.length;
    const dx = result[j].x - result[i].x;
    const dy = result[j].y - result[i].y;

    if (Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10) continue;

    const angle = Math.atan2(dx, -dy) * (180 / Math.PI); // angle from vertical (image Y-down)
    // In image coords: angle 0 = straight up, 90 = right, -90 = left, 180 = down
    // Level line: angle ≈ ±90° (horizontal in image)
    // Vertical line: angle ≈ 0° or 180° (vertical in image)

    // Normalize angle to [-180, 180]
    const normAngle = ((angle + 180) % 360) - 180;

    if (shouldEnforceLevel && (Math.abs(normAngle - 90) < snapTolerance || Math.abs(normAngle + 90) < snapTolerance)) {
      // Snap to level: make Y coordinates identical
      const avgY = (result[i].y + result[j].y) / 2;
      result[i].y = avgY;
      result[j].y = avgY;
    } else if (shouldEnforceVertical && (Math.abs(normAngle) < snapTolerance || Math.abs(normAngle - 180) < snapTolerance || Math.abs(normAngle + 180) < snapTolerance)) {
      // Snap to vertical: make X coordinates identical
      const avgX = (result[i].x + result[j].x) / 2;
      result[i].x = avgX;
      result[j].x = avgX;
    }
  }

  return result;
}

/**
 * Classes whose plane polygons should have level edges enforced
 * (gutters, sills, foundations, eaves should all be truly horizontal).
 */
const LEVEL_ENFORCED_CLASSES_FOR_PLANES = new Set([
  'roof', 'gutter', 'soffit', 'fascia', 'eave',
  'siding', 'window', 'door', 'foundation', 'porch',
  'deck', 'steps', 'railing', 'garage_door', 'retaining_wall',
  'awning', 'carport', 'sill_line', 'gutter_line',
]);

/**
 * Classes whose plane polygons should have vertical edges enforced
 * (walls, pillars, chimneys should have truly vertical sides).
 */
const VERTICAL_ENFORCED_CLASSES_FOR_PLANES = new Set([
  'wall', 'siding', 'door', 'window', 'downspout',
  'pillar', 'column', 'chimney', 'vent_pipe', 'flue',
  'utility_pole', 'fence', 'wall_vertical',
]);

// ---------------------------------------------------------------------------
// Depth-to-artifact mapping helpers
// ---------------------------------------------------------------------------

/**
 * Estimate slope and aspect from a depth plane's gradient magnitude and
 * bounding box position. This is more reliable than the pure heuristic
 * because it uses actual depth variation rather than line angles.
 *
 * Approach:
 * - Gradient magnitude maps to slope (steeper gradient = higher slope)
 * - Position in the image and gradient direction give aspect estimate
 * - Bounds help determine the plane's spatial context
 */
function estimateDepthRoofParameters(
  plane: DepthPlaneCandidate,
  imageWidth: number,
  imageHeight: number,
): { slope: number; aspect: number; normal: [number, number, number] } {
  // Gradient magnitude → slope mapping
  // Low gradient (~0.04) → ~15°, moderate (~0.10) → ~30°, high (~0.20+) → ~45°
  const gradientScale = 300; // empirical scaling factor
  const slope = Math.max(5, Math.min(60, plane.gradientMagnitude * gradientScale));

  // Aspect from centroid position: center of image → south-facing (180°),
  // left → west (270°), right → east (90°). Use bounds center for position.
  const centerX = (plane.bounds.xMin + plane.bounds.xMax) / 2;
  // Map [0,1] → [0, 360] for aspect, with 0.5 = south (180°)
  let aspect = ((1.0 - centerX) * 360 + 180) % 360;

  // Compute normal from slope and aspect
  const aspectRad = aspect * (Math.PI / 180);
  const slopeRad = slope * (Math.PI / 180);
  const normal: [number, number, number] = [
    Math.sin(slopeRad) * Math.cos(aspectRad),
    Math.sin(slopeRad) * Math.sin(aspectRad),
    Math.cos(slopeRad),
  ];

  // Normalize
  const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  if (len > 1e-10) {
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
  }

  return { slope, aspect, normal };
}

/**
 * Estimate wall height and facing direction from a depth plane's
 * bounding box and depth statistics.
 */
function estimateDepthWallParameters(
  plane: DepthPlaneCandidate,
): { height: number; facing: string; normal: [number, number, number] } {
  // Height from vertical extent: bounds height as fraction of image × 8m typical
  const verticalExtent = plane.bounds.yMax - plane.bounds.yMin;
  const rawHeight = verticalExtent * 8;
  const height = Math.max(1, Math.min(15, Math.round(rawHeight * 10) / 10));

  // Facing from horizontal position
  const centerX = (plane.bounds.xMin + plane.bounds.xMax) / 2;
  let facing: string;
  if (centerX < 0.35) {
    facing = 'west';
  } else if (centerX > 0.65) {
    facing = 'east';
  } else {
    facing = 'south';
  }

  // Normal from facing direction
  const facingToNormal: Record<string, [number, number, number]> = {
    north: [0, -1, 0],
    south: [0, 1, 0],
    east: [1, 0, 0],
    west: [-1, 0, 0],
  };
  let normal: [number, number, number] = facingToNormal[facing] ?? [0, 1, 0];

  // Add a slight Z component for perspective
  normal = [normal[0], normal[1], 0.05];
  const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  if (len > 1e-10) {
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
  }

  return { height, facing, normal };
}

/**
 * Check if a depth plane candidate overlaps with a heuristic mask polygon
 * by testing if the depth plane's bounding box overlaps with the mask's
 * bounding region.
 */
function depthPlaneOverlapsMask(
  plane: DepthPlaneCandidate,
  mask: SemanticSegmentationMask,
): boolean {
  if (!mask.maskBounds) return false;

  // Convert depth bounds from [0,1] to [0,1000] coordinate system
  const pXMin = plane.bounds.xMin * 1000;
  const pYMin = plane.bounds.yMin * 1000;
  const pXMax = plane.bounds.xMax * 1000;
  const pYMax = plane.bounds.yMax * 1000;

  const mXMin = mask.maskBounds.x;
  const mYMin = mask.maskBounds.y;
  const mXMax = mask.maskBounds.x + mask.maskBounds.width;
  const mYMax = mask.maskBounds.y + mask.maskBounds.height;

  // Axis-aligned bounding box overlap test
  return pXMin < mXMax && pXMax > mXMin && pYMin < mYMax && pYMax > mYMin;
}

/**
 * Blend depth-derived confidence with heuristic confidence.
 * Depth signal is weighted more heavily when MiDaS was used.
 *
 * @param depthConf - Confidence from depth plane extraction (0-100)
 * @param heuristicConf - Confidence from heuristic line/mask analysis (0-100)
 * @param usedMidas - Whether MiDaS was used for depth (gives higher weight)
 * @returns Blended confidence (0-100)
 */
function blendConfidence(
  depthConf: number,
  heuristicConf: number,
  usedMidas: boolean,
): number {
  // Weight depth more when MiDaS was used (70/30), less when heuristic (50/50)
  const depthWeight = usedMidas ? 0.7 : 0.5;
  const heuristicWeight = 1 - depthWeight;
  const blended = depthConf * depthWeight + heuristicConf * heuristicWeight;
  return Math.round(Math.min(100, Math.max(0, blended)));
}

// ---------------------------------------------------------------------------
// Plane parameter estimation (heuristic — unchanged from v1)
// ---------------------------------------------------------------------------

/**
 * Estimate a roof plane's slope and aspect from its associated lines
 * and vanishing points.
 *
 * Heuristic approach:
 * - Ridge direction gives the roof's axis
 * - Rake angle gives slope estimate
 * - VP directions give aspect
 */
function estimateRoofParameters(
  mask: SemanticSegmentationMask,
  associatedLines: StructuralLineCandidate[],
  vanishingPoints: VanishingPointArtifact[],
): { slope: number; aspect: number; normal: [number, number, number] } {
  const polygon = mask.polygon;
  const bounds = polygonBounds(polygon);
  const centroid = polygonCentroid(polygon);

  // Find ridge and rake lines for slope estimation
  const ridgeLines = associatedLines.filter(l => l.lineType === 'ridge');
  const rakeLines = associatedLines.filter(l => l.lineType === 'rake');
  const eaveLines = associatedLines.filter(l => l.lineType === 'eave');

  // Estimate slope from rake line angles
  let slope = 25; // default moderate slope
  if (rakeLines.length > 0) {
    // Average the rake angles to estimate slope
    const rakeAngles = rakeLines.map(l => {
      const dx = l.end.x - l.start.x;
      const dy = l.end.y - l.start.y;
      return Math.abs(Math.atan2(dx, -dy) * (180 / Math.PI));
    });
    const avgAngle = rakeAngles.reduce((s, a) => s + a, 0) / rakeAngles.length;
    slope = Math.max(5, Math.min(60, avgAngle));
  } else if (ridgeLines.length > 0 && eaveLines.length > 0) {
    // Estimate slope from vertical distance between ridge and eave
    const ridgeY = ridgeLines.reduce((s, l) => s + (l.start.y + l.end.y) / 2, 0) / ridgeLines.length;
    const eaveY = eaveLines.reduce((s, l) => s + (l.start.y + l.end.y) / 2, 0) / eaveLines.length;
    const heightDiff = eaveY - ridgeY; // positive if eave is below ridge
    const halfWidth = bounds.width / 2;
    if (halfWidth > 0 && heightDiff > 0) {
      slope = Math.atan2(heightDiff, halfWidth) * (180 / Math.PI);
      slope = Math.max(5, Math.min(60, slope));
    }
  }

  // Estimate aspect from vanishing points or ridge orientation
  let aspect = 180; // default south-facing
  if (ridgeLines.length > 0) {
    // Ridge direction gives the roof axis; aspect is perpendicular
    const ridge = ridgeLines[0];
    const ridgeAngle = Math.atan2(ridge.end.x - ridge.start.x, ridge.end.y - ridge.start.y);
    aspect = ((ridgeAngle * 180 / Math.PI) + 90 + 360) % 360;
  } else if (vanishingPoints.length > 0) {
    // Use X-direction VP to estimate the ridge axis direction
    const xVp = vanishingPoints.find(vp => vp.direction === 'x');
    if (xVp) {
      const vpAngle = Math.atan2(xVp.point.y - centroid.y, xVp.point.x - centroid.x);
      aspect = ((vpAngle * 180 / Math.PI) + 90 + 360) % 360;
    }
  }

  // Compute normal vector from slope and aspect
  // Normal points outward from the roof surface
  const aspectRad = aspect * (Math.PI / 180);
  const slopeRad = slope * (Math.PI / 180);
  const normal: [number, number, number] = [
    Math.sin(slopeRad) * Math.cos(aspectRad),
    Math.sin(slopeRad) * Math.sin(aspectRad),
    Math.cos(slopeRad),
  ];

  // Normalize the normal vector
  const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  if (len > 1e-10) {
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
  }

  return { slope, aspect, normal };
}

/**
 * Estimate a wall plane's height and facing direction from its
 * associated lines and mask extent.
 */
function estimateWallParameters(
  mask: SemanticSegmentationMask,
  associatedLines: StructuralLineCandidate[],
): { height: number; facing: string; normal: [number, number, number] } {
  const polygon = mask.polygon;
  const bounds = polygonBounds(polygon);
  const centroid = polygonCentroid(polygon);

  // Estimate height from mask vertical extent
  // Assume the image covers roughly 10m vertical, so height ~ bounds.height / 1000 * 10
  // But cap at reasonable wall heights
  const rawHeight = (bounds.height / 1000) * 8; // 8m total vertical in a typical residential photo
  const height = Math.max(1, Math.min(15, Math.round(rawHeight * 10) / 10));

  // Estimate facing direction from the mask's horizontal position
  // and the centroid location relative to the image center
  const validDirections = ['north', 'south', 'east', 'west'];
  let facing = 'south'; // default

  if (associatedLines.length > 0) {
    // Use wall_vertical lines to determine which side the wall is on
    const wallVerts = associatedLines.filter(l => l.lineType === 'wall_vertical');
    if (wallVerts.length > 0) {
      const avgX = wallVerts.reduce((s, l) => s + (l.start.x + l.end.x) / 2, 0) / wallVerts.length;
      // Left side of image → east-facing, right side → west-facing
      if (avgX < 350) {
        facing = 'west';
      } else if (avgX > 650) {
        facing = 'east';
      } else {
        facing = 'south';
      }
    }
  } else {
    // No lines — use mask centroid position
    if (centroid.x < 350) {
      facing = 'west';
    } else if (centroid.x > 650) {
      facing = 'east';
    } else {
      facing = 'south';
    }
  }

  // Compute normal vector from facing direction
  const facingToNormal: Record<string, [number, number, number]> = {
    north: [0, -1, 0],
    south: [0, 1, 0],
    east: [1, 0, 0],
    west: [-1, 0, 0],
  };
  let normal: [number, number, number] = facingToNormal[facing] ?? [0, 1, 0];

  // Add a slight Z component to account for perspective
  normal = [normal[0], normal[1], 0.05];
  const len = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2);
  if (len > 1e-10) {
    normal[0] /= len;
    normal[1] /= len;
    normal[2] /= len;
  }

  return { height, facing, normal };
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the plane extraction worker on a set of segmentation masks,
 * structural lines, vanishing points, and optional depth maps.
 *
 * When depth maps are available (from Stage 4), the worker uses
 * extractDepthPlanes() to identify planar regions via flood-fill
 * segmentation, then maps those regions to RoofPlaneCandidate and
 * WallPlaneCandidate artifacts. Heuristic-only planes that have no
 * depth overlap are kept as fallback.
 *
 * When depth maps are not available, the worker falls back to the
 * v1 heuristic approach (lines + VP + mask geometry).
 */
export function runPlaneExtractionWorker(input: PlaneExtractionWorkerInput): PlaneExtractionWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: Array<RoofPlaneCandidate | WallPlaneCandidate> = [];

  const minConfidence = input.config?.minConfidence ?? 25;
  const requireSupportingLines = input.config?.requireSupportingLines ?? false;

  // Stage 1: Initialize
  const t0 = Date.now();
  const roofMasks = input.masks.filter(m => m.segmentationClass === 'roof');
  const wallMasks = input.masks.filter(m => m.segmentationClass === 'wall');
  const hasDepthMaps = !!input.depthMaps && input.depthMaps.length > 0;
  const usedMidas = input.usedMidas ?? false;
  timings['initialization'] = Date.now() - t0;

  console.info(
    `[PlaneExtraction] Starting: roofMasks=${roofMasks.length}, wallMasks=${wallMasks.length}, ` +
    `hasDepthMaps=${hasDepthMaps}, depthMapCount=${input.depthMaps?.length ?? 0}, usedMidas=${usedMidas}`,
  );

  // Stage 2: Find associated lines for each mask (used by both paths)
  const t1 = Date.now();
  const maskLineAssociations = new Map<string, StructuralLineCandidate[]>();

  for (const mask of [...roofMasks, ...wallMasks]) {
    const associated = input.lines.filter(line => lineOverlapsMask(line, mask));
    maskLineAssociations.set(mask.id, associated);
  }
  timings['line_association'] = Date.now() - t1;

  // ── Depth-augmented path ────────────────────────────────────────────
  if (hasDepthMaps) {
    const tDepth = Date.now();
    const depthArtifacts: Array<RoofPlaneCandidate | WallPlaneCandidate> = [];
    const processedMaskIds = new Set<string>();

    // Safety limit: cap depth maps processed to avoid runaway compute.
    // With 2 photos this is trivial, but protects against future N-photo runs.
    const maxDepthMaps = Math.min(input.depthMaps!.length, 10);
    if (input.depthMaps!.length > maxDepthMaps) {
      console.warn(
        `[PlaneExtraction] Capping depth maps from ${input.depthMaps!.length} to ${maxDepthMaps} to avoid timeout`,
      );
    }

    for (let dmIdx = 0; dmIdx < maxDepthMaps; dmIdx++) {
      const depthMap = input.depthMaps![dmIdx];

      console.info(
        `[PlaneExtraction] Processing depth map ${dmIdx + 1}/${maxDepthMaps}: fileId=${depthMap.fileId}, ` +
        `${depthMap.width}x${depthMap.height}, confidence=${depthMap.confidence}`,
      );

      // Run depth-aware plane extraction
      const depthResult: DepthPlaneExtractionResult = extractDepthPlanes(
        depthMap,
        usedMidas,
        input.config?.depthPlaneOptions,
      );

      console.info(
        `[PlaneExtraction] Depth map ${dmIdx + 1}: ${depthResult.planes.length} depth planes extracted ` +
        `(${depthResult.planes.filter(p => p.orientation === 'slanted').length} slanted, ` +
        `${depthResult.planes.filter(p => p.orientation === 'vertical').length} vertical, ` +
        `${depthResult.planes.filter(p => p.orientation === 'far').length} far, ` +
        `${depthResult.planes.filter(p => p.orientation === 'horizontal').length} horizontal)`,
      );

      // Map depth planes to RoofPlaneCandidate / WallPlaneCandidate
      for (const plane of depthResult.planes) {
        // Skip 'far' (sky) and 'horizontal' (ground) — these are not structural planes
        if (plane.orientation === 'far' || plane.orientation === 'horizontal') continue;

        // Find overlapping heuristic masks for parameter blending
        const overlappingRoofMasks = roofMasks.filter(m => depthPlaneOverlapsMask(plane, m));
        const overlappingWallMasks = wallMasks.filter(m => depthPlaneOverlapsMask(plane, m));

        if (plane.orientation === 'slanted') {
          // ── Roof plane from depth ──────────────────────────────────
          const { slope, aspect, normal } = estimateDepthRoofParameters(
            plane, depthMap.width, depthMap.height,
          );

          // If overlapping heuristic masks exist, blend their parameters
          let finalSlope = slope;
          let finalAspect = aspect;
          let finalNormal: [number, number, number] = normal;
          let heuristicConf = 0;
          let associatedLineIds: string[] = [];
          let sourceMaskId: string | undefined;
          let polygon: NormalizedPoint[] | undefined = plane.boundaryPolygon.length >= 3
            ? plane.boundaryPolygon
            : undefined;

          if (overlappingRoofMasks.length > 0) {
            // Use the best overlapping mask for heuristic blending
            const bestMask = overlappingRoofMasks.reduce((best, m) =>
              m.confidence > best.confidence ? m : best,
            );
            const maskLines = maskLineAssociations.get(bestMask.id) ?? [];
            const heuristicParams = estimateRoofParameters(bestMask, maskLines, input.vanishingPoints);

            // Blend slope and aspect (depth-weighted)
            const blendW = usedMidas ? 0.7 : 0.5;
            finalSlope = Math.round((slope * blendW + heuristicParams.slope * (1 - blendW)) * 10) / 10;
            finalAspect = Math.round((aspect * blendW + heuristicParams.aspect * (1 - blendW)) * 10) / 10;

            // Blend normal vectors
            finalNormal = [
              normal[0] * blendW + heuristicParams.normal[0] * (1 - blendW),
              normal[1] * blendW + heuristicParams.normal[1] * (1 - blendW),
              normal[2] * blendW + heuristicParams.normal[2] * (1 - blendW),
            ];
            const nLen = Math.sqrt(finalNormal[0] ** 2 + finalNormal[1] ** 2 + finalNormal[2] ** 2);
            if (nLen > 1e-10) {
              finalNormal = [finalNormal[0] / nLen, finalNormal[1] / nLen, finalNormal[2] / nLen];
            }

            // Heuristic confidence from line support
            const lineSupport = Math.min(20, maskLines.length * 5);
            heuristicConf = Math.round(Math.min(100, lineSupport + bestMask.confidence * 0.5));
            associatedLineIds = maskLines.map(l => l.id);
            sourceMaskId = bestMask.id;

            // Mark this mask as processed (so heuristic path doesn't duplicate it)
            processedMaskIds.add(bestMask.id);

            // Construct plane boundary from line intersections (architectural truth)
            // Prefer line-constructed polygon over raw depth or mask polygon
            const rawMaskPolygon = bestMask.polygon.length >= 3 ? bestMask.polygon : undefined;
            const lineBoundary = constructPlaneBoundaryFromLines(
              bestMask, maskLines, true, rawMaskPolygon,
            );
            // Enforce architectural truth on the boundary (level ridges/eaves)
            const enforcedBoundary = enforceArchitecturalTruth(lineBoundary, bestMask.segmentationClass);

            if (enforcedBoundary && enforcedBoundary.length >= 3) {
              polygon = enforcedBoundary;
            } else if (bestMask.polygon.length >= 3 && (!polygon || polygon.length < bestMask.polygon.length)) {
              // Fall back to heuristic polygon if line construction failed
              polygon = bestMask.polygon;
            }
          } else {
            // No overlapping mask — try constructing boundary from any associated
            // lines that overlap this depth plane region
            const depthRegion: NormalizedRegion = {
              x: plane.bounds.xMin * 1000,
              y: plane.bounds.yMin * 1000,
              width: (plane.bounds.xMax - plane.bounds.xMin) * 1000,
              height: (plane.bounds.yMax - plane.bounds.yMin) * 1000,
              coordinateSystem: 'normalized_image_0_1000',
            };
            // Use boundary lines whose midpoints fall within the depth region
            const nearbyLines = input.lines.filter(l => {
              const midX = (l.start.x + l.end.x) / 2;
              const midY = (l.start.y + l.end.y) / 2;
              return midX >= depthRegion.x && midX <= depthRegion.x + depthRegion.width &&
                     midY >= depthRegion.y && midY <= depthRegion.y + depthRegion.height &&
                     ROOF_BOUNDARY_LINE_TYPES.includes(l.lineType);
            });
            if (nearbyLines.length >= 2) {
              // Build a synthetic mask polygon from the depth plane bounds for reference
              const syntheticPoly: NormalizedPoint[] = [
                { x: depthRegion.x, y: depthRegion.y, coordinateSystem: 'normalized_image_0_1000' },
                { x: depthRegion.x + depthRegion.width, y: depthRegion.y, coordinateSystem: 'normalized_image_0_1000' },
                { x: depthRegion.x + depthRegion.width, y: depthRegion.y + depthRegion.height, coordinateSystem: 'normalized_image_0_1000' },
                { x: depthRegion.x, y: depthRegion.y + depthRegion.height, coordinateSystem: 'normalized_image_0_1000' },
              ];
              const syntheticMask = { ...roofMasks[0], polygon: syntheticPoly, id: `depth-${plane.id}` };
              const lineBoundary = constructPlaneBoundaryFromLines(
                syntheticMask, nearbyLines, true, syntheticPoly,
              );
              const enforcedBoundary = enforceArchitecturalTruth(lineBoundary, 'roof');
              if (enforcedBoundary && enforcedBoundary.length >= 3) {
                polygon = enforcedBoundary;
              }
            }
          }

          // Compute final confidence: blend depth and heuristic
          const depthConf = plane.confidence;
          const finalConf = overlappingRoofMasks.length > 0
            ? blendConfidence(depthConf, heuristicConf, usedMidas)
            : depthConf;

          if (finalConf < minConfidence) continue;

          // Compute region from depth bounds or polygon
          const region: NormalizedRegion = polygon
            ? polygonBounds(polygon)
            : {
                x: plane.bounds.xMin * 1000,
                y: plane.bounds.yMin * 1000,
                width: (plane.bounds.xMax - plane.bounds.xMin) * 1000,
                height: (plane.bounds.yMax - plane.bounds.yMin) * 1000,
                coordinateSystem: 'normalized_image_0_1000',
              };

          const candidate: RoofPlaneCandidate = {
            artifactType: 'roof_plane_candidate',
            normal: finalNormal,
            d: -(plane.meanDepth * 0.5), // distance from origin (depth-based heuristic)
            inlierCount: plane.pixelIndices.length,
            totalPoints: depthMap.width * depthMap.height,
            region,
            polygon,
            sourceMaskId,
            fileId: depthMap.fileId,
            slopeDegrees: Math.round(finalSlope * 10) / 10,
            aspectDegrees: Math.round(finalAspect * 10) / 10,
            associatedLineIds,
            confidence: finalConf,
            authority: { ...REVIEW_ONLY_AUTHORITY },
            limitations: [...PLANE_EXTRACTION_LIMITATIONS_DEPTH],
          };

          depthArtifacts.push(candidate);

        } else if (plane.orientation === 'vertical') {
          // ── Wall plane from depth ───────────────────────────────────
          const { height, facing, normal } = estimateDepthWallParameters(plane);

          // If overlapping heuristic masks exist, blend their parameters
          let finalHeight = height;
          let finalFacing = facing;
          let finalNormal: [number, number, number] = normal;
          let heuristicConf = 0;
          let associatedLineIds: string[] = [];
          let sourceMaskId: string | undefined;
          let polygon: NormalizedPoint[] | undefined = plane.boundaryPolygon.length >= 3
            ? plane.boundaryPolygon
            : undefined;

          if (overlappingWallMasks.length > 0) {
            const bestMask = overlappingWallMasks.reduce((best, m) =>
              m.confidence > best.confidence ? m : best,
            );
            const maskLines = maskLineAssociations.get(bestMask.id) ?? [];
            const heuristicParams = estimateWallParameters(bestMask, maskLines);

            // Blend height and facing
            const blendW = usedMidas ? 0.7 : 0.5;
            finalHeight = Math.round((height * blendW + heuristicParams.height * (1 - blendW)) * 10) / 10;
            finalFacing = heuristicParams.facing; // heuristic facing is often more reliable

            // Blend normals
            finalNormal = [
              normal[0] * blendW + heuristicParams.normal[0] * (1 - blendW),
              normal[1] * blendW + heuristicParams.normal[1] * (1 - blendW),
              normal[2] * blendW + heuristicParams.normal[2] * (1 - blendW),
            ];
            const nLen = Math.sqrt(finalNormal[0] ** 2 + finalNormal[1] ** 2 + finalNormal[2] ** 2);
            if (nLen > 1e-10) {
              finalNormal = [finalNormal[0] / nLen, finalNormal[1] / nLen, finalNormal[2] / nLen];
            }

            // Heuristic confidence
            const lineSupport = Math.min(20, maskLines.length * 5);
            heuristicConf = Math.round(Math.min(100, lineSupport + bestMask.confidence * 0.5));
            associatedLineIds = maskLines.map(l => l.id);
            sourceMaskId = bestMask.id;

            processedMaskIds.add(bestMask.id);

            // Construct plane boundary from line intersections (architectural truth)
            const rawMaskPolygon = bestMask.polygon.length >= 3 ? bestMask.polygon : undefined;
            const lineBoundary = constructPlaneBoundaryFromLines(
              bestMask, maskLines, false, rawMaskPolygon,
            );
            // Enforce architectural truth (level sills/gutters, vertical edges)
            const enforcedBoundary = enforceArchitecturalTruth(lineBoundary, bestMask.segmentationClass);

            if (enforcedBoundary && enforcedBoundary.length >= 3) {
              polygon = enforcedBoundary;
            } else if (bestMask.polygon.length >= 3 && (!polygon || polygon.length < bestMask.polygon.length)) {
              polygon = bestMask.polygon;
            }
          }

          // Compute final confidence
          const depthConf = plane.confidence;
          const finalConf = overlappingWallMasks.length > 0
            ? blendConfidence(depthConf, heuristicConf, usedMidas)
            : depthConf;

          if (finalConf < minConfidence) continue;

          const region: NormalizedRegion = polygon
            ? polygonBounds(polygon)
            : {
                x: plane.bounds.xMin * 1000,
                y: plane.bounds.yMin * 1000,
                width: (plane.bounds.xMax - plane.bounds.xMin) * 1000,
                height: (plane.bounds.yMax - plane.bounds.yMin) * 1000,
                coordinateSystem: 'normalized_image_0_1000',
              };

          const candidate: WallPlaneCandidate = {
            artifactType: 'wall_plane_candidate',
            normal: finalNormal,
            d: -(plane.meanDepth * 0.3),
            inlierCount: plane.pixelIndices.length,
            totalPoints: depthMap.width * depthMap.height,
            region,
            polygon,
            sourceMaskId,
            fileId: depthMap.fileId,
            estimatedHeightM: Math.round(finalHeight * 10) / 10,
            facingDirection: finalFacing,
            associatedLineIds,
            confidence: finalConf,
            authority: { ...REVIEW_ONLY_AUTHORITY },
            limitations: [...PLANE_EXTRACTION_LIMITATIONS_DEPTH],
          };

          depthArtifacts.push(candidate);
        }
      }
    }

    artifacts.push(...depthArtifacts);
    timings['depth_extraction'] = Date.now() - tDepth;

    console.info(
      `[PlaneExtraction] Depth-augmented path: ${depthArtifacts.length} depth-derived planes ` +
      `(${depthArtifacts.filter(a => a.artifactType === 'roof_plane_candidate').length} roof, ` +
      `${depthArtifacts.filter(a => a.artifactType === 'wall_plane_candidate').length} wall) ` +
      `in ${timings['depth_extraction']}ms, processedMaskIds=${processedMaskIds.size}`,
    );

    // ── Heuristic fallback for unprocessed masks ────────────────────────
    // Any roof/wall mask that wasn't matched to a depth plane still gets
    // the heuristic treatment. This ensures coverage when depth misses a
    // region that segmentation clearly identified.
    const unprocessedRoofMasks = roofMasks.filter(m => !processedMaskIds.has(m.id));
    const unprocessedWallMasks = wallMasks.filter(m => !processedMaskIds.has(m.id));

    if (unprocessedRoofMasks.length > 0 || unprocessedWallMasks.length > 0) {
      const tHeuristicFallback = Date.now();
      const heuristicArtifacts = runHeuristicExtraction(
        unprocessedRoofMasks,
        unprocessedWallMasks,
        input.lines,
        input.vanishingPoints,
        maskLineAssociations,
        minConfidence,
        requireSupportingLines,
      );
      artifacts.push(...heuristicArtifacts);
      timings['heuristic_fallback'] = Date.now() - tHeuristicFallback;
    }

  } else {
    // ── Heuristic-only path (no depth maps available) ──────────────────
    const tHeuristic = Date.now();
    const heuristicArtifacts = runHeuristicExtraction(
      roofMasks,
      wallMasks,
      input.lines,
      input.vanishingPoints,
      maskLineAssociations,
      minConfidence,
      requireSupportingLines,
    );
    artifacts.push(...heuristicArtifacts);
    timings['heuristic_extraction'] = Date.now() - tHeuristic;
  }

  console.info(
    `[PlaneExtraction] Complete: ${artifacts.length} total planes ` +
    `(${artifacts.filter(a => a.artifactType === 'roof_plane_candidate').length} roof, ` +
    `${artifacts.filter(a => a.artifactType === 'wall_plane_candidate').length} wall) ` +
    `timings={${Object.entries(timings).map(([k,v]) => `${k}=${v}ms`).join(', ')}}`,
  );

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: PLANE_EXTRACTION_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Heuristic extraction (extracted from v1 main function)
// ---------------------------------------------------------------------------

/**
 * Run heuristic plane extraction on a set of roof and wall masks.
 * This is the original v1 logic, extracted into a helper so the main
 * worker can call it for unprocessed masks when depth is available,
 * or as the sole path when depth is absent.
 */
function runHeuristicExtraction(
  roofMasks: SemanticSegmentationMask[],
  wallMasks: SemanticSegmentationMask[],
  lines: StructuralLineCandidate[],
  vanishingPoints: VanishingPointArtifact[],
  maskLineAssociations: Map<string, StructuralLineCandidate[]>,
  minConfidence: number,
  requireSupportingLines: boolean,
): Array<RoofPlaneCandidate | WallPlaneCandidate> {
  const artifacts: Array<RoofPlaneCandidate | WallPlaneCandidate> = [];

  // Extract roof planes
  for (const mask of roofMasks) {
    const associatedLines = maskLineAssociations.get(mask.id) ?? [];

    if (requireSupportingLines && associatedLines.length === 0) continue;

    const { slope, aspect, normal } = estimateRoofParameters(mask, associatedLines, vanishingPoints);

    // Compute confidence
    const lineSupport = Math.min(20, associatedLines.length * 5);
    const maskConf = mask.confidence * 0.5;
    const confidence = Math.round(Math.min(100, lineSupport + maskConf));

    if (confidence < minConfidence) continue;

    // Construct plane boundary from line intersections (architectural truth)
    const rawMaskPolygon = mask.polygon.length >= 3 ? mask.polygon : undefined;
    const lineBoundary = constructPlaneBoundaryFromLines(
      mask, associatedLines, true, rawMaskPolygon,
    );
    // Enforce architectural truth (level ridges/eaves, vertical rakes)
    const polygon = enforceArchitecturalTruth(lineBoundary, mask.segmentationClass);

    const region = polygonBounds(polygon ?? mask.polygon);

    const candidate: RoofPlaneCandidate = {
      artifactType: 'roof_plane_candidate',
      normal,
      d: -0.5, // distance from origin (heuristic)
      inlierCount: associatedLines.length,
      totalPoints: lines.length,
      region,
      polygon,
      sourceMaskId: mask.id,
      fileId: mask.fileId,
      slopeDegrees: Math.round(slope * 10) / 10,
      aspectDegrees: Math.round(aspect * 10) / 10,
      associatedLineIds: associatedLines.map(l => l.id),
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...PLANE_EXTRACTION_LIMITATIONS],
    };

    artifacts.push(candidate);
  }

  // Extract wall planes
  for (const mask of wallMasks) {
    const associatedLines = maskLineAssociations.get(mask.id) ?? [];

    if (requireSupportingLines && associatedLines.length === 0) continue;

    const { height, facing, normal } = estimateWallParameters(mask, associatedLines);

    // Compute confidence
    const lineSupport = Math.min(20, associatedLines.length * 5);
    const maskConf = mask.confidence * 0.5;
    const confidence = Math.round(Math.min(100, lineSupport + maskConf));

    if (confidence < minConfidence) continue;

    // Construct plane boundary from line intersections (architectural truth)
    const rawMaskPolygon = mask.polygon.length >= 3 ? mask.polygon : undefined;
    const lineBoundary = constructPlaneBoundaryFromLines(
      mask, associatedLines, false, rawMaskPolygon,
    );
    // Enforce architectural truth (level sills/gutters, vertical edges)
    const polygon = enforceArchitecturalTruth(lineBoundary, mask.segmentationClass);

    const region = polygonBounds(polygon ?? mask.polygon);

    const candidate: WallPlaneCandidate = {
      artifactType: 'wall_plane_candidate',
      normal,
      d: -0.3, // distance from origin (heuristic)
      inlierCount: associatedLines.length,
      totalPoints: lines.length,
      region,
      polygon,
      sourceMaskId: mask.id,
      fileId: mask.fileId,
      estimatedHeightM: Math.round(height * 10) / 10,
      facingDirection: facing,
      associatedLineIds: associatedLines.map(l => l.id),
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...PLANE_EXTRACTION_LIMITATIONS],
    };

    artifacts.push(candidate);
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing artifacts
// ---------------------------------------------------------------------------

/**
 * Run plane extraction from a standard GeometryReconstructionInput
 * and pre-computed segmentation masks, lines, vanishing points,
 * and optional depth maps.
 *
 * When depth maps are provided, uses depth-augmented extraction.
 * Otherwise falls back to heuristic-only extraction.
 *
 * Returns RoofPlaneCandidate and WallPlaneCandidate artifacts.
 */
export function runPlaneExtractionFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
  lines: StructuralLineCandidate[],
  vanishingPoints: VanishingPointArtifact[],
  depthMaps?: DepthMap[],
  usedMidas?: boolean,
): GeometryReconstructionArtifact[] {
  const workerInput: PlaneExtractionWorkerInput = {
    surveyId: input.surveyId,
    masks,
    lines,
    vanishingPoints,
    depthMaps,
    usedMidas,
    config: input.config as PlaneExtractionWorkerInput['config'] | undefined,
  };

  const output = runPlaneExtractionWorker(workerInput);
  return output.artifacts;
}
