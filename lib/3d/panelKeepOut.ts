/**
 * lib/3d/panelKeepOut.ts
 *
 * ONE PHYSICAL VALIDITY AUTHORITY FOR OBSTRUCTIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN AUDIT FOUND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The owner's instruction was explicit: "Manual placement and Auto Layout must
 * share the same physical validity authority. We already found `addRow`
 * bypassing containment once. Do not allow another placement path to have
 * different rules."
 *
 * A trace of every placement entry point found that the rules were not merely
 * different — for obstructions there were almost none:
 *
 *   • `placePanelsControlled` in lib/3d/controlLayer.ts is the ONE chokepoint
 *     for every 3D placement path (auto_roof, plane3d, surface_select, add_row,
 *     extend_row, single, ground, fence) and it had NO obstruction awareness at
 *     all. A grep for obstruction/keepout across lib/3d/ returned zero matches.
 *   • The only keep-out filter, `filterPanelsByObstructions`, was applied at
 *     exactly three 2D call sites — and all three are downstream of a
 *     `routeLayoutTo3D()` early-return, so in 3D mode, which is where roofs are
 *     modelled, none of them ran.
 *   • `keepOutZones` was populated from ONE place: the Nearmap AI fetch. The
 *     obstructions a person PLACES live in `placedObstructions` and were never
 *     converted, so a hand-marked chimney was consulted by no placement path in
 *     the product, 2D or 3D.
 *
 * 🚨 AND BOTH EXISTING TESTS USED THE PANEL CENTRE. `isPanelInsideObstruction`
 * and `panelOverlapsKeepOut` both ask "is the panel's lat/lng inside the
 * footprint". A module is about 1.13 m x 1.72 m and a default vent is 0.6 m
 * across; the centre of a module lands inside that circle for only a small
 * fraction of the positions where the module physically covers it. A vent
 * removed a panel roughly one time in five and the other four times the layout
 * put a module straight through it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A keep-out is the obstruction's FOOTPRINT grown by its CLEARANCE, and a panel
 * conflicts when its FOOTPRINT overlaps it — not when its centre does. Both are
 * compared as axis-aligned boxes in local metres, which for a rotated module is
 * a conservative over-estimate. That is the correct direction to be wrong in: a
 * keep-out that is slightly too large costs one module, and one that is too
 * small costs a truck roll and a hole in somebody's roof.
 */

/** Anything with a footprint that panels must avoid. Structural so this module
 *  needs no `types` import and is unit-testable against plain objects. */
export interface KeepOutObject {
  id?: string;
  lat: number;
  lng: number;
  /** Aurora-parity rectangular footprint, metres. */
  widthM?: number;
  depthM?: number;
  /** Legacy circular footprint, metres. */
  radiusM?: number;
  /** How far panels must stay from the footprint, metres. Absent means the
   *  type default; see `clearanceFor`. */
  clearanceM?: number;
  /** How far it stands proud of the roof. Not used for the keep-out — it is
   *  what makes the object cast shade — but carried so one record serves both. */
  heightM?: number;
  type?: string;
  /**
   * 🚨 A SITE OBJECT OCCUPIES NO ROOF AREA. A tree beside the house overhangs
   * the roof and shades it; it does not stop a module being bolted down under
   * it. Removing panels under a tree would be a physically false answer AND a
   * commercially wrong one — shaded production is a derate, not a no-build.
   * Absent reads as 'roof', which is what every stored obstruction was before
   * this existed.
   */
  space?: 'roof' | 'site';
}

/** Anything that occupies roof area. */
export interface KeepOutPanel {
  id?: string;
  lat: number;
  lng: number;
  /** CAD module dimensions in feet, as `PlacedPanel` carries them. */
  widthFeet?: number;
  heightFeet?: number;
}

const M_PER_DEG_LAT = 111_320;
const FT_TO_M = 0.3048;

/**
 * DEFAULT CLEARANCE, BY WHAT THE THING IS.
 *
 * 🚨 ZERO WAS THE OLD ANSWER FOR EVERYTHING, and zero is wrong for all of
 * these. A plumbing stack needs room for the boot and for a hand; a chimney
 * needs room for flashing and for the code-required clearance to combustibles;
 * a skylight needs its curb kept clear so the flashing can be replaced without
 * pulling modules. These are working defaults an installer can override per
 * object, not standards citations — the field is editable for exactly that
 * reason.
 */
export const DEFAULT_CLEARANCE_M: Record<string, number> = {
  vent: 0.15,
  vent_pipe: 0.15,
  plumbing_stack: 0.20,
  chimney: 0.45,
  skylight: 0.15,
  roof_hatch: 0.90,
  hvac: 0.90,
  dormer: 0.15,
  tree: 0,
  other: 0.15,
};

export const FALLBACK_CLEARANCE_M = 0.15;

export function clearanceFor(o: KeepOutObject | null | undefined): number {
  if (!o) return 0;
  if (Number.isFinite(o.clearanceM) && o.clearanceM >= 0) return o.clearanceM;
  const byType = DEFAULT_CLEARANCE_M[String(o.type ?? '').toLowerCase()];
  return Number.isFinite(byType) ? byType : FALLBACK_CLEARANCE_M;
}

/** Half-extents of the keep-out box, in metres: footprint plus clearance. */
export function keepOutHalfExtentsM(o: KeepOutObject): { halfX: number; halfY: number } {
  const c = clearanceFor(o);
  const rectW = Number.isFinite(o?.widthM) && o.widthM > 0 ? o.widthM : 0;
  const rectD = Number.isFinite(o?.depthM) && o.depthM > 0 ? o.depthM : 0;
  if (rectW > 0 && rectD > 0) {
    return { halfX: rectW / 2 + c, halfY: rectD / 2 + c };
  }
  const r = Number.isFinite(o?.radiusM) && o.radiusM > 0 ? o.radiusM : 0;
  return { halfX: r + c, halfY: r + c };
}

/** Half-extents of the module, in metres. A module with no CAD dimensions falls
 *  back to a standard 60-cell residential module rather than to zero — zero
 *  would silently restore the centre-point test this module exists to replace. */
export function panelHalfExtentsM(p: KeepOutPanel): { halfX: number; halfY: number } {
  const w = Number.isFinite(p?.widthFeet) && p.widthFeet > 0 ? p.widthFeet * FT_TO_M : 1.134;
  const h = Number.isFinite(p?.heightFeet) && p.heightFeet > 0 ? p.heightFeet * FT_TO_M : 1.722;
  return { halfX: w / 2, halfY: h / 2 };
}

/**
 * Does this module's footprint overlap this keep-out?
 *
 * 🚨 FOOTPRINT AGAINST FOOTPRINT. The panel is treated as an axis-aligned box
 * of its own size, which for a module rotated to the roof's azimuth is larger
 * than the module really is. Conservative on purpose — see the header.
 */
export function panelHitsKeepOut(panel: KeepOutPanel, obs: KeepOutObject): boolean {
  if (!panel || !obs) return false;
  // See `space`: a site object shades, it does not occupy.
  if (obs.space === 'site') return false;
  if (!Number.isFinite(panel.lat) || !Number.isFinite(obs.lat)) return false;
  const cosLat = Math.cos((obs.lat * Math.PI) / 180);
  const dyM = (panel.lat - obs.lat) * M_PER_DEG_LAT;
  const dxM = (panel.lng - obs.lng) * M_PER_DEG_LAT * cosLat;
  const k = keepOutHalfExtentsM(obs);
  const p = panelHalfExtentsM(panel);
  // 1 mm slack so a module that exactly abuts the clearance line is allowed,
  // rather than flickering in and out on floating-point noise.
  return Math.abs(dxM) < k.halfX + p.halfX - 0.001
      && Math.abs(dyM) < k.halfY + p.halfY - 0.001;
}

/**
 * THE ONE FILTER. Every placement path calls this — auto, manual, row, snap,
 * fill — so no path can have different rules about what is physically there.
 */
export function filterPanelsByKeepOut<T extends KeepOutPanel>(
  panels: T[] | null | undefined,
  obstructions: KeepOutObject[] | null | undefined,
): { panels: T[]; removed: T[] } {
  const all = Array.isArray(panels) ? panels : [];
  const obs = (Array.isArray(obstructions) ? obstructions : []).filter(
    o => o && Number.isFinite(o.lat) && Number.isFinite(o.lng),
  );
  if (obs.length === 0) return { panels: all, removed: [] };
  const kept: T[] = [];
  const removed: T[] = [];
  for (const p of all) {
    if (obs.some(o => panelHitsKeepOut(p, o))) removed.push(p);
    else kept.push(p);
  }
  return { panels: kept, removed };
}

/**
 * Is this ONE position legal? For interactive placement — the ghost preview,
 * the snap cursor, a click — where the question is about a module that does not
 * exist yet.
 *
 * Same authority, same arithmetic. A preview that says "valid" and a commit
 * that removes the module are two answers to one question.
 */
export function positionClearsKeepOut(
  at: KeepOutPanel,
  obstructions: KeepOutObject[] | null | undefined,
): { ok: boolean; blockedBy: string } {
  const obs = Array.isArray(obstructions) ? obstructions : [];
  for (const o of obs) {
    if (!o || !Number.isFinite(o.lat)) continue;
    if (panelHitsKeepOut(at, o)) {
      return { ok: false, blockedBy: o.type ? String(o.type) : (o.id ?? 'obstruction') };
    }
  }
  return { ok: true, blockedBy: '' };
}

/** The keep-out footprint as a lat/lng ring, for drawing the clearance the user
 *  is promised and for the 2D paths that speak in polygons. Four corners, in
 *  order, closed by the consumer. */
export function keepOutRing(o: KeepOutObject): Array<{ lat: number; lng: number }> {
  const k = keepOutHalfExtentsM(o);
  const cosLat = Math.max(1e-9, Math.cos((o.lat * Math.PI) / 180));
  const dLat = k.halfY / M_PER_DEG_LAT;
  const dLng = k.halfX / (M_PER_DEG_LAT * cosLat);
  return [
    { lat: o.lat - dLat, lng: o.lng - dLng },
    { lat: o.lat - dLat, lng: o.lng + dLng },
    { lat: o.lat + dLat, lng: o.lng + dLng },
    { lat: o.lat + dLat, lng: o.lng - dLng },
  ];
}
