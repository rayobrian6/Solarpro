// ════════════════════════════════════════════════════════════════════
// Brand Profile Registry — public API
// lib/system/brandProfiles/index.ts
//
// Single source of truth for all brand profiles. Add new brands here.
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile, TopologyFamily } from './types';
import type { SystemType } from '../systemDefinition';
import { ECOFLOW_PROFILE }        from './ecoflow';
import { ENPHASE_PROFILE }        from './enphase';
import { FRONIUS_PROFILE }        from './fronius';
import { SOLAREDGE_PROFILE }      from './solaredge';
import { SUNGROW_PROFILE }        from './sungrow';
import { SMA_PROFILE }            from './sma';
import { GOODWE_PROFILE }         from './goodwe';
import { APSYSTEMS_PROFILE }      from './apsystems';
import { HOYMILES_PROFILE }       from './hoymiles';
import { SOL_ARK_PROFILE }        from './sol-ark';
import { GROWATT_PROFILE }        from './growatt';
import { SOLIS_PROFILE }          from './solis';
import { TESLA_PROFILE }          from './tesla';
import { TIGO_PROFILE }           from './tigo';
import { GENERIC_STRING_PROFILE } from './generic-string';

// ─── Registry (ordered — first match wins for recommendedFor) ──────
export const BRAND_PROFILES: ReadonlyArray<BrandProfile> = [
  ECOFLOW_PROFILE,
  ENPHASE_PROFILE,
  FRONIUS_PROFILE,
  SOLAREDGE_PROFILE,
  SUNGROW_PROFILE,
  SMA_PROFILE,
  GOODWE_PROFILE,
  APSYSTEMS_PROFILE,
  HOYMILES_PROFILE,
  SOL_ARK_PROFILE,
  GROWATT_PROFILE,
  SOLIS_PROFILE,
  TESLA_PROFILE,
  TIGO_PROFILE,
  GENERIC_STRING_PROFILE,
];

// ─── Lookup helpers ────────────────────────────────────────────────

/** Find a brand profile by its id. */
export function getBrandProfile(id: string | undefined | null): BrandProfile | undefined {
  if (!id) return undefined;
  const norm = id.toLowerCase().trim();
  return BRAND_PROFILES.find(p => p.id === norm);
}

/** Find a brand profile by its manufacturer name (matches equipment-db manufacturer field). */
export function getBrandProfileByManufacturer(mfr: string | undefined | null): BrandProfile | undefined {
  if (!mfr) return undefined;
  const norm = mfr.toLowerCase().trim();
  return BRAND_PROFILES.find(p => p.manufacturer.toLowerCase() === norm);
}

/**
 * Infer the brand profile from an equipment-db inverter id.
 * Returns undefined if the id isn't mapped to any known brand.
 */
export function getBrandProfileByInverterId(invId: string | undefined | null): BrandProfile | undefined {
  if (!invId) return undefined;
  const norm = invId.toLowerCase().trim();
  for (const profile of BRAND_PROFILES) {
    if (profile.supportedInverterModels.some(m => m.equipmentDbId === norm)) {
      return profile;
    }
  }
  return undefined;
}

/**
 * Get the RECOMMENDED brand profile for a given system type.
 * SolFence → EcoFlow. Roof → Enphase (micro is typical). Ground → generic string.
 * Returns undefined if no brand explicitly recommends itself for that system.
 */
export function getRecommendedBrandForSystem(sysType: SystemType): BrandProfile | undefined {
  return BRAND_PROFILES.find(p => p.recommendedFor.includes(sysType));
}

/** List all brand profiles that support a given system type. */
export function getBrandProfilesForSystemType(sysType: SystemType): BrandProfile[] {
  return BRAND_PROFILES.filter(p => p.supportedSystemTypes.includes(sysType));
}

/** List all brand profiles with a given topology family. */
export function getBrandProfilesByTopology(topo: TopologyFamily): BrandProfile[] {
  return BRAND_PROFILES.filter(p => p.topology === topo);
}

// ─── Re-exports ────────────────────────────────────────────────────
export type {
  BrandProfile,
  BrandInverterModelRef,
  BrandBatterySupport,
  RequiredBOSFamily,
  BrandCompatibilityConstraint,
  InverterSizingTier,
  TopologyFamily,
} from './types';

export {
  ECOFLOW_PROFILE,
  ENPHASE_PROFILE,
  FRONIUS_PROFILE,
  SOLAREDGE_PROFILE,
  SUNGROW_PROFILE,
  SMA_PROFILE,
  GOODWE_PROFILE,
  APSYSTEMS_PROFILE,
  HOYMILES_PROFILE,
  SOL_ARK_PROFILE,
  GROWATT_PROFILE,
  SOLIS_PROFILE,
  TESLA_PROFILE,
  TIGO_PROFILE,
  GENERIC_STRING_PROFILE,
};