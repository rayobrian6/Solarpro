// ============================================================================
// lib/system/feasibilityEvaluator.ts — Phase 13.5
//
// FEASIBILITY-FIRST SIZING
//
// Converts the sizing engine from "pick by DC tier, validate later" into
// "evaluate every candidate against every constraint FIRST, then score the
// survivors." A system is recommended only if it is physically buildable
// AND electrically valid in the real world.
//
// PIPELINE (order matters — fail-fast):
//   1. Voltage range check         → string-voltage feasibility
//   2. Per-string current check    → single-string won't exceed MPPT cap
//   3. Inverter count (DC + panels) → min units needed
//   4. String-layout plan           → how strings are built (from string-generator math)
//   5. MPPT allocation              → can strings actually land on channels?
//   6. DC/AC ratio                  → within acceptable band
//
// CONTRACT:
//   • Pure function (no I/O, no mutation of inputs).
//   • Reuses existing mpptAllocator — never duplicates its logic.
//   • Reuses existing string-generator math (delegated via helpers).
//   • Returns structured FeasibilityResult with per-check flags and codes.
//
// NOT A REPLACEMENT for sizeSystemFromBrand() — a sibling that callers can
// use to pre-filter candidates before running the heavier sizing pipeline.
// ============================================================================

import { distributeStringsAcrossMpptsSafely } from './mpptAllocator';
import type { BrandInverterModelRef } from './brandProfiles/types';
import type { StringInverter } from '../equipment-db';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Acceptable DC/AC ratio band. Below / above → reject outright. */
export const DC_AC_ACCEPTABLE_MIN = 0.9;
// v61.9: Raised from 1.55 → 2.00.
// 1.55 was rejecting the EcoFlow OCEAN Pro 11.5 kW (ratio 1.683 for 19.36 kW DC)
// and every other hybrid inverter in the 1.55–2.00 range.
// The 1.55 threshold is an ECONOMIC warning, NOT an electrical invalidity boundary.
// Electrical invalidity is voltage/current-based; DC/AC ratio only governs clipping.
// The feasibility evaluator's job is to find physically buildable configurations.
// Economic clipping is surfaced as a warning by validationEngine / ValidationPanel.
// Threshold 2.00 matches validationEngine's DC_AC_RATIO_SEVERE (error) boundary —
// above 2.00 the system is so clipped it's not viable as a recommendation.
export const DC_AC_ACCEPTABLE_MAX = 2.00;

/** Ideal DC/AC band. Outside this but inside acceptable → score penalty. */
export const DC_AC_IDEAL_MIN = 1.1;
export const DC_AC_IDEAL_MAX = 1.4;

/**
 * v61.9 — Clipping severity bands for feasibility scoring and UI display.
 * These are advisory thresholds; they do NOT cause feasibility rejection.
 *   ≤ 1.30: normal / pass
 *   1.30–1.55: mild oversize / info
 *   1.55–1.75: warning / aggressive oversize
 *   1.75–2.00: severe clipping warning
 *   > 2.00: critical — reject as infeasible (DC_AC_ACCEPTABLE_MAX boundary)
 */
export const DC_AC_CLIPPING = {
  NORMAL_MAX:   1.30,  // ≤ this: no clipping concern
  MILD_MAX:     1.55,  // ≤ this: mild oversize / info
  WARNING_MAX:  1.75,  // ≤ this: aggressive oversize / warning
  SEVERE_MAX:   2.00,  // ≤ this: severe clipping / strong recommendation to upsize
  // > SEVERE_MAX: reject outright (DC_AC_ACCEPTABLE_MAX)
} as const;

/** Returns the clipping severity label for a given DC/AC ratio. */
export function dcAcClippingSeverity(ratio: number): 'normal' | 'mild' | 'warning' | 'severe' | 'critical' {
  if (ratio <= DC_AC_CLIPPING.NORMAL_MAX)  return 'normal';
  if (ratio <= DC_AC_CLIPPING.MILD_MAX)    return 'mild';
  if (ratio <= DC_AC_CLIPPING.WARNING_MAX) return 'warning';
  if (ratio <= DC_AC_CLIPPING.SEVERE_MAX)  return 'severe';
  return 'critical';
}

/** Default parallel strings per MPPT when brand / equipment-db is silent. */
export const DEFAULT_PARALLEL_STRINGS_PER_MPPT = 2;

/**
 * v47.411 — Default optimizer max output current when not supplied.
 * Covers all shipping SolarEdge P-series + Tigo TS4-A-O SKUs (all regulate to 15.0A).
 * Matches the defaults used in lib/string-generator.ts and lib/computed-system.ts.
 */
export const DEFAULT_OPTIMIZER_MAX_OUTPUT_CURRENT = 15.0;

/**
 * v47.411 — Topology discriminator for per-string design-current method.
 * - 'string' / 'hybrid' / undefined → NEC 690.8(A)(1): panel Isc × 1.25 (panel method)
 * - 'optimizer'                    → NEC 690.8(A)(2): optimizer regulated output cap
 * - 'micro' never reaches the feasibility evaluator (no MPPT string constraints)
 */
export type FeasibilityTopology = 'string' | 'optimizer' | 'hybrid';

// ─── Input / output types ───────────────────────────────────────────────────

export interface PanelElectricalSpecs {
  voc: number;           // V at STC
  vmp: number;           // V at STC
  isc: number;           // A at STC
  watts: number;         // W at STC
  tempCoeffVoc: number;  // %/°C (negative)
  tempCoeffVmp?: number; // %/°C (negative) — defaults to tempCoeffVoc
}

export interface InverterElectricalSpecs {
  /** Model id (e.g. 'se-11400h'). Used only for diagnostics. */
  equipmentDbId: string;
  acKw: number;
  dcKwMax: number;
  mpptCount: number;
  maxDcVoltage: number;
  mpptVoltageMin: number;
  mpptVoltageMax: number;
  /**
   * v47.415 — Nominal DC input voltage (V) the inverter holds on its DC bus
   * at operation. Used ONLY for optimizer topology to compute per-string
   * OPERATING current (stringPowerW / nominalDcVoltage) for the MPPT
   * allocator. Falls back to mpptVoltage midpoint when omitted.
   */
  nominalDcVoltage?: number;
  maxInputCurrentPerMppt?: number;
  /**
   * v47.421 — For optimizer topology: the actual DC input connector/fuse rating
   * per MPPT channel for parallel strings. This is the real per-channel current
   * limit (e.g. SE11400H: 45A = 3 strings × 15A optimizer cap).
   * Distinct from maxInputCurrentPerMppt (30.5A) which is the inverter's own
   * steady-state draw (= acKw / nominalDcV) — NOT the string-input current cap.
   */
  maxShortCircuitCurrentPerMppt?: number;
  maxParallelStringsPerMppt?: number;
  minPanelsPerString?: number;
  maxPanelsPerString?: number;
}

export interface FeasibilityInput {
  inverter: InverterElectricalSpecs;
  panel: PanelElectricalSpecs;
  totalPanels: number;
  /** Design-min ambient temp (°C). Default: -10 °C. */
  designTempMin?: number;

  /**
   * v47.411 — DC topology. Controls how per-string design current is computed:
   *   'string' | 'hybrid' | undefined  -> panel Isc x 1.25   (NEC 690.8(A)(1))
   *   'optimizer'                      -> optimizerMaxOutputCurrent (NEC 690.8(A)(2))
   *
   * Defaults to 'string' (backwards compatible — panel method). Callers that
   * know they are sizing an optimizer inverter (SolarEdge, SolarEdge+Tigo)
   * MUST pass 'optimizer' or the evaluator will reject feasible systems by
   * overstating per-string current.
   */
  topology?: FeasibilityTopology;

  /**
   * v47.411 — Optimizer regulated output cap (A), used only when
   * topology === 'optimizer'. Defaults to DEFAULT_OPTIMIZER_MAX_OUTPUT_CURRENT
   * (15.0A, covers SolarEdge P-series + Tigo TS4-A-O). Override when the
   * selected optimizer SKU has a different nameplate max output current.
   */
  optimizerMaxOutputCurrent?: number;
}

export type FeasibilityFailureCode =
  | 'INVERTER_MPPT_RANGE_INCOMPATIBLE'
  | 'STRING_VOC_EXCEEDS_MAX'
  | 'STRING_VMP_BELOW_MIN'
  | 'PER_STRING_CURRENT_EXCEEDS_MPPT_CAP'
  | 'MPPT_ALLOCATION_INVALID'
  | 'MPPT_CURRENT_EXCEEDED'
  | 'MPPT_PARALLEL_CAP_EXCEEDED'
  | 'DC_AC_RATIO_OUT_OF_BAND'
  | 'PANEL_COUNT_ZERO_OR_NEGATIVE';

export interface FeasibilityFailure {
  code: FeasibilityFailureCode;
  message: string;
}

export interface FeasibilityStringPlan {
  /** Zero-based index of the string. */
  index: number;
  /** Panels on this string. */
  panelCount: number;
  /** Computed string Voc at designTempMin (V). */
  stringVocCold: number;
  /** Computed string Vmp at designTempMin (V). */
  stringVmpCold: number;
  /** Per-string design current — Isc × 1.25 (A). */
  designCurrent: number;
}

export interface FeasibilityResult {
  /** Final pass/fail. True iff every check below is true. */
  valid: boolean;

  /** Per-check flags (all must be true for valid=true). */
  stringVoltageValid: boolean;
  mpptVoltageValid: boolean;
  mpptCurrentValid: boolean;
  allocationValid: boolean;
  dcAcValid: boolean;

  /** Planned string layout (empty if voltage checks fail early). */
  stringConfigs: FeasibilityStringPlan[];

  /** Raw allocator output (undefined if we short-circuited earlier). */
  mpptAllocation?: ReturnType<typeof distributeStringsAcrossMpptsSafely>;

  /** Computed metrics. */
  dcAcRatio: number;
  inverterCount: number;
  panelsPerString: number;
  totalStrings: number;

  /** Structured failure list (empty iff valid=true). */
  failures: FeasibilityFailure[];

  /** Numeric headroom measurements for scoring. */
  headroom: {
    /** Max of (1 - stringVoc/maxDcVoltage) across strings. 0..1; higher is safer. */
    voltageMarginPct: number;
    /** 1 - maxBinCurrent/mpptMaxInputCurrent. 0..1; higher is safer. */
    currentMarginPct: number;
  };
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function evaluateInverterFeasibility(
  input: FeasibilityInput
): FeasibilityResult {
  const {
    inverter,
    panel,
    totalPanels,
    designTempMin = -10,
    topology = 'string',
    optimizerMaxOutputCurrent,
  } = input;

  const failures: FeasibilityFailure[] = [];

  // v47.411 — Topology-aware effective panel Isc for downstream allocator math.
  // The allocator compares each string's `designCurrent` against the MPPT cap.
  // For optimizer systems the per-string current is regulated by the optimizer
  // (NEC 690.8(A)(2)), not the panel (NEC 690.8(A)(1)). We express this by
  // substituting the optimizer cap for panel.isc whenever topology='optimizer',
  // so both the per-string pre-check (line ~192) and the allocator receive the
  // same regulated number — single source of truth, no downstream branching.
  const isOptimizer = topology === 'optimizer';
  const optimizerCap =
    optimizerMaxOutputCurrent != null && optimizerMaxOutputCurrent > 0
      ? optimizerMaxOutputCurrent
      : DEFAULT_OPTIMIZER_MAX_OUTPUT_CURRENT;
  // `effectiveIsc` is the current the allocator sees per string. For optimizer
  // topology it's already "regulated output" (no extra 1.25 multiplier — the
  // optimizer nameplate already accounts for continuous-duty output). For
  // string/hybrid we keep legacy semantics (panel.isc is pre-multiplier; the
  // 1.25 is applied below when computing designCurrent).
  const effectiveIsc = isOptimizer ? optimizerCap : panel.isc;

  // ── Guard: panel count ────────────────────────────────────────────────
  if (!Number.isFinite(totalPanels) || totalPanels <= 0) {
    failures.push({
      code: 'PANEL_COUNT_ZERO_OR_NEGATIVE',
      message: `totalPanels must be a positive number (got ${totalPanels}).`,
    });
    return earlyFailure(input, failures);
  }

  // ── Cold-temperature voltage correction (NEC 690.7) ──────────────────
  const deltaT = designTempMin - 25;
  const vocCold = panel.voc * (1 + (panel.tempCoeffVoc / 100) * deltaT);
  const vmpCold =
    panel.vmp *
    (1 + ((panel.tempCoeffVmp ?? panel.tempCoeffVoc) / 100) * deltaT);
  // Hot Vmp (75°C cell) — worst case for the MPPT LOWER bound. Vmp drops when
  // hot, so min string length and any mpptVoltageMin check must use hot Vmp, not
  // cold. 75°C matches layoutCandidateGenerator + string-generator so all three
  // sizers agree. (Engineering audit 2026-06-19, finding C1.)
  const vmpHot =
    panel.vmp *
    (1 + ((panel.tempCoeffVmp ?? panel.tempCoeffVoc) / 100) * (75 - 25));

  // ── String-length window ──────────────────────────────────────────────
  // v47.411 — Optimizer topology: string Voc/Vmp is regulated by the optimizer
  // to the inverter's fixed bus voltage (SafeDC ~1V at open circuit, ~60V
  // operating). The brand profile's min/maxPanelsPerString (typically [8, 25]
  // for SolarEdge) is the authoritative ceiling. Applying panel-Voc math here
  // would falsely restrict long strings (e.g. 36 panels × 400W / 2 optimizer
  // inverters is feasible at 18 panels/string × 2 strings, but panel-Voc math
  // at -10 °C clamps to 10 panels and forces 4 strings — blowing the MPPT
  // current budget downstream).
  const maxPanelsByVoc = isOptimizer
    ? Number.POSITIVE_INFINITY
    : Math.floor(inverter.maxDcVoltage / Math.max(vocCold, 0.001));
  const minPanelsByVmp = isOptimizer
    ? 1
    : Math.ceil(inverter.mpptVoltageMin / Math.max(vmpHot, 0.001)); // hot Vmp — C1

  // v47.415 — Nominal DC bus voltage for operating-current math.
  // SolarEdge HD-Wave holds bus at 400V nominal (per datasheet + Application
  // Note "String Sizing for SolarEdge Inverters"). If model data is missing,
  // we fall back to the midpoint of the MPPT window. The midpoint is a
  // conservative-higher approximation that produces conservative-LOWER
  // operating currents, which is safe (allocator may reject slightly more
  // edge cases but will never over-accept).
  const nominalDcV =
    isOptimizer && inverter.nominalDcVoltage && inverter.nominalDcVoltage > 0
      ? inverter.nominalDcVoltage
      : (inverter.mpptVoltageMin + inverter.mpptVoltageMax) / 2;

  const modelMin = inverter.minPanelsPerString ?? 1;
  const modelMax = inverter.maxPanelsPerString ?? (isOptimizer ? 25 : maxPanelsByVoc);

  // v47.421 — For optimizer topology, cap effectiveMax to the full-power string
  // ceiling: floor(maxStringPower / panelWatts) where
  //   maxStringPower = nominalDcV × optimizerCap (e.g. 380V × 15A = 5,700W).
  //
  // Strings above this threshold have optimizers in saturation (clipping losses)
  // and are allowed by the brand profile (ceiling=25), but produce sub-optimal
  // configurations like [25,11] where 11kW is wasted to clipping.
  //
  // By capping effectiveMax here, the search starts at the last full-power panel
  // count (e.g. 14 for 400W panels) and descends, finding balanced full-power
  // layouts like [12,12,12] for 36 panels instead of [25,11].
  //
  // The absolute brand-profile ceiling (modelMax=25) remains the legal upper bound
  // but the search window is pre-filtered to the energy-optimal range.
  const maxFullPowerPanels = isOptimizer && panel.watts > 0
    ? Math.floor((nominalDcV * optimizerCap) / panel.watts)
    : modelMax;
  const effectiveSearchMax = isOptimizer
    ? Math.min(modelMax, maxFullPowerPanels)
    : modelMax;

  const effectiveMin = Math.max(modelMin, minPanelsByVmp, 1);
  const effectiveMax = Math.min(effectiveSearchMax, maxPanelsByVoc);

  if (effectiveMax < effectiveMin) {
    failures.push({
      code: 'INVERTER_MPPT_RANGE_INCOMPATIBLE',
      message:
        `Inverter ${inverter.equipmentDbId} MPPT voltage range is incompatible with ` +
        `this panel: max-by-Voc=${maxPanelsByVoc} panels, min-by-Vmp=${minPanelsByVmp} panels. ` +
        `No valid string length exists at design temp ${designTempMin}°C.`,
    });
    return earlyFailure(input, failures);
  }

  // ── Per-string current check (before trying string lengths) ─────────
  // v47.411 — Topology-aware design current (single source of truth):
  //   string / hybrid -> NEC 690.8(A)(1): panel Isc x 1.25 (panel method)
  //   optimizer       -> NEC 690.8(A)(2): optimizer cap    (regulated output)
  // The optimizer cap is the regulated nameplate max output — already a
  // continuous-duty value, so no additional 1.25 factor is applied.
  const designCurrent = isOptimizer ? optimizerCap : panel.isc * 1.25;


  // v47.415 — Compute per-string OPERATING current for a given string length.
  // Used for MPPT allocator feasibility (NOT NEC conductor sizing).
  //
  // Research source: SolarEdge "String Sizing for SolarEdge Inverters"
  // Application Note:
  //   Max string power = nominalDcVoltage × optimizerMaxOutputCurrent
  //   (e.g. SE7600H: 400V × 15A = 6,000W max per string)
  // The 15A optimizer nameplate is reached ONLY at max string power.
  // A 9 × 400W string on SE7600H operates at 3,600W / 400V = 9A, NOT 15A.
  //
  // Pre-v47.415 the allocator used 15A per string for all string lengths,
  // which wrongly rejected 36-panels-on-2×SE7600H (4 × 15A = 60A infeasible
  // on 2 × 20A channels) when the real numbers are 4 × 9A = 36A total,
  // 2 × 9A = 18A per inverter channel (safely under 20A).
  const operatingCurrentForStringLength = (pps: number): number => {
    if (!isOptimizer) return designCurrent; // non-optimizer: NEC panel method
    const stringPowerW = pps * panel.watts;
    const op = stringPowerW / Math.max(nominalDcV, 1e-6);
    return Math.min(optimizerCap, op);
  };

  if (
    inverter.maxInputCurrentPerMppt !== undefined &&
    designCurrent > inverter.maxInputCurrentPerMppt + 1e-6
  ) {
    failures.push({
      code: 'PER_STRING_CURRENT_EXCEEDS_MPPT_CAP',
      message:
        `Per-string design current ${designCurrent.toFixed(2)}A exceeds ` +
        `inverter ${inverter.equipmentDbId} MPPT max input current ` +
        `${inverter.maxInputCurrentPerMppt.toFixed(1)}A. Even a single string ` +
        `cannot be safely placed on a channel.`,
    });
    return earlyFailure(input, failures, {
      stringVoltageValid: true,
      mpptVoltageValid: true,
      mpptCurrentValid: false,
      panelsPerString: 0,
    });
  }

  const parallelPerMppt =
    inverter.maxParallelStringsPerMppt ?? DEFAULT_PARALLEL_STRINGS_PER_MPPT;
  const totalDcKw = (totalPanels * panel.watts) / 1000;
  const mpptCenter = (inverter.mpptVoltageMin + inverter.mpptVoltageMax) / 2;
  const centerTargetPanels = clamp(
    Math.round(mpptCenter / panel.vmp),
    effectiveMin,
    effectiveMax
  );

  // ── Search for a valid string length ─────────────────────────────────
  // Strategy: try lengths from effectiveMax DESC to effectiveMin. Longer
  // strings → fewer total strings → easier MPPT allocation. First valid
  // wins. Track best invalid attempt for diagnostic quality.
  type Attempt = {
    panelsPerString: number;
    stringPanelCounts: number[];
    inverterCount: number;
    allocation: ReturnType<typeof distributeStringsAcrossMpptsSafely>;
  };

  let best: Attempt | null = null;

  // Upper bound on how many inverters we are willing to try. Escalating
  // unit count is only legitimate when 1 unit naturally leaves headroom
  // (i.e. the DC/AC ratio with 1 unit is high). If 1 unit already yields
  // DC/AC ≤ IDEAL_MAX, we don't escalate at all — doing so would drive the
  // ratio below IDEAL_MIN. This prevents gaming tiny inverters into being
  // "feasible" by stacking many units.
  const singleUnitRatio = totalDcKw / Math.max(inverter.acKw, 1e-6);
  const maxUnitsByRatio =
    singleUnitRatio > DC_AC_IDEAL_MAX
      ? Math.max(1, Math.floor(totalDcKw / (inverter.acKw * DC_AC_IDEAL_MIN)))
      : 1;

  // v47.420 — Optimizer string power / clipping note (replaces v47.415).
  //
  // The SolarEdge "String Sizing" AppNote formula
  //   max string power = nominalDcVoltage × optimizerMaxOutputCurrent
  // describes the power level at which the optimizer OUTPUT is capped — NOT
  // the maximum allowed string length. Strings longer than this threshold
  // operate with optimizers in saturation (output regulated to ≤ 15 A), which
  // is the NORMAL operating mode for SolarEdge systems and is explicitly
  // permitted by the brand profile's maxPanelsPerString (up to 25).
  //
  // Rejecting strings above 6000 W (≥ 16 panels × 400 W) is therefore WRONG:
  //   • It contradicts the brand-profile ceiling of 25 panels/string.
  //   • It forces 36-panel systems into configurations with too many short
  //     strings (e.g. [9,9,9,9]) whose combined operating current exceeds the
  //     MPPT cap and causes every SE model to be falsely rejected.
  //   • The MPPT current allocator already enforces the real constraint:
  //     Σ(operatingCurrentForStringLength) ≤ maxInputCurrentPerMppt.
  //
  // We keep maxStringPowerW as POSITIVE_INFINITY for optimizer topology so
  // the string-length search reaches all lengths in [effectiveMin, effectiveMax].
  // The allocator's operating-current math is the single source of truth for
  // per-channel current safety.
  const maxStringPowerW = Number.POSITIVE_INFINITY; // optimizer clipping is NOT a reject criterion

  outer: for (let pps = effectiveMax; pps >= effectiveMin; pps--) {
    const sVoc = vocCold * pps;       // cold — for the max-voltage reject below
    const sVmp = vmpHot * pps;         // hot — for the MPPT-min reject below (C1)
    // v47.411 — Skip per-string voltage constraints for optimizer topology.
    // See the String-length window block above for rationale: each optimizer
    // regulates its panel output, so string Voc/Vmp is independent of panel
    // count. Brand-profile min/maxPanelsPerString is the authoritative bound.
    if (!isOptimizer) {
      if (sVoc > inverter.maxDcVoltage) continue;
      if (sVmp < inverter.mpptVoltageMin) continue;
    }

    // v47.420 — maxStringPowerW is POSITIVE_INFINITY for optimizer topology;
    // this guard is kept for non-optimizer branches (always false for optimizer).
    if (!isOptimizer && pps * panel.watts > maxStringPowerW + 1e-6) continue;

    const stringPanelCounts = buildStringPanelCounts(totalPanels, pps, effectiveMin);

    // v47.415 — For optimizer topology, reject string splits that leave
    // any string below the brand minimum (e.g. SolarEdge requires ≥ 8
    // optimizers/string). The pre-v47.415 behaviour (accept + warn) is
    // acceptable for tolerant string inverters but produces sub-min
    // SolarEdge strings like [15, 15, 6] — which the datasheet forbids.
    // Trying a smaller pps will eventually find a balanced layout
    // (e.g. 36 panels → pps=9 → [9,9,9,9], all ≥ 8). If no pps satisfies,
    // the loop falls through to the existing fallback.
    if (isOptimizer && stringPanelCounts.some(c => c < effectiveMin)) continue;
    const panelsPerUnit = Math.max(1, inverter.mpptCount * parallelPerMppt * pps);
    const unitsByDc = Math.max(1, Math.ceil(totalDcKw / inverter.dcKwMax));
    const unitsByPanels = Math.max(1, Math.ceil(totalPanels / panelsPerUnit));
    // v60.2 — Also factor MPPT current constraints into minUnits.
    // If DC/panel capacity says 1 unit but MPPT current requires more channels
    // (e.g. 4 strings need 4 MPPTs but 1 unit only has 2), the loop must try
    // additional units. Without this, 12K-2P is rejected for 36-panel arrays
    // at -10C because 1 unit cannot spread 4 strings across 2 MPPTs within
    // the 20A cap, while 2x12K-2P (4 MPPTs, 1 string each) passes fine.
    let unitsByMpptCurrent = 1;
    if (!isOptimizer && inverter.maxInputCurrentPerMppt && inverter.maxInputCurrentPerMppt > 0) {
      const numStringsNeeded = stringPanelCounts.length;
      const strPerMppt1Unit = Math.ceil(numStringsNeeded / inverter.mpptCount);
      const currPerMppt1Unit = Math.min(strPerMppt1Unit, parallelPerMppt) * designCurrent;
      if (currPerMppt1Unit > inverter.maxInputCurrentPerMppt + 1e-6) {
        // Find minimum units where current fits within cap — but only escalate
        // if the ratio at that unit count remains within the acceptable band.
        // If escalating would tank DC/AC below DC_AC_ACCEPTABLE_MIN (e.g. Fronius
        // 10kW x2 for 14.4 kW DC gives ratio 0.72), keep unitsByMpptCurrent=1 and
        // let the allocation fail naturally so the correct MPPT failure is surfaced.
        for (let u = 2; u <= 8; u++) {
          const mppts = u * inverter.mpptCount;
          const strPerMppt = Math.ceil(numStringsNeeded / mppts);
          const curr = Math.min(strPerMppt, parallelPerMppt) * designCurrent;
          if (curr <= inverter.maxInputCurrentPerMppt + 1e-6) {
            // Only apply escalation if ratio stays within acceptable band
            const ratioAtU = totalDcKw / Math.max(inverter.acKw * u, 1e-6);
            if (ratioAtU >= DC_AC_ACCEPTABLE_MIN - 1e-6) {
              unitsByMpptCurrent = u;
            }
            // Either way, stop searching — this is the minimum current-safe count
            break;
          }
        }
      }
    }
    const minUnits = Math.max(unitsByDc, unitsByPanels, unitsByMpptCurrent);

    // Try minimum-first; escalate unit count only if allocation fails and
    // DC/AC headroom still permits it. We ALWAYS try at least minUnits
    // (driven by DC / panel / MPPT-current capacity) even if that exceeds
    // maxUnitsByRatio — the DC/AC gate at the end will reject the candidate
    // if it truly over-sizes. But never escalate BEYOND minUnits past ratio cap.
    const upperUnits = Math.max(minUnits, maxUnitsByRatio);
    for (let units = minUnits; units <= upperUnits; units++) {
      const totalMpptChannels = units * inverter.mpptCount;

      const alloc = distributeStringsAcrossMpptsSafely({
        strings: stringPanelCounts.map((pc, idx) => ({
          id: String(idx),
          panelCount: pc,
          voc: vocCold * pc,
          isc: effectiveIsc,
          // v47.415/421 — allocator uses OPERATING current (stringPower/busV)
          // for per-channel current sum check. This correctly models that a
          // 12-panel string on 380V bus draws 12×400/380 = 12.63A (not 15A flat).
          // The channel limit uses maxShortCircuitCurrentPerMppt (see below).
          designCurrent: operatingCurrentForStringLength(pc),
        })),
        mpptCount: totalMpptChannels,
        // v47.421: for optimizer topology, the MPPT channel current limit is
        // maxShortCircuitCurrentPerMppt (45A = 3×15A), not maxInputCurrentPerMppt
        // (30.5A = inverter's own draw). Using the wrong limit rejects [12,12,12].
        mpptMaxInputCurrent: isOptimizer
          ? (inverter.maxShortCircuitCurrentPerMppt ?? inverter.maxInputCurrentPerMppt)
          : inverter.maxInputCurrentPerMppt,
        maxParallelStringsPerMppt: parallelPerMppt,
      });

      const candidate: Attempt = {
        panelsPerString: pps,
        stringPanelCounts,
        inverterCount: units,
        allocation: alloc,
      };

      if (alloc.valid) {
        best = candidate;
        break outer;
      }
      if (!best || alloc.violations.length < best.allocation.violations.length) {
        best = candidate;
      }
    }
  }

  // Nothing fit even voltage-wise → diagnostic failure.
  if (!best) {
    const diagnosticPps = centerTargetPanels;
    const stringVocColdDiag = vocCold * diagnosticPps;
    if (stringVocColdDiag > inverter.maxDcVoltage) {
      failures.push({
        code: 'STRING_VOC_EXCEEDS_MAX',
        message:
          `No string length in [${effectiveMin}..${effectiveMax}] fits within ` +
          `inverter max DC voltage ${inverter.maxDcVoltage}V at ${designTempMin}°C.`,
      });
    } else {
      failures.push({
        code: 'STRING_VMP_BELOW_MIN',
        message:
          `No string length in [${effectiveMin}..${effectiveMax}] reaches MPPT ` +
          `minimum ${inverter.mpptVoltageMin}V.`,
      });
    }
    return earlyFailure(input, failures, {
      stringVoltageValid: stringVocColdDiag <= inverter.maxDcVoltage,
      mpptVoltageValid: vmpHot * diagnosticPps >= inverter.mpptVoltageMin, // hot Vmp — C1
      mpptCurrentValid: true,
      panelsPerString: diagnosticPps,
    });
  }

  const { panelsPerString, stringPanelCounts, inverterCount, allocation } = best;
  const stringVocCold = vocCold * panelsPerString;
  const stringVmpCold = vmpCold * panelsPerString;

  // v47.411 — Optimizer topology: string Voc/Vmp at the inverter is regulated
  // by the optimizer bus voltage, NOT the sum of panel Voc/Vmp. These flags
  // are unconditionally valid for optimizer systems (real constraint is the
  // brand-profile min/maxPanelsPerString, enforced via the search window).
  const stringVoltageValid = isOptimizer ? true : stringVocCold <= inverter.maxDcVoltage;
  const mpptVoltageValid = isOptimizer ? true : stringVmpCold >= inverter.mpptVoltageMin;
  const mpptCurrentValid = true; // pre-checked above
  const totalStrings = stringPanelCounts.length;

  // Collect allocation failures (if any). If the search loop couldn't find
  // a valid allocation for any string length, surface the violations.
  const allocationValid = allocation.valid;
  if (!allocation.valid) {
    for (const v of allocation.violations) {
      if (v.code === 'MPPT_CURRENT_UNKNOWN') continue; // advisory only
      failures.push({
        code: v.code as FeasibilityFailureCode,
        message: `[MPPT] ${v.message}`,
      });
    }
  }

  // ── DC/AC ratio ───────────────────────────────────────────────────────
  const totalAcKw = inverter.acKw * inverterCount;
  const dcAcRatio = totalDcKw / Math.max(totalAcKw, 1e-6);
  const dcAcValid =
    dcAcRatio >= DC_AC_ACCEPTABLE_MIN - 1e-6 &&
    dcAcRatio <= DC_AC_ACCEPTABLE_MAX + 1e-6;
  if (!dcAcValid) {
    failures.push({
      code: 'DC_AC_RATIO_OUT_OF_BAND',
      message:
        `DC/AC ratio ${dcAcRatio.toFixed(2)} is outside acceptable band ` +
        `[${DC_AC_ACCEPTABLE_MIN}, ${DC_AC_ACCEPTABLE_MAX}]. ` +
        `Adjust inverter count or model to match system DC (${totalDcKw.toFixed(2)} kW).`,
    });
  }

  // ── Headroom / scoring inputs ────────────────────────────────────────
  const voltageMarginPct = Math.max(
    0,
    1 - stringVocCold / Math.max(inverter.maxDcVoltage, 1e-6)
  );
  const maxBinCurrent = allocation.allocation.reduce(
    (m, b) => Math.max(m, b.totalDesignCurrent),
    0
  );
  const currentMarginPct =
    inverter.maxInputCurrentPerMppt !== undefined
      ? Math.max(0, 1 - maxBinCurrent / Math.max(inverter.maxInputCurrentPerMppt, 1e-6))
      : 0;

  const stringConfigs: FeasibilityStringPlan[] = stringPanelCounts.map((pc, idx) => ({
    index: idx,
    panelCount: pc,
    stringVocCold: vocCold * pc,
    stringVmpCold: vmpCold * pc,
    designCurrent,
  }));

  const valid =
    stringVoltageValid &&
    mpptVoltageValid &&
    mpptCurrentValid &&
    allocationValid &&
    dcAcValid;

  return {
    valid,
    stringVoltageValid,
    mpptVoltageValid,
    mpptCurrentValid,
    allocationValid,
    dcAcValid,
    stringConfigs,
    mpptAllocation: allocation,
    dcAcRatio,
    inverterCount,
    panelsPerString,
    totalStrings,
    failures,
    headroom: { voltageMarginPct, currentMarginPct },
  };
}

// ─── Multi-candidate evaluator ──────────────────────────────────────────────

export interface CandidateEvaluation {
  modelRef: BrandInverterModelRef;
  result: FeasibilityResult;
  score: number;
  label?: 'recommended' | 'higher_production' | 'conservative';
}

export interface FeasibleSystemsResult {
  valid: boolean;
  recommended: CandidateEvaluation | null;
  alternatives: CandidateEvaluation[];
  rejected: Array<{
    equipmentDbId: string;
    failures: FeasibilityFailure[];
  }>;
}

export interface GenerateFeasibleSystemsInput {
  modelRefs: BrandInverterModelRef[];
  /** Joined electrical specs (from equipment-db) keyed by equipmentDbId. */
  equipmentSpecs: Map<string, StringInverter>;
  panel: PanelElectricalSpecs;
  totalPanels: number;
  designTempMin?: number;

  /**
   * v47.411 — DC topology (forwarded to evaluateInverterFeasibility for every
   * candidate). 'optimizer' switches per-string current to the regulated
   * optimizer cap; otherwise panel method (NEC 690.8(A)(1)) is used.
   */
  topology?: FeasibilityTopology;

  /**
   * v47.411 — Optimizer regulated output cap (A). Used only when
   * topology === 'optimizer'. Defaults to DEFAULT_OPTIMIZER_MAX_OUTPUT_CURRENT.
   */
  optimizerMaxOutputCurrent?: number;
}

/**
 * Evaluate every candidate model and return scored survivors.
 * Returns `{ valid: false }` if NOTHING passes — never a false positive.
 */
export function generateFeasibleSystems(
  input: GenerateFeasibleSystemsInput
): FeasibleSystemsResult {
  const {
    modelRefs,
    equipmentSpecs,
    panel,
    totalPanels,
    designTempMin,
    topology,
    optimizerMaxOutputCurrent,
  } = input;

  const rejected: FeasibleSystemsResult['rejected'] = [];
  const passed: CandidateEvaluation[] = [];

  for (const ref of modelRefs) {
    const eq = equipmentSpecs.get(ref.equipmentDbId);
    if (!eq) {
      rejected.push({
        equipmentDbId: ref.equipmentDbId,
        failures: [
          {
            code: 'INVERTER_MPPT_RANGE_INCOMPATIBLE',
            message: `No equipment-db entry for ${ref.equipmentDbId} — cannot evaluate.`,
          },
        ],
      });
      continue;
    }

    const evaluation = evaluateInverterFeasibility({
      inverter: mergeInverterSpecs(ref, eq),
      panel,
      totalPanels,
      designTempMin,
      topology,                    // v47.411 — forward topology to per-candidate eval
      optimizerMaxOutputCurrent,   // v47.411 — forward optimizer cap
    });

    if (evaluation.valid) {
      passed.push({
        modelRef: ref,
        result: evaluation,
        score: scoreCandidate(evaluation),
      });
    } else {
      rejected.push({
        equipmentDbId: ref.equipmentDbId,
        failures: evaluation.failures,
      });
    }
  }

  if (passed.length === 0) {
    return { valid: false, recommended: null, alternatives: [], rejected };
  }

  // Sort DESC by score — best candidate first.
  passed.sort((a, b) => b.score - a.score);

  // Recommended = highest score.
  const recommended = { ...passed[0], label: 'recommended' as const };

  // Alternatives: up to 2 additional candidates with distinct profiles.
  const alternatives: CandidateEvaluation[] = [];
  for (const c of passed.slice(1)) {
    if (alternatives.length >= 2) break;
    // De-dup by model id.
    if (c.modelRef.equipmentDbId === recommended.modelRef.equipmentDbId) continue;
    // Label them conservatively based on acKw relative to recommended.
    const label: 'higher_production' | 'conservative' =
      c.modelRef.acKw > recommended.modelRef.acKw ? 'higher_production' : 'conservative';
    alternatives.push({ ...c, label });
  }

  return {
    valid: true,
    recommended,
    alternatives,
    rejected,
  };
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Higher score = better candidate. Components:
 *   (a) DC/AC ratio closeness to 1.20 — target match
 *   (b) Fewer inverters — simpler
 *   (c) More headroom — voltage and current margin
 *
 * Max possible score ≈ 100.
 */
function scoreCandidate(r: FeasibilityResult): number {
  // (a) DC/AC — peak score (50) at 1.20, linear falloff to 0 at bounds.
  const targetRatio = 1.2;
  const ratioDistance = Math.abs(r.dcAcRatio - targetRatio);
  const ratioRange = Math.max(
    DC_AC_ACCEPTABLE_MAX - targetRatio,
    targetRatio - DC_AC_ACCEPTABLE_MIN
  );
  const ratioScore = 50 * Math.max(0, 1 - ratioDistance / ratioRange);

  // (b) Simplicity — 25 points, shed 5 per extra inverter.
  const simplicityScore = Math.max(0, 25 - (r.inverterCount - 1) * 5);

  // (c) Headroom — 25 points. Equal split voltage / current.
  const headroomScore = 12.5 * r.headroom.voltageMarginPct + 12.5 * r.headroom.currentMarginPct;

  return ratioScore + simplicityScore + headroomScore;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function buildStringPanelCounts(
  total: number,
  perString: number,
  minPerString: number
): number[] {
  if (perString <= 0) return [];
  const full = Math.floor(total / perString);
  const rem = total % perString;
  const out: number[] = [];
  for (let i = 0; i < full; i++) out.push(perString);
  if (rem === 0) return out;
  if (rem >= minPerString) {
    out.push(rem);
    return out;
  }
  // Redistribute: take one panel from the last full string to make the
  // remainder hit the minimum.
  if (out.length > 0 && perString - 1 >= minPerString && rem + 1 >= minPerString) {
    out[out.length - 1] = perString - 1;
    out.push(rem + 1);
    return out;
  }
  // Accept short last string (caller surfaces as warning). Never drop panels.
  out.push(rem);
  return out;
}

function mergeInverterSpecs(
  ref: BrandInverterModelRef,
  eq: StringInverter
): InverterElectricalSpecs {
  return {
    equipmentDbId: ref.equipmentDbId,
    acKw: ref.acKw,
    dcKwMax: ref.dcKwMax,
    mpptCount: ref.mpptCount,
    maxDcVoltage: eq.maxDcVoltage,
    mpptVoltageMin: eq.mpptVoltageMin,
    mpptVoltageMax: eq.mpptVoltageMax,
    nominalDcVoltage: eq.nominalDcVoltage, // v47.415 — fixed DC bus for optimizer inverters
    maxInputCurrentPerMppt: eq.maxInputCurrentPerMppt,
    // v47.421 — short-circuit current is the actual DC input connector/fuse
    // rating for parallel strings (SE11400H: 45A = 3 × 15A optimizer caps).
    // Distinct from maxInputCurrentPerMppt (30.5A = acKw/nominalDcV = inverter draw).
    maxShortCircuitCurrentPerMppt: eq.maxShortCircuitCurrent,
    maxParallelStringsPerMppt:
      ref.maxParallelStringsPerMppt ?? eq.maxParallelStringsPerMppt,
    minPanelsPerString: ref.minPanelsPerString,
    maxPanelsPerString: ref.maxPanelsPerString,
  };
}

function earlyFailure(
  input: FeasibilityInput,
  failures: FeasibilityFailure[],
  partial?: {
    stringVoltageValid?: boolean;
    mpptVoltageValid?: boolean;
    mpptCurrentValid?: boolean;
    panelsPerString?: number;
  }
): FeasibilityResult {
  const { inverter, panel, totalPanels } = input;
  const totalDcKw = (totalPanels * panel.watts) / 1000;
  return {
    valid: false,
    stringVoltageValid: partial?.stringVoltageValid ?? false,
    mpptVoltageValid: partial?.mpptVoltageValid ?? false,
    mpptCurrentValid: partial?.mpptCurrentValid ?? false,
    allocationValid: false,
    dcAcValid: false,
    stringConfigs: [],
    dcAcRatio: totalDcKw / Math.max(inverter.acKw, 1e-6),
    inverterCount: 0,
    panelsPerString: partial?.panelsPerString ?? 0,
    totalStrings: 0,
    failures,
    headroom: { voltageMarginPct: 0, currentMarginPct: 0 },
  };
}