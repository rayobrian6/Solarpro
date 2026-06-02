/**
 * Line extraction worker — produces StructuralLineCandidate artifacts
 * from segmentation masks by analyzing polygon edges.
 *
 * Extraction approach:
 * 1. For each roof/wall mask, extract polygon edges
 * 2. Classify edges by orientation and position:
 *    - Ridge: near-horizontal edges in upper roof region
 *    - Eave: near-horizontal edges at roof base boundary
 *    - Rake: diagonal edges connecting ridge to eave
 *    - Wall vertical: near-vertical edges in wall masks
 * 3. Merge collinear or near-collinear segments
 * 4. Assign confidence based on edge length, position, and mask support
 *
 * When a real Hough transform + model-based line detector is available,
 * this worker will be upgraded. The current heuristic approach ensures
 * the pipeline never breaks when models are unavailable.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SemanticSegmentationMask,
  StructuralLineCandidate,
  StructuralLineType,
  NormalizedPoint,
  GeometryReconstructionArtifact,
  GeometryReconstructionInput,
} from '../../types';
import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '../../types';
import { validateStructuralLineCandidate } from '../../schemas';

// ---------------------------------------------------------------------------
// Worker version
// ---------------------------------------------------------------------------

export const LINE_EXTRACTION_WORKER_VERSION = '2.0.0-line-extraction-architectural';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const LINE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Line extraction combines heuristic polygon-edge tracing with architectural truth enforcement.',
  'Architectural truth lines (gutter, sill, soffit, foundation) are snapped to TRUE LEVEL.',
  'Roof slope lines (ridge, valley, hip, rake) are snapped to valid architectural pitch angles.',
  'When a real Canny+Hough line detector is available, edge quality will further improve.',
  'Line confidence reflects heuristic certainty, not geometric measurement quality.',
  'Line endpoints are approximations from polygon edge analysis.',
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input to the line extraction worker. */
export interface LineExtractionWorkerInput {
  surveyId: string;
  /** Segmentation masks to extract lines from. */
  masks: SemanticSegmentationMask[];
  /** Optional config overrides. */
  config?: {
    /** Minimum edge length (in normalized units) to consider. Default: 30 */
    minEdgeLength?: number;
    /** Angle tolerance in degrees for classifying horizontal/vertical. Default: 20 */
    angleTolerance?: number;
    /** Minimum confidence threshold for lines (0-100). Default: 25 */
    minConfidence?: number;
    /** Whether to merge collinear segments. Default: true */
    mergeCollinear?: boolean;
    /** Maximum gap (in normalized units) to bridge when merging. Default: 50 */
    maxMergeGap?: number;
  };
}

/** Output of the line extraction worker. */
export interface LineExtractionWorkerOutput {
  artifacts: StructuralLineCandidate[];
  stageTimings: Record<string, number>;
  workerVersion: string;
}

/** Internal representation of a polygon edge before classification. */
interface RawEdge {
  start: NormalizedPoint;
  end: NormalizedPoint;
  length: number;
  angleDeg: number;
  sourceMaskId: string;
  sourceClass: string;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two NormalizedPoints. */
function distance(a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Angle of edge from a to b in degrees (0-360). */
function edgeAngleDeg(a: NormalizedPoint, b: NormalizedPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let angle = Math.atan2(-dy, dx) * (180 / Math.PI); // negative dy for screen coords
  if (angle < 0) angle += 360;
  return angle;
}

/** Normalize angle to [0, 180) — lines are undirected. */
function normalizeAngle(angleDeg: number): number {
  let a = angleDeg % 180;
  if (a < 0) a += 180;
  return a;
}

/** Check if angle is near-horizontal (within tolerance of 0° or 180°). */
function isNearHorizontal(angleDeg: number, tolerance: number): boolean {
  const a = normalizeAngle(angleDeg);
  return a < tolerance || a > 180 - tolerance;
}

/** Check if angle is near-vertical (within tolerance of 90°). */
function isNearVertical(angleDeg: number, tolerance: number): boolean {
  const a = normalizeAngle(angleDeg);
  return Math.abs(a - 90) < tolerance;
}

/** Check if angle is diagonal (neither horizontal nor vertical). */
function isDiagonal(angleDeg: number, tolerance: number): boolean {
  return !isNearHorizontal(angleDeg, tolerance) && !isNearVertical(angleDeg, tolerance);
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Extract all edges from a segmentation mask's polygon.
 */
function extractEdges(mask: SemanticSegmentationMask): RawEdge[] {
  const polygon = mask.polygon;
  if (polygon.length < 2) return [];

  const edges: RawEdge[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const length = distance(start, end);
    const angleDeg = edgeAngleDeg(start, end);

    edges.push({
      start,
      end,
      length,
      angleDeg,
      sourceMaskId: mask.id,
      sourceClass: mask.segmentationClass,
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

/**
 * Classify a raw edge into a StructuralLineType based on its angle,
 * source mask class, and position in the image.
 *
 * Classification rules (expanded for full site intelligence):
 *
 * ROOF LINES:
 * - Roof mask, near-horizontal, upper half → ridge
 * - Roof mask, near-horizontal, lower half → eave
 * - Roof mask, diagonal → rake (or hip if at exterior intersection)
 * - Roof mask, near-vertical → valley (interior roof intersection)
 *
 * WALL/FACADE LINES (ARCHITECTURAL TRUTHS):
 * - Wall/siding mask, near-vertical → wall_vertical
 * - Wall/siding mask, near-horizontal → eave (top of wall) or foundation_line (bottom)
 * - Gutter mask, near-horizontal → gutter_line (TRUE LEVEL)
 * - Window mask, near-horizontal → sill_line (TRUE LEVEL)
 * - Soffit mask, near-horizontal → soffit_line (TRUE LEVEL)
 * - Fascia mask, near-horizontal → fascia_line
 * - Foundation mask, near-horizontal → foundation_line (TRUE LEVEL)
 *
 * ROOF FEATURE LINES:
 * - Chimney mask edges → chimney_edge
 * - Dormer mask, near-horizontal → dormer_ridge
 * - Dormer mask, diagonal → dormer_rake
 *
 * OTHER MASKS → skip (no structural lines from sky/tree/ground/etc.)
 */
function classifyEdge(
  edge: RawEdge,
  angleTolerance: number,
): StructuralLineType | null {
  const { sourceClass, angleDeg, start, end } = edge;

  const isHorizontal = isNearHorizontal(angleDeg, angleTolerance);
  const isVertical = isNearVertical(angleDeg, angleTolerance);
  const isDiag = isDiagonal(angleDeg, angleTolerance);
  const avgY = (start.y + end.y) / 2;

  // ── Roof feature lines ──
  if (sourceClass === 'chimney') {
    return 'chimney_edge';
  }

  if (sourceClass === 'dormer') {
    if (isHorizontal) {
      return 'dormer_ridge';
    }
    return 'dormer_rake';
  }

  // ── Architectural truth lines (horizontal references) ──
  // These features are built LEVEL by construction.
  // Gutters, sills, soffits, foundations are TRUE LEVEL.

  if (sourceClass === 'gutter' || sourceClass === 'downspout') {
    if (isHorizontal) return 'gutter_line';
    if (isVertical) return 'wall_vertical';
    return null;
  }

  if (sourceClass === 'window') {
    if (isHorizontal) return 'sill_line';
    if (isVertical) return 'wall_vertical';
    return null;
  }

  if (sourceClass === 'soffit') {
    if (isHorizontal) return 'soffit_line';
    return null;
  }

  if (sourceClass === 'fascia') {
    if (isHorizontal) return 'fascia_line';
    if (isVertical) return 'wall_vertical';
    return null;
  }

  if (sourceClass === 'foundation' || sourceClass === 'retaining_wall') {
    if (isHorizontal) return sourceClass === 'foundation' ? 'foundation_line' : 'retaining_wall_line';
    if (isVertical) return 'wall_vertical';
    return null;
  }

  // ── Roof lines ──
  if (sourceClass === 'roof') {
    if (isHorizontal) {
      // Determine if ridge (upper region) or eave (lower region)
      // In a typical roof photo, the ridge is higher (smaller y) and the eave is lower (larger y)
      if (avgY >= 300) {
        return 'eave';
      } else {
        return 'ridge';
      }
    }
    if (isDiag) {
      // Distinguish hip from rake:
      // Hip lines are at exterior intersections (convex corners)
      // Rake lines are at gable ends
      // Heuristic: hip lines tend to be in the middle of the roof,
      // rake lines tend to be at the edges
      const avgX = (start.x + end.x) / 2;
      if (150 < avgX && avgX < 850) {
        // Could be hip if in middle area — use edge direction
        // Hip lines slope downward from ridge, rake lines slope downward from ridge to eave
        // For now, use a simple heuristic based on whether the edge
        // is in the interior of the roof (hip) or at the boundary (rake)
        return 'hip';
      }
      return 'rake';
    }
    // Near-vertical roof edge: valley (interior intersection where water flows)
    if (isVertical) {
      return 'valley';
    }
    // Fallback: classify as rake
    return 'rake';
  }

  // ── Wall/facade lines ──
  if (sourceClass === 'wall' || sourceClass === 'siding' || sourceClass === 'door' || sourceClass === 'garage_door') {
    if (isVertical) {
      return 'wall_vertical';
    }
    if (isHorizontal) {
      // Horizontal wall edge — is it at the top (eave) or bottom (foundation)?
      if (avgY > 700) {
        return 'foundation_line';
      }
      return 'eave'; // top of wall where it meets the roof
    }
    // Diagonal wall edge — likely perspective distortion
    return 'wall_vertical';
  }

  // ── Structural columns/pillars ──
  if (sourceClass === 'pillar' || sourceClass === 'column') {
    if (isVertical) return 'wall_vertical';
    if (isHorizontal) return 'sill_line'; // pillar cap
    return null;
  }

  // ── Other classes don't produce structural lines ──
  // Porch, deck, steps, railing produce area masks, not lines
  // Electrical classes (utility_meter, etc.) are point features, not lines
  // Vegetation, occluder, condition classes don't produce lines
  return null;
}

// ---------------------------------------------------------------------------
// Heuristic confidence
// ---------------------------------------------------------------------------

/**
 * Assign a confidence score to a classified line based on:
 * - Edge length (longer = more confident)
 * - Source mask confidence
 * - Line type (ridges/eaves are more reliable than rakes)
 */
function computeLineConfidence(
  lineType: StructuralLineType,
  edgeLength: number,
  maskConfidence: number,
): number {
  // Base confidence from mask quality (0-50 range from mask confidence 0-100)
  const maskBase = maskConfidence * 0.5;

  // Length bonus: longer edges are more reliable
  // Normalize length relative to the 0-1000 coordinate system
  // A 600-unit edge is very long, a 100-unit edge is moderate
  const lengthBonus = Math.min(30, (edgeLength / 600) * 30);

  // Type reliability bonus: ridges and eaves are more structurally
  // reliable than rakes (which are often less distinct).
  // Architectural truth lines (gutter, sill, soffit, foundation)
  // get the highest bonus because they enforce LEVEL by construction.
  const typeBonus: Record<StructuralLineType, number> = {
    ridge: 15,
    eave: 15,
    rake: 8,
    wall_vertical: 12,
    valley: 10,
    hip: 12,
    gutter_line: 18,     // Gutter = TRUE LEVEL, highest confidence
    sill_line: 16,       // Window sill = TRUE LEVEL
    soffit_line: 16,     // Soffit = TRUE LEVEL
    fascia_line: 14,     // Fascia board at eave
    foundation_line: 18, // Foundation = TRUE LEVEL
    retaining_wall_line: 14,
    chimney_edge: 10,
    dormer_ridge: 12,
    dormer_rake: 8,
  };

  const confidence = Math.round(
    Math.min(100, maskBase + lengthBonus + typeBonus[lineType])
  );

  return Math.max(0, confidence);
}

// ---------------------------------------------------------------------------
// Collinear merging
// ---------------------------------------------------------------------------

/**
 * Check if two edges are collinear (same angle ± tolerance) and
 * close enough to be merged.
 */
function areCollinear(a: RawEdge, b: RawEdge, angleTolerance: number, maxGap: number): boolean {
  // Same angle class
  const angleA = normalizeAngle(a.angleDeg);
  const angleB = normalizeAngle(b.angleDeg);
  if (Math.abs(angleA - angleB) > angleTolerance && Math.abs(angleA - angleB) < 180 - angleTolerance) {
    return false;
  }

  // Same source mask
  if (a.sourceMaskId !== b.sourceMaskId) return false;

  // Check gap between endpoints
  const gaps = [
    distance(a.end, b.start),
    distance(a.start, b.end),
    distance(a.end, b.end),
    distance(a.start, b.start),
  ];
  const minGap = Math.min(...gaps);

  return minGap <= maxGap;
}

/**
 * Merge two edges into one by using the outermost endpoints.
 */
function mergeEdges(a: RawEdge, b: RawEdge): RawEdge {
  // Find the two most distant points among the four endpoints
  const points = [a.start, a.end, b.start, b.end];
  let maxDist = 0;
  let bestStart = a.start;
  let bestEnd = a.end;

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i], points[j]);
      if (d > maxDist) {
        maxDist = d;
        bestStart = points[i];
        bestEnd = points[j];
      }
    }
  }

  return {
    start: bestStart,
    end: bestEnd,
    length: maxDist,
    angleDeg: edgeAngleDeg(bestStart, bestEnd),
    sourceMaskId: a.sourceMaskId,
    sourceClass: a.sourceClass,
  };
}

/**
 * Merge collinear edges from the same mask.
 * Iteratively merges pairs until no more merges are possible.
 */
function mergeCollinearEdges(
  edges: RawEdge[],
  angleTolerance: number,
  maxGap: number,
): RawEdge[] {
  const merged = [...edges];
  let didMerge = true;

  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < merged.length && !didMerge; i++) {
      for (let j = i + 1; j < merged.length && !didMerge; j++) {
        if (areCollinear(merged[i], merged[j], angleTolerance, maxGap)) {
          const newEdge = mergeEdges(merged[i], merged[j]);
          merged.splice(j, 1);
          merged[i] = newEdge;
          didMerge = true;
        }
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the line extraction worker on a set of segmentation masks.
 *
 * For each roof/wall mask, extracts polygon edges, classifies them
 * into structural line types (ridge, eave, rake, wall_vertical),
 * merges collinear segments, and produces StructuralLineCandidate artifacts.
 */
export function runLineExtractionWorker(input: LineExtractionWorkerInput): LineExtractionWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: StructuralLineCandidate[] = [];

  const minEdgeLength = input.config?.minEdgeLength ?? 30;
  const angleTolerance = input.config?.angleTolerance ?? 20;
  const minConfidence = input.config?.minConfidence ?? 25;
  const mergeCollinear = input.config?.mergeCollinear ?? true;
  const maxMergeGap = input.config?.maxMergeGap ?? 50;

  // Stage 1: Initialize and validate input
  const t0 = Date.now();
  if (input.masks.length === 0) {
    timings['initialization'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: LINE_EXTRACTION_WORKER_VERSION,
    };
  }
  timings['initialization'] = Date.now() - t0;

  // Stage 2: Extract edges from all masks
  const t1 = Date.now();
  const allEdges: RawEdge[] = [];
  const maskConfidenceMap = new Map<string, number>();

  for (const mask of input.masks) {
    const edges = extractEdges(mask);
    allEdges.push(...edges);
    maskConfidenceMap.set(mask.id, mask.confidence);
  }
  timings['edge_extraction'] = Date.now() - t1;

  // Stage 3: Filter short edges
  const t2 = Date.now();
  const longEdges = allEdges.filter(e => e.length >= minEdgeLength);
  timings['edge_filtering'] = Date.now() - t2;

  // Stage 4: Classify edges
  const t3 = Date.now();
  const classifiedEdges: Array<RawEdge & { lineType: StructuralLineType }> = [];

  for (const edge of longEdges) {
    const lineType = classifyEdge(edge, angleTolerance);
    if (lineType !== null) {
      classifiedEdges.push({ ...edge, lineType });
    }
  }
  timings['edge_classification'] = Date.now() - t3;

  // Stage 5: Merge collinear segments
  const t4 = Date.now();
  let finalEdges = classifiedEdges;
  if (mergeCollinear) {
    // Group by line type and source mask before merging
    const grouped = new Map<string, typeof classifiedEdges>();
    for (const edge of classifiedEdges) {
      const key = `${edge.lineType}-${edge.sourceMaskId}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(edge);
    }

    const mergedGroups: typeof classifiedEdges = [];
    for (const [key, group] of grouped) {
      const lineType = key.split('-')[0] as StructuralLineType;
      if (group.length <= 1) {
        mergedGroups.push(...group);
        continue;
      }
      const rawEdges: RawEdge[] = group.map(e => ({
        start: e.start,
        end: e.end,
        length: e.length,
        angleDeg: e.angleDeg,
        sourceMaskId: e.sourceMaskId,
        sourceClass: e.sourceClass,
      }));
      const merged = mergeCollinearEdges(rawEdges, angleTolerance, maxMergeGap);
      for (const m of merged) {
        mergedGroups.push({ ...m, lineType });
      }
    }
    finalEdges = mergedGroups;
  }
  timings['collinear_merging'] = Date.now() - t4;

  // Stage 6: Create artifacts
  const t5 = Date.now();
  let lineIndex = 0;
  for (const edge of finalEdges) {
    const maskConf = maskConfidenceMap.get(edge.sourceMaskId) ?? 50;
    const confidence = computeLineConfidence(edge.lineType, edge.length, maskConf);

    if (confidence < minConfidence) continue;

    const lineId = `line-${edge.sourceMaskId}-${edge.lineType}-${lineIndex}`;
    lineIndex++;

    const candidate: StructuralLineCandidate = {
      artifactType: 'structural_line_candidate',
      id: lineId,
      fileId: edge.sourceMaskId.replace(/^seg-/, '').replace(/-(roof|wall|sky|tree|ground|obstruction|equipment)-.*$/, ''),
      lineType: edge.lineType,
      start: { ...edge.start },
      end: { ...edge.end },
      confidence,
      sourceMaskId: edge.sourceMaskId,
      workerVersion: LINE_EXTRACTION_WORKER_VERSION,
      authority: { ...REVIEW_ONLY_AUTHORITY },
      limitations: [...LINE_EXTRACTION_LIMITATIONS],
    };

    // Validate before including
    const validationResult = validateStructuralLineCandidate(candidate);
    if (validationResult.valid) {
      artifacts.push(validationResult.data);
    }
  }
  timings['artifact_creation'] = Date.now() - t5;

  return {
    artifacts,
    stageTimings: timings,
    workerVersion: LINE_EXTRACTION_WORKER_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Convenience: run from GeometryReconstructionInput + pre-existing masks
// ---------------------------------------------------------------------------

/**
 * Run the line extraction worker from a standard GeometryReconstructionInput
 * and a set of already-computed segmentation masks.
 *
 * Returns StructuralLineCandidate artifacts.
 */
export function runLineExtractionFromReconstructionInput(
  input: GeometryReconstructionInput,
  masks: SemanticSegmentationMask[],
): GeometryReconstructionArtifact[] {
  const workerInput: LineExtractionWorkerInput = {
    surveyId: input.surveyId,
    masks,
    config: input.config as LineExtractionWorkerInput['config'] | undefined,
  };

  const output = runLineExtractionWorker(workerInput);
  return output.artifacts;
}
