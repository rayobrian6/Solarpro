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

export const LINE_EXTRACTION_WORKER_VERSION = '1.0.0-line-extraction-worker';

// ---------------------------------------------------------------------------
// Limitations
// ---------------------------------------------------------------------------

const LINE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Line extraction is heuristic — not from Hough transform or model inference.',
  'When a real line detector is available, this worker will be upgraded.',
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
 * Classification rules:
 * - Roof mask, near-horizontal, upper half → ridge
 * - Roof mask, near-horizontal, lower half → eave
 * - Roof mask, diagonal → rake
 * - Wall mask, near-vertical → wall_vertical
 * - Wall mask, near-horizontal → eave (top of wall)
 * - Other masks → skip (no structural lines from sky/tree/ground/etc.)
 */
function classifyEdge(
  _edge: RawEdge,
  _angleTolerance: number,
): StructuralLineType | null {
  throw new Error(
    `NOT_IMPLEMENTED: classifyEdge() for sourceClass='${_edge.sourceClass}'. ` +
    `Heuristic edge classification has been removed. Awaiting real line detector (e.g., Hough transform) integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
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
  throw new Error(
    `NOT_IMPLEMENTED: computeLineConfidence() for lineType='${lineType}'. ` +
    `Heuristic line confidence computation has been removed. Awaiting real line detector (e.g., Hough transform) integration. ` +
    `See P0.3 in WORK_PLAN_GEOMETRY_CAD_PIPELINE_V2.md.`
  );
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
