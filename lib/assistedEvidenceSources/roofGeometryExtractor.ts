/**
 * Roof Geometry Extractor — real roof shape detection from survey photos.
 *
 * This module replaces the 96×96 edge-density heuristic in
 * `openSourcePhotoVisionWorker.ts` with actual region-based geometry
 * extraction at 512×512 resolution.
 *
 * Pipeline:
 *   1. Resize to 512×512, keep COLOR (not grayscale)
 *   2. Heavy Gaussian blur to destroy texture/noise detail
 *   3. COARSE color quantization (3 levels = 27 colors total)
 *   4. Connected component labeling on quantized color map
 *   5. AGGRESSIVE small-region merge (anything < 3% of image → neighbor)
 *   6. Keep only the TOP N largest regions (default 8)
 *   7. Suzuki-Abe border following for real contour shapes
 *   8. Douglas-Peucker simplification → clean polygons
 *   9. Classify the few remaining regions by color + position + geometry
 *  10. Emit NormalizedRegion / NormalizedLine candidates
 *
 * KEY DESIGN PRINCIPLE: A house photo has ~5-10 major structural regions
 * (sky, roof planes, walls, ground, vegetation). We WANT to produce only
 * those large regions with accurate boundary contours — NOT hundreds of tiny
 * color blobs from texture variations. Coarse quantization + heavy blur +
 * aggressive merging + cap on total regions ensures we only get the big ones.
 *
 * The Suzuki-Abe border following algorithm (same as OpenCV's findContours)
 * traces the EXACT boundary of each region, preserving concavities,
 * L-shapes, and notches — unlike convex hull which destroys them.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These candidates are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

import type { NormalizedRegion, NormalizedLine } from './overlayCoordinateConversion';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** Processing resolution — much higher than the old 96×96. */
export const EXTRACTION_SIZE = 512;

// ---------------------------------------------------------------------------
// Phase 0 feature flag — Canny Background Fix (P0-8.3)
// ---------------------------------------------------------------------------

/** Whether Phase 0 Canny background fix is enabled. Read at call time. */
export function isPhase0CannyBackgroundFixEnabled(): boolean {
  const val = process.env.PHASE0_CANNY_BACKGROUND_FIX ?? '';
  return val === 'true' || val === '1';
}

/**
 * Color quantization levels per channel.
 * 3 = 27 total colors — COARSE on purpose.
 * We WANT to collapse subtle color variations (siding texture, shadow
 * gradients) into the same bucket so that roof planes, walls, sky, and
 * ground each become ONE large region, not dozens of tiny sub-regions.
 */
const QUANT_LEVELS = 3;

/**
 * Minimum region area as a FRACTION of total image area.
 * At 512×512, 2% = ~5242 pixels. Regions smaller than this are merged
 * into neighbors. This ensures only major structural regions survive.
 */
const MIN_REGION_AREA_FRACTION = 0.02;

/**
 * Maximum number of regions to output per image.
 * A typical house photo has ~5-10 meaningful structural regions.
 * We cap at this to prevent flood of tiny artifacts.
 */
const MAX_REGIONS = 12;

/** Douglas-Peucker simplification epsilon (in pixels at EXTRACTION_SIZE). */
const DOUGLAS_PEUCKER_EPSILON = 5;

/** Maximum line candidates per image. */
const MAX_LINES = 12;

/** Minimum line length (in pixels at EXTRACTION_SIZE). */
const MIN_LINE_LENGTH = 40;

/** Hough vote threshold as fraction of max vote. */
const HOUGH_VOTE_THRESHOLD = 0.4;

/** Gaussian blur kernel size for edge-based line detection. */
const BLUR_KERNEL = 3;

/** Canny thresholds for line detection (separate from region extraction). */
const CANNY_LOW = 40;
const CANNY_HIGH = 100;

/** Minimum boundary pixels to form a valid contour. */
const MIN_CONTOUR_LENGTH = 12;

/**
 * Gaussian blur sigma for pre-quantization smoothing.
 * HEAVY blur (sigma=3.0) to destroy texture/noise detail before
 * quantization. We WANT roof planes to be uniform color blobs so
 * they become single connected regions.
 */
const PRE_BLUR_SIGMA = 3.0;

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

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
  // ── Legacy ──
  | 'probable_roof_plane'
  | 'probable_wall_plane'
  | 'probable_obstruction'
  | 'probable_equipment'
  | 'probable_ground_noise'
  | 'probable_sky_region'
  // ── Facade ──
  | 'probable_siding'
  | 'probable_window'
  | 'probable_door'
  | 'probable_garage_door'
  | 'probable_gutter'
  | 'probable_downspout'
  | 'probable_porch'
  | 'probable_deck'
  // ── Site context ──
  | 'probable_driveway'
  | 'probable_fence'
  | 'probable_bushes'
  // ── Electrical/solar ──
  | 'probable_ac_unit'
  | 'probable_utility_meter'
  | 'probable_existing_solar'
  // ── Occluder ──
  | 'probable_vehicle'
  | 'probable_person'
  // ── Condition ──
  | 'probable_moss'
  | 'probable_damaged_area'
  // ── Catch-all ──
  | 'unknown'
  // ── Phase 0 (P0-8.3): unclassifiable regions routed to background ──
  | 'background';

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

// ────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract real roof geometry from image bytes using color-based
 * region grouping at 512×512 resolution.
 *
 * KEY DESIGN: Coarse quantization (27 colors) + heavy blur produces
 * only the major structural regions (sky, roof, walls, ground).
 * Suzuki-Abe border following then traces their exact boundaries.
 */
export async function extractRoofGeometry(bytes: Buffer): Promise<RoofGeometryExtractionResult> {
  // Dynamic import — sharp has native bindings
  const sharp = (await import('sharp')).default;

  // Step 1: Resize to 512×512, keep RGB color, and apply HEAVY pre-blur
  // Using sharp's native .blur() (libvips) instead of manual pixel-by-pixel
  // Gaussian — this is orders of magnitude faster and eliminates the 504 timeout.
  // The heavy blur (sigma=3.0) destroys texture/noise detail so that roof planes,
  // walls, sky become uniform color blobs before quantization.
  const { data, info } = await sharp(bytes, { failOn: 'none' })
    .rotate()
    .resize(EXTRACTION_SIZE, EXTRACTION_SIZE, { fit: 'inside', withoutEnlargement: true })
    .blur(PRE_BLUR_SIGMA)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;

  // Step 2: PRE-BLUR IS NOW DONE BY SHARP NATIVELY (see .blur() above)
  // No more manual gaussianBlurRGB — the data buffer is already smoothed.
  const smoothed = data;

  // Step 3: COARSE color quantization — only 27 total colors
  const quantized = quantizeColors(smoothed, w, h, channels, QUANT_LEVELS);

  // Step 4: Connected component labeling on the quantized color map
  const regions = labelColorRegions(quantized, w, h);

  // Step 5: AGGRESSIVE small-region merge + cap on total regions
  const minArea = Math.floor(w * h * MIN_REGION_AREA_FRACTION);
  const mergedRegions = mergeSmallRegions(regions, w, h, minArea);

  // Step 5b: Keep only the TOP N largest regions
  const topRegions = mergedRegions
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_REGIONS);

  // Step 6: Compute grayscale metrics and edge-based lines
  const grayscale = rgbToGrayscale(smoothed, w, h, channels);
  const blurred = gaussianBlur(grayscale, w, h, BLUR_KERNEL);
  const { magnitude, direction } = sobelGradients(blurred, w, h);
  const edges = cannyEdgeDetection(magnitude, direction, w, h, CANNY_LOW, CANNY_HIGH);
  const metrics = computeMetrics(grayscale, magnitude, edges, w, h);
  const lines = detectLines(edges, w, h);

  // Step 7: Suzuki-Abe border following for real contour shapes
  const contours = extractContoursFromRegions(topRegions, w, h, smoothed, channels);

  // Step 8: Classify and score contours using color + geometry + position
  const classifiedContours = contours.map((contour, index) =>
    classifyAndScoreContour(contour, index, w, h, metrics)
  );

  return {
    extractionSize: EXTRACTION_SIZE,
    contourCount: classifiedContours.length,
    lineCount: lines.length,
    contours: classifiedContours,
    lines,
    metrics,
    usedOpenAiVision: false,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Step 2: REMOVED — pre-blur is now done by sharp's native .blur() in the
// resize pipeline above. The manual gaussianBlurRGB() was extremely slow
// (pixel-by-pixel JS loops over 512×512×3 with kernel size 19) and caused
// Pipeline B 504 timeouts. Sharp's .blur() uses libvips native code and
// completes in milliseconds instead of seconds per photo.
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// Step 3: Color quantization
// ────────────────────────────────────────────────────────────────────────────

/**
 * Quantize RGB colors to reduce the palette.
 * Each channel is reduced to QUANT_LEVELS values (e.g., 3 → 27 total colors).
 * COARSE quantization is INTENTIONAL — we WANT to collapse subtle color
 * variations (siding texture, shadow gradients) so that roof planes, walls,
 * sky, and ground each become ONE large connected region.
 */
function quantizeColors(
  data: Buffer,
  w: number,
  h: number,
  channels: number,
  levels: number,
): Uint32Array {
  const result = new Uint32Array(w * h);
  const step = 256 / levels;

  for (let i = 0; i < w * h; i++) {
    const r = Math.floor(data[i * channels] / step);
    const g = Math.floor(data[i * channels + 1] / step);
    const b = Math.floor(data[i * channels + 2] / step);
    // Pack into a single 32-bit color key
    result[i] = r * levels * levels + g * levels + b;
  }

  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 4: Connected component labeling on color map
// ────────────────────────────────────────────────────────────────────────────

interface ColorRegion {
  label: number;
  colorKey: number;
  pixels: Array<{ x: number; y: number }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}

/**
 * Label connected components on the quantized color map.
 * Two pixels are in the same region if they are 4-connected AND have the
 * same quantized color. With coarse quantization (27 colors) + heavy blur,
 * this naturally partitions the image into a few large regions —
 * roof planes, walls, sky, ground, etc.
 */
function labelColorRegions(
  quantized: Uint32Array,
  w: number,
  h: number,
): ColorRegion[] {
  const labels = new Int32Array(w * h);
  let nextLabel = 1;
  const regions: ColorRegion[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (labels[idx]) continue; // already labeled

      const colorKey = quantized[idx];
      const pixels: Array<{ x: number; y: number }> = [];
      const stack: Array<{ x: number; y: number }> = [{ x, y }];
      let minX = x, minY = y, maxX = x, maxY = y;

      while (stack.length > 0) {
        const p = stack.pop()!;
        if (p.x < 0 || p.x >= w || p.y < 0 || p.y >= h) continue;
        const pIdx = p.y * w + p.x;
        if (labels[pIdx]) continue;
        if (quantized[pIdx] !== colorKey) continue;

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

      regions.push({
        label: nextLabel,
        colorKey,
        pixels,
        bounds: { minX, minY, maxX, maxY },
        area: pixels.length,
      });
      nextLabel++;
    }
  }

  return regions;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5: Merge small regions — AGGRESSIVE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merge regions smaller than minArea into their largest 4-connected neighbor.
 * With minArea = 2% of image area (~5242 pixels at 512×512), this removes
 * ALL noise regions, keeping only the major structural ones (sky, roof,
 * walls, ground, vegetation).
 *
 * Takes an absolute minArea in pixels instead of a fraction to give the
 * caller control (the caller computes it from the fraction).
 */
function mergeSmallRegions(
  regions: ColorRegion[],
  w: number,
  h: number,
  minArea: number,
): ColorRegion[] {
  // Build a label map for neighbor lookups
  const labelMap = new Int32Array(w * h);
  for (const region of regions) {
    for (const p of region.pixels) {
      labelMap[p.y * w + p.x] = region.label;
    }
  }

  // Build region index by label
  const regionByLabel = new Map<number, ColorRegion>();
  for (const region of regions) {
    regionByLabel.set(region.label, region);
  }

  // Find small regions and merge them
  const merged = new Set<number>();

  // Sort small regions by area ascending so smallest get merged first
  const smallRegions = regions
    .filter(r => r.area < minArea)
    .sort((a, b) => a.area - b.area);

  for (const region of smallRegions) {
    if (merged.has(region.label)) continue;

    // Find the largest 4-connected neighbor region (not already merged)
    const neighborAreas = new Map<number, number>();
    for (const p of region.pixels) {
      const neighbors = [
        p.y > 0 ? labelMap[(p.y - 1) * w + p.x] : 0,
        p.y < h - 1 ? labelMap[(p.y + 1) * w + p.x] : 0,
        p.x > 0 ? labelMap[p.y * w + (p.x - 1)] : 0,
        p.x < w - 1 ? labelMap[p.y * w + (p.x + 1)] : 0,
      ];
      for (const nLabel of neighbors) {
        if (nLabel && nLabel !== region.label && !merged.has(nLabel)) {
          const nRegion = regionByLabel.get(nLabel);
          if (nRegion) {
            neighborAreas.set(nLabel, (neighborAreas.get(nLabel) ?? 0) + 1);
          }
        }
      }
    }

    // Merge into the neighbor with the most shared boundary
    let bestNeighbor = 0;
    let bestSharedBoundary = 0;
    for (const [nLabel, sharedBoundary] of neighborAreas) {
      if (sharedBoundary > bestSharedBoundary) {
        bestSharedBoundary = sharedBoundary;
        bestNeighbor = nLabel;
      }
    }

    if (bestNeighbor) {
      merged.add(region.label);
      const target = regionByLabel.get(bestNeighbor)!;
      // Reassign pixels in labelMap
      for (const p of region.pixels) {
        labelMap[p.y * w + p.x] = bestNeighbor;
      }
      target.pixels.push(...region.pixels);
      target.area += region.area;
      // Update bounds
      if (region.bounds.minX < target.bounds.minX) target.bounds.minX = region.bounds.minX;
      if (region.bounds.minY < target.bounds.minY) target.bounds.minY = region.bounds.minY;
      if (region.bounds.maxX > target.bounds.maxX) target.bounds.maxX = region.bounds.maxX;
      if (region.bounds.maxY > target.bounds.maxY) target.bounds.maxY = region.bounds.maxY;
    }
  }

  // Return only non-merged regions that are large enough
  return regions.filter(r => !merged.has(r.label) && r.area >= minArea);
}

// ────────────────────────────────────────────────────────────────────────────
// Step 5b: RGB to grayscale conversion
// ────────────────────────────────────────────────────────────────────────────

function rgbToGrayscale(data: Buffer, w: number, h: number, channels: number): Uint8Array {
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Luminance formula
    gray[i] = Math.round(
      0.299 * data[i * channels] +
      0.587 * data[i * channels + 1] +
      0.114 * data[i * channels + 2]
    );
  }
  return gray;
}

// ────────────────────────────────────────────────────────────────────────────
// Step 7: Suzuki-Abe border following contour extraction
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract contour polygons from color-based regions using
 * SUZUKI-ABE BORDER FOLLOWING (the same algorithm used by OpenCV's
 * findContours()).
 *
 * For each large region:
 * 1. Build a binary mask
 * 2. Apply Suzuki-Abe border following to trace the EXACT boundary
 *    preserving all concavities, L-shapes, and notches
 * 3. Simplify with Douglas-Peucker
 *
 * This produces polygons that ACTUALLY MAP the shape of roof planes,
 * walls, etc. — not convex hull blobs or bounding box rectangles.
 */
function extractContoursFromRegions(
  regions: ColorRegion[],
  w: number,
  h: number,
  data: Buffer,
  channels: number,
): Array<{
  pixelPoints: Array<{ x: number; y: number }>;
  simplifiedPoints: Array<{ x: number; y: number }>;
  boundingBox: { x: number; y: number; width: number; height: number };
  area: number;
  perimeter: number;
  avgR: number;
  avgG: number;
  avgB: number;
}> {
  const contours: Array<{
    pixelPoints: Array<{ x: number; y: number }>;
    simplifiedPoints: Array<{ x: number; y: number }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    area: number;
    perimeter: number;
    avgR: number;
    avgG: number;
    avgB: number;
  }> = [];

  for (const region of regions) {
    // Compute average color for this region
    let rSum = 0, gSum = 0, bSum = 0;
    for (const p of region.pixels) {
      const idx = p.y * w + p.x;
      rSum += data[idx * channels];
      gSum += data[idx * channels + 1];
      bSum += data[idx * channels + 2];
    }
    const avgR = rSum / region.pixels.length;
    const avgG = gSum / region.pixels.length;
    const avgB = bSum / region.pixels.length;

    // Build binary mask for this region
    const regionMask = new Uint8Array(w * h);
    for (const p of region.pixels) {
      regionMask[p.y * w + p.x] = 1;
    }

    // Run Suzuki-Abe border following on the binary mask
    const borderContours = suzukiAbeFindContours(regionMask, w, h);

    // Take the outermost (largest) contour as the main shape
    let bestContour: Array<{ x: number; y: number }> | null = null;
    let bestArea = 0;

    for (const bc of borderContours) {
      if (bc.isHole) continue;
      if (bc.points.length < MIN_CONTOUR_LENGTH) continue;

      // Compute approximate area via shoelace formula
      const contourArea = Math.abs(shoelaceArea(bc.points));
      if (contourArea > bestArea) {
        bestArea = contourArea;
        bestContour = bc.points;
      }
    }

    if (!bestContour || bestContour.length < 3) continue;

    // Simplify with Douglas-Peucker
    const simplified = douglasPeuckerSimplify(bestContour, DOUGLAS_PEUCKER_EPSILON);

    // Need at least 3 points for a valid polygon
    if (simplified.length < 3) continue;

    // Compute bounding box from simplified polygon
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of simplified) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    // Skip degenerate polygons (all points colinear — zero width or height)
    if (maxX - minX < 1 || maxY - minY < 1) continue;

    const boundingBox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // Compute perimeter from simplified polygon
    let perimeter = 0;
    for (let i = 0; i < simplified.length; i++) {
      const j = (i + 1) % simplified.length;
      const dx = simplified[j].x - simplified[i].x;
      const dy = simplified[j].y - simplified[i].y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    contours.push({
      pixelPoints: bestContour,
      simplifiedPoints: simplified,
      boundingBox,
      area: region.area,
      perimeter,
      avgR,
      avgG,
      avgB,
    });
  }

  // Sort by area descending — largest regions first
  contours.sort((a, b) => b.area - a.area);

  return contours;
}

// ────────────────────────────────────────────────────────────────────────────
// Suzuki-Abe Border Following Algorithm
// (Same algorithm as OpenCV's findContours)
//
// Reference: Suzuki, S. and Abe, K.,
// "Topological Structural Analysis of Digitized Binary Images
//  by Border Following", CVGIP 30(1), pp 32-46, 1985.
// ────────────────────────────────────────────────────────────────────────────

interface SuzukiContour {
  points: Array<{ x: number; y: number }>;
  isHole: boolean;
  id: number;
  parentId: number | null;
}

/**
 * Suzuki-Abe border following algorithm.
 * Traces the boundaries of connected components in a binary image,
 * preserving concavities, notches, and L-shapes — unlike convex hull.
 */
function suzukiAbeFindContours(
  binary: Uint8Array,
  w: number,
  h: number,
): SuzukiContour[] {
  // Work on a padded copy (1px border of zeros) to avoid bounds checking
  const pw = w + 2;
  const ph = h + 2;
  const F = new Int32Array(pw * ph);

  // Copy binary image into padded array
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      F[(y + 1) * pw + (x + 1)] = binary[y * w + x];
    }
  }

  let nbd = 1;
  let lnbd = 1;
  const contours: SuzukiContour[] = [];
  const contourById = new Map<number, SuzukiContour>();

  for (let i = 1; i < ph - 1; i++) {
    lnbd = 1;
    for (let j = 1; j < pw - 1; j++) {
      const fij = F[i * pw + j];

      // (a) Outer border starting point
      if (fij === 1 && F[i * pw + (j - 1)] === 0) {
        nbd++;
        const i2 = i, j2 = j - 1;
        const contour = traceBorder(F, pw, ph, i, j, i2, j2, nbd, false);
        contour.id = nbd;
        contours.push(contour);
        contourById.set(nbd, contour);
        setParent(contour, lnbd, contourById);
        if (fij > 1) lnbd = Math.abs(fij);
        continue;
      }

      // (b) Hole border starting point
      if (fij >= 1 && F[i * pw + (j + 1)] === 0) {
        nbd++;
        const i2 = i, j2 = j + 1;
        if (fij > 1) lnbd = Math.abs(fij);
        const contour = traceBorder(F, pw, ph, i, j, i2, j2, nbd, true);
        contour.id = nbd;
        contours.push(contour);
        contourById.set(nbd, contour);
        setParent(contour, lnbd, contourById);
        if (fij > 1) lnbd = Math.abs(fij);
        continue;
      }

      // (c) Otherwise
      if (fij !== 1) lnbd = Math.abs(fij);
    }
  }

  // Convert padded coordinates back to original image coordinates
  for (const contour of contours) {
    contour.points = contour.points.map(p => ({ x: p.x - 1, y: p.y - 1 }));
  }

  return contours;
}

/** Determine parent using Suzuki-Abe Table 1. */
function setParent(
  contour: SuzukiContour,
  lnbd: number,
  contourById: Map<number, SuzukiContour>,
): void {
  const lnbdContour = contourById.get(lnbd);
  if (!lnbdContour) return;

  if (!lnbdContour.isHole) {
    // LNBD is outer border
    contour.parentId = contour.isHole ? lnbd : lnbdContour.parentId;
  } else {
    // LNBD is hole border
    contour.parentId = contour.isHole ? lnbdContour.parentId : lnbd;
  }
}

/**
 * Trace a single border using the Suzuki-Abe algorithm.
 */
function traceBorder(
  F: Int32Array,
  pw: number,
  ph: number,
  iStart: number,
  jStart: number,
  i2: number,
  j2: number,
  nbd: number,
  isHole: boolean,
): SuzukiContour {
  const points: Array<{ x: number; y: number }> = [];

  // (3.1) Starting from (i2, j2), look clockwise around (i, j)
  let i1: number, j1: number;
  const cwResult = findClockwiseNonzero(F, pw, ph, iStart, jStart, i2, j2);

  if (cwResult === null) {
    // No nonzero neighbor — isolated pixel
    F[iStart * pw + jStart] = -nbd;
    points.push({ x: jStart, y: iStart });
    return { points, isHole, id: nbd, parentId: null };
  }

  i1 = cwResult.i;
  j1 = cwResult.j;

  // (3.2)
  let ci2 = i1, cj2 = j1;
  let ci3 = iStart, cj3 = jStart;

  points.push({ x: jStart, y: iStart });

  // (3.3)-(3.5) Follow the border
  const maxIter = pw * ph;
  let iter = 0;

  while (iter++ < maxIter) {
    const ccwResult = findCounterClockwiseNonzero(F, pw, ph, ci3, cj3, ci2, cj2);

    if (ccwResult === null) break;

    const i4 = ccwResult.i;
    const j4 = ccwResult.j;

    points.push({ x: j4, y: i4 });

    // (3.4) Update the border pixel
    if (F[ci3 * pw + (cj3 + 1)] === 0) {
      F[ci3 * pw + cj3] = -nbd;
    } else if (F[ci3 * pw + cj3] === 1) {
      F[ci3 * pw + cj3] = nbd;
    }

    // (3.5) Check if we've returned to start
    if (i4 === iStart && j4 === jStart && ci3 === i1 && cj3 === j1) {
      break;
    }

    ci2 = ci3;
    cj2 = cj3;
    ci3 = i4;
    cj3 = j4;
  }

  return { points, isHole, id: nbd, parentId: null };
}

/** Moore neighborhood offsets — 8-connected neighbors in clockwise order. */
const MOORE_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const MOORE_DY = [0, 1, 1, 1, 0, -1, -1, -1];

function findClockwiseNonzero(
  F: Int32Array,
  pw: number,
  ph: number,
  centerI: number,
  centerJ: number,
  fromI: number,
  fromJ: number,
): { i: number; j: number } | null {
  const di = fromI - centerI;
  const dj = fromJ - centerJ;
  let startDir = -1;
  for (let d = 0; d < 8; d++) {
    if (MOORE_DY[d] === di && MOORE_DX[d] === dj) {
      startDir = d;
      break;
    }
  }
  if (startDir === -1) return null;

  for (let k = 0; k < 8; k++) {
    const dir = ((startDir - k) + 8) % 8;
    const ni = centerI + MOORE_DY[dir];
    const nj = centerJ + MOORE_DX[dir];
    if (ni < 0 || ni >= ph || nj < 0 || nj >= pw) continue;
    if (F[ni * pw + nj] !== 0) {
      return { i: ni, j: nj };
    }
  }

  return null;
}

function findCounterClockwiseNonzero(
  F: Int32Array,
  pw: number,
  ph: number,
  centerI: number,
  centerJ: number,
  fromI: number,
  fromJ: number,
): { i: number; j: number } | null {
  const di = fromI - centerI;
  const dj = fromJ - centerJ;
  let startDir = -1;
  for (let d = 0; d < 8; d++) {
    if (MOORE_DY[d] === di && MOORE_DX[d] === dj) {
      startDir = d;
      break;
    }
  }
  if (startDir === -1) return null;

  for (let k = 1; k <= 8; k++) {
    const dir = (startDir + k) % 8;
    const ni = centerI + MOORE_DY[dir];
    const nj = centerJ + MOORE_DX[dir];
    if (ni < 0 || ni >= ph || nj < 0 || nj >= pw) continue;
    if (F[ni * pw + nj] !== 0) {
      return { i: ni, j: nj };
    }
  }

  return null;
}

function shoelaceArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return area / 2;
}

// ────────────────────────────────────────────────────────────────────────────
// Douglas-Peucker polygon simplification
// ────────────────────────────────────────────────────────────────────────────

function douglasPeuckerSimplify(
  points: Array<{ x: number; y: number }>,
  epsilon: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

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
    const left = douglasPeuckerSimplify(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeuckerSimplify(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

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

// ────────────────────────────────────────────────────────────────────────────
// Step 8: Classify and score contours
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classify a contour based on its average color, geometry, and position.
 *
 * With coarse quantization, each contour is a LARGE region (≥2% of image).
 * Classification uses color + position + shape:
 * - Sky: high blue, top of image, large
 * - Roof: dark, upper half, wide aspect ratio
 * - Walls: warm/medium tones, middle, tall aspect ratio
 * - Ground: green/brown, bottom, large
 * - Obstruction: small (2-4%), upper half
 */
function classifyAndScoreContour(
  contour: {
    pixelPoints: Array<{ x: number; y: number }>;
    simplifiedPoints: Array<{ x: number; y: number }>;
    boundingBox: { x: number; y: number; width: number; height: number };
    area: number;
    perimeter: number;
    avgR: number;
    avgG: number;
    avgB: number;
  },
  index: number,
  imgW: number,
  imgH: number,
  metrics: RoofGeometryExtractionResult['metrics'],
): ExtractedContour {
  const { boundingBox: bb, area, perimeter, avgR, avgG, avgB } = contour;

  // Normalized geometry metrics
  const normArea = area / (imgW * imgH);
  const normY = bb.y / imgH;
  const normYCenter = (bb.y + bb.height / 2) / imgH;
  const aspectRatio = bb.width > 0 && bb.height > 0
    ? Math.max(bb.width, bb.height) / Math.min(bb.width, bb.height)
    : 1;
  const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

  // Color analysis
  const brightness = (avgR + avgG + avgB) / 3;
  const maxC = Math.max(avgR, avgG, avgB);
  const minC = Math.min(avgR, avgG, avgB);
  const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
  const isBlueish = avgB > avgR * 1.2 && avgB > avgG * 1.1;
  const isGreenish = avgG > avgR * 1.1 && avgG > avgB * 1.1;
  const isDark = brightness < 100;
  const isVeryBright = brightness > 200;
  const isWarmTone = avgR > avgB * 1.15 && avgG > avgB * 1.05;

  // Classify based on color + geometry + position
  let classification: ContourClassification = 'unknown';
  let confidence = 30;

  // ── Sky detection ──
  if (normYCenter < 0.35 && (isBlueish || isVeryBright) && normArea > 0.05) {
    classification = 'probable_sky_region';
    confidence = 65 + Math.min(15, Math.round(saturation * 30));
  }
  else if (normYCenter < 0.35 && isVeryBright && normArea > 0.1) {
    classification = 'probable_sky_region';
    confidence = 60;
  }
  // ── Roof plane detection ──
  else if (normArea > 0.03 && normYCenter < 0.55 && isDark && !isGreenish) {
    classification = 'probable_roof_plane';
    confidence = 55 + Math.min(25, Math.round(normArea * 60));
    if (bb.width > bb.height * 1.2) {
      confidence = Math.min(85, confidence + 8);
    }
  }
  else if (normArea > 0.03 && normYCenter < 0.55 && brightness < 150 && !isGreenish) {
    classification = 'probable_roof_plane';
    confidence = 45 + Math.min(20, Math.round(normArea * 50));
  }
  else if (normArea > 0.02 && normYCenter < 0.55 && isDark && aspectRatio > 1.5) {
    classification = 'probable_roof_plane';
    confidence = 45 + Math.min(15, Math.round(aspectRatio * 5));
  }
  // ── Wall detection ──
  else if (normArea > 0.03 && normYCenter >= 0.25 && normYCenter < 0.8 && isWarmTone) {
    classification = 'probable_wall_plane';
    confidence = 50 + Math.min(20, Math.round(normArea * 40));
  }
  else if (normArea > 0.03 && normYCenter >= 0.3 && normYCenter < 0.8 && bb.height >= bb.width) {
    classification = 'probable_wall_plane';
    confidence = 40 + Math.min(15, Math.round(normArea * 30));
  }
  // ── Ground detection ──
  else if (normYCenter > 0.6 && (isGreenish || normYCenter > 0.75) && normArea > 0.02) {
    classification = 'probable_ground_noise';
    confidence = 40 + Math.min(20, Math.round(normArea * 30));
  }
  // ── Equipment detection ──
  else if (normArea > 0.003 && normArea < 0.04 && normYCenter < 0.6) {
    classification = 'probable_equipment';
    confidence = 35 + Math.min(15, Math.round((1 - normYCenter) * 20));
  }
  // ── Obstruction detection ──
  else if (normArea < 0.01 && normArea > 0.0005) {
    classification = 'probable_obstruction';
    confidence = 30 + Math.min(15, Math.round(normArea * 1000));
  }
  // ── Fallback ──
  else if (normArea > 0.01 && normYCenter < 0.5) {
    // Phase 0 (P0-8.3): When PHASE0_CANNY_BACKGROUND_FIX is enabled, route
    // unclassifiable upper-half contours to 'background' instead of the false
    // positive 'probable_roof_plane'. This is the single largest source of
    // artifact contamination — unknown contours in the upper image half were
    // assumed to be roof, creating fake roof planes at confidence 35.
    // Background classification uses confidence 20 (well below the 55 canonical
    // promotion threshold introduced in P0-4.3) as a conservative false-negative
    // bias: if we can't classify it, assume it's NOT a roof.
    if (isPhase0CannyBackgroundFixEnabled()) {
      classification = 'background';
      confidence = 20;
    } else {
      classification = 'probable_roof_plane';
      confidence = 35;
    }
  }
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

// ────────────────────────────────────────────────────────────────────────────
// Grayscale processing for metrics and line detection
// ────────────────────────────────────────────────────────────────────────────

function gaussianBlur(data: Uint8Array, w: number, h: number, kernelSize: number): Float64Array {
  const output = new Float64Array(w * h);
  const half = Math.floor(kernelSize / 2);
  const sigma = half / 2;

  const kernel: number[] = [];
  let kernelSum = 0;
  for (let i = -half; i <= half; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(val);
    kernelSum += val;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kernelSum;

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

  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= highThreshold) {
      strong[i] = 1;
    } else if (nms[i] >= lowThreshold) {
      weak[i] = 1;
    }
  }

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

// ────────────────────────────────────────────────────────────────────────────
// Metrics computation
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Line detection (Hough-like)
// ────────────────────────────────────────────────────────────────────────────

function detectLines(
  edges: Uint8Array,
  w: number,
  h: number,
): ExtractedLine[] {
  const lines: ExtractedLine[] = [];

  // Horizontal projection
  const hProjection = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x]) count++;
    }
    hProjection[y] = count;
  }

  // Vertical projection
  const vProjection = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < h; y++) {
      if (edges[y * w + x]) count++;
    }
    vProjection[x] = count;
  }

  // Horizontal peaks
  const hPeaks = findProjectionPeaks(hProjection, 4, MIN_LINE_LENGTH / w * 100);
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

  // Vertical peaks
  const vPeaks = findProjectionPeaks(vProjection, 4, MIN_LINE_LENGTH / h * 100);
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

  // Diagonal lines — only 2 strongest angles
  for (const angleDeg of [45, 135]) {
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

// ────────────────────────────────────────────────────────────────────────────
// Conversion to NormalizedRegion / NormalizedLine
// ────────────────────────────────────────────────────────────────────────────

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
