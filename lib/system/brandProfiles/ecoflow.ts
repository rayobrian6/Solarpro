// ════════════════════════════════════════════════════════════════════
// EcoFlow Brand Profile
// lib/system/brandProfiles/ecoflow.ts
//
// EcoFlow PowerOcean — hybrid string inverter + modular LFP battery.
// Recommended default for SolFence. Incompatible with microinverters.
// ════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const ECOFLOW_PROFILE: BrandProfile = {
  id: 'ecoflow',
  displayName: 'EcoFlow PowerOcean',
  manufacturer: 'EcoFlow',

  // EcoFlow fits any system type but is the RECOMMENDED default for fence.
  supportedSystemTypes: ['roof', 'ground', 'fence'],

  topology: 'hybrid',
  inverterType: 'ecoflow',

  supportedInverterModels: [
    {
      equipmentDbId: 'ecoflow-power-ocean-5kw',
      acKw: 5.0,
      dcKwMax: 7.5,
      mpptCount: 2,
      minPanelsPerString: 6,
      maxPanelsPerString: 14,
    },
    {
      equipmentDbId: 'ecoflow-power-ocean-10kw',
      acKw: 10.0,
      dcKwMax: 15.0,
      mpptCount: 3,
      minPanelsPerString: 6,
      maxPanelsPerString: 14,
    },
    {
      equipmentDbId: 'ecoflow-power-ocean-20kw',
      acKw: 20.0,
      dcKwMax: 30.0,
      mpptCount: 4,
      minPanelsPerString: 6,
      maxPanelsPerString: 14,
    },
  ],

  // Sizing tiers — mirrors sizeEcoFlowInverter() in ecoflow-system.ts
  sizingTiers: [
    { minDcKw: 0,  maxDcKw: 6,       equipmentDbId: 'ecoflow-power-ocean-5kw'  },
    { minDcKw: 6,  maxDcKw: 12,      equipmentDbId: 'ecoflow-power-ocean-10kw' },
    { minDcKw: 12, maxDcKw: Infinity, equipmentDbId: 'ecoflow-power-ocean-20kw' },
  ],

  battery: {
    capable: true,
    required: false,             // user-driven; EcoFlow inverter works w/o battery
    recommendedBatteryBrands: ['ecoflow'],
    sizingStrategy: 'modular_stack',
    defaultTargetKwh: 10,        // 2 modules default
    minKwh: 5,                   // one module
    maxKwh: 45,                  // std stack cap
  },

  requiredBOSFamilies: [
    { category: 'inverter_base',       qtyPolicy: 'per_inverter', required: true,
      note: 'EcoFlow PowerOcean wall-mount base / stack bottom.' },
    { category: 'battery_combiner',    qtyPolicy: 'fixed_one',    required: true,
      note: 'Battery combiner box (only if battery installed).' },
    { category: 'smart_meter',         qtyPolicy: 'fixed_one',    required: true,
      note: 'EcoFlow CT smart meter for grid sensing.' },
    { category: 'monitoring_gateway',  qtyPolicy: 'fixed_one',    required: true,
      note: 'EcoFlow monitoring gateway.' },
    { category: 'dc_disconnect',       qtyPolicy: 'per_inverter', required: true,
      note: 'DC disconnect ahead of hybrid inverter.' },
  ],

  compatibility: {
    // HARD RULE: EcoFlow can NEVER be in a system with microinverters.
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase'],
    dcAcRatioRange: { min: 1.0, max: 1.5 },
    maxDcKwPerInverter: 30,
  },

  recommendedFor: ['fence'],    // SolFence factory baseline

  // v47.429 — Stage 6: EcoFlow PowerOcean residential roof installs most
  // commonly pair with IronRidge XR. (SolFence is self-contained for fence deployments.)
  recommendedRackingBrands: ['ironridge'],

  notes:
    'EcoFlow PowerOcean is a hybrid string inverter. DC inputs via MPPTs; ' +
    'battery modules stack in 5 kWh LFP units (std: 45 kWh cap, Pro: 80 kWh). ' +
    'Monitoring gateway + smart meter required for operation.',
};