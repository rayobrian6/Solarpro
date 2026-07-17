// ============================================================
// SolarPro CAD Engine — Ground Mount CAD Solver
// lib/cad/ground/groundCAD.ts
//
// Responsibilities:
//   - Row-based array generation
//   - Tilt-aware row-to-row spacing
//   - Azimuth alignment
//   - Site boundary constraints
//   - Pier/pile structural alignment
//
// RULES:
//   - Uniform rows, consistent spacing
//   - NO cross-array influence
//   - All geometry in local XY meters
// ============================================================

import type { PermitInputShape } from '../../drafting/permitInputShape';
import type {
  CADModel, CADGroundModel, CADGroundArray, CADGroundRow, CADPanel,
} from '../types';
import {
  Point2D, BBox,
  bbox, metersToFt, ftToMeters, fmtFt, latLngToXY,
} from '../geometry';

const INCHES_TO_METERS = 0.0254;
const DEFAULT_PANEL_LENGTH_IN = 66;
const DEFAULT_PANEL_WIDTH_IN  = 40;
const DEFAULT_GAP_M           = 0.02;

export function groundCAD(input: PermitInputShape): CADModel {
  const t0 = Date.now();
  console.log('[CAD ENGINE INIT] groundCAD', {
    groundArrays: input.layout?.groundArrays?.length ?? 0,
    totalPanels:  input.system?.totalPanels,
    systemKw:     input.system?.totalDcKw,
  });

  const warnings: string[] = [];

  // ── Panel dimensions ─────────────────────────────────────────
  const panelLenIn = input.project?.panelLengthIn ?? DEFAULT_PANEL_LENGTH_IN;
  const panelWidIn = input.project?.panelWidthIn  ?? DEFAULT_PANEL_WIDTH_IN;
  // Landscape for ground mount: width = length (horizontal), height = width
  const panelW = panelLenIn * INCHES_TO_METERS;   // ~1.676m horizontal
  const panelH = panelWidIn * INCHES_TO_METERS;   // ~1.016m vertical

  // ── Raw arrays ────────────────────────────────────────────────
  const rawArrays = input.layout?.groundArrays || [];
  const setbackFt = input.layout?.groundSetbackFt ?? 5;
  const setbackM  = ftToMeters(setbackFt);

  // ── GPS-FIRST PATH: the user's REAL designed panel positions ─────────────
  // groundCAD historically NEVER read project.panelPositions — when
  // layout.groundArrays was absent it synthesized a ceil(sqrt(N))-wide grid at
  // tilt 20 / azimuth 180 anchored at (0,0). Stowell's real ground array (26
  // panels, 2 rows of 13, az ~175, at a specific GPS spot east of the house)
  // was ignored: detail sheets and the structural BOM ("30 rails, 12 piles")
  // were derived from phantom 5-row geometry. Mirror roofCAD: when the design
  // carries GPS panels, build the CAD arrays from the REAL positions.
  //
  // Scope guard: only consume panels stamped ground (placementEngine tags
  // systemType/placementType) or entirely untagged (legacy single-system
  // ground projects predate stamping). Panels stamped roof/fence are another
  // solver's — the hybrid engine scopes them away in production, but direct
  // callers (tests, legacy paths) may pass the unscoped list.
  const gpsGroundPanels = (input.project?.panelPositions || []).filter((p: any) => {
    if (!p || !isFinite(p?.lat) || !isFinite(p?.lng) || Math.abs(p.lat) <= 0.001) return false;
    const st = String(p.systemType ?? '').toLowerCase();
    const pt = String(p.placementType ?? '').toUpperCase();
    if (pt === 'GROUND' || st === 'ground' || st === 'ground_mount') return true;
    return st === '' && pt === '';
  });
  if (gpsGroundPanels.length > 0) {
    return solveGroundFromGPS(input, gpsGroundPanels, { panelW, panelH, setbackFt, warnings, t0 });
  }

  const cadArrays: CADGroundArray[] = [];
  let globalOriginX = 0;
  let globalOriginY = 0;

  // If no arrays defined, generate default from system totals
  // Synthesized grids must never emit MORE panels than the system actually
  // has: ceil(sqrt(26))=6 × 5 rows tiled 30 slots for Stowell's 26 ground
  // panels — the site-plan overlay label and the per-module BOM lines
  // (bonding clips etc.) all inherited the phantom 4.
  let panelBudget = Infinity;
  if (rawArrays.length === 0) {
    warnings.push('groundCAD: no groundArrays — generating from system totals');
    const totalPanels  = input.system?.totalPanels ?? 10;
    panelBudget        = totalPanels;
    const panelsPerRow = Math.ceil(Math.sqrt(totalPanels));
    const rowCount     = Math.ceil(totalPanels / panelsPerRow);

    // Error 5s fix: rawArrays is any[] — no `as any` needed on push
    rawArrays.push({
      id:                'default',
      rowCount,
      panelsPerRow,
      tiltDeg:           20,
      azimuth:           180,
      rowSpacingFt:      10,
      groundClearanceIn: 18,
      structureType:     'driven_pile',
      pileDepthFt:       5,
      pileSpacingFt:     8,
    });
  }

  for (let ai = 0; ai < rawArrays.length; ai++) {
    // Error 5s fix: rawArrays elements are already `any` from PermitInputShape
    const arr = rawArrays[ai];
    const rowCount     = arr.rowCount     || 4;
    const panelsPerRow = arr.panelsPerRow || 5;
    const tiltDeg      = arr.tiltDeg      || 20;
    const azimuth      = arr.azimuth      || 180;
    const rowSpFt      = arr.rowSpacingFt || 10;
    const gcIn         = arr.groundClearanceIn || 18;
    const structType   = arr.structureType    || 'driven_pile';
    const pileDepthFt  = arr.pileDepthFt      || 5;
    const pileSpFt     = arr.pileSpacingFt    || 8;

    // ── Row-to-row spacing (tilt-aware) ──────────────────────────
    // Minimum row spacing = panel H × cos(tilt) + shadow clearance
    // Use provided rowSpFt as override if ≥ minimum
    const rowSpM           = ftToMeters(rowSpFt);
    const tiltRad          = tiltDeg * Math.PI / 180;
    const minRowSpM        = panelH * Math.cos(tiltRad) * 2.0; // 2× shadow clearance
    const effectiveRowSpM  = Math.max(rowSpM, minRowSpM);

    // Array origin: stack arrays horizontally with gap
    const arrayOriginX = globalOriginX;
    const arrayOriginY = globalOriginY;
    const arrayW = panelsPerRow * (panelW + DEFAULT_GAP_M);
    const arrayD = (rowCount - 1) * effectiveRowSpM + panelH;

    const rows: CADGroundRow[]  = [];
    const allPanels: CADPanel[] = [];

    for (let r = 0; r < rowCount; r++) {
      const rowY = arrayOriginY + r * effectiveRowSpM;
      const rowX = arrayOriginX;
      const rowPanels: CADPanel[] = [];

      for (let c = 0; c < panelsPerRow; c++) {
        if (allPanels.length + rowPanels.length >= panelBudget) break;
        const px = rowX + c * (panelW + DEFAULT_GAP_M);
        const py = rowY;
        rowPanels.push({
          id:          `${arr.id || ai}-r${r}-c${c}`,
          x:           px,
          y:           py,
          widthM:      panelW,
          heightM:     panelH,
          orientation: 'landscape',
          row:         r,
          col:         c,
          arrayId:     arr.id || String(ai),
        });
      }

      if (rowPanels.length === 0) continue;   // panelBudget exhausted — no empty rows
      allPanels.push(...rowPanels);
      rows.push({
        id:       `${arr.id || ai}-row${r}`,
        rowIndex: r,
        x:        rowX,
        y:        rowY,
        widthM:   arrayW,
        panels:   rowPanels,
      });
    }

    console.log('[PANEL GRID GENERATED] groundCAD', {
      arrayId:     arr.id || ai,
      rows:        rowCount,
      panelsPerRow,
      totalPanels: allPanels.length,
      tiltDeg,
      rowSpFt:     metersToFt(effectiveRowSpM).toFixed(1),
    });

    cadArrays.push({
      id:               arr.id || String(ai),
      originX:          arrayOriginX,
      originY:          arrayOriginY,
      rows,
      panels:           allPanels,
      tiltDeg,
      azimuth,
      rowSpacingM:      effectiveRowSpM,
      groundClearanceM: gcIn * INCHES_TO_METERS,
      structureType:    structType,
      pileDepthM:       ftToMeters(pileDepthFt),
      pileSpacingM:     ftToMeters(pileSpFt),
      dimensions: {
        arrayWidthM:  arrayW,
        arrayDepthM:  arrayD,
        rowCount,
        panelsPerRow,
      },
    });

    // Advance origin for next array
    globalOriginX += arrayW + setbackM + ftToMeters(20); // 20ft gap between arrays
  }

  // ── Aggregates ────────────────────────────────────────────────
  const allPanels   = cadArrays.flatMap(a => a.panels);
  const totalPanels = allPanels.length || input.system?.totalPanels || 0;
  // Error 5s fix: panelWatts is on PermitInputShape string type — no `as any` needed
  const panelWatts  = input.system?.inverters?.[0]?.strings?.[0]?.panelWatts ?? 400;
  const totalDcKw   = totalPanels * panelWatts / 1000;

  // ── Bounds ────────────────────────────────────────────────────
  const allPoints = allPanels.flatMap(p => [
    { x: p.x, y: p.y },
    { x: p.x + p.widthM, y: p.y + p.heightM },
  ]);
  const globalBounds = bbox(allPoints.length > 0
    ? allPoints
    : [{ x: 0, y: 0 }, { x: 20, y: 10 }]);

  // ── Dimensions ────────────────────────────────────────────────
  const dims = buildGroundDimensions(cadArrays);

  const groundModel: CADGroundModel = {
    arrays:      cadArrays,
    totalPanels,
    setbackFt,
  };

  console.log('[GROUND CAD SOLVED]', {
    arrays:      cadArrays.length,
    totalPanels,
    totalDcKw:   totalDcKw.toFixed(2),
    solveMs:     Date.now() - t0,
    warnings,
  });

  // GPS origin for adapter inverse conversion
  // Ground mount: use project lat/lng, or first groundArray center, or fallback
  const originLat: number =
    // Error 5u fix: lat/lng now declared on PermitInputShape.project — no `as any` needed
    input.project?.lat ??
    input.layout?.groundArrays?.[0]?.center?.lat ??
    37.0;
  const originLng: number =
    input.project?.lng ??
    input.layout?.groundArrays?.[0]?.center?.lng ??
    -122.0;

  return {
    systemType:   'ground_mount',
    version:      'v1.0',
    ground:       groundModel,
    totalPanels,
    totalDcKw,
    panelWidthM:  panelW,
    panelHeightM: panelH,
    originLat,
    originLng,
    bounds:       globalBounds,
    dimensions:   dims,
    solveMs:      Date.now() - t0,
    warnings,
  };
}

// ── GPS solver — REAL designed panel positions ───────────────
//
// Mirrors roofCAD's GPS branch: origin = centroid of the designed panels,
// local XY via latLngToXY, panels stored top-left (center − dims/2). Rows are
// grouped by arrayId/layoutId when the design carries them (the studio emits
// one 'ground-row-<ts>' id per row — Stowell), else clustered on the minor
// axis of the point cloud. All downstream geometry (dimensions, rows[],
// rowSpacingM) reflects the REAL extent so pile/rail/clamp counts derived
// from rows and arrayWidthM follow the actual array, not a phantom grid.

function solveGroundFromGPS(
  input: PermitInputShape,
  rawPanels: any[],
  ctx: { panelW: number; panelH: number; setbackFt: number; warnings: string[]; t0: number },
): CADModel {
  const { panelW, panelH, setbackFt, warnings, t0 } = ctx;
  const layout0: any = input.layout?.groundArrays?.[0] ?? {};

  warnings.push(`groundCAD: using ${rawPanels.length} designed GPS panel position(s)`);

  // ── Origin = centroid of the designed panels ─────────────────
  const originLat = rawPanels.reduce((s: number, p: any) => s + p.lat, 0) / rawPanels.length;
  const originLng = rawPanels.reduce((s: number, p: any) => s + p.lng, 0) / rawPanels.length;

  const pts = rawPanels.map((p: any, i: number) => {
    const xy = latLngToXY(p.lat, p.lng, originLat, originLng);
    return {
      raw:      p,
      id:       (p.id as string) || `gps-${i}`,
      x:        xy.x,
      y:        xy.y,
      groupKey: (p.arrayId ?? p.layoutId ?? null) as string | null,
    };
  });

  // ── Row axis = principal (major) axis of the point cloud ─────
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - cx, dy = p.y - cy;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const theta    = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const rowDir   = { x: Math.cos(theta), y: Math.sin(theta) };
  const minorDir = { x: -rowDir.y, y: rowDir.x };
  const alongRow  = (p: { x: number; y: number }) => p.x * rowDir.x   + p.y * rowDir.y;
  const acrossRow = (p: { x: number; y: number }) => p.x * minorDir.x + p.y * minorDir.y;
  const avg = (vs: number[]) => vs.reduce((s, v) => s + v, 0) / vs.length;

  // ── Group panels into rows ────────────────────────────────────
  let groups: Array<typeof pts>;
  const keyedCount = pts.filter(p => p.groupKey != null).length;
  const keyCount   = new Set(pts.map(p => p.groupKey).filter(k => k != null)).size;
  if (keyedCount === pts.length && keyCount >= 2) {
    // Design-studio row ids (one per row) — authoritative grouping.
    const byKey = new Map<string, typeof pts>();
    for (const p of pts) {
      const g = byKey.get(p.groupKey!) ?? [];
      g.push(p);
      byKey.set(p.groupKey!, g);
    }
    groups = [...byKey.values()];
  } else {
    // Cluster on the minor-axis projection: a gap wider than ~3/4 of the
    // panel depth starts a new row (within-row spread is ~0; row-to-row
    // spacing is meters).
    const sorted = [...pts].sort((a, b) => acrossRow(a) - acrossRow(b));
    const gapM = Math.max(panelH * 0.75, 0.6);
    groups = [];
    let cur: typeof pts = [];
    let last = NaN;
    for (const p of sorted) {
      const v = acrossRow(p);
      if (cur.length > 0 && v - last > gapM) { groups.push(cur); cur = []; }
      cur.push(p);
      last = v;
    }
    if (cur.length > 0) groups.push(cur);
  }
  // Stable order: rows front-to-back along the minor axis, columns along the row axis.
  groups.sort((a, b) => avg(a.map(acrossRow)) - avg(b.map(acrossRow)));
  for (const g of groups) g.sort((a, b) => alongRow(a) - alongRow(b));

  // ── Array azimuth: median of panel azimuths, else derived from row axis ──
  const azSamples = rawPanels
    .map((p: any) => p.azimuth)
    .filter((a: any) => typeof a === 'number' && isFinite(a))
    .map((a: number) => ((a % 360) + 360) % 360);
  let azimuth: number;
  if (azSamples.length > 0) {
    azimuth = median(azSamples);
  } else {
    // Perpendicular to the row axis, facing the equator (the downslope face
    // of a tilted ground array in either hemisphere).
    const rowBearing = (Math.atan2(rowDir.x, rowDir.y) * 180 / Math.PI + 360) % 360;
    const cands  = [(rowBearing + 90) % 360, (rowBearing + 270) % 360];
    const target = originLat >= 0 ? 180 : 0;
    const angDist = (a: number) => Math.min(Math.abs(a - target), 360 - Math.abs(a - target));
    azimuth = angDist(cands[0]) <= angDist(cands[1]) ? cands[0] : cands[1];
  }
  azimuth = Math.round(azimuth * 10) / 10;

  // ── Tilt: LAYOUT AUTHORITY first (the studio slider the user set and SAW
  // rendered in 3D), then panel-stamp median, then 20. Stamps lag the slider
  // when tilt is changed after placement — Stowell's ground panels carried
  // tilt=25 stamps while the studio said 40.16°, so PV-1G drew a 6'3" table
  // Ray builds at 10-12' (2026-07-16). Same stale-stamp doctrine as panel
  // wattage: authority governs, stamps are the fallback.
  const tiltSamples = rawPanels
    .map((p: any) => p.tilt)
    .filter((t: any) => typeof t === 'number' && isFinite(t) && t >= 5 && t <= 60);
  const tiltDeg = Math.round(((typeof layout0.tiltDeg === 'number' && layout0.tiltDeg >= 5 && layout0.tiltDeg <= 60)
    ? layout0.tiltDeg
    : (tiltSamples.length > 0 ? median(tiltSamples) : 20)) * 10) / 10; // 0.1° — raw slider floats printed "40.16186827572303°" on the sheet

  // ── Panels at the REAL local XY (top-left convention, as roofCAD) ──
  const allPanels: CADPanel[] = [];
  const rows: CADGroundRow[] = [];
  groups.forEach((g, r) => {
    const rowPanels: CADPanel[] = g.map((p, c) => {
      // Ground default is landscape; honor an explicit portrait orientation.
      const isLandscape = String(p.raw.orientation ?? 'landscape').toLowerCase() !== 'portrait';
      const pw = isLandscape ? panelW : panelH;
      const ph = isLandscape ? panelH : panelW;
      return {
        id:          p.id,
        x:           p.x - pw / 2,
        y:           p.y - ph / 2,
        widthM:      pw,
        heightM:     ph,
        orientation: isLandscape ? 'landscape' : 'portrait',
        row:         typeof p.raw.row === 'number' ? p.raw.row : r,
        col:         typeof p.raw.col === 'number' ? p.raw.col : c,
        arrayId:     p.groupKey ?? 'gps-array',
      };
    });
    const rb = bbox(rowPanels.flatMap(p => [
      { x: p.x, y: p.y },
      { x: p.x + p.widthM, y: p.y + p.heightM },
    ]));
    rows.push({
      id:       `gps-row${r}`,
      rowIndex: r,
      x:        rb.minX,
      y:        rb.minY,
      widthM:   rb.width,
      panels:   rowPanels,
    });
    allPanels.push(...rowPanels);
  });

  // ── Real extent (drives dimensions AND downstream pile/rail counts) ──
  const ext = bbox(allPanels.flatMap(p => [
    { x: p.x, y: p.y },
    { x: p.x + p.widthM, y: p.y + p.heightM },
  ]));

  // ── Row spacing from the real row centers ─────────────────────
  const rowCenters = groups.map(g => avg(g.map(acrossRow))).sort((a, b) => a - b);
  let rowSpacingM: number;
  if (rowCenters.length >= 2) {
    let s = 0;
    for (let i = 1; i < rowCenters.length; i++) s += rowCenters[i] - rowCenters[i - 1];
    rowSpacingM = s / (rowCenters.length - 1);
  } else {
    rowSpacingM = ftToMeters(layout0.rowSpacingFt || 10);
  }

  // ── Structure: layout overrides or existing defaults ──────────
  const gcIn        = layout0.groundClearanceIn || 18;
  const structType  = layout0.structureType     || 'driven_pile';
  const pileDepthFt = layout0.pileDepthFt       || 5;
  const pileSpFt    = layout0.pileSpacingFt     || 8;

  const cadArray: CADGroundArray = {
    id:               layout0.id || 'gps-array',
    originX:          ext.minX,
    originY:          ext.minY,
    rows,
    panels:           allPanels,
    tiltDeg,
    azimuth,
    rowSpacingM,
    groundClearanceM: gcIn * INCHES_TO_METERS,
    structureType:    structType,
    pileDepthM:       ftToMeters(pileDepthFt),
    pileSpacingM:     ftToMeters(pileSpFt),
    dimensions: {
      arrayWidthM:  ext.width,
      arrayDepthM:  ext.height,
      rowCount:     rows.length,
      panelsPerRow: Math.max(...rows.map(rw => rw.panels.length)),
    },
  };

  console.log(`[PANEL GRID GENERATED] groundCAD source=GPS count=${allPanels.length} rows=${rows.length}`);

  const totalPanels = allPanels.length;
  const panelWatts  = input.system?.inverters?.[0]?.strings?.[0]?.panelWatts ?? 400;
  const totalDcKw   = totalPanels * panelWatts / 1000;
  const dims        = buildGroundDimensions([cadArray]);

  const groundModel: CADGroundModel = {
    arrays:      [cadArray],
    totalPanels,
    setbackFt,
  };

  console.log('[GROUND CAD SOLVED]', {
    arrays:      1,
    totalPanels,
    totalDcKw:   totalDcKw.toFixed(2),
    solveMs:     Date.now() - t0,
    warnings,
  });

  return {
    systemType:   'ground_mount',
    version:      'v1.0',
    ground:       groundModel,
    totalPanels,
    totalDcKw,
    panelWidthM:  panelW,
    panelHeightM: panelH,
    originLat,
    originLng,
    bounds:       ext,
    dimensions:   dims,
    solveMs:      Date.now() - t0,
    warnings,
  };
}

function median(vs: number[]): number {
  const s = [...vs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Dimension builder ─────────────────────────────────────────

function buildGroundDimensions(arrays: CADGroundArray[]): any[] {
  const dims: any[] = [];
  for (const arr of arrays) {
    // Array overall width
    dims.push({
      id:      `${arr.id}-width`,
      type:    'horizontal',
      x1:      arr.originX,
      y1:      arr.originY,
      x2:      arr.originX + arr.dimensions.arrayWidthM,
      y2:      arr.originY,
      valueFt: metersToFt(arr.dimensions.arrayWidthM),
      label:   fmtFt(metersToFt(arr.dimensions.arrayWidthM)) + ' ARRAY WIDTH',
      level:   3,
    });
    // Array overall depth
    dims.push({
      id:      `${arr.id}-depth`,
      type:    'vertical',
      x1:      arr.originX,
      y1:      arr.originY,
      x2:      arr.originX,
      y2:      arr.originY + arr.dimensions.arrayDepthM,
      valueFt: metersToFt(arr.dimensions.arrayDepthM),
      label:   fmtFt(metersToFt(arr.dimensions.arrayDepthM)) + ' ARRAY DEPTH',
      level:   3,
    });
    // Row spacing
    if (arr.rows.length >= 2) {
      const rowSpM = arr.rowSpacingM;
      dims.push({
        id:      `${arr.id}-rowsp`,
        type:    'vertical',
        x1:      arr.originX + arr.dimensions.arrayWidthM + 1,
        y1:      arr.rows[0].y,
        x2:      arr.originX + arr.dimensions.arrayWidthM + 1,
        y2:      arr.rows[1].y,
        valueFt: metersToFt(rowSpM),
        label:   fmtFt(metersToFt(rowSpM)) + ' ROW SPACING',
        level:   2,
      });
    }
  }
  return dims;
}