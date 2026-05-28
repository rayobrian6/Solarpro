/**
 * Depth estimation worker — produces DepthMap artifacts from segmentation
 * masks and vanishing points using heuristic depth estimation.
 *
 * Approach:
 * 1. For each source photo, use segmentation masks to determine depth ordering
 *    (sky is far, ground is near, roof/wall are mid-range)
 * 2. Use vanishing points to estimate relative depth gradients within each region
 * 3. Generate a coarse depth map grid
 *
 * When a real depth estimation model (e.g., MiDaS, DPT) is available,
 * this worker will be upgraded. The current heuristic approach ensures the
 * pipeline never breaks when models are unavailable.
 *
 * IMPORTANT: Depth is a SUPPORT signal only — it does NOT override
 * segmentation-driven geometry. It provides supplementary depth cues
 * that downstream consumers can use for validation.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SemanticSegmentationMask,
  VanishingPointArtifact,
  DepthMap,
  GeometryReconstructionArtifact,
  GeometryReconstructionInput,
  NormalizedPoint,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const DEPTH_WORKER_VERSION = '1.0.0-depth-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const DEPTH_WORKER_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Depth estimation is heuristic — not from a trained depth model (MiDaS/DPT).',
  'When a real depth model is available, this worker will be upgraded.',
  'Depth values are relative and approximate — not metric depth measurements.',
  'Depth is a SUPPORT signal only — it must NOT override segmentation-driven geometry.',
  'Depth ordering is based on semantic class priors, not geometric inference.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the depth estimation worker. */
export interface DepthWorkerInput {
  surveyId: string;
  /** Source file ID to estimate depth for. */
  fileId: string;
  /** Segmentation masks for this photo. */
  masks: SemanticSegmentationMask[];
  /** Vanishing points for this photo. */
  vanishingPoints: VanishingPointArtifact[];
  /** Optional config overrides. */
  config?: {
    /** Grid resolution (width × height). Default: 64 */
    gridResolution?: number;
    /** Minimum confidence threshold (0-100). Default: 20 */
    minConfidence?: number;
  };
}

/** Output of the depth estimation worker. */
export interface DepthWorkerOutput {
  artifacts: DepthMap[];
  stageTimings: Record<string, number>;
  workerVersion: string;
}

// ---------------------------------------------------------------------------
// Depth heuristic
// ---------------------------------------------------------------------------

/**
 * Semantic class depth priors (normalized 0-1, 0=near, 1=far).
 * These are coarse approximations for typical rooftop photos.
 */
const CLASS_DEPTH_PRIOR: Record<string, number> = {
  sky: 0.95,
  tree: 0.7,
  roof: 0.5,
  wall: 0.4,
  equipment: 0.3,
  obstruction: 0.35,
  ground: 0.15,
};

/**
 * Check if a point is inside a polygon (ray casting).
 */
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

/**
 * Determine the semantic class at a given point by checking which mask
 * contains the point. Returns the class with highest confidence if
 * multiple masks overlap.
 */
function classAtPoint(
  point: NormalizedPoint,
  masks: SemanticSegmentationMask[],
): string | null {
  let bestClass: string | null = null;
  let bestConf = -1;

  for (const mask of masks) {
    if (pointInPolygon(point, mask.polygon)) {
      if (mask.confidence > bestConf) {
        bestConf = mask.confidence;
        bestClass = mask.segmentationClass;
      }
    }
  }

  return bestClass;
}

/**
 * Compute a heuristic depth value for a grid cell.
 * Uses semantic class priors and a vertical gradient (higher = farther
 * in typical rooftop photos).
 */
function heuristicDepth(
  x: number, // 0-1000
  y: number, // 0-1000
  masks: SemanticSegmentationMask[],
  vanishingPoints: VanishingPointArtifact[],
): number {
  // Check if point is inside any mask
  const point: NormalizedPoint = { x, y, coordinateSystem: 'normalized_image_0_1000' };
  const semanticClass = classAtPoint(point, masks);

  // Base depth from semantic class
  let depth = semanticClass ? (CLASS_DEPTH_PRIOR[semanticClass] ?? 0.5) : 0.5;

  // Apply vertical gradient: things higher in the image (lower y) are generally farther
  // This is a weak signal — only applies if no mask covers the point
  if (semanticClass === null) {
    const verticalGradient = 1 - (y / 1000); // 0 at bottom, 1 at top
    depth = 0.3 + verticalGradient * 0.4; // range 0.3-0.7
  }

  // Vanishing point modulation: distance from VP affects depth
  // Points farther from a VP are closer to the viewer
  for (const vp of vanishingPoints) {
    if (vp.direction === 'vertical') {
      // Vertical VP: distance from VP affects depth
      const dx = x - vp.point.x;
      const dy = y - vp.point.y;
      const distFromVP = Math.sqrt(dx * dx + dy * dy);
      // Points closer to vertical VP are farther away
      const vpInfluence = Math.max(0, 1 - distFromVP / 1500) * 0.1;
      depth = Math.min(1, depth + vpInfluence);
    }
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, depth));
}

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/**
 * Generate a depth map grid by sampling heuristic depth at regular intervals.
 * The grid is stored as a Float32Array (row-major).
 */
function generateDepthGrid(
  resolution: number,
  masks: SemanticSegmentationMask[],
  vanishingPoints: VanishingPointArtifact[],
): Float32Array {
  const grid = new Float32Array(resolution * resolution);
  const step = 1000 / resolution;

  for (let row = 0; row < resolution; row++) {
    for (let col = 0; col < resolution; col++) {
      const x = col * step + step / 2; // center of cell
      const y = row * step + step / 2;
      grid[row * resolution + col] = heuristicDepth(x, y, masks, vanishingPoints);
    }
  }

  return grid;
}

/**
 * Encode a Float32Array as a base64 string for storage.
 */
function encodeFloat32ToBase64(data: Float32Array): string {
  const buffer = Buffer.from(data.buffer);
  return buffer.toString('base64');
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the depth estimation worker for a single photo.
 *
 * Produces a DepthMap artifact with heuristic depth values based on
 * semantic segmentation masks and vanishing point information.
 */
export function runDepthWorker(input: DepthWorkerInput): DepthWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: DepthMap[] = [];

  const gridResolution = input.config?.gridResolution ?? 64;
  const minConfidence = input.config?.minConfidence ?? 20;

  // Stage 1: Initialize
  const t0 = Date.now();
  const hasMasks = input.masks.length > 0;
  const hasVPs = input.vanishingPoints.length > 0;
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Generate depth grid
  const t1 = Date.now();
  const depthGrid = generateDepthGrid(gridResolution, input.masks, input.vanishingPoints);
  timings['grid_generation'] = Date.now() - t1;

  // Stage 3: Encode and create artifact
  const t2 = Date.now();
  const depthData = encodeFloat32ToBase64(depthGrid);

  // Compute confidence based on available signals
  const maskBonus = hasMasks ? 20 : 0;
  const vpBonus = hasVPs ? 10 : 0;
  const baseConfidence = 35; // heuristic depth is always low confidence
  const confidence = Math.min(100, baseConfidence + maskBonus + vpBonus);

  if (confidence >= minConfidence) {
    const artifact: DepthMap = {
      artifactType: 'depth_map',
      fileId: input.fileId,
      width: gridResolution,
      height: gridResolution,
      depthData,
      depthMetric: 'normalized_relative',
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...DEPTH_WORKER_LIMITATIONS],
    };

    artifacts.push(artifact);
  }
  timings['artifact_creation'] = Date.now() - t2;

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: DEPTH_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing artifacts
// ---------------------------------------------------------------------------

/**
 * Run depth estimation from a standard GeometryReconstructionInput
 * and pre-computed segmentation masks and vanishing points.
 *
 * Returns DepthMap artifacts.
 */
export function runDepthFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
  vanishingPoints: VanishingPointArtifact[],
): GeometryReconstructionArtifact[] {
  const results: GeometryReconstructionArtifact[] = [];

  for (const photo of input.sourcePhotos) {
    const photoMasks = masks.filter(m => m.fileId === photo.fileId);
    const workerInput: DepthWorkerInput = {
      surveyId: input.surveyId,
      fileId: photo.fileId,
      masks: photoMasks,
      vanishingPoints,
      config: input.config as DepthWorkerInput['config'] | undefined,
    };

    const output = runDepthWorker(workerInput);
    results.push(...output.artifacts);
  }

  return results;
}
