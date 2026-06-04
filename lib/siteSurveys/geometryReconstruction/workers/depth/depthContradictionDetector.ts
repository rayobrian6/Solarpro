/**
 * Depth-Class Contradiction Detector (P0-2.3)
 *
 * Detects contradictions between the estimated depth of a segmentation mask
 * and the expected depth range for its class. When MiDaS depth at a mask
 * region falls outside the class's expected range, a contradiction report
 * is emitted with severity, confidence penalty, and an optional
 * reclassification suggestion.
 *
 * Key design decisions:
 * - Only runs on the MiDaS depth path (not heuristic). The heuristic path
 *   uses class priors to assign depth, so detecting contradictions against
 *   those same priors would be circular and produce 100% false positives.
 * - Per-mask detection: computes the mean depth over the mask's bounding
 *   region in the depth grid, then checks against the class range table.
 * - Severity follows the deviation thresholds from P0-2.2:
 *   <0.05='none', 0.05-0.10='minor', 0.10-0.20='moderate', >0.20='major'.
 * - Confidence penalty: 0 for none/minor (within noise), 15 for moderate,
 *   30 for major. These penalties are applied to the depth estimate's
 *   confidence, making contradicted depth less trusted for downstream
 *   plane extraction and canonical promotion.
 * - Reclassification suggestion: when the actual depth is strongly
 *   consistent with a different class (falls within that class's range
 *   with deviation < 0.05), the report includes a suggested class.
 *   This is informational only — it does NOT change the mask's class.
 *
 * Feature flag: PHASE0_DEPTH_CONTRADICTION
 * When 'true' or '1', contradiction detection is active.
 *
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import type {
  SegmentationClass,
  DepthContradictionReport,
  SemanticSegmentationMask,
  DepthMap,
} from '../../types';

import {
  DEPTH_CLASS_RANGES,
  computeDepthDeviation,
  classifyDeviation,
} from './depthContradictionRanges';

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Check if Phase 0 depth contradiction detection is enabled.
 * Controlled by PHASE0_DEPTH_CONTRADICTION environment variable.
 * When 'true' or '1', the detector runs on MiDaS depth output.
 */
export function isPhase0DepthContradictionEnabled(): boolean {
  const val = process.env.PHASE0_DEPTH_CONTRADICTION ?? '';
  return val === 'true' || val === '1';
}

// ---------------------------------------------------------------------------
// Confidence penalties per severity
// ---------------------------------------------------------------------------

/**
 * Confidence penalty applied to depth estimates based on contradiction severity.
 *
 * - 'none': no penalty — depth is consistent with class range
 * - 'minor': no penalty — deviation is within noise margin
 * - 'moderate': 15 point penalty — significant deviation, depth is suspect
 * - 'major': 30 point penalty — severe deviation, depth is very suspect
 *
 * These penalties reduce the confidence of the DepthMap artifact, which
 * downstream consumers (plane extraction, canonical promotion) use to
 * decide whether to trust the depth signal.
 */
const SEVERITY_CONFIDENCE_PENALTY: Record<import('../../types').ContradictionSeverity, number> = {
  none: 0,
  minor: 0,
  moderate: 15,
  major: 30,
};

// ---------------------------------------------------------------------------
// Mask depth computation
// ---------------------------------------------------------------------------

/**
 * Compute the mean normalized depth over a mask's bounding region
 * in the depth grid.
 *
 * The depth grid is a Float32Array of size (width × height) in row-major
 * order. The mask's bounds are in normalized image coordinates [0,1].
 * We map those bounds to grid indices and average all depth values
 * within the bounding rectangle.
 *
 * Using the bounding rectangle (not the full polygon) is a deliberate
 * approximation: (1) it avoids per-pixel polygon membership testing at
 * each grid cell, which would be expensive for high-resolution grids,
 * and (2) the bounding rectangle covers the mask's extent, providing
 * a representative average that is biased slightly toward the mask's
 * depth rather than its surroundings. For contradiction detection, a
 * slight over-estimation of the mask region is acceptable because the
 * severity thresholds already have wide margins.
 *
 * If the mask has no bounds or the bounds produce zero valid grid cells,
 * returns null (no contradiction check possible).
 */
export function computeMaskMeanDepth(
  mask: SemanticSegmentationMask,
  depthGrid: Float32Array,
  gridWidth: number,
  gridHeight: number,
): number | null {
  // Use maskBounds to determine the grid region to sample
  const bounds = mask.maskBounds;
  if (!bounds) return null;

  // Convert normalized bounds [0,1] to grid indices
  const startCol = Math.max(0, Math.floor(bounds.x * gridWidth));
  const endCol = Math.min(gridWidth - 1, Math.ceil((bounds.x + bounds.width) * gridWidth));
  const startRow = Math.max(0, Math.floor(bounds.y * gridHeight));
  const endRow = Math.min(gridHeight - 1, Math.ceil((bounds.y + bounds.height) * gridHeight));

  if (startCol > endCol || startRow > endRow) return null;

  let sum = 0;
  let count = 0;

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const value = depthGrid[row * gridWidth + col];
      // Skip NaN/invalid values (MiDaS can produce these at edges)
      if (Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
  }

  return count > 0 ? sum / count : null;
}

// ---------------------------------------------------------------------------
// Reclassification suggestion
// ---------------------------------------------------------------------------

/**
 * Suggest a reclassification when the actual depth is strongly consistent
 * with a different class's expected range.
 *
 * A class is a "suggestion" when:
 * 1. Its range includes the actual depth (deviation = 0).
 * 2. It has checkContradiction=true (we only suggest classes that
 *    are meaningful for contradiction checking).
 * 3. It is not the same as the current class.
 *
 * If multiple classes match, we prefer the one with the narrowest range
 * (most specific match). If no class matches, returns null.
 *
 * This is INFORMATIONAL ONLY — it does NOT change the mask's class.
 * The suggestion helps reviewers understand why the contradiction occurred.
 */
export function suggestReclassification(
  currentClass: SegmentationClass,
  actualDepth: number,
): SegmentationClass | null {
  let bestClass: SegmentationClass | null = null;
  let bestRangeWidth = Infinity;

  const entries = Object.entries(DEPTH_CLASS_RANGES) as [SegmentationClass, { min: number; max: number; checkContradiction: boolean }][];

  for (const [cls, range] of entries) {
    if (cls === currentClass) continue;
    if (!range.checkContradiction) continue;

    // Depth must fall within this class's range
    if (actualDepth >= range.min && actualDepth <= range.max) {
      const rangeWidth = range.max - range.min;
      // Prefer narrower range (more specific match)
      if (rangeWidth < bestRangeWidth) {
        bestRangeWidth = rangeWidth;
        bestClass = cls;
      }
    }
  }

  return bestClass;
}

// ---------------------------------------------------------------------------
// Main detector function
// ---------------------------------------------------------------------------

export interface DepthContradictionDetectorInput {
  /** Segmentation masks to check for contradictions. */
  masks: SemanticSegmentationMask[];
  /** Depth grid (Float32Array, row-major, width×height). */
  depthGrid: Float32Array;
  /** Width of the depth grid. */
  gridWidth: number;
  /** Height of the depth grid. */
  gridHeight: number;
  /** Whether MiDaS was used to produce the depth grid.
   *  If false (heuristic path), detection is skipped entirely. */
  usedMidas: boolean;
  /** Minimum severity to include in the report.
   *  Masks with severity below this threshold are not reported.
   *  Default: 'minor' (report minor, moderate, major; skip none). */
  minReportSeverity?: import('../../types').ContradictionSeverity;
}

export interface DepthContradictionDetectorOutput {
  /** Contradiction reports, one per mask that has a contradiction. */
  reports: DepthContradictionReport[];
  /** Total confidence penalty across all contradicted masks. */
  totalConfidencePenalty: number;
  /** Number of masks checked. */
  masksChecked: number;
  /** Number of masks with contradiction severity >= minor. */
  masksContradicted: number;
  /** Number of masks skipped (heuristic path, no bounds, background class, etc.). */
  masksSkipped: number;
  /** Whether the detector ran (false if MiDaS was not used). */
  detectorRan: boolean;
}

/** Severity ordering for comparison. */
const SEVERITY_ORDER: Record<import('../../types').ContradictionSeverity, number> = {
  none: 0,
  minor: 1,
  moderate: 2,
  major: 3,
};

/**
 * Run depth-class contradiction detection on a set of segmentation masks
 * against a depth grid.
 *
 * For each mask:
 * 1. Compute mean depth over the mask's bounding region in the grid.
 * 2. Look up the expected depth range for the mask's class.
 * 3. If the class has checkContradiction=false, skip (e.g., background,
 *    electrical equipment, condition flags).
 * 4. Compute deviation from expected range and classify severity.
 * 5. If severity >= minReportSeverity, emit a DepthContradictionReport.
 * 6. Apply confidence penalty based on severity.
 *
 * Returns the full detector output with reports and summary statistics.
 */
export function detectDepthContradictions(
  input: DepthContradictionDetectorInput,
): DepthContradictionDetectorOutput {
  // Never run on heuristic depth — detecting contradictions against
  // class priors that were used to generate the depth would be circular.
  if (!input.usedMidas) {
    return {
      reports: [],
      totalConfidencePenalty: 0,
      masksChecked: 0,
      masksContradicted: 0,
      masksSkipped: input.masks.length,
      detectorRan: false,
    };
  }

  const minSeverityOrder = SEVERITY_ORDER[input.minReportSeverity ?? 'minor'];
  const reports: DepthContradictionReport[] = [];
  let totalPenalty = 0;
  let masksChecked = 0;
  let masksContradicted = 0;
  let masksSkipped = 0;

  for (const mask of input.masks) {
    const cls = mask.segmentationClass;
    const range = DEPTH_CLASS_RANGES[cls];

    // Skip classes that don't participate in contradiction checking
    if (!range || !range.checkContradiction) {
      masksSkipped++;
      continue;
    }

    // Skip masks excluded from geometry (sky containment, etc.)
    if (mask.excludeFromGeometry) {
      masksSkipped++;
      continue;
    }

    // Compute mean depth over mask region
    const meanDepth = computeMaskMeanDepth(
      mask,
      input.depthGrid,
      input.gridWidth,
      input.gridHeight,
    );

    if (meanDepth === null) {
      masksSkipped++;
      continue;
    }

    masksChecked++;

    // Compute deviation and severity
    const deviation = computeDepthDeviation(cls, meanDepth);
    const severity = classifyDeviation(deviation);
    const penalty = SEVERITY_CONFIDENCE_PENALTY[severity];

    // Only report if severity meets the minimum threshold
    if (SEVERITY_ORDER[severity] < minSeverityOrder) {
      continue;
    }

    masksContradicted++;
    totalPenalty += penalty;

    // Build human-readable description
    const description = buildDescription(cls, meanDepth, range, deviation, severity, mask.id);

    // Optional reclassification suggestion
    const suggestion = deviation >= 0.10
      ? suggestReclassification(cls, meanDepth)
      : null;

    const report: DepthContradictionReport = {
      segmentationClass: cls,
      maskId: mask.id,
      expectedRange: [range.min, range.max],
      actualDepth: meanDepth,
      deviation,
      severity,
      confidencePenalty: penalty,
      description: suggestion
        ? `${description} Suggests reclassification as '${suggestion}'.`
        : description,
    };

    reports.push(report);
  }

  return {
    reports,
    totalConfidencePenalty: totalPenalty,
    masksChecked,
    masksContradicted,
    masksSkipped,
    detectorRan: true,
  };
}

// ---------------------------------------------------------------------------
// Description builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable description of a depth-class contradiction.
 */
function buildDescription(
  cls: SegmentationClass,
  actualDepth: number,
  range: { min: number; max: number },
  deviation: number,
  severity: import('../../types').ContradictionSeverity,
  maskId: string,
): string {
  const depthStr = actualDepth.toFixed(3);
  const rangeStr = `[${range.min.toFixed(2)}, ${range.max.toFixed(2)}]`;
  const deviationStr = deviation.toFixed(3);

  const direction = actualDepth < range.min
    ? 'closer to camera than expected'
    : 'farther from camera than expected';

  return (
    `Mask ${maskId} (class='${cls}') has mean depth ${depthStr}, ` +
    `which is ${direction} for its class (expected range ${rangeStr}, ` +
    `deviation ${deviationStr}, severity '${severity}').`
  );
}

// ---------------------------------------------------------------------------
// DepthMap artifact confidence adjustment
// ---------------------------------------------------------------------------

/**
 * Apply contradiction penalties to a DepthMap artifact's confidence.
 *
 * Reduces the confidence by the total penalty from the contradiction report,
 * clamped to a minimum of 5 (never reduce to zero — depth is still useful
 * as a support signal even when contradicted).
 *
 * Returns the adjusted confidence value.
 */
export function applyContradictionPenalty(
  baseConfidence: number,
  totalPenalty: number,
): number {
  return Math.max(5, baseConfidence - totalPenalty);
}
