// ============================================================================
// lib/system/brandCapabilities/genericString.ts — Phase 2
//
// Generic string inverter CapabilityProfiles.
//
// Used as fallback when the user has not selected a specific brand.
// Mirrors the existing GENERIC_STRING_PROFILE from brandProfiles/generic-string.ts
// but expressed as CapabilityProfile objects for the new layout solver.
//
// Models: SolarEdge HD-Wave se-7600h, se-10000h (most common in catalog).
// Topology: string (conservative — no optimizer benefits assumed).
//
// ENGINEERING NOTE: The generic profile intentionally uses string topology
// rules (NEC 690.8(A)(1), Isc × 1.25) even though these SKUs are SolarEdge
// models. This ensures the layout solver produces conservative, safe designs
// when the brand is unknown. Once the user selects SolarEdge, the optimizer-
// topology rules in solarEdge.ts apply.
// ============================================================================

import type { CapabilityProfile } from '../inverterCapabilities';

const DATA_VERSION = '2.0.0';

export const GENERIC_SE_7600H: CapabilityProfile = {
  equipmentDbId: 'se-7600h',
  modelName: 'Generic String 7.6kW',
  brandId: 'generic-string',
  brandDisplayName: 'Generic String Inverter',
  topology: 'string',

  acKw: 7.6,
  dcKwMax: 11.4,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  // 1 MPPT channel (generic-string profile: single MPPT, 2 strings max).
  mpptChannels: [
    {
      maxDcVoltage: 600,
      mpptVoltageMin: 200,
      mpptVoltageMax: 480,
      maxInputCurrentPerMppt: 15,
      maxParallelStringsPerMppt: 2,
      minPanelsPerString: 8,
      maxPanelsPerString: 20,
    },
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Generic string fallback — se-7600h equipment SKU. Use SolarEdge profile when brand is known.',
};

export const GENERIC_SE_10000H: CapabilityProfile = {
  equipmentDbId: 'se-10000h',
  modelName: 'Generic String 10kW',
  brandId: 'generic-string',
  brandDisplayName: 'Generic String Inverter',
  topology: 'string',

  acKw: 10.0,
  dcKwMax: 15.0,
  dcAcRatioRange: { min: 1.0, max: 1.5 },
  dcAcRatioTarget: 1.25,

  mpptChannels: [
    {
      maxDcVoltage: 600,
      mpptVoltageMin: 200,
      mpptVoltageMax: 480,
      maxInputCurrentPerMppt: 15,
      maxParallelStringsPerMppt: 2,
      minPanelsPerString: 8,
      maxPanelsPerString: 20,
    },
  ],
  branchCircuit: null,

  optimizerMaxOutputCurrent: null,
  optimizerBusVoltage: null,

  batteryCapable: false,
  batteryRequired: false,

  dataVersion: DATA_VERSION,
  notes: 'Generic string fallback — se-10000h equipment SKU. Use SolarEdge profile when brand is known.',
};

/** All generic string CapabilityProfiles, ordered by acKw ascending. */
export const GENERIC_STRING_CAPABILITY_PROFILES: CapabilityProfile[] = [
  GENERIC_SE_7600H,
  GENERIC_SE_10000H,
];