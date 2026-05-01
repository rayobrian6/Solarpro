// ============================================================================
// lib/system/brandCapabilities/index.ts — Phase 2
//
// Barrel export for all brand CapabilityProfiles.
//
// USAGE:
//   import { getCapabilityProfilesForBrand, ALL_CAPABILITY_PROFILES }
//     from 'lib/system/brandCapabilities';
//
// The layout solver uses getCapabilityProfilesForBrand(brandId) to get
// the correct profile set for a given brand, or ALL_CAPABILITY_PROFILES
// when brand-agnostic evaluation is needed.
// ============================================================================

export { SOLAREDGE_CAPABILITY_PROFILES, SE_3800H, SE_6000H, SE_7600H, SE_10000H, SE_11400H }
  from './solarEdge';
export { ENPHASE_CAPABILITY_PROFILES, ENPHASE_IQ8PLUS, ENPHASE_IQ8M, ENPHASE_IQ8H, ENPHASE_IQ8A, ENPHASE_IQ8AC }
  from './enphase';
export { SMA_CAPABILITY_PROFILES, SMA_SB_5_0, SMA_SB_7_7, SMA_SB_10_0 }
  from './sma';
export { FRONIUS_CAPABILITY_PROFILES, FRONIUS_PRIMO_5_0, FRONIUS_PRIMO_7_6, FRONIUS_PRIMO_8_2, FRONIUS_PRIMO_10_0 }
  from './fronius';
export { GENERIC_STRING_CAPABILITY_PROFILES, GENERIC_SE_7600H, GENERIC_SE_10000H }
  from './genericString';

import { SOLAREDGE_CAPABILITY_PROFILES } from './solarEdge';
import { ENPHASE_CAPABILITY_PROFILES } from './enphase';
import { SMA_CAPABILITY_PROFILES } from './sma';
import { FRONIUS_CAPABILITY_PROFILES } from './fronius';
import { GENERIC_STRING_CAPABILITY_PROFILES } from './genericString';
import type { CapabilityProfile } from '../inverterCapabilities';

// ─── Profile Registry ────────────────────────────────────────────────────────

/**
 * Map of brand id → CapabilityProfile[].
 * Add new brands here as they are onboarded.
 */
const BRAND_PROFILE_REGISTRY: Map<string, CapabilityProfile[]> = new Map([
  ['solaredge',      SOLAREDGE_CAPABILITY_PROFILES],
  ['enphase',        ENPHASE_CAPABILITY_PROFILES],
  ['sma',            SMA_CAPABILITY_PROFILES],
  ['fronius',        FRONIUS_CAPABILITY_PROFILES],
  ['generic-string', GENERIC_STRING_CAPABILITY_PROFILES],
]);

/**
 * All registered CapabilityProfiles across all brands.
 * Concatenated in brand-id alphabetical order for deterministic ordering.
 */
export const ALL_CAPABILITY_PROFILES: CapabilityProfile[] = [
  ...ENPHASE_CAPABILITY_PROFILES,
  ...FRONIUS_CAPABILITY_PROFILES,
  ...GENERIC_STRING_CAPABILITY_PROFILES,
  ...SMA_CAPABILITY_PROFILES,
  ...SOLAREDGE_CAPABILITY_PROFILES,
];

// ─── Lookup helpers ──────────────────────────────────────────────────────────

/**
 * Get all CapabilityProfiles for a given brand id.
 * Returns empty array if brand is not registered.
 *
 * @param brandId - Brand slug (e.g. 'solaredge', 'enphase', 'fronius').
 */
export function getCapabilityProfilesForBrand(brandId: string): CapabilityProfile[] {
  return BRAND_PROFILE_REGISTRY.get(brandId) ?? [];
}

/**
 * Get a single CapabilityProfile by equipment-db id.
 * Searches all registered brands.
 * Returns undefined if not found.
 *
 * @param equipmentDbId - Equipment-db canonical id (e.g. 'se-11400h').
 */
export function getCapabilityProfileById(
  equipmentDbId: string,
): CapabilityProfile | undefined {
  return ALL_CAPABILITY_PROFILES.find(p => p.equipmentDbId === equipmentDbId);
}

/**
 * Get all CapabilityProfiles for a given topology.
 * Useful when the layout solver needs to enumerate all optimizer profiles,
 * all micro profiles, etc.
 *
 * @param topology - InverterTopology discriminant.
 */
export function getCapabilityProfilesByTopology(
  topology: CapabilityProfile['topology'],
): CapabilityProfile[] {
  return ALL_CAPABILITY_PROFILES.filter(p => p.topology === topology);
}

/**
 * All registered brand ids.
 */
export function getRegisteredBrandIds(): string[] {
  return Array.from(BRAND_PROFILE_REGISTRY.keys()).sort();
}