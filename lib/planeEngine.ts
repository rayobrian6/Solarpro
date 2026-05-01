/**
 * planeEngine.ts — v47.130: Unified PlaneFrame Placement Engine
 *
 * THE ONE FORMULA for every panel on every surface:
 *
 *   worldPos = origin + u * uOffset + v * vOffset + normal * PANEL_OFFSET
 *
 * where:
 *   origin  = ECEF anchor point (above surface)
 *   u       = ECEF unit vector along the panel columns (horizontal sweep)
 *   v       = ECEF unit vector along the panel rows (vertical sweep)
 *   normal  = ECEF outward unit normal of the surface
 *
 * Rules:
 *   - NO metersPerDeg anywhere
 *   - NO lat/lng inside loops
 *   - NO post-placement adjustments
 *   - ecefToLatLng() called ONLY at final output per panel
 *   - Boundary containment tested in plane-local UV before world conversion
 */

import { v4 as uuidv4 } from 'uuid';
import { ecefToLatLng, latLngToECEF } from '@/lib/roofPlane3D';
import type { PlacedPanel } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEG           = Math.PI / 180;
export const PANEL_OFFSET_M = 0.05; // meters above surface — prevents z-fighting

// Standard 400W panel physical dimensions (meters)
export const PW_PORTRAIT   = 1.134;
export const PH_PORTRAIT   = 1.722;
export const PW_LANDSCAPE  = 1.722;
export const PH_LANDSCAPE  = 1.134;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Vec3 { x: number; y: number; z: number; }

/**
 * PlaneFrame — the complete coordinate system for a surface.
 * All vectors are ECEF unit vectors.
 * origin is an ECEF point above the surface (already has surface offset applied).
 */
export interface PlaneFrame {
  origin: Vec3;   // ECEF anchor (above surface, at panel base elevation)
  u:      Vec3;   // ECEF unit vector: sweep direction (along columns)
  v:      Vec3;   // ECEF unit vector: row direction (perpendicular to u, in plane)
  normal: Vec3;   // ECEF outward unit normal
}

export interface PanelDims {
  widthM:  number;  // panel width  (u-direction)
  heightM: number;  // panel height (v-direction)
}

export interface GridSpacing {
  colSpacingM: number;  // gap between panels in u direction
  rowSpacingM: number;  // gap between rows in v direction
}

export interface Setbacks {
  eaveM:  number;
  ridgeM: number;
  sideM:  number;
}

export interface UVPoint { u: number; v: number; }

// ─── Vector math ──────────────────────────────────────────────────────────────

export function vec3(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function mag3(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
export function normalize3(v: Vec3): Vec3 {
  const m = mag3(v);
  if (m < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

// ─── ENU ↔ ECEF ───────────────────────────────────────────────────────────────

export function enuBasisECEF(lat: number, lng: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const latR = lat * DEG, lngR = lng * DEG;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const sinLng = Math.sin(lngR), cosLng = Math.cos(lngR);
  return {
    east:  { x: -sinLng,              y:  cosLng,              z: 0       },
    north: { x: -sinLat * cosLng,     y: -sinLat * sinLng,     z: cosLat  },
    up:    { x:  cosLat * cosLng,     y:  cosLat * sinLng,     z: sinLat  },
  };
}

export function enuToECEF(enu: Vec3, basis: { east: Vec3; north: Vec3; up: Vec3 }): Vec3 {
  return {
    x: enu.x * basis.east.x + enu.y * basis.north.x + enu.z * basis.up.x,
    y: enu.x * basis.east.y + enu.y * basis.north.y + enu.z * basis.up.y,
    z: enu.x * basis.east.z + enu.y * basis.north.z + enu.z * basis.up.z,
  };
}

// ─── THE ONE FORMULA ─────────────────────────────────────────────────────────

/**
 * Compute ECEF world position for a panel at (uOffset, vOffset) in plane-local space.
 * PANEL_OFFSET_M is added along the normal to prevent z-fighting.
 */
export function panelToWorld(frame: PlaneFrame, uOffset: number, vOffset: number): Vec3 {
  return {
    x: frame.origin.x + frame.u.x * uOffset + frame.v.x * vOffset + frame.normal.x * PANEL_OFFSET_M,
    y: frame.origin.y + frame.u.y * uOffset + frame.v.y * vOffset + frame.normal.y * PANEL_OFFSET_M,
    z: frame.origin.z + frame.u.z * uOffset + frame.v.z * vOffset + frame.normal.z * PANEL_OFFSET_M,
  };
}

// ─── PlaneFrame constructors ──────────────────────────────────────────────────

/**
 * Build a PlaneFrame from two ECEF points defining the u-axis direction.
 *
 * Used for: fence (tilt=90), row tool, ground array row.
 *
 * @param p1       ECEF start point (already at surface height)
 * @param p2       ECEF end point   (already at surface height)
 * @param tiltDeg  Surface tilt in degrees (0=flat, 90=vertical)
 *
 * Frame construction:
 *   u = normalize(p2 - p1)               — along the line (column sweep direction)
 *   up_ecef = normalize(p1)              — radial outward = "up" at this location
 *   horizontal = normalize(cross(radialUp, u))  — outward-facing perpendicular to u
 *   normal = radialUp*cos(tilt) + horizontal*sin(tilt)
 *   v = cross(n, u) normalized           — in-plane row direction
 *   origin = p1 + normal * PANEL_OFFSET_M (lift above surface)
 */
export function buildPlaneFromTwoPoints(
  p1:         Vec3,
  p2:         Vec3,
  tiltDeg:    number,
): PlaneFrame {
  // u: along the line
  const u = normalize3(sub3(p2, p1));

  // radialUp at p1: outward from Earth center
  const radialUp = normalize3(p1);

  const tiltRad = tiltDeg * DEG;
  const hRaw    = cross3(radialUp, u);       // horizontal outward direction
  const hMag    = mag3(hRaw);
  const horizontal = hMag > 1e-9 ? scale3(hRaw, 1 / hMag) : normalize3(cross3({ x: 0, y: 0, z: 1 }, u));

  const normal = normalize3({
    x: radialUp.x * Math.cos(tiltRad) + horizontal.x * Math.sin(tiltRad),
    y: radialUp.y * Math.cos(tiltRad) + horizontal.y * Math.sin(tiltRad),
    z: radialUp.z * Math.cos(tiltRad) + horizontal.z * Math.sin(tiltRad),
  });

  // v: perpendicular to both u and normal, pointing "uphill" along the tilted panel face.
  // normalize(cross(normal, u)) can point either up-slope or down-slope depending on the
  // orientation of u. We always want v to have a positive radialUp component (panel fills
  // from bottom edge to top edge going away from Earth center), so flip if needed.
  const vRaw = normalize3(cross3(normal, u));
  const vUpDot = vRaw.x * radialUp.x + vRaw.y * radialUp.y + vRaw.z * radialUp.z;
  const v: Vec3 = vUpDot >= 0 ? vRaw : { x: -vRaw.x, y: -vRaw.y, z: -vRaw.z };

  // Origin: lift p1 above surface along normal
  const origin: Vec3 = {
    x: p1.x + normal.x * PANEL_OFFSET_M,
    y: p1.y + normal.y * PANEL_OFFSET_M,
    z: p1.z + normal.z * PANEL_OFFSET_M,
  };

  return { origin, u, v, normal };
}

/**
 * Build a PlaneFrame from azimuth + tilt + centroid lat/lng + height.
 *
 * Used for: legacy 2D roof planes (no 3D point picking).
 *
 * Frame construction via ENU:
 *   ENU surface frame (u=along-ridge, v=up-slope, n=outward) → rotated to ECEF
 *   Origin = centroid ECEF at planeHeight + PANEL_OFFSET_M
 */
export function buildPlaneFromAzimuthTilt(
  lat:        number,
  lng:        number,
  heightM:    number,   // height above WGS84 ellipsoid (already above ground)
  azimuthDeg: number,
  tiltDeg:    number,
): PlaneFrame {
  const basis = enuBasisECEF(lat, lng);

  // ENU surface frame (same as computeSurfaceFrame3D but inline)
  const az   = azimuthDeg * DEG;
  const tilt = tiltDeg * DEG;
  const sinAz = Math.sin(az), cosAz = Math.cos(az);
  const sinT  = Math.sin(tilt), cosT = Math.cos(tilt);

  // ENU normal: outward from tilted surface
  const nENU: Vec3 = normalize3({ x: sinAz * sinT, y: cosAz * sinT, z: cosT });
  // ENU v (up-slope): toward the peak
  const vENU: Vec3 = normalize3({ x: -sinAz * cosT, y: -cosAz * cosT, z: sinT });
  // ENU u (along ridge): n × v
  const uENU: Vec3 = normalize3(cross3(nENU, vENU));

  // Rotate to ECEF
  const u      = normalize3(enuToECEF(uENU, basis));
  const v      = normalize3(enuToECEF(vENU, basis));
  const normal = normalize3(enuToECEF(nENU, basis));

  // Ensure outward normal (dot with radial up should be > 0)
  const centECEF = latLngToECEF(lat, lng, heightM);
  const radialUp = normalize3(centECEF);
  const finalNormal = dot3(normal, radialUp) < 0 ? scale3(normal, -1) : normal;

  const origin: Vec3 = {
    x: centECEF.x + finalNormal.x * PANEL_OFFSET_M,
    y: centECEF.y + finalNormal.y * PANEL_OFFSET_M,
    z: centECEF.z + finalNormal.z * PANEL_OFFSET_M,
  };

  return { origin, u, v: normalize3(cross3(finalNormal, u)), normal: finalNormal };
}

/**
 * Build a PlaneFrame from an array of ECEF polygon points (3D plane tool).
 * Uses the stored origin3D + ecefFrame3D if available, otherwise computes from points.
 */
export function buildPlaneFromECEFPoints(
  pts: Vec3[],
  heightOffsetM = PANEL_OFFSET_M,
): PlaneFrame {
  if (pts.length < 3) throw new Error('buildPlaneFromECEFPoints: need >= 3 points');

  // Compute centroid
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const centroid = { x: cx, y: cy, z: cz };

  // Normal via Newell's method
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  let normal = normalize3({ x: nx, y: ny, z: nz });

  // Ensure outward (dot with radial up > 0)
  const radialUp = normalize3(centroid);
  if (dot3(normal, radialUp) < 0) normal = scale3(normal, -1);

  // u: longest edge of polygon
  let bestU: Vec3 = { x: 1, y: 0, z: 0 };
  let bestLen = 0;
  for (let i = 0; i < pts.length; i++) {
    const edge = sub3(pts[(i + 1) % pts.length], pts[i]);
    const len = mag3(edge);
    if (len > bestLen) { bestLen = len; bestU = normalize3(edge); }
  }

  // Re-orthogonalize u against normal
  const u = normalize3(sub3(bestU, scale3(normal, dot3(bestU, normal))));
  const v = normalize3(cross3(normal, u));

  const origin: Vec3 = {
    x: centroid.x + normal.x * heightOffsetM,
    y: centroid.y + normal.y * heightOffsetM,
    z: centroid.z + normal.z * heightOffsetM,
  };

  return { origin, u, v, normal };
}

// ─── Panel dimensions ─────────────────────────────────────────────────────────

export function getPanelDims(orientation: 'portrait' | 'landscape'): PanelDims {
  return orientation === 'landscape'
    ? { widthM: PW_LANDSCAPE, heightM: PH_LANDSCAPE }
    : { widthM: PW_PORTRAIT,  heightM: PH_PORTRAIT  };
}

// ─── UV projection ────────────────────────────────────────────────────────────

export function projectToUV(pts: Vec3[], frame: PlaneFrame): UVPoint[] {
  return pts.map(p => {
    const d = sub3(p, frame.origin);
    return { u: dot3(d, frame.u), v: dot3(d, frame.v) };
  });
}

// ─── Point-in-polygon (UV space) ─────────────────────────────────────────────

export function uvInsidePoly(pu: number, pv: number, poly: UVPoint[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].u, yi = poly[i].v;
    const xj = poly[j].u, yj = poly[j].v;
    const intersect =
      (yi > pv) !== (yj > pv) &&
      pu < ((xj - xi) * (pv - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ─── Panel orientation helpers ────────────────────────────────────────────────

export function panelHeadingFromFrame(frame: PlaneFrame, posECEF: Vec3): number {
  const { lat, lng } = ecefToLatLng(posECEF);
  const basis = enuBasisECEF(lat, lng);
  const uEast  = dot3(frame.u, basis.east);
  const uNorth = dot3(frame.u, basis.north);
  return Math.atan2(uEast, uNorth); // compass heading (0=N, π/2=E)
}

/**
 * Compute the Cesium pitch of the surface normal.
 * pitch = -tiltDeg (negative because Cesium pitch is nose-down positive)
 */
export function panelPitchFromTilt(tiltDeg: number): number {
  return -tiltDeg * DEG;
}

// ─── THE GRID ENGINE ──────────────────────────────────────────────────────────

export interface GridOptions {
  frame:        PlaneFrame;
  boundaryUV:   UVPoint[];          // polygon in UV space for containment test
  dims:         PanelDims;
  spacing:      GridSpacing;
  setbacks:     Setbacks;
  layoutId:     string;
  wattage:      number;
  orientation:  'portrait' | 'landscape';
  tiltDeg:      number;
  azimuthDeg:   number;
  systemType:   'roof' | 'ground' | 'fence';
  planeId?:     string;
  // If boundaryUV is empty (e.g. row tool with no polygon), use explicit UV bounds
  uMin?:        number;
  uMax?:        number;
  vMin?:        number;
  vMax?:        number;
  // Skip boundary polygon check entirely (fence, row tool)
  skipBoundaryCheck?: boolean;
}

/**
 * Place a full grid of panels on a surface using THE ONE FORMULA.
 *
 * Grid sweep:
 *   for each row j  (v direction, +v = up-slope / away from eave):
 *     for each col i (u direction, +u = along ridge / right):
 *       uOffset = setback.sideM + i * stepU + dims.widthM / 2
 *       vOffset = setback.eaveM + j * stepV + dims.heightM / 2
 *       worldPos = origin + u*uOffset + v*vOffset + normal*PANEL_OFFSET_M
 *       test all 4 corners inside boundaryUV → keep if all inside
 *       ecefToLatLng(worldPos) → lat/lng/height at output only
 */
export function placePanelGrid(opts: GridOptions): PlacedPanel[] {
  const {
    frame, boundaryUV, dims, spacing, setbacks,
    layoutId, wattage, orientation, tiltDeg, azimuthDeg, systemType, planeId,
    uMin: uMinOvr, uMax: uMaxOvr, vMin: vMinOvr, vMax: vMaxOvr,
    skipBoundaryCheck,
  } = opts;

  const stepU = dims.widthM  + spacing.colSpacingM;
  const stepV = dims.heightM + spacing.rowSpacingM;

  // Determine UV bounding box
  let uLo: number, uHi: number, vLo: number, vHi: number;

  if (typeof uMinOvr === 'number' && typeof uMaxOvr === 'number') {
    // Explicit bounds (row tool, fence, ground row)
    uLo = uMinOvr + setbacks.sideM;
    uHi = uMaxOvr - setbacks.sideM;
    vLo = (vMinOvr ?? 0) + setbacks.eaveM;
    vHi = (vMaxOvr ?? dims.heightM) - setbacks.ridgeM;
  } else if (boundaryUV.length >= 3) {
    // Derive from polygon bounding box
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of boundaryUV) {
      if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u;
      if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v;
    }
    uLo = minU + setbacks.sideM;
    uHi = maxU - setbacks.sideM;
    vLo = minV + setbacks.eaveM;
    vHi = maxV - setbacks.ridgeM;
  } else {
    console.warn('[placePanelGrid] No boundary or explicit bounds — returning empty');
    return [];
  }

  if (uHi - uLo < dims.widthM || vHi - vLo < dims.heightM) {
    console.warn('[placePanelGrid] Area too small after setbacks', {
      uRange: (uHi - uLo).toFixed(3), vRange: (vHi - vLo).toFixed(3),
      needU: dims.widthM, needV: dims.heightM,
    });
    return [];
  }

  // Compute shared heading at origin (same for all panels — no drift)
  const sharedHeading = panelHeadingFromFrame(frame, frame.origin);
  const sharedPitch   = panelPitchFromTilt(tiltDeg);

  // Boundary check mode:
  //   - skipBoundaryCheck=true  → always accept (fence, row tool, ground row)
  //   - boundaryUV.length >= 3  → polygon containment test
  //   - boundaryUV.length < 3   → no polygon, accept all within explicit bounds
  const usePoly = !skipBoundaryCheck && boundaryUV.length >= 3;

  const panels: PlacedPanel[] = [];
  let totalTested = 0;
  let totalRejected = 0;
  let gridRow = 0;
  let rowV = vLo;

  while (rowV + dims.heightM <= vHi + 1e-6) {
    const vCenter  = rowV + dims.heightM / 2;
    let   gridCol  = 0;
    let   colU     = uLo;
    let   rowHasAny = false;

    while (colU + dims.widthM <= uHi + 1e-6) {
      const uCenter = colU + dims.widthM / 2;
      totalTested++;

      let inBoundary: boolean;
      if (skipBoundaryCheck) {
        // Fence / row / ground: explicit bounds already cover containment
        inBoundary = true;
      } else if (usePoly) {
        // Polygon containment: test panel center (relaxed — center-only for fence)
        // For roof polygons test all 4 corners with 1cm inset
        const EPS = 0.01;
        const hw = dims.widthM  / 2 - EPS;
        const hh = dims.heightM / 2 - EPS;
        inBoundary = (
          uvInsidePoly(uCenter - hw, vCenter - hh, boundaryUV) &&
          uvInsidePoly(uCenter + hw, vCenter - hh, boundaryUV) &&
          uvInsidePoly(uCenter + hw, vCenter + hh, boundaryUV) &&
          uvInsidePoly(uCenter - hw, vCenter + hh, boundaryUV)
        );
      } else {
        // Explicit bounds only (no polygon) — already bounded by uLo/uHi/vLo/vHi
        inBoundary = true;
      }

      if (!inBoundary) {
        totalRejected++;
        colU += stepU;
        continue;
      }

      // THE ONE FORMULA
      const worldPos = panelToWorld(frame, uCenter, vCenter);
      const { lat, lng, height } = ecefToLatLng(worldPos);

      if (!isFinite(lat) || !isFinite(lng) || !isFinite(height)) {
        console.warn('[placePanelGrid] Non-finite geo at', { uCenter, vCenter, worldPos });
        totalRejected++;
        colU += stepU;
        continue;
      }

      const xM = Math.round(frame.u.x * uCenter * 1e4) / 1e4;
      const yM = Math.round(frame.v.y * vCenter * 1e4) / 1e4;

      panels.push({
        id:            uuidv4(),
        layoutId,
        lat:           Math.round(lat    * 1e7) / 1e7,
        lng:           Math.round(lng    * 1e7) / 1e7,
        x:             xM,
        y:             yM,
        xMeters:       xM,
        yMeters:       yM,
        xFeet:         uCenter * 3.28084,
        yFeet:         vCenter * 3.28084,
        widthFeet:     dims.widthM  * 3.28084,
        heightFeet:    dims.heightM * 3.28084,
        tilt:          tiltDeg,
        azimuth:       azimuthDeg,
        wattage,
        bifacialGain:  systemType === 'fence' ? 1.15 : 1.0,
        row:           gridRow,
        col:           gridCol,
        height:        isFinite(height) ? height : 0,
        heading:       sharedHeading,
        pitch:         sharedPitch,
        roll:          0,
        orientation,
        systemType,
        layoutSource:  'AUTO',
        placementType: systemType === 'roof'   ? 'ROOF'  :
                       systemType === 'fence'  ? 'FENCE' : 'GROUND',
        planeId:       planeId,  // v47.152: undefined when no planeId (ground/fence rows)
        gridRow,
        gridCol,
        // v47.159: Store ECEF frame u-axis for grid line rendering
        ecefUx:        frame.u.x,
        ecefUy:        frame.u.y,
        ecefUz:        frame.u.z,
        ecefNx:        frame.normal.x,
        ecefNy:        frame.normal.y,
        ecefNz:        frame.normal.z,
      });

      gridCol++;
      rowHasAny = true;
      colU += stepU;
    }

    if (rowHasAny) gridRow++;
    rowV += stepV;
  }

  console.log('[planeEngine] placePanelGrid result', {
    systemType, orientation,
    panelCount: panels.length,
    totalTested,
    totalRejected,
    rows: gridRow,
    uRange: (uHi - uLo).toFixed(2),
    vRange: (vHi - vLo).toFixed(2),
    stepU: stepU.toFixed(3),
    stepV: stepV.toFixed(3),
    sharedHeadingDeg: (sharedHeading * 180 / Math.PI).toFixed(1),
    skipBoundaryCheck: !!skipBoundaryCheck,
    usePoly,
  });

  return panels;
}

// ─── Fence helper ─────────────────────────────────────────────────────────────

/**
 * Build a fence plane from an array of fence points (lat/lng/height).
 * Fence is a vertical surface (tilt=90) along the polyline.
 *
 * Returns one PlaneFrame per segment (each segment is straight).
 * For multi-segment fences, call this once per segment.
 *
 * p1/p2: fence post positions in ECEF (already at ground height)
 * fenceHeightM: total fence height in meters
 *
 * Frame axes:
 *   u      = along the fence (horizontal, unit vector from p1 to p2)
 *   v      = up the fence face (= radialUp projected perpendicular to u)
 *   normal = outward from fence face (= cross(u, v), flipped if needed)
 *
 * NOTE: do NOT use buildPlaneFromTwoPoints(tilt=90) here — for tilt=90
 * that function sets normal=skyward and v=toward-Earth, producing panels
 * that are placed underground. This function uses radialUp as v directly.
 */
export function buildFencePlane(p1ECEF: Vec3, p2ECEF: Vec3, fenceHeightM: number): PlaneFrame {
  // u: along the fence line
  const u = normalize3(sub3(p2ECEF, p1ECEF));

  // radialUp at p1: outward from Earth center (= local vertical)
  const radialUp = normalize3(p1ECEF);

  // v: up the fence face = radialUp with u-component removed
  const ruDotU = dot3(radialUp, u);
  const vRaw: Vec3 = {
    x: radialUp.x - u.x * ruDotU,
    y: radialUp.y - u.y * ruDotU,
    z: radialUp.z - u.z * ruDotU,
  };
  const v = normalize3(vRaw);

  // normal: outward from fence face = cross(u, v)
  // Flip if pointing toward Earth center (dot with radialUp should be >= 0 for outward)
  const nRaw = cross3(u, v);
  const normal = dot3(nRaw, radialUp) >= 0 ? normalize3(nRaw) : scale3(normalize3(nRaw), -1);

  // Origin: p1 lifted slightly along normal so panels sit just in front of the fence line
  const origin: Vec3 = {
    x: p1ECEF.x + normal.x * PANEL_OFFSET_M,
    y: p1ECEF.y + normal.y * PANEL_OFFSET_M,
    z: p1ECEF.z + normal.z * PANEL_OFFSET_M,
  };

  return { origin, u, v, normal };
}

/**
 * Place fence panels along a single straight segment.
 *
 * u-axis: along the fence (horizontal)
 * v-axis: up the fence (vertical)
 * Grid: N columns × 1 row (fence height fits one panel row)
 * Panel width fills u; panel height fills v.
 *
 * Boundary check is DISABLED for fence — explicit UV bounds are the only
 * constraint. This prevents false rejection from polygon containment tests.
 */
export function placeFencePanels(opts: {
  p1ECEF:       Vec3;
  p2ECEF:       Vec3;
  fenceHeightM: number;
  dims:         PanelDims;
  colSpacingM:  number;
  layoutId:     string;
  wattage:      number;
  orientation:  'portrait' | 'landscape';
  azimuthDeg:   number;
}): PlacedPanel[] {
  const { p1ECEF, p2ECEF, fenceHeightM, dims, colSpacingM,
          layoutId, wattage, orientation, azimuthDeg } = opts;

  const segLen = mag3(sub3(p2ECEF, p1ECEF));

  console.log('[placeFencePanels] input', {
    segLen: segLen.toFixed(2),
    fenceHeightM,
    dimW: dims.widthM,
    dimH: dims.heightM,
    orientation,
  });

  if (segLen < dims.widthM) {
    console.warn('[placeFencePanels] Segment too short:', segLen.toFixed(2), 'need >=', dims.widthM);
    return [];
  }
  if (fenceHeightM < dims.heightM) {
    console.warn('[placeFencePanels] Fence too short for panel height:', fenceHeightM.toFixed(2), 'need >=', dims.heightM.toFixed(3));
    // Still try — use fenceHeightM as vMax, panel may just barely not fit
    // Don't return [] — let placePanelGrid decide
  }

  const frame = buildFencePlane(p1ECEF, p2ECEF, fenceHeightM);

  console.log('[placeFencePanels] plane built', {
    origin: `(${frame.origin.x.toFixed(0)},${frame.origin.y.toFixed(0)},${frame.origin.z.toFixed(0)})`,
    u: `(${frame.u.x.toFixed(4)},${frame.u.y.toFixed(4)},${frame.u.z.toFixed(4)})`,
    v: `(${frame.v.x.toFixed(4)},${frame.v.y.toFixed(4)},${frame.v.z.toFixed(4)})`,
    normal: `(${frame.normal.x.toFixed(4)},${frame.normal.y.toFixed(4)},${frame.normal.z.toFixed(4)})`,
    uLen: segLen.toFixed(2), vLen: fenceHeightM.toFixed(2),
  });

  // UV bounds: u spans segment length, v spans fence height
  const uLen = segLen;
  const vLen = fenceHeightM;

  return placePanelGrid({
    frame,
    boundaryUV:        [],       // no polygon — explicit bounds only
    dims,
    spacing:           { colSpacingM, rowSpacingM: 0 },
    setbacks:          { sideM: 0, eaveM: 0, ridgeM: 0 },
    layoutId,
    wattage,
    orientation,
    tiltDeg:           90,
    azimuthDeg,
    systemType:        'fence',
    uMin:              0,
    uMax:              uLen,
    vMin:              0,
    vMax:              vLen,
    skipBoundaryCheck: true,     // explicit bounds are the only constraint
  });
}

// ─── Ground array row helper ──────────────────────────────────────────────────

/**
 * Place one row of ground-mount panels between two ECEF points.
 *
 * u-axis: along the row (p1 → p2)
 * v-axis: up the tilt
 * Grid: N columns × 1 row
 *
 * Boundary check is DISABLED — explicit UV bounds are the only constraint.
 */
export function placeGroundRow(opts: {
  p1ECEF:      Vec3;
  p2ECEF:      Vec3;
  tiltDeg:     number;
  azimuthDeg:  number;
  dims:        PanelDims;
  colSpacingM: number;
  layoutId:    string;
  wattage:     number;
  orientation: 'portrait' | 'landscape';
}): PlacedPanel[] {
  const { p1ECEF, p2ECEF, tiltDeg, azimuthDeg, dims, colSpacingM,
          layoutId, wattage, orientation } = opts;

  const segLen = mag3(sub3(p2ECEF, p1ECEF));

  console.log('[placeGroundRow] input', {
    segLen: segLen.toFixed(2),
    tiltDeg,
    dimW: dims.widthM,
    orientation,
  });

  if (segLen < dims.widthM) {
    console.warn('[placeGroundRow] Segment too short:', segLen.toFixed(2));
    return [];
  }

  const frame = buildPlaneFromTwoPoints(p1ECEF, p2ECEF, tiltDeg);

  return placePanelGrid({
    frame,
    boundaryUV:        [],
    dims,
    spacing:           { colSpacingM, rowSpacingM: 0 },
    setbacks:          { sideM: 0, eaveM: 0, ridgeM: 0 },
    layoutId,
    wattage,
    orientation,
    tiltDeg,
    azimuthDeg,
    systemType:        'ground',
    uMin:              0,
    uMax:              segLen,
    vMin:              0,
    vMax:              dims.heightM,
    skipBoundaryCheck: true,     // explicit bounds are the only constraint
  });
}