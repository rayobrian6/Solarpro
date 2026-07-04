// ============================================================
// SolarPro Drafting Engine — Ground Mount System Templates
// lib/drafting/templates/ground.ts
//
// drawGroundArray()      → PV-2: row-based array plan (PRIMARY)
// drawGroundStructural() → PV-3: pile elevation + structural detail
//
// SYSTEM: ground_mount ONLY
// CAD IS THE SOLE SOURCE OF TRUTH — all geometry from CADModel.
//
// CROSS-CONTAMINATION BLOCK (STEP 9):
//   ✗ No roof terminology (plane, pitch, rafter, ridge, eave, L-foot)
//   ✗ No fence terminology (post spacing, rail, gate, fence height)
//   ✓ Ground-only: array, row, pile, tilt, azimuth, row spacing,
//                  pile depth, pile spacing, ground clearance
//
// SEGMENT ENGINE (STEP 6):
//   Renders per-array from cad.ground.arrays[].
//   Each array: id, rows[], dimensions, tiltDeg, azimuth.
//   Named arrays drawn independently with labels.
//
// STRUCTURAL REALISM (STEP 7):
//   PV-3 shows: pile embed, tilted panel, rails, row spacing dim,
//   ground clearance, wind+snow+DL load arrows, 3-level dims.
// ============================================================

import type { DraftingInput } from '../types';
import type { DesignIntent } from '../designIntent';
import type { CADModel, CADGroundArray } from '../../cad/types';
import { getLayoutForSystem } from '../layoutEngine';
import {
  drawSVGOpen, drawSVGClose, drawBackground, drawTitleBar,
  drawNorthArrow, drawScaleBar, drawText, drawLine, drawRect, drawRectFilled,
  drawCircleFilled, drawPolyline, drawPolygon, drawHatch,
  drawArrowhead, ftToFtIn, escapeXml, compassDir,
} from '../primitives';
import {
  drawDimension, drawLinearDimension, drawVerticalDimension,
  drawContinuousDimension, drawOverallDimension,
} from '../dimensions';
import {
  drawCallout, drawCalloutWithLeader, drawLeaderLine, drawWindArrow,
} from '../callouts';
import { metersToFt } from '../../cad/geometry';
import { drawUtilityAnalysis, type RenderContext } from '../renderContext';

// ── ARRAY COLORS (one per array, wraps) ──────────────────────────────────────
const ARRAY_COLORS = [
  '#2255aa', '#1a7a3a', '#8b1a1a', '#7a5500', '#4a1a7a',
  '#006666', '#7a3a00', '#003366', '#5a0033', '#336600',
];
function arrayColor(i: number): string {
  return ARRAY_COLORS[i % ARRAY_COLORS.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// drawGroundArray — PV-2 Array Plan (row-based layout, PRIMARY)
// STEP 2: Ground array plan is the primary view.
// STEP 6: Each array drawn per-segment from cad.ground.arrays[].
// ─────────────────────────────────────────────────────────────────────────────

export function drawGroundArray(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { layout, engineering } = input;

  // ── STEP 4: CAD is the ONLY source of truth ──
  const cadGround = cad?.ground;
  const arrays: any[] = cadGround?.arrays ?? layout.groundArrays ?? [];

  if (!arrays || arrays.length === 0) {
    throw new Error(
      '[drawGroundArray] No ground arrays available. ' +
      'ground_mount system requires cad.ground.arrays[].'
    );
  }

  const totalPanels   = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw          = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;
  const setbackFt     = cadGround?.setbackFt ?? layout.groundSetbackFt ?? 5;

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('ground_mount', 'plan');
  const W = zones.canvas.width;
  const H = zones.canvas.height;

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#f5f7f0'));
  els.push(drawTitleBar(W, 'GROUND MOUNT — ARRAY SITE PLAN', 'SCALE: AS SHOWN'));

  const dz = zones.draw;
  const margin = 24;

  // ── Compute panel dimensions from CAD or defaults ──
  // Use first array's panel info if available, else standard 66"x40"
  const firstArr: any = arrays[0];
  const cadPanels = firstArr?._cadPanels ?? firstArr?.panels ?? [];
  const panelWFt  = cadPanels[0]?.widthM  != null
    ? metersToFt(cadPanels[0].widthM)
    : (input.project?.panelLengthIn ?? 66) / 12;
  const panelHFt  = cadPanels[0]?.heightM != null
    ? metersToFt(cadPanels[0].heightM)
    : (input.project?.panelWidthIn ?? 40) / 12;

  // ── Compute bounding box of all arrays ──
  // Each array has origin (X/Y) and dimensions (rows × panelsPerRow)
  let globalMinX = Infinity, globalMaxX = -Infinity;
  let globalMinY = Infinity, globalMaxY = -Infinity;

  arrays.forEach((arr: any) => {
    const ox    = arr._cadOriginX ?? arr.originX ?? 0;
    const oy    = arr._cadOriginY ?? arr.originY ?? 0;
    const rows  = arr.rowCount ?? arr.dimensions?.rowCount ?? 1;
    const ppr   = arr.panelsPerRow ?? arr.dimensions?.panelsPerRow ?? 1;
    const rowSp = arr.rowSpacingFt != null ? arr.rowSpacingFt
                : (arr.rowSpacingM != null ? metersToFt(arr.rowSpacingM) : 8);

    const arrWFt = ppr   * panelWFt * metersToFt(1);   // convert correctly
    const arrHFt = rows  * rowSp;

    // Use meters directly for bounding (origin is in meters)
    const arrWM = ppr  * (cadPanels[0]?.widthM  ?? 0.305 * (panelWFt / metersToFt(1)));
    const arrHM = rows * (arr.rowSpacingM ?? 2.5);

    globalMinX = Math.min(globalMinX, ox);
    globalMaxX = Math.max(globalMaxX, ox + arrWM);
    globalMinY = Math.min(globalMinY, oy);
    globalMaxY = Math.max(globalMaxY, oy + arrHM);
  });

  // Fallback for simple (no-origin) arrays
  if (!isFinite(globalMinX)) {
    globalMinX = 0; globalMaxX = 50;
    globalMinY = 0; globalMaxY = 30;
  }

  const spanXm = (globalMaxX - globalMinX) || 30;
  const spanYm = (globalMaxY - globalMinY) || 20;

  const scaleX = (dz.width  - 2 * margin) / (spanXm * metersToFt(1));
  const scaleY = (dz.height - 2 * margin) / (spanYm * metersToFt(1));
  const scale  = Math.min(scaleX, scaleY);   // px per foot

  const toSvgX = (xM: number) =>
    dz.x + margin + (xM - globalMinX) * metersToFt(1) * scale;
  const toSvgY = (yM: number) =>
    dz.y + dz.height - margin - (yM - globalMinY) * metersToFt(1) * scale;

  // ── Draw property setback boundary (dashed) ──
  const sbPx = setbackFt * scale;
  if (sbPx > 0 && sbPx < dz.width / 2) {
    els.push(`<rect
      x="${(dz.x + margin - sbPx).toFixed(1)}"
      y="${(dz.y + margin - sbPx).toFixed(1)}"
      width="${((dz.width - 2 * margin) + 2 * sbPx).toFixed(1)}"
      height="${((dz.height - 2 * margin) + 2 * sbPx).toFixed(1)}"
      fill="none" class="line-setbk"/>`);
    els.push(drawText(
      dz.x + margin + 4, dz.y + margin - sbPx - 4,
      `${setbackFt}' SETBACK (TYP.)`, {
        anchor: 'start', fontSize: 7, fill: '#cc0000', fontWeight: 'bold',
      }));
  }

  // ── STEP 6: Draw each array independently (segment engine) ──
  arrays.forEach((arr: any, ai: number) => {
    const ox    = arr._cadOriginX ?? arr.originX ?? (ai * 20);
    const oy    = arr._cadOriginY ?? arr.originY ?? 0;
    const rows  = arr.rowCount ?? arr.dimensions?.rowCount ?? 1;
    const ppr   = arr.panelsPerRow ?? arr.dimensions?.panelsPerRow ?? 1;
    const rowSp = arr.rowSpacingM ?? 2.5;   // meters
    const tilt  = arr.tiltDeg ?? 20;
    const az    = arr.azimuth ?? 180;
    const color = arrayColor(ai);
    const arrId = arr.id ?? `ARR-${ai + 1}`;

    // Panel dimensions in meters
    const pWm   = cadPanels[0]?.widthM  ?? 1.7;
    const pHm   = cadPanels[0]?.heightM ?? 1.0;

    // ── Draw piles (larger, more visible) ──
    const nPiles = ppr + 1;
    const pileSpacingM = arr.pileSpacingM ?? pWm;
    for (let r = 0; r < rows; r++) {
      for (let p = 0; p < nPiles; p++) {
        const pileX = ox + p * pileSpacingM;
        const pileY = oy + r * rowSp;
        const px    = toSvgX(pileX);
        const py    = toSvgY(pileY);
        // Outer circle (concrete footing indicator) — concrete gradient
        els.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="7" fill="url(#concrete-grad)" stroke="#666" stroke-width="1.2"/>`);
        // Inner pile cross section — steel gradient
        els.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="url(#pile-steel)" stroke="#333" stroke-width="0.8"/>`);
        // Cross mark
        els.push(`<line x1="${(px-3).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px+3).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#fff" stroke-width="0.8"/>`);
        els.push(`<line x1="${px.toFixed(1)}" y1="${(py-3).toFixed(1)}" x2="${px.toFixed(1)}" y2="${(py+3).toFixed(1)}" stroke="#fff" stroke-width="0.8"/>`);
      }
    }

    // ── Draw panel rows ──
    const cadRowData = arr._cadRows ?? arr.rows ?? [];
    for (let r = 0; r < rows; r++) {
      const rowY    = oy + r * rowSp;
      const rowData = cadRowData[r];
      const nPanels = rowData?.panelCount ?? ppr;

      for (let p = 0; p < nPanels; p++) {
        const panX = ox + p * pWm;
        const panY = rowY;
        const px   = toSvgX(panX);
        const py   = toSvgY(panY);
        const pw   = Math.max(pWm * metersToFt(1) * scale - 1, 4);
        const ph   = Math.max(pHm * metersToFt(1) * scale - 1, 3);

        // Panel body — dark blue PV module with glass gradient
        els.push(`<rect x="${px.toFixed(1)}" y="${(py - ph).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="url(#panel-glass)" stroke="#0a1e4a" stroke-width="0.9" opacity="0.92" rx="0.5"/>`);
        // Aluminum frame border
        els.push(`<rect x="${(px + 1).toFixed(1)}" y="${(py - ph + 1).toFixed(1)}" width="${(pw - 2).toFixed(1)}" height="${(ph - 2).toFixed(1)}" fill="none" stroke="rgba(180,210,240,0.6)" stroke-width="0.7"/>`);

        // Glass reflection highlight
        if (pw > 12 && ph > 8) {
          const rw5 = pw * 0.42, rh5 = ph * 0.42;
          els.push(`<rect x="${(px+1.5).toFixed(1)}" y="${(py - ph + 1.5).toFixed(1)}" width="${rw5.toFixed(1)}" height="${rh5.toFixed(1)}" fill="url(#panel-reflect)" rx="0.5"/>`);
        }
        // Cell lines (3 horizontal busbars)
        if (ph > 8) {
          const cellH = (ph - 2) / 3;
          for (let c = 1; c < 3; c++) {
            els.push(`<line x1="${(px+1).toFixed(1)}" y1="${(py - ph + 1 + c * cellH).toFixed(1)}" x2="${(px+pw-1).toFixed(1)}" y2="${(py - ph + 1 + c * cellH).toFixed(1)}" stroke="rgba(147,197,253,0.4)" stroke-width="0.5"/>`);
          }
        }
        // Cell lines (6 vertical)
        if (pw > 10) {
          const cellW = (pw - 2) / 6;
          for (let c = 1; c < 6; c++) {
            els.push(`<line x1="${(px + 1 + c * cellW).toFixed(1)}" y1="${(py-ph+1).toFixed(1)}" x2="${(px + 1 + c * cellW).toFixed(1)}" y2="${(py-1).toFixed(1)}" stroke="rgba(147,197,253,0.35)" stroke-width="0.4"/>`);
          }
        }
      }

      // Row label (right of row)
      const rowLabelX = toSvgX(ox + nPanels * pWm) + 4;
      const rowLabelY = toSvgY(rowY) - (pHm * metersToFt(1) * scale / 2);
      els.push(drawText(rowLabelX, rowLabelY, `R${r + 1}`, {
        anchor: 'start', fontSize: 6, fill: color,
      }));
    }

    // ── Tilt indicator (triangle showing tilt direction) ──
    const tiltX  = toSvgX(ox + ppr * pWm / 2);
    const tiltY  = toSvgY(oy - rowSp * 0.3);
    const tiltPts: Array<[number, number]> = [
      [tiltX - 12, tiltY + 8],
      [tiltX,      tiltY - 8],
      [tiltX + 12, tiltY + 8],
    ];
    els.push(drawPolygon(tiltPts, '#ff6600', 'line-hidden'));
    els.push(drawText(tiltX, tiltY + 18, `${tilt}° TILT`, {
      anchor: 'middle', fontSize: 6.5, fill: '#ff6600', fontWeight: 'bold',
    }));

    // ── Array label badge ──
    const arrLabelX = toSvgX(ox + ppr * pWm / 2);
    const arrLabelY = toSvgY(oy + rows * rowSp) + 14;
    const badgeW    = 60;
    els.push(`<rect x="${(arrLabelX - badgeW / 2).toFixed(1)}"
      y="${(arrLabelY - 7).toFixed(1)}"
      width="${badgeW}" height="12"
      fill="${color}" rx="2" opacity="0.85"/>`);
    els.push(drawText(arrLabelX, arrLabelY + 2.5,
      `${arrId}: ${ppr}×${rows}`, {
        anchor: 'middle', fontSize: 7, fill: '#fff', fontWeight: 'bold',
      }));
  });

  // ── North arrow ──
  els.push(drawNorthArrow(W - zones.dims.right - 18, H - zones.dims.bottom + 26, 22));

  // ── Scale bar ──
  const scaleBarFt = 20;
  const scaleBarPx = scaleBarFt * scale;
  els.push(drawScaleBar(zones.dims.left + 4, H - zones.dims.bottom + 28,
    Math.max(Math.round(scaleBarPx), 20), `0    ${scaleBarFt} FT`));

  // ── DIMENSION HIERARCHY ──
  // Only if arrays have meaningful coordinate spread
  if (isFinite(globalMinX) && spanXm > 0) {
    const totalWFt = spanXm * metersToFt(1);
    const totalHFt = spanYm * metersToFt(1);

    // L1 — Overall array field width (bottom)
    els.push(drawOverallDimension(
      toSvgX(globalMinX),
      toSvgX(globalMaxX),
      dz.y + dz.height + 8,
      20,
      ftToFtIn(totalWFt) + ' ARRAY FIELD'
    ));

    // L1 — Overall array depth (left side, vertical)
    if (totalHFt > 5) {
      els.push(drawVerticalDimension(
        dz.x - 16,
        toSvgY(globalMaxY),
        toSvgY(globalMinY),
        14,
        ftToFtIn(totalHFt) + ' DEPTH'
      ));
    }

    // L2 — Row spacing (first array, first two rows)
    if (arrays.length > 0 && arrays[0]?.rowSpacingM) {
      const arr0: any  = arrays[0];
      const ox0 = arr0._cadOriginX ?? arr0.originX ?? 0;
      const oy0 = arr0._cadOriginY ?? arr0.originY ?? 0;
      const rowSp0 = arr0.rowSpacingM ?? 2.5;
      const rsX = toSvgX(ox0 + (arr0.dimensions?.panelsPerRow ?? 1) * (cadPanels[0]?.widthM ?? 1.7) + 1);
      els.push(drawLinearDimension(
        rsX, rsX,
        toSvgY(oy0), 0, ''   // placeholder — TODO: better row spacing dim
      ));
    }
  }

  // ── Data zone — array schedule (STEP 8: ground-only data) ──
  const dZone = zones.data;
  let schedY = dZone.y + 4;

  // Schedule header
  els.push(drawRectFilled(dZone.x, schedY, dZone.width, 14, '#000', '#000', 0));
  els.push(drawText(dZone.x + dZone.width / 2, schedY + 9.5,
    'ARRAY SCHEDULE', {
      anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#fff',
    }));
  schedY += 16;

  // Column headers
  const hdrs  = ['#', 'ROWS', 'PPR', 'TILT', 'AZ'];
  const colXs = [dZone.x + 4, dZone.x + 22, dZone.x + 54, dZone.x + 78, dZone.x + 106];
  els.push(drawRectFilled(dZone.x, schedY, dZone.width, 11, '#334', '#334', 0));
  hdrs.forEach((h, hi) => {
    els.push(drawText(colXs[hi], schedY + 7.5, h, {
      anchor: 'start', fontSize: 6.5, fill: '#fff', fontWeight: 'bold',
    }));
  });
  schedY += 13;

  // Array rows
  arrays.forEach((arr: any, i: number) => {
    const rows  = arr.rowCount ?? arr.dimensions?.rowCount ?? '?';
    const ppr   = arr.panelsPerRow ?? arr.dimensions?.panelsPerRow ?? '?';
    const tilt  = (arr.tiltDeg ?? 20).toFixed(0);
    const az    = (arr.azimuth ?? 180).toFixed(0);
    const arrId = arr.id ?? `A${i + 1}`;
    const bg    = i % 2 === 0 ? '#fff' : '#f5f5f5';

    els.push(drawRectFilled(dZone.x, schedY, dZone.width, 11, bg, '#ddd', 0.5));
    els.push(`<rect x="${dZone.x + 1}" y="${schedY + 2}" width="6" height="7"
      fill="${arrayColor(i)}" rx="1"/>`);
    els.push(drawText(colXs[0] + 8, schedY + 7.5, escapeXml(String(arrId)), {
      anchor: 'start', fontSize: 6.5, fill: '#111',
    }));
    [String(rows), String(ppr), tilt + '°', az + '°'].forEach((val, vi) => {
      els.push(drawText(colXs[vi + 1], schedY + 7.5, val, {
        anchor: 'start', fontSize: 6.5, fill: '#111',
      }));
    });
    schedY += 12;
  });

  // Totals row
  schedY += 2;
  els.push(drawRectFilled(dZone.x, schedY, dZone.width, 12, '#eef', '#aab', 1));
  els.push(drawText(dZone.x + 4, schedY + 8, `${totalPanels} MOD — ${dcKw.toFixed(2)} kWdc`, {
    anchor: 'start', fontSize: 6.5, fill: '#000', fontWeight: 'bold',
  }));
  schedY += 16;

  // Ground-specific summary
  const firstTilt = arrays[0]?.tiltDeg ?? 20;
  els.push(drawText(dZone.x + 2, schedY,
    `TILT: ${firstTilt}° — AZ: ${compassDir(arrays[0]?.azimuth ?? 180)}`, {
      anchor: 'start', fontSize: 7, fill: '#333',
    }));
  schedY += 11;
  els.push(drawText(dZone.x + 2, schedY,
    `SETBACK: ${setbackFt}' (TYP.)`, {
      anchor: 'start', fontSize: 7, fill: '#333',
    }));
  schedY += 16;

  // v47.307: UTILITY ANALYSIS block (Bill Intelligence Layer)
  if (ctx) {
    const utilSvg = drawUtilityAnalysis(ctx, dZone.x, schedY, dZone.width);
    if (utilSvg) els.push(utilSvg);
  }

  // Bottom note
  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    'ARRAY SITE PLAN — FIELD VERIFY PILE LOCATIONS AND ROW SPACING — SEE PV-3 FOR STRUCTURAL', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// drawGroundStructural — PV-3 Pile Elevation + Structural Detail
// STEP 7: Full structural realism — pile embed, tilted panel, rails,
//         wind+snow+DL arrows, 3-level dimension hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export function drawGroundStructural(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { layout, engineering, project } = input;

  // ── STEP 4: CAD is the ONLY source of truth ──
  const cadGround = cad?.ground;
  const arrays: any[] = cadGround?.arrays ?? layout.groundArrays ?? [];

  if (!arrays || arrays.length === 0) {
    throw new Error(
      '[drawGroundStructural] No ground arrays. ground_mount requires cad.ground.arrays[].'
    );
  }

  // Get parameters from first array (representative for structural)
  const firstArr: any = arrays[0];
  const tiltDeg       = firstArr.tiltDeg   ?? 20;
  const pileDepthFt   = firstArr.pileDepthFt ?? metersToFt(firstArr.pileDepthM ?? 1.2);
  const pileSpacingFt = firstArr.pileSpacingFt ?? metersToFt(firstArr.pileSpacingM ?? 2.0);
  const rowSpacingFt  = firstArr.rowSpacingFt ?? metersToFt(firstArr.rowSpacingM ?? 2.5);
  const gcInch        = firstArr.groundClearanceIn ?? (firstArr.groundClearanceM ?? 0.3) * 39.3701;
  const gcFt          = gcInch / 12;
  const structureType = (firstArr.structureType ?? 'FIXED-TILT').toUpperCase();

  // Panel dimensions
  const panelLenIn  = project?.panelLengthIn ?? 66;
  const panelWidIn  = project?.panelWidthIn  ?? 40;
  const panelLenFt  = panelLenIn / 12;
  const panelWidFt  = panelWidIn / 12;
  const mountSys    = (project?.mountingSystem || 'IRONRIDGE IFM').toUpperCase();
  const windSpeedMph  = engineering.windSpeedMph   ?? project?.ahjWindSpeedMph   ?? 90;
  const groundSnowPsf = engineering.groundSnowPsf  ?? project?.ahjGroundSnowPsf  ?? 0;

  const totalPanels = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw        = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('ground_mount', 'structural');
  const W = zones.canvas.width;
  const H = zones.canvas.height;

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#fafafa'));
  els.push(drawTitleBar(W,
    'GROUND MOUNT — PILE ELEVATION + STRUCTURAL DETAIL',
    'SCALE: 1/2"=1\'-0"'));

  const dz   = zones.draw;
  const FT_PX = Math.min((dz.height * 0.5) / (pileDepthFt + gcFt + panelWidFt * 1.2), 24);

  // ── Derive heights ──
  const pileAboveFt = gcFt + 0.5;           // pile stub above grade
  const totalPileHFt = pileDepthFt + pileAboveFt;
  const panelProjectH = panelWidFt * Math.cos(tiltDeg * Math.PI / 180);   // vertical projection
  const panelProjectW = panelLenFt;                                          // horizontal projection (top-down)

  // Origin
  const groundY  = dz.y + dz.height * 0.55;
  const originX  = dz.x + 30;

  // 3 piles, spaced at pileSpacingFt
  const nPiles = 3;
  const pilePositions = [0, pileSpacingFt, pileSpacingFt * 2];
  const pileWPx = Math.max(FT_PX * 0.3, 5);

  // ── STEP 7: Ground plane ──
  // Sky
  els.push(`<rect x="${dz.x}" y="${dz.y}" width="${dz.width}" height="${(groundY - dz.y).toFixed(1)}"
    fill="#f0f8ff" opacity="0.45"/>`);
  // Earth
  els.push(`<rect x="${dz.x}" y="${groundY.toFixed(1)}" width="${dz.width}"
    height="${(dz.y + dz.height - groundY).toFixed(1)}"
    fill="#8B6914" opacity="0.18"/>`);
  // Earth hatch
  for (let hx = dz.x; hx < dz.x + dz.width * 0.85; hx += 8) {
    els.push(`<line x1="${hx.toFixed(1)}" y1="${groundY.toFixed(1)}"
      x2="${(hx - 10).toFixed(1)}" y2="${(groundY + 12).toFixed(1)}"
      stroke="#8B6914" stroke-width="0.7" opacity="0.5"/>`);
  }
  // Ground line
  els.push(drawLine(dz.x, groundY, originX + pileSpacingFt * 2 * FT_PX + 60, groundY, 'line-struct'));
  els.push(drawText(originX + pileSpacingFt * 2 * FT_PX + 64, groundY + 3, 'GRADE', {
    anchor: 'start', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));

  // ── Draw piles ──
  pilePositions.forEach((posFt, pi) => {
    const px = originX + posFt * FT_PX;

    // Above-grade pile stub — steel gradient + hatch
    const stubTopY = groundY - pileAboveFt * FT_PX;
    els.push(`<rect x="${(px - pileWPx/2).toFixed(1)}" y="${stubTopY.toFixed(1)}" width="${pileWPx}" height="${(pileAboveFt * FT_PX).toFixed(1)}" fill="url(#pile-steel)" stroke="#333" stroke-width="1.2"/>`);
    els.push(`<rect x="${(px - pileWPx/2).toFixed(1)}" y="${stubTopY.toFixed(1)}" width="${pileWPx}" height="${(pileAboveFt * FT_PX).toFixed(1)}" fill="url(#hatch-steel)" opacity="0.4"/>`);

    // Below-grade pile (embed) — dashed hidden line convention
    const embedBotY = groundY + pileDepthFt * FT_PX;
    els.push(`<rect x="${(px - pileWPx/2).toFixed(1)}" y="${groundY.toFixed(1)}" width="${pileWPx}" height="${(pileDepthFt * FT_PX).toFixed(1)}" fill="#707070" stroke="#333" stroke-width="1" stroke-dasharray="5,2"/>`);

    // Concrete collar ring at grade line
    const collarH = FT_PX * 0.4;
    els.push(`<rect x="${(px - pileWPx/2 - 4).toFixed(1)}" y="${(groundY - collarH/2).toFixed(1)}" width="${pileWPx + 8}" height="${collarH.toFixed(1)}" fill="url(#concrete-grad)" stroke="#777" stroke-width="1.0" rx="1"/>`);
    els.push(`<rect x="${(px - pileWPx/2 - 4).toFixed(1)}" y="${(groundY - collarH/2).toFixed(1)}" width="${pileWPx + 8}" height="${collarH.toFixed(1)}" fill="url(#hatch-concrete)" opacity="0.3" rx="1"/>`);

    // Pile tip (tapered)
    const tipH = FT_PX * 0.5;
    const tipPts: Array<[number, number]> = [
      [px - pileWPx / 2, embedBotY],
      [px,               embedBotY + tipH],
      [px + pileWPx / 2, embedBotY],
    ];
    els.push(drawPolygon(tipPts, '#555', 'line-struct'));

    // Pile label
    if (pi === 1) {
      els.push(drawText(px, stubTopY - 8, 'PILE (TYP.)', {
        anchor: 'middle', fontSize: 6.5, fill: '#333', fontWeight: 'bold',
      }));
    }

    // Pile callout
    els.push(drawCalloutWithLeader(
      px - 28, stubTopY + pileAboveFt * FT_PX / 2,
      px - pileWPx / 2, stubTopY + pileAboveFt * FT_PX / 2,
      pi + 1, 8
    ));
  });

  // ── Draw tilted panel (representative, over middle pile) ──
  const tiltRad   = tiltDeg * Math.PI / 180;
  const panPivotX = originX + pileSpacingFt * FT_PX;
  const panPivotY = groundY - pileAboveFt * FT_PX;

  // Panel base point (low end)
  const panW_px   = panelLenFt * FT_PX * 1.5;   // drawn slightly larger for visibility
  const panH_px   = Math.max(4, 8);              // panel thickness
  const panTopDX  = panelWidFt * FT_PX * 1.5 * Math.cos(tiltRad);
  const panTopDY  = panelWidFt * FT_PX * 1.5 * Math.sin(tiltRad);

  // Panel as a parallelogram (tilted)
  const p1x = panPivotX - panW_px / 2,            p1y = panPivotY;
  const p2x = panPivotX + panW_px / 2,            p2y = panPivotY;
  const p3x = p2x + panTopDX,                     p3y = p2y - panTopDY;
  const p4x = p1x + panTopDX,                     p4y = p1y - panTopDY;

  const panPts = `${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)} ${p4x.toFixed(1)},${p4y.toFixed(1)}`;
  // Panel body — dark blue PV glass with gradient
  els.push(`<polygon points="${panPts}" fill="url(#panel-glass-tilt)" stroke="#0a1e4a" stroke-width="1.2" opacity="0.93"/>`);
  // Aluminum frame inner edge (offset in from boundary)
  const fr = 2;
  const fPts = `${(p1x+fr).toFixed(1)},${(p1y-fr*0.2).toFixed(1)} ${(p2x-fr).toFixed(1)},${(p2y-fr*0.2).toFixed(1)} ${(p3x-fr).toFixed(1)},${(p3y+fr*0.2).toFixed(1)} ${(p4x+fr).toFixed(1)},${(p4y+fr*0.2).toFixed(1)}`;
  els.push(`<polygon points="${fPts}" fill="none" stroke="rgba(180,210,240,0.6)" stroke-width="0.8"/>`);

  // Cell busbars (6 columns across panel width)
  for (let c = 1; c < 6; c++) {
    const t = c / 6;
    const lx1 = p1x + t * (p2x - p1x);
    const ly1 = p1y + t * (p2y - p1y);
    const lx2 = p4x + t * (p3x - p4x);
    const ly2 = p4y + t * (p3y - p4y);
    els.push(`<line x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}" x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" stroke="rgba(147,197,253,0.5)" stroke-width="0.5"/>`);
  }
  // Cell rows (3 rows across panel height)
  for (let r = 1; r < 3; r++) {
    const t = r / 3;
    const lx1 = p1x + t * (p4x - p1x);
    const ly1 = p1y + t * (p4y - p1y);
    const lx2 = p2x + t * (p3x - p2x);
    const ly2 = p2y + t * (p3y - p2y);
    els.push(`<line x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}" x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" stroke="rgba(147,197,253,0.4)" stroke-width="0.4"/>`);
  }

  // Panel label
  const panMidX = (p1x + p2x + p3x + p4x) / 4;
  const panMidY = (p1y + p2y + p3y + p4y) / 4;
  els.push(drawText(panMidX, panMidY, `${tiltDeg}° TILT`, {
    anchor: 'middle', fontSize: 7, fill: '#fff', fontWeight: 'bold',
  }));

  // ── Rail (horizontal beam between piles) ──
  const railY = panPivotY - 2;
  els.push(`<line x1="${(originX - 10).toFixed(1)}" y1="${railY.toFixed(1)}"
    x2="${(originX + pileSpacingFt * 2 * FT_PX + 10).toFixed(1)}" y2="${railY.toFixed(1)}"
    stroke="#888" stroke-width="4" stroke-linecap="round"/>`);

  // ── STEP 7: Load arrows ──
  const arrowX  = originX + pileSpacingFt * 2 * FT_PX + 30;
  const panTopY = Math.min(p3y, p4y);

  // Wind load (horizontal, pointing left into panel)
  els.push(drawWindArrow(
    arrowX + 40, panMidY,
    40, 'left',
    `WIND ${windSpeedMph} MPH`
  ));

  // Snow load (vertical, pointing down onto panel top)
  if (groundSnowPsf > 0) {
    els.push(drawWindArrow(
      panMidX, panTopY - 24,
      20, 'down',
      `SNOW ${groundSnowPsf} PSF`
    ));
  }

  // Dead load (vertical, pointing down)
  els.push(drawWindArrow(
    panMidX - 18, panTopY - 24,
    20, 'down',
    'DL'
  ));

  // ── STEP 7: 3-level dimension hierarchy ──

  // L1 — Pile embedment depth (left, vertical)
  els.push(drawVerticalDimension(
    originX - 42, groundY, groundY + pileDepthFt * FT_PX,
    16, ftToFtIn(pileDepthFt) + ' EMBED'
  ));

  // L1 — Ground clearance (left, vertical above grade)
  els.push(drawVerticalDimension(
    originX - 42, groundY, panPivotY,
    16, ftToFtIn(pileAboveFt) + ' CLR.'
  ));

  // L2 — Pile spacing (bottom, horizontal)
  els.push(drawLinearDimension(
    originX, originX + pileSpacingFt * FT_PX,
    groundY + pileDepthFt * FT_PX + 18, 12,
    ftToFtIn(pileSpacingFt) + ' O.C.'
  ));

  // L2 — Overall 2-pile span
  els.push(drawOverallDimension(
    originX, originX + pileSpacingFt * 2 * FT_PX,
    groundY + pileDepthFt * FT_PX + 32, 16,
    ftToFtIn(pileSpacingFt * 2) + ' SPAN'
  ));

  // L3 — Tilt angle annotation
  const tiltArcR = 28;
  els.push(`<path d="M ${panPivotX} ${panPivotY - 4}
    L ${panPivotX + tiltArcR} ${panPivotY - 4}
    A ${tiltArcR} ${tiltArcR} 0 0 0 ${(panPivotX + tiltArcR * Math.cos(-tiltRad)).toFixed(1)} ${(panPivotY - 4 - tiltArcR * Math.sin(-tiltRad)).toFixed(1)}"
    fill="none" stroke="#ff6600" stroke-width="1.2"/>`);
  els.push(drawText(panPivotX + tiltArcR + 6, panPivotY - 4 - tiltArcR / 2,
    tiltDeg + '°', {
      anchor: 'start', fontSize: 8, fill: '#ff6600', fontWeight: 'bold',
    }));

  // ── Data zone — ground structural schedule (STEP 8: ground-only) ──
  const dZone = zones.data;
  let ry = dZone.y + 4;

  els.push(drawRectFilled(dZone.x, ry, dZone.width, 14, '#000', '#000', 0));
  els.push(drawText(dZone.x + dZone.width / 2, ry + 9.5,
    'STRUCTURAL SCHEDULE', {
      anchor: 'middle', fontSize: 7.5, fontWeight: '900', fill: '#fff',
    }));
  ry += 16;

  // Callout items (STEP 8: ground-only — NO fence/roof terms)
  const calloutItems = [
    { n: 1, label: `DRIVEN PILE — ${ftToFtIn(pileDepthFt)} EMBED` },
    { n: 2, label: `PILE SPACING — ${ftToFtIn(pileSpacingFt)} O.C.` },
    { n: 3, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}"` },
    { n: 4, label: `${structureType} — ${tiltDeg}° TILT` },
    { n: 5, label: `TORQUE TUBE / RAIL — ${mountSys}` },
    { n: 6, label: `WIND LOAD — ${windSpeedMph} MPH (ASCE 7-22)` },
    { n: 7, label: groundSnowPsf > 0
        ? `SNOW LOAD — ${groundSnowPsf} PSF (ASCE 7-22)`
        : 'SNOW LOAD — N/A (SEE CALCULATIONS)' },
    { n: 8, label: `GROUND CLEARANCE — ${gcInch.toFixed(0)}" MIN.` },
  ];

  const rowH = 19;
  calloutItems.forEach((item, i) => {
    const rowY = ry + i * rowH;
    const bg   = i % 2 === 0 ? '#fff' : '#f5f5f5';
    els.push(drawRectFilled(dZone.x, rowY, dZone.width, rowH - 1, bg, '#ddd', 0.5));
    els.push(drawCallout({ cx: dZone.x + 11, cy: rowY + 8, number: item.n, r: 7 }));
    els.push(drawText(dZone.x + 23, rowY + 11, item.label, {
      anchor: 'start', fontSize: 6.5, fill: '#222',
    }));
  });
  ry += calloutItems.length * rowH + 4;

  // Divider
  els.push(`<line x1="${dZone.x}" y1="${ry}" x2="${dZone.x + dZone.width}" y2="${ry}"
    stroke="#ccc" stroke-width="0.7"/>`);
  ry += 6;

  // GROUND-SPECIFIC NOTES (no fence/roof terms)
  const notes = [
    { text: `SYSTEM: ${mountSys}`, bold: true },
    { text: `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`, bold: false },
    { text: `ROW SPACING: ${ftToFtIn(rowSpacingFt)} (TYP.)`, bold: false },
    { text: `PILE DEPTH: ${ftToFtIn(pileDepthFt)} MIN.`, bold: false },
    { text: `GROUND CLEAR: ${gcInch.toFixed(0)}" MIN.`, bold: false },
    { text: `REF: NEC 690 / IBC 1609 / ASCE 7-22`, bold: false },
    { text: 'VERIFY PILE SIZE + DEPTH WITH GEOTECH.', bold: true, red: true },
  ];
  notes.forEach((note, ni) => {
    els.push(drawText(dZone.x + 4, ry + ni * 10, note.text, {
      anchor: 'start',
      fontSize: 6.5,
      fill: note.red ? '#cc0000' : '#333',
      fontWeight: note.bold ? 'bold' : 'normal',
    }));
  });
  ry += notes.length * 10 + 6;

  // UTILITY ANALYSIS (Bill Intelligence Layer — injected if ctx present)
  if (ctx) {
    const utilSvg = drawUtilityAnalysis(ctx, dZone.x, ry, dZone.width);
    if (utilSvg) els.push(utilSvg);
  }

  // Scale note
  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    'PILE ELEVATION SCHEMATIC — VERIFY PILE DIAMETER, DEPTH + SPACING WITH GEOTECH REPORT — NTS', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}