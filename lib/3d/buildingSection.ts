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
import { MAX_PITCH_DEG, MIN_RIDGED_PITCH_DEG } from '@/lib/3d/pitchFormat';
import type { Cart3, Plane3DFrame } from '@/lib/roofPlane3D';

const DEG = Math.PI / 180;

// 🚨 WGS84 RADII, NOT A ROUND NUMBER. The usual `111320 m per degree of
// latitude, times cos(lat) for longitude` is a 0.3% approximation, and 0.3% of
// the span across a ridge is a real error in the RIDGE HEIGHT, which is how the
// pitch is realised. Measured at 38.6657°N asking for 30°, the round-number
// frame built a roof at 30.0689°, and a hip came out with its two slope pairs
// 0.10° apart because the meridian and prime-vertical radii differ and the
// approximation does not distinguish them. The installer types 30; the roof
// should be 30.
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

/** Metres per degree of latitude at this latitude (meridian radius of curvature). */
function mPerDegLat(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A * (1 - WGS84_E2) / Math.pow(w, 1.5)) * DEG;
}

/** Metres per degree of longitude at this latitude (prime-vertical radius). */
function mPerDegLng(latDeg: number): number {
  const s = Math.sin(latDeg * DEG);
  const w = 1 - WGS84_E2 * s * s;
  return (WGS84_A / Math.sqrt(w)) * Math.cos(latDeg * DEG) * DEG;
}

/** Below this, a footprint edge is a mis-click rather than a wall. */
export const MIN_SECTION_EDGE_M = 0.5;

/**
 * tan of the flattest slope that can still meet a ridge. Below it the run
 * needed to reach any height at all runs off the footprint, and `rise/tan`
 * overflows — so the layout refuses instead of building a roof nobody asked
 * for. `MIN_RIDGED_PITCH_DEG` lives in lib/3d/pitchFormat.ts with the rest of
 * the pitch vocabulary.
 */
const MIN_RIDGED_TAN = Math.tan(MIN_RIDGED_PITCH_DEG * DEG);

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
  | 'FOOTPRINT_SELF_INTERSECTING'
  | 'PITCH_OUT_OF_RANGE'
  /** A per-face pitch too flat to reach a ridge, or named for a face this
   *  section does not own. See `pitchForFace` and `facePitchDeg`. */
  | 'FACE_PITCH_TOO_FLAT'
  | 'FACE_PITCH_NOT_A_FACE'
  | 'EAVE_HEIGHT_INVALID'
  | 'GROUND_ELEV_INVALID'
  | 'FACE_CONSTRUCTION_FAILED'
  // ── Raised by lib/3d/sectionEditing.ts, which edits what this module builds.
  // 🚨 ONE VOCABULARY. A second refusal-code union in the editing module would
  // mean a UI switch that handles one set and silently falls through the other.
  | 'SECTION_NOT_FOUND'
  | 'SECTION_RECORDS_CONFLICT'
  | 'SECTION_RECORD_MISSING'
  /** Stitch or Square Up moved this section's faces by hand; a parametric
   *  rebuild would discard that. See `RoofPlane.sectionFaceReshaped`. */
  | 'SECTION_FACES_RESHAPED'
  /** A single-plane roof was given a pitch but has no downhill direction yet.
   *  Magnitude without direction is half a slope, and deriving the direction
   *  from polygon winding order is how a roof ends up falling into the house. */
  | 'SHED_DIRECTION_REQUIRED'
  | 'EDIT_VALUE_NOT_FINITE';

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
  /**
   * Everything the RENDERER needs, per face, alongside the plane itself.
   *
   * The engine draws a face from its fitted frame and its projected ECEF
   * corners, and registers both so selection, setbacks and the panel grid can
   * find them later. Returning them here means a section face is rendered by
   * exactly the same call as a hand-traced one, rather than the engine
   * re-deriving a frame from the plane and getting a subtly different answer.
   */
  faceBuilds: Array<{
    faceId: string;
    key: SectionFaceKey;
    plane: RoofPlane;
    frame: Plane3DFrame;
    /** The fitted, guaranteed-coplanar corners, in traced order. */
    projectedPts: Cart3[];
    eaveDirENU: { x: number; y: number };
  }>;
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
  mLat: number;
}

function localFrame(footprint: readonly LatLng[]): LocalFrame {
  let sumLat = 0, sumLng = 0;
  for (const v of footprint) { sumLat += v.lat; sumLng += v.lng; }
  const cLat = sumLat / footprint.length;
  const cLng = sumLng / footprint.length;
  const cosLat = Math.cos(cLat * DEG);
  // Near the poles cos(lat) collapses and the frame degenerates; fall back to
  // the meridian scale rather than dividing by ~0 and producing infinities.
  const mLng = cosLat > 0.01 ? mPerDegLng(cLat) : mPerDegLat(cLat);
  return { cLat, cLng, mLng, mLat: mPerDegLat(cLat) };
}

function toLocal(v: LatLng, f: LocalFrame): LocalPt {
  return { e: (v.lng - f.cLng) * f.mLng, n: (v.lat - f.cLat) * f.mLat };
}

function fromLocal(p: LocalPt, f: LocalFrame): LatLng {
  return { lat: f.cLat + p.n / f.mLat, lng: f.cLng + p.e / f.mLng };
}

function midLocal(a: LocalPt, b: LocalPt): LocalPt {
  return { e: (a.e + b.e) / 2, n: (a.n + b.n) / 2 };
}

/** Point a fraction `t` of the way from a to b. t=0.5 is `midLocal`. */
function lerpLocal(a: LocalPt, b: LocalPt, t: number): LocalPt {
  return { e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t };
}

function distLocal(a: LocalPt, b: LocalPt): number {
  return Math.hypot(a.e - b.e, a.n - b.n);
}

/** Do the open segments a-b and c-d cross? Endpoint contact does not count —
 *  adjacent edges of a ring always share one. */
function segmentsCross(a: LocalPt, b: LocalPt, c: LocalPt, d: LocalPt): boolean {
  const cross = (p: LocalPt, q: LocalPt, r: LocalPt) =>
    (q.e - p.e) * (r.n - p.n) - (q.n - p.n) * (r.e - p.e);
  const d1 = cross(c, d, a), d2 = cross(c, d, b);
  const d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))
   && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;

  // 🚨 A STRICT CROSSING IS NOT THE ONLY WAY TO FOLD A RING. The first version
  // of this guard tested only the strict case, and four self-intersecting
  // footprints still built roofs — including one with ZERO plan area, which
  // came out at 17.8° for a requested 30°. A corner that lands exactly ON the
  // opposite edge, or a ring that doubles back along itself, is degenerate in
  // the same way and for the same reason: the corners do not enclose a
  // building. Touching counts.
  const onSegment = (p: LocalPt, q: LocalPt, r: LocalPt) =>
    Math.abs(cross(p, q, r)) <= TOUCH_EPS_M2
    && Math.min(p.e, q.e) - TOUCH_EPS_M <= r.e && r.e <= Math.max(p.e, q.e) + TOUCH_EPS_M
    && Math.min(p.n, q.n) - TOUCH_EPS_M <= r.n && r.n <= Math.max(p.n, q.n) + TOUCH_EPS_M;
  return onSegment(c, d, a) || onSegment(c, d, b)
      || onSegment(a, b, c) || onSegment(a, b, d);
}

/** A centimetre, in the units this module measures in. Below it, two corners
 *  are the same click as far as a building is concerned. */
const TOUCH_EPS_M = 0.01;
/** The cross-product form of the same tolerance, for the collinearity test. */
const TOUCH_EPS_M2 = 0.01;

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

const FACE_KEYS: readonly SectionFaceKey[] = ['slopeA', 'slopeB', 'hipEndA', 'hipEndB', 'deck'];

/** The face key encoded in a section face id, or null if there is none. */
export function faceKeyOfFaceId(faceId: string | null | undefined): SectionFaceKey | null {
  if (!faceId) return null;
  const i = faceId.indexOf('::');
  if (i <= 0) return null;
  const key = faceId.slice(i + 2);
  return (FACE_KEYS as readonly string[]).includes(key) ? (key as SectionFaceKey) : null;
}

/** Which faces a section of this kind owns, in build order. */
export function faceKeysForKind(kind: SectionRoofKind): SectionFaceKey[] {
  if (kind === 'flat' || kind === 'shed') return ['deck'];
  if (kind === 'gable') return ['slopeA', 'slopeB'];
  return ['slopeA', 'slopeB', 'hipEndA', 'hipEndB'];
}

/**
 * The pitch ONE face of a section is built at.
 *
 * 🚨 THE SECTION'S `pitchDeg` IS A DEFAULT, NOT AN OVERRIDE. A face with an
 * entry in `facePitchDeg` uses it; every other face uses the section value. A
 * deck has no slope of its own to state — `flat` is horizontal by definition,
 * and a `shed` deck IS the section pitch, because a shed is one face and the
 * two numbers would be the same number stored twice.
 */
export function pitchForFace(section: BuildingSection, key: SectionFaceKey): number {
  if (!section) return 0;
  if (section.kind === 'flat') return 0;
  if (key === 'deck') return clampPitch(section.pitchDeg);
  const over = section.facePitchDeg ? section.facePitchDeg[key] : undefined;
  return clampPitch(typeof over === 'number' && isFinite(over) ? over : section.pitchDeg);
}

/** True when this section's faces do not all share one pitch. */
export function sectionHasMixedPitch(section: BuildingSection): boolean {
  if (!section || section.kind === 'flat' || section.kind === 'shed') return false;
  const keys = faceKeysForKind(section.kind);
  const first = pitchForFace(section, keys[0]);
  return keys.some(k => Math.abs(pitchForFace(section, k) - first) > 1e-9);
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

  // 🚨 A QUADRILATERAL IS NOT NECESSARILY A SIMPLE ONE, and the difference is
  // silent and severe. Clicking the corners in reading order — NW, NE, SW, SE —
  // is the natural mis-click, and the ring it produces is a bow-tie. Measured on
  // a 12 x 8 m rectangle at 38.67°N asking for 30°: the correct trace gives
  // 110.77 m² at 30.3°/29.9°; the bow-tie gives 69.19 m² at 60°/60° — 38% less
  // roof, more than double the pitch, azimuths 53° out — and came back
  // `ok: true` with no refusal at all. That flows into the panel grid, the array
  // tilt PVWatts reads, the BOM and the permit drawing.
  for (let i = 0; i < loc.length; i++) {
    for (let j = i + 2; j < loc.length; j++) {
      if (i === 0 && j === loc.length - 1) continue;   // adjacent through the wrap
      if (segmentsCross(loc[i], loc[(i + 1) % loc.length], loc[j], loc[(j + 1) % loc.length])) {
        add(
          'FOOTPRINT_SELF_INTERSECTING',
          'Those corners cross over each other, so they do not enclose a building. ' +
          'Click them IN ORDER around the outside of the footprint rather than ' +
          'left-to-right, top-to-bottom.',
        );
        i = loc.length; // one refusal is enough; the advice is the same for all
        break;
      }
    }
  }

  if (section.kind !== 'flat') {
    if (!isFinite(section.pitchDeg) || section.pitchDeg < 0 || section.pitchDeg > MAX_PITCH_DEG) {
      add('PITCH_OUT_OF_RANGE', `Pitch must be between 0 and ${MAX_PITCH_DEG} degrees.`);
    }
  }
  // 🚨 A FLAT SECTION IS NOT VALIDATED AGAINST ITS `pitchDeg`, AND MUST NOT BE.
  // A gable switched to flat arrives here still carrying its old 30°, and
  // refusing that would block a legal edit. The stale value is neutralised in
  // `sectionRecord` instead, which normalises a flat section's pitch to 0 so
  // the stored number and the built deck can never disagree — and the one
  // gesture that genuinely means "give this flat roof a slope" is refused where
  // it happens, in `applySectionEdit`. See both for the audit that found it.

  // ── PER-FACE PITCH OVERRIDES ─────────────────────────────────────────────
  //
  // 🚨 AN OVERRIDE FOR A FACE THE SECTION DOES NOT OWN IS A REFUSAL, NOT A
  // SHRUG. `pitchForFace` would never read it, so the installer would type a
  // pitch, see nothing change and have no idea why — the exact class of silent
  // no-op this editor was rebuilt to remove. It usually means the section's
  // kind was changed underneath the override (a hip turned gable still carrying
  // hipEndA), which the caller must resolve rather than inherit.
  if (section.facePitchDeg) {
    const owned = new Set<string>(faceKeysForKind(section.kind));
    for (const key of Object.keys(section.facePitchDeg)) {
      const v = (section.facePitchDeg as Record<string, number>)[key];
      if (v === undefined || v === null) continue;
      if (!(FACE_KEYS as readonly string[]).includes(key) || !owned.has(key)) {
        add('FACE_PITCH_NOT_A_FACE',
          `This ${section.kind} section has no face called "${key}", so a pitch set for it ` +
          `would never be built. Clear it, or change the section's roof kind.`);
        continue;
      }
      // 🚨 A DECK OVERRIDE IS A SECOND COPY OF THE SECTION'S OWN PITCH, AND IT
      // WAS BEING STORED AND THEN IGNORED. A shed is ONE face, so "this face's
      // pitch" and "the section's pitch" are the same physical quantity;
      // `pitchForFace` reads `section.pitchDeg` for a deck and never looks at
      // the override. An audit measured the consequence: `{facePitchDeg:
      // {deck: 40}}` on an 18° shed returned ok, stamped 40 onto every face's
      // stored record, signed it into the autosave and reloaded it forever,
      // while the roof stayed at 18°. Two answers in one object, which is the
      // defect class this module's header is about.
      if (key === 'deck') {
        add('FACE_PITCH_NOT_A_FACE',
          `A ${section.kind} section is a single face, so its pitch IS the section's pitch. ` +
          `Set the section pitch instead of a separate one for the deck.`);
        continue;
      }
      if (!isFinite(v) || v < 0 || v > MAX_PITCH_DEG) {
        add('PITCH_OUT_OF_RANGE',
          `The pitch for ${key} must be between 0 and ${MAX_PITCH_DEG} degrees.`);
        continue;
      }
      const ridged = section.kind === 'gable' || section.kind === 'hip';
      if (ridged && v < MIN_RIDGED_PITCH_DEG) {
        add('FACE_PITCH_TOO_FLAT',
          `${v}° is too flat for one face of a ${section.kind}: it never reaches the ridge. ` +
          `Use a shed or flat section for a single horizontal plane.`);
      }
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

  // The CENTRELINE of the mass — the midpoints of the rake pair. It is not
  // necessarily where the ridge ends up (see the rise solution below); it is
  // the line the span is measured across, which is a property of the footprint
  // alone and must not move when a pitch changes.
  const midA = ridgeServesPairA ? midLocal(p[3], p[0]) : midLocal(p[0], p[1]);
  const midB = ridgeServesPairA ? midLocal(p[1], p[2]) : midLocal(p[2], p[3]);

  // Half-span: mean perpendicular distance from the centreline to the eaves.
  // For a parallelogram every corner is equidistant; for a general quad the
  // mean is the honest single number, and each face's fitted pitch then tells
  // the truth about what that produced.
  const halfSpan = p.reduce((s, q) => s + perpDistance(q, midA, midB), 0) / p.length;
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

  // ── THE RIDGE IS THE SHARED UNKNOWN, NOT A FIXED CENTRELINE ──────────────
  //
  // Both slopes start at the same eave height and must arrive at the SAME
  // ridge. Write the rise (ridge above eave) as the thing they agree on:
  //
  //     dA · tanA = rise = dB · tanB       and      dA + dB = span
  //  =>  rise = span · tanA · tanB / (tanA + tanB)
  //  =>  dA   = rise / tanA,   dB = rise / tanB
  //
  // With tanA = tanB this is exactly dA = dB = span/2 and rise = halfSpan·tan,
  // which is what this function computed before per-face pitch existed, so a
  // symmetric gable is bit-for-bit unchanged. With different pitches the ridge
  // slides toward the STEEPER slope — which is what a saltbox is, and why the
  // installer no longer has to raise the partner face to close the roof again.
  const pitchA = clampPitch(pitchForFace(section, 'slopeA'));
  const pitchB = clampPitch(pitchForFace(section, 'slopeB'));
  const tanA = Math.tan(pitchA * DEG);
  const tanB = Math.tan(pitchB * DEG);

  const span = 2 * halfSpan;
  // 🚨 EQUAL PITCHES ARE SOLVED WITHOUT THE GENERAL FORMULA, AT ANY SLOPE
  // INCLUDING ZERO. A gable whose two halves match has its ridge on the
  // centreline by symmetry, and that stays true at 0°, where the general
  // solution divides 0 by 0. A 0° gable is a flat roof drawn as two faces —
  // degenerate, but it is what dragging the pitch slider to the bottom has
  // always produced here, and quietly refusing it now would be a regression
  // (tests/buildingSection.test.ts:284 pins it).
  const symmetric = Math.abs(pitchA - pitchB) < 1e-9;
  let riseM: number;
  let ridgeT: number;
  if (symmetric) {
    riseM = halfSpan * tanA;
    ridgeT = 0.5;
  } else {
    // 🚨 A FLAT FACE CANNOT MEET A RIDGE A PITCHED ONE REACHES. Slope A stays
    // at the eave the whole way across, so the only ridge it can share sits at
    // eave height — which slope B reaches only if it has no width. There is no
    // roof here to build. That is a shed with a flat deck beside it: two
    // sections, and saying so is better than clamping to a shape the installer
    // did not ask for and could not see was wrong.
    if (!(tanA > MIN_RIDGED_TAN) || !(tanB > MIN_RIDGED_TAN)) {
      return {
        faces: [],
        ridgeHeightM: null,
        refusals: [{
          code: 'FACE_PITCH_TOO_FLAT',
          message:
            'A ' + section.kind + ' with different slopes needs a real pitch on both sides: ' +
            pitchA.toFixed(1) + '° and ' + pitchB.toFixed(1) + '° were given, and a face ' +
            'flatter than ' + MIN_RIDGED_PITCH_DEG + '° never reaches the ridge the other ' +
            'one does. Use a shed section for a single sloped plane, or a flat section for ' +
            'a horizontal one.',
        }],
      };
    }
    riseM = span * tanA * tanB / (tanA + tanB);
    // Where the ridge sits across the span, as a fraction from the eave-A side.
    // Less than 0.5 when slope A is the steeper one: it needs less run.
    ridgeT = Math.min(0.999, Math.max(0.001, (riseM / tanA) / span));
  }
  const ridgeHeightM = eave + riseM;

  // Eave corners in the order each face needs them.
  const eaveA: [LocalPt, LocalPt] = ridgeServesPairA ? [p[0], p[1]] : [p[1], p[2]];
  const eaveB: [LocalPt, LocalPt] = ridgeServesPairA ? [p[2], p[3]] : [p[3], p[0]];
  // The rake edges, which a hip turns into hipped ends.
  const rakeA: [LocalPt, LocalPt] = ridgeServesPairA ? [p[3], p[0]] : [p[0], p[1]];
  const rakeB: [LocalPt, LocalPt] = ridgeServesPairA ? [p[1], p[2]] : [p[2], p[3]];

  // 🚨 THE RIDGE ENDS MUST STAY ON THE RAKE EDGES. Sliding the ridge line
  // perpendicular to itself leaves the gable-end wall behind on any footprint
  // that is not a rectangle. Parametrising ALONG each rake instead keeps the
  // ridge end where the two roof planes and the end wall actually meet, for any
  // quadrilateral, and reduces to the midpoint when ridgeT is 0.5.
  //
  // In both `ridgeServesPairA` cases the rake's eave-A corner is rakeA[1] and
  // rakeB[0] — the rings are traced in opposite senses around the two ends.
  const rA = lerpLocal(rakeA[1], rakeA[0], ridgeT);
  const rB = lerpLocal(rakeB[0], rakeB[1], ridgeT);

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

  // ── HIP. The ridge is set back from each end by exactly the run that end's
  // own pitch needs to climb the SAME rise the main slopes climb:
  //
  //     setback = rise / tan(endPitch)
  //
  // With every pitch equal that is rise/tan = halfSpan, the value this function
  // used before, so a plain hip is unchanged. Different end pitches give
  // different setbacks, which is how a hip with a steeper rake is modelled
  // rather than approximated.
  const pitchEndA = clampPitch(pitchForFace(section, 'hipEndA'));
  const pitchEndB = clampPitch(pitchForFace(section, 'hipEndB'));
  const tanEndA = Math.tan(pitchEndA * DEG);
  const tanEndB = Math.tan(pitchEndB * DEG);
  // 🚨 A FLAT HIP IS STILL A HIP SHAPE. When the whole roof is horizontal there
  // is no rise for a setback to serve, but the four faces must still be laid
  // out as a hip in PLAN or they collapse to collinear slivers that cannot be
  // built at all. The half-span is what this produced before; it keeps the
  // shape and costs nothing, because every corner is at the eave anyway.
  const flatHip = !(riseM > 1e-9);
  if (!flatHip && (!(tanEndA > MIN_RIDGED_TAN) || !(tanEndB > MIN_RIDGED_TAN))) {
    return {
      faces: [],
      ridgeHeightM: null,
      refusals: [{
        code: 'FACE_PITCH_TOO_FLAT',
        message:
          'A hipped end flatter than ' + MIN_RIDGED_PITCH_DEG + '° never reaches the ridge ' +
          'the main slopes reach. Use a gable end for a vertical wall, or a shed section ' +
          'for a single plane.',
      }],
    };
  }

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
  const wantSetbackA = flatHip ? halfSpan : riseM / tanEndA;
  const wantSetbackB = flatHip ? halfSpan : riseM / tanEndB;
  const collapsed = ridgeLen - (wantSetbackA + wantSetbackB) < MIN_SECTION_EDGE_M;
  // When they collide, share what length there is in the ratio the two end
  // pitches asked for — equal halves when the pitches are equal, which is what
  // this produced before. The apex is then steeper than requested at both ends,
  // and `fittedPitchByFaceId` reports that rather than the request.
  const wantTotal = wantSetbackA + wantSetbackB;
  const setbackA = collapsed ? ridgeLen * (wantSetbackA / (wantTotal || 1)) : wantSetbackA;
  const setbackB = collapsed ? ridgeLen * (wantSetbackB / (wantTotal || 1)) : wantSetbackB;
  const hA: LocalPt = { e: rA.e + ue * setbackA, n: rA.n + un * setbackA };
  const hB: LocalPt = { e: rB.e - ue * setbackB, n: rB.n - un * setbackB };

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
      ok: false, faces: [], planes: [], faceBuilds: [], ridgeHeightM: null,
      fittedPitchByFaceId: {}, refusals: laid.refusals,
    };
  }

  const planes: RoofPlane[] = [];
  const faceBuilds: SectionPlanOutcome['faceBuilds'] = [];
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

    // 🚨 THE ORIENTATION IS NOT OVERWRITTEN HERE, AND THAT IS THE POINT.
    //
    // A previous version of this file wrote the REQUESTED pitch and azimuth over
    // whatever the fit returned, because the fit was giving a symmetric gable
    // two different pitches. That relabelled the symptom and created a second
    // answer: `plane.pitch` said 30.000 while the plane's own `polygon3D`,
    // `normal3D` and `ecefFrame3D` still described 30.2565 and 29.8813 — and
    // Stitch, which re-derives pitch from that stored frame, put the wrong pair
    // straight back. Two answers in one object is not a fix; it is a fix that
    // survives until something re-reads the geometry.
    //
    // The cause was in `computePlaneFromPoints3D`, which measured tilt against
    // the GEOCENTRIC radial rather than the geodetic surface normal. That is now
    // fixed at the source, so the fit reports the truth, every consumer that
    // re-derives gets the same number, and this module has nothing to correct.
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
    faceBuilds.push({
      faceId: face.id,
      key: face.key,
      plane,
      frame: built.frame,
      projectedPts: built.frame.projectedPts,
      eaveDirENU: built.eaveDirENU,
    });
  }

  if (planes.length === 0) {
    return {
      ok: false, faces: laid.faces, planes: [], faceBuilds: [], ridgeHeightM: laid.ridgeHeightM,
      fittedPitchByFaceId, refusals,
    };
  }
  return {
    ok: refusals.length === 0,
    faces: laid.faces,
    planes,
    faceBuilds,
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
/**
 * A canonical, deep copy of the per-face pitch map — or `undefined` when there
 * is nothing in it.
 *
 * 🚨 CANONICAL ORDER AND CANONICAL EMPTINESS, BECAUSE TWO RECORDS ARE COMPARED
 * BY `JSON.stringify`. `sectionRecordsAgree` is what decides whether a
 * section's faces are in conflict and therefore UNEDITABLE. `{slopeA, slopeB}`
 * and `{slopeB, slopeA}` hold the same roof and stringify differently, and so
 * do `undefined` and `{}` — either would have jammed the whole section behind
 * "the faces carry different copies of its definition" for no physical reason.
 * Emitting the keys in `FACE_KEYS` order, dropping non-finite entries and
 * collapsing an empty map to `undefined` makes the comparison mean what it says.
 */
function copyFacePitch(
  src: BuildingSection['facePitchDeg'],
): BuildingSection['facePitchDeg'] {
  if (!src || typeof src !== 'object') return undefined;
  const out: Partial<Record<SectionFaceKey, number>> = {};
  let any = false;
  for (const key of FACE_KEYS) {
    const v = src[key];
    if (typeof v !== 'number' || !isFinite(v)) continue;
    out[key] = v;
    any = true;
  }
  return any ? out : undefined;
}

export function sectionRecord(section: BuildingSection): BuildingSection {
  return {
    id: section.id,
    kind: section.kind,
    footprint: section.footprint.map(v => ({ lat: v.lat, lng: v.lng })),
    eaveHeightM: section.eaveHeightM,
    // 🚨 A FLAT SECTION'S STORED PITCH IS 0, BECAUSE ITS DECK IS BUILT AT 0.
    //
    // `buildSectionRoofPlanes` hardcodes the deck horizontal —
    //     pitchDeg: section.kind === 'flat' ? 0 : clampPitch(section.pitchDeg)
    // — so any other value here is a number no geometry realises. An audit
    // traced the consequence from the Block tool in three clicks: type 25 into
    // a flat section's pitch box, the edit returns ok, the status bar says
    // "every face of the section moved together", nothing moves, `plane.pitch`
    // stays 0 for the permit and for PVWatts, and the inspector then reads
    // "Roof pitch 25.0°" about a roof with no 25° anywhere. That is the 17-ft
    // readout in a different costume.
    //
    // Normalising here — in the ONE copier every stored record passes through —
    // means the number shown and the roof built are the same answer, whatever a
    // caller hands in. A flat roof that should have a slope is a SHED, and
    // `applySectionEdit` says so rather than accepting the number.
    pitchDeg: section.kind === 'flat' ? 0 : section.pitchDeg,
    // 🚨 COPIED, AND COPIED DEEP. This function is the ONE place a section
    // record is duplicated — onto every face, into the conflict comparison, and
    // back out of `applySectionEdit`. A field missing from it does not merely
    // fail to round-trip: it is erased by the next edit of any OTHER field,
    // silently, because the rebuild stamps this copy over the faces. Sharing
    // the object instead of copying it is the other half of the same trap:
    // `sectionRecordsAgree` would then compare an object with itself.
    facePitchDeg: copyFacePitch(section.facePitchDeg),
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
  // 🚨 ORDER IS PRESERVED, AND THAT IS NOT COSMETIC.
  //
  // This used to be `[...kept, ...rebuilt]`, which moves an edited section's
  // faces to the END of the array. Two things read the ORDER:
  //
  //   1. `roofPlanes[0].pitch` is the array tilt lib/pvwatts.ts uses. Editing a
  //      section — even setting a value to what it already was — could promote
  //      a different face to index 0 and move the production estimate.
  //   2. `lib/roofPlanesSignature.ts` signs the list in order, so a no-op edit
  //      changed the signature and fired an autosave that wrote nothing new.
  //
  // A test asserting "an identical rebuild does not move the signature" caught
  // it. Each rebuilt face now takes the slot its predecessor held; faces the
  // section has GAINED (a gable becoming a hip) go in after the last one it
  // already owned, so a new face never lands at index 0 either.
  const list = (planes ?? []);
  const byId = new Map(rebuilt.map(p => [p.id, p]));
  const owns = (p: RoofPlane) => (p.sectionId || sectionIdOfFaceId(p.id)) === sectionId;

  const out: RoofPlane[] = [];
  const placed = new Set<string>();
  let lastOwnedIndex = -1;

  for (const p of list) {
    if (!owns(p)) { out.push(p); continue; }
    const next = byId.get(p.id);
    // A face the section no longer owns is dropped rather than kept as a
    // duplicate; `applySectionEdit` reports it in `removedFaceIds`.
    if (next) { out.push(next); placed.add(next.id); }
    lastOwnedIndex = out.length;
  }

  const added = rebuilt.filter(p => !placed.has(p.id));
  if (added.length === 0) return out;
  if (lastOwnedIndex < 0) return [...out, ...added];   // the section is new here
  return [...out.slice(0, lastOwnedIndex), ...added, ...out.slice(lastOwnedIndex)];
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
