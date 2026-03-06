// ============================================================
// Professional SLD Renderer V14 — IEEE/ANSI Engineering Standard
// ANSI C Landscape (24"×18") = 2304×1728px at 96 DPI
//
// VISUAL STANDARD: Clean white background, thin black lines,
// IEEE 315 standard symbols. No filled gray boxes.
// Wire labels inline on conductors. Straight H/V routing only.
//
// TOPOLOGY ORDER (DO NOT DEVIATE):
//   MICRO:  PV Array → J-Box → AC Combiner → AC Disco → MSP → Meter → Grid
//   STRING: PV Array → J-Box → DC Disco → Inverter → AC Disco → MSP → Meter → Grid
//
// INTERNAL STRUCTURE:
//   AC Combiner:  branch breakers → combiner bus → feeder lug
//   AC Disconnect: line terminals → knife switch → load terminals
//   MSP (load-side):  main breaker → main bus → PV breaker → load lug
//   MSP (supply-side): service tap → main bus → main breaker
// ============================================================

import type { RunSegment, MicroBranch } from './computed-system';
import type { ConductorBundle } from './segment-schedule';

// ── Canvas ──────────────────────────────────────────────────────────────────
const W = 2304;
const H = 1728;
const MAR = 40;

// Title block (right side, standard engineering format)
const TB_W = 260;
const TB_X = W - TB_W - MAR;

// Drawing area
const DX = MAR;
const DY = MAR;
const DW = TB_X - MAR - 10;
const DH = H - MAR * 2;

// Schematic area — upper 50% of drawing height
const SCH_X = DX;
const SCH_Y = DY + 30;
const SCH_W = DW;
const SCH_H = Math.round(DH * 0.50);

// Main horizontal bus line Y
const BUS_Y = SCH_Y + Math.round(SCH_H * 0.46);

// Ground rail
const GND_Y = BUS_Y + 100;

// Bottom panels
const CALC_Y  = SCH_Y + SCH_H + 8;
const CALC_H  = 180;
const SCHED_Y = CALC_Y + CALC_H + 8;
const SCHED_H = H - MAR - SCHED_Y;

// ── Colors ──────────────────────────────────────────────────────────────────
const BLK  = '#000000';
const WHT  = '#FFFFFF';
const GRN  = '#005500';
const LGY  = '#F5F5F5';
const PASS = '#004400';
const FAIL = '#AA0000';
const LOAD_CLR   = '#1B5E20';
const SUPPLY_CLR = '#0D47A1';

// ── Stroke widths ────────────────────────────────────────────────────────────
const SW_BORDER = 2.5;
const SW_HEAVY  = 2.0;
const SW_MED    = 1.5;
const SW_THIN   = 1.0;
const SW_HAIR   = 0.5;
const SW_BUS    = 3.5;

// ── Font sizes ───────────────────────────────────────────────────────────────
const F = {
  title:  12,
  hdr:     8.5,
  label:   7.5,
  sub:     7,
  seg:     6.5,
  tiny:    6.5,
  tb:      7,
  tbTitle: 10,
};

// ── Public Interface ─────────────────────────────────────────────────────────
export interface SLDProfessionalInput {
  projectName:             string;
  clientName:              string;
  address:                 string;
  designer:                string;
  drawingDate:             string;
  drawingNumber:           string;
  revision:                string;
  topologyType:            string;
  totalModules:            number;
  totalStrings:            number;
  panelModel:              string;
  panelWatts:              number;
  panelVoc:                number;
  panelIsc:                number;
  dcWireGauge:             string;
  dcConduitType:           string;
  dcOCPD:                  number;
  inverterModel:           string;
  inverterManufacturer:    string;
  acOutputKw:              number;
  acOutputAmps:            number;
  acWireGauge:             string;
  acConduitType:           string;
  acOCPD:                  number;
  mainPanelAmps:           number;
  backfeedAmps:            number;
  utilityName:             string;
  interconnection:         string;
  rapidShutdownIntegrated: boolean;
  hasProductionMeter:      boolean;
  hasBattery:              boolean;
  batteryModel:            string;
  batteryKwh:              number;
  batteryBackfeedA?:       number;
  generatorBrand?:         string;
  generatorModel?:         string;
  generatorKw?:            number;
  atsBrand?:               string;
  atsModel?:               string;
  atsAmpRating?:           number;
  hasBackupPanel?:         boolean;
  backupPanelAmps?:        number;
  backupPanelBrand?:       string;
  scale:                   string;
  acWireLength:            number;
  panelsPerString?:        number;
  lastStringPanels?:       number;
  designTempMin?:          number;
  vocCorrected?:           number;
  vmpCorrected?:           number;
  stringVoc?:              number;
  stringVmp?:              number;
  stringIsc?:              number;
  maxPanelsPerString?:     number;
  minPanelsPerString?:     number;
  mpptChannels?:           number;
  mpptAllocation?:         string;
  combinerType?:           string;
  combinerLabel?:          string;
  ocpdPerString?:          number;
  dcAcRatio?:              number;
  stringConfigWarnings?:   string[];
  deviceCount?:            number;
  microBranches?:          MicroBranch[];
  branchWireGauge?:        string;
  branchConduitSize?:      string;
  branchOcpdAmps?:         number;
  stringDetails?:          { stringIndex: number; panelCount: number; ocpdAmps: number; wireGauge: string; voc: number; isc: number }[];
  runs?:                   RunSegment[];
}

// ── SVG Primitives ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function txt(x: number, y: number, s: string,
  o: { sz?: number; bold?: boolean; anc?: 'start'|'middle'|'end'; fill?: string; italic?: boolean } = {}
): string {
  const sz  = o.sz   ?? F.label;
  const bld = o.bold ? 'font-weight="bold"' : '';
  const anc = `text-anchor="${o.anc ?? 'start'}"`;
  const clr = `fill="${o.fill ?? BLK}"`;
  const itl = o.italic ? 'font-style="italic"' : '';
  return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} ${itl} dominant-baseline="auto">${esc(s)}</text>`;
}

function tspan(x: number, y: number, lines: string[],
  o: { sz?: number; bold?: boolean; anc?: 'start'|'middle'|'end'; fill?: string; lh?: number } = {}
): string {
  if (!lines.length) return '';
  const sz  = o.sz ?? F.seg;
  const bld = o.bold ? 'font-weight="bold"' : '';
  const anc = `text-anchor="${o.anc ?? 'middle'}"`;
  const clr = `fill="${o.fill ?? BLK}"`;
  const lh  = o.lh ?? Math.round(sz * 1.4);
  const spans = lines.map((l,i) => `<tspan x="${x}" dy="${i===0?0:lh}">${esc(l)}</tspan>`).join('');
  return `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} dominant-baseline="auto">${spans}</text>`;
}

function rect(x: number, y: number, w: number, h: number,
  o: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string } = {}
): string {
  const f  = o.fill   ?? WHT;
  const s  = o.stroke ?? BLK;
  const sw = o.sw     ?? SW_THIN;
  const rx = o.rx     ? `rx="${o.rx}"` : '';
  const da = o.dash   ? `stroke-dasharray="${o.dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="${sw}" ${rx} ${da}/>`;
}

function ln(x1: number, y1: number, x2: number, y2: number,
  o: { stroke?: string; sw?: number; dash?: string } = {}
): string {
  const s  = o.stroke ?? BLK;
  const sw = o.sw     ?? SW_MED;
  const da = o.dash   ? `stroke-dasharray="${o.dash}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
}

function circ(cx: number, cy: number, r: number,
  o: { fill?: string; stroke?: string; sw?: number } = {}
): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill??WHT}" stroke="${o.stroke??BLK}" stroke-width="${o.sw??SW_THIN}"/>`;
}

// IEEE 315 ground symbol
function gnd(x: number, y: number, color = GRN): string {
  return [
    ln(x, y, x, y+8, {stroke:color, sw:SW_MED}),
    ln(x-9, y+8, x+9, y+8, {stroke:color, sw:SW_MED}),
    ln(x-6, y+12, x+6, y+12, {stroke:color, sw:SW_MED}),
    ln(x-3, y+16, x+3, y+16, {stroke:color, sw:SW_MED}),
  ].join('');
}

// Numbered callout circle
function callout(cx: number, cy: number, n: number): string {
  return circ(cx, cy, 10, {fill:WHT, stroke:BLK, sw:SW_MED})
    + txt(cx, cy+1, String(n), {sz:F.hdr, bold:true, anc:'middle'});
}

// ── IEEE Standard Equipment Symbols ─────────────────────────────────────────

// PV Module symbol: rectangle with diagonal line (IEEE/IEC standard)
function pvModuleSymbol(cx: number, cy: number, w = 28, h = 20): string {
  return [
    rect(cx-w/2, cy-h/2, w, h, {fill:WHT, sw:SW_MED}),
    ln(cx-w/2, cy+h/2, cx+w/2, cy-h/2, {sw:SW_THIN}), // diagonal
  ].join('');
}

// Inverter symbol: circle with ~ (sine wave) — IEEE standard
function inverterSymbol(cx: number, cy: number, r = 22): string {
  const path = `M${cx-8},${cy} Q${cx-4},${cy-8} ${cx},${cy} Q${cx+4},${cy+8} ${cx+8},${cy}`;
  return [
    circ(cx, cy, r, {fill:WHT, sw:SW_MED}),
    `<path d="${path}" fill="none" stroke="${BLK}" stroke-width="${SW_MED}"/>`,
  ].join('');
}

// Meter symbol: circle with M
function meterSymbol(cx: number, cy: number, r = 22): string {
  return [
    circ(cx, cy, r, {fill:WHT, sw:SW_MED}),
    txt(cx, cy+3, 'M', {sz:14, bold:true, anc:'middle'}),
  ].join('');
}

// Knife-blade disconnect switch (IEEE 315)
function knifeSwitch(cx: number, cy: number, w = 40): string {
  const lx = cx - w/2, rx = cx + w/2;
  return [
    ln(lx, cy, lx+10, cy, {sw:SW_MED}),           // left stub
    circ(lx+10, cy, 3, {fill:BLK, sw:0}),          // left pivot
    ln(lx+10, cy, rx-10, cy-10, {sw:SW_MED}),      // blade (open position)
    circ(rx-10, cy, 3, {fill:WHT, sw:SW_MED}),     // right socket
    ln(rx-10, cy, rx, cy, {sw:SW_MED}),            // right stub
  ].join('');
}

// Fuse symbol (IEEE 315): rectangle with lines
function fuseSymbol(cx: number, cy: number, w = 16, h = 8): string {
  return [
    ln(cx-w/2-6, cy, cx-w/2, cy, {sw:SW_MED}),
    rect(cx-w/2, cy-h/2, w, h, {fill:WHT, sw:SW_MED}),
    ln(cx+w/2, cy, cx+w/2+6, cy, {sw:SW_MED}),
  ].join('');
}

// Circuit breaker symbol (IEEE 315): rectangle with arc
function breakerSymbol(cx: number, cy: number, w = 18, h = 12, amps?: number): string {
  const parts: string[] = [
    rect(cx-w/2, cy-h/2, w, h, {fill:WHT, sw:SW_THIN}),
    `<path d="M${cx-5},${cy+3} Q${cx},${cy-5} ${cx+5},${cy+3}" fill="none" stroke="${BLK}" stroke-width="${SW_HAIR}"/>`,
  ];
  if (amps) parts.push(txt(cx, cy-h/2-2, `${amps}A`, {sz:5.5, anc:'middle', bold:true}));
  return parts.join('');
}

// Terminal lug dot
function lug(cx: number, cy: number): string {
  return circ(cx, cy, 3, {fill:WHT, sw:SW_MED})
    + circ(cx, cy, 1, {fill:BLK, sw:0});
}

// Busbar (heavy horizontal line with label)
function busbar(x1: number, x2: number, y: number, label?: string): string {
  const parts = [ln(x1, y, x2, y, {stroke:BLK, sw:SW_BUS})];
  if (label) parts.push(txt((x1+x2)/2, y-5, label, {sz:5.5, anc:'middle', bold:true}));
  return parts.join('');
}

// Battery Storage Symbol (IEEE/ANSI)
// Drawn as a stack of cells (IEC 60617 battery symbol) with AC connection
function renderBattery(
  cx: number, cy: number,
  model: string, kwh: number, backfeedA: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 88, H2 = 72;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];
  const BAT_CLR = '#1565C0';

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BAT_CLR, sw: SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {stroke: BAT_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2+10, 'BATTERY STORAGE', {sz: 5.5, bold: true, anc: 'middle', fill: BAT_CLR}));

  // Battery cell stack symbol (IEC 60617)
  const cellX = cx - 14;
  const cellY = cy - 4;
  for (let i = 0; i < 3; i++) {
    const lx2 = cellX + i * 7;
    p.push(ln(lx2, cellY - 10, lx2, cellY + 10, {stroke: BAT_CLR, sw: 2.5}));
    if (i < 2) {
      p.push(ln(lx2 + 3, cellY - 6, lx2 + 3, cellY + 6, {stroke: BAT_CLR, sw: 1.5}));
    }
  }
  p.push(txt(cellX - 8, cellY + 4, '\u2212', {sz: 9, bold: true, anc: 'middle', fill: BAT_CLR}));
  p.push(txt(cellX + 22, cellY + 4, '+', {sz: 9, bold: true, anc: 'middle', fill: BAT_CLR}));

  p.push(lug(cx, by2 + H2 - 6));
  p.push(ln(cx, by2 + H2 - 6, cx, by2 + H2, {stroke: BAT_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, model ? model.substring(0, 22) : 'BATTERY STORAGE', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, kwh > 0 ? `${kwh} kWh` : '', {sz: F.tiny, anc: 'middle', bold: true, fill: BAT_CLR}));
  if (backfeedA > 0) {
    p.push(txt(cx, by2 + H2 + 28, `${backfeedA}A BACKFEED \u2014 NEC 705.12(B)`, {sz: F.tiny, anc: 'middle', fill: BAT_CLR}));
  }
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));
  return {svg: p.join(''), lx: bx, rx: bx + W2, ty: by2, by: by2 + H2};
}

// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const GEN_CLR = '#2E7D32';
  const r = 30;
  const p: string[] = [];

  p.push(circ(cx, cy, r, {fill: WHT, stroke: GEN_CLR, sw: SW_MED}));
  p.push(txt(cx, cy + 4, 'G', {sz: 16, bold: true, anc: 'middle', fill: GEN_CLR}));
  const swPath = `M${cx-8},${cy+12} Q${cx-4},${cy+8} ${cx},${cy+12} Q${cx+4},${cy+16} ${cx+8},${cy+12}`;
  p.push(`<path d="${swPath}" fill="none" stroke="${GEN_CLR}" stroke-width="${SW_THIN}"/>`);

  p.push(lug(cx + r, cy));
  p.push(ln(cx + r, cy, cx + r + 10, cy, {stroke: GEN_CLR, sw: SW_MED}));

  p.push(txt(cx, cy - r - 18, 'STANDBY GENERATOR', {sz: F.hdr, bold: true, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy - r - 8, `${brand} ${model}`.trim() || 'GENERATOR', {sz: F.sub, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 9, kw > 0 ? `${kw} kW / ${Math.round(kw*1000/240)}A` : '', {sz: F.tiny, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 18, 'NEC 702.5 \u2014 TRANSFER EQUIP. REQ.', {sz: F.tiny, anc: 'middle', italic: true, fill: GEN_CLR}));
  p.push(callout(cx + r + 14, cy - r - 5, calloutN));

  return {svg: p.join(''), lx: cx - r, rx: cx + r + 10, ty: cy - r, by: cy + r};
}

// ATS Symbol (Automatic Transfer Switch)
function renderATS(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 90, H2 = 68;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const ATS_CLR = '#E65100';
  const p: string[] = [];

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: ATS_CLR, sw: SW_MED}));
  p.push(ln(bx, by2 + 14, bx + W2, by2 + 14, {stroke: ATS_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2 + 10, 'AUTO TRANSFER SWITCH', {sz: 5.5, bold: true, anc: 'middle', fill: ATS_CLR}));

  const utilY = cy - 12;
  const genY  = cy + 12;

  p.push(lug(bx + 8, utilY));
  p.push(txt(bx + 8, utilY - 8, 'UTIL', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(bx, utilY, bx + 8, utilY, {stroke: ATS_CLR, sw: SW_MED}));

  p.push(lug(bx + 8, genY));
  p.push(txt(bx + 8, genY + 10, 'GEN', {sz: 4.5, anc: 'middle', fill: ATS_CLR}));
  p.push(ln(bx, genY, bx + 8, genY, {stroke: ATS_CLR, sw: SW_MED}));

  // Utility blade closed (horizontal)
  p.push(ln(bx + 11, utilY, bx + 38, utilY, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(circ(bx + 11, utilY, 2.5, {fill: ATS_CLR, stroke: ATS_CLR, sw: 0}));
  p.push(circ(bx + 38, utilY, 2.5, {fill: WHT, stroke: ATS_CLR, sw: SW_THIN}));

  // Gen blade open (angled)
  p.push(ln(bx + 11, genY, bx + 30, genY - 10, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(circ(bx + 11, genY, 2.5, {fill: ATS_CLR, stroke: ATS_CLR, sw: 0}));
  p.push(circ(bx + 38, genY, 2.5, {fill: WHT, stroke: ATS_CLR, sw: SW_THIN}));

  const busX = bx + 50;
  p.push(ln(busX, utilY, busX, genY, {stroke: ATS_CLR, sw: 2.5}));
  p.push(ln(bx + 38, utilY, busX, utilY, {stroke: ATS_CLR, sw: SW_THIN}));
  p.push(ln(bx + 38, genY, busX, genY, {stroke: ATS_CLR, sw: SW_THIN}));

  p.push(lug(bx + W2 - 8, cy));
  p.push(txt(bx + W2 - 8, cy - 8, 'LOAD', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(busX, cy, bx + W2 - 8, cy, {stroke: ATS_CLR, sw: SW_MED}));
  p.push(ln(bx + W2 - 8, cy, bx + W2, cy, {stroke: ATS_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, `${brand} ${model}`.trim() || 'ATS', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, ampRating > 0 ? `${ampRating}A RATED` : '', {sz: F.tiny, anc: 'middle', bold: true, fill: ATS_CLR}));
  p.push(txt(cx, by2 + H2 + 28, 'NEC 702.5 \u2014 AUTO TRANSFER', {sz: F.tiny, anc: 'middle', italic: true, fill: ATS_CLR}));
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));

  return {svg: p.join(''), lx: bx - 10, rx: bx + W2 + 10, ty: by2, by: by2 + H2};
}

// Backup Sub-Panel Symbol
function renderBackupPanel(
  cx: number, cy: number,
  brand: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  const W2 = 80, H2 = 72;
  const bx = cx - W2/2, by2 = cy - H2/2;
  const BP_CLR = '#6A1B9A';
  const p: string[] = [];

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BP_CLR, sw: SW_MED}));
  p.push(ln(bx, by2 + 14, bx + W2, by2 + 14, {stroke: BP_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2 + 10, 'BACKUP SUB-PANEL', {sz: 5.5, bold: true, anc: 'middle', fill: BP_CLR}));

  const mbY = by2 + 28;
  p.push(breakerSymbol(cx, mbY, 28, 12, ampRating));
  p.push(txt(cx, mbY - 5, `${ampRating}A MAIN`, {sz: 5, anc: 'middle', bold: true, fill: BP_CLR}));

  const busY2 = mbY + 18;
  p.push(busbar(bx + 8, bx + W2 - 8, busY2, 'CRIT. LOADS BUS'));
  p.push(ln(cx, mbY + 6, cx, busY2, {sw: SW_MED}));

  for (let i = 0; i < 3; i++) {
    const lx3 = bx + 12 + i * 22;
    p.push(ln(lx3, busY2, lx3, busY2 + 14, {sw: SW_THIN, stroke: BP_CLR}));
    p.push(breakerSymbol(lx3, busY2 + 20, 14, 10));
  }

  p.push(lug(bx, cy));
  p.push(ln(bx - 10, cy, bx, cy, {stroke: BP_CLR, sw: SW_MED}));

  p.push(txt(cx, by2 + H2 + 10, brand || 'BACKUP PANEL', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 19, 'CRITICAL LOADS ONLY', {sz: F.tiny, anc: 'middle', fill: BP_CLR}));
  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));

  return {svg: p.join(''), lx: bx - 10, rx: bx + W2, ty: by2, by: by2 + H2};
}

// ── Wire Segment with Inline Label ───────────────────────────────────────────
function wireSeg(
  x1: number, x2: number, y: number,
  lines: string[],
  opts: { openAir?: boolean; bundleCount?: number; above?: boolean } = {}
): string {
  const isOA  = opts.openAir ?? false;
  const color = isOA ? GRN : BLK;
  const dash  = isOA ? '10,5' : undefined;
  const sw    = SW_MED;
  const cnt   = Math.min(opts.bundleCount ?? 1, 6);
  const cx    = (x1+x2)/2;
  const above = opts.above ?? true;
  const parts: string[] = [];

  // Draw wire(s)
  if (cnt <= 1) {
    parts.push(ln(x1, y, x2, y, {stroke:color, sw, dash}));
  } else {
    const sp = 3;
    const span = (cnt-1)*sp;
    const sy = y - span/2;
    for (let i = 0; i < cnt; i++) {
      parts.push(ln(x1, sy+i*sp, x2, sy+i*sp, {stroke:color, sw:SW_THIN, dash}));
    }
    parts.push(ln(x1, sy, x1, sy+span, {stroke:color, sw:SW_HAIR}));
    parts.push(ln(x2, sy, x2, sy+span, {stroke:color, sw:SW_HAIR}));
  }

  // Inline label
  if (lines.length > 0) {
    const lh = Math.round(F.seg * 1.35);
    const th = lines.length * lh;
    const ty = above ? y - 7 - th + lh : y + 11;
    parts.push(tspan(cx, ty, lines, {sz:F.seg, anc:'middle', fill:color}));
  }

  return parts.join('');
}

// ── Extract label lines from RunSegment ──────────────────────────────────────
function runLines(run: RunSegment|undefined, fallback: string[]): {lines:string[]; cnt:number; oa:boolean} {
  if (!run) return {lines:fallback, cnt:1, oa:false};
  const oa = run.isOpenAir ?? false;
  let lines: string[] = [];
  let cnt = 1;

  if (run.conductorBundle && run.conductorBundle.length > 0) {
    const hot = run.conductorBundle.filter((c:ConductorBundle) => c.isCurrentCarrying);
    const egc = run.conductorBundle.filter((c:ConductorBundle) => !c.isCurrentCarrying);
    cnt = Math.min(run.conductorBundle.reduce((s:number,c:ConductorBundle)=>s+c.qty,0), 6);
    const hotStr = hot.map((c:ConductorBundle) => {
      const g = c.gauge.replace('#','').replace(' AWG','');
      return `${c.qty}×#${g} ${c.insulation} ${c.color}`;
    }).join(' + ');
    const egcStr = egc.map((c:ConductorBundle) => {
      const g = c.gauge.replace('#','').replace(' AWG','');
      return `${c.qty}×#${g} GRN EGC`;
    }).join(' + ');
    const condStr = oa ? 'OPEN AIR — NEC 690.31'
      : `IN ${run.conduitSize} ${run.conduitType}${run.conduitFillPct>0?` (${run.conduitFillPct.toFixed(0)}% fill)`:''}`;
    if (hotStr) lines.push(hotStr);
    if (egcStr) lines.push(egcStr);
    lines.push(condStr);
  } else if (run.conductorCallout) {
    lines = run.conductorCallout.split('\n').filter(l=>l.trim());
    cnt = run.conductorCount ?? 1;
  } else {
    const g  = run.wireGauge.replace('#','').replace(' AWG','');
    const eg = run.egcGauge.replace('#','').replace(' AWG','');
    cnt = run.conductorCount ?? 1;
    lines.push(`${run.conductorCount}×#${g} ${run.insulation}`);
    lines.push(`1×#${eg} GRN EGC`);
    lines.push(oa ? 'OPEN AIR — NEC 690.31' : `IN ${run.conduitSize} ${run.conduitType}`);
  }
  return {lines, cnt, oa};
}

// ── AC Combiner Panel (internal structure) ───────────────────────────────────
function renderCombiner(
  cx: number, cy: number,
  nBranches: number, branchOcpd: number,
  label: string, calloutN: number
): {svg:string; lx:number; rx:number; ty:number; by:number} {
  const W2 = 80, H2 = 90;
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure — clean outline only
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  // Header
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'AC COMBINER', {sz:6, bold:true, anc:'middle'}));

  // Internal combiner bus
  const busY = cy + 8;
  p.push(busbar(bx+10, bx+W2-10, busY));
  p.push(txt(cx, busY-5, 'BUS', {sz:5, anc:'middle'}));

  // Branch breakers — each branch circuit terminates here
  const nShow = Math.min(nBranches, 4);
  const brkSpacing = (H2-22) / (nShow+1);
  for (let b = 0; b < nShow; b++) {
    const brY = by2 + 18 + brkSpacing*(b+1);
    // Input lug on left wall
    p.push(lug(bx+4, brY));
    // Wire lug → breaker
    p.push(ln(bx+7, brY, bx+20, brY, {sw:SW_THIN}));
    // Breaker
    p.push(breakerSymbol(bx+29, brY, 16, 10, branchOcpd));
    // Wire breaker → bus
    p.push(ln(bx+37, brY, cx-5, busY, {sw:SW_THIN}));
  }
  if (nBranches > 4) {
    p.push(txt(bx+29, busY-12, `+${nBranches-4}`, {sz:5, anc:'middle', fill:'#666'}));
  }

  // Feeder lug on right wall
  p.push(ln(bx+W2-10, busY, bx+W2-4, busY, {sw:SW_THIN}));
  p.push(lug(bx+W2-4, busY));
  // Output wire stub
  p.push(ln(bx+W2, busY, bx+W2+10, busY, {sw:SW_MED}));

  // Labels below box
  p.push(txt(cx, by2+H2+10, esc(label), {sz:F.tiny, anc:'middle', italic:true}));
  p.push(txt(cx, by2+H2+19, `${nBranches} branch inputs`, {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, by2+H2+28, 'NEC 690.9', {sz:F.tiny, anc:'middle', italic:true}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  // Input wire stub (left side at bus Y)
  p.push(ln(bx-10, busY, bx, busY, {sw:SW_MED}));

  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10, ty:by2, by:by2+H2};
}

// ── AC Disconnect (internal structure) ───────────────────────────────────────
function renderDisco(
  cx: number, cy: number,
  ocpd: number, calloutN: number
): {svg:string; lx:number; rx:number} {
  const W2 = 90, H2 = 70;
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'AC DISCONNECT', {sz:6, bold:true, anc:'middle'}));

  // Two poles: L1 and L2
  const poleY1 = cy - 8;
  const poleY2 = cy + 8;

  // ── LOAD terminals on LEFT (combiner feeds load side) ──────────────────
  // Arc shield is on LINE side (right/utility side) per NEC 690.14.
  // Combiner output → LOAD terminals (left side of disconnect).
  p.push(lug(bx+10, poleY1));
  p.push(lug(bx+10, poleY2));
  p.push(txt(bx+10, poleY2+13, 'LOAD', {sz:5, anc:'middle', bold:true, fill:'#333'}));
  p.push(txt(bx+10, poleY2+20, '(FROM COMBINER)', {sz:4.5, anc:'middle', fill:'#555'}));

  // Wire load terminal → switch
  p.push(ln(bx+13, poleY1, bx+30, poleY1, {sw:SW_THIN}));
  p.push(ln(bx+13, poleY2, bx+30, poleY2, {sw:SW_THIN}));

  // Knife switches (2-pole) — blade opens toward LINE side
  p.push(knifeSwitch(cx, poleY1, 30));
  p.push(knifeSwitch(cx, poleY2, 30));

  // Wire switch → line terminal
  p.push(ln(bx+W2-30, poleY1, bx+W2-13, poleY1, {sw:SW_THIN}));
  p.push(ln(bx+W2-30, poleY2, bx+W2-13, poleY2, {sw:SW_THIN}));

  // ── LINE terminals on RIGHT (utility/MSP side — arc shield here) ───────
  p.push(lug(bx+W2-10, poleY1));
  p.push(lug(bx+W2-10, poleY2));
  p.push(txt(bx+W2-10, poleY2+13, 'LINE', {sz:5, anc:'middle', bold:true, fill:'#333'}));
  p.push(txt(bx+W2-10, poleY2+20, '(TO MSP)', {sz:4.5, anc:'middle', fill:'#555'}));

  // Arc shield indicator on LINE side (top of enclosure, right side)
  p.push(ln(bx+W2*0.55, by2+14, bx+W2-2, by2+14, {sw:2, stroke:'#888'}));
  p.push(txt(bx+W2-2, by2+12, '⚡', {sz:5, anc:'end', fill:'#888'}));

  // Input wire stubs: combiner → LOAD side (left)
  p.push(ln(bx-10, cy, bx, poleY1, {sw:SW_MED}));
  p.push(ln(bx-10, cy, bx, poleY2, {sw:SW_MED}));

  // Output wire stubs: LINE side (right) → MSP
  p.push(ln(bx+W2, poleY1, bx+W2+10, cy, {sw:SW_MED}));
  p.push(ln(bx+W2, poleY2, bx+W2+10, cy, {sw:SW_MED}));

  // Labels below
  p.push(txt(cx, by2+H2+10, `${ocpd}A NON-FUSED`, {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, by2+H2+19, 'NEC 690.14 — UTILITY ACCESSIBLE', {sz:F.tiny, anc:'middle', italic:true}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};
}

// ── MSP Load-Side Tap (internal structure) ───────────────────────────────────
function renderMSPLoad(
  cx: number, cy: number,
  mainAmps: number, pvAmps: number, calloutN: number
): {svg:string; lx:number; rx:number} {
  const W2 = 96, H2 = 120;
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'MAIN SERVICE PANEL', {sz:5.5, bold:true, anc:'middle'}));

  // Main breaker at top
  const mbY = by2+28;
  p.push(txt(cx, mbY-4, `${mainAmps}A MAIN BREAKER`, {sz:5.5, anc:'middle', bold:true}));
  p.push(breakerSymbol(cx, mbY, 32, 14, mainAmps));

  // Main busbar
  const busY = mbY + 20;
  p.push(busbar(bx+8, bx+W2-8, busY, 'MAIN BUS'));
  p.push(ln(cx, mbY+7, cx, busY, {sw:SW_MED}));

  // Neutral bar (left)
  const nX = bx+10;
  p.push(ln(nX, busY+8, nX, busY+38, {stroke:'#444', sw:3}));
  p.push(txt(nX, busY+46, 'N', {sz:6, anc:'middle', bold:true, fill:'#444'}));

  // Ground bar (right)
  const gX = bx+W2-10;
  p.push(ln(gX, busY+8, gX, busY+38, {stroke:GRN, sw:3}));
  p.push(txt(gX, busY+46, 'G', {sz:6, anc:'middle', bold:true, fill:GRN}));
  p.push(gnd(gX, busY+48, GRN));

  // PV breaker on bus (load side)
  const pvBrkX = cx+20;
  const pvBrkY = busY+28;
  p.push(ln(pvBrkX, busY, pvBrkX, pvBrkY-6, {sw:SW_THIN}));
  p.push(breakerSymbol(pvBrkX, pvBrkY, 20, 12, pvAmps));
  p.push(txt(pvBrkX, pvBrkY+10, 'PV', {sz:5.5, anc:'middle', bold:true, fill:LOAD_CLR}));

  // Load lug below PV breaker
  const lugY = pvBrkY+22;
  p.push(ln(pvBrkX, pvBrkY+6, pvBrkX, lugY-3, {sw:SW_THIN}));
  p.push(lug(pvBrkX, lugY));
  p.push(txt(pvBrkX, lugY+9, 'LOAD LUG', {sz:5, anc:'middle'}));

  // Input wire: from left edge → routes to PV breaker lug
  p.push(ln(bx-10, cy, bx, cy, {sw:SW_MED}));
  p.push(ln(bx, cy, pvBrkX, lugY, {sw:SW_MED}));

  // Output wire: from main bus right → to utility meter
  p.push(ln(bx+W2-8, busY, bx+W2+10, busY, {sw:SW_MED}));

  // Labels below
  p.push(txt(cx, by2+H2+10, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, by2+H2+19, 'LOAD SIDE TAP — NEC 705.12(B)', {sz:F.tiny, anc:'middle', bold:true, fill:LOAD_CLR}));
  p.push(txt(cx, by2+H2+28, `${pvAmps}A PV BREAKER`, {sz:F.tiny, anc:'middle', fill:LOAD_CLR}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};
}

// ── MSP Supply-Side / Backfed (internal structure) ───────────────────────────
function renderMSPSupply(
  cx: number, cy: number,
  mainAmps: number, backfeedAmps: number,
  isSupply: boolean, calloutN: number
): {svg:string; lx:number; rx:number} {
  const W2 = 96, H2 = 110;
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'MAIN SERVICE PANEL', {sz:5.5, bold:true, anc:'middle'}));

  // Main busbar
  const busY = by2+38;
  p.push(busbar(bx+8, bx+W2-8, busY, 'MAIN BUS'));

  if (isSupply) {
    // Supply-side tap connector
    const tapX = bx+28;
    const tapY = busY-16;
    p.push(txt(tapX, tapY-8, 'TAP', {sz:5.5, anc:'middle', bold:true, fill:SUPPLY_CLR}));
    p.push(ln(tapX-10, tapY, tapX+10, tapY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(ln(tapX, tapY, tapX, busY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(circ(tapX, tapY, 3, {fill:SUPPLY_CLR, stroke:SUPPLY_CLR, sw:0}));
    p.push(txt(cx, by2+H2+10, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
    p.push(txt(cx, by2+H2+19, 'SUPPLY SIDE TAP — NEC 705.11', {sz:F.tiny, anc:'middle', bold:true, fill:SUPPLY_CLR}));
  } else {
    // Backfed breaker on bus
    const brkX = cx;
    const brkY = busY+26;
    p.push(ln(brkX, busY, brkX, brkY-6, {sw:SW_THIN}));
    p.push(breakerSymbol(brkX, brkY, 24, 14, backfeedAmps));
    p.push(txt(brkX, brkY+12, 'BACKFED', {sz:5.5, anc:'middle', bold:true}));
    p.push(txt(cx, by2+H2+10, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
    p.push(txt(cx, by2+H2+19, `${backfeedAmps}A BACKFED BREAKER`, {sz:F.tiny, anc:'middle', bold:true}));
    p.push(txt(cx, by2+H2+28, 'NEC 705.12(B)(2)', {sz:F.tiny, anc:'middle', italic:true}));
  }

  // Main breaker (right side)
  const mbX = bx+W2-20;
  p.push(breakerSymbol(mbX, busY, 20, 12, mainAmps));
  p.push(txt(mbX, busY+12, 'MAIN', {sz:5, anc:'middle', bold:true}));

  // Neutral bar
  const nX = bx+10;
  p.push(ln(nX, busY+8, nX, busY+36, {stroke:'#444', sw:3}));
  p.push(txt(nX, busY+44, 'N', {sz:6, anc:'middle', bold:true, fill:'#444'}));

  // Ground bar
  const gX = bx+W2-10;
  p.push(ln(gX, busY+8, gX, busY+36, {stroke:GRN, sw:3}));
  p.push(txt(gX, busY+44, 'G', {sz:6, anc:'middle', bold:true, fill:GRN}));
  p.push(gnd(gX, busY+46, GRN));

  // Input wire stub
  p.push(ln(bx-10, cy, bx, cy, {sw:SW_MED}));
  // Output wire stub
  p.push(ln(bx+W2-8, busY, bx+W2+10, busY, {sw:SW_MED}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10};
}

// ── Main Render ──────────────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  const parts: string[] = [];
  const isMicro = input.topologyType === 'MICROINVERTER';

  const findRun = (id: string): RunSegment|undefined => input.runs?.find(r=>r.id===id);

  const roofRun       = findRun('ROOF_RUN');
  const branchRun     = findRun('BRANCH_RUN');
  const combDiscoRun  = findRun('COMBINER_TO_DISCO_RUN');
  const dcStringRun   = findRun('DC_STRING_RUN');
  const dcDiscoInvRun = findRun('DC_DISCO_TO_INV_RUN');
  const invDiscoRun   = findRun('INV_TO_DISCO_RUN');
  const discoMspRun   = findRun('DISCO_TO_METER_RUN');
  const mspUtilRun    = findRun('MSP_TO_UTILITY_RUN');

  const acFeederRun         = isMicro ? combDiscoRun : invDiscoRun;
  const resolvedAcWire      = acFeederRun?.wireGauge   ?? input.acWireGauge   ?? '#6 AWG';
  const resolvedAcOCPD      = acFeederRun?.ocpdAmps    ?? input.acOCPD        ?? 30;
  const resolvedAcConduit   = acFeederRun?.conduitSize ?? '3/4"';
  const resolvedAcCondType  = acFeederRun?.conduitType ?? input.acConduitType ?? 'EMT';
  const resolvedDcWire      = dcStringRun?.wireGauge   ?? input.dcWireGauge   ?? '#10 AWG';

  const intercon     = String(input.interconnection ?? '').toLowerCase();
  const isLoadSide   = intercon.includes('load');
  const isSupplySide = intercon.includes('supply') || intercon.includes('line');
  const isBackfed    = !isLoadSide && !isSupplySide;
  const pvBreakerAmps = input.backfeedAmps ?? resolvedAcOCPD;

  // ── SVG root ──────────────────────────────────────────────────────────────
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};">`);
  parts.push(rect(0, 0, W, H, {fill:WHT, stroke:WHT, sw:0}));
  parts.push(rect(MAR/2, MAR/2, W-MAR, H-MAR, {fill:WHT, stroke:BLK, sw:SW_BORDER}));

  // ── Title ─────────────────────────────────────────────────────────────────
  const tcx = (DX + TB_X) / 2;
  parts.push(txt(tcx, DY+16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {sz:F.title, bold:true, anc:'middle'}));
  parts.push(txt(tcx, DY+26,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    {sz:F.sub, anc:'middle', fill:'#444'}));

  // ── Schematic border ──────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));

  // ── X positions ───────────────────────────────────────────────────────────
  const xPad = 50;
  const uW   = SCH_W - xPad*2;

  let xPV: number, xJBox: number, xComb: number, xDisco: number, xMSP: number, xUtil: number;
  let xInv = 0;

  if (isMicro) {
    xPV   = SCH_X + xPad;
    xJBox = SCH_X + xPad + uW*0.17;
    xComb = SCH_X + xPad + uW*0.36;
    xDisco= SCH_X + xPad + uW*0.56;
    xMSP  = SCH_X + xPad + uW*0.75;
    xUtil = SCH_X + xPad + uW;
  } else {
    xPV   = SCH_X + xPad;
    xJBox = SCH_X + xPad + uW*0.13;
    xComb = SCH_X + xPad + uW*0.27; // DC Disco
    xInv  = SCH_X + xPad + uW*0.43; // Inverter
    xDisco= SCH_X + xPad + uW*0.60; // AC Disco
    xMSP  = SCH_X + xPad + uW*0.78;
    xUtil = SCH_X + xPad + uW;
  }

  // ── NODE 1: PV ARRAY ──────────────────────────────────────────────────────
  const pvW = 80, pvH = 68;
  const pvCX = xPV, pvCY = BUS_Y;

  // PV array: grid of module symbols
  parts.push(rect(pvCX-pvW/2, pvCY-pvH/2, pvW, pvH, {fill:WHT, sw:SW_MED}));
  // 2×3 grid of mini module symbols
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const mx = pvCX - pvW/2 + 10 + col*22;
      const my = pvCY - pvH/2 + 12 + row*26;
      parts.push(pvModuleSymbol(mx+9, my+9, 18, 14));
    }
  }
  parts.push(txt(pvCX, pvCY-pvH/2-18, 'PV ARRAY', {sz:F.hdr, bold:true, anc:'middle'}));
  parts.push(txt(pvCX, pvCY-pvH/2-8, `${input.totalModules} × ${input.panelWatts}W`, {sz:F.sub, anc:'middle'}));
  parts.push(txt(pvCX, pvCY+pvH/2+9, esc(input.panelModel), {sz:F.tiny, anc:'middle', italic:true}));
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    parts.push(txt(pvCX, pvCY+pvH/2+18, `${md} × ${esc(input.inverterModel)}`, {sz:F.tiny, anc:'middle'}));
  } else {
    const ns = input.totalStrings||1;
    const pps = input.panelsPerString ?? Math.round(input.totalModules/Math.max(ns,1));
    parts.push(txt(pvCX, pvCY+pvH/2+18, `${ns} string${ns>1?'s':''} × ${pps} panels`, {sz:F.tiny, anc:'middle'}));
  }
  parts.push(callout(pvCX+pvW/2+14, pvCY-pvH/2-5, 1));
  const pvOutX = pvCX+pvW/2;

  // ── NODE 2: ROOF J-BOX ────────────────────────────────────────────────────
  const jbW = 40, jbH = 40;
  const jbCX = xJBox, jbCY = BUS_Y;

  parts.push(rect(jbCX-jbW/2, jbCY-jbH/2, jbW, jbH, {fill:WHT, sw:SW_MED}));
  // X symbol
  parts.push(ln(jbCX-jbW/2+5, jbCY-jbH/2+5, jbCX+jbW/2-5, jbCY+jbH/2-5, {sw:SW_HAIR}));
  parts.push(ln(jbCX+jbW/2-5, jbCY-jbH/2+5, jbCX-jbW/2+5, jbCY+jbH/2-5, {sw:SW_HAIR}));
  // Terminal lugs
  parts.push(lug(jbCX-jbW/2+6, jbCY));
  parts.push(lug(jbCX+jbW/2-6, jbCY));
  parts.push(txt(jbCX, jbCY-jbH/2-15, 'ROOF J-BOX', {sz:F.sub, bold:true, anc:'middle'}));
  parts.push(txt(jbCX, jbCY-jbH/2-7, isMicro?'AC JUNCTION':'DC JUNCTION', {sz:F.tiny, anc:'middle'}));
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? Math.ceil(md/16);
    const bocpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    parts.push(txt(jbCX, jbCY+jbH/2+9, `${nb} branches`, {sz:F.tiny, anc:'middle'}));
    parts.push(txt(jbCX, jbCY+jbH/2+18, `${bocpd}A OCPD ea.`, {sz:F.tiny, anc:'middle'}));
  } else {
    parts.push(txt(jbCX, jbCY+jbH/2+9, `${input.totalStrings||1} strings`, {sz:F.tiny, anc:'middle'}));
  }
  parts.push(callout(jbCX+jbW/2+12, jbCY-jbH/2-5, 2));

  // SEGMENT 1: PV → J-Box (open air)
  {
    const run = isMicro ? roofRun : dcStringRun;
    const fb = isMicro
      ? [`${input.branchWireGauge??'#10 AWG'} THWN-2`, '1×#10 GRN EGC', 'OPEN AIR — NEC 690.31']
      : [`${resolvedDcWire} USE-2/PV Wire`, '1×#10 GRN EGC', 'OPEN AIR — NEC 690.31'];
    const {lines, cnt} = runLines(run, fb);
    parts.push(wireSeg(pvOutX, jbCX-jbW/2, BUS_Y, lines, {openAir:true, bundleCount:cnt}));
  }

  // ── NODE 3: AC COMBINER (micro) or DC DISCONNECT (string) ─────────────────
  let node3RX: number;

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? Math.ceil(md/16);
    const bocpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    const clabel = input.combinerLabel ?? `${input.inverterManufacturer} IQ Combiner`;
    const cr = renderCombiner(xComb, BUS_Y, nb, bocpd, clabel, 3);
    parts.push(cr.svg);
    node3RX = cr.rx;
    parts.push(txt(xComb, cr.ty-8, 'AC COMBINER', {sz:F.hdr, bold:true, anc:'middle'}));

    // SEGMENT 2: J-Box → Combiner
    {
      const run = branchRun;
      const fb = [`${input.branchWireGauge??'#10 AWG'} THWN-2`, '1×#10 GRN EGC', `IN ${input.branchConduitSize??'3/4"'} EMT`];
      const {lines, cnt} = runLines(run, fb);
      parts.push(wireSeg(jbCX+jbW/2, cr.lx, BUS_Y, lines, {bundleCount:cnt}));
    }
  } else {
    // DC DISCONNECT with fuse symbols
    const dW = 72, dH = 48;
    const dcX = xComb, dcY = BUS_Y;
    parts.push(rect(dcX-dW/2, dcY-dH/2, dW, dH, {fill:WHT, sw:SW_MED}));
    parts.push(ln(dcX-dW/2, dcY-dH/2+13, dcX+dW/2, dcY-dH/2+13, {sw:SW_THIN}));
    parts.push(txt(dcX, dcY-dH/2+9, 'DC DISCONNECT', {sz:5.5, bold:true, anc:'middle'}));
    // Line lugs
    parts.push(lug(dcX-dW/2+6, dcY-7));
    parts.push(lug(dcX-dW/2+6, dcY+7));
    // Fuses
    parts.push(fuseSymbol(dcX, dcY-7));
    parts.push(fuseSymbol(dcX, dcY+7));
    // Load lugs
    parts.push(lug(dcX+dW/2-6, dcY-7));
    parts.push(lug(dcX+dW/2-6, dcY+7));
    // Wires inside
    parts.push(ln(dcX-dW/2+9, dcY-7, dcX-8, dcY-7, {sw:SW_THIN}));
    parts.push(ln(dcX-dW/2+9, dcY+7, dcX-8, dcY+7, {sw:SW_THIN}));
    parts.push(ln(dcX+8, dcY-7, dcX+dW/2-9, dcY-7, {sw:SW_THIN}));
    parts.push(ln(dcX+8, dcY+7, dcX+dW/2-9, dcY+7, {sw:SW_THIN}));
    parts.push(txt(dcX, dcY-dH/2-15, '(N) DC DISCONNECT', {sz:F.sub, bold:true, anc:'middle'}));
    parts.push(txt(dcX, dcY+dH/2+9, `${input.dcOCPD}A FUSED`, {sz:F.tiny, anc:'middle'}));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcX, dcY+dH/2+18, 'RAPID SHUTDOWN — NEC 690.12', {sz:F.tiny, anc:'middle', italic:true}));
    }
    parts.push(callout(dcX+dW/2-4, dcY-dH/2-5, 3));
    node3RX = dcX+dW/2;

    // SEGMENT 2: J-Box → DC Disco
    {
      const run = dcStringRun;
      const fb = [`${resolvedDcWire} USE-2/PV Wire`, '1×#10 GRN EGC', `IN ${input.dcConduitType??'EMT'}`];
      const {lines, cnt} = runLines(run, fb);
      parts.push(wireSeg(jbCX+jbW/2, dcX-dW/2, BUS_Y, lines, {bundleCount:cnt}));
    }
  }

  // ── NODE 4: INVERTER (string only) ────────────────────────────────────────
  let invRX = node3RX;

  if (!isMicro) {
    const invCX = xInv, invCY = BUS_Y;
    const invR = 28;
    parts.push(inverterSymbol(invCX, invCY, invR));
    // DC input lug
    parts.push(lug(invCX-invR, invCY));
    parts.push(ln(invCX-invR-10, invCY, invCX-invR, invCY, {sw:SW_MED}));
    // AC output lug
    parts.push(lug(invCX+invR, invCY));
    parts.push(ln(invCX+invR, invCY, invCX+invR+10, invCY, {sw:SW_MED}));
    const tl = input.topologyType==='STRING_WITH_OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER';
    parts.push(txt(invCX, invCY-invR-18, tl, {sz:F.hdr, bold:true, anc:'middle'}));
    parts.push(txt(invCX, invCY-invR-8, `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, {sz:F.sub, anc:'middle'}));
    parts.push(txt(invCX, invCY+invR+9, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, {sz:F.tiny, anc:'middle'}));
    if (input.mpptAllocation) {
      parts.push(txt(invCX, invCY+invR+18, `MPPT: ${input.mpptAllocation}`, {sz:F.tiny, anc:'middle'}));
    }
    parts.push(callout(invCX+invR+14, invCY-invR-5, 4));
    invRX = invCX+invR+10;

    // SEGMENT 3: DC Disco → Inverter
    {
      const run = dcDiscoInvRun ?? dcStringRun;
      const fb = [`${resolvedDcWire} USE-2/PV Wire`, '1×#10 GRN EGC', `IN ${input.dcConduitType??'EMT'}`];
      const {lines, cnt} = runLines(run, fb);
      parts.push(wireSeg(node3RX, invCX-invR-10, BUS_Y, lines, {bundleCount:cnt}));
    }
  }

  // ── NODE 5: AC DISCONNECT ─────────────────────────────────────────────────
  const discoResult = renderDisco(xDisco, BUS_Y, resolvedAcOCPD, isMicro?4:5);
  parts.push(discoResult.svg);
  parts.push(txt(xDisco, BUS_Y-40, '(N) AC DISCONNECT', {sz:F.hdr, bold:true, anc:'middle'}));

  // SEGMENT: Combiner/Inverter → AC Disco
  {
    const x1 = invRX;
    const x2 = discoResult.lx;
    const run = isMicro ? combDiscoRun : invDiscoRun;
    const fb = [
      `${resolvedAcWire} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    parts.push(wireSeg(x1, x2, BUS_Y, lines, {bundleCount:cnt}));
  }

  // ── NODE 6: MSP ───────────────────────────────────────────────────────────
  let mspRX: number;
  let mspBusY = BUS_Y; // Y of MSP output wire (main bus level)

  if (isLoadSide) {
    const r = renderMSPLoad(xMSP, BUS_Y, input.mainPanelAmps, pvBreakerAmps, isMicro?5:6);
    parts.push(r.svg);
    mspRX = r.rx;
    // MSP output is at main bus Y (offset from BUS_Y)
    const mbY = (BUS_Y - 60/2) + 28 + 20; // busY inside MSP
    mspBusY = mbY;
  } else {
    const r = renderMSPSupply(xMSP, BUS_Y, input.mainPanelAmps, input.backfeedAmps, isSupplySide, isMicro?5:6);
    parts.push(r.svg);
    mspRX = r.rx;
    mspBusY = (BUS_Y - 55/2) + 38; // busY inside MSP
  }

  // SEGMENT: AC Disco → MSP
  {
    const run = discoMspRun;
    const fb = [
      `${resolvedAcWire} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    parts.push(wireSeg(discoResult.rx, xMSP-48, BUS_Y, lines, {bundleCount:cnt}));
  }


  // NODE 8: BATTERY STORAGE (if configured)
  // Battery placed ABOVE the main bus, to the right of the MSP
  if (input.hasBattery && input.batteryModel) {
    const batCX = xMSP + 140;
    const batCY = BUS_Y - 110;
    const batResult = renderBattery(
      batCX, batCY,
      input.batteryModel,
      input.batteryKwh ?? 0,
      input.batteryBackfeedA ?? 0,
      isMicro ? 7 : 8
    );
    parts.push(batResult.svg);

    // AC connection: dashed line from battery bottom to MSP bus
    parts.push(ln(batCX, batResult.by, batCX, BUS_Y, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    parts.push(ln(batCX, BUS_Y, xMSP + 20, BUS_Y, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    parts.push(circ(xMSP + 20, BUS_Y, 3, {fill: '#1565C0', stroke: '#1565C0', sw: 0}));

    const batWireLabel = (input.batteryBackfeedA ?? 0) > 0
      ? [`#6 AWG THWN-2`, `${input.batteryBackfeedA}A — NEC 705.12(B)`]
      : ['#6 AWG THWN-2', 'AC-COUPLED BATTERY'];
    parts.push(tspan(batCX + 30, BUS_Y - 20, batWireLabel, {sz: F.tiny, anc: 'start', fill: '#1565C0'}));
  }

  // NODE 9: GENERATOR + ATS (if configured)
  // Generator placed BELOW the schematic area, left of MSP
  if ((input.generatorKw ?? 0) > 0) {
    const genCX = xMSP - 200;
    const genCY = BUS_Y + 160;
    const genResult = renderGenerator(
      genCX, genCY,
      input.generatorBrand ?? '',
      input.generatorModel ?? '',
      input.generatorKw!,
      isMicro ? 8 : 9
    );
    parts.push(genResult.svg);

    const atsCX = xMSP - 80;
    const atsCY = BUS_Y + 160;
    const atsResult = renderATS(
      atsCX, atsCY,
      input.atsBrand ?? '',
      input.atsModel ?? '',
      input.atsAmpRating ?? 200,
      isMicro ? 9 : 10
    );
    parts.push(atsResult.svg);

    // Generator -> ATS
    parts.push(ln(genResult.rx, genCY, atsResult.lx, atsCY, {stroke: '#2E7D32', sw: SW_MED}));
    const genAtsX = (genResult.rx + atsResult.lx) / 2;
    parts.push(tspan(genAtsX, genCY - 10, ['#6 AWG THWN-2', 'GEN OUTPUT'], {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

    // Utility feed to ATS (vertical drop from BUS_Y)
    const utilFeedX = atsCX - 44;
    parts.push(ln(utilFeedX, BUS_Y + 36, utilFeedX, atsCY, {stroke: BLK, sw: SW_MED}));
    parts.push(txt(utilFeedX - 4, (BUS_Y + 36 + atsCY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

    // ATS -> MSP (vertical rise)
    const atsMspX = atsCX + 55;
    parts.push(ln(atsMspX, atsCY, atsMspX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
    parts.push(tspan(atsMspX + 6, atsCY - 20, ['#4 AWG THWN-2', 'ATS → MSP'], {sz: F.tiny, anc: 'start', fill: '#E65100'}));

    parts.push(txt(atsCX, atsCY + 55, 'NEC 702.5 — TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));

    if (input.hasBackupPanel) {
      const bpCX = atsCX + 160;
      const bpCY = BUS_Y + 160;
      const bpResult = renderBackupPanel(
        bpCX, bpCY,
        input.backupPanelBrand ?? '',
        input.backupPanelAmps ?? 100,
        isMicro ? 10 : 11
      );
      parts.push(bpResult.svg);
      parts.push(ln(atsResult.rx, atsCY, bpResult.lx, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(tspan((atsResult.rx + bpResult.lx) / 2, bpCY - 10, ['#6 AWG THWN-2', 'CRITICAL LOADS'], {sz: F.tiny, anc: 'middle', fill: '#6A1B9A'}));
    }
  }

  // ── NODE 7: UTILITY METER ─────────────────────────────────────────────────
  const utilCX = xUtil, utilCY = BUS_Y;
  const mR = 24;

  // SEGMENT: MSP → Meter
  {
    const run = mspUtilRun;
    const fb = [
      `${resolvedAcWire} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    parts.push(wireSeg(mspRX, utilCX-mR-10, BUS_Y, lines, {bundleCount:cnt}));
  }

  // Meter symbol
  parts.push(meterSymbol(utilCX, utilCY, mR));
  parts.push(ln(utilCX-mR-10, utilCY, utilCX-mR, utilCY, {sw:SW_MED}));
  parts.push(txt(utilCX, utilCY-mR-15, 'UTILITY METER', {sz:F.hdr, bold:true, anc:'middle'}));
  parts.push(txt(utilCX, utilCY-mR-6, esc(input.utilityName), {sz:F.sub, anc:'middle'}));
  parts.push(txt(utilCX, utilCY+mR+9, '120/240V, 1Ø, 3W', {sz:F.tiny, anc:'middle'}));
  parts.push(callout(utilCX+mR+14, utilCY-mR-5, isMicro?6:7));

  // Utility grid (vertical drop below meter)
  const gridCY = utilCY + mR + 48;
  parts.push(ln(utilCX, utilCY+mR, utilCX, gridCY-16, {sw:SW_MED}));
  parts.push(circ(utilCX, gridCY, 16, {fill:WHT, sw:SW_MED}));
  parts.push(txt(utilCX, gridCY-1, 'UTIL', {sz:5.5, bold:true, anc:'middle'}));
  parts.push(txt(utilCX, gridCY+7, 'GRID', {sz:5, anc:'middle'}));
  parts.push(txt(utilCX, gridCY+24, 'UTILITY GRID', {sz:F.tiny, anc:'middle', bold:true}));
  parts.push(txt(utilCX, gridCY+33, esc(input.utilityName), {sz:F.tiny, anc:'middle'}));
  parts.push(ln(utilCX, gridCY+16, utilCX, gridCY+26, {sw:SW_MED}));
  parts.push(gnd(utilCX, gridCY+26));

  // ── GROUNDING RAIL ────────────────────────────────────────────────────────
  const gndPts = isMicro
    ? [xJBox, xComb, xDisco, xMSP]
    : [xJBox, xComb, xInv, xDisco, xMSP];
  const gx1 = gndPts[0], gx2 = gndPts[gndPts.length-1];
  parts.push(ln(gx1, GND_Y, gx2, GND_Y, {stroke:GRN, sw:SW_MED}));
  for (const gx of gndPts) {
    parts.push(ln(gx, BUS_Y+36, gx, GND_Y, {stroke:GRN, sw:SW_MED}));
    parts.push(gnd(gx, GND_Y));
  }
  parts.push(txt((gx1+gx2)/2, GND_Y-5,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43',
    {sz:F.tiny, anc:'middle', fill:GRN}));

  // ── Rapid Shutdown ────────────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rY = SCH_Y+SCH_H-22;
    parts.push(rect(SCH_X+5, rY-10, 240, 16, {fill:WHT, stroke:BLK, sw:SW_THIN}));
    parts.push(txt(SCH_X+10, rY, 'RAPID SHUTDOWN — NEC 690.12 COMPLIANT', {sz:F.tiny, bold:true}));
  }

  // ── LEGEND ────────────────────────────────────────────────────────────────
  // Legend expanded with battery/generator/ATS entries
  const legEntries: {dash: string; stroke: string; label: string}[] = [
    {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
    {dash:'10,5',stroke:GRN,       label:'Open Air — PV Wire/THWN-2 (NEC 690.31)'},
    {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
    {dash:'4,2', stroke:BLK,       label:'DC Conductor in Conduit (USE-2/PV Wire)'},
    ...(input.hasBattery ? [{dash:'6,3', stroke:'#1565C0', label:'Battery AC-Coupled Connection'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#2E7D32', label:'Generator Output Conductor'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#E65100', label:'ATS Transfer Conductor'}] : []),
  ];
  const legH = 16 + legEntries.length * 11;
  const legX = SCH_X+SCH_W-195, legY = SCH_Y+SCH_H - legH - 4;
  parts.push(rect(legX, legY, 188, legH, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(legX+4, legY+10, 'LEGEND', {sz:F.sub, bold:true}));
  parts.push(ln(legX, legY+13, legX+188, legY+13, {sw:SW_THIN}));
  legEntries.forEach((item,i) => {
    const ly = legY+19+i*11;
    parts.push(ln(legX+4, ly, legX+38, ly, {stroke:item.stroke, sw:SW_MED, dash:item.dash||undefined}));
    parts.push(txt(legX+44, ly+3, item.label, {sz:F.tiny}));
  });

  // ── CALCULATION PANELS ────────────────────────────────────────────────────
  const cW = Math.floor(DW/3) - 4;
  const dcKw = input.totalModules * input.panelWatts / 1000;

  // Panel 1
  const p1x = DX;
  parts.push(rect(p1x, CALC_Y, cW, CALC_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(rect(p1x, CALC_Y, cW, 14, {fill:BLK, sw:0}));

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const ab = Math.ceil(md/16);
    const ba = branchRun?.ocpdAmps ?? Math.ceil((input.acOutputKw*1000/240)*1.25/5)*5;
    parts.push(txt(p1x+cW/2, CALC_Y+10, 'AC BRANCH CIRCUIT INFO', {sz:F.hdr, bold:true, anc:'middle', fill:WHT}));
    const rows: [string,string][] = [
      ['Topology','MICROINVERTER'],
      ['Microinverters',`${md} units`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['AC per Micro',`${((input.acOutputKw*1000)/md).toFixed(0)} W`],
      ['Branch Circuits',`${ab}`],
      ['Max Micros/Branch','16 (NEC 690.8)'],
      ['Branch OCPD',`${ba} A`],
      ['Branch Wire',`${branchRun?.wireGauge ?? input.branchWireGauge ?? '#10 AWG'}`],
      ['Feeder Wire',`${resolvedAcWire}`],
      ['Feeder Conduit',`${resolvedAcConduit} ${resolvedAcCondType}`],
      ['Module Voc',`${input.panelVoc} V`],
      ['Module Isc',`${input.panelIsc} A`],
    ];
    const rh = Math.min(13, (CALC_H-17)/rows.length);
    rows.forEach(([l,v],i) => {
      const ry = CALC_Y+19+i*rh;
      if (i%2===1) parts.push(rect(p1x, ry-rh+2, cW, rh, {fill:LGY, stroke:'none', sw:0}));
      parts.push(txt(p1x+4, ry, l, {sz:F.tiny}));
      parts.push(txt(p1x+cW-4, ry, v, {sz:F.tiny, anc:'end', bold:true}));
    });
  } else {
    const pps = input.panelsPerString ?? Math.round(input.totalModules/Math.max(input.totalStrings,1));
    const lsp = input.lastStringPanels ?? pps;
    const vc  = input.vocCorrected ?? input.panelVoc;
    const sv  = input.stringVoc ?? (vc*pps);
    const si  = input.stringIsc ?? input.panelIsc;
    const op  = input.ocpdPerString ?? input.dcOCPD;
    const dt  = input.designTempMin ?? -10;
    const dar = input.dcAcRatio ?? (input.acOutputKw>0 ? dcKw/input.acOutputKw : 0);
    parts.push(txt(p1x+cW/2, CALC_Y+10, 'DC SYSTEM CALCULATIONS', {sz:F.hdr, bold:true, anc:'middle', fill:WHT}));
    const rows: [string,string][] = [
      ['Module Voc (STC)',`${input.panelVoc} V`],
      ['Module Isc (STC)',`${input.panelIsc} A`],
      ['Design Temp (NEC 690.7)',`${dt}°C`],
      ['Voc Corrected',`${vc.toFixed(2)} V`],
      ['Panels per String', pps===lsp?`${pps}`:`${pps} (last: ${lsp})`],
      ['Number of Strings',`${input.totalStrings}`],
      ['String Voc (corrected)',`${sv.toFixed(1)} V`],
      ['String Voc × 1.25',`${(sv*1.25).toFixed(1)} V`],
      ['String Isc × 1.25',`${(si*1.25).toFixed(2)} A`],
      ['DC OCPD / String',`${op} A`],
      ['DC Wire Gauge',`${resolvedDcWire}`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['DC/AC Ratio',`${dar.toFixed(2)}`],
    ];
    const rh = Math.min(13, (CALC_H-17)/rows.length);
    rows.forEach(([l,v],i) => {
      const ry = CALC_Y+19+i*rh;
      if (i%2===1) parts.push(rect(p1x, ry-rh+2, cW, rh, {fill:LGY, stroke:'none', sw:0}));
      parts.push(txt(p1x+4, ry, l, {sz:F.tiny}));
      parts.push(txt(p1x+cW-4, ry, v, {sz:F.tiny, anc:'end', bold:true}));
    });
  }

  // Panel 2: AC calcs
  const p2x = DX+cW+4;
  parts.push(rect(p2x, CALC_Y, cW, CALC_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(rect(p2x, CALC_Y, cW, 14, {fill:BLK, sw:0}));
  parts.push(txt(p2x+cW/2, CALC_Y+10, 'AC SYSTEM CALCULATIONS', {sz:F.hdr, bold:true, anc:'middle', fill:WHT}));
  const acRows: [string,string][] = [
    ['AC Output (kW)',`${input.acOutputKw} kW`],
    ['AC Output Amps',`${input.acOutputAmps} A`],
    ['AC OCPD (125%)',`${resolvedAcOCPD} A`],
    ['AC Wire Gauge',`${resolvedAcWire}`],
    ['AC Conduit Type',resolvedAcCondType],
    ['Conduit Size',resolvedAcConduit||'—'],
    ['Service Voltage','120/240V, 1Ø'],
    ['Main Panel Rating',`${input.mainPanelAmps} A`],
    ...(isLoadSide ? [
      ['Interconnection','Load Side Tap'] as [string,string],
      ['NEC Reference','NEC 705.12(B)'] as [string,string],
      ['PV Breaker',`${pvBreakerAmps} A`] as [string,string],
      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+pvBreakerAmps ? 'PASS ✓':'FAIL ✗'}`] as [string,string],
    ] : isSupplySide ? [
      ['Interconnection','Supply Side Tap'] as [string,string],
      ['NEC Reference','NEC 705.11'] as [string,string],
      ['Backfed Breaker','N/A — Tap Connection'] as [string,string],
      ['120% Rule','N/A — Supply Side'] as [string,string],
    ] : [
      ['Interconnection','Backfed Breaker'] as [string,string],
      ['NEC Reference','NEC 705.12(B)(2)'] as [string,string],
      ['Backfeed Breaker',`${input.backfeedAmps} A`] as [string,string],
      ['120% Rule',`${input.mainPanelAmps*1.2 >= input.mainPanelAmps+input.backfeedAmps ? 'PASS ✓':'FAIL ✗'}`] as [string,string],
    ]),
  ];
  const acRh = Math.min(13, (CALC_H-17)/acRows.length);
  acRows.forEach(([l,v],i) => {
    const ry = CALC_Y+19+i*acRh;
    if (i%2===1) parts.push(rect(p2x, ry-acRh+2, cW, acRh, {fill:LGY, stroke:'none', sw:0}));
    parts.push(txt(p2x+4, ry, l, {sz:F.tiny}));
    const isPF = v.includes('✓')||v.includes('✗');
    const vc2 = isPF ? (v.includes('✓')?PASS:FAIL) : BLK;
    parts.push(txt(p2x+cW-4, ry, v, {sz:F.tiny, anc:'end', bold:true, fill:vc2}));
  });

  // Panel 3: Equipment schedule
  const p3x = DX+(cW+4)*2;
  parts.push(rect(p3x, CALC_Y, cW, CALC_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(rect(p3x, CALC_Y, cW, 14, {fill:BLK, sw:0}));
  parts.push(txt(p3x+cW/2, CALC_Y+10, 'EQUIPMENT SCHEDULE', {sz:F.hdr, bold:true, anc:'middle', fill:WHT}));
  const md2 = input.deviceCount ?? input.totalModules;
  const pp2 = input.panelsPerString ?? Math.round(input.totalModules/Math.max(input.totalStrings,1));
  const eqRows: [string,string][] = isMicro ? [
    ['PV Module',esc(input.panelModel)],
    ['Module Wattage',`${input.panelWatts} W`],
    ['Total Modules',`${input.totalModules}`],
    ['Microinverters',`${md2} units`],
    ['Branch Circuits',`${Math.ceil(md2/16)}`],
    ['Inverter Mfr.',esc(input.inverterManufacturer)],
    ['Inverter Model',esc(input.inverterModel)],
    ['Inverter Output',`${input.acOutputKw} kW AC`],
    ['AC Combiner',esc(input.combinerLabel??'IQ Combiner')],
    ['AC Disconnect',`${resolvedAcOCPD}A Non-Fused`],
    ['Main Panel',`${input.mainPanelAmps} A`],
    ['Utility',esc(input.utilityName)],
    ['Interconnection',esc(input.interconnection)],
    ['Rapid Shutdown',input.rapidShutdownIntegrated?'INTEGRATED':'EXTERNAL'],
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity',`${input.batteryKwh} kWh`] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A — NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ] : [
    ['PV Module',esc(input.panelModel)],
    ['Module Wattage',`${input.panelWatts} W`],
    ['Total Modules',`${input.totalModules}`],
    ['Strings',`${input.totalStrings} × ${pp2} panels`],
    ['MPPT Channels',input.mpptAllocation??`${input.mpptChannels??1} ch`],
    ['Combiner',esc(input.combinerLabel??(input.combinerType??'Direct'))],
    ['Inverter Mfr.',esc(input.inverterManufacturer)],
    ['Inverter Model',esc(input.inverterModel)],
    ['Inverter Output',`${input.acOutputKw} kW AC`],
    ['DC Disconnect',`${input.dcOCPD}A Fused`],
    ['AC Disconnect',`${resolvedAcOCPD}A Non-Fused`],
    ['Main Panel',`${input.mainPanelAmps} A`],
    ['Utility',esc(input.utilityName)],
    ['Interconnection',esc(input.interconnection)],
    ['Rapid Shutdown',input.rapidShutdownIntegrated?'INTEGRATED':'EXTERNAL'],
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity',`${input.batteryKwh} kWh`] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A — NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ];
  const eqRh = Math.min(12, (CALC_H-17)/eqRows.length);
  eqRows.forEach(([l,v],i) => {
    const ry = CALC_Y+19+i*eqRh;
    if (i%2===1) parts.push(rect(p3x, ry-eqRh+2, cW, eqRh, {fill:LGY, stroke:'none', sw:0}));
    parts.push(txt(p3x+4, ry, l, {sz:F.tiny}));
    parts.push(txt(p3x+cW-4, ry, v, {sz:F.tiny, anc:'end', bold:true}));
  });

  // ── CONDUIT & CONDUCTOR SCHEDULE ──────────────────────────────────────────
  parts.push(rect(DX, SCHED_Y, DW, SCHED_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(rect(DX, SCHED_Y, DW, 14, {fill:BLK, sw:0}));
  parts.push(txt(DX+6, SCHED_Y+10, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9 TABLE 1', {sz:F.hdr, bold:true, fill:WHT}));

  const sCols = [
    {label:'RUN ID',w:0.07},{label:'FROM',w:0.11},{label:'TO',w:0.11},
    {label:'CONDUCTORS',w:0.28},{label:'CONDUIT',w:0.10},{label:'FILL %',w:0.06},
    {label:'AMPACITY',w:0.07},{label:'OCPD',w:0.06},{label:'V-DROP %',w:0.07},
    {label:'LENGTH',w:0.06},{label:'PASS',w:0.05},
  ];
  const hY = SCHED_Y+24;
  const rH = 13;
  let cx2 = DX;
  sCols.forEach(col => {
    const cw2 = col.w*DW;
    parts.push(txt(cx2+3, hY, col.label, {sz:F.tiny, bold:true}));
    parts.push(ln(cx2, SCHED_Y+14, cx2, SCHED_Y+SCHED_H, {sw:SW_HAIR}));
    cx2 += cw2;
  });
  parts.push(ln(DX, hY+2, DX+DW, hY+2, {sw:SW_THIN}));

  type SR = {id:string;from:string;to:string;conductors:string;conduit:string;fill:number;amp:number;ocpd:number;vdrop:number;len:number;pass:boolean};
  let sRows: SR[] = [];

  if (input.runs && input.runs.length > 0) {
    sRows = input.runs.filter(r=>r.id!=='MSP_TO_UTILITY_RUN').map(r => {
      let cond = '';
      if (r.conductorBundle && r.conductorBundle.length > 0) {
        cond = r.conductorBundle.map((c:ConductorBundle) => {
          const g = c.gauge.replace('#','').replace(' AWG','');
          return `${c.qty}×#${g} ${c.insulation} ${c.color}`;
        }).join(' + ');
      } else if (r.conductorCallout) {
        cond = r.conductorCallout.replace(/\n/g,' + ').trim();
      } else {
        const g = r.wireGauge.replace('#','').replace(' AWG','');
        const eg = r.egcGauge.replace('#','').replace(' AWG','');
        cond = `${r.conductorCount}×#${g} ${r.insulation} + 1×#${eg} GND`;
      }
      return {
        id:r.id, from:r.from, to:r.to, conductors:cond,
        conduit:r.isOpenAir?'OPEN AIR':`${r.conduitType} ${r.conduitSize}`,
        fill:r.conduitFillPct??0,
        amp:Math.round((r.continuousCurrent??0)*100)/100,
        ocpd:r.ocpdAmps??0,
        vdrop:Math.round((r.voltageDropPct??0)*100)/100,
        len:r.onewayLengthFt??0,
        pass:r.overallPass??true,
      };
    });
  } else {
    sRows = isMicro ? [
      {id:'BR-1',from:'ROOF J-BOX',to:'AC COMBINER',conductors:`${resolvedAcWire} THWN-2 + 1×#10 GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:32,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:1.2,len:50,pass:true},
      {id:'A-1',from:'AC COMBINER',to:'AC DISCO',conductors:`${resolvedAcWire} THWN-2 + 1×#10 GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:32,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:1.4,len:20,pass:true},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${resolvedAcWire} THWN-2 + 1×#10 GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:32,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:1.4,len:15,pass:true},
    ] : [
      {id:'D-1',from:'PV ARRAY',to:'ROOF J-BOX',conductors:`${resolvedDcWire} USE-2 + 1×#10 GRN`,conduit:'OPEN AIR',fill:0,amp:30,ocpd:input.dcOCPD,vdrop:1.2,len:50,pass:true},
      {id:'D-2',from:'ROOF J-BOX',to:'DC DISCO',conductors:`${resolvedDcWire} USE-2 + 1×#10 GRN`,conduit:`${input.dcConduitType??'EMT'} 3/4"`,fill:28,amp:30,ocpd:input.dcOCPD,vdrop:1.2,len:20,pass:true},
      {id:'A-1',from:'INVERTER',to:'AC DISCO',conductors:`${resolvedAcWire} THWN-2 + 1×#10 GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:32,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:1.8,len:20,pass:true},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${resolvedAcWire} THWN-2 + 1×#10 GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:32,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:1.8,len:15,pass:true},
    ];
  }

  const maxRows = Math.floor((SCHED_H-30)/rH);
  sRows.slice(0, maxRows).forEach((row, ri) => {
    const ry = hY+4+(ri+1)*rH;
    if (ri%2===1) parts.push(rect(DX, ry-rH+2, DW, rH, {fill:LGY, stroke:'none', sw:0}));
    const pc = row.pass ? PASS : FAIL;
    const pv = row.pass ? '✓ PASS' : '✗ FAIL';
    const vals = [
      row.id, row.from, row.to, row.conductors, row.conduit,
      row.fill>0?`${row.fill.toFixed(1)}%`:(row.conduit==='OPEN AIR'?'N/A':'—'),
      row.amp>0?`${row.amp}A`:'—',
      row.ocpd>0?`${row.ocpd}A`:'—',
      row.vdrop>0?`${row.vdrop.toFixed(2)}%`:'—',
      row.len>0?`${row.len} FT`:'—',
      pv,
    ];
    let cx3 = DX;
    sCols.forEach((col,ci) => {
      const cw3 = col.w*DW;
      parts.push(txt(cx3+3, ry, String(vals[ci]??''), {sz:F.tiny, fill:ci===10?pc:BLK, bold:ci===10}));
      cx3 += cw3;
    });
  });

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  const tbX = TB_X, tbY = DY, tbH = DH;
  parts.push(rect(tbX, tbY, TB_W, tbH, {fill:WHT, stroke:BLK, sw:SW_HEAVY}));

  // Header
  parts.push(rect(tbX, tbY, TB_W, 38, {fill:BLK, sw:0}));
  parts.push(txt(tbX+TB_W/2, tbY+15, 'SOLARPRO', {sz:13, bold:true, anc:'middle', fill:WHT}));
  parts.push(txt(tbX+TB_W/2, tbY+28, 'ENGINEERING', {sz:F.tb, anc:'middle', fill:'#AAAAAA'}));

  // Drawing title
  parts.push(rect(tbX, tbY+38, TB_W, 30, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(tbX+TB_W/2, tbY+51, 'SINGLE LINE DIAGRAM', {sz:F.tbTitle, bold:true, anc:'middle'}));
  parts.push(txt(tbX+TB_W/2, tbY+63, 'PHOTOVOLTAIC SYSTEM', {sz:F.tb, anc:'middle'}));

  // Project info rows
  const tbRows: [string,string][] = [
    ['PROJECT',input.projectName],['CLIENT',input.clientName],
    ['ADDRESS',input.address],['DESIGNER',input.designer],
    ['DATE',input.drawingDate],['DWG NO.',input.drawingNumber],
    ['REVISION',input.revision],['SCALE',input.scale||'NOT TO SCALE'],
  ];
  let tbY2 = tbY+68;
  const tbRH = 20;
  tbRows.forEach(([l,v]) => {
    parts.push(rect(tbX, tbY2, TB_W, tbRH, {fill:WHT, stroke:BLK, sw:SW_HAIR}));
    parts.push(txt(tbX+4, tbY2+13, l, {sz:F.tiny, bold:true, fill:'#555'}));
    parts.push(txt(tbX+62, tbY2+13, esc(String(v??'')), {sz:F.tb}));
    tbY2 += tbRH;
  });

  // System summary
  const sysY = tbY2+3;
  parts.push(rect(tbX, sysY, TB_W, 12, {fill:BLK, sw:0}));
  parts.push(txt(tbX+TB_W/2, sysY+9, 'SYSTEM SUMMARY', {sz:F.sub, bold:true, anc:'middle', fill:WHT}));
  const sysRows: [string,string][] = [
    ['TOPOLOGY',input.topologyType.replace(/_/g,' ')],
    ['DC SIZE',`${dcKw.toFixed(2)} kW`],
    ['AC OUTPUT',`${input.acOutputKw} kW`],
    ['MODULES',`${input.totalModules} × ${input.panelWatts}W`],
    ['INVERTER',esc(input.inverterManufacturer)],
    ['MODEL',esc(input.inverterModel)],
    ['SERVICE',`${input.mainPanelAmps}A`],
    ['UTILITY',esc(input.utilityName)],
    ['INTERCONN.',esc(input.interconnection)],
  ];
  let sysY2 = sysY+12;
  const sysRH = 16;
  sysRows.forEach(([l,v]) => {
    parts.push(rect(tbX, sysY2, TB_W, sysRH, {fill:WHT, stroke:BLK, sw:SW_HAIR}));
    parts.push(txt(tbX+4, sysY2+11, l, {sz:F.tiny, bold:true, fill:'#555'}));
    parts.push(txt(tbX+70, sysY2+11, esc(String(v??'')), {sz:F.tb}));
    sysY2 += sysRH;
  });

  // Code references
  const codeY = sysY2+3;
  parts.push(rect(tbX, codeY, TB_W, 12, {fill:BLK, sw:0}));
  parts.push(txt(tbX+TB_W/2, codeY+9, 'CODE REFERENCES', {sz:F.sub, bold:true, anc:'middle', fill:WHT}));
  const codes = [
    '• NEC 690 — PV SYSTEMS',
    '• NEC 705 — INTERCONNECTED ELEC.',
    '• NEC 310 — CONDUCTORS',
    '• NEC 250 — GROUNDING/BONDING',
    '• NEC 358/352 — CONDUIT',
    '• NEC 230 — SERVICES',
    '• IBC / ASCE 7 — STRUCTURAL',
    '• IEEE 1547 — INTERCONNECTION',
  ];
  let codeY2 = codeY+12;
  codes.forEach(c => { parts.push(txt(tbX+4, codeY2+9, c, {sz:F.tiny})); codeY2+=12; });

  // Revisions
  const revY = codeY2+3;
  const revH = Math.min(80, tbY+tbH-revY-50);
  if (revH > 24) {
    parts.push(rect(tbX, revY, TB_W, 12, {fill:BLK, sw:0}));
    parts.push(txt(tbX+TB_W/2, revY+9, 'REVISIONS', {sz:F.sub, bold:true, anc:'middle', fill:WHT}));
    parts.push(rect(tbX, revY+12, TB_W, revH, {fill:WHT, stroke:BLK, sw:SW_THIN}));
    const rcw = TB_W/3;
    parts.push(txt(tbX+3, revY+22, 'REV', {sz:F.tiny, bold:true}));
    parts.push(txt(tbX+rcw+3, revY+22, 'DESCRIPTION', {sz:F.tiny, bold:true}));
    parts.push(txt(tbX+rcw*2+3, revY+22, 'DATE', {sz:F.tiny, bold:true}));
    parts.push(ln(tbX, revY+24, tbX+TB_W, revY+24, {sw:SW_HAIR}));
    parts.push(ln(tbX+rcw, revY+12, tbX+rcw, revY+revH, {sw:SW_HAIR}));
    parts.push(ln(tbX+rcw*2, revY+12, tbX+rcw*2, revY+revH, {sw:SW_HAIR}));
    parts.push(txt(tbX+3, revY+34, input.revision, {sz:F.tiny}));
    parts.push(txt(tbX+rcw+3, revY+34, 'INITIAL ISSUE', {sz:F.tiny}));
    parts.push(txt(tbX+rcw*2+3, revY+34, input.drawingDate, {sz:F.tiny}));
  }

  // Engineer seal
  const sealY = tbY+tbH-50;
  parts.push(rect(tbX, sealY, TB_W, 50, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(circ(tbX+TB_W/2, sealY+22, 18, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(tbX+TB_W/2, sealY+19, 'ENGINEER', {sz:F.tiny, anc:'middle', fill:'#888'}));
  parts.push(txt(tbX+TB_W/2, sealY+28, 'SEAL', {sz:F.tiny, anc:'middle', fill:'#888'}));
  parts.push(txt(tbX+TB_W/2, sealY+44, `${esc(input.designer)} — ${esc(input.drawingDate)}`, {sz:F.tiny, anc:'middle', fill:'#555'}));

  parts.push('</svg>');
  return parts.join('\n');
}