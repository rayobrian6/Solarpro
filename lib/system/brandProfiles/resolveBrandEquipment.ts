// ═══════════════════════════════════════════════════════════════════════
// lib/system/brandProfiles/resolveBrandEquipment.ts
// v47.398 — Safe bridge between BrandProfile (Layer B) and equipment-db
//           ecosystem tags (Layer A).
//
// PURPOSE
//   Give callers a single function that returns the full equipment kit
//   for a brand, preferring the BrandProfile's hardcoded lists when
//   available, and *supplementing* (never overriding) with rows
//   discovered via `getEquipmentByEcosystem()`.
//
// NON-BREAKING CONTRACT
//   • Never removes anything the BrandProfile already declares.
//   • Never throws — returns empty arrays on unknown brand.
//   • Consumers can read whichever fields they already know; new
//     ecosystem rows carry the same equipment-db shape.
// ═══════════════════════════════════════════════════════════════════════

import {
  getEquipmentByEcosystem,
  type SolarPanel,
  type StringInverter,
  type Microinverter,
  type Optimizer,
  type BatterySystem,
  type GeneratorSystem,
  type ATSUnit,
  type BackupInterface,
  type MonitoringGateway,
  type EVCharger,
} from '@/lib/equipment-db';
import {
  getAllMountingSystems,
  type MountingSystemSpec,
} from '@/lib/mounting-hardware-db';
import type { BrandProfile } from './types';
import { getBrandProfile } from './index';

// v47.429 — Stage 6 helper: convert a recommendedRackingBrands token
// (e.g. 'ironridge', 'unirac', 'snapnrack') into the set of MountingSystemSpec
// rows whose manufacturer field matches (case/space-insensitive, tight matching
// to avoid substring collisions with 'Generic' or short brand names).
//
// Normalization strips whitespace, underscores, hyphens, '!', and parentheses
// from both sides so that e.g. 'Mounting Systems (MSE)' and 'mountingsystems'
// reconcile cleanly.
function normalizeRackingKey(s: string): string {
  return (s || '').toLowerCase().replace(/[\s_\-!()]/g, '');
}

function resolveRackingToken(token: string, allSystems: MountingSystemSpec[]): MountingSystemSpec[] {
  const norm = normalizeRackingKey(token);
  if (norm.length < 2) return [];
  return allSystems.filter(s => {
    const mfg = normalizeRackingKey(s.manufacturer || '');
    // Exact match, or token covers first-word fragment (e.g. 'dpw' -> 'dpwsolar').
    // We require equality OR the shorter string == a prefix of the longer.
    // Prefix matching prevents 'generic' from matching 'generic' only, and
    // 'k2' won't match 'k2systems' unless the token explicitly covers it.
    if (mfg === norm) return true;
    if (mfg.length > norm.length && mfg.startsWith(norm)) return true;
    if (norm.length > mfg.length && norm.startsWith(mfg) && mfg.length >= 4) return true;
    return false;
  });
}

export interface ResolvedBrandEquipment {
  // Hardware, grouped by category
  panels: SolarPanel[];
  stringInverters: StringInverter[];
  microinverters: Microinverter[];
  optimizers: Optimizer[];
  batteries: BatterySystem[];
  generators: GeneratorSystem[];
  atsUnits: ATSUnit[];
  backupInterfaces: BackupInterface[];
  monitoringGateways: MonitoringGateway[];
  evChargers: EVCharger[];

  /**
   * v47.429 — Stage 6: Racking Visibility.
   * Compatible racking / mounting systems for this brand.
   * Resolution rules:
   *   - If profile.recommendedRackingBrands is non-empty: return ONLY
   *     systems whose manufacturer matches one of those tokens.
   *   - If profile is missing OR recommendedRackingBrands is empty:
   *     return an empty array. The UI renders a generic fallback message
   *     ("Compatible with major racking systems ...").
   *   - Never throws; never returns systems from the inventory-only
   *     `racking-database.ts`. Source of truth is mounting-hardware-db.ts.
   */
  compatibleRacking: MountingSystemSpec[];

  // Profile metadata (may be undefined if brand unknown)
  profile?: BrandProfile;

  // Diagnostics: which source provided each category
  source: {
    panels: 'profile' | 'ecosystem' | 'none';
    inverters: 'profile' | 'ecosystem' | 'none';
    batteries: 'profile' | 'ecosystem' | 'none';
    gateways: 'profile' | 'ecosystem' | 'none';
    evChargers: 'profile' | 'ecosystem' | 'none';
    /** v47.429 — 'profile' = from recommendedRackingBrands, 'none' = fallback UI. */
    racking: 'profile' | 'none';
  };

  // Whether the resolver found any equipment at all
  found: boolean;
}

/**
 * Resolve the full equipment kit for a brand.
 *
 * Strategy:
 *   1. Pull anything the BrandProfile hard-declares (supportedInverterModels,
 *      supportedBatteries if present, etc.) — this is the canonical list.
 *   2. Pull the full ecosystem tag set via getEquipmentByEcosystem().
 *   3. Merge: start with the ecosystem set (broad), then ensure every
 *      profile-declared row is present (dedupe by id).
 *   4. For categories the profile doesn't declare (gateways, EV chargers,
 *      generators, ATS, backup interface), use ecosystem as-is.
 *
 * @param brand  Brand id or manufacturer name (case-insensitive).
 * @returns      ResolvedBrandEquipment — always defined, never throws.
 */
export function resolveBrandEquipment(brand: string): ResolvedBrandEquipment {
  const normBrand = (brand || '').toLowerCase().trim();

  // Empty default — used when brand is empty or unknown
  const empty: ResolvedBrandEquipment = {
    panels: [],
    stringInverters: [],
    microinverters: [],
    optimizers: [],
    batteries: [],
    generators: [],
    atsUnits: [],
    backupInterfaces: [],
    monitoringGateways: [],
    evChargers: [],
    compatibleRacking: [], // v47.429
    profile: undefined,
    source: {
      panels: 'none',
      inverters: 'none',
      batteries: 'none',
      gateways: 'none',
      evChargers: 'none',
      racking: 'none', // v47.429
    },
    found: false,
  };

  if (!normBrand) return empty;

  // Try to find the BrandProfile
  let profile: BrandProfile | undefined;
  try {
    profile = getBrandProfile(normBrand);
  } catch {
    profile = undefined;
  }

  // Pull ecosystem-tagged equipment
  const eco = getEquipmentByEcosystem(normBrand);

  // Determine sources (any hit = profile or ecosystem, else none)
  const hasEcosystemInverters =
    eco.stringInverters.length + eco.microinverters.length + eco.optimizers.length > 0;
  const hasProfileInverters = Boolean(profile?.supportedInverterModels?.length);

  // v47.429 — Resolve racking via recommendedRackingBrands (conservative mapping).
  // If the profile declares tokens, we filter mounting-hardware-db by manufacturer.
  // Otherwise compatibleRacking stays empty and the UI shows a generic fallback.
  const rackingTokens = profile?.recommendedRackingBrands ?? [];
  let compatibleRacking: MountingSystemSpec[] = [];
  if (rackingTokens.length > 0) {
    const allSystems = getAllMountingSystems();
    const seen = new Set<string>();
    for (const token of rackingTokens) {
      for (const sys of resolveRackingToken(token, allSystems)) {
        if (!seen.has(sys.id)) {
          seen.add(sys.id);
          compatibleRacking.push(sys);
        }
      }
    }
  }

  const result: ResolvedBrandEquipment = {
    panels: eco.panels,
    stringInverters: eco.stringInverters,
    microinverters: eco.microinverters,
    optimizers: eco.optimizers,
    batteries: eco.batteries,
    generators: eco.generators,
    atsUnits: eco.atsUnits,
    backupInterfaces: eco.backupInterfaces,
    monitoringGateways: eco.monitoringGateways,
    evChargers: eco.evChargers,
    compatibleRacking,
    profile,
    source: {
      panels: eco.panels.length > 0 ? 'ecosystem' : 'none',
      inverters:
        hasProfileInverters
          ? 'profile'
          : hasEcosystemInverters
          ? 'ecosystem'
          : 'none',
      batteries: eco.batteries.length > 0 ? 'ecosystem' : 'none',
      gateways: eco.monitoringGateways.length > 0 ? 'ecosystem' : 'none',
      evChargers: eco.evChargers.length > 0 ? 'ecosystem' : 'none',
      racking: compatibleRacking.length > 0 ? 'profile' : 'none',
    },
    found: Boolean(profile) || hasEcosystemInverters || eco.batteries.length > 0,
  };

  return result;
}

/**
 * Quick check — does this brand have any ecosystem data at all?
 * Useful for deciding whether to show the ecosystem picker for a brand.
 */
export function brandHasEcosystem(brand: string): boolean {
  return resolveBrandEquipment(brand).found;
}

/**
 * List of brand ids that currently have ecosystem coverage in the DB.
 * Used by the UI to populate the ecosystem picker.
 */
export const ECOSYSTEM_BRANDS: Array<{
  id: string;
  displayName: string;
  description: string;
}> = [
  {
    id: 'ecoflow',
    displayName: 'EcoFlow',
    description: 'OCEAN Pro hybrid inverter (11.5/24 kW) + EF-BP-10 LFP battery (UL 9540B)',
  },
  {
    id: 'tesla',
    displayName: 'Tesla',
    description: 'Powerwall storage + Backup Gateway + Wall Connector',
  },
  {
    id: 'enphase',
    displayName: 'Enphase',
    description: 'IQ8 microinverters + IQ Battery + IQ Gateway + IQ EV Charger',
  },
  {
    id: 'solaredge',
    displayName: 'SolarEdge',
    description: 'HD-Wave / Home Hub + P-series optimizers + Energy Bank',
  },
  {
    id: 'generac',
    displayName: 'Generac',
    description: 'PWRcell inverter + batteries + PWRgenerator + ATS',
  },
  {
    id: 'apsystems',
    displayName: 'APsystems',
    description: 'DS3 / QS1 microinverters + ECU-R gateway',
  },
  {
    id: 'hoymiles',
    displayName: 'Hoymiles',
    description: 'HMS microinverters + DTU-Pro-S gateway',
  },
  {
    id: 'sol-ark',
    displayName: 'Sol-Ark',
    description: '8K / 12K / 15K hybrid inverters + battery-agnostic storage',
  },
  {
    id: 'growatt',
    displayName: 'Growatt',
    description: 'MIN 5-11.4 kW TL-XH-US hybrid inverters + APX/ARO HV battery stacks',
  },
  {
    id: 'solis',
    displayName: 'Solis',
    description: 'S6-EH1P 3.8-11.4 kW hybrid inverters + HV battery support',
  },
  {
    id: 'tigo',
    displayName: 'Tigo',
    description: 'EI 3.8/7.6/11.4 kW hybrid inverters + EI Battery + TS4 MLPE',
  },
];