/**
 * Vanishing point estimation worker — produces VanishingPointArtifact
 * artifacts from structural line candidates using RANSAC-based estimation.
 *
 * Approach:
 * 1. Group lines by likely vanishing direction (X, Y, vertical)
 *    based on their angle and type
 * 2. For each direction, use RANSAC to find the intersection point
 *    that maximizes inlier support
 * 3. Estimate confidence from inlier ratio and supporting line count
 *
 * When a real perspective estimation model is available, this worker
 * will be upgraded. The current heuristic approach ensures the pipeline
 * never breaks when models are unavailable.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  StructuralLineCandidate,
  VanishingPointArtifact,
  NormalizedPoint,
  GeometryReconstructionArtifact,
  GeometryReconstructionInput,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';
import { validateVanishingPointArtifact } from '../../schemas';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const VANISHING_POINT_WORKER_VERSION = '1.0.0-vanishing-point-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const VANISHING_POINT_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Vanishing point estimation is heuristic RANSAC — not from a trained perspective model.',
  'When a real perspective estimation model is available, this worker will be upgraded.',
  'Vanishing point positions are approximations with limited precision.',
  'Supporting line counts may not reflect true geometric structure.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the vanishing point estimation worker. */
export interface VanishingPointWorkerInput {
  surveyId: string;
  /** Structural line candidates to estimate vanishing points from. */
  lines: StructuralLineCandidate[];
  /** Optional config overrides. */
  config?: {
    /** Number of RANSAC iterations. Default: 100 */
    ransacIterations?: number;
    /** Inlier threshold in normalized units. Default: 30 */
    inlierThreshold?: number;
    /** Minimum number of supporting lines for a valid VP. Default: 2 */
    minSupportingLines?: number;
    /** Minimum confidence threshold (0-100). Default: 20 */
    minConfidence?: number;
  };
}

/** Output of the vanishing point estimation worker. */
export interface VanishingPointWorkerOutput {
  artifacts: VanishingPointArtifact[];
  stageTimings: Record<string, number>;
  workerVersion: string;
}

/** Internal: a line in homogeneous coordinates for intersection computation. */
interface LineHomo {
  a: number;
  b: number;
  c: number; // ax + by + c = 0
  lineId: string;
  direction: 'x' | 'y' | 'vertical';
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * Convert a StructuralLineCandidate to homogeneous line representation.
 * Line through two points (x1,y1) and (x2,y2):
 *   (y1-y2)x + (x2-x1)y + (x1*y2 - x2*y1) = 0
 */
function lineToHomogeneous(line: StructuralLineCandidate): LineHomo {
  const { start, end } = line;
  return {
    a: start.y - end.y,
    b: end.x - start.x,
    c: start.x * end.y - end.x * start.y,
    lineId: line.id,
    direction: guessDirection(line),
  };
}

/**
 * Intersect two lines in homogeneous coordinates.
 * Returns the intersection point, or null if lines are parallel.
 */
function intersectLines(l1: LineHomo, l2: LineHomo): NormalizedPoint | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-10) return null; // parallel lines

  const x = (l1.b * l2.c - l2.b * l1.c) / det;
  const y = (l2.a * l1.c - l1.a * l2.c) / det;

  return { x, y, coordinateSystem: 'normalized_image_0_1000' };
}

/**
 * Distance from a point to a line (in normalized units).
 */
function pointToLineDistance(point: NormalizedPoint, line: LineHomo): number {
  const denom = Math.sqrt(line.a * line.a + line.b * line.b);
  if (denom < 1e-10) return Infinity;
  return Math.abs(line.a * point.x + line.b * point.y + line.c) / denom;
}

/**
 * Guess the likely vanishing direction of a structural line
 * based on its type and orientation.
 */
function guessDirection(line: StructuralLineCandidate): 'x' | 'y' | 'vertical' {
  // Classify by line type first (most reliable signal)
  switch (line.lineType) {
    case 'ridge':
      // Ridges are typically horizontal lines running left-right → X direction
      return 'x';
    case 'eave':
      // Eaves are typically horizontal lines running left-right → X direction
      // However, eaves can also be depth-direction lines in perspective views
      // Use orientation to disambiguate
      return 'y';
    case 'rake':
      // Rakes are diagonal lines; they tend to be in the Y direction
      // (going away from the viewer toward the ridge)
      return 'y';
    case 'wall_vertical':
      return 'vertical';
    default:
      // Fallback: use angle-based heuristic
      break;
  }

  // Angle-based fallback for unknown line types
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const angleDeg = Math.atan2(-dy, dx) * (180 / Math.PI); // screen coords

  // Normalize to [0, 180)
  let normAngle = angleDeg % 180;
  if (normAngle < 0) normAngle += 180;

  if (normAngle < 30 || normAngle > 150) {
    return 'x'; // near-horizontal
  } else if (normAngle > 60 && normAngle < 120) {
    return 'vertical'; // near-vertical
  } else {
    return 'y'; // diagonal
  }
}

// ---------------------------------------------------------------------------
// RANSAC vanishing point estimation
// ---------------------------------------------------------------------------

/**
 * RANSAC-based vanishing point estimation for a set of lines
 * in the same direction group.
 *
 * Randomly samples pairs of lines, computes their intersection,
 * and selects the intersection with the most inlier support.
 */
function ransacVanishingPoint(
  lines: LineHomo[],
  iterations: number,
  inlierThreshold: number,
): { point: NormalizedPoint; inlierIds: string[]; inlierRatio: number } | null {
  if (lines.length < 2) return null;

  let bestPoint: NormalizedPoint | null = null;
  let bestInlierIds: string[] = [];
  let bestInlierCount = 0;

  // Use a deterministic seed for reproducibility
  // Simple LCG PRNG seeded by the line IDs for determinism
  let seed = 0;
  for (const line of lines) {
    for (let i = 0; i < line.lineId.length; i++) {
      seed = (seed * 31 + line.lineId.charCodeAt(i)) | 0;
    }
  }
  function nextRandom(): number {
    seed = (seed * 1103515245 + 12345) | 0;
    return ((seed >>> 0) % 1000000) / 1000000;
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Pick two random lines
    const idx1 = Math.floor(nextRandom() * lines.length);
    let idx2 = Math.floor(nextRandom() * lines.length);
    // Ensure we pick different lines
    let attempts = 0;
    while (idx2 === idx1 && attempts < 10) {
      idx2 = Math.floor(nextRandom() * lines.length);
      attempts++;
    }
    if (idx2 === idx1) continue;

    const l1 = lines[idx1];
    const l2 = lines[idx2];

    // Compute intersection
    const intersection = intersectLines(l1, l2);
    if (intersection === null) continue; // parallel lines

    // Count inliers: lines whose distance to the intersection point is below threshold
    const inlierIds: string[] = [];
    for (const line of lines) {
      const dist = pointToLineDistance(intersection, line);
      if (dist <= inlierThreshold) {
        inlierIds.push(line.lineId);
      }
    }

    if (inlierIds.length > bestInlierCount) {
      bestInlierCount = inlierIds.length;
      bestInlierIds = inlierIds;
      bestPoint = intersection;
    }
  }

  if (bestPoint === null || bestInlierCount < 2) {
    return null;
  }

  const inlierRatio = bestInlierCount / lines.length;

  return {
    point: bestPoint,
    inlierIds: bestInlierIds,
    inlierRatio,
  };
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the vanishing point estimation worker on a set of structural lines.
 *
 * Groups lines by estimated vanishing direction, runs RANSAC for each
 * direction, and produces VanishingPointArtifact results.
 */
export function estimateVanishingPoints(input: VanishingPointWorkerInput): VanishingPointWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: VanishingPointArtifact[] = [];

  const ransacIterations = input.config?.ransacIterations ?? 100;
  const inlierThreshold = input.config?.inlierThreshold ?? 30;
  const minSupportingLines = input.config?.minSupportingLines ?? 2;
  const minConfidence = input.config?.minConfidence ?? 20;

  // Stage 1: Initialize
  const t0 = Date.now();
  if (input.lines.length < 2) {
    timings['initialization'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: VANISHING_POINT_WORKER_VERSION,
    };
  }
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Convert lines to homogeneous representation
  const t1 = Date.now();
  const homoLines = input.lines.map(lineToHomogeneous);
  timings['line_conversion'] = Date.now() - t1;

  // Stage 3: Group by direction
  const t2 = Date.now();
  const directionGroups = new Map<'x' | 'y' | 'vertical', LineHomo[]>();
  for (const line of homoLines) {
    if (!directionGroups.has(line.direction)) {
      directionGroups.set(line.direction, []);
    }
    directionGroups.get(line.direction)!.push(line);
  }
  timings['direction_grouping'] = Date.now() - t2;

  // Stage 4: RANSAC for each direction
  const t3 = Date.now();
  const directions: Array<'x' | 'y' | 'vertical'> = ['x', 'y', 'vertical'];
  for (const direction of directions) {
    const group = directionGroups.get(direction);
    if (!group || group.length < minSupportingLines) continue;

    const result = ransacVanishingPoint(group, ransacIterations, inlierThreshold);
    if (result === null) continue;

    // Compute confidence based on inlier ratio and supporting line count
    const lineCountBonus = Math.min(15, result.inlierIds.length * 3);
    const ratioScore = result.inlierRatio * 70;
    const confidence = Math.round(Math.min(100, ratioScore + lineCountBonus));

    if (confidence < minConfidence) continue;

    // Clamp the VP point to reasonable bounds for display
    const clampedPoint: NormalizedPoint = {
      x: Math.max(-500, Math.min(1500, result.point.x)),
      y: Math.max(-500, Math.min(1500, result.point.y)),
      coordinateSystem: 'normalized_image_0_1000',
    };

    const artifact: VanishingPointArtifact = {
      artifactType: 'vanishing_point',
      id: `vp-${direction}-${input.surveyId}`,
      fileId: input.lines[0].fileId, // Use first line's fileId as reference
      direction,
      point: clampedPoint,
      supportingLineCount: result.inlierIds.length,
      supportingLineIds: result.inlierIds,
      inlierRatio: Math.round(result.inlierRatio * 100) / 100,
      confidence,
      workerVersion: VANISHING_POINT_WORKER_VERSION,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...VANISHING_POINT_LIMITATIONS],
    };

    // Validate before including
    const validationResult = validateVanishingPointArtifact(artifact);
    if (validationResult.valid) {
      artifacts.push(validationResult.data);
    }
  }
  timings['ransac_estimation'] = Date.now() - t3;

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: VANISHING_POINT_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing lines
// ---------------------------------------------------------------------------

/**
 * Run vanishing point estimation from a standard GeometryReconstructionInput
 * and a set of already-computed structural line candidates.
 *
 * Returns VanishingPointArtifact artifacts.
 */
export function estimateVanishingPointsFromReconstructionInput(
  input: GeometryReconstructionInput,
  lines: StructuralLineCandidate[],
): GeometryReconstructionArtifact[] {
  const workerInput: VanishingPointWorkerInput = {
    surveyId: input.surveyId,
    lines,
    config: input.config as VanishingPointWorkerInput['config'] | undefined,
  };

  const output = estimateVanishingPoints(workerInput);
  return output.artifacts;
}
