// ═══════════════════════════════════════════════════════════════════════════
// Ecosystem Compatibility Engine (Phase 5 — Lock Architecture)
// lib/system/ecosystemCompatibility.ts
//
// Public facade for all ecosystem compatibility checks.
// The full implementation lives in brandCompatibility.ts; this module
// re-exports the canonical API under the names specified by the
// Lock Architecture Master Prompt (Phase 5) and adds the two convenience
// helpers isEcosystemCompatible() and getEcosystemConflicts().
//
// CONSUMERS: import from this file, not from brandCompatibility.ts directly.
// Adding new compatibility rules → edit brandCompatibility.ts + brand profiles.
// This file never changes except to expose new public helpers.
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Core evaluator
  evaluateCompatibility,
  // Discovery helpers
  listCompatibleBatteryBrands,
  listCompatibleInverterBrands,
  getRequiredBosCategories,
  listRequiredBosFamiliesForBrand,
  findMissingBosCategories,
  // Constant matrices
  REQUIRED_BOS_BY_TOPOLOGY,
  BATTERY_ONLY_BOS_CATEGORIES,
  // Types
  type CompatibilityInput,
  type CompatibilityIssue,
  type CompatibilityIssueCode,
  type CompatibilitySuggestion,
  type CompatibilityResult,
} from './brandCompatibility';

import {
  evaluateCompatibility,
  type CompatibilityInput,
  type CompatibilityIssue,
} from './brandCompatibility';

// ─── Convenience helpers ────────────────────────────────────────────────────

/**
 * Returns true when the given combination has no ERROR-severity issues.
 * Warnings are allowed; errors block the configuration from being applied.
 *
 * @example
 *   isEcosystemCompatible({ inverterBrandId: 'solaredge', batteryBrandId: 'enphase', batteryEnabled: true })
 *   // → false  (cross-brand battery incompatibility)
 */
export function isEcosystemCompatible(input: CompatibilityInput): boolean {
  const result = evaluateCompatibility(input);
  return result.ok; // true only when zero error-severity issues
}

/**
 * Returns the list of ERROR-severity compatibility conflicts for the given
 * combination. Returns an empty array when the configuration is fully
 * compatible. Warnings are excluded — use evaluateCompatibility() if you
 * need the full picture.
 *
 * @example
 *   getEcosystemConflicts({ inverterBrandId: 'ecoflow', batteryBrandId: 'enphase', batteryEnabled: true })
 *   // → [{ code: 'INCOMPATIBLE_INVERTER_BATTERY', severity: 'error', ... }]
 */
export function getEcosystemConflicts(input: CompatibilityInput): CompatibilityIssue[] {
  const result = evaluateCompatibility(input);
  return result.issues.filter(i => i.severity === 'error');
}