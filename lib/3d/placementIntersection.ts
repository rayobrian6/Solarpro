/**
 * lib/3d/placementIntersection.ts
 *
 * WHERE DID THE USER POINT? — one answer, computed from geometry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIVE FAILURE THIS EXISTS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "Tree -> click ground -> NO TREE APPEARS."
 *   "I also attempted to place a Chimney. It appears that Chimney may also not
 *    be wired end-to-end."
 *
 * Both are one defect, and it is not in Tree or in Chimney. `handleObstruction-
 * Click` resolved the click with a bare `viewer.scene.pickPosition(screenPos)`.
 * That reads the DEPTH BUFFER, so it answers only where something was already
 * drawn and only when the depth texture is available. The engine hides the globe
 * as soon as a tileset object exists, and Google's root tileset resolves for any
 * valid key whether or not the address has coverage — so at exactly the
 * properties the custom pipeline was built for there is nothing in the depth
 * buffer, `pickPosition` returns undefined, and the handler returns having built
 * nothing. A click that succeeded and a click that failed looked identical.
 *
 * 🚨 THE SAME BARE CALL WAS IN FIVE HANDLERS: obstruction, add-row, extend-row,
 * snap-panel and surface-select. So "Tree does not work" and "Add Row does not
 * work on a custom-built house" were never two bugs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 🚨 A PHYSICAL PLACEMENT POINT MUST NOT REQUIRE A RENDERED, SELECTABLE ENTITY.
 *
 * The design already knows where its roof faces are: every face carries an
 * origin, an in-plane frame and a corner ring in ECEF. Intersecting the camera's
 * pick ray with that canonical geometry answers "which face, and where on it"
 * with no renderer, no depth texture, no tileset and no GPU pick — which is why
 * this module takes plain numbers and is tested without Cesium.
 *
 * Cesium adapts INTO this. This never imports Cesium.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A canonical planar face: its own frame plus the ring that bounds it. */
export interface PlanarFace {
  id: string;
  /** A point on the plane, and the origin of the (u,v) frame. */
  origin: Vec3;
  /** Unit in-plane axis. */
  u: Vec3;
  /** Unit in-plane axis, perpendicular to u. */
  v: Vec3;
  /** Unit normal. */
  n: Vec3;
  /** The bounding ring, in world coordinates, at least 3 points. */
  corners: Vec3[];
}

export interface FaceHit {
  faceId: string;
  /** The intersection, in world coordinates. */
  point: Vec3;
  /** Distance from the ray origin, in the ray's units (metres, for ECEF). */
  distanceAlongRay: number;
  /** The intersection in the face's own frame. */
  u: number;
  v: number;
}

export interface RayFaceOptions {
  /**
   * Outward tolerance on the ring test, in metres. A click a few centimetres
   * past an eave is a click on the roof as far as the person is concerned.
   * Kept small: a large pad lets a face claim a point over open ground.
   */
  padM?: number;
  /**
   * Faces nearer than this along the ray are ignored. Guards against a face
   * behind the near plane, and against the degenerate t = 0 self-hit when the
   * ray origin is already on the plane.
   */
  minDistanceM?: number;
}

/**
 * Below this, the ray is parallel to the plane within floating-point noise and
 * there is no well-conditioned intersection. sin(0.057°) — a ray this close to
 * parallel produces a hit point kilometres away from any reasonable answer.
 */
const PARALLEL_EPS = 1e-6;

const DEFAULT_MIN_DISTANCE_M = 0.01;

// ── vector helpers ──────────────────────────────────────────────────────────
// Local, so this module depends on nothing. They take the interface, not a class.

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export function normalize(a: Vec3): Vec3 | null {
  const m = length(a);
  if (!isFinite(m) || m < 1e-12) return null;
  return { x: a.x / m, y: a.y / m, z: a.z / m };
}

const finiteVec = (a: unknown): a is Vec3 => {
  if (!a || typeof a !== 'object') return false;
  const v = a as Vec3;
  return isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
};

/**
 * Crossing-number point-in-polygon, on a 2D ring.
 *
 * `padM` grows the test outward by treating a point within `padM` of any edge
 * as inside. That is done as a distance to the segment rather than by offsetting
 * the ring, because offsetting a non-convex ring is not a local operation and
 * would fold at reflex corners — a dormer notch would swallow points outside it.
 */
export function pointInRing2D(
  pu: number,
  pv: number,
  ring: Array<[number, number]>,
  padM = 0,
): boolean {
  if (!ring || ring.length < 3) return false;
  if (!isFinite(pu) || !isFinite(pv)) return false;

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (((yi > pv) !== (yj > pv)) && (pu < ((xj - xi) * (pv - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  if (inside) return true;
  if (padM <= 0) return false;

  // Outside the ring, but possibly within the pad of an edge.
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (distanceToSegment2D(pu, pv, ring[j], ring[i]) <= padM) return true;
  }
  return false;
}

function distanceToSegment2D(
  px: number,
  py: number,
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** The face's corner ring expressed in its own (u,v) frame. */
export function ringInFaceFrame(face: PlanarFace): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of face.corners ?? []) {
    if (!finiteVec(c)) continue;
    const rel = sub(c, face.origin);
    out.push([dot(rel, face.u), dot(rel, face.v)]);
  }
  return out;
}

/**
 * Intersect a ray with ONE face's infinite plane, then test the hit against the
 * face's ring. Returns null when the ray misses, is parallel, or hits behind the
 * viewer.
 *
 * 🚨 THIS NEEDS NOTHING DRAWN. It is the whole point: it reads the design's own
 * geometry, so it answers identically whether the face is rendered, occluded,
 * off-screen behind another entity, or on a machine whose driver has no depth
 * texture at all.
 */
export function intersectRayWithFace(
  rayOrigin: Vec3,
  rayDirection: Vec3,
  face: PlanarFace,
  opts: RayFaceOptions = {},
): FaceHit | null {
  if (!finiteVec(rayOrigin) || !finiteVec(rayDirection)) return null;
  if (!face || !finiteVec(face.origin) || !finiteVec(face.n)) return null;
  if (!finiteVec(face.u) || !finiteVec(face.v)) return null;
  if (!face.corners || face.corners.length < 3) return null;

  const dir = normalize(rayDirection);
  const n = normalize(face.n);
  if (!dir || !n) return null;

  const denom = dot(dir, n);
  if (Math.abs(denom) < PARALLEL_EPS) return null;

  const t = dot(sub(face.origin, rayOrigin), n) / denom;
  const minT = opts.minDistanceM ?? DEFAULT_MIN_DISTANCE_M;
  if (!isFinite(t) || t < minT) return null;

  const point = add(rayOrigin, scale(dir, t));
  const rel = sub(point, face.origin);
  const pu = dot(rel, face.u);
  const pv = dot(rel, face.v);

  const ring = ringInFaceFrame(face);
  if (!pointInRing2D(pu, pv, ring, opts.padM ?? 0)) return null;

  return { faceId: face.id, point, distanceAlongRay: t, u: pu, v: pv };
}

/**
 * The face the user actually pointed at: the NEAREST one along the ray whose
 * ring contains the hit.
 *
 * 🚨 NEAREST, NOT FIRST. Iteration order is the order faces happen to sit in an
 * array. On a hip roof the ray crosses the plane of the far slope as well as the
 * near one, and on a two-storey house it crosses the garage deck below the main
 * roof. Taking the first match put the chimney on whichever face was added
 * first — which is also the bug that binds an obstruction to the SELECTED face
 * instead of the clicked one, wearing different clothes.
 */
export function nearestFaceAlongRay(
  rayOrigin: Vec3,
  rayDirection: Vec3,
  faces: PlanarFace[],
  opts: RayFaceOptions = {},
): FaceHit | null {
  // 🚨 A TRUE HIT BEATS A PADDED ONE, WHATEVER THE DISTANCES.
  //
  // With one padded pass, a face could win a click on its NEIGHBOUR. The pad is
  // measured in the face's own plane, so on a gable at the engine's default -45°
  // camera a ray crossing the ridge is already ~0.25 m past it while still 0.6 m
  // down the far slope: the near face's PADDED hit came out closer than the far
  // face's TRUE hit, so the near face won a click the user could plainly see
  // belonged to the other one, and the object was built in mid-air above the
  // ridge.
  //
  // The pad exists for an eave with nothing beyond it. It must never outrank a
  // face the ray genuinely entered, so the two are tracked separately and the
  // padded answer is used only when there is no true one.
  const pad = opts.padM ?? 0;
  let bestTrue: FaceHit | null = null;
  let bestPadded: FaceHit | null = null;

  for (const face of faces ?? []) {
    const exact = intersectRayWithFace(rayOrigin, rayDirection, face, { ...opts, padM: 0 });
    if (exact) {
      if (!bestTrue || exact.distanceAlongRay < bestTrue.distanceAlongRay) bestTrue = exact;
      continue;
    }
    if (pad <= 0) continue;
    const padded = intersectRayWithFace(rayOrigin, rayDirection, face, opts);
    if (!padded) continue;
    if (!bestPadded || padded.distanceAlongRay < bestPadded.distanceAlongRay) bestPadded = padded;
  }

  return bestTrue ?? bestPadded;
}

/**
 * Project an arbitrary world point onto a face's plane. Used when the point came
 * from somewhere other than this module (a depth-buffer pick that DID work) and
 * has to be reconciled with the canonical surface before anything is built on it.
 */
export function projectPointOntoFace(point: Vec3, face: PlanarFace): Vec3 | null {
  if (!finiteVec(point) || !face || !finiteVec(face.origin)) return null;
  const n = normalize(face.n);
  if (!n) return null;
  const d = dot(sub(point, face.origin), n);
  if (!isFinite(d)) return null;
  return sub(point, scale(n, d));
}

/** Signed distance from a point to a face's plane, along the face normal. */
export function signedDistanceToFace(point: Vec3, face: PlanarFace): number {
  if (!finiteVec(point) || !face || !finiteVec(face.origin)) return NaN;
  const n = normalize(face.n);
  if (!n) return NaN;
  return dot(sub(point, face.origin), n);
}

/**
 * Where a ray meets a sphere of radius `radius` about the earth's centre —
 * i.e. a horizontal surface at a known elevation, with the earth's curvature
 * kept rather than assumed away.
 *
 * 🚨 A TREE STANDS ON THE GROUND. This is how a site object gets a placement
 * point when nothing at all is rendered: the ground is not an entity, it is a
 * known elevation, and a known elevation is a surface a ray can be intersected
 * with. Returns the NEAR intersection, which is the one the camera can see.
 *
 * `radius` must be the GEOCENTRIC radius of the ground beneath the camera, not a
 * mean earth radius. The ellipsoid's polar and equatorial radii differ by 21 km,
 * so at 38.7° N a sphere of mean radius sits about 1.4 km ABOVE the real ground
 * — which would put the camera inside it on every call.
 */
export function intersectRayWithGeocentricSphere(
  rayOrigin: Vec3,
  rayDirection: Vec3,
  radius: number,
): Vec3 | null {
  if (!finiteVec(rayOrigin) || !finiteVec(rayDirection)) return null;
  if (!isFinite(radius) || radius <= 0) return null;
  const dir = normalize(rayDirection);
  if (!dir) return null;

  // 🚨 ONLY THE NEAR ROOT. A CAMERA INSIDE THE SPHERE HAS NO PLACEMENT POINT.
  //
  // A ray meets a sphere twice. When the origin is outside, the near root is the
  // visible surface. When it is INSIDE, the near root is behind the camera and
  // the far root is the shell's inside face — on the other side of the planet.
  // A first version returned a point 12,744 km away and a tree would have been
  // planted there.
  //
  // 🚨 AND THE FIRST GUARD AGAINST IT WAS STILL WRONG. It allowed the far root
  // whenever the camera was within 1 m inside the sphere, meaning to be generous
  // about a stale ground elevation — but the far root for a camera 0.5 m under
  // the surface is the ANTIPODE, which is the exact failure the guard was written
  // to prevent, merely harder to reach. An adversary found it; my own test had
  // asserted only that the result lay ON the sphere, which the antipode does.
  //
  // There is no tolerance that makes the far root correct, because the far root
  // is never what the user pointed at. So the near root is the only answer, and
  // a camera at or below the ground datum gets null and an honest failure
  // message. That case means the datum is wrong, and guessing cannot fix it.
  const b = 2 * dot(rayOrigin, dir);
  const c = dot(rayOrigin, rayOrigin) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / 2;
  if (!isFinite(t) || t < DEFAULT_MIN_DISTANCE_M) return null;

  return add(rayOrigin, scale(dir, t));
}
