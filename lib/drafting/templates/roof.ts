// ============================================================
// SolarPro Drafting Engine — Roof System Templates
// lib/drafting/templates/roof.ts
//
// drawRoofPlan()       → PV-2: top-down GPS array layout (PRIMARY)
// drawRoofStructural() → PV-3: cross-section + attachment detail
//
// SYSTEM: roof ONLY
// CAD IS THE SOLE SOURCE OF TRUTH — all geometry from CADModel.
//
// CROSS-CONTAMINATION BLOCK (STEP 9):
//   ✗ No fence terminology (post, rail, gate, fence height, embed)
//   ✗ No ground terminology (pile, array row, row spacing, ground mount)
//   ✓ Roof-only: plane, pitch, rafter, ridge, eave, setback,
//                L-foot, flashing, lag bolt, fascia
//
// GPS COORDINATE ENCODING:
//   CAD adapter encodes local XY (meters) as fake-degrees (1°==1ft)
//   so template scale = pixels/ft and panel sizes are pixel-accurate.
//
// STRUCTURAL REALISM (STEP 7):
//   PV-3 shows: rafter cross-section, full layer stack, L-foot
//   detail circle, dimension hierarchy, attachment callouts.
// ============================================================

import type { DraftingInput } from '../types';
import type { DesignIntent } from '../designIntent';
import type { CADModel } from '../../cad/types';
import { drawUtilityAnalysis, type RenderContext } from '../renderContext';
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
import { insetPolygon } from '../../cad/geometry';

// Signed area of a screen-space ring (used only to detect winding / collapse).
function ringSignedArea(p: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y;
  return a / 2;
}

// Ray-cast point-in-polygon on a lat/lng ring (planar; fine at roof scale).
function ptInLatLngRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Plan-view (horizontal footprint) area of a facet ring, in ft². drawRoofPlan
// receives fake-degree CAD units where 1 unit ≈ 1 ft (see header), so the raw
// shoelace is already ft² — no lat/lng metre conversion. This is the "PLAN VIEW"
// roof area the pro sets report, not the sloped surface area.
function planViewAreaFt2(ring: Array<{ lat: number; lng: number }>): number {
  if (ring.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].lng * ring[i].lat - ring[i].lng * ring[j].lat;
  }
  return Math.abs(a / 2);   // ft² (1 CAD unit = 1 ft)
}

// Inset a screen-space polygon inward by `dist` px, orientation-agnostic.
// insetPolygon() assumes one winding; our pixel rings can be either (toY flips
// lat), so if the first inset EXPANDS the ring we retry with reversed winding.
// Returns null when the setback would collapse the facet (nothing sensible to draw).
function insetRingPx(ring: { x: number; y: number }[], dist: number): { x: number; y: number }[] | null {
  if (ring.length < 3 || dist <= 0) return null;
  const orig = Math.abs(ringSignedArea(ring));
  let out = insetPolygon(ring, dist);
  if (Math.abs(ringSignedArea(out)) > orig) out = insetPolygon(ring.slice().reverse(), dist);
  const area = Math.abs(ringSignedArea(out));
  if (out.length < 3 || area > orig || area < 1) return null;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRoofPlan — PV-2 Top-Down GPS Array Layout (PRIMARY)
// STEP 2: Roof top-down plan is the primary view.
// STEP 4: All geometry from CADModel (via fake-degree encoding).
// ─────────────────────────────────────────────────────────────────────────────

export function drawRoofPlan(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
  panelColorById?: Map<string, string> | null,
): string {
  const { project, layout, engineering } = input;

  const totalPanels = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw        = cad?.totalDcKw   ?? engineering.totalDcKw   ?? (totalPanels * (engineering.panelWatts || 400) / 1000);
  const panelLenIn  = project.panelLengthIn   || 66;
  const panelWidIn  = project.panelWidthIn    || 40;
  const mountSys    = (project.mountingSystem || 'IRONRIDGE XR100').toUpperCase();
  const roofType    = (project.roofType       || 'SHINGLE').toUpperCase();
  const pitchNum    = project.roofPitch       || 5;
  const pitchStr    = pitchNum + ':12';
  const rafterSp    = project.rafterSpacing   || 24;
  const attachSp    = project.attachmentSpacing || 48;
  const setbackIn   = project.ahjRoofSetbackIn  || 18;  // IFC 605.11 access pathway (was hardcoded 36")
  const ridgeSetIn  = project.ahjRidgeSetbackIn || 18;
  const setbackFt   = setbackIn / 12;
  const ridgeSetFt  = ridgeSetIn / 12;

  // ── STEP 4: Geometry from CAD (via adapter fake-degree encoding) ──
  const rpData = project.roofPlanes    || [];
  const ppData = project.panelPositions || [];

  const validPlanes = rpData.filter(
    (rp: any) => rp.vertices && rp.vertices.length >= 3 &&
          rp.vertices.every((v: any) => isFinite(v.lat) && isFinite(v.lng) && Math.abs(v.lat) > 0.001)
  );
  const validPanels = ppData.filter(
    (p: any) => p.lat && p.lng && isFinite(p.lat) && isFinite(p.lng) && Math.abs(p.lat) > 0.001
  );

  console.log('[drawRoofPlan] CAD-driven input:', {
    planes: validPlanes.length,
    panels: validPanels.length,
    totalPanels,
    dcKw: dcKw.toFixed(2),
    cadPresent: !!cad,
  });

  // ── STEP 4 enforcement: throw without real geometry ──
  if (validPanels.length === 0 || validPlanes.length === 0) {
    throw new Error(
      '[drawRoofPlan] No valid CAD geometry. ' +
      `planes=${rpData.length} validPlanes=${validPlanes.length} ` +
      `panels=${ppData.length} validPanels=${validPanels.length} ` +
      '— roof system requires cad.roof model with planes and panels.'
    );
  }

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('roof', 'plan');
  const W = zones.canvas.width;
  const H = zones.canvas.height;
  const dz = zones.draw;

  const els: string[] = [];
  // v65: pre-compute branch-color mode flag (needed for title bar)
  const isBranchColorMode = !!(panelColorById && panelColorById.size > 0);

  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#f5f7f0'));
  // v65: PV-2B branch-color mode gets a distinct title bar
  const svgTitle = isBranchColorMode
    ? 'CIRCUIT LAYOUT — AC BRANCH COLOR MAP'
    : 'ROOF PLAN — PHOTOVOLTAIC ARRAY LAYOUT';
  els.push(drawTitleBar(W, svgTitle, 'SCALE: 3/32"=1\'-0"'));

  // ── GPS coordinate → SVG mapping ──
  const allLats = validPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lat));
  const allLngs = validPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lng));
  const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs), maxLng = Math.max(...allLngs);
  const latSpan = maxLat - minLat || 0.001;
  const lngSpan = maxLng - minLng || 0.001;

  // Margin leaves room for the dimension lines + callout row outside the roof.
  const margin  = 52;
  const scaleX  = (dz.width  - 2 * margin) / lngSpan;
  const scaleY  = (dz.height - 2 * margin) / latSpan;
  // Fit-to-frame (was *1.35, which overzoomed and clipped the top hip + the
  // setback dimension off the page for frame-filling roofs — caught via harness).
  const scale   = Math.min(scaleX, scaleY);

  // Center the roof in the draw zone (was left/bottom-justified, leaving dead
  // space on the side when fit-to-frame is limited by the other dimension).
  const roofWpx = lngSpan * scale;
  const roofHpx = latSpan * scale;
  const offX = Math.max(0, (dz.width  - 2 * margin - roofWpx) / 2);
  const offY = Math.max(0, (dz.height - 2 * margin - roofHpx) / 2);
  const toX = (lng: number) => dz.x  + margin + offX + (lng - minLng) * scale;
  const toY = (lat: number) => dz.y  + (dz.height - margin) - offY - (lat - minLat) * scale;

  // ── Draw roof planes ──
  // Plane labels are collected here and rendered AFTER the panels so the modules
  // never paint over them (the old "ANE 2 / E FAC" clipping).
  const planeLabels: Array<{ cx: number; cy: number; ri: number; pitch: any; azimuth: any }> = [];
  validPlanes.forEach((rp: any, ri: number) => {
    const ptsXY = rp.vertices!.map((v: any) => ({ x: toX(v.lng), y: toY(v.lat) }));
    const pts = ptsXY.map((p: { x: number; y: number }) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

    // Roof plane fill — clean light cool-gray (was a busy beige + double hatch).
    const roofFill = ri % 2 === 0 ? '#eceef1' : '#e3e6ea';
    els.push(`<polygon points="${pts}" fill="${roofFill}" stroke="none"/>`);
    // Subtle shingle texture only — dropped to a whisper (was opaque 0.92) and the
    // second diagonal wood hatch removed entirely, which was the main "busy" look.
    const tileClipId = `rtc${ri}`;
    els.push(`<defs><clipPath id="${tileClipId}"><polygon points="${pts}"/></clipPath></defs>`);
    els.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#hatch-roof-tile)" opacity="0.22" clip-path="url(#${tileClipId})"/>`);

    // Clean structural outline
    els.push(`<polygon points="${pts}" fill="none" stroke="#2b2f36" stroke-width="2" stroke-linejoin="miter"/>`);

    // Fire setback inset (dashed red outline) — REAL inward offset by the AHJ
    // setback. Was drawn on the roof edge itself (zero inset) so no setback band
    // showed. Now offsets each facet inward by setbackFt; falls back to no band
    // if the setback would collapse the facet (tiny/degenerate).
    const sbPx = setbackFt * scale;
    const insetXY = insetRingPx(ptsXY, sbPx);
    if (insetXY) {
      const ip = insetXY.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
      els.push(`<polygon points="${ip}" fill="none" class="line-setbk"/>`);
    }

    // Plane label — collected, rendered after panels (see planeLabels render below)
    const cx = rp.vertices!.reduce((s: number, v: any) => s + toX(v.lng), 0) / rp.vertices!.length;
    const cy = rp.vertices!.reduce((s: number, v: any) => s + toY(v.lat), 0) / rp.vertices!.length;
    planeLabels.push({ cx, cy, ri, pitch: rp.pitch, azimuth: rp.azimuth });
  });

  // ── Draw panels (from CAD fake-degree positions) ──
  // Render modules at near-true footprint (was 0.8 → a sparse, scattered array).
  // 0.97 leaves only a hairline gap so adjacent panels read as a tight, real array.
  const panLenPx = Math.max((panelLenIn / 12) * scale * 0.97, 6);
  const panWidPx = Math.max((panelWidIn / 12) * scale * 0.97, 4);

  // Flat, crisp PV modules — uniform fill + thin frame (no gradient/reflection/
  // busbar clip-art, which muddied to a blue smear at plan scale).
  validPanels.forEach((p: any) => {
    const px = toX(p.lng), py = toY(p.lat);
    const isLandscape = (p.orientation || 'landscape') === 'landscape';
    const pw = isLandscape ? panLenPx : panWidPx;
    const ph = isLandscape ? panWidPx : panLenPx;
    const x0 = px - pw / 2, y0 = py - ph / 2;

    // Module body — branch-colored fill (PV-2B) or default navy (PV-2)
    const branchFill = panelColorById?.get(p.id) ?? '#1b3f74';
    els.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${branchFill}" stroke="#0a1e4a" stroke-width="0.7" rx="0.4"/>`);
    // Thin aluminum frame inset
    els.push(`<rect x="${(x0 + 0.7).toFixed(1)}" y="${(y0 + 0.7).toFixed(1)}" width="${Math.max(pw - 1.4, 0).toFixed(1)}" height="${Math.max(ph - 1.4, 0).toFixed(1)}" fill="none" stroke="rgba(190,210,235,0.5)" stroke-width="0.35"/>`);
    // One subtle mid seam for the half-cell read (only when large enough)
    if (ph > 12) {
      els.push(`<line x1="${(x0 + 1).toFixed(1)}" y1="${py.toFixed(1)}" x2="${(x0 + pw - 1).toFixed(1)}" y2="${py.toFixed(1)}" stroke="rgba(150,180,220,0.4)" stroke-width="0.4"/>`);
    }
  });

  // ── Plane labels (rendered last, on top of panels — opaque pill, sized to text) ──
  planeLabels.forEach(L => {
    const lines: string[] = ['PLANE ' + (L.ri + 1)];
    if (L.pitch !== undefined) {
      // One-decimal rise:12 so the plane label matches the SYSTEM-DATA table /
      // header (they show e.g. "4.8:12"); rounding to a whole "5:12" here made
      // the same sheet show two different pitches.
      const rise12 = typeof L.pitch === 'number'
        ? Math.round(Math.tan(L.pitch * Math.PI / 180) * 12 * 10) / 10
        : L.pitch;
      lines.push(rise12 + ':12 PITCH');
    }
    if (L.azimuth !== undefined) lines.push(compassDir(L.azimuth) + ' FACING');
    const bw = 52, bh = 6 + lines.length * 8.5;
    els.push(`<rect x="${(L.cx - bw / 2).toFixed(1)}" y="${(L.cy - bh / 2).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="2" fill="rgba(255,255,255,0.93)" stroke="#555" stroke-width="0.6"/>`);
    lines.forEach((t, i) => {
      els.push(drawText(L.cx, L.cy - bh / 2 + 7.5 + i * 8.5, t, {
        anchor: 'middle',
        fontSize: i === 0 ? 7 : 6.3,
        fill: i === 0 ? '#1a1a1a' : '#555',
        fontWeight: i === 0 ? 'bold' : 'normal',
      }));
    });
  });

  // ── ROOF DESCRIPTION + ARRAY CALC tables (PV-2 only) ──────────────────────
  // Mirrors the pro reference: a per-facet "MAIN HOME ROOF DESCRIPTION" table
  // (roof # / modules / azimuth / tilt / truss) + an "ARRAY & ROOF CALC" summary
  // (plan-view roof area / array area / % coverage). Rendered top-left, opaque.
  if (!isBranchColorMode) {
    const trussSize    = ((project as any).rafterSize || (project as any).trussSize || '2×4').toString();
    const trussSpacing = `${rafterSp}" O.C.`;
    const facets = validPlanes.map((rp: any, i: number) => ({
      n: i + 1,
      mods: validPanels.filter((p: any) => ptInLatLngRing(p.lat, p.lng, rp.vertices)).length,
      az: rp.azimuth != null && isFinite(rp.azimuth) ? `${Math.round(rp.azimuth)}°` : '—',
      tilt: rp.pitch != null && isFinite(rp.pitch) ? `${Math.round(rp.pitch)}°` : '—',
    }));
    const roofAreaFt2  = validPlanes.reduce((s: number, rp: any) => s + planViewAreaFt2(rp.vertices), 0);
    const panelAreaFt2 = (panelLenIn * panelWidIn) / 144;
    const arrayAreaFt2 = totalPanels * panelAreaFt2;
    const coverPct     = roofAreaFt2 > 0 ? (arrayAreaFt2 / roofAreaFt2) * 100 : 0;
    const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

    const cols = [
      { key: 'n',    hdr: 'ROOF',    w: 30 },
      { key: 'mods', hdr: 'MODULES', w: 40 },
      { key: 'az',   hdr: 'AZIMUTH', w: 38 },
      { key: 'tilt', hdr: 'TILT',    w: 30 },
    ] as const;
    const tblW = cols.reduce((s, c) => s + c.w, 0);
    const rowH = 10, hdrH = 11, titleH = 12;
    const tx = 8, ty = 30;
    const tblH = titleH + hdrH + facets.length * rowH;

    const t: string[] = [];
    t.push(`<rect x="${tx}" y="${ty}" width="${tblW}" height="${tblH}" fill="rgba(255,255,255,0.95)" stroke="#2b2f36" stroke-width="0.8"/>`);
    t.push(`<rect x="${tx}" y="${ty}" width="${tblW}" height="${titleH}" fill="#000"/>`);
    t.push(drawText(tx + tblW / 2, ty + 8.5, 'MAIN HOME ROOF DESCRIPTION', { anchor: 'middle', fontSize: 5.6, fontWeight: 'bold', fill: '#fff' }));
    // header row
    let cxp = tx;
    for (const c of cols) {
      t.push(`<rect x="${cxp}" y="${ty + titleH}" width="${c.w}" height="${hdrH}" fill="#e8ebf0" stroke="#999" stroke-width="0.3"/>`);
      t.push(drawText(cxp + c.w / 2, ty + titleH + 7.5, c.hdr, { anchor: 'middle', fontSize: 5.2, fontWeight: 'bold', fill: '#1a1a1a' }));
      cxp += c.w;
    }
    // data rows
    facets.forEach((f, ri) => {
      const ry = ty + titleH + hdrH + ri * rowH;
      cxp = tx;
      for (const c of cols) {
        t.push(`<rect x="${cxp}" y="${ry}" width="${c.w}" height="${rowH}" fill="none" stroke="#ccc" stroke-width="0.3"/>`);
        t.push(drawText(cxp + c.w / 2, ry + 7, String((f as any)[c.key]), { anchor: 'middle', fontSize: 5.4, fill: '#333' }));
        cxp += c.w;
      }
    });
    // truss note under the table
    t.push(drawText(tx, ty + tblH + 8, `TRUSS: ${trussSize} @ ${trussSpacing}`, { anchor: 'start', fontSize: 5, fill: '#555' }));

    // ── ARRAY & ROOF CALC — TOTAL ──
    const cy2 = ty + tblH + 14;
    const calc: Array<[string, string]> = [
      ['ROOF AREA (PLAN VIEW)', `${fmt(roofAreaFt2)} ft²`],
      ['NEW ARRAY AREA', `${fmt(arrayAreaFt2)} ft²`],
      ['ROOF COVERED BY ARRAY', `${coverPct.toFixed(1)}%`],
    ];
    const calcH = titleH + calc.length * rowH;
    t.push(`<rect x="${tx}" y="${cy2}" width="${tblW}" height="${calcH}" fill="rgba(255,255,255,0.95)" stroke="#2b2f36" stroke-width="0.8"/>`);
    t.push(`<rect x="${tx}" y="${cy2}" width="${tblW}" height="${titleH}" fill="#000"/>`);
    t.push(drawText(tx + tblW / 2, cy2 + 8.5, 'ARRAY & ROOF CALC — TOTAL', { anchor: 'middle', fontSize: 5.6, fontWeight: 'bold', fill: '#fff' }));
    calc.forEach(([label, val], ri) => {
      const ry = cy2 + titleH + ri * rowH;
      t.push(`<rect x="${tx}" y="${ry}" width="${tblW}" height="${rowH}" fill="none" stroke="#ccc" stroke-width="0.3"/>`);
      t.push(drawText(tx + 3, ry + 7, label, { anchor: 'start', fontSize: 5, fill: '#333' }));
      t.push(drawText(tx + tblW - 3, ry + 7, val, { anchor: 'end', fontSize: 5.2, fontWeight: 'bold', fill: '#1a1a1a' }));
    });
    els.push(...t);
  }

  // ── DIMENSION HIERARCHY ── (PV-2 only — skipped for PV-2B branch-color mode)
  const roofMinX = toX(minLng);
  const roofMaxX = toX(maxLng);
  const roofMinY = toY(maxLat);
  const roofMaxY = toY(minLat);
  const roofWFt  = lngSpan;   // because 1° == 1ft in fake-degree encoding
  const roofHFt  = latSpan;

  // L1 — Overall width (bottom) — PV-2 only
  if (!isBranchColorMode) {
  els.push(drawOverallDimension(
    roofMinX, roofMaxX,
    roofMaxY + 36, 24,
    ftToFtIn(roofWFt) + ' — VERIFY IN FIELD'
  ));
  }

  // L1 — Overall height (left, vertical) — PV-2 only
  if (!isBranchColorMode && roofHFt > 3) {
    els.push(drawVerticalDimension(
      dz.x - 14,
      roofMinY, roofMaxY,
      14,
      ftToFtIn(roofHFt)
    ));
  }

  // L2 — Fire setback (top of draw zone, if space) — PV-2 only
  if (!isBranchColorMode) {
  const sbPixels = setbackFt * scale;
  if (sbPixels > 10 && roofMinX + sbPixels < roofMaxX) {
    els.push(drawLinearDimension(
      roofMinX, roofMinX + sbPixels,
      roofMinY - 12, 10,
      ftToFtIn(setbackFt) + ' SETBACK'
    ));
  }
  }

  // ── North arrow + scale bar ──
  // North: PV-2B keeps the simple arrow; PV-2 gets a full N/E/S/W compass rose below.
  if (isBranchColorMode) {
    els.push(drawNorthArrow(W - zones.dims.right - 18, H - zones.dims.bottom + 26, 22));
  }
  const scaleBarPx = Math.round(10 * scale);   // 10-foot scale bar
  els.push(drawScaleBar(zones.dims.left + 4, H - zones.dims.bottom + 28,
    Math.max(scaleBarPx, 30), '0    10 FT'));

  // ── Compass rose + LEGEND (PV-2 only) ─────────────────────────────────────
  if (!isBranchColorMode) {
    // Compass rose — 4-point star with N/E/S/W, bottom-right corner.
    const crX = W - zones.dims.right - 6, crY = H - zones.dims.bottom - 2, cr = 20;
    const rose: string[] = [];
    rose.push(`<circle cx="${crX}" cy="${crY}" r="${cr}" fill="rgba(255,255,255,0.9)" stroke="#2b2f36" stroke-width="0.9"/>`);
    // vertical (N/S) star — N solid, S light
    rose.push(`<polygon points="${crX},${crY - cr + 2} ${crX + 4},${crY} ${crX},${crY - 3} ${crX - 4},${crY}" fill="#1a1a1a"/>`);
    rose.push(`<polygon points="${crX},${crY + cr - 2} ${crX + 4},${crY} ${crX},${crY + 3} ${crX - 4},${crY}" fill="#b0b4bc"/>`);
    // horizontal (E/W) minor star
    rose.push(`<polygon points="${crX + cr - 2},${crY} ${crX},${crY + 4} ${crX + 3},${crY} ${crX},${crY - 4}" fill="#6b7078"/>`);
    rose.push(`<polygon points="${crX - cr + 2},${crY} ${crX},${crY + 4} ${crX - 3},${crY} ${crX},${crY - 4}" fill="#6b7078"/>`);
    rose.push(`<circle cx="${crX}" cy="${crY}" r="1.4" fill="#1a1a1a"/>`);
    rose.push(drawText(crX, crY - cr - 3, 'N', { anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#1a1a1a' }));
    rose.push(drawText(crX, crY + cr + 7, 'S', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    rose.push(drawText(crX + cr + 5, crY + 2.5, 'E', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    rose.push(drawText(crX - cr - 5, crY + 2.5, 'W', { anchor: 'middle', fontSize: 6, fill: '#555' }));
    els.push(...rose);

    // Legend — documents the symbols/line-styles actually on this sheet.
    const lg: Array<{ swatch: string; label: string }> = [
      { swatch: `<rect x="0" y="-5" width="14" height="9" fill="#1b3f74" stroke="#0a1e4a" stroke-width="0.5" rx="0.4"/>`, label: 'PV MODULE' },
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#c0392b" stroke-width="1.1" stroke-dasharray="3 2"/>`, label: `${ftToFtIn(setbackFt)} FIRE SETBACK` },
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#2b2f36" stroke-width="1.6"/>`, label: 'ROOF EDGE / RIDGE' },
      { swatch: `<circle cx="7" cy="0" r="4.5" fill="#fff" stroke="#000" stroke-width="1"/><text x="7" y="2.3" text-anchor="middle" font-size="5" font-weight="900" fill="#000">#</text>`, label: 'CALLOUT REF.' },
    ];
    const lgW = 128, rowH = 13, lgX = W - zones.dims.right - lgW + 8, lgY = zones.dims.top + 6;
    const lgH = 13 + lg.length * rowH;
    els.push(`<rect x="${lgX}" y="${lgY}" width="${lgW}" height="${lgH}" rx="2" fill="rgba(255,255,255,0.95)" stroke="#2b2f36" stroke-width="0.8"/>`);
    els.push(`<rect x="${lgX}" y="${lgY}" width="${lgW}" height="12" fill="#000"/>`);
    els.push(drawText(lgX + lgW / 2, lgY + 8.5, 'LEGEND', { anchor: 'middle', fontSize: 6, fontWeight: 'bold', fill: '#fff', letterSpacing: 1 }));
    lg.forEach((e, i) => {
      const ry = lgY + 12 + i * rowH + rowH / 2;
      els.push(`<g transform="translate(${lgX + 8},${ry})">${e.swatch}</g>`);
      els.push(drawText(lgX + 30, ry + 2.3, e.label, { anchor: 'start', fontSize: 5.6, fill: '#1a1a1a' }));
    });
  }

  // ── Callout bubbles ── (PV-2 only — PV-2B shows branch legend instead)
  if (!isBranchColorMode) {
  const cbY    = zones.dims.top + 12;
  // Callout bubbles spread across the TOP of the roof, each pointing straight down
  // to the nearest panel below it — short, near-vertical leaders instead of long
  // diagonals fanning across the whole array (the old crossing "spider-web").
  // Clamp the row just below the title bar so bubbles never render off-screen when
  // the roof reaches the top edge (verified via the render harness).
  const cbN      = 5;
  const cbSpanX  = roofMaxX - roofMinX;
  const cbRowY   = Math.max(roofMinY - 16, zones.dims.top + 10);
  for (let i = 0; i < cbN; i++) {
    const frac = (i + 0.5) / cbN;
    const bx   = roofMinX + cbSpanX * frac;
    // nearest panel to this bubble's x
    let best: any = null, bestD = Infinity;
    for (const p of validPanels) {
      const d = Math.abs(toX(p.lng) - bx);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) {
      els.push(drawCalloutWithLeader(bx, cbRowY, toX(best.lng), toY(best.lat), i + 1, 8));
    }
  }

  } // end PV-2 callout bubbles

  // ── v65: Branch legend overlay (PV-2B only) ──
  if (isBranchColorMode && panelColorById) {
    // Collect unique branch colors and their labels
    const branchColorSet = new Set(panelColorById.values());
    const branchEntries = Array.from(branchColorSet).sort();
    const legendX = dz.x + 8;
    const legendY = zones.dims.top + 8;
    const legendLineH = 12;
    const legendW = 82;
    const legendH = 14 + branchEntries.length * legendLineH;
    // Semi-transparent background
    els.push(`<rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" rx="3" fill="rgba(255,255,255,0.92)" stroke="#555" stroke-width="0.8"/>`);
    els.push(drawText(legendX + legendW / 2, legendY + 9, 'BRANCH LEGEND', {
      anchor: 'middle', fontSize: 6.5, fill: '#000', fontWeight: 'bold',
    }));
    branchEntries.forEach((color, i) => {
      const ly = legendY + 15 + i * legendLineH;
      els.push(`<rect x="${legendX + 5}" y="${ly}" width="8" height="8" fill="${color}" stroke="#333" stroke-width="0.5" rx="1"/>`);
      els.push(drawText(legendX + 17, ly + 7, 'B' + (i + 1), {
        anchor: 'start', fontSize: 6, fill: '#000', fontWeight: 'bold',
      }));
    });
  }

  // ── System summary line ──
  els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
    isBranchColorMode
      ? 'CIRCUIT LAYOUT — AC BRANCH COLOR MAP — SEE DATA ZONE FOR BRANCH SCHEDULE'
      : 'ROOF ARRAY PLAN — FIELD VERIFY ALL DIMENSIONS — SUBJECT TO RAFTER LOCATION + AHJ APPROVAL', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// drawRoofStructural — PV-3 Attachment Cross-Section + Detail
// STEP 7: Full structural realism — rafter cross-section, layer stack,
//         L-foot detail circle, dimension hierarchy.
// ─────────────────────────────────────────────────────────────────────────────

export function drawRoofStructural(
  input: DraftingInput,
  intent?: DesignIntent | null,
  cad?: CADModel | null,
  ctx?: RenderContext | null,
): string {
  const { project, engineering } = input;

  // project.roofPitch is in DEGREES (e.g. 20). Convert to rise-per-12 for the
  // slope label + section geometry — was rendering "20:12" for a 4:12 roof.
  const _rawPitch  = project.roofPitch          || 5;
  const pitchNum   = (_rawPitch > 12 && _rawPitch <= 90)
    ? Math.round(Math.tan(_rawPitch * Math.PI / 180) * 12)
    : _rawPitch;
  const pitchStr   = pitchNum + ':12';
  const rafterSz   = project.rafterSize         || '2x6';
  const rafterSp   = project.rafterSpacing      || 24;
  const attachSp   = project.attachmentSpacing  || 48;
  const mountSys   = (project.mountingSystem    || 'IRONRIDGE XR100').toUpperCase();
  const roofType   = (project.roofType          || 'SHINGLE').toUpperCase();
  const panelLenIn = project.panelLengthIn      || 66;
  const panelWidIn = project.panelWidthIn       || 40;
  const panelWt    = project.panelWeightLbs     || 45;
  const condType   = (project.conduitType       || 'EMT').toUpperCase();
  const windSpeedMph   = engineering.windSpeedMph  ?? project?.ahjWindSpeedMph  ?? 90;
  const groundSnowPsf  = engineering.groundSnowPsf ?? project?.ahjGroundSnowPsf ?? 0;
  const totalPanels    = cad?.totalPanels ?? engineering.totalPanels ?? 0;
  const dcKw           = cad?.totalDcKw   ?? engineering.totalDcKw   ?? 0;

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('roof', 'structural');
  const W = zones.canvas.width;
  const H = zones.canvas.height;
  const dz = zones.draw;

  const els: string[] = [];
  els.push(drawSVGOpen(W, H));
  els.push(drawBackground(W, H, '#fafafa'));
  els.push(drawTitleBar(W, 'ROOF ATTACHMENT DETAIL — CROSS-SECTION + MOUNTING', 'SCALE: 1"=1\'-0"'));

  // ── Cross-section geometry ──
  // 3-bay rafter section. Scale: 1 inch = 3px (1 foot = 36px)
  const IN_PX    = 3;
  const bayW     = rafterSp * IN_PX;
  const nBays    = 3;
  const roofRun  = bayW * nBays;
  const roofRise = roofRun * (pitchNum / 12);

  const secX     = dz.x + dz.width * 0.02;
  const roofBaseY = zones.dims.top + (dz.height * 0.78);

  // ── Bottom chord ──
  els.push(drawLine(secX, roofBaseY, secX + roofRun, roofBaseY, 'line-struct'));

  // ── Rafter slope lines ──
  const rafterTopX = secX + roofRun / 2;
  const rafterTopY = roofBaseY - roofRise / 2;
  els.push(drawLine(secX, roofBaseY, rafterTopX, rafterTopY, 'line-struct'));
  els.push(drawLine(rafterTopX, rafterTopY, secX + roofRun, roofBaseY, 'line-struct'));

  // Ridge
  els.push(drawText(rafterTopX, rafterTopY - 8, 'RIDGE', {
    anchor: 'middle', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));
  els.push(drawText(secX + 4, roofBaseY - 8, 'EAVE', {
    anchor: 'start', fontSize: 7, fill: '#333', fontWeight: 'bold',
  }));

  // Pitch annotation
  els.push(drawText(secX + roofRun / 4, roofBaseY - 22, pitchStr + ' SLOPE', {
    anchor: 'middle', fontSize: 8, fontWeight: 'bold', fill: '#000',
  }));

  // ── Rafter members (cross-section rects at each bay) ──
  // Each rafter shown as a wood cross-section with hatching
  const rafDepth = 18;
  const rafWidth = 14;
  for (let i = 0; i < nBays; i++) {
    const rfx       = secX + i * bayW + 10;
    const rfYCenter = roofBaseY - ((i + 0.5) / nBays) * roofRise * 0.5;
    const rfTop     = rfYCenter - rafDepth;
    // Wood fill
    els.push(`<rect x="${rfx.toFixed(1)}" y="${rfTop.toFixed(1)}" width="${rafWidth}" height="${rafDepth}" fill="url(#rafter-wood)" stroke="#5a3810" stroke-width="1.2"/>`);
    // Wood grain hatch
    els.push(`<rect x="${rfx.toFixed(1)}" y="${rfTop.toFixed(1)}" width="${rafWidth}" height="${rafDepth}" fill="url(#hatch-wood)" opacity="0.5"/>`);
    // Rafter size label
    els.push(drawText(rfx + rafWidth / 2, rfTop - 3, rafterSz, {
      anchor: 'middle', fontSize: 6, fill: '#333', fontWeight: 'bold',
    }));
  }

  // ── Roof layer stack (left bay — showing all roof layers) ──
  const detX  = secX + 8;
  const detY  = roofBaseY - roofRise / nBays * 0.3 - 70;
  const detW  = 120;
  type LayerDef = {
    label: string; fill: string; stroke: string; h: number;
    hatch?: string; hatchOpacity?: number;
  };
  const layers: LayerDef[] = [
    { label: 'PV MODULE',              fill: '#1a3f8a', stroke: '#0a1e4a', h: 12 },
    { label: 'RAIL / CLAMP',           fill: '#a0a0a0', stroke: '#444',    h: 5  },
    { label: 'STANDOFF / L-FOOT',      fill: '#b8b8b8', stroke: '#444',    h: 8,  hatch: 'url(#hatch-steel)', hatchOpacity: 0.6 },
    { label: 'FLASHING',               fill: '#c8dce8', stroke: '#4488aa', h: 3  },
    { label: roofType + ' ROOF',       fill: '#b89060', stroke: '#665030', h: 8  },
    { label: 'SHEATHING (5/8" OSB)',   fill: 'url(#rafter-wood)', stroke: '#886030', h: 7,  hatch: 'url(#hatch-wood)', hatchOpacity: 0.35 },
    { label: 'RAFTER (' + rafterSz + ')', fill: 'url(#rafter-wood)', stroke: '#7a5a20', h: 16, hatch: 'url(#hatch-wood)', hatchOpacity: 0.5 },
  ];

  let curY = detY;
  layers.forEach((layer) => {
    els.push(drawRectFilled(detX, curY, detW, layer.h, layer.fill, layer.stroke, 1.0));
    if (layer.hatch) {
      els.push(`<rect x="${detX.toFixed(1)}" y="${curY.toFixed(1)}" width="${detW}" height="${layer.h}" fill="${layer.hatch}" opacity="${layer.hatchOpacity ?? 0.5}"/>`);
    }
    curY += layer.h;
  });

  // ── Detail circle (zoomed L-foot attachment) ──
  const dcx = dz.x + dz.width * 0.76;
  const dcy = zones.dims.top + dz.height * 0.42;
  const dcr = 112;
  els.push(`<circle cx="${dcx.toFixed(1)}" cy="${dcy.toFixed(1)}" r="${dcr}"
    fill="#fffff8" stroke="#000" stroke-width="1.8"/>`);
  els.push(drawText(dcx, dcy - dcr - 6, 'DETAIL 1/PV-3', {
    anchor: 'middle', fontSize: 8.5, fontWeight: '900', fill: '#000',
  }));
  els.push(drawText(dcx, dcy - dcr + 10, 'ATTACHMENT DETAIL', {
    anchor: 'middle', fontSize: 7, fill: '#555',
  }));

  // Zoomed layers inside circle
  const dzX = dcx - 82, dzY = dcy - 55;
  const dzW = 164;
  type ZLayerDef = { label: string; fill: string; stroke?: string; h: number; hatch?: string; hatchOp?: number };
  const zLayers: ZLayerDef[] = [
    { label: `MODULE (${panelLenIn}" × ${panelWidIn}")`,  fill: '#1a3f8a', stroke: '#0a1e4a', h: 16 },
    { label: 'RAIL — ' + mountSys,                        fill: '#a0a0a0', stroke: '#444',    h: 7  },
    { label: 'L-FOOT / STANDOFF',                         fill: '#b8b8b8', stroke: '#444',    h: 10, hatch: 'url(#hatch-steel)', hatchOp: 0.5 },
    { label: 'FLASHING',                                  fill: '#c8dce8', stroke: '#4488aa', h: 4  },
    { label: roofType + ' ROOF',                          fill: '#b89060', stroke: '#665030', h: 8  },
    { label: 'SHEATHING (5/8" OSB)',                      fill: 'url(#rafter-wood)', stroke: '#886030', h: 7,  hatch: 'url(#hatch-wood)', hatchOp: 0.35 },
    { label: rafterSz + ' RAFTER @ ' + rafterSp + '" O.C.', fill: 'url(#rafter-wood)', stroke: '#7a5a20', h: 18, hatch: 'url(#hatch-wood)', hatchOp: 0.5 },
  ];
  let zy = dzY;
  zLayers.forEach((zl, i) => {
    els.push(drawRectFilled(dzX, zy, dzW, zl.h, zl.fill, zl.stroke || '#333', 0.9));
    if (zl.hatch) {
      els.push(`<rect x="${dzX.toFixed(1)}" y="${zy.toFixed(1)}" width="${dzW}" height="${zl.h}" fill="${zl.hatch}" opacity="${zl.hatchOp ?? 0.5}"/>`);
    }
    els.push(drawText(dzX + dzW + 5, zy + zl.h / 2 + 3, zl.label, {
      anchor: 'start', fontSize: 7, fill: '#222',
    }));
    els.push(drawCalloutWithLeader(dzX - 28, zy + zl.h / 2, dzX, zy + zl.h / 2, i + 1, 9));
    zy += zl.h;
  });

  // ── STEP 7: Load arrows ──
  const midPanY = detY + 5;   // top of layer stack
  // Wind (horizontal, pointing left into panel)
  els.push(drawWindArrow(
    secX + roofRun + 40, midPanY,
    40, 'left',
    `WIND ${windSpeedMph} MPH`
  ));
  // Snow (vertical, pointing down onto panel)
  if (groundSnowPsf > 0) {
    els.push(drawWindArrow(
      detX + detW / 2, detY - 24,
      20, 'down',
      `SNOW ${groundSnowPsf} PSF`
    ));
  }

  // ── DIMENSION HIERARCHY ──
  // L1 — Rafter span (bottom)
  els.push(drawOverallDimension(
    secX, secX + roofRun,
    roofBaseY + 28,
    20,
    rafterSp + '" RAFTER SPACING (TYP.)'
  ));

  // L2 — Single bay (rafter O.C.)
  els.push(drawLinearDimension(
    secX, secX + bayW,
    roofBaseY + 14, 12,
    ftToFtIn(rafterSp / 12) + ' O.C.'
  ));

  // L2 — Attachment spacing (2-bay span)
  els.push(drawOverallDimension(
    secX, secX + bayW * 2,
    roofBaseY + 42, 16,
    ftToFtIn(attachSp / 12) + ' ATTACH. O.C.'
  ));

  // L3 — Lag embedment (vertical, left)
  els.push(drawVerticalDimension(
    secX + 5, roofBaseY, roofBaseY - 30, 10, '2.5" MIN. EMBED'
  ));

  // ── Callout schedule (right panel) ──
  const schedLeft = W - zones.dims.right + 10;
  const schedY0   = zones.dims.top + 4;

  els.push(drawRectFilled(schedLeft - 2, schedY0 - 2, zones.dims.right - 12, 14, '#000', '#000', 0));
  els.push(drawText(schedLeft + (zones.dims.right - 14) / 2 - 2, schedY0 + 9,
    'ATTACHMENT CALLOUT SCHEDULE', {
      anchor: 'middle', fontSize: 8.5, fontWeight: '900', fill: '#fff',
    }));

  // ROOF-SPECIFIC callouts (STEP 8/9: roof terms only — NO posts/piles/fence)
  const structCallouts = [
    { n: 1, label: `PV MODULE — ${panelLenIn}" × ${panelWidIn}" @ ${panelWt} LBS` },
    { n: 2, label: `MOUNTING RAIL — ${mountSys}` },
    { n: 3, label: `STANDOFF / L-FOOT — 3/8" STAINLESS LAG` },
    { n: 4, label: `FLASHING — UNDER ALL PENETRATIONS` },
    { n: 5, label: `RAFTER — ${rafterSz} @ ${rafterSp}" O.C.` },
    { n: 6, label: `${condType} CONDUIT — SEE CONDUCTOR SCHEDULE` },
    { n: 7, label: `BONDING JUMPER — NEC 690.43` },
  ];

  const rowH = 20;
  structCallouts.forEach((sc, i) => {
    const rowY = schedY0 + 14 + i * rowH;
    const bg   = i % 2 === 0 ? '#fff' : '#f5f5f5';
    els.push(drawRectFilled(schedLeft - 2, rowY, zones.dims.right - 12, rowH - 1, bg, '#ddd', 0.5));
    els.push(drawCallout({ cx: schedLeft + 11, cy: rowY + 9, number: sc.n, r: 8 }));
    els.push(drawText(schedLeft + 24, rowY + 12, sc.label, {
      anchor: 'start', fontSize: 7, fill: '#222',
    }));
  });

  // Notes
  const noteY = schedY0 + 14 + structCallouts.length * rowH + 6;
  els.push(`<line x1="${schedLeft - 2}" y1="${noteY}" x2="${W - 8}" y2="${noteY}"
    stroke="#ccc" stroke-width="0.7"/>`);

  // ROOF-SPECIFIC NOTES (no fence/ground terms)
  const notes = [
    'VERIFY RAFTER SIZE + SPACING IN FIELD.',
    'ALL HARDWARE: 316 SS OR HOT-DIP GALVANIZED.',
    'MIN. LAG BOLT EMBEDMENT INTO RAFTER: 2-1/2".',
    `ATTACH. SPACING: ${ftToFtIn(attachSp / 12)} O.C. MAX.`,
    `WIND LOAD: ${windSpeedMph} MPH — REF: ASCE 7-22`,
    `${totalPanels} MODULES — ${dcKw.toFixed(2)} kW DC`,
    'REF: NEC 690.43 / IBC 1609 / ASCE 7-22',
  ];
  notes.forEach((note, i) => {
    els.push(drawText(schedLeft, noteY + 10 + i * 9, note, {
      anchor: 'start', fontSize: 6.5,
      fill: i === 0 ? '#cc0000' : '#333',
      fontWeight: i === 0 ? 'bold' : 'normal',
    }));
  });

  // UTILITY ANALYSIS (Bill Intelligence Layer — injected if ctx present)
  if (ctx) {
    const utilY   = noteY + 10 + notes.length * 9 + 6;
    const utilW   = zones.dims.right - 12;
    const utilSvg = drawUtilityAnalysis(ctx, schedLeft - 2, utilY, utilW);
    if (utilSvg) els.push(utilSvg);
  }

  // Scale note
  els.push(drawText(zones.dims.left, H - 8,
    'CROSS-SECTION SCHEMATIC — VERIFY RAFTER SIZE, SPACING + EMBEDMENT IN FIELD — NTS', {
      anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
    }));

  els.push(drawSVGClose());
  return els.join('');
}