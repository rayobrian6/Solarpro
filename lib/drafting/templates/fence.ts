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
import { getMountingSystemById } from '../../mounting-hardware-db';

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

// ─────────────────────────────────────────────────────────────────────────────
// drawFencePlan — PV-2 Site Plan (top-down segment layout)
// SECONDARY view for solar_fence system.
// ─────────────────────────────────────────────────────────────────────────────

export function drawFencePlan(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { layout, engineering } = input;

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
    els.push(`<polygon points="${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)} ${p3x.toFixed(1)},${p3y.toFixed(1)} ${p4x.toFixed(1)},${p4y.toFixed(1)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1"/>`);

    // Module ticks — divide the run into panelCount cells (module boundaries)
    const cells = Math.max(panCount, 1);
    for (let c = 0; c <= cells; c++) {
      const t   = c / cells;
      const cxp = x1 + (x2 - x1) * t;
      const cyp = y1 + (y2 - y1) * t;
      const isEnd = c === 0 || c === cells;
      const tk   = isEnd ? BAND : BAND * 0.82;
      els.push(`<line x1="${(cxp + nx * tk).toFixed(1)}" y1="${(cyp + ny * tk).toFixed(1)}" x2="${(cxp - nx * tk).toFixed(1)}" y2="${(cyp - ny * tk).toFixed(1)}" stroke="${color}" stroke-width="${isEnd ? 1.4 : 0.7}"/>`);
    }

    // Colored fence centreline (the run itself)
    els.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`);

    // Post dots along the run (from CAD, else approximate from spacing)
    const posts: Array<{ x: number; y: number }> = seg.posts ?? seg._cadPosts ?? [];
    if (posts.length > 0) {
      posts.forEach((post: any) => {
        els.push(drawCircleFilled(toSvgX(post.x ?? sx), toSvgY(post.y ?? sy), 2, '#222', '#000', 0.8));
      });
    } else {
      const postSpacingFt = metersToFt(cadFence?.postSpacingM ?? 2.44);
      const nPosts = Math.max(2, Math.round(lenFt / postSpacingFt) + 1);
      for (let p = 0; p < nPosts; p++) {
        const t = nPosts > 1 ? p / (nPosts - 1) : 0;
        els.push(drawCircleFilled(x1 + t * (x2 - x1), y1 + t * (y2 - y1), 2, '#222', '#000', 0.8));
      }
    }

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
  els.push(drawScaleBar(planZone.x + 6, planZone.y + planZone.height - 8,
    Math.round(scaleBarFt * scale), `0    ${scaleBarFt} FT`));

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
    const bayPx   = Math.min(postSpFt * vft, secW * 0.30);
    const cx      = secX + secW * 0.34;
    const leftPost = cx - bayPx / 2, rightPost = cx + bayPx / 2;
    const postTopY = grade - clrPx - panelPx - 8;
    const panTop   = grade - clrPx - panelPx;

    // Grade line + hatch
    els.push(`<line x1="${(secX + 20).toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(secX + secW - 24).toFixed(1)}" y2="${grade.toFixed(1)}" stroke="#6b4a2a" stroke-width="1.8"/>`);
    for (let i = 0; i < 22; i++) {
      const gx = secX + 24 + i * ((secW - 48) / 22);
      els.push(`<line x1="${gx.toFixed(1)}" y1="${grade.toFixed(1)}" x2="${(gx - 5).toFixed(1)}" y2="${(grade + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.5"/>`);
    }
    // Posts: above grade (solid steel) + below grade (dashed embed)
    for (const px of [leftPost, rightPost]) {
      els.push(`<rect x="${(px - 2.6).toFixed(1)}" y="${postTopY.toFixed(1)}" width="5.2" height="${(grade - postTopY).toFixed(1)}" fill="#8a8a8a" stroke="#333" stroke-width="1"/>`);
      els.push(`<rect x="${(px - 2.6).toFixed(1)}" y="${grade.toFixed(1)}" width="5.2" height="${embedPx.toFixed(1)}" fill="#707070" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);
    }
    // Vertical PV module panel between posts + rail lines
    els.push(`<rect x="${(leftPost + 4).toFixed(1)}" y="${panTop.toFixed(1)}" width="${(bayPx - 8).toFixed(1)}" height="${panelPx.toFixed(1)}" fill="#cfe0f4" stroke="#1a4a8a" stroke-width="1.3"/>`);
    for (let r = 1; r < rails; r++) {
      const ry = panTop + (panelPx * r) / rails;
      els.push(`<line x1="${(leftPost + 4).toFixed(1)}" y1="${ry.toFixed(1)}" x2="${(rightPost - 4).toFixed(1)}" y2="${ry.toFixed(1)}" stroke="#1a4a8a" stroke-width="0.5" opacity="0.5"/>`);
    }
    // Wind arrow
    const wY = (panTop + grade) / 2;
    els.push(`<line x1="${(rightPost + 44).toFixed(1)}" y1="${wY.toFixed(1)}" x2="${(rightPost + 10).toFixed(1)}" y2="${wY.toFixed(1)}" stroke="#c00" stroke-width="1.6"/>`);
    els.push(drawArrowhead(rightPost + 10, wY, 180, 6, '#c00'));
    els.push(drawText(rightPost + 48, wY - 3, 'WIND', { anchor: 'start', fontSize: 6.5, fontWeight: 'bold', fill: '#c00' }));
    // Dimensions
    els.push(drawText(leftPost - 9, (panTop + grade - clrPx) / 2, `${panelHtFt.toFixed(1)}' PANEL`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#1a4a8a', rotate: -90 }));
    els.push(drawText(rightPost + 10, grade + embedPx / 2, `${embedFt.toFixed(1)}' EMBED`, { anchor: 'start', fontSize: 6.8, fontWeight: 'bold', fill: '#333' }));
    const dy = grade + embedPx + 13;
    els.push(`<line x1="${leftPost.toFixed(1)}" y1="${dy.toFixed(1)}" x2="${rightPost.toFixed(1)}" y2="${dy.toFixed(1)}" stroke="#036" stroke-width="0.9"/>`);
    els.push(`<line x1="${leftPost.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${leftPost.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#036" stroke-width="0.8"/>`);
    els.push(`<line x1="${rightPost.toFixed(1)}" y1="${(dy - 4).toFixed(1)}" x2="${rightPost.toFixed(1)}" y2="${(dy + 4).toFixed(1)}" stroke="#036" stroke-width="0.8"/>`);
    els.push(drawText(cx, dy - 3, `${postSpFt.toFixed(0)}' O.C.`, { anchor: 'middle', fontSize: 6.8, fontWeight: 'bold', fill: '#036' }));

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
      `${rails}-rail SolFence vertical section system; posts @ ${postSpFt.toFixed(0)}' O.C.`,
      `Foundation: 2-3/8" dia. driven steel pile, ${embedFt.toFixed(1)}' min embedment — NO concrete.`,
      'Field-verify post size + driven depth to refusal per geotech.',
      'Bond all posts, rails + frames to EGC — min #6 AWG Cu (NEC 250.166).',
      'Wind design per ASCE 7-22; verify exposure category on site.',
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

  // ── Scale computation ──
  // Show 2 bays: width = 2 × postSpacingFt, height = panelHeight + embed
  const totalHeightFt  = panelHeightFt + postEmbedFt;
  const elevWidthFt    = postSpacingFt * 2;     // 2-bay section
  const FT_PX_X        = Math.min((dz.width  * 0.70) / elevWidthFt,   28);
  const FT_PX_Y        = Math.min((dz.height * 0.82) / totalHeightFt, 28);
  const FT_PX          = Math.min(FT_PX_X, FT_PX_Y);

  // Origin: bottom-left of above-grade section
  const elevW  = elevWidthFt  * FT_PX;
  const elevHa = panelHeightFt * FT_PX;   // above grade
  const elevHb = postEmbedFt   * FT_PX;   // below grade

  const originX = dz.x + 24;
  const groundY = dz.y + (dz.height * 0.62);   // ground line at 62% from top

  // Coordinate helpers
  const toX = (ft: number) => originX + ft * FT_PX;
  const toYa = (ft: number) => groundY - ft * FT_PX;   // above grade (up)
  const toYb = (ft: number) => groundY + ft * FT_PX;   // below grade (down)

  // ── STEP 7: Ground plane ──
  // Sky background
  els.push(`<rect x="${dz.x}" y="${dz.y}" width="${dz.width}" height="${(groundY - dz.y).toFixed(1)}"
    fill="#f0f8ff" opacity="0.5"/>`);
  // Earth/soil background
  els.push(`<rect x="${dz.x}" y="${groundY.toFixed(1)}" width="${dz.width}" height="${(dz.y + dz.height - groundY).toFixed(1)}"
    fill="#8B6914" opacity="0.18"/>`);
  // Ground hatch (earth)
  for (let hx = dz.x; hx < dz.x + dz.width; hx += 8) {
    els.push(`<line x1="${hx.toFixed(1)}" y1="${groundY.toFixed(1)}"
      x2="${(hx - 10).toFixed(1)}" y2="${(groundY + 12).toFixed(1)}"
      stroke="#8B6914" stroke-width="0.7" opacity="0.5"/>`);
  }
  // Ground line (bold)
  els.push(drawLine(dz.x, groundY, dz.x + dz.width * 0.85, groundY, 'line-struct'));
  els.push(drawText(dz.x + dz.width * 0.85 + 4, groundY + 3, 'GRADE', {
    anchor: 'start', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));

  // ── 3 posts (2 full bays) ──
  const nPosts = 3;
  const postWPx = Math.max(FT_PX * 0.3, 5);   // post visual width
  const postPositions: number[] = [];
  for (let p = 0; p < nPosts; p++) {
    postPositions.push(p * postSpacingFt);
  }

  // SolFence foundation = 2-3/8" steel pipe DRIVEN (no concrete). The square
  // 4×4 SolFence post seats OVER the round driven pile (via the donut collar).
  const pileWPx = Math.max(postWPx * 0.62, 3);   // 2-3/8" pipe vs 4" post
  postPositions.forEach((posFt, pi) => {
    const px = toX(posFt);
    const pBotY = toYb(postEmbedFt);

    // ── Below grade: 2-3/8" round steel pile, DRIVEN (dashed = buried),
    //    driven point at the tip. NO concrete footing. ──
    const pileTopY = groundY - 1;
    const pileShaftBot = pBotY - pileWPx * 0.9;   // leave room for the driven tip
    els.push(`<rect x="${(px - pileWPx/2).toFixed(1)}" y="${pileTopY.toFixed(1)}" width="${pileWPx.toFixed(1)}" height="${(pileShaftBot - pileTopY).toFixed(1)}" rx="${(pileWPx/2).toFixed(1)}" fill="url(#pile-steel)" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);
    // Driven chisel point
    els.push(`<path d="M ${(px - pileWPx/2).toFixed(1)} ${pileShaftBot.toFixed(1)} L ${px.toFixed(1)} ${pBotY.toFixed(1)} L ${(px + pileWPx/2).toFixed(1)} ${pileShaftBot.toFixed(1)} Z" fill="url(#pile-steel)" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);

    // ── Above grade: square 4×4 SolFence post — steel gradient + hatch ──
    const pTopY = toYa(panelHeightFt + 0.5);   // extends slightly above panel top
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx}" height="${(groundY - pTopY).toFixed(1)}" fill="url(#post-steel)" stroke="#333" stroke-width="1.2"/>`);
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx}" height="${(groundY - pTopY).toFixed(1)}" fill="url(#hatch-steel)" opacity="0.30"/>`);

    // ── Donut collar at grade: the square post seated OVER the round pile ──
    const collarH = Math.max(FT_PX * 0.3, 5);
    els.push(`<rect x="${(px - postWPx/2 - 1).toFixed(1)}" y="${(groundY - collarH/2).toFixed(1)}" width="${(postWPx + 2).toFixed(1)}" height="${collarH.toFixed(1)}" rx="1" fill="url(#post-steel)" stroke="#333" stroke-width="1"/>`);

    // Post cap — steel gradient
    els.push(`<rect x="${(px - postWPx/2 - 2).toFixed(1)}" y="${(pTopY - 5).toFixed(1)}" width="${postWPx + 4}" height="5" fill="url(#pile-steel)" stroke="#555" stroke-width="0.8"/>`);

    // Labels (middle post only, to avoid clutter)
    if (pi === 1) {
      els.push(drawText(px, pTopY - 8, '4×4 POST (TYP.)', {
        anchor: 'middle', fontSize: 6.5, fill: '#333', fontWeight: 'bold',
      }));
      els.push(drawText(px + pileWPx / 2 + 3, toYb(postEmbedFt * 0.5),
        '2-3/8" DIA. STEEL PILE — DRIVEN (NO CONCRETE)', {
          anchor: 'start', fontSize: 5.4, fill: '#555', italic: true,
        }));
    }
  });

  // ── Rails (horizontal members) ──
  const railPositions: number[] = [];
  for (let r = 0; r < railCount; r++) {
    const frac = (r + 1) / (railCount + 1);
    railPositions.push(frac * panelHeightFt);
  }

  railPositions.forEach((railHFt, ri) => {
    const railY = toYa(railHFt);
    const railX1 = toX(postPositions[0]);
    const railX2 = toX(postPositions[nPosts - 1]);
    const railH  = Math.max(FT_PX * 0.15, 3);
    els.push(drawRectFilled(
      railX1, railY - railH / 2,
      railX2 - railX1, railH,
      '#888', '#555', 1
    ));
    // Rail callout
    els.push(drawCalloutWithLeader(
      dz.x + dz.width * 0.05,
      railY,
      railX1 + (railX2 - railX1) * 0.2,
      railY,
      ri + 5,   // callout numbers 5+
      8
    ));
  });

  // ── PV panels — SolFence 90° VERTICAL mount ──
  // Modules stand STRAIGHT UP (portrait, full fence height) and sit SIDE BY
  // SIDE within each bay — they are NEVER stacked in rows. A SolFence 8' section
  // carries 2 modules; the count per bay is derived from module width vs the
  // clear bay width.
  const panelWidFt = panelWidIn / 12;             // module WIDTH (short dim) → horizontal
  const panelBotY  = toYa(0) - 2;                 // ~2" ground clearance
  const panelTopY  = toYa(panelHeightFt) + 2;

  for (let bay = 0; bay < 2; bay++) {
    const bayX1 = toX(postPositions[bay]) + postWPx / 2 + 3;
    const bayX2 = toX(postPositions[bay + 1]) - postWPx / 2 - 3;
    const bayW  = bayX2 - bayX1;

    const panelsPerBay = Math.max(1, Math.min(3,
      Math.round(bayW / Math.max(panelWidFt * FT_PX, 1))));
    const gap  = 3;
    const panW = (bayW - gap * (panelsPerBay - 1)) / panelsPerBay;
    const panH = Math.max(panelBotY - panelTopY, 4);

    for (let pv = 0; pv < panelsPerBay; pv++) {
      const pvX = bayX1 + pv * (panW + gap);

      // Module glass — PORTRAIT (tall), aluminum frame
      els.push(`<rect x="${pvX.toFixed(1)}" y="${panelTopY.toFixed(1)}" width="${panW.toFixed(1)}" height="${panH.toFixed(1)}" fill="url(#panel-glass)" stroke="#0a1e4a" stroke-width="1.0" opacity="0.93" rx="0.5"/>`);
      els.push(`<rect x="${(pvX + 1.5).toFixed(1)}" y="${(panelTopY + 1.5).toFixed(1)}" width="${(panW - 3).toFixed(1)}" height="${(panH - 3).toFixed(1)}" fill="none" stroke="rgba(180,210,240,0.6)" stroke-width="0.8"/>`);

      // Portrait cell grid — center half-cell seam (2 cols) + 6 rows
      if (panW > 8) {
        els.push(`<line x1="${(pvX + panW/2).toFixed(1)}" y1="${(panelTopY + 1.5).toFixed(1)}" x2="${(pvX + panW/2).toFixed(1)}" y2="${(panelTopY + panH - 1.5).toFixed(1)}" stroke="rgba(147,197,253,0.5)" stroke-width="0.6"/>`);
      }
      if (panH > 12) {
        const rows = 6;
        for (let r = 1; r < rows; r++) {
          const ly = panelTopY + 1.5 + (panH - 3) * r / rows;
          els.push(`<line x1="${(pvX + 1.5).toFixed(1)}" y1="${ly.toFixed(1)}" x2="${(pvX + panW - 1.5).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="rgba(147,197,253,0.35)" stroke-width="0.4"/>`);
        }
      }
    }

    // Bay label (inside, bottom)
    const cx = (bayX1 + bayX2) / 2;
    els.push(drawText(cx, panelBotY - 4, `BAY ${bay + 1}`, {
      anchor: 'middle', fontSize: 6.5, fill: '#fff', fontWeight: 'bold',
    }));
  }

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
  // middle-post "4×4 POST (TYP.)" label.
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

  // L3 — Panel height breakdown: each rail position
  railPositions.forEach((railHFt, ri) => {
    if (ri === 0) {
      els.push(drawLinearDimension(
        originX - 26, originX - 26,
        toYa(0), 0, ''
      ));
    }
    // Small tick on left showing rail spacing
  });

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
  const calloutItems = [
    { n: 1, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}" BIFACIAL — 90° VERTICAL` },
    { n: 2, label: `4×4 FENCE POST — ${ftToFtIn(postSpacingFt)} O.C.` },
    { n: 3, label: `FOUNDATION — 2-3/8" DRIVEN PILE, ${ftToFtIn(postEmbedFt)} MIN.` },
    { n: 4, label: `PANEL HEIGHT — ${ftToFtIn(panelHeightFt)} A.G.` },
    { n: 5, label: `RAIL ×${railCount} — ${mountSys}` },
    { n: 6, label: `WIND LOAD — ${windSpeedMph} MPH (ASCE 7-22)` },
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

  // FENCE-SPECIFIC NOTES (no roof/ground terms)
  const notes = [
    { text: `FENCE SYSTEM: ${mountSys}`, bold: true },
    { text: `TOTAL: ${ftToFtIn(totalLengthFt)} L.F. FENCE`, bold: false },
    { text: `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`, bold: false },
    { text: `POST SPACING: ${ftToFtIn(postSpacingFt)} O.C.`, bold: false },
    { text: `FOUNDATION: 2-3/8" PIPE DRIVEN ${ftToFtIn(postEmbedFt)} MIN. — NO CONCRETE`, bold: false },
    { text: `MODULES: 90° VERTICAL, SIDE-BY-SIDE`, bold: false },
    { text: `RAILS: ${railCount}× HORIZONTAL`, bold: false },
    { text: `REF: NEC 690 / ASCE 7-22`, bold: false },
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