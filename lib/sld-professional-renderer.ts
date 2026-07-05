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
import { necNextStandardOcpd } from '@/lib/permit/utils/helpers';
import { microBranchCount, microMaxPerBranch } from '@/lib/permit/utils/branching';
import { getBuildBadge } from './version';
import type { ConductorBundle } from './segment-schedule';
import { calcDcAcRatio } from './system/calcDcAcRatio';
import { SLD_SYMBOL_MAP } from './sld-symbols';
import { emitBrandEmblem } from './sld-brand-emblems';
import { resolveDeviceIllustration } from './sld-device-illustrations';
import type { Conductor, WireRun, ConductorType, WireEnvironment } from './sld-types';

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
const SCH_H = Math.round(DH * 0.62);  // SOT: expanded for symbol height

// Main horizontal bus line Y
const BUS_Y = SCH_Y + Math.round(SCH_H * 0.40);  // SOT: adjusted for larger symbols

// Ground rail
const GND_Y = BUS_Y + 140;  // SOT: increased for taller symbols

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

// ─── SPACING CONSTANTS ───────────────────────────────────────────────────────
// Single source of truth for all positional offsets.
// Change once here — propagates everywhere.
const LABEL_OFFSET_ABOVE = 8;   // px: wire label sits N px above the line
const LABEL_OFFSET_BELOW = 11;  // px: wire label sits N px below the line
const EQP_LABEL_ABOVE    = 15;  // px: equipment header above top edge
const EQP_LABEL_BELOW    = 9;   // px: equipment info below bottom edge
const SW_HAIR   = 0.5;
const SW_BUS    = 3.5;

// ── Font sizes ───────────────────────────────────────────────────────────────
// ─── TYPE SCALE ─────────────────────────────────────────────────────────────
// Consistent typographic hierarchy for permit-grade SLD.
// title   = drawing title (largest)
// hdr     = equipment section headers (e.g. "PV ARRAY", "STRING INVERTER")
// label   = equipment name plates (manufacturer, model)
// sub     = secondary equipment info (kW rating, panel model)
// seg     = conductor callout text (wire gauge, insulation, conduit)
// tiny    = NEC references, secondary annotations
// tb      = title block fields
// tbTitle = title block section headers
const F = {
  title:  13,
  hdr:     9.5,   // equipment headers — bold, most prominent after title
  label:   8.0,   // equipment name plates
  sub:     7.0,   // secondary info (kW, model details)
  seg:     6.5,   // conductor callouts — readable but not dominant
  tiny:    6.0,   // NEC references — smallest, clearly secondary
  tb:      7.0,
  tbTitle: 10,
};

// ── Public Interface ─────────────────────────────────────────────────────────
export interface SLDProfessionalInput {
  /** Embedded in a planset sheet that has its own title block — suppress the
   *  internal SOLARPRO title panel (it duplicated project/system/code data
   *  right next to the sheet's title block on E-1) and crop the viewBox to
   *  the diagram. Standalone Diagram-tab renders keep the panel. */
  suppressTitleBlock?:     boolean;
  projectName:             string;
  clientName:              string;
  address:                 string;
  designer:                string;
  drawingDate:             string;
  drawingNumber:           string;
  revision:                string;
  topologyType:            string;
  systemType?:             'roof' | 'ground' | 'fence';  // mount type — drives the PV-array glyph/labels (fence → SolFence vertical array)
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
  panelBusRating?:         number;  // NEC 705.12(B) busbar ampacity — the 120% base. Defaults to mainPanelAmps if absent.
  backfeedAmps:            number;
  utilityName:             string;
  interconnection:         string;
  rapidShutdownIntegrated: boolean;
  hasProductionMeter:      boolean;
  hasBattery:              boolean;
  batteryModel:            string;
  batteryKwh:              number;
  /** Human-readable kWh label with unit breakdown, e.g. "15 kWh (3 × 5.0)". Falls back to "N kWh" for single-unit. */
  batteryKwhLabel?:        string;
  batteryBrand?:           string;
  batteryCount?:           number;
  batteryBackfeedA?:       number;
  // Ecosystem / optimizer fields
  selectedBrand?:          string;           // e.g. 'solaredge', 'enphase'
  ecosystemTopology?:      string;           // 'optimizer' | 'string' | 'micro' | 'hybrid'
  optimizerQty?:           number;           // total optimizers (per_module = totalModules)
  optimizerModel?:         string;           // optimizer model name (e.g. 'P505')
  integratedDcDisconnect?: boolean;          // true = skip external DC disco node
  // AC conductor truth from inverter profile (NEC 310.15)
  acRequiresNeutral?:      boolean;          // true = 3-wire (L1+L2+N); false = 2-wire (L1+L2 only)
  generatorBrand?:         string;
  generatorModel?:         string;
  generatorKw?:            number;
  atsBrand?:               string;
  atsModel?:               string;
  atsAmpRating?:           number;
  hasBackupPanel?:         boolean;
  backupPanelAmps?:        number;
  backupPanelBrand?:       string;
  backupInterfaceId?:      string;
  backupInterfaceBrand?:   string;
  backupInterfaceModel?:   string;
  backupInterfaceIsATS?:   boolean;
  // BUILD v24: IQ SC3 IS the ATS — suppress standalone renderATS() when true
  hasEnphaseIQSC3?:        boolean;
  scale:                   string;
  acWireLength:            number;
  /** Real engine-computed AC feeder conduit fill % (NEC Ch.9 Tbl.1). */
  acConduitFillPct?:       number;
  /** Real engine-computed AC feeder voltage drop %. */
  acVoltageDropPct?:       number;
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
  // v25 — Single Source of Truth: pre-computed values from computeSystem() engine
  systemModel?:            import('./plan-set/permit-system-model').PermitSystemModel;
  // EGC gauge from computeSystem() NEC 250.122 table
  egcGauge?:               string;
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

// ── Embed sld-symbols.ts emblem as scaled SVG group ──────────────────────
// Strips the outer <svg> wrapper and scales inner content to fit slot (cx,cy center)
function embedSymbol(id: string, cx: number, cy: number, slotW: number, slotH: number): string {
  const sym = SLD_SYMBOL_MAP[id];
  if (!sym) return '';
  const svgStr = sym.svg({});
  // Strip outer <svg ...> wrapper — extract inner content
  const inner = svgStr.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const sx = slotW / sym.width;
  const sy = slotH / sym.height;
  const scale = Math.min(sx, sy);
  const ox = cx - (sym.width * scale) / 2;
  const oy = cy - (sym.height * scale) / 2;
  return `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)}) scale(${scale.toFixed(4)})">${inner}</g>`;
}

// ── IEEE Standard Equipment Symbols ─────────────────────────────────────────

// PV Module symbol v2: realistic solar cell with cell grid (hybrid realism v3.0)
function pvModuleSymbol(cx: number, cy: number, w = 28, h = 20): string {
  const PV_FILL  = '#1A237E'; // deep navy — PV cell
  const PV_FRAME = '#37474F'; // charcoal frame
  const bx = cx - w/2, by = cy - h/2;
  const parts: string[] = [];
  // Frame + cell background
  parts.push(rect(bx, by, w, h, {fill: PV_FILL, stroke: PV_FRAME, sw: SW_MED}));
  // Cell grid — 3x2 subdivisions
  const cw = w / 3, ch = h / 2;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      parts.push(rect(bx + c*cw + 1, by + r*ch + 1, cw - 2, ch - 2,
        {fill: '#283593', stroke: '#FFFFFF', sw: 0.4}));
    }
  }
  // Diagonal shine line
  parts.push(ln(bx+3, by+3, bx+w-5, by+5, {stroke:'#5C6BC0', sw: 0.5}));
  return parts.join('');
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


// ── getAnchorPoint(): SOT anchor resolver ────────────────────────────────────
// Resolves a named anchor from SLD_SYMBOL_MAP to absolute canvas coordinates.
// The symbol is rendered at (cx, cy) at slotW×slotH.
// Anchor coords in SLD_SYMBOL_MAP are defined at native symbol size (nW×nH).
// We scale them proportionally to the slot size used in the renderer.
//
// Usage:  const pt = getAnchorPoint('inverter', 'ac_out', cx, cy, W2, H2);
//         → { x: <absolute canvas x>, y: <absolute canvas y> }
//
// [SLD ANCHOR CONNECTED] logs are emitted for each resolved anchor.
function getAnchorPoint(
  symbolId: string,
  anchorId: string,
  cx: number, cy: number,
  slotW: number, slotH: number
): { x: number; y: number } {
  const sym = SLD_SYMBOL_MAP[symbolId];
  if (!sym) {
    console.warn(`[SLD ANCHOR CONNECTED] symbol not found: ${symbolId}`);
    return { x: cx, y: cy };
  }
  const anchor = sym.connections?.find((a: {id:string}) => a.id === anchorId);
  if (!anchor) {
    console.warn(`[SLD ANCHOR CONNECTED] anchor not found: ${symbolId}.${anchorId}`);
    return { x: cx, y: cy };
  }
  // Native symbol origin is top-left; cx/cy is center of slot
  const originX = cx - slotW / 2;
  const originY = cy - slotH / 2;
  // Scale anchor coords from native size to slot size
  const scaleX = slotW / sym.width;
  const scaleY = slotH / sym.height;
  const ax = originX + anchor.x * scaleX;
  const ay = originY + anchor.y * scaleY;
  console.log(`[SLD ANCHOR CONNECTED] ${symbolId}.${anchorId} → (${ax.toFixed(1)}, ${ay.toFixed(1)})`);
  return { x: ax, y: ay };
}

// Battery Storage Symbol (IEEE/ANSI)
// Drawn as a stack of cells (IEC 60617 battery symbol) with AC connection
// Terminal BAT_AC_OUT: bottom center — AC output lug connecting to BUI BATTERY port
// Battery Storage Symbol v3 — embeds sld-symbols.ts hybrid realism emblem
function renderBattery(
  cx: number, cy: number,
  model: string, kwh: number, backfeedA: number, calloutN: number,
  manufacturer: string = '',
  kwhLabel: string = ''
): {svg: string; lx: number; rx: number; ty: number; by: number;
    acOutX: number; acOutY: number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['battery-ac'] = 180×170
  const W2 = SLD_SYMBOL_MAP['battery-ac'].width;   // 180
  const H2 = SLD_SYMBOL_MAP['battery-ac'].height;  // 170
  console.log(`[SLD SYMBOL SIZE USED] battery-ac: ${W2}×${H2}`);
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];
  const BAT_HDR = '#1565C0';

  // v58.16 — Resolve effective manufacturer: explicit arg first, else infer
  // from the model string so legacy callers still get brand-aware output.
  let _effectiveMfg = manufacturer;
  if (!_effectiveMfg && model) {
    const ml = model.toLowerCase();
    if      (ml.includes('powerwall'))  _effectiveMfg = 'Tesla';
    else if (ml.includes('iq battery') || ml.includes('enphase')) _effectiveMfg = 'Enphase';
    else if (ml.includes('solaredge') || ml.includes('energy bank')) _effectiveMfg = 'SolarEdge';
    else if (ml.includes('pwrcell') || ml.includes('generac')) _effectiveMfg = 'Generac';
    else if (ml.includes('ocean pro') || ml.includes('ecoflow')) _effectiveMfg = 'EcoFlow';
    else if (ml.includes('franklin')) _effectiveMfg = 'FranklinWH';
    else if (ml.includes('sol-ark') || ml.includes('sol ark')) _effectiveMfg = 'Sol-Ark';
    else if (ml.includes('growatt')) _effectiveMfg = 'Growatt';
    else if (ml.includes('solis')) _effectiveMfg = 'Solis';
    else if (ml.includes('tigo')) _effectiveMfg = 'Tigo';
    else if (ml.includes('apsystems')) _effectiveMfg = 'APsystems';
    else if (ml.includes('hoymiles')) _effectiveMfg = 'Hoymiles';
    else if (ml.includes('anker')) _effectiveMfg = 'Anker';
    else if (ml.includes('bluetti')) _effectiveMfg = 'BLUETTI';
    else if (ml.includes('savant')) _effectiveMfg = 'Savant';
  }

  // v58.16 — Device illustration first. Falls back to generic emblem+badge.
  const _batDevice = resolveDeviceIllustration(_effectiveMfg, 'battery');
  if (_batDevice) {
    const devSlotW = W2 * 0.78;
    const devSlotH = H2 * 0.82;
    p.push(_batDevice.render(cx, cy, devSlotW, devSlotH));
  } else {
    // Embed generic hybrid realism battery emblem (AC-coupled)
    p.push(embedSymbol('battery-ac', cx, cy, W2, H2));
    // v58.15 brand wordmark badge overlay
    const _batSym = SLD_SYMBOL_MAP['battery-ac'];
    if (_batSym) {
      const _batScale = Math.min(W2 / _batSym.width, H2 / _batSym.height);
      const _batOx = cx - (_batSym.width * _batScale) / 2;
      const _batOy = cy - (_batSym.height * _batScale) / 2;
      const _batEmblem = emitBrandEmblem(_effectiveMfg, 120, 12, 52, 14);
      if (_batEmblem) {
        p.push(`<g transform="translate(${_batOx.toFixed(1)},${_batOy.toFixed(1)}) scale(${_batScale.toFixed(4)})">${_batEmblem}</g>`);
      }
    }
  }

  // Labels below
  p.push(txt(cx, by2 + H2 + 16, model ? model.substring(0, 22) : 'BATTERY STORAGE', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, by2 + H2 + 25, kwh > 0 ? (kwhLabel || `${kwh} kWh`) : '', {sz: F.tiny, anc: 'middle', bold: true, fill: BAT_HDR}));
  if (backfeedA > 0) {
    p.push(txt(cx, by2 + H2 + 34, `${backfeedA}A BACKFEED — NEC 705.12(B)`, {sz: F.tiny, anc: 'middle', fill: BAT_HDR}));
  }

  // BAT_AC_OUT: use bottom-centre of symbol so the wire drops straight down
  // to the BUI BATTERY port (which is also at bottom-centre of the BUI box).
  // Keep the right-side ac_l1 lug stub for visual authenticity but route
  // the connection wire from the bottom lug.
  const acPt = getAnchorPoint('battery-ac', 'ac_l1', cx, cy, W2, H2);
  // Right-side lug stub (decorative — shows AC terminals on symbol face)
  p.push(ln(acPt.x, acPt.y, acPt.x + 10, acPt.y, {stroke: BAT_HDR, sw: SW_MED}));
  // Bottom-centre AC output lug — this is the actual connection point to BUI
  const acOutX = cx;            // centre X (aligns with BUI batPortX)
  const acOutY = by2 + H2;      // bottom edge of battery symbol
  p.push(ln(acOutX, acOutY - 4, acOutX, acOutY, {stroke: BAT_HDR, sw: SW_MED}));
  console.log(`[SLD WIRE TYPE: AC] battery-ac.bottom → (${acOutX.toFixed(1)},${acOutY.toFixed(1)})`);

  p.push(callout(bx + W2 + 14, by2 - 5, calloutN));
  return {svg: p.join(''), lx: bx, rx: bx + W2, ty: by2, by: by2 + H2,
          acOutX, acOutY};
}

// Generator Symbol (IEEE 315 / ANSI) - circle with G inside
function renderGenerator(
  cx: number, cy: number,
  brand: string, model: string, kw: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    genOutX: number; genOutY: number} {
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

  // GEN_OUT terminal — right side lug (wire exits rightward to ATS GEN or BUI GEN port)
  const genOutX = cx + r + 10;
  const genOutY = cy;
  p.push(txt(cx + r + 2, cy - 7, 'GEN OUT', {sz: 4, anc: 'start', fill: GEN_CLR}));

  return {svg: p.join(''), lx: cx - r, rx: genOutX, ty: cy - r, by: cy + r,
          genOutX, genOutY};
}

// ATS Symbol (Automatic Transfer Switch)
function renderATS(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    utilInX: number; utilInY: number; genInX: number; genInY: number;
    loadOutX: number; loadOutY: number} {
  // SOT: ATS is custom-drawn (no sld-symbols emblem); slot expanded to 160×120
  const W2 = 160, H2 = 120;
  console.log(`[SLD SYMBOL SIZE USED] ats (custom): ${W2}×${H2}`);
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

  // Terminal coordinates for segment routing
  const utilInX = bx;          // UTIL input — left edge, upper
  const utilInY = cy - 12;
  const genInX  = bx;          // GEN input — left edge, lower
  const genInY  = cy + 12;
  const loadOutX = bx + W2;    // LOAD output — right edge, center
  const loadOutY = cy;
  return {svg: p.join(''), lx: bx - 10, rx: bx + W2 + 10, ty: by2, by: by2 + H2,
          utilInX, utilInY, genInX, genInY, loadOutX, loadOutY};
}

// Backup Sub-Panel Symbol
function renderBackupPanel(
  cx: number, cy: number,
  brand: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number} {
  // SOT: Backup Panel is custom-drawn; slot expanded to 140×120
  const W2 = 140, H2 = 120;
  console.log(`[SLD SYMBOL SIZE USED] backup-panel (custom): ${W2}×${H2}`);
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

// Backup Interface Unit (BUI) Symbol
// Handles: Enphase IQ SC3, Tesla Backup Gateway, generic BUI
// Placed between MSP and utility meter on the right side of the bus
function renderBUI(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number,
  buiBrand: string,      // normalised lowercase brand key e.g. 'enphase', 'tesla', 'solark'
  hasGenerator: boolean, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    batPortX: number; batPortY: number;
    loadPortX: number; loadPortY: number;
    gridPortX: number; gridPortY: number;
    genPortX: number; genPortY: number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['bui-enphase'] = 180×130
  const W2 = SLD_SYMBOL_MAP['bui-enphase'].width;   // 180
  const H2 = SLD_SYMBOL_MAP['bui-enphase'].height;  // 130
  console.log(`[SLD SYMBOL SIZE USED] bui-enphase: ${W2}×${H2}`);
  const bx = cx - W2/2, by2 = cy - H2/2;
  // ── Brand config table ────────────────────────────────────────────────────
  // Each entry: [accentColour, headerText, defaultModel, necNote]
  const BUI_BRAND_CONFIG: Record<string, [string, string, string, string]> = {
    enphase:    ['#0D47A1', 'IQ SYSTEM CONTROLLER 3',  'IQ SC3',             'NEC 706 / NEC 230.82 / UL 1741-SA'],
    tesla:      ['#CC0000', 'BACKUP GATEWAY 2',         'Backup Gateway 2',   'NEC 706 / UL 9540A'],
    ecoflow:    ['#006D5B', 'SMART HOME PANEL',         'Smart Home Panel',   'NEC 706 / UL 1741 / UL 9540'],
    solaredge:  ['#E8520A', 'BACKUP INTERFACE',         'Backup Interface',   'NEC 706 / UL 1741-SB'],
    generac:    ['#1B5E20', 'PWRmanager',               'PWRmanager',         'NEC 706 / UL 1008 / UL 1741'],
    solark:     ['#1A237E', 'SMART LOAD CENTER',        'Smart Load Center',  'NEC 706 / UL 1741-SB'],
    growatt:    ['#2E7D32', 'ATS-S TRANSFER SWITCH',    'ATS-S 200A',         'NEC 706 / UL 1008'],
  };
  const _bCfg   = BUI_BRAND_CONFIG[buiBrand] ?? ['#1565C0', 'BACKUP INTERFACE UNIT', 'BUI', 'NEC 706 / UL 1741'];
  const BUI_CLR = _bCfg[0];
  const _buiHeaderText  = _bCfg[1];
  const _buiDefaultModel = _bCfg[2];
  const _buiNecNote     = _bCfg[3];
  const p: string[] = [];

  // v58.16 Phase 1.5 — Device illustration (painted as background so the
  // functional wire terminals + transfer-switch blades still overlay on top).
  // Falls back to a plain enclosure rect when no illustration is registered.
  const _buiDevice = resolveDeviceIllustration(brand, 'bui');
  if (_buiDevice) {
    // Paint the illustration slightly smaller than the full symbol so the
    // header strip + terminal lugs retain their legibility.
    p.push(_buiDevice.render(cx, cy, W2 * 0.94, H2 * 0.94));
  } else {
    // Plain enclosure (legacy look)
    p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BUI_CLR, sw: SW_MED}));
  }
  p.push(ln(bx, by2+14, bx+W2, by2+14, {stroke: BUI_CLR, sw: SW_THIN}));

  // Header text
  const headerText = _buiHeaderText;
  p.push(txt(cx, by2+10, headerText, {sz: 5.5, bold: true, anc: 'middle', fill: BUI_CLR}));

  // GRID input lug (left side, upper)
  const gridY = cy - 14;
  p.push(lug(bx+8, gridY));
  p.push(txt(bx+8, gridY-8, 'GRID', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(bx, gridY, bx+8, gridY, {stroke: BUI_CLR, sw: SW_MED}));

  // GEN input lug (left side, lower) — only if generator configured
  const genInputY = cy + 14;
  if (hasGenerator) {
    p.push(lug(bx+8, genInputY));
    p.push(txt(bx+8, genInputY+9, 'GEN', {sz: 4.5, anc: 'middle', fill: '#2E7D32'}));
    p.push(ln(bx, genInputY, bx+8, genInputY, {stroke: '#2E7D32', sw: SW_MED}));
  }

  // Transfer switch blades inside
  // GRID blade — closed (utility is normal source)
  p.push(ln(bx+11, gridY, bx+42, gridY, {stroke: BUI_CLR, sw: SW_MED}));
  p.push(circ(bx+11, gridY, 2.5, {fill: BUI_CLR, stroke: BUI_CLR, sw: 0}));
  p.push(circ(bx+42, gridY, 2.5, {fill: WHT, stroke: BUI_CLR, sw: SW_THIN}));

  if (hasGenerator) {
    // GEN blade — open (angled)
    p.push(ln(bx+11, genInputY, bx+32, genInputY-12, {stroke: '#2E7D32', sw: SW_MED}));
    p.push(circ(bx+11, genInputY, 2.5, {fill: '#2E7D32', stroke: '#2E7D32', sw: 0}));
    p.push(circ(bx+42, genInputY, 2.5, {fill: WHT, stroke: '#2E7D32', sw: SW_THIN}));
  }

  // Internal bus (vertical center)
  const busX2 = bx + 55;
  p.push(ln(busX2, gridY, busX2, hasGenerator ? genInputY : gridY+20, {stroke: BUI_CLR, sw: 2.5}));
  p.push(ln(bx+42, gridY, busX2, gridY, {stroke: BUI_CLR, sw: SW_THIN}));
  if (hasGenerator) {
    p.push(ln(bx+42, genInputY, busX2, genInputY, {stroke: BUI_CLR, sw: SW_THIN}));
  }

  // LOAD output lug (right side, center)
  const loadY = cy;
  p.push(lug(bx+W2-8, loadY));
  p.push(txt(bx+W2-8, loadY-8, 'LOAD', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(busX2, loadY, bx+W2-8, loadY, {stroke: BUI_CLR, sw: SW_MED}));
  p.push(ln(bx+W2-8, loadY, bx+W2, loadY, {stroke: BUI_CLR, sw: SW_MED}));

  // BATTERY port (bottom center)
  const batPortX2 = cx;
  const batPortY2 = by2 + H2;
  p.push(lug(batPortX2, batPortY2-4));
  p.push(txt(batPortX2, batPortY2+8, 'BATTERY', {sz: 4.5, anc: 'middle', fill: BUI_CLR}));
  p.push(ln(batPortX2, batPortY2-4, batPortX2, batPortY2, {stroke: BUI_CLR, sw: SW_MED}));

  // Labels below
  const labelBrand = brand || (buiBrand ? buiBrand.charAt(0).toUpperCase() + buiBrand.slice(1) : 'BUI');
  const labelModel = model || _buiDefaultModel;
  p.push(txt(cx, by2+H2+18, `${labelBrand} ${labelModel}`, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));
  p.push(txt(cx, by2+H2+27, ampRating > 0 ? `${ampRating}A` : '200A', {sz: F.tiny, anc: 'middle', bold: true, fill: BUI_CLR}));
  p.push(txt(cx, by2+H2+36, _buiNecNote, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {
    svg: p.join(''),
    lx: bx-10, rx: bx+W2+10,
    ty: by2, by: by2+H2,
    batPortX: batPortX2, batPortY: batPortY2,
    loadPortX: bx+W2, loadPortY: loadY,
    gridPortX: bx,     gridPortY: cy - 14,   // GRID lug -- left edge, upper
    genPortX:  bx,     genPortY:  cy + 14,   // GEN lug  -- left edge, lower
  };
}

// Professional Inverter Box v3 — embeds sld-symbols.ts hybrid realism emblem
function renderInverterBox(
  cx: number, cy: number,
  manufacturer: string, model: string,
  acKw: number, acAmps: number,
  topologyLabel: string, mpptAllocation: string,
  calloutN: number
): {svg: string; lx: number; rx: number;
    dcInX: number; dcInY: number; acOutX: number; acOutY: number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['inverter'] = 200×170
  const W2 = SLD_SYMBOL_MAP['inverter'].width;   // 200
  const H2 = SLD_SYMBOL_MAP['inverter'].height;  // 170
  console.log(`[SLD SYMBOL SIZE USED] inverter: ${W2}×${H2}`);
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];

  // v58.16 — Device illustration first (brand-specific front-view silhouette).
  // Falls back to the generic IEEE emblem + wordmark badge if no illustration
  // is registered for the brand.
  const _invDevice = resolveDeviceIllustration(manufacturer, 'inverter');
  if (_invDevice) {
    // Draw the device illustration inside the symbol's visual slot. The slot
    // is inset from the full symbol so we leave room for the label strip
    // beneath it and the callout bubble at the top-right.
    const devSlotW = W2 * 0.78;
    const devSlotH = H2 * 0.82;
    p.push(_invDevice.render(cx, cy, devSlotW, devSlotH));
  } else {
    // Embed the generic hybrid realism inverter emblem
    p.push(embedSymbol('inverter', cx, cy, W2, H2));
    // v58.15 brand wordmark badge overlay (top-right corner of cabinet).
    const _invSym = SLD_SYMBOL_MAP['inverter'];
    if (_invSym) {
      const _invScale = Math.min(W2 / _invSym.width, H2 / _invSym.height);
      const _invOx = cx - (_invSym.width * _invScale) / 2;
      const _invOy = cy - (_invSym.height * _invScale) / 2;
      const _emblemNative = emitBrandEmblem(manufacturer, 140, 10, 54, 14);
      if (_emblemNative) {
        p.push(`<g transform="translate(${_invOx.toFixed(1)},${_invOy.toFixed(1)}) scale(${_invScale.toFixed(4)})">${_emblemNative}</g>`);
      }
    }
  }

  // Manufacturer + model labels below
  const mfgLabel = manufacturer ? `${manufacturer}` : '';
  const mdlLabel = model ? model.substring(0, 18) : '';
  p.push(txt(cx, by2+H2+9,  mfgLabel, {sz: F.sub,   anc: 'middle', italic: true}));
  p.push(txt(cx, by2+H2+18, mdlLabel, {sz: F.label,  anc: 'middle', bold: true}));
  p.push(txt(cx, by2+H2+27, acKw > 0 ? `${acKw} kW / ${acAmps}A` : '', {sz: F.tiny, anc: 'middle'}));
  if (mpptAllocation) {
    p.push(txt(cx, by2+H2+36, `MPPT: ${mpptAllocation}`, {sz: F.tiny, anc: 'middle', fill: '#555'}));
    if (typeof console !== 'undefined') {
      console.log('[SLD STRING LANDING] mpptAllocation=' + mpptAllocation);
    }
  }

  // Topology label above
  p.push(txt(cx, by2-10, topologyLabel, {sz: F.hdr, bold: true, anc: 'middle'}));

  // SOT: anchor-based terminals
  // dc_in_pos: native (0, 60) left side — DC input from DC disco
  // ac_out:    native (200, 75) right side — AC output to AC disco
  const _dcPt = getAnchorPoint('inverter', 'dc_in_pos', cx, cy, W2, H2);
  const _acPt = getAnchorPoint('inverter', 'ac_out',    cx, cy, W2, H2);
  p.push(ln(_dcPt.x - 10, _dcPt.y, _dcPt.x, _dcPt.y, {sw: SW_MED}));
  p.push(ln(_acPt.x, _acPt.y, _acPt.x + 10, _acPt.y, {sw: SW_MED}));
  console.log(`[SLD WIRE TYPE: DC] inverter.dc_in → (${_dcPt.x.toFixed(1)},${_dcPt.y.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] inverter.ac_out → (${_acPt.x.toFixed(1)},${_acPt.y.toFixed(1)})`);

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  // Terminal coordinates — anchor-driven
  const dcInX  = _dcPt.x - 10;
  const dcInY  = _dcPt.y;
  const acOutX2 = _acPt.x + 10;
  const acOutY2 = _acPt.y;
  return {svg: p.join(''), lx: bx-10, rx: bx+W2+10,
          dcInX, dcInY, acOutX: acOutX2, acOutY: acOutY2};
}

// ── Wire Segment with Inline Label ───────────────────────────────────────────
// ── Segment Overlap Guard ───────────────────────────────────────────────────
// Tracks horizontal wire Y-coordinates to detect and offset parallel overlapping wires.
// Call resolveSegY() before drawing each horizontal segment to get a non-overlapping Y.
const OVERLAP_GUARD_OFFSET = 4; // px offset for parallel wires
function makeOverlapGuard() {
  const usedRanges: Array<{x1:number; x2:number; y:number}> = [];
  return function resolveSegY(x1: number, x2: number, y: number): number {
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    let candidate = y;
    let attempts = 0;
    while (attempts < 10) {
      const conflict = usedRanges.find(r =>
        Math.abs(r.y - candidate) < OVERLAP_GUARD_OFFSET &&
        r.x1 < xMax && r.x2 > xMin
      );
      if (!conflict) break;
      candidate += OVERLAP_GUARD_OFFSET;
      attempts++;
    }
    usedRanges.push({x1: xMin, x2: xMax, y: candidate});
    return candidate;
  };
}

// ── Phase 6: getConductorStyle ───────────────────────────────────────────────
// Returns consistent SVG line style per conductor type.
// AC: solid medium line. DC: slightly thinner + dashed. Ground: green + thin.
// Phase 1: WireEnvironment-aware conductor style
// OPEN_AIR  → dashed (PV roof wiring, NEC 690.31)
// RACEWAY   → solid (in conduit, all downstream wiring)
// ENCLOSED  → solid thin (equipment internal)
function getConductorStyle(
  type: ConductorType,
  envOrOpenAir: WireEnvironment | boolean = 'RACEWAY'
): {
  stroke: string; sw: number; dash?: string; label: string;
} {
  // Backwards compat: boolean true = OPEN_AIR, false = RACEWAY
  const env: WireEnvironment =
    typeof envOrOpenAir === 'boolean'
      ? (envOrOpenAir ? 'OPEN_AIR' : 'RACEWAY')
      : envOrOpenAir;
  const isOA = env === 'OPEN_AIR';
  switch (type) {
    // AC signal — solid in raceway, long-dash in open air
    case 'L1':
      return { stroke: BLK,       sw: SW_MED,  dash: isOA ? '10,5' : undefined, label: 'L1' };
    case 'L2':
      return { stroke: BLK,       sw: SW_MED,  dash: isOA ? '10,5' : undefined, label: 'L2' };
    case 'N':
      return { stroke: '#555555',  sw: SW_MED,  dash: isOA ? '10,5' : undefined, label: 'N'  };
    // Ground — always dashed green
    case 'G':
      return { stroke: GRN,       sw: SW_THIN, dash: '4,3',                     label: 'G'  };
    // DC — red for +, blue for −; dashed in OPEN_AIR, solid in conduit (RACEWAY)
    case 'DC_POS':
      return { stroke: '#C62828',  sw: SW_MED,  dash: isOA ? '10,5' : undefined, label: '+'  };
    case 'DC_NEG':
      return { stroke: '#1565C0',  sw: SW_MED,  dash: isOA ? '10,5' : undefined, label: '−'  };
    default:
      return { stroke: BLK,       sw: SW_MED,  label: '' };
  }
}

// Phase 2: Format conductor callout label
// Format: "X#AWG TYPE + #GND IN CONDUIT"
// Example: "2#10 THWN-2 + #10 GND IN 3/4" EMT"
// Source: RunSegment fields. Fallback to plain gauge labels.
function formatCallout(run: RunSegment | undefined, fallbackLines: string[], isDC: boolean): string[] {
  if (!run) return fallbackLines;

  // For DC runs: always use our per-polarity format on the SLD label.
  // The engine conductorCallout says "6×#10" (total count) which is correct for
  // the conduit schedule table but misleading on the SLD wire label.
  // We derive per-polarity count from conductorCount and show "3×DC+ / 3×DC-".
  if (!isDC && run.conductorCallout) {
    // AC: engine callout is already correct — use it directly
    return run.conductorCallout.split('\n').filter((l: string) => l.trim());
  }

  // Build formatted callout from individual fields
  const g   = run.wireGauge  ? run.wireGauge.replace('#','').replace(' AWG','')  : '10';
  const eg  = run.egcGauge   ? run.egcGauge.replace('#','').replace(' AWG','')   : '10';
  const ins = run.insulation ?? (isDC ? 'USE-2' : 'THWN-2');
  const totalCnt = run.conductorCount ?? (isDC ? 2 : 2);
  const conduit = run.isOpenAir
    ? 'OPEN AIR — NEC 690.31'
    : (run.conduitSize && run.conduitType ? `IN ${run.conduitSize} ${run.conduitType}` : '');

  let hotLine: string;
  if (isDC) {
    // DC: conductorCount = stringCount * 2; show per-polarity count separately
    const strCnt = Math.max(1, Math.floor(totalCnt / 2));
    hotLine = strCnt > 1
      ? `${strCnt}×#${g} DC+ / ${strCnt}×#${g} DC-`
      : `#${g} DC+ / #${g} DC-`;
  } else {
    hotLine = `${totalCnt}#${g} ${ins}`;
  }
  const gndLine = `+ #${eg} EGC`;
  if (conduit) return [`${hotLine} ${gndLine}`, conduit];
  return [`${hotLine} ${gndLine}`];
}

// ── Phase 3: buildWireRun ─────────────────────────────────────────────────────
// Maps a RunSegment → WireRun with one Conductor per electrical conductor.
// DO NOT infer new electrical logic — only maps what exists in segment data.
// AC split-phase: L1 + L2 + (optional N) + G
// DC:             DC_POS + DC_NEG + G
// Phase 1: buildWireRun now takes WireEnvironment (isOpenAir=boolean still accepted
// for backwards compat at call sites; will be removed in a future pass)
function buildWireRun(
  runId: string,
  x1: number, y1: number,
  x2: number, y2: number,
  run: import('./computed-system').RunSegment | undefined,
  fallbackLabel: string[],
  isDC: boolean,
  envOrOpenAir: WireEnvironment | boolean
): WireRun {
  // Resolve environment
  const environment: WireEnvironment =
    typeof envOrOpenAir === 'boolean'
      ? (envOrOpenAir ? 'OPEN_AIR' : 'RACEWAY')
      : envOrOpenAir;
  const isOpenAir = environment === 'OPEN_AIR';
  const conductors: Conductor[] = [];

  if (isDC) {
    const gauge = run?.wireGauge ?? '#10 AWG';
    const ins   = run?.insulation ?? 'USE-2';
    // NEC 690.31: one DC_POS + one DC_NEG per string; all strings share one EGC (NEC 690.45)
    // conductorCount = stringCount * 2; derive stringCount from run data
    const strCount = run?.conductorCount ? Math.max(1, Math.floor(run.conductorCount / 2)) : 1;
    for (let _s = 0; _s < strCount; _s++) {
      conductors.push({ id: `${runId}_POS_${_s + 1}`, type: 'DC_POS', gauge, insulation: ins });
      conductors.push({ id: `${runId}_NEG_${_s + 1}`, type: 'DC_NEG', gauge, insulation: ins });
    }
    const egc = run?.egcGauge ?? '#10 AWG';
    conductors.push({ id: `${runId}_G`, type: 'G', gauge: egc, insulation: 'GRN' }); // shared EGC
  } else {
    const gauge = run?.wireGauge ?? '#10 AWG';
    const ins   = run?.insulation ?? 'THWN-2';
    conductors.push({ id: `${runId}_L1`, type: 'L1', gauge, insulation: ins });
    conductors.push({ id: `${runId}_L2`, type: 'L2', gauge, insulation: ins });
    if (run?.neutralRequired) {
      conductors.push({ id: `${runId}_N`, type: 'N', gauge, insulation: ins });
    }
    const egc = run?.egcGauge ?? '#10 AWG';
    conductors.push({ id: `${runId}_G`, type: 'G', gauge: egc, insulation: 'GRN' });
  }

  let conduitLabel = '';
  if (run?.conductorCallout) {
    const lines2 = run.conductorCallout.split('\n').filter((l: string) => l.trim());
    conduitLabel = lines2[lines2.length - 1] ?? '';
  } else if (fallbackLabel.length > 0) {
    conduitLabel = fallbackLabel[fallbackLabel.length - 1] ?? '';
  }

  if (typeof console !== 'undefined') {
    console.log(`[CONDUCTOR MAP BUILT] ${runId}: ${conductors.map(c => c.type).join(', ')}`);
    console.log(`[WIRE RUN CREATED] ${runId} from (${x1.toFixed(0)},${y1.toFixed(0)}) to (${x2.toFixed(0)},${y2.toFixed(0)})`);
  }

  // Phase 2: build formatted callout lines
  const calloutLines = formatCallout(run, fallbackLabel, isDC);

  const wireRun: WireRun = {
    id: runId,
    from: { x: x1, y: y1 },
    to:   { x: x2, y: y2 },
    conductors,
    environment,
    isOpenAir,
    conduitLabel,
    calloutLines,
  };
  return wireRun;
}

// ── Phase 4: renderWireRun ────────────────────────────────────────────────────
// THE CORE FIX: one SVG line per electrical conductor — no parallel duplication.
//
//  BEFORE (❌ OLD):
//    for (i = 0; i < wireCount; i++) drawParallelLine()
//
//  AFTER  (✅ NEW):
//    for each conductor in WireRun.conductors: drawSingleLine(conductor)
//
// Ground routed 6px below main bus Y for visual separation.
// Signal conductors get a slight vertical spread for readability (max ±4px).
function renderWireRun(
  wr: WireRun,
  labelLines: string[],
  opts: { above?: boolean } = {}
): string {
  const { from, to, conductors, isOpenAir } = wr;
  const env: WireEnvironment = wr.environment ?? (isOpenAir ? 'OPEN_AIR' : 'RACEWAY');
  const x1 = from.x, x2 = to.x, baseY = from.y;
  const cx = (x1 + x2) / 2;
  const above = opts.above ?? true;
  const parts: string[] = [];

  // ── One line per conductor TYPE (not per string).
  // DC:  DC_POS (solid red)  +  DC_NEG (solid blue)
  // AC:  L1 (solid)  +  L2 (solid)  +  N if present (solid)
  // GND: always dashed green, 6px below base
  const seenTypes = new Set<string>();
  const dedupedSig: typeof conductors = [];
  for (const c of conductors) {
    if (c.type !== 'G' && !seenTypes.has(c.type)) {
      seenTypes.add(c.type);
      dedupedSig.push(c);
    }
  }
  const hasGnd = conductors.some(c => c.type === 'G');

  // Vertical placement: 3px between signal lines, centered on baseY
  const sigCount  = dedupedSig.length;
  const sigSpread = (sigCount - 1) * 3;
  const sigTop    = baseY - sigSpread / 2;

  dedupedSig.forEach((conductor, i) => {
    const style = getConductorStyle(conductor.type, env);
    const cy = sigTop + i * 3;
    if (typeof console !== 'undefined') {
      console.log(`[RENDER LINE: ${conductor.type}] ${wr.id} y=${cy.toFixed(1)}`);
    }
    parts.push(ln(x1, cy, x2, cy, { stroke: style.stroke, sw: style.sw, dash: style.dash }));
  });

  // Ground — dashed green, 6px below base
  if (hasGnd) {
    const gndStyle = getConductorStyle('G', env);
    const gy = baseY + 6;
    if (typeof console !== 'undefined') {
      console.log(`[RENDER LINE: G] ${wr.id} y=${gy.toFixed(1)} (ground)`);
    }
    parts.push(ln(x1, gy, x2, gy, { stroke: gndStyle.stroke, sw: gndStyle.sw, dash: '4,3' }));
  }

  // ── Inline callout label centered on segment ──
  const activeLabels = (wr.calloutLines && wr.calloutLines.length > 0) ? wr.calloutLines : labelLines;
  if (activeLabels.length > 0) {
    const primaryColor = dedupedSig.length > 0
      ? getConductorStyle(dedupedSig[0].type, env).stroke
      : BLK;
    const lh = Math.round(F.seg * 1.35);
    const th = activeLabels.length * lh;
    const ty = above ? baseY - LABEL_OFFSET_ABOVE - th + lh : baseY + LABEL_OFFSET_BELOW;
    parts.push(tspan(cx, ty, activeLabels, { sz: F.seg, anc: 'middle', fill: primaryColor }));
  }

  return parts.join('');
}


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

  // [SLD MULTI-LINE SOURCE FIXED] — conductor-based rendering
  // wireSeg() is now a single-line helper (used for ground rail, stubs, equipment wires).
  // All main wiring segments use renderWireRun() via buildWireRun().
  // Phase 4: EXACTLY ONE LINE PER CONDUCTOR — no parallel duplication.
  parts.push(ln(x1, y, x2, y, {stroke:color, sw, dash}));

  // Inline label
  if (lines.length > 0) {
    const lh = Math.round(F.seg * 1.35);
    const th = lines.length * lh;
    const ty = above ? y - LABEL_OFFSET_ABOVE - th + lh : y + LABEL_OFFSET_BELOW;
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
): {svg:string; lx:number; rx:number; ty:number; by:number;
    feederOutX:number; feederOutY:number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['ac-combiner'] = 180×160
  const W2 = SLD_SYMBOL_MAP['ac-combiner'].width;   // 180
  const H2 = SLD_SYMBOL_MAP['ac-combiner'].height;  // 160
  console.log(`[SLD SYMBOL SIZE USED] ac-combiner: ${W2}×${H2}`);
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

  // SOT: feeder terminal via anchor 'out' (native 180, 80)
  const _cOutPt = getAnchorPoint('ac-combiner', 'out', cx, cy, W2, H2);
  const feederOutX = _cOutPt.x + 10;
  const feederOutY = _cOutPt.y;
  console.log(`[SLD ANCHOR CONNECTED] ac-combiner.out → feederOut (${feederOutX.toFixed(1)},${feederOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] ac-combiner.out → ac-disconnect`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10, ty:by2, by:by2+H2,
          feederOutX, feederOutY};
}

// ── AC Disconnect (internal structure) ───────────────────────────────────────
function renderDisco(
  cx: number, cy: number,
  ocpd: number, calloutN: number,
  fusedTapOcpd = false
): {svg:string; lx:number; rx:number;
    loadInX:number; loadInY:number; lineOutX:number; lineOutY:number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['ac-disconnect'] = 120×100
  const W2 = SLD_SYMBOL_MAP['ac-disconnect'].width;   // 120
  const H2 = SLD_SYMBOL_MAP['ac-disconnect'].height;  // 100
  console.log(`[SLD SYMBOL SIZE USED] ac-disconnect: ${W2}×${H2}`);
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

  // Labels below — a supply-side tap's disconnect IS the tap OCPD and must be
  // fused (NEC 705.11); load-side jobs keep the conventional non-fused disco.
  p.push(txt(cx, by2+H2+10, fusedTapOcpd ? `${ocpd}A FUSED — TAP OCPD` : `${ocpd}A NON-FUSED`, {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, by2+H2+19, fusedTapOcpd ? 'NEC 705.11(C), 690.14 — UTILITY ACCESSIBLE' : 'NEC 690.14 — UTILITY ACCESSIBLE', {sz:F.tiny, anc:'middle', italic:true}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  // SOT: terminals via anchors ac_in (0,50) left and ac_out (120,50) right
  const _dInPt  = getAnchorPoint('ac-disconnect', 'ac_in',  cx, cy, W2, H2);
  const _dOutPt = getAnchorPoint('ac-disconnect', 'ac_out', cx, cy, W2, H2);
  const loadInX  = _dInPt.x;
  const loadInY  = _dInPt.y;
  const lineOutX = _dOutPt.x;
  const lineOutY = _dOutPt.y;
  console.log(`[SLD ANCHOR CONNECTED] ac-disconnect: loadIn=(${loadInX.toFixed(1)},${loadInY.toFixed(1)}) lineOut=(${lineOutX.toFixed(1)},${lineOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] ac-disconnect.ac_out → msp`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          loadInX, loadInY, lineOutX, lineOutY};
}

// ── MSP Load-Side Tap (internal structure) ───────────────────────────────────
function renderMSPLoad(
  cx: number, cy: number,
  mainAmps: number, pvAmps: number, calloutN: number
): {svg:string; lx:number; rx:number;
    bkfdInX:number; bkfdInY:number; busOutX:number; busOutY:number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['msp'] = 160×180
  const W2 = SLD_SYMBOL_MAP['msp'].width;   // 160
  const H2 = SLD_SYMBOL_MAP['msp'].height;  // 180
  console.log(`[SLD SYMBOL SIZE USED] msp (load-side): ${W2}×${H2}`);
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

  // SOT: terminals via anchors solar_in (0,90) left and load_out (160,72) right
  const _mspInPt  = getAnchorPoint('msp', 'solar_in', cx, cy, W2, H2);
  const _mspOutPt = getAnchorPoint('msp', 'load_out',  cx, cy, W2, H2);
  const bkfdInX = _mspInPt.x;
  const bkfdInY = _mspInPt.y;
  const busOutX = _mspOutPt.x;
  const busOutY = _mspOutPt.y;
  console.log(`[SLD ANCHOR CONNECTED] msp.solar_in → bkfdIn (${bkfdInX.toFixed(1)},${bkfdInY.toFixed(1)})`);
  console.log(`[SLD ANCHOR CONNECTED] msp.load_out → busOut (${busOutX.toFixed(1)},${busOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] msp.load_out → utility-meter`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          bkfdInX, bkfdInY, busOutX, busOutY};
}

// ── MSP Supply-Side / Backfed (internal structure) ───────────────────────────
function renderMSPSupply(
  cx: number, cy: number,
  mainAmps: number, backfeedAmps: number,
  isSupply: boolean, calloutN: number
): {svg:string; lx:number; rx:number;
    bkfdInX:number; bkfdInY:number; busOutX:number; busOutY:number} {
  // SOT: symbol size from SLD_SYMBOL_MAP['msp'] = 160×180
  const W2 = SLD_SYMBOL_MAP['msp'].width;   // 160
  const H2 = SLD_SYMBOL_MAP['msp'].height;  // 180
  console.log(`[SLD SYMBOL SIZE USED] msp (supply-side): ${W2}×${H2}`);
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
    // Supply-side tap: lands on the SERVICE (line-side) conductors between the
    // meter and the MAIN breaker — never on the load-side bus. The old drawing
    // dropped the tap straight onto MAIN BUS (a load-side connection), which
    // contradicted every 'NEC 705.11' label on the sheet.
    const tapX = bx+28;
    const svcY = busY-18;              // service conductor run, above the bus
    const pvInY = by2+55;              // 'utility_in' anchor row — PV enters here
    const mainBkrX = bx+W2-20;         // main breaker position (drawn below)
    // Service conductors: main breaker LINE side up and across to the tap
    p.push(ln(mainBkrX, svcY, mainBkrX, busY-6, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(ln(tapX, svcY, mainBkrX, svcY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(txt((tapX+mainBkrX)/2, svcY-4, 'SERVICE (LINE) SIDE', {sz:4.5, anc:'middle', fill:SUPPLY_CLR}));
    // PV conductors (from the fused AC disconnect) enter left wall → tap point
    p.push(ln(bx, pvInY, tapX, pvInY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(ln(tapX, pvInY, tapX, svcY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(circ(tapX, svcY, 3, {fill:SUPPLY_CLR, stroke:SUPPLY_CLR, sw:0}));
    p.push(txt(tapX, svcY-8, 'TAP', {sz:5.5, anc:'middle', bold:true, fill:SUPPLY_CLR}));
    p.push(txt(cx, by2+H2+10, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
    p.push(txt(cx, by2+H2+19, 'SUPPLY SIDE TAP — LINE SIDE OF MAIN — NEC 705.11', {sz:F.tiny, anc:'middle', bold:true, fill:SUPPLY_CLR}));
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

  // SOT: terminals via anchors utility_in (0,55) left and load_out (160,72) right
  const _mspsInPt  = getAnchorPoint('msp', 'utility_in', cx, cy, W2, H2);
  const _mspsOutPt = getAnchorPoint('msp', 'load_out',   cx, cy, W2, H2);
  const bkfdInX = _mspsInPt.x;
  const bkfdInY = _mspsInPt.y;
  const busOutX = _mspsOutPt.x;
  const busOutY = _mspsOutPt.y;
  console.log(`[SLD ANCHOR CONNECTED] msp.utility_in → bkfdIn (${bkfdInX.toFixed(1)},${bkfdInY.toFixed(1)})`);
  console.log(`[SLD ANCHOR CONNECTED] msp.load_out → busOut (${busOutX.toFixed(1)},${busOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] msp.load_out → utility-meter`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          bkfdInX, bkfdInY, busOutX, busOutY};
}

// ── Main Render ──────────────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  // [SLD SYMBOLS V2 ACTIVE] — hybrid realism v3.0 cabinet symbols
  if (typeof console !== 'undefined') {
    console.log('[SLD SYMBOLS V2 ACTIVE] renderSLDProfessional — hybrid realism v3.0');
  }

  // [SLD INPUT TRUTH] canonical field dump at render entry
  // Every engineering accuracy bug should be traceable from this log first.
  console.log(
    '[SLD INPUT TRUTH]' +
    ' topology=' + (input.ecosystemTopology ?? input.topologyType ?? 'UNKNOWN') +
    ' selectedBrand=' + (input.selectedBrand ?? 'none') +
    ' inverterModel=' + (input.inverterModel ?? 'none') +
    ' integratedDcDisconnect=' + String(input.integratedDcDisconnect ?? false) +
    ' stringCount=' + String(input.totalStrings ?? 0) +
    ' modulesPerString=' + String(input.panelsPerString ?? 0) +
    ' optimizerQty=' + String(input.optimizerQty ?? 0) +
    ' dcConductorGauge=' + (input.dcWireGauge ?? 'none') +
    ' dcEgcGauge=' + (input.egcGauge ?? 'none') +
    ' dcRacewayType=' + (input.dcConduitType ?? 'none') +
    ' acConductorGauge=' + (input.acWireGauge ?? 'none') +
    ' acRequiresNeutral=' + String(input.acRequiresNeutral ?? 'NOT_SET') +
    ' interconnectionMethod=' + (input.interconnection ?? 'none') +
    ' mainBreakerA=' + String(input.mainPanelAmps ?? 0) +
    ' pvBreakerA=' + String(input.backfeedAmps ?? 0) +
    ' acOutputAmps=' + String(input.acOutputAmps ?? 0)
  );

  const parts: string[] = [];
  // Phase 3 — Topology contamination guard
  // ecosystemTopology is the canonical field (set by route.ts after sizingResult).
  // topologyType may be stale from body. We use ecosystemTopology when available.
  const _ecoTopo = input.ecosystemTopology ?? '';
  const _isOptimizerEco = _ecoTopo === 'optimizer';
  const _isMicroEco     = _ecoTopo === 'micro';
  const _rawIsMicro = input.topologyType === 'MICROINVERTER';
  const isMicro = _isMicroEco || (_rawIsMicro && !_isOptimizerEco);
  if (_isOptimizerEco && _rawIsMicro) {
    console.error('[SLD TOPOLOGY CONTAMINATION] ecosystemTopology=optimizer but topologyType=MICROINVERTER' +
      ' — micro path blocked, rendering optimizer_string. brand=' + (input.selectedBrand ?? 'unknown'));
  }
  // Instantiate overlap guard for this diagram — prevents parallel wires from overlapping
  const resolveSegY = makeOverlapGuard();

  const findRun = (id: string): RunSegment|undefined => input.runs?.find(r=>r.id===id);

  const roofRun       = findRun('ROOF_RUN');
  const branchRun     = findRun('BRANCH_RUN');
  // BUILD v24: Battery/BUI/Generator/ATS computed segments
  const batToBuiRun   = findRun('BATTERY_TO_BUI_RUN');
  const buiToMspRun   = findRun('BUI_TO_MSP_RUN');
  const genToAtsRun   = findRun('GENERATOR_TO_ATS_RUN');
  const atsToMspRun   = findRun('ATS_TO_MSP_RUN');
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
  // Phase 6: AC conductor count — US residential 120/240V split-phase.
  // Standard string/hybrid inverters output L1+L2+N (3 current-carrying + EGC = 4 total).
  // Source of truth: run data neutralRequired (set by computed-system.ts topology engine).
  // input.acRequiresNeutral is kept for edge-case override from route but no longer
  // hard-coded false based on acOutputVoltage===240 (that was incorrect for split-phase).
  // Default: true (split-phase is universal for US residential 240V systems).
  const _acNeutral: boolean =
    input.acRequiresNeutral !== undefined
      ? input.acRequiresNeutral
      : (acFeederRun?.neutralRequired ?? true);
  const _acConductorCount = _acNeutral ? 3 : 2;  // 3 = L1+L2+N; 2 = L1+L2 only (pure 240V no-neutral)
  const _acWireNum = resolvedAcWire.replace('#','').replace(' AWG','');
  const resolvedDcWire      = dcStringRun?.wireGauge   ?? input.dcWireGauge   ?? '#10 AWG';
  // EGC gauge: from engine (NEC 250.122) → input.egcGauge → run data → '#10 AWG' fallback
  const resolvedEgcGauge    = input.egcGauge
    ?? dcStringRun?.egcGauge
    ?? acFeederRun?.egcGauge
    ?? '#10 AWG';
  // Strip '#' and ' AWG' for inline display (e.g. '#10 AWG' → '10')
  const egcNum = resolvedEgcGauge.replace('#', '').replace(' AWG', '').trim();

  const intercon     = String(input.interconnection ?? '').toLowerCase();
  const isLoadSide   = intercon.includes('load');
  const isSupplySide = intercon.includes('supply') || intercon.includes('line');
  const isBackfed    = !isLoadSide && !isSupplySide;
  const pvBreakerAmps = input.backfeedAmps ?? resolvedAcOCPD;

  // ── SVG root ──────────────────────────────────────────────────────────────
  // Embedded mode crops the viewBox at the title-block column so the diagram
  // fills the sheet instead of reserving a blank right margin.
  const effW = input.suppressTitleBlock ? TB_X - 10 : W;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${effW}" height="${H}" viewBox="0 0 ${effW} ${H}" style="background:${WHT};">`);
  parts.push(rect(0, 0, effW, H, {fill:WHT, stroke:WHT, sw:0}));
  parts.push(rect(MAR/2, MAR/2, effW-MAR, H-MAR, {fill:WHT, stroke:BLK, sw:SW_BORDER}));

  // ── Title ─────────────────────────────────────────────────────────────────
  const tcx = (DX + TB_X) / 2;
  parts.push(txt(tcx, DY+16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {sz:F.title, bold:true, anc:'middle'}));
  parts.push(txt(tcx, DY+26,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${Number(input.acOutputKw).toFixed(2)} kW AC`,
    {sz:F.sub, anc:'middle', fill:'#444'}));

  // ── Schematic border ──────────────────────────────────────────────────────
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));

  // ── X positions ───────────────────────────────────────────────────────────
  // ─── GRID LAYOUT ENGINE ──────────────────────────────────────────────────
  // Node center-to-center spacing = (leftW/2) + WIRE_GAP + (rightW/2)
  // WIRE_GAP = minimum horizontal space for wire segment + conductor callout label
  // This ensures equal visual wire segments regardless of equipment widths.
  const WIRE_GAP   = 120;  // px: min segment length (wire + label space)
  const LEFT_MARGIN = 60;  // px: left edge of drawing to first node center

  // Equipment widths from SLD_SYMBOL_MAP (frozen — do not hard-code inline)
  const W_PV    = SLD_SYMBOL_MAP['pv-array'].width;       // 200
  const W_JBOX  = SLD_SYMBOL_MAP['junction-box'].width;   // 100
  const W_INV   = SLD_SYMBOL_MAP['inverter'].width;       // 200
  const W_DCDS  = SLD_SYMBOL_MAP['dc-disconnect'].width;  // 120
  const W_ACDS  = SLD_SYMBOL_MAP['ac-disconnect'].width;  // 120
  const W_COMB  = SLD_SYMBOL_MAP['ac-combiner'].width;    // 180

  // Helper: next center X = current center + (currentW/2) + WIRE_GAP + (nextW/2)
  const nextCX = (cx: number, curW: number, nxtW: number, gap = WIRE_GAP) =>
    cx + curW/2 + gap + nxtW/2;

  let xPV: number, xJBox: number, xComb: number, xDisco: number, xMSP: number, xUtil: number;
  let xInv = 0;

  // v58.11: When the system has a battery, reserve a grid slot for the Backup
  // Interface Unit (BUI) between MSP and the Utility Meter. BUI width = 180px
  // (SLD_SYMBOL_MAP['bui-enphase']). Without this, the BUI was shoe-horned at
  // xMSP + 130, overlapping both the MSP (40px) and the meter (20px).
  const W_BUI = SLD_SYMBOL_MAP['bui-enphase'].width;  // 180
  const _hasBUI = !!input.hasBattery;

  if (isMicro) {
    // Micro path: PV -> J-Box -> Combiner -> AC Disco -> MSP -> [BUI?] -> Utility
    xPV   = SCH_X + LEFT_MARGIN + W_PV/2;
    xJBox = nextCX(xPV,   W_PV,  W_JBOX);
    xComb = nextCX(xJBox, W_JBOX, W_COMB);
    xDisco= nextCX(xComb, W_COMB, W_ACDS);
    xMSP  = nextCX(xDisco, W_ACDS, 160);   // MSP width=160
    xUtil = _hasBUI
      ? nextCX(nextCX(xMSP, 160, W_BUI), W_BUI, 120)  // MSP -> BUI -> Utility
      : nextCX(xMSP, 160, 120);
  } else {
    // String/Optimizer path: PV -> J-Box -> [DC Disco] -> Inverter -> AC Disco -> MSP -> [BUI?] -> Utility
    xPV   = SCH_X + LEFT_MARGIN + W_PV/2;
    xJBox = nextCX(xPV,   W_PV,  W_JBOX);
    if (input.integratedDcDisconnect) {
      // No external DC disco - wire goes directly J-Box -> Inverter
      xComb = xJBox;  // unused but keep for ground rail code
      xInv  = nextCX(xJBox, W_JBOX, W_INV);
    } else {
      xComb = nextCX(xJBox, W_JBOX, W_DCDS);
      xInv  = nextCX(xComb, W_DCDS, W_INV);
    }
    xDisco= nextCX(xInv,  W_INV,  W_ACDS);
    xMSP  = nextCX(xDisco, W_ACDS, 160);
    xUtil = _hasBUI
      ? nextCX(nextCX(xMSP, 160, W_BUI), W_BUI, 120)  // MSP -> BUI -> Utility
      : nextCX(xMSP, 160, 120);
  }

  // BUI center X: when hasBattery is true, sits between MSP and Utility with
  // full WIRE_GAP (120px) clearance on each side. Otherwise unused.
  const xBUI = _hasBUI ? nextCX(xMSP, 160, W_BUI) : (xMSP + 130);

  // ── NODE 1: PV ARRAY (or SOLAR FENCE for a SolFence vertical array) ─────────
  const isFence = input.systemType === 'fence';
  const pvSymbolId = isFence ? 'pv-fence' : 'pv-array';
  // PV array symbol size — use grid engine constants (W_PV already defined)
  const pvW = W_PV;  // 200 — from grid engine
  const pvH = SLD_SYMBOL_MAP[pvSymbolId].height;  // 160
  console.log(`[SLD SYMBOL SIZE USED] ${pvSymbolId}: ${pvW}×${pvH}`);
  const pvCX = xPV, pvCY = BUS_Y;

  // PV array: embed sld-symbols.ts hybrid realism emblem (fence → vertical bifacial glyph)
  parts.push(embedSymbol(pvSymbolId, pvCX, pvCY, pvW, pvH));
  parts.push(txt(pvCX, pvCY-pvH/2-18, isFence ? 'SOLAR FENCE ARRAY' : 'PV ARRAY', {sz:F.hdr, bold:true, anc:'middle'}));
  parts.push(txt(pvCX, pvCY-pvH/2-8, `${input.totalModules} × ${input.panelWatts}W`, {sz:F.sub, anc:'middle'}));
  parts.push(txt(pvCX, pvCY+pvH/2+9, esc(input.panelModel), {sz:F.tiny, anc:'middle', italic:true}));
  // Phase 4: PV Array callout — complete engineering truth
  // For micro: show device count and model
  // For string/optimizer: show module count + string layout + optimizer count
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    parts.push(txt(pvCX, pvCY+pvH/2+18, `${md} × ${esc(input.inverterModel)}`, {sz:F.tiny, anc:'middle'}));
  } else {
    const _ns  = input.totalStrings || 1;
    const _pps = input.panelsPerString ?? Math.round(input.totalModules / Math.max(_ns, 1));
    const _sVoc = input.stringVoc ?? ((input.vocCorrected ?? input.panelVoc) * _pps);
    const _sIsc = input.stringIsc ?? input.panelIsc;
    // Line 1: string layout (e.g. "3 STRINGS × 12 MODULES")
    parts.push(txt(pvCX, pvCY+pvH/2+18, `${_ns} STRING${_ns>1?'S':''} × ${_pps} MODULES`, {sz:F.tiny, anc:'middle', bold:true}));
    // Line 2: electrical parameters
    parts.push(txt(pvCX, pvCY+pvH/2+27, `Voc=${_sVoc.toFixed(1)}V  Isc=${_sIsc.toFixed(2)}A`, {sz:F.tiny, anc:'middle', fill:'#B71C1C'}));
    console.log(`[SLD STRING SUMMARY] ${_ns} strings × ${_pps} modules, Voc=${_sVoc.toFixed(1)}V, Isc=${_sIsc.toFixed(2)}A`);
    // Phase 4: Optimizer callout — show full info when optimizer topology
    if (input.optimizerQty && input.optimizerQty > 0) {
      const _optModel = input.optimizerModel ? ` (${input.optimizerModel})` : '';
      // Full optimizer label: count + per-module note + model
      const _optLabel = `${input.optimizerQty} DC OPTIMIZERS — 1 PER MODULE${_optModel}`;
      const _topoLabel = 'TOPOLOGY: STRING + OPTIMIZER';
      parts.push(txt(pvCX, pvCY+pvH/2+38, _optLabel, {sz:F.tiny, anc:'middle', fill:'#1A237E', bold:true}));
      parts.push(txt(pvCX, pvCY+pvH/2+47, _topoLabel, {sz:F.tiny, anc:'middle', fill:'#1A237E'}));
      console.log(`[SLD OPTIMIZER CALLOUT] qty=${input.optimizerQty} model=${input.optimizerModel ?? 'unknown'}`);
    }
  }
  parts.push(callout(pvCX+pvW/2+14, pvCY-pvH/2-5, 1));
  // SOT: pvOutX via anchor 'dc_pos' (native x=200, right side)
  const _pvPt = getAnchorPoint(pvSymbolId, 'dc_pos', pvCX, pvCY, pvW, pvH);
  const pvOutX = _pvPt.x;
  const pvOutY = _pvPt.y;
  console.log(`[SLD ANCHOR CONNECTED] pv-array.dc_pos → pvOut (${pvOutX.toFixed(1)},${pvOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: DC] pv-array.dc_pos → junction-box`);

  // ── NODE 2: ROOF J-BOX ────────────────────────────────────────────────────
  // J-box symbol size — use grid engine constant
  const jbW = W_JBOX;  // 100 — from grid engine
  const jbH = SLD_SYMBOL_MAP['junction-box'].height;  // 100
  console.log(`[SLD SYMBOL SIZE USED] junction-box: ${jbW}×${jbH}`);
  const jbCX = xJBox, jbCY = BUS_Y;

  // Embed junction-box emblem (replaces raw rect+cross)
  parts.push(embedSymbol('junction-box', jbCX, jbCY, jbW, jbH));

  // SOT: jbox terminals via anchors 'left' (0,50) and 'right' (100,50)
  const _jbInPt  = getAnchorPoint('junction-box', 'left',  jbCX, jbCY, jbW, jbH);
  const _jbOutPt = getAnchorPoint('junction-box', 'right', jbCX, jbCY, jbW, jbH);
  console.log(`[SLD ANCHOR CONNECTED] junction-box.left/right → (${_jbInPt.x.toFixed(1)},${_jbInPt.y.toFixed(1)})/(${_jbOutPt.x.toFixed(1)},${_jbOutPt.y.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: DC] pv-array → junction-box.left`);
  console.log(`[SLD WIRE TYPE: DC] junction-box.right → dc-disconnect`);
  parts.push(txt(jbCX, jbCY-jbH/2-15, isFence ? 'FENCE J-BOX' : 'ROOF J-BOX', {sz:F.sub, bold:true, anc:'middle'}));
  parts.push(txt(jbCX, jbCY-jbH/2-7, isMicro?'AC JUNCTION':'DC JUNCTION', {sz:F.tiny, anc:'middle'}));
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? microBranchCount(md, input.inverterModel);
    const bocpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    parts.push(txt(jbCX, jbCY+jbH/2+9, `${nb} branches`, {sz:F.tiny, anc:'middle'}));
    parts.push(txt(jbCX, jbCY+jbH/2+18, `${bocpd}A OCPD ea.`, {sz:F.tiny, anc:'middle'}));
  } else {
    // String count placed to the left of J-box above wire entry to avoid overlapping ground drop
    parts.push(txt(jbCX-jbW/2-5, jbCY-8, `${input.totalStrings||1}`, {sz:F.sub, bold:true, anc:'end', fill:'#1565C0'}));
    parts.push(txt(jbCX-jbW/2-5, jbCY+4, 'STRINGS', {sz:F.tiny, anc:'end', fill:'#1565C0'}));
  }
  parts.push(callout(jbCX+jbW/2+12, jbCY-jbH/2-5, 2));

  // SEGMENT 1: PV → J-Box (open air)
  {
    const run = isMicro ? roofRun : dcStringRun;
    const fb = isMicro
      ? [`ENPHASE Q CABLE (TC-ER)`, `1×#${egcNum} GRN EGC`, 'OPEN AIR — NEC 690.31(C)']
      : [`${resolvedDcWire} USE-2/PV Wire`, `1×#${egcNum} GRN EGC`, 'OPEN AIR — NEC 690.31'];
    const {lines, cnt} = runLines(run, fb);
    const _s1Y = resolveSegY(pvOutX, jbCX-jbW/2, BUS_Y);
    console.log('[WIRE RUN CREATED] SEGMENT_1_PV_TO_JBOX: DC open-air');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_1_PV_TO_JBOX', pvOutX, _s1Y, _jbInPt.x, _s1Y, run, lines, true, 'OPEN_AIR'),  // Phase 1: OPEN_AIR — roof surface wiring
      lines));
  }

  // ── NODE 3: AC COMBINER (micro) or DC DISCONNECT (string) ─────────────────
  let node3RX: number;

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? microBranchCount(md, input.inverterModel);
    const bocpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    const clabel = input.combinerLabel ?? `${input.inverterManufacturer} IQ Combiner`;
    const cr = renderCombiner(xComb, BUS_Y, nb, bocpd, clabel, 3);
    parts.push(cr.svg);
    node3RX = cr.feederOutX;  // Use feeder output terminal X as the right-side connection point
    parts.push(txt(xComb, cr.ty-8, 'AC COMBINER', {sz:F.hdr, bold:true, anc:'middle'}));

    // SEGMENT 2: J-Box → Combiner
    {
      const run = branchRun;
      const fb = [`${input.branchWireGauge??'#10 AWG'} THWN-2`, `1×#${egcNum} GRN EGC`, `IN ${input.branchConduitSize??'3/4"'} EMT`];
      const {lines, cnt} = runLines(run, fb);
      const _s2aY = resolveSegY(jbCX+jbW/2, cr.lx, BUS_Y);
      console.log('[WIRE RUN CREATED] SEGMENT_2A_JBOX_TO_COMBINER: AC branch');
      parts.push(renderWireRun(
        buildWireRun('SEGMENT_2A_JBOX_TO_COMBINER', _jbOutPt.x, _s2aY, cr.lx, _s2aY, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY — post-jbox
        lines));
    }
  } else if (input.integratedDcDisconnect) {
    // Phase 5: Integrated DC disconnect — skip external node, wire J-Box → Inverter directly
    console.log('[SLD DEVICE OMITTED] external_dc_disconnect reason=integrated_inverter_disconnect brand=' + (input.selectedBrand ?? 'unknown'));
    // SEG 2D: J-Box → Inverter direct (no external DC disco)
    // Phase 2 fix: post-JBOX wire is in RACEWAY — use dcDiscoInvRun (DC_DISCO_TO_INV_RUN)
    // DC_DISCO_TO_INV_RUN has isOpenAir=false, insulation='THWN-2', conductorCount=stringCount*2
    // Do NOT use dcStringRun here (isOpenAir=true → would show OPEN AIR label incorrectly)
    {
      const run = dcDiscoInvRun ?? dcStringRun;  // Phase 2: prefer DC_DISCO_TO_INV_RUN (in-raceway)
      const _strCnt = run?.conductorCount
        ? Math.max(1, Math.floor(run.conductorCount / 2))
        : (input.totalStrings || 1);
      const _dcWireNum = (run?.wireGauge ?? resolvedDcWire).replace('#','').replace(' AWG','');
      const fb = [`${_strCnt*2}#${_dcWireNum} THWN-2`, `+ #${egcNum} EGC`, `IN ${input.dcConduitType??'EMT'}`];
      const {lines} = runLines(run, fb);
      const _s2dInvX = xInv - 60;  // invBox not yet defined here; use xInv offset
      node3RX = _s2dInvX;            // Phase 5: set node3RX for downstream code
      const _s2dY = resolveSegY(_jbOutPt.x, _s2dInvX, BUS_Y);
      parts.push(renderWireRun(
        buildWireRun('SEGMENT_2D_JBOX_TO_INV_DIRECT', _jbOutPt.x, _s2dY, _s2dInvX, _s2dY, run, lines, true, 'RACEWAY'),
        lines));
    }
  } else {
    // DC DISCONNECT with fuse symbols
    // SOT: symbol size from SLD_SYMBOL_MAP['dc-disconnect'] = 120×100
    const dW = SLD_SYMBOL_MAP['dc-disconnect'].width;   // 120
    const dH = SLD_SYMBOL_MAP['dc-disconnect'].height;  // 100
    console.log(`[SLD SYMBOL SIZE USED] dc-disconnect: ${dW}×${dH}`);
    const dcX = xComb, dcY = BUS_Y;
    // Embed dc-disconnect symbol (replaces raw rect rendering)
    parts.push(embedSymbol('dc-disconnect', dcX, dcY, dW, dH));
    parts.push(txt(dcX, dcY-dH/2-8, 'DC DISCONNECT', {sz:5.5, bold:true, anc:'middle'}));
    // Line lugs
    // SOT: internal wiring handled by dc-disconnect emblem
    // SOT: dc-disconnect emblem handles all internal rendering (fuses/lugs/wires removed)
    parts.push(txt(dcX, dcY-dH/2-15, '(N) DC DISCONNECT', {sz:F.sub, bold:true, anc:'middle'}));
    parts.push(txt(dcX, dcY+dH/2+9, `${input.dcOCPD}A FUSED`, {sz:F.tiny, anc:'middle'}));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcX, dcY+dH/2+18, 'RAPID SHUTDOWN — NEC 690.12', {sz:F.tiny, anc:'middle', italic:true}));
    }
    parts.push(callout(dcX+dW/2-4, dcY-dH/2-5, 3));
    // SOT: dc-disconnect terminals via anchors 'dc_in' and 'dc_out'
    const _dcInPt  = getAnchorPoint('dc-disconnect', 'dc_in',  dcX, dcY, dW, dH);
    const _dcOutPt = getAnchorPoint('dc-disconnect', 'dc_out', dcX, dcY, dW, dH);
    node3RX = _dcOutPt.x;
    console.log(`[SLD ANCHOR CONNECTED] dc-disconnect.dc_out → node3RX (${node3RX.toFixed(1)})`);
    console.log(`[SLD WIRE TYPE: DC] dc-disconnect → inverter`);

    // SEGMENT 2: J-Box → DC Disco
    // Phase 2 fix: post-JBOX wire is in RACEWAY — use dcDiscoInvRun (DC_DISCO_TO_INV_RUN)
    // DC_DISCO_TO_INV_RUN: isOpenAir=false, insulation=THWN-2, conductorCount=stringCount*2
    {
      const run = dcDiscoInvRun ?? dcStringRun;  // Phase 2: prefer DC_DISCO_TO_INV_RUN (in-raceway)
      // Phase 3: conductor count from run data (stringCount*2) or fallback from totalStrings
      const _s2bStrCnt = run?.conductorCount
        ? Math.max(1, Math.floor(run.conductorCount / 2))
        : (input.totalStrings || 1);
      const _s2bWireNum = (run?.wireGauge ?? resolvedDcWire).replace('#','').replace(' AWG','');
      const fb = [`${_s2bStrCnt*2}#${_s2bWireNum} THWN-2`, `+ #${egcNum} EGC`, `IN ${input.dcConduitType??'EMT'}`];
      const {lines, cnt} = runLines(run, fb);
      const _s2bY = resolveSegY(_jbOutPt.x, _dcInPt.x, BUS_Y);  // SOT: anchor coords
      console.log('[WIRE RUN CREATED] SEGMENT_2B_JBOX_TO_DCDISCO: DC raceway THWN-2 strCnt=' + _s2bStrCnt);
      parts.push(renderWireRun(
        buildWireRun('SEGMENT_2B_JBOX_TO_DCDISCO', _jbOutPt.x, _s2bY, _dcInPt.x, _s2bY, run, lines, true, 'RACEWAY'),  // Phase 2: RACEWAY — conduit from jbox
        lines));
    }
  }

  // ── NODE 4: INVERTER (string only) ────────────────────────────────────────
  let invRX = node3RX;

  if (!isMicro) {
    const invCX = xInv, invCY = BUS_Y;
    const tl = (input.ecosystemTopology === 'optimizer' || input.topologyType === 'STRING_WITH_OPTIMIZER' || input.topologyType === 'OPTIMIZER')
      ? 'STRING + OPTIMIZER'
      : 'STRING INVERTER';
    const invBox = renderInverterBox(
      invCX, invCY,
      input.inverterManufacturer, input.inverterModel,
      input.acOutputKw, input.acOutputAmps,
      tl, input.mpptAllocation ?? '',
      4
    );
    parts.push(invBox.svg);
    invRX = invBox.acOutX;  // Use AC output terminal X as the right-side connection point

    // SEGMENT 3: DC Disco LOAD terminal → Inverter DC_IN terminal
    // Phase 5: skip SEGMENT_3 when integratedDcDisconnect (SEG_2D already drew JBOX→INV)
    if (!input.integratedDcDisconnect) {
      // SEGMENT_3 only runs when there IS an external DC disco
      {
        const run = dcDiscoInvRun ?? dcStringRun;
        // Phase 4/6: DC Disco→Inv is in conduit (RACEWAY) — THWN-2
        const _s3StrCnt = input.totalStrings || 1;
        const _s3WireNum = resolvedDcWire.replace('#','').replace(' AWG','');
        const fb = [`${_s3StrCnt*2}#${_s3WireNum} THWN-2`, `+ #${egcNum} EGC`, `IN ${input.dcConduitType??'EMT'}`];
        const {lines: s3lines, cnt: s3cnt} = runLines(run, fb);
        // Use inverter dcInX/Y terminal for precise routing
        const segY = invBox.dcInY;
        const _s3Y = resolveSegY(node3RX, invBox.dcInX, segY);
        console.log('[WIRE RUN CREATED] SEGMENT_3_DCDISCO_TO_INV: DC run');
        parts.push(renderWireRun(
          buildWireRun('SEGMENT_3_DCDISCO_TO_INV', node3RX, _s3Y, invBox.dcInX, _s3Y, run, s3lines, true, 'RACEWAY'),  // Phase 1: RACEWAY
          s3lines));
      }
    } // end !integratedDcDisconnect
  }

  // ── NODE 5: AC DISCONNECT ─────────────────────────────────────────────────
  const discoResult = renderDisco(xDisco, BUS_Y, resolvedAcOCPD, isMicro?4:5, isSupplySide);
  parts.push(discoResult.svg);
  // BUS_Y-58 sits ABOVE the enclosure — at BUS_Y-40 this landed exactly on
  // renderDisco's internal "AC DISCONNECT" header strip and the two texts
  // printed on top of each other (the garbled label on E-1).
  parts.push(txt(xDisco, BUS_Y-58, '(N) AC DISCONNECT', {sz:F.hdr, bold:true, anc:'middle'}));

  // SEGMENT: Combiner/Inverter → AC Disco (terminal-to-terminal routing)
  // Source: combiner feederOutX/Y (micro) or inverter acOutX/Y (string)
  // Dest:   discoResult.loadInX/Y
  {
    const run = isMicro ? combDiscoRun : invDiscoRun;
    // Phase 6: conductor count from acRequiresNeutral (2 for 240V no-neutral, 3 if neutral)
    const fb = [
      `${_acConductorCount}#${_acWireNum} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    // Route from source right edge to disco LOAD terminal using terminal Y coordinate
    const segY = discoResult.loadInY;  // disco loadIn is at BUS_Y center
    const _s4Y = resolveSegY(invRX, discoResult.loadInX, segY);
    console.log('[WIRE RUN CREATED] SEGMENT_4_INV_TO_ACDISCO: AC feeder');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_4_INV_TO_ACDISCO', invRX, _s4Y, discoResult.loadInX, _s4Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY
      lines));
  }

  // ── NODE 6: MSP ───────────────────────────────────────────────────────────
  let mspRX: number;
  let mspBusY = BUS_Y;
  let buiRX: number; // right edge of BUI (or MSP if no battery) // Y of MSP output wire (main bus level)
  // buiResult is hoisted so the generator section (outside battery block) can access BUI terminal coords
  let buiResult: ReturnType<typeof renderBUI> | undefined;
  // mspResult holds terminal coordinates for both MSPLoad and MSPSupply (same interface)
  let mspResult: {svg:string; lx:number; rx:number; bkfdInX:number; bkfdInY:number; busOutX:number; busOutY:number};

  if (isLoadSide) {
    const r = renderMSPLoad(xMSP, BUS_Y, input.mainPanelAmps, pvBreakerAmps, isMicro?5:6);
    parts.push(r.svg);
    mspRX = r.rx;
    mspResult = r;
    // MSP output is at main bus Y (offset from BUS_Y)
    const mbY = (BUS_Y - 60/2) + 28 + 20; // busY inside MSP
    mspBusY = mbY;
  } else {
    const r = renderMSPSupply(xMSP, BUS_Y, input.mainPanelAmps, input.backfeedAmps, isSupplySide, isMicro?5:6);
    parts.push(r.svg);
    mspRX = r.rx;
    mspResult = r;
    mspBusY = (BUS_Y - 55/2) + 38; // busY inside MSP
  }

  // SEGMENT: AC Disco LINE terminal → MSP backfed breaker terminal (terminal-to-terminal routing)
  // Source: discoResult.lineOutX/Y  Dest: mspResult.bkfdInX/Y
  buiRX = mspRX; // default: no BUI, wire goes directly to meter
  {
    const run = discoMspRun;
    // Phase 6: conductor count from acRequiresNeutral
    const fb = [
      `${_acConductorCount}#${_acWireNum} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    // Use disco lineOut terminal Y and MSP bkfdIn terminal Y (both at BUS_Y center)
    const segY = discoResult.lineOutY;
    const _s5Y = resolveSegY(discoResult.lineOutX, mspResult.bkfdInX, segY);
    console.log('[WIRE RUN CREATED] SEGMENT_5_ACDISCO_TO_MSP: AC feeder');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_5_ACDISCO_TO_MSP', discoResult.lineOutX, _s5Y, mspResult.bkfdInX, _s5Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY
      lines));
  }


  // ─── NODE 8: BUI + BATTERY (if battery configured) ───────────────────────
  // BUI (Enphase IQ SC3 / Tesla Gateway / generic) placed RIGHT of MSP
  // Battery connects to BUI battery port — NOT directly to MSP bus
  // Backfeed breaker at MSP connects MSP bus to BUI grid port
  buiRX = mspRX;
  // Phase 4: Battery guard — hasBattery is the authoritative flag.
  // batteryModel may be '' when only batteryBrand/batteryKwh are provided.
  // Build a display model string so the render path always has something to show.
  const _batDisplayModel = input.batteryModel
    || (input.batteryKwh && input.batteryKwh > 0
        ? `${input.batteryKwh} kWh Battery`
        : 'BATTERY STORAGE');
  if (!input.hasBattery) {
    console.log('[SLD BATTERY MISSING AT STAGE RENDERER] hasBattery=false — battery not rendered');
  }
  if (input.hasBattery) {
    // Derive a normalised BUI brand key (mirrors normalizeDeviceBrandKey).
    // Priority: explicit backupInterfaceBrand > inverter manufacturer > battery model sniff.
    const _normBuiKey = (s?: string) =>
      (s ?? '').toLowerCase().replace(/[\u00ae\u2122\u00a9]/g, '').replace(/[\s\-_.]+/g, '').trim();
    const _buiBrandFromInput: string = (() => {
      if (input.backupInterfaceBrand) return _normBuiKey(input.backupInterfaceBrand);
      // Infer from inverter brand (Enphase micro system → IQ SC3; Tesla → Gateway 2)
      const invKey = _normBuiKey(input.inverterManufacturer);
      if (invKey === 'enphase') return 'enphase';
      if (invKey === 'tesla')   return 'tesla';
      // Infer from battery model string as last resort
      const batM = (input.batteryModel ?? '').toLowerCase();
      if (batM.includes('enphase') || batM.includes('iq battery')) return 'enphase';
      if (batM.includes('powerwall'))                               return 'tesla';
      if (batM.includes('ecoflow') || batM.includes('ocean'))       return 'ecoflow';
      if (batM.includes('solaredge') || batM.includes('energy bank')) return 'solaredge';
      if (batM.includes('generac') || batM.includes('pwrcell'))     return 'generac';
      if (batM.includes('sol-ark') || batM.includes('solark'))      return 'solark';
      if (batM.includes('growatt') || batM.includes('ark lv'))      return 'growatt';
      return '';
    })();
    // Legacy compat flags (used by backupPanelBrand fallback below)
    const isEnphase = _buiBrandFromInput === 'enphase';
    const isTesla   = _buiBrandFromInput === 'tesla';

    // BUI positioned right of MSP, on the main bus line.
    // v58.11: Use grid-computed xBUI (full WIRE_GAP clearance on each side)
    // instead of the old hard-coded xMSP + 130 which overlapped MSP and meter.
    const buiCX = xBUI;
    const buiCY = BUS_Y;
    const buiAmpRating = input.atsAmpRating ?? 200;
    buiResult = renderBUI(
      buiCX, buiCY,
      input.backupInterfaceBrand ?? '',
      input.backupInterfaceModel ?? '',
      buiAmpRating,
      _buiBrandFromInput,
      (input.generatorKw ?? 0) > 0,
      isMicro ? 7 : 8
    );
    parts.push(buiResult.svg);
    buiRX = buiResult.rx;

    // Wire: MSP busOut terminal → BUI GRID terminal (L-route)
    // MSP busOut is at mspResult.busOutX/Y (anchor 'load_out' on MSP symbol).
    // BUI GRID port is at buiResult.gridPortX/Y (left-edge lug, cy-14).
    // Route: horizontal from busOut rightward to BUI left edge X, then
    // vertical stub to match gridPortY if the two Ys differ.
    const _mspToBuiX = buiResult.gridPortX;  // left edge of BUI
    // Horizontal segment at MSP busOut Y level
    parts.push(ln(mspResult.busOutX, mspResult.busOutY, _mspToBuiX, mspResult.busOutY, {stroke: BLK, sw: SW_MED}));
    // Vertical jog from busOutY down/up to BUI gridPortY (always draw — tiny if same)
    if (Math.abs(mspResult.busOutY - buiResult.gridPortY) > 1) {
      parts.push(ln(_mspToBuiX, mspResult.busOutY, _mspToBuiX, buiResult.gridPortY, {stroke: BLK, sw: SW_MED}));
    }
    // Final horizontal stub into BUI GRID lug (gridPortX is already the left edge lug)
    // The lug itself is drawn inside renderBUI; we just need to terminate at it.

    // Backfeed breaker at MSP for battery (NEC 705.12(B))
    const bfA = input.batteryBackfeedA ?? 20;
    const bfX = xMSP + 30;
    parts.push(breakerSymbol(bfX, BUS_Y + 30, 20, 12, bfA));
    parts.push(ln(bfX, BUS_Y, bfX, BUS_Y + 24, {sw: SW_THIN, stroke: '#1565C0'}));
    parts.push(txt(bfX, BUS_Y + 48, `${bfA}A BATT`, {sz: 5, anc: 'middle', bold: true, fill: '#1565C0'}));
    parts.push(txt(bfX, BUS_Y + 56, 'NEC 705.12(B)', {sz: 4.5, anc: 'middle', italic: true, fill: '#1565C0'}));

    // Battery symbol — above BUI, connected to BUI battery port
    //
    // v58.9 LAYOUT FIX: Battery was visually overlapping the MSP top-right corner
    // and the BUI box. Symbol heights:
    //   MSP:     160 x 180 (top edge at BUS_Y - 90)
    //   BUI:     180 x 130 (top edge at BUS_Y - 65)
    //   Battery: 180 x 170 (half-height 85)
    //
    // Previous batCY = BUS_Y - 120 put the battery bottom at BUS_Y - 35,
    //   -> 55px INSIDE the MSP and 30px INSIDE the BUI (vertical overlap).
    //
    // New batCY = BUS_Y - 200 puts the battery bottom at BUS_Y - 115,
    //   -> 25px ABOVE the MSP top (clean gap), 50px ABOVE the BUI top.
    // Wire from battery.ac_out drops straight down to BUI.batPort as before.
    const batCX = buiCX;
    const batCY = BUS_Y - 200;
    // Phase 4: Use _batDisplayModel (never empty)
    console.log(`[SLD BATTERY RENDERED] hasBattery=true, model='${_batDisplayModel}', kwh=${input.batteryKwh ?? 0}`);
    const batResult = renderBattery(
      batCX, batCY,
      _batDisplayModel,
      input.batteryKwh ?? 0,
      input.batteryBackfeedA ?? 0,
      isMicro ? 8 : 9,
      input.batteryBrand ?? '',
      input.batteryKwhLabel ?? ''
    );
    parts.push(batResult.svg);

    // Wire: battery bottom-centre AC OUT → BUI BATTERY port
    // Both share the same centre X (batCX == buiCX) so this is a clean
    // vertical dashed line straight down.
    parts.push(ln(batResult.acOutX, batResult.acOutY, buiResult.batPortX, buiResult.batPortY, {stroke: '#1565C0', sw: SW_MED, dash: '6,3'}));
    // Wire callout — placed to the right of the vertical wire at mid-height
    const batWireGauge = batToBuiRun?.wireGauge
      ? `${batToBuiRun.wireGauge} THWN-2`
      : (bfA <= 20 ? '#12 AWG THWN-2' : bfA <= 30 ? '#10 AWG THWN-2' : '#8 AWG THWN-2');
    const batCalloutLines = batToBuiRun?.conductorCallout
      ? batToBuiRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
      : [batWireGauge, `${bfA}A CIRCUIT`];
    const _batWireMidY = (batResult.acOutY + buiResult.batPortY) / 2;
    parts.push(tspan(batResult.acOutX + 6, _batWireMidY,
      batCalloutLines,
      {sz: F.tiny, anc: 'start', fill: '#1565C0'}));

    // Backup sub-panel — connected to BUI load port (right side)
    if (input.hasBackupPanel) {
      const bpCX = buiResult.loadPortX + 80;
      const bpCY = BUS_Y + 100;
      const bpResult = renderBackupPanel(
        bpCX, bpCY,
        input.backupPanelBrand ?? (isEnphase ? 'Enphase' : ''),
        input.backupPanelAmps ?? 100,
        isMicro ? 9 : 10
      );
      parts.push(bpResult.svg);
      // Wire: BUI load port → backup panel (L-shaped route)
      parts.push(ln(buiResult.loadPortX, buiResult.loadPortY, bpCX - 40, buiResult.loadPortY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpCX - 40, buiResult.loadPortY, bpCX - 40, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpCX - 40, bpCY, bpResult.lx, bpCY, {stroke: '#6A1B9A', sw: SW_MED}));
      // BUILD v24: Use computed BUI_TO_MSP_RUN conductorCallout for backup panel feeder
      const bpCalloutLines = buiToMspRun?.conductorCallout
        ? buiToMspRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : ['#6 AWG THWN-2', 'CRITICAL LOADS'];
      parts.push(tspan(bpCX - 40 + 6, bpCY - 10, bpCalloutLines, {sz: F.tiny, anc: 'start', fill: '#6A1B9A'}));
    }
  }

  // ─── NODE 9: GENERATOR + ATS/BUI GEN PORT (if configured) ──────────────────
  // BUILD v24: Two routing modes:
  //   A) hasEnphaseIQSC3 = true  → Generator connects to BUI GEN port (IQ SC3 IS the ATS)
  //      No standalone ATS rendered. NEC 702.5 transfer function is inside IQ SC3.
  //   B) hasEnphaseIQSC3 = false → Standalone ATS between utility and MSP (legacy topology)
  //      Generator → ATS GEN terminals → ATS LOAD → MSP
  // All wire labels from computed segments (NEC-sized) — no hardcoded gauges.
  if ((input.generatorKw ?? 0) > 0) {
    // Determine if IQ SC3 is the ATS (no separate ATS box needed)
    const _isIQSC3 = !!(input.hasEnphaseIQSC3 || input.backupInterfaceIsATS ||
      String(input.backupInterfaceId ?? '').toLowerCase().includes('iq-sc3') ||
      String(input.backupInterfaceId ?? '').toLowerCase().includes('iq-system-controller'));

    if (_isIQSC3) {
      // ── Mode A: Enphase IQ SC3 — generator connects to BUI GEN port ──────────
      // Generator positioned below and left of BUI (which is already rendered in NODE 8)
      const genCX = (buiRX ?? (xMSP + 130)) - 160;
      const genCY = BUS_Y + 160;
      const genResult = renderGenerator(
        genCX, genCY,
        input.generatorBrand ?? '',
        input.generatorModel ?? '',
        input.generatorKw!,
        isMicro ? 10 : 11
      );
      parts.push(genResult.svg);

      // Wire: Generator GEN_OUT terminal → BUI GEN port (L-shaped route)
      // Use genResult.genOutX/Y → buiResult.genPortX/Y for precise terminal-to-terminal routing
      const genWireX = genResult.genOutX + 20;
      // buiResult is hoisted from NODE 8; fall back to BUS_Y+14 if not rendered (shouldn't happen for IQ SC3)
      const buiGenY  = buiResult?.genPortY ?? (BUS_Y + 14);
      const buiGenX  = buiResult?.genPortX ?? (xMSP + 130 - 50);
      parts.push(ln(genResult.genOutX, genResult.genOutY, genWireX, genResult.genOutY, {stroke: '#2E7D32', sw: SW_MED}));
      parts.push(ln(genWireX, genResult.genOutY, genWireX, buiGenY, {stroke: '#2E7D32', sw: SW_MED}));
      parts.push(ln(genWireX, buiGenY, buiGenX, buiGenY, {stroke: '#2E7D32', sw: SW_MED}));

      // Wire callout — use computed GENERATOR_TO_ATS_RUN conductorCallout
      const genCalloutLines = genToAtsRun?.conductorCallout
        ? genToAtsRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : (genToAtsRun?.wireGauge
            ? [`${genToAtsRun.wireGauge} THWN-2`, `${genToAtsRun.ocpdAmps ?? ''}A OCPD`]
            : ['SEE COMPUTED SCHEDULE', 'GEN → IQ SC3 GEN PORT']);
      parts.push(tspan(genWireX + 4, genResult.genOutY - 10, genCalloutLines, {sz: F.tiny, anc: 'start', fill: '#2E7D32'}));

      // NEC notes
      parts.push(txt(genCX, genResult.by + 55, 'NEC 702.5 — TRANSFER FUNCTION IN IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));
      parts.push(txt(genCX, genResult.by + 63, 'NEC 250.30 — FLOATING NEUTRAL AT IQ SC3', {sz: F.tiny, anc: 'middle', italic: true, fill: '#2E7D32'}));

    } else {
      // ── Mode B: Standalone ATS — between utility meter and MSP ───────────────
      const genAtsCX = (xMSP + xUtil) / 2;
      const genAtsCY = BUS_Y + 140;
      const genAtsResult = renderATS(
        genAtsCX, genAtsCY,
        input.atsBrand ?? '',
        input.atsModel ?? '',
        input.atsAmpRating ?? 200,
        isMicro ? 10 : 11
      );
      parts.push(genAtsResult.svg);

      // Generator — below and left of ATS
      const genCX = genAtsCX - 160;
      const genCY = BUS_Y + 140;
      const genResult = renderGenerator(
        genCX, genCY,
        input.generatorBrand ?? '',
        input.generatorModel ?? '',
        input.generatorKw!,
        isMicro ? 11 : 12
      );
      parts.push(genResult.svg);

      // Generator GEN_OUT terminal → ATS GEN input terminal (horizontal wire)
      // Use genResult.genOutX/Y → genAtsResult.genInX/Y for precise terminal routing
      parts.push(ln(genResult.genOutX, genResult.genOutY, genAtsResult.genInX, genAtsResult.genInY, {stroke: '#2E7D32', sw: SW_MED}));
      const genAtsLabelX = (genResult.genOutX + genAtsResult.genInX) / 2;
      // BUILD v24: Use computed GENERATOR_TO_ATS_RUN conductorCallout
      const genCalloutLines = genToAtsRun?.conductorCallout
        ? genToAtsRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : (genToAtsRun?.wireGauge
            ? [`${genToAtsRun.wireGauge} THWN-2`, 'GEN OUTPUT']
            : ['SEE COMPUTED SCHEDULE', 'GEN OUTPUT']);
      parts.push(tspan(genAtsLabelX, genResult.genOutY - 10, genCalloutLines, {sz: F.tiny, anc: 'middle', fill: '#2E7D32'}));

      // Utility → ATS UTIL input terminal (vertical drop from bus)
      // Use genAtsResult.utilInX/Y for precise terminal routing
      parts.push(ln(genAtsResult.utilInX, BUS_Y + 36, genAtsResult.utilInX, genAtsResult.utilInY, {stroke: BLK, sw: SW_MED}));
      parts.push(txt(genAtsResult.utilInX - 4, (BUS_Y + 36 + genAtsResult.utilInY) / 2, 'UTILITY', {sz: F.tiny, anc: 'end', fill: '#444'}));

      // ATS LOAD output terminal → MSP (vertical rise back to bus)
      // Use genAtsResult.loadOutX/Y for precise terminal routing
      parts.push(ln(genAtsResult.loadOutX, genAtsResult.loadOutY, genAtsResult.loadOutX, BUS_Y + 36, {stroke: '#E65100', sw: SW_MED}));
      // BUILD v24: Use computed ATS_TO_MSP_RUN conductorCallout
      const atsCalloutLines = atsToMspRun?.conductorCallout
        ? atsToMspRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : (atsToMspRun?.wireGauge
            ? [`${atsToMspRun.wireGauge} THWN-2`, 'ATS → MSP']
            : ['SEE COMPUTED SCHEDULE', 'ATS → MSP']);
      parts.push(tspan(genAtsResult.loadOutX + 6, genAtsResult.loadOutY - 20, atsCalloutLines, {sz: F.tiny, anc: 'start', fill: '#E65100'}));

      // NEC notes
      parts.push(txt(genAtsCX, genAtsCY + 55, 'NEC 702.5 — TRANSFER EQUIPMENT REQUIRED', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
      parts.push(txt(genAtsCX, genAtsCY + 63, 'NEC 250.30 — FLOATING NEUTRAL AT ATS', {sz: F.tiny, anc: 'middle', italic: true, fill: '#E65100'}));
    }
  }

  // ── NODE 7: UTILITY METER ─────────────────────────────────────────────────
  const utilCX = xUtil, utilCY = BUS_Y;
  const mR = 40;  // SOT: enlarged meter circle for readability
  console.log(`[SLD SYMBOL SIZE USED] utility-meter (custom circle): r=${mR}`);

  // SEGMENT: MSP busOut terminal → Utility Meter (terminal-to-terminal routing)
  // Source: mspResult.busOutX/Y  Dest: utility meter left edge
  {
    const run = mspUtilRun;
    // Phase 6: conductor count from acRequiresNeutral (2=240V no-neutral, 3=neutral required)
    const fb = [
      `${_acConductorCount}#${_acWireNum} THWN-2`,
      `1×${acFeederRun?.egcGauge??'#10 AWG'} GRN EGC`,
      `IN ${resolvedAcConduit} ${resolvedAcCondType}`,
    ];
    const {lines, cnt} = runLines(run, fb);
    // Source: BUI LOAD port when battery present, else MSP busOut terminal.
    // When BUI is present, the bus wire exits from BUI LOAD port (right-side lug).
    // When no BUI, it exits from MSP busOut terminal.
    const _seg6SrcX = buiResult ? buiResult.loadPortX : mspResult.busOutX;
    const _seg6SrcY = buiResult ? buiResult.loadPortY : mspResult.busOutY;
    const _s6Y = resolveSegY(_seg6SrcX, utilCX-mR-10, _seg6SrcY);
    console.log('[WIRE RUN CREATED] SEGMENT_6_MSP_TO_METER: AC service run');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_6_MSP_TO_METER', _seg6SrcX, _s6Y, utilCX-mR-10, _s6Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY
      lines));
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
  // Phase 8: Ground drops only at actual equipment nodes
  // For optimizer with integratedDcDisconnect, xComb has no equipment — skip it
  const gndPts = isMicro
    ? [xJBox, xComb, xDisco, xMSP]
    : (input.integratedDcDisconnect
        ? [xJBox, xInv, xDisco, xMSP]          // no external DC disco node
        : [xJBox, xComb, xInv, xDisco, xMSP]); // DC disco at xComb
  // ─── GROUNDING RAIL (subordinate visual weight) ─────────────────────────
  // Use thinner stroke + muted green so the ground rail recedes behind the
  // primary DC/AC conductor paths. Drops start well below BUS_Y to clear labels.
  const GND_CLR  = '#2E7D32';  // muted green — less dominant than #005500
  const GND_SW   = 1.0;        // thin stroke — subordinate
  const GND_DROP = BUS_Y + 55; // start below equipment bottom edge (jbH/2=50)
  const gx1 = gndPts[0], gx2 = gndPts[gndPts.length-1];
  parts.push(ln(gx1, GND_Y, gx2, GND_Y, {stroke:GND_CLR, sw:GND_SW}));
  for (const gx of gndPts) {
    parts.push(ln(gx, GND_DROP, gx, GND_Y, {stroke:GND_CLR, sw:GND_SW, dash:'4,3'}));
    parts.push(gnd(gx, GND_Y, GND_CLR));
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
    // Real branch plan when provided; per-model NEC count otherwise. NEVER
    // ceil(md/16) (wrong for IQ8A) and NEVER the system-output OCPD (100A)
    // as a per-branch breaker — both were plan-check red flags.
    const ab = input.microBranches?.length ?? microBranchCount(md, input.inverterModel);
    const _perMicroBrA = md > 0 ? (input.acOutputKw*1000/md)/240 : 0;
    const _maxBrDev = input.microBranches?.length
      ? Math.max(...input.microBranches.map(b => b.deviceCount))
      : microMaxPerBranch(input.inverterModel);
    const ba = branchRun?.ocpdAmps
      ?? (input.microBranches?.length ? Math.max(...input.microBranches.map(b => b.ocpdAmps)) : 0)
      ?? 0;
    const baShow = ba || necNextStandardOcpd(_maxBrDev * _perMicroBrA * 1.25) || 20;
    parts.push(txt(p1x+cW/2, CALC_Y+10, 'AC BRANCH CIRCUIT INFO', {sz:F.hdr, bold:true, anc:'middle', fill:WHT}));
    const rows: [string,string][] = [
      ['Topology','MICROINVERTER'],
      ['Microinverters',`${md} units`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['AC per Micro',`${((input.acOutputKw*1000)/md).toFixed(0)} W`],
      ['Branch Circuits',`${ab}`],
      ['Max Micros/Branch',`${microMaxPerBranch(input.inverterModel)} (NEC 690.8)`],
      ['Branch OCPD',`${baShow} A`],
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
    const dar = input.dcAcRatio ?? calcDcAcRatio(dcKw, input.acOutputKw);
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
    ['AC Output (kW)',`${Number(input.acOutputKw).toFixed(2)} kW`],
    ['AC Output Amps',`${input.acOutputAmps} A`],
    ['AC OCPD (125%)',`${resolvedAcOCPD} A`],
    ['AC Wire Gauge',`${resolvedAcWire}`],
    ['AC Conduit Type',resolvedAcCondType],
    ['Conduit Size',resolvedAcConduit||'—'],
    ['Service Voltage','120/240V, 1Ø'],
    ['Main Panel Rating',`${input.mainPanelAmps} A`],
    ...(isLoadSide ? (() => {
      // BUILD v24: NEC 705.12(B) — ALL backfeed breakers must sum ≤ 120% of bus rating
      // Total backfeed = PV backfeed breaker + battery backfeed breaker(s)
      const _batBfA = input.batteryBackfeedA ?? 0;
      const _totalBfA = pvBreakerAmps + _batBfA;
      // NEC 705.12(B): (busbar ampacity) × 1.2 ≥ (main breaker OCPD) + (sum of backfeed breakers).
      // C1 fix: use the real busbar rating, NOT mainPanelAmps for both terms (a de-rated bus
      // could never fail the old check). Mirrors computed-system.ts interconnectionPass.
      const _busAmps  = input.panelBusRating ?? input.mainPanelAmps;
      const _busLimit = _busAmps * 1.2;
      const _120pass = _busLimit >= input.mainPanelAmps + _totalBfA;
      const _rows: [string,string][] = [
        ['Interconnection','Load Side Tap'],
        ['NEC Reference','NEC 705.12(B)'],
        ['Bus Rating',`${_busAmps} A`],
        ['PV Breaker',`${pvBreakerAmps} A`],
        ...(_batBfA > 0 ? [['Batt. Backfeed Bkr',`${_batBfA} A`] as [string,string]] : []),
        ['Total Backfeed',`${_totalBfA} A`],
        ['Bus 120% Limit',`${_busLimit.toFixed(0)} A`],
        ['120% Rule',`${_120pass ? 'PASS ✓':'FAIL ✗'}`],
      ];
      return _rows;
    })() : isSupplySide ? [
      ['Interconnection','Supply Side Tap'] as [string,string],
      ['NEC Reference','NEC 705.11'] as [string,string],
      ['Tap OCPD',`${pvBreakerAmps} A FUSED DISCO`] as [string,string],
      ['Backfed Breaker','N/A — LINE-SIDE TAP'] as [string,string],
      ['120% Rule','N/A — Supply Side'] as [string,string],
    ] : [
      ['Interconnection','Backfed Breaker'] as [string,string],
      ['NEC Reference','NEC 705.12(B)(2)'] as [string,string],
      ['Backfeed Breaker',`${input.backfeedAmps} A`] as [string,string],
      ['120% Rule',`${(input.panelBusRating ?? input.mainPanelAmps)*1.2 >= input.mainPanelAmps+input.backfeedAmps ? 'PASS ✓':'FAIL ✗'}`] as [string,string],
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
    ['Branch Circuits',`${input.microBranches?.length ?? microBranchCount(md2, input.inverterModel)}`],
    ['Inverter Mfr.',esc(input.inverterManufacturer)],
    ['Inverter Model',esc(input.inverterModel)],
    ['Inverter Output',`${Number(input.acOutputKw).toFixed(2)} kW AC`],
    ['AC Combiner',esc(input.combinerLabel??'IQ Combiner')],
    ['AC Disconnect',`${resolvedAcOCPD}A ${isSupplySide ? 'Fused (Tap OCPD)' : 'Non-Fused'}`],
    ['Main Panel',`${input.mainPanelAmps} A`],
    ['Utility',esc(input.utilityName)],
    ['Interconnection',esc(input.interconnection)],
    ['Rapid Shutdown',input.rapidShutdownIntegrated?'INTEGRATED':'EXTERNAL'],
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity', input.batteryKwhLabel || `${input.batteryKwh} kWh`] as [string,string]] : []),
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
    ['Inverter Output',`${Number(input.acOutputKw).toFixed(2)} kW AC`],
    ['DC Disconnect',`${input.dcOCPD}A Fused`],
    ['AC Disconnect',`${resolvedAcOCPD}A ${isSupplySide ? 'Fused (Tap OCPD)' : 'Non-Fused'}`],
    ['Main Panel',`${input.mainPanelAmps} A`],
    ['Utility',esc(input.utilityName)],
    ['Interconnection',esc(input.interconnection)],
    ['Rapid Shutdown',input.rapidShutdownIntegrated?'INTEGRATED':'EXTERNAL'],
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery && input.batteryKwh ? [['Battery Capacity', input.batteryKwhLabel || `${input.batteryKwh} kWh`] as [string,string]] : []),
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
    // No per-run engine data — use REAL engine values where the adapter
    // provided them (feeder fill/vdrop/length) and '—' (0) where it didn't.
    // The old canned 32%/28% fill, 1.2-1.8% vdrop, and 50/20/15 ft lengths
    // were fabricated numbers an AHJ could (and did) try to reproduce.
    const _fFill = input.acConduitFillPct ?? 0;
    const _fVd   = input.acVoltageDropPct ?? 0;
    const _fLen  = input.acWireLength ?? 0;
    const _fPass = _fFill <= 40 && _fVd <= 3;
    sRows = isMicro ? [
      {id:'BR-1',from:'ROOF J-BOX',to:'AC COMBINER',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:0,len:0,pass:_fPass},
      {id:'A-1',from:'AC COMBINER',to:'AC DISCO',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:0,len:0,pass:_fPass},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:_fVd,len:_fLen,pass:_fPass},
    ] : [
      {id:'D-1',from:'PV ARRAY',to:'ROOF J-BOX',conductors:`${resolvedDcWire} USE-2 + 1×#${egcNum} GRN`,conduit:'OPEN AIR',fill:0,amp:0,ocpd:input.dcOCPD,vdrop:0,len:0,pass:true},
      {id:'D-2',from:'ROOF J-BOX',to:'DC DISCO',conductors:`${resolvedDcWire} USE-2 + 1×#${egcNum} GRN`,conduit:`${input.dcConduitType??'EMT'} 3/4"`,fill:0,amp:0,ocpd:input.dcOCPD,vdrop:0,len:0,pass:true},
      {id:'A-1',from:'INVERTER',to:'AC DISCO',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:0,len:0,pass:_fPass},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:_fVd,len:_fLen,pass:_fPass},
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
  // Build badge stays even in embedded mode — invisible deployment telemetry.
  parts.push(`<!-- ${getBuildBadge()} | SLD SYMBOLS V2 -->`);
  if (input.suppressTitleBlock) {
    parts.push('</svg>');
    return parts.join('\n');
  }
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
  // (build badge comment emitted above, before the embedded-mode early return)

  // Project info rows
  const tbRows: [string,string][] = [
    ['PROJECT',input.projectName],['CLIENT',input.clientName],
    ['ADDRESS',input.address],['DESIGNER',input.designer],
    ['DATE',input.drawingDate],['DWG NO.',input.drawingNumber],
    ['REVISION',input.revision],['SCALE',input.scale||'NOT TO SCALE'],
  ];
  let tbY2 = tbY+78; // BUILD v24: +10 for version badge
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
    ['AC OUTPUT',`${Number(input.acOutputKw).toFixed(2)} kW`],
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