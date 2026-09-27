// ═══════════════════════════════════════════════════════════════════════════
// 🚨 WHEN THE MODULE CHANGES, THE PLACED MODULES ARE STILL THE OLD ONE.
//
// Ray, live: he went looking for a 550 W module, found none in his catalogue, and picked a real
// 580 W one instead. "One system-kW display changed. The right Production Results/sidebar did not
// and continued displaying the value derived from the prior 440 W panel." With 81 modules that is
// 35.64 kW on screen for a design that is now 46.98 kW.
//
// ═══ WHY, AND WHICH CONSUMER BYPASSES THE IDENTITY ═══
//
// `panelId` IS the module identity; manufacturer, model and watts are PROJECTIONS of it
// (lib/equipment/moduleIdentity.ts, and docs/CANONICAL-MODULE-EQUIPMENT-IDENTITY.md). A
// `PlacedPanel` carries no `panelId` at all — only the projections `wattage`, `widthFeet` and
// `heightFeet`, stamped from whichever module was selected AT PLACEMENT TIME.
//
// So the module picker updated `selectedPanel` and wrote the canonical `selected_equipment` store,
// and the 81 already-placed modules kept the projection of a module nobody had chosen any more.
// `calculateSystemSize(panels)` sums `p.wattage`, so it went on reporting the old system. The
// display that DID change reads `selectedPanel.wattage` directly.
//
// Nothing here is a new system-size calculator — `calculateSystemSize` remains the one summation.
// This re-materialises the PROJECTION the summation reads, which is what makes the two agree.
//
// ═══ AND IT DOES NOT MOVE ANYTHING ═══
//
// A 580 W module is physically bigger than a 440 W one, so a layout fitted for the old module may
// not fit the new one. Silently redrawing the modules at the new size on top of the old positions
// would produce overlapping hardware, and silently re-laying them out would destroy hand placement
// — "NEVER rearrange or delete design panels to clean a drawing". So the physical dimensions are
// REPORTED as mismatched and left alone, for the operator to re-fit deliberately.
// ═══════════════════════════════════════════════════════════════════════════

const FEET_PER_METRE = 3.28084;

/** Only the fields this touches — so any placed-module shape can be passed. */
export interface ProjectedModule {
  wattage: number;
  widthFeet?: number;
  heightFeet?: number;
}

/** The module that is selected now. Dimensions are in METRES, as `SolarPanel` carries them. */
export interface SelectedModule {
  wattage: number;
  width?: number;
  height?: number;
}

export interface RestampResult<T> {
  panels: T[];
  /** How many placed modules carried a different wattage and were re-materialised. */
  restamped: number;
  /**
   * The placed modules were laid out at a physical size that is not this module's.
   *
   * Reported, never acted on: re-fitting is the operator's decision. Null when the comparison
   * cannot be made (a module with no dimensions, or modules with no stamped size).
   */
  layoutFittedForDifferentSize: boolean | null;
}

/** Do two lengths differ by more than a centimetre? Below that it is the same hardware. */
const differs = (aFt: number, bFt: number) => Math.abs(aFt - bFt) > 0.033;

/**
 * Re-materialise the electrical projection of every placed module from the selected module.
 *
 * Pure: it returns a new array and reports what it changed, so the studio can invalidate the
 * derived numbers and the whole thing can be proved without a canvas.
 */
export function restampModuleProjection<T extends ProjectedModule>(
  panels: readonly T[], module: SelectedModule,
): RestampResult<T> {
  const watts = Number(module?.wattage);
  if (!Array.isArray(panels) || panels.length === 0 || !Number.isFinite(watts) || watts <= 0) {
    return { panels: (panels ?? []) as T[], restamped: 0, layoutFittedForDifferentSize: null };
  }

  let restamped = 0;
  const out = panels.map(p => {
    if (p.wattage === watts) return p;
    restamped++;
    return { ...p, wattage: watts };
  });

  // ── Physical size: compared, reported, NOT applied ──────────────────────────
  // Orientation decides which stamped dimension is the module's width and which is its height,
  // and a design can mix both. So the two lengths are compared as an unordered pair, which is
  // true for a portrait module and for a landscape one alike.
  let layoutFittedForDifferentSize: boolean | null = null;
  const mw = Number(module?.width), mh = Number(module?.height);
  if (Number.isFinite(mw) && Number.isFinite(mh) && mw > 0 && mh > 0) {
    const wantA = Math.min(mw, mh) * FEET_PER_METRE;
    const wantB = Math.max(mw, mh) * FEET_PER_METRE;
    for (const p of panels) {
      const a = Number(p.widthFeet), b = Number(p.heightFeet);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
      const gotA = Math.min(a, b), gotB = Math.max(a, b);
      layoutFittedForDifferentSize = layoutFittedForDifferentSize || false;
      if (differs(gotA, wantA) || differs(gotB, wantB)) {
        layoutFittedForDifferentSize = true;
        break;
      }
    }
  }

  return { panels: out, restamped, layoutFittedForDifferentSize };
}
