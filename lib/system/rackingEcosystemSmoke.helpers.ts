/**
 * v47.429 — Racking Ecosystem Smoke Suite Helpers (Stage 6)
 *
 * Shared fixtures and utilities for the racking ecosystem smoke test
 * suite. Parallels batteryEcosystemSmoke.helpers.ts but operates on
 * mounting-hardware-db.ts + BrandProfile.recommendedRackingBrands.
 *
 * Design principles:
 *   - Zero per-system code. Every helper derives behavior from the registry.
 *   - Pure functions. No module-level side effects.
 *   - Exhaustive. Every helper exercises a real invariant.
 *
 * Scope note: this suite is scoped to the UI-canonical mounting-hardware-db.ts
 * (42 systems). lib/racking-database.ts (12 systems) has its own separate
 * audit lock in lib/racking-database.test.ts — consolidation is Stage 7/8.
 */
import {
  getAllMountingSystems,
  type MountingSystemSpec,
} from '../mounting-hardware-db';
import { BRAND_PROFILES, type BrandProfile } from './brandProfiles';

// ─── Registry discovery ──────────────────────────────────────────

/** All mounting systems from the UI-canonical DB. */
export function getAllRackingSystems(): MountingSystemSpec[] {
  return getAllMountingSystems();
}

/** Distinct manufacturer names, sorted alphabetically. */
export function getRackingManufacturers(): string[] {
  const set = new Set<string>();
  for (const sys of getAllRackingSystems()) {
    if (sys.manufacturer) set.add(sys.manufacturer);
  }
  return Array.from(set).sort();
}

/**
 * Normalize a manufacturer or token string for comparison —
 * same rules as resolveRackingToken in resolveBrandEquipment.ts.
 * Strips whitespace, underscore, hyphen, '!', and parentheses.
 */
export function normalizeRackingKey(s: string): string {
  return (s || '').toLowerCase().replace(/[\s_\-!()]/g, '');
}

/**
 * Find mounting systems that match a recommendedRackingBrands token.
 * Mirrors the resolver's matcher so smoke tests use the identical logic
 * the UI relies on.
 */
export function resolveRackingToken(
  token: string,
  allSystems: MountingSystemSpec[] = getAllRackingSystems(),
): MountingSystemSpec[] {
  const norm = normalizeRackingKey(token);
  if (norm.length < 2) return [];
  return allSystems.filter(s => {
    const mfg = normalizeRackingKey(s.manufacturer || '');
    if (mfg === norm) return true;
    if (mfg.length > norm.length && mfg.startsWith(norm)) return true;
    if (norm.length > mfg.length && norm.startsWith(mfg) && mfg.length >= 4) return true;
    return false;
  });
}

// ─── BrandProfile ↔ Racking recommendation linkage ───────────────

/**
 * Every BrandProfile that declares a non-empty recommendedRackingBrands list.
 * These are the profiles whose recommendations we enforce actually resolve
 * to real manufacturers in the UI-canonical DB.
 */
export function getRackingCapableProfiles(): BrandProfile[] {
  return BRAND_PROFILES.filter(
    p => (p.recommendedRackingBrands?.length ?? 0) > 0,
  );
}

/**
 * Given a profile, return the union of mounting systems that resolve
 * from its recommendedRackingBrands tokens. Empty = dangling recommendation.
 */
export function resolveRecommendedRacking(profile: BrandProfile): MountingSystemSpec[] {
  const tokens = profile.recommendedRackingBrands ?? [];
  const all = getAllRackingSystems();
  const seen = new Set<string>();
  const out: MountingSystemSpec[] = [];
  for (const token of tokens) {
    for (const sys of resolveRackingToken(token, all)) {
      if (!seen.has(sys.id)) {
        seen.add(sys.id);
        out.push(sys);
      }
    }
  }
  return out;
}

// ─── Schema / plausibility checks ────────────────────────────────

const REQUIRED_RACKING_FIELDS: ReadonlyArray<keyof MountingSystemSpec> = [
  'id',
  'manufacturer',
  'productLine',
  'model',
  'category',
  'systemType',
  'compatibleRoofTypes',
  'description',
  'mount',
  'hardware',
  'maxWindSpeedMph',
  'maxSnowLoadPsf',
  'maxRoofPitchDeg',
  'minRoofPitchDeg',
  'ul2703Listed',
  'engineeringDataSource',
  'lastUpdated',
] as const;

/**
 * Required-field presence + basic type sanity.
 * Returns violation strings; empty = pass.
 */
export function validateRackingFields(s: MountingSystemSpec): string[] {
  const violations: string[] = [];
  for (const field of REQUIRED_RACKING_FIELDS) {
    const v = s[field];
    if (v === undefined || v === null || v === '') {
      violations.push(`${s.id}: missing required field '${String(field)}'`);
    }
  }
  if (!Array.isArray(s.compatibleRoofTypes) || s.compatibleRoofTypes.length === 0) {
    violations.push(`${s.id}: compatibleRoofTypes must be a non-empty array`);
  }
  if (typeof s.ul2703Listed !== 'boolean') {
    violations.push(`${s.id}: ul2703Listed must be a boolean`);
  }
  return violations;
}

/**
 * System type classification for plausibility-check purposes.
 * Roof-mount systems MUST have maxRoofPitchDeg > 0. Ground-mount,
 * ballasted, and tracker systems legitimately use 0 because they
 * don't sit on a pitched surface.
 */
function isRoofSystem(s: MountingSystemSpec): boolean {
  const roofKinds = new Set([
    'pitched_roof',
    'flat_roof',
    'metal_roof',
    'tile_roof',
    'shingle_roof',
    'rail_based',
    'rail_less',
  ]);
  // systemType may be 'ground_mount' | 'ballasted' | 'tracker' | 'rail_based' | 'rail_less'
  // etc. Anything that isn't obviously a non-roof system, treat as roof.
  const t = String(s.systemType || '').toLowerCase();
  if (t.includes('ground') || t.includes('ballast') || t.includes('tracker')) return false;
  return roofKinds.has(t) || s.compatibleRoofTypes?.length > 0;
}

/**
 * Plausibility — catches hallucinated / misordered specs.
 *   maxWindSpeedMph in [70, 250]        (residential design wind range)
 *   maxSnowLoadPsf  in [0, 200]         (0 = flat-roof commercial, up to heavy NE snow)
 *   For roof systems:
 *     maxRoofPitchDeg in (0, 90]
 *     minRoofPitchDeg in [0, maxRoofPitchDeg]
 *   For non-roof systems (ground / ballasted / tracker):
 *     pitch fields skipped (0 is legitimate)
 *   If rail present: rail.lengthFt in (0, 30]
 */
export function validateRackingPlausibility(s: MountingSystemSpec): string[] {
  const violations: string[] = [];
  if (s.maxWindSpeedMph < 70 || s.maxWindSpeedMph > 250) {
    violations.push(
      `${s.id}: maxWindSpeedMph=${s.maxWindSpeedMph} outside [70,250] range`,
    );
  }
  if (s.maxSnowLoadPsf < 0 || s.maxSnowLoadPsf > 200) {
    violations.push(
      `${s.id}: maxSnowLoadPsf=${s.maxSnowLoadPsf} outside [0,200] range`,
    );
  }
  if (isRoofSystem(s)) {
    if (s.maxRoofPitchDeg <= 0 || s.maxRoofPitchDeg > 90) {
      violations.push(
        `${s.id}: maxRoofPitchDeg=${s.maxRoofPitchDeg} outside (0,90] range (roof system)`,
      );
    }
    if (s.minRoofPitchDeg < 0 || s.minRoofPitchDeg > s.maxRoofPitchDeg) {
      violations.push(
        `${s.id}: minRoofPitchDeg=${s.minRoofPitchDeg} must be in [0, maxRoofPitchDeg=${s.maxRoofPitchDeg}]`,
      );
    }
  }
  if (s.rail) {
    const rail = s.rail as { lengthFt?: number };
    if (typeof rail.lengthFt === 'number' && (rail.lengthFt <= 0 || rail.lengthFt > 30)) {
      violations.push(
        `${s.id}: rail.lengthFt=${rail.lengthFt} outside (0,30] range`,
      );
    }
  }
  return violations;
}