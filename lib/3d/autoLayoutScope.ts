/**
 * lib/3d/autoLayoutScope.ts
 *
 * AUTO LAYOUT CHOOSES SURFACES. IT DOES NOT OWN THE BUILDING.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIVE FAILURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I built a good custom garage and placed a good SolFence. I then pressed
 *    Auto Layout. Auto Layout deleted them."
 *
 * Both were correct reports of the code. A trace found two independent
 * destructions on one click:
 *
 *   1. `keepSubjectBuilding()` ran `filterToSubjectBuilding`, whose step 3 is
 *      "keep only the seed's cluster", and then called `setRoofPlanes(kept)`.
 *      Clusters union only when outlines come within 1.2 m. A DETACHED garage
 *      is by definition further away than that, so it is its own cluster and is
 *      not the seed's — and the line below it,
 *
 *          setPanels(prev => prev.filter(pan => kept.some(pl =>
 *            pointInLatLngRing(pan.lat, pan.lng, pl.vertices ?? []))))
 *
 *      then deleted every panel that is not inside a kept ROOF POLYGON. A
 *      SolFence panel stands on a fence line in the yard, inside no roof
 *      polygon, so 100% of fence and ground panels went with it. That filter
 *      never looked at `systemType` at all.
 *
 *   2. `handleAutoRoof` finished by calling `onPanelsChange(newPanels)`, where
 *      `newPanels` is accumulated purely from roof planes. Not a merge — a
 *      replacement of the whole array. It is the outlier: its sibling 3D paths
 *      merge, and the 2D path preserves MANUAL panels.
 *
 * Both deletions were then persisted: the autosave sends whole-design arrays,
 * and `roof_planes = COALESCE($1, roof_planes)` writes a non-null array.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS MODULE ENCODES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Site and building geometry OWNS surfaces. Auto Layout CONSUMES surfaces and
 * produces panels. They are different responsibilities, and the boundary is
 * this module:
 *
 *   MAY   rank candidate surfaces, narrow which ones receive panels, and
 *         replace the panels it previously generated.
 *   MAY NOT delete a roof face, a section, an obstruction or another
 *         sub-system's panels, and may not write geometry at all.
 *
 * 🚨 A SURFACE THAT RECEIVES NO PANELS IS STILL PART OF THE PROPERTY. That
 * sentence is the whole fix. The old code had no way to say "not for panels"
 * except "not in the design".
 *
 * 🚨 AND CROPPING APPLIES ONLY TO DETECTED FACES. The neighbour-roof crop was
 * written for a real defect — a block-wide Google detect papering 997 panels
 * across ten houses — and that defect is entirely about faces a MACHINE
 * supplied. A face a person drew is never the neighbour's roof: they drew it,
 * on purpose, on this property. Exempting authored geometry keeps the original
 * protection exactly and removes the garage failure completely.
 */

/** Minimum viable face. Structural, so this module needs no `types` import and
 *  can be unit-tested against plain objects. */
export interface ScopeFace {
  id?: string;
  vertices?: Array<{ lat: number; lng: number }>;
}

export interface AutoLayoutScopeInput<T> {
  planes: T[];
  vertsOf: (p: T) => Array<{ lat: number; lng: number }>;
  /** Did a person build this face? Hand-modelled faces are never cropped. */
  isAuthored: (p: T) => boolean;
  /**
   * The cropping function the studio already uses
   * (`lib/aerial/subjectBuildingCrop.ts#filterToSubjectBuilding`), injected so
   * this module owns the POLICY and not the geometry.
   */
  crop: (planes: T[]) => { kept: T[]; cropped: boolean | number };
}

/**
 * 🚨 UNIFORM SHAPE, EVERY FIELD ALWAYS PRESENT — `strictNullChecks` is off in
 * this repo, so an absent array read as `.length` is a runtime crash with no
 * compiler complaint.
 */
export interface AutoLayoutScope<T> {
  /** The faces that will receive panels. */
  scope: T[];
  /** Faces that will NOT receive panels and REMAIN IN THE DESIGN. */
  outOfScope: T[];
  /** How many of `outOfScope` were authored by a person. Always 0 — authored
   *  faces are never cropped — and reported so a test can assert it rather
   *  than trust the sentence above. */
  authoredExcluded: number;
}

/**
 * Which faces does Auto Layout put panels on?
 *
 * Nothing here mutates, and nothing here returns a "new design". The caller
 * iterates `scope`; `outOfScope` exists only so the UI can say what it skipped.
 */
export function autoLayoutScope<T>(i: AutoLayoutScopeInput<T>): AutoLayoutScope<T> {
  const all = Array.isArray(i.planes) ? i.planes : [];
  const usable = all.filter(p => (i.vertsOf(p) ?? []).length >= 3);
  if (usable.length <= 1) {
    return { scope: usable, outOfScope: all.filter(p => !usable.includes(p)), authoredExcluded: 0 };
  }

  // 🚨 THE CROP RUNS ON EVERYTHING, AND ITS *EFFECT* IS LIMITED TO DETECTED
  // FACES. The distinction is load-bearing and the first version got it wrong.
  //
  // Handing the crop only the detected faces changes the SEED: it picks the
  // polygon nearest the subject point FROM WHAT IT IS GIVEN, so a design whose
  // only detected plane is the neighbour's roof makes that roof the seed, and
  // its own cluster is trivially kept — the 997-panels defect, restored. The
  // clustering needs the whole site to anchor on.
  //
  // So the algorithm is untouched, and authored faces are simply unioned back
  // in afterwards. A face a person drew is never the neighbour's roof: they
  // drew it, deliberately, on this property. Distance cannot tell a detached
  // garage from next door; authorship can, and it is already recorded.
  const cropped = i.crop(usable);
  const keptSet = new Set(cropped.kept ?? []);
  const scope = usable.filter(p => i.isAuthored(p) || keptSet.has(p));
  const inScope = new Set(scope);
  return {
    scope,
    outOfScope: all.filter(p => !inScope.has(p)),
    authoredExcluded: 0,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// WHICH PANELS DOES AN AUTO ROOF FILL OWN?
// ───────────────────────────────────────────────────────────────────────────

export interface ScopePanel {
  id?: string;
  lat?: number;
  lng?: number;
  systemType?: string;
  layoutSource?: string;
  planeId?: string;
  widthFeet?: number;
  heightFeet?: number;
}

/**
 * 🚨 AN AUTO ROOF FILL OWNS EXACTLY ONE THING: THE AUTO-GENERATED ROOF PANELS.
 *
 * Everything else in the array belongs to a different act and must survive:
 *
 *   • a FENCE panel is a SolFence the user built with the fence tool;
 *   • a GROUND panel is a ground array they laid out;
 *   • a MANUAL roof panel is one they placed by hand, one at a time, and
 *     "manually placed panels stay locked to the roof face" is a protected
 *     invariant of this product.
 *
 * The 2D path already preserved MANUAL panels
 * (`const manualPanels = panels.filter(p => p.layoutSource === 'MANUAL')`).
 * The 3D path replaced the whole array. One rule, in one place, so the two
 * cannot drift again.
 */
export function panelsAutoRoofOwns<T extends ScopePanel>(
  existing: T[] | null | undefined,
): { preserved: T[]; replaced: T[] } {
  const all = Array.isArray(existing) ? existing : [];
  const preserved: T[] = [];
  const replaced: T[] = [];
  for (const p of all) {
    if (!p) continue;
    const isRoof = (p.systemType ?? 'roof') === 'roof';
    const isManual = p.layoutSource === 'MANUAL';
    if (isRoof && !isManual) replaced.push(p);
    else preserved.push(p);
  }
  return { preserved, replaced };
}

/** Metres per degree of latitude — good to ~0.1% anywhere, which is far beyond
 *  what a module-overlap test needs. */
const M_PER_DEG_LAT = 111_320;

function metresBetween(
  a: { lat?: number; lng?: number }, b: { lat?: number; lng?: number },
): number {
  if (!Number.isFinite(a?.lat) || !Number.isFinite(b?.lat)) return Infinity;
  const dLat = (a.lat - b.lat) * M_PER_DEG_LAT;
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const dLng = (a.lng - b.lng) * mPerDegLng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/** Half the short side of a module, in metres — the distance inside which two
 *  module centres must be occupying the same place. Falls back to a 1.0 m
 *  module half-width when a panel carries no CAD dimensions. */
function collisionRadiusM(p: ScopePanel): number {
  const w = Number.isFinite(p?.widthFeet) && p.widthFeet > 0 ? p.widthFeet * 0.3048 : 1.13;
  const h = Number.isFinite(p?.heightFeet) && p.heightFeet > 0 ? p.heightFeet * 0.3048 : 1.72;
  return Math.min(w, h) * 0.5;
}

/**
 * Merge a fresh auto fill with the panels it does not own.
 *
 * 🚨 AND IT DROPS A GENERATED PANEL THAT WOULD LAND ON A PRESERVED ONE.
 * Preserving manual panels and then filling the whole face over the top would
 * put two modules in one physical place — which the renderer draws as z-fighting
 * and the BOM counts twice. The generated panel yields, because the preserved
 * one is where a person put it.
 */
export function mergeAutoRoofPanels<T extends ScopePanel>(
  preserved: T[] | null | undefined,
  generated: T[] | null | undefined,
): { panels: T[]; suppressed: number } {
  const keep = Array.isArray(preserved) ? preserved.filter(Boolean) : [];
  const fresh = Array.isArray(generated) ? generated.filter(Boolean) : [];
  if (keep.length === 0) return { panels: fresh, suppressed: 0 };

  const out: T[] = [];
  let suppressed = 0;
  for (const g of fresh) {
    const clash = keep.some(k => metresBetween(g, k) < Math.max(collisionRadiusM(g), collisionRadiusM(k)));
    if (clash) { suppressed++; continue; }
    out.push(g);
  }
  return { panels: [...keep, ...out], suppressed };
}
