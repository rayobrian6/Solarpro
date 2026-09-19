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
