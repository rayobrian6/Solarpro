/**
 * groundMountRealityEngine.ts — GROUND MOUNT REALITY ENGINE v6.0.1
 * ================================================================
 *
 * ⚠️  READ FIRST: ./GROUND_MOUNT_MASTER_SPEC.md
 *     The master spec defines the real-world mechanical model.
 *     All code in this file MUST comply with that spec.
 *
 * THE SINGLE SOURCE OF TRUTH for all ground-mount geometry.
 *
 * ══════════════════════════════════════════════════════════════════════
 * ARCHITECTURE RULES (ENFORCED)
 * ══════════════════════════════════════════════════════════════════════
 *
 *  1. Panel grid is PRIMARY AUTHORITY.
 *     Panels define layout, spacing, orientation, totalPanelH, tableDepth.
 *     NOTHING moves panels after grid generation.
 *
 *  2. Structure is SECONDARY — conforms to panel grid.
 *     Structure must NEVER drive panel placement.
 *
 *  3. Renderer is PASSIVE.
 *     Renderer consumes engine output only.
 *     Renderer must not generate or correct geometry.
 *
 *  4. No floating geometry allowed.
 *     Every component attaches to a real parent surface.
 *     Roof / fence systems are COMPLETELY UNTOUCHED.
 *
 * ══════════════════════════════════════════════════════════════════════
 * SYSTEM HIERARCHY (v6.0 — Surface-Based Mechanical Attachment)
 * ══════════════════════════════════════════════════════════════════════
 *
 *   Pylon (I-beam, vertical, driven into ground)
 *    └── mountPoint (pylon top, where strongback bracket attaches)
 *         └── Strongback (per-pylon N-S component, tilted at array tilt)
 *              └── topSurface (perpendicular to tilt plane, where rails mount)
 *                   └── Rails (continuous E-W, at clamp-zone positions)
 *                        └── Panels (grid-defined, clamp onto rails)
 *
 *   Every child derives its position FROM its parent's surface.
 *   No coordinate-based placement. No vertical approximations.
 *
 * ══════════════════════════════════════════════════════════════════════
 * BUILD SEQUENCE (MANDATORY — v6.0)
 * ══════════════════════════════════════════════════════════════════════
 *
 *   Step 0 — PANEL GRID (deterministic, clearance-anchored)
 *     Panels placed from single grid origin. Defines totalPanelH, tableDepth.
 *
 *   Step 1 — PYLONS (foundation)
 *     One I-beam per bay at N-S midpoint.
 *     Exposes: mountPoint (world position at pylon top)
 *              bodyPoint(frac) → Z on pylon body for strut/brace attachment
 *
 *   Step 2 — STRONGBACKS (per-pylon, N-S, tilted)
 *     Mounts FROM pylon.mountPoint (not independently computed).
 *     Runs south-to-north along tilt axis. Length = totalPanelH.
 *     Exposes: topSurface(frac) → (lat, lng, z) on strongback top face
 *              southEndPoint, northEndPoint (for strut attachment)
 *
 *   Step 3 — STRUTS (per-pylon, south brace)
 *     Upper end: strongback.southEndPoint (derived from strongback)
 *     Lower end: pylon.bodyPoint(PLP_STRUT_FRAC) (derived from pylon)
 *     No independent coordinate computation.
 *
 *   Step 4 — RAILS (continuous E-W, surface-mounted)
 *     Position at each pylon derived FROM strongback.topSurface(railFrac).
 *     Rail Z, lat include surface-normal offset (perpendicular to tilt plane).
 *     Rails span full array width, intersecting every strongback.
 *
 *   Step 5 — (REMOVED v6.1.8: E-W braces do not exist in PLP POWER DRIVE™)
 *
 * ══════════════════════════════════════════════════════════════════════
 * SURFACE-NORMAL GEOMETRY (v6.0 — key mathematical concept)
 * ══════════════════════════════════════════════════════════════════════
 *
 *   The tilt plane normal (pointing up-and-south, toward the sun):
 *     n = (0, -sin(θ), cos(θ))   [in local ENU: East, North, Up]
 *
 *   Strongback top surface = centerline + (SB_H/2) * n
 *   Rail center = SB top surface + (RAIL_H/2) * n
 *   Combined: rail center = SB centerline + (SB_H/2 + RAIL_H/2) * n
 *
 *   This means rails shift SOUTH (by offset * sin(θ)) and UP (by offset * cos(θ))
 *   relative to the strongback centerline — NOT straight up as in v5.8.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PLP POWER DRIVE™ — REAL STRUCTURE (SP3284 RevE)
 * ══════════════════════════════════════════════════════════════════════
 *
 *   Single I-beam pylon per bay, driven at N-S midpoint of array
 *   One tilted N-S strongback per pylon (mounts at pylon top via bracket)
 *   Support strut braces south end of strongback to pylon at ~35% height
 *   4 PX Rails (E-W): 2 rails per portrait row × 2 rows = 4 total
 *
 * SIDE VIEW (looking east):
 *
 *    [N2][N1]  [S2][S1]   ← 4 PX Rails (E-W) on SB top surface
 *     ╲  ╲  ╱  ╱
 *      ═══════════════    ← Strongback (N-S tilted spine, per pylon)
 *          │╲
 *          │  ╲ strut     ← Support strut (SB south end → pylon body)
 *     ════════╪═══════    ← I-beam pylon top (mountPoint)
 *             │
 *    ─────────────────    grade
 *
 * FRONT VIEW (looking north):
 *
 *    [panel][panel][panel]   ← south row (lower)
 *    [panel][panel][panel]   ← north row (higher, behind)
 *    ── rail ── rail ── rail ── (E-W continuous rails)
 *         │       │       │     strongbacks (N-S, one per pylon, behind rails)
 *         ║       ║       ║     I-beams (one per bay, centered)
 *
 * ══════════════════════════════════════════════════════════════════════
 * IRONRIDGE XR1000 — H-FRAME
 * ══════════════════════════════════════════════════════════════════════
 *
 *   Uniform post height on both N and S sides
 *   XR rails run E-W at panel tilt angle, one per row of panels
 *   Posts connected by diagonal leg braces
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type GroundSystemStyle = 'pipe' | 'ironridge';

export interface GroundPanel {
  id: string;
  lat: number;
  lng: number;
  height: number;
  tilt: number;
  azimuth: number;
  arrayRow: number;
  col?: number;
  row?: number;
  systemType: 'ground';
  orientation: 'portrait' | 'landscape';
  wattage?: number;
  heading?: number;
  pitch?: number;
  roll?: number;
}

export interface RackingMember {
  key: string;
  name: string;
  lat: number;
  lng: number;
  z: number;
  headingRad: number;
  pitchRad: number;
  dims: [number, number, number];
  // Cesium HPR box: heading is CW from North. Body axes after heading rotation:
  //   heading=0°  (North): bodyX=East,  bodyY=North → dims[0]=EW, dims[1]=NS
  //   heading=90° (East):  bodyX=North, bodyY=West  → dims[0]=NS, dims[1]=EW  ← hEW
  //   heading=180°(South): bodyX=West,  bodyY=South → dims[0]=EW, dims[1]=NS  ← hNS
  // RULE: length always goes in dims[1], cross-section in dims[0], height in dims[2]
  //   E-W members (hEW=90°):  [cross_section, E-W_length, height]
  //   N-S members (hNS=180°): [cross_section, N-S_length, height]
  //   Vertical piles:         [D, D, height] (symmetric — dims[0,1] irrelevant)
  color: RackingColor;
  memberType: MemberType;
}

export type MemberType =
  | 'pile'        // vertical pipe (N or S row)
  | 'strongback'  // N-S tilted strongback per pylon (v6.0)
  | 'powerrail'   // E-W PX rail on strongback top surface
  | 'xrrail'      // IronRidge XR E-W rail (tilted at panel angle)
  | 'cap'         // top cap rail
  | 'brace';      // strut or cross-brace

export interface RackingColor { r: number; g: number; b: number; a: number; }

// ── Step 1: Pile spec ───────────────────────────────────────────────────
export interface PileSpec {
  id: string;
  lat: number;
  lng: number;
  groundZ: number;
  topZ: number;        // above-grade top of pile
  height: number;      // total above-grade height
  row: 'south' | 'north' | 'uniform';
  bayIndex: number;
  // v6.0: Mechanical attachment point — where strongback bracket attaches
  mountPoint: { lat: number; lng: number; z: number };
}

// ── Step 2: Strongback spec ─────────────────────────────────────────────
export interface StrongbackSpec {
  id: string;
  lat: number;
  lng: number;
  z: number;           // centerline Z at midpoint (= pylon.mountPoint.z)
  lengthM: number;     // slant length along tilt axis (= totalPanelH)
  row: 'south' | 'north' | 'uniform';
  pileIds: string[];   // exactly one pylon per strongback
  // v6.0: Mechanical endpoints (derived from pylon.mountPoint + tilt geometry)
  southEnd: { lat: number; lng: number; z: number };
  northEnd: { lat: number; lng: number; z: number };
}

// ── Step 3: Rail spec ───────────────────────────────────────────────────
export interface RailSpec {
  id: string;
  startLat: number; startLng: number; startZ: number;
  endLat: number;   endLng: number;   endZ: number;
  midLat: number;   midLng: number;   midZ: number;
  lengthM: number;
  pitchRad: number;
  headingRad: number;
  railType: 'powerrail' | 'xrrail';
  strongbackIds: string[];  // which strongbacks this rail sits on
  // v6.0: Surface attachment metadata
  mountFrac: number;  // fractional position along strongback (0=south, 1=north)
}

// ── Panel attach point ──────────────────────────────────────────────────
export interface PanelAttachPoint {
  panelId: string;
  railIds: string[];   // at least 2 rail attachment points required
  clampZone: 'left' | 'right' | 'center';
}

// ── Full output contract ────────────────────────────────────────────────
export interface GroundSystemOutput {
  piles:             PileSpec[];
  strongbacks:       StrongbackSpec[];
  rails:             RailSpec[];
  members:           RackingMember[];   // flat renderable list
  panelAttachPoints: PanelAttachPoint[];
  valid:             boolean;
  errors:            string[];
  debugLog:          string[];
  groundZ:           number;
  sPostTopZ:         number;
  nPostTopZ:         number;
  sRailZ:            number;
  nRailZ:            number;
  tableDepthM:       number;
  baySpanM:          number;
  // v5.4: Grid-corrected panel positions (deterministic, drift-free).
  // Renderer MUST use these instead of raw planeEngine panel positions.
  correctedPanels:   GroundPanel[];
  // v5.5: Clearance diagnostics
  lowSideClearanceM:  number;
  highSideClearanceM: number;
  solvedPlaneZ:       number;
  pylonHeightRange:   [number, number];
}

export interface BuildRackingOptions {
  style: GroundSystemStyle;
  panels: GroundPanel[];
  basePlaneZ: number;
  tiltDeg: number;
  azimuthDeg: number;
  orientation: 'portrait' | 'landscape';
  /** v6.2.2: Unique prefix for racking entity keys. Prevents key collisions
   *  between multiple finalized ground arrays. Default: '' (no prefix). */
  keyPrefix?: string;
}

// Legacy alias — renderer uses GroundRackingResult for backward compat
export type GroundRackingResult = GroundSystemOutput;

// ─── Constants ──────────────────────────────────────────────────────────

export const PLP_BAY_SPAN_M = 6.10;   // ~20ft between pile pairs
export const XR_BAY_SPAN_M  = 3.66;   // ~12ft between pile pairs
export const PLP_ROW_COUNT  = 2;       // portrait rows per table
export const XR_ROW_COUNT   = 4;       // landscape rows per array
export const MOUNT_HEIGHT_M = 1.2;     // south pile height above grade (~4ft) [legacy, kept for XR]
export const PLP_MIN_PANEL_CLEARANCE_M = 0.6096; // 24 inches
export const PLP_MAX_SPAN_M = 7.32;    // engineering max bay span for PLP
export const XR_MAX_SPAN_M  = 4.88;    // engineering max bay span for XR

export const PW_PORTRAIT   = 1.134;
export const PH_PORTRAIT   = 1.722;
export const PW_LANDSCAPE  = 1.722;
export const PH_LANDSCAPE  = 1.134;
export const PANEL_THICKNESS = 0.040;
export const PLANE_ENGINE_PANEL_OFFSET_M = 0.05;

// Member cross-section sizes (manufacturer spec)
export const VERT_PIPE_D   = 0.073;  // 2.5" Sch40 OD (~73mm)
export const HORIZ_PIPE_D  = 0.060;  // 2" Sch40 OD (~60mm)
export const POWER_RAIL_H  = 0.065;  // Power Rail height (C-channel)
export const POWER_RAIL_W  = 0.040;  // Power Rail width
export const BRACE_D       = 0.038;  // cross-brace tube OD
export const XR_RAIL_H     = 0.045;
export const XR_RAIL_W     = 0.030;

// ── PLP POWER DRIVE™ members (SP3284-3) ──────────────────────────────────
export const PLP_IBEAM_W   = 0.102;   // ~4" EW flange width (W6x12)
export const PLP_IBEAM_D   = 0.152;   // ~6" NS web depth (W6 series)
export const PLP_SB_W      = 0.064;   // ~2.5" strongback width (structural stack math)
export const PLP_SB_H      = 0.089;   // ~3.5" strongback height (structural stack math)
// v6.1.1: Visual dims for rendering — larger than structural dims so SB reads
// as a real mounted component at typical Cesium zoom levels.
// Structural stack math (solveClearancePlane, railMountPoint) still uses PLP_SB_H/W.
// v6.1.7: Removed overscaled visual dims. Strongback renders at structural size.
// PLP_SB_W (64mm) and PLP_SB_H (89mm) used directly — no visual inflation.
export const PLP_STRUT_D   = 0.038;   // strut tube OD
export const PLP_RAIL_W    = 0.038;   // PX rail width
export const PLP_RAIL_H    = 0.051;   // PX rail height
export const PLP_STRUT_FRAC = 0.35;   // strut attachment at 35% pylon height
export type PLPSupportMode = 'single_strut_cantilever' | 'dual_strut';
export const PLP_SUPPORT_MODE: PLPSupportMode = 'single_strut_cantilever';
export const PLP_CLAMP_INSET_FRAC = 0.15;
export const PLP_MAX_CANTILEVER_M = 1.50;
export const PLP_PANEL_COL_GAP_M  = 0.00;

// v6.0: Surface attachment tolerance
export const SURFACE_ATTACH_TOLERANCE_M = 0.005; // 5mm

// ── Debug Mode Toggle (v6.2.2 TASK 2) ─────────────────────────────────────
// Set to true for distinct per-component debug colors (RED/BLUE/YELLOW/ORANGE).
// Set to false for production neutral steel palette.
export const GROUND_MOUNT_DEBUG = false;

// Debug palette: distinct colors per component type for render-truth audit
const DEBUG_COLOR_PILE:       RackingColor = { r: 0.85, g: 0.15, b: 0.15, a: 1.0 };  // RED — pylons
const DEBUG_COLOR_STRONGBACK: RackingColor = { r: 0.15, g: 0.30, b: 0.90, a: 1.0 };  // BLUE — strongbacks
const DEBUG_COLOR_RAIL:       RackingColor = { r: 0.95, g: 0.85, b: 0.10, a: 1.0 };  // YELLOW — rails
const DEBUG_COLOR_BRACE:      RackingColor = { r: 0.95, g: 0.50, b: 0.10, a: 1.0 };  // ORANGE — struts/braces

// Production palette: neutral galvanized steel tones
const PROD_COLOR_PILE:       RackingColor = { r: 0.55, g: 0.56, b: 0.58, a: 1.0 };  // Steel gray — pylons
const PROD_COLOR_STRONGBACK: RackingColor = { r: 0.60, g: 0.61, b: 0.63, a: 1.0 };  // Light steel — strongbacks
const PROD_COLOR_RAIL:       RackingColor = { r: 0.62, g: 0.63, b: 0.65, a: 1.0 };  // Silver — rails
const PROD_COLOR_BRACE:      RackingColor = { r: 0.52, g: 0.53, b: 0.55, a: 1.0 };  // Dark steel — struts/braces

// Active palette — gated on GROUND_MOUNT_DEBUG
export const COLOR_PILE:       RackingColor = GROUND_MOUNT_DEBUG ? DEBUG_COLOR_PILE       : PROD_COLOR_PILE;
export const COLOR_STRONGBACK: RackingColor = GROUND_MOUNT_DEBUG ? DEBUG_COLOR_STRONGBACK : PROD_COLOR_STRONGBACK;
export const COLOR_RAIL:       RackingColor = GROUND_MOUNT_DEBUG ? DEBUG_COLOR_RAIL       : PROD_COLOR_RAIL;
export const COLOR_BRACE:      RackingColor = GROUND_MOUNT_DEBUG ? DEBUG_COLOR_BRACE      : PROD_COLOR_BRACE;
export const COLOR_XR:         RackingColor = { r: 0.50, g: 0.55, b: 0.65, a: 1.0 };
export const COLOR_HORIZ = COLOR_STRONGBACK;

// ─── Math helpers ───────────────────────────────────────────────────────

const DEG = Math.PI / 180;
const MPD = 111320; // meters per degree latitude

function mpdLng(lat: number) { return MPD * Math.cos(lat * DEG); }

function distM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dlat = (lat2 - lat1) * MPD;
  const dlng = (lng2 - lng1) * mpdLng(lat1);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function midpt(lat1: number, lng1: number, lat2: number, lng2: number) {
  return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
}

function panelDims(o: 'portrait' | 'landscape') {
  return o === 'landscape'
    ? { pw: PW_LANDSCAPE, ph: PH_LANDSCAPE }
    : { pw: PW_PORTRAIT,  ph: PH_PORTRAIT  };
}

function hRad(azDeg: number): number { return azDeg * DEG; }

export function withinTableRowSpacingM(panelH: number, tiltDeg: number): number {
  return panelH * Math.cos(tiltDeg * DEG);
}

// ─── Member builder ─────────────────────────────────────────────────────

function mbr(
  key: string, name: string,
  lat: number, lng: number, z: number,
  heading: number, pitch: number,
  dims: [number, number, number],
  color: RackingColor,
  memberType: MemberType,
): RackingMember {
  return { key, name, lat, lng, z, headingRad: heading, pitchRad: pitch, dims, color, memberType };
}

// ─── Row sort ───────────────────────────────────────────────────────────

function sortRows(panels: GroundPanel[]): Array<[number, GroundPanel[]]> {
  const map = new Map<number, GroundPanel[]>();
  for (const p of panels) {
    const r = p.arrayRow ?? 0;
    if (!map.has(r)) map.set(r, []);
    map.get(r)!.push(p);
  }
  map.forEach(rp => rp.sort((a, b) => (a.col ?? 0) - (b.col ?? 0)));
  return Array.from(map.entries()).sort((a, b) => {
    const avgA = a[1].reduce((s, p) => s + p.lat, 0) / a[1].length;
    const avgB = b[1].reduce((s, p) => s + p.lat, 0) / b[1].length;
    return avgA - avgB; // south first
  });
}

// ─── Bay column selection ───────────────────────────────────────────────

function bayColumns(row: GroundPanel[], spanM: number): number[] {
  const n = row.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const set = new Set<number>([0, n - 1]);
  if (n > 2) {
    const f = row[0];
    const posM = row.map(p => distM(f.lat, f.lng, p.lat, p.lng));
    let last = 0;
    for (let i = 1; i < n - 1; i++) {
      if (posM[i] - last >= spanM) { set.add(i); last = posM[i]; }
    }
  }
  return [...set].sort((a, b) => a - b);
}


// ══════════════════════════════════════════════════════════════════════════
// v6.0 SURFACE MODEL — Mechanical Attachment Helpers
// ══════════════════════════════════════════════════════════════════════════
//
// These functions compute exact attachment points on parent surfaces.
// They replace all coordinate-based offset logic from v5.x.
//
// TILT PLANE NORMAL (pointing up-and-south, toward the sun):
//   n = (east=0, north=-sin(θ), up=cos(θ))
//
// This is the direction perpendicular to the tilted panel/strongback surface,
// facing away from the ground (sun-facing side). Rails and panels sit on this side.

/**
 * Tilt plane surface normal for a given tilt angle and azimuth.
 * Returns { dLatPerM, dLngPerM, z } — the full 3D normal direction
 * accounting for array azimuth rotation.
 *
 * The normal points toward the sun (azimuth direction) and upward.
 * For az=180° (south-facing): normal = (south, up) — matches v6.0 behavior exactly.
 * For any azimuth: normal rotates with the array face direction.
 *
 * v6.2.1: Made azimuth-aware to fix spec-level endpoint and strut errors at az≠180°.
 */
function tiltNormal(tiltRad: number, azimuthDeg: number, refLat: number): { dLatPerM: number; dLngPerM: number; z: number } {
  const azRad = azimuthDeg * DEG;
  const sinT = Math.sin(tiltRad);
  // Normal points in azimuth direction (toward sun) projected by sin(tilt), plus up by cos(tilt).
  // Azimuth direction in lat/lng: lat = cos(az)/MPD, lng = sin(az)/mpdLng
  // Normal = -sin(tilt) * azimuth_hat + cos(tilt) * up_hat
  // (negative because normal points TOWARD sun = same as azimuth, but sign convention:
  //  azimuth=180° → cos(180°)=-1 → dLat = -sinT * (-1) / MPD = +sinT/MPD... wait.
  //  Let's be precise: for az=180°, sun is south. Normal points south.
  //  South = lat decreasing = negative lat direction.
  //  cos(180°) = -1, so: dLatPerM = sinT * cos(azRad) / MPD = sinT * (-1) / MPD = -sinT/MPD ✓ (south)
  //  sin(180°) = 0, so: dLngPerM = 0 ✓
  return {
    dLatPerM: sinT * Math.cos(azRad) / MPD,
    dLngPerM: sinT * Math.sin(azRad) / mpdLng(refLat),
    z:        Math.cos(tiltRad),
  };
}

/**
 * Point on the strongback centerline at a given fraction.
 * frac: 0 = south end (low/sun-facing), 0.5 = center (at pylon mountPoint), 1 = north end (high/back)
 *
 * The strongback runs along the ANTI-AZIMUTH direction (tilt axis):
 *   frac=0 → azimuth direction (sun-facing, low)
 *   frac=1 → anti-azimuth direction (back side, high)
 *
 * Horizontal displacement per unit slant: cos(θ) along anti-azimuth axis.
 * Vertical displacement per unit slant: sin(θ) upward.
 *
 * v6.2.1: Made azimuth-aware. Previously moved only along latitude (correct only at az=180°).
 *         Now moves along the true anti-azimuth direction in both lat and lng.
 */
function sbCenterlinePoint(
  mountLat: number, mountLng: number, mountZ: number,
  totalPanelH: number, tiltRad: number, frac: number,
  azimuthDeg: number,
): { lat: number; lng: number; z: number } {
  const fracFromCenter = frac - 0.5;
  const horizDist = fracFromCenter * totalPanelH * Math.cos(tiltRad);
  // Anti-azimuth direction (from sun-side/low toward back/high)
  const azRad = azimuthDeg * DEG;
  const antiAzLatPerM = -Math.cos(azRad) / MPD;        // for az=180°: +1/MPD (north) ✓
  const antiAzLngPerM = -Math.sin(azRad) / mpdLng(mountLat);  // for az=180°: 0 ✓
  return {
    lat: mountLat + horizDist * antiAzLatPerM,
    lng: mountLng + horizDist * antiAzLngPerM,
    z:   mountZ   + fracFromCenter * totalPanelH * Math.sin(tiltRad),
  };
}

/**
 * Rail mount point at a given strongback fraction.
 * = SB centerline + (SB_H/2 + RAIL_H/2) along tilt normal.
 * This places the rail center exactly on the strongback top surface.
 *
 * v6.2.1: Made azimuth-aware (via sbCenterlinePoint + tiltNormal updates).
 */
function railMountPoint(
  mountLat: number, mountLng: number, mountZ: number,
  totalPanelH: number, tiltRad: number, frac: number,
  azimuthDeg: number,
): { lat: number; lng: number; z: number } {
  const center = sbCenterlinePoint(mountLat, mountLng, mountZ, totalPanelH, tiltRad, frac, azimuthDeg);
  const n = tiltNormal(tiltRad, azimuthDeg, mountLat);
  const offset = PLP_SB_H / 2 + PLP_RAIL_H / 2;
  return {
    lat: center.lat + offset * n.dLatPerM,
    lng: center.lng + offset * n.dLngPerM,
    z:   center.z   + offset * n.z,
  };
}

/**
 * Point on the pylon body at a given height fraction.
 * frac: 0 = ground, 1 = pylon top (mountPoint)
 */
function pylonBodyPoint(
  pylonLat: number, pylonLng: number,
  groundZ: number, pylonH: number, frac: number,
): { lat: number; lng: number; z: number } {
  return { lat: pylonLat, lng: pylonLng, z: groundZ + frac * pylonH };
}


// ─── Validation Engine ──────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateBuildOutput(
  piles: PileSpec[],
  strongbacks: StrongbackSpec[],
  rails: RailSpec[],
  members: RackingMember[],
  maxSpanM: number,
  debugLog: string[],
): ValidationResult {
  const errors: string[] = [];

  // Rule 1: Must have at least 1 pile
  if (piles.length === 0) errors.push('FAIL: No piles generated');

  // Rule 2: Must have at least 1 strongback
  if (strongbacks.length === 0) errors.push('FAIL: No strongbacks generated');

  // Rule 3: Must have at least 1 rail
  if (rails.length === 0) errors.push('FAIL: No rails generated');

  // Rule 4: Adjacent pile span check
  const southPiles = piles.filter(p => p.row === 'south' || p.row === 'uniform');
  for (let i = 0; i < southPiles.length - 1; i++) {
    const span = distM(southPiles[i].lat, southPiles[i].lng, southPiles[i+1].lat, southPiles[i+1].lng);
    if (span > maxSpanM * 1.05) {
      errors.push(`WARN: Bay span ${span.toFixed(2)}m exceeds max ${maxSpanM}m between pile ${i} and ${i+1}`);
    }
  }

  // Rule 5: No floating rails
  const sbIds = new Set(strongbacks.map(s => s.id));
  for (const rail of rails) {
    for (const sbId of rail.strongbackIds) {
      if (!sbIds.has(sbId)) errors.push(`FAIL: Rail ${rail.id} references unknown strongback ${sbId}`);
    }
  }

  // Rule 6: Rails must have positive length
  for (const rail of rails) {
    if (rail.lengthM < 0.1) errors.push(`FAIL: Rail ${rail.id} near-zero length ${rail.lengthM.toFixed(3)}m`);
  }

  // Rule 7: Pylon minimum height
  for (const pile of piles) {
    if (pile.height < 0.3) errors.push(`FAIL: Pylon ${pile.id} height ${pile.height.toFixed(3)}m < 0.3m`);
  }

  // Rule 8: strongback count === uniform pylon count
  const uniformPiles = piles.filter(p => p.row === 'uniform');
  if (strongbacks.length > 0 && uniformPiles.length > 0 && strongbacks.length !== uniformPiles.length) {
    errors.push(`FAIL: Strongback count (${strongbacks.length}) !== pylon count (${uniformPiles.length})`);
  }
  // No multi-pylon strongbacks
  for (const sb of strongbacks) {
    if (sb.pileIds && sb.pileIds.length > 1) {
      errors.push(`FAIL: Strongback ${sb.id} spans ${sb.pileIds.length} pylons — must be 1`);
    }
  }

  // Rule 9: PLP rail count multiple of 4
  if (rails.length > 0 && rails.length % 4 !== 0) {
    errors.push(`WARN: Rail count ${rails.length} not a multiple of 4`);
  }

  // Rule 10: Each strongback has pile reference
  for (const sb of strongbacks) {
    if (!sb.pileIds || sb.pileIds.length === 0) errors.push(`WARN: Strongback ${sb.id} has no pile references`);
  }

  // Rule 11: Strut geometry validation
  for (const m of members) {
    if (typeof m.key === 'string' && m.key.includes('__gnd__strut_')) {
      const pylonTopZ = piles.length > 0 ? Math.max(...piles.map(p => p.topZ)) : m.z + 1;
      const gZ = piles.length > 0 ? piles[0].groundZ : 0;
      if (m.z <= gZ || m.z >= pylonTopZ) {
        errors.push(`FAIL: Strut ${m.key} midZ=${m.z.toFixed(3)} not in (${gZ.toFixed(3)}, ${pylonTopZ.toFixed(3)})`);
      }
    }
  }

  // Rule 12: Cantilever check
  for (const sb of strongbacks) {
    if (sb.pileIds && sb.pileIds.length > 0) {
      const sbPiles = piles.filter(p => sb.pileIds.includes(p.id));
      if (sbPiles.length >= 2) {
        const lngs = sbPiles.map(p => p.lng);
        const rowSpanApprox = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(sbPiles[0].lat * DEG);
        const cantilever = (sb.lengthM - rowSpanApprox) / 2;
        if (cantilever > PLP_MAX_CANTILEVER_M * 1.1) {
          errors.push(`WARN: Strongback ${sb.id} cantilever ${cantilever.toFixed(2)}m exceeds max`);
        }
      }
    }
  }

  // Rule 13: Strongback Z uniformity
  const sbMbrs = members.filter(m => m.memberType === 'strongback');
  if (sbMbrs.length > 1) {
    const sbZSpread = Math.max(...sbMbrs.map(m => m.z)) - Math.min(...sbMbrs.map(m => m.z));
    if (sbZSpread > 0.005) {
      errors.push(`WARN: Strongback Z spread ${sbZSpread.toFixed(4)}m — grid drift suspected`);
    }
  }

  // Rule 15: Pile height ≥ clearance
  for (const pile of piles) {
    if (pile.row === 'uniform' && pile.height < PLP_MIN_PANEL_CLEARANCE_M) {
      errors.push(`FAIL: Pylon ${pile.id} height ${pile.height.toFixed(3)}m < clearance ${PLP_MIN_PANEL_CLEARANCE_M}m`);
    }
  }

  // Rule 16: Clearance diagnostics
  const pylonHeights = piles.filter(p => p.row === 'uniform').map(p => p.height);
  if (pylonHeights.length > 0) {
    debugLog.push(`[CLEARANCE v6.0] pylon height range: ${Math.min(...pylonHeights).toFixed(3)}m – ${Math.max(...pylonHeights).toFixed(3)}m`);
  }

  // ── v6.0 SURFACE ATTACHMENT RULES ──────────────────────────────────────

  // Rule 17: Strongback must have mechanical endpoints
  for (const sb of strongbacks) {
    if (!sb.southEnd || !sb.northEnd) {
      errors.push(`FAIL: Strongback ${sb.id} missing mechanical endpoints (v6.0)`);
    }
  }

  // Rule 18: Strongback center Z must equal parent pylon mountPoint Z
  const pileMap = new Map(piles.map(p => [p.id, p]));
  for (const sb of strongbacks) {
    const parent = pileMap.get(sb.pileIds[0]);
    if (parent) {
      const zDiff = Math.abs(sb.z - parent.mountPoint.z);
      if (zDiff > SURFACE_ATTACH_TOLERANCE_M) {
        errors.push(`FAIL: SB ${sb.id} centerZ=${sb.z.toFixed(4)} ≠ pylon.mountPoint.z=${parent.mountPoint.z.toFixed(4)} (Δ${zDiff.toFixed(4)}m)`);
      }
    }
  }

  // Rule 19: Rails must intersect ALL strongbacks
  if (strongbacks.length > 0 && rails.length > 0) {
    const allSbSet = new Set(strongbacks.map(s => s.id));
    for (const rail of rails) {
      const railSbSet = new Set(rail.strongbackIds);
      for (const sbId of allSbSet) {
        if (!railSbSet.has(sbId)) {
          errors.push(`FAIL: Rail ${rail.id} does not intersect strongback ${sbId} (v6.0)`);
        }
      }
    }
  }

  // Rule 20: No orphan components
  const pileIdSet = new Set(piles.map(p => p.id));
  for (const sb of strongbacks) {
    for (const pid of sb.pileIds) {
      if (!pileIdSet.has(pid)) errors.push(`FAIL: SB ${sb.id} references non-existent pile ${pid} (v6.0)`);
    }
  }

  const hasFatal = errors.some(e => e.startsWith('FAIL'));
  if (errors.length > 0) {
    errors.forEach(e => debugLog.push(`[VALIDATE] ${e}`));
  } else {
    debugLog.push(`[VALIDATE] PASS — ${piles.length} piles, ${strongbacks.length} SBs, ${rails.length} rails`);
  }

  return { valid: !hasFatal, errors };
}


// ══════════════════════════════════════════════════════════════════════════
// CLEARANCE PLANE SOLVER (v5.5, unchanged)
// ══════════════════════════════════════════════════════════════════════════

interface ClearancePlane {
  sbSouthZ:      number;
  sbNorthZ:      number;
  sbCenterZ:     number;
  pylonH:        number;
  pylonTopZ:     number;
  panelOriginZ:  number;
  tableRise:     number;
}

function solveClearancePlane(
  groundZ: number, tiltRad: number, panelH: number, clearanceM: number,
): ClearancePlane {
  const sinT        = Math.sin(tiltRad);
  const cosT        = Math.cos(tiltRad);
  const totalPanelH = PLP_ROW_COUNT * panelH;
  const tableRise   = totalPanelH * sinT;

  // Panel plane: south bottom edge sits at clearance height above ground.
  // Panel centers lie on a tilted plane starting from panelBotEdgeZ.
  const panelBotEdgeZ = groundZ + clearanceM;
  const panelOriginZ  = panelBotEdgeZ;

  // Panel plane midpoint (N-S center): Z of the panel plane at frac=0.5
  const panelMidZ = panelBotEdgeZ + 0.5 * totalPanelH * sinT;

  // v6.0.1 FIX: Structure sits BELOW the panel plane.
  // v6.3.2: Physical stack (measured along tilt-plane normal, from SB center to panel bottom):
  //   SB_H/2 (SB center → SB top surface) + RAIL_H (rail full height) + PANEL_THICKNESS/2
  // The vertical component of this offset lowers the SB centerline below panels.
  // This ensures: rail top = panel bottom surface (panels sit ON rails, rails never poke through).
  // Old formula omitted PANEL_THICKNESS/2, causing rail tops to coincide with panel CENTER
  // rather than panel BOTTOM — rails protruded 20mm into the panel box.
  const stackNormal   = PLP_SB_H / 2 + PLP_RAIL_H + PANEL_THICKNESS / 2;  // along tilt normal
  const stackVertical = stackNormal * cosT;                   // vertical drop

  const sbCenterZ     = panelMidZ - stackVertical;
  const sbSouthZ      = sbCenterZ - tableRise / 2;
  const sbNorthZ      = sbCenterZ + tableRise / 2;
  const pylonH        = sbCenterZ - groundZ;
  const pylonTopZ     = groundZ + pylonH;

  return { sbSouthZ, sbNorthZ, sbCenterZ, pylonH, pylonTopZ, panelOriginZ, tableRise };
}


// ——— Panel Grid Authority (v6.0.1 — azimuth-aligned, structure-derived) ———

interface GridPanel extends GroundPanel {
  gridRow: number;
  gridCol: number;
}

/**
 * buildPanelGrid — v6.0.1 REWRITE
 *
 * Derives panel positions from a deterministic grid aligned to the
 * STRUCTURAL axes (rail direction = E-W axis, tilt direction = N-S axis).
 *
 * Grid formula (per panel):
 *   position = origin + col * colStep * ewAxis + row * rowDepth * nsAxis
 *   height   = originZ + nsDistanceM * tan(tilt)
 *
 * Axes are defined by azimuthDeg:
 *   nsAxis = anti-azimuth direction (from sun-facing/low edge toward back/high edge)
 *   ewAxis = perpendicular to nsAxis (rail direction — typically east)
 *
 * This ensures panels align perfectly with rails and strongbacks
 * regardless of array azimuth.
 */
function buildPanelGrid(
  panels: GroundPanel[], panelW: number, panelH: number,
  tiltRad: number, colGapM: number, azimuthDeg: number,
  forcedOriginZ?: number,
): GridPanel[] {
  if (panels.length === 0) return [];

  const cosT      = Math.cos(tiltRad);
  const tanT      = Math.tan(tiltRad);
  const colStepM  = panelW + colGapM;
  const rowDepthM = panelH * cosT;  // horizontal depth per row along tilt axis

  // Azimuth-aligned unit vectors (in meters → degrees conversion)
  //
  // v6.1 FIX: nsAxis points ANTI-azimuth (from LOW/sun-facing edge toward HIGH/back edge).
  //   For az=180° (south-facing): nsAxis points NORTH = (lat: +1/MPD, lng: 0)
  //   Row 0 is at the LOW (sun-facing) side, row N is at the HIGH side.
  //   Increasing arrayRow moves AWAY from sun → ANTI-azimuth direction.
  //   Height still increases with nsM (row 1 higher than row 0) via nsM * tan(tilt).
  //
  // ewAxis: perpendicular to tilt direction (rail direction) = azimuth - 90°
  //   For az=180°: ewAxis points EAST = (lat: 0, lng: +1/(MPD*cosLat))
  //   Matches structural hEW = hRad(azimuthDeg - 90)
  //   ewAxis is independent of nsAxis flip — defined directly from azimuth.
  const azRad = azimuthDeg * DEG;
  // nsAxis = anti-azimuth direction (from front/low toward back/high)
  const nsLat = -Math.cos(azRad);  // anti-azimuth lat component
  const nsLng = -Math.sin(azRad);  // anti-azimuth lng component
  // ewAxis = azimuth - 90° (rail direction, unchanged)
  const ewLat =  Math.sin(azRad);  // = cos(azRad - π/2)
  const ewLng = -Math.cos(azRad);  // = sin(azRad - π/2)

  // Anchor: find the panel with lowest arrayRow, then lowest col
  const anchor = panels.reduce((best, p) => {
    const ar = p.arrayRow ?? 0, ac = p.col ?? 0;
    const br = best.arrayRow ?? 0, bc = best.col ?? 0;
    if (ar < br) return p;
    if (ar === br && ac < bc) return p;
    return best;
  }, panels[0]);

  const anchorRow = anchor.arrayRow ?? 0;
  const anchorCol = anchor.col      ?? 0;
  const cosAnchorLat = Math.cos(anchor.lat * Math.PI / 180);

  // Anchor's offset from grid origin (row=0, col=0 corner) in meters
  const anchorNS = anchorRow * rowDepthM + rowDepthM / 2;  // along tilt axis
  const anchorEW = anchorCol * colStepM  + colStepM  / 2;  // along rail axis

  // Grid origin: back-project anchor position to (row=0, col=0) corner
  const originLat = anchor.lat - (anchorNS * nsLat + anchorEW * ewLat) / MPD;
  const originLng = anchor.lng - (anchorNS * nsLng + anchorEW * ewLng) / (MPD * cosAnchorLat);
  const originZ   = forcedOriginZ !== undefined
    ? forcedOriginZ
    : anchor.height - anchorNS * tanT;

  const cosOriginLat = Math.cos(originLat * Math.PI / 180);

  return panels.map(p => {
    const gr = p.arrayRow ?? 0;
    const gc = p.col      ?? 0;
    // Distance along each structural axis (meters)
    const nsM = gr * rowDepthM + rowDepthM / 2;  // along tilt direction
    const ewM = gc * colStepM  + colStepM  / 2;  // along rail direction

    // Convert to lat/lng using azimuth-aligned axes
    const dLat = (nsM * nsLat + ewM * ewLat) / MPD;
    const dLng = (nsM * nsLng + ewM * ewLng) / (MPD * cosOriginLat);

    return {
      ...p,
      lat:     originLat + dLat,
      lng:     originLng + dLng,
      height:  originZ   + nsM * tanT,
      gridRow: gr,
      gridCol: gc,
    };
  });
}



// ══════════════════════════════════════════════════════════════════════════
// PLP POWER DRIVE™ — BUILD SEQUENCE v6.0 (Surface-Based Mechanical Attachment)
// ══════════════════════════════════════════════════════════════════════════

function buildPLPStructure(
  frontRow: GroundPanel[], backRow: GroundPanel[],
  basePlaneZ: number, tiltDeg: number, azimuthDeg: number,
  panelH: number, panelW: number, debugLog: string[],
  kp: string,  // v6.2.2: key prefix for unique racking entity keys
): { members: RackingMember[]; piles: PileSpec[]; strongbacks: StrongbackSpec[]; rails: RailSpec[] } {

  const members:     RackingMember[]  = [];
  const piles:       PileSpec[]       = [];
  const strongbacks: StrongbackSpec[] = [];
  const rails:       RailSpec[]       = [];

  const tiltRad = tiltDeg * DEG;
  const sinT    = Math.sin(tiltRad);
  const cosT    = Math.cos(tiltRad);
  const groundZ = basePlaneZ;

  // ── v5.5: Solve panel plane from minimum clearance rule ────────────────
  const cp = solveClearancePlane(groundZ, tiltRad, panelH, PLP_MIN_PANEL_CLEARANCE_M);

  // ── STEP 0: PANEL GRID AUTHORITY (v5.4, unchanged) ─────────────────────
  const _gridFront = buildPanelGrid(
    frontRow, panelW, panelH, tiltRad, PLP_PANEL_COL_GAP_M, azimuthDeg, cp.panelOriginZ,
  );
  const gFrontRow = _gridFront.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));

  const hasRealBackRow = backRow.some(p => (p.arrayRow ?? 0) !== 0);
  let gBackRow: GridPanel[];
  if (hasRealBackRow) {
    const _gridBack = buildPanelGrid(
      backRow, panelW, panelH, tiltRad, PLP_PANEL_COL_GAP_M, azimuthDeg, cp.panelOriginZ,
    );
    gBackRow = _gridBack.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
  } else {
    // Synthesize back row: offset along ANTI-azimuth direction (away from sun)
    // v6.1: back row is behind front row = anti-azimuth direction
    const tableDepthM = PLP_ROW_COUNT * panelH * cosT;
    const azRad = azimuthDeg * DEG;
    const nsLatPerM = -Math.cos(azRad);  // anti-azimuth
    const nsLngPerM = -Math.sin(azRad);  // anti-azimuth
    const cosLat = Math.cos((gFrontRow[0]?.lat ?? 0) * Math.PI / 180);
    gBackRow = gFrontRow.map(p => ({
      ...p,
      lat: p.lat + (tableDepthM * nsLatPerM) / MPD,
      lng: p.lng + (tableDepthM * nsLngPerM) / (MPD * cosLat),
    }));
  }

  const _fr = gFrontRow.length > 0 ? gFrontRow : frontRow;
  const _br = gBackRow.length  > 0 ? gBackRow  : backRow;
  debugLog.push(`[PANEL-GRID v6.0] anchor=${_fr[0]?.id} front=${_fr.length} back=${_br.length} realBack=${hasRealBackRow}`);

  // ── Array geometry ─────────────────────────────────────────────────────
  const totalPanelH = PLP_ROW_COUNT * panelH;
  const tableDepthM = totalPanelH * cosT;
  const pylonH      = cp.pylonH;
  const pylonTopZ   = cp.pylonTopZ;

  debugLog.push(`[PLP v6.0] groundZ=${groundZ.toFixed(3)} tilt=${tiltDeg}° clearance=${PLP_MIN_PANEL_CLEARANCE_M}m`);
  debugLog.push(`[PLP v6.0] totalPanelH=${totalPanelH.toFixed(3)}m tableDepth=${tableDepthM.toFixed(3)}m pylonH=${pylonH.toFixed(3)}m`);

  // ── Row geometry ───────────────────────────────────────────────────────
  const frontFirst = _fr[0];
  const frontLast  = _fr[_fr.length - 1];
  const nCols      = _fr.length;
  const rowSpanM   = nCols > 1 ? distM(frontFirst.lat, frontFirst.lng, frontLast.lat, frontLast.lng) : 0;
  const railSpanEW = rowSpanM + panelW + 0.30;

  const hEW = hRad(azimuthDeg - 90);
  const hNS = hRad(azimuthDeg);

  // v6.1.8: Uniform structural pylon spacing along E-W rail axis.
  // Pylons are placed at equal intervals ≤ PLP_BAY_SPAN_M, NOT derived from panel columns.
  // Positions interpolated along the line from frontFirst to frontLast (E-W axis).
  const nPylons = Math.max(2, Math.ceil(rowSpanM / PLP_BAY_SPAN_M) + 1);
  const pylonIds: string[] = [];
  const allSbIds: string[] = [];

  debugLog.push(`[PLP v6.1.8] nPylons=${nPylons} railSpanEW=${railSpanEW.toFixed(2)}m rowSpanM=${rowSpanM.toFixed(2)}m`);


  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: PYLONS — Foundation with mountPoint (uniform structural spacing)
  // ══════════════════════════════════════════════════════════════════════

  // v6.1.9: Per-pylon terrain estimation from front-row panel heights.
  // Panels were placed on terrain by Cesium, so their height encodes terrain info.
  // terrainAtPanel ≈ panelHeight - (distance from ground to panel center along ellipsoid).
  // The panel center is at: groundZ + clearance + 0.5*totalPanelH*sin(tilt) + panelThickness/2
  // We estimate local terrain as: nearestPanel.height - (pylonTopZ + stackAbovePylon - groundZ)
  // Simplified: localGroundZ ≈ groundZ + (nearestPanelH - refPanelH) where refPanelH = frontFirst.height
  const refPanelH = frontFirst.height;

  let pylonHMin = Infinity, pylonHMax = -Infinity;

  for (let pi = 0; pi < nPylons; pi++) {
    const frac = nPylons > 1 ? pi / (nPylons - 1) : 0.5;

    // Interpolate along E-W axis (frontFirst → frontLast)
    const ewLat = frontFirst.lat + frac * (frontLast.lat - frontFirst.lat);
    const ewLng = frontFirst.lng + frac * (frontLast.lng - frontFirst.lng);

    // Pylon at N-S center of array (midpoint between front and back row at this E-W position)
    const bFrac = Math.min(Math.round(frac * (_br.length - 1)), _br.length - 1);
    const bpLat = _br[bFrac].lat;
    const bpLng = _br[bFrac].lng;
    const pylonLat = (ewLat + bpLat) / 2;
    const pylonLng = (ewLng + bpLng) / 2;

    // v6.1.9: Estimate local terrain height from nearest front-row panel.
    // Panel heights vary with terrain — use this to adjust pylon base.
    const nearestFIdx = Math.min(Math.round(frac * (_fr.length - 1)), _fr.length - 1);
    const nearestPanelH = _fr[nearestFIdx].height;
    const localGroundZ = groundZ + (nearestPanelH - refPanelH);
    const localPylonH = Math.max(0.3, pylonTopZ - localGroundZ);  // min 0.3m to avoid degenerate pylons

    const pid = `${kp}__gnd__pylon_${pi}`;
    pylonIds.push(pid);

    // mountPoint = pylon top (bracket attaches strongback here) — stays on the common tilt plane
    const mountPoint = { lat: pylonLat, lng: pylonLng, z: pylonTopZ };

    piles.push({
      id: pid, lat: pylonLat, lng: pylonLng,
      groundZ: localGroundZ, topZ: pylonTopZ, height: localPylonH,
      row: 'uniform', bayIndex: pi,
      mountPoint,
    });

    // Rendered member: I-beam box from localGroundZ to pylonTopZ, pitch=0 (vertical)
    members.push(mbr(
      pid, `[PD-PYLON] b${pi}`,
      pylonLat, pylonLng, localGroundZ + localPylonH / 2,
      hNS, 0,
      [PLP_IBEAM_W, PLP_IBEAM_D, localPylonH],
      COLOR_PILE, 'pile',
    ));

    pylonHMin = Math.min(pylonHMin, localPylonH);
    pylonHMax = Math.max(pylonHMax, localPylonH);
    debugLog.push(`[DBG-PYLON b${pi}] frac=${frac.toFixed(3)} lat=${pylonLat.toFixed(6)} lng=${pylonLng.toFixed(6)} localGroundZ=${localGroundZ.toFixed(4)} topZ=${pylonTopZ.toFixed(4)} pylonH=${localPylonH.toFixed(4)}`);
  }
  debugLog.push(`[PYLONS v6.1.9] count=${nPylons} pylonH=[${pylonHMin.toFixed(3)}..${pylonHMax.toFixed(3)}]m mountZ=${pylonTopZ.toFixed(3)} spacing=${(rowSpanM / Math.max(1, nPylons - 1)).toFixed(2)}m`);


  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: STRONGBACKS — Mounted FROM pylon.mountPoint
  // ══════════════════════════════════════════════════════════════════════
  //
  // v6.0 MECHANICAL MODEL:
  //   Center = pylon.mountPoint (not independently computed)
  //   Axis = tilt direction (south→north, tilted up)
  //   South/north ends derived from center + axis offsets
  //   Top surface = centerline + (SB_H/2) * tiltNormal

  for (let pi = 0; pi < nPylons; pi++) {
    const pylon = piles[pi];
    const mp = pylon.mountPoint;  // ALL geometry derives from this

    const sbId = `${kp}__gnd__sb_${pi}`;
    allSbIds.push(sbId);

    const southEnd = sbCenterlinePoint(mp.lat, mp.lng, mp.z, totalPanelH, tiltRad, 0, azimuthDeg);
    const northEnd = sbCenterlinePoint(mp.lat, mp.lng, mp.z, totalPanelH, tiltRad, 1, azimuthDeg);

    strongbacks.push({
      id: sbId,
      lat: mp.lat, lng: mp.lng, z: mp.z,
      lengthM: totalPanelH,
      row: 'uniform',
      pileIds: [pylon.id],
      southEnd, northEnd,
    });

    // v6.1.7: Strongback — mounted component, not derived beam.
    //
    // Orientation: SAME system as rails and panels
    //   heading = hEW = hRad(azimuthDeg - 90)
    //   pitch   = -tiltRad
    //
    // Position: pylon.mountPoint (structural anchor, not panel-derived)
    //
    // Dims (hEW → bodyX=N-S, bodyY=E-W):
    //   dims[0] = totalPanelH (SB length along N-S bodyX axis)
    //   dims[1] = PLP_SB_W    (structural width, 64mm)
    //   dims[2] = PLP_SB_H    (structural height, 89mm)
    //
    // Stack rule: SB top = rail bottom (SB_H/2 + RAIL_H/2 = 70mm along normal)
    members.push(mbr(
      sbId, `[PD-STRONGBACK b${pi}]`,
      mp.lat, mp.lng, mp.z,
      hEW, -tiltRad,
      [totalPanelH, PLP_SB_W, PLP_SB_H],
      COLOR_STRONGBACK, 'strongback',
    ));

    debugLog.push(`[SB b${pi}] mountPt=(${mp.lat.toFixed(6)},${mp.lng.toFixed(6)},${mp.z.toFixed(4)}) southEnd=(${southEnd.lat.toFixed(6)},${southEnd.lng.toFixed(6)},${southEnd.z.toFixed(4)}) northEnd=(${northEnd.lat.toFixed(6)},${northEnd.lng.toFixed(6)},${northEnd.z.toFixed(4)})`);
  }

  if (strongbacks.length !== pylonIds.length) {
    debugLog.push(`[GUARD FAIL v6.0] sbs=${strongbacks.length} ≠ pylons=${pylonIds.length}`);
  } else {
    debugLog.push(`[STRONGBACK v6.0] ${strongbacks.length} components, len=${totalPanelH.toFixed(3)}m, center=mountPoint.z=${pylonTopZ.toFixed(3)}`);
  }


  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: SUPPORT STRUTS — Endpoints from parent surfaces
  // ══════════════════════════════════════════════════════════════════════
  //
  // Upper end = strongback.southEnd (from strongback)
  // Lower end = pylon.bodyPoint(STRUT_FRAC) (from pylon)

  const supportMode: PLPSupportMode = PLP_SUPPORT_MODE;

  for (let pi = 0; pi < nPylons; pi++) {
    const pylon = piles[pi];
    const sb    = strongbacks[pi];

    if (supportMode === 'single_strut_cantilever' || supportMode === 'dual_strut') {
      const upper = sb.southEnd;
      const lower = pylonBodyPoint(pylon.lat, pylon.lng, pylon.groundZ, pylon.height, PLP_STRUT_FRAC);

      // v6.2.2: Azimuth-aware strut — use BOTH lat AND lng displacement
      const dLatM  = (upper.lat - lower.lat) * MPD;
      const dLngM  = (upper.lng - lower.lng) * mpdLng(lower.lat);
      const dHoriz = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
      const dZ     = upper.z - lower.z;
      const len    = Math.sqrt(dHoriz * dHoriz + dZ * dZ);
      const midLat = (upper.lat + lower.lat) / 2;
      const midLng = (upper.lng + lower.lng) / 2;
      const midZ   = (upper.z + lower.z) / 2;
      const pitch  = Math.asin(dZ / len);
      // Heading from actual upper→lower vector (not hardcoded hNS)
      const strutHeadingS = Math.atan2(dLngM, dLatM);

      members.push(mbr(
        `${kp}__gnd__strut_s_${pi}`, `[PD-S-STRUT] b${pi}`,
        midLat, midLng, midZ, strutHeadingS, pitch,
        [PLP_STRUT_D, len, PLP_STRUT_D],
        COLOR_BRACE, 'brace',
      ));
    }

    if (supportMode === 'dual_strut') {
      const upper = sb.northEnd;
      const lower = pylonBodyPoint(pylon.lat, pylon.lng, pylon.groundZ, pylon.height, PLP_STRUT_FRAC);

      // v6.2.2: Azimuth-aware strut — use BOTH lat AND lng displacement
      const dLatM  = (upper.lat - lower.lat) * MPD;
      const dLngM  = (upper.lng - lower.lng) * mpdLng(lower.lat);
      const dHoriz = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
      const dZ     = upper.z - lower.z;
      const len    = Math.sqrt(dHoriz * dHoriz + dZ * dZ);
      const midLat = (upper.lat + lower.lat) / 2;
      const midLng = (upper.lng + lower.lng) / 2;
      const midZ   = (upper.z + lower.z) / 2;
      const pitch  = Math.asin(dZ / len);
      // Heading from actual upper→lower vector (not hardcoded hNS)
      const strutHeadingN = Math.atan2(dLngM, dLatM);

      members.push(mbr(
        `${kp}__gnd__strut_n_${pi}`, `[PD-N-STRUT] b${pi}`,
        midLat, midLng, midZ, strutHeadingN, pitch,
        [PLP_STRUT_D, len, PLP_STRUT_D],
        COLOR_BRACE, 'brace',
      ));
    }
  }
  debugLog.push(`[STRUTS v6.2.2] mode=${supportMode} — azimuth-aware endpoints from SB.southEnd/northEnd + pylon.bodyPoint(${PLP_STRUT_FRAC})`);


  // ══════════════════════════════════════════════════════════════════════
  // STEP 4: PX RAILS — Surface-mounted on strongback top surface
  // ══════════════════════════════════════════════════════════════════════
  //
  // v6.0: Rail position derived FROM strongback top surface.
  //   railMountPoint() = SB centerline + (SB_H/2 + RAIL_H/2) * tiltNormal
  //   This shifts rails SOUTH by offset*sin(θ) and UP by offset*cos(θ)
  //   (perpendicular to tilt plane, NOT vertical).

  // v6.3: Rail endpoints derived from FIRST and LAST pylon mount points.
  // Old code used a single refMount (piles[0]) and mixed pylon-derived lat/z
  // with panel-derived lng — correct only at az=180°.  For any other azimuth
  // the lat/lng decomposition breaks because the rail direction isn't purely E-W.
  // Fix: compute railMountPoint at BOTH ends → gives correct (lat, lng, z) per end.
  const mountFirst = piles[0].mountPoint;
  const mountLast  = piles[piles.length - 1].mountPoint;

  const railDefs: { frac: number; name: string }[] = [];
  for (let ri = 0; ri < PLP_ROW_COUNT; ri++) {
    const base = (ri * panelH) / totalPanelH;
    const span = panelH / totalPanelH;
    railDefs.push({ frac: base + PLP_CLAMP_INSET_FRAC * span, name: `${ri === 0 ? 'S' : 'N'}1-RAIL` });
    railDefs.push({ frac: base + (1 - PLP_CLAMP_INSET_FRAC) * span, name: `${ri === 0 ? 'S' : 'N'}2-RAIL` });
  }
  railDefs.sort((a, b) => a.frac - b.frac);

  // Row direction unit vector (frontFirst → frontLast) in degree-space
  const rowDirLat = frontLast.lat - frontFirst.lat;  // degrees
  const rowDirLng = frontLast.lng - frontFirst.lng;  // degrees
  // Rail overhang beyond panel row at each end: half of (railSpanEW - rowSpanM)
  const overhangM = (railSpanEW - rowSpanM) / 2;
  // Convert overhang to degree deltas along the row direction
  // rowDirLat/rowSpanM = degrees-per-metre along row; * overhangM = overhang in degrees
  let ohDLat = 0, ohDLng = 0;
  if (rowSpanM > 0.01) {
    ohDLat = (rowDirLat / rowSpanM) * overhangM;  // degrees
    ohDLng = (rowDirLng / rowSpanM) * overhangM;  // degrees
  }

  railDefs.forEach(({ frac, name }, ri) => {
    const rpFirst = railMountPoint(mountFirst.lat, mountFirst.lng, mountFirst.z, totalPanelH, tiltRad, frac, azimuthDeg);
    const rpLast  = railMountPoint(mountLast.lat,  mountLast.lng,  mountLast.z,  totalPanelH, tiltRad, frac, azimuthDeg);
    const railId = `${kp}__gnd__pxrail_${ri}_${frontFirst.id}`;

    // Rail start = first-pylon rail point extended by overhang toward frontFirst
    const startLat = rpFirst.lat - ohDLat;
    const startLng = rpFirst.lng - ohDLng;
    const startZ   = rpFirst.z;
    // Rail end = last-pylon rail point extended by overhang toward frontLast
    const endLat   = rpLast.lat + ohDLat;
    const endLng   = rpLast.lng + ohDLng;
    const endZ     = rpLast.z;
    // Rail mid = average
    const midLat = (startLat + endLat) / 2;
    const midLng = (startLng + endLng) / 2;
    const midZ   = (startZ   + endZ)   / 2;

    rails.push({
      id: railId,
      startLat, startLng, startZ,
      endLat,   endLng,   endZ,
      midLat,   midLng,   midZ,
      lengthM:  railSpanEW,
      pitchRad: -tiltRad,
      headingRad: hEW,
      railType: 'powerrail',
      strongbackIds: allSbIds,
      mountFrac: frac,
    });

    members.push(mbr(
      railId, `[PD-${name}]`,
      midLat, midLng, midZ,
      hEW, -tiltRad,
      [PLP_RAIL_W, railSpanEW, PLP_RAIL_H],
      COLOR_RAIL, 'powerrail',
    ));

    debugLog.push(`[RAIL ${name}] frac=${frac.toFixed(4)} start=(${startLat.toFixed(6)},${startLng.toFixed(6)},${startZ.toFixed(4)}) end=(${endLat.toFixed(6)},${endLng.toFixed(6)},${endZ.toFixed(4)}) mid=(${midLat.toFixed(6)},${midLng.toFixed(6)},${midZ.toFixed(4)})`);
  });

  const n = tiltNormal(tiltRad, azimuthDeg, mountFirst.lat);
  debugLog.push(`[RAILS v6.3] ${railDefs.length} rails, per-endpoint mount from pylon[0] & pylon[${piles.length-1}] (n.dLat=${n.dLatPerM.toFixed(8)}, n.dLng=${n.dLngPerM.toFixed(8)}, n.z=${n.z.toFixed(4)}) az=${azimuthDeg}°`);


  // v6.1.8: E-W braces REMOVED — no horizontal pylon-to-pylon connections exist in PLP POWER DRIVE™.
  // Only allowed connections: pylon → strongback (via mount), pylon → strut (diagonal support).

  debugLog.push(`[PLP v6.1.8] TOTAL members=${members.length} piles=${piles.length} sbs=${strongbacks.length} rails=${rails.length}`);
  return { members, piles, strongbacks, rails };
}


// ══════════════════════════════════════════════════════════════════════════
// IRONRIDGE XR STRUCTURE BUILDER (updated for v6.0 interface compat)
// ══════════════════════════════════════════════════════════════════════════

function buildXRStructure(
  sortedRows: Array<[number, GroundPanel[]]>,
  frontRow: GroundPanel[], backRow: GroundPanel[],
  basePlaneZ: number, tiltDeg: number, azimuthDeg: number,
  panelH: number, panelW: number, panelBotOffset: number, debugLog: string[],
  kp: string,  // v6.2.2: key prefix for unique racking entity keys
): { members: RackingMember[]; piles: PileSpec[]; strongbacks: StrongbackSpec[]; rails: RailSpec[] } {

  const members:     RackingMember[]  = [];
  const piles:       PileSpec[]       = [];
  const strongbacks: StrongbackSpec[] = [];
  const rails:       RailSpec[]       = [];

  const tiltRad = tiltDeg * DEG;
  const nRows   = sortedRows.length;
  const groundZ = basePlaneZ;

  const backAvgH = backRow.reduce((s, p) => s + p.height, 0) / backRow.length;
  const nRailZ   = backAvgH - panelBotOffset;
  const postH    = Math.max(MOUNT_HEIGHT_M, nRailZ - groundZ);
  const crossZ   = groundZ + postH;

  const frontFirst = frontRow[0];
  const frontLast  = frontRow[frontRow.length - 1];
  const backFirst  = backRow[0];
  const backLast   = backRow[backRow.length - 1];
  const nCols      = frontRow.length;
  const rowSpanM   = nCols > 1 ? distM(frontFirst.lat, frontFirst.lng, frontLast.lat, frontLast.lng) : 0;
  const railLen    = rowSpanM + panelW + 0.20;

  const sLat = (frontFirst.lat + frontLast.lat) / 2;
  const sLng = (frontFirst.lng + frontLast.lng) / 2;
  const nLat = (backFirst.lat  + backLast.lat)  / 2;
  const nLng = (backFirst.lng  + backLast.lng)  / 2;

  const hEW = hRad(azimuthDeg - 90);
  const hNS = hRad(azimuthDeg);
  const bCols = bayColumns(frontRow, XR_BAY_SPAN_M);
  debugLog.push(`[XR v4] postH=${postH.toFixed(3)} rows=${nRows} bays=${bCols.length}`);

  const sPileIds: string[] = [];
  const nPileIds: string[] = [];
  bCols.forEach((ci, pi) => {
    const fp = frontRow[ci];
    const bp = backRow[Math.min(ci, backRow.length - 1)];
    const sPid = `${kp}__gnd__Spile_${pi}_${fp.id}`;
    const nPid = `${kp}__gnd__Npile_${pi}_${bp.id}`;
    sPileIds.push(sPid);
    nPileIds.push(nPid);

    piles.push({ id: sPid, lat: fp.lat, lng: fp.lng, groundZ, topZ: crossZ, height: postH, row: 'south', bayIndex: pi, mountPoint: { lat: fp.lat, lng: fp.lng, z: crossZ } });
    piles.push({ id: nPid, lat: bp.lat, lng: bp.lng, groundZ, topZ: crossZ, height: postH, row: 'north', bayIndex: pi, mountPoint: { lat: bp.lat, lng: bp.lng, z: crossZ } });

    members.push(mbr(sPid, `[XR-S-POST] b${pi}`, fp.lat, fp.lng, groundZ + postH / 2, hNS, 0, [VERT_PIPE_D, VERT_PIPE_D, postH], COLOR_PILE, 'pile'));
    members.push(mbr(nPid, `[XR-N-POST] b${pi}`, bp.lat, bp.lng, groundZ + postH / 2, hNS, 0, [VERT_PIPE_D, VERT_PIPE_D, postH], COLOR_PILE, 'pile'));
  });

  const sSBId = `${kp}__gnd__cross_S_${frontFirst.id}`;
  const nSBId = `${kp}__gnd__cross_N_${frontFirst.id}`;
  strongbacks.push({ id: sSBId, lat: sLat, lng: sLng, z: crossZ, lengthM: railLen, row: 'south', pileIds: sPileIds, southEnd: { lat: sLat, lng: sLng, z: crossZ }, northEnd: { lat: sLat, lng: sLng, z: crossZ } });
  strongbacks.push({ id: nSBId, lat: nLat, lng: nLng, z: crossZ, lengthM: railLen, row: 'north', pileIds: nPileIds, southEnd: { lat: nLat, lng: nLng, z: crossZ }, northEnd: { lat: nLat, lng: nLng, z: crossZ } });
  members.push(mbr(sSBId, `[XR-CROSS-S]`, sLat, sLng, crossZ, hEW, 0, [VERT_PIPE_D, railLen, VERT_PIPE_D], COLOR_STRONGBACK, 'strongback'));
  members.push(mbr(nSBId, `[XR-CROSS-N]`, nLat, nLng, crossZ, hEW, 0, [VERT_PIPE_D, railLen, VERT_PIPE_D], COLOR_STRONGBACK, 'strongback'));

  sortedRows.forEach(([ri, rowPanels], idx) => {
    const rFirst = rowPanels[0], rLast = rowPanels[rowPanels.length - 1];
    const rLat = (rFirst.lat + rLast.lat) / 2;
    const rLng = (rFirst.lng + rLast.lng) / 2;
    const rAvgH  = rowPanels.reduce((s, p) => s + p.height, 0) / rowPanels.length;
    const rRailZ = rAvgH - panelBotOffset;
    const railId = `${kp}__gnd__xr_${idx}_${frontFirst.id}`;
    rails.push({
      id: railId,
      startLat: rFirst.lat, startLng: rFirst.lng, startZ: rRailZ,
      endLat: rLast.lat, endLng: rLast.lng, endZ: rRailZ,
      midLat: rLat, midLng: rLng, midZ: rRailZ,
      lengthM: railLen, pitchRad: -tiltRad, headingRad: hEW,
      railType: 'xrrail', strongbackIds: [sSBId, nSBId], mountFrac: 0,
    });
    members.push(mbr(railId, `[XR-RAIL] r${ri}`, rLat, rLng, rRailZ, hEW, -tiltRad, [XR_RAIL_W, railLen, XR_RAIL_H], COLOR_XR, 'xrrail'));
  });

  const lr    = sortedRows[nRows - 1][1];
  const lAvgH = lr.reduce((s, p) => s + p.height, 0) / lr.length;
  const capZ  = lAvgH + (panelH / 2) * Math.sin(tiltRad);
  members.push(mbr(`${kp}__gnd__cap_${frontFirst.id}`, `[XR-CAP]`,
    (lr[0].lat + lr[lr.length-1].lat) / 2,
    (lr[0].lng + lr[lr.length-1].lng) / 2,
    capZ, hEW, -tiltRad, [XR_RAIL_W, railLen, XR_RAIL_H], COLOR_XR, 'cap'));

  if (bCols.length >= 2) {
    for (let bi = 0; bi < bCols.length - 1; bi++) {
      const fp0 = frontRow[bCols[bi]];
      const fp1 = frontRow[Math.min(bCols[bi + 1], frontRow.length - 1)];
      const span = distM(fp0.lat, fp0.lng, fp1.lat, fp1.lng) || 0.1;
      const mid  = midpt(fp0.lat, fp0.lng, fp1.lat, fp1.lng);
      members.push(mbr(`${kp}__gnd__brace_${bi}_${fp0.id}`, `[XR-BRACE] b${bi}`,
        mid.lat, mid.lng, crossZ, hEW, 0,
        [BRACE_D, span, BRACE_D], COLOR_BRACE, 'brace'));
    }
  }

  debugLog.push(`[XR v4] TOTAL members=${members.length} piles=${piles.length} sbs=${strongbacks.length} rails=${rails.length}`);
  return { members, piles, strongbacks, rails };
}


// ─── MAIN ENTRY POINT ──────────────────────────────────────────────────

export function buildGroundRacking(opts: BuildRackingOptions): GroundSystemOutput {
  const { style, panels, basePlaneZ, tiltDeg, azimuthDeg, orientation } = opts;
  const kp = opts.keyPrefix ?? '';  // v6.2.2: unique prefix for racking entity keys
  const debugLog: string[] = [];
  const { pw: panelW, ph: panelH } = panelDims(orientation);

  const emptyOutput: GroundSystemOutput = {
    piles: [], strongbacks: [], rails: [], members: [], panelAttachPoints: [],
    valid: false, errors: ['No panels provided'], debugLog,
    groundZ: basePlaneZ,
    sPostTopZ: basePlaneZ + MOUNT_HEIGHT_M,
    nPostTopZ: basePlaneZ + MOUNT_HEIGHT_M,
    sRailZ: basePlaneZ + MOUNT_HEIGHT_M,
    nRailZ: basePlaneZ + MOUNT_HEIGHT_M,
    tableDepthM: 0,
    baySpanM: style === 'ironridge' ? XR_BAY_SPAN_M : PLP_BAY_SPAN_M,
    correctedPanels: [],
    lowSideClearanceM:  PLP_MIN_PANEL_CLEARANCE_M,
    highSideClearanceM: PLP_MIN_PANEL_CLEARANCE_M,
    solvedPlaneZ:       basePlaneZ + MOUNT_HEIGHT_M,
    pylonHeightRange:   [MOUNT_HEIGHT_M, MOUNT_HEIGHT_M] as [number, number],
  };

  if (panels.length === 0) { debugLog.push('[WARN] 0 panels'); return emptyOutput; }

  const sortedRows = sortRows(panels);
  const nRows = sortedRows.length;
  if (nRows === 0) { debugLog.push('[WARN] 0 rows'); return { ...emptyOutput, errors: ['No rows detected'] }; }

  const [, frontRow] = sortedRows[0];
  let [, backRow]    = sortedRows[nRows - 1];
  if (frontRow.length === 0) { debugLog.push('[WARN] empty front row'); return { ...emptyOutput, errors: ['Empty front row'] }; }

  debugLog.push(`[ENGINE v6.0] style=${style} rows=${nRows} cols=${frontRow.length} tilt=${tiltDeg}° az=${azimuthDeg}°`);

  const tiltRad        = tiltDeg * DEG;
  const panelBotOffset = (panelH / 2) * Math.sin(tiltRad) + PLANE_ENGINE_PANEL_OFFSET_M;
  const frontAvgH      = frontRow.reduce((s, p) => s + p.height, 0) / frontRow.length;
  const backAvgH       = backRow.reduce((s, p)  => s + p.height, 0) / backRow.length;
  const sRailZ         = frontAvgH - panelBotOffset;
  const nRailZ         = backAvgH  - panelBotOffset;
  const groundZ        = basePlaneZ;

  const tableDepthM = (style === 'pipe' ? PLP_ROW_COUNT : 1) * panelH * Math.cos(tiltRad);
  if (nRows === 1) {
    backRow = frontRow.map(p => ({ ...p, lat: p.lat + tableDepthM / MPD }));
    debugLog.push(`[ENG-4] single-row: synthesized backRow +${tableDepthM.toFixed(3)}m north`);
  }

  let result: { members: RackingMember[]; piles: PileSpec[]; strongbacks: StrongbackSpec[]; rails: RailSpec[] };

  if (style === 'pipe') {
    result = buildPLPStructure(frontRow, backRow, basePlaneZ, tiltDeg, azimuthDeg, panelH, panelW, debugLog, kp);
  } else {
    result = buildXRStructure(sortedRows, frontRow, backRow, basePlaneZ, tiltDeg, azimuthDeg, panelH, panelW, panelBotOffset, debugLog, kp);
  }

  // ── Validation ────────────────────────────────────────────────────────
  const maxSpan = style === 'ironridge' ? XR_MAX_SPAN_M : PLP_MAX_SPAN_M;
  const validation = validateBuildOutput(result.piles, result.strongbacks, result.rails, result.members, maxSpan, debugLog);

  if (!validation.valid) {
    debugLog.push(`[ENGINE v6.0] VALIDATION FAILED — ${validation.errors.length} errors — DO NOT RENDER`);
  }

  // ── Panel attach points ───────────────────────────────────────────────
  const panelAttachPoints: PanelAttachPoint[] = panels.map(p => ({
    panelId: p.id, railIds: result.rails.map(r => r.id), clampZone: 'center' as const,
  }));

  const tableRise = tableDepthM * Math.tan(tiltRad);
  const sPostTopZ = groundZ + MOUNT_HEIGHT_M;
  const nPostTopZ = sPostTopZ + tableRise;

  // ── Corrected panel positions (v5.4) ──────────────────────────────────
  let correctedPanels: GroundPanel[];
  if (style === 'pipe') {
    const cpSolve = solveClearancePlane(groundZ, tiltRad, panelH, PLP_MIN_PANEL_CLEARANCE_M);
    correctedPanels = buildPanelGrid(panels, panelW, panelH, tiltRad, PLP_PANEL_COL_GAP_M, azimuthDeg, cpSolve.panelOriginZ);
    debugLog.push(`[CORRECTED-PANELS v6.0.1] ${correctedPanels.length} panels, originZ=${cpSolve.panelOriginZ.toFixed(3)} azimuth=${azimuthDeg}°`);

    // ═══ v6.1.1 HARD VALIDATION: Both panel rows must lie on the same tilted plane ═══
    // Plane equation: height = anchorH + nsDistance * tan(tilt)
    // nsDistance measured along ANTI-azimuth (= nsAxis direction in buildPanelGrid).
    //   For az=180°: anti-azimuth = NORTH, so row 1 (north of row 0) has positive nsDistM.
    //   Height increases with nsDistM (row 1 higher than row 0).
    // All panels must satisfy this within 1mm tolerance.
    const tanT = Math.tan(tiltRad);
    const azRad = azimuthDeg * DEG;
    // Anti-azimuth components (negate azimuth to match nsAxis direction)
    const antiAzLat = -Math.cos(azRad);  // matches nsLat in buildPanelGrid
    const antiAzLng = -Math.sin(azRad);  // matches nsLng in buildPanelGrid
    if (correctedPanels.length >= 2) {
      const anchor = correctedPanels[0];
      let maxDeviation = 0;
      let worstPanel = '';
      for (const cp of correctedPanels) {
        // NS distance from anchor along anti-azimuth direction (meters)
        const dLat = (cp.lat - anchor.lat) * MPD;
        const dLng = (cp.lng - anchor.lng) * MPD * Math.cos(anchor.lat * Math.PI / 180);
        const nsDistM = dLat * antiAzLat + dLng * antiAzLng;
        const expectedH = anchor.height + nsDistM * tanT;
        const deviation = Math.abs(cp.height - expectedH);
        if (deviation > maxDeviation) {
          maxDeviation = deviation;
          worstPanel = cp.id;
        }
      }
      if (maxDeviation > 0.001) {
        debugLog.push(`[SHARED-PLANE FAIL v6.1.1] maxDeviation=${(maxDeviation * 1000).toFixed(1)}mm at panel=${worstPanel} — rows NOT on same plane`);
      } else {
        debugLog.push(`[SHARED-PLANE PASS v6.1.1] maxDeviation=${(maxDeviation * 1000).toFixed(1)}mm — all panels on single tilted plane ✓`);
      }
    }
    // ═══ END v6.1.1 HARD VALIDATION ═══
  } else {
    correctedPanels = panels;
  }

  // ── Clearance diagnostics (v5.5) ─────────────────────────────────────
  let lowSideClearanceM  = PLP_MIN_PANEL_CLEARANCE_M;
  let highSideClearanceM = PLP_MIN_PANEL_CLEARANCE_M;
  let solvedPlaneZ       = groundZ + MOUNT_HEIGHT_M;
  let pylonHeightRange: [number, number] = [MOUNT_HEIGHT_M, MOUNT_HEIGHT_M];

  if (style === 'pipe' && correctedPanels.length > 0) {
    const row0 = correctedPanels.filter(p => (p.arrayRow ?? 0) === 0);
    const back = correctedPanels.filter(p => (p.arrayRow ?? 0) !== 0);
    const sinT = Math.sin(tiltRad);
    if (row0.length > 0) {
      lowSideClearanceM = Math.min(...row0.map(p => p.height)) - (panelH / 2) * sinT - groundZ;
    }
    if (back.length > 0) {
      highSideClearanceM = Math.max(...back.map(p => p.height)) + (panelH / 2) * sinT - groundZ;
    }
    solvedPlaneZ = groundZ + MOUNT_HEIGHT_M;
    const plpPylons = result.piles.filter(p => p.row === 'uniform');
    if (plpPylons.length > 0) {
      const hs = plpPylons.map(p => p.height);
      pylonHeightRange = [Math.min(...hs), Math.max(...hs)];
    }
    debugLog.push(`[CLEARANCE v6.0] low=${lowSideClearanceM.toFixed(4)}m (${(lowSideClearanceM*39.3701).toFixed(1)}in) high=${highSideClearanceM.toFixed(4)}m`);
  }

  debugLog.push(`[DONE v6.0] members=${result.members.length} piles=${result.piles.length} sbs=${result.strongbacks.length} rails=${result.rails.length} valid=${validation.valid}`);

  return {
    piles: result.piles, strongbacks: result.strongbacks,
    rails: result.rails, members: result.members,
    panelAttachPoints, valid: validation.valid, errors: validation.errors, debugLog,
    groundZ, sPostTopZ, nPostTopZ, sRailZ, nRailZ, tableDepthM,
    baySpanM: style === 'ironridge' ? XR_BAY_SPAN_M : PLP_BAY_SPAN_M,
    correctedPanels, lowSideClearanceM, highSideClearanceM, solvedPlaneZ, pylonHeightRange,
  };
}

// ─── Utility exports ────────────────────────────────────────────────────

export function getMaxRows(style: GroundSystemStyle): number {
  return style === 'ironridge' ? XR_ROW_COUNT : PLP_ROW_COUNT;
}

export function getWithinTableSpacing(
  style: GroundSystemStyle, orientation: 'portrait' | 'landscape', tiltDeg: number,
): number {
  const { ph } = panelDims(orientation);
  return withinTableRowSpacingM(ph, tiltDeg);
}

export interface GroundClickTrace {
  screenX: number; screenY: number; pickMethod: string;
  intersectionLat: number; intersectionLng: number; intersectionZ: number;
  basePlaneZ: number; mountPlaneZ: number; finalPanelZ: number;
}

export function formatClickTrace(t: GroundClickTrace): string {
  return [
    `[GROUND_CLICK_DEBUG]`,
    `  screen=(${t.screenX.toFixed(1)},${t.screenY.toFixed(1)}) method=${t.pickMethod}`,
    `  intersection=(${t.intersectionLat.toFixed(6)},${t.intersectionLng.toFixed(6)},${t.intersectionZ.toFixed(2)})`,
    `  basePlaneZ=${t.basePlaneZ.toFixed(2)} [LOCKED] mountPlaneZ=${t.mountPlaneZ.toFixed(2)} finalPanelZ=${t.finalPanelZ.toFixed(2)}`,
  ].join('\n');
}