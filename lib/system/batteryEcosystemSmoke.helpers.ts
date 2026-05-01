/**
 * v47.428 — Battery Ecosystem Smoke Suite Helpers
 *
 * Shared fixtures and utilities for the battery ecosystem smoke test
 * suite. Parallels brandOnboardingSmoke.helpers.ts but operates on the
 * BATTERIES registry + BrandProfile.battery.recommendedBatteryBrands.
 *
 * Design principles:
 *   - Zero per-battery code. Every helper derives behavior from the registry.
 *   - Pure functions. No module-level side effects.
 *   - Exhaustive. Every helper exercises a real invariant.
 */
import { BATTERIES, type BatterySystem } from '../equipment-db';
import { BRAND_PROFILES, type BrandProfile } from './brandProfiles';

// ─── Battery discovery ────────────────────────────────────────────────

/**
 * All batteries flagged active (or absent active field → treated as active).
 * Skipping explicitly inactive batteries keeps the smoke suite stable
 * when SKUs are temporarily deprecated.
 */
export function getActiveBatteries(): BatterySystem[] {
  return BATTERIES.filter(b => b.active !== false);
}

/**
 * All batteries — including any that may be inactive. Used for the
 * duplicate-id invariant (catches stale/moved entries).
 */
export function getAllBatteries(): BatterySystem[] {
  return [...BATTERIES];
}

/**
 * Index batteries by ecosystemBrand token. Batteries without an
 * ecosystemBrand are grouped under '__unbranded'.
 */
export function indexBatteriesByEcosystemBrand(): Map<string, BatterySystem[]> {
  const idx = new Map<string, BatterySystem[]>();
  for (const b of getActiveBatteries()) {
    const key = b.ecosystemBrand ?? '__unbranded';
    const list = idx.get(key) ?? [];
    list.push(b);
    idx.set(key, list);
  }
  return idx;
}

// ─── BrandProfile ↔ Battery recommendation linkage ────────────────────

/**
 * Every BrandProfile that declares battery.capable: true AND has at
 * least one recommendedBatteryBrands entry. These are the profiles
 * whose recommendations we enforce actually resolve to real SKUs.
 */
export function getBatteryCapableProfiles(): BrandProfile[] {
  return BRAND_PROFILES.filter(
    p => p.battery.capable && (p.battery.recommendedBatteryBrands?.length ?? 0) > 0,
  );
}

/**
 * Given a battery-capable BrandProfile, return the union of batteries
 * that match ANY of its recommendedBatteryBrands tokens. Empty result
 * means the profile has a dangling recommendation — a smoke failure.
 */
export function resolveRecommendedBatteries(profile: BrandProfile): BatterySystem[] {
  const tokens = profile.battery.recommendedBatteryBrands ?? [];
  const active = getActiveBatteries();
  const out: BatterySystem[] = [];
  for (const b of active) {
    if (b.ecosystemBrand && tokens.includes(b.ecosystemBrand)) {
      out.push(b);
    }
  }
  return out;
}

// ─── Schema / plausibility checks ─────────────────────────────────────

const REQUIRED_BATTERY_FIELDS: ReadonlyArray<keyof BatterySystem> = [
  'id',
  'manufacturer',
  'model',
  'category',
  'subcategory',
  'usableCapacityKwh',
  'peakPowerKw',
  'continuousPowerKw',
  'roundTripEfficiencyPct',
  'chemistry',
  'voltageNominalV',
  'warrantyYears',
  'ulListing',
] as const;

/**
 * Validate required fields are present and typed correctly.
 * Returns a list of violation strings; empty = pass.
 */
export function validateBatteryFields(b: BatterySystem): string[] {
  const violations: string[] = [];
  for (const field of REQUIRED_BATTERY_FIELDS) {
    const v = b[field];
    if (v === undefined || v === null || v === '') {
      violations.push(`${b.id}: missing required field '${String(field)}'`);
    }
  }
  // Type-specific checks
  if (typeof b.usableCapacityKwh !== 'number' || b.usableCapacityKwh <= 0) {
    violations.push(`${b.id}: usableCapacityKwh must be a positive number`);
  }
  if (typeof b.voltageNominalV !== 'number' || b.voltageNominalV <= 0) {
    violations.push(`${b.id}: voltageNominalV must be a positive number`);
  }
  if (typeof b.warrantyYears !== 'number' || b.warrantyYears < 0) {
    violations.push(`${b.id}: warrantyYears must be a non-negative number`);
  }
  return violations;
}

/**
 * Plausibility checks — catches hallucinated / misordered specs.
 * usableCapacityKwh in [1, 100]
 * continuousPowerKw in [0.5, 30]
 * peakPowerKw >= continuousPowerKw
 * voltageNominalV in [40, 500]
 * roundTripEfficiencyPct in [80, 100]
 */
export function validateBatteryPlausibility(b: BatterySystem): string[] {
  const violations: string[] = [];
  if (b.usableCapacityKwh < 1 || b.usableCapacityKwh > 100) {
    violations.push(`${b.id}: usableCapacityKwh=${b.usableCapacityKwh} outside [1,100] range`);
  }
  if (b.continuousPowerKw < 0.5 || b.continuousPowerKw > 30) {
    violations.push(`${b.id}: continuousPowerKw=${b.continuousPowerKw} outside [0.5,30] range`);
  }
  if (b.peakPowerKw < b.continuousPowerKw) {
    violations.push(
      `${b.id}: peakPowerKw=${b.peakPowerKw} < continuousPowerKw=${b.continuousPowerKw} (peak must be ≥ continuous)`,
    );
  }
  if (b.voltageNominalV < 40 || b.voltageNominalV > 500) {
    violations.push(`${b.id}: voltageNominalV=${b.voltageNominalV} outside [40,500] range`);
  }
  if (b.roundTripEfficiencyPct < 80 || b.roundTripEfficiencyPct > 100) {
    violations.push(
      `${b.id}: roundTripEfficiencyPct=${b.roundTripEfficiencyPct} outside [80,100] range`,
    );
  }
  return violations;
}

/**
 * Chemistry allowlist — every battery must use an approved chemistry.
 */
const APPROVED_CHEMISTRIES: ReadonlySet<string> = new Set([
  'LFP',
  'LiFePO4',
  'NMC',
  'Li-ion',
  'LTO',
]);

export function validateBatteryChemistry(b: BatterySystem): string[] {
  const violations: string[] = [];
  if (!APPROVED_CHEMISTRIES.has(b.chemistry)) {
    violations.push(
      `${b.id}: chemistry='${b.chemistry}' not in approved allowlist ` +
        `[${Array.from(APPROVED_CHEMISTRIES).join(', ')}]`,
    );
  }
  return violations;
}

/**
 * Warranty / longevity minimums — every battery should offer ≥5yr
 * warranty and ≥50% capacity retention.
 */
export function validateBatteryWarranty(b: BatterySystem): string[] {
  const violations: string[] = [];
  if (b.warrantyYears < 5) {
    violations.push(`${b.id}: warrantyYears=${b.warrantyYears} below minimum of 5`);
  }
  if (typeof b.capacityRetentionPct === 'number' && b.capacityRetentionPct < 50) {
    violations.push(
      `${b.id}: capacityRetentionPct=${b.capacityRetentionPct} below minimum of 50`,
    );
  }
  return violations;
}