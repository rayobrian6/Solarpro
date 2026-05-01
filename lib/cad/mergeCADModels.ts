// ============================================================================
// lib/cad/mergeCADModels.ts — Survey → CAD Constraint Overlay (Phase 3)
//
// VERSION: SITE_SURVEY_PIPELINE_VERSION = 1
//
// PIPELINE POSITION:
//   generateCADLayout()   → CADModel (solved)      ← base
//   buildCADFromSurvey()  → SurveyCADInputs        ← overlay source
//   mergeCADModels()      → MergeResult            ← YOU ARE HERE
//
// CONTRACTS (NON-NEGOTIABLE):
//   - ONLY adds survey constraints — NEVER removes panels
//   - NEVER re-runs the CAD solver
//   - NEVER throws — all errors push to mergeLog; baseCAD returned as-is
//   - Returns baseCAD UNCHANGED when surveyInputs is null/undefined
//   - Returns baseCAD UNCHANGED when system type mismatch
//   - Appends survey warnings to cad.warnings (never replaces them)
//   - Attaches _surveyMeta for audit trail
//
// WHAT IT OVERLAYS (constraint-only, all optional):
//   - GPS origin (only when base has 0,0)
//   - systemDefinition.layout.azimuth (from survey primary plane)
//   - systemDefinition.layout.tilt (from survey primary plane)
//   - systemDefinition.structure.rafterSpacing (from survey)
//   - systemDefinition.structure.roofType (from survey)
// ============================================================================

import type { CADModel } from './types';
import type { SurveyCADInputs } from './buildCADFromSurvey';

// ── MergeResult ──────────────────────────────────────────────────────────────

export interface MergeResult {
  /** The merged (or unchanged) CAD model */
  model:     CADModel;
  /** All log messages from the merge process */
  mergeLog:  string[];
  /** Fields that were successfully overlaid from survey data */
  applied:   string[];
  /** Fields that were skipped (reason included in mergeLog) */
  skipped:   string[];
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * mergeCADModels — overlays survey-derived constraints onto a solved CADModel.
 *
 * Pure function (no DB, no network, no filesystem).
 * Safe to call from any context — never throws.
 *
 * @param baseCAD       The fully-solved CADModel from generateCADLayout()
 * @param surveyInputs  Optional SurveyCADInputs from buildCADFromSurvey()
 * @returns             MergeResult with merged model + audit trail
 */
export function mergeCADModels(
  baseCAD:        CADModel,
  surveyInputs?:  SurveyCADInputs | null,
): MergeResult {
  const log:     string[] = [];
  const applied: string[] = [];
  const skipped: string[] = [];

  // ── Guard: no survey data ─────────────────────────────────────────────────
  if (!surveyInputs) {
    log.push('[merge] No surveyInputs — returning baseCAD unchanged');
    return { model: baseCAD, mergeLog: log, applied, skipped };
  }

  try {
    // ── Guard: system type mismatch ───────────────────────────────────────────
    if (
      surveyInputs.systemType &&
      surveyInputs.systemType !== baseCAD.systemType
    ) {
      const msg = `[merge] System type mismatch: base=${baseCAD.systemType} survey=${surveyInputs.systemType} — skipping all geometry overlays`;
      log.push(msg);
      skipped.push('all-geometry (type-mismatch)');
      return { model: baseCAD, mergeLog: log, applied, skipped };
    }

    // Work on a shallow copy — never mutate baseCAD directly
    let model: CADModel = { ...baseCAD };

    // ── Overlay 1: GPS origin (only when base has 0,0) ────────────────────────
    if (
      surveyInputs.origin !== null &&
      surveyInputs.origin !== undefined &&
      model.originLat === 0 &&
      model.originLng === 0
    ) {
      model = {
        ...model,
        originLat: surveyInputs.origin.lat,
        originLng: surveyInputs.origin.lng,
      };
      applied.push('originLat');
      applied.push('originLng');
      log.push(`[merge] GPS origin applied: ${surveyInputs.origin.lat.toFixed(6)}, ${surveyInputs.origin.lng.toFixed(6)}`);
    } else if (surveyInputs.origin !== null && surveyInputs.origin !== undefined) {
      skipped.push('origin (base already has GPS)');
      log.push('[merge] GPS origin skipped — base already has non-zero origin');
    }

    // ── Overlay 2: systemDefinition fields ────────────────────────────────────
    // These overlay the systemDefinition sub-object only — panels/bounds unchanged
    const overrides = surveyInputs.overrides;

    if (overrides) {
      // Build an updated systemDefinition (or create minimal one if absent)
      const baseDef = model.systemDefinition ?? null;

      let defChanged = false;
      let updatedDef = baseDef ? { ...baseDef } : null;

      // Azimuth
      if (
        overrides.azimuth !== undefined &&
        overrides.azimuth !== null
      ) {
        if (updatedDef) {
          updatedDef = {
            ...updatedDef,
            layout: {
              ...updatedDef.layout,
              azimuth: overrides.azimuth,
            },
          };
        }
        defChanged = true;
        applied.push('systemDefinition.layout.azimuth');
        log.push(`[merge] azimuth overlaid: ${overrides.azimuth}°`);
      } else {
        skipped.push('azimuth (not in survey)');
      }

      // Tilt
      if (
        overrides.tilt !== undefined &&
        overrides.tilt !== null
      ) {
        if (updatedDef) {
          updatedDef = {
            ...updatedDef,
            layout: {
              ...updatedDef.layout,
              tilt: overrides.tilt,
            },
          };
        }
        defChanged = true;
        applied.push('systemDefinition.layout.tilt');
        log.push(`[merge] tilt overlaid: ${overrides.tilt}°`);
      } else {
        skipped.push('tilt (not in survey)');
      }

      // Rafter spacing
      if (
        overrides.rafterSpacingIn !== undefined &&
        overrides.rafterSpacingIn !== null
      ) {
        if (updatedDef) {
          updatedDef = {
            ...updatedDef,
            structure: {
              ...updatedDef.structure,
              rafterSpacing: overrides.rafterSpacingIn,
            },
          };
        }
        defChanged = true;
        applied.push('systemDefinition.structure.rafterSpacing');
        log.push(`[merge] rafterSpacing overlaid: ${overrides.rafterSpacingIn}"`);
      } else {
        skipped.push('rafterSpacing (not in survey)');
      }

      // Roof type
      if (
        overrides.roofType !== undefined &&
        overrides.roofType !== null
      ) {
        if (updatedDef) {
          updatedDef = {
            ...updatedDef,
            structure: {
              ...updatedDef.structure,
              roofType: overrides.roofType,
            },
          };
        }
        defChanged = true;
        applied.push('systemDefinition.structure.roofType');
        log.push(`[merge] roofType overlaid: ${overrides.roofType}`);
      } else {
        skipped.push('roofType (not in survey)');
      }

      if (defChanged && updatedDef) {
        model = { ...model, systemDefinition: updatedDef };
      }
    }

    // ── Append survey warnings (never replace base warnings) ─────────────────
    if (surveyInputs.warnings && surveyInputs.warnings.length > 0) {
      model = {
        ...model,
        warnings: [
          ...model.warnings,
          ...surveyInputs.warnings.map(w => `[survey] ${w}`),
        ],
      };
      log.push(`[merge] Appended ${surveyInputs.warnings.length} survey warning(s)`);
    }

    // ── Attach _surveyMeta audit field ───────────────────────────────────────
    // Uses index signature (CADModel allows [key: string]: any via spread)
    (model as any)._surveyMeta = {
      applied,
      skipped,
      mergedAt: new Date().toISOString(),
    };

    log.push(`[merge] Complete: applied=${applied.length} skipped=${skipped.length}`);

    return { model, mergeLog: log, applied, skipped };

  } catch (err) {
    // Safety net — ANY unexpected error returns baseCAD unchanged
    const msg = `[merge] ERROR (non-fatal, returning baseCAD unchanged): ${(err as Error).message}`;
    log.push(msg);
    console.warn('[CAD MERGE]', msg);
    return { model: baseCAD, mergeLog: log, applied, skipped };
  }
}