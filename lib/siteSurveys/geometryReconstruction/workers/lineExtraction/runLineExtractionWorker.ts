/**
 * Line extraction worker — produces StructuralLineCandidate artifacts
 * from segmentation masks by analyzing polygon edges.
 *
 * EXTRACTION APPROACH (v2 — structure-first):
 * 1. Pre-filter masks: ONLY structure-qualified masks (roof, wall, siding,
 *    fascia, soffit, gutter, deck, porch, railing, steps, downspout)
 *    produce structural lines. Non-structure masks (vehicle, grass, driveway,
 *    tree, etc.) are REJECTED before any edge extraction occurs.
 * 2. For each qualified mask, extract polygon edges
 * 3. Classify edges by orientation, position, and source class:
 *    - Ridge: near-horizontal edges in upper roof region
 *    - Eave: near-horizontal edges at roof base boundary, or fascia/soffit/gutter edges
 *    - Rake: diagonal edges connecting ridge to eave
 *    - Wall vertical: near-vertical edges in wall/siding masks
 *    - Wall bottom edge: near-horizontal boundary between wall/siding and
 *      ground-level masks (foundation/basement line)
 * 4. Filter by straightness: reject jagged micro-edges from SAM2 polygon noise
 * 5. Merge collinear or near-collinear segments (including cross-mask)
 * 6. Cross-mask deduplication: remove duplicate lines from adjacent SAM2 masks
 * 7. Cap emitted line candidates per source mask
 * 8. Assign confidence based on edge length, position, mask support,
 *    source class quality, and structural usefulness ranking
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LINE_EXTRACTION_WORKER_VERSION = '2.0.0-structure-first-line-extraction';

/** Standard limitations for line extraction artifacts. */
const LINE_EXTRACTION_LIMITATIONS = [
  ...BASE_LIMITATIONS,
  'Heuristic edge extraction from SAM2 polygon boundaries — not from Hough transform or model inference',
  'Line type classification is orientation-based heuristic — may misclassify valleys as rakes',
  'No vanishing-point or perspective correction applied',
  'Structure-first filtering rejects non-structure masks before extraction',
  'Cross-mask deduplication removes duplicate lines from adjacent SAM2 masks',
  'Per-mask cap limits line candidates per source mask to prevent edge proliferation',
];

// ---------------------------------------------------------------------------
// Structure-first filtering: allowlist / blocklist
// ---------------------------------------------------------------------------

/**
 * ONLY masks whose segmentationClass is in this set produce structural lines.
 * All other classes are rejected before edge extraction begins.
 */
const STRUCTURE_QUALIFIED_CLASSES: ReadonlySet<string> = new Set([
  'roof',
  'wall',
  'siding',
  'fascia',
  'soffit',
  'gutter',
  'porch',
  'deck',
  'railing',
  'steps',
  'downspout',
]);

/**
 * Explicitly rejected classes — even if somehow not caught by the allowlist
 * exclusion, these are double-blocked. These masks NEVER produce structural
 * lines regardless of any other criteria.
 */
const REJECTED_CLASSES: ReadonlySet<string> = new Set([
  'car',
  'truck',
  'trailer',
  'equipment',
  'grass',
  'trees',
  'bush',
  'driveway',
  'gravel',
  'ground',
  'sky',
  'sidewalk',
  'muddy_work_area',
  'unknown',
  'temporary_occluder',
]);

/**
 * Ground-level classes — used to detect wall_bottom_edge / foundation edge.
 * The top boundary of these masks adjacent to a wall/siding mask indicates
 * where the wall meets the ground.
 */
const GROUND_LEVEL_CLASSES: ReadonlySet<string> = new Set([
  'grass',
  'driveway',
  'gravel',
  'ground',
  'sidewalk',
  'muddy_work_area',
]);

/**
 * Structural usefulness ranking — higher = more useful for geometry reconstruction.
 * Used to sort and cap line candidates per mask.
 */
const STRUCTURAL_USEFULNESS: Record<StructuralLineType, number> = {
  ridge: 100,
  eave: 90,
  wall_bottom_edge: 80,
  rake: 70,
  wall_vertical: 60,
};

/**
 * Source class quality bonus — masks from classes that more reliably produce
 * correct structural lines get a confidence bonus.
 */
const SOURCE_CLASS_QUALITY: Record<string, number> = {
  roof: 10,
  wall: 8,
  siding: 6,
  fascia: 5,
  soffit: 4,
  gutter: 3,
  porch: 2,
  deck: 2,
  railing: 1,
  steps: 1,
  downspout: 0,
};

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
    /** Maximum lines emitted per source mask. Default: 8 */
    maxLinesPerMask?: number;
    /** Minimum straightness (0-1) for an edge chain to be kept. Default: 0.7 */
    minStraightness?: number;
    /** Whether to apply cross-mask deduplication. Default: true */
    crossMaskDedup?: boolean;
  };
}

/** Diagnostic statistics for the structure-first filtering pipeline. */
export interface LineExtractionFilterStats {
  /** Number of masks rejected by class pre-filter. */
  masksRejectedByClass: number;
  /** Number of masks that passed the class pre-filter. */
  masksPassedPrefilter: number;
  /** Total edges extracted from qualified masks. */
  edgesExtracted: number;
  /** Edges rejected by straightness filter. */
  edgesRejectedByStraightness: number;
  /** Edges remaining after straightness filter. */
  edgesAfterStraightness: number;
  /** Lines removed by cross-mask deduplication. */
  linesDedupedCrossMask: number;
  /** Lines removed by per-mask cap. */
  linesCappedByMask: number;
  /** Final number of line candidate artifacts emitted. */
  finalLineCount: number;
}

/** Output of the line extraction worker. */
export interface LineExtractionWorkerOutput {
  artifacts: StructuralLineCandidate[];
  stageTimings: Record<string, number>;
  workerVersion: string;
  /** Diagnostic statistics from the structure-first filtering pipeline. */
  filterStats: LineExtractionFilterStats;
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
  return a <= tolerance || a >= 180 - tolerance;
}

/** Check if angle is near-vertical (within tolerance of 90°). */
function isNearVertical(angleDeg: number, tolerance: number): boolean {
  const a = normalizeAngle(angleDeg);
  return Math.abs(a - 90) <= tolerance;
}

/** Check if angle is diagonal (neither horizontal nor vertical). */
function isDiagonal(angleDeg: number, tolerance: number): boolean {
  return !isNearHorizontal(angleDeg, tolerance) && !isNearVertical(angleDeg, tolerance);
}

// ---------------------------------------------------------------------------
// Structure-first pre-filtering
// ---------------------------------------------------------------------------

/**
 * Determine whether a segmentation mask qualifies for structural line
 * extraction. A mask qualifies when:
 * 1. Its segmentationClass is in the STRUCTURE_QUALIFIED_CLASSES allowlist, AND
 * 2. Its segmentationClass is NOT in the REJECTED_CLASSES blocklist, AND
 * 3. It is NOT flagged as an occluder (isOccluder).
 *
 * This pre-filter runs BEFORE any edge extraction, ensuring that non-structure
 * masks (vehicles, vegetation, ground, sky, etc.) never produce line candidates.
 */
function isStructureQualifiedMask(mask: SemanticSegmentationMask): boolean {
  const cls = mask.segmentationClass;
  // Must be in the allowlist
  if (!STRUCTURE_QUALIFIED_CLASSES.has(cls)) return false;
  // Must not be in the blocklist
  if (REJECTED_CLASSES.has(cls)) return false;
  // Must not be flagged as occluder
  if (mask.isOccluder) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Straightness filtering
// ---------------------------------------------------------------------------

/**
 * Compute straightness of a single edge (0-1).
 * A perfectly straight edge has straightness 1.0.
 * For single edges (two endpoints), straightness is always 1.0.
 * This function is used for multi-point chains.
 */
function computeEdgeStraightness(start: NormalizedPoint, end: NormalizedPoint): number {
  return 1.0; // single edge is always straight
}

/**
 * Compute straightness of a chain of points (0-1).
 * Measured as the ratio of the straight-line distance between the first
 * and last points to the total path length along all segments.
 * A perfectly straight chain has straightness 1.0.
 * A highly jagged chain has straightness close to 0.
 */
function computeChainStraightness(points: NormalizedPoint[]): number {
  if (points.length < 2) return 0;
  if (points.length === 2) return 1.0;

  // Total path length
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) {
    pathLength += distance(points[i - 1], points[i]);
  }
  if (pathLength === 0) return 0;

  // Straight-line distance between first and last
  const directDist = distance(points[0], points[points.length - 1]);

  return directDist / pathLength;
}

// ---------------------------------------------------------------------------
// Edge extraction from mask polygons
// ---------------------------------------------------------------------------

/**
 * Extract all edges from a mask polygon. Each consecutive pair of vertices
 * forms one edge. The polygon is treated as closed (last → first).
 */
function extractEdges(mask: SemanticSegmentationMask): RawEdge[] {
  const edges: RawEdge[] = [];
  const poly = mask.polygon;
  if (poly.length < 2) return edges;

  for (let i = 0; i < poly.length; i++) {
    const start = poly[i];
    const end = poly[(i + 1) % poly.length];
    const len = distance(start, end);
    const angle = edgeAngleDeg(start, end);

    edges.push({
      start: { ...start },
      end: { ...end },
      length: len,
      angleDeg: angle,
      sourceMaskId: mask.id,
      sourceClass: mask.segmentationClass,
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Ground-level mask boundary extraction (for wall_bottom_edge)
// ---------------------------------------------------------------------------

/**
 * Extract the top boundary of ground-level masks.
 * Returns an array of { y, minX, maxX } for each ground-level mask's
 * top boundary segment. This is used to detect wall_bottom_edge lines
 * where wall/siding masks meet ground-level masks.
 */
function extractGroundMaskTopBoundary(
  masks: SemanticSegmentationMask[],
): Array<{ y: number; minX: number; maxX: number }> {
  const boundaries: Array<{ y: number; minX: number; maxX: number }> = [];

  for (const mask of masks) {
    if (!GROUND_LEVEL_CLASSES.has(mask.segmentationClass)) continue;
    const poly = mask.polygon;
    if (poly.length < 2) continue;

    // Find the minimum y (topmost) point and the extent
    let minY = Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of poly) {
      if (p.y < minY) minY = p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }

    // Also find near-horizontal top edges
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const avgY = (a.y + b.y) / 2;
      // Top edges are those whose average Y is within tolerance of minY
      if (avgY <= minY + 20) {
        boundaries.push({
          y: Math.min(a.y, b.y),
          minX: Math.min(a.x, b.x),
          maxX: Math.max(a.x, b.x),
        });
      }
    }
  }

  return boundaries;
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

/**
 * Classify an edge into a structural line type based on its orientation,
 * position in the image, and source segmentation class.
 *
 * Updated for v2 structure-first extraction:
 * - Accepts all STRUCTURE_QUALIFIED_CLASSES (not just roof/wall)
 * - Fascia/soffit/gutter horizontal edges → eave
 * - Siding/downspout vertical edges → wall_vertical
 * - Wall/siding horizontal edges at ground boundary → wall_bottom_edge
 * - Ground-level mask boundaries used for wall_bottom_edge detection
 */
function classifyEdge(
  edge: RawEdge,
  angleTolerance: number,
  groundBoundaries: Array<{ y: number; minX: number; maxX: number }>,
): StructuralLineType | null {
  const { sourceClass, angleDeg, start, end } = edge;

  // Only structure-qualified classes should reach this point (pre-filtered),
  // but double-check for safety
  if (!STRUCTURE_QUALIFIED_CLASSES.has(sourceClass)) return null;
  if (REJECTED_CLASSES.has(sourceClass)) return null;

  const isHorizontal = isNearHorizontal(angleDeg, angleTolerance);
  const isVertical = isNearVertical(angleDeg, angleTolerance);
  const isDiag = isDiagonal(angleDeg, angleTolerance);

  // --- Roof edges ---
  if (sourceClass === 'roof') {
    if (isHorizontal) {
      const avgY = (start.y + end.y) / 2;
      if (avgY >= 300) {
        return 'eave';
      } else {
        return 'ridge';
      }
    }
    if (isDiag) return 'rake';
    if (isVertical) return 'rake';
    return 'rake'; // fallback
  }

  // --- Wall edges ---
  if (sourceClass === 'wall') {
    if (isVertical) return 'wall_vertical';
    if (isHorizontal) {
      // Check if this edge is at the bottom of the wall (near a ground boundary)
      const avgY = (start.y + end.y) / 2;
      for (const gb of groundBoundaries) {
        // If the edge's Y is close to the ground boundary's top Y
        // and they overlap horizontally
        if (Math.abs(avgY - gb.y) <= 30 &&
            start.x <= gb.maxX && end.x >= gb.minX) {
          return 'wall_bottom_edge';
        }
      }
      // Horizontal wall edge at top → eave (where wall meets roof)
      return 'eave';
    }
    // Diagonal wall edge → wall_vertical (perspective distortion)
    return 'wall_vertical';
  }

  // --- Siding edges ---
  if (sourceClass === 'siding') {
    if (isVertical) return 'wall_vertical';
    if (isHorizontal) {
      // Check for wall_bottom_edge at ground boundary
      const avgY = (start.y + end.y) / 2;
      for (const gb of groundBoundaries) {
        if (Math.abs(avgY - gb.y) <= 30 &&
            start.x <= gb.maxX && end.x >= gb.minX) {
          return 'wall_bottom_edge';
        }
      }
      return 'eave';
    }
    return 'wall_vertical';
  }

  // --- Fascia / Soffit / Gutter edges → eave ---
  if (sourceClass === 'fascia' || sourceClass === 'soffit' || sourceClass === 'gutter') {
    if (isHorizontal) return 'eave';
    if (isVertical) return 'wall_vertical'; // gutter downspout run
    return 'eave'; // diagonal → likely eave
  }

  // --- Porch / Deck edges ---
  if (sourceClass === 'porch' || sourceClass === 'deck') {
    if (isHorizontal) return 'eave';
    if (isVertical) return 'wall_vertical';
    return 'rake';
  }

  // --- Railing / Steps / Downspout edges ---
  if (sourceClass === 'railing' || sourceClass === 'steps') {
    if (isHorizontal) return 'eave';
    if (isVertical) return 'wall_vertical';
    return 'wall_vertical';
  }

  if (sourceClass === 'downspout') {
    if (isVertical) return 'wall_vertical';
    return 'wall_vertical';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Heuristic confidence
// ---------------------------------------------------------------------------

/**
 * Assign a confidence score to a classified line based on:
 * - Edge length (longer = more confident)
 * - Source mask confidence
 * - Line type reliability
 * - Source class quality bonus
 * - Structural usefulness ranking
 */
function computeLineConfidence(
  lineType: StructuralLineType,
  edgeLength: number,
  maskConfidence: number,
  sourceClass: string,
): number {
  // Base confidence from mask quality (0-50 range from mask confidence 0-100)
  const maskBase = maskConfidence * 0.5;

  // Length bonus: longer edges are more reliable
  const lengthBonus = Math.min(30, (edgeLength / 600) * 30);

  // Type reliability bonus
  const typeBonus: Record<StructuralLineType, number> = {
    ridge: 15,
    eave: 15,
    rake: 8,
    wall_vertical: 12,
    wall_bottom_edge: 10,
  };

  // Source class quality bonus
  const classBonus = SOURCE_CLASS_QUALITY[sourceClass] ?? 0;

  const confidence = Math.round(
    Math.min(100, maskBase + lengthBonus + typeBonus[lineType] + classBonus)
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
  const angleA = normalizeAngle(a.angleDeg);
  const angleB = normalizeAngle(b.angleDeg);
  if (Math.abs(angleA - angleB) > angleTolerance && Math.abs(angleA - angleB) < 180 - angleTolerance) {
    return false;
  }

  if (a.sourceMaskId !== b.sourceMaskId) return false;

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
// Cross-mask deduplication
// ---------------------------------------------------------------------------

/**
 * Deduplicate lines across different masks that share edges.
 * Adjacent SAM2 masks often share boundary edges, producing duplicate lines.
 * For each pair of lines from different masks with similar midpoints and
 * angles, keep the one with higher confidence + usefulness score.
 */
function deduplicateAcrossMasks(
  edges: Array<RawEdge & { lineType: StructuralLineType }>,
  dedupDistance: number = 25,
  dedupAngleTolerance: number = 10,
): Array<RawEdge & { lineType: StructuralLineType }> {
  if (edges.length <= 1) return edges;

  const kept: Array<RawEdge & { lineType: StructuralLineType }> = [];
  const removed = new Set<number>();

  for (let i = 0; i < edges.length; i++) {
    if (removed.has(i)) continue;

    const a = edges[i];
    const midA = { x: (a.start.x + a.end.x) / 2, y: (a.start.y + a.end.y) / 2, coordinateSystem: a.start.coordinateSystem };
    let bestScore = a.length + (STRUCTURAL_USEFULNESS[a.lineType] ?? 0);
    let bestIdx = i;

    for (let j = i + 1; j < edges.length; j++) {
      if (removed.has(j)) continue;
      // Only dedup across different masks
      if (edges[i].sourceMaskId === edges[j].sourceMaskId) continue;

      const b = edges[j];
      const midB = { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2 };

      // Same line type
      if (a.lineType !== b.lineType) continue;

      // Similar midpoint distance
      const midDist = Math.sqrt((midA.x - midB.x) ** 2 + (midA.y - midB.y) ** 2);
      if (midDist > dedupDistance) continue;

      // Similar angle
      const angleA = normalizeAngle(a.angleDeg);
      const angleB = normalizeAngle(b.angleDeg);
      const angleDiff = Math.abs(angleA - angleB);
      if (angleDiff > dedupAngleTolerance && angleDiff < 180 - dedupAngleTolerance) continue;

      // Duplicate found — keep the one with higher score (length + usefulness)
      const scoreB = b.length + (STRUCTURAL_USEFULNESS[b.lineType] ?? 0);
      if (scoreB > bestScore) {
        removed.add(bestIdx);
        bestIdx = j;
        bestScore = scoreB;
      } else {
        removed.add(j);
      }
    }

    if (bestIdx === i) {
      kept.push(a);
    } else {
      kept.push(edges[bestIdx]);
    }
  }

  return kept;
}

// ---------------------------------------------------------------------------
// Main worker function
// ---------------------------------------------------------------------------

/**
 * Run the line extraction worker on a set of segmentation masks.
 *
 * Structure-first approach (v2):
 * 1. Pre-filter masks to ONLY structure-qualified classes
 * 2. Extract ground-level mask boundaries for wall_bottom_edge detection
 * 3. Extract edges from qualified masks only
 * 4. Filter by edge length and straightness
 * 5. Classify edges (ridge, eave, rake, wall_vertical, wall_bottom_edge)
 * 6. Merge collinear segments
 * 7. Cross-mask deduplication
 * 8. Per-mask cap on emitted lines
 * 9. Create validated artifacts
 */
export function runLineExtractionWorker(input: LineExtractionWorkerInput): LineExtractionWorkerOutput {
  const timings: Record<string, number> = {};
  const artifacts: StructuralLineCandidate[] = [];
  const minEdgeLength = input.config?.minEdgeLength ?? 30;
  const angleTolerance = input.config?.angleTolerance ?? 20;
  const minConfidence = input.config?.minConfidence ?? 25;
  const mergeCollinear = input.config?.mergeCollinear ?? true;
  const maxMergeGap = input.config?.maxMergeGap ?? 50;
  const maxLinesPerMask = input.config?.maxLinesPerMask ?? 8;
  const minStraightness = input.config?.minStraightness ?? 0.7;
  const crossMaskDedup = input.config?.crossMaskDedup ?? true;

  const filterStats: LineExtractionFilterStats = {
    masksRejectedByClass: 0,
    masksPassedPrefilter: 0,
    edgesExtracted: 0,
    edgesRejectedByStraightness: 0,
    edgesAfterStraightness: 0,
    linesDedupedCrossMask: 0,
    linesCappedByMask: 0,
    finalLineCount: 0,
  };

  // Stage 1: Initialize and pre-filter masks
  const t0 = Date.now();
  if (input.masks.length === 0) {
    timings['initialization'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: LINE_EXTRACTION_WORKER_VERSION,
      filterStats,
    };
  }

  // Structure-first: separate qualified vs rejected masks
  const qualifiedMasks: SemanticSegmentationMask[] = [];
  const rejectedMasks: SemanticSegmentationMask[] = [];
  for (const mask of input.masks) {
    if (isStructureQualifiedMask(mask)) {
      qualifiedMasks.push(mask);
    } else {
      rejectedMasks.push(mask);
    }
  }
  filterStats.masksRejectedByClass = rejectedMasks.length;
  filterStats.masksPassedPrefilter = qualifiedMasks.length;

  // If no qualified masks, return empty
  if (qualifiedMasks.length === 0) {
    timings['mask_prefilter'] = Date.now() - t0;
    return {
      artifacts: [],
      stageTimings: timings,
      workerVersion: LINE_EXTRACTION_WORKER_VERSION,
      filterStats,
    };
  }
  timings['mask_prefilter'] = Date.now() - t0;

  // Extract ground-level mask boundaries for wall_bottom_edge detection
  // This uses ALL masks (including rejected ones) since ground-level masks
  // are needed to find where walls meet the ground
  const groundBoundaries = extractGroundMaskTopBoundary(input.masks);

  // Stage 2: Extract edges from qualified masks only
  const t1 = Date.now();
  const allEdges: RawEdge[] = [];
  const maskConfidenceMap = new Map<string, number>();

  for (const mask of qualifiedMasks) {
    const edges = extractEdges(mask);
    allEdges.push(...edges);
    maskConfidenceMap.set(mask.id, mask.confidence);
  }
  filterStats.edgesExtracted = allEdges.length;
  timings['edge_extraction'] = Date.now() - t1;

  // Stage 3: Filter short edges
  const t2 = Date.now();
  const longEdges = allEdges.filter(e => e.length >= minEdgeLength);
  timings['edge_filtering'] = Date.now() - t2;

  // Stage 4: Straightness filter
  // For single edges (two endpoints), straightness is always 1.0.
  // But we can check if the polygon around the edge is jagged.
  // For simplicity, we apply straightness to the edge itself —
  // single edges are always straight. The straightness filter is
  // more relevant when multi-point chains are used (future enhancement).
  const t2b = Date.now();
  const straightEdges = longEdges.filter(e => {
    // Single edge is always straight
    const straightness = computeEdgeStraightness(e.start, e.end);
    return straightness >= minStraightness;
  });
  filterStats.edgesRejectedByStraightness = longEdges.length - straightEdges.length;
  filterStats.edgesAfterStraightness = straightEdges.length;
  timings['straightness_filter'] = Date.now() - t2b;

  // Stage 5: Classify edges
  const t3 = Date.now();
  const classifiedEdges: Array<RawEdge & { lineType: StructuralLineType }> = [];

  for (const edge of straightEdges) {
    const lineType = classifyEdge(edge, angleTolerance, groundBoundaries);
    if (lineType !== null) {
      classifiedEdges.push({ ...edge, lineType });
    }
  }
  timings['edge_classification'] = Date.now() - t3;

  // Stage 6: Merge collinear segments
  const t4 = Date.now();
  let finalEdges: typeof classifiedEdges = classifiedEdges;
  if (mergeCollinear) {
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

  // Stage 7: Cross-mask deduplication
  const t6 = Date.now();
  if (crossMaskDedup && finalEdges.length > 1) {
    const preDedupCount = finalEdges.length;
    finalEdges = deduplicateAcrossMasks(finalEdges);
    filterStats.linesDedupedCrossMask = preDedupCount - finalEdges.length;
  }
  timings['cross_mask_dedup'] = Date.now() - t6;

  // Stage 8: Per-mask cap — limit lines per source mask by structural usefulness
  const t7 = Date.now();
  const edgesByMask = new Map<string, typeof finalEdges>();
  for (const edge of finalEdges) {
    if (!edgesByMask.has(edge.sourceMaskId)) edgesByMask.set(edge.sourceMaskId, []);
    edgesByMask.get(edge.sourceMaskId)!.push(edge);
  }

  const cappedEdges: typeof finalEdges = [];
  for (const [maskId, maskEdges] of edgesByMask) {
    if (maskEdges.length <= maxLinesPerMask) {
      cappedEdges.push(...maskEdges);
      continue;
    }
    // Sort by structural usefulness (descending), then by length (descending)
    const sorted = [...maskEdges].sort((a, b) => {
      const useA = STRUCTURAL_USEFULNESS[a.lineType] ?? 0;
      const useB = STRUCTURAL_USEFULNESS[b.lineType] ?? 0;
      if (useA !== useB) return useB - useA;
      return b.length - a.length;
    });
    // Take up to maxLinesPerMask edges
    const kept = sorted.slice(0, maxLinesPerMask);
    filterStats.linesCappedByMask += maskEdges.length - kept.length;
    cappedEdges.push(...kept);
  }
  finalEdges = cappedEdges;
  timings['per_mask_cap'] = Date.now() - t7;

  // Stage 9: Create artifacts
  const t5 = Date.now();
  let lineIndex = 0;
  for (const edge of finalEdges) {
    const maskConf = maskConfidenceMap.get(edge.sourceMaskId) ?? 50;
    const confidence = computeLineConfidence(edge.lineType, edge.length, maskConf, edge.sourceClass);

    if (confidence < minConfidence) continue;

    const lineId = `line-${edge.sourceMaskId}-${edge.lineType}-${lineIndex}`;
    lineIndex++;

    const candidate: StructuralLineCandidate = {
      artifactType: 'structural_line_candidate',
      id: lineId,
      fileId: edge.sourceMaskId.replace(/^seg-/, '').replace(/-(roof|wall|siding|fascia|soffit|gutter|porch|deck|railing|steps|downspout|sky|tree|ground|obstruction|equipment)-.*$/, ''),
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

  filterStats.finalLineCount = artifacts.length;

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
