/**
 * Geometry refinement pipeline for open_source_photo_vision_candidates.
 *
 * This module produces cleaner derived preview candidates from raw persisted
 * candidates without deleting or mutating the originals. The refined layer is
 * intended for human review before any CAD reference promotion.
 *
 * Pipeline stages:
 *   1. Noise filtering   — remove no-geometry, tiny, giant, out-of-bounds
 *   2. IoU deduplication  — merge overlapping boxes via intersection-over-union
 *   3. Classification     — label as roof/wall/equipment/obstruction/ground_noise/text/unknown
 *   4. Scoring            — weighted composite from area, aspect ratio, position, confidence, type
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 * Refined candidates are operator review aids only. They must not be used as
 * canonical evidence, CAD geometry, permit input, BOM input, or engineering
 * workflow state. The refinement pipeline never mutates raw candidates.
 */

import type { NormalizedRegion, NormalizedLine } from './overlayCoordinateConversion';
import { extractDrawableRegion, extractDrawableLine } from './overlayCoordinateConversion';
import {
  suppressCandidates,
  DEFAULT_SUPPRESSION_CONFIG,
  type SuppressionConfig,
  type SuppressionResult,
  type SuppressibleCandidate,
  type CandidateDisposition,
} from './candidateSuppression';

/* ── Types ────────────────────────────────────────────────────────────── */

/** Configurable thresholds for the refinement pipeline. */
export interface RefinementConfig {
  /** Minimum normalized area (0–1) for a box to survive filtering. Default 0.0005 (≈0.05%). */
  minArea: number;
  /** Maximum normalized area (0–1) for a box to survive filtering, UNLESS classified as probable plane. Default 0.85. */
  maxArea: number;
  /** Fraction of a box that must lie within the 0–1000 image bounds. Default 0.3 (30%). */
  minInBoundsFraction: number;
  /** IoU threshold above which two boxes are considered duplicates. Default 0.35. */
  iouThreshold: number;
  /** Whether to merge overlapping boxes (true) or just keep the higher-scored one (false). Default true. */
  mergeOverlaps: boolean;
  /** Suppression pipeline configuration. If provided, runs Stage 5 after scoring. */
  suppression?: Partial<SuppressionConfig>;
}

export const DEFAULT_REFINEMENT_CONFIG: RefinementConfig = {
  minArea: 0.0005,
  maxArea: 0.85,
  minInBoundsFraction: 0.3,
  iouThreshold: 0.35,
  mergeOverlaps: true,
};

/** Refined geometry classification. */
export type RefinedGeometryClass =
  | 'probable_roof_plane'
  | 'probable_wall_plane'
  | 'probable_equipment'
  | 'probable_obstruction'
  | 'probable_ground_noise'
  | 'probable_text_label'
  | 'unknown';

/** A raw candidate fed into the refinement pipeline. */
export interface RawRefinementInput {
  id: string;
  fileId: string;
  candidateType: string;
  candidateCategory: string;
  payload: Record<string, unknown>;
  confidence: number;
}

/** A refined candidate produced by the pipeline. */
export interface RefinedCandidate {
  /** Unique ID for this refined candidate (derived from source IDs). */
  id: string;
  /** Source raw candidate IDs that contributed to this refined candidate. */
  sourceIds: string[];
  /** File this candidate belongs to. */
  fileId: string;
  /** The merged/selected region geometry. */
  region: NormalizedRegion;
  /** Dominant candidate type from source(s). */
  candidateType: string;
  /** Dominant candidate category from source(s). */
  candidateCategory: string;
  /** Refined geometry classification. */
  geometryClass: RefinedGeometryClass;
  /** Composite geometry score (0–1, higher = more likely meaningful). */
  geometryScore: number;
  /** Original confidence from the highest-scored source candidate. */
  confidence: number;
  /** Reason this candidate survived refinement (for debugging). */
  refinementNotes: string[];
  /** Suppression disposition: 'trusted' (shown by default) or 'suppressed' (hidden unless debug). */
  disposition: CandidateDisposition;
  /** Human-readable reason if suppressed. Empty string if trusted. */
  suppressionReason: string;
  /** Authority flags — always review-only. */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
  };
}

/** The full output of the refinement pipeline. */
export interface RefinedGeometryBundle {
  schemaVersion: 'refined_geometry_preview_v1';
  /** Number of raw candidates fed into the pipeline. */
  rawCandidateCount: number;
  /** Number of refined candidates produced. */
  refinedCandidateCount: number;
  /** The refined candidates, grouped by fileId. */
  candidates: RefinedCandidate[];
  /** The config used for this refinement run. */
  config: RefinementConfig;
  /** Suppression result (if Stage 5 ran). Null if suppression was not configured. */
  suppressionResult: SuppressionResult | null;
  /** Authority flags — always review-only. */
  authority: {
    reviewOnly: true;
    nonAuthoritative: true;
    canonicalMutationAllowed: false;
    cadMutationAllowed: false;
    permitGenerationAllowed: false;
    bomMutationAllowed: false;
    engineeringWorkflowMutationAllowed: false;
  };
  limitations: string[];
}

/* ── Pipeline entry point ─────────────────────────────────────────────── */

/**
 * Run the full geometry refinement pipeline on raw candidates.
 *
 * IMPORTANT: This function does NOT mutate the input array. It returns a new
 * bundle with derived candidates. Raw candidates remain untouched.
 */
export function refineGeometry(
  rawCandidates: RawRefinementInput[],
  config: Partial<RefinementConfig> = {},
): RefinedGeometryBundle {
  const cfg: RefinementConfig = { ...DEFAULT_REFINEMENT_CONFIG, ...config };

  // Stage 1: Noise filtering
  const filtered = filterNoise(rawCandidates, cfg);

  // Stage 2: IoU deduplication/merging
  const deduped = deduplicateByIoU(filtered, cfg);

  // Stage 3 + 4: Classification and scoring (done together since they inform each other)
  const refined = deduped.map((entry) => {
    const geometryClass = classifyGeometry(entry);
    const geometryScore = scoreGeometry(entry, geometryClass);
    return {
      id: `refined-${entry.sourceIds.join('-').slice(0, 60)}`,
      sourceIds: entry.sourceIds,
      fileId: entry.fileId,
      region: entry.region,
      candidateType: entry.dominantType,
      candidateCategory: entry.dominantCategory,
      geometryClass,
      geometryScore,
      confidence: entry.maxConfidence,
      refinementNotes: entry.notes,
      disposition: 'trusted' as CandidateDisposition,
      suppressionReason: '',
      authority: {
        reviewOnly: true as const,
        nonAuthoritative: true as const,
        cadMutationAllowed: false as const,
        permitGenerationAllowed: false as const,
        bomMutationAllowed: false as const,
      },
    };
  });

  // Stage 5: Candidate suppression (if configured)
  let suppressionResult: SuppressionResult | null = null;
  let finalCandidates = refined;

  if (cfg.suppression !== undefined) {
    const suppressible: SuppressibleCandidate[] = refined.map((c) => ({
      id: c.id,
      fileId: c.fileId,
      geometryClass: c.geometryClass,
      geometryScore: c.geometryScore,
      confidence: c.confidence,
      region: c.region,
    }));

    suppressionResult = suppressCandidates(suppressible, cfg.suppression);

    // Annotate each candidate with its disposition from suppression
    const dispositionMap = new Map<string, { disposition: CandidateDisposition; reason: string }>();
    for (const entry of suppressionResult.entries) {
      dispositionMap.set(entry.candidate.id, { disposition: entry.disposition, reason: entry.suppressionReason });
    }

    finalCandidates = refined.map((c) => {
      const d = dispositionMap.get(c.id);
      if (d) {
        return { ...c, disposition: d.disposition, suppressionReason: d.reason };
      }
      return c;
    });
  }

  return {
    schemaVersion: 'refined_geometry_preview_v1',
    rawCandidateCount: rawCandidates.length,
    refinedCandidateCount: finalCandidates.length,
    candidates: finalCandidates,
    config: cfg,
    suppressionResult,
    authority: {
      reviewOnly: true,
      nonAuthoritative: true,
      canonicalMutationAllowed: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
    },
    limitations: [
      'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
      'Refined geometry candidates are derived preview aids only. They cannot mutate canonical evidence, CAD, permits, BOM, or engineering workflows.',
      'Raw source candidates are preserved unchanged.',
    ],
  };
}

/* ── Stage 1: Noise filtering ─────────────────────────────────────────── */

interface IntermediateCandidate {
  sourceIds: string[];
  fileId: string;
  region: NormalizedRegion;
  dominantType: string;
  dominantCategory: string;
  maxConfidence: number;
  payload: Record<string, unknown>;
  candidateType: string;
  candidateCategory: string;
  notes: string[];
}

function filterNoise(
  raw: RawRefinementInput[],
  cfg: RefinementConfig,
): IntermediateCandidate[] {
  const result: IntermediateCandidate[] = [];

  for (const candidate of raw) {
    const region = extractDrawableRegion(candidate.payload);
    if (!region) {
      // No drawable geometry — skip silently (not an error, just not overlay-relevant)
      continue;
    }

    const notes: string[] = [];

    // Check tiny area
    const area = normalizedArea(region);
    if (area < cfg.minArea) {
      continue; // Too small to be meaningful
    }
    notes.push(`area=${(area * 100).toFixed(2)}%`);

    // Check giant area (unless it's classified as a probable plane)
    const isProbablyPlane = candidateIsPlaneLike(candidate);
    if (area > cfg.maxArea && !isProbablyPlane) {
      continue; // Too large and not a plane candidate
    }
    if (area > cfg.maxArea && isProbablyPlane) {
      notes.push('large-area-plane-exception');
    }

    // Check out-of-bounds
    const inBoundsFraction = computeInBoundsFraction(region);
    if (inBoundsFraction < cfg.minInBoundsFraction) {
      continue; // Mostly outside visible image
    }
    notes.push(`inBounds=${(inBoundsFraction * 100).toFixed(0)}%`);

    result.push({
      sourceIds: [candidate.id],
      fileId: candidate.fileId,
      region,
      dominantType: candidate.candidateType,
      dominantCategory: candidate.candidateCategory,
      maxConfidence: candidate.confidence,
      payload: candidate.payload,
      candidateType: candidate.candidateType,
      candidateCategory: candidate.candidateCategory,
      notes,
    });
  }

  return result;
}

/* ── Stage 2: IoU deduplication/merging ────────────────────────────────── */

function deduplicateByIoU(
  candidates: IntermediateCandidate[],
  cfg: RefinementConfig,
): IntermediateCandidate[] {
  if (candidates.length === 0) return [];

  // Group by fileId first — only deduplicate within the same image
  const byFile = new Map<string, IntermediateCandidate[]>();
  for (const c of candidates) {
    if (!byFile.has(c.fileId)) byFile.set(c.fileId, []);
    byFile.get(c.fileId)!.push(c);
  }

  const result: IntermediateCandidate[] = [];
  for (const [, fileCandidates] of byFile) {
    result.push(...deduplicateGroup(fileCandidates, cfg));
  }
  return result;
}

function deduplicateGroup(
  candidates: IntermediateCandidate[],
  cfg: RefinementConfig,
): IntermediateCandidate[] {
  // Iteratively merge overlapping groups until no more merges occur.
  // This handles transitive chains: if A overlaps B and B overlaps C,
  // the merged (A+B) may overlap C even if A and C didn't overlap directly.
  let current = [...candidates];

  let changed = true;
  while (changed) {
    changed = false;
    // Sort by confidence descending (higher confidence first → kept when merging)
    const sorted = [...current].sort((a, b) => b.maxConfidence - a.maxConfidence);
    const consumed = new Set<number>();
    const result: IntermediateCandidate[] = [];

    for (let i = 0; i < sorted.length; i++) {
      if (consumed.has(i)) continue;

      const cur = sorted[i];
      const overlapping: number[] = [];

      for (let j = i + 1; j < sorted.length; j++) {
        if (consumed.has(j)) continue;
        if (cur.fileId !== sorted[j].fileId) continue;

        const iou = computeIoU(cur.region, sorted[j].region);
        if (iou >= cfg.iouThreshold) {
          overlapping.push(j);
        }
      }

      if (overlapping.length === 0) {
        // No overlaps — keep as-is
        result.push(cur);
      } else if (cfg.mergeOverlaps) {
        // Merge all overlapping boxes into one
        const toMerge = [cur, ...overlapping.map((idx) => sorted[idx])];
        const merged = mergeCandidates(toMerge);
        result.push(merged);
        for (const idx of overlapping) consumed.add(idx);
        changed = true; // Merged box may now overlap with others
      } else {
        // Keep highest-confidence, discard the rest
        result.push(cur);
        for (const idx of overlapping) consumed.add(idx);
      }
    }

    current = result;
  }

  return current;
}

/**
 * Merge multiple overlapping candidates into one.
 * Uses the union bounding box and takes metadata from the highest-confidence source.
 */
function mergeCandidates(candidates: IntermediateCandidate[]): IntermediateCandidate {
  if (candidates.length === 1) return candidates[0];

  // Find the highest-confidence candidate for metadata
  const best = candidates.reduce((a, b) => (a.maxConfidence >= b.maxConfidence ? a : b));

  // Compute the union bounding box
  const unionRegion = unionBoundingBox(candidates.map((c) => c.region));

  const sourceIds = candidates.flatMap((c) => c.sourceIds);
  const notes = [
    ...candidates.flatMap((c) => c.notes),
    `merged-${candidates.length}-candidates`,
  ];

  return {
    sourceIds,
    fileId: best.fileId,
    region: unionRegion,
    dominantType: best.dominantType,
    dominantCategory: best.dominantCategory,
    maxConfidence: best.maxConfidence,
    payload: best.payload,
    candidateType: best.candidateType,
    candidateCategory: best.candidateCategory,
    notes,
  };
}

/* ── Stage 3: Geometry classification ─────────────────────────────────── */

function classifyGeometry(entry: IntermediateCandidate): RefinedGeometryClass {
  const { candidateType, candidateCategory, payload } = entry;
  const region = entry.region;

  // OCR text candidates → text label
  if (candidateType === 'ocr_text') {
    return 'probable_text_label';
  }

  // Object detection from YOLO — check what was detected
  if (candidateType === 'object_detection') {
    const label = String(payload.label ?? payload.objectClass ?? payload.class ?? '').toLowerCase();
    if (label.includes('solar') || label.includes('panel') || label.includes('module') || label.includes('inverter')) {
      return 'probable_equipment';
    }
    if (label.includes('roof')) return 'probable_roof_plane';
    if (label.includes('wall') || label.includes('facade')) return 'probable_wall_plane';
    if (label.includes('obstruction') || label.includes('vent') || label.includes('pipe') || label.includes('chimney')) {
      return 'probable_obstruction';
    }
    // YOLO detections without a specific label hint get classified by geometry
  }

  // Equipment anchor → equipment
  if (candidateType === 'equipment_anchor_candidate') {
    return 'probable_equipment';
  }

  // Wall anchor → wall
  if (candidateType === 'wall_anchor_candidate') {
    return 'probable_wall_plane';
  }

  // Roof edge → roof plane
  if (candidateType === 'roof_edge_candidate') {
    return 'probable_roof_plane';
  }

  // Obstruction → obstruction
  if (candidateType === 'obstruction_candidate') {
    return 'probable_obstruction';
  }

  // Category-based classification (runs before type-based geometry heuristics
  // so that categories like roof_context / structure_context take precedence)
  if (candidateCategory === 'electrical_context') {
    return 'probable_equipment';
  }

  if (candidateCategory === 'structure_context') {
    return 'probable_wall_plane';
  }

  if (candidateCategory === 'roof_context') {
    return 'probable_roof_plane';
  }

  // Dominant line candidates are generally structural
  if (candidateType === 'dominant_line_candidate') {
    return 'probable_roof_plane';
  }

  // Rectangular region candidate — classify by geometry heuristics
  if (candidateType === 'rectangular_region_candidate') {
    return classifyByGeometry(region, payload);
  }

  // Dense edge regions — could be anything, classify by geometry
  const source = String(payload.source ?? '').toLowerCase();
  if (source.includes('dense_edge')) {
    return classifyByGeometry(region, payload);
  }

  return 'unknown';
}

/**
 * Classify a region by its geometric properties when type/category is ambiguous.
 * Uses position, aspect ratio, and size heuristics from solar survey domain knowledge.
 */
function classifyByGeometry(
  region: NormalizedRegion,
  payload: Record<string, unknown>,
): RefinedGeometryClass {
  const area = normalizedArea(region);
  const aspect = aspectRatio(region);
  const yPos = region.y / 1000; // 0 = top, 1 = bottom
  const filenameHint = String(payload.filenameLabelHintUsedForCategoryOnly ?? '').toLowerCase();

  // Filename hint overrides
  if (filenameHint.includes('roof')) return 'probable_roof_plane';
  if (filenameHint.includes('wall') || filenameHint.includes('facade')) return 'probable_wall_plane';
  if (filenameHint.includes('equipment') || filenameHint.includes('panel') || filenameHint.includes('inverter')) return 'probable_equipment';

  const isWide = region.width >= region.height;
  const isTall = region.height > region.width;
  const widthToHeightRatio = region.height > 0 ? region.width / region.height : 999;

  // Large area in upper half → likely roof plane
  if (area > 0.15 && yPos < 0.5) {
    return 'probable_roof_plane';
  }

  // Wide short box in upper portion → likely roof
  if (isWide && widthToHeightRatio > 2 && yPos < 0.5) {
    return 'probable_roof_plane';
  }

  // Tall narrow box → likely wall (height >> width)
  if (isTall && widthToHeightRatio < 0.5) {
    return 'probable_wall_plane';
  }

  // Small box in upper portion of image with moderate aspect ratio → likely equipment
  // (check before obstruction — equipment in upper half is more common than random obstructions)
  // This applies to boxes that are small but not tiny (area >= 0.005, about 70x70 or larger)
  if (area >= 0.005 && area < 0.05 && yPos < 0.6 && aspect > 0.5 && aspect < 4) {
    return 'probable_equipment';
  }

  // Very small area at bottom of image → ground noise
  if (area < 0.02 && yPos > 0.7) {
    return 'probable_ground_noise';
  }

  // Small box anywhere → likely obstruction or noise
  if (area < 0.01) {
    return 'probable_obstruction';
  }

  return 'unknown';
}

/* ── Stage 4: Geometry scoring ─────────────────────────────────────────── */

/**
 * Compute a composite geometry score (0–1) for a refined candidate.
 * Higher scores indicate more likely meaningful geometry.
 *
 * Factors (weighted):
 *   - Normalized area     (0.15) — sweet spot around 5–30% of image
 *   - Aspect ratio        (0.10) — moderate ratios preferred (not extreme)
 *   - Edge density/lines  (0.15) — presence of nearby line candidates
 *   - Type/category       (0.20) — known useful types score higher
 *   - Image position      (0.10) — upper-center preferred for solar
 *   - Confidence          (0.30) — original detector confidence
 */
function scoreGeometry(
  entry: IntermediateCandidate,
  geometryClass: RefinedGeometryClass,
): number {
  const region = entry.region;
  const area = normalizedArea(region);
  const aspect = aspectRatio(region);
  const yPos = region.y / 1000;

  // Area score: bell curve around 5–30%
  const areaScore = areaBellCurve(area, 0.05, 0.30);

  // Aspect ratio score: penalize extremes
  const aspectScore = aspect >= 0.3 && aspect <= 5 ? 1.0 : Math.max(0, 1 - Math.abs(Math.log10(aspect)) * 0.5);

  // Edge density score: check for line candidates in the payload
  const line = extractDrawableLine(entry.payload);
  const edgeScore = line ? 0.8 : (entry.payload.edgePixelCount != null ? 0.5 : 0.3);

  // Type score: known useful types score higher
  const typeScore = typeScoreForClass(geometryClass);

  // Position score: upper-center is preferred for solar surveys
  const positionScore = yPos < 0.3 ? 1.0 : yPos < 0.6 ? 0.7 : 0.4;

  // Confidence score: normalized 0–1
  const confidenceScore = Math.max(0, Math.min(1, entry.maxConfidence / 100));

  // Weighted composite
  const composite =
    areaScore * 0.15 +
    aspectScore * 0.10 +
    edgeScore * 0.15 +
    typeScore * 0.20 +
    positionScore * 0.10 +
    confidenceScore * 0.30;

  return Math.round(composite * 1000) / 1000; // 3 decimal places
}

function typeScoreForClass(geometryClass: RefinedGeometryClass): number {
  switch (geometryClass) {
    case 'probable_roof_plane': return 1.0;
    case 'probable_equipment': return 0.9;
    case 'probable_wall_plane': return 0.8;
    case 'probable_obstruction': return 0.6;
    case 'probable_text_label': return 0.5;
    case 'unknown': return 0.3;
    case 'probable_ground_noise': return 0.1;
  }
}

/* ── Geometry math utilities ───────────────────────────────────────────── */

/**
 * Compute normalized area of a region (0–1 range).
 * In normalized_image_0_1000, area = (width/1000) * (height/1000).
 */
export function normalizedArea(region: NormalizedRegion): number {
  return (region.width / 1000) * (region.height / 1000);
}

/**
 * Compute aspect ratio (width/height). Always ≥1 by convention.
 */
export function aspectRatio(region: NormalizedRegion): number {
  const w = region.width;
  const h = region.height;
  if (h === 0) return 999;
  return w >= h ? w / h : h / w;
}

/**
 * Compute Intersection-over-Union (IoU) of two normalized regions.
 * Returns 0 for non-overlapping regions.
 */
export function computeIoU(a: NormalizedRegion, b: NormalizedRegion): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 <= x1 || y2 <= y1) return 0; // No overlap

  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  if (union <= 0) return 0;
  return intersection / union;
}

/**
 * Compute what fraction of a region lies within the 0–1000 image bounds.
 */
export function computeInBoundsFraction(region: NormalizedRegion): number {
  const totalArea = region.width * region.height;
  if (totalArea <= 0) return 0;

  const clampedX1 = Math.max(0, region.x);
  const clampedY1 = Math.max(0, region.y);
  const clampedX2 = Math.min(1000, region.x + region.width);
  const clampedY2 = Math.min(1000, region.y + region.height);

  if (clampedX2 <= clampedX1 || clampedY2 <= clampedY1) return 0;

  const visibleArea = (clampedX2 - clampedX1) * (clampedY2 - clampedY1);
  return visibleArea / totalArea;
}

/**
 * Compute the union bounding box of multiple regions.
 */
export function unionBoundingBox(regions: NormalizedRegion[]): NormalizedRegion {
  if (regions.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0, coordinateSystem: 'normalized_image_0_1000' };
  }
  if (regions.length === 1) return { ...regions[0] };

  const x1 = Math.min(...regions.map((r) => r.x));
  const y1 = Math.min(...regions.map((r) => r.y));
  const x2 = Math.max(...regions.map((r) => r.x + r.width));
  const y2 = Math.max(...regions.map((r) => r.y + r.height));

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    coordinateSystem: 'normalized_image_0_1000',
  };
}

/**
 * Bell curve scoring for area. Returns 1.0 when area is in the sweet spot,
 * decays toward 0 at extremes.
 */
function areaBellCurve(area: number, low: number, high: number): number {
  if (area >= low && area <= high) return 1.0;
  if (area < low) return Math.max(0, area / low);
  // area > high: decay but don't go to 0 immediately (large planes are valid)
  return Math.max(0, 1 - (area - high) / 0.5);
}

/**
 * Check if a candidate looks like a plane (roof/wall) based on type and category.
 * Used to exempt large plane-like candidates from the giant-box filter.
 */
function candidateIsPlaneLike(candidate: RawRefinementInput): boolean {
  const t = candidate.candidateType;
  const c = candidate.candidateCategory;
  return (
    t === 'roof_edge_candidate' ||
    t === 'wall_anchor_candidate' ||
    t === 'rectangular_region_candidate' ||
    c === 'roof_context' ||
    c === 'structure_context'
  );
}
