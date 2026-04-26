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

import type { PermitInputShape } from '../../../lib/drafting/index';
import type {
  CADModel, CADGroundModel, CADGroundArray, CADGroundRow, CADPanel,
} from '../types';
import {
  Point2D, BBox,
  bbox, metersToFt, ftToMeters, fmtFt,
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

  const cadArrays: CADGroundArray[] = [];
  let globalOriginX = 0;
  let globalOriginY = 0;

  // If no arrays defined, generate default from system totals
  if (rawArrays.length === 0) {
    warnings.push('groundCAD: no groundArrays — generating from system totals');
    const totalPanels  = input.system?.totalPanels ?? 10;
    const panelsPerRow = Math.ceil(Math.sqrt(totalPanels));
    const rowCount     = Math.ceil(totalPanels / panelsPerRow);

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
    } as any);
  }

  for (let ai = 0; ai < rawArrays.length; ai++) {
    const arr = rawArrays[ai] as any;
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
  const panelWatts  = (input.system?.inverters?.[0]?.strings?.[0] as any)?.panelWatts ?? 400;
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
    (input.project as any)?.lat ??
    (input.layout?.groundArrays?.[0] as any)?.center?.lat ??
    37.0;
  const originLng: number =
    (input.project as any)?.lng ??
    (input.layout?.groundArrays?.[0] as any)?.center?.lng ??
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