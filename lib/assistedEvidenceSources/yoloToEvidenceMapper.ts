/**
 * Candidate-to-Evidence Category Mapper
 *
 * Maps computer vision candidate data to SolarPro survey evidence categories.
 * Supports multiple candidate types beyond just YOLO object detection:
 *
 * 1. **object_detection** — YOLO class names mapped to categories
 * 2. **roof_edge_candidate** — Roof edge count heuristic → roof_plane
 * 3. **candidate_diversity** — Candidate type diversity heuristic → overview
 *
 * CRITICAL ARCHITECTURE NOTE:
 * Each unique photo has ~7 duplicate file_id rows in site_survey_files (one per
 * file_url variant). The vision worker processes each file_id separately, producing
 * candidates per file_id. But for heuristic classification, we must AGGREGATE
 * candidates by filename (unique photo) rather than by file_id, because:
 * - Roof edge counts are 50-80 per filename but only 5-16 per file_id
 * - A threshold of 30 per file_id catches ZERO roof photos
 * - A threshold of 20 per filename catches ALL 15 roof photos cleanly
 *
 * YOLO payload field formats:
 * - rawClassName: Used by external Render worker (yolov8n.pt)
 * - className / class_name / label / category: Generic formats
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: YOLO Class → Evidence Category Mapping
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Mapping from YOLO class names to evidence categories.
 *
 * Confidence thresholds:
 * - 0.85+: Very high confidence, safe to auto-label
 * - 0.70-0.85: High confidence, acceptable for auto-label
 * - 0.60-0.70: Medium confidence, may need review
 * - <0.60: Too low, do not auto-label
 */
export const YOLO_CLASS_TO_EVIDENCE_CATEGORY: Record<string, {
  category: SurveyEvidenceCategory;
  minConfidence: number;
  description: string;
}> = {
  // Electrical equipment — direct YOLO class names
  'main_service_panel': {
    category: 'main_service_panel',
    minConfidence: 0.70,
    description: 'Main service panel or main breaker panel',
  },
  'utility_meter': {
    category: 'meter',
    minConfidence: 0.70,
    description: 'Utility meter or meter socket',
  },
  'subpanel': {
    category: 'subpanel',
    minConfidence: 0.65,
    description: 'Subpanel or downstream distribution panel',
  },
  'disconnect': {
    category: 'disconnect',
    minConfidence: 0.65,
    description: 'AC/DC disconnect or service disconnect',
  },

  // Roof context
  'roof_edge_candidate': {
    category: 'roof_plane',
    minConfidence: 0.60,
    description: 'Roof edge, eave, or rake detection',
  },
  'solar_array_candidate': {
    category: 'roof_plane',
    minConfidence: 0.75,
    description: 'Existing solar array on roof',
  },
  'battery_wall_candidate': {
    category: 'battery_location',
    minConfidence: 0.70,
    description: 'Battery wall or energy storage location',
  },

  // Obstructions
  'chimney': {
    category: 'obstructions',
    minConfidence: 0.75,
    description: 'Chimney or vent stack',
  },
  'skylight': {
    category: 'obstructions',
    minConfidence: 0.75,
    description: 'Skylight or roof window',
  },
  'roof_vent': {
    category: 'obstructions',
    minConfidence: 0.70,
    description: 'Roof vent or exhaust fan',
  },
  'obstruction': {
    category: 'obstructions',
    minConfidence: 0.60,
    description: 'General roof obstruction',
  },

  // Site overview
  'overview': {
    category: 'overview',
    minConfidence: 0.60,
    description: 'Site overview or exterior photo',
  },

  // ── YOLOv8 (yolov8n.pt) COCO class aliases ──────────────────────────────
  // YOLOv8 trained on COCO doesn't know "utility_meter" — it detects "clock"
  // (class 74) when it sees round utility meters. Map these semantically.
  'clock': {
    category: 'meter',
    minConfidence: 0.55,
    description: 'YOLOv8 COCO class 74 "clock" — semantically a round utility meter face',
  },
  'refrigerator': {
    category: 'main_service_panel',
    minConfidence: 0.55,
    description: 'YOLOv8 COCO class — large rectangular equipment, possibly a panel',
  },
  'oven': {
    category: 'main_service_panel',
    minConfidence: 0.50,
    description: 'YOLOv8 COCO class — wall-mounted rectangular equipment, possibly a panel',
  },
  'microwave': {
    category: 'main_service_panel',
    minConfidence: 0.50,
    description: 'YOLOv8 COCO class — wall-mounted rectangular equipment',
  },
  'tv': {
    category: 'main_service_panel',
    minConfidence: 0.50,
    description: 'YOLOv8 COCO class — flat rectangular wall-mounted object',
  },
  'laptop': {
    category: 'overview',
    minConfidence: 0.50,
    description: 'YOLOv8 COCO class — could be a display/monitor showing site overview',
  },
  'cell_phone': {
    category: 'meter',
    minConfidence: 0.45,
    description: 'YOLOv8 COCO class — small device, possibly a smart meter display',
  },
  'remote': {
    category: 'meter',
    minConfidence: 0.45,
    description: 'YOLOv8 COCO class — small handheld device',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Roof Edge Candidate Heuristic → roof_plane
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for roof edge count heuristic.
 *
 * When a photo has many roof_edge_candidate entries, it is very likely a
 * roof photo. The count threshold filters out photos with only a few
 * incidental horizontal lines (which could be sidewalks, tables, etc.).
 *
 * IMPORTANT: This threshold applies to AGGREGATED counts per unique filename,
 * NOT per individual file_id row. Each unique photo has ~7 duplicate file_id
 * rows in site_survey_files, and the roof_edge counts must be summed across
 * all rows for the same filename before comparing against this threshold.
 *
 * Based on analysis of survey 302cf42c data (aggregated by filename):
 * - Roof photos: 27-80 roof_edge candidates per filename
 * - Non-roof photos: 0-10 roof_edge candidates per filename
 * - Threshold of 20 cleanly separates the two groups
 *
 * Per-file_id counts are much lower (5-16 for roof photos) because each
 * duplicate row gets ~1/7th of the total candidates.
 */
export const ROOF_EDGE_MIN_COUNT_THRESHOLD = Number(
  process.env.ROOF_EDGE_MIN_COUNT_THRESHOLD || 20,
);

/**
 * Aggregate candidate counts — keyed by FILENAME (not file_id).
 *
 * Each unique photo (filename) has ~7 duplicate file_id rows. We aggregate
 * across all rows for the same filename to get meaningful candidate counts.
 * The fileIds set tracks which individual file_id rows belong to each filename.
 */
export interface FilenameCandidateSummary {
  filename: string;
  fileIds: Set<string>;           // All file_id rows for this filename
  candidateTypeCounts: Record<string, number>;  // Aggregated counts
  totalCandidates: number;
  distinctTypes: number;
  dominantType: string | null;
  dominantRatio: number;
}

/**
 * Build candidate count summaries AGGREGATED BY FILENAME.
 *
 * This is the critical fix: instead of grouping by file_id (where each photo
 * has ~7 duplicate rows with ~1/7th of the candidates each), we group by
 * filename to get the full picture of each unique photo.
 *
 * The caller must provide a mapping from fileId → filename so we can
 * aggregate correctly. This mapping comes from the site_survey_files table.
 */
export function buildCandidateCountSummaries(
  candidates: Array<{ fileId: string; candidateType: string }>,
  fileIdToFilename: Map<string, string>,
): Map<string, FilenameCandidateSummary> {
  const summaries = new Map<string, FilenameCandidateSummary>();

  for (const candidate of candidates) {
    const { fileId, candidateType } = candidate;

    // Look up filename for this file_id
    const filename = fileIdToFilename.get(fileId);
    if (!filename) {
      // Skip candidates whose file_id we can't map to a filename
      // (orphaned candidates from a different survey)
      continue;
    }

    let summary = summaries.get(filename);
    if (!summary) {
      summary = {
        filename,
        fileIds: new Set<string>(),
        candidateTypeCounts: {},
        totalCandidates: 0,
        distinctTypes: 0,
        dominantType: null,
        dominantRatio: 0,
      };
      summaries.set(filename, summary);
    }

    // Track which file_ids belong to this filename
    summary.fileIds.add(fileId);

    summary.candidateTypeCounts[candidateType] = (summary.candidateTypeCounts[candidateType] ?? 0) + 1;
    summary.totalCandidates++;
  }

  // Compute derived stats
  for (const summary of summaries.values()) {
    summary.distinctTypes = Object.keys(summary.candidateTypeCounts).length;

    let maxCount = 0;
    let maxType: string | null = null;
    for (const [type, count] of Object.entries(summary.candidateTypeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        maxType = type;
      }
    }
    summary.dominantType = maxType;
    summary.dominantRatio = summary.totalCandidates > 0
      ? maxCount / summary.totalCandidates
      : 0;
  }

  return summaries;
}

/**
 * Classify a filename as roof_plane based on aggregated roof_edge_candidate count.
 *
 * Rule: If a filename has >= ROOF_EDGE_MIN_COUNT_THRESHOLD roof_edge_candidate
 * entries (aggregated across all file_id rows), it is very likely a roof photo
 * → label as "roof_plane".
 *
 * This works because roof photos contain many detectable horizontal lines
 * (eaves, ridges, rake edges) that the OpenCV Hough line detector picks up.
 * Non-roof photos (meters, panels, site overview) have far fewer.
 */
export function classifyByRoofEdgeCount(
  summary: FilenameCandidateSummary,
): SurveyEvidenceCategory | null {
  const roofEdgeCount = summary.candidateTypeCounts['roof_edge_candidate'] ?? 0;

  if (roofEdgeCount >= ROOF_EDGE_MIN_COUNT_THRESHOLD) {
    return 'roof_plane';
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: Candidate Diversity Heuristic → overview
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for candidate diversity heuristic.
 *
 * Overview/site photos tend to show many different visual features:
 * - Some roof edges (but not dominant)
 * - Some rectangular regions (buildings, structures)
 * - Some dominant lines (horizons, property lines)
 * - Some obstructions (trees, etc.)
 *
 * This heuristic identifies photos where no single candidate type dominates,
 * which is characteristic of wide-angle overview shots.
 *
 * IMPORTANT: These thresholds apply to AGGREGATED stats per filename,
 * not per individual file_id row.
 *
 * Based on analysis of survey 302cf42c data (aggregated by filename):
 * - Overview photos: 5 distinct types, dominant ratio 0.29-0.41, roof_edge < 20
 * - Roof photos: 4-5 types but dominant = roof_edge at 0.29-0.47 (excluded by roof check)
 * - Meter/panel photos: 3 types, dominant ratio 0.44+ (excluded by min_types=5)
 *
 * Optimal settings: min_types=5, max_ratio=0.45 → classifies 3 unique filenames as overview
 */
export const OVERVIEW_MIN_CANDIDATE_TYPES = Number(
  process.env.OVERVIEW_MIN_CANDIDATE_TYPES || 5,
);
export const OVERVIEW_MAX_DOMINANT_RATIO = Number(
  process.env.OVERVIEW_MAX_DOMINANT_RATIO || 0.45,
);

/**
 * Classify a filename as overview based on candidate type diversity.
 *
 * Rule: If a filename has >= OVERVIEW_MIN_CANDIDATE_TYPES distinct candidate types
 * AND no single type accounts for more than OVERVIEW_MAX_DOMINANT_RATIO of
 * all candidates, it is likely a site overview photo → label as "overview".
 *
 * Exclusion: Filenames already classified as roof_plane (high roof edge count)
 * are excluded from overview classification.
 */
export function classifyByCandidateDiversity(
  summary: FilenameCandidateSummary,
): SurveyEvidenceCategory | null {
  // Don't classify as overview if this filename has many roof edges
  // (those are roof photos, not overview photos)
  const roofEdgeCount = summary.candidateTypeCounts['roof_edge_candidate'] ?? 0;
  if (roofEdgeCount >= ROOF_EDGE_MIN_COUNT_THRESHOLD) {
    return null;
  }

  // Must have enough distinct candidate types
  if (summary.distinctTypes < OVERVIEW_MIN_CANDIDATE_TYPES) {
    return null;
  }

  // No single type should dominate (overview photos are diverse)
  if (summary.dominantRatio > OVERVIEW_MAX_DOMINANT_RATIO) {
    return null;
  }

  return 'overview';
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: Unified Classification — combine all heuristics
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Result of applying all candidate classification heuristics to a file.
 */
export interface CandidateClassificationResult {
  fileId: string;
  filename: string;
  category: SurveyEvidenceCategory | null;
  method: string | null;
  confidence: number;
  details: string;
}

/**
 * Classify all file_ids for a filename using all available heuristics.
 *
 * Priority order (highest to lowest):
 * 1. Object detection (YOLO) — highest confidence, direct semantic mapping
 * 2. Roof edge count heuristic — strong signal for roof_plane
 * 3. Candidate diversity heuristic — moderate signal for overview
 *
 * The classification is determined at the FILENAME level (aggregated across
 * all file_id rows), then applied to each individual file_id row that doesn't
 * already have a label.
 *
 * Returns one CandidateClassificationResult per file_id in the filename's group.
 */
export function classifyFileFromCandidates(
  filenameSummary: FilenameCandidateSummary,
  objectDetectionByFileId: Map<string, {
    category: SurveyEvidenceCategory | null;
    confidence: number;
    yoloClass: string | null;
  }>,
): CandidateClassificationResult[] {
  const results: CandidateClassificationResult[] = [];

  // First, determine the FILENAME-level classification from heuristics
  let filenameCategory: SurveyEvidenceCategory | null = null;
  let filenameMethod: string | null = null;
  let filenameConfidence = 0;
  let filenameDetails = '';

  // Priority 2: Roof edge count heuristic (at filename level)
  const roofCategory = classifyByRoofEdgeCount(filenameSummary);
  if (roofCategory) {
    const roofEdgeCount = filenameSummary.candidateTypeCounts['roof_edge_candidate'] ?? 0;
    filenameCategory = roofCategory;
    filenameMethod = 'roof_edge_count';
    filenameConfidence = Math.min(0.95, 0.50 + (roofEdgeCount / 200)); // Scale: 20 edges ≈ 0.60, 80 edges ≈ 0.90
    filenameDetails = `${roofEdgeCount} roof_edge_candidate entries (threshold: ${ROOF_EDGE_MIN_COUNT_THRESHOLD}) → ${roofCategory}`;
  }

  // Priority 3: Candidate diversity heuristic (at filename level, only if no roof classification)
  if (!filenameCategory) {
    const overviewCategory = classifyByCandidateDiversity(filenameSummary);
    if (overviewCategory) {
      filenameCategory = overviewCategory;
      filenameMethod = 'candidate_diversity';
      filenameConfidence = 0.60; // Moderate confidence for diversity heuristic
      filenameDetails = `${filenameSummary.distinctTypes} candidate types, dominant ratio ${filenameSummary.dominantRatio.toFixed(2)} → ${overviewCategory}`;
    }
  }

  // Now produce results for each file_id in this filename group
  for (const fileId of filenameSummary.fileIds) {
    // Priority 1: Object detection (YOLO) — per file_id, highest priority
    const objDet = objectDetectionByFileId.get(fileId);
    if (objDet && objDet.category) {
      results.push({
        fileId,
        filename: filenameSummary.filename,
        category: objDet.category,
        method: 'object_detection',
        confidence: objDet.confidence,
        details: `YOLO class "${objDet.yoloClass}" → ${objDet.category}`,
      });
    } else if (filenameCategory) {
      // Apply filename-level heuristic classification
      results.push({
        fileId,
        filename: filenameSummary.filename,
        category: filenameCategory,
        method: filenameMethod,
        confidence: filenameConfidence,
        details: filenameDetails,
      });
    } else {
      results.push({
        fileId,
        filename: filenameSummary.filename,
        category: null,
        method: null,
        confidence: 0,
        details: 'No classification heuristic matched',
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Legacy YOLO-only functions (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the evidence category for a YOLO class name, considering confidence.
 *
 * @param yoloClassName - YOLO class name from detection
 * @param confidence - Detection confidence score (0-1)
 * @param minConfidenceThreshold - Global minimum confidence (default: 0.70)
 * @returns Evidence category or null if below threshold or not mapped
 */
export function getEvidenceCategoryForYoloClass(
  yoloClassName: string,
  confidence: number,
  minConfidenceThreshold: number = 0.70,
): SurveyEvidenceCategory | null {
  if (!yoloClassName || confidence === undefined || confidence === null) {
    return null;
  }

  const mapping = YOLO_CLASS_TO_EVIDENCE_CATEGORY[yoloClassName.toLowerCase()];
  if (!mapping) {
    return null;
  }

  // Use the higher of the class-specific threshold or global threshold
  const effectiveThreshold = Math.max(mapping.minConfidence, minConfidenceThreshold);

  return confidence >= effectiveThreshold ? mapping.category : null;
}

/**
 * Extract YOLO class name from a candidate payload.
 *
 * Handles various payload formats from different YOLO models:
 * - rawClassName: External Render worker (yolov8n.pt)
 * - className: Generic format
 * - class_name: Alternative format
 * - label: Simple label format
 * - category: Category format
 */
export function extractYoloClassNameFromPayload(
  payload: Record<string, unknown>,
): string | null {
  if (!payload || typeof payload !== 'object') return null;

  // rawClassName field (used by external Render worker — yolov8n.pt)
  const rawClassName = payload.rawClassName as string | null;
  if (rawClassName) return rawClassName.toLowerCase();

  // Direct className field (most common)
  const className = payload.className as string | null;
  if (className) return className.toLowerCase();

  // Try class_name (alternative format)
  const classNameAlt = payload.class_name as string | null;
  if (classNameAlt) return classNameAlt.toLowerCase();

  // Try label field
  const label = payload.label as string | null;
  if (label) return label.toLowerCase();

  // Try category field
  const category = payload.category as string | null;
  if (category) return category.toLowerCase();

  return null;
}

/**
 * Check if a candidate is suitable for auto-labeling.
 *
 * Criteria:
 * - Candidate type is 'object_detection'
 * - Has a valid YOLO class name
 * - Confidence meets threshold
 * - Class name is mapped to an evidence category
 */
export function isCandidateSuitableForAutoLabel(
  candidate: {
    candidateType?: string;
    candidateCategory?: string;
    confidence?: number | null;
    payload?: Record<string, unknown>;
  },
  minConfidenceThreshold: number = 0.70,
): boolean {
  if (!candidate) return false;

  // Only object_detection candidates for auto-labeling
  if (candidate.candidateType !== 'object_detection') return false;

  // Must have confidence
  const confidence = candidate.confidence ?? 0;
  if (confidence < minConfidenceThreshold) return false;

  // Must have payload with class name
  if (!candidate.payload) return false;

  const yoloClassName = extractYoloClassNameFromPayload(candidate.payload);
  if (!yoloClassName) return false;

  // Must be mapped to an evidence category
  const category = getEvidenceCategoryForYoloClass(
    yoloClassName,
    confidence,
    minConfidenceThreshold,
  );

  return category !== null;
}

/**
 * Get the evidence category for a candidate (if suitable).
 */
export function getEvidenceCategoryForCandidate(
  candidate: {
    candidateType?: string;
    candidateCategory?: string;
    confidence?: number | null;
    payload?: Record<string, unknown>;
  },
  minConfidenceThreshold: number = 0.70,
): SurveyEvidenceCategory | null {
  if (!isCandidateSuitableForAutoLabel(candidate, minConfidenceThreshold)) {
    return null;
  }

  const yoloClassName = extractYoloClassNameFromPayload(candidate.payload!);
  const confidence = candidate.confidence ?? 0;

  return getEvidenceCategoryForYoloClass(yoloClassName, confidence, minConfidenceThreshold);
}
