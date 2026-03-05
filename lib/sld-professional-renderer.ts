// ============================================================
// Professional SLD Renderer V9 — True IEEE Engineering Drawing
// ANSI C Landscape (24"×18") = 2304×1728px at 96 DPI
// Style: Pure black/white engineering schematic
//   - Black lines on white background ONLY
//   - IEEE symbols as SVG paths (no colored boxes)
//   - Green ONLY for grounding conductors
//   - Numbered callout circles for components
//   - Right-side title block with revision table
//   - Wire labels inline next to conductors
//   - Multi-line conductor callouts via SVG <tspan>
//   - ConductorBundle[] as single source of truth
// ============================================================

import {
  buildSLDTopologyGraph,
  SLDGraphInput,
  SLDTopologyGraph,
  TopologyType,
} from './topology-engine';
import {
  calcAllSegments,
  buildConduitSchedule,
  SegmentCalcParams,
  ConduitScheduleRow,
} from './wire-autosizer';
import type { RunSegment, MicroBranch } from './computed-system';
import type { ConductorBundle } from './segment-schedule';

// ─── Canvas ──────────────────────────────────────────────────────────────────
const W = 2304;
const H = 1728;
const M = 48;

// Title block on right
const TB_W = 300;
const TB_X = W - TB_W - M;

// Drawing area (left of title block)
const DX = M;
const DY = M;
const DW = TB_X - M - 16;
const DH = H - M * 2;

// Bottom tables area
const SCHED_H  = 180;   // expanded to show up to 10 runs
const NOTES_H  = 130;
const SCHED_Y  = H - M - SCHED_H;
const NOTES_Y  = SCHED_Y - NOTES_H - 12;

// Main schematic area
const SCH_X = DX;
const SCH_Y = DY + 32;
const SCH_W = DW;
const SCH_H = NOTES_Y - SCH_Y - 12;

// ─── Colors ──────────────────────────────────────────────────────────────────
const BLK = '#000000';
const GRN = '#006600';   // grounding ONLY
const WHT = '#FFFFFF';
const LGY = '#F4F4F4';   // light gray for table alternating rows
const DGY = '#CCCCCC';   // dark gray for dividers

// ─── Stroke widths ───────────────────────────────────────────────────────────
const SW_HEAVY = 2.5;
const SW_MED   = 1.5;
const SW_THIN  = 1.0;
const SW_HAIR  = 0.5;

// ─── Fonts ───────────────────────────────────────────────────────────────────
const F = {
  title:  15,
  hdr:    10,
  label:   8,
  sub:     7,
  tiny:    6.5,
  note:    6.5,
  tb:      7.5,
  tbTitle: 11,
  tbBig:   13,
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

  // Auto String Generation (NEC 690.7) -- string/optimizer topology
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

  // ComputedSystem runSegments — single source of truth for wire labels
  runs?:                   RunSegment[];
}

// ─── SVG helpers ─────────────────────────────────────────────────────────────
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

// Multi-line text using tspan — handles \n in conductor callouts
function multilineTxt(
  x: number, y: number, content: string,
  opts: {
    size?: number; bold?: boolean; anchor?: 'start'|'middle'|'end';
    fill?: string; lineHeight?: number;
  } = {}
): string {
  const size       = opts.size       ?? F.tiny;
  const bold       = opts.bold       ? `font-weight="bold"` : '';
  const anchor     = `text-anchor="${opts.anchor ?? 'start'}"`;
  const fill       = `fill="${opts.fill ?? BLK}"`;
  const lineHeight = opts.lineHeight ?? (size * 1.4);
  const lines      = String(content ?? '').split('\n');
  const tspans     = lines.map((line, i) =>
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

// Numbered callout circle (IEEE style)
function callout(cx: number, cy: number, n: number, r = 14): string {
  return circle(cx, cy, r, { fill: WHT, stroke: BLK, sw: SW_MED })
    + txt(cx, cy + 1, String(n), { size: F.hdr, bold: true, anchor: 'middle', fill: BLK });
}

// Ground symbol (IEEE)
function gndSym(x: number, y: number): string {
  const s: string[] = [];
  s.push(line(x, y, x, y + 12, { stroke: GRN, sw: SW_MED }));
  s.push(line(x - 12, y + 12, x + 12, y + 12, { stroke: GRN, sw: SW_MED }));
  s.push(line(x - 8,  y + 17, x + 8,  y + 17, { stroke: GRN, sw: SW_MED }));
  s.push(line(x - 4,  y + 22, x + 4,  y + 22, { stroke: GRN, sw: SW_MED }));
  return s.join('');
}

// Knife-blade disconnect symbol (IEEE 315)
function discoSym(cx: number, cy: number, w = 60, h = 20): string {
  const s: string[] = [];
  const lx = cx - w / 2;
  const rx = cx + w / 2;
  s.push(line(lx, cy, lx + 14, cy, { sw: SW_MED }));
  s.push(line(rx - 14, cy, rx, cy, { sw: SW_MED }));
  s.push(line(lx + 14, cy, rx - 14, cy - h * 0.5, { sw: SW_MED }));
  s.push(circle(lx + 14, cy, 3, { fill: BLK }));
  s.push(circle(rx - 14, cy, 3, { fill: WHT }));
  return s.join('');
}

// Wire label box — clean bordered callout above conductor
function wireCalloutBox(cx: number, cy: number, lines: string[], isOpenAir = false): string {
  if (!lines.length) return '';
  const lineH   = 9;
  const padding = 5;
  const boxW    = Math.max(...lines.map(l => l.length)) * 4.8 + padding * 2;
  const boxH    = lines.length * lineH + padding * 2;
  const bx      = cx - boxW / 2;
  const by      = cy - boxH - 4;
  const s: string[] = [];
  s.push(rect(bx, by, boxW, boxH, {
    fill: WHT, stroke: isOpenAir ? GRN : BLK, sw: SW_HAIR,
  }));
  lines.forEach((l, i) => {
    s.push(txt(cx, by + padding + (i + 1) * lineH - 1, l, {
      size: F.tiny, anchor: 'middle',
      fill: isOpenAir ? GRN : BLK,
      bold: i === 0,
    }));
  });
  // Leader line from box to conductor
  s.push(line(cx, by + boxH, cx, cy, { stroke: isOpenAir ? GRN : BLK, sw: SW_HAIR, dash: '2,2' }));
  return s.join('');
}

// Format ConductorBundle[] into display lines for wire callout box
function bundleToLines(bundle: ConductorBundle[] | undefined, conduitSize: string, conduitType: string, isOpenAir: boolean): string[] {
  if (!bundle || bundle.length === 0) return [];
  const lines = bundle.map(c => `${c.qty}#${c.gauge.replace('#', '').replace(' AWG', '')} ${c.color}`);
  if (isOpenAir) {
    lines.push('(OPEN AIR)');
  } else {
    const abbrev = conduitType === 'EMT' ? 'EMT'
      : conduitType === 'PVC Sch 40' ? 'PVC SCH 40'
      : conduitType === 'PVC Sch 80' ? 'PVC SCH 80'
      : conduitType || 'EMT';
    lines.push(`IN ${conduitSize} ${abbrev}`);
  }
  return lines;
}

// Format conductorCallout string (may contain \n) into lines array
function calloutToLines(callout: string): string[] {
  if (!callout) return [];
  return callout.split('\n').filter(l => l.trim().length > 0);
}

// ─── Main render function ─────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  const parts: string[] = [];

  // ── Derive wire gauges / OCPD from ComputedSystem.runs (single source of truth)
  const isMicroTopo = input.topologyType === 'MICROINVERTER';
  let resolvedAcWireGauge   = input.acWireGauge   || '#8 AWG';
  let resolvedDcWireGauge   = input.dcWireGauge   || '#10 AWG';
  let resolvedAcOCPD        = input.acOCPD        || 30;
  let resolvedAcConduitSize = '';
  let resolvedAcConduitType = input.acConduitType || 'EMT';
  let resolvedDcConduitSize = '';

  // Run segment lookup helpers
  const findRun = (id: string) => input.runs?.find(r => r.id === id);
  const findRunByColor = (color: string) => input.runs?.find(r => r.color === color);

  if (input.runs && input.runs.length > 0) {
    const acRunId = isMicroTopo ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN';
    const acRun   = findRun(acRunId) ?? findRunByColor('ac');
    if (acRun) {
      resolvedAcWireGauge   = acRun.wireGauge   || resolvedAcWireGauge;
      resolvedAcOCPD        = acRun.ocpdAmps    || resolvedAcOCPD;
      resolvedAcConduitSize = acRun.conduitSize || '';
      resolvedAcConduitType = acRun.conduitType || resolvedAcConduitType;
    }
    const dcRunId = isMicroTopo ? 'ROOF_RUN' : 'DC_STRING_RUN';
    const dcRun   = findRun(dcRunId) ?? findRunByColor('dc');
    if (dcRun) {
      resolvedDcWireGauge   = dcRun.wireGauge   || resolvedDcWireGauge;
      resolvedDcConduitSize = dcRun.conduitSize || '';
    }
  }

  // ── SVG root ──────────────────────────────────────────────────────────────
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};font-family:Arial,Helvetica,sans-serif;">`);
  parts.push(rect(0, 0, W, H, { fill: WHT, stroke: WHT, sw: 0 }));
  parts.push(rect(M / 2, M / 2, W - M, H - M, { fill: WHT, stroke: BLK, sw: SW_HEAVY }));

  // ── Drawing title (top center) ────────────────────────────────────────────
  const titleCX = (DX + TB_X) / 2;
  parts.push(txt(titleCX, DY + 18, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {
    size: F.title, bold: true, anchor: 'middle',
  }));
  parts.push(txt(titleCX, DY + 30,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    { size: F.sub, anchor: 'middle', fill: '#444444' }
  ));

  // ── Schematic border ──────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));

  // ── Layout positions ──────────────────────────────────────────────────────
  const isMicro = input.topologyType === 'MICROINVERTER';
  const busY    = SCH_Y + Math.round(SCH_H * 0.44);
  const xPad    = 80;
  const usableW = SCH_W - xPad * 2;

  // Component X positions — topology-aware spacing
  // MICROINVERTER:  PV → Microinverter → AC Disco → Meter → MSP → Utility  (5 gaps)
  // STRING/OPT:     PV → DC Disco → Inverter → AC Disco → Meter → MSP → Utility (6 gaps)
  const xPV    = SCH_X + xPad;
  const xDCDis = isMicro ? -9999 : SCH_X + xPad + usableW * (1/6);
  const xInv   = isMicro ? SCH_X + xPad + usableW * (1/5) : SCH_X + xPad + usableW * (2/6);
  const xACDis = isMicro ? SCH_X + xPad + usableW * (2/5) : SCH_X + xPad + usableW * (3/6);
  const xMeter = isMicro ? SCH_X + xPad + usableW * (3/5) : SCH_X + xPad + usableW * (4/6);
  const xMSP   = isMicro ? SCH_X + xPad + usableW * (4/5) : SCH_X + xPad + usableW * (5/6);
  const xUtil  = SCH_X + xPad + usableW;

  // ─── PV ARRAY ─────────────────────────────────────────────────────────────
  const pvW = 100, pvH = 90;
  const pvCX = xPV, pvCY = busY - 40;

  parts.push(rect(pvCX - pvW/2, pvCY - pvH/2, pvW, pvH, { fill: WHT, sw: SW_MED }));
  // Grid lines inside PV symbol
  parts.push(line(pvCX - pvW/2, pvCY, pvCX + pvW/2, pvCY, { sw: SW_HAIR }));
  parts.push(line(pvCX, pvCY - pvH/2, pvCX, pvCY + pvH/2, { sw: SW_HAIR }));
  parts.push(line(pvCX - pvW/4, pvCY - pvH/2, pvCX - pvW/4, pvCY + pvH/2, { sw: SW_HAIR }));
  parts.push(line(pvCX + pvW/4, pvCY - pvH/2, pvCX + pvW/4, pvCY + pvH/2, { sw: SW_HAIR }));
  parts.push(line(pvCX - pvW/2, pvCY - pvH/4, pvCX + pvW/2, pvCY - pvH/4, { sw: SW_HAIR }));
  parts.push(line(pvCX - pvW/2, pvCY + pvH/4, pvCX + pvW/2, pvCY + pvH/4, { sw: SW_HAIR }));

  const pvPanelsPerStr = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
  const pvStringLabel  = isMicro
    ? `${input.deviceCount ?? input.totalModules} microinverters`
    : (input.totalStrings > 1
        ? `${input.totalStrings} strings × ${pvPanelsPerStr} panels`
        : `${input.totalModules} modules`);

  parts.push(txt(pvCX, pvCY - pvH/2 - 22, 'PV ARRAY', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY - pvH/2 - 11, `${input.totalModules} × ${input.panelWatts}W`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 11, pvStringLabel, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 21, input.panelModel, { size: F.tiny, anchor: 'middle', italic: true }));
  parts.push(callout(pvCX + pvW/2 + 18, pvCY - pvH/2 - 8, 1));

  const pvOutX = pvCX + pvW/2;

  // ─── MICROINVERTER BRANCH CIRCUITS ────────────────────────────────────────
  if (isMicro) {
    const microDevCount = input.deviceCount ?? input.totalModules;
    const branchLimit   = 16;
    const numBranches   = input.microBranches?.length
      ? input.microBranches.length
      : Math.ceil(microDevCount / branchLimit);

    // Branch wire data from runs
    const branchRun     = findRun('BRANCH_RUN');
    const branchGauge   = input.branchWireGauge ?? branchRun?.wireGauge ?? '#10 AWG';
    const branchConduit = input.branchConduitSize ?? branchRun?.conduitSize ?? '3/4"';
    const branchOcpd    = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    const branchBundle  = branchRun?.conductorBundle;

    // AC Combiner box position
    const combBoxX = xInv - 70;
    const combBoxW = 52;
    const combBoxH = Math.max(44, numBranches * 16 + 16);
    const combBoxY = busY - combBoxH / 2;

    parts.push(rect(combBoxX - combBoxW/2, combBoxY, combBoxW, combBoxH, { fill: WHT, sw: SW_MED }));
    parts.push(txt(combBoxX, combBoxY - 12, 'AC COMBINER', { size: F.tiny, bold: true, anchor: 'middle' }));
    parts.push(txt(combBoxX, combBoxY - 3, 'J-BOX / WIREWAY', { size: 5.5, anchor: 'middle' }));
    parts.push(callout(combBoxX + combBoxW/2 + 14, combBoxY - 10, 2));

    // Branch circuits
    const branchSpacing = Math.min(55, (SCH_H * 0.50) / Math.max(numBranches, 1));
    const totalBranchSpan = (numBranches - 1) * branchSpacing;
    const firstBranchY = busY - totalBranchSpan / 2;

    for (let b = 0; b < numBranches; b++) {
      const mbData = input.microBranches?.[b];
      const basePerBranch = Math.floor(microDevCount / numBranches);
      const remainder     = microDevCount % numBranches;
      const devOnBranch   = mbData?.deviceCount ?? (b < remainder ? basePerBranch + 1 : basePerBranch);
      const branchY       = firstBranchY + b * branchSpacing;
      const bOcpd         = mbData?.ocpdAmps ?? branchOcpd;
      const bAmps         = mbData ? mbData.branchCurrentA.toFixed(1) : '—';

      // Small PV sub-array box
      const pvSubW = 40, pvSubH = 28;
      const pvSubX = xPV + pvW/2 + 28;
      const pvSubCX = pvSubX + pvSubW/2;
      parts.push(rect(pvSubX, branchY - pvSubH/2, pvSubW, pvSubH, { fill: WHT, sw: SW_THIN }));
      parts.push(line(pvSubX, branchY, pvSubX + pvSubW, branchY, { sw: SW_HAIR }));
      parts.push(line(pvSubCX, branchY - pvSubH/2, pvSubCX, branchY + pvSubH/2, { sw: SW_HAIR }));
      parts.push(txt(pvSubCX, branchY - pvSubH/2 - 9, `BR ${b + 1}`, { size: F.tiny, bold: true, anchor: 'middle' }));
      parts.push(txt(pvSubCX, branchY + pvSubH/2 + 8, `${devOnBranch} × ${bAmps}A`, { size: 5.5, anchor: 'middle' }));

      // Dashed DC stub from main PV array to branch
      parts.push(line(pvOutX, pvCY, pvSubX, branchY, { sw: SW_HAIR, dash: '4,2' }));

      // AC branch wire to combiner
      const branchOutX = pvSubX + pvSubW;
      const combInX    = combBoxX - combBoxW/2;
      parts.push(line(branchOutX, branchY, combInX, branchY, { sw: SW_MED }));
      parts.push(line(combInX, branchY, combInX, busY + (b - (numBranches-1)/2) * 5, { sw: SW_HAIR }));

      // Wire callout on branch run (only on first branch to avoid clutter)
      if (b === 0 && branchBundle) {
        const calloutLines = bundleToLines(branchBundle, branchConduit, resolvedAcConduitType, false);
        calloutLines.push(`${bOcpd}A OCPD`);
        const midX = (branchOutX + combInX) / 2;
        parts.push(wireCalloutBox(midX, branchY, calloutLines));
      } else if (b === 0) {
        parts.push(wireCalloutBox(
          (branchOutX + combInX) / 2, branchY,
          [`${branchGauge}`, `${branchConduit} ${resolvedAcConduitType}`, `${bOcpd}A OCPD`]
        ));
      }
    }

    // Home run from combiner to inverter bus
    const combOutX = combBoxX + combBoxW/2;
    parts.push(line(combOutX, busY, xInv - 55, busY, { sw: SW_HEAVY }));

    // Home run wire callout
    const homeRunRun = findRun('COMBINER_TO_DISCO_RUN');
    const homeRunBundle = homeRunRun?.conductorBundle;
    const homeRunCallout = homeRunRun?.conductorCallout;
    const homeRunLines = homeRunBundle
      ? bundleToLines(homeRunBundle, resolvedAcConduitSize || branchConduit, resolvedAcConduitType, false)
      : homeRunCallout
        ? calloutToLines(homeRunCallout)
        : [`${resolvedAcWireGauge}`, `${resolvedAcConduitSize || '3/4"'} ${resolvedAcConduitType}`, `${resolvedAcOCPD}A OCPD`];
    parts.push(wireCalloutBox((combOutX + xInv - 55) / 2, busY, homeRunLines));

    parts.push(line(combBoxX, combBoxY + combBoxH, combBoxX, busY, { sw: SW_MED }));
    parts.push(line(combBoxX, busY, combOutX, busY, { sw: SW_MED }));

  } else {
    // ─── STRING/OPTIMIZER: DC wire from PV to DC Disco ──────────────────────
    const dcRun    = findRun('DC_STRING_RUN');
    const dcBundle = dcRun?.conductorBundle;
    const dcCallout = dcRun?.conductorCallout;
    const dcLines  = dcBundle
      ? bundleToLines(dcBundle, resolvedDcConduitSize || '3/4"', input.dcConduitType || 'EMT', true)
      : dcCallout
        ? calloutToLines(dcCallout)
        : [`${resolvedDcWireGauge}`, `PV WIRE (OPEN AIR)`, `NEC 690.31`];

    parts.push(line(pvOutX, pvCY, xDCDis - 44, pvCY, { sw: SW_MED }));
    parts.push(line(xDCDis - 44, pvCY, xDCDis - 44, busY, { sw: SW_MED }));
    parts.push(wireCalloutBox((pvOutX + xDCDis - 44) / 2, pvCY, dcLines, true));
  }

  // ─── DC DISCONNECT (string/optimizer only) ────────────────────────────────
  if (!isMicro) {
    const dcDisCX = xDCDis, dcDisCY = busY;
    parts.push(rect(dcDisCX - 44, dcDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
    parts.push(discoSym(dcDisCX, dcDisCY, 60, 20));
    parts.push(txt(dcDisCX, dcDisCY - 38, '(N) DC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
    parts.push(txt(dcDisCX, dcDisCY + 40, `${input.dcOCPD}A FUSED`, { size: F.tiny, anchor: 'middle' }));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcDisCX, dcDisCY + 51, 'RAPID SHUTDOWN — NEC 690.12', { size: F.tiny, anchor: 'middle', italic: true }));
    }
    parts.push(callout(dcDisCX + 52, dcDisCY - 34, 2));
  }

  // ─── INVERTER ─────────────────────────────────────────────────────────────
  const invCX = xInv, invCY = busY;
  const invW = 110, invH = 70;
  parts.push(rect(invCX - invW/2, invCY - invH/2, invW, invH, { fill: WHT, sw: SW_MED }));
  parts.push(txt(invCX - invW/2 + 8, invCY - 8, 'DC', { size: F.sub, bold: true }));
  parts.push(txt(invCX + invW/2 - 20, invCY - 8, 'AC', { size: F.sub, bold: true }));
  // DC→AC arrow symbol
  parts.push(line(invCX - 12, invCY + 6, invCX + 8, invCY + 6, { sw: SW_THIN }));
  parts.push(`<polygon points="${invCX+8},${invCY+3} ${invCX+14},${invCY+6} ${invCX+8},${invCY+9}" fill="${BLK}"/>`);
  parts.push(`<path d="M${invCX-8},${invCY-6} Q${invCX-4},${invCY-14} ${invCX},${invCY-6} Q${invCX+4},${invCY+2} ${invCX+8},${invCY-6}" fill="none" stroke="${BLK}" stroke-width="${SW_THIN}"/>`);
  parts.push(line(invCX, invCY - invH/2, invCX, invCY + invH/2, { sw: SW_HAIR, dash: '3,2' }));
  parts.push(line(invCX - invW/2 - 16, invCY, invCX - invW/2, invCY, { sw: SW_MED }));
  parts.push(line(invCX + invW/2, invCY, invCX + invW/2 + 16, invCY, { sw: SW_MED }));

  if (isMicro) {
    const microDevCount2 = input.deviceCount ?? input.totalModules;
    const numBranches2   = Math.ceil(microDevCount2 / 16);
    parts.push(txt(invCX, invCY - invH/2 - 22, 'MICROINVERTER', { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 11, `${input.inverterManufacturer} ${input.inverterModel}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 11, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 21, `${microDevCount2} units · ${numBranches2} branch circuit${numBranches2 > 1 ? 's' : ''}`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 31, 'NEC 690.8(B) — MAX 16/BRANCH', { size: F.tiny, anchor: 'middle', italic: true }));
  } else {
    const topoLabel = input.topologyType === 'STRING_WITH_OPTIMIZER' ? 'STRING INVERTER + OPTIMIZER' : 'STRING INVERTER';
    const mpptLabel = input.mpptAllocation ? `MPPT: ${input.mpptAllocation}` : input.mpptChannels ? `${input.mpptChannels} MPPT CH` : '';
    parts.push(txt(invCX, invCY - invH/2 - 22, topoLabel, { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 11, `${input.inverterManufacturer} ${input.inverterModel}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 11, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    if (mpptLabel) parts.push(txt(invCX, invCY + invH/2 + 21, mpptLabel, { size: F.tiny, anchor: 'middle' }));
    if (input.totalStrings > 1) {
      const ppStr = input.panelsPerString ?? Math.round(input.totalModules / input.totalStrings);
      parts.push(txt(invCX, invCY + invH/2 + 31, `${input.totalStrings} strings × ${ppStr} panels`, { size: F.tiny, anchor: 'middle', italic: true }));
    }
  }
  parts.push(callout(invCX + invW/2 + 18, invCY - invH/2 - 8, isMicro ? 3 : 3));

  // DC wire label between DC Disco and Inverter (string/optimizer only)
  if (!isMicro) {
    const dcDisToInvRun    = findRun('DC_DISCO_TO_INV_RUN') ?? findRun('DC_STRING_RUN');
    const dcDisToInvBundle = dcDisToInvRun?.conductorBundle;
    const dcDisToInvCallout = dcDisToInvRun?.conductorCallout;
    const dcMidX = (xDCDis + 44 + invCX - invW/2 - 16) / 2;
    const dcDisLines = dcDisToInvBundle
      ? bundleToLines(dcDisToInvBundle, resolvedDcConduitSize || '3/4"', input.dcConduitType || 'EMT', false)
      : dcDisToInvCallout
        ? calloutToLines(dcDisToInvCallout)
        : [`${resolvedDcWireGauge}`, `${input.dcConduitType || 'EMT'}`];
    parts.push(wireCalloutBox(dcMidX, busY, dcDisLines));
  }

  // ─── AC DISCONNECT ────────────────────────────────────────────────────────
  const acDisCX = xACDis, acDisCY = busY;
  parts.push(rect(acDisCX - 44, acDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
  parts.push(discoSym(acDisCX, acDisCY, 60, 20));
  parts.push(txt(acDisCX, acDisCY - 38, '(N) AC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(acDisCX, acDisCY + 40, `${resolvedAcOCPD}A NON-FUSED`, { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(acDisCX + 52, acDisCY - 34, 4));

  // AC wire label between Inverter/Combiner and AC Disco
  const invToDiscoRun    = findRun(isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN');
  const invToDiscoBundle = invToDiscoRun?.conductorBundle;
  const invToDiscoCallout = invToDiscoRun?.conductorCallout;
  const acMid1X = (invCX + invW/2 + 16 + acDisCX - 44) / 2;
  const invToDiscoLines = invToDiscoBundle
    ? bundleToLines(invToDiscoBundle, resolvedAcConduitSize || '3/4"', resolvedAcConduitType, false)
    : invToDiscoCallout
      ? calloutToLines(invToDiscoCallout)
      : [`${resolvedAcWireGauge}`, `${resolvedAcConduitSize || '3/4"'} ${resolvedAcConduitType}`, `${resolvedAcOCPD}A OCPD`];
  parts.push(wireCalloutBox(acMid1X, busY, invToDiscoLines));

  // ─── PRODUCTION METER ─────────────────────────────────────────────────────
  const meterCX = xMeter, meterCY = busY;
  const meterR  = 28;
  parts.push(circle(meterCX, meterCY, meterR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - 4, 'kWh', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY + 7, 'METER', { size: 6, anchor: 'middle' }));
  parts.push(line(meterCX - meterR - 16, meterCY, meterCX - meterR, meterCY, { sw: SW_MED }));
  parts.push(line(meterCX + meterR, meterCY, meterCX + meterR + 16, meterCY, { sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - meterR - 20, 'PRODUCTION METER', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY - meterR - 9, 'BI-DIRECTIONAL', { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(meterCX + meterR + 20, meterCY - meterR - 8, 5));

  // AC wire label between AC Disco and Meter
  const discoToMeterRun    = findRun('DISCO_TO_METER_RUN');
  const discoToMeterBundle = discoToMeterRun?.conductorBundle;
  const discoToMeterCallout = discoToMeterRun?.conductorCallout;
  const acMid2X = (acDisCX + 44 + meterCX - meterR - 16) / 2;
  const discoToMeterLines = discoToMeterBundle
    ? bundleToLines(discoToMeterBundle, resolvedAcConduitSize || '3/4"', resolvedAcConduitType, false)
    : discoToMeterCallout
      ? calloutToLines(discoToMeterCallout)
      : [`${resolvedAcWireGauge}`, `${resolvedAcConduitType}`];
  parts.push(wireCalloutBox(acMid2X, busY, discoToMeterLines));

  // ─── MAIN SERVICE PANEL ───────────────────────────────────────────────────
  const mspCX = xMSP, mspCY = busY;
  const mspW = 80, mspH = 110;
  parts.push(rect(mspCX - mspW/2, mspCY - mspH/2, mspW, mspH, { fill: WHT, sw: SW_MED }));
  parts.push(line(mspCX, mspCY - mspH/2 + 12, mspCX, mspCY + mspH/2 - 12, { sw: SW_MED }));
  for (let i = 0; i < 3; i++) {
    const sy = mspCY - mspH/2 + 20 + i * 26;
    parts.push(line(mspCX - mspW/2 + 8, sy, mspCX - 4, sy, { sw: SW_THIN }));
    parts.push(rect(mspCX - 8, sy - 5, 16, 10, { fill: WHT, sw: SW_HAIR }));
    parts.push(line(mspCX + 4, sy, mspCX + mspW/2 - 8, sy, { sw: SW_THIN }));
  }
  parts.push(line(mspCX - mspW/2 - 16, mspCY, mspCX - mspW/2, mspCY, { sw: SW_MED }));
  parts.push(line(mspCX + mspW/2, mspCY, mspCX + mspW/2 + 16, mspCY, { sw: SW_MED }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 22, 'MAIN SERVICE PANEL', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 11, `${input.mainPanelAmps}A RATED`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY + mspH/2 + 11, `${input.backfeedAmps}A PV BREAKER`, { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(mspCX + mspW/2 + 20, mspCY - mspH/2 - 8, 6));

  // AC wire label between Meter and MSP
  const meterToMspRun    = findRun('METER_TO_MSP_RUN');
  const meterToMspBundle = meterToMspRun?.conductorBundle;
  const meterToMspCallout = meterToMspRun?.conductorCallout;
  const acMid3X = (meterCX + meterR + 16 + mspCX - mspW/2 - 16) / 2;
  const meterToMspLines = meterToMspBundle
    ? bundleToLines(meterToMspBundle, resolvedAcConduitSize || '3/4"', resolvedAcConduitType, false)
    : meterToMspCallout
      ? calloutToLines(meterToMspCallout)
      : [`${resolvedAcWireGauge}`, `${resolvedAcConduitType}`];
  parts.push(wireCalloutBox(acMid3X, busY, meterToMspLines));

  // ─── UTILITY ──────────────────────────────────────────────────────────────
  const utilCX = xUtil, utilCY = busY;
  const utilR  = 30;
  parts.push(circle(utilCX, utilCY, utilR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - 4, 'UTILITY', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + 7, 'METER', { size: 6, anchor: 'middle' }));
  parts.push(line(utilCX - utilR - 16, utilCY, utilCX - utilR, utilCY, { sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - utilR - 22, 'UTILITY GRID', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY - utilR - 11, esc(input.utilityName), { size: F.sub, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + utilR + 11, '120/240V, 1Ø, 3W', { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(utilCX + utilR + 20, utilCY - utilR - 8, 7));

  // AC wire label between MSP and Utility
  const mspToUtilRun    = findRun('MSP_TO_UTILITY_RUN');
  const mspToUtilBundle = mspToUtilRun?.conductorBundle;
  const mspToUtilCallout = mspToUtilRun?.conductorCallout;
  const acMid4X = (mspCX + mspW/2 + 16 + utilCX - utilR - 16) / 2;
  const mspToUtilLines = mspToUtilBundle
    ? bundleToLines(mspToUtilBundle, resolvedAcConduitSize || '3/4"', resolvedAcConduitType, false)
    : mspToUtilCallout
      ? calloutToLines(mspToUtilCallout)
      : [`${resolvedAcWireGauge}`, `${resolvedAcConduitType}`];
  parts.push(wireCalloutBox(acMid4X, busY, mspToUtilLines));

  // ─── Horizontal bus line ──────────────────────────────────────────────────
  parts.push(line(pvCX + pvW/2 + 10, busY, utilCX - utilR, busY, { sw: SW_MED }));

  // ─── Grounding conductors (GREEN) ─────────────────────────────────────────
  const gndLineY = busY + 100;
  const gndPoints = isMicro
    ? [xInv, xACDis, xMeter, xMSP]
    : [xDCDis, xInv, xACDis, xMeter, xMSP];
  const gndStartX = gndPoints[0];
  const gndEndX   = gndPoints[gndPoints.length - 1];
  parts.push(line(gndStartX, gndLineY, gndEndX, gndLineY, { stroke: GRN, sw: SW_MED }));
  for (const gx of gndPoints) {
    parts.push(line(gx, busY + 30, gx, gndLineY, { stroke: GRN, sw: SW_MED }));
    parts.push(gndSym(gx, gndLineY));
  }
  parts.push(txt((gndStartX + gndEndX) / 2, gndLineY - 8,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122',
    { size: F.tiny, anchor: 'middle', fill: GRN }
  ));

  // ─── Rapid Shutdown note ──────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rsdY = SCH_Y + SCH_H - 28;
    parts.push(rect(SCH_X + 8, rsdY - 14, 280, 22, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(SCH_X + 16, rsdY, 'RAPID SHUTDOWN SYSTEM — NEC 690.12 COMPLIANT', { size: F.tiny, bold: true }));
  }

  // ─── LEGEND ───────────────────────────────────────────────────────────────
  const legX = SCH_X + SCH_W - 220;
  const legY = SCH_Y + SCH_H - 82;
  const legW = 210, legH = 74;
  parts.push(rect(legX, legY, legW, legH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(legX + 8, legY + 12, 'LEGEND', { size: F.sub, bold: true }));
  parts.push(line(legX, legY + 15, legX + legW, legY + 15, { sw: SW_THIN }));
  const legItems = [
    { dash: '',    stroke: BLK, label: 'AC Conductor (THWN-2)' },
    { dash: '6,3', stroke: BLK, label: 'DC Conductor (PV Wire / Open Air)' },
    { dash: '',    stroke: GRN, label: 'Grounding Conductor (EGC)' },
    { dash: '2,2', stroke: BLK, label: 'Communication / Signal Wire' },
  ];
  legItems.forEach((item, i) => {
    const ly = legY + 22 + i * 13;
    parts.push(line(legX + 8, ly, legX + 48, ly, { stroke: item.stroke, sw: SW_MED, dash: item.dash }));
    parts.push(txt(legX + 54, ly + 3, item.label, { size: F.tiny }));
  });

  // ─── CALC PANELS ──────────────────────────────────────────────────────────
  const calcY = SCH_Y + SCH_H + 8;
  const calcH = NOTES_Y - calcY - 4;
  const calcW = DW / 3 - 4;

  if (calcH > 30) {
    const totalDcKw = (input.totalModules * input.panelWatts / 1000);

    // DC / Micro AC Branch Calcs
    const dcCalcX = DX;
    parts.push(rect(dcCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(rect(dcCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: SW_THIN }));

    if (isMicro) {
      const microDevCount = input.deviceCount ?? input.totalModules;
      const acBranchCircuits = Math.ceil(microDevCount / 16);
      const acBranchAmps = Math.ceil((input.acOutputKw * 1000 / 240) * 1.25 / 5) * 5;
      parts.push(txt(dcCalcX + calcW/2, calcY + 11, 'AC BRANCH CIRCUIT INFO', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));
      const microRows: [string, string][] = [
        ['Topology',               'MICROINVERTER'],
        ['Microinverters',         `${microDevCount} units`],
        ['Panels per Micro',       `${input.panelsPerString ?? 1}`],
        ['Total DC Power',         `${totalDcKw.toFixed(2)} kW`],
        ['AC Output per Micro',    `${((input.acOutputKw * 1000) / microDevCount).toFixed(0)} W`],
        ['AC Branch Circuits',     `${acBranchCircuits}`],
        ['Max Micros / Branch',    '16 (NEC 690.8)'],
        ['AC Branch OCPD',         `${acBranchAmps} A`],
        ['AC Wire (branch)',       `${resolvedAcWireGauge}`],
        ['AC Conduit',             resolvedAcConduitType],
        ['Module Voc (STC)',       `${input.panelVoc} V`],
        ['Module Isc (STC)',       `${input.panelIsc} A`],
        ['DC/AC Ratio',            'N/A (micro)'],
      ];
      const microRowH = Math.min(14, (calcH - 20) / microRows.length);
      microRows.forEach(([label, val], i) => {
        const ry = calcY + 22 + i * microRowH;
        if (i % 2 === 1) parts.push(rect(dcCalcX, ry - microRowH + 2, calcW, microRowH, { fill: LGY, stroke: 'none', sw: 0 }));
        parts.push(txt(dcCalcX + 6, ry, label, { size: F.tiny }));
        parts.push(txt(dcCalcX + calcW - 6, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
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
        ['Module Voc (STC)',          `${input.panelVoc} V`],
        ['Module Isc (STC)',          `${input.panelIsc} A`],
        ['Design Temp (NEC 690.7)',   `${designTemp}°C`],
        ['Voc Corrected',             `${vocCorr.toFixed(2)} V`],
        ['Panels per String',         panelsPerStr === lastStrPanels ? `${panelsPerStr}` : `${panelsPerStr} (last: ${lastStrPanels})`],
        ['Number of Strings',         `${input.totalStrings}`],
        ['String Voc (corrected)',     `${stringVocVal.toFixed(1)} V`],
        ['String Voc × 1.25 (NEC)',   `${(stringVocVal * 1.25).toFixed(1)} V`],
        ['String Isc × 1.25 (NEC)',   `${(stringIscVal * 1.25).toFixed(2)} A`],
        ['DC OCPD / String',          `${ocpdStr} A`],
        ['DC Wire Gauge',             `${resolvedDcWireGauge}`],
        ['Total DC Power',            `${totalDcKw.toFixed(2)} kW`],
        ['DC/AC Ratio',               `${dcAcRatio.toFixed(2)}`],
      ];
      const dcRowH = Math.min(14, (calcH - 20) / dcRows.length);
      dcRows.forEach(([label, val], i) => {
        const ry = calcY + 22 + i * dcRowH;
        if (i % 2 === 1) parts.push(rect(dcCalcX, ry - dcRowH + 2, calcW, dcRowH, { fill: LGY, stroke: 'none', sw: 0 }));
        parts.push(txt(dcCalcX + 6, ry, label, { size: F.tiny }));
        parts.push(txt(dcCalcX + calcW - 6, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
      });
    }

    // AC Calcs
    const acCalcX = DX + calcW + 4;
    parts.push(rect(acCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(rect(acCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: SW_THIN }));
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
      const ry = acCalcX + 22 + i * acRowH - acCalcX + calcY + 22;
      const ryFixed = calcY + 22 + i * acRowH;
      if (i % 2 === 1) parts.push(rect(acCalcX, ryFixed - acRowH + 2, calcW, acRowH, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(acCalcX + 6, ryFixed, label, { size: F.tiny }));
      parts.push(txt(acCalcX + calcW - 6, ryFixed, val, { size: F.tiny, anchor: 'end', bold: true }));
    });

    // Equipment Schedule
    const eqCalcX = DX + (calcW + 4) * 2;
    parts.push(rect(eqCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(rect(eqCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(eqCalcX + calcW/2, calcY + 11, 'EQUIPMENT SCHEDULE', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));

    const microDevCountEq  = input.deviceCount ?? input.totalModules;
    const panelsPerStrEq   = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));

    const eqRows: [string, string][] = isMicro ? [
      ['PV Module',             esc(input.panelModel)],
      ['Module Wattage',        `${input.panelWatts} W`],
      ['Total Modules',         `${input.totalModules}`],
      ['Microinverters',        `${microDevCountEq} units`],
      ['Panels per Micro',      `${panelsPerStrEq}`],
      ['AC Branch Circuits',    `${Math.ceil(microDevCountEq / 16)}`],
      ['Inverter Mfr.',         esc(input.inverterManufacturer)],
      ['Inverter Model',        esc(input.inverterModel)],
      ['Inverter Output',       `${input.acOutputKw} kW AC`],
      ['Main Panel',            `${input.mainPanelAmps} A`],
      ['Utility',               esc(input.utilityName)],
      ['Interconnection',       esc(input.interconnection)],
      ['Rapid Shutdown',        input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
      ['Battery Storage',       input.hasBattery ? esc(input.batteryModel) : 'NONE'],
    ] : [
      ['PV Module',             esc(input.panelModel)],
      ['Module Wattage',        `${input.panelWatts} W`],
      ['Total Modules',         `${input.totalModules}`],
      ['Strings',               `${input.totalStrings} × ${panelsPerStrEq} panels`],
      ['MPPT Channels',         input.mpptAllocation ?? `${input.mpptChannels ?? 1} ch`],
      ['Combiner',              esc(input.combinerLabel ?? (input.combinerType ?? 'Direct'))],
      ['Inverter Mfr.',         esc(input.inverterManufacturer)],
      ['Inverter Model',        esc(input.inverterModel)],
      ['Inverter Output',       `${input.acOutputKw} kW AC`],
      ['Main Panel',            `${input.mainPanelAmps} A`],
      ['Utility',               esc(input.utilityName)],
      ['Interconnection',       esc(input.interconnection)],
      ['Rapid Shutdown',        input.rapidShutdownIntegrated ? 'INTEGRATED' : 'EXTERNAL'],
      ['Battery Storage',       input.hasBattery ? esc(input.batteryModel) : 'NONE'],
    ];
    const eqRowH = Math.min(14, (calcH - 20) / eqRows.length);
    eqRows.forEach(([label, val], i) => {
      const ry = calcY + 22 + i * eqRowH;
      if (i % 2 === 1) parts.push(rect(eqCalcX, ry - eqRowH + 2, calcW, eqRowH, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(eqCalcX + 6, ry, label, { size: F.tiny }));
      parts.push(txt(eqCalcX + calcW - 6, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
    });
  }

  // ─── NOTES SECTION ────────────────────────────────────────────────────────
  parts.push(rect(DX, NOTES_Y, DW, NOTES_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(DX + 8, NOTES_Y + 12, 'GENERAL NOTES & NEC CODE COMPLIANCE', { size: F.hdr, bold: true }));
  parts.push(line(DX, NOTES_Y + 16, DX + DW, NOTES_Y + 16, { sw: SW_THIN }));

  const panelsPerStrNote  = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
  const vocCorrNote       = input.vocCorrected ?? input.panelVoc;
  const microDevCountNote = input.deviceCount ?? input.totalModules;

  const notes = isMicro ? [
    'ALL WORK SHALL COMPLY WITH NEC 2020, NEC 690, NEC 705.',
    `PV MODULES: ${esc(input.panelModel)} — ${input.panelWatts}W, Voc=${input.panelVoc}V, Isc=${input.panelIsc}A`,
    `MICROINVERTERS: ${microDevCountNote} UNITS — DC→AC AT EACH MODULE`,
    `AC BRANCH CIRCUITS: ${Math.ceil(microDevCountNote / 16)} CIRCUITS (MAX 16 MICROS/BRANCH — NEC 690.8)`,
    `INVERTER: ${esc(input.inverterManufacturer)} ${esc(input.inverterModel)} — ${input.acOutputKw} kW`,
    `AC CONDUCTORS: ${resolvedAcWireGauge} THWN-2 — NEC 310`,
    `CONDUIT: ${resolvedAcConduitType} — NEC 358/352`,
    `AC OCPD: ${resolvedAcOCPD}A — NEC 705.12`,
    `BACKFEED BREAKER: ${input.backfeedAmps}A — NEC 705.12(B)(2)`,
    `MAIN PANEL: ${input.mainPanelAmps}A — BUSBAR LOADING ≤ 120%`,
    'GROUNDING: NEC 250.122, NEC 690.43',
    'BONDING: NEC 690.43, NEC 250.97',
    input.rapidShutdownIntegrated ? 'RAPID SHUTDOWN: NEC 690.12 INTEGRATED (MICRO)' : 'RAPID SHUTDOWN: NEC 690.12 — EXTERNAL DEVICE',
    `INTERCONNECTION: ${esc(input.interconnection)} — NEC 705`,
    `UTILITY: ${esc(input.utilityName)} — NOTIFY PRIOR TO ENERGIZING`,
    'INSTALLER SHALL VERIFY ALL DIMENSIONS IN FIELD',
  ] : [
    'ALL WORK SHALL COMPLY WITH NEC 2020, NEC 690, NEC 705.',
    `PV MODULES: ${esc(input.panelModel)} — ${input.panelWatts}W, Voc=${input.panelVoc}V, Isc=${input.panelIsc}A`,
    `STRING CONFIG: ${input.totalStrings} STRINGS × ${panelsPerStrNote} PANELS — NEC 690.7`,
    `VOC CORRECTED @ ${input.designTempMin ?? -10}°C: ${vocCorrNote.toFixed(2)}V/MODULE — NEC 690.7`,
    `INVERTER: ${esc(input.inverterManufacturer)} ${esc(input.inverterModel)} — ${input.acOutputKw} kW`,
    `DC CONDUCTORS: ${resolvedDcWireGauge} PV WIRE — NEC 690.31`,
    `AC CONDUCTORS: ${resolvedAcWireGauge} THWN-2 — NEC 310`,
    `CONDUIT: ${input.dcConduitType}/${resolvedAcConduitType} — NEC 358/352`,
    `DC OCPD/STRING: ${input.ocpdPerString ?? input.dcOCPD}A — NEC 690.9`,
    `AC OCPD: ${resolvedAcOCPD}A — NEC 705.12`,
    `BACKFEED BREAKER: ${input.backfeedAmps}A — NEC 705.12(B)(2)`,
    `MAIN PANEL: ${input.mainPanelAmps}A — BUSBAR LOADING ≤ 120%`,
    'GROUNDING: NEC 250.122, NEC 690.43',
    'BONDING: NEC 690.43, NEC 250.97',
    input.rapidShutdownIntegrated ? 'RAPID SHUTDOWN: NEC 690.12 INTEGRATED' : 'RAPID SHUTDOWN: NEC 690.12 — EXTERNAL DEVICE',
    `INTERCONNECTION: ${esc(input.interconnection)} — NEC 705`,
    `UTILITY: ${esc(input.utilityName)} — NOTIFY PRIOR TO ENERGIZING`,
    'INSTALLER SHALL VERIFY ALL DIMENSIONS IN FIELD',
    ...(input.stringConfigWarnings?.map(w => `⚠ ${w}`) ?? []),
  ];

  const colW        = DW / 3;
  const noteLineH   = 11;
  const notesPerCol = Math.ceil(notes.length / 3);
  notes.forEach((note, i) => {
    const col = Math.floor(i / notesPerCol);
    const row = i % notesPerCol;
    const nx  = DX + 8 + col * colW;
    const ny  = NOTES_Y + 24 + row * noteLineH;
    parts.push(txt(nx, ny, `${i + 1}. ${note}`, { size: F.note }));
  });
  parts.push(line(DX + colW,     NOTES_Y + 16, DX + colW,     NOTES_Y + NOTES_H, { sw: SW_THIN }));
  parts.push(line(DX + colW * 2, NOTES_Y + 16, DX + colW * 2, NOTES_Y + NOTES_H, { sw: SW_THIN }));

  // ─── CONDUIT SCHEDULE ─────────────────────────────────────────────────────
  parts.push(rect(DX, SCHED_Y, DW, SCHED_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(DX + 8, SCHED_Y + 12, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9', { size: F.hdr, bold: true }));
  parts.push(line(DX, SCHED_Y + 16, DX + DW, SCHED_Y + 16, { sw: SW_THIN }));

  const schedCols = [
    { label: 'RUN',        w: 0.05 },
    { label: 'FROM',       w: 0.10 },
    { label: 'TO',         w: 0.10 },
    { label: 'CONDUCTORS', w: 0.22 },
    { label: 'CONDUIT',    w: 0.09 },
    { label: 'FILL%',      w: 0.06 },
    { label: 'AMPACITY',   w: 0.07 },
    { label: 'OCPD',       w: 0.07 },
    { label: 'V-DROP%',    w: 0.07 },
    { label: 'LENGTH',     w: 0.07 },
    { label: 'PASS',       w: 0.06 },
  ];

  let colX = DX;
  const hdrY = SCHED_Y + 26;
  const rowH = 15;
  schedCols.forEach(col => {
    const cw = col.w * DW;
    parts.push(txt(colX + 4, hdrY, col.label, { size: F.tiny, bold: true }));
    parts.push(line(colX, SCHED_Y + 16, colX, SCHED_Y + SCHED_H, { sw: SW_HAIR }));
    colX += cw;
  });
  parts.push(line(DX, hdrY + 2, DX + DW, hdrY + 2, { sw: SW_THIN }));

  // Build schedule rows — Priority: ComputedSystem.runs > fallback defaults
  let schedRows: any[] = [];

  if (input.runs && input.runs.length > 0) {
    schedRows = input.runs.map(run => {
      // Use conductorBundle for display if available, else fall back to conductorCallout
      let conductorsDisplay = '';
      if (run.conductorBundle && run.conductorBundle.length > 0) {
        conductorsDisplay = run.conductorBundle
          .map((c: ConductorBundle) => `${c.qty}#${c.gauge.replace('#','').replace(' AWG','')} ${c.color}`)
          .join(' + ');
      } else if (run.conductorCallout) {
        // Replace \n with ' + ' for single-line table display
        conductorsDisplay = run.conductorCallout.replace(/\n/g, ' + ').replace(/IN \S+ \S+$/, '').trim();
      } else {
        conductorsDisplay = `${run.conductorCount}#${run.wireGauge.replace('#','').replace(' AWG','')} ${run.insulation}`;
      }
      return {
        raceway:     run.id,
        from:        run.from,
        to:          run.to,
        conductors:  conductorsDisplay,
        conduitType: run.isOpenAir ? 'OPEN AIR' : `${run.conduitType} ${run.conduitSize}`,
        fillPercent: run.conduitFillPct,
        ampacity:    run.continuousCurrent,
        ocpd:        run.ocpdAmps,
        voltageDrop: run.voltageDropPct,
        lengthFt:    run.onewayLengthFt,
        pass:        run.overallPass,
      };
    });
  } else {
    // Fallback defaults
    const microDevCnt = input.deviceCount ?? input.totalModules;
    schedRows = isMicro ? [
      { raceway: 'BR-1', from: 'MICROINVERTERS', to: 'AC COMBINER', conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.2, pass: true },
      { raceway: 'A-1',  from: 'AC COMBINER',   to: 'AC DISCO',    conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.4, pass: true },
      { raceway: 'A-2',  from: 'AC DISCO',       to: 'METER',       conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.4, pass: true },
      { raceway: 'A-3',  from: 'METER',          to: 'MSP',         conductors: `${resolvedAcWireGauge} THWN-2`, conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
    ] : [
      { raceway: 'D-1', from: 'PV ARRAY',  to: 'DC DISCO',  conductors: `${resolvedDcWireGauge} PV WIRE`,  conduitType: `${input.dcConduitType} OPEN AIR`, fillPercent: 0,  ampacity: 30,                  ocpd: input.dcOCPD,   voltageDrop: 1.2, pass: true },
      { raceway: 'D-2', from: 'DC DISCO',  to: 'INVERTER',  conductors: `${resolvedDcWireGauge} PV WIRE`,  conduitType: `${input.dcConduitType} 3/4"`,    fillPercent: 28, ampacity: 30,                  ocpd: input.dcOCPD,   voltageDrop: 1.2, pass: true },
      { raceway: 'A-1', from: 'INVERTER',  to: 'AC DISCO',  conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
      { raceway: 'A-2', from: 'AC DISCO',  to: 'METER',     conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
      { raceway: 'A-3', from: 'METER',     to: 'MSP',       conductors: `${resolvedAcWireGauge} THWN-2`,   conduitType: `${resolvedAcConduitType} ${resolvedAcConduitSize || '3/4"'}`, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
    ];
  }

  schedRows.slice(0, 10).forEach((row: any, ri) => {
    const ry = hdrY + 4 + (ri + 1) * rowH;
    if (ri % 2 === 1) parts.push(rect(DX, ry - rowH + 2, DW, rowH, { fill: LGY, stroke: 'none', sw: 0 }));
    let cx2 = DX;
    const passVal = row.pass != null ? (row.pass ? '✓' : '✗') : '';
    const passColor = row.pass ? '#006600' : '#CC0000';
    const vals = [
      row.raceway ?? '',
      row.from ?? '',
      row.to ?? '',
      row.conductors ?? '',
      row.conduitType ?? '',
      row.fillPercent != null ? `${Number(row.fillPercent).toFixed(1)}%` : '',
      row.ampacity != null ? `${row.ampacity}A` : '',
      row.ocpd != null ? `${row.ocpd}A` : '',
      row.voltageDrop != null ? `${Number(row.voltageDrop).toFixed(2)}%` : '',
      (row as any).lengthFt != null ? `${(row as any).lengthFt} FT` : '',
      passVal,
    ];
    schedCols.forEach((col, ci) => {
      const cw = col.w * DW;
      const fillColor = ci === 10 ? passColor : BLK;
      parts.push(txt(cx2 + 4, ry, String(vals[ci] ?? ''), { size: F.tiny, fill: fillColor, bold: ci === 10 }));
      cx2 += cw;
    });
  });

  // ─── TITLE BLOCK (right side) ─────────────────────────────────────────────
  const tbX = TB_X;
  const tbY = DY;
  const tbH = DH;

  parts.push(rect(tbX, tbY, TB_W, tbH, { fill: WHT, stroke: BLK, sw: SW_HEAVY }));

  // Company header — black bar
  parts.push(rect(tbX, tbY, TB_W, 44, { fill: BLK, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, tbY + 18, 'SOLARPRO', { size: 16, bold: true, anchor: 'middle', fill: WHT }));
  parts.push(txt(tbX + TB_W/2, tbY + 32, 'ENGINEERING', { size: F.tb, anchor: 'middle', fill: '#AAAAAA' }));

  // Drawing title section
  parts.push(rect(tbX, tbY + 44, TB_W, 36, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, tbY + 60, 'SINGLE LINE DIAGRAM', { size: F.tbTitle, bold: true, anchor: 'middle' }));
  parts.push(txt(tbX + TB_W/2, tbY + 74, 'PHOTOVOLTAIC SYSTEM', { size: F.tb, anchor: 'middle' }));

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
  let tbRowY = tbY + 80;
  const tbRowH = 22;
  tbInfoRows.forEach(([label, val]) => {
    parts.push(rect(tbX, tbRowY, TB_W, tbRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 6, tbRowY + 14, label, { size: F.tiny, bold: true, fill: '#555555' }));
    parts.push(txt(tbX + 72, tbRowY + 14, esc(String(val ?? '')), { size: F.tb }));
    tbRowY += tbRowH;
  });

  // System Summary
  const sysY = tbRowY + 4;
  parts.push(rect(tbX, sysY, TB_W, 14, { fill: BLK, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, sysY + 10, 'SYSTEM SUMMARY', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));

  const sysRows: [string, string][] = [
    ['TOPOLOGY',   input.topologyType.replace(/_/g, ' ')],
    ['DC SIZE',    `${(input.totalModules * input.panelWatts / 1000).toFixed(2)} kW`],
    ['AC OUTPUT',  `${input.acOutputKw} kW`],
    ['MODULES',    `${input.totalModules} × ${input.panelWatts}W`],
    ['INVERTER',   `${input.inverterManufacturer}`],
    ['MODEL',      `${input.inverterModel}`],
    ['SERVICE',    `${input.mainPanelAmps}A`],
    ['UTILITY',    input.utilityName],
    ['INTERCONN.', input.interconnection],
  ];
  let sysRowY = sysY + 14;
  const sysRowH = 18;
  sysRows.forEach(([label, val]) => {
    parts.push(rect(tbX, sysRowY, TB_W, sysRowH, { fill: WHT, stroke: BLK, sw: SW_HAIR }));
    parts.push(txt(tbX + 6, sysRowY + 12, label, { size: F.tiny, bold: true, fill: '#555555' }));
    parts.push(txt(tbX + 80, sysRowY + 12, esc(String(val ?? '')), { size: F.tb }));
    sysRowY += sysRowH;
  });

  // Code References
  const codeY = sysRowY + 4;
  parts.push(rect(tbX, codeY, TB_W, 14, { fill: BLK, stroke: BLK, sw: SW_THIN }));
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
    parts.push(txt(tbX + 6, codeRowY + 10, code, { size: F.tiny }));
    codeRowY += 13;
  });

  // Revisions
  const revY = codeRowY + 4;
  const revH = Math.min(100, tbY + tbH - revY - 60);
  if (revH > 30) {
    parts.push(rect(tbX, revY, TB_W, 14, { fill: BLK, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(tbX + TB_W/2, revY + 10, 'REVISIONS', { size: F.sub, bold: true, anchor: 'middle', fill: WHT }));
    parts.push(rect(tbX, revY + 14, TB_W, revH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    const revColW = TB_W / 3;
    parts.push(txt(tbX + 6, revY + 24, 'REV', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + revColW + 4, revY + 24, 'DESCRIPTION', { size: F.tiny, bold: true }));
    parts.push(txt(tbX + revColW * 2 + 4, revY + 24, 'DATE', { size: F.tiny, bold: true }));
    parts.push(line(tbX, revY + 26, tbX + TB_W, revY + 26, { sw: SW_HAIR }));
    parts.push(line(tbX + revColW, revY + 14, tbX + revColW, revY + revH, { sw: SW_HAIR }));
    parts.push(line(tbX + revColW * 2, revY + 14, tbX + revColW * 2, revY + revH, { sw: SW_HAIR }));
    parts.push(txt(tbX + 6, revY + 38, input.revision, { size: F.tiny }));
    parts.push(txt(tbX + revColW + 4, revY + 38, 'INITIAL ISSUE', { size: F.tiny }));
    parts.push(txt(tbX + revColW * 2 + 4, revY + 38, input.drawingDate, { size: F.tiny }));
  }

  // Seal area
  const sealY = tbY + tbH - 55;
  parts.push(rect(tbX, sealY, TB_W, 55, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(circle(tbX + TB_W/2, sealY + 28, 22, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(tbX + TB_W/2, sealY + 24, 'ENGINEER', { size: F.tiny, anchor: 'middle', fill: '#888888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 35, 'SEAL', { size: F.tiny, anchor: 'middle', fill: '#888888' }));
  parts.push(txt(tbX + TB_W/2, sealY + 50, `${esc(input.designer)} — ${esc(input.drawingDate)}`, { size: F.tiny, anchor: 'middle', fill: '#555555' }));

  parts.push('</svg>');
  return parts.join('\n');
}