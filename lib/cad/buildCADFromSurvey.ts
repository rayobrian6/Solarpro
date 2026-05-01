// ============================================================================
// lib/cad/buildCADFromSurvey.ts — Survey → CAD Bridge
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   EnrichedSiteSurvey
//     → buildCADFromSurvey() ← YOU ARE HERE → CADModel inputs
//     → generateCADLayout()  → CADModel (full solved layout)
//
// RESPONSIBILITIES:
//   Translate an EnrichedSiteSurvey into the input shape expected by
//   generateCADLayout() and the CAD engine. This is a BRIDGE module:
//   it does NOT solve the layout — it constructs the inputs.
//
//   For roof systems:
//     - Converts CADReadySurface[] → CADRoofPlane[] (partial — no panels yet)
//     - Sets usablePolygon from enriched setback-inset polygon
//     - Populates pitch, azimuth, area from survey
//
//   For ground systems:
//     - Constructs a CADGroundArray input from survey site dimensions
//
// CONTRACTS:
//   - NEVER calls DB, network, or filesystem
//   - NEVER throws — errors pushed to warnings[]
//   - Input: EnrichedSiteSurvey (output of enrichSurvey)
//   - Output: SurveyCADInputs — a structured input payload for generateCADLayout()
//   - The CAD engine is NOT invoked here — caller does that with these inputs
//
// WHY NOT BUILD THE FULL CADModel HERE:
//   generateCADLayout() owns panel placement, row solving, dimension generation,
//   and bound computation. We must not duplicate that logic. This module
//   constructs only the inputs that the CAD engine needs from survey data.
// ============================================================================

import type { Point2D } from './geometry';
import type {
  CADRoofPlane,
  CADSystemType,
} from './types';

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type EnrichedSiteSurvey,
  type CADReadySurface,
  type GeoPoint,
} from '@/lib/siteSurvey/types';

// ─── Output type ──────────────────────────────────────────────────────────────

/**
 * SurveyCADInputs — the structured inputs for generateCADLayout() derived
 * from a fully enriched site survey.
 *
 * USAGE:
 *   const inputs = buildCADFromSurvey(enriched);
 *   const cadModel = await generateCADLayout({
 *     ...existingInputs,
 *     ...inputs.overrides,   // merge survey data into existing call
 *   });
 */
export interface SurveyCADInputs {
  /** Resolved CAD system type (matches CADSystemType) */
  systemType: CADSystemType;

  /** GPS origin for local XY projection (from survey location) */
  origin: { lat: number; lng: number } | null;

  /**
   * Roof plane inputs derived from CADReadySurface data.
   * Populated only for 'roof' system type.
   * These are PARTIAL CADRoofPlane objects — panels are NOT solved here.
   */
  roofPlaneInputs: SurveyRoofPlaneInput[];

  /**
   * Ground array inputs derived from survey dimensions.
   * Populated only for 'ground' system type.
   */
  groundArrayInputs: SurveyGroundArrayInput[];

  /**
   * Override values for the CAD engine's SystemDefinitionInput.
   * These are the survey-sourced fields that should override project defaults.
   */
  overrides: SurveyCADOverrides;

  /** Warnings generated during CAD input construction */
  warnings: string[];

  /** Log of all construction steps */
  buildLog: string[];
}

/**
 * Survey-derived roof plane input — a partial CADRoofPlane shape.
 * The CAD engine fills in panels[], dimensions{}, and solve metadata.
 */
export interface SurveyRoofPlaneInput {
  id: string;
  /** Raw boundary polygon in local meters (from survey geo polygon) */
  polygon: Point2D[];
  /** Usable polygon after setbacks (from enrichment inset) */
  usablePolygon: Point2D[];
  pitch: number;    // degrees
  azimuth: number;  // degrees
  areaSqM: number;
  /** Setback amounts in meters (converted from enrichment inches) */
  setbacks: {
    eaveM: number;
    ridgeM: number;
    rakeM: number;
  };
}

/**
 * Survey-derived ground array input shape.
 * Used to construct a CADGroundArray-compatible input.
 */
export interface SurveyGroundArrayInput {
  id: string;
  tiltDeg: number;
  azimuth: number;
  rowSpacingM: number;
  groundClearanceM: number;
  /** Estimated usable area in sq meters (from survey) */
  usableAreaSqM: number | null;
}

/**
 * Override values to merge into the CAD engine's call params.
 * These are the survey-sourced values that improve CAD accuracy.
 */
export interface SurveyCADOverrides {
  /** Origin lat/lng for local projection */
  originLat?: number;
  originLng?: number;
  /** Main panel azimuth (from primary roof plane) */
  azimuth?: number;
  /** Main plane tilt/pitch */
  tilt?: number;
  /** Rafter spacing in inches (for attachment layout) */
  rafterSpacingIn?: number;
  /** Rafter size string */
  rafterSize?: string;
  /** Roof type string (shingle, tile, metal, etc.) */
  roofType?: string;
  /** Total usable area sq ft (for panel count estimation) */
  usableAreaSqFt?: number;
}

// ─── Main builder function ────────────────────────────────────────────────────

/**
 * buildCADFromSurvey — constructs CAD engine inputs from an EnrichedSiteSurvey.
 *
 * Pure synchronous function. Never throws.
 *
 * @param survey  EnrichedSiteSurvey (output of enrichSurvey)
 * @returns       SurveyCADInputs — structured inputs for generateCADLayout()
 */
export function buildCADFromSurvey(survey: EnrichedSiteSurvey): SurveyCADInputs {
  const log: string[] = [];
  const warnings: string[] = [];

  log.push(`[cadBridge] Building CAD inputs for survey=${survey.id} project=${survey.projectId} pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  // ── Resolve CAD system type ─────────────────────────────────────────────────
  const systemType = resolveCadSystemType(survey.systemType, log);

  // ── Resolve origin ──────────────────────────────────────────────────────────
  const origin = resolveOrigin(survey, log);

  // ── Build roof plane inputs ─────────────────────────────────────────────────
  const roofPlaneInputs = systemType === 'roof'
    ? buildRoofPlaneInputs(survey, origin, log, warnings)
    : [];

  // ── Build ground array inputs ───────────────────────────────────────────────
  const groundArrayInputs = systemType === 'ground_mount'
    ? buildGroundArrayInputs(survey, log, warnings)
    : [];

  // ── Build override map ──────────────────────────────────────────────────────
  const overrides = buildOverrides(survey, log);

  log.push(`[cadBridge] Complete: system=${systemType} planes=${roofPlaneInputs.length} groundArrays=${groundArrayInputs.length} warnings=${warnings.length}`);

  return {
    systemType,
    origin,
    roofPlaneInputs,
    groundArrayInputs,
    overrides,
    warnings,
    buildLog: log,
  };
}

// ─── System type resolver ─────────────────────────────────────────────────────

function resolveCadSystemType(
  surveyType: EnrichedSiteSurvey['systemType'],
  log: string[],
): CADSystemType {
  switch (surveyType) {
    case 'roof':   return 'roof';
    case 'ground': return 'ground_mount';
    case 'fence':  return 'solar_fence';
    default:
      log.push(`[cadBridge] WARN: Unrecognized surveyType="${surveyType}" — defaulting to 'roof'`);
      return 'roof';
  }
}

// ─── Origin resolver ──────────────────────────────────────────────────────────

function resolveOrigin(
  survey: EnrichedSiteSurvey,
  log: string[],
): { lat: number; lng: number } | null {
  if (survey.location.lat !== null && survey.location.lng !== null) {
    log.push(`[cadBridge] Origin: lat=${survey.location.lat} lng=${survey.location.lng}`);
    return { lat: survey.location.lat, lng: survey.location.lng };
  }

  // Fall back to first roof plane vertex if GPS missing
  const firstVertex = survey.geometry.roofPlanes[0]?.vertices?.[0];
  if (firstVertex) {
    log.push(`[cadBridge] WARN: No GPS location — using first roof plane vertex as origin`);
    return { lat: firstVertex.lat, lng: firstVertex.lng };
  }

  log.push(`[cadBridge] WARN: No GPS or polygon data — origin unknown`);
  return null;
}

// ─── Roof plane inputs ────────────────────────────────────────────────────────

function buildRoofPlaneInputs(
  survey: EnrichedSiteSurvey,
  origin: { lat: number; lng: number } | null,
  log: string[],
  warnings: string[],
): SurveyRoofPlaneInput[] {
  const surfaces = survey.derived.cadRoofSurfaces;

  if (surfaces.length === 0) {
    warnings.push(`No CAD roof surfaces available — CAD engine will use default plane layout`);
    log.push(`[cadBridge] WARN: No cadRoofSurfaces — returning empty roof plane inputs`);
    return [];
  }

  const projectionOrigin = origin ?? { lat: 0, lng: 0 };
  const inputs: SurveyRoofPlaneInput[] = [];

  for (const surface of surfaces) {
    // Get the original roof plane for polygon data
    const roofPlane = survey.geometry.roofPlanes.find(p => p.id === surface.planeId);

    // Build raw polygon in local meters from lat/lng vertices
    const polygon: Point2D[] = roofPlane && roofPlane.vertices.length >= 3
      ? geoPolygonToLocal(roofPlane.vertices, projectionOrigin)
      : [];

    // Build usable polygon from enriched inset polygon
    const usablePolygon: Point2D[] = surface.usablePolygon.length >= 3
      ? geoPolygonToLocal(surface.usablePolygon, projectionOrigin)
      : polygon; // fallback to raw polygon if inset failed

    // Convert sq ft area to sq meters
    const areaSqM = surface.totalAreaSqFt * 0.0929;

    // Convert setback shrink (inches) to meters
    const setbackShrink = surface.appliedSetbacks;
    const eaveM = ((setbackShrink['eave'] ?? 36) / 12) * 0.3048;
    const ridgeM = ((setbackShrink['ridge'] ?? 36) / 12) * 0.3048;
    const rakeM = ((setbackShrink['rake'] ?? 36) / 12) * 0.3048;

    if (polygon.length < 3) {
      log.push(`[cadBridge] WARN: Plane ${surface.planeId} has no polygon — usablePolygon also empty`);
    }

    inputs.push({
      id: surface.planeId,
      polygon,
      usablePolygon,
      pitch: surface.pitchDeg,
      azimuth: surface.azimuth,
      areaSqM,
      setbacks: { eaveM, ridgeM, rakeM },
    });

    log.push(`[cadBridge] Roof plane ${surface.planeId}: az=${surface.azimuth}° pitch=${surface.pitchDeg}° area=${surface.totalAreaSqFt.toFixed(0)}sqft usable=${surface.usableAreaSqFt.toFixed(0)}sqft polygon=${polygon.length}pts`);
  }

  log.push(`[cadBridge] Built ${inputs.length} roof plane inputs`);
  return inputs;
}

// ─── Ground array inputs ──────────────────────────────────────────────────────

function buildGroundArrayInputs(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): SurveyGroundArrayInput[] {
  // For ground systems, survey provides site dimensions and location.
  // We construct a single ground array input from the enriched survey data.

  const effectiveAzimuth = survey.derived.effectiveAzimuth;
  const usableAreaSqFt = survey.derived.effectiveUsableAreaSqFt;
  const usableAreaSqM = usableAreaSqFt !== null ? usableAreaSqFt * 0.0929 : null;

  // Tilt: use pitch from structural data or default 25°
  const tiltDeg = survey.structural.roofPitchDegrees ?? 25;

  // Ground clearance: default 18 inches (1.5 ft) per industry standard
  const groundClearanceM = 1.5 * 0.3048; // 18 inches

  // Row spacing: default 12 ft (3.66m) for fixed tilt at low latitude
  const rowSpacingM = 12 * 0.3048;

  if (usableAreaSqM === null) {
    warnings.push(`Ground system: no usable area captured — CAD engine will use default array dimensions`);
  }

  log.push(`[cadBridge] Ground array input: az=${effectiveAzimuth}° tilt=${tiltDeg}° usable=${usableAreaSqFt?.toFixed(0) ?? 'none'}sqft`);

  return [{
    id: 'array_from_survey',
    tiltDeg,
    azimuth: effectiveAzimuth,
    rowSpacingM,
    groundClearanceM,
    usableAreaSqM,
  }];
}

// ─── Overrides builder ────────────────────────────────────────────────────────

function buildOverrides(
  survey: EnrichedSiteSurvey,
  log: string[],
): SurveyCADOverrides {
  const overrides: SurveyCADOverrides = {};

  // GPS origin for projection
  if (survey.location.lat !== null && survey.location.lng !== null) {
    overrides.originLat = survey.location.lat;
    overrides.originLng = survey.location.lng;
  }

  // Primary azimuth
  const primaryPlane = survey.geometry.roofPlanes[0];
  if (primaryPlane && primaryPlane.azimuth !== null) {
    overrides.azimuth = primaryPlane.azimuth;
  } else {
    overrides.azimuth = survey.derived.effectiveAzimuth;
  }

  // Primary tilt
  if (primaryPlane && primaryPlane.pitch !== null && primaryPlane.pitch > 0) {
    overrides.tilt = primaryPlane.pitch;
  } else if (survey.structural.roofPitchDegrees !== null) {
    overrides.tilt = survey.structural.roofPitchDegrees;
  }

  // Structural data
  const rafterSpacingCaptured = !survey.normalizationLog.some(
    l => l.includes('rafterSpacingIn not provided')
  );
  if (rafterSpacingCaptured) {
    overrides.rafterSpacingIn = survey.structural.rafterSpacingIn;
  }

  if (survey.structural.rafterSize && survey.structural.rafterSize !== 'other') {
    overrides.rafterSize = survey.structural.rafterSize;
  }

  if (survey.structural.roofMaterial) {
    overrides.roofType = survey.structural.roofMaterial;
  }

  // Total usable area
  if (survey.derived.effectiveUsableAreaSqFt !== null) {
    overrides.usableAreaSqFt = survey.derived.effectiveUsableAreaSqFt;
  }

  log.push(`[cadBridge] Overrides: ${Object.keys(overrides).join(', ')}`);
  return overrides;
}

// ─── Geometry utilities ────────────────────────────────────────────────────────

/**
 * geoPolygonToLocal — converts GeoPoint lat/lng polygon to local Point2D meters.
 * Uses Equirectangular approximation centered on the projection origin.
 * Accurate within ~0.1% for distances < 10km (residential site scale).
 */
function geoPolygonToLocal(
  points: GeoPoint[],
  origin: { lat: number; lng: number },
): Point2D[] {
  const R = 6371000; // Earth radius meters
  const lat0 = origin.lat * (Math.PI / 180);

  return points.map(p => ({
    x: (p.lng - origin.lng) * (Math.PI / 180) * R * Math.cos(lat0),
    y: (p.lat - origin.lat) * (Math.PI / 180) * R,
  }));
}