// ============================================================================
// v47.437 - Survey V2: Core Types
//
// SurveyV2Draft is the in-progress survey state stored in localStorage.
// SurveyV2Payload is the final submitted payload sent to the ingest pipeline.
//
// Every field maps to a downstream engineering input:
//   - CAD engine: roof material, pitch, rafter spacing, obstructions
//   - Electrical sizing: panel brand, rating, slots, interconnection
//   - Permit plan set: stories, structure type, meter socket, service entrance
// ============================================================================

// ---------------------------------------------------------------------------
// Step 1 - Site Overview
// ---------------------------------------------------------------------------
export interface SurveySiteOverview {
  projectName: string;
  siteAddress: string;
  latitude: number | null;
  longitude: number | null;
  structureType: 'residential' | 'commercial' | 'industrial' | '';
  stories: '1' | '2' | '3+' | '';
  inspectorName: string;
  accessNotes: string;
}

// ---------------------------------------------------------------------------
// Step 2 - Roof / Mounting Conditions
// ---------------------------------------------------------------------------
export type RoofMaterial =
  | 'comp_shingle'
  | 'tile_concrete'
  | 'tile_clay'
  | 'metal_standing_seam'
  | 'metal_r_panel'
  | 'flat_tpo'
  | 'flat_epdm'
  | 'flat_torch'
  | 'wood_shake'
  | 'other';

export type RoofPitch =
  | 'flat'       // < 2 deg
  | 'low'        // 2-4 deg
  | 'standard'   // 5-9 deg
  | 'steep'      // 10-14 deg
  | 'very_steep' // 15+ deg
  | '';

export type RafterSpacing = '16' | '24' | 'other' | '';

export type RoofCondition = 'good' | 'fair' | 'poor' | '';

export interface SurveyRoofConditions {
  roofMaterial: RoofMaterial | '';
  roofPitch: RoofPitch;
  rafterSpacing: RafterSpacing;
  roofCondition: RoofCondition;
  roofAgeYears: number | null;
  atticAccess: boolean | null;
  mountingNotes: string;
}

// ---------------------------------------------------------------------------
// Step 3 - Electrical Service
// ---------------------------------------------------------------------------
export type PanelRating = '100' | '150' | '200' | '225' | '320' | '400' | 'other' | '';

export type PanelBrand =
  | 'siemens'
  | 'square_d'
  | 'eaton'
  | 'cutler_hammer'
  | 'ge'
  | 'federal_pacific'
  | 'zinsco'
  | 'leviton'
  | 'other'
  | '';

export type AvailableBreakerSlots = '0' | '1-2' | '3-4' | '5+' | '';

export type MeterSocketType = 'standard' | 'combo' | '320a' | 'other' | '';

export type InterconnectionPoint =
  | 'main_panel'
  | 'sub_panel'
  | 'load_side'
  | 'supply_side'
  | '';

export type ServiceEntrance = 'overhead' | 'underground' | '';

export interface SurveyElectricalService {
  panelRating: PanelRating;
  panelBrand: PanelBrand;
  availableBreakerSlots: AvailableBreakerSlots;
  meterSocketType: MeterSocketType;
  interconnectionPoint: InterconnectionPoint;
  serviceEntrance: ServiceEntrance;
  hasSubPanel: boolean | null;
  subPanelRating: PanelRating;
  electricalNotes: string;
}

// ---------------------------------------------------------------------------
// Step 4 - Obstructions & Layout Constraints
// ---------------------------------------------------------------------------
export type ObstructionType =
  | 'chimney'
  | 'hvac_unit'
  | 'vent_pipe'
  | 'skylight'
  | 'dormer'
  | 'tree_shade'
  | 'antenna'
  | 'satellite_dish'
  | 'exhaust_fan'
  | 'solar_tube'
  | 'other';

export type ObstructionLocation =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'ridge'
  | 'valley'
  | 'center';

export interface Obstruction {
  id: string;
  type: ObstructionType;
  location: ObstructionLocation;
  notes: string;
}

export interface SurveyObstructions {
  obstructions: Obstruction[];
  setbackNotes: string;
  estimatedUsableRoofPct: number | null; // 0-100
}

// ---------------------------------------------------------------------------
// Step 5 - Photos
// ---------------------------------------------------------------------------
export type PhotoCategory =
  | 'main_panel_open'
  | 'main_panel_closed'
  | 'meter'
  | 'roof_overview'
  | 'roof_detail'
  | 'service_entrance'
  | 'attic_access'
  | 'obstruction'
  | 'additional';

export interface SurveyPhoto {
  id: string;
  category: PhotoCategory;
  tag: string;
  url: string;       // blob/S3 URL after upload
  uploadKey: string; // storage key
  capturedAt: string;
}

export const REQUIRED_PHOTO_CATEGORIES: PhotoCategory[] = [
  'main_panel_open',
  'main_panel_closed',
  'meter',
  'roof_overview',
  'service_entrance',
];

export interface SurveyPhotos {
  photos: SurveyPhoto[];
}

// ---------------------------------------------------------------------------
// SurveyV2Draft - full in-progress state (stored in localStorage)
// ---------------------------------------------------------------------------
export interface SurveyV2Draft {
  // Token metadata
  token: string;
  projectId: string;
  projectName: string;

  // Step data
  siteOverview: SurveySiteOverview;
  roofConditions: SurveyRoofConditions;
  electricalService: SurveyElectricalService;
  obstructions: SurveyObstructions;
  photos: SurveyPhotos;

  // Progress
  currentStep: number;
  completedSteps: number[];
  lastSavedAt: string;
}

// ---------------------------------------------------------------------------
// SurveyV2Payload - final submitted payload to ingest pipeline
// ---------------------------------------------------------------------------
export interface SurveyV2Payload {
  schemaVersion: '2.0';
  surveyId: string;         // jti from JWT
  projectId: string;
  submittedAt: string;
  inspectorName: string;
  siteOverview: SurveySiteOverview;
  roofConditions: SurveyRoofConditions;
  electricalService: SurveyElectricalService;
  obstructions: SurveyObstructions;
  photos: SurveyPhoto[];
}

// ---------------------------------------------------------------------------
// Step config for the shell router
// ---------------------------------------------------------------------------
export interface SurveyStepConfig {
  id: number;
  key: string;
  label: string;
  shortLabel: string;
  required: boolean;
}

export const SURVEY_STEPS: SurveyStepConfig[] = [
  { id: 1, key: 'site',        label: 'Site Overview',            shortLabel: 'Site',    required: true },
  { id: 2, key: 'roof',        label: 'Roof & Mounting',          shortLabel: 'Roof',    required: true },
  { id: 3, key: 'electrical',  label: 'Electrical Service',       shortLabel: 'Elec',    required: true },
  { id: 4, key: 'obstructions',label: 'Obstructions & Layout',    shortLabel: 'Layout',  required: false },
  { id: 5, key: 'photos',      label: 'Photos',                   shortLabel: 'Photos',  required: true },
  { id: 6, key: 'review',      label: 'Review & Submit',          shortLabel: 'Submit',  required: true },
];