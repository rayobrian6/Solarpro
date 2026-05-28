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
  const bounds = polygonBounds(mask.polygon);
  // Quick bounding box check
  const lineMinX = Math.min(line.start.x, line.end.x);
  const lineMaxX = Math.max(line.start.x, line.end.x);
  const lineMinY = Math.min(line.start.y, line.end.y);
  const lineMaxY = Math.max(line.start.y, line.end.y);

  const boundsMaxX = bounds.x + bounds.width;
  const boundsMaxY = bounds.y + bounds.height;

  if (lineMaxX < bounds.x || lineMinX > boundsMaxX ||
      lineMaxY < bounds.y || lineMinY > boundsMaxY) {
    return false;
  }

  // More precise: check if line endpoints are near the polygon
  const threshold = 50; // normalized units
  const startDist = Math.min(...mask.polygon.map(p => pointToSegmentDist(line.start, p, line.end)));
  const endDist = Math.min(...mask.polygon.map(p => pointToSegmentDist(line.end, p, line.start)));

  // Or check if the line midpoint is inside the polygon
  const midX = (line.start.x + line.end.x) / 2;
  const midY = (line.start.y + line.end.y) / 2;
  const midPoint: NormalizedPoint = { x: midX, y: midY, coordinateSystem: 'normalized_image_0_1000' };
  if (pointInPolygon(midPoint, mask.polygon)) return true;

  return startDist < threshold || endDist < threshold;
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
  // Default values
  let slope = 25; // degrees, typical residential roof
  let aspect = 180; // degrees, south-facing default
  const normal: [number, number, number] = [0, -0.42, 0.91]; // approx 25° slope

  // Find ridge lines to determine axis
  const ridges = associatedLines.filter(l => l.lineType === 'ridge');
  const rakes = associatedLines.filter(l => l.lineType === 'rake');

  if (ridges.length > 0) {
    // Ridge direction determines aspect
    const ridge = ridges[0];
    const dx = ridge.end.x - ridge.start.x;
    const dy = ridge.end.y - ridge.start.y;
    const ridgeAngle = Math.atan2(-dy, dx) * (180 / Math.PI);
    // Aspect is perpendicular to ridge, pointing "downhill"
    aspect = (ridgeAngle + 90 + 360) % 360;
  }

  if (rakes.length > 0) {
    // Rake angle gives slope estimate
    const rake = rakes[0];
    const dx = rake.end.x - rake.start.x;
    const dy = rake.end.y - rake.start.y;
    const rakeAngle = Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI);
    // In a perspective image, the rake angle relates to slope
    // (simplified heuristic: steeper rake = steeper roof)
    slope = Math.max(10, Math.min(60, rakeAngle * 0.8));
  }

  // Check vanishing points for consistency
  const xVp = vanishingPoints.find(vp => vp.direction === 'x');
  const yVp = vanishingPoints.find(vp => vp.direction === 'y');
  if (xVp && yVp) {
    // VPs can refine the aspect estimate
    const vpAngle = Math.atan2(yVp.point.y - xVp.point.y, xVp.point.x - yVp.point.x) * (180 / Math.PI);
    // Blend with line-based estimate
    aspect = (aspect + (vpAngle + 360) % 360) / 2;
  }

  // Compute normal vector from slope and aspect
  const slopeRad = slope * (Math.PI / 180);
  const aspectRad = aspect * (Math.PI / 180);
  normal[0] = Math.sin(slopeRad) * Math.cos(aspectRad);
  normal[1] = Math.sin(slopeRad) * Math.sin(aspectRad);
  normal[2] = Math.cos(slopeRad);

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
  // Default values
  let height = 4; // meters, typical residential wall
  let facing = 'south';
  const normal: [number, number, number] = [0, -1, 0]; // south-facing

  // Use mask height as a proportional estimate
  const bounds = polygonBounds(mask.polygon);
  // In normalized coords, 1000 = full image height
  // Assume image covers ~10m of house, so 1 unit ≈ 0.01m
  const estimatedHeight = bounds.height * 0.01;
  height = Math.max(2, Math.min(10, estimatedHeight));

  // Determine facing from wall vertical lines
  const vertLines = associatedLines.filter(l => l.lineType === 'wall_vertical');
  if (vertLines.length > 0) {
    // Check which side of the image the wall is on
    const avgX = vertLines.reduce((s, l) => s + (l.start.x + l.end.x) / 2, 0) / vertLines.length;
    if (avgX < 300) facing = 'west';
    else if (avgX > 700) facing = 'east';
    else if (mask.polygon[0].y > 400) facing = 'south';
    else facing = 'north';
  }

  // Compute normal from facing
  const facingDirs: Record<string, [number, number, number]> = {
    north: [0, 1, 0],
    south: [0, -1, 0],
    east: [1, 0, 0],
    west: [-1, 0, 0],
  };
  if (facingDirs[facing]) {
    normal[0] = facingDirs[facing][0];
    normal[1] = facingDirs[facing][1];
    normal[2] = facingDirs[facing][2];
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
