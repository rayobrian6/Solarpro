// ============================================================================
// lib/system/brandCapabilities/enphase.ts — Phase 2
//
// Enphase IQ8 Series microinverter CapabilityProfiles.
//
// ENGINEERING TRUTH — Enphase IQ8 (US):
//   • Topology: micro — one microinverter per panel (or per module pair for
//     dual-module variants). No DC strings. No MPPT channel constraints.
//   • AC branch circuits: IQ8 units connect to Q Cable trunk runs.
//     Branch circuit breaker sizing: ceil(units × acCurrentPerUnit / 0.8)A.
//     Typical 20A breaker: floor(20 × 0.8 / acCurrentPerUnit) units max.
//   • IQ8+: 0.295kW AC, 1.21A AC output @ 240V. 13 units per 20A branch.
//   • IQ8M:  0.330kW AC, 1.39A AC output @ 240V. 11 units per 20A branch.
//   • IQ8H:  0.380kW AC, 1.59A AC output @ 240V.  9 units per 20A branch.
//   • IQ8A:  0.366kW AC, 1.53A AC output @ 240V. 10 units per 20A branch.
//   • IQ8AC: 0.384kW AC, 1.60A AC output @ 240V.  9 units per 20A branch.
//   • DC/AC ratio: always ~1.0–1.55 per-module (panel Wp ÷ micro acKw).
//   • Target: 1.25 nominal (400W panel ÷ IQ8M 330W AC = 1.21 — acceptable).
//
// SOURCES:
//   Enphase IQ8 Series Datasheet (EN-US-260-01 Rev B)
//   Enphase IQ8 Branch Circuit Design Guidelines
//   NEC 2023 Article 690.8, 625.40, 705.12(D)(2)(3)(c)
// ============================================================================

import type { CapabilityProfile, BranchCircuitSpec } from '../inverterCapabilities';

const DATA_VERSION = '2.0.0';

/**
 * NEC 80% rule: branch breaker must not be loaded above 80%.
 * maxMicrosPerBranch = floor(20A × 0.80 / acOutputCurrentPerUnit).
 * We use a 20A standard residential branch breaker.
 */
function microBranchSpec(
  acOutputCurrentPerUnit: number,
  modulesPerDevice: number,
): BranchCircuitSpec {
  const brancherAmps = 20; // standard residential 20A branch
  const maxUnits = Math.floor((brancherAmps * 0.8) / acOutputCurrentPerUnit);
  return {
    maxMicrosPerBranch: maxUnits,
    acOutputCurrentPerUnit,
    acOutputVoltage: 240,
    modulesPerDevice,
    // OCPD = ceil(maxUnits × current / 0.8), rounded to standard breaker
  };
}

export const ENPHASE_IQ8PLUS: CapabilityProfile = {
  equipmentDbId: 'enphase-iq8plus',
  modelName: 'IQ8+',
  brandId: 'enphase',
  brandDisplayName: 'Enphase IQ8',
  topology: 'micro',

  acKw: 0.295,
  dcKwMax: 0.440,
  // Per-module DC/AC: 400W panel ÷ 295W AC = 1.356 — within acceptable range.
  dcAcRatioRange: { min: 0.9, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [], // micro topology: no string MPPT channels
  branchCircuit: microBranchSpec(1.21, 1),
  // IQ8+: 1.21A AC per unit @ 240V → floor(16 / 1.21) = 13 (with 16A max)
  // NEC 80%: floor(20 × 0.8 / 1.21) = floor(13.22) = 13 units per 20A branch.

  // IQ8 Series datasheet: max DC input voltage 60 V (all variants).
  // Module cold-corrected Voc (NEC 690.7) must stay under this.
  maxDcInputV: 60,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: true, // IQ Battery ecosystem
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'IQ8+: Standard residential micro. 295W AC, 440W DC max. 13 units per 20A branch.',
};

export const ENPHASE_IQ8M: CapabilityProfile = {
  equipmentDbId: 'enphase-iq8m',
  modelName: 'IQ8M',
  brandId: 'enphase',
  brandDisplayName: 'Enphase IQ8',
  topology: 'micro',

  acKw: 0.330,
  dcKwMax: 0.460,
  dcAcRatioRange: { min: 0.9, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [],
  branchCircuit: microBranchSpec(1.39, 1),
  // NEC 80%: floor(20 × 0.8 / 1.39) = floor(11.51) = 11 units per 20A branch.

  // IQ8 Series datasheet: max DC input voltage 60 V (all variants).
  // Module cold-corrected Voc (NEC 690.7) must stay under this.
  maxDcInputV: 60,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: true,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'IQ8M: Mid-range micro. 330W AC. 11 units per 20A branch.',
};

export const ENPHASE_IQ8H: CapabilityProfile = {
  equipmentDbId: 'enphase-iq8h',
  modelName: 'IQ8H',
  brandId: 'enphase',
  brandDisplayName: 'Enphase IQ8',
  topology: 'micro',

  acKw: 0.380,
  dcKwMax: 0.600,
  dcAcRatioRange: { min: 0.9, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [],
  branchCircuit: microBranchSpec(1.59, 1),
  // NEC 80%: floor(20 × 0.8 / 1.59) = floor(10.06) = 10 units per 20A branch.

  // IQ8 Series datasheet: max DC input voltage 60 V (all variants).
  // Module cold-corrected Voc (NEC 690.7) must stay under this.
  maxDcInputV: 60,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: true,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'IQ8H: High-power micro for 500W+ panels. 380W AC. 10 units per 20A branch.',
};

export const ENPHASE_IQ8A: CapabilityProfile = {
  equipmentDbId: 'enphase-iq8a',
  modelName: 'IQ8A',
  brandId: 'enphase',
  brandDisplayName: 'Enphase IQ8',
  topology: 'micro',

  acKw: 0.366,
  dcKwMax: 0.530,
  dcAcRatioRange: { min: 0.9, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [],
  branchCircuit: microBranchSpec(1.53, 1),
  // NEC 80%: floor(20 × 0.8 / 1.53) = floor(10.46) = 10 units per 20A branch.

  // IQ8 Series datasheet: max DC input voltage 60 V (all variants).
  // Module cold-corrected Voc (NEC 690.7) must stay under this.
  maxDcInputV: 60,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: true,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'IQ8A: All-panel compatibility micro. 366W AC. 10 units per 20A branch.',
};

export const ENPHASE_IQ8AC: CapabilityProfile = {
  equipmentDbId: 'enphase-iq8ac',
  modelName: 'IQ8AC',
  brandId: 'enphase',
  brandDisplayName: 'Enphase IQ8',
  topology: 'micro',

  acKw: 0.384,
  dcKwMax: 0.530,
  dcAcRatioRange: { min: 0.9, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [],
  branchCircuit: microBranchSpec(1.60, 1),
  // NEC 80%: floor(20 × 0.8 / 1.60) = floor(10.0) = 10 units per 20A branch.

  // IQ8 Series datasheet: max DC input voltage 60 V (all variants).
  // Module cold-corrected Voc (NEC 690.7) must stay under this.
  maxDcInputV: 60,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: true,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'IQ8AC: Next-gen 384W AC micro. 10 units per 20A branch.',
};

/** All Enphase IQ8 CapabilityProfiles, ordered by acKw ascending. */
export const ENPHASE_CAPABILITY_PROFILES: CapabilityProfile[] = [
  ENPHASE_IQ8PLUS,
  ENPHASE_IQ8M,
  ENPHASE_IQ8A,
  ENPHASE_IQ8AC,
  ENPHASE_IQ8H,
];