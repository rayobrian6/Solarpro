/**
 * Pure diff helper for SizingRecommendation — extracted so it can be
 * imported from vitest (node env) without pulling JSX dependencies.
 *
 * v47.370 (Phase 12.5): Inverter-count comparisons now go through the
 * normalized inverter state (physicalUnits / logicalGroups) so the same
 * logic works identically for micro, string, optimizer, and hybrid
 * topologies without special-casing. This eliminates the long-standing
 * false-positive where micro topology always reported an "Inverter count"
 * mismatch (UI card count = 1 vs sizing result = N microinverters).
 */

import type { SystemSizingResult } from '@/lib/system/sizingEngine';
import {
  diffNormalizedInverterState,
} from '@/lib/system/normalizedInverter';

export interface RecommendationDiff {
  /** True when the current config matches the recommended config. */
  matches: boolean;
  /** Specific mismatched fields for display. */
  mismatches: Array<{
    field: string;
    current: string | number;
    recommended: string | number;
  }>;
  /**
   * True when the string layout specifically differs from the recommendation.
   * This is a stronger signal than top-level `stringCount` mismatch because
   * it also catches cases where total count matches but the per-string
   * panel distribution is wrong (e.g. 20 panels across 1 string vs 2 strings of 10).
   */
  stringLayoutMismatch: boolean;
}

/**
 * Snapshot of the current user config suitable for diffing against a
 * SystemSizingResult.
 *
 * NOTE (v47.370): `inverterCount` here is the number of UI inverter *cards*
 * (equivalently `config.inverters.length`). The comparison against the
 * sizing engine's `inverterCount` (which represents physical units) is
 * done via the normalizer — NOT by naive equality — so micro topology
 * with 36 microinverters shown as 1 UI card no longer triggers a
 * false-positive mismatch.
 */
export interface CurrentConfigSnapshot {
  inverterCount: number;
  inverterId: string;
  topology: string;
  /** Total number of string entries across all inverters. */
  stringCount: number;
  /** Panels on the first string (legacy; use stringPanelCounts for precision). */
  panelsPerString: number;
  /**
   * Per-string panel counts, in order. Length === stringCount.
   * Used by detectStringLayoutMismatch() to detect uneven distributions.
   */
  stringPanelCounts: number[];
  microDeviceCount: number;
  batteryEnabled: boolean;
  batteryModuleCount: number;
}

/**
 * Detect a string-layout mismatch specifically.
 *
 * Returns true when the per-string panel distribution recommended by the
 * sizing engine differs from the current config. Handles micro topology
 * by comparing total panel count (micro has no "strings" in the classical
 * sense — every panel is its own string).
 */
/**
 * 🚨 DID THE ENGINE DECLINE TO SIZE A FLEET, OR FAIL TO FIND ONE?
 *
 * `PV_DC_COUPLED_NO_INVERTER` means the array terminates on the storage's own DC inputs, so there
 * is no separate PV inverter to size and no strings for this engine to lay out — the DC string
 * bounds for storage MPPTs are owned by `lib/electrical/dcStringLimits.ts`, derived from the
 * published `pvInputLimits`.
 *
 * An empty fleet alone cannot be read as 'nothing is recommended': it is also what a failed sizing
 * looks like, and the two must not render the same. Without this the recommendation panel compared
 * a real 10/9/9/9 layout against an empty one, declared `stringLayoutMismatch`, and printed
 * \"Config layout differs from Sizing Recommendation... Click Apply Recommended Configuration to
 * sync\" over a design that is completely correct.
 */
function declinedToSize(recommended: SystemSizingResult): boolean {
  return recommended.warnings.some(w => w.code === 'PV_DC_COUPLED_NO_INVERTER');
}

export function detectStringLayoutMismatch(
  current: CurrentConfigSnapshot,
  recommended: SystemSizingResult,
): boolean {
  // 🚨 Nothing was recommended, so there is nothing to have drifted FROM.
  if (declinedToSize(recommended)) return false;

  // Micro: the only string-layout invariant is total panel count.
  // This is equivalent to comparing normalized physicalUnits for micro.
  if (recommended.topology === 'micro') {
    return current.microDeviceCount !== recommended.microDeviceCount;
  }

  // Non-micro topologies: compare both count and per-string distribution.
  const recStringCount = recommended.strings.length;
  if (current.stringCount !== recStringCount) return true;

  // Compare per-string panel counts (sort both to make the check
  // order-independent — engine may emit strings in a different order
  // than the UI stores them, but the DISTRIBUTION is what matters).
  const currentCounts = [...current.stringPanelCounts].sort((a, b) => a - b);
  const recommendedCounts = [...recommended.strings.map(s => s.panelCount)].sort(
    (a, b) => a - b,
  );
  if (currentCounts.length !== recommendedCounts.length) return true;
  for (let i = 0; i < currentCounts.length; i++) {
    if (currentCounts[i] !== recommendedCounts[i]) return true;
  }
  return false;
}

/**
 * Compute the total panel count carried by the current config snapshot.
 * For non-micro this is the sum of stringPanelCounts; for micro it's
 * microDeviceCount (every microinverter owns exactly one panel).
 */
function currentPanelTotal(current: CurrentConfigSnapshot): number {
  if (current.topology === 'micro') return current.microDeviceCount;
  return current.stringPanelCounts.reduce((s, n) => s + n, 0);
}

/**
 * Diff a snapshot of the current config against a sizing engine result.
 *
 * v47.370: inverter-count mismatch is now computed via the normalizer,
 * comparing physical units on both sides. This handles all topologies
 * uniformly without special-case branches.
 */
export function diffCurrentVsRecommended(
  current: CurrentConfigSnapshot,
  recommended: SystemSizingResult,
): RecommendationDiff {
  const mismatches: RecommendationDiff['mismatches'] = [];

  if (current.topology !== recommended.topology) {
    mismatches.push({
      field: 'Topology',
      current: current.topology,
      recommended: recommended.topology,
    });
  }

  const recInverterId = recommended.inverterModels[0]?.equipmentDbId ?? '';
  if (recInverterId && current.inverterId !== recInverterId) {
    mismatches.push({
      field: 'Inverter model',
      current: current.inverterId || '(none)',
      recommended: recInverterId,
    });
  }

  // --- Inverter count via normalized state (topology-agnostic) ---
  // Only meaningful when topology matches on both sides — a topology
  // mismatch is its own separate finding and would produce misleading
  // physicalUnits comparisons across different semantics.
  if (current.topology === recommended.topology) {
    const norm = diffNormalizedInverterState(
      {
        cardCount: current.inverterCount,
        panelCount: currentPanelTotal(current),
        topology: current.topology,
      },
      recommended,
    );
    if (norm.physicalMismatch && !norm.topologyMismatch) {
      mismatches.push({
        field: 'Inverter count',
        current: norm.current.physicalUnits,
        recommended: norm.recommended.physicalUnits,
      });
    }
  }

  if (recommended.topology === 'micro') {
    if (current.microDeviceCount !== recommended.microDeviceCount) {
      mismatches.push({
        field: 'Micro device count',
        current: current.microDeviceCount,
        recommended: recommended.microDeviceCount,
      });
    }
  } else if (declinedToSize(recommended)) {
    // 🚨 THE INVERTER-COUNT ROW ABOVE IS KEPT ON PURPOSE, AND THE STRING ROWS ARE NOT.
    //
    // A design whose PV lands on the storage DC inputs still wants to be told that the two
    // auto-picked inverter cards it is carrying are not part of it — that row is how Apply offers
    // to remove them. But 'String count 4 \u2192 0' and 'Panels per string 10/9/9/9 \u2192 (none)'
    // describe a recommendation that was never made, and the strings themselves are real: they
    // terminate on the storage MPPTs. Printing them as drift tells the installer to delete a
    // correct array.
  } else {
    // Check string count first
    if (current.stringCount !== recommended.strings.length) {
      mismatches.push({
        field: 'String count',
        current: current.stringCount,
        recommended: recommended.strings.length,
      });
    }
    // Check string layout (per-string panel distribution)
    const stringMismatch = detectStringLayoutMismatch(current, recommended);
    if (stringMismatch && current.stringCount === recommended.strings.length) {
      // Only report distribution mismatch when count matches — else it's
      // redundant with the count mismatch above.
      const currentDesc = current.stringPanelCounts.length
        ? current.stringPanelCounts.join('/')
        : '(none)';
      const recommendedDesc = recommended.strings.map(s => s.panelCount).join('/');
      mismatches.push({
        field: 'Panels per string',
        current: currentDesc,
        recommended: recommendedDesc,
      });
    }
  }

  if (recommended.battery) {
    if (!current.batteryEnabled) {
      mismatches.push({
        field: 'Battery',
        current: 'disabled',
        recommended: `${recommended.battery.moduleCount} × ${recommended.battery.installedKwh} kWh`,
      });
    } else if (current.batteryModuleCount !== recommended.battery.moduleCount) {
      mismatches.push({
        field: 'Battery modules',
        current: current.batteryModuleCount,
        recommended: recommended.battery.moduleCount,
      });
    }
  } else if (current.batteryEnabled) {
    mismatches.push({
      field: 'Battery',
      current: 'enabled',
      recommended: 'not supported by selected brand',
    });
  }

  // Compute the overall string-layout mismatch flag independent of whether
  // we pushed a redundant entry above (the flag must be accurate regardless
  // of how reporting decides to present it).
  const stringLayoutMismatch =
    recommended.topology === 'micro'
      ? current.microDeviceCount !== recommended.microDeviceCount
      : detectStringLayoutMismatch(current, recommended);

  return {
    matches: mismatches.length === 0,
    mismatches,
    stringLayoutMismatch,
  };
}