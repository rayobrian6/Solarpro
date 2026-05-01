// ════════════════════════════════════════════════════════════════════════
// SMA Brand Profile
// lib/system/brandProfiles/sma.ts
//
// SMA Sunny Boy — transformerless string inverters.
// 2 MPPT channels, 15A max per MPPT, 600V max DC.
// maxParallelStringsPerMppt: 1 — SMA Sunny Boy residential models
// support one string per MPPT input for standard residential installs.
// ════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const SMA_PROFILE: BrandProfile = {
  id: 'sma',
  displayName: 'SMA Sunny Boy',
  manufacturer: 'SMA',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // SB 5.0-US: 2 MPPT, 1 string/MPPT, 10A max/MPPT
    // Source: SMA Sunny Boy US-41 official datasheet
    { equipmentDbId: 'sma-sb-5.0',  acKw: 5.0,  dcKwMax: 7.5,   mpptCount: 2, minPanelsPerString: 5, maxPanelsPerString: 11, maxParallelStringsPerMppt: 1 },
    // SB 6.0-US: 2 MPPT, 1 string/MPPT, 10A max/MPPT
    // Source: SMA Sunny Boy US-41 official datasheet
    { equipmentDbId: 'sma-sb-6.0',  acKw: 6.0,  dcKwMax: 9.0,   mpptCount: 2, minPanelsPerString: 5, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    // SB 7.7-US: 3 MPPT, 1 string/MPPT, 10A max/MPPT
    // Source: SMA Sunny Boy US-41 official datasheet (SB 6.0/7.0/7.7 have 3 MPPT trackers)
    { equipmentDbId: 'sma-sb-7.7',  acKw: 7.7,  dcKwMax: 11.55, mpptCount: 3, minPanelsPerString: 6, maxPanelsPerString: 14, maxParallelStringsPerMppt: 1 },
    // SB 10000TL-US: LEGACY ONLY — discontinued product, 6-string combiner box
    // Kept for backward compatibility with older projects. NOT used in auto-sizing tiers.
    // maxParallelStringsPerMppt: 1 INTENTIONALLY overrides equipment-db value of 6.
    // Rationale: equipment-db reflects hardware maximum (6 strings via external combiner box).
    // Brand profile caps at 1 to prevent the sizing engine from generating absurdly short
    // strings. Enforcing parallel=1 ensures each MPPT gets exactly one long string, which
    // is the standard NEC-compliant design practice for this legacy discontinued unit.
    // overridesEquipmentDb: true — drift-guard intentional override, reviewed 2026-04-26.
    { equipmentDbId: 'sma-sb-10.0', acKw: 10.0, dcKwMax: 15.0,  mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 16, maxParallelStringsPerMppt: 1, overridesEquipmentDb: true },
  ],

  sizingTiers: [
    // SMA residential Sunny Boy US current product line caps at 7.7 kW single-phase.
    // The SB 10.0 TL-US is discontinued; not suitable for new residential designs.
    { minDcKw: 0,  maxDcKw: 6,        equipmentDbId: 'sma-sb-5.0' },
    { minDcKw: 6,  maxDcKw: 8,        equipmentDbId: 'sma-sb-6.0' },
    { minDcKw: 8,  maxDcKw: Infinity, equipmentDbId: 'sma-sb-7.7' },
  ],

  battery: {
    capable: false,
    required: false,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect ahead of string inverter.' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter and service.' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Per-module RSD device for NEC 690.12 compliance.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro', 'hybrid'],
    incompatibleBrands: ['enphase', 'ecoflow'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 15.0,
  },

  recommendedFor: [],

  // v47.429 — Stage 6: SMA's Sunny Boy installer network standardizes on
  // IronRidge/Unirac in North America; K2 Systems is the legacy EU partner
  // that appears in SMA's global certified-racking lists.
  recommendedRackingBrands: ['ironridge', 'unirac', 'k2-systems'],

  notes:
    'SMA Sunny Boy is a transformerless string inverter with 2 MPPT inputs. ' +
    'Per-module rapid shutdown devices required for NEC 690.12. ' +
    'No native battery support — use SMA Sunny Boy Storage for storage applications.',
};