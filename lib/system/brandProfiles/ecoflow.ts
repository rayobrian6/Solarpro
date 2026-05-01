// ═══════════════════════════════════════════════════════════════════════════════
// EcoFlow Brand Profile
// lib/system/brandProfiles/ecoflow.ts
//
// v58.14 — Upgraded from EU/AU-only PowerOcean (legacy, active:false in DB)
// to the US-market **OCEAN Pro** residential ESS. Key facts:
//   • EF-PCS-24 hybrid inverter, split-phase 120/240 V, 60 Hz
//   • Two configured tiers on one platform: 11.5 kW and 24 kW AC
//   • 8 MPPTs, 60–480 V MPPT range, 40 kW max STC PV
//   • UL 1741-SB, UL 3741, UL 1699B, IEEE 1547
//   • EF-BP-10 battery module (10 kWh LFP, 400 V HV, DC-coupled)
//   • Stacks 1–8 batteries per inverter (10–80 kWh)
//   • Industry-first UL 9540B certification (Sept 2025)
//
// Legacy PowerOcean SKUs (5/10/20 kW EU) remain in the registry for back-
// compat but are `active:false` — sizing engine will not pick them.
// ═══════════════════════════════════════════════════════════════════════════════

import type { BrandProfile } from './types';

export const ECOFLOW_PROFILE: BrandProfile = {
  id: 'ecoflow',
  displayName: 'EcoFlow OCEAN Pro',
  manufacturer: 'EcoFlow',

  // OCEAN Pro is a residential whole-home ESS. Works for roof, ground, and
  // remains the SolFence baseline.
  supportedSystemTypes: ['roof', 'ground', 'fence'],

  topology: 'hybrid',
  inverterType: 'ecoflow',

  supportedInverterModels: [
    // v58.14 — US OCEAN Pro (primary US SKUs)
    {
      equipmentDbId: 'ecoflow-ocean-pro-11kw',
      acKw: 11.5,
      dcKwMax: 40.0,
      mpptCount: 8,
      minPanelsPerString: 4,
      maxPanelsPerString: 16,
    },
    {
      equipmentDbId: 'ecoflow-ocean-pro-24kw',
      acKw: 24.0,
      dcKwMax: 40.0,
      mpptCount: 8,
      minPanelsPerString: 4,
      maxPanelsPerString: 16,
    },
    // Legacy EU/AU PowerOcean (inactive in DB, kept for back-compat)
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

  // Sizing tiers — only use ACTIVE US SKUs (OCEAN Pro 11.5 / 24 kW).
  // The sizing engine picks the smallest tier whose maxDcKw covers
  // systemDcKw. With DC/AC ratio target ~1.25:
  //   • 11.5 kW AC → 14 kW DC sweet spot, covers up to ~20 kW DC
  //   • 24.0 kW AC → 30 kW DC sweet spot, covers up to 40 kW DC (datasheet max)
  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 20,       equipmentDbId: 'ecoflow-ocean-pro-11kw' },
    { minDcKw: 20,   maxDcKw: Infinity, equipmentDbId: 'ecoflow-ocean-pro-24kw' },
  ],

  battery: {
    capable: true,
    required: false,              // Hybrid: inverter works w/o battery
    recommendedBatteryBrands: ['ecoflow'],
    sizingStrategy: 'modular_stack',
    // v58.14 — sizing-engine compatibility window.
    //
    // The legacy sizing engine (sizeBattery() in lib/system/sizingEngine.ts)
    // is currently hardcoded to ECOFLOW_MODULE_KWH=5 and equipmentDbId
    // 'ecoflow-battery-5kwh'. Until that engine is generalised to support
    // the new 10 kWh EF-BP-10 module, we keep `defaultTargetKwh=10` and
    // `minKwh=5` here so existing regression tests and 5 kWh-module
    // legacy projects continue to pass.
    //
    // The OCEAN Pro Battery (EF-BP-10, 10 kWh/module) is still registered
    // in equipment-db.ts and can be manually selected from the UI; the
    // sizing-engine constants will be generalised in a follow-up commit.
    defaultTargetKwh: 10,
    minKwh: 5,
    maxKwh: 80,                   // 8 × EF-BP-10 per inverter (datasheet cap)
  },

  requiredBOSFamilies: [
    {
      category: 'inverter_base',
      qtyPolicy: 'per_inverter',
      required: true,
      note: 'OCEAN Pro PCS wall-mount bracket / stack base.',
    },
    {
      category: 'battery_combiner',
      qtyPolicy: 'fixed_one',
      required: true,
      note: 'Battery combiner / bus bar (only if battery installed).',
    },
    {
      category: 'smart_meter',
      qtyPolicy: 'fixed_one',
      required: true,
      note: 'EcoFlow OCEAN Smart Meter (grid-sensing CT).',
    },
    {
      category: 'monitoring_gateway',
      qtyPolicy: 'fixed_one',
      required: true,
      note: 'EcoFlow OCEAN Gateway or Smart Electrical Panel (includes gateway).',
    },
    {
      category: 'dc_disconnect',
      qtyPolicy: 'per_inverter',
      required: false,
      note: 'EF-PCS-24 has factory-integrated DC disconnect per datasheet.',
    },
  ],

  compatibility: {
    // HARD RULE: EcoFlow hybrid inverter can NEVER be paired with microinverters
    // (competing topology). AC-coupling another micro array to an OCEAN Pro is
    // technically possible but outside our supported install patterns.
    incompatibleTopologies: ['micro'],
    incompatibleBrands: ['enphase'],
    dcAcRatioRange: { min: 1.0, max: 1.7 },  // OCEAN Pro supports up to 40 kW DC on 24 kW AC = 1.67
    maxDcKwPerInverter: 40,                   // datasheet: 40 kW max STC input
  },

  recommendedFor: ['fence'],    // SolFence factory baseline

  // v47.429 — Stage 6: EcoFlow residential most commonly pairs with IronRidge XR
  // for roof installs; ground-mount uses MT / Unirac Solarmount. SolFence is
  // self-contained for fence deployments.
  recommendedRackingBrands: ['ironridge'],

  notes:
    'EcoFlow OCEAN Pro (EF-PCS-24) is the US-market residential hybrid ESS. ' +
    '11.5 / 24 kW AC tiers on one hardware platform; 8 MPPTs @ 5 kW each; ' +
    '40 kW max STC PV input. Pairs with stackable OCEAN Pro Battery (EF-BP-10, ' +
    '10 kWh LFP, HV 400 V DC-coupled) up to 8 modules (80 kWh) per inverter. ' +
    'UL 9540 / UL 9540A / UL 9540B certified. 15-year warranty. Legacy ' +
    'PowerOcean 5/10/20 kW (EU/AU-only) remain in supportedInverterModels ' +
    'for registry back-compat but are active:false in equipment-db.ts.',
};