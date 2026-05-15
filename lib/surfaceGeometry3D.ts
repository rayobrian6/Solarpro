/**
 * surfaceGeometry3D.ts — 3D Surface-Based Panel Placement Engine  (v47.123)
 *
 * PANEL ALIGNMENT GUARANTEE:
 *   Every panel's world position is computed INDEPENDENTLY from the grid origin:
 *
 *     position = origin + u * (col * stepU + widthM/2)
 *                       + v * (row * stepV + heightM/2)
 *
 *   There is NO incremental offset accumulation. Each panel is computed from
 *   scratch using its absolute (row, col) index. This eliminates drift.
 *
 * FRAME PRIORITY:
 *   buildSurfaceGrid() uses localFrame3D when available (set by roofPlane3D.ts).
 *   localFrame3D.u is derived from the LONGEST POLYGON EDGE — not azimuth.
 *   Fallback: computeSurfaceFrame3D(azimuth, tilt) for planes without 3D frame.
 *
 * SHARED ROTATION:
 *   All panels on the same plane share IDENTICAL heading/pitch/roll.
 *   heading = atan2(-nENU.y, nENU.x)  (derived from plane normal, Cesium HPR convention)
 *   pitch   = -acos(nUp)              (= -tiltDeg for standard surfaces)
 *   roll    = 0
 *
 * Coordinate conventions:
 *   ENU tangent space at centroid: East=+X, North=+Y, Up=+Z
 *   Azimuth: 0=N, 90=E, 180=S, 270=W (compass, clockwise)
 *   Tilt:    0=flat, 90=vertical
 */

import { v4 as uuidv4 } from 'uuid';
import type { PlacedPanel, RoofPlane, SolarPanel, PlacedObstruction } from '@/types';
import { ecefToLatLng, latLngToECEF } from '@/lib/roofPlane3D';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const METERS_PER_DEG_LAT = 111_320;
const FEET_PER_METER = 3.28084;
// v47.139: Final locked value per Section 7: finalPosition = planePosition + normal * 0.18m
// Panels are placed on a mathematically flat plane (pure ECEF formula).
// Cesium 3D tiles mesh is VISUAL ONLY — never sampled per panel.
//
// v48.9: Two PANEL_OFFSET constants — one per code path:
//
//   PANEL_OFFSET_ECEF (0.05m) — used by buildSurfaceGridECEF, placeSinglePanel,
//     extendRow, addRow. These functions place panels relative to origin3D which
//     is ALREADY lifted SURFACE_OFFSET_M=0.12m above the raw mesh by roofPlane3D.ts.
//     Total above mesh: 0.12 + 0.05 = 0.17m — correct, z-fight-free.
//
//   PANEL_OFFSET_LEGACY (0.18m) — used by panelPositionFromCAD and
//     panelHeightFromCADOffset. These legacy 2D paths compute height from
//     groundElevM + planeHeightAtCenterM directly (no SURFACE_OFFSET_M pre-lift).
//     0.18m is the only offset so it must remain large enough to clear z-fighting.
//
export const PANEL_OFFSET_ECEF   = 0.05; // v48.9: ECEF path (origin3D already lifted 0.12m)
export const PANEL_OFFSET_LEGACY = 0.18; // v48.9: legacy 2D path (no pre-lift)
/** @deprecated Use PANEL_OFFSET_ECEF or PANEL_OFFSET_LEGACY explicitly */
export const PANEL_OFFSET = PANEL_OFFSET_LEGACY; // kept for any external consumers
export const LEGACY_PLANE_HEIGHT_M = 3.5; // default height above ground for 2D planes

export const PW_PORTRAIT  = 1.134;
export const PH_PORTRAIT  = 1.722;
export const PW_LANDSCAPE = 1.722;
export const PH_LANDSCAPE = 1.134;

export const DEFAULT_EAVE_SETBACK_M   = 0.0;
export const DEFAULT_RIDGE_SETBACK_M  = 0.457;
export const DEFAULT_SIDE_SETBACK_M   = 0.457;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SurfaceFrame3D {
  u: { x: number; y: number; z: number };
  v: { x: number; y: number; z: number };
  n: { x: number; y: number; z: number };
}

export interface PanelDims {
  widthM:  number;
  heightM: number;
}

export interface WorldPosition {
  lat:    number;
  lng:    number;
  height: number;
}

// ─── Vector helpers ───────────────────────────────────────────────────────────

function dot3(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): number {
  return a.x*b.x + a.y*b.y + a.z*b.z;
}
function cross3(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) {
  return { x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x };
}
function normalize3(v: {x:number;y:number;z:number}) {
  const len = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
  if (len < 1e-12) return { x:0, y:0, z:1 };
  return { x: v.x/len, y: v.y/len, z: v.z/len };
}
function add3(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}) {
  return { x: a.x+b.x, y: a.y+b.y, z: a.z+b.z };
}
function scale3(v: {x:number;y:number;z:number}, s: number) {
  return { x: v.x*s, y: v.y*s, z: v.z*s };
}


// ─── Per-plane heading/pitch/roll (v47.142) ───────────────────────────────────
//
// Requirement: every roof plane uses its OWN local coordinate system.
// heading and pitch are derived from that plane's resolved ECEF frame,
// never inherited from another plane or from a global azimuth scalar.
//
// Algorithm:
//   1. Resolve ecefFrame3D for the plane (3D or legacy — always available)
//   2. ENU basis at plane centroid (exact WGS-84 computation)
//   3. Convert ECEF n to ENU tangent space (East and North components)
//   4. heading = atan2(-nENU.y, nENU.x)              [v47.317: from plane normal, Cesium HPR convention]
//   5. pitch   = -acos(clamp(nENU.z, -1, 1))         [v47.145: cos(pitch)=nUp -> pitch=-acos(nUp)]
//   6. roll    = 0 (panels lie flat on their plane)
//
// This function is called INDEPENDENTLY for every plane — zero shared state.
//
function planeHPR(
  plane:   RoofPlane,
  ef:      { u:{x:number;y:number;z:number}; v:{x:number;y:number;z:number}; n:{x:number;y:number;z:number} },
  origin:  { x:number;y:number;z:number },
): { heading: number; pitch: number; roll: number } {
  // ENU basis at origin (exact WGS-84 derivation, no metersPerDeg approximation)
  const mag  = Math.sqrt(origin.x*origin.x + origin.y*origin.y + origin.z*origin.z);
  if (mag < 1e6) {
    // Fallback for degenerate origin (should never happen for real roof points)
    return { heading: plane.azimuth * DEG, pitch: -plane.pitch * DEG, roll: 0 };
  }

  // Standard ENU unit vectors in ECEF space at 'origin'
  const sinLng = origin.y / Math.sqrt(origin.x*origin.x + origin.y*origin.y + 1e-30);
  const cosLng = origin.x / Math.sqrt(origin.x*origin.x + origin.y*origin.y + 1e-30);
  const upX    = origin.x / mag;
  const upY    = origin.y / mag;
  const upZ    = origin.z / mag;
  // East = (-sinLng, cosLng, 0)
  const eX = -sinLng, eY = cosLng, eZ = 0;
  // North = cross(Up, East) — but standard is cross(Up × East) need to be careful:
  // North = normalize(cross(East, Up))? No: ENU standard is:
  //   East  = normalize(-sin(lng), cos(lng), 0)
  //   North = normalize(-sin(lat)*cos(lng), -sin(lat)*sin(lng), cos(lat))
  //   Up    = normalize(x,y,z)
  // Simpler: North = normalize(cross(Up, East) × -1) = normalize(cross(East × Up))
  // Actually: North = cross(Up, East) in right-hand ENU
  // cross(Up, East):
  const nX = upY*eZ - upZ*eY;  // = upY*0 - upZ*cosLng = -upZ*cosLng
  const nY = upZ*eX - upX*eZ;  // = upZ*(-sinLng) - upX*0 = -upZ*sinLng
  const nZ = upX*eY - upY*eX;  // = upX*cosLng - upY*(-sinLng)
  const nMag = Math.sqrt(nX*nX + nY*nY + nZ*nZ);
  const northX = nX/nMag, northY = nY/nMag, northZ = nZ/nMag;

  // Project n onto ENU (East and North components)
  const nEast  = ef.n.x*eX    + ef.n.y*eY    + ef.n.z*eZ;
  const nNorth = ef.n.x*northX + ef.n.y*northY + ef.n.z*northZ;

  // v47.317: Correct heading derived from plane normal (not u-axis).
  //
  // Cesium headingPitchRollQuaternion with HPR(H, P, 0) rotates the box's
  // local Z axis (face normal) to ENU direction:
  //   face_normal_ENU = (-cosH*sinP, sinH*sinP, cosP)
  //   where East=x, North=y (Rodrigues' formula, heading CW from North then pitch)
  //
  // We need face_normal_ENU = (nEast, nNorth, nUp) [the roof plane normal in ENU].
  // With P = -acos(nUp), sinP = -sin(acos(nUp)) = -sqrt(1-nUp^2) = -sinTilt:
  //   -cosH * (-sinTilt) = nEast  =>  cosH = nEast / sinTilt
  //   sinH  * (-sinTilt) = nNorth  =>  sinH = -nNorth / sinTilt
  // Therefore: H = atan2(-nNorth, nEast)
  //
  // Previous (WRONG) formula used atan2(uEast, uNorth) = bearing of u-axis = az+90 deg.
  // That put panels facing the WRONG direction (90 deg off) for every roof azimuth.
  const heading = (Math.abs(nEast) < 1e-10 && Math.abs(nNorth) < 1e-10)
    ? 0  // flat roof (nUp=1) -- heading is irrelevant for a flat surface
    : Math.atan2(-nNorth, nEast);

  // v47.150: Validate ef.n before using it.
  // ef.n must be a unit vector (length ≈ 1) pointing outward (nUp > 0).
  // roofPlane3D guarantees this, but guard here defensively.
  const nLen = Math.sqrt(ef.n.x*ef.n.x + ef.n.y*ef.n.y + ef.n.z*ef.n.z);
  if (nLen < 0.99 || nLen > 1.01) {
    console.error(`[planeHPR] ef.n not unit length: |n|=${nLen.toFixed(4)} — plane frame corrupted. Falling back to azimuth/tilt.`);
    return { heading: plane.azimuth * DEG, pitch: -plane.pitch * DEG, roll: 0 };
  }

  const nUp    = ef.n.x*upX   + ef.n.y*upY   + ef.n.z*upZ;

  // v47.150: Guard against near-vertical planes (nUp close to 0).
  // If nUp < cos(80°) ≈ 0.174, the roof tilt exceeds 80° — likely a wall or bad input.
  // Clamp nUp to [cos(75°), 1.0] = [0.259, 1.0] so pitch stays in [-75°, 0°].
  // Log an error so the user can see the plane was unusable.
  const MIN_NUP = Math.cos(75 * Math.PI / 180); // cos(75°) ≈ 0.259
  let   nUpClamped = nUp;
  if (nUp < MIN_NUP) {
    console.error(`[planeHPR] nUp=${nUp.toFixed(4)} < ${MIN_NUP.toFixed(3)} (tilt > 75°) — plane too steep or pointing sideways. Clamping to ${MIN_NUP.toFixed(3)}.`);
    nUpClamped = MIN_NUP;
  }
  if (nUp < 0) {
    console.error(`[planeHPR] nUp=${nUp.toFixed(4)} < 0 — plane normal points downward! Using fallback.`);
    return { heading: plane.azimuth * DEG, pitch: -plane.pitch * DEG, roll: 0 };
  }

  // pitch: derived from the Up-component of the plane normal.
  //
  // Cesium box face normal at HPR(H, P, 0) has z-component = cos(P).
  // We need the face normal z-component to equal nUp (roof normal's Up component).
  //   → cos(P) = nUp  → P = -acos(nUp)
  //
  // Verification:
  //   flat roof   (nUp=1.0):      pitch = -acos(1.0) = 0°      → face points Up    ✓
  //   20° pitched (nUp=cos 20°):  pitch = -acos(0.940) = -20°  → face tilted 20°   ✓
  //   30° pitched (nUp=cos 30°):  pitch = -acos(0.866) = -30°  → face tilted 30°   ✓
  //   45° pitched (nUp=cos 45°):  pitch = -acos(0.707) = -45°  → face tilted 45°   ✓
  //
  // v47.145 fix: previous formula -(PI/2 - acos(nUp)) was wrong — gave -90° for flat roof.
  const pitch = -Math.acos(Math.max(-1, Math.min(1, nUpClamped)));  // Cesium: nose-down = negative

  // v47.150: Log every plane's HPR for debugging (visible in browser console)
  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, nUp))) * 180 / Math.PI;
  console.log(`[planeHPR] n=(${ef.n.x.toFixed(3)},${ef.n.y.toFixed(3)},${ef.n.z.toFixed(3)}) nUp=${nUp.toFixed(4)} tilt=${tiltDeg.toFixed(1)}° heading=${(heading*180/Math.PI).toFixed(1)}° pitch=${(pitch*180/Math.PI).toFixed(1)}°`);

  return { heading, pitch, roll: 0 };
}

// ─── Core: Surface Frame (azimuth/tilt fallback) ──────────────────────────────

/**
 * Compute orthonormal surface frame from azimuth + tilt.
 * Used as FALLBACK when localFrame3D is not available on the RoofPlane.
 *
 * For 3D-plane-tool planes, localFrame3D is always set (derived from longest edge).
 * For CAD/Solar-API planes, this fallback provides reasonable alignment.
 */
export function computeSurfaceFrame3D(azimuthDeg: number, tiltDeg: number): SurfaceFrame3D {
  const az   = azimuthDeg * DEG;
  const tilt = tiltDeg    * DEG;
  const sinAz = Math.sin(az), cosAz = Math.cos(az);
  const sinT  = Math.sin(tilt), cosT = Math.cos(tilt);

  // Normal: outward from tilted surface (points upward + in slope-face direction)
  const n = normalize3({ x: sinAz * sinT, y: cosAz * sinT, z: cosT });

  // u (along ridge): horizontal ridge direction (cosAz, -sinAz, 0), projected onto
  // the plane to remove any normal component -- ensures dot(u, n) = 0 exactly.
  const uRidgeRaw = { x: cosAz, y: -sinAz, z: 0 };
  const nDotU = dot3(n, uRidgeRaw);
  const uRaw  = { x: uRidgeRaw.x - n.x * nDotU,
                  y: uRidgeRaw.y - n.y * nDotU,
                  z: uRidgeRaw.z - n.z * nDotU };
  const u = normalize3(uRaw);

  // v = cross(n, u) -- right-hand orthonormal frame, v points up-slope (toward peak).
  // Matches computePlaneFromPoints3D: same convention for 3D and legacy 2D planes.
  const v = normalize3(cross3(n, u));

  // v47.137: Reorthogonalize u from v and n — mirrors the two-pass enforcement in
  // computePlaneFromPoints3D so both 3D-tool planes and legacy planes share the
  // exact same frame convention: u = normalize(cross(v, n)).
  const uFinal = normalize3(cross3(v, n));

  return { u: uFinal, v, n };
}

export function surfaceFrameToHPR(frame: SurfaceFrame3D, azimuthDeg: number, tiltDeg: number): {
  heading: number; pitch: number; roll: number;
} {
  // v47.317: Use corrected heading formula (az - 90 degrees in Cesium convention)
  const az = azimuthDeg * DEG;
  return {
    heading: Math.atan2(-Math.cos(az), Math.sin(az)),
    pitch:   -tiltDeg * DEG,
    roll:    0,
  };
}

// ─── v47.129: ECEF Frame for Legacy 2D Planes ──────────────────────────────────────

/**
 * Build an ecefFrame3D + origin3D for a legacy 2D plane (no 3D point picking).
 *
 * For a 2D plane we know: centroidLat/Lng, azimuth, pitch, planeHeightAtCenterMeters.
 * We construct the ECEF frame by:
 *   1. Place origin at centroid ECEF (at roof height)
 *   2. Compute ENU axes at centroid: East, North, Up
 *   3. Build surface frame (u=along-ridge, v=up-slope, n=normal) in ENU
 *   4. Rotate ENU axes to ECEF by multiplying by the ENU-to-ECEF rotation matrix
 *
 * This gives exact ECEF unit vectors so buildSurfaceGridECEF can be used without
 * any metersPerDeg approximation.
 */
export function computeEcefFrameForLegacyPlane(plane: RoofPlane, groundElevM = 0): {
  origin3D:   { x: number; y: number; z: number };
  ecefFrame3D: { u: { x:number;y:number;z:number }; v: { x:number;y:number;z:number }; n: { x:number;y:number;z:number } };
  polygon3D:  Array<{ x: number; y: number; z: number }>;
} {
  const lat     = plane.centroidLat ?? (plane.vertices.reduce((s,v) => s+v.lat, 0) / plane.vertices.length);
  const lng     = plane.centroidLng ?? (plane.vertices.reduce((s,v) => s+v.lng, 0) / plane.vertices.length);
  // v47.216: heightM = groundElevM (Cesium ellipsoidal) + roofHeightAboveGround
  // planeHeightAtCenterMeters is RELATIVE height above ground (typically 3-10m for a roof).
  // groundElevM is the Cesium ellipsoidal height at the site (e.g. ~80m for Alexandria VA).
  // Previously groundElevM was ignored here, placing panels at sea level for any site above sea level.
  const roofAboveGround = (plane.planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M);
  const heightM = groundElevM > 0 ? (groundElevM + roofAboveGround) : roofAboveGround;

  // ── Step 1: ECEF centroid at roof height (ellipsoidal) ──
  const centECEF = latLngToECEF(lat, lng, heightM);

  // ── Step 2: ENU basis vectors at centroid ──
  // Up  = normalize(centECEF)
  // East = normalize(cross(up, worldZ)) ... but standard formula:
  //   East = normalize(-sin(lng), cos(lng), 0)
  //   North = normalize(cross(East, Up)) -- but faster:
  //   North = normalize(-sin(lat)*cos(lng), -sin(lat)*sin(lng), cos(lat))
  const latR = lat * DEG;
  const lngR = lng * DEG;
  const sinLat = Math.sin(latR), cosLat = Math.cos(latR);
  const sinLng = Math.sin(lngR), cosLng = Math.cos(lngR);

  // ECEF unit vectors of ENU axes
  const eastECEF  = { x: -sinLng,              y:  cosLng,              z: 0        };
  const northECEF = { x: -sinLat * cosLng,      y: -sinLat * sinLng,    z: cosLat   };
  const upECEF    = { x:  cosLat * cosLng,      y:  cosLat * sinLng,    z: sinLat   };

  // ── Step 3: Surface frame in ENU ──
  const enuFrame  = computeSurfaceFrame3D(plane.azimuth, plane.pitch);
  // enuFrame.u/v/n are in ENU space (East=x, North=y, Up=z)

  // ── Step 4: Rotate ENU frame vectors to ECEF ──
  // ECEF = East*enu.x + North*enu.y + Up*enu.z
  function enuToEcef(v: {x:number;y:number;z:number}) {
    return {
      x: eastECEF.x*v.x + northECEF.x*v.y + upECEF.x*v.z,
      y: eastECEF.y*v.x + northECEF.y*v.y + upECEF.y*v.z,
      z: eastECEF.z*v.x + northECEF.z*v.y + upECEF.z*v.z,
    };
  }

  const uECEF = enuToEcef(enuFrame.u);
  const vECEF = enuToEcef(enuFrame.v);
  const nECEF = enuToEcef(enuFrame.n);

  // ── Step 5: Build polygon3D from plane.vertices in ECEF ──
  // Project each vertex to the plane at heightM above ground.
  // For 2D planes we don't have exact per-vertex heights, so use the plane equation:
  //   heightAtVertex = heightM - tanPitch * (slope projection from centroid)  [v47.156: - not +]
  const tanPitch = Math.tan(plane.pitch * DEG);
  const az       = plane.azimuth * DEG;
  const mLat_    = 111320;

  const polygon3D = plane.vertices.map(vtx => {
    const dy   = (vtx.lat - lat) * mLat_;
    const dx   = (vtx.lng - lng) * mLat_ * Math.cos(lat * DEG);
    // Slope projection: how far this vertex is along the DOWN-slope direction from centroid.
    // v47.156 FIX: slopeProj is projection onto the DOWN-slope (azimuth) direction.
    // Ridge is UP-slope (opposite to azimuth): slopeProj < 0 -> must be HIGHER than centroid.
    // Eave is DOWN-slope (azimuth direction): slopeProj > 0 -> must be LOWER than centroid.
    // The correct formula is heightM - tanPitch * slopeProj (not +).
    // Previous sign (+) was wrong: ridge got lower height than centroid, eave got higher.
    // This compressed the UV v-span by ~2x and shifted the panel grid off the actual roof edges.
    const slopeProj = dx * Math.sin(az) + dy * Math.cos(az);
    const vtxH  = heightM - tanPitch * slopeProj;  // v47.156: - not + (ridge is above centroid)
    return latLngToECEF(vtx.lat, vtx.lng, vtxH);
  });

  // ── Step 6: Snap origin to min-UV corner of polygon ──
  // Compute UV coords of polygon relative to centroid
  const polyUV = polygon3D.map(p => {
    const d = { x: p.x - centECEF.x, y: p.y - centECEF.y, z: p.z - centECEF.z };
    return {
      u: d.x*uECEF.x + d.y*uECEF.y + d.z*uECEF.z,
      v: d.x*vECEF.x + d.y*vECEF.y + d.z*vECEF.z,
    };
  });
  const minU = Math.min(...polyUV.map(p => p.u));
  const minV = Math.min(...polyUV.map(p => p.v));

  // Origin = centroid + u*minU + v*minV (min-UV corner, on the plane)
  const origin3D = {
    x: centECEF.x + uECEF.x*minU + vECEF.x*minV,
    y: centECEF.y + uECEF.y*minU + vECEF.y*minV,
    z: centECEF.z + uECEF.z*minU + vECEF.z*minV,
  };

  // polygon3D stores absolute ECEF coords.
  // buildSurfaceGridECEF computes (p - origin) internally for UV projection,
  // so absolute coords are correct here.
  return {
    origin3D,
    ecefFrame3D: { u: uECEF, v: vECEF, n: nECEF },
    polygon3D,
  };
}

// ─── Panel Dimensions ─────────────────────────────────────────────────────────

export function getPanelDims(orientation: 'portrait' | 'landscape'): PanelDims {
  return orientation === 'landscape'
    ? { widthM: PW_LANDSCAPE, heightM: PH_LANDSCAPE }
    : { widthM: PW_PORTRAIT,  heightM: PH_PORTRAIT  };
}

// ─── Panel World Position ─────────────────────────────────────────────────────

export function panelWorldPosition(
  originLat: number,
  originLng: number,
  groundElevM: number,
  planeHeightAtCenterM: number,
  frame: SurfaceFrame3D,
  row: number,
  col: number,
  dims: PanelDims,
  panelSpacingM = 0.02,
  rowSpacingM   = 0.05,
): WorldPosition {
  const stepU = dims.widthM  + panelSpacingM;
  const stepV = dims.heightM + rowSpacingM;

  // ABSOLUTE index positioning — no accumulation, no drift
  const uOffset = col * stepU + dims.widthM  / 2;
  const vOffset = row * stepV + dims.heightM / 2;

  const dx = frame.u.x * uOffset + frame.v.x * vOffset;
  const dy = frame.u.y * uOffset + frame.v.y * vOffset;
  const dz = frame.u.z * uOffset + frame.v.z * vOffset;

  const cosLat = Math.cos(originLat * DEG);
  const lat    = originLat + dy / METERS_PER_DEG_LAT;
  const lng    = originLng + dx / (METERS_PER_DEG_LAT * cosLat);
  const height = groundElevM + planeHeightAtCenterM + dz + PANEL_OFFSET;

  return { lat, lng, height };
}

export function panelHeightFromCADOffset(
  groundElevM: number,
  planeHeightAtCenterM: number,
  azimuthDeg: number,
  tiltDeg: number,
  xMeters: number,
  yMeters: number,
): number {
  const azRad = azimuthDeg * DEG;
  const slopeProj = xMeters * Math.sin(azRad) + yMeters * Math.cos(azRad);
  return groundElevM + planeHeightAtCenterM + Math.tan(tiltDeg * DEG) * slopeProj + PANEL_OFFSET;
}

// ─── Plane Assignment ─────────────────────────────────────────────────────────

export function assignRoofPlane(
  clickLat: number,
  clickLng: number,
  planes: RoofPlane[],
  maxDistM = 50,
): RoofPlane | null {
  if (planes.length === 0) return null;
  const cosLat = Math.cos(clickLat * DEG);
  let bestPlane: RoofPlane | null = null;
  let bestDist = Infinity;
  for (const plane of planes) {
    const centLat = plane.centroidLat ?? (plane.vertices.reduce((s,v) => s+v.lat, 0) / plane.vertices.length);
    const centLng = plane.centroidLng ?? (plane.vertices.reduce((s,v) => s+v.lng, 0) / plane.vertices.length);
    const dy = (clickLat - centLat) * METERS_PER_DEG_LAT;
    const dx = (clickLng - centLng) * METERS_PER_DEG_LAT * cosLat;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < bestDist) { bestDist = dist; bestPlane = plane; }
  }
  return bestDist <= maxDistM ? bestPlane : null;
}

// ─── Point-in-polygon ─────────────────────────────────────────────────────────

export function pointInPolygonLatLng(
  lat: number, lng: number,
  vertices: { lat: number; lng: number }[]
): boolean {
  const n = vertices.length;
  if (n < 3) return false;
  let inside = false, j = n - 1;
  for (let i = 0; i < n; j = i++) {
    const yi = vertices[i].lat, xi = vertices[i].lng;
    const yj = vertices[j].lat, xj = vertices[j].lng;
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ─── Obstruction Filtering ────────────────────────────────────────────────────

export function removeObstructedPanels(
  panels: PlacedPanel[],
  obstructions: PlacedObstruction[],
): PlacedPanel[] {
  if (obstructions.length === 0) return panels;
  return panels.filter(panel => {
    for (const obs of obstructions) {
      const cosLat = Math.cos(panel.lat * DEG);
      const dy = (panel.lat - obs.lat) * METERS_PER_DEG_LAT;
      const dx = (panel.lng - obs.lng) * METERS_PER_DEG_LAT * cosLat;
      if (Math.sqrt(dx*dx + dy*dy) < obs.radiusM) return false;
    }
    return true;
  });
}

export function filterSetbackPanels(
  panels: PlacedPanel[],
  plane: RoofPlane,
  eaveSetbackM  = DEFAULT_EAVE_SETBACK_M,
  ridgeSetbackM = DEFAULT_RIDGE_SETBACK_M,
  sideSetbackM  = DEFAULT_SIDE_SETBACK_M,
): PlacedPanel[] {
  return panels; // setbacks enforced in buildSurfaceGrid
}

// ─── Grid Builder ─────────────────────────────────────────────────────────────

/**
 * Build a full grid of panels on a roof surface.
 *
 * FRAME SELECTION (priority order):
 *   1. plane.localFrame3D  — longest-edge stable frame (from roofPlane3D.ts)
 *   2. computeSurfaceFrame3D(azimuth, pitch)  — azimuth-derived fallback
 *
 * GRID ORIGIN:
 *   If plane.localFrame3D is set, the origin for grid coordinates is
 *   plane.origin3D converted to lat/lng (corner-snapped by roofPlane3D.ts).
 *   Otherwise, centroid is used.
 *
 * PANEL POSITION FORMULA (NO DRIFT):
 *   For panel at (row, col):
 *     uOffset  = col * stepU + widthM/2    [absolute — no accumulation]
 *     vOffset  = row * stepV + heightM/2   [absolute — no accumulation]
 *     pos_ENU  = u * uOffset + v * vOffset
 *     lat      = originLat + pos_ENU.y / METERS_PER_DEG_LAT
 *     lng      = originLng + pos_ENU.x / (METERS_PER_DEG_LAT * cos(lat))
 *     height   = groundElev + planeHeight + pos_ENU.z + PANEL_OFFSET_LEGACY (0.18m — legacy 2D path, no pre-lift)
 *
 * SHARED ROTATION:
 *   All panels share the same heading/pitch/roll derived from the stable frame.
 *   heading = atan2(u.x, u.y)  [compass direction of u-axis]
 *   pitch   = -tiltDeg
 *   roll    = 0
 */
export function buildSurfaceGrid(opts: {
  plane:           RoofPlane;
  groundElevM:     number;
  orientation?:    'portrait' | 'landscape';
  eaveSetbackM?:   number;
  ridgeSetbackM?:  number;
  sideSetbackM?:   number;
  panelSpacingM?:  number;
  rowSpacingM?:    number;
  layoutId:        string;
  wattage?:        number;
  // v47.126: Custom layout direction (ENU x,y unit vector) — overrides longest-edge axis
  customDirX?:     number;
  customDirY?:     number;
  // v47.126: Custom layout origin lat/lng — overrides corner-snap
  customOriginLat?: number;
  customOriginLng?: number;
  // v48.12: Mixed portrait+landscape fill strategy
  layoutStrategy?: 'portrait-first' | 'landscape-first' | 'mixed';
}): PlacedPanel[] {
  const {
    plane, groundElevM,
    orientation    = 'portrait',
    eaveSetbackM   = DEFAULT_EAVE_SETBACK_M,
    ridgeSetbackM  = DEFAULT_RIDGE_SETBACK_M,
    sideSetbackM   = DEFAULT_SIDE_SETBACK_M,
    panelSpacingM  = 0,
    rowSpacingM    = 0,
    layoutId,
    wattage        = 400,
    customDirX,
    customDirY,
    customOriginLat,
    customOriginLng,
    layoutStrategy,
  } = opts;

  // ── Section 6: Auto-orientation selection ───────────────────────────────────────
  // If no explicit orientation is given by the caller, choose the one that
  // aligns panels with the dominant plane axis:
  //   uSpan > vSpan  →  plane wider than tall  →  landscape
  //   vSpan ≥ uSpan  →  plane taller than wide →  portrait
  let resolvedOrientation: 'portrait' | 'landscape' = orientation;
  if (opts.orientation === undefined) {
    const ef0   = (plane.createdFrom3D && plane.ecefFrame3D) ? plane.ecefFrame3D : null;
    const poly0 = (plane.createdFrom3D && plane.polygon3D)   ? plane.polygon3D   : null;
    const orig0 = (plane.createdFrom3D && plane.origin3D)    ? plane.origin3D    : null;
    if (ef0 && poly0 && orig0) {
      let uMin0 = Infinity, uMax0 = -Infinity, vMin0 = Infinity, vMax0 = -Infinity;
      for (const p of poly0) {
        const d = { x: p.x - orig0.x, y: p.y - orig0.y, z: p.z - orig0.z };
        const pu = d.x*ef0.u.x + d.y*ef0.u.y + d.z*ef0.u.z;
        const pv = d.x*ef0.v.x + d.y*ef0.v.y + d.z*ef0.v.z;
        if (pu < uMin0) uMin0 = pu; if (pu > uMax0) uMax0 = pu;
        if (pv < vMin0) vMin0 = pv; if (pv > vMax0) vMax0 = pv;
      }
      resolvedOrientation = (uMax0 - uMin0) > (vMax0 - vMin0) ? 'landscape' : 'portrait';
    }
  }

  const dims = getPanelDims(resolvedOrientation);
  const effectiveOrientation = resolvedOrientation;

  // ── v47.129: SINGLE ECEF PATH ───────────────────────────────────────────────────
  // ALL planes use buildSurfaceGridECEF.
  // 3D planes: use stored origin3D + ecefFrame3D + polygon3D (exact geometry).
  // 2D planes: compute ecefFrame3D on-the-fly from azimuth/tilt/centroid via
  //   computeEcefFrameForLegacyPlane() then call buildSurfaceGridECEF.
  //
  // Custom direction/origin overrides: applied by adjusting the ecefFrame3D u-axis
  // or origin before calling buildSurfaceGridECEF.
  //
  // ONE FORMULA everywhere:
  //   worldPos = origin3D + u*uCenter + v*vCenter + n*PANEL_OFFSET_ECEF (0.05m — ECEF path)
  // ecefToLatLng() called ONLY at final output per panel.

  // Resolve plane geometry — always produces valid origin3D + ecefFrame3D + polygon3D
  let resolvedOrigin3D: { x:number; y:number; z:number };
  let resolvedEcefFrame: { u:{x:number;y:number;z:number}; v:{x:number;y:number;z:number}; n:{x:number;y:number;z:number} };
  let resolvedPolygon3D: Array<{x:number;y:number;z:number}>;

  if (plane.createdFrom3D && plane.origin3D && plane.ecefFrame3D && plane.polygon3D && plane.polygon3D.length >= 3) {
    // 3D plane-tool plane: exact geometry from picked points
    resolvedOrigin3D   = plane.origin3D;
    resolvedEcefFrame  = plane.ecefFrame3D;
    resolvedPolygon3D  = plane.polygon3D;
  } else {
    // Legacy 2D plane: compute ECEF frame from azimuth/tilt/centroid
    const legacy = computeEcefFrameForLegacyPlane(plane, groundElevM);
    resolvedOrigin3D   = legacy.origin3D;
    resolvedEcefFrame  = legacy.ecefFrame3D;
    resolvedPolygon3D  = legacy.polygon3D;
  }

  // Apply custom direction override (Set Direction tool — ENU x/y vector)
  if (typeof customDirX === 'number' && typeof customDirY === 'number' &&
      isFinite(customDirX) && isFinite(customDirY)) {
    // User-defined ENU direction vector → rotate to ECEF via centroid ENU basis
    const lat_  = plane.centroidLat ?? (plane.vertices.reduce((s,v) => s+v.lat, 0) / plane.vertices.length);
    const lng_  = plane.centroidLng ?? (plane.vertices.reduce((s,v) => s+v.lng, 0) / plane.vertices.length);
    const latR_ = lat_ * DEG, lngR_ = lng_ * DEG;
    const sLat_ = Math.sin(latR_), cLat_ = Math.cos(latR_), sLng_ = Math.sin(lngR_), cLng_ = Math.cos(lngR_);
    const eastECEF_  = { x: -sLng_,           y:  cLng_,            z: 0      };
    const northECEF_ = { x: -sLat_*cLng_,     y: -sLat_*sLng_,     z: cLat_  };
    const uLen_ = Math.sqrt(customDirX*customDirX + customDirY*customDirY);
    if (uLen_ > 1e-9) {
      const uNormEnu = { x: customDirX/uLen_, y: customDirY/uLen_, z: 0 };
      const newU = {
        x: eastECEF_.x*uNormEnu.x + northECEF_.x*uNormEnu.y,
        y: eastECEF_.y*uNormEnu.x + northECEF_.y*uNormEnu.y,
        z: eastECEF_.z*uNormEnu.x + northECEF_.z*uNormEnu.y,
      };
      const n_ = resolvedEcefFrame.n;
      const vRaw_ = { x: n_.y*newU.z - n_.z*newU.y, y: n_.z*newU.x - n_.x*newU.z, z: n_.x*newU.y - n_.y*newU.x };
      const vLen_ = Math.sqrt(vRaw_.x*vRaw_.x + vRaw_.y*vRaw_.y + vRaw_.z*vRaw_.z);
      if (vLen_ > 1e-9) {
        resolvedEcefFrame = { ...resolvedEcefFrame, u: newU, v: { x: vRaw_.x/vLen_, y: vRaw_.y/vLen_, z: vRaw_.z/vLen_ } };
      }
    }
    console.log('[SurfaceGrid] Applied custom ENU direction override');
  }

  // Apply custom origin override (Set Origin tool — lat/lng)
  if (typeof customOriginLat === 'number' && typeof customOriginLng === 'number' &&
      isFinite(customOriginLat) && isFinite(customOriginLng)) {
    const h_ = (plane.planeHeightAtCenterMeters ?? LEGACY_PLANE_HEIGHT_M) + (groundElevM ?? 0);  // v47.216: add ground elev
    resolvedOrigin3D = latLngToECEF(customOriginLat, customOriginLng, h_);
    console.log('[SurfaceGrid] Applied custom origin override');
  }

  // v48.12: MIXED LAYOUT — run portrait fill + landscape fill, merge without overlap
  if (layoutStrategy === 'mixed' || layoutStrategy === 'portrait-first' || layoutStrategy === 'landscape-first') {
    // Determine which orientation is primary (fills first)
    const primaryOri:   'portrait' | 'landscape' = layoutStrategy === 'landscape-first' ? 'landscape' : 'portrait';
    const secondaryOri: 'portrait' | 'landscape' = primaryOri === 'portrait' ? 'landscape' : 'portrait';

    const commonOpts = {
      plane, groundElevM, eaveSetbackM, ridgeSetbackM, sideSetbackM,
      panelSpacingM, rowSpacingM, layoutId, wattage,
      customOriginLat, customOriginLng, customDirX, customDirY,
    };

    // Primary fill
    const primaryPanels = buildSurfaceGrid({ ...commonOpts, orientation: primaryOri });

    if (layoutStrategy !== 'mixed') {
      // portrait-first or landscape-first with no secondary fill — just return primary
      return primaryPanels;
    }

    // Secondary fill (landscape for portrait-first, portrait for landscape-first)
    const secondaryPanels = buildSurfaceGrid({ ...commonOpts, orientation: secondaryOri });

    // Compute primary panel UV footprints for overlap detection
    // We use each panel's xMeters (=uC) and yMeters (=vC) to reconstruct UV centers
    const primaryDims = getPanelDims(primaryOri);
    const halfWP = primaryDims.widthM  / 2;
    const halfHP = primaryDims.heightM / 2;

    const secondaryDims = getPanelDims(secondaryOri);
    const halfWS = secondaryDims.widthM  / 2;
    const halfHS = secondaryDims.heightM / 2;

    // Filter secondary panels: keep only those that don't overlap any primary panel.
    // Two panels overlap iff their UV bounding boxes intersect in BOTH U and V axes.
    // Non-overlap: separated in U (noOverlapU) OR separated in V (noOverlapV).
    // v48.12 audit: original logic was inverted (kept overlapping panels). Fixed.
    const EPS = 0.001;
    const nonOverlapping = secondaryPanels.filter(sp => {
      const su = sp.xMeters ?? 0;
      const sv = sp.yMeters ?? 0;
      return !primaryPanels.some(pp => {
        const pu = pp.xMeters ?? 0;
        const pv = pp.yMeters ?? 0;
        // noOverlapU: secondary is fully left or right of primary in U-axis
        const noOverlapU = (su + halfWS) <= (pu - halfWP) + EPS || (su - halfWS) >= (pu + halfWP) - EPS;
        // noOverlapV: secondary is fully below or above primary in V-axis
        const noOverlapV = (sv + halfHS) <= (pv - halfHP) + EPS || (sv - halfHS) >= (pv + halfHP) - EPS;
        // overlap = intersects in BOTH axes (neither is separated)
        return !noOverlapU && !noOverlapV;
      });
    });

    console.log('[SurfaceGrid] Mixed layout:', {
      primaryOri, primaryCount: primaryPanels.length,
      secondaryOri, secondaryKept: nonOverlapping.length,
    });

    return [...primaryPanels, ...nonOverlapping];
  }

  // ── Route to single ECEF grid engine ───────────────────────────────────────────────
  return buildSurfaceGridECEF({
    plane,
    orientation: effectiveOrientation,
    eaveSetbackM,
    ridgeSetbackM,
    sideSetbackM,
    panelSpacingM,
    rowSpacingM,
    layoutId,
    wattage,
    dims,
    groundElevM,          // v47.216: forwarded for legacy plane elevation
    overrideOrigin3D:   resolvedOrigin3D,
    overrideEcefFrame:  resolvedEcefFrame,
    overridePolygon3D:  resolvedPolygon3D,
  });
}

// ─── v47.128: Pure ECEF Grid Engine ──────────────────────────────────────────────────────
/**
 * buildSurfaceGridECEF — Pure ECEF panel placement engine for 3D-tool planes.
 *
 * Uses the ONE FORMULA:
 *   worldPos = origin3D + u*(i*stepU + w/2) + v*(j*stepV + h/2) + n*PANEL_OFFSET_ECEF (0.05m)
 *
 * No lat/lng approximations inside the loop. Zero metersPerDeg error.
 * ecefToLatLng() called ONLY at the final output step per panel.
 *
 * Polygon containment is done in the plane's local UV space (dot products
 * against the ECEF u/v axes) — geometrically exact.
 */
function buildSurfaceGridECEF(opts: {
  plane:              RoofPlane;
  orientation:        'portrait' | 'landscape';
  eaveSetbackM:       number;
  ridgeSetbackM:      number;
  sideSetbackM:       number;
  panelSpacingM:      number;
  rowSpacingM:        number;
  layoutId:           string;
  wattage:            number;
  dims:               { widthM: number; heightM: number };
  groundElevM?:       number;  // v47.216: Cesium ellipsoidal ground elevation at site
  overrideOrigin3D?:  { x:number; y:number; z:number };
  overrideEcefFrame?: { u:{x:number;y:number;z:number}; v:{x:number;y:number;z:number}; n:{x:number;y:number;z:number} };
  overridePolygon3D?: Array<{x:number;y:number;z:number}>;
}): PlacedPanel[] {
  const { plane, orientation, eaveSetbackM, ridgeSetbackM, sideSetbackM,
          panelSpacingM, rowSpacingM, layoutId, wattage, dims,
          groundElevM: _groundElevM,
          overrideOrigin3D, overrideEcefFrame, overridePolygon3D } = opts;

  const origin = overrideOrigin3D   ?? plane.origin3D!;
  const ef     = overrideEcefFrame  ?? plane.ecefFrame3D!;
  const poly3D = overridePolygon3D  ?? plane.polygon3D!;

  // ── Project polygon into plane UV (via ECEF dot products) ─────────────────
  const polyUV = poly3D.map(p => {
    const d = { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
    return {
      u: d.x * ef.u.x + d.y * ef.u.y + d.z * ef.u.z,
      v: d.x * ef.v.x + d.y * ef.v.y + d.z * ef.v.z,
    };
  });

  // ── Bounding box + setback boundary in UV ─────────────────────────────────
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of polyUV) {
    if (p.u < minU) minU = p.u; if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v; if (p.v > maxV) maxV = p.v;
  }

  const stepU = dims.widthM  + panelSpacingM;
  const stepV = dims.heightM + rowSpacingM;

  // Setback-inset boundary (panels must lie inside this rectangle)
  const boundULo = minU + sideSetbackM;
  const boundUHi = maxU - sideSetbackM;
  // v50.30: CORRECT setback assignment — v = cross(n,u) points DOWN-SLOPE,
  //   so minV=0 is RIDGE end, maxV is EAVE/gutter end.
  //   ridgeSetbackM applies at the physical RIDGE (minV side).
  //   eaveSetbackM applies at the physical EAVE/gutter (maxV side).
  //   Old code (v47.140–v50.29) had these swapped — masked by symmetric defaults.
  const boundVLo = minV + ridgeSetbackM;   // physical RIDGE end
  const boundVHi = maxV - eaveSetbackM;    // physical EAVE/gutter end

  if (boundUHi - boundULo < dims.widthM || boundVHi - boundVLo < dims.heightM) {
    console.warn('[SurfaceGridECEF] Plane too small after setbacks', {
      planeId: plane.id, uRange: boundUHi - boundULo, vRange: boundVHi - boundVLo,
    });
    return [];
  }

  // ── Point-in-polygon (UV space, ray-casting) ───────────────────────────────
  function uvInsidePoly(pu: number, pv: number): boolean {
    const n = polyUV.length;
    let inside = false, j = n - 1;
    for (let i = 0; i < n; j = i++) {
      const ui = polyUV[i].u, vi = polyUV[i].v;
      const uj = polyUV[j].u, vj = polyUV[j].v;
      if (((vi > pv) !== (vj > pv)) && (pu < (uj - ui) * (pv - vi) / (vj - vi) + ui)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // ── Section 2: 4-corner containment test — NO epsilon inset ───────────────
  // Panel corners are at (uC ± w/2, vC ± h/2). All 4 must be inside polygon
  // AND inside the setback boundary. No shrinking, no warping.
  function panelFits(uC: number, vC: number): boolean {
    const hw = dims.widthM  / 2;
    const hh = dims.heightM / 2;
    // Setback boundary check (fast reject)
    if (uC - hw < boundULo - 1e-6 || uC + hw > boundUHi + 1e-6) return false;
    if (vC - hh < boundVLo - 1e-6 || vC + hh > boundVHi + 1e-6) return false;
    // Polygon containment — all 4 true corners, no inset
    return uvInsidePoly(uC - hw, vC - hh)
        && uvInsidePoly(uC + hw, vC - hh)
        && uvInsidePoly(uC + hw, vC + hh)
        && uvInsidePoly(uC - hw, vC + hh);
  }

  // ── Shared rotation — per-plane local frame (v47.142) ────────────────────────
  // Derived from this plane's OWN ecefFrame3D+origin3D. Zero inheritance across planes.
  const { heading: sharedHeading, pitch: sharedPitch, roll: sharedRoll } =
    planeHPR(plane, ef, origin);

  // ── Section 3: Grid Solver (v47.140, v50.27) ─────────────────────────────
  // When eaveSetbackM === 0 (panels to gutter): bottom-aligned grid using GRID_EPSILON
  // as the V-base offset instead of remainingV/2 centering.  See inline comment below.
  // When eaveSetbackM > 0: centered grid unchanged from v47.140.

  // 0.1 mm inset from polygon boundary — avoids ray-casting PIP boundary ambiguity.
  // When eaveSetbackM === 0, the V-origin is bottom-aligned (gutter-flush) using this
  // epsilon instead of the centered remainingV/2 offset.  The epsilon means panel bottom
  // corners are strictly inside the polygon, not on the boundary, so PIP is reliable.
  const GRID_EPSILON = 1e-4;

  const roofWidth  = boundUHi - boundULo;
  const roofHeight = boundVHi - boundVLo;

  function runFill(phaseU: number, phaseV: number): Array<{uC: number; vC: number; col: number; row: number}> {
    const cols = Math.floor(roofWidth  / stepU);
    const rows = Math.floor(roofHeight / stepV);
    const remainingU = roofWidth  - cols * stepU;
    const remainingV = roofHeight - rows * stepV;
    const originU = boundULo + remainingU / 2 + phaseU;
    // Centered grid — equal margin top and bottom. Phase candidates allow half-step
    // variants for non-rectangular roofs.  v50.28: gutter-flush shift applied after
    // best fill is selected (see post-shift block below).
    const originV = boundVLo + remainingV / 2 + phaseV;

    const result: Array<{uC: number; vC: number; col: number; row: number}> = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const uC = originU + col * stepU + dims.widthM  / 2;
        const vC = originV + row * stepV + dims.heightM / 2;
        if (panelFits(uC, vC)) {
          result.push({ uC, vC, col, row });
        }
      }
    }
    return result;
  }

  // 4 phase candidates: base (centered) + half-step variants for non-rect roofs
  const phaseCandidates: Array<{pu: number; pv: number}> = [
    { pu: 0,           pv: 0           },
    { pu: stepU / 2,   pv: 0           },
    { pu: 0,           pv: stepV / 2   },
    { pu: stepU / 2,   pv: stepV / 2   },
  ];

  let bestFill: Array<{uC: number; vC: number; col: number; row: number}> = [];
  let bestOffset = phaseCandidates[0];
  for (const cand of phaseCandidates) {
    const fill = runFill(cand.pu, cand.pv);
    if (fill.length > bestFill.length) {
      bestFill = fill;
      bestOffset = cand;
    }
  }

  // ── v50.31: Gutter-flush shift with binary-search max-safe-shift ─────────────
  // When eaveSetbackM === 0 (panels to gutter line), shift the entire bestFill
  // TOWARD THE EAVE so the top edge of the panel nearest the eave sits as close
  // as possible to boundVHi (= maxV when eave=0 = physical gutter line).
  //
  // UV COORDINATE ORIENTATION (v50.30):
  //   v = cross(n, u) points DOWN-SLOPE. minV=0 = RIDGE, maxV = EAVE/gutter.
  //   boundVLo = minV + ridgeSetbackM (physical RIDGE end)
  //   boundVHi = maxV - eaveSetbackM  (physical EAVE/gutter end; = maxV when eave=0)
  //
  // WHY BINARY SEARCH (v50.31 addition):
  //   v50.30 shifted to boundVHi - GRID_EPSILON then filtered by panelFits.
  //   On a non-rectangular polygon (e.g. hip/trapezoidal eave), the eave edge
  //   is not a perfectly horizontal line in UV space.  maxV may only be reached
  //   at one corner; the rest of the eave boundary is at lower v values.
  //   Panels shifted to v = maxV - GRID_EPSILON can have their top corners land
  //   OUTSIDE the polygon for the angled portions of the eave edge → dropped.
  //   Result: the bottom row (eave-most) disappears.
  //
  //   Fix: binary search for the MAXIMUM shift where ALL N panels survive panelFits.
  //   Fast path: try full shift first (O(N)); falls back to binary search (O(20N)).
  //   On rectangular polygon: full shift always valid → fast path, same as v50.30.
  //   On tapered polygon: binary search finds the maximum safe shift → no row loss.
  //
  // UNIFORM SHIFT — no mixing:
  //   Every panel shifts by the SAME amount.  Prevents mixed-vC overlap artefact.
  //
  // V-HI SNAP: guarded (eaveSetbackM > 0 check in snap pass below).
  //   When eave=0: boundVHi = maxV = polygon boundary → PIP ambiguity if snapped to.
  if (eaveSetbackM === 0 && bestFill.length > 0) {
    const maxVc      = Math.max(...bestFill.map(p => p.vC));
    const actualTop  = maxVc + dims.heightM / 2;          // top edge of panel nearest eave
    const gapAtEave  = boundVHi - actualTop;              // gap between top panel and eave boundary
    const fullShift  = gapAtEave - GRID_EPSILON;          // target: push top to boundVHi - 0.1mm

    if (fullShift > GRID_EPSILON) {
      // Fast path: try full shift first (works for rectangular / well-behaved polygons)
      const fullyShifted = bestFill.map(p => ({ ...p, vC: p.vC + fullShift }));
      const fullyValid   = fullyShifted.filter(p => panelFits(p.uC, p.vC));

      if (fullyValid.length === bestFill.length) {
        // All panels survive the full shift — apply it (rectangular roof fast path)
        bestFill = fullyValid;
      } else {
        // Some panels dropped at full shift (non-rectangular/tapered polygon: eave
        // edge is not a perfect horizontal line, so top-row corners at maxV-EPSILON
        // may land outside the polygon on angled eave sides).
        // Binary search for the MAXIMUM safe shift where ALL panels survive panelFits.
        // Invariant: lo is always valid (all panels pass), hi may not be.
        // O(20 × N) = ~800 panelFits calls max. Negligible cost.
        let lo = 0;
        let hi = fullShift;
        for (let iter = 0; iter < 20 && (hi - lo) > GRID_EPSILON; iter++) {
          const mid        = (lo + hi) / 2;
          const midShifted = bestFill.map(p => ({ ...p, vC: p.vC + mid }));
          const midValid   = midShifted.filter(p => panelFits(p.uC, p.vC));
          if (midValid.length === bestFill.length) {
            lo = mid;   // safe — can shift further
          } else {
            hi = mid;   // dropped panels — reduce shift
          }
        }
        // Apply maximum safe shift (lo). If lo ≈ 0, panels were already flush.
        if (lo > GRID_EPSILON) {
          bestFill = bestFill
            .map(p  => ({ ...p, vC: p.vC + lo }))
            .filter(p => panelFits(p.uC, p.vC));          // re-validate at final position
        }
      }
    }
  }

  // ── Section 5: Edge snap pass (2cm tolerance) + post-snap polygon re-check ─────────
  // For panels whose edge is within 2cm of the setback boundary, snap them
  // to exactly align with the boundary edge. This eliminates the small gap
  // at roof edges where the grid phase doesn't perfectly align.
  //
  // v47.154 FIX: After snapping, re-run panelFits() at the snapped position.
  // Snapping can move a panel outward on a tapered/non-rectangular polygon,
  // pushing corners outside the actual polygon edge even though the original
  // (pre-snap) position passed panelFits(). Panels that fail after snapping
  // are dropped. This fixes the floating panels at the ridge/side of tapered
  // roof planes visible in the screenshot.
  const SNAP_TOL = 0.02; // 2cm
  const snappedFill: Array<{uC: number; vC: number; col: number; row: number}> = [];
  for (const { uC, vC, col, row } of bestFill) {
    let su = uC, sv = vC;
    const hw = dims.widthM  / 2;
    const hh = dims.heightM / 2;
    // Snap U edges
    if (Math.abs((uC - hw) - boundULo) < SNAP_TOL) su = boundULo + hw;
    if (Math.abs((uC + hw) - boundUHi) < SNAP_TOL) su = boundUHi - hw;
    // Snap V edges
    // v50.30: boundVLo = minV + ridgeSetbackM (physical RIDGE end).
    //   ridgeSetbackM > 0 → boundVLo is inside the polygon → V-Lo snap is safe.
    //   ridgeSetbackM === 0 → boundVLo = minV = 0 = polygon boundary → PIP ambiguity.
    //   Guard: skip V-Lo snap when ridgeSetbackM === 0.
    //   (The old guard checked eaveSetbackM; eave/ridge labels are now correct.)
    if (ridgeSetbackM > 0 && Math.abs((vC - hh) - boundVLo) < SNAP_TOL) sv = boundVLo + hh;
    // v50.30: boundVHi = maxV - eaveSetbackM (physical EAVE/gutter end).
    //   eaveSetbackM > 0 → boundVHi is inside the polygon → V-Hi snap is safe.
    //   eaveSetbackM === 0 → boundVHi = maxV = polygon boundary → PIP ambiguity.
    //   Post-shift already places top row at boundVHi - GRID_EPSILON.
    //   Guard: skip V-Hi snap when eaveSetbackM === 0.
    if (eaveSetbackM > 0 && Math.abs((vC + hh) - boundVHi) < SNAP_TOL) sv = boundVHi - hh;
    // v47.154: Re-validate at snapped position (only when snap moved the panel)
    if ((su !== uC || sv !== vC) && !panelFits(su, sv)) continue;
    snappedFill.push({ uC: su, vC: sv, col, row });
  }

  // ── Section 4+7: Single grid, absolute indices, height = plane + normal*0.18m ─
  // Build PlacedPanel[] from snapped fill positions.
  const panels: PlacedPanel[] = [];

  for (const { uC, vC, col, row } of snappedFill) {
    // finalPosition = origin3D + u*uC + v*vC + n*PANEL_OFFSET_ECEF (0.05m — ECEF path, origin already lifted 0.12m)
    const wx = origin.x + ef.u.x * uC + ef.v.x * vC + ef.n.x * PANEL_OFFSET_ECEF;
    const wy = origin.y + ef.u.y * uC + ef.v.y * vC + ef.n.y * PANEL_OFFSET_ECEF;
    const wz = origin.z + ef.u.z * uC + ef.v.z * vC + ef.n.z * PANEL_OFFSET_ECEF;

    const { lat: panelLat, lng: panelLng, height: panelH } = ecefToLatLng({ x: wx, y: wy, z: wz });

    // v48.7: xMeters/yMeters = UV offsets from plane origin (not scalar ECEF components).
    // Previously used ef.u.x*uC (only x-component of u), which gave wrong values on
    // non-cardinal azimuths. uC/vC are already the correct metric UV coordinates.
    const xM = Math.round(uC * 1e4) / 1e4;
    const yM = Math.round(vC * 1e4) / 1e4;

    panels.push({
      id:             uuidv4(),
      layoutId,
      lat:            Math.round(panelLat * 1e7) / 1e7,
      lng:            Math.round(panelLng * 1e7) / 1e7,
      x:              xM,
      y:              yM,
      xMeters:        xM,
      yMeters:        yM,
      xFeet:          uC * FEET_PER_METER,
      yFeet:          vC * FEET_PER_METER,
      widthFeet:      dims.widthM  * FEET_PER_METER,
      heightFeet:     dims.heightM * FEET_PER_METER,
      tilt:           plane.pitch,
      azimuth:        plane.azimuth,
      wattage,
      bifacialGain:   1.0,
      row,
      col,
      height:         isFinite(panelH) ? panelH : 0,
      heading:        sharedHeading,
      pitch:          sharedPitch,
      roll:           sharedRoll,
      orientation,
      systemType:     'roof',
      layoutSource:   'AUTO',
      placementType:  'ROOF',
      planeId:        plane.id,
      gridRow:        row,
      gridCol:        col,
      // v47.143: ECEF frame for exact per-panel orientation in addPanelEntity
      ecefNx: ef.n.x, ecefNy: ef.n.y, ecefNz: ef.n.z,
      ecefUx: ef.u.x, ecefUy: ef.u.y, ecefUz: ef.u.z,
    });
  }

  console.log('[SurfaceGridECEF] v47.145 centered-grid fill', {
    planeId:          plane.id,
    azimuth:          plane.azimuth,
    tilt:             plane.pitch,
    sharedHeading:    sharedHeading,
    sharedPitch:      sharedPitch,
    orientation,
    panelCount:       panels.length,
    bestOffset,
  });

  // v47.145 guard: verify pitch stored on panels matches sharedPitch from planeHPR()
  const misaligned = panels.filter(p => !isFinite(p.pitch!) || Math.abs(p.pitch! - sharedPitch) > 0.001);
  if (misaligned.length > 0) {
    console.error(`[SurfaceGridECEF] ALIGNMENT GUARD: ${misaligned.length} panels have wrong pitch!`,
      { expected: sharedPitch, got: misaligned[0].pitch });
  }

  return panels;
}

// ─── Enrich RoofPlane ─────────────────────────────────────────────────────────

export function enrichRoofPlaneWith3DFrame(plane: RoofPlane): RoofPlane {
  // Only apply if localFrame3D not already set (3D plane tool sets its own)
  if (plane.localFrame3D) return plane;
  const frame = computeSurfaceFrame3D(plane.azimuth, plane.pitch);
  return { ...plane, localFrame3D: { u: frame.u, v: frame.v, n: frame.n } };
}

// ─── Single Panel from Surface Click ─────────────────────────────────────────

/**
 * v47.136: Grid-locked single panel placement.
 *
 * Snaps the click position to the nearest grid cell using:
 *   colIndex = round(dot(clickECEF - origin, u) / stepU)
 *   rowIndex = round(dot(clickECEF - origin, v) / stepV)
 *
 * Then places the panel at the exact grid-snapped position:
 *   worldPos = origin + u*(colIndex*stepU + w/2) + v*(rowIndex*stepV + h/2) + n*PANEL_OFFSET_ECEF
 */
export function placeSinglePanel(
  clickLat:    number,
  clickLng:    number,
  clickHeight: number,
  plane:       RoofPlane,
  orientation: 'portrait' | 'landscape',
  layoutId:    string,
  wattage:     number,
): PlacedPanel {
  const dims = getPanelDims(orientation);
  // v47.151: stepU/stepV must match buildSurfaceGridECEF (panelSpacingM=0, rowSpacingM=0).
  // Hardcoded 0.02/0.05 caused grid-snapping to use wrong cell sizes vs the initial grid.
  const stepU = dims.widthM;   // 0 spacing — matches buildSurfaceGrid call sites
  const stepV = dims.heightM;  // 0 spacing — matches buildSurfaceGrid call sites

  // ── Resolve ECEF frame ─────────────────────────────────────────────────
  const { origin3D: orig, ecefFrame3D: ef } = plane.ecefFrame3D && plane.origin3D
    ? { origin3D: plane.origin3D, ecefFrame3D: plane.ecefFrame3D }
    : (() => { const l = computeEcefFrameForLegacyPlane(plane); return { origin3D: l.origin3D, ecefFrame3D: l.ecefFrame3D }; })();

  // ── Project click onto grid axes ───────────────────────────────────────
  const clickECEF = latLngToECEF(clickLat, clickLng, clickHeight);
  const d = { x: clickECEF.x - orig.x, y: clickECEF.y - orig.y, z: clickECEF.z - orig.z };
  const uProj = d.x * ef.u.x + d.y * ef.u.y + d.z * ef.u.z;
  const vProj = d.x * ef.v.x + d.y * ef.v.y + d.z * ef.v.z;

  // ── Snap to nearest grid index ─────────────────────────────────────────
  const colIndex = Math.round(uProj / stepU);
  const rowIndex = Math.round(vProj / stepV);

  // ── Compute snapped ECEF world position ────────────────────────────────
  const uCenter = colIndex * stepU + dims.widthM  / 2;
  const vCenter = rowIndex * stepV + dims.heightM / 2;

  const wx = orig.x + ef.u.x * uCenter + ef.v.x * vCenter + ef.n.x * PANEL_OFFSET_ECEF;
  const wy = orig.y + ef.u.y * uCenter + ef.v.y * vCenter + ef.n.y * PANEL_OFFSET_ECEF;
  const wz = orig.z + ef.u.z * uCenter + ef.v.z * vCenter + ef.n.z * PANEL_OFFSET_ECEF;
  const { lat: panelLat, lng: panelLng, height: panelH } = ecefToLatLng({ x: wx, y: wy, z: wz });

  // v47.142: Per-plane heading/pitch from resolved ECEF frame — no cross-plane inheritance
  const { heading: sharedHeading, pitch: sharedPitch } = planeHPR(plane, ef, orig);

  return {
    id:             uuidv4(),
    layoutId,
    lat:            Math.round(panelLat * 1e7) / 1e7,
    lng:            Math.round(panelLng * 1e7) / 1e7,
    x:              Math.round(uCenter * 1e4) / 1e4,
    y:              Math.round(vCenter * 1e4) / 1e4,
    xMeters:        Math.round(uCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
    yMeters:        Math.round(vCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
    xFeet:          uCenter * FEET_PER_METER,
    yFeet:          vCenter * FEET_PER_METER,
    widthFeet:      dims.widthM  * FEET_PER_METER,
    heightFeet:     dims.heightM * FEET_PER_METER,
    tilt:           plane.pitch,
    azimuth:        plane.azimuth,
    wattage,
    bifacialGain:   1.0,
    row:            rowIndex,
    col:            colIndex,
    height:         isFinite(panelH) ? panelH : clickHeight + PANEL_OFFSET_ECEF,
    heading:        sharedHeading,
    pitch:          sharedPitch,
    roll:           0,
    orientation,
    systemType:     'roof',
    layoutSource:   'MANUAL',
    placementType:  'ROOF',
    planeId:        plane.id,
    gridRow:        rowIndex,
    gridCol:        colIndex,
    // v47.143: ECEF frame for exact orientation
    ecefNx: ef.n.x, ecefNy: ef.n.y, ecefNz: ef.n.z,
    ecefUx: ef.u.x, ecefUy: ef.u.y, ecefUz: ef.u.z,
  };
}

// ─── Extend Row / Add Row ─────────────────────────────────────────────────────

/**
 * v47.136: Grid-locked Extend Row.
 *
 * Adds ONE panel at (maxRow, maxCol+1) using PURE GRID INDEX math.
 * No reconstruction from anchor lat/lng — position is derived solely from
 * stored gridRow/gridCol indices and the plane's ECEF origin+frame:
 *
 *   worldPos = origin + u*(nextCol*stepU + w/2) + v*(maxRow*stepV + h/2) + n*PANEL_OFFSET_ECEF
 *
 * This eliminates any drift from relative-to-anchor reconstruction.
 */
export function extendRow(
  existingPanels: PlacedPanel[],
  plane:          RoofPlane,
  groundElevM:    number,
  orientation:    'portrait' | 'landscape',
  layoutId:       string,
  wattage:        number,
): PlacedPanel | null {
  const planePanels = existingPanels.filter(p => p.planeId === plane.id);
  if (planePanels.length === 0) return null;

  // ── Resolve ECEF frame ─────────────────────────────────────────────────
  const { origin3D: orig, ecefFrame3D: ef } = plane.ecefFrame3D && plane.origin3D
    ? { origin3D: plane.origin3D, ecefFrame3D: plane.ecefFrame3D }
    : (() => { const l = computeEcefFrameForLegacyPlane(plane, groundElevM); return { origin3D: l.origin3D, ecefFrame3D: l.ecefFrame3D }; })();

  const dims   = getPanelDims(orientation);
  // v47.151: stepU/stepV must match buildSurfaceGridECEF (panelSpacingM=0, rowSpacingM=0).
  // Hardcoded 0.02/0.05 caused positional drift vs the initial grid.
  const stepU  = dims.widthM;   // 0 spacing — matches buildSurfaceGrid call sites
  const stepV  = dims.heightM;  // 0 spacing — matches buildSurfaceGrid call sites

  // v47.142: Per-plane heading/pitch from resolved ECEF frame — no cross-plane inheritance
  const { heading: sharedHeading, pitch: sharedPitch } = planeHPR(plane, ef, orig);

  // ── Get target row/col from stored grid indices ────────────────────────
  const maxRow    = Math.max(...planePanels.map(p => p.gridRow ?? p.row));
  const topRow    = planePanels.filter(p => (p.gridRow ?? p.row) === maxRow);
  const maxCol    = Math.max(...topRow.map(p => p.gridCol ?? p.col));
  const nextCol   = maxCol + 1;
  // v47.151: Anchor panel has absolute uC stored in xFeet (xFeet = uC * FEET_PER_METER).
  // Derive uCenter from anchor absolute position + one stepU, rather than nextCol*stepU
  // which would miss the centered-grid originU offset from buildSurfaceGridECEF.
  const anchorPanel = topRow.find(p => (p.gridCol ?? p.col) === maxCol)!;
  const anchorUC    = anchorPanel.xFeet / FEET_PER_METER;
  const anchorVC    = anchorPanel.yFeet / FEET_PER_METER;

  // ── Absolute position formula (grid-origin-aware) ────────────────────────
  const uCenter = anchorUC + stepU;  // one column right of anchor
  const vCenter = anchorVC;           // same row as anchor

  // ── v48.7: Boundary check ─────────────────────────────────────────────────
  // Project polygon3D into UV space and verify the new panel fits inside.
  // Uses the same ray-cast PIP as buildSurfaceGridECEF.
  const resolvedPoly3D = plane.polygon3D ?? (() => {
    const l = computeEcefFrameForLegacyPlane(plane, groundElevM);
    return l.polygon3D;
  })();
  if (resolvedPoly3D && resolvedPoly3D.length >= 3) {
    const polyUV = resolvedPoly3D.map(p => ({
      u: (p.x - orig.x) * ef.u.x + (p.y - orig.y) * ef.u.y + (p.z - orig.z) * ef.u.z,
      v: (p.x - orig.x) * ef.v.x + (p.y - orig.y) * ef.v.y + (p.z - orig.z) * ef.v.z,
    }));
    const hw = dims.widthM  / 2;
    const hh = dims.heightM / 2;
    // Test all 4 panel corners via ray-cast PIP
    const corners = [
      { cu: uCenter - hw, cv: vCenter - hh },
      { cu: uCenter + hw, cv: vCenter - hh },
      { cu: uCenter + hw, cv: vCenter + hh },
      { cu: uCenter - hw, cv: vCenter + hh },
    ];
    const allInside = corners.every(({ cu, cv }) => {
      const n = polyUV.length;
      let inside = false, j = n - 1;
      for (let i = 0; i < n; j = i++) {
        const ui = polyUV[i].u, vi = polyUV[i].v;
        const uj = polyUV[j].u, vj = polyUV[j].v;
        if ((vi > cv) !== (vj > cv) && cu < (uj - ui) * (cv - vi) / (vj - vi) + ui) {
          inside = !inside;
        }
      }
      return inside;
    });
    if (!allInside) {
      console.warn('[extendRow] New panel position is outside roof polygon — rejecting to prevent off-roof placement.');
      return null;
    }
  }

  const wx = orig.x + ef.u.x * uCenter + ef.v.x * vCenter + ef.n.x * PANEL_OFFSET_ECEF;
  const wy = orig.y + ef.u.y * uCenter + ef.v.y * vCenter + ef.n.y * PANEL_OFFSET_ECEF;
  const wz = orig.z + ef.u.z * uCenter + ef.v.z * vCenter + ef.n.z * PANEL_OFFSET_ECEF;
  const { lat: panelLat, lng: panelLng, height: panelH } = ecefToLatLng({ x: wx, y: wy, z: wz });

  return {
    id:         uuidv4(), layoutId,
    lat:        Math.round(panelLat * 1e7) / 1e7,
    lng:        Math.round(panelLng * 1e7) / 1e7,
    x:          Math.round(uCenter * 1e4) / 1e4,
    y:          Math.round(vCenter * 1e4) / 1e4,
    xMeters:    Math.round(uCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
    yMeters:    Math.round(vCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
    xFeet:      uCenter * FEET_PER_METER, yFeet: vCenter * FEET_PER_METER,
    widthFeet:  dims.widthM  * FEET_PER_METER,
    heightFeet: dims.heightM * FEET_PER_METER,
    tilt:       plane.pitch, azimuth: plane.azimuth,
    wattage, bifacialGain: 1.0,
    row:        maxRow, col: nextCol,
    height:     isFinite(panelH) ? panelH : 0,
    heading:    sharedHeading,
    pitch:      sharedPitch,
    roll:       0,
    orientation, systemType: 'roof', layoutSource: 'MANUAL', placementType: 'ROOF',
    planeId:    plane.id, gridRow: maxRow, gridCol: nextCol,
    // v47.143: ECEF frame for exact orientation
    ecefNx: ef.n.x, ecefNy: ef.n.y, ecefNz: ef.n.z,
    ecefUx: ef.u.x, ecefUy: ef.u.y, ecefUz: ef.u.z,
  };
}

/**
 * v47.136: Grid-locked Add Row.
 *
 * rowIndex is determined by projecting the click position onto the v-axis
 * and snapping to the nearest grid row index:
 *   rowIndex = round(dot(clickECEF - origin, v) / stepV)
 *
 * Then a FULL ROW is generated at that rowIndex spanning the same columns
 * as the widest existing row on the plane. Position formula:
 *   worldPos = origin + u*(col*stepU + w/2) + v*(rowIndex*stepV + h/2) + n*PANEL_OFFSET_ECEF
 *
 * @param clickECEF  Optional ECEF position from scene.pickPosition — used for
 *                   grid-snapping rowIndex. If omitted, falls back to maxRow+1.
 */
export function addRow(
  existingPanels: PlacedPanel[],
  plane:          RoofPlane,
  groundElevM:    number,
  orientation:    'portrait' | 'landscape',
  layoutId:       string,
  wattage:        number,
  clickECEF?:     { x: number; y: number; z: number },
): PlacedPanel[] {
  const planePanels = existingPanels.filter(p => p.planeId === plane.id);
  if (planePanels.length === 0) return [];

  // ── Resolve ECEF frame ──────────────────────────────────────────────────
  const { origin3D: orig, ecefFrame3D: ef } = plane.ecefFrame3D && plane.origin3D
    ? { origin3D: plane.origin3D, ecefFrame3D: plane.ecefFrame3D }
    : (() => { const l = computeEcefFrameForLegacyPlane(plane, groundElevM); return { origin3D: l.origin3D, ecefFrame3D: l.ecefFrame3D }; })();

  const dims   = getPanelDims(orientation);
  // v47.151: stepU/stepV must match buildSurfaceGridECEF (panelSpacingM=0, rowSpacingM=0).
  // Hardcoded 0.02/0.05 caused positional drift vs the initial grid.
  const stepU  = dims.widthM;   // 0 spacing — matches buildSurfaceGrid call sites
  const stepV  = dims.heightM;  // 0 spacing — matches buildSurfaceGrid call sites

  // v47.142: Per-plane heading/pitch from resolved ECEF frame
  const { heading: sharedHeading, pitch: sharedPitch } = planeHPR(plane, ef, orig);

  // ── Determine rowIndex ──────────────────────────────────────────────────
  // If a click position is provided, snap to nearest grid row index.
  // Otherwise, add row above the highest existing row.
  let rowIndex: number;

  if (clickECEF) {
    // Project click position onto v-axis relative to origin
    const d = { x: clickECEF.x - orig.x, y: clickECEF.y - orig.y, z: clickECEF.z - orig.z };
    const vProj = d.x * ef.v.x + d.y * ef.v.y + d.z * ef.v.z;
    rowIndex = Math.round(vProj / stepV);
  } else {
    const maxRow = Math.max(...planePanels.map(p => p.gridRow ?? p.row));
    rowIndex = maxRow + 1;
  }

  // ── Determine column range ──────────────────────────────────────────────
  // Use the same columns as the widest existing row on this plane.
  const maxCol = Math.max(...planePanels.map(p => p.gridCol ?? p.col));
  const minCol = Math.min(...planePanels.map(p => p.gridCol ?? p.col));

  // v47.151: Recover the grid origin anchor from an existing panel's absolute UV coords.
  // xFeet = uC * FEET_PER_METER (set by buildSurfaceGridECEF), so uC = xFeet / FEET_PER_METER.
  // This eliminates the centered-grid originU offset error (was: col*stepU + widthM/2 from 0).
  const refPanel = planePanels.find(p => (p.gridCol ?? p.col) === minCol) ?? planePanels[0];
  const refUC    = refPanel.xFeet / FEET_PER_METER;  // absolute uC of reference column
  const refVC    = refPanel.yFeet / FEET_PER_METER;  // absolute vC of reference row
  const refRow   = refPanel.gridRow ?? refPanel.row;
  const refCol   = refPanel.gridCol ?? refPanel.col;

  // ── Generate full row at rowIndex ───────────────────────────────────────
  const newPanels: PlacedPanel[] = [];

  for (let col = minCol; col <= maxCol; col++) {
    // Absolute position = refPanel absolute UV + delta indices * step
    const uCenter = refUC + (col - refCol) * stepU;
    const vCenter = refVC + (rowIndex - refRow) * stepV;

    const wx = orig.x + ef.u.x * uCenter + ef.v.x * vCenter + ef.n.x * PANEL_OFFSET_ECEF;
    const wy = orig.y + ef.u.y * uCenter + ef.v.y * vCenter + ef.n.y * PANEL_OFFSET_ECEF;
    const wz = orig.z + ef.u.z * uCenter + ef.v.z * vCenter + ef.n.z * PANEL_OFFSET_ECEF;
    const { lat: panelLat, lng: panelLng, height: panelH } = ecefToLatLng({ x: wx, y: wy, z: wz });

    newPanels.push({
      id:         uuidv4(), layoutId,
      lat:        Math.round(panelLat * 1e7) / 1e7,
      lng:        Math.round(panelLng * 1e7) / 1e7,
      x:          Math.round(uCenter * 1e4) / 1e4,
      y:          Math.round(vCenter * 1e4) / 1e4,
      xMeters:    Math.round(uCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
      yMeters:    Math.round(vCenter * 1e4) / 1e4,  // v48.7: UV offset (not scalar component)
      xFeet:      uCenter * FEET_PER_METER, yFeet: vCenter * FEET_PER_METER,
      widthFeet:  dims.widthM  * FEET_PER_METER,
      heightFeet: dims.heightM * FEET_PER_METER,
      tilt:       plane.pitch, azimuth: plane.azimuth,
      wattage, bifacialGain: 1.0,
      row:        rowIndex, col,
      height:     isFinite(panelH) ? panelH : 0,
      heading:    sharedHeading,
      pitch:      sharedPitch,
      roll:       0,
      orientation, systemType: 'roof', layoutSource: 'MANUAL', placementType: 'ROOF',
      planeId:    plane.id, gridRow: rowIndex, gridCol: col,
      // v47.143: ECEF frame for exact orientation
      ecefNx: ef.n.x, ecefNy: ef.n.y, ecefNz: ef.n.z,
      ecefUx: ef.u.x, ecefUy: ef.u.y, ecefUz: ef.u.z,
    });
  }

  // v47.145 guard: verify pitch stored on panels matches sharedPitch from planeHPR()
  const misaligned = newPanels.filter(p => !isFinite(p.pitch!) || Math.abs(p.pitch! - sharedPitch) > 0.001);
  if (misaligned.length > 0) {
    console.error(`[addRow] ALIGNMENT GUARD: ${misaligned.length} panels have wrong pitch!`,
      { expected: sharedPitch, got: misaligned[0].pitch });
  }

  return newPanels;
}