// ═══════════════════════════════════════════════════════════════════════════
// Growatt Brand Profile
// lib/system/brandProfiles/growatt.ts
//
// Growatt MIN TL-XH-US hybrid inverter family (residential split-phase
// 240V/208V, battery-ready). Three MPPT trackers on most SKUs (2 on the
// 5 kW), two strings per MPPT. Native DC-coupled battery bus (380–550 V)
// with support for Growatt APX HV / ARO HV, LG Prime 10H/16H, and LG
// enblock S10/S14/S17 modular stacks.
//
// Topology: hybrid — battery-ready on the DC side (pre-boost to DC link).
// Backed-up loads served via AC Port-V2 (EPS compatible with ATS-US for
// partial home backup) or SYN200-US (whole-home backup on Port-V3).
//
// All datasheet URLs verified HTTP 200 against us.growatt.com on 2025-01.
// v47.420 — Stage 5.1 of upgrade roadmap.
// ═══════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const GROWATT_PROFILE: BrandProfile = {
  id: 'growatt',
  displayName: 'Growatt',
  manufacturer: 'Growatt',

  supportedSystemTypes: ['roof', 'ground'],

  topology: 'hybrid',
  inverterType: 'string',

  supportedInverterModels: [
    // MIN 5000TL-XH-US  — 5.0 kW AC, 10.0 kW DC PV, 2 MPPT × 2 parallel
    { equipmentDbId: 'growatt-min-5000tl-xh-us',   acKw: 5.0,  dcKwMax: 10.0, mpptCount: 2, minPanelsPerString: 7,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // MIN 6000TL-XH-US  — 6.0 kW AC, 12.0 kW DC PV, 3 MPPT × 2 parallel
    { equipmentDbId: 'growatt-min-6000tl-xh-us',   acKw: 6.0,  dcKwMax: 12.0, mpptCount: 3, minPanelsPerString: 6,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // MIN 7600TL-XH-US  — 7.6 kW AC, 15.2 kW DC PV, 3 MPPT × 2 parallel
    { equipmentDbId: 'growatt-min-7600tl-xh-us',   acKw: 7.6,  dcKwMax: 15.2, mpptCount: 3, minPanelsPerString: 7,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // MIN 10000TL-XH-US — 10.0 kW AC, 20.0 kW DC PV, 3 MPPT × 2 parallel
    { equipmentDbId: 'growatt-min-10000tl-xh-us',  acKw: 10.0, dcKwMax: 20.0, mpptCount: 3, minPanelsPerString: 7,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
    // MIN 11400TL-XH-US — 11.4 kW AC, 22.8 kW DC PV, 3 MPPT × 2 parallel
    { equipmentDbId: 'growatt-min-11400tl-xh-us',  acKw: 11.4, dcKwMax: 22.8, mpptCount: 3, minPanelsPerString: 8,  maxPanelsPerString: 13, maxParallelStringsPerMppt: 2 },
  ],

  // Sizing tiers mirror the actual SKU lineup. Boundaries chosen to match
  // each inverter's DC PV input ceiling (datasheet max PV power).
  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 9,        equipmentDbId: 'growatt-min-5000tl-xh-us'  },
    { minDcKw: 9,    maxDcKw: 12.5,     equipmentDbId: 'growatt-min-6000tl-xh-us'  },
    { minDcKw: 12.5, maxDcKw: 16,       equipmentDbId: 'growatt-min-7600tl-xh-us'  },
    { minDcKw: 16,   maxDcKw: 20.5,     equipmentDbId: 'growatt-min-10000tl-xh-us' },
    { minDcKw: 20.5, maxDcKw: Infinity, equipmentDbId: 'growatt-min-11400tl-xh-us' },
  ],

  battery: {
    capable: true,
    required: false,
    // Growatt is battery-agnostic within its approved compatibility list.
    // Native Growatt APX HV (5 kWh modules, 5–30 kWh stack) is the default
    // pairing. ARO HV (3.3 kWh modules, 6.6–39.6 kWh) and LG Prime/enblock
    // are officially supported alternatives.
    // v47.428: Growatt APX and LG Prime/enblock removed pending verified
    // registry SKUs. EG4 PowerPro is manufacturer-listed as Growatt-compatible
    // in the EG4 datasheet and fills the HV-LFP slot. Growatt APX + LG are
    // captured as P2 planned items on the RE+ 2026 roadmap.
    recommendedBatteryBrands: ['eg4'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 15,
    minKwh: 5,
    maxKwh: 40,
  },

  requiredBOSFamilies: [
    { category: 'dc_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'Integrated DC switch per datasheet — external field-installed disconnect not required at inverter (NEC 690.13).' },
    { category: 'ac_disconnect',  qtyPolicy: 'per_inverter', required: true,
      note: 'AC disconnect between inverter grid port and service entrance (NEC 705.22).' },
    { category: 'rapid_shutdown', qtyPolicy: 'per_module',   required: true,
      note: 'Module-level rapid shutdown for NEC 690.12 compliance. Inverter has built-in RSD transmitter per UL 1741-SB.' },
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase', 'apsystems', 'hoymiles'],
    // Growatt publishes a 2:1 DC/AC ratio ceiling on the datasheet. Real
    // residential designs typically run 1.2–1.4× for performance margin;
    // cap at 1.5× to stay comfortably below the 2:1 manufacturer limit.
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 22.8,
  },

  recommendedFor: [],

  notes:
    'Growatt MIN TL-XH-US is a residential split-phase hybrid inverter ' +
    'family (240V/208V) with native DC-coupled battery support via Growatt ' +
    'APX HV / ARO HV or LG Prime / LG enblock. All models ship with ' +
    'integrated DC switch, AFCI (UL 1699B), and rapid shutdown (UL 1741-SB). ' +
    'Two AC ports: Port-V2 pairs with ATS-US for partial-home backup; ' +
    'Port-V3 pairs with SYN200-US for whole-home backup. Revenue-grade ' +
    'metering (ANSI C12.20 0.5%) is built in.',
};