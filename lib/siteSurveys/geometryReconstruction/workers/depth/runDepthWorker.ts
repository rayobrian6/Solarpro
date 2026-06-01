/**
 * Depth estimation worker — produces DepthMap artifacts from segmentation
 * masks and vanishing points using MiDaS/DPT monocular depth estimation,
 * with heuristic fallback when the model service is unavailable.
 *
 * Approach:
 * 1. **MiDaS primary path**: Send image bytes to the /depth endpoint,
 *    receive a base64-encoded float32 depth grid, and decode it.
 *    MiDaS produces normalized relative inverse depth (high=near, low=far).
 *    We invert to match the convention: high=far, low=near.
 * 2. **Heuristic fallback**: Use segmentation masks to determine depth ordering
 *    (sky is far, ground is near, roof/wall are mid-range), plus vanishing
 *    points for perspective correction. This runs when MiDaS is unavailable
 *    or fails.
 *
 * The MiDaS upgrade was designed from the start — the original heuristic
 * docstring explicitly states: "When a real depth model is available,
 * this worker will be upgraded." That day has come.
 *
 * IMPORTANT: Depth is a SUPPORT signal only — it does NOT override
 * segmentation-driven geometry. It provides supplementary depth cues
 * that downstream consumers can use for validation.
 *
 * Depth convention (consistent for both MiDaS and heuristic paths):
 *   - Higher values = farther from camera (sky ≈ 0.9, ground ≈ 0.15)
 *   - Lower values = closer to camera
 *   - Values are normalized to [0, 1] range
 *   - NOT metric depth (not in meters) — relative ordering only
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
import { estimateDepthWithMidas, isMidasEnabled } from './midasClient';
import { getGlobalDepthCache } from './depthCache';
import type { DepthCacheEntry } from './depthCache';
import type { MidasDepthResult } from './midasClient';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const DEPTH_WORKER_VERSION = '2.0.0-depth-midas';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const DEPTH_WORKER_LIMITATIONS_MIDAS = [
  ...BASE_LIMITATIONS,
  'Depth is a SUPPORT signal only — it must NOT override segmentation-driven geometry.',
  'MiDaS depth is normalized relative (not metric) — relative ordering only.',
  'MiDaS depth is monocular — no stereo/multi-view epipolar constraints.',
  'MiDaS model (Intel/dpt-swinv2-tiny-256) is a small model; larger models may improve accuracy.',
  'Depth convention: higher values = farther from camera (inverted from raw MiDaS output).',
] as const;

const DEPTH_WORKER_LIMITATIONS_HEURISTIC = [
  ...BASE_LIMITATIONS,
  'Depth estimation is heuristic — not from a trained depth model (MiDaS/DPT).',
  'MiDaS service was unavailable; fell back to heuristic estimation.',
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
  /** Raw image bytes for MiDaS inference. If omitted, falls back to heuristic. */
  imageBytes?: Buffer;
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
  /** Whether MiDaS was used successfully (false = heuristic fallback). */
  usedMidas: boolean;
}

// ---------------------------------------------------------------------------
// Depth heuristic (unchanged from v1 — used as fallback)
// ---------------------------------------------------------------------------

/**
 * Check if a point (x,y) falls inside a polygon using ray casting.
 */
function pointInPolygonDepth(px: number, py: number, polygon: NormalizedPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Heuristic depth estimation at a point.
 *
 * Strategy:
 * 1. Check which segmentation mask(s) the point falls in.
 * 2. Assign depth based on semantic class prior:
 *    - sky → 0.9 (far)
 *    - roof → 0.5 (mid-range)
 *    - wall → 0.4 (mid-range, slightly closer)
 *    - ground → 0.15 (near)
 *    - tree → 0.6 (mid-far)
 *    - obstruction → 0.45 (mid-range)
 *    - equipment → 0.4 (mid-range)
 * 3. Apply a vertical gradient (higher in image = farther) as baseline.
 * 4. If vanishing points are available, use them to add a slight
 *    perspective correction (points closer to VP are farther).
 * 5. Blend mask-based depth with gradient, preferring mask when available.
 */
function heuristicDepth(
  x: number, // 0-1000
  y: number, // 0-1000
  masks: SemanticSegmentationMask[],
  vanishingPoints: VanishingPointArtifact[],
): number {
  // Vertical gradient baseline: top of image is far (0.8), bottom is near (0.2)
  const gradientDepth = 0.8 - (y / 1000) * 0.6;

  // Find which mask this point belongs to (take the one with highest confidence)
  let bestMask: SemanticSegmentationMask | null = null;
  let bestConf = -1;
  for (const mask of masks) {
    if (mask.confidence > bestConf && pointInPolygonDepth(x, y, mask.polygon)) {
      bestMask = mask;
      bestConf = mask.confidence;
    }
  }

  if (bestMask === null) {
    // No mask covers this point — use gradient + optional VP correction
    let depth = gradientDepth;

    // VP correction: if there's a VP, points closer to it are farther
    if (vanishingPoints.length > 0) {
      let vpCorrection = 0;
      for (const vp of vanishingPoints) {
        const dx = x - vp.point.x;
        const dy = y - vp.point.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Closer to VP → higher correction (farther)
        const maxDist = 2000;
        const correction = Math.max(0, 0.1 * (1 - dist / maxDist));
        vpCorrection = Math.max(vpCorrection, correction);
      }
      depth = Math.min(1, depth + vpCorrection * 0.3);
    }

    return Math.max(0, Math.min(1, depth));
  }

  // Mask-based depth priors
  const classPriors: Record<string, number> = {
    sky: 0.9,
    roof: 0.5,
    wall: 0.4,
    ground: 0.15,
    tree: 0.6,
    obstruction: 0.45,
    equipment: 0.4,
  };

  const maskDepth = classPriors[bestMask.segmentationClass] ?? gradientDepth;

  // Blend mask depth with gradient (70% mask, 30% gradient)
  let depth = maskDepth * 0.7 + gradientDepth * 0.3;

  // VP correction for non-sky masks
  if (vanishingPoints.length > 0 && bestMask.segmentationClass !== 'sky') {
    for (const vp of vanishingPoints) {
      const dx = x - vp.point.x;
      const dy = y - vp.point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = 2000;
      const correction = Math.max(0, 0.05 * (1 - dist / maxDist));
      depth = Math.min(1, depth + correction);
    }
  }

  return Math.max(0, Math.min(1, depth));
}

// ---------------------------------------------------------------------------
// Grid generation (heuristic path)
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

// ---------------------------------------------------------------------------
// Encoding utilities
// ---------------------------------------------------------------------------

/**
 * Encode a Float32Array as a base64 string for storage.
 */
function encodeFloat32ToBase64(data: Float32Array): string {
  const buffer = Buffer.from(data.buffer);
  return buffer.toString('base64');
}

/**
 * Invert MiDaS depth values to match the convention: higher = farther.
 *
 * MiDaS produces normalized relative INVERSE depth:
 *   - High values = close to camera (e.g., ground ≈ 0.94)
 *   - Low values = far from camera (e.g., sky ≈ 0.01)
 *
 * Our convention (matching the heuristic) is the opposite:
 *   - High values = far from camera (e.g., sky ≈ 0.9)
 *   - Low values = close to camera (e.g., ground ≈ 0.15)
 *
 * Inversion: inverted = 1.0 - original
 * After inversion: sky ≈ 0.99, ground ≈ 0.06 — same ordering as heuristic.
 */
function invertMidasDepth(depthGrid: Float32Array): Float32Array {
  const inverted = new Float32Array(depthGrid.length);
  for (let i = 0; i < depthGrid.length; i++) {
    inverted[i] = 1.0 - depthGrid[i];
  }
  return inverted;
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the depth estimation worker for a single photo.
 *
 * Attempts MiDaS/DPT depth estimation first (if image bytes are provided
 * and the MiDaS service is available). Falls back to heuristic depth
 * estimation if MiDaS is unavailable or fails.
 *
 * Depth convention (both paths): higher values = farther from camera.
 */
export async function runDepthWorker(input: DepthWorkerInput): Promise<DepthWorkerOutput> {
  const timings: Record<string, number> = {};
  const artifacts: DepthMap[] = [];

  const gridResolution = input.config?.gridResolution ?? 64;
  const minConfidence = input.config?.minConfidence ?? 20;

  // Stage 1: Initialize — check MiDaS availability
  const t0 = Date.now();
  const hasMasks = input.masks.length > 0;
  const hasVPs = input.vanishingPoints.length > 0;
  const canUseMidas = isMidasEnabled() && !!input.imageBytes;
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Attempt MiDaS depth estimation
  let midasResult: MidasDepthResult | null = null;
  let usedMidas = false;

  if (canUseMidas) {
    const t1 = Date.now();
    try {
      midasResult = await estimateDepthWithMidas(input.imageBytes!, gridResolution);
      timings['midas_attempt'] = Date.now() - t1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[DepthWorker] MiDaS call failed: ${message} — falling back to heuristic`);
      timings['midas_attempt'] = Date.now() - t1;
      midasResult = null;
    }
  }

  // Stage 3: Generate depth grid (MiDaS or heuristic)
  const t2 = Date.now();
  let depthGrid: Float32Array;
  let depthMetric: string;
  let limitations: readonly string[];
  let confidence: number;

  if (midasResult !== null && midasResult.usedMidas) {
    // MiDaS path: invert to match convention (high=far), then use the grid
    depthGrid = invertMidasDepth(midasResult.depthGrid);
    depthMetric = 'normalized_relative';
    limitations = DEPTH_WORKER_LIMITATIONS_MIDAS;

    // MiDaS confidence: base 60 (much higher than heuristic's 35) +
    // mask bonus 15 (masks still useful for validation) +
    // VP bonus 5 (VPs provide orthogonal signal)
    const maskBonus = hasMasks ? 15 : 0;
    const vpBonus = hasVPs ? 5 : 0;
    confidence = Math.min(100, 60 + maskBonus + vpBonus);

    usedMidas = true;
    console.info(
      `[DepthWorker] MiDaS depth: ${midasResult.width}x${midasResult.height} grid, ` +
      `service_processing=${midasResult.processingTimeMs}ms, ` +
      `model=${midasResult.modelInfo?.modelId ?? 'unknown'}, confidence=${confidence}`,
    );
  } else {
    // Heuristic fallback path (unchanged from v1)
    depthGrid = generateDepthGrid(gridResolution, input.masks, input.vanishingPoints);
    depthMetric = 'normalized_relative';
    limitations = DEPTH_WORKER_LIMITATIONS_HEURISTIC;

    const maskBonus = hasMasks ? 20 : 0;
    const vpBonus = hasVPs ? 10 : 0;
    const baseConfidence = 35; // heuristic depth is always low confidence
    confidence = Math.min(100, baseConfidence + maskBonus + vpBonus);

    if (canUseMidas) {
      console.info(
        `[DepthWorker] MiDaS unavailable — heuristic fallback, confidence=${confidence}`,
      );
    }
  }
  timings['grid_generation'] = Date.now() - t2;

  // Stage 4: Encode and create artifact
  const t3 = Date.now();
  const depthData = encodeFloat32ToBase64(depthGrid);

  if (confidence >= minConfidence) {
    const artifact: DepthMap = {
      artifactType: 'depth_map',
      fileId: input.fileId,
      width: gridResolution,
      height: gridResolution,
      depthData,
      depthMetric,
      confidence,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...limitations],
    };

    artifacts.push(artifact);
  }
  timings['artifact_creation'] = Date.now() - t3;

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: DEPTH_WORKER_VERSION,
    usedMidas,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing artifacts
// ---------------------------------------------------------------------------

/**
 * Fetch image bytes from a URL for MiDaS inference.
 *
 * Returns null if the fetch fails (caller will fall back to heuristic).
 * Timeouts after 15s to avoid blocking the pipeline.
 */
async function fetchImageBytes(fileUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(fileUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.warn(
        `[DepthWorker] Failed to fetch image from ${fileUrl}: HTTP ${response.status}`,
      );
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[DepthWorker] Failed to fetch image from ${fileUrl}: ${message}`);
    return null;
  }
}

/**
 * Run depth estimation from a standard GeometryReconstructionInput
 * and pre-computed segmentation masks and vanishing points.
 *
 * For each source photo, attempts MiDaS depth estimation first
 * (fetches image bytes from fileUrl), falling back to heuristic
 * if the image can't be fetched or MiDaS is unavailable.
 *
 * Returns DepthMap artifacts.
 */
export async function runDepthFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
  vanishingPoints: VanishingPointArtifact[],
): Promise<GeometryReconstructionArtifact[]> {
  const results: GeometryReconstructionArtifact[] = [];
  const cache = getGlobalDepthCache();

  for (const photo of input.sourcePhotos) {
    const photoMasks = masks.filter(m => m.fileId === photo.fileId);

    // Check cache first — avoid redundant MiDaS inference
    const cacheKey = { fileId: photo.fileId, modelVersion: DEPTH_WORKER_VERSION };
    const cached = cache.get(cacheKey);
    if (cached !== null) {
      console.info(
        `[DepthWorker] Cache hit for ${photo.fileId} (model=${cacheKey.modelVersion}) — skipping inference`,
      );
      results.push(cached.depthMap);
      continue;
    }

    // Attempt to fetch image bytes for MiDaS
    let imageBytes: Buffer | undefined;
    if (isMidasEnabled() && photo.fileUrl) {
      const fetched = await fetchImageBytes(photo.fileUrl);
      imageBytes = fetched ?? undefined;
    }

    const workerInput: DepthWorkerInput = {
      surveyId: input.surveyId,
      fileId: photo.fileId,
      masks: photoMasks,
      vanishingPoints,
      imageBytes,
      config: input.config as DepthWorkerInput['config'] | undefined,
    };

    const output = await runDepthWorker(workerInput);

    // Store result in cache (only if artifacts were produced)
    if (output.artifacts.length > 0) {
      for (const artifact of output.artifacts) {
        cache.set(cacheKey, artifact, output.usedMidas);
      }
    }

    results.push(...output.artifacts);
  }

  return results;
}
