/**
 * panelLayoutOptimized.ts — Panel Grid Generation (CAD Geometry Engine)  v47.101
 *
 * v47.101: Portrait-First Solver — fixed orientation control + row iteration
 *
 * Key fixes from v47.100:
 *   1. UI orientation is now respected as the PRIMARY constraint:
 *      - 'portrait'  → run portrait pass; only try landscape if portrait = 0 panels
 *      - 'landscape' → run landscape pass; only try portrait if landscape = 0 panels
 *      - undefined   → run 3-pass solver (portrait-first auto mode)
 *   2. Mixed-fill no longer reimplements geometry — it delegates to generatePanelGridCAD
 *      for portrait rows, then calls a second pass for landscape in the Y-remainder.
 *   3. Row iteration is entirely inside generatePanelGridCAD (roofGeometry.ts) which
 *      already has the correct while(y + panelH <= maxY) loop. The solver simply
 *      calls it twice (portrait + landscape) and merges.
 *   4. Panel spacing clamped to 0.25" (0.00635m) minimum — simulates mid-clamp gap.
 *
 * Algorithm (auto mode, orientation undefined):
 *   Pass 1: portrait-only  → score = count + 0.5   (portrait preference bonus)
 *   Pass 2: landscape-only → score = count          (no bonus)
 *   Pass 3: mixed-fill     → score = count + 0.25   (mixed preference bonus)
 *              mixed = portrait rows (full bbox) + landscape in Y-remainder
 *   Winner = highest score. Ties: portrait > mixed > landscape.
 *
 * Manual panels are never modified. This solver only produces AUTO panels.
 *
 * Each PlacedPanel.layoutStrategy = 'PORTRAIT' | 'MIXED' | 'LANDSCAPE' for debug overlay.
 */

import { v4 as uuidv4 } from 'uuid';
import type { PlacedPanel, SolarPanel, RoofPlane } from '@/types';
import {
  generatePanelGridCAD,
  polygonCentroid,
  latLngToLocal,
  polygonAreaM2,
  shrinkPolygon,
  signedArea2D,
  shrinkPolygonFeet,
  pointInPolygon2D,
  rotatePoint,
  DEG_TO_RAD,
  METERS_PER_DEG_LAT,
  FEET_PER_METER,
  METERS_PER_FOOT,
  computeEdgeAlignedRotAngle,
} from './roofGeometry';
import {
  latLngToLocalFeet,
  localFeetToLatLng,
  type LocalFeetPoint,
} from './localProjection';

// ─── Re-export for callers ──────────────────────────────────────────────────
// (backwards compat — callers may import these from here)
export { clearGridCache, getGridCacheStats } from './gridCache';

// ─── Grid Result Cache (delegated) ─────────────────────────────────────────

import { getCachedGrid, setCachedGrid, makeGridCacheKey, hashPolygon } from './gridCache';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LayoutStrategy = 'PORTRAIT' | 'MIXED' | 'LANDSCAPE';

export interface RoofLayoutResult {
  panels:   PlacedPanel[];
  strategy: LayoutStrategy;
  score:    number;
}

// Portrait preference bonus — portrait wins over landscape on equal count
const PORTRAIT_BONUS  = 0.5;
// Mixed-fill preference bonus
const MIXED_BONUS     = 0.25;
// Landscape gets no bonus

// Minimum panel spacing = 0.25" (6.35mm) — mid-clamp physical minimum
const MIN_PANEL_SPACING_M = 0.00635;

// ─── Public API: generateRoofLayoutOptimized ────────────────────────────────

/**
 * Main entry point for roof panel layout.
 *
 * Orientation behavior:
 *   'portrait'  → Portrait pass first. If result=0, try landscape as fallback.
 *   'landscape' → Landscape pass first. If result=0, try portrait as fallback.
 *   undefined   → 3-pass auto solver: portrait-first with scoring.
 */
export function generateRoofLayoutOptimized(params: {
  layoutId:        string;
  roofPlane:       RoofPlane;
  panel:           SolarPanel;
  setback:         number;
  panelSpacing:    number;
  rowSpacing:      number;
  tilt:            number;
  azimuth:         number;
  orientation?:    'portrait' | 'landscape';
  fireSetbackM?:   number;
  pathwayWidthM?:  number;
  enforcePathway?: boolean;
  /** Per-edge setbacks (v47.111) -- override uniform setback */
  eaveSetbackM?:   number;   // eave/gutter: 0" default
  ridgeSetbackM?:  number;   // ridge/top:   18" default
  sideSetbackM?:   number;   // sides/rake:  18" default
  /** v47.118: Align grid to longest roof edge instead of pure azimuth */
  alignToEdge?:    boolean;
}): PlacedPanel[] {
  const { layoutId, roofPlane, panel, rowSpacing, tilt, azimuth } = params;

  if (roofPlane.vertices.length < 3) return [];

  // Clamp spacing to physical minimum (¼" mid-clamp gap)
  const panelSpacing = Math.max(params.panelSpacing, MIN_PANEL_SPACING_M);

  // Fire setback: use larger of manual setback or fire setback (legacy uniform)
  const setback = Math.max(params.setback, params.fireSetbackM ?? 0);

  const orientation = params.orientation; // undefined = auto
  // Per-edge setbacks (v47.111)
  const eaveSetbackM  = params.eaveSetbackM;
  const ridgeSetbackM = params.ridgeSetbackM;
  const sideSetbackM  = params.sideSetbackM;
  const alignToEdge   = params.alignToEdge;

  // ── EXPLICIT PORTRAIT ──────────────────────────────────────────────────
  if (orientation === 'portrait') {
    const panels = runPass(layoutId, roofPlane, panel, setback,
      panelSpacing, rowSpacing, tilt, azimuth, 'portrait', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);

    if (panels.length > 0) {
      console.log(`[SOLVER] PORTRAIT (explicit): ${panels.length} panels`);
      return tagStrategy(panels, 'PORTRAIT');
    }

    // Fallback: try landscape if portrait produces nothing (very narrow roof)
    console.log('[SOLVER] PORTRAIT explicit: 0 panels — fallback to LANDSCAPE');
    const lsPanels = runPass(layoutId, roofPlane, panel, setback,
      panelSpacing, rowSpacing, tilt, azimuth, 'landscape', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);
    return tagStrategy(lsPanels, 'LANDSCAPE');
  }

  // ── EXPLICIT LANDSCAPE ─────────────────────────────────────────────────
  if (orientation === 'landscape') {
    const panels = runPass(layoutId, roofPlane, panel, setback,
      panelSpacing, rowSpacing, tilt, azimuth, 'landscape', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);

    if (panels.length > 0) {
      console.log(`[SOLVER] LANDSCAPE (explicit): ${panels.length} panels`);
      return tagStrategy(panels, 'LANDSCAPE');
    }

    // Fallback: try portrait if landscape produces nothing
    console.log('[SOLVER] LANDSCAPE explicit: 0 panels — fallback to PORTRAIT');
    const pPanels = runPass(layoutId, roofPlane, panel, setback,
      panelSpacing, rowSpacing, tilt, azimuth, 'portrait', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);
    return tagStrategy(pPanels, 'PORTRAIT');
  }

  // ── AUTO MODE (orientation undefined) — 3-pass portrait-first solver ───
  return solveRoofLayout({
    layoutId, roofPlane, panel,
    setbackM:       setback,
    panelSpacingM:  panelSpacing,
    rowSpacingM:    rowSpacing,
    tilt, azimuth,
    pathwayWidthM:  params.pathwayWidthM,
    enforcePathway: params.enforcePathway,
    eaveSetbackM,
    ridgeSetbackM,
    sideSetbackM,
    alignToEdge,
  }).panels;
}

// ─── 3-Pass Auto Solver ──────────────────────────────────────────────────────

/**
 * Portrait-first 3-pass solver (auto mode only).
 * Used when orientation is undefined (system default).
 */
export function solveRoofLayout(params: {
  layoutId:        string;
  roofPlane:       RoofPlane;
  panel:           SolarPanel;
  setbackM:        number;
  panelSpacingM:   number;
  rowSpacingM:     number;
  tilt:            number;
  azimuth:         number;
  fireSetbackM?:   number;
  pathwayWidthM?:  number;
  enforcePathway?: boolean;
  eaveSetbackM?:   number;
  ridgeSetbackM?:  number;
  sideSetbackM?:   number;
  alignToEdge?:    boolean;
}): RoofLayoutResult {
  const {
    layoutId, roofPlane, panel, panelSpacingM, rowSpacingM, tilt, azimuth,
  } = params;
  const setbackM = Math.max(params.setbackM, params.fireSetbackM ?? 0);
  const eaveSetbackM  = params.eaveSetbackM;
  const ridgeSetbackM = params.ridgeSetbackM;
  const sideSetbackM  = params.sideSetbackM;
  const alignToEdge   = params.alignToEdge;

  // Pass 1: Portrait-only
  const portraitPanels = runPass(layoutId, roofPlane, panel, setbackM,
    panelSpacingM, rowSpacingM, tilt, azimuth, 'portrait', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);
  const portraitScore = portraitPanels.length + PORTRAIT_BONUS;

  // Pass 2: Landscape-only
  const landscapePanels = runPass(layoutId, roofPlane, panel, setbackM,
    panelSpacingM, rowSpacingM, tilt, azimuth, 'landscape', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);
  const landscapeScore = landscapePanels.length; // no bonus

  // Pass 3: Mixed-fill (portrait rows + landscape in Y-remainder)
  const mixedPanels = buildMixedFill(
    layoutId, roofPlane, panel, setbackM, panelSpacingM, rowSpacingM, tilt, azimuth,
    eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge,
  );
  const mixedScore = mixedPanels.length + MIXED_BONUS;

  console.log('[SOLVER] 3-pass results', {
    portrait:  { count: portraitPanels.length,  score: portraitScore  },
    mixed:     { count: mixedPanels.length,      score: mixedScore     },
    landscape: { count: landscapePanels.length,  score: landscapeScore },
  });

  // Select highest score — ties broken by portrait > mixed > landscape
  const best = Math.max(portraitScore, mixedScore, landscapeScore);

  if (portraitScore >= best) {
    console.log('[SOLVER] selected: PORTRAIT');
    return { panels: tagStrategy(portraitPanels, 'PORTRAIT'), strategy: 'PORTRAIT', score: portraitScore };
  }
  if (mixedScore >= best) {
    console.log('[SOLVER] selected: MIXED');
    return { panels: tagStrategy(mixedPanels, 'MIXED'), strategy: 'MIXED', score: mixedScore };
  }
  console.log('[SOLVER] selected: LANDSCAPE');
  return { panels: tagStrategy(landscapePanels, 'LANDSCAPE'), strategy: 'LANDSCAPE', score: landscapeScore };
}

// ─── Single Orientation Pass ─────────────────────────────────────────────────

/**
 * Run one orientation pass by delegating entirely to generatePanelGridCAD.
 * generatePanelGridCAD contains the authoritative row iteration loop.
 */
function runPass(
  layoutId:      string,
  roofPlane:     RoofPlane,
  panel:         SolarPanel,
  setbackM:      number,
  panelSpacingM: number,
  rowSpacingM:   number,
  tilt:          number,
  azimuth:       number,
  orientation:   'portrait' | 'landscape',
  eaveSetbackM?:  number,
  ridgeSetbackM?: number,
  sideSetbackM?:  number,
  alignToEdge?:   boolean,
): PlacedPanel[] {
  return generatePanelGridCAD({
    layoutId,
    roofPlane,
    panel,
    setbackM,
    panelSpacingM,
    rowSpacingM,
    tilt,
    azimuth,
    orientation,
    eaveSetbackM,
    ridgeSetbackM,
    sideSetbackM,
    alignToEdge,
  });
}

// ─── Mixed-Fill Pass ──────────────────────────────────────────────────────────

/**
 * Mixed-fill: portrait rows fill the full usable roof.
 * Then detect the Y-remainder strip above the last portrait row.
 * If a landscape row fits in the remainder, sweep it there.
 * Merge portrait + landscape panels.
 *
 * This works entirely in LECS feet (rotated CAD frame) matching exactly
 * how generatePanelGridCAD computes the bbox and grid.
 *
 * Returns portrait-only panels if no landscape row fits in the remainder.
 */
function buildMixedFill(
  layoutId:      string,
  roofPlane:     RoofPlane,
  panel:         SolarPanel,
  setbackM:      number,
  panelSpacingM: number,
  rowSpacingM:   number,
  tilt:          number,
  azimuth:       number,
  eaveSetbackM?:  number,
  ridgeSetbackM?: number,
  sideSetbackM?:  number,
  alignToEdge?:   boolean,
): PlacedPanel[] {

  if (roofPlane.vertices.length < 3) return [];

  // Step 1: Get full portrait layout from the CAD engine (authoritative geometry)
  const portraitPanels = runPass(layoutId, roofPlane, panel, setbackM,
    panelSpacingM, rowSpacingM, tilt, azimuth, 'portrait', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);

  if (portraitPanels.length === 0) {
    // No portrait rows fit — try landscape fill instead
    return runPass(layoutId, roofPlane, panel, setbackM,
      panelSpacingM, rowSpacingM, tilt, azimuth, 'landscape', eaveSetbackM, ridgeSetbackM, sideSetbackM, alignToEdge);
  }

  // Step 2: Recompute the rotated bbox using LECS — same math as generatePanelGridCAD.
  // IMPORTANT: Use full unshrunken polygon (no shrinkPolygonFeet) — per-edge setbacks
  // are applied as bbox adjustments below, matching the CAD engine exactly.
  const originLat = roofPlane.centroidLat
    ?? roofPlane.vertices.reduce((s, v) => s + v.lat, 0) / roofPlane.vertices.length;
  const originLng = roofPlane.centroidLng
    ?? roofPlane.vertices.reduce((s, v) => s + v.lng, 0) / roofPlane.vertices.length;

  const localFt: LocalFeetPoint[] = roofPlane.vertices.map(v =>
    latLngToLocalFeet(v.lat, v.lng, originLat, originLng)
  );

  // Full unshrunken polygon for containment test (same as CAD engine step 4)
  const usableFt = ensureCCWFeet(localFt);
  if (usableFt.length < 3) return portraitPanels;

  // v47.118: rotAngle must match generatePanelGridCAD exactly.
  // If alignToEdge and roofEdgeAngleDeg is set, use edge-aligned rotation.
  const rotAngle = (alignToEdge && roofPlane.roofEdgeAngleDeg !== undefined)
    ? computeEdgeAlignedRotAngle(roofPlane.roofEdgeAngleDeg, azimuth)
    : (azimuth - 180) * DEG_TO_RAD;
  const rotatedFt  = rotateFt(usableFt, rotAngle);
  const bb         = bboxFt(rotatedFt);

  // Per-edge setbacks matching CAD engine step 8b exactly
  const _eaveSetbackFt  = (eaveSetbackM  ?? 0)        * FEET_PER_METER;  // default 0"
  const _ridgeSetbackFt = (ridgeSetbackM ?? setbackM)  * FEET_PER_METER;  // default 18"
  const _sideSetbackFt  = (sideSetbackM  ?? setbackM)  * FEET_PER_METER;  // default 18"

  // Zone bounds computed below from full bb + per-edge setbacks (no pre-restriction)




  // Portrait panel dimensions (feet) — mirror generatePanelGridCAD ridgeIsNS logic exactly
  const ridgeIsNS = Math.abs(Math.cos(azimuth * DEG_TO_RAD)) < Math.abs(Math.sin(azimuth * DEG_TO_RAD));
  const pYft_p  = ridgeIsNS
    ? panel.width  * FEET_PER_METER   // portrait Y up-slope for east/west roof
    : panel.height * FEET_PER_METER;  // portrait Y up-slope for south/north roof
  const pXft_l  = ridgeIsNS
    ? panel.width  * FEET_PER_METER   // landscape X along N-S ridge
    : panel.height * FEET_PER_METER;  // landscape X along E-W ridge
  const pYft_l  = ridgeIsNS
    ? panel.height * FEET_PER_METER   // landscape Y up E-W slope
    : panel.width  * FEET_PER_METER;  // landscape Y up N-S slope

  const rowSpacingFt   = rowSpacingM   * FEET_PER_METER;
  const panelSpacingFt = panelSpacingM * FEET_PER_METER;
  const stepYft_p      = pYft_p + rowSpacingFt;
  const stepXft_l      = pXft_l + panelSpacingFt;
  const stepYft_l      = pYft_l + rowSpacingFt;

  // Full roof bbox (no pre-restriction) -- setbacks are zone filters below
  const roofHeightFt   = bb.maxY - bb.minY;
  const ridgeZoneY     = bb.maxY - _ridgeSetbackFt;   // top edge of valid zone
  const eaveZoneY      = bb.minY + _eaveSetbackFt;    // bottom edge (0 = gutter)
  const leftZoneX      = bb.minX + _sideSetbackFt;    // left edge of valid zone
  const rightZoneX     = bb.maxX - _sideSetbackFt;    // right edge of valid zone
  const usableHeightFt = ridgeZoneY - eaveZoneY;

  // Count portrait rows from eaveZoneY up to ridgeZoneY
  let portraitRowCount = 0;
  for (let rowY = eaveZoneY; rowY + pYft_p <= ridgeZoneY + 1e-9; rowY += stepYft_p) {
    portraitRowCount++;
  }

  const lastPortraitRowTop = portraitRowCount > 0
    ? eaveZoneY + (portraitRowCount - 1) * stepYft_p + pYft_p
    : eaveZoneY;

  const remainderStart  = lastPortraitRowTop + rowSpacingFt;
  const remainderHeight = ridgeZoneY - remainderStart;

  console.log('[MIXED_FILL_DEBUG]', {
    roofHeightFt:     roofHeightFt.toFixed(3) + 'ft (' + (roofHeightFt / FEET_PER_METER).toFixed(2) + 'm)',
    usableHeightFt:   usableHeightFt.toFixed(3) + 'ft (' + (usableHeightFt / FEET_PER_METER).toFixed(2) + 'm)',
    panelHeightFt:    pYft_p.toFixed(3) + 'ft portrait up-slope',
    portraitRows:     portraitRowCount,
    eaveZoneY:        eaveZoneY.toFixed(3), ridgeZoneY: ridgeZoneY.toFixed(3),
    eaveSetback_in:   (_eaveSetbackFt  * 12).toFixed(0),
    ridgeSetback_in:  (_ridgeSetbackFt * 12).toFixed(0),
    sideSetback_in:   (_sideSetbackFt  * 12).toFixed(0),
    remainderFt:      remainderHeight.toFixed(3),
    landscapeRowFits: remainderHeight >= pYft_l - 1e-9,
  });

  if (roofHeightFt / FEET_PER_METER > 5.0 && portraitRowCount < 2) {
    console.warn('[MIXED_FILL_DEBUG] WARNING: roof', (roofHeightFt/FEET_PER_METER).toFixed(1),
      'm > 5m but only', portraitRowCount, 'portrait rows.',
      'usableH=' + usableHeightFt.toFixed(2) + 'ft panelH=' + pYft_p.toFixed(2) + 'ft');
  }

  if (remainderHeight < pYft_l - 1e-9) { return portraitPanels; }

  // Step 3: Sweep landscape panels in remainder [remainderStart, ridgeZoneY]
  const EPS = 0.003;
  const landscapePanels: PlacedPanel[] = [];
  let lsGridRow = Math.max(...portraitPanels.map(p => p.row ?? 0)) + 1;


  for (
    let rowY = remainderStart;
    rowY + pYft_l <= ridgeZoneY + 1e-9;
    rowY += stepYft_l, lsGridRow++
  ) {
    const centerY = rowY + pYft_l / 2;
    let lsCol     = 0;

    for (
      let colX = leftZoneX;
      colX + pXft_l <= rightZoneX + 1e-9;
      colX += stepXft_l, lsCol++
    ) {
      const centerX = colX + pXft_l / 2;

      // All-4-corners test with EPS inset (matches CAD engine)
      const hX = pXft_l / 2, hY = pYft_l / 2;
      const inside =
        pipFeet({xFeet: centerX - hX + EPS, yFeet: centerY - hY + EPS}, rotatedFt) &&
        pipFeet({xFeet: centerX + hX - EPS, yFeet: centerY - hY + EPS}, rotatedFt) &&
        pipFeet({xFeet: centerX + hX - EPS, yFeet: centerY + hY - EPS}, rotatedFt) &&
        pipFeet({xFeet: centerX - hX + EPS, yFeet: centerY + hY - EPS}, rotatedFt);
      if (!inside) continue;

      // Rotate center back to local feet
      const localFtCenter = rotateFtPoint({ xFeet: centerX, yFeet: centerY }, -rotAngle);
      const { lat, lng }  = localFeetToLatLng(localFtCenter.xFeet, localFtCenter.yFeet, originLat, originLng);
      const xM = localFtCenter.xFeet * METERS_PER_FOOT;
      const yM = localFtCenter.yFeet * METERS_PER_FOOT;

      landscapePanels.push({
        id: uuidv4(), layoutId, lat, lng,
        x: xM, y: yM, xMeters: xM, yMeters: yM,
        xFeet: localFtCenter.xFeet, yFeet: localFtCenter.yFeet,
        widthFeet: pXft_l, heightFeet: pYft_l,
        tilt, azimuth,
        wattage: panel.wattage, bifacialGain: panel.bifacialFactor,
        row: lsGridRow, col: lsCol,
        orientation: 'landscape',
        layoutSource: 'AUTO', placementType: 'ROOF', systemType: 'roof',
      });
    }
  }

  const mixed = [...portraitPanels, ...landscapePanels];
  console.log('[SOLVER] mixed-fill result', {
    portraitRows:   portraitRowCount,
    portraitPanels: portraitPanels.length,
    remainderFt:    remainderHeight.toFixed(3),
    landscapePanels: landscapePanels.length,
    total:          mixed.length,
  });
  return mixed;
}


// ─── Strategy tagger ─────────────────────────────────────────────────────────

function tagStrategy(panels: PlacedPanel[], strategy: LayoutStrategy): PlacedPanel[] {
  return panels.map(p => ({ ...p, layoutStrategy: strategy }));
}

// ─── LECS feet geometry helpers ───────────────────────────────────────────────

function ensureCCWFeet(pts: LocalFeetPoint[]): LocalFeetPoint[] {
  const n = pts.length;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    area += (pts[j].xFeet + pts[i].xFeet) * (pts[j].yFeet - pts[i].yFeet);
  }
  return area / 2 < 0 ? [...pts].reverse() : [...pts];
}

function rotateFtPoint(pt: LocalFeetPoint, angle: number): LocalFeetPoint {
  const c = Math.cos(angle), s = Math.sin(angle);
  return {
    xFeet: pt.xFeet * c - pt.yFeet * s,
    yFeet: pt.xFeet * s + pt.yFeet * c,
  };
}

function rotateFt(pts: LocalFeetPoint[], angle: number): LocalFeetPoint[] {
  return pts.map(p => rotateFtPoint(p, angle));
}

interface BBoxFt { minX: number; maxX: number; minY: number; maxY: number; }

function bboxFt(pts: LocalFeetPoint[]): BBoxFt {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.xFeet < minX) minX = p.xFeet; if (p.xFeet > maxX) maxX = p.xFeet;
    if (p.yFeet < minY) minY = p.yFeet; if (p.yFeet > maxY) maxY = p.yFeet;
  }
  return { minX, maxX, minY, maxY };
}

function pipFeet(pt: LocalFeetPoint, poly: LocalFeetPoint[]): boolean {
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

function allCornersInside(
  cx: number, cy: number, hx: number, hy: number,
  poly: LocalFeetPoint[]
): boolean {
  return (
    pipFeet({ xFeet: cx - hx, yFeet: cy - hy }, poly) &&
    pipFeet({ xFeet: cx + hx, yFeet: cy - hy }, poly) &&
    pipFeet({ xFeet: cx + hx, yFeet: cy + hy }, poly) &&
    pipFeet({ xFeet: cx - hx, yFeet: cy + hy }, poly)
  );
}

// ─── Ground Layout (unchanged) ───────────────────────────────────────────────

const DEG_TO_RAD_LOCAL = Math.PI / 180;

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LAT * Math.cos(lat * DEG_TO_RAD_LOCAL);
}

export function generateGroundLayoutOptimized(params: {
  layoutId:     string;
  area:         { lat: number; lng: number }[];
  panel:        SolarPanel;
  tilt:         number;
  azimuth:      number;
  rowSpacing:   number;
  panelSpacing: number;
  panelsPerRow: number;
  groundHeight: number;
  orientation?: 'portrait' | 'landscape';
}): PlacedPanel[] {
  const { layoutId, area, panel, tilt, azimuth, rowSpacing, panelSpacing } = params;
  const orientation = params.orientation ?? 'portrait';
  const panelW = orientation === 'landscape' ? panel.height : panel.width;
  const panelH = orientation === 'landscape' ? panel.width  : panel.height;

  if (area.length < 2) return [];

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const v of area) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lng < minLng) minLng = v.lng;
    if (v.lng > maxLng) maxLng = v.lng;
  }
  const baseLat    = (minLat + maxLat) / 2;
  const mPerDegLng = metersPerDegLng(baseLat);

  const panelWidthDeg   = panelW / mPerDegLng;
  const panelHeightDeg  = panelH / METERS_PER_DEG_LAT;
  const shadowLength    = panelH * Math.cos(tilt * DEG_TO_RAD_LOCAL);
  const effectiveRowSp  = Math.max(rowSpacing, shadowLength + 0.5);
  const rowSpacingDeg   = effectiveRowSp  / METERS_PER_DEG_LAT;
  const colSpacingDeg   = panelSpacing    / mPerDegLng;
  const marginLat       = 0.5 / METERS_PER_DEG_LAT;
  const marginLng       = 0.5 / mPerDegLng;
  const halfW           = panelWidthDeg  / 2;
  const halfH           = panelHeightDeg / 2;
  const stepLat         = panelHeightDeg + rowSpacingDeg;
  const stepLng         = panelWidthDeg  + colSpacingDeg;

  const panels: PlacedPanel[] = [];
  let row = 0;

  for (
    let lat = minLat + marginLat;
    lat + panelHeightDeg <= maxLat - marginLat;
    lat += stepLat, row++
  ) {
    let col = 0;
    for (
      let lng = minLng + marginLng;
      lng + panelWidthDeg <= maxLng - marginLng;
      lng += stepLng, col++
    ) {
      const xM = (lng + halfW - (minLng + maxLng) / 2) * mPerDegLng;
      const yM = (lat + halfH - (minLat + maxLat) / 2) * METERS_PER_DEG_LAT;
      panels.push({
        id: uuidv4(), layoutId,
        lat: lat + halfH, lng: lng + halfW,
        x: col * (panelW + panelSpacing), y: row * (panelH + effectiveRowSp),
        xMeters: xM, yMeters: yM,
        tilt, azimuth,
        wattage: panel.wattage, bifacialGain: panel.bifacialFactor,
        row, col,
        orientation,
        layoutSource:  'AUTO',
        placementType: 'GROUND',
        systemType:    'ground',
      });
    }
  }

  return panels;
}