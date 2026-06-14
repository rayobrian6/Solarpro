// ============================================================
// Engineering Automation System — Core Types
// Derives all data from the Design Engine (SolarEngine3D)
// ============================================================

import type { PlacedPanel, SolarPanel, Inverter, MountingSystem, Battery, Layout } from '@/types';

// ── Engineering Report Status ────────────────────────────────────────────────
export type EngineeringStatus = 'pending' | 'generating' | 'complete' | 'error' | 'stale';

// ── Design Snapshot (input to engineering) ───────────────────────────────────
// Everything engineering needs, derived from the design engine
export interface DesignSnapshot {
  projectId: string;
  layoutId: string;
  designVersionId: string;       // hash of layout for change detection
  
  // Panel geometry (from SolarEngine3D via onPanelsChange)
  panels: PlacedPanel[];
  panelCount: number;
  systemSizeKw: number;
  
  // Equipment (from DesignStudio selectedPanel/selectedInverter)
  panel: SolarPanel;
  inverter: Inverter | null;
  mounting: MountingSystem | null;
  batteries: Battery[];
  batteryCount: number;
  
  // Site geometry
  systemType: 'roof' | 'ground' | 'fence';
  roofSegments: RoofSegmentSummary[];
  groundArrays: GroundArraySummary[];
  fenceArrays: FenceArraySummary[];
  
  // Site location
  address: string;
  lat: number;
  lng: number;
  stateCode: string;
  city: string;
  county: string;
  zip: string;
  
  // Utility & AHJ
  utilityName: string;
  utilityRatePerKwh: number;
  ahj: string;
  
  // Fire setbacks
  edgeSetbackM: number;
  ridgeSetbackM: number;
  pathwayWidthM: number;
  
  capturedAt: string;

  // Satellite image — fetched during syncProjectPipeline load_project stage
  satelliteImageBase64?: string;   // data:image/jpeg;base64,...
  satelliteImageUrl?: string;
  satelliteLat?: number;
  satelliteLng?: number;
}

export interface RoofSegmentSummary {
  id: string;
  azimuthDegrees: number;
  pitchDegrees: number;
  panelCount: number;
  areaM2: number;
}

export interface GroundArraySummary {
  id: string;
  tiltDegrees: number;
  azimuthDegrees: number;
  rowCount: number;
  panelCount: number;
  rowSpacingM: number;
}

export interface FenceArraySummary {
  id: string;
  azimuthDegrees: number;
  heightM: number;
  panelCount: number;
  lengthM: number;
}

// ── Engineering Report (output) ───────────────────────────────────────────────
export interface EngineeringReport {
  id: string;
  projectId: string;
  layoutId: string;
  designVersionId: string;
  status: EngineeringStatus;
  
  // System Summary
  systemSummary: SystemSummary;
  
  // Electrical Engineering
  electrical: ElectricalEngineering;
  
  // Structural Engineering
  structural: StructuralEngineering;
  
  // Equipment Schedule
  equipmentSchedule: EquipmentSchedule;
  
  // Panel Layout (2D engineering drawing data)
  panelLayout: PanelLayoutData;
  
  // Permit Package
  permitPackage: PermitPackage;
  
  // Metadata
  generatedAt: string;
  generatedBy: string;   // 'auto' | 'manual'
  version: string;       // report version

  // ── Error 4e fix: Fields accessed via (report as any) in buildPermitCoverSheet.ts ──
  // but never declared on EngineeringReport, so data silently falls back to defaults.  ──
  // Same pattern as the APN bug on PermitInput.project.                                ──
  battery?: { count: number; model: string; kwh: number; brand: string } | null;
  clientName?: string;
  apn?: string;
  designer?: string;

  /**
   * Site Photos Available — optional section populated when project_files
   * contains photos from the survey ingest pipeline. Read-only, informational.
   * Not used in CAD, proposal, or permit generation paths.
   */
  sitePhotos?: SitePhotosSection;
}

/**
 * SitePhotosSection — summary of photos available from the site survey.
 * Populated by generateEngineeringReport() when photoCounts is provided.
 * All fields are informational only — no engineering calculations depend on them.
 */
export interface SitePhotosSection {
  /** Total number of site photos available */
  totalCount: number;
  /** Per-category photo counts */
  categoryCounts: {
    roof:        number;
    panel:       number;
    meter:       number;
    obstruction: number;
    site:        number;
    other:       number;
  };
  /** True if at least one roof photo is available */
  hasRoofPhotos: boolean;
  /** True if at least one meter or panel photo is available */
  hasElectricalPhotos: boolean;
  /** True if at least one obstruction photo is available */
  hasObstructionPhotos: boolean;
  /** Note for report consumers */
  note: string;
}

// ── System Summary ────────────────────────────────────────────────────────────
export interface SystemSummary {
  panelCount: number;
  systemSizeKw: number;
  systemSizeDcKw: number;
  systemSizeAcKw: number;
  panelModel: string;
  panelWattage: number;
  inverterModel: string;
  inverterType: string;
  mountType: string;
  systemType: string;
  address: string;
  ahj: string;
  utilityName: string;
  estimatedAnnualKwh: number;
  co2OffsetTons: number;
  roofSegmentCount: number;
  groundArrayCount: number;
  fenceArrayCount: number;

  // Satellite / vicinity map — populated by syncProjectPipeline load_project stage
  satelliteImageBase64?: string;   // data:image/jpeg;base64,... from Google Maps Static API
  satelliteImageUrl?: string;      // static maps URL (for cache invalidation / regen)
  satelliteLat?: number;
  satelliteLng?: number;
}

// ── Electrical Engineering ────────────────────────────────────────────────────
export interface ElectricalEngineering {
  // DC System
  dcSystemSizeKw: number;
  dcVoltage: number;
  stringCount: number;
  panelsPerString: number;
  stringVoc: number;
  stringVmp: number;
  stringIsc: number;
  
  // AC System
  acSystemSizeKw: number;
  acVoltage: number;
  acFrequency: number;
  
  // Wire Sizing (NEC 690)
  dcWireGauge: string;          // e.g. "#10 AWG"
  dcConduitSize: string;        // e.g. "3/4&quot; EMT"
  acWireGauge: string;
  acConduitSize: string;
  groundWireGauge: string;
  
  // Overcurrent Protection
  stringFuseAmps: number;
  dcDisconnectAmps: number;
  acBreakerAmps: number;
  mainPanelBusAmps: number;
  backfeedBreakerAmps: number;
  
  // Interconnection
  interconnectionType: string;  // 'supply-side' | 'load-side'
  interconnectionMethod: string;
  
  // Rapid Shutdown
  rapidShutdownRequired: boolean;
  rapidShutdownDevice: string;
  
  // NEC Compliance
  necVersion: string;
  complianceNotes: string[];

  // Survey-sourced fields (Phase 4 — optional, informational only)
  availableBreakerSlots?: string | null;
  serviceEntranceType?:   string | null;
  meterSocketType?:       string | null;
  hasSubPanel?:           boolean | null;
  subPanelRatingAmps?:    number | null;
}

// ── Structural Engineering ────────────────────────────────────────────────────
export interface StructuralEngineering {
  // Roof Loading
  roofType: string;
  roofPitch: number;
  rafterSize: string;
  rafterSpanFt: number;
  rafterSpacingIn: number;
  
  // Environmental Loads
  windSpeedMph: number;
  groundSnowLoadPsf: number;
  seismicZone: string;
  
  // Panel Loading
  panelWeightLbs: number;
  totalArrayWeightLbs: number;
  deadLoadPsf: number;
  
  // Mounting
  mountingSystem: string;
  attachmentType: string;
  attachmentSpacingFt: number;
  railSpacingIn: number;
  
  // Compliance
  ibc: string;
  asce: string;
  complianceNotes: string[];

  // Survey-sourced fields (Phase 4 — optional, informational only)
  roofPitchCategory?: string | null;
  roofAgeYears?:      number | null;
  soilType?:          string | null;
  // ── Error 4e fix: Fields accessed via (stru as any) in buildPermitCoverSheet.ts ──
  // but never declared on StructuralEngineering. Same silent-missing-data pattern.   ──
  stories?:              string | null;    // 'ONE STORY' | 'TWO STORY'
  roofLayers?:           number | null;    // number of roofing material layers
  roofLoadPsf?:          number | null;    // existing roof dead load (psf)
  windExposure?:         string | null;    // wind exposure category (B/C/D)
  exposureCategory?:     string | null;    // ASCE 7 risk category / exposure (I/II/III/IV)
}

// ── Equipment Schedule ────────────────────────────────────────────────────────
export interface EquipmentSchedule {
  panels: EquipmentLineItem[];
  inverters: EquipmentLineItem[];
  mounting: EquipmentLineItem[];
  electrical: EquipmentLineItem[];
  batteries: EquipmentLineItem[];
  other: EquipmentLineItem[];
}

export interface EquipmentLineItem {
  tag: string;           // e.g. "PV-1"
  description: string;
  manufacturer: string;
  model: string;
  quantity: number;
  unit: string;
  specs: string;
  notes?: string;
}

// ── Panel Layout Data ─────────────────────────────────────────────────────────
export interface PanelLayoutData {
  panels: PanelLayoutItem[];
  roofSegments: RoofSegmentLayout[];
  setbackZones: SetbackZone[];
  firePathways: FirePathway[];
  northArrow: number;    // degrees
  scale: string;         // e.g. "1:100"
  totalArea: number;     // m²
  usableArea: number;    // m² after setbacks
}

export interface PanelLayoutItem {
  id: string;
  lat: number;
  lng: number;
  x: number;             // normalized 0-1 for drawing
  y: number;
  tilt: number;
  azimuth: number;
  orientation: string;
  systemType: string;
  row: number;
  col: number;
}

export interface RoofSegmentLayout {
  id: string;
  vertices: { lat: number; lng: number }[];
  azimuth: number;
  pitch: number;
  label: string;
}

export interface SetbackZone {
  type: 'edge' | 'ridge' | 'valley' | 'hip';
  widthM: number;
  vertices: { lat: number; lng: number }[];
}

export interface FirePathway {
  type: 'ridge' | 'hip' | 'valley';
  widthM: number;
  path: { lat: number; lng: number }[];
}

// ── Permit Package ────────────────────────────────────────────────────────────
export interface PermitPackage {
  projectName: string;
  projectAddress: string;
  ahj: string;
  utilityName: string;
  contractorName: string;
  contractorLicense: string;
  systemSizeKw: number;
  panelCount: number;
  panelModel: string;
  inverterModel: string;
  mountingSystem: string;
  necVersion: string;
  interconnectionType: string;
  estimatedPermitFee: number;
  requiredDocuments: string[];
  specialConditions: string[];
  preparedDate: string;
}


// ── ProjectPhysicalData ──────────────────────────────────────────────────────
//
// Row shape read from project_physical_data table.
// Engineering reads this FIRST; falls back to hardcoded defaults only when NULL.
// Written by survey ingest pipeline (transformLayer → ingestPipeline).
// ─────────────────────────────────────────────────────────────────────────────
export interface ProjectPhysicalData {
  // Structure / Roof
  roof_material:           string | null;   // 'Asphalt Shingle' | 'Concrete Tile' | etc.
  roof_pitch:              string | null;   // 'flat' | 'low' | 'standard' | 'steep' | 'very_steep'
  rafter_spacing_in:       number | null;   // 16 | 24
  roof_condition:          string | null;   // 'good' | 'fair' | 'poor'
  roof_age_years:          number | null;
  attic_access:            boolean | null;

  // Electrical — the most critical engineering inputs
  panel_brand:             string | null;
  panel_rating_amps:       number | null;   // 100 | 150 | 200 | 225 | 320 | 400
  available_breaker_slots: string | null;   // '0' | '1-2' | '3-4' | '5+'
  meter_socket_type:       string | null;
  interconnection_point:   string | null;   // 'main_panel' | 'sub_panel' | 'load_side' | 'supply_side'
  service_entrance_type:   string | null;   // 'overhead' | 'underground'
  has_sub_panel:           boolean | null;
  sub_panel_rating_amps:   number | null;

  // Constraints
  obstructions:            unknown[];
  usable_roof_pct:         number | null;

  // Metadata
  inspector_name:          string | null;
  surveyed_at:             string | null;
  structure_type:          string | null;
  stories:                 string | null;
}

// ── DB Row (for storage) ──────────────────────────────────────────────────────
export interface EngineeringReportRow {
  id: string;
  project_id: string;
  layout_id: string;
  design_version_id: string;
  status: EngineeringStatus;
  panel_count: number;
  system_kw: number;
  mount_type: string;
  inverter_model: string;
  panel_model: string;
  roof_segments: string;      // JSON
  ground_arrays: string;      // JSON
  fence_arrays: string;       // JSON
  utility_provider: string;
  ahj: string;
  report_data: string;        // Full JSON of EngineeringReport
  generated_at: string;
  generated_by: string;
  version: string;
  created_at: string;
  updated_at: string;
}