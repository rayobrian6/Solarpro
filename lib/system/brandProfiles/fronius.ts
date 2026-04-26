// ════════════════════════════════════════════════════════════════════
// Fronius Brand Profile
// lib/system/brandProfiles/fronius.ts
//
// Fronius Primo — classic string inverter. No optimizers, no battery
// without separate Fronius hybrid SKU.
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const FRONIUS_PROFILE: BrandProfile = {
  id: 'fronius',
  displayName: 'Fronius Primo',
  manufacturer: 'Fronius',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // maxParallelStringsPerMppt: 2 — each MPPT channel accepts up to 2 parallel strings.
    // maxInputCurrentPerMppt: 18.0A (from equipment-db). With typical 400W panels
    // (Isc ~9.8A), design current (1.25×Isc) = 12.25A/string.
    // 2 strings × 12.25A = 24.5A > 18A limit → MPPT current overload with 3+ strings.
    // Set explicitly here so the evaluator never relies on undefined fallback.
    { equipmentDbId: 'fronius-primo-5.0',  acKw: 5.0,  dcKwMax: 7.5,   mpptCount: 2, minPanelsPerString: 7, maxPanelsPerString: 16, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'fronius-primo-7.6',  acKw: 7.6,  dcKwMax: 11.4,  mpptCount: 2, minPanelsPerString: 7, maxPanelsPerString: 16, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'fronius-primo-8.2',  acKw: 8.2,  dcKwMax: 12.3,  mpptCount: 2, minPanelsPerString: 7, maxPanelsPerString: 16, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'fronius-primo-10.0', acKw: 10.0, dcKwMax: 15.0,  mpptCount: 2, minPanelsPerString: 7, maxPanelsPerString: 16, maxParallelStringsPerMppt: 2 },
  ],

  sizingTiers: [
    { minDcKw: 0,     maxDcKw: 6,        equipmentDbId: 'fronius-primo-5.0'  },
    { minDcKw: 6,     maxDcKw: 9,        equipmentDbId: 'fronius-primo-7.6'  },
    { minDcKw: 9,     maxDcKw: 12,       equipmentDbId: 'fronius-primo-8.2'  },
    { minDcKw: 12,    maxDcKw: Infinity, equipmentDbId: 'fronius-primo-10.0' },
  ],

  battery: {
    capable: false,   // Classic Primo is string-only, no battery
    required: false,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',   qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect ahead of string inverter.' },
    { category: 'ac_disconnect',   qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter and service.' },
    { category: 'dc_combiner',     qtyPolicy: 'derived',      required: false,
      note: 'DC combiner if multiple strings per MPPT.' },
    { category: 'rapid_shutdown',  qtyPolicy: 'per_module',   required: true,
      note: 'Per-module RSD device (TIGO or similar) for NEC 690.12 compliance.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro', 'hybrid'],
    incompatibleBrands: ['enphase', 'ecoflow'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 15,
  },

  recommendedFor: [],

  // v47.429 — Stage 6: Fronius certified racking — IronRidge/Unirac in NA,
  // K2 Systems on the EU side of the network.
  recommendedRackingBrands: ['ironridge', 'unirac', 'k2-systems'],

  notes:
    'Fronius Primo is a transformerless string inverter. Per-module rapid shutdown ' +
    'devices are required for NEC 690.12 compliance. No native battery support — ' +
    'use Fronius GEN24 Hybrid for storage applications.',
};