/**
 * Audit 5 — E2E Flow Test
 *
 * Tests the full data path:
 *   SurveyV2Payload → transform() → PhysicalDataOutput
 *   → (simulated getProjectPhysicalData) → ProjectPhysicalData
 *   → generateEngineeringReport() → verifies real values used, not defaults
 */

import { transform } from '../lib/survey/ingest/transformLayer';
import { generateEngineeringReport } from '../lib/engineering/reportGenerator';
import type { SurveyV2Payload } from '../lib/survey/v2/types';
import type { TransformInput, IngestContext } from '../lib/survey/ingest/types';
import type { ProjectPhysicalData } from '../lib/engineering/types';
import type { DesignSnapshot } from '../lib/engineering/types';
import type { SurveyCompletedEvent } from '../lib/survey/types';
import type { SolarPanel, Inverter, MountingSystem } from '../types';

// ─── Test payload with known values ──────────────────────────────────────────

const TEST_PAYLOAD: SurveyV2Payload = {
  schemaVersion: '2.0',
  surveyId: 'e2e-test-survey-001',
  projectId: 'e2e-test-project-001',
  submittedAt: '2025-01-15T10:30:00Z',
  inspectorName: 'Jane Smith',
  siteOverview: {
    projectName: 'E2E Test Project',
    siteAddress: '123 Test St, San Jose, CA 95101',
    latitude: 37.3382,
    longitude: -121.8863,
    structureType: 'residential',
    stories: '2',
    inspectorName: 'Jane Smith',
    accessNotes: 'Gate code 1234',
  },
  roofConditions: {
    roofMaterial: 'comp_shingle',   // → 'Asphalt Shingle'
    roofPitch: 'standard',          // → valid RoofPitch value
    rafterSpacing: '16',            // → 16  (NOT the 24 default)
    roofCondition: 'good',
    roofAgeYears: 8,
    atticAccess: true,
    mountingNotes: 'Standard comp shingle mount',
  },
  electricalService: {
    panelBrand: 'square_d',         // → 'Square D'
    panelRating: '150',             // → 150  (NOT the 200 default)
    availableBreakerSlots: '3-4',
    meterSocketType: 'standard',
    interconnectionPoint: 'load_side',
    serviceEntrance: 'overhead',
    hasSubPanel: false,
    subPanelRating: '',
    electricalNotes: 'Panel is on east wall',
  },
  obstructions: {
    obstructions: [
      { id: 'obs-1', type: 'hvac_unit', location: 'center', notes: 'Central AC unit' },
      { id: 'obs-2', type: 'skylight', location: 'south', notes: 'Small skylight' },
    ],
    setbackNotes: '',
    estimatedUsableRoofPct: 72,
  },
  photos: [],
};

// ─── Mock SurveyCompletedEvent ───────────────────────────────────────────────

const TEST_EVENT: SurveyCompletedEvent = {
  event: 'survey.completed',
  schemaVersion: '2.0',
  event_id: 'evt-e2e-001',
  survey_id: 'e2e-test-survey-001',
  completed_at: '2025-01-15T10:30:00Z',
};

const TEST_CONTEXT: IngestContext = {
  deliveryId: 'del-e2e-001',
  ownerId: 'owner-001',
  event: TEST_EVENT,
  traceId: 'trace-e2e-001',
  partnerProjectId: null,
  receivedAt: '2025-01-15T10:30:00Z',
};

const TRANSFORM_INPUT: TransformInput = {
  event: TEST_EVENT,
  rawPayload: TEST_PAYLOAD as any,
  linkResolution: {
    action: 'create',
    strategy: 'CREATE_ORPHAN',
    surveyExternalId: 'e2e-test-survey-001',
  },
  context: TEST_CONTEXT,
};

// ─── Minimal DesignSnapshot ───────────────────────────────────────────────────

const TEST_PANEL: SolarPanel = {
  id: 'panel-001',
  manufacturer: 'REC',
  model: 'Alpha Pure-R 400W',
  wattage: 400,
  efficiency: 22.3,
  width: 1.016,
  height: 1.755,
  bifacial: false,
  bifacialFactor: 1.0,
  temperatureCoeff: -0.26,
  pricePerWatt: 0.45,
};

const TEST_INVERTER: Inverter = {
  id: 'inv-001',
  manufacturer: 'Enphase',
  model: 'IQ8+',
  type: 'micro',
  capacity: 8.0,
  efficiency: 97.5,
  mpptChannels: 20,
  batteryCompatible: true,
  pricePerUnit: 180,
};

const TEST_MOUNTING: MountingSystem = {
  id: 'mnt-001',
  name: 'IronRidge XR100',
  manufacturer: 'IronRidge',
  type: 'roof',
  pricePerWatt: 0.18,
  description: 'Rail-based roof mount',
};

const TEST_SNAPSHOT: DesignSnapshot = {
  projectId: 'e2e-test-project-001',
  layoutId: 'layout-001',
  designVersionId: 'dv-001',
  systemSizeKw: 8.0,
  panelCount: 20,
  lat: 37.34,
  lng: -121.89,
  stateCode: 'CA',
  address: '123 Test St, San Jose, CA 95101',
  city: 'San Jose',
  county: 'Santa Clara',
  zip: '95101',
  ahj: 'San Jose Building Dept',
  utilityName: 'PG&E',
  utilityRatePerKwh: 0.28,
  systemType: 'roof',
  edgeSetbackM: 0.46,
  ridgeSetbackM: 0.46,
  pathwayWidthM: 0.91,
  capturedAt: '2025-01-15T10:00:00Z',
  panel: TEST_PANEL,
  inverter: TEST_INVERTER,
  mounting: TEST_MOUNTING,
  batteries: [],
  batteryCount: 0,
  panels: [],
  roofSegments: [
    { id: 'seg-001', pitchDegrees: 18, azimuthDegrees: 195, panelCount: 20, areaM2: 45 },
  ],
  groundArrays: [],
  fenceArrays: [],
};

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, got?: unknown, expected?: unknown): void {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    const detail = got !== undefined ? `\n       got=${JSON.stringify(got)}  expected=${JSON.stringify(expected)}` : '';
    console.error(`  ❌  ${label}${detail}`);
    failures.push(label);
    failed++;
  }
}

function eq<T>(label: string, got: T, expected: T): void {
  assert(label, got === expected, got, expected);
}

// ─── STEP 1: Transform layer ──────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('STEP 1: transform() → physicalData fields');
console.log('══════════════════════════════════════════════════════════════════');

const result = transform(TRANSFORM_INPUT);
assert('transform() returns ok=true', result.ok === true, (result as any).error);

if (!result.ok) {
  console.error('FATAL: transform failed:', (result as any).error);
  process.exit(1);
}

const pd = result.output.physicalData;
assert('physicalData is not null', pd !== null, pd);

if (!pd) {
  console.error('FATAL: physicalData is null — cannot continue');
  process.exit(1);
}

// Roof
eq('roof_material = "Asphalt Shingle" (from comp_shingle)', pd.roof_material, 'Asphalt Shingle');
eq('roof_pitch mapped (not null)', pd.roof_pitch !== null, true);
eq('rafter_spacing_in = 16  ← CRITICAL: must not be 24 default', pd.rafter_spacing_in, 16);
eq('roof_condition = "good" (passthrough, no normalization)', pd.roof_condition, 'good');
eq('roof_age_years = 8', pd.roof_age_years, 8);
eq('attic_access = true', pd.attic_access, true);

// Electrical
eq('panel_brand = "Square D" (from square_d)', pd.panel_brand, 'Square D');
eq('panel_rating_amps = 150  ← CRITICAL: must not be 200 default', pd.panel_rating_amps, 150);
eq('available_breaker_slots = "3-4"', pd.available_breaker_slots, '3-4');
eq('interconnection_point = "load_side"', pd.interconnection_point, 'load_side');
eq('service_entrance_type mapped (not null)', pd.service_entrance_type !== null, true);
eq('has_sub_panel = false', pd.has_sub_panel, false);

// Metadata
eq('inspector_name = "Jane Smith"', pd.inspector_name, 'Jane Smith');
eq('usable_roof_pct = 72', pd.usable_roof_pct, 72);
assert('obstructions array has 2 items', Array.isArray(pd.obstructions) && (pd.obstructions as any[]).length === 2, (pd.obstructions as any[])?.length, 2);

// ─── STEP 2: Simulate getProjectPhysicalData() ────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('STEP 2: Simulated DB round-trip (ProjectPhysicalData)');
console.log('══════════════════════════════════════════════════════════════════');

// Mirrors the mapping done in lib/db-neon.ts getProjectPhysicalData()
const simulatedDbRow: ProjectPhysicalData = {
  roof_material:           pd.roof_material,
  roof_pitch:              pd.roof_pitch,
  rafter_spacing_in:       pd.rafter_spacing_in,
  roof_condition:          pd.roof_condition,
  roof_age_years:          pd.roof_age_years,
  attic_access:            pd.attic_access,
  panel_brand:             pd.panel_brand,
  panel_rating_amps:       pd.panel_rating_amps,
  available_breaker_slots: pd.available_breaker_slots,
  meter_socket_type:       pd.meter_socket_type,
  interconnection_point:   pd.interconnection_point,
  service_entrance_type:   pd.service_entrance_type,
  has_sub_panel:           pd.has_sub_panel,
  sub_panel_rating_amps:   pd.sub_panel_rating_amps,
  obstructions:            pd.obstructions,
  usable_roof_pct:         pd.usable_roof_pct,
  inspector_name:          pd.inspector_name,
  surveyed_at:             pd.surveyed_at,
  structure_type:          pd.structure_type,
  stories:                 pd.stories,
};

eq('simulatedDbRow.panel_rating_amps = 150', simulatedDbRow.panel_rating_amps, 150);
eq('simulatedDbRow.rafter_spacing_in = 16', simulatedDbRow.rafter_spacing_in, 16);
eq('simulatedDbRow.roof_material = "Asphalt Shingle"', simulatedDbRow.roof_material, 'Asphalt Shingle');
eq('simulatedDbRow.interconnection_point = "load_side"', simulatedDbRow.interconnection_point, 'load_side');

// ─── STEP 3: Engineering report with real data vs. null ───────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('STEP 3: generateEngineeringReport() — real data vs. defaults');
console.log('══════════════════════════════════════════════════════════════════');

const reportWithData = generateEngineeringReport(TEST_SNAPSHOT, 'report-with-data', simulatedDbRow);
const reportNoData   = generateEngineeringReport(TEST_SNAPSHOT, 'report-no-data', null);

console.log('\n  Electrical overrides:');
eq('  WITH data: mainPanelBusAmps = 150 (survey)', reportWithData.electrical.mainPanelBusAmps, 150);
eq('  NO data:   mainPanelBusAmps = 200 (hardcoded default)', reportNoData.electrical.mainPanelBusAmps, 200);
eq('  WITH data: interconnectionType = "load-side" (from load_side)', reportWithData.electrical.interconnectionType, 'load-side');

console.log('\n  Structural overrides:');
eq('  WITH data: rafterSpacingIn = 16 (survey, not 24 default)', reportWithData.structural.rafterSpacingIn, 16);
eq('  NO data:   rafterSpacingIn = 24 (hardcoded default)', reportNoData.structural.rafterSpacingIn, 24);
eq('  WITH data: roofType = "Asphalt Shingle" (survey)', reportWithData.structural.roofType, 'Asphalt Shingle');

// ─── STEP 4: Default isolation ────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('STEP 4: Default isolation — verify 4 fields differ with/without data');
console.log('══════════════════════════════════════════════════════════════════');

assert(
  'mainPanelBusAmps: real(150) ≠ default(200)',
  reportWithData.electrical.mainPanelBusAmps !== reportNoData.electrical.mainPanelBusAmps,
);
assert(
  'rafterSpacingIn: real(16) ≠ default(24)',
  reportWithData.structural.rafterSpacingIn !== reportNoData.structural.rafterSpacingIn,
);

// Test supply_side path
const supplyData: ProjectPhysicalData = { ...simulatedDbRow, panel_rating_amps: 400, interconnection_point: 'supply_side' };
const reportSupply = generateEngineeringReport(TEST_SNAPSHOT, 'report-supply', supplyData);
eq('  400A panel flows through (not clamped to 200)', reportSupply.electrical.mainPanelBusAmps, 400);
eq('  supply_side → interconnectionType = "supply-side"', reportSupply.electrical.interconnectionType, 'supply-side');

// Test sub_panel path
const subPanelData: ProjectPhysicalData = { ...simulatedDbRow, interconnection_point: 'sub_panel' };
const reportSubPanel = generateEngineeringReport(TEST_SNAPSHOT, 'report-subpanel', subPanelData);
eq('  sub_panel → interconnectionType = "supply-side"', reportSubPanel.electrical.interconnectionType, 'supply-side');

// Test main_panel path
const mainPanelData: ProjectPhysicalData = { ...simulatedDbRow, interconnection_point: 'main_panel' };
const reportMainPanel = generateEngineeringReport(TEST_SNAPSHOT, 'report-mainpanel', mainPanelData);
eq('  main_panel → interconnectionType = "load-side"', reportMainPanel.electrical.interconnectionType, 'load-side');

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`AUDIT 5 E2E: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════');

if (failed > 0) {
  console.error('\nFAILED ASSERTIONS:');
  failures.forEach(f => console.error(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\n✅  ALL ASSERTIONS PASSED — E2E PIPELINE VERIFIED');
  process.exit(0);
}