// ════════════════════════════════════════════════════════════════════
// Brand-Driven System Sizing Engine
// lib/system/sizingEngine.ts
//
// The single entry point for deriving equipment requirements from
// brand + system + panel count + battery intent.
//
// PHASES covered:
//   2. Sizing engine orchestration (sizeSystemFromBrand)
//   3. Topology resolution (brand → topology)
//   4. Inverter auto-sizing (DC kW → inverter model + count)
//   5. String/micro/optimizer/hybrid strand logic
//   6. Battery intent gating (user-driven only)
//   7. Battery sizing (modular stack for EcoFlow etc.)
//   8. Required BOS component families
//
// CONTRACT:
//   Input:  { systemDefinition, cadModel, selectedBrand, batteryEnabled, batteryMode, batteryGoal, batteryTargetKwh }
//   Output: SystemSizingResult { topology, inverterCount, inverterModels, strings, battery, requiredComponents, warnings }
//
// HARD RULES:
//   - BOM must not invent equipment — consume this output.
//   - UI must not duplicate sizing — consume this output.
//   - User selections are respected. Defaults apply only when no selection.
//   - Battery is NEVER assumed. Must be explicitly enabled.
// ════════════════════════════════════════════════════════════════════

import type { SystemType } from './systemDefinition';
import type {
  BrandProfile,
  BrandInverterModelRef,
  TopologyFamily,
  InverterSizingTier,
} from './brandProfiles';
import {
  getBrandProfile,
  getBrandProfileByInverterId,
  getRecommendedBrandForSystem,
  GENERIC_STRING_PROFILE,
} from './brandProfiles';
// Phase 8 — CORE ENGINEERING BRAIN: new layout solver
import {
  generateLayoutCandidates,
} from './layoutCandidateGenerator';
import {
  selectBestLayoutCandidate,
} from './layoutScoring';
import {
  getCapabilityProfilesForBrand,
} from './brandCapabilities';
import type { LayoutCandidate, LayoutGeneratorInput } from './inverterCapabilities';
import {
  generateFeasibleSystems,
  type FeasibilityFailure,
  type FeasibilityResult,
  type PanelElectricalSpecs,
} from './feasibilityEvaluator';
import { STRING_INVERTERS, SOLAR_PANELS } from '../equipment-db';
import type { StringInverter, SolarPanel } from '../equipment-db';
import {
  evaluatePanelBrandCompatibility,
  type PanelCompatibilityGateResult,
  type PanelBrandStatus,
  type PanelBrandSuggestion,
} from './panelCompatibilityGate';

// ─── Input types ───────────────────────────────────────────────────

export type BatteryMode = 'auto' | 'manual';
export type BatteryGoal = 'backup' | 'self_consumption' | 'max_energy';

/**
 * Input to the sizing engine. All fields are optional except systemType +
 * panelCount — the engine applies safe defaults when omitted.
 */
export interface SizingInput {
  /** System type from SystemDefinition (roof/ground/fence). */
  systemType: SystemType;

  /** Total panel count from CADModel or layout. */
  panelCount: number;

  /** Panel nominal wattage (STC). Default: 400W. */
  panelWattage?: number;

  /** Panel Voc for string sizing. Default: 41.6. */
  panelVoc?: number;

  /** Panel Vmp for string sizing. Default: 34.5. */
  panelVmp?: number;

  /** Panel Isc (short-circuit current, A at STC). Default: 11.2 A. */
  panelIsc?: number;

  /** Panel Voc temperature coefficient (%/°C, typically negative). Default: -0.27 %/°C. */
  panelTempCoeffVoc?: number;

  /** Design minimum ambient temperature (°C). Default: -10 °C. */
  designTempMin?: number;

  /**
   * v47.411 — Optimizer regulated output cap (A). Used only for optimizer
   * topology brands (SolarEdge + SolarEdge/Tigo). Overrides the default 15.0A
   * when the selected optimizer SKU has a different nameplate max output.
   * Forwarded into feasibilityEvaluator so candidate selection uses the
   * regulated output (NEC 690.8(A)(2)) instead of panel Isc x 1.25.
   */
  optimizerMaxOutputCurrent?: number;

  /**
   * User-selected brand id. Preferred. If omitted, the engine
   * uses the recommended brand for the system type.
   */
  selectedBrand?: string;

  /**
   * User-selected inverter id (equipment-db). If provided, the engine
   * infers the brand from this id and honors the user's model choice.
   */
  selectedInverterId?: string;

  /**
   * v47.423 — Equipment-db id of the currently-loaded solar panel.
   * When provided, the engine runs the Panel Compatibility Gate before
   * inverter sizing. If the panel is incompatible with the brand's
   * per-MPPT current cap, the engine auto-switches to the best
   * compatible panel (updating panelWattage/Voc/Vmp/Isc/tempCoeffVoc
   * for all downstream steps) and surfaces a PANEL_AUTO_SWITCHED info
   * warning. Marginal pairings surface PANEL_MARGINAL warnings.
   *
   * Backwards compatible: when omitted, the gate is skipped entirely
   * and the engine behaves as it did pre-v47.423.
   */
  panelId?: string;

  /** Explicit battery enable flag (user-driven). Default: false. */
  batteryEnabled?: boolean;

  /** Battery mode: 'auto' sizes from DC kW, 'manual' uses batteryTargetKwh. */
  batteryMode?: BatteryMode;

  /** Battery design goal. Default: 'backup'. */
  batteryGoal?: BatteryGoal;

  /** Manual battery target kWh (if batteryMode === 'manual'). */
  batteryTargetKwh?: number;

  /** Selected battery brand id. Defaults to brand profile's recommended. */
  selectedBatteryBrand?: string;

  /** Pro-stack flag for EcoFlow (80 kWh vs 45 kWh std cap). */
  batteryUsePro?: boolean;
}

// ─── Output types ──────────────────────────────────────────────────

export interface SizedInverter {
  /** Equipment-db id. */
  equipmentDbId: string;
  /** Brand profile id (for traceability). */
  brandId: string;
  /** AC output kW per unit. */
  acKw: number;
  /** Max DC input kW per unit. */
  dcKwMax: number;
  /** MPPT channel count. */
  mpptCount: number;
  /** Total qty of this inverter model. */
  qty: number;
}

export interface SizedString {
  /** String index (0-based). */
  index: number;
  /** Panels on this string. */
  panelCount: number;
  /** MPPT channel assignment (0-based) within the physical inverter unit. */
  mpptIndex: number;
  /**
   * Which PHYSICAL inverter unit (0-based, flat across all models) this
   * string belongs to. Total range: 0 .. sum(model.qty) - 1.
   * The UI must group strings by THIS index to produce one card per
   * physical unit (fixing the bug where all strings went to card #1).
   */
  inverterIndex: number;
  /**
   * Which model entry in SystemSizingResult.inverterModels this physical
   * unit belongs to. Useful when a design uses multiple different
   * inverter models (rare today but supported).
   */
  modelIndex: number;
}

export interface SizedBattery {
  /** Brand id (matches a brand profile's recommendedBatteryBrands). */
  brandId: string;
  /** Equipment-db battery id (single module). */
  equipmentDbId?: string;
  /** Target total kWh (user-specified or auto-sized). */
  targetKwh: number;
  /** Total installed kWh (rounded to module size). */
  installedKwh: number;
  /** Module count. */
  moduleCount: number;
  /** Sizing strategy used. */
  strategy: 'modular_stack' | 'single_pack' | 'per_module' | 'custom';
  /** Whether the user requested a pro stack (EcoFlow 80 kWh). */
  proStack: boolean;
}

export interface SizedRequiredComponent {
  /** Canonical category. */
  category: string;
  /** Computed quantity. */
  qty: number;
  /** Optional equipment-db id. */
  equipmentDbId?: string;
  /** Source of the derivation. */
  qtyPolicy: string;
  /** Required vs. optional. */
  required: boolean;
  /** Human-readable note. */
  note?: string;
}

export interface SizingWarning {
  /** Warning severity. */
  severity: 'info' | 'warning' | 'error';
  /** Short code for programmatic handling. */
  code: string;
  /** Human-readable message. */
  message: string;
}

export interface SystemSizingResult {
  /** The brand profile used (after resolution). */
  brand: {
    id: string;
    displayName: string;
    manufacturer: string;
  };
  /** Canonical topology family. */
  topology: TopologyFamily;
  /** Total inverters across all models (sum of qty). */
  inverterCount: number;
  /** One entry per distinct inverter model used. */
  inverterModels: SizedInverter[];
  /** String layout (populated for string/optimizer/hybrid; empty for micro). */
  strings: SizedString[];
  /** Micro device count (populated for micro; 0 for others). */
  microDeviceCount: number;
  /** AC branch count (populated for micro). */
  acBranchCount: number;
  /** Battery sizing — null if batteryEnabled=false. */
  battery: SizedBattery | null;
  /** Required BOS components with computed quantities. */
  requiredComponents: SizedRequiredComponent[];
  /** Validation/advisory warnings. */
  warnings: SizingWarning[];
  /** The raw input (for traceability). */
  input: SizingInput;
  /**
   * Phase 13.6b — Feasibility report. Present when a string/optimizer/hybrid
   * topology has enough electrical data (Voc, Isc, temp coeff) to evaluate
   * every brand candidate. Absent for micro topologies or when panel
   * electrical specs are missing. Never modifies the primary sizing path;
   * purely advisory / diagnostic.
   */
  feasibility?: FeasibilityReport;

  /**
   * Phase 8 — Brain Rewrite: LayoutCandidate selected by the new layout solver.
   * Present when the solver found a valid candidate for the brand.
   * Null/absent when no candidate found (falls back to legacy sizeInverters path).
   *
   * Consumers: ValidationPanel (why this inverter), BOM (bos hints),
   * interconnection (string/branch layout), EngineeringTruth (audit).
   */
  selectedLayoutCandidate?: LayoutCandidate | null;

  /**
   * v47.423 — Panel↔brand compatibility verdict. Present when the caller
   * provides `input.panelId`. The UI uses this to render auto-swap banners
   * and marginal warnings. Brand-agnostic; works for every brand.
   */
  panelCompatibility?: {
    /** Final status AFTER any auto-swap. ('compatible' once swapped.) */
    status: PanelBrandStatus;
    /** True when the engine auto-switched panels inside this run. */
    autoSwitched: boolean;
    /** The ORIGINAL panel id the caller supplied (before any swap). */
    originalPanelId: string;
    /** The panel id actually used for sizing (original if no swap). */
    effectivePanelId: string;
    /** Panel headroom % at the original panel (for banner context). */
    headroomPct: number;
    /** Brand meta. */
    brand: {
      id: string;
      displayName: string;
      effectiveMaxInputCurrentPerMppt: number | null;
    };
    /** Ranked replacement suggestions (for the "Change panel →" action). */
    suggestions: PanelBrandSuggestion[];
    /** Human-readable reason suitable for a UI banner. */
    reason: string;
  };
}

/**
 * Summary of the feasibility evaluation across every model in the brand.
 * Consumers (UI, validation, BOM) may use this to:
 *   - Surface the recommended model next to the chosen one
 *   - Show why rejected models were rejected
 *   - Warn when the chosen model is infeasible
 */
export interface FeasibilityReport {
  /** Whether at least one model in the brand is feasible. */
  anyFeasible: boolean;
  /** Whether the chosen (sized) model itself is feasible. */
  chosenIsFeasible: boolean | null;
  /** Equipment-db id of the chosen model (for cross-reference). */
  chosenEquipmentDbId: string | null;
  /** Recommended model (highest score among feasible). */
  recommendedEquipmentDbId: string | null;
  /** Score of the recommended model (0-100). */
  recommendedScore: number | null;
  /** Up to 2 labelled alternatives. */
  alternatives: Array<{
    equipmentDbId: string;
    score: number;
    label: 'higher_production' | 'conservative';
    dcAcRatio: number;
    inverterCount: number;
  }>;
  /** Rejected models with failure reasons. */
  rejected: Array<{
    equipmentDbId: string;
    failures: FeasibilityFailure[];
  }>;
  /**
   * If present, the feasibility result for the chosen model, for
   * detailed display.
   */
  chosenResult?: FeasibilityResult;
}

// ─── Internal helpers ──────────────────────────────────────────────

function pickInverterTier(
  tiers: ReadonlyArray<InverterSizingTier>,
  totalDcKw: number,
): InverterSizingTier | undefined {
  return tiers.find(t => totalDcKw >= t.minDcKw && totalDcKw < t.maxDcKw);
}

function resolveBrand(
  input: SizingInput,
  warnings: SizingWarning[],
): BrandProfile {
  // Priority 1: explicit brand id
  const explicit = getBrandProfile(input.selectedBrand);
  if (explicit) return explicit;

  // Priority 2: infer from selected inverter id
  const inferred = getBrandProfileByInverterId(input.selectedInverterId);
  if (inferred) return inferred;

  // Priority 3: recommended for this system type
  const recommended = getRecommendedBrandForSystem(input.systemType);
  if (recommended) {
    warnings.push({
      severity: 'info',
      code: 'BRAND_RECOMMENDED_DEFAULT',
      message: `No brand selected — using recommended default: ${recommended.displayName} for ${input.systemType}.`,
    });
    return recommended;
  }

  // Priority 4: generic string fallback
  warnings.push({
    severity: 'info',
    code: 'BRAND_FALLBACK_GENERIC',
    message: `No brand or recommendation — falling back to generic string inverter.`,
  });
  return GENERIC_STRING_PROFILE;
}

function checkSystemTypeSupport(
  brand: BrandProfile,
  systemType: SystemType,
  warnings: SizingWarning[],
): void {
  if (!brand.supportedSystemTypes.includes(systemType)) {
    warnings.push({
      severity: 'error',
      code: 'BRAND_SYSTEM_UNSUPPORTED',
      message: `Brand ${brand.displayName} does not support ${systemType} systems.`,
    });
  }
}

// ─── Phase 13.2 — per-unit capacity helpers ────────────────────────
//
// The old formula `mpptCount × maxPanelsPerString` treated the per-unit
// panel ceiling as "panels per series string × MPPT inputs" and ignored
// the fact that real residential string/optimizer inverters accept
// MULTIPLE series strings in parallel per MPPT. Under that model a
// single SE-11400H (dcKwMax=17.1 kW, 1 MPPT, maxPPS=25) was capped at
// 25 panels — so a healthy 36-panel / 14.4 kW DC system was forced to
// 2 units (DC/AC 0.63, which then failed validation).
//
// Correct physical model (residential default):
//   maxPanelsPerUnit = mpptCount × parallelStringsPerMppt × maxPanelsPerString
// with parallelStringsPerMppt = model.maxParallelStringsPerMppt ?? 2.
//
// Notes:
//   - maxPanelsPerString is still enforced in the downstream string-layout
//     phase (it constrains series string LENGTH, not per-inverter total).
//   - Micro topology is untouched — it has no strings.
//   - DC capacity (dcKwMax) remains the primary constraint; this only
//     corrects the secondary string-capacity constraint.

/** Default residential parallel-strings-per-MPPT when not declared on the model. */
export const DEFAULT_PARALLEL_STRINGS_PER_MPPT = 2;

/**
 * Physical panel ceiling for ONE physical inverter unit.
 * Pure function — inputs are never mutated.
 */
function panelsPerUnit(model: BrandInverterModelRef): number {
  const mpps = model.maxPanelsPerString ?? 20;
  const parallel = model.maxParallelStringsPerMppt ?? DEFAULT_PARALLEL_STRINGS_PER_MPPT;
  const perUnit = model.mpptCount * parallel * mpps;
  return Math.max(1, perUnit);
}

/**
 * Phase 13.8 — Voltage-aware panels-per-unit ceiling.
 *
 * Same as panelsPerUnit() but clamps maxPanelsPerString to the
 * voltage-safe ceiling derived from the inverter's maxDcVoltage and
 * the panel's cold-temperature Voc. Used by sizeInverters() so that
 * unitsRequired() accounts for the real electrical capacity limit
 * (not just the brand profile's static string count).
 *
 * Falls back to panelsPerUnit() when electrical specs are absent.
 *
 * v47.430 — topology-aware bypass for optimizer (and other regulated-bus)
 * topologies. The NEC 690.7 cold-Voc clamp is INAPPLICABLE when each
 * panel has a dedicated optimizer that regulates its DC output to the
 * inverter's fixed bus voltage (HD-Wave ≈ 400 V DC). String Voc at the
 * inverter is bounded by the bus, not by sum(panel Voc). Without this
 * bypass, SolarEdge SE7600H was sized to 4 units for 72 panels (because
 * maxPPS got clamped from 25 → 10, forcing ceil(72 / (1×2×10)) = 4),
 * producing the user-reported "4 strings → 4 inverters, 1 string each"
 * regression. The feasibility evaluator and the downstream slot
 * allocator (voltageAwareMaxPPS in this file) already had this bypass;
 * this top-level helper had been missed.
 */
function voltageAwarePanelsPerUnit(
  model: BrandInverterModelRef,
  panelVoc: number,
  tempCoeffVoc: number,   // %/°C
  designTempMin: number,
  topology?: 'string' | 'optimizer' | 'hybrid' | 'micro',
): number {
  const brandMaxPPS = model.maxPanelsPerString ?? 20;
  const parallel    = model.maxParallelStringsPerMppt ?? DEFAULT_PARALLEL_STRINGS_PER_MPPT;

  // v47.430 — Optimizer topology: each panel has its own optimizer that
  // regulates string DC output to the inverter's fixed bus voltage, so
  // the NEC 690.7 cold-Voc clamp does not apply. The brand-profile
  // maxPanelsPerString is the authoritative ceiling (e.g. 25 for SolarEdge).
  if (topology === 'optimizer') {
    return Math.max(1, model.mpptCount * parallel * brandMaxPPS);
  }

  // Look up inverter maxDcVoltage from equipment-db.
  const eq = STRING_INVERTERS.find(x => x.id === model.equipmentDbId);
  if (!eq) return Math.max(1, model.mpptCount * parallel * brandMaxPPS);

  const coldFactor      = 1 + (tempCoeffVoc / 100) * (designTempMin - 25);
  const vocColdPerPanel = panelVoc * coldFactor;
  if (vocColdPerPanel <= 0) return Math.max(1, model.mpptCount * parallel * brandMaxPPS);

  const vocSafeCeiling = Math.floor((eq.maxDcVoltage * 0.99) / vocColdPerPanel);
  const effectiveMaxPPS = Math.min(brandMaxPPS, Math.max(1, vocSafeCeiling));
  return Math.max(1, model.mpptCount * parallel * effectiveMaxPPS);
}

/**
 * Compute the number of physical inverter units required for a given
 * model + (panels, totalDcKw). Takes the greater of DC-capacity and
 * panel-capacity constraints — both are independent physical limits.
 *
 * @param panelsPerUnitOverride  When supplied, used instead of panelsPerUnit(model).
 *   Pass a voltage-aware value (from voltageAwarePanelsPerUnit()) so that the
 *   unit count correctly reflects the real electrical string capacity.
 */
function unitsRequired(
  model: BrandInverterModelRef,
  panelCount: number,
  totalDcKw: number,
  panelsPerUnitOverride?: number,
): number {
  const byDc = Math.max(1, Math.ceil(totalDcKw / model.dcKwMax));
  const ppu  = panelsPerUnitOverride ?? panelsPerUnit(model);
  const byPanels = Math.max(1, Math.ceil(panelCount / ppu));
  return Math.max(byDc, byPanels);
}

/** Minimum DC/AC ratio enforced by the auto-sizing engine.
 * v58.0: raised from 0.9 to 1.00. AC output must not exceed DC array capacity
 * in any auto-selected configuration. Manual overrides allowed by UI but
 * validation engine surfaces a blocking error for review.
 * Preferred target range: 1.15-1.35 (industry best-practice).
 */
export const MIN_DC_AC_RATIO = 1.00;
// v58.1: Hard floor is 1.00 but engine TARGETS ~1.25 to minimize clipping.
// A ratio of exactly 1.0 = zero clipping headroom; inverter runs at 100%
// nameplate continuously at peak irradiance. Industry best-practice: 1.20-1.40.

/** Preferred DC/AC ratio target window (advisory, not hard-blocked). */
/** v58.1: widened to 1.20-1.40, target 1.25 for optimal clipping tradeoff. */
export const PREFERRED_DC_AC_RATIO_MIN = 1.20;
export const PREFERRED_DC_AC_RATIO_MAX = 1.40;
/** Ideal DC/AC target — engine aims to land here when selecting inverter size. */
export const PREFERRED_DC_AC_RATIO_TARGET = 1.25;

/**
 * Compute the DC/AC ratio for a (model, qty, totalDcKw) triple.
 * Guards against division by ~zero.
 */
function dcAcRatio(model: BrandInverterModelRef, qty: number, totalDcKw: number): number {
  const totalAc = model.acKw * qty;
  return totalDcKw / Math.max(totalAc, 0.001);
}

/**
 * DOWNSIZE STRATEGY (STEP 4 of Phase 13.2 prompt).
 *
 * When the engine's selected (model, qty) produces a DC/AC ratio below
 * MIN_DC_AC_RATIO (inverter oversized), walk the brand's supported
 * models from LARGEST to SMALLEST and try the next smaller model that
 * still satisfies the DC + panel constraints. Stop as soon as the
 * resulting ratio is >= MIN_DC_AC_RATIO.
 *
 * Pure: returns either the current (model, qty) unchanged or a smaller
 * replacement. Never loops infinitely (at most supportedInverterModels.length
 * iterations). Never upsizes (that's handled by the separate upsize rules
 * for selectedInverterId). Never crosses brands.
 */
   function attemptDownsize(
     brand: BrandProfile,
     currentModel: BrandInverterModelRef,
     currentQty: number,
     panelCount: number,
     totalDcKw: number,
     ppu: (m: BrandInverterModelRef) => number = panelsPerUnit,
   ): { model: BrandInverterModelRef; qty: number } {
     const currentRatio = dcAcRatio(currentModel, currentQty, totalDcKw);

     // v58.1 — Downsize strategy targeting ~1.25 DC/AC for optimal clipping.
     //
     // Rules (in priority order):
     //   1. NEVER increase unit count — consolidation is done by upsize rules.
     //      A system that fits in 1 inverter must stay at 1 inverter.
     //   2. Hard floor: ratio must be >= MIN_DC_AC_RATIO (1.00) — AC ≤ DC.
     //   3. Target: prefer candidates closest to PREFERRED_DC_AC_RATIO_TARGET (1.25).
     //      Candidates in PREFERRED window (1.20–1.40) take priority.
     //   4. Only switch when the candidate is a genuine improvement:
     //      (a) current is below hard floor (must fix), OR
     //      (b) current is above PREFERRED_MAX AND candidate pulls ratio lower
     //          (into or toward preferred window), OR
     //      (c) current is below PREFERRED_MIN AND candidate lands in preferred
     //          window (lifts from near-unity into healthy clipping zone).
     //
     // This intentionally does NOT downsize when the current ratio is already
     // within the preferred window (1.20–1.40) — "good enough" wins.

     // Build candidate list: strictly smaller AC rating, no micros, SAME unit count.
     const candidates = brand.supportedInverterModels
       .filter(m => (m.modulesPerDevice ?? 0) === 0)
       .filter(m => m.equipmentDbId !== currentModel.equipmentDbId)
       .filter(m => m.acKw < currentModel.acKw)
       .slice()
       .sort((a, b) => b.acKw - a.acKw); // largest-first

     // Evaluate all candidates: must satisfy hard floor AND same-or-fewer units.
     const viable: Array<{ model: BrandInverterModelRef; qty: number; ratio: number }> = [];
     for (const candidate of candidates) {
       const qty = unitsRequired(candidate, panelCount, totalDcKw, ppu(candidate));
       // RULE 1: Never increase unit count.
       if (qty > currentQty) continue;
       const ratio = dcAcRatio(candidate, qty, totalDcKw);
       // RULE 2: Hard floor.
       if (ratio < MIN_DC_AC_RATIO) continue;
       viable.push({ model: candidate, qty, ratio });
     }

     if (viable.length === 0) {
       // No smaller same-qty model satisfies the hard floor — keep current.
       return { model: currentModel, qty: currentQty };
     }

     // From viable candidates pick the one closest to PREFERRED_DC_AC_RATIO_TARGET.
     // Candidates inside the preferred window take priority.
     const inPreferred = viable.filter(
       c => c.ratio >= PREFERRED_DC_AC_RATIO_MIN && c.ratio <= PREFERRED_DC_AC_RATIO_MAX,
     );
     const pool = inPreferred.length > 0 ? inPreferred : viable;

     const best = pool.reduce((prev, curr) => {
       const prevDist = Math.abs(prev.ratio - PREFERRED_DC_AC_RATIO_TARGET);
       const currDist = Math.abs(curr.ratio - PREFERRED_DC_AC_RATIO_TARGET);
       return currDist < prevDist ? curr : prev;
     });

     // RULE 4: Only switch when it's a genuine improvement.
     const currentBelowFloor = currentRatio < MIN_DC_AC_RATIO;
     const currentAboveMax   = currentRatio > PREFERRED_DC_AC_RATIO_MAX;
     const currentBelowMin   = currentRatio < PREFERRED_DC_AC_RATIO_MIN;
     const bestInWindow       = best.ratio >= PREFERRED_DC_AC_RATIO_MIN &&
                                best.ratio <= PREFERRED_DC_AC_RATIO_MAX;
     const bestBringsRatioDown = best.ratio < currentRatio; // moving toward target from above

     if (
       currentBelowFloor ||
       (currentAboveMax && bestBringsRatioDown) ||
       (currentBelowMin && bestInWindow)
     ) {
       return { model: best.model, qty: best.qty };
     }

     // Current ratio is already in or near the preferred window — keep it.
     return { model: currentModel, qty: currentQty };
   }

// ─── Inverter sizing (Phase 4) ─────────────────────────────────────

function sizeInverters(
  brand: BrandProfile,
  input: SizingInput,
  totalDcKw: number,
  warnings: SizingWarning[],
): SizedInverter[] {
  // Phase 13.8 — Pre-compute voltage-aware panels-per-unit for each candidate.
  // When panelVoc + panelTempCoeffVoc are available, unitsRequired() uses the
  // real electrical string capacity instead of the static brand maxPanelsPerString.
  // v47.430 — forward brand topology so optimizer inverters bypass the
  // NEC 690.7 cold-Voc clamp (string Voc at the inverter is regulated by
  // the optimizer bus voltage, not the sum of panel Voc values).
  const _va_panelVoc     = input.panelVoc        ?? null;
  const _va_tempCoeff    = input.panelTempCoeffVoc ?? null;
  const _va_designTemp   = input.designTempMin   ?? -10;
  const _va_topology     = brand.topology;
  function vaPPU(model: BrandInverterModelRef): number {
    if (_va_panelVoc == null || _va_tempCoeff == null) return panelsPerUnit(model);
    return voltageAwarePanelsPerUnit(
      model,
      _va_panelVoc,
      _va_tempCoeff,
      _va_designTemp,
      _va_topology,
    );
  }

  // ── Phase 14.1: Feasibility Hard Gate ────────────────────────────────────
  //
  // Called just before any return from sizeInverters(). If panel electrical
  // specs are available (panelIsc + panelTempCoeffVoc), we verify the
  // resolved model passes the electrical feasibility check. If it fails,
  // we substitute the best-feasible alternative from generateFeasibleSystems()
  // and emit FEASIBILITY_CHOSEN_INFEASIBLE so the UI shows a warning.
  //
  // This is the ONLY place where infeasible→feasible substitution happens.
  // It runs for ALL brands (SolarEdge, Fronius, SMA, Sungrow, etc.) and
  // covers both the selectedInverterId path and the auto-tier path.
  //
  // MICRO topology is excluded — micros don't have MPPT string constraints.
  function applyFeasibilityHardGate(
    resolved: SizedInverter[],
  ): SizedInverter[] {
    // Only applies to string/optimizer/hybrid topologies with electrical specs.
    if (brand.topology === 'micro') return resolved;
    if (input.panelIsc == null || input.panelTempCoeffVoc == null) return resolved;
    if (resolved.length === 0) return resolved;

    const panel: PanelElectricalSpecs = {
      voc:          input.panelVoc          ?? 41.6,
      vmp:          input.panelVmp          ?? 34.5,
      isc:          input.panelIsc,
      watts:        input.panelWattage      ?? 400,
      tempCoeffVoc: input.panelTempCoeffVoc,
    };

    // Build equipment-db spec map for this brand.
    const eqMap = new Map<string, StringInverter>();
    for (const ref of brand.supportedInverterModels) {
      const eq = STRING_INVERTERS.find(x => x.id === ref.equipmentDbId);
      if (eq) eqMap.set(ref.equipmentDbId, eq);
    }
    if (eqMap.size === 0) return resolved;

    // Run the best-fit engine to get the electrically-valid recommendation.
    // v47.411 — forward brand topology + optimizer cap so candidate selection
    // uses NEC 690.8(A)(2) regulated-output current for optimizer topology
    // instead of panel Isc x 1.25. Without this, the feasibility gate rejects
    // all SolarEdge inverters because the panel-method current (15.3A) exceeds
    // the MPPT cap (20A) when multiplied by 4 parallel strings = 61.3A, while
    // the correct optimizer-method current (15.0A) fits 2 strings x 20A = 40A.
    const bestFit = generateFeasibleSystems({
      modelRefs:      brand.supportedInverterModels,
      equipmentSpecs: eqMap,
      panel,
      totalPanels:    input.panelCount,
      designTempMin:  input.designTempMin,
      topology:       brand.topology === 'optimizer' ? 'optimizer'
                    : brand.topology === 'hybrid'    ? 'hybrid'
                    : 'string',
      optimizerMaxOutputCurrent: input.optimizerMaxOutputCurrent,
    });

    // Check whether the resolved model is in the feasible set.
    // generateFeasibleSystems() (from feasibilityEvaluator) returns:
    //   recommended: CandidateEvaluation | null  → .modelRef.equipmentDbId
    //   alternatives: CandidateEvaluation[]       → .modelRef.equipmentDbId
    //   rejected: Array<{ equipmentDbId, failures: FeasibilityFailure[] }>
    const chosenId = resolved[0].equipmentDbId;

    const feasibleIds = new Set<string>([
      ...(bestFit.recommended ? [bestFit.recommended.modelRef.equipmentDbId] : []),
      ...bestFit.alternatives.map(a => a.modelRef.equipmentDbId),
    ]);

    // Also check: is the chosen model explicitly listed as rejected?
    const chosenIsRejected = bestFit.rejected.some(r => r.equipmentDbId === chosenId);

    // If chosen model is feasible and not rejected — nothing to do.
    if (feasibleIds.has(chosenId) && !chosenIsRejected) return resolved;

    // Chosen model is infeasible. Substitute with the engine's recommendation.
    if (!bestFit.recommended) {
      // No feasible config at all — warn but return original (validation
      // engine will surface the errors downstream).
      warnings.push({
        severity: 'warning',
        code: 'FEASIBILITY_NO_VIABLE_MODEL',
        message:
          `Feasibility check: No inverter model in ${brand.displayName} passes ` +
          `electrical constraints for ${input.panelCount} panels. ` +
          `Review MPPT current limits and panel Isc.`,
      });
      return resolved;
    }

    // Build the substitute SizedInverter from the recommended CandidateEvaluation.
    const recRef  = bestFit.recommended.modelRef;
    const recResult = bestFit.recommended.result;
    const substitute: SizedInverter[] = [{
      equipmentDbId: recRef.equipmentDbId,
      brandId:       brand.id,
      acKw:          recRef.acKw,
      dcKwMax:       recRef.dcKwMax,
      mpptCount:     recRef.mpptCount,
      qty:           recResult.inverterCount ?? 1,
    }];

    // Surface the infeasibility — failures are FeasibilityFailure objects with .code.
    const chosenRejected = bestFit.rejected.find(r => r.equipmentDbId === chosenId);
    const failureCodes = (chosenRejected?.failures ?? [])
      .map(f => f.code)
      .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

    const codesStr = failureCodes.length > 0
      ? failureCodes.join(', ')
      : 'electrical constraints not met';

    warnings.push({
      severity: 'warning',
      code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
      message:
        `Feasibility check: Chosen inverter ${chosenId} has concerns ` +
        `(${codesStr}). Recommended alternative in the same brand: ` +
        `${recRef.equipmentDbId}.`,
    });

    return substitute;
  }

  // Priority: user's explicit inverter model
  if (input.selectedInverterId) {
    const ref = brand.supportedInverterModels.find(
      m => m.equipmentDbId === input.selectedInverterId,
    );
    if (ref) {
      // Micro topology: qty driven by panel count / modulesPerDevice.
      // Upsizing to a different micro model is not a common real-world
      // pattern (installers use one SKU across a job), so keep the
      // selected model and scale units.
      if (brand.topology === 'micro') {
        const mpd = ref.modulesPerDevice ?? 1;
        const qty = Math.ceil(input.panelCount / mpd);
        return applyFeasibilityHardGate([{
          equipmentDbId: ref.equipmentDbId,
          brandId: brand.id,
          acKw: ref.acKw,
          dcKwMax: ref.dcKwMax,
          mpptCount: ref.mpptCount,
          qty,
        }]);
      }

      // String / optimizer / hybrid: respect the user's model IF one unit
      // can carry the whole system. If not, follow real-world installer
      // logic — prefer ONE bigger inverter of the same brand over
      // duplicating an undersized model (cheaper BOS, one AC combiner,
      // one monitoring gateway, simpler commissioning).
      //
      // Phase 13.2 — per-unit panel ceiling now uses the physically
      // correct formula (mpptCount × parallelStringsPerMppt × maxPPS)
      // via the panelsPerUnit() / unitsRequired() helpers.
      const panelsPerUnitSelected = vaPPU(ref);
      const qtySelected = unitsRequired(ref, input.panelCount, totalDcKw, panelsPerUnitSelected);

      if (qtySelected === 1) {
        // Selected model is big enough on its own. User's explicit
        // selection is HONORED here — we do NOT auto-downsize when the
        // installer has explicitly chosen a model (that would violate
        // user-intent. Auto-downsize only fires in the unselected /
        // auto-tier path below).
        // Phase 14.1: feasibility hard gate still applies — if the selected
        // model fails electrical checks (e.g. MPPT current overload), we
        // substitute the best-feasible alternative and emit a warning.
        return applyFeasibilityHardGate([{
          equipmentDbId: ref.equipmentDbId,
          brandId: brand.id,
          acKw: ref.acKw,
          dcKwMax: ref.dcKwMax,
          mpptCount: ref.mpptCount,
          qty: 1,
        }]);
      }

      // Selected model would need multiple units. Try to UPSIZE to a
      // bigger model in the same brand.
      //
      // Real-life rule set (in priority order):
      //   1. Prefer a candidate that needs FEWER units than the selection.
      //   2. If user's selection is SMALLER than the brand's tier-recommended
      //      model for this DC load (i.e. installer picked an undersized
      //      inverter), upsize to the tier-recommended model even when qty
      //      is identical — this matches the brand engineer's intended design
      //      and avoids permanently under-rating the system.
      //   3. Otherwise, respect the user's selection and scale units.
      //
      // Consideration #2 is what makes "36 panels + user-picked se-7600h"
      // become "1×se-11400h or 2×se-11400h" rather than "2×se-7600h": the
      // tier for 14.4 kW DC is se-11400h, so the user's se-7600h is
      // engineer-undersized regardless of the qty calculation.
      const tierRec = pickInverterTier(brand.sizingTiers, totalDcKw);
      const tierRecModel = tierRec
        ? brand.supportedInverterModels.find(m => m.equipmentDbId === tierRec.equipmentDbId)
        : undefined;
      const userIsUndersizedVsTier =
        tierRecModel !== undefined &&
        tierRecModel.equipmentDbId !== ref.equipmentDbId &&
        tierRecModel.dcKwMax > ref.dcKwMax;

      // Phase 14.3 — Pre-compute the feasibility-rejected set so Rules 1 and 2
      // never upsize to a model the hard gate would immediately reverse.
      // e.g. fronius-primo-5.0 needs 2 units -> Rule 1 finds primo-10.0 as
      // "fewer units" -> hard gate rejects 10.0 -> contradiction. Pre-filtering
      // candidates prevents the INVERTER_UPSIZED + FEASIBILITY_CHOSEN_INFEASIBLE
      // conflict from ever appearing together.
      let feasibilityRejectedIds = new Set<string>();
      if (input.panelIsc != null && input.panelTempCoeffVoc != null) {
        const panel: PanelElectricalSpecs = {
          voc:          input.panelVoc          ?? 41.6,
          vmp:          input.panelVmp          ?? 34.5,
          isc:          input.panelIsc,
          watts:        input.panelWattage      ?? 400,
          tempCoeffVoc: input.panelTempCoeffVoc,
        };
        const eqMap = new Map<string, StringInverter>();
        for (const mr of brand.supportedInverterModels) {
          const eq = STRING_INVERTERS.find(x => x.id === mr.equipmentDbId);
          if (eq) eqMap.set(mr.equipmentDbId, eq);
        }
        if (eqMap.size > 0) {
          const preCheck = generateFeasibleSystems({
            modelRefs:      brand.supportedInverterModels,
            equipmentSpecs: eqMap,
            panel,
            totalPanels:    input.panelCount,
            designTempMin:  input.designTempMin,
            // v47.411 — forward topology so Rule-1/Rule-2 upsize candidates are
            // evaluated with the correct NEC design-current method.
            topology:       brand.topology === 'optimizer' ? 'optimizer'
                          : brand.topology === 'hybrid'    ? 'hybrid'
                          : 'string',
            optimizerMaxOutputCurrent: input.optimizerMaxOutputCurrent,
          });
          feasibilityRejectedIds = new Set(preCheck.rejected.map(r => r.equipmentDbId));
        }
      }

      const candidates = brand.supportedInverterModels
        .filter(m => {
          if (m.equipmentDbId === ref.equipmentDbId) return false;
          // Must be same family (string / optimizer / hybrid) — skip micros.
          if ((m.modulesPerDevice ?? 0) > 0) return false;
          // Must be STRICTLY BIGGER than the user's selection in DC capacity
          // or string capacity. This prevents downgrading to something smaller.
          const biggerDc = m.dcKwMax > ref.dcKwMax;
          const biggerStrings = vaPPU(m) > panelsPerUnitSelected;
          if (!biggerDc && !biggerStrings) return false;
          // Phase 14.3: Never upsize to a model the feasibility gate will reject.
          if (feasibilityRejectedIds.has(m.equipmentDbId)) return false;
          return true;
        })
        .map(m => ({ model: m, qty: unitsRequired(m, input.panelCount, totalDcKw, vaPPU(m)) }))
        // Prefer fewer units first, then larger AC rating (best headroom),
        // deterministic tie-break by equipmentDbId.
        .sort((a, b) => {
          if (a.qty !== b.qty) return a.qty - b.qty;
          if (a.model.acKw !== b.model.acKw) return b.model.acKw - a.model.acKw;
          return a.model.equipmentDbId.localeCompare(b.model.equipmentDbId);
        });

      // Rule 1: fewer-unit candidate available → upsize to it.
      const fewerUnitsCandidate = candidates.find(c => c.qty < qtySelected);
      if (fewerUnitsCandidate) {
        warnings.push({
          severity: 'info',
          code: 'INVERTER_UPSIZED',
          message:
            `Selected ${ref.equipmentDbId} would require ${qtySelected} units ` +
            `for ${input.panelCount} panels / ${totalDcKw.toFixed(1)} kW DC. ` +
            `Upsized to ${fewerUnitsCandidate.model.equipmentDbId} ` +
            `(${fewerUnitsCandidate.qty} unit${fewerUnitsCandidate.qty > 1 ? 's' : ''}) ` +
            `for simpler installation.`,
        });
        return applyFeasibilityHardGate([{
          equipmentDbId: fewerUnitsCandidate.model.equipmentDbId,
          brandId: brand.id,
          acKw: fewerUnitsCandidate.model.acKw,
          dcKwMax: fewerUnitsCandidate.model.dcKwMax,
          mpptCount: fewerUnitsCandidate.model.mpptCount,
          qty: fewerUnitsCandidate.qty,
        }]);
      }

      // Rule 2: user selection is smaller than the brand's tier-recommended
      // model for this DC load → upsize to the tier-recommended model even
      // when qty is identical.
      //
      // EXCEPTION (Phase 13.8.1 fix): if the selected model already produces
      // a healthy DC/AC ratio (>= MIN_DC_AC_RATIO) at qtySelected units, do
      // NOT upsize. The user (or the engine's own attemptDownsize()) chose
      // this model precisely because the tier model was oversized. Upsizing
      // back to the tier model would recreate the DC_AC_RATIO_LOW condition
      // that triggered the downsize in the first place — an infinite loop.
      const selectedRatio = dcAcRatio(ref, qtySelected, totalDcKw);
      // Rule 2 also respects the feasibility-rejected set: if the tier-recommended
      // model is itself infeasible, skip the upsize and fall through to Rule 3.
      if (userIsUndersizedVsTier && tierRecModel && selectedRatio < MIN_DC_AC_RATIO &&
          !feasibilityRejectedIds.has(tierRecModel.equipmentDbId)) {
        const qtyTier = unitsRequired(tierRecModel, input.panelCount, totalDcKw, vaPPU(tierRecModel));
        warnings.push({
          severity: 'info',
          code: 'INVERTER_UPSIZED',
          message:
            `Selected ${ref.equipmentDbId} is undersized for ${totalDcKw.toFixed(1)} kW DC ` +
            `(brand recommends ${tierRecModel.equipmentDbId} for this DC range). ` +
            `Upsized to ${tierRecModel.equipmentDbId} ` +
            `(${qtyTier} unit${qtyTier > 1 ? 's' : ''}).`,
        });
        return applyFeasibilityHardGate([{
          equipmentDbId: tierRecModel.equipmentDbId,
          brandId: brand.id,
          acKw: tierRecModel.acKw,
          dcKwMax: tierRecModel.dcKwMax,
          mpptCount: tierRecModel.mpptCount,
          qty: qtyTier,
        }]);
      }

      // Rule 3: no beneficial upsize. Fall back to multiple units of the
      // user's selection.
      return applyFeasibilityHardGate([{
        equipmentDbId: ref.equipmentDbId,
        brandId: brand.id,
        acKw: ref.acKw,
        dcKwMax: ref.dcKwMax,
        mpptCount: ref.mpptCount,
        qty: qtySelected,
      }]);
    }
    warnings.push({
      severity: 'warning',
      code: 'INVERTER_MODEL_NOT_IN_BRAND',
      message: `Selected inverter ${input.selectedInverterId} is not part of ${brand.displayName}. Using auto-sized default.`,
    });
  }

  // Micro topology: one device per panel (or per modulesPerDevice pair)
  if (brand.topology === 'micro') {
    const defaultRef = brand.supportedInverterModels[0];
    if (!defaultRef) {
      warnings.push({
        severity: 'error',
        code: 'BRAND_NO_MICRO_MODEL',
        message: `${brand.displayName} has no micro model registered.`,
      });
      return [];
    }
    const mpd = defaultRef.modulesPerDevice ?? 1;
    const qty = Math.ceil(input.panelCount / mpd);
    return [{
      equipmentDbId: defaultRef.equipmentDbId,
      brandId: brand.id,
      acKw: defaultRef.acKw,
      dcKwMax: defaultRef.dcKwMax,
      mpptCount: defaultRef.mpptCount,
      qty,
    }];
  }

  // String / optimizer / hybrid: use sizing tiers
  const tier = pickInverterTier(brand.sizingTiers, totalDcKw);
  if (!tier) {
    warnings.push({
      severity: 'error',
      code: 'INVERTER_NO_TIER_MATCH',
      message: `No inverter tier in ${brand.displayName} covers ${totalDcKw.toFixed(1)} kW DC.`,
    });
    return [];
  }
  const ref = brand.supportedInverterModels.find(
    m => m.equipmentDbId === tier.equipmentDbId,
  );
  if (!ref) {
    warnings.push({
      severity: 'error',
      code: 'INVERTER_TIER_MODEL_MISSING',
      message: `Brand ${brand.displayName} tier references ${tier.equipmentDbId} but model is not registered.`,
    });
    return [];
  }

  // For oversized DC arrays, add more inverter units.
  // Two independent physical constraints:
  //   (a) DC kW must fit: ceil(totalDcKw / dcKwMax)
  //   (b) Panels must fit across MPPT slots:
  //       maxPanelsPerUnit = mpptCount × parallelStringsPerMppt × maxPPS
  //       qty >= ceil(panelCount / maxPanelsPerUnit)
  // Phase 13.2 fix: (b) previously used mpptCount × maxPPS and assumed
  // 1 parallel string per MPPT, which under-stated per-unit capacity by
  // 2× and forced oversized multi-inverter designs (e.g. 36 panels on
  // SE-11400H was 2 units at DC/AC 0.63 instead of 1 unit at 1.26).
  const qty = unitsRequired(ref, input.panelCount, totalDcKw, vaPPU(ref));

  // DC/AC ratio guardrail (STEP 3 of prompt): if the selection is
  // oversized (ratio < 0.9), proactively downsize to the next smaller
  // model that still satisfies DC + panel constraints.
  const picked = attemptDownsize(brand, ref, qty, input.panelCount, totalDcKw, vaPPU);
  if (picked.model.equipmentDbId !== ref.equipmentDbId) {
    warnings.push({
      severity: 'info',
      code: 'INVERTER_DOWNSIZED',
      message:
        `Tier-selected ${ref.equipmentDbId} × ${qty} oversized for ${totalDcKw.toFixed(1)} kW DC ` +
        `(DC/AC ratio ${dcAcRatio(ref, qty, totalDcKw).toFixed(2)}). ` +
        `Downsized to ${picked.model.equipmentDbId} × ${picked.qty} ` +
        `(DC/AC ratio ${dcAcRatio(picked.model, picked.qty, totalDcKw).toFixed(2)}).`,
    });
  }
  const finalModel = picked.model;
  const finalQty = picked.qty;

  // DC/AC ratio advisories (auto-tier path):
  //   1. Brand-specific range tightening (SOFT - brand preference).
  //   2. Industry preferred window 1.15-1.35 advisory (INFO).
  // Absolute thresholds (< 1.00 error, > 2.0 error) are enforced by
  // the validation engine downstream.
  const finalRatio = dcAcRatio(finalModel, finalQty, totalDcKw);
  const range = brand.compatibility.dcAcRatioRange;
  if (range && (finalRatio < range.min || finalRatio > range.max)) {
    warnings.push({
      severity: 'warning',
      code: 'DC_AC_RATIO_OUT_OF_RANGE',
      message: `DC/AC ratio ${finalRatio.toFixed(2)} is outside ${brand.displayName}'s recommended range ${range.min}-${range.max}.`,
    });
  }
  // Advisory: preferred design window 1.15-1.35.
  if (
    finalRatio >= 1.0 &&
    (finalRatio < PREFERRED_DC_AC_RATIO_MIN || finalRatio > PREFERRED_DC_AC_RATIO_MAX)
  ) {
    warnings.push({
      severity: 'info',
      code: 'DC_AC_RATIO_OUTSIDE_PREFERRED',
      message:
        `DC/AC ratio ${finalRatio.toFixed(2)} is outside the preferred design window ` +
        `${PREFERRED_DC_AC_RATIO_MIN}-${PREFERRED_DC_AC_RATIO_MAX}. ` +
        `Ratio is valid but review for optimal performance.`,
    });
  }
  return applyFeasibilityHardGate([{
    equipmentDbId: finalModel.equipmentDbId,
    brandId: brand.id,
    acKw: finalModel.acKw,
    dcKwMax: finalModel.dcKwMax,
    mpptCount: finalModel.mpptCount,
    qty: finalQty,
  }]);
}

// ─── String / Micro distribution (Phase 5) ─────────────────────────

function distributeStrings(
  brand: BrandProfile,
  input: SizingInput,
  inverters: SizedInverter[],
  warnings: SizingWarning[],
): { strings: SizedString[]; microDeviceCount: number; acBranchCount: number } {
  const topology = brand.topology;

  // Micro: no DC strings; each panel → one micro device
  if (topology === 'micro') {
    const totalMicros = inverters.reduce((s, inv) => s + inv.qty, 0);
    // AC branch count: typical is 16 units/branch; use panelCount-driven default
    const branchCount = Math.max(1, Math.ceil(totalMicros / 16));
    return {
      strings: [],
      microDeviceCount: totalMicros,
      acBranchCount: branchCount,
    };
  }

  // String / optimizer / hybrid: distribute panels across MPPTs.
  //
  // Algorithm: enumerate every MPPT slot across every inverter unit first,
  // then divide the panel count evenly across ALL slots. This avoids the
  // bug where an inverter with qty=2 and mpptCount=1 was divided by only
  // 1 MPPT per unit (losing trailing panels) — see 55-panel SolarEdge
  // regression. The new approach always produces a balanced distribution
  // across the full MPPT pool.
  const result: SizedString[] = [];
  let stringIndex = 0;

  // Build the full slot list: one entry per (physical inverter unit × MPPT
  // channel). Every physical unit gets a unique flat index so the UI can
  // correctly group strings into one card per unit.
  interface MpptSlot {
    modelIndex: number;       // index into `inverters` (model array)
    physicalUnitIndex: number; // 0..sum(qty)-1 — flat across all models
    mpptIndex: number;
    minPPS: number;
    maxPPS: number;
  }
  // Phase 13.8 — Voltage-safe string ceiling.
  // When the caller supplies panelVoc + panelTempCoeffVoc, compute how many
  // panels can fit in series before exceeding the inverter's maxDcVoltage.
  // This prevents the primary sizer from producing strings that would trip
  // NEC 690.7 / inverter over-voltage violations (e.g. 10-panel strings on a
  // 480 V-max inverter with a high-Voc panel at cold temperature).
  //
  // Formula:
  //   vocColdPerPanel = panelVoc × (1 + tempCoeffVoc/100 × (designTempMin − 25))
  //   vocSafeCeiling  = floor(maxDcVoltage / vocColdPerPanel)
  //
  // We apply a small safety derating (×0.99) to stay clearly below the limit.
  // Falls back to the brand profile static value when electrical data is absent.
  const designTempMin = input.designTempMin ?? -10;
  const panelVoc      = input.panelVoc      ?? 41.6;
  const tempCoeffVoc  = input.panelTempCoeffVoc; // %/°C; undefined = no clamping

  function voltageAwareMaxPPS(equipmentDbId: string, brandMaxPPS: number): {
    effectiveMax: number;
    wasClamped: boolean;
    vocSafeCeiling: number;
    isOptimizerPowerCap: boolean;
  } {
    // v47.411 — Voltage clamp is INAPPLICABLE to optimizer topology.
    //
    // In a SolarEdge / Tigo optimizer system, each optimizer regulates the
    // DC output of its panel independently. The string DC voltage reaching
    // the inverter is the *inverter's fixed bus voltage* (~380-400V DC for
    // HD-Wave), NOT the sum of panel Voc values. At open-circuit / shutdown
    // ("SafeDC" mode) each optimizer outputs ~1V, so a 25-panel string has
    // ~25V Voc — trivially safe against the 480V inverter max.
    //
    // Applying the panel-Voc × cold-temperature clamp here falsely limits
    // SolarEdge strings (e.g. 10 panels max on Qcells 400W @ -10 °C) and
    // forces the engine to generate 4-string layouts that blow the MPPT
    // current budget (4 × 15A = 60A > 40A channel capacity on 2× SE7600H).
    //
    // v47.422 — However, we MUST still apply the optimizer STRING POWER CAP:
    //   maxStringPower  = nominalDcV × optimizerMaxOutputCurrent
    //   maxPowerPanels  = floor(maxStringPower / panelWatts)
    // e.g. 380V × 15A / 400W = 14 panels max.
    // Strings above this threshold put optimizers in saturation (clipping).
    // The brand-profile ceiling (25) is the physical datasheet absolute max,
    // not the energy-optimal per-panel-wattage cap. Without this cap the
    // distributor produces strings like [18,18] for 36×400W on SE11400H,
    // violating the 5,700W-per-string optimizer power limit.
    if (topology === 'optimizer') {
      const _optCap  = input.optimizerMaxOutputCurrent ?? 15.0;
      const _panelW  = input.panelWattage ?? 400;
      // Look up the inverter's nominal DC bus voltage from equipment DB
      const _invEq   = STRING_INVERTERS.find(x => x.id === equipmentDbId) as any;
      const _nomDcV  = (_invEq?.nominalDcVoltage && _invEq.nominalDcVoltage > 0)
        ? _invEq.nominalDcVoltage
        : 380; // SolarEdge HD-Wave default
      const _maxStringPower     = _nomDcV * _optCap;
      const _maxFullPowerPanels = _panelW > 0
        ? Math.floor(_maxStringPower / _panelW)
        : brandMaxPPS;
      const effectiveMax = Math.min(brandMaxPPS, _maxFullPowerPanels);
      const wasClamped   = effectiveMax < brandMaxPPS;
      return { effectiveMax, wasClamped, vocSafeCeiling: Infinity, isOptimizerPowerCap: wasClamped };
    }
    if (tempCoeffVoc == null) {
      return { effectiveMax: brandMaxPPS, wasClamped: false, vocSafeCeiling: Infinity, isOptimizerPowerCap: false };
    }
    const eq = STRING_INVERTERS.find(x => x.id === equipmentDbId);
    if (!eq) {
      return { effectiveMax: brandMaxPPS, wasClamped: false, vocSafeCeiling: Infinity, isOptimizerPowerCap: false };
    }
    // Cold temperature Voc per panel (NEC 690.7 design point).
    const coldFactor     = 1 + (tempCoeffVoc / 100) * (designTempMin - 25);
    const vocColdPerPanel = panelVoc * coldFactor;
    if (vocColdPerPanel <= 0) {
      return { effectiveMax: brandMaxPPS, wasClamped: false, vocSafeCeiling: Infinity, isOptimizerPowerCap: false };
    }
    // Floor with a 1% safety margin below the rated max.
    const vocSafeCeiling = Math.floor((eq.maxDcVoltage * 0.99) / vocColdPerPanel);
    const effectiveMax   = Math.min(brandMaxPPS, Math.max(1, vocSafeCeiling));
    return { effectiveMax, wasClamped: effectiveMax < brandMaxPPS, vocSafeCeiling, isOptimizerPowerCap: false };
  }

  const slots: MpptSlot[] = [];
  let physicalUnitCounter = 0;
  for (let modelIdx = 0; modelIdx < inverters.length; modelIdx++) {
    const inv = inverters[modelIdx];
    const ref = brand.supportedInverterModels.find(m => m.equipmentDbId === inv.equipmentDbId);
    const brandMaxPPS = ref?.maxPanelsPerString ?? 20;
    const brandMinPPS = ref?.minPanelsPerString ?? 8;

    // Apply voltage-safe ceiling (Phase 13.8).
    const { effectiveMax, wasClamped, vocSafeCeiling, isOptimizerPowerCap } =
      voltageAwareMaxPPS(inv.equipmentDbId, brandMaxPPS);
    const maxPPS = effectiveMax;
    // minPPS must not exceed the effective maxPPS (prevents impossible slots).
    const minPPS = Math.min(brandMinPPS, maxPPS);

    if (wasClamped) {
      if (isOptimizerPowerCap) {
        // Optimizer string power cap: floor(nomDcV x optimizerCap / panelW)
        const _invEq2 = STRING_INVERTERS.find(x => x.id === inv.equipmentDbId) as any;
        const _nomDcV2 = _invEq2?.nominalDcVoltage ?? 380;
        const _optCap2 = input.optimizerMaxOutputCurrent ?? 15.0;
        warnings.push({
          severity: 'info',
          code: 'OPTIMIZER_STRING_POWER_CAP',
          message:
            `${inv.equipmentDbId}: max panels/string capped at ${maxPPS} ` +
            `(optimizer string power limit: ${_nomDcV2}V × ${_optCap2}A = ${_nomDcV2 * _optCap2}W; ` +
            `${input.panelWattage ?? 400}W panels → ${maxPPS} panels max per string).`,
        });
      } else {
        warnings.push({
          severity: 'warning',
          code: 'STRING_VOC_VOLTAGE_CLAMP',
          message:
            `${inv.equipmentDbId}: max panels/string reduced from ${brandMaxPPS} to ${maxPPS} ` +
            `(voltage-safe ceiling: ${vocSafeCeiling} panels at ${designTempMin}°C cold Voc, ` +
            `inverter max ${STRING_INVERTERS.find(x => x.id === inv.equipmentDbId)?.maxDcVoltage ?? '?'}V).`,
        });
      }
    }

    // Phase 13.2 — a single MPPT channel accepts multiple series strings
    // wired in parallel. We must produce one layout SLOT per parallel
    // string (not just per MPPT channel), otherwise dense arrays like
    // 55 panels on SolarEdge (2 units × 1 MPPT × 2 parallel × 25 maxPPS =
    // 100 panel slots) would try to cram everything into just 2 MPPT
    // slots of ≤25 each and orphan the remainder.
    //
    // Phase 14.3 — Smart parallel count: find the MINIMUM parallel count p
    // (1..maxParallelStringsPerMppt) such that all panels fit within maxPPS
    // AND each string stays at or above minPPS. This prevents over-slotting
    // (e.g. 2×Primo5.0 with 2 MPPT×2 parallel = 8 slots for only 36 panels
    // → 4-5 panels/string, all below the 7-panel minimum).
    // maxParallelStringsPerMppt is a hardware CEILING, not a fill requirement.
    // If no p satisfies both constraints, fall back to maxParallelPerMppt so
    // the distributor can still assign all panels (existing overflow handling).
    const maxParallelPerMppt =
      ref?.maxParallelStringsPerMppt ?? DEFAULT_PARALLEL_STRINGS_PER_MPPT;
    // Total MPPT channels across ALL inverter models (used to apportion panels).
    const totalMpptAllModels = inverters.reduce(
      (sum, inv2) => sum + inv2.qty * inv2.mpptCount,
      0,
    );
    // This model's share of panels (proportional to its MPPT contribution).
    const totalMpptThisModel = inv.qty * inv.mpptCount;
    const panelShare = totalMpptAllModels > 0
      ? Math.round(input.panelCount * (totalMpptThisModel / totalMpptAllModels))
      : input.panelCount;
    // Find minimum p: all panels fit (avg <= maxPPS) AND strings stay viable (avg >= minPPS).
    let chosenParallel = maxParallelPerMppt;
    for (let p = 1; p <= maxParallelPerMppt; p++) {
      const slotsForP = totalMpptThisModel * p;
      const avgPanelsPerSlot = panelShare / slotsForP;
      const fitsWithinMax = avgPanelsPerSlot <= maxPPS;
      const aboveMin = avgPanelsPerSlot >= minPPS;
      if (fitsWithinMax && aboveMin) {
        chosenParallel = p;
        break;
      }
    }
    for (let instanceIdx = 0; instanceIdx < inv.qty; instanceIdx++) {
      const physicalUnitIndex = physicalUnitCounter++;
      for (let mppt = 0; mppt < inv.mpptCount; mppt++) {
        for (let p = 0; p < chosenParallel; p++) {
          slots.push({
            modelIndex: modelIdx,
            physicalUnitIndex,
            mpptIndex: mppt,
            minPPS,
            maxPPS,
          });
        }
      }
    }
  }

  let panelsLeft = input.panelCount;
  const totalSlots = slots.length;

  if (totalSlots === 0) {
    warnings.push({
      severity: 'error',
      code: 'NO_MPPT_SLOTS',
      message: 'No inverter MPPT channels available for string distribution.',
    });
  }

  // Even distribution: front slots get one extra panel when not divisible.
  // Respects the per-string maxPPS ceiling; any overflow is reported below.
  for (let i = 0; i < slots.length && panelsLeft > 0; i++) {
    const slot = slots[i];
    const slotsRemaining = totalSlots - i;
    const fairShare = Math.ceil(panelsLeft / slotsRemaining);
    const thisStringCount = Math.min(fairShare, slot.maxPPS, panelsLeft);
    if (thisStringCount < slot.minPPS) {
      warnings.push({
        severity: 'warning',
        code: 'STRING_BELOW_MIN',
        message: `String ${stringIndex + 1} has only ${thisStringCount} panels; ${brand.displayName} minimum is ${slot.minPPS}.`,
      });
    }
    result.push({
      index: stringIndex++,
      panelCount: thisStringCount,
      mpptIndex: slot.mpptIndex,
      // PHYSICAL unit index (flat across all models): 0..sum(qty)-1.
      // The apply callback MUST group by this to create one UI card per
      // physical unit — grouping by modelIndex would dump all strings
      // into one card when qty > 1 for a single model.
      inverterIndex: slot.physicalUnitIndex,
      modelIndex: slot.modelIndex,
    });
    panelsLeft -= thisStringCount;
  }

  if (panelsLeft > 0) {
    warnings.push({
      severity: 'error',
      code: 'STRING_OVERFLOW',
      message: `${panelsLeft} panels could not be assigned to any MPPT — inverter under-sized.`,
    });
  }

  return {
    strings: result,
    microDeviceCount: 0,
    acBranchCount: 0,
  };
}

// ─── Battery sizing (Phases 6 + 7) ─────────────────────────────────

const ECOFLOW_MODULE_KWH = 5;
const ECOFLOW_STD_CAP_KWH = 45;
const ECOFLOW_PRO_CAP_KWH = 80;

function sizeBattery(
  brand: BrandProfile,
  input: SizingInput,
  warnings: SizingWarning[],
): SizedBattery | null {
  // Phase 6 — STRICT: battery only when user has explicitly enabled it.
  if (!input.batteryEnabled) return null;

  if (!brand.battery.capable) {
    warnings.push({
      severity: 'error',
      code: 'BATTERY_NOT_CAPABLE',
      message: `${brand.displayName} does not support batteries — requested battery cannot be sized.`,
    });
    return null;
  }

  const strategy = brand.battery.sizingStrategy ?? 'modular_stack';
  const batteryBrandId = input.selectedBatteryBrand
    ?? brand.battery.recommendedBatteryBrands?.[0]
    ?? brand.id;

  // Phase 15 — cross-brand compatibility soft-check. Emits warnings but
  // never silently rejects the user's selection. The authoritative
  // matrix lives in lib/system/brandCompatibility.ts; the downstream
  // validation engine produces the full structured result. We mirror a
  // lightweight warning here so the sizing result's own `warnings[]`
  // array carries the issue into any consumer that reads it directly.
  if (input.selectedBatteryBrand) {
    const invExcluded = brand.compatibility.incompatibleBrands ?? [];
    if (invExcluded.includes(input.selectedBatteryBrand)) {
      warnings.push({
        severity: 'error',
        code: 'INCOMPATIBLE_CROSS_BRAND',
        message: `${brand.displayName} is incompatible with battery brand '${input.selectedBatteryBrand}'. Configuration honored; downstream validation will flag this.`,
      });
    } else {
      const recommended = brand.battery.recommendedBatteryBrands ?? [];
      if (recommended.length > 0 && !recommended.includes(input.selectedBatteryBrand)) {
        warnings.push({
          severity: 'warning',
          code: 'BATTERY_BRAND_NOT_RECOMMENDED',
          message: `${brand.displayName} is typically paired with ${recommended.join(', ')}; '${input.selectedBatteryBrand}' is not officially recommended.`,
        });
      }
    }
  }

  // Phase 7 — EcoFlow modular stack logic (generalizable)
  if (strategy === 'modular_stack') {
    // Use user target if manual, else default
    const target = input.batteryMode === 'manual' && input.batteryTargetKwh
      ? input.batteryTargetKwh
      : brand.battery.defaultTargetKwh ?? 10;

    // Cap at pro/standard stack ceiling
    const cap = input.batteryUsePro ? ECOFLOW_PRO_CAP_KWH : ECOFLOW_STD_CAP_KWH;
    const maxAllowed = Math.min(brand.battery.maxKwh ?? cap, cap);
    const effectiveTarget = Math.min(Math.max(target, brand.battery.minKwh ?? 0), maxAllowed);

    if (target > maxAllowed) {
      warnings.push({
        severity: 'warning',
        code: 'BATTERY_TARGET_CAPPED',
        message: `Target ${target} kWh exceeds ${batteryBrandId} ${input.batteryUsePro ? 'pro' : 'std'} stack cap ${maxAllowed} kWh — capped.`,
      });
    }

    const moduleCount = Math.ceil(effectiveTarget / ECOFLOW_MODULE_KWH);
    const installed = moduleCount * ECOFLOW_MODULE_KWH;

    // Equipment-db id for EcoFlow battery module
    const equipmentDbId = batteryBrandId === 'ecoflow' ? 'ecoflow-battery-5kwh' : undefined;

    return {
      brandId: batteryBrandId,
      equipmentDbId,
      targetKwh: target,
      installedKwh: installed,
      moduleCount,
      strategy,
      proStack: Boolean(input.batteryUsePro),
    };
  }

  // Other strategies (single_pack, per_module, custom) — not yet implemented
  warnings.push({
    severity: 'info',
    code: 'BATTERY_STRATEGY_NOT_IMPLEMENTED',
    message: `Battery sizing strategy '${strategy}' is not yet implemented for ${brand.displayName}.`,
  });
  return null;
}

// ─── Required components (Phase 8) ─────────────────────────────────

function computeRequiredComponents(
  brand: BrandProfile,
  inverters: SizedInverter[],
  stringInfo: { strings: SizedString[]; microDeviceCount: number; acBranchCount: number },
  battery: SizedBattery | null,
  input: SizingInput,
): SizedRequiredComponent[] {
  const totalInverterQty = inverters.reduce((s, i) => s + i.qty, 0);
  const out: SizedRequiredComponent[] = [];

  for (const fam of brand.requiredBOSFamilies) {
    let qty = 0;
    switch (fam.qtyPolicy) {
      case 'per_module':   qty = input.panelCount; break;
      case 'per_inverter': qty = totalInverterQty; break;
      case 'per_branch':   qty = stringInfo.acBranchCount; break;
      case 'per_stack':    qty = battery ? Math.max(1, Math.ceil((battery.moduleCount) / 15)) : 0; break;
      case 'fixed_one':    qty = 1; break;
      case 'derived':      qty = 0; break; // BOM computes from other fields
    }

    // Skip battery-only BOS items if no battery was enabled
    if (fam.category === 'battery_combiner' && !battery) continue;
    if (fam.category === 'battery_base'     && !battery) continue;

    out.push({
      category:      fam.category,
      qty,
      equipmentDbId: fam.equipmentDbId,
      qtyPolicy:     fam.qtyPolicy,
      required:      fam.required,
      note:          fam.note,
    });
  }

  return out;
}

// ─── Validation (Phase 12 seeds) ───────────────────────────────────

function validateCompatibility(
  brand: BrandProfile,
  inverters: SizedInverter[],
  battery: SizedBattery | null,
  warnings: SizingWarning[],
): void {
  // Incompatible topologies: not possible internally since we pick from brand
  // but flag battery-brand mismatches
  if (battery && brand.battery.recommendedBatteryBrands
      && !brand.battery.recommendedBatteryBrands.includes(battery.brandId)) {
    warnings.push({
      severity: 'warning',
      code: 'BATTERY_BRAND_UNRECOMMENDED',
      message: `Battery brand '${battery.brandId}' is not in ${brand.displayName}'s recommended list (${brand.battery.recommendedBatteryBrands.join(', ')}).`,
    });
  }

  // Max DC kW per inverter check
  const cap = brand.compatibility.maxDcKwPerInverter;
  if (cap) {
    for (const inv of inverters) {
      if (inv.dcKwMax > cap) {
        warnings.push({
          severity: 'warning',
          code: 'INVERTER_DC_OVER_CAP',
          message: `Inverter ${inv.equipmentDbId} dcKwMax=${inv.dcKwMax} exceeds brand cap ${cap}.`,
        });
      }
    }
  }
}

// ─── Phase 13.6b — Feasibility evaluation helper ──────────────────────────

/**
 * Build a feasibility report across every inverter model in the brand.
 *
 * Returns `undefined` when:
 *   - topology is "micro" (per-panel, not string-level → not applicable)
 *   - panel electrical specs (Voc/Isc/tempCoeff) are missing or default
 *     AND we cannot safely fabricate them
 *
 * This function NEVER modifies the sized result — it only observes.
 */
function buildFeasibilityReport(
  brand: BrandProfile,
  input: SizingInput,
  chosenEquipmentDbId: string | null,
): FeasibilityReport | undefined {
  // Not applicable to micro topologies.
  if (brand.topology === 'micro') return undefined;

  // Opt-in: only run feasibility when the caller supplies the extra panel
  // electrical specs (Isc + tempCoeffVoc). This keeps legacy callers free
  // of regression warnings while new callers unlock the advisory feature.
  if (input.panelIsc == null || input.panelTempCoeffVoc == null) {
    return undefined;
  }

  const panel: PanelElectricalSpecs = {
    voc:           input.panelVoc     ?? 41.6,
    vmp:           input.panelVmp     ?? 34.5,
    isc:           input.panelIsc,
    watts:         input.panelWattage ?? 400,
    tempCoeffVoc:  input.panelTempCoeffVoc,
  };
  const totalPanels = input.panelCount;
  if (!Number.isFinite(totalPanels) || totalPanels <= 0) return undefined;

  // Build equipment-db spec map for the brand's candidate models.
  const eqMap = new Map<string, StringInverter>();
  for (const ref of brand.supportedInverterModels) {
    const eq = STRING_INVERTERS.find(x => x.id === ref.equipmentDbId);
    if (eq) eqMap.set(ref.equipmentDbId, eq);
  }

  // Nothing to evaluate if the brand has no models present in equipment-db.
  if (eqMap.size === 0) return undefined;

  const result = generateFeasibleSystems({
    modelRefs:      brand.supportedInverterModels,
    equipmentSpecs: eqMap,
    panel,
    totalPanels,
    designTempMin:  input.designTempMin,
    // v47.411 — forward topology + optimizer cap for accurate feasibility report.
    topology:       brand.topology === 'optimizer' ? 'optimizer'
                  : brand.topology === 'hybrid'    ? 'hybrid'
                  : 'string',
    optimizerMaxOutputCurrent: input.optimizerMaxOutputCurrent,
  });

  const recommended = result.recommended ?? null;

  // Was the chosen model in the feasible set?
  const chosenIsFeasible = chosenEquipmentDbId == null
    ? null
    : result.recommended?.modelRef.equipmentDbId === chosenEquipmentDbId
      || result.alternatives.some(a => a.modelRef.equipmentDbId === chosenEquipmentDbId);

  // Look up the FeasibilityResult for the chosen model (for detailed display).
  let chosenResult: FeasibilityResult | undefined;
  if (chosenEquipmentDbId != null) {
    if (recommended?.modelRef.equipmentDbId === chosenEquipmentDbId) {
      chosenResult = recommended.result;
    } else {
      const alt = result.alternatives.find(
        a => a.modelRef.equipmentDbId === chosenEquipmentDbId
      );
      if (alt) chosenResult = alt.result;
    }
  }

  return {
    anyFeasible:            recommended != null,
    chosenIsFeasible,
    chosenEquipmentDbId,
    recommendedEquipmentDbId: recommended?.modelRef.equipmentDbId ?? null,
    recommendedScore:       recommended?.score ?? null,
    alternatives: result.alternatives.map(a => ({
      equipmentDbId: a.modelRef.equipmentDbId,
      score:         a.score,
      label:         a.label as 'higher_production' | 'conservative',
      dcAcRatio:     a.result.dcAcRatio,
      inverterCount: a.result.inverterCount,
    })),
    rejected:       result.rejected,
    chosenResult,
  };
}

/**
 * Fold feasibility findings into the warnings[] list. Respects user intent:
 *   - Chosen model infeasible  → ERROR warning (user must know)
 *   - Different recommendation → INFO warning (advisory only)
 *   - No feasible models at all → ERROR warning
 */
/**
 * Fold feasibility findings into the warnings[] list.
 *
 * IMPORTANT: Feasibility warnings are ADVISORY ONLY. They never escalate to
 * `error` severity because:
 *   (a) The feasibility evaluator applies stricter rules than the primary
 *       sizer (e.g. DC/AC ideal band, MPPT current stacking).
 *   (b) Existing validation flow owns `error` semantics; we do not want to
 *       retroactively break deployed designs that pass the primary sizer.
 *   (c) UI can surface `warning` + `info` to educate users without blocking
 *       workflow.
 */
function applyFeasibilityWarnings(
  report: FeasibilityReport,
  warnings: SizingWarning[],
): void {
  if (!report.anyFeasible) {
    warnings.push({
      severity: 'warning',
      code: 'FEASIBILITY_NO_VIABLE_MODEL',
      message:
        `Feasibility check: No inverter model in the selected brand scores ` +
        `as fully-feasible for this panel count and panel specs. Reasons by ` +
        `model: ` +
        report.rejected
          .map(r =>
            `${r.equipmentDbId}: ${r.failures.map(f => f.code).join(', ')}`
          )
          .join(' | '),
    });
    return;
  }

  // Chosen model is infeasible (but a different model in the same brand is).
  if (report.chosenIsFeasible === false && report.chosenEquipmentDbId) {
    const chosenFailures = report.rejected
      .find(r => r.equipmentDbId === report.chosenEquipmentDbId)
      ?.failures;
    const codes = chosenFailures?.map(f => f.code).join(', ') ?? 'unknown';
    warnings.push({
      severity: 'warning',
      code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
      message:
        `Feasibility check: Chosen inverter ${report.chosenEquipmentDbId} ` +
        `has concerns (${codes}). Recommended alternative in the same brand: ` +
        `${report.recommendedEquipmentDbId}.`,
    });
    return;
  }

  // Chosen model is feasible but not the highest-scoring — surface advisory.
  if (
    report.chosenIsFeasible === true &&
    report.recommendedEquipmentDbId &&
    report.chosenEquipmentDbId &&
    report.recommendedEquipmentDbId !== report.chosenEquipmentDbId
  ) {
    warnings.push({
      severity: 'info',
      code: 'FEASIBILITY_BETTER_CANDIDATE_AVAILABLE',
      message:
        `A better-scoring inverter is available in the same brand: ` +
        `${report.recommendedEquipmentDbId} (score ${report.recommendedScore?.toFixed(1) ?? '?'}) ` +
        `vs chosen ${report.chosenEquipmentDbId}.`,
    });
  }
}

// ─── PUBLIC API — sizeSystemFromBrand() ────────────────────────────

// ─── v47.423 — Panel Compatibility Gate helpers ─────────────────────

/**
 * Build the panelCompatibility payload attached to SystemSizingResult.
 * Pure translation from the gate's internal shape to the public contract.
 */
function buildPanelCompatibilityPayload(
  gate: PanelCompatibilityGateResult,
  originalPanelId: string,
  autoSwitched: boolean,
  effectivePanelId: string,
): NonNullable<SystemSizingResult['panelCompatibility']> {
  // Once we auto-swap, the "effective" status for the resulting design
  // is 'compatible'. Otherwise mirror the gate's verdict.
  const status: PanelBrandStatus = autoSwitched ? 'compatible' : gate.status;
  return {
    status,
    autoSwitched,
    originalPanelId,
    effectivePanelId,
    headroomPct: gate.headroomPct,
    brand:       gate.brand,
    suggestions: gate.suggestions,
    reason:      gate.reason,
  };
}

/**
 * Run the Panel Compatibility Gate. When the loaded panel is incompatible
 * with the brand, returns a cloned SizingInput that has been updated with
 * the top-suggestion panel's electrical specs so every downstream step
 * (string generator, feasibility evaluator, etc.) sees a compliant design.
 *
 * Returns undefined when the gate cannot run (no panelId, missing panel).
 */
function runPanelCompatibilityGate(
  input: SizingInput,
  brand: BrandProfile,
): {
  gate: PanelCompatibilityGateResult;
  swappedInput?: SizingInput;
  effectivePanelId: string;
} | undefined {
  if (!input.panelId) return undefined;

  const panel = SOLAR_PANELS.find(p => p.id === input.panelId);
  if (!panel) return undefined;

  const gate = evaluatePanelBrandCompatibility(panel, brand);

  // Auto-swap only on 'incompatible' AND when at least one suggestion exists.
  if (gate.status === 'incompatible' && gate.suggestions.length > 0) {
    const topId = gate.suggestions[0].id;
    const swap  = SOLAR_PANELS.find(p => p.id === topId);
    if (swap) {
      const swappedInput: SizingInput = {
        ...input,
        panelId:           swap.id,
        panelWattage:      swap.watts,
        panelVoc:          swap.voc,
        panelVmp:          swap.vmp,
        panelIsc:          swap.isc,
        panelTempCoeffVoc: swap.tempCoeffVoc,
      };
      return { gate, swappedInput, effectivePanelId: swap.id };
    }
  }

  return { gate, effectivePanelId: panel.id };
}

/**
 * v47.423 — Soften scary "no viable model" warnings when the auto-sizer
 * already rolled up to a multi-unit configuration. The feasibility
 * evaluator checks single-unit designs, so multi-unit systems often
 * show FEASIBILITY_NO_VIABLE_MODEL even when the final sized system
 * is perfectly valid. Rewrite those warnings into an informational
 * MULTI_UNIT_CONFIGURED note so the UI does not alarm the user.
 */
function softenMultiUnitFeasibilityWarnings(
  inverters: SizedInverter[],
  warnings: SizingWarning[],
): void {
  const unitCount = inverters.reduce((s, i) => s + i.qty, 0);
  if (unitCount <= 1) return;

  let softened = false;
  for (const w of warnings) {
    if (w.code === 'FEASIBILITY_NO_VIABLE_MODEL' && w.severity !== 'error') {
      w.code     = 'FEASIBILITY_ROLLED_UP_MULTI_UNIT';
      w.severity = 'info';
      softened   = true;
    }
  }

  if (softened) {
    const modelSummary = inverters
      .map(i => `${i.qty}× ${i.equipmentDbId}`)
      .join(', ');
    warnings.unshift({
      severity: 'info',
      code:     'MULTI_UNIT_CONFIGURED',
      message:
        `Auto-sized to a ${unitCount}-unit configuration (${modelSummary}). ` +
        `Single-unit feasibility checks do not apply when the design rolls ` +
        `up to multiple inverters.`,
    });
  }
}

// ─── PUBLIC API — sizeSystemFromBrand() ─────────────────────────────

/**
 * Main entry point. Takes a sizing input, returns a deterministic
 * SystemSizingResult that UI, BOM, and validation layers consume.
 */

// --- Brain Rewrite Phase 8: Layout Brain Integration -------------------
//
// getBestLayoutCandidate() is the bridge between the new layout solver
// (generateLayoutCandidates + scoreLayoutCandidate) and the legacy
// sizeInverters() path.
//
// HOW IT WORKS:
//   1. Maps the brand's BrandProfile to CapabilityProfiles (from brandCapabilities/).
//   2. Builds a LayoutGeneratorInput from the SizingInput.
//   3. Calls generateLayoutCandidates() to get all feasible candidates.
//   4. Calls selectBestLayoutCandidate() to pick the top-scored one.
//   5. Returns the selected LayoutCandidate (or null if none found).
//
// INTEGRATION:
//   sizeSystemFromBrand() calls this BEFORE sizeInverters(). If a candidate
//   is found, it pins effectiveInput.selectedInverterId to the candidate's
//   equipmentDbId so sizeInverters() uses the brain's choice.
//   If no candidate is found (e.g. brand not in brandCapabilities registry),
//   sizeInverters() continues with its legacy path unchanged.
//
// SAFETY:
//   - Never throws. Returns null on any error.
//   - Never overrides a user-selected inverter model (selectedInverterId
//     is only set when input.selectedInverterId is absent).
// -------------------------------------------------------------------------
function getBestLayoutCandidate(
  brand: BrandProfile,
  input: SizingInput,
  totalDcKw: number,
): LayoutCandidate | null {
  try {
    const profiles = getCapabilityProfilesForBrand(brand.id);
    if (profiles.length === 0) return null;

    const genInput: LayoutGeneratorInput = {
      panelCount:   input.panelCount,
      panelWattage: input.panelWattage ?? 400,
      totalDcKw,
      // Panel electrical specs (optional — enables voltage/current validation)
      panelVoc:         input.panelVoc,
      panelVmp:         input.panelVmp,
      panelIsc:         input.panelIsc,
      panelTempCoeffVoc: input.panelTempCoeffVoc,
      designTempMin:    input.designTempMin,
      // Pass topology filter so the generator only tries profiles matching brand
      topologyFilter:   brand.topology as LayoutGeneratorInput['topologyFilter'],
      // Optimizer current
      optimizerMaxOutputCurrent: input.optimizerMaxOutputCurrent,
      // Do NOT pass selectedInverterId here — we only pass it when user has
      // explicitly chosen a model (handled separately below).
    };

    // If user has explicitly chosen an inverter, constrain to that model only.
    if (input.selectedInverterId) {
      genInput.selectedInverterId = input.selectedInverterId;
    }

    const output = generateLayoutCandidates(profiles, genInput);
    return selectBestLayoutCandidate(output.candidates);
  } catch {
    // Never let the brain crash the sizing engine.
    return null;
  }
}

export function sizeSystemFromBrand(input: SizingInput): SystemSizingResult {
  const warnings: SizingWarning[] = [];

  // 1. Resolve brand
  const brand = resolveBrand(input, warnings);
  checkSystemTypeSupport(brand, input.systemType, warnings);

  // 1b. v47.423 — Panel Compatibility Gate (brand-agnostic).
  // Runs BEFORE inverter sizing so downstream steps see a compliant panel.
  let effectiveInput: SizingInput = input;
  let panelCompatibility: SystemSizingResult['panelCompatibility'] | undefined;
  if (input.panelId) {
    const gateResult = runPanelCompatibilityGate(input, brand);
    if (gateResult) {
      const autoSwitched = gateResult.swappedInput !== undefined;
      if (autoSwitched) {
        effectiveInput = gateResult.swappedInput!;
        warnings.push({
          severity: 'info',
          code:     'PANEL_AUTO_SWITCHED',
          message:  gateResult.gate.reason,
        });
      } else if (gateResult.gate.status === 'marginal') {
        warnings.push({
          severity: 'warning',
          code:     'PANEL_MARGINAL',
          message:  gateResult.gate.reason,
        });
      } else if (gateResult.gate.status === 'incompatible') {
        // Incompatible but no catalog suggestion — surface a hard warning
        warnings.push({
          severity: 'warning',
          code:     'PANEL_INCOMPATIBLE',
          message:  gateResult.gate.reason,
        });
      }
      panelCompatibility = buildPanelCompatibilityPayload(
        gateResult.gate,
        input.panelId,
        autoSwitched,
        gateResult.effectivePanelId,
      );
    }
  }

  // 2. Compute total DC kW
  const panelWattage = effectiveInput.panelWattage ?? 400;
  const totalDcKw = (effectiveInput.panelCount * panelWattage) / 1000;

  // 3a. Brain Rewrite Phase 8: Run layout solver to select best inverter model.
  //     If a candidate is found and the user hasn't pinned a specific inverter,
  //     it sets selectedInverterId so sizeInverters() uses the brain's choice.
  let selectedLayoutCandidate: LayoutCandidate | null = null;
  {
    const brainCandidate = getBestLayoutCandidate(brand, effectiveInput, totalDcKw);
    if (brainCandidate) {
      selectedLayoutCandidate = brainCandidate;
      // Only override effectiveInput.selectedInverterId when the user has NOT
      // already pinned a specific model — respect explicit user selections.
      if (!effectiveInput.selectedInverterId) {
        effectiveInput = {
          ...effectiveInput,
          selectedInverterId: brainCandidate.profile.equipmentDbId,
        };
      }
    }
  }

  // 3. Size inverters
  const inverters = sizeInverters(brand, effectiveInput, totalDcKw, warnings);
  const inverterCount = inverters.reduce((s, i) => s + i.qty, 0);

  // 4. Distribute strings / micros
  const stringInfo = distributeStrings(brand, effectiveInput, inverters, warnings);

  // 5. Size battery (gated)
  const battery = sizeBattery(brand, effectiveInput, warnings);

  // 6. Compute required BOS components
  const requiredComponents = computeRequiredComponents(
    brand,
    inverters,
    stringInfo,
    battery,
    effectiveInput,
  );

  // 7. Validate
  validateCompatibility(brand, inverters, battery, warnings);

  // 8. Phase 13.6b — Feasibility-first evaluation (advisory, non-mutating).
  // Picks the single "chosen" model (first distinct inverter) for diffing
  // against the feasibility-first recommendation.
  const chosenEquipmentDbId = inverters.length > 0 ? inverters[0].equipmentDbId : null;
  const feasibility = buildFeasibilityReport(brand, effectiveInput, chosenEquipmentDbId);
  if (feasibility) applyFeasibilityWarnings(feasibility, warnings);

  // 9. v47.423 — Soften multi-unit "no viable model" scary warnings.
  softenMultiUnitFeasibilityWarnings(inverters, warnings);

  return {
    brand: {
      id:           brand.id,
      displayName:  brand.displayName,
      manufacturer: brand.manufacturer,
    },
    topology:        brand.topology,
    inverterCount,
    inverterModels:  inverters,
    strings:         stringInfo.strings,
    microDeviceCount: stringInfo.microDeviceCount,
    acBranchCount:   stringInfo.acBranchCount,
    battery,
    requiredComponents,
    warnings,
    input,  // original input for traceability
    feasibility,
    panelCompatibility,
    selectedLayoutCandidate,
  };
}

// ─── Re-exports ────────────────────────────────────────────────────
export type { BrandProfile, TopologyFamily };