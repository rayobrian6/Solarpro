// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE MODULE DESIGN PLACED IS NOT AN INVERTER GATE'S TO REPLACE.
//
// Found in the production build, on Ray's job, by driving the real page (not by a unit test):
// Design placed 37 × Philadelphia Solar 440 W; the page's panel-compatibility gate judged that
// module "incompatible" with ENPHASE — a brand the project never chose (`subSystems.fence.
// ecosystemBrand: 'enphase'`, `source: 'migration'`) on a job that has NO PV inverter at all — and
// the v47.424 auto-heal rewrote every string to the gate's substitute, a Canadian Solar 620 W. The
// engineering autosave then wrote that back over `projects.selected_equipment`, and the sheet drew
// "37 × 620W · 22.94 kW DC" from the canonical store.
//
// Ray: "Design is upstream. PHYSICAL PV DESIGN ≠ INVERTER FLEET." · "Automatic writers obey
// explicit intent."
//
// The gate's verdict stays useful — it is shown, with its suggestions, for an installer to act on.
// What it may no longer do is replace, by itself:
//   · the project's recorded module (`selected_equipment.panelId` — what Design / the installer
//     chose), or
//   · any module on a job whose strings land on a battery's own PV inputs, where no PV inverter
//     exists for the module to be "incompatible" with.
// A module SolarPro planted itself (no project-level selection) may still be healed, as before.
// ═══════════════════════════════════════════════════════════════════════════

export interface PanelCompatibilityVerdictLike {
  autoSwitched?: boolean;
  originalPanelId?: string | null;
  effectivePanelId?: string | null;
}

export interface ModuleAuthorityContext {
  /** `projects.selected_equipment.panelId` — the project's recorded module. */
  canonicalPanelId: string | null | undefined;
  /** The strings terminate on a battery's own PV DC inputs (no PV inverter). */
  pvOnStorageDc: boolean;
}

export type ModuleSwapWithheld = 'dc-coupled-storage' | 'recorded-module';

/** Why an automatic module swap is withheld, or null when the gate may apply it. */
export function moduleSwapWithheld(
  verdict: PanelCompatibilityVerdictLike | null | undefined,
  ctx: ModuleAuthorityContext,
): ModuleSwapWithheld | null {
  if (!verdict?.autoSwitched || !verdict.effectivePanelId) return null;
  if (ctx.pvOnStorageDc) return 'dc-coupled-storage';
  const recorded = typeof ctx.canonicalPanelId === 'string' && ctx.canonicalPanelId.trim()
    ? ctx.canonicalPanelId.trim() : null;
  if (recorded && verdict.originalPanelId === recorded) return 'recorded-module';
  return null;
}

/** True only when an automatic writer may replace the strings' module with the gate's choice. */
export function gateMayReplaceModule(
  verdict: PanelCompatibilityVerdictLike | null | undefined,
  ctx: ModuleAuthorityContext,
): boolean {
  return !!verdict?.autoSwitched && !!verdict.effectivePanelId && moduleSwapWithheld(verdict, ctx) === null;
}
