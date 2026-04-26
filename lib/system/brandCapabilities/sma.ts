// ============================================================================
// lib/system/brandCapabilities/sma.ts — Phase 2
//
// SMA Sunny Boy string inverter CapabilityProfiles.
//
// ENGINEERING TRUTH — SMA Sunny Boy (US):
//   • Topology: string — plain series/parallel strings, no per-module
//     electronics. NEC 690.8(A)(1) applies: design current = Isc × 1.25.
//   • SB 5.0-US: 2 MPPT channels, maxInputCurrentPerMppt 15A, max 600V DC.
//     With typical 400W panel (Isc ~9.8A): design current = 12.25A/string.
//     2 parallel strings: 24.5A > 15A → 1 string per MPPT only.
//   • SB 7.7-US: 3 MPPT channels (v47.433 drift fix), 15A per MPPT, 600V.
//     Same 1-string-per-MPPT constraint for conservative design.
//   • SB 10.0-US: 2 MPPT channels, maxParallelStringsPerMppt=6 via external
//     combiner box (TL-US datasheet). Discontinued but in equipment-db.
//   • DC/AC ratio: 1.0–1.5 (SMA US design guide).
//   • Target: 1.25.
//
// SOURCES:
//   SMA Sunny Boy 5.0/6.0/7.7/10.0-US Installation Manual
//   SMA US Product Catalog (2023)
//   NEC 2023 Article 690.7, 690.8(A)(1)
// ============================================================================

import type { CapabilityProfile, MpptChannelSpec } from '../inverterCapabilities';

const DATA_VERSION = '2.0.0';

/** SMA Sunny Boy 5.0-US: 2 MPPT channels, 600V, 15A/MPPT, 1 string per MPPT. */
function makeSbMppt(
  maxCurrentA: number,
  maxParallelStrings: number,
  minPPS: number,
  maxPPS: number,
): MpptChannelSpec {
  return {
    maxDcVoltage: 600,
    mpptVoltageMin: 125,
    mpptVoltageMax: 480,
    maxInputCurrentPerMppt: maxCurrentA,
    maxParallelStringsPerMppt: maxParallelStrings,
    minPanelsPerString: minPPS,
    maxPanelsPerString: maxPPS,
  };
}

export const SMA_SB_5_0: CapabilityProfile = {
  equipmentDbId: 'sma-sb-5.0',
  modelName: 'SB5.0-1SP-US-40',
  brandId: 'sma',
  brandDisplayName: 'SMA Sunny Boy',
  topology: 'string',

  acKw: 5.0,
  dcKwMax: 7.5,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  // 2 MPPT channels; 1 string per MPPT (design current constraint).
  mpptChannels: [
    makeSbMppt(15, 1, 5, 11),
    makeSbMppt(15, 1, 5, 11),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SB5.0: 2 MPPT, 1 string/MPPT. Fits 2×5–11 panels (10–22 total). Small arrays only.',
};

export const SMA_SB_7_7: CapabilityProfile = {
  equipmentDbId: 'sma-sb-7.7',
  modelName: 'SB7.7-1SP-US-40',
  brandId: 'sma',
  brandDisplayName: 'SMA Sunny Boy',
  topology: 'string',

  acKw: 7.7,
  dcKwMax: 11.55,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  // 3 MPPT channels (v47.433 drift fix — SMA SB7.7 has 3 MPPT per US-41 datasheet).
  // 1 string per MPPT conservatively (15A cap vs 12.25A design current).
  mpptChannels: [
    makeSbMppt(15, 1, 6, 14),
    makeSbMppt(15, 1, 6, 14),
    makeSbMppt(15, 1, 6, 14),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SB7.7: 3 MPPT, 1 string/MPPT. Fits 3×6–14 panels (18–42 total). Residential sweet spot.',
};

export const SMA_SB_10_0: CapabilityProfile = {
  equipmentDbId: 'sma-sb-10.0',
  modelName: 'SB10.0-1SP-US-40',
  brandId: 'sma',
  brandDisplayName: 'SMA Sunny Boy',
  topology: 'string',

  acKw: 10.0,
  dcKwMax: 15.0,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  // 2 MPPT channels; up to 6 parallel strings via external combiner (TL-US datasheet).
  mpptChannels: [
    makeSbMppt(15, 6, 8, 16),
    makeSbMppt(15, 6, 8, 16),
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SB10.0: 2 MPPT, up to 6 parallel strings via combiner. Discontinued but in equipment-db.',
};

/** All SMA Sunny Boy CapabilityProfiles, ordered by acKw ascending. */
export const SMA_CAPABILITY_PROFILES: CapabilityProfile[] = [
  SMA_SB_5_0,
  SMA_SB_7_7,
  SMA_SB_10_0,
];