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
  type SectionRefusal,
  type SectionRidgeAxis,
  type SectionRoofKind,
  type SectionPlanOutcome,
  type LatLng,
  buildSectionRoofPlanes,
  faceIdsOfSection,
  layoutSectionFaces,
  replaceSectionFaces,
  sectionIdOfFaceId,
  sectionRecord,
  validateSection,
} from './buildingSection';

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
  const out: SectionLookup = { found: false, section: null, faceIds: [], conflicted: false, refusals: [] };
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
  /** Roof slope, degrees from horizontal. */
  pitchDeg?: number;
  ridgeAxis?: SectionRidgeAxis;
  kind?: SectionRoofKind;
  shedAzimuthDeg?: number | null;
  label?: string;
  /** Replace the plan outline outright (the vertex-handle path). */
  footprint?: LatLng[];
  /** Slide the whole footprint. Metres, positive east / positive north. */
  moveEastM?: number;
  moveNorthM?: number;
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
  if (edit.pitchDeg !== undefined) next.pitchDeg = edit.pitchDeg;
  if (edit.ridgeAxis !== undefined) next.ridgeAxis = edit.ridgeAxis;
  if (edit.kind !== undefined) next.kind = edit.kind;
  if (edit.shedAzimuthDeg !== undefined) next.shedAzimuthDeg = edit.shedAzimuthDeg;
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
  pitchDeg: number;
  ridgeAxis: SectionRidgeAxis;
  /** Plan dimensions of the footprint's two edge pairs, metres. */
  planAM: number;
  planBM: number;
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
    ridgeAxis: section.ridgeAxis ?? 'auto',
    planAM: pairs.a,
    planBM: pairs.b,
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
    sectionId: null,
  };
  if (!plane) return out;

  out.sectionId = plane.sectionId || sectionIdOfFaceId(plane.id);
  if (isFinite(plane.pitch)) out.pitchDeg = plane.pitch;
  if (isFinite(plane.azimuth)) out.azimuthDeg = plane.azimuth;

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
    const d = { x: world.x - oA.x, y: world.y - oA.y, z: world.z - oA.z };

    // The panel's position in the OLD face's own axes.
    const u = d.x * oF.u.x + d.y * oF.u.y + d.z * oF.u.z;
    const v = d.x * oF.v.x + d.y * oF.v.y + d.z * oF.v.z;

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
      x: nA.x + nF.u.x * u + nF.v.x * v + nF.n.x * stack,
      y: nA.y + nF.u.y * u + nF.v.y * v + nF.n.y * stack,
      z: nA.z + nF.u.z * u + nF.v.z * v + nF.n.z * stack,
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
    if (!pointOnFace(u, v, newPlane, nA, nF)) { out.orphaned.push(panel.id); return panel; }

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
