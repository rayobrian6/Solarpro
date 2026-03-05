// ============================================================
// Professional SLD Renderer V10 — IEEE Engineering Drawing
// ANSI C Landscape (24"×18") = 2304×1728px at 96 DPI
//
// ARCHITECTURE:
//   - Single horizontal bus line at vertical center
//   - Components spaced evenly left→right with generous gaps
//   - Wire callout boxes ABOVE bus line (never overlapping)
//   - Conduit schedule reads directly from RunSegment[]
//   - ConductorBundle[] as single source of truth for labels
//   - All NEC references shown inline
//   - Clean black/white IEEE schematic style
// ============================================================

import type { RunSegment, MicroBranch } from './computed-system';
import type { ConductorBundle } from './segment-schedule';

// ─── Canvas ──────────────────────────────────────────────────────────────────
const W = 2304;
const H = 1728;
const MARGIN = 40;

// Title block on right side
const TB_W = 280;
const TB_X = W - TB_W - MARGIN;

// Drawing area (left of title block)
const DX = MARGIN;
const DY = MARGIN;
const DW = TB_X - MARGIN - 12;
const DH = H - MARGIN * 2;

// Schematic area (upper 52% of drawing area)
const SCH_X = DX;
const SCH_Y = DY + 28;
const SCH_W = DW;
const SCH_H = Math.round(DH * 0.52);

// Bus line Y position (center of schematic area)
const BUS_Y = SCH_Y + Math.round(SCH_H * 0.55);

// Callout zone: wire labels go here (above bus line)
const CALLOUT_Y = BUS_Y - 90;  // base Y for callout boxes

// Ground zone: below bus line
const GND_Y = BUS_Y + 80;

// Bottom tables
const SCHED_Y = SCH_Y + SCH_H + 8;
const SCHED_H = 200;
const NOTES_Y = SCHED_Y + SCHED_H + 8;
const NOTES_H = H - MARGIN - NOTES_Y;

// ─── Colors ──────────────────────────────────────────────────────────────────
const BLK = '#000000';
const GRN = '#005500';   // grounding conductors ONLY
const WHT = '#FFFFFF';
const LGY = '#F5F5F5';   // alternating table rows
const RED_FAIL = '#CC0000';
const GRN_PASS = '#006600';

// ─── Stroke widths ───────────────────────────────────────────────────────────
const SW_BORDER = 3.0;
const SW_HEAVY  = 2.0;
const SW_MED    = 1.5;
const SW_THIN   = 1.0;
const SW_HAIR   = 0.5;

// ─── Font sizes ──────────────────────────────────────────────────────────────
const F = {
  title:   14,
  hdr:      9,
  label:    8,
  sub:      7,
  tiny:     6.5,
  note:     6.5,
  tb:       7.5,
  tbTitle: 11,
};

// ─── Public Interface ─────────────────────────────────────────────────────────
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

  // String generation results
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

  // Microinverter topology
  deviceCount?:            number;
  microBranches?:          MicroBranch[];
  branchWireGauge?:        string;
  branchConduitSize?:      string;
  branchOcpdAmps?:         number;

  // String topology — per-string data
  stringDetails?:          { stringIndex: number; panelCount: number; ocpdAmps: number; wireGauge: string; voc: number; isc: number }[];

  // ComputedSystem runSegments — single source of truth
  runs?:                   RunSegment[];
}

// ─── SVG Helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function txt(
  x: number, y: number, content: string,
  opts: {
    size?: number; bold?: boolean; anchor?: 'start'|'middle'|'end';
    fill?: string; italic?: boolean;
  } = {}
): string {
  const size   = opts.size   ?? F.label;
  const bold   = opts.bold   ? `font-weight="bold"` : '';
  const anchor = `text-anchor="${opts.anchor ?? 'start'}"`;
  const fill   = `fill="${opts.fill ?? BLK}"`;
  const italic = opts.italic ? `font-style="italic"` : '';
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" ${bold} ${anchor} ${fill} ${italic} dominant-baseline="auto">${esc(content)}</text>`;
}

function multilineTxt(
  x: number, y: number, lines: string[],
  opts: {
    size?: number; bold?: boolean; anchor?: 'start'|'middle'|'end';
    fill?: string; lineHeight?: number;
  } = {}
): string {
  if (!lines.length) return '';
  const size       = opts.size       ?? F.tiny;
  const bold       = opts.bold       ? `font-weight="bold"` : '';
  const anchor     = `text-anchor="${opts.anchor ?? 'start'}"`;
  const fill       = `fill="${opts.fill ?? BLK}"`;
  const lineHeight = opts.lineHeight ?? Math.round(size * 1.45);
  const tspans = lines.map((line, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`
  ).join('');
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" ${bold} ${anchor} ${fill} dominant-baseline="auto">${tspans}</text>`;
}

function rect(x: number, y: number, w: number, h: number,
  opts: { fill?: string; stroke?: string; sw?: number; rx?: number; dash?: string } = {}
): string {
  const fill   = opts.fill   ?? WHT;
  const stroke = opts.stroke ?? BLK;
  const sw     = opts.sw     ?? SW_THIN;
  const rx     = opts.rx     ? `rx="${opts.rx}"` : '';
  const dash   = opts.dash   ? `stroke-dasharray="${opts.dash}"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${rx} ${dash}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number,
  opts: { stroke?: string; sw?: number; dash?: string } = {}
): string {
  const stroke = opts.stroke ?? BLK;
  const sw     = opts.sw     ?? SW_MED;
  const dash   = opts.dash   ? `stroke-dasharray="${opts.dash}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}" ${dash}/>`;
}

function circle(cx: number, cy: number, r: number,
  opts: { fill?: string; stroke?: string; sw?: number } = {}
): string {
  const fill   = opts.fill   ?? WHT;
  const stroke = opts.stroke ?? BLK;
  const sw     = opts.sw     ?? SW_THIN;
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

// IEEE numbered callout circle
function calloutCircle(cx: number, cy: number, n: number, r = 12): string {
  return circle(cx, cy, r, { fill: WHT, stroke: BLK, sw: SW_MED })
    + txt(cx, cy + 1, String(n), { size: F.hdr, bold: true, anchor: 'middle', fill: BLK });
}

// Ground symbol (IEEE 315)
function gndSym(x: number, y: number, color = GRN): string {
  const s: string[] = [];
  s.push(line(x, y, x, y + 10, { stroke: color, sw: SW_MED }));
  s.push(line(x - 10, y + 10, x + 10, y + 10, { stroke: color, sw: SW_MED }));
  s.push(line(x - 7,  y + 15, x + 7,  y + 15, { stroke: color, sw: SW_MED }));
  s.push(line(x - 4,  y + 20, x + 4,  y + 20, { stroke: color, sw: SW_MED }));
  return s.join('');
}

// Knife-blade disconnect symbol (IEEE 315)
function discoSym(cx: number, cy: number, w = 56, h = 18): string {
  const s: string[] = [];
  const lx = cx - w / 2;
  const rx = cx + w / 2;
  s.push(line(lx, cy, lx + 12, cy, { sw: SW_MED }));
  s.push(line(rx - 12, cy, rx, cy, { sw: SW_MED }));
  s.push(line(lx + 12, cy, rx - 12, cy - h * 0.5, { sw: SW_MED }));
  s.push(circle(lx + 12, cy, 3, { fill: BLK }));
  s.push(circle(rx - 12, cy, 3, { fill: WHT }));
  return s.join('');
}

// ─── Wire Callout Box ─────────────────────────────────────────────────────────
// Draws a bordered box with conductor info, positioned above the bus line
// cx = center X of the wire segment
// topY = top of the box (caller controls vertical position)
function wireCalloutBox(
  cx: number,
  topY: number,
  lines: string[],
  opts: { isOpenAir?: boolean; leaderToY?: number } = {}
): string {
  if (!lines.length) return '';
  const isOpenAir = opts.isOpenAir ?? false;
  const lineH   = 9;
  const padX    = 6;
  const padY    = 4;
  const maxLen  = Math.max(...lines.map(l => l.length));
  const boxW    = Math.max(60, maxLen * 5.2 + padX * 2);
  const boxH    = lines.length * lineH + padY * 2;
  const bx      = cx - boxW / 2;
  const by      = topY;
  const borderColor = isOpenAir ? GRN : BLK;
  const textColor   = isOpenAir ? GRN : BLK;

  const s: string[] = [];
  // Box background + border
  s.push(rect(bx, by, boxW, boxH, {
    fill: WHT, stroke: borderColor, sw: isOpenAir ? SW_MED : SW_THIN,
    dash: isOpenAir ? '4,2' : undefined,
  }));
  // Text lines using tspan
  const textX = cx;
  const textY = by + padY + lineH - 1;
  s.push(multilineTxt(textX, textY, lines, {
    size: F.tiny, anchor: 'middle', fill: textColor,
  }));
  // Leader line from bottom of box to bus line
  if (opts.leaderToY !== undefined) {
    s.push(line(cx, by + boxH, cx, opts.leaderToY, {
      stroke: borderColor, sw: SW_HAIR, dash: '3,2',
    }));
  }
  return s.join('');
}

// ─── Format conductor bundle into display lines ───────────────────────────────
function bundleToLines(
  bundle: ConductorBundle[] | undefined,
  conduitSize: string,
  conduitType: string,
  isOpenAir: boolean,
  fillPct?: number
): string[] {
  if (!bundle || bundle.length === 0) return [];
  const lines = bundle.map(c => {
    const gaugeNum = c.gauge.replace('#', '').replace(' AWG', '');
    return `${c.qty}#${gaugeNum} ${c.insulation} ${c.color}`;
  });
  if (isOpenAir) {
    lines.push('(OPEN AIR — NEC 690.31)');
  } else {
    const abbrev = conduitType === 'EMT' ? 'EMT'
      : conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
      : conduitType || 'EMT';
    const fillStr = fillPct != null && fillPct > 0 ? ` (${fillPct.toFixed(0)}% fill)` : '';
    lines.push(`IN ${conduitSize} ${abbrev}${fillStr}`);
  }
  return lines;
}

// Format conductorCallout string into lines array
function calloutToLines(callout: string): string[] {
  if (!callout) return [];
  return callout.split('\n').filter(l => l.trim().length > 0);
}

// Build wire label lines from a RunSegment (best available data)
function runToCalloutLines(run: RunSegment | undefined, fallback: string[]): string[] {
  if (!run) return fallback;
  if (run.conductorBundle && run.conductorBundle.length > 0) {
    return bundleToLines(
      run.conductorBundle,
      run.conduitSize,
      run.conduitType,
      run.isOpenAir ?? false,
      run.conduitFillPct
    );
  }
  if (run.conductorCallout) {
    return calloutToLines(run.conductorCallout);
  }
  // Build from scalar fields
  const gaugeNum = run.wireGauge.replace('#', '').replace(' AWG', '');
  const egcNum   = run.egcGauge.replace('#', '').replace(' AWG', '');
  const lines: string[] = [
    `${run.conductorCount}#${gaugeNum} ${run.insulation}`,
    `1#${egcNum} GND`,
  ];
  if (run.isOpenAir) {
    lines.push('(OPEN AIR — NEC 690.31)');
  } else {
    const abbrev = run.conduitType === 'EMT' ? 'EMT'
      : run.conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : run.conduitType || 'EMT';
    const fillStr = run.conduitFillPct > 0 ? ` (${run.conduitFillPct.toFixed(0)}% fill)` : '';
    lines.push(`IN ${run.conduitSize} ${abbrev}${fillStr}`);
  }
  return lines;
}

// ─── Main Render Function ─────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  const parts: string[] = [];
  const isMicro = input.topologyType === 'MICROINVERTER';

  // ── Helper: find run by ID ──────────────────────────────────────────────────
  const findRun = (id: string): RunSegment | undefined =>
    input.runs?.find(r => r.id === id);

  // ── Resolve wire data from runs ─────────────────────────────────────────────
  const acRunId = isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN';
  const acRun   = findRun(acRunId);
  const dcRun   = findRun(isMicro ? 'ROOF_RUN' : 'DC_STRING_RUN');

  const resolvedAcWireGauge   = acRun?.wireGauge   ?? input.acWireGauge   ?? '#8 AWG';
  const resolvedAcOCPD        = acRun?.ocpdAmps     ?? input.acOCPD        ?? 30;
  const resolvedAcConduitSize = acRun?.conduitSize  ?? '3/4"';
  const resolvedAcConduitType = acRun?.conduitType  ?? input.acConduitType ?? 'EMT';
  const resolvedDcWireGauge   = dcRun?.wireGauge    ?? input.dcWireGauge   ?? '#10 AWG';

  // ── SVG root ────────────────────────────────────────────────────────────────
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};font-family:Arial,Helvetica,sans-serif;">`);
  parts.push(rect(0, 0, W, H, { fill: WHT, stroke: WHT, sw: 0 }));
  // Outer border
  parts.push(rect(MARGIN / 2, MARGIN / 2, W - MARGIN, H - MARGIN, { fill: WHT, stroke: BLK, sw: SW_BORDER }));

  // ── Drawing title ────────────────────────────────────────────────────────────
  const titleCX = (DX + TB_X) / 2;
  parts.push(txt(titleCX, DY + 16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {
    size: F.title, bold: true, anchor: 'middle',
  }));
  parts.push(txt(titleCX, DY + 26,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    { size: F.sub, anchor: 'middle', fill: '#444444' }
  ));

  // ── Schematic border ─────────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));

  // ── Component X positions ────────────────────────────────────────────────────
  // Layout: PV Array → [DC Disco] → Inverter → AC Disco → Meter → MSP → Utility
  // Microinverter: PV Array → Microinverter → AC Disco → Meter → MSP → Utility
  const xPad    = 70;
  const usableW = SCH_W - xPad * 2;

  let xPV: number, xDCDis: number, xInv: number, xACDis: number, xMeter: number, xMSP: number, xUtil: number;

  if (isMicro) {
    // 5 components, 4 gaps
    xPV    = SCH_X + xPad;
    xInv   = SCH_X + xPad + usableW * 0.22;
    xACDis = SCH_X + xPad + usableW * 0.44;
    xMeter = SCH_X + xPad + usableW * 0.66;
    xMSP   = SCH_X + xPad + usableW * 0.83;
    xUtil  = SCH_X + xPad + usableW;
    xDCDis = -9999; // not used
  } else {
    // 6 components, 5 gaps
    xPV    = SCH_X + xPad;
    xDCDis = SCH_X + xPad + usableW * 0.17;
    xInv   = SCH_X + xPad + usableW * 0.35;
    xACDis = SCH_X + xPad + usableW * 0.53;
    xMeter = SCH_X + xPad + usableW * 0.70;
    xMSP   = SCH_X + xPad + usableW * 0.84;
    xUtil  = SCH_X + xPad + usableW;
  }

  // ── PV ARRAY ─────────────────────────────────────────────────────────────────
  const pvW = 90, pvH = 80;
  const pvCX = xPV, pvCY = BUS_Y;

  // PV module symbol (grid of cells)
  parts.push(rect(pvCX - pvW/2, pvCY - pvH/2, pvW, pvH, { fill: WHT, sw: SW_MED }));
  // Internal grid lines
  for (let gx = 1; gx < 3; gx++) {
    parts.push(line(pvCX - pvW/2 + gx * pvW/3, pvCY - pvH/2, pvCX - pvW/2 + gx * pvW/3, pvCY + pvH/2, { sw: SW_HAIR }));
  }
  for (let gy = 1; gy < 3; gy++) {
    parts.push(line(pvCX - pvW/2, pvCY - pvH/2 + gy * pvH/3, pvCX + pvW/2, pvCY - pvH/2 + gy * pvH/3, { sw: SW_HAIR }));
  }
  // Plus/minus symbols
  parts.push(txt(pvCX - pvW/2 + 8, pvCY - pvH/2 + 12, '+', { size: 10, bold: true }));
  parts.push(txt(pvCX + pvW/2 - 14, pvCY - pvH/2 + 12, '−', { size: 10, bold: true }));

  const pvStringLabel = isMicro
    ? `${input.deviceCount ?? input.totalModules} microinverters`
    : (input.totalStrings > 1
        ? `${input.totalStrings} strings × ${input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1))} panels`
        : `${input.totalModules} modules`);

  parts.push(txt(pvCX, pvCY - pvH/2 - 20, 'PV ARRAY', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY - pvH/2 - 10, `${input.totalModules} × ${input.panelWatts}W`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 10, pvStringLabel, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 20, esc(input.panelModel), { size: F.tiny, anchor: 'middle', italic: true }));
  parts.push(calloutCircle(pvCX + pvW/2 + 16, pvCY - pvH/2 - 6, 1));

  const pvOutX = pvCX + pvW/2;

  // ── MICROINVERTER TOPOLOGY ───────────────────────────────────────────────────
  if (isMicro) {
    const microDevCount = input.deviceCount ?? input.totalModules;
    const branchLimit   = 16;
    const numBranches   = input.microBranches?.length
      ? input.microBranches.length
      : Math.ceil(microDevCount / branchLimit);

    const branchRun     = findRun('BRANCH_RUN');
    const branchGauge   = input.branchWireGauge ?? branchRun?.wireGauge ?? '#10 AWG';
    const branchConduit = input.branchConduitSize ?? branchRun?.conduitSize ?? '3/4"';
    const branchOcpd    = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;

    // AC Combiner box — positioned between PV and Inverter
    const combCX = (pvCX + pvW/2 + xInv - 55) / 2;
    const combW  = 50;
    const combH  = Math.max(40, numBranches * 14 + 16);
    const combY  = BUS_Y - combH / 2;

    parts.push(rect(combCX - combW/2, combY, combW, combH, { fill: WHT, sw: SW_MED }));
    parts.push(txt(combCX, combY - 14, 'AC COMBINER', { size: F.tiny, bold: true, anchor: 'middle' }));
    parts.push(txt(combCX, combY - 5, 'J-BOX / WIREWAY', { size: 5.5, anchor: 'middle' }));
    parts.push(calloutCircle(combCX + combW/2 + 12, combY - 10, 2));

    // Branch circuits — stacked vertically
    const branchSpacing = Math.min(50, (SCH_H * 0.45) / Math.max(numBranches, 1));
    const totalSpan     = (numBranches - 1) * branchSpacing;
    const firstBranchY  = BUS_Y - totalSpan / 2;

    for (let b = 0; b < numBranches; b++) {
      const mbData      = input.microBranches?.[b];
      const basePerBr   = Math.floor(microDevCount / numBranches);
      const remainder   = microDevCount % numBranches;
      const devOnBranch = mbData?.deviceCount ?? (b < remainder ? basePerBr + 1 : basePerBr);
      const branchY     = firstBranchY + b * branchSpacing;
      const bOcpd       = mbData?.ocpdAmps ?? branchOcpd;

      // Small PV sub-array box
      const pvSubW = 36, pvSubH = 24;
      const pvSubX = pvCX + pvW/2 + 24;
      const pvSubCX = pvSubX + pvSubW/2;
      parts.push(rect(pvSubX, branchY - pvSubH/2, pvSubW, pvSubH, { fill: WHT, sw: SW_THIN }));
      parts.push(line(pvSubX, branchY, pvSubX + pvSubW, branchY, { sw: SW_HAIR }));
      parts.push(line(pvSubCX, branchY - pvSubH/2, pvSubCX, branchY + pvSubH/2, { sw: SW_HAIR }));
      parts.push(txt(pvSubCX, branchY - pvSubH/2 - 8, `BR ${b + 1}`, { size: F.tiny, bold: true, anchor: 'middle' }));
      parts.push(txt(pvSubCX, branchY + pvSubH/2 + 8, `${devOnBranch} micros`, { size: 5.5, anchor: 'middle' }));

      // Dashed DC stub from main PV to branch
      parts.push(line(pvOutX, pvCY, pvSubX, branchY, { sw: SW_HAIR, dash: '4,2' }));

      // AC branch wire to combiner
      const branchOutX = pvSubX + pvSubW;
      const combInX    = combCX - combW/2;
      parts.push(line(branchOutX, branchY, combInX, branchY, { sw: SW_MED }));

      // Wire callout on first branch only
      if (b === 0) {
        const branchLines = runToCalloutLines(branchRun, [
          `${branchGauge} THWN-2`,
          `${branchConduit} ${resolvedAcConduitType}`,
          `${bOcpd}A OCPD`,
        ]);
        const midX = (branchOutX + combInX) / 2;
        const calloutTopY = branchY - 50;
        parts.push(wireCalloutBox(midX, calloutTopY, branchLines, {
          leaderToY: branchY,
        }));
      }
    }

    // Combiner internal bus
    parts.push(line(combCX, combY + combH, combCX, BUS_Y, { sw: SW_MED }));
    parts.push(line(combCX, BUS_Y, combCX + combW/2, BUS_Y, { sw: SW_MED }));

    // Home run: combiner → inverter
    const combOutX = combCX + combW/2;
    parts.push(line(combOutX, BUS_Y, xInv - 55, BUS_Y, { sw: SW_HEAVY }));

    // Home run wire callout
    const homeRun = findRun('COMBINER_TO_DISCO_RUN');
    const homeLines = runToCalloutLines(homeRun, [
      `${resolvedAcWireGauge} THWN-2`,
      `${resolvedAcConduitSize} ${resolvedAcConduitType}`,
      `${resolvedAcOCPD}A OCPD`,
    ]);
    const homeMidX = (combOutX + xInv - 55) / 2;
    parts.push(wireCalloutBox(homeMidX, CALLOUT_Y, homeLines, { leaderToY: BUS_Y }));

  } else {
    // ── STRING/OPTIMIZER: DC wire from PV to DC Disco ─────────────────────────
    const dcStringRun = findRun('DC_STRING_RUN');
    const dcLines = runToCalloutLines(dcStringRun, [
      `${resolvedDcWireGauge} PV Wire`,
      '(OPEN AIR — NEC 690.31)',
    ]);
    // DC wire goes from PV output down to bus level, then right to DC Disco
    parts.push(line(pvOutX, pvCY, pvOutX + 20, pvCY, { sw: SW_MED }));
    parts.push(line(pvOutX + 20, pvCY, pvOutX + 20, BUS_Y, { sw: SW_MED }));
    parts.push(line(pvOutX + 20, BUS_Y, xDCDis - 44, BUS_Y, { sw: SW_MED }));
    // DC wire callout (open air — green border)
    const dcMidX = (pvOutX + 20 + xDCDis - 44) / 2;
    parts.push(wireCalloutBox(dcMidX, CALLOUT_Y, dcLines, {
      isOpenAir: true, leaderToY: BUS_Y,
    }));
  }

  // ── DC DISCONNECT (string/optimizer only) ────────────────────────────────────
  if (!isMicro) {
    const dcDisCX = xDCDis, dcDisCY = BUS_Y;
    parts.push(rect(dcDisCX - 44, dcDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
    parts.push(discoSym(dcDisCX, dcDisCY, 56, 18));
    parts.push(txt(dcDisCX, dcDisCY - 36, '(N) DC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
    parts.push(txt(dcDisCX, dcDisCY + 38, `${input.dcOCPD}A FUSED`, { size: F.tiny, anchor: 'middle' }));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcDisCX, dcDisCY + 48, 'RAPID SHUTDOWN — NEC 690.12', { size: F.tiny, anchor: 'middle', italic: true }));
    }
    parts.push(calloutCircle(dcDisCX + 50, dcDisCY - 34, 2));

    // DC wire from DC Disco to Inverter
    const dcDisToInvRun = findRun('DC_DISCO_TO_INV_RUN') ?? findRun('DC_STRING_RUN');
    const dcDisLines = runToCalloutLines(dcDisToInvRun, [
      `${resolvedDcWireGauge} PV Wire`,
      `${input.dcConduitType || 'EMT'}`,
    ]);
    parts.push(line(xDCDis + 44, BUS_Y, xInv - 55, BUS_Y, { sw: SW_MED }));
    const dcDisMidX = (xDCDis + 44 + xInv - 55) / 2;
    parts.push(wireCalloutBox(dcDisMidX, CALLOUT_Y, dcDisLines, { leaderToY: BUS_Y }));
  }

  // ── INVERTER ─────────────────────────────────────────────────────────────────
  const invCX = xInv, invCY = BUS_Y;
  const invW = 100, invH = 64;
  parts.push(rect(invCX - invW/2, invCY - invH/2, invW, invH, { fill: WHT, sw: SW_MED }));
  // DC/AC labels
  parts.push(txt(invCX - invW/2 + 6, invCY - 6, 'DC', { size: F.sub, bold: true }));
  parts.push(txt(invCX + invW/2 - 18, invCY - 6, 'AC', { size: F.sub, bold: true }));
  // DC→AC arrow
  parts.push(line(invCX - 10, invCY + 6, invCX + 6, invCY + 6, { sw: SW_THIN }));
  parts.push(`<polygon points="${invCX+6},${invCY+3} ${invCX+12},${invCY+6} ${invCX+6},${invCY+9}" fill="${BLK}"/>`);
  // Sine wave symbol
  parts.push(`<path d="M${invCX-8},${invCY-4} Q${invCX-4},${invCY-12} ${invCX},${invCY-4} Q${invCX+4},${invCY+4} ${invCX+8},${invCY-4}" fill="none" stroke="${BLK}" stroke-width="${SW_THIN}"/>`);
  // Center divider
  parts.push(line(invCX, invCY - invH/2, invCX, invCY + invH/2, { sw: SW_HAIR, dash: '3,2' }));
  // Connection stubs
  parts.push(line(invCX - invW/2 - 14, invCY, invCX - invW/2, invCY, { sw: SW_MED }));
  parts.push(line(invCX + invW/2, invCY, invCX + invW/2 + 14, invCY, { sw: SW_MED }));

  if (isMicro) {
    const microDevCount2 = input.deviceCount ?? input.totalModules;
    const numBranches2   = Math.ceil(microDevCount2 / 16);
    parts.push(txt(invCX, invCY - invH/2 - 20, 'MICROINVERTER', { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 10, `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 10, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 20, `${microDevCount2} units · ${numBranches2} branch circuit${numBranches2 > 1 ? 's' : ''}`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 30, 'NEC 690.8(B) — MAX 16/BRANCH', { size: F.tiny, anchor: 'middle', italic: true }));
  } else {
    const topoLabel = input.topologyType === 'STRING_WITH_OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER';
    const mpptLabel = input.mpptAllocation ? `MPPT: ${input.mpptAllocation}` : '';
    parts.push(txt(invCX, invCY - invH/2 - 20, topoLabel, { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 10, `${esc(input.inverterManufacturer)} ${esc(input.inverterModel)}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 10, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    if (mpptLabel) parts.push(txt(invCX, invCY + invH/2 + 20, mpptLabel, { size: F.tiny, anchor: 'middle' }));
    if (input.totalStrings > 1) {
      const ppStr = input.panelsPerString ?? Math.round(input.totalModules / input.totalStrings);
      parts.push(txt(invCX, invCY + invH/2 + 30, `${input.totalStrings} strings × ${ppStr} panels`, { size: F.tiny, anchor: 'middle', italic: true }));
    }
  }
  parts.push(calloutCircle(invCX + invW/2 + 16, invCY - invH/2 - 6, isMicro ? 3 : 3));

  // ── AC wire: Inverter → AC Disconnect ────────────────────────────────────────
  const invToDiscoRun = findRun(isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN');
  const invToDiscoLines = runToCalloutLines(invToDiscoRun, [
    `${resolvedAcWireGauge} THWN-2`,
    `${resolvedAcConduitSize} ${resolvedAcConduitType}`,
    `${resolvedAcOCPD}A OCPD`,
  ]);
  parts.push(line(invCX + invW/2 + 14, BUS_Y, xACDis - 44, BUS_Y, { sw: SW_HEAVY }));
  const acMid1X = (invCX + invW/2 + 14 + xACDis - 44) / 2;
  parts.push(wireCalloutBox(acMid1X, CALLOUT_Y, invToDiscoLines, { leaderToY: BUS_Y }));

  // ── AC DISCONNECT ─────────────────────────────────────────────────────────────
  const acDisCX = xACDis, acDisCY = BUS_Y;
  parts.push(rect(acDisCX - 44, acDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
  parts.push(discoSym(acDisCX, acDisCY, 56, 18));
  parts.push(txt(acDisCX, acDisCY - 36, '(N) AC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(acDisCX, acDisCY + 38, `${resolvedAcOCPD}A NON-FUSED`, { size: F.tiny, anchor: 'middle' }));
  parts.push(calloutCircle(acDisCX + 50, acDisCY - 34, 4));

  // ── AC wire: AC Disconnect → Production Meter ────────────────────────────────
  const discoToMeterRun = findRun('DISCO_TO_METER_RUN');
  const discoToMeterLines = runToCalloutLines(discoToMeterRun, [
    `${resolvedAcWireGauge} THWN-2`,
    `${resolvedAcConduitType}`,
  ]);
  parts.push(line(acDisCX + 44, BUS_Y, xMeter - 28, BUS_Y, { sw: SW_HEAVY }));
  const acMid2X = (acDisCX + 44 + xMeter - 28) / 2;
  parts.push(wireCalloutBox(acMid2X, CALLOUT_Y, discoToMeterLines, { leaderToY: BUS_Y }));

  // ── PRODUCTION METER ──────────────────────────────────────────────────────────
  const meterCX = xMeter, meterCY = BUS_Y;
  const meterR  = 26;
  parts.push(circle(meterCX, meterCY, meterR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - 3, 'kWh', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY + 8, 'METER', { size: 5.5, anchor: 'middle' }));
  parts.push(line(meterCX - meterR - 14, meterCY, meterCX - meterR, meterCY, { sw: SW_MED }));
  parts.push(line(meterCX + meterR, meterCY, meterCX + meterR + 14, meterCY, { sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - meterR - 18, 'PRODUCTION METER', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY - meterR - 8, 'BI-DIRECTIONAL', { size: F.tiny, anchor: 'middle' }));
  parts.push(calloutCircle(meterCX + meterR + 18, meterCY - meterR - 6, 5));

  // ── AC wire: Meter → MSP ─────────────────────────────────────────────────────
  const meterToMspRun = findRun('METER_TO_MSP_RUN');
  const meterToMspLines = runToCalloutLines(meterToMspRun, [
    `${resolvedAcWireGauge} THWN-2`,
    `${resolvedAcConduitType}`,
  ]);
  parts.push(line(meterCX + meterR + 14, BUS_Y, xMSP - 40, BUS_Y, { sw: SW_HEAVY }));
  const acMid3X = (meterCX + meterR + 14 + xMSP - 40) / 2;
  parts.push(wireCalloutBox(acMid3X, CALLOUT_Y, meterToMspLines, { leaderToY: BUS_Y }));

  // ── MAIN SERVICE PANEL ────────────────────────────────────────────────────────
  const mspCX = xMSP, mspCY = BUS_Y;
  const mspW = 72, mspH = 100;
  parts.push(rect(mspCX - mspW/2, mspCY - mspH/2, mspW, mspH, { fill: WHT, sw: SW_MED }));
  // Internal bus bar
  parts.push(line(mspCX, mspCY - mspH/2 + 10, mspCX, mspCY + mspH/2 - 10, { sw: SW_MED }));
  // Breaker symbols
  for (let i = 0; i < 3; i++) {
    const sy = mspCY - mspH/2 + 18 + i * 24;
    parts.push(line(mspCX - mspW/2 + 6, sy, mspCX - 4, sy, { sw: SW_THIN }));
    parts.push(rect(mspCX - 6, sy - 5, 12, 10, { fill: WHT, sw: SW_HAIR }));
    parts.push(line(mspCX + 4, sy, mspCX + mspW/2 - 6, sy, { sw: SW_THIN }));
  }
  parts.push(line(mspCX - mspW/2 - 14, mspCY, mspCX - mspW/2, mspCY, { sw: SW_MED }));
  parts.push(line(mspCX + mspW/2, mspCY, mspCX + mspW/2 + 14, mspCY, { sw: SW_MED }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 20, 'MAIN SERVICE PANEL', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 10, `${input.mainPanelAmps}A RATED`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY + mspH/2 + 10, `${input.backfeedAmps}A PV BREAKER`, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY + mspH/2 + 20, `NEC 705.12(B)(2)`, { size: F.tiny, anchor: 'middle', italic: true }));
  parts.push(calloutCircle(mspCX + mspW/2 + 18, mspCY - mspH/2 - 6, 6));

  // ── AC wire: MSP → Utility ───────────────────────────────────────────────────
  const mspToUtilRun = findRun('MSP_TO_UTILITY_RUN');
  const mspToUtilLines = runToCalloutLines(mspToUtilRun, [
    `${resolvedAcWireGauge} THWN-2`,
    `${resolvedAcConduitType}`,
  ]);
  parts.push(line(mspCX + mspW/2 + 14, BUS_Y, xUtil - 30, BUS_Y, { sw: SW_HEAVY }));
  const acMid4X = (mspCX + mspW/2 + 14 + xUtil - 30) / 2;
  parts.push(wireCalloutBox(acMid4X, CALLOUT_Y, mspToUtilLines, { leaderToY: BUS_Y }));

  // ── UTILITY GRID ──────────────────────────────────────────────────────────────
  const utilCX = xUtil, utilCY = BUS_Y;
  const utilR  = 28;
  parts.push(circle(utilCX, utilCY, utilR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - 3, 'UTILITY', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + 8, 'GRID', { size: 5.5, anchor: 'middle' }));
  parts.push(line(utilCX - utilR - 14, utilCY, utilCX - utilR, utilCY, { sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - utilR - 18, 'UTILITY GRID', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY - utilR - 8, esc(input.utilityName), { size: F.sub, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + utilR + 10, '120/240V, 1Ø, 3W', { size: F.tiny, anchor: 'middle' }));
  parts.push(calloutCircle(utilCX + utilR + 18, utilCY - utilR - 6, 7));

  // ── Grounding conductors (GREEN) ─────────────────────────────────────────────
  const gndPoints = isMicro
    ? [xInv, xACDis, xMeter, xMSP]
    : [xDCDis, xInv, xACDis, xMeter, xMSP];
  const gndLineY  = GND_Y + 20;
  const gndStartX = gndPoints[0];
  const gndEndX   = gndPoints[gndPoints.length - 1];

  parts.push(line(gndStartX, gndLineY, gndEndX, gndLineY, { stroke: GRN, sw: SW_MED }));
  for (const gx of gndPoints) {
    parts.push(line(gx, BUS_Y + 28, gx, gndLineY, { stroke: GRN, sw: SW_MED }));
    parts.push(gndSym(gx, gndLineY));
  }
  parts.push(txt((gndStartX + gndEndX) / 2, gndLineY - 6,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43',
    { size: F.tiny, anchor: 'middle', fill: GRN }
  ));

  // ── Rapid Shutdown note ──────────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rsdY = SCH_Y + SCH_H - 26;
    parts.push(rect(SCH_X + 6, rsdY - 12, 260, 20, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(SCH_X + 12, rsdY, 'RAPID SHUTDOWN SYSTEM — NEC 690.12 COMPLIANT', { size: F.tiny, bold: true }));
  }

  // ── LEGEND ───────────────────────────────────────────────────────────────────
  const legX = SCH_X + SCH_W - 200;
  const legY = SCH_Y + SCH_H - 76;
  const legW = 192, legH = 68;
  parts.push(rect(legX, legY, legW, legH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(legX + 6, legY + 11, 'LEGEND', { size: F.sub, bold: true }));
  parts.push(line(legX, legY + 14, legX + legW, legY + 14, { sw: SW_THIN }));
  const legItems = [
    { dash: '',    stroke: BLK, label: 'AC Conductor (THWN-2)' },
    { dash: '6,3', stroke: BLK, label: 'DC Conductor (PV Wire / Open Air)' },
    { dash: '',    stroke: GRN, label: 'Grounding Conductor (EGC)' },
    { dash: '4,2', stroke: GRN, label: 'Open Air Run (NEC 690.31)' },
  ];
  legItems.forEach((item, i) => {
    const ly = legY + 20 + i * 12;
    parts.push(line(legX + 6, ly, legX + 44, ly, { stroke: item.stroke, sw: SW_MED, dash: item.dash }));
    parts.push(txt(legX + 50, ly + 3, item.label, { size: F.tiny }));
  });

  // ── CALCULATION PANELS (below schematic) ─────────────────────────────────────
  const calcY = SCHED_Y;
  const calcH = SCHED_H;
  const calcW = Math.floor(DW / 3) - 4;
  const totalDcKw = input.totalModules * input.panelWatts / 1000;

  // Panel 1: DC / Micro AC Branch Calcs
  const dcCalcX = DX;
  parts.push(rect(dcCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(dcCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: 0 }));

  if (isMicro) {
    const microDevCount = input.deviceCount ?? input.totalModules;
    const acBranchCircuits = Math.ceil(microDevCount / 16);
    const acBranchAmps = Math.ceil((input.acOutputKw * 1000 / 240) * 1.25 / 5) * 5;
    parts.push(txt(dcCalcX + calcW/2, calcY + 11, 'AC BRANCH CIRCUIT INFO', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
    const microRows: [string, string][] = [
      ['Topology',            'MICROINVERTER'],
      ['Microinverters',      `${microDevCount} units`],
      ['Total DC Power',      `${totalDcKw.toFixed(2)} kW`],
      ['AC Output per Micro', `${((input.acOutputKw * 1000) / microDevCount).toFixed(0)} W`],
      ['AC Branch Circuits',  `${acBranchCircuits}`],
      ['Max Micros / Branch', '16 (NEC 690.8)'],
      ['AC Branch OCPD',      `${acBranchAmps} A`],
      ['AC Wire (branch)',    `${resolvedAcWireGauge}`],
      ['AC Conduit',          resolvedAcConduitType],
      ['Module Voc (STC)',    `${input.panelVoc} V`],
      ['Module Isc (STC)',    `${input.panelIsc} A`],
      ['DC/AC Ratio',         'N/A (micro)'],
    ];
    const rowH = Math.min(14, (calcH - 20) / microRows.length);
    microRows.forEach(([label, val], i) => {
      const ry = calcY + 22 + i * rowH;
      if (i % 2 === 1) parts.push(rect(dcCalcX, ry - rowH + 2, calcW, rowH, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(dcCalcX + 5, ry, label, { size: F.tiny }));
      parts.push(txt(dcCalcX + calcW - 5, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
    });
  } else {
    parts.push(txt(dcCalcX + calcW/2, calcY + 11, 'DC SYSTEM CALCULATIONS', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
    const panelsPerStr  = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
    const lastStrPanels = input.lastStringPanels ?? panelsPerStr;
    const vocCorr       = input.vocCorrected ?? input.panelVoc;
    const stringVocVal  = input.stringVoc ?? (vocCorr * panelsPerStr);
    const stringIscVal  = input.stringIsc ?? input.panelIsc;
    const ocpdStr       = input.ocpdPerString ?? input.dcOCPD;
    const designTemp    = input.designTempMin ?? -10;
    const dcAcRatio     = input.dcAcRatio ?? (input.acOutputKw > 0 ? totalDcKw / input.acOutputKw : 0);

    const dcRows: [string, string][] = [
      ['Module Voc (STC)',        `${input.panelVoc} V`],
      ['Module Isc (STC)',        `${input.panelIsc} A`],
      ['Design Temp (NEC 690.7)', `${designTemp}°C`],
      ['Voc Corrected',           `${vocCorr.toFixed(2)} V`],
      ['Panels per String',       panelsPerStr === lastStrPanels ? `${panelsPerStr}` : `${panelsPerStr} (last: ${lastStrPanels})`],
      ['Number of Strings',       `${input.totalStrings}`],
      ['String Voc (corrected)',  `${stringVocVal.toFixed(1)} V`],
      ['String Voc × 1.25 (NEC)', `${(stringVocVal * 1.25).toFixed(1)} V`],
      ['String Isc × 1.25 (NEC)', `${(stringIscVal * 1.25).toFixed(2)} A`],
      ['DC OCPD / String',        `${ocpdStr} A`],
      ['DC Wire Gauge',           `${resolvedDcWireGauge}`],
      ['Total DC Power',          `${totalDcKw.toFixed(2)} kW`],
      ['DC/AC Ratio',             `${dcAcRatio.toFixed(2)}`],
    ];
    const rowH = Math.min(14, (calcH - 20) / dcRows.length);
    dcRows.forEach(([label, val], i) => {
      const ry = calcY + 22 + i * rowH;
      if (i % 2 === 1) parts.push(rect(dcCalcX, ry - rowH + 2, calcW, rowH, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(dcCalcX + 5, ry, label, { size: F.tiny }));
      parts.push(txt(dcCalcX + calcW - 5, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
    });
  }

  // Panel 2: AC Calcs
  const acCalcX = DX + calcW + 4;
  parts.push(rect(acCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(acCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(acCalcX + calcW/2, calcY + 11, 'AC SYSTEM CALCULATIONS', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));

  const acRows: [string, string][] = [
    ['AC Output (kW)',    `${input.acOutputKw} kW`],
    ['AC Output Amps',   `${input.acOutputAmps} A`],
    ['AC OCPD (125%)',   `${resolvedAcOCPD} A`],
    ['AC Wire Gauge',    `${resolvedAcWireGauge}`],
    ['AC Conduit Type',  resolvedAcConduitType],
    ['Conduit Size',     resolvedAcConduitSize || '—'],
    ['Service Voltage',  '120/240V, 1Ø'],
    ['Main Panel Rating',`${input.mainPanelAmps} A`],
    ['Backfeed Breaker', `${input.backfeedAmps} A`],
    ['Busbar Loading',   `${((input.backfeedAmps / input.mainPanelAmps) * 100).toFixed(1)}%`],
    ['120% Rule Check',  `${input.mainPanelAmps * 1.2 >= input.mainPanelAmps + input.backfeedAmps ? 'PASS ✓' : 'FAIL ✗'}`],
    ['Interconnection',  esc(input.interconnection)],
  ];
  const acRowH = Math.min(14, (calcH - 20) / acRows.length);
  acRows.forEach(([label, val], i) => {
    const ry = calcY + 22 + i * acRowH;
    if (i % 2 === 1) parts.push(rect(acCalcX, ry - acRowH + 2, calcW, acRowH, { fill: LGY, stroke: 'none', sw: 0 }));
    parts.push(txt(acCalcX + 5, ry, label, { size: F.tiny }));
    parts.push(txt(acCalcX + calcW - 5, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
  });

  // Panel 3: Equipment Schedule
  const eqCalcX = DX + (calcW + 4) * 2;
  parts.push(rect(eqCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(eqCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(eqCalcX + calcW/2, calcY + 11, 'EQUIPMENT SCHEDULE', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));

  const microDevCountEq = input.deviceCount ?? input.totalModules;
  const panelsPerStrEq  = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));

  const eqRows: [string, string][] = isMicro ? [
    ['PV Module',          esc(input.panelModel)],
    ['Module Wattage',     `${input.panelWatts} W`],
    ['Total Modules',      `${input.totalModules}`],
    ['Microinverters',     `${microDevCountEq} units`],
    ['AC Branch Circuits', `${Math.ceil(microDevCountEq / 16)}`],
    ['Inverter Mfr.',      esc(input.inverterManufacturer)],
    ['Inverter Model',     esc(input.inverterModel)],
    ['Inverter Output',    `${input.acOutputKw} kW AC`],
    ['Main Panel',         `${input.mainPanelAmps} A`],
    ['Utility',            esc(input.utilityName)],
    ['Interconnection',    esc(input.interconnection)],
    ['Rapid Shutdown',     input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
    ['Battery Storage',    input.hasBattery ? esc(input.batteryModel) : 'NONE'],
  ] : [
    ['PV Module',          esc(input.panelModel)],
    ['Module Wattage',     `${input.panelWatts} W`],
    ['Total Modules',      `${input.totalModules}`],
    ['Strings',            `${input.totalStrings} × ${panelsPerStrEq} panels`],
    ['MPPT Channels',      input.mpptAllocation ?? `${input.mpptChannels ?? 1} ch`],
    ['Combiner',           esc(input.combinerLabel ?? (input.combinerType ?? 'Direct'))],
    ['Inverter Mfr.',      esc(input.inverterManufacturer)],
    ['Inverter Model',     esc(input.inverterModel)],
    ['Inverter Output',    `${input.acOutputKw} kW AC`],
    ['Main Panel',         `${input.mainPanelAmps} A`],
    ['Utility',            esc(input.utilityName)],
    ['Interconnection',    esc(input.interconnection)],
    ['Rapid Shutdown',     input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
    ['Battery Storage',    input.hasBattery ? esc(input.batteryModel) : 'NONE'],
  ];
  const eqRowH = Math.min(14, (calcH - 20) / eqRows.length);
  eqRows.forEach(([label, val], i) => {
    const ry = calcY + 22 + i * eqRowH;
    if (i % 2 === 1) parts.push(rect(eqCalcX, ry - eqRowH + 2, calcW, eqRowH, { fill: LGY, stroke: 'none', sw: 0 }));
    parts.push(txt(eqCalcX + 5, ry, label, { size: F.tiny }));
    parts.push(txt(eqCalcX + calcW - 5, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
  });

  // ── CONDUIT & CONDUCTOR SCHEDULE ─────────────────────────────────────────────
  const schedY2 = NOTES_Y;
  const schedH2 = NOTES_H;
  parts.push(rect(DX, schedY2, DW, schedH2, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(rect(DX, schedY2, DW, 16, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(DX + 8, schedY2 + 11, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9', {
    size: F.hdr, bold: true, fill: WHT,
  }));

  // Column definitions
  const schedCols = [
    { label: 'RUN ID',      w: 0.07 },
    { label: 'FROM',        w: 0.11 },
    { label: 'TO',          w: 0.11 },
    { label: 'CONDUCTORS',  w: 0.24 },
    { label: 'CONDUIT',     w: 0.10 },
    { label: 'FILL %',      w: 0.06 },
    { label: 'AMPACITY',    w: 0.07 },
    { label: 'OCPD',        w: 0.06 },
    { label: 'V-DROP %',    w: 0.07 },
    { label: 'LENGTH',      w: 0.06 },
    { label: 'PASS',        w: 0.05 },
  ];

  const hdrRowY = schedY2 + 26;
  const rowH    = 14;
  let colX = DX;
  schedCols.forEach(col => {
    const cw = col.w * DW;
    parts.push(txt(colX + 3, hdrRowY, col.label, { size: F.tiny, bold: true }));
    parts.push(line(colX, schedY2 + 16, colX, schedY2 + schedH2, { sw: SW_HAIR }));
    colX += cw;
  });
  parts.push(line(DX, hdrRowY + 2, DX + DW, hdrRowY + 2, { sw: SW_THIN }));

  // Build schedule rows from RunSegment[] — single source of truth
  let schedRows: {
    id: string; from: string; to: string;
    conductors: string; conduitType: string;
    fillPercent: number; ampacity: number;
    ocpd: number; voltageDrop: number;
    lengthFt: number; pass: boolean;
  }[] = [];

  if (input.runs && input.runs.length > 0) {
    schedRows = input.runs.map(run => {
      // Build conductor display string from best available data
      let conductorsDisplay = '';
      if (run.conductorBundle && run.conductorBundle.length > 0) {
        conductorsDisplay = run.conductorBundle
          .map((c: ConductorBundle) => {
            const g = c.gauge.replace('#', '').replace(' AWG', '');
            return `${c.qty}#${g} ${c.insulation} ${c.color}`;
          })
          .join(' + ');
      } else if (run.conductorCallout) {
        conductorsDisplay = run.conductorCallout
          .replace(/\n/g, ' + ')
          .replace(/IN \S+ \S+$/, '')
          .replace(/\(OPEN AIR[^)]*\)/, '(OPEN AIR)')
          .trim();
      } else {
        const g = run.wireGauge.replace('#', '').replace(' AWG', '');
        const eg = run.egcGauge.replace('#', '').replace(' AWG', '');
        conductorsDisplay = `${run.conductorCount}#${g} ${run.insulation} + 1#${eg} GND`;
      }

      const conduitDisplay = run.isOpenAir
        ? 'OPEN AIR'
        : `${run.conduitType} ${run.conduitSize}`;

      return {
        id:          run.id,
        from:        run.from,
        to:          run.to,
        conductors:  conductorsDisplay,
        conduitType: conduitDisplay,
        fillPercent: run.conduitFillPct ?? 0,
        ampacity:    run.continuousCurrent ?? 0,
        ocpd:        run.ocpdAmps ?? 0,
        voltageDrop: run.voltageDropPct ?? 0,
        lengthFt:    run.onewayLengthFt ?? 0,
        pass:        run.overallPass ?? true,
      };
    });
  } else {
    // Fallback when no runs provided
    schedRows = isMicro ? [
      { id: 'BR-1', from: 'MICROINVERTERS', to: 'AC COMBINER', conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.2, lengthFt: 50, pass: true },
      { id: 'A-1',  from: 'AC COMBINER',   to: 'AC DISCO',    conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.4, lengthFt: 20, pass: true },
      { id: 'A-2',  from: 'AC DISCO',       to: 'METER',       conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.4, lengthFt: 15, pass: true },
      { id: 'A-3',  from: 'METER',          to: 'MSP',         conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, lengthFt: 10, pass: true },
    ] : [
      { id: 'D-1', from: 'PV ARRAY',  to: 'DC DISCO',  conductors: `${resolvedDcWireGauge} PV Wire`,  conduitType: 'OPEN AIR',                                                                   fillPercent: 0,  ampacity: 30,                  ocpd: input.dcOCPD,   voltageDrop: 1.2, lengthFt: 50, pass: true },
      { id: 'D-2', from: 'DC DISCO',  to: 'INVERTER',  conductors: `${resolvedDcWireGauge} PV Wire`,  conduitType: `${input.dcConduitType} 3/4"`,                                                fillPercent: 28, ampacity: 30,                  ocpd: input.dcOCPD,   voltageDrop: 1.2, lengthFt: 20, pass: true },
      { id: 'A-1', from: 'INVERTER',  to: 'AC DISCO',  conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`,                          fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, lengthFt: 20, pass: true },
      { id: 'A-2', from: 'AC DISCO',  to: 'METER',     conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`,                          fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, lengthFt: 15, pass: true },
      { id: 'A-3', from: 'METER',     to: 'MSP',       conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize}`,                          fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, lengthFt: 10, pass: true },
    ];
  }

  const maxRows = Math.floor((schedH2 - 32) / rowH);
  schedRows.slice(0, maxRows).forEach((row, ri) => {
    const ry = hdrRowY + 4 + (ri + 1) * rowH;
    if (ri % 2 === 1) parts.push(rect(DX, ry - rowH + 2, DW, rowH, { fill: LGY, stroke: 'none', sw: 0 }));

    const passColor = row.pass ? GRN_PASS : RED_FAIL;
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
      const fillColor = ci === 10 ? passColor : BLK;
      const isBold    = ci === 10;
      parts.push(txt(cx2 + 3, ry, String(vals[ci] ?? ''), { size: F.tiny, fill: fillColor, bold: isBold }));
      cx2 += cw;
    });
  });

  // ── TITLE BLOCK (right side) ─────────────────────────────────────────────────
  const tbX = TB_X;
  const tbY = DY;
  const tbH = DH;

  parts.push(rect(tbX, tbY, TB_W, tbH, { fill: WHT, stroke: BLK, sw: SW_HEAVY }));

  // Company header
  parts.push(rect(tbX, tbY, TB_W, 42, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, tbY + 17, 'SOLARPRO', { size: 15, bold: true, anchor: 'middle', fill: WHT }));
  parts.push(txt(tbX + TB_W/2, tbY + 30, 'ENGINEERING', { size: F.tb, anchor: 'middle', fill: '#AAAAAA' }));

  // Drawing title
  parts.push(rect(tbX, tbY + 42, TB_W, 34, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, tbY + 57, 'SINGLE LINE DIAGRAM', { size: F.tbTitle, bold: true, anchor: 'middle' }));
  parts.push(txt(tbX + TB_W/2, tbY + 70, 'PHOTOVOLTAIC SYSTEM', { size: F.tb, anchor: 'middle' }));

  // Project info rows
  const tbInfoRows: [string, string][] = [
    ['PROJECT',  input.projectName],
    ['CLIENT',   input.clientName],
    ['ADDRESS',  input.address],
    ['DESIGNER', input.designer],
    ['DATE',     input.drawingDate],
    ['DWG NO.',  input.drawingNumber],
    ['REVISION', input.revision],
    ['SCALE',    input.scale || 'NOT TO SCALE'],
  ];
  let tbRowY = tbY + 76;
  const tbRowH = 22;
  tbInfoRows.forEach(([label, val]) => {
    parts.push(rect(tbX, tbRowY, TB_W, tbRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 5, tbRowY + 14, label, { size: F.tiny, bold: true, fill: '#555555' }));
    parts.push(txt(tbX + 68, tbRowY + 14, esc(String(val ?? '')), { size: F.tb }));
    tbRowY += tbRowH;
  });

  // System Summary
  const sysY = tbRowY + 4;
  parts.push(rect(tbX, sysY, TB_W, 14, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, sysY + 10, 'SYSTEM SUMMARY', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));

  const sysRows: [string, string][] = [
    ['TOPOLOGY',   input.topologyType.replace(/_/g, ' ')],
    ['DC SIZE',    `${(input.totalModules * input.panelWatts / 1000).toFixed(2)} kW`],
    ['AC OUTPUT',  `${input.acOutputKw} kW`],
    ['MODULES',    `${input.totalModules} × ${input.panelWatts}W`],
    ['INVERTER',   `${esc(input.inverterManufacturer)}`],
    ['MODEL',      `${esc(input.inverterModel)}`],
    ['SERVICE',    `${input.mainPanelAmps}A`],
    ['UTILITY',    esc(input.utilityName)],
    ['INTERCONN.', esc(input.interconnection)],
  ];
  let sysRowY = sysY + 14;
  const sysRowH = 18;
  sysRows.forEach(([label, val]) => {
    parts.push(rect(tbX, sysRowY, TB_W, sysRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 5, sysRowY + 12, label, { size: F.tiny, bold: true, fill: '#555555' }));
    parts.push(txt(tbX + 76, sysRowY + 12, esc(String(val ?? '')), { size: F.tb }));
    sysRowY += sysRowH;
  });

  // Code References
  const codeY = sysRowY + 4;
  parts.push(rect(tbX, codeY, TB_W, 14, { fill: BLK, stroke: BLK, sw: 0 }));
  parts.push(txt(tbX + TB_W/2, codeY + 10, 'CODE REFERENCES', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
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
  let codeRowY = codeY + 14;
  codes.forEach(code => {
    parts.push(txt(tbX + 5, codeRowY + 10, code, { size: F.tiny }));
    codeRowY += 13;
  });

  // Revisions table
  const revY = codeRowY + 4;
  const revH = Math.min(90, tbY + tbH - revY - 58);
  if (revH > 28) {
    parts.push(rect(tbX, revY, TB_W, 14, { fill: BLK, stroke: BLK, sw: 0 }));
    parts.push(txt(tbX + TB_W/2, revY + 10, 'REVISIONS', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
    parts.push(rect(tbX, revY + 14, TB_W, revH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    const revColW = TB_W / 3;
    parts.push(txt(tbX + 4, revY + 24, 'REV', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + revColW + 3, revY + 24, 'DESCRIPTION', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + revColW * 2 + 3, revY + 24, 'DATE', { size: F.tiny, bold: true }));
    parts.push(line(tbX, revY + 26, tbX + TB_W, revY + 26, { sw: SW_HAIR }));
    parts.push(line(tbX + revColW, revY + 14, tbX + revColW, revY + revH, { sw: SW_HAIR }));
    parts.push(line(tbX + revColW * 2, revY + 14, tbX + revColW * 2, revY + revH, { sw: SW_HAIR }));
    parts.push(txt(tbX + 4, revY + 38, input.revision, { size: F.tiny }));
    parts.push(txt(tbX + revColW + 3, revY + 38, 'INITIAL ISSUE', { size: F.tiny }));
    parts.push(txt(tbX + revColW * 2 + 3, revY + 38, input.drawingDate, { size: F.tiny }));
  }

  // Engineer seal area
  const sealY = tbY + tbH - 54;
  parts.push(rect(tbX, sealY, TB_W, 54, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(circle(tbX + TB_W/2, sealY + 26, 20, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, sealY + 22, 'ENGINEER', { size: F.tiny, anchor: 'middle', fill: '#888888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 33, 'SEAL', { size: F.tiny, anchor: 'middle', fill: '#888888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 48, `${esc(input.designer)} — ${esc(input.drawingDate)}`, { size: F.tiny, anchor: 'middle', fill: '#555555' }));

  parts.push('</svg>');
  return parts.join('\n');
}