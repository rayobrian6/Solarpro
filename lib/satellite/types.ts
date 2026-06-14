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
// SatelliteAnalysisResult - combined output from full satellite analysis
// ---------------------------------------------------------------------------
export interface SatelliteAnalysisResult {
  obstructions: ObstructionDetectionResult;
  roof: RoofAnalysisResult;
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
