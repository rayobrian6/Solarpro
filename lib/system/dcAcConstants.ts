// lib/system/dcAcConstants.ts — Phase B2: Decision Consistency Lock
//
// Single source of truth for DC/AC ratio design targets used across:
//   - electrical-calc.ts  (hard-limit enforcement)
//   - page.tsx            (UI badge thresholds)
//   - Any future consumer that needs to compare a system ratio to targets
//
// NOTE: These are DISPLAY / ENFORCEMENT constants for the UI and electrical
// calc layer.  The sizing engine (sizingEngine.ts) and feasibility evaluator
// (feasibilityEvaluator.ts) maintain their own internal constants because
// they operate on different criteria.

export const DC_AC_TARGET = {
  /** Minimum acceptable ratio — below this triggers a warning. */
  min: 1.20,
  /** Ideal / sweet-spot ratio used for recommendations. */
  ideal: 1.25,
  /** Maximum recommended ratio — above this triggers a warning. */
  max: 1.30,
  /** Hard floor — ratio below this is flagged as an error. */
  hardMin: 1.00,
  /**
   * v61.9: Raised from 1.55 → 1.75.
   * 1.55 was too low — it blocked valid hybrid inverters (e.g. EcoFlow OCEAN Pro
   * 11.5 kW at 1.683 ratio). The electrical-calc warning fires at hardMax; this
   * is now the "aggressive oversize / warning" boundary, not hard error.
   * Severe economic warning fires at DC_AC_CLIPPING_BANDS.SEVERE_MAX (1.75).
   */
  hardMax: 1.75,
} as const;

/**
 * v61.9 — Named clipping severity bands.
 * Used by electrical-calc.ts, validationEngine.ts, and UI components
 * to classify DC/AC ratio severity consistently.
 *
 * Priority: inverter upsizing is ALWAYS preferred over panel reduction
 * when DC/AC ratio is the only concern.
 */
export const DC_AC_CLIPPING_BANDS = {
  /** ≤ 1.30: normal — no clipping concern */
  NORMAL_MAX:   1.30,
  /** ≤ 1.55: mild oversize — info only, no action required */
  MILD_MAX:     1.55,
  /** ≤ 1.75: aggressive oversize — warning, consider inverter upsizing */
  WARNING_MAX:  1.75,
  /** ≤ 2.00: severe clipping — strong recommendation to upsize inverter */
  SEVERE_MAX:   2.00,
  /** > 2.00: critical economic waste — treat as design error */
  CRITICAL_THRESHOLD: 2.00,
} as const;

export type DcAcClippingSeverity = 'normal' | 'mild' | 'warning' | 'severe' | 'critical';

/** Returns the clipping severity label for a given DC/AC ratio. */
export function getDcAcClippingSeverity(ratio: number): DcAcClippingSeverity {
  if (ratio <= DC_AC_CLIPPING_BANDS.NORMAL_MAX)  return 'normal';
  if (ratio <= DC_AC_CLIPPING_BANDS.MILD_MAX)    return 'mild';
  if (ratio <= DC_AC_CLIPPING_BANDS.WARNING_MAX) return 'warning';
  if (ratio <= DC_AC_CLIPPING_BANDS.SEVERE_MAX)  return 'severe';
  return 'critical';
}