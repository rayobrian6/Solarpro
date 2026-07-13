// ═══════════════════════════════════════════════════════════════
// Drawing Utilities — drawDimension, mercPx, buildSchemSVG,
// getPrimaryView, getSecondaryView, composeDrawPage, escapeH
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, DimOpts } from '../types';
import type { CADModel } from '@/lib/cad/types';
import type { RenderContext } from '@/lib/drafting/renderContext';
import {
  getSheetComposition, buildLayoutFromComposition, validateSheetComposition, validateSheet,
  getFenceData, getGroundData, getRoofData,
  type SheetComposition, type PrimaryViewId, type SecondaryViewId,
} from '@/lib/drafting/sheetComposition';
import { drawingEngine } from '@/lib/drafting';
import { titleBlock } from './titleBlock';
import { resolveEquipment } from './helpers';

// ══════════════════════════════════════════════════════════════════════════════
// DIMENSION ENGINE — drawDimension()
// Renders a CAD-standard dimension annotation in SVG.
// Supports horizontal and vertical orientations.
// Used across ALL drawing sheets.
// ══════════════════════════════════════════════════════════════════════════════
export function drawDimension(
  x1: number, y1: number,
  x2: number, y2: number,
  label: string,
  opts: DimOpts = {}
): string {
  const col  = opts.color    ?? '#c00';
  const fs   = opts.fontSize ?? 7;
  const tick = opts.tickLen  ?? 5;
  const off  = opts.offset   ?? 9;
  const arr  = opts.arrowLen ?? 7;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len < 1) return '';

  const mx = (x1+x2)/2, my = (y1+y2)/2;
  const isH = Math.abs(dx) >= Math.abs(dy); // horizontal vs vertical

  // Dimension line
  let svg = `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`;

  // Arrow heads
  if (isH) {
    // left arrow
    svg += `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${(x1+arr).toFixed(1)},${(y1-3).toFixed(1)} ${(x1+arr).toFixed(1)},${(y1+3).toFixed(1)}" fill="${col}"/>`;
    // right arrow
    svg += `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${(x2-arr).toFixed(1)},${(y2-3).toFixed(1)} ${(x2-arr).toFixed(1)},${(y2+3).toFixed(1)}" fill="${col}"/>`;
    // tick marks
    svg += `<line x1="${x1.toFixed(1)}" y1="${(y1-tick).toFixed(1)}" x2="${x1.toFixed(1)}" y2="${(y1+tick).toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`;
    svg += `<line x1="${x2.toFixed(1)}" y1="${(y2-tick).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y2+tick).toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`;
    // label above line
    svg += `<text x="${mx.toFixed(1)}" y="${(my-off).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fs}" fill="${col}" font-weight="bold">${label}</text>`;
  } else {
    // up arrow
    svg += `<polygon points="${x1.toFixed(1)},${y1.toFixed(1)} ${(x1-3).toFixed(1)},${(y1+arr).toFixed(1)} ${(x1+3).toFixed(1)},${(y1+arr).toFixed(1)}" fill="${col}"/>`;
    // down arrow
    svg += `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${(x2-3).toFixed(1)},${(y2-arr).toFixed(1)} ${(x2+3).toFixed(1)},${(y2-arr).toFixed(1)}" fill="${col}"/>`;
    // tick marks
    svg += `<line x1="${(x1-tick).toFixed(1)}" y1="${y1.toFixed(1)}" x2="${(x1+tick).toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`;
    svg += `<line x1="${(x2-tick).toFixed(1)}" y1="${y2.toFixed(1)}" x2="${(x2+tick).toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="0.8"/>`;
    // label to right
    svg += `<text x="${(mx+off).toFixed(1)}" y="${my.toFixed(1)}" text-anchor="start" font-family="Arial,sans-serif" font-size="${fs}" fill="${col}" font-weight="bold" dominant-baseline="middle">${label}</text>`;
  }

  return svg;
}


// ─── Helpers ─────────────────────────────────────────────────────────────────



export function mercPx(
  lat: number, lng: number,
  cLat: number, cLng: number,
  ppm: number,           // pixels per metre
  svgCx: number, svgCy: number
): { x: number; y: number } {
  const MPD_LAT = 111320;
  const mpd_lng = 111320 * Math.cos(cLat * Math.PI / 180);
  return {
    x: svgCx + (lng - cLng) * mpd_lng * ppm,
    y: svgCy - (lat - cLat) * MPD_LAT * ppm,
  };
}

/** Build the schematic SVG drawing from roof plane + panel GPS data
 *  v2 — Professional plan style matching permit drawing standards:
 *  - Diagonal hatch on each roof plane (SVG clipPath, 45° lines)
 *  - Correct portrait/landscape panel sizing via GPS mercator projection
 *  - Array bounding boxes with dashed blue outline + label
 *  - Pitch labels at plane centroids (white pill background)
 *  - North compass, module badge, scale bar
 *  - Property line dashed rect, street name header
 */
export function buildSchemSVG(
  roofPlanes: Array<{id?:string; vertices?:Array<{lat:number;lng:number}>; pitch?:number; azimuth?:number; area?:number; edgeTypes?:string[]; source?:string; confirmed?:boolean; planeHeightAtCenterMeters?:number}> | undefined,
  panelPos:   Array<{lat:number;lng:number;orientation?:string;row?:number;col?:number;arrayId?:string}> | undefined,
  totalPanels: number,
  totalDcKw:  number | undefined,
  panelLenIn: number,
  panelWidIn: number,
  svgW: number,
  svgH: number,
  addr: string,
  city: string
): string {

  // ── Collect valid GPS data ────────────────────────────────────────────────
  const validPlanes = (roofPlanes || []).filter(
    rp => rp.vertices && rp.vertices.length >= 3 &&
          rp.vertices.every(v => isFinite(v.lat) && isFinite(v.lng) && Math.abs(v.lat) > 0.001)
  );
  const validPanels = (panelPos || []).filter(
    p => p.lat && p.lng && isFinite(p.lat) && isFinite(p.lng) &&
         Math.abs(p.lat) > 0.001 && Math.abs(p.lng) > 0.001
  );
  const hasPlanesData = validPlanes.length > 0;
  const hasPanelsData = validPanels.length > 0;

  // ── Fallback: no GPS data ─────────────────────────────────────────────────
  if (!hasPlanesData && !hasPanelsData) {
    return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
      style="display:block;background:#e8edf3;border:1.5px solid #374151;max-width:100%;"
      xmlns="http://www.w3.org/2000/svg">
      <rect width="${svgW}" height="${svgH}" fill="#e8edf3"/>
      <rect x="40" y="40" width="${svgW-80}" height="${svgH-80}" fill="none" stroke="#374151" stroke-width="1" stroke-dasharray="8,4"/>
      <text x="${svgW/2}" y="${svgH/2 - 20}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" fill="#999" font-weight="700">ROOF PLAN — GPS DATA REQUIRED</text>
      <text x="${svgW/2}" y="${svgH/2 + 2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#999">Complete 3D layout in Design Studio to generate roof plan</text>
      <text x="${svgW/2}" y="${svgH/2 + 20}" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#999">Address: ${addr}</text>
      <g transform="translate(50, ${svgH - 50})">
        <circle cx="0" cy="0" r="21" fill="white" stroke="#374151" stroke-width="1.8"/>
        <polygon points="0,-15 5,9 0,3 -5,9" fill="#000"/>
        <polygon points="0,15 5,-9 0,-3 -5,-9" fill="#999"/>
        <text x="0" y="-19" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="900" fill="#000">N</text>
        <text x="0" y="31" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">S</text>
        <text x="-29" y="5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">W</text>
        <text x="29" y="5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">E</text>
      </g>
    </svg>`;
  }

  // ── Compute bounding box ──────────────────────────────────────────────────
  const allLats: number[] = [];
  const allLngs: number[] = [];
  validPlanes.forEach(rp => rp.vertices!.forEach(v => { allLats.push(v.lat); allLngs.push(v.lng); }));
  validPanels.forEach(p  => { allLats.push(p.lat); allLngs.push(p.lng); });
  const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs), maxLng = Math.max(...allLngs);
  const cLat   = (minLat + maxLat) / 2;
  const cLng   = (minLng + maxLng) / 2;

  // ── Pixels-per-metre ──────────────────────────────────────────────────────
  const pad     = 60;
  const drawW   = svgW - pad * 2;
  const drawH   = svgH - pad * 2 - 20;
  const MPD_LAT = 111320;
  const mpd_lng = 111320 * Math.cos(cLat * Math.PI / 180);
  const spanM_lat = (maxLat - minLat) * MPD_LAT || 10;
  const spanM_lng = (maxLng - minLng) * mpd_lng  || 10;
  const ppm = Math.min(drawW / spanM_lng, drawH / spanM_lat) * 0.82;
  const svgCx = svgW / 2;
  const svgCy = svgH / 2 - 5;

  function toSVG(lat: number, lng: number): { x: number; y: number } {
    return mercPx(lat, lng, cLat, cLng, ppm, svgCx, svgCy);
  }

  // ── Panel physical size in SVG pixels ─────────────────────────────────────
  const pLenM = panelLenIn * 0.0254;   // long edge (portrait: N-S)
  const pWidM = panelWidIn * 0.0254;   // short edge (portrait: E-W)
  const pLpx  = Math.max(5, pLenM * ppm);  // portrait: tall dimension (N-S pixels)
  const pWpx  = Math.max(3, pWidM * ppm);  // portrait: wide dimension (E-W pixels)

  let defs   = '';
  let svgInner = '';

  // ── Property boundary (dashed rect from bounding box) ─────────────────────
  const margin = 42;
  const bboxTL = toSVG(maxLat, minLng);
  const bboxBR = toSVG(minLat, maxLng);
  const propX  = bboxTL.x - margin, propY = bboxTL.y - margin;
  const propW  = bboxBR.x - bboxTL.x + margin * 2;
  const propH  = bboxBR.y - bboxTL.y + margin * 2;
  svgInner += `<rect x="${propX.toFixed(1)}" y="${propY.toFixed(1)}" width="${propW.toFixed(1)}" height="${propH.toFixed(1)}"
    fill="none" stroke="#999" stroke-width="1.2" stroke-dasharray="10,5"/>`;

  // Street label (top centre, outside property boundary)
  svgInner += `<text x="${svgCx.toFixed(1)}" y="${(propY - 8).toFixed(1)}" text-anchor="middle"
    font-family="Arial,sans-serif" font-size="11" font-weight="900" fill="#000" letter-spacing="3">${city || 'PROJECT STREET'}</text>`;

  // ── Roof planes: define SVG clipPaths for hatch clipping ──────────────────
  validPlanes.slice(0, 12).forEach((plane, pi) => {
    const verts = plane.vertices!.map(v => toSVG(v.lat, v.lng));
    const pts   = verts.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
    defs += `<clipPath id="rp${pi}"><polygon points="${pts}"/></clipPath>`;
  });

  // Hatch pattern definition (45° diagonal lines, 6px spacing)
  defs += `<pattern id="hatch45" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#8a9aaa" stroke-width="0.8"/>
  </pattern>`;

  // ── Roof planes: flat fill pass ───────────────────────────────────────────
  const ROOF_FILL = '#d4d9e0';
  validPlanes.slice(0, 12).forEach((plane, pi) => {
    const verts = plane.vertices!.map(v => toSVG(v.lat, v.lng));
    const pts   = verts.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
    // Base fill
    svgInner += `<polygon points="${pts}" fill="${ROOF_FILL}" stroke="none"/>`;
    // Diagonal hatch overlay clipped to this plane
    svgInner += `<rect x="0" y="0" width="${svgW}" height="${svgH}"
      fill="url(#hatch45)" clip-path="url(#rp${pi})" opacity="0.55"/>`;
  });

  // ── Roof planes: architectural edge-type stroke pass ─────────────────────────────
  // Edge type conventions (standard architectural plan view):
  //   ridge  = heavy solid (#000, 3.5px) — peak/ridge line
  //   eave   = heavy solid (#000, 2.8px) — bottom edge / fascia
  //   hip    = medium solid (#000, 2.2px) — diagonal hip rafter
  //   valley = medium dashed (#333, 2px, dash 6/3) — valley / internal corner
  //   rake   = medium solid (#000, 2px) — gable end
  //   wall   = light solid (#555, 1.5px) — wall / parapet edge
  //   unknown = standard solid (#000, 2px)
  //
  // When edgeTypes[] is populated (from Solar API), each edge is drawn individually.
  // When edgeTypes[] is absent (manually drawn planes), uniform bold outline is used.

  validPlanes.slice(0, 12).forEach((plane) => {
    const verts = plane.vertices!.map(v => toSVG(v.lat, v.lng));
    const n = verts.length;
    const hasEdgeTypes = plane.edgeTypes && plane.edgeTypes.length === n;

    if (hasEdgeTypes) {
      // Per-edge architectural drawing
      for (let i = 0; i < n; i++) {
        const v1 = verts[i];
        const v2 = verts[(i + 1) % n];
        const et = plane.edgeTypes![i] ?? 'unknown';

        let stroke = '#000';
        let sw = 2;
        let dash = '';

        switch (et) {
          case 'ridge':
            stroke = '#000'; sw = 3.5; dash = '';
            break;
          case 'eave':
            stroke = '#000'; sw = 2.8; dash = '';
            break;
          case 'hip':
            stroke = '#000'; sw = 2.2; dash = '';
            break;
          case 'valley':
            stroke = '#000'; sw = 2.0; dash = '6,3';
            break;
          case 'rake':
            stroke = '#333'; sw = 2.0; dash = '';
            break;
          case 'wall':
            stroke = '#555'; sw = 1.5; dash = '';
            break;
          default:
            stroke = '#000'; sw = 2.0; dash = '';
        }

        const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
        svgInner += `<line x1="${v1.x.toFixed(1)}" y1="${v1.y.toFixed(1)}" x2="${v2.x.toFixed(1)}" y2="${v2.y.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"${dashAttr}/>`;

        // Ridge: draw a perpendicular tick at midpoint to mark it clearly
        if (et === 'ridge') {
          const mx = (v1.x + v2.x) / 2;
          const my = (v1.y + v2.y) / 2;
          const dx = v2.x - v1.x, dy = v2.y - v1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            const px = -dy / len * 5, py = dx / len * 5;
            svgInner += `<line x1="${(mx - px).toFixed(1)}" y1="${(my - py).toFixed(1)}" x2="${(mx + px).toFixed(1)}" y2="${(my + py).toFixed(1)}" stroke="#000" stroke-width="1.5"/>`;
          }
        }
      }

      // Draw vertices as small junction dots
      verts.forEach(v => {
        svgInner += `<circle cx="${v.x.toFixed(1)}" cy="${v.y.toFixed(1)}" r="2" fill="#000" stroke="white" stroke-width="0.8"/>`;
      });

    } else {
      // Fallback: uniform bold outline (manually drawn planes, no edgeTypes)
      const pts = verts.map(v => `${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
      svgInner += `<polygon points="${pts}" fill="none" stroke="#2d3748" stroke-width="2.2" stroke-linejoin="miter"/>`;
    }
  });

  // Edge type legend (bottom-right, only when edgeTypes data present)
  const anyHasEdgeTypes = validPlanes.some(p => p.edgeTypes && p.edgeTypes.length > 0);
  if (anyHasEdgeTypes) {
    const legX = svgW - 148, legY = svgH - 120;
    const legItems: Array<{label:string; stroke:string; sw:number; dash:string}> = [
      { label: 'RIDGE',  stroke: '#000', sw: 3.5, dash: '' },
      { label: 'EAVE',   stroke: '#000', sw: 2.8, dash: '' },
      { label: 'HIP',    stroke: '#000', sw: 2.2, dash: '' },
      { label: 'VALLEY', stroke: '#000', sw: 2.0, dash: '6,3' },
      { label: 'RAKE',   stroke: '#333', sw: 2.0, dash: '' },
    ];
    svgInner += `<rect x="${(legX-6).toFixed(1)}" y="${(legY-14).toFixed(1)}" width="142" height="${(legItems.length * 17 + 20).toFixed(1)}" rx="3" fill="rgba(255,255,255,0.93)" stroke="#999" stroke-width="0.8"/>`;
    svgInner += `<text x="${(legX+65).toFixed(1)}" y="${(legY-2).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="7.5" font-weight="900" fill="#000" letter-spacing="1">EDGE TYPE LEGEND</text>`;
    legItems.forEach((item, li) => {
      const iy = legY + li * 17 + 8;
      const dashAttr = item.dash ? ` stroke-dasharray="${item.dash}"` : '';
      svgInner += `<line x1="${legX.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${(legX+36).toFixed(1)}" y2="${iy.toFixed(1)}" stroke="${item.stroke}" stroke-width="${item.sw}" stroke-linecap="round"${dashAttr}/>`;
      svgInner += `<text x="${(legX+44).toFixed(1)}" y="${(iy+3.5).toFixed(1)}" font-family="Arial,sans-serif" font-size="8" fill="#000">${item.label}</text>`;
    });
  }

  // ── Panels ────────────────────────────────────────────────────────────────
  const arrayGroups = new Map<string, typeof validPanels>();
  validPanels.forEach(p => {
    const key = p.arrayId || 'A1';
    if (!arrayGroups.has(key)) arrayGroups.set(key, []);
    arrayGroups.get(key)!.push(p);
  });

  validPanels.slice(0, 800).forEach(pp => {
    const {x, y} = toSVG(pp.lat, pp.lng);
    const isL = pp.orientation === 'landscape';
    // portrait: pWpx wide (E-W), pLpx tall (N-S)
    // landscape: pLpx wide (E-W), pWpx tall (N-S)
    const pw = isL ? pLpx : pWpx;
    const ph = isL ? pWpx : pLpx;
    svgInner += `<rect x="${(x-pw/2).toFixed(1)}" y="${(y-ph/2).toFixed(1)}" width="${pw.toFixed(1)}" height="${ph.toFixed(1)}"
      fill="rgba(25,70,190,0.88)" stroke="#2060b0" stroke-width="0.7" rx="0.5"/>`;
    // Cell dividers
    svgInner += `<line x1="${(x-pw/2).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x+pw/2).toFixed(1)}" y2="${y.toFixed(1)}"
      stroke="rgba(147,197,253,0.4)" stroke-width="0.4"/>`;
    svgInner += `<line x1="${x.toFixed(1)}" y1="${(y-ph/2).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y+ph/2).toFixed(1)}"
      stroke="rgba(147,197,253,0.4)" stroke-width="0.4"/>`;
  });

  // ── Array bounding boxes + labels ─────────────────────────────────────────
  let arrIdx = 0;
  arrayGroups.forEach((panels, _key) => {
    if (panels.length === 0) return;
    const svgPts = panels.map(p => toSVG(p.lat, p.lng));
    const orient = panels[0].orientation || 'landscape';
    const pw = orient === 'portrait' ? pWpx : pLpx;
    const ph = orient === 'portrait' ? pLpx : pWpx;
    const xs  = svgPts.map(p => p.x), ys = svgPts.map(p => p.y);
    const bx0 = Math.min(...xs) - pw/2 - 5;
    const by0 = Math.min(...ys) - ph/2 - 5;
    const bx1 = Math.max(...xs) + pw/2 + 5;
    const by1 = Math.max(...ys) + ph/2 + 5;
    const bw  = bx1 - bx0, bh = by1 - by0;
    svgInner += `<rect x="${bx0.toFixed(1)}" y="${by0.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"
      fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="6,3"/>`;
    const labelTxt = `ARRAY ${arrIdx + 1} — ${panels.length} MODULES`;
    const tagW = Math.min(bw - 4, 140), tagH = 14;
    const tagX = bx0 + (bw - tagW) / 2;
    const tagY = by1 - tagH - 4;
    svgInner += `<rect x="${tagX.toFixed(1)}" y="${tagY.toFixed(1)}" width="${tagW.toFixed(1)}" height="${tagH}" rx="2" fill="rgba(30,64,175,0.92)"/>`;
    svgInner += `<text x="${(tagX+tagW/2).toFixed(1)}" y="${(tagY+9.5).toFixed(1)}" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="7.5" font-weight="700" fill="white">${labelTxt}</text>`;
    arrIdx++;
  });

  // ── Pitch labels at centroid of each plane ────────────────────────────────
  validPlanes.slice(0, 12).forEach(plane => {
    const verts  = plane.vertices!.map(v => toSVG(v.lat, v.lng));
    const cx2    = verts.reduce((s,v)=>s+v.x,0)/verts.length;
    const cy2    = verts.reduce((s,v)=>s+v.y,0)/verts.length;
    const pitchDeg = plane.pitch ?? 0;
    const rise12   = Math.round(Math.tan(pitchDeg * Math.PI / 180) * 12);
    const pitchStr = rise12 > 0 ? `${rise12}/12` : `FLAT`;
    svgInner += `<rect x="${(cx2-17).toFixed(1)}" y="${(cy2-13).toFixed(1)}" width="34" height="15" rx="3"
      fill="rgba(255,255,255,0.93)" stroke="rgba(100,116,139,0.6)" stroke-width="0.6"/>`;
    svgInner += `<text x="${cx2.toFixed(1)}" y="${(cy2-2).toFixed(1)}" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="8.5" font-weight="700" fill="#000">${pitchStr}</text>`;
  });

  // ── Scale bar (bottom centre, 10m reference) ──────────────────────────────
  const scaleM   = 10;
  const scalePx  = scaleM * ppm;
  const scaleX0  = svgCx - scalePx / 2;
  const scaleY   = svgH - 18;
  if (scalePx > 8 && scalePx < 300) {
    svgInner += `<g>
      <line x1="${scaleX0.toFixed(1)}" y1="${scaleY}" x2="${(scaleX0+scalePx).toFixed(1)}" y2="${scaleY}" stroke="#374151" stroke-width="2"/>
      <line x1="${scaleX0.toFixed(1)}" y1="${(scaleY-4)}" x2="${scaleX0.toFixed(1)}" y2="${(scaleY+4)}" stroke="#374151" stroke-width="1.5"/>
      <line x1="${(scaleX0+scalePx).toFixed(1)}" y1="${(scaleY-4)}" x2="${(scaleX0+scalePx).toFixed(1)}" y2="${(scaleY+4)}" stroke="#374151" stroke-width="1.5"/>
      <text x="${(scaleX0-4).toFixed(1)}" y="${(scaleY+4)}" text-anchor="end" font-family="Arial,sans-serif" font-size="7.5" fill="#374151">0</text>
      <text x="${(scaleX0+scalePx+4).toFixed(1)}" y="${(scaleY+4)}" text-anchor="start" font-family="Arial,sans-serif" font-size="7.5" fill="#374151">10m</text>
      <text x="${(scaleX0+scalePx/2).toFixed(1)}" y="${(scaleY-6)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="7" fill="#374151">SCALE: 1/8&quot;=1&apos;-0&quot; (NTS)</text>
    </g>`;
  } else {
    svgInner += `<text x="${svgCx.toFixed(1)}" y="${svgH - 7}" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="8" fill="#374151">SCALE: NTS — FIELD VERIFY ALL DIMENSIONS</text>`;
  }

  // ── North compass rose (bottom-left) ──────────────────────────────────────
  svgInner += `
    <g transform="translate(44, ${svgH - 44})">
      <circle cx="0" cy="0" r="22" fill="white" stroke="#374151" stroke-width="1.8"/>
      <polygon points="0,-16 5,9 0,3 -5,9" fill="#000"/>
      <polygon points="0,16 5,-9 0,-3 -5,-9" fill="#999"/>
      <text x="0" y="-20" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="900" fill="#000">N</text>
      <text x="0" y="32" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">S</text>
      <text x="-30" y="5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">W</text>
      <text x="30" y="5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" fill="#374151">E</text>
    </g>`;

  // ── Module badge (bottom-right) ───────────────────────────────────────────
  svgInner += `
    <rect x="${(svgW - 230).toFixed(1)}" y="${(svgH - 34).toFixed(1)}" width="224" height="22" rx="4" fill="rgba(30,64,175,0.92)"/>
    <text x="${(svgW - 118).toFixed(1)}" y="${(svgH - 19).toFixed(1)}" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="10.5" font-weight="bold" fill="white">${totalPanels} MODULES — ${totalDcKw?.toFixed(2) || '—'} kW DC</text>`;

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"
    style="display:block;background:#e8edf3;border:1.5px solid #374151;max-width:100%;"
    xmlns="http://www.w3.org/2000/svg">
    <defs>${defs}</defs>
    <rect width="${svgW}" height="${svgH}" fill="#e8edf3"/>
    ${svgInner}
  </svg>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// composeDrawPage — Sheet Composition Engine renderer (v47.308)
// Builds the page-draw + draw-zone + data-zone HTML from a SheetComposition.
// All 6 page functions delegate here — zero duplicated HTML.
// ═══════════════════════════════════════════════════════════════════════════

// ── getPrimaryView: Explicit view-to-drawing-function dispatcher (Step 4) ────
// Maps (viewId) → correct drawingEngine function.
// NO generic fallback. NO guessing. Every view is explicitly bound.
// ═══════════════════════════════════════════════════════════════════════════
export function getPrimaryView(
  viewId: PrimaryViewId,
  cad: CADModel,
  input: PermitInput,
  ctx?: RenderContext | null,
): string {
  switch (viewId) {
    // ── FENCE ────────────────────────────────────────────────────────────
    case 'fence_elevation':
      return drawingEngine.getStructuralFromCAD(cad, input, ctx);
    case 'fence_structural':
      // PV-3: top-down site plan (drawFencePlan) — distinct from PV-2 elevation
      return drawingEngine.getArrayPlanFromCAD(cad, input, ctx);
    // ── ROOF ─────────────────────────────────────────────────────────────
    case 'roof_plan':
      return drawingEngine.getArrayPlanFromCAD(cad, input, ctx);
    case 'roof_cross_section':
      return drawingEngine.getStructuralFromCAD(cad, input, ctx);
    // ── GROUND MOUNT ─────────────────────────────────────────────────────
    case 'ground_plan':
      return drawingEngine.getArrayPlanFromCAD(cad, input, ctx);
    case 'ground_elevation':
      return drawingEngine.getStructuralFromCAD(cad, input, ctx);
    default: {
      const _never: never = viewId;
      throw new Error(`[getPrimaryView] Unknown viewId: "${String(_never)}"`);
    }
  }
}

// ── Dedicated MINIMAL secondary views ────────────────────────────────────────
// getSecondaryView must NEVER re-call getArrayPlanFromCAD: that returns a fully
// COMPOSED sheet (title bar + segment/row schedule furniture). Shrunk into the
// ~22% secondary strip it printed the ENTIRE plan as a blurry thumbnail — the
// "SEGMENT PLAN — TOP VIEW" (fence) and "ROW SPACING DIAGRAM" (ground) strips
// were miniature copies of the whole sheet (recursive-thumbnail bug). These
// helpers render ONLY the geometry on their own small viewBox.
const THUMB_SEG_COLORS = ['#2255aa', '#1a7a3a', '#8b1a1a', '#7a5500', '#4a1a7a', '#006666'];
const M_TO_FT = 3.280839895;

/** Minimal fence top-down: colored runs + module ticks + per-segment length.
 *  No title bar, no schedule — just the segment plan for the secondary strip. */
function buildSegmentPlanThumb(cad: CADModel): string | null {
  const f = cad.fence;
  const segs = f?.segments ?? [];
  if (!f || segs.length === 0) return null;

  const W = 400, H = 150, pad = 26;
  const xs: number[] = [], ys: number[] = [];
  segs.forEach(s => { xs.push(s.startX, s.endX); ys.push(s.startY, s.endY); });
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const fit   = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const scale = Math.min(fit, 34);            // px per metre
  const dW = spanX * scale, dH = spanY * scale;
  const ox = (W - dW) / 2, oyb = (H + dH) / 2;
  const X = (x: number) => ox + (x - minX) * scale;
  const Y = (y: number) => oyb - (y - minY) * scale;

  const out: string[] = [
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`,
    // Discreet caption — the inset is the FENCE'S OWN segment plan (not the
    // roof site plan, and not the full sheet's schedule furniture).
    `<text x="6" y="12" font-size="8" font-weight="bold" fill="#333">FENCE SEGMENT PLAN</text>`,
  ];
  segs.forEach((s, i) => {
    const x1 = X(s.startX), y1 = Y(s.startY), x2 = X(s.endX), y2 = Y(s.endY);
    const col = THUMB_SEG_COLORS[i % THUMB_SEG_COLORS.length];
    const segPx = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = -(y2 - y1) / segPx, ny = (x2 - x1) / segPx;
    const B = 8;
    out.push(`<polygon points="${(x1 + nx * B).toFixed(1)},${(y1 + ny * B).toFixed(1)} ${(x2 + nx * B).toFixed(1)},${(y2 + ny * B).toFixed(1)} ${(x2 - nx * B).toFixed(1)},${(y2 - ny * B).toFixed(1)} ${(x1 - nx * B).toFixed(1)},${(y1 - ny * B).toFixed(1)}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="0.9"/>`);
    const cells = Math.max(s.panelCount ?? 0, 1);
    for (let c = 0; c <= cells; c++) {
      const t = c / cells, cx = x1 + (x2 - x1) * t, cy = y1 + (y2 - y1) * t;
      out.push(`<line x1="${(cx + nx * B).toFixed(1)}" y1="${(cy + ny * B).toFixed(1)}" x2="${(cx - nx * B).toFixed(1)}" y2="${(cy - ny * B).toFixed(1)}" stroke="${col}" stroke-width="0.6"/>`);
    }
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`);
    const lenFt = (s.lengthM ?? 0) * M_TO_FT;
    const mx = (x1 + x2) / 2 - nx * (B + 7), my = (y1 + y2) / 2 - ny * (B + 7);
    const lbl = escapeH(String(s.label ?? s.id ?? ('S' + (i + 1))));
    out.push(`<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-size="7" font-weight="bold" fill="${col}">${lbl}: ${Math.round(lenFt)}'</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}

/** Minimal ground row-spacing SIDE diagram: tilted module rows + O.C. dim.
 *  A genuinely different view (side elevation), not a copy of the top-down. */
function buildRowSpacingThumb(cad: CADModel): string | null {
  const g = cad.ground;
  const a = g?.arrays?.[0];
  if (!g || !a) return null;

  const W = 400, H = 150;
  const rowCount  = Math.max(1, a.dimensions?.rowCount ?? a.rows?.length ?? 1);
  const spacingFt = (a.rowSpacingM ?? 0) * M_TO_FT;
  const tilt      = a.tiltDeg ?? 20;
  const clearFt   = (a.groundClearanceM ?? 0.5) * M_TO_FT;

  const showRows = Math.min(rowCount, 5);
  const marginL = 46, marginR = 20, baseY = H - 34;
  const avail   = W - marginL - marginR;
  const pitchPx = avail / Math.max(showRows, 2);
  const modLen  = Math.min(pitchPx * 0.62, 60);
  const rise    = Math.sin(tilt * Math.PI / 180) * modLen;
  const run     = Math.cos(tilt * Math.PI / 180) * modLen;
  const clrPx   = Math.min(Math.max(clearFt, 0.5) * 3, 16);

  const out: string[] = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`];
  out.push(`<line x1="20" y1="${baseY}" x2="${W - 14}" y2="${baseY}" stroke="#6b4a2a" stroke-width="1.4"/>`);
  for (let i = 0; i < 8; i++) {
    const gx = 24 + i * ((W - 44) / 8);
    out.push(`<line x1="${gx.toFixed(1)}" y1="${baseY}" x2="${(gx - 5).toFixed(1)}" y2="${(baseY + 6).toFixed(1)}" stroke="#6b4a2a" stroke-width="0.6"/>`);
  }
  for (let r = 0; r < showRows; r++) {
    const bx = marginL + r * pitchPx, by = baseY - clrPx;
    const tx = bx + run, ty = by - rise;
    out.push(`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#1a4a8a" stroke-width="3" stroke-linecap="round"/>`);
    out.push(`<line x1="${((bx + tx) / 2).toFixed(1)}" y1="${baseY.toFixed(1)}" x2="${((bx + tx) / 2).toFixed(1)}" y2="${((by + ty) / 2).toFixed(1)}" stroke="#555" stroke-width="1"/>`);
  }
  if (showRows >= 2) {
    const dx1 = marginL, dx2 = marginL + pitchPx, dy = baseY + 16;
    out.push(`<line x1="${dx1}" y1="${dy}" x2="${dx2}" y2="${dy}" stroke="#c00" stroke-width="0.9"/>`);
    out.push(`<line x1="${dx1}" y1="${dy - 4}" x2="${dx1}" y2="${dy + 4}" stroke="#c00" stroke-width="0.8"/>`);
    out.push(`<line x1="${dx2}" y1="${dy - 4}" x2="${dx2}" y2="${dy + 4}" stroke="#c00" stroke-width="0.8"/>`);
    out.push(`<text x="${((dx1 + dx2) / 2).toFixed(1)}" y="${(dy - 3).toFixed(1)}" text-anchor="middle" font-size="7" font-weight="bold" fill="#c00">${spacingFt.toFixed(1)}' O.C.</text>`);
  }
  out.push(`<text x="${(marginL + run + 6).toFixed(1)}" y="${(baseY - clrPx - rise - 4).toFixed(1)}" font-size="7.5" font-weight="bold" fill="#1a4a8a">${Math.round(tilt)}° TILT</text>`);
  out.push(`<text x="24" y="16" font-size="7.5" font-weight="bold" fill="#333">${rowCount} ROWS @ ${spacingFt.toFixed(1)}' O.C. — SIDE VIEW</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${out.join('')}</svg>`;
}

// ── getSecondaryView: Secondary view dispatcher ──────────────────────────────
// Returns null when no separate implementation exists yet (strip hidden).
export function getSecondaryView(
  viewId: SecondaryViewId,
  cad: CADModel,
  input: PermitInput,
  ctx?: RenderContext | null,
): string | null {
  switch (viewId) {
    case 'segment_plan':
      // Dedicated minimal fence top-down — NOT the full getArrayPlanFromCAD sheet.
      try { return buildSegmentPlanThumb(cad); } catch { return null; }
    case 'row_layout':
      // Dedicated minimal ground row-spacing side diagram — NOT the full sheet.
      try { return buildRowSpacingThumb(cad); } catch { return null; }
    // Not yet implemented — secondary strip hidden until dedicated views exist
    case 'footing_detail':
    case 'pier_detail':
    case 'setbacks':
    case 'obstructions':
    case 'planes':
    case 'attachment_detail':
      return null;
    default:
      return null;
  }
}

export function composeDrawPage(
  comp: SheetComposition,
  drawingSvg: string,
  secondarySvg?: string | null,
): string {
  const layout = buildLayoutFromComposition(comp);
  // STEP 1: explicit layoutClass variable — belt-and-suspenders binding
  const layoutClass = layout.pageDrawClass;

  // STEP 9: [PLANSET ENGINE] debug log — system/layout/view bound at render time
  // PIPELINE v47.343: validation log includes layout ratios for draw/data balancing audit
  console.log('[PLANSET ENGINE]', {
    systemType:    comp.systemType,
    sheetId:       comp.sheetId,
    viewType:      comp.viewType,
    primaryView:   comp.primaryView,
    secondaryViews: comp.secondaryViews,
    dataSections:  comp.dataSections,
    layout:        comp.layout,
    layoutClass,
    drawPct:       comp.drawPct,
    dataPct:       comp.dataPct,
    // PIPELINE v47.343 validation fields
    pipeline:      'v47.343',
    drawZoneRatio: `${comp.drawPct ?? 78}%`,
    dataZoneRatio: `${comp.dataPct ?? 22}%`,
    hasSecondary:  !!(comp.secondaryViews?.length > 0),
    dataRows:      comp.dataRows?.length ?? 0,
    callouts:      comp.callouts?.length ?? 0,
  });

  // ── Data rows table ────────────────────────────────────────────────────────
  const dataRowsHtml = comp.dataRows.map(row => {
    const cls = row.highlight ? 'row-highlight' : row.bold ? 'row-bold' : '';
    return `<tr class="${cls}"><td>${escapeH(row.label)}</td><td>${escapeH(row.value)}</td></tr>`;
  }).join('');

  // ── Callout schedule ───────────────────────────────────────────────────────
  const calloutsHtml = comp.callouts.map(c =>
    `<div class="callout-row">` +
    `<span class="callout-bubble">${c.n}</span>` +
    `<span><strong>${escapeH(c.label)}</strong>${c.sub ? ' — ' + escapeH(c.sub) : ''}</span>` +
    `</div>`
  ).join('');

  // ── Secondary view strip (bottom of draw zone) ─────────────────────────────
  // Use secondaryHeader from composition (system-specific label)
  const secHeader = escapeH(comp.secondaryHeader ?? 'SECONDARY VIEW');
  const secondaryHtml = secondarySvg
    ? `<div style="flex:0 0 22%;border-top:var(--border);overflow:hidden;background:#f8f9ff;">
         <div class="draw-zone-hdr">${secHeader}</div>
         <div style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:4px;">
           ${secondarySvg}
         </div>
       </div>`
    : '';

  /* PIPELINE v47.343: draw-zone enforces fixed ratio with min-height guard.
     * draw-zone-body uses flex:1 + min-height:0 so SVG fills ALL available height.
     * data-zone uses overflow:auto so long tables scroll instead of clipping.
     * Never use height:100% on children — use flex:1 + min-height:0 pattern. */
  return `
    <div class="${layoutClass}">
      <div class="draw-zone" style="${layout.drawStyle};min-height:320px;">
        <div class="draw-zone-hdr">${escapeH(comp.drawHeader)}</div>
        <div class="draw-zone-body" style="flex:1;display:flex;flex-direction:column;min-height:0;">
          <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:8px;background:#fff;">
            ${drawingSvg}
          </div>
          ${secondaryHtml}
        </div>
      </div>
      <div class="data-zone" style="${layout.dataStyle};">
        <div style="display:flex;flex-direction:column;height:100%;min-height:0;">
          <div style="border-bottom:var(--border);display:flex;flex-direction:column;flex-shrink:0;">
            <div class="draw-zone-hdr">${escapeH(comp.dataTitle)}</div>
            <table class="comp-data-table">
              ${dataRowsHtml}
            </table>
          </div>
          <div style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;">
            <div class="draw-zone-hdr" style="flex-shrink:0;">CALLOUT SCHEDULE</div>
            <div style="padding:0;font-size:7px;overflow:auto;">
              ${calloutsHtml}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

export function escapeH(s: string): string {
  // Idempotent HTML escape: escapes bare <>&"' but leaves existing entities
  // (&amp; &mdash; &#39; …) intact, so values that already contain entities or
  // are escaped twice don't become &amp;mdash;. (Historically this function was
  // a no-op — replacing each char with itself — a repo-wide XSS hole.)
  return String(s)
    .replace(/&(?![a-zA-Z0-9#]+;)/g, '&amp;')   // escape bare & but keep &mdash; &#39; &times; …
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}



