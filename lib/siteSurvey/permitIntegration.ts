// ============================================================================
// lib/siteSurvey/permitIntegration.ts — Survey → Permit Plan Set Integration
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   EnrichedSiteSurvey
//     → permitIntegration() ← YOU ARE HERE → PermitInput patches
//       → PV-1 (title block + site data)
//       → PV-2 (electrical plan — panel, meter, interconnection)
//       → PV-3 (structural notes — rafter, decking, attachment)
//       → PV-4 (site photos, special notes)
//
// RESPONSIBILITIES:
//   Build a PermitInputPatch — a Partial<PermitInput> derived from survey data.
//   The caller merges this patch into their existing PermitInput before
//   passing to the permit plan set generator.
//
//   Sections covered:
//   PV-1: project.address, lat/lng, roofType, roofPitch, systemType
//   PV-2: project.mainPanelAmps, panelBrand, utilityMeter, interconnectionMethod,
//          panelBusRating, compliance.electrical notes
//   PV-3: project.rafterSize, rafterSpacing, attachmentSpacing, structural compliance
//   PV-4: overrides[] for flagged panel brand + photo notes
//
// NON-NEGOTIABLE RULES:
//   - NEVER throws — all errors are logged
//   - NEVER calls DB, network, or filesystem
//   - Returns PARTIAL PermitInput — caller owns the merge
//   - Existing PermitInput fields take precedence EXCEPT for physical measurements
//     (roofType, roofPitch, rafterSize, rafterSpacing, mainPanelAmps)
//   - Survey-derived roof planes are added to project.roofPlanes (merged, not replaced)
// ============================================================================

// PIPELINE STATUS: WIRED — imported by app/api/engineering/permit/route.ts
import {
  SITE_SURVEY_PIPELINE_VERSION,
  type EnrichedSiteSurvey,
} from './types';

import type { PermitInput } from '@/lib/permit/types';

// ─── Output type ──────────────────────────────────────────────────────────────

/**
 * PermitInputPatch — a partial PermitInput derived entirely from survey data.
 * Caller merges this into their existing PermitInput.
 *
 * MERGE STRATEGY:
 *   project.*  — survey wins for physical measurements; caller wins for design values
 *   system.*   — NOT patched (design pipeline owns system data)
 *   compliance.* — survey adds warnings; existing compliance data preserved
 *   aerialData.* — survey provides roofSegments from CAD surfaces
 *   overrides  — survey appends (never replaces) override notes
 */
export type PermitInputPatch = {
  project?: Partial<PermitInput['project']>;
  compliance?: Partial<PermitInput['compliance']>;
  aerialData?: Partial<NonNullable<PermitInput['aerialData']>>;
  overrides?: NonNullable<PermitInput['overrides']>;
};

/**
 * Full result of permitIntegration().
 */
export interface PermitIntegrationResult {
  /** Partial PermitInput to merge into existing PermitInput */
  patch: PermitInputPatch;

  /**
   * PV-1 through PV-4 sheet-specific data derived from survey.
   * These are pre-formatted strings for direct use in plan set templates.
   */
  sheetData: {
    /** PV-1: Site description for title block */
    pv1SiteDescription: string;
    /** PV-1: GPS coordinates string */
    pv1Coordinates: string | null;
    /** PV-2: Electrical panel description for SLD */
    pv2PanelDescription: string;
    /** PV-2: Interconnection method description */
    pv2InterconnectionNote: string;
    /** PV-2: NEC 705.12 compliance note */
    pv2NecNote: string;
    /** PV-3: Structural notes for structural sheet */
    pv3StructuralNotes: string[];
    /** PV-3: Structural feasibility summary */
    pv3FeasibilitySummary: string;
    /** PV-4: Special notes for plan set cover */
    pv4SpecialNotes: string[];
    /** PV-4: Photo attachment keys available */
    pv4PhotoKeys: string[];
  };

  /** Integration log */
  permitLog: string[];
  warnings: string[];
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * permitIntegration — builds PermitInput patches from an EnrichedSiteSurvey.
 *
 * Pure synchronous function. Never throws.
 *
 * @param survey  EnrichedSiteSurvey (output of enrichSurvey)
 * @returns       PermitIntegrationResult
 */
export function permitIntegration(
  survey: EnrichedSiteSurvey,
): PermitIntegrationResult {
  const log: string[] = [];
  const warnings: string[] = [];

  log.push(`[permit] Building permit integration for survey=${survey.id} project=${survey.projectId} pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  // Build each section
  const projectPatch = buildProjectPatch(survey, log, warnings);
  const compliancePatch = buildCompliancePatch(survey, log, warnings);
  const aerialDataPatch = buildAerialDataPatch(survey, log);
  const overridesPatch = buildOverridesPatch(survey, log);
  const sheetData = buildSheetData(survey, log, warnings);

  const patch: PermitInputPatch = {
    project: projectPatch,
    compliance: compliancePatch,
    aerialData: aerialDataPatch,
    overrides: overridesPatch,
  };

  log.push(`[permit] Complete: ${Object.keys(projectPatch).length} project fields, ${overridesPatch.length} overrides, ${warnings.length} warnings`);

  return { patch, sheetData, permitLog: log, warnings };
}

// ─── PV-1: Project patch (site data) ─────────────────────────────────────────

function buildProjectPatch(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): Partial<PermitInput['project']> {
  const patch: Partial<PermitInput['project']> = {};
  const s = survey.structural;
  const e = survey.electrical;

  // ── Location ─────────────────────────────────────────────────────────────────
  if (survey.location.lat !== null) {
    patch.lat = survey.location.lat;
    log.push(`[permit] project.lat = ${survey.location.lat}`);
  }
  if (survey.location.lng !== null) {
    patch.lng = survey.location.lng;
    log.push(`[permit] project.lng = ${survey.location.lng}`);
  }
  if (survey.location.address) {
    patch.address = survey.location.address;
    log.push(`[permit] project.address = "${survey.location.address}"`);
  }

  // ── System type ───────────────────────────────────────────────────────────────
  patch.systemType = survey.systemType;
  log.push(`[permit] project.systemType = '${survey.systemType}'`);

  // ── Structural data for PV-3 ──────────────────────────────────────────────────

  // Roof type — physical material from field inspection
  if (s.roofMaterial) {
    patch.roofType = s.roofMaterial;
    log.push(`[permit] project.roofType = '${s.roofMaterial}'`);
  }

  // Roof pitch — from structural data (degrees)
  if (s.roofPitchDegrees !== null) {
    patch.roofPitch = s.roofPitchDegrees;
    log.push(`[permit] project.roofPitch = ${s.roofPitchDegrees}°`);
  } else if (survey.geometry.roofPlanes.length > 0) {
    const pitch = survey.geometry.roofPlanes[0].pitch;
    if (pitch > 0) {
      patch.roofPitch = pitch;
      log.push(`[permit] project.roofPitch = ${pitch}° (from primary roof plane)`);
    }
  }

  // Rafter size
  if (s.rafterSize && s.rafterSize !== 'other') {
    patch.rafterSize = s.rafterSize;
    log.push(`[permit] project.rafterSize = '${s.rafterSize}'`);
  }

  // Rafter spacing
  const rafterSpacingCaptured = !survey.normalizationLog.some(
    l => l.includes('rafterSpacingIn not provided')
  );
  if (rafterSpacingCaptured) {
    patch.rafterSpacing = s.rafterSpacingIn;
    log.push(`[permit] project.rafterSpacing = ${s.rafterSpacingIn}"`);
  }

  // ── Electrical data for PV-2 ──────────────────────────────────────────────────

  // Main panel amps
  if (e.mainPanelRatingAmps !== null) {
    patch.mainPanelAmps = e.mainPanelRatingAmps;
    log.push(`[permit] project.mainPanelAmps = ${e.mainPanelRatingAmps}A`);
  } else {
    warnings.push(`Main panel amperage not captured — permit will use design pipeline default`);
  }

  // Main panel brand
  if (e.panelBrand !== 'unknown') {
    patch.mainPanelBrand = normalizePanelBrandForPermit(e.panelBrand);
    log.push(`[permit] project.mainPanelBrand = '${patch.mainPanelBrand}'`);
  }

  // Utility meter type
  if (e.meterType !== 'unknown') {
    patch.utilityMeter = e.meterType;
    log.push(`[permit] project.utilityMeter = '${e.meterType}'`);
  }

  // Interconnection method
  const interconnectionMethod = resolvePermitInterconnectionMethod(e, survey.derived.electricalFeasibility);
  patch.interconnectionMethod = interconnectionMethod;
  log.push(`[permit] project.interconnectionMethod = '${interconnectionMethod}'`);

  // Panel bus rating
  if (e.busbarRatingAmps !== null) {
    patch.panelBusRating = e.busbarRatingAmps;
    log.push(`[permit] project.panelBusRating = ${e.busbarRatingAmps}A`);
  }

  // Roof planes for permit system
  if (survey.geometry.roofPlanes.length > 0) {
    patch.roofPlanes = survey.geometry.roofPlanes.map(plane => ({
      id: plane.id,
      vertices: plane.vertices,
      pitch: plane.pitch,
      azimuth: plane.azimuth,
      area: plane.area,
      source: 'site_survey' as const,
    }));
    log.push(`[permit] project.roofPlanes = ${survey.geometry.roofPlanes.length} planes from survey`);
  }

  return patch;
}

// ─── PV-2: Compliance patch ───────────────────────────────────────────────────

function buildCompliancePatch(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): Partial<PermitInput['compliance']> {
  const ef = survey.derived.electricalFeasibility;
  const sf = survey.derived.structuralFeasibility;

  const structuralNotes: string[] = [];
  const electricalNotes: string[] = [];

  // Structural compliance notes
  if (!sf.feasible) {
    structuralNotes.push(`STRUCTURAL FLAGS (from site survey):`);
    sf.flags.forEach(f => structuralNotes.push(`  • ${f}`));
  }
  if (sf.warnings.length > 0) {
    sf.warnings.forEach(w => structuralNotes.push(`  ⚠ ${w}`));
  }

  // Electrical compliance notes
  if (!ef.feasible) {
    electricalNotes.push(`ELECTRICAL FLAGS (from site survey):`);
    ef.flags.forEach(f => electricalNotes.push(`  • ${f}`));
  }
  if (!ef.nec120PctRule.likelyPasses && ef.nec120PctRule.maxBackfeedAmps !== null) {
    electricalNotes.push(`NEC 705.12(B)(2): maxBackfeedAmps=${ef.nec120PctRule.maxBackfeedAmps}A — panel upgrade may be required`);
  }
  if (ef.warnings.length > 0) {
    ef.warnings.forEach(w => electricalNotes.push(`  ⚠ ${w}`));
  }

  const overallStatus = (sf.feasible && ef.feasible) ? 'pass' : 'warning';
  log.push(`[permit] compliance.overallStatus = '${overallStatus}' (structural=${sf.feasible ? 'pass' : 'fail'} electrical=${ef.feasible ? 'pass' : 'fail'})`);

  return {
    overallStatus,
    structural: structuralNotes.length > 0 ? { surveyNotes: structuralNotes } : undefined,
    electrical: electricalNotes.length > 0 ? { surveyNotes: electricalNotes } : undefined,
  };
}

// ─── PV-1: Aerial data patch (roof segments from CAD surfaces) ────────────────

function buildAerialDataPatch(
  survey: EnrichedSiteSurvey,
  log: string[],
): Partial<NonNullable<PermitInput['aerialData']>> {
  if (survey.derived.cadRoofSurfaces.length === 0) {
    return {};
  }

  // Build roof segments from enriched CAD surfaces
  const roofSegments = survey.derived.cadRoofSurfaces.map(surface => ({
    pitchDegrees: surface.pitchDeg,
    azimuthDegrees: surface.azimuth,
    areaM2: surface.totalAreaSqFt * 0.0929,
    polygon: surface.usablePolygon.length >= 3 ? surface.usablePolygon : undefined,
    center: surface.usablePolygon.length >= 3
      ? computePolygonCentroid(surface.usablePolygon)
      : undefined,
  }));

  // GPS coordinates for aerial image request
  const lat = survey.location.lat ?? undefined;
  const lng = survey.location.lng ?? undefined;

  log.push(`[permit] aerialData.roofSegments = ${roofSegments.length} segments from survey CAD surfaces`);

  return {
    lat,
    lng,
    roofSegments,
  };
}

// ─── PV-4: Overrides patch (special notes from survey) ───────────────────────

function buildOverridesPatch(
  survey: EnrichedSiteSurvey,
  log: string[],
): NonNullable<PermitInput['overrides']> {
  const overrides: NonNullable<PermitInput['overrides']> = [];
  const sf = survey.derived.structuralFeasibility;
  const ef = survey.derived.electricalFeasibility;
  const now = new Date().toISOString();

  // Flagged panel brand override note
  if (!ef.checks.notFederalPacificOrZinsco) {
    overrides.push({
      field: 'project.mainPanelBrand',
      overrideValue: survey.electrical.panelBrand,
      justification: `Site survey identified flagged panel brand '${survey.electrical.panelBrand}'. ` +
        `Panel replacement is required before solar installation per AHJ and NEC requirements.`,
      engineer: 'Site Survey Pipeline',
      timestamp: now,
    });
    log.push(`[permit] override: flagged panelBrand=${survey.electrical.panelBrand}`);
  }

  // Poor roof condition override note
  if (survey.structural.roofCondition === 'poor') {
    overrides.push({
      field: 'project.roofType',
      overrideValue: `${survey.structural.roofMaterial ?? 'unknown'} (POOR CONDITION)`,
      justification: `Site survey identified poor roof condition. ` +
        `Roof replacement or structural reinforcement may be required before solar installation.`,
      engineer: 'Site Survey Pipeline',
      timestamp: now,
    });
    log.push(`[permit] override: roofCondition=poor`);
  }

  // Rafter spacing over-limit override note
  if (!sf.checks.rafterSpacingOk) {
    overrides.push({
      field: 'project.rafterSpacing',
      overrideValue: survey.structural.rafterSpacingIn,
      justification: `Site survey measured rafter spacing ${survey.structural.rafterSpacingIn}" OC ` +
        `exceeds standard 24" OC maximum. Engineering review required for attachment design.`,
      engineer: 'Site Survey Pipeline',
      timestamp: now,
    });
    log.push(`[permit] override: rafterSpacing=${survey.structural.rafterSpacingIn}" over limit`);
  }

  // Aged roof override note
  if (survey.structural.roofAgeYears !== null && survey.structural.roofAgeYears >= 20) {
    overrides.push({
      field: 'project.notes',
      overrideValue: `Roof age: ${survey.structural.roofAgeYears} years`,
      justification: `Roof is ${survey.structural.roofAgeYears} years old. ` +
        `Verify remaining shingle life and structural integrity before installation.`,
      engineer: 'Site Survey Pipeline',
      timestamp: now,
    });
    log.push(`[permit] override: roofAge=${survey.structural.roofAgeYears} years`);
  }

  return overrides;
}

// ─── Sheet data builder ───────────────────────────────────────────────────────

function buildSheetData(
  survey: EnrichedSiteSurvey,
  log: string[],
  warnings: string[],
): PermitIntegrationResult['sheetData'] {
  const s = survey.structural;
  const e = survey.electrical;
  const sf = survey.derived.structuralFeasibility;
  const ef = survey.derived.electricalFeasibility;

  // PV-1: Site description
  const siteDesc = [
    survey.location.address ?? 'Address not captured',
    survey.systemType ? `(${survey.systemType} mount)` : null,
    s.roofMaterial ? `Roof: ${s.roofMaterial}` : null,
    s.roofPitch ? `Pitch: ${s.roofPitch}` : null,
  ].filter(Boolean).join(' — ');

  // PV-1: GPS coordinates
  const coords = (survey.location.lat !== null && survey.location.lng !== null)
    ? `${survey.location.lat.toFixed(6)}°N, ${Math.abs(survey.location.lng).toFixed(6)}°${survey.location.lng < 0 ? 'W' : 'E'}`
    : null;

  // PV-2: Panel description
  const panelBrandDisplay: Record<string, string> = {
    siemens: 'Siemens', square_d: 'Square D', eaton: 'Eaton',
    cutler_hammer: 'Cutler-Hammer', ge: 'GE', federal_pacific: 'Federal Pacific ⚠',
    zinsco: 'Zinsco ⚠', leviton: 'Leviton', other: 'Other', unknown: 'Unknown',
  };
  const panelDesc = [
    panelBrandDisplay[e.panelBrand] ?? e.panelBrand,
    e.mainPanelRatingAmps ? `${e.mainPanelRatingAmps}A` : null,
    e.busbarRatingAmps ? `(${e.busbarRatingAmps}A busbar)` : null,
  ].filter(Boolean).join(' ');

  // PV-2: Interconnection note
  const nec120 = ef.nec120PctRule;
  let interconnectionNote: string;
  if (nec120.maxBackfeedAmps !== null && nec120.maxBackfeedAmps > 0) {
    interconnectionNote = `Load-side interconnection via NEC 705.12(B)(2). ` +
      `Max backfeed breaker: ${nec120.maxBackfeedAmps}A. ` +
      `(${nec120.busbarAmps}A busbar × 1.2 − ${nec120.mainPanelAmps}A main)`;
  } else if (nec120.maxBackfeedAmps !== null && nec120.maxBackfeedAmps <= 0) {
    interconnectionNote = `NEC 705.12(B)(2) 120% rule fails — panel upgrade or supply-side tap required.`;
    warnings.push(`NEC 705.12(B)(2) fails — panel upgrade noted in permit plan set`);
  } else {
    interconnectionNote = `Panel data not captured — NEC 705.12 compliance requires field verification.`;
  }

  // PV-2: NEC note
  const necNote = nec120.likelyPasses
    ? `NEC 705.12(B)(2) COMPLIANT — backfeed breaker ≤ ${nec120.maxBackfeedAmps}A`
    : `NEC 705.12(B)(2) NON-COMPLIANT — see interconnection plan for resolution`;

  // PV-3: Structural notes
  const structuralNotes: string[] = [
    `Rafter: ${s.rafterSize} @ ${s.rafterSpacingIn}" OC`,
    `Decking: ${s.deckingThicknessIn}" ${s.roofMaterial ?? ''}`,
    s.roofCondition ? `Roof condition: ${s.roofCondition}` : null,
    s.roofAgeYears !== null ? `Roof age: ${s.roofAgeYears} years` : null,
    s.windExposure ? `Wind exposure: Category ${s.windExposure} (ASCE 7-22)` : null,
    s.snowLoadPsf !== null ? `Ground snow load: ${s.snowLoadPsf} psf` : null,
    s.atticAccess !== null ? `Attic access: ${s.atticAccess ? 'Yes' : 'No'}` : null,
  ].filter((n): n is string => n !== null);

  // Add structural flags
  sf.flags.forEach(f => structuralNotes.push(`⚠ FLAG: ${f}`));
  sf.warnings.forEach(w => structuralNotes.push(`⚠ WARN: ${w}`));

  // PV-3: Feasibility summary
  const feasibilitySummary = sf.feasible
    ? `STRUCTURAL: PASS — Site survey confirms standard mounting conditions`
    : `STRUCTURAL: REQUIRES REVIEW — ${sf.flags.join('; ')}`;

  // PV-4: Special notes
  const specialNotes: string[] = [];
  if (!ef.checks.notFederalPacificOrZinsco) {
    specialNotes.push(`⚠ FLAGGED PANEL BRAND: ${panelBrandDisplay[e.panelBrand]} — replacement required before installation`);
  }
  if (survey.structural.roofCondition === 'poor') {
    specialNotes.push(`⚠ POOR ROOF CONDITION: Structural assessment required before installation`);
  }
  if (!ef.checks.panelRatingSufficient && e.mainPanelRatingAmps !== null) {
    specialNotes.push(`⚠ UNDERSIZED PANEL: ${e.mainPanelRatingAmps}A panel — upgrade to 100A minimum required`);
  }
  if (survey.structural.roofAgeYears !== null && survey.structural.roofAgeYears >= 20) {
    specialNotes.push(`⚠ ROOF AGE: ${survey.structural.roofAgeYears} years — verify remaining shingle life`);
  }
  if (survey.installerNotes) {
    specialNotes.push(`INSTALLER NOTES: ${survey.installerNotes}`);
  }

  // PV-4: Photo keys
  const pv4PhotoKeys = survey.photos.map(p => p.slotKey);

  return {
    pv1SiteDescription: siteDesc,
    pv1Coordinates: coords,
    pv2PanelDescription: panelDesc,
    pv2InterconnectionNote: interconnectionNote,
    pv2NecNote: necNote,
    pv3StructuralNotes: structuralNotes,
    pv3FeasibilitySummary: feasibilitySummary,
    pv4SpecialNotes: specialNotes,
    pv4PhotoKeys,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePanelBrandForPermit(brand: string): string {
  const DISPLAY: Record<string, string> = {
    siemens: 'Siemens',
    square_d: 'Square D / Schneider Electric',
    eaton: 'Eaton',
    cutler_hammer: 'Cutler-Hammer (Eaton)',
    ge: 'General Electric (GE)',
    federal_pacific: 'Federal Pacific Electric (FPE)',
    zinsco: 'Zinsco / Sylvania',
    leviton: 'Leviton',
    other: 'Other',
    unknown: 'Unknown',
  };
  return DISPLAY[brand] ?? brand;
}

function resolvePermitInterconnectionMethod(
  e: EnrichedSiteSurvey['electrical'],
  ef: EnrichedSiteSurvey['derived']['electricalFeasibility'],
): string {
  if (e.interconnectionPoint === 'supply_side') return 'Supply-Side (NEC 705.11)';
  if (!ef.checks.notFederalPacificOrZinsco) return 'Panel Upgrade Required';
  if (ef.nec120PctRule.likelyPasses) {
    return `Load-Side Breaker (NEC 705.12(B)(2)) — max ${ef.nec120PctRule.maxBackfeedAmps}A`;
  }
  return 'See Electrical Engineer';
}

function computePolygonCentroid(
  polygon: Array<{ lat: number; lng: number }>,
): { lat: number; lng: number } {
  const n = polygon.length;
  if (n === 0) return { lat: 0, lng: 0 };
  const sumLat = polygon.reduce((s, p) => s + p.lat, 0);
  const sumLng = polygon.reduce((s, p) => s + p.lng, 0);
  return { lat: sumLat / n, lng: sumLng / n };
}