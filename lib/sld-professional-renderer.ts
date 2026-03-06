// ============================================================
// Professional SLD Renderer V13 — True IEEE Electrical Diagram
// ANSI C Landscape (24"×18") = 2304×1728px at 96 DPI
//
// ENGINEERING STANDARD: Every conductor terminates at a defined
// electrical point — breaker, busbar, lug, terminal block, or
// disconnect switch. No box-to-box wiring without showing
// internal termination logic.
//
// CORRECT TOPOLOGY ORDER (DO NOT DEVIATE):
//
//   MICROINVERTER:
//     PV Array → (open air) → Roof J-Box → AC Combiner
//     → AC Disconnect → MSP → Utility Meter → Grid
//
//   STRING INVERTER:
//     PV Array → (open air) → Roof J-Box → DC Disconnect
//     → Inverter → AC Disconnect → MSP → Utility Meter → Grid
//
// INTERNAL STRUCTURE SHOWN:
//   AC Combiner:   Branch breakers → combiner bus → feeder lugs
//   AC Disconnect: Line terminals → knife switch → load terminals
//   MSP (load-side):   Main breaker → main bus → solar breaker (load side)
//   MSP (supply-side): Service conductors → tap connectors → supply bus
//
// CONDUCTOR LABELING:
//   Every run labeled inline: gauge, insulation, conduit type/size
//   Open-air runs: green dashed line
//   Grounded conductors: green
// ============================================================

import type { RunSegment, MicroBranch } from './computed-system';
import type { ConductorBundle } from './segment-schedule';

// ── Canvas ──────────────────────────────────────────────────────────────────
const W = 2304;
const H = 1728;
const MAR = 40;

// Title block (right side)
const TB_W = 272;
const TB_X = W - TB_W - MAR;

// Drawing area
const DX = MAR;
const DY = MAR;
const DW = TB_X - MAR - 10;
const DH = H - MAR * 2;

// Schematic area — upper 54% of drawing height
const SCH_X = DX;
const SCH_Y = DY + 28;
const SCH_W = DW;
const SCH_H = Math.round(DH * 0.54);

// Main bus line — sits at 48% of schematic height
const BUS_Y = SCH_Y + Math.round(SCH_H * 0.48);

// Ground rail sits below bus
const GND_RAIL_Y = BUS_Y + 120;

// Bottom panels
const CALC_Y  = SCH_Y + SCH_H + 6;
const CALC_H  = 185;
const SCHED_Y = CALC_Y + CALC_H + 6;
const SCHED_H = H - MAR - SCHED_Y;

// ── Colors ──────────────────────────────────────────────────────────────────
const BLK      = '#000000';
const GRN      = '#004400';   // grounding ONLY
const WHT      = '#FFFFFF';
const LGY      = '#F4F4F4';
const LGRY2    = '#E8E8E8';   // panel interior fill
const PASS_CLR = '#005500';
const FAIL_CLR = '#BB0000';
const OPEN_AIR_CLR = '#006600';   // open-air run color
const BUS_CLR  = '#1A1A1A';   // busbar color
const BRK_CLR  = '#222222';   // breaker fill
const LOAD_SIDE_CLR = '#1B5E20'; // load-side interconnection
const SUPPLY_SIDE_CLR = '#0D47A1'; // supply-side interconnection

// ── Stroke widths ────────────────────────────────────────────────────────────
const SW_BORDER = 3.0;
const SW_HEAVY  = 2.5;
const SW_MED    = 1.8;
const SW_THIN   = 1.2;
const SW_HAIR   = 0.6;
const SW_BUS    = 4.0;   // busbar stroke width

// ── Font sizes ───────────────────────────────────────────────────────────────
const F = {
  title:  13,
  hdr:     9,
  label:   8,
  sub:     7,
  seg:     6.5,   // inline segment label
  tiny:    6.5,
  note:    6.5,
  tb:      7.5,
  tbTitle: 11,
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
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function txt(x: number, y: number, content: string,
  opts: { size?: number; bold?: boolean; anchor?: 'start'|'middle'|'end'; fill?: string; italic?: boolean } = {}
): string {
  const sz  = opts.size   ?? F.label;
  const bld = opts.bold   ? `font-weight="bold"` : '';
  const anc = `text-anchor="${opts.anchor ?? 'start'}"`;
  const clr = `fill="${opts.fill ?? BLK}"`;
  const itl = opts.italic ? `font-style="italic"` : '';
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} ${itl} dominant-baseline="auto">${esc(content)}</text>`;
}

function tspanBlock(x: number, y: number, lines: string[],
  opts: { size?: number; bold?: boolean; anchor?: 'start'|'middle'|'end'; fill?: string; lh?: number } = {}
): string {
  if (!lines.length) return '';
  const sz  = opts.size ?? F.seg;
  const bld = opts.bold ? `font-weight="bold"` : '';
  const anc = `text-anchor="${opts.anchor ?? 'middle'}"`;
  const clr = `fill="${opts.fill ?? BLK}"`;
  const lh  = opts.lh ?? Math.round(sz * 1.45);
  const spans = lines.map((l, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`
  ).join('');
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${sz}" ${bld} ${anc} ${clr} dominant-baseline="auto">${spans}</text>`;
}

function rect(x: number, y: number, w: number, h: number,
  opts: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string } = {}
): string {
  const f  = opts.fill   ?? WHT;
  const s  = opts.stroke ?? BLK;
  const sw = opts.sw     ?? SW_THIN;
  const rx = opts.rx     ? `rx="${opts.rx}"` : '';
  const da = opts.dash   ? `stroke-dasharray="${opts.dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="${sw}" ${rx} ${da}/>`;
}

function ln(x1: number, y1: number, x2: number, y2: number,
  opts: { stroke?: string; sw?: number; dash?: string } = {}
): string {
  const s  = opts.stroke ?? BLK;
  const sw = opts.sw     ?? SW_MED;
  const da = opts.dash   ? `stroke-dasharray="${opts.dash}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${s}" stroke-width="${sw}" ${da}/>`;
}

function circ(cx: number, cy: number, r: number,
  opts: { fill?: string; stroke?: string; sw?: number } = {}
): string {
  const f  = opts.fill   ?? WHT;
  const s  = opts.stroke ?? BLK;
  const sw = opts.sw     ?? SW_THIN;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
}

// IEEE numbered callout circle
function calloutNum(cx: number, cy: number, n: number, r = 11): string {
  return circ(cx, cy, r, { fill: WHT, stroke: BLK, sw: SW_MED })
    + txt(cx, cy + 1, String(n), { size: F.hdr, bold: true, anchor: 'middle' });
}

// Ground symbol (IEEE 315)
function gndSym(x: number, y: number): string {
  return [
    ln(x, y, x, y + 10, { stroke: GRN, sw: SW_MED }),
    ln(x - 10, y + 10, x + 10, y + 10, { stroke: GRN, sw: SW_MED }),
    ln(x - 7,  y + 15, x + 7,  y + 15, { stroke: GRN, sw: SW_MED }),
    ln(x - 4,  y + 20, x + 4,  y + 20, { stroke: GRN, sw: SW_MED }),
  ].join('');
}

// ── Breaker Symbol (NEMA/IEEE style) ─────────────────────────────────────────
// Draws a single-pole breaker: two terminals + arc body
function breakerSym(cx: number, cy: number, w = 20, h = 14,
  opts: { label?: string; amps?: number; fill?: string } = {}
): string {
  const bx = cx - w/2;
  const by = cy - h/2;
  const f  = opts.fill ?? WHT;
  const parts: string[] = [];
  // Body
  parts.push(rect(bx, by, w, h, { fill: f, stroke: BLK, sw: SW_THIN, rx: 2 }));
  // Arc symbol inside
  parts.push(`<path d="M${cx-5},${cy+3} Q${cx},${cy-5} ${cx+5},${cy+3}" fill="none" stroke="${BLK}" stroke-width="${SW_HAIR}"/>`);
  // Amp label
  if (opts.amps) {
    parts.push(txt(cx, by - 2, `${opts.amps}A`, { size: 5.5, anchor: 'middle', bold: true }));
  }
  return parts.join('');
}

// ── Fuse Symbol ──────────────────────────────────────────────────────────────
function fuseSym(cx: number, cy: number, w = 18, h = 10): string {
  const parts: string[] = [];
  parts.push(rect(cx - w/2, cy - h/2, w, h, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(ln(cx - w/2 - 6, cy, cx - w/2, cy, { sw: SW_MED }));
  parts.push(ln(cx + w/2, cy, cx + w/2 + 6, cy, { sw: SW_MED }));
  return parts.join('');
}

// ── Knife-blade disconnect (IEEE 315) ────────────────────────────────────────
function discoSym(cx: number, cy: number, w = 52, h = 16): string {
  const lx = cx - w/2, rx = cx + w/2;
  return [
    ln(lx, cy, lx + 11, cy, { sw: SW_MED }),
    ln(rx - 11, cy, rx, cy, { sw: SW_MED }),
    ln(lx + 11, cy, rx - 11, cy - h * 0.5, { sw: SW_MED }),
    circ(lx + 11, cy, 3, { fill: BLK }),
    circ(rx - 11, cy, 3, { fill: WHT }),
  ].join('');
}

// ── Terminal Lug Symbol ──────────────────────────────────────────────────────
function lugSym(cx: number, cy: number, r = 4): string {
  return circ(cx, cy, r, { fill: WHT, stroke: BLK, sw: SW_THIN })
    + circ(cx, cy, 1.5, { fill: BLK, stroke: BLK, sw: 0 });
}

// ── Busbar ───────────────────────────────────────────────────────────────────
function busbar(x1: number, x2: number, y: number, label?: string): string {
  const parts: string[] = [];
  parts.push(ln(x1, y, x2, y, { stroke: BUS_CLR, sw: SW_BUS }));
  if (label) {
    parts.push(txt((x1 + x2) / 2, y - 5, label, { size: 5.5, anchor: 'middle', bold: true, fill: BUS_CLR }));
  }
  return parts.join('');
}

// ── Inline Segment Label ─────────────────────────────────────────────────────
// Renders conductor/conduit info DIRECTLY ON the wire segment line.
function segmentLabel(
  x1: number, x2: number, y: number,
  lines: string[],
  opts: { isOpenAir?: boolean; bundleCount?: number; strokeWidth?: number; above?: boolean } = {}
): string {
  const isOA  = opts.isOpenAir   ?? false;
  const cnt   = Math.min(opts.bundleCount ?? 1, 6);
  const sw    = opts.strokeWidth ?? SW_HEAVY;
  const color = isOA ? OPEN_AIR_CLR : BLK;
  const dash  = isOA ? '8,4' : undefined;
  const cx    = (x1 + x2) / 2;
  const above = opts.above ?? true;
  const parts: string[] = [];

  // Draw bundled conductor lines
  if (cnt <= 1) {
    parts.push(ln(x1, y, x2, y, { stroke: color, sw, dash }));
  } else {
    const spacing = 3;
    const totalSpan = (cnt - 1) * spacing;
    const startY = y - totalSpan / 2;
    for (let i = 0; i < cnt; i++) {
      parts.push(ln(x1, startY + i * spacing, x2, startY + i * spacing, { stroke: color, sw: SW_THIN, dash }));
    }
    parts.push(ln(x1, startY, x1, startY + totalSpan, { stroke: color, sw: SW_HAIR }));
    parts.push(ln(x2, startY, x2, startY + totalSpan, { stroke: color, sw: SW_HAIR }));
  }

  // Inline text label — centered above or below the segment line
  if (lines.length > 0) {
    const lineH = Math.round(F.seg * 1.4);
    const totalTextH = lines.length * lineH;
    const textY = above
      ? y - 6 - totalTextH + lineH
      : y + 10;
    parts.push(tspanBlock(cx, textY, lines, {
      size: F.seg, anchor: 'middle', fill: color,
    }));
  }

  return parts.join('');
}

// ── Build label lines from RunSegment ────────────────────────────────────────
function runToSegmentLines(
  run: RunSegment | undefined,
  fallback: string[]
): { lines: string[]; bundleCount: number; isOpenAir: boolean } {
  if (!run) return { lines: fallback, bundleCount: 1, isOpenAir: false };

  const isOpenAir = run.isOpenAir ?? false;
  let lines: string[] = [];
  let bundleCount = 1;

  if (run.conductorBundle && run.conductorBundle.length > 0) {
    const hotConductors = run.conductorBundle.filter((c: ConductorBundle) => c.isCurrentCarrying);
    const egcConductors = run.conductorBundle.filter((c: ConductorBundle) => !c.isCurrentCarrying);
    bundleCount = Math.min(run.conductorBundle.reduce((s: number, c: ConductorBundle) => s + c.qty, 0), 6);

    const hotStr = hotConductors.map((c: ConductorBundle) => {
      const g = c.gauge.replace('#', '').replace(' AWG', '');
      const colorLabel = c.color === 'BLK' ? 'BLK' : c.color === 'RED' ? 'RED' : c.color === 'WHT' ? 'WHT' : c.color;
      return `${c.qty}×#${g} ${c.insulation} ${colorLabel}`;
    }).join(' + ');

    const egcStr = egcConductors.map((c: ConductorBundle) => {
      const g = c.gauge.replace('#', '').replace(' AWG', '');
      return `${c.qty}×#${g} GRN EGC`;
    }).join(' + ');

    let conduitStr = '';
    if (isOpenAir) {
      conduitStr = 'OPEN AIR — NEC 690.31';
    } else {
      const abbrev = run.conduitType === 'EMT' ? 'EMT'
        : run.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
        : run.conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
        : run.conduitType || 'EMT';
      const fill = run.conduitFillPct > 0 ? ` — ${run.conduitFillPct.toFixed(0)}% FILL` : '';
      conduitStr = `IN ${run.conduitSize} ${abbrev}${fill}`;
    }

    if (hotStr) lines.push(hotStr);
    if (egcStr) lines.push(egcStr);
    if (conduitStr) lines.push(conduitStr);

  } else if (run.conductorCallout) {
    lines = run.conductorCallout.split('\n').filter(l => l.trim());
    bundleCount = run.conductorCount ?? 1;
  } else {
    const g  = run.wireGauge.replace('#', '').replace(' AWG', '');
    const eg = run.egcGauge.replace('#', '').replace(' AWG', '');
    bundleCount = run.conductorCount ?? 1;
    lines.push(`${run.conductorCount}×#${g} ${run.insulation}`);
    lines.push(`1×#${eg} GRN EGC`);
    if (isOpenAir) {
      lines.push('OPEN AIR — NEC 690.31');
    } else {
      const abbrev = run.conduitType === 'EMT' ? 'EMT'
        : run.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
        : run.conduitType || 'EMT';
      const fill = run.conduitFillPct > 0 ? ` — ${run.conduitFillPct.toFixed(0)}% FILL` : '';
      lines.push(`IN ${run.conduitSize} ${abbrev}${fill}`);
    }
  }

  return { lines, bundleCount, isOpenAir };
}

// ── AC Combiner with Internal Structure ──────────────────────────────────────
// Shows: Branch circuit inputs → individual branch breakers → combiner bus → feeder lugs → output
function renderACCombiner(
  cx: number, cy: number,
  nBranches: number,
  branchOcpd: number,
  combinerLabel: string,
  calloutN: number
): { svg: string; leftX: number; rightX: number; topY: number; bottomY: number } {
  const cbW = 90, cbH = 100;
  const bx = cx - cbW/2, by = cy - cbH/2;
  const parts: string[] = [];

  // Outer enclosure
  parts.push(rect(bx, by, cbW, cbH, { fill: LGRY2, stroke: BLK, sw: SW_MED }));

  // Header label inside
  parts.push(rect(bx, by, cbW, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(cx, by + 9, 'AC COMBINER', { size: 5.5, bold: true, anchor: 'middle', fill: WHT }));

  // Internal busbar (horizontal, center of box)
  const busY = cy + 10;
  const busX1 = bx + 8;
  const busX2 = bx + cbW - 8;
  parts.push(busbar(busX1, busX2, busY, 'COMBINER BUS'));

  // Branch breakers on left side — each branch circuit terminates at a breaker
  const nShow = Math.min(nBranches, 4);
  const branchSpacing = (cbH - 30) / (nShow + 1);
  for (let b = 0; b < nShow; b++) {
    const brY = by + 18 + branchSpacing * (b + 1);
    const brkCX = bx + 22;
    // Input lug on left edge
    parts.push(lugSym(bx + 4, brY));
    // Wire from lug to breaker
    parts.push(ln(bx + 8, brY, brkCX - 10, brY, { sw: SW_THIN }));
    // Breaker
    parts.push(breakerSym(brkCX, brY, 18, 12, { amps: branchOcpd }));
    // Wire from breaker to bus
    parts.push(ln(brkCX + 9, brY, busX1 + 5, busY, { sw: SW_THIN }));
  }
  if (nBranches > 4) {
    parts.push(txt(bx + 22, busY - 8, `+${nBranches - 4} more`, { size: 5, anchor: 'middle', fill: '#555' }));
  }

  // Feeder lug on right side — output conductor terminates here
  const lugY = busY;
  parts.push(ln(busX2, busY, bx + cbW - 8, lugY, { sw: SW_THIN }));
  parts.push(lugSym(bx + cbW - 4, lugY));
  parts.push(txt(bx + cbW - 4, lugY + 10, 'FEEDER\nLUG', { size: 5, anchor: 'middle' }));

  // Output wire stub right
  parts.push(ln(bx + cbW, lugY, bx + cbW + 12, lugY, { sw: SW_MED }));

  // Labels below
  parts.push(txt(cx, by + cbH + 10, esc(combinerLabel), { size: F.tiny, anchor: 'middle', italic: true }));
  parts.push(txt(cx, by + cbH + 19, `${nBranches} branch inputs`, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(cx, by + cbH + 28, 'NEC 690.9', { size: F.tiny, anchor: 'middle', italic: true }));

  // Callout
  parts.push(calloutNum(bx + cbW + 14, by - 5, calloutN));

  return {
    svg: parts.join(''),
    leftX: bx,
    rightX: bx + cbW + 12,
    topY: by,
    bottomY: by + cbH,
  };
}

// ── AC Disconnect with Internal Structure ────────────────────────────────────
// Shows: Line terminals → knife switch → load terminals
function renderACDisco(
  cx: number, cy: number,
  ocpdAmps: number,
  calloutN: number
): { svg: string; leftX: number; rightX: number } {
  const dW = 88, dH = 64;
  const bx = cx - dW/2, by = cy - dH/2;
  const parts: string[] = [];

  // Outer enclosure
  parts.push(rect(bx, by, dW, dH, { fill: LGRY2, stroke: BLK, sw: SW_MED }));

  // Header
  parts.push(rect(bx, by, dW, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(cx, by + 9, 'AC DISCONNECT', { size: 5.5, bold: true, anchor: 'middle', fill: WHT }));

  // Line terminals (left side) — conductors from combiner/inverter land here
  const lineTermY = cy + 2;
  parts.push(lugSym(bx + 8, lineTermY - 8));
  parts.push(lugSym(bx + 8, lineTermY + 8));
  parts.push(txt(bx + 8, lineTermY + 20, 'LINE', { size: 5, anchor: 'middle', bold: true }));

  // Wire from line terminals to switch
  parts.push(ln(bx + 12, lineTermY - 8, cx - 14, lineTermY - 8, { sw: SW_THIN }));
  parts.push(ln(bx + 12, lineTermY + 8, cx - 14, lineTermY + 8, { sw: SW_THIN }));

  // Knife switch symbol (2-pole)
  parts.push(discoSym(cx, lineTermY - 8, 28, 12));
  parts.push(discoSym(cx, lineTermY + 8, 28, 12));

  // Wire from switch to load terminals
  parts.push(ln(cx + 14, lineTermY - 8, bx + dW - 12, lineTermY - 8, { sw: SW_THIN }));
  parts.push(ln(cx + 14, lineTermY + 8, bx + dW - 12, lineTermY + 8, { sw: SW_THIN }));

  // Load terminals (right side) — conductors to MSP land here
  parts.push(lugSym(bx + dW - 8, lineTermY - 8));
  parts.push(lugSym(bx + dW - 8, lineTermY + 8));
  parts.push(txt(bx + dW - 8, lineTermY + 20, 'LOAD', { size: 5, anchor: 'middle', bold: true }));

  // Input/output wire stubs
  parts.push(ln(bx - 12, cy, bx, lineTermY - 8, { sw: SW_MED }));
  parts.push(ln(bx - 12, cy, bx, lineTermY + 8, { sw: SW_MED }));
  parts.push(ln(bx + dW, lineTermY - 8, bx + dW + 12, cy, { sw: SW_MED }));
  parts.push(ln(bx + dW, lineTermY + 8, bx + dW + 12, cy, { sw: SW_MED }));

  // Labels below
  parts.push(txt(cx, by + dH + 10, `${ocpdAmps}A NON-FUSED`, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(cx, by + dH + 19, 'NEC 690.14', { size: F.tiny, anchor: 'middle', italic: true }));

  // Callout
  parts.push(calloutNum(bx + dW + 16, by - 5, calloutN));

  return {
    svg: parts.join(''),
    leftX: bx - 12,
    rightX: bx + dW + 12,
  };
}

// ── MSP with Internal Structure (Load-Side) ──────────────────────────────────
// Shows: Main breaker → main busbar → solar breaker (load side) → feeder lugs
function renderMSPLoadSide(
  cx: number, cy: number,
  mainAmps: number,
  solarBreakerAmps: number,
  calloutN: number
): { svg: string; leftX: number; rightX: number } {
  const mW = 100, mH = 130;
  const bx = cx - mW/2, by = cy - mH/2;
  const parts: string[] = [];

  // Outer enclosure
  parts.push(rect(bx, by, mW, mH, { fill: LGRY2, stroke: BLK, sw: SW_MED }));

  // Header
  parts.push(rect(bx, by, mW, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(cx, by + 9, 'MAIN SERVICE PANEL', { size: 5.5, bold: true, anchor: 'middle', fill: WHT }));

  // Service entrance conductors land on main breaker (top)
  const mainBrkY = by + 28;
  parts.push(txt(cx, mainBrkY - 10, `${mainAmps}A MAIN BREAKER`, { size: 5.5, anchor: 'middle', bold: true }));
  parts.push(breakerSym(cx, mainBrkY, 36, 16, { amps: mainAmps, fill: LGRY2 }));

  // Main busbar below main breaker
  const mainBusY = mainBrkY + 22;
  const busX1 = bx + 8;
  const busX2 = bx + mW - 8;
  parts.push(busbar(busX1, busX2, mainBusY, 'MAIN BUS'));

  // Wire from main breaker to main bus
  parts.push(ln(cx, mainBrkY + 8, cx, mainBusY, { sw: SW_MED }));

  // Neutral bar (left side)
  const neutralX = bx + 12;
  const neutralY1 = mainBusY + 15;
  const neutralY2 = mainBusY + 45;
  parts.push(ln(neutralX, neutralY1, neutralX, neutralY2, { stroke: '#555', sw: 3.0 }));
  parts.push(txt(neutralX, neutralY2 + 8, 'N', { size: 6, anchor: 'middle', bold: true, fill: '#555' }));

  // Ground bar (right side)
  const groundX = bx + mW - 12;
  parts.push(ln(groundX, neutralY1, groundX, neutralY2, { stroke: GRN, sw: 3.0 }));
  parts.push(txt(groundX, neutralY2 + 8, 'G', { size: 6, anchor: 'middle', bold: true, fill: GRN }));
  parts.push(gndSym(groundX, neutralY2 + 10));

  // Solar breaker on main bus (load side) — this is where PV backfeeds
  const solarBrkX = cx + 18;
  const solarBrkY = mainBusY + 30;
  // Wire from bus down to solar breaker
  parts.push(ln(solarBrkX, mainBusY, solarBrkX, solarBrkY - 8, { sw: SW_THIN }));
  parts.push(breakerSym(solarBrkX, solarBrkY, 22, 14, { amps: solarBreakerAmps, fill: '#E8F5E9' }));
  parts.push(txt(solarBrkX, solarBrkY + 14, 'PV', { size: 5.5, anchor: 'middle', bold: true, fill: LOAD_SIDE_CLR }));
  parts.push(txt(solarBrkX, solarBrkY + 21, 'BREAKER', { size: 5, anchor: 'middle', fill: LOAD_SIDE_CLR }));

  // Feeder lug below solar breaker — AC feeder from disco terminates here
  const lugY = solarBrkY + 30;
  parts.push(ln(solarBrkX, solarBrkY + 7, solarBrkX, lugY - 4, { sw: SW_THIN }));
  parts.push(lugSym(solarBrkX, lugY));
  parts.push(txt(solarBrkX, lugY + 10, 'LOAD LUG', { size: 5, anchor: 'middle' }));

  // Input wire stub from left (from AC disco)
  parts.push(ln(bx - 12, cy, bx, cy, { sw: SW_MED }));
  // Route from left edge to solar breaker lug
  parts.push(ln(bx, cy, bx + 8, cy, { sw: SW_MED }));
  parts.push(ln(bx + 8, cy, solarBrkX, lugY, { sw: SW_MED }));

  // Output wire stub to right (to utility meter)
  parts.push(ln(bx + mW, mainBusY, bx + mW + 12, mainBusY, { sw: SW_MED }));

  // Labels below
  parts.push(txt(cx, by + mH + 10, `${mainAmps}A RATED`, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(cx, by + mH + 19, 'LOAD SIDE TAP — NEC 705.12(B)', { size: F.tiny, anchor: 'middle', bold: true, fill: LOAD_SIDE_CLR }));
  parts.push(txt(cx, by + mH + 28, `${solarBreakerAmps}A PV BREAKER`, { size: F.tiny, anchor: 'middle', fill: LOAD_SIDE_CLR }));

  // Callout
  parts.push(calloutNum(bx + mW + 16, by - 5, calloutN));

  return {
    svg: parts.join(''),
    leftX: bx - 12,
    rightX: bx + mW + 12,
  };
}

// ── MSP with Internal Structure (Supply-Side / Backfed) ──────────────────────
// Shows: Service conductors → tap connectors → supply bus → main breaker → utility
function renderMSPSupplySide(
  cx: number, cy: number,
  mainAmps: number,
  backfeedAmps: number,
  isSupplySide: boolean,
  calloutN: number
): { svg: string; leftX: number; rightX: number } {
  const mW = 100, mH = 120;
  const bx = cx - mW/2, by = cy - mH/2;
  const parts: string[] = [];

  // Outer enclosure
  parts.push(rect(bx, by, mW, mH, { fill: LGRY2, stroke: BLK, sw: SW_MED }));

  // Header
  parts.push(rect(bx, by, mW, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(cx, by + 9, 'MAIN SERVICE PANEL', { size: 5.5, bold: true, anchor: 'middle', fill: WHT }));

  // Main busbar (center)
  const mainBusY = by + 40;
  const busX1 = bx + 8;
  const busX2 = bx + mW - 8;
  parts.push(busbar(busX1, busX2, mainBusY, 'MAIN BUS'));

  if (isSupplySide) {
    // Supply-side tap: tap connectors on service conductors
    const tapX = bx + 28;
    const tapY = mainBusY - 18;
    parts.push(txt(tapX, tapY - 8, 'TAP', { size: 5.5, anchor: 'middle', bold: true, fill: SUPPLY_SIDE_CLR }));
    parts.push(txt(tapX, tapY - 1, 'CONNECTOR', { size: 5, anchor: 'middle', fill: SUPPLY_SIDE_CLR }));
    // Tap symbol (T-junction)
    parts.push(ln(tapX - 10, tapY + 5, tapX + 10, tapY + 5, { stroke: SUPPLY_SIDE_CLR, sw: SW_MED }));
    parts.push(ln(tapX, tapY + 5, tapX, mainBusY, { stroke: SUPPLY_SIDE_CLR, sw: SW_MED }));
    parts.push(circ(tapX, tapY + 5, 3, { fill: SUPPLY_SIDE_CLR, stroke: SUPPLY_SIDE_CLR, sw: 0 }));
    parts.push(txt(cx, by + mH + 10, `${mainAmps}A RATED`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(cx, by + mH + 19, 'SUPPLY SIDE TAP — NEC 705.11', { size: F.tiny, anchor: 'middle', bold: true, fill: SUPPLY_SIDE_CLR }));
  } else {
    // Backfed breaker: solar breaker on main bus
    const solarBrkX = cx;
    const solarBrkY = mainBusY + 28;
    parts.push(ln(solarBrkX, mainBusY, solarBrkX, solarBrkY - 7, { sw: SW_THIN }));
    parts.push(breakerSym(solarBrkX, solarBrkY, 26, 16, { amps: backfeedAmps, fill: '#FFF9C4' }));
    parts.push(txt(solarBrkX, solarBrkY + 14, 'BACKFED', { size: 5.5, anchor: 'middle', bold: true }));
    parts.push(txt(solarBrkX, solarBrkY + 21, 'BREAKER', { size: 5, anchor: 'middle' }));
    parts.push(txt(cx, by + mH + 10, `${mainAmps}A RATED`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(cx, by + mH + 19, `${backfeedAmps}A BACKFED BREAKER`, { size: F.tiny, anchor: 'middle', bold: true }));
    parts.push(txt(cx, by + mH + 28, 'NEC 705.12(B)(2)', { size: F.tiny, anchor: 'middle', italic: true }));
  }

  // Main breaker (right side, toward utility)
  const mainBrkX = bx + mW - 22;
  const mainBrkY = mainBusY;
  parts.push(ln(busX2 - 8, mainBusY, mainBrkX - 13, mainBusY, { sw: SW_THIN }));
  parts.push(breakerSym(mainBrkX, mainBrkY, 22, 14, { amps: mainAmps, fill: LGRY2 }));
  parts.push(txt(mainBrkX, mainBrkY + 14, 'MAIN', { size: 5, anchor: 'middle', bold: true }));

  // Neutral bar
  const neutralX = bx + 12;
  parts.push(ln(neutralX, mainBusY + 10, neutralX, mainBusY + 40, { stroke: '#555', sw: 3.0 }));
  parts.push(txt(neutralX, mainBusY + 48, 'N', { size: 6, anchor: 'middle', bold: true, fill: '#555' }));

  // Ground bar
  const groundX = bx + mW - 12;
  parts.push(ln(groundX, mainBusY + 10, groundX, mainBusY + 40, { stroke: GRN, sw: 3.0 }));
  parts.push(txt(groundX, mainBusY + 48, 'G', { size: 6, anchor: 'middle', bold: true, fill: GRN }));
  parts.push(gndSym(groundX, mainBusY + 50));

  // Input wire stub from left (from AC disco)
  parts.push(ln(bx - 12, cy, bx, cy, { sw: SW_MED }));

  // Output wire stub to right (to utility meter)
  parts.push(ln(mainBrkX + 11, mainBusY, bx + mW + 12, mainBusY, { sw: SW_MED }));

  // Callout
  parts.push(calloutNum(bx + mW + 16, by - 5, calloutN));

  return {
    svg: parts.join(''),
    leftX: bx - 12,
    rightX: bx + mW + 12,
  };
}

// ── Main Render ──────────────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  const parts: string[] = [];
  const isMicro = input.topologyType === 'MICROINVERTER';

  const findRun = (id: string): RunSegment | undefined =>
    input.runs?.find(r => r.id === id);

  // Resolve key values from runs (with fallbacks)
  const roofRun        = findRun('ROOF_RUN');
  const branchRun      = findRun('BRANCH_RUN');
  const combDiscoRun   = findRun('COMBINER_TO_DISCO_RUN');
  const dcStringRun    = findRun('DC_STRING_RUN');
  const dcDiscoInvRun  = findRun('DC_DISCO_TO_INV_RUN');
  const invDiscoRun    = findRun('INV_TO_DISCO_RUN');
  const discoMspRun    = findRun('DISCO_TO_METER_RUN');
  const mspUtilRun     = findRun('MSP_TO_UTILITY_RUN');

  // Resolve AC wire gauge / OCPD from the feeder run
  const acFeederRun           = isMicro ? combDiscoRun : invDiscoRun;
  const resolvedAcWireGauge   = acFeederRun?.wireGauge   ?? input.acWireGauge   ?? '#6 AWG';
  const resolvedAcOCPD        = acFeederRun?.ocpdAmps     ?? input.acOCPD        ?? 30;
  const resolvedAcConduitSize = acFeederRun?.conduitSize  ?? '3/4"';
  const resolvedAcConduitType = acFeederRun?.conduitType  ?? input.acConduitType ?? 'EMT';
  const resolvedDcWireGauge   = dcStringRun?.wireGauge    ?? input.dcWireGauge   ?? '#10 AWG';

  // Interconnection type
  const intercon     = String(input.interconnection ?? 'Backfed Breaker').toLowerCase();
  const isLoadSide   = intercon.includes('load');
  const isSupplySide = intercon.includes('supply');
  const isLineSide   = intercon.includes('line');
  const isBackfed    = !isLoadSide && !isSupplySide && !isLineSide;

  // Solar breaker amps (for load-side tap)
  const solarBreakerAmps = input.backfeedAmps ?? resolvedAcOCPD;

  // ── SVG root ──────────────────────────────────────────────────────────────
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};font-family:Arial,Helvetica,sans-serif;">`);
  parts.push(rect(0, 0, W, H, { fill: WHT, stroke: WHT, sw: 0 }));
  parts.push(rect(MAR/2, MAR/2, W - MAR, H - MAR, { fill: WHT, stroke: BLK, sw: SW_BORDER }));

  // ── Title ─────────────────────────────────────────────────────────────────
  const titleCX = (DX + TB_X) / 2;
  parts.push(txt(titleCX, DY + 16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {
    size: F.title, bold: true, anchor: 'middle',
  }));
  parts.push(txt(titleCX, DY + 26,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    { size: F.sub, anchor: 'middle', fill: '#444' }
  ));

  // ── Schematic border ──────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));

  // ── Component X positions ─────────────────────────────────────────────────
  const xPad    = 55;
  const usableW = SCH_W - xPad * 2;

  let xPV: number, xJBox: number, xCombOrDCDis: number, xInvOrACDis: number;
  let xACDis: number, xMSP: number, xUtil: number;

  if (isMicro) {
    // 5 nodes: PV | J-Box | AC Combiner | AC Disco | MSP | Utility
    xPV           = SCH_X + xPad;
    xJBox         = SCH_X + xPad + usableW * 0.17;
    xCombOrDCDis  = SCH_X + xPad + usableW * 0.35;  // AC Combiner
    xInvOrACDis   = SCH_X + xPad + usableW * 0.55;  // AC Disconnect
    xACDis        = xInvOrACDis;
    xMSP          = SCH_X + xPad + usableW * 0.74;
    xUtil         = SCH_X + xPad + usableW;
  } else {
    // 6 nodes: PV | J-Box | DC Disco | Inverter | AC Disco | MSP | Utility
    xPV           = SCH_X + xPad;
    xJBox         = SCH_X + xPad + usableW * 0.13;
    xCombOrDCDis  = SCH_X + xPad + usableW * 0.27;  // DC Disconnect
    xInvOrACDis   = SCH_X + xPad + usableW * 0.43;  // Inverter
    xACDis        = SCH_X + xPad + usableW * 0.60;  // AC Disconnect
    xMSP          = SCH_X + xPad + usableW * 0.78;
    xUtil         = SCH_X + xPad + usableW;
  }

  // ── NODE 1: PV ARRAY ──────────────────────────────────────────────────────
  const pvW = 84, pvH = 72;
  const pvCX = xPV, pvCY = BUS_Y;

  parts.push(rect(pvCX - pvW/2, pvCY - pvH/2, pvW, pvH, { fill: WHT, sw: SW_MED }));
  // Cell grid
  for (let gx = 1; gx < 3; gx++)
    parts.push(ln(pvCX - pvW/2 + gx*pvW/3, pvCY - pvH/2, pvCX - pvW/2 + gx*pvW/3, pvCY + pvH/2, { sw: SW_HAIR }));
  for (let gy = 1; gy < 3; gy++)
    parts.push(ln(pvCX - pvW/2, pvCY - pvH/2 + gy*pvH/3, pvCX + pvW/2, pvCY - pvH/2 + gy*pvH/3, { sw: SW_HAIR }));
  parts.push(txt(pvCX - pvW/2 + 5, pvCY - pvH/2 + 11, '+', { size: 9, bold: true }));
  parts.push(txt(pvCX + pvW/2 - 12, pvCY - pvH/2 + 11, '−', { size: 9, bold: true }));

  parts.push(txt(pvCX, pvCY - pvH/2 - 18, 'PV ARRAY', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY - pvH/2 - 8,  `${input.totalModules} × ${input.panelWatts}W`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 9,  esc(input.panelModel), { size: F.tiny, anchor: 'middle', italic: true }));
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    parts.push(txt(pvCX, pvCY + pvH/2 + 18, `${md} microinverters`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(pvCX, pvCY + pvH/2 + 27, `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, { size: F.tiny, anchor: 'middle', italic: true }));
  } else {
    const strLabel = input.totalStrings > 1
      ? `${input.totalStrings} strings × ${input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1))} panels`
      : `${input.totalModules} modules`;
    parts.push(txt(pvCX, pvCY + pvH/2 + 18, strLabel, { size: F.tiny, anchor: 'middle' }));
  }
  parts.push(calloutNum(pvCX + pvW/2 + 14, pvCY - pvH/2 - 5, 1));

  const pvOutX = pvCX + pvW/2;

  // ── NODE 2: ROOF J-BOX ────────────────────────────────────────────────────
  const jbW = 44, jbH = 44;
  const jbCX = xJBox, jbCY = BUS_Y;

  parts.push(rect(jbCX - jbW/2, jbCY - jbH/2, jbW, jbH, { fill: WHT, sw: SW_MED }));
  // X symbol inside junction box
  parts.push(ln(jbCX - jbW/2 + 6, jbCY - jbH/2 + 6, jbCX + jbW/2 - 6, jbCY + jbH/2 - 6, { sw: SW_HAIR }));
  parts.push(ln(jbCX + jbW/2 - 6, jbCY - jbH/2 + 6, jbCX - jbW/2 + 6, jbCY + jbH/2 - 6, { sw: SW_HAIR }));
  // Terminal lugs inside J-Box
  parts.push(lugSym(jbCX - jbW/2 + 8, jbCY));
  parts.push(lugSym(jbCX + jbW/2 - 8, jbCY));

  parts.push(txt(jbCX, jbCY - jbH/2 - 16, 'ROOF J-BOX', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(jbCX, jbCY - jbH/2 - 7,  isMicro ? 'AC TRUNK JUNCTION' : 'DC STRING JUNCTION', { size: F.tiny, anchor: 'middle' }));
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? Math.ceil(md / 16);
    const branchOcpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    parts.push(txt(jbCX, jbCY + jbH/2 + 9,  `${nb} branch circuits`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(jbCX, jbCY + jbH/2 + 18, `${branchOcpd}A OCPD ea.`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(jbCX, jbCY + jbH/2 + 27, 'NEC 690.8(B) MAX 16/BR', { size: F.tiny, anchor: 'middle', italic: true }));
  } else {
    const strCount = input.totalStrings || 1;
    parts.push(txt(jbCX, jbCY + jbH/2 + 9,  `${strCount} string${strCount > 1 ? 's' : ''} in`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(jbCX, jbCY + jbH/2 + 18, '1 feeder out', { size: F.tiny, anchor: 'middle' }));
  }
  parts.push(calloutNum(jbCX + jbW/2 + 12, jbCY - jbH/2 - 5, 2));

  // ── SEGMENT 1: PV Array → Roof J-Box (OPEN AIR) ───────────────────────────
  {
    const x1 = pvOutX;
    const x2 = jbCX - jbW/2;
    const run = isMicro ? roofRun : dcStringRun;
    const fallback = isMicro
      ? [`${input.branchWireGauge ?? '#10 AWG'} THWN-2 BLK/RED`, '1×#10 GRN EGC', 'OPEN AIR — NEC 690.31']
      : [`${resolvedDcWireGauge} USE-2/PV Wire RED/BLK`, '1×#10 GRN EGC', 'OPEN AIR — NEC 690.31'];
    const { lines, bundleCount } = runToSegmentLines(run, fallback);
    // Force open-air for this segment
    parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: true, bundleCount }));
  }

  // ── NODE 3: AC COMBINER (micro) or DC DISCONNECT (string) ─────────────────
  let node3RightX: number;

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nBranches = input.microBranches?.length ?? Math.ceil(md / 16);
    const branchOcpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    const combLabel = input.combinerLabel ?? `${input.inverterManufacturer} IQ Combiner`;

    const combResult = renderACCombiner(
      xCombOrDCDis, BUS_Y,
      nBranches, branchOcpd, combLabel, 3
    );
    parts.push(combResult.svg);
    node3RightX = combResult.rightX;

    // Label above combiner
    parts.push(txt(xCombOrDCDis, combResult.topY - 8, 'AC COMBINER', { size: F.hdr, bold: true, anchor: 'middle' }));

    // SEGMENT 2: Roof J-Box → AC Combiner (CONDUIT)
    {
      const x1 = jbCX + jbW/2;
      const x2 = combResult.leftX;
      const run = branchRun;
      const fallback = [`${input.branchWireGauge ?? '#10 AWG'} THWN-2 BLK/RED`, '1×#10 GRN EGC', `IN ${input.branchConduitSize ?? '3/4"'} EMT`];
      const { lines, bundleCount } = runToSegmentLines(run, fallback);
      parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
    }

  } else {
    // DC DISCONNECT
    const dcDisW = 80, dcDisH = 52;
    const node3CX = xCombOrDCDis, node3CY = BUS_Y;
    parts.push(rect(node3CX - dcDisW/2, node3CY - dcDisH/2, dcDisW, dcDisH, { fill: LGRY2, sw: SW_MED }));
    // Internal: line terminals → fuse → load terminals
    parts.push(lugSym(node3CX - dcDisW/2 + 8, node3CY - 8));
    parts.push(lugSym(node3CX - dcDisW/2 + 8, node3CY + 8));
    parts.push(fuseSym(node3CX, node3CY - 8));
    parts.push(fuseSym(node3CX, node3CY + 8));
    parts.push(lugSym(node3CX + dcDisW/2 - 8, node3CY - 8));
    parts.push(lugSym(node3CX + dcDisW/2 - 8, node3CY + 8));
    parts.push(ln(node3CX - dcDisW/2 + 12, node3CY - 8, node3CX - 9, node3CY - 8, { sw: SW_THIN }));
    parts.push(ln(node3CX - dcDisW/2 + 12, node3CY + 8, node3CX - 9, node3CY + 8, { sw: SW_THIN }));
    parts.push(ln(node3CX + 9, node3CY - 8, node3CX + dcDisW/2 - 12, node3CY - 8, { sw: SW_THIN }));
    parts.push(ln(node3CX + 9, node3CY + 8, node3CX + dcDisW/2 - 12, node3CY + 8, { sw: SW_THIN }));
    parts.push(txt(node3CX, node3CY - dcDisH/2 - 16, '(N) DC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
    parts.push(txt(node3CX, node3CY + dcDisH/2 + 9,  `${input.dcOCPD}A FUSED`, { size: F.tiny, anchor: 'middle' }));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(node3CX, node3CY + dcDisH/2 + 18, 'RAPID SHUTDOWN — NEC 690.12', { size: F.tiny, anchor: 'middle', italic: true }));
    }
    parts.push(calloutNum(node3CX + dcDisW/2 - 4, node3CY - dcDisH/2 - 5, 3));
    node3RightX = node3CX + dcDisW/2;

    // SEGMENT 2: Roof J-Box → DC Disconnect (CONDUIT)
    {
      const x1 = jbCX + jbW/2;
      const x2 = node3CX - dcDisW/2;
      const run = dcStringRun;
      const fallback = [`${resolvedDcWireGauge} USE-2/PV Wire RED/BLK`, '1×#10 GRN EGC', `IN ${input.dcConduitType ?? 'EMT'}`];
      const { lines, bundleCount } = runToSegmentLines(run, fallback);
      parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
    }
  }

  // ── NODE 4: INVERTER (string only) ────────────────────────────────────────
  let invOutX = node3RightX;

  if (!isMicro) {
    const invCX = xInvOrACDis, invCY = BUS_Y;
    const invW = 96, invH = 60;
    parts.push(rect(invCX - invW/2, invCY - invH/2, invW, invH, { fill: WHT, sw: SW_MED }));
    parts.push(txt(invCX - invW/2 + 5, invCY - 5, 'DC', { size: F.sub, bold: true }));
    parts.push(txt(invCX + invW/2 - 16, invCY - 5, 'AC', { size: F.sub, bold: true }));
    // DC→AC arrow
    parts.push(ln(invCX - 9, invCY + 5, invCX + 5, invCY + 5, { sw: SW_THIN }));
    parts.push(`<polygon points="${invCX+5},${invCY+2} ${invCX+11},${invCY+5} ${invCX+5},${invCY+8}" fill="${BLK}"/>`);
    // Sine wave
    parts.push(`<path d="M${invCX-7},${invCY-3} Q${invCX-3},${invCY-11} ${invCX+1},${invCY-3} Q${invCX+5},${invCY+5} ${invCX+9},${invCY-3}" fill="none" stroke="${BLK}" stroke-width="${SW_THIN}"/>`);
    parts.push(ln(invCX, invCY - invH/2, invCX, invCY + invH/2, { sw: SW_HAIR, dash: '3,2' }));
    // DC input lug
    parts.push(lugSym(invCX - invW/2, invCY));
    parts.push(ln(invCX - invW/2 - 12, invCY, invCX - invW/2, invCY, { sw: SW_MED }));
    // AC output lug
    parts.push(lugSym(invCX + invW/2, invCY));
    parts.push(ln(invCX + invW/2, invCY, invCX + invW/2 + 12, invCY, { sw: SW_MED }));

    const tl = input.topologyType === 'STRING_WITH_OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER';
    parts.push(txt(invCX, invCY - invH/2 - 18, tl, { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 8,  `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 9,  `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    if (input.mpptAllocation) {
      parts.push(txt(invCX, invCY + invH/2 + 18, `MPPT: ${input.mpptAllocation}`, { size: F.tiny, anchor: 'middle' }));
    }
    parts.push(calloutNum(invCX + invW/2 + 14, invCY - invH/2 - 5, 4));

    invOutX = invCX + invW/2 + 12;

    // SEGMENT 3: DC Disconnect → Inverter (CONDUIT)
    {
      const x1 = node3RightX;
      const x2 = invCX - invW/2 - 12;
      const run = dcDiscoInvRun ?? dcStringRun;
      const fallback = [`${resolvedDcWireGauge} USE-2/PV Wire RED/BLK`, '1×#10 GRN EGC', `IN ${input.dcConduitType ?? 'EMT'}`];
      const { lines, bundleCount } = runToSegmentLines(run, fallback);
      parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
    }
  }

  // ── NODE 5: AC DISCONNECT (with internal structure) ───────────────────────
  const acDisCX = isMicro ? xInvOrACDis : xACDis;
  const acDisResult = renderACDisco(
    acDisCX, BUS_Y,
    resolvedAcOCPD,
    isMicro ? 4 : 5
  );
  parts.push(acDisResult.svg);

  // Label above AC Disco
  parts.push(txt(acDisCX, BUS_Y - 44, '(N) AC DISCONNECT', { size: F.hdr, bold: true, anchor: 'middle' }));

  // SEGMENT: Node3/Inverter → AC Disconnect (CONDUIT)
  {
    const x1 = invOutX;
    const x2 = acDisResult.leftX;
    const run = isMicro ? combDiscoRun : invDiscoRun;
    const fallback = [
      `${resolvedAcWireGauge} THWN-2 BLK + RED`,
      `1×${acFeederRun?.egcGauge ?? '#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduitSize} ${resolvedAcConduitType}`,
    ];
    const { lines, bundleCount } = runToSegmentLines(run, fallback);
    parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
  }

  // ── NODE 6: MAIN SERVICE PANEL (with internal structure) ──────────────────
  let mspRightX: number;
  const mspCX = xMSP;

  if (isLoadSide) {
    const mspResult = renderMSPLoadSide(
      mspCX, BUS_Y,
      input.mainPanelAmps,
      solarBreakerAmps,
      isMicro ? 5 : 6
    );
    parts.push(mspResult.svg);
    mspRightX = mspResult.rightX;

    // SEGMENT: AC Disconnect → MSP (CONDUIT)
    {
      const x1 = acDisResult.rightX;
      const x2 = mspResult.leftX;
      const run = discoMspRun;
      const fallback = [
        `${resolvedAcWireGauge} THWN-2 BLK + RED`,
        `1×${acFeederRun?.egcGauge ?? '#10 AWG'} GRN EGC`,
        `IN ${resolvedAcConduitSize} ${resolvedAcConduitType}`,
      ];
      const { lines, bundleCount } = runToSegmentLines(run, fallback);
      parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
    }
  } else {
    const mspResult = renderMSPSupplySide(
      mspCX, BUS_Y,
      input.mainPanelAmps,
      input.backfeedAmps,
      isSupplySide || isLineSide,
      isMicro ? 5 : 6
    );
    parts.push(mspResult.svg);
    mspRightX = mspResult.rightX;

    // SEGMENT: AC Disconnect → MSP (CONDUIT)
    {
      const x1 = acDisResult.rightX;
      const x2 = mspResult.leftX;
      const run = discoMspRun;
      const fallback = [
        `${resolvedAcWireGauge} THWN-2 BLK + RED`,
        `1×${acFeederRun?.egcGauge ?? '#10 AWG'} GRN EGC`,
        `IN ${resolvedAcConduitSize} ${resolvedAcConduitType}`,
      ];
      const { lines, bundleCount } = runToSegmentLines(run, fallback);
      parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
    }
  }

  // ── NODE 7: UTILITY METER (always at end, after MSP) ─────────────────────
  const utilCX = xUtil, utilCY = BUS_Y;
  const utilMeterR = 26;

  // SEGMENT: MSP → Utility Meter
  {
    const x1 = mspRightX;
    const x2 = utilCX - utilMeterR - 12;
    const run = mspUtilRun;
    const fallback = [
      `${resolvedAcWireGauge} THWN-2 BLK + RED`,
      `1×${acFeederRun?.egcGauge ?? '#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduitSize} ${resolvedAcConduitType}`,
    ];
    const { lines, bundleCount } = runToSegmentLines(run, fallback);
    parts.push(segmentLabel(x1, x2, BUS_Y, lines, { isOpenAir: false, bundleCount }));
  }

  // Utility Meter circle
  parts.push(circ(utilCX, utilCY, utilMeterR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - 4, 'kWh', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + 6, 'METER', { size: 5.5, anchor: 'middle' }));
  parts.push(ln(utilCX - utilMeterR - 12, utilCY, utilCX - utilMeterR, utilCY, { sw: SW_MED }));

  parts.push(txt(utilCX, utilCY - utilMeterR - 16, 'UTILITY METER', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY - utilMeterR - 7,  esc(input.utilityName), { size: F.sub, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + utilMeterR + 9,  '120/240V, 1Ø, 3W', { size: F.tiny, anchor: 'middle' }));
  parts.push(calloutNum(utilCX + utilMeterR + 16, utilCY - utilMeterR - 5, isMicro ? 6 : 7));

  // Utility Grid symbol below meter (vertical drop)
  const utilGridCY = utilCY + utilMeterR + 50;
  parts.push(ln(utilCX, utilCY + utilMeterR, utilCX, utilGridCY - 18, { sw: SW_MED }));
  parts.push(circ(utilCX, utilGridCY, 18, { fill: WHT, sw: SW_MED }));
  parts.push(txt(utilCX, utilGridCY - 2, 'UTIL', { size: 5.5, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilGridCY + 7, 'GRID', { size: 5, anchor: 'middle' }));
  parts.push(txt(utilCX, utilGridCY + 26, 'UTILITY GRID', { size: F.tiny, anchor: 'middle', bold: true }));
  parts.push(txt(utilCX, utilGridCY + 35, esc(input.utilityName), { size: F.tiny, anchor: 'middle' }));
  // Ground from utility grid
  parts.push(ln(utilCX, utilGridCY + 18, utilCX, utilGridCY + 28, { sw: SW_MED }));
  parts.push(gndSym(utilCX, utilGridCY + 28));

  // ── GROUNDING RAIL ────────────────────────────────────────────────────────
  const gndPoints = isMicro
    ? [xJBox, xCombOrDCDis, xInvOrACDis, xMSP]
    : [xJBox, xCombOrDCDis, xInvOrACDis, xACDis, xMSP];

  const gndStartX = gndPoints[0];
  const gndEndX   = gndPoints[gndPoints.length - 1];

  parts.push(ln(gndStartX, GND_RAIL_Y, gndEndX, GND_RAIL_Y, { stroke: GRN, sw: SW_MED }));
  for (const gx of gndPoints) {
    parts.push(ln(gx, BUS_Y + 40, gx, GND_RAIL_Y, { stroke: GRN, sw: SW_MED }));
    parts.push(gndSym(gx, GND_RAIL_Y));
  }
  parts.push(txt((gndStartX + gndEndX) / 2, GND_RAIL_Y - 5,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43',
    { size: F.tiny, anchor: 'middle', fill: GRN }
  ));

  // ── Rapid Shutdown note ───────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rsdY = SCH_Y + SCH_H - 24;
    parts.push(rect(SCH_X + 5, rsdY - 11, 248, 18, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(SCH_X + 10, rsdY, 'RAPID SHUTDOWN SYSTEM — NEC 690.12 COMPLIANT', { size: F.tiny, bold: true }));
  }

  // ── LEGEND ────────────────────────────────────────────────────────────────
  const legX = SCH_X + SCH_W - 200;
  const legY = SCH_Y + SCH_H - 72;
  const legW = 192, legH = 64;
  parts.push(rect(legX, legY, legW, legH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(legX + 5, legY + 10, 'LEGEND', { size: F.sub, bold: true }));
  parts.push(ln(legX, legY + 13, legX + legW, legY + 13, { sw: SW_THIN }));
  [
    { dash: '',    stroke: BLK,          label: 'AC Conductor in Conduit (THWN-2)' },
    { dash: '8,4', stroke: OPEN_AIR_CLR, label: 'Open Air — PV Wire/THWN-2 (NEC 690.31)' },
    { dash: '',    stroke: GRN,          label: 'Equipment Grounding Conductor (EGC)' },
    { dash: '4,2', stroke: BLK,          label: 'DC Conductor in Conduit (USE-2/PV Wire)' },
  ].forEach((item, i) => {
    const ly = legY + 19 + i * 11;
    parts.push(ln(legX + 5, ly, legX + 40, ly, { stroke: item.stroke, sw: SW_MED, dash: item.dash }));
    parts.push(txt(legX + 46, ly + 3, item.label, { size: F.tiny }));
  });

  // ── CALCULATION PANELS ────────────────────────────────────────────────────
  const calcW = Math.floor(DW / 3) - 4;
  const totalDcKw = input.totalModules * input.panelWatts / 1000;

  // Panel 1: DC / Micro calcs
  const p1x = DX;
  parts.push(rect(p1x, CALC_Y, calcW, CALC_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(p1x, CALC_Y, calcW, 15, { fill: BLK, stroke: BLK, sw: 0 }));

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const ab = Math.ceil(md / 16);
    const ba = Math.ceil((input.acOutputKw * 1000 / 240) * 1.25 / 5) * 5;
    parts.push(txt(p1x + calcW/2, CALC_Y + 10, 'AC BRANCH CIRCUIT INFO', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
    const rows: [string,string][] = [
      ['Topology',           'MICROINVERTER'],
      ['Microinverters',     `${md} units`],
      ['Total DC Power',     `${totalDcKw.toFixed(2)} kW`],
      ['AC per Micro',       `${((input.acOutputKw*1000)/md).toFixed(0)} W`],
      ['Branch Circuits',    `${ab}`],
      ['Max Micros/Branch',  '16 (NEC 690.8)'],
      ['Branch OCPD',        `${branchRun?.ocpdAmps ?? ba} A`],
      ['AC Wire',            `${resolvedAcWireGauge}`],
      ['AC Conduit',         resolvedAcConduitType],
      ['Conduit Size',       resolvedAcConduitSize || '—'],
      ['Module Voc',         `${input.panelVoc} V`],
      ['Module Isc',         `${input.panelIsc} A`],
    ];
    const rh = Math.min(13, (CALC_H - 18) / rows.length);
    rows.forEach(([l, v], i) => {
      const ry = CALC_Y + 20 + i * rh;
      if (i%2===1) parts.push(rect(p1x, ry - rh + 2, calcW, rh, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(p1x + 4, ry, l, { size: F.tiny }));
      parts.push(txt(p1x + calcW - 4, ry, v, { size: F.tiny, anchor: 'end', bold: true }));
    });
  } else {
    parts.push(txt(p1x + calcW/2, CALC_Y + 10, 'DC SYSTEM CALCULATIONS', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
    const pps = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
    const lsp = input.lastStringPanels ?? pps;
    const vc  = input.vocCorrected ?? input.panelVoc;
    const sv  = input.stringVoc ?? (vc * pps);
    const si  = input.stringIsc ?? input.panelIsc;
    const op  = input.ocpdPerString ?? input.dcOCPD;
    const dt  = input.designTempMin ?? -10;
    const dar = input.dcAcRatio ?? (input.acOutputKw > 0 ? totalDcKw / input.acOutputKw : 0);
    const rows: [string,string][] = [
      ['Module Voc (STC)',        `${input.panelVoc} V`],
      ['Module Isc (STC)',        `${input.panelIsc} A`],
      ['Design Temp (NEC 690.7)', `${dt}°C`],
      ['Voc Corrected',           `${vc.toFixed(2)} V`],
      ['Panels per String',       pps===lsp ? `${pps}` : `${pps} (last: ${lsp})`],
      ['Number of Strings',       `${input.totalStrings}`],
      ['String Voc (corrected)',  `${sv.toFixed(1)} V`],
      ['String Voc × 1.25',       `${(sv*1.25).toFixed(1)} V`],
      ['String Isc × 1.25',       `${(si*1.25).toFixed(2)} A`],
      ['DC OCPD / String',        `${op} A`],
      ['DC Wire Gauge',           `${resolvedDcWireGauge}`],
      ['Total DC Power',          `${totalDcKw.toFixed(2)} kW`],
      ['DC/AC Ratio',             `${dar.toFixed(2)}`],
    ];
    const rh = Math.min(13, (CALC_H - 18) / rows.length);
    rows.forEach(([l, v], i) => {
      const ry = CALC_Y + 20 + i * rh;
      if (i%2===1) parts.push(rect(p1x, ry - rh + 2, calcW, rh, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(p1x + 4, ry, l, { size: F.tiny }));
      parts.push(txt(p1x + calcW - 4, ry, v, { size: F.tiny, anchor: 'end', bold: true }));
    });
  }

  // Panel 2: AC calcs
  const p2x = DX + calcW + 4;
  parts.push(rect(p2x, CALC_Y, calcW, CALC_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(p2x, CALC_Y, calcW, 15, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(p2x + calcW/2, CALC_Y + 10, 'AC SYSTEM CALCULATIONS', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
  const acRows: [string,string][] = [
    ['AC Output (kW)',    `${input.acOutputKw} kW`],
    ['AC Output Amps',   `${input.acOutputAmps} A`],
    ['AC OCPD (125%)',   `${resolvedAcOCPD} A`],
    ['AC Wire Gauge',    `${resolvedAcWireGauge}`],
    ['AC Conduit Type',  resolvedAcConduitType],
    ['Conduit Size',     resolvedAcConduitSize || '—'],
    ['Service Voltage',  '120/240V, 1Ø'],
    ['Main Panel Rating',`${input.mainPanelAmps} A`],
    // Interconnection-specific rows
    ...(isLoadSide ? [
      ['Interconnection',   'Load Side Tap'] as [string,string],
      ['NEC Reference',     'NEC 705.12(B)'] as [string,string],
      ['PV Breaker',        `${solarBreakerAmps} A`] as [string,string],
      ['120% Rule',         `${input.mainPanelAmps * 1.2 >= input.mainPanelAmps + solarBreakerAmps ? 'PASS ✓' : 'FAIL ✗'}`] as [string,string],
    ] : isSupplySide || isLineSide ? [
      ['Interconnection',   'Supply Side Tap'] as [string,string],
      ['NEC Reference',     'NEC 705.11'] as [string,string],
      ['Backfed Breaker',   'N/A — Tap Connection'] as [string,string],
      ['120% Rule',         'N/A — Supply Side'] as [string,string],
    ] : [
      ['Interconnection',   'Backfed Breaker'] as [string,string],
      ['NEC Reference',     'NEC 705.12(B)(2)'] as [string,string],
      ['Backfeed Breaker',  `${input.backfeedAmps} A`] as [string,string],
      ['120% Rule Check',   `${input.mainPanelAmps * 1.2 >= input.mainPanelAmps + input.backfeedAmps ? 'PASS ✓' : 'FAIL ✗'}`] as [string,string],
    ]),
  ];
  const acRh = Math.min(13, (CALC_H - 18) / acRows.length);
  acRows.forEach(([l, v], i) => {
    const ry = CALC_Y + 20 + i * acRh;
    if (i%2===1) parts.push(rect(p2x, ry - acRh + 2, calcW, acRh, { fill: LGY, stroke: 'none', sw: 0 }));
    parts.push(txt(p2x + 4, ry, l, { size: F.tiny }));
    const isPassFail = v.includes('✓') || v.includes('✗');
    const vColor = isPassFail ? (v.includes('✓') ? PASS_CLR : FAIL_CLR) : BLK;
    parts.push(txt(p2x + calcW - 4, ry, v, { size: F.tiny, anchor: 'end', bold: true, fill: vColor }));
  });

  // Panel 3: Equipment schedule
  const p3x = DX + (calcW + 4) * 2;
  parts.push(rect(p3x, CALC_Y, calcW, CALC_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(p3x, CALC_Y, calcW, 15, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(p3x + calcW/2, CALC_Y + 10, 'EQUIPMENT SCHEDULE', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
  const md2 = input.deviceCount ?? input.totalModules;
  const pp2 = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
  const eqRows: [string,string][] = isMicro ? [
    ['PV Module',         esc(input.panelModel)],
    ['Module Wattage',    `${input.panelWatts} W`],
    ['Total Modules',     `${input.totalModules}`],
    ['Microinverters',    `${md2} units`],
    ['Branch Circuits',   `${Math.ceil(md2/16)}`],
    ['Inverter Mfr.',     esc(input.inverterManufacturer)],
    ['Inverter Model',    esc(input.inverterModel)],
    ['Inverter Output',   `${input.acOutputKw} kW AC`],
    ['AC Combiner',       esc(input.combinerLabel ?? 'IQ Combiner')],
    ['AC Disconnect',     `${resolvedAcOCPD}A Non-Fused`],
    ['Main Panel',        `${input.mainPanelAmps} A`],
    ['Utility',           esc(input.utilityName)],
    ['Interconnection',   esc(input.interconnection)],
    ['Rapid Shutdown',    input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
    ['Battery Storage',   input.hasBattery ? esc(input.batteryModel) : 'NONE'],
  ] : [
    ['PV Module',         esc(input.panelModel)],
    ['Module Wattage',    `${input.panelWatts} W`],
    ['Total Modules',     `${input.totalModules}`],
    ['Strings',           `${input.totalStrings} × ${pp2} panels`],
    ['MPPT Channels',     input.mpptAllocation ?? `${input.mpptChannels ?? 1} ch`],
    ['Combiner',          esc(input.combinerLabel ?? (input.combinerType ?? 'Direct'))],
    ['Inverter Mfr.',     esc(input.inverterManufacturer)],
    ['Inverter Model',    esc(input.inverterModel)],
    ['Inverter Output',   `${input.acOutputKw} kW AC`],
    ['DC Disconnect',     `${input.dcOCPD}A Fused`],
    ['AC Disconnect',     `${resolvedAcOCPD}A Non-Fused`],
    ['Main Panel',        `${input.mainPanelAmps} A`],
    ['Utility',           esc(input.utilityName)],
    ['Interconnection',   esc(input.interconnection)],
    ['Rapid Shutdown',    input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
    ['Battery Storage',   input.hasBattery ? esc(input.batteryModel) : 'NONE'],
  ];
  const eqRh = Math.min(12, (CALC_H - 18) / eqRows.length);
  eqRows.forEach(([l, v], i) => {
    const ry = CALC_Y + 20 + i * eqRh;
    if (i%2===1) parts.push(rect(p3x, ry - eqRh + 2, calcW, eqRh, { fill: LGY, stroke: 'none', sw: 0 }));
    parts.push(txt(p3x + 4, ry, l, { size: F.tiny }));
    parts.push(txt(p3x + calcW - 4, ry, v, { size: F.tiny, anchor: 'end', bold: true }));
  });

  // ── CONDUIT & CONDUCTOR SCHEDULE ──────────────────────────────────────────
  parts.push(rect(DX, SCHED_Y, DW, SCHED_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(DX, SCHED_Y, DW, 15, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(DX + 7, SCHED_Y + 10, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9 TABLE 1', {
    size: F.hdr, bold: true, fill: WHT,
  }));

  const schedCols = [
    { label: 'RUN ID',     w: 0.07 },
    { label: 'FROM',       w: 0.11 },
    { label: 'TO',         w: 0.11 },
    { label: 'CONDUCTORS', w: 0.28 },
    { label: 'CONDUIT',    w: 0.10 },
    { label: 'FILL %',     w: 0.06 },
    { label: 'AMPACITY',   w: 0.07 },
    { label: 'OCPD',       w: 0.06 },
    { label: 'V-DROP %',   w: 0.07 },
    { label: 'LENGTH',     w: 0.06 },
    { label: 'PASS',       w: 0.05 },
  ];

  const hdrY2 = SCHED_Y + 25;
  const rowH2 = 13;
  let colX = DX;
  schedCols.forEach(col => {
    const cw = col.w * DW;
    parts.push(txt(colX + 3, hdrY2, col.label, { size: F.tiny, bold: true }));
    parts.push(ln(colX, SCHED_Y + 15, colX, SCHED_Y + SCHED_H, { sw: SW_HAIR }));
    colX += cw;
  });
  parts.push(ln(DX, hdrY2 + 2, DX + DW, hdrY2 + 2, { sw: SW_THIN }));

  // Build schedule rows from RunSegment[]
  type SchedRow = {
    id: string; from: string; to: string; conductors: string;
    conduitType: string; fillPercent: number; ampacity: number;
    ocpd: number; voltageDrop: number; lengthFt: number; pass: boolean;
  };
  let schedRows: SchedRow[] = [];

  if (input.runs && input.runs.length > 0) {
    schedRows = input.runs.filter(run => run.id !== 'MSP_TO_UTILITY_RUN').map(run => {
      let conductorsDisplay = '';
      if (run.conductorBundle && run.conductorBundle.length > 0) {
        conductorsDisplay = run.conductorBundle
          .map((c: ConductorBundle) => {
            const g = c.gauge.replace('#','').replace(' AWG','');
            return `${c.qty}×#${g} ${c.insulation} ${c.color}`;
          }).join(' + ');
      } else if (run.conductorCallout) {
        conductorsDisplay = run.conductorCallout.replace(/\n/g,' + ').trim();
      } else {
        const g = run.wireGauge.replace('#','').replace(' AWG','');
        const eg = run.egcGauge.replace('#','').replace(' AWG','');
        conductorsDisplay = `${run.conductorCount}×#${g} ${run.insulation} + 1×#${eg} GND`;
      }
      return {
        id:          run.id,
        from:        run.from,
        to:          run.to,
        conductors:  conductorsDisplay,
        conduitType: run.isOpenAir ? 'OPEN AIR' : `${run.conduitType} ${run.conduitSize}`,
        fillPercent: run.conduitFillPct ?? 0,
        ampacity:    Math.round((run.continuousCurrent ?? 0) * 100) / 100,
        ocpd:        run.ocpdAmps ?? 0,
        voltageDrop: Math.round((run.voltageDropPct ?? 0) * 100) / 100,
        lengthFt:    run.onewayLengthFt ?? 0,
        pass:        run.overallPass ?? true,
      };
    });
  } else {
    // Fallback placeholder rows
    schedRows = isMicro ? [
      { id:'BR-1', from:'ROOF J-BOX', to:'AC COMBINER',  conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`, conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.2, lengthFt:50, pass:true },
      { id:'A-1',  from:'AC COMBINER', to:'AC DISCO',    conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`, conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.4, lengthFt:20, pass:true },
      { id:'A-2',  from:'AC DISCO',    to:'MSP',         conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`, conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.4, lengthFt:15, pass:true },
      { id:'A-3',  from:'MSP',         to:'UTIL METER',  conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`, conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.8, lengthFt:10, pass:true },
    ] : [
      { id:'D-1', from:'PV ARRAY',   to:'ROOF J-BOX', conductors:`${resolvedDcWireGauge} USE-2/PV Wire RED+BLK + 1×#10 GRN`, conduitType:'OPEN AIR',                                                                  fillPercent:0,  ampacity:30,                  ocpd:input.dcOCPD,   voltageDrop:1.2, lengthFt:50, pass:true },
      { id:'D-2', from:'ROOF J-BOX', to:'DC DISCO',   conductors:`${resolvedDcWireGauge} USE-2/PV Wire RED+BLK + 1×#10 GRN`, conduitType:`${input.dcConduitType ?? 'EMT'} 3/4"`,                                      fillPercent:28, ampacity:30,                  ocpd:input.dcOCPD,   voltageDrop:1.2, lengthFt:20, pass:true },
      { id:'D-3', from:'DC DISCO',   to:'INVERTER',   conductors:`${resolvedDcWireGauge} USE-2/PV Wire RED+BLK + 1×#10 GRN`, conduitType:`${input.dcConduitType ?? 'EMT'} 3/4"`,                                      fillPercent:28, ampacity:30,                  ocpd:input.dcOCPD,   voltageDrop:1.2, lengthFt:10, pass:true },
      { id:'A-1', from:'INVERTER',   to:'AC DISCO',   conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`,       conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`,                         fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.8, lengthFt:20, pass:true },
      { id:'A-2', from:'AC DISCO',   to:'MSP',        conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`,       conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`,                         fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.8, lengthFt:15, pass:true },
      { id:'A-3', from:'MSP',        to:'UTIL METER', conductors:`${resolvedAcWireGauge} THWN-2 BLK+RED + 1×#10 GRN`,       conduitType:`${resolvedAcConduitType} ${resolvedAcConduitSize}`,                         fillPercent:32, ampacity:input.acOutputAmps, ocpd:resolvedAcOCPD, voltageDrop:1.8, lengthFt:10, pass:true },
    ];
  }

  const maxSchedRows = Math.floor((SCHED_H - 32) / rowH2);
  schedRows.slice(0, maxSchedRows).forEach((row, ri) => {
    const ry = hdrY2 + 4 + (ri + 1) * rowH2;
    if (ri%2===1) parts.push(rect(DX, ry - rowH2 + 2, DW, rowH2, { fill: LGY, stroke: 'none', sw: 0 }));
    const passColor = row.pass ? PASS_CLR : FAIL_CLR;
    const passVal   = row.pass ? '✓ PASS' : '✗ FAIL';
    const vals = [
      row.id,
      row.from,
      row.to,
      row.conductors,
      row.conduitType,
      row.fillPercent > 0 ? `${Number(row.fillPercent).toFixed(1)}%` : (row.conduitType === 'OPEN AIR' ? 'N/A' : '—'),
      row.ampacity > 0 ? `${row.ampacity}A` : '—',
      row.ocpd > 0 ? `${row.ocpd}A` : '—',
      row.voltageDrop > 0 ? `${Number(row.voltageDrop).toFixed(2)}%` : '—',
      row.lengthFt > 0 ? `${row.lengthFt} FT` : '—',
      passVal,
    ];
    let cx2 = DX;
    schedCols.forEach((col, ci) => {
      const cw = col.w * DW;
      parts.push(txt(cx2 + 3, ry, String(vals[ci] ?? ''), {
        size: F.tiny, fill: ci === 10 ? passColor : BLK, bold: ci === 10,
      }));
      cx2 += cw;
    });
  });

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  const tbX = TB_X, tbY = DY, tbH = DH;
  parts.push(rect(tbX, tbY, TB_W, tbH, { fill: WHT, stroke: BLK, sw: SW_HEAVY }));

  // Header bar
  parts.push(rect(tbX, tbY, TB_W, 40, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, tbY + 16, 'SOLARPRO', { size: 14, bold: true, anchor: 'middle', fill: WHT }));
  parts.push(txt(tbX + TB_W/2, tbY + 29, 'ENGINEERING', { size: F.tb, anchor: 'middle', fill: '#AAAAAA' }));

  // Drawing title
  parts.push(rect(tbX, tbY + 40, TB_W, 32, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, tbY + 54, 'SINGLE LINE DIAGRAM', { size: F.tbTitle, bold: true, anchor: 'middle' }));
  parts.push(txt(tbX + TB_W/2, tbY + 66, 'PHOTOVOLTAIC SYSTEM', { size: F.tb, anchor: 'middle' }));

  // Project info
  const tbInfoRows: [string,string][] = [
    ['PROJECT',  input.projectName],
    ['CLIENT',   input.clientName],
    ['ADDRESS',  input.address],
    ['DESIGNER', input.designer],
    ['DATE',     input.drawingDate],
    ['DWG NO.',  input.drawingNumber],
    ['REVISION', input.revision],
    ['SCALE',    input.scale || 'NOT TO SCALE'],
  ];
  let tbRowY = tbY + 72;
  const tbRowH = 21;
  tbInfoRows.forEach(([label, val]) => {
    parts.push(rect(tbX, tbRowY, TB_W, tbRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 4, tbRowY + 13, label, { size: F.tiny, bold: true, fill: '#555' }));
    parts.push(txt(tbX + 66, tbRowY + 13, esc(String(val ?? '')), { size: F.tb }));
    tbRowY += tbRowH;
  });

  // System summary
  const sysY = tbRowY + 3;
  parts.push(rect(tbX, sysY, TB_W, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, sysY + 9, 'SYSTEM SUMMARY', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
  const sysRows: [string,string][] = [
    ['TOPOLOGY',   input.topologyType.replace(/_/g,' ')],
    ['DC SIZE',    `${(input.totalModules * input.panelWatts / 1000).toFixed(2)} kW`],
    ['AC OUTPUT',  `${input.acOutputKw} kW`],
    ['MODULES',    `${input.totalModules} × ${input.panelWatts}W`],
    ['INVERTER',   `${esc(input.inverterManufacturer)}`],
    ['MODEL',      `${esc(input.inverterModel)}`],
    ['SERVICE',    `${input.mainPanelAmps}A`],
    ['UTILITY',    esc(input.utilityName)],
    ['INTERCONN.', esc(input.interconnection)],
  ];
  let sysRowY = sysY + 13;
  const sysRowH = 17;
  sysRows.forEach(([l, v]) => {
    parts.push(rect(tbX, sysRowY, TB_W, sysRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 4, sysRowY + 11, l, { size: F.tiny, bold: true, fill: '#555' }));
    parts.push(txt(tbX + 74, sysRowY + 11, esc(String(v ?? '')), { size: F.tb }));
    sysRowY += sysRowH;
  });

  // Code references
  const codeY = sysRowY + 3;
  parts.push(rect(tbX, codeY, TB_W, 13, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, codeY + 9, 'CODE REFERENCES', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
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
  let codeRowY = codeY + 13;
  codes.forEach(c => {
    parts.push(txt(tbX + 4, codeRowY + 9, c, { size: F.tiny }));
    codeRowY += 12;
  });

  // Revisions
  const revY = codeRowY + 3;
  const revH = Math.min(88, tbY + tbH - revY - 56);
  if (revH > 26) {
    parts.push(rect(tbX, revY, TB_W, 13, { fill: BLK, stroke: BLK, sw: 0 }));
    parts.push(txt(tbX + TB_W/2, revY + 9, 'REVISIONS', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
    parts.push(rect(tbX, revY + 13, TB_W, revH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    const rcw = TB_W / 3;
    parts.push(txt(tbX + 3, revY + 23, 'REV', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + rcw + 3, revY + 23, 'DESCRIPTION', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + rcw*2 + 3, revY + 23, 'DATE', { size: F.tiny, bold: true }));
    parts.push(ln(tbX, revY + 25, tbX + TB_W, revY + 25, { sw: SW_HAIR }));
    parts.push(ln(tbX + rcw, revY + 13, tbX + rcw, revY + revH, { sw: SW_HAIR }));
    parts.push(ln(tbX + rcw*2, revY + 13, tbX + rcw*2, revY + revH, { sw: SW_HAIR }));
    parts.push(txt(tbX + 3, revY + 36, input.revision, { size: F.tiny }));
    parts.push(txt(tbX + rcw + 3, revY + 36, 'INITIAL ISSUE', { size: F.tiny }));
    parts.push(txt(tbX + rcw*2 + 3, revY + 36, input.drawingDate, { size: F.tiny }));
  }

  // Engineer seal
  const sealY = tbY + tbH - 52;
  parts.push(rect(tbX, sealY, TB_W, 52, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(circ(tbX + TB_W/2, sealY + 24, 19, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, sealY + 20, 'ENGINEER', { size: F.tiny, anchor: 'middle', fill: '#888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 30, 'SEAL', { size: F.tiny, anchor: 'middle', fill: '#888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 46, `${esc(input.designer)} — ${esc(input.drawingDate)}`, { size: F.tiny, anchor: 'middle', fill: '#555' }));

  parts.push('</svg>');
  return parts.join('\n');
}