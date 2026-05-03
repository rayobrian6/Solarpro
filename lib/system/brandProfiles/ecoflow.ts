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
    // v58.14 — US OCEAN Pro (primary US SKUs, active:true in equipment-db)
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
    // NOTE v61.12: Legacy EU/AU PowerOcean SKUs (ecoflow-power-ocean-5kw/10kw/20kw)
    // removed from supportedInverterModels. They are active:false in equipment-db
    // and must not be selectable by the sizing engine. Stale projects that saved
    // one of these IDs will be redirected to ocean-pro-11kw by the active:false
    // guard in sizeInverters().
  ],

  // Sizing tiers — only use ACTIVE US SKUs (OCEAN Pro 11.5 / 24 kW).
  // v61.13: corrected tier boundary based on DC/AC ratio math.
  //
  // The engine uses pickRatioAwareTier() which evaluates ALL models and picks
  // the one closest to the 1.25 preferred target while staying >= 1.0 floor.
  // These legacy tier boundaries are only used as a FALLBACK when
  // pickRatioAwareTier falls back to pickInverterTier (undersized=true path).
  //
  // Correct DC/AC analysis:
  //   11.5 kW AC × 1.25 target = 14.4 kW DC sweet spot
  //   11.5 kW AC × 1.70 EcoFlow max = 19.6 kW DC hard ceiling (per brand spec)
  //   24.0 kW AC × 1.00 min floor  = 24.0 kW DC minimum for 24kW to be valid
  //
  // Gap zone 19.6–24.0 kW DC: only 11kW is valid (24kW ratio < 1.0).
  // pickRatioAwareTier handles this correctly by choosing 11kW even though
  // ratio > preferred window — no in-window option exists in that range.
  //
  //   • 11.5 kW AC → covers DC up to 19.6 kW (EcoFlow brand max 1.70)
  //   • 24.0 kW AC → covers DC from 24.0 kW upward (ratio >= 1.0)
  sizingTiers: [
    { minDcKw: 0,    maxDcKw: 19.6,     equipmentDbId: 'ecoflow-ocean-pro-11kw' },
    { minDcKw: 19.6, maxDcKw: Infinity, equipmentDbId: 'ecoflow-ocean-pro-24kw' },
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