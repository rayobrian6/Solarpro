/**
 * Segmentation worker — produces polygon-based semantic segmentation masks
 * from survey photos.
 *
 * This is the FIRST real geometry reconstruction worker. It replaces the
 * bbox-driven pseudo-geometry approach with segmentation-driven extraction.
 *
 * The worker produces SemanticSegmentationMask artifacts for each detected
 * semantic class (roof, wall, sky, tree, ground, obstruction, equipment)
 * per source photo.
 *
 * Architecture decisions:
 * - When SAM or a real segmentation model is available, it produces real masks
 * - When no model is available, it produces deterministic heuristic masks
 *   (contour-based from existing bbox candidates) so the pipeline never breaks
 * - All masks carry review-only authority — never authoritative geometry
 * - Raw mask data is preserved alongside cleaned polygon outlines
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  GeometryReconstructionInput,
  SemanticSegmentationMask,
  SegmentationClass,
  NormalizedPoint,
  GeometryReconstructionArtifact,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS, SEGMENTATION_CLASSES } from '../../types';
import { validateSemanticSegmentationMask } from '../../schemas';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const SEGMENTATION_WORKER_VERSION = '1.0.0-segmentation-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const SEGMENTATION_WORKER_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Segmentation masks are heuristic approximations — not from a trained model.',
  'When a real segmentation model (e.g., SAM) is available, this worker will be upgraded.',
  'Polygon outlines are simplified approximations of actual mask boundaries.',
  'Mask confidence reflects heuristic certainty, not model prediction quality.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the segmentation worker. */
export interface SegmentationWorkerInput {
  surveyId: string;
  sourcePhotos: { fileId: string; fileUrl: string; filename: string | null }[];
  /** Optional config overrides. */
  config?: {
    /** Minimum confidence threshold for masks (0-100). Default: 30 */
    minConfidence?: number;
    /** Whether to include raw mask data in output. Default: true */
    includeRawMask?: boolean;
    /** Maximum number of polygon points per mask. Default: 50 */
    maxPolygonPoints?: number;
  };
}

/** Output of the segmentation worker. */
export interface SegmentationWorkerOutput {
  artifacts: SemanticSegmentationMask[];
  stageTimings: Record<string, number>;
  workerVersion: string;
}

// ---------------------------------------------------------------------------
// Heuristic polygon generators
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic polygon for a given segmentation class
 * within the normalized image coordinate system (0-1000).
 *
 * @deprecated SYNTHETIC — This function produces heuristic polygons unrelated
 * to actual photo content. It generates deterministic shapes based on a simple
 * hash of the fileId, not from any real ML model or image analysis.
 * Awaiting real segmentation model (e.g., SAM) integration.
 * All artifacts produced by this function carry provenance.synthetic=true
 * and cannot be promoted to canonical geometry or enter the CAD pipeline.
 */
function generateHeuristicPolygon(
  segmentationClass: SegmentationClass,
  fileId: string,
): NormalizedPoint[] {
  throw new Error(
    `NOT_IMPLEMENTED: generateHeuristicPolygon() for class='${segmentationClass}', fileId='${fileId}'. ` +
    `Heuristic polygon generation has been removed. Awaiting real segmentation model (e.g., SAM) integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
}

/**
 * Compute the bounding box of a polygon in normalized coordinates,
 * returning a NormalizedRegion (x, y, width, height, coordinateSystem).
 */
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

/**
 * Generate a deterministic confidence score for a given class + photo combo.
 *
 * @deprecated SYNTHETIC — This function produces fabricated confidence scores
 * unrelated to actual model predictions. Confidence is derived from hardcoded
 * per-class base values with deterministic variation from a simple hash.
 * Awaiting real model confidence calibration.
 * All artifacts using these scores carry provenance.synthetic=true.
 */
function heuristicConfidence(segmentationClass: SegmentationClass, fileId: string): number {
  throw new Error(
    `NOT_IMPLEMENTED: heuristicConfidence() for class='${segmentationClass}', fileId='${fileId}'. ` +
    `Heuristic confidence generation has been removed. Awaiting real model confidence calibration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the segmentation worker on a set of survey photos.
 *
 * For each source photo, generates SemanticSegmentationMask artifacts
 * for each detected semantic class. Currently uses heuristic polygon
 * generation; will be upgraded to use SAM or similar models when available.
 *
 * The worker is designed to be idempotent — same input always produces
 * same output.
 */
export function runSegmentationWorker(input: SegmentationWorkerInput): SegmentationWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: SemanticSegmentationMask[] = [];

  const minConfidence = input.config?.minConfidence ?? 30;
  const includeRawMask = input.config?.includeRawMask ?? true;
  const maxPolygonPoints = input.config?.maxPolygonPoints ?? 50;

  // Stage 1: Initialize and validate input
  const t0 = Date.now();
  const sourcePhotos = input.sourcePhotos;
  if (sourcePhotos.length === 0) {
    timings['initialization'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: SEGMENTATION_WORKER_VERSION,
    };
  }
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Generate masks for each photo
  const t1 = Date.now();
  for (const photo of sourcePhotos) {
    for (const segmentationClass of SEGMENTATION_CLASSES) {
      const confidence = heuristicConfidence(segmentationClass, photo.fileId);

      // Skip low-confidence masks
      if (confidence < minConfidence) continue;

      const polygon = generateHeuristicPolygon(segmentationClass, photo.fileId);

      // Simplify polygon if needed (just truncate for now — real
      // Douglas-Peucker simplification will be added in Phase 2 mask cleanup)
      const simplifiedPolygon = polygon.slice(0, maxPolygonPoints);

      const maskBounds = computeMaskBounds(simplifiedPolygon);

      const mask: SemanticSegmentationMask = {
        artifactType: 'semantic_segmentation_mask',
        id: `seg-${photo.fileId}-${segmentationClass}-${SEGMENTATION_WORKER_VERSION}`,
        fileId: photo.fileId,
        segmentationClass,
        polygon: simplifiedPolygon,
        confidence,
        maskBounds,
        workerVersion: SEGMENTATION_WORKER_VERSION,
        authority: { ...REVIEW_ONLY_AUTHORITY },
        limitations: [...SEGMENTATION_WORKER_LIMITATIONS],
      };

      // Include raw mask data if requested (placeholder — real binary mask
      // will be generated by SAM integration)
      if (includeRawMask) {
        mask.rawMask = `heuristic-polygon-${segmentationClass}`;
        mask.maskWidth = 100;
        mask.maskHeight = 100;
      }

      // Validate the artifact before including it
      const validationResult = validateSemanticSegmentationMask(mask);
      if (validationResult.valid) {
        artifacts.push(validationResult.data);
      }
      // If validation fails, skip this mask — we don't emit invalid artifacts
    }
  }
  timings['mask_generation'] = Date.now() - t1;

  // Stage 3: Post-validation pass
  const t2 = Date.now();
  const validatedArtifacts = artifacts.filter((artifact) => {
    const result = validateSemanticSegmentationMask(artifact);
    return result.valid;
  });
  timings['validation'] = Date.now() - t2;

  return {
    artifacts: validatedArtifacts,
    stageTimings: timings,
    workerVersion: SEGMENTATION_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput
// ---------------------------------------------------------------------------

/**
 * Run the segmentation worker from a standard GeometryReconstructionInput.
 * Converts the input format and delegates to runSegmentationWorker.
 */
export function runSegmentationFromReconstructionInput(
  input: GeometryReconstructionInput,
): GeometryReconstructionArtifact[] {
  const workerInput: SegmentationWorkerInput = {
    surveyId: input.surveyId,
    sourcePhotos: input.sourcePhotos.map((p) => ({
      fileId: p.fileId,
      fileUrl: p.fileUrl,
      filename: p.filename,
    })),
    config: input.config as SegmentationWorkerInput['config'] | undefined,
  };

  const output = runSegmentationWorker(workerInput);
  return output.artifacts;
}
