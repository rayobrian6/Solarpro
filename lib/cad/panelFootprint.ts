// ═══════════════════════════════════════════════════════════════════════════
// CAD MODULE FOOTPRINT AUTHORITY — the physical size of the selected module,
// resolved PER SUB-SYSTEM, for the CAD solvers.
//
// ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
// All three solvers read a project-level scalar with a hardcoded fallback:
//
//     const panelLenIn = input.project?.panelLengthIn ?? 66;   // roofCAD:78
//     const panelWidIn = input.project?.panelWidthIn  ?? 40;   // roofCAD:79
//
// and that fallback fired on EVERY generate, because the client seam that was
// supposed to populate the scalar reads properties that do not exist on a
// `SolarPanel`:
//
//     panelLengthIn: (getPanelById(id) as any)?.lengthIn   // app/engineering/page.tsx:8052
//
// `SolarPanel` carries `length` / `width` / `weight`; `lengthIn` / `widthIn` /
// `weightLbs` belong to the BATTERY interface in the same file. The `as any`
// suppressed the error, so the expression is `undefined` — always. Verified
// against the live stored `permit_input.json`: all three scalars are null.
//
// **No module in the 32-row catalogue is 66×40.** Lengths run 66.5–93.9 in,
// widths 40–51.3 in. The fallback described no real product.
//
// ─── WHAT THIS DOES AND DOES NOT AFFECT ────────────────────────────────────
// It does NOT change the planset module outlines. PV-1/PV-1B already draw
// modules as pure projections of the snapshot's canonical `drawnPolygon`
// (W3.1/W4 — see drafting/templates/roof.ts). Injecting canonical dimensions
// and re-rendering leaves all 682 `<polygon>` elements byte-identical.
//
// It DOES affect every consumer of `CADPanel.widthM/heightM` and the solvers'
// derived geometry — cable run-length derivation (lib/bom/deriveRunLengths.ts),
// the unscoped array-layout and structural-input paths, the placement engine,
// the digital twin, and the ground/fence drafting templates, none of which have
// a canonical `drawnPolygon` to fall back on. Those were computing against a
// module ~10.7% smaller in area than the one actually selected.
//
// ─── WHY NOT JUST CORRECT THE FIELD NAMES AT THE SEAM ──────────────────────
// Because that seam reads `inverters[0].strings[0]` — the "panel0" path. On a
// hybrid design that writes the FENCE module's dimensions onto the roof, which
// is precisely the disease `permit/utils/panelSpecs.ts` was built to kill. The
// footprint must be resolved PER SUB, from the canonical identity, which is
// what this module does. `project.panel*` stays a last resort and is never
// preferred over an established identity.
//
// ─── FAIL-CLOSED ───────────────────────────────────────────────────────────
// When no identity is established and no scalar was posted, this still returns
// a drawable size — a solver cannot emit nothing — but it marks
// `established: false` and states why. The caller pushes that onto
// `CADModel.warnings` so a fabricated footprint is visible in the generation
// log and in the model, never silent as it was before.
// ═══════════════════════════════════════════════════════════════════════════

import {
  resolveSubsystemModuleIdentity,
  resolveFleetModuleIdentities,
  type CanonicalModuleIdentity,
  type ModuleCatalog,
} from '@/lib/equipment/moduleIdentity';

export type CADPanelFootprintSource =
  | 'subsystem-map'            // project.subSystems[key].panelId — the one owner
  | 'fleet-unique'             // the whole fleet resolves to exactly ONE module
  | 'project-scalars'          // posted project.panelLengthIn/WidthIn
  | 'unestablished-placeholder'; // nothing resolved — flagged, never silent

export interface CADPanelFootprint {
  /** long dimension, inches (portrait height). */
  lengthIn: number;
  /** short dimension, inches (portrait width). */
  widthIn: number;
  /** true ⇔ the size came from an established module identity or a posted scalar. */
  established: boolean;
  panelId: string | null;
  model: string | null;
  source: CADPanelFootprintSource;
  /** auditable: how the footprint was decided, or why it could not be. */
  basis: string;
}

/** The last-resort size. Kept ONLY so a solver can still draw something; it is
 *  never returned with `established: true`, and it matches no catalogue module
 *  by design — a reviewer seeing 66×40 in a model is seeing a refusal. */
export const UNESTABLISHED_PANEL_LENGTH_IN = 66;
export const UNESTABLISHED_PANEL_WIDTH_IN = 40;

export type CADSubSystemKey = 'roof' | 'ground' | 'fence';

/** The CAD input shape, structurally — no import of the permit or drafting
 *  layers, so this stays a leaf module the solvers can depend on. */
export interface PanelFootprintSource {
  project?: {
    subSystems?: Record<string, { panelId?: string | null } | null | undefined> | null;
    panelId?: string | null;
    panelLengthIn?: number | null;
    panelWidthIn?: number | null;
  } | null;
  system?: {
    inverters?: Array<{
      strings?: Array<{
        panelId?: string | null;
        panelManufacturer?: string | null;
        panelModel?: string | null;
        panelWatts?: number | null;
      }> | null;
    } | null | undefined> | null;
  } | null;
}

const pos = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null;

function fromSpec(
  idn: CanonicalModuleIdentity, source: CADPanelFootprintSource, basis: string,
): CADPanelFootprint | null {
  const spec = idn.spec;
  const l = pos(spec?.length), w = pos(spec?.width);
  // A catalogue row without usable dimensions is NOT a footprint. Falling
  // through is correct: the identity is established, the SIZE is not.
  if (!spec || l == null || w == null) return null;
  return {
    // long ≥ short always, so a catalogue row with the pair transposed cannot
    // silently rotate every module in the drawing.
    lengthIn: Math.max(l, w),
    widthIn: Math.min(l, w),
    established: true,
    panelId: spec.id,
    model: spec.model ?? null,
    source, basis,
  };
}

/**
 * THE footprint accessor for the CAD solvers.
 *
 * Precedence mirrors `permit/utils/panelSpecs.ts` so CAD and the permit sheets
 * cannot disagree about which module a sub-system carries.
 */
export function resolveCADPanelFootprint(
  input: PanelFootprintSource | null | undefined,
  subKey: CADSubSystemKey,
  opts?: { catalog?: ModuleCatalog },
): CADPanelFootprint {
  const project = input?.project ?? null;

  // ── 1 · The per-sub equipment map — the one owner of a sub's module ───────
  const mapped = project?.subSystems?.[subKey];
  if (mapped?.panelId) {
    const idn = resolveSubsystemModuleIdentity(mapped, opts);
    const fp = fromSpec(idn, 'subsystem-map',
      `project.subSystems.${subKey}.panelId → ${idn.basis}`);
    if (fp) return fp;
  }

  // ── 2 · The fleet, but ONLY when it is unambiguous ────────────────────────
  // With one distinct established identity across every string there is nothing
  // to choose between, so the sub inherits it. With two or more this module
  // refuses rather than picking: on a hybrid, guessing here is exactly how the
  // fence module's dimensions end up on the roof.
  const fleet = resolveFleetModuleIdentities(input?.system ?? null, opts);
  const established = [...fleet.values()].filter(i => i.established && i.spec);
  const distinct = new Set(established.map(i => i.panelId));
  if (distinct.size === 1) {
    const fp = fromSpec(established[0], 'fleet-unique',
      `no subSystems.${subKey} entry; every fleet string resolves to the same module — ${established[0].basis}`);
    if (fp) return fp;
  }

  // ── 3 · Posted project scalars — honest, but not authoritative ────────────
  const l = pos(project?.panelLengthIn), w = pos(project?.panelWidthIn);
  if (l != null && w != null) {
    return {
      lengthIn: Math.max(l, w), widthIn: Math.min(l, w),
      established: true, panelId: null, model: null,
      source: 'project-scalars',
      basis: `no resolvable per-sub identity for '${subKey}'; using posted project.panelLengthIn/panelWidthIn `
        + `(${l} × ${w} in) — not catalogue-backed`,
    };
  }

  // ── 4 · FAIL CLOSED, loudly ───────────────────────────────────────────────
  const why = distinct.size > 1
    ? `the fleet carries ${distinct.size} distinct modules (${[...distinct].join(', ')}) and sub-system '${subKey}' `
      + 'has no subSystems entry naming which one it uses'
    : established.length === 0
      ? `no module identity could be established for sub-system '${subKey}' (no subSystems entry, no resolvable fleet string)`
      : `sub-system '${subKey}' resolved an identity whose catalogue row carries no usable dimensions`;
  return {
    lengthIn: UNESTABLISHED_PANEL_LENGTH_IN,
    widthIn: UNESTABLISHED_PANEL_WIDTH_IN,
    established: false, panelId: null, model: null,
    source: 'unestablished-placeholder',
    basis: `${why} — CAD is drawing a ${UNESTABLISHED_PANEL_LENGTH_IN}×${UNESTABLISHED_PANEL_WIDTH_IN} in `
      + 'PLACEHOLDER that matches no catalogue module; module footprint, derived run lengths and any '
      + 'geometry computed from them are NOT authoritative',
  };
}

/** The one-line warning a solver pushes onto `CADModel.warnings`. Returns null
 *  when the footprint is established and needs no notice. */
export function panelFootprintWarning(
  fp: CADPanelFootprint, subKey: CADSubSystemKey,
): string | null {
  if (fp.established && fp.source !== 'project-scalars') return null;
  return fp.established
    ? `${subKey}CAD: module footprint ${fp.lengthIn}×${fp.widthIn} in taken from posted project scalars, `
      + 'not from a catalogue module identity'
    : `${subKey}CAD: MODULE FOOTPRINT NOT ESTABLISHED — ${fp.basis}`;
}
