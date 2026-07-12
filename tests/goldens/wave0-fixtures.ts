// ============================================================================
// Wave 0 regression bar — shared LEGACY single-system fixtures.
// See docs/ARCHITECTURE-per-subsystem-equipment.md (§3 Wave 0, Invariant I-1).
//
// These are UNTAGGED legacy shapes (no subSystems map, no subSystemKey tags) —
// deliberately frozen so every later wave (1–6) can prove byte/number identity
// on the single-system path. DO NOT "modernize" these inputs when the contract
// types land; that would defeat their purpose.
//
// Determinism rule: no Date.now / Math.random anywhere; every value literal.
// ============================================================================

import type { ComputedSystemInput } from '../../lib/computed-system';
import type { ElectricalCalcInput } from '../../lib/electrical-calc';
import type { BOMGenerationInputV4 } from '../../lib/bom-engine-v4';

// ── Representative panel (Tesla TSP-420, real datasheet numbers — same panel
//    the nec-engine-parity drift fence uses) ─────────────────────────────────
export const PANEL = {
  id: 'tesla-tsp-420',
  model: 'TSP-420',
  manufacturer: 'Tesla',
  watts: 420, voc: 40.92, isc: 13.03, imp: 12.25, vmp: 34.29,
  tcVoc: -0.27, tcIsc: 0.04, fuse: 25,
} as const;

export const SITE = {
  designTempMin: -10, // °C
  ambientTempC: 30,   // °C
  rooftopTempAdderC: 30,
  mainPanelAmps: 200,
  panelBusRating: 200,
} as const;

// ── computeSystem — legacy ROOF STRING input (7.6 kW, 2 strings × 10) ───────
export function csStringInput(): ComputedSystemInput {
  return {
    topology: 'string', totalPanels: 20, totalStrings: 2,
    panelWatts: PANEL.watts, panelVoc: PANEL.voc, panelIsc: PANEL.isc,
    panelVmp: PANEL.vmp, panelImp: PANEL.imp,
    panelTempCoeffVoc: PANEL.tcVoc, panelTempCoeffIsc: PANEL.tcIsc,
    panelMaxSeriesFuse: PANEL.fuse, panelModel: PANEL.model, panelManufacturer: PANEL.manufacturer,
    inverterManufacturer: 'Fronius', inverterModel: 'Primo 8.2-1',
    inverterAcKw: 7.6, inverterAcCurrentMax: 32, inverterMaxDcV: 600,
    inverterMpptVmin: 100, inverterMpptVmax: 600,
    inverterMaxInputCurrentPerMppt: 17, inverterMpptChannels: 2,
    inverterModulesPerDevice: 1, inverterBranchLimit: 16,
    designTempMin: SITE.designTempMin, ambientTempC: SITE.ambientTempC,
    rooftopTempAdderC: SITE.rooftopTempAdderC,
    runLengths: {}, conduitType: 'EMT',
    mainPanelAmps: SITE.mainPanelAmps, mainPanelBrand: 'Square D',
    panelBusRating: SITE.panelBusRating, interconnectionMethod: 'LOAD_SIDE',
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
  } as ComputedSystemInput;
}

// ── computeSystem — legacy ROOF MICRO input (20 × Enphase IQ8+) ─────────────
export function csMicroInput(): ComputedSystemInput {
  return {
    topology: 'micro', totalPanels: 20,
    panelWatts: PANEL.watts, panelVoc: PANEL.voc, panelIsc: PANEL.isc,
    panelVmp: PANEL.vmp, panelImp: PANEL.imp,
    panelTempCoeffVoc: PANEL.tcVoc, panelTempCoeffIsc: PANEL.tcIsc,
    panelMaxSeriesFuse: PANEL.fuse, panelModel: PANEL.model, panelManufacturer: PANEL.manufacturer,
    inverterManufacturer: 'Enphase', inverterModel: 'IQ8PLUS-72-2-US',
    inverterAcKw: 0.29, inverterAcCurrentMax: 1.21, inverterMaxDcV: 60,
    inverterMpptVmin: 27, inverterMpptVmax: 45,
    inverterMaxInputCurrentPerMppt: 12, inverterMpptChannels: 1,
    inverterModulesPerDevice: 1, inverterBranchLimit: 13,
    designTempMin: SITE.designTempMin, ambientTempC: SITE.ambientTempC,
    rooftopTempAdderC: SITE.rooftopTempAdderC,
    runLengths: {}, conduitType: 'EMT',
    mainPanelAmps: SITE.mainPanelAmps, mainPanelBrand: 'Square D',
    panelBusRating: SITE.panelBusRating, interconnectionMethod: 'LOAD_SIDE',
    maxACVoltageDropPct: 2, maxDCVoltageDropPct: 3,
  } as ComputedSystemInput;
}

// ── electrical-calc — legacy ROOF STRING input (same physical system) ───────
export function ecStringInput(): ElectricalCalcInput {
  return {
    inverters: [{
      type: 'string', acOutputKw: 7.6, maxDcVoltage: 600,
      mpptVoltageMin: 100, mpptVoltageMax: 600,
      maxInputCurrentPerMppt: 17, acOutputCurrentMax: 32,
      strings: [10, 10].map(pc => ({
        panelCount: pc, panelVoc: PANEL.voc, panelIsc: PANEL.isc, panelImp: PANEL.imp,
        panelVmp: PANEL.vmp, panelWatts: PANEL.watts,
        tempCoeffVoc: PANEL.tcVoc, tempCoeffIsc: PANEL.tcIsc,
        maxSeriesFuseRating: PANEL.fuse, wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
      })),
    }],
    mainPanelAmps: SITE.mainPanelAmps, systemVoltage: 240,
    designTempMin: SITE.designTempMin, designTempMax: 40, rooftopTempAdder: SITE.rooftopTempAdderC,
    wireGauge: '#10 AWG', wireLength: 50, conduitType: 'EMT',
    rapidShutdown: true, acDisconnect: true, dcDisconnect: true, necVersion: '2023',
  };
}

// ── generateBOMV4 — legacy ROOF STRING input (mirrors the pre-existing
//    bom-racking-scope legacy snapshot fixture) ─────────────────────────────
export function bomStringInput(): BOMGenerationInputV4 {
  return {
    inverterId: 'fronius-primo-8.2', panelId: 'rec-alpha-pure-r-405', moduleCount: 20,
    stringCount: 2, inverterCount: 1, systemKw: 8.1,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 10, railSections: 4,
    mainPanelAmps: 200, backfeedAmps: 40, acOCPD: 40, dcOCPD: 20,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'LOAD_SIDE', panelBusRating: 200,
    includeTruckStock: false, includeSuggestedTools: false,
  } as BOMGenerationInputV4;
}

// ── generateBOMV4 — legacy ROOF MICRO input (mirrors the truck-stock fixture,
//    truck-stock/tools stages ON to pin the full stage sequence) ─────────────
export function bomMicroInput(): BOMGenerationInputV4 {
  return {
    inverterId: 'enphase-iq8plus', panelId: 'rec-alpha-pure-r-405', moduleCount: 52,
    deviceCount: 52, stringCount: 0, inverterCount: 52, systemKw: 21,
    dcWireGauge: '#10 AWG', acWireGauge: '#8 AWG',
    dcWireLength: 50, acWireLength: 60, conduitType: 'EMT', conduitSizeInch: '3/4',
    roofType: 'shingle', attachmentCount: 104, railSections: 32,
    mainPanelAmps: 200, backfeedAmps: 80, acOCPD: 80, dcOCPD: 20,
    systemType: 'roof', rackingId: 'ironridge-xr100',
    interconnectionMethod: 'SUPPLY_SIDE_TAP', panelBusRating: 200,
  } as BOMGenerationInputV4;
}

// ── Volatile-field stripper for full-object parity comparisons ──────────────
// computeSystem stamps computedAt (and nested debug ts) with new Date();
// generateBOMV4 stamps generatedAt. Everything else must be deterministic.
export function stripVolatile<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj, (key, value) =>
    key === 'computedAt' || key === 'generatedAt' || key === 'ts' ? undefined : value,
  ));
}

// Round floats so golden serialization can't wobble in the last ulp.
export const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
