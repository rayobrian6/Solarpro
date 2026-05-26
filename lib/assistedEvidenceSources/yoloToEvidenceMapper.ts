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
 * YOLO payload field formats:
 * - rawClassName: Used by external Render worker (yolov8n.pt)
 * - className / class_name / label / category: Generic formats
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';

// ═══════════════════════════════════════════════════════════════════════════
// Section 1: YOLO Class → Evidence Category Mapping
// ═══════════════════════════════════════════════════════════════════════════

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

  // ─── YOLOv8 (yolov8n.pt) COCO class aliases ────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════
// Section 2: Roof Edge Candidate Heuristic → roof_plane
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for roof edge count heuristic.
 *
 * When a photo has many roof_edge_candidate entries, it is very likely a
 * roof photo. The count threshold filters out photos with only a few
 * incidental horizontal lines (which could be sidewalks, tables, etc.).
 *
 * Based on analysis of survey 302cf42c data:
 * - Roof photos have 50-80 roof_edge candidates
 * - Non-roof photos have 0-36 roof_edge candidates
 * - Threshold of 30 cleanly separates the two groups
 */
export const ROOF_EDGE_MIN_COUNT_THRESHOLD = Number(
  process.env.ROOF_EDGE_MIN_COUNT_THRESHOLD || 30,
);

/**
 * Aggregate candidate counts per file.
 * Used by the roof edge and diversity heuristics.
 */
export interface CandidateCountSummary {
  fileId: string;
  candidateTypeCounts: Record<string, number>;
  totalCandidates: number;
  distinctTypes: number;
  dominantType: string | null;
  dominantRatio: number;
}

/**
 * Build candidate count summaries for all files in a run.
 * Groups candidates by file_id and computes aggregate statistics.
 */
export function buildCandidateCountSummaries(
  candidates: Array<{ fileId: string; candidateType: string }>,
): Map<string, CandidateCountSummary> {
  const summaries = new Map<string, CandidateCountSummary>();

  for (const candidate of candidates) {
    const { fileId, candidateType } = candidate;

    let summary = summaries.get(fileId);
    if (!summary) {
      summary = {
        fileId,
        candidateTypeCounts: {},
        totalCandidates: 0,
        distinctTypes: 0,
        dominantType: null,
        dominantRatio: 0,
      };
      summaries.set(fileId, summary);
    }

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
 * Classify a file as roof_plane based on roof_edge_candidate count.
 *
 * Rule: If a file has >= ROOF_EDGE_MIN_COUNT_THRESHOLD roof_edge_candidate
 * entries, it is very likely a roof photo → label as "roof_plane".
 *
 * This works because roof photos contain many detectable horizontal lines
 * (eaves, ridges, rake edges) that the OpenCV Hough line detector picks up.
 * Non-roof photos (meters, panels, site overview) have far fewer.
 */
export function classifyByRoofEdgeCount(
  summary: CandidateCountSummary,
): SurveyEvidenceCategory | null {
  const roofEdgeCount = summary.candidateTypeCounts['roof_edge_candidate'] ?? 0;

  if (roofEdgeCount >= ROOF_EDGE_MIN_COUNT_THRESHOLD) {
    return 'roof_plane';
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 3: Candidate Diversity Heuristic → overview
// ═══════════════════════════════════════════════════════════════════════════

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
 */
export const OVERVIEW_MIN_CANDIDATE_TYPES = Number(
  process.env.OVERVIEW_MIN_CANDIDATE_TYPES || 4,
);
export const OVERVIEW_MAX_DOMINANT_RATIO = Number(
  process.env.OVERVIEW_MAX_DOMINANT_RATIO || 0.55,
);

/**
 * Classify a file as overview based on candidate type diversity.
 *
 * Rule: If a file has >= OVERVIEW_MIN_CANDIDATE_TYPES distinct candidate types
 * AND no single type accounts for more than OVERVIEW_MAX_DOMINANT_RATIO of
 * all candidates, it is likely a site overview photo → label as "overview".
 *
 * Exclusion: Files already classified as roof_plane (high roof edge count)
 * are excluded from overview classification.
 */
export function classifyByCandidateDiversity(
  summary: CandidateCountSummary,
): SurveyEvidenceCategory | null {
  // Don't classify as overview if this file has many roof edges
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

// ═══════════════════════════════════════════════════════════════════════════
// Section 4: Unified Classification — combine all heuristics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of applying all candidate classification heuristics to a file.
 */
export interface CandidateClassificationResult {
  fileId: string;
  category: SurveyEvidenceCategory | null;
  method: string | null;
  confidence: number;
  details: string;
}

/**
 * Classify a file using all available heuristics.
 *
 * Priority order (highest to lowest):
 * 1. Object detection (YOLO) — highest confidence, direct semantic mapping
 * 2. Roof edge count heuristic — strong signal for roof_plane
 * 3. Candidate diversity heuristic — moderate signal for overview
 *
 * Returns the first classification that produces a result.
 */
export function classifyFileFromCandidates(
  fileId: string,
  objectDetectionCategory: SurveyEvidenceCategory | null,
  objectDetectionConfidence: number,
  objectDetectionClass: string | null,
  candidateCountSummary: CandidateCountSummary,
): CandidateClassificationResult {
  // Priority 1: Object detection (YOLO)
  if (objectDetectionCategory) {
    return {
      fileId,
      category: objectDetectionCategory,
      method: 'object_detection',
      confidence: objectDetectionConfidence,
      details: `YOLO class "${objectDetectionClass}" → ${objectDetectionCategory}`,
    };
  }

  // Priority 2: Roof edge count heuristic
  const roofCategory = classifyByRoofEdgeCount(candidateCountSummary);
  if (roofCategory) {
    const roofEdgeCount = candidateCountSummary.candidateTypeCounts['roof_edge_candidate'] ?? 0;
    return {
      fileId,
      category: roofCategory,
      method: 'roof_edge_count',
      confidence: Math.min(0.95, 0.50 + (roofEdgeCount / 200)), // Scale: 30 edges ≈ 0.65, 80 edges ≈ 0.90
      details: `${roofEdgeCount} roof_edge_candidate entries (threshold: ${ROOF_EDGE_MIN_COUNT_THRESHOLD}) → ${roofCategory}`,
    };
  }

  // Priority 3: Candidate diversity heuristic
  const overviewCategory = classifyByCandidateDiversity(candidateCountSummary);
  if (overviewCategory) {
    return {
      fileId,
      category: overviewCategory,
      method: 'candidate_diversity',
      confidence: 0.60, // Moderate confidence for diversity heuristic
      details: `${candidateCountSummary.distinctTypes} candidate types, dominant ratio ${candidateCountSummary.dominantRatio.toFixed(2)} → ${overviewCategory}`,
    };
  }

  return {
    fileId,
    category: null,
    method: null,
    confidence: 0,
    details: 'No classification heuristic matched',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Section 5: Legacy YOLO-only functions (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════════════════

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
