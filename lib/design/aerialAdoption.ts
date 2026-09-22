// ═══════════════════════════════════════════════════════════════════════════
// ADOPTING A FRESH ROOF DETECTION WITHOUT DESTROYING SOMEBODY'S WORK.
//
// WHAT WAS WRONG
// --------------
// "Detect roof from aerial" ended in one line:
//
//     const planes = data.planes as RoofPlane[];
//     setRoofPlanes(planes);
//
// No merge, no guard, no confirmation, no undo — and the autosave persists
// three seconds later. An installer who spent an hour tracing a complex roof
// and then clicked the button to COMPARE lost all of it, irrecoverably, from
// inside the studio.
//
// It is the same class as the traced-garage deletion that lib/siteIdentity.ts
// forbids in as many words — "never infer a delete from a coordinate change.
// ABSENCE IS NOT INTENT" — except worse, because nothing here is even inferred.
// It is unconditional.
//
// Note that the GOOGLE path was already correct: it merges by id. Two fetches
// of the same kind of thing, two opposite behaviours, in one component. That is
// why this is a module and not a patch at the call site.
//
// THE RULE
// --------
// A machine's fresh read may replace the machine's previous guesses. It may
// never replace a person's work without being told to, in so many words.
// ═══════════════════════════════════════════════════════════════════════════

import type { RoofPlane } from '@/types';

/**
 * Is this face somebody's WORK, as opposed to a machine's unreviewed guess?
 *
 * Three ways to qualify, and any one is enough:
 *   • it was traced or built by a person (`source: 'manual'`, or it belongs to
 *     a building section, which only a person can create);
 *   • a person reviewed it and said yes (`confirmed`), whatever produced it —
 *     a confirmed Google plane is a decision, not a guess;
 *   • it carries panels… which this function deliberately does NOT check,
 *     because it cannot see them. The caller owns that, and `planAerialAdoption`
 *     takes the panelled plane ids explicitly rather than guessing.
 */
export function isHandModelledFace(p: RoofPlane | null | undefined): boolean {
  if (!p) return false;
  if (p.sectionId) return true;
  if (p.source === 'manual' || p.source === 'imported') return true;
  if (p.confirmed === true) return true;
  return false;
}

export type AerialAdoptionMode = 'replaced' | 'refused' | 'confirmed-replace';

export interface AerialAdoptionRefusal {
  code: 'WOULD_DESTROY_MODELLED_GEOMETRY';
  message: string;
  /** The faces that would be lost, so the prompt can name them. */
  faceIds: string[];
}

export interface AerialAdoptionPlan {
  /**
   * 🚨 A UNIFORM SHAPE. `strict: false` here means narrowing on `ok` does not
   * hold, so every field is always present and `planes` is always an array a
   * caller can render.
   */
  ok: boolean;
  mode: AerialAdoptionMode;
  /** What `roofPlanes` should become. On a refusal this is the EXISTING list,
   *  unchanged — a refused adoption must be a no-op, not an empty roof. */
  planes: RoofPlane[];
  /** How many of the person's faces this actually removed. Zero unless the
   *  operator confirmed the replace. */
  destroyedCount: number;
  refusals: AerialAdoptionRefusal[];
}

export interface AerialAdoptionInput {
  existing: ReadonlyArray<RoofPlane> | null | undefined;
  incoming: ReadonlyArray<RoofPlane> | null | undefined;
  /** The site the detection was made FOR. Stamped onto incoming faces that
   *  carry none, so a detection cannot be adopted by the wrong property. */
  siteKey?: string | null;
  /** Plane ids that currently carry panels. Losing one silently unsticks an
   *  array, so a panelled face counts as work whatever produced it. */
  panelledPlaneIds?: ReadonlyArray<string> | null;
  /** The operator was shown what would be lost and said replace anyway. */
  confirmedReplace?: boolean;
}

/**
 * Decide what a fresh aerial detection is allowed to do to the current roof.
 *
 * Pure. The caller renders the outcome and, on a refusal, asks the operator —
 * it does not re-derive the rule, because a rule that lives at a call site is a
 * rule the next call site does not have.
 */
export function planAerialAdoption(input: AerialAdoptionInput): AerialAdoptionPlan {
  const existing = (input.existing ?? []).slice();
  const panelled = new Set(input.panelledPlaneIds ?? []);

  // Stamp ownership on the way in. 🚨 NEVER RE-STAMP a face that already names
  // a different site — that is how one property's roof gets adopted by another.
  const incoming = (input.incoming ?? []).map(p =>
    (!p.siteKey && input.siteKey) ? { ...p, siteKey: input.siteKey } : p,
  );

  const isWork = (p: RoofPlane) => isHandModelledFace(p) || panelled.has(p.id);
  const protectedFaces = existing.filter(isWork);

  if (protectedFaces.length > 0 && !input.confirmedReplace) {
    return {
      ok: false,
      mode: 'refused',
      planes: existing,           // a refusal is a NO-OP, never an empty roof
      destroyedCount: 0,
      refusals: [{
        code: 'WOULD_DESTROY_MODELLED_GEOMETRY',
        message:
          `This detection would replace ${protectedFaces.length} roof ` +
          `${protectedFaces.length === 1 ? 'face' : 'faces'} you modelled or confirmed. ` +
          'Nothing has been changed. Delete the faces you want re-detected, or ' +
          'confirm the replacement.',
        faceIds: protectedFaces.map(p => p.id),
      }],
    };
  }

  return {
    ok: true,
    mode: input.confirmedReplace && protectedFaces.length > 0 ? 'confirmed-replace' : 'replaced',
    planes: incoming,
    destroyedCount: input.confirmedReplace ? protectedFaces.length : 0,
    refusals: [],
  };
}
