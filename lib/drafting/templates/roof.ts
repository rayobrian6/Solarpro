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
import { regularizeRoofPlanes, coTransformPanels } from '../regularizeRoof';

// Ray-cast point-in-polygon on a lat/lng ring (planar; fine at roof scale).
function ptInLatLngRing(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat, xj = ring[j].lng, yj = ring[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// Screen-space point-in-ring (ray cast) — used to pick each edge's inward normal.
function ptInRingXY(x: number, y: number, ring: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// CAD-space vertex coincidence (fake-degrees, 1 unit ≈ 1 ft).
function sameVert(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return Math.abs(a.lat - b.lat) < 0.75 && Math.abs(a.lng - b.lng) < 0.75;
}

// Edge classification: an edge shared with ANOTHER facet (same endpoints, either
// order) is interior = ridge/hip; a perimeter edge is eave/rake. Drives both the
// per-edge fire-setback distance and the per-edge line weight.
function isInteriorEdge(
  a: { lat: number; lng: number }, b: { lat: number; lng: number },
  planes: any[], skipIdx: number,
): boolean {
  for (let pi = 0; pi < planes.length; pi++) {
    if (pi === skipIdx) continue;
    const vs = planes[pi].vertices as Array<{ lat: number; lng: number }>;
    for (let i = 0; i < vs.length; i++) {
      const u = vs[i], v = vs[(i + 1) % vs.length];
      if ((sameVert(u, a) && sameVert(v, b)) || (sameVert(u, b) && sameVert(v, a))) return true;
    }
  }
  return false;
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
  const condType    = (project.conduitType    || 'EMT').toUpperCase();
  const panelWatts  = engineering.panelWatts || 0;
  const moduleStr   = [project.moduleMfr, project.moduleModel].filter(Boolean).join(' ').toUpperCase()
    || 'PV MODULES — SEE EQUIPMENT SCHEDULE';
  const inverterStr = [project.inverterMfr, project.inverterModel].filter(Boolean).join(' ').toUpperCase()
    || 'MICROINVERTER — SEE EQUIPMENT SCHEDULE';
  const pitchNum    = project.roofPitch       || 5;
  const pitchStr    = pitchNum + ':12';
  const rafterSp    = project.rafterSpacing   || 24;
  const attachSp    = project.attachmentSpacing || 48;
  // Fire setbacks — CORRECT AHJ DATABASE SEMANTICS (Ray, 2026-07-01): per the
  // IFC code table behind applyCodeBasis, ahjRidgeSetbackIn is the FIRE SETBACK
  // (drawn as a band on every edge) and ahjRoofSetbackIn is the ACCESS PATHWAY
  // WIDTH — a designated 36" route requirement, NOT a uniform edge moat.
  // Hatching every eave/rake at the pathway width buried half the roof in red
  // and made code-compliant modules read as violations.
  const fireSetIn   = project.ahjRidgeSetbackIn || 18;
  const pathwayIn   = project.ahjRoofSetbackIn  || 36;
  const setbackFt   = fireSetIn / 12;
  const pathwayFt   = pathwayIn / 12;

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

  // ── Regularize the hand-traced geometry for DRAWING (display copy only) ──
  // Welds shared facet corners, straightens near-axis eaves/ridge, squares the
  // outline — ±1-2 ft trace noise rendered as amateur linework (wavy eaves,
  // dogleg ridge, asymmetric hips). Panels ride along via each facet's fitted
  // affine so rows stay flush to the straightened edges (they overhung the new
  // eave when only the planes moved). Stored geometry is untouched.
  const regPlanes = regularizeRoofPlanes(validPlanes as any[]);
  const regPanels = coTransformPanels(validPlanes as any[], regPlanes as any[], validPanels as any[]);

  // ── Layout zones (STEP 3) ──
  const zones = getLayoutForSystem('roof', 'plan');
  const W = zones.canvas.width;
  const H = zones.canvas.height;
  const dz = zones.draw;

  const els: string[] = [];
  // v65: pre-compute branch-color mode flag (needed for title bar)
  const isBranchColorMode = !!(panelColorById && panelColorById.size > 0);

  els.push(drawSVGOpen(W, H));
  // Pro-reference restyle (Ray, 2026-07-01: match the PE-sealed set): white sheet,
  // white roof linework, red-HATCHED setback bands, white modules w/ attachment
  // dots — monochrome CAD language instead of tinted fills ("cartoony").
  els.push(drawBackground(W, H, '#ffffff'));
  // Red diagonal hatch for the fire-setback band (the reference's signature mark).
  els.push(`<defs><pattern id="hatch-setback" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#cc2222" stroke-width="0.7"/></pattern></defs>`);
  // Viewport title (reference style) renders BELOW the drawing — the old
  // full-width solid-black banner read as a web dashboard, not a CAD sheet.
  const svgTitle = isBranchColorMode
    ? 'CIRCUIT LAYOUT — AC BRANCH COLOR MAP'
    : 'ROOF PLAN WITH MODULES';

  // ── GPS coordinate → SVG mapping ──
  const allLats = regPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lat));
  const allLngs = regPlanes.flatMap((rp: any) => rp.vertices!.map((v: any) => v.lng));
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
  const interiorEdgesXY: Array<{ ax: number; ay: number; bx: number; by: number }> = [];
  regPlanes.forEach((rp: any, ri: number) => {
    const ptsXY = rp.vertices!.map((v: any) => ({ x: toX(v.lng), y: toY(v.lat) }));
    const pts = ptsXY.map((p: { x: number; y: number }) => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

    // Roof plane — WHITE with fine black linework (reference CAD style; the gray
    // fills + shingle texture were the "cartoony" read).
    els.push(`<polygon points="${pts}" fill="#ffffff" stroke="none"/>`);

    // Per-edge fire-setback bands + line weights. Classification:
    //   interior (shared with another facet) = RIDGE/HIP → band + heavy line
    //   perimeter, outward normal ≈ downslope   = EAVE   → NO band (no code
    //     requirement — panels run to the gutter; Ray: "if there is no firewalk
    //     on the eave it needs to not show") + fine line
    //   perimeter otherwise                     = RAKE   → band + fine line
    const nV = ptsXY.length;
    const clipId = `sbclip${ri}`;
    els.push(`<defs><clipPath id="${clipId}"><polygon points="${pts}"/></clipPath></defs>`);
    const bands: string[] = [];
    const edgeLines: string[] = [];
    const az = (typeof rp.azimuth === 'number' && isFinite(rp.azimuth)) ? rp.azimuth : null;
    // downslope unit vector in (lng, lat) CAD space — azimuth 0° = faces north = +lat
    const dsX = az != null ? Math.sin(az * Math.PI / 180) : 0;
    const dsY = az != null ? Math.cos(az * Math.PI / 180) : 0;
    for (let ei = 0; ei < nV; ei++) {
      const a = ptsXY[ei], b = ptsXY[(ei + 1) % nV];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 2) continue;   // degenerate/closing dup
      const va = rp.vertices![ei], vb = rp.vertices![(ei + 1) % nV];
      const interior = isInteriorEdge(va, vb, regPlanes, ri);
      // Eave test (perimeter only): CAD-space OUTWARD normal vs the downslope dir.
      let isEave = false;
      if (!interior && az != null) {
        const eLng = vb.lng - va.lng, eLat = vb.lat - va.lat;
        const eLen = Math.hypot(eLng, eLat) || 1;
        let onX = -eLat / eLen, onY = eLng / eLen;
        const mLng = (va.lng + vb.lng) / 2, mLat = (va.lat + vb.lat) / 2;
        if (ptInLatLngRing(mLat + onY * 1.5, mLng + onX * 1.5, rp.vertices!)) { onX = -onX; onY = -onY; }
        isEave = (onX * dsX + onY * dsY) > 0.64;   // within ~50° of downslope
      }
      const dPx = setbackFt * scale;
      // Inward unit normal (screen space) — probe a point just off the midpoint.
      const ex = b.x - a.x, ey = b.y - a.y, el = Math.hypot(ex, ey);
      let nx = -ey / el, ny = ex / el;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!ptInRingXY(mx + nx * 3, my + ny * 3, ptsXY)) { nx = -nx; ny = -ny; }
      if (interior || !isEave) {
        const a2x = a.x + nx * dPx, a2y = a.y + ny * dPx;
        const b2x = b.x + nx * dPx, b2y = b.y + ny * dPx;
        bands.push(`<polygon points="${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)} ${a2x.toFixed(1)},${a2y.toFixed(1)}" fill="url(#hatch-setback)" opacity="0.6" stroke="none"/>`);
        bands.push(`<line x1="${a2x.toFixed(1)}" y1="${a2y.toFixed(1)}" x2="${b2x.toFixed(1)}" y2="${b2y.toFixed(1)}" class="line-setbk"/>`);
      }
      if (interior) interiorEdgesXY.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      edgeLines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#000" stroke-width="${interior ? 2.4 : 1.3}"/>`);
    }
    els.push(`<g clip-path="url(#${clipId})">${bands.join('')}</g>`);
    els.push(...edgeLines);

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

  // Reference-style modules: WHITE rectangle, fine dark-blue frame, attachment
  // dots at the rail-foot quarter points. Each module is ROTATED to its plane's
  // fall line (portrait long axis runs up-slope) — drawing every module
  // axis-aligned overlapped/poked-out the rotated end-plane (E/W) arrays.
  // PV-2B keeps solid branch-colored fills — that sheet IS a color map.
  regPanels.forEach((p: any) => {
    const px = toX(p.lng), py = toY(p.lat);
    const isLandscape = (p.orientation || 'landscape') === 'landscape';
    const pw = isLandscape ? panLenPx : panWidPx;
    const ph = isLandscape ? panWidPx : panLenPx;
    const x0 = px - pw / 2, y0 = py - ph / 2;
    const azRot = Number(p.azimuth ?? p.heading);
    // rotate so the long axis follows the plane azimuth; 0/180 ≈ no-op
    const rot = isFinite(azRot) ? ((azRot % 180) + 180) % 180 : 0;
    const gOpen = rot > 1 && rot < 179
      ? `<g transform="rotate(${rot.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})">` : '<g>';

    const branchFill = panelColorById?.get(p.id);
    if (branchFill) {
      els.push(`${gOpen}<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="${branchFill}" stroke="#0a1e4a" stroke-width="0.7" rx="0.4"/></g>`);
    } else {
      els.push(
        `${gOpen}` +
        `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}" fill="#fdfdfd" stroke="#2c4a75" stroke-width="0.8"/>` +
        `<circle cx="${px.toFixed(1)}" cy="${(py - ph / 4).toFixed(1)}" r="1.1" fill="#2a5db0"/>` +
        `<circle cx="${px.toFixed(1)}" cy="${(py + ph / 4).toFixed(1)}" r="1.1" fill="#2a5db0"/>` +
        `</g>`);
    }
  });

  // ── Plane labels (rendered last — placed in OPEN roof area, never over modules) ──
  const _panelPts = regPanels.map((p: any) => ({ x: toX(p.lng), y: toY(p.lat) }));
  planeLabels.forEach(L => {
    // candidate positions: centroid, then nudges along both axes — first one
    // clear of every module center wins (critique: labels were masking modules)
    const _cands = [
      { x: L.cx, y: L.cy },
      { x: L.cx, y: L.cy - 26 }, { x: L.cx, y: L.cy + 26 },
      { x: L.cx - 34, y: L.cy }, { x: L.cx + 34, y: L.cy },
      { x: L.cx - 34, y: L.cy - 26 }, { x: L.cx + 34, y: L.cy - 26 },
    ];
    const _clear = _cands.find(c => !_panelPts.some(p => Math.abs(p.x - c.x) < 40 && Math.abs(p.y - c.y) < 26));
    if (_clear) { L.cx = _clear.x; L.cy = _clear.y; }
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
    const facets = regPlanes.map((rp: any, i: number) => ({
      n: i + 1,
      mods: regPanels.filter((p: any) => ptInLatLngRing(p.lat, p.lng, rp.vertices)).length,
      az: rp.azimuth != null && isFinite(rp.azimuth) ? `${Math.round(rp.azimuth)}°` : '—',
      tilt: rp.pitch != null && isFinite(rp.pitch) ? `${Math.round(rp.pitch)}°` : '—',
    }));
    const roofAreaFt2  = regPlanes.reduce((s: number, rp: any) => s + planViewAreaFt2(rp.vertices), 0);
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
    // framing note under the table (one term sheet-wide — was TRUSS here vs
    // RAFTER in SYSTEM DATA, which structural reviewers flag)
    t.push(drawText(tx, ty + tblH + 8, `FRAMING: ${trussSize} @ ${trussSpacing}`, { anchor: 'start', fontSize: 5, fill: '#555' }));

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

    // ── GENERAL NOTES — numbered, upright, in the left column (replaces the
    // single low-contrast italic footer line the critique flagged) ──
    const gnY = cy2 + calcH + 16;
    const gn: string[] = [
      '1. FIELD VERIFY ALL DIMENSIONS PRIOR',
      '   TO INSTALLATION.',
      `2. MAINTAIN ${ftToFtIn(pathwayFt)} ACCESS PATHWAY PER`,
      '   AHJ — IFC §1204.2. HIP CLEARANCES',
      '   PROVIDE EAVE-TO-RIDGE ROUTES.',
      '3. ATTACHMENT SUBJECT TO FRAMING',
      '   LOCATION — SEE PV-3.',
      '4. NO ROOF OBSTRUCTIONS MODELED IN',
      '   ARRAY AREA — FIELD VERIFY.',
    ];
    t.push(drawText(tx, gnY, 'GENERAL NOTES', { anchor: 'start', fontSize: 6, fontWeight: 'bold', fill: '#000' }));
    t.push(`<line x1="${tx}" y1="${gnY + 2.5}" x2="${tx + tblW}" y2="${gnY + 2.5}" stroke="#000" stroke-width="0.8"/>`);
    gn.forEach((line, i) => {
      t.push(drawText(tx, gnY + 11 + i * 8, line, { anchor: 'start', fontSize: 5.2, fill: '#1a1a1a' }));
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

  // L1 — Overall width (bottom) — PV-2 only. Value only: the "VERIFY IN FIELD"
  // qualifier moved to GENERAL NOTES (critique: dim string was heavy + crowded).
  if (!isBranchColorMode) {
  els.push(drawOverallDimension(
    roofMinX, roofMaxX,
    roofMaxY + 36, 24,
    ftToFtIn(roofWFt)
  ));
  }

  // L1 — Overall height (vertical) — tight against the roof outline; at the old
  // draw-zone edge its extension line struck through both data tables.
  if (!isBranchColorMode && roofHFt > 3) {
    els.push(drawVerticalDimension(
      roofMinX - 26,
      roofMinY, roofMaxY,
      14,
      ftToFtIn(roofHFt)
    ));
  }
  // (fire-setback mini-dimension removed — it rendered as a broken-leader
  // artifact; the legend + callout ② carry the value)

  // ── North arrow + scale bar ──
  // North: PV-2B keeps the simple arrow; PV-2 gets a full N/E/S/W compass rose below.
  if (isBranchColorMode) {
    els.push(drawNorthArrow(W - zones.dims.right - 18, H - zones.dims.bottom + 26, 22));
  }
  const scaleBarPx = Math.max(Math.round(10 * scale), 30);   // 10-foot scale bar
  const sbX = zones.dims.left + 4, sbY = H - zones.dims.bottom + 28;
  els.push(drawScaleBar(sbX, sbY, scaleBarPx, ''));
  // labels aligned to the graduations (was one crammed '0    10 FT' string)
  els.push(drawText(sbX, sbY + 12, '0', { anchor: 'middle', fontSize: 5.5, fill: '#1a1a1a' }));
  els.push(drawText(sbX + scaleBarPx / 2, sbY + 12, '5', { anchor: 'middle', fontSize: 5.5, fill: '#1a1a1a' }));
  els.push(drawText(sbX + scaleBarPx, sbY + 12, '10 FT', { anchor: 'middle', fontSize: 5.5, fill: '#1a1a1a' }));

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
    const _sbHatch = `<rect x="0" y="-5" width="14" height="9" fill="url(#hatch-setback)" opacity="0.6" stroke="#cc2222" stroke-width="0.5"/>`;
    const lg: Array<{ swatch: string; label: string }> = [
      { swatch: `<rect x="0" y="-5" width="14" height="9" fill="#fdfdfd" stroke="#2c4a75" stroke-width="0.7"/><circle cx="7" cy="-0.5" r="1.2" fill="#2a5db0"/>`, label: 'PV MODULE' },
      { swatch: _sbHatch, label: `${ftToFtIn(setbackFt)} FIRE SETBACK` },
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#000" stroke-width="2.4"/>`, label: 'RIDGE / HIP' },
      { swatch: `<line x1="0" y1="0" x2="14" y2="0" stroke="#000" stroke-width="1.1"/>`, label: 'EAVE / RAKE' },
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

  // ── Direct equipment callouts (PV-2 only — reference-set style) ──
  // The pro sets annotate the PLAN with real "(N) make/model" text + short
  // leaders — numbered bubbles wired to a remote schedule read as generated.
  // Placement uses the white space above/below/beside the roof; every leader
  // lands on a representative object and never crosses the array.
  if (!isBranchColorMode && _panelPts.length > 0) {
    const topP  = _panelPts.reduce((m, p) => (p.y < m.y ? p : m), _panelPts[0]);
    const botP  = _panelPts.reduce((m, p) => (p.y > m.y ? p : m), _panelPts[0]);
    const eastP = _panelPts.reduce((m, p) => (p.x > m.x ? p : m), _panelPts[0]);
    let ridge: any = null, hip: any = null;
    for (const e of interiorEdgesXY) {
      const len = Math.hypot(e.bx - e.ax, e.by - e.ay);
      const horiz = Math.abs(e.by - e.ay) < Math.abs(e.bx - e.ax) * 0.4;
      if (horiz) { if (!ridge || len > ridge.len) ridge = { ...e, len }; }
      else       { if (!hip   || len > hip.len)   hip   = { ...e, len }; }
    }
    const txtCallout = (
      tx: number, ty: number, anchor: 'start' | 'end',
      lines: string[], lx: number, ly: number,
    ) => {
      lines.forEach((ln, i) => {
        els.push(drawText(tx, ty + i * 7.5, ln, { anchor, fontSize: 5.8, fontWeight: i === 0 ? 'bold' : 'normal', fill: '#000' }));
      });
      const sx = anchor === 'start' ? tx - 3 : tx + 3;
      els.push(`<line x1="${sx.toFixed(1)}" y1="${(ty + (lines.length - 1) * 3.75).toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#000" stroke-width="0.7"/>`);
      els.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="1.4" fill="#000"/>`);
    };
    const wattStr = panelWatts ? ` (${panelWatts}W)` : '';
    const topRowY = Math.max(roofMinY - 30, zones.dims.top + 10);

    // (N) modules — top-left white space, leader to a top-row module
    txtCallout(roofMinX - 4, topRowY, 'start',
      [`(N) ${totalPanels} — ${moduleStr}${wattStr}`, `MODULES ON ${mountSys}`],
      topP.x - 6, topP.y - 4);
    // (N) microinverters — top-right white space, leader to a nearby module dot
    const invTarget = _panelPts.filter(p => p.y < roofMinY + (roofMaxY - roofMinY) * 0.5)
      .reduce((m, p) => (p.x > m.x ? p : m), _panelPts[0]);
    txtCallout(roofMaxX + 4, topRowY, 'end',
      [`(N) ${inverterStr}`, `MICROINVERTER — 1 PER MODULE`],
      invTarget.x + 4, invTarget.y);
    // fire setback — left side, leader to the hip band
    if (hip) {
      const hx = (hip.ax + hip.bx) / 2, hy = (hip.ay + hip.by) / 2;
      txtCallout(roofMinX - 34, hy - 24, 'start',
        [`${ftToFtIn(setbackFt)} FIRE SETBACK (TYP.)`, `RIDGE / HIPS / RAKES`],
        hx - (hx - hip.ax) / 2, hy - (hy - hip.ay) / 2);
    }
    // ridge label — leader to the ridge west end
    if (ridge) {
      const wEnd = ridge.ax < ridge.bx ? { x: ridge.ax, y: ridge.ay } : { x: ridge.bx, y: ridge.by };
      txtCallout(roofMinX - 34, wEnd.y + 30, 'start', ['(E) RIDGE'], wEnd.x + 10, wEnd.y - 1);
    }
    // (N) junction box — square symbol on the roof near the east array edge,
    // then the dashed conduit route from the JB to the SE eave exit point
    const jbX = eastP.x + 12, jbY = eastP.y;
    els.push(`<rect x="${(jbX - 3.5).toFixed(1)}" y="${(jbY - 3.5).toFixed(1)}" width="7" height="7" fill="#fff" stroke="#000" stroke-width="1"/>`);
    els.push(`<line x1="${(jbX - 3.5).toFixed(1)}" y1="${(jbY - 3.5).toFixed(1)}" x2="${(jbX + 3.5).toFixed(1)}" y2="${(jbY + 3.5).toFixed(1)}" stroke="#000" stroke-width="0.6"/>`);
    const cEndX = roofMaxX - 8, cEndY = roofMaxY - 6;
    els.push(`<polyline points="${jbX.toFixed(1)},${jbY.toFixed(1)} ${cEndX.toFixed(1)},${cEndY.toFixed(1)}" fill="none" stroke="#444" stroke-width="1" stroke-dasharray="5 3"/>`);
    txtCallout(roofMaxX + 4, jbY - 14, 'end', [`(N) JUNCTION BOX`], jbX + 3, jbY - 3);
    txtCallout(roofMaxX + 4, roofMaxY + 10, 'end',
      [`(N) 3/4" ${condType} CONDUIT RUN`, `ROUTE FIELD-VERIFIED`],
      (jbX + cEndX) / 2, (jbY + cEndY) / 2);
    // (N) attachments — bottom-left, leader to a bottom-row module dot
    txtCallout(roofMinX - 4, roofMaxY + 14, 'start',
      [`(N) ${mountSys} ATTACHMENTS`, `@ ${attachSp}" O.C. INTO FRAMING — SEE PV-3`],
      botP.x - 4, botP.y + 4);
  }

  // ── Viewport title (reference style): numbered circle + underlined title +
  // scale, directly below the drawing ──
  if (!isBranchColorMode) {
    const vtX = roofMinX, vtY = roofMaxY + 62;
    els.push(`<circle cx="${vtX + 8}" cy="${vtY - 3}" r="8" fill="#fff" stroke="#000" stroke-width="1.4"/>`);
    els.push(drawText(vtX + 8, vtY, '1', { anchor: 'middle', fontSize: 8, fontWeight: '900', fill: '#000' }));
    els.push(drawText(vtX + 22, vtY, svgTitle, { anchor: 'start', fontSize: 9, fontWeight: '900', fill: '#000', letterSpacing: 1 }));
    els.push(`<line x1="${vtX + 22}" y1="${vtY + 3.5}" x2="${vtX + 22 + svgTitle.length * 6.4}" y2="${vtY + 3.5}" stroke="#000" stroke-width="1.2"/>`);
    els.push(drawText(vtX + 22, vtY + 11, 'SCALE: 3/32" = 1\'-0"', { anchor: 'start', fontSize: 6, fill: '#333' }));
  } else {
    els.push(drawText(dz.x + 8, zones.dims.top + 16, svgTitle, { anchor: 'start', fontSize: 9, fontWeight: '900', fill: '#000', letterSpacing: 1 }));
  }

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

  // ── System summary line (PV-2B only — PV-2 carries GENERAL NOTES instead) ──
  if (isBranchColorMode) {
    els.push(drawText(zones.dims.left, H - zones.dims.bottom + 12,
      'CIRCUIT LAYOUT — AC BRANCH COLOR MAP — SEE DATA ZONE FOR BRANCH SCHEDULE', {
        anchor: 'start', fontSize: 6.5, fill: '#888', italic: true,
      }));
  }

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