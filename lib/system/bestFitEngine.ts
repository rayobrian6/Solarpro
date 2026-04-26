// ============================================================================
// lib/system/bestFitEngine.ts — Phase 14
//
// BEST-FIT REAL-WORLD SIZING ENGINE
//
// Extends the Phase 13.5 feasibility-first approach by evaluating EVERY
// viable configuration — homogeneous AND heterogeneous (mixed) — and scoring
// them like a real installer would.
//
// PIPELINE:
//   1. Generate candidate configs (homogeneous + mixed inverter combos)
//   2. Hard feasibility gate: reject any config that fails electrical checks
//   3. Score survivors on 4 components (DC/AC fit, simplicity, headroom,
//      economic sanity)
//   4. Apply mixed-config penalty unless mixing produces a materially
//      better score than the best homogeneous option
//   5. Sort by score DESC; return recommended + alternatives + evaluated log
//
// DESIGN RULES:
//   ✅ Pure function — no React, no I/O, no side effects
//   ✅ Reuses evaluateInverterFeasibility() — never duplicates electrical logic
//   ✅ Never recommends an infeasible system
//   ✅ Never hardcodes brand preferences
//   ✅ Never overrides user selection (caller decides whether to apply)
//   ✅ Falls back gracefully when panel specs are missing
// ============================================================================

import {
  evaluateInverterFeasibility,
  type FeasibilityResult,
  type PanelElectricalSpecs,
  type InverterElectricalSpecs,
  DC_AC_ACCEPTABLE_MIN,
  DC_AC_ACCEPTABLE_MAX,
  DC_AC_IDEAL_MIN,
  DC_AC_IDEAL_MAX,
} from './feasibilityEvaluator';
import type { BrandInverterModelRef } from './brandProfiles/types';

// ─── Constants ───────────────────────────────────────────────────────────────

/** DC/AC ideal target for scoring. */
const DC_AC_IDEAL_TARGET = 1.20;

/** Max inverter units per config (caps candidate explosion). */
const MAX_UNITS_PER_CONFIG = 3;

/** Max distinct model types in a mixed config. */
const MAX_MIXED_MODELS = 2;

/**
 * Points that a mixed config must score ABOVE the best homogeneous option
 * before the mixed penalty is waived. Prevents mixing for no real benefit.
 */
const MIXED_BENEFIT_THRESHOLD = 8;

/** Penalty applied to mixed configs unless they clear the threshold. */
const MIXED_PENALTY = 8;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface InverterSlot {
  /** Brand profile model reference. */
  modelRef: BrandInverterModelRef;
  /** Full electrical specs from equipment-db. */
  inverterSpecs: InverterElectricalSpecs;
  /** Number of physical units of this model in this slot. */
  qty: number;
}

/**
 * A candidate configuration: one or more inverter slots forming a complete
 * system. Homogeneous = 1 slot (one model, possibly multiple units).
 * Heterogeneous = 2 slots of different models.
 */
export interface CandidateConfig {
  /** Unique stable key for deduplication. */
  key: string;
  slots: InverterSlot[];
  /** Total AC output (kW) across all slots. */
  totalAcKw: number;
  /** Total DC input capacity (kW) across all slots. */
  totalDcKwMax: number;
  /** Total physical inverter units. */
  totalUnits: number;
  /** True when slots contain more than one distinct model. */
  isMixed: boolean;
}

export interface ScoredConfig {
  config: CandidateConfig;
  /** Feasibility result for each slot (index-aligned with config.slots). */
  slotResults: FeasibilityResult[];
  /** Aggregate feasibility across all slots. */
  feasible: boolean;
  /** Overall DC/AC ratio for the full system. */
  dcAcRatio: number;
  /** Composite score (0–100). */
  score: number;
  /** Score breakdown for transparency. */
  scoreBreakdown: {
    dcAcFit: number;       // 0–40
    simplicity: number;    // 0–25
    headroom: number;      // 0–20
    economic: number;      // 0–15
    mixedPenalty: number;  // ≤ 0 (negative or zero)
  };
  /** Human-readable reasons for the recommendation. */
  reasons: string[];
}

export interface BestFitResult {
  /** Best-scoring feasible config. Null if nothing passes. */
  recommended: ScoredConfig | null;
  /** Up to 2 alternative feasible configs ranked below recommended. */
  alternatives: ScoredConfig[];
  /** All evaluated configs (feasible + infeasible), for debugging. */
  evaluated: ScoredConfig[];
  /** Infeasible configs with failure reasons. */
  rejected: Array<{
    key: string;
    slots: Array<{ equipmentDbId: string; qty: number }>;
    failures: string[];
  }>;
}

export interface BestFitInput {
  /** Brand's supported inverter models (from brand profile). */
  modelRefs: BrandInverterModelRef[];
  /** Full electrical specs from equipment-db, keyed by equipmentDbId. */
  equipmentSpecs: Map<string, InverterElectricalSpecs>;
  /** Panel electrical specs. */
  panel: PanelElectricalSpecs;
  /** Total panels in the system. */
  totalPanels: number;
  /** Design minimum ambient temperature (°C). Default: -10. */
  designTempMin?: number;
  /**
   * v47.411 — DC topology. Forwarded to evaluateInverterFeasibility so the
   * per-string design-current method matches the installed hardware:
   *   'optimizer' -> NEC 690.8(A)(2) regulated output cap
   *   default     -> NEC 690.8(A)(1) panel Isc x 1.25
   */
  topology?: 'string' | 'optimizer' | 'hybrid';
  /**
   * v47.411 — Optimizer regulated output cap (A). Used only when
   * topology === 'optimizer'. Defaults to 15.0A in the evaluator.
   */
  optimizerMaxOutputCurrent?: number;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate and rank ALL viable configurations for a given brand + panel set.
 *
 * Returns the best real-world design (recommended), up to 2 alternatives,
 * and a complete evaluation log.
 */
export function generateBestFitSystems(input: BestFitInput): BestFitResult {
  const {
    modelRefs,
    equipmentSpecs,
    panel,
    totalPanels,
    designTempMin = -10,
    topology,
    optimizerMaxOutputCurrent,
  } = input;

  // Filter to models that have equipment-db entries (can be evaluated).
  const evaluableModels = modelRefs.filter(
    m => (m.modulesPerDevice ?? 0) === 0 && equipmentSpecs.has(m.equipmentDbId),
  );

  if (evaluableModels.length === 0) {
    return { recommended: null, alternatives: [], evaluated: [], rejected: [] };
  }

  const totalDcKw = (totalPanels * panel.watts) / 1000;

  // ── Step 1: Generate candidate configs ────────────────────────────────────
  const candidates = generateCandidates(evaluableModels, equipmentSpecs, totalDcKw, totalPanels, panel);

  // ── Step 2 & 3: Evaluate feasibility + score ──────────────────────────────
  const evaluated: ScoredConfig[] = [];
  const rejected: BestFitResult['rejected'] = [];

  for (const candidate of candidates) {
    const { scored, failures } = evaluateAndScore(
      candidate, panel, totalPanels, totalDcKw, designTempMin,
      topology, optimizerMaxOutputCurrent,
    );
    if (scored.feasible) {
      evaluated.push(scored);
    } else {
      rejected.push({
        key: candidate.key,
        slots: candidate.slots.map(s => ({ equipmentDbId: s.modelRef.equipmentDbId, qty: s.qty })),
        failures,
      });
      // Still add to evaluated for full log (marked infeasible).
      evaluated.push(scored);
    }
  }

  const feasible = evaluated.filter(s => s.feasible);
  if (feasible.length === 0) {
    return { recommended: null, alternatives: [], evaluated, rejected };
  }

  // ── Step 4: Apply mixed-config penalty ────────────────────────────────────
  const bestHomogeneous = feasible
    .filter(s => !s.config.isMixed)
    .reduce<ScoredConfig | null>((best, s) => (!best || s.score > best.score ? s : best), null);

  const penaltyThreshold = bestHomogeneous
    ? bestHomogeneous.score + MIXED_BENEFIT_THRESHOLD
    : -Infinity;

  const finalScored = feasible.map(s => {
    if (!s.config.isMixed) return s;
    // Mixed configs must beat the homogeneous best by the threshold to avoid penalty.
    const rawScore = s.score;
    if (rawScore >= penaltyThreshold) return s; // Mixed wins on merit — no penalty.
    // Apply penalty.
    const penalized = {
      ...s,
      score: rawScore - MIXED_PENALTY,
      scoreBreakdown: {
        ...s.scoreBreakdown,
        mixedPenalty: -MIXED_PENALTY,
      },
    };
    return penalized;
  });

  // ── Step 5: Sort DESC by score, then by totalUnits ASC (prefer fewer), then by key ──
  finalScored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.01) return b.score - a.score;
    if (a.config.totalUnits !== b.config.totalUnits) return a.config.totalUnits - b.config.totalUnits;
    return a.config.key.localeCompare(b.config.key);
  });

  const recommended = finalScored[0] ?? null;

  // Alternatives: up to 2 distinct configs after the recommended.
  const alternatives: ScoredConfig[] = [];
  for (const s of finalScored.slice(1)) {
    if (alternatives.length >= 2) break;
    // Skip if same model lineup as recommended (different qty is fine).
    if (s.config.key === recommended?.config.key) continue;
    alternatives.push(s);
  }

  // Attach reasons to recommended.
  if (recommended) {
    recommended.reasons = buildReasons(recommended, bestHomogeneous);
  }

  return { recommended, alternatives, evaluated, rejected };
}

// ─── Candidate generation ──────────────────────────────────────────────────

function generateCandidates(
  models: BrandInverterModelRef[],
  equipmentSpecs: Map<string, InverterElectricalSpecs>,
  totalDcKw: number,
  totalPanels: number,
  panel: PanelElectricalSpecs,
): CandidateConfig[] {
  const configs: CandidateConfig[] = [];
  const seen = new Set<string>();

  // ── A. Homogeneous: N × same model ────────────────────────────────────────
  for (const model of models) {
    const specs = equipmentSpecs.get(model.equipmentDbId)!;
    for (let units = 1; units <= MAX_UNITS_PER_CONFIG; units++) {
      const totalAcKw = model.acKw * units;
      const dcAc = totalDcKw / Math.max(totalAcKw, 1e-6);
      // Pre-filter: skip configs that can't possibly reach acceptable band.
      // (single unit wildly over-sized AND adding more would only make it worse)
      if (units > 1 && dcAc < DC_AC_ACCEPTABLE_MIN * 0.7) break; // too many units
      if (dcAc > DC_AC_ACCEPTABLE_MAX * 2 && units === MAX_UNITS_PER_CONFIG) continue; // too few

      const key = `${model.equipmentDbId}x${units}`;
      if (seen.has(key)) continue;
      seen.add(key);

      configs.push({
        key,
        slots: [{ modelRef: model, inverterSpecs: specs, qty: units }],
        totalAcKw,
        totalDcKwMax: model.dcKwMax * units,
        totalUnits: units,
        isMixed: false,
      });
    }
  }

  // ── B. Heterogeneous: 1×modelA + 1×modelB (max 2 units total) ─────────────
  // Constraint: max 2 distinct models, max MAX_MIXED_MODELS=2 types, max 3 total units.
  // Only generate pairs (not triples) to avoid combinatorial explosion.
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const ma = models[i];
      const mb = models[j];
      // Skip same model (shouldn't happen with i<j but be safe).
      if (ma.equipmentDbId === mb.equipmentDbId) continue;

      const specsA = equipmentSpecs.get(ma.equipmentDbId)!;
      const specsB = equipmentSpecs.get(mb.equipmentDbId)!;

      // Generate combinations up to MAX_UNITS_PER_CONFIG total.
      for (let qa = 1; qa <= 2; qa++) {
        for (let qb = 1; qb <= 2; qb++) {
          if (qa + qb > MAX_UNITS_PER_CONFIG) continue;
          const totalAcKw = ma.acKw * qa + mb.acKw * qb;
          const dcAc = totalDcKw / Math.max(totalAcKw, 1e-6);
          // Pre-filter: must be in a plausible DC/AC range.
          if (dcAc < DC_AC_ACCEPTABLE_MIN * 0.6 || dcAc > DC_AC_ACCEPTABLE_MAX * 2.5) continue;

          // Canonical key: sort model ids alphabetically for dedup.
          const keyParts = [
            `${ma.equipmentDbId}x${qa}`,
            `${mb.equipmentDbId}x${qb}`,
          ].sort();
          const key = `mixed:${keyParts.join('+')}`;
          if (seen.has(key)) continue;
          seen.add(key);

          configs.push({
            key,
            slots: [
              { modelRef: ma, inverterSpecs: specsA, qty: qa },
              { modelRef: mb, inverterSpecs: specsB, qty: qb },
            ],
            totalAcKw,
            totalDcKwMax: ma.dcKwMax * qa + mb.dcKwMax * qb,
            totalUnits: qa + qb,
            isMixed: true,
          });
        }
      }
    }
  }

  return configs;
}

// ─── Evaluation + scoring ─────────────────────────────────────────────────────

function evaluateAndScore(
  config: CandidateConfig,
  panel: PanelElectricalSpecs,
  totalPanels: number,
  totalDcKw: number,
  designTempMin: number,
  // v47.411 — topology-aware per-string design current
  topology?: 'string' | 'optimizer' | 'hybrid',
  optimizerMaxOutputCurrent?: number,
): { scored: ScoredConfig; failures: string[] } {
  const failures: string[] = [];
  const slotResults: FeasibilityResult[] = [];

  // Distribute panels across slots proportional to each slot's AC kW share.
  const panelShares = distributePanelsToSlots(config.slots, totalPanels);

  let allFeasible = true;
  let worstVoltageMargin = Infinity;
  let worstCurrentMargin = Infinity;

  for (let i = 0; i < config.slots.length; i++) {
    const slot = config.slots[i];
    const slotPanels = panelShares[i];
    const slotDcKw = (slotPanels * panel.watts) / 1000;
    const slotAcKw = slot.inverterSpecs.acKw * slot.qty;

    // Scale the inverter spec to represent slot.qty physical units as one
    // logical inverter:
    //   - mpptCount × qty = total MPPT channels for string allocation
    //   - dcKwMax × qty   = total DC input capacity
    //
    // We use a sentinel acKw to suppress the evaluator's internal DC/AC check.
    // The evaluator's check uses its own internally-escalated inverterCount
    // which conflicts with our pre-determined slot.qty. Instead we compute
    // DC/AC at slot level ourselves and inject the correct result below.
    // Sentinel: put evaluator's DC/AC at exactly 1.20 (dead center of ideal band).
    const sentinelAcKw = slotDcKw / DC_AC_IDEAL_TARGET;

    const scaledInverter: InverterElectricalSpecs = {
      ...slot.inverterSpecs,
      mpptCount: slot.inverterSpecs.mpptCount * slot.qty,
      acKw: sentinelAcKw,
      dcKwMax: slot.inverterSpecs.dcKwMax * slot.qty,
    };

    const rawResult = evaluateInverterFeasibility({
      inverter: scaledInverter,
      panel,
      totalPanels: slotPanels,
      designTempMin,
      topology,                    // v47.411
      optimizerMaxOutputCurrent,   // v47.411
    });

    // Compute real slot DC/AC ratio and override the evaluator's stale values.
    const realSlotDcAcRatio = slotDcKw / Math.max(slotAcKw, 1e-6);
    const slotDcAcValid =
      realSlotDcAcRatio >= DC_AC_ACCEPTABLE_MIN - 1e-6 &&
      realSlotDcAcRatio <= DC_AC_ACCEPTABLE_MAX + 1e-6;

    // Strip any DC_AC_RATIO_OUT_OF_BAND the evaluator may have emitted
    // (shouldn't fire with sentinel, but be defensive).
    const strippedFailures = rawResult.failures.filter(
      f => f.code !== 'DC_AC_RATIO_OUT_OF_BAND',
    );

    // Add DC/AC failure if out of real band.
    if (!slotDcAcValid) {
      strippedFailures.push({
        code: 'DC_AC_RATIO_OUT_OF_BAND',
        message:
          `DC/AC ratio ${realSlotDcAcRatio.toFixed(2)} is outside acceptable band ` +
          `[${DC_AC_ACCEPTABLE_MIN}, ${DC_AC_ACCEPTABLE_MAX}].`,
      });
    }

    const result: FeasibilityResult = {
      ...rawResult,
      dcAcRatio: realSlotDcAcRatio,
      dcAcValid: slotDcAcValid,
      valid:
        rawResult.stringVoltageValid &&
        rawResult.mpptVoltageValid &&
        rawResult.mpptCurrentValid &&
        rawResult.allocationValid &&
        slotDcAcValid,
      failures: strippedFailures,
    };

    slotResults.push(result);

    if (!result.valid) {
      allFeasible = false;
      failures.push(...result.failures.map(f => `[${slot.modelRef.equipmentDbId}] ${f.message}`));
    }

    // Track worst headroom across slots.
    if (result.headroom.voltageMarginPct < worstVoltageMargin) {
      worstVoltageMargin = result.headroom.voltageMarginPct;
    }
    if (result.headroom.currentMarginPct < worstCurrentMargin) {
      worstCurrentMargin = result.headroom.currentMarginPct;
    }
  }

  const dcAcRatio = totalDcKw / Math.max(config.totalAcKw, 1e-6);

  // Score (only meaningful when feasible, but compute always for debugging).
  const breakdown = computeScoreBreakdown(
    dcAcRatio,
    config.totalUnits,
    config.isMixed,
    Math.max(0, worstVoltageMargin === Infinity ? 0 : worstVoltageMargin),
    Math.max(0, worstCurrentMargin === Infinity ? 0 : worstCurrentMargin),
    totalDcKw,
    config.totalAcKw,
  );

  const score = allFeasible
    ? breakdown.dcAcFit + breakdown.simplicity + breakdown.headroom + breakdown.economic + breakdown.mixedPenalty
    : 0;

  return {
    scored: {
      config,
      slotResults,
      feasible: allFeasible,
      dcAcRatio,
      score,
      scoreBreakdown: breakdown,
      reasons: [],
    },
    failures,
  };
}

/**
 * Distribute totalPanels across slots proportional to each slot's AC kW share.
 * The largest slot absorbs any rounding remainder so all panels are accounted for.
 */
function distributePanelsToSlots(slots: InverterSlot[], totalPanels: number): number[] {
  if (slots.length === 1) return [totalPanels];

  const totalAcKw = slots.reduce((s, slot) => s + slot.modelRef.acKw * slot.qty, 0);
  const shares: number[] = slots.map(slot => {
    const fraction = (slot.modelRef.acKw * slot.qty) / Math.max(totalAcKw, 1e-6);
    return Math.floor(totalPanels * fraction);
  });

  // Give remainder panels to the largest-capacity slot.
  const remainder = totalPanels - shares.reduce((s, n) => s + n, 0);
  if (remainder > 0) {
    const largestIdx = slots.reduce(
      (best, slot, i) => (slot.modelRef.acKw * slot.qty > slots[best].modelRef.acKw * slots[best].qty ? i : best),
      0,
    );
    shares[largestIdx] += remainder;
  }

  // Ensure no slot has 0 panels (would fail feasibility trivially).
  for (let i = 0; i < shares.length; i++) {
    if (shares[i] === 0) shares[i] = 1;
  }

  return shares;
}



// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Compute the 4-component score breakdown.
 *
 * Component weights:
 *   DC/AC fit     40 pts  — peak at ideal target (1.20), linear falloff
 *   Simplicity    25 pts  — fewer units = better
 *   Headroom      20 pts  — voltage + current margin
 *   Economic      15 pts  — penalize excessive AC overcapacity
 *   Mixed penalty  0 / -8 — applied by caller after comparing with best homogeneous
 */
function computeScoreBreakdown(
  dcAcRatio: number,
  totalUnits: number,
  isMixed: boolean,
  voltageMarginPct: number,
  currentMarginPct: number,
  totalDcKw: number,
  totalAcKw: number,
): ScoredConfig['scoreBreakdown'] {
  // ── 1. DC/AC Fit (40 pts) ──────────────────────────────────────────────────
  // Perfect at DC_AC_IDEAL_TARGET (1.20). Linear falloff to 0 at acceptable edges.
  // Extra heavy penalty outside acceptable band (shouldn't reach scoring if
  // feasibility gate correctly rejects, but be defensive).
  let dcAcFit: number;
  if (dcAcRatio < DC_AC_ACCEPTABLE_MIN || dcAcRatio > DC_AC_ACCEPTABLE_MAX) {
    dcAcFit = 0;
  } else {
    const dist = Math.abs(dcAcRatio - DC_AC_IDEAL_TARGET);
    // Distance to nearest acceptable edge from ideal.
    const rangeFromIdeal = dcAcRatio >= DC_AC_IDEAL_TARGET
      ? DC_AC_ACCEPTABLE_MAX - DC_AC_IDEAL_TARGET   // upper half range
      : DC_AC_IDEAL_TARGET - DC_AC_ACCEPTABLE_MIN;  // lower half range
    // Inside ideal band (1.10–1.30): full 40 pts.
    if (dcAcRatio >= DC_AC_IDEAL_MIN && dcAcRatio <= DC_AC_IDEAL_MAX) {
      dcAcFit = 40;
    } else {
      // Linear falloff from ideal band edge to acceptable edge.
      const distFromBand = dcAcRatio >= DC_AC_IDEAL_MAX
        ? dcAcRatio - DC_AC_IDEAL_MAX
        : DC_AC_IDEAL_MIN - dcAcRatio;
      const bandEdgeDist = dcAcRatio >= DC_AC_IDEAL_MAX
        ? DC_AC_ACCEPTABLE_MAX - DC_AC_IDEAL_MAX
        : DC_AC_IDEAL_MIN - DC_AC_ACCEPTABLE_MIN;
      dcAcFit = 40 * Math.max(0, 1 - distFromBand / Math.max(bandEdgeDist, 1e-6));
    }
    void dist; void rangeFromIdeal; // suppress unused
  }

  // ── 2. Simplicity (25 pts) ─────────────────────────────────────────────────
  // 25 pts for 1 unit, -5 per additional unit. Floor at 0.
  const simplicity = Math.max(0, 25 - (totalUnits - 1) * 5);

  // ── 3. Electrical Headroom (20 pts) ───────────────────────────────────────
  // 10 pts voltage margin + 10 pts current margin.
  // currentMarginPct = 0 when inverter has no current spec (advisory only).
  const headroom = 10 * Math.min(1, voltageMarginPct) + 10 * Math.min(1, currentMarginPct);

  // ── 4. Economic Sanity (15 pts) ────────────────────────────────────────────
  // Full 15 pts at dcAcRatio >= 0.95. Linearly reduce toward 0 as ratio falls
  // below 0.95 (inverter increasingly oversized).
  const economicThreshold = 0.95;
  let economic: number;
  if (dcAcRatio >= economicThreshold) {
    economic = 15;
  } else {
    // Penalty for inverter oversizing.
    const overshoot = economicThreshold - dcAcRatio;
    const maxOvershoot = economicThreshold - DC_AC_ACCEPTABLE_MIN;
    economic = 15 * Math.max(0, 1 - overshoot / Math.max(maxOvershoot, 1e-6));
  }

  return {
    dcAcFit,
    simplicity,
    headroom,
    economic,
    // Mixed penalty is initially 0 here; adjusted in the main loop.
    mixedPenalty: 0,
  };
}

// ─── Reason builder ───────────────────────────────────────────────────────────

function buildReasons(
  recommended: ScoredConfig,
  bestHomogeneous: ScoredConfig | null,
): string[] {
  const reasons: string[] = [];
  const { dcAcRatio, config, scoreBreakdown } = recommended;

  if (dcAcRatio >= DC_AC_IDEAL_MIN && dcAcRatio <= DC_AC_IDEAL_MAX) {
    reasons.push(`Best DC/AC ratio (${dcAcRatio.toFixed(2)}) — within ideal 1.10–1.30 band`);
  } else if (dcAcRatio >= DC_AC_ACCEPTABLE_MIN) {
    reasons.push(`DC/AC ratio ${dcAcRatio.toFixed(2)} — within acceptable range`);
  }

  if (config.totalUnits === 1) {
    reasons.push('Single inverter — simplest installation and lowest BOS cost');
  } else {
    reasons.push(`${config.totalUnits} inverter units — minimum required for this panel count`);
  }

  if (!config.isMixed) {
    reasons.push('Homogeneous design — identical units simplify commissioning and maintenance');
  } else if (bestHomogeneous && recommended.score > bestHomogeneous.score + MIXED_BENEFIT_THRESHOLD) {
    reasons.push('Mixed inverter configuration — materially better DC/AC fit than any homogeneous option');
  }

  if (scoreBreakdown.headroom >= 15) {
    reasons.push('Good voltage and current headroom — safe operating margins');
  }

  if (reasons.length === 0) {
    reasons.push('Best overall score among feasible configurations');
  }

  return reasons;
}

// ─── Helper: panels per unit for a brand model ref ───────────────────────────

/**
 * Compute the voltage-safe panels-per-unit for a given model, panel, and temperature.
 * Used externally by bestFit integration tests.
 */
export function computeVocSafeCeiling(
  inverterSpecs: InverterElectricalSpecs,
  panelVoc: number,
  tempCoeffVoc: number,
  designTempMin: number,
): number {
  const deltaT = designTempMin - 25;
  const vocColdPerPanel = panelVoc * (1 + (tempCoeffVoc / 100) * deltaT);
  return Math.floor((inverterSpecs.maxDcVoltage * 0.99) / Math.max(vocColdPerPanel, 1e-6));
}