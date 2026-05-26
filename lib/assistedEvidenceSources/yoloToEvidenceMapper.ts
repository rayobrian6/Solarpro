/**
 * YOLO Class Name to Survey Evidence Category Mapper
 *
 * Maps YOLO object detection class names to SolarPro survey evidence categories.
 * Used to auto-assign photo labels from high-confidence YOLO detections.
 *
 * Supports two payload field formats:
 * - rawClassName: Used by external Render worker (yolov8n.pt)
 * - className / class_name / label / category: Generic formats
 */

import type { SurveyEvidenceCategory } from '@/lib/survey/evidence/manifest';

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

  // ── YOLOv8 (yolov8n.pt) COCO class aliases ────────────────────────────
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