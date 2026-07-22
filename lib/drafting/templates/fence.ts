// ============================================================
// SolarPro Drafting Engine — Fence System Templates
// lib/drafting/templates/fence.ts
//
// drawFencePlan()      → PV-2: top-down segment layout (site plan)
// drawFenceElevation() → PV-3: structural elevation (MANDATORY PRIMARY)
//
// SYSTEM: solar_fence ONLY
// CAD IS THE SOLE SOURCE OF TRUTH — all geometry from CADModel.
//
// CROSS-CONTAMINATION BLOCK (STEP 9):
//   ✗ No roof terminology (plane, pitch, rafter, ridge, eave)
//   ✗ No ground terminology (array, pile, row spacing, tilt row)
//   ✓ Fence-only: segment, post, rail, gate, panel height, embed
//
// SEGMENT ENGINE (STEP 6):
//   Renders per-segment from cad.fence.segments[].
//   Each segment: id, length, panelCount, posts[], label.
//   NOT a total blob — each segment drawn independently.
//
// STRUCTURAL REALISM (STEP 7):
//   PV-3 shows: post spacing dim, panel stacking height,
//   ground line, embed depth, wind load arrows, rail count,
//   3-level dimension hierarchy.
// ============================================================

import type { DraftingInput } from '../types';
import type { DesignIntent } from '../designIntent';
import type { CADModel, CADFenceSegment } from '../../cad/types';
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
import { projectCodeAuthority } from '../../permit/snapshot/codeAuthorityProjection';
import { getMountingSystemById } from '../../mounting-hardware-db';
import { getRackingById } from '../../equipment-db';

// ── SOLFENCE VERTICAL BIFACIAL SECTION — manufacturer structural record ──────
// Source: SolFence's own PE-sealed planset detail "VERTICAL BIFACIAL SOLAR
// FENCE SECTION" (Sol Fence LLC, 12/2025) — the TELESCOPING post system:
// a 4"⌀ outer aluminum post sleeved over a 2-7/8"⌀ × 96" inner steel post
// driven 48" (no concrete), 4"×4" post stiffeners, 2"×1" mid rail.
// ⚠ SYNC FLAG: equipment-db.ts 'solfence-8ft' (attachmentMethod) and the
// structural-engine SOLFENCE notes still describe the older "4×4 post /
// 2-3/8" driven pipe" install — this record carries the manufacturer's
// CURRENT section detail; update the equipment record to match (owned by
// another module — flagged for review, do not fork values elsewhere).
export const SOLFENCE_SECTION = {
  outerPostDiaIn:   4,        // 4"⌀ outer aluminum post
  innerPostDiaIn:   2.875,    // 2-7/8"⌀ inner steel post (hot-dip galvanized)
  innerPostLenIn:   96,       // 96" inner steel post overall length
  innerPostEmbedIn: 48,       // 48" driven embedment (4'-0" min, no concrete)
  postCcIn:         93.75,    // 93-3/4" post center-to-center (4" outer post)
  railCutIn:        93.625,   // 93-5/8" rail cut length
  midRailCutIn:     91.6875,  // 91-11/16" mid rail cut length
  midRailTallIn:    2,        // mid rail section: 2" tall …
  midRailDeepIn:    1,        // … × 1" deep
  stiffenerIn:      4,        // 4"×4" post stiffeners at rail connections
  panelTallIn:      72,       // 72" module height (6' H section)
  bayWideIn:        93.2,     // 93.2" bay width (8' W nominal section)
} as const;

/** Live equipment-db ratings for the SolFence section (single source —
 *  maxWindSpeed/maxSnowLoad live on the 'solfence-8ft' racking record). */
function solfenceRatings(): { windMph: number; snowPsf: number; material: string } {
  const r = getRackingById('solfence-8ft');
  return {
    windMph:  r?.maxWindSpeed ?? 115,
    snowPsf:  r?.maxSnowLoad  ?? 113,
    material: r?.material ?? '6061-T6 Aluminum',
  };
}

// Wave 6.1 (punch 1a) — canonical fence-system display name. Fence racking is
// ALWAYS SolFence (equipment-db 'solfence-8ft'; bom-system-profiles rackingBrand
// 'SolFence'); a fence sheet must never brand the project-wide ROOF racking
// (legacy config.mountingId contamination — Stowell PV-1F printed
// "FENCE SYSTEM: ROOF TECH RT-MINI" / "RAIL ×2 — ROOF TECH RT-MINI").
const SOLFENCE_DISPLAY = 'SOLFENCE VERTICAL SECTION SYSTEM';
const NON_FENCE_MOUNT_RE = /roof\s?tech|rt[-\s]?mini|ironridge|unirac|snapnrack|quick\s?mount|s-5|xr\d|ground\s?mount|iron\s?ridge/i;

/** Resolve the fence-system display name from the sub's own equipment —
 *  never from a roof/ground mounting that leaked through the flat scalars. */
function resolveFenceMountName(project: Record<string, unknown> | undefined | null): string {
  const sel = project?.mountingSystemId
    ? getMountingSystemById(String(project.mountingSystemId))
    : undefined;
  if (sel && sel.category === 'solar_fence') return `${sel.manufacturer} ${sel.model}`;
  if (sel) return SOLFENCE_DISPLAY;                          // non-fence id ⇒ contamination
  const name = String(project?.mountingSystem ?? '').trim();
  if (name && NON_FENCE_MOUNT_RE.test(name)) return SOLFENCE_DISPLAY; // roof brand by name
  return name || 'SOLAR FENCE SYSTEM';
}

// ── SEGMENT COLORS (one per segment, wraps) ──────────────────────────────────
const SEG_COLORS = [
  '#2255aa', '#1a7a3a', '#8b1a1a', '#7a5500', '#4a1a7a',
  '#006666', '#7a3a00', '#003366', '#5a0033', '#336600',
];
function segColor(i: number): string {
  return SEG_COLORS[i % SEG_COLORS.length];
}

// ── DC-STRING CIRCUIT COLORS ─────────────────────────────────────────────────
// MUST stay byte-identical to `stringColors` in lib/permit/sections/arrayPages.ts
// (not exported there) and FENCE_STRING_COLORS in lib/permit/utils/drawing.ts:
// the PV-1BF STRING LEGEND paints String 1/2 from that list, and the run drawn
// here must use the SAME hues or the sheet contradicts its own legend
// (verify-lead finding, 2026-07-18).
const FENCE_STRING_COLORS = ['#1b3f74','#cc0000','#cc6600','#5500cc','#0891b2','#be185d','#65a30d','#e5a100',
                             '#134e4a','#7f1d1d','#92400e','#312e81','#155e75','#831843','#3f6212','#713f12'];

// ─────────────────────────────────────────────────────────────────────────────
// drawFencePlan — PV-2 Site Plan (top-down segment layout)
// SECONDARY view for solar_fence system.
// ─────────────────────────────────────────────────────────────────────────────

export function drawFencePlan(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
  // Circuit mode (PV-1BF / pure-fence circuit sheet): DC-string spans from the
  // SUB-SCOPED inverter fleet, in string order (e.g. Stowell fence 2×9 →
  // [{count:9},{count:9}]). When present, the run's module cells are filled
  // per string with FENCE_STRING_COLORS so the drawing matches the sheet's
  // own STRING LEGEND. Absent → per-segment coloring as before.
  circuit?: { spans: Array<{ count: number }> } | null,
): string {
  const { layout, engineering } = input;
  const _asceFp = projectCodeAuthority(ctx?.snapshot).asceLabel;   // W4 §2 code editions

  // ── CAD segments (STEP 4: CAD is the ONLY source of truth) ──
  const cadFence = cad?.fence;
  const segments: any[] = cadFence?.segments ?? layout.fenceSegments ?? [];

  if (!segments || segments.length === 0) {
    throw new Error(
      '[drawFencePlan] No fence segments available. ' +
      'solar_fence system requires cad.fence.segments[].'
    );
  }

  const totalPanels   = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw          = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;
  const totalLengthFt = cadFence
    ? metersToFt(cadFence.totalLengthM)
    : (layout.fenceTotalLengthFt ?? 0);

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('solar_fence', 'plan');
  const W = zones.canvas.width;
  const H = zones.canvas.height;   // fence always uses tall canvas

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#f5f7f0'));
  els.push(drawTitleBar(W, 'SOLAR FENCE — SITE PLAN (TOP-DOWN)', 'SCALE: AS SHOWN'));

  const dz = zones.draw;

  // ── Compute bounding box of all segments (local meters) ──
  const allX: number[] = [];
  const allY: number[] = [];

  segments.forEach((seg: any) => {
    // Support both CADFenceSegment (startX/Y in meters) and adapted (startPoint.x/y in meters)
    const sx: number = seg.startX ?? seg.startPoint?.x ?? 0;
    const sy: number = seg.startY ?? seg.startPoint?.y ?? 0;
    const ex: number = seg.endX   ?? seg.endPoint?.x   ?? 0;
    const ey: number = seg.endY   ?? seg.endPoint?.y   ?? 0;
    allX.push(sx, ex);
    allY.push(sy, ey);
  });

  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);

  const mToFt   = metersToFt(1);
  const spanXft = (maxX - minX) * mToFt;
  const spanYft = (maxY - minY) * mToFt;

  // ── AUTO-FIT + CENTER (kill the corner-of-empty-canvas look) ──
  // Reserve padding for the module band, the parallel per-segment length dims
  // and the overall run dimension so nothing clips at the draw-zone edges. Fit
  // to the tighter axis, then CENTER the drawn extent in BOTH axes: a single
  // straight run has ~0 height and previously pinned to the bottom edge, which
  // is exactly the "85% dead canvas" Ray flagged.
  // The fence run is long + thin, so the top-down alone can only ever be a
  // ribbon. Confine it to the UPPER ~46% of the draw zone; the lower half
  // carries a TYPICAL FENCE SECTION so the sheet fills instead of leaving a
  // hairline in ~75% white (Ray's flag). planZone = the top-down's own zone.
  const planZone = { x: dz.x, y: dz.y, width: dz.width, height: Math.round(dz.height * 0.34) };
  const padPx    = 40;
  const availW   = Math.max(80, planZone.width  - 2 * padPx);
  const availH   = Math.max(70, planZone.height - 2 * padPx);
  const fitScale = Math.min(availW / (spanXft || 1), availH / (spanYft || 1));
  const scale    = Math.min(fitScale, 24);   // px per foot (cap so a short run isn't blown up huge)

  const drawnWpx = spanXft * scale;
  const drawnHpx = spanYft * scale;
  const originX  = planZone.x + (planZone.width  - drawnWpx) / 2;   // left edge of content
  const originYb = planZone.y + (planZone.height + drawnHpx) / 2;   // vertical center of the plan zone

  const toSvgX = (xM: number) => originX  + (xM - minX) * mToFt * scale;
  const toSvgY = (yM: number) => originYb - (yM - minY) * mToFt * scale;

  // ── Draw each segment: module band + module ticks + colored run + parallel dim ──
  const BAND = 11;   // half-height (px) of the top-view module band

  // DC-string cell assignment (circuit mode) — same balanced-threshold math as
  // buildSegmentPlanThumb (lib/permit/utils/drawing.ts): cumulative panelCount
  // thresholds scaled to the placed cell total, never dropping a cell.
  const _spanList = circuit?.spans ?? [];
  const _cellTotal = segments.reduce((s: number, sg: any) => s + Math.max(sg.panelCount ?? 0, 0), 0);
  const _spanSum = _spanList.reduce((s, sp) => s + sp.count, 0);
  const _bounds: number[] = [];
  if (_spanList.length > 0 && _spanSum > 0 && _cellTotal > 0) {
    let acc = 0;
    for (const sp of _spanList) { acc += sp.count; _bounds.push(Math.round(acc * _cellTotal / _spanSum)); }
    _bounds[_bounds.length - 1] = _cellTotal;
  }
  const _stringOfCell = (ci: number): number => {
    for (let bi = 0; bi < _bounds.length; bi++) if (ci < _bounds[bi]) return bi;
    return Math.max(_bounds.length - 1, 0);
  };
  const _hasCircuit = _bounds.length > 0;
  let _cellBase = 0;   // cumulative module index across segments (run order)

  segments.forEach((seg: any, i: number) => {
    const sx = seg.startX ?? seg.startPoint?.x ?? 0;
    const sy = seg.startY ?? seg.startPoint?.y ?? 0;
    const ex = seg.endX   ?? seg.endPoint?.x   ?? 0;
    const ey = seg.endY   ?? seg.endPoint?.y   ?? 0;

    const x1 = toSvgX(sx), y1 = toSvgY(sy);
    const x2 = toSvgX(ex), y2 = toSvgY(ey);

    const color    = segColor(i);
    // Length label must match the line we draw: prefer an explicit length field,
    // else derive it from the segment's own start/end geometry (never 0 when the
    // run clearly spans a distance — the "0'-0" while the line is 63'" bug).
    const geomLenFt = metersToFt(Math.hypot(ex - sx, ey - sy));
    const lenFt    = seg.lengthFt ?? (seg.lengthM != null ? metersToFt(seg.lengthM) : geomLenFt);
    const panCount = seg.panelCount ?? 0;
    const segLabel = seg.label ?? seg.id ?? `SEG-${i + 1}`;

    // Unit vectors: along-run (ux,uy) and perpendicular (nx,ny)
    const segPx = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / segPx, uy = (y2 - y1) / segPx;
    const nx = -uy, ny = ux;

    // Module band — thin rectangle centred on the run (panels seen top-down)
    const p1x = x1 + nx * BAND, p1y = y1 + ny * BAND;
    const p2x = x2 + nx * BAND, p2y = y2 + ny * BAND;
    const p3x = x2 - nx * BAND, p3y = y2 - ny * BAND;
    const p4x = x1 - nx * BAND, p4y = y1 - ny * BAND;
    els.push(`<polygon points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)} ${p4x.toFixed(1)},${p4y.toFixed(1)}" fill="${_hasCircuit ? 'none' : color}" fill-opacity="0.12" stroke="${_hasCircuit ? '#555' : color}" stroke-width="1"/>`);

    // Module ticks — divide the run into panelCount cells (module boundaries).
    // Circuit mode: each cell filled + stroked by its DC string so the drawing
    // matches the sheet's STRING LEGEND (reference PV-2 per-circuit run).
    const cells = Math.max(panCount, 1);
    const cellCol = (c: number): string => _hasCircuit
      ? FENCE_STRING_COLORS[_stringOfCell(_cellBase + c) % FENCE_STRING_COLORS.length]
      : color;
    if (_hasCircuit) {
      for (let c = 0; c < cells; c++) {
        const t0 = c / cells, t1 = (c + 1) / cells;
        const ax = x1 + (x2 - x1) * t0, ay = y1 + (y2 - y1) * t0;
        const bx = x1 + (x2 - x1) * t1, by = y1 + (y2 - y1) * t1;
        const cc = cellCol(c);
        els.push(`<polygon points="${(ax + nx * BAND).toFixed(1)},${(ay + ny * BAND).toFixed(1)} ${(bx + nx * BAND).toFixed(1)},${(by + ny * BAND).toFixed(1)} ${(bx - nx * BAND).toFixed(1)},${(by - ny * BAND).toFixed(1)} ${(ax - nx * BAND).toFixed(1)},${(ay - ny * BAND).toFixed(1)}" fill="${cc}" fill-opacity="0.20" stroke="none"/>`);
        els.push(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${cc}" stroke-width="2.4" stroke-linecap="butt"/>`);
      }
    }
    for (let c = 0; c <= cells; c++) {
      const t   = c / cells;
      const cxp = x1 + (x2 - x1) * t;
      const cyp = y1 + (y2 - y1) * t;
      const isEnd = c === 0 || c === cells;
      const tk   = isEnd ? BAND : BAND * 0.82;
      els.push(`<line x1="${(cxp + nx * tk).toFixed(1)}" y1="${(cyp + ny * tk).toFixed(1)}" x2="${(cxp - nx * tk).toFixed(1)}" y2="${(cyp - ny * tk).toFixed(1)}" stroke="${cellCol(Math.min(c, cells - 1))}" stroke-width="${isEnd ? 1.4 : 0.7}"/>`);
    }

    if (!_hasCircuit) {
      // Colored fence centreline (the run itself)
      els.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`);
    }

    // ── Posts at SECTION JOINTS — physical SolFence install logic ─────────────
    // SolFence ships pre-built ~8'-wide sections that carry 2 panels each and
    // span BETWEEN two 4×4 posts. A post therefore lands at every section
    // boundary — which is a panel EDGE — and NEVER in the middle of a panel.
    // Posts = sections + 1. Deriving post positions from the module grid (not a
    // free-running O.C. spacing) guarantees they sit on module boundaries.
    const postSpacingFt = metersToFt(cadFence?.postSpacingM ?? 2.44);   // ~8' section
    const panelWidthFt  = cells > 0 ? lenFt / cells : lenFt;
    const panelsPerSection = Math.max(1, Math.round(postSpacingFt / Math.max(panelWidthFt, 0.1)));
    const postCells: number[] = [];
    for (let c = 0; c <= cells; c += panelsPerSection) postCells.push(c);
    if (postCells[postCells.length - 1] !== cells) postCells.push(cells);   // always cap the run end
    const postSq = 3;   // 4×4 post drawn as a small square straddling the run line
    postCells.forEach(c => {
      const t   = cells > 0 ? c / cells : 0;
      const pxp = x1 + (x2 - x1) * t;
      const pyp = y1 + (y2 - y1) * t;
      els.push(`<rect x="${(pxp - postSq).toFixed(1)}" y="${(pyp - postSq).toFixed(1)}" width="${postSq * 2}" height="${postSq * 2}" fill="#ffffff" stroke="#111" stroke-width="1"/>`);
      els.push(`<rect x="${(pxp - postSq).toFixed(1)}" y="${(pyp - postSq).toFixed(1)}" width="${postSq * 2}" height="${postSq * 2}" fill="url(#hatch-steel)"/>`);
    });

    // Segment angle (deg) for rotated annotations; keep the label text upright
    const angDeg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    let labelAng = angDeg;
    if (labelAng > 90 || labelAng < -90) labelAng += 180;

    // Parallel LENGTH dimension on the −n side of the band
    const dimOff = BAND + 15;
    const da1x = x1 - nx * dimOff, da1y = y1 - ny * dimOff;
    const da2x = x2 - nx * dimOff, da2y = y2 - ny * dimOff;
    els.push(`<line x1="${(x1 - nx * (BAND + 2)).toFixed(1)}" y1="${(y1 - ny * (BAND + 2)).toFixed(1)}" x2="${(da1x - nx * 2).toFixed(1)}" y2="${(da1y - ny * 2).toFixed(1)}" stroke="#c00" stroke-width="0.6"/>`);
    els.push(`<line x1="${(x2 - nx * (BAND + 2)).toFixed(1)}" y1="${(y2 - ny * (BAND + 2)).toFixed(1)}" x2="${(da2x - nx * 2).toFixed(1)}" y2="${(da2y - ny * 2).toFixed(1)}" stroke="#c00" stroke-width="0.6"/>`);
    els.push(`<line x1="${da1x.toFixed(1)}" y1="${da1y.toFixed(1)}" x2="${da2x.toFixed(1)}" y2="${da2y.toFixed(1)}" stroke="#c00" stroke-width="0.9"/>`);
    els.push(drawArrowhead(da1x, da1y, angDeg, 5, '#c00'));
    els.push(drawArrowhead(da2x, da2y, angDeg + 180, 5, '#c00'));
    els.push(drawText((da1x + da2x) / 2 - nx * 6, (da1y + da2y) / 2 - ny * 6, ftToFtIn(lenFt), {
      anchor: 'middle', fontSize: 6.5, fill: '#c00', fontWeight: 'bold', rotate: labelAng,
    }));

    // Colored segment badge on the +n side (id + panel count)
    const badgeOff = BAND + 13;
    const bmx = (x1 + x2) / 2 + nx * badgeOff;
    const bmy = (y1 + y2) / 2 + ny * badgeOff;
    const badgeW = 54, badgeH = 12;
    els.push(`<rect x="${(bmx - badgeW / 2).toFixed(1)}" y="${(bmy - badgeH / 2).toFixed(1)}" width="${badgeW}" height="${badgeH}" fill="${color}" rx="2" opacity="0.9"/>`);
    els.push(drawText(bmx, bmy + 3.5, `${segLabel} · ${panCount}p`, {
      anchor: 'middle', fontSize: 6.5, fill: '#fff', fontWeight: 'bold',
    }));
    _cellBase += cells;
  });

  // ── Overall bounding dimension (extent along the longer axis) ──
  // Label must match what the line MEASURES: for a single straight run the
  // bounding extent IS the total run; for a multi-segment (L / U) run the
  // bounding width/depth is NOT the summed length, so label it as extent.
  const single = segments.length === 1;
  if (Math.max(drawnWpx, drawnHpx) > 50) {
    if (drawnWpx >= drawnHpx) {
      const oy  = originYb + BAND + 34;
      const ox1 = originX, ox2 = originX + drawnWpx;
      const lbl = single ? `TOTAL RUN: ${ftToFtIn(totalLengthFt)}` : `OVERALL W: ${ftToFtIn(spanXft)}`;
      els.push(`<line x1="${ox1.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${ox2.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="#036" stroke-width="1.3"/>`);
      els.push(`<line x1="${ox1.toFixed(1)}" y1="${(oy - 4).toFixed(1)}" x2="${ox1.toFixed(1)}" y2="${(oy + 4).toFixed(1)}" stroke="#036" stroke-width="1"/>`);
      els.push(`<line x1="${ox2.toFixed(1)}" y1="${(oy - 4).toFixed(1)}" x2="${ox2.toFixed(1)}" y2="${(oy + 4).toFixed(1)}" stroke="#036" stroke-width="1"/>`);
      els.push(drawArrowhead(ox1, oy, 0, 6, '#036'));
      els.push(drawArrowhead(ox2, oy, 180, 6, '#036'));
      els.push(drawText((ox1 + ox2) / 2, oy - 4, lbl, {
        anchor: 'middle', fontSize: 7.5, fill: '#036', fontWeight: 'bold',
      }));
    } else {
      const ox  = originX - BAND - 30;
      const oy1 = originYb, oy2 = originYb - drawnHpx;
      const lbl = single ? `TOTAL RUN: ${ftToFtIn(totalLengthFt)}` : `OVERALL D: ${ftToFtIn(spanYft)}`;
      els.push(`<line x1="${ox.toFixed(1)}" y1="${oy1.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy2.toFixed(1)}" stroke="#036" stroke-width="1.3"/>`);
      els.push(drawArrowhead(ox, oy1, -90, 6, '#036'));
      els.push(drawArrowhead(ox, oy2, 90, 6, '#036'));
      els.push(drawText(ox - 4, (oy1 + oy2) / 2, lbl, {
        anchor: 'middle', fontSize: 7.5, fill: '#036', fontWeight: 'bold', rotate: -90,
      }));
    }
  }

  // For a multi-segment run, print the summed length as a clear note in the
  // (usually empty) top-left corner — the bounding dim above only measures one
  // axis of an L/U-shaped run, so the summed run length needs its own callout.
  if (!single) {
    els.push(drawText(dz.x + 4, dz.y + 14, `TOTAL RUN (ALL SEGMENTS): ${ftToFtIn(totalLengthFt)}`, {
      anchor: 'start', fontSize: 8, fill: '#036', fontWeight: 'bold',
    }));
  }

  // ── Gate openings ──
  const gates = cadFence?.gateOpenings ?? layout.fenceGateOpenings ?? [];
  if (gates.length > 0) {
    gates.forEach((gate: any, gi: number) => {
      // Gate shown at first segment start + positionM along it
      if (segments.length > 0) {
        const seg0 = segments[0];
        const sx = seg0.startX ?? seg0.startPoint?.x ?? 0;
        const sy = seg0.startY ?? seg0.startPoint?.y ?? 0;
        const ex = seg0.endX   ?? seg0.endPoint?.x   ?? 0;
        const ey = seg0.endY   ?? seg0.endPoint?.y   ?? 0;
        const posM   = gate.positionM ?? metersToFt(gate.positionFt ?? 0) / metersToFt(1);
        const lenM   = (seg0.lengthM ?? metersToFt(1)) || 1;
        const t      = Math.min(posM / lenM, 1);
        const gx     = toSvgX(sx + t * (ex - sx));
        const gy     = toSvgY(sy + t * (ey - sy));
        const widPx  = metersToFt(gate.widthM ?? (gate.widthFt ?? 10) / metersToFt(1)) * scale;
        els.push(`<rect x="${(gx - widPx / 2).toFixed(1)}" y="${(gy - 6).toFixed(1)}"
          width="${widPx.toFixed(1)}" height="12"
          fill="#ffdd00" stroke="#888" stroke-width="1" opacity="0.7"/>`);
        els.push(drawText(gx, gy + 3, 'GATE', {
          anchor: 'middle', fontSize: 6, fill: '#333', fontWeight: 'bold',
        }));
      }
    });
  }

  // ── North arrow + scale bar (kept inside the plan zone, upper half) ──
  els.push(drawNorthArrow(planZone.x + planZone.width - 22, planZone.y + 20, 20));
  const scaleBarFt = 20;
  els.push(drawScaleBar(planZone.x + 8, planZone.y + planZone.height - 12,
    Math.max(Math.round(scaleBarFt * scale), 40), '', { totalFt: scaleBarFt }));

  // ── Property-line + setback site context ────────────────────────────────────
  // The top-down alone is a thin ribbon (a fence is long + shallow), floating in
  // white. Drawing the property boundary it parallels + the setback dimension
  // turns the hairline into a readable SITE PLAN and fills the plan zone (Ray).
  {
    const _sbFt = (cadFence as { setbackFt?: number } | undefined)?.setbackFt
      ?? (layout as { fenceSetbackFt?: number }).fenceSetbackFt ?? 5;
    const plY  = Math.max(planZone.y + 16, originYb - BAND - 46);   // property line above the run
    const px1  = Math.max(planZone.x + 6, originX - 24);
    const px2  = Math.min(planZone.x + planZone.width - 6, originX + drawnWpx + 24);
    els.push(`<line x1="${px1.toFixed(1)}" y1="${plY.toFixed(1)}" x2="${px2.toFixed(1)}" y2="${plY.toFixed(1)}" stroke="#c0392b" stroke-width="1" stroke-dasharray="9,4"/>`);
    els.push(drawText(px1 + 3, plY - 4, 'PROPERTY LINE (TYP.)', { anchor: 'start', fontSize: 6.5, fill: '#c0392b', fontWeight: 'bold' }));
    const sbX = originX + drawnWpx * 0.28;
    const fenceTopY = originYb - BAND;
    if (fenceTopY - plY > 14) {
      els.push(`<line x1="${sbX.toFixed(1)}" y1="${plY.toFixed(1)}" x2="${sbX.toFixed(1)}" y2="${fenceTopY.toFixed(1)}" stroke="#c0392b" stroke-width="0.8"/>`);
      els.push(drawArrowhead(sbX, plY, -90, 5, '#c0392b'));
      els.push(drawArrowhead(sbX, fenceTopY, 90, 5, '#c0392b'));
      els.push(drawText(sbX + 4, (plY + fenceTopY) / 2 + 2, `${_sbFt}' SETBACK`, { anchor: 'start', fontSize: 6, fill: '#c0392b', fontWeight: 'bold' }));
    }
  }

  // ── TYPICAL FENCE SECTION — fills the lower half of the draw zone ───────────
  // A real cross-section (driven post + 90° vertical modules + embedment) gives
  // the sheet vertical content instead of a thin run floating in white.
  {
    const postSpFt  = metersToFt(cadFence?.postSpacingM ?? 2.44);
    const embedFt   = metersToFt(cadFence?.postEmbedM   ?? 0.91);
    const panelHtFt = metersToFt(cadFence?.panelHeightM ?? 1.83);
    const rails     = Math.max(1, cadFence?.railCount ?? 2);
    const clrFt     = 0.5;

    const secX = dz.x, secW = dz.width;
    const secY = dz.y + dz.height * 0.37;
    const secH = dz.height - (secY - dz.y) - 6;

    els.push(drawRectFilled(secX, secY, secW, 13, '#1a2332', '#1a2332', 0));
    els.push(drawText(secX + 6, secY + 9.3,
      `TYPICAL FENCE SECTION — VERTICAL MODULES · DRIVEN POST @ ${postSpFt.toFixed(0)}' O.C.`, {
        anchor: 'start', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));

    const innerTop = secY + 13;
    const grade    = innerTop + (secH - 13) * 0.58;
    const vft = Math.min(
      (grade - innerTop - 18) / (panelHtFt + clrFt + 0.5),
      (secY + secH - grade - 20) / (embedFt + 0.3),
      22);
    const clrPx   = clrFt * vft;
    const panelPx = panelHtFt * vft;
    const embedPx = embedFt * vft;
    // TWO-bay section (matches the "TYPICAL 2-BAY" language elsewhere) — a
    // single 8' bay at this scale used only the left third of the band and
    // left the middle dead (verify-lead finding, 2026-07-18).
    const bays    = 2;
    const bayPx   = Math.min(postSpFt * vft, secW * 0.19);
    const cx      = secX + secW * 0.25;
    const leftPost = cx - bayPx, rightPost = cx + bayPx;
    const postXs: number[] = [leftPost, cx, rightPost];
    const postTopY = grade - clrPx - panelPx - 8;
    const panTop   = grade - clrPx - panelPx;

    // Grade line + hatch
    els.push(`<line x1="${(secX + 20).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(secX + secW - 24).toFixed(1)}" y2="${grade.toFixed(1)}" stroke="#6b4a2a" stroke-width="1.8"/>`);
    for (let i = 0; i < 22; i++) {
      const gx = secX + 24 + i * ((secW - 48) / 22);
      els.push(`<line x1="${gx.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(gx - 5).toFixed(1)}" y2="${(grade + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.5"/>`);
    }
    // Posts: above grade (solid steel) + below grade (dashed embed)
    for (const px of postXs) {
      els.push(`<rect x="${(px - 2.6).toFixed(1)}" y="${postTopY.toFixed(1)}" width="5.2" height="${(grade - postTopY).toFixed(1)}" fill="#8a8a8a" stroke="#333" stroke-width="1"/>`);
      els.push(`<rect x="${(px - 2.6).toFixed(1)}" y="${grade.toFixed(1)}" width="5.2" height="${embedPx.toFixed(1)}" fill="#707070" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);
    }
    // Vertical PV modules between posts — a SolFence section carries 2 PORTRAIT
    // panels side by side (8' section = 2 panels), not one panel spanning the
    // bay. CAD line-art: white glazing, black frame, thin cell grid.
    const panelWidthFt = metersToFt((cadFence as any)?.panelWidthM ?? 1.134);
    const nSecPanels = Math.max(1, Math.round(postSpFt / Math.max(panelWidthFt, 0.5)));
    const secGap = 3;
    for (let b = 0; b < bays; b++) {
      const innerL = postXs[b] + 4, innerR = postXs[b + 1] - 4;
      const secPw = (innerR - innerL - secGap * (nSecPanels - 1)) / nSecPanels;
      for (let pi = 0; pi < nSecPanels; pi++) {
        const pxL = innerL + pi * (secPw + secGap);
        els.push(`<rect x="${pxL.toFixed(1)}" y="${panTop.toFixed(1)}" width="${secPw.toFixed(1)}" height="${panelPx.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.1"/>`);
        // center mullion (2-cell-column portrait module) + row grid
        els.push(`<line x1="${(pxL + secPw / 2).toFixed(1)}" y1="${(panTop + 1).toFixed(1)}" x2="${(pxL + secPw / 2).toFixed(1)}" y2="${(panTop + panelPx - 1).toFixed(1)}" stroke="#9ca3af" stroke-width="0.4"/>`);
        for (let r = 1; r < 6; r++) {
          const ry = panTop + (panelPx * r) / 6;
          els.push(`<line x1="${(pxL + 1).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(pxL + secPw - 1).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="#9ca3af" stroke-width="0.4"/>`);
        }
      }
    }
    // Wind arrow — with the DESIGN VALUE (Ray "next level" item 3: load
    // arrows carry their real ASCE figures at the member they act on).
    const wY = (panTop + grade) / 2;
    // W3 §7 — single-sourced from the snapshot env (115 = standalone-only guard).
    const _windMph = projectStructural(ctx?.snapshot).windSpeedMph
      ?? (engineering as { windSpeedMph?: number }).windSpeedMph
      ?? (input.project as { ahjWindSpeedMph?: number })?.ahjWindSpeedMph ?? 115;
    els.push(`<line x1="${(rightPost + 44).toFixed(1)}" y1="${wY.toFixed(1)}" x2="${(rightPost + 10).toFixed(1)}" y2="${wY.toFixed(1)}" stroke="#c00" stroke-width="1.6"/>`);
    els.push(drawArrowhead(rightPost + 10, wY, 180, 6, '#c00'));
    els.push(drawText(rightPost + 48, wY - 3, `WIND ${_windMph} MPH Vult`, { anchor: 'start', fontSize: 6.5, fontWeight: 'bold', fill: '#c00' }));
    els.push(drawText(rightPost + 48, wY + 5, `${_asceFp} §29`, { anchor: 'start', fontSize: 5.2, fill: '#c00' }));
    // Dimensions
    els.push(drawText(leftPost - 9, (panTop + grade - clrPx) / 2, `${panelHtFt.toFixed(1)}' PANEL`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#1a4a8a', rotate: -90 }));
    els.push(drawText(rightPost + 10, grade + embedPx / 2, `${embedFt.toFixed(1)}' EMBED`, { anchor: 'start', fontSize: 6.8, fontWeight: 'bold', fill: '#333' }));
    const dy = grade + embedPx + 13;
    els.push(`<line x1="${leftPost.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${rightPost.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#036" stroke-width="0.9"/>`);
    for (const tx of postXs) {
      els.push(`<line x1="${tx.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#036" stroke-width="0.8"/>`);
    }
    els.push(drawText((leftPost + cx) / 2, dy - 3, `${postSpFt.toFixed(0)}' O.C.`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#036' }));
    els.push(drawText((cx + rightPost) / 2, dy - 3, `${postSpFt.toFixed(0)}' O.C.`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#036' }));

    // Left: overall post-length dimension (above-grade + embed), fills left third
    const totalPostFt = (grade - postTopY) / vft + embedFt;
    const xL = leftPost - 34;
    els.push(`<line x1="${xL.toFixed(1)}" y1="${postTopY.toFixed(1)}" x2="${xL.toFixed(1)}" y2="${(grade + embedPx).toFixed(1)}" stroke="#333" stroke-width="0.8"/>`);
    els.push(`<line x1="${(xL - 4).toFixed(1)}" y1="${postTopY.toFixed(1)}" x2="${(xL + 4).toFixed(1)}" y2="${postTopY.toFixed(1)}" stroke="#333" stroke-width="0.8"/>`);
    els.push(`<line x1="${(xL - 4).toFixed(1)}" y1="${(grade + embedPx).toFixed(1)}" x2="${(xL + 4).toFixed(1)}" y2="${(grade + embedPx).toFixed(1)}" stroke="#333" stroke-width="0.8"/>`);
    els.push(drawText(xL - 6, (postTopY + grade + embedPx) / 2, `${totalPostFt.toFixed(1)}' POST L.`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#333', rotate: -90 }));

    // Right: FENCE SECTION NOTES panel, fills the right third
    const npX = secX + secW * 0.54;
    const npW = secX + secW - 16 - npX;
    const npTop = innerTop + 4;
    els.push(drawRectFilled(npX, npTop, npW, 13, '#1a2332', '#1a2332', 0));
    els.push(drawText(npX + 6, npTop + 9.3, 'FENCE SECTION NOTES', { anchor: 'start', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));
    const secNotes = [
      `Modules mounted 90° VERTICAL, side-by-side — ${panelHtFt.toFixed(1)}' panel height above grade.`,
      `${rails}-rail SolFence vertical section system; posts @ ${postSpFt.toFixed(0)}' O.C. (93-3/4" c-c).`,
      `Foundation: 2-7/8"⌀ × ${SOLFENCE_SECTION.innerPostLenIn}" inner steel post driven ${embedFt.toFixed(1)}' min — NO concrete; 4"⌀ outer post.`,
      'Field-verify post size + driven depth to refusal per geotech.',
      'Bond all posts, rails + frames to EGC — min #6 AWG Cu (NEC 250.166).',
      `Wind design per ${_asceFp}; verify exposure category on site.`,
      'All dimensions NTS — verify in field.',
    ];
    let sny = npTop + 20;
    secNotes.forEach((n, i) => {
      els.push(drawText(npX + 5, sny + 6, `${i + 1}.`, { anchor: 'start', fontSize: 6.3, fontWeight: 'bold', fill: '#1a2332' }));
      els.push(drawText(npX + 15, sny + 6, n, { anchor: 'start', fontSize: 6.3, fill: '#333' }));
      sny += 13;
    });

    els.push(drawText(secX + secW * 0.34, secY + secH - 1,
      'DRIVEN STEEL POST — NO CONCRETE · MODULES 90° VERTICAL · FIELD-VERIFY EMBEDMENT', {
        anchor: 'middle', fontSize: 6.3, fill: '#888', italic: true }));
  }

  // ── Data zone — segment schedule (STEP 8: fence-specific only) ──
  const dZone = zones.data;
  const schedX = dZone.x;
  let schedY = dZone.y + 4;

  // Schedule header
  els.push(drawRectFilled(schedX, schedY, dZone.width, 14, '#000', '#000', 0));
  els.push(drawText(schedX + dZone.width / 2, schedY + 9.5,
    'FENCE SEGMENT SCHEDULE', {
      anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#fff',
    }));
  schedY += 16;

  // Column headers
  const colW = [22, 62, 30, 28];  // ID, LENGTH, PANELS, AZIMUTH
  const colX = [schedX + 2, schedX + 26, schedX + 90, schedX + 122];
  const hdrs = ['#', 'LENGTH', 'PANELS', 'AZ°'];
  els.push(drawRectFilled(schedX, schedY, dZone.width, 11, '#334', '#334', 0));
  hdrs.forEach((h, hi) => {
    els.push(drawText(colX[hi] + colW[hi] / 2, schedY + 7.5, h, {
      anchor: 'middle', fontSize: 6.5, fill: '#fff', fontWeight: 'bold',
    }));
  });
  schedY += 13;

  // Segment rows
  segments.forEach((seg: any, i: number) => {
    // Same geometry-derived length fallback as the drawing (never 0 when the
    // segment spans real start/end coords).
    const _sx = seg.startX ?? seg.startPoint?.x ?? 0, _sy = seg.startY ?? seg.startPoint?.y ?? 0;
    const _ex = seg.endX ?? seg.endPoint?.x ?? 0,     _ey = seg.endY ?? seg.endPoint?.y ?? 0;
    const lenFt    = seg.lengthFt ?? (seg.lengthM != null ? metersToFt(seg.lengthM) : metersToFt(Math.hypot(_ex - _sx, _ey - _sy)));
    const panCount = seg.panelCount ?? 0;
    const azDeg    = (seg.azimuth ?? 0).toFixed(0);
    const segLabel = seg.label ?? seg.id ?? `S${i + 1}`;
    const bg       = i % 2 === 0 ? '#fff' : '#f5f5f5';

    els.push(drawRectFilled(schedX, schedY, dZone.width, 11, bg, '#ddd', 0.5));
    // Color swatch
    els.push(`<rect x="${schedX + 1}" y="${schedY + 2}" width="6" height="7"
      fill="${segColor(i)}" rx="1"/>`);
    els.push(drawText(colX[0] + 9, schedY + 7.5, escapeXml(String(segLabel)), {
      anchor: 'middle', fontSize: 6.5, fill: '#111',
    }));
    els.push(drawText(colX[1] + colW[1] / 2, schedY + 7.5, ftToFtIn(lenFt), {
      anchor: 'middle', fontSize: 6.5, fill: '#111',
    }));
    els.push(drawText(colX[2] + colW[2] / 2, schedY + 7.5, String(panCount), {
      anchor: 'middle', fontSize: 6.5, fill: '#111',
    }));
    els.push(drawText(colX[3] + colW[3] / 2, schedY + 7.5, azDeg + '°', {
      anchor: 'middle', fontSize: 6.5, fill: '#111',
    }));
    schedY += 12;
  });

  // Totals row
  schedY += 2;
  els.push(drawRectFilled(schedX, schedY, dZone.width, 12, '#eef', '#aab', 1));
  els.push(drawText(schedX + 4, schedY + 8, 'TOTAL:', {
    anchor: 'start', fontSize: 6.5, fill: '#000', fontWeight: 'bold',
  }));
  els.push(drawText(colX[1] + colW[1] / 2, schedY + 8, ftToFtIn(totalLengthFt), {
    anchor: 'middle', fontSize: 6.5, fill: '#000', fontWeight: 'bold',
  }));
  els.push(drawText(colX[2] + colW[2] / 2, schedY + 8, String(totalPanels), {
    anchor: 'middle', fontSize: 6.5, fill: '#000', fontWeight: 'bold',
  }));
  schedY += 16;

  // System summary
  els.push(drawText(schedX + 2, schedY, `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`, {
    anchor: 'start', fontSize: 7, fill: '#2255aa', fontWeight: 'bold',
  }));
  schedY += 11;
  els.push(drawText(schedX + 2, schedY, `TOTAL: ${ftToFtIn(totalLengthFt)} L.F.`, {
    anchor: 'start', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));
  schedY += 16;

  // v47.307: UTILITY ANALYSIS block (Bill Intelligence Layer — rendered if ctx present)
  if (ctx) {
    const utilSvg = drawUtilityAnalysis(ctx, schedX, schedY, dZone.width);
    if (utilSvg) els.push(utilSvg);
  }

  // Bottom note
  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    'SITE PLAN — FIELD VERIFY ALL SEGMENT LENGTHS AND AZIMUTH — SEE PV-3 FOR STRUCTURAL', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// drawFenceElevation — PV-3 Structural Elevation (MANDATORY PRIMARY)
// STEP 2: Fence elevation is the mandatory primary view.
// STEP 7: Full structural realism — posts above+below grade, panels,
//         rails, wind arrows, 3-level dimension hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export function drawFenceElevation(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { layout, engineering, project } = input;
  const _asceEl = projectCodeAuthority(ctx?.snapshot).asceLabel;   // W4 §2 code editions

  // ── STEP 4: CAD is the ONLY source of truth ──
  const cadFence = cad?.fence;

  if (!cadFence && !layout.fenceSegments?.length) {
    throw new Error(
      '[drawFenceElevation] No fence data. solar_fence requires cad.fence model.'
    );
  }

  // Fence geometry from CAD
  const postSpacingFt  = cadFence ? metersToFt(cadFence.postSpacingM)  : (layout.fencePostSpacingFt  ?? 8);
  const postEmbedFt    = cadFence ? metersToFt(cadFence.postEmbedM)    : (layout.fencePostEmbedmentFt ?? 3.5);
  const panelHeightFt  = cadFence ? metersToFt(cadFence.panelHeightM)  : (layout.fencePanelHeightFt  ?? 6);
  const railCount      = cadFence?.railCount ?? layout.fenceRailCount ?? 2;
  const totalLengthFt  = cadFence ? metersToFt(cadFence.totalLengthM) : (layout.fenceTotalLengthFt ?? 0);
  const totalPanels    = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw           = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;
  // Wave 6.2 (punch 1b): the elevation's WIND callout/schedule row must agree
  // with the FENCE DATA zone (sheetComposition.getFenceData), which reads the
  // REAL design wind from compliance.structural.wind.windSpeed first. The
  // canonical site block carries that same value (buildCanonical:
  // site.windSpeed = structural wind || ahj || project). The old chain fell
  // straight to a hardcoded 90 while FENCE DATA said 115 MPH Vult (Stowell).
  const _canonWind     = Number((project as unknown as {
    _canonical?: { site?: { windSpeed?: number } };
  })?._canonical?.site?.windSpeed) || 0;
  const windSpeedMph   = engineering.windSpeedMph
    ?? (_canonWind > 0 ? _canonWind : undefined)
    ?? project?.ahjWindSpeedMph
    ?? 115;   // same last-resort default as getFenceData — never a private 90
  const groundSnowPsf  = engineering.groundSnowPsf  ?? project?.ahjGroundSnowPsf  ?? 0;
  // Wave 6.1 (punch 1a): fence-system name from the sub's own equipment —
  // never the raw project-wide mountingSystem scalar (roof racking leak).
  const mountSys       = resolveFenceMountName(project as unknown as Record<string, unknown>).toUpperCase();

  // First segment for display (show 2 full bays)
  const segments: any[] = cadFence?.segments ?? layout.fenceSegments ?? [];
  const firstSeg = segments[0];
  const firstSegLabel = firstSeg?.label ?? firstSeg?.id ?? 'SEG-1';

  // Panel dimensions from project or defaults (66" x 40" standard)
  const panelLenIn  = project?.panelLengthIn ?? 66;
  const panelWidIn  = project?.panelWidthIn  ?? 40;

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('solar_fence', 'elevation');
  const W = zones.canvas.width;
  const H = zones.canvas.height;

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#fafafa'));
  // Wave 6.2 (punch 1c): the drawing shows a TYPICAL 2-bay section — the old
  // header read as if the whole fence were the drawn ~16' width; name the
  // full run length so the detail can't be mistaken for the total extent.
  els.push(drawTitleBar(W,
    `SOLAR FENCE — TYPICAL 2-BAY ELEVATION + POST DETAIL (${ftToFtIn(totalLengthFt)} L.F. TOTAL RUN)`,
    'SCALE: 1/2"=1\'-0" — TYP. SECTION'));

  const dz = zones.draw;
  const SF = SOLFENCE_SECTION;
  const ratings = solfenceRatings();

  // ══ BAND 1 (top ~58% of the draw zone): TYPICAL 2-BAY ELEVATION ══════════
  // ══ BAND 2 (bottom ~40%): SOLFENCE VERTICAL BIFACIAL SECTION (mfr detail) ═
  // The old single-band layout left ~25% dead white under the grade line —
  // page-fill mandate: the lower band now carries the manufacturer's own
  // section detail (telescoping post system) at readable scale.
  const band1H = Math.round(dz.height * 0.58);

  // ── Scale computation (band 1) ──
  // Show 2 bays: width = 2 × postSpacingFt, height = panelHeight + embed
  const totalHeightFt  = panelHeightFt + 0.5 + postEmbedFt;
  const elevWidthFt    = postSpacingFt * 2;     // 2-bay section
  const FT_PX_X        = (dz.width  - 170) / elevWidthFt;
  const FT_PX_Y        = (band1H - 66) / totalHeightFt;
  const FT_PX          = Math.min(FT_PX_X, FT_PX_Y, 40);

  const originX = dz.x + 30;
  const groundY = dz.y + 26 + (panelHeightFt + 0.5) * FT_PX;

  // Coordinate helpers
  const toX = (ft: number) => originX + ft * FT_PX;
  const toYa = (ft: number) => groundY - ft * FT_PX;   // above grade (up)
  const toYb = (ft: number) => groundY + ft * FT_PX;   // below grade (down)

  // ── STEP 7: Ground plane (CAD structural convention — no sky/soil color) ──
  // A PE elevation is monochrome line-art: a bold GRADE line with a thin band of
  // standard earth hatch just below it — not a colored sky/soil rendering.
  const gradeX2 = originX + elevWidthFt * FT_PX + 42;
  const earthBandH = 14;
  els.push(`<rect x="${dz.x}" y="${groundY.toFixed(1)}" width="${(gradeX2 - dz.x).toFixed(1)}" height="${earthBandH}" fill="url(#hatch-earth)"/>`);
  // Bold grade line + short earth ticks below (ANSI grade symbol).
  els.push(`<line x1="${dz.x}" y1="${groundY.toFixed(1)}" x2="${gradeX2.toFixed(1)}" y2="${groundY.toFixed(1)}" stroke="#111" stroke-width="1.6"/>`);
  for (let hx = dz.x + 4; hx < gradeX2; hx += 11) {
    els.push(`<line x1="${hx.toFixed(1)}" y1="${groundY.toFixed(1)}" x2="${(hx - 6).toFixed(1)}" y2="${(groundY + 6).toFixed(1)}" stroke="#111" stroke-width="0.6"/>`);
  }
  els.push(drawText(gradeX2 + 4, groundY + 3, 'GRADE', {
    anchor: 'start', fontSize: 7, fill: '#111', fontWeight: 'bold',
  }));

  // ── 3 posts (2 full bays) — SolFence TELESCOPING post system ──────────────
  // Manufacturer section (SOLFENCE_SECTION): a 4"⌀ outer aluminum post sleeved
  // over a 2-7/8"⌀ × 96" inner steel post driven 48" (no concrete). The inner
  // post extends 48" up INSIDE the outer post → drawn dashed (hidden) above
  // grade, dashed (buried) below grade.
  const nPosts = 3;
  const postWPx  = Math.max((SF.outerPostDiaIn / 12) * FT_PX, 6);   // 4"⌀ outer
  const pileWPx  = Math.max((SF.innerPostDiaIn / 12) * FT_PX, 4);   // 2-7/8"⌀ inner
  const innerUpFt = (SF.innerPostLenIn - SF.innerPostEmbedIn) / 12; // 48" above grade
  const postPositions: number[] = [];
  for (let p = 0; p < nPosts; p++) {
    postPositions.push(p * postSpacingFt);
  }

  postPositions.forEach((posFt, pi) => {
    const px = toX(posFt);
    const pBotY = toYb(postEmbedFt);

    // ── Below grade: 2-7/8"⌀ inner steel post, DRIVEN (dashed = buried),
    //    driven point at the tip. NO concrete footing. ──
    const pileTopY = groundY - 1;
    const pileShaftBot = pBotY - pileWPx * 0.9;   // leave room for the driven tip
    els.push(`<rect x="${(px - pileWPx/2).toFixed(1)}" y="${pileTopY.toFixed(1)}" width="${pileWPx.toFixed(1)}" height="${(pileShaftBot - pileTopY).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="0.9" stroke-dasharray="4,2"/>`);
    // Driven chisel point
    els.push(`<path d="M ${(px - pileWPx/2).toFixed(1)} ${pileShaftBot.toFixed(1)} L ${px.toFixed(1)} ${pBotY.toFixed(1)} L ${(px + pileWPx/2).toFixed(1)} ${pileShaftBot.toFixed(1)} Z" fill="#ffffff" stroke="#111" stroke-width="0.9" stroke-dasharray="4,2"/>`);

    // ── Above grade: 4"⌀ outer aluminum post (outline + steel hatch) ──
    const pTopY = toYa(panelHeightFt + 0.5);   // extends slightly above panel top
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx.toFixed(1)}" height="${(groundY - pTopY).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx.toFixed(1)}" height="${(groundY - pTopY).toFixed(1)}" fill="url(#hatch-steel)"/>`);
    // Inner steel post hidden INSIDE the outer sleeve (48" above grade, dashed)
    const innerTopY = toYa(Math.min(innerUpFt, panelHeightFt));
    els.push(`<line x1="${(px - pileWPx/2).toFixed(1)}" y1="${innerTopY.toFixed(1)}" x2="${(px - pileWPx/2).toFixed(1)}" y2="${groundY.toFixed(1)}" stroke="#111" stroke-width="0.7" stroke-dasharray="3,2"/>`);
    els.push(`<line x1="${(px + pileWPx/2).toFixed(1)}" y1="${innerTopY.toFixed(1)}" x2="${(px + pileWPx/2).toFixed(1)}" y2="${groundY.toFixed(1)}" stroke="#111" stroke-width="0.7" stroke-dasharray="3,2"/>`);
    els.push(`<line x1="${(px - pileWPx/2).toFixed(1)}" y1="${innerTopY.toFixed(1)}" x2="${(px + pileWPx/2).toFixed(1)}" y2="${innerTopY.toFixed(1)}" stroke="#111" stroke-width="0.7" stroke-dasharray="3,2"/>`);

    // Post cap
    els.push(`<rect x="${(px - postWPx/2 - 2).toFixed(1)}" y="${(pTopY - 5).toFixed(1)}" width="${(postWPx + 4).toFixed(1)}" height="5" fill="#ffffff" stroke="#111" stroke-width="0.9"/>`);

    // Labels (middle post only, to avoid clutter)
    if (pi === 1) {
      els.push(drawText(px, pTopY - 8, '4"⌀ OUTER POST (TYP.)', {
        anchor: 'middle', fontSize: 6.5, fill: '#333', fontWeight: 'bold',
      }));
      els.push(drawText(px + pileWPx / 2 + 3, toYb(postEmbedFt * 0.5),
        `2-7/8"⌀ × ${SF.innerPostLenIn}" INNER STEEL POST — DRIVEN (NO CONCRETE)`, {
          anchor: 'start', fontSize: 5.4, fill: '#555', italic: true,
        }));
    }
  });

  // ── PV panels — SolFence 90° VERTICAL mount ──
  // Modules stand STRAIGHT UP (portrait, full fence height) and sit SIDE BY
  // SIDE within each bay — they are NEVER stacked in rows. A SolFence 8' section
  // carries 2 modules; the count per bay is derived from module width vs the
  // clear bay width.
  const panelWidFt = panelWidIn / 12;             // module WIDTH (short dim) → horizontal
  const panelBotY  = toYa(0) - 2;                 // ~2" ground clearance
  const panelTopY  = toYa(panelHeightFt) + 2;
  const midRailY   = (panelTopY + panelBotY) / 2; // mid rail at panel mid-height

  for (let bay = 0; bay < 2; bay++) {
    const bayX1 = toX(postPositions[bay]) + postWPx / 2 + 3;
    const bayX2 = toX(postPositions[bay + 1]) - postWPx / 2 - 3;
    const bayW  = bayX2 - bayX1;

    const panelsPerBay = Math.max(1, Math.min(3,
      Math.round(bayW / Math.max(panelWidFt * FT_PX, 1))));
    const gap  = 3;
    const panW = (bayW - gap * (panelsPerBay - 1)) / panelsPerBay;
    const panH = Math.max(panelBotY - panelTopY, 4);

    // Pre-built section perimeter channel (side channels + top/bottom rails)
    els.push(`<rect x="${(bayX1 - 2).toFixed(1)}" y="${(panelTopY - 2).toFixed(1)}" width="${(bayW + 4).toFixed(1)}" height="${(panH + 4).toFixed(1)}" fill="none" stroke="#111" stroke-width="1.4"/>`);

    for (let pv = 0; pv < panelsPerBay; pv++) {
      const pvX = bayX1 + pv * (panW + gap);

      // Module — CAD line-art: aluminum frame (double line), white glazing,
      // thin cell/mullion grid. No glass gradient (this is an engineering
      // elevation, not a product render).
      els.push(`<rect x="${pvX.toFixed(1)}" y="${panelTopY.toFixed(1)}" width="${panW.toFixed(1)}" height="${panH.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.1"/>`);
      els.push(`<rect x="${(pvX + 1.6).toFixed(1)}" y="${(panelTopY + 1.6).toFixed(1)}" width="${(panW - 3.2).toFixed(1)}" height="${(panH - 3.2).toFixed(1)}" fill="none" stroke="#111" stroke-width="0.5"/>`);

      // Portrait cell grid — center mullion (2 cols) + 6 rows, thin gray CAD lines
      if (panW > 8) {
        els.push(`<line x1="${(pvX + panW/2).toFixed(1)}" y1="${(panelTopY + 1.6).toFixed(1)}" x2="${(pvX + panW/2).toFixed(1)}" y2="${(panelTopY + panH - 1.6).toFixed(1)}" stroke="#6b7280" stroke-width="0.5"/>`);
      }
      if (panH > 12) {
        const rows = 6;
        for (let r = 1; r < rows; r++) {
          const ly = panelTopY + 1.6 + (panH - 3.2) * r / rows;
          els.push(`<line x1="${(pvX + 1.6).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(pvX + panW - 1.6).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#9ca3af" stroke-width="0.4"/>`);
        }
      }
    }

    // Mid rail (2"×1" — SOLFENCE_SECTION) across the bay at panel mid-height
    const mrH = Math.max((SF.midRailTallIn / 12) * FT_PX, 2.4);
    els.push(`<rect x="${bayX1.toFixed(1)}" y="${(midRailY - mrH / 2).toFixed(1)}" width="${bayW.toFixed(1)}" height="${mrH.toFixed(1)}" fill="#d8dce2" stroke="#111" stroke-width="0.8"/>`);

    // Bay label (inside, bottom)
    const cx = (bayX1 + bayX2) / 2;
    els.push(drawText(cx, panelBotY - 4, `BAY ${bay + 1}`, {
      anchor: 'middle', fontSize: 6.5, fill: '#111', fontWeight: 'bold',
    }));
  }
  // Mid-rail callout label (once, right of bay 2 — dropped BELOW the wind
  // arrow, which sits at the same panel mid-height)
  els.push(`<line x1="${(toX(elevWidthFt) + postWPx / 2 + 1).toFixed(1)}" y1="${midRailY.toFixed(1)}" x2="${(toX(elevWidthFt) + postWPx / 2 + 10).toFixed(1)}" y2="${(midRailY + 16).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
  els.push(drawText(toX(elevWidthFt) + postWPx / 2 + 12, midRailY + 20,
    `MID RAIL ${SF.midRailTallIn}"×${SF.midRailDeepIn}"`, {
      anchor: 'start', fontSize: 5.6, fill: '#333',
    }));

  // ── STEP 7: Wind load arrows ──
  const arrowTopY    = toYa(panelHeightFt / 2);
  const arrowRightX  = toX(elevWidthFt) + 20;

  // Wind: horizontal arrow pointing left (into panel face)
  els.push(drawWindArrow(
    arrowRightX + 28, arrowTopY,
    28, 'left',
    `WIND ${windSpeedMph} MPH`
  ));

  // Dead load arrow (gravity, pointing down) — over bay 1, clear of the
  // middle-post label.
  const dlArrowX = toX(postSpacingFt * 0.5);   // mid-bay 1
  els.push(drawWindArrow(
    dlArrowX, panelTopY - 20,
    16, 'down',
    'DL'
  ));

  // ── STEP 7: 3-level dimension hierarchy ──

  // L1 — Overall fence height above grade (left side, vertical)
  els.push(drawVerticalDimension(
    originX - 42, groundY, toYa(panelHeightFt),
    18, ftToFtIn(panelHeightFt) + ' PANEL HT.'
  ));

  // L1 — Post embedment below grade (left side, below ground)
  els.push(drawVerticalDimension(
    originX - 42, groundY, toYb(postEmbedFt),
    18, ftToFtIn(postEmbedFt) + ' EMBED'
  ));

  // L1 — Overall height (post top to bottom of embed)
  els.push(drawVerticalDimension(
    originX - 62, toYa(panelHeightFt + 0.5), toYb(postEmbedFt),
    20, ftToFtIn(panelHeightFt + postEmbedFt + 0.5) + ' POST L.'
  ));

  // L2 — Post spacing (bottom, horizontal)
  els.push(drawLinearDimension(
    toX(0), toX(postSpacingFt),
    groundY + postEmbedFt * FT_PX + 18,
    12, ftToFtIn(postSpacingFt) + ' O.C.'
  ));

  // L2 — Overall 2-bay width (TYP. — the drawn section, never the total run)
  els.push(drawOverallDimension(
    toX(0), toX(elevWidthFt),
    groundY + postEmbedFt * FT_PX + 32,
    16, ftToFtIn(elevWidthFt) + ' — 2 BAYS (TYP. OF ' + ftToFtIn(totalLengthFt) + ' RUN)'
  ));

  // ══ BAND 2: SOLFENCE VERTICAL BIFACIAL SECTION — manufacturer detail ══════
  // Mirrors SolFence's own published section (SOLFENCE_SECTION record): one
  // bay at inch precision — telescoping posts, stiffeners, mid rail, dims.
  {
    const secY = dz.y + band1H + 14;
    const secH = dz.y + dz.height - secY - 4;
    // Header bar
    els.push(drawRectFilled(dz.x, secY, dz.width, 13, '#1a2332', '#1a2332', 0));
    els.push(drawText(dz.x + 6, secY + 9.3,
      `SOLFENCE VERTICAL BIFACIAL SECTION — MFR DETAIL · ${Math.round(SF.panelTallIn / 12)}' H × 8' W (${SF.panelTallIn}" TALL × ${SF.bayWideIn}" WIDE BAY)`, {
        anchor: 'start', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));

    const innerTop = secY + 13;
    const innerH   = secH - 13;
    // Vertical inch scale: 74" above grade (72" panel + clearance) + 48" embed
    const aboveIn = SF.panelTallIn + 4;                    // panel + cap/clearance
    const belowIn = SF.innerPostEmbedIn;
    const IN_PX   = Math.min((innerH - 46) / (aboveIn + belowIn), 2.2);
    const sGrade  = innerTop + 24 + aboveIn * IN_PX;
    const bayWpx  = SF.postCcIn * IN_PX;
    const sCx     = dz.x + 60 + bayWpx / 2;                // bay center
    const sL      = sCx - bayWpx / 2, sR = sCx + bayWpx / 2;   // post centers
    const oPost   = Math.max(SF.outerPostDiaIn * IN_PX, 5);
    const iPost   = Math.max(SF.innerPostDiaIn * IN_PX, 3.4);
    const sPanTop = sGrade - (SF.panelTallIn + 2) * IN_PX;
    const sPanBot = sGrade - 2 * IN_PX;
    const sMidY   = (sPanTop + sPanBot) / 2;

    // Grade line + earth hatch
    els.push(`<rect x="${(dz.x + 16).toFixed(1)}" y="${sGrade.toFixed(1)}" width="${(bayWpx + 120).toFixed(1)}" height="10" fill="url(#hatch-earth)"/>`);
    els.push(`<line x1="${(dz.x + 16).toFixed(1)}" y1="${sGrade.toFixed(1)}" x2="${(dz.x + 136 + bayWpx).toFixed(1)}" y2="${sGrade.toFixed(1)}" stroke="#111" stroke-width="1.4"/>`);
    els.push(drawText(dz.x + 140 + bayWpx, sGrade + 3, 'GROUND LEVEL', { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#111' }));

    // Posts (outer above grade, inner dashed inside + below)
    for (const px of [sL, sR]) {
      const capTop = sPanTop - 6;
      // outer post
      els.push(`<rect x="${(px - oPost / 2).toFixed(1)}" y="${capTop.toFixed(1)}" width="${oPost.toFixed(1)}" height="${(sGrade - capTop).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.1"/>`);
      els.push(`<rect x="${(px - oPost / 2).toFixed(1)}" y="${capTop.toFixed(1)}" width="${oPost.toFixed(1)}" height="${(sGrade - capTop).toFixed(1)}" fill="url(#hatch-steel)"/>`);
      els.push(`<rect x="${(px - oPost / 2 - 1.6).toFixed(1)}" y="${(capTop - 4).toFixed(1)}" width="${(oPost + 3.2).toFixed(1)}" height="4" fill="#fff" stroke="#111" stroke-width="0.8"/>`);
      // inner steel post: dashed inside outer (48" up) + dashed below grade (48")
      const iTop = sGrade - (SF.innerPostLenIn - SF.innerPostEmbedIn) * IN_PX;
      const iBot = sGrade + SF.innerPostEmbedIn * IN_PX;
      els.push(`<rect x="${(px - iPost / 2).toFixed(1)}" y="${iTop.toFixed(1)}" width="${iPost.toFixed(1)}" height="${(iBot - iTop).toFixed(1)}" fill="none" stroke="#111" stroke-width="0.8" stroke-dasharray="3,2"/>`);
      // stiffener plates (4"×4") at mid-rail + panel-bottom connections
      const stif = Math.max(SF.stiffenerIn * IN_PX, 4);
      for (const sy of [sMidY, sPanBot - stif / 2]) {
        els.push(`<rect x="${(px - stif / 2).toFixed(1)}" y="${(sy - stif / 2).toFixed(1)}" width="${stif.toFixed(1)}" height="${stif.toFixed(1)}" fill="#e8e8e8" stroke="#111" stroke-width="0.8"/>`);
      }
    }

    // Section frame + 2 modules (bifacial rows drawn as horizontal cell lines)
    const fInL = sL + oPost / 2 + 2, fInR = sR - oPost / 2 - 2;
    els.push(`<rect x="${fInL.toFixed(1)}" y="${sPanTop.toFixed(1)}" width="${(fInR - fInL).toFixed(1)}" height="${(sPanBot - sPanTop).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
    const halfW = (fInR - fInL - 3) / 2;
    for (let m = 0; m < 2; m++) {
      const mx = fInL + 1 + m * (halfW + 1.5);
      els.push(`<rect x="${mx.toFixed(1)}" y="${(sPanTop + 1.5).toFixed(1)}" width="${halfW.toFixed(1)}" height="${(sPanBot - sPanTop - 3).toFixed(1)}" fill="none" stroke="#111" stroke-width="0.6"/>`);
      const nLines = 14;
      for (let r = 1; r < nLines; r++) {
        const ly = sPanTop + 1.5 + (sPanBot - sPanTop - 3) * r / nLines;
        els.push(`<line x1="${(mx + 1).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(mx + halfW - 1).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#8b93a0" stroke-width="0.45"/>`);
      }
    }
    // Mid rail across the section
    const mrPx = Math.max(SF.midRailTallIn * IN_PX, 2.2);
    els.push(`<rect x="${fInL.toFixed(1)}" y="${(sMidY - mrPx / 2).toFixed(1)}" width="${(fInR - fInL).toFixed(1)}" height="${mrPx.toFixed(1)}" fill="#d8dce2" stroke="#111" stroke-width="0.8"/>`);

    // ── Dimensions (manufacturer inch callouts) ──
    const fmtDim = (label: string) => label;
    // Top: post c-c + rail cut
    const dimY1 = innerTop + 8, dimY2 = innerTop + 17;
    els.push(`<line x1="${sL.toFixed(1)}" y1="${dimY1.toFixed(1)}" x2="${sR.toFixed(1)}" y2="${dimY1.toFixed(1)}" stroke="#c00" stroke-width="0.8"/>`);
    els.push(`<line x1="${sL.toFixed(1)}" y1="${(dimY1 - 3).toFixed(1)}" x2="${sL.toFixed(1)}" y2="${(sPanTop - 8).toFixed(1)}" stroke="#c00" stroke-width="0.5"/>`);
    els.push(`<line x1="${sR.toFixed(1)}" y1="${(dimY1 - 3).toFixed(1)}" x2="${sR.toFixed(1)}" y2="${(sPanTop - 8).toFixed(1)}" stroke="#c00" stroke-width="0.5"/>`);
    els.push(drawText(sCx, dimY1 - 2, fmtDim('93-3/4" CENTER-CENTER (4"⌀ OUTER POST)'), { anchor: 'middle', fontSize: 6, fontWeight: 'bold', fill: '#c00' }));
    els.push(drawText(sCx, dimY2 + 5, fmtDim('93-5/8" RAIL CUT LENGTH'), { anchor: 'middle', fontSize: 5.6, fill: '#c00' }));

    // Left: 72" panel height
    const ldx = sL - oPost / 2 - 16;
    els.push(`<line x1="${ldx.toFixed(1)}" y1="${sPanTop.toFixed(1)}" x2="${ldx.toFixed(1)}" y2="${sPanBot.toFixed(1)}" stroke="#036" stroke-width="0.8"/>`);
    els.push(`<line x1="${(ldx - 3).toFixed(1)}" y1="${sPanTop.toFixed(1)}" x2="${(ldx + 3).toFixed(1)}" y2="${sPanTop.toFixed(1)}" stroke="#036" stroke-width="0.7"/>`);
    els.push(`<line x1="${(ldx - 3).toFixed(1)}" y1="${sPanBot.toFixed(1)}" x2="${(ldx + 3).toFixed(1)}" y2="${sPanBot.toFixed(1)}" stroke="#036" stroke-width="0.7"/>`);
    els.push(drawText(ldx - 4, (sPanTop + sPanBot) / 2, `${SF.panelTallIn}" PANEL`, { anchor: 'middle', fontSize: 6, fontWeight: 'bold', fill: '#036', rotate: -90 }));

    // Right: 96" inner post = 48" up + 48" embed
    const rdx = sR + oPost / 2 + 18;
    const iTopR = sGrade - (SF.innerPostLenIn - SF.innerPostEmbedIn) * IN_PX;
    const iBotR = sGrade + SF.innerPostEmbedIn * IN_PX;
    els.push(`<line x1="${rdx.toFixed(1)}" y1="${iTopR.toFixed(1)}" x2="${rdx.toFixed(1)}" y2="${iBotR.toFixed(1)}" stroke="#333" stroke-width="0.8"/>`);
    for (const ty of [iTopR, sGrade, iBotR]) {
      els.push(`<line x1="${(rdx - 3).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(rdx + 3).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    }
    els.push(drawText(rdx + 4, (iTopR + sGrade) / 2 + 2, '48"', { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(rdx + 4, (sGrade + iBotR) / 2 + 2, '48" EMBED', { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(rdx + 12, (iTopR + iBotR) / 2, `${SF.innerPostLenIn}" INNER STEEL POST`, { anchor: 'middle', fontSize: 5.8, fontWeight: 'bold', fill: '#333', rotate: -90 }));

    // Leader labels (left column, under grade)
    els.push(drawText(dz.x + 16, sGrade + 22, `4"×4" POST STIFFENERS (TYP)`, { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    els.push(drawText(dz.x + 16, sGrade + 31, `2-7/8"⌀ INNER STEEL POST — DRIVEN, NO CONCRETE`, { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    els.push(drawText(dz.x + 16, sGrade + 40, `4"⌀ OUTER ${ratings.material.toUpperCase().includes('ALUM') ? 'ALUMINUM' : ''} POST`, { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    // Mid-rail leader
    els.push(`<line x1="${(fInR + 2).toFixed(1)}" y1="${sMidY.toFixed(1)}" x2="${(sR + oPost / 2 + 8).toFixed(1)}" y2="${(sMidY - 14).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(sR + oPost / 2 + 10, sMidY - 16, `91-11/16" MID RAIL (${SF.midRailTallIn}" TALL × ${SF.midRailDeepIn}" DEEP)`, { anchor: 'start', fontSize: 5.6, fill: '#333' }));

    // ── Right half: SECTION COMPONENT TABLE (fills the band, CAD density) ──
    const tX = dz.x + Math.round(dz.width * 0.56);
    const tW = dz.x + dz.width - tX - 6;
    let tY = innerTop + 6;
    els.push(drawRectFilled(tX, tY, tW, 13, '#1a2332', '#1a2332', 0));
    els.push(drawText(tX + 6, tY + 9.3, 'SOLFENCE SECTION COMPONENTS', { anchor: 'start', fontSize: 7, fontWeight: '900', fill: '#fff' }));
    tY += 15;
    const compRows: Array<[string, string]> = [
      ['OUTER POST',   `4"⌀ ${ratings.material}`],
      ['INNER POST',   `2-7/8"⌀ GALV. STEEL × ${SF.innerPostLenIn}"`],
      ['FOUNDATION',   `DRIVEN ${SF.innerPostEmbedIn}" MIN — NO CONCRETE`],
      ['POST SPACING', `93-3/4" C-C (${ftToFtIn(postSpacingFt)} NOM.)`],
      ['MID RAIL',     `${SF.midRailTallIn}"×${SF.midRailDeepIn}" × 91-11/16" CUT`],
      ['STIFFENERS',   `4"×4" PLATE (TYP AT RAIL CONN.)`],
      ['SECTION',      `${Math.round(SF.panelTallIn / 12)}' H × 8' W — ${SF.bayWideIn}" BAY, 2 MODULES`],
      ['MODULE',       `${panelLenIn}" × ${panelWidIn}" GLASS-GLASS BIFACIAL`],
      ['RATED',        `${ratings.windMph} MPH WIND · ${ratings.snowPsf} PSF`],
    ];
    compRows.forEach(([k, v], i) => {
      const bg = i % 2 === 0 ? '#fff' : '#f2f4f8';
      els.push(drawRectFilled(tX, tY, tW, 12, bg, '#d5d9e2', 0.5));
      els.push(drawText(tX + 4, tY + 8.5, k, { anchor: 'start', fontSize: 6, fontWeight: 'bold', fill: '#1a2332' }));
      els.push(drawText(tX + 92, tY + 8.5, v, { anchor: 'start', fontSize: 6, fill: '#333' }));
      tY += 12;
    });
    els.push(drawText(tX, tY + 10, 'PER SOLFENCE PUBLISHED SECTION DETAIL — FIELD-VERIFY AGAINST CURRENT MFR REVISION', {
      anchor: 'start', fontSize: 5.4, italic: true, fill: '#666' }));
  }

  // ── Data zone — fence spec schedule (STEP 8: fence-only data) ──
  const dZone = zones.data;
  let ry = dZone.y + 4;

  els.push(drawRectFilled(dZone.x, ry, dZone.width, 14, '#000', '#000', 0));
  els.push(drawText(dZone.x + dZone.width / 2, ry + 9.5,
    'FENCE STRUCTURAL SCHEDULE', {
      anchor: 'middle', fontSize: 7.5, fontWeight: '900', fill: '#fff',
    }));
  ry += 16;

  // ── Callout schedule items (STEP 8: fence-specific — NO roof/ground terms) ──
  // Post/foundation lines derive from SOLFENCE_SECTION (mfr section record).
  const calloutItems = [
    { n: 1, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}" BIFACIAL — 90° VERTICAL` },
    { n: 2, label: `4"⌀ OUTER POST — ${ftToFtIn(postSpacingFt)} O.C. (93-3/4" C-C)` },
    { n: 3, label: `FOUNDATION — 2-7/8"⌀ × ${SOLFENCE_SECTION.innerPostLenIn}" INNER STEEL POST, DRIVEN ${ftToFtIn(postEmbedFt)} MIN.` },
    { n: 4, label: `PANEL HEIGHT — ${ftToFtIn(panelHeightFt)} A.G.` },
    { n: 5, label: `MID RAIL ${SOLFENCE_SECTION.midRailTallIn}"×${SOLFENCE_SECTION.midRailDeepIn}" + 4"×4" POST STIFFENERS` },
    { n: 6, label: `WIND LOAD — ${windSpeedMph} MPH (${_asceEl})` },
    { n: 7, label: `DEAD LOAD — ${((panelLenIn * panelWidIn / 144) * 3.5).toFixed(0)} LBS/PANEL EST.` },
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

  // FENCE-SPECIFIC NOTES (no roof/ground terms) — foundation text derives
  // from SOLFENCE_SECTION (mfr telescoping-post record).
  const notes = [
    { text: `FENCE SYSTEM: ${mountSys}`, bold: true },
    { text: `TOTAL: ${ftToFtIn(totalLengthFt)} L.F. FENCE`, bold: false },
    { text: `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`, bold: false },
    { text: `POST SPACING: ${ftToFtIn(postSpacingFt)} O.C. (93-3/4" C-C)`, bold: false },
    { text: `FOUNDATION: 2-7/8"⌀ INNER STEEL POST DRIVEN ${ftToFtIn(postEmbedFt)} MIN. — NO CONCRETE`, bold: false },
    { text: `4"⌀ OUTER POST OVER INNER STEEL POST (TELESCOPING)`, bold: false },
    { text: `MODULES: 90° VERTICAL, SIDE-BY-SIDE`, bold: false },
    { text: `RAILS: ${railCount}× + MID RAIL 2"×1"`, bold: false },
    { text: `RATED: ${solfenceRatings().windMph} MPH WIND / ${solfenceRatings().snowPsf} PSF`, bold: false },
    { text: `REF: NEC 690 / ${_asceEl}`, bold: false },
    { text: `INSTALLER TO VERIFY POST SIZE + DRIVEN DEPTH`, bold: true, red: true },
  ];
  notes.forEach((note, ni) => {
    els.push(drawText(dZone.x + 4, ry + ni * 10, note.text, {
      anchor: 'start',
      fontSize: 6.5,
      fill: note.red ? '#cc0000' : '#333',
      fontWeight: note.bold ? 'bold' : 'normal',
    }));
  });

  // First-segment label reference
  ry += notes.length * 10 + 8;
  els.push(drawRectFilled(dZone.x, ry, dZone.width, 24, '#eef2ff', '#8899cc', 0.8));
  els.push(drawText(dZone.x + 4, ry + 8, 'TYPICAL 2-BAY DETAIL OF:', {
    anchor: 'start', fontSize: 6.5, fill: '#333',
  }));
  els.push(drawText(dZone.x + 4, ry + 18,
    `${ftToFtIn(totalLengthFt)} RUN — ${firstSegLabel} (${segments.length} SEG TOTAL)`, {
      anchor: 'start', fontSize: 7, fill: '#2255aa', fontWeight: 'bold',
    }));
  ry += 32;

  // v47.307: UTILITY ANALYSIS block (Bill Intelligence Layer)
  if (ctx) {
    const utilSvg = drawUtilityAnalysis(ctx, dZone.x, ry, dZone.width);
    if (utilSvg) els.push(utilSvg);
  }

  // Bottom note
  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    'STRUCTURAL ELEVATION — VERIFY POST SIZE, SPACING + EMBEDMENT IN FIELD — ALL DIMS NTS', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// PV-3F — SOLAR FENCE STRUCTURAL DETAILS
// A real connection/foundation detail sheet — NOT a second 2-bay elevation (that
// lives on PV-1F) and NOT the degenerate top-down of vertical panels Ray flagged.
// Four standard details in a 2×2 grid: post foundation section, rail-to-post
// connection, panel-to-rail clamp, and equipment bonding.
// ═══════════════════════════════════════════════════════════════════════════
export function drawFenceStructural(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { engineering, project, layout } = input;
  const _asceSt = projectCodeAuthority(ctx?.snapshot).asceLabel;   // W4 §2 code editions
  const cadFence = cad?.fence;
  const postSpacingFt = cadFence ? metersToFt(cadFence.postSpacingM) : (layout.fencePostSpacingFt ?? 8);
  const postEmbedFt   = cadFence ? metersToFt(cadFence.postEmbedM)   : (layout.fencePostEmbedmentFt ?? 3.5);
  const panelHeightFt = cadFence ? metersToFt(cadFence.panelHeightM) : (layout.fencePanelHeightFt ?? 6);
  const railCount     = cadFence?.railCount ?? layout.fenceRailCount ?? 2;
  const totalLengthFt = cadFence ? metersToFt(cadFence.totalLengthM) : (layout.fenceTotalLengthFt ?? 0);
  const totalPanels   = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw          = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;
  // W3 §7 — single-sourced from the snapshot env (115 = standalone-only guard).
  const windSpeedMph  = projectStructural(ctx?.snapshot).windSpeedMph ?? engineering.windSpeedMph ?? project?.ahjWindSpeedMph ?? 115;
  const mountSys      = resolveFenceMountName(project as unknown as Record<string, unknown>).toUpperCase();
  const panelLenIn    = project?.panelLengthIn ?? 66;
  const panelWidIn    = project?.panelWidthIn  ?? 40;

  const zones = getLayoutForSystem('solar_fence', 'structural');
  const W = zones.canvas.width, H = zones.canvas.height;
  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#fafafa'));
  els.push(drawTitleBar(W,
    'SOLAR FENCE — CONNECTION & FOUNDATION DETAILS',
    'SCALE: NTS'));

  const dz = zones.draw;
  const gapp = 12;
  const cW = (dz.width - gapp) / 2;
  const cH = (dz.height - gapp) / 2;
  const cells = [
    { x: dz.x,               y: dz.y,               t: 'A · POST FOUNDATION SECTION' },
    { x: dz.x + cW + gapp,   y: dz.y,               t: 'B · RAIL-TO-POST CONNECTION' },
    { x: dz.x,               y: dz.y + cH + gapp,   t: 'C · PANEL-TO-RAIL CLAMP' },
    { x: dz.x + cW + gapp,   y: dz.y + cH + gapp,   t: 'D · EQUIPMENT BONDING (NEC 250.169)' },
  ];
  for (const c of cells) {
    els.push(drawRectFilled(c.x, c.y, cW, cH, '#ffffff', '#c8d0e0', 1));
    els.push(drawRectFilled(c.x, c.y, cW, 14, '#1a2332', '#1a2332', 0));
    els.push(drawText(c.x + 6, c.y + 9.7, c.t, { anchor: 'start', fontSize: 7, fontWeight: '900', fill: '#fff' }));
  }

  const SF = SOLFENCE_SECTION;
  const ratings = solfenceRatings();

  // ── Detail A: TELESCOPING POST FOUNDATION SECTION ──────────────────────────
  // True SolFence foundation (SOLFENCE_SECTION): 4"⌀ outer aluminum post
  // sleeved over a 2-7/8"⌀ × 96" inner steel post driven 48" — no concrete.
  {
    const a = cells[0];
    const innerTop = a.y + 14;
    const IN = Math.min((cH - 14 - 58) / (SF.innerPostLenIn + 14), 2.4);  // px per inch
    const cx = a.x + cW * 0.42;
    const grade = innerTop + 26 + ((SF.innerPostLenIn - SF.innerPostEmbedIn) + 8) * IN;
    // Grade + earth hatch
    els.push(`<rect x="${(a.x + 12).toFixed(1)}" y="${grade.toFixed(1)}" width="${(cW - 60).toFixed(1)}" height="12" fill="url(#hatch-earth)"/>`);
    els.push(`<line x1="${(a.x + 12).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(a.x + cW - 24).toFixed(1)}" y2="${grade.toFixed(1)}" stroke="#111" stroke-width="1.4"/>`);
    els.push(drawText(a.x + cW - 22, grade + 3, 'GRADE', { anchor: 'start', fontSize: 6, fontWeight: 'bold', fill: '#111' }));
    const oW = Math.max(SF.outerPostDiaIn * IN, 9);
    const iW = Math.max(SF.innerPostDiaIn * IN, 6.4);
    const iTop = grade - (SF.innerPostLenIn - SF.innerPostEmbedIn) * IN;
    const iBot = grade + SF.innerPostEmbedIn * IN;
    const oTop = innerTop + 12;   // outer post continues up (break line)
    // Outer post (above grade, hatched) + break symbol at top
    els.push(`<rect x="${(cx - oW / 2).toFixed(1)}" y="${oTop.toFixed(1)}" width="${oW.toFixed(1)}" height="${(grade - oTop - 1).toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
    els.push(`<rect x="${(cx - oW / 2).toFixed(1)}" y="${oTop.toFixed(1)}" width="${oW.toFixed(1)}" height="${(grade - oTop - 1).toFixed(1)}" fill="url(#hatch-steel)"/>`);
    els.push(`<path d="M${(cx - oW / 2 - 4).toFixed(1)} ${(oTop + 3).toFixed(1)} l4 -3 l4 3 l4 -3 l4 3 l4 -3 l4 3" fill="none" stroke="#111" stroke-width="0.8"/>`);
    // Inner steel post — dashed inside the sleeve above grade, dashed buried below
    els.push(`<rect x="${(cx - iW / 2).toFixed(1)}" y="${iTop.toFixed(1)}" width="${iW.toFixed(1)}" height="${(iBot - iTop - 6).toFixed(1)}" fill="none" stroke="#111" stroke-width="0.9" stroke-dasharray="4,2"/>`);
    els.push(`<path d="M${(cx - iW / 2).toFixed(1)} ${(iBot - 6).toFixed(1)} L${cx.toFixed(1)} ${iBot.toFixed(1)} L${(cx + iW / 2).toFixed(1)} ${(iBot - 6).toFixed(1)} Z" fill="#fff" stroke="#111" stroke-width="0.9" stroke-dasharray="4,2"/>`);
    // Donut collar at grade (4x4 donut w/ inner hole — seats outer over inner)
    els.push(`<rect x="${(cx - oW / 2 - 2).toFixed(1)}" y="${(grade - 4).toFixed(1)}" width="${(oW + 4).toFixed(1)}" height="8" fill="#fff" stroke="#111" stroke-width="1"/>`);
    // Dims — right: 48" embed + 48" above; far right: 96" overall
    const dR = cx + oW / 2 + 24;
    els.push(`<line x1="${dR.toFixed(1)}" y1="${iTop.toFixed(1)}" x2="${dR.toFixed(1)}" y2="${iBot.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    for (const ty of [iTop, grade, iBot]) {
      els.push(`<line x1="${(dR - 3).toFixed(1)}" y1="${ty.toFixed(1)}" x2="${(dR + 3).toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#333" stroke-width="0.7"/>`);
    }
    els.push(drawText(dR + 4, (iTop + grade) / 2 + 2, '48" IN SLEEVE', { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(dR + 4, (grade + iBot) / 2 + 2, `48" (${ftToFtIn(postEmbedFt)}) MIN EMBED`, { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(dR + 58, (iTop + iBot) / 2, `${SF.innerPostLenIn}" INNER STEEL POST`, { anchor: 'middle', fontSize: 5.8, fontWeight: 'bold', fill: '#333', rotate: -90 }));
    // Labels — left leaders
    els.push(`<line x1="${(cx - oW / 2).toFixed(1)}" y1="${(oTop + 26).toFixed(1)}" x2="${(a.x + 22).toFixed(1)}" y2="${(oTop + 18).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(a.x + 20, oTop + 15, `4"⌀ OUTER POST — ${ratings.material.toUpperCase()}`, { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    els.push(`<line x1="${(cx - iW / 2).toFixed(1)}" y1="${((iTop + grade) / 2).toFixed(1)}" x2="${(a.x + 22).toFixed(1)}" y2="${((iTop + grade) / 2 - 10).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(a.x + 20, (iTop + grade) / 2 - 13, '2-7/8"⌀ INNER STEEL POST', { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    els.push(drawText(a.x + 20, (iTop + grade) / 2 - 5, '(HOT-DIP GALVANIZED)', { anchor: 'start', fontSize: 5.2, fill: '#555' }));
    els.push(`<line x1="${(cx - oW / 2 - 2).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(a.x + 22).toFixed(1)}" y2="${(grade + 18).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(a.x + 20, grade + 22, 'DONUT COLLAR W/ POST HOLE', { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    els.push(drawText(a.x + 20, grade + 44, 'DRIVEN W/ POST POUNDER', { anchor: 'start', fontSize: 5.6, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(a.x + 20, grade + 53, 'NO CONCRETE REQUIRED', { anchor: 'start', fontSize: 5.6, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(a.x + cW / 2, a.y + cH - 6, 'TELESCOPING DRIVEN POST — NO CONCRETE — FIELD-VERIFY REFUSAL', { anchor: 'middle', fontSize: 5.4, italic: true, fill: '#666' }));
  }

  // ── Detail B: SECTION-TO-POST CONNECTION (stiffeners + mid rail) ───────────
  {
    const b = cells[1];
    const cx = b.x + cW * 0.34, cyTop = b.y + 34;
    const postH = cH - 76;
    const oW = 18;
    // Outer post (elevation)
    els.push(`<rect x="${(cx - oW / 2).toFixed(1)}" y="${cyTop.toFixed(1)}" width="${oW}" height="${postH.toFixed(1)}" fill="#ffffff" stroke="#111" stroke-width="1.2"/>`);
    els.push(`<rect x="${(cx - oW / 2).toFixed(1)}" y="${cyTop.toFixed(1)}" width="${oW}" height="${postH.toFixed(1)}" fill="url(#hatch-steel)"/>`);
    els.push(`<rect x="${(cx - oW / 2 - 2).toFixed(1)}" y="${(cyTop - 5).toFixed(1)}" width="${oW + 4}" height="5" fill="#fff" stroke="#111" stroke-width="0.9"/>`);
    els.push(drawText(cx, cyTop - 9, '4"⌀ OUTER POST', { anchor: 'middle', fontSize: 6, fontWeight: 'bold', fill: '#333' }));
    // Side channel of the pre-built section (vertical, right of post)
    const chX = cx + oW / 2 + 4;
    els.push(`<rect x="${chX.toFixed(1)}" y="${(cyTop + 8).toFixed(1)}" width="7" height="${(postH - 16).toFixed(1)}" fill="#e8e8e8" stroke="#111" stroke-width="0.9"/>`);
    els.push(drawText(chX + 12, cyTop + 20, 'SECTION SIDE CHANNEL', { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    // Mid rail (2"×1") entering the post at mid-height + top/bottom rails
    const railYs = [cyTop + postH * 0.18, cyTop + postH * 0.5, cyTop + postH * 0.82];
    const railLbl = ['TOP RAIL', `MID RAIL ${SF.midRailTallIn}"×${SF.midRailDeepIn}"`, 'BOTTOM RAIL'];
    railYs.forEach((ry, ri) => {
      els.push(`<rect x="${(chX + 7).toFixed(1)}" y="${(ry - 4).toFixed(1)}" width="${(cW * 0.34).toFixed(1)}" height="8" fill="#d8dce2" stroke="#111" stroke-width="0.9"/>`);
      // 4"×4" stiffener plate at the connection
      const stif = 13;
      els.push(`<rect x="${(cx - stif / 2).toFixed(1)}" y="${(ry - stif / 2).toFixed(1)}" width="${stif}" height="${stif}" fill="#e8e8e8" stroke="#111" stroke-width="0.9"/>`);
      // (2) SS fasteners through channel into rail end
      els.push(`<circle cx="${(chX + 3.5).toFixed(1)}" cy="${(ry - 2).toFixed(1)}" r="1.5" fill="#fff" stroke="#111" stroke-width="0.7"/>`);
      els.push(`<circle cx="${(chX + 3.5).toFixed(1)}" cy="${(ry + 2).toFixed(1)}" r="1.5" fill="#fff" stroke="#111" stroke-width="0.7"/>`);
      els.push(drawText(chX + 12 + cW * 0.34, ry + 2, railLbl[ri], { anchor: 'start', fontSize: 5.6, fontWeight: ri === 1 ? 'bold' : 'normal', fill: '#333' }));
    });
    // Stiffener leader
    els.push(`<line x1="${(cx - 8).toFixed(1)}" y1="${(railYs[1] - 8).toFixed(1)}" x2="${(b.x + 24).toFixed(1)}" y2="${(railYs[1] - 30).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(b.x + 22, railYs[1] - 34, '4"×4" POST STIFFENER (TYP)', { anchor: 'start', fontSize: 5.6, fontWeight: 'bold', fill: '#333' }));
    els.push(drawText(b.x + cW / 2, b.y + cH - 16, `RAIL CUT ${'93-5/8"'} — MID RAIL CUT ${'91-11/16"'} — SS HARDWARE THROUGHOUT`, { anchor: 'middle', fontSize: 5.8, fill: '#333' }));
    els.push(drawText(b.x + cW / 2, b.y + cH - 6, `PRE-BUILT ${SOLFENCE_DISPLAY} — ${SF.bayWideIn}" BAY, 2 MODULES/SECTION`, { anchor: 'middle', fontSize: 5.6, italic: true, fill: '#666' }));
  }

  // ── Detail C: MODULE-TO-SECTION / MID-RAIL ATTACHMENT ──────────────────────
  {
    const c = cells[2];
    const cx = c.x + cW * 0.42, cy = c.y + cH * 0.48;
    const modH = cH * 0.62, modW = 9;
    // Vertical glass-glass module (section cut) — two glass leaves
    els.push(`<rect x="${(cx - modW / 2).toFixed(1)}" y="${(cy - modH / 2).toFixed(1)}" width="${modW}" height="${modH.toFixed(1)}" fill="#eaf1fa" stroke="#111" stroke-width="1.1"/>`);
    els.push(`<line x1="${(cx - modW / 2 + 2.6).toFixed(1)}" y1="${(cy - modH / 2 + 2).toFixed(1)}" x2="${(cx - modW / 2 + 2.6).toFixed(1)}" y2="${(cy + modH / 2 - 2).toFixed(1)}" stroke="#1a4a8a" stroke-width="0.7"/>`);
    els.push(`<line x1="${(cx + modW / 2 - 2.6).toFixed(1)}" y1="${(cy - modH / 2 + 2).toFixed(1)}" x2="${(cx + modW / 2 - 2.6).toFixed(1)}" y2="${(cy + modH / 2 - 2).toFixed(1)}" stroke="#1a4a8a" stroke-width="0.7"/>`);
    els.push(drawText(cx, cy - modH / 2 - 6, 'PV MODULE — GLASS-GLASS BIFACIAL (90° VERTICAL)', { anchor: 'middle', fontSize: 5.8, fontWeight: 'bold', fill: '#1a4a8a' }));
    // Mid rail behind the module at mid-height (2" tall × 1" deep profile)
    const mrH = 26, mrD = 14;
    els.push(`<rect x="${(cx + modW / 2).toFixed(1)}" y="${(cy - mrH / 2).toFixed(1)}" width="${mrD}" height="${mrH}" fill="#d8dce2" stroke="#111" stroke-width="1.1"/>`);
    // 4-screw attachment (2 shown in section) through rail into module channel
    for (const sy of [cy - mrH / 4, cy + mrH / 4]) {
      els.push(`<line x1="${(cx + modW / 2 + mrD).toFixed(1)}" y1="${sy.toFixed(1)}" x2="${(cx - 1).toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#111" stroke-width="1.6"/>`);
      els.push(`<line x1="${(cx + modW / 2 + mrD + 2).toFixed(1)}" y1="${(sy - 2.4).toFixed(1)}" x2="${(cx + modW / 2 + mrD + 2).toFixed(1)}" y2="${(sy + 2.4).toFixed(1)}" stroke="#111" stroke-width="2"/>`);
    }
    els.push(`<line x1="${(cx + modW / 2 + mrD + 6).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + cW * 0.24).toFixed(1)}" y2="${(cy - 14).toFixed(1)}" stroke="#333" stroke-width="0.6"/>`);
    els.push(drawText(cx + cW * 0.24 + 2, cy - 17, `MID RAIL ${SF.midRailTallIn}"×${SF.midRailDeepIn}" — 4-SCREW ATTACHMENT`, { anchor: 'start', fontSize: 5.8, fontWeight: 'bold', fill: '#111' }));
    // Top/bottom section channel engagement
    for (const [chy, lbl] of [[cy - modH / 2, 'TOP CHANNEL'], [cy + modH / 2 - 8, 'BOTTOM CHANNEL']] as Array<[number, string]>) {
      els.push(`<rect x="${(cx - modW / 2 - 3).toFixed(1)}" y="${chy.toFixed(1)}" width="${modW + 6}" height="8" fill="none" stroke="#111" stroke-width="1"/>`);
      els.push(drawText(cx - modW / 2 - 7, chy + 6, lbl, { anchor: 'end', fontSize: 5.4, fill: '#555' }));
    }
    // Rear wire-management cover note
    els.push(drawText(cx - modW / 2 - 7, cy + 3, 'WIRE MGMT BEHIND REAR COVER', { anchor: 'end', fontSize: 5.4, fill: '#555' }));
    els.push(drawText(c.x + cW / 2, c.y + cH - 6, 'MODULE CAPTURED IN SECTION CHANNELS + 4-SCREW MID RAIL — NO FIELD DRILLING', { anchor: 'middle', fontSize: 5.4, italic: true, fill: '#666' }));
  }

  // ── Detail D: EQUIPMENT BONDING ────────────────────────────────────────────
  {
    const d = cells[3];
    const cx = d.x + cW * 0.26, cy = d.y + cH * 0.40;
    const postH = cH * 0.56;
    els.push(`<rect x="${(cx - 8).toFixed(1)}" y="${(cy - postH / 2).toFixed(1)}" width="16" height="${postH.toFixed(1)}" fill="#fff" stroke="#111" stroke-width="1.1"/>`);
    els.push(`<rect x="${(cx - 8).toFixed(1)}" y="${(cy - postH / 2).toFixed(1)}" width="16" height="${postH.toFixed(1)}" fill="url(#hatch-steel)"/>`);
    els.push(drawText(cx, cy - postH / 2 - 5, 'FENCE POST', { anchor: 'middle', fontSize: 5.8, fontWeight: 'bold', fill: '#333' }));
    // Module frame bond point (top right of post)
    const fy = cy - postH * 0.30;
    els.push(`<rect x="${(cx + 8).toFixed(1)}" y="${(fy - 4).toFixed(1)}" width="8" height="8" fill="#c98a2b" stroke="#7a5500" stroke-width="0.9"/>`);
    els.push(drawText(cx + 19, fy - 6, 'LAY-IN LUG (TYP EA POST)', { anchor: 'start', fontSize: 5.6, fontWeight: 'bold', fill: '#111' }));
    // EGC run: lug → along fence → ground bar
    const gx = d.x + cW * 0.74, gy = cy + postH * 0.42;
    els.push(`<path d="M${(cx + 16).toFixed(1)} ${fy.toFixed(1)} C ${(cx + 70).toFixed(1)} ${fy.toFixed(1)}, ${(gx - 60).toFixed(1)} ${gy.toFixed(1)}, ${gx.toFixed(1)} ${gy.toFixed(1)}" fill="none" stroke="#0a7d00" stroke-width="1.6"/>`);
    els.push(drawText((cx + gx) / 2, (fy + gy) / 2 - 8, '#6 AWG Cu EGC — CONTINUOUS', { anchor: 'middle', fontSize: 5.8, fontWeight: 'bold', fill: '#0a7d00' }));
    // Ground electrode (rod) symbol at the EGC end
    els.push(`<line x1="${gx.toFixed(1)}" y1="${gy.toFixed(1)}" x2="${gx.toFixed(1)}" y2="${(gy + 22).toFixed(1)}" stroke="#111" stroke-width="1.4"/>`);
    for (let gi = 0; gi < 3; gi++) {
      const gw = 16 - gi * 5;
      els.push(`<line x1="${(gx - gw / 2).toFixed(1)}" y1="${(gy + 22 + gi * 4).toFixed(1)}" x2="${(gx + gw / 2).toFixed(1)}" y2="${(gy + 22 + gi * 4).toFixed(1)}" stroke="#111" stroke-width="1.2"/>`);
    }
    els.push(drawText(gx + 12, gy + 28, 'GND ROD PER NEC 250.52', { anchor: 'start', fontSize: 5.6, fill: '#333' }));
    // Per-panel ground wire note (SolFence: individual ground wire per panel)
    els.push(drawText(cx + 19, fy + 4, 'INDIVIDUAL GROUND WIRE PER PANEL', { anchor: 'start', fontSize: 5.4, fill: '#555' }));
    els.push(drawText(cx + 19, fy + 12, 'BOND ALL POSTS / RAILS / FRAMES', { anchor: 'start', fontSize: 5.4, fill: '#555' }));
    els.push(drawText(d.x + cW / 2, d.y + cH - 6, 'CONTINUOUS EGC TO ARRAY GND — NEC 690.43 / 250.169', { anchor: 'middle', fontSize: 5.4, italic: true, fill: '#666' }));
  }

  // ── Data zone: FENCE STRUCTURAL SCHEDULE ───────────────────────────────────
  const dZone = zones.data;
  let ry = dZone.y + 4;
  els.push(drawRectFilled(dZone.x, ry, dZone.width, 14, '#000', '#000', 0));
  els.push(drawText(dZone.x + dZone.width / 2, ry + 9.5, 'FENCE STRUCTURAL SCHEDULE', { anchor: 'middle', fontSize: 7.5, fontWeight: '900', fill: '#fff' }));
  ry += 16;
  // Rows derive from SOLFENCE_SECTION (mfr telescoping-post record).
  // Kept short — the 217px rail clips ~55+ char rows.
  const schedule = [
    { n: 1, label: `POST — 4"⌀ OUTER / 2-7/8"⌀×${SF.innerPostLenIn}" INNER @ ${ftToFtIn(postSpacingFt)} O.C.` },
    { n: 2, label: `FOUNDATION — DRIVEN ${ftToFtIn(postEmbedFt)} MIN — NO CONCRETE` },
    { n: 3, label: `MID RAIL ${SF.midRailTallIn}"×${SF.midRailDeepIn}" + 4"×4" POST STIFFENERS` },
    { n: 4, label: `MODULE — CHANNELS + 4-SCREW MID RAIL` },
    { n: 5, label: `BONDING — #6 AWG Cu EGC (NEC 250.169/690.43)` },
    { n: 6, label: `WIND — ${windSpeedMph} MPH Vult (${_asceSt} §29.4)` },
    { n: 7, label: `RATED — ${ratings.windMph} MPH WIND / ${ratings.snowPsf} PSF (MFR)` },
  ];
  const rowH = 19;
  schedule.forEach((item, i) => {
    const rowY = ry + i * rowH;
    els.push(drawRectFilled(dZone.x, rowY, dZone.width, rowH - 1, i % 2 === 0 ? '#fff' : '#f5f5f5', '#ddd', 0.5));
    els.push(drawCallout({ cx: dZone.x + 11, cy: rowY + 8, number: item.n, r: 7 }));
    els.push(drawText(dZone.x + 23, rowY + 11, item.label, { anchor: 'start', fontSize: 6.2, fill: '#222' }));
  });
  ry += schedule.length * rowH + 8;
  els.push(drawText(dZone.x + 4, ry, `${totalPanels} MODULES · ${dcKw.toFixed(2)} kW DC · ${ftToFtIn(totalLengthFt)} L.F.`, { anchor: 'start', fontSize: 6.4, fontWeight: 'bold', fill: '#1a2332' }));
  if (ctx) { const u = drawUtilityAnalysis(ctx, dZone.x, ry + 10, dZone.width); if (u) els.push(u); }

  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    'STRUCTURAL DETAILS — NTS — VERIFY POST SIZE, EMBEDMENT + CONNECTIONS IN FIELD PER PE', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true }));
  els.push(drawSVGClose());
  return els.join('');
}