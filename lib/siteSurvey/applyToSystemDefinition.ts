// ============================================================================
// lib/siteSurvey/applyToSystemDefinition.ts — Survey Override Layer
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   RawSurveyPayload
//     → normalizeSurvey()  → NormalizedSiteSurvey
//     → enrichSurvey()     → EnrichedSiteSurvey
//     → applyToSystemDefinition() ← YOU ARE HERE → SystemDefinition (patched)
//
// RESPONSIBILITIES:
//   Apply verified survey data as an OVERRIDE LAYER on top of an existing
//   SystemDefinition. Survey data wins only when:
//     1. The survey field is explicitly captured (non-null)
//     2. The existing SystemDefinition field is missing OR survey value differs
//     3. The override is explicitly allowed by the field allowlist
//
// NON-NEGOTIABLE RULES:
//   - NEVER mutates the input SystemDefinition — returns a new object
//   - NEVER replaces a confirmed design value with a survey default
//   - NEVER allows RawSurveyPayload here — only EnrichedSiteSurvey
//   - ALL overrides are logged in SurveyOverrideContext.overriddenFields
//   - ALL skipped fields are logged in SurveyOverrideContext.skippedFields
//   - If no survey is provided, the original SystemDefinition is returned unchanged
//
// PATTERN:
//   applyToSystemDefinition(existing, survey) → { definition, context }
//   - existing: SystemDefinition built by buildSystemDefinition()
//   - survey:   EnrichedSiteSurvey (output of enrichSurvey())
//   - Returns a NEW SystemDefinition with survey fields applied as overrides
//   - Returns a SurveyOverrideContext with full audit trail
// ============================================================================

import {
  type SystemDefinition,
  type LayoutDefinition,
  type StructureDefinition,
  type ElectricalDefinition,
} from '@/lib/system/systemDefinition';

import {
  SITE_SURVEY_PIPELINE_VERSION,
  type EnrichedSiteSurvey,
  type SurveyOverrideContext,
} from './types';

// ─── Return type ──────────────────────────────────────────────────────────────

export interface SurveyOverrideResult {
  /** The patched SystemDefinition — always a new object, never mutated */
  definition: SystemDefinition;
  /** Audit context: which fields were overridden, which were skipped, why */
  context: SurveyOverrideContext;
}

// ─── Main override function ───────────────────────────────────────────────────

/**
 * applyToSystemDefinition — applies survey data as a safe override layer.
 *
 * SAFETY GUARANTEE: If the survey has no relevant data for a field,
 * the existing value is ALWAYS preserved. Survey data is additive only.
 *
 * @param existing  SystemDefinition built from project data (buildSystemDefinition)
 * @param survey    EnrichedSiteSurvey (output of enrichSurvey)
 * @returns         New SystemDefinition with survey overrides applied + audit context
 */
export function applyToSystemDefinition(
  existing: SystemDefinition,
  survey: EnrichedSiteSurvey,
): SurveyOverrideResult {
  const overriddenFields: string[] = [];
  const skippedFields: string[] = [];
  const log: string[] = [];

  log.push(`[override] Applying survey=${survey.id} project=${survey.projectId} pipeline_v${SITE_SURVEY_PIPELINE_VERSION}`);

  // ── 1. System type override ────────────────────────────────────────────────
  // Survey system type is authoritative for install type determination.
  // The field app is the source of truth for what physical system is being installed.

  let systemType = existing.systemType;
  if (survey.systemType && survey.systemType !== existing.systemType) {
    systemType = survey.systemType;
    overriddenFields.push('systemType');
    log.push(`[override] systemType: "${existing.systemType}" → "${survey.systemType}"`);
  } else {
    skippedFields.push('systemType');
  }

  // ── 2. Layout overrides ────────────────────────────────────────────────────
  const layout = applyLayoutOverrides(existing.layout, survey, overriddenFields, skippedFields, log);

  // ── 3. Structure overrides ─────────────────────────────────────────────────
  const structure = applyStructureOverrides(existing.structure, survey, overriddenFields, skippedFields, log);

  // ── 4. Electrical overrides ────────────────────────────────────────────────
  const electrical = applyElectricalOverrides(existing.electrical, survey, overriddenFields, skippedFields, log);

  // ── 5. Build result ────────────────────────────────────────────────────────
  // Panel definition is NOT overridden here — panels are confirmed by the
  // design pipeline and are not a field-survey concern.

  const definition: SystemDefinition = {
    ...existing,
    systemType,
    layout,
    structure,
    electrical,
  };

  const context: SurveyOverrideContext = {
    survey,
    appliedAt: new Date().toISOString(),
    overriddenFields,
    skippedFields,
  };

  log.push(`[override] Complete: ${overriddenFields.length} overridden, ${skippedFields.length} skipped`);
  log.forEach(l => console.log(l));

  return { definition, context };
}

// ─── Layout override ──────────────────────────────────────────────────────────

function applyLayoutOverrides(
  existing: LayoutDefinition,
  survey: EnrichedSiteSurvey,
  overriddenFields: string[],
  skippedFields: string[],
  log: string[],
): LayoutDefinition {
  // Start with existing layout — spread to avoid mutation
  const layout: LayoutDefinition = { ...existing };

  // ── Azimuth — survey wins when field-captured on a roof plane
  // Use the enriched effective azimuth (computed from primary plane or lat-fallback)
  const surveyAzimuth = survey.derived.effectiveAzimuth;
  const primaryPlane = survey.geometry.roofPlanes[0];

  // Only override azimuth if we have a real measured plane azimuth
  // (not just the inferred fallback — the derived.effectiveAzimuth could be a default)
  if (primaryPlane && primaryPlane.azimuth !== null && primaryPlane.azimuth !== undefined) {
    if (layout.azimuth !== primaryPlane.azimuth) {
      layout.azimuth = primaryPlane.azimuth;
      overriddenFields.push('layout.azimuth');
      log.push(`[override] layout.azimuth: ${existing.azimuth}° → ${primaryPlane.azimuth}° (from primary roof plane)`);
    } else {
      skippedFields.push('layout.azimuth');
    }
  } else if (surveyAzimuth !== existing.azimuth) {
    // Use inferred azimuth only if existing is still at default (180)
    // and the survey-inferred value differs — conservative approach
    skippedFields.push('layout.azimuth');
    log.push(`[override] layout.azimuth skipped — no measured plane azimuth (inferred=${surveyAzimuth}°, keeping existing=${existing.azimuth}°)`);
  } else {
    skippedFields.push('layout.azimuth');
  }

  // ── Tilt — use pitch from primary roof plane (authoritative field measurement)
  if (primaryPlane && primaryPlane.pitch !== null && primaryPlane.pitch !== undefined && primaryPlane.pitch > 0) {
    if (layout.tilt !== primaryPlane.pitch) {
      layout.tilt = primaryPlane.pitch;
      overriddenFields.push('layout.tilt');
      log.push(`[override] layout.tilt: ${existing.tilt}° → ${primaryPlane.pitch}° (from primary roof plane pitch)`);
    } else {
      skippedFields.push('layout.tilt');
    }
  } else {
    skippedFields.push('layout.tilt');
  }

  // ── Total panels — NOT overridden by survey (design pipeline owns this)
  skippedFields.push('layout.totalPanels');

  // ── Row spacing — NOT overridden by survey (engineering owns this)
  skippedFields.push('layout.rowSpacing');

  return layout;
}

// ─── Structure override ───────────────────────────────────────────────────────

function applyStructureOverrides(
  existing: StructureDefinition,
  survey: EnrichedSiteSurvey,
  overriddenFields: string[],
  skippedFields: string[],
  log: string[],
): StructureDefinition {
  const structure: StructureDefinition = { ...existing };
  const s = survey.structural;

  // ── Rafter size — survey field measurement wins over design assumption
  if (s.rafterSize && s.rafterSize !== 'other') {
    const surveyRafterSize = s.rafterSize;
    if (structure.rafterSize !== surveyRafterSize) {
      structure.rafterSize = surveyRafterSize;
      overriddenFields.push('structure.rafterSize');
      log.push(`[override] structure.rafterSize: "${existing.rafterSize ?? 'none'}" → "${surveyRafterSize}"`);
    } else {
      skippedFields.push('structure.rafterSize');
    }
  } else {
    skippedFields.push('structure.rafterSize');
  }

  // ── Rafter spacing — survey field measurement is authoritative
  // Only override if survey captured an explicit value (not just default 24")
  // We infer "explicit capture" by checking if normalizationLog contains a warning
  // about it being missing. Since we don't have that here, we check the structural
  // feasibility flags — if rafterSpacingOk flag ran, spacing was available.
  const rafterSpacingCaptured = !survey.normalizationLog.some(
    l => l.includes('rafterSpacingIn not provided')
  );
  if (rafterSpacingCaptured && s.rafterSpacingIn > 0) {
    if (structure.rafterSpacing !== s.rafterSpacingIn) {
      structure.rafterSpacing = s.rafterSpacingIn;
      overriddenFields.push('structure.rafterSpacing');
      log.push(`[override] structure.rafterSpacing: ${existing.rafterSpacing ?? 'none'}" → ${s.rafterSpacingIn}"`);
    } else {
      skippedFields.push('structure.rafterSpacing');
    }
  } else {
    skippedFields.push('structure.rafterSpacing');
    if (!rafterSpacingCaptured) {
      log.push(`[override] structure.rafterSpacing skipped — not explicitly captured in survey`);
    }
  }

  // ── Roof pitch — use from survey structural data (normalized degrees)
  if (s.roofPitchDegrees !== null) {
    if (structure.roofPitch !== s.roofPitchDegrees) {
      structure.roofPitch = s.roofPitchDegrees;
      overriddenFields.push('structure.roofPitch');
      log.push(`[override] structure.roofPitch: ${existing.roofPitch ?? 'none'}° → ${s.roofPitchDegrees}°`);
    } else {
      skippedFields.push('structure.roofPitch');
    }
  } else if (survey.geometry.roofPlanes.length > 0) {
    // Fall back to pitch from primary roof plane
    const primaryPitch = survey.geometry.roofPlanes[0].pitch;
    if (primaryPitch > 0 && structure.roofPitch !== primaryPitch) {
      structure.roofPitch = primaryPitch;
      overriddenFields.push('structure.roofPitch');
      log.push(`[override] structure.roofPitch: ${existing.roofPitch ?? 'none'}° → ${primaryPitch}° (from roof plane)`);
    } else {
      skippedFields.push('structure.roofPitch');
    }
  } else {
    skippedFields.push('structure.roofPitch');
  }

  // ── Roof type — survey material maps to roofType string
  if (s.roofMaterial) {
    if (structure.roofType !== s.roofMaterial) {
      structure.roofType = s.roofMaterial;
      overriddenFields.push('structure.roofType');
      log.push(`[override] structure.roofType: "${existing.roofType ?? 'none'}" → "${s.roofMaterial}"`);
    } else {
      skippedFields.push('structure.roofType');
    }
  } else {
    skippedFields.push('structure.roofType');
  }

  // Attachment spacing — NOT overridden (engineering owns this)
  skippedFields.push('structure.attachmentSpacing');

  // Rail orientation — NOT overridden by survey (design pipeline owns this)
  skippedFields.push('structure.railOrientation');

  return structure;
}

// ─── Electrical override ──────────────────────────────────────────────────────

function applyElectricalOverrides(
  existing: ElectricalDefinition,
  survey: EnrichedSiteSurvey,
  overriddenFields: string[],
  skippedFields: string[],
  log: string[],
): ElectricalDefinition {
  const electrical: ElectricalDefinition = { ...existing };
  const e = survey.electrical;

  // ── Main panel amps — survey field measurement wins
  // This is critical for NEC 705.12 compliance.
  // Survey is authoritative because it physically reads the panel label.
  if (e.mainPanelRatingAmps !== null) {
    if (electrical.mainPanelAmps !== e.mainPanelRatingAmps) {
      electrical.mainPanelAmps = e.mainPanelRatingAmps;
      overriddenFields.push('electrical.mainPanelAmps');
      log.push(`[override] electrical.mainPanelAmps: ${existing.mainPanelAmps ?? 'none'}A → ${e.mainPanelRatingAmps}A (from survey)`);
    } else {
      skippedFields.push('electrical.mainPanelAmps');
    }
  } else {
    skippedFields.push('electrical.mainPanelAmps');
    log.push(`[override] electrical.mainPanelAmps skipped — not captured in survey`);
  }

  // Inverter type, string size, DC/AC kW — NOT overridden by survey
  // These are owned by the design pipeline.
  skippedFields.push('electrical.inverterType');
  skippedFields.push('electrical.stringSize');
  skippedFields.push('electrical.totalDcKw');
  skippedFields.push('electrical.totalAcKw');

  return electrical;
}