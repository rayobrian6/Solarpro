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
import { getMountingSystemById } from '../../mounting-hardware-db';

// ── ARRAY COLORS (one per array, wraps) ──────────────────────────────────────
const ARRAY_COLORS = [
  '#2255aa', '#1a7a3a', '#8b1a1a', '#7a5500', '#4a1a7a',
  '#006666', '#7a3a00', '#003366', '#5a0033', '#336600',
];
function arrayColor(i: number): string {
  return ARRAY_COLORS[i % ARRAY_COLORS.length];
}

// ── Ground mount-system name resolution (STEP 9 cross-contamination block) ────
// A ground sheet must NEVER brand the project-wide ROOF racking. project
// .mountingSystem is a flat scalar that carries the roof racking on hybrid
// sets (Stowell PV-3G printed "SYSTEM: ROOF TECH RT-MINI" / "TORQUE TUBE/RAIL
// — ROOF TECH RT-MINI"). Mirror the fence template's resolveFenceMountName:
// trust an explicit ground mountingSystemId, else a ground-sounding scalar,
// else fall back to a generic ground display keyed off the pile structure —
// but drop any roof/fence brand that leaked through the scalar.
const NON_GROUND_MOUNT_RE =
  /roof\s?tech|rt[-\s]?mini|iron\s?ridge|ironridge|unirac|snapnrack|snap\s?n\s?rack|quick\s?mount|s-5|xr\s?\d|ecofoot|flashfoot|solfence|solar\s?fence|comp\s?rafter|tile\s?hook/i;

function groundDisplayFor(structureType?: string): string {
  const st = String(structureType ?? '').toLowerCase();
  if (st.includes('helical'))  return 'GROUND-MOUNT STEEL RACKING (HELICAL PILE)';
  if (st.includes('ballast'))  return 'GROUND-MOUNT STEEL RACKING (BALLASTED)';
  if (st.includes('concrete')) return 'GROUND-MOUNT STEEL RACKING (CONCRETE PIER)';
  return 'GROUND-MOUNT STEEL RACKING (DRIVEN PILE)';
}

/** Resolve the ground-racking display name — never a roof/fence mount that
 *  leaked through the flat project scalars. Always returns UPPERCASE. */
function resolveGroundMountName(
  project: Record<string, unknown> | undefined | null,
  structureType?: string,
): string {
  const sel = project?.mountingSystemId
    ? getMountingSystemById(String(project.mountingSystemId))
    : undefined;
  if (sel && sel.category === 'ground_mount')
    return `${sel.manufacturer} ${sel.model}`.toUpperCase();
  if (sel) return groundDisplayFor(structureType);              // non-ground id ⇒ contamination
  const name = String(project?.mountingSystem ?? '').trim();
  if (name && NON_GROUND_MOUNT_RE.test(name))
    return groundDisplayFor(structureType);                     // roof/fence brand by name
  return name ? name.toUpperCase() : groundDisplayFor(structureType);
}

/** Human-facing array label — strip internal/synthetic ids (gps-array,
 *  gps2array, default, bare numbers, uuid-ish) so they never hit the drawing. */
function arrayLabel(arr: any, i: number): string {
  const raw = String(arr?.id ?? '').trim();
  const internal =
    !raw ||
    /gps|array|layout|default|row|col|^\d+$|[0-9a-f]{8}|-/i.test(raw);
  return internal ? `ARRAY ${i + 1}` : raw.toUpperCase();
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

  // ── Panel dimensions (fallback only; real modules carry their own dims) ──
  const firstArr: any = arrays[0];
  const cadPanels = firstArr?._cadPanels ?? firstArr?.panels ?? [];
  const pWmDefault = cadPanels[0]?.widthM  ?? (input.project?.panelLengthIn ?? 66) * 0.0254;
  const pHmDefault = cadPanels[0]?.heightM ?? (input.project?.panelWidthIn  ?? 40) * 0.0254;

  // ── Collect the REAL module rectangles (meters, top-left) from CAD ──
  // CAD is the source of truth: draw each array's actual panels, never a
  // re-synthesized sliver grid. Fall back to a computed grid only when the
  // array carries no panels (raw layout.groundArrays without a CAD solve).
  type Rect = { x: number; y: number; w: number; h: number };
  function panelRectsFor(arr: any): Rect[] {
    const rowsN = arr.rowCount ?? arr.dimensions?.rowCount ?? 0;
    const pprN  = arr.panelsPerRow ?? arr.dimensions?.panelsPerRow ?? 0;
    // PREFER a normalized rowCount × panelsPerRow grid — the reliable values the
    // ARRAY SCHEDULE + sheet header already state ("2 ROWS × 8"). Real per-panel
    // CAD coords for a ground array can be a staggered/diagonal sequence (NOT a
    // clean rectangle); drawing those raw produced a garbage cascade + a bogus
    // "16 ROWS × 1" badge. The plan view is a schematic "field-verify" layout, so
    // a clean grid is both correct and consistent with the schedule/header.
    if (rowsN > 0 && pprN > 0) {
      const ox    = arr._cadOriginX ?? arr.originX ?? 0;
      const oy    = arr._cadOriginY ?? arr.originY ?? 0;
      const rowSp = arr.rowSpacingM ?? Math.max(pHmDefault * 1.15, 1.6);
      const colSp = pWmDefault + 0.03;
      const rects: Rect[] = [];
      for (let r = 0; r < rowsN; r++)
        for (let c = 0; c < pprN; c++)
          rects.push({ x: ox + c * colSp, y: oy + r * rowSp, w: pWmDefault, h: pHmDefault });
      return rects;
    }
    // Fallback: raw panels only when no declared grid is available.
    const panels: any[] = arr?._cadPanels ?? arr?.panels
      ?? (arr?._cadRows ?? arr?.rows ?? []).flatMap((r: any) => r?.panels ?? []);
    if (panels.length > 0) {
      return panels.map((p: any) => ({
        x: p.x, y: p.y, w: p.widthM ?? pWmDefault, h: p.heightM ?? pHmDefault,
      }));
    }
    return [{ x: 0, y: 0, w: pWmDefault, h: pHmDefault }];
  }

  const arrayRects: Rect[][] = arrays.map(panelRectsFor);

  // ── Global bounding box of every real module (meters) ──
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
  for (const rects of arrayRects) for (const r of rects) {
    gMinX = Math.min(gMinX, r.x);   gMaxX = Math.max(gMaxX, r.x + r.w);
    gMinY = Math.min(gMinY, r.y);   gMaxY = Math.max(gMaxY, r.y + r.h);
  }
  if (!isFinite(gMinX)) { gMinX = 0; gMaxX = 15; gMinY = 0; gMaxY = 5; }

  const spanXft = Math.max((gMaxX - gMinX) * metersToFt(1), 1);
  const spanYft = Math.max((gMaxY - gMinY) * metersToFt(1), 1);

  // ═══════════════════════════════════════════════════════════════════════════
  // SPLIT LAYOUT (engine intent — "array plan + row elevation"): the draw zone
  // stacks THREE full-width CAD viewports so the sheet fills like a pro
  // ground-mount permit plan instead of a small top-down floating in white:
  //   A · TOP VIEW — MODULE LAYOUT      (top-down array field, setback, piles)
  //   B · ROW SPACING — SIDE ELEVATION  (tilt, O.C. pitch, ground clearance)
  //   C · TYPICAL PILE FOUNDATION       (driven pile, embedment, module section)
  // The right DATA zone carries the ARRAY SCHEDULE + ground notes full-height.
  // ═══════════════════════════════════════════════════════════════════════════
  const VP_HDR = 13, VP_GAP = 12;
  const bodyH  = dz.height - 3 * VP_HDR - 2 * VP_GAP;
  const hA = Math.round(bodyH * 0.44);
  const hB = Math.round(bodyH * 0.28);
  const hC = bodyH - hA - hB;

  function vpHeader(x: number, y: number, w: number, label: string): void {
    els.push(drawRectFilled(x, y, w, VP_HDR, '#1a2332', '#1a2332', 0));
    els.push(drawText(x + 6, y + VP_HDR - 3.5, label, {
      anchor: 'start', fontSize: 7.5, fontWeight: '900', fill: '#fff',
    }));
  }

  // ── Viewport A: TOP VIEW — MODULE LAYOUT ────────────────────────────────────
  let vy = dz.y;
  vpHeader(dz.x, vy, dz.width, 'A · TOP VIEW — MODULE LAYOUT'); vy += VP_HDR;
  const vpA = { x: dz.x, y: vy, w: dz.width, h: hA }; vy += hA + VP_GAP;
  {
    const padTop = 18, padBot = 26, padX = 26;
    const availW = vpA.w - 2 * padX, availH = vpA.h - padTop - padBot;
    const scale  = Math.min(availW / spanXft, availH / spanYft);   // px per ft
    const contentWpx = spanXft * scale, contentHpx = spanYft * scale;
    const offX = vpA.x + (vpA.w - contentWpx) / 2;
    const offY = vpA.y + padTop + (availH - contentHpx) / 2;
    const toSvgX = (xM: number) => offX + (xM - gMinX) * metersToFt(1) * scale;
    const toSvgY = (yM: number) => offY + (yM - gMinY) * metersToFt(1) * scale;

    // Property setback boundary (dashed) around the actual array field
    const sbPx = setbackFt * scale;
    if (sbPx > 1) {
      els.push(`<rect x="${(offX - sbPx).toFixed(1)}" y="${(offY - sbPx).toFixed(1)}" width="${(contentWpx + 2 * sbPx).toFixed(1)}" height="${(contentHpx + 2 * sbPx).toFixed(1)}" fill="none" class="line-setbk"/>`);
      els.push(drawText(offX - sbPx + 3, offY - sbPx - 3,
        `${setbackFt}' SETBACK (TYP.)`, {
          anchor: 'start', fontSize: 6.5, fill: '#cc0000', fontWeight: 'bold',
        }));
    }

    // Draw each array (CAD-driven, clean top-down)
    arrays.forEach((arr: any, ai: number) => {
      const rects = arrayRects[ai];
      if (rects.length === 0) return;
      const color = arrayColor(ai);
      const tilt  = arr.tiltDeg ?? 20;
      const az    = arr.azimuth ?? 180;

      let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
      for (const r of rects) {
        aMinX = Math.min(aMinX, r.x);  aMaxX = Math.max(aMaxX, r.x + r.w);
        aMinY = Math.min(aMinY, r.y);  aMaxY = Math.max(aMaxY, r.y + r.h);
      }

      const rowMap = new Map<number, Rect[]>();
      for (const r of rects) {
        const k = Math.round(r.y * 20);
        let band = rowMap.get(k);
        if (!band) { band = []; rowMap.set(k, band); }
        band.push(r);
      }
      const rowBands = [...rowMap.values()].sort(
        (a, b) => Math.min(...a.map(r => r.y)) - Math.min(...b.map(r => r.y)));

      // Modules: clean flat CAD rectangles
      for (const r of rects) {
        const x = toSvgX(r.x), y = toSvgY(r.y);
        const w = Math.max(r.w * metersToFt(1) * scale, 3);
        const h = Math.max(r.h * metersToFt(1) * scale, 2);
        els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#cfe0f4" stroke="${color}" stroke-width="0.9"/>`);
        if (h > 6) {
          els.push(`<line x1="${x.toFixed(1)}" y1="${(y + h / 2).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + h / 2).toFixed(1)}" stroke="${color}" stroke-width="0.35" opacity="0.5"/>`);
        }
      }

      // Piles under the row bands (foundation line + pile dots at O.C.)
      const pileSpM = arr.pileSpacingM ?? (pWmDefault * 2);
      rowBands.forEach((band) => {
        let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
        for (const r of band) {
          bMinX = Math.min(bMinX, r.x);       bMaxX = Math.max(bMaxX, r.x + r.w);
          bMinY = Math.min(bMinY, r.y);       bMaxY = Math.max(bMaxY, r.y + r.h);
        }
        const cyM   = (bMinY + bMaxY) / 2;
        const spanM = bMaxX - bMinX;
        const nGaps = Math.max(1, Math.round(spanM / pileSpM));
        const py    = toSvgY(cyM);
        els.push(`<line x1="${toSvgX(bMinX).toFixed(1)}" y1="${py.toFixed(1)}" x2="${toSvgX(bMaxX).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#555" stroke-width="0.7" stroke-dasharray="3,2" opacity="0.7"/>`);
        for (let i = 0; i <= nGaps; i++) {
          const px = toSvgX(bMinX + (spanM * i) / nGaps);
          els.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="#4a4a4a" stroke="#fff" stroke-width="0.7"/>`);
        }
      });

      // Row labels (left of each band)
      rowBands.forEach((band, ri) => {
        const bMinY = Math.min(...band.map(r => r.y));
        const bMaxY = Math.max(...band.map(r => r.y + r.h));
        const bMinX = Math.min(...band.map(r => r.x));
        els.push(drawText(toSvgX(bMinX) - 5, (toSvgY(bMinY) + toSvgY(bMaxY)) / 2 + 2,
          `R${ri + 1}`, { anchor: 'end', fontSize: 6.5, fill: color, fontWeight: 'bold' }));
      });

      // Tilt / azimuth marker (above the array)
      const midXm = (aMinX + aMaxX) / 2;
      const tX = toSvgX(midXm), tY = toSvgY(aMinY) - 11;
      els.push(drawPolygon([[tX - 9, tY - 6], [tX + 9, tY - 6], [tX, tY + 4]], '#ff6600', 'line-hidden'));
      els.push(drawText(tX, tY - 9, `${tilt}° / ${compassDir(az)}`, {
        anchor: 'middle', fontSize: 6.5, fill: '#ff6600', fontWeight: 'bold',
      }));

      // Array label badge
      const rowCount = rowBands.length;
      const ppr      = Math.max(...rowBands.map(b => b.length));
      const label    = arrayLabel(arr, ai);
      const bText    = `${label} — ${rowCount} ROW${rowCount > 1 ? 'S' : ''} × ${ppr}`;
      const bW       = Math.max(bText.length * 4.4 + 10, 60);
      const bX       = toSvgX(midXm), bY = toSvgY(aMaxY) + 11;
      els.push(`<rect x="${(bX - bW / 2).toFixed(1)}" y="${(bY - 8).toFixed(1)}" width="${bW.toFixed(1)}" height="13" fill="${color}" rx="2" opacity="0.9"/>`);
      els.push(drawText(bX, bY + 1.5, bText, {
        anchor: 'middle', fontSize: 7, fill: '#fff', fontWeight: 'bold',
      }));
    });

    // Field-extent dimensions + north arrow + scale bar (all viewport-local)
    els.push(drawOverallDimension(
      toSvgX(gMinX), toSvgX(gMaxX), offY + contentHpx + 12, 16,
      ftToFtIn(spanXft) + ' ARRAY FIELD'));
    if (spanYft > 3) {
      els.push(drawVerticalDimension(
        offX - 12, toSvgY(gMaxY), toSvgY(gMinY), 14, ftToFtIn(spanYft) + ' DEPTH'));
    }
    els.push(drawNorthArrow(vpA.x + vpA.w - 20, vpA.y + 20, 17));
    els.push(drawScaleBar(vpA.x + 6, vpA.y + vpA.h - 6,
      Math.max(Math.round(20 * scale), 20), '0    20 FT'));
  }

  // ── Lower split: B (side elevation) + C (pile section) fill the LEFT column,
  //    a GROUND MOUNT NOTES panel fills the RIGHT — together they span the full
  //    width below the plan so no quadrant of the sheet reads empty. ──
  const leftW  = Math.round(dz.width * 0.62);
  const rightX = dz.x + leftW + 14;
  const rightW = dz.x + dz.width - rightX;
  const panelTop = vy;

  // ── Viewport B: ROW SPACING — SIDE ELEVATION ────────────────────────────────
  vpHeader(dz.x, vy, leftW, 'B · ROW SPACING — SIDE ELEVATION'); vy += VP_HDR;
  const vpB = { x: dz.x, y: vy, w: leftW, h: hB }; vy += hB + VP_GAP;
  {
    const a0: any = arrays[0] ?? {};
    const rowCount  = Math.max(1, a0.rowCount ?? a0.dimensions?.rowCount ?? 2);
    const spacingFt = (a0.rowSpacingM ?? 1.6) * metersToFt(1);
    const tilt      = a0.tiltDeg ?? 25;
    const clearFt   = (a0.groundClearanceM ?? 0.46) * metersToFt(1);
    const showRows  = Math.min(rowCount, 4);
    const mL = 58, mR = 28;
    const baseY = vpB.y + vpB.h * 0.66;
    const avail   = vpB.w - mL - mR;
    const pitchPx = avail / Math.max(showRows, 2);
    const modLen  = Math.min(pitchPx * 0.82, vpB.h * 0.52, 120);
    const rise    = Math.sin(tilt * Math.PI / 180) * modLen;
    const run     = Math.cos(tilt * Math.PI / 180) * modLen;
    const clrPx   = Math.min(Math.max(clearFt, 0.5) * 10, 30);
    const pileBotY = Math.min(vpB.y + vpB.h - 6, baseY + 30);

    // Ground line + hatch ticks
    els.push(`<line x1="${(vpB.x + 16).toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${(vpB.x + vpB.w - 14).toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#6b4a2a" stroke-width="1.8"/>`);
    for (let i = 0; i < 14; i++) {
      const gx = vpB.x + 20 + i * ((vpB.w - 40) / 14);
      els.push(`<line x1="${gx.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${(gx - 5).toFixed(1)}" y2="${(baseY + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.6"/>`);
    }
    // Tilted module rows on driven piles (pile continues below grade, dashed)
    for (let r = 0; r < showRows; r++) {
      const bx = vpB.x + mL + r * pitchPx, by = baseY - clrPx;
      const tx = bx + run, ty = by - rise;
      const pileX = (bx + tx) / 2;
      els.push(`<line x1="${pileX.toFixed(1)}" y1="${((by + ty) / 2).toFixed(1)}" x2="${pileX.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#555" stroke-width="1.8"/>`);
      els.push(`<line x1="${pileX.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${pileX.toFixed(1)}" y2="${pileBotY.toFixed(1)}" stroke="#555" stroke-width="1.8" stroke-dasharray="3,2"/>`);
      els.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#1a4a8a" stroke-width="5" stroke-linecap="round"/>`);
    }
    // O.C. dimension between first two rows
    if (showRows >= 2) {
      const dx1 = vpB.x + mL, dx2 = vpB.x + mL + pitchPx, dy = pileBotY + 12;
      els.push(`<line x1="${dx1.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${dx2.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#c00" stroke-width="0.9"/>`);
      els.push(`<line x1="${dx1.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${dx1.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>`);
      els.push(`<line x1="${dx2.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${dx2.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>`);
      els.push(drawText((dx1 + dx2) / 2, dy - 3, `${spacingFt.toFixed(1)}' O.C.`, {
        anchor: 'middle', fontSize: 7, fontWeight: 'bold', fill: '#c00' }));
    }
    els.push(drawText(vpB.x + mL + run + 6, baseY - clrPx - rise - 4, `${Math.round(tilt)}° TILT`, {
      anchor: 'start', fontSize: 8, fontWeight: 'bold', fill: '#1a4a8a' }));
    els.push(drawText(vpB.x + mL - 6, baseY - clrPx / 2 + 2, `${clearFt.toFixed(1)}' CLR`, {
      anchor: 'end', fontSize: 7, fill: '#333' }));
  }

  // ── Viewport C: TYPICAL PILE FOUNDATION SECTION ─────────────────────────────
  vpHeader(dz.x, vy, leftW, 'C · TYPICAL PILE FOUNDATION SECTION'); vy += VP_HDR;
  const vpC = { x: dz.x, y: vy, w: leftW, h: hC };
  {
    const a0: any = arrays[0] ?? {};
    const tilt    = a0.tiltDeg ?? 25;
    const embedFt = (a0.pileDepthM ?? 1.5) * metersToFt(1);
    const clearFt = (a0.groundClearanceM ?? 0.46) * metersToFt(1);
    const cx      = vpC.x + vpC.w * 0.44;
    const grade   = vpC.y + vpC.h * 0.46;
    const ftPx    = Math.min((vpC.y + vpC.h - 20 - grade) / Math.max(embedFt, 1), 26);

    // Grade line + hatch
    els.push(`<line x1="${(vpC.x + 20).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(vpC.x + vpC.w - 20).toFixed(1)}" y2="${grade.toFixed(1)}" stroke="#6b4a2a" stroke-width="1.8"/>`);
    for (let i = 0; i < 18; i++) {
      const gx = vpC.x + 24 + i * ((vpC.w - 48) / 18);
      els.push(`<line x1="${gx.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(gx - 5).toFixed(1)}" y2="${(grade + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.5"/>`);
    }
    // Driven pile: above grade (solid) + below grade (dashed)
    const pileTop = grade - vpC.h * 0.34;
    const pileBot = grade + embedFt * ftPx;
    els.push(`<rect x="${(cx - 3.5).toFixed(1)}" y="${pileTop.toFixed(1)}" width="7" height="${(grade - pileTop).toFixed(1)}" fill="#8a8a8a" stroke="#333" stroke-width="1"/>`);
    els.push(`<rect x="${(cx - 3.5).toFixed(1)}" y="${grade.toFixed(1)}" width="7" height="${(pileBot - grade).toFixed(1)}" fill="#707070" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);
    // Tilted module bearing on the pile head
    const modLen = Math.min(vpC.w * 0.30, 130);
    const rise = Math.sin(tilt * Math.PI / 180) * modLen, run = Math.cos(tilt * Math.PI / 180) * modLen;
    const mbx = cx - run / 2, mby = pileTop + rise / 2, mtx = cx + run / 2, mty = pileTop - rise / 2;
    els.push(`<line x1="${mbx.toFixed(1)}" y1="${mby.toFixed(1)}" x2="${mtx.toFixed(1)}" y2="${mty.toFixed(1)}" stroke="#1a4a8a" stroke-width="6" stroke-linecap="round"/>`);
    // Embed dimension line (right of pile) + labels
    els.push(`<line x1="${(cx + 16).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(cx + 16).toFixed(1)}" y2="${pileBot.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    els.push(drawText(cx + 20, (grade + pileBot) / 2, `${embedFt.toFixed(1)}' EMBED (MIN)`, {
      anchor: 'start', fontSize: 7.5, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(cx - 12, (pileTop + grade) / 2, `${clearFt.toFixed(1)}' CLR`, {
      anchor: 'end', fontSize: 7.5, fill: '#333' }));
    els.push(drawText(mtx + 6, mty - 2, `${Math.round(tilt)}° MODULE`, {
      anchor: 'start', fontSize: 7.5, fontWeight: 'bold', fill: '#1a4a8a' }));
    els.push(drawText(vpC.x + vpC.w / 2, pileBot + 13,
      'DRIVEN STEEL PILE — NO CONCRETE — FIELD VERIFY REFUSAL DEPTH', {
        anchor: 'middle', fontSize: 6.5, fill: '#888', italic: true }));
  }

  // ── RIGHT panel: GROUND MOUNT NOTES (fills the right of viewports B + C) ─────
  // NOT a schedule (that lives in the outer ARRAY DATA / per-sub frame) — these
  // are drawing notes, legit CAD furniture, so the lower-right isn't blank.
  {
    const pH = (dz.y + dz.height) - panelTop;
    els.push(drawRectFilled(rightX, panelTop, rightW, pH, '#fafbff', '#c8d0e0', 1));
    els.push(drawRectFilled(rightX, panelTop, rightW, 14, '#1a2332', '#1a2332', 0));
    els.push(drawText(rightX + 7, panelTop + 9.8, 'GROUND MOUNT NOTES', {
      anchor: 'start', fontSize: 8, fontWeight: '900', fill: '#fff' }));
    els.push(drawText(rightX + 7, panelTop + 26,
      `SYSTEM: ${totalPanels} MOD · ${dcKw.toFixed(2)} kWdc · ${(arrays[0]?.tiltDeg ?? 20)}° TILT`, {
      anchor: 'start', fontSize: 6.8, fontWeight: 'bold', fill: '#1a2332' }));
    const gNotes = [
      'Foundation: driven steel pile — no concrete.',
      'Field-verify pile refusal depth + embedment.',
      'Modules portrait, side-by-side per row.',
      `Row spacing ${((arrays[0]?.rowSpacingM ?? 1.6) * metersToFt(1)).toFixed(1)}' O.C. — verify inter-row shading.`,
      `Array setback ${setbackFt}' min. from property line.`,
      'Bond all metal framework to EGC — see PV-3.',
      'Racking + fasteners per manufacturer ICC-ES.',
      'All dimensions NTS — verify in field.',
    ];
    let ny = panelTop + 38;
    gNotes.forEach((n, i) => {
      els.push(drawText(rightX + 5, ny + 6, `${i + 1}.`, {
        anchor: 'start', fontSize: 6.5, fill: '#1a2332', fontWeight: 'bold' }));
      els.push(drawText(rightX + 15, ny + 6, n, {
        anchor: 'start', fontSize: 6.5, fill: '#333' }));
      ny += 14;
    });
    if (ctx) {
      const utilSvg = drawUtilityAnalysis(ctx, rightX + 3, ny + 6, rightW - 6);
      if (utilSvg) els.push(utilSvg);
    }
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
  // Structure type reads as a clean label ("DRIVEN PILE", not "DRIVEN_PILE").
  const structureType = String(firstArr.structureType ?? 'FIXED-TILT')
    .replace(/[_-]+/g, ' ').trim().toUpperCase();

  // Panel dimensions
  const panelLenIn  = project?.panelLengthIn ?? 66;
  const panelWidIn  = project?.panelWidthIn  ?? 40;
  const panelLenFt  = panelLenIn / 12;
  const panelWidFt  = panelWidIn / 12;
  // STEP 9 cross-contamination block: a GROUND sheet must never brand the
  // project-wide ROOF racking. The flat project.mountingSystem scalar leaked
  // "ROOF TECH RT-MINI" onto PV-3G ("SYSTEM: …" + "TORQUE TUBE/RAIL — …") on
  // hybrid sets; resolve a real GROUND racking name (or generic ground rack).
  const mountSys    = resolveGroundMountName(
    project as unknown as Record<string, unknown>,
    firstArr?.structureType,
  );
  // Same wind chain as the fence template (Wave 6.2): engineering → canonical
  // site wind (compliance structural) → AHJ → 115 (ASCE minimum; the old 90
  // fallback printed beside a 115-mph FENCE DATA table on hybrid sets).
  const _canonWind = Number((project as unknown as {
    _canonical?: { site?: { windSpeed?: number } };
  })?._canonical?.site?.windSpeed) || 0;
  const windSpeedMph  = engineering.windSpeedMph
    ?? (_canonWind > 0 ? _canonWind : undefined)
    ?? project?.ahjWindSpeedMph
    ?? 115;
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