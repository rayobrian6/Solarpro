// ═══════════════════════════════════════════════════════════════════════════
// THE BUILDING SECTION — the canonical editing unit between "project" and
// "roof face".
//
// WHAT WAS WRONG
// --------------
// There was no noun here at all. The Gable, Hip and Block tools drew Cesium
// entities and pushed a `vertexSpec` into component state; `onRoofPlaneCreated`
// fires from exactly ONE place in the engine (finalizePlane3D), so a gable a
// person placed never reached the Roof Planes sidebar, the panel layout, the
// BOM or the planset, and was gone on reload. The massing tools were a drawing
// program bolted to a design program.
//
// Worse, the gable/hip math took TWO clicks and normalised them to an
// axis-aligned bounding box, so a house rotated off north could not be modelled
// at all. That is most houses.
//
// WHAT A SECTION IS
// -----------------
//   section -> footprint -> roof faces -> (walls, derived intersections) -> render
//
// A SECTION IS NOT A ROOF FACE. A gable section owns two faces, a hip section
// owns four, and they move together. That is the whole reason the noun exists:
// the geometry that changes together must be owned together, or a "pitch"
// control has to guess whether it means one slope or the building.
//
// A section is ONE SIMPLE MASS. A real house is a SET of sections:
//   simple gable          -> 1 gable section
//   attached garage       -> 2 sections, different footprints, often same pitch
//   lower addition        -> 2 sections, different eave heights
//   cross-gable           -> 2 gable sections whose ridges cross
//   intersecting masses   -> N sections
// This is deliberate. A gable is only a gable over a quadrilateral; asked for
// one over an L, this module REFUSES rather than bounding-boxing it into a
// shape the installer did not trace. An L-shaped roof is two sections, and
// saying so is the difference between a model and a picture.
//
// WHAT THIS MODULE IS NOT
// -----------------------
// It is NOT a second geometry authority. Every face it produces is built by
// `lib/3d/footprintToRoofPlane`, the same module the hand-trace path uses, via
// the same `computePlaneFromPoints3D` + `buildRoofPlane3D` pair. A face born in
// a section is indistinguishable downstream from one traced by hand: same type,
// same frame, same panel grid, same planset consumption.
//
// 🚨 ONE RIDGE AT ONE HEIGHT. Every face of a section is lifted from ONE set of
// corner heights computed ONCE for the section. Faces derived independently
// reach different ridge heights and the roof cannot close — which is exactly
// what Ray reported ("the relative height and pitch are wrong") and what
// `roofPlaneFromFootprintAndRidge` was written to fix for a pair. A section
// extends that guarantee to all four faces of a hip, including the hip ends,
// whose apex is a point and therefore cannot be expressed as a ridge segment.
//
// 🚨 FACE IDS ARE DERIVED FROM THE SECTION ID AND ARE STABLE ACROSS A REBUILD.
// `PlacedPanel.planeId` links every panel to its face. If editing a section's
// pitch minted new face ids, every panel on it would orphan. Raising the eave
// by a foot must not delete the array.
//
// 🚨 PLAN GEOMETRY IS CANONICAL AND IS NEVER RENDER-OFFSET. The footprint here
// is what the installer traced. Nothing in this module applies SURFACE_OFFSET_M
// or any other render lift, and nothing may feed rendered coordinates back into
// it. See lib/3d/geometryMutationPolicy.ts: inference must never move a traced
// footprint; only an explicit user gesture may.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  RoofPlane,
  RoofSectionFaceKey,
  RoofSectionKind,
  RoofSectionRecord,
  RoofSectionRidgeAxis,
} from '@/types';
import {
  clampPitch,
  normalizeAzimuth,
  roofPlaneFromFootprint,
  roofPlaneFromLiftedOutline,
} from '@/lib/3d/footprintToRoofPlane';

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/** Below this, a footprint edge is a mis-click rather than a wall. */
export const MIN_SECTION_EDGE_M = 0.5;

export interface LatLng { lat: number; lng: number }

/**
 * The roof forms a single mass can take.
 *   gable — two slopes meeting at a full-length ridge
 *   hip   — two slopes plus two hipped ends, ridge set back at both ends
 *   shed  — one slope running in a stated direction (a lean-to, a modern shed)
 *   flat  — one horizontal deck (a garage, a commercial box, a porch)
 */
export type SectionRoofKind = RoofSectionKind;

/**
 * Which pair of footprint edges the ridge runs parallel to.
 *   long  — the longer pair. What a house almost always does, and the default.
 *   short — the shorter pair. Needed for the wing of a cross-gable, which runs
 *           across the main mass, and which 'auto' would get backwards.
 */
export type SectionRidgeAxis = RoofSectionRidgeAxis;

export type SectionFaceKey = RoofSectionFaceKey;

/**
 * 🚨 ONE DECLARATION, IN THE PERSISTED TYPE. The section IS its stored record —
 * see `RoofSectionRecord` in types/index.ts. Declaring a separate in-memory
 * shape here and mapping between them is how a field ends up saved by one and
 * not the other; the domain and the storage must be the same object or the
 * round-trip is a place for data to go missing.
 */
export type BuildingSection = RoofSectionRecord;

export type SectionRefusalCode =
  | 'SECTION_ID_REQUIRED'
  | 'FOOTPRINT_TOO_FEW_POINTS'
  | 'FOOTPRINT_DEGENERATE'
  | 'RIDGED_ROOF_NEEDS_FOUR_CORNERS'
  | 'PITCH_OUT_OF_RANGE'
  | 'EAVE_HEIGHT_INVALID'
  | 'GROUND_ELEV_INVALID'
  | 'FACE_CONSTRUCTION_FAILED';

export interface SectionRefusal {
  code: SectionRefusalCode;
  message: string;
}

/** One face of a section, as PLAN geometry plus the height of every corner. */
export interface SectionFace {
  /** `${sectionId}::${key}` — deterministic, so a rebuild keeps its panels. */
  id: string;
  key: SectionFaceKey;
  sectionId: string;
  /** Corners in ring order, lat/lng only. */
  outline: LatLng[];
  /** Height of each corner above LOCAL GROUND, same order and length. */
  heightsM: number[];
}

export interface SectionPlanOutcome {
  /**
   * 🚨 A UNIFORM SHAPE, NOT A DISCRIMINATED UNION. This codebase compiles with
   * `strict: false` and no strictNullChecks, so narrowing on `ok` does not hold
   * and a caller reading `.planes` on a refusal gets `undefined` at runtime with
   * no compiler complaint. Every field is always present.
   */
  ok: boolean;
  faces: SectionFace[];
  planes: RoofPlane[];
  /** Height of the ridge above local ground. Null for a deck, and on refusal. */
  ridgeHeightM: number | null;
  /** The pitch each face actually came out at, keyed by face id. Reported, not
   *  requested: a trapezoidal trace cannot give both slopes the asked-for pitch,
   *  and the honest answer is the fitted one. */
  fittedPitchByFaceId: Record<string, number>;
  refusals: SectionRefusal[];
}

// ── Local tangent-plane helpers ─────────────────────────────────────────────

interface LocalPt { e: number; n: number }

interface LocalFrame {
  cLat: number;
  cLng: number;
  mLng: number;
}

function localFrame(footprint: readonly LatLng[]): LocalFrame {
  let sumLat = 0, sumLng = 0;
  for (const v of footprint) { sumLat += v.lat; sumLng += v.lng; }
  const cLat = sumLat / footprint.length;
  const cLng = sumLng / footprint.length;
  const cosLat = Math.cos(cLat * DEG);
  return { cLat, cLng, mLng: M_PER_DEG_LAT * (cosLat > 0.01 ? cosLat : 1) };
}

function toLocal(v: LatLng, f: LocalFrame): LocalPt {
  return { e: (v.lng - f.cLng) * f.mLng, n: (v.lat - f.cLat) * M_PER_DEG_LAT };
}

function fromLocal(p: LocalPt, f: LocalFrame): LatLng {
  return { lat: f.cLat + p.n / M_PER_DEG_LAT, lng: f.cLng + p.e / f.mLng };
}

function midLocal(a: LocalPt, b: LocalPt): LocalPt {
  return { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
}

function distLocal(a: LocalPt, b: LocalPt): number {
  return Math.hypot(a.e - b.e, a.n - b.n);
}

/** Perpendicular distance from point `p` to the infinite line through a and b. */
function perpDistance(p: LocalPt, a: LocalPt, b: LocalPt): number {
  const de = b.e - a.e, dn = b.n - a.n;
  const mag = Math.hypot(de, dn);
  if (!(mag > 1e-9)) return distLocal(p, a);
  const ue = de / mag, un = dn / mag;
  const pe = p.e - a.e, pn = p.n - a.n;
  const along = pe * ue + pn * un;
  return Math.hypot(pe - along * ue, pn - along * un);
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * The face id for a section face. Deterministic and stable across every
 * rebuild of the same section, which is what lets a person change the pitch
 * without orphaning the panels standing on it.
 */
export function sectionFaceId(sectionId: string, key: SectionFaceKey): string {
  return sectionId + '::' + key;
}

/** Does this plane id belong to a section, and if so which? Null when the face
 *  was hand-traced and belongs to no section — which stays legal. */
export function sectionIdOfFaceId(faceId: string | null | undefined): string | null {
  if (!faceId) return null;
  const i = faceId.indexOf('::');
  return i > 0 ? faceId.slice(0, i) : null;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Everything wrong with a section, in one pass. Returns ALL the problems, not
 * the first: an installer who fixes one field and is refused again for another
 * has been told half the truth twice.
 */
export function validateSection(section: BuildingSection): SectionRefusal[] {
  const out: SectionRefusal[] = [];
  const add = (code: SectionRefusalCode, message: string) => out.push({ code, message });

  if (!section || typeof section.id !== 'string' || !section.id.trim()) {
    add('SECTION_ID_REQUIRED', 'A section must have a stable id before it can own faces.');
  }
  const fp = section && section.footprint;
  if (!Array.isArray(fp) || fp.length < 3) {
    add('FOOTPRINT_TOO_FEW_POINTS', 'Trace at least 3 corners to define a footprint.');
    return out; // nothing below can be measured without a ring
  }
  for (const v of fp) {
    if (!v || !isFinite(v.lat) || !isFinite(v.lng)) {
      add('FOOTPRINT_DEGENERATE', 'A footprint corner has no usable position.');
      return out;
    }
  }

  const ridged = section.kind === 'gable' || section.kind === 'hip';
  if (ridged && fp.length !== 4) {
    add(
      'RIDGED_ROOF_NEEDS_FOUR_CORNERS',
      'A ' + section.kind + ' roof is defined over four corners; this footprint has ' +
      fp.length + '. An L-shaped or cross-gabled roof is more than one section — trace it ' +
      'as separate sections rather than approximating it with one.',
    );
  }

  const f = localFrame(fp);
  const loc = fp.map(v => toLocal(v, f));
  let longest = 0;
  for (let i = 0; i < loc.length; i++) {
    const d = distLocal(loc[i], loc[(i + 1) % loc.length]);
    if (d > longest) longest = d;
  }
  if (!(longest > MIN_SECTION_EDGE_M)) {
    add('FOOTPRINT_DEGENERATE', 'That footprint is smaller than half a metre across.');
  }

  if (section.kind !== 'flat') {
    if (!isFinite(section.pitchDeg) || section.pitchDeg < 0 || section.pitchDeg > 60) {
      add('PITCH_OUT_OF_RANGE', 'Pitch must be between 0 and 60 degrees.');
    }
  }
  if (!isFinite(section.eaveHeightM) || section.eaveHeightM < 0) {
    add('EAVE_HEIGHT_INVALID', 'Eave height must be a number of metres above ground, 0 or more.');
  }
  if (!isFinite(section.groundElevM)) {
    add('GROUND_ELEV_INVALID', 'Ground elevation has not resolved yet.');
  }
  return out;
}

// ── Face layout ─────────────────────────────────────────────────────────────

/**
 * Lay out the faces of a section as PLAN outlines plus per-corner heights.
 *
 * Pure geometry, no ECEF, no Cesium. Split out from the plane build so a test
 * can assert the SHAPE of a cross-gable wing independently of whether the plane
 * fitter liked it.
 */
export function layoutSectionFaces(
  section: BuildingSection,
): { faces: SectionFace[]; ridgeHeightM: number | null; refusals: SectionRefusal[] } {
  const refusals = validateSection(section);
  if (refusals.length > 0) return { faces: [], ridgeHeightM: null, refusals };

  const fp = section.footprint;
  const eave = section.eaveHeightM;
  const id = section.id;

  // FLAT and SHED are single-face sections. Their corner heights are not needed
  // to build them — they go through `roofPlaneFromFootprint`, which derives the
  // lift from a pitch and an azimuth. Recorded flat so the face shape is uniform
  // across kinds and callers never special-case.
  if (section.kind === 'flat' || section.kind === 'shed') {
    return {
      faces: [{
        id: sectionFaceId(id, 'deck'),
        key: 'deck',
        sectionId: id,
        outline: fp.map(v => ({ lat: v.lat, lng: v.lng })),
        heightsM: fp.map(() => eave),
      }],
      ridgeHeightM: null,
      refusals: [],
    };
  }

  // ── Ridged roofs. Four corners, ANY rotation. ─────────────────────────────
  //
  // 🚨 THE CORNERS ARE USED AS TRACED. The previous gable tool took two clicks
  // and normalised them to an axis-aligned bounding box, so it could only model
  // a house square to north. Working from the traced ring costs nothing and
  // models the building that is actually there.
  const f = localFrame(fp);
  const p = fp.map(v => toLocal(v, f));

  // Two opposite edge pairs: (p0->p1, p2->p3) and (p1->p2, p3->p0).
  const pairA = (distLocal(p[0], p[1]) + distLocal(p[2], p[3])) / 2;
  const pairB = (distLocal(p[1], p[2]) + distLocal(p[3], p[0])) / 2;

  const axis: SectionRidgeAxis = section.ridgeAxis && section.ridgeAxis !== 'auto'
    ? section.ridgeAxis
    : 'long';
  // The ridge runs PARALLEL to the eave pair it serves — the pair whose two
  // edges are the gutters. For 'long' that is the longer pair.
  const ridgeServesPairA = axis === 'long' ? pairA >= pairB : pairA < pairB;

  // Ridge ends are the midpoints of the OTHER (rake) pair.
  const rA = ridgeServesPairA ? midLocal(p[3], p[0]) : midLocal(p[0], p[1]);
  const rB = ridgeServesPairA ? midLocal(p[1], p[2]) : midLocal(p[2], p[3]);

  // Half-span: mean perpendicular distance from the ridge line to the eaves.
  // For a parallelogram every corner is equidistant; for a general quad the
  // mean is the honest single number, and each face's fitted pitch then tells
  // the truth about what that produced.
  const halfSpan = p.reduce((s, q) => s + perpDistance(q, rA, rB), 0) / p.length;
  if (!(halfSpan > MIN_SECTION_EDGE_M / 2)) {
    return {
      faces: [],
      ridgeHeightM: null,
      refusals: [{
        code: 'FOOTPRINT_DEGENERATE',
        message: 'That footprint has no depth across the ridge — it is a line, not a roof.',
      }],
    };
  }

  const pitch = clampPitch(section.pitchDeg);
  const ridgeHeightM = eave + halfSpan * Math.tan(pitch * DEG);

  // Eave corners in the order each face needs them.
  const eaveA: [LocalPt, LocalPt] = ridgeServesPairA ? [p[0], p[1]] : [p[1], p[2]];
  const eaveB: [LocalPt, LocalPt] = ridgeServesPairA ? [p[2], p[3]] : [p[3], p[0]];
  // The rake edges, which a hip turns into hipped ends.
  const rakeA: [LocalPt, LocalPt] = ridgeServesPairA ? [p[3], p[0]] : [p[0], p[1]];
  const rakeB: [LocalPt, LocalPt] = ridgeServesPairA ? [p[1], p[2]] : [p[2], p[3]];

  const faces: SectionFace[] = [];
  const pushFace = (key: SectionFaceKey, pts: LocalPt[], hs: number[]) => {
    faces.push({
      id: sectionFaceId(id, key),
      key,
      sectionId: id,
      outline: pts.map(q => fromLocal(q, f)),
      heightsM: hs,
    });
  };

  if (section.kind === 'gable') {
    // Two slopes, each running from its own eave up to the FULL ridge.
    pushFace('slopeA', [eaveA[0], eaveA[1], rB, rA], [eave, eave, ridgeHeightM, ridgeHeightM]);
    pushFace('slopeB', [eaveB[0], eaveB[1], rA, rB], [eave, eave, ridgeHeightM, ridgeHeightM]);
    return { faces, ridgeHeightM, refusals: [] };
  }

  // ── HIP. The ridge is set back from both ends by the half-span, which is
  // what makes the hipped end slope at the same pitch as the main faces.
  const ridgeLen = distLocal(rA, rB);
  const ue = (rB.e - rA.e) / (ridgeLen || 1);
  const un = (rB.n - rA.n) / (ridgeLen || 1);

  // 🚨 WHEN THE SETBACKS MEET, A HIP IS A PYRAMID. On a footprint no longer
  // than it is wide the ridge has no length left: both ends collapse to the
  // centre and all four faces become triangles. That is a real roof (a pyramid
  // hip on a square addition), so it is built, not refused — but it must not be
  // built by letting the ridge run BACKWARDS, which is what an unclamped
  // setback does and which turns the roof inside out.
  //
  // 🚨 THE TEST IS A LENGTH, NOT AN EQUALITY. `ridgeLen <= 2 * halfSpan` is an
  // exact float comparison on two independently accumulated sums, and on a
  // literal square it lands on the wrong side about half the time: the ridge
  // survives as a sub-micron segment, both slopes come out as QUADS with two
  // coincident corners, and the hip ends become slivers. A ridge shorter than
  // the module's minimum edge is not a ridge — it is an apex.
  const collapsed = ridgeLen - 2 * halfSpan < MIN_SECTION_EDGE_M;
  const setback = collapsed ? ridgeLen / 2 : halfSpan;
  const hA: LocalPt = { e: rA.e + ue * setback, n: rA.n + un * setback };
  const hB: LocalPt = { e: rB.e - ue * setback, n: rB.n - un * setback };

  if (collapsed) {
    const apex = midLocal(hA, hB);
    pushFace('slopeA', [eaveA[0], eaveA[1], apex], [eave, eave, ridgeHeightM]);
    pushFace('slopeB', [eaveB[0], eaveB[1], apex], [eave, eave, ridgeHeightM]);
    pushFace('hipEndA', [rakeA[0], rakeA[1], apex], [eave, eave, ridgeHeightM]);
    pushFace('hipEndB', [rakeB[0], rakeB[1], apex], [eave, eave, ridgeHeightM]);
    return { faces, ridgeHeightM, refusals: [] };
  }

  pushFace('slopeA', [eaveA[0], eaveA[1], hB, hA], [eave, eave, ridgeHeightM, ridgeHeightM]);
  pushFace('slopeB', [eaveB[0], eaveB[1], hA, hB], [eave, eave, ridgeHeightM, ridgeHeightM]);
  pushFace('hipEndA', [rakeA[0], rakeA[1], hA], [eave, eave, ridgeHeightM]);
  pushFace('hipEndB', [rakeB[0], rakeB[1], hB], [eave, eave, ridgeHeightM]);
  return { faces, ridgeHeightM, refusals: [] };
}

// ── The canonical build ─────────────────────────────────────────────────────

/**
 * Turn a section into canonical RoofPlanes.
 *
 * Every plane is built by `lib/3d/footprintToRoofPlane`. Nothing here fits a
 * plane itself, so a face born in a section and a face traced by hand are the
 * same object produced by the same code.
 */
export function buildSectionRoofPlanes(section: BuildingSection): SectionPlanOutcome {
  const laid = layoutSectionFaces(section);
  if (laid.refusals.length > 0) {
    return {
      ok: false, faces: [], planes: [], ridgeHeightM: null,
      fittedPitchByFaceId: {}, refusals: laid.refusals,
    };
  }

  const planes: RoofPlane[] = [];
  const fittedPitchByFaceId: Record<string, number> = {};
  const refusals: SectionRefusal[] = [];

  for (const face of laid.faces) {
    const built = face.key === 'deck'
      // A deck runs through the pitch/azimuth builder, which pins both to what
      // the installer asked for — a flat roof has no geometric azimuth to fit.
      ? roofPlaneFromFootprint(face.outline, {
          pitchDeg: section.kind === 'flat' ? 0 : clampPitch(section.pitchDeg),
          azimuthDeg: normalizeAzimuth(
            section.shedAzimuthDeg === null || section.shedAzimuthDeg === undefined
              ? 180 : section.shedAzimuthDeg,
          ),
          eaveHeightM: section.eaveHeightM,
          groundElevM: section.groundElevM,
        })
      : roofPlaneFromLiftedOutline(face.outline, face.heightsM, section.groundElevM);

    if (!built) {
      refusals.push({
        code: 'FACE_CONSTRUCTION_FAILED',
        message: 'The ' + face.key + ' face of this section could not be built — the traced ' +
          'corners do not describe a surface panels could sit on.',
      });
      continue;
    }

    const plane = built.plane;
    // 🚨 THE FACE ID IS THE SECTION'S, NOT THE FITTER'S. buildRoofPlane3D mints
    // a fresh id every call; keeping it would orphan every panel on this face
    // the moment the installer nudged the eave height.
    plane.id = face.id;
    plane.sectionId = section.id;
    plane.sectionFaceKey = face.key;
    // The section rides on its own faces. That is the whole persistence story:
    // `layouts.roof_planes` already round-trips arbitrary plane fields through
    // `coerceBundle`, so a section survives save, reload, archive and an address
    // change WITHOUT a new column — and therefore without a column that could
    // sit still while the geometry around it moved to another property.
    plane.section = sectionRecord(section);
    // Traced, not measured. A pitch someone typed is an estimate and flows into
    // the planset, so it goes through the same review step detected planes use.
    plane.source = 'manual';
    plane.confirmed = false;
    if (section.siteKey) plane.siteKey = section.siteKey;
    // The panel grid runs its columns along the eave rather than along whatever
    // edge the most-horizontal-edge heuristic picks — the same value the
    // hand-trace path attaches, from the same builder.
    (plane as any).__eaveDirENU = built.eaveDirENU;

    fittedPitchByFaceId[face.id] = plane.pitch;
    planes.push(plane);
  }

  if (planes.length === 0) {
    return {
      ok: false, faces: laid.faces, planes: [], ridgeHeightM: laid.ridgeHeightM,
      fittedPitchByFaceId, refusals,
    };
  }
  return {
    ok: refusals.length === 0,
    faces: laid.faces,
    planes,
    ridgeHeightM: laid.ridgeHeightM,
    fittedPitchByFaceId,
    refusals,
  };
}

// ── Persistence round-trip ──────────────────────────────────────────────────

/**
 * A deep copy of the section, as it is written onto each of its faces.
 *
 * DEEP, not a spread. A shared `footprint` array reference would mean editing
 * one face's stored copy silently edited every other face's — and the
 * disagreement check below could then never fire, because the copies would be
 * the same object rather than equal objects.
 */
export function sectionRecord(section: BuildingSection): BuildingSection {
  return {
    id: section.id,
    kind: section.kind,
    footprint: section.footprint.map(v => ({ lat: v.lat, lng: v.lng })),
    eaveHeightM: section.eaveHeightM,
    pitchDeg: section.pitchDeg,
    groundElevM: section.groundElevM,
    shedAzimuthDeg: section.shedAzimuthDeg ?? null,
    ridgeAxis: section.ridgeAxis ?? 'auto',
    siteKey: section.siteKey,
    label: section.label,
    createdAtIso: section.createdAtIso,
    source: section.source,
  };
}

/** Two stored copies of one section agree iff every defining field matches. */
function sectionRecordsAgree(a: BuildingSection, b: BuildingSection): boolean {
  return JSON.stringify(sectionRecord(a)) === JSON.stringify(sectionRecord(b));
}

export interface ReconstitutedSections {
  sections: BuildingSection[];
  /** Faces that belong to no section — hand-traced, and entirely legal. */
  standaloneFaceIds: string[];
  /**
   * 🚨 SECTIONS WHOSE STORED COPIES DISAGREED. They are NOT reconstituted and
   * NOT repaired by picking one. A section is the thing a person will edit next;
   * silently choosing a winner would let one face's stale footprint become the
   * whole building's on the next rebuild. The faces themselves are untouched and
   * keep rendering — the SECTION is what is withheld, so the operator is asked
   * rather than surprised.
   */
  conflicted: Array<{ sectionId: string; faceIds: string[] }>;
}

/**
 * Read the sections back out of a set of persisted roof planes.
 *
 * This is the reload path. It is deliberately tolerant of everything legacy:
 * a plane with no section is standalone, a project with no sections at all
 * yields none, and nothing here invents a section for a hand-traced face.
 */
export function sectionsFromPlanes(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
): ReconstitutedSections {
  const out: ReconstitutedSections = { sections: [], standaloneFaceIds: [], conflicted: [] };
  if (!planes || planes.length === 0) return out;

  const byId = new Map<string, { record: BuildingSection | null; faceIds: string[]; conflict: boolean }>();

  for (const p of planes) {
    const sid = p.sectionId || sectionIdOfFaceId(p.id);
    if (!sid || !p.section) {
      // 🚨 A sectionId with no record is NOT a section. It would reconstitute as
      // an object with no footprint, which every consumer would then have to
      // guard. Treated as standalone, which is what it can actually be used as.
      out.standaloneFaceIds.push(p.id);
      continue;
    }
    const slot = byId.get(sid) ?? { record: null, faceIds: [], conflict: false };
    slot.faceIds.push(p.id);
    if (!slot.record) slot.record = p.section;
    else if (!sectionRecordsAgree(slot.record, p.section)) slot.conflict = true;
    byId.set(sid, slot);
  }

  for (const [sid, slot] of byId) {
    if (slot.conflict) {
      out.conflicted.push({ sectionId: sid, faceIds: slot.faceIds });
      continue;
    }
    out.sections.push(sectionRecord(slot.record!));
  }
  return out;
}

/** Every face id in `planes` that belongs to this section. Used to replace a
 *  section's faces on a rebuild without touching anybody else's. */
export function faceIdsOfSection(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string,
): string[] {
  if (!planes) return [];
  return planes
    .filter(p => (p.sectionId || sectionIdOfFaceId(p.id)) === sectionId)
    .map(p => p.id);
}

/**
 * Apply a section's rebuilt faces to a plane list: replace the section's own
 * faces, leave every other plane exactly as it was.
 *
 * 🚨 REPLACE BY SECTION, NEVER BLIND-REPLACE THE LIST. The existing
 * "detect roof from aerial" path does `setRoofPlanes(planes)`, which destroys
 * every hand-modelled face in one click. Editing one section must never be able
 * to do that, so this only ever removes ids that belong to the section named.
 */
export function replaceSectionFaces(
  planes: ReadonlyArray<RoofPlane> | null | undefined,
  sectionId: string,
  rebuilt: ReadonlyArray<RoofPlane>,
): RoofPlane[] {
  const kept = (planes ?? []).filter(p => (p.sectionId || sectionIdOfFaceId(p.id)) !== sectionId);
  return [...kept, ...rebuilt];
}

/** How many faces a kind produces. Stated so the UI can say "2 faces" before
 *  anything is built, and so a test can pin the contract per kind. */
export function expectedFaceCount(kind: SectionRoofKind): number {
  switch (kind) {
    case 'gable': return 2;
    case 'hip':   return 4;
    case 'shed':  return 1;
    case 'flat':  return 1;
    default:      return 0;
  }
}

/** Ridge height above local ground, or null for a section that has no ridge. */
export function sectionRidgeHeightM(section: BuildingSection): number | null {
  return layoutSectionFaces(section).ridgeHeightM;
}
