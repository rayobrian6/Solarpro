// ══════════════════════════════════════════════════════════════════════════════
// Fix Engine — Phase 13.7
// lib/system/fixEngine.ts
//
// Implements applyFeasibleFix(): the feasibility-driven replacement for the
// old "autoStringConfig" heuristic inside handleAutoFixAll.
//
// CONTRACT
// ────────
// • Calls generateFeasibleSystems() internally for the brand's full model set.
// • CASE A — at least one model passes feasibility:
//     Returns success=true with an appliedConfig describing the optimal
//     string layout (inverter model + count + strings) that is electrically
//     valid.
// • CASE B — nothing passes:
//     Returns success=false with a human-readable reason string. The UI must
//     show a "no valid configuration" state instead of silently applying a
//     bad config.
//
// PURITY GUARANTEES
// ─────────────────
// • applyFeasibleFix() is a pure function. It produces a new config object
//   and never directly mutates any React state.
// • The caller (handleAutoFixAll) is responsible for calling updateConfig()
//   with the returned appliedConfig.
// • The caller is responsible for resetting userHasEditedInverters after a
//   successful fix.
//
// NON-GOALS
// ─────────
// • Does NOT handle structural, wire-gauge, or rapid-shutdown fixes.
//   Those remain in handleAutoFixAll as before.
// • Does NOT affect micro topologies (returns success=false with
//   reason='micro-topology').
// • Does NOT mutate FeasibilityReport or SizingInput.
// ══════════════════════════════════════════════════════════════════════════════

import {
  generateFeasibleSystems,
  type FeasibleSystemsResult,
  type CandidateEvaluation,
  type PanelElectricalSpecs,
  type FeasibilityStringPlan,
} from './feasibilityEvaluator';
import { STRING_INVERTERS } from '../equipment-db';
import {
  getBrandProfile,
  getBrandProfileByInverterId,
} from './brandProfiles';
import type { BrandProfile, BrandInverterModelRef } from './brandProfiles/types';

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * Minimal description of the string layout produced by the fix engine.
 * The UI translates this into InverterConfig[] before calling updateConfig().
 */
export interface FixStringPlan {
  /** Zero-based string index (global, across all inverters). */
  index: number;
  /** Panel count on this string. */
  panelCount: number;
  /** Which physical inverter unit (0-based) owns this string. */
  inverterIndex: number;
  /** MPPT channel (0-based) within the physical unit. */
  mpptIndex: number;
}

/**
 * The resolved inverter model to apply, with quantity.
 */
export interface FixInverterModel {
  /** Equipment-db id (e.g. 'se-10000h'). */
  equipmentDbId: string;
  /** Number of physical units. */
  qty: number;
  /** AC output kW per unit. */
  acKw: number;
  /** DC/AC ratio for this configuration. */
  dcAcRatio: number;
}

/**
 * A complete valid configuration the Fix Engine has selected.
 * UI uses this to rebuild InverterConfig[].
 */
export interface FixAppliedConfig {
  /** The selected inverter model. */
  inverterModel: FixInverterModel;
  /** Per-string layout plan. */
  strings: FixStringPlan[];
  /** Total panel count (sanity check — must equal sum of string.panelCount). */
  totalPanels: number;
}

/**
 * Result of a single applyFeasibleFix() call.
 */
export interface FixResult {
  /** True iff a valid configuration was found and returned. */
  success: boolean;
  /**
   * CASE A: present when success=true.
   * The UI should apply this configuration via updateConfig().
   */
  appliedConfig?: FixAppliedConfig;
  /**
   * The recommended candidate evaluation (same as appliedConfig's source).
   * Included for logging and potential display.
   */
  recommended?: CandidateEvaluation;
  /**
   * Up to 2 alternative candidates that also passed feasibility.
   * Not applied automatically — UI may offer them as choices.
   */
  alternatives?: CandidateEvaluation[];
  /**
   * CASE B: present when success=false.
   * Human-readable explanation of why no valid configuration was found.
   */
  reason?: string;
  /**
   * Detailed failure codes from rejected models (CASE B only).
   * Each entry: { equipmentDbId, failures[{ code, message }] }
   */
  rejectedDetails?: FeasibleSystemsResult['rejected'];
}

// ─── Input params ──────────────────────────────────────────────────────────

export interface FixEngineParams {
  /** Total panel count. */
  totalPanels: number;
  /** Panel short-circuit current (A). Required. */
  panelIsc: number;
  /** Panel Voc temperature coefficient (%/°C, negative). Required. */
  panelTempCoeffVoc: number;
  /** Panel Voc at STC (V). Default: 41.6. */
  panelVoc?: number;
  /** Panel Vmp at STC (V). Default: 34.5. */
  panelVmp?: number;
  /** Panel wattage at STC (W). Default: 400. */
  panelWattage?: number;
  /** Design minimum ambient temperature (°C). Default: -10. */
  designTempMin?: number;
  /**
   * v47.411 — Optimizer regulated output cap (A). Used only for optimizer
   * topology brands. Forwarded into generateFeasibleSystems so the fix
   * candidate evaluation uses NEC 690.8(A)(2) instead of panel Isc x 1.25.
   */
  optimizerMaxOutputCurrent?: number;
  /**
   * User-selected brand id (slug). One of selectedBrand or
   * selectedInverterId must be supplied.
   */
  selectedBrand?: string;
  /**
   * Current inverter equipment-db id (used to infer brand when
   * selectedBrand is not provided).
   */
  selectedInverterId?: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Resolve a BrandProfile from brand id or inverter id.
 * Returns null if neither resolves.
 */
function resolveBrandProfile(params: FixEngineParams): BrandProfile | null {
  if (params.selectedBrand) {
    const p = getBrandProfile(params.selectedBrand);
    if (p) return p;
  }
  if (params.selectedInverterId) {
    const p = getBrandProfileByInverterId(params.selectedInverterId);
    if (p) return p;
  }
  return null;
}

/**
 * Build the equipment-db spec map for a brand's supported inverter models.
 * Only entries present in STRING_INVERTERS are included.
 */
function buildEquipmentSpecMap(
  models: readonly BrandInverterModelRef[],
): Map<string, (typeof STRING_INVERTERS)[number]> {
  const map = new Map<string, (typeof STRING_INVERTERS)[number]>();
  for (const ref of models) {
    const eq = STRING_INVERTERS.find(x => x.id === ref.equipmentDbId);
    if (eq) map.set(ref.equipmentDbId, eq);
  }
  return map;
}

/**
 * Translate the feasibility evaluator's string plans into FixStringPlan[].
 * The evaluator returns one flat list of FeasibilityStringPlan[] for a
 * single physical inverter unit. When inverterCount > 1, we replicate the
 * single-unit plan across all units (each unit handles its own share of
 * strings evenly).
 */
function buildStringPlans(
  candidate: CandidateEvaluation,
): FixStringPlan[] {
  const { stringConfigs } = candidate.result;
  const { inverterCount } = candidate.result;

  if (inverterCount <= 0 || stringConfigs.length === 0) return [];

  // The evaluator already accounts for inverterCount — stringConfigs covers
  // ALL strings across ALL units. We just need to assign inverterIndex and
  // mpptIndex correctly.
  //
  // Strategy: strings are distributed round-robin across units. Within a
  // unit they fill MPPT channels 0, 1, 2, … (wrapping if needed for
  // parallel strings, but the evaluator already validated the layout).
  const mpptCount = candidate.modelRef.mpptCount;
  const plans: FixStringPlan[] = [];

  for (const sc of stringConfigs) {
    const globalIdx = sc.index;
    // Which physical inverter unit does this string belong to?
    const stringsPerUnit = Math.ceil(stringConfigs.length / inverterCount);
    const invIdx = Math.floor(globalIdx / stringsPerUnit);
    // Which MPPT channel within this unit?
    const localIdx = globalIdx % stringsPerUnit;
    const mpptIdx = mpptCount > 1 ? localIdx % mpptCount : 0;

    plans.push({
      index: globalIdx,
      panelCount: sc.panelCount,
      inverterIndex: Math.min(invIdx, inverterCount - 1),
      mpptIndex: mpptIdx,
    });
  }

  return plans;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Attempt to find and return a feasibility-valid string configuration for
 * the given brand and panel combination.
 *
 * @returns FixResult with success=true and appliedConfig when a valid system
 *          exists, or success=false with a reason when nothing passes.
 */
export function applyFeasibleFix(params: FixEngineParams): FixResult {
  console.log('🛠️ [FIX ENGINE] invoked', {
    totalPanels: params.totalPanels,
    panelIsc: params.panelIsc,
    panelTempCoeffVoc: params.panelTempCoeffVoc,
    selectedBrand: params.selectedBrand,
    selectedInverterId: params.selectedInverterId,
  });

  // ── Guard: must have panel electrical specs ────────────────────────────
  if (params.panelIsc == null || params.panelTempCoeffVoc == null) {
    console.warn('🛠️ [FIX ENGINE] missing panelIsc or panelTempCoeffVoc — cannot run feasibility');
    return {
      success: false,
      reason:
        'Panel electrical specs (Isc, Voc temperature coefficient) are required ' +
        'to evaluate string feasibility. Please select a panel with full ' +
        'electrical data.',
    };
  }

  if (!Number.isFinite(params.totalPanels) || params.totalPanels <= 0) {
    console.warn('🛠️ [FIX ENGINE] totalPanels is invalid:', params.totalPanels);
    return { success: false, reason: 'Panel count must be a positive integer.' };
  }

  // ── Resolve brand profile ──────────────────────────────────────────────
  const brand = resolveBrandProfile(params);
  if (!brand) {
    console.warn('🛠️ [FIX ENGINE] could not resolve brand profile', params);
    return {
      success: false,
      reason:
        'Could not identify an inverter brand profile for the current system. ' +
        'Please select a brand explicitly.',
    };
  }

  // ── Skip micro topologies ──────────────────────────────────────────────
  if (brand.topology === 'micro') {
    console.log('🛠️ [FIX ENGINE] micro topology — not applicable');
    return {
      success: false,
      reason: 'micro-topology',
    };
  }

  // ── Build equipment spec map ───────────────────────────────────────────
  const equipmentSpecs = buildEquipmentSpecMap(brand.supportedInverterModels);
  if (equipmentSpecs.size === 0) {
    console.warn('🛠️ [FIX ENGINE] no equipment-db entries for brand:', brand.id);
    return {
      success: false,
      reason:
        `No equipment-db entries found for brand "${brand.displayName}". ` +
        'The fix engine cannot evaluate candidates without electrical specs.',
    };
  }

  // ── Build panel specs ──────────────────────────────────────────────────
  const panel: PanelElectricalSpecs = {
    voc:          params.panelVoc          ?? 41.6,
    vmp:          params.panelVmp          ?? 34.5,
    isc:          params.panelIsc,
    watts:        params.panelWattage      ?? 400,
    tempCoeffVoc: params.panelTempCoeffVoc,
  };

  // ── Run feasibility engine ─────────────────────────────────────────────
  // v47.411 — forward topology + optimizer cap so fix candidates are evaluated
  // with the correct NEC design-current method (panel vs. optimizer).
  const feasibleSystems = generateFeasibleSystems({
    modelRefs:      brand.supportedInverterModels,
    equipmentSpecs,
    panel,
    totalPanels:    params.totalPanels,
    designTempMin:  params.designTempMin,
    topology:       brand.topology === 'optimizer' ? 'optimizer'
                  : brand.topology === 'hybrid'    ? 'hybrid'
                  : 'string',
    optimizerMaxOutputCurrent: params.optimizerMaxOutputCurrent,
  });

  console.log('🛠️ [FIX ENGINE] feasibility result:', {
    valid:       feasibleSystems.valid,
    recommended: feasibleSystems.recommended?.modelRef.equipmentDbId ?? null,
    alternatives: feasibleSystems.alternatives.map(a => a.modelRef.equipmentDbId),
    rejected:    feasibleSystems.rejected.map(r => r.equipmentDbId),
  });

  // ── CASE B: nothing feasible ───────────────────────────────────────────
  if (!feasibleSystems.valid || !feasibleSystems.recommended) {
    const rejectedSummary = feasibleSystems.rejected
      .map(r => {
        const codes = r.failures.map(f => f.code).join(', ');
        return `${r.equipmentDbId}: ${codes}`;
      })
      .join('; ');

    const reason =
      `No valid string configuration found for ${params.totalPanels} panels ` +
      `on brand "${brand.displayName}". ` +
      (rejectedSummary
        ? `Rejected models — ${rejectedSummary}.`
        : 'All models were rejected by the feasibility evaluator.');

    console.warn('🛠️ [FIX ENGINE] CASE B — no valid system:', reason);

    return {
      success: false,
      reason,
      rejectedDetails: feasibleSystems.rejected,
    };
  }

  // ── CASE A: apply recommended candidate ───────────────────────────────
  const recommended = feasibleSystems.recommended;

  const appliedConfig: FixAppliedConfig = {
    inverterModel: {
      equipmentDbId: recommended.modelRef.equipmentDbId,
      qty:           recommended.result.inverterCount,
      acKw:          recommended.modelRef.acKw,
      dcAcRatio:     recommended.result.dcAcRatio,
    },
    strings:     buildStringPlans(recommended),
    totalPanels: params.totalPanels,
  };

  console.log('🛠️ [FIX ENGINE] CASE A — success:', {
    equipmentDbId: appliedConfig.inverterModel.equipmentDbId,
    qty:           appliedConfig.inverterModel.qty,
    strings:       appliedConfig.strings.length,
    dcAcRatio:     appliedConfig.inverterModel.dcAcRatio.toFixed(3),
    score:         recommended.score.toFixed(1),
  });

  return {
    success:      true,
    appliedConfig,
    recommended,
    alternatives: feasibleSystems.alternatives,
  };
}