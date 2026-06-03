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

export const LINE_EXTRACTION_WORKER_VERSION = '3.0.0-image-based-edge-detection';

/** Standard limitations for line extraction artifacts. */
const LINE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Image-based edge detection using Canny + Hough transform',
  'Line type classification is orientation-based heuristic — may misclassify complex roof geometries',
  'No vanishing-point or perspective correction applied',
  'Lines filtered by overlap with SAM2 segmentation masks',
  'Per-photo cap limits line candidates to prevent edge proliferation',
];

/** Minimum line length in normalized units (0-1000). */
const MIN_LINE_LENGTH = 50;

/** Maximum number of lines to extract per photo. */
const MAX_LINES_PER_PHOTO = 20;

/** Minimum confidence threshold for lines (0-100). */
const MIN_CONFIDENCE = 40;

/** Canny edge detection threshold range. */
const CANNY_LOW_THRESHOLD = 50;
const CANNY_HIGH_THRESHOLD = 150;

// ---------------------------------------------------------------------------
// Structure-qualified classes (for filtering)
// ---------------------------------------------------------------------------

/** Classes that produce structural lines when a line overlaps their mask. */
const STRUCTURE_QUALIFIED_CLASSES: ReadonlySet<string> = new Set([
  'roof',
  'wall',
  'siding',
  'fascia',
  'soffit',
  'gutter',
  'porch',
  'deck',
]);

/** Classes that never produce structural lines. */
const REJECTED_CLASSES: ReadonlySet<string> = new Set([
  'sky',
  'tree',
  'trees',
  'grass',
  'ground',
  'driveway',
  'gravel',
  'sidewalk',
  'car',
  'truck',
  'equipment',
  'unknown',
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
interface LineSegment {
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
async function loadGrayscaleImage(imageBytes: Buffer, targetWidth: number = 500): Promise<{
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
  const threshold = Math.max(50, Math.floor(width * 0.08)); // Adaptive threshold
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

  for (const peak of peaks.slice(0, 100)) { // Cap at 100 candidate lines per photo
    const rho = peak.rhoIdx - rhoMax;
    const thetaRad = (peak.thetaIdx * Math.PI) / 180;
    const cosT = Math.cos(thetaRad);
    const sinT = Math.sin(thetaRad);

    // Find the extent of edge pixels along this line
    const tolerance = 3; // pixels
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
 * Merge lines that are nearly collinear and overlapping.
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

      if (angleDiff < 12) {
        // Check proximity: are the midpoints close enough?
        const midA = {
          x: (currentLine.start.x + currentLine.end.x) / 2,
          y: (currentLine.start.y + currentLine.end.y) / 2,
        };
        const midB = {
          x: (lines[j].start.x + lines[j].end.x) / 2,
          y: (lines[j].start.y + lines[j].end.y) / 2,
        };
        const midDist = Math.sqrt((midA.x - midB.x) ** 2 + (midA.y - midB.y) ** 2);

        if (midDist < 80) { // Close enough to merge
          const combined = combineLines(currentLine, lines[j]);
          if (combined.length >= currentLine.length) {
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
 */
function lineOverlapsMask(line: LineSegment, mask: SemanticSegmentationMask): boolean {
  const poly = mask.polygon;

  if (poly.length < 3) return false;

  const samples = 20;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = line.start.x * (1 - t) + line.end.x * t;
    const y = line.start.y * (1 - t) + line.end.y * t;

    if (pointInPolygon({ x, y }, poly)) {
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
function classifyLine(line: LineSegment, masks: SemanticSegmentationMask[]): StructuralLineType | null {
  const angleDeg = line.angleDeg;
  const normalizedAngle = angleDeg % 180;
  const isHorizontal = normalizedAngle < 20 || normalizedAngle > 160;
  const isVertical = Math.abs(normalizedAngle - 90) < 20;
  const isDiagonal = !isHorizontal && !isVertical;

  const avgY = (line.start.y + line.end.y) / 2;

  // Check what class of mask this line passes through
  const overlappingMasks = masks.filter(m => lineOverlapsMask(line, m));
  const overlappingClasses = new Set(overlappingMasks.map(m => m.segmentationClass));

  const hasRoof = overlappingClasses.has('roof');
  const hasWall = overlappingClasses.has('wall') || overlappingClasses.has('siding');
  const hasFascia = overlappingClasses.has('fascia') || overlappingClasses.has('soffit') || overlappingClasses.has('gutter');

  // Classification logic — roof lines first (most important)
  if (hasRoof) {
    if (isHorizontal) {
      if (avgY < 350) {
        return 'ridge'; // Upper roof horizontal line
      } else {
        return 'eave'; // Lower roof horizontal line
      }
    } else if (isDiagonal) {
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

  // Other structure classes
  if (overlappingClasses.size > 0) {
    if (isHorizontal) return 'eave';
    if (isVertical) return 'wall_vertical';
    if (isDiagonal) return 'rake';
  }

  return null; // Don't classify if not on structure
}

/**
 * Compute confidence score for a classified line.
 */
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
    wall_vertical: 15,
    wall_bottom_edge: 10,
  };

  const confidence = Math.round(
    Math.min(100, lengthScore + maskBonus + typeBonus[lineType])
  );

  return Math.max(MIN_CONFIDENCE, confidence);
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
      // Step 1: Load grayscale image (async — uses sharp)
      const { grayscale, width, height } = await loadGrayscaleImage(imageBytes, 500);

      // Step 2: Canny edge detection
      const edges = cannyEdgeDetection(grayscale, width, height);

      // Step 3: Hough line transform
      const detectedLines = houghLineTransform(edges, width, height, minLineLength);
      filterStats.totalLinesDetected += detectedLines.length;

      // Step 4: Filter lines by mask overlap — keep only lines on structure
      const structureMasks = getStructureMasksForFile(fileId, fileMasks);
      const structureLines = detectedLines.filter(line =>
        structureMasks.some(mask => lineOverlapsMask(line, mask))
      );
      filterStats.linesOnStructure += structureLines.length;

      // Step 5: Classify lines
      const classified: Array<LineSegment & { lineType: StructuralLineType; maskSupport: number }> = [];
      for (const line of structureLines) {
        const lineType = classifyLine(line, structureMasks);
        if (lineType) {
          const maskSupport = structureMasks.filter(m => lineOverlapsMask(line, m)).length;
          classified.push({ ...line, lineType, maskSupport });
        }
      }
      filterStats.linesClassified += classified.length;

      // Step 6: Score, cap, and create artifacts
      const scored = classified.map(c => ({
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