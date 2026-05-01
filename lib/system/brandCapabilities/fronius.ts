// ============================================================================
// lib/system/brandCapabilities/fronius.ts — Phase 2
//
// Fronius Primo string inverter CapabilityProfiles.
//
// ENGINEERING TRUTH — Fronius Primo (US):
//   • Topology: string — plain series/parallel strings, no per-module
//     electronics. NEC 690.8(A)(1) applies: design current = Isc × 1.25.
//   • All Primo residential models: 2 MPPT channels.
//   • maxInputCurrentPerMppt: 18.0A (from equipment-db Fronius Primo entries).
//   • maxParallelStringsPerMppt: 2 — Primo allows 2 parallel strings per MPPT.
//     Design check: with typical 400W panel (Isc ~9.8A):
//       1 string: 9.8 × 1.25 = 12.25A < 18A ✓
//       2 strings: 24.5A > 18A — exceeds limit → MPPT current overload.
//     THEREFORE: layout solver MUST use 1 string per MPPT for standard 400W
//     panels, despite maxParallelStringsPerMppt=2 in the profile. The solver
//     handles this via current check, not a hard-coded string limit.
//   • DC/AC ratio: 1.0–1.5 (Fronius design guide).
//   • Target: 1.25.
//
// SOURCES:
//   Fronius Primo Installation Manual (42,0410,2332,EN Rev 05)
//   Fronius Primo Technical Data Sheet
//   NEC 2023 Article 690.7, 690.8(A)(1)
// ============================================================================

import type { CapabilityProfile, MpptChannelSpec } from '../inverterCapabilities';

const DATA_VERSION = '2.0.0';

/**
 * Fronius Primo MPPT channel spec.
 * maxDcVoltage: 600V (Primo US model).
 * mpptVoltageMin: 200V (Fronius spec).
 * mpptVoltageMax: 480V (Fronius spec).
 * maxInputCurrentPerMppt: 18A (Fronius Primo datasheet).
 * maxParallelStringsPerMppt: 2 (hardware capable; current check gates actual usage).
 */
function makePrimoMppt(minPPS: number, maxPPS: number): MpptChannelSpec {
  return {
    maxDcVoltage: 600,
    mpptVoltageMin: 200,
    mpptVoltageMax: 480,
    maxInputCurrentPerMppt: 18.0,
    maxParallelStringsPerMppt: 2,
    minPanelsPerString: minPPS,
    maxPanelsPerString: maxPPS,
  };
}

export const FRONIUS_PRIMO_5_0: CapabilityProfile = {
  equipmentDbId: 'fronius-primo-5.0',
  modelName: 'Fronius Primo 5.0-1',
  brandId: 'fronius',
  brandDisplayName: 'Fronius Primo',
  topology: 'string',

  acKw: 5.0,
  dcKwMax: 7.5,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [
    makePrimoMppt(7, 16),
    makePrimoMppt(7, 16),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Primo 5.0: 2 MPPT. Best DC/AC at 1.25: 6.25 kW DC = ~15–16 panels at 400W.',
};

export const FRONIUS_PRIMO_7_6: CapabilityProfile = {
  equipmentDbId: 'fronius-primo-7.6',
  modelName: 'Fronius Primo 7.6-1',
  brandId: 'fronius',
  brandDisplayName: 'Fronius Primo',
  topology: 'string',

  acKw: 7.6,
  dcKwMax: 11.4,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [
    makePrimoMppt(7, 16),
    makePrimoMppt(7, 16),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Primo 7.6: 2 MPPT. Best DC/AC at 1.25: 9.5 kW DC = ~24 panels at 400W.',
};

export const FRONIUS_PRIMO_8_2: CapabilityProfile = {
  equipmentDbId: 'fronius-primo-8.2',
  modelName: 'Fronius Primo 8.2-1',
  brandId: 'fronius',
  brandDisplayName: 'Fronius Primo',
  topology: 'string',

  acKw: 8.2,
  dcKwMax: 12.3,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [
    makePrimoMppt(7, 16),
    makePrimoMppt(7, 16),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Primo 8.2: 2 MPPT. Best DC/AC at 1.25: 10.25 kW DC = ~26 panels at 400W.',
};

export const FRONIUS_PRIMO_10_0: CapabilityProfile = {
  equipmentDbId: 'fronius-primo-10.0',
  modelName: 'Fronius Primo 10.0-1',
  brandId: 'fronius',
  brandDisplayName: 'Fronius Primo',
  topology: 'string',

  acKw: 10.0,
  dcKwMax: 15.0,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [
    makePrimoMppt(7, 16),
    makePrimoMppt(7, 16),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Primo 10.0: 2 MPPT. Best DC/AC at 1.25: 12.5 kW DC = ~31 panels at 400W.',
};

/** All Fronius Primo CapabilityProfiles, ordered by acKw ascending. */
export const FRONIUS_CAPABILITY_PROFILES: CapabilityProfile[] = [
  FRONIUS_PRIMO_5_0,
  FRONIUS_PRIMO_7_6,
  FRONIUS_PRIMO_8_2,
  FRONIUS_PRIMO_10_0,
];