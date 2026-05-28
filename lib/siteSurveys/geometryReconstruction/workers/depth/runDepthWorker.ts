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
function heuristicDepth(
  x: number, // 0-1000
  y: number, // 0-1000
  _masks: SemanticSegmentationMask[],
  _vanishingPoints: VanishingPointArtifact[],
): number {
  throw new Error(
    `NOT_IMPLEMENTED: heuristicDepth() at (x=${x}, y=${y}). ` +
    `Heuristic depth estimation has been removed. Awaiting real depth model (e.g., MiDaS/DPT) integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
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
