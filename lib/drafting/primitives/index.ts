// ============================================================
// SolarPro Drafting Engine — Primitives Layer
// lib/drafting/primitives/index.ts
//
// Atomic SVG drawing functions.
// ALL output is raw SVG element strings.
// NO template literals with nested expressions.
// NO inline styles — classes only.
// ============================================================

import type { LineClass, TextOptions } from '../types';

// ── drawLine ──────────────────────────────────────────────────
// Draws a single line segment with a CAD class.

export function drawLine(
  x1: number, y1: number,
  x2: number, y2: number,
  cls: LineClass,
  extra?: string  // additional SVG attributes e.g. marker-end
): string {
  const attrs = extra ? (' ' + extra) : '';
  return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
    '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
    '" class="' + cls + '"' + attrs + '/>';
}

// ── drawRect ──────────────────────────────────────────────────
// Draws a rectangle. fill/stroke controlled by className.

export function drawRect(
  x: number, y: number,
  w: number, h: number,
  cls: string,
  rx?: number
): string {
  const rxAttr = rx !== undefined ? ' rx="' + rx.toFixed(1) + '"' : '';
  return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
    '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
    '" class="' + cls + '"' + rxAttr + '/>';
}

// ── drawRectFilled ────────────────────────────────────────────
// Rectangle with explicit fill/stroke (for colored geometry).

export function drawRectFilled(
  x: number, y: number,
  w: number, h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
  rx?: number
): string {
  const rxAttr = rx !== undefined ? ' rx="' + rx.toFixed(1) + '"' : '';
  return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
    '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
    '" fill="' + fill + '" stroke="' + stroke +
    '" stroke-width="' + strokeWidth + '"' + rxAttr + '/>';
}

// ── drawCircle ────────────────────────────────────────────────

export function drawCircle(
  cx: number, cy: number,
  r: number,
  cls: string
): string {
  return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
    '" r="' + r.toFixed(1) + '" class="' + cls + '"/>';
}

// ── drawCircleFilled ──────────────────────────────────────────

export function drawCircleFilled(
  cx: number, cy: number,
  r: number,
  fill: string,
  stroke: string,
  strokeWidth: number
): string {
  return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) +
    '" r="' + r.toFixed(1) + '" fill="' + fill +
    '" stroke="' + stroke + '" stroke-width="' + strokeWidth + '"/>';
}

// ── drawPolyline ──────────────────────────────────────────────

export function drawPolyline(
  points: Array<[number, number]>,
  cls: LineClass
): string {
  const pts = points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  return '<polyline points="' + pts + '" class="' + cls + '" fill="none"/>';
}

// ── drawPolygon ───────────────────────────────────────────────

export function drawPolygon(
  points: Array<[number, number]>,
  fill: string,
  cls: LineClass
): string {
  const pts = points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  return '<polygon points="' + pts + '" fill="' + fill + '" class="' + cls + '"/>';
}

// ── drawText ──────────────────────────────────────────────────

export function drawText(
  x: number, y: number,
  text: string,
  opts: TextOptions = {}
): string {
  const anchor     = opts.anchor     || 'start';
  const fontSize   = opts.fontSize   || 9;
  const fontWeight = opts.fontWeight || 'normal';
  const fill       = opts.fill       || '#000';
  const italic     = opts.italic     ? ' font-style="italic"' : '';
  const ls         = opts.letterSpacing ? ' letter-spacing="' + opts.letterSpacing + '"' : '';

  let transform = '';
  if (opts.rotate) {
    transform = ' transform="rotate(' + opts.rotate + ',' + x.toFixed(1) + ',' + y.toFixed(1) + ')"';
  }

  return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
    '" text-anchor="' + anchor + '"' +
    ' font-size="' + fontSize + '"' +
    ' font-weight="' + fontWeight + '"' +
    ' fill="' + fill + '"' +
    italic + ls + transform + '>' +
    escapeXml(text) + '</text>';
}

// ── drawPath ──────────────────────────────────────────────────
// General SVG path element.

export function drawPath(
  d: string,
  cls: LineClass,
  fill?: string
): string {
  const fillAttr = fill !== undefined ? ' fill="' + fill + '"' : ' fill="none"';
  return '<path d="' + d + '" class="' + cls + '"' + fillAttr + '/>';
}

// ── drawArrowhead ─────────────────────────────────────────────
// Small filled triangle at (x, y) pointing in direction (angleDeg).
// Used for dimension arrows and wind load indicators.

export function drawArrowhead(
  x: number, y: number,
  angleDeg: number,
  size: number,
  fill: string
): string {
  // Arrow points along angleDeg, tip at (x,y)
  const rad = angleDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const back = size * 2.5;
  const side = size;
  // Three points: tip, left-base, right-base
  const tx = x, ty = y;
  const lx = x - back * cos + side * sin;
  const ly = y - back * sin - side * cos;
  const rx = x - back * cos - side * sin;
  const ry = y - back * sin + side * cos;
  const pts =
    tx.toFixed(1) + ',' + ty.toFixed(1) + ' ' +
    lx.toFixed(1) + ',' + ly.toFixed(1) + ' ' +
    rx.toFixed(1) + ',' + ry.toFixed(1);
  return '<polygon points="' + pts + '" fill="' + fill + '" stroke="none"/>';
}

// ── drawHatch ─────────────────────────────────────────────────
// Diagonal hatch lines within a rect (e.g. concrete cross-section).

export function drawHatch(
  x: number, y: number,
  w: number, h: number,
  spacing: number,
  cls: LineClass
): string {
  const els: string[] = [];
  // 45° lines from top-left going right
  for (let i = -h; i < w + h; i += spacing) {
    const x1 = x + i, y1 = y;
    const x2 = x + i + h, y2 = y + h;
    // Clip to rect bounds
    const cx1 = Math.max(x1, x);
    const cy1 = cx1 === x1 ? y1 : y1 + (x - x1);
    const cx2 = Math.min(x2, x + w);
    const cy2 = cx2 === x2 ? y2 : y2 - (x2 - (x + w));
    if (cx1 <= x + w && cx2 >= x) {
      els.push(drawLine(cx1, cy1, cx2, cy2, cls));
    }
  }
  return els.join('');
}

// ── drawSVGOpen ───────────────────────────────────────────────
// Open tag for the root SVG element.

export function drawSVGOpen(
  width: number,
  height: number
): string {
  // Inject reusable SVG defs for CAD patterns + gradients used across all templates.
  // v47.345: Added roof-tile pattern, glass gradients, steel/wood/concrete material gradients
  // hatch-wood:       diagonal wood grain (rafters, studs)
  // hatch-concrete:   diagonal + dot fill (footings, piers)
  // hatch-earth:      earth/soil fill (below grade)
  // hatch-steel:      close diagonal (steel sections)
  // hatch-roof-tile:  asphalt shingle course pattern
  // panel-glass:      PV glass body gradient
  // panel-reflect:    PV glass reflection highlight
  // panel-glass-tilt: PV glass gradient for tilted panels
  // pile-steel:       driven pile/tube steel horizontal gradient
  // post-steel:       fence post steel horizontal gradient
  // concrete-grad:    concrete footing vertical gradient
  // rafter-wood:      sawn lumber horizontal gradient
  const defs =
    '<defs>' +
    // ── hatch patterns ──
    '<pattern id=\"hatch-wood\" x=\"0\" y=\"0\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">' +
    '<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"#a08040\" stroke-width=\"1.2\"/>' +
    '</pattern>' +
    '<pattern id=\"hatch-concrete\" x=\"0\" y=\"0\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">' +
    '<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"8\" stroke=\"#999\" stroke-width=\"1.5\"/>' +
    '<line x1=\"0\" y1=\"0\" x2=\"8\" y2=\"0\" stroke=\"#999\" stroke-width=\"0.5\"/>' +
    '</pattern>' +
    '<pattern id=\"hatch-earth\" x=\"0\" y=\"0\" width=\"8\" height=\"8\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(30)\">' +
    '<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"8\" stroke=\"#8b6040\" stroke-width=\"1.8\"/>' +
    '</pattern>' +
    '<pattern id=\"hatch-steel\" x=\"0\" y=\"0\" width=\"4\" height=\"4\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\">' +
    '<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"4\" stroke=\"#666\" stroke-width=\"0.8\"/>' +
    '</pattern>' +
    '<pattern id=\"hatch-roof-tile\" x=\"0\" y=\"0\" width=\"10\" height=\"6\" patternUnits=\"userSpaceOnUse\">' +
    '<rect width=\"10\" height=\"6\" fill=\"#d4c8a8\"/>' +
    '<line x1=\"0\" y1=\"3\" x2=\"10\" y2=\"3\" stroke=\"#b0a080\" stroke-width=\"0.6\"/>' +
    '<line x1=\"5\" y1=\"0\" x2=\"5\" y2=\"3\" stroke=\"#b0a080\" stroke-width=\"0.5\"/>' +
    '<line x1=\"0\" y1=\"3\" x2=\"0\" y2=\"6\" stroke=\"#b0a080\" stroke-width=\"0.5\"/>' +
    '</pattern>' +
    // ── PV glass gradients ──
    '<linearGradient id=\"panel-glass\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">' +
    '<stop offset=\"0%\" stop-color=\"#2a5fba\" stop-opacity=\"1\"/>' +
    '<stop offset=\"40%\" stop-color=\"#1a3f8a\" stop-opacity=\"1\"/>' +
    '<stop offset=\"100%\" stop-color=\"#0f2660\" stop-opacity=\"1\"/>' +
    '</linearGradient>' +
    '<linearGradient id=\"panel-reflect\" x1=\"0.1\" y1=\"0.1\" x2=\"0.5\" y2=\"0.5\">' +
    '<stop offset=\"0%\" stop-color=\"#ffffff\" stop-opacity=\"0.18\"/>' +
    '<stop offset=\"100%\" stop-color=\"#ffffff\" stop-opacity=\"0\"/>' +
    '</linearGradient>' +
    '<linearGradient id=\"panel-glass-tilt\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">' +
    '<stop offset=\"0%\" stop-color=\"#2a5fba\" stop-opacity=\"1\"/>' +
    '<stop offset=\"50%\" stop-color=\"#1a3f8a\" stop-opacity=\"1\"/>' +
    '<stop offset=\"100%\" stop-color=\"#0f2660\" stop-opacity=\"1\"/>' +
    '</linearGradient>' +
    // ── structural material gradients ──
    '<linearGradient id=\"pile-steel\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">' +
    '<stop offset=\"0%\" stop-color=\"#b0b0b0\"/>' +
    '<stop offset=\"40%\" stop-color=\"#d8d8d8\"/>' +
    '<stop offset=\"60%\" stop-color=\"#c0c0c0\"/>' +
    '<stop offset=\"100%\" stop-color=\"#909090\"/>' +
    '</linearGradient>' +
    '<linearGradient id=\"post-steel\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">' +
    '<stop offset=\"0%\" stop-color=\"#a0a0a0\"/>' +
    '<stop offset=\"35%\" stop-color=\"#d0d0d0\"/>' +
    '<stop offset=\"65%\" stop-color=\"#b8b8b8\"/>' +
    '<stop offset=\"100%\" stop-color=\"#888888\"/>' +
    '</linearGradient>' +
    '<linearGradient id=\"concrete-grad\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">' +
    '<stop offset=\"0%\" stop-color=\"#c8c0a8\"/>' +
    '<stop offset=\"100%\" stop-color=\"#a89878\"/>' +
    '</linearGradient>' +
    '<linearGradient id=\"rafter-wood\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"0\">' +
    '<stop offset=\"0%\" stop-color=\"#c8a060\"/>' +
    '<stop offset=\"40%\" stop-color=\"#e0b870\"/>' +
    '<stop offset=\"100%\" stop-color=\"#b88840\"/>' +
    '</linearGradient>' +
    '</defs>';
  return '<svg viewBox="0 0 ' + width + ' ' + height +
    '" preserveAspectRatio="xMidYMid meet"' +
    ' xmlns="http://www.w3.org/2000/svg"' +
    ' style="font-family:Arial,sans-serif;display:block;">' +
    defs;
}

export function drawSVGClose(): string {
  return '</svg>';
}

// ── drawBackground ────────────────────────────────────────────

export function drawBackground(
  width: number,
  height: number,
  fill: string
): string {
  return '<rect width="' + width + '" height="' + height + '" fill="' + fill + '"/>';
}

// ── drawTitleBar ──────────────────────────────────────────────
// Black header bar with white text — used on all drawing zones.

export function drawTitleBar(
  width: number,
  text: string,
  scaleNote?: string
): string {
  const els: string[] = [];
  els.push('<rect x="0" y="0" width="' + width + '" height="22" fill="#000"/>');
  els.push(drawText(width / 2, 15, text, {
    anchor: 'middle', fontSize: 11, fontWeight: '900',
    fill: '#fff', letterSpacing: 1
  }));
  if (scaleNote) {
    els.push(drawText(width - 8, 15, scaleNote, {
      anchor: 'end', fontSize: 8, fill: '#aaa'
    }));
  }
  return els.join('');
}

// ── drawNorthArrow ────────────────────────────────────────────
// Classic engineering north arrow in a circle.

export function drawNorthArrow(
  cx: number, cy: number,
  r: number
): string {
  const els: string[] = [];
  // Outer circle
  els.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="#fff" stroke="#000" stroke-width="1.5"/>');
  // North half (black filled)
  const nh =
    cx.toFixed(1) + ',' + (cy - r + 3).toFixed(1) + ' ' +
    (cx - 5).toFixed(1) + ',' + (cy + 2).toFixed(1) + ' ' +
    cx.toFixed(1) + ',' + (cy).toFixed(1) + ' ' +
    (cx + 5).toFixed(1) + ',' + (cy + 2).toFixed(1);
  els.push('<polygon points="' + nh + '" fill="#000" stroke="#000" stroke-width="0.5"/>');
  // South half (white with outline)
  const sh =
    cx.toFixed(1) + ',' + (cy + r - 3).toFixed(1) + ' ' +
    (cx - 5).toFixed(1) + ',' + (cy + 2).toFixed(1) + ' ' +
    cx.toFixed(1) + ',' + (cy).toFixed(1) + ' ' +
    (cx + 5).toFixed(1) + ',' + (cy + 2).toFixed(1);
  els.push('<polygon points="' + sh + '" fill="#fff" stroke="#000" stroke-width="0.5"/>');
  // Center dot
  els.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="1.5" fill="#000"/>');
  // N label above
  els.push(drawText(cx, cy - r - 3, 'N', {
    anchor: 'middle', fontSize: 10, fontWeight: '900', fill: '#000'
  }));
  return els.join('');
}

// ── drawScaleBar ──────────────────────────────────────────────
// Graphic scale bar. scaleLabel e.g. "1\" = 1'-0\""

export function drawScaleBar(
  x: number, y: number,
  barWidthPx: number,
  label: string
): string {
  const els: string[] = [];
  // Bar
  els.push('<rect x="' + x + '" y="' + y + '" width="' + barWidthPx + '" height="4" fill="#000"/>');
  // Half-bar white
  els.push('<rect x="' + x + '" y="' + y + '" width="' + (barWidthPx / 2) + '" height="4" fill="#fff" stroke="#000" stroke-width="0.5"/>');
  // End ticks
  els.push('<line x1="' + x + '" y1="' + (y - 3) + '" x2="' + x + '" y2="' + (y + 7) + '" stroke="#000" stroke-width="1"/>');
  els.push('<line x1="' + (x + barWidthPx) + '" y1="' + (y - 3) + '" x2="' + (x + barWidthPx) + '" y2="' + (y + 7) + '" stroke="#000" stroke-width="1"/>');
  els.push(drawText(x + barWidthPx / 2, y + 14, label, {
    anchor: 'middle', fontSize: 7, fill: '#555'
  }));
  return els.join('');
}

// ── Utility ───────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Convert decimal feet to engineering format: e.g. 8.5 → "8'-6\""
export function ftToFtIn(decimalFt: number): string {
  const totalIn = Math.round(decimalFt * 12);
  const ft = Math.floor(totalIn / 12);
  const inches = totalIn % 12;
  if (inches === 0) return ft + "'-0\"";
  return ft + "'-" + inches + '"';
}

// Compass bearing to direction string
export function compassDir(azimuth: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(azimuth / 22.5) % 16];
}