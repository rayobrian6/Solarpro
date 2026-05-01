// ═══════════════════════════════════════════════════════════════════════════
// Panel Count Source of Truth
// ───────────────────────────────────────────────────────────────────────────
// The sizing engine, UI displays, and all downstream logic MUST use the true
// system panel count. The true count comes from the CAD model or the
// SystemDefinition — NEVER from inverter/string UI config state, which can
// be stale (e.g. user placed 36 panels in CAD, but the inverter card still
// reflects a prior 10-panel layout).
//
// Priority (non-negotiable):
//   1. CADModel.panels.length         (preferred — actually-placed panels)
//   2. CADModel.totalPanels           (fallback — precomputed by CAD layer)
//   3. SystemDefinition.layout.totalPanels (fallback — canonical system spec)
//   4. configFallback                 (last resort — sum of string panelCounts)
//
// This module owns the priority logic so that every consumer (sizing engine
// call sites, inverter card display, ComputedSystem input, etc.) reads a
// single, agreed-upon number.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A minimal shape we accept for the CAD/layout source. Both the live
 * `projectLayout` state in `app/engineering/page.tsx` and serialized
 * layouts coming back from the DB satisfy this shape.
 */
export interface PanelCountSourceLayout {
  /** Placed panel entities — length is the authoritative count when present. */
  panels?: Array<unknown> | null;
  /** Precomputed total from the CAD / layout layer. */
  totalPanels?: number;
}

/**
 * Subset of SystemDefinition we care about for panel count.
 * We accept both the full shape and lighter proxies.
 */
export interface PanelCountSourceSystemDefinition {
  layout?: {
    totalPanels?: number;
  };
  /** Some code paths store totalPanels at the top of SystemDefinition. */
  totalPanels?: number;
}

export interface ResolvePanelCountInput {
  /** CAD/Layout source (e.g. `projectLayout` in engineering page). */
  cad?: PanelCountSourceLayout | null;
  /** SystemDefinition (secondary canonical source). */
  systemDefinition?: PanelCountSourceSystemDefinition | null;
  /**
   * Config-derived fallback. MUST NOT be trusted when CAD/SystemDefinition
   * are available — present only so the engine has *some* count when no
   * layout has been produced yet (e.g. brand-new project pre-CAD).
   */
  configFallback?: number;
}

export interface ResolvedPanelCount {
  /** Authoritative panel count to use for sizing / UI / BOM. */
  value: number;
  /** Which source was used (for debug & UI badges). */
  source: 'cad-panels' | 'cad-total' | 'system-definition' | 'config-fallback' | 'none';
  /**
   * True when the config-derived count disagrees with the authoritative
   * source. Useful for surfacing a "UI is showing stale count" warning.
   */
  mismatchedWithConfig: boolean;
}

/**
 * Resolve the system panel count from the highest-priority source available.
 *
 * Never returns a negative or fractional value. Returns `{ value: 0,
 * source: 'none' }` when no source is available.
 */
export function resolveSystemPanelCount(
  input: ResolvePanelCountInput,
): ResolvedPanelCount {
  const { cad, systemDefinition, configFallback } = input;

  // Priority 1: CAD layout placed-panel count (most authoritative).
  if (cad && Array.isArray(cad.panels) && cad.panels.length > 0) {
    const value = cad.panels.length;
    return {
      value,
      source: 'cad-panels',
      mismatchedWithConfig:
        typeof configFallback === 'number' && configFallback !== value,
    };
  }

  // Priority 2: CAD precomputed totalPanels.
  if (cad && typeof cad.totalPanels === 'number' && cad.totalPanels > 0) {
    const value = Math.max(0, Math.floor(cad.totalPanels));
    return {
      value,
      source: 'cad-total',
      mismatchedWithConfig:
        typeof configFallback === 'number' && configFallback !== value,
    };
  }

  // Priority 3: SystemDefinition (either shape).
  if (systemDefinition) {
    const sdTotal =
      systemDefinition.layout?.totalPanels ?? systemDefinition.totalPanels;
    if (typeof sdTotal === 'number' && sdTotal > 0) {
      const value = Math.max(0, Math.floor(sdTotal));
      return {
        value,
        source: 'system-definition',
        mismatchedWithConfig:
          typeof configFallback === 'number' && configFallback !== value,
      };
    }
  }

  // Priority 4: config-derived fallback. Never report mismatch against self.
  if (typeof configFallback === 'number' && configFallback > 0) {
    return {
      value: Math.max(0, Math.floor(configFallback)),
      source: 'config-fallback',
      mismatchedWithConfig: false,
    };
  }

  return { value: 0, source: 'none', mismatchedWithConfig: false };
}