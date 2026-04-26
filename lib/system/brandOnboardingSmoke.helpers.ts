/**
 * v47.425 — Brand Onboarding Smoke Suite Helpers
 *
 * Shared fixtures and utilities for the brand onboarding smoke test suite.
 * This file contains ONLY helpers — the assertions live in
 * brandOnboardingSmoke.test.ts.
 *
 * Design principles:
 *   - Zero per-brand code. Every helper takes a brand id or brand profile
 *     and derives everything it needs from the registry.
 *   - Pure functions only. No module-level side effects.
 *   - Exhaustive. Every helper exercises a real pipeline stage.
 */
import { SOLAR_PANELS, STRING_INVERTERS, type SolarPanel, type StringInverter } from '../equipment-db';
import { BRAND_PROFILES, type BrandProfile } from './brandProfiles';
import { ECOSYSTEM_BRANDS } from './brandProfiles/resolveBrandEquipment';
import {
  getBrandMinMpptCurrent,
  evaluatePanelBrandCompatibility,
} from './panelCompatibilityGate';

// ─── Brand discovery ─────────────────────────────────────────────────────

/**
 * All non-micro brand profiles that have at least one supported inverter
 * model. Micro topology is excluded because its compatibility model is
 * fundamentally different (per-module, not per-MPPT-channel).
 *
 * Also excludes the `generic-string` fallback profile which has no caps.
 */
export function getSmokeTestBrands(): BrandProfile[] {
  return BRAND_PROFILES
    .filter(b => b.topology !== 'micro')
    .filter(b => b.supportedInverterModels.length > 0)
    .filter(b => b.id !== 'generic-string');
}

/**
 * Every brand, micro included, for schema/registry validation.
 */
export function getAllBrands(): BrandProfile[] {
  return [...BRAND_PROFILES];
}

// ─── Panel matrix (spans Isc range) ──────────────────────────────────────

/**
 * Representative panel ids spanning low/mid/high Isc.
 * If any of these disappear from the catalog, the smoke suite will
 * fail loudly because panelById() throws.
 */
export const SMOKE_PANEL_MATRIX = [
  'sp-maxeon3-400',      // Low Isc (~6.58A) — fits every brand
  'pan-evervolt-410',    // Mid-low Isc (10.06A)
  'qcells-peak-duo-400', // Mid Isc (12.26A)
  'silfab-sil430',       // High Isc (13.30A) — trips most strict brands
] as const;

export function panelById(id: string): SolarPanel {
  const p = SOLAR_PANELS.find(x => x.id === id);
  if (!p) {
    throw new Error(
      `[smoke] panel fixture missing: ${id}. ` +
      `If you renamed/removed it, update SMOKE_PANEL_MATRIX.`,
    );
  }
  return p as SolarPanel;
}

export function inverterById(id: string): StringInverter {
  const i = STRING_INVERTERS.find(x => x.id === id);
  if (!i) {
    throw new Error(
      `[smoke] inverter fixture missing: ${id}. ` +
      `A brand's supportedInverterModels references this equipmentDbId ` +
      `but STRING_INVERTERS has no entry.`,
    );
  }
  return i as StringInverter;
}

// ─── Required inverter fields ────────────────────────────────────────────

/**
 * Every field the sizing engine / compliance pipeline reads from an
 * inverter registry entry. If ANY of these is missing or invalid for ANY
 * brand's supportedInverterModels, the smoke suite fails the brand.
 */
export const REQUIRED_INVERTER_FIELDS = [
  'maxInputCurrentPerMppt',
  'mpptChannels',
  'maxParallelStringsPerMppt',
  'maxDcVoltage',
  'mpptVoltageMin',
  'mpptVoltageMax',
  'acOutputKw',
] as const;

export function validateInverterFields(inv: StringInverter): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_INVERTER_FIELDS) {
    const v = (inv as any)[field];
    if (v === undefined || v === null) {
      errors.push(`${inv.id}: missing required field '${field}'`);
    } else if (typeof v !== 'number') {
      errors.push(`${inv.id}: field '${field}' is not a number (got ${typeof v})`);
    } else if (v <= 0) {
      errors.push(`${inv.id}: field '${field}' must be > 0 (got ${v})`);
    }
  }
  return errors;
}

// ─── Sizing tier validation ──────────────────────────────────────────────

/**
 * Sizing tiers must cover 0→Infinity with no gaps and no overlaps.
 * Every tier's equipmentDbId must exist in supportedInverterModels.
 */
export function validateSizingTiers(brand: BrandProfile): string[] {
  const errors: string[] = [];
  const tiers = [...brand.sizingTiers].sort((a, b) => a.minDcKw - b.minDcKw);
  if (tiers.length === 0) {
    errors.push(`${brand.id}: sizingTiers is empty`);
    return errors;
  }
  // Must start at 0
  if (tiers[0].minDcKw !== 0) {
    errors.push(`${brand.id}: first sizing tier must start at 0 kW (got ${tiers[0].minDcKw})`);
  }
  // Must cover Infinity
  const last = tiers[tiers.length - 1];
  if (last.maxDcKw !== Infinity && last.maxDcKw < 1000) {
    errors.push(`${brand.id}: last sizing tier must extend to Infinity (got ${last.maxDcKw})`);
  }
  // No gaps or overlaps
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minDcKw !== tiers[i - 1].maxDcKw) {
      errors.push(
        `${brand.id}: sizing tier gap or overlap between ${tiers[i - 1].maxDcKw}kW ` +
        `and ${tiers[i].minDcKw}kW`,
      );
    }
  }
  // Every tier's inverter must be in supportedInverterModels
  const modelIds = new Set(brand.supportedInverterModels.map(m => m.equipmentDbId));
  for (const tier of tiers) {
    if (!modelIds.has(tier.equipmentDbId)) {
      errors.push(
        `${brand.id}: sizing tier for ${tier.minDcKw}-${tier.maxDcKw}kW ` +
        `references '${tier.equipmentDbId}' which is not in supportedInverterModels`,
      );
    }
  }
  return errors;
}

// ─── Gate validation per brand ───────────────────────────────────────────

/**
 * For every brand, there MUST exist at least one panel in the catalog
 * that is "compatible" (not incompatible and not marginal). Without this
 * invariant, a user selecting that brand and any catalog panel could hit
 * an unresolvable situation.
 *
 * Returns the ids of compatible panels for diagnostics.
 */
export function findCompatiblePanelsInCatalog(brand: BrandProfile): string[] {
  const cap = getBrandMinMpptCurrent(brand);
  if (cap === null) {
    // Brand has no MPPT current constraint — everything is compatible.
    return SOLAR_PANELS.map(p => p.id);
  }
  const compatible: string[] = [];
  for (const panel of SOLAR_PANELS) {
    // Skip fence-specific and any explicitly inactive entries
    if (panel.id === 'panel-fence-ps1') continue;
    if ((panel as any).status === 'inactive') continue;
    if (!panel.isc || panel.isc <= 0) continue;
    const gate = evaluatePanelBrandCompatibility(panel, brand);
    if (gate.status === 'compatible') {
      compatible.push(panel.id);
    }
  }
  return compatible;
}

// ─── Ecosystem registry invariants ───────────────────────────────────────

/**
 * Every ECOSYSTEM_BRANDS entry must have a matching BRAND_PROFILES entry.
 * Returns a list of ecosystem brand ids that have no matching profile.
 */
export function findOrphanEcosystemBrands(): string[] {
  const profileIds = new Set(BRAND_PROFILES.map(p => p.id));
  return ECOSYSTEM_BRANDS
    .filter(e => !profileIds.has(e.id))
    .map(e => e.id);
}

// ─── Topology family validation ──────────────────────────────────────────

export const VALID_TOPOLOGY_FAMILIES = new Set([
  'micro',
  'string',
  'optimizer',
  'hybrid',
]);

// ─── Required schema fields ──────────────────────────────────────────────

export const REQUIRED_BRAND_FIELDS = [
  'id',
  'displayName',
  'manufacturer',
  'supportedSystemTypes',
  'topology',
  'inverterType',
  'supportedInverterModels',
  'sizingTiers',
  'battery',
  'requiredBOSFamilies',
  'compatibility',
  'recommendedFor',
] as const;

export function validateBrandSchema(brand: BrandProfile): string[] {
  const errors: string[] = [];
  for (const field of REQUIRED_BRAND_FIELDS) {
    if ((brand as any)[field] === undefined) {
      errors.push(`${brand.id || '(no id)'}: missing required field '${field}'`);
    }
  }
  if (brand.topology && !VALID_TOPOLOGY_FAMILIES.has(brand.topology)) {
    errors.push(`${brand.id}: topology '${brand.topology}' is not a known family`);
  }
  if (brand.supportedSystemTypes && !Array.isArray(brand.supportedSystemTypes)) {
    errors.push(`${brand.id}: supportedSystemTypes must be an array`);
  }
  return errors;
}