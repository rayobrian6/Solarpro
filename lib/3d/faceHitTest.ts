/**
 * lib/3d/faceHitTest.ts
 *
 * WHICH ROOF FACE IS UNDER THE CURSOR — resolved against the canonical geometry,
 * never against a renderer object.
 *
 * ─── WHY THIS IS NOT A CLICK HANDLER ─────────────────────────────────────────
 *
 * SolarPro 3D could already DRAW individual roof faces and could not SELECT
 * them, and the reason was an identity break, not a missing listener:
 *
 *   • A face marked but not yet panelled renders through the `outlineOnly`
 *     branch of `renderPlane3DEntity`, which adds ONE polyline and returns.
 *     There is no polygon. A 2 px polyline is not a pickable surface, so there
 *     was physically nothing under the cursor to hit.
 *   • Every `[PLANE3D-*]` entity carries its plane id only inside its `name`
 *     string; `entity.id` is a Cesium GUID. No pick path in the repo parses
 *     those names — the one face pick that exists matches `[BUILD3D-ROOF]`, a
 *     different entity family produced only when the Building extrusion is on,
 *     which is off by default.
 *   • `onRoofPlaneSelect` / `selectedRoofPlaneId` were declared on the engine,
 *     destructured, and never called or passed. Every selection comparison was
 *     `undefined === <id>`.
 *
 * Adding a listener on top of that would have hit nothing. So the face is
 * resolved geometrically instead: intersect the camera ray with each face's own
 * plane and test containment inside the polygon that was actually drawn for it.
 *
 * ─── WHAT THIS BUYS, BEYOND WORKING ──────────────────────────────────────────
 *
 *   • NOTHING IS ADDED TO THE SCENE. No invisible pick body, no polygon with an
 *     alpha of zero. That matters more than it looks: `getWorldPosition` — the
 *     function the whole roof-plane DRAWING workflow depends on — begins with
 *     `scene.pick()` and then reads `scene.pickPosition()`, so a new translucent
 *     surface over the roof could have changed where a traced corner lands.
 *     A pure ray test cannot perturb any existing pick.
 *   • PROVIDER-NEUTRAL. It consumes `{ normal, polygon }`, which both geometry
 *     providers already produce: a Google/Solar-API face and a hand-modelled
 *     face both resolve through `resolvePlaneGeometry` and both end up in the
 *     same rendered-points map. Neither provider has to impersonate the other.
 *   • WHAT YOU SEE IS WHAT YOU HIT. The caller passes the SAME projected polygon
 *     the renderer drew, so selection cannot drift from the picture.
 *   • CAMERA-INDEPENDENT. The test is entirely in world space. Orbiting or
 *     zooming changes the ray, not which face contains its intersection.
 */

export interface Vec3 { x: number; y: number; z: number }

/** A roof face offered to the interaction layer. This is the SolarPro 3D
 *  "selectable roof face" contract: any geometry provider that can produce a
 *  canonical id, an outward normal and the polygon it drew can be selected,
 *  without exposing anything else about how it was built. */
export interface SelectableFace {
  /** The canonical roof-face id — `RoofPlane.id`. NOT an array index, not a
   *  label, not a renderer handle. It is the id that survives editing, Square
   *  Up, Stitch, save, restore and rebuild. */
  faceId: string;
  /** Outward unit normal in ECEF. May be omitted or degenerate; a Newell normal
   *  is computed from the polygon in that case. */
  normal?: Vec3 | null;
  /** The polygon this face was DRAWN with, in order, in ECEF. Its first vertex
   *  is taken as the point on the plane, so the hit test is against the drawn
   *  surface rather than against a frame origin that may carry a render lift. */
  polygon: Vec3[];
}

export interface PickRay {
  /** Ray start in ECEF — for Cesium, `camera.getPickRay(pos).origin`. */
  origin: Vec3;
  /** Ray direction in ECEF. Need not be normalised. */
  direction: Vec3;
}

export interface FaceHit {
  faceId: string;
  /** Metres from the ray origin to the intersection. */
  distanceM: number;
  /** The intersection point in ECEF. */
  point: Vec3;
}

/** A ray is treated as parallel to a plane below this |cos| — at which point the
 *  intersection is numerically meaningless rather than merely distant. */
const PARALLEL_EPS = 1e-9;

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function len(a: Vec3): number { return Math.sqrt(dot(a, a)); }
function normalise(a: Vec3): Vec3 | null {
  const m = len(a);
  if (!Number.isFinite(m) || m < 1e-12) return null;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
}
function finiteVec(v: Vec3 | null | undefined): v is Vec3 {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Newell's method — an area-weighted normal that is well conditioned for any
 * planar polygon, including ones with a near-collinear edge that would wreck a
 * three-point cross product.
 */
export function newellNormal(polygon: readonly Vec3[]): Vec3 | null {
  if (!polygon || polygon.length < 3) return null;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (!finiteVec(a) || !finiteVec(b)) return null;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return normalise({ x: nx, y: ny, z: nz });
}

/** The normal this face will actually be tested against: its own if usable,
 *  otherwise one derived from the polygon it drew. Never invented. */
function planeNormalFor(face: SelectableFace): Vec3 | null {
  const given = finiteVec(face.normal) ? normalise(face.normal as Vec3) : null;
  return given ?? newellNormal(face.polygon);
}

/**
 * Is `p` inside the polygon? Answered in a 2-D basis built ON the plane, so the
 * test is independent of how the polygon is oriented in ECEF — projecting onto
 * a fixed world axis instead would collapse a near-vertical face to a line.
 *
 * Crossing-number rule. A point exactly on an edge — which is what a click on a
 * shared ridge is — resolves deterministically for a given polygon, and the
 * caller breaks the remaining tie by distance, so a ridge click always produces
 * the same face for the same camera.
 */
export function pointInPolygon3D(p: Vec3, polygon: readonly Vec3[], normal: Vec3): boolean {
  if (!polygon || polygon.length < 3) return false;
  // Build an orthonormal in-plane basis. Pick the world axis least aligned with
  // the normal so the cross product is well conditioned.
  const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
  const seed: Vec3 = (ax <= ay && ax <= az) ? { x: 1, y: 0, z: 0 }
                   : (ay <= az)             ? { x: 0, y: 1, z: 0 }
                                            : { x: 0, y: 0, z: 1 };
  const u = normalise(cross(normal, seed));
  if (!u) return false;
  const v = cross(normal, u);   // already unit: |normal| = |u| = 1 and they are orthogonal

  const o = polygon[0];
  const px = dot(sub(p, o), u);
  const py = dot(sub(p, o), v);

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const qi = polygon[i], qj = polygon[j];
    const xi = dot(sub(qi, o), u), yi = dot(sub(qi, o), v);
    const xj = dot(sub(qj, o), u), yj = dot(sub(qj, o), v);
    const straddles = (yi > py) !== (yj > py);
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Every face the ray passes through, nearest first.
 *
 * Faces BEHIND the ray origin are excluded (t <= 0) — a roof behind the camera
 * is not under the cursor. Faces whose plane the ray is parallel to are excluded
 * as numerically meaningless, not as "miss".
 */
export function pickFaces(ray: PickRay, faces: readonly SelectableFace[]): FaceHit[] {
  const dir = finiteVec(ray?.direction) ? normalise(ray.direction) : null;
  if (!dir || !finiteVec(ray?.origin)) return [];

  const hits: FaceHit[] = [];
  for (const face of faces ?? []) {
    if (!face || !face.faceId || !face.polygon || face.polygon.length < 3) continue;
    const n = planeNormalFor(face);
    if (!n) continue;
    const p0 = face.polygon[0];
    if (!finiteVec(p0)) continue;

    const denom = dot(n, dir);
    if (Math.abs(denom) < PARALLEL_EPS) continue;          // parallel to the face
    const t = dot(n, sub(p0, ray.origin)) / denom;
    if (!Number.isFinite(t) || t <= 0) continue;           // behind the camera

    const point: Vec3 = {
      x: ray.origin.x + dir.x * t,
      y: ray.origin.y + dir.y * t,
      z: ray.origin.z + dir.z * t,
    };
    if (!pointInPolygon3D(point, face.polygon, n)) continue;
    hits.push({ faceId: face.faceId, distanceM: t, point });
  }
  // Nearest first. Ties — coincident faces — break on faceId so the answer is
  // the same on every frame and every machine rather than depending on Map
  // iteration order.
  hits.sort((a, b) => (a.distanceM - b.distanceM) || (a.faceId < b.faceId ? -1 : a.faceId > b.faceId ? 1 : 0));
  return hits;
}

/** The face under the cursor, or null. Nearest to the camera wins. */
export function pickFace(ray: PickRay, faces: readonly SelectableFace[]): FaceHit | null {
  const hits = pickFaces(ray, faces);
  return hits.length > 0 ? hits[0] : null;
}
