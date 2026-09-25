/**
 * lib/3d/vertexMove.ts
 *
 * MOVE ONE CORNER OF ONE ROOF FACE — the whole of the maths, none of the Cesium.
 *
 * Design of record: docs/research/VERTEX-MOVE-ARCHITECTURE.md. Everything here
 * is deterministic and testable without a viewer, a GPU or a DOM, which is the
 * point: the gesture's correctness must be provable in a unit test, because the
 * browser harness this product runs under cannot pick a rendered handle at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 THE TWO RULES THIS FILE EXISTS TO ENFORCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE GRAB IS GEOMETRIC, NOT RASTERISED. A handle is picked by intersecting
 *    the pick ray with one handle-sized sphere per corner, at that corner's
 *    known ECEF position — `intersectRayWithSphere`, the same authority
 *    obstruction selection uses. `scene.pick` / `drillPick` are GPU reads and
 *    return ZERO hits under software WebGL, which is the configuration the
 *    acceptance suite runs in and the one a machine with no usable GPU falls
 *    back to. A handle nobody can pick is not a feature.
 *
 *    Note the word "sphere" is doing honest work here and dishonest work
 *    elsewhere: this is a 30 cm sphere at a corner we know the position of. It
 *    is NOT the sphere-of-the-equatorial-radius that `vertexHandlesMath`'s
 *    `pickRayToLatLng` uses to stand in for the Earth, which is ~146 m of
 *    horizontal error at one degree off nadir at this latitude and coincides
 *    with the ellipsoid only at the equator — which is the latitude its own
 *    tests happen to check it at.
 *
 * 2. THE MOVE IS `(du, dv, 0)` IN THE FACE'S OWN ECEF BASIS. The normal
 *    component is dropped by CONSTRUCTION in `inPlaneTarget`, not merely
 *    expected to be zero. Four things ride on that zero:
 *
 *      - pitch and azimuth cannot move. All corners stay coplanar, so the
 *        Newell fit in `computePlaneFromPoints3D` recovers the identical normal.
 *        An outline edit must never silently re-quote the permit's pitch.
 *      - a non-planar ring would make Newell absorb the excursion by tilting the
 *        WHOLE face by a fraction of it — a diffuse error with no single culprit
 *        on a field that reaches the planset and the structural engine.
 *      - every surviving panel stays exactly on the deck, at its old
 *        lat/lng/height, so the panel policy is a membership test and never a
 *        reposition.
 *      - the drag cannot push a corner through the roof and out the other side.
 *
 *    Reconstructing the target as `p0 + u·du + v·dv` rather than using the
 *    ray-plane hit directly is deliberate. The hit is already in the plane to
 *    within float error; rebuilding from the grabbed corner means the moved
 *    corner shares that corner's exact normal offset instead of accumulating a
 *    new rounding error every frame of a long drag.
 */

import {
  type Cart3,
  add3, sub3, scale3, dot3, mag3,
  ecefToLatLng, unliftAlongNormal, SURFACE_OFFSET_M,
} from '../roofPlane3D';
import { intersectRayWithSphere, pointInRing2D } from './placementIntersection';
import { MIN_SECTION_EDGE_M, ringIsSimple, type LocalPt } from './buildingSection';

// ─── The face's own basis ─────────────────────────────────────────────────────

/**
 * The frame a roof face's corners are expressed in.
 *
 * 🚨 THIS IS `origin3D` + `ecefFrame3D`, AND NOT `localFrame3D`. `localFrame3D`
 * is the ENU mirror; `buildSurfaceGrid` places panels from the ECEF triad. The
 * cost of confusing them is already written into the engine: a new origin on a
 * stale triad puts panels below the deck once the plane rotates by about half a
 * degree, and foreshortens the usable extent by cos squared of the error, which
 * removes whole rows and therefore moves panel count, kW and the BOM.
 */
export interface FaceBasis {
  origin: Cart3;
  u: Cart3;
  v: Cart3;
  n: Cart3;
}

/** A corner's position in the face's own plane, in metres from `origin`. */
export interface FaceUV { u: number; v: number }

/** Express an ECEF point in the face's basis. `n` is the out-of-plane part. */
export function projectIntoFace(p: Cart3, basis: FaceBasis): { u: number; v: number; n: number } {
  const rel = sub3(p, basis.origin);
  return { u: dot3(rel, basis.u), v: dot3(rel, basis.v), n: dot3(rel, basis.n) };
}

/** Back to ECEF, exactly in the plane through `origin` (the `n` term is absent). */
export function faceUVToEcef(uv: FaceUV, basis: FaceBasis): Cart3 {
  return add3(basis.origin, add3(scale3(basis.u, uv.u), scale3(basis.v, uv.v)));
}

/**
 * The face's corner ring in its own (u,v) metres, as the `{e,n}` points the
 * section geometry helpers speak. `e` is `u` — along the eave — and `n` is `v`,
 * up and down the slope. That is also the vocabulary a dimension readout should
 * use, because it is what the installer is actually moving the corner along.
 */
export function ringToFaceUV(ring: ReadonlyArray<Cart3>, basis: FaceBasis): LocalPt[] {
  return ring.map(p => {
    const rel = sub3(p, basis.origin);
    return { e: dot3(rel, basis.u), n: dot3(rel, basis.v) };
  });
}

/**
 * The in-plane target for a drag: the grabbed corner displaced by the (u,v) part
 * of the cursor delta, with the normal part DISCARDED rather than trusted to be
 * zero. See rule 2 in the header — this single line is why pitch cannot move.
 */
export function inPlaneTarget(p0: Cart3, hit: Cart3, basis: FaceBasis): Cart3 {
  const d = sub3(hit, p0);
  const du = dot3(d, basis.u);
  const dv = dot3(d, basis.v);
  return add3(p0, add3(scale3(basis.u, du), scale3(basis.v, dv)));
}

// ─── The grab ─────────────────────────────────────────────────────────────────

export interface VertexGrab {
  index: number;
  distanceAlongRay: number;
}

/**
 * Which corner did the user press on? The NEAREST corner whose handle sphere the
 * pick ray enters, or null if it entered none.
 *
 * Nearest, not first: on a roof seen from a low angle the ray can pass through
 * the handle of a far corner as well as a near one, and taking the first match
 * would grab whichever corner happens to sit earlier in the array.
 */
export function nearestVertexAlongRay(
  rayOrigin: Cart3,
  rayDirection: Cart3,
  ring: ReadonlyArray<Cart3>,
  handleRadiusM: number,
): VertexGrab | null {
  let best: VertexGrab | null = null;
  for (let i = 0; i < ring.length; i++) {
    const hit = intersectRayWithSphere(rayOrigin, rayDirection, ring[i], handleRadiusM);
    if (!hit) continue;
    if (!best || hit.distanceAlongRay < best.distanceAlongRay) {
      best = { index: i, distanceAlongRay: hit.distanceAlongRay };
    }
  }
  return best;
}

/** Handle diameter on screen, in CSS pixels. The grab target is the dot. */
export const HANDLE_PIXEL_DIAMETER = 16;
/** Never smaller than this, so a corner stays grabbable when zoomed far out. */
export const HANDLE_MIN_RADIUS_M = 0.12;
/** Never larger than this, so two corners of a small dormer stay distinct. */
export const HANDLE_MAX_RADIUS_M = 3.0;

/**
 * Radius of a corner's grab sphere, in metres, so it matches the drawn dot at
 * every zoom.
 *
 * A fixed metric radius is wrong in both directions and visibly so: zoomed out
 * it is a sub-pixel target nobody can hit, and zoomed in it swallows the corner
 * next to it. The screen size of the dot is the promise the UI makes, so the
 * grab volume is derived from it.
 */
export function handleRadiusM(
  distanceToCornerM: number,
  viewportHeightPx: number,
  verticalFovRad: number,
  pixelDiameter: number = HANDLE_PIXEL_DIAMETER,
): number {
  if (!(distanceToCornerM > 0) || !(viewportHeightPx > 0) || !(verticalFovRad > 0)) {
    return HANDLE_MIN_RADIUS_M;
  }
  const metresPerPixel = (2 * distanceToCornerM * Math.tan(verticalFovRad / 2)) / viewportHeightPx;
  const r = (pixelDiameter / 2) * metresPerPixel;
  if (!Number.isFinite(r)) return HANDLE_MIN_RADIUS_M;
  return Math.max(HANDLE_MIN_RADIUS_M, Math.min(HANDLE_MAX_RADIUS_M, r));
}

// ─── Validation, in the face's own (u,v) where it is exact ────────────────────

/**
 * Smallest face a corner drag may leave behind, in square metres.
 *
 * A sliver is not a roof, and everything downstream that divides by an area —
 * the primary-plane pick, the usable-area estimate, per-square-metre costing —
 * degrades quietly rather than loudly when one arrives. Half a square metre is
 * comfortably below any real face and comfortably above zero.
 */
export const MIN_FACE_AREA_M2 = 0.5;

/** Below this, a drag has not moved the corner and must not become an edit. */
export const RING_MOVED_EPS_M = 0.01;

export interface VertexMoveLimits {
  minEdgeM?: number;
  minAreaM2?: number;
}

export type VertexMoveRefusal = 'SELF_INTERSECTING' | 'AREA_TOO_SMALL' | 'EDGE_UNRESOLVABLE' | 'RING_TOO_SHORT';

/**
 * 🚨 THE DISCRIMINANT IS A STRING, AND IT HAS TO BE — THIS REPO SETS
 * `"strict": false`.
 *
 * With `strictNullChecks` off, TypeScript does NOT narrow a union by a BOOLEAN
 * literal discriminant. Written as `{ ok: true; ... } | { ok: false; ... }`,
 * this type compiles, and then every `if (!res.ok) { res.message }` is a
 * compile ERROR because `res` was never narrowed — the checker still sees the
 * success arm. A STRING literal discriminant narrows correctly under the same
 * settings; that difference was measured against this project's own tsconfig,
 * not assumed.
 *
 * So the shape is not a style choice. A boolean here would push every caller
 * into casts, and a cast is exactly how a refusal gets read as a success.
 */
export type VertexMoveResolution =
  | { status: 'ok'; point: LocalPt; clamped: boolean; ring: LocalPt[] }
  | { status: 'refused'; refusal: VertexMoveRefusal; message: string };

/** Shoelace area of a ring in its own flat metre basis. */
export function ringAreaM2(ring: ReadonlyArray<LocalPt>): number {
  if (ring.length < 3) return 0;
  let acc = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    acc += (ring[j].e * ring[i].n) - (ring[i].e * ring[j].n);
  }
  return Math.abs(acc) / 2;
}

/**
 * Where the corner is actually allowed to go, given where the cursor is.
 *
 * 🚨 TWO DIFFERENT KINDS OF NO, AND THEY FEEL DIFFERENT ON PURPOSE.
 *
 * A minimum-edge violation CLAMPS: the corner keeps following the cursor along
 * the edge it is still free in and stops sliding along the one it is not. The
 * drag stays continuous, which is what direct manipulation means — a gesture
 * that goes dead when you approach a limit reads as a bug.
 *
 * A self-intersection or a collapsed area REFUSES: the corner holds at its last
 * valid position and the status line says why. There is no useful clamped
 * position near a bow-tie — the nearest legal point is on the far side of an
 * edge the user is dragging through — and committing one would produce a face
 * whose measured area and pitch are both wrong while it still looks like a
 * quadrilateral. That defect has already been paid for once, on footprints.
 *
 * Deliberately NOT `validateVertexMove` from `vertexHandlesMath`: that one
 * describes Block/Gable/Hip/Tree primitives, works in lat/lng, and has no
 * self-intersection test at all — which is the only check here that can prevent
 * a silently wrong permit.
 */
export function resolveVertexMove(
  ringUV: ReadonlyArray<LocalPt>,
  index: number,
  desired: LocalPt,
  limits: VertexMoveLimits = {},
): VertexMoveResolution {
  const n = ringUV.length;
  if (n < 3) {
    return { status: 'refused', refusal: 'RING_TOO_SHORT', message: 'A face needs at least three corners.' };
  }
  const minEdge = limits.minEdgeM ?? MIN_SECTION_EDGE_M;
  const minArea = limits.minAreaM2 ?? MIN_FACE_AREA_M2;

  const prev = ringUV[(index - 1 + n) % n];
  const next = ringUV[(index + 1) % n];
  const home = ringUV[index];

  // ── Clamp out of each neighbour's exclusion disc ──────────────────────────
  // Two discs can overlap, so pushing clear of one can push back into the
  // other. Alternate until both hold; four rounds is generous for two circles
  // and bounded so a pathological ring cannot spin the pointer handler.
  let pt: LocalPt = { e: desired.e, n: desired.n };
  let clamped = false;
  const pushOut = (p: LocalPt, anchor: LocalPt): LocalPt | null => {
    let de = p.e - anchor.e;
    let dn = p.n - anchor.n;
    let len = Math.hypot(de, dn);
    if (len >= minEdge) return p;
    if (len < 1e-9) {
      // Landed exactly on the neighbour: there is no direction to push along,
      // so fall back to the direction the corner started in.
      de = home.e - anchor.e;
      dn = home.n - anchor.n;
      len = Math.hypot(de, dn);
      if (len < 1e-9) return null;
    }
    clamped = true;
    return { e: anchor.e + (de / len) * minEdge, n: anchor.n + (dn / len) * minEdge };
  };

  for (let round = 0; round < 4; round++) {
    const a = pushOut(pt, prev);
    if (!a) {
      return {
        status: 'refused',
        refusal: 'EDGE_UNRESOLVABLE',
        message: 'That corner cannot sit on top of its neighbour.',
      };
    }
    const b = pushOut(a, next);
    if (!b) {
      return {
        status: 'refused',
        refusal: 'EDGE_UNRESOLVABLE',
        message: 'That corner cannot sit on top of its neighbour.',
      };
    }
    const settled = Math.hypot(b.e - pt.e, b.n - pt.n) < 1e-9;
    pt = b;
    if (settled) break;
  }
  // The loop above can exit on its round limit with one bound still violated;
  // the refusal below is what makes that case honest rather than silent.
  if (Math.hypot(pt.e - prev.e, pt.n - prev.n) < minEdge - 1e-6
   || Math.hypot(pt.e - next.e, pt.n - next.n) < minEdge - 1e-6) {
    return {
      status: 'refused',
      refusal: 'EDGE_UNRESOLVABLE',
      message: 'Those two corners are too close together to fit this one between them.',
    };
  }

  const candidate = ringUV.map((p, i) => (i === index ? pt : { e: p.e, n: p.n }));

  if (!ringIsSimple(candidate)) {
    return {
      status: 'refused',
      refusal: 'SELF_INTERSECTING',
      message: 'That would fold the face over itself.',
    };
  }
  if (ringAreaM2(candidate) < minArea) {
    return {
      status: 'refused',
      refusal: 'AREA_TOO_SMALL',
      message: 'That would collapse the face to almost no area.',
    };
  }

  return { status: 'ok', point: pt, clamped, ring: candidate };
}

// ─── The plan-view record ─────────────────────────────────────────────────────

/**
 * The plan-view `vertices` ring for a face whose ECEF ring just had ONE corner
 * moved — with every OTHER corner preserved byte-for-byte.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 THIS EXISTS BECAUSE `{ surfaceOffsetM: 0 }` IS NOT ENOUGH ON ITS OWN, AND
 * THE ARCHITECTURE DOC'S STEP 3 IS INCOMPLETE WITHOUT IT.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `ComputePlaneOptions.surfaceOffsetM` controls TWO things through one number:
 * how far the fit LIFTS its output along the normal, and how far
 * `buildRoofPlane3D` UN-LIFTS it again to take the plan record. Re-fitting an
 * already-lifted ring needs those to be different: lift 0 (or the roof
 * ratchets 12 cm per press) but un-lift by the full offset (or the plan record
 * is taken from lifted points).
 *
 * Passing 0 therefore fixes the ratchet and silently breaks the plan record. A
 * normal is not vertical, so the render lift has a horizontal component of
 * `offset*sin(tilt)` pointing down-slope — 5.4 cm at 6:12 — and `vertices` is
 * what the permit site plan and the CAD engine read. Taking it from lifted
 * points slides the WHOLE FACE down its own azimuth. On a gable, whose two
 * halves have opposite azimuths, the halves slide apart and the shared ridge
 * splits by twice that. Measured, in this codebase, on the permit plan.
 *
 * So a corner drag using `built.vertices` directly would move all four plan
 * corners by 5.4 cm — including the three the user did not touch. That is the
 * exact failure this gesture is supposed to be incapable of.
 *
 * 🚨 AND THE FACE'S OWN CONVENTION CANNOT BE ASSUMED. Two populations exist and
 * the record does not say which it is: a face built by `buildRoofPlane3D`
 * carries UN-LIFTED vertices, while Stitch writes its plan record back WITHOUT
 * un-lifting — deliberately, because un-lifting a stitched roof face-by-face
 * re-opens the ridge seam it just closed. Guessing wrong introduces the very
 * offset it was meant to remove.
 *
 * The way out is to not guess at all:
 *
 *   - every corner the user did not move keeps its stored lat/lng EXACTLY, so
 *     whatever convention the face used is preserved by construction and no
 *     detection can be wrong about it;
 *   - the one corner that moved is derived by measuring the face's own
 *     convention against its own record — the candidate lift whose un-lifted
 *     ECEF ring best reproduces the stored vertices wins.
 *
 * An in-plane move is a translation, so it commutes with the lift: the moved
 * corner's plan position is its neighbour-consistent un-lift of the new ECEF
 * point, with the same offset the rest of the ring already uses.
 */
export function movedPlanVertices(
  vertices0: ReadonlyArray<{ lat: number; lng: number }>,
  ring0: ReadonlyArray<Cart3>,
  newRing: ReadonlyArray<Cart3>,
  index: number,
  normal: Cart3,
): Array<{ lat: number; lng: number }> | null {
  if (vertices0.length !== ring0.length || ring0.length !== newRing.length) return null;
  if (index < 0 || index >= ring0.length) return null;

  const liftM = detectPlanLiftM(vertices0, ring0, normal);
  const unlifted = unliftAlongNormal([newRing[index]], normal, liftM)[0];
  const g = ecefToLatLng(unlifted);
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lng)) return null;

  return vertices0.map((v, i) => (i === index ? { lat: g.lat, lng: g.lng } : { lat: v.lat, lng: v.lng }));
}

/** Candidate lift conventions, in the order they are tried. */
const PLAN_LIFT_CANDIDATES_M = [SURFACE_OFFSET_M, 0];

/**
 * How far this face's stored plan record sits below its ECEF ring along the
 * normal — measured against the record itself rather than assumed.
 *
 * Returns whichever candidate reproduces the stored `vertices` most closely.
 * The two candidates are 5.4 cm apart in plan at 6:12 and 0 cm apart on a flat
 * roof, where they are genuinely interchangeable and either answer is right.
 */
export function detectPlanLiftM(
  vertices0: ReadonlyArray<{ lat: number; lng: number }>,
  ring0: ReadonlyArray<Cart3>,
  normal: Cart3,
): number {
  let bestLift = PLAN_LIFT_CANDIDATES_M[0];
  let bestErr = Infinity;
  for (const lift of PLAN_LIFT_CANDIDATES_M) {
    const unlifted = unliftAlongNormal(ring0, normal, lift);
    let worst = 0;
    for (let i = 0; i < unlifted.length; i++) {
      const g = ecefToLatLng(unlifted[i]);
      // Degrees are fine for a COMPARISON between two candidates at the same
      // point; nothing here is converted to metres or used as a distance.
      const d = Math.hypot(g.lat - vertices0[i].lat, g.lng - vertices0[i].lng);
      if (d > worst) worst = d;
    }
    if (worst < bestErr) { bestErr = worst; bestLift = lift; }
  }
  return bestLift;
}

/** Did the ring actually move? A no-op drag must not reach the undo stack. */
export function ringMoved(
  before: ReadonlyArray<Cart3>,
  after: ReadonlyArray<Cart3>,
  epsM: number = RING_MOVED_EPS_M,
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (mag3(sub3(after[i], before[i])) > epsM) return true;
  }
  return false;
}

// ─── Panel policy: CULL ───────────────────────────────────────────────────────

/**
 * How far past the outline a panel's centre may sit and still count as on the
 * face. 0.35 m is the tolerance `sectionEditing` chose and defended for the same
 * question, so a panel half over the eave is not treated as having fallen off.
 */
export const PANEL_ON_FACE_PAD_M = 0.35;

export interface PanelPoint { id: string; point: Cart3 }

export interface PanelCullResult {
  surviving: string[];
  culled: string[];
}

/**
 * Which panels are still on the face after the corner moved.
 *
 * 🚨 THIS IS A MEMBERSHIP TEST AND NOTHING ELSE — NO REPOSITIONING.
 *
 * `repositionPanelsForPlanes` must not be called here. It is a RIGID map
 * anchored on the ring centroid, which is exactly right when a whole section
 * translates or changes height and exactly wrong for a corner drag: moving one
 * corner moves the centroid, so every panel on the face would slide sideways by
 * that delta. Nobody asked for the array to move.
 *
 * Because the drag is constrained to the face's own plane, the plane did not
 * move, so a panel still inside the new ring is still exactly on the deck at its
 * old lat/lng/height with the correct mount stack. There is genuinely nothing to
 * reposition — which is what makes culling the cheap and honest policy rather
 * than the lazy one.
 *
 * 🚨 THE MOUNT STACK NEEDS NO CORRECTION, AND TRYING TO CORRECT IT ADDS ERROR.
 *
 * A panel floats above the deck along the face NORMAL. `(u, v, n)` is
 * orthonormal, so `dot(n*stack, u)` and `dot(n*stack, v)` are both ZERO: the
 * stack is invisible to this test by construction, at any pitch and any stack
 * height. The first version of this function "corrected" for it by dropping
 * each panel vertically onto the plane first — and local up is NOT the face
 * normal, so that drop has its own in-plane component and displaced the test
 * point by stack*tan(tilt), about 7.5 cm at 6:12. It introduced precisely the
 * pitch-dependent error it was written to remove, small enough to hide inside
 * the pad. The right amount of correction is none.
 *
 * A re-layout is also excluded, and not for cost: it is a BIGGER edit than the
 * one the user performed. A 20 cm corner nudge must not re-shuffle an array
 * somebody spent ten minutes positioning by hand.
 */
export function classifyPanelsAgainstRing(
  panels: ReadonlyArray<PanelPoint>,
  ringUV: ReadonlyArray<LocalPt>,
  basis: FaceBasis,
  padM: number = PANEL_ON_FACE_PAD_M,
): PanelCullResult {
  const ring2D: Array<[number, number]> = ringUV.map(p => [p.e, p.n]);
  const surviving: string[] = [];
  const culled: string[] = [];
  for (const p of panels) {
    const at = projectIntoFace(p.point, basis);
    if (pointInRing2D(at.u, at.v, ring2D, padM)) surviving.push(p.id);
    else culled.push(p.id);
  }
  return { surviving, culled };
}
