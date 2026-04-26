// ═══════════════════════════════════════════════════════════════════════
// Brand Compatibility Matrix (Phase 15)
// lib/system/brandCompatibility.ts
//
// Centralized, pure evaluator for brand compatibility across:
//   - inverter ↔ battery ecosystem
//   - inverter ↔ topology enforcement
//   - brand ↔ systemType support
//   - BOS (balance-of-system) category requirements
//
// CORE PRINCIPLE:
//   Brand profiles in lib/system/brandProfiles/ declare WHAT each brand
//   supports. This module declares the RULES that combine those facts
//   into a verdict for any specific user configuration.
//
//   No hardcoded "if brand === 'enphase'" branches anywhere else in
//   the system. All compatibility logic routes through here. Adding a
//   new brand requires ONLY a brand profile entry — no changes to
//   this module or any downstream consumer.
//
// This module is PURE. It never mutates config, never auto-applies
// recommendations. It produces a structured verdict; consumers
// (validation engine, UI) decide what to do.
// ═══════════════════════════════════════════════════════════════════════

import type { SystemType } from './systemDefinition';
import type { BrandProfile, TopologyFamily, RequiredBOSFamily } from './brandProfiles/types';
import {
  BRAND_PROFILES,
  getBrandProfile,
} from './brandProfiles';

// ─── Public types ───────────────────────────────────────────────────────

/**
 * The combination being evaluated. Any field may be absent — the
 * evaluator only checks what it's given and reports what it can.
 */
export interface CompatibilityInput {
  /** Inverter brand id (e.g. 'enphase', 'ecoflow'). Required for most rules. */
  inverterBrandId?: string | null;
  /** Battery brand id (e.g. 'enphase', 'ecoflow'). Optional if no battery. */
  batteryBrandId?: string | null;
  /** True when the user has enabled a battery. Drives battery-brand checks. */
  batteryEnabled?: boolean;
  /** Target system type (roof/ground/fence). Optional. */
  systemType?: SystemType | null;
  /** Target topology family. Optional — defaults to inverter brand's native topology. */
  topology?: TopologyFamily | null;
}

/**
 * A single compatibility finding. Mirrors the shape of ValidationIssue
 * so consumers can map 1:1 without data loss.
 */
export interface CompatibilityIssue {
  code: CompatibilityIssueCode;
  severity: 'error' | 'warning';
  message: string;
  /** Structured detail (offending ids, recommended replacements, etc.). */
  context?: Record<string, unknown>;
  /** Human-readable suggestion for fixing the issue. */
  recommendation?: string;
}

/**
 * Stable programmatic issue codes. Downstream consumers (validation
 * engine, UI) switch on these for auto-fix / analytics / localization.
 */
export type CompatibilityIssueCode =
  | 'INCOMPATIBLE_INVERTER_BATTERY'
  | 'INCOMPATIBLE_SYSTEM_BRAND'
  | 'INCOMPATIBLE_TOPOLOGY_COMBO'
  | 'INCOMPATIBLE_CROSS_BRAND'
  | 'BATTERY_REQUIRED_BUT_DISABLED'
  | 'BATTERY_ON_NONCAPABLE_BRAND'
  | 'UNKNOWN_INVERTER_BRAND'
  | 'UNKNOWN_BATTERY_BRAND'
  | 'TOPOLOGY_DRIFT_FROM_BRAND';

/**
 * A corrective recommendation the UI can offer as a one-click fix.
 * Omitted when no clean alternative is obvious (e.g. the user's
 * systemType isn't supported by any brand — we don't invent one).
 */
export interface CompatibilitySuggestion {
  /** Recommended inverter brand id (canonical). */
  inverterBrandId?: string;
  /** Recommended battery brand id (canonical). */
  batteryBrandId?: string;
  /** Recommended topology family. */
  topology?: TopologyFamily;
  /** Human-readable rationale for the suggestion. */
  rationale: string;
}

export interface CompatibilityResult {
  /** True when no ERROR-severity issues exist. Warnings do not break OK. */
  ok: boolean;
  /** All findings, in severity order (errors first, then warnings). */
  issues: CompatibilityIssue[];
  /** Optional corrective suggestion, only when issues are present. */
  suggestion?: CompatibilitySuggestion;
}

// ─── BOS category matrix ────────────────────────────────────────────────

/**
 * Required BOS categories per topology. This is the canonical
 * per-topology matrix used by validateBomConsistency() to confirm
 * the BOM contains the expected hardware families. Derived FROM brand
 * profiles (requiredBOSFamilies) but aggregated here for topology-level
 * cross-checks — e.g. "any optimizer system must have an 'optimizer'
 * category in BOM, regardless of which optimizer brand".
 *
 * These are CATEGORY-level requirements. Specific equipment-db ids are
 * still resolved via individual brand profiles.
 */
export const REQUIRED_BOS_BY_TOPOLOGY: Readonly<Record<TopologyFamily, ReadonlyArray<string>>> = {
  micro: [
    'microinverter',
    'trunk_cable',
    'terminator',
    'monitoring_gateway',
  ],
  string: [
    'dc_disconnect',
    'ac_disconnect',
    'rapid_shutdown',
  ],
  optimizer: [
    'optimizer',
    'dc_disconnect',
    'ac_disconnect',
  ],
  hybrid: [
    'inverter_base',
    'smart_meter',
    'monitoring_gateway',
    'dc_disconnect',
  ],
};

/**
 * Categories that are ONLY valid when a battery is enabled. Used by
 * cross-checks to avoid false positives on systems without storage.
 */
export const BATTERY_ONLY_BOS_CATEGORIES: ReadonlySet<string> = new Set([
  'battery',
  'battery_module',
  'battery_combiner',
]);

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Evaluate a full compatibility combination. Returns a structured
 * verdict that consumers can render directly (UI) or convert to
 * validation issues.
 *
 * NO side effects. NO mutations. NO auto-apply. Just analysis.
 */
export function evaluateCompatibility(input: CompatibilityInput): CompatibilityResult {
  const issues: CompatibilityIssue[] = [];
  const {
    inverterBrandId,
    batteryBrandId,
    batteryEnabled = false,
    systemType,
    topology,
  } = input;

  // Resolve brand profiles (nulls tolerated — rules that need them skip).
  const inverterBrand = inverterBrandId ? getBrandProfile(inverterBrandId) : undefined;
  const batteryBrand = batteryBrandId ? getBrandProfile(batteryBrandId) : undefined;

  // ── Rule A: unknown brand ids ─────────────────────────────────────
  if (inverterBrandId && !inverterBrand) {
    issues.push({
      code: 'UNKNOWN_INVERTER_BRAND',
      severity: 'error',
      message: `Inverter brand '${inverterBrandId}' is not a registered brand profile.`,
      context: { inverterBrandId },
      recommendation: 'Select a supported inverter brand.',
    });
  }
  if (batteryEnabled && batteryBrandId && !batteryBrand) {
    issues.push({
      code: 'UNKNOWN_BATTERY_BRAND',
      severity: 'warning',
      message: `Battery brand '${batteryBrandId}' is not a registered brand profile.`,
      context: { batteryBrandId },
    });
  }

  // ── Rule B: brand ↔ systemType support ────────────────────────────
  if (inverterBrand && systemType && !inverterBrand.supportedSystemTypes.includes(systemType)) {
    issues.push({
      code: 'INCOMPATIBLE_SYSTEM_BRAND',
      severity: 'warning', // Not a blocker — user might have a valid edge case
      message: `${inverterBrand.displayName} does not officially support '${systemType}' systems (supports: ${inverterBrand.supportedSystemTypes.join(', ')}).`,
      context: {
        brand: inverterBrand.id,
        systemType,
        supportedSystemTypes: inverterBrand.supportedSystemTypes,
      },
      recommendation: `Consider a brand that supports ${systemType} systems.`,
    });
  }

  // ── Rule C: topology ↔ brand consistency ──────────────────────────
  if (inverterBrand && topology && topology !== inverterBrand.topology) {
    issues.push({
      code: 'TOPOLOGY_DRIFT_FROM_BRAND',
      severity: 'error',
      message: `${inverterBrand.displayName} is a '${inverterBrand.topology}' brand but configuration specifies topology '${topology}'.`,
      context: {
        brand: inverterBrand.id,
        brandTopology: inverterBrand.topology,
        requestedTopology: topology,
      },
      recommendation: `Either switch brand or set topology to '${inverterBrand.topology}'.`,
    });
  }

  // ── Rule D: topology exclusion (brand profile says "never with X") ──
  if (inverterBrand && topology) {
    const exclusions = inverterBrand.compatibility.incompatibleTopologies ?? [];
    if (exclusions.includes(topology)) {
      issues.push({
        code: 'INCOMPATIBLE_TOPOLOGY_COMBO',
        severity: 'error',
        message: `${inverterBrand.displayName} is incompatible with '${topology}' topology.`,
        context: { brand: inverterBrand.id, topology, exclusions },
        recommendation: `Use ${inverterBrand.displayName}'s native '${inverterBrand.topology}' topology.`,
      });
    }
  }

  // ── Rule E: cross-brand exclusion (e.g. EcoFlow ⊥ Enphase) ────────
  if (inverterBrand && batteryBrand && batteryEnabled) {
    const invExcludes = inverterBrand.compatibility.incompatibleBrands ?? [];
    if (invExcludes.includes(batteryBrand.id)) {
      issues.push({
        code: 'INCOMPATIBLE_CROSS_BRAND',
        severity: 'error',
        message: `${inverterBrand.displayName} is declared incompatible with ${batteryBrand.displayName}.`,
        context: {
          inverterBrand: inverterBrand.id,
          batteryBrand: batteryBrand.id,
          excludedBy: 'inverter_profile',
        },
        recommendation: `Use a ${inverterBrand.displayName}-compatible battery.`,
      });
    }
    const batExcludes = batteryBrand.compatibility.incompatibleBrands ?? [];
    if (batExcludes.includes(inverterBrand.id)) {
      issues.push({
        code: 'INCOMPATIBLE_CROSS_BRAND',
        severity: 'error',
        message: `${batteryBrand.displayName} is declared incompatible with ${inverterBrand.displayName}.`,
        context: {
          inverterBrand: inverterBrand.id,
          batteryBrand: batteryBrand.id,
          excludedBy: 'battery_profile',
        },
        recommendation: `Use a ${inverterBrand.displayName}-compatible battery.`,
      });
    }
  }

  // ── Rule F: inverter ↔ battery ecosystem ──────────────────────────
  if (inverterBrand && batteryEnabled) {
    if (!inverterBrand.battery.capable) {
      issues.push({
        code: 'BATTERY_ON_NONCAPABLE_BRAND',
        severity: 'error',
        message: `${inverterBrand.displayName} does not support battery storage.`,
        context: { brand: inverterBrand.id },
        recommendation: 'Disable battery or switch to a battery-capable brand.',
      });
    } else if (batteryBrandId && inverterBrand.battery.recommendedBatteryBrands) {
      const recommended = inverterBrand.battery.recommendedBatteryBrands;
      if (recommended.length > 0 && !recommended.includes(batteryBrandId)) {
        // This is a softer check — Rule E catches HARD incompatibles via
        // the profile's incompatibleBrands. This catches "not officially
        // paired" combos (e.g. Enphase inverter + generic Li battery).
        issues.push({
          code: 'INCOMPATIBLE_INVERTER_BATTERY',
          severity: 'warning',
          message: `${inverterBrand.displayName} is typically paired with ${recommended.join(', ')} batteries; '${batteryBrandId}' is not an officially recommended match.`,
          context: {
            inverterBrand: inverterBrand.id,
            batteryBrand: batteryBrandId,
            recommended,
          },
          recommendation: `Use a recommended battery: ${recommended.join(', ')}.`,
        });
      }
    }
  }

  // ── Rule G: brand requires battery, user disabled it ─────────────
  if (inverterBrand && inverterBrand.battery.required && !batteryEnabled) {
    issues.push({
      code: 'BATTERY_REQUIRED_BUT_DISABLED',
      severity: 'error',
      message: `${inverterBrand.displayName} requires a battery for operation.`,
      context: { brand: inverterBrand.id },
      recommendation: 'Enable battery or switch brands.',
    });
  }

  // ── Sort: errors first, then warnings ─────────────────────────────
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const ordered = [...errors, ...warnings];

  const result: CompatibilityResult = {
    ok: errors.length === 0,
    issues: ordered,
  };

  // ── Corrective suggestion ─────────────────────────────────────────
  if (ordered.length > 0) {
    const suggestion = suggestCorrection(input, inverterBrand, batteryBrand);
    if (suggestion) result.suggestion = suggestion;
  }

  return result;
}

/**
 * Produce a corrective suggestion when the combination has issues.
 * Priorities:
 *   1. If user has a systemType, prefer a brand whose recommendedFor
 *      includes it.
 *   2. Otherwise, prefer the first brand that supports the systemType.
 *   3. Battery brand follows the inverter brand's recommendedBatteryBrands.
 *   4. Return undefined if we can't construct a clean suggestion.
 */
function suggestCorrection(
  input: CompatibilityInput,
  currentInverter: BrandProfile | undefined,
  _currentBattery: BrandProfile | undefined,
): CompatibilitySuggestion | undefined {
  const { systemType, batteryEnabled } = input;

  // Find an inverter brand for the system type.
  let recommendedInverter: BrandProfile | undefined;
  if (systemType) {
    recommendedInverter = BRAND_PROFILES.find(p =>
      p.recommendedFor.includes(systemType) &&
      p.supportedSystemTypes.includes(systemType),
    );
    if (!recommendedInverter) {
      recommendedInverter = BRAND_PROFILES.find(p =>
        p.supportedSystemTypes.includes(systemType),
      );
    }
  }
  if (!recommendedInverter) return undefined;

  const suggestedBatteryBrandId =
    batteryEnabled && recommendedInverter.battery.capable
      ? recommendedInverter.battery.recommendedBatteryBrands?.[0]
      : undefined;

  const rationale = currentInverter
    ? `${currentInverter.displayName} has compatibility conflicts with the current configuration. ` +
      `${recommendedInverter.displayName} supports ${systemType ?? 'this system'} natively.`
    : `${recommendedInverter.displayName} is the recommended brand for ${systemType ?? 'this system'}.`;

  return {
    inverterBrandId: recommendedInverter.id,
    batteryBrandId: suggestedBatteryBrandId,
    topology: recommendedInverter.topology,
    rationale,
  };
}

// ─── Query helpers ──────────────────────────────────────────────────────

/**
 * List battery brands that are compatible with the given inverter brand.
 * A brand is "compatible" if it's in the inverter's
 * recommendedBatteryBrands AND not in its incompatibleBrands list.
 * Returns empty array for non-battery-capable brands.
 */
export function listCompatibleBatteryBrands(inverterBrandId: string | null | undefined): string[] {
  const brand = getBrandProfile(inverterBrandId ?? undefined);
  if (!brand || !brand.battery.capable) return [];
  const recommended = brand.battery.recommendedBatteryBrands ?? [];
  const excluded = new Set(brand.compatibility.incompatibleBrands ?? []);
  return recommended.filter(b => !excluded.has(b));
}

/**
 * List inverter brands that support a given systemType (and optionally
 * a specific topology). Brand order preserved from registry.
 */
export function listCompatibleInverterBrands(
  systemType: SystemType,
  topology?: TopologyFamily,
): BrandProfile[] {
  return BRAND_PROFILES.filter(p => {
    if (!p.supportedSystemTypes.includes(systemType)) return false;
    if (topology && p.topology !== topology) return false;
    return true;
  });
}

/**
 * Return the required BOS categories for a given topology. This is the
 * canonical category list — useful for validation when the sizing
 * result's requiredComponents list is not yet available (pre-sizing
 * UI checks, or sanity checks against a BOM exported separately).
 */
export function getRequiredBosCategories(topology: TopologyFamily): ReadonlyArray<string> {
  return REQUIRED_BOS_BY_TOPOLOGY[topology] ?? [];
}

/**
 * Collapse a brand profile's requiredBOSFamilies into a plain list of
 * category tokens (for quick "does this BOM contain X" checks).
 */
export function listRequiredBosFamiliesForBrand(brandId: string): ReadonlyArray<RequiredBOSFamily> {
  const brand = getBrandProfile(brandId);
  return brand?.requiredBOSFamilies ?? [];
}

/**
 * Check whether the given BOM category set contains all required
 * topology-level BOS categories. Returns the categories that are
 * MISSING (empty array === fully compliant).
 */
export function findMissingBosCategories(
  topology: TopologyFamily,
  bomCategories: Iterable<string>,
): string[] {
  const present = new Set<string>();
  for (const c of bomCategories) present.add(c);
  const required = getRequiredBosCategories(topology);
  return required.filter(cat => !present.has(cat));
}