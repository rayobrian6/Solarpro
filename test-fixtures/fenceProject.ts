/**
 * test-fixtures/fenceProject.ts
 * Deterministic solar fence project fixture — 3-segment fence, 24 panels.
 */
import type { PermitInput } from '@/lib/permit/types';

const SEGMENTS = [
  { id: 'seg-1', lengthFt: 40, panelCount: 8, azimuth: 90 },
  { id: 'seg-2', lengthFt: 50, panelCount: 10, azimuth: 180 },
  { id: 'seg-3', lengthFt: 30, panelCount: 6, azimuth: 270 },
];
const TOTAL_PANELS = SEGMENTS.reduce((sum, s) => sum + s.panelCount, 0);

function buildFencePanels() {
  const panels: any[] = [];
  let idx = 0;
  for (const seg of SEGMENTS) {
    for (let i = 0; i < seg.panelCount; i++) {
      panels.push({
        id: `fence-panel-${idx + 1}`,
        lat: 39.9526 + (idx * 0.00001),
        lng: -75.1652 + (idx * 0.00001),
        x: idx * 1.1, y: 0,
        tilt: 90, azimuth: seg.azimuth,
        wattage: 430, row: 0, col: idx,
        systemType: 'fence', orientation: 'portrait',
        placementType: 'FENCE',
      });
      idx++;
    }
  }
  return panels;
}

function buildFenceSegments() {
  return SEGMENTS.map((seg, i) => ({
    id: seg.id,
    startPoint: { lat: 39.9526 + (i * 0.0002), lng: -75.1652, x: i * 50, y: 0 },
    endPoint: { lat: 39.9526 + (i * 0.0002), lng: -75.1652 + (seg.lengthFt * 0.00000304), x: i * 50 + seg.lengthFt, y: 0 },
    lengthFt: seg.lengthFt,
    azimuth: seg.azimuth,
    panelCount: seg.panelCount,
    tilt: 90,
    bifacial: true,
    label: `Segment ${i + 1}`,
  }));
}

export const fenceProject: PermitInput = {
  project: {
    projectName: 'Golden-Fence-Regression',
    clientName: 'Bob Builder',
    address: '789 Boundary St, Philadelphia, PA 19103',
    designer: 'SolarPro Engineering',
    date: '2025-01-15',
    notes: 'Regression test fixture',
    systemType: 'solar_fence',
    mainPanelAmps: 200,
    mainPanelBrand: 'Siemens',
    utilityMeter: 'Net Meter #24680',
    utilityName: 'PECO Energy',
    acDisconnect: true,
    dcDisconnect: false,
    productionMeter: true,
    rapidShutdown: true,
    conduitType: 'EMT',
    wireGauge: '10 AWG',
    wireLength: 60,
    lat: 39.9526,
    lng: -75.1652,
    mountingSystem: 'Solar Fence Rail System',
    city: 'Philadelphia',
    state: 'PA',
    zip: '19103',
    county: 'Philadelphia',
    ahjName: 'City of Philadelphia',
    ahjWindSpeedMph: 110,
    ahjGroundSnowPsf: 20,
    ahjNecVersion: 'NEC 2023',
    panelVoc: 41.7,
    panelIsc: 13.85,
    panelWeightLbs: 44.1,
    panelLengthIn: 66.9,
    panelWidthIn: 40.9,
    panelPositions: buildFencePanels(),
    postEmbedFt: 3.5,
    postSpacingFt: 8.0,
    panelHeightFt: 6.0,
    soilResistance: 200,
  } as any,
  system: {
    totalDcKw: 10.32,
    totalAcKw: 10.0,
    totalPanels: TOTAL_PANELS,
    dcAcRatio: 1.032,
    topology: 'micro',
    inverters: [{
      manufacturer: 'Enphase',
      model: 'IQ8A',
      type: 'micro',
      // Manufacturer record (D-1): IQ8A per-unit output is 0.366 kW peak /
      // 349 VA continuous — the old fabricated `10.0` (a 10 kW "micro")
      // cascaded to a 450 A branch OCPD, which the snapshot validator (V5a)
      // now correctly fails closed on.
      acOutputKw: 0.366,
      maxDcVoltage: 60,
      efficiency: 0.97,
      ulListing: 'UL 1741 SA',
      strings: [{
        label: 'String 1', panelCount: TOTAL_PANELS,
        panelManufacturer: 'Philadelphia Solar', panelModel: 'Nexus 430BF',
        panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85,
        wireGauge: '10 AWG', wireLength: 60,
        isc: 13.85, ampacity: 30, ocpd: 20, voltageDrop: 2.0,
      }],
    }],
  },
  compliance: {
    overallStatus: 'pass',
    jurisdiction: { state: 'PA', necVersion: 'NEC 2023', ahj: 'City of Philadelphia' },
    structural: {
      wind: { windSpeed: 110, exposureCategory: 'C' },
      snow: { groundSnowLoad: 20 },
      seismic: { sdc: 'D' },
    },
  },
  layout: {
    type: 'solar_fence',
    panels: buildFencePanels(),
    geometry: { fenceSegments: buildFenceSegments() },
    fenceSegments: buildFenceSegments(),
    fenceTotalLengthFt: SEGMENTS.reduce((s, seg) => s + seg.lengthFt, 0),
    fencePostSpacingFt: 8.0,
    fencePostEmbedmentFt: 3.5,
    fenceRailCount: 3,
    fencePanelHeightFt: 6.0,
  },
};
