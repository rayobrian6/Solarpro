// ════════════════════════════════════════════════════════════════════════
// GoodWe Brand Profile
// lib/system/brandProfiles/goodwe.ts
//
// GoodWe NS/MS Series — transformerless string inverters.
// 2 MPPT channels, 12.5A max per MPPT, 600V max DC.
// maxParallelStringsPerMppt: 1 — GoodWe NS/MS residential models
// support one string per MPPT for standard residential installs.
// ════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const GOODWE_PROFILE: BrandProfile = {
  id: 'goodwe',
  displayName: 'GoodWe',
  manufacturer: 'GoodWe',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // GW5000-NS: 2 MPPT, 1 string/MPPT, 11A max/MPPT
    // Source: GoodWe DNS series official datasheet
    { equipmentDbId: 'goodwe-gw5000-ns',  acKw: 5.0,  dcKwMax: 7.5,   mpptCount: 2, minPanelsPerString: 5,  maxPanelsPerString: 11, maxParallelStringsPerMppt: 1 },
    // GW7700-MS-US: 3 MPPT, 1 string/MPPT, 16A max/MPPT
    // Source: GoodWe MS-US series official datasheet
    { equipmentDbId: 'goodwe-gw7700-ms',  acKw: 7.7,  dcKwMax: 11.55, mpptCount: 3, minPanelsPerString: 6,  maxPanelsPerString: 14, maxParallelStringsPerMppt: 1 },
    // GW9600-MS-US (id: goodwe-gw10k-ms): 3 MPPT, 1 string/MPPT, 16A max/MPPT
    // Source: GoodWe MS-US series official datasheet
    { equipmentDbId: 'goodwe-gw10k-ms',   acKw: 9.6,  dcKwMax: 14.4,  mpptCount: 3, minPanelsPerString: 8,  maxPanelsPerString: 16, maxParallelStringsPerMppt: 1 },
    // GW11400-MS-US: 3 MPPT, 1 string/MPPT, 16A max/MPPT
    // Source: GoodWe MS-US series official datasheet
    { equipmentDbId: 'goodwe-gw11400-ms', acKw: 11.4, dcKwMax: 17.1,  mpptCount: 3, minPanelsPerString: 8,  maxPanelsPerString: 16, maxParallelStringsPerMppt: 1 },
  ],

  sizingTiers: [
    { minDcKw: 0,  maxDcKw: 6,        equipmentDbId: 'goodwe-gw5000-ns'  },
    { minDcKw: 6,  maxDcKw: 9,        equipmentDbId: 'goodwe-gw7700-ms'  },
    { minDcKw: 9,  maxDcKw: 12,       equipmentDbId: 'goodwe-gw10k-ms'   },
    { minDcKw: 12, maxDcKw: Infinity, equipmentDbId: 'goodwe-gw11400-ms' },
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

  notes:
    'GoodWe NS/MS Series are transformerless string inverters with 2 MPPT inputs. ' +
    'Per-module rapid shutdown devices required for NEC 690.12. ' +
    'No native battery support — use GoodWe ET/BT hybrid series for storage.',
};