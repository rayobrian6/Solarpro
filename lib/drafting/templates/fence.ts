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
  const margin = 28;

  // ── Compute bounding box of all segments ──
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

  const spanX = (maxX - minX) * metersToFt(1) || 1;
  const spanY = (maxY - minY) * metersToFt(1) || 1;

  const scaleX = (dz.width  - 2 * margin) / spanX;
  const scaleY = (dz.height - 2 * margin) / spanY;
  const scale  = Math.min(scaleX, scaleY);

  const toSvgX = (xM: number) =>
    dz.x + margin + (xM - minX) * metersToFt(1) * scale;
  const toSvgY = (yM: number) =>
    dz.y + dz.height - margin - (yM - minY) * metersToFt(1) * scale;

  // ── Draw each segment (STEP 6: per-segment, not blob) ──
  segments.forEach((seg: any, i: number) => {
    const sx = seg.startX ?? seg.startPoint?.x ?? 0;
    const sy = seg.startY ?? seg.startPoint?.y ?? 0;
    const ex = seg.endX   ?? seg.endPoint?.x   ?? 0;
    const ey = seg.endY   ?? seg.endPoint?.y   ?? 0;

    const x1 = toSvgX(sx), y1 = toSvgY(sy);
    const x2 = toSvgX(ex), y2 = toSvgY(ey);

    const color    = segColor(i);
    const lenFt    = seg.lengthFt ?? metersToFt(seg.lengthM ?? 0);
    const panCount = seg.panelCount ?? 0;
    const segLabel = seg.label ?? seg.id ?? `SEG-${i + 1}`;

    // Segment line (thick — represents fence run)
    els.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"
      x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"
      stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>`);

    // Post dots along segment
    const posts: Array<{ x: number; y: number }> =
      seg.posts ?? seg._cadPosts ?? [];

    if (posts.length > 0) {
      posts.forEach((post: any) => {
        const px = toSvgX(post.x ?? sx);
        const py = toSvgY(post.y ?? sy);
        els.push(drawCircleFilled(px, py, 3, '#333', '#000', 1));
      });
    } else {
      // Approximate post positions from spacing
      const postSpacingM = cadFence?.postSpacingM ?? 2.44;
      const postSpacingFt = metersToFt(postSpacingM);
      const nPosts = Math.round(lenFt / postSpacingFt) + 1;
      for (let p = 0; p < nPosts; p++) {
        const t  = nPosts > 1 ? p / (nPosts - 1) : 0;
        const px = x1 + t * (x2 - x1);
        const py = y1 + t * (y2 - y1);
        els.push(drawCircleFilled(px, py, 3, '#333', '#000', 1));
      }
    }

    // Segment label — midpoint, outside line
    const mx  = (x1 + x2) / 2;
    const my  = (y1 + y2) / 2;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const perpX = -Math.sin(ang) * 14;
    const perpY =  Math.cos(ang) * 14;

    // Colored badge background
    const badgeW = 56, badgeH = 12;
    els.push(`<rect x="${(mx + perpX - badgeW / 2).toFixed(1)}"
      y="${(my + perpY - badgeH / 2).toFixed(1)}"
      width="${badgeW}" height="${badgeH}"
      fill="${color}" rx="2" opacity="0.85"/>`);

    els.push(drawText(mx + perpX, my + perpY + 3.5,
      `${segLabel}: ${ftToFtIn(lenFt)} / ${panCount}p`, {
        anchor: 'middle', fontSize: 6.5, fill: '#fff', fontWeight: 'bold',
      }));
  });

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

  // ── North arrow ──
  els.push(drawNorthArrow(W - zones.dims.right - 18, H - zones.dims.bottom + 26, 22));

  // ── Scale bar ──
  const scaleBarFt = 20;
  const scaleBarPx = scaleBarFt * scale;
  els.push(drawScaleBar(zones.dims.left + 4, H - zones.dims.bottom + 28,
    Math.round(scaleBarPx), `0    ${scaleBarFt} FT`));

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
    const lenFt    = seg.lengthFt ?? metersToFt(seg.lengthM ?? 0);
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

  postPositions.forEach((posFt, pi) => {
    const px = toX(posFt);

    // Post above grade — steel gradient + hatch
    const pTopY = toYa(panelHeightFt + 0.5);   // post extends slightly above panel top
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx}" height="${(groundY - pTopY).toFixed(1)}" fill="url(#post-steel)" stroke="#333" stroke-width="1.2"/>`);
    // Steel hatch overlay
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${pTopY.toFixed(1)}" width="${postWPx}" height="${(groundY - pTopY).toFixed(1)}" fill="url(#hatch-steel)" opacity="0.35"/>`);

    // Post below grade (embed) — dashed to show hidden/buried
    const pBotY = toYb(postEmbedFt);
    els.push(`<rect x="${(px - postWPx/2).toFixed(1)}" y="${groundY.toFixed(1)}" width="${postWPx}" height="${(pBotY - groundY).toFixed(1)}" fill="#707070" stroke="#333" stroke-width="1" stroke-dasharray="4,2"/>`);

    // Concrete footing (wider block below embed) — concrete gradient + hatch
    const footW = postWPx * 2.5;
    const footH = Math.max(FT_PX * 0.6, 8);
    els.push(`<rect x="${(px - footW/2).toFixed(1)}" y="${(pBotY - footH).toFixed(1)}" width="${footW}" height="${footH}" fill="url(#concrete-grad)" stroke="#777" stroke-width="1.0" rx="2"/>`);
    // Concrete hatch overlay
    els.push(`<rect x="${(px - footW/2).toFixed(1)}" y="${(pBotY - footH).toFixed(1)}" width="${footW}" height="${footH}" fill="url(#hatch-concrete)" opacity="0.3" rx="2"/>`);

    // Post cap — steel gradient
    els.push(`<rect x="${(px - postWPx/2 - 2).toFixed(1)}" y="${(pTopY - 5).toFixed(1)}" width="${postWPx + 4}" height="5" fill="url(#pile-steel)" stroke="#555" stroke-width="0.8"/>`);

    // Post label (only middle post to avoid clutter)
    if (pi === 1) {
      els.push(drawText(px, pTopY - 8, 'POST (TYP.)', {
        anchor: 'middle', fontSize: 6.5, fill: '#333', fontWeight: 'bold',
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

  // ── PV panels between posts (per bay) ──
  const panelW_ft = panelLenIn / 12;   // panel landscape = length horizontal
  const panelH_ft = panelWidIn / 12;
  const panelWpx  = Math.min(panelW_ft * FT_PX, postSpacingFt * FT_PX - postWPx - 4);
  const panelHpx  = panelH_ft * FT_PX;

  // Panels fill the post spacing (stacked vertically = panel height)
  const panelBotY  = toYa(0) - 2;                 // just above grade
  const panelTopY  = toYa(panelHeightFt) + 2;
  const panelDrawH = panelBotY - panelTopY;        // total draw height

  // How many panel rows stack vertically within the fence height?
  // This is a physical count: panelHeightFt / panel-width-in-feet
  // Cap at what fits visually (don't use total panel count — that's the horizontal count)
  const panelRowsPhysical = Math.max(Math.round(panelHeightFt / (panelWidIn / 12)), 1);
  const panelsPerBay = Math.min(panelRowsPhysical, 6);  // max 6 rows shown for clarity

  for (let bay = 0; bay < 2; bay++) {
    const bayX1 = toX(postPositions[bay]) + postWPx / 2 + 2;
    const bayX2 = toX(postPositions[bay + 1]) - postWPx / 2 - 2;
    const bayW  = bayX2 - bayX1;

    // Stack panels in bay
    const safePanelDrawH = Math.max(panelDrawH, 4);  // never let draw height go negative
    const panHFit = safePanelDrawH / Math.max(panelsPerBay, 1);
    const nPanels = Math.max(panelsPerBay, 1);

    for (let pv = 0; pv < nPanels; pv++) {
      const pvY1 = panelTopY + pv * panHFit + 1;
      const pvH  = Math.max(panHFit - 2, 1);  // clamp: never negative, min 1px
      const pvW  = bayW;

      // Panel body — dark blue PV glass
      els.push(`<rect x="${bayX1.toFixed(1)}" y="${pvY1.toFixed(1)}" width="${pvW.toFixed(1)}" height="${pvH.toFixed(1)}" fill="url(#panel-glass)" stroke="#0a1e4a" stroke-width="1.0" opacity="0.93" rx="0.5"/>`);
      // Aluminum frame inner border
      els.push(`<rect x="${(bayX1 + 1.5).toFixed(1)}" y="${(pvY1 + 1.5).toFixed(1)}" width="${(pvW - 3).toFixed(1)}" height="${(pvH - 3).toFixed(1)}" fill="none" stroke="rgba(180,210,240,0.6)" stroke-width="0.8"/>`);

      // Cell grid (6 cells horizontal busbars)
      if (pvW > 12) {
        const cellW = (pvW - 3) / 6;
        for (let c = 1; c < 6; c++) {
          els.push(`<line x1="${(bayX1 + 1.5 + c * cellW).toFixed(1)}" y1="${(pvY1 + 1.5).toFixed(1)}" x2="${(bayX1 + 1.5 + c * cellW).toFixed(1)}" y2="${(pvY1 + pvH - 1.5).toFixed(1)}" stroke="rgba(147,197,253,0.45)" stroke-width="0.5"/>`);
        }
      }
      // Cell grid (3 cells vertical)
      if (pvH > 10) {
        const cellH = (pvH - 3) / 3;
        for (let r = 1; r < 3; r++) {
          els.push(`<line x1="${(bayX1 + 1.5).toFixed(1)}" y1="${(pvY1 + 1.5 + r * cellH).toFixed(1)}" x2="${(bayX1 + pvW - 1.5).toFixed(1)}" y2="${(pvY1 + 1.5 + r * cellH).toFixed(1)}" stroke="rgba(147,197,253,0.35)" stroke-width="0.4"/>`);
        }
      }
    }

    // Bay label (inside, bottom)
    const cx = (bayX1 + bayX2) / 2;
    els.push(drawText(cx, panelBotY - 4,
      `BAY ${bay + 1}`, {
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

  // Dead load arrow (gravity, pointing down)
  const dlArrowX = toX(postSpacingFt);   // middle post
  els.push(drawWindArrow(
    dlArrowX, panelTopY - 24,
    18, 'down',
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
    { n: 1, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}" BIFACIAL` },
    { n: 2, label: `FENCE POST — ${ftToFtIn(postSpacingFt)} O.C.` },
    { n: 3, label: `POST EMBEDMENT — ${ftToFtIn(postEmbedFt)} MIN.` },
    { n: 4, label: `PANEL HEIGHT — ${ftToFtIn(panelHeightFt)} A.G.` },
    { n: 5, label: `RAIL ×${railCount} — ${mountSys}` },
    { n: 6, label: `WIND LOAD — ${windSpeedMph} MPH (ASCE 7-22)` },
    { n: 7, label: `DEAD LOAD — ${((panelLenIn * panelWidIn / 144) * 3.5 / totalPanels * totalPanels).toFixed(0)} LBS/PANEL EST.` },
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
    { text: `EMBED DEPTH: ${ftToFtIn(postEmbedFt)} MIN.`, bold: false },
    { text: `RAILS: ${railCount}× HORIZONTAL`, bold: false },
    { text: `REF: NEC 690 / ASCE 7-22`, bold: false },
    { text: `INSTALLER TO VERIFY POST SIZE + SPACING`, bold: true, red: true },
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