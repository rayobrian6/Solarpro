// ════════════════════════════════════════════════════════════════════════
// Sungrow Brand Profile
// lib/system/brandProfiles/sungrow.ts
//
// Sungrow RS Series — transformerless string inverters.
// 2 MPPT channels, 14A max per MPPT, 600V max DC.
// maxParallelStringsPerMppt: 1 — Sungrow RS datasheets specify one string
// per MPPT input for residential RS models (no parallel string combiner).
// ════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const SUNGROW_PROFILE: BrandProfile = {
  id: 'sungrow',
  displayName: 'Sungrow',
  manufacturer: 'Sungrow',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // maxInputCurrentPerMppt: 14A. Design current (1.25×Isc) for typical
    // 400W panel (Isc ~9.8A) = 12.25A/string — within 14A limit for 1 string.
    // 2 parallel strings: 24.5A > 14A limit → must use 1 string per MPPT.
    { equipmentDbId: 'sungrow-sg5rs',   acKw: 5.0,  dcKwMax: 7.5,  mpptCount: 2, minPanelsPerString: 5, maxPanelsPerString: 11, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'sungrow-sg7.6rs', acKw: 7.6,  dcKwMax: 11.4, mpptCount: 2, minPanelsPerString: 6, maxPanelsPerString: 13, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'sungrow-sg10rs',  acKw: 10.0, dcKwMax: 15.0, mpptCount: 2, minPanelsPerString: 8, maxPanelsPerString: 15, maxParallelStringsPerMppt: 1 },
    // v47.433 Stage 8.4: drift fix — maxParallelStringsPerMppt aligned to registry (2 per SG15RS
    //   datasheet). SG15RS is active: false (no US residential catalog); aligning to hardware
    //   spec removes the last intentional override with zero live-project impact.
    { equipmentDbId: 'sungrow-sg15rs',  acKw: 15.0, dcKwMax: 22.5, mpptCount: 2, minPanelsPerString: 10, maxPanelsPerString: 20, maxParallelStringsPerMppt: 2 },
  ],

  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 6,        equipmentDbId: 'sungrow-sg5rs'   },
    { minDcKw: 6,    maxDcKw: 9,        equipmentDbId: 'sungrow-sg7.6rs' },
    { minDcKw: 9,    maxDcKw: 13,       equipmentDbId: 'sungrow-sg10rs'  },
    { minDcKw: 13,   maxDcKw: Infinity, equipmentDbId: 'sungrow-sg15rs'  },
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
    maxDcKwPerInverter: 22.5,
  },

  recommendedFor: [],

  notes:
    'Sungrow RS Series are transformerless string inverters with 2 MPPT inputs. ' +
    'Per-module rapid shutdown devices required for NEC 690.12. ' +
    'No native battery support — use Sungrow SH hybrid series for storage.',
};