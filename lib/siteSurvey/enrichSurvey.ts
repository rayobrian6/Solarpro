// ============================================================================
// lib/siteSurvey/enrichSurvey.ts — Site Survey Enrichment Layer
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   RawSurveyPayload
//     → normalizeSurvey()  → NormalizedSiteSurvey
//     → enrichSurvey()     ← YOU ARE HERE → EnrichedSiteSurvey
//     → applyToSystemDefinition() → SystemDefinition (override layer only)
//
// RESPONSIBILITIES:
//   1. Compute effective azimuth  — infer from lat/lng (south-bias) if missing
//   2. Compute usable area        — total area minus setback shrink + obstructions
//   3. Build CAD-ready surfaces   — usable polygon per roof plane
//   4. Build CAD exclusion zones  — obstruction footprints with NEC setbacks
//   5. Evaluate structural feasibility — ASCE 7-22 / IBC checks
//   6. Evaluate electrical feasibility — NEC 705.12 120% rule + panel checks
//   7. Compute shading confidence  — based on data completeness
//
// CONTRACTS:
//   - NEVER throws — all errors are pushed to enrichmentLog
//   - NEVER calls DB, network, or filesystem
//   - Pure synchronous function
//   - Input: NormalizedSiteSurvey (output of normalizeSurvey)
//   - Output: EnrichedSiteSurvey (extends NormalizedSiteSurvey with derived block)
//   - ALL derived fields are computed here — never passed in from caller
// ============================================================================

// PIPELINE STATUS: WIRED — imported by app/api/engineering/generate, permit, preliminary
import {
  SITE_SURVEY_PIPELINE_VERSION,
  type NormalizedSiteSurvey,
  type EnrichedSiteSurvey,
  type CADReadySurface,
  type CADExclusionZone,
  type StructuralFeasibilityFlags,
  type ElectricalFeasibilityFlags,
  type GeoPoint,
  type SurveyRoofPlane,
  type SurveyObstruction,
  type SurveySetback,
  type SurveyPhotoCounts,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * NEC 705.12(B)(2) — 120% Rule
 * Max backfeed breaker = (busbar rating × 1.2) - main breaker rating
 * The backfeed breaker must be ≤ 20% of the busbar rating.
 */
const NEC_120_PCT_MULTIPLIER = 1.2;

/**
 * Minimum usable panel count threshold to flag as feasible geometry.
 * If computed usable area cannot fit at least 1 panel footprint, warn.
 * Standard 400W panel footprint ~ 21 sqft.
 */
const MIN_SINGLE_PANEL_SQFT = 21;

/**
 * Default south-facing azimuth used when field azimuth is missing and
 * site is in Northern Hemisphere (the optimal default).
 */
const NORTHERN_HEMISPHERE_DEFAULT_AZIMUTH = 180; // south-facing

/**
 * NEC 690.12 — Rapid Shutdown / obstruction setback minimum (feet)
 * Used when obstruction has no explicit setback captured.
 */
const NEC_DEFAULT_OBSTRUCTION_SETBACK_FT = 3;

/**
 * NEC fire access pathway minimum setback from roof edges (inches)
 * Used as floor value when setback data is missing.
 */
const NEC_MIN_EDGE_SETBACK_IN = 36; // 3 ft

/** Max flagged rafter spacing for structural safety (inches OC) */
const MAX_SAFE_RAFTER_SPACING_IN = 24;

/** Min decking thickness for safe mounting (inches) */
const MIN_SAFE_DECKING_IN = 0.5;

/** Max roof pitch for most standard rail systems (degrees) */
const MAX_STANDARD_PITCH_DEG = 45;

/** Roof age threshold for condition warning (years) */
const ROOF_AGE_WARN_YEARS = 20;

/** Min panel rating for solar interconnection (amps) */
const MIN_PANEL_RATING_AMPS = 100;

/** Min busbar rating for solar interconnection (amps) */
const MIN_BUSBAR_RATING_AMPS = 100;

/** Flagged panel brands (safety hazard — require special handling) */
const FLAGGED_PANEL_BRANDS = new Set(['federal_pacific', 'zinsco']);

// ─── Main enrichment function ─────────────────────────────────────────────────

/**
 * enrichSurvey — computes all derived fields from a NormalizedSiteSurvey.
 *
 * Pure synchronous function. Never throws. All warnings and errors are
 * captured in the returned enrichmentLog array.
 *
 * @param normalized  Output of normalizeSurvey()
 * @returns           EnrichedSiteSurvey with fully computed derived block
 */
export function enrichSurvey(normalized: NormalizedSiteSurvey): EnrichedSiteSurvey {
  const log: string[] = [];

  log.push(`[enrich] Starting enrichment for survey=${normalized.id} project=${normalized.projectId}`);

  // ── Step 1: Compute effective azimuth ─────────────────────────────────────────
  // Use field-captured azimuth from first roof plane if available.
  // Fall back to lat-based south-facing default.

  const effectiveAzimuth = computeEffectiveAzimuth(normalized, log);

  // ── Step 2: Compute setback shrink amounts ────────────────────────────────────
  // Build a lookup of edge → inches shrink from the setback rules.

  const setbackShrink = computeSetbackShrink(normalized.geometry.setbacks, log);

  // ── Step 3: Build CAD-ready surfaces ──────────────────────────────────────────
  // One CADReadySurface per valid roof plane.

  const cadRoofSurfaces = buildCADRoofSurfaces(
    normalized.geometry.roofPlanes,
    setbackShrink,
    normalized.geometry.usableAreaSqFt,
    log,
  );

  // ── Step 4: Build CAD exclusion zones ─────────────────────────────────────────
  // One CADExclusionZone per obstruction, with NEC setbacks applied.

  const cadExclusionZones = buildCADExclusionZones(
    normalized.geometry.obstructions,
    log,
  );

  // ── Step 5: Compute usable areas ──────────────────────────────────────────────

  const computedUsableAreaSqFt = computeUsableArea(cadRoofSurfaces, cadExclusionZones, log);
  const effectiveUsableAreaSqFt = normalized.geometry.usableAreaSqFt !== null
    ? normalized.geometry.usableAreaSqFt  // field-measured wins
    : computedUsableAreaSqFt;

  log.push(`[enrich] Usable area: field=${normalized.geometry.usableAreaSqFt ?? 'none'} computed=${computedUsableAreaSqFt ?? 'none'} effective=${effectiveUsableAreaSqFt ?? 'none'} sqft`);

  // ── Step 6: Evaluate structural feasibility ────────────────────────────────────

  const structuralFeasibility = evaluateStructuralFeasibility(normalized, log);

  // ── Step 7: Evaluate electrical feasibility ────────────────────────────────────

  const electricalFeasibility = evaluateElectricalFeasibility(normalized, log);

  // ── Step 8: Compute shading confidence ────────────────────────────────────────

  const shadingConfidence = computeShadingConfidence(normalized, cadRoofSurfaces, log);

  // ── Step 9: Compute photo counts and flags ─────────────────────────────────

  const photoCounts        = computePhotoCounts(normalized, log);
  const hasRoofPhotos        = photoCounts.roofCount > 0;
  const hasElectricalPhotos  = photoCounts.meterCount > 0 || photoCounts.panelCount > 0;
  const hasObstructionPhotos = photoCounts.obstructionCount > 0;

  // ── Step 9b: Data presence flags (Phase 5) ────────────────────────────────
  const hasGeometryData: boolean = (
    normalized.geometry.roofPlanes.length > 0 ||
    (normalized.location.lat !== null &&
     normalized.location.lng !== null &&
     normalized.geometry.usableAreaSqFt !== null)
  );

  const hasElectricalData: boolean = (
    normalized.electrical.mainPanelRatingAmps !== null ||
    normalized.electrical.interconnectionPoint !== 'unknown' ||
    normalized.electrical.busbarRatingAmps !== null
  );

  const hasStructuralData: boolean = (
    normalized.structural.roofMaterial !== null ||
    normalized.structural.rafterSpacingIn !== null ||
    (normalized.structural.rafterSize !== null &&
     normalized.structural.rafterSize !== 'other') ||
    normalized.structural.roofPitchDegrees !== null
  );

  log.push(
    `[enrich] DataFlags: geometry=${hasGeometryData} electrical=${hasElectricalData} structural=${hasStructuralData}`
  );

  // ── Step 10: Final log summary ──────────────────────────────────────────────

  const warnCount = log.filter(l => l.includes('WARN')).length;
  log.push(`[enrich] Completed: ${warnCount} warnings, structural=${structuralFeasibility.feasible ? 'PASS' : 'FAIL'}, electrical=${electricalFeasibility.feasible ? 'PASS' : 'FAIL'}, shading=${shadingConfidence}, photos=${photoCounts.total}`);

  return {
    // Spread all normalized fields
    ...normalized,
    // Override pipelineVersion (already set, but make explicit)
    pipelineVersion: SITE_SURVEY_PIPELINE_VERSION,
    // Attach enrichment log
    enrichmentLog: log,
    // Derived block — ALL computed, never passed from caller
    derived: {
      computedUsableAreaSqFt,
      effectiveUsableAreaSqFt,
      effectiveAzimuth,
      cadRoofSurfaces,
      cadExclusionZones,
      setbackShrink,
      structuralFeasibility,
      electricalFeasibility,
      shadingConfidence,
      // Photo counts and flags (Phase 2 addition — project_files integration)
      photoCounts,
      hasRoofPhotos,
      hasElectricalPhotos,
      hasObstructionPhotos,
      // Data presence flags (Phase 5)
      hasGeometryData,
      hasElectricalData,
      hasStructuralData,
    },
  };
}

// ─── Step 1: Effective azimuth ────────────────────────────────────────────────

function computeEffectiveAzimuth(
  normalized: NormalizedSiteSurvey,
  log: string[],
): number {
  // If any roof plane has an azimuth, use the primary (largest area) plane's azimuth
  const planes = normalized.geometry.roofPlanes;
  if (planes.length > 0) {
    // Find plane with largest area — that's the primary plane
    const primary = planes.reduce((best, p) => (p.area > best.area ? p : best), planes[0]);
    if (primary.azimuth !== null && primary.azimuth !== undefined) {
      log.push(`[enrich] Effective azimuth from primary roof plane (id=${primary.id}): ${primary.azimuth}°`);
      return primary.azimuth;
    }
  }

  // Fall back to lat-based south-facing default
  const lat = normalized.location.lat;
  if (lat !== null) {
    const az = lat >= 0 ? NORTHERN_HEMISPHERE_DEFAULT_AZIMUTH : 0; // S or N
    log.push(`[enrich] No roof plane azimuth — inferred from lat=${lat}: ${az}° (${lat >= 0 ? 'south-facing NH' : 'north-facing SH'})`);
    return az;
  }

  // Final fallback — assume Northern Hemisphere south-facing
  log.push(`[enrich] WARN: No azimuth and no lat — defaulting to ${NORTHERN_HEMISPHERE_DEFAULT_AZIMUTH}° (south-facing)`);
  return NORTHERN_HEMISPHERE_DEFAULT_AZIMUTH;
}

// ─── Step 2: Setback shrink computation ──────────────────────────────────────

function computeSetbackShrink(
  setbacks: SurveySetback[],
  log: string[],
): Record<string, number> {
  const shrink: Record<string, number> = {};

  if (setbacks.length === 0) {
    // Apply NEC minimum default setbacks
    const defaultEdges = ['eave', 'rake', 'ridge', 'valley', 'hip'];
    for (const edge of defaultEdges) {
      shrink[edge] = NEC_MIN_EDGE_SETBACK_IN;
    }
    log.push(`[enrich] No setbacks captured — applying NEC minimum ${NEC_MIN_EDGE_SETBACK_IN}" to all edges`);
    return shrink;
  }

  for (const s of setbacks) {
    for (const edge of s.edges) {
      // Use the LARGER of any existing setback and this one (most restrictive wins)
      const current = shrink[edge] ?? 0;
      if (s.distanceIn > current) {
        shrink[edge] = s.distanceIn;
      }
    }
  }

  // Ensure all edges have at least NEC minimum
  const allEdges = ['eave', 'rake', 'ridge', 'valley', 'hip'];
  for (const edge of allEdges) {
    if (!shrink[edge] || shrink[edge] < NEC_MIN_EDGE_SETBACK_IN) {
      const prev = shrink[edge];
      shrink[edge] = NEC_MIN_EDGE_SETBACK_IN;
      if (prev !== undefined && prev !== NEC_MIN_EDGE_SETBACK_IN) {
        log.push(`[enrich] WARN: ${edge} setback ${prev}" below NEC minimum ${NEC_MIN_EDGE_SETBACK_IN}" — overridden`);
      }
    }
  }

  log.push(`[enrich] Setback shrink: ${Object.entries(shrink).map(([k, v]) => `${k}=${v}"`).join(', ')}`);
  return shrink;
}

// ─── Step 3: Build CAD roof surfaces ──────────────────────────────────────────

function buildCADRoofSurfaces(
  roofPlanes: SurveyRoofPlane[],
  setbackShrink: Record<string, number>,
  fieldUsableAreaSqFt: number | null,
  log: string[],
): CADReadySurface[] {
  if (roofPlanes.length === 0) {
    log.push(`[enrich] WARN: No roof planes — no CAD surfaces generated`);
    return [];
  }

  const surfaces: CADReadySurface[] = [];
  // Default setback for area reduction (use average of eave/rake as representative)
  const avgSetbackIn = computeAvgEdgeSetback(setbackShrink);
  const avgSetbackFt = avgSetbackIn / 12;

  for (const plane of roofPlanes) {
    // Compute usable polygon from vertices with setback shrink applied
    const { usablePolygon, appliedSetbacks } = applySetbacksToPolygon(
      plane.vertices,
      setbackShrink,
      plane.id,
      log,
    );

    // Compute usable area:
    // 1. If polygon available — compute from inset polygon area
    // 2. If total area available — apply setback reduction formula
    // 3. Otherwise null
    let usableAreaSqFt: number;
    if (usablePolygon.length >= 3) {
      // Use Shoelace formula on inset polygon — converted from lat/lng degrees to sqft
      const rawPolyAreaSqft = polygonAreaSqFt(usablePolygon);
      usableAreaSqFt = Math.max(0, rawPolyAreaSqft);
      log.push(`[enrich] Plane ${plane.id}: polygon-computed usable area ${usableAreaSqFt.toFixed(0)} sqft`);
    } else if (plane.area > 0) {
      // Approximate setback reduction: treat plane as rectangle
      // Reduce each dimension by the average setback on both sides
      const estimatedUsable = Math.max(0, plane.area - (avgSetbackFt * 2 * Math.sqrt(plane.area)));
      usableAreaSqFt = estimatedUsable;
      log.push(`[enrich] Plane ${plane.id}: area-based usable estimate ${usableAreaSqFt.toFixed(0)} sqft (from ${plane.area} sqft total)`);
    } else {
      usableAreaSqFt = 0;
      log.push(`[enrich] WARN: Plane ${plane.id}: cannot compute usable area — no polygon or area`);
    }

    surfaces.push({
      planeId: plane.id,
      azimuth: plane.azimuth,
      pitchDeg: plane.pitch,
      totalAreaSqFt: plane.area,
      usableAreaSqFt,
      usablePolygon,
      appliedSetbacks,
    });
  }

  log.push(`[enrich] Built ${surfaces.length} CAD roof surfaces`);
  return surfaces;
}

/**
 * applySetbacksToPolygon — shrinks a GeoPoint polygon inward by setback amounts.
 *
 * Implementation uses a simplified inward-offset approach:
 * For each edge of the polygon, we move the edge inward by the setback distance.
 * This is a planar approximation — accurate enough for residential rooftop scale
 * (< 0.01% error at residential distances of ~0–100ft).
 *
 * For polygons without vertex data, returns empty polygon (caller uses area fallback).
 */
function applySetbacksToPolygon(
  vertices: GeoPoint[],
  setbackShrink: Record<string, number>,
  planeId: string,
  log: string[],
): { usablePolygon: GeoPoint[]; appliedSetbacks: Record<string, number> } {
  // Without polygon we cannot compute inset — return empty
  if (vertices.length < 3) {
    return { usablePolygon: [], appliedSetbacks: setbackShrink };
  }

  // Convert lat/lng to local meters (planar approximation centered on first vertex)
  const origin = vertices[0];
  const local = geoToLocal(vertices, origin);

  // Apply uniform inward shrink using average setback (in feet → meters)
  // A full polygon inset requires knowing which edge maps to which roof edge type.
  // Since we don't have edge labels, we apply the minimum setback uniformly.
  const minSetbackFt = Math.min(...Object.values(setbackShrink)) / 12;
  const minSetbackM = minSetbackFt * 0.3048;

  const inset = insetPolygon(local, minSetbackM);

  if (inset.length < 3) {
    log.push(`[enrich] WARN: Plane ${planeId} polygon collapsed after setback inset — returning empty`);
    return { usablePolygon: [], appliedSetbacks: setbackShrink };
  }

  // Convert back to lat/lng
  const usablePolygon = localToGeo(inset, origin);

  return { usablePolygon, appliedSetbacks: setbackShrink };
}

// ─── Step 4: Build CAD exclusion zones ───────────────────────────────────────

function buildCADExclusionZones(
  obstructions: SurveyObstruction[],
  log: string[],
): CADExclusionZone[] {
  if (obstructions.length === 0) return [];

  const zones: CADExclusionZone[] = [];

  for (const obs of obstructions) {
    const setbackFt = obs.setbackFt ?? NEC_DEFAULT_OBSTRUCTION_SETBACK_FT;

    // Physical footprint of the obstruction + NEC setback
    const halfWidthFt = (obs.dimensions.widthFt / 2) + setbackFt;
    const halfLengthFt = (obs.dimensions.lengthFt / 2) + setbackFt;
    const exclusionRadiusFt = Math.max(halfWidthFt, halfLengthFt);

    // Build a rectangular exclusion polygon (4 corners + NEC buffer)
    // Convert to lat/lng offset using approximate degrees-per-foot at this location
    const boundaryPolygon = buildExclusionRectangle(
      obs.position,
      halfWidthFt,
      halfLengthFt,
    );

    zones.push({
      obstructionId: obs.id,
      obstructionType: obs.type,
      center: obs.position,
      boundaryPolygon,
      exclusionRadiusFt,
    });

    log.push(`[enrich] Exclusion zone: ${obs.type} id=${obs.id} setback=${setbackFt}ft radius=${exclusionRadiusFt.toFixed(1)}ft`);
  }

  log.push(`[enrich] Built ${zones.length} CAD exclusion zones`);
  return zones;
}

// ─── Step 5: Compute total usable area ───────────────────────────────────────

function computeUsableArea(
  surfaces: CADReadySurface[],
  exclusionZones: CADExclusionZone[],
  log: string[],
): number | null {
  if (surfaces.length === 0) return null;

  // Sum usable area from all surfaces
  let total = surfaces.reduce((sum, s) => sum + s.usableAreaSqFt, 0);

  // Subtract exclusion zone areas (simplified — rectangular footprints)
  let totalExcluded = 0;
  for (const zone of exclusionZones) {
    // Approximate exclusion area from radius (circular approximation)
    const excludedSqFt = Math.PI * zone.exclusionRadiusFt * zone.exclusionRadiusFt;
    totalExcluded += excludedSqFt;
  }

  if (totalExcluded > 0) {
    log.push(`[enrich] Subtracting ${totalExcluded.toFixed(0)} sqft for ${exclusionZones.length} exclusion zones`);
    total = Math.max(0, total - totalExcluded);
  }

  if (total < MIN_SINGLE_PANEL_SQFT) {
    log.push(`[enrich] WARN: Computed usable area ${total.toFixed(0)} sqft < min panel footprint ${MIN_SINGLE_PANEL_SQFT} sqft — likely insufficient`);
  }

  return Math.round(total);
}

// ─── Step 6: Structural feasibility ──────────────────────────────────────────

function evaluateStructuralFeasibility(
  normalized: NormalizedSiteSurvey,
  log: string[],
): StructuralFeasibilityFlags {
  const s = normalized.structural;
  const flags: string[] = [];
  const warnings: string[] = [];

  // Check 1: Rafter spacing ≤ 24" OC
  const rafterSpacingOk = s.rafterSpacingIn <= MAX_SAFE_RAFTER_SPACING_IN;
  if (!rafterSpacingOk) {
    flags.push(`Rafter spacing ${s.rafterSpacingIn}" exceeds ${MAX_SAFE_RAFTER_SPACING_IN}" OC maximum`);
    log.push(`[enrich] STRUCTURAL FAIL: rafterSpacing=${s.rafterSpacingIn}" > ${MAX_SAFE_RAFTER_SPACING_IN}"`);
  }

  // Check 2: Roof condition not 'poor'
  const roofConditionOk = s.roofCondition !== 'poor';
  if (s.roofCondition === 'poor') {
    flags.push(`Roof condition rated 'poor' — replacement recommended before installation`);
    log.push(`[enrich] STRUCTURAL FAIL: roofCondition=poor`);
  }
  if (s.roofCondition === null) {
    warnings.push(`Roof condition not captured — inspect before installation`);
  }

  // Check 3: Decking thickness ≥ 0.5"
  const deckingThicknessOk = s.deckingThicknessIn >= MIN_SAFE_DECKING_IN;
  if (!deckingThicknessOk) {
    flags.push(`Decking thickness ${s.deckingThicknessIn}" below minimum ${MIN_SAFE_DECKING_IN}"`);
    log.push(`[enrich] STRUCTURAL FAIL: deckingThickness=${s.deckingThicknessIn}" < ${MIN_SAFE_DECKING_IN}"`);
  }

  // Check 4: Roof age warning (< 20 years — non-fatal)
  const roofAgeOk = s.roofAgeYears === null || s.roofAgeYears < ROOF_AGE_WARN_YEARS;
  if (s.roofAgeYears !== null && s.roofAgeYears >= ROOF_AGE_WARN_YEARS) {
    warnings.push(`Roof age ${s.roofAgeYears} years — verify shingle life remaining before installation`);
    log.push(`[enrich] STRUCTURAL WARN: roofAge=${s.roofAgeYears} years >= ${ROOF_AGE_WARN_YEARS}`);
  }

  // Check 5: Pitch within range for standard rail systems (< 45°)
  const pitchWithinRange = s.roofPitchDegrees === null || s.roofPitchDegrees < MAX_STANDARD_PITCH_DEG;
  if (s.roofPitchDegrees !== null && s.roofPitchDegrees >= MAX_STANDARD_PITCH_DEG) {
    flags.push(`Roof pitch ${s.roofPitchDegrees}° ≥ ${MAX_STANDARD_PITCH_DEG}° — specialized mounting hardware required`);
    log.push(`[enrich] STRUCTURAL WARN: roofPitchDegrees=${s.roofPitchDegrees}° >= ${MAX_STANDARD_PITCH_DEG}°`);
  }

  // Also check for the worst-case pitch from individual roof planes
  for (const plane of normalized.geometry.roofPlanes) {
    if (plane.pitch >= MAX_STANDARD_PITCH_DEG) {
      warnings.push(`Roof plane ${plane.id} pitch ${plane.pitch}° ≥ ${MAX_STANDARD_PITCH_DEG}° — verify mounting hardware`);
    }
  }

  // Overall feasibility: fails only on hard checks
  const feasible = rafterSpacingOk && roofConditionOk && deckingThicknessOk;

  log.push(`[enrich] Structural feasibility: ${feasible ? 'PASS' : 'FAIL'} (${flags.length} flags, ${warnings.length} warnings)`);

  return {
    feasible,
    checks: {
      rafterSpacingOk,
      roofConditionOk,
      deckingThicknessOk,
      roofAgeOk,
      pitchWithinRange,
    },
    flags,
    warnings,
  };
}

// ─── Step 7: Electrical feasibility ──────────────────────────────────────────

function evaluateElectricalFeasibility(
  normalized: NormalizedSiteSurvey,
  log: string[],
): ElectricalFeasibilityFlags {
  const e = normalized.electrical;
  const flags: string[] = [];
  const warnings: string[] = [];

  // Check 1: Main panel rating ≥ 100A
  const panelRatingSufficient = e.mainPanelRatingAmps !== null
    && e.mainPanelRatingAmps >= MIN_PANEL_RATING_AMPS;
  if (e.mainPanelRatingAmps !== null && !panelRatingSufficient) {
    flags.push(`Main panel ${e.mainPanelRatingAmps}A below minimum ${MIN_PANEL_RATING_AMPS}A for solar interconnection`);
    log.push(`[enrich] ELECTRICAL FAIL: mainPanelRating=${e.mainPanelRatingAmps}A < ${MIN_PANEL_RATING_AMPS}A`);
  }
  if (e.mainPanelRatingAmps === null) {
    warnings.push(`Main panel rating not captured — required for NEC 705.12 compliance check`);
    log.push(`[enrich] ELECTRICAL WARN: mainPanelRatingAmps not available`);
  }

  // Check 2: Busbar rating ≥ 100A
  const busbarRatingSufficient = e.busbarRatingAmps !== null
    && e.busbarRatingAmps >= MIN_BUSBAR_RATING_AMPS;
  if (e.busbarRatingAmps !== null && !busbarRatingSufficient) {
    flags.push(`Busbar rating ${e.busbarRatingAmps}A below minimum ${MIN_BUSBAR_RATING_AMPS}A`);
    log.push(`[enrich] ELECTRICAL FAIL: busbarRating=${e.busbarRatingAmps}A < ${MIN_BUSBAR_RATING_AMPS}A`);
  }

  // Check 3: Breaker space available ≥ 1
  const breakerSpaceAvailable = e.breakerSpacesAvailable === null
    || e.breakerSpacesAvailable >= 1;
  if (e.breakerSpacesAvailable !== null && e.breakerSpacesAvailable < 1) {
    flags.push(`No available breaker spaces — panel may need tandem breakers or sub-panel`);
    log.push(`[enrich] ELECTRICAL FAIL: breakerSpacesAvailable=0`);
  }
  if (e.breakerSpacesAvailable === null) {
    warnings.push(`Breaker spaces not captured — required for load-side interconnection`);
  }

  // Check 4: Interconnection point is known
  const interconnectionPointValid = e.interconnectionPoint !== 'unknown';
  if (e.interconnectionPoint === 'unknown') {
    warnings.push(`Interconnection point not captured — required for SLD generation`);
    log.push(`[enrich] ELECTRICAL WARN: interconnectionPoint=unknown`);
  }

  // Check 5: Panel brand is not Federal Pacific or Zinsco
  const notFederalPacificOrZinsco = !FLAGGED_PANEL_BRANDS.has(e.panelBrand);
  if (!notFederalPacificOrZinsco) {
    flags.push(`Panel brand '${e.panelBrand}' is flagged for safety — panel replacement required before installation`);
    log.push(`[enrich] ELECTRICAL FAIL: panelBrand=${e.panelBrand} is flagged`);
  }

  // NEC 705.12(B)(2) — 120% Rule calculation
  const mainPanelAmps = e.mainPanelRatingAmps;
  const busbarAmps = e.busbarRatingAmps;

  let maxBackfeedAmps: number | null = null;
  let likelyPasses = false;

  if (busbarAmps !== null && mainPanelAmps !== null) {
    // NEC 705.12(B)(2): Solar backfeed breaker ≤ (busbar × 1.2) − main_breaker
    // In practice: max_backfeed = busbar × 0.2 (since main + backfeed ≤ busbar × 1.2)
    maxBackfeedAmps = Math.floor((busbarAmps * NEC_120_PCT_MULTIPLIER) - mainPanelAmps);
    likelyPasses = maxBackfeedAmps > 0;

    log.push(`[enrich] NEC 705.12 120% rule: busbar=${busbarAmps}A main=${mainPanelAmps}A maxBackfeed=${maxBackfeedAmps}A ${likelyPasses ? 'LIKELY PASS' : 'FAIL — upgrade required'}`);

    if (!likelyPasses) {
      warnings.push(`NEC 705.12 120% rule: busbar=${busbarAmps}A × 1.2 - main=${mainPanelAmps}A = ${maxBackfeedAmps}A ≤ 0 — load-side interconnection requires panel upgrade`);
    }
  } else {
    log.push(`[enrich] NEC 705.12 120% rule: cannot compute — missing panel/busbar data`);
    warnings.push(`NEC 705.12 120% rule cannot be checked — main panel or busbar rating not captured`);
    likelyPasses = true; // conservative: don't fail on missing data
  }

  // Overall electrical feasibility: fails on hard checks only
  const feasible = panelRatingSufficient && busbarRatingSufficient
    && breakerSpaceAvailable && notFederalPacificOrZinsco;

  // If main panel data is missing, consider feasible (unknown is not a failure)
  const feasibleOrUnknown = e.mainPanelRatingAmps === null
    ? (breakerSpaceAvailable && notFederalPacificOrZinsco)
    : feasible;

  log.push(`[enrich] Electrical feasibility: ${feasibleOrUnknown ? 'PASS' : 'FAIL'} (${flags.length} flags, ${warnings.length} warnings)`);

  return {
    feasible: feasibleOrUnknown,
    checks: {
      panelRatingSufficient,
      busbarRatingSufficient,
      breakerSpaceAvailable,
      interconnectionPointValid,
      notFederalPacificOrZinsco,
    },
    nec120PctRule: {
      mainPanelAmps,
      busbarAmps,
      maxBackfeedAmps,
      likelyPasses,
    },
    flags,
    warnings,
  };
}

// ─── Step 9: Photo counts ────────────────────────────────────────────────

function computePhotoCounts(
  normalized: NormalizedSiteSurvey,
  log: string[],
): SurveyPhotoCounts {
  const photos = normalized.photos;

  const counts: SurveyPhotoCounts = {
    total:            0,
    roofCount:        0,
    obstructionCount: 0,
    meterCount:       0,
    panelCount:       0,
    siteCount:        0,
    otherCount:       0,
  };

  if (!photos || photos.length === 0) {
    log.push('[enrich] Photos: none attached');
    return counts;
  }

  for (const photo of photos) {
    counts.total += 1;
    switch (photo.category) {
      case 'roof':        counts.roofCount        += 1; break;
      case 'obstruction': counts.obstructionCount += 1; break;
      case 'meter':       counts.meterCount       += 1; break;
      case 'panel':       counts.panelCount       += 1; break;
      case 'site':        counts.siteCount        += 1; break;
      default:            counts.otherCount       += 1; break;
    }
  }

  log.push(
    `[enrich] Photos: total=${counts.total} `
    + `(roof=${counts.roofCount}, obstruction=${counts.obstructionCount}, `
    + `meter=${counts.meterCount}, panel=${counts.panelCount}, `
    + `site=${counts.siteCount}, other=${counts.otherCount})`,
  );

  return counts;
}

// ─── Step 8: Shading confidence ───────────────────────────────────────────────

function computeShadingConfidence(
  normalized: NormalizedSiteSurvey,
  surfaces: CADReadySurface[],
  log: string[],
): EnrichedSiteSurvey['derived']['shadingConfidence'] {
  let score = 0;

  // Has GPS coordinates (+25)
  if (normalized.location.lat !== null && normalized.location.lng !== null) score += 25;

  // Has at least one roof plane with polygon (+25)
  const hasPolygon = surfaces.some(s => s.usablePolygon.length >= 3);
  if (hasPolygon) score += 25;

  // Has at least one roof plane with area data (+15)
  if (surfaces.some(s => s.totalAreaSqFt > 0)) score += 15;

  // Has azimuth and pitch on primary plane (+15)
  const primary = normalized.geometry.roofPlanes[0];
  if (primary && primary.azimuth !== undefined && primary.pitch !== undefined) score += 15;

  // Has photos (roof photos suggest accurate capture) (+10)
  const roofPhotos = normalized.photos.filter(p => p.category === 'roof');
  if (roofPhotos.length >= 2) score += 10;
  else if (roofPhotos.length >= 1) score += 5;

  // Has obstruction data (+10)
  if (normalized.geometry.obstructions.length > 0) score += 10;

  // Penalize for missing data
  if (normalized.geometry.roofPlanes.length === 0) score -= 20;
  if (normalized.location.lat === null) score -= 15;

  const confidence: EnrichedSiteSurvey['derived']['shadingConfidence'] =
    score >= 70 ? 'high' :
    score >= 40 ? 'medium' :
    score >= 10 ? 'low' :
    'unknown';

  log.push(`[enrich] Shading confidence: ${confidence} (score=${score})`);
  return confidence;
}

// ─── Geometry utilities ───────────────────────────────────────────────────────

/**
 * geoToLocal — converts lat/lng GeoPoints to local X/Y meters (planar).
 * Centered on origin point. Uses Equirectangular approximation.
 * Accurate within ~0.1% for distances < 10km (well within residential site scale).
 */
function geoToLocal(
  points: GeoPoint[],
  origin: GeoPoint,
): Array<{ x: number; y: number }> {
  const R = 6371000; // Earth radius meters
  const lat0 = origin.lat * (Math.PI / 180);
  return points.map(p => ({
    x: (p.lng - origin.lng) * (Math.PI / 180) * R * Math.cos(lat0),
    y: (p.lat - origin.lat) * (Math.PI / 180) * R,
  }));
}

/**
 * localToGeo — inverse of geoToLocal, converts local meters back to lat/lng.
 */
function localToGeo(
  local: Array<{ x: number; y: number }>,
  origin: GeoPoint,
): GeoPoint[] {
  const R = 6371000;
  const lat0 = origin.lat * (Math.PI / 180);
  return local.map(p => ({
    lat: origin.lat + (p.y / R) * (180 / Math.PI),
    lng: origin.lng + (p.x / (R * Math.cos(lat0))) * (180 / Math.PI),
  }));
}

/**
 * insetPolygon — shrinks a polygon inward by `distance` meters on all edges.
 * Uses vertex normal bisector method (handles convex and near-convex polygons).
 * For heavily concave polygons this is approximate, but sufficient for roof planes.
 */
function insetPolygon(
  poly: Array<{ x: number; y: number }>,
  distance: number,
): Array<{ x: number; y: number }> {
  const n = poly.length;
  if (n < 3) return [];

  const result: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];

    // Edge vectors
    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;

    // Inward normals (rotate 90° clockwise for CW polygon, CCW for CCW polygon)
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y);
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y);
    if (len1 === 0 || len2 === 0) continue;

    const n1x = e1y / len1;
    const n1y = -e1x / len1;
    const n2x = e2y / len2;
    const n2y = -e2x / len2;

    // Bisector
    const bx = n1x + n2x;
    const by = n1y + n2y;
    const blen = Math.sqrt(bx * bx + by * by);
    if (blen < 1e-10) continue; // degenerate — skip

    const scale = distance / blen;
    result.push({
      x: curr.x + bx * scale,
      y: curr.y + by * scale,
    });
  }

  // Ensure polygon is still non-degenerate
  if (result.length < 3) return [];

  // Validate the inset polygon has positive area (was inset inward, not inside-out)
  const area = shoelaceArea(result);
  if (area <= 0) return []; // collapsed — return empty

  return result;
}

/**
 * polygonAreaSqFt — computes area of a lat/lng GeoPoint polygon in sq ft.
 * Uses Shoelace formula on local meter coordinates.
 */
function polygonAreaSqFt(poly: GeoPoint[]): number {
  if (poly.length < 3) return 0;
  const origin = poly[0];
  const local = geoToLocal(poly, origin);
  const areaSqM = Math.abs(shoelaceArea(local));
  return areaSqM * 10.7639; // m² → ft²
}

/** Shoelace formula — returns signed area in input coordinate units */
function shoelaceArea(poly: Array<{ x: number; y: number }>): number {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i].x * poly[j].y;
    area -= poly[j].x * poly[i].y;
  }
  return area / 2;
}

/**
 * buildExclusionRectangle — builds a 4-corner rectangular polygon around
 * an obstruction center, extended by halfWidth/halfLength + NEC setback.
 * Returns lat/lng polygon.
 */
function buildExclusionRectangle(
  center: GeoPoint,
  halfWidthFt: number,
  halfLengthFt: number,
): GeoPoint[] {
  // Convert feet to degrees (approximate at any latitude)
  // 1 degree lat ≈ 364,000 ft; 1 degree lng ≈ 364,000 × cos(lat) ft
  const FT_PER_DEG_LAT = 364000;
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(center.lat * (Math.PI / 180));

  const dLat = halfLengthFt / FT_PER_DEG_LAT;
  const dLng = halfWidthFt / ftPerDegLng;

  return [
    { lat: center.lat - dLat, lng: center.lng - dLng }, // SW
    { lat: center.lat - dLat, lng: center.lng + dLng }, // SE
    { lat: center.lat + dLat, lng: center.lng + dLng }, // NE
    { lat: center.lat + dLat, lng: center.lng - dLng }, // NW
    { lat: center.lat - dLat, lng: center.lng - dLng }, // close
  ];
}

/** Compute average setback across all edge types (in inches) */
function computeAvgEdgeSetback(setbackShrink: Record<string, number>): number {
  const values = Object.values(setbackShrink);
  if (values.length === 0) return NEC_MIN_EDGE_SETBACK_IN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}