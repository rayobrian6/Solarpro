// ============================================================================
// lib/vision/confidenceGate.ts — Detection Confidence Gating
//
// VERSION: VISION_PIPELINE_VERSION = 1
//
// PURPOSE:
//   Centralized confidence threshold evaluation for all detection classes.
//   Used by visionAggregator.ts and visionPatch.ts to filter detections
//   before writing to SystemDefinition.
//
// DESIGN:
//   - Per-class thresholds (safety-critical classes have higher bars)
//   - Configurable override at runtime (for A/B testing, AHJ tuning)
//   - Graceful fallback: unknown classes use the default threshold
//   - Never throws — returns boolean in all cases
// ============================================================================

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceThresholds,
  type DetectionClass,
  type RoboflowDetection,
} from './types';

// ─── Threshold resolver ────────────────────────────────────────────────────────

/**
 * getThreshold — returns the minimum confidence required for a class.
 *
 * Priority:
 *   1. options.byClass override (caller-provided)
 *   2. DEFAULT_CONFIDENCE_THRESHOLDS.byClass
 *   3. options.default (caller-provided)
 *   4. DEFAULT_CONFIDENCE_THRESHOLDS.default
 */
export function getThreshold(
  cls: string,
  thresholds: Partial<ConfidenceThresholds> = {},
): number {
  const mergedByClass = {
    ...DEFAULT_CONFIDENCE_THRESHOLDS.byClass,
    ...thresholds.byClass,
  };
  const defaultThreshold =
    thresholds.default ?? DEFAULT_CONFIDENCE_THRESHOLDS.default;

  return mergedByClass[cls as DetectionClass] ?? defaultThreshold;
}

/**
 * passesThreshold — returns true if detection.confidence >= threshold for its class.
 *
 * @param detection   RoboflowDetection with class and confidence
 * @param thresholds  Optional threshold overrides
 */
export function passesThreshold(
  detection: RoboflowDetection,
  thresholds: Partial<ConfidenceThresholds> = {},
): boolean {
  const threshold = getThreshold(detection.class, thresholds);
  return detection.confidence >= threshold;
}

/**
 * filterDetections — filter an array of detections by confidence threshold.
 * Returns only detections that pass their per-class threshold.
 *
 * @param detections  Array of RoboflowDetection to filter
 * @param thresholds  Optional threshold overrides
 * @returns           { passed: RoboflowDetection[], rejected: RoboflowDetection[] }
 */
export function filterDetections(
  detections: RoboflowDetection[],
  thresholds: Partial<ConfidenceThresholds> = {},
): { passed: RoboflowDetection[]; rejected: RoboflowDetection[] } {
  const passed: RoboflowDetection[] = [];
  const rejected: RoboflowDetection[] = [];

  for (const det of detections) {
    if (passesThreshold(det, thresholds)) {
      passed.push(det);
    } else {
      rejected.push(det);
    }
  }

  return { passed, rejected };
}

/**
 * summarizeFilterResult — log-friendly summary of filter results.
 */
export function summarizeFilterResult(
  detections: RoboflowDetection[],
  thresholds: Partial<ConfidenceThresholds> = {},
): string {
  const { passed, rejected } = filterDetections(detections, thresholds);
  const passByClass: Record<string, number> = {};
  const rejectByClass: Record<string, number> = {};

  for (const d of passed)   passByClass[d.class]   = (passByClass[d.class]   ?? 0) + 1;
  for (const d of rejected) rejectByClass[d.class] = (rejectByClass[d.class] ?? 0) + 1;

  const passStr   = Object.entries(passByClass).map(([k, v]) => `${k}=${v}`).join(', ');
  const rejectStr = Object.entries(rejectByClass).map(([k, v]) => `${k}=${v}`).join(', ');

  return `passed=${passed.length}(${passStr || 'none'}) rejected=${rejected.length}(${rejectStr || 'none'})`;
}

// ─── AHJ-specific threshold profiles ──────────────────────────────────────────
//
// Some AHJs require tighter setbacks around specific obstruction types.
// These profiles can be used to adjust confidence thresholds to match
// the higher-certainty requirements for those jurisdictions.

export type AhjProfile = 'default' | 'california_title24' | 'nec2023_strict';

const AHJ_THRESHOLD_OVERRIDES: Record<AhjProfile, Partial<ConfidenceThresholds>> = {
  default: {},

  // California Title 24 — stricter fire setback rules around chimneys and HVAC
  california_title24: {
    byClass: {
      chimney:   0.75,
      hvac_unit: 0.70,
      skylight:  0.65,
    },
  },

  // NEC 2023 strict — highest confidence required for all safety-critical classes
  nec2023_strict: {
    default: 0.65,
    byClass: {
      chimney:      0.80,
      hvac_unit:    0.75,
      skylight:     0.70,
      main_panel:   0.80,
      meter_socket: 0.75,
      disconnect:   0.75,
    },
  },
};

/**
 * getAhjThresholds — returns merged thresholds for a given AHJ profile.
 * Caller may pass additional per-class overrides on top.
 */
export function getAhjThresholds(
  profile: AhjProfile = 'default',
  additionalOverrides: Partial<ConfidenceThresholds> = {},
): ConfidenceThresholds {
  const profileOverrides = AHJ_THRESHOLD_OVERRIDES[profile] ?? {};

  return {
    default: additionalOverrides.default
      ?? profileOverrides.default
      ?? DEFAULT_CONFIDENCE_THRESHOLDS.default,
    byClass: {
      ...DEFAULT_CONFIDENCE_THRESHOLDS.byClass,
      ...profileOverrides.byClass,
      ...additionalOverrides.byClass,
    },
  };
}