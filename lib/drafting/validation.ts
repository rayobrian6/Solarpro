// ============================================================
// SolarPro Drafting Engine — Plan Set Validation
// lib/drafting/validation.ts
//
// validatePlanSet(cad, systemType) — STEP 10
//
// Runs BEFORE any sheet renders. Throws ValidationError with
// a clear message listing ALL failures (not just the first).
//
// FENCE: segments required, each must have length + panelCount
// GROUND: arrays required, each must have rows + dimensions
// ROOF:   planes required, each must have panels + polygon
//
// CROSS-CONTAMINATION CHECKS (STEP 9):
//   - fence input must NOT contain roof/ground fields
//   - roof input must NOT contain post/fence fields
//   - ground input must NOT contain roof plane fields
// ============================================================

import type { CADModel } from '../cad/types';
import type { RenderContext } from './renderContext';

export type SystemType = 'roof' | 'ground_mount' | 'solar_fence';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  systemType: SystemType;
}

export class PlanSetValidationError extends Error {
  public readonly result: ValidationResult;
  constructor(result: ValidationResult) {
    super(
      `[validatePlanSet] ${result.systemType} validation failed:\n` +
      result.errors.map(e => '  ✗ ' + e).join('\n')
    );
    this.name = 'PlanSetValidationError';
    this.result = result;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function validatePlanSet(
  cad: CADModel,
  systemType: SystemType,
): ValidationResult {
  const errors: string[]   = [];
  const warnings: string[] = [];

  // ── 1. CAD model must be present ──
  if (!cad) {
    errors.push('CAD model is null/undefined — cannot render without a solved CAD model');
    return buildResult(false, errors, warnings, systemType);
  }

  // ── 2. System type must match ──
  if (!cad.systemType) {
    errors.push('cad.systemType is missing — every model must declare its system type');
  } else if (cad.systemType !== systemType) {
    errors.push(
      `cad.systemType="${cad.systemType}" does not match requested systemType="${systemType}" ` +
      `— render aborted to prevent cross-system contamination`
    );
  }

  // ── 3. Must have panels ──
  if (!cad.totalPanels || cad.totalPanels < 1) {
    errors.push(`cad.totalPanels=${cad.totalPanels} — must be ≥ 1`);
  }
  if (!cad.totalDcKw || cad.totalDcKw <= 0) {
    warnings.push(`cad.totalDcKw=${cad.totalDcKw} — expected positive value`);
  }

  // ── 4. System-specific validation ──
  // HYBRID (multi-system, Phase 1): a composed model INTENTIONALLY carries
  // every present section (each built scoped by its own solver — cadEngine
  // hybrid path). The cross-contamination rule below exists to catch STALE
  // residue from single-system re-runs; for a declared hybrid the extra
  // sections are real, so the contamination check is skipped (the per-section
  // validators still run for the primary type).
  const _isHybrid = !!(cad as { hybrid?: unknown }).hybrid;
  switch (systemType) {
    case 'solar_fence':
      validateFence(cad, errors, warnings);
      // Cross-contamination: fence must NOT have roof or ground data
      if (!_isHybrid && cad.roof) {
        errors.push('CROSS-CONTAMINATION: solar_fence model contains cad.roof — forbidden');
      }
      if (!_isHybrid && cad.ground) {
        errors.push('CROSS-CONTAMINATION: solar_fence model contains cad.ground — forbidden');
      }
      break;

    case 'ground_mount':
      validateGround(cad, errors, warnings);
      // Cross-contamination: ground must NOT have roof or fence data
      if (!_isHybrid && cad.roof) {
        errors.push('CROSS-CONTAMINATION: ground_mount model contains cad.roof — forbidden');
      }
      if (!_isHybrid && cad.fence) {
        errors.push('CROSS-CONTAMINATION: ground_mount model contains cad.fence — forbidden');
      }
      break;

    case 'roof':
      validateRoof(cad, errors, warnings);
      // Cross-contamination: roof must NOT have ground or fence data
      if (!_isHybrid && cad.ground) {
        errors.push('CROSS-CONTAMINATION: roof model contains cad.ground — forbidden');
      }
      if (!_isHybrid && cad.fence) {
        errors.push('CROSS-CONTAMINATION: roof model contains cad.fence — forbidden');
      }
      break;

    default:
      errors.push(`Unknown systemType: "${systemType}" — must be roof | ground_mount | solar_fence`);
  }

  const valid = errors.length === 0;
  return buildResult(valid, errors, warnings, systemType);
}

/**
 * Throws PlanSetValidationError if validation fails.
 * Use this before every sheet render.
 */
export function assertValidPlanSet(
  cad: CADModel,
  systemType: SystemType,
): void {
  const result = validatePlanSet(cad, systemType);
  if (!result.valid) {
    throw new PlanSetValidationError(result);
  }
  // Log warnings even on success
  if (result.warnings.length > 0) {
    console.warn('[validatePlanSet] warnings:', result.warnings);
  }
}

// ── System validators ─────────────────────────────────────────────────────────

function validateFence(
  cad: CADModel,
  errors: string[],
  warnings: string[],
): void {
  if (!cad.fence) {
    errors.push('cad.fence is missing — solar_fence system requires cad.fence model');
    return;
  }
  const fence = cad.fence;

  // Segments
  if (!fence.segments || fence.segments.length === 0) {
    errors.push('cad.fence.segments is empty — at least one segment required');
  } else {
    fence.segments.forEach((seg, i) => {
      const label = `segment[${i}] id="${seg.id}"`;
      if (!seg.id) {
        errors.push(`${label}: missing id`);
      }
      if (!isFinite(seg.lengthM) || seg.lengthM <= 0) {
        errors.push(`${label}: lengthM=${seg.lengthM} — must be > 0`);
      }
      if (!isFinite(seg.panelCount) || seg.panelCount < 1) {
        errors.push(`${label}: panelCount=${seg.panelCount} — must be ≥ 1`);
      }
      if (!isFinite(seg.startX) || !isFinite(seg.startY)) {
        errors.push(`${label}: startX/Y has non-finite coordinates`);
      }
      if (!isFinite(seg.endX) || !isFinite(seg.endY)) {
        errors.push(`${label}: endX/Y has non-finite coordinates`);
      }
    });
  }

  // Fence geometry
  if (!isFinite(fence.totalLengthM) || fence.totalLengthM <= 0) {
    errors.push(`cad.fence.totalLengthM=${fence.totalLengthM} — must be > 0`);
  }
  if (!isFinite(fence.postSpacingM) || fence.postSpacingM <= 0) {
    errors.push(`cad.fence.postSpacingM=${fence.postSpacingM} — must be > 0`);
  }
  if (!isFinite(fence.postEmbedM) || fence.postEmbedM <= 0) {
    errors.push(`cad.fence.postEmbedM=${fence.postEmbedM} — must be > 0`);
  }
  if (!isFinite(fence.panelHeightM) || fence.panelHeightM <= 0) {
    errors.push(`cad.fence.panelHeightM=${fence.panelHeightM} — must be > 0`);
  }
  if (!isFinite(fence.railCount) || fence.railCount < 1) {
    errors.push(`cad.fence.railCount=${fence.railCount} — must be ≥ 1`);
  }

  // Warnings
  if (fence.totalLengthM > 1000) {
    warnings.push(`cad.fence.totalLengthM=${fence.totalLengthM.toFixed(1)}m seems very large (>1000m)`);
  }
}

function validateGround(
  cad: CADModel,
  errors: string[],
  warnings: string[],
): void {
  if (!cad.ground) {
    errors.push('cad.ground is missing — ground_mount system requires cad.ground model');
    return;
  }
  const ground = cad.ground;

  // Arrays
  if (!ground.arrays || ground.arrays.length === 0) {
    errors.push('cad.ground.arrays is empty — at least one array required');
  } else {
    ground.arrays.forEach((arr, i) => {
      const label = `array[${i}] id="${arr.id}"`;
      if (!arr.id) {
        errors.push(`${label}: missing id`);
      }
      if (!arr.rows || arr.rows.length === 0) {
        errors.push(`${label}: rows is empty — at least one row required`);
      } else {
        arr.rows.forEach((row, ri) => {
          const rowPanelCount = row.panels?.length ?? 0;
          if (rowPanelCount < 1) {
            errors.push(`${label} row[${ri}]: panels.length=${rowPanelCount} — must have ≥ 1 panel`);
          }
        });
      }
      if (!arr.dimensions) {
        errors.push(`${label}: dimensions missing`);
      } else {
        if (!isFinite(arr.dimensions.rowCount) || arr.dimensions.rowCount < 1) {
          errors.push(`${label}: dimensions.rowCount=${arr.dimensions.rowCount} — must be ≥ 1`);
        }
        if (!isFinite(arr.dimensions.panelsPerRow) || arr.dimensions.panelsPerRow < 1) {
          errors.push(`${label}: dimensions.panelsPerRow=${arr.dimensions.panelsPerRow} — must be ≥ 1`);
        }
      }
      if (!isFinite(arr.tiltDeg) || arr.tiltDeg < 0 || arr.tiltDeg > 90) {
        errors.push(`${label}: tiltDeg=${arr.tiltDeg} — must be 0–90°`);
      }
      if (!isFinite(arr.pileDepthM) || arr.pileDepthM <= 0) {
        errors.push(`${label}: pileDepthM=${arr.pileDepthM} — must be > 0`);
      }
    });
  }
}

function validateRoof(
  cad: CADModel,
  errors: string[],
  warnings: string[],
): void {
  if (!cad.roof) {
    errors.push('cad.roof is missing — roof system requires cad.roof model');
    return;
  }
  const roof = cad.roof;

  // Planes
  if (!roof.planes || roof.planes.length === 0) {
    errors.push('cad.roof.planes is empty — at least one roof plane required');
  } else {
    roof.planes.forEach((plane, i) => {
      const label = `plane[${i}] id="${plane.id}"`;
      if (!plane.id) {
        errors.push(`${label}: missing id`);
      }
      if (!plane.polygon || plane.polygon.length < 3) {
        errors.push(`${label}: polygon must have ≥ 3 vertices`);
      } else {
        const badPts = plane.polygon.filter(pt => !isFinite(pt.x) || !isFinite(pt.y));
        if (badPts.length > 0) {
          errors.push(`${label}: ${badPts.length} polygon vertices have non-finite coordinates`);
        }
      }
      if ((!plane.panels || plane.panels.length === 0) && !plane.designedEmpty) {
        // designedEmpty: the user's stitched roofline includes facets with no
        // modules — they render outline-only and are valid by design.
        errors.push(`${label}: panels is empty — cannot render a plane with no panels`);
      }
      if (!isFinite(plane.pitch) || plane.pitch < 0 || plane.pitch > 90) {
        errors.push(`${label}: pitch=${plane.pitch} — must be 0–90°`);
      }
    });
  }
}

// ── STEP 6: RenderContext validation ─────────────────────────────────────────

export interface RenderValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * validateRenderContext(ctx)
 *
 * Validates the unified RenderContext before any sheet renders.
 * Checks:
 *   1. systemType ↔ CAD model consistency
 *   2. BillInsights rate conflict (billDerivedRate vs engineering.electricityRate)
 *   3. Combined utility detected but no electric subtotal (rendering gap)
 *   4. Rate source consistency — warns if source disagrees with billInsights
 *   5. Engineering data completeness warnings
 *
 * Never throws — returns errors/warnings for caller to act on.
 * Non-destructive: ctx is read-only.
 */
export function validateRenderContext(ctx: RenderContext): RenderValidationResult {
  const errors: string[]   = [];
  const warnings: string[] = [];

  // ── 1. systemType ↔ CAD model ──────────────────────────────────────────────
  if (!ctx.cad) {
    errors.push('RenderContext.cad is null — cannot render without a solved CAD model');
  } else {
    if (ctx.cad.systemType && ctx.cad.systemType !== ctx.systemType) {
      errors.push(
        `RenderContext systemType="${ctx.systemType}" does not match ` +
        `cad.systemType="${ctx.cad.systemType}" — cross-system render aborted`
      );
    }
    if (!ctx.cad.totalPanels || ctx.cad.totalPanels < 1) {
      errors.push(`cad.totalPanels=${ctx.cad.totalPanels} — must be ≥ 1`);
    }
  }

  // ── 2. BillInsights rate conflict check ────────────────────────────────────
  if (ctx.billInsights && ctx.engineering) {
    const billRate  = ctx.billInsights.billDerivedRate;
    const engRate   = ctx.engineering.electricityRate;

    if (
      billRate  != null && billRate  > 0 &&
      engRate   != null && engRate   > 0
    ) {
      const delta = Math.abs(billRate - engRate) / engRate;
      if (delta > 0.20) {
        // > 20% divergence → warning (not error — engineer may have overridden)
        warnings.push(
          `Rate conflict: bill-derived rate $${billRate.toFixed(4)}/kWh vs ` +
          `engineering rate $${engRate.toFixed(4)}/kWh ` +
          `(${(delta * 100).toFixed(1)}% divergence) — ` +
          `verify rate source is "${ctx.engineering.rateSource}"`
        );
      }
      if (delta > 0.50) {
        // > 50% divergence → error — likely wrong rate entered
        errors.push(
          `RATE CONFLICT: bill-derived $${billRate.toFixed(4)}/kWh vs ` +
          `engineering $${engRate.toFixed(4)}/kWh (${(delta * 100).toFixed(1)}% divergence) — ` +
          `exceeds 50% threshold; check PermitInput.utility.electricityRate`
        );
      }
    }

    // ── 3. Combined utility with no electric subtotal ──────────────────────
    if (
      ctx.billInsights.combinedUtilityDetected &&
      (ctx.billInsights.electricSubtotal == null || ctx.billInsights.electricSubtotal <= 0)
    ) {
      warnings.push(
        'Combined utility detected (gas+electric) but electricSubtotal is missing — ' +
        'bill-derived rate may be overstated; manual rate entry recommended'
      );
    }

    // ── 4. Override recommended but not applied ────────────────────────────
    if (
      ctx.billInsights.overrideRecommended &&
      ctx.engineering.rateSource !== 'manual'
    ) {
      warnings.push(
        `Bill Intelligence recommends rate override (confidence: ${ctx.billInsights.confidence}) ` +
        `but rateSource="${ctx.engineering.rateSource}" — ` +
        `consider setting PermitInput.utility.rateSource="manual"`
      );
    }
  }

  // ── 5. Engineering data completeness ──────────────────────────────────────
  if (ctx.engineering) {
    if (!ctx.engineering.electricityRate || ctx.engineering.electricityRate <= 0) {
      warnings.push(
        `engineering.electricityRate=${ctx.engineering.electricityRate} — ` +
        'expected positive value for savings calculations'
      );
    }
    if (!ctx.engineering.monthlyKwh || ctx.engineering.monthlyKwh <= 0) {
      warnings.push(
        `engineering.monthlyKwh=${ctx.engineering.monthlyKwh} — ` +
        'missing monthly usage; savings estimates will be approximate'
      );
    }
    if (!ctx.engineering.utilityName) {
      warnings.push('engineering.utilityName is empty — utility name will not appear on plan set');
    }
  }

  const valid = errors.length === 0;
  return { valid, errors, warnings };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildResult(
  valid: boolean,
  errors: string[],
  warnings: string[],
  systemType: SystemType,
): ValidationResult {
  return { valid, errors, warnings, systemType };
}