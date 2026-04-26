// ═══════════════════════════════════════════════════════════════════════════
// Tigo Brand Profile (v47.426)
// lib/system/brandProfiles/tigo.ts
//
// Tigo EI Inverter — single-phase hybrid residential inverter, designed as
// the centerpiece of the Tigo Energy Intelligence (EI) solution. Natively
// pairs with Tigo EI Battery and supports module-level monitoring / rapid
// shutdown via TS4-A-O/M/S.
//
// All models: 240V, 600V DC max, 80–550V MPPT range, 13.5A IMP / 16.9A Isc
// per MPPT, 2 strings per MPPT, 152-month warranty. UL1741:2021 Ed.3 SB,
// AFCI integrated, PVRSS-compliant.
//
// Family spans 3.8K → 11.4K with 2 / 3 / 4 MPPT channels.
//
// Datasheet source: Krannich Solar PDF (Tigo, July 2024, 002-00081-00 v4.4)
// ═══════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const TIGO_PROFILE: BrandProfile = {
  id: 'tigo',
  displayName: 'Tigo',
  manufacturer: 'Tigo',

  // Hybrid topology — native DC-coupled battery support via Tigo EI Battery.
  topology: 'hybrid',
  inverterType: 'string',

  supportedSystemTypes: ['roof', 'ground'],

  supportedInverterModels: [
    // maxInputCurrentPerMppt: 13.5A IMP. Design current (1.25×Isc) for a 400W
    // panel (Isc ~10A) = 12.5A/string — within 13.5A limit for 1 string/MPPT.
    // 2 strings in parallel: 25A > 13.5A → only one panel type per MPPT at
    // the high-Isc end (requires careful panel selection for parallel wiring).
    // Datasheet confirms 2 strings per MPPT is supported at the physical
    // connector level; the sizing engine's compliance check guards thermally.
    { equipmentDbId: 'tigo-tsi-3p8k-us',  acKw: 3.8,  dcKwMax: 7.6,  mpptCount: 2, minPanelsPerString: 4, maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'tigo-tsi-7p6k-us',  acKw: 7.6,  dcKwMax: 15.2, mpptCount: 3, minPanelsPerString: 5, maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    { equipmentDbId: 'tigo-tsi-11p4k-us', acKw: 11.4, dcKwMax: 22.8, mpptCount: 4, minPanelsPerString: 6, maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
  ],

  sizingTiers: [
    { minDcKw: 0,   maxDcKw: 6,        equipmentDbId: 'tigo-tsi-3p8k-us'  },
    { minDcKw: 6,   maxDcKw: 13,       equipmentDbId: 'tigo-tsi-7p6k-us'  },
    { minDcKw: 13,  maxDcKw: Infinity, equipmentDbId: 'tigo-tsi-11p4k-us' },
  ],

  battery: {
    capable: true,
    required: false,
    // Tigo EI Inverter natively pairs with Tigo EI Battery (preferred) or
    // Tigo GO Battery. Both are DC-coupled via the inverter's battery port.
    recommendedBatteryBrands: ['tigo'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 10,
    minKwh: 5,
    maxKwh: 40,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect between PV array and inverter (integrated on EI Inverter).' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter and service (NEC 705.22).' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Tigo TS4-A-F/O/S provides per-module PVRSS rapid shutdown for NEC 690.12.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase', 'apsystems', 'hoymiles'],
    dcAcRatioRange: { min: 1.0, max: 2.0 },  // Datasheet allows up to 200% DC oversizing
    maxDcKwPerInverter: 22.8,
  },

  recommendedFor: [],

  notes:
    'Tigo EI Inverter is a 240V single-phase hybrid family (3.8/7.6/11.4 kW). ' +
    'Natively pairs with Tigo EI Battery for DC-coupled storage. Up to 200% ' +
    'DC oversizing (2:1 DC/AC). Module-level monitoring and PVRSS rapid ' +
    'shutdown when paired with Tigo TS4 MLPE devices. Integrated AFCI and ' +
    'RS-485/Wi-Fi/optional 4G connectivity.',
};