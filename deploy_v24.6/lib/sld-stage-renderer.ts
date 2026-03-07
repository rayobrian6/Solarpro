// ============================================================
// SLD Stage-Based Renderer — V3.1 (Revised)
// Left-to-right power flow, 5 logical stages
// ANSI C (24×18") landscape at 96 DPI — IEEE electrical symbols
// ============================================================
//
// STAGE 1 — Array:         PV Panels + Optimizers (if applicable)
// STAGE 2 — String/Branch: Combiner / DC Disconnect / Rapid Shutdown
// STAGE 3 — Inverter:      String inverter OR microinverter branch
// STAGE 4 — AC Collection: AC disconnect + Production meter
// STAGE 5 — Interconnect:  Main panel + Utility meter + Grid
//
// ============================================================

import { SLDBuildInput } from './sld-types';

// ─── Sheet Constants (ANSI C landscape at 96 DPI) ─────────────────────────────
// Landscape: 24" wide × 18" tall
const SHEET_W = 2304;   // 24 inches × 96 DPI
const SHEET_H = 1728;   // 18 inches × 96 DPI
const MARGIN  = 72;     // 0.75 inch margin
const TITLE_H = 160;    // title block height (bottom)
const DRAW_W  = SHEET_W - MARGIN * 2;
const DRAW_H  = SHEET_H - MARGIN * 2 - TITLE_H;
const DRAW_X  = MARGIN;
const DRAW_Y  = MARGIN;

// Stage layout
const STAGE_COUNT = 5;
const STAGE_W = Math.floor(DRAW_W / STAGE_COUNT);  // ~432px each
const STAGE_H = DRAW_H;                              // ~1296px

// Component vertical center (within drawing area, below stage header)
const STAGE_HEADER_H = 40;
const COMP_AREA_Y = DRAW_Y + STAGE_HEADER_H;
const COMP_AREA_H = STAGE_H - STAGE_HEADER_H;
const COMP_CY = COMP_AREA_Y + COMP_AREA_H / 2;  // vertical center for main components

// ─── Colors ───────────────────────────────────────────────────────────────────
const C = {
  bg:          '#FFFFFF',
  border:      '#000000',
  line:        '#1A1A1A',
  dc:          '#CC3300',
  ac:          '#003399',
  gnd:         '#006600',
  bond:        '#996600',
  equip:       '#1A1A1A',
  fill:        '#F8F8F8',
  fillDC:      '#FFF5F0',
  fillAC:      '#F0F5FF',
  fillGND:     '#F0FFF0',
  stageBg:     ['#FFFBF0', '#FFF5F0', '#F0F5FF', '#F0F8FF', '#F5F0FF'],
  stageBorder: ['#D4860A', '#CC3300', '#003399', '#0055AA', '#6600CC'],
  stageLabel:  ['#7A5500', '#8B1A00', '#001A66', '#003366', '#330066'],
  text:        '#000000',
  textLight:   '#444444',
  titleBg:     '#1A2744',
  titleText:   '#FFFFFF',
  gridLine:    '#E8E8E8',
  autoRes:     '#006633',
  warn:        '#CC6600',
};

const F = { title: 22, heading: 16, body: 13, small: 11, tiny: 10, label: 12, callout: 10 };

// ─── SVG Helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rect(x: number, y: number, w: number, h: number, opts: {
  fill?: string; stroke?: string; strokeW?: number; rx?: number; dash?: string;
} = {}): string {
  const fill   = opts.fill   ?? 'none';
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1;
  const rx     = opts.rx ?? 0;
  const dash   = opts.dash ? ` stroke-dasharray="${opts.dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"${dash}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, opts: {
  stroke?: string; strokeW?: number; dash?: string; cap?: string;
} = {}): string {
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1.5;
  const dash   = opts.dash ? ` stroke-dasharray="${opts.dash}"` : '';
  const cap    = opts.cap ? ` stroke-linecap="${opts.cap}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${dash}${cap}/>`;
}

function txt(x: number, y: number, content: string, opts: {
  size?: number; fill?: string; anchor?: string; weight?: string; dy?: number; italic?: boolean;
} = {}): string {
  const size   = opts.size   ?? F.body;
  const fill   = opts.fill   ?? C.text;
  const anchor = opts.anchor ?? 'middle';
  const weight = opts.weight ?? 'normal';
  const style  = opts.italic ? ' font-style="italic"' : '';
  const dy     = opts.dy !== undefined ? ` dy="${opts.dy}"` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="Arial, Helvetica, sans-serif"${style}${dy}>${esc(content)}</text>`;
}

function circle(cx: number, cy: number, r: number, opts: {
  fill?: string; stroke?: string; strokeW?: number;
} = {}): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${opts.fill ?? 'none'}" stroke="${opts.stroke ?? C.line}" stroke-width="${opts.strokeW ?? 1.5}"/>`;
}

function pathEl(d: string, opts: { stroke?: string; strokeW?: number; fill?: string; dash?: string } = {}): string {
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1.5;
  const fill   = opts.fill ?? 'none';
  const dash   = opts.dash ? ` stroke-dasharray="${opts.dash}"` : '';
  return `<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash}/>`;
}

// ─── IEEE Symbol: PV Array ────────────────────────────────────────────────────
// Returns {svg, portRight: {x,y}} — right-side connection port

function drawPVArray(cx: number, cy: number, panelCount: number, panelWatts: number,
  vocCorrected: number, ocpdRating: number, dcCallout: string, arrayLabel: string,
  hasOptimizer: boolean): { svg: string; portRight: { x: number; y: number } } {
  const W = 170; const H = 130;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';

  // Panel body
  svg += rect(x, y, W, H, { fill: C.fillDC, stroke: C.dc, strokeW: 2, rx: 5 });

  // Sun symbol (top center)
  const sunCx = cx; const sunCy = y + 32;
  svg += circle(sunCx, sunCy, 16, { fill: '#FFD700', stroke: '#CC8800', strokeW: 1.5 });
  for (let i = 0; i < 8; i++) {
    const angle = (i * 45 * Math.PI) / 180;
    svg += line(
      sunCx + Math.cos(angle) * 20, sunCy + Math.sin(angle) * 20,
      sunCx + Math.cos(angle) * 28, sunCy + Math.sin(angle) * 28,
      { stroke: '#CC8800', strokeW: 1.5 }
    );
  }

  // Array label
  svg += txt(cx, y + 62, arrayLabel, { size: F.small, weight: 'bold', fill: '#8B1A00' });
  svg += txt(cx, y + 76, `${panelCount} × ${panelWatts}W`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, y + 90, `Voc(corr): ${vocCorrected.toFixed(0)}V`, { size: F.tiny, fill: C.textLight });

  // OCPD fuse (above box)
  if (ocpdRating > 0) {
    const fy = y - 36;
    svg += rect(cx - 18, fy - 10, 36, 20, { fill: '#FFF8E0', stroke: C.dc, strokeW: 1.5, rx: 3 });
    svg += txt(cx, fy + 4, `${ocpdRating}A`, { size: F.tiny, weight: 'bold', fill: C.dc });
    svg += line(cx, y, cx, fy - 10, { stroke: C.dc, strokeW: 2 });
    svg += txt(cx, fy - 14, 'FUSE', { size: 8, fill: C.dc });
  }

  // Optimizer badge
  if (hasOptimizer) {
    svg += rect(x + 4, y + H - 22, 36, 16, { fill: '#E8F0FF', stroke: '#0044CC', strokeW: 1, rx: 2 });
    svg += txt(x + 22, y + H - 10, 'OPT', { size: 8, fill: '#0044CC', weight: 'bold' });
  }

  // DC callout below
  if (dcCallout) {
    const calloutY = y + H + 18;
    svg += rect(x, calloutY - 12, W, 22, { fill: '#FFFFF0', stroke: C.dc, strokeW: 1, rx: 2 });
    svg += txt(cx, calloutY + 4, dcCallout.slice(0, 28), { size: 8, fill: C.dc });
  }

  // Right port (center-right of box)
  const portX = x + W;
  const portY = cy;
  svg += circle(portX, portY, 4, { fill: C.dc, stroke: C.dc });

  return { svg, portRight: { x: portX, y: portY } };
}

// ─── IEEE Symbol: Fuse / OCPD ─────────────────────────────────────────────────

function drawFuse(cx: number, cy: number, rating: number, color: string): string {
  let svg = '';
  svg += rect(cx - 20, cy - 10, 40, 20, { fill: '#FFF8E0', stroke: color, strokeW: 1.5, rx: 3 });
  svg += txt(cx, cy + 4, `${rating}A`, { size: F.tiny, weight: 'bold', fill: color });
  return svg;
}

// ─── IEEE Symbol: Switch / Disconnect ─────────────────────────────────────────

function drawDisconnect(cx: number, cy: number, label: string, subLabel: string,
  color: string, fillColor: string): { svg: string; portLeft: { x: number; y: number }; portRight: { x: number; y: number } } {
  const W = 90; const H = 70;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: fillColor, stroke: color, strokeW: 2, rx: 4 });

  // Switch symbol (knife switch)
  const sx = cx - 20; const sy = cy - 4;
  svg += circle(sx, sy, 5, { fill: color, stroke: color });
  svg += circle(cx + 20, sy, 5, { fill: color, stroke: color });
  svg += line(sx, sy, cx + 12, sy - 16, { stroke: color, strokeW: 2.5 });

  svg += txt(cx, cy + 18, label, { size: F.tiny, weight: 'bold', fill: color });
  svg += txt(cx, cy + 30, subLabel, { size: 8, fill: C.textLight });

  const portLeft  = { x: x, y: cy };
  const portRight = { x: x + W, y: cy };
  svg += circle(portLeft.x, portLeft.y, 3, { fill: color, stroke: color });
  svg += circle(portRight.x, portRight.y, 3, { fill: color, stroke: color });

  return { svg, portLeft, portRight };
}

// ─── IEEE Symbol: Rapid Shutdown ──────────────────────────────────────────────

function drawRapidShutdown(cx: number, cy: number): { svg: string; portBottom: { x: number; y: number } } {
  const W = 90; const H = 52;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: '#FFF3E0', stroke: '#E65100', strokeW: 2, rx: 4 });
  // Lightning bolt
  svg += pathEl(`M${cx + 4},${cy - 14} L${cx - 6},${cy + 2} L${cx + 2},${cy + 2} L${cx - 4},${cy + 14} L${cx + 8},${cy - 2} L${cx},${cy - 2} Z`,
    { fill: '#E65100', stroke: '#E65100', strokeW: 1 });
  svg += txt(cx, cy + 26, 'RAPID SHUTDOWN', { size: 8, weight: 'bold', fill: '#E65100' });
  svg += txt(cx, cy + 36, 'NEC 690.12', { size: 7, fill: C.textLight });
  return { svg, portBottom: { x: cx, y: y + H } };
}

// ─── IEEE Symbol: Combiner Box ────────────────────────────────────────────────

function drawCombiner(cx: number, cy: number, stringCount: number): { svg: string; portLeft: { x: number; y: number }; portRight: { x: number; y: number } } {
  const W = 110; const H = 90;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: C.fillDC, stroke: C.dc, strokeW: 2, rx: 4 });
  svg += txt(cx, y + 16, 'COMBINER', { size: F.tiny, weight: 'bold', fill: '#8B1A00' });
  svg += txt(cx, y + 30, `${stringCount}-String`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, y + 44, 'NEC 690.8', { size: 8, fill: C.textLight });
  // Fuse row
  const fuseCount = Math.min(stringCount, 5);
  const fuseSpacing = (W - 20) / fuseCount;
  for (let i = 0; i < fuseCount; i++) {
    const fx = x + 10 + i * fuseSpacing + fuseSpacing / 2;
    svg += rect(fx - 8, y + 56, 16, 10, { fill: '#FFF8E0', stroke: C.dc, strokeW: 1, rx: 1 });
  }
  svg += txt(cx, y + 80, 'String Fuses', { size: 8, fill: C.textLight });
  const portLeft  = { x: x, y: cy };
  const portRight = { x: x + W, y: cy };
  svg += circle(portLeft.x, portLeft.y, 3, { fill: C.dc, stroke: C.dc });
  svg += circle(portRight.x, portRight.y, 3, { fill: C.dc, stroke: C.dc });
  return { svg, portLeft, portRight };
}

// ─── IEEE Symbol: String Inverter ─────────────────────────────────────────────

function drawStringInverter(cx: number, cy: number, manufacturer: string, model: string,
  acOutputKw: number, efficiency: number): { svg: string; portLeft: { x: number; y: number }; portRight: { x: number; y: number } } {
  const W = 180; const H = 150;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: C.fillAC, stroke: C.ac, strokeW: 2.5, rx: 6 });

  // DC→AC symbol
  const symCy = cy - 22;
  // DC flat line
  svg += line(cx - 50, symCy, cx - 20, symCy, { stroke: C.dc, strokeW: 2.5 });
  svg += txt(cx - 35, symCy - 8, 'DC', { size: 9, fill: C.dc, weight: 'bold' });
  // Arrow
  svg += pathEl(`M${cx - 14},${symCy - 5} L${cx - 4},${symCy} L${cx - 14},${symCy + 5}`,
    { fill: C.equip, stroke: C.equip, strokeW: 1 });
  // AC sine wave
  svg += pathEl(`M${cx + 4},${symCy} Q${cx + 14},${symCy - 12} ${cx + 24},${symCy} Q${cx + 34},${symCy + 12} ${cx + 44},${symCy}`,
    { stroke: C.ac, strokeW: 2.5 });
  svg += txt(cx + 24, symCy - 14, 'AC', { size: 9, fill: C.ac, weight: 'bold' });

  // Labels
  svg += txt(cx, cy + 8, manufacturer, { size: F.small, weight: 'bold', fill: '#001A66' });
  svg += txt(cx, cy + 22, model, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, cy + 36, `${acOutputKw} kW AC · ${efficiency}% eff`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, cy + 50, 'UL 1741 / IEEE 1547', { size: 8, fill: C.textLight });

  const portLeft  = { x: x, y: cy };
  const portRight = { x: x + W, y: cy };
  svg += circle(portLeft.x, portLeft.y, 4, { fill: C.dc, stroke: C.dc });
  svg += circle(portRight.x, portRight.y, 4, { fill: C.ac, stroke: C.ac });

  return { svg, portLeft, portRight };
}

// ─── IEEE Symbol: Microinverter Branch ────────────────────────────────────────

function drawMicroBranch(cx: number, cy: number, panelCount: number, manufacturer: string,
  model: string, acOutputW: number): { svg: string; portLeft: { x: number; y: number }; portRight: { x: number; y: number } } {
  const W = 160; const H = 130;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: '#F0F8FF', stroke: '#0066CC', strokeW: 2, rx: 5 });

  // AC sine wave header
  svg += pathEl(`M${cx - 40},${y + 22} Q${cx - 28},${y + 10} ${cx - 16},${y + 22} Q${cx - 4},${y + 34} ${cx + 8},${y + 22} Q${cx + 20},${y + 10} ${cx + 32},${y + 22}`,
    { stroke: C.ac, strokeW: 2 });

  svg += txt(cx, y + 48, 'MICROINVERTER', { size: F.tiny, weight: 'bold', fill: '#0044AA' });
  svg += txt(cx, y + 62, 'BRANCH', { size: F.tiny, weight: 'bold', fill: '#0044AA' });
  svg += txt(cx, y + 78, `${panelCount} × ${manufacturer}`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, y + 92, model, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, y + 106, `${acOutputW}W each`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, y + 120, `Total: ${((panelCount * acOutputW) / 1000).toFixed(2)} kW AC`, { size: F.tiny, weight: 'bold', fill: '#0044AA' });

  const portLeft  = { x: x, y: cy };
  const portRight = { x: x + W, y: cy };
  svg += circle(portLeft.x, portLeft.y, 4, { fill: C.ac, stroke: C.ac });
  svg += circle(portRight.x, portRight.y, 4, { fill: C.ac, stroke: C.ac });

  return { svg, portLeft, portRight };
}

// ─── IEEE Symbol: Meter (circle) ──────────────────────────────────────────────

function drawMeter(cx: number, cy: number, label1: string, label2: string, subLabel: string,
  necRef: string, color: string, fillColor: string): { svg: string; portTop: { x: number; y: number }; portBottom: { x: number; y: number } } {
  const R = 36;
  let svg = '';
  svg += circle(cx, cy, R, { fill: fillColor, stroke: color, strokeW: 2 });
  svg += txt(cx, cy - 6, label1, { size: F.small, weight: 'bold', fill: color });
  svg += txt(cx, cy + 10, label2, { size: F.tiny, fill: color });
  svg += txt(cx, cy + R + 14, subLabel, { size: F.tiny, weight: 'bold', fill: color });
  svg += txt(cx, cy + R + 26, necRef, { size: 8, fill: C.textLight });
  svg += circle(cx, cy - R, 3, { fill: color, stroke: color });
  svg += circle(cx, cy + R, 3, { fill: color, stroke: color });
  return {
    svg,
    portTop: { x: cx, y: cy - R },
    portBottom: { x: cx, y: cy + R }
  };
}

// ─── IEEE Symbol: Main Service Panel ──────────────────────────────────────────

function drawMSP(cx: number, cy: number, brand: string, amps: number,
  backfeedAmps: number, busbarRule: string): { svg: string; portLeft: { x: number; y: number }; portBottom: { x: number; y: number } } {
  const W = 160; const H = 160;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: '#F5F5F5', stroke: C.equip, strokeW: 2.5, rx: 5 });

  // Breaker symbols
  for (let i = 0; i < 4; i++) {
    const bx = cx - 36; const by = y + 16 + i * 24;
    svg += rect(bx, by, 72, 18, { fill: '#E0E0E0', stroke: '#888', strokeW: 1, rx: 2 });
    svg += rect(bx + 2, by + 2, 14, 14, { fill: i === 0 ? '#CC0000' : i === 1 ? '#0044CC' : '#888', stroke: 'none', rx: 1 });
    if (i === 0) svg += txt(bx + 22, by + 13, `${amps}A MAIN`, { size: 8, fill: '#333', anchor: 'start' });
    if (i === 1) svg += txt(bx + 22, by + 13, `${backfeedAmps}A SOLAR`, { size: 8, fill: C.ac, anchor: 'start' });
  }

  svg += txt(cx, cy + 62, brand, { size: F.tiny, weight: 'bold', fill: C.equip });
  svg += txt(cx, cy + 76, `${amps}A MAIN PANEL`, { size: F.tiny, fill: C.textLight });
  svg += txt(cx, cy + 90, `Backfeed: ${backfeedAmps}A`, { size: F.tiny, fill: C.ac });
  svg += txt(cx, cy + 102, busbarRule, { size: 8, fill: C.textLight });
  svg += txt(cx, cy + 114, 'NEC 705.12', { size: 8, fill: C.textLight });

  const portLeft   = { x: x, y: cy };
  const portBottom = { x: cx, y: y + H };
  svg += circle(portLeft.x, portLeft.y, 4, { fill: C.ac, stroke: C.ac });
  svg += circle(portBottom.x, portBottom.y, 3, { fill: C.equip, stroke: C.equip });

  return { svg, portLeft, portBottom };
}

// ─── IEEE Symbol: Utility Grid ────────────────────────────────────────────────

function drawUtilityGrid(cx: number, cy: number): string {
  const W = 130; const H = 80;
  const x = cx - W / 2; const y = cy - H / 2;
  let svg = '';
  svg += rect(x, y, W, H, { fill: '#F5F0FF', stroke: '#6600CC', strokeW: 2, rx: 4 });
  // Three-phase ground symbol
  for (let i = 0; i < 3; i++) {
    const lx = cx - 30 + i * 30;
    svg += line(lx, y + 10, lx, y + 38, { stroke: '#6600CC', strokeW: 2 });
    svg += line(lx - 12, y + 38, lx + 12, y + 38, { stroke: '#6600CC', strokeW: 2 });
    svg += line(lx - 8, y + 46, lx + 8, y + 46, { stroke: '#6600CC', strokeW: 1.5 });
    svg += line(lx - 4, y + 54, lx + 4, y + 54, { stroke: '#6600CC', strokeW: 1 });
  }
  svg += txt(cx, cy + 46, 'UTILITY GRID', { size: F.tiny, weight: 'bold', fill: '#6600CC' });
  svg += txt(cx, cy + 58, '120/240V · 60Hz', { size: 8, fill: C.textLight });
  return svg;
}

// ─── IEEE Symbol: Grounding Electrode System ──────────────────────────────────

function drawGES(cx: number, cy: number, egcGauge: string): string {
  let svg = '';
  svg += line(cx, cy, cx, cy + 18, { stroke: C.gnd, strokeW: 2 });
  svg += line(cx - 22, cy + 18, cx + 22, cy + 18, { stroke: C.gnd, strokeW: 2.5 });
  svg += line(cx - 15, cy + 26, cx + 15, cy + 26, { stroke: C.gnd, strokeW: 2 });
  svg += line(cx - 8, cy + 34, cx + 8, cy + 34, { stroke: C.gnd, strokeW: 1.5 });
  svg += txt(cx, cy + 48, 'GES', { size: F.tiny, weight: 'bold', fill: C.gnd });
  svg += txt(cx, cy + 60, egcGauge, { size: 8, fill: C.gnd });
  svg += txt(cx, cy + 72, 'NEC 250.52', { size: 8, fill: C.textLight });
  return svg;
}

// ─── Stage Background ─────────────────────────────────────────────────────────

function drawStage(stageIdx: number, label: string, subLabel: string): string {
  const x = DRAW_X + stageIdx * STAGE_W;
  const y = DRAW_Y;
  const border = C.stageBorder[stageIdx];
  const bg     = C.stageBg[stageIdx];
  const textColor = C.stageLabel[stageIdx];
  let svg = '';

  // Stage background
  svg += rect(x, y, STAGE_W, STAGE_H, { fill: bg, stroke: border, strokeW: 1.5, rx: 0 });

  // Stage header bar
  svg += rect(x, y, STAGE_W, STAGE_HEADER_H, { fill: border, stroke: 'none' });
  svg += txt(x + STAGE_W / 2, y + 14, `STAGE ${stageIdx + 1} — ${label}`, { size: 10, fill: '#FFFFFF', weight: 'bold' });
  svg += txt(x + STAGE_W / 2, y + 30, subLabel, { size: 8, fill: 'rgba(255,255,255,0.8)' });

  // Bottom sub-label
  svg += txt(x + STAGE_W / 2, y + STAGE_H - 8, subLabel, { size: 8, fill: textColor, italic: true });

  return svg;
}

// ─── Conductor Callout Label ──────────────────────────────────────────────────

function drawCallout(x: number, y: number, callout: string, color: string): string {
  if (!callout) return '';
  const parts = callout.split('+').map(s => s.trim()).filter(Boolean);
  const maxLen = Math.max(...parts.map(l => l.length));
  const W = Math.max(120, maxLen * 6.5 + 16);
  const H = parts.length * 15 + 10;
  let svg = '';
  svg += rect(x, y, W, H, { fill: '#FFFFF0', stroke: color, strokeW: 1, rx: 3 });
  parts.forEach((l, i) => {
    svg += txt(x + 6, y + 13 + i * 15, l, { size: F.callout, fill: color, anchor: 'start' });
  });
  return svg;
}

// ─── Horizontal Power Flow Arrow ──────────────────────────────────────────────

function drawFlowArrow(x1: number, y: number, x2: number, color: string, strokeW: number = 2.5): string {
  let svg = '';
  svg += line(x1, y, x2 - 12, y, { stroke: color, strokeW });
  svg += pathEl(`M${x2 - 12},${y - 6} L${x2},${y} L${x2 - 12},${y + 6}`,
    { fill: color, stroke: color, strokeW: 1 });
  return svg;
}

// ─── Vertical Connection ──────────────────────────────────────────────────────

function drawVertConn(x: number, y1: number, y2: number, color: string, strokeW: number = 2): string {
  return line(x, y1, x, y2, { stroke: color, strokeW });
}

// ─── Elbow Connection (right-angle) ───────────────────────────────────────────

function drawElbow(x1: number, y1: number, x2: number, y2: number, color: string, strokeW: number = 2): string {
  // Goes right then down (or up)
  return `<polyline points="${x1},${y1} ${x2},${y1} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="${strokeW}"/>`;
}

// ─── Title Block ──────────────────────────────────────────────────────────────

function drawTitleBlock(input: SLDBuildInput, totalDcKw: number, totalAcKw: number): string {
  const tbY = DRAW_Y + STAGE_H;
  const tbW = DRAW_W;
  let svg = '';

  // Background
  svg += rect(DRAW_X, tbY, tbW, TITLE_H, { fill: C.titleBg, stroke: C.border, strokeW: 1.5 });

  // Vertical dividers
  const col1 = DRAW_X + tbW * 0.30;
  const col2 = DRAW_X + tbW * 0.58;
  const col3 = DRAW_X + tbW * 0.80;
  svg += line(col1, tbY, col1, tbY + TITLE_H, { stroke: '#FFFFFF', strokeW: 0.5 });
  svg += line(col2, tbY, col2, tbY + TITLE_H, { stroke: '#FFFFFF', strokeW: 0.5 });
  svg += line(col3, tbY, col3, tbY + TITLE_H, { stroke: '#FFFFFF', strokeW: 0.5 });

  // Company header
  svg += txt(DRAW_X + 12, tbY + 22, 'SOLARPRO DESIGN PLATFORM', { size: 15, fill: '#FFFFFF', weight: 'bold', anchor: 'start' });
  svg += txt(DRAW_X + 12, tbY + 38, 'PERMIT-GRADE ENGINEERING DRAWINGS — SINGLE-LINE DIAGRAM', { size: 9, fill: '#AAB8CC', anchor: 'start' });

  // Project info (col 0)
  const fields: [string, string][] = [
    ['PROJECT:', input.projectName || '—'],
    ['CLIENT:', input.clientName || '—'],
    ['ADDRESS:', input.address || '—'],
    ['DESIGNER:', input.designer || '—'],
  ];
  fields.forEach(([label, value], i) => {
    svg += txt(DRAW_X + 12, tbY + 58 + i * 22, label, { size: 9, fill: '#AAB8CC', anchor: 'start', weight: 'bold' });
    svg += txt(DRAW_X + 82, tbY + 58 + i * 22, value.slice(0, 32), { size: 9, fill: '#FFFFFF', anchor: 'start' });
  });

  // System specs (col 1)
  const specs: [string, string][] = [
    ['NEC VERSION:', input.necVersion || 'NEC 2020'],
    ['DC CAPACITY:', `${totalDcKw.toFixed(2)} kW DC`],
    ['AC CAPACITY:', `${totalAcKw.toFixed(2)} kW AC`],
    ['SYSTEM VOLTAGE:', '240V / 120V'],
    ['INTERCONNECTION:', 'LOAD-SIDE (NEC 705.12)'],
    ['CONDUIT TYPE:', input.conduitType || 'EMT'],
  ];
  specs.forEach(([label, value], i) => {
    svg += txt(col1 + 12, tbY + 22 + i * 22, label, { size: 9, fill: '#AAB8CC', anchor: 'start', weight: 'bold' });
    svg += txt(col1 + 140, tbY + 22 + i * 22, value, { size: 9, fill: '#FFFFFF', anchor: 'start' });
  });

  // Equipment (col 2)
  const equip: [string, string][] = [
    ['INVERTER:', `${input.inverterSpecs?.[0]?.manufacturer || ''} ${input.inverterSpecs?.[0]?.model || ''}`.trim() || '—'],
    ['PANEL:', `${input.panelSpecs?.[0]?.manufacturer || ''} ${input.panelSpecs?.[0]?.model || ''}`.trim().slice(0, 28) || '—'],
    ['MAIN PANEL:', `${input.mainPanelBrand || ''} ${input.mainPanelAmps || ''}A`],
    ['UTILITY METER:', input.utilityMeter || '—'],
    ['RAPID SHUTDOWN:', input.rapidShutdown ? 'YES — NEC 690.12' : 'NO'],
    ['AC DISCONNECT:', input.acDisconnect ? 'YES — NEC 690.14' : 'NO'],
  ];
  equip.forEach(([label, value], i) => {
    svg += txt(col2 + 12, tbY + 22 + i * 22, label, { size: 9, fill: '#AAB8CC', anchor: 'start', weight: 'bold' });
    svg += txt(col2 + 120, tbY + 22 + i * 22, value.slice(0, 24), { size: 9, fill: '#FFFFFF', anchor: 'start' });
  });

  // Drawing info (col 3)
  const drawInfo: [string, string][] = [
    ['DRAWING NO:', input.drawingNumber || 'SLD-001'],
    ['SHEET:', `${input.sheetNumber || 'E-1'} of ${input.totalSheets || '1'}`],
    ['REVISION:', input.revision || '0'],
    ['DATE:', input.date || new Date().toISOString().split('T')[0]],
    ['SCALE:', 'NTS'],
    ['JURISDICTION:', input.jurisdiction || '—'],
  ];
  drawInfo.forEach(([label, value], i) => {
    svg += txt(col3 + 12, tbY + 22 + i * 22, label, { size: 9, fill: '#AAB8CC', anchor: 'start', weight: 'bold' });
    svg += txt(col3 + 110, tbY + 22 + i * 22, value, { size: 9, fill: '#FFFFFF', anchor: 'start' });
  });

  // Notes line
  if (input.notes) {
    svg += line(DRAW_X, tbY + TITLE_H - 24, DRAW_X + tbW, tbY + TITLE_H - 24, { stroke: '#FFFFFF', strokeW: 0.5 });
    svg += txt(DRAW_X + 12, tbY + TITLE_H - 8, `NOTES: ${input.notes.slice(0, 150)}`, { size: 8, fill: '#AAB8CC', anchor: 'start' });
  }

  // Footer
  svg += txt(DRAW_X + tbW - 12, tbY + TITLE_H - 8, 'Generated by SolarPro Engineering Engine V3.1 — Permit-Grade', { size: 7, fill: '#556677', anchor: 'end' });

  return svg;
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function drawLegend(x: number, y: number): string {
  let svg = '';
  const items = [
    { color: C.dc,   dash: '',    label: 'DC Conductor' },
    { color: C.ac,   dash: '',    label: 'AC Conductor' },
    { color: C.gnd,  dash: '6,3', label: 'Grounding (EGC)' },
    { color: C.bond, dash: '3,3', label: 'Bonding Conductor' },
  ];
  const W = 190; const H = items.length * 20 + 30;
  svg += rect(x - 8, y - 8, W, H, { fill: '#FAFAFA', stroke: '#CCCCCC', strokeW: 1, rx: 4 });
  svg += txt(x + W / 2 - 8, y + 8, 'LEGEND', { size: F.tiny, weight: 'bold', fill: C.equip });
  items.forEach((item, i) => {
    const ly = y + 24 + i * 20;
    svg += line(x, ly, x + 44, ly, { stroke: item.color, strokeW: 2.5, dash: item.dash });
    svg += txt(x + 52, ly + 4, item.label, { size: F.tiny, fill: C.textLight, anchor: 'start' });
  });
  return svg;
}

// ─── Auto-Resolution Overlay ──────────────────────────────────────────────────

function drawAutoResolutionOverlay(x: number, y: number, resolutions: any[]): string {
  if (!resolutions || resolutions.length === 0) return '';
  const visCount = Math.min(resolutions.length, 6);
  const H = visCount * 17 + 36;
  let svg = '';
  svg += rect(x, y, 340, H, { fill: '#F0FFF4', stroke: C.autoRes, strokeW: 1.5, rx: 4 });
  svg += txt(x + 12, y + 16, `✓ AUTO-RESOLVED: ${resolutions.length} CORRECTION${resolutions.length !== 1 ? 'S' : ''}`, { size: F.tiny, weight: 'bold', fill: C.autoRes, anchor: 'start' });
  resolutions.slice(0, visCount).forEach((r, i) => {
    const label = `• ${r.field}: ${r.originalValue} → ${r.resolvedValue} [${r.necReference || ''}]`;
    svg += txt(x + 12, y + 32 + i * 17, label, { size: 9, fill: C.autoRes, anchor: 'start' });
  });
  return svg;
}

// ─── Main Render Function ─────────────────────────────────────────────────────

export function renderSLDStaged(input: SLDBuildInput): string {
  const calc = input.calcResult;
  const inverters = calc?.inverters ?? [];

  // Compute totals
  const totalPanels = inverters.reduce((sum: number, inv: any) =>
    sum + (inv.strings ?? []).reduce((s: number, str: any) => s + (str.panelCount ?? 0), 0), 0) ||
    (input.panelSpecs?.length ? 10 : 10);

  const panelWatts = input.panelSpecs?.[0]?.watts ?? 400;
  const totalDcKw  = (totalPanels * panelWatts) / 1000;
  const totalAcKw  = inverters.reduce((sum: number, inv: any) => sum + (inv.acOutputKw ?? 0), 0) ||
    (input.inverterSpecs?.[0]?.acOutputKw ?? 7.6);

  // Topology detection
  const invSpec = input.inverterSpecs?.[0];
  const isMicro = invSpec?.model?.toLowerCase().includes('iq') ||
    invSpec?.model?.toLowerCase().includes('micro') ||
    invSpec?.manufacturer?.toLowerCase().includes('enphase');
  const hasOptimizer = invSpec?.manufacturer?.toLowerCase().includes('solaredge') ||
    (invSpec?.manufacturer?.toLowerCase().includes('huawei'));

  // Arrays from calc result or fallback
  const arrays = inverters.flatMap((inv: any) => inv.strings ?? []);
  const arrayCount = arrays.length || 1;

  let body = '';

  // ── Stage backgrounds ──────────────────────────────────────────────────────
  const stageLabels: [string, string][] = [
    ['ARRAY', isMicro ? 'Panels + Microinverters' : hasOptimizer ? 'Panels + Optimizers' : 'PV Panels'],
    ['STRING / BRANCH', isMicro ? 'AC Trunk Cable' : 'DC Wiring + Combiner'],
    ['INVERTER', isMicro ? 'AC Branch Circuit' : 'String Inverter'],
    ['AC COLLECTION', 'Disconnect + Meter'],
    ['INTERCONNECTION', 'Main Panel + Utility'],
  ];
  stageLabels.forEach(([label, sub], i) => {
    body += drawStage(i, label, sub);
  });

  // ── Stage X centers ────────────────────────────────────────────────────────
  const s1Cx = DRAW_X + STAGE_W * 0 + STAGE_W / 2;
  const s2Cx = DRAW_X + STAGE_W * 1 + STAGE_W / 2;
  const s3Cx = DRAW_X + STAGE_W * 2 + STAGE_W / 2;
  const s4Cx = DRAW_X + STAGE_W * 3 + STAGE_W / 2;
  const s5Cx = DRAW_X + STAGE_W * 4 + STAGE_W / 2;

  // Main horizontal flow Y (center of component area)
  const flowY = COMP_CY;

  // ── Stage 1: PV Array(s) ───────────────────────────────────────────────────
  let arrayPortsRight: { x: number; y: number }[] = [];

  if (arrayCount <= 1) {
    const str = arrays[0];
    const res = drawPVArray(
      s1Cx, flowY,
      str?.panelCount ?? totalPanels,
      panelWatts,
      str?.vocCorrected ?? (input.panelSpecs?.[0]?.voc ?? 41.6) * (str?.panelCount ?? 10),
      str?.ocpdRating ?? 20,
      str?.dcWireResult?.conductorCallout ?? '2#10 AWG USE-2/PV Wire',
      'ARRAY 1-1',
      hasOptimizer
    );
    body += res.svg;
    arrayPortsRight.push(res.portRight);
  } else {
    // Multiple arrays — stack vertically
    const maxArrays = Math.min(arrayCount, 4);
    const spacing = Math.min(200, (COMP_AREA_H - 60) / maxArrays);
    const startY = flowY - ((maxArrays - 1) * spacing) / 2;

    for (let i = 0; i < maxArrays; i++) {
      const str = arrays[i];
      const ay = startY + i * spacing;
      const invIdx = Math.floor(i / Math.max(1, arrayCount / inverters.length));
      const strIdx = i % Math.max(1, arrayCount / inverters.length);
      const res = drawPVArray(
        s1Cx, ay,
        str?.panelCount ?? 10,
        panelWatts,
        str?.vocCorrected ?? 416,
        str?.ocpdRating ?? 20,
        str?.dcWireResult?.conductorCallout ?? '2#10 AWG USE-2',
        `ARRAY ${invIdx + 1}-${strIdx + 1}`,
        hasOptimizer
      );
      body += res.svg;
      arrayPortsRight.push(res.portRight);
    }
  }

  // ── Stage 2: String/Branch ─────────────────────────────────────────────────
  let s2PortLeft:  { x: number; y: number } = { x: DRAW_X + STAGE_W, y: flowY };
  let s2PortRight: { x: number; y: number } = { x: DRAW_X + STAGE_W * 2, y: flowY };

  if (isMicro) {
    // AC trunk box
    const trunkY = flowY;
    body += rect(s2Cx - 65, trunkY - 45, 130, 90, { fill: '#F0F8FF', stroke: C.ac, strokeW: 2, rx: 4 });
    body += txt(s2Cx, trunkY - 22, 'AC TRUNK', { size: F.tiny, weight: 'bold', fill: '#001A66' });
    body += txt(s2Cx, trunkY - 6, 'Q-Cable / Trunk', { size: F.tiny, fill: C.textLight });
    body += txt(s2Cx, trunkY + 10, 'NEC 690.31', { size: 8, fill: C.textLight });
    body += txt(s2Cx, trunkY + 26, 'IQ Combiner 4C', { size: F.tiny, fill: C.ac });
    s2PortLeft  = { x: s2Cx - 65, y: trunkY };
    s2PortRight = { x: s2Cx + 65, y: trunkY };
  } else if (arrayCount > 2) {
    const res = drawCombiner(s2Cx, flowY, arrayCount);
    body += res.svg;
    s2PortLeft  = res.portLeft;
    s2PortRight = res.portRight;
  } else {
    // Direct DC wiring box
    body += rect(s2Cx - 70, flowY - 35, 140, 70, { fill: C.fillDC, stroke: C.dc, strokeW: 1.5, rx: 4 });
    body += txt(s2Cx, flowY - 14, 'DC STRING', { size: F.tiny, weight: 'bold', fill: '#8B1A00' });
    body += txt(s2Cx, flowY + 2, 'WIRING', { size: F.tiny, fill: C.textLight });
    body += txt(s2Cx, flowY + 18, 'NEC 690.31', { size: 8, fill: C.textLight });
    s2PortLeft  = { x: s2Cx - 70, y: flowY };
    s2PortRight = { x: s2Cx + 70, y: flowY };
  }

  // DC Disconnect (below main flow in stage 2)
  if (input.dcDisconnect && !isMicro) {
    const dcDiscY = flowY + 160;
    const dcDisc = drawDisconnect(s2Cx, dcDiscY, 'DC DISC.', 'NEC 690.15', C.dc, C.fillDC);
    body += dcDisc.svg;
    // Connect from main flow down to DC disconnect
    body += drawVertConn(s2Cx, flowY + 35, dcDiscY - 35, C.dc, 1.5);
    body += circle(s2Cx, flowY + 35, 3, { fill: C.dc, stroke: C.dc });
  }

  // Rapid Shutdown (above main flow in stage 2)
  if (input.rapidShutdown) {
    const rsY = flowY - 160;
    const rs = drawRapidShutdown(s2Cx, rsY);
    body += rs.svg;
    body += drawVertConn(s2Cx, rsY + 26, flowY - 35, C.dc, 1.5);
    body += circle(s2Cx, flowY - 35, 3, { fill: '#E65100', stroke: '#E65100' });
  }

  // ── Stage 3: Inverter ──────────────────────────────────────────────────────
  let s3PortLeft:  { x: number; y: number } = { x: DRAW_X + STAGE_W * 2, y: flowY };
  let s3PortRight: { x: number; y: number } = { x: DRAW_X + STAGE_W * 3, y: flowY };

  if (isMicro) {
    const res = drawMicroBranch(
      s3Cx, flowY,
      totalPanels,
      invSpec?.manufacturer ?? 'Enphase',
      invSpec?.model ?? 'IQ8+',
      invSpec?.acOutputKw ? invSpec.acOutputKw * 1000 / totalPanels : 295
    );
    body += res.svg;
    s3PortLeft  = res.portLeft;
    s3PortRight = res.portRight;
  } else {
    const res = drawStringInverter(
      s3Cx, flowY,
      invSpec?.manufacturer ?? 'SolarEdge',
      invSpec?.model ?? 'SE7600H-US',
      invSpec?.acOutputKw ?? 7.6,
      invSpec?.efficiency ?? 99.2
    );
    body += res.svg;
    s3PortLeft  = res.portLeft;
    s3PortRight = res.portRight;
  }

  // AC wire callout (below inverter)
  const acCallout = calc?.acConductorCallout ??
    calc?.inverters?.[0]?.acWireResult?.conductorCallout ?? '';
  if (acCallout) {
    body += drawCallout(s3Cx - 85, flowY + 90, acCallout, C.ac);
  }

  // ── Stage 4: AC Collection ─────────────────────────────────────────────────
  // AC Disconnect (upper half of stage 4)
  const acDiscY = flowY - 80;
  let s4RightPortY = flowY;

  if (input.acDisconnect) {
    const acDisc = drawDisconnect(s4Cx, acDiscY, 'AC DISC.', 'NEC 690.14', C.ac, C.fillAC);
    body += acDisc.svg;
    // Vertical connector from AC disc down to production meter
    body += drawVertConn(s4Cx, acDiscY + 35, flowY + 40, C.ac, 2);
    s4RightPortY = acDiscY;
  }

  // Production meter (lower half of stage 4)
  if (input.productionMeter) {
    const prodMeter = drawMeter(s4Cx, flowY + 100, 'kWh', 'PROD.', 'PRODUCTION METER', 'NEC 690.54', '#006600', '#F0FFF0');
    body += prodMeter.svg;
  }

  // EGC vertical run (right edge of stage 4)
  const egcX = DRAW_X + STAGE_W * 4 - 24;
  body += line(egcX, COMP_AREA_Y + 20, egcX, COMP_AREA_Y + COMP_AREA_H - 80, { stroke: C.gnd, strokeW: 1.5, dash: '6,3' });
  body += txt(egcX + 8, COMP_AREA_Y + COMP_AREA_H / 2, `EGC ${calc?.groundingConductor ?? '#12 AWG'}`, { size: 8, fill: C.gnd, anchor: 'start' });
  body += txt(egcX + 8, COMP_AREA_Y + COMP_AREA_H / 2 + 14, '(NEC 250.122)', { size: 7, fill: C.gnd, anchor: 'start' });

  // ── Stage 5: Interconnection ───────────────────────────────────────────────
  const busbar = calc?.busbar;
  const mspY = flowY - 80;

  const msp = drawMSP(
    s5Cx, mspY,
    input.mainPanelBrand ?? 'Square D',
    input.mainPanelAmps ?? 200,
    busbar?.backfeedBreakerRequired ?? Math.round((totalAcKw / 0.24) * 1.25 / 5) * 5,
    busbar?.busbarRule ?? '120% Rule'
  );
  body += msp.svg;

  // Utility meter (below MSP)
  const utilMeterY = flowY + 100;
  const utilMeter = drawMeter(s5Cx, utilMeterY, 'kWh', 'NET', 'UTILITY METER', 'Bidirectional', '#6600CC', '#F5F0FF');
  body += utilMeter.svg;

  // Utility grid (below utility meter)
  body += drawUtilityGrid(s5Cx, utilMeterY + 130);

  // GES (bottom of stage 5)
  body += drawGES(s5Cx - 90, utilMeterY + 100, calc?.groundingConductor ?? '#12 AWG');

  // Vertical connection: MSP → Utility meter
  body += drawVertConn(s5Cx, mspY + 80, utilMeterY - 36, C.ac, 2);
  // Vertical connection: Utility meter → Grid
  body += drawVertConn(s5Cx, utilMeterY + 36, utilMeterY + 90, '#6600CC', 2);

  // ── Horizontal flow connections ────────────────────────────────────────────
  // Stage 1 → Stage 2 (DC): from array right port to s2 left port
  const s1RightX = arrayPortsRight.length > 0 ? arrayPortsRight[0].x : DRAW_X + STAGE_W - 10;
  const s2LeftX  = s2PortLeft.x;

  if (arrayPortsRight.length === 1) {
    body += drawFlowArrow(s1RightX, arrayPortsRight[0].y, s2LeftX, C.dc, 2.5);
  } else {
    // Multiple arrays: collect to a vertical bus then to combiner
    const busX = DRAW_X + STAGE_W - 20;
    arrayPortsRight.forEach(port => {
      body += drawFlowArrow(port.x, port.y, busX, C.dc, 2);
    });
    body += drawVertConn(busX, arrayPortsRight[0].y, arrayPortsRight[arrayPortsRight.length - 1].y, C.dc, 2);
    body += drawFlowArrow(busX, flowY, s2LeftX, C.dc, 2.5);
  }

  // Stage 2 → Stage 3 (DC)
  body += drawFlowArrow(s2PortRight.x, s2PortRight.y, s3PortLeft.x, isMicro ? C.ac : C.dc, 2.5);

  // Stage 3 → Stage 4 (AC): inverter right port → AC disconnect left port (or stage center)
  const s4LeftX = DRAW_X + STAGE_W * 3;
  const s4TargetX = input.acDisconnect ? s4Cx - 45 : s4Cx;
  const s4TargetY = input.acDisconnect ? acDiscY : flowY;
  // Draw elbow if Y levels differ
  if (Math.abs(s3PortRight.y - s4TargetY) > 5) {
    body += `<polyline points="${s3PortRight.x},${s3PortRight.y} ${s4TargetX - 20},${s3PortRight.y} ${s4TargetX - 20},${s4TargetY} ${s4TargetX},${s4TargetY}" fill="none" stroke="${C.ac}" stroke-width="2.5"/>`;
    body += pathEl(`M${s4TargetX - 12},${s4TargetY - 6} L${s4TargetX},${s4TargetY} L${s4TargetX - 12},${s4TargetY + 6}`, { fill: C.ac, stroke: C.ac, strokeW: 1 });
  } else {
    body += drawFlowArrow(s3PortRight.x, s3PortRight.y, s4TargetX, C.ac, 2.5);
  }

  // Stage 4 → Stage 5 (AC): from AC disconnect right port to MSP left port
  // Both are at the same Y (acDiscY / mspY), so draw a straight horizontal arrow
  const s4ToS5Y = input.acDisconnect ? acDiscY : flowY;
  const s4RightEdge = DRAW_X + STAGE_W * 4;
  body += drawFlowArrow(s4RightEdge, s4ToS5Y, msp.portLeft.x, C.ac, 2.5);
  // Also connect AC disconnect right port to stage boundary
  if (input.acDisconnect) {
    body += drawFlowArrow(s4Cx + 45, acDiscY, s4RightEdge, C.ac, 2);
  }

  // ── Legend ─────────────────────────────────────────────────────────────────
  body += drawLegend(DRAW_X + DRAW_W - 210, DRAW_Y + STAGE_HEADER_H + 10);

  // ── Auto-resolution overlay ────────────────────────────────────────────────
  if (calc?.autoResolutions?.length > 0) {
    body += drawAutoResolutionOverlay(DRAW_X + 10, DRAW_Y + STAGE_HEADER_H + 10, calc.autoResolutions);
  }

  // ── Title block ────────────────────────────────────────────────────────────
  body += drawTitleBlock(input, totalDcKw, totalAcKw);

  // ── Sheet border ───────────────────────────────────────────────────────────
  body += rect(MARGIN / 2, MARGIN / 2, SHEET_W - MARGIN, SHEET_H - MARGIN,
    { stroke: C.border, strokeW: 2.5, fill: 'none' });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${SHEET_W}" height="${SHEET_H}"
     viewBox="0 0 ${SHEET_W} ${SHEET_H}">
  <rect width="${SHEET_W}" height="${SHEET_H}" fill="${C.bg}"/>
  ${body}
</svg>`;
}