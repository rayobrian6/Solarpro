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
import { projectStructural } from '../../permit/snapshot/structuralProjection';
// AAC WS-9 — THE site design-load seam (no wind/snow literal in drafting).
import { resolveSiteDesignLoads } from '../../permit/snapshot/siteDesignLoads';
import { projectCodeAuthority } from '../../permit/snapshot/codeAuthorityProjection';
import { getMountingSystemById } from '../../mounting-hardware-db';

// ── ARRAY COLORS (one per array, wraps) ──────────────────────────────────────
const ARRAY_COLORS = [
  '#2255aa', '#1a7a3a', '#8b1a1a', '#7a5500', '#4a1a7a',
  '#006666', '#7a3a00', '#003366', '#5a0033', '#336600',
];
function arrayColor(i: number): string {
  return ARRAY_COLORS[i % ARRAY_COLORS.length];
}

// Speck PLP POWER DRIVE™ groups portrait module rows into 2-high TABLES — engine
// PLP_ROW_COUNT (lib/3d/ground/groundMountRealityEngine.ts): "One I-beam per bay
// at the N-S midpoint" of the TABLE, one tilted strongback per pylon carrying
// BOTH the south and north row. The two rows of a table are adjacent (shared
// strongback); the row-spacing gap is BETWEEN tables, not within one.
// CONSTANTS IMPORTED from the ground reality engine — the drawing must never
// carry its own copies (Ray 2026-07-16: a drifted local copy drew 2 rails
// instead of the engine's 4 and a cantilevered pylon layout the engine
// doesn't build).
import {
  PLP_ROW_COUNT,
  PLP_BAY_SPAN_M,
  PLP_CLAMP_INSET_FRAC,
} from '@/lib/3d/ground/groundMountRealityEngine';
const PLP_ROWS_PER_TABLE = PLP_ROW_COUNT;

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
  // Design Studio ground mounts are Speck PLP POWER DRIVE™ (driven I-beam pylon
  // + strongback + PX rail) — see lib/3d/ground/groundMountRealityEngine.ts.
  const st = String(structureType ?? '').toLowerCase();
  if (st.includes('helical'))  return 'SPECK PLP POWER DRIVE™ (HELICAL)';
  if (st.includes('ballast'))  return 'GROUND-MOUNT STEEL RACKING (BALLASTED)';
  if (st.includes('concrete')) return 'SPECK PLP POWER DRIVE™ (CONCRETE PIER)';
  return 'SPECK PLP POWER DRIVE™ (DRIVEN PYLON)';
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
  // Circuit mode (PV-1BG): color each module by its DC string so the sheet is a
  // real STRING MAP, not a clone of PV-1G's physical layout. `colors` is the
  // palette the STRING LEGEND uses; `strings` is the DC string count.
  circuit?: { strings: number; colors: string[] } | null,
): string {
  const { layout, engineering } = input;
  const _cpGa = projectCodeAuthority(ctx?.snapshot);   // W4 §2 code editions
  // Even, larger-first split of N modules into k strings (row-major) — matches
  // the balancedBranchSizes the circuit legend/schedule use.
  const _balancedSizes = (n: number, k: number): number[] => {
    const base = Math.floor(n / Math.max(k, 1)), rem = n % Math.max(k, 1);
    return Array.from({ length: Math.max(k, 1) }, (_, i) => base + (i < rem ? 1 : 0));
  };

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
      // Lay rows out in 2-high PLP tables: rows WITHIN a table are adjacent
      // (shared strongback, small clamp gap), the row-spacing gap sits BETWEEN
      // tables. The old layout put every row a full row-spacing apart, so a
      // single 2-high table drew as two tables 5 ft apart with a pylon in the
      // middle of each module — the "posts in the middle of a panel" bug.
      const inTablePitch = pHmDefault + 0.04;         // adjacent rows in a table
      const tablePitch   = PLP_ROWS_PER_TABLE * inTablePitch + rowSp;
      const rects: Rect[] = [];
      for (let r = 0; r < rowsN; r++) {
        const ti = Math.floor(r / PLP_ROWS_PER_TABLE);
        const ri = r % PLP_ROWS_PER_TABLE;
        const rowY = oy + ti * tablePitch + ri * inTablePitch;
        for (let c = 0; c < pprN; c++)
          rects.push({ x: ox + c * colSp, y: rowY, w: pWmDefault, h: pHmDefault });
      }
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

    // Property setback boundary (dashed) around the actual array field —
    // CLAMPED to viewport A. Unclamped, a large setback at this scale ran off
    // the band and its dashes bled across viewport B's elevation below
    // (visible on the Stowell sheet, Ray's PV-1G overhaul review).
    const sbPx = setbackFt * scale;
    if (sbPx > 1) {
      const sbX0 = Math.max(offX - sbPx, vpA.x + 4);
      const sbY0 = Math.max(offY - sbPx, vpA.y + 4);
      const sbX1 = Math.min(offX + contentWpx + sbPx, vpA.x + vpA.w - 4);
      const sbY1 = Math.min(offY + contentHpx + sbPx, vpA.y + vpA.h - 4);
      els.push(`<rect x="${sbX0.toFixed(1)}" y="${sbY0.toFixed(1)}" width="${(sbX1 - sbX0).toFixed(1)}" height="${(sbY1 - sbY0).toFixed(1)}" fill="none" class="line-setbk"/>`);
      els.push(drawText(sbX0 + 3, sbY0 - 3,
        `${setbackFt}' SETBACK (TYP.)`, {
          anchor: 'start', fontSize: 6.5, fill: '#cc0000', fontWeight: 'bold',
        }));
    }

    // Circuit mode: assign each module (row-major across all arrays) to a DC
    // string via the balanced split, so the coloring matches the STRING LEGEND.
    const rectString = new Map<Rect, number>();
    if (circuit && circuit.strings > 1) {
      const allRects: Rect[] = arrayRects.flat();
      const sizes = _balancedSizes(allRects.length, circuit.strings);
      let si = 0, used = 0;
      for (const r of allRects) {
        if (used >= (sizes[si] ?? Infinity) && si < sizes.length - 1) { si++; used = 0; }
        rectString.set(r, si);
        used++;
      }
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

      // Modules: framed CAD rectangles — outer FRAME stroke + inset laminate
      // line so each module reads as hardware, not a washed-out grid cell
      // (Ray 2026-07-16 PV-1G overhaul: "flat blue slabs").
      for (const r of rects) {
        const x = toSvgX(r.x), y = toSvgY(r.y);
        const w = Math.max(r.w * metersToFt(1) * scale, 3);
        const h = Math.max(r.h * metersToFt(1) * scale, 2);
        const sIdx = rectString.get(r);
        const mColor = (circuit && sIdx != null) ? circuit.colors[sIdx % circuit.colors.length] : '#2c4a75';
        const mFill  = (circuit && sIdx != null) ? mColor : '#dbe7f6';
        const mFillOp = (circuit && sIdx != null) ? '0.20' : '1';
        els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${mFill}" fill-opacity="${mFillOp}" stroke="${mColor}" stroke-width="1.2"/>`);
        if (w > 8 && h > 8) {
          // laminate inset (module frame)
          els.push(`<rect x="${(x + 1.6).toFixed(1)}" y="${(y + 1.6).toFixed(1)}" width="${(w - 3.2).toFixed(1)}" height="${(h - 3.2).toFixed(1)}" fill="none" stroke="${mColor}" stroke-width="0.4" opacity="0.65"/>`);
        }
        if (h > 6) {
          els.push(`<line x1="${x.toFixed(1)}" y1="${(y + h / 2).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + h / 2).toFixed(1)}" stroke="${mColor}" stroke-width="0.35" opacity="0.5"/>`);
        }
        // Circuit mode: stamp the string tag (S1/S2…) on each module.
        if (circuit && sIdx != null && h > 7 && w > 10) {
          els.push(drawText(x + w / 2, y + h / 2 + 2.2, `S${sIdx + 1}`, {
            anchor: 'middle', fontSize: 6, fill: mColor, fontWeight: 'bold',
          }));
        }
      }

      // ── Speck PLP POWER DRIVE™ structure — drawn from the SAME constants and
      // formulas as the Design Studio ground reality engine (imported, never
      // copied — Ray 2026-07-16: "reference design", the copied version drew
      // 2 rails instead of 4 and invented a cantilevered 2-pylon layout).
      //   rails:  2 per portrait row × PLP_ROW_COUNT rows (engine railDefs)
      //   pylons: nPylons = max(2, ceil(rowSpan / PLP_BAY_SPAN_M) + 1),
      //           evenly spaced EDGE TO EDGE (engine frac = i/(n−1))
      const tableGroups: Rect[][] = [];
      for (let ti = 0; ti < rowBands.length; ti += PLP_ROWS_PER_TABLE)
        tableGroups.push(rowBands.slice(ti, ti + PLP_ROWS_PER_TABLE).flat());
      tableGroups.forEach((band) => {
        let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
        for (const r of band) {
          bMinX = Math.min(bMinX, r.x);  bMaxX = Math.max(bMaxX, r.x + r.w);
          bMinY = Math.min(bMinY, r.y);  bMaxY = Math.max(bMaxY, r.y + r.h);
        }
        const wM = bMaxX - bMinX, depthM = bMaxY - bMinY;
        const cyM = (bMinY + bMaxY) / 2;                    // table N-S midpoint (pylon line = row seam)
        // Pylons per the ENGINE formula: edge-to-edge, no invented cantilever.
        const nPylons = Math.max(2, Math.ceil(wM / PLP_BAY_SPAN_M) + 1);
        const pylonXs: number[] = [];
        for (let i = 0; i < nPylons; i++)
          pylonXs.push(bMinX + (wM * i) / Math.max(nPylons - 1, 1));
        const baySpanM = wM / Math.max(nPylons - 1, 1);
        // PX rails per the ENGINE railDefs: 2 per portrait row (15%/85% clamp
        // insets of EACH row's span) = 4 lines on a 2-high table.
        const railYs: number[] = [];
        const rowDepthM = depthM / PLP_ROWS_PER_TABLE;
        for (let ri = 0; ri < PLP_ROWS_PER_TABLE; ri++) {
          const rowY0 = bMinY + ri * rowDepthM;
          railYs.push(rowY0 + rowDepthM * PLP_CLAMP_INSET_FRAC);
          railYs.push(rowY0 + rowDepthM * (1 - PLP_CLAMP_INSET_FRAC));
        }
        for (const ryM of railYs) {
          const ry = toSvgY(ryM);
          // PX rails: heavy double line so structure reads over module strokes
          els.push(`<line x1="${toSvgX(bMinX).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${toSvgX(bMaxX).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="#39445c" stroke-width="1.7"/>`);
          els.push(`<line x1="${toSvgX(bMinX).toFixed(1)}" y1="${(ry + 1.4).toFixed(1)}" x2="${toSvgX(bMaxX).toFixed(1)}" y2="${(ry + 1.4).toFixed(1)}" stroke="#39445c" stroke-width="0.5"/>`);
        }
        // Strongback (tilted N-S beam) on each pylon — spans the table depth.
        const cy = toSvgY(cyM);
        for (const xm of pylonXs) {
          const px = toSvgX(xm);
          els.push(`<line x1="${px.toFixed(1)}" y1="${toSvgY(bMinY).toFixed(1)}" x2="${px.toFixed(1)}" y2="${toSvgY(bMaxY).toFixed(1)}" stroke="#2c3444" stroke-width="1.8"/>`);
          // Driven I-beam pylon (plan: W-section) at the N-S midpoint — drawn
          // big enough to SEE (the 4px marker vanished at sheet scale).
          const pw = 8.0, ph = 5.2;
          els.push(`<rect x="${(px - pw / 2).toFixed(1)}" y="${(cy - ph / 2).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
          els.push(`<rect x="${(px - pw / 2).toFixed(1)}" y="${(cy - ph / 2).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="url(#hatch-steel)"/>`);
          // web line across the section so it reads as an I-beam, not a dot
          els.push(`<line x1="${(px - pw / 2).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(px + pw / 2).toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#111" stroke-width="0.7"/>`);
        }
        // One label per table (northern edge).
        els.push(drawText(toSvgX(pylonXs[Math.floor(pylonXs.length / 2)]), toSvgY(bMinY) - 4,
          `${nPylons} PLP PYLONS @ ${ftToFtIn(baySpanM * 3.28084)} O.C. · ${railYs.length} PX RAILS`, {
            anchor: 'middle', fontSize: 6, fill: '#44506a', fontWeight: 'bold',
          }));
        // Pylon BAY dimension string (first→last pylon, with count), below the
        // table — the O.C. figure gets real dimension geometry, not just text.
        if (pylonXs.length >= 2) {
          const d1 = toSvgX(pylonXs[0]), d2 = toSvgX(pylonXs[pylonXs.length - 1]);
          const dy = toSvgY(bMaxY) + 9;
          els.push(`<line x1="${d1.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${d2.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#44506a" stroke-width="0.7"/>`);
          for (const dx of pylonXs.map(toSvgX)) {
            els.push(`<line x1="${dx.toFixed(1)}" y1="${(dy - 3.5).toFixed(1)}" x2="${dx.toFixed(1)}" y2="${(dy + 3.5).toFixed(1)}" stroke="#44506a" stroke-width="0.7"/>`);
          }
          els.push(drawText((d1 + d2) / 2, dy + 8, `${nPylons - 1} BAY${nPylons > 2 ? 'S' : ''} @ ${ftToFtIn(baySpanM * 3.28084)}`, {
            anchor: 'middle', fontSize: 6, fill: '#44506a', fontWeight: 'bold',
          }));
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
    els.push(drawScaleBar(vpA.x + 8, vpA.y + vpA.h - 10,
      Math.max(Math.round(20 * scale), 40), '', { totalFt: 20 }));
  }

  // ── Lower split: B (side elevation) + C (pile section) fill the LEFT column,
  //    a GROUND MOUNT NOTES panel fills the RIGHT — together they span the full
  //    width below the plan so no quadrant of the sheet reads empty. ──
  const leftW  = Math.round(dz.width * 0.62);
  const rightX = dz.x + leftW + 14;
  const rightW = dz.x + dz.width - rightX;
  const panelTop = vy;

  // ── Viewport B: ARRAY SIDE ELEVATION — PLP TABLE ────────────────────────────
  vpHeader(dz.x, vy, leftW, 'B · ARRAY SIDE ELEVATION — PLP TABLE'); vy += VP_HDR;
  const vpB = { x: dz.x, y: vy, w: leftW, h: hB }; vy += hB + VP_GAP;
  {
    const a0: any = arrays[0] ?? {};
    const rowCount  = Math.max(1, a0.rowCount ?? a0.dimensions?.rowCount ?? 2);
    const nTables   = Math.max(1, Math.ceil(rowCount / PLP_ROWS_PER_TABLE));
    const spacingFt = (a0.rowSpacingM ?? 1.6) * metersToFt(1);
    const tilt      = a0.tiltDeg ?? 25;
    const clearFt   = (a0.groundClearanceM ?? 0.46) * metersToFt(1);
    const showTables = Math.min(nTables, 3);
    const mL = 58, mR = 28;
    const baseY = vpB.y + vpB.h * 0.66;
    const avail   = vpB.w - mL - mR;
    const pitchPx = avail / Math.max(showTables, 2);
    // modLen = one module along the tilt; a PLP table stacks PLP_ROWS_PER_TABLE.
    const modLen  = Math.min((pitchPx * 0.8) / PLP_ROWS_PER_TABLE, vpB.h * 0.30, 70);
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
    // Speck PLP single-pylon-per-table cross-section (single_strut_cantilever):
    // ONE driven I-beam pylon carries a tilted STRONGBACK that pivots on the
    // pylon top and cantilevers north; a diagonal STRUT braces the strongback
    // back to ~35% of the pylon height. The module (edge view) rides the
    // strongback. NOT a front/rear A-frame. Pylon continues below grade (dashed).
    const STRUT_FRAC = 0.35;   // engine PLP_STRUT_FRAC — strut attach on pylon body
    const nRows = PLP_ROWS_PER_TABLE;                   // portrait rows carried per table
    const tableRun = nRows * run, tableRise = nRows * rise;   // strongback slant span
    // Center the table group; reserve the right third for callout leaders when
    // only ONE table renders (the single-table case previously left a bare
    // ground line and a stick figure — Ray 2026-07-16 PV-1G overhaul).
    const contentW = (showTables - 1) * pitchPx + tableRun;
    const xStart   = vpB.x + mL + Math.max(0, (avail - contentW) * (showTables === 1 ? 0.30 : 0.5));
    let _annot: { pylonX: number; pylonTopY: number; strutMidX: number; strutMidY: number; sbMidX: number; sbMidY: number; knX: number; knY: number; railPts: Array<[number, number]>; topX: number; topY: number } | null = null;
    for (let t = 0; t < showTables; t++) {
      const bx = xStart + t * pitchPx, by = baseY - clrPx;   // south (low) end of strongback
      // ONE pylon per table at the array CENTER OF GRAVITY (strongback midpoint) —
      // symmetric cantilever, matching the reality engine. The diagonal strut
      // braces the south cantilever; pylon+strut+strongback = the PLP "4" profile.
      const pylonX = bx + tableRun * 0.5;
      const pylonTopY = by - tableRise * 0.5;
      els.push(`<line x1="${pylonX.toFixed(1)}" y1="${pylonTopY.toFixed(1)}" x2="${pylonX.toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#111" stroke-width="3"/>`);
      // I-beam flange edges (twin lines) so the post reads as a W-section, not a pipe.
      els.push(`<line x1="${(pylonX-2.2).toFixed(1)}" y1="${pylonTopY.toFixed(1)}" x2="${(pylonX-2.2).toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#111" stroke-width="0.6"/>`);
      els.push(`<line x1="${(pylonX+2.2).toFixed(1)}" y1="${pylonTopY.toFixed(1)}" x2="${(pylonX+2.2).toFixed(1)}" y2="${baseY.toFixed(1)}" stroke="#111" stroke-width="0.6"/>`);
      els.push(`<line x1="${pylonX.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${pylonX.toFixed(1)}" y2="${pileBotY.toFixed(1)}" stroke="#111" stroke-width="1.8" stroke-dasharray="3,2"/>`);
      // KNUCKLE: tilt bracket clamping the strongback to the pylon top (slotted).
      els.push(`<rect x="${(pylonX-4).toFixed(1)}" y="${(pylonTopY-2.6).toFixed(1)}" width="8" height="5.2" fill="#2c3444" stroke="#111" stroke-width="0.7" rx="1"/>`);
      // Diagonal strut: pylon body (~35% up) → strongback south end.
      const strutBaseY = baseY - (baseY - pylonTopY) * STRUT_FRAC;
      els.push(`<line x1="${pylonX.toFixed(1)}" y1="${strutBaseY.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#44506a" stroke-width="1.8"/>`);
      // Strongback beam (full slant), then each module (edge view) riding it.
      els.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(bx + tableRun).toFixed(1)}" y2="${(by - tableRise).toFixed(1)}" stroke="#44506a" stroke-width="2.6"/>`);
      for (let m = 0; m < nRows; m++) {
        const a = m + 0.03, b = m + 0.97;                 // small seam gap between stacked modules
        els.push(`<line x1="${(bx + run * a).toFixed(1)}" y1="${(by - rise * a).toFixed(1)}" x2="${(bx + run * b).toFixed(1)}" y2="${(by - rise * b).toFixed(1)}" stroke="#1a4a8a" stroke-width="5.5" stroke-linecap="butt"/>`);
        // module frame edge (thin light line above the laminate stroke)
        els.push(`<line x1="${(bx + run * a).toFixed(1)}" y1="${(by - rise * a - 3.2).toFixed(1)}" x2="${(bx + run * b).toFixed(1)}" y2="${(by - rise * b - 3.2).toFixed(1)}" stroke="#7fa4d4" stroke-width="0.8"/>`);
      }
      // PX rail cross-sections: rails run E-W, so in this N-S section they are
      // POINTS on the strongback — TWO PER PORTRAIT ROW at the engine's clamp
      // insets (railDefs: 15%/85% of EACH row's span) = 4 on a 2-high table.
      // (Ray 2026-07-16: the drawing showed 2 — "missing a rail per row".)
      const railPts: Array<[number, number]> = [];
      for (let ri = 0; ri < nRows; ri++) {
        for (const rf of [PLP_CLAMP_INSET_FRAC, 1 - PLP_CLAMP_INSET_FRAC]) {
          const f = (ri + rf) / nRows;
          railPts.push([bx + tableRun * f, by - tableRise * f] as [number, number]);
        }
      }
      for (const [rx, ry2] of railPts) {
        els.push(`<circle cx="${rx.toFixed(1)}" cy="${(ry2 + 3.4).toFixed(1)}" r="2.6" fill="#fff" stroke="#39445c" stroke-width="1.3"/>`);
        els.push(`<circle cx="${rx.toFixed(1)}" cy="${(ry2 + 3.4).toFixed(1)}" r="0.9" fill="#39445c"/>`);
      }
      if (t === 0) {
        _annot = {
          pylonX, pylonTopY,
          strutMidX: (pylonX + bx) / 2, strutMidY: (strutBaseY + by) / 2,
          sbMidX: bx + tableRun * 0.62, sbMidY: by - tableRise * 0.62,
          knX: pylonX, knY: pylonTopY - 2.6,
          railPts,
          topX: bx + tableRun, topY: by - tableRise,
        };
      }
    }
    // O.C. dimension only when there are ≥2 tables to space (row-spacing gap is
    // BETWEEN tables). A single 2-high table has no inter-row-spacing dimension.
    if (showTables >= 2) {
      const dx1 = xStart, dx2 = xStart + pitchPx, dy = pileBotY + 12;
      els.push(`<line x1="${dx1.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${dx2.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#c00" stroke-width="0.9"/>`);
      els.push(`<line x1="${dx1.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${dx1.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>`);
      els.push(`<line x1="${dx2.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${dx2.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#c00" stroke-width="0.8"/>`);
      els.push(drawText((dx1 + dx2) / 2, dy - 3, `${spacingFt.toFixed(1)}' O.C. (TABLE)`, {
        anchor: 'middle', fontSize: 7, fontWeight: 'bold', fill: '#c00' }));
    }
    // ── Component callouts with leaders (single-table case has the room) ──
    if (_annot) {
      const A = _annot;
      const lead = (x1: number, y1: number, x2: number, y2: number) => {
        els.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
        els.push(`<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="1.2" fill="#333"/>`);
      };
      const cX = Math.min(A.topX + 46, vpB.x + vpB.w - 150);   // callout text column
      let cY = vpB.y + 14;
      const co = (px: number, py: number, label: string, sub: string) => {
        lead(px, py, cX - 4, cY + 2);
        els.push(drawText(cX, cY + 2, label, { anchor: 'start', fontSize: 6.6, fontWeight: 'bold', fill: '#1a2332' }));
        if (sub) els.push(drawText(cX, cY + 9.5, sub, { anchor: 'start', fontSize: 5.6, fill: '#555' }));
        cY += 22;
      };
      co(A.knX, A.knY, 'TILT KNUCKLE', `slotted bracket — ${Math.round(tilt)}° set`);
      co(A.sbMidX, A.sbMidY - 4, 'STRONGBACK (N-S)', 'PLP POWER DRIVE™ — HDG steel');
      co(A.railPts[A.railPts.length - 1][0], A.railPts[A.railPts.length - 1][1] + 4,
        `PX RAIL ×${A.railPts.length} (CONT. E-W)`, '2 per row — 14′ sections, spliced');
      co(A.strutMidX, A.strutMidY, 'DIAGONAL STRUT', 'braces south cantilever');
      co(A.pylonX + 2, (A.pylonTopY + baseY) / 2 + 8, 'DRIVEN I-BEAM PYLON', 'W6 HDG — see section C');
      // Height + clearance dimensions (left of the table)
      const dimX = xStart - 16;
      els.push(`<line x1="${dimX.toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${dimX.toFixed(1)}" y2="${(baseY - clrPx - tableRise).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
      for (const yy of [baseY, baseY - clrPx, baseY - clrPx - tableRise]) {
        els.push(`<line x1="${(dimX - 3).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${(dimX + 3).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
      }
      els.push(drawText(dimX - 4, baseY - clrPx / 2 + 2, `${clearFt.toFixed(1)}' CLR`, {
        anchor: 'end', fontSize: 6.4, fill: '#333' }));
      // Top-of-table height from PLAN geometry: CAD panel heightM is the
      // plan-PROJECTED N-S extent, so rise = plan depth × tan(tilt) (slope
      // length × sin ≡ plan × tan). The old 1.73 m slope default printed
      // "9.3' TOP" on a table that stands ~11.5' (Ray 2026-07-16: "a typical
      // PLP ground mount is going to be somewhere around 10 to 12 feet").
      const _rowPlanM = Number((a0._cadPanels?.[0]?.heightM)) || Number(a0.rows?.[0]?.panels?.[0]?.heightM) || 1.74;
      const topFt = clearFt + nRows * _rowPlanM * metersToFt(1) * Math.tan(tilt * Math.PI / 180);
      els.push(drawText(dimX - 4, baseY - clrPx - tableRise / 2, `${topFt.toFixed(1)}' TOP`, {
        anchor: 'end', fontSize: 6.4, fill: '#333' }));
      // Tilt arc at the south (low) end
      const arcR = 22;
      els.push(`<path d="M ${(xStart + arcR).toFixed(1)} ${(baseY - clrPx).toFixed(1)} A ${arcR} ${arcR} 0 0 0 ${(xStart + arcR * Math.cos(tilt * Math.PI / 180)).toFixed(1)} ${(baseY - clrPx - arcR * Math.sin(tilt * Math.PI / 180)).toFixed(1)}" fill="none" stroke="#1a4a8a" stroke-width="0.8"/>`);
      els.push(drawText(xStart + arcR + 4, baseY - clrPx - 6, `${Math.round(tilt)}°`, {
        anchor: 'start', fontSize: 8, fontWeight: 'bold', fill: '#1a4a8a' }));

      // (Solstice sun/shadow overlay REMOVED — Ray 2026-07-16: "wtf is the
      // sun about". Inter-row shading stays a NOTE; the drawing shows the
      // structure, not an astronomy lesson.)
    }
  }

  // ── Viewport C: TYPICAL PILE FOUNDATION SECTION ─────────────────────────────
  vpHeader(dz.x, vy, leftW, 'C · TYPICAL PILE FOUNDATION SECTION'); vy += VP_HDR;
  const vpC = { x: dz.x, y: vy, w: leftW, h: hC };
  {
    // A true PILE section — W6 I-beam profile driven through soil strata, with
    // a plan-view W6 cross-section detail beside it. The old viewport was the
    // side elevation AGAIN with a fatter post (Ray 2026-07-16: B/C read as
    // duplicates — the same dead-space disease PV-3F had).
    const a0: any = arrays[0] ?? {};
    const embedFt = Math.max((a0.pileDepthM ?? 1.5) * metersToFt(1), 5);
    const clearFt = (a0.groundClearanceM ?? 0.46) * metersToFt(1);
    const cx      = vpC.x + vpC.w * 0.30;
    const grade   = vpC.y + vpC.h * 0.30;
    const botPad  = 24;
    const ftPx    = (vpC.y + vpC.h - botPad - grade) / Math.max(embedFt, 1);
    const pileBot = grade + embedFt * ftPx;
    const pileTop = grade - Math.min(vpC.h * 0.20, clearFt * ftPx + 18);

    // Soil strata: three hatched bands below grade (topsoil / subsoil / native)
    const strata = [
      { f0: 0, f1: 0.22, fill: '#f0e2c8', label: 'TOPSOIL' },
      { f0: 0.22, f1: 0.58, fill: '#e6d2ae', label: 'SUBSOIL' },
      { f0: 0.58, f1: 1.0, fill: '#dcc79c', label: 'NATIVE — DRIVE TO REFUSAL' },
    ];
    const sX0 = vpC.x + 18, sX1 = vpC.x + vpC.w * 0.58;
    for (const s of strata) {
      const y0 = grade + (pileBot - grade) * s.f0, y1 = grade + (pileBot - grade) * s.f1;
      els.push(`<rect x="${sX0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(sX1 - sX0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" fill="${s.fill}" opacity="0.55"/>`);
      // ANSI earth-hatch ticks over each band — same soil language as PV-3G's
      // grade treatment (item 4 consistency: one material vocabulary everywhere).
      for (let hx = sX0 + 6; hx < sX1 - 4; hx += 13) {
        const hy = y0 + ((hx * 7) % Math.max(y1 - y0 - 8, 4));
        els.push(`<line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${(hx - 5).toFixed(1)}" y2="${(hy + 5).toFixed(1)}" stroke="#8a7040" stroke-width="0.45" opacity="0.6"/>`);
      }
      els.push(drawText(sX0 + 4, (y0 + y1) / 2 + 2, s.label, { anchor: 'start', fontSize: 5.4, fill: '#7a6a4a' }));
      // strata boundary line
      els.push(`<line x1="${sX0.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${sX1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#a08850" stroke-width="0.4" stroke-dasharray="6,3"/>`);
    }
    // Grade line + hatch ticks
    els.push(`<line x1="${sX0.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${sX1.toFixed(1)}" y2="${grade.toFixed(1)}" stroke="#6b4a2a" stroke-width="2"/>`);
    for (let i = 0; i < 14; i++) {
      const gx = sX0 + 4 + i * ((sX1 - sX0 - 8) / 14);
      els.push(`<line x1="${gx.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(gx - 5).toFixed(1)}" y2="${(grade + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.6"/>`);
    }
    els.push(drawText(sX1 - 4, grade - 4, 'GRADE', { anchor: 'end', fontSize: 6, fill: '#6b4a2a', fontWeight: 'bold' }));

    // W6 pylon (front view): web + flange edge lines, solid above grade,
    // dashed below; knuckle stub at the head ties back to section B.
    const pw = 9;
    els.push(`<rect x="${(cx - pw / 2).toFixed(1)}" y="${pileTop.toFixed(1)}" width="${pw}" height="${(grade - pileTop).toFixed(1)}" fill="#b8bec9" stroke="#111" stroke-width="1.2"/>`);
    els.push(`<rect x="${(cx - pw / 2).toFixed(1)}" y="${grade.toFixed(1)}" width="${pw}" height="${(pileBot - grade).toFixed(1)}" fill="#9aa2b0" stroke="#111" stroke-width="1.2" stroke-dasharray="4,2"/>`);
    for (const fx of [cx - pw / 2 + 1.8, cx + pw / 2 - 1.8]) {
      els.push(`<line x1="${fx.toFixed(1)}" y1="${pileTop.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${pileBot.toFixed(1)}" stroke="#111" stroke-width="0.5" opacity="0.7"/>`);
    }
    els.push(`<rect x="${(cx - 6).toFixed(1)}" y="${(pileTop - 4).toFixed(1)}" width="12" height="5" fill="#2c3444" stroke="#111" stroke-width="0.7" rx="1"/>`);
    els.push(drawText(cx + 10, pileTop - 5, 'KNUCKLE — SEE B', { anchor: 'start', fontSize: 5.6, fill: '#555' }));

    // Embed + clearance dimensions
    const dimX = cx + pw / 2 + 14;
    els.push(`<line x1="${dimX.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${dimX.toFixed(1)}" y2="${pileBot.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    for (const yy of [grade, pileBot]) {
      els.push(`<line x1="${(dimX - 3.5).toFixed(1)}" y1="${yy.toFixed(1)}" x2="${(dimX + 3.5).toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    }
    els.push(drawText(dimX + 5, (grade + pileBot) / 2, `${embedFt.toFixed(1)}' EMBED (MIN) — FIELD-VERIFY REFUSAL`, {
      anchor: 'start', fontSize: 6.8, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(cx - pw / 2 - 5, (pileTop + grade) / 2 + 2, `${clearFt.toFixed(1)}' CLR`, {
      anchor: 'end', fontSize: 6.4, fill: '#333' }));

    // ── W6 CROSS-SECTION detail (circle inset, right side): true I-profile ──
    const dcx = vpC.x + vpC.w * 0.78, dcy = vpC.y + vpC.h * 0.44, dr = Math.min(vpC.h * 0.30, 46);
    els.push(`<circle cx="${dcx.toFixed(1)}" cy="${dcy.toFixed(1)}" r="${dr.toFixed(1)}" fill="#fff" stroke="#111" stroke-width="1"/>`);
    const fw = dr * 1.0, fh = dr * 0.16, webW = dr * 0.14, webH = dr * 1.05;
    els.push(`<rect x="${(dcx - fw / 2).toFixed(1)}" y="${(dcy - webH / 2 - fh).toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" fill="#8a92a2" stroke="#111" stroke-width="0.8"/>`);
    els.push(`<rect x="${(dcx - fw / 2).toFixed(1)}" y="${(dcy + webH / 2).toFixed(1)}" width="${fw.toFixed(1)}" height="${fh.toFixed(1)}" fill="#8a92a2" stroke="#111" stroke-width="0.8"/>`);
    els.push(`<rect x="${(dcx - webW / 2).toFixed(1)}" y="${(dcy - webH / 2).toFixed(1)}" width="${webW.toFixed(1)}" height="${webH.toFixed(1)}" fill="#8a92a2" stroke="#111" stroke-width="0.8"/>`);
    els.push(drawText(dcx, dcy + dr + 10, 'W6 HDG I-BEAM — SECTION', { anchor: 'middle', fontSize: 6.2, fontWeight: 'bold', fill: '#1a2332' }));
    els.push(drawText(dcx, dcy + dr + 18, 'PLP POWER DRIVE™ PYLON', { anchor: 'middle', fontSize: 5.6, fill: '#555' }));
    // section cut reference: tie the detail to the pile with a leader
    els.push(`<line x1="${(cx + pw / 2).toFixed(1)}" y1="${((grade + pileBot) / 2).toFixed(1)}" x2="${(dcx - dr).toFixed(1)}" y2="${dcy.toFixed(1)}" stroke="#888" stroke-width="0.5" stroke-dasharray="3,2"/>`);

    els.push(drawText(vpC.x + vpC.w / 2, pileBot + 14,
      'DRIVEN STEEL PYLON — NO CONCRETE — FIELD VERIFY REFUSAL DEPTH PER GEOTECH', {
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
    {
      // A utility-rate box is out of place on a ground SITE PLAN and rendered as
      // a mostly-blank box (just the utility name) — the dead white Ray flagged.
      // Fill the lower panel with a DESIGN CRITERIA block instead (legit CAD
      // furniture: the geometry + code basis this sheet is drawn to).
      const _tilt = Math.round(arrays[0]?.tiltDeg ?? 20);
      const _az   = Math.round(arrays[0]?.azimuth ?? 180);
      const _rs   = ((arrays[0]?.rowSpacingM ?? 1.6) * metersToFt(1)).toFixed(1);
      let cy = ny + 10;
      els.push(drawRectFilled(rightX, cy, rightW, 13, '#1a2332', '#1a2332', 0));
      els.push(drawText(rightX + 7, cy + 9, 'DESIGN CRITERIA', {
        anchor: 'start', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));
      cy += 15;
      const crit: Array<[string, string]> = [
        ['Structure', 'Driven steel pile — no concrete'],
        ['Modules', `${totalPanels} @ ${(dcKw / Math.max(1, totalPanels) * 1000).toFixed(0)}W`],
        ['Tilt / Azimuth', `${_tilt}° / ${_az}°`],
        ['Row spacing', `${_rs}' O.C.`],
        ['Ground clearance', `${Math.round(((arrays[0]?.groundClearanceM ?? 0.46) * 39.3701))}" min. below lowest module`],
        ['Pile embedment', `5' min. — field-verify refusal`],
        ['Property setback', `${setbackFt}' min. from line`],
        ['Bonding', 'All metalwork to EGC — NEC 690.43'],
        ['Structural loads', `See PV-3 (${_cpGa.asceLabel} / ${_cpGa.ibcLabel})`],
        ['Codes', `NEC 690 · IBC 1809 · ${_cpGa.asceLabel}`],
      ];
      crit.forEach(([k, v], i) => {
        const ry = cy + i * 13;
        if (i % 2 === 1) els.push(drawRectFilled(rightX + 1, ry - 2, rightW - 2, 13, '#f0f3fa', '#f0f3fa', 0));
        els.push(drawText(rightX + 6, ry + 7, k, { anchor: 'start', fontSize: 6.2, fill: '#555' }));
        els.push(drawText(rightX + rightW - 6, ry + 7, v, { anchor: 'end', fontSize: 6.2, fill: '#1a2332', fontWeight: 'bold' }));
      });
      // ── PLP COMPONENT KEY — fills the dead band under DESIGN CRITERIA with
      // the glyph → name map for the structure drawn in A/B/C. ──
      let ky = cy + crit.length * 13 + 10;
      const keyBottom = dz.y + dz.height - 6;
      if (keyBottom - ky > 60) {
        els.push(drawRectFilled(rightX, ky, rightW, 13, '#1a2332', '#1a2332', 0));
        els.push(drawText(rightX + 7, ky + 9, 'PLP POWER DRIVE™ COMPONENT KEY', {
          anchor: 'start', fontSize: 7, fontWeight: '900', fill: '#fff' }));
        ky += 19;
        const keyRows: Array<[string, string, string]> = [
          [`<rect x="0" y="-3" width="14" height="6" fill="#b8bec9" stroke="#111" stroke-width="0.8"/><line x1="2" y1="-3" x2="2" y2="3" stroke="#111" stroke-width="0.4"/><line x1="12" y1="-3" x2="12" y2="3" stroke="#111" stroke-width="0.4"/>`,
            'DRIVEN I-BEAM PYLON', 'W6 HDG steel — 1 per bay'],
          [`<line x1="0" y1="2" x2="14" y2="-3" stroke="#44506a" stroke-width="2.4"/>`,
            'STRONGBACK', 'tilted N-S beam on pylon'],
          [`<line x1="0" y1="0" x2="14" y2="0" stroke="#39445c" stroke-width="2"/><line x1="0" y1="1.6" x2="14" y2="1.6" stroke="#39445c" stroke-width="0.5"/>`,
            'PX RAIL — 2 PER ROW (CONT. E-W)', '4 per 2-high table · 14′ + splices'],
          [`<rect x="3" y="-2.6" width="8" height="5.2" fill="#2c3444" stroke="#111" stroke-width="0.6" rx="1"/>`,
            'TILT KNUCKLE', 'slotted tilt-set bracket'],
          [`<line x1="1" y1="3" x2="12" y2="-3" stroke="#44506a" stroke-width="1.4"/>`,
            'DIAGONAL STRUT', 'braces south cantilever'],
        ];
        for (const [glyph, name, sub] of keyRows) {
          if (ky + 18 > keyBottom) break;
          els.push(`<g transform="translate(${rightX + 8},${ky + 6})">${glyph}</g>`);
          els.push(drawText(rightX + 28, ky + 5, name, { anchor: 'start', fontSize: 6.2, fontWeight: 'bold', fill: '#1a2332' }));
          els.push(drawText(rightX + 28, ky + 12.5, sub, { anchor: 'start', fontSize: 5.4, fill: '#666' }));
          ky += 19;
        }
      }
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
  const _cpGs = projectCodeAuthority(ctx?.snapshot);   // W4 §2 code editions

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
  // AAC WS-9 — ONE seam for both values, with an explicit basis.
  const _siteLoads    = resolveSiteDesignLoads({
    snapshot: ctx?.snapshot ?? null,
    complianceWindMph: engineering.windSpeedMph ?? (_canonWind > 0 ? _canonWind : undefined),
    complianceSnowPsf: engineering.groundSnowPsf,
    ahjWindMph: project?.ahjWindSpeedMph, ahjSnowPsf: project?.ahjGroundSnowPsf,
  });
  // BRAIDON PDF AUDIT 2026-08-27 (N11) — drawing annotations only; take the resolver's shared
  // display rounding so a ground set can never print 107.533 MPH beside PV-4C's 108 mph.
  const windSpeedMph  = Math.round(_siteLoads.windSpeedMph);
  const groundSnowPsf = Number(_siteLoads.groundSnowPsf.toFixed(1));

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
    'GROUND MOUNT — PLP PYLON ELEVATION + STRUCTURAL DETAIL',
    'SCALE: 1/2"=1\'-0"'));

  const dz   = zones.draw;
  // ═══ Speck PLP POWER DRIVE™ structural cross-section ═══════════════════════
  // Matches the Design Studio ground reality engine (single_strut_cantilever):
  // ONE driven I-beam PYLON per bay carries a tilted STRONGBACK (portrait rows)
  // that cantilevers north, braced by ONE diagonal STRUT; PX rails clamp the
  // module. Real mechanical assembly — not a generic multi-pile row.
  const tiltRad  = tiltDeg * Math.PI / 180;
  const sbRows   = Math.max(1, Math.min(firstArr.rowCount ?? firstArr.dimensions?.rowCount ?? 2, 2));
  const embedFt  = pileDepthFt;
  const pileAboveFt = gcFt + 2.2;                              // grade → strongback pivot
  const sbLenFt  = panelLenFt * sbRows + 0.4 * (sbRows - 1);   // strongback slant length
  const totalVFt = embedFt + pileAboveFt + Math.sin(tiltRad) * sbLenFt + 2;
  const runFt    = Math.cos(tiltRad) * sbLenFt;
  const FT_PX = Math.max(6, Math.min(
    (dz.height * 0.82) / Math.max(totalVFt, 6),
    (dz.width * 0.52) / Math.max(runFt + 6, 6), 30));

  const groundY = dz.y + dz.height * 0.46;
  const originX = dz.x + dz.width * 0.34;                      // pylon X

  // ── Grade line + earth hatch (ANSI) ──
  const _gradeX2 = dz.x + dz.width * 0.62;
  els.push(`<rect x="${dz.x}" y="${groundY.toFixed(1)}" width="${(_gradeX2 - dz.x).toFixed(1)}" height="14" fill="url(#hatch-earth)"/>`);
  els.push(`<line x1="${dz.x}" y1="${groundY.toFixed(1)}" x2="${_gradeX2.toFixed(1)}" y2="${groundY.toFixed(1)}" stroke="#111" stroke-width="1.6"/>`);
  for (let hx = dz.x + 4; hx < _gradeX2; hx += 11) {
    els.push(`<line x1="${hx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(hx - 6).toFixed(1)}" y2="${(groundY + 6).toFixed(1)}" stroke="#111" stroke-width="0.6"/>`);
  }
  els.push(drawText(_gradeX2 + 4, groundY + 3, 'GRADE', { anchor: 'start', fontSize: 7, fill: '#111', fontWeight: 'bold' }));

  // ── Driven I-beam PYLON (above grade + embed) ──
  const pylonTopY = groundY - pileAboveFt * FT_PX;
  const embedBotY = groundY + embedFt * FT_PX;
  const pylW = Math.max(FT_PX * 0.40, 9);
  els.push(`<rect x="${(originX - pylW/2).toFixed(1)}" y="${pylonTopY.toFixed(1)}" width="${pylW.toFixed(1)}" height="${(groundY - pylonTopY).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.3"/>`);
  els.push(`<rect x="${(originX - pylW/2).toFixed(1)}" y="${pylonTopY.toFixed(1)}" width="${pylW.toFixed(1)}" height="${(groundY - pylonTopY).toFixed(1)}" fill="url(#hatch-steel)"/>`);
  els.push(`<line x1="${originX.toFixed(1)}" y1="${pylonTopY.toFixed(1)}" x2="${originX.toFixed(1)}" y2="${embedBotY.toFixed(1)}" stroke="#111" stroke-width="0.5"/>`);   // I-beam web
  // Embed (dashed hidden line) + driven tip
  els.push(`<rect x="${(originX - pylW/2).toFixed(1)}" y="${groundY.toFixed(1)}" width="${pylW.toFixed(1)}" height="${(embedBotY - groundY).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="0.9" stroke-dasharray="5,2"/>`);
  els.push(`<polygon points="${(originX - pylW/2).toFixed(1)},${embedBotY.toFixed(1)} ${originX.toFixed(1)},${(embedBotY + FT_PX*0.5).toFixed(1)} ${(originX + pylW/2).toFixed(1)},${embedBotY.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="0.9" stroke-dasharray="5,2"/>`);

  // ── Strongback (tilted) — pivots on the pylon top at the array CENTER OF
  //    GRAVITY. Per the reality engine, the pylon rises to the strongback
  //    centerline (sbCenterZ = panel N-S midpoint), so the strongback cantilevers
  //    SYMMETRICALLY south and north (½ each way) — NOT 35/65 with the weight
  //    hung off the north end. The diagonal strut braces the south cantilever;
  //    pylon + strut + strongback read as the PLP "number 4" profile. ──
  const sdx = Math.cos(tiltRad), sdy = -Math.sin(tiltRad);   // south→north (up-right)
  const L = sbLenFt * FT_PX;
  const southX = originX - sdx * L * 0.5, southY = pylonTopY - sdy * L * 0.5;
  const northX = originX + sdx * L * 0.5, northY = pylonTopY + sdy * L * 0.5;
  els.push(`<line x1="${southX.toFixed(1)}" y1="${southY.toFixed(1)}" x2="${northX.toFixed(1)}" y2="${northY.toFixed(1)}" stroke="#44506a" stroke-width="3.5" stroke-linecap="round"/>`);

  // ── KNUCKLE: the tilt bracket that clamps the strongback to the pylon top.
  //    Slotted holes in the I-beam web give the up/down tilt adjustment (PLP).
  //    Drawn as a seat plate over the pylon cap + two bolts through the flange. ──
  const kHalf = Math.max(pylW * 0.95, 8);
  const kSx = originX - sdx * kHalf, kSy = pylonTopY - sdy * kHalf;   // seat south end (on SB)
  const kNx = originX + sdx * kHalf, kNy = pylonTopY + sdy * kHalf;   // seat north end (on SB)
  const knx = -sdy, kny = sdx;                                        // SB-normal (up from top)
  const seatH = Math.max(FT_PX * 0.12, 4);
  els.push(`<polygon points="${kSx.toFixed(1)},${kSy.toFixed(1)} ${kNx.toFixed(1)},${kNy.toFixed(1)} ${(kNx - knx*seatH).toFixed(1)},${(kNy - kny*seatH).toFixed(1)} ${(kSx - knx*seatH).toFixed(1)},${(kSy - kny*seatH).toFixed(1)}" fill="#2c3444" stroke="#111" stroke-width="0.8"/>`);
  // Two bolts through the pylon flange (the slotted tilt connection).
  els.push(`<circle cx="${originX.toFixed(1)}" cy="${(pylonTopY + FT_PX*0.22).toFixed(1)}" r="1.7" fill="#fff" stroke="#111" stroke-width="0.7"/>`);
  els.push(`<circle cx="${originX.toFixed(1)}" cy="${(pylonTopY + FT_PX*0.45).toFixed(1)}" r="1.7" fill="#fff" stroke="#111" stroke-width="0.7"/>`);

  // ── Single diagonal STRUT: pylon body (~35% up) → strongback south end ──
  const strutBaseY = groundY - (groundY - pylonTopY) * 0.35;
  els.push(`<line x1="${originX.toFixed(1)}" y1="${strutBaseY.toFixed(1)}" x2="${southX.toFixed(1)}" y2="${southY.toFixed(1)}" stroke="#44506a" stroke-width="2.2"/>`);

  // ── PX rails (2) on top of the strongback + module riding them ──
  const nx = -sdy, ny = sdx;                                  // perpendicular, up from SB top
  const railOff = Math.max(FT_PX * 0.11, 4);
  for (const f of [0.2, 0.8]) {
    const rx = southX + (northX - southX) * f + nx * railOff * 0.5;
    const ryy = southY + (northY - southY) * f + ny * railOff * 0.5;
    els.push(`<rect x="${(rx - 2).toFixed(1)}" y="${(ryy - 2).toFixed(1)}" width="4" height="4" fill="#ffffff" stroke="#111" stroke-width="0.8"/>`);
  }
  // Module plane (offset above the SB by the rail height) — thin tilted rect
  const mThk = Math.max(FT_PX * 0.13, 4);
  const mS = { x: southX + nx * railOff, y: southY + ny * railOff };
  const mN = { x: northX + nx * railOff, y: northY + ny * railOff };
  const mSb = { x: mS.x + nx * mThk, y: mS.y + ny * mThk };
  const mNb = { x: mN.x + nx * mThk, y: mN.y + ny * mThk };
  els.push(`<polygon points="${mS.x.toFixed(1)},${mS.y.toFixed(1)} ${mN.x.toFixed(1)},${mN.y.toFixed(1)} ${mNb.x.toFixed(1)},${mNb.y.toFixed(1)} ${mSb.x.toFixed(1)},${mSb.y.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
  for (let c = 1; c < sbRows * 3; c++) {
    const t = c / (sbRows * 3);
    const a = { x: mS.x + (mN.x - mS.x) * t, y: mS.y + (mN.y - mS.y) * t };
    const b = { x: mSb.x + (mNb.x - mSb.x) * t, y: mSb.y + (mNb.y - mSb.y) * t };
    els.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#9ca3af" stroke-width="0.4"/>`);
  }

  // ── Component labels (leaders) ──
  els.push(drawText(originX - pylW/2 - 5, (pylonTopY + groundY) / 2, 'W6 I-BEAM PYLON', { anchor: 'end', fontSize: 6.4, fill: '#111', fontWeight: 'bold' }));
  els.push(drawText((northX + southX) / 2 + nx * 24, (northY + southY) / 2 + ny * 24, 'STRONGBACK', { anchor: 'middle', fontSize: 6.4, fill: '#44506a', fontWeight: 'bold' }));
  els.push(drawText((originX + southX) / 2 - 3, (strutBaseY + southY) / 2 + 9, 'STRUT', { anchor: 'middle', fontSize: 6, fill: '#44506a', fontWeight: 'bold' }));
  els.push(drawText(mN.x + 6, mN.y - 4, `MODULE — ${sbRows} ROW${sbRows > 1 ? 'S' : ''} · ${tiltDeg}°`, { anchor: 'start', fontSize: 6.4, fill: '#111', fontWeight: 'bold' }));
  // KNUCKLE leader (points at the tilt bracket on the pylon top).
  const _klx = kNx + knx * seatH, _kly = kNy + kny * seatH;
  els.push(`<line x1="${_klx.toFixed(1)}" y1="${_kly.toFixed(1)}" x2="${(_klx + 30).toFixed(1)}" y2="${(_kly - 14).toFixed(1)}" stroke="#111" stroke-width="0.5"/>`);
  els.push(drawText(_klx + 33, _kly - 14, 'KNUCKLE — SLOTTED TILT BRACKET', { anchor: 'start', fontSize: 6, fill: '#111', fontWeight: 'bold' }));

  // ── I-BEAM cross-section detail (SECTION A-A) — makes the driven member read
  //    unambiguously as a wide-flange W-section, not a generic round pipe. Also
  //    fills the lower-left dead space on this sheet. ──
  {
    const ibx = dz.x + dz.width * 0.10;
    const iby = groundY + Math.max(FT_PX * 1.4, 40);
    const fw = 16, fl = 3, wh = 13, wt = 3;                 // flange width/thk, web height/thk
    const drawIRect = (x: number, y: number, w: number, h: number) => {
      els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1"/>`);
      els.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="url(#hatch-steel)"/>`);
    };
    drawIRect(ibx - fw / 2, iby, fw, fl);                    // top flange
    drawIRect(ibx - wt / 2, iby + fl, wt, wh);               // web
    drawIRect(ibx - fw / 2, iby + fl + wh, fw, fl);          // bottom flange
    els.push(drawText(ibx, iby + fl + wh + fl + 11, 'SECTION A-A', { anchor: 'middle', fontSize: 6.4, fill: '#111', fontWeight: 'bold' }));
    els.push(drawText(ibx, iby + fl + wh + fl + 20, 'W6×9 DRIVEN I-BEAM PYLON', { anchor: 'middle', fontSize: 6, fill: '#555' }));
  }

  // Downstream aliases (load arrows + dimensions reference these).
  const panMidX = (mS.x + mN.x) / 2, panMidY = (mS.y + mN.y) / 2;
  const panTopY = Math.min(mN.y, mS.y);
  const panPivotX = originX, panPivotY = pylonTopY;
  const arrowX = northX + 16;

  // ── STEP 7: Load arrows ──
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

  // L1 — Pylon embedment depth (left, vertical)
  els.push(drawVerticalDimension(
    originX - 46, groundY, groundY + embedFt * FT_PX,
    16, ftToFtIn(embedFt) + ' EMBED'
  ));

  // L1 — Pylon above-grade height to strongback pivot
  els.push(drawVerticalDimension(
    originX - 46, groundY, panPivotY,
    16, ftToFtIn(pileAboveFt) + ' A.G.'
  ));

  // Pylon-spacing note (bays run E-W in PLAN — this is the typical section).
  els.push(drawText(originX, groundY + embedFt * FT_PX + 22,
    `TYP. PLP PYLON — ONE PER BAY @ 20' O.C. (SEE PLAN)`, {
      anchor: 'middle', fontSize: 6.5, fill: '#036', fontWeight: 'bold' }));

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
    { n: 1, label: `DRIVEN I-BEAM PYLON — ${ftToFtIn(pileDepthFt)} EMBED` },
    { n: 2, label: `PYLON SPACING — ONE PER BAY @ 20' O.C.` },
    { n: 3, label: `STRONGBACK — TILTED, SINGLE-STRUT CANTILEVER` },
    { n: 4, label: `PX RAIL — CONTINUOUS E-W, MODULE CLAMPS` },
    { n: 5, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}" @ ${tiltDeg}° TILT` },
    { n: 6, label: `WIND LOAD — ${windSpeedMph} MPH (${_cpGs.asceLabel})` },
    { n: 7, label: groundSnowPsf > 0
        ? `SNOW LOAD — ${groundSnowPsf} PSF (${_cpGs.asceLabel})`
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
    { text: `PYLON EMBED: ${ftToFtIn(pileDepthFt)} MIN.`, bold: false },
    { text: `GROUND CLEAR: ${gcInch.toFixed(0)}" MIN.`, bold: false },
    { text: `REF: NEC 690 / IBC 1609 / ${_cpGs.asceLabel}`, bold: false },
    { text: 'VERIFY PYLON SIZE + EMBED WITH GEOTECH.', bold: true, red: true },
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
    'PLP PYLON STRUCTURAL DETAIL — VERIFY PYLON SIZE, EMBED + STRUT WITH GEOTECH / PE — NTS', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}