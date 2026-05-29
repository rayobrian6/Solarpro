/**
 * Plane extraction worker — produces RoofPlaneCandidate and WallPlaneCandidate
 * artifacts from segmentation masks, structural lines, and vanishing points.
 *
 * Approach:
 * 1. Group segmentation masks by class (roof, wall)
 * 2. For each mask, find supporting lines that overlap with the mask region
 * 3. Estimate plane normal from vanishing point directions and line orientations
 * 4. Compute plane parameters (slope, aspect for roofs; height, facing for walls)
 * 5. Assign confidence based on line support, mask quality, and VP consistency
 *
 * When a real plane fitting algorithm (e.g., RANSAC on depth data) is
 * available, this worker will be upgraded. The current heuristic approach
 * ensures the pipeline never breaks when models are unavailable.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  VanishingPointArtifact,
  RoofPlaneCandidate,
  WallPlaneCandidate,
  NormalizedPoint,
  GeometryReconstructionArtifact,
  GeometryReconstructionInput,
  NormalizedRegion,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const PLANE_EXTRACTION_WORKER_VERSION = '1.0.0-plane-extraction-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const PLANE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Plane extraction is heuristic — not from RANSAC on depth data or model inference.',
  'When a real plane fitting algorithm is available, this worker will be upgraded.',
  'Plane normals are estimated from line orientations, not from 3D measurements.',
  'Slope and aspect are approximations based on heuristic geometry.',
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
  /** Optional config overrides. */
  config?: {
    /** Minimum confidence threshold for planes (0-100). Default: 25 */
    minConfidence?: number;
    /** Whether to require supporting lines for plane extraction. Default: false */
    requireSupportingLines?: boolean;
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
// Plane parameter estimation
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
 * structural lines, and vanishing points.
 *
 * For each roof/wall mask, finds supporting lines, estimates plane
 * parameters, and produces RoofPlaneCandidate or WallPlaneCandidate artifacts.
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
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Find associated lines for each mask
  const t1 = Date.now();
  const maskLineAssociations = new Map<string, StructuralLineCandidate[]>();

  for (const mask of [...roofMasks, ...wallMasks]) {
    const associated = input.lines.filter(line => lineOverlapsMask(line, mask));
    maskLineAssociations.set(mask.id, associated);
  }
  timings['line_association'] = Date.now() - t1;

  // Stage 3: Extract roof planes
  const t2 = Date.now();
  let roofIndex = 0;
  for (const mask of roofMasks) {
    const associatedLines = maskLineAssociations.get(mask.id) ?? [];

    if (requireSupportingLines && associatedLines.length === 0) continue;

    const { slope, aspect, normal } = estimateRoofParameters(mask, associatedLines, input.vanishingPoints);

    // Compute confidence
    const lineSupport = Math.min(20, associatedLines.length * 5);
    const maskConf = mask.confidence * 0.5;
    const confidence = Math.round(Math.min(100, lineSupport + maskConf));

    if (confidence < minConfidence) continue;

    const region = polygonBounds(mask.polygon);

    const candidate: RoofPlaneCandidate = {
      artifactType: 'roof_plane_candidate',
      normal,
      d: -0.5, // distance from origin (heuristic)
      inlierCount: associatedLines.length,
      totalPoints: input.lines.length,
      region,
      slopeDegrees: Math.round(slope * 10) / 10,
      aspectDegrees: Math.round(aspect * 10) / 10,
      associatedLineIds: associatedLines.map(l => l.id),
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...PLANE_EXTRACTION_LIMITATIONS],
    };

    artifacts.push(candidate);
    roofIndex++;
  }
  timings['roof_extraction'] = Date.now() - t2;

  // Stage 4: Extract wall planes
  const t3 = Date.now();
  let wallIndex = 0;
  for (const mask of wallMasks) {
    const associatedLines = maskLineAssociations.get(mask.id) ?? [];

    if (requireSupportingLines && associatedLines.length === 0) continue;

    const { height, facing, normal } = estimateWallParameters(mask, associatedLines);

    // Compute confidence
    const lineSupport = Math.min(20, associatedLines.length * 5);
    const maskConf = mask.confidence * 0.5;
    const confidence = Math.round(Math.min(100, lineSupport + maskConf));

    if (confidence < minConfidence) continue;

    const region = polygonBounds(mask.polygon);

    const candidate: WallPlaneCandidate = {
      artifactType: 'wall_plane_candidate',
      normal,
      d: -0.3, // distance from origin (heuristic)
      inlierCount: associatedLines.length,
      totalPoints: input.lines.length,
      region,
      estimatedHeightM: Math.round(height * 10) / 10,
      facingDirection: facing,
      associatedLineIds: associatedLines.map(l => l.id),
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...PLANE_EXTRACTION_LIMITATIONS],
    };

    artifacts.push(candidate);
    wallIndex++;
  }
  timings['wall_extraction'] = Date.now() - t3;

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: PLANE_EXTRACTION_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing artifacts
// ---------------------------------------------------------------------------

/**
 * Run plane extraction from a standard GeometryReconstructionInput
 * and pre-computed segmentation masks, lines, and vanishing points.
 *
 * Returns RoofPlaneCandidate and WallPlaneCandidate artifacts.
 */
export function runPlaneExtractionFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
  lines: StructuralLineCandidate[],
  vanishingPoints: VanishingPointArtifact[],
): GeometryReconstructionArtifact[] {
  const workerInput: PlaneExtractionWorkerInput = {
    surveyId: input.surveyId,
    masks,
    lines,
    vanishingPoints,
    config: input.config as PlaneExtractionWorkerInput['config'] | undefined,
  };

  const output = runPlaneExtractionWorker(workerInput);
  return output.artifacts;
}
