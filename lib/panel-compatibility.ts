// ============================================================================
// lib/panel-compatibility.ts — v47.421
//
// Panel-Inverter Compatibility Helper
//
// Given an inverter's MPPT current constraint, returns a ranked list of
// panels from the equipment registry (SOLAR_PANELS) that are compatible.
//
// The primary use case: when the string-generator emits MPPT_CURRENT_EXCEEDED
// ("your panels draw too much current for this inverter's MPPT channels"),
// the UI can offer actionable panel-swap suggestions INSTEAD OF just telling
// the user to "switch to a panel with lower Isc" (which is useless without
// knowing which panels SolarPro actually has in the catalog).
//
// DESIGN RULES
// ------------
//  - Pure function (no I/O, no mutation of inputs).
//  - Reads SOLAR_PANELS from the equipment registry as the single source
//    of truth (no hardcoded panel lists).
//  - Returns a ranked list — "comfortable" first (30%+ headroom), then
//    "marginal" (fits but < 15% headroom).
//  - NEC 690.8(A)(1): design current = panel Isc × 1.25 must be ≤ the
//    inverter's max input current per MPPT.
//  - Only returns ACTIVE panels (active: true or undefined in registry).
//  - Excludes the fence-specific panel (panel-fence-ps1) because it's not
//    a residential/commercial PV panel.
// ============================================================================

import { SOLAR_PANELS } from './equipment-db';
import type { SolarPanel } from './equipment-db';

export interface PanelCompatibilityCandidate {
  /** Equipment-db panel id (e.g. 'pan-evervolt-410'). */
  id: string;
  /** Manufacturer + model display string (e.g. 'Panasonic EVERVOLT 410W'). */
  displayName: string;
  /** Panel STC Isc (A). */
  isc: number;
  /** NEC 690.8(A)(1) design current = Isc × 1.25 (A). */
  designCurrent: number;
  /** MPPT headroom: (inverterCap - designCurrent) / inverterCap, as a
   *  fraction (0.30 = 30% headroom). */
  headroom: number;
  /** Classification tier:
   *   - 'comfortable': ≥ 20% headroom (safe pairing)
   *   - 'marginal':    0–20% headroom (fits but tight)
   *   - 'incompatible': designCurrent > inverter cap (should never appear
   *     in the returned list — filtered out).
   */
  tier: 'comfortable' | 'marginal';
  /** Panel STC watts — used to rank higher-power first within a tier. */
  watts: number;
}

export interface PanelCompatibilityResult {
  /** The inverter MPPT current cap used for filtering (A). */
  inverterMaxInputCurrentPerMppt: number;
  /** NEC multiplier applied (1.25 for 690.8(A)(1)). */
  necMultiplier: number;
  /** Comfortable-headroom candidates (≥ 20% headroom), sorted by headroom
   *  DESC then watts DESC. Typically what the UI should show first. */
  comfortable: PanelCompatibilityCandidate[];
  /** Marginal-headroom candidates (0–20% headroom), sorted by watts DESC. */
  marginal: PanelCompatibilityCandidate[];
  /** Total count of compatible panels in catalog (comfortable + marginal). */
  totalCompatible: number;
  /** Total count of panels in catalog that were evaluated (after filtering
   *  out fence-specific and inactive entries). */
  totalEvaluated: number;
}

/**
 * Given an inverter's per-MPPT current cap, return all compatible panels
 * from the equipment registry, ranked by headroom.
 *
 * @param maxInputCurrentPerMppt - Inverter's maxInputCurrentPerMppt value (A).
 *        If undefined/null/0, returns an empty result (caller should not
 *        surface suggestions when the cap is unknown).
 * @param options.comfortableThreshold - Minimum headroom fraction for the
 *        'comfortable' tier. Default 0.20 (20%).
 * @param options.necMultiplier - NEC design-current multiplier. Default 1.25
 *        (NEC 690.8(A)(1) standard). Caller may pass 1.0 for raw-Isc
 *        compatibility checks (not recommended for compliance reporting).
 * @returns Structured result with comfortable/marginal tiers.
 */
export function findCompatiblePanels(
  maxInputCurrentPerMppt: number | null | undefined,
  options: {
    comfortableThreshold?: number;
    necMultiplier?: number;
  } = {},
): PanelCompatibilityResult {
  const necMultiplier = options.necMultiplier ?? 1.25;
  const comfortableThreshold = options.comfortableThreshold ?? 0.20;

  // If no cap is supplied, we cannot assess compatibility. Return empty.
  if (!maxInputCurrentPerMppt || maxInputCurrentPerMppt <= 0) {
    return {
      inverterMaxInputCurrentPerMppt: 0,
      necMultiplier,
      comfortable: [],
      marginal: [],
      totalCompatible: 0,
      totalEvaluated: 0,
    };
  }

  // Filter registry down to active residential/commercial PV panels.
  // Excludes the SolFence panel (panel-fence-ps1) which is purpose-built
  // for fencing — not applicable to grid-tied residential arrays.
  const evaluated = SOLAR_PANELS.filter(
    (p: SolarPanel) =>
      p.id !== 'panel-fence-ps1' &&
      (p.active === undefined || p.active === true),
  );

  const candidates: PanelCompatibilityCandidate[] = [];
  for (const panel of evaluated) {
    const designCurrent = panel.isc * necMultiplier;
    if (designCurrent > maxInputCurrentPerMppt) continue; // incompatible

    const headroom = (maxInputCurrentPerMppt - designCurrent) / maxInputCurrentPerMppt;
    const tier: 'comfortable' | 'marginal' =
      headroom >= comfortableThreshold ? 'comfortable' : 'marginal';

    candidates.push({
      id: panel.id,
      displayName: `${panel.manufacturer} ${panel.model}`,
      isc: panel.isc,
      designCurrent: Math.round(designCurrent * 100) / 100,
      headroom: Math.round(headroom * 1000) / 1000,
      tier,
      watts: panel.watts,
    });
  }

  // Sort comfortable tier by headroom DESC (widest safety margin first),
  // then watts DESC (prefer higher-power panels at equal headroom).
  const comfortable = candidates
    .filter((c) => c.tier === 'comfortable')
    .sort((a, b) => (b.headroom - a.headroom) || (b.watts - a.watts));

  // Sort marginal tier by watts DESC — at this tier headroom differences
  // are cosmetic, so surface the highest-power option first.
  const marginal = candidates
    .filter((c) => c.tier === 'marginal')
    .sort((a, b) => (b.watts - a.watts) || (b.headroom - a.headroom));

  return {
    inverterMaxInputCurrentPerMppt: maxInputCurrentPerMppt,
    necMultiplier,
    comfortable,
    marginal,
    totalCompatible: comfortable.length + marginal.length,
    totalEvaluated: evaluated.length,
  };
}

/**
 * Format a PanelCompatibilityResult as a short human-readable clause
 * suitable for appending to an MPPT_CURRENT_EXCEEDED error message.
 *
 * Example output:
 *   " Compatible panels in the SolarPro catalog (sorted by headroom):
 *    Panasonic EVERVOLT 410W (Isc 10.06A, 12.58A design, 6.8% headroom),
 *    SunPower Maxeon 6 400W (Isc 10.89A, 13.61A design, -0.8% headroom)."
 *
 * Returns an empty string if there are no compatible panels (caller should
 * fall back to the generic "switch to a panel with lower Isc" remedy).
 */
export function formatCompatiblePanelClause(
  result: PanelCompatibilityResult,
  maxSuggestions: number = 3,
): string {
  if (result.totalCompatible === 0) return '';

  // Prefer comfortable; fall back to marginal if no comfortable matches.
  const picks = [
    ...result.comfortable,
    ...result.marginal,
  ].slice(0, maxSuggestions);

  const parts = picks.map((p) => {
    const headroomPct = Math.round(p.headroom * 100);
    const tierTag = p.tier === 'comfortable' ? '' : ' [marginal]';
    return `${p.displayName} (Isc ${p.isc.toFixed(2)}A, ` +
           `${p.designCurrent.toFixed(2)}A design, ` +
           `${headroomPct}% headroom${tierTag})`;
  });

  const nMore = result.totalCompatible - picks.length;
  const moreClause = nMore > 0
    ? ` and ${nMore} more in the catalog`
    : '';

  return ` Compatible panels in the SolarPro catalog: ${parts.join('; ')}${moreClause}.`;
}