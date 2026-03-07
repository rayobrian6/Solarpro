// ============================================================
// Permit-Grade Single-Line Diagram Renderer
// Output: SVG string — ANSI C (18×24 inch) at 96 DPI = 1728×2304px
// IEEE electrical schematic symbols
// No React dependency — pure string generation
// ============================================================

import { SLDBuildInput, SLDDocument, ConductorCallout } from './sld-types';

// ─── Sheet Constants (ANSI C at 96 DPI) ──────────────────────────────────────
const SHEET_W = 1728;   // 18 inches × 96 DPI
const SHEET_H = 2304;   // 24 inches × 96 DPI
const MARGIN  = 72;     // 0.75 inch margin
const TITLE_H = 192;    // title block height (2 inches)
const NOTES_H = 160;    // notes block height
const DRAW_W  = SHEET_W - MARGIN * 2;
const DRAW_H  = SHEET_H - MARGIN * 2 - TITLE_H - NOTES_H;
const DRAW_X  = MARGIN;
const DRAW_Y  = MARGIN;

// ─── Color Palette (engineering drawing style) ────────────────────────────────
const C = {
  bg:        '#FFFFFF',
  border:    '#000000',
  line:      '#1A1A1A',
  dc:        '#CC3300',   // DC conductors — red
  ac:        '#003399',   // AC conductors — blue
  gnd:       '#006600',   // Grounding — green
  bond:      '#996600',   // Bonding — brown
  equip:     '#1A1A1A',   // Equipment outlines
  fill:      '#F5F5F5',   // Equipment fill
  fillDC:    '#FFF5F0',   // DC equipment fill
  fillAC:    '#F0F5FF',   // AC equipment fill
  fillGND:   '#F0FFF0',   // Grounding fill
  text:      '#000000',
  textLight: '#444444',
  textSmall: '#666666',
  accent:    '#CC6600',   // callout accent
  titleBg:   '#1A2744',   // title block background
  titleText: '#FFFFFF',
  gridLine:  '#E8E8E8',
};

// ─── Font Sizes ───────────────────────────────────────────────────────────────
const F = {
  title:    28,
  heading:  18,
  body:     14,
  small:    12,
  tiny:     10,
  label:    13,
  callout:  11,
};

// ─── SVG Helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rect(x: number, y: number, w: number, h: number, opts: {
  fill?: string; stroke?: string; strokeW?: number; rx?: number; opacity?: number;
} = {}): string {
  const fill   = opts.fill   ?? 'none';
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1;
  const rx     = opts.rx ?? 0;
  const op     = opts.opacity !== undefined ? ` opacity="${opts.opacity}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"${op}/>`;
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

function text(x: number, y: number, content: string, opts: {
  size?: number; fill?: string; anchor?: string; weight?: string;
  family?: string; dy?: number;
} = {}): string {
  const size   = opts.size   ?? F.body;
  const fill   = opts.fill   ?? C.text;
  const anchor = opts.anchor ?? 'middle';
  const weight = opts.weight ?? 'normal';
  const family = opts.family ?? 'Arial, Helvetica, sans-serif';
  const dy     = opts.dy !== undefined ? ` dy="${opts.dy}"` : '';
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="${family}"${dy}>${esc(content)}</text>`;
}

function polyline(points: [number, number][], opts: {
  stroke?: string; strokeW?: number; fill?: string; dash?: string;
} = {}): string {
  const pts    = points.map(([x, y]) => `${x},${y}`).join(' ');
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1.5;
  const fill   = opts.fill ?? 'none';
  const dash   = opts.dash ? ` stroke-dasharray="${opts.dash}"` : '';
  return `<polyline points="${pts}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"${dash}/>`;
}

function circle(cx: number, cy: number, r: number, opts: {
  fill?: string; stroke?: string; strokeW?: number;
} = {}): string {
  const fill   = opts.fill   ?? 'none';
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1.5;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function path(d: string, opts: {
  fill?: string; stroke?: string; strokeW?: number;
} = {}): string {
  const fill   = opts.fill   ?? 'none';
  const stroke = opts.stroke ?? C.line;
  const sw     = opts.strokeW ?? 1.5;
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

// Arrow head pointing down
function arrowDown(x: number, y: number, color: string = C.line): string {
  return `<polygon points="${x},${y} ${x - 6},${y - 10} ${x + 6},${y - 10}" fill="${color}" stroke="none"/>`;
}

// ─── IEEE Electrical Symbols ──────────────────────────────────────────────────

// PV Module symbol (simplified IEEE)
function symPVArray(cx: number, cy: number, w: number, h: number, label: string, sublabel: string): string {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, w, h, { fill: C.fillDC, stroke: C.dc, strokeW: 2, rx: 4 }));
  // Solar cell grid lines
  const cols = 3; const rows = 2;
  const cw = w / cols; const ch = h / rows;
  for (let i = 1; i < cols; i++) parts.push(line(x + i * cw, y + 4, x + i * cw, y + h - 4, { stroke: C.dc, strokeW: 0.75 }));
  for (let j = 1; j < rows; j++) parts.push(line(x + 4, y + j * ch, x + w - 4, y + j * ch, { stroke: C.dc, strokeW: 0.75 }));
  // Sun symbol
  parts.push(circle(cx, cy - 8, 10, { fill: '#FFD700', stroke: '#CC8800', strokeW: 1 }));
  // Label
  parts.push(text(cx, y + h + 16, label, { size: F.label, weight: 'bold', fill: C.dc }));
  parts.push(text(cx, y + h + 30, sublabel, { size: F.small, fill: C.textLight }));
  return parts.join('\n');
}

// Inverter symbol (IEEE rectangle with ~ symbol)
function symInverter(cx: number, cy: number, w: number, h: number, label: string, sublabel: string): string {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, w, h, { fill: C.fillAC, stroke: C.ac, strokeW: 2, rx: 4 }));
  // DC→AC symbol
  parts.push(text(cx - 18, cy + 2, 'DC', { size: F.small, fill: C.dc, weight: 'bold', anchor: 'middle' }));
  parts.push(text(cx, cy + 2, '→', { size: F.body, fill: C.text, anchor: 'middle' }));
  parts.push(text(cx + 18, cy + 2, 'AC', { size: F.small, fill: C.ac, weight: 'bold', anchor: 'middle' }));
  // Sine wave
  parts.push(path(`M ${cx - 10} ${cy + 14} Q ${cx - 5} ${cy + 8} ${cx} ${cy + 14} Q ${cx + 5} ${cy + 20} ${cx + 10} ${cy + 14}`,
    { stroke: C.ac, strokeW: 1.5 }));
  parts.push(text(cx, y + h + 16, label, { size: F.label, weight: 'bold', fill: C.ac }));
  parts.push(text(cx, y + h + 30, sublabel, { size: F.small, fill: C.textLight }));
  return parts.join('\n');
}

// Disconnect switch symbol (IEEE — open blade)
function symDisconnect(cx: number, cy: number, label: string, color: string = C.line): string {
  const parts: string[] = [];
  const bw = 56; const bh = 36;
  parts.push(rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: C.fill, stroke: color, strokeW: 2, rx: 3 }));
  // Blade symbol
  parts.push(line(cx - 14, cy + 6, cx - 14, cy - 6, { stroke: color, strokeW: 2 }));
  parts.push(line(cx + 14, cy + 6, cx + 14, cy - 6, { stroke: color, strokeW: 2 }));
  parts.push(line(cx - 14, cy - 6, cx + 8, cy - 14, { stroke: color, strokeW: 2 })); // open blade
  parts.push(text(cx, cy + bh / 2 + 14, label, { size: F.small, weight: 'bold', fill: color }));
  return parts.join('\n');
}

// Circuit breaker symbol (IEEE)
function symBreaker(cx: number, cy: number, amps: number, label: string, color: string = C.ac): string {
  const parts: string[] = [];
  parts.push(circle(cx, cy, 18, { fill: C.fill, stroke: color, strokeW: 2 }));
  // Breaker arc
  parts.push(path(`M ${cx - 8} ${cy + 6} Q ${cx} ${cy - 10} ${cx + 8} ${cy + 6}`, { stroke: color, strokeW: 2 }));
  parts.push(text(cx, cy + 4, `${amps}A`, { size: F.tiny, weight: 'bold', fill: color }));
  parts.push(text(cx, cy + 32, label, { size: F.small, fill: color }));
  return parts.join('\n');
}

// Main service panel symbol
function symMSP(cx: number, cy: number, w: number, h: number, brand: string, amps: number, backfeed: number): string {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const parts: string[] = [];
  parts.push(rect(x, y, w, h, { fill: C.fill, stroke: C.line, strokeW: 2.5, rx: 4 }));
  // Bus bars
  parts.push(line(cx - 20, y + 16, cx - 20, y + h - 16, { stroke: C.ac, strokeW: 3 }));
  parts.push(line(cx + 20, y + 16, cx + 20, y + h - 16, { stroke: C.ac, strokeW: 3 }));
  // Breaker slots
  for (let i = 0; i < 4; i++) {
    const by = y + 20 + i * 14;
    parts.push(rect(cx - 16, by, 12, 10, { fill: '#DDD', stroke: '#999', strokeW: 0.5 }));
    parts.push(rect(cx + 4, by, 12, 10, { fill: '#DDD', stroke: '#999', strokeW: 0.5 }));
  }
  parts.push(text(cx, y + h - 28, brand, { size: F.small, weight: 'bold' }));
  parts.push(text(cx, y + h - 14, `${amps}A MSP`, { size: F.small, fill: C.textLight }));
  parts.push(text(cx, y + h + 16, `MAIN SERVICE PANEL`, { size: F.label, weight: 'bold' }));
  parts.push(text(cx, y + h + 30, `Backfeed: ${backfeed}A (NEC 705.12)`, { size: F.small, fill: C.textLight }));
  return parts.join('\n');
}

// Utility meter symbol (circle with M)
function symUtilityMeter(cx: number, cy: number, label: string): string {
  const parts: string[] = [];
  parts.push(circle(cx, cy, 28, { fill: C.fill, stroke: C.line, strokeW: 2 }));
  parts.push(text(cx, cy + 5, 'kWh', { size: F.small, weight: 'bold' }));
  parts.push(text(cx, cy + 44, label, { size: F.label, weight: 'bold' }));
  parts.push(text(cx, cy + 58, 'UTILITY METER', { size: F.small, fill: C.textLight }));
  return parts.join('\n');
}

// Grounding electrode symbol (IEEE)
function symGrounding(cx: number, cy: number, egcGauge: string): string {
  const parts: string[] = [];
  // Ground symbol (3 horizontal lines decreasing)
  parts.push(line(cx - 20, cy, cx + 20, cy, { stroke: C.gnd, strokeW: 2 }));
  parts.push(line(cx - 14, cy + 8, cx + 14, cy + 8, { stroke: C.gnd, strokeW: 2 }));
  parts.push(line(cx - 8, cy + 16, cx + 8, cy + 16, { stroke: C.gnd, strokeW: 2 }));
  parts.push(text(cx, cy + 32, 'GES', { size: F.small, weight: 'bold', fill: C.gnd }));
  parts.push(text(cx, cy + 44, egcGauge, { size: F.tiny, fill: C.gnd }));
  return parts.join('\n');
}

// Rapid shutdown symbol
function symRapidShutdown(cx: number, cy: number): string {
  const parts: string[] = [];
  const bw = 72; const bh = 40;
  parts.push(rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: '#FFF3E0', stroke: '#E65100', strokeW: 2, rx: 4 }));
  parts.push(text(cx, cy - 4, 'RAPID', { size: F.small, weight: 'bold', fill: '#E65100' }));
  parts.push(text(cx, cy + 10, 'SHUTDOWN', { size: F.small, weight: 'bold', fill: '#E65100' }));
  parts.push(text(cx, cy + bh / 2 + 14, 'NEC 690.12', { size: F.tiny, fill: C.textLight }));
  return parts.join('\n');
}

// Production meter symbol
function symProductionMeter(cx: number, cy: number): string {
  const parts: string[] = [];
  parts.push(circle(cx, cy, 22, { fill: '#F0FFF0', stroke: '#006600', strokeW: 2 }));
  parts.push(text(cx, cy - 2, 'kWh', { size: F.tiny, weight: 'bold', fill: '#006600' }));
  parts.push(text(cx, cy + 10, 'PROD', { size: F.tiny, fill: '#006600' }));
  parts.push(text(cx, cy + 36, 'PRODUCTION METER', { size: F.small, weight: 'bold', fill: '#006600' }));
  return parts.join('\n');
}

// Battery storage symbol
function symBattery(cx: number, cy: number, brand: string, kwh: number, backfeedA?: number): string {
  const parts: string[] = [];
  const bw = 90; const bh = 56;
  parts.push(rect(cx - bw / 2, cy - bh / 2, bw, bh, { fill: '#F3E5F5', stroke: '#6A1B9A', strokeW: 2, rx: 4 }));
  // Battery cell symbol (NEC 706 ESS icon)
  parts.push(line(cx - 16, cy - 10, cx - 16, cy + 10, { stroke: '#6A1B9A', strokeW: 3 }));
  parts.push(line(cx - 8, cy - 6, cx - 8, cy + 6, { stroke: '#6A1B9A', strokeW: 1.5 }));
  parts.push(line(cx, cy - 10, cx, cy + 10, { stroke: '#6A1B9A', strokeW: 3 }));
  parts.push(line(cx + 8, cy - 6, cx + 8, cy + 6, { stroke: '#6A1B9A', strokeW: 1.5 }));
  parts.push(line(cx + 16, cy - 10, cx + 16, cy + 10, { stroke: '#6A1B9A', strokeW: 3 }));
  parts.push(text(cx, cy + bh / 2 + 16, brand, { size: F.small, weight: 'bold', fill: '#6A1B9A' }));
  parts.push(text(cx, cy + bh / 2 + 30, `${kwh.toFixed(1)} kWh`, { size: F.small, fill: C.textLight }));
  if (backfeedA && backfeedA > 0) {
    parts.push(text(cx, cy + bh / 2 + 44, `${backfeedA}A backfeed (NEC 705.12B)`, { size: F.tiny, fill: '#6A1B9A' }));
  }
  return parts.join('\n');
}

function symGenerator(cx: number, cy: number, brand: string, kw: number): string {
  const parts: string[] = [];
  const gw = 90; const gh = 56;
  // Generator box — green tones (NEC 702 standby)
  parts.push(rect(cx - gw / 2, cy - gh / 2, gw, gh, { fill: '#E8F5E9', stroke: '#2E7D32', strokeW: 2, rx: 4 }));
  // Generator symbol: circle with G
  parts.push(`<circle cx="${cx}" cy="${cy - 4}" r="14" fill="none" stroke="#2E7D32" stroke-width="2"/>`);
  parts.push(text(cx, cy - 1, 'G', { size: F.label, weight: 'bold', fill: '#2E7D32' }));
  // Sine wave inside circle (simplified)
  parts.push(`<path d="M ${cx - 8} ${cy - 4} Q ${cx - 4} ${cy - 10} ${cx} ${cy - 4} Q ${cx + 4} ${cy + 2} ${cx + 8} ${cy - 4}" fill="none" stroke="#2E7D32" stroke-width="1.5"/>`);
  parts.push(text(cx, cy + gh / 2 - 6, `${kw}kW GENERATOR`, { size: F.tiny, weight: 'bold', fill: '#2E7D32' }));
  parts.push(text(cx, cy + gh / 2 + 14, brand, { size: F.small, weight: 'bold', fill: '#2E7D32' }));
  parts.push(text(cx, cy + gh / 2 + 28, 'NEC 702 · UL 2200', { size: F.tiny, fill: C.textLight }));
  return parts.join('\n');
}

function symATS(cx: number, cy: number, brand: string, amps: number, neutralSwitched: boolean): string {
  const parts: string[] = [];
  const aw = 100; const ah = 52;
  // ATS box — orange tones (transfer switch)
  parts.push(rect(cx - aw / 2, cy - ah / 2, aw, ah, { fill: '#FFF3E0', stroke: '#E65100', strokeW: 2, rx: 4 }));
  // ATS symbol: two arrows pointing toward center (transfer)
  parts.push(line(cx - 28, cy - 6, cx - 10, cy - 6, { stroke: '#E65100', strokeW: 2 }));
  parts.push(line(cx - 10, cy - 6, cx - 16, cy - 12, { stroke: '#E65100', strokeW: 2 }));
  parts.push(line(cx - 10, cy - 6, cx - 16, cy, { stroke: '#E65100', strokeW: 2 }));
  parts.push(line(cx + 28, cy + 6, cx + 10, cy + 6, { stroke: '#E65100', strokeW: 2 }));
  parts.push(line(cx + 10, cy + 6, cx + 16, cy, { stroke: '#E65100', strokeW: 2 }));
  parts.push(line(cx + 10, cy + 6, cx + 16, cy + 12, { stroke: '#E65100', strokeW: 2 }));
  parts.push(text(cx, cy + ah / 2 + 14, `${brand} ATS · ${amps}A`, { size: F.small, weight: 'bold', fill: '#E65100' }));
  parts.push(text(cx, cy + ah / 2 + 28, neutralSwitched ? 'Switched Neutral · NEC 250.30' : 'NEC 702.5', { size: F.tiny, fill: C.textLight }));
  return parts.join('\n');
}

// Conductor callout label (engineering format)
function conductorCalloutLabel(x: number, y: number, callout: string, vdrop: number, color: string): string {
  const parts: string[] = [];
  const w = Math.max(callout.length * 6.5, 180);
  parts.push(rect(x - w / 2, y - 10, w, 22, { fill: '#FFFFF0', stroke: color, strokeW: 1, rx: 2 }));
  parts.push(text(x, y + 5, callout, { size: F.callout, fill: color, weight: 'bold' }));
  if (vdrop > 0) {
    parts.push(text(x, y + 20, `VD: ${vdrop.toFixed(2)}%`, { size: F.tiny, fill: C.textSmall }));
  }
  return parts.join('\n');
}

// ─── Title Block ──────────────────────────────────────────────────────────────

function renderTitleBlock(tb: SLDBuildInput): string {
  const x = MARGIN;
  const y = SHEET_H - MARGIN - TITLE_H;
  const w = DRAW_W;
  const h = TITLE_H;
  const parts: string[] = [];

  // Background
  parts.push(rect(x, y, w, h, { fill: C.titleBg, stroke: C.border, strokeW: 2 }));

  // Left section — company / project info
  const col1w = w * 0.38;
  parts.push(rect(x, y, col1w, h, { fill: C.titleBg, stroke: C.border, strokeW: 1 }));
  parts.push(text(x + col1w / 2, y + 28, 'SOLARPRO DESIGN PLATFORM', { size: F.heading, fill: C.titleText, weight: 'bold' }));
  parts.push(text(x + col1w / 2, y + 48, 'PERMIT-GRADE ENGINEERING DRAWINGS', { size: F.small, fill: '#AAB8D0' }));
  parts.push(line(x, y + 56, x + col1w, y + 56, { stroke: '#3A4F7A', strokeW: 1 }));

  // Project details
  const rows = [
    ['PROJECT:', tb.projectName],
    ['CLIENT:', tb.clientName],
    ['ADDRESS:', tb.address],
    ['DESIGNER:', tb.designer],
  ];
  rows.forEach(([label, value], i) => {
    const ry = y + 72 + i * 28;
    parts.push(text(x + 12, ry, label, { size: F.small, fill: '#AAB8D0', anchor: 'start' }));
    parts.push(text(x + 90, ry, value || '—', { size: F.small, fill: C.titleText, anchor: 'start', weight: 'bold' }));
  });

  // Middle section — system specs
  const col2x = x + col1w;
  const col2w = w * 0.32;
  parts.push(rect(col2x, y, col2w, h, { fill: C.titleBg, stroke: C.border, strokeW: 1 }));
  parts.push(text(col2x + col2w / 2, y + 28, 'SYSTEM SPECIFICATIONS', { size: F.label, fill: '#AAB8D0', weight: 'bold' }));
  parts.push(line(col2x, y + 36, col2x + col2w, y + 36, { stroke: '#3A4F7A', strokeW: 1 }));

  const specs = [
    ['NEC VERSION:', tb.necVersion || '—'],
    ['DC CAPACITY:', `${(tb.systemSizeDC || '—')}`],
    ['AC CAPACITY:', `${(tb.systemSizeAC || '—')}`],
    ['SYSTEM VOLTAGE:', '240V / 120V'],
    ['INTERCONNECTION:', 'LOAD-SIDE (NEC 705.12)'],
  ];
  specs.forEach(([label, value], i) => {
    const ry = y + 52 + i * 26;
    parts.push(text(col2x + 12, ry, label, { size: F.small, fill: '#AAB8D0', anchor: 'start' }));
    parts.push(text(col2x + 140, ry, value, { size: F.small, fill: C.titleText, anchor: 'start', weight: 'bold' }));
  });

  // Right section — drawing info
  const col3x = col2x + col2w;
  const col3w = w - col1w - col2w;
  parts.push(rect(col3x, y, col3w, h, { fill: C.titleBg, stroke: C.border, strokeW: 1 }));

  const drawInfo = [
    ['DRAWING NO:', tb.drawingNumber || 'SLD-001'],
    ['SHEET:', `${tb.sheetNumber || 'E-1'} of ${tb.totalSheets || '1'}`],
    ['REVISION:', tb.revision || '0'],
    ['DATE:', tb.preparedDate || tb.date],
    ['SCALE:', 'NTS'],
    ['JURISDICTION:', tb.jurisdiction || '—'],
  ];
  drawInfo.forEach(([label, value], i) => {
    const ry = y + 28 + i * 26;
    parts.push(text(col3x + 12, ry, label, { size: F.small, fill: '#AAB8D0', anchor: 'start' }));
    parts.push(text(col3x + 110, ry, value, { size: F.small, fill: C.titleText, anchor: 'start', weight: 'bold' }));
  });

  // Revision block at bottom
  const revY = y + h - 36;
  parts.push(line(x, revY, x + w, revY, { stroke: '#3A4F7A', strokeW: 1 }));
  parts.push(text(x + 12, revY + 20, 'REV 0 — INITIAL ISSUE', { size: F.small, fill: '#AAB8D0', anchor: 'start' }));
  parts.push(text(x + w - 12, revY + 20, `Generated by SolarPro V3 Engineering Engine`, { size: F.tiny, fill: '#556080', anchor: 'end' }));

  return parts.join('\n');
}

// ─── Notes Block ──────────────────────────────────────────────────────────────

function renderNotesBlock(input: SLDBuildInput): string {
  const x = MARGIN;
  const y = SHEET_H - MARGIN - TITLE_H - NOTES_H;
  const w = DRAW_W;
  const h = NOTES_H;
  const parts: string[] = [];

  parts.push(rect(x, y, w, h, { fill: '#FAFAFA', stroke: C.border, strokeW: 1.5 }));
  parts.push(text(x + 12, y + 18, 'GENERAL NOTES:', { size: F.label, weight: 'bold', anchor: 'start' }));
  parts.push(line(x, y + 24, x + w, y + 24, { stroke: '#CCC', strokeW: 1 }));

  const nec = input.calcResult?.inverters?.[0] ? input.necVersion : 'NEC 2020';
  const notes = [
    `1. All work shall comply with ${nec}, local codes, and AHJ requirements.`,
    `2. All conductors shall be copper unless otherwise noted. Minimum conductor size #12 AWG.`,
    `3. All equipment shall be listed and labeled per NEC 110.3(B). Install per manufacturer instructions.`,
    `4. Rapid shutdown system required per NEC 690.12. Initiation device at utility meter or main panel.`,
    `5. All DC conductors shall be identified: positive (+) red, negative (−) white with red stripe or labeled.`,
    `6. Grounding electrode system per NEC 250.50. Bond all metallic equipment per NEC 250.97.`,
    `7. Verify utility interconnection requirements with serving utility prior to installation.`,
    `8. Installer shall verify all dimensions and conditions in field prior to installation.`,
  ];

  const colW = w / 2 - 20;
  notes.forEach((note, i) => {
    const col = i < 4 ? 0 : 1;
    const row = i < 4 ? i : i - 4;
    const nx = x + 12 + col * (colW + 20);
    const ny = y + 38 + row * 26;
    parts.push(text(nx, ny, note, { size: F.tiny, fill: C.textLight, anchor: 'start' }));
  });

  return parts.join('\n');
}

// ─── Main Diagram Renderer ────────────────────────────────────────────────────

export function renderSLD(input: SLDBuildInput): string {
  const parts: string[] = [];
  const calc = input.calcResult;
  const inv0 = calc?.inverters?.[0];

  // ── Layout: vertical flow from top (PV arrays) to bottom (utility) ─────────
  // Available drawing area: DRAW_X, DRAW_Y, DRAW_W, DRAW_H
  const cx = DRAW_X + DRAW_W / 2;

  // Vertical positions (normalized to drawing area)
  const yPV       = DRAW_Y + 80;
  const yDCWire1  = DRAW_Y + 180;
  const yDCDisc   = DRAW_Y + 240;
  const yRSD      = DRAW_Y + 340;
  const yDCWire2  = DRAW_Y + 420;
  const yInverter = DRAW_Y + 500;
  const yACWire1  = DRAW_Y + 620;
  const yACDisc   = DRAW_Y + 680;
  const yACWire2  = DRAW_Y + 760;
  const yProdMtr  = DRAW_Y + 840;
  const yACWire3  = DRAW_Y + 920;
  const yMSP      = DRAW_Y + 1020;
  const yACWire4  = DRAW_Y + 1140;
  const yUtilMtr  = DRAW_Y + 1220;
  const yGrid     = DRAW_Y + 1340;
  const yGND      = DRAW_Y + 1460;

  // ── Sheet border ────────────────────────────────────────────────────────────
  parts.push(rect(0, 0, SHEET_W, SHEET_H, { fill: C.bg, stroke: 'none' }));
  parts.push(rect(MARGIN / 2, MARGIN / 2, SHEET_W - MARGIN, SHEET_H - MARGIN,
    { fill: 'none', stroke: C.border, strokeW: 3 }));
  parts.push(rect(MARGIN, MARGIN, DRAW_W, SHEET_H - MARGIN * 2,
    { fill: 'none', stroke: C.border, strokeW: 1 }));

  // ── Drawing title ───────────────────────────────────────────────────────────
  parts.push(text(cx, DRAW_Y + 30, 'SOLAR PV SYSTEM — SINGLE-LINE DIAGRAM', {
    size: F.title, weight: 'bold', fill: C.text,
  }));
  parts.push(text(cx, DRAW_Y + 52, `${input.projectName || 'Project'} · ${input.address || 'Address'}`, {
    size: F.body, fill: C.textLight,
  }));
  parts.push(line(DRAW_X + 40, DRAW_Y + 60, DRAW_X + DRAW_W - 40, DRAW_Y + 60,
    { stroke: C.border, strokeW: 1.5 }));

  // ── PV Arrays ───────────────────────────────────────────────────────────────
  const inverters = calc?.inverters ?? [];
  const totalStrings = inverters.reduce((s, inv) => s + inv.strings.length, 0);
  const arraySpacing = Math.min(220, DRAW_W / Math.max(totalStrings, 1));
  const arrayStartX = cx - (totalStrings - 1) * arraySpacing / 2;

  let stringIdx = 0;
  const arrayPositions: { x: number; y: number; stringId: string }[] = [];

  inverters.forEach((inv, invIdx) => {
    inv.strings.forEach((str, strIdx) => {
      const ax = arrayStartX + stringIdx * arraySpacing;
      const panelSpec = input.panelSpecs?.[0];
      const label = `ARRAY ${inv.inverterId}-${str.stringId}`;
      const sublabel = `${str.panelCount}× ${panelSpec?.watts ?? 400}W`;
      parts.push(symPVArray(ax, yPV, 110, 70, label, sublabel));

      // DC wire specs box
      const dcCallout = str.dcWireResult?.conductorCallout ?? `2#10 AWG USE-2 in ${input.conduitType}`;
      parts.push(conductorCalloutLabel(ax, yDCWire1, dcCallout, str.dcWireResult?.voltageDrop ?? 0, C.dc));

      // Vertical DC line from array to callout
      parts.push(line(ax, yPV + 35, ax, yDCWire1 - 10, { stroke: C.dc, strokeW: 2 }));
      parts.push(arrowDown(ax, yDCWire1 - 10, C.dc));

      // OCPD label
      parts.push(text(ax, yDCWire1 + 36, `OCPD: ${str.ocpdRating}A (NEC 690.8)`, {
        size: F.tiny, fill: C.dc, weight: 'bold',
      }));

      arrayPositions.push({ x: ax, y: yDCWire1 + 50, stringId: `${inv.inverterId}-${str.stringId}` });
      stringIdx++;
    });
  });

  // ── Convergence line to DC disconnect ───────────────────────────────────────
  if (arrayPositions.length > 1) {
    const leftX = arrayPositions[0].x;
    const rightX = arrayPositions[arrayPositions.length - 1].x;
    const convY = yDCDisc - 40;
    parts.push(line(leftX, convY, rightX, convY, { stroke: C.dc, strokeW: 2 }));
    arrayPositions.forEach(ap => {
      parts.push(line(ap.x, ap.y, ap.x, convY, { stroke: C.dc, strokeW: 2 }));
    });
    parts.push(line(cx, convY, cx, yDCDisc - 18, { stroke: C.dc, strokeW: 2 }));
    parts.push(arrowDown(cx, yDCDisc - 18, C.dc));
  } else if (arrayPositions.length === 1) {
    parts.push(line(arrayPositions[0].x, arrayPositions[0].y, cx, yDCDisc - 18, { stroke: C.dc, strokeW: 2 }));
    parts.push(arrowDown(cx, yDCDisc - 18, C.dc));
  }

  // ── DC Disconnect ────────────────────────────────────────────────────────────
  if (input.dcDisconnect) {
    parts.push(symDisconnect(cx, yDCDisc, 'DC DISCONNECT\nNEC 690.15', C.dc));
    parts.push(line(cx, yDCDisc + 18, cx, yRSD - 20, { stroke: C.dc, strokeW: 2 }));
    parts.push(arrowDown(cx, yRSD - 20, C.dc));
  } else {
    parts.push(line(cx, yDCDisc - 18, cx, yRSD - 20, { stroke: C.dc, strokeW: 2 }));
  }

  // ── Rapid Shutdown ───────────────────────────────────────────────────────────
  if (input.rapidShutdown) {
    parts.push(symRapidShutdown(cx, yRSD));
    parts.push(line(cx, yRSD + 20, cx, yDCWire2, { stroke: C.dc, strokeW: 2 }));
    parts.push(arrowDown(cx, yDCWire2, C.dc));
  } else {
    parts.push(line(cx, yRSD - 20, cx, yDCWire2, { stroke: C.dc, strokeW: 2 }));
  }

  // ── Inverter(s) ──────────────────────────────────────────────────────────────
  const invSpacing = Math.min(200, DRAW_W / Math.max(inverters.length, 1));
  const invStartX = cx - (inverters.length - 1) * invSpacing / 2;

  inverters.forEach((inv, invIdx) => {
    const invX = invStartX + invIdx * invSpacing;
    const invSpec = input.inverterSpecs?.[invIdx] ?? input.inverterSpecs?.[0];
    const mfr = invSpec?.manufacturer ?? 'Inverter';
    const mdl = invSpec?.model ?? '';
    const kw = inv.acOutputKw.toFixed(1);
    parts.push(symInverter(invX, yInverter, 120, 80, `${mfr} ${mdl}`, `${kw} kW AC`));

    // DC line to inverter
    if (inverters.length === 1) {
      parts.push(line(cx, yDCWire2, invX, yInverter - 40, { stroke: C.dc, strokeW: 2 }));
    } else {
      const splitY = yDCWire2 + 30;
      parts.push(line(cx, yDCWire2, cx, splitY, { stroke: C.dc, strokeW: 2 }));
      parts.push(line(invStartX, splitY, invStartX + (inverters.length - 1) * invSpacing, splitY, { stroke: C.dc, strokeW: 2 }));
      parts.push(line(invX, splitY, invX, yInverter - 40, { stroke: C.dc, strokeW: 2 }));
    }
    parts.push(arrowDown(invX, yInverter - 40, C.dc));

    // AC wire callout
    const acCallout = inv.acWireResult?.conductorCallout ?? calc?.acConductorCallout ?? '';
    parts.push(conductorCalloutLabel(invX, yACWire1, acCallout, inv.acWireResult?.voltageDrop ?? 0, C.ac));
    parts.push(line(invX, yInverter + 40, invX, yACWire1 - 10, { stroke: C.ac, strokeW: 2 }));
    parts.push(arrowDown(invX, yACWire1 - 10, C.ac));
  });

  // ── Convergence to AC disconnect ─────────────────────────────────────────────
  if (inverters.length > 1) {
    const leftX = invStartX;
    const rightX = invStartX + (inverters.length - 1) * invSpacing;
    const convY = yACDisc - 40;
    parts.push(line(leftX, convY, rightX, convY, { stroke: C.ac, strokeW: 2 }));
    inverters.forEach((_, i) => {
      const ix = invStartX + i * invSpacing;
      parts.push(line(ix, yACWire1 + 30, ix, convY, { stroke: C.ac, strokeW: 2 }));
    });
    parts.push(line(cx, convY, cx, yACDisc - 18, { stroke: C.ac, strokeW: 2 }));
  } else {
    parts.push(line(invStartX, yACWire1 + 30, cx, yACDisc - 18, { stroke: C.ac, strokeW: 2 }));
  }
  parts.push(arrowDown(cx, yACDisc - 18, C.ac));

  // ── AC Disconnect ─────────────────────────────────────────────────────────────
  if (input.acDisconnect) {
    parts.push(symDisconnect(cx, yACDisc, 'AC DISCONNECT\nNEC 690.14', C.ac));
    parts.push(line(cx, yACDisc + 18, cx, yACWire2, { stroke: C.ac, strokeW: 2 }));
  } else {
    parts.push(line(cx, yACDisc - 18, cx, yACWire2, { stroke: C.ac, strokeW: 2 }));
  }

  // ── Production Meter ──────────────────────────────────────────────────────────
  if (input.productionMeter) {
    parts.push(arrowDown(cx, yProdMtr - 22, C.ac));
    parts.push(symProductionMeter(cx, yProdMtr));
    parts.push(line(cx, yACWire2, cx, yProdMtr - 22, { stroke: C.ac, strokeW: 2 }));
    parts.push(line(cx, yProdMtr + 22, cx, yACWire3, { stroke: C.ac, strokeW: 2 }));
  } else {
    parts.push(line(cx, yACWire2, cx, yACWire3, { stroke: C.ac, strokeW: 2 }));
  }

  // ── Battery Storage (if present) ─────────────────────────────────────────────
  if (input.batteryBrand && (input.batteryCount ?? 0) > 0) {
    const batX = cx + 220;
    const totalKwh = (input.batteryCount ?? 0) * (input.batteryKwh ?? 0);
    parts.push(symBattery(batX, yMSP - 80, input.batteryBrand, totalKwh, input.batteryBackfeedA));
    // Dashed AC line from battery to MSP bus
    parts.push(line(batX - 45, yMSP - 80, cx + 80, yMSP - 80, { stroke: C.ac, strokeW: 2, dash: '8,4' }));
    parts.push(line(cx + 80, yMSP - 80, cx + 80, yMSP, { stroke: C.ac, strokeW: 2, dash: '8,4' }));
    // Battery backfeed breaker label
    if (input.batteryBackfeedA && input.batteryBackfeedA > 0) {
      parts.push(symBreaker(batX - 80, yMSP - 80, input.batteryBackfeedA, 'BATT\\nBREAKER', '#6A1B9A'));
    }
  }

  // ── Generator + ATS (if present) ──────────────────────────────────────────────────────────────
  if (input.generatorBrand && input.generatorKw) {
    const genX = cx - 240;
    const genY = yMSP + 60;
    const atsY = yMSP + 20;

    // Generator symbol
    parts.push(symGenerator(genX, genY, input.generatorBrand, input.generatorKw));

    // ATS symbol (between generator and MSP)
    if (input.atsBrand && input.atsAmpRating) {
      parts.push(symATS(genX, atsY - 60, input.atsBrand, input.atsAmpRating, true));
      // Wire: generator → ATS
      parts.push(line(genX, genY - 28, genX, atsY - 60 + 26, { stroke: '#2E7D32', strokeW: 2 }));
      // Wire: ATS → MSP
      parts.push(line(genX + 50, atsY - 60, cx - 80, yMSP, { stroke: '#E65100', strokeW: 2, dash: '6,3' }));
      parts.push(text(genX + 10, atsY - 90, 'STANDBY POWER', { size: F.tiny, weight: 'bold', fill: '#E65100' }));
      parts.push(text(genX + 10, atsY - 76, 'NEC 702.5 · Transfer Switch', { size: F.tiny, fill: C.textLight }));
    } else {
      // No ATS — direct generator connection note
      parts.push(line(genX, genY - 28, cx - 80, yMSP, { stroke: '#2E7D32', strokeW: 2, dash: '6,3' }));
    }
  }

  // ── Main Service Panel ────────────────────────────────────────────────────────
  parts.push(arrowDown(cx, yMSP - 50, C.ac));
  parts.push(line(cx, yACWire3, cx, yMSP - 50, { stroke: C.ac, strokeW: 2 }));
  parts.push(symMSP(cx, yMSP, 160, 120,
    input.mainPanelBrand,
    input.mainPanelAmps,
    calc?.busbar?.backfeedBreakerRequired ?? 0
  ));

  // Backfeed breaker label
  const bfAmps = calc?.busbar?.backfeedBreakerRequired ?? 0;
  parts.push(symBreaker(cx + 100, yMSP, bfAmps, 'BACKFEED\nBREAKER', C.ac));
  parts.push(line(cx + 60, yMSP, cx + 82, yMSP, { stroke: C.ac, strokeW: 1.5 }));

  // ── Utility Meter ─────────────────────────────────────────────────────────────
  parts.push(line(cx, yMSP + 60, cx, yUtilMtr - 28, { stroke: C.ac, strokeW: 2 }));
  parts.push(arrowDown(cx, yUtilMtr - 28, C.ac));
  parts.push(symUtilityMeter(cx, yUtilMtr, input.utilityMeter ?? 'Bidirectional Net Meter'));

  // ── Utility Grid ──────────────────────────────────────────────────────────────
  parts.push(line(cx, yUtilMtr + 28, cx, yGrid - 20, { stroke: C.ac, strokeW: 2 }));
  parts.push(arrowDown(cx, yGrid - 20, C.ac));
  const gridW = 140; const gridH = 50;
  parts.push(rect(cx - gridW / 2, yGrid - gridH / 2, gridW, gridH,
    { fill: '#F0F4FF', stroke: C.ac, strokeW: 2, rx: 4 }));
  parts.push(text(cx, yGrid - 6, 'UTILITY GRID', { size: F.label, weight: 'bold', fill: C.ac }));
  parts.push(text(cx, yGrid + 10, '120/240V · 60Hz', { size: F.small, fill: C.textLight }));

  // ── Grounding System ──────────────────────────────────────────────────────────
  const egcGauge = calc?.groundingConductor ?? '#10 AWG';
  const gndX = cx - 280;
  parts.push(line(gndX, yMSP, gndX, yGND, { stroke: C.gnd, strokeW: 2, dash: '6,3' }));
  parts.push(line(cx - 80, yMSP, gndX, yMSP, { stroke: C.gnd, strokeW: 2, dash: '6,3' }));
  parts.push(symGrounding(gndX, yGND, egcGauge));
  parts.push(text(gndX, yGND - 30, 'GROUNDING ELECTRODE SYSTEM', { size: F.small, weight: 'bold', fill: C.gnd }));
  parts.push(text(gndX, yGND - 14, `EGC: ${egcGauge} (NEC 250.122)`, { size: F.tiny, fill: C.gnd }));
  parts.push(text(gndX, yGND - 2, 'Ground Rod: 5/8" × 8\' (min. 2 required)', { size: F.tiny, fill: C.gnd }));

  // EGC path from inverter to MSP
  const egcX = cx + 280;
  parts.push(line(egcX, yInverter, egcX, yMSP, { stroke: C.gnd, strokeW: 1.5, dash: '6,3' }));
  parts.push(text(egcX + 8, (yInverter + yMSP) / 2, `EGC: ${egcGauge}`, { size: F.tiny, fill: C.gnd, anchor: 'start' }));
  parts.push(text(egcX + 8, (yInverter + yMSP) / 2 + 14, '(NEC 250.122)', { size: F.tiny, fill: C.gnd, anchor: 'start' }));

  // Bonding jumper
  parts.push(line(cx + 80, yMSP, egcX, yMSP, { stroke: C.bond, strokeW: 1.5, dash: '4,4' }));
  parts.push(text((cx + 80 + egcX) / 2, yMSP - 8, 'BONDING JUMPER (NEC 250.28)', { size: F.tiny, fill: C.bond }));

  // ── Legend ────────────────────────────────────────────────────────────────────
  const legX = DRAW_X + DRAW_W - 200;
  const legY = DRAW_Y + 80;
  const legendItems = [
    { color: C.dc,      dash: '',    label: 'DC Conductor' },
    { color: C.ac,      dash: '',    label: 'AC Conductor' },
    { color: C.gnd,     dash: '6,3', label: 'Grounding Conductor' },
    { color: C.bond,    dash: '4,4', label: 'Bonding Conductor' },
    { color: '#6A1B9A', dash: '8,4', label: 'Battery AC Connection' },
    { color: '#2E7D32', dash: '',    label: 'Generator Output' },
    { color: '#E65100', dash: '6,3', label: 'ATS Transfer Path' },
  ];
  // Expand legend box height to fit all items
  const legH = 38 + legendItems.length * 22 + 10;
  parts.push(rect(legX, legY, 180, legH, { fill: '#FAFAFA', stroke: C.border, strokeW: 1, rx: 3 }));
  parts.push(text(legX + 90, legY + 16, 'LEGEND', { size: F.label, weight: 'bold' }));
  parts.push(line(legX, legY + 22, legX + 180, legY + 22, { stroke: '#CCC', strokeW: 1 }));
  legendItems.forEach((item, i) => {
    const ly = legY + 38 + i * 22;
    parts.push(line(legX + 12, ly, legX + 44, ly, { stroke: item.color, strokeW: 2, dash: item.dash }));
    parts.push(text(legX + 52, ly + 4, item.label, { size: F.small, fill: C.text, anchor: 'start' }));
  });

  // ── Auto-Resolution Log (if any) ──────────────────────────────────────────────
  const resolutions = calc?.autoResolutions ?? [];
  if (resolutions.length > 0) {
    const logX = DRAW_X + 20;
    const logY = DRAW_Y + 80;
    const logW = 260;
    parts.push(rect(logX, logY, logW, 24 + resolutions.length * 22, {
      fill: '#FFFDE7', stroke: '#F9A825', strokeW: 1, rx: 3,
    }));
    parts.push(text(logX + logW / 2, logY + 16, `AUTO-RESOLVED: ${resolutions.length} CORRECTION(S)`, {
      size: F.small, weight: 'bold', fill: '#E65100',
    }));
    resolutions.slice(0, 6).forEach((r, i) => {
      parts.push(text(logX + 8, logY + 36 + i * 22,
        `• ${r.field}: ${r.originalValue} → ${r.resolvedValue}`,
        { size: F.tiny, fill: '#5D4037', anchor: 'start' }));
    });
  }

  // ── Title Block ───────────────────────────────────────────────────────────────
  const tbInput = {
    ...input,
    necVersion: input.necVersion,
    systemSizeDC: `${(inverters.reduce((s, inv) => s + inv.strings.reduce((ss, str) => ss + str.panelCount * (input.panelSpecs?.[0]?.watts ?? 400), 0), 0) / 1000).toFixed(2)} kW DC`,
    systemSizeAC: `${inverters.reduce((s, inv) => s + inv.acOutputKw, 0).toFixed(2)} kW AC`,
    sheetNumber: 'E-1',
    totalSheets: '1',
    revision: '0',
    revisionDate: input.date,
    preparedBy: input.designer,
    preparedDate: input.date,
    drawingNumber: 'SLD-001',
    scale: 'NTS',
  };
  parts.push(renderTitleBlock(tbInput as any));

  // ── Notes Block ───────────────────────────────────────────────────────────────
  parts.push(renderNotesBlock(input));

  // ── Assemble SVG ──────────────────────────────────────────────────────────────
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${SHEET_W}" height="${SHEET_H}"
     viewBox="0 0 ${SHEET_W} ${SHEET_H}"
     style="background:white">
  <defs>
    <style>
      text { font-family: Arial, Helvetica, sans-serif; }
    </style>
  </defs>
  ${parts.join('\n  ')}
</svg>`;
}

// ─── Build SLD Document from engineering calc output ─────────────────────────

export function buildSLDDocument(input: SLDBuildInput): SLDDocument {
  const calc = input.calcResult;
  const inv0 = calc?.inverters?.[0];
  const totalDcKw = calc?.inverters?.reduce((s, inv) =>
    s + inv.strings.reduce((ss, str) => ss + str.panelCount * (input.panelSpecs?.[0]?.watts ?? 400) / 1000, 0), 0) ?? 0;
  const totalAcKw = calc?.inverters?.reduce((s, inv) => s + inv.acOutputKw, 0) ?? 0;
  const totalPanels = calc?.inverters?.reduce((s, inv) => s + inv.strings.reduce((ss, str) => ss + str.panelCount, 0), 0) ?? 0;

  return {
    version: '3.0',
    generatedAt: new Date().toISOString(),
    titleBlock: {
      projectName: input.projectName,
      clientName: input.clientName,
      address: input.address,
      city: '',
      state: '',
      zip: '',
      necVersion: input.necVersion,
      systemSizeDC: `${totalDcKw.toFixed(2)} kW DC`,
      systemSizeAC: `${totalAcKw.toFixed(2)} kW AC`,
      sheetNumber: 'E-1',
      totalSheets: '1',
      revision: '0',
      revisionDate: input.date,
      preparedBy: input.designer,
      preparedDate: input.date,
      scale: 'NTS',
      drawingNumber: 'SLD-001',
    },
    nodes: [],
    connections: [],
    groundingSystem: {
      egcGauge: calc?.groundingConductor ?? '#10 AWG',
      egcPath: ['inverter', 'msp', 'ges'],
      groundingElectrodeSystem: "Ground Rod: 5/8&quot; × 8' (min. 2 required per NEC 250.53)",
      bondingJumperGauge: calc?.groundingConductor ?? '#10 AWG',
      systemGroundingConductor: calc?.groundingConductor ?? '#10 AWG',
      necReference: 'NEC 250.50 / 250.53 / 250.122',
    },
    notes: [
      { number: 1, text: `All work shall comply with ${input.necVersion}, local codes, and AHJ requirements.`, necReference: input.necVersion },
      { number: 2, text: 'All conductors shall be copper unless otherwise noted.', necReference: 'NEC 310.14' },
      { number: 3, text: 'All equipment shall be listed and labeled per NEC 110.3(B).', necReference: 'NEC 110.3(B)' },
      { number: 4, text: 'Rapid shutdown system required for rooftop PV systems.', necReference: 'NEC 690.12' },
      { number: 5, text: 'Grounding electrode system per NEC 250.50. Bond all metallic equipment.', necReference: 'NEC 250.50' },
    ],
    revisions: [
      { rev: '0', date: input.date, description: 'Initial Issue', by: input.designer },
    ],
    summary: {
      totalDcKw,
      totalAcKw,
      dcAcRatio: totalAcKw > 0 ? totalDcKw / totalAcKw : 0,
      totalPanels,
      totalInverters: calc?.inverters?.length ?? 0,
      systemVoltage: input.systemVoltage,
      necVersion: input.necVersion,
      hasBattery: !!(input.batteryBrand && (input.batteryCount ?? 0) > 0),
      hasRapidShutdown: input.rapidShutdown,
      hasProductionMeter: input.productionMeter,
    },
  };
}