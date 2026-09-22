/**
 * lib/3d/abutment.ts
 *
 * Land a lower roof onto the FACE of a higher one — porches, lean-tos, wings,
 * shed dormers.
 *
 * THE CASE STITCH CANNOT SEE
 * --------------------------
 * Ray: "My one plane of my roof meets into a covered porch. Pretty common.
 * But the porch roof meets into the main roof ABOVE the eave. The system is not
 * stitching that correctly."
 *
 * Stitch joins CORNER to CORNER: it clusters vertices that are near each other
 * and moves them to their mean. That is exactly right for a gable, where both
 * halves genuinely own the same two ridge corners — which is why his garage
 * worked.
 *
 * A porch is a different shape of problem. Its head lands partway UP the main
 * slope, so the porch's top corners sit in the MIDDLE of the main face. There
 * is no corner of the main roof anywhere near them, so corner clustering has
 * nothing to grab and leaves the porch floating at whatever height its own
 * trace implied. No tolerance fixes that, because the thing it needs to attach
 * to is not a point — it is a surface.
 *
 * So: for each vertex, find the height the OTHER face's plane has directly
 * above or below it, and move the vertex there. The porch's head then lies
 * exactly on the main roof, wherever up the slope it happens to meet.
 *
 * 🚨 This moves traced corners vertically, so it is part of the explicit Stitch
 * action and never runs on its own. Horizontal position is NEVER touched — the
 * plan-view footprint the user traced is theirs, and only the height it sits at
 * is inferred.
 *
 * 🚨 SCOPE OF THAT RULE, RULED ON 2026-09-21 — READ BEFORE CITING IT ELSEWHERE.
 *
 * This sentence has been read as a blanket ban on horizontal movement, and a
 * proposal for a Move tool turned on it. It is not. The ruling:
 *
 *   INFERENCE AND AUTOMATIC RECONCILIATION must never silently move the user's
 *   traced plan geometry. An EXPLICIT USER GESTURE may — deliberately selecting
 *   a building section and moving it is the user exercising ownership of their
 *   own footprint, not the software overriding it.
 *
 *   AUTOMATIC / INFERRED MUTATION  ≠  EXPLICIT USER-AUTHORED MUTATION.
 *
 * This module is squarely on the `inferred` side: it runs as part of Stitch,
 * decides for itself which vertices to move, and therefore stays vertical-only.
 * The rule above is unchanged FOR THIS FILE. What changed is that it is no
 * longer the whole policy, and the policy now lives in one place rather than in
 * this comment: lib/3d/geometryMutationPolicy.ts.
 */

import { ecefToLatLng, latLngToECEF, type Cart3 } from '@/lib/roofPlane3D';

export interface AbutFace {
  id: string;
  /** Face outline in ECEF, at true height. */
  polygon3D: Cart3[];
}

export interface AbutmentOptions {
  /**
   * How far a vertex may be moved vertically to land on another face. Default
   * 2.5 m.
   *
   * Generous, because the whole point is that the trace had no idea what height
   * the porch head should be — its eave height was a guess and its pitch came
   * from a global control. Bounded, because a vertex that would have to move
   * further than this is not abutting that face at all; it belongs to a
   * different part of the building, and dragging it would invent geometry.
   */
  maxLiftM?: number;
  /**
   * How far OUTSIDE a face's plan-view outline a vertex may sit and still be
   * considered to land on it. Default 0.6 m.
   *
   * Non-zero because a hand trace of a porch head rarely stops exactly at the
   * main roof's edge; it overshoots or undershoots by a click's width.
   */
  planInsetToleranceM?: number;
  /**
   * A vertex with another face's CORNER this close is left alone. Default 1.6 m.
   *
   * 🚨 THE DIVISION OF LABOUR, AND IT MATTERS.
   * Corner-meets-corner belongs to CLUSTERING (Stitch): both faces genuinely own
   * that point, so the answer is their mean, and everybody moves there together.
   * Vertex-lands-mid-face belongs HERE: only one face owns the point, and it has
   * to move onto the other's surface.
   *
   * Letting this function take a shared corner is not merely redundant, it is
   * WRONG. Planes are sampled from the ORIGINAL geometry so the result cannot
   * depend on face order — which means two mutually-abutting corners each land
   * on the other's old plane and simply SWAP heights. A saltbox ridge stays
   * exactly as far apart as it started. Clustering converges; this does not, so
   * it must decline the cases clustering owns.
   */
  cornerTakeoverToleranceM?: number;
}

const DEFAULTS = { maxLiftM: 2.5, planInsetToleranceM: 0.6, cornerTakeoverToleranceM: 1.6 };
const M_PER_DEG_LAT = 111320;
const DEG = Math.PI / 180;

export interface AbutmentResult {
  /** New polygons by face id. Faces with nothing to change are returned as-is. */
  faces: Map<string, Cart3[]>;
  /** How many vertices were landed onto another face. */
  snapped: number;
  /** Largest vertical move applied, metres. */
  maxLiftM: number;
}

interface PlaneEq { p0: Cart3; n: Cart3 }

/** Least-squares-ish plane through a polygon, via Newell's normal. */
function planeOf(poly: readonly Cart3[]): PlaneEq | null {
  if (!poly || poly.length < 3) return null;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = poly[i], d = poly[(i + 1) % poly.length];
    if (!c || !d) return null;
    nx += (c.y - d.y) * (c.z + d.z);
    ny += (c.z - d.z) * (c.x + d.x);
    nz += (c.x - d.x) * (c.y + d.y);
  }
  const m = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(m > 1e-9)) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const p of poly) { cx += p.x; cy += p.y; cz += p.z; }
  const k = poly.length;
  return { p0: { x: cx / k, y: cy / k, z: cz / k }, n: { x: nx / m, y: ny / m, z: nz / m } };
}

/** Local up at a geodetic position, in ECEF. */
function upAt(lat: number, lng: number): Cart3 {
  const la = lat * DEG, lo = lng * DEG;
  return { x: Math.cos(la) * Math.cos(lo), y: Math.cos(la) * Math.sin(lo), z: Math.sin(la) };
}

/**
 * Height at which the vertical line through (lat,lng) meets `plane`.
 * Null when the plane is vertical there, so the line never meets it.
 */
export function planeHeightAt(plane: PlaneEq, lat: number, lng: number): number | null {
  const up = upAt(lat, lng);
  const base = latLngToECEF(lat, lng, 0);
  const denom = up.x * plane.n.x + up.y * plane.n.y + up.z * plane.n.z;
  if (Math.abs(denom) < 1e-6) return null; // plane is edge-on to vertical
  const num = (plane.p0.x - base.x) * plane.n.x
            + (plane.p0.y - base.y) * plane.n.y
            + (plane.p0.z - base.z) * plane.n.z;
  const t = num / denom;
  const hit = { x: base.x + up.x * t, y: base.y + up.y * t, z: base.z + up.z * t };
  const h = ecefToLatLng(hit).height;
  return isFinite(h) ? h : null;
}

/** Point-in-polygon in plan view, with an outward tolerance band. */
function inPlanView(
  lat: number, lng: number,
  ring: ReadonlyArray<{ lat: number; lng: number }>,
  tolM: number,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lng;
    const yj = ring[j].lat, xj = ring[j].lng;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  if (inside) return true;
  if (tolM <= 0) return false;
  // Just outside counts too: a traced porch head rarely stops exactly on the
  // main roof's edge. Measure distance to the nearest edge segment.
  const mLng = M_PER_DEG_LAT * Math.cos(lat * DEG);
  const px = lng * mLng, py = lat * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j].lng * mLng, ay = ring[j].lat * M_PER_DEG_LAT;
    const bx = ring[i].lng * mLng, by = ring[i].lat * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best <= tolM;
}

/**
 * Land lower faces onto the surfaces of higher ones.
 *
 * For every vertex, look for another face whose plane passes close by directly
 * above or below it, and whose plan-view outline covers it. If one is found,
 * move the vertex vertically onto that plane.
 *
 * Only ever moves a vertex DOWN onto a face it is under, or UP onto a face it
 * is over, by at most `maxLiftM`. Horizontal position is never changed.
 */
export function snapAbutments(
  faces: readonly AbutFace[],
  options: AbutmentOptions = {},
): AbutmentResult {
  const maxLift = options.maxLiftM ?? DEFAULTS.maxLiftM;
  const planTol = options.planInsetToleranceM ?? DEFAULTS.planInsetToleranceM;
  const cornerTol = options.cornerTakeoverToleranceM ?? DEFAULTS.cornerTakeoverToleranceM;

  const out = new Map<string, Cart3[]>();
  for (const f of faces) out.set(f.id, (f.polygon3D ?? []).map(p => ({ ...p })));
  if (faces.length < 2) return { faces: out, snapped: 0, maxLiftM: 0 };

  // Precompute each face's plane and plan-view ring ONCE, from the ORIGINAL
  // geometry. Using updated geometry would let one snap cascade into the next
  // and make the result depend on face ordering.
  const meta = new Map<string, { plane: PlaneEq; ring: Array<{ lat: number; lng: number }> }>();
  for (const f of faces) {
    const plane = planeOf(f.polygon3D);
    if (!plane) continue;
    const ring = f.polygon3D.map(p => { const g = ecefToLatLng(p); return { lat: g.lat, lng: g.lng }; });
    meta.set(f.id, { plane, ring });
  }

  let snapped = 0;
  let maxApplied = 0;

  for (const f of faces) {
    const poly = out.get(f.id);
    if (!poly) continue;
    for (let i = 0; i < poly.length; i++) {
      const g = ecefToLatLng(poly[i]);
      if (!isFinite(g.lat) || !isFinite(g.lng) || !isFinite(g.height)) continue;

      // Does another face have a CORNER essentially here? Then this is a shared
      // corner and belongs to clustering, which converges. Leave it.
      let ownedByCluster = false;
      for (const other of faces) {
        if (other.id === f.id) continue;
        for (const q of other.polygon3D ?? []) {
          const gq = ecefToLatLng(q);
          if (!isFinite(gq.lat) || !isFinite(gq.lng)) continue;
          const mLng = M_PER_DEG_LAT * Math.cos(g.lat * DEG);
          const d = Math.hypot((gq.lng - g.lng) * mLng, (gq.lat - g.lat) * M_PER_DEG_LAT);
          if (d <= cornerTol) { ownedByCluster = true; break; }
        }
        if (ownedByCluster) break;
      }
      if (ownedByCluster) continue;

      // Best candidate = the smallest vertical move onto a face that actually
      // covers this point in plan view.
      let bestH: number | null = null;
      let bestDelta = Infinity;
      for (const other of faces) {
        if (other.id === f.id) continue;
        const m = meta.get(other.id);
        if (!m) continue;
        if (!inPlanView(g.lat, g.lng, m.ring, planTol)) continue;
        const h = planeHeightAt(m.plane, g.lat, g.lng);
        if (h === null) continue;
        const delta = Math.abs(h - g.height);
        if (delta > maxLift) continue;
        if (delta < bestDelta) { bestDelta = delta; bestH = h; }
      }

      // A move under a millimetre is noise, not an abutment.
      if (bestH === null || bestDelta < 0.001) continue;
      poly[i] = latLngToECEF(g.lat, g.lng, bestH);
      snapped++;
      if (bestDelta > maxApplied) maxApplied = bestDelta;
    }
  }

  return { faces: out, snapped, maxLiftM: maxApplied };
}
