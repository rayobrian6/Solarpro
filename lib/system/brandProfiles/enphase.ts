// ════════════════════════════════════════════════════════════════════
// Enphase Brand Profile
// lib/system/brandProfiles/enphase.ts
//
// Enphase IQ8 series — microinverters. One per panel (or pair).
// Supports IQ Battery ecosystem for storage.
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const ENPHASE_PROFILE: BrandProfile = {
  id: 'enphase',
  displayName: 'Enphase IQ8',
  manufacturer: 'Enphase',

  supportedSystemTypes: ['roof', 'ground', 'fence'],

  topology: 'micro',
  inverterType: 'micro',

  supportedInverterModels: [
    { equipmentDbId: 'enphase-iq8plus', acKw: 0.290, dcKwMax: 0.440, mpptCount: 1, modulesPerDevice: 1 }, // datasheet max continuous output 290 VA
    { equipmentDbId: 'enphase-iq8m',    acKw: 0.325, dcKwMax: 0.460, mpptCount: 1, modulesPerDevice: 1 }, // datasheet max continuous output 325 VA (was peak 330)
    { equipmentDbId: 'enphase-iq8h',    acKw: 0.380, dcKwMax: 0.540, mpptCount: 1, modulesPerDevice: 1 }, // datasheet max input DC = 540W (was stale 600)
    { equipmentDbId: 'enphase-iq8a',    acKw: 0.349, dcKwMax: 0.500, mpptCount: 1, modulesPerDevice: 1 }, // datasheet max continuous output 349 VA (was peak 366); max module pairing ~500W (was 530)
    { equipmentDbId: 'enphase-iq8ac',   acKw: 0.384, dcKwMax: 0.530, mpptCount: 1, modulesPerDevice: 1 },
  ],

  // Micro: one model by default; sizing is per-panel, not DC-kW tiers.
  // We use a single entry so the engine falls back to default.
  sizingTiers: [
    { minDcKw: 0, maxDcKw: Infinity, equipmentDbId: 'enphase-iq8plus' },
  ],

  battery: {
    capable: true,
    required: false,
    recommendedBatteryBrands: ['enphase'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 10,
    minKwh: 3.5,
    maxKwh: 40,
  },

  requiredBOSFamilies: [
    { category: 'microinverter',      qtyPolicy: 'per_module',    required: true,
      note: 'One microinverter per panel.' },
    { category: 'trunk_cable',        qtyPolicy: 'derived',       required: true,
      note: 'Q Cable trunk — one run per AC branch.' },
    { category: 'terminator',         qtyPolicy: 'per_branch',    required: true,
      note: 'End terminator per AC branch.' },
    { category: 'combiner',           qtyPolicy: 'fixed_one',     required: true,
      equipmentDbId: 'enphase-iq-combiner-5',
      note: 'IQ Combiner 5.' },
    { category: 'monitoring_gateway', qtyPolicy: 'fixed_one',     required: true,
      note: 'IQ Gateway / Envoy.' },
  ],

  compatibility: {
    // HARD RULE: Enphase micro cannot coexist with hybrid/EcoFlow.
    incompatibleTopologies: ['hybrid'],
    incompatibleBrands: ['ecoflow'],
    dcAcRatioRange: { min: 1.0, max: 1.55 },
  },

  recommendedFor: ['roof', 'fence'],   // fence: SolFence is "just solar" + battery-agnostic → IQ8 micro (per-panel, AC out, racking-compatible per datasheet; any battery AC-couples later)

  // v47.429 — Stage 6: Enphase IQ8 Installer Toolkit references IronRidge XR,
  // Unirac SolarMount, and SnapNrack Series 100 as the standard pairings for
  // residential shingle / comp roof installs.
  recommendedRackingBrands: ['ironridge', 'unirac', 'snapnrack'],

  notes:
    'Enphase IQ8 microinverters — one per panel. Rapid shutdown compliant by design. ' +
    'AC branches terminate at IQ Combiner; gateway enables monitoring and grid-forming control. ' +
    'Incompatible with EcoFlow PowerOcean (hybrid topology).',
};