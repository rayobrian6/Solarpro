// ═══════════════════════════════════════════════════════════════════════════
// Sol-Ark Brand Profile
// lib/system/brandProfiles/sol-ark.ts
//
// Sol-Ark hybrid inverter family — 8K, 12K, 15K (residential 240V split-phase)
// and 30K-3P-208V (commercial three-phase).
//
// Topology: hybrid — all models natively support battery storage on the DC side
// (48V battery bus, pre-boost to DC link). Backed-up loads panel ties to the
// inverter LOAD terminals directly; ATS not required.
//
// All datasheet URLs verified HTTP 200 against sol-ark.com on 2025-01.
// v47.399 — Stage 1 of upgrade roadmap.
// ═══════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const SOL_ARK_PROFILE: BrandProfile = {
  id: 'sol-ark',
  displayName: 'Sol-Ark',
  manufacturer: 'Sol-Ark',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'hybrid',
  inverterType: 'string',

  supportedInverterModels: [
    // 8K-2P  — 8 kW AC, 10.5 kW DC PV, 2 MPPT
    { equipmentDbId: 'solark-8k-2p',        acKw: 8.0,  dcKwMax: 10.5, mpptCount: 2, minPanelsPerString: 6,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // 12K-2P — 12 kW AC, 19.5 kW DC PV, 2 MPPT
    { equipmentDbId: 'solark-12k-2p',       acKw: 12.0, dcKwMax: 19.5, mpptCount: 2, minPanelsPerString: 6,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // 15K-2P — 15 kW AC, 19.5 kW DC PV, 3 MPPT
    { equipmentDbId: 'solark-15k-2p',       acKw: 15.0, dcKwMax: 19.5, mpptCount: 3, minPanelsPerString: 6,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // 30K-3P-208V — 30 kW AC 3-phase commercial, 45 kW DC PV, 4 MPPT
    { equipmentDbId: 'solark-30k-3p-208v',  acKw: 30.0, dcKwMax: 45.0, mpptCount: 4, minPanelsPerString: 10, maxPanelsPerString: 20, maxParallelStringsPerMppt: 2 },
  ],

  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 9,        equipmentDbId: 'solark-8k-2p'       },
    { minDcKw: 9,    maxDcKw: 14,       equipmentDbId: 'solark-12k-2p'      },
    { minDcKw: 14,   maxDcKw: 22,       equipmentDbId: 'solark-15k-2p'      },
    { minDcKw: 22,   maxDcKw: Infinity, equipmentDbId: 'solark-30k-3p-208v' },
  ],

  battery: {
    capable: true,
    required: false,
    // Sol-Ark is battery-agnostic — pairs with any 48V LiFePO4 that speaks
    // CAN. Commonly paired with EG4, HomeGrid, Pytes, Fortress, SimpliPhi.
    // v47.428: Pytes / Fortress removed until verified SKUs are added to
    // the registry. Both captured as P1 planned items on the RE+ 2026 roadmap.
    recommendedBatteryBrands: ['eg4', 'homegrid'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 15,
    minKwh: 5,
    maxKwh: 60,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect between PV array and inverter (NEC 690.13).' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter GRID terminals and service (NEC 705.22).' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Module-level rapid shutdown devices for NEC 690.12 compliance.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase', 'apsystems', 'hoymiles'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 45.0,
  },

  recommendedFor: [],

  notes:
    'Sol-Ark residential 8K/12K/15K are split-phase 240V hybrids with native ' +
    '48V battery support and backed-up load terminals (no ATS required). ' +
    'The 30K-3P-208V is a commercial three-phase hybrid. All models are ' +
    'battery-agnostic — pair with any 48V LFP battery that speaks CAN.',
};