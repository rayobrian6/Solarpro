/**
 * Roof Geometry Extractor — real roof shape detection from survey photos.
 *
 * This module replaces the 96×96 edge-density heuristic in
 * `openSourcePhotoVisionWorker.ts` with actual contour-based geometry
 * extraction at 512×512 resolution.
 *
 * Pipeline:
 *   1. Resize to 512×512 grayscale
 *   2. Gaussian blur (σ=1.4) for noise suppression
 *   3. Sobel gradient magnitude → Canny-style edge detection
 *   4. Morphological CLOSING: dilate edges heavily to fill enclosed regions,
 *      then erode back — this converts thin edge outlines into filled regions
 *   5. Connected component labeling on the FILLED region map (not edge map)
 *   6. Contour tracing from filled regions → polygon outlines
 *   7. Convex hull ordering for robust polygon construction
 *   8. Douglas-Peucker simplification → clean polygons
 *   9. Classify contours by size, position, aspect ratio
 *  10. Emit real NormalizedRegion / NormalizedLine candidates
 *
 * KEY FIX (Session 6): The old pipeline ran connected component labeling on
 * the DILATED BINARY EDGE MAP, which produced thin boundary outlines (ring-
 * shaped contours) instead of filled interior regions. The new pipeline applies
 * morphological closing (dilate heavily → erode back) to fill edge-enclosed
 * regions, then labels the filled image to get actual roof plane regions.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These candidates are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import type { NormalizedRegion, NormalizedLine } from './overlayCoordinateConversion';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Processing resolution — much higher than the old 96×96. */
export const EXTRACTION_SIZE = 512;

/** Canny low threshold for hysteresis edge detection. */
const CANNY_LOW = 40;

/** Canny high threshold for hysteresis edge detection. */
const CANNY_HIGH = 100;

/** Gaussian blur kernel size (must be odd). */
const BLUR_KERNEL = 3;

/** Minimum contour length (in pixels at EXTRACTION_SIZE) to be considered. */
const MIN_CONTOUR_LENGTH = 20;

/** Minimum contour area (in pixels² at EXTRACTION_SIZE) to be considered. */
const MIN_CONTOUR_AREA = 200;

/** Maximum number of contours to extract per image. */
const MAX_CONTOURS = 32;

/** Douglas-Peucker simplification epsilon (in pixels at EXTRACTION_SIZE). */
const DOUGLAS_PEUCKER_EPSILON = 4;

/** Maximum line candidates per image. */
const MAX_LINES = 16;

/** Minimum line length (in pixels at EXTRACTION_SIZE). */
const MIN_LINE_LENGTH = 30;

/** Hough accumulator resolution (degrees). */
const HOUGH_ANGLE_STEP = 5;

/** Hough vote threshold as fraction of max vote. */
const HOUGH_VOTE_THRESHOLD = 0.4;

/**
 * Number of dilation iterations for morphological closing.
 * This fills edge-enclosed regions to create solid filled areas.
 * Higher values fill larger gaps between edges.
 */
const CLOSE_DILATE_ITERATIONS = 12;

/**
 * Number of erosion iterations for morphological closing.
 * This shrinks the filled regions back toward the original edges.
 * Should be slightly less than CLOSE_DILATE_ITERATIONS to leave
 * some padding for robust contour extraction.
 */
const CLOSE_ERODE_ITERATIONS = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A contour extracted from the image — ordered pixel coordinates. */
export interface ExtractedContour {
  /** Unique index for this contour. */
  index: number;
  /** Polygon points in pixel coordinates at EXTRACTION_SIZE resolution. */
  pixelPoints: Array<{ x: number; y: number }>;
  /** Simplified polygon (Douglas-Peucker) in pixel coordinates. */
  simplifiedPoints: Array<{ x: number; y: number }>;
  /** Bounding box in pixel coordinates. */
  boundingBox: { x: number; y: number; width: number; height: number };
  /** Area of the contour in pixels². */
  area: number;
  /** Perimeter of the contour in pixels. */
  perimeter: number;
  /** Circularity: 4π·area/perimeter². 1.0 = perfect circle. */
  circularity: number;
  /** Classification of the contour. */
  classification: ContourClassification;
  /** Confidence score (0-100). */
  confidence: number;
}

/** Classification of an extracted contour. */
export type ContourClassification =
  | 'probable_roof_plane'
  | 'probable_wall_plane'
  | 'probable_obstruction'
  | 'probable_equipment'
  | 'probable_ground_noise'
  | 'probable_sky_region'
  | 'unknown';

/** A line detected in the image via Hough-like projection. */
export interface ExtractedLine {
  /** Start point in pixel coordinates. */
  start: { x: number; y: number };
  /** End point in pixel coordinates. */
  end: { x: number; y: number };
  /** Orientation category. */
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  /** Strength (0-1, fraction of votes relative to max). */
  strength: number;
  /** Length in pixels. */
  length: number;
  /** Classification. */
  classification: 'ridge_line' | 'eave_line' | 'rake_line' | 'wall_edge' | 'structural_line';
}

/** The full output of the geometry extraction pipeline. */
export interface RoofGeometryExtractionResult {
  /** Processing resolution used. */
  extractionSize: number;
  /** Number of contours found. */
  contourCount: number;
  /** Number of lines found. */
  lineCount: number;
  /** Extracted contours. */
  contours: ExtractedContour[];
  /** Extracted lines. */
  lines: ExtractedLine[];
  /** Image quality metrics. */
  metrics: {
    edgePixelRatio: number;
    horizontalStrength: number;
    verticalStrength: number;
    diagonalStrength: number;
    brightness: number;
    sharpness: number;
  };
  /** Whether OpenAI Vision was used for geometry extraction. */
  usedOpenAiVision: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract real roof geometry from image bytes using sharp-based
 * high-resolution contour tracing.
 *
 * This replaces the old 96×96 edge-density heuristic with actual
 * geometry extraction at 512×512 resolution.
 *
 * KEY FIX: Uses morphological closing to fill edge-enclosed regions
 * before connected component labeling, producing filled region polygons
 * instead of thin edge boundary outlines.
 */
export async function extractRoofGeometry(bytes: Buffer): Promise<RoofGeometryExtractionResult> {
  // Dynamic import — sharp has native bindings
  const sharp = (await import('sharp')).default;

  // Step 1: Resize to 512×512 grayscale
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize(EXTRACTION_SIZE, EXTRACTION_SIZE, { fit: 'inside', withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  // Step 2: Gaussian blur for noise suppression
  const blurred = gaussianBlur(data, w, h, BLUR_KERNEL);

  // Step 3: Sobel gradient magnitude
  const { magnitude, direction } = sobelGradients(blurred, w, h);

  // Step 4: Canny-style edge detection with hysteresis
  const edges = cannyEdgeDetection(magnitude, direction, w, h, CANNY_LOW, CANNY_HIGH);

  // Step 5: Compute metrics
  const metrics = computeMetrics(data, magnitude, edges, w, h);

  // Step 6: Detect lines via Hough-like projection
  const lines = detectLines(edges, w, h);

  // ═══════════════════════════════════════════════════════════════════════
  // KEY FIX: Morphological closing to fill edge-enclosed regions
  // ═══════════════════════════════════════════════════════════════════════
  // OLD CODE: dilated = dilate(edges, 2) → CC labeling on thin edge outlines
  // NEW CODE: dilate heavily to fill enclosed regions, then erode back
  // This converts thin edge boundary outlines into solid filled regions
  // that represent actual roof planes, walls, etc.
  // ═══════════════════════════════════════════════════════════════════════
  const filledRegions = morphologicalClose(edges, w, h, CLOSE_DILATE_ITERATIONS, CLOSE_ERODE_ITERATIONS);

  // Step 8: Connected component labeling on FILLED regions (not edge map)
  const components = connectedComponentLabeling(filledRegions, w, h);

  // Step 9: Extract contours from filled region components
  const contours = extractContoursFromComponents(components, w, h);

  // Step 10: Classify and score contours
  const classifiedContours = contours.map((contour, index) =>
    classifyAndScoreContour(contour, index, w, h, metrics)
  );

  // Step 11: Sort by confidence and limit count
  const finalContours = classifiedContours
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_CONTOURS);

  return {
    extractionSize: EXTRACTION_SIZE,
    contourCount: finalContours.length,
    lineCount: lines.length,
    contours: finalContours,
    lines,
    metrics,
    usedOpenAiVision: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Gaussian blur
// ─────────────────────────────────────────────────────────────────────────────

function gaussianBlur(data: Uint8Array, w: number, h: number, kernelSize: number): Float64Array {
  const output = new Float64Array(w * h);
  const half = Math.floor(kernelSize / 2);
  const sigma = half / 2;

  // Pre-compute kernel
  const kernel: number[] = [];
  let kernelSum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(val);
    kernelSum += val;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

  // Horizontal pass
  const temp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const nx = Math.min(w - 1, Math.max(0, x + k));
        sum += data[y * w + nx] * kernel[k + half];
      }
      temp[y * w + x] = sum;
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -half; k <= half; k++) {
        const ny = Math.min(h - 1, Math.max(0, y + k));
        sum += temp[ny * w + x] * kernel[k + half];
      }
      output[y * w + x] = sum;
    }
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Sobel gradients
// ─────────────────────────────────────────────────────────────────────────────

function sobelGradients(
  data: Float64Array,
  w: number,
  h: number,
): { magnitude: Float64Array; direction: Float64Array } {
  const magnitude = new Float64Array(w * h);
  const direction = new Float64Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;

      const tl = data[(y - 1) * w + (x - 1)];
      const tc = data[(y - 1) * w + x];
      const tr = data[(y - 1) * w + (x + 1)];
      const ml = data[y * w + (x - 1)];
      const mr = data[y * w + (x + 1)];
      const bl = data[(y + 1) * w + (x - 1)];
      const bc = data[(y + 1) * w + x];
      const br = data[(y + 1) * w + (x + 1)];

      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

      magnitude[idx] = Math.sqrt(gx * gx + gy * gy);
      direction[idx] = Math.atan2(gy, gx);
    }
  }

  return { magnitude, direction };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Canny edge detection with hysteresis
// ─────────────────────────────────────────────────────────────────────────────

function cannyEdgeDetection(
  magnitude: Float64Array,
  direction: Float64Array,
  w: number,
  h: number,
  lowThreshold: number,
  highThreshold: number,
): Uint8Array {
  const edges = new Uint8Array(w * h);
  const strong = new Uint8Array(w * h);
  const weak = new Uint8Array(w * h);

  // Non-maximum suppression
  const nms = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const mag = magnitude[idx];
      const angle = direction[idx] * 180 / Math.PI;
      const a = angle < 0 ? angle + 180 : angle;

      let q = 0;
      let r = 0;

      if ((a >= 0 && a < 22.5) || (a >= 157.5 && a <= 180)) {
        q = magnitude[y * w + (x + 1)];
        r = magnitude[y * w + (x - 1)];
      } else if (a >= 22.5 && a < 67.5) {
        q = magnitude[(y - 1) * w + (x + 1)];
        r = magnitude[(y + 1) * w + (x - 1)];
      } else if (a >= 67.5 && a < 112.5) {
        q = magnitude[(y - 1) * w + x];
        r = magnitude[(y + 1) * w + x];
      } else if (a >= 112.5 && a < 157.5) {
        q = magnitude[(y - 1) * w + (x - 1)];
        r = magnitude[(y + 1) * w + (x + 1)];
      }

      nms[idx] = (mag >= q && mag >= r) ? mag : 0;
    }
  }

  // Double thresholding
  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= highThreshold) {
      strong[i] = 1;
    } else if (nms[i] >= lowThreshold) {
      weak[i] = 1;
    }
  }

  // Hysteresis: connect weak edges to strong edges
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (strong[idx]) {
        edges[idx] = 1;
      } else if (weak[idx]) {
        let hasStrongNeighbor = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (strong[(y + dy) * w + (x + dx)]) {
              hasStrongNeighbor = true;
              break;
            }
          }
          if (hasStrongNeighbor) break;
        }
        if (hasStrongNeighbor) {
          edges[idx] = 1;
        }
      }
    }
  }

  return edges;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5: Morphological operations
// ─────────────────────────────────────────────────────────────────────────────

/** Dilate a binary image by setting 4-connected neighbors to 1. */
function dilate(data: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let current = new Uint8Array(data);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (current[y * w + x] ||
            current[(y - 1) * w + x] ||
            current[(y + 1) * w + x] ||
            current[y * w + (x - 1)] ||
            current[y * w + (x + 1)]) {
          next[y * w + x] = 1;
        }
      }
    }
    current = next;
  }

  return current;
}

/** Erode a binary image by requiring all 4-connected neighbors to be 1. */
function erode(data: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let current = new Uint8Array(data);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (current[y * w + x] &&
            current[(y - 1) * w + x] &&
            current[(y + 1) * w + x] &&
            current[y * w + (x - 1)] &&
            current[y * w + (x + 1)]) {
          next[y * w + x] = 1;
        }
      }
    }
    current = next;
  }

  return current;
}

/**
 * Morphological closing: dilate then erode.
 *
 * This is the KEY FIX for the shitty boxes problem.
 *
 * In the old code, connected component labeling was run on the DILATED
 * BINARY EDGE MAP, which produced thin boundary outlines (ring-shaped
 * contours) instead of filled interior regions.
 *
 * The new approach:
 * 1. DILATE the edge map heavily (CLOSE_DILATE_ITERATIONS) to fill
 *    enclosed regions — gaps between edges get filled, converting
 *    edge outlines into solid filled areas
 * 2. ERODE back (CLOSE_ERODE_ITERATIONS) to shrink the filled regions
 *    back toward the original edges, removing the dilation padding
 *
 * The result is a binary image where enclosed edge regions are filled
 * solid, allowing connected component labeling to find actual roof
 * plane regions instead of thin edge boundary outlines.
 *
 * We also INVERT the filled image before CC labeling. After closing,
 * the filled edges form a "grid" dividing the image into regions.
 * The INTERIOR of each region (where there are no edges) is 0 in the
 * filled image. By inverting, the interior regions become 1 and we
 * can label them directly as roof planes, walls, etc.
 */
function morphologicalClose(
  edges: Uint8Array,
  w: number,
  h: number,
  dilateIterations: number,
  erodeIterations: number,
): Uint8Array {
  // Step 1: Dilate edges heavily to fill enclosed regions
  const dilated = dilate(edges, w, h, dilateIterations);

  // Step 2: Erode back to remove dilation padding
  const closed = erode(dilated, w, h, erodeIterations);

  // Step 3: INVERT — the interior of enclosed regions is where edges are NOT
  // After closing, the edges form a solid "grid" dividing the image into
  // regions. The interior of each region is 0 (no edges). By inverting,
  // we get 1 for interior regions, which we can then label as roof planes.
  const inverted = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    inverted[i] = closed[i] ? 0 : 1;
  }

  // Step 4: Remove tiny noise regions by eroding then dilating the inverted
  // image (opening on the inverted image removes small 1-pixel noise)
  const opened = dilate(erode(inverted, w, h, 1), w, h, 1);

  return opened;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6: Connected component labeling (flood-fill)
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectedComponent {
  label: number;
  pixels: Array<{ x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}

function connectedComponentLabeling(
  binary: Uint8Array,
  w: number,
  h: number,
): ConnectedComponent[] {
  const labels = new Int32Array(w * h);
  let nextLabel = 1;
  const components: ConnectedComponent[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (binary[idx] && !labels[idx]) {
        // Flood fill
        const pixels: Array<{ x: number; y: number }> = [];
        const stack: Array<{ x: number; y: number }> = [{ x, y }];
        let minX = x, minY = y, maxX = x, maxY = y;

        while (stack.length > 0) {
          const p = stack.pop()!;
          const pIdx = p.y * w + p.x;

          if (p.x < 0 || p.x >= w || p.y < 0 || p.y >= h) continue;
          if (!binary[pIdx] || labels[pIdx]) continue;

          labels[pIdx] = nextLabel;
          pixels.push(p);

          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;

          stack.push({ x: p.x + 1, y: p.y });
          stack.push({ x: p.x - 1, y: p.y });
          stack.push({ x: p.x, y: p.y + 1 });
          stack.push({ x: p.x, y: p.y - 1 });
        }

        components.push({
          label: nextLabel,
          pixels,
          bounds: { minX, minY, maxX, maxY },
          area: pixels.length,
        });
        nextLabel++;
      }
    }
  }

  return components;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 7: Extract contours from connected components (filled regions)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract contour polygons from filled region components.
 *
 * KEY FIX: Since we now operate on filled regions (not thin edge outlines),
 * the connected components are solid filled areas representing actual roof
 * planes, walls, etc. We extract their boundaries and construct proper
 * polygons using convex hull ordering.
 */
function extractContoursFromComponents(
  components: ConnectedComponent[],
  w: number,
  h: number,
): Array<{
  pixelPoints: Array<{ x: number; y: number }>;
  simplifiedPoints: Array<{ x: number; y: number }>;
  boundingBox: { x: number; y: number; width: number; height: number };
  area: number;
  perimeter: number;
}> {
  const contours: Array<{
    pixelPoints: Array<{ x: number; y: number }>;
    simplifiedPoints: Array<{ x: number; y: number }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    area: number;
    perimeter: number;
  }> = [];

  for (const comp of components) {
    // Skip tiny components (noise from the inversion)
    if (comp.area < MIN_CONTOUR_AREA) continue;

    // Extract the boundary (contour) pixels of this component
    // A boundary pixel is one that has at least one non-component 4-neighbor
    const pixelSet = new Set<number>();
    for (const p of comp.pixels) {
      pixelSet.add(p.y * w + p.x);
    }

    const boundaryPixels: Array<{ x: number; y: number }> = [];
    for (const p of comp.pixels) {
      const isOnEdge =
        p.x === 0 || p.x === w - 1 || p.y === 0 || p.y === h - 1 ||
        !pixelSet.has((p.y - 1) * w + p.x) ||
        !pixelSet.has((p.y + 1) * w + p.x) ||
        !pixelSet.has(p.y * w + (p.x - 1)) ||
        !pixelSet.has(p.y * w + (p.x + 1));

      if (isOnEdge) {
        boundaryPixels.push(p);
      }
    }

    // Skip if boundary is too short
    if (boundaryPixels.length < MIN_CONTOUR_LENGTH) continue;

    // KEY FIX: Use convex hull instead of angle-from-centroid ordering.
    // The old angle-from-centroid approach produced self-intersecting
    // polygons for concave shapes (like L-shaped roof sections).
    // Convex hull always produces a valid, non-self-intersecting polygon.
    // For roof geometry, convex hull is a reasonable approximation since
    // roof planes are generally convex or nearly-convex shapes.
    const ordered = convexHull(boundaryPixels);

    // Simplify with Douglas-Peucker
    const simplified = douglasPeuckerSimplify(ordered, DOUGLAS_PEUCKER_EPSILON);

    // Need at least 3 points for a valid polygon
    if (simplified.length < 3) continue;

    // Compute bounding box
    const bb = comp.bounds;
    const boundingBox = {
      x: bb.minX,
      y: bb.minY,
      width: bb.maxX - bb.minX,
      height: bb.maxY - bb.minY,
    };

    // Compute perimeter from simplified polygon
    let perimeter = 0;
    for (let i = 0; i < simplified.length; i++) {
      const j = (i + 1) % simplified.length;
      const dx = simplified[j].x - simplified[i].x;
      const dy = simplified[j].y - simplified[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    // Area is already computed by the component
    contours.push({
      pixelPoints: ordered,
      simplifiedPoints: simplified,
      boundingBox,
      area: comp.area,
      perimeter,
    });
  }

  // Sort by area descending — largest regions first (likely the most important)
  contours.sort((a, b) => b.area - a.area);

  return contours;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convex hull — Andrew's monotone chain algorithm
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the convex hull of a set of 2D points using Andrew's monotone chain.
 * Returns the hull vertices in counter-clockwise order.
 *
 * This replaces the old angle-from-centroid ordering which produced
 * self-intersecting polygons for concave shapes. Convex hull always
 * produces a valid, non-self-intersecting polygon.
 *
 * For roof planes (which are generally convex or nearly-convex shapes),
 * the convex hull is a good approximation that produces clean polygon
 * overlays tracing the actual shape of the roof.
 */
function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length <= 3) return points;

  // Sort by x, then by y (lexicographic order)
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  // Remove duplicate points
  const unique: Array<{ x: number; y: number }> = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].x !== sorted[i - 1].x || sorted[i].y !== sorted[i - 1].y) {
      unique.push(sorted[i]);
    }
  }

  if (unique.length <= 2) return unique;

  // Cross product of vectors OA and OB where O is the origin
  function cross(O: { x: number; y: number }, A: { x: number; y: number }, B: { x: number; y: number }): number {
    return (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);
  }

  // Build lower hull
  const lower: Array<{ x: number; y: number }> = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  // Build upper hull
  const upper: Array<{ x: number; y: number }> = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Concatenate lower and upper hulls (excluding last point of each because it's repeated)
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Douglas-Peucker polygon simplification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Douglas-Peucker polygon simplification.
 * Reduces the number of points in a polygon while preserving shape.
 */
function douglasPeuckerSimplify(
  points: Array<{ x: number; y: number }>,
  epsilon: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  // Find the point with maximum distance from the line segment (first, last)
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    // Recursively simplify both halves
    const left = douglasPeuckerSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeuckerSimplify(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  // All points are within epsilon of the line — keep only endpoints
  return [first, last];
}

/**
 * Perpendicular distance from point p to line segment (a, b).
 */
function perpendicularDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;

  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 8: Hough-like line detection
// ─────────────────────────────────────────────────────────────────────────────

function detectLines(
  edges: Uint8Array,
  w: number,
  h: number,
): ExtractedLine[] {
  const lines: ExtractedLine[] = [];

  // Horizontal projection: count edge pixels per row
  const hProjection = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x]) count++;
    }
    hProjection[y] = count;
  }

  // Vertical projection: count edge pixels per column
  const vProjection = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < h; y++) {
      if (edges[y * w + x]) count++;
    }
    vProjection[x] = count;
  }

  // Find peaks in horizontal projection
  const hPeaks = findProjectionPeaks(hProjection, 8, MIN_LINE_LENGTH / w * 100);
  for (const peak of hPeaks) {
    let x1 = 0, x2 = w - 1;
    for (let x = 0; x < w; x++) {
      if (edges[peak.index * w + x]) { x1 = x; break; }
    }
    for (let x = w - 1; x >= 0; x--) {
      if (edges[peak.index * w + x]) { x2 = x; break; }
    }

    const length = x2 - x1;
    if (length < MIN_LINE_LENGTH) continue;

    const yPos = peak.index / h;
    lines.push({
      start: { x: x1, y: peak.index },
      end: { x: x2, y: peak.index },
      orientation: 'horizontal',
      strength: peak.strength,
      length,
      classification: yPos < 0.5 ? 'ridge_line' : 'eave_line',
    });
  }

  // Find peaks in vertical projection
  const vPeaks = findProjectionPeaks(vProjection, 8, MIN_LINE_LENGTH / h * 100);
  for (const peak of vPeaks) {
    let y1 = 0, y2 = h - 1;
    for (let y = 0; y < h; y++) {
      if (edges[y * w + peak.index]) { y1 = y; break; }
    }
    for (let y = h - 1; y >= 0; y--) {
      if (edges[y * w + peak.index]) { y2 = y; break; }
    }

    const length = y2 - y1;
    if (length < MIN_LINE_LENGTH) continue;

    const xPos = peak.index / w;
    lines.push({
      start: { x: peak.index, y: y1 },
      end: { x: peak.index, y: y2 },
      orientation: 'vertical',
      strength: peak.strength,
      length,
      classification: xPos < 0.3 || xPos > 0.7 ? 'rake_line' : 'wall_edge',
    });
  }

  // Diagonal lines: sample a few angles
  for (const angleDeg of [30, 45, 60, 120, 135, 150]) {
    const angleRad = angleDeg * Math.PI / 180;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const maxR = Math.ceil(Math.sqrt(w * w + h * h));
    const accumulator = new Float64Array(2 * maxR);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (edges[y * w + x]) {
          const r = Math.round(x * cosA + y * sinA) + maxR;
          accumulator[r]++;
        }
      }
    }

    const maxVotes = Math.max(...accumulator);
    const threshold = maxVotes * HOUGH_VOTE_THRESHOLD;

    for (let r = 1; r < accumulator.length - 1; r++) {
      if (accumulator[r] > threshold &&
          accumulator[r] >= accumulator[r - 1] &&
          accumulator[r] >= accumulator[r + 1]) {
        const rho = r - maxR;
        const endpoints = lineOnImageBoundary(rho, angleRad, w, h);
        if (endpoints) {
          const dx = endpoints.x2 - endpoints.x1;
          const dy = endpoints.y2 - endpoints.y1;
          const length = Math.sqrt(dx * dx + dy * dy);
          if (length >= MIN_LINE_LENGTH) {
            lines.push({
              start: { x: endpoints.x1, y: endpoints.y1 },
              end: { x: endpoints.x2, y: endpoints.y2 },
              orientation: 'diagonal',
              strength: accumulator[r] / maxVotes,
              length,
              classification: 'structural_line',
            });
          }
        }
      }
    }
  }

  return lines
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_LINES);
}

/**
 * Find peaks in a 1D projection array.
 */
function findProjectionPeaks(
  projection: Float64Array,
  maxPeaks: number,
  minStrengthPercent: number,
): Array<{ index: number; strength: number }> {
  const maxVal = Math.max(...projection);
  if (maxVal === 0) return [];

  const threshold = maxVal * (minStrengthPercent / 100);
  const peaks: Array<{ index: number; strength: number }> = [];

  for (let i = 2; i < projection.length - 2; i++) {
    if (projection[i] > threshold &&
        projection[i] >= projection[i - 1] &&
        projection[i] >= projection[i + 1] &&
        projection[i] >= projection[i - 2] &&
        projection[i] >= projection[i + 2]) {
      peaks.push({ index: i, strength: projection[i] / maxVal });
    }
  }

  return peaks
    .sort((a, b) => b.strength - a.strength)
    .slice(0, maxPeaks);
}

/**
 * Compute where a line (rho, theta) intersects the image boundary.
 */
function lineOnImageBoundary(
  rho: number,
  theta: number,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const points: Array<{ x: number; y: number }> = [];

  if (sinT !== 0) {
    const y = rho / sinT;
    if (y >= 0 && y < h) points.push({ x: 0, y });
  }
  if (sinT !== 0) {
    const y = (rho - w * cosT) / sinT;
    if (y >= 0 && y < h) points.push({ x: w, y });
  }
  if (cosT !== 0) {
    const x = rho / cosT;
    if (x >= 0 && x < w) points.push({ x, y: 0 });
  }
  if (cosT !== 0) {
    const x = (rho - h * sinT) / cosT;
    if (x >= 0 && x < w) points.push({ x, y: h });
  }

  if (points.length < 2) return null;

  let maxDist = 0;
  let best = { x1: 0, y1: 0, x2: 0, y2: 0 };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const dist = dx * dx + dy * dy;
      if (dist > maxDist) {
        maxDist = dist;
        best = {
          x1: Math.round(points[i].x),
          y1: Math.round(points[i].y),
          x2: Math.round(points[j].x),
          y2: Math.round(points[j].y),
        };
      }
    }
  }

  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 9: Classify and score contours
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify and score a contour based on geometry, position, and image metrics.
 *
 * KEY FIX: Adjusted thresholds for filled region polygons.
 * The old thresholds assumed thin edge outlines (very small normArea).
 * Filled region polygons are much larger, so thresholds are adjusted:
 * - Roof planes: normArea > 0.04 (was 0.08) — filled regions cover more area
 * - Walls: more permissive aspect ratio detection
 * - Ground noise: better detection of large ground-level regions
 * - Sky regions: large regions at the top of the image
 */
function classifyAndScoreContour(
  contour: {
    pixelPoints: Array<{ x: number; y: number }>;
    simplifiedPoints: Array<{ x: number; y: number }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    area: number;
    perimeter: number;
  },
  index: number,
  imgW: number,
  imgH: number,
  metrics: RoofGeometryExtractionResult['metrics'],
): ExtractedContour {
  const { boundingBox: bb, area, perimeter } = contour;

  // Normalized metrics
  const normArea = area / (imgW * imgH);
  const normY = bb.y / imgH; // 0 = top, 1 = bottom
  const normYCenter = (bb.y + bb.height / 2) / imgH;
  const aspectRatio = bb.width > 0 && bb.height > 0
    ? Math.max(bb.width, bb.height) / Math.min(bb.width, bb.height)
    : 1;
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // Classify based on geometry and position
  // Filled regions have much larger normArea than thin edge outlines,
  // so thresholds are adjusted accordingly.
  let classification: ContourClassification = 'unknown';
  let confidence = 30;

  // Very large region at top of image → likely sky
  if (normArea > 0.25 && normYCenter < 0.3) {
    classification = 'probable_sky_region';
    confidence = 60 + Math.min(20, Math.round(normArea * 20));
  }
  // Large filled region in upper half → likely roof plane
  // Roof planes are the most important detection target
  else if (normArea > 0.04 && normYCenter < 0.55) {
    classification = 'probable_roof_plane';
    // Larger areas get higher confidence
    confidence = 50 + Math.min(30, Math.round(normArea * 80));
    // Wider shapes (typical roof planes seen from the side) get a boost
    if (bb.width > bb.height) {
      confidence = Math.min(85, confidence + 10);
    }
  }
  // Wide shape in upper portion → likely roof
  else if (aspectRatio > 1.5 && normYCenter < 0.55 && normArea > 0.02) {
    classification = 'probable_roof_plane';
    confidence = 45 + Math.min(20, Math.round(aspectRatio * 5));
  }
  // Region in middle-to-lower portion, taller than wide → likely wall
  else if (normArea > 0.03 && normYCenter >= 0.3 && normYCenter < 0.8 && bb.height >= bb.width) {
    classification = 'probable_wall_plane';
    confidence = 45 + Math.min(20, Math.round(normArea * 60));
  }
  // Small region in upper half → likely equipment (vent, pipe, satellite dish)
  else if (normArea > 0.003 && normArea < 0.04 && normYCenter < 0.6) {
    classification = 'probable_equipment';
    confidence = 35 + Math.min(15, Math.round((1 - normYCenter) * 20));
  }
  // Very small region → likely obstruction (chimney, dormer detail)
  else if (normArea < 0.01 && normArea > 0.0005) {
    classification = 'probable_obstruction';
    confidence = 30 + Math.min(15, Math.round(normArea * 1000));
  }
  // Large region at bottom → likely ground
  else if (normYCenter > 0.65 && normArea > 0.02) {
    classification = 'probable_ground_noise';
    confidence = 25;
  }
  // Large region, very circular → sky or unknown
  else if (circularity > 0.7 && normArea > 0.1) {
    classification = 'probable_sky_region';
    confidence = 25;
  }
  // Fallback for medium regions in upper half → guess roof
  else if (normArea > 0.01 && normYCenter < 0.5) {
    classification = 'probable_roof_plane';
    confidence = 35;
  }
  // Default
  else {
    classification = 'unknown';
    confidence = 25;
  }

  // Boost confidence for contours near strong lines
  if (metrics.horizontalStrength > 0.3 && classification === 'probable_roof_plane') {
    confidence = Math.min(85, confidence + 10);
  }
  if (metrics.verticalStrength > 0.3 && classification === 'probable_wall_plane') {
    confidence = Math.min(85, confidence + 10);
  }

  // Clamp confidence
  confidence = Math.max(10, Math.min(85, confidence));

  return {
    index,
    pixelPoints: contour.pixelPoints,
    simplifiedPoints: contour.simplifiedPoints,
    boundingBox: bb,
    area,
    perimeter,
    circularity: Math.round(circularity * 1000) / 1000,
    classification,
    confidence,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 (continued): Compute image quality metrics
// ─────────────────────────────────────────────────────────────────────────────

function computeMetrics(
  raw: Uint8Array,
  magnitude: Float64Array,
  edges: Uint8Array,
  w: number,
  h: number,
): RoofGeometryExtractionResult['metrics'] {
  let brightnessSum = 0;
  let sharpnessSum = 0;
  let edgeCount = 0;
  let hStrength = 0;
  let vStrength = 0;
  let dStrength = 0;

  const sampleCount = (w - 2) * (h - 2);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      brightnessSum += raw[idx];
      sharpnessSum += magnitude[idx];
      if (edges[idx]) {
        edgeCount++;
        const dx = Math.abs(raw[idx + 1] - raw[idx - 1]);
        const dy = Math.abs(raw[(y + 1) * w + x] - raw[(y - 1) * w + x]);
        if (dx > dy) {
          hStrength++;
        } else if (dy > dx) {
          vStrength++;
        } else {
          dStrength++;
        }
      }
    }
  }

  const totalEdge = Math.max(1, edgeCount);

  return {
    edgePixelRatio: Math.round((edgeCount / sampleCount) * 10000) / 10000,
    horizontalStrength: Math.round((hStrength / totalEdge) * 10000) / 10000,
    verticalStrength: Math.round((vStrength / totalEdge) * 10000) / 10000,
    diagonalStrength: Math.round((dStrength / totalEdge) * 10000) / 10000,
    brightness: Math.round(brightnessSum / sampleCount),
    sharpness: Math.round(sharpnessSum / sampleCount),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion to NormalizedRegion / NormalizedLine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an extracted contour's bounding box to a NormalizedRegion
 * in the normalized_image_0_1000 coordinate system.
 */
export function contourToNormalizedRegion(
  contour: ExtractedContour,
  imgW: number,
  imgH: number,
): NormalizedRegion {
  const bb = contour.boundingBox;
  return {
    x: Math.round((bb.x / imgW) * 1000),
    y: Math.round((bb.y / imgH) * 1000),
    width: Math.round((bb.width / imgW) * 1000),
    height: Math.round((bb.height / imgH) * 1000),
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert an extracted line to a NormalizedLine
 * in the normalized_image_0_1000 coordinate system.
 */
export function lineToNormalizedLine(
  line: ExtractedLine,
  imgW: number,
  imgH: number,
): NormalizedLine {
  return {
    x1: Math.round((line.start.x / imgW) * 1000),
    y1: Math.round((line.start.y / imgH) * 1000),
    x2: Math.round((line.end.x / imgW) * 1000),
    y2: Math.round((line.end.y / imgH) * 1000),
    orientation: line.orientation,
    strength: line.strength,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Convert an extracted contour's simplified polygon to NormalizedPoint[]
 * in the normalized_image_0_1000 coordinate system.
 */
export function contourToNormalizedPolygon(
  contour: ExtractedContour,
  imgW: number,
  imgH: number,
): Array<{ x: number; y: number; coordinateSystem: 'normalized_image_0_1000' }> {
  return contour.simplifiedPoints.map(p => ({
    x: Math.round((p.x / imgW) * 1000),
    y: Math.round((p.y / imgH) * 1000),
    coordinateSystem: 'normalized_image_0_1000' as const,
  }));
}
