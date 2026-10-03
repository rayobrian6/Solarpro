/**
 * lib/3d/sectionViewRules.ts
 *
 * WHAT THE 3D VIEW DOES ABOUT A BUILDING SECTION — four small decisions that
 * used to be written inline in SolarEngine3D, where only a source-text guard
 * could see them.
 *
 * 🚨 WHY THEY ARE HERE. Each of these was guarded by a regex over a
 * 20,000-line component, and a review found two mutations that every such
 * guard let through: a prism predicate that compared a FACE id to a SECTION
 * id (so no prism was ever hidden), and a "kind before" lookup that read a
 * field the face does not carry (so every eave nudge turned the walls on).
 * A rule that only a regex protects is protected against being deleted, not
 * against being wrong. As pure functions they are tested by what they decide.
 *
 * Nothing here writes geometry or labels it. Section faces are user-authored
 * (`source: 'user-traced'`); these rules only decide what is shown.
 */

import type { RoofPlane, RoofSectionKind } from '@/types';
import { sectionIdOfFaceId } from './buildingSection';
import { sectionFromPlanes, type SectionEditOutcome } from './sectionEditing';

/** Below this tilt a face reads as level. The same 1° the Building view measures with. */
export const LEVEL_TILT_DEG = 1;

/** The section a face belongs to — by the authority's own rule, not a guess. */
function sectionOfFace(p: RoofPlane): string | null {
  return p.sectionId || sectionIdOfFaceId(p.id);
}

/**
 * The roof kind a section has in this plane list, or null when the authority
 * cannot name one (no such section, no record, conflicting records).
 *
 * 🚨 READ THROUGH `sectionFromPlanes`, THE SAME LOOKUP `applySectionEdit` USES.
 * The inline version took the FIRST face matching `sectionId ?? section?.id`
 * and read its `section`. A face with no record (or a record naming another
 * section) then gave null where the authority found a gable — and the caller
 * read null → 'gable' as "the kind changed" and turned the walls on for an
 * ordinary eave edit.
 */
export function sectionKindOf(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string,
): RoofSectionKind | null {
  if (!sectionId) return null;
  const look = sectionFromPlanes(planes, sectionId);
  return look.found && look.section ? look.section.kind : null;
}

/**
 * Did this edit change the section's roof kind?
 *
 * Only an ACCEPTED edit can; a refusal changed nothing. `kindBefore` is null
 * only when the authority could not find the section, and then the edit was
 * refused too, so null never reads as a change on its own.
 */
export function editChangedRoofKind(
  kindBefore: RoofSectionKind | null,
  outcome: Pick<SectionEditOutcome, 'ok' | 'section'>,
): boolean {
  if (!outcome.ok || !outcome.section) return false;
  if (kindBefore === null) return false;
  return outcome.section.kind !== kindBefore;
}

/**
 * Should a Block's prism be hidden?
 *
 *   `sectionId` null      — the Block's roof face was REFUSED (no ground
 *                           elevation yet). The prism is the only massing there
 *                           is, so it stays, whatever the Building view says.
 *   section in the design — hidden while the Building view is on: the section's
 *                           walls are the massing and the box would show
 *                           through a gable end. Shown while it is off.
 *   section NOT in the design — hidden, whatever the Building view says. The
 *                           section was deleted, or its creation was undone, and
 *                           a box standing where the house was just removed is
 *                           a ghost. (Undo the deletion and it is back in the
 *                           design, so the row above applies again.)
 *
 * 🚨 MEMBERSHIP BY SECTION, NOT BY FACE ID. Section faces are
 * `<sectionId>::deck`, `<sectionId>::slopeA`, …; no face's id IS the section
 * id, so a test like `p.id === sectionId` is never true.
 */
export function blockPrismHidden(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string | null | undefined,
  buildingViewOn: boolean,
): boolean {
  if (!sectionId) return false;
  const inDesign = (planes ?? []).some(p => sectionOfFace(p) === sectionId);
  if (!inDesign) return true;
  return buildingViewOn;
}

/**
 * Which face should be selected after a section was rebuilt?
 *
 * 🚨 A KIND CHANGE REMOVES FACES, AND THE SELECTED ONE IS USUALLY AMONG THEM.
 * On a Block the only face is `::deck`, so it is what the user clicked to reach
 * the Roof row — and Gable removes it. Left alone, the "a selection cannot
 * outlive its face" effect cleared the selection a render later; that closed
 * the inspector and wiped the orphaned-panel notice the same edit had just
 * raised, so 36 modules were left inside the attic with nothing on screen.
 *
 * The section is still there, so the selection moves to one of its surviving
 * faces (the first the rebuild lists — ids are deterministic). A selection the
 * edit did not touch is returned unchanged, and so is no selection.
 */
export function selectionAfterRebuild(
  activeFaceId: string | null | undefined,
  outcome: Pick<SectionEditOutcome, 'ok' | 'planes' | 'removedFaceIds'>,
): string | null {
  if (!activeFaceId) return null;
  if (!outcome.ok || !outcome.removedFaceIds.includes(activeFaceId)) return activeFaceId;
  const sid = sectionIdOfFaceId(activeFaceId);
  if (!sid) return null;
  const survivor = outcome.planes.find(p => sectionOfFace(p) === sid);
  return survivor ? survivor.id : null;
}

/**
 * Is this face level because its section SAYS so?
 *
 * The Building view warns "⚠ N face(s) are FLAT" so a trace that was flattened
 * somewhere upstream is not shaded like a real roof. A Block's deck, a flat
 * section or a 0° shed is level on purpose, and flagging it told the person who
 * just placed a flat garage that something was wrong.
 *
 * A face Stitch or Square Up reshaped no longer follows its record, so its
 * record cannot vouch for it.
 */
export function isLevelByDesign(plane: RoofPlane | null | undefined): boolean {
  const s = plane?.section;
  if (!plane || !s || plane.sectionFaceReshaped) return false;
  if (s.kind === 'flat') return true;
  const own = plane.sectionFaceKey ? s.facePitchDeg?.[plane.sectionFaceKey] : undefined;
  const asked = own ?? s.pitchDeg;
  return typeof asked === 'number' && Number.isFinite(asked) && Math.abs(asked) < LEVEL_TILT_DEG;
}
