/**
 * test-fixtures/groundProject.ts
 * Deterministic ground mount project fixture — 40-panel ground array.
 */
import type { PermitInput } from '@/lib/permit/types';

const PANELS_PER_ROW = 10;
const ROW_COUNT = 4;
const TOTAL_PANELS = PANELS_PER_ROW * ROW_COUNT;

function buildGroundPanels() {
  const panels: any[] = [];
  for (let row = 0; row < ROW_COUNT; row++) {
    for (let col = 0; col < PANELS_PER_ROW; col++) {
      panels.push({
        id: `ground-panel-${row * PANELS_PER_ROW + col + 1}`,
        lat: 40.7128 + (row * 0.00005),
        lng: -74.0060 + (col * 0.00002),
        x: col * 1.1,
        y: row * 2.5,
        tilt: 25,
        azimuth: 180,
        wattage: 430,
        row,
        col,
        systemType: 'ground',
        orientation: 'landscape',
      });
    }
  }
  return panels;
}

const GROUND_ARRAY_DEF = {
  id: 'array-1',
  rowCount: ROW_COUNT,
  panelsPerRow: PANELS_PER_ROW,
  tiltDeg: 25,
  azimuth: 180,
  rowSpacingFt: 12,
  groundClearanceIn: 18,
  structureType: 'driven_pile' as const,
  pileDepthFt: 5.0,
  pileSpacingFt: 8.0,
};

export const groundProject: PermitInput = {
  project: {
    projectName: 'Golden-Ground-Regression',
    clientName: 'John Smith',
    address: '456 Prairie Rd, Newark, NJ 07102',
    designer: 'SolarPro Engineering',
    date: '2025-01-15',
    notes: 'Regression test fixture',
    systemType: 'ground_mount',
    mainPanelAmps: 200,
    mainPanelBrand: 'Eaton',
    utilityMeter: 'Net Meter #67890',
    utilityName: 'PSE&G',
    acDisconnect: true,
    dcDisconnect: true,
    productionMeter: true,
    rapidShutdown: true,
    conduitType: 'PVC Schedule 40',
    wireGauge: '8 AWG',
    wireLength: 120,
    lat: 40.7128,
    lng: -74.0060,
    roofType: 'N/A',
    mountingSystem: 'Ground Mount Racking System',
    roofPitch: 0,
    city: 'Newark',
    state: 'NJ',
    zip: '07102',
    county: 'Essex',
    ahjName: 'City of Newark',
    ahjWindSpeedMph: 120,
    ahjGroundSnowPsf: 25,
    ahjNecVersion: 'NEC 2023',
    panelVoc: 41.7,
    panelIsc: 13.85,
    panelWeightLbs: 44.1,
    panelLengthIn: 66.9,
    panelWidthIn: 40.9,
    panelPositions: buildGroundPanels(),
    pileDepthFt: 5.0,
    pileSpacingFt: 8.0,
    groundClearIn: 18,
    tiltDeg: 25,
  } as any,
  system: {
    totalDcKw: 17.2,
    totalAcKw: 15.0,
    totalPanels: TOTAL_PANELS,
    dcAcRatio: 1.147,
    topology: 'string',
    inverters: [{
      manufacturer: 'SolarEdge',
      model: 'SE7600H-US',
      type: 'string',
      acOutputKw: 7.6,
      maxDcVoltage: 480,
      efficiency: 0.995,
      ulListing: 'UL 1741 SA',
      strings: [
        {
          label: 'String 1', panelCount: 20,
          panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
          panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85,
          wireGauge: '10 AWG', wireLength: 80,
          isc: 13.85, ampacity: 30, ocpd: 20, voltageDrop: 2.1,
        },
        {
          label: 'String 2', panelCount: 20,
          panelManufacturer: 'Canadian Solar', panelModel: 'CS6R-430MS',
          panelWatts: 430, panelVoc: 41.7, panelIsc: 13.85,
          wireGauge: '10 AWG', wireLength: 80,
          isc: 13.85, ampacity: 30, ocpd: 20, voltageDrop: 2.1,
        },
      ],
    }],
  },
  compliance: {
    overallStatus: 'pass',
    jurisdiction: { state: 'NJ', necVersion: 'NEC 2023', ahj: 'City of Newark' },
    structural: {
      wind: { windSpeed: 120, exposureCategory: 'C' },
      snow: { groundSnowLoad: 25 },
      seismic: { sdc: 'B' },
    },
  },
  layout: {
    type: 'ground_mount',
    panels: buildGroundPanels(),
    geometry: {
      groundArrays: [{
        id: 'array-1', rowCount: ROW_COUNT, panelsPerRow: PANELS_PER_ROW,
        tiltDeg: 25, azimuth: 180, rowSpacingFt: 12,
      }],
    },
    groundArrays: [GROUND_ARRAY_DEF],
  },
};
