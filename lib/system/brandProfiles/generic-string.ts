// ════════════════════════════════════════════════════════════════════
// Generic String Brand Profile
// lib/system/brandProfiles/generic-string.ts
//
// Fallback profile for string-inverter systems when the user hasn't
// selected a specific brand. Uses SolarEdge HD-Wave as the default
// equipment-db reference (most common in the existing catalog).
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const GENERIC_STRING_PROFILE: BrandProfile = {
  id: 'generic-string',
  displayName: 'Generic String Inverter',
  manufacturer: 'Generic',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // v47.433 Stage 8.4: drift fix — mpptCount aligned to registry (1 per HD-Wave single-MPPT topology).
    //   Was 2 (stale catch-all since legacy generic-string fallback); registry is the canonical source.
    //   The dedicated solaredge.ts profile already specifies mpptCount: 1 for these SKUs.
    // maxPanelsPerString aligned to the registry recommendedStringRange.max (13)
    // and maxParallelStringsPerMppt set explicitly (registry se-7600h = 2), so
    // this fallback no longer relies on the engine default (audit finding 6 + 2).
    { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 15, maxParallelStringsPerMppt: 3 },
  ],

  sizingTiers: [
    { minDcKw: 0,  maxDcKw: 9,        equipmentDbId: 'se-7600h'  },
    { minDcKw: 9,  maxDcKw: Infinity, equipmentDbId: 'se-10000h' },
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
      note: 'Per-module rapid shutdown for NEC 690.12.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro', 'hybrid'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
  },

  recommendedFor: [],

  notes:
    'Generic string-inverter fallback profile. Specific brands (Fronius, SolarEdge) ' +
    'should use their dedicated profile. Used when only a generic topology is specified.',
};