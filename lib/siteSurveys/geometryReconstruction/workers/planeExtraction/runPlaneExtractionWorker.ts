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
function lineOverlapsMask(_line: StructuralLineCandidate, _mask: SemanticSegmentationMask): boolean {
  throw new Error(
    `NOT_IMPLEMENTED: lineOverlapsMask(). ` +
    `Heuristic line-mask overlap detection has been removed. Awaiting real plane fitting algorithm integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
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
  _mask: SemanticSegmentationMask,
  _associatedLines: StructuralLineCandidate[],
  _vanishingPoints: VanishingPointArtifact[],
): { slope: number; aspect: number; normal: [number, number, number] } {
  throw new Error(
    `NOT_IMPLEMENTED: estimateRoofParameters(). ` +
    `Heuristic roof plane parameter estimation has been removed. Awaiting real plane fitting algorithm (e.g., RANSAC on depth data) integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
}

/**
 * Estimate a wall plane's height and facing direction from its
 * associated lines and mask extent.
 */
function estimateWallParameters(
  _mask: SemanticSegmentationMask,
  _associatedLines: StructuralLineCandidate[],
): { height: number; facing: string; normal: [number, number, number] } {
  throw new Error(
    `NOT_IMPLEMENTED: estimateWallParameters(). ` +
    `Heuristic wall plane parameter estimation has been removed. Awaiting real plane fitting algorithm integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
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
