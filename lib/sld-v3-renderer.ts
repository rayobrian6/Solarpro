// ============================================================
// SLD V4 Renderer — Topology-Graph-Based, Permit-Grade
// ANSI C (24×18") landscape at 96 DPI = 2304×1728px
// Renders from topology graph — works for ANY topology
// IEEE 315 electrical symbols, NEC conductor labels
// No UI card appearance — true engineering drawing style
// ============================================================

import { SLDBuildInput } from './sld-types';
import { normalizeTopology, TopologyType } from './topology-engine';

// ─── Sheet Constants ──────────────────────────────────────────────────────────

const SHEET_W = 2304;
const SHEET_H = 1728;
const MARGIN  = 48;
const TITLE_H = 160;
const DRAW_X  = MARGIN;
const DRAW_Y  = MARGIN;
const DRAW_W  = SHEET_W - MARGIN * 2;
const DRAW_H  = SHEET_H - MARGIN * 2 - TITLE_H;

// ─── Color Palette (engineering drawing style) ────────────────────────────────

const C = {
  bg:      '#FFFFFF',
  border:  '#000000',
  dc:      '#CC2200',    // DC conductors — red
  ac:      '#003399',    // AC conductors — blue
  gnd:     '#006600',    // Grounding — green
  equip:   '#111111',    // Equipment outlines
  fill:    '#F8F8F8',    // Equipment fill
  fillDC:  '#FFF5F0',    // DC zone fill
  fillAC:  '#F0F4FF',    // AC zone fill
  fillGND: '#F0FFF0',    // Grounding zone fill
  text:    '#000000',
  textSub: '#333333',
  textRef: '#555555',
  titleBg: '#0F1E3C',
  titleFg: '#FFFFFF',
  gridLine:'#DDDDDD',
  stageBdr:['#B87000','#CC2200','#003399','#0055AA','#5500BB','#006622','#444444'],
  stageBg: ['#FFFBF0','#FFF5F0','#F0F4FF','#F0F7FF','#F5F0FF','#F0FFF0','#F8F8F8'],
};

const F = {
  title:    20,
  stageHdr: 11,
  compName: 12,
  compSub:  10,
  label:    9,
  tiny:     8,
  ref:      8,
};

// ─── SVG Primitives ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function rect(x: number, y: number, w: number, h: number,
  o: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string } = {}): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.fill ?? 'none'}" stroke="${o.stroke ?? C.equip}" stroke-width="${o.sw ?? 1}" rx="${o.rx ?? 0}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number,
  o: { stroke?: string; sw?: number; dash?: string } = {}): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke ?? C.equip}" stroke-width="${o.sw ?? 1.5}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
}

function circle(cx: number, cy: number, r: number,
  o: { fill?: string; stroke?: string; sw?: number } = {}): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${o.fill ?? 'none'}" stroke="${o.stroke ?? C.equip}" stroke-width="${o.sw ?? 1.5}"/>`;
}

function text(x: number, y: number, s: string,
  o: { size?: number; fill?: string; anchor?: string; weight?: string; italic?: boolean; dy?: number } = {}): string {
  const style = o.italic ? ' font-style="italic"' : '';
  const dy = o.dy !== undefined ? ` dy="${o.dy}"` : '';
  return `<text x="${x}" y="${y}" font-size="${o.size ?? F.compSub}" fill="${o.fill ?? C.text}" text-anchor="${o.anchor ?? 'middle'}" font-weight="${o.weight ?? 'normal'}" font-family="Arial,Helvetica,sans-serif"${style}${dy}>${esc(s)}</text>`;
}

function path(d: string, o: { stroke?: string; sw?: number; fill?: string; dash?: string } = {}): string {
  return `<path d="${d}" stroke="${o.stroke ?? C.equip}" stroke-width="${o.sw ?? 1.5}" fill="${o.fill ?? 'none'}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
}

// Arrow-tipped line
function arrowLine(x1: number, y1: number, x2: number, y2: number, color: string, sw = 2): string {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return '';
  const ux = dx / len, uy = dy / len;
  const ax = x2 - ux * 10, ay = y2 - uy * 10;
  return line(x1, y1, x2, y2, { stroke: color, sw })
    + `<polygon points="${x2},${y2} ${ax - uy * 5},${ay + ux * 5} ${ax + uy * 5},${ay - ux * 5}" fill="${color}" stroke="none"/>`;
}

// Elbow connector (horizontal then vertical then horizontal)
function elbowH(x1: number, y1: number, x2: number, y2: number, color: string, sw = 2): string {
  const mx = (x1 + x2) / 2;
  return line(x1, y1, mx, y1, { stroke: color, sw })
    + line(mx, y1, mx, y2, { stroke: color, sw })
    + arrowLine(mx, y2, x2, y2, color, sw);
}

// Conductor label (box with text)
function conductorLabel(x: number, y: number, label: string, color: string): string {
  const w = Math.max(80, label.length * 6 + 12);
  return rect(x - w / 2, y - 10, w, 20, { fill: '#FFFFFF', stroke: color, sw: 1, rx: 3 })
    + text(x, y + 4, label, { size: F.label, fill: color, anchor: 'middle', weight: 'bold' });
}

// ─── IEEE Electrical Symbols ──────────────────────────────────────────────────

// PV Module symbol (rectangle with diagonal)
function symPVModule(cx: number, cy: number, w = 60, h = 36): string {
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#E8F4E8', stroke: C.equip, sw: 1.5 })
    + line(x, y, x + w, y + h, { stroke: C.equip, sw: 1 })
    + text(cx, cy + 4, 'PV', { size: F.tiny, fill: C.equip, weight: 'bold' });
}

// Optimizer symbol (rectangle with "OPT")
function symOptimizer(cx: number, cy: number): string {
  const w = 44, h = 28;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#FFF0E0', stroke: '#884400', sw: 1.5, rx: 4 })
    + text(cx, cy + 4, 'OPT', { size: F.tiny, fill: '#884400', weight: 'bold' });
}

// String inverter symbol (rectangle with sine wave)
function symStringInverter(cx: number, cy: number, w = 80, h = 60): string {
  const x = cx - w / 2, y = cy - h / 2;
  const mx = cx, my = cy;
  // Sine wave path
  const sineW = 40, sineH = 10;
  const sx = mx - sineW / 2;
  const sinePath = `M${sx},${my} C${sx + 10},${my - sineH} ${sx + 20},${my + sineH} ${sx + sineW / 2},${my} C${sx + sineW / 2 + 10},${my - sineH} ${sx + sineW - 10},${my + sineH} ${sx + sineW},${my}`;
  return rect(x, y, w, h, { fill: '#F0F4FF', stroke: C.ac, sw: 2, rx: 4 })
    + path(sinePath, { stroke: C.ac, sw: 1.5 })
    + text(cx, y + h + 14, 'INVERTER', { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// Microinverter symbol (small rectangle with ~)
function symMicroinverter(cx: number, cy: number): string {
  const w = 44, h = 32;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#F0F4FF', stroke: C.ac, sw: 1.5, rx: 3 })
    + text(cx, cy - 2, '~', { size: 16, fill: C.ac, weight: 'bold' })
    + text(cx, cy + 10, 'μINV', { size: F.tiny, fill: C.ac });
}

// Disconnect switch symbol (IEEE — open blade)
function symDisconnect(cx: number, cy: number, label = 'DISC'): string {
  const w = 48, h = 40;
  const x = cx - w / 2, y = cy - h / 2;
  // Open blade symbol
  return rect(x, y, w, h, { fill: '#FFFFF0', stroke: C.equip, sw: 1.5 })
    + line(cx - 12, cy + 8, cx - 12, cy - 8, { stroke: C.equip, sw: 2 })
    + line(cx + 12, cy + 8, cx + 12, cy - 8, { stroke: C.equip, sw: 2 })
    + line(cx - 12, cy - 8, cx + 8, cy - 16, { stroke: C.equip, sw: 2 })
    + text(cx, y + h + 14, label, { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// OCPD / Breaker symbol (rectangle with X)
function symOCPD(cx: number, cy: number, amps: string, label = 'OCPD'): string {
  const w = 44, h = 32;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#FFF8F0', stroke: '#884400', sw: 1.5 })
    + line(x + 6, y + 6, x + w - 6, y + h - 6, { stroke: '#884400', sw: 1.5 })
    + line(x + w - 6, y + 6, x + 6, y + h - 6, { stroke: '#884400', sw: 1.5 })
    + text(cx, y - 6, amps, { size: F.tiny, fill: '#884400', weight: 'bold' })
    + text(cx, y + h + 12, label, { size: F.tiny, fill: C.textSub });
}

// Meter symbol (circle with M)
function symMeter(cx: number, cy: number, label = 'METER'): string {
  return circle(cx, cy, 22, { fill: '#F8F8FF', stroke: C.ac, sw: 2 })
    + text(cx, cy + 5, 'M', { size: 16, fill: C.ac, weight: 'bold' })
    + text(cx, cy + 34, label, { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// Service panel symbol (rectangle with bus bars)
function symServicePanel(cx: number, cy: number, w = 80, h = 100): string {
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#F8F8F8', stroke: C.equip, sw: 2 })
    + rect(x + 8, y + 8, w - 16, 16, { fill: '#DDDDDD', stroke: C.equip, sw: 1 })
    + line(cx, y + 24, cx, y + h - 8, { stroke: C.equip, sw: 2 })
    + line(cx - 16, y + 40, cx + 16, y + 40, { stroke: C.equip, sw: 1.5 })
    + line(cx - 16, y + 56, cx + 16, y + 56, { stroke: C.equip, sw: 1.5 })
    + line(cx - 16, y + 72, cx + 16, y + 72, { stroke: C.equip, sw: 1.5 })
    + text(cx, y + 16, 'MSP', { size: F.tiny, fill: C.equip, weight: 'bold' })
    + text(cx, y + h + 14, 'SERVICE PANEL', { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// Utility meter symbol
function symUtilityMeter(cx: number, cy: number): string {
  return circle(cx, cy, 26, { fill: '#F0FFF0', stroke: C.gnd, sw: 2 })
    + text(cx, cy + 5, 'kWh', { size: F.tiny, fill: C.gnd, weight: 'bold' })
    + text(cx, cy + 38, 'UTILITY METER', { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// Ground electrode symbol
function symGround(cx: number, cy: number): string {
  return line(cx, cy - 16, cx, cy + 4, { stroke: C.gnd, sw: 2 })
    + line(cx - 16, cy + 4, cx + 16, cy + 4, { stroke: C.gnd, sw: 2 })
    + line(cx - 10, cy + 10, cx + 10, cy + 10, { stroke: C.gnd, sw: 2 })
    + line(cx - 4, cy + 16, cx + 4, cy + 16, { stroke: C.gnd, sw: 2 })
    + text(cx, cy + 28, 'GES', { size: F.tiny, fill: C.gnd, weight: 'bold' });
}

// Rapid shutdown symbol
function symRSD(cx: number, cy: number): string {
  const w = 44, h = 32;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#FFF0F0', stroke: '#CC0000', sw: 1.5, rx: 4 })
    + text(cx, cy + 4, 'RSD', { size: F.tiny, fill: '#CC0000', weight: 'bold' })
    + text(cx, y + h + 12, 'NEC 690.12', { size: F.ref, fill: C.textRef });
}

// Gateway/monitoring symbol
function symGateway(cx: number, cy: number, brand = ''): string {
  const w = 56, h = 36;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#F0F8FF', stroke: '#0055AA', sw: 1.5, rx: 4 })
    + text(cx, cy - 2, 'GW', { size: F.tiny, fill: '#0055AA', weight: 'bold' })
    + text(cx, cy + 10, brand || 'GATEWAY', { size: F.ref, fill: '#0055AA' });
}

// Combiner box symbol
function symCombiner(cx: number, cy: number): string {
  const w = 56, h = 44;
  const x = cx - w / 2, y = cy - h / 2;
  return rect(x, y, w, h, { fill: '#FFF8F0', stroke: '#884400', sw: 1.5 })
    + line(cx - 16, y + 12, cx - 16, y + h - 12, { stroke: '#884400', sw: 1.5 })
    + line(cx, y + 12, cx, y + h - 12, { stroke: '#884400', sw: 1.5 })
    + line(cx + 16, y + 12, cx + 16, y + h - 12, { stroke: '#884400', sw: 1.5 })
    + line(cx - 16, cy, cx + 16, cy, { stroke: '#884400', sw: 2 })
    + text(cx, y + h + 12, 'COMBINER', { size: F.tiny, fill: C.textSub, weight: 'bold' });
}

// ─── Stage Layout ─────────────────────────────────────────────────────────────

interface StageLayout {
  idx: number;
  label: string;
  sub: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;  // center x
  cy: number;  // center y (component zone)
}

function buildStageLayouts(stageCount: number): StageLayout[] {
  const stageW = Math.floor(DRAW_W / stageCount);
  const headerH = 40;
  const stages: StageLayout[] = [];

  // PHASE 6: Stage labels — PV Array → Inverter → Disconnect → Meter → Service → Utility
  const stageLabels = [
    ['PV ARRAY', 'Modules + Optimizers (DC Source)'],
    ['INVERTER', 'String / Micro / Optimizer'],
    ['DISCONNECT', 'AC Disconnect + OCPD'],
    ['METER', 'Production Meter + AC Run'],
    ['SERVICE', 'Main Service Panel (120% Rule)'],
    ['UTILITY', 'Utility Meter + Grid + GES'],
  ];

  for (let i = 0; i < stageCount; i++) {
    const x = DRAW_X + i * stageW;
    const y = DRAW_Y;
    const h = DRAW_H;
    stages.push({
      idx: i,
      label: stageLabels[i]?.[0] ?? `STAGE ${i + 1}`,
      sub: stageLabels[i]?.[1] ?? '',
      x, y, w: stageW, h,
      cx: x + stageW / 2,
      cy: y + headerH + (h - headerH) / 2,
    });
  }
  return stages;
}

function drawStageBackground(s: StageLayout): string {
  const headerH = 40;
  const color = C.stageBdr[s.idx] ?? '#444444';
  const bg = C.stageBg[s.idx] ?? '#F8F8F8';
  return rect(s.x, s.y, s.w, s.h, { fill: bg, stroke: color, sw: 1.5 })
    + rect(s.x, s.y, s.w, headerH, { fill: color, stroke: 'none' })
    + text(s.cx, s.y + 15, `STAGE ${s.idx + 1} — ${s.label}`, { size: F.stageHdr, fill: '#FFFFFF', weight: 'bold' })
    + text(s.cx, s.y + 29, s.sub, { size: F.ref, fill: 'rgba(255,255,255,0.8)' });
}

// ─── Main SLD Renderer ────────────────────────────────────────────────────────

export function renderSLDV3(input: SLDBuildInput): string {
  const topology = normalizeTopology((input.topologyType ?? 'STRING_INVERTER') as TopologyType);
  const isMicro = topology === 'MICROINVERTER' || topology === 'AC_COUPLED_BATTERY';
  const isOptimizer = topology === 'STRING_WITH_OPTIMIZER' || topology === 'HYBRID_INVERTER' || topology === 'DC_COUPLED_BATTERY';
  const hasBattery = topology === 'DC_COUPLED_BATTERY' || topology === 'AC_COUPLED_BATTERY' || topology === 'HYBRID_INVERTER';

  const stageCount = 6;
  const stages = buildStageLayouts(stageCount);
  const parts: string[] = [];

  // ── Sheet background ──────────────────────────────────────────────────────
  parts.push(rect(0, 0, SHEET_W, SHEET_H, { fill: C.bg, stroke: 'none' }));

  // ── Grid lines (engineering drawing style) ────────────────────────────────
  for (let x = MARGIN; x <= SHEET_W - MARGIN; x += 96) {
    parts.push(line(x, MARGIN, x, SHEET_H - MARGIN - TITLE_H, { stroke: C.gridLine, sw: 0.5, dash: '2,4' }));
  }

  // ── Stage backgrounds ─────────────────────────────────────────────────────
  for (const s of stages) {
    parts.push(drawStageBackground(s));
  }

  // ── Stage border (outer) ──────────────────────────────────────────────────
  parts.push(rect(DRAW_X, DRAW_Y, DRAW_W, DRAW_H, { fill: 'none', stroke: C.border, sw: 2 }));

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 0 — ARRAY
  // ─────────────────────────────────────────────────────────────────────────
  const s0 = stages[0];
  const totalPanels = input.totalPanels ?? 20;
  const totalStrings = input.totalStrings ?? 2;
  const panelModel = input.panelModel ?? 'PV Module';
  const panelWatts = input.panelWatts ?? 400;
  const panelsPerString = Math.round(totalPanels / totalStrings);

  // Draw string representations (up to 3 strings shown, rest summarized)
  const shownStrings = Math.min(totalStrings, 3);
  const stringSpacing = (s0.h - 80) / (shownStrings + 1);

  for (let si = 0; si < shownStrings; si++) {
    const sy = s0.y + 50 + stringSpacing * (si + 1);
    const sx = s0.cx;

    // Module stack representation
    parts.push(symPVModule(sx, sy));

    // String label
    parts.push(text(sx, sy - 26, `String ${si + 1}`, { size: F.label, fill: C.textSub, weight: 'bold' }));
    parts.push(text(sx, sy + 30, `${panelsPerString} × ${panelWatts}W`, { size: F.ref, fill: C.textRef }));

    // Optimizer if applicable
    if (isOptimizer) {
      parts.push(symOptimizer(sx, sy + 52));
      parts.push(text(sx, sy + 72, '1:1 per module', { size: F.ref, fill: '#884400' }));
    }
  }

  if (totalStrings > 3) {
    parts.push(text(s0.cx, s0.y + s0.h - 30,
      `+ ${totalStrings - 3} more strings`, { size: F.label, fill: C.textRef, italic: true }));
  }

  // Array summary box
  parts.push(rect(s0.x + 8, s0.y + s0.h - 60, s0.w - 16, 50,
    { fill: '#FFFFF8', stroke: C.stageBdr[0], sw: 1, rx: 3 }));
  parts.push(text(s0.cx, s0.y + s0.h - 44,
    `${totalPanels} Modules × ${panelWatts}W = ${(totalPanels * panelWatts / 1000).toFixed(1)} kWp`,
    { size: F.label, fill: C.textSub, weight: 'bold' }));
  parts.push(text(s0.cx, s0.y + s0.h - 30,
    panelModel, { size: F.ref, fill: C.textRef }));
  parts.push(text(s0.cx, s0.y + s0.h - 18,
    `Voc: ${input.panelVoc ?? 49.5}V  Isc: ${input.panelIsc ?? 10.2}A`,
    { size: F.ref, fill: C.textRef }));

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 1 — DC RUN
  // ─────────────────────────────────────────────────────────────────────────
  const s1 = stages[1];
  const dcWireGauge = input.dcWireGauge ?? '#10 AWG';
  const dcOCPD = input.dcOCPD ?? 20;
  const stringVoc = (input.panelVoc ?? 49.5) * panelsPerString;
  const stringIsc = input.panelIsc ?? 10.2;

  if (!isMicro) {
    // DC conductor label
    parts.push(conductorLabel(s1.cx, s1.cy - 120,
      `${dcWireGauge} USE-2/PV Wire`, C.dc));
    parts.push(text(s1.cx, s1.cy - 100,
      `Voc: ${stringVoc.toFixed(0)}V  Isc: ${stringIsc.toFixed(1)}A`,
      { size: F.ref, fill: C.dc }));

    // OCPD
    parts.push(symOCPD(s1.cx, s1.cy - 40, `${dcOCPD}A`, 'DC OCPD'));
    parts.push(text(s1.cx, s1.cy - 8, 'NEC 690.9', { size: F.ref, fill: C.textRef }));

    // DC Disconnect
    parts.push(symDisconnect(s1.cx, s1.cy + 60, 'DC DISC'));
    parts.push(text(s1.cx, s1.cy + 100, 'NEC 690.15', { size: F.ref, fill: C.textRef }));

    // Rapid Shutdown (if not optimizer/micro)
    if (!isOptimizer) {
      parts.push(symRSD(s1.cx, s1.cy + 140));
    }

    // DC conductor lines
    parts.push(line(s1.cx, s1.cy - 160, s1.cx, s1.cy - 56, { stroke: C.dc, sw: 2 }));
    parts.push(line(s1.cx, s1.cy - 24, s1.cx, s1.cy + 40, { stroke: C.dc, sw: 2 }));
    parts.push(line(s1.cx, s1.cy + 80, s1.cx, s1.cy + 120, { stroke: C.dc, sw: 2 }));
  } else {
    // Microinverter — AC branch wiring
    parts.push(conductorLabel(s1.cx, s1.cy - 60, 'Q-Cable / AC Branch', C.ac));
    parts.push(text(s1.cx, s1.cy - 40, `${totalStrings} AC branches`, { size: F.label, fill: C.ac }));
    parts.push(symCombiner(s1.cx, s1.cy + 40));
    parts.push(text(s1.cx, s1.cy + 80, 'IQ Combiner', { size: F.ref, fill: C.textRef }));
    parts.push(text(s1.cx, s1.cy + 92, 'NEC 690.4', { size: F.ref, fill: C.textRef }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 2 — INVERTER
  // ─────────────────────────────────────────────────────────────────────────
  const s2 = stages[2];
  const invModel = input.inverterModel ?? 'String Inverter';
  const invMfr = input.inverterManufacturer ?? '';
  const acOutputKw = input.acOutputKw ?? 7.6;
  const acOutputAmps = (acOutputKw * 1000 / 240).toFixed(1);

  if (isMicro) {
    // Microinverter array representation
    parts.push(symMicroinverter(s2.cx, s2.cy - 40));
    parts.push(text(s2.cx, s2.cy - 10, `${totalPanels}× microinverters`, { size: F.label, fill: C.ac }));
    parts.push(text(s2.cx, s2.cy + 4, `${invMfr} ${invModel}`, { size: F.ref, fill: C.textRef }));
    parts.push(text(s2.cx, s2.cy + 18, `${(acOutputKw * totalPanels).toFixed(1)} kW AC total`, { size: F.ref, fill: C.textRef }));
  } else {
    // String inverter
    parts.push(symStringInverter(s2.cx, s2.cy - 20));
    parts.push(text(s2.cx, s2.cy + 60, `${invMfr}`, { size: F.label, fill: C.textSub, weight: 'bold' }));
    parts.push(text(s2.cx, s2.cy + 74, invModel, { size: F.ref, fill: C.textRef }));
    parts.push(text(s2.cx, s2.cy + 88, `${acOutputKw} kW AC / ${acOutputAmps}A`, { size: F.ref, fill: C.ac }));

    // DC input label
    parts.push(text(s2.cx, s2.cy - 90, 'DC INPUT', { size: F.ref, fill: C.dc, weight: 'bold' }));
    parts.push(line(s2.cx, s2.cy - 80, s2.cx, s2.cy - 50, { stroke: C.dc, sw: 2 }));

    // AC output label
    parts.push(text(s2.cx, s2.cy + 110, 'AC OUTPUT', { size: F.ref, fill: C.ac, weight: 'bold' }));
    parts.push(line(s2.cx, s2.cy + 50, s2.cx, s2.cy + 120, { stroke: C.ac, sw: 2 }));
  }

  // Gateway (if optimizer or micro)
  if (isOptimizer || isMicro) {
    const gwBrand = invMfr;
    parts.push(symGateway(s2.cx, s2.cy + 140, gwBrand));
    parts.push(text(s2.cx, s2.cy + 168, 'Monitoring Gateway', { size: F.ref, fill: C.textRef }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 3 — AC RUN
  // ─────────────────────────────────────────────────────────────────────────
  const s3 = stages[3];
  const acWireGauge = input.acWireGauge ?? '#8 AWG';
  const acOCPD = input.acOCPD ?? 40;
  const conduitType = input.conduitType ?? 'EMT';
  const acWireLength = input.acWireLength ?? 50;

  // PHASE 6: AC conductor label — prominent conductor size + breaker size display
  parts.push(conductorLabel(s3.cx, s3.cy - 120, `${acWireGauge} THWN-2`, C.ac));
  parts.push(text(s3.cx, s3.cy - 100,
    `${conduitType} conduit, ${acWireLength}ft run`, { size: F.ref, fill: C.ac }));
  parts.push(text(s3.cx, s3.cy - 88,
    `240V / ${acOutputAmps}A`, { size: F.ref, fill: C.ac }));
  // Conductor + breaker callout box (Phase 6 — prominent display)
  parts.push(rect(s3.x + 6, s3.y + 44, s3.w - 12, 36,
    { fill: '#F0F8FF', stroke: C.ac, sw: 1, rx: 3 }));
  parts.push(text(s3.cx, s3.y + 57, `Conductor: ${acWireGauge} THWN-2`,
    { size: F.label, fill: C.ac, weight: 'bold' }));
  parts.push(text(s3.cx, s3.y + 71, `Breaker: ${acOCPD}A / Inverter: ${invMfr} ${invModel}`,
    { size: F.ref, fill: C.textSub }));

  // AC OCPD
  parts.push(symOCPD(s3.cx, s3.cy - 40, `${acOCPD}A`, 'AC OCPD'));
  parts.push(text(s3.cx, s3.cy - 8, 'NEC 690.9', { size: F.ref, fill: C.textRef }));

  // AC Disconnect
  parts.push(symDisconnect(s3.cx, s3.cy + 60, 'AC DISC'));
  parts.push(text(s3.cx, s3.cy + 100, 'NEC 690.14', { size: F.ref, fill: C.textRef }));

  // Production meter
  if (input.productionMeter) {
    parts.push(symMeter(s3.cx, s3.cy + 150, 'PROD METER'));
    parts.push(text(s3.cx, s3.cy + 186, 'NEC 690.54', { size: F.ref, fill: C.textRef }));
  }

  // AC conductor lines
  parts.push(line(s3.cx, s3.cy - 160, s3.cx, s3.cy - 56, { stroke: C.ac, sw: 2 }));
  parts.push(line(s3.cx, s3.cy - 24, s3.cx, s3.cy + 40, { stroke: C.ac, sw: 2 }));
  parts.push(line(s3.cx, s3.cy + 80, s3.cx, s3.cy + 120, { stroke: C.ac, sw: 2 }));

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 4 — INTERCONNECTION
  // ─────────────────────────────────────────────────────────────────────────
  const s4 = stages[4];
  const mainPanelAmps = input.mainPanelAmps ?? 200;
  const backfeedAmps = input.backfeedAmps ?? 40;
  const mainPanelBrand = input.mainPanelBrand ?? 'Square D';

  // Service panel
  parts.push(symServicePanel(s4.cx, s4.cy - 20));

  // Panel info
  parts.push(text(s4.cx, s4.cy + 70, `${mainPanelAmps}A Main Panel`, { size: F.label, fill: C.textSub, weight: 'bold' }));
  parts.push(text(s4.cx, s4.cy + 84, mainPanelBrand, { size: F.ref, fill: C.textRef }));

  // Backfeed breaker
  parts.push(rect(s4.cx - 28, s4.cy + 100, 56, 28,
    { fill: '#FFF8F0', stroke: '#884400', sw: 1.5, rx: 3 }));
  parts.push(text(s4.cx, s4.cy + 118, `${backfeedAmps}A Backfeed`, { size: F.tiny, fill: '#884400', weight: 'bold' }));
  parts.push(text(s4.cx, s4.cy + 140, 'NEC 705.12', { size: F.ref, fill: C.textRef }));

  // Busbar rule
  const busBudget = mainPanelAmps * 1.2;
  const busUsed = backfeedAmps + (mainPanelAmps * 0.8); // simplified
  parts.push(rect(s4.x + 8, s4.y + s4.h - 56, s4.w - 16, 46,
    { fill: '#FFFFF8', stroke: C.stageBdr[4], sw: 1, rx: 3 }));
  parts.push(text(s4.cx, s4.y + s4.h - 42,
    `Bus: ${busBudget.toFixed(0)}A budget`, { size: F.ref, fill: C.textSub }));
  parts.push(text(s4.cx, s4.y + s4.h - 30,
    `Backfeed: ${backfeedAmps}A (NEC 705.12)`, { size: F.ref, fill: C.textRef }));
  parts.push(text(s4.cx, s4.y + s4.h - 18,
    `120% Rule: ${(backfeedAmps + mainPanelAmps).toFixed(0)}A ≤ ${busBudget.toFixed(0)}A`,
    { size: F.ref, fill: busUsed <= busBudget ? '#006600' : '#CC0000' }));

  // AC line to panel
  parts.push(line(s4.cx, s4.cy - 70, s4.cx, s4.cy - 20, { stroke: C.ac, sw: 2 }));

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 5 — UTILITY
  // ─────────────────────────────────────────────────────────────────────────
  const s5 = stages[5];

  // Utility meter
  parts.push(symUtilityMeter(s5.cx, s5.cy - 80));

  // Grid connection
  parts.push(rect(s5.cx - 36, s5.cy - 20, 72, 32,
    { fill: '#F0FFF0', stroke: C.gnd, sw: 1.5, rx: 4 }));
  parts.push(text(s5.cx, s5.cy - 2, 'GRID', { size: F.label, fill: C.gnd, weight: 'bold' }));
  parts.push(text(s5.cx, s5.cy + 10, '120/240V 60Hz', { size: F.ref, fill: C.textRef }));

  // Ground electrode system
  parts.push(symGround(s5.cx, s5.cy + 80));
  parts.push(text(s5.cx, s5.cy + 120, '5/8"×8ft Ground Rod', { size: F.ref, fill: C.textRef }));
  parts.push(text(s5.cx, s5.cy + 132, 'NEC 250.52', { size: F.ref, fill: C.textRef }));

  // Grounding conductor
  parts.push(conductorLabel(s5.cx, s5.cy + 160, '#6 AWG Bare Cu (GEC)', C.gnd));
  parts.push(text(s5.cx, s5.cy + 178, 'NEC 690.47', { size: F.ref, fill: C.textRef }));

  // Lines
  parts.push(line(s5.cx, s5.cy - 106, s5.cx, s5.cy - 20, { stroke: C.ac, sw: 2 }));
  parts.push(line(s5.cx, s5.cy + 12, s5.cx, s5.cy + 60, { stroke: C.gnd, sw: 2, dash: '4,3' }));

  // ─────────────────────────────────────────────────────────────────────────
  // INTER-STAGE CONNECTIONS
  // ─────────────────────────────────────────────────────────────────────────

  // PHASE 6: Orthogonal routing — use elbowH (horizontal→vertical→horizontal)
  // No diagonal edges. All inter-stage connections are right-angle only.

  // Stage 0 → Stage 1 (DC or AC branch) — orthogonal elbow
  const connColor = isMicro ? C.ac : C.dc;
  parts.push(elbowH(s0.x + s0.w, s0.cy, s1.x, s1.cy, connColor, 2));

  // Stage 1 → Stage 2 — orthogonal elbow
  if (!isMicro) {
    parts.push(elbowH(s1.x + s1.w, s1.cy, s2.x, s2.cy, C.dc, 2));
  } else {
    parts.push(elbowH(s1.x + s1.w, s1.cy, s2.x, s2.cy, C.ac, 2));
  }

  // Stage 2 → Stage 3 (AC) — orthogonal elbow
  parts.push(elbowH(s2.x + s2.w, s2.cy, s3.x, s3.cy, C.ac, 2));

  // Stage 3 → Stage 4 (AC) — orthogonal elbow
  parts.push(elbowH(s3.x + s3.w, s3.cy, s4.x, s4.cy, C.ac, 2));

  // Stage 4 → Stage 5 (AC + GND) — orthogonal elbow
  parts.push(elbowH(s4.x + s4.w, s4.cy, s5.x, s5.cy, C.ac, 2));
  // Grounding run — straight horizontal (same Y level)
  parts.push(line(s4.x + s4.w, s4.cy + 80, s5.x, s5.cy + 80, { stroke: C.gnd, sw: 1.5, dash: '4,3' }));

  // ─────────────────────────────────────────────────────────────────────────
  // TITLE BLOCK
  // ─────────────────────────────────────────────────────────────────────────
  const titleY = SHEET_H - MARGIN - TITLE_H;

  parts.push(rect(MARGIN, titleY, DRAW_W, TITLE_H, { fill: C.titleBg, stroke: C.border, sw: 2 }));

  // Title block dividers
  const col1 = MARGIN + DRAW_W * 0.35;
  const col2 = MARGIN + DRAW_W * 0.60;
  const col3 = MARGIN + DRAW_W * 0.80;
  parts.push(line(col1, titleY, col1, titleY + TITLE_H, { stroke: 'rgba(255,255,255,0.3)', sw: 1 }));
  parts.push(line(col2, titleY, col2, titleY + TITLE_H, { stroke: 'rgba(255,255,255,0.3)', sw: 1 }));
  parts.push(line(col3, titleY, col3, titleY + TITLE_H, { stroke: 'rgba(255,255,255,0.3)', sw: 1 }));
  parts.push(line(MARGIN, titleY + TITLE_H / 2, MARGIN + DRAW_W, titleY + TITLE_H / 2,
    { stroke: 'rgba(255,255,255,0.2)', sw: 1 }));

  // Project info
  const projectName = input.projectName ?? 'Residential PV System';
  const address = input.address ?? '';
  const drawingDate = input.drawingDate ?? new Date().toLocaleDateString();

  parts.push(text(MARGIN + 20, titleY + 28, 'SINGLE LINE DIAGRAM', { size: F.title, fill: '#FFFFFF', weight: 'bold', anchor: 'start' }));
  parts.push(text(MARGIN + 20, titleY + 48, 'Photovoltaic System — NEC 690 / IEEE 1547', { size: F.compSub, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));
  parts.push(text(MARGIN + 20, titleY + 72, projectName, { size: F.compName, fill: '#FFFFFF', anchor: 'start', weight: 'bold' }));
  parts.push(text(MARGIN + 20, titleY + 90, address, { size: F.label, fill: 'rgba(255,255,255,0.7)', anchor: 'start' }));

  // System summary
  const summaryX = col1 + 20;
  parts.push(text(summaryX, titleY + 24, 'SYSTEM SUMMARY', { size: F.label, fill: 'rgba(255,255,255,0.6)', anchor: 'start', weight: 'bold' }));
  parts.push(text(summaryX, titleY + 42, `DC Capacity: ${(totalPanels * panelWatts / 1000).toFixed(2)} kWp`, { size: F.compSub, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(summaryX, titleY + 58, `AC Output: ${acOutputKw.toFixed(1)} kW`, { size: F.compSub, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(summaryX, titleY + 74, `Topology: ${topology.replace(/_/g, ' ')}`, { size: F.label, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));
  parts.push(text(summaryX, titleY + 90, `Modules: ${totalPanels} × ${panelWatts}W (${totalStrings} strings)`, { size: F.label, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));
  parts.push(text(summaryX, titleY + 106, `Inverter: ${invMfr} ${invModel}`, { size: F.label, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));

  // Drawing info
  const drawX = col2 + 20;
  parts.push(text(drawX, titleY + 24, 'DRAWING INFO', { size: F.label, fill: 'rgba(255,255,255,0.6)', anchor: 'start', weight: 'bold' }));
  parts.push(text(drawX, titleY + 42, `Date: ${drawingDate}`, { size: F.label, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(drawX, titleY + 58, 'Scale: NTS', { size: F.label, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(drawX, titleY + 74, 'Sheet: E-1 of 1', { size: F.label, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(drawX, titleY + 90, 'Code: NEC 2023 / IBC 2021', { size: F.label, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));
  parts.push(text(drawX, titleY + 106, 'ASCE 7-22 / IEEE 1547-2018', { size: F.label, fill: 'rgba(255,255,255,0.8)', anchor: 'start' }));

  // Legend
  const legX = col3 + 20;
  parts.push(text(legX, titleY + 24, 'LEGEND', { size: F.label, fill: 'rgba(255,255,255,0.6)', anchor: 'start', weight: 'bold' }));
  parts.push(line(legX, titleY + 38, legX + 30, titleY + 38, { stroke: C.dc, sw: 2 }));
  parts.push(text(legX + 36, titleY + 42, 'DC Conductor', { size: F.ref, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(line(legX, titleY + 54, legX + 30, titleY + 54, { stroke: C.ac, sw: 2 }));
  parts.push(text(legX + 36, titleY + 58, 'AC Conductor', { size: F.ref, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(line(legX, titleY + 70, legX + 30, titleY + 70, { stroke: C.gnd, sw: 2, dash: '4,3' }));
  parts.push(text(legX + 36, titleY + 74, 'Grounding', { size: F.ref, fill: '#FFFFFF', anchor: 'start' }));
  parts.push(text(legX, titleY + 90, `Generated: SolarPro V3.2`, { size: F.ref, fill: 'rgba(255,255,255,0.5)', anchor: 'start' }));

  // ── Outer border ──────────────────────────────────────────────────────────
  parts.push(rect(MARGIN / 2, MARGIN / 2, SHEET_W - MARGIN, SHEET_H - MARGIN,
    { fill: 'none', stroke: C.border, sw: 3 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W}" height="${SHEET_H}" viewBox="0 0 ${SHEET_W} ${SHEET_H}">\n`
    + `<defs><style>text{font-family:Arial,Helvetica,sans-serif;}</style></defs>\n`
    + parts.join('\n')
    + '\n</svg>';
}