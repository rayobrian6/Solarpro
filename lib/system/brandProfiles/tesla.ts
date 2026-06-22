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
    // All four are the SAME hardware (Tesla Solar Inverter 1538000): 4 MPPT,
    // input connectors 1-2-1-2, 13A IMP / 17A ISC per MPPT, 600 VDC max,
    // allowable DC/AC 1.7 (datasheet). Models differ only by AC power class.
    // equipment-db sets maxInputCurrentPerMppt to the 17A ISC rating so the
    // engine's per-MPPT design-current check (Isc×1.25) accepts a TSP-420 string
    // (16.3A < 17A). dcKwMax = acKw × 1.7. maxParallelStringsPerMppt kept at 1.
    { equipmentDbId: 'tesla-solar-inverter-3p8k',  acKw: 3.8, dcKwMax: 6.46,  mpptCount: 4, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'tesla-solar-inverter-5k',    acKw: 5.0, dcKwMax: 8.5,   mpptCount: 4, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'tesla-solar-inverter-5p7k',  acKw: 5.7, dcKwMax: 9.69,  mpptCount: 4, minPanelsPerString: 4, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
    { equipmentDbId: 'tesla-solar-inverter-7p6k',  acKw: 7.6, dcKwMax: 12.92, mpptCount: 4, minPanelsPerString: 5, maxPanelsPerString: 12, maxParallelStringsPerMppt: 1 },
  ],

  // Tier maxDcKw = each model's dcKwMax (acKw × 1.7), so the fallback picker
  // never selects a DC-overloaded or out-of-ratio inverter (audit finding 4).
  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 6.46,     equipmentDbId: 'tesla-solar-inverter-3p8k' },
    { minDcKw: 6.46, maxDcKw: 8.5,      equipmentDbId: 'tesla-solar-inverter-5k'   },
    { minDcKw: 8.5,  maxDcKw: 9.69,     equipmentDbId: 'tesla-solar-inverter-5p7k' },
    { minDcKw: 9.69, maxDcKw: Infinity, equipmentDbId: 'tesla-solar-inverter-7p6k' },
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
    dcAcRatioRange: { min: 1.0, max: 1.7 },  // datasheet allowable DC/AC = 1.7
    maxDcKwPerInverter: 12.92,               // 7.6kW × 1.7
  },

  recommendedFor: [],

  // v47.429 — Stage 6: Tesla installers most commonly pair with IronRidge XR
  // (UL 2703 listed, Tesla-approved in field installations) and Unirac SolarMount.
  // Tesla Certified installs default to Tesla Panel Mount (Comp Rafter / Tile,
  // UL 2703); IronRidge/Unirac retained as field-proven alternatives.
  recommendedRackingBrands: ['tesla', 'ironridge', 'unirac'],

  notes:
    'Tesla Solar Inverter is a 240V single-phase pure string inverter ' +
    '(no optimizers). 2 MPPTs on every model; input connectors per MPPT ' +
    'vary (1-2-1-2 pattern across 3.8/5/5.7/7.6 kW). Integrated AFCI, ' +
    'RSD via external Solar Shutdown Device. Pairs with Powerwall via ' +
    'Backup Gateway for whole-home backup.',
};