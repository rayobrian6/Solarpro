/**
 * Overlay coordinate conversion utilities.
 *
 * Candidates store geometry in `normalized_image_0_1000` coordinates
 * (0–1000 range mapped to the full image dimensions). These helpers convert
 * that geometry into SVG-friendly percentages or pixel values so that
 * review overlays render correctly on displayed images regardless of the
 * image's rendered size.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * These overlays are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state.
 */

/** Shape of a normalized region stored in `payload.region`. */
export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/** Shape of a normalized line stored in `payload.line`. */
export interface NormalizedLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  strength: number;
  coordinateSystem: 'normalized_image_0_1000';
}

/** SVG-friendly rect in percentage units (0–100). */
export interface SvgPercentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** SVG-friendly line in percentage units (0–100). */
export interface SvgPercentLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** SVG-friendly polygon in percentage units (0–100). */
export interface SvgPercentPolygon {
  points: string; // SVG points string "x1,y1 x2,y2 x3,y3 ..."
}

/** Pixel rect for a known image dimension. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Convert a `normalized_image_0_1000` region to SVG percentage coordinates.
 *
 * The normalised coordinate system maps 0–1000 onto the full image extent.
 * SVG `viewBox="0 0 100 100"` makes percentage math trivial: just divide by 10.
 */
export function normalizedRegionToSvgPercent(region: NormalizedRegion): SvgPercentRect {
  return {
    x: region.x / 10,
    y: region.y / 10,
    width: region.width / 10,
    height: region.height / 10,
  };
}

/**
 * Convert a `normalized_image_0_1000` line to SVG percentage coordinates.
 */
export function normalizedLineToSvgPercent(line: NormalizedLine): SvgPercentLine {
  return {
    x1: line.x1 / 10,
    y1: line.y1 / 10,
    x2: line.x2 / 10,
    y2: line.y2 / 10,
  };
}

/**
 * Convert an array of normalized polygon vertices to an SVG polygon points string.
 *
 * Each vertex {x, y} in `normalized_image_0_1000` (0–1000) maps to
 * percentage coordinates (0–100) by dividing by 10. The result is a
 * space-separated string of "x,y" pairs suitable for an SVG `<polygon>`
 * element's `points` attribute.
 */
export function normalizedPolygonToSvgPercent(
  vertices: Array<{ x: number; y: number; coordinateSystem?: string }>,
): SvgPercentPolygon {
  const points = vertices
    .map((v) => `${(v.x / 10).toFixed(2)},${(v.y / 10).toFixed(2)}`)
    .join(' ');
  return { points };
}

/**
 * Convert a `normalized_image_0_1000` region to pixel coordinates for a
 * known image width/height.
 */
export function normalizedRegionToPixels(
  region: NormalizedRegion,
  imageWidth: number,
  imageHeight: number,
): PixelRect {
  return {
    x: (region.x / 1000) * imageWidth,
    y: (region.y / 1000) * imageHeight,
    width: (region.width / 1000) * imageWidth,
    height: (region.height / 1000) * imageHeight,
  };
}

/**
 * Extract a drawable region from a candidate payload.
 *
 * The stored candidate's `payload` contains `region` (copied by
 * `withCandidateGeometry()`) and optionally `bbox` (from OCR/YOLO stages).
 * Returns `null` if no drawable geometry is found.
 */
export function extractDrawableRegion(
  payload: Record<string, unknown>,
): NormalizedRegion | null {
  // Priority 1: payload.region (the canonical region from withCandidateGeometry)
  const region = payload.region;
  if (isValidNormalizedRegion(region)) {
    return region;
  }

  // Priority 2: payload.bbox (from OCR/YOLO stages that store [x, y, w, h] array)
  const bbox = payload.bbox;
  if (isValidBbox(bbox)) {
    return {
      x: bbox[0],
      y: bbox[1],
      width: bbox[2],
      height: bbox[3],
      coordinateSystem: 'normalized_image_0_1000',
    };
  }

  return null;
}

/**
 * Extract a drawable line from a candidate payload.
 */
export function extractDrawableLine(
  payload: Record<string, unknown>,
): NormalizedLine | null {
  const line = payload.line;
  if (isValidNormalizedLine(line)) {
    return line;
  }
  return null;
}

/**
 * Extract a drawable polygon from a unified geometry artifact's `polygon` field.
 *
 * The polygon has a `vertices` array of `{x, y, coordinateSystem}` objects
 * in `normalized_image_0_1000` coordinates. Returns the vertices array if
 * valid, or null if no drawable polygon is found.
 */
export function extractDrawablePolygon(
  artifact: { polygon: unknown },
): Array<{ x: number; y: number; coordinateSystem: string }> | null {
  if (!artifact || !artifact.polygon || typeof artifact.polygon !== 'object') {
    return null;
  }
  const poly = artifact.polygon as { vertices?: unknown; coordinateSystem?: string };
  if (!Array.isArray(poly.vertices) || poly.vertices.length < 3) {
    return null;
  }
  const vertices = poly.vertices as Array<unknown>;
  // Validate each vertex has x, y numbers
  const valid = vertices.every(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      typeof (v as Record<string, unknown>).x === 'number' &&
      typeof (v as Record<string, unknown>).y === 'number',
  );
  if (!valid) return null;
  return vertices as Array<{ x: number; y: number; coordinateSystem: string }>;
}

/**
 * Determine whether a candidate has drawable geometry (region or bbox).
 * Candidates without geometry (e.g. `edge_map_summary`) should be skipped
 * for overlay rendering but must not block rendering of other candidates.
 */
export function hasDrawableGeometry(payload: Record<string, unknown>): boolean {
  return extractDrawableRegion(payload) !== null || extractDrawableLine(payload) !== null;
}

/**
 * Classify a candidate into an overlay filter category.
 *
 * - "cv" — OpenCV-derived candidates (rectangular_region_candidate, obstruction_candidate, etc.)
 * - "yolo" — YOLO/object_detection candidates
 * - "ocr" — OCR text candidates
 * - "other" — anything else (edge_map_summary, etc.)
 */
export type OverlayFilterCategory = 'cv' | 'yolo' | 'ocr' | 'other';

export function classifyCandidateForFilter(
  candidateType: string,
  payload: Record<string, unknown>,
): OverlayFilterCategory {
  const stage = String(payload.stage ?? '').toLowerCase();
  const source = String(payload.source ?? '').toLowerCase();

  if (candidateType === 'object_detection' || stage.includes('yolo') || source.includes('yolo')) {
    return 'yolo';
  }
  if (candidateType === 'ocr_text' || stage.includes('ocr') || stage.includes('tesseract') || source.includes('ocr') || source.includes('tesseract')) {
    return 'ocr';
  }
  if (
    candidateType === 'rectangular_region_candidate' ||
    candidateType === 'obstruction_candidate' ||
    candidateType === 'equipment_anchor_candidate' ||
    candidateType === 'roof_edge_candidate' ||
    candidateType === 'wall_anchor_candidate' ||
    candidateType === 'dominant_line_candidate' ||
    stage.includes('opencv') ||
    source.includes('opencv') ||
    source.includes('dense_edge')
  ) {
    return 'cv';
  }
  return 'other';
}

/**
 * Filter candidates for the overlay display based on the active filter.
 *
 * The "both" filter (All CV/OCR) includes cv, yolo, and ocr categories
 * but excludes "other" (e.g. edge_map_summary with no geometry).
 * Candidates with null geometry are always skipped for overlays but
 * this filter does not remove them from the data — it just determines
 * which are eligible for overlay rendering.
 */
export function candidatesPassOverlayFilter(
  candidateType: string,
  payload: Record<string, unknown>,
  filter: 'both' | 'opencv' | 'yolo' | 'ocr',
): boolean {
  const category = classifyCandidateForFilter(candidateType, payload);
  if (filter === 'both') return category === 'cv' || category === 'yolo' || category === 'ocr';
  if (filter === 'opencv') return category === 'cv';
  if (filter === 'yolo') return category === 'yolo';
  if (filter === 'ocr') return category === 'ocr';
  return false;
}

// ── Type guards ──────────────────────────────────────────────────────────

function isValidNormalizedRegion(value: unknown): value is NormalizedRegion {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    r.coordinateSystem === 'normalized_image_0_1000'
  );
}

function isValidNormalizedLine(value: unknown): value is NormalizedLine {
  if (!value || typeof value !== 'object') return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.x1 === 'number' &&
    typeof l.y1 === 'number' &&
    typeof l.x2 === 'number' &&
    typeof l.y2 === 'number' &&
    l.coordinateSystem === 'normalized_image_0_1000'
  );
}

function isValidBbox(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value)) return false;
  return (
    value.length === 4 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    typeof value[2] === 'number' &&
    typeof value[3] === 'number'
  );
}
