/**
 * roofPlane3D.ts — 3D Roof Plane Creation Engine  (v47.125)
 *
 * GEOMETRY GUARANTEES:
 *   1. CAMERA-FACING NORMAL: normal always points outward (toward camera / sky)
 *      If dot(normal, radialUp) < 0  → flip normal
 *      radialUp = normalize(centroid) in ECEF = "outward from Earth center"
 *   2. SURFACE OFFSET: all projected points lifted 0.05m along normal
 *      This prevents panels/planes from clipping inside noisy mesh geometry
 *   3. MATHEMATICALLY PLANAR: all points projected onto same plane
 *   4. STABLE AXES: u-axis = most-horizontal polygon edge → ridge/eave direction, click-order independent
 *   5. ORTHOGONAL FRAME: v = cross(n, u), |u|=|v|=|n|=1, dot(u,v) < 1e-9
 *   6. GRID ORIGIN = polygon corner: panels start flush with roof boundary
 *
 * Pipeline:
 *   User clicks N ≥ 3 points on Cesium photorealistic tiles
 *   → computePlaneFromPoints3D(pts)
 *       • normal  = cross(p1-p0, p2-p0)               [mathematically exact]
 *       • flip if dot(normal, radialUp) < 0            [camera-facing guarantee]
 *       • project all pts onto plane                   [coplanar guarantee]
 *       • offset all pts by +SURFACE_OFFSET along n    [above-surface guarantee]
 *       • u       = longest edge of projected polygon  [stable, edge-aligned]
 *       • v       = cross(n, u)                        [right-hand, orthogonal]
 *       • origin  = corner with min(u,v)               [snap to roof boundary]
 *   → buildRoofPlane3D(pts3D)
 *       • builds complete RoofPlane with projected polygon + stable frame
 *   → renderPlane3DEntity(...)
 *       • renders: fill, 1m grid, glow outline, slope arrows, normal indicator
 */

import type { RoofPlane } from '@/types';
import { v4 as uuidv4 } from 'uuid';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * How far above the raw mesh surface we lift every plane point.
 * 0.05m = 5cm — enough to prevent z-fighting/clipping inside noisy mesh triangles.
 * Panels inherit this offset via the projected Cartesian3 positions.
 */
export const SURFACE_OFFSET_M = 0.12; // v47.143: increased to prevent Z-fighting with mesh

// v47.153: PANEL_STEP_U/V removed.
// computeGridAlignedOrigin was using these stale step sizes (width+0.02, height+0.05)
// but buildSurfaceGridECEF is always called with panelSpacingM=0, rowSpacingM=0
// (stepU=1.134m, stepV=1.722m). The snapped origin caused a fractional UV boundary
// shift → centered-grid origin misaligned → one side of panels floated off-plane.
// Fix: origin3D = polygon corner (min-UV vertex). buildSurfaceGridECEF's centered
// grid solver is self-contained and does not need origin pre-snapped to a grid phase.

// ─── Types ───────────────────────────────────────────────────────────────────

/** ECEF Cartesian3 position (meters from Earth center) */
export interface Cart3 { x: number; y: number; z: number; }

/**
 * Stable orthonormal frame for a roof plane.
 *
 * KEY DESIGN:
 *   u = direction of longest polygon edge (stable, aligned to roof boundary)
 *   v = cross(n, u)  — perpendicular to u, in the plane, upslope
 *   n = surface normal (outward, away from earth, camera-facing)
 *   origin = min-UV corner of projected polygon (grid starts at roof edge)
 */
export interface Plane3DFrame {
  /** Grid origin in ECEF — min(u,v) corner of projected polygon, offset above surface */
  origin:  Cart3;
  /** Surface normal unit vector (ECEF, outward, camera-facing) */
  normal:  Cart3;
  /** Along-edge unit vector (ECEF) — derived from most-horizontal polygon edge (ridge/eave direction) */
  u:       Cart3;
  /** Cross-slope unit vector (ECEF) — v = cross(n, u) */
  v:       Cart3;
  /** Tilt from horizontal in degrees */
  tiltDeg: number;
  /** Compass azimuth of downslope direction */
  azimuthDeg: number;
  /** ENU normal at centroid */
  normalENU: Cart3;
  /** ENU u at centroid */
  uENU: Cart3;
  /** ENU v at centroid */
  vENU: Cart3;
  /** Projected polygon — all points guaranteed on-plane AND above surface (ECEF) */
  projectedPts: Cart3[];
}

// ─── Vector Math ─────────────────────────────────────────────────────────────

export function sub3(a: Cart3, b: Cart3): Cart3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function add3(a: Cart3, b: Cart3): Cart3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function scale3(v: Cart3, s: number): Cart3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
export function dot3(a: Cart3, b: Cart3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross3(a: Cart3, b: Cart3): Cart3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function mag3(v: Cart3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
export function normalize3(v: Cart3): Cart3 {
  const m = mag3(v);
  if (m < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
export function centroid3(pts: Cart3[]): Cart3 {
  const n = pts.length;
  let sx = 0, sy = 0, sz = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sz += p.z; }
  return { x: sx / n, y: sy / n, z: sz / n };
}

/**
 * Project point p onto plane defined by (origin, normal).
 *   projected = p − dot(p − origin, normal) × normal
 */
export function projectOntoPlane(p: Cart3, origin: Cart3, normal: Cart3): Cart3 {
  const d = sub3(p, origin);
  const dist = dot3(d, normal);
  return sub3(p, scale3(normal, dist));
}

// ─── Stable Axis Derivation ──────────────────────────────────────────────────

/**
 * v47.157: Find the MOST HORIZONTAL edge of a polygon — the ridge/eave direction.
 *
 * PROBLEM with longestEdge: when the user clicks 3 points starting from the PEAK
 * (e.g. peak → lower-left → lower-right), the resulting triangle has the peak-to-corner
 * diagonals as its longest edges — NOT the ridge or eave. longestEdge then picks a
 * diagonal as the u-axis, misaligning the entire panel grid.
 *
 * FIX — score each edge by how HORIZONTAL it is, weighted by length:
 *   upslopeDir = normalize(radialUp - dot(radialUp, normal)*normal)
 *                = direction "uphill" projected onto the roof plane
 *   score(edge) = len * (1 - |dot(edge_dir, upslopeDir)|)
 *              = 0 if edge points straight up/down the slope (slope edge)
 *              = len if edge is perfectly horizontal (ridge/eave edge)
 *
 * Pick the edge with the highest score. This selects the ridge or eave direction
 * regardless of click order, polygon shape, or roof aspect ratio.
 *
 * @param pts     Projected polygon points (ECEF, on-plane)
 * @param normal  Plane surface normal (unit vector, ECEF)
 */
function mostHorizontalEdgeAxis(pts: Cart3[], normal: Cart3): Cart3 {
  // Upslope direction: component of radial-up projected onto the plane.
  // radialUp at pts[0] ≈ normalize(pts[0]) for ECEF positions.
  // upslopeDir points "uphill" along the roof surface.
  const radialUp  = normalize3(pts[0]);
  const dotNU     = dot3(radialUp, normal);
  const upslopeRaw = sub3(radialUp, scale3(normal, dotNU));
  const upslopeMag = mag3(upslopeRaw);
  // Fallback to a known axis if degenerate (flat roof, nUp≈1)
  const upslopeDir: Cart3 = upslopeMag > 1e-6
    ? normalize3(upslopeRaw)
    : { x: 0, y: 1, z: 0 };

  let bestScore = -1;
  let bestDir: Cart3 = { x: 1, y: 0, z: 0 };

  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j    = (i + 1) % n;
    const edge = sub3(pts[j], pts[i]);
    const len  = mag3(edge);
    if (len < 1e-4) continue; // skip degenerate edges
    const dir  = normalize3(edge);
    // How horizontal is this edge? 0=slope-aligned, 1=fully horizontal
    const horizontalness = 1 - Math.abs(dot3(dir, upslopeDir));
    const score = len * horizontalness;
    if (score > bestScore) {
      bestScore = score;
      bestDir   = dir;
    }
  }
  return bestDir;
}

/**
 * Project u-axis candidate onto the plane to ensure it's truly in-plane.
 * Remove any component along the normal: u_plane = normalize(u - dot(u,n)*n)
 */
function projectAxisOntoPlane(axis: Cart3, normal: Cart3): Cart3 {
  const comp = dot3(axis, normal);
  const inPlane = sub3(axis, scale3(normal, comp));
  const m = mag3(inPlane);
  if (m < 1e-9) {
    // axis is nearly parallel to normal — fall back to east direction
    const east = normalize3({ x: -normal.y, y: normal.x, z: 0 });
    return projectAxisOntoPlane(east, normal);
  }
  return normalize3(inPlane);
}

// ─── Origin Snapping ─────────────────────────────────────────────────────────

/**
 * v47.137: Panel-grid-aligned origin.
 *
 * PROBLEM with the old "min-UV corner" approach:
 *   Two planes with the same orientation can pick DIFFERENT polygon corners
 *   as their origin, making their grid cells offset by a non-integer number
 *   of panel widths/heights. This causes diagonal drift when placing panels
 *   across planes — panels on plane B don’t line up with plane A.
 *
 * FIX — panel-step-aligned bounding-box origin:
 *   1. Project polygon vertices into UV space relative to the ECEF centroid.
 *   2. Find minU, minV (bounding-box minimum in UV).
 *   3. Snap to the nearest lower panel-grid boundary:
 *        gridU = floor(minU / stepU) * stepU
 *        gridV = floor(minV / stepV) * stepV
 *   4. ECEF grid origin = centroid + u*gridU + v*gridV
 *
 * This ensures that for ANY two planes sharing the same u/v axes, their grid
 * cells are at IDENTICAL UV coordinates modulo (stepU, stepV) — i.e. the
 * grid is consistent and panels align across all roof surfaces.
 *
 * @param projectedPts  Polygon points projected onto the plane (ECEF)
 * @param centroid      ECEF centroid of the polygon
 * @param u             Unit vector along ridge direction (in-plane)
 * @param v             Unit vector up-slope (in-plane)
 * @param stepU         Panel width + spacing (meters)
 * @param stepV         Panel height + spacing (meters)
 */
/**
 * v47.153: Polygon corner origin — min-UV vertex of the projected polygon.
 *
 * Returns the ECEF point at (minU, minV) in the plane's UV coordinate system,
 * relative to the centroid. This is the bottom-left corner of the polygon's
 * bounding box in UV space.
 *
 * buildSurfaceGridECEF projects poly3D against this origin to compute polyUV,
 * then derives its own bounding box (boundULo/Hi/VLo/Hi) from that.
 * The centered-grid solver is self-contained — origin only needs to be a
 * consistent, stable reference point. No grid-phase snapping needed here.
 *
 * Previous implementation snapped to floor(minUV / PANEL_STEP) * PANEL_STEP
 * using wrong step sizes (1.134+0.02, 1.722+0.05) while buildSurfaceGridECEF
 * uses stepU=1.134, stepV=1.722 (panelSpacingM=0). This fractional offset
 * shifted the UV boundary, misaligning the centered grid on one side.
 */
function computePolygonCornerOrigin(
  projectedPts: Cart3[],
  centroid:     Cart3,
  u:            Cart3,
  v:            Cart3,
): Cart3 {
  // Find min UV coords of the projected polygon relative to centroid
  let minU = Infinity, minV = Infinity;
  for (const p of projectedPts) {
    const d = { x: p.x - centroid.x, y: p.y - centroid.y, z: p.z - centroid.z };
    const pu = dot3(d, u);
    const pv = dot3(d, v);
    if (pu < minU) minU = pu;
    if (pv < minV) minV = pv;
  }

  // ECEF origin = centroid + u*minU + v*minV  (exact polygon corner, no snap)
  return {
    x: centroid.x + u.x * minU + v.x * minV,
    y: centroid.y + u.y * minU + v.y * minV,
    z: centroid.z + u.z * minU + v.z * minV,
  };
}

// ─── Core: Plane Fitting ──────────────────────────────────────────────────────

/**
 * Fit a stable, mathematically exact plane to 3+ ECEF points.
 *
 * ALGORITHM (v47.125 — geometry stabilization):
 *   Step 1. Plane equation from EXACTLY first 3 points
 *           normal = normalize(cross(p1-p0, p2-p0))
 *   Step 2. FORCE OUTWARD NORMAL
 *           radialUp = normalize(p0)  [direction from Earth center]
 *           if dot(normal, radialUp) < 0 → flip normal = -normal
 *           This ensures plane faces outward (toward camera/sky), never inward
 *   Step 3. Project ALL points onto plane (coplanar guarantee)
 *   Step 4. SURFACE OFFSET: lift all projected points by SURFACE_OFFSET_M along normal
 *           This prevents panels/plane from clipping inside noisy mesh geometry
 *   Step 5. u = most-horizontal edge of projected polygon (v47.157: ridge/eave-aligned, click-order independent)
 *           Project u onto plane to remove any residual normal component
 *   Step 6. v = normalize(cross(n, u))  → right-hand orthonormal frame
 *           Assert dot(u,v) < 1e-9
 *   Step 7. Shift origin to min-UV corner (flush grid start)
 *   Step 8. Convert to ENU for panel placement math
 */
export function computePlaneFromPoints3D(pts: Cart3[]): Plane3DFrame {
  if (pts.length < 3) {
    throw new Error(`computePlaneFromPoints3D: need ≥3 points, got ${pts.length}`);
  }

  const p0 = pts[0];

  // ── Step 1: Robust normal via Newell's method across ALL points ─────────────────
  // v48.8: Replaced "first 3 points cross product" with Newell's method.
  //
  // WHY: When the first 3 clicked points are nearly collinear (e.g. user clicks
  // along the ridge edge), cross(e1, e2) ≈ 0. normalize3() returns {0,0,1}
  // (straight up in ECEF) as its degenerate fallback, causing panels to shoot
  // vertically into the sky instead of lying flat on the roof surface.
  //
  // Newell's method accumulates cross products across ALL consecutive edge pairs,
  // so a single bad triple does not corrupt the result. It degrades gracefully
  // even when some edges are collinear.
  //
  // Fallback: if ALL points are truly collinear (or only 2-3 nearly-identical
  // points), we use radialUp (flat-roof assumption) which is always valid.
  let newellN = { x: 0, y: 0, z: 0 };
  const nPts = pts.length;
  for (let i = 0; i < nPts; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % nPts];
    newellN.x += (curr.y - next.y) * (curr.z + next.z);
    newellN.y += (curr.z - next.z) * (curr.x + next.x);
    newellN.z += (curr.x - next.x) * (curr.y + next.y);
  }

  const radialUp = normalize3(p0); // ECEF: normalize(position) = outward unit vector

  let normal: Cart3;
  if (mag3(newellN) < 1e-6) {
    // Truly degenerate (all points collinear or identical) — use radialUp (flat roof)
    console.warn('[roofPlane3D] Newell normal degenerate — using radialUp (flat roof fallback)');
    normal = radialUp;
  } else {
    normal = normalize3(newellN);
  }

  // ── Step 2: FORCE OUTWARD NORMAL ────────────────────────────────────────
  // If normal points into the Earth (wrong direction from noisy triangles)
  // → flip it so the plane always faces outward (toward camera/sky)
  if (dot3(normal, radialUp) < 0) {
    normal = scale3(normal, -1);
    console.log('[roofPlane3D] Normal flipped to face outward (camera-facing fix)');
  }

  // v47.150: Validate normal quality — log nUp so near-vertical planes are visible in console
  const nUpCheck = dot3(normal, radialUp);
  const tiltCheck = Math.acos(Math.max(-1, Math.min(1, nUpCheck))) * 180 / Math.PI;
  if (tiltCheck > 75) {
    console.error(`[roofPlane3D] WARNING: plane tilt=${tiltCheck.toFixed(1)}° (nUp=${nUpCheck.toFixed(4)}) — near-vertical. Panels will be clamped. Check clicked points are on roof, not wall.`);
  } else {
    console.log(`[roofPlane3D] Normal OK: nUp=${nUpCheck.toFixed(4)} tilt=${tiltCheck.toFixed(1)}°`);
  }

  // ── Step 3: Project ALL points onto plane ────────────────────────────────
  const projectedRaw: Cart3[] = pts.map(p => projectOntoPlane(p, p0, normal));

  // ── Step 4: SURFACE OFFSET — lift above noisy mesh ──────────────────────
  // Add SURFACE_OFFSET_M meters along normal to prevent clipping inside roof
  const projectedPts: Cart3[] = projectedRaw.map(p =>
    add3(p, scale3(normal, SURFACE_OFFSET_M))
  );

  // Use projected centroid as ENU reference
  const centroid = centroid3(projectedPts);

  // ── Step 5: Stable u-axis = most-horizontal edge of projected polygon ────
  // v47.157: Use most-horizontal edge (ridge/eave direction) instead of longest edge.
  // longestEdge failed when the user started clicking from the peak — the diagonal
  // from peak to corner was longer than the eave edge, giving a wrong u-axis.
  // mostHorizontalEdgeAxis scores edges by len*(1-|dot(dir,upslope)|) so the
  // ridge/eave edge always wins regardless of click order or roof aspect ratio.
  const mostHorizEdge = mostHorizontalEdgeAxis(projectedPts, normal);
  // Remove any residual normal component from the edge direction.
  // u0 = normalize(mostHorizEdge - dot(mostHorizEdge, n)*n)
  const u0 = projectAxisOntoPlane(mostHorizEdge, normal);

  // ── Step 6: Strict orthonormal frame — two-pass enforcement ──────────────
  // Pass 1: v = cross(n, u0)  — guaranteed ⊥ to both n and u0
  const v = normalize3(cross3(normal, u0));

  // Pass 2: recompute u from v and n so the triple (u, v, n) is exactly
  // orthonormal even if u0 had any residual error from projectAxisOntoPlane.
  // u = normalize(cross(v, n))
  const u = normalize3(cross3(v, normal));

  // Verify orthogonality (debug assertion — all three dots should be ~0)
  if (process.env.NODE_ENV !== 'production') {
    const uvDot = Math.abs(dot3(u, v));
    const unDot = Math.abs(dot3(u, normal));
    const vnDot = Math.abs(dot3(v, normal));
    if (uvDot > 1e-9 || unDot > 1e-9 || vnDot > 1e-9) {
      console.warn(`[roofPlane3D] Frame orthogonality: dot(u,v)=${uvDot.toExponential(2)} dot(u,n)=${unDot.toExponential(2)} dot(v,n)=${vnDot.toExponential(2)}`);
    }
  }

  // ── Step 7: Polygon corner origin (v47.153: exact min-UV corner, no grid snap) ───────────
  // v47.153: Use exact polygon corner origin (no grid-phase snap — see computePolygonCornerOrigin)
  const gridOrigin = computePolygonCornerOrigin(projectedPts, centroid, u, v);

  // ── Step 8: ENU conversion at centroid ──────────────────────────────────
  const upECEF    = normalize3(centroid);
  const eastRaw   = { x: -centroid.y, y: centroid.x, z: 0 };
  const eastECEF  = normalize3(eastRaw);
  const northECEF = normalize3(cross3(upECEF, eastECEF));

  function toENU(ecef: Cart3): Cart3 {
    return {
      x: dot3(ecef, eastECEF),
      y: dot3(ecef, northECEF),
      z: dot3(ecef, upECEF),
    };
  }

  const normalENU = toENU(normal);
  const uENU      = toENU(u);
  const vENU      = toENU(v);

  // ── Azimuth + Tilt from ENU normal ──────────────────────────────────────
  const tiltRad = Math.acos(Math.max(-1, Math.min(1, normalENU.z)));
  const tiltDeg = tiltRad * 180 / Math.PI;

  let azimuthDeg: number;
  if (tiltDeg < 0.5) {
    azimuthDeg = 180; // flat roof — default south-facing
  } else {
    azimuthDeg = Math.atan2(normalENU.x, normalENU.y) * 180 / Math.PI;
    if (azimuthDeg < 0) azimuthDeg += 360;
  }

  return {
    origin: gridOrigin,   // ← min-UV polygon corner (exact, no snap), offset above surface
    normal,
    u,
    v,
    tiltDeg,
    azimuthDeg,
    normalENU,
    uENU,
    vENU,
    projectedPts,
  };
}

// ─── ECEF ↔ Lat/Lng ──────────────────────────────────────────────────────────

const WGS84_A  = 6378137.0;
const WGS84_B  = 6356752.314245;
const WGS84_E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

export function ecefToLatLng(p: Cart3): { lat: number; lng: number; height: number } {
  const { x, y, z } = p;
  const lng = Math.atan2(y, x) * 180 / Math.PI;
  const p2  = Math.sqrt(x * x + y * y);
  let lat   = Math.atan2(z, p2 * (1 - WGS84_E2));
  for (let i = 0; i < 5; i++) {
    const sinLat = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    lat = Math.atan2(z + WGS84_E2 * N * sinLat, p2);
  }
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const height = p2 / Math.cos(lat) - N;
  return { lat: lat * 180 / Math.PI, lng, height };
}

export function latLngToECEF(lat: number, lng: number, height = 0): Cart3 {
  const latR = lat * Math.PI / 180;
  const lngR = lng * Math.PI / 180;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const sinLng = Math.sin(lngR), cosLng = Math.cos(lngR);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (N + height) * cosLat * cosLng,
    y: (N + height) * cosLat * sinLng,
    z: (N * (1 - WGS84_E2) + height) * sinLat,
  };
}

// ─── Area ────────────────────────────────────────────────────────────────────

export function projectToPlaneUV(pts: Cart3[], frame: Plane3DFrame): { u: number; v: number }[] {
  return pts.map(p => {
    const d = sub3(p, frame.origin);
    return { u: dot3(d, frame.u), v: dot3(d, frame.v) };
  });
}

function polygonArea2D(pts: { u: number; v: number }[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].u * pts[j].v;
    area -= pts[j].u * pts[i].v;
  }
  return Math.abs(area) / 2;
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

/**
 * Build a complete RoofPlane from 3+ clicked ECEF points.
 *
 * CRITICAL: Uses the STABLE FRAME (longest-edge u-axis, corner origin).
 * All projected points are lifted SURFACE_OFFSET_M above the raw mesh.
 * This is what drives buildSurfaceGrid — the frame in localFrame3D IS
 * the grid coordinate system. Panels will be aligned with the roof edges
 * and sit above the surface (never clipped inside geometry).
 */
export function buildRoofPlane3D(pts3D: Cart3[]): RoofPlane {
  if (pts3D.length < 3) {
    throw new Error(`buildRoofPlane3D: need ≥3 points, got ${pts3D.length}`);
  }

  const frame = computePlaneFromPoints3D(pts3D);
  const projPts = frame.projectedPts; // already offset above surface

  // Vertices in lat/lng (projected, coplanar, offset above surface)
  const vertices = projPts.map(p => {
    const { lat, lng } = ecefToLatLng(p);
    return { lat, lng };
  });

  // Centroid from projected points
  const centroidCart = centroid3(projPts);
  const { lat: centroidLat, lng: centroidLng, height: centroidHeight } = ecefToLatLng(centroidCart);

  // Area (m²)
  const uvPts   = projectToPlaneUV(projPts, frame);
  const areaMSq = polygonArea2D(uvPts);

  const azimuth = ((frame.azimuthDeg % 360) + 360) % 360;
  const pitch   = Math.max(0, Math.min(60, frame.tiltDeg));

  const id = uuidv4();

  const plane: RoofPlane = {
    id,
    vertices,
    pitch,
    azimuth,
    area:        areaMSq,
    usableArea:  areaMSq * 0.75,
    centroidLat,
    centroidLng,
    source:      'manual',
    confirmed:   true,
    createdFrom3D: true,
    // Height above ground: derive from centroid height minus ground estimate
    // We store 0.0 here because buildSurfaceGrid uses the actual ECEF height
    // (from projectedPts via origin3D) not planeHeightAtCenterMeters
    planeHeightAtCenterMeters: 0.0,

    // 3D geometry — projected, mathematically planar, offset above surface
    origin3D:  frame.origin,  // ← grid origin (corner-snapped, above surface)
    normal3D:  frame.normal,
    polygon3D: projPts,

    // STABLE localFrame3D — longest-edge aligned, orthonormal
    // buildSurfaceGrid MUST use this instead of recomputing from azimuth
    localFrame3D: {
      u: frame.uENU,
      v: frame.vENU,
      n: frame.normalENU,
    },

    // v47.128: ECEF frame axes — used by buildSurfaceGrid for pure ECEF grid arithmetic.
    // These are the ECEF-space unit vectors (not ENU tangent approximations).
    // worldPos = origin3D + u*du + v*dv + n*PANEL_OFFSET_ECEF (0.05m)  (zero metersPerDeg error)
    ecefFrame3D: {
      u: frame.u,
      v: frame.v,
      n: frame.normal,
    },
  };

  return plane;
}

// ─── Visualization ────────────────────────────────────────────────────────────

/**
 * Render a professional roof plane visualization in Cesium.
 *
 * Layers:
 *   1. Fill polygon       — semi-transparent blue/cyan
 *   2. Grid lines         — 1m spacing, aligned to u/v plane axes
 *   3. Glow outline       — PolylineGlowMaterial (5px) + white inner (1.5px)
 *   4. Slope arrows       — 3 arrows along v (downslope)
 *   5. Normal indicator   — 1.2m orange line at centroid
 *   6. Label              — plane ID + Az + Tilt
 */
export function renderPlane3DEntity(
  viewer: any,
  C: any,
  pts3D: any[],   // Cesium Cartesian3[] — projected polygon corners (above surface)
  planeId: string,
  frame?: Plane3DFrame,
  selected = false,
): string[] {
  const entityIds: string[] = [];

  try {
    // ── 1. FLAT ROOF OVERLAY ─────────────────────────────────────────────
    // v47.140: Section 1 — Flat roof overlay rendered from PROJECTED polygon pts.
    // pts3D are MATHEMATICALLY PLANAR (computed by computePlaneFromPoints3D),
    // so this polygon is a true flat surface decoupled from the wavy Cesium mesh.
    //
    // Two-layer approach:
    //   Layer a) Dark base coat — suppresses wavy mesh waviness beneath panels.
    //   Layer b) Color tint — subtle blue guide (active = brighter cyan).
    //
    // perPositionHeight:true + arcType:NONE = exact flat plane polygon.
    // Section 2: Panels are placed via pure ECEF plane math (PANEL_OFFSET_ECEF=0.05m + SURFACE_OFFSET_M=0.12m = 0.17m total).
    // No sampleHeight(), no per-panel mesh query.

    // Layer a: opaque base coat (visually replaces wavy mesh surface)
    const baseCoatColor = C.Color.fromCssColorString('#1a1f2e').withAlpha(0.70);
    const baseCoatEntity = viewer.entities.add({
      name: `[PLANE3D-BASE] ${planeId}`,
      polygon: {
        hierarchy:         new C.PolygonHierarchy(pts3D),
        material:          baseCoatColor,
        outline:           false,
        perPositionHeight: true,
        arcType:           C.ArcType.NONE,
      },
    });
    entityIds.push(baseCoatEntity.id);

    // Layer b: tint overlay
    const fillColor = selected
      ? C.Color.fromCssColorString('#00e5ff').withAlpha(0.18)
      : C.Color.fromCssColorString('#1a8cff').withAlpha(0.12);

    const fillEntity = viewer.entities.add({
      name: `[PLANE3D-FILL] ${planeId}`,
      polygon: {
        hierarchy:         new C.PolygonHierarchy(pts3D),
        material:          fillColor,
        outline:           false,
        perPositionHeight: true,
        arcType:           C.ArcType.NONE,
      },
    });
    entityIds.push(fillEntity.id);

    // ── 2. GRID LINES ──────────────────────────────────────────────────────
    if (frame) {
      const gridIds = renderPlaneGrid(viewer, C, pts3D, frame, planeId, selected);
      entityIds.push(...gridIds);
    }

    // ── 3. GLOW OUTLINE ────────────────────────────────────────────────────
    const outlinePts = [...pts3D, pts3D[0]];

    // v47.126: Strong outer glow + crisp white inner edge for active plane
    const glowEntity = viewer.entities.add({
      name: `[PLANE3D-GLOW] ${planeId}`,
      polyline: {
        positions: outlinePts,
        width: selected ? 10 : 5,
        material: new C.PolylineGlowMaterialProperty({
          glowPower:  selected ? 0.4 : 0.12,
          taperPower: 1.0,
          color:      selected
            ? C.Color.fromCssColorString('#00ffff')
            : C.Color.fromCssColorString('#4db8ff'),
        }),
        clampToGround: false,
        arcType:       C.ArcType.NONE,
      },
    });
    entityIds.push(glowEntity.id);

    const edgeEntity = viewer.entities.add({
      name: `[PLANE3D-EDGE] ${planeId}`,
      polyline: {
        positions: outlinePts,
        width:         selected ? 3.0 : 1.5,
        material:      selected ? C.Color.WHITE.withAlpha(1.0) : C.Color.WHITE.withAlpha(0.55),
        clampToGround: false,
        arcType:       C.ArcType.NONE,
      },
    });
    entityIds.push(edgeEntity.id);

    // ── 4. SLOPE ARROWS ────────────────────────────────────────────────────
    if (frame) {
      const arrowIds = renderSlopeArrows(viewer, C, pts3D, frame, planeId, selected);
      entityIds.push(...arrowIds);
    }

    // ── 5. NORMAL INDICATOR ────────────────────────────────────────────────
    if (frame) {
      const normalEnt = renderNormalIndicator(viewer, C, pts3D, frame, planeId);
      if (normalEnt) entityIds.push(normalEnt.id);
    }

    // ── 6. LABEL ──────────────────────────────────────────────────────────
    const cx = pts3D.reduce((s: number, p: any) => s + p.x, 0) / pts3D.length;
    const cy = pts3D.reduce((s: number, p: any) => s + p.y, 0) / pts3D.length;
    const cz = pts3D.reduce((s: number, p: any) => s + p.z, 0) / pts3D.length;
    const centPos = new C.Cartesian3(cx, cy, cz);

    // v47.126: Clear, installer-friendly label with full plane confidence info
    const azStr    = frame ? `${frame.azimuthDeg.toFixed(0)}°` : '—';
    const tiltStr  = frame ? `${frame.tiltDeg.toFixed(1)}°` : '—';
    const areaStr  = frame ? '' : '';
    const labelText = selected
      ? `▣ ROOF PLANE ACTIVE\nAzimuth ${azStr}  ·  Tilt ${tiltStr}`
      : `◻ Roof Plane  Az ${azStr}  Tilt ${tiltStr}`;

    const labelEntity = viewer.entities.add({
      name:     `[PLANE3D-LABEL] ${planeId}`,
      position: centPos,
      label: {
        text:                     labelText,
        font:                     selected ? 'bold 14px monospace' : '11px monospace',
        fillColor:                selected
          ? C.Color.fromCssColorString('#00ffff')
          : C.Color.fromCssColorString('#99ddff'),
        style:                    C.LabelStyle.FILL_AND_OUTLINE,
        outlineColor:             C.Color.BLACK,
        outlineWidth:             selected ? 3 : 2,
        verticalOrigin:           C.VerticalOrigin.CENTER,
        horizontalOrigin:         C.HorizontalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground:           true,
        backgroundColor:          selected
          ? C.Color.fromCssColorString('#001a2e').withAlpha(0.88)
          : C.Color.BLACK.withAlpha(0.50),
        backgroundPadding:        new C.Cartesian2(10, 6),
        scale:                    selected ? 1.0 : 0.9,
      },
    });
    entityIds.push(labelEntity.id);

  } catch (e: unknown) {
    console.warn('[roofPlane3D] renderPlane3DEntity error:', (e as Error).message);
  }

  return entityIds;
}

// ─── Grid Lines ───────────────────────────────────────────────────────────────

function renderPlaneGrid(
  viewer: any,
  C: any,
  pts3D: any[],
  frame: Plane3DFrame,
  planeId: string,
  selected: boolean,
): string[] {
  const ids: string[] = [];
  try {
    const plainPts: Cart3[] = pts3D.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const uvPts = projectToPlaneUV(plainPts, frame);

    const uMin = Math.min(...uvPts.map(p => p.u));
    const uMax = Math.max(...uvPts.map(p => p.u));
    const vMin = Math.min(...uvPts.map(p => p.v));
    const vMax = Math.max(...uvPts.map(p => p.v));

    // v47.126: Larger grid spacing (match panel dims ≈ 1.7m), much lower opacity
    // Grid guides layout without dominating the visual — very subtle
    const STEP  = 1.72; // matches panel height in portrait mode
    const alpha = selected ? 0.12 : 0.06; // 70% less visible than before
    const color = C.Color.fromCssColorString('#00e5ff').withAlpha(alpha);

    // Lines along u (step in v)
    const vStart = Math.ceil(vMin / STEP) * STEP;
    const vEnd   = Math.floor(vMax / STEP) * STEP;
    for (let vv = vStart; vv <= vEnd + 0.001; vv += STEP) {
      const p0 = uvToECEF(uMin, vv, frame);
      const p1 = uvToECEF(uMax, vv, frame);
      const e  = viewer.entities.add({
        name: `[PLANE3D-GRID-U] ${planeId} v=${vv.toFixed(1)}`,
        polyline: {
          positions:     [new C.Cartesian3(p0.x, p0.y, p0.z), new C.Cartesian3(p1.x, p1.y, p1.z)],
          width:         0.8,
          material:      color,
          clampToGround: false,
          arcType:       C.ArcType.NONE,
        },
      });
      ids.push(e.id);
    }

    // Lines along v (step in u)
    const uStart = Math.ceil(uMin / STEP) * STEP;
    const uEnd   = Math.floor(uMax / STEP) * STEP;
    for (let uu = uStart; uu <= uEnd + 0.001; uu += STEP) {
      const p0 = uvToECEF(uu, vMin, frame);
      const p1 = uvToECEF(uu, vMax, frame);
      const e  = viewer.entities.add({
        name: `[PLANE3D-GRID-V] ${planeId} u=${uu.toFixed(1)}`,
        polyline: {
          positions:     [new C.Cartesian3(p0.x, p0.y, p0.z), new C.Cartesian3(p1.x, p1.y, p1.z)],
          width:         0.8,
          material:      color,
          clampToGround: false,
          arcType:       C.ArcType.NONE,
        },
      });
      ids.push(e.id);
    }
  } catch (e: unknown) {
    console.warn('[roofPlane3D] renderPlaneGrid error:', (e as Error).message);
  }
  return ids;
}

function uvToECEF(u: number, v: number, frame: Plane3DFrame): Cart3 {
  return add3(frame.origin, add3(scale3(frame.u, u), scale3(frame.v, v)));
}

// ─── Slope Arrows ─────────────────────────────────────────────────────────────

function renderSlopeArrows(
  viewer: any,
  C: any,
  pts3D: any[],
  frame: Plane3DFrame,
  planeId: string,
  selected: boolean,
): string[] {
  const ids: string[] = [];
  if (frame.tiltDeg < 1.0) return ids;

  try {
    const plainPts: Cart3[] = pts3D.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
    const uvPts = projectToPlaneUV(plainPts, frame);

    const uMid  = (Math.min(...uvPts.map(p => p.u)) + Math.max(...uvPts.map(p => p.u))) / 2;
    const vMid  = (Math.min(...uvPts.map(p => p.v)) + Math.max(...uvPts.map(p => p.v))) / 2;
    const uSpan = Math.max(...uvPts.map(p => p.u)) - Math.min(...uvPts.map(p => p.u));

    const arrowLen     = Math.min(2.5, uSpan * 0.25);
    const arrowOffsets = [-uSpan * 0.25, 0, uSpan * 0.25];
    const arrowColor   = selected
      ? C.Color.fromCssColorString('#00ffaa').withAlpha(0.95)
      : C.Color.fromCssColorString('#4fc3f7').withAlpha(0.85);

    for (const uOff of arrowOffsets) {
      const tailV = vMid - arrowLen * 0.3;
      const tipV  = vMid + arrowLen * 0.7;
      const tail  = uvToECEF(uMid + uOff, tailV, frame);
      const tip   = uvToECEF(uMid + uOff, tipV,  frame);

      const e = viewer.entities.add({
        name: `[PLANE3D-ARROW] ${planeId} u=${uOff.toFixed(1)}`,
        polyline: {
          positions: [
            new C.Cartesian3(tail.x, tail.y, tail.z),
            new C.Cartesian3(tip.x,  tip.y,  tip.z),
          ],
          width:         selected ? 3 : 2.5,
          material:      new C.PolylineArrowMaterialProperty(arrowColor),
          clampToGround: false,
          arcType:       C.ArcType.NONE,
        },
      });
      ids.push(e.id);
    }
  } catch (e: unknown) {
    console.warn('[roofPlane3D] renderSlopeArrows error:', (e as Error).message);
  }
  return ids;
}

// ─── Normal Indicator ─────────────────────────────────────────────────────────

function renderNormalIndicator(
  viewer: any,
  C: any,
  pts3D: any[],
  frame: Plane3DFrame,
  planeId: string,
): any | null {
  try {
    const cx = pts3D.reduce((s: number, p: any) => s + p.x, 0) / pts3D.length;
    const cy = pts3D.reduce((s: number, p: any) => s + p.y, 0) / pts3D.length;
    const cz = pts3D.reduce((s: number, p: any) => s + p.z, 0) / pts3D.length;
    const centroid: Cart3 = { x: cx, y: cy, z: cz };

    const NORMAL_LEN = 1.2;
    const tip = add3(centroid, scale3(frame.normal, NORMAL_LEN));

    return viewer.entities.add({
      name: `[PLANE3D-NORMAL] ${planeId}`,
      polyline: {
        positions: [
          new C.Cartesian3(centroid.x, centroid.y, centroid.z),
          new C.Cartesian3(tip.x, tip.y, tip.z),
        ],
        width:         2,
        material:      C.Color.fromCssColorString('#ff6b35').withAlpha(0.9),
        clampToGround: false,
        arcType:       C.ArcType.NONE,
      },
    });
  } catch (e: unknown) {
    console.warn('[roofPlane3D] renderNormalIndicator error:', (e as Error).message);
    return null;
  }
}

// ─── Point Markers ────────────────────────────────────────────────────────────

export function renderPoint3DMarker(
  viewer: any,
  C: any,
  pos: any,
  index: number,
): any {
  return viewer.entities.add({
    name:     `[PLANE3D-PT] ${index}`,
    position: pos,
    point: {
      pixelSize:                index === 0 ? 14 : 10,
      color:                    index === 0
        ? C.Color.fromCssColorString('#00ff88')
        : C.Color.fromCssColorString('#ffd700'),
      outlineColor:             C.Color.WHITE,
      outlineWidth:             2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text:                     `P${index + 1}`,
      font:                     '11px monospace',
      fillColor:                C.Color.WHITE,
      style:                    C.LabelStyle.FILL_AND_OUTLINE,
      outlineColor:             C.Color.BLACK,
      outlineWidth:             2,
      pixelOffset:              new C.Cartesian2(12, -8),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
}

export function renderPreviewPolyline(
  viewer: any,
  C: any,
  pts: any[],
  existingEntity: any | null,
): any {
  if (existingEntity) {
    try { viewer.entities.remove(existingEntity); } catch {}
  }
  if (pts.length < 2) return null;

  return viewer.entities.add({
    name: '[PLANE3D-PREVIEW]',
    polyline: {
      positions:     pts,
      width:         2,
      material:      C.Color.fromCssColorString('#ff8c00').withAlpha(0.7),
      clampToGround: false,
      arcType:       C.ArcType.NONE,
    },
  });
}