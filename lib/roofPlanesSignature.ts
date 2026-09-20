/**
 * lib/roofPlanesSignature.ts
 *
 * The autosave dedup signature for roof geometry.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * v66. DesignStudio saves a layout from two places — the 3-second debounced
 * autosave (`saveLayoutToDB`) and the `beforeunload` beacon — and each built
 * its own signature string inline. They drifted: both covered panels and the
 * electrical design, neither covered roof geometry. The payload always CARRIED
 * roofPlanes, so the bug was invisible in the request shape; only the trigger
 * and the dedup check were blind. The effect is that a design whose only change
 * was roof geometry never saved:
 *
 *   • trace a face and place no panels  → nothing ever schedules a save
 *   • edit a face's pitch after placing → `panels` is unchanged, so the
 *     signature compared equal and the save returned early
 *
 * Either way the roof was silently gone on reload. Exporting ONE function that
 * both call sites use is the structural fix; the drift is what caused the bug,
 * not the omission.
 *
 * WHY A PROJECTION AND NOT JSON.stringify(planes)
 * -----------------------------------------------
 * RoofPlane carries derived 3D fields (polygon3D, localFrame3D) that are
 * recomputed float arrays. They can differ by floating-point noise between
 * rebuilds of the same plane, which would make the signature change on every
 * tick and churn a DB write every 3 seconds. So we project the fields whose
 * change genuinely must reach the database.
 *
 * 🚨 ADDING A PERSISTED, USER-EDITABLE FIELD TO RoofPlane MEANS ADDING IT HERE.
 * If you don't, edits to that field will not trigger a save and will be lost on
 * reload — the exact bug this module exists to prevent. `SIGNED_FIELDS` and its
 * test in tests/roofPlanesSignature.test.ts are the guard.
 */

import type { RoofPlane } from '@/types';

/**
 * The RoofPlane fields that participate in the autosave signature.
 *
 * Declared as data (not inlined in the projection) so a test can assert the
 * list against the persisted surface of RoofPlane and fail loudly when someone
 * adds a field without considering persistence.
 */
export const SIGNED_FIELDS = [
  'id',
  'vertices',
  'pitch',
  'azimuth',
  'orientation',
  'edgeTypes',
  'source',
  'confirmed',
  // Which physical property the plane belongs to (lib/siteIdentity.ts). Signed
  // so that adopting a legacy plane onto the current site, or archiving one
  // because the address moved, actually schedules a save — otherwise ownership
  // would be recomputed from scratch on every reload and never persisted.
  'siteKey',
] as const satisfies readonly (keyof RoofPlane)[];

export type SignedField = (typeof SIGNED_FIELDS)[number];

/**
 * Build a stable dedup signature for a set of roof planes.
 *
 * Stability contract — the properties the tests pin:
 *   • same planes, same order          → identical string
 *   • any SIGNED_FIELDS value changes  → different string
 *   • derived 3D fields change only    → identical string (no spurious save)
 *   • plane order changes              → different string (order is meaningful:
 *     it is the order the sidebar lists faces and the planset numbers them)
 */
export function roofPlanesSignature(planes: readonly RoofPlane[] | undefined | null): string {
  if (!planes || planes.length === 0) return '[]';
  return JSON.stringify(
    planes.map(p => SIGNED_FIELDS.map(f => p[f] ?? null)),
  );
}

/**
 * Fields on DesignElectrical that must NOT enter the dedup signature.
 *
 * 🚨 `generatedAt` is `new Date().toISOString()`, stamped fresh every time
 * DesignStudio's `buildDesignElectrical()` runs. Including it made the whole
 * dedup check DEAD: the signature differed on every rebuild even when nothing
 * about the design had changed, so `if (sig === lastSavedPanelsRef.current)
 * return;` could never be true while a design had panels. Every scheduled
 * autosave POSTed, and the layout route runs `syncProjectPipeline()`
 * SYNCHRONOUSLY whenever the layout has panels — rebuilding the engineering
 * model and rewriting artifact files each time.
 *
 * A timestamp describes WHEN the object was built, never WHAT it contains.
 * Anything with that property belongs in this list.
 */
export const UNSIGNED_ELECTRICAL_FIELDS = ['generatedAt'] as const;

/** Drop the non-content fields before signing. Returns null for nullish input
 *  so an absent electrical design and an empty one sign identically. */
function signableElectrical(designElectrical: unknown): unknown {
  if (designElectrical === null || designElectrical === undefined) return null;
  if (typeof designElectrical !== 'object') return designElectrical;
  const out: Record<string, unknown> = { ...(designElectrical as Record<string, unknown>) };
  for (const f of UNSIGNED_ELECTRICAL_FIELDS) delete out[f];
  return out;
}

/**
 * THE layout dedup signature. Every call site that decides "has anything
 * changed since the last save?" must use this and nothing else.
 *
 * WHY THIS EXISTS ON TOP OF roofPlanesSignature
 * ---------------------------------------------
 * Four call sites each built the string inline: the debounced autosave, the
 * beforeunload beacon, and the two restore seeds. They drifted three ways at
 * once — the two writers signed three parts while the two SEEDS signed only
 * two (panels + electrical, no roof), so a restored layout could never compare
 * equal to its own first save; and all four included `generatedAt`, which made
 * the comparison meaningless anyway. The beacon even carried a comment saying
 * "Shared helper, one definition" above a hand-rolled copy of the string.
 *
 * Stability contract:
 *   • same content signed twice, any time apart → identical string
 *   • a restore seed and the first save of that same content → identical
 *   • any panel / signed-roof-field / electrical CONTENT change → different
 */
export function layoutSignature(input: {
  panels?: unknown;
  designElectrical?: unknown;
  roofPlanes?: readonly RoofPlane[] | null;
  /** The scalar design parameters and fence geometry the layout row carries.
   *
   *  🚨 WITHOUT THIS THEY CANNOT TRIGGER A SAVE. The autosave effect only fires
   *  on a signature change, so a design whose ONLY edit was a fence line, a row
   *  spacing or a ground tilt scheduled nothing — the same shape of defect as
   *  roof geometry before v66, and invisible for the same reason: the payload
   *  always carried the fields, so only the trigger was blind. */
  designParams?: LayoutDesignParams | null;
}): string {
  return JSON.stringify(input.panels ?? [])
    + '|' + JSON.stringify(signableElectrical(input.designElectrical))
    + '|' + roofPlanesSignature(input.roofPlanes)
    + '|' + designParamsSignature(input.designParams);
}

/** The persisted scalar/geometry fields of a layout, beyond panels, electrical
 *  and roof planes. Named as data so the projection below and the restore path
 *  cannot drift — the list IS the contract. */
export interface LayoutDesignParams {
  fenceLine?: ReadonlyArray<{ lat: number; lng: number }> | null;
  fenceHeight?: number | null;
  fenceAzimuth?: number | null;
  groundTilt?: number | null;
  groundAzimuth?: number | null;
  rowSpacing?: number | null;
  groundHeight?: number | null;
  bifacialOptimized?: boolean | null;
}

/** 🚨 Every persisted design parameter must appear here, or edits to it will
 *  not schedule a save and will be lost on reload. Declared as data so a test
 *  can assert it against the route's accepted body. */
export const SIGNED_DESIGN_PARAMS = [
  'fenceLine', 'fenceHeight', 'fenceAzimuth',
  'groundTilt', 'groundAzimuth', 'rowSpacing', 'groundHeight',
  'bifacialOptimized',
] as const satisfies readonly (keyof LayoutDesignParams)[];

function designParamsSignature(p: LayoutDesignParams | null | undefined): string {
  if (!p) return 'null';
  return JSON.stringify(SIGNED_DESIGN_PARAMS.map(f => p[f] ?? null));
}
