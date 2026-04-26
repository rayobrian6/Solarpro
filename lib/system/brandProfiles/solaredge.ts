// ════════════════════════════════════════════════════════════════════
// SolarEdge Brand Profile
// lib/system/brandProfiles/solaredge.ts
//
// SolarEdge HD-Wave — optimizer topology. Per-module power optimizers
// feed a central inverter. Home Battery for storage ecosystem.
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const SOLAREDGE_PROFILE: BrandProfile = {
  id: 'solaredge',
  displayName: 'SolarEdge HD-Wave',
  manufacturer: 'SolarEdge',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'optimizer',
  inverterType: 'optimizer',

  supportedInverterModels: [
    // maxPanelsPerString=25 is the SolarEdge datasheet absolute physical ceiling.
    // maxParallelStringsPerMppt comes directly from equipment-db.ts (datasheet-verified).
    // The optimizer string POWER cap (floor(nomDcV * optimizerCap / panelW) = 14 for 400W)
    // is enforced separately in voltageAwareMaxPPS() in sizingEngine.ts (v47.422).
    { equipmentDbId: 'se-3800h',  acKw: 3.8,  dcKwMax: 5.7,  mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'se-6000h',  acKw: 6.0,  dcKwMax: 9.0,  mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'se-7600h',  acKw: 7.6,  dcKwMax: 11.4, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'se-10000h', acKw: 10.0, dcKwMax: 15.0, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25, maxParallelStringsPerMppt: 3 },
    { equipmentDbId: 'se-11400h', acKw: 11.4, dcKwMax: 17.1, mpptCount: 1, minPanelsPerString: 8, maxPanelsPerString: 25, maxParallelStringsPerMppt: 3 },
  ],

  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 4.5,      equipmentDbId: 'se-3800h'  },
    { minDcKw: 4.5,  maxDcKw: 7,        equipmentDbId: 'se-6000h'  },
    { minDcKw: 7,    maxDcKw: 9,        equipmentDbId: 'se-7600h'  },
    { minDcKw: 9,    maxDcKw: 12,       equipmentDbId: 'se-10000h' },
    { minDcKw: 12,   maxDcKw: Infinity, equipmentDbId: 'se-11400h' },
  ],

  battery: {
    capable: true,
    required: false,
    recommendedBatteryBrands: ['solaredge'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 10,
    minKwh: 10,
    maxKwh: 30,
  },

  requiredBOSFamilies: [
    { category: 'optimizer',       qtyPolicy: 'per_module',    required: true,
      note: 'Per-module power optimizer (SolarEdge P-series).' },
    { category: 'dc_disconnect',   qtyPolicy: 'per_inverter',  required: true,
      note: 'DC disconnect built into SolarEdge inverters on most models.' },
    { category: 'ac_disconnect',   qtyPolicy: 'per_inverter',  required: true,
      note: 'AC disconnect between inverter and service.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro', 'hybrid'],
    incompatibleBrands: ['enphase', 'ecoflow'],
    dcAcRatioRange: { min: 1.0, max: 1.55 },
    maxDcKwPerInverter: 17.1,
  },

  recommendedFor: [],

  // v47.429 — Stage 6: SolarEdge Designer auto-layout tool natively supports
  // IronRidge XR and Unirac SolarMount (UL 2703 + compatible grounding with
  // SolarEdge safety features). Unirac publishes a SolarEdge-specific kit.
  recommendedRackingBrands: ['ironridge', 'unirac'],

  notes:
    'SolarEdge uses per-module power optimizers (P-series) feeding a central HD-Wave inverter. ' +
    'Rapid shutdown is inherent (SafeDC). Battery support via SolarEdge Home Hub or StorEdge.',
};