// ════════════════════════════════════════════════════════════════════════
// Hoymiles Brand Profile
// lib/system/brandProfiles/hoymiles.ts
//
// Hoymiles HM-800 (single-phase dual-module) and HMS-800W-2T (MLPE).
// Topology: micro — one device per 2 panels (modulesPerDevice: 2).
// No DC strings; sizing is per-panel / per-device.
// ════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const HOYMILES_PROFILE: BrandProfile = {
  id: 'hoymiles',
  displayName: 'Hoymiles',
  manufacturer: 'Hoymiles',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'micro',
  inverterType: 'micro',

  supportedInverterModels: [
    // HM-800: 800W AC, dual-module (2 panels per device), UL 1741 / IEEE 1547
    { equipmentDbId: 'hoymiles-hm800',       acKw: 0.800, dcKwMax: 0.960, mpptCount: 2, modulesPerDevice: 2 },
    // HMS-800W-2T: 800W AC, dual-module with MLPE + rapid shutdown, UL 1741-SA / IEEE 1547
    { equipmentDbId: 'hoymiles-hms-800w-2t', acKw: 0.800, dcKwMax: 0.960, mpptCount: 2, modulesPerDevice: 2 },
  ],

  // Micro topology: sizing is per-panel, not DC-kW tiers.
  // Default to HM-800 as the primary residential model.
  sizingTiers: [
    { minDcKw: 0, maxDcKw: Infinity, equipmentDbId: 'hoymiles-hm800' },
  ],

  battery: {
    capable: false,
    required: false,
  },

  requiredBOSFamilies: [
    { category: 'microinverter', qtyPolicy: 'per_module', required: true,
      note: 'One Hoymiles device per 2 panels (modulesPerDevice: 2).' },
    { category: 'ac_disconnect', qtyPolicy: 'per_inverter', required: true,
      note: 'AC branch disconnect required per NEC 705.' },
  ],

  compatibility: {
    incompatibleTopologies: ['hybrid'],
    dcAcRatioRange: { min: 1.0, max: 1.55 },
  },

  recommendedFor: [],

  // v47.429 — Stage 6: Hoymiles HMS-series micros, IronRidge/Unirac pairings
  // (same residential racking profile as the other micro brands).
  recommendedRackingBrands: ['ironridge', 'unirac'],

  notes:
    'Hoymiles HM-800 and HMS-800W-2T — dual-module microinverters, 2 panels per device. ' +
    'HMS-800W-2T includes integrated MLPE + rapid shutdown (UL 1741-SA). ' +
    'HM-800 is UL 1741 compliant for standard residential grid-tied installs.',
};