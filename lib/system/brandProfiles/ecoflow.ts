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
      // v61.13d — EF-PCS-24 datasheet: "Power Scalability: Up to 2 units (48 kW)".
      // Allows the sizing engine to consider 2x 11kW when the DC array sits in
      // the 14.4-19.6 kW range where 1x 11kW gives ratio 1.25-1.70 and 1x 24kW
      // gives ratio 0.60-0.82 (below hybrid floor). 2x 11kW at e.g. 17.6 kW DC
      // gives ratio 0.765 per unit -- valid ESS operation since battery supplements
      // AC output when DC is below inverter rating. Hybrid DC/AC floor = 0.75.
      maxUnits: 2,
    },
    {
      equipmentDbId: 'ecoflow-ocean-pro-24kw',
      acKw: 24.0,
      dcKwMax: 40.0,
      mpptCount: 8,
      minPanelsPerString: 4,
      maxPanelsPerString: 16,
      // Single-unit only -- 2x 24kW = 48 kW AC for residential is over-provisioned
      // and the datasheet maximum is 2 units combined (same physical chassis).
      // The engine uses 1x 24kW when DC array >= 24 kW (ratio >= 1.00).
    },
    // NOTE v61.12: Legacy EU/AU PowerOcean SKUs (ecoflow-power-ocean-5kw/10kw/20kw)
    // removed from supportedInverterModels. They are active:false in equipment-db
    // and must not be selectable by the sizing engine. Stale projects that saved
    // one of these IDs will be redirected to ocean-pro-11kw by the active:false
    // guard in sizeInverters().
  ],

  // Sizing tiers — only use ACTIVE US SKUs (OCEAN Pro 11.5 / 24 kW).
  // v61.13d: corrected tier boundaries to reflect hybrid multi-unit design space.
  //
  // The engine uses pickRatioAwareTier() which evaluates ALL models (including
  // multi-unit configs when maxUnits > 1) and picks the one closest to the 1.25
  // preferred target while staying >= HYBRID_MIN_DC_AC_RATIO (0.75).
  // These legacy tier boundaries are only used as a FALLBACK when
  // pickRatioAwareTier falls back to pickInverterTier (undersized=true path).
  //
  // v61.13d DC/AC analysis with hybrid floor (0.75) and maxUnits=2 for 11kW:
  //
  //   Zone A:  0 - 14.4 kW DC   -> 1x 11kW  (ratio 1.00-1.25, sweet spot)
  //   Zone B: 14.4 - 19.6 kW DC -> 1x 11kW  (ratio 1.25-1.70, EcoFlow brand max)
  //            (2x 11kW ratio 0.63-0.85 -- only valid if >= 0.75 hybrid floor)
  //   Zone C: 17.25 - 24.0 kW DC -> 2x 11kW (ratio 0.75-1.04, hybrid-valid)
  //            (1x 24kW ratio 0.72-1.00 -- below hybrid floor until 18.0 kW DC)
  //   Zone D: 24.0 kW+ DC        -> 1x 24kW (ratio 1.00+)
  //
  // pickRatioAwareTier selects the option closest to 1.25 target in each zone.
  // For 17.6 kW DC: 1x 11kW=1.53, 2x 11kW=0.765 -- engine picks 1x 11kW (closer
  // to 1.25 than 0.765). For 20 kW DC: 1x 11kW=1.74 (above brand max 1.70),
  // 2x 11kW=0.87 (hybrid-valid, closer to 1.25 than 1.74).
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
    // v61.13d: lowered min from 1.0 → 0.75 to reflect hybrid ESS reality.
    // For hybrid inverters, DC/AC < 1.0 is valid: battery bank supplements AC
    // output when solar DC is below the inverter's AC rating. The OCEAN Pro
    // explicitly supports 2-unit parallel configs (datasheet: "Power Scalability:
    // Up to 2 units (48 kW)") -- a 2x 11kW config for a 17.6 kW array gives
    // ratio=0.765 per combined system, which is within the 0.75 hybrid floor.
    // Industry minimum for hybrid ESS: ~0.75-0.80. String inverter floor (1.0)
    // does NOT apply here.
    dcAcRatioRange: { min: 0.75, max: 1.7 },  // OCEAN Pro: 40 kW DC on 24 kW AC = 1.67 max
    maxDcKwPerInverter: 40,                   // datasheet: 40 kW max STC input
  },

  recommendedFor: [],    // SolFence is "just solar" + battery-agnostic — fence now defaults to Enphase IQ8 micro (per the SolFence datasheet); EcoFlow stays selectable as an ESS option but is no longer the auto-default.

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