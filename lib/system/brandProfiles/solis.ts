// ═══════════════════════════════════════════════════════════════════════════
// Solis Brand Profile (v47.426)
// lib/system/brandProfiles/solis.ts
//
// Ginlong Solis S6-EH1P US family — single-phase hybrid residential inverters.
// 240V split-phase, 600V DC max, 80–520V MPPT range, 16A IMP / 25.6A Isc
// per MPPT, 1 string per MPPT across the family. UL1741SB, AFCI integrated.
// Family spans 3.8K → 11.4K with 2 / 3 / 4 MPPT channels.
//
// Datasheet source: Krannich Solar PDF (Ginlong, December 2024)
// ═══════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const SOLIS_PROFILE: BrandProfile = {
  id: 'solis',
  displayName: 'Solis',
  manufacturer: 'Solis',

  supportedSystemTypes: ['roof', 'ground'],

  // Hybrid topology — native DC-coupled battery support on the PV side.
  topology: 'hybrid',
  inverterType: 'string',

  supportedInverterModels: [
    // maxInputCurrentPerMppt: 16A. Design current (1.25×Isc) for 400W panel
    // (Isc ~10A) = 12.5A/string — within the 16A limit for 1 string per MPPT.
    // All models are 1 string per MPPT per the datasheet.
    { equipmentDbId: 'solis-s6-eh1p-3p8k-us',  acKw: 3.8,  dcKwMax: 5.7,   mpptCount: 2, minPanelsPerString: 5, maxPanelsPerString: 11, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'solis-s6-eh1p-5k-us',    acKw: 5.0,  dcKwMax: 7.5,   mpptCount: 2, minPanelsPerString: 6, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'solis-s6-eh1p-7p6k-us',  acKw: 7.6,  dcKwMax: 11.4,  mpptCount: 3, minPanelsPerString: 6, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'solis-s6-eh1p-9p9k-us',  acKw: 9.9,  dcKwMax: 14.85, mpptCount: 4, minPanelsPerString: 7, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'solis-s6-eh1p-10k-us',   acKw: 10.0, dcKwMax: 15.0,  mpptCount: 4, minPanelsPerString: 7, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'solis-s6-eh1p-11p4k-us', acKw: 11.4, dcKwMax: 17.1,  mpptCount: 4, minPanelsPerString: 7, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
  ],

  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 4.5,      equipmentDbId: 'solis-s6-eh1p-3p8k-us'  },
    { minDcKw: 4.5,  maxDcKw: 6.5,      equipmentDbId: 'solis-s6-eh1p-5k-us'    },
    { minDcKw: 6.5,  maxDcKw: 10,       equipmentDbId: 'solis-s6-eh1p-7p6k-us'  },
    { minDcKw: 10,   maxDcKw: 13,       equipmentDbId: 'solis-s6-eh1p-9p9k-us'  },
    { minDcKw: 13,   maxDcKw: 15.5,     equipmentDbId: 'solis-s6-eh1p-10k-us'   },
    { minDcKw: 15.5, maxDcKw: Infinity, equipmentDbId: 'solis-s6-eh1p-11p4k-us' },
  ],

  battery: {
    capable: true,
    required: false,
    // Solis S6-EH1P is battery-agnostic — pairs with any HV LFP battery
    // that speaks CAN (BYD HVM/HVS, Pylontech Force-H2, SolaX HV, etc.).
    // v47.428: SolaX HV removed until a verified SolaX battery SKU is added
    // to the registry. Captured as a P2 planned item on the RE+ 2026 roadmap.
    recommendedBatteryBrands: ['byd', 'pylontech'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 10,
    minKwh: 5,
    maxKwh: 30,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect between PV array and inverter (NEC 690.13).' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter and service (NEC 705.22).' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Module-level RSD device for NEC 690.12 compliance (SunSpec transmitter built-in).' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase', 'apsystems', 'hoymiles'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 17.1,
  },

  recommendedFor: [],

  notes:
    'Solis S6-EH1P US is a single-phase 240V hybrid family with native ' +
    'DC-coupled battery support. 2/3/4 MPPTs depending on model, 1 string ' +
    'per MPPT, 600V DC max. Integrated AFCI and SunSpec RSD transmitter.',
};