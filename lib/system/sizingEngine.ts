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

/**
 * Ratio-aware inverter tier selection (v60.0).
 *
 * Unlike the legacy pickInverterTier() — which blindly returns the tier whose
 * DC-kW window contains totalDcKw — this function scans EVERY non-micro model
 * registered in the brand, computes the DC/AC ratio at the minimum required
 * unit count, and picks the model that:
 *
 *   1. Produces a DC/AC ratio >= MIN_DC_AC_RATIO (1.00) — hard floor.
 *   2. Is closest to PREFERRED_DC_AC_RATIO_TARGET (1.25) among all candidates
 *      that pass the hard floor (in-window candidates 1.20–1.40 take priority).
 *
 * If NO model satisfies the hard floor (e.g. 4.8 kW DC array with a brand
 * whose smallest inverter is 8 kW AC), the function falls back to the legacy
 * tier lookup so the downstream feasibility / validation engine can surface
 * the constraint violation rather than silently picking a bad model.
 *
 * This function uses brand.supportedInverterModels (acKw, dcKwMax) which every
 * brand profile MUST have — making this logic universal across all brands and
 * any future onboarded brand.
 *
 * @param brand       The resolved brand profile.
 * @param tiers       The brand's sizing tier table (fallback only).
 * @param totalDcKw   Total DC array size in kW.
 * @param panelCount  Total panel count (for unitsRequired calculation).
 * @param ppu         Panels-per-unit resolver (voltage-aware).
 */
function pickRatioAwareTier(
  brand: BrandProfile,
  tiers: ReadonlyArray<InverterSizingTier>,
  totalDcKw: number,
  panelCount: number,
  ppu: (m: BrandInverterModelRef) => number,
): { ref: BrandInverterModelRef; qty: number; undersized?: boolean } | undefined {
  // Only applies to string / optimizer / hybrid topologies.
  // Micro topologies are handled separately (qty = ceil(panels / modulesPerDevice)).
  // v61.9: Also filter out active:false models. The equipment-db active flag marks
  // legacy/deactivated SKUs (e.g. EcoFlow PowerOcean EU/AU-only models).
  // pickRatioAwareTier must not recommend phantom models the UI cannot select.
  const stringModels = brand.supportedInverterModels.filter(m => {
    if ((m.modulesPerDevice ?? 0) !== 0) return false; // micro — skip
    // Check active flag against equipment-db. If the DB entry marks it inactive, skip.
    const eq = STRING_INVERTERS.find(x => x.id === m.equipmentDbId);
    if (eq && eq.active === false) return false; // explicitly inactive
    return true;
  });
  if (stringModels.length === 0) return undefined;

  // Evaluate every model: compute the minimum qty needed and the resulting ratio.
  type Candidate = { model: BrandInverterModelRef; qty: number; ratio: number };
  const candidates: Candidate[] = stringModels.map(m => {
    const qty   = unitsRequired(m, panelCount, totalDcKw, ppu(m));
    const ratio = dcAcRatio(m, qty, totalDcKw);
    return { model: m, qty, ratio };
  });

  // Step 1: candidates that satisfy the hard floor (ratio >= 1.00).
  const aboveFloor = candidates.filter(c => c.ratio >= MIN_DC_AC_RATIO);

  if (aboveFloor.length === 0) {
    // No model in this brand can produce a valid ratio for this array size.
    // Fall back to legacy tier lookup so the validation engine surfaces the issue.
    const legacyTier = pickInverterTier(tiers, totalDcKw);
    if (!legacyTier) return undefined;
    const legacyRef = brand.supportedInverterModels.find(
      m => m.equipmentDbId === legacyTier.equipmentDbId,
    );
    if (!legacyRef) return undefined;
    const legacyQty = unitsRequired(legacyRef, panelCount, totalDcKw, ppu(legacyRef));
    return { ref: legacyRef, qty: legacyQty, undersized: true };
  }

  // Step 2: among above-floor candidates, prefer those inside the preferred window.
  const inWindow = aboveFloor.filter(
    c => c.ratio >= PREFERRED_DC_AC_RATIO_MIN && c.ratio <= PREFERRED_DC_AC_RATIO_MAX,
  );
  const pool = inWindow.length > 0 ? inWindow : aboveFloor;

  // Step 3: pick the candidate closest to the target ratio (1.25).
  // Tie-break: fewer units first, then larger AC rating (more headroom), then
  // alphabetical by equipmentDbId for determinism.
  const best = pool.reduce((prev, curr) => {
    const prevDist = Math.abs(prev.ratio - PREFERRED_DC_AC_RATIO_TARGET);
    const currDist = Math.abs(curr.ratio - PREFERRED_DC_AC_RATIO_TARGET);
    if (Math.abs(currDist - prevDist) > 0.001) return currDist < prevDist ? curr : prev;
    if (curr.qty !== prev.qty) return curr.qty < prev.qty ? curr : prev;
    if (curr.model.acKw !== prev.model.acKw) return curr.model.acKw > prev.model.acKw ? curr : prev;
    return curr.model.equipmentDbId < prev.model.equipmentDbId ? curr : prev;
  });

  return { ref: best.model, qty: best.qty };
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
       // RULE 1 (v60.0): Allow unit count increase ONLY when the current selection
       // is below the hard DC/AC floor (ratio < 1.00). In that case, adding more
       // units of a smaller model is the correct real-world answer (e.g. 2× Sol-Ark
       // 8K-2P for a 9.6 kW array gives ratio 1.20 — valid vs. 1× at 0.60 — invalid).
       // When the current ratio is already >= floor, consolidation still wins (fewer
       // units = simpler BOS), so the original rule is preserved.
       if (qty > currentQty && currentRatio >= MIN_DC_AC_RATIO) continue;
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
    // v61.9: Filter active:false models before passing to feasibility evaluator.
    const activeModelRefs = brand.supportedInverterModels.filter(m => {
      if ((m.modulesPerDevice ?? 0) !== 0) return true; // micro — always include
      const eq = eqMap.get(m.equipmentDbId);
      return !(eq && (eq as any).active === false);
    });
    const bestFit = generateFeasibleSystems({
      modelRefs:      activeModelRefs,
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

    // If chosen model is feasible and not rejected — check if qty needs updating.
    // The feasibility evaluator may have found the model feasible at a different
    // inverterCount than what was passed in (e.g. tigo-tsi-3p8k-us needs qty=2 for
    // 18 panels due to MPPT current, but sizing picked qty=1). If the feasibility
    // result says a higher count is needed, update qty to match so compliance agrees.
    if (feasibleIds.has(chosenId) && !chosenIsRejected) {
      const feasibleCandidate = [bestFit.recommended, ...bestFit.alternatives]
        .find(c => c?.modelRef.equipmentDbId === chosenId);
      const feasibleQty = feasibleCandidate?.result.inverterCount ?? null;
      const resolvedQty = resolved[0].qty ?? 1;
      if (feasibleQty !== null && feasibleQty > resolvedQty) {
        // Sizing engine under-counted units for MPPT current reasons — correct it.
        warnings.push({
          severity: 'info',
          code: 'INVERTER_QTY_CORRECTED',
          message:
            `${chosenId}: sizing picked ${resolvedQty} unit${resolvedQty > 1 ? 's' : ''} but ` +
            `electrical feasibility requires ${feasibleQty} for MPPT current compliance. ` +
            `Using ${feasibleQty} unit${feasibleQty > 1 ? 's' : ''}.`,
        });
        return [{ ...resolved[0], qty: feasibleQty }];
      }
      return resolved;
    }

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
    const substituteQty = recResult.inverterCount ?? 1;
    const substitute: SizedInverter[] = [{
      equipmentDbId: recRef.equipmentDbId,
      brandId:       brand.id,
      acKw:          recRef.acKw,
      dcKwMax:       recRef.dcKwMax,
      mpptCount:     recRef.mpptCount,
      qty:           substituteQty,
    }];

    // Surface the infeasibility — failures are FeasibilityFailure objects with .code.
    const chosenRejected = bestFit.rejected.find(r => r.equipmentDbId === chosenId);
    const failureCodes = (chosenRejected?.failures ?? [])
      .map(f => f.code)
      .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

    const codesStr = failureCodes.length > 0
      ? failureCodes.join(', ')
      : 'electrical constraints not met';

    // v60.2 — Do NOT substitute when the replacement degrades DC/AC ratio below MIN.
    // Scenario: engine picks 12K-2P×1 (ratio=1.20), feasibility rejects it due to
    // Voc-constrained strings (4 strings on 2 MPPTs > 20A cap), and recommends 2×8K-2P
    // (ratio=0.90) as substitute — which then triggers DC_AC_RATIO_AC_EXCEEDS_DC error.
    // The substitute is electrically valid per feasibility but ratio-invalid per the
    // validation engine. Keep the original model and emit a softer advisory instead.
    const originalTotalAc = resolved[0].acKw * (resolved[0].qty ?? 1);
    const substituteTotalAc = recRef.acKw * substituteQty;
    const originalRatio = totalDcKw / Math.max(originalTotalAc, 0.001);
    const substituteRatio = totalDcKw / Math.max(substituteTotalAc, 0.001);

    if (originalRatio >= MIN_DC_AC_RATIO && substituteRatio < MIN_DC_AC_RATIO) {
      warnings.push({
        severity: 'info',
        code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
        message:
          `String layout advisory: ${chosenId} may have MPPT current concerns `
          + `(${codesStr}) with this panel combination at cold-temperature Voc. `
          + `Sizing engine selected ratio-optimal config. Review string layout `
          + `in the compliance tab.`,
      });
      return resolved; // keep original — ratio is better than substitute
    }

    warnings.push({
      severity: 'warning',
      code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
      message:
        `Feasibility check: Chosen inverter ${chosenId} has concerns `
        + `(${codesStr}). Recommended alternative in the same brand: `
        + `${recRef.equipmentDbId}.`,
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
      // v60.2 — Use pickRatioAwareTier (not blind pickInverterTier) for tierRec
      // so Rule 2's "brand-recommended model" comparison target is ratio-optimal.
      // pickInverterTier(14.4 kW) → 15K-2P (ratio=0.96, BELOW floor).
      // pickRatioAwareTier(14.4 kW) → 12K-2P (ratio=1.20, above floor).
      // Using the blind tier model as the target caused Rule 2 to upsize to a
      // model that still violated the ratio floor, then fell to Rule 3 returning
      // 2x8K-2P (ratio=0.90) — the same broken result.
      const tierRatioRec = pickRatioAwareTier(brand, brand.sizingTiers, totalDcKw, input.panelCount, vaPPU);
      const tierRecModel = tierRatioRec?.ref;
      // Fallback tier reference for qty calculation in Rule 2.
      const tierRec = tierRecModel
        ? brand.sizingTiers.find(t => t.equipmentDbId === tierRecModel.equipmentDbId)
        : pickInverterTier(brand.sizingTiers, totalDcKw);
      const userIsUndersizedVsTier =
        tierRecModel !== undefined &&
        tierRecModel.equipmentDbId !== ref.equipmentDbId &&
        // v60.2: compare ratio-validity, not just dcKwMax. The ratio-aware tier
        // model may have a smaller or equal AC rating but a valid ratio while the
        // user's selection is below the floor.
        (tierRecModel.dcKwMax > ref.dcKwMax ||
         (tierRatioRec !== undefined && !tierRatioRec.undersized &&
          dcAcRatio(tierRecModel, tierRatioRec.qty, totalDcKw) >= MIN_DC_AC_RATIO &&
          dcAcRatio(ref, qtySelected, totalDcKw) < MIN_DC_AC_RATIO));

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
          // Phase 14.3: Never upsize to a model the feasibility gate will reject,
          // UNLESS the candidate has a valid DC/AC ratio (>= MIN_DC_AC_RATIO at qty=1).
          // Rationale (v60.2): applyFeasibilityHardGate now has a ratio-regression guard:
          // if the gate rejects a ratio-valid candidate and would substitute a ratio-invalid
          // one (e.g. rejects 12K-2P×1 ratio=1.20 → substitutes 2×8K-2P ratio=0.90), it
          // keeps the original. Pre-filtering a ratio-valid candidate here is counter-productive:
          // Rule 1 skips 12K-2P (best ratio) and falls to Rule 3 (2×8K-2P, ratio=0.90).
          // Let ratio-valid candidates through — the gate will preserve them.
          if (feasibilityRejectedIds.has(m.equipmentDbId)) {
            const candidateRatioAt1 = dcAcRatio(m, 1, totalDcKw);
            if (candidateRatioAt1 < MIN_DC_AC_RATIO) return false;
            // ratio-valid but feasibility-rejected: allow through so applyFeasibilityHardGate
            // can apply its ratio-regression guard and keep it.
          }
          return true;
        })
        .map(m => {
          const qty   = unitsRequired(m, input.panelCount, totalDcKw, vaPPU(m));
          const ratio = dcAcRatio(m, qty, totalDcKw);
          return { model: m, qty, ratio };
        })
        // v60.2 — Sort by: (1) fewer units first, (2) ratio closest to
        // PREFERRED_DC_AC_RATIO_TARGET (1.25). Previous sort used biggest-AC-kW
        // as tiebreak which caused 30K-3P-208V (ratio=0.48) to beat 12K-2P
        // (ratio=1.20) for a 14.4 kW residential array. Ratio-proximity ensures
        // the most electrically balanced candidate wins. Deterministic final
        // tie-break: alphabetical equipmentDbId.
        .sort((a, b) => {
          if (a.qty !== b.qty) return a.qty - b.qty;
          const aDist = Math.abs(a.ratio - PREFERRED_DC_AC_RATIO_TARGET);
          const bDist = Math.abs(b.ratio - PREFERRED_DC_AC_RATIO_TARGET);
          if (Math.abs(aDist - bDist) > 0.001) return aDist - bDist;
          return a.model.equipmentDbId.localeCompare(b.model.equipmentDbId);
        });

      // Rule 1: fewer-unit candidate available → upsize to it.
      // v60.2: only consider candidates with ratio >= MIN_DC_AC_RATIO (1.00).
      // Oversized candidates (e.g. 30K-3P at ratio=0.48) that merely need fewer
      // units are not improvements — the feasibility gate rejects them and falls
      // back to the broken original config. Filter to valid-ratio candidates.
      const validCandidates = candidates.filter(c => c.ratio >= MIN_DC_AC_RATIO);
      const fewerUnitsCandidate = validCandidates.find(c => c.qty < qtySelected);
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
  // v60.0 — Ratio-aware tier selection: scan all brand models and pick the one
  // that produces a DC/AC ratio closest to PREFERRED_DC_AC_RATIO_TARGET (1.25)
  // while staying >= MIN_DC_AC_RATIO (1.00). Falls back to legacy tier lookup
  // only when no model in the brand can satisfy the hard floor.
  const ratioAwarePick = pickRatioAwareTier(brand, brand.sizingTiers, totalDcKw, input.panelCount, vaPPU);
  if (!ratioAwarePick) {
    warnings.push({
      severity: 'error',
      code: 'INVERTER_NO_TIER_MATCH',
      message: `No inverter tier in ${brand.displayName} covers ${totalDcKw.toFixed(1)} kW DC.`,
    });
    return [];
  }
  const ref = ratioAwarePick.ref;
  if (!ref) {
    warnings.push({
      severity: 'error',
      code: 'INVERTER_TIER_MODEL_MISSING',
      message: `Brand ${brand.displayName} has no model registered for ${totalDcKw.toFixed(1)} kW DC.`,
    });
    return [];
  }
    // v60.0 — If pickRatioAwareTier fell back to legacy (undersized=true), it means
    // NO model in this brand can produce a valid DC/AC ratio >= 1.00 for this array.
    // Surface a clear warning recommending micros or a larger array.
    if (ratioAwarePick.undersized) {
      const _smallestAcKw = brand.supportedInverterModels
        .filter(m => (m.modulesPerDevice ?? 0) === 0)
        .reduce((min, m) => m.acKw < min ? m.acKw : min, Infinity);
      const _smallestId = brand.supportedInverterModels
        .filter(m => (m.modulesPerDevice ?? 0) === 0)
        .find(m => m.acKw === _smallestAcKw)?.equipmentDbId ?? 'unknown';
      const _minPanelsNeeded = Math.ceil((_smallestAcKw * 1000) / (input.panelWattage ?? 400));
      warnings.push({
        severity: 'warning',
        code: 'ARRAY_UNDERSIZED_FOR_BRAND',
        message:
          `Array (${totalDcKw.toFixed(1)} kW DC, ${input.panelCount} panels) is too small for ${brand.displayName}: ` +
          `smallest model (${_smallestId}, ${_smallestAcKw} kW AC) gives DC/AC ` +
          `${(totalDcKw / Math.max(_smallestAcKw, 0.001)).toFixed(2)} — below the 1.00 floor. ` +
          `Need at least ${_minPanelsNeeded} panels for a valid ratio. ` +
          `Consider microinverters (Enphase / APsystems) for arrays under ${_minPanelsNeeded} panels.`,
      });
    }
  // qty is already computed by pickRatioAwareTier (ratio-optimised).
  const qty = ratioAwarePick.qty;

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

    // v61.11 — Compact String Packing
    //
    // MPPT count is CAPACITY, not TARGET. Unused MPPT channels are allowed.
    //
    // OLD (Phase 14.3) logic was:
    //   "find minimum p such that avg(panelShare / (mpptCount*p)) <= maxPPS"
    //   This produced 8 strings for 44 panels when avg=5.5 satisfied p=2 on
    //   a 4-MPPT inverter — far more strings than electrically necessary.
    //
    // NEW logic:
    //   Step 1. requiredStrings = ceil(panelShare / effectiveMax)
    //           — minimum number of series strings to fit all panels within voltage limit
    //   Step 2. chosenParallel = ceil(requiredStrings / totalMpptThisModel)
    //           — minimum parallel count per MPPT to provide enough slots
    //   Step 3. Clamp to [1, maxParallelPerMppt]
    //           — respect hardware ceiling; if still not enough slots, overflow is reported
    //
    // This ensures:
    //   - String length stays near effectiveMax (compact, voltage-optimal)
    //   - MPPT channels are NOT all forced to be used
    //   - Extra strings are created ONLY when required by panel count / voltage limit
    //
    // Examples:
    //   44 panels, maxPPS=10, mpptCount=4, maxParallel=2:
    //     requiredStrings = ceil(44/10) = 5
    //     chosenParallel  = ceil(5/4)   = 2  => 8 slots created
    //     BUT distributor only fills 5  => [9,9,9,9,8]  (correct)
    //   44 panels, maxPPS=13, mpptCount=4, maxParallel=2:
    //     requiredStrings = ceil(44/13) = 4
    //     chosenParallel  = ceil(4/4)   = 1  => 4 slots
    //     distributor fills 4           => [11,11,11,11]  (correct)
    //   10 panels, maxPPS=13, mpptCount=2, maxParallel=2:
    //     requiredStrings = ceil(10/13) = 1
    //     chosenParallel  = ceil(1/2)   = 1  => 2 slots
    //     distributor fills 1           => [10]  (correct, 1 MPPT idle)

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

    // Step 1: minimum strings needed to keep each string <= effectiveMax panels
    const requiredStrings = maxPPS > 0
      ? Math.ceil(panelShare / maxPPS)
      : totalMpptThisModel;

    // Step 2: minimum parallel count per MPPT to provide requiredStrings slots
    const parallelNeeded = totalMpptThisModel > 0
      ? Math.ceil(requiredStrings / totalMpptThisModel)
      : 1;

    // Step 3: clamp to hardware ceiling [1, maxParallelPerMppt]
    const chosenParallel = Math.max(1, Math.min(parallelNeeded, maxParallelPerMppt));

    // Build exactly requiredStrings slots for this model's panel share.
    // We walk MPPT channels in round-robin order so that slots are spread
    // across channels before stacking parallel strings on a single channel.
    // This ensures:
    //   - Unused MPPT channels are left idle (not forced to have a string)
    //   - Parallel strings are added only when requiredStrings > mpptCount
    //   - Total slots per model = requiredStrings (never more, never less)
    //
    // Hardware ceiling guard: if requiredStrings > totalMpptThisModel * maxParallelPerMppt,
    // cap at hardware max (overflow will be reported by the distribution loop).
    const hardwareCap = totalMpptThisModel * maxParallelPerMppt;
    // Ensure at least one slot per physical unit so every inverter carries >= 1 string.
    const slotsForThisModel = Math.min(Math.max(requiredStrings, inv.qty), hardwareCap);

    // Flat list of (physicalUnitIndex, mpptIndex) in unit-interleaved round-robin order.
    // We cycle through units before stacking parallel strings on a single MPPT, so that
    // every physical unit receives a string before any unit gets a second string.
    // Order: unit0-mppt0, unit1-mppt0, ..., unitN-mppt0,
    //        unit0-mppt1, unit1-mppt1, ..., unitN-mppt1, ...
    //        unit0-mppt0(parallel2), unit1-mppt0(parallel2), ...
    const unitMpptPairs: Array<{ physIdx: number; mpptIdx: number }> = [];
    for (let p = 0; p < maxParallelPerMppt; p++) {
      for (let mppt = 0; mppt < inv.mpptCount; mppt++) {
        for (let instanceIdx = 0; instanceIdx < inv.qty; instanceIdx++) {
          const physIdx = physicalUnitCounter + instanceIdx;
          unitMpptPairs.push({ physIdx, mpptIdx: mppt });
        }
      }
    }
    physicalUnitCounter += inv.qty;

    for (let s = 0; s < slotsForThisModel; s++) {
      const pair = unitMpptPairs[s % unitMpptPairs.length];
      slots.push({
        modelIndex: modelIdx,
        physicalUnitIndex: pair.physIdx,
        mpptIndex: pair.mpptIdx,
        minPPS,
        maxPPS,
      });
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
    // v60.2 — If the ratio-regression guard in applyFeasibilityHardGate already emitted
    // an info-level FEASIBILITY_CHOSEN_INFEASIBLE advisory (meaning it kept the chosen
    // model because the substitute would degrade DC/AC ratio below MIN_DC_AC_RATIO),
    // do NOT add a second blocking warning-level advisory here. The user has already
    // been informed via the info advisory, and the chosen model has a better DC/AC ratio.
    const alreadyHasInfoAdvisory = warnings.some(
      w => w.code === 'FEASIBILITY_CHOSEN_INFEASIBLE' && w.severity === 'info',
    );
    if (alreadyHasInfoAdvisory) return;

    const chosenFailures = report.rejected
      .find(r => r.equipmentDbId === report.chosenEquipmentDbId)
      ?.failures;
    const codes = chosenFailures?.map(f => f.code).join(', ') ?? 'unknown';
    warnings.push({
      severity: 'warning',
      code: 'FEASIBILITY_CHOSEN_INFEASIBLE',
      message:
        `Feasibility check: Chosen inverter ${report.chosenEquipmentDbId} `
        + `has concerns (${codes}). Recommended alternative in the same brand: `
        + `${report.recommendedEquipmentDbId}.`,
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