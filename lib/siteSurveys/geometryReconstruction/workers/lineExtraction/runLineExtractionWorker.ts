/**
 * Line extraction worker — produces StructuralLineCandidate artifacts
 * from segmentation masks using image-based edge detection.
 *
 * EXTRACTION APPROACH (v3 — image-based edge detection):
 * 1. For each photo, run Canny edge detection on the original image
 * 2. Apply Hough line transform to extract candidate structural lines
 * 3. Filter candidate lines by overlap with SAM2 segmentation masks
 * 4. Keep only lines that fall on roof/wall/siding/fascia/soffit/gutter regions
 * 5. Classify filtered lines by orientation, position, and source class
 * 6. Assign confidence based on edge strength, line length, and mask support
 *
 * This approach correctly extracts structural lines from image gradients
 * (where ridges, valleys, eaves actually appear in the photo) rather than
 * from SAM2 mask polygon boundaries (which only show region edges).
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  NormalizedPoint,
  GeometryReconstructionInput,
  GeometryReconstructionArtifact,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
} from '@/lib/siteSurveys/geometryReconstruction/types';
import type { StructuralLineType } from '@/lib/siteSurveys/geometryReconstruction/types';
import { validateStructuralLineCandidate } from '@/lib/siteSurveys/geometryReconstruction/schemas';

import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LINE_EXTRACTION_WORKER_VERSION = '3.1.0-tuning-pass-3d';

/** Standard limitations for line extraction artifacts. */
const LINE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Image-based edge detection using multi-scale Canny + Hough transform',
  'Line type classification is orientation-based heuristic — may misclassify complex roof geometries',
  'Valley/hip detection uses multi-mask intersection logic — requires adjacent roof masks',
  'No vanishing-point or perspective correction applied',
  'Lines filtered by overlap with SAM2 segmentation masks',
  'Per-photo cap limits line candidates to prevent edge proliferation',
];

/** Minimum line length in normalized units (0-1000). */
const MIN_LINE_LENGTH = 40;

/** Maximum number of lines to extract per photo.
 * Lowered from 30 to 15 in Pass 3D — most roof scenes have 5-10 meaningful
 * structural lines; 30 creates visual clutter and rogue line proliferation.
 */
const MAX_LINES_PER_PHOTO = 15;

/** Minimum confidence threshold for lines (0-100).
 * Raised from 35 to 45 in Pass 3D — lines below 45% confidence are typically
 * noise or very weak edges that produce rogue structural lines.
 */
const MIN_CONFIDENCE = 45;

/** Canny edge detection threshold range — multi-scale will use these as base values. */
const CANNY_LOW_THRESHOLD = 40;
const CANNY_HIGH_THRESHOLD = 120;

/** Processing image width — increased from 500 to preserve thin edge detail. */
const PROCESSING_IMAGE_WIDTH = 800;

/** Multi-scale Canny sensitivity levels (low/medium/high). */
const CANNY_SCALE_LOW = { low: 60, high: 180 };    // Strong edges only — ridges, eaves
const CANNY_SCALE_MEDIUM = { low: 40, high: 120 }; // Default — most structural lines
const CANNY_SCALE_HIGH = { low: 20, high: 70 };    // Sensitive — thin/low-contrast edges (flat roofs, rubber)

// ---------------------------------------------------------------------------
// Structure-qualified classes (for filtering)
// ---------------------------------------------------------------------------

/** Classes that produce structural lines when a line overlaps their mask.
 * Only true structure surfaces belong here — porch/deck were removed in Pass 3D
 * because they are occluders/site context, not structural surfaces.
 */
export const STRUCTURE_QUALIFIED_CLASSES: ReadonlySet<string> = new Set([
  'roof',
  'wall',
  'siding',
  'fascia',
  'soffit',
  'gutter',
  'chimney',
  'vent_pipe',
]);

/** Classes that never produce structural lines.
 * Expanded in Pass 3D to cover ALL non-structural classes — occluders,
 * site context, vegetation, and condition flags should never yield
 * eave/ridge/rake/wall_vertical lines.
 */
export const REJECTED_CLASSES: ReadonlySet<string> = new Set([
  // Sky / atmosphere
  'sky',
  // Vegetation / landscape
  'tree',
  'trees',
  'grass',
  'ground',
  'bushes',
  'vegetation_touching_structure',
  'moss',
  'algae',
  // Hardscape / ground-level
  'driveway',
  'gravel',
  'sidewalk',
  'fence',
  'porch',
  'deck',
  'steps',
  'railing',
  // Vehicles
  'car',
  'truck',
  'trailer',
  // Equipment / temporary
  'equipment',
  'ac_unit',
  'trash_can',
  'person',
  'ladder',
  'tools',
  'temporary_materials',
  // Existing solar
  'existing_solar_panel',
  // Unknown / unclassified
  'unknown',
]);

/** Classes that represent wall surfaces (for foundation line inference). */
const WALL_CLASSES: ReadonlySet<string> = new Set([
  'wall',
  'siding',
  'fascia',
  'soffit',
]);

/** Classes that commonly occlude the wall foundation line.
 * These objects sit in front of the wall-ground boundary (cars, bushes, etc.)
 * and prevent the edge detector from finding the foundation line directly.
 * The inference function must extrapolate the wall bottom edge BEHIND these.
 */
export const WALL_FOUNDATION_OCCLUDER_CLASSES: ReadonlySet<string> = new Set([
  'car',
  'truck',
  'trailer',
  'bushes',
  'fence',
  'tree',
  'trees',
  'vegetation_touching_structure',
  'porch',
  'deck',
  'steps',
  'railing',
  'trash_can',
  'person',
  'ladder',
  'tools',
  'temporary_materials',
  'ac_unit',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the line extraction worker. */
export interface LineExtractionWorkerInput {
  surveyId: string;
  /** Segmentation masks for filtering detected lines. */
  masks: SemanticSegmentationMask[];
  /** Original photo image bytes, keyed by fileId. */
  imageBytesMap: Record<string, Buffer>;
  /** Source photo metadata. */
  sourcePhotos: Array<{ fileId: string; fileUrl: string }>;
  /** Optional config overrides. */
  config?: {
    minLineLength?: number;
    maxLinesPerPhoto?: number;
    minConfidence?: number;
  };
}

/** Diagnostic statistics for the filtering pipeline. */
export interface LineExtractionFilterStats {
  photosProcessed: number;
  photosSkipped: number;
  totalLinesDetected: number;
  linesOnStructure: number;
  linesClassified: number;
  linesKept: number;
}

/** Output of the line extraction worker. */
export interface LineExtractionWorkerOutput {
  artifacts: StructuralLineCandidate[];
  stageTimings: Record<string, number>;
  workerVersion: string;
  filterStats: LineExtractionFilterStats;
}

/** A line segment in normalized coordinates. */
export interface LineSegment {
  start: NormalizedPoint;
  end: NormalizedPoint;
  length: number;
  angleDeg: number;
}

// ---------------------------------------------------------------------------
// Image processing utilities
// ---------------------------------------------------------------------------

/**
 * Convert image bytes to grayscale and resize for processing.
 * Returns a Buffer containing grayscale pixel values (0-255).
 */
async function loadGrayscaleImage(imageBytes: Buffer, targetWidth: number = PROCESSING_IMAGE_WIDTH): Promise<{
  grayscale: Uint8Array;
  width: number;
  height: number;
}> {
  const { data, info } = await sharp(imageBytes)
    .resize(targetWidth, null, { withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    grayscale: new Uint8Array(data),
    width: info.width,
    height: info.height,
  };
}

/**
 * Apply Gaussian blur for noise reduction before edge detection.
 */
function gaussianBlur(image: Uint8Array, width: number, height: number, sigma: number = 1.4): Uint8Array {
  const kernelSize = 5;
  const kernel = generateGaussianKernel(kernelSize, sigma);
  const half = Math.floor(kernelSize / 2);

  const output = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weightSum = 0;
      for (let ky = -half; ky <= half; ky++) {
        for (let kx = -half; kx <= half; kx++) {
          const ny = Math.min(height - 1, Math.max(0, y + ky));
          const nx = Math.min(width - 1, Math.max(0, x + kx));
          const weight = kernel[(ky + half) * kernelSize + (kx + half)];
          sum += image[ny * width + nx] * weight;
          weightSum += weight;
        }
      }
      output[y * width + x] = Math.round(sum / weightSum);
    }
  }

  return output;
}

function generateGaussianKernel(size: number, sigma: number): number[] {
  const half = Math.floor(size / 2);
  const kernel: number[] = [];
  let sum = 0;

  for (let y = -half; y <= half; y++) {
    for (let x = -half; x <= half; x++) {
      const value = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
      kernel.push(value);
      sum += value;
    }
  }

  return kernel.map(v => v / sum);
}

/**
 * Apply Canny edge detection to a grayscale image.
 * Returns a binary edge map (0 or 255 for each pixel).
 */
function cannyEdgeDetection(
  grayscale: Uint8Array,
  width: number,
  height: number,
  lowThreshold: number = CANNY_LOW_THRESHOLD,
  highThreshold: number = CANNY_HIGH_THRESHOLD,
): Uint8Array {
  // Step 1: Gaussian blur for noise reduction
  const blurred = gaussianBlur(grayscale, width, height, 1.4);

  // Step 2: Compute Sobel gradients
  const magnitude = new Float32Array(width * height);
  const direction = new Float32Array(width * height);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Sobel X
      const gx =
        -blurred[(y - 1) * width + (x - 1)] + blurred[(y - 1) * width + (x + 1)]
        - 2 * blurred[y * width + (x - 1)] + 2 * blurred[y * width + (x + 1)]
        - blurred[(y + 1) * width + (x - 1)] + blurred[(y + 1) * width + (x + 1)];

      // Sobel Y
      const gy =
        -blurred[(y - 1) * width + (x - 1)] - 2 * blurred[(y - 1) * width + x] - blurred[(y - 1) * width + (x + 1)]
        + blurred[(y + 1) * width + (x - 1)] + 2 * blurred[(y + 1) * width + x] + blurred[(y + 1) * width + (x + 1)];

      const idx = y * width + x;
      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  // Step 3: Non-maximum suppression
  const nms = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      const angle = direction[idx] * 180 / Math.PI;
      const absAngle = angle < 0 ? angle + 180 : angle;

      let q = 0, r = 0;

      // Quantize angle to 4 directions
      if ((absAngle >= 0 && absAngle < 22.5) || (absAngle >= 157.5 && absAngle <= 180)) {
        // Horizontal edge — compare left and right
        q = magnitude[idx - 1];
        r = magnitude[idx + 1];
      } else if (absAngle >= 22.5 && absAngle < 67.5) {
        // Diagonal — compare top-right and bottom-left
        q = magnitude[(y - 1) * width + (x + 1)];
        r = magnitude[(y + 1) * width + (x - 1)];
      } else if (absAngle >= 67.5 && absAngle < 112.5) {
        // Vertical edge — compare top and bottom
        q = magnitude[(y - 1) * width + x];
        r = magnitude[(y + 1) * width + x];
      } else {
        // Diagonal — compare top-left and bottom-right
        q = magnitude[(y - 1) * width + (x - 1)];
        r = magnitude[(y + 1) * width + (x + 1)];
      }

      nms[idx] = (mag >= q && mag >= r) ? mag : 0;
    }
  }

  // Step 4: Hysteresis thresholding
  const edges = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);

  // Mark strong pixels first
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (nms[idx] >= highThreshold) {
        edges[idx] = 255;
      }
    }
  }

  // Trace from strong pixels to include connected weak pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (edges[idx] === 255 && !visited[idx]) {
        const stack = [idx];
        visited[idx] = 1;

        while (stack.length > 0) {
          const cur = stack.pop()!;
          const cy = Math.floor(cur / width);
          const cx = cur % width;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = cy + dy;
              const nx = cx + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                const nidx = ny * width + nx;
                if (!visited[nidx] && nms[nidx] >= lowThreshold) {
                  visited[nidx] = 1;
                  edges[nidx] = 255;
                  stack.push(nidx);
                }
              }
            }
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Run multi-scale Canny edge detection at low/medium/high sensitivity levels,
 * then combine the results by OR-ing the edge maps.
 *
 * This catches edges at different contrast levels:
 * - Low sensitivity: strong edges (ridges, eaves, clear roof-wall boundaries)
 * - Medium sensitivity: standard structural lines
 * - High sensitivity: thin/low-contrast edges (flat rubber roof boundaries,
 *   subtle membrane edges, faded lines on white TPO)
 *
 * Returns a combined edge map and per-scale edge maps for diagnostic use.
 */
function multiScaleCannyEdgeDetection(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { combined: Uint8Array; low: Uint8Array; medium: Uint8Array; high: Uint8Array } {
  const low = cannyEdgeDetection(grayscale, width, height, CANNY_SCALE_LOW.low, CANNY_SCALE_LOW.high);
  const medium = cannyEdgeDetection(grayscale, width, height, CANNY_SCALE_MEDIUM.low, CANNY_SCALE_MEDIUM.high);
  const high = cannyEdgeDetection(grayscale, width, height, CANNY_SCALE_HIGH.low, CANNY_SCALE_HIGH.high);

  // Combine: a pixel is an edge if detected at ANY scale
  const combined = new Uint8Array(width * height);
  for (let i = 0; i < combined.length; i++) {
    combined[i] = (low[i] | medium[i] | high[i]) & 255;
  }

  return { combined, low, medium, high };
}

/**
 * Strengthen edges within segmentation mask regions by dilating edges that
 * overlap with roof/wall masks. This helps thin roof boundaries show up
 * more clearly in the Hough accumulator.
 *
 * For flat roofs especially, the edge at the roof boundary may be very faint.
 * By boosting edge pixels that fall inside or near structure masks, we ensure
 * the Hough transform picks up these critical lines.
 */
function strengthenEdgesInMaskRegions(
  edges: Uint8Array,
  width: number,
  height: number,
  masks: SemanticSegmentationMask[],
  boostRadius: number = 2,
): Uint8Array {
  const strengthened = new Uint8Array(edges);

  // Build a quick lookup: which pixels are near a structure mask?
  const structureMask = new Uint8Array(width * height);

  for (const mask of masks) {
    if (mask.segmentationClass !== 'roof' && mask.segmentationClass !== 'wall' && mask.segmentationClass !== 'siding') continue;
    if (!mask.maskBounds) continue;

    const mb = mask.maskBounds;
    // Convert mask bounds from normalized (0-1000) to pixel coordinates
    const px = Math.round((mb.x / 1000) * width);
    const py = Math.round((mb.y / 1000) * height);
    const px2 = Math.round(((mb.x + mb.width) / 1000) * width);
    const py2 = Math.round(((mb.y + mb.height) / 1000) * height);

    // Mark all pixels within the mask bounding box (expanded by boostRadius)
    for (let y = Math.max(0, py - boostRadius); y < Math.min(height, py2 + boostRadius); y++) {
      for (let x = Math.max(0, px - boostRadius); x < Math.min(width, px2 + boostRadius); x++) {
        structureMask[y * width + x] = 1;
      }
    }
  }

  // For edge pixels that are within or near structure mask regions,
  // dilate them slightly to strengthen weak edges
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (structureMask[idx] && edges[idx] === 255) {
        // This is an edge pixel in a structure region — boost surrounding pixels
        for (let dy = -boostRadius; dy <= boostRadius; dy++) {
          for (let dx = -boostRadius; dx <= boostRadius; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              const nidx = ny * width + nx;
              // Boost nearby pixels that have even weak edge signal (from high-sensitivity Canny)
              strengthened[nidx] = 255;
            }
          }
        }
      }
    }
  }

  return strengthened;
}

/**
 * Suppress edge pixels that are NOT within or adjacent to structure mask regions.
 *
 * Pass 3D addition: After strengthening edges inside structure masks, this step
 * zeros out edges that fall outside a dilated structure region. This prevents
 * the Hough transform from finding lines in vegetation, ground texture, vehicle
 * edges, etc. — which was the primary source of rogue structural lines.
 *
 * Approach: Create a "structure region" binary mask by dilating all structure
 * mask bounding boxes by ~20px (normalized to image scale), then AND the edge
 * map with this mask. Only edges within structure regions survive.
 */
function suppressEdgesOutsideStructureMasks(
  edges: Uint8Array,
  width: number,
  height: number,
  masks: SemanticSegmentationMask[],
  dilationPx: number = 20,
): Uint8Array {
  const suppressed = new Uint8Array(edges);

  // Build a binary mask marking structure regions (dilated)
  const structureRegion = new Uint8Array(width * height);

  for (const mask of masks) {
    if (!mask.maskBounds) continue;
    // Only suppress around structure-qualified masks (roof, wall, siding, etc.)
    if (!STRUCTURE_QUALIFIED_CLASSES.has(mask.segmentationClass)) continue;

    const mb = mask.maskBounds;
    // Convert mask bounds from normalized (0-1000) to pixel coordinates
    const px = Math.round((mb.x / 1000) * width);
    const py = Math.round((mb.y / 1000) * height);
    const px2 = Math.round(((mb.x + mb.width) / 1000) * width);
    const py2 = Math.round(((mb.y + mb.height) / 1000) * height);

    // Dilate the bounding box by dilationPx to catch edges at mask boundaries
    for (let y = Math.max(0, py - dilationPx); y < Math.min(height, py2 + dilationPx); y++) {
      for (let x = Math.max(0, px - dilationPx); x < Math.min(width, px2 + dilationPx); x++) {
        structureRegion[y * width + x] = 1;
      }
    }
  }

  // AND edge map with structure region mask — only edges inside structure regions survive
  for (let i = 0; i < suppressed.length; i++) {
    if (!structureRegion[i]) {
      suppressed[i] = 0; // Zero out edges outside structure regions
    }
  }

  return suppressed;
}

/**
 * Apply probabilistic Hough line transform to detect lines in edge map.
 * Returns array of detected line segments in normalized coordinates.
 */
function houghLineTransform(
  edges: Uint8Array,
  width: number,
  height: number,
  minLineLength: number = MIN_LINE_LENGTH,
  maxLineGap: number = 10,
): LineSegment[] {
  const lines: LineSegment[] = [];

  // Build Hough accumulator
  const rhoMax = Math.ceil(Math.sqrt(width * width + height * height));
  const thetaBins = 180;
  const rhoBins = 2 * rhoMax + 1;
  const accumulator = new Int32Array(rhoBins * thetaBins);

  // Fill accumulator from edge pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 255) {
        for (let t = 0; t < thetaBins; t++) {
          const thetaRad = (t * Math.PI) / 180;
          const rho = Math.round(x * Math.cos(thetaRad) + y * Math.sin(thetaRad)) + rhoMax;
          accumulator[rho * thetaBins + t]++;
        }
      }
    }
  }

  // Find peaks in accumulator
  const threshold = Math.max(30, Math.floor(width * 0.05)); // Adaptive threshold — lowered for thin roof lines
  const peaks: Array<{ rhoIdx: number; thetaIdx: number; votes: number }> = [];

  for (let rhoIdx = 1; rhoIdx < rhoBins - 1; rhoIdx++) {
    for (let thetaIdx = 0; thetaIdx < thetaBins; thetaIdx++) {
      const votes = accumulator[rhoIdx * thetaBins + thetaIdx];
      if (votes >= threshold) {
        // Simple local maximum check (3x3 neighborhood)
        let isMax = true;
        for (let dr = -1; dr <= 1 && isMax; dr++) {
          for (let dt = -2; dt <= 2 && isMax; dt++) {
            if (dr === 0 && dt === 0) continue;
            const nr = rhoIdx + dr;
            const nt = ((thetaIdx + dt) % thetaBins + thetaBins) % thetaBins;
            if (nr >= 0 && nr < rhoBins) {
              if (accumulator[nr * thetaBins + nt] > votes) {
                isMax = false;
              }
            }
          }
        }
        if (isMax) {
          peaks.push({ rhoIdx, thetaIdx, votes });
        }
      }
    }
  }

  // Sort peaks by votes (descending)
  peaks.sort((a, b) => b.votes - a.votes);

  // Convert polar lines to line segments by tracing edge pixels
  const minLineLengthPx = Math.round(minLineLength / 1000 * Math.max(width, height));

  for (const peak of peaks.slice(0, 150)) { // Cap at 150 candidate lines per photo (increased for multi-scale)
    const rho = peak.rhoIdx - rhoMax;
    const thetaRad = (peak.thetaIdx * Math.PI) / 180;
    const cosT = Math.cos(thetaRad);
    const sinT = Math.sin(thetaRad);

    // Find the extent of edge pixels along this line
    const tolerance = 2; // pixels — tighter for better line precision
    const edgePoints: Array<{ x: number; y: number }> = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (edges[y * width + x] === 255) {
          const dist = Math.abs(x * cosT + y * sinT - rho);
          if (dist < tolerance) {
            edgePoints.push({ x, y });
          }
        }
      }
    }

    if (edgePoints.length < minLineLengthPx) continue;

    // Find the two farthest-apart points to define the line segment
    // Use a simplified approach: sort by one axis and take endpoints
    const sortedByX = [...edgePoints].sort((a, b) => a.x - b.x || a.y - b.y);
    const startPx = sortedByX[0];
    const endPx = sortedByX[sortedByX.length - 1];

    const segmentLengthPx = Math.sqrt(
      (endPx.x - startPx.x) ** 2 + (endPx.y - startPx.y) ** 2
    );

    if (segmentLengthPx < minLineLengthPx) continue;

    // Convert to normalized coordinates (0-1000)
    const start: NormalizedPoint = {
      x: Math.round((startPx.x / width) * 1000),
      y: Math.round((startPx.y / height) * 1000),
      coordinateSystem: 'normalized_image_0_1000',
    };
    const end: NormalizedPoint = {
      x: Math.round((endPx.x / width) * 1000),
      y: Math.round((endPx.y / height) * 1000),
      coordinateSystem: 'normalized_image_0_1000',
    };

    const angleDeg = Math.atan2(-(end.y - start.y), end.x - start.x) * (180 / Math.PI);
    const normalizedAngle = angleDeg < 0 ? angleDeg + 360 : angleDeg;

    lines.push({
      start,
      end,
      length: Math.round((segmentLengthPx / Math.max(width, height)) * 1000),
      angleDeg: normalizedAngle,
    });
  }

  // Merge nearly-collinear lines
  return mergeCollinearLines(lines);
}

/**
 * Merge lines that are nearly collinear, overlapping, or have small gaps.
 *
 * Uses perpendicular distance between line segments (not just midpoint proximity)
 * to determine if two collinear lines should be merged. This is critical for
 * roof lines that get broken by shadows, chimneys, or edge detector gaps.
 *
 * Two lines are merged if:
 * 1. Their angles differ by < 10° (tighter than before)
 * 2. The maximum perpendicular distance between them is < 15 (in normalized units)
 * 3. The gap between their closest endpoints is < 100 (allows bridging across
 *    small breaks from shadows, chimneys, or occlusions)
 */
function mergeCollinearLines(lines: LineSegment[]): LineSegment[] {
  if (lines.length <= 1) return lines;

  const merged: LineSegment[] = [];
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;

    let currentLine = lines[i];

    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j)) continue;

      const a1 = currentLine.angleDeg % 180;
      const a2 = lines[j].angleDeg % 180;
      const angleDiff = Math.min(Math.abs(a1 - a2), 180 - Math.abs(a1 - a2));

      if (angleDiff < 10) {
        // Compute perpendicular distance: how far apart are these parallel lines?
        const perpDist = maxPerpendicularDistance(currentLine, lines[j]);

        // Compute gap between nearest endpoints
        const gapDist = minEndpointGap(currentLine, lines[j]);

        // Merge if lines are nearly collinear (small perpendicular distance)
        // OR if they have a small gap that should be bridged
        if (perpDist < 15 || (perpDist < 25 && gapDist < 100)) {
          const combined = combineLines(currentLine, lines[j]);
          if (combined.length >= currentLine.length * 0.8) {
            currentLine = combined;
            used.add(j);
          }
        }
      }
    }

    merged.push(currentLine);
  }

  return merged;
}

/**
 * Compute the maximum perpendicular distance from line2's endpoints to line1.
 * This measures how far apart two "parallel" lines actually are.
 */
function maxPerpendicularDistance(line1: LineSegment, line2: LineSegment): number {
  // Direction vector of line1
  const dx = line1.end.x - line1.start.x;
  const dy = line1.end.y - line1.start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.001) return Infinity;

  // Normal vector (perpendicular to line1 direction)
  const nx = -dy / len;
  const ny = dx / len;

  // Project line2's endpoints onto the normal
  const d1 = Math.abs((line2.start.x - line1.start.x) * nx + (line2.start.y - line1.start.y) * ny);
  const d2 = Math.abs((line2.end.x - line1.start.x) * nx + (line2.end.y - line1.start.y) * ny);

  return Math.max(d1, d2);
}

/**
 * Compute the minimum distance between the closest endpoints of two lines.
 * This measures the "gap" between two collinear line segments.
 */
function minEndpointGap(line1: LineSegment, line2: LineSegment): number {
  const gaps = [
    dist(line1.start, line2.start),
    dist(line1.start, line2.end),
    dist(line1.end, line2.start),
    dist(line1.end, line2.end),
  ];
  return Math.min(...gaps);
}

/** Euclidean distance between two points. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Combine two line segments into one longer segment by taking the outermost endpoints.
 */
function combineLines(line1: LineSegment, line2: LineSegment): LineSegment {
  const points = [line1.start, line1.end, line2.start, line2.end];
  let maxDist = 0;
  let bestStart = line1.start;
  let bestEnd = line1.end;

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        maxDist = dist;
        bestStart = points[i];
        bestEnd = points[j];
      }
    }
  }

  const angleDeg = Math.atan2(-(bestEnd.y - bestStart.y), bestEnd.x - bestStart.x) * (180 / Math.PI);
  return {
    start: { ...bestStart, coordinateSystem: 'normalized_image_0_1000' },
    end: { ...bestEnd, coordinateSystem: 'normalized_image_0_1000' },
    length: Math.round(maxDist),
    angleDeg: angleDeg < 0 ? angleDeg + 360 : angleDeg,
  };
}

// ---------------------------------------------------------------------------
// Mask filtering
// ---------------------------------------------------------------------------

/**
 * Ray-casting algorithm to check if a point is inside a polygon.
 * Polygon vertices are in normalized coordinates (0-1000).
 */
function pointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
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
 * Check if a line segment overlaps with a segmentation mask.
 * Samples points along the line and checks if they fall inside the mask polygon.
 * Also checks bounding-box proximity for thin masks (e.g. flat roof strips)
 * where the line may run along the edge rather than through the interior.
 *
 * Pass 3D tightening: proximity tolerance reduced from 30% to 10%, minimum
 * 3 polygon hits required (was 2), minimum 5 proximity zone hits required
 * (was 0). This prevents lines on nearby vegetation/vehicles from passing
 * the overlap test via the proximity fallback.
 */
export function lineOverlapsMask(line: LineSegment, mask: SemanticSegmentationMask): boolean {
  const poly = mask.polygon;

  if (poly.length < 3) return false;

  // Sample points along the line for polygon hit test
  const samples = 20;
  let hits = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = line.start.x * (1 - t) + line.end.x * t;
    const y = line.start.y * (1 - t) + line.end.y * t;

    if (pointInPolygon({ x, y }, poly)) {
      hits++;
    }
  }

  // Pass 3D: require 3+ polygon hits (was 2) — ensures the line actually
  // passes through the mask interior, not just grazing a corner
  if (hits >= 3) return true;

  // For thin masks (flat roof strips, gutters, fascia), the line may run
  // along the mask edge without interior hits. Check bounding-box proximity
  // as a fallback: if the line passes within a small distance of the mask
  // bounds AND is the right class, count it as overlapping.
  //
  // Pass 3D: tolerance reduced from 30% to 10%, and minimum 5 proximity
  // zone hits required (was 0). A line that merely passes near a mask
  // with only 1-2 sample points in the tolerance zone should NOT qualify.
  if (mask.maskBounds && hits < 3) {
    const mb = mask.maskBounds;
    // Pass 3D: 10% of mask dimension (was 30% — far too loose)
    const tolerance = Math.max(mb.width, mb.height) * 0.1;
    let proximityHits = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const px = line.start.x * (1 - t) + line.end.x * t;
      const py = line.start.y * (1 - t) + line.end.y * t;

      if (
        px >= mb.x - tolerance && px <= mb.x + mb.width + tolerance &&
        py >= mb.y - tolerance && py <= mb.y + mb.height + tolerance
      ) {
        proximityHits++;
      }
    }

    // Only count proximity for structure classes that produce thin masks
    const thinClasses: Set<string> = new Set(['roof', 'fascia', 'soffit', 'gutter', 'railing']);
    if (thinClasses.has(mask.segmentationClass) && proximityHits >= 5) {
      return true;
    }
  }

  return false;
}

/**
 * Get all masks for a specific file ID, filtered to structure-qualified classes only.
 */
function getStructureMasksForFile(fileId: string, masks: SemanticSegmentationMask[]): SemanticSegmentationMask[] {
  return masks.filter(m =>
    m.fileId === fileId &&
    !REJECTED_CLASSES.has(m.segmentationClass) &&
    !m.isOccluder
  );
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/**
 * Classify a line segment based on its orientation, position, and overlapping masks.
 */
export function classifyLine(
  line: LineSegment,
  masks: SemanticSegmentationMask[],
  allRoofMasks?: SemanticSegmentationMask[],
): StructuralLineType | null {
  const angleDeg = line.angleDeg;
  const normalizedAngle = angleDeg % 180;
  const isHorizontal = normalizedAngle < 20 || normalizedAngle > 160;
  const isVertical = Math.abs(normalizedAngle - 90) < 20;
  const isDiagonal = !isHorizontal && !isVertical;

  const avgY = (line.start.y + line.end.y) / 2;

  // Check what class of mask this line passes through
  const overlappingMasks = masks.filter(m => lineOverlapsMask(line, m));
  const overlappingClasses = new Set(overlappingMasks.map(m => m.segmentationClass));

  // Pass 3D: Minimum overlap threshold — if fewer than 3 out of 20 sample points
  // hit ANY overlapping mask polygon interior, reject the line. This prevents
  // lines that barely graze a structure mask from being classified as structural.
  const OVERLAP_SAMPLES = 20;
  const MIN_INTERIOR_HITS = 3;
  let totalInteriorHits = 0;
  for (let i = 0; i <= OVERLAP_SAMPLES; i++) {
    const t = i / OVERLAP_SAMPLES;
    const x = line.start.x * (1 - t) + line.end.x * t;
    const y = line.start.y * (1 - t) + line.end.y * t;
    for (const m of overlappingMasks) {
      if (m.polygon.length >= 3 && pointInPolygon({ x, y }, m.polygon)) {
        totalInteriorHits++;
        break; // Count each sample point once even if it hits multiple masks
      }
    }
  }
  if (totalInteriorHits < MIN_INTERIOR_HITS) return null;

  const hasRoof = overlappingClasses.has('roof');
  const hasWall = overlappingClasses.has('wall') || overlappingClasses.has('siding');
  const hasFascia = overlappingClasses.has('fascia') || overlappingClasses.has('soffit') || overlappingClasses.has('gutter');

  // Compute relative position within roof masks for ridge/eave disambiguation.
  const roofMasks = overlappingMasks.filter(m => m.segmentationClass === 'roof');
  let relativeRoofY = 0.5;
  if (roofMasks.length > 0) {
    let roofMinY = Infinity, roofMaxY = -Infinity;
    for (const rm of roofMasks) {
      if (rm.maskBounds) {
        roofMinY = Math.min(roofMinY, rm.maskBounds.y);
        roofMaxY = Math.max(roofMaxY, rm.maskBounds.y + rm.maskBounds.height);
      }
    }
    if (roofMinY < Infinity && roofMaxY > roofMinY) {
      relativeRoofY = (avgY - roofMinY) / (roofMaxY - roofMinY);
      relativeRoofY = Math.max(0, Math.min(1, relativeRoofY));
    }
  }

  // ── Valley and hip detection ──
  // Valleys occur at the intersection of two roof planes (internal corner,
  // water flows INTO it). Hips occur where two roof planes meet at an external
  // corner (water flows AWAY). Detection strategy:
  //
  // A diagonal line that overlaps with MULTIPLE separate roof masks is likely
  // a valley or hip — it runs along the seam between two roof planes.
  // - Valley: line is in the LOWER portion of the roof area (drains downward)
  // - Hip: line is in the UPPER portion of the roof area (forms a peak)
  //
  // We also check if the line runs along the BOUNDARY between two adjacent
  // roof masks (not just overlapping one mask that happens to be segmented
  // as a single region).
  if (hasRoof && isDiagonal) {
    const roofMaskCount = roofMasks.length;
    // Use all roof masks (not just overlapping) for boundary detection
    const allRoof = allRoofMasks ?? roofMasks;

    // Check if the line runs along the boundary between two adjacent roof masks
    const adjacentRoofCount = countAdjacentRoofMasks(line, allRoof);

    if (adjacentRoofCount >= 2 || roofMaskCount >= 2) {
      // Line is at the intersection of 2+ roof planes
      if (relativeRoofY > 0.55) {
        return 'valley'; // Lower roof area — water drains here
      } else if (relativeRoofY < 0.45) {
        return 'hip'; // Upper roof area — forms a peak
      } else {
        // Middle of roof — ambiguous. Default to valley (more common, more important)
        return 'valley';
      }
    }
  }

  // Classification logic — roof lines first (most important)
  if (hasRoof) {
    if (isHorizontal) {
      if (relativeRoofY < 0.4) {
        return 'ridge'; // Upper portion of roof → ridge
      } else {
        return 'eave'; // Lower portion of roof → eave
      }
    } else if (isDiagonal) {
      // If not caught by valley/hip above, default to rake
      return 'rake'; // Diagonal roof edge
    } else if (isVertical) {
      return 'rake'; // Vertical could be rake in perspective
    }
  }

  // Wall lines
  if (hasWall) {
    if (isVertical) {
      return 'wall_vertical';
    } else if (isHorizontal) {
      return 'eave'; // Wall-roof boundary
    }
  }

  // Fascia/soffit/gutter lines
  if (hasFascia) {
    if (isHorizontal) {
      return 'eave';
    }
  }

  // Pass 3D: REMOVED catch-all fallback that classified ANY overlapping line
  // as structural (eave/rake/wall_vertical). Lines must overlap a recognized
  // structure surface (roof, wall, siding, fascia, soffit, gutter) to be
  // classified. Lines on other structure-qualified classes (chimney, vent_pipe)
  // without roof/wall/fascia overlap are not classified — a missing line is
  // better than a rogue line.

  return null; // Don't classify if not on structure
}

/**
 * Count how many roof masks the line runs along the boundary of.
 * A line that passes near the edges of 2+ separate roof masks is likely
 * a valley or hip line.
 *
 * Strategy: For each roof mask, check if the line's sample points fall
 * near the mask boundary (within 15% of mask dimension). If the line
 * is near the boundary of 2+ different roof masks, it's an intersection line.
 */
function countAdjacentRoofMasks(line: LineSegment, roofMasks: SemanticSegmentationMask[]): number {
  let adjacentCount = 0;
  const samples = 10;

  for (const mask of roofMasks) {
    if (!mask.maskBounds) continue;
    const mb = mask.maskBounds;

    // Check if the line passes near the boundary of this mask
    let boundaryHits = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const px = line.start.x * (1 - t) + line.end.x * t;
      const py = line.start.y * (1 - t) + line.end.y * t;

      // Is this point near the mask boundary?
      const nearLeftEdge = Math.abs(px - mb.x) < mb.width * 0.15;
      const nearRightEdge = Math.abs(px - (mb.x + mb.width)) < mb.width * 0.15;
      const nearTopEdge = Math.abs(py - mb.y) < mb.height * 0.15;
      const nearBottomEdge = Math.abs(py - (mb.y + mb.height)) < mb.height * 0.15;

      // Point must be within the mask bounding box AND near an edge
      const inBox = px >= mb.x - mb.width * 0.05 && px <= mb.x + mb.width * 1.05 &&
                     py >= mb.y - mb.height * 0.05 && py <= mb.y + mb.height * 1.05;

      if (inBox && (nearLeftEdge || nearRightEdge || nearTopEdge || nearBottomEdge)) {
        boundaryHits++;
      }
    }

    // If 3+ sample points are near the mask boundary, this line runs along it
    if (boundaryHits >= 3) {
      adjacentCount++;
    }
  }

  return adjacentCount;
}

/**
 * Compute confidence score for a classified line.
 */
/**
 * Deduplicate near-parallel lines that the Hough detector often finds along
 * the same structural edge (2-3 nearly identical parallel lines).
 *
 * Pass 3D addition: Merges lines that are:
 * - Same lineType
 * - Within 10 normalized units of each other (start/end point proximity)
 * - Within 5° of each other in angle
 *
 * Keeps the higher-confidence line, discards duplicates.
 * This reduces visual clutter from duplicate lines along the same edge.
 */
export function deduplicateNearParallelLines<T extends LineSegment & { lineType: StructuralLineType; maskSupport: number }>(
  lines: T[],
): T[] {
  if (lines.length <= 1) return lines;

  const ANGLE_THRESHOLD_DEG = 5;
  const DISTANCE_THRESHOLD = 10; // normalized units (0-1000)

  const result: T[] = [];

  for (const line of lines) {
    let isDuplicate = false;

    for (const existing of result) {
      // Must be same type to be considered duplicates
      if (existing.lineType !== line.lineType) continue;

      // Check angle similarity
      const angleDiff = Math.abs(line.angleDeg - existing.angleDeg);
      const normalizedAngleDiff = Math.min(angleDiff, 180 - angleDiff);
      if (normalizedAngleDiff > ANGLE_THRESHOLD_DEG) continue;

      // Check spatial proximity — are start/end points close?
      const startDist = Math.sqrt(
        (line.start.x - existing.start.x) ** 2 + (line.start.y - existing.start.y) ** 2
      );
      const endDist = Math.sqrt(
        (line.end.x - existing.end.x) ** 2 + (line.end.y - existing.end.y) ** 2
      );
      // Also check cross-distances (line start vs existing end and vice versa)
      const crossDist1 = Math.sqrt(
        (line.start.x - existing.end.x) ** 2 + (line.start.y - existing.end.y) ** 2
      );
      const crossDist2 = Math.sqrt(
        (line.end.x - existing.start.x) ** 2 + (line.end.y - existing.start.y) ** 2
      );
      const minDist = Math.min(startDist, endDist, crossDist1, crossDist2);

      if (minDist <= DISTANCE_THRESHOLD) {
        // This line is a near-duplicate of an existing line — skip it
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(line);
    }
  }

  return result;
}

function computeLineConfidence(
  line: LineSegment,
  lineType: StructuralLineType,
  maskCount: number,
): number {
  // Base confidence from line length (longer = more confident)
  const lengthScore = Math.min(40, (line.length / 300) * 40);

  // Bonus for mask support
  const maskBonus = Math.min(25, maskCount * 8);

  // Type-specific bonus
  const typeBonus: Record<StructuralLineType, number> = {
    ridge: 25,
    eave: 20,
    rake: 15,
    valley: 20,  // Valleys are critical for roof geometry
    hip: 18,     // Hips are important for multi-plane roofs
    wall_vertical: 15,
    wall_bottom_edge: 18,  // Foundation line — now actively inferred behind occluders
  };

  const confidence = Math.round(
    Math.min(100, lengthScore + maskBonus + typeBonus[lineType])
  );

  return Math.max(MIN_CONFIDENCE, confidence);
}

// ---------------------------------------------------------------------------
// Wall foundation line inference — detect wall bottom edge behind occluders
// ---------------------------------------------------------------------------

/**
 * Infer the wall foundation (bottom edge) line even when occluded by
 * cars, bushes, decks, windows, doors, etc.
 *
 * Strategy:
 * 1. Find all wall-class masks in the image
 * 2. For each wall mask, find the bottom-most extent of the polygon
 *    (the visible wall-ground boundary where the wall mask ends)
 * 3. Find occluder masks that overlap the wall's bottom region
 * 4. Extrapolate the wall bottom edge through occluded gaps by:
 *    a. Finding the leftmost and rightmost visible wall bottom points
 *    b. Interpolating a horizontal line between them
 *    c. Extending the line to cover the full horizontal span of the wall
 *
 * Returns an array of inferred wall_bottom_edge line segments (in normalized
 * 0-1000 coordinate space), or empty array if no wall masks are found.
 */
export function inferWallBottomEdge(
  masks: SemanticSegmentationMask[],
  imageWidth: number,
  imageHeight: number,
): Array<LineSegment & { lineType: 'wall_bottom_edge'; maskSupport: number }> {
  const results: Array<LineSegment & { lineType: 'wall_bottom_edge'; maskSupport: number }> = [];

  // Collect wall masks
  const wallMasks = masks.filter(m => WALL_CLASSES.has(m.segmentationClass));
  if (wallMasks.length === 0) return results;

  // Collect occluder masks that could block the foundation line
  const occluderMasks = masks.filter(m => WALL_FOUNDATION_OCCLUDER_CLASSES.has(m.segmentationClass));

  for (const wallMask of wallMasks) {
    const poly = wallMask.polygon;
    if (poly.length < 3) continue;

    // Find the bottom-most points of the wall polygon.
    // We want points along the bottom edge of the polygon — points whose
    // Y coordinate is in the bottom 20% of the polygon's Y range.
    const yValues = poly.map(p => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const yRange = maxY - minY;
    if (yRange < 20) continue; // Too flat, not a wall

    const bottomThreshold = maxY - yRange * 0.2;

    // Collect bottom-edge points (points in the bottom 20% of the polygon)
    const bottomPoints = poly.filter(p => p.y >= bottomThreshold);
    if (bottomPoints.length < 2) continue;

    // Find the leftmost and rightmost bottom points
    const leftPoint = bottomPoints.reduce((a, b) => a.x < b.x ? a : b);
    const rightPoint = bottomPoints.reduce((a, b) => a.x > b.x ? a : b);

    // The wall bottom edge Y should be at the bottom of the visible wall.
    // Use the median Y of the bottom points for robustness against outliers.
    const sortedY = bottomPoints.map(p => p.y).sort((a, b) => a - b);
    const medianY = sortedY[Math.floor(sortedY.length / 2)];

    // Check if occluders overlap the wall's bottom region
    const wallBottomRegion = {
      x: leftPoint.x,
      y: medianY - 20,
      width: rightPoint.x - leftPoint.x,
      height: 40,
    };

    const hasOccluders = occluderMasks.some(occ => {
      if (!occ.maskBounds) return false;
      const mb = occ.maskBounds;
      // Check bounding box overlap with wall bottom region
      return (
        mb.x < wallBottomRegion.x + wallBottomRegion.width &&
        mb.x + mb.width > wallBottomRegion.x &&
        mb.y < wallBottomRegion.y + wallBottomRegion.height &&
        mb.y + mb.height > wallBottomRegion.y
      );
    });

    // Extend the line slightly beyond the wall mask edges to ensure
    // coverage of the full foundation line, including occluded portions.
    // Extension: 5% of the wall width on each side (clamped to image bounds).
    const wallWidth = rightPoint.x - leftPoint.x;
    const extension = Math.min(wallWidth * 0.05, 30);
    const startX = Math.max(0, leftPoint.x - extension);
    const endX = Math.min(1000, rightPoint.x + extension);

    // Only create a wall_bottom_edge line if:
    // - The line is long enough (> 50 normalized units ≈ 5% of image width)
    // - The wall is in the lower half of the image (walls are typically below midpoint)
    const lineLength = endX - startX;
    if (lineLength < 50 || minY > 700) continue;

    // Compute confidence bonus for occluder-aware inference
    // If we found occluders blocking the wall bottom, we get a bonus because
    // this line is filling in a gap that edge detection alone would miss.
    const occluderBonus = hasOccluders ? 8 : 0;
    const maskSupport = wallMasks.length + occluderMasks.filter(occ => {
      if (!occ.maskBounds) return false;
      const mb = occ.maskBounds;
      return (
        mb.x < wallBottomRegion.x + wallBottomRegion.width &&
        mb.x + mb.width > wallBottomRegion.x
      );
    }).length;

    results.push({
      start: { x: startX, y: medianY, coordinateSystem: 'normalized_image_0_1000' },
      end: { x: endX, y: medianY, coordinateSystem: 'normalized_image_0_1000' },
      length: lineLength,
      angleDeg: 0,  // Horizontal line — angle is always 0°
      lineType: 'wall_bottom_edge',
      maskSupport: maskSupport + occluderBonus,
    });
  }

  // Deduplicate overlapping wall_bottom_edge lines
  // If two wall masks produce lines at similar Y positions, merge them
  const deduped: typeof results = [];
  for (const line of results) {
    const existing = deduped.find(d =>
      Math.abs(d.start.y - line.start.y) < 30 &&
      Math.abs(d.end.y - line.end.y) < 30
    );
    if (existing) {
      // Merge: extend to cover both lines' horizontal spans
      existing.start.x = Math.min(existing.start.x, line.start.x);
      existing.end.x = Math.max(existing.end.x, line.end.x);
      existing.length = existing.end.x - existing.start.x;
      existing.maskSupport = Math.max(existing.maskSupport, line.maskSupport);
    } else {
      deduped.push({ ...line });
    }
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// Main worker function (ASYNC — uses sharp for image loading)
// ---------------------------------------------------------------------------

/**
 * Run the line extraction worker on a set of photos and segmentation masks.
 *
 * For each photo:
 * 1. Load the original image and convert to grayscale
 * 2. Run Canny edge detection on the image
 * 3. Run Hough line transform to detect candidate structural lines
 * 4. Filter lines by overlap with SAM2 segmentation masks
 * 5. Classify filtered lines by orientation + position
 * 6. Create validated artifacts
 */
export async function runLineExtractionWorker(input: LineExtractionWorkerInput): Promise<LineExtractionWorkerOutput> {
  const timings: Record<string, number> = {};
  const artifacts: StructuralLineCandidate[] = [];

  const minLineLength = input.config?.minLineLength ?? MIN_LINE_LENGTH;
  const maxLinesPerPhoto = input.config?.maxLinesPerPhoto ?? MAX_LINES_PER_PHOTO;
  const minConfidence = input.config?.minConfidence ?? MIN_CONFIDENCE;

  const filterStats: LineExtractionFilterStats = {
    photosProcessed: 0,
    photosSkipped: 0,
    totalLinesDetected: 0,
    linesOnStructure: 0,
    linesClassified: 0,
    linesKept: 0,
  };

  const t0 = Date.now();

  // Group masks by file ID
  const masksByFile = new Map<string, SemanticSegmentationMask[]>();
  for (const mask of input.masks) {
    if (!masksByFile.has(mask.fileId)) {
      masksByFile.set(mask.fileId, []);
    }
    masksByFile.get(mask.fileId)!.push(mask);
  }

  // Process each photo that has both image bytes AND masks
  for (const photo of input.sourcePhotos) {
    const { fileId } = photo;
    const imageBytes = input.imageBytesMap[fileId];
    const fileMasks = masksByFile.get(fileId);

    if (!imageBytes) {
      console.warn(`[LineExtraction v3] No image bytes for fileId=${fileId}, skipping`);
      filterStats.photosSkipped++;
      continue;
    }

    if (!fileMasks || fileMasks.length === 0) {
      console.warn(`[LineExtraction v3] No masks for fileId=${fileId}, skipping`);
      filterStats.photosSkipped++;
      continue;
    }

    const tPhoto = Date.now();

    try {
      // Step 1: Load grayscale image (async — uses sharp) at higher resolution
      const { grayscale, width, height } = await loadGrayscaleImage(imageBytes);

      // Step 2: Multi-scale Canny edge detection
      // Run Canny at three sensitivity levels and combine for maximum coverage
      const { combined: multiEdges } = multiScaleCannyEdgeDetection(grayscale, width, height);

      // Step 2b: Strengthen edges within mask regions
      // This boosts faint roof boundaries that the multi-scale Canny may detect weakly
      const structureMasks = getStructureMasksForFile(fileId, fileMasks);
      const strengthened = strengthenEdgesInMaskRegions(multiEdges, width, height, structureMasks);

      // Step 2c (Pass 3D): Suppress edges outside structure mask regions
      // This prevents Hough from finding lines in vegetation, ground texture, vehicle edges, etc.
      const edges = suppressEdgesOutsideStructureMasks(strengthened, width, height, structureMasks);

      // Step 3: Hough line transform (with lowered thresholds for thin roof edges)
      const detectedLines = houghLineTransform(edges, width, height, minLineLength);
      filterStats.totalLinesDetected += detectedLines.length;

      // Step 4: Filter lines by mask overlap — keep only lines on structure
      const structureLines = detectedLines.filter(line =>
        structureMasks.some(mask => lineOverlapsMask(line, mask))
      );
      filterStats.linesOnStructure += structureLines.length;

      // Step 5: Classify lines (with valley/hip detection)
      // Pass all roof masks separately for valley/hip boundary analysis
      const allRoofMasks = fileMasks.filter(m => m.segmentationClass === 'roof');
      const classified: Array<LineSegment & { lineType: StructuralLineType; maskSupport: number }> = [];
      for (const line of structureLines) {
        const lineType = classifyLine(line, structureMasks, allRoofMasks);
        if (lineType) {
          const maskSupport = structureMasks.filter(m => lineOverlapsMask(line, m)).length;
          classified.push({ ...line, lineType, maskSupport });
        }
      }
      filterStats.linesClassified += classified.length;

      // Step 5b: Infer wall bottom edge (foundation line) behind occluders
      // The Hough detector rarely finds wall-ground boundaries because cars,
      // bushes, decks, windows, and doors occlude the foundation line.
      // This function explicitly infers the wall bottom edge from mask geometry.
      const inferredWallBottoms = inferWallBottomEdge(fileMasks, width, height);
      for (const inferred of inferredWallBottoms) {
        // Check if we already have a Hough-detected wall_bottom_edge near this Y
        const existingWallBottom = classified.find(c =>
          c.lineType === 'wall_bottom_edge' &&
          Math.abs(c.start.y - inferred.start.y) < 25 &&
          Math.abs(c.end.y - inferred.end.y) < 25
        );
        if (!existingWallBottom) {
          classified.push(inferred);
        } else {
          // Merge: extend existing line to cover inferred span
          existingWallBottom.start.x = Math.min(existingWallBottom.start.x, inferred.start.x);
          existingWallBottom.end.x = Math.max(existingWallBottom.end.x, inferred.end.x);
          existingWallBottom.length = existingWallBottom.end.x - existingWallBottom.start.x;
          existingWallBottom.maskSupport = Math.max(existingWallBottom.maskSupport, inferred.maskSupport);
        }
      }

      // Step 5c (Pass 3D): Deduplicate near-parallel lines
      // The Hough detector often finds 2-3 nearly identical parallel lines along
      // the same edge. Merge them — keep the highest-confidence candidate.
      const deduped = deduplicateNearParallelLines(classified);

      // Step 6: Score, cap, and create artifacts
      const scored = deduped.map(c => ({
        ...c,
        confidence: computeLineConfidence(c, c.lineType, c.maskSupport),
      }));

      // Sort by confidence (descending) and cap per photo
      scored.sort((a, b) => b.confidence - a.confidence);
      const kept = scored.slice(0, maxLinesPerPhoto).filter(s => s.confidence >= minConfidence);

      for (let i = 0; i < kept.length; i++) {
        const { lineType, start, end, confidence, maskSupport } = kept[i];
        const lineId = `line-${fileId}-${lineType}-${i}`;

        const candidate: StructuralLineCandidate = {
          artifactType: 'structural_line_candidate',
          id: lineId,
          fileId,
          lineType,
          start: { x: start.x, y: start.y, coordinateSystem: 'normalized_image_0_1000' },
          end: { x: end.x, y: end.y, coordinateSystem: 'normalized_image_0_1000' },
          confidence,
          sourceMaskId: structureMasks[0]?.id,
          workerVersion: LINE_EXTRACTION_WORKER_VERSION,
          authority: { ...REVIEW_ONLY_AUTHORITY },
          limitations: [...LINE_EXTRACTION_LIMITATIONS],
        };

        const validationResult = validateStructuralLineCandidate(candidate);
        if (validationResult.valid) {
          artifacts.push(validationResult.data);
        }
      }

      filterStats.linesKept += kept.length;
      filterStats.photosProcessed++;

      console.info(
        `[LineExtraction v3] fileId=${fileId}: ${detectedLines.length} detected → ${structureLines.length} on structure → ${kept.length} kept (conf≥${minConfidence})`,
      );

    } catch (err) {
      console.error(`[LineExtraction v3] Failed to process fileId=${fileId}:`, err);
      filterStats.photosSkipped++;
    }

    timings[fileId] = Date.now() - tPhoto;
  }

  timings['total'] = Date.now() - t0;

  console.info(
    `[LineExtraction v3] Total: ${artifacts.length} lines from ${filterStats.photosProcessed} photos in ${timings['total']}ms`,
  );

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: LINE_EXTRACTION_WORKER_VERSION,
    filterStats,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing masks
// ---------------------------------------------------------------------------

/**
 * Run the line extraction worker from a standard GeometryReconstructionInput
 * and a set of already-computed segmentation masks.
 *
 * Now ASYNC and requires imageBytesMap from the segmentation stage.
 */
export async function runLineExtractionFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
  imageBytesMap: Record<string, Buffer>,
): Promise<GeometryReconstructionArtifact[]> {
  const workerInput: LineExtractionWorkerInput = {
    surveyId: input.surveyId,
    masks,
    imageBytesMap,
    sourcePhotos: input.sourcePhotos.map(p => ({ fileId: p.fileId, fileUrl: p.fileUrl })),
    config: input.config as LineExtractionWorkerInput['config'] | undefined,
  };

  const output = await runLineExtractionWorker(workerInput);
  return output.artifacts;
}