// ============================================================================
// lib/system/layoutScoring.ts — CORE ENGINEERING BRAIN — Phase 7
//
// LAYOUT SCORING ENGINE
//
// Scores LayoutCandidates on 4 components. Higher score = better candidate.
// The top-scored candidate becomes the system recommendation.
//
// SCORING COMPONENTS (total = 100 points max before penalties):
//   1. DC/AC Ratio Fitness      0–40 pts  (most important: clipping + production)
//   2. Simplicity               0–25 pts  (fewer inverter units = simpler install)
//   3. String Balance           0–20 pts  (equal strings = better production)
//   4. Economic Score           0–15 pts  (fewer, larger inverters = lower BOS cost)
//
// PENALTIES (subtracted from total):
//   - Below DC/AC floor         −30 pts  (< dcAcRatioRange.min)
//   - Far above DC/AC ceiling   −20 pts  (> dcAcRatioRange.max)
//   - Unbalanced strings        −5 pts   (extra wiring complexity)
//   - High unit count (>2)      −10 pts  (per extra unit above 2)
//
// DESIGN RULES:
//   ✅ Pure function — input is LayoutCandidate, output is ScoreBreakdown.
//   ✅ Works for all topologies (optimizer, micro, string, hybrid).
//   ✅ Target DC/AC is read from profile.dcAcRatioTarget (typically 1.25).
//   ✅ Micro topology: string balance score defaults to max (no strings).
// ============================================================================

import type { LayoutCandidate, ScoreBreakdown } from './inverterCapabilities';

// ─── Scoring Constants ────────────────────────────────────────────────────────

/** Max points for DC/AC ratio fitness. */
const DC_AC_SCORE_MAX = 40;

/** Points at exactly dcAcRatioTarget. */
const DC_AC_SCORE_AT_TARGET = 40;

/** Ideal DC/AC band half-width (target ± window = full score zone). */
const DC_AC_IDEAL_HALF_WIDTH = 0.10;

/** DC/AC below this → hard floor penalty. */
const DC_AC_FLOOR_PENALTY_THRESHOLD = 1.0;

/** Max points for simplicity (unit count). */
const SIMPLICITY_SCORE_MAX = 25;

/** Points for 1 unit — maximum simplicity. */
const SIMPLICITY_1_UNIT = 25;
/** Points for 2 units. */
const SIMPLICITY_2_UNITS = 17;
/** Points for 3 units. */
const SIMPLICITY_3_UNITS = 9;
/** Points for 4+ units. */
const SIMPLICITY_4_PLUS_UNITS = 2;

/** Max points for string balance. */
const STRING_BALANCE_SCORE_MAX = 20;

/** Max points for economic score. */
const ECONOMIC_SCORE_MAX = 15;

// ─── Main Scoring Function ───────────────────────────────────────────────────

/**
 * Score a single LayoutCandidate.
 * Returns a ScoreBreakdown with individual components and total.
 *
 * @param candidate - The candidate to score. Must be feasible.
 */
export function scoreLayoutCandidate(candidate: LayoutCandidate): ScoreBreakdown {
  const { profile, inverterQty, dcAcRatio, stringLayout, branchLayout } = candidate;

  // ── 1. DC/AC Ratio Fitness ─────────────────────────────────────────────
  const dcAcRatioScore = scoreDcAcRatio(
    dcAcRatio,
    profile.dcAcRatioTarget,
    profile.dcAcRatioRange.min,
    profile.dcAcRatioRange.max,
  );

  // ── 2. Simplicity Score ────────────────────────────────────────────────
  const simplicityScore = scoreSimplicity(inverterQty);

  // ── 3. String Balance Score ────────────────────────────────────────────
  const stringBalanceScore = scoreStringBalance(candidate);

  // ── 4. Economic Score ──────────────────────────────────────────────────
  const economicScore = scoreEconomic(
    inverterQty,
    profile.acKw,
    candidate.totalDcKw,
  );

  // ── Penalties ──────────────────────────────────────────────────────────
  let penalty = 0;

  // Below DC/AC floor: very bad — clipping inverted (AC > DC is wrong).
  if (dcAcRatio < DC_AC_FLOOR_PENALTY_THRESHOLD) {
    penalty += 30;
  }

  // Far above DC/AC ceiling: potential clipping beyond acceptable range.
  if (dcAcRatio > profile.dcAcRatioRange.max) {
    penalty += 20;
  }

  // Unbalanced strings penalty.
  if (stringLayout && !stringLayout.stringsAreBalanced) {
    penalty += 5;
  }

  // High unit count penalty: each unit above 2 adds 10 points penalty.
  if (inverterQty > 2) {
    penalty += (inverterQty - 2) * 10;
  }

  // ── Total ──────────────────────────────────────────────────────────────
  const rawTotal = dcAcRatioScore + simplicityScore + stringBalanceScore + economicScore;
  const total = Math.max(0, rawTotal - penalty);

  return {
    total,
    dcAcRatioScore,
    simplicityScore,
    stringBalanceScore,
    economicScore,
    penalty,
  };
}

// ─── Component Scorers ────────────────────────────────────────────────────────

/**
 * Score the DC/AC ratio.
 *
 * SCORING CURVE:
 *   - At target (±0.10 window): full DC_AC_SCORE_AT_TARGET points.
 *   - Between target window and acceptable min: linear decay to 0.
 *   - Between target window and acceptable max: linear decay to 0.
 *   - Outside acceptable range: 0 (but candidate should have been rejected).
 *
 * Example with target=1.25, window=0.10, min=1.0, max=1.55:
 *   1.25 → 40 pts
 *   1.15 → ~36 pts (below window, decaying toward 1.0 floor)
 *   1.35 → ~36 pts (above window, decaying toward 1.55 ceiling)
 *   1.00 → 0 pts
 *   1.55 → 0 pts
 */
function scoreDcAcRatio(
  ratio: number,
  target: number,
  minAllowed: number,
  maxAllowed: number,
): number {
  const lower = target - DC_AC_IDEAL_HALF_WIDTH;
  const upper = target + DC_AC_IDEAL_HALF_WIDTH;

  if (ratio >= lower && ratio <= upper) {
    return DC_AC_SCORE_AT_TARGET;
  }

  if (ratio < lower) {
    // Linear decay from lower to minAllowed.
    if (ratio <= minAllowed) return 0;
    const fraction = (ratio - minAllowed) / (lower - minAllowed);
    return Math.round(fraction * DC_AC_SCORE_MAX);
  }

  // ratio > upper
  if (ratio >= maxAllowed) return 0;
  const fraction = (maxAllowed - ratio) / (maxAllowed - upper);
  return Math.round(fraction * DC_AC_SCORE_MAX);
}

/**
 * Score inverter unit count.
 * Fewer units = simpler installation = better score.
 */
function scoreSimplicity(qty: number): number {
  switch (qty) {
    case 1:  return SIMPLICITY_1_UNIT;
    case 2:  return SIMPLICITY_2_UNITS;
    case 3:  return SIMPLICITY_3_UNITS;
    default: return SIMPLICITY_4_PLUS_UNITS;
  }
}

/**
 * Score string balance.
 * For micro topology (no strings): always full score.
 * For string/optimizer: score based on how balanced the MPPT allocations are.
 */
function scoreStringBalance(candidate: LayoutCandidate): number {
  const { stringLayout, branchLayout, profile } = candidate;

  // Micro topology: no strings → perfect balance by definition.
  if (profile.topology === 'micro') {
    return branchLayout?.branchesAreBalanced !== false
      ? STRING_BALANCE_SCORE_MAX
      : STRING_BALANCE_SCORE_MAX - 5;
  }

  if (!stringLayout) return STRING_BALANCE_SCORE_MAX;

  const allocs = stringLayout.mpptAllocations;
  if (allocs.length === 0) return STRING_BALANCE_SCORE_MAX;

  // Full score if all MPPT channels have equal panel counts.
  if (stringLayout.stringsAreBalanced) return STRING_BALANCE_SCORE_MAX;

  // Partial score: how close to balanced?
  const panelCounts = allocs.map(a => a.totalPanels);
  const maxCount = Math.max(...panelCounts);
  const minCount = Math.min(...panelCounts);
  const imbalance = maxCount - minCount;

  if (imbalance <= 1) return STRING_BALANCE_SCORE_MAX - 3;  // Off by 1 panel: minor
  if (imbalance <= 2) return STRING_BALANCE_SCORE_MAX - 8;  // Off by 2: moderate
  return STRING_BALANCE_SCORE_MAX - 12;                      // More: significant
}

/**
 * Economic score.
 *
 * Principle: Fewer, larger inverters = lower BOS cost.
 *   - 1 inverter of higher kW beats 2 of lower kW at equal functionality.
 *   - Scores are based on inverter AC kW × qty (effective installed kW).
 *
 * Score = 15 × (1 - unitCount/maxExpectedUnits) × (acKw/maxExpectedAcKw)
 * Simplified: prefer large single units; penalise small multi-unit installs.
 */
function scoreEconomic(qty: number, acKwPerUnit: number, totalDcKw: number): number {
  if (qty === 1) {
    // Single unit: full economic score.
    return ECONOMIC_SCORE_MAX;
  }
  // Multi-unit: scale by inverse of qty, with a floor.
  const qtyPenaltyFactor = 1 / qty;
  return Math.round(ECONOMIC_SCORE_MAX * qtyPenaltyFactor);
}

// ─── Ranking Helper ───────────────────────────────────────────────────────────

/**
 * Select the best LayoutCandidate from a scored list.
 * Candidates must already be scored (score > 0 or tied at 0).
 *
 * Returns null if the list is empty.
 */
export function selectBestLayoutCandidate(
  candidates: LayoutCandidate[],
): LayoutCandidate | null {
  if (candidates.length === 0) return null;

  // Sort by score descending; tie-break by equipmentDbId for determinism.
  return [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.profile.equipmentDbId.localeCompare(b.profile.equipmentDbId);
  })[0];
}

/**
 * Rank all candidates and return them sorted best→worst.
 * Applies scoring to any unscored candidates first.
 */
export function rankLayoutCandidates(
  candidates: LayoutCandidate[],
): LayoutCandidate[] {
  return [...candidates]
    .map(c => {
      if (c.score === 0 && c.scoreBreakdown === null) {
        const scored = scoreLayoutCandidate(c);
        return { ...c, score: scored.total, scoreBreakdown: scored };
      }
      return c;
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.profile.equipmentDbId.localeCompare(b.profile.equipmentDbId);
    });
}