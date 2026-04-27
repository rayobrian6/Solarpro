// ============================================================
// SLD Symbol System — Hybrid Realism v3.0
// IEEE 315 / ANSI Y32.9 / NEC-aligned
//
// HYBRID REALISM STANDARD:
//   REALISTIC style  → PV Array, Inverter, Battery, Combiner, Generator
//                       Cabinet silhouettes, minimal hardware features,
//                       vents, label bars, brand text
//   SCHEMATIC style  → Disconnects, Junction Box, Ground, Panels, Wiring
//                       Strict IEEE/NEC symbols, no decorative fills
//
// DESIGN TOKENS:
//   Cabinet fill:    #F4F4F0   (light warm gray — painted metal)
//   Cabinet edge:    #2C2C2C   (near-black outline)
//   Label bar:       #1A1A1A   (dark nameplate)
//   Panel face:      #1A2035   (dark blue-gray — module face)
//   Panel grid:      #2A3550   (slightly lighter grid lines)
//   Panel frame:     #888888   (aluminum frame)
//
// CONNECTION POINTS: { x, y, dir: 'left'|'right'|'top'|'bottom' }
// VOLTAGE DOMAIN:    'AC' | 'DC' | 'BOTH' | 'GND'
// ============================================================

export interface ConnectionPoint {
  id: string;
  x: number;
  y: number;
  dir: 'left' | 'right' | 'top' | 'bottom';
  domain: 'AC' | 'DC' | 'GND' | 'COM';
  label?: string;
}

export interface LabelAnchor {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'auto' | 'hanging' | 'middle';
}

export interface SLDSymbol {
  id: string;
  label: string;
  sub: string;
  domain: 'AC' | 'DC' | 'BOTH' | 'GND';
  badge: string;
  badgeColor: 'blue' | 'green' | 'purple' | 'yellow' | 'red';
  width: number;
  height: number;
  connections: ConnectionPoint[];
  labelAnchor: LabelAnchor;
  svg: (opts?: Record<string, string | number | boolean>) => string;
}

// ─── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  // Stroke weights
  SW_PRIMARY:   2.5,
  SW_SECONDARY: 2,
  SW_HAIR:      1,
  SW_BUS:       5,
  // Schematic colors
  BLACK:   '#1A1A1A',
  WHITE:   '#FFFFFF',
  GND:     '#1B5E20',
  DC_CLR:  '#BF360C',
  AC_CLR:  '#0D3B7A',
  BAT_CLR: '#1565C0',
  GEN_CLR: '#2E7D32',
  ATS_CLR: '#E65100',
  BUI_ENP: '#0D47A1',
  SUB_CLR: '#6A1B9A',
  GRAY:    '#555555',
  // Cabinet / Realistic fills
  CAB_FILL:   '#F4F4F0',
  CAB_EDGE:   '#2C2C2C',
  CAB_BAR:    '#1A1A1A',
  CAB_VENT:   '#CCCCCC',
  CAB_SCREW:  '#888888',
  PANEL_FILL: '#1A2035',
  PANEL_GRID: '#2A3550',
  PANEL_FRAME:'#888888',
  R: 3,
  GRID: 8,
};

// ─── SVG Primitives ───────────────────────────────────────────────────────────
function p_rect(x: number, y: number, w: number, h: number,
  opts: { fill?: string; stroke?: string; sw?: number; r?: number } = {}): string {
  const { fill = T.WHITE, stroke = T.BLACK, sw = T.SW_PRIMARY, r = T.R } = opts;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function p_line(x1: number, y1: number, x2: number, y2: number,
  opts: { stroke?: string; sw?: number; dash?: string; cap?: string } = {}): string {
  const { stroke = T.BLACK, sw = T.SW_PRIMARY, dash, cap } = opts;
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"`;
  if (dash) s += ` stroke-dasharray="${dash}"`;
  if (cap)  s += ` stroke-linecap="${cap}"`;
  s += '/>';
  return s;
}
function p_circle(cx: number, cy: number, r: number,
  opts: { fill?: string; stroke?: string; sw?: number } = {}): string {
  const { fill = T.WHITE, stroke = T.BLACK, sw = T.SW_PRIMARY } = opts;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}
function p_path(d: string,
  opts: { fill?: string; stroke?: string; sw?: number; dash?: string } = {}): string {
  const { fill = 'none', stroke = T.BLACK, sw = T.SW_PRIMARY, dash } = opts;
  let s = `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`;
  if (dash) s += ` stroke-dasharray="${dash}"`;
  s += '/>';
  return s;
}
function p_text(x: number, y: number, text: string,
  opts: { sz?: number; fill?: string; anchor?: string; bold?: boolean; italic?: boolean } = {}): string {
  const { sz = 11, fill = T.BLACK, anchor = 'middle', bold = false, italic = false } = opts;
  const weight = bold ? 'bold' : 'normal';
  const style  = italic ? 'italic' : 'normal';
  return `<text x="${x}" y="${y}" font-family="monospace" font-size="${sz}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="middle" font-weight="${weight}" font-style="${style}">${text}</text>`;
}

// ─── Realistic Cabinet Helper ─────────────────────────────────────────────────
// Renders: drop-shadow rect, body rect with rounded corners,
//          dark label bar at top, four corner screws
function cab(x: number, y: number, w: number, h: number,
  opts: { label?: string; labelClr?: string; fill?: string; labelH?: number } = {}): string {
  const { label, labelClr = '#FFFFFF', fill = T.CAB_FILL, labelH = 18 } = opts;
  const parts: string[] = [];
  // Drop shadow
  parts.push(`<rect x="${x+3}" y="${y+3}" width="${w}" height="${h}" rx="4" fill="#00000022"/>`);
  // Body
  parts.push(p_rect(x, y, w, h, { fill, stroke: T.CAB_EDGE, sw: 2, r: 4 }));
  // Label bar
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${labelH}" rx="4" fill="${T.CAB_BAR}"/>`);
  parts.push(`<rect x="${x}" y="${y + labelH - 4}" width="${w}" height="4" fill="${T.CAB_BAR}"/>`);
  // Label text
  if (label) {
    parts.push(p_text(x + w/2, y + labelH/2, label, { sz: 9, fill: labelClr, bold: true }));
  }
  // Corner screws (4)
  const screwR = 3;
  const pad = 6;
  for (const [sx, sy] of [[x+pad, y+pad+labelH/2], [x+w-pad, y+pad+labelH/2], [x+pad, y+h-pad], [x+w-pad, y+h-pad]] as [number,number][]) {
    parts.push(p_circle(sx, sy, screwR, { fill: T.CAB_FILL, stroke: T.CAB_SCREW, sw: 1 }));
    // Phillips cross
    parts.push(p_line(sx-2, sy, sx+2, sy, { stroke: T.CAB_SCREW, sw: 0.8 }));
    parts.push(p_line(sx, sy-2, sx, sy+2, { stroke: T.CAB_SCREW, sw: 0.8 }));
  }
  return parts.join('');
}

// ─── Vent Slots Helper ────────────────────────────────────────────────────────
function vents(x: number, y: number, w: number, rows: number): string {
  const parts: string[] = [];
  const slotH = 3;
  const gap = 6;
  for (let i = 0; i < rows; i++) {
    const vy = y + i * (slotH + gap);
    parts.push(`<rect x="${x}" y="${vy}" width="${w}" height="${slotH}" rx="1" fill="${T.CAB_VENT}" stroke="none"/>`);
  }
  return parts.join('');
}

// ─── Sine Wave Helper ─────────────────────────────────────────────────────────
function sineWave(cx: number, cy: number, w: number, amp: number,
  opts: { stroke?: string; sw?: number } = {}): string {
  const { stroke = T.BLACK, sw = 1.5 } = opts;
  const hw = w / 2;
  const d = `M${cx-hw},${cy} C${cx-hw*0.5},${cy-amp} ${cx},${cy-amp} ${cx},${cy} S${cx+hw*0.5},${cy+amp} ${cx+hw},${cy}`;
  return p_path(d, { stroke, sw });
}

// ─── SVG Wrapper ──────────────────────────────────────────────────────────────
// Wraps inner SVG content in a full <svg> element for direct HTML embedding
function wrapSVG(w: number, h: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
}

// ─── Connection Point Dot ──────────────────────────────────────────────────────
function cpDot(x: number, y: number, domain: string): string {
  const clr = domain === 'DC' ? T.DC_CLR : domain === 'GND' ? T.GND : T.AC_CLR;
  return p_circle(x, y, 4, { fill: clr, stroke: T.WHITE, sw: 1.5 });
}

// ─── PV Module Helper (single module) ────────────────────────────────────────
// Returns SVG for one PV module at (x,y) with size (w×h)
function pvModule(x: number, y: number, w: number, h: number): string {
  const parts: string[] = [];
  // Aluminum frame
  parts.push(p_rect(x, y, w, h, { fill: T.PANEL_FRAME, stroke: T.CAB_EDGE, sw: 1.5, r: 2 }));
  // Dark blue module face (inset 3px)
  const fi = 3;
  parts.push(p_rect(x+fi, y+fi, w-fi*2, h-fi*2, { fill: T.PANEL_FILL, stroke: T.PANEL_GRID, sw: 1, r: 1 }));
  // Cell grid: 3 columns × 5 rows
  const cols = 3; const rows = 5;
  const cw = (w-fi*2) / cols;
  const ch = (h-fi*2) / rows;
  for (let c = 1; c < cols; c++) {
    parts.push(p_line(x+fi+c*cw, y+fi, x+fi+c*cw, y+h-fi, { stroke: T.PANEL_GRID, sw: 0.7 }));
  }
  for (let r = 1; r < rows; r++) {
    parts.push(p_line(x+fi, y+fi+r*ch, x+w-fi, y+fi+r*ch, { stroke: T.PANEL_GRID, sw: 0.7 }));
  }
  // Junction box nub (small rect on bottom center)
  const jw = 10; const jh = 5;
  parts.push(p_rect(x+w/2-jw/2, y+h-1, jw, jh, { fill: T.CAB_FILL, stroke: T.CAB_EDGE, sw: 1, r: 1 }));
  return parts.join('');
}

// ─── Breaker Rocker Helper ────────────────────────────────────────────────────
function breakerRocker(x: number, y: number, w: number, h: number, on: boolean): string {
  const parts: string[] = [];
  const fill = on ? '#2E7D32' : '#B71C1C';
  parts.push(p_rect(x, y, w, h, { fill, stroke: T.CAB_EDGE, sw: 1, r: 2 }));
  // Rocker line
  const pivot = on ? y + h*0.35 : y + h*0.65;
  parts.push(p_line(x+2, pivot, x+w-2, pivot, { stroke: T.WHITE, sw: 1.5 }));
  parts.push(p_text(x+w/2, on ? y+h*0.2 : y+h*0.8, on ? 'ON' : 'OFF', { sz: 7, fill: T.WHITE, bold: true }));
  return parts.join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYMBOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 1. PV Array ──────────────────────────────────────────────────────────────
const symPVArray: SLDSymbol = {
  id: 'pv-array', label: 'PV Array', sub: 'Solar Modules', domain: 'DC',
  badge: 'DC', badgeColor: 'red', width: 200, height: 160,
  connections: [
    { id: 'dc_pos', x: 200, y: 60,  dir: 'right', domain: 'DC', label: 'DC+' },
    { id: 'dc_neg', x: 200, y: 100, dir: 'right', domain: 'DC', label: 'DC−' },
    { id: 'gnd',    x: 100, y: 160, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 100, y: 172, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    // 3 PV modules side by side: each 56×90, spaced 4px apart
    const mw = 56; const mh = 90;
    const totalW = 3*mw + 2*4;
    const startX = (200 - totalW) / 2;
    const startY = 12;
    for (let i = 0; i < 3; i++) {
      parts.push(pvModule(startX + i*(mw+4), startY, mw, mh));
    }
    // String wiring: connect modules at top
    const topY = startY - 4;
    for (let i = 0; i < 2; i++) {
      const mx1 = startX + i*(mw+4) + mw;
      const mx2 = startX + (i+1)*(mw+4);
      parts.push(p_line(mx1, topY+4, mx2, topY+4, { stroke: T.DC_CLR, sw: 1.5 }));
    }
    // Lead-out to right: DC+ and DC−
    const rightEdge = startX + totalW;
    const midY = startY + mh/2;
    // DC+ lead
    parts.push(p_line(rightEdge, midY - 20, 200, 60, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_text(192, 55, '+', { sz: 11, fill: T.DC_CLR, bold: true }));
    // DC− lead
    parts.push(p_line(rightEdge, midY + 20, 200, 100, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_text(192, 106, '−', { sz: 11, fill: T.DC_CLR, bold: true }));
    // GND lead
    parts.push(p_line(100, startY + mh, 100, 160, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    // Connection dots
    parts.push(cpDot(200, 60, 'DC'));
    parts.push(cpDot(200, 100, 'DC'));
    parts.push(cpDot(100, 160, 'GND'));
    return wrapSVG(200, 160, parts.join(''));
  },
};

// ─── 2. String Inverter ───────────────────────────────────────────────────────
const symInverter: SLDSymbol = {
  id: 'inverter', label: 'String Inverter', sub: 'DC→AC Conversion', domain: 'BOTH',
  badge: 'INV', badgeColor: 'blue', width: 200, height: 170,
  connections: [
    { id: 'dc_in_pos', x: 0,   y: 60,  dir: 'left',   domain: 'DC', label: 'DC+' },
    { id: 'dc_in_neg', x: 0,   y: 90,  dir: 'left',   domain: 'DC', label: 'DC−' },
    { id: 'ac_out',    x: 200, y: 75,  dir: 'right',  domain: 'AC', label: 'L1' },
    { id: 'ac_n',      x: 200, y: 100, dir: 'right',  domain: 'AC', label: 'N' },
    { id: 'gnd',       x: 100, y: 170, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 100, y: 182, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 100; const CY = 88;
    const W = 190; const H = 155;
    const bx = 5; const by = 8;
    // Cabinet body
    parts.push(cab(bx, by, W, H, { label: 'STRING INVERTER', labelClr: '#FFFFFF' }));
    // ── DC Zone (left side) ──
    const dcZoneX = bx+12; const dcZoneY = by+28; const dcZoneW = 60; const dcZoneH = 90;
    parts.push(p_rect(dcZoneX, dcZoneY, dcZoneW, dcZoneH,
      { fill: '#FFF3E0', stroke: T.DC_CLR, sw: 1.5, r: 3 }));
    parts.push(p_text(dcZoneX + dcZoneW/2, dcZoneY + 10, 'DC IN', { sz: 8, fill: T.DC_CLR, bold: true }));
    // MPPT rows
    for (let i = 0; i < 2; i++) {
      const ry = dcZoneY + 22 + i * 28;
      parts.push(p_rect(dcZoneX+6, ry, 48, 20, { fill: '#E8D5B7', stroke: T.DC_CLR, sw: 1, r: 2 }));
      parts.push(p_text(dcZoneX + dcZoneW/2, ry + 10, `MPPT ${i+1}`, { sz: 8, fill: T.DC_CLR }));
    }
    // DC leads into zone
    parts.push(p_line(0, 60, dcZoneX, 60, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(0, 90, dcZoneX, 78, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_text(6, 54, '+', { sz: 10, fill: T.DC_CLR, bold: true }));
    parts.push(p_text(6, 86, '−', { sz: 10, fill: T.DC_CLR, bold: true }));
    // ── Conversion Symbol (center) ──
    const convX = bx + 88; const convY = CY;
    // DC square wave symbol
    parts.push(p_path(`M${convX-14},${convY+6} L${convX-14},${convY-2} L${convX-8},${convY-2} L${convX-8},${convY+6} L${convX-2},${convY+6}`,
      { stroke: T.DC_CLR, sw: 1.5 }));
    // Arrow
    parts.push(p_line(convX-2, convY+2, convX+4, convY+2, { stroke: T.GRAY, sw: 1.5 }));
    parts.push(p_path(`M${convX+2},${convY-1} L${convX+6},${convY+2} L${convX+2},${convY+5}`, { stroke: T.GRAY, sw: 1.5 }));
    // AC sine
    parts.push(sineWave(convX+16, convY+2, 20, 5, { stroke: T.AC_CLR, sw: 1.5 }));
    // ── AC Zone (right side) ──
    const acZoneX = bx + W - 72; const acZoneY = by+28; const acZoneW = 60; const acZoneH = 90;
    parts.push(p_rect(acZoneX, acZoneY, acZoneW, acZoneH,
      { fill: '#E3F2FD', stroke: T.AC_CLR, sw: 1.5, r: 3 }));
    parts.push(p_text(acZoneX + acZoneW/2, acZoneY + 10, 'AC OUT', { sz: 8, fill: T.AC_CLR, bold: true }));
    // Breaker symbol in AC zone
    parts.push(p_rect(acZoneX+8, acZoneY+28, 44, 18, { fill: '#BBDEFB', stroke: T.AC_CLR, sw: 1, r: 2 }));
    parts.push(p_text(acZoneX + acZoneW/2, acZoneY + 37, 'GFCI/OCP', { sz: 7, fill: T.AC_CLR }));
    // Vent slots (right side bottom)
    parts.push(vents(acZoneX+8, acZoneY+58, 44, 4));
    // AC leads
    parts.push(p_line(acZoneX + acZoneW, 75, 200, 75, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(acZoneX + acZoneW, 95, 200, 100, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_text(193, 70, 'L', { sz: 9, fill: T.AC_CLR, bold: true }));
    parts.push(p_text(193, 106, 'N', { sz: 9, fill: T.AC_CLR, bold: true }));
    // Vent slots on DC side bottom
    parts.push(vents(dcZoneX+6, dcZoneY+72, 48, 3));
    // GND lead
    parts.push(p_line(CX, by+H, CX, 170, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    // Connection dots
    parts.push(cpDot(0, 60, 'DC'));
    parts.push(cpDot(0, 90, 'DC'));
    parts.push(cpDot(200, 75, 'AC'));
    parts.push(cpDot(200, 100, 'AC'));
    parts.push(cpDot(100, 170, 'GND'));
    return wrapSVG(200, 170, parts.join(''));
  },
};

// ─── 3. Battery DC-Coupled ────────────────────────────────────────────────────
const symBatteryDC: SLDSymbol = {
  id: 'battery-dc', label: 'Battery (DC)', sub: 'DC-Coupled Storage', domain: 'DC',
  badge: 'BAT', badgeColor: 'blue', width: 180, height: 170,
  connections: [
    { id: 'dc_pos', x: 180, y: 55,  dir: 'right', domain: 'DC', label: 'DC+' },
    { id: 'dc_neg', x: 180, y: 80,  dir: 'right', domain: 'DC', label: 'DC−' },
    { id: 'gnd',    x: 90,  y: 170, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 90, y: 182, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    // Cabinet
    parts.push(cab(5, 8, 170, 152, { label: 'BATTERY PACK', labelClr: '#BBDEFB' }));
    // Stack of 4 module slabs
    const slabW = 140; const slabH = 24; const slabX = 20; const startY = 36;
    const slabColors = ['#1565C0', '#1976D2', '#1E88E5', '#2196F3'];
    for (let i = 0; i < 4; i++) {
      const sy = startY + i * (slabH + 4);
      // Slab body
      parts.push(p_rect(slabX, sy, slabW, slabH,
        { fill: slabColors[i], stroke: T.CAB_EDGE, sw: 1.5, r: 3 }));
      // Cell bar indicators (6 bars)
      for (let b = 0; b < 6; b++) {
        const bx2 = slabX + 10 + b * 20;
        const bFill = b < 4 ? '#90CAF9' : '#37474F';
        parts.push(p_rect(bx2, sy + 6, 14, 12, { fill: bFill, stroke: '#0D47A1', sw: 0.7, r: 1 }));
      }
      // Capacity label
      parts.push(p_text(slabX + slabW - 12, sy + slabH/2, `${i+1}`, { sz: 8, fill: '#FFFFFF', bold: true }));
    }
    // kWh label
    const kwY = startY + 4*(slabH+4) + 10;
    parts.push(p_text(90, kwY, '≈ 10 kWh', { sz: 10, fill: T.BAT_CLR, bold: true }));
    // SOC indicator bar
    const socY = kwY + 18;
    parts.push(p_rect(20, socY, 140, 10, { fill: '#E3F2FD', stroke: T.BAT_CLR, sw: 1, r: 2 }));
    parts.push(p_rect(20, socY, 98, 10, { fill: '#42A5F5', stroke: 'none', sw: 0, r: 2 }));
    parts.push(p_text(90, socY + 5, 'SOC 70%', { sz: 8, fill: T.WHITE }));
    // DC leads
    parts.push(p_line(160, 55, 180, 55, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(160, 80, 180, 80, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_text(172, 49, '+', { sz: 10, fill: T.DC_CLR, bold: true }));
    parts.push(p_text(172, 87, '−', { sz: 10, fill: T.DC_CLR, bold: true }));
    // GND
    parts.push(p_line(90, 160, 90, 170, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(180, 55, 'DC'));
    parts.push(cpDot(180, 80, 'DC'));
    parts.push(cpDot(90, 170, 'GND'));
    return wrapSVG(180, 170, parts.join(''));
  },
};

// ─── 4. Battery AC-Coupled ────────────────────────────────────────────────────
const symBatteryAC: SLDSymbol = {
  id: 'battery-ac', label: 'Battery (AC)', sub: 'AC-Coupled Storage', domain: 'AC',
  badge: 'BAT', badgeColor: 'blue', width: 180, height: 170,
  connections: [
    { id: 'ac_l1', x: 180, y: 55,  dir: 'right', domain: 'AC', label: 'L1' },
    { id: 'ac_n',  x: 180, y: 80,  dir: 'right', domain: 'AC', label: 'N' },
    { id: 'gnd',   x: 90,  y: 170, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 90, y: 182, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    parts.push(cab(5, 8, 170, 152, { label: 'BATTERY (AC)', labelClr: '#BBDEFB' }));
    // Module slabs
    const slabW = 140; const slabH = 24; const slabX = 20; const startY = 36;
    const slabColors = ['#0D47A1', '#1565C0', '#1976D2', '#1E88E5'];
    for (let i = 0; i < 4; i++) {
      const sy = startY + i * (slabH + 4);
      parts.push(p_rect(slabX, sy, slabW, slabH,
        { fill: slabColors[i], stroke: T.CAB_EDGE, sw: 1.5, r: 3 }));
      for (let b = 0; b < 6; b++) {
        const bx2 = slabX + 10 + b * 20;
        const bFill = b < 5 ? '#90CAF9' : '#37474F';
        parts.push(p_rect(bx2, sy + 6, 14, 12, { fill: bFill, stroke: '#0D47A1', sw: 0.7, r: 1 }));
      }
    }
    // Built-in inverter note
    const biY = startY + 4*(slabH+4) + 8;
    parts.push(p_rect(20, biY, 140, 18, { fill: '#E3F2FD', stroke: T.AC_CLR, sw: 1, r: 3 }));
    parts.push(p_text(90, biY + 9, 'Built-in Inverter', { sz: 8, fill: T.AC_CLR }));
    // Sine wave small
    parts.push(sineWave(90, biY + 32, 40, 5, { stroke: T.AC_CLR, sw: 1.5 }));
    // AC leads
    parts.push(p_line(160, 55, 180, 55, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(160, 80, 180, 80, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_text(172, 49, 'L', { sz: 9, fill: T.AC_CLR, bold: true }));
    parts.push(p_text(172, 87, 'N', { sz: 9, fill: T.AC_CLR, bold: true }));
    parts.push(p_line(90, 160, 90, 170, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(180, 55, 'AC'));
    parts.push(cpDot(180, 80, 'AC'));
    parts.push(cpDot(90, 170, 'GND'));
    return wrapSVG(180, 170, parts.join(''));
  },
};

// ─── 5. BUI / Enphase Gateway ─────────────────────────────────────────────────
const symBUI: SLDSymbol = {
  id: 'bui-enphase', label: 'BUI / Gateway', sub: 'Enphase IQ Gateway', domain: 'AC',
  badge: 'BUI', badgeColor: 'blue', width: 180, height: 130,
  connections: [
    { id: 'ac_in',  x: 0,   y: 65,  dir: 'left',  domain: 'AC', label: 'AC IN' },
    { id: 'ac_out', x: 180, y: 65,  dir: 'right', domain: 'AC', label: 'AC OUT' },
    { id: 'gnd',    x: 90,  y: 130, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 90, y: 142, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    parts.push(cab(5, 5, 170, 115, { label: 'IQ GATEWAY', labelClr: '#90CAF9' }));
    // Port row: 6 RJ45/connector ports
    const portY = 38; const portW = 18; const portH = 14; const portGap = 6;
    const totalPorts = 6;
    const totalW = totalPorts * portW + (totalPorts-1) * portGap;
    const portStartX = (180 - totalW) / 2;
    for (let i = 0; i < totalPorts; i++) {
      const px = portStartX + i * (portW + portGap);
      parts.push(p_rect(px, portY, portW, portH,
        { fill: '#263238', stroke: '#90A4AE', sw: 1, r: 2 }));
      // 8 pin holes in port
      for (let p2 = 0; p2 < 4; p2++) {
        parts.push(p_rect(px + 2 + p2*4, portY + 4, 2, 5,
          { fill: '#546E7A', stroke: 'none', sw: 0, r: 0 }));
      }
    }
    parts.push(p_text(90, portY + portH + 10, 'MICROINVERTER PORTS', { sz: 7, fill: T.GRAY }));
    // Status LEDs
    const ledY = portY + portH + 24;
    const ledColors = ['#4CAF50', '#4CAF50', '#FF9800', '#2196F3'];
    const ledLabels = ['PWR', 'NET', 'ZBE', 'LNK'];
    for (let i = 0; i < 4; i++) {
      const lx = 25 + i * 38;
      parts.push(p_circle(lx, ledY, 5, { fill: ledColors[i], stroke: T.CAB_EDGE, sw: 1 }));
      parts.push(p_text(lx, ledY + 13, ledLabels[i], { sz: 7, fill: T.GRAY }));
    }
    // Comm line
    const commY = ledY + 26;
    parts.push(p_rect(20, commY, 140, 14, { fill: '#E8EAF6', stroke: '#3F51B5', sw: 1, r: 2 }));
    parts.push(p_text(90, commY + 7, 'Envoy Communications', { sz: 7, fill: '#3F51B5' }));
    // AC leads
    parts.push(p_line(0, 65, 18, 65, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(162, 65, 180, 65, { stroke: T.AC_CLR, sw: 2 }));
    // GND
    parts.push(p_line(90, 120, 90, 130, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, 65, 'AC'));
    parts.push(cpDot(180, 65, 'AC'));
    parts.push(cpDot(90, 130, 'GND'));
    return wrapSVG(180, 130, parts.join(''));
  },
};

// ─── 6. Generator ─────────────────────────────────────────────────────────────
const symGenerator: SLDSymbol = {
  id: 'generator', label: 'Generator', sub: 'Standby Gen', domain: 'AC',
  badge: 'GEN', badgeColor: 'green', width: 180, height: 200,
  connections: [
    { id: 'ac_l1', x: 180, y: 80,  dir: 'right', domain: 'AC', label: 'L1' },
    { id: 'ac_l2', x: 180, y: 105, dir: 'right', domain: 'AC', label: 'L2' },
    { id: 'ac_n',  x: 180, y: 130, dir: 'right', domain: 'AC', label: 'N' },
    { id: 'gnd',   x: 90,  y: 200, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 90, y: 212, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    // IEEE 315 generator circle (TOP portion, schematic standard)
    const circR = 32; const circCX = 90; const circCY = 40;
    parts.push(p_circle(circCX, circCY, circR, { fill: T.WHITE, stroke: T.GEN_CLR, sw: 2.5 }));
    // G letter
    parts.push(p_text(circCX - 6, circCY, 'G', { sz: 16, fill: T.GEN_CLR, bold: true }));
    // Sine wave inside circle
    parts.push(sineWave(circCX + 8, circCY, 20, 6, { stroke: T.GEN_CLR, sw: 1.5 }));
    // Cabinet base BELOW the circle
    const cabY = circCY + circR + 4;
    parts.push(cab(5, cabY, 170, 100, { label: 'STANDBY GENERATOR', labelClr: '#A5D6A7' }));
    // Exhaust stack (left)
    parts.push(p_rect(18, cabY + 24, 20, 50, { fill: '#78909C', stroke: T.CAB_EDGE, sw: 1.5, r: 2 }));
    parts.push(p_text(28, cabY + 49, 'EXH', { sz: 7, fill: T.WHITE }));
    // Engine block visual (center)
    parts.push(p_rect(50, cabY + 24, 80, 50, { fill: '#ECEFF1', stroke: '#607D8B', sw: 1.5, r: 3 }));
    parts.push(p_text(90, cabY + 42, 'ENGINE', { sz: 9, fill: '#37474F', bold: true }));
    parts.push(p_text(90, cabY + 57, '7.5 kW', { sz: 8, fill: T.GEN_CLR }));
    // Vent slots (right of engine)
    parts.push(vents(140, cabY + 28, 26, 5));
    // Control panel (bottom)
    parts.push(p_rect(50, cabY + 80, 80, 14, { fill: '#263238', stroke: '#546E7A', sw: 1, r: 2 }));
    parts.push(p_circle(62, cabY + 87, 4, { fill: '#F44336', stroke: T.CAB_EDGE, sw: 1 }));
    parts.push(p_circle(78, cabY + 87, 4, { fill: '#4CAF50', stroke: T.CAB_EDGE, sw: 1 }));
    parts.push(p_circle(94, cabY + 87, 4, { fill: '#FFC107', stroke: T.CAB_EDGE, sw: 1 }));
    // Connect circle to cabinet with short line
    parts.push(p_line(circCX, circCY + circR, circCX, cabY, { stroke: T.GEN_CLR, sw: 2 }));
    // AC leads
    const acStartX = 5 + 170;
    parts.push(p_line(acStartX, 80, 180, 80, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(acStartX, 105, 180, 105, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(acStartX, 130, 180, 130, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_text(173, 75, 'L1', { sz: 8, fill: T.AC_CLR, bold: true }));
    parts.push(p_text(173, 101, 'L2', { sz: 8, fill: T.AC_CLR, bold: true }));
    parts.push(p_text(174, 136, 'N', { sz: 8, fill: T.AC_CLR, bold: true }));
    // GND
    parts.push(p_line(90, cabY + 100, 90, 200, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(180, 80, 'AC'));
    parts.push(cpDot(180, 105, 'AC'));
    parts.push(cpDot(180, 130, 'AC'));
    parts.push(cpDot(90, 200, 'GND'));
    return wrapSVG(180, 200, parts.join(''));
  },
};

// ─── 7. AC Combiner ───────────────────────────────────────────────────────────
const symACCombiner: SLDSymbol = {
  id: 'ac-combiner', label: 'AC Combiner', sub: 'Branch Protection', domain: 'AC',
  badge: 'AC', badgeColor: 'blue', width: 180, height: 160,
  connections: [
    { id: 'in1',  x: 0,   y: 55,  dir: 'left',  domain: 'AC', label: 'IN 1' },
    { id: 'in2',  x: 0,   y: 80,  dir: 'left',  domain: 'AC', label: 'IN 2' },
    { id: 'in3',  x: 0,   y: 105, dir: 'left',  domain: 'AC', label: 'IN 3' },
    { id: 'out',  x: 180, y: 80,  dir: 'right', domain: 'AC', label: 'OUT' },
    { id: 'gnd',  x: 90,  y: 160, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 90, y: 172, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    parts.push(cab(5, 8, 170, 142, { label: 'AC COMBINER', labelClr: '#BBDEFB' }));
    // Busbar (vertical)
    const busX = 95; const busTop = 35; const busBot = 125;
    parts.push(p_line(busX, busTop, busX, busBot, { stroke: T.AC_CLR, sw: 5 }));
    parts.push(p_text(busX + 8, (busTop+busBot)/2, 'BUS', { sz: 8, fill: T.AC_CLR, bold: true, anchor: 'start' }));
    // 3 breaker rockers (left of bus)
    const rockerPositions = [42, 67, 92];
    for (let i = 0; i < 3; i++) {
      const ry = rockerPositions[i];
      // Breaker rocker
      parts.push(breakerRocker(55, ry - 8, 30, 18, true));
      // Input lead
      parts.push(p_line(0, ry + 1, 55, ry + 1, { stroke: T.AC_CLR, sw: 2 }));
      // Breaker to bus tap
      parts.push(p_line(85, ry + 1, busX, ry + 1, { stroke: T.AC_CLR, sw: 2 }));
    }
    // Output main breaker (right of bus)
    parts.push(breakerRocker(105, 67, 35, 20, true));
    parts.push(p_text(122, 85, 'MAIN', { sz: 7, fill: T.WHITE }));
    parts.push(p_line(busX, 77, 105, 77, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(140, 77, 175, 80, { stroke: T.AC_CLR, sw: 2 }));
    // Vent bottom
    parts.push(vents(20, 120, 60, 3));
    // Input labels
    for (let i = 0; i < 3; i++) {
      parts.push(p_text(8, rockerPositions[i] - 4, `IN${i+1}`, { sz: 7, fill: T.AC_CLR, anchor: 'start' }));
    }
    // GND
    parts.push(p_line(90, 150, 90, 160, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, 55, 'AC'));
    parts.push(cpDot(0, 80, 'AC'));
    parts.push(cpDot(0, 105, 'AC'));
    parts.push(cpDot(180, 80, 'AC'));
    parts.push(cpDot(90, 160, 'GND'));
    return wrapSVG(180, 160, parts.join(''));
  },
};

// ─── 8. DC Disconnect ─────────────────────────────────────────────────────────
const symDCDisconnect: SLDSymbol = {
  id: 'dc-disconnect', label: 'DC Disconnect', sub: 'NEC 690.15', domain: 'DC',
  badge: 'DC', badgeColor: 'red', width: 120, height: 100,
  connections: [
    { id: 'dc_in',  x: 0,   y: 50, dir: 'left',  domain: 'DC', label: 'IN' },
    { id: 'dc_out', x: 120, y: 50, dir: 'right', domain: 'DC', label: 'OUT' },
    { id: 'gnd',    x: 60,  y: 100, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 60, y: 112, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 60; const CY = 50;
    // Box enclosure
    parts.push(p_rect(20, 18, 80, 48, { fill: '#FFF8E1', stroke: T.DC_CLR, sw: 2, r: 4 }));
    // DC label
    parts.push(p_text(CX, 28, 'DC', { sz: 9, fill: T.DC_CLR, bold: true }));
    // IEEE knife switch: line → open blade → line
    // Pivot circle left
    parts.push(p_circle(35, CY, 4, { fill: T.WHITE, stroke: T.DC_CLR, sw: 2 }));
    // Blade (open = angled up ~30°)
    parts.push(p_line(35, CY, 62, CY - 14, { stroke: T.DC_CLR, sw: 2.5 }));
    // Contact dot right
    parts.push(p_circle(80, CY, 4, { fill: T.WHITE, stroke: T.DC_CLR, sw: 2 }));
    // Lead lines
    parts.push(p_line(0, CY, 31, CY, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(84, CY, 120, CY, { stroke: T.DC_CLR, sw: 2 }));
    // NEC label
    parts.push(p_text(CX, 76, 'NEC 690.15', { sz: 8, fill: T.GRAY }));
    // GND
    parts.push(p_line(CX, 66, CX, 100, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, CY, 'DC'));
    parts.push(cpDot(120, CY, 'DC'));
    parts.push(cpDot(CX, 100, 'GND'));
    return wrapSVG(120, 100, parts.join(''));
  },
};

// ─── 9. AC Disconnect ─────────────────────────────────────────────────────────
const symACDisconnect: SLDSymbol = {
  id: 'ac-disconnect', label: 'AC Disconnect', sub: 'NEC 690.17', domain: 'AC',
  badge: 'AC', badgeColor: 'blue', width: 120, height: 100,
  connections: [
    { id: 'ac_in',  x: 0,   y: 50, dir: 'left',  domain: 'AC', label: 'IN' },
    { id: 'ac_out', x: 120, y: 50, dir: 'right', domain: 'AC', label: 'OUT' },
    { id: 'gnd',    x: 60,  y: 100, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 60, y: 112, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 60; const CY = 50;
    parts.push(p_rect(20, 18, 80, 48, { fill: '#E3F2FD', stroke: T.AC_CLR, sw: 2, r: 4 }));
    parts.push(p_text(CX, 28, 'AC', { sz: 9, fill: T.AC_CLR, bold: true }));
    // 3-pole IEEE knife switch (3 lines with blades)
    for (let i = 0; i < 3; i++) {
      const ly = CY - 8 + i * 8;
      parts.push(p_circle(35, ly, 3, { fill: T.WHITE, stroke: T.AC_CLR, sw: 1.5 }));
      parts.push(p_line(35, ly, 60, ly - 10, { stroke: T.AC_CLR, sw: 2 }));
      parts.push(p_circle(80, ly, 3, { fill: T.WHITE, stroke: T.AC_CLR, sw: 1.5 }));
    }
    parts.push(p_line(0, CY, 32, CY, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(83, CY, 120, CY, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_text(CX, 76, 'NEC 690.17', { sz: 8, fill: T.GRAY }));
    parts.push(p_line(CX, 66, CX, 100, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, CY, 'AC'));
    parts.push(cpDot(120, CY, 'AC'));
    parts.push(cpDot(CX, 100, 'GND'));
    return wrapSVG(120, 100, parts.join(''));
  },
};

// ─── 10. Fused Disconnect ─────────────────────────────────────────────────────
const symFusedDisconnect: SLDSymbol = {
  id: 'fused-disconnect', label: 'Fused Disconnect', sub: 'Fusible Switch', domain: 'DC',
  badge: 'DC', badgeColor: 'red', width: 140, height: 100,
  connections: [
    { id: 'dc_in',  x: 0,   y: 50, dir: 'left',  domain: 'DC', label: 'IN' },
    { id: 'dc_out', x: 140, y: 50, dir: 'right', domain: 'DC', label: 'OUT' },
    { id: 'gnd',    x: 70,  y: 100, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 70, y: 112, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 70; const CY = 50;
    parts.push(p_rect(15, 20, 110, 44, { fill: '#FFF8E1', stroke: T.DC_CLR, sw: 2, r: 4 }));
    parts.push(p_text(CX, 29, 'FUSIBLE SW', { sz: 8, fill: T.DC_CLR, bold: true }));
    // Knife switch
    parts.push(p_circle(32, CY, 4, { fill: T.WHITE, stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(32, CY, 58, CY - 12, { stroke: T.DC_CLR, sw: 2.5 }));
    parts.push(p_circle(78, CY, 4, { fill: T.WHITE, stroke: T.DC_CLR, sw: 2 }));
    // Fuse rectangle (IEEE fuse symbol) on output side
    parts.push(p_rect(88, CY - 7, 24, 14, { fill: T.WHITE, stroke: T.DC_CLR, sw: 2, r: 2 }));
    parts.push(p_line(82, CY, 88, CY, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(112, CY, 125, CY, { stroke: T.DC_CLR, sw: 2 }));
    // Fuse center dot
    parts.push(p_circle(100, CY, 2, { fill: T.DC_CLR, stroke: T.DC_CLR, sw: 1 }));
    // Leads
    parts.push(p_line(0, CY, 28, CY, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_line(125, CY, 140, CY, { stroke: T.DC_CLR, sw: 2 }));
    parts.push(p_text(CX, 74, 'NEC 690.9', { sz: 8, fill: T.GRAY }));
    parts.push(p_line(CX, 64, CX, 100, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, CY, 'DC'));
    parts.push(cpDot(140, CY, 'DC'));
    parts.push(cpDot(CX, 100, 'GND'));
    return wrapSVG(140, 100, parts.join(''));
  },
};

// ─── 11. Ground ───────────────────────────────────────────────────────────────
const symGround: SLDSymbol = {
  id: 'ground', label: 'System Ground', sub: 'NEC 250.50', domain: 'GND',
  badge: 'GND', badgeColor: 'green', width: 80, height: 90,
  connections: [
    { id: 'gnd', x: 40, y: 0, dir: 'top', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 40, y: 96, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 40;
    // Vertical lead
    parts.push(p_line(CX, 0, CX, 28, { stroke: T.GND, sw: 2 }));
    // IEEE ground: 3 descending horizontal bars
    const bars = [{ y: 28, hw: 28 }, { y: 42, hw: 20 }, { y: 56, hw: 12 }];
    for (const b of bars) {
      parts.push(p_line(CX - b.hw, b.y, CX + b.hw, b.y, { stroke: T.GND, sw: 2.5 }));
    }
    // Earth symbol (optional hatching)
    parts.push(p_line(CX - 8, 62, CX + 8, 62, { stroke: T.GND, sw: 1.5 }));
    parts.push(p_line(CX - 4, 68, CX + 4, 68, { stroke: T.GND, sw: 1.5 }));
    // Rod/stake lines
    parts.push(p_line(CX - 12, 76, CX + 12, 76, { stroke: T.GND, sw: 1 }));
    parts.push(p_text(CX, 85, 'EARTH', { sz: 9, fill: T.GND, bold: true }));
    parts.push(cpDot(CX, 0, 'GND'));
    return wrapSVG(80, 90, parts.join(''));
  },
};

// ─── 12. Fuse ─────────────────────────────────────────────────────────────────
const symFuse: SLDSymbol = {
  id: 'fuse', label: 'Fuse', sub: 'Overcurrent Protection', domain: 'BOTH',
  badge: 'OCP', badgeColor: 'yellow', width: 100, height: 70,
  connections: [
    { id: 'in',  x: 0,   y: 35, dir: 'left',  domain: 'DC', label: 'IN' },
    { id: 'out', x: 100, y: 35, dir: 'right', domain: 'DC', label: 'OUT' },
  ],
  labelAnchor: { x: 50, y: 62, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 50; const CY = 35;
    // Lead lines
    parts.push(p_line(0, CY, 22, CY, { stroke: T.BLACK, sw: 2 }));
    parts.push(p_line(78, CY, 100, CY, { stroke: T.BLACK, sw: 2 }));
    // IEEE fuse rectangle
    parts.push(p_rect(22, CY - 10, 56, 20, { fill: T.WHITE, stroke: T.BLACK, sw: 2, r: 3 }));
    // Center filament
    parts.push(p_line(22, CY, 78, CY, { stroke: T.GRAY, sw: 1, dash: '4,2' }));
    // Rating label
    parts.push(p_text(CX, CY, 'FUSE', { sz: 10, fill: T.BLACK, bold: true }));
    parts.push(cpDot(0, CY, 'DC'));
    parts.push(cpDot(100, CY, 'DC'));
    return wrapSVG(100, 70, parts.join(''));
  },
};

// ─── 13. Circuit Breaker ──────────────────────────────────────────────────────
const symBreaker: SLDSymbol = {
  id: 'breaker', label: 'Circuit Breaker', sub: 'OCPD', domain: 'AC',
  badge: 'CB', badgeColor: 'blue', width: 100, height: 80,
  connections: [
    { id: 'in',  x: 0,   y: 40, dir: 'left',  domain: 'AC', label: 'IN' },
    { id: 'out', x: 100, y: 40, dir: 'right', domain: 'AC', label: 'OUT' },
  ],
  labelAnchor: { x: 50, y: 72, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 50; const CY = 40;
    // Lead lines
    parts.push(p_line(0, CY, 24, CY, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(76, CY, 100, CY, { stroke: T.AC_CLR, sw: 2 }));
    // Breaker box
    parts.push(p_rect(24, CY - 14, 52, 28, { fill: T.WHITE, stroke: T.AC_CLR, sw: 2, r: 3 }));
    // Trip arc (IEEE CB symbol)
    const arcD = `M${CX-8},${CY+8} Q${CX},${CY-12} ${CX+8},${CY+8}`;
    parts.push(p_path(arcD, { stroke: T.AC_CLR, sw: 2 }));
    // Center dot
    parts.push(p_circle(CX, CY, 3, { fill: T.AC_CLR, stroke: T.AC_CLR, sw: 1 }));
    parts.push(p_text(CX, CY + 18, 'CB', { sz: 9, fill: T.AC_CLR, bold: true }));
    parts.push(cpDot(0, CY, 'AC'));
    parts.push(cpDot(100, CY, 'AC'));
    return wrapSVG(100, 80, parts.join(''));
  },
};

// ─── 14. Junction Box ─────────────────────────────────────────────────────────
const symJunctionBox: SLDSymbol = {
  id: 'junction-box', label: 'Junction Box', sub: 'Wiring Junction', domain: 'BOTH',
  badge: 'J', badgeColor: 'yellow', width: 100, height: 100,
  connections: [
    { id: 'left',   x: 0,   y: 50, dir: 'left',   domain: 'AC', label: 'L' },
    { id: 'right',  x: 100, y: 50, dir: 'right',  domain: 'AC', label: 'R' },
    { id: 'top',    x: 50,  y: 0,  dir: 'top',    domain: 'AC', label: 'T' },
    { id: 'bottom', x: 50,  y: 100, dir: 'bottom', domain: 'AC', label: 'B' },
  ],
  labelAnchor: { x: 50, y: 108, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 50; const CY = 50;
    // IEEE junction box square
    parts.push(p_rect(18, 18, 64, 64, { fill: T.WHITE, stroke: T.BLACK, sw: 2, r: 4 }));
    // Lead lines
    parts.push(p_line(0, CY, 18, CY, { stroke: T.BLACK, sw: 2 }));
    parts.push(p_line(82, CY, 100, CY, { stroke: T.BLACK, sw: 2 }));
    parts.push(p_line(CX, 0, CX, 18, { stroke: T.BLACK, sw: 2 }));
    parts.push(p_line(CX, 82, CX, 100, { stroke: T.BLACK, sw: 2 }));
    // Center junction dot
    parts.push(p_circle(CX, CY, 5, { fill: T.BLACK, stroke: T.BLACK, sw: 1 }));
    // J label
    parts.push(p_text(CX, 30, 'J', { sz: 14, fill: T.BLACK, bold: true }));
    parts.push(cpDot(0, CY, 'AC'));
    parts.push(cpDot(100, CY, 'AC'));
    parts.push(cpDot(CX, 0, 'AC'));
    parts.push(cpDot(CX, 100, 'AC'));
    return wrapSVG(100, 100, parts.join(''));
  },
};

// ─── 15. Main Service Panel (MSP) ─────────────────────────────────────────────
const symMSP: SLDSymbol = {
  id: 'msp', label: 'Main Service Panel', sub: '200A MSP', domain: 'AC',
  badge: 'MSP', badgeColor: 'blue', width: 160, height: 180,
  connections: [
    { id: 'utility_in', x: 0,   y: 55,  dir: 'left',  domain: 'AC', label: 'UTIL' },
    { id: 'solar_in',   x: 0,   y: 90,  dir: 'left',  domain: 'AC', label: 'PV' },
    { id: 'load_out',   x: 160, y: 72,  dir: 'right', domain: 'AC', label: 'LOAD' },
    { id: 'gnd',        x: 80,  y: 180, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 80, y: 192, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 80;
    // Panel body
    parts.push(p_rect(8, 8, 144, 162, { fill: '#ECEFF1', stroke: T.AC_CLR, sw: 2.5, r: 5 }));
    // Header bar
    parts.push(`<rect x="8" y="8" width="144" height="22" rx="5" fill="${T.AC_CLR}"/>`);
    parts.push(`<rect x="8" y="24" width="144" height="6" fill="${T.AC_CLR}"/>`);
    parts.push(p_text(CX, 20, 'MAIN SERVICE PANEL', { sz: 8, fill: T.WHITE, bold: true }));
    // Rating badge
    parts.push(p_rect(55, 36, 50, 18, { fill: T.WHITE, stroke: T.AC_CLR, sw: 1.5, r: 3 }));
    parts.push(p_text(CX, 46, '200A / 240V', { sz: 8, fill: T.AC_CLR, bold: true }));
    // Busbar
    parts.push(p_rect(72, 60, 16, 80, { fill: T.AC_CLR, stroke: '#0A2E6E', sw: 1, r: 2 }));
    parts.push(p_text(CX, 120, 'BUS', { sz: 7, fill: T.WHITE, bold: true }));
    // Breaker slots (left column)
    const bSlots = [
      { y: 64, label: 'MAIN' },
      { y: 86, label: '20A' },
      { y: 108, label: '20A' },
    ];
    for (const bs of bSlots) {
      parts.push(p_rect(16, bs.y, 50, 16, { fill: '#CFD8DC', stroke: '#607D8B', sw: 1, r: 2 }));
      parts.push(p_text(41, bs.y + 8, bs.label, { sz: 8, fill: T.BLACK }));
      // Tap to bus
      parts.push(p_line(66, bs.y + 8, 72, bs.y + 8, { stroke: T.AC_CLR, sw: 1.5 }));
    }
    // Breaker slots (right column)
    const bSlotsR = [{ y: 64 }, { y: 86 }, { y: 108 }];
    for (const bs of bSlotsR) {
      parts.push(p_rect(94, bs.y, 50, 16, { fill: '#CFD8DC', stroke: '#607D8B', sw: 1, r: 2 }));
      parts.push(p_line(88, bs.y + 8, 94, bs.y + 8, { stroke: T.AC_CLR, sw: 1.5 }));
    }
    // Neutral/ground bus at bottom
    parts.push(p_rect(16, 148, 128, 14, { fill: '#B0BEC5', stroke: '#607D8B', sw: 1, r: 2 }));
    parts.push(p_text(CX, 155, 'N/G BUS', { sz: 8, fill: T.BLACK }));
    // Input leads
    parts.push(p_line(0, 55, 16, 55, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(0, 90, 16, 90, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(144, 72, 160, 72, { stroke: T.AC_CLR, sw: 2 }));
    // GND lead
    parts.push(p_line(CX, 162, CX, 180, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, 55, 'AC'));
    parts.push(cpDot(0, 90, 'AC'));
    parts.push(cpDot(160, 72, 'AC'));
    parts.push(cpDot(CX, 180, 'GND'));
    return wrapSVG(160, 180, parts.join(''));
  },
};

// ─── 16. Sub Panel ────────────────────────────────────────────────────────────
const symSubPanel: SLDSymbol = {
  id: 'sub-panel', label: 'Sub Panel', sub: '100A Distribution', domain: 'AC',
  badge: 'SUB', badgeColor: 'purple', width: 140, height: 150,
  connections: [
    { id: 'ac_in',  x: 0,   y: 50, dir: 'left',  domain: 'AC', label: 'IN' },
    { id: 'ac_out', x: 140, y: 50, dir: 'right', domain: 'AC', label: 'OUT' },
    { id: 'gnd',    x: 70,  y: 150, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 70, y: 162, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 70;
    parts.push(p_rect(8, 8, 124, 132, { fill: '#F3E5F5', stroke: T.SUB_CLR, sw: 2.5, r: 5 }));
    parts.push(`<rect x="8" y="8" width="124" height="20" rx="5" fill="${T.SUB_CLR}"/>`);
    parts.push(`<rect x="8" y="22" width="124" height="6" fill="${T.SUB_CLR}"/>`);
    parts.push(p_text(CX, 19, 'SUB PANEL', { sz: 8, fill: T.WHITE, bold: true }));
    parts.push(p_rect(40, 34, 60, 16, { fill: T.WHITE, stroke: T.SUB_CLR, sw: 1, r: 2 }));
    parts.push(p_text(CX, 43, '100A / 240V', { sz: 8, fill: T.SUB_CLR }));
    // Busbar
    parts.push(p_rect(62, 56, 16, 60, { fill: T.SUB_CLR, stroke: '#4A0072', sw: 1, r: 2 }));
    // Breaker slots
    for (let i = 0; i < 3; i++) {
      const by2 = 58 + i * 22;
      parts.push(p_rect(14, by2, 42, 16, { fill: '#E1BEE7', stroke: '#9C27B0', sw: 1, r: 2 }));
      parts.push(p_text(35, by2 + 8, '20A', { sz: 8, fill: T.SUB_CLR }));
      parts.push(p_line(56, by2 + 8, 62, by2 + 8, { stroke: T.SUB_CLR, sw: 1.5 }));
      parts.push(p_rect(84, by2, 42, 16, { fill: '#E1BEE7', stroke: '#9C27B0', sw: 1, r: 2 }));
      parts.push(p_line(78, by2 + 8, 84, by2 + 8, { stroke: T.SUB_CLR, sw: 1.5 }));
    }
    // Neutral bus
    parts.push(p_rect(14, 126, 112, 10, { fill: '#CE93D8', stroke: T.SUB_CLR, sw: 1, r: 2 }));
    parts.push(p_text(CX, 131, 'N BUS', { sz: 7, fill: T.WHITE }));
    // Leads
    parts.push(p_line(0, 50, 14, 50, { stroke: T.SUB_CLR, sw: 2 }));
    parts.push(p_line(126, 50, 140, 50, { stroke: T.SUB_CLR, sw: 2 }));
    parts.push(p_line(CX, 136, CX, 150, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, 50, 'AC'));
    parts.push(cpDot(140, 50, 'AC'));
    parts.push(cpDot(CX, 150, 'GND'));
    return wrapSVG(140, 150, parts.join(''));
  },
};

// ─── 17. Utility Meter ────────────────────────────────────────────────────────
const symUtilityMeter: SLDSymbol = {
  id: 'utility-meter', label: 'Utility Meter', sub: 'Revenue Grade', domain: 'AC',
  badge: 'MTR', badgeColor: 'blue', width: 120, height: 120,
  connections: [
    { id: 'utility_in',  x: 0,   y: 60, dir: 'left',  domain: 'AC', label: 'UTIL IN' },
    { id: 'service_out', x: 120, y: 60, dir: 'right', domain: 'AC', label: 'SERVICE' },
    { id: 'gnd',         x: 60,  y: 120, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 60, y: 130, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 60; const CY = 58;
    // Meter body circle (utility meter is round)
    parts.push(p_circle(CX, CY, 46, { fill: '#FAFAFA', stroke: T.AC_CLR, sw: 2.5 }));
    // Glass dome inner circle
    parts.push(p_circle(CX, CY, 36, { fill: T.WHITE, stroke: '#90A4AE', sw: 1 }));
    // Meter disc / display
    parts.push(p_circle(CX, CY, 18, { fill: '#E3F2FD', stroke: T.AC_CLR, sw: 1 }));
    // kWh readout
    parts.push(p_text(CX, CY - 5, 'kWh', { sz: 9, fill: T.AC_CLR, bold: true }));
    parts.push(p_text(CX, CY + 7, '00000', { sz: 8, fill: T.BLACK }));
    // Utility label
    parts.push(p_text(CX, CY + 24, 'REV GRADE', { sz: 7, fill: T.GRAY }));
    // Mounting ring (outer ring detail)
    parts.push(p_circle(CX, CY, 44, { fill: 'none', stroke: '#B0BEC5', sw: 1 }));
    // Lead lines
    parts.push(p_line(0, CY, 14, CY, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(106, CY, 120, CY, { stroke: T.AC_CLR, sw: 2 }));
    // GND lead
    parts.push(p_line(CX, 104, CX, 120, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, CY, 'AC'));
    parts.push(cpDot(120, CY, 'AC'));
    parts.push(cpDot(CX, 120, 'GND'));
    return wrapSVG(120, 120, parts.join(''));
  },
};

// ─── 18. ATS / Transfer Switch ────────────────────────────────────────────────
const symATS: SLDSymbol = {
  id: 'ats', label: 'ATS', sub: 'Auto Transfer Switch', domain: 'AC',
  badge: 'ATS', badgeColor: 'red', width: 160, height: 140,
  connections: [
    { id: 'utility_in', x: 0,   y: 50,  dir: 'left',  domain: 'AC', label: 'UTIL' },
    { id: 'gen_in',     x: 0,   y: 90,  dir: 'left',  domain: 'AC', label: 'GEN' },
    { id: 'load_out',   x: 160, y: 70,  dir: 'right', domain: 'AC', label: 'LOAD' },
    { id: 'gnd',        x: 80,  y: 140, dir: 'bottom', domain: 'GND', label: 'GND' },
  ],
  labelAnchor: { x: 80, y: 152, anchor: 'middle', baseline: 'hanging' },
  svg: () => {
    const parts: string[] = [];
    const CX = 80;
    // ATS enclosure
    parts.push(p_rect(8, 8, 144, 122, { fill: '#FFF3E0', stroke: T.ATS_CLR, sw: 2.5, r: 5 }));
    parts.push(`<rect x="8" y="8" width="144" height="20" rx="5" fill="${T.ATS_CLR}"/>`);
    parts.push(`<rect x="8" y="22" width="144" height="6" fill="${T.ATS_CLR}"/>`);
    parts.push(p_text(CX, 19, 'TRANSFER SWITCH', { sz: 8, fill: T.WHITE, bold: true }));
    // Transfer mechanism: two inputs, one output
    // UTIL input (top)
    parts.push(p_rect(20, 36, 40, 20, { fill: '#FFE0B2', stroke: T.ATS_CLR, sw: 1.5, r: 3 }));
    parts.push(p_text(40, 47, 'UTIL', { sz: 8, fill: T.ATS_CLR, bold: true }));
    // GEN input (bottom)
    parts.push(p_rect(20, 80, 40, 20, { fill: '#FFCCBC', stroke: '#BF360C', sw: 1.5, r: 3 }));
    parts.push(p_text(40, 90, 'GEN', { sz: 8, fill: '#BF360C', bold: true }));
    // Transfer arm pivot
    parts.push(p_circle(75, 70, 8, { fill: T.WHITE, stroke: T.ATS_CLR, sw: 2 }));
    // Arm connected to UTIL (normal position)
    parts.push(p_line(60, 46, 75, 70, { stroke: T.ATS_CLR, sw: 2.5 }));
    // Dashed arm to GEN (alternate)
    parts.push(p_line(60, 90, 75, 70, { stroke: '#BF360C', sw: 2, dash: '4,3' }));
    // Output
    parts.push(p_rect(95, 55, 45, 30, { fill: '#FFF3E0', stroke: T.ATS_CLR, sw: 1.5, r: 3 }));
    parts.push(p_text(117, 68, 'LOAD', { sz: 8, fill: T.ATS_CLR, bold: true }));
    parts.push(p_line(83, 70, 95, 70, { stroke: T.ATS_CLR, sw: 2 }));
    // Status LED
    parts.push(p_circle(130, 105, 6, { fill: '#4CAF50', stroke: T.CAB_EDGE, sw: 1 }));
    parts.push(p_text(130, 118, 'UTIL', { sz: 7, fill: T.ATS_CLR }));
    // Leads
    parts.push(p_line(0, 50, 20, 50, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(0, 90, 20, 90, { stroke: T.AC_CLR, sw: 2 }));
    parts.push(p_line(140, 70, 160, 70, { stroke: T.AC_CLR, sw: 2 }));
    // GND lead
    parts.push(p_line(CX, 130, CX, 140, { stroke: T.GND, sw: 1.5, dash: '4,3' }));
    parts.push(cpDot(0, 50, 'AC'));
    parts.push(cpDot(0, 90, 'AC'));
    parts.push(cpDot(160, 70, 'AC'));
    parts.push(cpDot(CX, 140, 'GND'));
    return wrapSVG(160, 140, parts.join(''));
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT — Symbol Registry
// ═══════════════════════════════════════════════════════════════════════════════

export const SLD_SYMBOLS: SLDSymbol[] = [
  symPVArray,
  symInverter,
  symBatteryDC,
  symBatteryAC,
  symBUI,
  symGenerator,
  symACCombiner,
  symDCDisconnect,
  symACDisconnect,
  symFusedDisconnect,
  symGround,
  symFuse,
  symBreaker,
  symJunctionBox,
  symMSP,
  symSubPanel,
  symUtilityMeter,
  symATS,
];

export const SLD_SYMBOL_MAP: Record<string, SLDSymbol> = Object.fromEntries(
  SLD_SYMBOLS.map(s => [s.id, s])
);

export type SLDSymbolId = typeof SLD_SYMBOLS[number]['id'];

// ─── Line Type System ──────────────────────────────────────────────────────────
export interface LineType {
  label: string;
  sub: string;
  stroke: string;
  sw: number;
  dash?: string;
}

export const LINE_TYPES: Record<string, LineType> = {
  ac_power: {
    label: 'AC Power',
    sub: '2px solid — line-voltage conductors (L1, L2, N)',
    stroke: T.AC_CLR,
    sw: 2,
  },
  dc_power: {
    label: 'DC Power',
    sub: '1.5px solid — DC string and battery conductors',
    stroke: T.DC_CLR,
    sw: 1.5,
  },
  ground: {
    label: 'Equipment Ground',
    sub: '1.5px dashed green — EGC conductors',
    stroke: T.GND,
    sw: 1.5,
    dash: '4,3',
  },
  comms: {
    label: 'Communications / Data',
    sub: '1px dashed gray — monitoring, RS-485, Zigbee',
    stroke: T.GRAY,
    sw: 1,
    dash: '6,4',
  },
  neutral: {
    label: 'Neutral',
    sub: '1.5px solid gray — grounded conductor (N)',
    stroke: '#888888',
    sw: 1.5,
  },
};

// ─── Design Tokens Export ─────────────────────────────────────────────────────
export const DESIGN_TOKENS = {
  SW_PRIMARY:   T.SW_PRIMARY,
  SW_SECONDARY: T.SW_SECONDARY,
  SW_HAIR:      T.SW_HAIR,
  SW_BUS:       T.SW_BUS,
  BLACK:        T.BLACK,
  WHITE:        T.WHITE,
  GND:          T.GND,
  DC_CLR:       T.DC_CLR,
  AC_CLR:       T.AC_CLR,
  BAT_CLR:      T.BAT_CLR,
  GEN_CLR:      T.GEN_CLR,
  ATS_CLR:      T.ATS_CLR,
  BUI_ENP:      T.BUI_ENP,
  SUB_CLR:      T.SUB_CLR,
  GRAY:         T.GRAY,
  CAB_FILL:     T.CAB_FILL,
  CAB_EDGE:     T.CAB_EDGE,
  CAB_BAR:      T.CAB_BAR,
  CAB_VENT:     T.CAB_VENT,
  CAB_SCREW:    T.CAB_SCREW,
  PANEL_FILL:   T.PANEL_FILL,
  PANEL_GRID:   T.PANEL_GRID,
  PANEL_FRAME:  T.PANEL_FRAME,
  R:            T.R,
  GRID:         T.GRID,
} as const;