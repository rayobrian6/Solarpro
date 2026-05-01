// ════════════════════════════════════════════════════════════════════════
// APsystems Brand Profile
// lib/system/brandProfiles/apsystems.ts
//
// APsystems DS3/DS3S/DS3L dual-module microinverters and EZ1-M.
// Topology: micro — one device per 1 or 2 panels (modulesPerDevice).
// No DC strings; sizing is per-panel / per-device.
// ════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const APSYSTEMS_PROFILE: BrandProfile = {
  id: 'apsystems',
  displayName: 'APsystems',
  manufacturer: 'APsystems',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'micro',
  inverterType: 'micro',

  supportedInverterModels: [
    // DS3-S: 640W AC, dual-module (2 panels per device), 2 MPPT
    { equipmentDbId: 'apsystems-ds3s', acKw: 0.640, dcKwMax: 0.960, mpptCount: 2, modulesPerDevice: 2 },
    // DS3-L: 730W AC, dual-module (2 panels per device), 2 MPPT (larger version)
    { equipmentDbId: 'apsystems-ds3l', acKw: 0.730, dcKwMax: 1.100, mpptCount: 2, modulesPerDevice: 2 },
    // DS3: 880W AC, dual-module (2 panels per device), 2 MPPT (highest power DS3 variant)
    { equipmentDbId: 'apsystems-ds3',  acKw: 0.880, dcKwMax: 1.320, mpptCount: 2, modulesPerDevice: 2 },
    // EZ1-M: 800W AC, dual-module (2 panels per device), plug-and-play balcony / small systems
    { equipmentDbId: 'apsystems-ez1-m', acKw: 0.800, dcKwMax: 0.960, mpptCount: 2, modulesPerDevice: 2 },
  ],

  // Micro topology: sizing is per-panel, not DC-kW tiers.
  // Default to DS3-S as the mid-range workhorse for residential roof installs.
  sizingTiers: [
    { minDcKw: 0, maxDcKw: Infinity, equipmentDbId: 'apsystems-ds3s' },
  ],

  battery: {
    capable: false,
    required: false,
  },

  requiredBOSFamilies: [
    { category: 'microinverter', qtyPolicy: 'per_module', required: true,
      note: 'One APsystems DS3 device per 2 panels (modulesPerDevice: 2).' },
    { category: 'ac_disconnect', qtyPolicy: 'per_inverter', required: true,
      note: 'AC branch disconnect required per NEC 705.' },
  ],

  compatibility: {
    incompatibleTopologies: ['hybrid'],
    dcAcRatioRange: { min: 1.0, max: 1.55 },
  },

  recommendedFor: [],

  // v47.429 — Stage 6: APsystems micro installers, same standard residential
  // pairings as Enphase (IronRidge / Unirac / SnapNrack).
  recommendedRackingBrands: ['ironridge', 'unirac', 'snapnrack'],

  notes:
    'APsystems DS3 series — dual-module microinverters, 2 panels per device. ' +
    'DS3-S / DS3-L / DS3 differ by output power tier. ' +
    'EZ1-M is a plug-and-play variant for smaller/balcony systems. ' +
    'All comply with UL 1741-SA / CA Rule 21 for grid-tied residential use.',
};