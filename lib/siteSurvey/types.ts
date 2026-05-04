// ============================================================================
// lib/siteSurvey/types.ts — Site Survey Canonical Data Model
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// This is the canonical SiteSurvey object — the single source of truth for
// all field-captured site data. It is the direct counterpart of the bill
// pipeline's BillExtractResult.
//
// PIPELINE POSITION:
//   RawSurveyPayload (field app)
//     → normalizeSurvey()   → NormalizedSiteSurvey
//     → enrichSurvey()      → EnrichedSiteSurvey
//     → applyToSystemDefinition() → SystemDefinition (override layer only)
//     → buildCADFromSurvey()      → CADModel inputs
//     → engineeringIntegration()  → StructuralInput overrides
//     → electricalFromSurvey()    → ElectricalDefinition overrides
//     → permitIntegration()       → PermitInput patches
//
// ARCHITECTURE RULES:
//   - RawSurveyPayload is NEVER consumed downstream directly
//   - All downstream modules consume NormalizedSiteSurvey or EnrichedSiteSurvey
//   - EnrichedSiteSurvey fields are STRICTLY computed — never raw values
//   - Derived feasibility flags are read-only computed outputs, not inputs
//   - Survey data acts as OVERRIDE layer only — never source of truth for
//     values already confirmed by the existing design pipeline
// ============================================================================

// ─── Version ─────────────────────────────────────────────────────────────────

export const SITE_SURVEY_PIPELINE_VERSION = 1 as const;

// ─── System Type ─────────────────────────────────────────────────────────────

/** Matches SystemDefinition's SystemType — 'roof' | 'ground' | 'fence' */
export type SurveySystemType = 'roof' | 'ground' | 'fence';

// ─── Geometry Types ───────────────────────────────────────────────────────────

/** A 2D point in lat/lng space */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A 2D point in local metric space (meters from origin) */
export interface LocalPoint {
  x: number;
  y: number;
}

/** A roof plane captured during survey */
export interface SurveyRoofPlane {
  /** Unique identifier for this plane within the survey */
  id: string;
  /** Pitch in degrees from horizontal (0 = flat, 45 = steep) */
  pitch: number;
  /** Azimuth in degrees (0=N, 90=E, 180=S, 270=W) */
  azimuth: number;
  /** Total measured area in square feet */
  area: number;
  /** Polygon vertices in lat/lng (minimum 3 points) */
  vertices: GeoPoint[];
}

/** An obstruction on the roof or mounting surface */
export interface SurveyObstruction {
  /** Unique identifier for this obstruction */
  id: string;
  /** Type of obstruction */
  type:
    | 'skylight'
    | 'vent_pipe'
    | 'hvac'
    | 'chimney'
    | 'antenna'
    | 'dormer'
    | 'solar_tube'
    | 'other';
  /** Position in lat/lng */
  position: GeoPoint;
  /** Physical dimensions */
  dimensions: {
    widthFt: number;
    lengthFt: number;
    heightFt: number;
  };
  /** NEC-required setback from this obstruction (feet) */
  setbackFt?: number;
  /** Free-form notes about this obstruction */
  notes?: string;
}

/** A setback boundary for a roof edge or fire pathway */
export interface SurveySetback {
  /** Which edge(s) this setback applies to */
  edges: Array<'eave' | 'rake' | 'ridge' | 'valley' | 'hip'>;
  /** Setback distance in inches */
  distanceIn: number;
  /** AHJ-specific reference if applicable */
  reference?: string;
}

// ─── Structural Types ─────────────────────────────────────────────────────────

/** Wind exposure category per ASCE 7-22 */
export type WindExposureCategory = 'B' | 'C' | 'D';

/** Rafter size in nominal lumber form */
export type RafterSize =
  | '2x4'
  | '2x6'
  | '2x8'
  | '2x10'
  | '2x12'
  | 'other';

// ─── Electrical Types ─────────────────────────────────────────────────────────

/** Main electrical panel brand */
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
  | 'unknown';

/** Service entrance type */
export type ServiceEntrance = 'overhead' | 'underground' | 'unknown';

/** Meter socket type */
export type MeterSocketType = 'standard' | 'combo' | '320a' | 'other' | 'unknown';

/** Interconnection point for solar tie-in */
export type InterconnectionPoint =
  | 'main_panel'
  | 'sub_panel'
  | 'load_side'
  | 'supply_side'
  | 'unknown';

// ─── Photo Types ─────────────────────────────────────────────────────────────

export interface SurveyPhotoRef {
  /** Unique key for the photo slot (matches PHOTO_SLOTS in SurveyFormV2) */
  slotKey: string;
  /** Storage URL or base64 data URI */
  url: string;
  /** Category for permit plan set placement */
  category: 'roof' | 'panel' | 'meter' | 'obstruction' | 'site' | 'other';
  /** Capture timestamp (ISO 8601) */
  capturedAt?: string;
  /** Notes from the field inspector */
  notes?: string;
}

/**
 * Photo — normalized shape of a project_files row for use in the SiteSurvey
 * pipeline. Produced by lib/files/getProjectFiles.ts and attached via
 * lib/siteSurvey/fromPhysicalData.ts.
 *
 * Distinct from SurveyPhotoRef: this is the DB-sourced shape, carrying raw
 * metadata for downstream traceability. SurveyPhotoRef is the field-app shape.
 */
export interface Photo {
  /** Absolute URL or relative path to the photo (from project_files.url) */
  url: string;
  /**
   * Category inferred from the file name prefix in project_files.
   * Matches SurveyPhotoRef.category values.
   */
  category?: 'roof' | 'panel' | 'meter' | 'obstruction' | 'site' | 'other';
  /**
   * Raw DB metadata for traceability (id, name, file_type, status, notes).
   * Safe to pass downstream — no PII, no secrets.
   */
  metadata?: Record<string, unknown>;
  /** ISO timestamp from project_files.created_at */
  createdAt?: string;
}

/**
 * SurveyPhotoCounts — per-category counts computed by enrichSurvey().
 * Derived from NormalizedSiteSurvey.photos (SurveyPhotoRef[]).
 * All counts are zero when photos are absent.
 */
export interface SurveyPhotoCounts {
  /** Total photo count across all categories */
  total: number;
  /** Number of roof photos */
  roofCount: number;
  /** Number of obstruction photos */
  obstructionCount: number;
  /** Number of meter/panel photos */
  meterCount: number;
  /** Number of panel photos (individual panel-level shots) */
  panelCount: number;
  /** Number of site overview photos */
  siteCount: number;
  /** Number of photos with unrecognized category */
  otherCount: number;
}

// ─── Raw Survey Payload (INPUT — from field app) ─────────────────────────────
//
// This is what arrives from the partner field app or direct survey submission.
// It is LOOSE and PERMISSIVE — real-world field data is messy.
// ALL downstream modules must consume NormalizedSiteSurvey, never this.

export interface RawSurveyPayload {
  /** SolarPro-assigned survey ID */
  id: string;
  /** SolarPro project ID this survey belongs to */
  projectId: string;

  // ─── Location ───────────────────────────────────────────────────────────
  location: {
    lat?: number | null;
    lng?: number | null;
    /** Elevation in feet (optional — from GPS) */
    elevation?: number | null;
    /** True North azimuth reference correction (degrees) */
    azimuthReference?: number | null;
    /** Address string from field app */
    address?: string | null;
  };

  // ─── System Context ──────────────────────────────────────────────────────
  systemType?: SurveySystemType | string | null;

  // ─── Geometry ────────────────────────────────────────────────────────────
  geometry?: {
    roofPlanes?: Array<Partial<SurveyRoofPlane>> | null;
    obstructions?: Array<Partial<SurveyObstruction>> | null;
    setbacks?: Array<Partial<SurveySetback>> | null;
    /** Usable area in sq ft (field-measured or estimated) */
    usableAreaSqFt?: number | null;
  } | null;

  // ─── Structural ──────────────────────────────────────────────────────────
  structural?: {
    /** Rafter spacing in inches on center */
    rafterSpacingIn?: number | string | null;
    rafterSize?: RafterSize | string | null;
    /** Decking thickness in inches */
    deckingThicknessIn?: number | string | null;
    windExposure?: WindExposureCategory | string | null;
    /** Ground snow load in psf (from AHJ lookup or field estimate) */
    snowLoadPsf?: number | null;
    /** Roof condition */
    roofCondition?: 'good' | 'fair' | 'poor' | string | null;
    /** Roof age in years */
    roofAgeYears?: number | null;
    /** Attic access available */
    atticAccess?: boolean | null;
    /** Roof material */
    roofMaterial?: string | null;
    /** Roof pitch (categorical) */
    roofPitch?: string | null;
    /** Number of stories */
    stories?: string | null;
    /** Structure type */
    structureType?: string | null;
  } | null;

  // ─── Electrical ──────────────────────────────────────────────────────────
  electrical?: {
    /** Main panel amperage rating */
    mainPanelRatingAmps?: number | string | null;
    /** Bus bar rating in amps */
    busbarRatingAmps?: number | string | null;
    /** Number of available breaker spaces */
    breakerSpacesAvailable?: number | string | null;
    serviceEntrance?: ServiceEntrance | string | null;
    meterType?: MeterSocketType | string | null;
    interconnectionPoint?: InterconnectionPoint | string | null;
    panelBrand?: PanelBrand | string | null;
    /** Whether sub-panel exists */
    hasSubPanel?: boolean | null;
    /** Sub-panel rating in amps */
    subPanelRatingAmps?: number | string | null;
    /** Available breaker slots (categorical: '0' | '1-2' | '3-4' | '5+') */
    availableBreakerSlots?: string | null;
  } | null;

  // ─── Photos ──────────────────────────────────────────────────────────────
  photos?: Array<Partial<SurveyPhotoRef>> | null;

  // ─── Notes ───────────────────────────────────────────────────────────────
  installerNotes?: string | null;

  // ─── Metadata ────────────────────────────────────────────────────────────
  inspectorName?: string | null;
  surveyedAt?: string | null;
  schemaVersion?: string | null;
}

// ─── Normalized Site Survey (POST-NORMALIZATION) ──────────────────────────────
//
// Output of normalizeSurvey(). All units standardized, types validated,
// defaults applied. Still a "raw capture" — no derived/computed fields.

export interface NormalizedSiteSurvey {
  /** Survey ID */
  id: string;
  /** Project ID */
  projectId: string;
  /** Pipeline version that produced this */
  pipelineVersion: typeof SITE_SURVEY_PIPELINE_VERSION;

  // ─── Location ───────────────────────────────────────────────────────────
  location: {
    lat: number | null;
    lng: number | null;
    elevation: number | null;       // feet
    azimuthReference: number | null; // degrees correction
    address: string | null;
  };

  // ─── System Context ──────────────────────────────────────────────────────
  systemType: SurveySystemType;

  // ─── Geometry ────────────────────────────────────────────────────────────
  geometry: {
    /** Validated roof planes (all required fields present) */
    roofPlanes: SurveyRoofPlane[];
    /** Validated obstructions */
    obstructions: SurveyObstruction[];
    /** Validated setbacks */
    setbacks: SurveySetback[];
    /** Usable area in sq ft (from field or fallback null) */
    usableAreaSqFt: number | null;
  };

  // ─── Structural ──────────────────────────────────────────────────────────
  structural: {
    /** Rafter spacing in inches — normalized to number, default 24 if unknown */
    rafterSpacingIn: number;
    /** Rafter size — normalized to canonical form */
    rafterSize: RafterSize;
    /** Decking thickness in inches — default 0.5 if unknown */
    deckingThicknessIn: number;
    /** Wind exposure category */
    windExposure: WindExposureCategory;
    /** Ground snow load in psf — null if not captured */
    snowLoadPsf: number | null;
    roofCondition: 'good' | 'fair' | 'poor' | null;
    roofAgeYears: number | null;
    atticAccess: boolean | null;
    roofMaterial: string | null;
    /** Normalized roof pitch category */
    roofPitch: 'flat' | 'low' | 'standard' | 'steep' | 'very_steep' | null;
    /** Pitch in degrees (derived from roofPitch category) */
    roofPitchDegrees: number | null;
    stories: string | null;
    structureType: string | null;
  };

  // ─── Electrical ──────────────────────────────────────────────────────────
  electrical: {
    /** Main panel rating in amps — null if not captured */
    mainPanelRatingAmps: number | null;
    /** Bus bar rating in amps — defaults to mainPanelRatingAmps if not captured */
    busbarRatingAmps: number | null;
    /** Number of available breaker spaces */
    breakerSpacesAvailable: number | null;
    serviceEntrance: ServiceEntrance;
    meterType: MeterSocketType;
    interconnectionPoint: InterconnectionPoint;
    panelBrand: PanelBrand;
    hasSubPanel: boolean | null;
    subPanelRatingAmps: number | null;
    /** Available breaker slots (categorical) */
    availableBreakerSlots: string | null;
  };

  // ─── Photos ──────────────────────────────────────────────────────────────
  photos: SurveyPhotoRef[];

  // ─── Notes ───────────────────────────────────────────────────────────────
  installerNotes: string | null;
  inspectorName: string | null;
  surveyedAt: string | null;

  // ─── Normalization Metadata ───────────────────────────────────────────────
  normalizationLog: string[];
}

// ─── Enriched Site Survey (POST-ENRICHMENT) ────────────────────────────────
//
// Output of enrichSurvey(). Contains all fields from NormalizedSiteSurvey
// PLUS strictly computed derived fields.
// RULE: No derived field here may be set by the caller — they are computed only.

export interface EnrichedSiteSurvey extends NormalizedSiteSurvey {
  /** Enrichment log entries */
  enrichmentLog: string[];

  // ─── Derived Geometry ────────────────────────────────────────────────────
  derived: {
    // Geometry
    /** Computed usable area from roof planes minus setbacks and obstructions (sq ft) */
    computedUsableAreaSqFt: number | null;
    /** Authoritative usable area: field-measured if available, else computed */
    effectiveUsableAreaSqFt: number | null;
    /** Inferred azimuth when field azimuth is missing (south-facing fallback) */
    effectiveAzimuth: number;
    /** CAD-ready roof planes with usable polygon applied */
    cadRoofSurfaces: CADReadySurface[];
    /** CAD exclusion zones from obstructions */
    cadExclusionZones: CADExclusionZone[];
    /** Setback shrink amounts per edge type (inches) */
    setbackShrink: Record<string, number>;

    // Structural feasibility
    /** Whether the structure is feasible for solar based on survey data */
    structuralFeasibility: StructuralFeasibilityFlags;

    // Electrical feasibility
    /** Whether the electrical service supports solar interconnection */
    electricalFeasibility: ElectricalFeasibilityFlags;

    // Shading confidence
    /** Confidence level in shading/production estimate based on data quality */
    shadingConfidence: 'high' | 'medium' | 'low' | 'unknown';

    // Photo counts (from NormalizedSiteSurvey.photos — SurveyPhotoRef[])
    /** Per-category photo counts. All zero when photos array is empty. */
    photoCounts: SurveyPhotoCounts;

    // Photo availability flags (convenience booleans for downstream consumers)
    /** True if at least one roof photo is present */
    hasRoofPhotos: boolean;
    /** True if at least one meter or panel photo is present (electrical evidence) */
    hasElectricalPhotos: boolean;
    /** True if at least one obstruction photo is present */
    hasObstructionPhotos: boolean;

    // ── Data presence flags (Phase 5) ─────────────────────────────────────────
    /** True when geometry data is sufficient for CAD use (roof planes OR GPS+area) */
    hasGeometryData: boolean;
    /** True when electrical data is present (panel rating, interconnection point, or busbar) */
    hasElectricalData: boolean;
    /** True when structural data is present (roof material, rafter spacing, pitch, etc.) */
    hasStructuralData: boolean;
  };
}

// ─── CAD-Ready Types (produced by enrichment) ─────────────────────────────────

/** A roof surface ready for CAD panel placement */
export interface CADReadySurface {
  /** Matches SurveyRoofPlane.id */
  planeId: string;
  /** Azimuth in degrees */
  azimuth: number;
  /** Pitch in degrees */
  pitchDeg: number;
  /** Total area sq ft */
  totalAreaSqFt: number;
  /** Usable area after setbacks (sq ft) */
  usableAreaSqFt: number;
  /** Usable polygon vertices (lat/lng) after setback shrink */
  usablePolygon: GeoPoint[];
  /** Setback amounts applied (inches per edge) */
  appliedSetbacks: Record<string, number>;
}

/** A CAD exclusion zone derived from an obstruction */
export interface CADExclusionZone {
  /** Matches SurveyObstruction.id */
  obstructionId: string;
  obstructionType: SurveyObstruction['type'];
  /** Center position */
  center: GeoPoint;
  /** Exclusion boundary with NEC setback applied */
  boundaryPolygon: GeoPoint[];
  /** Exclusion radius in feet (for circular obstructions) */
  exclusionRadiusFt: number;
}

// ─── Feasibility Flag Types ───────────────────────────────────────────────────

export interface StructuralFeasibilityFlags {
  /** Overall pass/fail */
  feasible: boolean;
  /** Individual check results */
  checks: {
    rafterSpacingOk: boolean;        // ≤ 24" OC
    roofConditionOk: boolean;        // not 'poor'
    deckingThicknessOk: boolean;     // ≥ 0.5"
    roofAgeOk: boolean;              // < 20 years (warn only)
    pitchWithinRange: boolean;       // < 45 degrees
  };
  /** Human-readable flags for the permit plan set */
  flags: string[];
  /** Warning messages (non-fatal) */
  warnings: string[];
}

export interface ElectricalFeasibilityFlags {
  /** Overall pass/fail */
  feasible: boolean;
  /** Individual check results */
  checks: {
    panelRatingSufficient: boolean;   // ≥ 100A
    busbarRatingSufficient: boolean;  // ≥ 100A
    breakerSpaceAvailable: boolean;   // ≥ 1 space
    interconnectionPointValid: boolean; // known interconnection type
    notFederalPacificOrZinsco: boolean; // flagged panels
  };
  /** NEC 705.12 120% rule check result */
  nec120PctRule: {
    mainPanelAmps: number | null;
    busbarAmps: number | null;
    /** Max allowed backfeed breaker under NEC 705.12(B)(2) 120% rule */
    maxBackfeedAmps: number | null;
    /** Whether the system likely passes 120% rule (requires system size to confirm) */
    likelyPasses: boolean;
  };
  /** Human-readable flags for the permit plan set */
  flags: string[];
  /** Warning messages (non-fatal) */
  warnings: string[];
}

// ─── Survey Override Context ───────────────────────────────────────────────────
//
// Used by applyToSystemDefinition() and all downstream integration functions.
// Carries the enriched survey plus the source label for audit trails.

export interface SurveyOverrideContext {
  survey: EnrichedSiteSurvey;
  /** Timestamp when the override was applied */
  appliedAt: string;
  /** Which fields were actually overridden (audit trail) */
  overriddenFields: string[];
  /** Which fields were skipped because existing data was present */
  skippedFields: string[];
}

// ─── Validation Result ────────────────────────────────────────────────────────

export interface SurveyValidationResult {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

// ─── Storage Types ────────────────────────────────────────────────────────────

/**
 * SiteSurveyRow — legacy interface stub, never persisted.
 *
 * HISTORY: This interface referenced a `project_site_surveys` table that was
 * NEVER created by any database migration. The canonical survey storage table
 * is `site_surveys` (created by migration 016_site_surveys.sql).
 *
 * The `site_surveys` table stores:
 *   - survey_data JSONB  — full SurveyV2Payload (source of truth)
 *   - status             — pending | completed | reviewed
 *   - inspector_name, address_snapshot, external_survey_id, delivery_id
 *
 * This interface is kept for reference only. Do NOT write new code that
 * reads or writes `project_site_surveys` — it does not exist.
 *
 * @deprecated Use the `site_surveys` table and `createSiteSurvey()` /
 *   `getSiteSurveysByProject()` from lib/db-neon.ts instead.
 */
export interface SiteSurveyRow {
  id: string;
  project_id: string;
  pipeline_version: number;
  raw_payload: string;          // JSON of RawSurveyPayload
  normalized: string;           // JSON of NormalizedSiteSurvey
  enriched: string;             // JSON of EnrichedSiteSurvey
  structural_feasibility: string; // JSON of StructuralFeasibilityFlags
  electrical_feasibility: string; // JSON of ElectricalFeasibilityFlags
  created_at: string;
  updated_at: string;
}