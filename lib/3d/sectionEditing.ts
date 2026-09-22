/**
 * lib/3d/sectionEditing.ts
 *
 * EDITING A BUILDING SECTION — and the physical meaning of every number shown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS: THE LIVE ACCEPTANCE FAILURE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The installer's report, verbatim:
 *
 *   "To get attached roof sections close to reality I am having to perform
 *    compensating edits: select one plane, move it vertically, select another
 *    plane that did not move, adjust Walls again, compensate for the previous
 *    adjustment, repeat until the geometry merely looks close. Worse, the UI
 *    reports wall/building heights around 17 ft while the modeled geometry
 *    visibly does not represent a 17 ft wall."
 *
 * Both halves of that are one defect: THE EDITOR HAD NO ABSOLUTE VERTICAL
 * DATUM. `SolarEngine3D.applyBuildingShape` back-solved a face's ground from a
 * global UI counter —
 *
 *     const groundM = lowest - prevWall;                    // invented
 *     roofPlaneFromFootprint(outline, { eaveHeightM: wall, groundElevM: groundM })
 *
 * — where `lowest` is that face's real lowest corner and `prevWall` is one
 * app-wide number that no face is obliged to match. The ground cancels, so the
 * press lands as a pure relative nudge of the one face it is scoped to. Three
 * consequences, all of which the installer felt:
 *
 *   1. THE READOUT NAMES NOTHING. `wallHeightM` starts at 3.0 m and only ever
 *      moves by what has been pressed. A section is created with a 6 m eave, so
 *      from the first frame the panel says 9.8 ft about a 19.7 ft wall.
 *
 *   2. A PER-FACE PRESS MOVES THE WHOLE-BUILDING COUNTER. The scope chip says
 *      THIS FACE and the geometry obeys it, but `adjustBuilding` writes
 *      `setWallHeightM(nextWall)` unconditionally. Raising an 8-face house by
 *      one foot costs 8 presses and moves the number by 8 ft. That is the
 *      arithmetic that reaches 17 ft.
 *
 *   3. A FACE IS NOT A VOLUME. Scoping to one face raises that face's eave AND
 *      its ridge, so the gable it belongs to comes apart at the ridge and the
 *      garage lifts off the wall it abuts. The user then has to raise the
 *      partner face to close it again — the compensating edit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A section already owns everything needed to state a physical answer
 * (`RoofSectionRecord` in types/index.ts):
 *
 *     groundElevM   absolute elevation of the pad, metres above the WGS84
 *                   ellipsoid — the same datum Cesium reports
 *     eaveHeightM   the wall: eave ABOVE THAT PAD, metres
 *     pitchDeg      the slope asked for
 *     footprint     the plan outline, canonical, never render-offset
 *
 *     ridge height  DERIVED. eave + halfSpan·tan(pitch). Never stored, never
 *                   edited, and therefore never able to disagree.
 *
 * So this module does not invent a vertical model. It makes the one that
 * already exists reachable: read the section off its faces, change ONE named
 * physical quantity, rebuild every face of that section together, and put them
 * back without touching any other section.
 *
 * 🚨 THE SECTION RECORD IS THE AUTHORITY, NOT THE RENDERED FACE. Every rebuild
 * goes through `buildSectionRoofPlanes`, which re-stamps the record onto every
 * face it owns. `applyBuildingShape` moved geometry and left `plane.section`
 * behind, so the canonical record and the geometry disagreed the moment the
 * user touched WALLS — two answers in one object, which is the same class of
 * defect as the pitch relabel this codebase has already been bitten by twice.
 *
 * 🚨 MEASURING A FACE IS NOT READING ITS polygon3D HEIGHT. Those points carry
 * SURFACE_OFFSET_M (0.12 m) along the face normal, so a 30 degree face's stored
 * corner sits 0.1039 m above the roof it represents. `measureFaceVertical`
 * removes it. A "measured eave elevation" that is 10 cm high is exactly the
 * kind of number that starts the next compensating edit.
 */

import type { PlacedPanel, RoofPlane } from '@/types';
import { SURFACE_OFFSET_M, ecefToLatLng, latLngToECEF, type Cart3 } from '@/lib/roofPlane3D';
import { moduleStackHeightM } from '@/lib/roofMountDatum';
import { evaluateGeometryMutation } from './geometryMutationPolicy';
import {
  type BuildingSection,
  type SectionFaceKey,
  type SectionRefusal,
  type SectionRidgeAxis,
  type SectionRoofKind,
  type SectionPlanOutcome,
  type LatLng,
  buildSectionRoofPlanes,
  faceIdsOfSection,
  faceKeyOfFaceId,
  faceKeysForKind,
  layoutSectionFaces,
  pitchForFace,
  replaceSectionFaces,
  sectionHasMixedPitch,
  sectionIdOfFaceId,
  sectionRecord,
  validateSection,
} from './buildingSection';
import { roofPlaneFromFootprint } from './footprintToRoofPlane';

const DEG = Math.PI / 180;
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;
const FT_PER_M = 3.280839895013123;

/** Metres per degree of latitude — the meridian radius of curvature. */
function mPerDegLat(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A * (1 - WGS84_E2) / Math.pow(w, 1.5)) * DEG;
}

/** Metres per degree of longitude — the prime-vertical radius of curvature. */
function mPerDegLng(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A / Math.sqrt(w)) * Math.cos(latDeg * DEG) * DEG;
}

// ── Reading the section back off its faces ──────────────────────────────────

export interface SectionLookup {
  /**
   * 🚨 UNIFORM SHAPE. `strict: false` and no strictNullChecks, so narrowing on
   * `found` does not survive to runtime. Every field is always present.
   */
  found: boolean;
  section: BuildingSection | null;
  faceIds: string[];
  /** Stored copies disagreed. NOT repaired by picking a winner — see below. */
  conflicted: boolean;
  /**
   * Faces of this section that Stitch or Square Up has reshaped by hand, so
   * their geometry is no longer what the section's parameters produce. See
   * `RoofPlane.sectionFaceReshaped`.
   */
  reshapedFaceIds: string[];
  refusals: SectionRefusal[];
}

/**
 * Find one section's canonical record among a set of planes.
 *
 * 🚨 A DISAGREEMENT IS A REFUSAL, NOT A VOTE. Each face carries its own copy of
 * the record. If two copies differ, one of them is stale, and picking either
 * would push a stale footprint or eave height onto every face of the section on
 * the next rebuild — silently, and with the user's own edit as the trigger.
 */
export function sectionFromPlanes(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string,
): SectionLookup {
  const out: SectionLookup = {
    found: false, section: null, faceIds: [], conflicted: false,
    reshapedFaceIds: [], refusals: [],
  };
  if (!sectionId) {
    out.refusals.push({ code: 'SECTION_ID_REQUIRED', message: 'No section was named.' });
    return out;
  }

  let record: BuildingSection | null = null;
  let recordJson = '';
  let sawFace = false;

  for (const p of planes ?? []) {
    const sid = p.sectionId || sectionIdOfFaceId(p.id);
    if (sid !== sectionId) continue;
    sawFace = true;
    out.faceIds.push(p.id);
    if (p.sectionFaceReshaped) out.reshapedFaceIds.push(p.id);
    if (!p.section) continue;
    // 🚨 THE RECORD MUST BE THE RECORD FOR THE SECTION ASKED FOR.
    //
    // Faces are selected by `p.sectionId || sectionIdOfFaceId(p.id)`, and the
    // first `p.section` met was then adopted as canonical without ever
    // comparing its OWN id to the one requested. A stale persisted row, a
    // hand-edited layout or a bundle copied between sites can carry a record
    // naming a different section — and editing 'sec-main' would then rebuild
    // it from the GARAGE's footprint, under sec-main's face ids.
    if (p.section.id && p.section.id !== sectionId) {
      out.conflicted = true;
      continue;
    }
    const json = JSON.stringify(sectionRecord(p.section));
    if (!record) { record = sectionRecord(p.section); recordJson = json; }
    else if (json !== recordJson) out.conflicted = true;
  }

  if (!sawFace) {
    out.refusals.push({
      code: 'SECTION_NOT_FOUND',
      message: 'No roof face belongs to that section.',
    });
    return out;
  }
  if (out.conflicted) {
    out.refusals.push({
      code: 'SECTION_RECORDS_CONFLICT',
      message:
        'The faces of this section carry different copies of its definition. ' +
        'It cannot be edited until they agree — retrace or delete the section.',
    });
    return out;
  }
  if (!record) {
    // A sectionId with no record. `sectionsFromPlanes` calls this standalone and
    // so does this: it has no footprint, so there is nothing to edit as a volume.
    out.refusals.push({
      code: 'SECTION_RECORD_MISSING',
      message:
        'These faces name a section but carry no definition of it, so they can ' +
        'only be edited one face at a time.',
    });
    return out;
  }

  out.found = true;
  out.section = record;
  return out;
}

/** Every section present in a plane list, in first-seen order. Conflicted
 *  sections are reported so the UI can say so rather than omit them. */
export function listSections(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
): Array<{ sectionId: string; section: BuildingSection | null; faceIds: string[]; conflicted: boolean }> {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const p of planes ?? []) {
    const sid = p.sectionId || sectionIdOfFaceId(p.id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    order.push(sid);
  }
  return order.map(sid => {
    const look = sectionFromPlanes(planes, sid);
    return { sectionId: sid, section: look.section, faceIds: look.faceIds, conflicted: look.conflicted };
  });
}

// ── The edit ────────────────────────────────────────────────────────────────

/**
 * One edit to one section. Every field is an ABSOLUTE physical quantity in the
 * section's own terms — never a delta, never a render offset.
 *
 * `moveEastM` / `moveNorthM` are the single exception and are named as motion
 * rather than position, because a footprint has no single "position" to set.
 */
export interface SectionEdit {
  /** Absolute elevation of the pad, metres (same datum as Cesium's terrain). */
  groundElevM?: number;
  /** The wall: eave above the pad, metres. */
  eaveHeightM?: number;
  /**
   * Roof slope, degrees from horizontal — the SECTION default.
   *
   * 🚨 SETTING THIS CLEARS EVERY PER-FACE OVERRIDE. "Set the roof to 6:12"
   * means the roof, and leaving a face override standing would mean the
   * installer typed 26.6 into the section's pitch box and one slope did not
   * move, with nothing on screen saying why. Change one face with
   * `facePitchDeg`; change the roof with this.
   */
  pitchDeg?: number;
  /**
   * PER-FACE PITCH, degrees, by face key. `null` clears that face's override
   * and returns it to the section default.
   *
   * The partner face KEEPS ITS OWN PITCH AND ITS OWN EAVE; the ridge moves to
   * where both faces reach it. See `RoofSectionRecord.facePitchDeg`.
   */
  facePitchDeg?: Partial<Record<SectionFaceKey, number | null>>;
  /**
   * WHAT STAYS PUT WHEN A PITCH CHANGES. Changing a slope has to move
   * something, and which thing it moves is a physical decision, not an
   * implementation detail — so it is named, defaulted, and shown in the UI.
   *
   *   'eave'  (default) the walls are built and the roof goes on top of them.
   *           `eaveHeightM` is untouched and the ridge rises or falls. This is
   *           what a builder means and what an installer measuring a wall with
   *           a tape expects.
   *
   *   'ridge' the ridge elevation is held and the WALL HEIGHT is re-derived —
   *           for matching an existing roofline, or a height limit. The rise a
   *           given pair of pitches needs across a given span is fully
   *           determined, so this is exact: eave = ridge − rise.
   *
   * 🚨 IT IS NOT A THIRD PLACE TO STORE A HEIGHT. Under 'ridge' the edit
   * WRITES a new `eaveHeightM`, which the inspector then shows changing. The
   * alternative — remembering an anchor on the record and re-solving later — is
   * how two stored numbers start to disagree.
   */
  pitchAnchor?: 'eave' | 'ridge';
  ridgeAxis?: SectionRidgeAxis;
  kind?: SectionRoofKind;
  shedAzimuthDeg?: number | null;
  label?: string;
  /** Replace the plan outline outright (the vertex-handle path). */
  footprint?: LatLng[];
  /** Slide the whole footprint. Metres, positive east / positive north. */
  moveEastM?: number;
  moveNorthM?: number;
  /**
   * PROCEED EVEN THOUGH A FACE OF THIS SECTION WAS RESHAPED BY HAND, DISCARDING
   * THAT RESHAPE.
   *
   * 🚨 THE USER MUST ASK FOR THIS EXPLICITLY. Without it, editing a section
   * whose faces Stitch has moved is refused, because rebuilding from the
   * section's parameters throws the stitch away — which is precisely what used
   * to happen silently. The flag is the installer saying "yes, rebuild it from
   * the trace"; it is never defaulted true and never inferred.
   */
  rebuildFromParameters?: boolean;
}

export interface SectionEditOutcome {
  /** 🚨 Uniform shape — see SectionLookup. */
  ok: boolean;
  /** The full plane list to adopt. On refusal this is the INPUT, unchanged. */
  planes: RoofPlane[];
  /** The section as it now stands. Null on refusal. */
  section: BuildingSection | null;
  /** Ridge above the pad, derived. Null for a deck and on refusal. */
  ridgeHeightM: number | null;
  /**
   * Everything the RENDERER needs for each rebuilt face — the fitted frame and
   * the guaranteed-coplanar ECEF corners, straight from `buildSectionRoofPlanes`.
   *
   * 🚨 PASSED THROUGH, NOT RE-DERIVED. If the engine refitted a frame from the
   * returned plane it would get a subtly different answer than the one the
   * plane was built with, and the panel grid is placed from that frame. This is
   * the same reason `SectionPlanOutcome` carries `faceBuilds` at all.
   */
  faceBuilds: SectionPlanOutcome['faceBuilds'];
  refusals: SectionRefusal[];
  /**
   * Faces the section used to own and no longer does — only ever non-empty when
   * `kind` changed. The caller must decide what happens to panels standing on
   * them; this module will not silently strand them.
   */
  removedFaceIds: string[];
}

/**
 * Apply one edit to one section and rebuild every face it owns, together.
 *
 * 🚨 A REFUSAL IS A NO-OP THAT RETURNS THE INPUT. Not an empty list, not a
 * partial rebuild. `planAerialAdoption` already establishes this rule in this
 * codebase for the same reason: a refusal that returns an empty roof is how a
 * building disappears on a mis-click.
 *
 * 🚨 FACE IDS SURVIVE. `buildSectionRoofPlanes` derives them as
 * `${sectionId}::${key}`, so changing the pitch of a section does not orphan
 * the panels standing on it — `PlacedPanel.planeId` still resolves.
 */
export function applySectionEdit(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string,
  edit: SectionEdit,
): SectionEditOutcome {
  const input = (planes ?? []).slice();
  const fail = (refusals: SectionRefusal[]): SectionEditOutcome => ({
    ok: false, planes: input, section: null, ridgeHeightM: null, faceBuilds: [], refusals, removedFaceIds: [],
  });

  const look = sectionFromPlanes(input, sectionId);
  if (!look.found) return fail(look.refusals);

  // 🚨 A HAND-RESHAPED FACE IS NOT REBUILT BEHIND THE INSTALLER'S BACK.
  //
  // Stitch and Square Up move corners to shapes no (footprint, eave, pitch)
  // triple describes. Rebuilding this section would restore the pre-reshape
  // geometry — which is exactly what used to happen, silently, on the next eave
  // nudge after a stitch. Renaming the section is still allowed, because a label
  // changes no geometry.
  const onlyLabel = Object.keys(edit).every(k => k === 'label' || k === 'rebuildFromParameters');
  if (look.reshapedFaceIds.length > 0 && !edit.rebuildFromParameters && !onlyLabel) {
    const n = look.reshapedFaceIds.length;
    return fail([{
      code: 'SECTION_FACES_RESHAPED',
      message:
        `${n} face${n === 1 ? '' : 's'} of this section ${n === 1 ? 'was' : 'were'} reshaped by hand ` +
        `(Stitch or Square Up), so ${n === 1 ? 'its' : 'their'} corners no longer come from this ` +
        `section's footprint and pitch. Any change here rebuilds every face from the original trace ` +
        `and discards that reshape. Undo to step back before the reshape, or rebuild from the trace ` +
        `deliberately.`,
    }]);
  }

  const before = look.section!;
  const next = sectionRecord(before);

  // ── Apply, checking each number as a number before it becomes geometry ────
  //
  // 🚨 NaN IS NOT A HEIGHT. An empty numeric input box yields NaN, and
  // `roofPlaneFromFootprint` silently substitutes 0 for a non-finite ground —
  // which models the house 150 m underground at this site and looks plausible
  // all the way to a permit. The refusal has to happen here.
  const numeric: Array<[keyof SectionEdit, number | undefined]> = [
    ['groundElevM', edit.groundElevM],
    ['eaveHeightM', edit.eaveHeightM],
    ['pitchDeg', edit.pitchDeg],
    ['moveEastM', edit.moveEastM],
    ['moveNorthM', edit.moveNorthM],
  ];
  for (const [name, v] of numeric) {
    if (v === undefined) continue;
    if (typeof v !== 'number' || !isFinite(v)) {
      return fail([{
        code: 'EDIT_VALUE_NOT_FINITE',
        message: `${String(name)} must be a number.`,
      }]);
    }
  }

  if (edit.groundElevM !== undefined) next.groundElevM = edit.groundElevM;
  if (edit.eaveHeightM !== undefined) next.eaveHeightM = edit.eaveHeightM;
  if (edit.pitchDeg !== undefined) {
    // 🚨 A FLAT SECTION CANNOT BE GIVEN A SLOPE BY TYPING ONE INTO IT.
    //
    // The deck is built horizontal by definition, so the number would be stored
    // and never realised: the edit returned ok, nothing moved, and the panel
    // then displayed a pitch the roof did not have. An audit reached it from
    // the Block tool in three clicks. The kind is the thing to change, and
    // saying so gets the installer the roof they actually asked for.
    const kindAfter = edit.kind !== undefined ? edit.kind : next.kind;
    if (kindAfter === 'flat' && edit.pitchDeg !== 0) {
      // 🚨 IT CONVERTS. IT DOES NOT REFUSE, AND IT DOES NOT MAKE THEM REDRAW.
      //
      // This used to answer "a flat section is horizontal by definition —
      // change its roof kind to Shed", which is true about the CODE and useless
      // to the person holding a porch that slopes 2 in 12. The owner's report
      // is exact: "I should NOT have to delete it and redraw it using a
      // completely different internal object simply because the porch has a
      // 1/12, 2/12, 3/12 slope."
      //
      // `flat` and `shed` are ALREADY the same topology here — one planar face,
      // built by the same `roofPlaneFromFootprint` call, differing only in
      // whether the pitch is pinned to zero. So "one planar roof surface" and
      // "physical pitch is zero forever" were two facts wearing one word, and
      // this separates them: the topology is unchanged, and the physical
      // dimension stops being locked by it.
      //
      // Everything authored survives — footprint, id, pad elevation, eave
      // height, label — because nothing is recreated. A shed at 0° is a true
      // flat roof, so this is not a one-way door either: setting the pitch back
      // to zero leaves a horizontal deck that REMEMBERS its slope direction for
      // the next time it is raised.
      next.kind = 'shed';
      // A slope needs a direction as well as a magnitude, and inventing one
      // from polygon winding order is how a roof ends up falling toward the
      // house. If the caller did not supply one and the section has never had
      // one, the edit is refused and says what is missing.
      const dirAfter = edit.shedAzimuthDeg !== undefined ? edit.shedAzimuthDeg : next.shedAzimuthDeg;
      if (dirAfter === null || dirAfter === undefined || !isFinite(dirAfter)) {
        return fail([{
          code: 'SHED_DIRECTION_REQUIRED',
          message:
            'This roof can take a slope, but it needs to know which way it falls. '
            + 'Choose the downhill direction (or the high edge) and set the pitch again.',
        }]);
      }
    }
    next.pitchDeg = edit.pitchDeg;
    // See SectionEdit.pitchDeg: setting the roof's pitch means the roof.
    next.facePitchDeg = undefined;
  }
  if (edit.facePitchDeg !== undefined) {
    if (!edit.facePitchDeg || typeof edit.facePitchDeg !== 'object') {
      return fail([{ code: 'EDIT_VALUE_NOT_FINITE', message: 'Per-face pitch must be given by face.' }]);
    }
    const merged: Partial<Record<SectionFaceKey, number>> = { ...(next.facePitchDeg ?? {}) };
    for (const key of Object.keys(edit.facePitchDeg) as SectionFaceKey[]) {
      const v = edit.facePitchDeg[key];
      if (v === null) { delete merged[key]; continue; }
      if (v === undefined) continue;
      if (typeof v !== 'number' || !isFinite(v)) {
        return fail([{
          code: 'EDIT_VALUE_NOT_FINITE',
          message: `The pitch for ${key} must be a number.`,
        }]);
      }
      merged[key] = v;
    }
    next.facePitchDeg = Object.keys(merged).length > 0 ? merged : undefined;
  }
  if (edit.ridgeAxis !== undefined) next.ridgeAxis = edit.ridgeAxis;
  if (edit.kind !== undefined) {
    next.kind = edit.kind;
    // 🚨 CHANGING THE KIND DROPS OVERRIDES FOR FACES THAT NO LONGER EXIST. A
    // hip turned gable keeps slopeA/slopeB and loses hipEndA/hipEndB — carrying
    // them would be refused by `validateSection` (FACE_PITCH_NOT_A_FACE) and
    // the installer would be blocked by a face they can no longer see.
    if (next.facePitchDeg) {
      const owned = new Set<string>(faceKeysForKind(next.kind));
      const kept: Partial<Record<SectionFaceKey, number>> = {};
      for (const key of Object.keys(next.facePitchDeg) as SectionFaceKey[]) {
        if (owned.has(key)) kept[key] = next.facePitchDeg[key];
      }
      next.facePitchDeg = Object.keys(kept).length > 0 ? kept : undefined;
    }
  }
  if (edit.shedAzimuthDeg !== undefined) {
    // 🚨 NORMALISED ON THE WAY IN. It used to be stored raw, so -90 and 450
    // round-tripped verbatim through `sectionRecord` and any display of the
    // number was wrong while the geometry was right — two answers to one fact.
    const a = edit.shedAzimuthDeg;
    next.shedAzimuthDeg = (a === null || a === undefined || !isFinite(a))
      ? null : ((a % 360) + 360) % 360;
  }
  if (edit.label !== undefined) next.label = edit.label;

  if (edit.footprint !== undefined) {
    if (!Array.isArray(edit.footprint)) {
      return fail([{ code: 'FOOTPRINT_TOO_FEW_POINTS', message: 'A footprint must be a ring of points.' }]);
    }
    for (const v of edit.footprint) {
      if (!v || !isFinite(v.lat) || !isFinite(v.lng)) {
        return fail([{ code: 'EDIT_VALUE_NOT_FINITE', message: 'A footprint corner was not a coordinate.' }]);
      }
    }
    next.footprint = edit.footprint.map(v => ({ lat: v.lat, lng: v.lng }));
  }

  const dE = edit.moveEastM ?? 0;
  const dN = edit.moveNorthM ?? 0;
  const movesFootprint = dE !== 0 || dN !== 0 || edit.footprint !== undefined;

  // 🚨 THE FIRST CALL SITE OF THE GEOMETRY-MUTATION POLICY, AND THE REASON IT
  // WAS WRITTEN. lib/3d/geometryMutationPolicy.ts records Ray's 2026-09-21
  // ruling — "an explicit user gesture MAY move a traced footprint; inference
  // and automatic reconciliation may not" — and until now it was encoded and
  // enforced at zero call sites, which an independent audit flagged. A rule
  // nothing asks is a comment.
  //
  // This is the `user-authored` case by construction: `applySectionEdit` is
  // only ever reached from a person selecting a section and asking for this
  // specific change. Anything that wants to move a footprint by INFERENCE must
  // come through here too, declare itself `inferred`, and be refused.
  if (movesFootprint) {
    const verdict = evaluateGeometryMutation({
      operation: `edit section ${sectionId}`,
      authorship: 'user-authored',
      effect: 'moves-footprint',
    });
    if (!verdict.allowed) {
      return fail([{ code: 'EDIT_VALUE_NOT_FINITE', message: verdict.reason }]);
    }
  }

  if (dE !== 0 || dN !== 0) {
    // 🚨 ONE LATITUDE FOR THE WHOLE RING. Converting each corner at its own
    // latitude scales the footprint as it slides: a 14 m wall would arrive
    // fractionally longer than it left. The centroid's latitude is the honest
    // single conversion, and at roof scale the residual is micrometres.
    const latRef = next.footprint.reduce((s, v) => s + v.lat, 0) / next.footprint.length;
    const perLat = mPerDegLat(latRef);
    const perLng = mPerDegLng(latRef);
    if (!(perLat > 0) || !(perLng > 0)) {
      return fail([{ code: 'EDIT_VALUE_NOT_FINITE', message: 'That footprint has no usable latitude.' }]);
    }
    next.footprint = next.footprint.map(v => ({
      lat: v.lat + dN / perLat,
      lng: v.lng + dE / perLng,
    }));
  }

  // ── THE PITCH ANCHOR ─────────────────────────────────────────────────────
  //
  // 'eave' is the default and needs no code: `eaveHeightM` was not touched, so
  // the walls stay and the ridge lands wherever the new pitches put it.
  //
  // 'ridge' holds the ROOFLINE and re-derives the wall. The rise a pair of
  // pitches needs across a given span is fully determined —
  // rise = span·tanA·tanB/(tanA+tanB) — and does not depend on the eave at all,
  // so laying the section out once at eave 0 reads the new rise directly. No
  // iteration, no second stored number, and the answer is exact.
  const changesPitch = edit.pitchDeg !== undefined || edit.facePitchDeg !== undefined;
  // 🚨 A ROOF WITH NO RIDGE IGNORES A RIDGE ANCHOR; IT DOES NOT REFUSE.
  //
  // `pitchAnchor` is component state in the engine and is never reset when the
  // selection changes, while the inspector correctly HIDES the toggle for a
  // single-plane section — and still sent the stale value with every pitch
  // commit. So: set the anchor to Ridge on the house, select the porch, type
  // 2:12, and the conversion never ran, refused by a message about a control
  // the user could not see. That is the owner's original complaint reachable
  // through a different door.
  //
  // "Hold the ridge" is meaningless for one plane rather than wrong, so the
  // honest response is to hold the eave, which is what a single-plane roof
  // always does.
  const hasRidge = next.kind !== 'flat' && next.kind !== 'shed';
  if (edit.pitchAnchor === 'ridge' && changesPitch && hasRidge) {
    if (edit.eaveHeightM !== undefined) {
      return fail([{
        code: 'EDIT_VALUE_NOT_FINITE',
        message: 'Setting the wall height and holding the ridge in one edit asks for two ' +
          'different walls. Change one, then the other.',
      }]);
    }
    const ridgeBefore = layoutSectionFaces(before).ridgeHeightM;
    if (ridgeBefore == null) {
      return fail([{
        code: 'FACE_CONSTRUCTION_FAILED',
        message: 'This section has no ridge to hold. A flat or shed roof has only an eave.',
      }]);
    }
    const ridgeElevBefore = before.groundElevM + ridgeBefore;
    const probe = sectionRecord(next);
    probe.eaveHeightM = 0;
    const laidProbe = layoutSectionFaces(probe);
    if (laidProbe.refusals.length > 0) return fail(laidProbe.refusals);
    if (laidProbe.ridgeHeightM == null) {
      return fail([{
        code: 'FACE_CONSTRUCTION_FAILED',
        message: 'That pitch leaves this section with no ridge to hold.',
      }]);
    }
    const riseAfter = laidProbe.ridgeHeightM;   // eave was 0, so this IS the rise
    const eaveAfter = (ridgeElevBefore - next.groundElevM) - riseAfter;
    if (!(eaveAfter >= 0)) {
      return fail([{
        code: 'EAVE_HEIGHT_INVALID',
        message:
          `Holding the ridge at ${ftInStr(ridgeElevBefore - next.groundElevM)} above the pad ` +
          `while that pitch needs ${ftInStr(riseAfter)} of rise would put the eave ` +
          `${ftInStr(-eaveAfter)} BELOW the ground. Hold the eave instead, or lower the pitch.`,
      }]);
    }
    next.eaveHeightM = eaveAfter;
  }

  // Validate the WHOLE section, reporting every problem rather than the first —
  // an installer who fixes one thing and is refused again has been told half
  // the truth twice.
  const invalid = validateSection(next);
  if (invalid.length > 0) return fail(invalid);

  const built = buildSectionRoofPlanes(next);
  if (!built.ok || built.planes.length === 0) {
    return fail(built.refusals.length > 0 ? built.refusals : [{
      code: 'FACE_CONSTRUCTION_FAILED',
      message: 'That section could not be rebuilt from those values.',
    }]);
  }

  const newIds = new Set(built.planes.map(p => p.id));
  const removedFaceIds = faceIdsOfSection(input, sectionId).filter(id => !newIds.has(id));

  return {
    ok: true,
    planes: replaceSectionFaces(input, sectionId, built.planes),
    section: sectionRecord(next),
    ridgeHeightM: built.ridgeHeightM,
    faceBuilds: built.faceBuilds,
    refusals: [],
    removedFaceIds,
  };
}

// ── EDITING ONE FACE'S PITCH ────────────────────────────────────────────────
//
// 🚨 THE LIVE GAUNTLET FAILURE THIS CLOSES: "The current UI can display pitch
// for a selected roof face but cannot edit that face's pitch."
//
// Three cases, and they are genuinely different buildings, so they are three
// code paths rather than one with flags:
//
//   1. A SLOPE OF A RIDGED SECTION. The pitch is an override on the section
//      record and the whole section rebuilds. The ridge moves; the partner face
//      keeps its own pitch and its own eave. No compensating edit.
//
//   2. THE DECK OF A SHED SECTION. A shed is one face, so "this face's pitch"
//      and "the section's pitch" are the same physical quantity. It is written
//      as the section pitch, not as an override, because storing it twice is
//      how two numbers start to disagree.
//
//   3. A STANDALONE FACE — hand-traced, Google-detected, imported. It belongs
//      to no volume, so there is nothing to keep shut and nothing to move with
//      it. Its plan outline is preserved exactly and it is re-lifted at the new
//      slope about whichever edge the anchor names.
//
// A FLAT section is refused: a flat roof with a pitch is a shed, and silently
// converting the kind under the installer would change how many faces the
// section has and where its ridge is.

export type PitchAnchor = 'eave' | 'ridge';

export interface FacePitchPreview {
  /** 🚨 Uniform shape — see SectionLookup. */
  ok: boolean;
  /** How this face's pitch will be stored: which of the three cases applies. */
  scope: 'section-face' | 'shed-deck' | 'standalone' | 'none';
  faceId: string;
  sectionId: string | null;
  faceKey: SectionFaceKey | null;
  pitchBeforeDeg: number | null;
  pitchAfterDeg: number;
  /** Ridge above the pad, before and after. Null when the face has no ridge. */
  ridgeHeightBeforeM: number | null;
  ridgeHeightAfterM: number | null;
  /** Wall/eave above the pad, before and after. Differs only under 'ridge'. */
  eaveHeightBeforeM: number | null;
  eaveHeightAfterM: number | null;
  /**
   * WHAT ELSE MOVES, in plain words — shown BEFORE the edit is applied.
   * The instruction was explicit: "If changing one face affects another due to
   * a real constraint, the user must understand that before applying it."
   */
  consequences: string[];
  refusals: SectionRefusal[];
}

const noPreview = (faceId: string, refusals: SectionRefusal[]): FacePitchPreview => ({
  ok: false, scope: 'none', faceId, sectionId: null, faceKey: null,
  pitchBeforeDeg: null, pitchAfterDeg: NaN,
  ridgeHeightBeforeM: null, ridgeHeightAfterM: null,
  eaveHeightBeforeM: null, eaveHeightAfterM: null,
  consequences: [], refusals,
});

/** The plane with this id, or null. */
function planeById(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  faceId: string,
): RoofPlane | null {
  for (const p of planes ?? []) if (p && p.id === faceId) return p;
  return null;
}

/** Which of the three cases this face is, without applying anything. */
function classifyFace(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  faceId: string,
): { plane: RoofPlane | null; sectionId: string | null; key: SectionFaceKey | null } {
  const plane = planeById(planes, faceId);
  if (!plane) return { plane: null, sectionId: null, key: null };
  const sectionId = plane.sectionId || sectionIdOfFaceId(plane.id);
  const key = (plane.sectionFaceKey as SectionFaceKey) || faceKeyOfFaceId(plane.id);
  return { plane, sectionId: sectionId || null, key: key || null };
}

/**
 * What changing this face's pitch will do — WITHOUT doing it.
 *
 * The inspector calls this on every keystroke so the consequences are on screen
 * before the installer commits. It applies the edit to a COPY and reads the
 * result, so it cannot describe an outcome the real edit would not produce.
 */
export function previewFacePitch(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  faceId: string,
  pitchDeg: number,
  anchor: PitchAnchor = 'eave',
): FacePitchPreview {
  if (typeof pitchDeg !== 'number' || !isFinite(pitchDeg)) {
    return noPreview(faceId, [{ code: 'EDIT_VALUE_NOT_FINITE', message: 'Pitch must be a number.' }]);
  }
  const { plane, sectionId, key } = classifyFace(planes, faceId);
  if (!plane) {
    return noPreview(faceId, [{ code: 'SECTION_NOT_FOUND', message: 'That roof face is not in this design.' }]);
  }

  // ── Standalone: nothing else moves, and that is the whole answer. ─────────
  if (!sectionId) {
    const before = measureFaceVertical(plane);
    return {
      ok: true, scope: 'standalone', faceId, sectionId: null, faceKey: null,
      pitchBeforeDeg: before.pitchDeg, pitchAfterDeg: pitchDeg,
      ridgeHeightBeforeM: null, ridgeHeightAfterM: null,
      eaveHeightBeforeM: null, eaveHeightAfterM: null,
      consequences: [
        anchor === 'ridge'
          ? 'The high edge stays where it is; the low edge moves.'
          : 'The low edge stays where it is; the high edge moves.',
        'This face belongs to no building section, so nothing else changes.',
      ],
      refusals: [],
    };
  }

  const look = sectionFromPlanes(planes, sectionId);
  if (!look.found) return noPreview(faceId, look.refusals);
  const sec = look.section!;

  // 🚨 A FLAT DECK GOES DOWN THE SHED PATH. It used to be refused here with
  // "change its roof kind to Shed first", which is an instruction to learn an
  // internal noun before you may describe a porch. The two kinds are one
  // topology — a single planar face built by one call — and `applySectionEdit`
  // converts in place, keeping the footprint, pad, eave and id.
  const isShedDeck = sec.kind === 'shed' || sec.kind === 'flat';
  const edit: SectionEdit = isShedDeck
    ? { pitchDeg, pitchAnchor: anchor }
    : { facePitchDeg: { [key ?? 'slopeA']: pitchDeg } as Partial<Record<SectionFaceKey, number>>, pitchAnchor: anchor };

  if (!isShedDeck && !key) {
    return noPreview(faceId, [{
      code: 'FACE_PITCH_NOT_A_FACE',
      message: 'This face names a section but not which face of it, so its pitch cannot be ' +
        'set on its own. Edit the section instead.',
    }]);
  }

  const trial = applySectionEdit(planes, sectionId, edit);
  if (!trial.ok) return noPreview(faceId, trial.refusals);

  const laidBefore = layoutSectionFaces(sec);
  const after = trial.section!;
  const consequences: string[] = [];

  if (anchor === 'ridge') {
    consequences.push(
      `The ridge stays at ${ftInStr(sec.groundElevM + (laidBefore.ridgeHeightM ?? 0))} above sea level; ` +
      `the wall becomes ${ftInStr(after.eaveHeightM)}.`,
    );
  } else if (laidBefore.ridgeHeightM != null && trial.ridgeHeightM != null) {
    const d = trial.ridgeHeightM - laidBefore.ridgeHeightM;
    consequences.push(
      Math.abs(d) < 0.005
        ? `The wall stays at ${ftInStr(after.eaveHeightM)} and the ridge does not move.`
        : `The wall stays at ${ftInStr(after.eaveHeightM)}; the ridge ${d > 0 ? 'rises' : 'drops'} ` +
          `${ftInStr(Math.abs(d))} to ${ftInStr(trial.ridgeHeightM)} above the pad.`,
    );
  }

  if (!isShedDeck) {
    const partners = faceKeysForKind(after.kind).filter(k => k !== key);
    const moved = partners.filter(k => Math.abs(pitchForFace(after, k) - pitchDeg) > 0.05);
    if (moved.length > 0) {
      consequences.push(
        `${moved.map(prettyFaceKey).join(' and ')} keep their own pitch ` +
        `(${moved.map(k => pitchForFace(after, k).toFixed(1) + '°').join(', ')}). ` +
        `The ridge moves across the roof so every face still meets it.`,
      );
    }
    if (sectionHasMixedPitch(after)) {
      consequences.push('This section’s faces no longer share one pitch, so its ridge sits off-centre.');
    }
  }
  consequences.push('No other building section moves.');

  return {
    ok: true,
    scope: isShedDeck ? 'shed-deck' : 'section-face',
    faceId, sectionId, faceKey: key,
    pitchBeforeDeg: isShedDeck ? sec.pitchDeg : pitchForFace(sec, key!),
    pitchAfterDeg: pitchDeg,
    ridgeHeightBeforeM: laidBefore.ridgeHeightM,
    ridgeHeightAfterM: trial.ridgeHeightM,
    eaveHeightBeforeM: sec.eaveHeightM,
    eaveHeightAfterM: after.eaveHeightM,
    consequences,
    refusals: [],
  };
}

/** "Slope A" / "the north hip end" — how a face is named to a person. */
export function prettyFaceKey(key: SectionFaceKey | null | undefined): string {
  switch (key) {
    case 'slopeA': return 'Slope A';
    case 'slopeB': return 'Slope B';
    case 'hipEndA': return 'Hip end A';
    case 'hipEndB': return 'Hip end B';
    case 'deck': return 'Deck';
    default: return 'This face';
  }
}

export interface FacePitchOutcome extends SectionEditOutcome {
  /** Which of the three cases was taken. 'none' on refusal. */
  scope: FacePitchPreview['scope'];
  /** The face ids this edit rebuilt — one for a standalone face, all of a
   *  section's faces otherwise. The renderer redraws exactly these. */
  rebuiltFaceIds: string[];
}

/**
 * Set ONE roof face's pitch, and rebuild whatever that physically implies.
 *
 * 🚨 THE GEOMETRY ACQUIRES THE PITCH — a scalar called `pitch` is never
 * relabelled. A section face is rebuilt from corner heights by
 * `roofPlaneFromLiftedOutline`, so the fitted pitch on the returned plane is
 * read back OUT of the surface that was built, not written over it. This
 * codebase has been bitten twice by the other kind of fix, where `plane.pitch`
 * said one thing and `plane.polygon3D` described another until something
 * re-derived it.
 */
export function applyFacePitchEdit(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  faceId: string,
  pitchDeg: number,
  anchor: PitchAnchor = 'eave',
): FacePitchOutcome {
  const input = (planes ?? []).slice();
  const bad = (refusals: SectionRefusal[]): FacePitchOutcome => ({
    ok: false, planes: input, section: null, ridgeHeightM: null, faceBuilds: [],
    refusals, removedFaceIds: [], scope: 'none', rebuiltFaceIds: [],
  });

  const pre = previewFacePitch(input, faceId, pitchDeg, anchor);
  if (!pre.ok) return bad(pre.refusals);

  // ── Cases 1 and 2: the section owns it. ──────────────────────────────────
  if (pre.scope !== 'standalone') {
    const edit: SectionEdit = pre.scope === 'shed-deck'
      ? { pitchDeg, pitchAnchor: anchor }
      : { facePitchDeg: { [pre.faceKey!]: pitchDeg } as Partial<Record<SectionFaceKey, number>>, pitchAnchor: anchor };
    const out = applySectionEdit(input, pre.sectionId!, edit);
    return {
      ...out,
      scope: pre.scope,
      rebuiltFaceIds: out.ok ? out.faceBuilds.map(b => b.faceId) : [],
    };
  }

  // ── Case 3: a standalone face, re-lifted about its anchor edge. ──────────
  const plane = planeById(input, faceId)!;
  const measured = measureFaceVertical(plane);
  const ring = (plane.vertices ?? []).map(v => ({ lat: v.lat, lng: v.lng }));
  if (ring.length < 3) {
    return bad([{
      code: 'FOOTPRINT_TOO_FEW_POINTS',
      message: 'This face has no plan outline to re-slope. Retrace it.',
    }]);
  }
  if (measured.eaveElevM == null || measured.ridgeElevM == null) {
    return bad([{
      code: 'GROUND_ELEV_INVALID',
      message: 'This face has no measurable elevation, so a new pitch has nothing to pivot about.',
    }]);
  }
  const azimuthDeg = isFinite(plane.azimuth) ? plane.azimuth : 180;

  // 🚨 THE ANCHOR IS APPLIED BY MEASURING, NOT BY ASSUMING. Build the face once
  // about elevation 0 to find out how much rise this outline gets at this
  // pitch — the plan extent across the slope is a property of the traced ring
  // and is not worth re-deriving here — then place that surface so the anchored
  // edge lands back exactly where it was.
  const probe = roofPlaneFromFootprint(ring, {
    pitchDeg, azimuthDeg, eaveHeightM: 0, groundElevM: 0,
  });
  if (!probe) {
    return bad([{ code: 'FACE_CONSTRUCTION_FAILED', message: 'That outline could not be re-sloped.' }]);
  }
  const probeM = measureFaceVertical(probe.plane);
  const riseM = (probeM.ridgeElevM ?? 0) - (probeM.eaveElevM ?? 0);
  const baseElevM = anchor === 'ridge'
    ? measured.ridgeElevM - riseM
    : measured.eaveElevM;

  const built = roofPlaneFromFootprint(ring, {
    pitchDeg, azimuthDeg, eaveHeightM: 0, groundElevM: baseElevM,
  });
  if (!built) {
    return bad([{ code: 'FACE_CONSTRUCTION_FAILED', message: 'That outline could not be re-sloped.' }]);
  }

  // 🚨 IDENTITY SURVIVES. `buildRoofPlane3D` mints a fresh id every call; the
  // panels standing on this face resolve by `PlacedPanel.planeId`, so keeping
  // the fitter's id would orphan the array on every pitch nudge.
  const next = built.plane;
  next.id = plane.id;
  next.source = plane.source ?? 'manual';
  // The slope is now what a person typed, not what was detected, so it re-enters
  // review exactly as a hand-traced plane does.
  next.confirmed = false;

  // 🚨 A RE-SLOPE IS NOT A NEW ROOF FACE. Everything about this face that is
  // NOT its slope must survive, or changing the pitch quietly changes something
  // else: `orientation` decides portrait vs landscape for every panel on it,
  // `sunshineHoursPerYear` is what the production estimate is built from, and
  // `edgeTypes`/`adjacentPlaneIds` are what setbacks and Stitch read. Losing any
  // of them would be a second, invisible edit riding along with the first.
  //
  // 🚨 `planeHeightAtCenterMeters` IS DELIBERATELY NOT CARRIED. The rebuilt
  // plane comes out of `buildRoofPlane3D` with the 0.0 sentinel that means
  // "my elevation is in origin3D" — the same value every other footprint-built
  // face has. Copying the old absolute elevation over it would leave a stale
  // number that `computeEcefFrameForLegacyPlane` would believe if this face
  // ever lost its frame. See tests/planeHeightDatum.test.ts.
  if (plane.siteKey) next.siteKey = plane.siteKey;
  if (plane.orientation) next.orientation = plane.orientation;
  if (plane.edgeTypes) next.edgeTypes = plane.edgeTypes.slice();
  if (plane.adjacentPlaneIds) next.adjacentPlaneIds = plane.adjacentPlaneIds.slice();
  if (plane.solarSegmentIndex !== undefined) next.solarSegmentIndex = plane.solarSegmentIndex;
  if (plane.sunshineHoursPerYear !== undefined) next.sunshineHoursPerYear = plane.sunshineHoursPerYear;
  (next as any).__eaveDirENU = built.eaveDirENU;

  const out = input.map(p => (p.id === faceId ? next : p));
  return {
    ok: true,
    planes: out,
    section: null,
    ridgeHeightM: null,
    faceBuilds: [{
      faceId: next.id,
      key: 'deck',
      plane: next,
      frame: built.frame,
      projectedPts: built.frame.projectedPts,
      eaveDirENU: built.eaveDirENU,
    }],
    refusals: [],
    removedFaceIds: [],
    scope: 'standalone',
    rebuiltFaceIds: [next.id],
  };
}

// ── What the inspector is allowed to display ────────────────────────────────

/**
 * Every physical quantity of a section, each one absolute and each one named.
 *
 * This is the type the UI reads. There is deliberately no field on it that
 * means "how many times a stepper has been pressed".
 */
export interface SectionMeasurement {
  sectionId: string;
  label: string;
  kind: SectionRoofKind;
  faceCount: number;
  /** Absolute pad elevation, metres above the ellipsoid. */
  groundElevM: number;
  /** The wall. Eave above the pad, metres. */
  eaveHeightM: number;
  /** Absolute eave elevation = ground + eave. */
  eaveElevM: number;
  /** DERIVED. Ridge above the pad. Null for a deck. */
  ridgeHeightM: number | null;
  /** DERIVED. Absolute ridge elevation. Null for a deck. */
  ridgeElevM: number | null;
  /** The section DEFAULT pitch. Faces may override it — see `facePitches`. */
  pitchDeg: number;
  /**
   * Every face this section owns and the pitch it is actually built at.
   *
   * 🚨 SHOWN EVEN WHEN THEY ALL AGREE. "Which face is the 4:12 one" must be
   * answerable from the panel, or an installer editing a saltbox is back to
   * clicking each slope to find out what they typed last time.
   */
  facePitches: Array<{ key: SectionFaceKey; faceId: string; label: string; pitchDeg: number }>;
  /** True when the faces do not all share one pitch, so the ridge is off-centre. */
  mixedPitch: boolean;
  ridgeAxis: SectionRidgeAxis;
  /** Plan dimensions of the footprint's two edge pairs, metres. */
  planAM: number;
  planBM: number;
  /**
   * IS THIS ONE PLANAR ROOF SURFACE? True for a flat deck and for a mono-slope,
   * which are the same topology.
   *
   * 🚨 IT IS A TOPOLOGY QUESTION, NOT A PITCH ONE. The two were one word for a
   * long time — `flat` meant both "one plane" and "zero degrees for ever" — and
   * that is what forced a person with a 2-in-12 porch to delete it and redraw
   * it as a different internal object.
   */
  singlePlane: boolean;
  /**
   * WHICH WAY IT FALLS, compass degrees (0 = north, 180 = south). Null when it
   * has never been decided.
   *
   * 🚨 A SLOPE NEEDS A DIRECTION AS WELL AS A MAGNITUDE, and the direction must
   * not be invented from polygon winding order — that is how a porch roof ends
   * up falling toward the house. Null is shown as "not set yet" and the pitch
   * edit asks for it rather than guessing.
   */
  slopeAzimuthDeg: number | null;
}

/** Mean length of the two opposite edge pairs of a four-corner footprint, or
 *  the bounding extent for any other ring. Plan view only. */
function planPairs(footprint: ReadonlyArray<LatLng>): { a: number; b: number } {
  if (!footprint || footprint.length < 3) return { a: 0, b: 0 };
  const latRef = footprint.reduce((s, v) => s + v.lat, 0) / footprint.length;
  const perLat = mPerDegLat(latRef);
  const perLng = mPerDegLng(latRef);
  const p = footprint.map(v => ({ e: (v.lng - footprint[0].lng) * perLng, n: (v.lat - footprint[0].lat) * perLat }));
  const d = (i: number, j: number) => Math.hypot(p[j].e - p[i].e, p[j].n - p[i].n);
  if (footprint.length === 4) {
    return { a: (d(0, 1) + d(2, 3)) / 2, b: (d(1, 2) + d(3, 0)) / 2 };
  }
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const q of p) {
    if (q.e < minE) minE = q.e; if (q.e > maxE) maxE = q.e;
    if (q.n < minN) minN = q.n; if (q.n > maxN) maxN = q.n;
  }
  return { a: maxE - minE, b: maxN - minN };
}

/** Everything the inspector may show about a section. Pure read. */
export function measureSection(
  section: BuildingSection,
  faceCount: number,
): SectionMeasurement {
  const ridgeHeightM = layoutSectionFaces(section).ridgeHeightM;
  const pairs = planPairs(section.footprint);
  return {
    sectionId: section.id,
    label: section.label || 'Section',
    kind: section.kind,
    faceCount,
    groundElevM: section.groundElevM,
    eaveHeightM: section.eaveHeightM,
    eaveElevM: section.groundElevM + section.eaveHeightM,
    ridgeHeightM,
    ridgeElevM: ridgeHeightM == null ? null : section.groundElevM + ridgeHeightM,
    pitchDeg: section.pitchDeg,
    facePitches: faceKeysForKind(section.kind).map(key => ({
      key,
      faceId: `${section.id}::${key}`,
      label: prettyFaceKey(key),
      pitchDeg: pitchForFace(section, key),
    })),
    mixedPitch: sectionHasMixedPitch(section),
    ridgeAxis: section.ridgeAxis ?? 'auto',
    planAM: pairs.a,
    planBM: pairs.b,
    singlePlane: section.kind === 'flat' || section.kind === 'shed',
    slopeAzimuthDeg:
      typeof section.shedAzimuthDeg === 'number' && isFinite(section.shedAzimuthDeg)
        ? section.shedAzimuthDeg : null,
  };
}

/**
 * What can honestly be said about a face that belongs to NO section — a hand
 * trace, a Google segment, an imported plane.
 *
 * 🚨 `wallHeightM` IS NULL UNLESS A GROUND ELEVATION WAS SUPPLIED. There is no
 * pad elevation stored on a standalone face, so "how high is this wall" has no
 * answer from the face alone. The old UI answered it anyway, with a number that
 * came from a stepper. Null here means the inspector prints "—", which is the
 * instruction: show unresolved rather than a misleading number.
 */
export interface FaceMeasurement {
  faceId: string;
  /** Absolute elevation of the face's lowest corner, metres. Lift removed. */
  eaveElevM: number | null;
  /** Absolute elevation of the face's highest corner, metres. Lift removed. */
  ridgeElevM: number | null;
  /** Eave above ground — only when a ground elevation is known. */
  wallHeightM: number | null;
  /** True when a ground elevation was supplied and the wall height is real. */
  groundResolved: boolean;
  pitchDeg: number | null;
  azimuthDeg: number | null;
  /** The section this face belongs to, or null when it is standalone. */
  sectionId: string | null;
  /** Which face of that section — null when standalone or unlabelled. */
  faceKey: SectionFaceKey | null;
  /**
   * CAN THIS FACE'S PITCH BE SET, AND WHAT WOULD IT MEAN?
   *
   * 🚨 THE UI MUST NOT OFFER A CONTROL THAT CANNOT MOVE THE GEOMETRY. A flat
   * deck has no pitch to set, and a face naming a section but not which face of
   * it cannot be resolved to an override. Both render the value with no editor
   * and say why, rather than accepting a number and doing nothing — which is
   * the class of silent no-op this editor exists to remove.
   */
  pitchScope: 'section-face' | 'shed-deck' | 'standalone' | 'not-editable';
  /** Present when pitchScope is 'not-editable'. Phrased for a person. */
  pitchNotEditableWhy: string | null;
  /** The section's default pitch, for a face that is overriding it. Null when
   *  the face is standalone or is not overriding anything. */
  sectionPitchDeg: number | null;
  /** True when this face carries a pitch of its own, different from its
   *  section's. The inspector marks it, so "why is this one different" has an
   *  answer on screen. */
  overridesSectionPitch: boolean;
}

/**
 * Measure a face's real vertical extent from its canonical geometry.
 *
 * 🚨 THE RENDER LIFT IS REMOVED HERE. `polygon3D` is lifted SURFACE_OFFSET_M
 * (0.12 m) along the face normal, so a 30 degree face's stored corners sit
 * 0.1039 m above the roof surface they describe — the vertical component,
 * lift·cos(tilt). Reporting that as the eave elevation is a 4-inch lie, and
 * four inches is exactly the size of correction a person starts chasing.
 */
export function measureFaceVertical(
  plane: RoofPlane | null | undefined,
  groundElevM?: number | null,
): FaceMeasurement {
  const out: FaceMeasurement = {
    faceId: plane?.id ?? '',
    eaveElevM: null, ridgeElevM: null, wallHeightM: null,
    groundResolved: false, pitchDeg: null, azimuthDeg: null,
    sectionId: null, faceKey: null,
    pitchScope: 'standalone', pitchNotEditableWhy: null,
    sectionPitchDeg: null, overridesSectionPitch: false,
  };
  if (!plane) {
    out.pitchScope = 'not-editable';
    out.pitchNotEditableWhy = 'Nothing is selected.';
    return out;
  }

  out.sectionId = plane.sectionId || sectionIdOfFaceId(plane.id);
  out.faceKey = (plane.sectionFaceKey as SectionFaceKey) || faceKeyOfFaceId(plane.id);
  if (isFinite(plane.pitch)) out.pitchDeg = plane.pitch;
  if (isFinite(plane.azimuth)) out.azimuthDeg = plane.azimuth;

  // ── Is this face's pitch editable, and as what? ──────────────────────────
  const rec = plane.section && plane.section.id === (out.sectionId ?? '') ? plane.section : null;
  if (!out.sectionId) {
    out.pitchScope = 'standalone';
  } else if (!rec) {
    out.pitchScope = 'not-editable';
    out.pitchNotEditableWhy =
      'This face names a building section but carries no definition of it, so a pitch ' +
      'set here would have nowhere to live. Retrace the section to edit it.';
  } else if (rec.kind === 'flat' || rec.kind === 'shed') {
    // 🚨 A FLAT DECK IS A SINGLE-PLANE ROOF AT ZERO DEGREES, NOT A ROOF THAT
    // CANNOT HAVE A PITCH. This used to read "not-editable — change its roof
    // kind to Shed", which told a person holding a 2-in-12 porch to go and
    // learn an internal noun. `flat` and `shed` are the same topology (one
    // planar face, one builder); the only difference was that one pinned the
    // physical dimension to zero. Typing a pitch now converts the section in
    // place, keeping the footprint, the pad, the eave and the id — see
    // `applySectionEdit`.
    out.pitchScope = 'shed-deck';
    out.sectionPitchDeg = rec.pitchDeg;
  } else if (!out.faceKey) {
    out.pitchScope = 'not-editable';
    out.pitchNotEditableWhy =
      'This face belongs to a section but does not say which face it is, so its pitch ' +
      'cannot be set on its own. Edit the whole section instead.';
  } else {
    out.pitchScope = 'section-face';
    out.sectionPitchDeg = rec.pitchDeg;
    const own = rec.facePitchDeg ? rec.facePitchDeg[out.faceKey] : undefined;
    out.overridesSectionPitch =
      typeof own === 'number' && isFinite(own) && Math.abs(own - rec.pitchDeg) > 1e-9;
  }

  const poly = (plane.polygon3D ?? []) as Cart3[];
  if (poly.length >= 3) {
    let lo = Infinity, hi = -Infinity;
    for (const p of poly) {
      const h = ecefToLatLng(p).height;
      if (!isFinite(h)) continue;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    if (isFinite(lo) && isFinite(hi)) {
      // Vertical component of the render lift. `pitch` is the angle from
      // horizontal, so a flat deck loses the full 0.12 m and a steep face less.
      const tilt = isFinite(plane.pitch) ? plane.pitch : 0;
      const liftUp = SURFACE_OFFSET_M * Math.cos(tilt * DEG);
      out.eaveElevM = lo - liftUp;
      out.ridgeElevM = hi - liftUp;
    }
  }

  // A section face knows its own pad, so its wall height is real without the
  // caller having to supply one.
  const fromSection = plane.section && isFinite(plane.section.groundElevM)
    ? plane.section.groundElevM
    : null;
  const ground = fromSection != null
    ? fromSection
    : (typeof groundElevM === 'number' && isFinite(groundElevM) ? groundElevM : null);

  if (ground != null && out.eaveElevM != null) {
    out.groundResolved = true;
    out.wallHeightM = out.eaveElevM - ground;
  }
  return out;
}

// ── A WALL ──────────────────────────────────────────────────────────────────
//
// 🚨 THE THIRD SELECTABLE OBJECT, AND UNTIL NOW A HOLE IN THE SCENE.
//
// Walls are drawn as `[BUILD3D-WALL] <faceId>#<edgeIndex>` and that string was
// matched by nothing: a click on a wall fell through to a geometric ray test
// which answered with whatever roof lay BEHIND it, so at street level clicking
// the front of the house selected a slope on the far side of the ridge. The
// first repair routed a wall click to the face that owns it — honest, but it
// still could not answer the question a person clicking a wall is asking,
// which is "how tall is THIS wall".
//
// A wall is DERIVED, not stored: it is one edge of one roof face, dropped to
// the ground. So it has no record of its own and nothing here can edit it
// directly — changing a wall means changing the section's eave or the pad it
// stands on, and the inspector says so rather than offering a control that
// writes nowhere.

/** `${faceId}#${edgeIndex}` — the id the renderer already tags walls with. */
export function wallId(faceId: string, edgeIndex: number): string {
  return `${faceId}#${edgeIndex}`;
}

/** Split a wall id back into its parts, or nulls when it is not one. */
export function parseWallId(id: string | null | undefined): { faceId: string | null; edgeIndex: number } {
  if (!id) return { faceId: null, edgeIndex: -1 };
  const hash = id.lastIndexOf('#');
  if (hash <= 0) return { faceId: null, edgeIndex: -1 };
  const tail = id.slice(hash + 1);
  // 🚨 DIGITS, TESTED AS A STRING. `Number('')` is 0 and `Number.isInteger(0)`
  // is true, so "face#" — a truncated or half-built tag — parsed as EDGE ZERO
  // and the panel would have measured a real wall the user never clicked.
  if (!/^\d+$/.test(tail)) return { faceId: null, edgeIndex: -1 };
  return { faceId: id.slice(0, hash), edgeIndex: Number(tail) };
}

export interface WallMeasurement {
  /** 🚨 Uniform shape — see SectionLookup. */
  found: boolean;
  wallId: string;
  faceId: string | null;
  sectionId: string | null;
  /** Plan length of the wall, metres. Not the sloping length of its top edge. */
  lengthM: number | null;
  /** Absolute elevation of the ground this wall stands on. Null when unknown. */
  baseElevM: number | null;
  /** Absolute elevations of the two top corners, render lift removed. */
  topLowElevM: number | null;
  topHighElevM: number | null;
  /** Height at each end = top − base. Null when the ground is unknown, which is
   *  the honest answer rather than a number measured from nothing. */
  heightLowM: number | null;
  heightHighM: number | null;
  /** Compass bearing the wall FACES (outward), degrees. */
  facingDeg: number | null;
  /** True when this is a gable/rake wall: its two ends differ by more than a
   *  few centimetres, so "the wall height" is a range and is shown as one. */
  raked: boolean;
  refusals: SectionRefusal[];
}

const noWall = (id: string, refusals: SectionRefusal[]): WallMeasurement => ({
  found: false, wallId: id, faceId: null, sectionId: null,
  lengthM: null, baseElevM: null, topLowElevM: null, topHighElevM: null,
  heightLowM: null, heightHighM: null, facingDeg: null, raked: false, refusals,
});

/**
 * Measure one wall from the canonical geometry of the face it hangs from.
 *
 * 🚨 THE RENDER LIFT IS REMOVED FROM THE HEIGHTS AND IGNORED FOR THE LENGTH.
 * `polygon3D` is lifted SURFACE_OFFSET_M along the face normal. Vertically that
 * is lift·cos(tilt), which is what `measureFaceVertical` subtracts and what is
 * subtracted here. Horizontally it shifts BOTH endpoints of an edge by the same
 * vector, so the plan length is unaffected and must not be "corrected" twice.
 */
export function measureWall(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  id: string,
  groundElevM?: number | null,
): WallMeasurement {
  const { faceId, edgeIndex } = parseWallId(id);
  if (!faceId) {
    return noWall(id ?? '', [{ code: 'SECTION_NOT_FOUND', message: 'That is not a wall.' }]);
  }
  const plane = planeById(planes, faceId);
  if (!plane) {
    return noWall(id, [{ code: 'SECTION_NOT_FOUND', message: 'The roof face this wall hangs from is not in this design.' }]);
  }
  const poly = (plane.polygon3D ?? []) as Cart3[];
  if (poly.length < 3 || edgeIndex >= poly.length) {
    return noWall(id, [{ code: 'FOOTPRINT_TOO_FEW_POINTS', message: 'That face has no such edge.' }]);
  }

  const out = noWall(id, []);
  out.found = true;
  out.faceId = faceId;
  out.sectionId = plane.sectionId || sectionIdOfFaceId(plane.id);

  const a = ecefToLatLng(poly[edgeIndex]);
  const b = ecefToLatLng(poly[(edgeIndex + 1) % poly.length]);
  if (!isFinite(a.lat) || !isFinite(b.lat)) {
    return noWall(id, [{ code: 'FOOTPRINT_DEGENERATE', message: 'That wall has no usable corners.' }]);
  }

  const latRef = (a.lat + b.lat) / 2;
  const perLat = mPerDegLat(latRef);
  const perLng = mPerDegLng(latRef);
  const dE = (b.lng - a.lng) * perLng;
  const dN = (b.lat - a.lat) * perLat;
  out.lengthM = Math.hypot(dE, dN);

  const tilt = isFinite(plane.pitch) ? plane.pitch : 0;
  const liftUp = SURFACE_OFFSET_M * Math.cos(tilt * DEG);
  const hA = a.height - liftUp;
  const hB = b.height - liftUp;
  out.topLowElevM = Math.min(hA, hB);
  out.topHighElevM = Math.max(hA, hB);
  out.raked = Math.abs(hA - hB) > 0.03;

  // 🚨 THE PAD, NOT A GUESS. A section face knows the ground it stands on; a
  // standalone face does not, and the caller's viewer elevation is the only
  // other candidate. With neither, the height has NO answer and is reported as
  // none — which is the instruction: show unresolved rather than a misleading
  // number.
  const fromSection = plane.section && isFinite(plane.section.groundElevM)
    ? plane.section.groundElevM : null;
  const ground = fromSection != null
    ? fromSection
    : (typeof groundElevM === 'number' && isFinite(groundElevM) ? groundElevM : null);
  if (ground != null) {
    out.baseElevM = ground;
    out.heightLowM = out.topLowElevM - ground;
    out.heightHighM = out.topHighElevM - ground;
  }

  // Which way it faces: perpendicular to the run, pointing AWAY from the face's
  // centroid, because the wall is on the outside of the building.
  if (out.lengthM > 1e-6) {
    const ue = dE / out.lengthM, un = dN / out.lengthM;
    let cE = 0, cN = 0;
    for (const p of poly) {
      const q = ecefToLatLng(p);
      cE += (q.lng - a.lng) * perLng;
      cN += (q.lat - a.lat) * perLat;
    }
    cE /= poly.length; cN /= poly.length;
    // Midpoint of the edge, in the same local frame.
    const mE = dE / 2, mN = dN / 2;
    // Left-hand perpendicular, then flipped if it points at the centroid.
    let pE = -un, pN = ue;
    if ((cE - mE) * pE + (cN - mN) * pN > 0) { pE = -pE; pN = -pN; }
    out.facingDeg = ((Math.atan2(pE, pN) / DEG) % 360 + 360) % 360;
  }

  return out;
}

// ── Panels follow the roof they stand on ────────────────────────────────────

/**
 * Move already-placed panels onto the rebuilt version of the face they belong to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 WHY THIS IS NOT OPTIONAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `PlacedPanel` carries BOTH descriptions of where a panel is:
 *
 *    planeId + gridRow/gridCol     where it BELONGS — a slot on a roof face
 *    lat / lng / height / frame    where it is DRAWN — absolute, in ECEF
 *
 * A section edit moves the first and not the second. Nothing in the app
 * re-places panels when `roofPlanes` changes, so raising a section's eave by a
 * foot leaves its whole array a foot under the roof — inside the house. That is
 * the same defect this project has already shipped twice, as "the panels are
 * inside of the house and not on top of the planes" and as "NO DECK under the
 * array", and a person who lays panels and THEN corrects the building hits it
 * immediately.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW IT MOVES THEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Rigidly, in the face's own frame. A panel's offset from the old face's origin
 * is expressed in that face's (u, v, n) axes, and re-applied in the new face's
 * — so the array keeps its layout, its spacing and its position on the roof,
 * and simply travels with the surface. The normal component is REPLACED rather
 * than carried, with the racking stack from `lib/roofMountDatum` — the one
 * datum authority — so a panel that was correctly mounted stays correctly
 * mounted and one that had drifted is put right.
 *
 * 🚨 A PANEL WHOSE FACE IS GONE IS REPORTED, NEVER REHOMED. Changing a hip to a
 * gable destroys two faces. Guessing those panels onto a neighbour would move
 * modules the user never asked to move, onto a roof plane that may not fit
 * them. They are returned untouched and named in `orphaned` so the caller can
 * say so.
 */
/**
 * Is (u, v) — a position in a face's own axes — inside that face's outline?
 *
 * The outline comes from `polygon3D`, projected into the same axes, so the test
 * is in the surface's own plane and no approximation of "up" enters it. Ray
 * casting, with a small outward tolerance: a panel exactly on the eave line is
 * on the roof, and floating-point should not decide otherwise.
 */
function pointOnFace(
  u: number, v: number,
  plane: RoofPlane,
  origin: { x: number; y: number; z: number },
  frame: { u: Cart3; v: Cart3; n: Cart3 },
): boolean {
  const poly = (plane.polygon3D ?? []) as Cart3[];
  if (poly.length < 3) return true;          // nothing to test against
  const ring = poly.map(q => {
    const d = { x: q.x - origin.x, y: q.y - origin.y, z: q.z - origin.z };
    return {
      u: d.x * frame.u.x + d.y * frame.u.y + d.z * frame.u.z,
      v: d.x * frame.v.x + d.y * frame.v.y + d.z * frame.v.z,
    };
  });

  // A panel half off the edge is still on the roof as far as this question
  // goes; one whose centre is metres away is not.
  const TOL = 0.35;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const r of ring) {
    if (r.u < minU) minU = r.u; if (r.u > maxU) maxU = r.u;
    if (r.v < minV) minV = r.v; if (r.v > maxV) maxV = r.v;
  }
  if (u < minU - TOL || u > maxU + TOL || v < minV - TOL || v > maxV + TOL) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.v > v) !== (b.v > v)
      && u < ((b.u - a.u) * (v - a.v)) / ((b.v - a.v) || 1e-12) + a.u) inside = !inside;
  }
  if (inside) return true;

  // Outside the ring but within TOL of an edge counts as on the roof.
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const du = b.u - a.u, dv = b.v - a.v;
    const len2 = du * du + dv * dv;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((u - a.u) * du + (v - a.v) * dv) / len2)) : 0;
    if (Math.hypot(u - (a.u + t * du), v - (a.v + t * dv)) <= TOL) return true;
  }
  return false;
}

/**
 * The ECEF centroid of a face's own corners.
 *
 * 🚨 THE ONE ANCHOR TWO FITS OF THE SAME FACE AGREE ABOUT. `origin3D` is
 * whichever corner the builder started from, so it MOVES when the fit changes
 * — and it does change, at the 3.045 deg tilt threshold where
 * `buildRoofPlane3D` switches from `cross(normal, radialUp)` to the most
 * horizontal polygon edge. Anchoring a rigid map on it translated a whole array
 * by the face diagonal the moment a flat porch was given a slope.
 */
function ringCentroid(plane: RoofPlane | null | undefined): { x: number; y: number; z: number } | null {
  const poly = (plane?.polygon3D ?? []) as Array<{ x: number; y: number; z: number }>;
  const good = poly.filter(p => p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z));
  if (good.length < 3) return null;
  return {
    x: good.reduce((s, p) => s + p.x, 0) / good.length,
    y: good.reduce((s, p) => s + p.y, 0) / good.length,
    z: good.reduce((s, p) => s + p.z, 0) / good.length,
  };
}

export interface PanelRepositionOutcome {
  /** 🚨 Uniform shape — see SectionLookup. */
  panels: PlacedPanel[];
  /** How many actually moved. */
  moved: number;
  /** Panels whose face no longer exists. Returned unchanged, and named. */
  orphaned: string[];
}

export function repositionPanelsForPlanes(
  panels: ReadonlyArray<PlacedPanel> | null | undefined,
  before: ReadonlyArray<RoofPlane> | null | undefined,
  after: ReadonlyArray<RoofPlane> | null | undefined,
  mountingSystemId?: string | null,
): PanelRepositionOutcome {
  const out: PanelRepositionOutcome = { panels: (panels ?? []).slice(), moved: 0, orphaned: [] };
  if (!panels || panels.length === 0) return out;

  const oldById = new Map((before ?? []).map(p => [p.id, p]));
  const newById = new Map((after ?? []).map(p => [p.id, p]));

  out.panels = panels.map(panel => {
    const planeId = panel.planeId;
    if (!planeId) return panel;                       // a ground or fence array
    const oldPlane = oldById.get(planeId);
    const newPlane = newById.get(planeId);

    if (oldPlane && !newPlane) { out.orphaned.push(panel.id); return panel; }
    if (!oldPlane || !newPlane) return panel;

    const oA = oldPlane.origin3D, nA = newPlane.origin3D;
    const oF = oldPlane.ecefFrame3D, nF = newPlane.ecefFrame3D;
    if (!oA || !nA || !oF || !nF) return panel;       // nothing to map through

    // Unchanged geometry: leave the panel byte-identical rather than pushing it
    // through a round-trip that would perturb it in the last decimals.
    if (oA.x === nA.x && oA.y === nA.y && oA.z === nA.z
      && oF.n.x === nF.n.x && oF.n.y === nF.n.y && oF.n.z === nF.n.z
      && oF.u.x === nF.u.x && oF.u.y === nF.u.y && oF.u.z === nF.u.z) {
      return panel;
    }

    if (!isFinite(panel.lat) || !isFinite(panel.lng) || !isFinite(panel.height as number)) return panel;
    const world = latLngToECEF(panel.lat, panel.lng, panel.height as number);

    // 🚨 ANCHORED ON THE FACE CENTROID, NOT ON `origin3D`.
    //
    // `origin3D` is the first CLICKED corner, and the builder chooses it — so
    // it is a property of how the face was fitted, not of where the face is.
    // Crossing the frame threshold below moves it to the opposite corner, and a
    // map anchored there translates the whole array by the diagonal. The
    // centroid of the same footprint is the same physical point however the
    // face is fitted, so it is the one anchor both frames agree about.
    const oC = ringCentroid(oldPlane) ?? oA;
    const nC = ringCentroid(newPlane) ?? nA;
    const d = { x: world.x - oC.x, y: world.y - oC.y, z: world.z - oC.z };

    // The panel's position in the OLD face's own axes.
    let u = d.x * oF.u.x + d.y * oF.u.y + d.z * oF.u.z;
    let v = d.x * oF.v.x + d.y * oF.v.y + d.z * oF.v.z;

    // 🚨 THE TWO FRAMES MUST POINT THE SAME WAY, AND ACROSS ONE PARTICULAR
    // EDIT THEY DO NOT.
    //
    // `buildRoofPlane3D` derives the u-axis as `cross(normal, radialUp)`, whose
    // magnitude is sin(tilt), and falls back to the most horizontal polygon
    // EDGE whenever that is under 0.05 — i.e. below asin(0.05) = 3.0452 deg.
    // Every FLAT deck is under that threshold and every real porch pitch is
    // over it (1/12 = 4.76 deg), so giving a flat porch a slope crosses it, and
    // the fitted u-axis bearing flips from 90 deg to 270 deg with `origin3D`
    // jumping to the opposite corner.
    //
    // This map carries a panel by its (u, v) in the old frame into (u, v) in the
    // new one. With the frame reversed that is a 180 deg ROTATION about the face
    // centre: an adversary measured nine modules travelling 5.04 m on an 8 x 3 m
    // deck, reported as `moved: 9, orphaned: 0`, because on a symmetric
    // footprint the rotated array is still inside the outline — the
    // reports-success-while-wrong class the containment guard below exists to
    // catch and structurally cannot. On an L-shaped deck it silently orphaned
    // nine of twenty-one.
    //
    // A frame is a CHOICE of axes for the same surface, so the fix is to
    // express the panel in whichever handedness the new frame uses rather than
    // to assume the two agree. A reversal shows up as a negative dot product,
    // and the correction is exact, not a tolerance.
    const uDot = oF.u.x * nF.u.x + oF.u.y * nF.u.y + oF.u.z * nF.u.z;
    const vDot = oF.v.x * nF.v.x + oF.v.y * nF.v.y + oF.v.z * nF.v.z;
    if (uDot < 0) u = -u;
    if (vDot < 0) v = -v;

    // 🚨 THE NORMAL COMPONENT IS CARRIED, NOT RECOMPUTED.
    //
    // A first version imposed `moduleStackHeightM(racking)` here, reasoning
    // that lib/roofMountDatum is the one answer to "how far above the deck does
    // a module sit". Measured, that was wrong twice over: the panels
    // `buildSurfaceGrid` actually produces sit at a different offset from the
    // lifted `origin3D` than that constant (the origin already carries
    // SURFACE_OFFSET_M, and the grid's own datum handling is not a bare
    // addition of the stack), and the mounting system is not reliably on the
    // panel, so the fallback silently changed every panel's standoff by 2 cm.
    //
    // This operation is "the roof moved, bring the array with it". A rigid
    // motion is exactly that, and it cannot introduce a datum disagreement it
    // was not asked to fix. Whatever standoff a panel had, it keeps.
    const stack = d.x * oF.n.x + d.y * oF.n.y + d.z * oF.n.z;
    void mountingSystemId; void moduleStackHeightM;

    const p = {
      x: nC.x + nF.u.x * u + nF.v.x * v + nF.n.x * stack,
      y: nC.y + nF.u.y * u + nF.v.y * v + nF.n.y * stack,
      z: nC.z + nF.u.z * u + nF.v.z * v + nF.n.z * stack,
    };
    const g = ecefToLatLng(p);
    if (!isFinite(g.lat) || !isFinite(g.lng) || !isFinite(g.height)) return panel;

    // 🚨 A RIGID MAP IS ONLY VALID IF THE PANEL LANDS ON THE NEW FACE.
    //
    // Most edits — eave, pad, a small pitch change, a translation — deform the
    // face gently and the array travels with it. Some do not. Switching a
    // gable's ridge from the long axis to the short one REPLACES a 14.0 x 5.2 m
    // face with a 9.1 x 8.1 m face at right angles to it, under the SAME id. An
    // adversarial audit measured a rigid map putting 8 of 22 panels clean off
    // that roof — and reporting "22 moved, 0 orphaned", which is the
    // reports-success-while-wrong class this whole pass exists to remove.
    //
    // So containment is checked, in the new face's own (u, v). A panel whose
    // centre is not on the new surface is returned UNTOUCHED and named, exactly
    // like one whose face was deleted.
    // `pointOnFace` builds the ring in the new face's axes ABOUT ITS ORIGIN, so
    // the centroid-relative coordinates are shifted onto that basis first.
    const cOff = { x: nC.x - nA.x, y: nC.y - nA.y, z: nC.z - nA.z };
    const uFromOrigin = u + (cOff.x * nF.u.x + cOff.y * nF.u.y + cOff.z * nF.u.z);
    const vFromOrigin = v + (cOff.x * nF.v.x + cOff.y * nF.v.y + cOff.z * nF.v.z);
    if (!pointOnFace(uFromOrigin, vFromOrigin, newPlane, nA, nF)) {
      out.orphaned.push(panel.id); return panel;
    }

    out.moved += 1;
    return {
      ...panel,
      lat: g.lat, lng: g.lng, height: g.height,
      // The module lies ON the roof, so its orientation is the roof's. Leaving
      // these behind is how a roof and its array come to quote two pitches.
      tilt: isFinite(newPlane.pitch) ? newPlane.pitch : panel.tilt,
      azimuth: isFinite(newPlane.azimuth) ? newPlane.azimuth : panel.azimuth,

      // 🚨 `panel.pitch` IS NEGATIVE RADIANS, NOT DEGREES.
      //
      // Everything that produces one writes `-(tiltDeg * PI / 180)`, and
      // `addPanelEntity` feeds it straight into `new C.HeadingPitchRoll(...)`.
      // A first version assigned `newPlane.pitch` — degrees, positive — and an
      // adversarial audit measured the consequence: below about 1.67 the
      // renderer's own sanity guard passes it through, so a 1.0 degree roof
      // drew its panels at 57.3 degrees nose-up.
      pitch: isFinite(newPlane.pitch) ? -(newPlane.pitch * DEG) : panel.pitch,
      heading: isFinite(newPlane.azimuth) ? newPlane.azimuth * DEG : panel.heading,

      // 🚨 AND THESE ARE THE FIELDS THE RENDERER ACTUALLY READS.
      //
      // `addPanelEntity` builds each module's rotation from `ecefNx/ecefUx`,
      // `renderRoofRails` takes the whole array's rail plane from the first
      // panel's, and the grab/snap tools resolve against them. A first version
      // wrote an `ecefFrame3D` object instead — a field `PlacedPanel` does not
      // have — so the panel was translated onto the new surface while every
      // consumer went on using the OLD normal. Measured 10.0 degrees stale
      // after a 30 -> 40 degree pitch change.
      ecefNx: nF.n.x, ecefNy: nF.n.y, ecefNz: nF.n.z,
      ecefUx: nF.u.x, ecefUy: nF.u.y, ecefUz: nF.u.z,
    } as PlacedPanel;
  });

  return out;
}

// ── Display helpers, so one rounding lives in one place ─────────────────────

/** Metres to a feet-and-inches string: 5.18 -> `17' 0"`. */
export function ftInStr(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return '—';
  const totalIn = m * FT_PER_M * 12;
  const sign = totalIn < 0 ? '-' : '';
  const abs = Math.abs(totalIn);
  let ft = Math.floor(abs / 12);
  let inch = Math.round(abs - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return `${sign}${ft}' ${inch}"`;
}

/** Metres to decimal feet, one place: 5.18 -> `17.0 ft`. */
export function ftStr1(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return '—';
  return `${(m * FT_PER_M).toFixed(1)} ft`;
}

export { FT_PER_M };
