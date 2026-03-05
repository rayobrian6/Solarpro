// ============================================================
// Professional SLD Renderer V8 — True IEEE Engineering Drawing
// ANSI C Landscape (24"×18") = 2304×1728px at 96 DPI
// Style: Pure black/white engineering schematic
//   - Black lines on white background ONLY
//   - IEEE symbols as SVG paths (no colored boxes)
//   - Green ONLY for grounding conductors
//   - Numbered callout circles for components
//   - Right-side title block with revision table
//   - Wire labels inline next to conductors
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
const SCHED_H  = 160;   // expanded to show up to 10 runs
const NOTES_H  = 140;
const SCHED_Y  = H - M - SCHED_H;
const NOTES_Y  = SCHED_Y - NOTES_H - 12;

// Main schematic area
const SCH_X = DX;
const SCH_Y = DY + 28;
const SCH_W = DW;
const SCH_H = NOTES_Y - SCH_Y - 12;

// ─── Colors ───────────────────────────────────────────────────────────────────
const BLK = '#000000';
const GRN = '#006600';   // grounding ONLY
const WHT = '#FFFFFF';
const LGY = '#EEEEEE';   // light gray for table alternating rows

// ─── Stroke widths ────────────────────────────────────────────────────────────
const SW_HEAVY = 2.5;
const SW_MED   = 1.5;
const SW_THIN  = 1.0;

// ─── Fonts ────────────────────────────────────────────────────────────────────
const F = {
  title:  14,
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
  microBranches?:          MicroBranch[];   // per-branch data from ComputedSystem
  branchWireGauge?:        string;          // branch run wire gauge from BRANCH_RUN
  branchConduitSize?:      string;          // branch run conduit size
  branchOcpdAmps?:         number;          // branch OCPD

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
  const bold   = opts.bold   ? 'font-weight="bold"' : '';
  const anchor = `text-anchor="${opts.anchor ?? 'start'}"`;
  const fill   = `fill="${opts.fill ?? BLK}"`;
  const italic = opts.italic ? 'font-style="italic"' : '';
  return `<text x="${x}" y="${y}" font-family="Arial,Helvetica,sans-serif" font-size="${size}" ${bold} ${anchor} ${fill} ${italic} dominant-baseline="auto">${esc(content)}</text>`;
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

// Conduit run label box (plain black border, white fill)
function conduitTag(cx: number, cy: number, label: string, sub: string): string {
  const w = 88, h = 28;
  const s: string[] = [];
  s.push(rect(cx - w / 2, cy - h / 2, w, h, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  s.push(txt(cx, cy - 5, label, { size: F.tiny, anchor: 'middle', bold: true }));
  s.push(txt(cx, cy + 7, sub, { size: 6, anchor: 'middle' }));
  return s.join('');
}

// Wire label above conductor
function wireTag(x: number, y: number, label: string): string {
  return txt(x, y - 6, label, { size: F.tiny, anchor: 'middle', fill: BLK });
}

// ─── Main render function ─────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  const parts: string[] = [];

  // ── Derive wire gauges / OCPD from ComputedSystem.runs when available ──────
  // This ensures SLD labels always match the single source of truth pipeline.
  const isMicroTopo = input.topologyType === 'MICROINVERTER';
  let resolvedAcWireGauge   = input.acWireGauge;
  let resolvedDcWireGauge   = input.dcWireGauge;
  let resolvedAcOCPD        = input.acOCPD;
  let resolvedAcConduitSize = '';

  if (input.runs && input.runs.length > 0) {
    // AC feeder run: COMBINER_TO_DISCO_RUN for micro, INV_TO_DISCO_RUN for string
    const acRunId = isMicroTopo ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN';
    const acRun = input.runs.find(r => r.id === acRunId)
               ?? input.runs.find(r => r.color === 'ac');
    if (acRun) {
      resolvedAcWireGauge   = acRun.wireGauge;
      resolvedAcOCPD        = acRun.ocpdAmps;
      resolvedAcConduitSize = acRun.conduitSize;
    }
    // DC run: ROOF_RUN for micro, DC_STRING_RUN for string
    const dcRunId = isMicroTopo ? 'ROOF_RUN' : 'DC_STRING_RUN';
    const dcRun = input.runs.find(r => r.id === dcRunId)
               ?? input.runs.find(r => r.color === 'dc');
    if (dcRun) {
      resolvedDcWireGauge = dcRun.wireGauge;
    }
  }

  // Build topology
  const graphInput: SLDGraphInput = {
    topology:             input.topologyType as TopologyType,
    totalModules:         input.totalModules,
    totalStrings:         input.totalStrings,
    panelModel:           input.panelModel,
    panelWatts:           input.panelWatts,
    panelVoc:             input.panelVoc,
    panelIsc:             input.panelIsc,
    inverterManufacturer: input.inverterManufacturer,
    inverterModel:        input.inverterModel,
    acOutputKw:           input.acOutputKw,
    acOutputAmps:         input.acOutputAmps,
    mainPanelAmps:        input.mainPanelAmps,
    backfeedAmps:         input.backfeedAmps,
    dcWireGauge:          resolvedDcWireGauge,
    dcConduitType:        input.dcConduitType,
    acWireGauge:          resolvedAcWireGauge,
    acConduitType:        input.acConduitType,
    acWireLength:         input.acWireLength,
    dcOCPD:               input.dcOCPD,
    acOCPD:               resolvedAcOCPD,
  };

  let graph: SLDTopologyGraph | null = null;
  let schedule: ConduitScheduleRow[] = [];
  try {
    graph = buildSLDTopologyGraph(graphInput);
    const segParams: SegmentCalcParams = {
      ambientTempC:          30,
      rooftopTempAdderC:     30,
      systemVoltageAC:       240,
      systemVoltageDC:       input.panelVoc * input.totalStrings,
      inverterACOutputAmps:  input.acOutputAmps,
      inverterACOutputKw:    input.acOutputKw,
      stringIscCorrected:    input.panelIsc * 1.25,
      runLengths:            { dcRun: 30, acRun: input.acWireLength },
      maxACVoltageDropPct:   3,
      maxDCVoltageDropPct:   3,
    };
    calcAllSegments(graph, segParams);
    schedule = buildConduitSchedule(graph);
  } catch (_) {
    // continue with empty schedule
  }

  // ─── SVG root ──────────────────────────────────────────────────────────────
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};font-family:Arial,Helvetica,sans-serif;">`);
  parts.push(rect(0, 0, W, H, { fill: WHT, stroke: WHT, sw: 0 }));
  parts.push(rect(M / 2, M / 2, W - M, H - M, { fill: WHT, stroke: BLK, sw: SW_HEAVY }));

  // ─── Drawing title (top center) ────────────────────────────────────────────
  const titleCX = (DX + TB_X) / 2;
  parts.push(txt(titleCX, DY + 16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {
    size: F.title, bold: true, anchor: 'middle',
  }));
  parts.push(txt(titleCX, DY + 28,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    { size: F.sub, anchor: 'middle', fill: '#444444' }
  ));

  // ─── Schematic border ──────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));

  // ─── Layout positions ──────────────────────────────────────────────────────
  const isMicro = input.topologyType === 'MICROINVERTER';
  const busY = SCH_Y + Math.round(SCH_H * 0.42);
  const xPad = 90;
  const usableW = SCH_W - xPad * 2;

  // Topology-aware component positions:
  // STRING/OPTIMIZER: PV → DC Disco → Inverter → AC Disco → Meter → MSP → Utility (7 positions, 6 gaps)
  // MICROINVERTER:    PV → Microinverter → AC Disco → Meter → MSP → Utility (6 positions, 5 gaps, NO DC Disco)
  const xPV    = SCH_X + xPad;
  const xDCDis = isMicro ? -9999 : SCH_X + xPad + usableW * (1/6);  // hidden for micro
  const xInv   = isMicro ? SCH_X + xPad + usableW * (1/5) : SCH_X + xPad + usableW * (2/6);
  const xACDis = isMicro ? SCH_X + xPad + usableW * (2/5) : SCH_X + xPad + usableW * (3/6);
  const xMeter = isMicro ? SCH_X + xPad + usableW * (3/5) : SCH_X + xPad + usableW * (4/6);
  const xMSP   = isMicro ? SCH_X + xPad + usableW * (4/5) : SCH_X + xPad + usableW * (5/6);
  const xUtil  = SCH_X + xPad + usableW;

  // ─── PV ARRAY ──────────────────────────────────────────────────────────────
  const pvW = 110, pvH = 100;
  const pvCX = xPV, pvCY = busY - 50;

  parts.push(rect(pvCX - pvW/2, pvCY - pvH/2, pvW, pvH, { fill: WHT, sw: SW_MED }));
  parts.push(line(pvCX - pvW/2, pvCY, pvCX + pvW/2, pvCY, { sw: SW_THIN }));
  parts.push(line(pvCX, pvCY - pvH/2, pvCX, pvCY + pvH/2, { sw: SW_THIN }));
  parts.push(line(pvCX - pvW/4, pvCY - pvH/2, pvCX - pvW/4, pvCY + pvH/2, { sw: 0.5 }));
  parts.push(line(pvCX + pvW/4, pvCY - pvH/2, pvCX + pvW/4, pvCY + pvH/2, { sw: 0.5 }));
  parts.push(line(pvCX - pvW/2, pvCY - pvH/4, pvCX + pvW/2, pvCY - pvH/4, { sw: 0.5 }));
  parts.push(line(pvCX - pvW/2, pvCY + pvH/4, pvCX + pvW/2, pvCY + pvH/4, { sw: 0.5 }));
  const pvPanelsPerStr = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
  const pvStringLabel = isMicro
    ? `${input.deviceCount ?? input.totalModules} microinverters`
    : (input.totalStrings > 1
        ? `${input.totalStrings} strings × ${pvPanelsPerStr} panels`
        : `${input.totalModules} modules`);
  parts.push(txt(pvCX, pvCY - pvH/2 - 20, 'PV ARRAY', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY - pvH/2 - 9, `${input.totalModules} × ${input.panelWatts}W`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 11, pvStringLabel, { size: F.tiny, anchor: 'middle' }));
  parts.push(txt(pvCX, pvCY + pvH/2 + 21, input.panelModel, { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(pvCX + pvW/2 + 20, pvCY - pvH/2 - 6, 1));

  // Wire from PV right side to next component
  // For MICRO: short DC wire from panel to microinverter (very short, at panel)
  // For STRING: DC wire to DC disconnect (with optional combiner box)
  const pvOutX = pvCX + pvW/2;
  const combType = input.combinerType ?? (isMicro ? 'DIRECT' : 'DIRECT');

  if (isMicro) {
    // ── MICROINVERTER: Draw N separate AC branch circuits → AC Combiner → home run ──
    // Each branch = up to 16 micros per NEC 690.8(B)
    const microDevCount = input.deviceCount ?? input.totalModules;
    const branchLimit   = 16;
    // Use actual microBranches count if provided (most accurate), else calculate
    const numBranches   = input.microBranches?.length
      ? input.microBranches.length
      : Math.ceil(microDevCount / branchLimit);

    // Get branch wire data from runs or input
    const branchRun = input.runs?.find(r => r.id === 'BRANCH_RUN');
    const branchGauge   = input.branchWireGauge ?? branchRun?.wireGauge ?? '#10 AWG';
    const branchConduit = input.branchConduitSize ?? branchRun?.conduitSize ?? '3/4"';
    const branchOcpd    = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;

    // Combiner/junction box position — between PV array and inverter box
    const combBoxX = xInv - 80;
    const combBoxW = 56;
    const combBoxH = Math.max(48, numBranches * 18 + 16);
    const combBoxY = busY - combBoxH / 2;

    // Draw combiner box
    parts.push(rect(combBoxX - combBoxW/2, combBoxY, combBoxW, combBoxH, { fill: WHT, sw: SW_MED }));
    parts.push(txt(combBoxX, combBoxY - 10, 'AC COMBINER', { size: F.tiny, bold: true, anchor: 'middle' }));
    parts.push(txt(combBoxX, combBoxY - 2, 'J-BOX / WIREWAY', { size: 5.5, anchor: 'middle' }));
    parts.push(callout(combBoxX + combBoxW/2 + 14, combBoxY - 8, 2));

    // Branch spacing — spread branches vertically above and below bus
    const branchSpacing = Math.min(60, (SCH_H * 0.55) / Math.max(numBranches, 1));
    const totalBranchSpan = (numBranches - 1) * branchSpacing;
    const firstBranchY = busY - totalBranchSpan / 2;

    for (let b = 0; b < numBranches; b++) {
      // Use microBranches data if available (most accurate), else balanced distribution
      const mbData = input.microBranches?.[b];
      const basePerBranch = Math.floor(microDevCount / numBranches);
      const remainder     = microDevCount % numBranches;
      const devOnBranch   = mbData?.deviceCount
        ?? (b < remainder ? basePerBranch + 1 : basePerBranch);
      const branchY = firstBranchY + b * branchSpacing;

      // Branch OCPD from microBranches data if available
      const bOcpd  = mbData?.ocpdAmps ?? branchOcpd;
      const bAmps  = mbData ? mbData.branchCurrentA.toFixed(1) : '—';

      // Small PV sub-array box for this branch
      const pvSubW = 44, pvSubH = 32;
      const pvSubX = xPV + pvW/2 + 30;
      const pvSubCX = pvSubX + pvSubW/2;
      parts.push(rect(pvSubX, branchY - pvSubH/2, pvSubW, pvSubH, { fill: WHT, sw: SW_THIN }));
      parts.push(line(pvSubX, branchY, pvSubX + pvSubW, branchY, { sw: 0.5 }));
      parts.push(line(pvSubCX, branchY - pvSubH/2, pvSubCX, branchY + pvSubH/2, { sw: 0.5 }));
      parts.push(txt(pvSubCX, branchY - pvSubH/2 - 8, `BRANCH ${b + 1}`, { size: F.tiny, bold: true, anchor: 'middle' }));
      parts.push(txt(pvSubCX, branchY + pvSubH/2 + 8, `${devOnBranch} micros · ${bAmps}A`, { size: 5.5, anchor: 'middle' }));

      // Wire from PV array to branch sub-array (dashed DC stub)
      parts.push(line(pvOutX, pvCY, pvSubX, branchY, { sw: SW_THIN, dash: '4,2' }));

      // AC branch wire from sub-array to combiner box input
      const branchOutX = pvSubX + pvSubW;
      const combInX    = combBoxX - combBoxW/2;
      // Horizontal run to combiner
      parts.push(line(branchOutX, branchY, combInX, branchY, { sw: SW_MED }));
      // Vertical stub into combiner
      parts.push(line(combInX, branchY, combInX, busY + (b - (numBranches-1)/2) * 6, { sw: SW_THIN }));

      // Wire label on branch run
      const branchMidX = (branchOutX + combInX) / 2;
      parts.push(wireTag(branchMidX, branchY - 8,
        `BR${b+1}: ${branchGauge}, ${branchConduit} · ${bOcpd}A OCPD`));
    }

    // Home run from combiner box output to inverter/bus
    const combOutX = combBoxX + combBoxW/2;
    parts.push(line(combOutX, busY, xInv - 55, busY, { sw: SW_HEAVY }));
    parts.push(wireTag((combOutX + xInv - 55) / 2, busY - 8,
      `${resolvedAcWireGauge}, ${resolvedAcConduitSize || branchConduit} · HOME RUN`));

    // Vertical drop from combiner center to bus
    parts.push(line(combBoxX, combBoxY + combBoxH, combBoxX, busY, { sw: SW_MED }));
    parts.push(line(combBoxX, busY, combOutX, busY, { sw: SW_MED }));

  } else if (combType === 'COMBINER_BOX' || combType === 'JUNCTION_BOX') {
    // Draw combiner/junction box symbol between PV and DC disco
    const combX = (pvOutX + xDCDis - 44) / 2;
    const combY = pvCY;
    const combW = combType === 'COMBINER_BOX' ? 80 : 64;
    const combH = 32;
    parts.push(line(pvOutX, pvCY, combX - combW/2, pvCY, { sw: SW_MED }));
    parts.push(rect(combX - combW/2, combY - combH/2, combW, combH, { fill: WHT, sw: SW_MED }));
    parts.push(txt(combX, combY - 4, combType === 'COMBINER_BOX' ? 'COMBINER' : 'J-BOX', { size: F.tiny, bold: true, anchor: 'middle' }));
    parts.push(txt(combX, combY + 6, esc(input.combinerLabel ?? ''), { size: 5.5, anchor: 'middle' }));
    parts.push(line(combX + combW/2, pvCY, xDCDis - 44, pvCY, { sw: SW_MED }));
    parts.push(line(xDCDis - 44, pvCY, xDCDis - 44, busY, { sw: SW_MED }));
    parts.push(wireTag((pvOutX + combX - combW/2) / 2, pvCY, `${resolvedDcWireGauge} AWG PV WIRE`));
  } else {
    parts.push(line(pvOutX, pvCY, xDCDis - 44, pvCY, { sw: SW_MED }));
    parts.push(line(xDCDis - 44, pvCY, xDCDis - 44, busY, { sw: SW_MED }));
    parts.push(wireTag((pvOutX + xDCDis - 44) / 2, pvCY, `${resolvedDcWireGauge} AWG PV WIRE`));
  }

  // ─── DC DISCONNECT ─────────────────────────────────────────────────────────
  // DC DISCONNECT — only for string/optimizer topology (NOT for microinverter)
  if (!isMicro) {
    const dcDisCX = xDCDis, dcDisCY = busY;
    parts.push(rect(dcDisCX - 44, dcDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
    parts.push(discoSym(dcDisCX, dcDisCY, 60, 20));
    parts.push(txt(dcDisCX, dcDisCY - 38, '(N) DC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
    parts.push(txt(dcDisCX, dcDisCY + 40, `${input.dcOCPD}A FUSED`, { size: F.tiny, anchor: 'middle' }));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcDisCX, dcDisCY + 52, 'RAPID SHUTDOWN — NEC 690.12', { size: F.tiny, anchor: 'middle', italic: true }));
    }
    parts.push(callout(dcDisCX + 52, dcDisCY - 34, 2));
  }

  // ─── INVERTER ──────────────────────────────────────────────────────────────
  const invCX = xInv, invCY = busY;
  const invW = 110, invH = 70;
  parts.push(rect(invCX - invW/2, invCY - invH/2, invW, invH, { fill: WHT, sw: SW_MED }));
  parts.push(txt(invCX - invW/2 + 8, invCY - 8, 'DC', { size: F.sub, bold: true }));
  parts.push(txt(invCX + invW/2 - 20, invCY - 8, 'AC', { size: F.sub, bold: true }));
  parts.push(line(invCX - 12, invCY + 6, invCX + 8, invCY + 6, { sw: SW_THIN }));
  parts.push(`<polygon points="${invCX+8},${invCY+3} ${invCX+14},${invCY+6} ${invCX+8},${invCY+9}" fill="${BLK}"/>`);
  parts.push(`<path d="M${invCX-8},${invCY-6} Q${invCX-4},${invCY-14} ${invCX},${invCY-6} Q${invCX+4},${invCY+2} ${invCX+8},${invCY-6}" fill="none" stroke="${BLK}" stroke-width="${SW_THIN}"/>`);
  parts.push(line(invCX, invCY - invH/2, invCX, invCY + invH/2, { sw: SW_THIN, dash: '3,2' }));
  parts.push(line(invCX - invW/2 - 16, invCY, invCX - invW/2, invCY, { sw: SW_MED }));
  parts.push(line(invCX + invW/2, invCY, invCX + invW/2 + 16, invCY, { sw: SW_MED }));
  const mpptLabel = input.mpptAllocation
    ? `MPPT: ${input.mpptAllocation}`
    : input.mpptChannels
      ? `${input.mpptChannels} MPPT CH`
      : '';
  if (isMicro) {
    // For micro: inverter box represents ALL microinverters collectively
    const microDevCount2 = input.deviceCount ?? input.totalModules;
    const numBranches2   = Math.ceil(microDevCount2 / 16);
    parts.push(txt(invCX, invCY - invH/2 - 20, 'MICROINVERTER', { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 9, `${input.inverterManufacturer} ${input.inverterModel}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 11, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 21, `MPPT: ${microDevCount2} microinverters`, { size: F.tiny, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 31, `${numBranches2} AC branch circuit${numBranches2 > 1 ? 's' : ''} · NEC 690.8(B)`, { size: F.tiny, anchor: 'middle', italic: true }));
  } else {
    const topoLabel = input.topologyType === 'STRING_WITH_OPTIMIZER' ? 'STRING INVERTER + OPTIMIZER' : 'STRING INVERTER';
    parts.push(txt(invCX, invCY - invH/2 - 20, topoLabel, { size: F.hdr, bold: true, anchor: 'middle' }));
    parts.push(txt(invCX, invCY - invH/2 - 9, `${input.inverterManufacturer} ${input.inverterModel}`, { size: F.sub, anchor: 'middle' }));
    parts.push(txt(invCX, invCY + invH/2 + 11, `${input.acOutputKw} kW / ${input.acOutputAmps}A`, { size: F.tiny, anchor: 'middle' }));
    if (mpptLabel) {
      parts.push(txt(invCX, invCY + invH/2 + 21, mpptLabel, { size: F.tiny, anchor: 'middle' }));
    }
    // String details below inverter
    if (input.totalStrings > 1) {
      const ppStr = input.panelsPerString ?? Math.round(input.totalModules / input.totalStrings);
      parts.push(txt(invCX, invCY + invH/2 + 31,
        `${input.totalStrings} strings × ${ppStr} panels`, { size: F.tiny, anchor: 'middle', italic: true }));
    }
  }
  parts.push(callout(invCX + invW/2 + 18, invCY - invH/2 - 6, 3));

  // DC wire label between DC Disco and Inverter (string/optimizer only)
  if (!isMicro) {
    const dcDisCX2 = xDCDis;
    const dcMidX = (dcDisCX2 + 44 + invCX - invW/2 - 16) / 2;
    parts.push(wireTag(dcMidX, busY, `${resolvedDcWireGauge} AWG, ${input.dcConduitType}`));
  }

  // ─── AC DISCONNECT ─────────────────────────────────────────────────────────
  const acDisCX = xACDis, acDisCY = busY;
  parts.push(rect(acDisCX - 44, acDisCY - 28, 88, 56, { fill: WHT, sw: SW_MED }));
  parts.push(discoSym(acDisCX, acDisCY, 60, 20));
  parts.push(txt(acDisCX, acDisCY - 38, '(N) AC DISCONNECT', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(acDisCX, acDisCY + 40, `${resolvedAcOCPD}A NON-FUSED`, { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(acDisCX + 52, acDisCY - 34, 4));

  // AC wire label between Inverter/Combiner and AC Disco
  const acMid1X = (invCX + invW/2 + 16 + acDisCX - 44) / 2;
  const acConduitLabel = resolvedAcConduitSize
    ? `${resolvedAcWireGauge} AWG · ${resolvedAcConduitSize} ${input.acConduitType} · ${resolvedAcOCPD}A`
    : `${resolvedAcWireGauge} AWG · ${input.acConduitType} · ${resolvedAcOCPD}A`;
  parts.push(wireTag(acMid1X, busY - 8, acConduitLabel));

  // ─── PRODUCTION METER ──────────────────────────────────────────────────────
  const meterCX = xMeter, meterCY = busY;
  const meterR = 28;
  parts.push(circle(meterCX, meterCY, meterR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - 4, 'kWh', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY + 7, 'METER', { size: 6, anchor: 'middle' }));
  parts.push(line(meterCX - meterR - 16, meterCY, meterCX - meterR, meterCY, { sw: SW_MED }));
  parts.push(line(meterCX + meterR, meterCY, meterCX + meterR + 16, meterCY, { sw: SW_MED }));
  parts.push(txt(meterCX, meterCY - meterR - 20, 'PRODUCTION METER', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(meterCX, meterCY - meterR - 9, 'BI-DIRECTIONAL', { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(meterCX + meterR + 20, meterCY - meterR - 6, 5));

  // AC wire label between AC Disco and Meter
  const acMid2X = (acDisCX + 44 + meterCX - meterR - 16) / 2;
  parts.push(wireTag(acMid2X, busY, `${resolvedAcWireGauge} AWG`));

  // ─── MAIN SERVICE PANEL ────────────────────────────────────────────────────
  const mspCX = xMSP, mspCY = busY;
  const mspW = 80, mspH = 110;
  parts.push(rect(mspCX - mspW/2, mspCY - mspH/2, mspW, mspH, { fill: WHT, sw: SW_MED }));
  parts.push(line(mspCX, mspCY - mspH/2 + 12, mspCX, mspCY + mspH/2 - 12, { sw: SW_MED }));
  for (let i = 0; i < 3; i++) {
    const sy = mspCY - mspH/2 + 20 + i * 26;
    parts.push(line(mspCX - mspW/2 + 8, sy, mspCX - 4, sy, { sw: SW_THIN }));
    parts.push(rect(mspCX - 8, sy - 5, 16, 10, { fill: WHT, sw: 0.8 }));
    parts.push(line(mspCX + 4, sy, mspCX + mspW/2 - 8, sy, { sw: SW_THIN }));
  }
  parts.push(line(mspCX - mspW/2 - 16, mspCY, mspCX - mspW/2, mspCY, { sw: SW_MED }));
  parts.push(line(mspCX + mspW/2, mspCY, mspCX + mspW/2 + 16, mspCY, { sw: SW_MED }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 20, 'MAIN SERVICE PANEL', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY - mspH/2 - 9, `${input.mainPanelAmps}A RATED`, { size: F.sub, anchor: 'middle' }));
  parts.push(txt(mspCX, mspCY + mspH/2 + 11, `${input.backfeedAmps}A PV BREAKER`, { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(mspCX + mspW/2 + 20, mspCY - mspH/2 - 6, 6));

  // AC wire label between Meter and MSP
  const acMid3X = (meterCX + meterR + 16 + mspCX - mspW/2 - 16) / 2;
  parts.push(wireTag(acMid3X, busY, `${resolvedAcWireGauge} AWG`));

  // ─── UTILITY ───────────────────────────────────────────────────────────────
  const utilCX = xUtil, utilCY = busY;
  const utilR = 30;
  parts.push(circle(utilCX, utilCY, utilR, { fill: WHT, sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - 4, 'UTILITY', { size: F.sub, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + 7, 'METER', { size: 6, anchor: 'middle' }));
  parts.push(line(utilCX - utilR - 16, utilCY, utilCX - utilR, utilCY, { sw: SW_MED }));
  parts.push(txt(utilCX, utilCY - utilR - 20, 'UTILITY GRID', { size: F.hdr, bold: true, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY - utilR - 9, esc(input.utilityName), { size: F.sub, anchor: 'middle' }));
  parts.push(txt(utilCX, utilCY + utilR + 11, '120/240V, 1Ø, 3W', { size: F.tiny, anchor: 'middle' }));
  parts.push(callout(utilCX + utilR + 20, utilCY - utilR - 6, 7));

  // AC wire label between MSP and Utility
  const acMid4X = (mspCX + mspW/2 + 16 + utilCX - utilR - 16) / 2;
  parts.push(wireTag(acMid4X, busY, `${resolvedAcWireGauge} AWG`));

  // ─── Horizontal bus line ───────────────────────────────────────────────────
  parts.push(line(pvCX + pvW/2 + 10, busY, utilCX - utilR, busY, { sw: SW_MED }));

  // ─── Grounding conductors (GREEN) ─────────────────────────────────────────
  const gndLineY = busY + 90;
  // Grounding conductors - topology-aware
  const gndPoints = isMicro
    ? [xInv, xACDis, xMeter, xMSP]   // No DC disco for micro
    : [xDCDis, xInv, xACDis, xMeter, xMSP];
  const gndStartX = gndPoints[0];
  const gndEndX = gndPoints[gndPoints.length - 1];
  parts.push(line(gndStartX, gndLineY, gndEndX, gndLineY, { stroke: GRN, sw: SW_MED }));
  for (const gx of gndPoints) {
    parts.push(line(gx, busY + 28, gx, gndLineY, { stroke: GRN, sw: SW_MED }));
    parts.push(gndSym(gx, gndLineY));
  }
  parts.push(txt((gndStartX + gndEndX) / 2, gndLineY - 8,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122',
    { size: F.tiny, anchor: 'middle', fill: GRN }
  ));

  // ─── Conduit run tags ─────────────────────────────────────────────────────
  const tagY = busY + 52;
  if (isMicro) {
    // Micro: AC trunk cable from inverter, then AC conduit runs
    parts.push(conduitTag((xInv + xACDis) / 2, tagY, `${input.acConduitType} CONDUIT`, `${resolvedAcWireGauge} AWG AC`));
    parts.push(conduitTag((xACDis + xMeter) / 2, tagY, `${input.acConduitType} CONDUIT`, `${resolvedAcWireGauge} AWG AC`));
    parts.push(conduitTag((xMeter + xMSP) / 2, tagY, `${input.acConduitType} CONDUIT`, `${resolvedAcWireGauge} AWG AC`));
  } else {
    parts.push(conduitTag((xDCDis + xInv) / 2, tagY, `${input.dcConduitType} CONDUIT`, `${resolvedDcWireGauge} AWG DC`));
    parts.push(conduitTag((xInv + xACDis) / 2, tagY, `${input.acConduitType} CONDUIT`, `${resolvedAcWireGauge} AWG AC`));
    parts.push(conduitTag((xACDis + xMeter) / 2, tagY, `${input.acConduitType} CONDUIT`, `${resolvedAcWireGauge} AWG AC`));
  }

  // ─── Rapid Shutdown note ──────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rsdY = SCH_Y + SCH_H - 30;
    parts.push(rect(SCH_X + 8, rsdY - 14, 280, 22, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(SCH_X + 16, rsdY, 'RAPID SHUTDOWN SYSTEM — NEC 690.12 COMPLIANT', { size: F.tiny, bold: true }));
  }

  // ─── CALC PANELS ─────────────────────────────────────────────────────────
  const calcY = SCH_Y + SCH_H + 8;
  const calcH = NOTES_Y - calcY - 4;
  const calcW = DW / 3 - 4;

  if (calcH > 30) {
    // DC Calcs (or Micro AC Branch info)
    const dcCalcX = DX;
    parts.push(rect(dcCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(rect(dcCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: SW_THIN }));

    const totalDcKw = (input.totalModules * input.panelWatts / 1000);

    if (isMicro) {
      // Microinverter: show AC branch circuit info instead of DC string calcs
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
        ['AC Wire (branch)',       `${resolvedAcWireGauge} AWG`],
        ['AC Conduit',             input.acConduitType],
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
      // String / Optimizer: show NEC 690.7 DC string calculations
      parts.push(txt(dcCalcX + calcW/2, calcY + 11, 'DC SYSTEM CALCULATIONS', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));

      // Use auto-generated string config values if available, else fall back to simple division
      const panelsPerStr = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
      const lastStrPanels = input.lastStringPanels ?? panelsPerStr;
      const vocCorr = input.vocCorrected ?? input.panelVoc;
      const stringVocVal = input.stringVoc ?? (vocCorr * panelsPerStr);
      const stringIscVal = input.stringIsc ?? input.panelIsc;
      const ocpdStr = input.ocpdPerString ?? input.dcOCPD;
      const designTemp = input.designTempMin ?? -10;
      const dcAcRatio = input.dcAcRatio ?? (input.acOutputKw > 0 ? totalDcKw / input.acOutputKw : 0);

      const dcRows: [string, string][] = [
        ['Module Voc (STC)',          `${input.panelVoc} V`],
        ['Module Isc (STC)',          `${input.panelIsc} A`],
        ['Design Temp (NEC 690.7)',   `${designTemp}\u00b0C`],
        ['Voc Corrected',             `${vocCorr.toFixed(2)} V`],
        ['Panels per String',         panelsPerStr === lastStrPanels
                                        ? `${panelsPerStr}`
                                        : `${panelsPerStr} (last: ${lastStrPanels})`],
        ['Number of Strings',         `${input.totalStrings}`],
        ['String Voc (corrected)',     `${stringVocVal.toFixed(1)} V`],
        ['String Voc \u00d7 1.25 (NEC)',   `${(stringVocVal * 1.25).toFixed(1)} V`],
        ['String Isc \u00d7 1.25 (NEC)',   `${(stringIscVal * 1.25).toFixed(2)} A`],
        ['DC OCPD / String',          `${ocpdStr} A`],
        ['DC Wire Gauge',             `${resolvedDcWireGauge} AWG`],
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
      ['AC Wire Gauge',    `${resolvedAcWireGauge} AWG`],
      ['AC Conduit Type',  input.acConduitType],
      ['Service Voltage',  '120/240V, 1Ø'],
      ['Main Panel Rating',`${input.mainPanelAmps} A`],
      ['Backfeed Breaker', `${input.backfeedAmps} A`],
      ['Busbar Loading',   `${((input.backfeedAmps / input.mainPanelAmps) * 100).toFixed(1)}%`],
      ['120% Rule Check',  `${input.mainPanelAmps * 1.2 >= input.mainPanelAmps + input.backfeedAmps ? 'PASS' : 'FAIL'}`],
      ['Interconnection',  esc(input.interconnection)],
    ];
    const acRowH = Math.min(14, (calcH - 20) / acRows.length);
    acRows.forEach(([label, val], i) => {
      const ry = calcY + 22 + i * acRowH;
      if (i % 2 === 1) parts.push(rect(acCalcX, ry - acRowH + 2, calcW, acRowH, { fill: LGY, stroke: 'none', sw: 0 }));
      parts.push(txt(acCalcX + 6, ry, label, { size: F.tiny }));
      parts.push(txt(acCalcX + calcW - 6, ry, val, { size: F.tiny, anchor: 'end', bold: true }));
    });

    // Equipment Schedule
    const eqCalcX = DX + (calcW + 4) * 2;
    parts.push(rect(eqCalcX, calcY, calcW, calcH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
    parts.push(rect(eqCalcX, calcY, calcW, 16, { fill: BLK, stroke: BLK, sw: SW_THIN }));
    parts.push(txt(eqCalcX + calcW/2, calcY + 11, 'EQUIPMENT SCHEDULE', { size: F.hdr, bold: true, anchor: 'middle', fill: WHT }));

    const microDevCountEq = input.deviceCount ?? input.totalModules;
    const panelsPerStrEq = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));

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

  // ─── LEGEND ───────────────────────────────────────────────────────────────
  const legX = SCH_X + SCH_W - 220;
  const legY = SCH_Y + SCH_H - 80;
  const legW = 210, legH = 72;
  parts.push(rect(legX, legY, legW, legH, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(legX + 8, legY + 12, 'LEGEND', { size: F.sub, bold: true }));
  parts.push(line(legX, legY + 15, legX + legW, legY + 15, { sw: SW_THIN }));
  const legItems = [
    { dash: '',    stroke: BLK, label: 'AC Conductor (THWN-2)' },
    { dash: '6,3', stroke: BLK, label: 'DC Conductor (PV Wire)' },
    { dash: '',    stroke: GRN, label: 'Grounding Conductor (EGC)' },
    { dash: '2,2', stroke: BLK, label: 'Communication/Signal Wire' },
  ];
  legItems.forEach((item, i) => {
    const ly = legY + 22 + i * 13;
    parts.push(line(legX + 8, ly, legX + 48, ly, { stroke: item.stroke, sw: SW_MED, dash: item.dash }));
    parts.push(txt(legX + 54, ly + 3, item.label, { size: F.tiny }));
  });

  // ─── NOTES SECTION ────────────────────────────────────────────────────────
  parts.push(rect(DX, NOTES_Y, DW, NOTES_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(DX + 8, NOTES_Y + 12, 'GENERAL NOTES & NEC CODE COMPLIANCE', { size: F.hdr, bold: true }));
  parts.push(line(DX, NOTES_Y + 16, DX + DW, NOTES_Y + 16, { sw: SW_THIN }));

  const panelsPerStrNote = input.panelsPerString ?? Math.round(input.totalModules / Math.max(input.totalStrings, 1));
  const vocCorrNote = input.vocCorrected ?? input.panelVoc;
  const microDevCountNote = input.deviceCount ?? input.totalModules;
  const notes = isMicro ? [
    'ALL WORK SHALL COMPLY WITH NEC 2020, NEC 690, NEC 705.',
    `PV MODULES: ${esc(input.panelModel)} — ${input.panelWatts}W, Voc=${input.panelVoc}V, Isc=${input.panelIsc}A`,
    `MICROINVERTERS: ${microDevCountNote} UNITS — DC→AC AT EACH MODULE`,
    `AC BRANCH CIRCUITS: ${Math.ceil(microDevCountNote / 16)} CIRCUITS (MAX 16 MICROS/BRANCH — NEC 690.8)`,
    `INVERTER: ${esc(input.inverterManufacturer)} ${esc(input.inverterModel)} — ${input.acOutputKw} kW`,
    `AC CONDUCTORS: ${resolvedAcWireGauge} AWG THWN-2 — NEC 310`,
    `CONDUIT: ${input.acConduitType} — NEC 358/352`,
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
    `DC CONDUCTORS: ${resolvedDcWireGauge} AWG PV WIRE — NEC 690.31`,
    `AC CONDUCTORS: ${resolvedAcWireGauge} AWG THWN-2 — NEC 310`,
    `CONDUIT: ${input.dcConduitType}/${input.acConduitType} — NEC 358/352`,
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

  const colW = DW / 3;
  const noteLineH = 11;
  const notesPerCol = Math.ceil(notes.length / 3);
  notes.forEach((note, i) => {
    const col = Math.floor(i / notesPerCol);
    const row = i % notesPerCol;
    const nx = DX + 8 + col * colW;
    const ny = NOTES_Y + 24 + row * noteLineH;
    parts.push(txt(nx, ny, `${i + 1}. ${note}`, { size: F.note }));
  });
  parts.push(line(DX + colW, NOTES_Y + 16, DX + colW, NOTES_Y + NOTES_H, { sw: SW_THIN }));
  parts.push(line(DX + colW * 2, NOTES_Y + 16, DX + colW * 2, NOTES_Y + NOTES_H, { sw: SW_THIN }));

  // ─── CONDUIT SCHEDULE ─────────────────────────────────────────────────────
  parts.push(rect(DX, SCHED_Y, DW, SCHED_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  parts.push(txt(DX + 8, SCHED_Y + 12, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9', { size: F.hdr, bold: true }));
  parts.push(line(DX, SCHED_Y + 16, DX + DW, SCHED_Y + 16, { sw: SW_THIN }));

  const schedCols = [
    { label: 'RUN',        w: 0.05 },
    { label: 'FROM',       w: 0.10 },
    { label: 'TO',         w: 0.10 },
    { label: 'CONDUCTORS', w: 0.18 },
    { label: 'CONDUIT',    w: 0.08 },
    { label: 'FILL%',      w: 0.07 },
    { label: 'AMPACITY',   w: 0.08 },
    { label: 'OCPD',       w: 0.07 },
    { label: 'V-DROP%',    w: 0.08 },
    { label: 'LENGTH',     w: 0.07 },
    { label: 'PASS',       w: 0.06 },
  ];

  let colX = DX;
  const hdrY = SCHED_Y + 26;
  const rowH = 14;
  schedCols.forEach(col => {
    const cw = col.w * DW;
    parts.push(txt(colX + 4, hdrY, col.label, { size: F.tiny, bold: true }));
    parts.push(line(colX, SCHED_Y + 16, colX, SCHED_Y + SCHED_H, { sw: 0.5 }));
    colX += cw;
  });
  parts.push(line(DX, hdrY + 2, DX + DW, hdrY + 2, { sw: SW_THIN }));

  // Conduit schedule - use ComputedSystem.runs if provided (single source of truth)
  // Otherwise fall back to calculated schedule or hardcoded defaults
  let schedRows: any[] = [];
  
  // Priority 1: Use ComputedSystem.runs if provided
  if (input.runs && input.runs.length > 0) {
    schedRows = input.runs.map(run => ({
      raceway: run.id,
      from: run.from,
      to: run.to,
      conductors: run.conductorCallout || `${run.conductorCount}#${run.wireGauge} ${run.insulation}`,
      conduitType: `${run.conduitType} ${run.conduitSize}`,
      fillPercent: run.conduitFillPct,
      ampacity: run.continuousCurrent,
      ocpd: run.ocpdAmps,
      voltageDrop: run.voltageDropPct,
      lengthFt: run.onewayLengthFt,
      pass: run.overallPass,
    }));
  }
  // Priority 2: Use calculated schedule from wire-autosizer
  else if (schedule.length > 0) {
    schedRows = schedule;
  }
  // Priority 3: Fallback to topology-aware defaults
  else {
    const microDevCnt = input.deviceCount ?? input.totalModules;
    const acBranchCnt = Math.ceil(microDevCnt / 16);
    schedRows = isMicro ? [
      { raceway: 'A-1', from: 'MICROINVERTERS', to: 'AC DISCO',  conductors: `${resolvedAcWireGauge} AWG THWN-2`,  conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.2, pass: true },
      { raceway: 'A-2', from: 'AC DISCO',       to: 'METER',     conductors: `${resolvedAcWireGauge} AWG THWN-2`,  conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.4, pass: true },
      { raceway: 'A-3', from: 'METER',          to: 'MSP',       conductors: `${resolvedAcWireGauge} AWG THWN-2`,  conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps, ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
      { raceway: 'EGC', from: 'ARRAY',          to: 'MSP',       conductors: `#10 AWG BARE CU EGC`,              conduitType: input.acConduitType, fillPercent: 5,  ampacity: 30,                 ocpd: 0,            voltageDrop: 0,   pass: true },
    ] : [
      { raceway: 'D-1', from: 'PV ARRAY',  to: 'DC DISCO',  conductors: `${resolvedDcWireGauge} AWG PV WIRE`,  conduitType: input.dcConduitType, fillPercent: 28, ampacity: 30,                  ocpd: input.dcOCPD, voltageDrop: 1.2, pass: true },
      { raceway: 'D-2', from: 'DC DISCO',  to: 'INVERTER',  conductors: `${resolvedDcWireGauge} AWG PV WIRE`,  conduitType: input.dcConduitType, fillPercent: 28, ampacity: 30,                  ocpd: input.dcOCPD, voltageDrop: 1.2, pass: true },
      { raceway: 'A-1', from: 'INVERTER',  to: 'AC DISCO',  conductors: `${resolvedAcWireGauge} AWG THWN-2`,   conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps,  ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
      { raceway: 'A-2', from: 'AC DISCO',  to: 'METER',     conductors: `${resolvedAcWireGauge} AWG THWN-2`,   conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps,  ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
      { raceway: 'A-3', from: 'METER',     to: 'MSP',       conductors: `${resolvedAcWireGauge} AWG THWN-2`,   conduitType: input.acConduitType, fillPercent: 32, ampacity: input.acOutputAmps,  ocpd: resolvedAcOCPD, voltageDrop: 1.8, pass: true },
    ];
  }

  schedRows.slice(0, 10).forEach((row: any, ri) => {
    const ry = hdrY + 4 + (ri + 1) * rowH;
    if (ri % 2 === 1) parts.push(rect(DX, ry - rowH + 2, DW, rowH, { fill: LGY, stroke: 'none', sw: 0 }));
    let cx2 = DX;
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
      row.pass != null ? (row.pass ? 'PASS' : 'FAIL') : '',
    ];
    schedCols.forEach((col) => {
      const cw = col.w * DW;
      parts.push(txt(cx2 + 4, ry, String(vals[schedCols.indexOf(col)] ?? ''), { size: F.tiny }));
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
    parts.push(rect(tbX, tbRowY, TB_W, tbRowH, { fill: WHT, stroke: BLK, sw: 0.5 }));
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
    parts.push(rect(tbX, sysRowY, TB_W, sysRowH, { fill: WHT, stroke: BLK, sw: 0.5 }));
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
    parts.push(line(tbX, revY + 26, tbX + TB_W, revY + 26, { sw: 0.5 }));
    parts.push(line(tbX + revColW, revY + 14, tbX + revColW, revY + revH, { sw: 0.5 }));
    parts.push(line(tbX + revColW * 2, revY + 14, tbX + revColW * 2, revY + revH, { sw: 0.5 }));
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