/**
 * lib/3d/buildingExtrusion.ts
 *
 * Turn a set of roof faces into a solid building: walls dropped from every
 * exterior roof edge down to the ground.
 *
 * WHY
 * ---
 * A traced roof renders as wireframe on top of grainy satellite imagery. It
 * reads as annotation, not as a building. Aurora shows white extruded walls
 * under a solid roof, and that single difference is most of why their model
 * "pops". This module produces the wall geometry; the caller renders it.
 *
 * WHICH EDGES GET A WALL
 * ----------------------
 * Only EXTERIOR edges. An edge that two faces share is interior — a ridge, a
 * hip or a valley — and a wall there would slice straight through the middle
 * of the house.
 *
 * Sharing is detected GEOMETRICALLY (same two endpoints within a tolerance,
 * in either direction) rather than by reading `edgeTypes`. That matters:
 *   • it works on faces that were never classified, including hand-traced ones
 *     whose edgeTypes nothing currently populates,
 *   • it cannot disagree with the geometry the way a stale label can, and
 *   • hips and valleys fall out for free, with no extra cases.
 * The cost is O(E²) across all edges, which is nothing at house scale (a
 * complex roof is a few dozen edges).
 *
 * WINDING — 🚨 THE BOWTIE TRAP
 * ----------------------------
 * A wall quad is [topA, topB, bottomB, bottomA]. Going around the perimeter,
 * not across it. The intuitive-but-wrong [topA, topB, bottomA, bottomB] makes
 * the edges topB→bottomA and bottomB→topA cross in the middle, and the polygon
 * renders as a self-intersecting bowtie — the exact defect already sitting in
 * this repo's gable and hip face construction. There is a test for it.
 */

import { ecefToLatLng, latLngToECEF, type Cart3 } from '@/lib/roofPlane3D';

/** A roof face to extrude. `polygon3D` is its outline in ECEF, at true height. */
export interface ExtrusionFace {
  id: string;
  polygon3D: Cart3[];
}

/** One vertical wall panel, ready to render as a Cesium polygon. */
export interface WallQuad {
  /** The face this wall hangs from. */
  faceId: string;
  /** Index of the source edge within that face's polygon. */
  edgeIndex: number;
  /** Four ECEF corners, wound around the perimeter: topA, topB, bottomB, bottomA. */
  corners: Cart3[];
  /** Height of the taller top corner above ground, metres. For colouring/labels. */
  maxHeightM: number;
}

export interface BuildWallsOptions {
  /**
   * Two endpoints within this distance are "the same point", so an edge shared
   * by two faces is recognised as interior. Default 0.35 m.
   *
   * Sized for HAND-TRACED roofs: two faces traced separately meet at a ridge
   * the user clicked twice, and those clicks will not coincide exactly. Too
   * tight and the shared ridge is missed, putting a wall through the house;
   * too loose and a genuinely short exterior edge is swallowed. 0.35 m is well
   * under the shortest real roof edge and well over normal click scatter.
   */
  sharedEdgeToleranceM?: number;
  /**
   * Skip walls shorter than this, in metres. Sub-centimetre slivers from
   * near-duplicate vertices would render as z-fighting shards. Default 0.05 m.
   */
  minWallLengthM?: number;
}

const DEFAULT_TOLERANCE_M = 0.35;
const DEFAULT_MIN_WALL_M = 0.05;

function dist3(a: Cart3, b: Cart3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * True when two edges connect the same pair of points, in either direction.
 * Direction-agnostic because adjacent faces wind in opposite senses along
 * their shared edge.
 */
function sameEdge(a0: Cart3, a1: Cart3, b0: Cart3, b1: Cart3, tolM: number): boolean {
  const forward = dist3(a0, b0) <= tolM && dist3(a1, b1) <= tolM;
  const reverse = dist3(a0, b1) <= tolM && dist3(a1, b0) <= tolM;
  return forward || reverse;
}

/**
 * Ground distance between two ECEF points, ignoring height.
 *
 * Used for matching a shared ridge while the faces either side of it may still
 * be at different (wrong) heights — see deriveAzimuthsFromSharedEdges.
 */
function horizontalDist(a: Cart3, b: Cart3): number {
  const ga = ecefToLatLng(a), gb = ecefToLatLng(b);
  const mLat = 111320;
  const mLng = mLat * Math.cos(((ga.lat + gb.lat) / 2) * Math.PI / 180);
  const dN = (ga.lat - gb.lat) * mLat;
  const dE = (ga.lng - gb.lng) * mLng;
  return Math.hypot(dN, dE);
}

/** Direction-agnostic edge match in PLAN VIEW. */
function sameEdgeHorizontal(a0: Cart3, a1: Cart3, b0: Cart3, b1: Cart3, tolM: number): boolean {
  const forward = horizontalDist(a0, b0) <= tolM && horizontalDist(a1, b1) <= tolM;
  const reverse = horizontalDist(a0, b1) <= tolM && horizontalDist(a1, b0) <= tolM;
  return forward || reverse;
}

/** Project an ECEF point straight down to `groundElevM` above the ellipsoid. */
function dropToGround(p: Cart3, groundElevM: number): Cart3 {
  const g = ecefToLatLng(p);
  return latLngToECEF(g.lat, g.lng, groundElevM);
}

/**
 * Build the wall panels for a building described by its roof faces.
 *
 * Returns an empty array rather than throwing for degenerate input — a caller
 * rendering a scene should not blow up because one face was malformed.
 */
export function buildWalls(
  faces: readonly ExtrusionFace[],
  groundElevM: number,
  options: BuildWallsOptions = {},
): WallQuad[] {
  const tolM = options.sharedEdgeToleranceM ?? DEFAULT_TOLERANCE_M;
  const minLenM = options.minWallLengthM ?? DEFAULT_MIN_WALL_M;
  if (!faces || faces.length === 0 || !isFinite(groundElevM)) return [];

  // Flatten every edge once so interior detection is a single pass.
  type Edge = { faceId: string; edgeIndex: number; a: Cart3; b: Cart3 };
  const edges: Edge[] = [];
  for (const f of faces) {
    const poly = f?.polygon3D;
    if (!poly || poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      if (![a.x, a.y, a.z, b.x, b.y, b.z].every(isFinite)) continue;
      edges.push({ faceId: f.id, edgeIndex: i, a, b });
    }
  }

  const walls: WallQuad[] = [];
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (dist3(e.a, e.b) < minLenM) continue;

    // Interior if ANY edge on a DIFFERENT face matches it. Same-face matches are
    // ignored so a face that doubles back on itself does not delete its own wall.
    let interior = false;
    for (let j = 0; j < edges.length; j++) {
      if (j === i) continue;
      const o = edges[j];
      if (o.faceId === e.faceId) continue;
      if (sameEdge(e.a, e.b, o.a, o.b, tolM)) { interior = true; break; }
    }
    if (interior) continue;

    const bottomA = dropToGround(e.a, groundElevM);
    const bottomB = dropToGround(e.b, groundElevM);

    const hA = ecefToLatLng(e.a).height - groundElevM;
    const hB = ecefToLatLng(e.b).height - groundElevM;
    // A roof edge already at or below ground has no wall to draw.
    if (hA <= minLenM && hB <= minLenM) continue;

    walls.push({
      faceId: e.faceId,
      edgeIndex: e.edgeIndex,
      // 🚨 Perimeter order. See the winding note in the file header.
      corners: [e.a, e.b, bottomB, bottomA],
      maxHeightM: Math.max(hA, hB),
    });
  }

  return walls;
}

/**
 * Derive each face's DOWNSLOPE AZIMUTH from the ridge it shares with a neighbour.
 *
 * 🚨 WHY NOT deriveAzimuthFromOutline PER FACE
 * --------------------------------------------
 * That helper takes a face's own longest edge as the ridge, goes perpendicular,
 * and picks the equator-facing side. Run independently on the two halves of a
 * gable — two wide rectangles either side of a shared ridge — it returns SOUTH
 * for BOTH. The roof comes out as two faces sloping the same way instead of a
 * gable, which is exactly what Ray saw: "they are recognizing the same plane."
 *
 * The information needed was never in a single face. It is in the RELATIONSHIP:
 * two faces that share an edge slope AWAY from each other across it. So the
 * downslope direction is the horizontal vector from the shared edge toward the
 * face's own centroid, perpendicular to that edge. No guessing, no hemisphere
 * heuristic, and it generalises: a hip face has a ridge and two hip edges, and
 * the perpendicular-from-ridge still points down the slope correctly.
 *
 * A face with no shared edge (a lone shed roof, the first face of a trace) has
 * no ridge to reason from, so it falls back to the caller's estimate.
 *
 * @param faces    Roof faces with their plan-view outlines.
 * @param fallback Azimuth to use for a face that shares no edge, per face id.
 */
export function deriveAzimuthsFromSharedEdges(
  faces: readonly ExtrusionFace[],
  fallback: (faceId: string) => number,
  options: BuildWallsOptions = {},
): Map<string, number> {
  const tolM = options.sharedEdgeToleranceM ?? DEFAULT_TOLERANCE_M;
  const out = new Map<string, number>();
  if (!faces || faces.length === 0) return out;

  // Collect every edge with its owning face.
  type Edge = { faceId: string; a: Cart3; b: Cart3 };
  const edges: Edge[] = [];
  for (const f of faces) {
    const poly = f?.polygon3D;
    if (!poly || poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (!a || !b) continue;
      if (![a.x, a.y, a.z, b.x, b.y, b.z].every(isFinite)) continue;
      edges.push({ faceId: f.id, a, b });
    }
  }

  for (const f of faces) {
    const poly = f?.polygon3D;
    if (!poly || poly.length < 3) { out.set(f.id, fallback(f.id)); continue; }

    // Centroid of this face.
    let cx = 0, cy = 0, cz = 0;
    for (const p of poly) { cx += p.x; cy += p.y; cz += p.z; }
    cx /= poly.length; cy /= poly.length; cz /= poly.length;

    // Water runs toward the EAVE, and the eave is the face's longest UNSHARED
    // edge. Shared edges are interior — ridges, hips, valleys — so whatever is
    // left on the outside and longest is what the slope runs down to.
    //
    // 🚨 Stated as "toward the eave", NOT "away from the ridge". They are the
    // same thing on a gable half, which has one shared edge, and the ridge form
    // is the obvious one to reach for. It is WRONG on a hip: a pyramid hip face
    // shares TWO edges (its hip rafters), so "away from the longest shared edge"
    // picks a rafter and points the slope sideways along the roof. The eave
    // formulation is the dual and handles gable, hip, dormer and shed alike.
    //
    // 🚨 MATCHED IN PLAN VIEW, NOT IN 3D. The whole point of this function is to
    // fix faces whose pitch is currently WRONG — and while it is wrong, the two
    // halves carry their shared ridge at different heights (metres apart on a
    // 30° roof). A 3D comparison would find no shared edge at exactly the moment
    // we need one, fall back, and leave both halves sloping the same way. Edges
    // are shared on the ground whatever heights the faces happen to have.
    let eave: { a: Cart3; b: Cart3; len: number } | null = null;
    for (const e of edges) {
      if (e.faceId !== f.id) continue;
      let shared = false;
      for (const o of edges) {
        if (o.faceId === f.id) continue;
        if (sameEdgeHorizontal(e.a, e.b, o.a, o.b, tolM)) { shared = true; break; }
      }
      if (shared) continue;
      const len = horizontalDist(e.a, e.b);
      if (!eave || len > eave.len) eave = { a: e.a, b: e.b, len };
    }

    // A face with NO shared edge has nothing to reason from — its longest edge
    // is as likely to be a rake as an eave — so defer to the caller's estimate.
    const hasShared = edges.some(e => e.faceId === f.id && edges.some(o =>
      o.faceId !== f.id && sameEdgeHorizontal(e.a, e.b, o.a, o.b, tolM)));
    if (!eave || !hasShared) { out.set(f.id, fallback(f.id)); continue; }

    // Local ENU at the eave midpoint.
    const mid = { x: (eave.a.x + eave.b.x) / 2, y: (eave.a.y + eave.b.y) / 2, z: (eave.a.z + eave.b.z) / 2 };
    const geo = ecefToLatLng(mid);
    const latR = geo.lat * Math.PI / 180, lngR = geo.lng * Math.PI / 180;
    const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
    const sinLng = Math.sin(lngR), cosLng = Math.cos(lngR);
    const east  = { x: -sinLng,          y: cosLng,           z: 0      };
    const north = { x: -sinLat * cosLng, y: -sinLat * sinLng, z: cosLat };

    const toEnu = (v: Cart3) => ({
      e: v.x * east.x + v.y * east.y + v.z * east.z,
      n: v.x * north.x + v.y * north.y + v.z * north.z,
    });

    // Eave direction, horizontal.
    const r = toEnu({ x: eave.b.x - eave.a.x, y: eave.b.y - eave.a.y, z: eave.b.z - eave.a.z });
    const rMag = Math.hypot(r.e, r.n);
    if (!(rMag > 1e-9)) { out.set(f.id, fallback(f.id)); continue; }
    const re = r.e / rMag, rn = r.n / rMag;

    // Face centroid -> eave midpoint, with the along-eave component removed.
    // That perpendicular remainder is the downslope direction.
    const c = toEnu({ x: mid.x - cx, y: mid.y - cy, z: mid.z - cz });
    const along = c.e * re + c.n * rn;
    const de = c.e - along * re;
    const dn = c.n - along * rn;
    const dMag = Math.hypot(de, dn);
    if (!(dMag > 1e-6)) { out.set(f.id, fallback(f.id)); continue; }

    out.set(f.id, ((Math.atan2(de / dMag, dn / dMag) * 180 / Math.PI) % 360 + 360) % 360);
  }

  return out;
}

/**
 * The orientation of a face, derived from the geometry that is ACTUALLY drawn.
 *
 * WHY FROM THE GEOMETRY, NOT FROM plane.pitch / plane.azimuth
 * -----------------------------------------------------------
 * This feeds the shading that makes a pitched roof read as pitched. If it took
 * the stored pitch instead, a face whose geometry had been flattened somewhere
 * upstream would still be shaded as though it were tilted — the picture would
 * lie, and the bug would be invisible precisely where it matters most. Reading
 * the rendered polygon's own normal means what you see is what exists.
 *
 * Returns tilt in degrees from horizontal (0 = flat, 90 = vertical) and
 * azimuth as a compass bearing of the downslope direction (0 = N, clockwise),
 * matching the convention getPanelShadingFactor expects.
 */
export function faceOrientation(polygon3D: readonly Cart3[]): { tiltDeg: number; azimuthDeg: number } {
  if (!polygon3D || polygon3D.length < 3) return { tiltDeg: 0, azimuthDeg: 180 };

  // Newell normal in ECEF — robust to a bad vertex triple, unlike a single cross product.
  let nx = 0, ny = 0, nz = 0;
  const N = polygon3D.length;
  for (let i = 0; i < N; i++) {
    const c = polygon3D[i];
    const n = polygon3D[(i + 1) % N];
    if (!c || !n) continue;
    nx += (c.y - n.y) * (c.z + n.z);
    ny += (c.z - n.z) * (c.x + n.x);
    nz += (c.x - n.x) * (c.y + n.y);
  }
  const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(mag > 1e-9)) return { tiltDeg: 0, azimuthDeg: 180 };
  nx /= mag; ny /= mag; nz /= mag;

  // Local ENU basis at the face centroid.
  let cx = 0, cy = 0, cz = 0;
  for (const p of polygon3D) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= N; cy /= N; cz /= N;
  const geo = ecefToLatLng({ x: cx, y: cy, z: cz });
  const latR = geo.lat * Math.PI / 180;
  const lngR = geo.lng * Math.PI / 180;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const sinLng = Math.sin(lngR), cosLng = Math.cos(lngR);

  const east  = { x: -sinLng,          y: cosLng,           z: 0      };
  const north = { x: -sinLat * cosLng, y: -sinLat * sinLng, z: cosLat };
  const up    = { x:  cosLat * cosLng, y:  cosLat * sinLng, z: sinLat };

  let e = nx * east.x  + ny * east.y  + nz * east.z;
  let n = nx * north.x + ny * north.y + nz * north.z;
  let u = nx * up.x    + ny * up.y    + nz * up.z;

  // Force the normal to point outward/upward so tilt is measured from horizontal
  // rather than coming back as its supplement for a reversed winding.
  if (u < 0) { e = -e; n = -n; u = -u; }

  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, u))) * 180 / Math.PI;
  // Downslope bearing: the horizontal part of the normal points downhill.
  const azimuthDeg = ((Math.atan2(e, n) * 180 / Math.PI) % 360 + 360) % 360;
  return { tiltDeg, azimuthDeg };
}

/**
 * Signed area of a quad projected onto its own plane, used by the tests to
 * prove a wall is not self-intersecting. A bowtie's two halves cancel, so its
 * magnitude collapses toward zero while a correctly wound quad keeps the full
 * area. Exported so the invariant is checkable by anyone touching the winding.
 */
export function quadPlanarArea(corners: readonly Cart3[]): number {
  if (!corners || corners.length !== 4) return 0;
  // Newell's method gives twice the area vector of a planar polygon.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    const n = corners[(i + 1) % 4];
    nx += (c.y - n.y) * (c.z + n.z);
    ny += (c.z - n.z) * (c.x + n.x);
    nz += (c.x - n.x) * (c.y + n.y);
  }
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}
