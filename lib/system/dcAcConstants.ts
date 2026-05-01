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
  /** Hard ceiling — ratio above this is flagged as an error (NEC clipping concern). */
  hardMax: 1.55,
} as const;