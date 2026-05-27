// ============================================================================
// lib/vision/workerResultConverter.ts
//
// Converts OpenSourcePhotoVisionRunResult (worker output) to PhotoVisionResult[]
// (format expected by aggregateVisionResults()).
//
// NORMALIZATION:
//   - Coordinates: 0-1000 integer → 0.0-1.0 float, top-left origin
//   - Confidence: 0-100 → 0.0-1.0
//
// PRESERVATION:
//   - fileUrl, fileId, filename, source image metadata
//   - detections, bounding boxes, labels/types, confidence
//   - roofPlaneId if available
//   - referenceImageUrl if available
//
// CRITICAL: No double normalization. This is the ONLY place where conversion
// happens. All downstream code assumes 0.0-1.0 float coordinates.
// ============================================================================

import type {
  PhotoVisionResult,
  VisionDetection,
  VisionBoundingBox,
  VisionInferenceResult,
  PhotoContext,
} from './types';
import type {
  OpenSourcePhotoVisionRunResult,
  OpenSourcePhotoVisionFileResult,
  OpenSourcePhotoVisionCandidate,
} from '@/lib/assistedEvidenceSources/openSourcePhotoVisionWorker';

// ============================================================================
// Coordinate Normalization
// ============================================================================

/**
 * Convert normalized coordinates from worker format (0-1000 integer, top-left origin)
 * to VisionBoundingBox format (0.0-1.0 float, center origin).
 *
 * Worker format:
 *   - x, y: top-left corner
 *   - width, height: dimensions
 *   - Range: 0-1000
 *
 * VisionBoundingBox format:
 *   - x, y: center point
 *   - width, height: dimensions
 *   - Range: 0.0-1.0
 *
 * @param workerX - X coordinate in 0-1000 format
 * @param workerY - Y coordinate in 0-1000 format
 * @param workerWidth - Width in 0-1000 format
 * @param workerHeight - Height in 0-1000 format
 * @returns VisionBoundingBox with 0.0-1.0 float coordinates (center origin)
 */
function normalizeBoundingBox(
  workerX: number,
  workerY: number,
  workerWidth: number,
  workerHeight: number,
): VisionBoundingBox {
  // Convert to 0.0-1.0 range
  const x0 = workerX / 1000.0;
  const y0 = workerY / 1000.0;
  const w = workerWidth / 1000.0;
  const h = workerHeight / 1000.0;

  // Convert from top-left to center origin
  const x = x0 + w / 2.0;
  const y = y0 + h / 2.0;

  return { x, y, width: w, height: h };
}

/**
 * Normalize confidence from worker format (0-100 integer) to VisionDetection format (0.0-1.0 float).
 *
 * @param workerConfidence - Confidence in 0-100 format
 * @returns Confidence in 0.0-1.0 format
 */
function normalizeConfidence(workerConfidence: number): number {
  return workerConfidence / 100.0;
}

// ============================================================================
// Candidate to Detection Conversion
// ============================================================================

/**
 * Extract VisionDetection from a worker candidate.
 *
 * The worker returns candidates with region/line coordinates in 0-1000 format.
 * This function extracts those coordinates and converts them to VisionDetection format.
 *
 * @param candidate - Worker candidate
 * @returns VisionDetection or null if candidate has no region/line
 */
function extractDetectionFromCandidate(
  candidate: OpenSourcePhotoVisionCandidate,
): VisionDetection | null {
  // Candidates can have either a region (rectangular) or a line (linear)
  // Only candidates with regions can be converted to detections (lines don't represent object bounding boxes)

  if (candidate.region && candidate.region.coordinateSystem === 'normalized_image_0_1000') {
    const bbox = normalizeBoundingBox(
      candidate.region.x,
      candidate.region.y,
      candidate.region.width,
      candidate.region.height,
    );

    return {
      class: candidate.candidateType, // Use candidateType as the class label
      confidence: normalizeConfidence(candidate.confidence),
      bbox,
    };
  }

  // Lines are not object detections - they're linear features
  // We don't convert them to VisionDetection objects
  return null;
}

// ============================================================================
// File Result to PhotoContext Conversion
// ============================================================================

/**
 * Build PhotoContext from a worker file result.
 *
 * @param fileResult - Worker file result
 * @param projectId - Project ID
 * @param surveyId - Survey ID
 * @returns PhotoContext
 */
function buildPhotoContext(
  fileResult: OpenSourcePhotoVisionFileResult,
  projectId: string | null,
  surveyId: string,
): PhotoContext {
  return {
    fileUrl: fileResult.fileUrl,
    fileId: fileResult.fileId,
    // GPS, azimuth, pitch, label, roofPlaneId are not provided by worker
    // These will be populated from survey data by the route
    lat: null,
    lng: null,
    azimuth: null,
    pitch: null,
    label: null,
    roofPlaneId: null,
    // Image dimensions from metadata
    imageDims:
      fileResult.metadata.widthPx && fileResult.metadata.heightPx
        ? { width: fileResult.metadata.widthPx, height: fileResult.metadata.heightPx }
        : null,
    // referenceImageUrl will be populated by route
    referenceImageUrl: null,
  };
}

// ============================================================================
// Reference Image URL Resolution (Priority Chain)
// ============================================================================

/**
 * Resolve the best reference image URL for a photo using a 5-tier priority chain.
 *
 * PRIORITY CHAIN (highest → lowest):
 *   1. Roof plane reference image — a per-plane reference image (orthophoto/satellite)
 *      associated with the roofPlaneId on the photo
 *   2. CAD/SVG raster — a rasterized version of the CAD/SVG roof diagram
 *   3. Orthographic artifact — an orthographic/satellite image from the project
 *   4. Survey-selected reference photo — a photo explicitly marked as reference
 *      in the survey by the user
 *   5. null — no reference image available; homography will fall back gracefully
 *
 * @param context - Available data sources for reference image resolution
 * @returns The best available reference image URL, or null if none found
 */
export function resolveReferenceImageUrl(context: {
  /** Per-roof-plane reference image URLs, keyed by roofPlaneId */
  roofPlaneReferenceImages?: Record<string, string> | null;
  /** The roofPlaneId of the current photo (if assigned) */
  roofPlaneId?: string | null;
  /** Rasterized CAD/SVG diagram URL (project-level) */
  cadSvgRasterUrl?: string | null;
  /** Orthographic/satellite artifact URL (project-level) */
  orthographicArtifactUrl?: string | null;
  /** Survey-selected reference photo URL */
  surveySelectedReferenceUrl?: string | null;
}): string | null {
  // Priority 1: Roof plane reference image
  if (context.roofPlaneId && context.roofPlaneReferenceImages) {
    const planeRef = context.roofPlaneReferenceImages[context.roofPlaneId];
    if (planeRef && typeof planeRef === 'string' && planeRef.length > 0) {
      return planeRef;
    }
  }

  // Priority 2: CAD/SVG raster
  if (context.cadSvgRasterUrl && typeof context.cadSvgRasterUrl === 'string' && context.cadSvgRasterUrl.trim().length > 0) {
    return context.cadSvgRasterUrl.trim();
  }

  // Priority 3: Orthographic artifact
  if (context.orthographicArtifactUrl && typeof context.orthographicArtifactUrl === 'string' && context.orthographicArtifactUrl.trim().length > 0) {
    return context.orthographicArtifactUrl.trim();
  }

  // Priority 4: Survey-selected reference photo
  if (context.surveySelectedReferenceUrl && typeof context.surveySelectedReferenceUrl === 'string' && context.surveySelectedReferenceUrl.trim().length > 0) {
    return context.surveySelectedReferenceUrl.trim();
  }

  // Priority 5: No reference image available
  return null;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert OpenSourcePhotoVisionRunResult to PhotoVisionResult[].
 *
 * This is the ONLY place where normalization happens:
 *   - Coordinates: 0-1000 → 0.0-1.0
 *   - Confidence: 0-100 → 0.0-1.0
 *
 * @param runResult - Worker run result
 * @param projectId - Project ID (required for PhotoVisionResult)
 * @returns Array of PhotoVisionResult (one per analyzed file)
 */
export function convertWorkerResultToPhotoVisionResults(
  runResult: OpenSourcePhotoVisionRunResult,
  projectId: string,
): PhotoVisionResult[] {
  const photoVisionResults: PhotoVisionResult[] = [];
  const inferredAt = runResult.createdAt;
  const modelId = `${runResult.toolName}@${runResult.toolVersion}`;

  // Process each file result
  for (const fileResult of runResult.files) {
    // Skip files that failed to analyze
    if (!fileResult.analyzed || fileResult.error) {
      continue;
    }

    // Extract detections from candidates
    const detections: VisionDetection[] = [];
    for (const candidate of fileResult.candidates) {
      const detection = extractDetectionFromCandidate(candidate);
      if (detection) {
        detections.push(detection);
      }
    }

    // Build inference result
    const inferenceResult: VisionInferenceResult = {
      detections,
      detectionCount: detections.length,
      inferenceMs: 0, // Worker metadata doesn't provide inference timing
      modelPath: modelId,
    };

    // Build photo context
    const photoContext = buildPhotoContext(fileResult, runResult.projectId, runResult.surveyId);

    // Build photo vision result
    const photoVisionResult: PhotoVisionResult = {
      fileId: fileResult.fileId,
      fileUrl: fileResult.fileUrl,
      projectId: projectId, // Use provided projectId (worker may have null)
      surveyId: runResult.surveyId,
      inferenceResult,
      photoContext,
      inferredAt,
      modelId,
      durationMs: 0, // Worker metadata doesn't provide per-file duration
    };

    photoVisionResults.push(photoVisionResult);
  }

  return photoVisionResults;
}

// ============================================================================
// Utility: Populate PhotoContext with Survey Data
// ============================================================================

/**
 * Enrich PhotoVisionResult with survey-specific photo metadata.
 *
 * This function is called by the route after conversion to add:
 *   - GPS coordinates (lat, lng)
 *   - Camera orientation (azimuth, pitch)
 *   - Photo label
 *   - Roof plane association
 *   - Reference image URL
 *
 * @param photoVisionResult - PhotoVisionResult to enrich
 * @param surveyPhotoData - Survey photo metadata
 * @returns Enriched PhotoVisionResult (mutated in place for efficiency)
 */
export function enrichPhotoContextWithSurveyData(
  photoVisionResult: PhotoVisionResult,
  surveyPhotoData: {
    fileId: string;
    lat?: number | null;
    lng?: number | null;
    azimuth?: number | null;
    pitch?: number | null;
    label?: string | null;
    roofPlaneId?: string | null;
    referenceImageUrl?: string | null;
  },
): void {
  // Find matching photo by fileId
  if (photoVisionResult.fileId !== surveyPhotoData.fileId) {
    return;
  }

  // Enrich photo context
  const ctx = photoVisionResult.photoContext;
  ctx.lat = surveyPhotoData.lat ?? ctx.lat;
  ctx.lng = surveyPhotoData.lng ?? ctx.lng;
  ctx.azimuth = surveyPhotoData.azimuth ?? ctx.azimuth;
  ctx.pitch = surveyPhotoData.pitch ?? ctx.pitch;
  ctx.label = surveyPhotoData.label ?? ctx.label;
  ctx.roofPlaneId = surveyPhotoData.roofPlaneId ?? ctx.roofPlaneId;
  ctx.referenceImageUrl = surveyPhotoData.referenceImageUrl ?? ctx.referenceImageUrl;
}