/**
 * roofGeometry.ts — CAD-Style Roof Geometry Engine  (v47.99)
 *
 * LECS (Local Engineering Coordinate System) — feet as internal unit.
 *
 * Pipeline:
 *   RoofPlane (lat/lng vertices)
 *   → local feet coords (centroid = origin, via localProjection.ts)
 *   → inward setback offset (feet) → usable polygon (feet)
 *   → rotate so azimuth aligns with +Y (up-slope)
 *   → canonical grid origin (bb corner)
 *   → generate full rows × columns rectangular grid (feet)
 *   → clip: reject any panel whose 4 corners are not ALL inside usable polygon
 *   → rotate back → local feet → lat/lng
 *   → return PlacedPanel[] with xFeet/yFeet/widthFeet/heightFeet
 *
 * Coordinate frame (+X = east / +Y = north, feet):
 *   rotAngle = (azimuth − 180) × π/180
 *   In rotated frame:  +X = along ridge,  +Y = up slope
 *
 * Unit policy:
 *   All internal geometry in FEET.
 *   lat/lng produced only at the final output step via localFeetToLatLng().
 *   Meters appear only in localProjection.ts conversions.
 */

import { v4 as uuidv4 } from 'uuid';
import type { PlacedPanel, SolarPanel, RoofPlane } from '@/types';
import {
  latLngToLocalFeet,
  localFeetToLatLng,
  polygonCentroidLatLng,
  FEET_PER_METER,
  METERS_PER_FOOT,
  type LocalFeetPoint,
  type LatLngPoint,
} from './localProjection';

// ─── Re-export projection helpers for callers that imported from roofGeometry ─
// (backwards compatibility — callers may import latLngToLocal etc.)
export { FEET_PER_METER, METERS_PER_FOOT };

// ─── Legacy metric constants (kept for downstream callers) ───────────────────
export const METERS_PER_DEG_LAT = 111_320;
export const DEG_TO_RAD         = Math.PI / 180;

// ─── Legacy LocalPoint (meters) — kept for callers outside CAD engine ────────
export interface LocalPoint { x: number; y: number; }
export interface LatLng     { lat: number; lng: number; }

/** Legacy metric projection — kept for non-CAD callers (debug overlay, area calc). */
export function latLngToLocal(pt: LatLng, origin: LatLng): LocalPoint {
  const cosLat = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    x: (pt.lng - origin.lng) * cosLat * METERS_PER_DEG_LAT,
    y: (pt.lat - origin.lat) * METERS_PER_DEG_LAT,
  };
}

/** Legacy metric projection inverse. */
export function localToLatLng(pt: LocalPoint, origin: LatLng): LatLng {
  const cosLat = Math.cos(origin.lat * DEG_TO_RAD);
  return {
    lat: origin.lat + pt.y / METERS_PER_DEG_LAT,
    lng: origin.lng + pt.x / (cosLat * METERS_PER_DEG_LAT),
  };
}

// ─── Polygon Utilities ───────────────────────────────────────────────────────

export function polygonCentroid(vertices: LatLng[]): LatLng {
  const n = vertices.length;
  let latSum = 0, lngSum = 0;
  for (const v of vertices) { latSum += v.lat; lngSum += v.lng; }
  return { lat: latSum / n, lng: lngSum / n };
}

export function computeRoofCentroid(vertices: LatLng[]): LatLng {
  return polygonCentroid(vertices);
}

export function signedArea2D(pts: LocalPoint[]): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return area / 2;
}

export function polygonAreaM2(vertices: LatLng[]): number {
  if (vertices.length < 3) return 0;
  const origin = polygonCentroid(vertices);
  const local  = vertices.map(v => latLngToLocal(v, origin));
  return Math.abs(signedArea2D(local));
}

function ensureCCW(pts: LocalPoint[]): LocalPoint[] {
  return signedArea2D(pts) < 0 ? [...pts].reverse() : [...pts];
}

// ─── Internal feet-based polygon signed area ─────────────────────────────────

function signedAreaFeet(pts: LocalFeetPoint[]): number {
  const n = pts.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (pts[j].xFeet + pts[i].xFeet) * (pts[j].yFeet - pts[i].yFeet);
  }
  return area / 2;
}

function ensureCCWFeet(pts: LocalFeetPoint[]): LocalFeetPoint[] {
  return signedAreaFeet(pts) < 0 ? [...pts].reverse() : [...pts];
}

// ─── 2D Rotation (feet) ───────────────────────────────────────────────────────

function rotateFeetPoint(pt: LocalFeetPoint, angle: number): LocalFeetPoint {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    xFeet: pt.xFeet * c - pt.yFeet * s,
    yFeet: pt.xFeet * s + pt.yFeet * c,
  };
}

function rotateFeetPoly(pts: LocalFeetPoint[], angle: number): LocalFeetPoint[] {
  return pts.map(p => rotateFeetPoint(p, angle));
}

// ─── Legacy 2D Rotation (meters — for non-CAD callers) ───────────────────────

export function rotatePoint(pt: LocalPoint, angle: number): LocalPoint {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: pt.x * c - pt.y * s, y: pt.x * s + pt.y * c };
}

// ─── Bounding Box (feet) ─────────────────────────────────────────────────────

interface BBoxFeet {
  minX: number; maxX: number;
  minY: number; maxY: number;
}

function bboxFeet(pts: LocalFeetPoint[]): BBoxFeet {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.xFeet < minX) minX = p.xFeet; if (p.xFeet > maxX) maxX = p.xFeet;
    if (p.yFeet < minY) minY = p.yFeet; if (p.yFeet > maxY) maxY = p.yFeet;
  }
  return { minX, maxX, minY, maxY };
}

// ─── Legacy BBox (meters) ────────────────────────────────────────────────────

interface BBox2D { minX: number; maxX: number; minY: number; maxY: number; }

function bbox2D(pts: LocalPoint[]): BBox2D {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

// ─── Inward Polygon Offset / Setback (feet) ──────────────────────────────────

/**
 * Inward miter offset in feet.
 * Standard CAD setback: moves each vertex along the bisector of its two
 * adjacent inward edge normals.  Works for convex and mildly concave polygons.
 *
 * @param pts   - CCW polygon in local feet
 * @param distFt - inward offset distance in feet (e.g. 1.5 for 18")
 */
export function shrinkPolygonFeet(pts: LocalFeetPoint[], distFt: number): LocalFeetPoint[] {
  if (pts.length < 3 || distFt <= 0) return [...pts];

  const ccw = ensureCCWFeet(pts);
  const n   = ccw.length;

  // Collapse guard: polygon must be wider than 2× setback in both axes
  const bb    = bboxFeet(ccw);
  const origW = bb.maxX - bb.minX;
  const origH = bb.maxY - bb.minY;
  if (origW < distFt * 2 || origH < distFt * 2) return [];

  const result: LocalFeetPoint[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ccw[(i + n - 1) % n];
    const curr = ccw[i];
    const next = ccw[(i + 1) % n];

    const e1x = curr.xFeet - prev.xFeet, e1y = curr.yFeet - prev.yFeet;
    const e2x = next.xFeet - curr.xFeet, e2y = next.yFeet - curr.yFeet;
    const len1 = Math.hypot(e1x, e1y), len2 = Math.hypot(e2x, e2y);

    if (len1 < 1e-9 || len2 < 1e-9) { result.push({ ...curr }); continue; }

    // Inward normal for CCW polygon: right-turn 90° = (ey, -ex) / len
    const n1x = e1y / len1, n1y = -e1x / len1;
    const n2x = e2y / len2, n2y = -e2x / len2;

    const bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);

    if (blen < 1e-9) {
      result.push({ xFeet: curr.xFeet + n1x * distFt, yFeet: curr.yFeet + n1y * distFt });
    } else {
      const bnx = bx / blen, bny = by / blen;
      const dot  = bnx * n1x + bny * n1y;
      // Clamp miter to 3× dist to avoid infinite spikes at acute corners
      const miter = Math.min(distFt / Math.max(dot, 0.1), distFt * 3);
      result.push({ xFeet: curr.xFeet + bnx * miter, yFeet: curr.yFeet + bny * miter });
    }
  }

  // Validation
  const origArea   = Math.abs(signedAreaFeet(ccw));
  const resultArea = signedAreaFeet(result);
  if (Math.abs(resultArea) < 0.01) return [];   // collapsed to nothing
  if (resultArea < 0)               return [];   // inverted (setback too large)
  if (resultArea > origArea * 1.1)  return [];   // expanded (bug guard)

  return result;
}

/**
 * Legacy meters-based shrinkPolygon — kept for backwards compatibility
 * with callers outside the CAD engine (debug overlay, computeRoofAreas, etc.)
 */
export function shrinkPolygon(pts: LocalPoint[], dist: number): LocalPoint[] {
  if (pts.length < 3 || dist <= 0) return [...pts];

  const ccw = ensureCCW(pts);
  const n   = ccw.length;

  const bb      = bbox2D(ccw);
  const origW   = bb.maxX - bb.minX;
  const origH   = bb.maxY - bb.minY;
  if (origW < dist * 2 || origH < dist * 2) return [];

  const result: LocalPoint[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ccw[(i + n - 1) % n];
    const curr = ccw[i];
    const next = ccw[(i + 1) % n];

    const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
    const e2x = next.x - curr.x, e2y = next.y - curr.y;
    const len1 = Math.hypot(e1x, e1y), len2 = Math.hypot(e2x, e2y);

    if (len1 < 1e-9 || len2 < 1e-9) { result.push({ ...curr }); continue; }

    const n1x = e1y / len1, n1y = -e1x / len1;
    const n2x = e2y / len2, n2y = -e2x / len2;

    const bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);

    if (blen < 1e-9) {
      result.push({ x: curr.x + n1x * dist, y: curr.y + n1y * dist });
    } else {
      const bn  = { x: bx / blen, y: by / blen };
      const dot = bn.x * n1x + bn.y * n1y;
      const miter = Math.min(dist / Math.max(dot, 0.1), dist * 3);
      result.push({ x: curr.x + bn.x * miter, y: curr.y + bn.y * miter });
    }
  }

  const origArea   = Math.abs(signedArea2D(ccw));
  const resultArea = signedArea2D(result);
  if (Math.abs(resultArea) < 0.01) return [];
  if (resultArea < 0)               return [];
  if (resultArea > origArea * 1.1)  return [];

  return result;
}

// ─── Point-in-Polygon (feet) ─────────────────────────────────────────────────

function pointInPolygonFeet(pt: LocalFeetPoint, poly: LocalFeetPoint[]): boolean {
  const n = poly.length;
  let inside = false, j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const xi = poly[i].xFeet, yi = poly[i].yFeet;
    const xj = poly[j].xFeet, yj = poly[j].yFeet;
    if (((yi > pt.yFeet) !== (yj > pt.yFeet)) &&
        (pt.xFeet < ((xj - xi) * (pt.yFeet - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/** Legacy meters-based PIP — kept for non-CAD callers. */
export function pointInPolygon2D(pt: LocalPoint, poly: LocalPoint[]): boolean {
  const n = poly.length;
  let inside = false, j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── Longest-Edge Primary Axis Detection ────────────────────────────────────
//
// For a roof polygon defined by lat/lng vertices, find the longest edge and
// return its compass bearing in degrees (0=North, 90=East, 180=South, 270=West).
//
// The bearing is normalised to [0, 180) so that opposite directions (e.g. 10°
// and 190°) map to the same axis.  This gives us the "ridge axis" direction
// regardless of which way the vertices are wound.
//
// Usage:
//   const axisAngle = longestEdgeBearing(plane.vertices);
//   // axisAngle is the compass bearing of the longest edge (0–179.9°)
//
// To get a CAD rotAngle from this axis (same convention as the azimuth-based
// formula `rotAngle = (azimuth-180)*DEG_TO_RAD`):
//   Use computeEdgeAlignedRotAngle(axisAngle, azimuth)

/**
 * Compute compass bearing (degrees, 0=N clockwise) of each polygon edge.
 * Returns the bearing of the LONGEST edge, normalised to [0, 180).
 *
 * @param vertices  - array of {lat, lng} points (any winding)
 * @returns bearing in degrees [0, 180), or 90 (east-west) as fallback
 */
export function longestEdgeBearing(
  vertices: { lat: number; lng: number }[]
): number {
  if (vertices.length < 2) return 90;

  const cosLat = Math.cos((vertices.reduce((s, v) => s + v.lat, 0) / vertices.length) * DEG_TO_RAD);
  const MLAT   = 111320; // metres per degree latitude

  let longestLen = -1;
  let bestBearing = 90;

  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    // Convert edge to local metres (east = +x, north = +y)
    const dx = (b.lng - a.lng) * cosLat * MLAT;
    const dy = (b.lat - a.lat) * MLAT;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    // Compass bearing: 0=North, clockwise
    // atan2(east, north) gives bearing from north, clockwise
    let bearing = Math.atan2(dx, dy) / DEG_TO_RAD;  // -180 to +180

    // Normalise to [0, 180) — treat opposite directions as same axis
    bearing = ((bearing % 180) + 180) % 180;

    if (len > longestLen) {
      longestLen = len;
      bestBearing = bearing;
    }
  }

  return bestBearing;
}

/**
 * Compute CAD rotAngle (radians) that aligns the grid to the longest roof edge,
 * while preserving the up-slope direction defined by `azimuth`.
 *
 * Strategy:
 *   1. The longest edge defines the ridge axis (bearing in [0,180)).
 *   2. The ridge axis is perpendicular to the slope direction (azimuth).
 *   3. We snap the edge bearing to the nearest axis consistent with the azimuth:
 *      - azimuth defines slope direction; ridge = azimuth ± 90°
 *      - Pick the edge-axis candidate closest to (azimuth - 90) mod 180
 *   4. rotAngle is then computed so +Y = up-slope (same formula as azimuth path).
 *
 * @param edgeBearingDeg  - longest edge bearing [0,180) from longestEdgeBearing()
 * @param azimuthDeg      - roof azimuth (down-slope compass direction, 0–360)
 * @returns rotAngle in radians for rotateFeetPoly()
 */
export function computeEdgeAlignedRotAngle(
  edgeBearingDeg: number,
  azimuthDeg: number
): number {
  // Ridge axis from azimuth = azimuth - 90 (normalised to [0,180))
  const ridgeFromAz = ((azimuthDeg - 90) % 180 + 180) % 180;

  // The edge bearing and its 90° twin are both valid ridge candidates
  const candidate1 = edgeBearingDeg;
  const candidate2 = (edgeBearingDeg + 90) % 180;

  // Angular distance helper (circular, [0,90])
  const angDist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 180;
    return d > 90 ? 180 - d : d;
  };

  // Pick candidate closest to ridge direction from azimuth
  const d1 = angDist(candidate1, ridgeFromAz);
  const d2 = angDist(candidate2, ridgeFromAz);
  const ridgeAxisDeg = d1 <= d2 ? candidate1 : candidate2;

  // Derive effective azimuth: slope direction = ridge + 90, pick the one
  // closest to the original azimuth (within 90°)
  let effectiveAz = (ridgeAxisDeg + 90) % 360;
  // Check if 180° flip is closer to original azimuth
  const alt = (effectiveAz + 180) % 360;
  const diff1 = Math.abs(((effectiveAz - azimuthDeg + 540) % 360) - 180);
  const diff2 = Math.abs(((alt        - azimuthDeg + 540) % 360) - 180);
  if (diff2 < diff1) effectiveAz = alt;

  // Same formula as original: rotAngle = (effectiveAz - 180) * DEG_TO_RAD
  return (effectiveAz - 180) * DEG_TO_RAD;
}


// ─── CAD Panel Grid Parameters ───────────────────────────────────────────────

export interface CADPanelGridParams {
  layoutId:      string;
  roofPlane:     RoofPlane;
  panel:         SolarPanel;
  /** Uniform edge setback in meters (legacy — used when per-edge setbacks not provided) */
  setbackM:      number;
  /** Panel-to-panel gap within a row (meters) */
  panelSpacingM: number;
  /** Row-to-row gap (tilt/shadow gap, meters) */
  rowSpacingM:   number;
  tilt:          number;
  azimuth:       number;
  orientation?:  'portrait' | 'landscape';
  pathwayWidthM?: number;
  enforcePathway?: boolean;
  /** Per-edge setbacks (override setbackM when provided) */
  eaveSetbackM?:  number;   // bottom / gutter edge (default: 0)
  ridgeSetbackM?: number;   // top / ridge edge (default: same as setbackM)
  sideSetbackM?:  number;   // left and right rake/gable edges (default: same as setbackM)
  /**
   * v47.118: Align grid to longest roof edge instead of pure azimuth.
   * When true, uses roofPlane.roofEdgeAngleDeg (pre-computed by longestEdgeBearing)
   * to derive rotAngle. Falls back to azimuth if roofEdgeAngleDeg is not set.
   */
  alignToEdge?:   boolean;
}

// ─── CAD Panel Grid Generator (LECS — feet internally) ───────────────────────

/**
 * Generate a full rectangular panel grid and clip it against the usable polygon.
 *
 * ALL internal geometry is in FEET via LECS.
 * Input setback/spacing params are in meters (from existing UI) and are
 * converted to feet at the top of this function.
 * Output PlacedPanel has: lat/lng (for map), xFeet/yFeet (LECS),
 * xMeters/yMeters (legacy), widthFeet/heightFeet (CAD panel dims).
 *
 * Coordinate frame in the rotated grid space:
 *   +X = along ridge (eave direction, perpendicular to slope)
 *   +Y = up the slope (azimuth direction)
 *
 * Grid rules:
 *   1. panelX (feet) = dimension along ridge (X).  Portrait: width. Landscape: height.
 *   2. panelY (feet) = dimension up slope  (Y).  Portrait: height. Landscape: width.
 *   3. stepX = panelX + panelSpacingFt  (along ridge = column step)
 *   4. stepY = panelY + rowSpacingFt    (up slope    = row step)
 *   5. Outer loop: rowY  — rows run left→right across ridge (same rowY = same geographic row)
 *   6. Inner loop: colX  — columns run bottom→top up slope
 *   7. All 4 corners of each panel must be inside usable polygon (strict containment).
 *   8. Accepted panels are rotated back to local feet → lat/lng.
 */
export function generatePanelGridCAD(params: CADPanelGridParams): PlacedPanel[] {
  const {
    layoutId, roofPlane, panel, setbackM, panelSpacingM, rowSpacingM,
    tilt, azimuth,
  } = params;
  const orientation = params.orientation ?? 'portrait';

  if (roofPlane.vertices.length < 3) return [];

  // ── 1. Establish LECS origin (centroid) ──────────────────────────────────
  // Use persistent centroid stored on roofPlane — computed ONCE at plane creation.
  const originLat = roofPlane.centroidLat  ?? roofPlane.vertices.reduce((s, v) => s + v.lat, 0) / roofPlane.vertices.length;
  const originLng = roofPlane.centroidLng  ?? roofPlane.vertices.reduce((s, v) => s + v.lng, 0) / roofPlane.vertices.length;

  // ── 2. Project vertices to local feet (centroid = 0,0) ───────────────────
  const localFeetVerts: LocalFeetPoint[] = roofPlane.vertices.map(v =>
    latLngToLocalFeet(v.lat, v.lng, originLat, originLng)
  );

  // ── 3. Convert meter params → feet ───────────────────────────────────────
  const panelSpacingFt = panelSpacingM * FEET_PER_METER;
  const rowSpacingFt   = rowSpacingM   * FEET_PER_METER;

  // ── 3b. Per-edge setbacks (v47.111) ──────────────────────────────────────────
  // Per-edge setbacks override the legacy uniform setbackM:
  //   eave (bottom/gutter):  0"  -- IRC does not require eave clearance
  //   ridge (top):          18"  -- IRC R324.4.1
  //   side (rake/gable):    18"  -- IRC R324.4.1
  // These are applied as bbox adjustments AFTER rotation so each edge is
  // handled independently without distorting the polygon shape.
  const sideSetbackFt  = (params.sideSetbackM  ?? setbackM) * FEET_PER_METER;
  const ridgeSetbackFt = (params.ridgeSetbackM ?? setbackM) * FEET_PER_METER;
  const eaveSetbackFt  = (params.eaveSetbackM  ?? 0)        * FEET_PER_METER;

  // ── 4. Ensure CCW polygon for containment test ─────────────────────────────
  // We do NOT shrink the polygon here. All setbacks (eave, ridge, side) are
  // applied as pure bbox adjustments in step 8b. Using the full polygon for
  // the containment test means the roof edge clips panels naturally, and
  // the per-edge setbacks strictly control the grid start/stop bounds.
  // shrinkPolygonFeet() shrinks ALL edges uniformly -- applying it with
  // sideSetbackFt would incorrectly shrink the eave edge by 18" even when
  // eaveSetbackM=0, floating the bottom row off the gutter.
  const usableVerts = ensureCCWFeet(localFeetVerts);
  if (usableVerts.length < 3) return [];

  // ── 5. Panel dimensions in LECS feet ─────────────────────────────────────
  //   Portrait:  panelX = width  (1.134m = 3.72ft)  — along ridge
  //              panelY = height (1.763m = 5.79ft)  — up slope
  //   Landscape: panelX = height (5.79ft)            — along ridge
  //              panelY = width  (3.72ft)             — up slope
  // Portrait = panel appears TALL ON SCREEN (long axis vertical).
  // Landscape = panel appears WIDE ON SCREEN (long axis horizontal).
  //
  // For az=180/0 (south/north): ridge is E-W (horizontal), up-slope is N-S (vertical).
  //   Portrait  = long axis N-S (up slope) = tall on screen ✓ → panelX=width(narrow), panelY=height(tall)
  //   Landscape = long axis E-W (along ridge) = wide on screen ✓ → panelX=height(wide), panelY=width(short)
  //
  // For az=90/270 (east/west): ridge is N-S (vertical), up-slope is E-W (horizontal).
  //   If we use same assignment: long axis goes E-W (horizontal) = WIDE on screen = looks landscape!
  //   Fix: when ridge is N-S, swap panelXFt/panelYFt so portrait stays tall on screen.
  //   Portrait  → panelX=height(wide, N-S ridge), panelY=width(short, E-W slope) = tall N-S on screen ✓
  //   Landscape → panelX=width(narrow, N-S ridge), panelY=height(tall, E-W slope) = wide E-W on screen ✓
  //
  // ridgeIsNS: ridge direction = az-90. Ridge is N-S when |cos(az)| < |sin(az)|.
  //   az=180: cos(180)=-1, sin(180)=0  → |cos|=1 > |sin|=0 → NOT N-S → no swap ✓
  //   az=90:  cos(90)=0,  sin(90)=1   → |cos|=0 < |sin|=1 → IS N-S  → swap ✓
  //   az=270: cos(270)=0, sin(270)=-1 → |cos|=0 < |sin|=1 → IS N-S  → swap ✓
  const ridgeIsNS = Math.abs(Math.cos(azimuth * DEG_TO_RAD)) < Math.abs(Math.sin(azimuth * DEG_TO_RAD));

  const panelXFt = ridgeIsNS
    ? (orientation === 'portrait' ? panel.height * FEET_PER_METER : panel.width  * FEET_PER_METER)
    : (orientation === 'portrait' ? panel.width  * FEET_PER_METER : panel.height * FEET_PER_METER);
  const panelYFt = ridgeIsNS
    ? (orientation === 'portrait' ? panel.width  * FEET_PER_METER : panel.height * FEET_PER_METER)
    : (orientation === 'portrait' ? panel.height * FEET_PER_METER : panel.width  * FEET_PER_METER);

  // ── 6. Grid step sizes (feet) ─────────────────────────────────────────────
  const stepXFt  = panelXFt + panelSpacingFt;  // along-ridge step
  const stepYFt  = panelYFt + rowSpacingFt;    // up-slope step
  const halfPXFt = panelXFt / 2;
  const halfPYFt = panelYFt / 2;

  // ── DIMENSION AUDIT LOG (v47.110) ───────────────────────────────────────────
  console.log('[CAD_DIMS]', {
    module:      `${(panel as any).manufacturer ?? ''} ${(panel as any).model ?? ''} (${panel.wattage ?? '?'}W)`,
    moduleId:    (panel as any).id ?? 'unknown',
    rawWidthM:   panel.width,
    rawHeightM:  panel.height,
    rawWidthIn:  (panel.width  * 39.3701).toFixed(1) + '"',
    rawHeightIn: (panel.height * 39.3701).toFixed(1) + '"',
    orientation,
    azimuth,
    ridgeIsNS,
    panelXFt_alongRidge: panelXFt.toFixed(3) + 'ft (' + (panelXFt * 12).toFixed(1) + '")',
    panelYFt_upSlope:    panelYFt.toFixed(3) + 'ft (' + (panelYFt * 12).toFixed(1) + '")',
    stepXFt: stepXFt.toFixed(3) + 'ft',
    stepYFt: stepYFt.toFixed(3) + 'ft',
    eaveSetback:  eaveSetbackFt.toFixed(2) + 'ft (' + (eaveSetbackFt * 12).toFixed(0) + '")',
    ridgeSetback: ridgeSetbackFt.toFixed(2) + 'ft (' + (ridgeSetbackFt * 12).toFixed(0) + '")',
    sideSetback:  sideSetbackFt.toFixed(2) + 'ft (' + (sideSetbackFt * 12).toFixed(0) + '")',
  });

  // ── 7. Rotate usable polygon to azimuth-aligned frame ────────────────────
  //   rotAngle = (azimuth − 180) × π/180
  //   CAD frame: +X = along ridge (left→right), +Y = up slope (eave→ridge)
  //   LECS: +X = East, +Y = North
  //   azimuth=180 (south): rotAngle =   0° → +X=East(ridge),  +Y=North(up-slope) ✓
  //   azimuth=90  (east):  rotAngle = −90° → +X=North(ridge), +Y=West(up-slope) ✓
  //   azimuth=270 (west):  rotAngle = +90° → +X=South(ridge), +Y=East(up-slope) ✓
  //   azimuth=0   (north): rotAngle = −180° → +X=West(ridge), +Y=South(up-slope) ✓
  // ── 7. Compute rotAngle: azimuth-based OR longest-edge-aligned (v47.118) ────
  // Default: rotAngle = (azimuth - 180) * DEG_TO_RAD  (pure azimuth alignment)
  // When alignToEdge=true AND roofPlane.roofEdgeAngleDeg is set:
  //   Use computeEdgeAlignedRotAngle() to snap grid to actual roof polygon edge.
  //   This ensures panels align to the physical roof edge, not just the typed azimuth.
  let rotAngle: number;
  if (params.alignToEdge && roofPlane.roofEdgeAngleDeg !== undefined) {
    rotAngle = computeEdgeAlignedRotAngle(roofPlane.roofEdgeAngleDeg, azimuth);
    console.log('[CAD_EDGE_ALIGN]', {
      planeId:          roofPlane.id,
      roofEdgeAngleDeg: roofPlane.roofEdgeAngleDeg.toFixed(2),
      azimuth,
      rotAngleDeg:      (rotAngle / DEG_TO_RAD).toFixed(2),
    });
  } else {
    rotAngle = (azimuth - 180) * DEG_TO_RAD;
  }
  const rotatedVerts   = rotateFeetPoly(usableVerts, rotAngle);
  const bb             = bboxFeet(rotatedVerts);

  // ── 8. Grid origin = full bbox (no pre-shrink) ──────────────────────────────────
  // Grid sweeps the FULL rotated bounding box. Setbacks are applied as a
  // post-generation panel filter (step 9) -- NOT as geometry restrictions.
  // This ensures every possible panel position is evaluated before any
  // constraint is applied, matching real-world install capability.
  const gridOriginX = bb.minX;
  const gridOriginY = bb.minY;
  const gridEndX    = bb.maxX;
  const gridEndY    = bb.maxY;

  // ── 8b. Setback zone definitions (post-generation filter) ─────────────────────────
  // A panel is REJECTED if its center falls inside a setback zone.
  // Using center-based zone test: panel is in setback zone if its
  // bottom edge (rowY) is in the eave zone, top edge in ridge zone, etc.
  //
  //   Ridge zone:  panel top edge (rowY + panelYFt) > bb.maxY - ridgeSetbackFt
  //   Eave zone:   panel bottom edge (rowY) < bb.minY + eaveSetbackFt  [only if eaveSetbackFt > 0]
  //   Left zone:   panel left edge (colX) < bb.minX + sideSetbackFt
  //   Right zone:  panel right edge (colX + panelXFt) > bb.maxX - sideSetbackFt
  //
  // These are exact edge tests -- no polygon shrink, no bbox restriction.
  const ridgeZoneY = bb.maxY - ridgeSetbackFt;   // panels must have top edge <= this
  const eaveZoneY  = bb.minY + eaveSetbackFt;    // panels must have bottom edge >= this (0 = no eave setback)
  const leftZoneX  = bb.minX + sideSetbackFt;    // panels must have left edge >= this
  const rightZoneX = bb.maxX - sideSetbackFt;    // panels must have right edge <= this

  // ── 8c. Usable area debug log ───────────────────────────────────────────────
  const roofHeightFt   = bb.maxY - bb.minY;
  const usableHeightFt = ridgeZoneY - eaveZoneY;
  const expectedRows   = Math.floor((usableHeightFt + 1e-9) / stepYFt);
  console.log('[CAD_ROWS]', {
    orientation,
    azimuth,
    roofHeightFt:   roofHeightFt.toFixed(3)   + 'ft (' + (roofHeightFt   / FEET_PER_METER).toFixed(2) + 'm)',
    usableHeightFt: usableHeightFt.toFixed(3)  + 'ft (' + (usableHeightFt / FEET_PER_METER).toFixed(2) + 'm)',
    panelHeightFt:  panelYFt.toFixed(3)        + 'ft (' + (panelYFt       / FEET_PER_METER).toFixed(2) + 'm)',
    stepYFt:        stepYFt.toFixed(3)         + 'ft',
    expectedRows,
    eaveSetback_in:  (eaveSetbackFt  * 12).toFixed(0) + '"',
    ridgeSetback_in: (ridgeSetbackFt * 12).toFixed(0) + '"',
    sideSetback_in:  (sideSetbackFt  * 12).toFixed(0) + '"',
  });
  if (roofHeightFt / FEET_PER_METER > 5.0 && expectedRows < 2) {
    console.warn('[CAD_ROWS] WARNING: roof', (roofHeightFt/FEET_PER_METER).toFixed(1),
      'm > 5m but only', expectedRows, 'rows expected.',
      'usableH=' + usableHeightFt.toFixed(2) + 'ft panelH=' + panelYFt.toFixed(2) + 'ft');
  }

  // ── 9. Sweep full grid, apply roof-polygon + setback-zone filter per panel ────────
  // Grid sweeps the FULL bbox. Setback zones and polygon PIP filter each panel.
  // gridRow/gridCol track only PLACED rows/cols for the panel .row/.col fields.
  const panels: PlacedPanel[] = [];
  let placedRow = 0;  // row index for placed panels only

  for (
    let rowY = gridOriginY;
    rowY + panelYFt <= gridEndY + 1e-9;
    rowY += stepYFt
  ) {
    // ── Row-level setback zone filter ────────────────────────────────────────
    // Ridge: panel top edge must not exceed ridgeZoneY
    if (rowY + panelYFt > ridgeZoneY + 1e-9) break;  // all higher rows also violate
    // Eave: panel bottom edge must be >= eaveZoneY (skip rows below eave setback)
    if (eaveSetbackFt > 0 && rowY < eaveZoneY - 1e-9) continue;

    const centerY = rowY + halfPYFt;
    let placedCol = 0;  // col index for placed panels only
    let rowHasAny = false;

    for (
      let colX = gridOriginX;
      colX + panelXFt <= gridEndX + 1e-9;
      colX += stepXFt
    ) {
      // ── Col-level setback zone filter (side setbacks) ────────────────────
      if (colX < leftZoneX - 1e-9) continue;   // left side setback
      if (colX + panelXFt > rightZoneX + 1e-9) break;  // right side setback

      const centerX = colX + halfPXFt;

      // ── Roof polygon containment test (with 1mm epsilon inset) ────────────────
      const EPS = 0.003;  // ~1mm in feet
      const BL: LocalFeetPoint = { xFeet: centerX - halfPXFt + EPS, yFeet: centerY - halfPYFt + EPS };
      const BR: LocalFeetPoint = { xFeet: centerX + halfPXFt - EPS, yFeet: centerY - halfPYFt + EPS };
      const TR: LocalFeetPoint = { xFeet: centerX + halfPXFt - EPS, yFeet: centerY + halfPYFt - EPS };
      const TL: LocalFeetPoint = { xFeet: centerX - halfPXFt + EPS, yFeet: centerY + halfPYFt - EPS };

      if (
        !pointInPolygonFeet(BL, rotatedVerts) ||
        !pointInPolygonFeet(BR, rotatedVerts) ||
        !pointInPolygonFeet(TR, rotatedVerts) ||
        !pointInPolygonFeet(TL, rotatedVerts)
      ) { continue; }

      // ── Rotate center back to local feet (centroid-relative) ──────────────
      const localFeetCenter = rotateFeetPoint({ xFeet: centerX, yFeet: centerY }, -rotAngle);

      // ── Convert to lat/lng ─────────────────────────────────────────────────
      const _rawLL = localFeetToLatLng(
        localFeetCenter.xFeet,
        localFeetCenter.yFeet,
        originLat,
        originLng
      );
      // Round to 7 decimal places (~1.1cm precision) to eliminate floating-point jitter
      const lat = Math.round(_rawLL.lat * 1e7) / 1e7;
      const lng = Math.round(_rawLL.lng * 1e7) / 1e7;

      // ── Legacy metric offsets (for permit planset and debug overlay) ───────
      // Round to 4 decimal places (~0.1mm) to eliminate accumulation jitter
      const xMeters = Math.round(localFeetCenter.xFeet * METERS_PER_FOOT * 1e4) / 1e4;
      const yMeters = Math.round(localFeetCenter.yFeet * METERS_PER_FOOT * 1e4) / 1e4;

      panels.push({
        id:           uuidv4(),
        layoutId,
        lat,
        lng,
        x:            xMeters,
        y:            yMeters,
        xMeters,
        yMeters,
        xFeet:        localFeetCenter.xFeet,
        yFeet:        localFeetCenter.yFeet,
        widthFeet:    panelXFt,
        heightFeet:   panelYFt,
        tilt,
        azimuth,
        wattage:      panel.wattage,
        bifacialGain: panel.bifacialFactor,
        row:          placedRow,
        col:          placedCol,
        orientation,
        layoutSource:  'AUTO',
        placementType: 'ROOF',
        systemType:    'roof',
      });

      placedCol++;
      rowHasAny = true;
    }

    if (rowHasAny) placedRow++;
  }

  // ── DIAGNOSTIC LOG ──────────────────────────────────────────────────────────
  if (panels.length > 0) {
    console.log('[CAD-LECS] generatePanelGridCAD', {
      layoutId,
      panelCount:   panels.length,
      origin_lat:   originLat,
      origin_lng:   originLng,
      rotAngleDeg:  rotAngle / DEG_TO_RAD,
      panelXFt:     panelXFt.toFixed(3),
      panelYFt:     panelYFt.toFixed(3),
      sideSetbackFt: sideSetbackFt.toFixed(3), ridgeSetbackFt: ridgeSetbackFt.toFixed(3), eaveSetbackFt: eaveSetbackFt.toFixed(3),
      leftZoneX: leftZoneX.toFixed(3), rightZoneX: rightZoneX.toFixed(3),
      eaveZoneY: eaveZoneY.toFixed(3), ridgeZoneY: ridgeZoneY.toFixed(3),
      first3: panels.slice(0, 3).map(p => ({
        row: p.row, col: p.col,
        lat: p.lat, lng: p.lng,
        xFeet: p.xFeet?.toFixed(3), yFeet: p.yFeet?.toFixed(3),
      })),
    });
  } else {
    console.log('[CAD-LECS] generatePanelGridCAD: NO panels placed', {
      layoutId,
      usableVertCount: usableVerts.length,
      bbWft: (bb.maxX - bb.minX).toFixed(2),
      bbHft: (bb.maxY - bb.minY).toFixed(2),
      panelXFt: panelXFt.toFixed(3),
      panelYFt: panelYFt.toFixed(3),
      sideSetbackFt: sideSetbackFt.toFixed(3),
    });
  }

  return panels;
}

// ─── Usable Area Calculation ─────────────────────────────────────────────────

export function computeRoofAreas(
  vertices: LatLng[],
  setbackM: number
): { totalAreaM2: number; usableAreaM2: number; usableVertices: LocalPoint[] } {
  const totalAreaM2 = polygonAreaM2(vertices);
  if (vertices.length < 3 || setbackM <= 0) {
    const origin = polygonCentroid(vertices);
    const local  = vertices.map(v => latLngToLocal(v, origin));
    return { totalAreaM2, usableAreaM2: totalAreaM2, usableVertices: local };
  }

  const origin      = polygonCentroid(vertices);
  const localVerts  = vertices.map(v => latLngToLocal(v, origin));
  const usableVerts = shrinkPolygon(localVerts, setbackM);
  const usableAreaM2 = usableVerts.length >= 3
    ? Math.abs(signedArea2D(usableVerts))
    : 0;

  return { totalAreaM2, usableAreaM2, usableVertices: usableVerts };
}

// ─── RoofPlane LECS Enrichment ───────────────────────────────────────────────

/**
 * Compute and attach LECS (feet) local coordinates to a RoofPlane.
 * Call once when a plane is created.  Stores:
 *   - centroidLat / centroidLng (persistent origin)
 *   - verticesLocal  (feet relative to centroid)
 *   - centroidLocal  (always {0,0} — stored for explicitness)
 */
export function enrichRoofPlaneWithLECS(plane: RoofPlane): RoofPlane {
  const centroid = polygonCentroidLatLng(plane.vertices);
  const verticesLocal = plane.vertices.map(v =>
    latLngToLocalFeet(v.lat, v.lng, centroid.lat, centroid.lng)
  );
  // v47.118: Compute primary axis (longest edge bearing) ONCE at plane creation.
  // Stored on the plane so generatePanelGridCAD can use it when alignToEdge=true.
  const roofEdgeAngleDeg = longestEdgeBearing(plane.vertices);
  return {
    ...plane,
    centroidLat:       centroid.lat,
    centroidLng:       centroid.lng,
    verticesLocal,
    centroidLocal:     { xFeet: 0, yFeet: 0 },
    roofEdgeAngleDeg,  // bearing of longest edge [0, 180)
  };
}