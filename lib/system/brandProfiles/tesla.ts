// ═══════════════════════════════════════════════════════════════════════════
// Tesla Brand Profile (v47.426)
// lib/system/brandProfiles/tesla.ts
//
// Tesla Solar Inverter — pure string inverter family (not an optimizer system).
// 240V single-phase, 600V DC max, 60–480V MPPT range, 13A IMP / 17A Isc
// per MPPT. 98.0% CEC / 98.6% peak efficiency, UL1741SB, AFCI integrated.
// Ecosystem pairs with Powerwall 2/3 via Backup Gateway 2/3.
//
// Datasheet source: Tesla energy library (tesla.com)
//
// v47.425 had Tesla on the STORAGE_ONLY_ECOSYSTEMS allowlist; v47.426 moves it
// out — Tesla now has a real PV inverter profile with 4 SKUs.
// ═══════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const TESLA_PROFILE: BrandProfile = {
  id: 'tesla',
  displayName: 'Tesla',
  manufacturer: 'Tesla',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'string',
  inverterType: 'string',

  supportedInverterModels: [
    // 3.8K / 5.7K have 1 input connector per MPPT (maxParallelStringsPerMppt: 1).
    // 5K / 7.6K have 2 input connectors per MPPT (maxParallelStringsPerMppt: 2).
    // maxInputCurrentPerMppt: 13A IMP. Design current for a 400W panel
    // (Isc ~10A × 1.25 = 12.5A/string) is within 13A for 1 string / MPPT.
    { equipmentDbId: 'tesla-solar-inverter-3p8k',  acKw: 3.8, dcKwMax: 5.7,  mpptCount: 2, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'tesla-solar-inverter-5k',    acKw: 5.0, dcKwMax: 7.5,  mpptCount: 2, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'tesla-solar-inverter-5p7k',  acKw: 5.7, dcKwMax: 8.55, mpptCount: 2, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'tesla-solar-inverter-7p6k',  acKw: 7.6, dcKwMax: 11.4, mpptCount: 2, minPanelsPerString: 5, maxPanelsPerString: 12, maxParallelStringsPerMppt: 2 },
  ],

  sizingTiers: [
    { minDcKw: 0,   maxDcKw: 6.5,      equipmentDbId: 'tesla-solar-inverter-3p8k' },
    { minDcKw: 6.5, maxDcKw: 8,        equipmentDbId: 'tesla-solar-inverter-5k'   },
    { minDcKw: 8,   maxDcKw: 9.5,      equipmentDbId: 'tesla-solar-inverter-5p7k' },
    { minDcKw: 9.5, maxDcKw: Infinity, equipmentDbId: 'tesla-solar-inverter-7p6k' },
  ],

  battery: {
    // Tesla Solar Inverter pairs with Powerwall 2/3 via Backup Gateway 2/3.
    // The inverter itself is AC-coupled; Powerwall handles the storage side.
    capable: true,
    required: false,
    recommendedBatteryBrands: ['tesla'],
    sizingStrategy: 'single_pack',
    defaultTargetKwh: 13.5,  // Powerwall 2 nominal
    minKwh: 13.5,
    maxKwh: 40.5,            // 3× Powerwall 2
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect between PV array and inverter (NEC 690.13).' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter and service (NEC 705.22).' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Tesla Solar Shutdown Device (MCI) provides NEC 690.12 RSD.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase', 'apsystems', 'hoymiles'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 11.4,
  },

  recommendedFor: [],

  // v47.429 — Stage 6: Tesla installers most commonly pair with IronRidge XR
  // (UL 2703 listed, Tesla-approved in field installations) and Unirac SolarMount.
  recommendedRackingBrands: ['ironridge', 'unirac'],

  notes:
    'Tesla Solar Inverter is a 240V single-phase pure string inverter ' +
    '(no optimizers). 2 MPPTs on every model; input connectors per MPPT ' +
    'vary (1-2-1-2 pattern across 3.8/5/5.7/7.6 kW). Integrated AFCI, ' +
    'RSD via external Solar Shutdown Device. Pairs with Powerwall via ' +
    'Backup Gateway for whole-home backup.',
};