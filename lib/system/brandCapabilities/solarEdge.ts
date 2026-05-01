// ============================================================================
// lib/system/brandCapabilities/solarEdge.ts — Phase 2
//
// SolarEdge HD-Wave optimizer CapabilityProfiles.
//
// ENGINEERING TRUTH — SolarEdge HD-Wave Series (US):
//   Topology: optimizer — per-module P-series optimizers regulate the
//   DC bus voltage presented to each MPPT channel.
//   Single MPPT channel per inverter (all HD-Wave residential models).
//   String Voc at the inverter = optimizer bus voltage x string length,
//   NOT the raw panel Voc — NEC 690.8(A)(2) applies, NOT (A)(1).
//   Optimizer regulated output current: 15.0A (P-series + Tigo TS4-A-O).
//   NEC 690.7 Voc check uses optimizer bus voltage per string, not raw panel.
//   DC/AC ratio: 1.0–1.55 (SolarEdge US engineering allows up to 155%).
//   Target DC/AC: 1.25 — center of the clipping-safe residential band.
//
// maxParallelStringsPerMppt:
//   SE3800H: 1 string only (9A MPPT cap, one 15A optimizer string just fits).
//   SE6000H–SE11400H: up to 5 parallel strings per MPPT. The optimizer
//   wiring supports multiple strings in parallel at the MPPT input.
//   Practical limit: the MPPT current cap (15–30A) and optimizer current
//   (15A per string) determine actual max. With no panelIsc available,
//   the string rules allow up to maxParallelStringsPerMppt; when panelIsc
//   is provided, the current gate limits actual parallel count.
//
// SOURCES:
//   SolarEdge HD-Wave Installer Manual (SE3800H–SE11400H-US)
//   SolarEdge P-Series Optimizer Datasheet (P401, P505, P650)
//   NEC 2023 Article 690.7, 690.8(A)(2)
// ============================================================================

import type { CapabilityProfile, MpptChannelSpec } from '../inverterCapabilities';

const DATA_VERSION = '2.0.0';

function makeSeOptMppt(maxCurrentA: number, maxParallelStrings: number): MpptChannelSpec {
  return {
    maxDcVoltage: 480,
    mpptVoltageMin: 250,
    mpptVoltageMax: 480,
    maxInputCurrentPerMppt: maxCurrentA,
    maxParallelStringsPerMppt: maxParallelStrings,
    minPanelsPerString: 8,
    maxPanelsPerString: 25,
  };
}

export const SE_3800H: CapabilityProfile = {
  equipmentDbId: 'se-3800h',
  modelName: 'SE3800H-US',
  brandId: 'solaredge',
  brandDisplayName: 'SolarEdge HD-Wave',
  topology: 'optimizer',

  acKw: 3.8,
  dcKwMax: 5.7,
  dcAcRatioRange: { min: 1.0, max: 1.55 },
  dcAcRatioTarget: 1.25,

  // SE3800H: 9A MPPT cap — only 1 string of 15A optimizer output fits.
  mpptChannels: [makeSeOptMppt(9, 1)],
  branchCircuit: null,

  optimizerMaxOutputCurrent: 15.0,
  optimizerBusVoltage: 380,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SE3800H-US: smallest HD-Wave model. 9A MPPT cap, 1 string. Suitable for 8–14 panels.',
};

export const SE_6000H: CapabilityProfile = {
  equipmentDbId: 'se-6000h',
  modelName: 'SE6000H-US',
  brandId: 'solaredge',
  brandDisplayName: 'SolarEdge HD-Wave',
  topology: 'optimizer',

  acKw: 6.0,
  dcKwMax: 9.0,
  dcAcRatioRange: { min: 1.0, max: 1.55 },
  dcAcRatioTarget: 1.25,

  // SE6000H: 15A MPPT cap, up to 5 parallel strings supported.
  mpptChannels: [makeSeOptMppt(15, 5)],
  branchCircuit: null,

  optimizerMaxOutputCurrent: 15.0,
  optimizerBusVoltage: 380,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SE6000H-US: 15A MPPT. Suitable for 15–22 panels at 400W.',
};

export const SE_7600H: CapabilityProfile = {
  equipmentDbId: 'se-7600h',
  modelName: 'SE7600H-US',
  brandId: 'solaredge',
  brandDisplayName: 'SolarEdge HD-Wave',
  topology: 'optimizer',

  acKw: 7.6,
  dcKwMax: 11.4,
  dcAcRatioRange: { min: 1.0, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [makeSeOptMppt(15, 5)],
  branchCircuit: null,

  optimizerMaxOutputCurrent: 15.0,
  optimizerBusVoltage: 380,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SE7600H-US: workhorse residential model. Best fit for 24–28 panels at 400W (DC/AC 1.26–1.47).',
};

export const SE_10000H: CapabilityProfile = {
  equipmentDbId: 'se-10000h',
  modelName: 'SE10000H-US',
  brandId: 'solaredge',
  brandDisplayName: 'SolarEdge HD-Wave',
  topology: 'optimizer',

  acKw: 10.0,
  dcKwMax: 15.0,
  dcAcRatioRange: { min: 1.0, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [makeSeOptMppt(15, 5)],
  branchCircuit: null,

  optimizerMaxOutputCurrent: 15.0,
  optimizerBusVoltage: 380,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SE10000H-US: 15A MPPT. Best fit for 32–37 panels at 400W (DC/AC 1.28–1.48).',
};

export const SE_11400H: CapabilityProfile = {
  equipmentDbId: 'se-11400h',
  modelName: 'SE11400H-US',
  brandId: 'solaredge',
  brandDisplayName: 'SolarEdge HD-Wave',
  topology: 'optimizer',

  acKw: 11.4,
  dcKwMax: 17.1,
  dcAcRatioRange: { min: 1.0, max: 1.55 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [makeSeOptMppt(15, 5)],
  branchCircuit: null,

  optimizerMaxOutputCurrent: 15.0,
  optimizerBusVoltage: 380,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'SE11400H-US: largest HD-Wave model. Best fit for 36–42 panels at 400W (DC/AC 1.26–1.47).',
};

/** All SolarEdge HD-Wave CapabilityProfiles, ordered smallest to largest AC. */
export const SOLAREDGE_CAPABILITY_PROFILES: CapabilityProfile[] = [
  SE_3800H,
  SE_6000H,
  SE_7600H,
  SE_10000H,
  SE_11400H,
];