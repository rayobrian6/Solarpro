// ============================================================================
// v47.438 - Satellite Detection Types
//
// Shared types for Phase 4 satellite/imagery analysis pipeline.
// Each detection result carries confidence + source for the
// ComputedField + ConfidenceBadge UX pattern.
//
// Detection sources:
//   - satellite:    Google/Aerial imagery ML analysis
//   - lidar:        LiDAR point cloud analysis (USGS 3DEP)
//   - street-view:  Google Street View image analysis
//   - address-lookup: Geocoded inference from address/parcel data
// ============================================================================

import type {
  ObstructionType,
  ObstructionLocation,
  RoofMaterial,
  RoofPitch,
  Obstruction,
} from '../survey/v2/types';
import type { ConfidenceLevel } from '../../components/recommend/ConfidenceBadge';

// ---------------------------------------------------------------------------
// Satellite-specific confidence source (extends the global union)
// ---------------------------------------------------------------------------
export type SatelliteSource = 'satellite' | 'lidar' | 'street-view' | 'address-lookup';

// ---------------------------------------------------------------------------
// DetectedObstruction - single obstruction from satellite analysis
// ---------------------------------------------------------------------------
export interface DetectedObstruction {
  /** Matches survey ObstructionType for direct wiring */
  type: ObstructionType;
  /** Which roof zone the obstruction occupies */
  location: ObstructionLocation;
  /** ML model confidence 0-1 (mapped to ConfidenceLevel at the UX layer) */
  confidence: number;
  /** Pixel/geometry bounding box or approximate position description */
  positionHint?: string;
  /** Source of the detection */
  source: SatelliteSource;
  /** Human-readable derivation for the "How was this computed?" toggle */
  derivation: string;
}

// ---------------------------------------------------------------------------
// ObstructionDetectionResult - full output from obstruction detection
// ---------------------------------------------------------------------------
export interface ObstructionDetectionResult {
  /** Detected obstructions sorted by confidence descending */
  obstructions: DetectedObstruction[];
  /** Total roof footprint area in sqft (from imagery/geometry) */
  totalRoofAreaSqft: number | null;
  /** Usable area after setbacks + obstructions in sqft */
  usableAreaSqft: number | null;
  /** Usable area as percentage of total (0-100) */
  usableAreaPct: number | null;
  /** Source of the area computation */
  areaSource: SatelliteSource | 'local_calc';
  /** Confidence of the usable area estimate */
  areaConfidence: ConfidenceLevel;
  /** Human-readable derivation for area computation */
  areaDerivation: string;
  /** Which detection method was actually used */
  method: 'google_maps_static' | 'overpass_api' | 'usgs_3dep' | 'heuristic' | 'none';
  /** Timestamp of the analysis */
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// DetectedRoofMaterial - roof material + pitch from satellite/imagery
// ---------------------------------------------------------------------------
export interface DetectedRoofMaterial {
  /** Detected roof material */
  material: RoofMaterial;
  /** Material detection confidence 0-1 */
  confidence: number;
  /** Source of the detection */
  source: SatelliteSource;
  /** Human-readable derivation */
  derivation: string;
}

export interface DetectedRoofPitch {
  /** Detected roof pitch category */
  pitch: RoofPitch;
  /** Estimated tilt angle in degrees */
  estimatedTiltDeg: number;
  /** Pitch detection confidence 0-1 */
  confidence: number;
  /** Source of the detection */
  source: SatelliteSource;
  /** Human-readable derivation */
  derivation: string;
}

// ---------------------------------------------------------------------------
// RoofAnalysisResult - full output from roof analysis
// ---------------------------------------------------------------------------
export interface RoofAnalysisResult {
  material: DetectedRoofMaterial | null;
  pitch: DetectedRoofPitch | null;
  /** Method used for roof analysis */
  method: 'google_maps_static' | 'overpass_api' | 'usgs_3dep' | 'heuristic' | 'none';
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// SatelliteAnalysisRequest - input to the satellite analysis pipeline
// ---------------------------------------------------------------------------
export interface SatelliteAnalysisRequest {
  latitude: number;
  longitude: number;
  /** Optional address for fallback heuristic detection */
  address?: string;
  /** Optional structure type hint (residential/commercial/industrial) */
  structureType?: 'residential' | 'commercial' | 'industrial' | '';
}

// ---------------------------------------------------------------------------
// DetectedServiceEntrance - overhead vs underground from street view / OSM
// ---------------------------------------------------------------------------
export type ServiceEntranceType = 'overhead' | 'underground';

export interface DetectedServiceEntrance {
  /** Detected service entrance type */
  entrance: ServiceEntranceType;
  /** Detection confidence 0-1 */
  confidence: number;
  /** Source of the detection */
  source: SatelliteSource;
  /** Human-readable derivation */
  derivation: string;
  /** Which detection method was actually used */
  method: 'google_street_view' | 'overpass_api' | 'heuristic' | 'none';
}

// ---------------------------------------------------------------------------
// PhotoExtractionResult - extracted data from uploaded survey photos
// ---------------------------------------------------------------------------

/** Panel brand detected from panel photo (nameplate OCR / visual match) */
export interface DetectedPanelBrand {
  /** Detected brand (maps to PanelBrand enum) */
  brand: string;
  /** Detection confidence 0-1 */
  confidence: number;
  /** Source of the detection */
  source: 'photo-ocr' | 'photo-ml' | 'heuristic';
  /** Human-readable derivation */
  derivation: string;
}

/** Breaker slot count from open panel photo */
export interface DetectedBreakerSlots {
  /** Total visible breaker slots */
  totalSlots: number;
  /** Estimated empty/available slots */
  availableSlots: number;
  /** Detection confidence 0-1 */
  confidence: number;
  /** Source */
  source: 'photo-ocr' | 'photo-ml' | 'heuristic';
  /** Derivation */
  derivation: string;
}

/** Roof condition from roof photo */
export interface DetectedRoofCondition {
  /** Detected condition */
  condition: 'good' | 'fair' | 'poor';
  /** Confidence 0-1 */
  confidence: number;
  /** Source */
  source: 'photo-ocr' | 'photo-ml' | 'heuristic';
  /** Derivation */
  derivation: string;
}

/** Combined photo extraction result */
export interface PhotoExtractionResult {
  /** Panel brand extraction from main panel photos */
  panelBrand: DetectedPanelBrand | null;
  /** Breaker slot extraction from open panel photo */
  breakerSlots: DetectedBreakerSlots | null;
  /** Roof condition extraction from roof photos */
  roofCondition: DetectedRoofCondition | null;
  /** Photo categories that were analyzed */
  analyzedCategories: string[];
  /** Timestamp */
  analyzedAt: string;
}

// ---------------------------------------------------------------------------
// BusinessRegistryResult - auto-filled company info from public registries
// ---------------------------------------------------------------------------

/** Individual field extracted from a business registry lookup */
export interface DetectedBusinessField<T> {
  /** The detected/suggested value */
  value: T;
  /** Confidence 0-1 */
  confidence: number;
  /** Source of the detection */
  source: 'opencorporates' | 'email-domain' | 'company-name-heuristic' | 'none';
  /** Human-readable derivation */
  derivation: string;
}

/** Combined result from business registry lookup */
export interface BusinessRegistryResult {
  /** Company name from registry (may be normalized/expanded) */
  companyName: DetectedBusinessField<string> | null;
  /** Phone number from registry */
  companyPhone: DetectedBusinessField<string> | null;
  /** Business address from registry */
  companyAddress: DetectedBusinessField<string> | null;
  /** Website from registry */
  companyWebsite: DetectedBusinessField<string> | null;
  /** Registry entity ID (e.g. OpenCorporates company number) */
  registryId: string | null;
  /** Registry jurisdiction (e.g. "US_AZ", "US_CA") */
  jurisdiction: string | null;
  /** Which lookup method was actually used */
  method: 'opencorporates_api' | 'email_domain' | 'company_name_heuristic' | 'none';
  /** Timestamp */
  lookedUpAt: string;
}

// ---------------------------------------------------------------------------
// SatelliteAnalysisResult - combined output from full satellite analysis
// ---------------------------------------------------------------------------
export interface SatelliteAnalysisResult {
  obstructions: ObstructionDetectionResult;
  roof: RoofAnalysisResult;
  /** Service entrance detection from street view / OSM power lines */
  serviceEntrance: DetectedServiceEntrance | null;
  /** Whether any real API was called (vs heuristic fallback) */
  liveApiUsed: boolean;
}

// ---------------------------------------------------------------------------
// Helper: map numeric confidence (0-1) to ConfidenceLevel
// ---------------------------------------------------------------------------
export function mapConfidence(n: number): ConfidenceLevel {
  if (n >= 0.75) return 'high';
  if (n >= 0.45) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Helper: convert DetectedObstruction to survey Obstruction
// (for direct wiring into StepObstructions)
// ---------------------------------------------------------------------------
export function detectedToSurveyObstruction(detected: DetectedObstruction): Obstruction {
  return {
    id: `sat_${detected.type}_${detected.location}_${Date.now().toString(36)}`,
    type: detected.type,
    location: detected.location,
    notes: `[Satellite] ${detected.derivation}`,
  };
}
