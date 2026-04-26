// ============================================================
// SolarPro CAD Engine — Shared Geometry Utilities
// lib/cad/geometry.ts
//
// Pure math. No rendering. No DraftingInput dependency.
// Used by roofCAD, groundCAD, fenceCAD.
//
// Shared ONLY for:
//   - polygon operations
//   - coordinate transforms
//   - offset/setback math
//   - bounding box math
// ============================================================

// ── Types ────────────────────────────────────────────────────

export interface Point2D {
  x: number;
  y: number;
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

// ── GPS → Local XY (meters) ──────────────────────────────────
// Converts WGS84 lat/lng to local metric XY.
// Origin is set to the first point to minimize floating-point error.
// Y axis = North, X axis = East.

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_378_137;

export function latLngToXY(
  lat: number,
  lng: number,
  originLat: number,
  originLng: number,
): Point2D {
  const dLat = (lat - originLat) * DEG_TO_RAD;
  const dLng = (lng - originLng) * DEG_TO_RAD;
  const cosLat = Math.cos(originLat * DEG_TO_RAD);
  return {
    x: dLng * cosLat * EARTH_RADIUS_M,
    y: dLat * EARTH_RADIUS_M,
  };
}

export function latlngArrayToXY(
  points: Array<{ lat: number; lng: number }>,
): Point2D[] {
  if (points.length === 0) return [];
  const origin = points[0];
  return points.map(p => latLngToXY(p.lat, p.lng, origin.lat, origin.lng));
}

// ── Bounding Box ──────────────────────────────────────────────

export function bbox(points: Point2D[]): BBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX, minY, maxX, maxY,
    width:  maxX - minX,
    height: maxY - minY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

// ── Polygon Area (shoelace) ───────────────────────────────────

export function polygonArea(pts: Point2D[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

// ── Polygon Centroid ─────────────────────────────────────────

export function centroid(pts: Point2D[]): Point2D {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  return { x: cx / n, y: cy / n };
}

// ── Point in Polygon (ray casting) ───────────────────────────

export function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Polygon Inset (Minkowski shrink) ─────────────────────────
// Insets a convex or near-convex polygon by `dist` meters.
// Works by moving each edge inward by `dist` and intersecting.
// NOTE: For concave polygons, use only small offsets.

export function insetPolygon(pts: Point2D[], dist: number): Point2D[] {
  if (pts.length < 3 || dist === 0) return pts;
  const n = pts.length;
  const edges: { nx: number; ny: number; d: number }[] = [];

  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) continue;
    // Inward normal (for CCW polygon: rotate left = inward)
    const nx = -dy / len;
    const ny =  dx / len;
    edges.push({ nx, ny, d: a.x * nx + a.y * ny + dist });
  }

  // Intersect adjacent offset edges to get new vertices
  const result: Point2D[] = [];
  const m = edges.length;
  for (let i = 0; i < m; i++) {
    const e1 = edges[i];
    const e2 = edges[(i + 1) % m];
    // Solve: e1.nx*x + e1.ny*y = e1.d and e2.nx*x + e2.ny*y = e2.d
    const det = e1.nx * e2.ny - e2.nx * e1.ny;
    if (Math.abs(det) < 1e-9) continue; // parallel edges
    const x = (e1.d * e2.ny - e2.d * e1.ny) / det;
    const y = (e1.nx * e2.d - e2.nx * e1.d) / det;
    result.push({ x, y });
  }

  return result.length >= 3 ? result : pts;
}

// ── Distance between two points ───────────────────────────────

export function dist2D(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Rotate a point around an origin ──────────────────────────

export function rotatePoint(p: Point2D, origin: Point2D, angleDeg: number): Point2D {
  const rad = angleDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

// ── Rotate a polygon around its centroid ─────────────────────

export function rotatePolygon(pts: Point2D[], angleDeg: number): Point2D[] {
  const c = centroid(pts);
  return pts.map(p => rotatePoint(p, c, angleDeg));
}

// ── Grid generation inside a polygon ─────────────────────────
// Generates a grid of axis-aligned rectangles of size (w × h)
// spaced by (gapX, gapY) that fit inside `boundary`.
// Returns only cells whose ALL FOUR CORNERS are inside boundary.

export function gridInsidePolygon(
  boundary: Point2D[],
  cellW: number,
  cellH: number,
  gapX: number,
  gapY: number,
  bb: BBox,
): Array<{ x: number; y: number; col: number; row: number }> {
  const cells: Array<{ x: number; y: number; col: number; row: number }> = [];
  const stepX = cellW + gapX;
  const stepY = cellH + gapY;
  let row = 0;
  for (let y = bb.minY; y + cellH <= bb.maxY; y += stepY, row++) {
    let col = 0;
    for (let x = bb.minX; x + cellW <= bb.maxX; x += stepX, col++) {
      // Test all 4 corners
      const corners: Point2D[] = [
        { x, y },
        { x: x + cellW, y },
        { x: x + cellW, y: y + cellH },
        { x, y: y + cellH },
      ];
      if (corners.every(c => pointInPolygon(c, boundary))) {
        cells.push({ x, y, col, row });
      }
    }
  }
  return cells;
}

// ── Meters to feet ────────────────────────────────────────────

export function metersToFt(m: number): number {
  return m * 3.28084;
}

export function ftToMeters(ft: number): number {
  return ft * 0.3048;
}

// ── Format feet as ft-in string ───────────────────────────────

export function fmtFt(ft: number): string {
  const wholeFt = Math.floor(ft);
  const inches  = Math.round((ft - wholeFt) * 12);
  if (inches === 0) return `${wholeFt}'-0"`;
  if (inches === 12) return `${wholeFt + 1}'-0"`;
  return `${wholeFt}'-${inches}"`;
}

// ── Clamp ────────────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}