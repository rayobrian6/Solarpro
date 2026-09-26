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
import type { SldMeteringDrawing } from '@/lib/equipment/designMetering';
import type { ConsumptionCtLocation } from '@/lib/equipment/currentTransformers';
import type { StandaloneGatewayFields } from '@/lib/equipment/sldCombinerFields';
import { combinerCompatibilityFor } from '@/lib/equipment/combinerCompatibility';
import { necNextStandardOcpd, unselectedInverterLabel, isInverterUnselectedMarker, BATTERY_CAPACITY_UNRESOLVED } from '@/lib/permit/utils/helpers';
import { wireGaugeForOcpd } from '@/lib/permit/utils/conductorAuthority';
import { resolveAcDisconnect } from '@/lib/electrical/acDisconnect';
import { getEGCSize } from '@/lib/manufacturer-specs';
import { microBranchCount, microMaxPerBranch } from '@/lib/permit/utils/branching';
import { getBuildBadge } from './version';
import { isGroundingConductor, type ConductorBundle } from './segment-schedule';
import { calcDcAcRatio } from './system/calcDcAcRatio';
import { SLD_SYMBOL_MAP } from './sld-symbols';
import { emitBrandEmblem } from './sld-brand-emblems';
import { resolveDeviceIllustration, forPrintedSheet, illustrationBox, type DeviceIllustration } from './sld-device-illustrations';
import type { Conductor, WireRun, ConductorType, WireEnvironment } from './sld-types';
import { getBosDevice, resolveHybridAcCollection, type HybridAcCollectionPlan } from '@/lib/equipment/integratedBos';
import { combinerBasisIsDecided } from '@/lib/combinerSelection/service';

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

// E-1.1 (schedules sheet) canvas. Sized to the planset's own drawing box
// (1402.88 x 992 uu) so the embed scale is ~1.0 rather than 0.7036.
const STACK_W = 1420;
const STACK_H = 1000;
// Tall enough for the longest equipment schedule (a battery + standalone
// gateway + metering job lists 22 rows) at a row pitch that clears 8.67 uu
// type. At 180 those rows were pitched at 7.4–9 uu and every row touched the
// next. The conduit schedule under it keeps room for 23 rows.
const CALC_H  = 250;
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

/** Post-AAC E-1 repair — wrap a legend label at word boundaries so data-driven
 *  wiring-method names stay inside the fixed legend box (and inside the
 *  embedded viewBox crop). ~40 chars ≈ the 140px text run at F.tiny. */
// ── LEGEND BOX GEOMETRY ──────────────────────────────────────────────────────
// Sized for the legibility floor, not for the retired 6 uu type. At 188 uu wide
// (140 uu of text) the listed-assembly entry — "Open Air — ENPHASE Q CABLE
// (TC-ER) AC Branch (NEC 690.31(C))" — no longer fits on one line once type is
// raised, and wrapping it split a string the §8 evidence gate matches on. The
// box grows with the type instead of the text shrinking to fit a stale box.
const LEG_W      = 260;                       // outer box width
const LEG_TEXT_X = 44;                        // text inset (past the line swatch)
const LEG_TEXT_W = LEG_W - LEG_TEXT_X - 6;    // 210 uu of drawable text
const LEG_ROW_H  = 13;                        // row pitch — 11 crowds 8.67 uu type

function wrapLegendLabel(label: string, maxChars = 40, sz?: number): string[] {
  // Width-aware when the caller states the type size. The fixed 40-character
  // budget was calibrated to F.tiny at 6 uu (~140 px of text in the 188 uu legend
  // box); once the legibility floor raises that type the same 40 characters no
  // longer fit and the label runs out of its box. Average glyph advance for this
  // face is ~0.55 em, so the budget scales inversely with the type size.
  if (sz && sz > 0) {
    maxChars = Math.max(16, Math.floor(LEG_TEXT_W / (0.55 * sz)));
  }
  if (label.length <= maxChars) return [label];
  const words = label.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
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
/** ── PRINTED LEGIBILITY FLOOR ────────────────────────────────────────────────
 *  The canvas is 96 user units per inch, so printed points = uu × 0.75 at 1:1
 *  (a 24 × 18 in ARCH C sheet). The ladder below was authored in uu with no
 *  reference to physical size, and it lands far too small on paper:
 *
 *      seg  6.5 uu → 4.88 pt   ← the conductor callouts: gauge, conduit, OCPD
 *      tiny 6.0 uu → 4.50 pt   ← NEC references
 *      the smallest hardcoded literal, 3.6 uu → 2.70 pt
 *
 *  A plan reviewer cannot read 4.5 pt, and neither can the installer. 6.5 pt
 *  (~1/16 in cap height) is the floor this repo already articulates elsewhere
 *  (tests/planset/pagination-w9.test.ts calls 6–6.5 px "below the readable
 *  floor for a permit reviewer").
 *
 *  6.5 pt ÷ 0.75 = 8.67 uu. Anything below that is raised to it by
 *  applyTypeFloor() on the finished SVG, which catches the type scale AND the
 *  ~51 hardcoded `sz:` literals that bypass it — an audit of the ladder alone
 *  would have missed those. */
const UU_PER_IN = 96;
const MIN_PRINTED_PT = 6.5;
/** uu that print at MIN_PRINTED_PT on a 1:1 sheet. */
export const MIN_TYPE_UU = +(MIN_PRINTED_PT / (72 / UU_PER_IN)).toFixed(2);  // 8.67

/** Raise every font-size below the legibility floor, leaving larger type alone
 *  so the hierarchy is preserved rather than flattened.
 *
 *  Total by construction, not by audit: all text is emitted through the two
 *  `txt`/`tspan` helpers as a `font-size="N"` ATTRIBUTE — there are no
 *  `style="font-size:…"` forms anywhere in the SLD modules — so one regex over
 *  the finished document reaches every glyph, including the device-illustration
 *  and symbol sub-modules. */
export function applyTypeFloor(svg: string, minUu: number = MIN_TYPE_UU): string {
  return svg.replace(/font-size="([0-9.]+)"/g, (whole, n: string) => {
    const v = Number(n);
    return Number.isFinite(v) && v < minUu ? `font-size="${minUu}"` : whole;
  });
}

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

// ── PRINTED TYPE METRICS — for LAYOUT, not for drawing ─────────────────────
// Ray, 2026-09-26, on a live 5C supply-side sheet: "Biggest issue I have with
// the sld is the word bleed and overlays. This should be cleaner to read!!"
// Most of that bleed had one cause: labels were placed at the size they were
// AUTHORED (4.2–6.5 uu) and applyTypeFloor() raised them to 8.67 uu after the
// layout was done, so every stack pitched for 6 uu type ran into its neighbour,
// its symbol's edge or a line. Layout now reasons about the size that PRINTS.
//
// 'SolarPro Sans' is Liberation Sans (lib/permit/fonts/font-pack.manifest.json),
// drawn advance-for-advance to Arial's widths. These are its advances in font
// units (unitsPerEm 2048) for U+0020–U+007E, Regular then Bold, read from the
// shipped WOFF2 — the same numbers tests/support/sldGeometry.ts measures with,
// so a label that clears here clears in the audit and on paper.
const _ADV_R = [569,569,727,1139,1139,1821,1366,391,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,569,569,1196,1196,1196,1139,2079,1366,1366,1479,1479,1366,1251,1593,1479,569,1024,1366,1139,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,569,569,569,961,1139,682,1139,1139,1024,1139,1139,569,1139,1139,455,455,1024,455,1706,1139,1139,1139,1139,682,1024,569,1139,1024,1479,1024,1024,1024,684,532,684,1196];
const _ADV_B = [569,682,971,1139,1139,1821,1479,487,682,682,797,1196,569,682,569,569,1139,1139,1139,1139,1139,1139,1139,1139,1139,1139,682,682,1196,1196,1196,1251,1997,1479,1479,1479,1479,1366,1251,1593,1479,569,1139,1479,1251,1706,1479,1593,1366,1593,1479,1366,1251,1479,1366,1933,1366,1366,1251,682,569,682,1196,1139,682,1139,1251,1139,1251,1139,682,1251,1251,569,569,1139,569,1821,1251,1251,1251,1251,797,1139,682,1251,1139,1593,1139,1139,1024,797,573,797,1196];
/** The non-ASCII glyphs these sheets print, [regular, bold]. */
const _ADV_X: Record<string, [number, number]> = {
  '—': [2048, 2048], '–': [1139, 1139], '×': [1196, 1196], '·': [682, 682], 'Ø': [1593, 1593],
  '→': [2048, 2048], 'Φ': [1634, 1681], '°': [819, 819], '±': [1124, 1124], '≤': [1124, 1124],
  '≥': [1124, 1124], 'Ω': [1531, 1642], 'µ': [1180, 1180], '’': [455, 569], '‘': [455, 569],
  '“': [682, 1024], '”': [682, 1024], '…': [2048, 2048], '•': [717, 717], '²': [682, 682],
  '⚡': [1438, 1438], '✓': [1716, 1716], '✗': [1716, 1716], '⚠': [1836, 1836],
};
/** Printed width (uu) of `s` at the size that PRINTS — never below the floor.
 *  An unknown glyph is taken as a full em: a layout that clears with it clears
 *  with the real glyph. */
function textWidthUu(s: string, sz: number, bold = false): number {
  const size = Math.max(sz, MIN_TYPE_UU);
  let fu = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    fu += c >= 0x20 && c <= 0x7e ? (bold ? _ADV_B : _ADV_R)[c - 0x20]
      : (_ADV_X[ch]?.[bold ? 1 : 0] ?? 2048);
  }
  return fu / 2048 * size;
}
/** Ink above the baseline of a line of type (caps, '(' and digits reach
 *  0.725 em) and below it (descenders, ',' and ')' reach 0.21 em), at the
 *  printed size. */
const capUu  = (sz: number): number => 0.725 * Math.max(sz, MIN_TYPE_UU);
const descUu = (sz: number): number => 0.21 * Math.max(sz, MIN_TYPE_UU);
/** Baseline pitch for stacked label lines at the printed floor: 8.67 uu type
 *  pitched at 9 left 0.9 uu between a descender and the caps below it — it
 *  reads as touching. 10.5 leaves 2.4. */
const LBL_PITCH = 10.5;
/** A label block's printed ink extent, for the lines that must stop at it. */
interface LabelBand { top: number; bot: number }
const labelBand = (firstBaseline: number, lastBaseline: number, sz: number): LabelBand =>
  ({ top: firstBaseline - capUu(sz), bot: lastBaseline + descUu(sz) });

// ── Public Interface ─────────────────────────────────────────────────────────

/**
 * One PV source branch (lane) of a hybrid multi-subsystem SLD — contract §1.3
 * permit carriage (docs/ARCHITECTURE-per-subsystem-equipment.md).
 *
 * Wave 5 Lane A: consumed by renderSLDMultiLane (below). `sources` absent or
 * carrying ≤1 valid branch ⇒ the legacy single-source renderer path is taken
 * byte-for-byte (Invariant I-1). Builders live in
 * lib/permit/utils/sldAdapter.ts (permit path: conductorAuthority.subSystems;
 * page path: computedMulti.subSystems).
 */
export interface SLDSourceBranch {
  /** Owning subsystem — drives the lane label (PV-R / PV-G / PV-F). */
  key: import('@/lib/system/subSystemEquipment').SubSystemKey;
  /** Lane label override, e.g. 'ROOF — 48 × Maxeon 6 400W'. */
  label?: string;
  topologyType?: string;
  systemType?: 'roof' | 'ground' | 'fence';
  totalModules?: number;
  totalStrings?: number;
  panelsPerString?: number;
  panelModel?: string;
  panelWatts?: number;
  panelVoc?: number;
  panelIsc?: number;
  inverterManufacturer?: string;
  inverterModel?: string;
  /** Physical inverter units on this lane (string/optimizer subs). */
  inverterCount?: number;
  /** Per-device AC kW (explicit per-device contract — never a summed total). */
  acKwPerDevice?: number;
  acOutputKw?: number;
  acOutputAmps?: number;
  acWireGauge?: string;
  acConduitType?: string;
  acOCPD?: number;
  /** Per-branch backfeed contribution — Σ per-physical-inverter rounded OCPDs
   *  within this sub (§1.7 breaker-granularity rule). */
  backfeedAmps?: number;
  /** DC string OCPD (string/optimizer lanes with an external DC disco). */
  dcOCPD?: number;
  /** True when the lane's inverter integrates its own DC disconnect
   *  (optimizer ecosystems) — the lane skips the external DC disco node. */
  integratedDcDisconnect?: boolean;
  optimizerQty?: number;
  optimizerModel?: string;
  /** Micro lanes — combiner nameplate (e.g. 'Enphase IQ Combiner 6C'). */
  combinerLabel?: string;
  /** Lane AC disconnect nameplate override (defaults to '(N) AC DISCONNECT'). */
  disconnectLabel?: string;
  rapidShutdownIntegrated?: boolean;
  deviceCount?: number;
  microBranches?: MicroBranch[];
  runs?: RunSegment[];
  /** Per-sub EGC gauge from the shared conductor authority (NEC 250.122 on the
   *  sub's AC feeder OCPD). Fallback: getEGCSize(lane OCPD) — same table. */
  egcGauge?: string;
  /** P1-2 — EGC for this lane's AC BRANCH circuits (micro lanes): the
   *  governing branch's NEC 250.122 result, carried from the conductor
   *  authority via the sldAdapter. Renderer consumes; never re-derives. */
  branchEgcGauge?: string;
  /** P1-2 — EGC for this lane's DC source circuits (250.122 on the lane's
   *  governing DC string OCPD), carried from the adapter. */
  dcEgcGauge?: string;
  /** Panel Voc temperature coefficient, %/°C (negative) — from the equipment
   *  DB / computed panelSpec. Absent ⇒ the sheet prints a marked conservative
   *  assumption instead of silently fabricating a datasheet value. */
  panelTempCoeffVoc?: number;
  /**
   * This lane's CTs, their lead(s) and the "Consumption CTs" row — from
   * lib/equipment/sldCombinerFields `hybridLaneMetering`, which runs the ONE
   * metering composer (lib/equipment/designMetering.ts) on THIS lane's own
   * resolved plan. Drawn verbatim; the renderer never re-derives a location, a
   * count or a lead. ("add CTs to the hybrid SLDs too" — Ray, 2026-09-26.)
   *
   * A site has one service, so at most ONE lane (the primary metering lane)
   * carries `consumption`; any other metering lane is production-only.
   * ABSENT on a lane that meters nothing, and absence draws the lane exactly
   * as it was drawn before this field existed.
   */
  meteringDrawing?: SldMeteringDrawing;
  /**
   * This lane's standalone IQ Gateway — its own enclosure, fed from its own
   * 2-pole breaker in the lane's PV AC combiner panel, where its production CT
   * clamps L1. Same shape and meaning as `SLDProfessionalInput.standaloneGateway`.
   * ABSENT on every other lane (no key, not undefined).
   */
  standaloneGateway?: StandaloneGatewayFields;
}

export interface SLDProfessionalInput {
  /** Embedded in a planset sheet that has its own title block — suppress the
   *  internal SOLARPRO title panel (it duplicated project/system/code data
   *  right next to the sheet's title block on E-1) and crop the viewBox to
   *  the diagram. Standalone Diagram-tab renders keep the panel. */
  suppressTitleBlock?:     boolean;
  /** Post-AAC E-1 repair: the in-SVG CONDUIT & CONDUCTOR SCHEDULE band re-derives
   *  the same canonical physical sections the planset renders as an HTML schedule
   *  (now on PV-4B.1) — two derivations of one authority is the drift class the
   *  snapshot campaign kills, and the band forced a 1.15:1 canvas that could not
   *  fit E-1's landscape drawing box without clipping. When set, the band is not
   *  emitted and the viewBox is cropped to close below the calc panels. The
   *  standalone Diagram tab keeps the band (it has no companion schedule sheet). */
  suppressScheduleBand?:   boolean;
  /** E-1 / E-1.1 SPLIT (2026-09-14) -- suppress the three CALCULATION PANELS
   *  (AC BRANCH CIRCUIT INFO / AC SYSTEM CALCULATIONS / EQUIPMENT SCHEDULE) so
   *  E-1 carries the one-line TOPOLOGY only.
   *
   *  WHY THE SPLIT EXISTS. The panels sit in a 180 uu strip across a 1994 uu
   *  canvas that the planset embeds into a 1402.9 uu wrapper, so k = 0.7036 and
   *  every glyph printed at 4.57 pt. MEASURED: raising the type to reach 6.5 pt
   *  produced 80 overlaps against a baseline of 5 -- the drawing cannot absorb
   *  the growth, because content already occupies 99.8% of the canvas WIDTH
   *  while 14 of 33 vertical bands are empty. Width is what binds k, so neither
   *  a type increase nor a vertical reclaim can fix it. The schedules move to
   *  their own sheet instead.
   *
   *  The panels are NOT deleted -- they render on E-1.1 from this same code. */
  suppressCalcBand?:       boolean;
  /** E-1.1 renders the three calculation panels STACKED — one full-width band
   *  each — on a canvas sized to the sheet's drawing box. Side by side they span
   *  the full 1994 uu width, and width is what binds the embed scale. */
  calcBandStacked?:        boolean;
  /** E-1.1 renders the SCHEDULES ONLY -- the one-line topology stays on E-1. */
  schedulesOnly?:          boolean;
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
  /** W2 (snapshot authority): the ENGINE's 120% verdict. When provided, the
   *  renderer PRINTS it — it never re-decides. The local arithmetic remains
   *  only as the displayed annotation of the same numbers. */
  poiRulePasses?:          boolean;
  backfeedAmps:            number;
  utilityName:             string;
  interconnection:         string;
  rapidShutdownIntegrated: boolean;
  /**
   * 🚨 DECLARED SINCE THE FILE EXISTED AND NEVER READ. Five call sites wrote it;
   * nothing consumed it, so rendering the same design with it true and with it
   * false produced a byte-identical SVG containing zero occurrences of "CT" or
   * "current transformer". It is read now — see the EQUIPMENT SCHEDULE rows.
   */
  hasProductionMeter:      boolean;
  /**
   * The metering channels this design actually has, from the CT authority
   * (`lib/equipment/currentTransformers`, `meteringScheduleValue`). Optional:
   * absent ⇒ the row is not drawn and nothing is asserted, which is what a
   * caller that has not resolved metering must produce. NEVER composed here —
   * a schedule that writes its own metering wording is a second authority.
   */
  meteringChannels?:       string;
  /** CTs, their lead and the "Consumption CTs" row — from the ONE metering
   *  composer (lib/equipment/designMetering.ts). READ-ONLY here: the renderer
   *  draws it verbatim and never re-derives a location or a mode. Absent ⇒
   *  no CT, lead or metering note is drawn. */
  meteringDrawing?:        SldMeteringDrawing;
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
  /** §3 — canonical AC feeder conduit trade size (e.g. '1"'), single-sourced
   *  from the snapshot feeder segment so E-1 never invents a '3/4"' fallback that
   *  disagrees with PV-4B. */
  acConduitSize?:          string;
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
  // Brand-integrated combiner ("the brains" — e.g. Enphase IQ Combiner 6C).
  combinerModel?:          string;
  combinerHasIntegratedGateway?: boolean;  // gateway lives inside the combiner (no separate Envoy)
  combinerProvidesAcDisconnect?: boolean;  // combiner has an integral load-break disconnect
  /**
   * 🚨 THE PROJECT'S RECORDED COMBINER SELECTION
   * (projects.selected_equipment.combinerSelection).
   *
   * The four fields above are the RESOLVED combiner for the single-lane
   * drawing — an answer the caller already computed. This is the QUESTION's
   * authority, and the multi-lane path needs it because that path does not
   * consume the resolved fields at all: it re-resolves a combiner PER LANE
   * through acCollectionFromLanes. So a hybrid drawing ignored a selection the
   * single-lane drawing honoured, on the same project.
   */
  selectedCombinerId?:     string | null;
  /**
   * 🚨 PER-SUBSYSTEM recorded selections, keyed by lane ('roof'|'ground'|'fence')
   * — `selected_equipment.subSystems[key]`, which already exists.
   *
   * One project-level id above cannot answer a hybrid: the lanes need not share
   * an inverter brand, and stamping the single answer onto all of them labelled
   * an APsystems fence lane with the Enphase combiner. This is the per-lane
   * answer where one was recorded; laneSelectedCombinerId brand-checks the
   * project-level one for the lanes it does not cover.
   */
  selectedCombinerIdByLane?: Record<string, string | null> | null;
  /**
   * 🚨 DID A HUMAN CHOOSE THE COMBINER THE FOUR FIELDS ABOVE NAME?
   * (`sldCombinerFields().combinerSelectionIsDecided` — the shared adapter both
   * the SVG and PDF SLD routes already call.)
   *
   * `false` means the device was DERIVED: from the inverter's declared pairing,
   * or from the last-resort literal that once put an IQ Combiner 6C on a 5C job.
   * The adapter computed this and nothing read it, so the schedule row and the
   * diagram nameplate asserted a derived device with exactly the confidence of a
   * recorded installer selection — the repo's rule is that absence of a decision
   * may never look like a decision, and a permit reviewer had no way to tell.
   *
   * TRI-STATE ON PURPOSE. `undefined` = the caller has not answered this
   * question, and the sheet renders exactly as it did before the field existed
   * (the same contract `hasProductionMeter` states above: the flag ADDS a
   * statement, it never removes one). Only an explicit `false` qualifies, so a
   * builder that has not been wired cannot be read as asserting "not chosen".
   */
  combinerSelectionIsDecided?: boolean;
  /**
   * 🚨 THE IQ GATEWAY ON ITS OWN WALL — "IQ Gateway (standalone) + PV AC
   * combiner panel" (`sldCombinerFields().standaloneGateway`, one shape).
   *
   * Present ⇔ the branches land in a generic PV AC combiner panel and the
   * gateway is a SEPARATE enclosure fed from its own 2-pole breaker in that
   * panel. The combiner slot then draws the panel (no gateway art inside it),
   * the supply breaker in it, and the gateway as its own node above the chain
   * with its supply circuit and its CT leads. `combinerHasIntegratedGateway`
   * cannot say this: it is false here, and false has always meant "no
   * gateway at all".
   *
   * ABSENT on every other design, and absence draws exactly what it drew
   * before. Micro single-lane path only.
   */
  standaloneGateway?:      StandaloneGatewayFields;
  ocpdPerString?:          number;
  dcAcRatio?:              number;
  stringConfigWarnings?:   string[];
  deviceCount?:            number;
  microBranches?:          MicroBranch[];
  branchWireGauge?:        string;
  branchConduitSize?:      string;
  branchConduitType?:      string;   // W1b — canonical BRANCH_RUN raceway (single source; no '3/4" EMT' literal)
  branchIsOpenAir?:        boolean;  // W1b — branch home-run in raceway (false) vs open-air Q-Cable (true)
  // §3/§4 — the SHARED jbox→combiner home-run raceway (all branches bundled).
  // SEGMENT_2A prints this in-conduit section; the Q-Cable branch stays open-air.
  homerunConduitType?:     string;
  homerunConduitSize?:     string;
  homerunSharedCircuits?:  number;
  // §1 — the shared home-run's current-carrying-conductor inventory + phase gauge
  // from the canonical physicalRaceway object. SEGMENT_2A prints '${ccc}#${gauge}
  // THWN-2' (e.g. 6#10) — never the legacy OCPD-derived #12.
  homerunCurrentCarryingCount?: number;
  homerunConductorGauge?:  string;
  /** §8 (BAR closeout 2026-07-25) — the LISTED wiring-method identity for the
   *  OPEN-AIR branch section actually drawn on the sheet (micro ⇒ the Q-Cable
   *  assembly, e.g. 'ENPHASE Q CABLE (TC-ER)'). The legend derives its open-air
   *  entry from THIS instead of the hardcoded 'PV Wire/THWN-2' literal; when
   *  absent (a non-micro sheet with real open-air PV-wire), the legend keeps the
   *  generic PV-Wire label. Semantic gate 11: legend == displayed segment method. */
  openAirBranchWiringLabel?: string;
  /** §5 (BAR closeout 2026-07-25) — the BRANCH EGC gauge from the canonical
   *  `branch-egc` grounding object (NEC 250.122 on the 20 A BRANCH OCPD, e.g.
   *  #12), NOT the feeder EGC. The open-air Q-Cable segment used to print the
   *  feeder's #10 while the grounding object and the BOM footage row carried #12
   *  — a separate-EGC assertion the quantities did not match (gate 7). */
  branchEgcGauge?:         string;
  /** GROUNDING AUTHORITY (2026-07-25) — the SEGMENT-1 open-air grounding line as
   *  decided by the document-based three-outcome grounding authority:
   *  '1×#12 GRN EGC' (B), 'NO ADD'L EGC — LISTED METHOD' (A), or
   *  'EGC: PENDING MFR AUTHORITY' (C, the fail-closed live state). When absent the
   *  renderer keeps the legacy per-gauge label (non-micro / standalone routes). */
  openAirBranchEgcLabel?:  string;
  /** §5 — the EGC carried in the SHARED jbox→combiner home-run raceway (that
   *  segment's own egcGauge), so SEGMENT_2A cites its own conductor, not the feeder's. */
  homerunEgcGauge?:        string;
  branchOcpdAmps?:         number;
  stringDetails?:          { stringIndex: number; panelCount: number; ocpdAmps: number; wireGauge: string; voc: number; isc: number }[];
  runs?:                   RunSegment[];
  // v25 — Single Source of Truth: pre-computed values from computeSystem() engine
  systemModel?:            import('./plan-set/permit-system-model').PermitSystemModel;
  // EGC gauge from computeSystem() NEC 250.122 table
  egcGauge?:               string;
  /** Hybrid multi-subsystem source lanes (contract §1.3). ABSENT ⇒ legacy
   *  single-source renderer path, byte-for-byte (I-1). Wave-1 type stub —
   *  consumed only by the Wave-5 multi-lane renderer. */
  sources?:                SLDSourceBranch[];
  /** ASHRAE design temperatures (lib/permit/utils/designTemps.ts) — drives the
   *  DESIGN TEMPERATURES table + NEC 690.7(A) corrected max system voltage. */
  designTemps?:            { ashraeExtremeLowC: number; ashrae2pctHighC: number; source?: string };
}

// ── SVG Primitives ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? '').replace(/&(?![a-zA-Z0-9#]+;)/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function txt(x: number, y: number, s: string,
  o: { sz?: number; bold?: boolean; anc?: 'start'|'middle'|'end'; fill?: string; italic?: boolean } = {}
): string {
  const sz  = o.sz   ?? F.label;
  const bld = o.bold ? 'font-weight="bold"' : '';
  const anc = `text-anchor="${o.anc ?? 'start'}"`;
  const clr = `fill="${o.fill ?? BLK}"`;
  const itl = o.italic ? 'font-style="italic"' : '';
  return `<text x="${x}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="${sz}" ${bld} ${anc} ${clr} ${itl} dominant-baseline="auto">${esc(s)}</text>`;
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
  return `<text x="${x}" y="${y}" font-family="SolarPro Sans, SolarPro Symbols" font-size="${sz}" ${bld} ${anc} ${clr} dominant-baseline="auto">${spans}</text>`;
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

// Numbered callout circle. The number is centred on its ink (half its cap
// height below the centre): on a baseline 1 uu below the centre it rode 2.5 uu
// high, and a two-digit number's top corners came within 1.4 uu of the ring on
// a sheet the fit draws below 1:1 (a hybrid with a battery).
function callout(cx: number, cy: number, n: number): string {
  return circ(cx, cy, 10, {fill:WHT, stroke:BLK, sw:SW_MED})
    + txt(cx, +(cy + capUu(F.hdr)/2).toFixed(2), String(n), {sz:F.hdr, bold:true, anc:'middle'});
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
  // Standard schematic PV-module symbol (IEC-style): framed rectangle with a
  // thin cell grid and a diagonal "sun-ray" arrow. Monochrome CAD line-art —
  // NOT a glossy product render (this is an engineering single-line diagram).
  const bx = cx - w/2, by = cy - h/2;
  const parts: string[] = [];
  // Module frame — white glazing, black aluminum frame
  parts.push(rect(bx, by, w, h, {fill: '#ffffff', stroke: BLK, sw: SW_MED}));
  // Cell grid — 3x2 subdivisions, thin gray CAD lines
  const cw = w / 3, ch = h / 2;
  for (let c = 1; c < 3; c++) parts.push(ln(bx + c*cw, by + 1, bx + c*cw, by + h - 1, {stroke:'#9ca3af', sw: 0.4}));
  parts.push(ln(bx + 1, by + ch, bx + w - 1, by + ch, {stroke:'#9ca3af', sw: 0.4}));
  // Diagonal sun-ray arrow (the standard PV cell mark)
  const ax0 = bx + w*0.62, ay0 = by - h*0.28, ax1 = bx + w*0.34, ay1 = by + h*0.30;
  parts.push(ln(ax0, ay0, ax1, ay1, {stroke: BLK, sw: 0.7}));
  const ang = Math.atan2(ay1 - ay0, ax1 - ax0);
  const ah = 3.2;
  parts.push(`<path d="M${ax1.toFixed(1)},${ay1.toFixed(1)} L${(ax1 - ah*Math.cos(ang - 0.4)).toFixed(1)},${(ay1 - ah*Math.sin(ang - 0.4)).toFixed(1)} M${ax1.toFixed(1)},${ay1.toFixed(1)} L${(ax1 - ah*Math.cos(ang + 0.4)).toFixed(1)},${(ay1 - ah*Math.sin(ang + 0.4)).toFixed(1)}" stroke="${BLK}" stroke-width="0.7" fill="none"/>`);
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
  // 3 uu above the box: at 2, the digits' feet came 1.4 uu from its edge —
  // touching, once the sheet is drawn at 1:1.
  if (amps) parts.push(txt(cx, cy-h/2-3, `${amps}A`, {sz:5.5, anc:'middle', bold:true}));
  return parts.join('');
}

// Terminal lug dot
function lug(cx: number, cy: number): string {
  return circ(cx, cy, 3, {fill:WHT, sw:SW_MED})
    + circ(cx, cy, 1, {fill:BLK, sw:0});
}

// ── Current transformers (Ray, 2026-09-25: "there is no ct logic") ──────────
const CT_CLR = '#6A1B9A';
/** A CT drawn as a ring around the conductor it measures. `tagGap` is the tag's
 *  baseline above the ring's centre: 6 leaves 1.6 uu between the floored tag's
 *  caps and the ring's ink — enough on a sheet drawn above 1:1, a near miss on
 *  one the fit shrinks below it (a hybrid with a battery). */
function ctRing(x: number, y: number, tag: string, r = 3.8, tagGap = 6): string {
  return circ(x, y, r, {fill:'none', stroke:CT_CLR, sw:1.2})
    + (tag ? txt(x, y - tagGap, tag, {sz:4.4, anc:'middle', bold:true, fill:CT_CLR}) : '');
}
/** A DRAWN CT secondary lead — heavier and longer-dashed than the old 2,2
 *  continuation stubs, as Enphase's line diagram (EN-IQ8-1PHN) draws them. */
const CT_LEAD_SW = 1.1;
const CT_LEAD_DASH = '4,2.5';
/** Continuation connector for the CT secondary leads — the same bubble at the
 *  CTs and at the gateway, so the lead is traceable without a line cutting
 *  through every label on the sheet. Used only where the composer states no
 *  drawable lead (`meteringDrawing.leads` absent). */
function ctBubble(x: number, y: number): string {
  return circ(x, y, 5.5, {fill:WHT, stroke:CT_CLR, sw:1.0})
    + txt(x, y + 2, 'CT', {sz:4.2, anc:'middle', bold:true, fill:CT_CLR});
}

// ── The CT drawing vocabulary, shared by the single-lane and the hybrid
//    multi-lane sheets. ONE copy of each: a hybrid lane's lead, note, legend
//    entry and schedule row must read exactly as the single-lane sheet's do, and
//    a second copy is a second answer waiting to drift. ─────────────────────
/** A drawn CT secondary lead, CT end first. */
function ctLeadPolyline(pts: Array<[number, number]>): string {
  return `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${CT_CLR}" stroke-width="${CT_LEAD_SW}" stroke-dasharray="${CT_LEAD_DASH}"/>`;
}
/** A lead's gateway end lands on a terminal dot, so it reads as terminated. */
function ctLeadTerminal(x: number, y: number): string {
  return circ(x, y, 1.8, {fill:CT_CLR, stroke:CT_CLR, sw:0});
}
/** The consumption-CT note line, in the composer's own words. */
function consumptionCtNoteText(mc: NonNullable<SldMeteringDrawing['consumption']>): string {
  return `CONSUMPTION CTs @ MSP: ${mc.label}  ·  ${mc.basisLabel}`;
}
/** The legend entry for the CT leads — only in the form they are drawn: a real
 *  lead, or the "CT" bubbles (which exist only outside drawn-lead mode). Gate
 *  11: a legend entry exists only for what the sheet draws. */
function ctLeadLegendEntries(anyLeadDrawn: boolean, bubbleContinuation: boolean):
    Array<{dash: string; stroke: string; label: string}> {
  return anyLeadDrawn
    ? [{dash:CT_LEAD_DASH, stroke:CT_CLR, label:'CT Secondary Leads (signal) — CT to gateway'}]
    : bubbleContinuation
      ? [{dash:'2,2', stroke:CT_CLR, label:'CT Secondary Leads (signal) — "CT" continuation'}] : [];
}
/** The schedule's "Consumption CTs" row — the composer's scheduleRow, verbatim. */
function consumptionCtScheduleRows(md: SldMeteringDrawing | undefined): [string, string][] {
  return md?.scheduleRow ? [['Consumption CTs', esc(md.scheduleRow)]] : [];
}
/** The schedule's "Monitoring Gateway" row for a standalone gateway. */
function monitoringGatewayScheduleCell(sg: StandaloneGatewayFields): string {
  return `${esc(sg.label)}${sg.partNumber ? ` (${esc(sg.partNumber)})` : ''} · ${sg.supplyBreakerA}A 2P SUPPLY`;
}

/**
 * The standalone gateway's own enclosure: 162 × 100, the brand's front-view
 * art (or a plain labelled box), '(N) MONITORING GATEWAY' above it and its
 * nameplate to its LEFT — below it is where its conductors rise, right of it is
 * where the consumption lead arrives. `ey0` is the enclosure's top edge.
 * Returns its PARTS (the sheet joins its parts with newlines, so a pre-joined
 * string would not be the same document).
 */
function standaloneGatewayNode(gwCX: number, ey0: number, sg: StandaloneGatewayFields,
    /** Nameplate line pitch. 9 is the single-lane sheet's (drawn above 1:1);
     *  at ~1:1 the italic model name's descenders come within 1.5 uu of the
     *  part number under it. */
    pitch = 9):
    {parts: string[]; ex0: number; ex1: number; ey1: number} {
  const encW = 162, encH = 100;
  const ex0 = gwCX - encW/2, ex1 = gwCX + encW/2;
  const ey1 = ey0 + encH;
  const p: string[] = [];
  p.push(rect(ex0, ey0, encW, encH, {fill:WHT, sw:SW_MED}));
  const art = resolveDeviceIllustration(sg.label.split(/\s+/)[0] ?? '', 'gateway');
  if (art) {
    p.push(forPrintedSheet(art.render(gwCX, (ey0+ey1)/2, encW-12, encH-12)));
  } else {
    p.push(txt(gwCX, (ey0+ey1)/2+3, 'GATEWAY', {sz:F.hdr, bold:true, anc:'middle'}));
  }
  p.push(txt(gwCX, ey0-8, '(N) MONITORING GATEWAY', {sz:F.hdr, bold:true, anc:'middle'}));
  const nlX = ex0 - 8;
  p.push(txt(nlX, ey0+30, esc(sg.label), {sz:F.tiny, anc:'end', italic:true}));
  if (sg.partNumber) p.push(txt(nlX, ey0+30+pitch, `P/N ${esc(sg.partNumber)}`, {sz:F.tiny, anc:'end'}));
  p.push(txt(nlX, ey0+30+(sg.partNumber ? 2 : 1)*pitch, 'NEMA 3R ENCL. IF OUTDOORS', {sz:F.tiny, anc:'end'}));
  return {parts: p, ex0, ex1, ey1};
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
/**
 * THE equipment-schedule / symbol capacity cell.
 *
 * 🚨 EVERY CAPACITY GATE HERE USED TO BE `input.batteryKwh` BEING TRUTHY, so
 * an unresolved battery DELETED the 'Battery Capacity' row from the schedule
 * and blanked the label under the drawn battery — while PV-1 printed a
 * fabricated 5.0 kWh and PV-5 printed 10.0 for the same design. A row that
 * silently disappears is the same defect as a wrong one, made quieter.
 * The single permit-wide authority is helpers.resolveBatteryCapacity; this
 * renderer prints the label it produced and never re-decides.
 */
function batteryCapacityCell(kwh?: number | null, kwhLabel?: string | null): string {
  const label = (kwhLabel ?? '').trim();
  if (label) return label;
  if (typeof kwh === 'number' && kwh > 0) return `${kwh} kWh`;
  return BATTERY_CAPACITY_UNRESOLVED;
}

function renderBattery(
  cx: number, cy: number,
  model: string, kwh: number, backfeedA: number, calloutN: number,
  manufacturer: string = '',
  kwhLabel: string = '',
  /** Its conductor drops from its bottom centre (the single-lane sheet), so
   *  its nameplate goes LEFT of that drop instead of across it. Absent ⇒
   *  centred under it, as before. */
  opts?: {labelsLeftOfDrop?: boolean},
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
  // The box the illustration really occupies: it keeps its own aspect inside
  // the slot (the IQ Battery 5P is 102 uu tall in a 139 uu slot), and the
  // conductor, the nameplate and the callout hang from IT — tied to the 170 uu
  // slot, the conductor started 30 uu under the art and the callout bubble
  // floated far above-right of it.
  const _batArt = _batDevice ? illustrationBox(_batDevice, cx, cy, W2 * 0.78, H2 * 0.82) : null;
  if (_batDevice) {
    p.push(forPrintedSheet(_batDevice.render(cx, cy, W2 * 0.78, H2 * 0.82)));
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

  // The drawn body: the illustration's own box, or the full generic slot.
  const _bx0 = _batArt ? _batArt.x0 : bx, _bx1 = _batArt ? _batArt.x1 : bx + W2;
  const _by0 = _batArt ? _batArt.y0 : by2, _by1 = _batArt ? _batArt.y1 : by2 + H2;

  // Labels below
  const _left = !!opts?.labelsLeftOfDrop;
  const _lx = _left ? cx - 8 : cx, _la = _left ? 'end' as const : 'middle' as const;
  const _lp = _left ? LBL_PITCH : 9;
  p.push(txt(_lx, _by1 + 16, model ? model.substring(0, 22) : 'BATTERY STORAGE', {sz: F.tiny, anc: _la, italic: true}));
  // The label is NEVER blank for a battery that is on the drawing.
  const _capCell = batteryCapacityCell(kwh, kwhLabel);
  p.push(txt(_lx, _by1 + 16 + _lp, _capCell, {sz: F.tiny, anc: _la, bold: true, fill: _capCell === BATTERY_CAPACITY_UNRESOLVED ? '#C62828' : BAT_HDR}));
  if (backfeedA > 0) {
    p.push(txt(_lx, _by1 + 16 + 2*_lp, `${backfeedA}A BACKFEED — NEC 705.12(B)`, {sz: F.tiny, anc: _la, fill: BAT_HDR}));
  }

  // BAT_AC_OUT: the bottom centre of the drawn body, so the wire drops
  // straight down to the BUI BATTERY port.
  const acOutX = cx;            // centre X (aligns with BUI batPortX)
  const acOutY = _by1;          // bottom edge of what is drawn
  if (!_batArt) {
    // The generic emblem's own AC terminals: its right-side lug stub, and the
    // bottom lug the connection leaves from. (An illustration draws neither —
    // a stub beside it printed as an orphan blue dash 20 uu off the art.)
    const acPt = getAnchorPoint('battery-ac', 'ac_l1', cx, cy, W2, H2);
    p.push(ln(acPt.x, acPt.y, acPt.x + 10, acPt.y, {stroke: BAT_HDR, sw: SW_MED}));
    p.push(ln(acOutX, acOutY - 4, acOutX, acOutY, {stroke: BAT_HDR, sw: SW_MED}));
  }
  console.log(`[SLD WIRE TYPE: AC] battery-ac.bottom → (${acOutX.toFixed(1)},${acOutY.toFixed(1)})`);

  p.push(callout(_bx1 + 14, _by0 - 5, calloutN));
  return {svg: p.join(''), lx: _bx0, rx: _bx1, ty: _by0, by: _by1,
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
  // Pitched for the printed size (at 9 uu the two lines touched).
  p.push(txt(cx, cy + r + 13, kw > 0 ? `${kw} kW / ${Math.round(kw*1000/240)}A` : '', {sz: F.tiny, anc: 'middle', fill: GEN_CLR}));
  p.push(txt(cx, cy + r + 13 + LBL_PITCH, 'NEC 702.5 \u2014 TRANSFER EQUIP. REQ.', {sz: F.tiny, anc: 'middle', italic: true, fill: GEN_CLR}));
  p.push(callout(cx + r + 14, cy - r - 5, calloutN));

  // GEN_OUT terminal — right side lug (wire exits rightward to ATS GEN or BUI GEN port)
  const genOutX = cx + r + 10;
  const genOutY = cy;
  // Under the output conductor, not over it: above, the callout bubble and
  // the conductor's own callout sit there.
  p.push(txt(cx + r + 2, cy + 12, 'GEN OUT', {sz: 4, anc: 'start', fill: GEN_CLR}));

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
//
// Laid out for the size that prints. At 140 uu wide its 8.67 uu type had no
// room: '100A MAIN' and the breaker's own '100A' printed on each other and on
// the header rule, the main's drop struck through the centred 'CRIT. LOADS
// BUS', and nothing connected the feeder lug to the main. Now: the feeder
// enters on the RIGHT wall straight into the main breaker (the unit feeding it
// sits up and to the right), the main's rating prints beside it, the bus's
// name sits under the bus clear of the branch breakers, and the callout
// bubble is on the LEFT, away from the feeder.
function renderBackupPanel(
  cx: number, cy: number,
  brand: string, ampRating: number, calloutN: number
): {svg: string; lx: number; rx: number; ty: number; by: number;
    /** Where the feeder lands: the end of the stub outside the right wall. */
    feedInX: number; feedInY: number;
    /** Bottom of the printed nameplate block under the panel. */
    lblBot: number} {
  const W2 = 170, H2 = 120;
  console.log(`[SLD SYMBOL SIZE USED] backup-panel (custom): ${W2}×${H2}`);
  const bx = cx - W2/2, by2 = cy - H2/2;
  const BP_CLR = '#6A1B9A';
  const p: string[] = [];

  p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BP_CLR, sw: SW_MED}));
  p.push(ln(bx, by2 + 14, bx + W2, by2 + 14, {stroke: BP_CLR, sw: SW_THIN}));
  p.push(txt(cx, by2 + 10, 'BACKUP SUB-PANEL', {sz: 5.5, bold: true, anc: 'middle', fill: BP_CLR}));

  // Main breaker, fed from the right-wall lug on its own level.
  const mbY = by2 + 32;
  p.push(breakerSymbol(cx, mbY, 28, 12));
  p.push(txt(cx - 19, mbY + 3, `${ampRating}A MAIN`, {sz: 5, anc: 'end', bold: true, fill: BP_CLR}));
  p.push(lug(bx + W2, mbY));
  p.push(ln(cx + 14, mbY, bx + W2 - 3, mbY, {stroke: BP_CLR, sw: SW_MED}));
  p.push(ln(bx + W2 + 3, mbY, bx + W2 + 10, mbY, {stroke: BP_CLR, sw: SW_MED}));

  const busY2 = mbY + 22;
  p.push(busbar(bx + 8, bx + W2 - 8, busY2));
  p.push(ln(cx, mbY + 6, cx, busY2, {sw: SW_MED}));

  for (let i = 0; i < 3; i++) {
    const lx3 = bx + 16 + i * 24;
    p.push(ln(lx3, busY2, lx3, busY2 + 14, {sw: SW_THIN, stroke: BP_CLR}));
    p.push(breakerSymbol(lx3, busY2 + 20, 14, 10));
  }
  p.push(txt(bx + W2 - 8, busY2 + 14, 'CRIT. LOADS BUS', {sz: 5.5, anc: 'end', bold: true}));

  const l0 = by2 + H2 + 13;
  p.push(txt(cx, l0, brand || 'BACKUP PANEL', {sz: F.tiny, anc: 'middle', italic: true}));
  p.push(txt(cx, l0 + LBL_PITCH, 'CRITICAL LOADS ONLY', {sz: F.tiny, anc: 'middle', fill: BP_CLR}));
  p.push(callout(bx - 14, by2 - 5, calloutN));

  return {svg: p.join(''), lx: bx - 24, rx: bx + W2 + 10, ty: by2 - 15, by: by2 + H2,
          feedInX: bx + W2 + 10, feedInY: mbY, lblBot: l0 + LBL_PITCH + descUu(F.tiny)};
}

// Backup Interface Unit (BUI) Symbol
// Handles: Enphase IQ SC3, Tesla Backup Gateway, generic BUI
// Placed between MSP and utility meter on the right side of the bus
function renderBUI(
  cx: number, cy: number,
  brand: string, model: string, ampRating: number,
  buiBrand: string,      // normalised lowercase brand key e.g. 'enphase', 'tesla', 'solark'
  hasGenerator: boolean, calloutN: number,
  /** The battery is drawn ABOVE this unit (the single-lane sheet): its port
   *  is on the TOP edge, so the battery conductor lands without crossing the
   *  unit, its header and its art (it ran through all three to a port on the
   *  bottom edge). The unit is then named once, by the block under it — the
   *  header strip repeated that name, on top of the brand's own art. Absent ⇒
   *  drawn as before. */
  opts?: {batteryAbove?: boolean},
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
    p.push(forPrintedSheet(_buiDevice.render(cx, cy, W2 * 0.94, H2 * 0.94)));
  } else {
    // Plain enclosure (legacy look)
    p.push(rect(bx, by2, W2, H2, {fill: WHT, stroke: BUI_CLR, sw: SW_MED}));
  }
  const _batAbove = !!opts?.batteryAbove;
  if (!_batAbove) {
    p.push(ln(bx, by2+14, bx+W2, by2+14, {stroke: BUI_CLR, sw: SW_THIN}));

    // Header text
    const headerText = _buiHeaderText;
    p.push(txt(cx, by2+10, headerText, {sz: 5.5, bold: true, anc: 'middle', fill: BUI_CLR}));
  }

  // GRID input lug (left side, upper). The transfer path (GRID → blade → LOAD)
  // is ONE level run. Over a brand's illustration it runs at cy−7, in the band
  // the art leaves clear under its display and door seam: at cy it crossed the
  // IQ System Controller's nameplate panel, 0.5 uu over the caps of its words
  // (Ray's "overlays" review, 2026-09-26), with a 20 uu bus stub dropping into
  // that panel's edge.
  const gridY = _buiDevice ? cy - 7 : cy - 14;
  p.push(lug(bx+8, gridY));
  p.push(txt(bx+8, gridY-8, 'GRID', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(bx, gridY, bx+8, gridY, {stroke: BUI_CLR, sw: SW_MED}));

  // GEN input lug (left side, lower) — only if generator configured
  const genInputY = cy + 14;
  if (hasGenerator) {
    p.push(lug(bx+8, genInputY));
    // Outside the wall, over the incoming generator conductor: centred on the
    // lug it straddled the wall, and the lug's own ring ran through it.
    p.push(txt(bx-4, genInputY-4, 'GEN', {sz: 4.5, anc: 'end', fill: '#2E7D32'}));
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

  // Internal bus (vertical center) — only where it joins two sources (a
  // generator's blade to the grid's). With the grid alone the transfer path
  // runs straight through to LOAD, level: the old 20 uu stub below it led
  // nowhere.
  const busX2 = bx + 55;
  if (hasGenerator) p.push(ln(busX2, gridY, busX2, genInputY, {stroke: BUI_CLR, sw: 2.5}));
  p.push(ln(bx+42, gridY, busX2, gridY, {stroke: BUI_CLR, sw: SW_THIN}));
  if (hasGenerator) {
    p.push(ln(bx+42, genInputY, busX2, genInputY, {stroke: BUI_CLR, sw: SW_THIN}));
  }

  // LOAD output lug (right side), on the transfer path's own level.
  const loadY = gridY;
  p.push(lug(bx+W2-8, loadY));
  p.push(txt(bx+W2-8, loadY-8, 'LOAD', {sz: 4.5, anc: 'middle', fill: '#444'}));
  p.push(ln(busX2, loadY, bx+W2-8, loadY, {stroke: BUI_CLR, sw: SW_MED}));
  p.push(ln(bx+W2-8, loadY, bx+W2, loadY, {stroke: BUI_CLR, sw: SW_MED}));

  // BATTERY port (bottom center — or top center when the battery is above)
  const batPortX2 = cx;
  const batPortY2 = _batAbove ? by2 : by2 + H2;
  if (_batAbove) {
    p.push(lug(batPortX2, batPortY2+4));
    p.push(txt(batPortX2+7, batPortY2-4, 'BATTERY', {sz: 4.5, anc: 'start', fill: BUI_CLR}));
    p.push(ln(batPortX2, batPortY2, batPortX2, batPortY2+4, {stroke: BUI_CLR, sw: SW_MED}));
  } else {
    p.push(lug(batPortX2, batPortY2-4));
    p.push(txt(batPortX2, batPortY2+8, 'BATTERY', {sz: 4.5, anc: 'middle', fill: BUI_CLR}));
    p.push(ln(batPortX2, batPortY2-4, batPortX2, batPortY2, {stroke: BUI_CLR, sw: SW_MED}));
  }

  // Labels below (pitched for the printed size when the port left the bottom)
  const labelBrand = brand || (buiBrand ? buiBrand.charAt(0).toUpperCase() + buiBrand.slice(1) : 'BUI');
  const labelModel = model || _buiDefaultModel;
  const _l0 = by2+H2+(_batAbove ? 14 : 18), _lp = _batAbove ? LBL_PITCH : 9;
  p.push(txt(cx, _l0, `${labelBrand} ${labelModel}`, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));
  p.push(txt(cx, _l0+_lp, ampRating > 0 ? `${ampRating}A` : '200A', {sz: F.tiny, anc: 'middle', bold: true, fill: BUI_CLR}));
  p.push(txt(cx, _l0+2*_lp, _buiNecNote, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  return {
    svg: p.join(''),
    lx: bx-10, rx: bx+W2+10,
    ty: by2, by: by2+H2,
    batPortX: batPortX2, batPortY: batPortY2,
    loadPortX: bx+W2, loadPortY: loadY,
    gridPortX: bx,     gridPortY: gridY,     // GRID lug -- left edge, upper
    genPortX:  bx,     genPortY:  cy + 14,   // GEN lug  -- left edge, lower
  };
}

// Professional Inverter Box v3 — embeds sld-symbols.ts hybrid realism emblem
function renderInverterBox(
  cx: number, cy: number,
  manufacturer: string, model: string,
  acKw: number, acAmps: number,
  topologyLabel: string, mpptAllocation: string,
  calloutN: number,
  unselected = false,
  /** Nameplate block pitch (see LBL_PITCH). Absent ⇒ 9, as before. */
  labelPitch?: number,
): {svg: string; lx: number; rx: number;
    dcInX: number; dcInY: number; acOutX: number; acOutY: number;
    /** Where its ground conductor leaves: the generic symbol's ground terminal
     *  dot, or the foot of the brand's illustration. */
    gndTop: number;
    /** The nameplate block under the symbol — a ground drop stops at it. */
    lbl: LabelBand} {
  // SOT: symbol size from SLD_SYMBOL_MAP['inverter'] = 200×170
  const W2 = SLD_SYMBOL_MAP['inverter'].width;   // 200
  const H2 = SLD_SYMBOL_MAP['inverter'].height;  // 170
  console.log(`[SLD SYMBOL SIZE USED] inverter: ${W2}×${H2}`);
  const bx = cx - W2/2, by2 = cy - H2/2;
  const p: string[] = [];

  // v58.16 — Device illustration first (brand-specific front-view silhouette).
  // Falls back to the generic IEEE emblem + wordmark badge if no illustration
  // is registered for the brand.
  const term = inverterTerminals(manufacturer, cx, cy);
  const _invDevice = term.device;
  const art = term.art;
  if (_invDevice) {
    // Draw the device illustration inside the symbol's visual slot. The slot
    // is inset from the full symbol so we leave room for the label strip
    // beneath it and the callout bubble at the top-right.
    p.push(forPrintedSheet(_invDevice.render(cx, cy, INV_ART_SLOT_W, INV_ART_SLOT_H)));
  } else {
    // Embed the generic hybrid realism inverter emblem
    p.push(embedSymbol('inverter', cx, cy, W2, H2));
    // v58.15 brand wordmark badge overlay (top-right corner of cabinet).
    const _invSym = SLD_SYMBOL_MAP['inverter'];
    if (_invSym) {
      const _invScale = Math.min(W2 / _invSym.width, H2 / _invSym.height);
      const _invOx = cx - (_invSym.width * _invScale) / 2;
      const _invOy = cy - (_invSym.height * _invScale) / 2;
      // 146..194 of the 200 uu symbol: the cabinet's own label (mono, centred
      // on 100) ends at 140.5, and a badge starting at 140 butted its last
      // letter ('STRING INVERTE|Fronius').
      const _emblemNative = emitBrandEmblem(manufacturer, 146, 10, 48, 14);
      if (_emblemNative) {
        p.push(`<g transform="translate(${_invOx.toFixed(1)},${_invOy.toFixed(1)}) scale(${_invScale.toFixed(4)})">${_emblemNative}</g>`);
      }
    }
  }

  // Manufacturer + model labels below. FAIL-LOUD: an unselected inverter draws
  // the full '⚠ INVERTER NOT SELECTED — PV-<KEY>' marker in red (never
  // truncated, no kW/A row) so it's impossible to miss on the E-1 nameplate.
  const mfgLabel = manufacturer ? `${manufacturer}` : '';
  const mdlLabel = unselected ? model : (model ? model.substring(0, 18) : '');
  // A caller that states its pitch gets the block clear of the symbol's own
  // ground terminal (its dot hangs 4.75 uu below the slot) as well. Under an
  // illustration the block hangs from the ART's foot: the art keeps its own
  // aspect and ends ~15 uu above the slot, and the block floated below it.
  const _lp = labelPitch ?? 9;
  const _foot = art ? art.y1 : by2+H2;
  const _l0 = _foot+(labelPitch ? 15 : 9);
  p.push(txt(cx, _l0,  mfgLabel, {sz: F.sub,   anc: 'middle', italic: true}));
  p.push(txt(cx, _l0+_lp, mdlLabel, {sz: F.label,  anc: 'middle', bold: true, ...(unselected ? {fill: '#C62828'} : {})}));
  p.push(txt(cx, _l0+2*_lp, (!unselected && acKw > 0) ? `${acKw} kW / ${acAmps}A` : '', {sz: F.tiny, anc: 'middle'}));
  const lbl = labelBand(_l0, _l0+(mpptAllocation ? 3 : 2)*_lp, F.tiny);
  if (mpptAllocation) {
    p.push(txt(cx, _l0+3*_lp, `MPPT: ${mpptAllocation}`, {sz: F.tiny, anc: 'middle', fill: '#555'}));
    if (typeof console !== 'undefined') {
      console.log('[SLD STRING LANDING] mpptAllocation=' + mpptAllocation);
    }
  }

  // Topology label above — over the art's top when an illustration is drawn.
  const _top = art ? art.y0 : by2;
  p.push(txt(cx, _top-10, topologyLabel, {sz: F.hdr, bold: true, anc: 'middle'}));

  // Terminal stubs (inverterTerminals): 10 uu out of the drawn body on each
  // side, the conductors' landing points.
  const {dcInX, dcInY, acOutX: acOutX2, acOutY: acOutY2} = term;
  p.push(ln(dcInX, dcInY, dcInX + 10, dcInY, {sw: SW_MED}));
  p.push(ln(acOutX2 - 10, acOutY2, acOutX2, acOutY2, {sw: SW_MED}));
  console.log(`[SLD WIRE TYPE: DC] inverter.dc_in → (${(dcInX + 10).toFixed(1)},${dcInY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] inverter.ac_out → (${(acOutX2 - 10).toFixed(1)},${acOutY2.toFixed(1)})`);

  // Callout — at the drawn body's shoulder (the slot's floated 25 uu off an
  // illustration).
  p.push(callout((art ? art.x1 : bx+W2)+14, _top-5, calloutN));

  return {svg: p.join(''), lx: bx-10, rx: bx+W2+10,
          dcInX, dcInY, acOutX: acOutX2, acOutY: acOutY2,
          gndTop: art ? art.y1 : by2+H2+4.75, lbl};
}

/** An inverter illustration's slot inside the 200 × 170 symbol slot. */
const INV_ART_SLOT_W = SLD_SYMBOL_MAP['inverter'].width * 0.78;
const INV_ART_SLOT_H = SLD_SYMBOL_MAP['inverter'].height * 0.82;

/**
 * Where an inverter's conductors land — computed before the inverter is drawn
 * as well (a run drawn first must end on it).
 *
 * The generic symbol: its own anchors (DC+ at native (0,60), AC L1 at (200,75)
 * — 25 and 10 uu above its centre line), 10 uu stubs outside the slot. A
 * brand's ILLUSTRATION keeps its native aspect inside the slot — the SolarEdge
 * Home Hub is 100 uu wide in a 200 uu slot — so its stubs leave the ART's own
 * left and right edges, on the chain's centre line. Tied to the slot, both
 * stubs floated 50 uu out in white space and neither conductor reached the
 * inverter (Ray's "overlays" review, 2026-09-26).
 */
function inverterTerminals(manufacturer: string, cx: number, cy: number): {
    device: DeviceIllustration | null;
    art: ReturnType<typeof illustrationBox> | null;
    dcInX: number; dcInY: number; acOutX: number; acOutY: number} {
  const device = resolveDeviceIllustration(manufacturer, 'inverter');
  if (device) {
    const art = illustrationBox(device, cx, cy, INV_ART_SLOT_W, INV_ART_SLOT_H);
    return {device, art, dcInX: art.x0 - 10, dcInY: cy, acOutX: art.x1 + 10, acOutY: cy};
  }
  const W2 = SLD_SYMBOL_MAP['inverter'].width, H2 = SLD_SYMBOL_MAP['inverter'].height;
  const dc = getAnchorPoint('inverter', 'dc_in_pos', cx, cy, W2, H2);
  const ac = getAnchorPoint('inverter', 'ac_out', cx, cy, W2, H2);
  return {device: null, art: null, dcInX: dc.x - 10, dcInY: dc.y, acOutX: ac.x + 10, acOutY: ac.y};
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
  envOrOpenAir: WireEnvironment | boolean,
  /** Draw the N conductor when there is NO engine run (permit E-1 passes
   *  none). With a run, `run.neutralRequired` decides, exactly as before. */
  neutralWhenNoRun = false,
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
    if (run ? run.neutralRequired : neutralWhenNoRun) {
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
  opts: { above?: boolean; fit?: number;
    /** With `fit`: the stretch of the run the callout may occupy, where it
     *  differs from the drawn line (a line that runs on under a symbol, or
     *  starts beside a stub the callout must clear). */
    labelSpan?: [number, number] } = {}
): string {
  const { from, to, conductors, isOpenAir } = wr;
  const env: WireEnvironment = wr.environment ?? (isOpenAir ? 'OPEN_AIR' : 'RACEWAY');
  const x1 = from.x, x2 = to.x, baseY = from.y;
  const [lx1, lx2]: [number, number] = opts.fit != null && opts.labelSpan ? opts.labelSpan : [x1, x2];
  const cx = (lx1 + lx2) / 2;
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
  // `fit` (the clearance, uu, the callout keeps from each end of the run —
  // a terminal dot, or a disconnect's entry stubs): the callout stays over ITS
  // OWN span. A line wider than that is broken at its natural joints (' + ',
  // ' / ', ' — '; see calloutCuts) — at the printed size '2×#10 DC+ / 2×#10
  // DC- + #12 EGC' and 'OPEN AIR — NEC 690.31(C)' ran over the PV array and
  // the J-box on either side of a 120 uu run — and the lines are pitched for
  // 8.67 uu type (at 9, a '(' line touched the caps under it). A run whose
  // callout has a phrase wider than the run is given a longer run instead
  // (see the PV → J-box gap). Absent ⇒ as before.
  const rawLabels = (wr.calloutLines && wr.calloutLines.length > 0) ? wr.calloutLines : labelLines;
  const activeLabels = opts.fit != null
    ? rawLabels.flatMap(l => wrapToWidth(l, Math.abs(lx2 - lx1) - 2 * opts.fit!, F.seg))
    : rawLabels;
  if (activeLabels.length > 0) {
    const primaryColor = dedupedSig.length > 0
      ? getConductorStyle(dedupedSig[0].type, env).stroke
      : BLK;
    const lh = opts.fit != null ? LBL_PITCH : Math.round(F.seg * 1.35);
    const th = activeLabels.length * lh;
    const ty = above ? baseY - LABEL_OFFSET_ABOVE - th + lh : baseY + LABEL_OFFSET_BELOW;
    parts.push(tspan(cx, ty, activeLabels, { sz: F.seg, anc: 'middle', fill: primaryColor, ...(opts.fit != null ? {lh} : {}) }));
  }

  return parts.join('');
}

/** The joints a conductor callout may be broken at: ' + ' (the '+' starts the
 *  next piece), after ' / ' or after ' — '. Never at a plain space — a phrase
 *  such as 'EGC: PENDING MFR AUTHORITY' or 'ENPHASE Q CABLE (TC-ER)' is one
 *  statement and is read (and pinned) whole. */
function calloutCuts(line: string): Array<{at: number; keep: number}> {
  const cuts: Array<{at: number; keep: number}> = [];
  for (const [sep, keepLeft] of [[' + ', 0], [' / ', 2], [' — ', 2]] as const) {
    for (let i = line.indexOf(sep); i > 0; i = line.indexOf(sep, i + 1)) cuts.push({at: i, keep: keepLeft});
  }
  return cuts.sort((a, b) => a.at - b.at);
}
/** Break one callout line at its joints so no piece is wider than `maxW` at
 *  the printed size, greedily. A piece with no joint left stays whole. */
function wrapToWidth(line: string, maxW: number, sz: number): string[] {
  if (maxW <= 0 || textWidthUu(line, sz) <= maxW) return [line];
  const fits = (s: string) => textWidthUu(s, sz) <= maxW;
  const cuts = calloutCuts(line);
  const pick = [...cuts].reverse().find(c => fits(line.slice(0, c.at + c.keep).trimEnd())) ?? cuts[0];
  if (!pick) return [line];
  const head = line.slice(0, pick.at + pick.keep).trimEnd();
  const tail = line.slice(pick.at + pick.keep).trimStart();
  return [head, ...wrapToWidth(tail, maxW, sz)];
}
/** The widest piece of a callout once broken at EVERY joint: the least span
 *  its run needs to carry the callout without it overhanging a symbol. */
function widestCalloutPiece(lines: string[], sz: number): number {
  let w = 0;
  for (const line of lines) {
    let rest = line;
    for (;;) {
      const c = calloutCuts(rest)[0];
      if (!c) { w = Math.max(w, textWidthUu(rest, sz)); break; }
      w = Math.max(w, textWidthUu(rest.slice(0, c.at + c.keep).trimEnd(), sz));
      rest = rest.slice(c.at + c.keep).trimStart();
    }
  }
  return w;
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
    // Installed (phase + neutral) vs grounding — an imbalance-only neutral is
    // not current-carrying, but it is a WHT conductor, never a "GRN EGC".
    const hot = run.conductorBundle.filter((c:ConductorBundle) => !isGroundingConductor(c));
    const egc = run.conductorBundle.filter((c:ConductorBundle) => isGroundingConductor(c));
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

// ── The combiner nobody chose ────────────────────────────────────────────────
//
// 🚨 A DEVICE IS STILL DRAWN — WHAT CHANGES IS WHETHER THE SHEET CLAIMS IT.
// `sldCombinerFields().combinerSelectionIsDecided` (and, per lane, the hybrid
// plan's `combinerBasis`) says whether a human picked this box or whether it was
// derived from a compatibility declaration or from the last-resort literal that
// put an IQ Combiner 6C on a 5C job. Both artefacts computed it and nothing read
// it, so a permit reviewer saw "Enphase IQ Combiner 6C" with the same authority
// either way.
//
// The marker is the vocabulary these sheets already use for an answer the design
// does not have: '⚠ INVERTER NOT SELECTED — PV-<KEY>' (INVERTER_UNSELECTED,
// lib/permit/utils/helpers.ts), '⚠ ESS CAPACITY UNRESOLVED', 'BATT — SIZE
// UNRESOLVED' — a ⚠ + plain words + the same red. No new severity vocabulary,
// and the device's own name is NOT replaced: it is qualified, because the box
// still has to be buildable and the reviewer still has to see which one was
// assumed.
export const COMBINER_NOT_SELECTED = '⚠ NOT SELECTED';
/** The red the other fail-loud markers on these sheets use (see the inverter
 *  nameplate and the ESS capacity cell). */
const UNRESOLVED_RED = '#C62828';

/**
 * A schedule cell for a combiner, qualified when the device was not chosen.
 *
 * TRI-STATE: only an explicit `false` qualifies. `undefined` means the caller has
 * not answered the question and the cell reads exactly as it did before this
 * field existed — a builder that has not been wired must not be read as
 * asserting "nobody chose it".
 */
export function combinerScheduleCell(label: string, isDecided?: boolean): string {
  return isDecided === false ? `${label}  ${COMBINER_NOT_SELECTED}` : label;
}

// ── AC Combiner Panel (internal structure) ───────────────────────────────────
function renderCombiner(
  cx: number, cy: number,
  nBranches: number, branchOcpd: number,
  label: string, calloutN: number,
  opts?: {integratedGateway?: boolean; providesDisconnect?: boolean;
          /** Per-branch OCPDs in branch order (B1..Bn) from the shared branch
           *  plan — a plane-contained 12-micro branch runs 25A while its
           *  siblings run 20A, so one uniform `branchOcpd` mislabels it. */
          branchOcpds?: number[];
          /** True ⇔ this device was DERIVED, not chosen — draw the qualifier
           *  under the nameplate. Undefined ⇒ the caller did not answer and the
           *  symbol is drawn exactly as before. */
          selectionUnresolved?: boolean;
          /** The feeder leaving this combiner carries a neutral (the IQ
           *  Gateway inside is powered line-to-neutral). Draws the N terminal
           *  and the gateway's neutral reference. */
          neutral?: boolean;
          /** Where the PRODUCTION CT is (designMetering): integral to this
           *  combiner, field-installed on its output circuit, or — standalone
           *  gateway — field-installed on L1 in THIS panel (the panel the
           *  branches land in). The union is the composer's, never restated. */
          productionCt?: NonNullable<SldMeteringDrawing['production']>['where'];
          /** Draw the CT-lead continuation bubble at the gateway. */
          ctLeadConnector?: boolean;
          /** The CT leads are drawn as real dashed conductors
           *  (meteringDrawing.leads): no "CT" continuation bubble here — the
           *  caller routes the lead to `gatewayLeadIn`. */
          drawnCtLeads?: boolean;
          /** Front-view art for the gateway inside this combiner (the IQ
           *  Gateway IS the gateway inside an IQ Combiner). null ⇒ a plain
           *  labelled box. */
          gatewayArt?: DeviceIllustration | null;
          /** STANDALONE gateway: its 2-pole supply breaker (A) in THIS panel.
           *  Draws the breaker on the bus and returns where its supply
           *  conductor leaves the enclosure (`gatewaySupplyOut`). */
          gatewaySupplyBreakerA?: number;
          /** The PCT tag's baseline above its ring (ctRing's `tagGap`). The
           *  hybrid sheet can be drawn below 1:1, where the default 6 is a near
           *  miss; absent ⇒ the default, and the symbol is drawn as before. */
          ctTagGap?: number;
          /** The caller prints the node's name ABOVE the enclosure (the
           *  single-lane sheet's 'AC COMBINER' header): no title strip inside,
           *  or the sheet says 'AC COMBINER' twice, 20 uu apart (Ray,
           *  2026-09-26). Absent ⇒ the strip is drawn, as before. */
          headerAbove?: boolean;
          /** Nameplate block pitch (see LBL_PITCH). Absent ⇒ 9, as before. */
          labelPitch?: number},
): {svg:string; lx:number; rx:number; ty:number; by:number;
    feederOutX:number; feederOutY:number;
    /** Top of the production-CT ring — where its lead leaves — when drawn. */
    prodCtTop?: {x:number; y:number};
    /** Where a drawn CT lead meets the gateway inside this combiner. */
    gatewayLeadIn?: {x:number; y:number};
    /** Where a standalone gateway's supply conductor leaves the enclosure. */
    gatewaySupplyOut?: {x:number; y:number};
    /** The nameplate block under the enclosure — a ground drop stops at it. */
    lbl: LabelBand} {
  // SOT: symbol size from SLD_SYMBOL_MAP['ac-combiner'] = 180×160
  const W2 = SLD_SYMBOL_MAP['ac-combiner'].width;   // 180
  const H2 = SLD_SYMBOL_MAP['ac-combiner'].height;  // 160
  console.log(`[SLD SYMBOL SIZE USED] ac-combiner: ${W2}×${H2}`);
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure — clean outline only
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  // Header
  if (!opts?.headerAbove) {
    p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
    p.push(txt(cx, by2+10, 'AC COMBINER', {sz:6, bold:true, anc:'middle'}));
  }

  // Internal combiner bus
  const busY = cy + 8;
  p.push(busbar(bx+10, bx+W2-10, busY));
  p.push(txt(cx, busY-5, 'BUS', {sz:5, anc:'middle'}));

  // Branch breakers — each branch circuit terminates here, labeled with its
  // OWN OCPD from the branch plan when provided (never one uniform figure).
  const nShow = Math.min(nBranches, 4);
  const brkSpacing = (H2-22) / (nShow+1);
  // Evenly spaced, four breakers put the third one's rating ON the bus (its
  // label rides 7 uu above it, and it sits 13 uu under the bus). Four go two
  // above and two below the bus instead, every rating clear of it.
  const brYs = nShow === 4
    ? [busY-45, busY-20, busY+20, busY+45]
    : Array.from({length: nShow}, (_, b) => by2 + 18 + brkSpacing*(b+1));
  for (let b = 0; b < nShow; b++) {
    const brY = brYs[b];
    // Input lug on left wall
    p.push(lug(bx+4, brY));
    // Wire lug → breaker
    p.push(ln(bx+7, brY, bx+20, brY, {sw:SW_THIN}));
    // Breaker
    p.push(breakerSymbol(bx+29, brY, 16, 10, opts?.branchOcpds?.[b] ?? branchOcpd));
    // Wire breaker → bus
    p.push(ln(bx+37, brY, cx-5, busY, {sw:SW_THIN}));
  }
  if (nBranches > 4) {
    // Under the last breaker drawn. At busY-12 it sat on the second breaker and
    // on its breaker-to-bus wire.
    const lastBrY = brYs[nShow-1];
    p.push(txt(bx+29, lastBrY+17, `+${nBranches-4}`, {sz:5, anc:'middle', fill:'#666'}));
  }

  // Feeder lug on right wall
  p.push(ln(bx+W2-10, busY, bx+W2-4, busY, {sw:SW_THIN}));
  p.push(lug(bx+W2-4, busY));
  // Output wire stub
  p.push(ln(bx+W2, busY, bx+W2+10, busY, {sw:SW_MED}));

  // The integrated gateway sits in the enclosure's TOP-RIGHT, above the bus —
  // where the IQ Gateway board sits in a real IQ Combiner, and the one place a
  // CT lead can leave the box without crossing the bus, the neutral, the
  // nameplate labels or the feeder. (It used to sit bottom-right, where the
  // only way out for a lead was through all four.)
  const gwArtCX = bx+W2-38, gwArtCY = by2+44, gwArtW = 64, gwArtH = 38;   // 750–814 × 424–462 at cx 730
  // Half the height of what is actually DRAWN there — the brand's art, or with
  // no art a 56×20 box. The drawn lead and the neutral reference end on its
  // edge; ending them at the art's edge would stop them 9 uu short of the box.
  const gwHalfH = opts?.gatewayArt ? gwArtH/2 : 10;
  const gwArtBottom = gwArtCY + gwHalfH;

  // Neutral terminal — the feeder to the disconnect is L1, L2 AND N; the
  // gateway's supply/metering reference lands on it (Ray, 2026-09-25).
  if (opts?.neutral) {
    const nY = busY + 14;
    p.push(ln(bx+W2-44, nY, bx+W2-4, nY, {sw:SW_THIN}));
    p.push(txt(bx+W2-48, nY+2, 'N', {sz:5, bold:true, anc:'middle'}));
    p.push(lug(bx+W2-4, nY));
    p.push(ln(bx+W2, nY, bx+W2+10, busY, {sw:SW_THIN}));
    if (opts?.integratedGateway) {
      // Gateway neutral reference (dashed): N terminal → the gateway's terminal
      // block (the foot of the art), crossing the bus square — clear of the
      // PCT ring and its tag at the bus's right end.
      p.push(ln(bx+W2-36, nY, bx+W2-36, gwArtBottom, {sw:SW_THIN, dash:'2,1.5'}));
    }
  }

  // Integrated IQ Gateway (the "brains") drawn inside the enclosure when the
  // combiner integrates the monitoring gateway — so the SLD shows it's one
  // device, not a separate wall-mounted Envoy. Drawn as the gateway itself
  // (the brand's front-view art) when the brand has one.
  let gatewayLeadIn: {x:number; y:number} | undefined;
  if (opts?.integratedGateway) {
    if (opts.gatewayArt) {
      p.push(forPrintedSheet(opts.gatewayArt.render(gwArtCX, gwArtCY, gwArtW, gwArtH)));
    } else {
      // No art for this brand: a plain labelled box, one word at the type
      // floor (the old two-line 'IQ GATEWAY / MONITOR/METER' overflowed its
      // 50 uu box once the floor raised it — and 'IQ' names one brand).
      p.push(rect(gwArtCX-28, gwArtCY-10, 56, 20, {fill:'#eef4fb', stroke:'#2b5c9c', sw:SW_THIN}));
      p.push(txt(gwArtCX, gwArtCY+3, 'GATEWAY', {sz:MIN_TYPE_UU, bold:true, anc:'middle', fill:'#2b5c9c'}));
    }
    // A drawn lead arrives from above, into the LED strip at the art's right
    // (or onto the plain box's top edge).
    gatewayLeadIn = {x: bx+W2-12, y: gwArtCY - gwHalfH};
    // Legacy continuation: consumption-CT leads land on the gateway's CT inputs.
    if (opts?.ctLeadConnector && !opts.drawnCtLeads) {
      p.push(ln(bx+W2-80.5, gwArtCY, bx+W2-70, gwArtCY, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(bx+W2-86, gwArtCY));
    }
  }

  // STANDALONE gateway: its own 2-pole breaker on this panel's bus, in the
  // clear quadrant between the branch taps and the PCT, its conductor rising
  // out through the top of the enclosure to the gateway drawn above. The label
  // sits LEFT of the breaker: above it is the conductor, right of it the PCT
  // lead. (Enphase: "2-pole … ≤20 A", L1, L2 and N — the callout says which.)
  let gatewaySupplyOut: {x:number; y:number} | undefined;
  if (opts?.gatewaySupplyBreakerA && !opts.integratedGateway) {
    const gx = cx + 40, gy = busY - 35;
    p.push(ln(gx, busY, gx, gy+5, {sw:SW_THIN}));
    p.push(breakerSymbol(gx, gy, 16, 10));
    p.push(txt(gx-12, gy+3, `${opts.gatewaySupplyBreakerA}A 2P`, {sz:5.5, bold:true, anc:'end'}));
    p.push(txt(gx-12, gy+12, 'GATEWAY', {sz:5, anc:'end'}));
    p.push(ln(gx, gy-5, gx, by2, {sw:SW_THIN}));
    gatewaySupplyOut = {x: gx, y: by2};
  }

  // Production CT: integral (factory, on the combiner output bus), a field CT
  // on the output circuit just outside the enclosure, or — standalone gateway
  // — the gateway's own CT on L1 in this panel. A standalone PCT's lead rises
  // straight up from the ring, so its tag moves to the ring's LEFT.
  let prodCtTop: {x:number; y:number} | undefined;
  if (opts?.productionCt === 'combiner-integral') {
    p.push(ctRing(bx+W2-18, busY, 'PCT', 3.8, opts?.ctTagGap));
    prodCtTop = {x: bx+W2-18, y: busY-3.8};
  } else if (opts?.productionCt === 'landing-panel-field') {
    p.push(ctRing(bx+W2-18, busY, ''));
    p.push(txt(bx+W2-25, busY-6, 'PCT', {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    prodCtTop = {x: bx+W2-18, y: busY-3.8};
  } else if (opts?.productionCt === 'pv-output-circuit-field') {
    p.push(ctRing(bx+W2+5, busY, 'PCT', 3.8, opts?.ctTagGap));
    prodCtTop = {x: bx+W2+5, y: busY-3.8};
  }

  // Labels below box. A caller that states its pitch gets the block 3 uu
  // lower as well, so the block's caps clear the enclosure's bottom edge and a
  // ground drop leaving that edge shows before it breaks for the block.
  const _lp = opts?.labelPitch ?? 9;
  const _lbl0 = by2+H2+(opts?.labelPitch ? 13 : 10);
  let _lblY = _lbl0;
  p.push(txt(cx, _lblY, esc(label), {sz:F.tiny, anc:'middle', italic:true})); _lblY += _lp;
  // The qualifier rides directly under the nameplate it qualifies, so the model
  // and "nobody chose this" can never be read apart. Red + ⚠, same as the
  // unselected-inverter nameplate two symbols away on the same sheet.
  if (opts?.selectionUnresolved) {
    p.push(txt(cx, _lblY, `${COMBINER_NOT_SELECTED} — DERIVED, NOT AN INSTALLER DECISION`,
      {sz:F.tiny, anc:'middle', bold:true, fill:UNRESOLVED_RED})); _lblY += _lp;
  }
  p.push(txt(cx, _lblY, `${nBranches} branch input${nBranches === 1 ? '' : 's'}`, {sz:F.tiny, anc:'middle'})); _lblY += _lp;
  if (opts?.integratedGateway) { p.push(txt(cx, _lblY, 'INTEGRATED GATEWAY / MONITORING', {sz:F.tiny, anc:'middle', fill:'#2b5c9c'})); _lblY += _lp; }
  if (opts?.providesDisconnect) { p.push(txt(cx, _lblY, 'INTEGRAL AC DISCONNECT (LOAD-BREAK)', {sz:F.tiny, anc:'middle'})); _lblY += _lp; }
  p.push(txt(cx, _lblY, 'NEC 690.9, 705.10', {sz:F.tiny, anc:'middle', italic:true}));
  const lbl = labelBand(_lbl0, _lblY, F.tiny);

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
          feederOutX, feederOutY,
          ...(prodCtTop ? {prodCtTop} : {}),
          ...(gatewayLeadIn ? {gatewayLeadIn} : {}),
          ...(gatewaySupplyOut ? {gatewaySupplyOut} : {}),
          lbl};
}

// ── AC Disconnect (internal structure) ───────────────────────────────────────
function renderDisco(
  cx: number, cy: number,
  ocpd: number, calloutN: number,
  fusedTapOcpd = false,
  /** The feeder through this switch carries a neutral: draw it as an
   *  UNSWITCHED pass-through (the disconnect opens L1/L2 only). */
  withNeutral = false,
  /** Nameplate block pitch (see LBL_PITCH). Absent ⇒ 9, as before. */
  labelPitch?: number,
): {svg:string; lx:number; rx:number;
    loadInX:number; loadInY:number; lineOutX:number; lineOutY:number;
    /** The nameplate block under the enclosure — a ground drop stops at it. */
    lbl: LabelBand} {
  // SOT: symbol size from SLD_SYMBOL_MAP['ac-disconnect'] = 120×100
  const W2 = SLD_SYMBOL_MAP['ac-disconnect'].width;   // 120
  const H2 = SLD_SYMBOL_MAP['ac-disconnect'].height;  // 100
  console.log(`[SLD SYMBOL SIZE USED] ac-disconnect: ${W2}×${H2}`);
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure. No title strip inside it: every sheet that draws this switch
  // names it ABOVE the box ('(N) AC DISCONNECT', '(N) AC DISCONNECT — SYSTEM'),
  // and the strip printed 'AC DISCONNECT' a second time 23 uu under that name —
  // the duplicated-label class Ray named ("AC COMBINER is printed twice").
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));

  // Two poles: L1 and L2
  const poleY1 = cy - 8;
  const poleY2 = cy + 8;

  // ── LOAD terminals on LEFT (combiner feeds load side) ──────────────────
  // Arc shield is on LINE side (right/utility side) per NEC 690.13.
  // Combiner output → LOAD terminals (left side of disconnect).
  p.push(lug(bx+10, poleY1));
  p.push(lug(bx+10, poleY2));
  // Terminal designations, inside the enclosure and aligned to its walls. They
  // were centred on the lugs 10 uu in from the walls, so at the printed size
  // (they were authored at 4.5–5 uu) half of each word hung outside the box
  // and its wall ran through 'LOAD' / '(FROM COMBINER)' — Ray's screenshot.
  // '(FROM PV)': the load side is the PV side on every sheet that draws this
  // switch; 'COMBINER' was wrong on a string inverter's, and '(FROM COMBINER)'
  // and '(TO MSP)' do not fit side by side in a 120 uu box at 8.67 uu.
  const tY1 = poleY2+16, tY2 = poleY2+27;
  p.push(txt(bx+5, tY1, 'LOAD', {sz:5, anc:'start', bold:true, fill:'#333'}));
  p.push(txt(bx+5, tY2, '(FROM PV)', {sz:4.5, anc:'start', fill:'#555'}));

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
  p.push(txt(bx+W2-5, tY1, 'LINE', {sz:5, anc:'end', bold:true, fill:'#333'}));
  p.push(txt(bx+W2-5, tY2, '(TO MSP)', {sz:4.5, anc:'end', fill:'#555'}));

  // (No 'arc shield' bar or ⚡: a one-line diagram has no such convention, and
  // the 2 uu grey bar lay exactly on the strip's bottom rule, reading as a
  // smudged double rule on every sheet. The LINE / LOAD designations say which
  // side is energised from the utility.)

  // Input wire stubs: combiner → LOAD side (left)
  p.push(ln(bx-10, cy, bx, poleY1, {sw:SW_MED}));
  p.push(ln(bx-10, cy, bx, poleY2, {sw:SW_MED}));

  // Output wire stubs: LINE side (right) → MSP
  p.push(ln(bx+W2, poleY1, bx+W2+10, cy, {sw:SW_MED}));
  p.push(ln(bx+W2, poleY2, bx+W2+10, cy, {sw:SW_MED}));

  // Neutral — unswitched pass-through above the two poles (terminal to
  // terminal, no blade). Drawn only when the feeder carries one.
  if (withNeutral) {
    const poleN = cy - 26;
    p.push(lug(bx+10, poleN));
    p.push(lug(bx+W2-10, poleN));
    p.push(ln(bx+13, poleN, bx+W2-13, poleN, {sw:SW_THIN}));
    // The label names the conductor it sits on: IN the line, the line broken
    // for it (a drafting wipeout), the way a conductor is tagged. Above it, it
    // had 10 uu between this line and the header rule for 8.67 uu caps — it
    // touched both (Ray's screenshot: 'N — UNSWITCHED' on its line).
    const nLbl = 'N — UNSWITCHED';
    const nHalf = textWidthUu(nLbl, 4.2, true)/2 + 2;
    p.push(rect(cx-nHalf, poleN-4.5, nHalf*2, 9, {fill:WHT, stroke:'none', sw:0}));
    p.push(txt(cx, poleN+3, nLbl, {sz:4.2, anc:'middle', bold:true, fill:'#333'}));
    p.push(ln(bx-10, cy, bx, poleN, {sw:SW_THIN}));
    p.push(ln(bx+W2, poleN, bx+W2+10, cy, {sw:SW_THIN}));
  }

  // Labels below — a supply-side tap's disconnect IS the tap OCPD and must be
  // fused (NEC 705.11); load-side jobs keep the conventional non-fused disco.
  //
  // FRAME AND FUSE ARE TWO DIFFERENT NUMBERS. This printed a single value, so a
  // 25 A calculated OCPD came out as "25A FUSED" — and there is no 25 A fused
  // safety switch to buy. Fused disconnects are sold in FRAME sizes
  // (30/60/100/200/400/600 A, STD_DISCONNECT_ENCLOSURES); the fuses inside are
  // sized to the OCPD. So 25 A of fusing is a 30 A frame with 25 A fuses, and
  // 40 A of fusing is a 60 A frame with 40 A fuses. Naming only the OCPD tells
  // the installer to order hardware that does not exist, and tells the reviewer
  // a switch rating that is not the one on the wall.
  // Resolved by the SAME function the BOM uses, so the drawing and the equipment
  // schedule name the identical switch. The sheet now says WHAT the disconnect
  // IS — make, part number, frame — not just a bare ampere figure.
  const _disco = resolveAcDisconnect({ requiredAmps: ocpd, targetAmps: ocpd, fused: fusedTapOcpd });
  const _lp = labelPitch ?? 9;
  const _l0 = by2+H2+(labelPitch ? 13 : 10);
  p.push(txt(cx, _l0, _disco.drawingLabel, {sz:F.tiny, anc:'middle', bold:true}));
  p.push(txt(cx, _l0+_lp,
    `${_disco.manufacturer} ${_disco.partNumber}`
      + (_disco.fusePartNumber ? `  ·  2× ${_disco.fuseManufacturer} ${_disco.fusePartNumber}` : ''),
    {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, _l0+2*_lp,
    fusedTapOcpd
      ? `TAP OCPD — NEC 705.11(C), 690.13 — UTILITY ACCESSIBLE`
      : 'NEC 690.13 — UTILITY ACCESSIBLE',
    {sz:F.tiny, anc:'middle', italic:true}));
  const lbl = labelBand(_l0, _l0+2*_lp, F.tiny);

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
          loadInX, loadInY, lineOutX, lineOutY, lbl};
}

// ── MSP Load-Side Tap (internal structure) ───────────────────────────────────
function renderMSPLoad(
  cx: number, cy: number,
  mainAmps: number, pvAmps: number, calloutN: number,
  /** Where the consumption CTs clamp (designMetering) — drawn, never decided. */
  ctLocation: ConsumptionCtLocation | null = null,
  ctOpts: MspCtOpts = {},
  /** Nameplate block pitch (see LBL_PITCH). Absent ⇒ 9, as before. */
  labelPitch?: number,
): MspResult {
  // SOT: symbol size from SLD_SYMBOL_MAP['msp'] = 160×180
  const W2 = SLD_SYMBOL_MAP['msp'].width;   // 160
  const H2 = SLD_SYMBOL_MAP['msp'].height;  // 180
  console.log(`[SLD SYMBOL SIZE USED] msp (load-side): ${W2}×${H2}`);
  const ctTag = ctOpts.tag ?? 'CT×2';
  let ctLeadExit: CtLeadExit | undefined;
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'MAIN SERVICE PANEL', {sz:5.5, bold:true, anc:'middle'}));

  // Main breaker at top
  const mbY = by2+28;
  // The label sits BESIDE the breaker, right-aligned to it. Centred above, it
  // had 7 units between the header rule and the box — less than the floored
  // type height — so the box covered its lower half, and the symbol's own
  // "200A" printed over it. The left side is the one nothing else uses (the CT
  // tag and bubble go right; 'MAIN BUS' sits below the breaker line).
  p.push(txt(cx-19, mbY-1, `${mainAmps}A MAIN`, {sz:5.5, anc:'end', bold:true}));
  p.push(txt(cx-19, mbY+7, 'BREAKER', {sz:5.5, anc:'end', bold:true}));
  p.push(breakerSymbol(cx, mbY, 32, 14));

  // Main busbar
  const busY = mbY + 20;
  // The centred 'MAIN BUS' label straddled the main→bus drop (the drop struck
  // through it on every load-side sheet). It sits over the bus's right half —
  // or, when consumption CTs ring the drop and their lead runs right along it,
  // over the left half, clear of the breaker, the drop and the ring.
  const ctOnMainDrop = ctLocation === 'main-breaker-load-side';
  // A DRAWN lead's service-conductor CTs ring the conductor INSIDE the wall
  // (see below), so the bus stops short there and leaves them a conductor to
  // ring — on the bus itself the ring would read as a CT on the busbar.
  const ctOnSvcInside = ctLocation === 'sec-line-side-of-main' && !!ctOpts.drawnLead;
  const busEndX = ctOnSvcInside ? bx+W2-24 : bx+W2-8;
  p.push(busbar(bx+8, busEndX, busY));
  // 4 uu over the bus, not 5: its caps then clear the main breaker's box above
  // by 2.2 uu rather than 1.2 (they share 1.4 uu of width).
  p.push(txt(ctOnMainDrop ? (bx+8 + cx-16)/2 : (cx + bx+W2-8)/2, busY-4, 'MAIN BUS', {sz:5.5, anc:'middle', bold:true}));
  p.push(ln(cx, mbY+7, cx, busY, {sw:SW_MED}));

  // Neutral bar (left). Its 'N' sits beside the bar's top: under the bar, the
  // PV input conductor (left wall → load lug) ran through it. The bar ends
  // 12 uu above that conductor, which now enters level (see below).
  const nX = bx+10;
  p.push(ln(nX, busY+8, nX, busY+30, {stroke:'#444', sw:3}));
  p.push(txt(nX+6, busY+16, 'N', {sz:6, anc:'start', bold:true, fill:'#444'}));

  // Ground bar (right)
  const gX = bx+W2-10;
  p.push(ln(gX, busY+8, gX, busY+38, {stroke:GRN, sw:3}));
  p.push(txt(gX, busY+46, 'G', {sz:6, anc:'middle', bold:true, fill:GRN}));
  p.push(gnd(gX, busY+48, GRN));

  // PV breaker on bus (load side)
  const pvBrkX = cx+20;
  const pvBrkY = busY+28;
  p.push(ln(pvBrkX, busY, pvBrkX, pvBrkY-6, {sw:SW_THIN}));
  // Rating right of the breaker, 'PV' left of it: above and below it, the
  // stem from the bus and the drop to the lug ran through both.
  p.push(breakerSymbol(pvBrkX, pvBrkY, 20, 12));
  p.push(txt(pvBrkX+13, pvBrkY+3, `${pvAmps}A`, {sz:5.5, anc:'start', bold:true}));
  p.push(txt(pvBrkX-13, pvBrkY+3, 'PV', {sz:5.5, anc:'end', bold:true, fill:LOAD_CLR}));

  // Load lug below PV breaker — ON the chain's line (cy), where the PV
  // feeder arrives, so the feeder lands on it square. It sat 8 uu lower and
  // the feeder reached it by a slanted line from the wall.
  const lugY = cy;
  p.push(ln(pvBrkX, pvBrkY+6, pvBrkX, lugY-3, {sw:SW_THIN}));
  p.push(lug(pvBrkX, lugY));
  // Below-left of the lug, under the PV input conductor that lands on it.
  // Centred 9 uu under it, the lug's own ring ran through the printed caps,
  // and a battery job's backfeed breaker drops just right of the lug.
  p.push(txt(pvBrkX-6, lugY+12, 'LOAD LUG', {sz:5, anc:'end'}));

  // Input wire: from the left wall, level, onto the PV breaker's lug.
  p.push(ln(bx-10, cy, bx, cy, {sw:SW_MED}));
  p.push(ln(bx, cy, pvBrkX-3, lugY, {sw:SW_MED}));

  // Output wire: the main bus leaves the right wall and turns square down to
  // the chain's line, where the service conductors to the meter start (they
  // left from cy while the bus stub ended 42 uu higher — joined to nothing).
  p.push(ln(busEndX, busY, bx+W2+10, busY, {sw:SW_MED}));
  p.push(ln(bx+W2+10, busY, bx+W2+10, cy, {sw:SW_MED}));

  // Consumption CTs, where the design says they clamp.
  if (ctLocation === 'main-breaker-load-side') {
    // On the main→bus drop: 13 uu between the breaker and the bus, room for the
    // ring and nothing else. The lead runs right, clear of the breaker, and
    // turns up into the bubble; the tag rides beside the bubble as at every
    // other placement. (The tag used to print inside the breaker symbol and the
    // bubble on the MAIN BUS lettering.)
    p.push(ctRing(cx, mbY+13, '', 3.2));
    if (ctOpts.drawnLead) {
      // A drawn lead runs right along the drop and rises past the END of the
      // panel header (a straight rise at cx+30 would cut 'MAIN SERVICE PANEL')
      // and short of the callout bubble. The tag sits level with the breaker.
      ctLeadExit = [[cx+3.2, mbY+13], [bx+W2-4, mbY+13]];
      p.push(txt(cx+54, mbY+3, ctTag, {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    } else {
      p.push(ln(cx+3.2, mbY+13, cx+30, mbY+13, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ln(cx+30, mbY+10.5, cx+30, mbY+13, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(cx+30, mbY+5));
      p.push(txt(cx+38, mbY+7, ctTag, {sz:4.4, anc:'start', bold:true, fill:CT_CLR}));
    }
  } else if (ctLocation === 'sec-line-side-of-main') {
    if (ctOpts.drawnLead) {
      // On the service conductor where it leaves the (shortened) bus, 16 uu
      // inside the wall: from there a drawn lead rises straight — past the end
      // of the panel header and short of the callout bubble. The service run's
      // 'EXISTING SERVICE CONDUCTORS' label is centred on a span narrower than
      // it, so in the printed face (Liberation Sans) it starts ~8 uu INSIDE
      // this wall, 7 uu under the bus: a ring at bx+W2-4 sat on its 'E', and
      // outside the wall on the rest of it. Here it clears the label by 4.5 uu,
      // 'MAIN BUS' by 2.8 and the ground bar below. The tag rides outside,
      // above that label.
      const rX = bx+W2-16;
      p.push(ctRing(rX, busY, ''));
      ctLeadExit = [[rX, busY-3.8]];
      p.push(txt(bx+W2+3, busY-7, ctTag, {sz:4.4, anc:'start', bold:true, fill:CT_CLR}));
    } else {
      // On the service conductors leaving toward the meter; bubble ABOVE (the
      // meter feeder runs below), tag in the panel's clear top-right corner.
      p.push(ctRing(bx+W2+5, busY, ''));
      p.push(ln(bx+W2+5, busY-3.8, bx+W2+5, busY-10, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(bx+W2+5, busY-16));
      p.push(txt(bx+W2-5, busY-14, ctTag, {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    }
  }

  // Labels below
  const _lp = labelPitch ?? 9;
  const _l0 = by2+H2+(labelPitch ? 13 : 10);
  p.push(txt(cx, _l0, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
  p.push(txt(cx, _l0+_lp, 'LOAD SIDE TAP — NEC 705.12(B)', {sz:F.tiny, anc:'middle', bold:true, fill:LOAD_CLR}));
  p.push(txt(cx, _l0+2*_lp, `${pvAmps}A PV BREAKER`, {sz:F.tiny, anc:'middle', fill:LOAD_CLR}));
  const lbl = labelBand(_l0, _l0+2*_lp, F.tiny);

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  // Terminals: where this function's own conductors END. The PV feeder
  // lands on the input stub's outer end (the chain's line, cy); the service
  // conductors leave from the foot of the bus's jog (bx+W2+10, cy). The
  // symbol-map anchors (solar_in (0,90), load_out (160,72)) named points no
  // conductor drawn here reached.
  const bkfdInX = bx;
  const bkfdInY = cy;
  const busOutX = bx+W2+10;
  const busOutY = cy;
  console.log(`[SLD ANCHOR CONNECTED] msp.solar_in → bkfdIn (${bkfdInX.toFixed(1)},${bkfdInY.toFixed(1)})`);
  console.log(`[SLD ANCHOR CONNECTED] msp.load_out → busOut (${busOutX.toFixed(1)},${busOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] msp.load_out → utility-meter`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10,
          bkfdInX, bkfdInY, busOutX, busOutY, busY,
          ...(ctLeadExit ? {ctLeadExit} : {}), lbl};
}

/** A main service panel as drawn: its terminals on the chain's line (cy),
 *  its main bus's own height, and its nameplate band. */
interface MspResult {
  svg: string; lx: number; rx: number;
  /** Where the PV conductor from the disconnect lands (the chain's line). */
  bkfdInX: number; bkfdInY: number;
  /** Where the conductors toward the meter (or a BUI) leave (the chain's line). */
  busOutX: number; busOutY: number;
  /** The main bus's height inside the panel — anything that taps the bus (a
   *  battery's backfeed breaker) hangs from HERE, not from the chain's line. */
  busY: number;
  ctLeadExit?: CtLeadExit;
  /** The nameplate block under the enclosure — a ground drop stops at it. */
  lbl: LabelBand;
}

/** How the MSP draws its consumption CTs. */
interface MspCtOpts {
  /** The tag printed at the CTs — `CT×<count>` from the composer's ctCount. */
  tag?: string;
  /** The CT leads are drawn as real conductors to the gateway: no "CT"
   *  continuation bubble; the function returns where its lead leaves. */
  drawnLead?: boolean;
}
/** A drawn consumption-CT lead's path inside/at the MSP, ring edge first. Its
 *  LAST point is where the lead turns to rise vertically — the air straight
 *  above it is clear of this panel's text and callout. */
type CtLeadExit = Array<[number, number]>;

// ── MSP Supply-Side / Backfed (internal structure) ───────────────────────────
function renderMSPSupply(
  cx: number, cy: number,
  mainAmps: number, backfeedAmps: number,
  isSupply: boolean, calloutN: number,
  /** Where the consumption CTs clamp (designMetering) — drawn, never decided. */
  ctLocation: ConsumptionCtLocation | null = null,
  ctOpts: MspCtOpts = {},
  /** Nameplate block pitch (see LBL_PITCH). Absent ⇒ 9, as before. */
  labelPitch?: number,
): MspResult {
  // SOT: symbol size from SLD_SYMBOL_MAP['msp'] = 160×180
  const W2 = SLD_SYMBOL_MAP['msp'].width;   // 160
  const H2 = SLD_SYMBOL_MAP['msp'].height;  // 180
  console.log(`[SLD SYMBOL SIZE USED] msp (supply-side): ${W2}×${H2}`);
  const bx = cx-W2/2, by2 = cy-H2/2;
  const p: string[] = [];
  const ctTag = ctOpts.tag ?? 'CT×2';
  let ctLeadExit: CtLeadExit | undefined;
  // The nameplate block under the enclosure (drawn below, per interconnection).
  const _lp = labelPitch ?? 9;
  const _l0 = by2+H2+(labelPitch ? 13 : 10);
  let lbl: LabelBand;

  // Enclosure
  p.push(rect(bx, by2, W2, H2, {fill:WHT, sw:SW_MED}));
  p.push(ln(bx, by2+14, bx+W2, by2+14, {sw:SW_THIN}));
  p.push(txt(cx, by2+10, 'MAIN SERVICE PANEL', {sz:5.5, bold:true, anc:'middle'}));

  // Main busbar.
  // On a supply-side tap the 24 uu between the header rule and the bus had to
  // hold the service run, TAP, SERVICE (LINE) SIDE, the main's line-side riser,
  // its '200A' and MAIN BUS — at the floored type the run struck through MAIN
  // BUS, '200A' printed over SIDE, and the tap-to-main CT ring sat on both. The
  // bus drops 8 uu on a tap so each gets a row; the service run itself and the
  // 'utility_in' entry (by2+55) do not move.
  const busY = isSupply ? by2+46 : by2+38;
  // A DRAWN lead to service-conductor CTs on a tap job: at this bus height the
  // service run's 'EXISTING SERVICE CONDUCTORS' label (which in the printed
  // face starts ~8 uu inside the right wall) is 2.8 uu under the conductor, so
  // the only clear place for the ring is further in — the main steps 14 uu
  // left to make room, and the bus stops at the main so the ring sits on the
  // conductor it measures. (A backfed job's bus is 8 uu higher: no conflict.)
  const ctSvcOnTap = isSupply && ctLocation === 'sec-line-side-of-main' && !!ctOpts.drawnLead;
  const mbX = ctSvcOnTap ? bx+W2-34 : bx+W2-20;  // main breaker position
  const busEndX = ctSvcOnTap ? mbX+10 : bx+W2-8;
  // A tap's riser (bx+28, below) rises from the PV conductor to the service
  // run: the bus starts right of it, so the riser never crosses the load-side
  // bus it does not connect to.
  const tapX = bx+28;
  if (isSupply) {
    p.push(busbar(tapX+12, busEndX, busY));
    p.push(txt(bx+72, busY-5, 'MAIN BUS', {sz:5.5, anc:'middle', bold:true}));
  } else {
    p.push(busbar(bx+8, bx+W2-8, busY, 'MAIN BUS'));
  }

  if (isSupply) {
    // Supply-side tap: lands on the SERVICE (line-side) conductors between the
    // meter and the MAIN breaker — never on the load-side bus. The old drawing
    // dropped the tap straight onto MAIN BUS (a load-side connection), which
    // contradicted every 'NEC 705.11' label on the sheet.
    // busY-18 put the service run's label baseline only 6 uu below the
    // "MAIN SERVICE PANEL" baseline. That was already tight at the retired 4.5/5.5
    // uu type and collides outright once both are raised to the legibility floor.
    // Dropped so the label clears the panel header rule at by2+14.
    const svcY = by2+28;               // service conductor run, above the bus
    // The PV conductor enters on the chain's line (cy), where the feeder from
    // the disconnect arrives — it entered 32 uu higher (by2+55), joined to
    // nothing, and ran across the top of the neutral bar so the tap appeared
    // to land on N. At cy it passes 8 uu under the bar's foot.
    const pvInY = cy;
    const mainBkrX = mbX;              // main breaker position (drawn below)
    // Service conductors: main breaker LINE side up and across to the tap
    p.push(ln(mainBkrX, svcY, mainBkrX, busY-6, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(ln(tapX, svcY, mainBkrX, svcY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    // 5 uu over the run: at 4 the parentheses' feet came within 1.4 uu of it
    // on a sheet drawn at 1:1 (the hybrid's).
    p.push(txt((tapX+mainBkrX)/2, svcY-5, 'SERVICE (LINE) SIDE', {sz:4.5, anc:'middle', fill:SUPPLY_CLR}));
    // PV conductors (from the fused AC disconnect) enter left wall → tap point
    p.push(ln(bx, pvInY, tapX, pvInY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(ln(tapX, pvInY, tapX, svcY, {stroke:SUPPLY_CLR, sw:SW_MED}));
    p.push(circ(tapX, svcY, 3, {fill:SUPPLY_CLR, stroke:SUPPLY_CLR, sw:0}));
    // Beside the tap dot, not above it: above, it sat on the header rule.
    p.push(txt(tapX-5, svcY+2, 'TAP', {sz:5.5, anc:'end', bold:true, fill:SUPPLY_CLR}));
    p.push(txt(cx, _l0, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
    p.push(txt(cx, _l0+_lp, 'SUPPLY SIDE TAP — LINE SIDE OF MAIN — NEC 705.11', {sz:F.tiny, anc:'middle', bold:true, fill:SUPPLY_CLR}));
    lbl = labelBand(_l0, _l0+_lp, F.tiny);
  } else {
    // Backfed breaker on bus — left of centre, so its rating clears the main
    // breaker's '200A MAIN' label below the bus. The rating prints beside the
    // breaker, not over it: over it, the stem from the bus struck through it.
    const brkX = cx-24;
    const brkY = busY+26;
    p.push(ln(brkX, busY, brkX, brkY-6, {sw:SW_THIN}));
    p.push(breakerSymbol(brkX, brkY, 24, 14));
    p.push(txt(brkX+15, brkY+3, `${backfeedAmps}A`, {sz:5.5, anc:'start', bold:true}));
    // The PV feeder lands ON this breaker: level from the wall on the chain's
    // line, then up into the breaker's foot. It dead-ended at the wall, and
    // the backfed breaker had no conductor at all. 'BACKFED' moves under the
    // rating, off that rise.
    p.push(ln(bx, cy, brkX, cy, {sw:SW_MED}));
    p.push(ln(brkX, cy, brkX, brkY+7, {sw:SW_MED}));
    p.push(txt(brkX+15, brkY+3+LBL_PITCH, 'BACKFED', {sz:5.5, anc:'start', bold:true}));
    p.push(txt(cx, _l0, `${mainAmps}A RATED`, {sz:F.tiny, anc:'middle'}));
    p.push(txt(cx, _l0+_lp, `${backfeedAmps}A BACKFED BREAKER`, {sz:F.tiny, anc:'middle', bold:true}));
    p.push(txt(cx, _l0+2*_lp, 'NEC 705.12(B)(2)', {sz:F.tiny, anc:'middle', italic:true}));
    lbl = labelBand(_l0, _l0+2*_lp, F.tiny);
  }

  // Main breaker (right side). Its rating and name print as one label BELOW
  // the bus, left of the breaker: above it, the rating sat on a tap's service
  // riser (and on SERVICE (LINE) SIDE), and 'MAIN' under it sat on the ground
  // bar.
  p.push(breakerSymbol(mbX, busY, 20, 12));
  p.push(txt(mbX-13, busY+13, `${mainAmps}A MAIN`, {sz:5, anc:'end', bold:true}));

  // Neutral bar. Its 'N' beside the bar's top (the load-side panel's
  // placement): under the bar it sat on the PV conductor, which now enters on
  // the chain's line.
  const nX = bx+10;
  p.push(ln(nX, busY+8, nX, busY+36, {stroke:'#444', sw:3}));
  p.push(txt(nX+6, busY+16, 'N', {sz:6, anc:'start', bold:true, fill:'#444'}));

  // Ground bar
  const gX = bx+W2-10;
  p.push(ln(gX, busY+8, gX, busY+36, {stroke:GRN, sw:3}));
  p.push(txt(gX, busY+44, 'G', {sz:6, anc:'middle', bold:true, fill:GRN}));
  p.push(gnd(gX, busY+46, GRN));

  // Input wire stub
  p.push(ln(bx-10, cy, bx, cy, {sw:SW_MED}));
  // Output: the bus leaves the right wall and turns square down to the
  // chain's line, where the service conductors to the meter start (see
  // renderMSPLoad).
  p.push(ln(busEndX, busY, bx+W2+10, busY, {sw:SW_MED}));
  p.push(ln(bx+W2+10, busY, bx+W2+10, cy, {sw:SW_MED}));

  // Consumption CTs, where the design says they clamp. "Between the tap and
  // the main" is the service conductor from the TAP to the MAIN's line side.
  // Every drawn lead rises just inside the right wall — at x = bx+W2-4, or at
  // the ring itself for service-conductor CTs on a tap job — past the end of
  // the panel header and short of the callout bubble.
  const ctRiseX = bx+W2-4;
  if (ctLocation === 'between-tap-and-main' && isSupply) {
    // On the main's line-side riser — the last span of service conductor
    // before the main, and the only one no label sits above.
    const ctX = mbX, ctY = by2+34;
    p.push(ctRing(ctX, ctY, '', 3.2));
    p.push(txt(ctX-7, ctY+3, ctTag, {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    if (ctOpts.drawnLead) {
      ctLeadExit = [[ctX+3.2, ctY], [ctRiseX, ctY]];
    } else {
      p.push(ln(ctX+3.2, ctY, ctRiseX, ctY, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ln(ctRiseX, ctY, ctRiseX, by2-1, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(ctRiseX, by2-7));
      p.push(txt(ctRiseX-8, by2-5, '(L1, L2)', {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    }
  } else if (ctLocation === 'main-breaker-load-side') {
    // On the bus, just on the main's load side. The tag rides outside the
    // panel's right wall, beside the lead's rise: above the ring it printed on
    // the main's rating and, on a supply-side tap, on the SERVICE (LINE) SIDE
    // run; below it, on the main's label.
    const ctX = bx+W2-40;
    p.push(ctRing(ctX, busY, ''));
    if (ctOpts.drawnLead) {
      ctLeadExit = [[ctX, busY-3.8], [ctX, busY-13], [ctRiseX, busY-13]];
      p.push(txt(bx+W2+4, by2+25, ctTag, {sz:4.4, anc:'start', bold:true, fill:CT_CLR}));
    } else {
      p.push(ln(ctX, busY+4, ctX, busY+14, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(ctX, busY+20));
      p.push(txt(ctX-8, busY+22, ctTag, {sz:4.4, anc:'end', bold:true, fill:CT_CLR}));
    }
  } else if (ctLocation === 'sec-line-side-of-main') {
    // On the service conductors leaving toward the meter. The tag rides
    // outside the wall: inside, a tap's line-side riser runs there.
    if (ctOpts.drawnLead) {
      // Just inside the wall, where the conductor leaves the bus, so the lead
      // rises straight from the ring. Outside, the ring sat on the existing-
      // service callout and straight under the callout bubble. On a tap job
      // it sits further in, between the (moved) main and that label.
      const rX = ctSvcOnTap ? bx+W2-16 : ctRiseX;
      p.push(ctRing(rX, busY, ''));
      ctLeadExit = [[rX, busY-3.8]];
      p.push(txt(bx+W2+3, busY-7, ctTag, {sz:4.4, anc:'start', bold:true, fill:CT_CLR}));
    } else {
      p.push(ctRing(bx+W2+5, busY, ''));
      p.push(ln(bx+W2+5, busY-3.8, bx+W2+5, busY-10, {stroke:CT_CLR, sw:0.9, dash:'2,2'}));
      p.push(ctBubble(bx+W2+5, busY-16));
      p.push(txt(bx+W2+10, busY-6, ctTag, {sz:4.4, anc:'start', bold:true, fill:CT_CLR}));
    }
  }

  // Callout
  p.push(callout(bx+W2+14, by2-5, calloutN));

  // Terminals: where this function's own conductors end, on the chain's line
  // (see renderMSPLoad). The symbol-map anchors (utility_in (0,55),
  // load_out (160,72)) named points 35 and 18 uu off that line.
  const bkfdInX = bx;
  const bkfdInY = cy;
  const busOutX = bx+W2+10;
  const busOutY = cy;
  console.log(`[SLD ANCHOR CONNECTED] msp.utility_in → bkfdIn (${bkfdInX.toFixed(1)},${bkfdInY.toFixed(1)})`);
  console.log(`[SLD ANCHOR CONNECTED] msp.load_out → busOut (${busOutX.toFixed(1)},${busOutY.toFixed(1)})`);
  console.log(`[SLD WIRE TYPE: AC] msp.load_out → utility-meter`);
  return {svg:p.join(''), lx:bx-10, rx:bx+W2+10, lbl,
          bkfdInX, bkfdInY, busOutX, busOutY, busY,
          ...(ctLeadExit ? {ctLeadExit} : {})};
}

// ── Main Render ──────────────────────────────────────────────────────────────
export function renderSLDProfessional(input: SLDProfessionalInput): string {
  // ── Wave 5 Lane A — hybrid multi-lane dispatch ────────────────────────────
  // N>1 valid source branches ⇒ the multi-lane renderer (one lane per
  // subsystem, ONE POI, one service tail). Absent / empty / single-branch
  // sources fall through to the legacy single-source path BYTE-FOR-BYTE
  // (Invariant I-1 — the Wave-0 structural-marker goldens pin this).
  if (Array.isArray(input.sources)) {
    const _lanes = normalizeSourceBranches(input.sources);
    if (_lanes.length > 1) return renderSLDMultiLane(input, _lanes);
  }
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

  // ROOF_RUN is deliberately NOT looked up. It is the module→microinverter DC
  // connection (computed-system.ts:1484 — "ROOF RUN (DC to Micro)"), i.e. the
  // module's factory leads / MC4 connectors, not installer-run conductor. It has
  // no place on the one-line: the field conductor leaving a micro array is the
  // AC branch below. bom-engine-v4 excludes it from micro materials for the
  // same reason.
  const branchRun     = findRun('BRANCH_RUN');
  // §3/§4 — the shared jbox→combiner conduit home-run (SEGMENT_2A). Distinct from
  // the open-air Q-Cable BRANCH_RUN so E-1 never labels the open-air run in-conduit.
  const branchHomerunRun = findRun('BRANCH_HOMERUN_RUN');
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
  // §3 — canonical feeder conduit size/type: engine run first, then the snapshot-
  // sourced feeder trade size/raceway the adapter passes, then a last-resort default.
  const resolvedAcConduit   = acFeederRun?.conduitSize ?? input.acConduitSize ?? '3/4"';
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
  // Does the PV AC FEEDER (combiner/inverter → disconnect) carry a neutral?
  // From the engine's conductor set when it supplied one; with no runs (the
  // permit E-1) a micro feeder always does — the IQ Gateway in the combiner is
  // powered line-to-neutral (Ray, 2026-09-25). Never from `neutralRequired`
  // alone: a string INV_TO_DISCO_RUN declares it without pulling one, and the
  // drawing must not show a conductor the BOM does not buy.
  const _feederHasNeutral: boolean = acFeederRun?.conductorBundle?.length
    ? acFeederRun.conductorBundle.some((c: ConductorBundle) => !isGroundingConductor(c)
        && (c.role === 'NEUTRAL_IMBALANCE_ONLY' || c.role === 'GROUNDED_CURRENT_CARRYING' || c.color === 'WHT'))
    : (isMicro && _acNeutral);
  const _acWireNum = resolvedAcWire.replace('#','').replace(' AWG','');
  const resolvedDcWire      = dcStringRun?.wireGauge   ?? input.dcWireGauge   ?? '#10 AWG';
  // EGC gauge: from engine (NEC 250.122) → input.egcGauge → run data → '#10 AWG' fallback
  const resolvedEgcGauge    = input.egcGauge
    ?? dcStringRun?.egcGauge
    ?? acFeederRun?.egcGauge
    ?? '#10 AWG';
  // Strip '#' and ' AWG' for inline display (e.g. '#10 AWG' → '10')
  const egcNum = resolvedEgcGauge.replace('#', '').replace(' AWG', '').trim();
  // §5 (BAR closeout 2026-07-25) — the BRANCH-side segments cite their OWN EGC
  // (NEC 250.122 on the BRANCH OCPD), never the feeder's. Without this the
  // open-air Q-Cable segment printed the feeder's #10 while the canonical
  // branch-egc grounding object and the BOM open-air EGC footage row were #12 —
  // a separate-EGC assertion whose quantity no surface could match (gate 7).
  const _gaugeNumOf = (g?: string | null): string | null =>
    g ? g.replace('#', '').replace(' AWG', '').trim() : null;
  const branchEgcNum  = _gaugeNumOf(input.branchEgcGauge)  ?? egcNum;
  const homerunEgcNum = _gaugeNumOf(input.homerunEgcGauge) ?? branchEgcNum;

  const intercon     = String(input.interconnection ?? '').toLowerCase();
  const isLoadSide   = intercon.includes('load');
  const isSupplySide = intercon.includes('supply') || intercon.includes('line');
  const isBackfed    = !isLoadSide && !isSupplySide;
  const pvBreakerAmps = input.backfeedAmps ?? resolvedAcOCPD;

  // ── SVG root ──────────────────────────────────────────────────────────────
  // Embedded mode crops the viewBox at the title-block column so the diagram
  // fills the sheet instead of reserving a blank right margin. With the schedule
  // band suppressed the canvas is also cropped VERTICALLY to close just below
  // the calc panels — the blank band would otherwise force letterboxing that
  // shrinks the schematic inside E-1's drawing wrapper.
  const effW = input.schedulesOnly ? STACK_W : input.suppressTitleBlock ? TB_X - 10 : W;
  // With the calc panels gone the canvas closes just below the schematic, so a
  // blank band cannot letterbox the diagram inside E-1's drawing box.
  const effH = input.schedulesOnly ? STACK_H
    : input.suppressCalcBand ? CALC_Y + MAR
    : input.suppressScheduleBand ? CALC_Y + CALC_H + MAR : H;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${effW}" height="${effH}" viewBox="0 0 ${effW} ${effH}" preserveAspectRatio="xMidYMid meet" style="background:${WHT};">`);
  parts.push(rect(0, 0, effW, effH, {fill:WHT, stroke:WHT, sw:0}));
  parts.push(rect(MAR/2, MAR/2, effW-MAR, effH-MAR, {fill:WHT, stroke:BLK, sw:SW_BORDER}));
  // Consumed by the schedules AND by titleBlockSvg, so it lives above both guards.
  const dcKw = input.totalModules * input.panelWatts / 1000;
  // E-1.1 draws the schedules only; the topology stays on E-1.
  if (!input.schedulesOnly) {

  // ── Title ─────────────────────────────────────────────────────────────────
  const tcx = (DX + TB_X) / 2;
  parts.push(txt(tcx, DY+16, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {sz:F.title, bold:true, anc:'middle'}));
  parts.push(txt(tcx, DY+26,
    `${esc(input.address)}  |  ${esc(input.topologyType.replace(/_/g,' '))}  |  ${input.totalModules} MODULES  |  ${Number(input.acOutputKw).toFixed(2)} kW AC`,
    {sz:F.sub, anc:'middle', fill:'#444'}));

  // ── Schematic border ──────────────────────────────────────────────────────
  // Cropped for E-1 (suppressTitleBlock), the sheet's own border closes at
  // effW − MAR/2 (1974); the full-width box ended at 1994 — across the border
  // at both right corners and half clipped by the viewBox. The box, the fit and
  // the centring all use the width that fits inside the frame, as the
  // multi-lane sheet already does.
  const schW = input.suppressTitleBlock ? Math.min(SCH_W, effW - MAR/2 - 8 - SCH_X) : SCH_W;
  parts.push(rect(SCH_X, SCH_Y, schW, SCH_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  // Everything pushed from here until the LEGEND is the schematic itself and is
  // wrapped in a fit-to-area scale group (see AUTO-SCALE below) — the drawn
  // chain historically used ~55% of the schematic box, leaving a dead band and
  // small symbols/type on E-1.
  const _schScaleStart = parts.length;

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

  // SEGMENT 1's conductor callout (drawn below, at NODE 2), resolved here so
  // the PV → J-box run can be as long as that callout needs. Its phrases are
  // the longest on the sheet — 'ENPHASE Q CABLE (TC-ER)', and on a job whose
  // grounding document is pending 'EGC: PENDING MFR AUTHORITY' (145 uu at the
  // printed size) — and a 120 uu run put them across the array and the J-box.
  // A phrase is never split (calloutCuts); the run grows to carry it, plus the
  // 6 uu each terminal dot needs.
  const seg1Run = isMicro ? branchRun : dcStringRun;
  const seg1Fallback = isMicro
    // §8 — the open-air branch identity is the LISTED assembly the legend names
    // (one source); §5 — its EGC is the BRANCH EGC, not the feeder's.
    ? [input.openAirBranchWiringLabel ?? 'ENPHASE Q CABLE (TC-ER)',
       // the grounding line is the OUTCOME of the document-based grounding
       // authority (fail-closed PENDING when no applicable document exists) —
       // never an unconditional EGC assertion.
       input.openAirBranchEgcLabel ?? `1×#${branchEgcNum} GRN EGC`,
       'OPEN AIR — NEC 690.31(C)']
    : [`${resolvedDcWire} USE-2/PV Wire`, `1×#${egcNum} GRN EGC`, 'OPEN AIR — NEC 690.31'];
  const seg1Lines = runLines(seg1Run, seg1Fallback).lines;
  const _seg1Printed = formatCallout(seg1Run, seg1Lines, !isMicro);
  const seg1Gap = Math.max(WIRE_GAP,
    Math.ceil(widestCalloutPiece(_seg1Printed.length ? _seg1Printed : seg1Lines, F.seg)) + 12);

  if (isMicro) {
    // Micro path: PV -> J-Box -> Combiner -> AC Disco -> MSP -> [BUI?] -> Utility
    xPV   = SCH_X + LEFT_MARGIN + W_PV/2;
    xJBox = nextCX(xPV,   W_PV,  W_JBOX, seg1Gap);
    xComb = nextCX(xJBox, W_JBOX, W_COMB);
    xDisco= nextCX(xComb, W_COMB, W_ACDS);
    xMSP  = nextCX(xDisco, W_ACDS, 160);   // MSP width=160
    xUtil = _hasBUI
      ? nextCX(nextCX(xMSP, 160, W_BUI), W_BUI, 120)  // MSP -> BUI -> Utility
      : nextCX(xMSP, 160, 120);
  } else {
    // String/Optimizer path: PV -> J-Box -> [DC Disco] -> Inverter -> AC Disco -> MSP -> [BUI?] -> Utility
    xPV   = SCH_X + LEFT_MARGIN + W_PV/2;
    xJBox = nextCX(xPV,   W_PV,  W_JBOX, seg1Gap);
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

  // Each grounded node reports where its equipment grounding conductor leaves
  // it (its enclosure's bottom edge, or its ground terminal) and the nameplate
  // block under it that the drop must stop at — see GROUNDING RAIL below.
  const _gndNodes: Array<{x: number; top: number; skip?: LabelBand}> = [];
  // The lowest ink of the equipment drawn under the main chain (a backup
  // sub-panel, a generator) — the schematic's fit box must reach it.
  let _auxBottom = -Infinity;

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
  // The nameplate block starts under the array's ground terminal (its dot
  // hangs 4.75 uu below the slot — at +9 the module name sat on it) and is
  // pitched for the size that prints.
  const pvL0 = pvCY+pvH/2+16;
  parts.push(txt(pvCX, pvL0, esc(input.panelModel), {sz:F.tiny, anc:'middle', italic:true}));
  // Phase 4: PV Array callout — complete engineering truth
  // For micro: show device count and model
  // For string/optimizer: show module count + string layout + optimizer count
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const _invUn = isInverterUnselectedMarker(input.inverterModel);
    parts.push(txt(pvCX, pvL0+LBL_PITCH,
      _invUn ? esc(input.inverterModel) : `${md} × ${esc(input.inverterModel)}`,
      {sz:F.tiny, anc:'middle', ...(_invUn ? {fill:'#C62828', bold:true} : {})}));
  } else {
    const _ns  = input.totalStrings || 1;
    const _pps = input.panelsPerString ?? Math.round(input.totalModules / Math.max(_ns, 1));
    // Same NEC 690.7 provenance rule as the DC CALCULATIONS panel: an
    // uncorrected STC total must never be printed as a bare "Voc=" on a string
    // summary, because in this position a reviewer reads it as the corrected
    // cold-weather figure the inverter's max DC voltage is checked against.
    // A real corrected value is printed as "Voc="; the STC stand-in is printed
    // but LABELLED "Voc(STC)=" so the sheet never overstates what it knows.
    const _sVocCorrected = input.stringVoc
      ?? (input.vocCorrected != null ? input.vocCorrected * _pps : undefined);
    const _sIsc = input.stringIsc ?? input.panelIsc;
    const _vocTxt = _sVocCorrected != null
      ? `Voc=${_sVocCorrected.toFixed(1)}V`
      : `Voc(STC)=${(input.panelVoc * _pps).toFixed(1)}V`;
    // Line 1: string layout (e.g. "3 STRINGS × 12 MODULES")
    parts.push(txt(pvCX, pvL0+LBL_PITCH, `${_ns} STRING${_ns>1?'S':''} × ${_pps} MODULES`, {sz:F.tiny, anc:'middle', bold:true}));
    // Line 2: electrical parameters
    parts.push(txt(pvCX, pvL0+2*LBL_PITCH, `${_vocTxt}  Isc=${_sIsc.toFixed(2)}A`, {sz:F.tiny, anc:'middle', fill:'#B71C1C'}));
    console.log(`[SLD STRING SUMMARY] ${_ns} strings × ${_pps} modules, ${_vocTxt}, Isc=${_sIsc.toFixed(2)}A`);
    // Phase 4: Optimizer callout — show full info when optimizer topology
    if (input.optimizerQty && input.optimizerQty > 0) {
      const _optModel = input.optimizerModel ? ` (${input.optimizerModel})` : '';
      // Full optimizer label: count + per-module note + model
      const _optLabel = `${input.optimizerQty} DC OPTIMIZERS — 1 PER MODULE${_optModel}`;
      const _topoLabel = 'TOPOLOGY: STRING + OPTIMIZER';
      parts.push(txt(pvCX, pvL0+3*LBL_PITCH, _optLabel, {sz:F.tiny, anc:'middle', fill:'#1A237E', bold:true}));
      parts.push(txt(pvCX, pvL0+4*LBL_PITCH, _topoLabel, {sz:F.tiny, anc:'middle', fill:'#1A237E'}));
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
  // The box's ground conductor leaves its bottom terminal (the symbol's dot,
  // 4.75 uu below the slot); its labels sit right of that drop, below the dot.
  const jbGndTop = jbCY+jbH/2+4.75;
  const jbSideX = jbCX+8, jbSideY = jbCY+jbH/2+17;
  _gndNodes.push({x: jbCX, top: jbGndTop});
  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? microBranchCount(md, input.inverterModel);
    // Branch labels come from the SHARED branch plan (input.microBranches, the
    // same planMicroBranches result PV-1B and the wire-sizing table print) —
    // a plane-contained 12-micro branch runs 25A beside 20A siblings, so a
    // uniform "20A OCPD ea." fallback contradicted the schedule on the sheet.
    const _jbSizes = input.microBranches?.map(b => b.deviceCount) ?? [];
    const _jbOcpds = (input.microBranches?.map(b => b.ocpdAmps) ?? []).filter(n => n > 0);
    // Counted as it reads: '1 branch (11)', never '1 branches'.
    const _jbNoun = nb === 1 ? 'branch' : 'branches';
    const _jbBranchTxt = _jbSizes.length ? `${nb} ${_jbNoun} (${_jbSizes.join('/')})` : `${nb} ${_jbNoun}`;
    const _jbOcpdTxt = _jbOcpds.length
      ? (Math.min(..._jbOcpds) === Math.max(..._jbOcpds)
          ? `${_jbOcpds[0]}A OCPD ea.`
          : `${Math.min(..._jbOcpds)}–${Math.max(..._jbOcpds)}A OCPD`)
      : `${input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20}A OCPD ea.`;
    // Beside the ground drop that leaves the box's bottom terminal, not across
    // it: centred under the box, the drop and the terminal dot ran through
    // both lines (Ray's screenshot).
    parts.push(txt(jbSideX, jbSideY, _jbBranchTxt, {sz:F.tiny, anc:'start'}));
    parts.push(txt(jbSideX, jbSideY+LBL_PITCH, _jbOcpdTxt, {sz:F.tiny, anc:'start'}));
  } else {
    // The string count, beside the ground drop like a micro job's branch
    // count. Left of the box it sat on the DC conductors entering it.
    const _ns = input.totalStrings || 1;
    parts.push(txt(jbSideX, jbSideY, `${_ns} STRING${_ns > 1 ? 'S' : ''}`, {sz:F.sub, bold:true, anc:'start', fill:'#1565C0'}));
  }
  parts.push(callout(jbCX+jbW/2+12, jbCY-jbH/2-5, 2));

  // SEGMENT 1: PV → J-Box (open air)
  {
    // 🚨 ON A MICRO SYSTEM THIS CONDUCTOR IS AC, NOT DC.
    //
    // The microinverter sits AT the module and converts there, so everything
    // leaving the array is 240 V AC on the Q-Cable trunk. This used to bind
    // `roofRun` = ROOF_RUN, which computed-system.ts:1484 defines as
    // "ROOF RUN (DC to Micro)", PV ARRAY → MICROINVERTERS, sourceTerminal 'OUT'
    // → destTerminal 'DC_IN', USE-2/PV Wire, isDC. That is the module-to-micro
    // connection — the module's FACTORY-INTEGRATED LEADS / MC4 connectors — and
    // it is not field wiring at all. Drawing it here printed "#8 DC+ / #8 DC-"
    // on the array home run of an all-AC system: wrong current type, wrong
    // conductors, wrong gauge, and it makes the sheet describe a DC circuit no
    // installer will ever pull.
    //
    // The BOM already had this right — bom-engine-v4 excludes ROOF_RUN from
    // micro DC materials (MICRO_FACTORY_LEAD_IDS, "the field wiring is the AC
    // branch (Q-Cable trunk)"). The drawing now agrees: BRANCH_RUN, the open-air
    // Q-Cable branch. SEGMENT_2A is unaffected — it binds the in-conduit
    // BRANCH_HOMERUN_RUN and only falls back to BRANCH_RUN when there is none.
    // (The run and its callout lines — seg1Run / seg1Lines — are resolved with
    // the X positions, which size this run to carry them.)
    const run = seg1Run;
    const lines = seg1Lines;
    const _s1Y = resolveSegY(pvOutX, jbCX-jbW/2, BUS_Y);
    console.log(`[WIRE RUN CREATED] SEGMENT_1_PV_TO_JBOX: ${isMicro ? 'AC open-air branch (Q-Cable trunk)' : 'DC open-air'}`);
    parts.push(renderWireRun(
      // isDC = !isMicro. This was hardcoded `true`, so even after binding the AC
      // branch run the segment still built a DC_POS/DC_NEG conductor map and drew
      // the array home run as a DC pair. On a micro system it is L1/L2/G.
      buildWireRun('SEGMENT_1_PV_TO_JBOX', pvOutX, _s1Y, _jbInPt.x, _s1Y, run, lines, !isMicro, 'OPEN_AIR'),  // Phase 1: OPEN_AIR — roof surface wiring
      lines, {fit:6}));
  }

  // ── NODE 3: AC COMBINER (micro) or DC DISCONNECT (string) ─────────────────
  let node3RX: number;
  // Where the combiner node's gateway-side connection points landed — read by
  // the GATEWAY + CT LEADS block below, after the MSP has drawn its CTs.
  let _combGw: {
    prodCtTop?: {x:number; y:number};
    gatewayLeadIn?: {x:number; y:number};
    gatewaySupplyOut?: {x:number; y:number};
    ty: number;
  } | null = null;
  // A standalone gateway is drawn only on the micro path — the one path that
  // draws the panel its branches land in.
  const _saGw = isMicro ? input.standaloneGateway : undefined;
  // The CT leads are DRAWN (dashed, gateway → CT) exactly when the composer
  // stated them (`meteringDrawing.leads`) AND this sheet draws the gateway they
  // run to (standalone node, or inside the combiner); otherwise the legacy "CT"
  // bubble continuation is kept, unchanged — a lead with no far end is not
  // drawn.
  const _drawnLeads = isMicro && !!input.meteringDrawing?.leads?.length
    && (!!_saGw || !!input.combinerHasIntegratedGateway);

  if (isMicro) {
    const md = input.deviceCount ?? input.totalModules;
    const nb = input.microBranches?.length ?? microBranchCount(md, input.inverterModel);
    const bocpd = input.branchOcpdAmps ?? branchRun?.ocpdAmps ?? 20;
    // Standalone: the box the branches land in IS the PV AC combiner panel
    // (landingLabel === combinerLabel by contract); the gateway is drawn apart.
    const clabel = _saGw?.landingLabel ?? input.combinerModel ?? input.combinerLabel ?? `${input.inverterManufacturer} IQ Combiner`;
    // The gateway inside an integrated combiner is drawn as the gateway — the
    // combiner's brand first ('Enphase IQ Combiner 5C'), then the inverter's.
    const _gwArt = resolveDeviceIllustration(clabel.split(/\s+/)[0] ?? '', 'gateway')
      ?? resolveDeviceIllustration(input.inverterManufacturer ?? '', 'gateway');
    const cr = renderCombiner(xComb, BUS_Y, nb, bocpd, clabel, 3,
      {integratedGateway: _saGw ? false : input.combinerHasIntegratedGateway, providesDisconnect: input.combinerProvidesAcDisconnect,
       branchOcpds: input.microBranches?.map(b => b.ocpdAmps),
       // `=== false` and not `!input...`: undefined is "the builder did not
       // answer", which must draw as before, not as "nobody chose it".
       selectionUnresolved: input.combinerSelectionIsDecided === false,
       neutral: _feederHasNeutral,
       productionCt: input.meteringDrawing?.production?.where,
       ctLeadConnector: !!input.meteringDrawing?.lead,
       drawnCtLeads: _drawnLeads,
       gatewayArt: _gwArt,
       gatewaySupplyBreakerA: _saGw?.supplyBreakerA,
       // Named once, above the box, like every other node on this sheet.
       headerAbove: true,
       labelPitch: LBL_PITCH});
    _combGw = {prodCtTop: cr.prodCtTop, gatewayLeadIn: cr.gatewayLeadIn, gatewaySupplyOut: cr.gatewaySupplyOut, ty: cr.ty};
    parts.push(cr.svg);
    node3RX = cr.feederOutX;  // Use feeder output terminal X as the right-side connection point
    parts.push(txt(xComb, cr.ty-8, 'AC COMBINER', {sz:F.hdr, bold:true, anc:'middle'}));
    _gndNodes.push({x: xComb, top: cr.by, skip: cr.lbl});

    // SEGMENT 2: J-Box → Combiner  (§3/§4 — the SHARED conduit home-run)
    {
      // Prefer the dedicated home-run conduit segment; the open-air BRANCH_RUN is
      // the Q-Cable trunk drawn as SEGMENT 1 and must NOT drive this in-conduit run.
      const run = branchHomerunRun ?? branchRun;
      // Conductor gauge(s) from the branch plan's own callouts — mixed-OCPD
      // plans carry mixed gauges (#12 for 20A branches, #10 for a 25A branch).
      // §1 — SEGMENT_2A is the SHARED jbox→combiner home-run: print the canonical
      // physicalRaceway's FULL current-carrying inventory ('6#10 THWN-2') from
      // homerunCurrentCarryingCount + homerunConductorGauge (gate 2 — count ==
      // raceway inventory). Never the legacy per-branch #12-from-OCPD gauge.
      const _hrGaugeNum = (input.homerunConductorGauge ?? '').replace('#', '').replace(' AWG', '').trim();
      const _brGauges = [...new Set((input.microBranches ?? [])
        .map(b => b.conductorCallout?.match(/#\d+(?:\/0)?/)?.[0])
        .filter((g): g is string => !!g))];
      const _brWireTxt = (input.homerunCurrentCarryingCount && _hrGaugeNum)
        ? `${input.homerunCurrentCarryingCount}#${_hrGaugeNum} THWN-2`
        : _brGauges.length
          ? `${_brGauges.join('/')} AWG THWN-2`
          : `${input.branchWireGauge??'#10 AWG'} THWN-2`;
      // W1b — the branch home-run conduit label PROJECTS the canonical BRANCH_RUN
      // raceway (branchConduitType/Size from the snapshot), never a hardcoded
      // '3/4" EMT'. Open-air Q-Cable branches print the 690.31(C) free-air label;
      // in-raceway home runs print the real raceway type + size (matching PV-4B).
      // §3/§4 — SEGMENT_2A is the SHARED jbox→combiner raceway. Label it from the
      // home-run raceway projection (bundled branches in conduit), NOT the open-air
      // branch. Falls back to the legacy branch label only when no home-run object.
      const _brCondLine = input.homerunConduitType
        ? `IN ${input.homerunConduitSize ?? ''} ${input.homerunConduitType}${input.homerunSharedCircuits && input.homerunSharedCircuits > 1 ? ` (${input.homerunSharedCircuits} BRANCHES SHARED)` : ''}`.replace(/\s+/g, ' ').trim()
        : (input.branchIsOpenAir
            ? 'OPEN AIR — NEC 690.31(C)'
            : `IN ${input.branchConduitSize ?? '3/4"'} ${input.branchConduitType ?? 'EMT'}`);
      // §5 — SEGMENT_2A cites the SHARED HOME-RUN raceway's own EGC.
      const fb = [_brWireTxt, `1×#${homerunEgcNum} GRN EGC`, _brCondLine];
      const {lines, cnt} = runLines(run, fb);
      const _s2aY = resolveSegY(jbCX+jbW/2, cr.lx, BUS_Y);
      console.log('[WIRE RUN CREATED] SEGMENT_2A_JBOX_TO_COMBINER: AC branch');
      parts.push(renderWireRun(
        buildWireRun('SEGMENT_2A_JBOX_TO_COMBINER', _jbOutPt.x, _s2aY, cr.lx, _s2aY, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY — post-jbox
        lines, {fit:6}));
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
      // It ends ON the inverter's DC terminal (drawn below; its geometry is
      // known now). It used to end at a fixed xInv−60 — under a generic
      // cabinet, 10 uu short of a brand illustration — with the terminal's own
      // stub floating 25 uu above it.
      const _invT = inverterTerminals(
        isInverterUnselectedMarker(input.inverterModel) ? '' : (input.inverterManufacturer ?? ''), xInv, BUS_Y);
      const _s2dInvX = _invT.dcInX;
      node3RX = _s2dInvX;            // Phase 5: set node3RX for downstream code
      const _s2dY = resolveSegY(_jbOutPt.x, _s2dInvX, BUS_Y);
      parts.push(renderWireRun(
        buildWireRun('SEGMENT_2D_JBOX_TO_INV_DIRECT', _jbOutPt.x, _s2dY, _s2dInvX, _s2dY, run, lines, true, 'RACEWAY'),
        // Its callout stops short of the inverter's DC input stub.
        lines, {fit:6, labelSpan:[_jbOutPt.x, _s2dInvX - 2]}));
      if (Math.abs(_s2dY - _invT.dcInY) > 1) parts.push(ln(_s2dInvX, _s2dY, _s2dInvX, _invT.dcInY, {sw:SW_MED}));
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
    // Line lugs
    // SOT: internal wiring handled by dc-disconnect emblem
    // SOT: dc-disconnect emblem handles all internal rendering (fuses/lugs/wires removed)
    // One header. A second 'DC DISCONNECT' 7 uu under this one printed on it.
    parts.push(txt(dcX, dcY-dH/2-15, '(N) DC DISCONNECT', {sz:F.sub, bold:true, anc:'middle'}));
    // Its ground conductor leaves the symbol's bottom terminal; the ratings sit
    // right of that drop, under the terminal dot (centred, the dot and the drop
    // ran through them).
    const dcSideY = dcY+dH/2+17;
    _gndNodes.push({x: dcX, top: dcY+dH/2+4.75});
    parts.push(txt(dcX+8, dcSideY, `${input.dcOCPD}A FUSED`, {sz:F.tiny, anc:'start'}));
    if (input.rapidShutdownIntegrated) {
      parts.push(txt(dcX+8, dcSideY+LBL_PITCH, 'RAPID SHUTDOWN — NEC 690.12', {sz:F.tiny, anc:'start', italic:true}));
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
        lines, {fit:6}));
    }
  }

  // ── NODE 4: INVERTER (string only) ────────────────────────────────────────
  let invRX = node3RX;
  /** The inverter's AC terminal height — the feeder jogs to it (string only). */
  let invAcOutY: number | null = null;

  if (!isMicro) {
    const invCX = xInv, invCY = BUS_Y;
    const tl = (input.ecosystemTopology === 'optimizer' || input.topologyType === 'STRING_WITH_OPTIMIZER' || input.topologyType === 'OPTIMIZER')
      ? 'STRING + OPTIMIZER'
      : 'STRING INVERTER';
    const _invUnSingle = isInverterUnselectedMarker(input.inverterModel);
    const invBox = renderInverterBox(
      invCX, invCY,
      _invUnSingle ? '' : input.inverterManufacturer, input.inverterModel,
      input.acOutputKw, input.acOutputAmps,
      tl, input.mpptAllocation ?? '',
      4, _invUnSingle, LBL_PITCH
    );
    parts.push(invBox.svg);
    invRX = invBox.acOutX;  // Use AC output terminal X as the right-side connection point
    invAcOutY = invBox.acOutY;
    _gndNodes.push({x: invCX, top: invBox.gndTop, skip: invBox.lbl});

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
        // The run leaves the DC disconnect's output terminal on ITS line (the
        // chain's, BUS_Y) and jogs square at the inverter's DC terminal. Run at
        // the inverter's terminal height it started 25 uu above the
        // disconnect's terminal, joined to nothing.
        const _s3Y = resolveSegY(node3RX, invBox.dcInX, BUS_Y);
        console.log('[WIRE RUN CREATED] SEGMENT_3_DCDISCO_TO_INV: DC run');
        parts.push(renderWireRun(
          buildWireRun('SEGMENT_3_DCDISCO_TO_INV', node3RX, _s3Y, invBox.dcInX, _s3Y, run, s3lines, true, 'RACEWAY'),  // Phase 1: RACEWAY
          // Clear of the DC disconnect's callout bubble, which rides over
          // this run's first 7 uu.
          s3lines, {fit:4, labelSpan:[node3RX + 8, invBox.dcInX]}));
        if (Math.abs(_s3Y - invBox.dcInY) > 1) parts.push(ln(invBox.dcInX, _s3Y, invBox.dcInX, invBox.dcInY, {sw:SW_MED}));
      }
    } // end !integratedDcDisconnect
  }

  // ── NODE 5: AC DISCONNECT ─────────────────────────────────────────────────
  const discoResult = renderDisco(xDisco, BUS_Y, resolvedAcOCPD, isMicro?4:5, isSupplySide, _feederHasNeutral, LBL_PITCH);
  parts.push(discoResult.svg);
  _gndNodes.push({x: xDisco, top: BUS_Y + SLD_SYMBOL_MAP['ac-disconnect'].height/2, skip: discoResult.lbl});
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
      buildWireRun('SEGMENT_4_INV_TO_ACDISCO', invRX, _s4Y, discoResult.loadInX, _s4Y, run, lines, false, 'RACEWAY', _feederHasNeutral),  // Phase 1: RACEWAY
      // Clear of the disconnect's entry stubs, which rise from this line to
      // its poles (and its neutral) in the last 10 uu before its wall.
      lines, {fit:1, labelSpan:[invRX + 2, discoResult.loadInX - 12]}));
    // A generic inverter's AC terminal sits 10 uu above the chain: the feeder
    // jogs square to it (its stub floated beside the run's start).
    if (invAcOutY !== null && Math.abs(_s4Y - invAcOutY) > 1) parts.push(ln(invRX, _s4Y, invRX, invAcOutY, {sw:SW_MED}));
  }

  // ── NODE 6: MSP ───────────────────────────────────────────────────────────
  let mspRX: number;
  let buiRX: number; // right edge of BUI (or MSP if no battery) // Y of MSP output wire (main bus level)
  // buiResult is hoisted so the generator section (outside battery block) can access BUI terminal coords
  let buiResult: ReturnType<typeof renderBUI> | undefined;
  // mspResult holds terminal coordinates for both MSPLoad and MSPSupply (same
  // interface) — and its main bus's own height (busY).
  let mspResult: MspResult;
  // The tag at the consumption CTs states the composer's count — it used to be
  // a literal 'CT×2' whatever the design's ungrounded-conductor count was.
  const _ctCount = input.meteringDrawing?.consumption?.ctCount;
  const _mspCt: MspCtOpts = {
    tag: `CT×${_ctCount ?? '?'}`,
    drawnLead: _drawnLeads && !!input.meteringDrawing?.leads?.some(l => l.channel === 'consumption'),
  };

  if (isLoadSide) {
    const r = renderMSPLoad(xMSP, BUS_Y, input.mainPanelAmps, pvBreakerAmps, isMicro?5:6,
      input.meteringDrawing?.consumption?.location ?? null, _mspCt, LBL_PITCH);
    parts.push(r.svg);
    mspRX = r.rx;
    mspResult = r;
  } else {
    const r = renderMSPSupply(xMSP, BUS_Y, input.mainPanelAmps, input.backfeedAmps, isSupplySide, isMicro?5:6,
      input.meteringDrawing?.consumption?.location ?? null, _mspCt, LBL_PITCH);
    parts.push(r.svg);
    mspRX = r.rx;
    mspResult = r;
  }
  _gndNodes.push({x: xMSP, top: BUS_Y + SLD_SYMBOL_MAP['msp'].height/2, skip: mspResult.lbl});

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
      buildWireRun('SEGMENT_5_ACDISCO_TO_MSP', discoResult.lineOutX, _s5Y, mspResult.bkfdInX, _s5Y, run, lines, false, 'RACEWAY', _acNeutral),  // Phase 1: RACEWAY
      // Clear of the disconnect's exit stubs, which rise from this line to
      // its poles (and its neutral) in the first 10 uu past its wall.
      lines, {fit:1, labelSpan:[discoResult.lineOutX + 12, mspResult.bkfdInX - 2]}));
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
      isMicro ? 7 : 8,
      {batteryAbove: true},
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
    //
    // 🚨 WAS: `input.batteryBackfeedA ?? 20`. A renderer cannot know a breaker
    // rating, and this one asserted 20 A on the drawing whenever the value did
    // not reach it — a number an AHJ reads as an engineering conclusion. The
    // renderer PRINTS the authority's answer and nothing else. When the value
    // is absent the symbol still draws (the breaker physically exists) but it
    // is labelled UNRESOLVED, so the omission is visible on the sheet instead
    // of being silently filled with a plausible ampacity.
    const bfA = input.batteryBackfeedA;
    const bfLabel = (bfA != null && bfA > 0) ? `${bfA}A BATT` : 'BATT — SIZE UNRESOLVED';
    // It taps the MSP's MAIN BUS: its stem hangs from the bus's own height
    // (mspResult.busY), not from the chain's line 42–52 uu below it, where it
    // started in mid-air. Its column is the panel's clear one for each
    // drawing: right of the PV breaker's rating on a load-side panel (at
    // xMSP+30 the stem ran down that breaker's edge), left of the main's label
    // on a tap, clear of the backfed breaker's labels on a backfed panel.
    const bfX = isLoadSide ? xMSP + 56 : isSupplySide ? xMSP - 22 : xMSP + 48;
    // Its rating is printed once, in the label under it ('20A BATT'): the
    // symbol's own rating rode above it, where its stem struck through it.
    parts.push(breakerSymbol(bfX, BUS_Y + 30, 20, 12));
    parts.push(ln(bfX, mspResult.busY, bfX, BUS_Y + 24, {sw: SW_THIN, stroke: '#1565C0'}));
    // Centred under the breaker unless that would carry it through the panel's
    // right wall ('BATT — SIZE UNRESOLVED' is 118 uu at the printed size).
    const bfLblX = Math.min(bfX, xMSP + SLD_SYMBOL_MAP['msp'].width/2 - 5
      - Math.max(textWidthUu(bfLabel, 5, true), textWidthUu('NEC 705.12(B)', 4.5))/2);
    parts.push(txt(bfLblX, BUS_Y + 47, bfLabel, {sz: 5, anc: 'middle', bold: true,
      fill: (bfA != null && bfA > 0) ? '#1565C0' : '#C62828'}));
    parts.push(txt(bfLblX, BUS_Y + 47 + LBL_PITCH, 'NEC 705.12(B)', {sz: 4.5, anc: 'middle', italic: true, fill: '#1565C0'}));

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
      input.batteryKwhLabel ?? '',
      {labelsLeftOfDrop: true},
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
    // The block is centred on the span, pitched for the printed size, and
    // clear of the unit's 'BATTERY' port label under it.
    const _batWireMidY = (batResult.acOutY + buiResult.batPortY) / 2;
    parts.push(tspan(batResult.acOutX + 6, _batWireMidY - (batCalloutLines.length - 1) * LBL_PITCH / 2 - 3,
      batCalloutLines,
      {sz: F.tiny, anc: 'start', fill: '#1565C0', lh: LBL_PITCH}));

    // Backup sub-panel — connected to BUI load port (right side). It sits
    // UNDER the BUI's nameplate, its feeder dropping just right of the BUI and
    // entering the panel's right wall. (It used to sit right of the BUI at
    // BUS_Y+100 — on the utility meter, the service conductors and its own
    // feeder's callout.) The room left above it, right of the BUI's feeder
    // corner, is where an IQ SC3 generator's callout goes (NODE 9).
    if (input.hasBackupPanel) {
      const bpRunX = buiResult.loadPortX + 16;
      const bpCX = bpRunX - 14 - 85;
      const bpCY = buiResult.by + 14 + 2 * LBL_PITCH + 45 + 60;
      const bpResult = renderBackupPanel(
        bpCX, bpCY,
        input.backupPanelBrand ?? (isEnphase ? 'Enphase' : ''),
        input.backupPanelAmps ?? 100,
        isMicro ? 9 : 10
      );
      parts.push(bpResult.svg);
      // Wire: BUI load port → backup panel (right, down, left into its lug)
      parts.push(ln(buiResult.loadPortX, buiResult.loadPortY, bpRunX, buiResult.loadPortY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpRunX, buiResult.loadPortY, bpRunX, bpResult.feedInY, {stroke: '#6A1B9A', sw: SW_MED}));
      parts.push(ln(bpRunX, bpResult.feedInY, bpResult.feedInX, bpResult.feedInY, {stroke: '#6A1B9A', sw: SW_MED}));
      // BUILD v24: Use computed BUI_TO_MSP_RUN conductorCallout for backup panel feeder
      const bpCalloutLines = buiToMspRun?.conductorCallout
        ? buiToMspRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : ['#6 AWG THWN-2', 'CRITICAL LOADS'];
      // Beside its own drop, below the service conductors and their EGC.
      parts.push(tspan(bpRunX + 6, buiResult.loadPortY + 30, bpCalloutLines,
        {sz: F.tiny, anc: 'start', fill: '#6A1B9A', lh: LBL_PITCH}));
      _auxBottom = Math.max(_auxBottom, bpResult.lblBot);
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
      // The generator stands between the MSP and the BUI, BELOW the MSP's
      // nameplate (it used to sit on it, at BUS_Y+160, with its conductor rising
      // through the BUI's nameplate and the BUI itself). Its conductor runs
      // right, then up just LEFT of the BUI to the BUI's GEN port on the BUI's
      // left wall; its callout sits right of that rise, under the BUI's
      // nameplate; its NEC notes close left of the rise, clear of a backup
      // sub-panel under the BUI.
      // buiResult is hoisted from NODE 8; the fallbacks are for an IQ SC3 job
      // drawn without its battery (shouldn't happen).
      const buiGenY  = buiResult?.genPortY ?? (BUS_Y + 14);
      const buiGenX  = buiResult?.genPortX ?? (xMSP + 130 - 50);
      const genCX = buiGenX - 90;
      const genCY = mspResult.lbl.bot + 4 + capUu(F.hdr) + 30 + 18;
      const genResult = renderGenerator(
        genCX, genCY,
        input.generatorBrand ?? '',
        input.generatorModel ?? '',
        input.generatorKw!,
        isMicro ? 10 : 11
      );
      parts.push(genResult.svg);

      // Wire: Generator GEN_OUT terminal → BUI GEN port (L-shaped route)
      const genWireX = buiGenX - 14;
      parts.push(ln(genResult.genOutX, genResult.genOutY, genWireX, genResult.genOutY, {stroke: '#2E7D32', sw: SW_MED}));
      parts.push(ln(genWireX, genResult.genOutY, genWireX, buiGenY, {stroke: '#2E7D32', sw: SW_MED}));
      parts.push(ln(genWireX, buiGenY, buiGenX, buiGenY, {stroke: '#2E7D32', sw: SW_MED}));

      // Wire callout — use computed GENERATOR_TO_ATS_RUN conductorCallout
      const genCalloutLines = genToAtsRun?.conductorCallout
        ? genToAtsRun.conductorCallout.split('\n').filter((l:string)=>l.trim()).slice(0,2)
        : (genToAtsRun?.wireGauge
            ? [`${genToAtsRun.wireGauge} THWN-2`, `${genToAtsRun.ocpdAmps ?? ''}A OCPD`]
            : ['SEE COMPUTED SCHEDULE', 'GEN → IQ SC3 GEN PORT']);
      const genCalloutY = (buiResult?.by ?? BUS_Y + 65) + 14 + 2 * LBL_PITCH + descUu(F.tiny) + 4 + capUu(F.tiny);
      parts.push(tspan(genWireX + 6, genCalloutY, genCalloutLines, {sz: F.tiny, anc: 'start', fill: '#2E7D32', lh: LBL_PITCH}));

      // NEC notes
      const genNoteY = genResult.by + 18 + 2 * LBL_PITCH;
      parts.push(txt(genWireX - 6, genNoteY, 'NEC 702.5 — TRANSFER FUNCTION IN IQ SC3', {sz: F.tiny, anc: 'end', italic: true, fill: '#2E7D32'}));
      parts.push(txt(genWireX - 6, genNoteY + LBL_PITCH, 'NEC 250.30 — FLOATING NEUTRAL AT IQ SC3', {sz: F.tiny, anc: 'end', italic: true, fill: '#2E7D32'}));
      _auxBottom = Math.max(_auxBottom, genNoteY + LBL_PITCH + descUu(F.tiny));

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
    // ══ 2026-08-29 — THIS SPAN IS THE EXISTING SERVICE, NOT THE PV CIRCUIT ══
    // MSP bus-out → utility meter is the building's EXISTING service entrance:
    // conductors that were in the ground before this project and that nobody on
    // this job installs. The fallback below was the PV FEEDER's own conductor
    // package - `${_acConductorCount}#${_acWireNum} THWN-2 / 1×#10 GRN EGC / IN
    // 3/4" EMT` - so whenever the canonical run carried no bundle, the SLD drew
    // the PV tap conductors continuing straight through the meter and out to the
    // grid. A reviewer reads that as "the PV #6 THWN-2 IS the service entrance".
    //
    // A segment may not inherit the preceding segment's conductor inventory. When
    // the existing service has not been surveyed, the honest label says so - the
    // same wording the other SLD branch has always used for this span.
    // '(E)' is the sheet's own existing-equipment notation ((E) UTILITY METER).
    // The long form — 'EXISTING SERVICE CONDUCTORS', 145.5 uu in the printed face
    // — was centred on this ~130 uu span, so its 'E' sat inside the MSP and the
    // panel wall struck through it on every sheet. Both lines now fit the span.
    const fb = [
      '(E) SERVICE CONDUCTORS',
      `${input.mainPanelAmps ?? '—'}A — FIELD VERIFY`,
    ];
    const {lines, cnt} = runLines(run, fb);
    // Source: BUI LOAD port when battery present, else MSP busOut terminal.
    // When BUI is present, the bus wire exits from BUI LOAD port (right-side lug).
    // When no BUI, it exits from MSP busOut terminal.
    const _seg6SrcX = buiResult ? buiResult.loadPortX : mspResult.busOutX;
    const _seg6SrcY = buiResult ? buiResult.loadPortY : mspResult.busOutY;
    // The run lies on the METER's line (its lead-in stub is at utilCY) and
    // jogs square at its source when the source port sits off that line (a
    // BUI's transfer path). Run at the port's height it ended level with
    // nothing: 15–21 uu over the meter's stub.
    const _s6Y = resolveSegY(_seg6SrcX, utilCX-mR-10, utilCY);
    console.log('[WIRE RUN CREATED] SEGMENT_6_MSP_TO_METER: AC service run');
    parts.push(renderWireRun(
      buildWireRun('SEGMENT_6_MSP_TO_METER', _seg6SrcX, _s6Y, utilCX-mR-10, _s6Y, run, lines, false, 'RACEWAY'),  // Phase 1: RACEWAY
      // The callout clears the source's jog (it runs 10 uu out of the wall)
      // and may run on over the meter's lead-in stub.
      lines, {fit:3, labelSpan:[_seg6SrcX + 12, utilCX-mR-2]}));
    if (Math.abs(_s6Y - _seg6SrcY) > 1) parts.push(ln(_seg6SrcX, _seg6SrcY, _seg6SrcX, _s6Y, {sw:SW_MED}));
  }

  // Meter symbol
  parts.push(meterSymbol(utilCX, utilCY, mR));
  parts.push(ln(utilCX-mR-10, utilCY, utilCX-mR, utilCY, {sw:SW_MED}));
  parts.push(txt(utilCX, utilCY-mR-15, 'UTILITY METER', {sz:F.hdr, bold:true, anc:'middle'}));
  parts.push(txt(utilCX, utilCY-mR-6, esc(input.utilityName), {sz:F.sub, anc:'middle'}));
  // The service rating sits beside the meter's drop to the grid, not on it:
  // centred under the meter, that drop ran through '120/240V, 1Ø, 3W'.
  parts.push(txt(utilCX+6, utilCY+mR+13, '120/240V, 1Ø, 3W', {sz:F.tiny, anc:'start'}));
  // The callout bubble stands clear of a long utility name beside it.
  const meterCalloutX = Math.max(utilCX+mR+14,
    utilCX + textWidthUu(String(input.utilityName ?? ''), F.sub)/2 + 14);
  parts.push(callout(meterCalloutX, utilCY-mR-5, isMicro?6:7));

  // Utility grid (vertical drop below meter)
  const gridCY = utilCY + mR + 48;
  parts.push(ln(utilCX, utilCY+mR, utilCX, gridCY-16, {sw:SW_MED}));
  parts.push(circ(utilCX, gridCY, 16, {fill:WHT, sw:SW_MED}));
  parts.push(txt(utilCX, gridCY-1, 'UTIL', {sz:5.5, bold:true, anc:'middle'}));
  parts.push(txt(utilCX, gridCY+7, 'GRID', {sz:5, anc:'middle'}));
  // Its name beside the symbol. Under it, the symbol's own ground stub and
  // ground ran through 'UTILITY GRID' and the utility's name.
  const gridLblX = utilCX+22;
  parts.push(txt(gridLblX, gridCY-1, 'UTILITY GRID', {sz:F.tiny, anc:'start', bold:true}));
  parts.push(txt(gridLblX, gridCY+LBL_PITCH-1, esc(input.utilityName), {sz:F.tiny, anc:'start'}));
  const gridLblRight = gridLblX + Math.max(textWidthUu('UTILITY GRID', F.tiny, true),
    textWidthUu(String(input.utilityName ?? ''), F.tiny));
  parts.push(ln(utilCX, gridCY+16, utilCX, gridCY+26, {sw:SW_MED}));
  parts.push(gnd(utilCX, gridCY+26));

  // ── GROUNDING RAIL ────────────────────────────────────────────────────────
  // Phase 8: Ground drops only at actual equipment nodes (each node reported
  // its own — _gndNodes). For optimizer with integratedDcDisconnect, xComb has
  // no equipment, so nothing reported there.
  // ─── GROUNDING RAIL (subordinate visual weight) ─────────────────────────
  // Use thinner stroke + muted green so the ground rail recedes behind the
  // primary DC/AC conductor paths.
  //
  // Each drop leaves its OWN equipment — the enclosure's bottom edge, or the
  // symbol's ground terminal — and BREAKS for the nameplate block under that
  // equipment, the way a drafted line is broken for text. It used to run
  // unbroken from BUS_Y+55, which started it inside the combiner and the MSP
  // and struck it through every line of every nameplate (Ray, 2026-09-26: "the
  // word bleed and overlays"). Terminal-type symbols (the J-box, the DC
  // disconnect) keep a continuous drop: their labels sit beside it.
  const GND_CLR  = '#2E7D32';  // muted green — less dominant than #005500
  const GND_SW   = 1.0;        // thin stroke — subordinate
  const gndPts = _gndNodes.map(n => n.x);
  // The rail runs under the deepest nameplate block, never through one.
  const gndY = Math.max(GND_Y, ..._gndNodes.map(n => (n.skip ? n.skip.bot + 9 : -Infinity)));
  const gx1 = gndPts[0], gx2 = gndPts[gndPts.length-1];
  parts.push(ln(gx1, gndY, gx2, gndY, {stroke:GND_CLR, sw:GND_SW}));
  for (const n of _gndNodes) {
    const spans: Array<[number, number]> = n.skip
      ? [[n.top, n.skip.top - 2.5], [n.skip.bot + 2.5, gndY]]
      : [[n.top, gndY]];
    for (const [a, b] of spans) {
      if (b - a >= 2) parts.push(ln(n.x, a, n.x, b, {stroke:GND_CLR, sw:GND_SW, dash:'4,3'}));
    }
    parts.push(gnd(n.x, gndY, GND_CLR));
  }
  // The rail's name, under the rail and its ground symbols — on the rail, it
  // was crossed by two of its own drops.
  const gndNoteY = gndY + 29;
  parts.push(txt((gx1+gx2)/2, gndNoteY,
    'EQUIPMENT GROUNDING CONDUCTORS — NEC 250.122 / NEC 690.43',
    {sz:F.tiny, anc:'middle', fill:GRN}));

  // ── THE GATEWAY AND ITS CT LEADS ──────────────────────────────────────────
  // Ray, 2026-09-26: "I would like to see CTs drawn from the Envoy to the MSP or
  // wherever it is going to land." Each lead the composer states
  // (meteringDrawing.leads) is DRAWN as Enphase's own line diagram draws it
  // (EN-IQ8-1PHN): a heavy dashed conductor from the CT to the gateway, one
  // per channel, labelled once with the composer's words — the production
  // lead's "DO NOT EXTEND" and the consumption leads' extension rule are
  // opposite rules, so each carries its own. Nothing here decides a length or
  // a location; it draws them.
  //
  // ROUTING. Every lead runs in the clear band ABOVE the chain (nothing lives
  // there but the battery, far right), leaving each panel by a rise the panel
  // itself reports as clear of its own text and callout. Leads cross conductors
  // only square-on, and never text.
  //
  // A standalone gateway is drawn here too: its own enclosure above the panel
  // it is fed from, its supply conductor rising from its 2-pole breaker in that
  // panel, its production CT's 5 ft lead rising beside it.
  let _anyLeadDrawn = false;
  const _undrawnLeadLabels: string[] = [];
  if (isMicro && _combGw) {
    const _leads = _drawnLeads ? (input.meteringDrawing?.leads ?? []) : [];
    const _consLead = _leads.find(l => l.channel === 'consumption');
    const _prodLead = _leads.find(l => l.channel === 'production');
    const _exit = mspResult.ctLeadExit;
    const _lead = ctLeadPolyline;
    const _term = ctLeadTerminal;

    if (_saGw) {
      // ── Standalone gateway node ────────────────────────────────────────
      const gwCX = xComb + 56;                     // between its supply (x+40) and its PCT lead (x+72)
      // 130–230: the clear band, well under the fit box top.
      const node = standaloneGatewayNode(gwCX, SCH_Y + 60, _saGw, LBL_PITCH);
      parts.push(...node.parts);
      const {ex0, ex1, ey1} = node;

      // Its supply circuit: from its breaker in the landing panel, straight up.
      const so = _combGw.gatewaySupplyOut;
      if (so) {
        parts.push(ln(so.x, so.y, so.x, ey1, {sw:SW_MED}));
        parts.push(txt(so.x-6, ey1+66, `${_saGw.supplyBreakerA}A 2P — GATEWAY SUPPLY`, {sz:F.seg, anc:'end', bold:true}));
        parts.push(txt(so.x-6, ey1+75, esc(_saGw.supplyConductor), {sz:F.seg, anc:'end'}));
      }

      // Production CT lead — straight up from the ring on L1 in the PV panel.
      const pt = _combGw.prodCtTop;
      if (_prodLead && pt && input.meteringDrawing?.production?.where === 'landing-panel-field'
          && pt.x > ex0 + 8 && pt.x < ex1 - 8) {
        parts.push(_lead([[pt.x, pt.y], [pt.x, ey1]]));
        parts.push(_term(pt.x, ey1));
        parts.push(txt(pt.x+6, ey1+70, esc(_prodLead.label), {sz:F.tiny, anc:'start', bold:true, fill:CT_CLR}));
        _anyLeadDrawn = true;
      } else if (_prodLead) {
        _undrawnLeadLabels.push(_prodLead.label);
      }

      // Consumption CT leads — from the MSP's rise, along the band, into the
      // gateway's right side near its terminal door.
      if (_consLead && _exit?.length) {
        const rx = _exit[_exit.length - 1][0];
        const laneY = ey1 - 16;
        parts.push(_lead([..._exit, [rx, laneY], [ex1, laneY]]));
        parts.push(_term(ex1, laneY));
        parts.push(txt((ex1 + rx)/2, laneY-6, esc(_consLead.label), {sz:F.tiny, anc:'middle', bold:true, fill:CT_CLR}));
        _anyLeadDrawn = true;
      } else if (_consLead) {
        _undrawnLeadLabels.push(_consLead.label);
      }
    } else if (_combGw.gatewayLeadIn) {
      // ── Integrated gateway (inside the combiner) ─────────────────────────
      // Its production CT is factory pre-wired, so the composer states only the
      // consumption lead. It leaves the combiner through the top, over the
      // gateway art, and runs the band to the MSP.
      const gi = _combGw.gatewayLeadIn;
      if (_consLead && _exit?.length) {
        const rx = _exit[_exit.length - 1][0];
        const laneY = _combGw.ty - 63;
        parts.push(_lead([..._exit, [rx, laneY], [gi.x, laneY], [gi.x, gi.y]]));
        parts.push(_term(gi.x, gi.y));
        parts.push(txt((gi.x + rx)/2, laneY-6, esc(_consLead.label), {sz:F.tiny, anc:'middle', bold:true, fill:CT_CLR}));
        _anyLeadDrawn = true;
      } else if (_consLead) {
        _undrawnLeadLabels.push(_consLead.label);
      }
      // A field PCT on the output circuit of a combiner-drawn gateway has no
      // clear route out (the callout and the feeder callout sit over it): its
      // lead is stated in the note band instead of being drawn through them.
      if (_prodLead) _undrawnLeadLabels.push(_prodLead.label);
    }
  }

  // ── METERING: the consumption CTs and their leads (designMetering) ───────
  // Stated in the clear band under the ground rail — the CT symbols sit where
  // they clamp. Where the leads are drawn, each carries its own label (above)
  // and the composer's older one-line `lead` is NOT repeated here: its
  // "EXTEND / RACEWAY PER MFR" would sit on the same sheet as the drawn lead's
  // "EXTEND ≤1.5 Ω/WIRE", two extension rules for one lead. Where they are not
  // drawn, the two "CT" bubbles (at the CTs and at the gateway) are the
  // continuation of the secondary leads between them, and that line keys them.
  // The notes stack under the rail's own name, pitched for the size that
  // prints (at GND_Y+24 the first sat 1.2 uu under the ground symbols' bars).
  let _notesBottom = gndNoteY + descUu(F.tiny);
  {
    const _mx = (gx1 + gx2) / 2;
    let _ny = gndNoteY + 12.5;
    if (input.meteringDrawing?.consumption) {
      parts.push(txt(_mx, _ny, consumptionCtNoteText(input.meteringDrawing.consumption),
        {sz:F.tiny, anc:'middle', bold:true, fill:CT_CLR})); _ny += 11;
      // `_drawnLeads` and not "a lead was drawn": in drawn-lead mode no bubble
      // is drawn anywhere, and the consumption lead's own words are either on
      // its drawn line or (undrawable) in the list just below.
      if (input.meteringDrawing.lead && !_drawnLeads) {
        parts.push(txt(_mx, _ny, `(CT) = ${input.meteringDrawing.lead.label}`,
          {sz:F.tiny, anc:'middle', fill:CT_CLR})); _ny += 11;
      }
    }
    // A stated lead that could not be drawn is still stated.
    for (const l of _undrawnLeadLabels) {
      parts.push(txt(_mx, _ny, l, {sz:F.tiny, anc:'middle', fill:CT_CLR})); _ny += 11;
    }
    _notesBottom = Math.max(_notesBottom, _ny - 11 + descUu(F.tiny));
  }

  // ── AUTO-SCALE the schematic to fill its area ─────────────────────────────
  // The horizontal chain (PV → … → Utility) is laid out with fixed WIRE_GAPs
  // from LEFT_MARGIN and historically used ~55-65% of the schematic box — small
  // symbols, small type, dead band below the ground rail (the E-1 "thin strip").
  // Wrap everything drawn since the schematic border in a scale group computed
  // to FIT the real content bounds (chain right edge = xUtil; bottom = ground
  // rail) into the box. Strokes/fonts scale with it — that is the point.
  {
    const _sx0 = SCH_X + 16;                 // content left (a hair before PV)
    // content right (utility + label margin, or the grid's name beside it)
    const _sx1 = Math.max(xUtil + 96, gridLblRight + 8, meterCalloutX + 14);
    const _sy0 = SCH_Y + 22;                 // content top (above symbols)
    // content bottom (ground rail, its name and the notes under it)
    const _sy1 = Math.max(GND_Y + 48, _notesBottom + 8, _auxBottom + 8);
    const _k = Math.max(1, Math.min(
      (schW - 32) / Math.max(1, _sx1 - _sx0),
      (SCH_H - 36) / Math.max(1, _sy1 - _sy0),
      1.55,                                  // sanity cap — beyond this it reads cartoonish
    ));
    if (_k > 1.02) {
      const _tx = SCH_X + (schW - _k * (_sx1 - _sx0)) / 2 - _k * _sx0;
      // Center VERTICALLY too — top-anchoring left the whole spare height as a
      // dead band under the ground rail.
      const _ty = SCH_Y + (SCH_H - _k * (_sy1 - _sy0)) / 2 - _k * _sy0;
      parts.splice(_schScaleStart, 0,
        `<g transform="translate(${_tx.toFixed(1)},${_ty.toFixed(1)}) scale(${_k.toFixed(3)})">`);
      parts.push('</g>');
    }
  }

  // ── Rapid Shutdown ────────────────────────────────────────────────────────
  if (input.rapidShutdownIntegrated) {
    const rY = SCH_Y+SCH_H-22;
    parts.push(rect(SCH_X+5, rY-10, 240, 16, {fill:WHT, stroke:BLK, sw:SW_THIN}));
    parts.push(txt(SCH_X+10, rY, 'RAPID SHUTDOWN — NEC 690.12 COMPLIANT', {sz:F.tiny, bold:true}));
  }

  // ── LEGEND ────────────────────────────────────────────────────────────────
  // Legend expanded with battery/generator/ATS entries
  // §8 (BAR closeout 2026-07-25) — the OPEN-AIR legend entry derives from the
  // wiring-method ACTUALLY drawn on this sheet, not a hardcoded literal. A micro
  // sheet's open-air section is the listed Q-Cable assembly (SEGMENT 1), so the
  // legend names it; the generic 'PV Wire/THWN-2' label is used ONLY when a real
  // open-air PV-wire method exists (a string/optimizer DC run). Gate 11: legend
  // entries == displayed segment wiring methods.
  const _openAirLabel = isMicro
    ? `Open Air — ${input.openAirBranchWiringLabel ?? 'AC Trunk Cable (TC-ER)'} AC Branch (NEC 690.31(C))`
    : 'Open Air — PV Wire/THWN-2 (NEC 690.31)';
  // Post-AAC E-1 repair — long DATA-DRIVEN labels (the listed open-air wiring
  // method) overflowed the fixed 188px legend box and ran past the embedded
  // viewBox crop, where the clip harness now (correctly) fails them as cropped
  // drawing content. Long labels WRAP onto continuation lines inside the box.
  const legEntries: {dash: string; stroke: string; label: string}[] = [
    {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
    {dash:'10,5',stroke:GRN,       label:_openAirLabel},
    {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
    // §8 closeout — the DC-conductor-in-conduit legend entry renders ONLY when a
    // canonical DC-in-conduit segment exists. A pure 1:1 micro job has no field
    // DC conductor (module→micro is the factory MC4 lead, open-air) — the entry
    // is suppressed so the legend never advertises string materials it lacks.
    ...(!isMicro ? [{dash:'4,2', stroke:BLK, label:'DC Conductor in Conduit (USE-2/PV Wire)'}] : []),
    ...(input.hasBattery ? [{dash:'6,3', stroke:'#1565C0', label:'Battery AC-Coupled Connection'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#2E7D32', label:'Generator Output Conductor'}] : []),
    ...((input.generatorKw ?? 0) > 0 ? [{dash:'', stroke:'#E65100', label:'ATS Transfer Conductor'}] : []),
    // Only when the CT leads are actually drawn (gate 11: legend == drawn) —
    // and in the form they are drawn: a real lead, or the "CT" bubbles (which
    // exist only outside drawn-lead mode).
    ...ctLeadLegendEntries(_anyLeadDrawn, !!input.meteringDrawing?.lead && !_drawnLeads),
  ];
  const legRows = legEntries.flatMap(e =>
    wrapLegendLabel(e.label, 40, Math.max(F.tiny, MIN_TYPE_UU)).map((text, i) => ({ dash: e.dash, stroke: e.stroke, text, cont: i > 0 })));
  const legH = 16 + legRows.length * LEG_ROW_H;
  // Inside the sheet frame as well as the schematic box: cropped for E-1, the
  // frame closes 20 uu inside the schematic's right edge, and the legend's
  // longest entry ran across it.
  const legX = SCH_X+schW-(LEG_W+7), legY = SCH_Y+SCH_H - legH - 4;
  parts.push(rect(legX, legY, LEG_W, legH, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(legX+4, legY+10, 'LEGEND', {sz:F.sub, bold:true}));
  parts.push(ln(legX, legY+13, legX+LEG_W, legY+13, {sw:SW_THIN}));
  legRows.forEach((item,i) => {
    const ly = legY+19+i*LEG_ROW_H;
    if (!item.cont) parts.push(ln(legX+4, ly, legX+38, ly, {stroke:item.stroke, sw:SW_MED, dash:item.dash||undefined}));
    parts.push(txt(legX+LEG_TEXT_X, ly+3, item.text, {sz:F.tiny}));
  });

  // ── CALCULATION PANELS ────────────────────────────────────────────────────
  // E-1 / E-1.1 split: E-1 is the one-line TOPOLOGY; the panels render on E-1.1.
  } // end !schedulesOnly — the one-line topology
  if (!input.suppressCalcBand) {
  const cW = Math.floor(DW/3) - 4;

  // Panel 1
  // -- E-1.1 STACKED MODE ---------------------------------------------------
  // Side by side, the three panels span the full 1994 uu canvas width, and WIDTH
  // is what binds the embed scale (k = 1402.88 / 1994 = 0.7036), so every glyph
  // printed at 4.57 pt no matter how much vertical space was free. Stacked, each
  // panel is one full-width band on a canvas sized to the sheet's own drawing
  // box, so k reaches ~1.0 and the same 8.67 uu type prints at ~6.5 pt with no
  // change to a single value.
  const _cbStack = !!input.calcBandStacked;
  // 1340 uu inside a 1420 uu canvas. Chosen so the planset's 1402.88 uu drawing
  // box scales it at k = 0.988 instead of 0.7036 -- the SAME 8.67 uu type then
  // prints at 6.4 pt rather than 4.57, with no value and no row changed.
  //
  // Stacked (E-1.1), the three tables sit in TWO columns — AC BRANCH CIRCUIT
  // INFO (or DC SYSTEM CALCULATIONS) over AC SYSTEM CALCULATIONS on the left,
  // the EQUIPMENT SCHEDULE on the right — each content-high, every row at ONE
  // pitch. Each spanning the full 1340 uu, a value sat ~1300 uu from its label
  // ('Topology ………… MICROINVERTER' across the whole sheet) and the eye lost the
  // row; the equipment schedule was pitched at 11.8 uu under tables at 22.
  const _stackGap = 18;
  const _colW = Math.floor((STACK_W - 2 * MAR - _stackGap) / 2);
  const PCW = _cbStack ? _colW : Math.floor(DW / 3) - 4;
  /** Header-bar height. The row baseline is measured from BELOW it. */
  const PBH = 14;
  /** Row-height cap. The side-by-side band is 180 uu tall, so 12-13 uu is right;
   *  stacked, every table uses the same 22 uu pitch (see _stackRh). */
  const PRH_MAX = _cbStack ? 22 : 13;
  /** Row type, scaled with the row box so the band reads as a drafted table
   *  rather than small text floating in white space. */
  const PFS = _cbStack ? 11 : F.tiny;
  const PFH = _cbStack ? 12 : F.hdr;
  const PX1 = DX;
  const PY1 = _cbStack ? DY + 6 : CALC_Y;
  // Each table's frame is filled in once its rows are known (the stacked
  // tables are as tall as their rows): a slot now, so the frame still paints
  // UNDER its text.
  const _frame1 = parts.push('') - 1;
  let PCH1 = CALC_H;

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
    // P1-2: input.microBranches carries the conductor authority's branch OCPDs
    // (adapter); the recompute is a degraded-payload fallback on the SAME
    // 20 A-floor manufacturer-basis law (Ray D-1 2026-07-20 — no 30 A branch
    // allowance; over-limit branches are a snapshot-validator failure).
    const _baCont = _maxBrDev * _perMicroBrA * 1.25;
    const baShow = ba || (_baCont <= 20 ? 20 : (necNextStandardOcpd(_baCont) || 20));
    // Mixed-plan display: a plane-contained 12-micro branch runs 25A/#10 while
    // its siblings run 20A/#12 — the rows must show the plan's real spread,
    // not the 20A-branch model cap (which the 12-branch legitimately exceeds
    // under the larger-OCPD single-branch-per-plane rule).
    const _brOcpds = (input.microBranches?.map(b => b.ocpdAmps) ?? []).filter(n => n > 0);
    const _brOcpdShow = _brOcpds.length && Math.min(..._brOcpds) !== Math.max(..._brOcpds)
      ? `${Math.min(..._brOcpds)}–${Math.max(..._brOcpds)} A`
      : `${baShow} A`;
    const _brGaugeSet = [...new Set((input.microBranches ?? [])
      .map(b => b.conductorCallout?.match(/#\d+(?:\/0)?/)?.[0])
      .filter((g): g is string => !!g))];
    const _brWireShow = _brGaugeSet.length
      ? `${_brGaugeSet.join('/')} AWG`
      : `${branchRun?.wireGauge ?? input.branchWireGauge ?? '#10 AWG'}`;
    parts.push(txt(PX1+PCW/2, PY1+10, 'AC BRANCH CIRCUIT INFO', {sz:PFH, bold:true, anc:'middle', fill:WHT}));
    const rows: [string,string][] = [
      ['Topology','MICROINVERTER'],
      ['Microinverters',`${md} units`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['AC per Micro',`${((input.acOutputKw*1000)/md).toFixed(0)} W`],
      ['Branch Circuits',`${ab}`],
      ['Max Micros/Branch',`${_maxBrDev} (NEC 690.8)`],
      ['Branch OCPD',_brOcpdShow],
      ['Branch Wire',_brWireShow],
      ['Feeder Wire',`${resolvedAcWire}`],
      ['Feeder Conduit',`${resolvedAcConduit} ${resolvedAcCondType}`],
      ['Module Voc',`${input.panelVoc} V`],
      ['Module Isc',`${input.panelIsc} A`],
    ];
    const rh = _cbStack ? PRH_MAX : Math.min(PRH_MAX, (CALC_H-17)/rows.length);
    PCH1 = _cbStack ? PBH + rows.length * rh + 6 : CALC_H;
    rows.forEach(([l,v],i) => {
      const ry = PY1+PBH+rh*0.74+i*rh;
      if (i%2===1) parts.push(rect(PX1, ry-rh+2, PCW, rh, {fill:LGY, stroke:'none', sw:0}));
      parts.push(txt(PX1+4, ry, l, {sz:PFS}));
      parts.push(txt(PX1+PCW-4, ry, v, {sz:PFS, anc:'end', bold:true}));
    });
  } else {
    const pps = input.panelsPerString ?? Math.round(input.totalModules/Math.max(input.totalStrings,1));
    const lsp = input.lastStringPanels ?? pps;
    // NEC 690.7(A) provenance. `vocCorrected` and `designTempMin` are RESULTS of
    // a cold-temperature correction the caller either performed or did not.
    // The retired fallbacks (`?? input.panelVoc`, `?? -10`) printed the
    // UNCORRECTED STC voltage under a row labelled "Voc Corrected" and invented
    // a design temperature that nothing had used — a false NEC 690.7 statement
    // on an AHJ-facing sheet, wrong in the UNSAFE direction (a corrected Voc is
    // always HIGHER than STC, so the STC stand-in understates the real figure
    // and can hide a string that exceeds the inverter's max DC voltage).
    // Absent now means the sheet SAYS it is absent.
    const NOT_COMPUTED = '— NOT COMPUTED';
    const vc  = input.vocCorrected;
    // A string total is real only if it was supplied, or if it derives from a
    // REAL corrected module voltage — never from an STC stand-in.
    const sv  = input.stringVoc ?? (vc != null ? vc * pps : undefined);
    const si  = input.stringIsc ?? input.panelIsc;
    const op  = input.ocpdPerString ?? input.dcOCPD;
    const dt  = input.designTempMin;
    const dar = input.dcAcRatio ?? calcDcAcRatio(dcKw, input.acOutputKw);
    parts.push(txt(PX1+PCW/2, PY1+10, 'DC SYSTEM CALCULATIONS', {sz:PFH, bold:true, anc:'middle', fill:WHT}));
    const rows: [string,string][] = [
      ['Module Voc (STC)',`${input.panelVoc} V`],
      ['Module Isc (STC)',`${input.panelIsc} A`],
      ['Design Temp (NEC 690.7)', dt != null ? `${dt}°C`            : NOT_COMPUTED],
      ['Voc Corrected',           vc != null ? `${vc.toFixed(2)} V` : NOT_COMPUTED],
      ['Panels per String', pps===lsp?`${pps}`:`${pps} (last: ${lsp})`],
      ['Number of Strings',`${input.totalStrings}`],
      ['String Voc (corrected)',  sv != null ? `${sv.toFixed(1)} V`        : NOT_COMPUTED],
      ['String Voc × 1.25',       sv != null ? `${(sv*1.25).toFixed(1)} V` : NOT_COMPUTED],
      ['String Isc × 1.25',`${(si*1.25).toFixed(2)} A`],
      ['DC OCPD / String',`${op} A`],
      ['DC Wire Gauge',`${resolvedDcWire}`],
      ['Total DC Power',`${dcKw.toFixed(2)} kW`],
      ['DC/AC Ratio',`${dar.toFixed(2)}`],
    ];
    const rh = _cbStack ? PRH_MAX : Math.min(PRH_MAX, (CALC_H-17)/rows.length);
    PCH1 = _cbStack ? PBH + rows.length * rh + 6 : CALC_H;
    rows.forEach(([l,v],i) => {
      const ry = PY1+PBH+rh*0.74+i*rh;
      if (i%2===1) parts.push(rect(PX1, ry-rh+2, PCW, rh, {fill:LGY, stroke:'none', sw:0}));
      parts.push(txt(PX1+4, ry, l, {sz:PFS}));
      parts.push(txt(PX1+PCW-4, ry, v, {sz:PFS, anc:'end', bold:true}));
    });
  }

  parts[_frame1] = rect(PX1, PY1, PCW, PCH1, {fill:WHT, stroke:BLK, sw:SW_THIN})
    + '\n' + rect(PX1, PY1, PCW, 14, {fill:BLK, sw:0});

  // Panel 2: AC calcs — under panel 1 when stacked.
  const PX2 = _cbStack ? DX : DX + PCW + 4;
  const PY2 = _cbStack ? PY1 + PCH1 + _stackGap : CALC_Y;
  const _frame2 = parts.push('') - 1;
  parts.push(txt(PX2+PCW/2, PY2+10, 'AC SYSTEM CALCULATIONS', {sz:PFH, bold:true, anc:'middle', fill:WHT}));
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
      const _120pass = input.poiRulePasses ?? (_busLimit >= input.mainPanelAmps + _totalBfA);
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
      ['120% Rule',`${(input.poiRulePasses ?? ((input.panelBusRating ?? input.mainPanelAmps)*1.2 >= input.mainPanelAmps+input.backfeedAmps)) ? 'PASS ✓':'FAIL ✗'}`] as [string,string],
    ]),
  ];
  const acRh = _cbStack ? PRH_MAX : Math.min(PRH_MAX, (CALC_H-17)/acRows.length);
  const PCH2 = _cbStack ? PBH + acRows.length * acRh + 6 : CALC_H;
  parts[_frame2] = rect(PX2, PY2, PCW, PCH2, {fill:WHT, stroke:BLK, sw:SW_THIN})
    + '\n' + rect(PX2, PY2, PCW, 14, {fill:BLK, sw:0});
  acRows.forEach(([l,v],i) => {
    const ry = PY2+PBH+acRh*0.74+i*acRh;
    if (i%2===1) parts.push(rect(PX2, ry-acRh+2, PCW, acRh, {fill:LGY, stroke:'none', sw:0}));
    parts.push(txt(PX2+4, ry, l, {sz:PFS}));
    const isPF = v.includes('✓')||v.includes('✗');
    const vc2 = isPF ? (v.includes('✓')?PASS:FAIL) : BLK;
    parts.push(txt(PX2+PCW-4, ry, v, {sz:PFS, anc:'end', bold:true, fill:vc2}));
  });

  // Panel 3: Equipment schedule
  //
  // 🚨 `hasProductionMeter` IS READ HERE, AND UNTIL NOW IT WAS READ NOWHERE.
  // Both rows are conditional, so a design that answers neither question renders
  // exactly as it always has — the flag adds a statement, it never removes one.
  const meteringRows = (i: SLDProfessionalInput): [string, string][] => [
    ...(i.hasProductionMeter ? [['Production Meter', 'REVENUE-GRADE — NEC 690.4'] as [string, string]] : []),
    ...(i.meteringChannels ? [['Metering', esc(i.meteringChannels)] as [string, string]] : []),
    ...consumptionCtScheduleRows(i.meteringDrawing),
  ];
  // The right-hand column when stacked, level with panel 1.
  const PX3 = _cbStack ? DX + _colW + _stackGap : DX + (PCW + 4) * 2;
  const PY3 = _cbStack ? PY1 : CALC_Y;
  const _frame3 = parts.push('') - 1;
  parts.push(txt(PX3+PCW/2, PY3+10, 'EQUIPMENT SCHEDULE', {sz:PFH, bold:true, anc:'middle', fill:WHT}));
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
    // 🚨 THE SCHEDULE ROW A PERMIT READER TAKES AS THE ANSWER. The fallback
    // string 'IQ Combiner' and a recorded installer selection used to print
    // identically; combinerScheduleCell appends '⚠ NOT SELECTED' when the
    // adapter says the device was derived rather than chosen.
    ['AC Combiner',combinerScheduleCell(esc(input.combinerLabel??'IQ Combiner'), input.combinerSelectionIsDecided)],
    // A standalone gateway is its own piece of equipment on the diagram, so it
    // is its own row here — the schedule lists what the drawing draws.
    ...(input.standaloneGateway ? [['Monitoring Gateway',
      monitoringGatewayScheduleCell(input.standaloneGateway)] as [string,string]] : []),
    ['AC Disconnect',`${resolvedAcOCPD}A ${isSupplySide ? 'Fused (Tap OCPD)' : 'Non-Fused'}`],
    ['Main Panel',`${input.mainPanelAmps} A`],
    ['Utility',esc(input.utilityName)],
    ['Interconnection',esc(input.interconnection)],
    ['Rapid Shutdown',input.rapidShutdownIntegrated?'INTEGRATED':'EXTERNAL'],
    ...meteringRows(input),
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery ? [['Battery Capacity', batteryCapacityCell(input.batteryKwh, input.batteryKwhLabel)] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A — NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ] : [
    ['PV Module',esc(input.panelModel)],
    ['Module Wattage',`${input.panelWatts} W`],
    ['Total Modules',`${input.totalModules}`],
    ['Strings',`${input.totalStrings} × ${pp2} panels`],
    ['MPPT Channels',input.mpptAllocation??`${input.mpptChannels??1} ch`],
    // NOT qualified, deliberately: on a string system this cell is 'Direct' /
    // a DC combiner box, not the brand BOS combiner `combinerSelectionIsDecided`
    // describes. 'Direct' is a resolved answer — there is no device — and
    // stamping '⚠ NOT SELECTED' on it would invent a missing decision.
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
    ...meteringRows(input),
    ['Battery Storage',input.hasBattery?esc(input.batteryModel):'NONE'],
    ...(input.hasBattery ? [['Battery Capacity', batteryCapacityCell(input.batteryKwh, input.batteryKwhLabel)] as [string,string]] : []),
    ...(input.batteryBackfeedA ? [['Batt. Backfeed',`${input.batteryBackfeedA}A — NEC 705.12(B)`] as [string,string]] : []),
    ...((input.generatorKw ?? 0) > 0 ? [['Generator',`${input.generatorBrand??''} ${input.generatorKw}kW`] as [string,string]] : []),
    ...(input.atsAmpRating ? [['ATS',`${input.atsBrand??''} ${input.atsAmpRating}A`] as [string,string]] : []),
  ];
  const eqRh = _cbStack ? PRH_MAX : Math.min(PRH_MAX, (CALC_H-17)/eqRows.length);
  const PCH3 = _cbStack ? PBH + eqRows.length * eqRh + 6 : CALC_H;
  parts[_frame3] = rect(PX3, PY3, PCW, PCH3, {fill:WHT, stroke:BLK, sw:SW_THIN})
    + '\n' + rect(PX3, PY3, PCW, 14, {fill:BLK, sw:0});
  eqRows.forEach(([l,v],i) => {
    const ry = PY3+PBH+eqRh*0.74+i*eqRh;
    if (i%2===1) parts.push(rect(PX3, ry-eqRh+2, PCW, eqRh, {fill:LGY, stroke:'none', sw:0}));
    parts.push(txt(PX3+4, ry, l, {sz:PFS}));
    parts.push(txt(PX3+PCW-4, ry, v, {sz:PFS, anc:'end', bold:true}));
  });

  } // end !suppressCalcBand — the three calculation panels

  // ── CONDUIT & CONDUCTOR SCHEDULE ──────────────────────────────────────────
  // Suppressed in embedded planset mode — the canonical physical section
  // schedule renders ONCE, as the PV-4B.1 HTML schedule (same objects, one
  // derivation). See suppressScheduleBand on the input type.
  if (!input.suppressScheduleBand) {
  parts.push(rect(DX, SCHED_Y, DW, SCHED_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(rect(DX, SCHED_Y, DW, 14, {fill:BLK, sw:0}));
  parts.push(txt(DX+6, SCHED_Y+10, 'CONDUIT & CONDUCTOR SCHEDULE — NEC 310 / NEC CHAPTER 9 TABLE 1', {sz:F.hdr, bold:true, fill:WHT}));

  // The fractions must sum to 1. They summed to 1.04, so the PASS column
  // started 20 uu short of the frame and every '✓ PASS' printed under the
  // title block (painted over it, on every sheet). CONDUCTORS gives up the
  // excess: its longest cell — a 4-conductor bundle, 355 uu — still fits 469.
  const sCols = [
    {label:'RUN ID',w:0.07},{label:'FROM',w:0.11},{label:'TO',w:0.11},
    {label:'CONDUCTORS',w:0.24},{label:'CONDUIT',w:0.10},{label:'FILL %',w:0.06},
    {label:'AMPACITY',w:0.07},{label:'OCPD',w:0.06},{label:'V-DROP %',w:0.07},
    {label:'LENGTH',w:0.06},{label:'PASS',w:0.05},
  ];
  const hY = SCHED_Y+24;
  const rH = 13;
  // Cells start 5 uu inside their column rule, as the equipment and calc tables
  // do. At 3 the ink began ~2.75 uu from the rule and printed glued to it
  // ('|13.29A').
  const CELL_INSET = 5;
  let cx2 = DX;
  sCols.forEach(col => {
    const cw2 = col.w*DW;
    parts.push(txt(cx2+CELL_INSET, hY, col.label, {sz:F.tiny, bold:true}));
    parts.push(ln(cx2, SCHED_Y+14, cx2, SCHED_Y+SCHED_H, {sw:SW_HAIR}));
    cx2 += cw2;
  });
  // Under the headers with daylight: at hY+2 the rule touched their baselines.
  parts.push(ln(DX, hY+4.5, DX+DW, hY+4.5, {sw:SW_THIN}));

  type SR = {id:string;from:string;to:string;conductors:string;conduit:string;fill:number;amp:number;ocpd:number;vdrop:number;len:number;pass:boolean};
  let sRows: SR[] = [];

  if (input.runs && input.runs.length > 0) {
    // MSP_TO_UTILITY_RUN is utility-owned service equipment. ROOF_RUN on a MICRO
    // system is the module→microinverter connection — the module's factory leads
    // / MC4 connectors, not installer-run conductor — so listing it in a
    // conductor schedule tells the installer to pull a DC circuit that does not
    // exist on an all-AC roof. bom-engine-v4 excludes it from micro materials
    // for exactly this reason (MICRO_FACTORY_LEAD_IDS); the schedule now agrees.
    // On a string/optimizer system ROOF_RUN is not emitted at all, so this is
    // scoped to isMicro and cannot hide a genuine DC string segment.
    const _scheduleExcluded = new Set(
      isMicro ? ['MSP_TO_UTILITY_RUN', 'ROOF_RUN'] : ['MSP_TO_UTILITY_RUN']);
    sRows = input.runs.filter(r=>!_scheduleExcluded.has(r.id)).map(r => {
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
    const _feederConduit = `${resolvedAcCondType} ${resolvedAcConduit}`;
    // §4 (07-22): a microinverter system has N parallel AC BRANCH CIRCUITS (each
    // ≤20A OCPD, its own conductor), NOT one collapsed BR-1 carrying the feeder's
    // #6/45A/60A. Render every real branch from the canonical branch plan
    // (input.microBranches). Their AC output is on the open-air Q-Cable trunk;
    // the shared feeder (combiner→disco→MSP) carries the aggregated current.
    const _branchRows: SR[] = (input.microBranches && input.microBranches.length > 0)
      ? input.microBranches.map(b => ({
          id: `BR-${b.branchIndex}`,
          from: `${b.deviceCount}× MICRO`, to: 'AC COMBINER',
          conductors: b.conductorCallout ?? `${input.branchWireGauge ?? '#10 AWG'} THWN-2 + 1×#${branchEgcNum} GRN`,
          conduit: 'OPEN AIR',
          fill: 0,
          amp: Math.round((b.branchCurrentA * 1.25) * 10) / 10,
          ocpd: b.ocpdAmps,
          vdrop: 0, len: 0, pass: true,
        }))
      : [{ id: 'BR-1', from: 'AC BRANCHES', to: 'AC COMBINER',
          conductors: `${input.branchWireGauge ?? '#10 AWG'} THWN-2 + 1×#${branchEgcNum} GRN`,
          conduit: 'OPEN AIR', fill: 0,
          amp: input.branchOcpdAmps ? Math.round(input.branchOcpdAmps * 0.8 * 10) / 10 : 0,
          ocpd: input.branchOcpdAmps ?? 20, vdrop: 0, len: 0, pass: true }];
    // §3/§4 — the SHARED jbox→combiner home-run raceway as its OWN row (all
    // branches bundled in one conduit). Distinct from the open-air Q-Cable
    // branch rows above — never one merged multi-method branch string.
    const _homerunRow: SR[] = input.homerunConduitType ? [{
      id: 'BR-HR', from: 'ROOF J-BOX', to: 'AC COMBINER',
      // L1 + L2 per branch circuit in the shared raceway (the wire callout on
      // the drawing reads the same total, e.g. 6×#10 for 3 circuits).
      conductors: `${2 * (input.homerunSharedCircuits ?? 1)}×${input.branchWireGauge ?? '#10 AWG'} THWN-2 (${input.homerunSharedCircuits ?? 1} ckt) + 1×#${homerunEgcNum} GRN`,
      conduit: `${input.homerunConduitType}${input.homerunConduitSize ? ' ' + input.homerunConduitSize : ''}`,
      fill: 0, amp: 0, ocpd: input.branchOcpdAmps ?? 20, vdrop: 0, len: 0, pass: true,
    }] : [];
    // Installed phase + neutral count on the micro feeder (L1, L2, N): from
    // the engine's conductor set, else the neutral rule above. The schedule
    // must say the same "3×" the wire callout says.
    const _feederInstalledN = acFeederRun?.conductorBundle?.length
      ? acFeederRun.conductorBundle.filter((c: ConductorBundle) => !isGroundingConductor(c)).reduce((n: number, c: ConductorBundle) => n + c.qty, 0)
      : _acConductorCount;
    sRows = isMicro ? [
      ..._branchRows,
      ..._homerunRow,
      {id:'A-1',from:'AC COMBINER',to:'AC DISCO',conductors:`${_feederInstalledN}×${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:_feederConduit,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:0,len:0,pass:_fPass},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${_acConductorCount}×${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:_feederConduit,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:_fVd,len:_fLen,pass:_fPass},
    ] : [
      {id:'D-1',from:'PV ARRAY',to:'ROOF J-BOX',conductors:`${resolvedDcWire} USE-2 + 1×#${egcNum} GRN`,conduit:'OPEN AIR',fill:0,amp:0,ocpd:input.dcOCPD,vdrop:0,len:0,pass:true},
      {id:'D-2',from:'ROOF J-BOX',to:'DC DISCO',conductors:`${resolvedDcWire} USE-2 + 1×#${egcNum} GRN`,conduit:`${input.dcConduitType??'EMT'} 3/4"`,fill:0,amp:0,ocpd:input.dcOCPD,vdrop:0,len:0,pass:true},
      {id:'A-1',from:'INVERTER',to:'AC DISCO',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:0,len:0,pass:_fPass},
      {id:'A-2',from:'AC DISCO',to:'MSP',conductors:`${resolvedAcWire} THWN-2 + 1×#${egcNum} GRN`,conduit:`${resolvedAcCondType} ${resolvedAcConduit}`,fill:_fFill,amp:input.acOutputAmps,ocpd:resolvedAcOCPD,vdrop:_fVd,len:_fLen,pass:_fPass},
    ];
  }

  // 🚨 NO ROW HERE FOR A STANDALONE GATEWAY'S SUPPLY CIRCUIT. This band is
  // the SLD PDF's conductor schedule; the permit package suppresses it and
  // prints PV-4B.1, built from engine runs — and no engine run carries the
  // gateway circuit. A GW-1 row here alone made the SLD PDF list a conductor
  // the permit schedule does not (output consistency). The circuit is still
  // stated wherever it is drawn: the '15A 2P — GATEWAY SUPPLY' callout with
  // its conductor, the Monitoring Gateway equipment row, and the BOM. If it is
  // ever scheduled, it goes into BOTH lists from one source, together.

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
      parts.push(txt(cx3+CELL_INSET, ry, String(vals[ci]??''), {sz:F.tiny, fill:ci===10?pc:BLK, bold:ci===10}));
      cx3 += cw3;
    });
  });
  } // end !suppressScheduleBand

  // ── TITLE BLOCK ───────────────────────────────────────────────────────────
  // Build badge stays even in embedded mode — invisible deployment telemetry.
  parts.push(`<!-- ${getBuildBadge()} | SLD SYMBOLS V2 -->`);
  if (input.suppressTitleBlock) {
    parts.push('</svg>');
    // Floor applied to the FINISHED document — see applyTypeFloor. Doing it here
    // rather than at each emitter is what makes it total: it also catches the
    // ~51 hardcoded `sz:` literals and the symbol/illustration sub-modules.
    return applyTypeFloor(parts.join('\n'));
  }
  parts.push(titleBlockSvg(input, dcKw));

  parts.push('</svg>');
  return applyTypeFloor(parts.join('\n'));
}

// ── TITLE BLOCK (shared by the legacy single-source path and the Wave-5
//    multi-lane path — extracted verbatim, output joined with '\n' so the
//    legacy byte stream is unchanged) ─────────────────────────────────────────
function titleBlockSvg(input: SLDProfessionalInput, dcKw: number): string {
  const parts: string[] = [];
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

  // Engineer seal. The ring is the stamp's place and stays empty; its caption
  // sits beside it. 'ENGINEER' (45 uu at the printed floor) inside a 36 uu ring
  // ran through it, and the designer line under it crossed its bottom.
  const sealY = tbY+tbH-50;
  parts.push(rect(tbX, sealY, TB_W, 50, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(circ(tbX+30, sealY+25, 19, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(tbX+58, sealY+21, 'ENGINEER SEAL', {sz:F.tiny, fill:'#888'}));
  parts.push(txt(tbX+58, sealY+34, `${esc(input.designer)} — ${esc(input.drawingDate)}`, {sz:F.tiny, fill:'#555'}));

  return parts.join('\n');
}
// ═════════════════════════════════════════════════════════════════════════════
// Wave 5 Lane A — HYBRID MULTI-LANE RENDERER
// docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 5 / §1.7 / I-6 / I-8.
//
// One horizontal source lane per subsystem (fixed roof > ground > fence
// order), each drawn with ITS OWN topology symbol chain:
//   MICRO:     PV ARRAY → AC COMBINER (branch breakers) → lane AC DISCO
//   STRING:    PV ARRAY → DC DISCO → INVERTER → lane AC DISCO
//   OPTIMIZER: PV ARRAY (optimizer callout) → INVERTER (integrated DC
//              disco) → lane AC DISCO
// All lanes join a single vertical POI bus; ONE shared service tail
// (MSP → [BUI/battery] → utility meter → grid) — exactly one 120% panel,
// computed from the SUMMED per-inverter backfeed (input.backfeedAmps, which
// the adapters source from the §1.7 aggregator — never one combined rounded
// breaker). The whole schematic is fit-scaled into the drawing box (k<1
// allowed — three lanes must shrink to fit, unlike the legacy grow-only fit).
//
// v1 non-goals (documented on the sheet): generator/ATS glyphs are not drawn
// on the multi-lane path (a NOTE is printed when generatorKw>0); per-lane
// interconnection methods are not supported (one POI method for the sheet).
// ═════════════════════════════════════════════════════════════════════════════

const LANE_TAG: Record<string, string> = { roof: 'R', ground: 'G', fence: 'F' };
const LANE_RANK: Record<string, number> = { roof: 0, ground: 1, fence: 2 };

/** Validate + dedupe + order source branches (roof > ground > fence). */
export function normalizeSourceBranches(raw: SLDSourceBranch[] | undefined | null): SLDSourceBranch[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SLDSourceBranch[] = [];
  for (const b of raw) {
    const key = (b as any)?.key;
    if (key !== 'roof' && key !== 'ground' && key !== 'fence') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  out.sort((a, b) => LANE_RANK[a.key] - LANE_RANK[b.key]);
  return out;
}

/** Lane topology from branch.topologyType (adapter-normalized). */
function laneTopology(b: SLDSourceBranch): 'MICRO' | 'OPTIMIZER' | 'STRING' {
  const t = String(b.topologyType ?? '').toUpperCase();
  if (t.includes('MICRO')) return 'MICRO';
  if (t.includes('OPTIMIZER')) return 'OPTIMIZER';
  return 'STRING';
}

/** A lane's backfeed OCPD (A) — the single basis the AC-collection uses to size
 *  the shared panel busbar + system disconnect.
 *  P1-2 ruling: the ADAPTER-CARRIED authority values (backfeedAmps / acOCPD
 *  from buildConductorAuthority) are the source; the necNextStandardOcpd tail
 *  is a degraded-payload fallback ONLY (client `sources` posts that lack the
 *  authority fields) and uses the one canonical NEC 240.6 ladder. */
function laneBackfeedA(b: SLDSourceBranch): number {
  return b.backfeedAmps ?? b.acOCPD ?? necNextStandardOcpd((b.acOutputAmps ?? 0) * 1.25) ?? 0;
}

/**
 * Wave 6 — SINGLE SOURCE for the hybrid AC-collection architecture: per-source
 * brand combiner/OCPD → ONE shared AC combiner panel → ONE system disconnect.
 * E-1 (renderSLDMultiLane) DRAWS this; the permit BOM / SCHED helper reads the
 * SAME function (via sldAdapter.buildHybridAcCollection) so the sheets can never
 * disagree with the diagram about the shared panel, its busbar rating, or the
 * single disconnect. Map lanes → HybridSourceInput here and nowhere else.
 */
/**
 * Which recorded selection, if any, applies to THIS lane.
 *
 * 🚨 THE SELECTION USED TO BE STAMPED ONTO EVERY MICRO LANE REGARDLESS OF BRAND.
 * `selectedCombinerId` is ONE project-level answer; a hybrid job has one lane per
 * array, and they need not share an inverter brand. An Enphase roof + an
 * APsystems fence meant the fence lane's combiner was resolved from the Enphase
 * id — and `resolveIntegratedEquipment` honours a selection BEFORE it checks the
 * ecosystem, so it came back with the Enphase device and the sheet labelled the
 * APsystems fence lane "Enphase IQ Combiner 5C". That is a box that is not on
 * that wall, on a drawing that goes to a permit office and a BOM.
 *
 * The rule, in order:
 *   1. the lane's OWN recorded selection (per-subsystem equipment) — the answer
 *      for this array, and the only one that can be right for every lane;
 *   2. the project-level selection, but ONLY when the selected device's brand is
 *      the lane's inverter brand. A lane that is not that brand has no answer,
 *      and says so rather than borrowing another lane's;
 *   3. nothing — the lane falls to its own declared pairing, and where that is
 *      absent too its basis is `unresolved-default` and the drawing qualifies it.
 *
 * An UNRESOLVABLE selected id has no brand to compare, so it is passed through
 * rather than dropped: `resolveIntegratedEquipment` renders it as a visible
 * empty plan ("selected device unavailable"), which is what the single-lane
 * sheet already does. Silently withholding it would be the one outcome worse
 * than the defect — a broken selection that nobody can see.
 */
function laneSelectedCombinerId(
  lane: SLDSourceBranch,
  projectSelectedId: string | null | undefined,
  perLane: Record<string, string | null | undefined> | null | undefined,
): string | null {
  const own = String(perLane?.[lane.key] ?? '').trim();
  if (own) return own;
  const sel = String(projectSelectedId ?? '').trim();
  if (!sel) return null;
  const device = getBosDevice(sel);
  if (!device) return sel;                       // unresolvable — stays visible on every lane
  const laneBrand = String(lane.inverterManufacturer ?? '').trim().toLowerCase();
  const selBrand = String(device.brand ?? '').trim().toLowerCase();
  // An unknown lane brand cannot be shown to match, so it does not claim the
  // device either. "No answer for this lane" is a reportable state; a wrong
  // nameplate is not.
  return laneBrand && laneBrand === selBrand ? sel : null;
}

export function acCollectionFromLanes(
  lanes: SLDSourceBranch[],
  /** The project's recorded combiner selection, when the caller has one. It
   *  applies to the MICRO lanes (only they take a brand combiner) and outranks
   *  the per-lane pairing below — but ONLY on a lane of the same brand; see
   *  laneSelectedCombinerId. */
  selectedCombinerId?: string | null,
  /** Per-subsystem recorded selections, keyed by lane ('roof' | 'ground' |
   *  'fence') — `selected_equipment.subSystems[key]`. Highest authority for the
   *  lane it names, because it is an answer about THAT array. */
  selectedCombinerIdByLane?: Record<string, string | null | undefined> | null,
): HybridAcCollectionPlan {
  return resolveHybridAcCollection(lanes.map(b => ({
    key: b.key,
    inverterManufacturer: b.inverterManufacturer ?? '',
    inverterModel: b.inverterModel ?? '',
    isMicro: laneTopology(b) === 'MICRO',
    branchCount: b.microBranches?.length ?? b.totalStrings ?? 1,
    deviceCount: b.deviceCount ?? b.totalModules ?? 0,
    backfeedA: laneBackfeedA(b),
    // This is the one lanes -> HybridSourceInput mapping site, as the note above
    // says, so it is also the one place the combiner pairing can be attached for
    // hybrid lanes. Without it a lane fell back to the current-generation
    // default and could name a different combiner from the rest of the package.
    compatibleCombinerIds: combinerCompatibilityFor(b.inverterManufacturer, b.inverterModel),
    // ...and the same place the installer's ANSWER attaches. Compatibility says
    // what CAN be used; this says what IS being installed, and the resolver
    // ranks it above the line before it. Resolved PER LANE — one project-level
    // id is not automatically this lane's answer.
    selectedCombinerId: laneSelectedCombinerId(b, selectedCombinerId, selectedCombinerIdByLane),
  })));
}

// ─── Conductor tag system (reference-planset style) ──────────────────────────
// Every distinct conductor segment CLASS on the multi-lane E-1 carries a small
// hexagon tag on the drawing; the CONDUIT AND CONDUCTOR SCHEDULE table at the
// bottom of the sheet lists the SAME tag numbers. Tag rows read the values the
// diagram already prints (shared conductor authority via the lanes) — this
// block never re-derives gauges/OCPDs.

/** Namespaced engine run ids abbreviate to lane prefixes on the sheet. */
function prettyRunId(id: string): string {
  return id.replace(/^roof:/, 'R:').replace(/^ground:/, 'G:').replace(/^fence:/, 'F:');
}

/** One tagged conductor class → one schedule entry (+ its EGC row). */
interface CondTagRow {
  tag: string;
  desc: string;
  /** Engine RunSegment id backing this tag (R:/G:/F:-prefixed), when one exists. */
  runId?: string;
  gauge: string;        // e.g. '#8 AWG'
  insul: string;        // 'THWN-2' | 'PV WIRE' | ...
  nCond: string;        // e.g. '3(L1,L2,N)' / '8(4+,4−)'
  conduitType: string;  // 'EMT' | 'N/A — FREE AIR' | ...
  conduitSize: string;
  egc: string;          // EGC gauge for the paired ground row
  /** Voltage-drop inputs — currents/lengths as printed on the diagram. */
  currentA: number;
  baseVolts: number;    // 240 AC, string Voc for DC source circuits
  lenFt: number | null; // null ⇒ assumed length (marked on the sheet)
}

/** Pointy-top hexagon tag marker (rides the wire geometry, pre-scale space). */
function hexTag(cx: number, cy: number, label: string): string {
  const r = 11;
  const pts = Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 180) * (60 * k - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="${WHT}" stroke="${BLK}" stroke-width="1.3"/>`
    + txt(cx, cy + 2.6, label, { sz: 7.5, bold: true, anc: 'middle' });
}

/** Conservative EMT/PVC trade-size for N THWN-2 Cu conductors of one gauge —
 *  NEC Informative Annex C, Table C.1 basis, rounded DOWN in allowed count
 *  (⇒ rounded UP in conduit size). Display aid only; never sizes conductors. */
function conduitSizeForConductors(gauge: string, count: number): string {
  const g = gauge.replace('#', '').replace(/\s*AWG.*/i, '').trim();
  const table: Record<string, Array<[number, string]>> = {
    '12': [[9, '3/4"'], [16, '1"'], [26, '1-1/4"']],
    '10': [[5, '3/4"'], [10, '1"'], [18, '1-1/4"']],
    '8':  [[3, '3/4"'], [5, '1"'], [9, '1-1/4"']],
    '6':  [[2, '3/4"'], [4, '1"'], [6, '1-1/4"']],
    '4':  [[2, '1"'], [4, '1-1/4"'], [6, '1-1/2"']],
    '3':  [[2, '1"'], [3, '1-1/4"'], [5, '1-1/2"']],
    '2':  [[2, '1"'], [3, '1-1/4"'], [4, '1-1/2"']],
    '1':  [[1, '1"'], [3, '1-1/4"'], [4, '1-1/2"']],
    '1/0': [[1, '1"'], [2, '1-1/4"'], [3, '1-1/2"'], [5, '2"']],
    '2/0': [[1, '1-1/4"'], [3, '1-1/2"'], [4, '2"']],
    '3/0': [[1, '1-1/4"'], [2, '1-1/2"'], [4, '2"']],
    '4/0': [[1, '1-1/2"'], [3, '2"']],
  };
  const rows = table[g];
  if (!rows) return '—';
  for (const [max, size] of rows) if (count <= max) return size;
  return '2-1/2"';
}

/** DC resistance, ohms per 1000 ft — NEC Chapter 9 Table 8 (uncoated Cu,
 *  stranded, 75°C). Code-book constants (not project data). */
const R_OHMS_PER_KFT: Record<string, number> = {
  '14': 3.14, '12': 1.98, '10': 1.24, '8': 0.778, '6': 0.491, '4': 0.308,
  '3': 0.245, '2': 0.194, '1': 0.154, '1/0': 0.122, '2/0': 0.0967,
  '3/0': 0.0766, '4/0': 0.0608,
};
function rPerKft(gauge: string): number {
  const g = gauge.replace('#', '').replace(/\s*AWG.*/i, '').trim();
  return R_OHMS_PER_KFT[g] ?? 1.24;
}

/** Generic bottom-band table: black title bar, shaded column header, zebra
 *  rows, hairline column rules — the reference sheet's calc-table style. */
function bandTable(
  x: number, y: number, w: number, h: number, title: string,
  cols: Array<{ label: string; w: number; align?: 'start' | 'middle' | 'end' }>,
  rows: string[][],
  opts: { rowH?: number; foot?: string; cellSz?: number; headSz?: number } = {},
): string {
  const p: string[] = [];
  p.push(rect(x, y, w, h, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  p.push(rect(x, y, w, 16, { fill: BLK, sw: 0 }));
  p.push(txt(x + w / 2, y + 11.5, title, { sz: opts.headSz ?? F.hdr, bold: true, anc: 'middle', fill: WHT }));
  const headY = y + 16;
  p.push(rect(x, headY, w, 14, { fill: '#E8E8E8', stroke: 'none', sw: 0 }));
  // EVERY CELL HOLDS ITS TEXT. The column fractions were set by eye for type
  // that printed at 6.3–7 uu; at the printed floor (8.67 uu) the longest
  // descriptions ('COMBINED PV OUTPUT — AC PANEL / SYSTEM DISCONNECT TO POI',
  // 'ENERGY STORAGE — BATTERY TO BACKUP INTERFACE (AC-COUPLED)') ran past
  // their column rule into the gauge beside them. A column too narrow for its
  // widest cell (or its header) takes the width from columns with room to
  // spare, in proportion to their spare; a table whose columns all fit keeps
  // its fractions exactly.
  cols = fitColumns(cols, rows, w, opts.cellSz ?? 7);
  let cx = x;
  cols.forEach(c => {
    const cw = c.w * w;
    const tx = c.align === 'end' ? cx + cw - 4 : c.align === 'middle' ? cx + cw / 2 : cx + 4;
    p.push(txt(tx, headY + 10, c.label, { sz: 6.5, bold: true, anc: c.align ?? 'start' }));
    cx += cw;
  });
  p.push(ln(x, headY + 14, x + w, headY + 14, { sw: SW_THIN }));
  // The rows start 1.5 uu under the header rule, so a first row drawn at the
  // least pitch keeps its caps off that rule.
  const ROWS_TOP = headY + 14 + 1.5;
  const _rowsH = h - 16 - 14 - 1.5 - (opts.foot ? 12 : 0) - 4;
  // When the rows at their pitch do not fit, the pitch closes up — down to
  // LBL_PITCH, the least that keeps 8.67 uu type off the next row. (The table
  // used to slice the list at the rows that fit and say nothing, so a long
  // conduit schedule silently lost its tail.) Still too many at that pitch:
  // the last row that fits SAYS how many are not shown, across the table — a
  // table that stops short without a word reads as complete.
  const rh = Math.min(opts.rowH ?? 15, Math.max(LBL_PITCH, _rowsH / Math.max(rows.length, 1)));
  const availRows = Math.floor(_rowsH / rh + 1e-9);
  const cellSz = opts.cellSz ?? 7;
  const rowBaseline = (ri: number) =>
    +(ROWS_TOP + ri * rh + rh / 2 + (capUu(cellSz) - descUu(cellSz)) / 2).toFixed(2);
  let shown = rows;
  let fullRowTop = Infinity;
  if (rows.length > availRows) {
    const hidden = rows.length - availRows + 1;
    console.warn(`[SLD TABLE ROWS DROPPED] "${title}": ${hidden} of ${rows.length} rows do not fit`);
    shown = rows.slice(0, Math.max(0, availRows - 1));
    fullRowTop = ROWS_TOP + shown.length * rh;
    p.push(txt(x + 4, rowBaseline(shown.length), `… +${hidden} MORE ROW${hidden > 1 ? 'S' : ''} NOT SHOWN — TABLE FULL`,
      { sz: cellSz, bold: true, fill: FAIL }));
  }
  shown.forEach((r, ri) => {
    // The text is centred in its row band (the zebra stripe), on its ink —
    // in a tall row it used to sit on the stripe's bottom edge.
    const rowTop = ROWS_TOP + ri * rh;
    const ry = rowBaseline(ri);
    if (ri % 2 === 1) p.push(rect(x, rowTop, w, rh, { fill: LGY, stroke: 'none', sw: 0 }));
    let cx2 = x;
    cols.forEach((c, ci) => {
      const cw = c.w * w;
      const tx = c.align === 'end' ? cx2 + cw - 4 : c.align === 'middle' ? cx2 + cw / 2 : cx2 + 4;
      const v = r[ci] ?? '';
      const flag = v.includes('✓') ? { fill: PASS, bold: true } : v.includes('✗') ? { fill: FAIL, bold: true } : {};
      p.push(txt(tx, ry, v, { sz: cellSz, anc: c.align ?? 'start', ...flag }));
      cx2 += cw;
    });
  });
  // Column rules on top of zebra fills. They stop above the footnote: run to
  // the table's bottom edge, every rule struck through the footnote's line.
  // (and above a TABLE FULL row, which runs across the columns).
  const ruleBot = Math.min(opts.foot ? y + h - 4 - capUu(5.8) - 3.5 : y + h, fullRowTop);
  cx = x;
  cols.slice(0, -1).forEach(c => {
    cx += c.w * w;
    p.push(ln(cx, headY, cx, ruleBot, { sw: SW_HAIR, stroke: '#999' }));
  });
  if (opts.foot) p.push(txt(x + 4, y + h - 4, opts.foot, { sz: 5.8, italic: true, fill: '#444' }));
  return p.join('');
}

/** A band table's columns, widened where a cell (or the header) would not fit
 *  at the size that prints — see bandTable. Width comes from the columns with
 *  spare room, in proportion to their spare; the fractions are returned
 *  unchanged when every column already fits. */
function fitColumns<C extends { label: string; w: number; align?: 'start' | 'middle' | 'end' }>(
  cols: C[], rows: string[][], w: number, cellSz: number,
): C[] {
  const PAD = 4;                                    // the cell inset each side (bandTable draws at +4 / −4)
  const need = cols.map((c, ci) => Math.max(
    textWidthUu(c.label, 6.5, true),
    ...rows.map(r => {
      const v = r[ci] ?? '';
      return textWidthUu(v, cellSz, v.includes('✓') || v.includes('✗'));
    }),
  ) + 2 * PAD + 1);
  const have = cols.map(c => c.w * w);
  const short = have.reduce((s, hv, i) => s + Math.max(0, need[i] - hv), 0);
  if (short <= 0) return cols;
  const spare = have.map((hv, i) => Math.max(0, hv - need[i]));
  const spareSum = spare.reduce((s, v) => s + v, 0);
  // Not enough room anywhere: share the width out in proportion to need (the
  // widest cells still overhang, but no column is starved for another).
  if (spareSum < short) {
    const needSum = need.reduce((s, v) => s + v, 0);
    return cols.map((c, i) => ({ ...c, w: need[i] / needSum }));
  }
  return cols.map((c, i) => ({
    ...c,
    w: (need[i] > have[i] ? need[i] : have[i] - spare[i] * (short / spareSum)) / w,
  }));
}

function renderSLDMultiLane(input: SLDProfessionalInput, lanes: SLDSourceBranch[]): string {
  console.log(`[SLD MULTI-LANE ACTIVE] wave5a lanes=${lanes.length} keys=${lanes.map(l => l.key).join('+')}`);

  const parts: string[] = [];
  const resolveSegY = makeOverlapGuard();

  // Per-lane run lookup: the branch's own bare-id runs first, then the
  // aggregate's namespaced `${key}:${id}` runs / subSystem-stamped runs.
  const laneRun = (b: SLDSourceBranch, baseId: string): RunSegment | undefined => {
    const own = b.runs?.find(r => String(r.id) === baseId);
    if (own) return own;
    return input.runs?.find(r => {
      const id = String(r.id);
      return id === `${b.key}:${baseId}` || (id === baseId && r.subSystem === b.key);
    });
  };
  // Shared service runs keep bare ids in the aggregate (emitted exactly once).
  const findSharedRun = (id: string): RunSegment | undefined =>
    input.runs?.find(r => String(r.id) === id);

  const intercon     = String(input.interconnection ?? '').toLowerCase();
  const isLoadSide   = intercon.includes('load');
  const isSupplySide = intercon.includes('supply') || intercon.includes('line');

  // §1.7: the sheet's 120% panel uses the AGGREGATOR-SUMMED backfeed when the
  // adapter provided it. CONTRACT: input.backfeedAmps on the multi-lane path
  // is the authoritative TOTAL — Σ per-physical-inverter rounded OCPDs across
  // subs INCLUDING battery bus impact (what computeMultiSystem's aggregate /
  // the permit authority carries). Structural fallback: Σ lane contributions
  // + batteryBackfeedA. (P1-2: authority-carried lane fields win; the ladder
  // recompute is a degraded-payload fallback on the canonical NEC 240.6 table.)
  const laneBackfeed = (b: SLDSourceBranch): number =>
    b.backfeedAmps ?? b.acOCPD ?? necNextStandardOcpd((b.acOutputAmps ?? 0) * 1.25) ?? 0;
  const totalBackfeedAmps = input.backfeedAmps
    || (lanes.reduce((s, b) => s + laneBackfeed(b), 0) + (input.batteryBackfeedA ?? 0));

  // ── Wave 6 — hybrid AC collection: per-source combiner/OCPD → ONE shared AC
  //    combiner panel → ONE system disconnect (replaces a disconnect per lane).
  //    Single-sourced via acCollectionFromLanes so BOM/SCHED read the identical
  //    shared panel + disconnect (lib/permit/utils/sldAdapter.buildHybridAcCollection). ──
  //    The project's recorded selection rides along: this path re-resolves a
  //    combiner PER LANE and never looks at input.combinerModel, so without it
  //    a hybrid E-1 named a recommendation while the single-lane E-1 for the
  //    same project named the installer's choice.
  //    ...and it rides PER LANE: a hybrid's lanes need not share a brand, so one
  //    project-level id is not automatically every lane's answer (see
  //    laneSelectedCombinerId — an APsystems fence lane was being labelled with
  //    the Enphase combiner).
  const acCollection = acCollectionFromLanes(
    lanes, input.selectedCombinerId ?? null, input.selectedCombinerIdByLane ?? null);

  // ── HYBRID METERING — "add CTs to the hybrid SLDs too" (Ray, 2026-09-26) ──
  // Each lane's CTs arrive ALREADY COMPOSED on the lane (`meteringDrawing`, the
  // one composer run on that lane's own plan — sldCombinerFields.
  // hybridLaneMetering); this sheet draws them and decides nothing. Only a micro
  // lane draws the box its gateway and production CT belong to, so only a micro
  // lane draws them. A lane that carries neither field draws no CT ink and keeps
  // its lane position — but it is NOT byte-identical to the pre-metering sheet:
  // the legibility passes since re-laid every hybrid (callout fitting, label
  // pitch, the tail spacing, '(FROM PV)', the title-block string).
  interface LaneMeter {
    md?: SldMeteringDrawing;
    sg?: StandaloneGatewayFields;
    /** The gateway is INSIDE this lane's combiner (an IQ Combiner) — from the
     *  lane's own resolved plan, the resolution that names the box drawn. */
    integrated: boolean;
    /** The composer states leads AND this sheet draws the gateway they run to
     *  (the single-lane rule: a lead with no far end is not drawn). */
    drawnLeads: boolean;
  }
  const laneMeters: Array<LaneMeter | null> = lanes.map(b => {
    if (laneTopology(b) !== 'MICRO' || (!b.meteringDrawing && !b.standaloneGateway)) return null;
    const sg = b.standaloneGateway;
    const integrated = !sg
      && acCollection.perSource.find(s => s.key === b.key)?.plan?.hasIntegratedGateway === true;
    const md = b.meteringDrawing;
    return { md, sg, integrated, drawnLeads: !!md?.leads?.length && (!!sg || integrated) };
  });
  // A site has ONE service, so ONE set of consumption CTs, read by ONE lane's
  // gateway (the composer's primary lane). The first one given is the one drawn.
  const consLaneIdx = laneMeters.findIndex(m => !!m?.md?.consumption);
  const consMeter = consLaneIdx >= 0 ? laneMeters[consLaneIdx] : null;

  const totalModules = input.totalModules || lanes.reduce((s, b) => s + (b.totalModules ?? 0), 0);
  // MULTI-LANE total AC = Σ of the lanes THIS sheet draws. input.acOutputKw is
  // the legacy single-system figure and on Stowell it lagged the design
  // (19.39 kW / "81 A" printed beside lanes summing 34.76 kW / Σ190A OCPDs —
  // and the service feeder "SIZED AT Σ 81A" inherited the lie). Lanes win.
  const _laneAcKw = lanes.reduce((s, b) => s + (b.acOutputKw ?? 0), 0);
  const totalAcKw = _laneAcKw > 0 ? _laneAcKw : (Number(input.acOutputKw) || 0);
  const dcKw = lanes.reduce((s, b) => s + ((b.totalModules ?? 0) * (b.panelWatts ?? 0)) / 1000, 0)
    || (input.totalModules * input.panelWatts) / 1000;

  // ── SVG root (same canvas + embedded-crop contract as the legacy path) ────
  const effW = input.schedulesOnly ? STACK_W : input.suppressTitleBlock ? TB_X - 10 : W;
  // preserveAspectRatio stated EXPLICITLY. "xMidYMid meet" is the spec default,
  // so this is behaviorally inert — but the page-fit harness
  // (scripts/planset-pagefit.mjs) only lets the multi-lane root through via its
  // `par === ''` escape hatch, i.e. the hybrid sheet is currently exempt from
  // the check by accident rather than by passing it. State the contract.
  // NOTE: the E-1 embed's height is still `H` — this path emits its bottom
  // calc/schedule band on E-1 (the wave-6 golden reads the POI table there),
  // so cropping the canvas would amputate ~408 units of live NEC content.
  // E-1.1 (schedulesOnly) is the band ALONE, on the stacked canvas the
  // single-lane E-1.1 uses (1420 × 1000, the planset's drawing box): it used to
  // be the whole hybrid sheet squeezed into that width — a second, smaller
  // copy of E-1, its tables' cells overrunning each other.
  const bandOnly = !!input.schedulesOnly;
  const effH = bandOnly ? STACK_H : H;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${effW}" height="${effH}" viewBox="0 0 ${effW} ${effH}" preserveAspectRatio="xMidYMid meet" style="background:${WHT};">`);
  parts.push(rect(0, 0, effW, effH, {fill:WHT, stroke:WHT, sw:0}));
  parts.push(rect(MAR/2, MAR/2, effW-MAR, effH-MAR, {fill:WHT, stroke:BLK, sw:SW_BORDER}));
  // Where the one-line starts: E-1.1 drops everything from here to the band.
  const _topoStart = parts.length;

  // ── Title ─────────────────────────────────────────────────────────────────
  const tcx = (DX + TB_X) / 2;
  // 1.5 uu higher than the single-lane title: '(MULTI-SOURCE)' has feet (the
  // parentheses descend), and at DY+16 they came within 1 uu of the address
  // line under it.
  parts.push(txt(tcx, DY+14.5, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM (MULTI-SOURCE)', {sz:F.title, bold:true, anc:'middle'}));
  parts.push(txt(tcx, DY+26,
    `${esc(input.address)}  |  ${lanes.length} PV SOURCES (${lanes.map(l => l.key.toUpperCase()).join(' + ')})  |  ${totalModules} MODULES  |  ${totalAcKw.toFixed(2)} kW AC`,
    {sz:F.sub, anc:'middle', fill:'#444'}));

  // ── Schematic border ──────────────────────────────────────────────────────
  // Cropped for E-1 (no title block), the sheet's frame closes 20 uu inside the
  // drawing area's right edge: the box, the fit and the legend all end inside
  // the frame there (the box's corner stood through it).
  const schW = input.suppressTitleBlock ? Math.min(SCH_W, effW - MAR/2 - 8 - SCH_X) : SCH_W;
  parts.push(rect(SCH_X, SCH_Y, schW, SCH_H, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  const _schScaleStart = parts.length;

  // ── Lane geometry ─────────────────────────────────────────────────────────
  const W_PV    = SLD_SYMBOL_MAP['pv-array'].width;
  const W_INV   = SLD_SYMBOL_MAP['inverter'].width;
  const W_DCDS  = SLD_SYMBOL_MAP['dc-disconnect'].width;
  const W_ACDS  = SLD_SYMBOL_MAP['ac-disconnect'].width;
  const W_COMB  = SLD_SYMBOL_MAP['ac-combiner'].width;
  const W_BUI   = SLD_SYMBOL_MAP['bui-enphase'].width;
  const W_JB    = 64;   // roof AC junction/transition box (micro lanes)
  const WIRE_GAP = 120;
  const nextCX = (cx: number, curW: number, nxtW: number, gap = WIRE_GAP) =>
    cx + curW/2 + gap + nxtW/2;

  // ── EVERY CONDUCTOR CALLOUT IS FITTED TO ITS OWN RUN ─────────────────────
  // Ray, 2026-09-26, on the SLD: "Biggest issue I have with the sld is the word
  // bleed and overlays. This should be cleaner to read!!" On this sheet the
  // bleed was mostly callouts wider than their runs: each was centred on its run
  // at the size it was authored, and the type floor raised it to 8.67 uu after
  // the layout was done. The lane feeder callout (~95 uu) sat on a 54 uu run and
  // the vertical step into the shared panel struck through it; the tail's '3×#6
  // AWG THWN-2 (L1,L2,N) + EGC' (146 uu) spanned a 95 uu run and printed on the
  // panel, on the disconnect and on the main service panel's wall.
  //
  // So every run here is drawn the way the single-lane sheet draws its own: the
  // callout keeps CALLOUT_FIT uu from each end of its span, breaks only at its
  // joints (' + ', ' / ', ' — ', see calloutCuts) and is pitched for the size
  // that prints — and each gap is laid out as long as the widest piece that
  // callout cannot break. Nothing is shortened: a run grows to carry its words.
  // (renderWireRun's `fit`; each callout is resolved once, here, from the same
  // run and fallback lines the drawing prints.)
  const CALLOUT_FIT = 4;
  interface CalloutSpec { run: RunSegment | undefined; lines: string[]; isDC: boolean }
  const calloutSpec = (run: RunSegment | undefined, fb: string[], isDC: boolean): CalloutSpec =>
    ({ run, lines: runLines(run, fb).lines, isDC });
  /** The span (uu) a run needs so no unbreakable piece of its callout overhangs it. */
  const calloutSpan = (c: CalloutSpec): number =>
    Math.ceil(widestCalloutPiece(formatCallout(c.run, c.lines, c.isDC), F.seg)) + 2 * CALLOUT_FIT;
  /** The callout's top ink when it is fitted to `span` over a run at `baseY`. */
  const calloutTop = (c: CalloutSpec, span: number, baseY: number): number => {
    const n = formatCallout(c.run, c.lines, c.isDC)
      .flatMap(l => wrapToWidth(l, span - 2 * CALLOUT_FIT, F.seg)).length;
    return baseY - LABEL_OFFSET_ABOVE - (n - 1) * LBL_PITCH - capUu(F.seg);
  };
  /** A run whose callout stays over [x0, x1] of it. */
  const fittedRun = (wr: WireRun, c: CalloutSpec, x0: number, x1: number): string =>
    renderWireRun(wr, c.lines, { fit: CALLOUT_FIT, labelSpan: [x0, x1] });
  /** An inverter's terminal stubs sit where its art puts them (DC in 25 uu,
   *  AC out 10 uu above its centre line); the lane's runs sit on the lane. A
   *  short square jog joins the two — the stubs used to float beside the runs
   *  they belong to, and neither conductor visibly reached the inverter. */
  const invTerminalJog = (x: number, runY: number, termY: number): string =>
    Math.abs(runY - termY) > 1 ? ln(x, runY, x, termY, {sw:SW_MED}) : '';

  // ── What each lane prints — resolved ONCE, before the layout, so the gaps
  //    can be sized to it and the drawing prints exactly these words. ────────
  interface LaneFacts {
    tag: string; isFenceLane: boolean; modules: number; watts: number; panelModel: string;
    invUnselected: boolean; invMfr: string; invModel: string; laneLabel: string;
    laneAcAmps: number; laneOcpd: number;
    // micro only
    nb: number; bocpd: number; brGauge: string; brGaugeTxt: string; brCur: number;
    /** PV → first node (J-box, DC disconnect or inverter), the lane's middle
     *  run (J-box → combiner, DC disconnect → inverter; absent otherwise) and
     *  its feeder to the shared panel. */
    first: CalloutSpec; mid?: CalloutSpec; feeder: CalloutSpec;
  }
  const laneFacts: LaneFacts[] = lanes.map((b): LaneFacts => {
    const topo = laneTopology(b);
    const tag = LANE_TAG[b.key];
    const isFenceLane = (b.systemType ?? b.key) === 'fence';
    const modules = b.totalModules ?? 0;
    const watts = b.panelWatts ?? 0;
    const panelModel = b.panelModel && b.panelModel !== '—' ? b.panelModel : (watts ? `${watts}W MODULE` : 'PV MODULE');
    // FAIL-LOUD (permit integrity): a genuinely unselected inverter renders a
    // visible red '⚠ INVERTER NOT SELECTED — PV-<KEY>' marker — NEVER a
    // fabricated model or a silent topology-name substitution (which would let
    // an incomplete design ship). A resolved model prints as-is.
    const _invRaw = b.inverterModel;
    const invUnselected = !_invRaw || _invRaw === '—' || _invRaw === 'Inverter'
      || isInverterUnselectedMarker(_invRaw);
    const invMfr = invUnselected ? '' : (b.inverterManufacturer && b.inverterManufacturer !== '—' ? b.inverterManufacturer : '');
    const invModel = invUnselected
      ? (isInverterUnselectedMarker(_invRaw) ? _invRaw! : unselectedInverterLabel(b.key))
      : _invRaw!;
    const laneLabel = b.label ?? `${b.key.toUpperCase()} — ${modules} × ${panelModel}`;
    const laneAcAmps = b.acOutputAmps ?? Math.round(((b.acOutputKw ?? 0) * 1000) / 240);
    // P1-2: b.acOCPD is the authority's per-sub feeder OCPD (adapter-carried);
    // the ladder recompute is a degraded-payload fallback only.
    const laneOcpd = b.acOCPD ?? necNextStandardOcpd(laneAcAmps * 1.25) ?? 20;
    const md = b.deviceCount ?? modules;
    const nb = b.microBranches?.length ?? microBranchCount(md, invModel);
    const bocpd = b.microBranches?.length ? Math.max(...b.microBranches.map(x => x.ocpdAmps)) : 20;
    const brGauge = wireGaugeForOcpd(bocpd);
    // Gauge text for the branch-trunk labels: the plan's own per-branch
    // callouts (mixed plans read "#12/#10"), never a hardcoded 20A gauge.
    const brGaugeTxt = (() => {
      const gs = [...new Set((b.microBranches ?? [])
        .map(x => x.conductorCallout?.match(/#\d+(?:\/0)?/)?.[0])
        .filter((g): g is string => !!g))];
      return gs.length ? `${gs.join('/')} AWG` : brGauge;
    })();
    const brCur = b.microBranches?.length
      ? Math.max(...b.microBranches.map(x => x.branchCurrentA)) : bocpd / 1.25;
    const ns = b.totalStrings || 1;
    const fGauge = b.acWireGauge ?? '#8 AWG';
    // A micro lane's feeder is L1, L2 AND N (the gateway's neutral) — said on
    // its own line, so the callout can stack over a short run without the
    // conductor set being split mid-phrase.
    const feeder = calloutSpec(
      laneRun(b, topo === 'MICRO' ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'),
      topo === 'MICRO'
        ? [`3×${fGauge} THWN-2`, '(L1,L2,N) + EGC', `${laneOcpd}A OCPD → PANEL`]
        : [`${fGauge} THWN-2 + EGC`, `${laneOcpd}A OCPD → PANEL`],
      false);
    let first: CalloutSpec, mid: CalloutSpec | undefined;
    if (topo === 'MICRO') {
      // Branch circuits are sized to their OWN branch OCPDs from the plan,
      // NOT the lane FEEDER gauge — b.acWireGauge is the 90A feeder's #3 and
      // stamping it on the branches overstated them 3 sizes (audit 2026-07-16).
      first = calloutSpec(laneRun(b, 'BRANCH_RUN') ?? laneRun(b, 'ROOF_RUN'),
        [`${nb} AC BRANCH CIRCUIT${nb>1?'S':''}`, `${brGaugeTxt} THWN-2 + EGC`, b.key === 'roof' ? 'NEC 690.12 RSD' : 'AT GRADE'], false);
      // J-box → combiner still carries the individual branch circuits at
      // their plan-sized gauges.
      mid = calloutSpec(undefined, [`${brGaugeTxt} THWN-2 + EGC`, `IN CONDUIT — NEC 690.31`], false);
    } else if (topo === 'OPTIMIZER' || b.integratedDcDisconnect) {
      first = calloutSpec(laneRun(b, 'DC_STRING_RUN') ?? laneRun(b, 'DC_DISCO_TO_INV_RUN'),
        [`${ns * 2}#10 PV WIRE`, `+ EGC`, 'NEC 690.31'], true);
    } else {
      first = calloutSpec(laneRun(b, 'DC_STRING_RUN'), [`${ns * 2}#10 USE-2/PV Wire`, `+ EGC`, 'NEC 690.31'], true);
      mid = calloutSpec(laneRun(b, 'DC_DISCO_TO_INV_RUN'), [`${ns * 2}#10 THWN-2`, `+ EGC`, `IN ${b.acConduitType ?? 'EMT'}`], true);
    }
    return { tag, isFenceLane, modules, watts, panelModel, invUnselected, invMfr, invModel, laneLabel,
      laneAcAmps, laneOcpd, nb, bocpd, brGauge, brGaugeTxt, brCur, first, mid, feeder };
  });

  const LANE_PITCH = 330;
  const laneTop = SCH_Y + 150;
  // A lane that draws its standalone gateway gets GW_BAND more height ABOVE its
  // chain, inside its own band: the gateway is its own enclosure, fed straight
  // up from its breaker in the lane's panel, with its 5 ft production-CT lead
  // beside that conductor. The single-lane sheet has ~240 uu of clear air above
  // its chain for this; a lane has 25 uu between its band rule and its combiner
  // header, and in a lower lane the lane above sits there. Every other lane keeps
  // its exact Y, so a hybrid with no standalone gateway does not move.
  // 160, not 144: the gateway's supply callout sits LEFT of its rising
  // conductor at mid-height, a full 1.5 line pitches clear of the lane's
  // 'AC COMBINER' header (stacked on that header it read as one label block).
  const GW_BAND = 160;
  /** How far the gateway enclosure's bottom stands above its panel's top. */
  const GW_RISE = 68;
  const laneGwBand = (i: number) => (laneMeters[i]?.sg ? GW_BAND : 0);
  const laneYs = lanes.map((_, i) =>
    laneTop + i * LANE_PITCH + laneMeters.slice(0, i + 1).reduce((s, m) => s + (m?.sg ? GW_BAND : 0), 0));

  // Pre-compute each lane's node X positions so the POI bus clears the
  // longest chain. Each gap is the longer of LANE_GAP and the span its callout
  // needs (above).
  //
  // The arrays start 20 uu in from the schematic box, not 60: the 40 uu that
  // freed goes to the runs on the right, which need it. The array's nameplate is
  // centred under it, so the array sits far enough in for its widest line.
  const _pvLabelW = Math.max(0, ...lanes.map((b, i) => {
    const f = laneFacts[i];
    const md = b.deviceCount ?? f.modules;
    const ns = b.totalStrings || 1;
    const pps = b.panelsPerString ?? Math.round(f.modules / Math.max(ns, 1));
    return Math.max(
      textWidthUu(f.isFenceLane ? `SOLAR FENCE ARRAY PV-${f.tag}` : `PV ARRAY PV-${f.tag}`, F.hdr, true),
      textWidthUu(f.panelModel, F.tiny),
      laneTopology(b) === 'MICRO'
        ? textWidthUu(f.invUnselected ? f.invModel : `${md} × ${f.invModel}`, F.tiny, f.invUnselected)
        : textWidthUu(`${ns} STRING${ns>1?'S':''} × ${pps} MODULES`, F.tiny, true),
      laneTopology(b) === 'OPTIMIZER'
        ? textWidthUu(`${b.optimizerQty ?? f.modules} DC OPTIMIZERS — 1 PER MODULE${b.optimizerModel ? ` (${b.optimizerModel})` : ''}`, F.tiny, true)
        : 0,
    );
  }));
  const xPVLane = SCH_X + 16 + Math.max(4 + W_PV/2, _pvLabelW/2);
  interface LaneGeom {
    topo: 'MICRO'|'OPTIMIZER'|'STRING'; xPV: number; xJbox: number; xMid1: number; xMid2: number; xFeedRight: number;
    /** Where the lane's feeder leaves its last node, and the span its callout needs. */
    feedX: number; feedSpan: number;
  }
  // A lane run is at least LANE_GAP long (it was 120 — the width the shared
  // tail now needs for callouts that fit their own runs; the sheet is fitted
  // to its width, so every uu a lane gives up is type size on paper).
  const LANE_GAP = 100;
  const geoms: LaneGeom[] = lanes.map((b, i) => {
    const topo = laneTopology(b);
    const f = laneFacts[i];
    const xPV = xPVLane;
    let xJbox = 0, xMid1 = 0, xMid2 = 0, xFeedRight = 0;
    if (topo === 'MICRO') {
      // Enphase SOP: AC trunk runs open-air across the array → transitions to
      // conduit at a roof-flashed AC junction box → conduit to the IQ Combiner.
      // (PV → J-box: the run IS the gap; J-box → combiner: the gap less the
      // combiner's 10 uu input stub.)
      xJbox = nextCX(xPV, W_PV, W_JB, Math.max(90, calloutSpan(f.first)));
      xMid1 = nextCX(xJbox, W_JB, W_COMB, Math.max(LANE_GAP, calloutSpan(f.mid!) + 10));
      xFeedRight = xMid1 + W_COMB/2;
    } else if (topo === 'OPTIMIZER' || b.integratedDcDisconnect) {
      xMid1 = nextCX(xPV, W_PV, W_INV, Math.max(LANE_GAP, calloutSpan(f.first) + 10));   // inverter (integrated DC disco)
      xFeedRight = xMid1 + W_INV/2;
    } else {
      xMid1 = nextCX(xPV, W_PV, W_DCDS, Math.max(LANE_GAP, calloutSpan(f.first)));      // external DC disco
      xMid2 = nextCX(xMid1, W_DCDS, W_INV, Math.max(LANE_GAP, calloutSpan(f.mid!) + 10)); // inverter
      xFeedRight = xMid2 + W_INV/2;
    }
    // Every last node's output terminal is 10 uu out of its right edge.
    return { topo, xPV, xJbox, xMid1, xMid2, xFeedRight, feedX: xFeedRight + 10, feedSpan: calloutSpan(f.feeder) };
  });

  // Shared collection stage: every lane feeds ONE AC combiner panel → ONE system
  // AC disconnect → POI (no per-lane disconnect).
  const W_PANEL = 140;
  // Each lane's feeder runs level from its last node to PANEL_STEP_IN uu short
  // of the panel, steps (vertically) to its breaker's pin and enters. Its
  // callout sits over the level run — so that run is at least as long as the
  // callout needs; the step used to strike through a string lane's callout,
  // which had 54 uu of run for ~95 uu of words. (A micro lane that draws its
  // gateway used to be held 200 uu off the panel for the same reason: its
  // centred ~150 uu callout sat on the combiner's top-right, where the gateway
  // and its CT leads are drawn. Fitted to its run, it cannot reach them.)
  const PANEL_STEP_IN = 30;
  // A LOWER lane that draws its standalone gateway has the gateway, and its
  // production lead's label, in the band above its chain — the height its own
  // feeder climbs through to reach the panel. The step stays right of that
  // label (it ran through 'PCT LEAD 5 FT — DO NOT EXTEND'). The label starts
  // 6 uu right of the lead, which rises from the PCT 18 uu in from the
  // combiner's right wall (see renderCombiner / THE GATEWAYS below).
  const _gwLabelClear = lanes.map((_, i) => {
    const m = laneMeters[i];
    if (i === 0 || !m?.sg || geoms[i].topo !== 'MICRO') return -Infinity;
    const pl = m.md?.leads?.find(l => l.channel === 'production');
    return geoms[i].xMid1 + W_COMB/2 - 18 + 6 + (pl ? textWidthUu(pl.label, F.tiny, true) : 0) + 4 + PANEL_STEP_IN;
  });
  const xPanel = Math.max(
    Math.max(...geoms.map(g => g.xFeedRight)) + 90,
    ...geoms.map(g => g.feedX + g.feedSpan + PANEL_STEP_IN),
    ..._gwLabelClear,
  ) + W_PANEL/2;
  const xPanelInX = xPanel - W_PANEL/2;
  const panelOutX = xPanelInX + W_PANEL;

  // ── The shared tail: panel → system disconnect → POI → MSP → [BUI] → meter.
  // Its three conductor runs (panel → disconnect → POI → MSP) are ONE conductor
  // set, and its callouts say so on three lines, so each can stack over a run
  // of ~100 uu; the service run to the meter carries the service conductors.
  const _tailGauge = wireGaugeForOcpd(acCollection.disconnectA);
  // (The system-tail conductors are protected by the tap OCPD — sized FROM it,
  // NEC 310.16. input.acWireGauge is the legacy single-system user field; on
  // Stowell it printed "#10 AWG ... 200A" on the Σ190A feeder, audit
  // 2026-07-16. 200A → #3/0 Cu via wireGaugeForOcpd.)
  const _tailRun = laneRun(lanes[0], 'DISCO_TO_METER_RUN');
  const tailA = calloutSpec(_tailRun, [`3×${_tailGauge} THWN-2`, '(L1,L2,N) + EGC', `${acCollection.disconnectA}A`], false);
  const tailB = calloutSpec(_tailRun, [`3×${_tailGauge} THWN-2`, '(L1,L2,N) + EGC', `${acCollection.disconnectA}A → POI`], false);
  // Same tap-OCPD sizing as the disco segments (was the user's legacy
  // single-system gauge; "SIZED AT Σ" reflects the true lane-sum amps).
  const tailC = calloutSpec(findSharedRun('DISCO_TO_METER_RUN'),
    [`3×${wireGaugeForOcpd(acCollection.disconnectA)} THWN-2`, '(L1,L2,N) + EGC', `IN ${input.acConduitType ?? 'EMT'}`,
     `SIZED AT Σ ${Math.round(totalAcKw * 1000 / 240)}A — ${acCollection.disconnectA}A TAP OCPD`], false);
  const tailD = calloutSpec(findSharedRun('MSP_TO_UTILITY_RUN') ?? findSharedRun('DISCO_TO_METER_RUN'),
    [`SERVICE CONDUCTORS`, `${input.mainPanelAmps}A SERVICE`], false);
  const W_MSP = SLD_SYMBOL_MAP['msp'].width;
  const mR = 40;                                   // the utility meter's radius
  const _poiHalf = textWidthUu('POINT OF INTERCONNECTION', F.hdr, true) / 2;
  const _hasBUI = !!input.hasBattery;
  // Minimum centre-to-centre steps, each from the run between the two nodes:
  //  • panel → disconnect: the run ends 10 uu into the disconnect's entry
  //    stubs (they rise from it to its poles), and starts at the panel's wall;
  //  • disconnect → POI: it starts past the exit stubs, and the POI title
  //    (centred on the POI, over the two callouts either side of it) clears
  //    the disconnect's callout bubble (its right edge is 84 uu out);
  //  • POI → MSP: the title clears the MSP's wall;
  //  • MSP (or BUI) → meter: the run clears the bus stub, and may run on over
  //    the meter's lead-in stub.
  const _minDisco = panelOutX + 2 + calloutSpan(tailA) + 12 + W_ACDS/2;
  const _minPOIFromDisco = Math.max(W_ACDS/2 + 12 + calloutSpan(tailB) + 6, W_ACDS/2 + 24 + 2 + _poiHalf);
  const _minMSPFromPOI = Math.max(6 + calloutSpan(tailC) + 2, _poiHalf + 3) + W_MSP/2;
  // MSP → BUI carries no callout (a plain bus tie): only the MSP's CT tag and
  // callout bubble, just outside its wall, need the air — and the battery's
  // nameplate, which sits left of the battery's conductor (it drops to the BUI
  // from above) and must end short of that bubble.
  const _batLblW = _hasBUI ? Math.max(
    textWidthUu((input.batteryModel || (input.batteryKwh ? `${input.batteryKwh} kWh Battery` : 'BATTERY STORAGE')).substring(0, 22), F.tiny),
    textWidthUu(batteryCapacityCell(input.batteryKwh, input.batteryKwhLabel), F.tiny, true),
    (input.batteryBackfeedA ?? 0) > 0 ? textWidthUu(`${input.batteryBackfeedA}A BACKFEED — NEC 705.12(B)`, F.tiny) : 0) : 0;
  const _minBUIFromMSP = Math.max(W_MSP/2 + 60 + W_BUI/2, W_MSP/2 + 24 + 6 + _batLblW + 8);
  const _minUtilFromSvc = 12 + calloutSpan(tailD) + 2 + mR;   // from the MSP's (or BUI's) output terminal
  // Fill the sheet width: at unit gaps the shared tail hugged the lanes and
  // left ~1/3 of the drawing area dead right of the meter (Ray audit
  // 2026-07-16: "visual ickyness"). The spare width is shared out evenly over
  // the tail's runs so the utility symbol lands near the right edge — capped so
  // a short tail cannot become wire spaghetti.
  const _tailRightEdge = DX + DW - 70;            // keep the grid symbol inside the frame
  const _tailGaps = _hasBUI ? 5 : 4;
  const _rawUtil = _minDisco + _minPOIFromDisco + _minMSPFromPOI
    + (_hasBUI ? _minBUIFromMSP + W_BUI/2 : W_MSP/2) + _minUtilFromSvc;
  const _gapAdd = Math.max(0, Math.min(120, (_tailRightEdge - 60 - _rawUtil) / _tailGaps));
  const xSingleDisco = _minDisco + _gapAdd;
  const xPOI = xSingleDisco + _minPOIFromDisco + _gapAdd;
  const xMSP = xPOI + _minMSPFromPOI + _gapAdd;
  const panelInputs: Array<{ y: number; ocpd: number; tag: string }> = [];
  const xBUI = _hasBUI ? xMSP + _minBUIFromMSP + _gapAdd : xMSP + 130;
  const xUtil = (_hasBUI ? xBUI + W_BUI/2 : xMSP + W_MSP/2) + _minUtilFromSvc + _gapAdd;
  console.log(`[SLD MULTI-LANE TAIL] panel=${xPanel.toFixed(0)} disco=${xSingleDisco.toFixed(0)} poi=${xPOI.toFixed(0)} msp=${xMSP.toFixed(0)}${_hasBUI ? ` bui=${xBUI.toFixed(0)}` : ''} util=${xUtil.toFixed(0)} +${_gapAdd.toFixed(1)}/gap`);
  const tailY = laneYs.length ? (laneYs[0] + laneYs[laneYs.length - 1]) / 2 : laneTop;
  // Compact AC combiner panel geometry: a proportioned box centered on tailY
  // with the backfed breakers stacked tight — was a full-lane-height slab
  // (~750px, dwarfing the 120px disconnect). Each lane feed steps from its lane
  // Y into its breaker's pin Y.
  const PANEL_PIN_GAP = 46;
  const _pinSpan = Math.max(0, (lanes.length - 1) * PANEL_PIN_GAP);
  const yPanelTop = tailY - _pinSpan / 2 - 42;   // header + top padding
  const yPanelBot = tailY + _pinSpan / 2 + 26;   // bottom padding
  const panelPinY = (i: number): number => tailY - _pinSpan / 2 + i * PANEL_PIN_GAP;

  let calloutN = 0;

  // ── Conductor tag registry (hexagon markers ⇄ schedule rows) ─────────────
  // Registered DURING the lane render at the segment's own coordinates so the
  // tags ride the existing geometry; the CONDUIT AND CONDUCTOR SCHEDULE below
  // prints the same numbers. addTag returns the tag so a multi-segment class
  // can stamp extra hexagons with the SAME number.
  const condTagRows: CondTagRow[] = [];
  let _tagSeq = 0;
  const addTag = (x: number, y: number, row: Omit<CondTagRow, 'tag'>): string => {
    const t = String(++_tagSeq);
    condTagRows.push({ tag: t, ...row });
    parts.push(hexTag(x, y, t));
    return t;
  };
  // Per-lane figures captured DURING the render — the SAME values the diagram
  // prints — for the SYSTEM SUMMARY / MAX SYSTEM VOLTAGE tables below.
  interface LaneInfo {
    tag: string; topo: 'MICRO' | 'OPTIMIZER' | 'STRING';
    modules: number; watts: number; nCircuits: number; perCircuit: string;
    isc: number; voc: number; pps: number; coeff: number | null;
    acAmps: number; acKw: number; ocpd: number; egc: string; feederGauge: string;
  }
  const laneInfos: LaneInfo[] = [];
  // Where each METERING lane's combiner put its gateway-side connection points
  // — read by the CT-lead block below, after the MSP has drawn its CTs.
  const laneGwPts: Array<{
    cx: number; ty: number;
    prodCtTop?: {x:number; y:number};
    gatewayLeadIn?: {x:number; y:number};
    gatewaySupplyOut?: {x:number; y:number};
  } | null> = lanes.map(() => null);

  // ── Source lanes ──────────────────────────────────────────────────────────
  lanes.forEach((b, i) => {
    const g = geoms[i];
    const laneY = laneYs[i];
    const F_ = laneFacts[i];
    const { tag, isFenceLane, modules, watts, panelModel, invUnselected, invMfr, invModel, laneLabel,
      laneAcAmps, laneOcpd } = F_;
    console.log(`[SLD LANE ${tag}] topo=${g.topo} modules=${modules} inv=${invMfr} ${invModel} ocpd=${laneOcpd}A`);

    // Lane band label (left margin, above the PV array — and above the lane's
    // standalone gateway when it draws one, so the gateway sits in its band).
    const bandY = laneY - laneGwBand(i);
    parts.push(txt(SCH_X + 16, bandY - 120, `PV-${tag} · ${laneLabel}`, {sz:F.hdr, bold:true, fill:'#1A237E'}));
    // A lower lane's rule stops short of the shared panel: the shared tail
    // (panel → disconnect → POI → MSP) sits between the lanes, and a lower
    // lane's rule, run on to the POI, passed along the disconnect's bottom edge
    // and through its ground drop. The top lane's rule runs over the tail.
    const bandRuleX = i > 0 ? xPanelInX - 40 : xPOI;
    parts.push(ln(SCH_X + 16, bandY - 114, bandRuleX, bandY - 114, {stroke:'#C5CAE9', sw:SW_HAIR}));

    // ── PV array node ──
    const pvSymbolId = isFenceLane ? 'pv-fence' : 'pv-array';
    const pvH = SLD_SYMBOL_MAP[pvSymbolId].height;
    parts.push(embedSymbol(pvSymbolId, g.xPV, laneY, W_PV, pvH));
    parts.push(txt(g.xPV, laneY-pvH/2-18, isFenceLane ? `SOLAR FENCE ARRAY PV-${tag}` : `PV ARRAY PV-${tag}`, {sz:F.hdr, bold:true, anc:'middle'}));
    parts.push(txt(g.xPV, laneY-pvH/2-8, watts ? `${modules} × ${watts}W` : `${modules} MODULES`, {sz:F.sub, anc:'middle'}));
    // The nameplate block starts under the array's ground terminal (its dot
    // hangs below the symbol — at +9 the module name sat on it) and is pitched
    // for the size that prints: the single-lane array's block, line for line.
    const pvL0 = laneY+pvH/2+16;
    parts.push(txt(g.xPV, pvL0, esc(panelModel), {sz:F.tiny, anc:'middle', italic:true}));
    if (g.topo === 'MICRO') {
      const md = b.deviceCount ?? modules;
      parts.push(txt(g.xPV, pvL0+LBL_PITCH,
        invUnselected ? esc(invModel) : `${md} × ${esc(invModel)}`,
        {sz:F.tiny, anc:'middle', ...(invUnselected ? {fill:'#C62828', bold:true} : {})}));
    } else {
      const ns = b.totalStrings || 1;
      const pps = b.panelsPerString ?? Math.round(modules / Math.max(ns, 1));
      let _pvLn = pvL0+LBL_PITCH;
      parts.push(txt(g.xPV, _pvLn, `${ns} STRING${ns>1?'S':''} × ${pps} MODULES`, {sz:F.tiny, anc:'middle', bold:true}));
      if (b.panelVoc || b.panelIsc) {
        _pvLn += LBL_PITCH;
        parts.push(txt(g.xPV, _pvLn, `Voc=${((b.panelVoc ?? 0) * pps).toFixed(1)}V  Isc=${(b.panelIsc ?? 0).toFixed(2)}A`, {sz:F.tiny, anc:'middle', fill:'#B71C1C'}));
      }
      if (g.topo === 'OPTIMIZER') {
        const oq = b.optimizerQty ?? modules;
        _pvLn += LBL_PITCH;
        parts.push(txt(g.xPV, _pvLn, `${oq} DC OPTIMIZERS — 1 PER MODULE${b.optimizerModel ? ` (${b.optimizerModel})` : ''}`, {sz:F.tiny, anc:'middle', fill:'#1A237E', bold:true}));
      }
    }
    parts.push(callout(g.xPV+W_PV/2+14, laneY-pvH/2-5, ++calloutN));
    const pvPt = getAnchorPoint(pvSymbolId, 'dc_pos', g.xPV, laneY, W_PV, pvH);

    // ── Middle chain ──
    let feedX = pvPt.x;   // running right-edge terminal toward the disco
    let feedStubY: number | null = null;   // an inverter's AC stub, when it is not on the lane
    if (g.topo === 'MICRO') {
      const { nb, bocpd, brGauge: _brGauge, brGaugeTxt: _brGaugeTxt, brCur: _brCur } = F_;
      // 🚨 PER-LANE, AND THE BASIS COMES WITH IT. A lane's combiner is resolved
      // against that lane's brand and that lane's recorded answer; a lane the
      // project selection does not cover now has NO device rather than the other
      // lane's, and falls back to a generic descriptive label. `_laneDecided`
      // false ⇒ whatever is printed was derived, so it is qualified on the
      // drawing — a fence lane reading "APsystems AC Combiner" must not look
      // like somebody chose it.
      const _laneCollect = acCollection.perSource.find(s => s.key === b.key);
      const _laneCombiner = _laneCollect?.combiner;
      const _laneDecided = _laneCollect?.combinerBasis
        ? combinerBasisIsDecided(_laneCollect.combinerBasis)
        : undefined;
      const clabel = _laneCombiner ? `${_laneCombiner.brand} ${_laneCombiner.model}` : (b.combinerLabel ?? `${invMfr || 'PV'} AC Combiner`);
      const _lm = laneMeters[i];
      const cr = renderCombiner(g.xMid1, laneY, nb, bocpd, clabel, ++calloutN,
        {branchOcpds: b.microBranches?.map(x => x.ocpdAmps),
         selectionUnresolved: _laneDecided === false,
         // The lane feeder is tagged 3(L1,L2,N): the gateway needs the neutral.
         neutral: true,
         // The lane names the box ABOVE it (below): no title strip inside, or
         // one box said its name three times — the header, the 'AC COMBINER'
         // strip 18 uu under it and the nameplate (Ray: "AC COMBINER is
         // printed twice").
         headerAbove: true,
         // This lane's gateway and production CT, passed exactly as the
         // single-lane sheet passes its own. A lane with no metering adds
         // none of these keys (no CT, gateway or lead ink).
         ...(_lm ? {
           integratedGateway: _lm.integrated,
           productionCt: _lm.md?.production?.where,
           ctLeadConnector: !!_lm.md?.lead,
           drawnCtLeads: _lm.drawnLeads,
           gatewayArt: resolveDeviceIllustration(clabel.split(/\s+/)[0] ?? '', 'gateway')
             ?? resolveDeviceIllustration(b.inverterManufacturer ?? '', 'gateway'),
           gatewaySupplyBreakerA: _lm.sg?.supplyBreakerA,
           // The fit may draw this sheet below 1:1 (three lanes, a battery).
           ctTagGap: 7.5,
         } : {}),
         // Its nameplate block pitched for the size that prints (at 9 each
         // line came within 1 uu of the next).
         labelPitch: LBL_PITCH});
      parts.push(cr.svg);
      if (_lm) {
        laneGwPts[i] = {cx: g.xMid1, ty: cr.ty, prodCtTop: cr.prodCtTop,
          gatewayLeadIn: cr.gatewayLeadIn, gatewaySupplyOut: cr.gatewaySupplyOut};
      }
      // Centred on the box. Under a standalone gateway the header is the box's
      // ROLE, as the single-lane sheet heads it — 'AC COMBINER' (62 uu) ends
      // short of the gateway's supply conductor at x+40, where the model name
      // ('GENERIC 125A PV AC COMBINER PANEL', 191 uu) had to be right-aligned
      // on the gateway supply callout's edge and read as one block with it; the
      // model is the nameplate under the box. Every other lane keeps the model
      // as its header (tests/sldCombinerSheetAuthority.test.ts pins header +
      // nameplate).
      parts.push(txt(g.xMid1, cr.ty-8, _lm?.sg ? 'AC COMBINER' : clabel.toUpperCase(), {sz:F.hdr, bold:true, anc:'middle'}));
      // ── AC junction / transition box (Enphase SOP): the AC trunk runs
      //    OPEN-AIR across the array, transitions to CONDUIT at a roof-flashed
      //    junction box, then conduit to the IQ Combiner. Array → J-box (open
      //    air) → combiner (raceway).
      const jbW = W_JB, jbH = 52;
      parts.push(embedSymbol('junction-box', g.xJbox, laneY, jbW, jbH));
      // Its name stacks over the box in lines no wider than the box, so the
      // conductor callouts either side keep their own air: centred on the box,
      // 'AC JUNCTION — NEC 690.31' (119 uu at the printed size) ran into both.
      // The bottom line clears the box's top terminal (a dot 2 uu above it).
      const _jbL = laneY - jbH/2 - 5;
      parts.push(txt(g.xJbox, _jbL - 2*LBL_PITCH, b.key === 'fence' ? 'FENCE J-BOX' : b.key === 'ground' ? 'ARRAY J-BOX' : 'ROOF J-BOX', {sz:F.sub, bold:true, anc:'middle'}));
      parts.push(txt(g.xJbox, _jbL - LBL_PITCH, 'AC JUNCTION', {sz:F.tiny, anc:'middle', italic:true}));
      parts.push(txt(g.xJbox, _jbL, 'NEC 690.31', {sz:F.tiny, anc:'middle', italic:true}));
      // Beside its name and over the J-box → combiner callout, whose four lines
      // reach 46 uu above the conductor (at the box's shoulder it sat on that
      // callout and on the name).
      parts.push(callout(g.xJbox + jbW/2 + 12, _jbL - 2*LBL_PITCH - 8, ++calloutN));
      const _jbIn  = getAnchorPoint('junction-box', 'left',  g.xJbox, laneY, jbW, jbH);
      const _jbOut = getAnchorPoint('junction-box', 'right', g.xJbox, laneY, jbW, jbH);
      // PV → J-box (open-air branch circuits on roof), J-box → combiner (conduit)
      {
        const { run, lines } = F_.first;
        const y = resolveSegY(pvPt.x, _jbIn.x, laneY);
        parts.push(fittedRun(buildWireRun(`LANE_${tag}_PV_TO_JBOX`, pvPt.x, y, _jbIn.x, y, run, lines, false, b.key === 'roof' ? 'OPEN_AIR' : 'RACEWAY'),
          F_.first, pvPt.x, _jbIn.x));
        addTag((pvPt.x + _jbIn.x) / 2, y + 24, {
          desc: `PV-${tag} AC BRANCH CIRCUITS — ARRAY TRUNK (${nb} BRANCH${nb > 1 ? 'ES' : ''})`,
          gauge: _brGauge, insul: 'THWN-2', nCond: `${2 * nb}(L1,L2)`,
          conduitType: 'N/A — FREE AIR', conduitSize: 'N/A',
          egc: b.branchEgcGauge ?? getEGCSize(bocpd), currentA: _brCur, baseVolts: 240,
          runId: run ? prettyRunId(String(run.id)) : undefined,
          lenFt: run?.onewayLengthFt ?? null,
        });
      }
      {
        // J-box → combiner still carries the individual branch circuits at
        // their plan-sized gauges (F_.mid).
        const fb = F_.mid!.lines;
        parts.push(fittedRun(buildWireRun(`LANE_${tag}_JBOX_TO_COMBINER`, _jbOut.x, laneY, cr.lx, laneY, undefined, fb, false, 'RACEWAY'),
          F_.mid!, _jbOut.x, cr.lx));
        addTag((_jbOut.x + cr.lx) / 2, laneY + 24, {
          desc: `PV-${tag} AC BRANCH CIRCUITS — J-BOX TO COMBINER`,
          gauge: _brGauge, insul: 'THWN-2', nCond: `${2 * nb}(L1,L2)`,
          conduitType: 'EMT', conduitSize: conduitSizeForConductors(_brGauge, 2 * nb + 1),
          egc: b.branchEgcGauge ?? getEGCSize(bocpd), currentA: _brCur, baseVolts: 240, lenFt: null,
        });
      }
      feedX = cr.feederOutX;
    } else if (g.topo === 'OPTIMIZER' || b.integratedDcDisconnect) {
      const invBox = renderInverterBox(g.xMid1, laneY, invMfr, invModel,
        b.acOutputKw ?? 0, laneAcAmps,
        g.topo === 'OPTIMIZER' ? 'STRING + OPTIMIZER' : 'STRING INVERTER', '', ++calloutN, invUnselected, LBL_PITCH);
      parts.push(invBox.svg);
      // Under the inverter's own nameplate block, at the same pitch (at a
      // fixed +45 the first line touched that block's last line).
      const _idL0 = invBox.lbl.bot + 4 + capUu(F.tiny);
      parts.push(txt(g.xMid1, _idL0, 'INTEGRATED DC DISCONNECT — NEC 690.15', {sz:F.tiny, anc:'middle', italic:true}));
      parts.push(txt(g.xMid1, _idL0 + LBL_PITCH, 'EXTERNAL DC DISCONNECT PROVIDED WHERE REQUIRED BY AHJ', {sz:F.tiny, anc:'middle', italic:true, fill:'#666'}));
      {
        const { run, lines } = F_.first;
        const y = resolveSegY(pvPt.x, invBox.dcInX, laneY);
        parts.push(fittedRun(buildWireRun(`LANE_${tag}_PV_TO_INV`, pvPt.x, y, invBox.dcInX, y, run, lines, true, 'OPEN_AIR'),
          F_.first, pvPt.x, invBox.dcInX));
        parts.push(invTerminalJog(invBox.dcInX, y, invBox.dcInY));
        const _ns = b.totalStrings || 1;
        const _pps = b.panelsPerString ?? Math.round(modules / Math.max(_ns, 1));
        addTag((pvPt.x + invBox.dcInX) / 2, y + 24, {
          desc: `PV-${tag} PV SOURCE CIRCUITS — ARRAY TO INVERTER`,
          gauge: '#10 AWG', insul: 'PV WIRE', nCond: `${_ns * 2}(${_ns}+,${_ns}−)`,
          conduitType: 'N/A — FREE AIR', conduitSize: 'N/A',
          egc: b.dcEgcGauge ?? getEGCSize(b.dcOCPD ?? 20),
          currentA: b.panelIsc ?? 0, baseVolts: Math.max(1, _pps * (b.panelVoc ?? 0)) || 240,
          runId: run ? prettyRunId(String(run.id)) : undefined,
          lenFt: run?.onewayLengthFt ?? null,
        });
      }
      feedX = invBox.acOutX; feedStubY = invBox.acOutY;
    } else {
      // STRING: external DC disco → inverter
      const dW = W_DCDS, dH = SLD_SYMBOL_MAP['dc-disconnect'].height;
      parts.push(embedSymbol('dc-disconnect', g.xMid1, laneY, dW, dH));
      parts.push(txt(g.xMid1, laneY-dH/2-15, '(N) DC DISCONNECT', {sz:F.sub, bold:true, anc:'middle'}));
      // Beside the switch's ground terminal (a dot under the symbol, with its
      // drop), not across it — the single-lane sheet's placement.
      parts.push(txt(g.xMid1+8, laneY+dH/2+17, `${b.dcOCPD ?? 20}A FUSED`, {sz:F.tiny, anc:'start'}));
      parts.push(callout(g.xMid1+dW/2-4, laneY-dH/2-5, ++calloutN));
      const dcIn = getAnchorPoint('dc-disconnect', 'dc_in', g.xMid1, laneY, dW, dH);
      const dcOut = getAnchorPoint('dc-disconnect', 'dc_out', g.xMid1, laneY, dW, dH);
      {
        const { run, lines } = F_.first;
        const y = resolveSegY(pvPt.x, dcIn.x, laneY);
        parts.push(fittedRun(buildWireRun(`LANE_${tag}_PV_TO_DCDS`, pvPt.x, y, dcIn.x, y, run, lines, true, b.key === 'roof' ? 'OPEN_AIR' : 'RACEWAY'),
          F_.first, pvPt.x, dcIn.x));
        const _ns0 = b.totalStrings || 1;
        const _pps0 = b.panelsPerString ?? Math.round(modules / Math.max(_ns0, 1));
        addTag((pvPt.x + dcIn.x) / 2, y + 24, {
          desc: `PV-${tag} PV SOURCE CIRCUITS — ARRAY TO DC DISCONNECT`,
          gauge: '#10 AWG', insul: 'PV WIRE', nCond: `${_ns0 * 2}(${_ns0}+,${_ns0}−)`,
          conduitType: 'N/A — FREE AIR', conduitSize: 'N/A',
          egc: b.dcEgcGauge ?? getEGCSize(b.dcOCPD ?? 20),
          currentA: b.panelIsc ?? 0, baseVolts: Math.max(1, _pps0 * (b.panelVoc ?? 0)) || 240,
          runId: run ? prettyRunId(String(run.id)) : undefined,
          lenFt: run?.onewayLengthFt ?? null,
        });
      }
      const invBox = renderInverterBox(g.xMid2, laneY, invMfr, invModel,
        b.acOutputKw ?? 0, laneAcAmps, 'STRING INVERTER', '', ++calloutN, invUnselected, LBL_PITCH);
      parts.push(invBox.svg);
      {
        const { run, lines } = F_.mid!;
        const y = resolveSegY(dcOut.x, invBox.dcInX, laneY);
        parts.push(fittedRun(buildWireRun(`LANE_${tag}_DCDS_TO_INV`, dcOut.x, y, invBox.dcInX, y, run, lines, true, 'RACEWAY'),
          F_.mid!, dcOut.x, invBox.dcInX));
        parts.push(invTerminalJog(invBox.dcInX, y, invBox.dcInY));
        const _ns1 = b.totalStrings || 1;
        const _pps1 = b.panelsPerString ?? Math.round(modules / Math.max(_ns1, 1));
        addTag((dcOut.x + invBox.dcInX) / 2, y + 24, {
          desc: `PV-${tag} PV OUTPUT — DC DISCONNECT TO INVERTER`,
          gauge: '#10 AWG', insul: 'THWN-2', nCond: `${_ns1 * 2}(${_ns1}+,${_ns1}−)`,
          conduitType: b.acConduitType ?? 'EMT',
          conduitSize: conduitSizeForConductors('#10 AWG', _ns1 * 2 + 1),
          egc: b.dcEgcGauge ?? getEGCSize(b.dcOCPD ?? 20),
          currentA: b.panelIsc ?? 0, baseVolts: Math.max(1, _pps1 * (b.panelVoc ?? 0)) || 240,
          runId: run ? prettyRunId(String(run.id)) : undefined,
          lenFt: run?.onewayLengthFt ?? null,
        });
      }
      feedX = invBox.acOutX; feedStubY = invBox.acOutY;
    }

    // ── Feed this lane's AC output to the SHARED AC combiner panel ──
    //    No per-lane disconnect: the ONE system disconnect is after the panel;
    //    the per-source OCPD is the backfed breaker landing in the panel.
    {
      // A micro lane's feeder is L1, L2 AND N (the gateway's neutral) — said
      // when there is no engine run to print (permit hybrid E-1). F_.feeder.
      const { run, lines } = F_.feeder;
      const pinY = panelPinY(i);
      const stepX = xPanelInX - PANEL_STEP_IN;
      const y = resolveSegY(feedX, stepX, laneY);
      // main horizontal run from the lane to the panel approach, then step
      // (vertical elbow) up/down to the breaker's compact pin Y and into the
      // panel. The callout stays over the level run, clear of the step.
      parts.push(fittedRun(buildWireRun(`LANE_${tag}_TO_PANEL`, feedX, y, stepX, y, run, lines, false, 'RACEWAY', g.topo === 'MICRO'),
        F_.feeder, feedX, stepX));
      if (feedStubY !== null) parts.push(invTerminalJog(feedX, y, feedStubY));
      if (Math.abs(y - pinY) > 1) parts.push(ln(stepX, y, stepX, pinY, {sw:SW_MED}));
      parts.push(ln(stepX, pinY, xPanelInX, pinY, {sw:SW_MED}));
      panelInputs.push({ y: pinY, ocpd: laneOcpd, tag });
      const _fGauge = b.acWireGauge ?? '#8 AWG';
      const _laneEgc = b.egcGauge ?? getEGCSize(laneOcpd);
      addTag((feedX + stepX) / 2, y + 24, {
        desc: `PV-${tag} AC FEEDER — ${g.topo === 'MICRO' ? 'COMBINER' : 'INVERTER'} TO PV AC PANEL`,
        gauge: _fGauge, insul: 'THWN-2', nCond: '3(L1,L2,N)',
        conduitType: b.acConduitType ?? 'EMT',
        conduitSize: conduitSizeForConductors(_fGauge, 4),
        egc: _laneEgc, currentA: laneAcAmps, baseVolts: 240,
        runId: run ? prettyRunId(String(run.id)) : undefined,
        lenFt: run?.onewayLengthFt ?? null,
      });
      // Per-lane figures for the SYSTEM SUMMARY / MAX VOLTAGE tables — the
      // exact values this lane just drew (no re-derivation).
      const _nCirc = g.topo === 'MICRO'
        ? (b.microBranches?.length ?? microBranchCount(b.deviceCount ?? modules, invModel))
        : (b.totalStrings || 1);
      const _perCirc = g.topo === 'MICRO'
        ? (b.microBranches?.length ? `${Math.max(...b.microBranches.map(x => x.deviceCount))} MAX` : '—')
        : String(b.panelsPerString ?? Math.round(modules / Math.max(b.totalStrings || 1, 1)));
      laneInfos.push({
        tag, topo: g.topo, modules, watts,
        nCircuits: _nCirc, perCircuit: _perCirc,
        isc: b.panelIsc ?? 0, voc: b.panelVoc ?? 0,
        pps: b.panelsPerString ?? Math.round(modules / Math.max(b.totalStrings || 1, 1)),
        coeff: typeof b.panelTempCoeffVoc === 'number' ? b.panelTempCoeffVoc : null,
        acAmps: laneAcAmps, acKw: b.acOutputKw ?? 0, ocpd: laneOcpd,
        egc: _laneEgc, feederGauge: _fGauge,
      });
    }
  });

  // ── SHARED AC COMBINER PANEL → ONE SYSTEM DISCONNECT → POI ──────────────────
  // Every source lands on a backfed breaker in one panel (busbar sized to the
  // aggregate PV backfeed), which feeds ONE system AC disconnect — replaces the
  // old "one AC disconnect per lane".
  {
    const yTop = yPanelTop;
    const yBot = yPanelBot;
    parts.push(rect(xPanelInX, yTop, W_PANEL, yBot - yTop, {fill:'#FAFAFA', stroke:BLK, sw:SW_MED}));
    const panelName = (acCollection.sharedPanel?.model ?? 'AC COMBINER PANEL').toUpperCase();
    parts.push(txt(xPanel, yTop - 10, panelName, {sz:F.hdr, bold:true, anc:'middle'}));
    parts.push(txt(xPanel, yTop + 14, `${acCollection.sharedPanel?.busbarA ?? totalBackfeedAmps}A BUSBAR · Σ ${totalBackfeedAmps}A`, {sz:F.tiny, anc:'middle', fill:'#555'}));
    parts.push(callout(xPanelInX + W_PANEL - 8, yTop + 8, ++calloutN));
    // vertical busbar inside the panel
    parts.push(ln(xPanel, yTop + 22, xPanel, yBot - 8, {sw:SW_MED, stroke:'#777'}));
    // per-source backfed breakers landing on the busbar. Each rating rides
    // ABOVE the breaker's tie to the busbar, right of the breaker: on it (level
    // with the tie), the tie struck through every rating.
    for (const pin of panelInputs) {
      parts.push(circ(xPanelInX, pin.y, 4, {fill:BLK, sw:0}));
      parts.push(rect(xPanelInX + 8, pin.y - 8, 22, 16, {fill:WHT, stroke:BLK, sw:SW_HAIR}));
      parts.push(txt(xPanelInX + 34, pin.y - 3, `${pin.ocpd}A`, {sz:F.tiny, anc:'start', bold:true, fill:'#1B5E20'}));
      parts.push(ln(xPanelInX + 30, pin.y, xPanel, pin.y, {sw:SW_HAIR, stroke:'#777'}));
      parts.push(txt(xPanelInX + 8, pin.y - 12, `PV-${pin.tag}`, {sz:F.tiny, anc:'start', fill:'#555'}));
    }
    // panel feeder out → the ONE system AC disconnect
    parts.push(ln(xPanel, tailY, panelOutX, tailY, {sw:SW_MED}));
    // The system tail is tagged 3(L1,L2,N) — the neutral passes the switch.
    const sysDisco = renderDisco(xSingleDisco, tailY, acCollection.disconnectA, ++calloutN, isSupplySide, true, LBL_PITCH);
    parts.push(sysDisco.svg);
    // Over the enclosure AND its callout bubble: the name is wider than the
    // box, and at the bubble's height its last word ran into the bubble.
    parts.push(txt(xSingleDisco, tailY - 71, '(N) AC DISCONNECT — SYSTEM', {sz:F.hdr, bold:true, anc:'middle'}));
    // Its ground leaves the enclosure's bottom edge and breaks for the
    // nameplate block under it, the symbol under the block — it used to run
    // from 5 uu under the box straight through all three lines of the block.
    {
      const GND_CLR = '#2E7D32';
      const _dTop = tailY + SLD_SYMBOL_MAP['ac-disconnect'].height/2;
      const _dGnd = sysDisco.lbl.bot + 9;
      for (const [a, z] of [[_dTop, sysDisco.lbl.top - 2.5], [sysDisco.lbl.bot + 2.5, _dGnd]] as Array<[number, number]>) {
        if (z - a >= 2) parts.push(ln(xSingleDisco, a, xSingleDisco, z, {stroke:GND_CLR, sw:1.0, dash:'4,3'}));
      }
      parts.push(gnd(xSingleDisco, _dGnd, GND_CLR));
    }
    {
      const run = _tailRun;
      // The system tail carries L1, L2, N (tagged 3(L1,L2,N) below) — tailA /
      // tailB above, each fitted to its own run.
      const yA = resolveSegY(panelOutX, sysDisco.loadInX, tailY);
      // Clear of the disconnect's entry stubs, which rise from this line to its
      // poles (and its neutral) in the last 10 uu before its wall.
      parts.push(fittedRun(buildWireRun('PANEL_TO_SYSDISCO', panelOutX, yA, sysDisco.loadInX, yA, run, tailA.lines, false, 'RACEWAY', true),
        tailA, panelOutX + 2, sysDisco.loadInX - 12));
      const yB = resolveSegY(sysDisco.lineOutX, xPOI, tailY);
      parts.push(fittedRun(buildWireRun('SYSDISCO_TO_POI', sysDisco.lineOutX, yB, xPOI, yB, run, tailB.lines, false, 'RACEWAY', true),
        tailB, sysDisco.lineOutX + 12, xPOI - 6));
      parts.push(circ(xPOI, tailY, 4, {fill:BLK, sw:0}));
      // ONE tag class for the combined tail (panel → disco → POI, same
      // conductors) — same number stamped on both segments.
      const _tailTag = addTag((sysDisco.lineOutX + xPOI) / 2, yB + 24, {
        desc: 'COMBINED PV OUTPUT — AC PANEL / SYSTEM DISCONNECT TO POI',
        gauge: _tailGauge, insul: 'THWN-2', nCond: '3(L1,L2,N)',
        conduitType: input.acConduitType ?? 'EMT',
        conduitSize: conduitSizeForConductors(_tailGauge, 4),
        egc: input.egcGauge ?? getEGCSize(acCollection.disconnectA),
        currentA: Math.round((totalAcKw * 1000 / 240) * 10) / 10, baseVolts: 240,
        runId: run ? prettyRunId(String(run.id)) : undefined,
        lenFt: run?.onewayLengthFt ?? null,
      });
      parts.push(hexTag((panelOutX + sysDisco.loadInX) / 2, yA + 24, _tailTag));
    }
  }
  // Anchor the POI title just above the POI node on the tail bus (it floated
  // at the TOP of the sheet, ~700px from the dot it names — audit 2026-07-16)
  // — over the two callouts either side of the node, not on them: at a fixed
  // tailY-30 it printed across both.
  {
    const topB = calloutTop(tailB, (xPOI - 6) - (xSingleDisco + W_ACDS/2 + 12), tailY);
    const topC = calloutTop(tailC, (xMSP - W_MSP/2 - 2) - (xPOI + 6), tailY);
    parts.push(txt(xPOI, Math.min(tailY - 30, topB - 3, topC - 3), 'POINT OF INTERCONNECTION', {sz:F.hdr, bold:true, anc:'middle'}));
  }
  // (The Σ BACKFEED statement is printed under the MSP's nameplate — below —
  // the panel whose busbar it describes. Here, 66 uu over the top lane and
  // ~150 uu above the POI, it floated in empty mid-sheet, tied to nothing.)

  // ── Shared service tail: MSP → [BUI] → METER → GRID ──────────────────────
  let mspResult: MspResult;
  // The site's consumption CTs, where the composer says they clamp, drawn by
  // the same MSP functions the single-lane sheet uses (null / {} ⇒ none, and
  // the MSP is drawn exactly as before). The tag states the composer's count.
  const _mspCtLoc = consMeter?.md?.consumption?.location ?? null;
  const _mspCt: MspCtOpts = consMeter?.md?.consumption ? {
    tag: `CT×${consMeter.md.consumption.ctCount ?? '?'}`,
    drawnLead: consMeter.drawnLeads && !!consMeter.md.leads?.some(l => l.channel === 'consumption'),
  } : {};
  if (isLoadSide) {
    mspResult = renderMSPLoad(xMSP, tailY, input.mainPanelAmps, totalBackfeedAmps, ++calloutN, _mspCtLoc, _mspCt, LBL_PITCH);
  } else {
    mspResult = renderMSPSupply(xMSP, tailY, input.mainPanelAmps, totalBackfeedAmps, isSupplySide, ++calloutN, _mspCtLoc, _mspCt, LBL_PITCH);
  }
  parts.push(mspResult.svg);
  {
    const { run, lines } = tailC;
    const y = resolveSegY(xPOI, mspResult.bkfdInX, tailY);
    // POI bus → MSP backfeed terminal (jog from bus level to terminal level)
    if (Math.abs(y - tailY) > 1) parts.push(ln(xPOI, tailY, xPOI, y, {sw:SW_MED}));
    // Its callout stays off the MSP's wall — it used to run across the wall,
    // the neutral bar and the bar's 'N'.
    parts.push(fittedRun(buildWireRun('POI_TO_MSP', xPOI, y, mspResult.bkfdInX, y, run, lines, false, 'RACEWAY', true),
      tailC, xPOI + 6, mspResult.bkfdInX - 2));
  }

  // Battery + BUI at the POI (shared tail, exactly once — I-6)
  let tailOutX = mspResult.busOutX, tailOutY = mspResult.busOutY;
  if (input.hasBattery) {
    // The battery sits ABOVE its interface unit, so the unit takes it on its
    // top edge (the single-lane sheet's drawing): its port on the bottom edge
    // ran the battery conductor down through the whole unit, its header and
    // its art, and the unit's name printed twice (header strip and block).
    const buiResult = renderBUI(xBUI, tailY, input.backupInterfaceBrand ?? '', input.backupInterfaceModel ?? '',
      input.atsAmpRating ?? 200, (input.backupInterfaceBrand ?? input.inverterManufacturer ?? '').toLowerCase().replace(/[\s\-_.]+/g, ''), false, ++calloutN,
      {batteryAbove: true});
    parts.push(buiResult.svg);
    parts.push(ln(mspResult.busOutX, mspResult.busOutY, buiResult.gridPortX, mspResult.busOutY, {stroke:BLK, sw:SW_MED}));
    if (Math.abs(mspResult.busOutY - buiResult.gridPortY) > 1) {
      parts.push(ln(buiResult.gridPortX, mspResult.busOutY, buiResult.gridPortX, buiResult.gridPortY, {stroke:BLK, sw:SW_MED}));
    }
    const batCY = tailY - 200;
    const batModel = input.batteryModel || (input.batteryKwh ? `${input.batteryKwh} kWh Battery` : 'BATTERY STORAGE');
    // Its nameplate LEFT of the conductor that drops from its bottom centre —
    // centred under it, that conductor struck through all three lines.
    const batResult = renderBattery(xBUI, batCY, batModel, input.batteryKwh ?? 0,
      input.batteryBackfeedA ?? 0, ++calloutN, input.batteryBrand ?? '', input.batteryKwhLabel ?? '',
      {labelsLeftOfDrop: true});
    parts.push(batResult.svg);
    parts.push(ln(batResult.acOutX, batResult.acOutY, buiResult.batPortX, buiResult.batPortY, {stroke:'#1565C0', sw:SW_MED, dash:'6,3'}));
    // The conductor's callout RIGHT of it, level with the nameplate's first
    // line and clear of the unit's 'BATTERY' port label under it; its tag
    // under the callout (left of the conductor it sat on the nameplate).
    const _batCalloutY = batResult.by + 16;
    const _batCallout = `${input.batteryBackfeedA ?? ''}A BATT — NEC 705.12(B)`;
    parts.push(txt(batResult.acOutX + 6, _batCalloutY, _batCallout, {sz:F.tiny, fill:'#1565C0'}));
    {
      const _batBf = input.batteryBackfeedA ?? 0;
      const _batGauge = wireGaugeForOcpd(Math.max(_batBf, 20));
      addTag(batResult.acOutX + 6 + textWidthUu(_batCallout, F.tiny) + 16, _batCalloutY - 3, {
        desc: 'ENERGY STORAGE — BATTERY TO BACKUP INTERFACE (AC-COUPLED)',
        gauge: _batGauge, insul: 'THWN-2', nCond: '3(L1,L2,N)',
        conduitType: 'EMT', conduitSize: conduitSizeForConductors(_batGauge, 4),
        egc: getEGCSize(Math.max(_batBf, 20)),
        currentA: _batBf > 0 ? Math.round((_batBf / 1.25) * 10) / 10 : 0, baseVolts: 240,
        lenFt: null,
      });
    }
    tailOutX = buiResult.loadPortX; tailOutY = buiResult.loadPortY;
  }
  // Utility meter + grid (ONE service tail) — drawn as the single-lane sheet
  // draws its own (see NODE 7 there).
  {
    const { run, lines } = tailD;
    // On the meter's line, jogging square at a source port that sits off it
    // (the single-lane sheet's SEGMENT_6).
    const y = resolveSegY(tailOutX, xUtil-mR-10, tailY);
    // The callout clears the bus stub leaving the MSP (or the BUI) and may run
    // on over the meter's lead-in stub.
    parts.push(fittedRun(buildWireRun('MSP_TO_METER', tailOutX, y, xUtil-mR-10, y, run, lines, false, 'RACEWAY'),
      tailD, tailOutX + 12, xUtil - mR - 2));
    if (Math.abs(y - tailOutY) > 1) parts.push(ln(tailOutX, tailOutY, tailOutX, y, {sw:SW_MED}));
  }
  parts.push(meterSymbol(xUtil, tailY, mR));
  parts.push(ln(xUtil-mR-10, tailY, xUtil-mR, tailY, {sw:SW_MED}));
  parts.push(txt(xUtil, tailY-mR-15, 'UTILITY METER', {sz:F.hdr, bold:true, anc:'middle'}));
  parts.push(txt(xUtil, tailY-mR-6, esc(input.utilityName), {sz:F.sub, anc:'middle'}));
  // The service rating sits beside the meter's drop to the grid, not on it:
  // centred under the meter, that drop ran through '120/240V, 1Ø, 3W'.
  parts.push(txt(xUtil+6, tailY+mR+13, '120/240V, 1Ø, 3W', {sz:F.tiny, anc:'start'}));
  // The callout bubble stands clear of a long utility name beside it.
  const meterCalloutX = Math.max(xUtil+mR+14,
    xUtil + textWidthUu(String(input.utilityName ?? ''), F.sub)/2 + 14);
  parts.push(callout(meterCalloutX, tailY-mR-5, ++calloutN));
  const gridCY = tailY + mR + 48;
  parts.push(ln(xUtil, tailY+mR, xUtil, gridCY-16, {sw:SW_MED}));
  parts.push(circ(xUtil, gridCY, 16, {fill:WHT, sw:SW_MED}));
  parts.push(txt(xUtil, gridCY-1, 'UTIL', {sz:5.5, bold:true, anc:'middle'}));
  parts.push(txt(xUtil, gridCY+7, 'GRID', {sz:5, anc:'middle'}));
  // Its name beside the symbol. Under it, the symbol's own ground stub and
  // ground ran through 'UTILITY GRID' and the utility's name.
  const gridLblX = xUtil+22;
  parts.push(txt(gridLblX, gridCY-1, 'UTILITY GRID', {sz:F.tiny, anc:'start', bold:true}));
  parts.push(txt(gridLblX, gridCY+LBL_PITCH-1, esc(input.utilityName), {sz:F.tiny, anc:'start'}));
  const gridLblRight = gridLblX + Math.max(textWidthUu('UTILITY GRID', F.tiny, true),
    textWidthUu(String(input.utilityName ?? ''), F.tiny));
  parts.push(ln(xUtil, gridCY+16, xUtil, gridCY+26, {sw:SW_MED}));
  parts.push(gnd(xUtil, gridCY+26));
  // (MSP grounding is drawn inside renderMSPLoad/renderMSPSupply — no extra
  // glyph here; it collided with the MSP's own tap/breaker labels.)
  // The notes under the MSP stack from under its nameplate block, pitched for
  // the size that prints: the Σ backfeed its busbar carries (the NEC 705.12(B)
  // sum over every source's OCPD — part of what the panel's own block states,
  // so it rides directly under that block), its EGC, a generator the
  // multi-source sheet does not draw, then the metering (below).
  const _sigmaY = mspResult.lbl.bot + 2.5 + capUu(F.tiny);
  parts.push(txt(xMSP, _sigmaY, `Σ BACKFEED ${totalBackfeedAmps}A — NEC 705.12(B) (Σ PER-INVERTER OCPDs)`, {sz:F.tiny, anc:'middle', fill:'#1B5E20'}));
  let _noteY = Math.max(tailY + 145, _sigmaY + LBL_PITCH + 2.5);
  parts.push(txt(xMSP, _noteY, 'EGC — NEC 250.122 / 690.43', {sz:F.tiny, anc:'middle', fill:GRN}));
  let _lastNoteY = _noteY;
  _noteY += 13;
  if ((input.generatorKw ?? 0) > 0) {
    // v1 non-goal on the multi-lane path — declare it, never silently drop it.
    // (At tailY+130 it printed across the MSP's nameplate block.)
    parts.push(txt(xMSP, _noteY, `NOTE: ${input.generatorKw} kW GENERATOR + TRANSFER EQUIPMENT PER SINGLE-SOURCE DETAIL — NOT SHOWN ON MULTI-SOURCE DIAGRAM`, {sz:F.tiny, anc:'middle', italic:true, fill:'#E65100'}));
    _lastNoteY = _noteY;
    _noteY += 11;
  }

  // ── THE GATEWAYS AND THEIR CT LEADS (hybrid) ──────────────────────────────
  // Drawn exactly as the single-lane sheet draws them (see "THE GATEWAY AND ITS
  // CT LEADS" there, and its shared helpers): each lead the composer states is
  // a heavy dashed conductor from the CT to the gateway, labelled ONCE with the
  // composer's words; a standalone gateway is its own enclosure above the panel
  // it is fed from, with its supply conductor and its 5 ft production-CT lead
  // rising to it. Nothing here decides a length, a count or a location.
  //
  // ROUTING. The lanes are stacked, so the one clear corridor between the shared
  // MSP and a gateway is the air ABOVE THE TOP LANE: the consumption lead leaves
  // the MSP by the rise the MSP reports clear of its own text and callout, runs
  // over the tail — nothing on the tail reaches above the top lane's band — and
  // drops into the top lane's gateway, crossing conductors only square-on and
  // never text. A gateway in a LOWER lane has the lanes above it (their
  // combiners among them) in that path, so its consumption lead is STATED in
  // the note under the MSP — as the single-lane sheet states any lead it cannot
  // route — rather than drawn through them. A production lead never leaves its
  // own lane, so it is always drawn.
  let _anyLeadDrawn = false;
  const _undrawnLeadLabels: string[] = [];
  let _leadInkTop = Infinity;          // the highest ink a drawn lead put down (fit box)
  lanes.forEach((b, i) => {
    const m = laneMeters[i], gp = laneGwPts[i];
    if (!m || !gp) return;
    const leads = m.drawnLeads ? (m.md?.leads ?? []) : [];
    // Only the primary lane carries a consumption lead (the composer's rule);
    // taking it from that lane alone keeps one set of CTs → one lead.
    const consLead = i === consLaneIdx ? leads.find(l => l.channel === 'consumption') : undefined;
    const prodLead = leads.find(l => l.channel === 'production');
    const exit = i === 0 ? mspResult.ctLeadExit : undefined;
    // A lead stated rather than drawn names the lane whose gateway it runs to.
    const stated = (label: string) => `PV-${LANE_TAG[b.key]}: ${label}`;
    const leadLabel = (x: number, y: number, label: string) =>
      txt(x, y, esc(label), {sz:F.tiny, anc:'middle', bold:true, fill:CT_CLR});

    if (m.sg) {
      // ── Standalone gateway node, in the band GW_BAND made above this lane.
      // Its bottom sits GW_RISE over the panel. The supply circuit's two lines
      // sit LEFT of the rising supply conductor at its mid-height, ending 6 uu
      // short of it, and 1.5 line pitches above the lane's 'AC COMBINER'
      // header: right-aligned on the header's edge 9 uu under it, the three
      // lines read as one label block (the conductor also ran 5 uu from the
      // strip under the header, now gone).
      const ey1 = gp.ty - GW_RISE;
      const node = standaloneGatewayNode(gp.cx + 56, ey1 - 100, m.sg, 11);
      parts.push(...node.parts);
      const {ex0, ex1} = node;
      const so = gp.gatewaySupplyOut;
      if (so) {
        parts.push(ln(so.x, so.y, so.x, ey1, {sw:SW_MED}));
        // The block's last line ends 1.5 pitches above the header's caps.
        const _sLast = gp.ty - 8 - capUu(F.hdr) - 1.5*LBL_PITCH - descUu(F.seg);
        parts.push(txt(so.x-6, _sLast - LBL_PITCH, `${m.sg.supplyBreakerA}A 2P — GATEWAY SUPPLY`, {sz:F.seg, anc:'end', bold:true}));
        parts.push(txt(so.x-6, _sLast, esc(m.sg.supplyConductor), {sz:F.seg, anc:'end'}));
      }
      const pt = gp.prodCtTop;
      if (prodLead && pt && m.md?.production?.where === 'landing-panel-field'
          && pt.x > ex0 + 8 && pt.x < ex1 - 8) {
        parts.push(ctLeadPolyline([[pt.x, pt.y], [pt.x, ey1]]));
        parts.push(ctLeadTerminal(pt.x, ey1));
        parts.push(txt(pt.x+6, ey1+22, esc(prodLead.label), {sz:F.tiny, anc:'start', bold:true, fill:CT_CLR}));
        _anyLeadDrawn = true;
      } else if (prodLead) {
        _undrawnLeadLabels.push(stated(prodLead.label));
      }
      // Consumption: up from the MSP, over the tail, into the gateway's right
      // side near its terminal door.
      if (consLead && exit?.length) {
        const rx = exit[exit.length - 1][0];
        const chY = ey1 - 16;
        parts.push(ctLeadPolyline([...exit, [rx, chY], [ex1, chY]]));
        parts.push(ctLeadTerminal(ex1, chY));
        parts.push(leadLabel((ex1 + rx)/2, chY-6, consLead.label));
        _anyLeadDrawn = true;
      } else if (consLead) {
        _undrawnLeadLabels.push(stated(consLead.label));
      }
    } else if (gp.gatewayLeadIn) {
      // ── The gateway inside this lane's IQ Combiner. Its production CT is
      // factory pre-wired, so the composer states only the consumption lead:
      // over the tail ABOVE this lane's band rule (below it, the 25 uu to the
      // combiner's name has no room for the lead's own label), then down past
      // the end of that name into the gateway.
      const gi = gp.gatewayLeadIn;
      if (consLead && exit?.length) {
        const rx = exit[exit.length - 1][0];
        const chY = gp.ty - 48;
        parts.push(ctLeadPolyline([...exit, [rx, chY], [gi.x, chY], [gi.x, gi.y]]));
        parts.push(ctLeadTerminal(gi.x, gi.y));
        parts.push(leadLabel((gi.x + rx)/2, chY-6, consLead.label));
        _leadInkTop = Math.min(_leadInkTop, chY - 6 - MIN_TYPE_UU);
        _anyLeadDrawn = true;
      } else if (consLead) {
        _undrawnLeadLabels.push(stated(consLead.label));
      }
      if (prodLead) _undrawnLeadLabels.push(stated(prodLead.label));
    }
  });
  // No drawn lead ⇒ the "CT" continuation bubbles (the MSP and the combiner's
  // gateway draw them), keyed by the composer's one-line lead in the note.
  const _ctBubbles = !!consMeter?.md?.lead && !consMeter.drawnLeads;

  // ── METERING NOTE — under the MSP it describes, below its EGC note: the
  // single-lane sheet's note line, and every lead that is stated, not drawn.
  // 11 uu apart, not the single-lane's 9: this sheet is fitted at ~1:1 (the
  // single-lane one well above), and at 9 the first line's '(' and ',' come
  // within 1.5 uu of the caps under them.
  let _notesBottom = _lastNoteY + descUu(F.tiny);
  {
    const NOTE_PITCH = 11;
    let _ny = _noteY;
    if (consMeter?.md?.consumption) {
      parts.push(txt(xMSP, _ny, consumptionCtNoteText(consMeter.md.consumption),
        {sz:F.tiny, anc:'middle', bold:true, fill:CT_CLR})); _ny += NOTE_PITCH;
      if (_ctBubbles && consMeter.md.lead) {
        parts.push(txt(xMSP, _ny, `(CT) = ${consMeter.md.lead.label}`,
          {sz:F.tiny, anc:'middle', fill:CT_CLR})); _ny += NOTE_PITCH;
      }
    }
    for (const l of _undrawnLeadLabels) {
      parts.push(txt(xMSP, _ny, l, {sz:F.tiny, anc:'middle', fill:CT_CLR})); _ny += NOTE_PITCH;
    }
    if (_ny > _noteY) _notesBottom = _ny - NOTE_PITCH + descUu(F.tiny);
  }

  // ── AUTO-SCALE (fit transform — k<1 ALLOWED, three lanes must shrink) ─────
  {
    const _sx0 = SCH_X + 12;
    // content right: the utility and its label margin, or the grid's name
    // beside it, or the meter's callout bubble.
    const _sx1 = Math.max(xUtil + 96, gridLblRight + 8, meterCalloutX + 14);
    let _sy0 = laneTop - 140;
    if (input.hasBattery) _sy0 = Math.min(_sy0, tailY - 295);
    // A consumption lead run over the top lane (and its label) is content too.
    if (Number.isFinite(_leadInkTop)) _sy0 = Math.min(_sy0, _leadInkTop - 6);
    // ...and so are the notes under the MSP.
    const _sy1 = Math.max(laneYs[laneYs.length-1] + 170, gridCY + 44, _notesBottom + 8);
    const _k = Math.min(
      (schW - 28) / Math.max(1, _sx1 - _sx0),
      (SCH_H - 32) / Math.max(1, _sy1 - _sy0),
      1.35,
    );
    const _tx = SCH_X + (schW - _k * (_sx1 - _sx0)) / 2 - _k * _sx0;
    const _ty = SCH_Y + (SCH_H - _k * (_sy1 - _sy0)) / 2 - _k * _sy0;
    parts.splice(_schScaleStart, 0,
      `<g transform="translate(${_tx.toFixed(1)},${_ty.toFixed(1)}) scale(${_k.toFixed(3)})">`);
    parts.push('</g>');
    console.log(`[SLD MULTI-LANE FIT] k=${_k.toFixed(3)} content=${Math.round(_sx1-_sx0)}x${Math.round(_sy1-_sy0)}`);
  }

  // ── Rapid shutdown (roof lanes only — I-7) ────────────────────────────────
  const roofLane = lanes.find(l => l.key === 'roof');
  if (roofLane && (roofLane.rapidShutdownIntegrated ?? input.rapidShutdownIntegrated)) {
    const rY = SCH_Y+SCH_H-22;
    parts.push(rect(SCH_X+5, rY-10, 300, 16, {fill:WHT, stroke:BLK, sw:SW_THIN}));
    parts.push(txt(SCH_X+10, rY, 'RAPID SHUTDOWN — NEC 690.12 (ROOF ARRAY PV-R) COMPLIANT', {sz:F.tiny, bold:true}));
  }

  // ── LEGEND ────────────────────────────────────────────────────────────────
  // §8 (BAR closeout 2026-07-25) — the multi-lane open-air legend entries derive
  // from the lane wiring-methods actually drawn: a micro lane draws the listed
  // Q-Cable assembly open-air; a string/optimizer lane draws open-air PV wire.
  // Only the entries whose method exists on the sheet appear (gate 11).
  const _hasMicroLane = lanes.some(b => laneTopology(b) === 'MICRO');
  const _hasNonMicroLane = lanes.some(b => laneTopology(b) !== 'MICRO');
  const legEntries: {dash: string; stroke: string; label: string}[] = [
    {dash:'',    stroke:BLK,       label:'AC Conductor in Conduit (THWN-2)'},
    ...(_hasMicroLane ? [{dash:'10,5', stroke:GRN, label:`Open Air — ${input.openAirBranchWiringLabel ?? 'AC Trunk Cable (TC-ER)'} AC Branch (NEC 690.31(C))`}] : []),
    ...(_hasNonMicroLane ? [{dash:'10,5', stroke:GRN, label:'Open Air — PV Wire/THWN-2 (NEC 690.31)'}] : []),
    {dash:'',    stroke:GRN,       label:'Equipment Grounding Conductor (EGC)'},
    // §8 closeout — DC-in-conduit legend renders only when a lane actually has DC
    // conductors in conduit (a string/optimizer lane). All-micro multi-lane sets
    // carry no field DC conductor; suppress the entry rather than imply strings.
    ...(_hasNonMicroLane
      ? [{dash:'4,2', stroke:BLK, label:'DC Conductor in Conduit (USE-2/PV Wire)'}] : []),
    ...(input.hasBattery ? [{dash:'6,3', stroke:'#1565C0', label:'Battery AC-Coupled Connection'}] : []),
    // The CT leads, in the form they are drawn — the single-lane sheet's entry.
    ...ctLeadLegendEntries(_anyLeadDrawn, _ctBubbles),
  ];
  // Post-AAC E-1 repair — long data-driven labels wrap inside the box (see the
  // single-lane legend note).
  const legRows = legEntries.flatMap(e =>
    wrapLegendLabel(e.label, 40, Math.max(F.tiny, MIN_TYPE_UU)).map((text, i) => ({ dash: e.dash, stroke: e.stroke, text, cont: i > 0 })));
  const legH = 16 + legRows.length * LEG_ROW_H;
  // 7 uu inside the schematic box — which, cropped for E-1, ends inside the
  // sheet's frame (see schW); on the full-width box the legend ran across it.
  const legX = SCH_X+schW-(LEG_W+7), legY = SCH_Y+SCH_H - legH - 4;
  parts.push(rect(legX, legY, LEG_W, legH, {fill:WHT, stroke:BLK, sw:SW_THIN}));
  parts.push(txt(legX+4, legY+10, 'LEGEND', {sz:F.sub, bold:true}));
  parts.push(ln(legX, legY+13, legX+LEG_W, legY+13, {sw:SW_THIN}));
  legRows.forEach((item,i) => {
    const ly = legY+19+i*LEG_ROW_H;
    if (!item.cont) parts.push(ln(legX+4, ly, legX+38, ly, {stroke:item.stroke, sw:SW_MED, dash:item.dash||undefined}));
    parts.push(txt(legX+LEG_TEXT_X, ly+3, item.text, {sz:F.tiny}));
  });

  // ═══ BOTTOM CALC BAND — reference-planset table suite ═════════════════════
  // Fills CALC_Y → sheet bottom with the E-1 calc tables: CONDUIT AND
  // CONDUCTOR SCHEDULE (tag-paired rows matching the diagram's hexagon
  // markers), SYSTEM SUMMARY (PER CIRCUIT), DESIGN TEMPERATURES + NEC
  // 690.7(A) max system voltage, MAX VOLTAGE DROP, the POI 120% panel and
  // the equipment schedule. All values are the ones the diagram/lanes
  // already print (shared conductor authority) — the band displays, it
  // never re-derives.
  const BAND_TOP = CALC_Y;
  const BAND_BOT = H - MAR;
  const BGAP = 8;
  const BAND_H = BAND_BOT - BAND_TOP;
  const topH = Math.round(BAND_H * 0.54);
  const botH = BAND_H - topH - BGAP;
  const botY = BAND_TOP + topH + BGAP;
  // Cropped for E-1 (no title block) the sheet's frame closes 20 uu inside the
  // drawing area's right edge, and the right-hand column of tables ran across
  // it: every right-aligned value in the equipment schedule printed across the
  // frame line. The band ends inside the frame there.
  const BW = input.suppressTitleBlock ? Math.min(DW, effW - MAR/2 - 8 - DX) : DW;
  const W1 = Math.round(BW * 0.40);
  const W2 = Math.round(BW * 0.335);
  const W3 = BW - W1 - W2 - BGAP * 2;
  const X1 = DX, X2 = DX + W1 + BGAP, X3 = DX + W1 + W2 + BGAP * 2;
  // E-1.1: the one-line goes, and each table is collected to be stacked on the
  // schedules canvas (see below) instead of drawn in the band.
  type BandCols = Array<{ label: string; w: number; align?: 'start' | 'middle' | 'end' }>;
  type BandOpts = { rowH?: number; foot?: string; cellSz?: number };
  const bandSpecs: Array<{ key: string; title: string; cols: BandCols; rows: string[][]; opts: BandOpts }> = [];
  if (bandOnly) parts.splice(_topoStart);
  const placeTable = (key: string, x: number, y: number, w: number, h: number,
      title: string, cols: BandCols, rows: string[][], opts: BandOpts) => {
    if (bandOnly) bandSpecs.push({ key, title, cols, rows, opts });
    else parts.push(bandTable(x, y, w, h, title, cols, rows, opts));
  };

  // ── T1: CONDUIT AND CONDUCTOR SCHEDULE (tag ⇄ hexagon markers) ──────────
  const t1cols = [
    { label: 'TAG', w: 0.055, align: 'middle' as const },
    { label: 'DESCRIPTION', w: 0.375 },
    { label: 'WIRE GAUGE', w: 0.155 },
    { label: '# OF CONDUCTORS', w: 0.175 },
    { label: 'CONDUIT TYPE', w: 0.15 },
    { label: 'SIZE', w: 0.09, align: 'middle' as const },
  ];
  const t1rows: string[][] = condTagRows.flatMap(t => [
    [t.tag, (t.runId ? t.runId + ' · ' : '') + t.desc, t.gauge + ' ' + t.insul, t.nCond, t.conduitType, t.conduitSize],
    [t.tag, 'EQUIPMENT GROUNDING CONDUCTOR (EGC)',
      t.egc + (t.insul === 'PV WIRE' ? ' BARE CU' : ' THWN-2'), '1',
      t.conduitType, t.conduitSize],
  ]);
  // Engine RunSegments not already carried by a tag row print once each — the
  // run-id detail (R:/G:/F: namespacing) the schedule always exposed.
  {
    const _usedRunIds = new Set(condTagRows.map(t => t.runId).filter(Boolean) as string[]);
    const _allRuns: Array<{ r: RunSegment; pid: string }> = (input.runs && input.runs.length > 0)
      ? input.runs.map(r => ({ r, pid: prettyRunId(String(r.id)) }))
      : lanes.flatMap(b => (b.runs ?? []).map(r => ({ r, pid: prettyRunId(`${b.key}:${String(r.id)}`) })));
    for (const { r, pid } of _allRuns) {
      if (String(r.id).endsWith('MSP_TO_UTILITY_RUN') || _usedRunIds.has(pid)) continue;
      _usedRunIds.add(pid);
      t1rows.push([
        '·', `${pid} — ${r.from} → ${r.to}`,
        `${r.wireGauge} ${r.insulation}`,
        String(r.conductorCount ?? '—'),
        r.isOpenAir ? 'N/A — FREE AIR' : (r.conduitType ?? 'EMT'),
        r.isOpenAir ? 'N/A' : (r.conduitSize ?? '—'),
      ]);
    }
  }
  const _t1RowH = Math.max(11.5, Math.min(17, (topH - 46) / Math.max(t1rows.length, 1)));
  placeTable('t1', X1, BAND_TOP, W1, topH, 'CONDUIT AND CONDUCTOR SCHEDULE', t1cols, t1rows,
    { rowH: _t1RowH, cellSz: _t1RowH >= 14 ? 7 : 6.3,
      foot: 'Tag markers on diagram · gauges/OCPDs per shared conductor authority (matches PV-4A / PV-4B) · conduit trade size per NEC Annex C (conservative)' });

  // ── T2: SYSTEM SUMMARY (PER CIRCUIT) — one column per PV source ─────────
  const _lw = 0.32;
  const t2cols = [
    { label: 'SYSTEM SUMMARY', w: _lw },
    ...laneInfos.map(li => ({ label: 'PV-' + li.tag, w: (1 - _lw) / Math.max(laneInfos.length, 1), align: 'middle' as const })),
  ];
  const t2rows: string[][] = [
    ['CIRCUIT TOPOLOGY', ...laneInfos.map(li => li.topo === 'MICRO' ? 'MICROINVERTER' : li.topo === 'OPTIMIZER' ? 'STRING + OPT' : 'STRING INV')],
    ['NO. OF MODULES', ...laneInfos.map(li => String(li.modules))],
    ['STRINGS / AC BRANCHES', ...laneInfos.map(li => String(li.nCircuits))],
    ['MODULES PER STRING/BRANCH', ...laneInfos.map(li => li.perCircuit)],
    ['MODULE Isc', ...laneInfos.map(li => li.isc ? li.isc.toFixed(2) + ' A' : '—')],
    ['MODULE Voc', ...laneInfos.map(li => li.voc ? li.voc.toFixed(2) + ' V' : '—')],
    ['ARRAY STC POWER', ...laneInfos.map(li => li.watts ? (li.modules * li.watts).toLocaleString() + ' W' : '—')],
    ['MAX AC CURRENT', ...laneInfos.map(li => li.acAmps.toFixed(1) + ' A')],
    ['MAX AC POWER', ...laneInfos.map(li => li.acKw ? Math.round(li.acKw * 1000).toLocaleString() + ' W' : '—')],
    ['AC FEEDER / OCPD', ...laneInfos.map(li => li.feederGauge + ' / ' + li.ocpd + ' A')],
    ['EGC — NEC 250.122', ...laneInfos.map(li => li.egc)],
    // A standalone gateway is its own piece of equipment on the diagram, so
    // the schedule lists it (the single-lane sheet's rule) — here, per source,
    // because each lane has its own. Only when one is drawn.
    ...(laneMeters.some(m => m?.sg)
      ? [['STANDALONE GATEWAY', ...lanes.map((_, i) => laneMeters[i]?.sg ? esc(laneMeters[i]!.sg!.label) : '—')]]
      : []),
  ];
  placeTable('t2', X2, BAND_TOP, W2, topH, 'SYSTEM SUMMARY ( PER CIRCUIT )', t2cols, t2rows,
    { rowH: Math.min(25, (topH - 46) / t2rows.length), cellSz: 7.2,
      foot: 'Per sub-system values — shared conductor authority (identical to E-1 lanes / PV-4A / PV-4B)' });

  // ── T3a: DESIGN TEMPERATURES ─────────────────────────────────────────────
  const _dt = input.designTemps;
  const _tMin = input.designTempMin ?? _dt?.ashraeExtremeLowC ?? -25;
  const _tHigh = _dt?.ashrae2pctHighC ?? 38;
  const T3A_H = 76;
  placeTable('t3a', X3, BAND_TOP, W3, T3A_H, 'DESIGN TEMPERATURES',
    [{ label: 'PARAMETER', w: 0.64 }, { label: 'VALUE', w: 0.36, align: 'end' as const }],
    [
      ['ASHRAE EXTREME LOW', _tMin + '°C'],
      ['ASHRAE 2% HIGH', _tHigh + '°C'],
    ],
    { rowH: 15, foot: _dt?.source ?? 'ASHRAE climatic design data' });

  // ── T3b: MAX SYSTEM VOLTAGE — NEC 690.7(A) (corrected @ extreme low) ─────
  const t3bRows: string[][] = laneInfos.map(li => {
    if (li.topo === 'MICRO') return ['PV-' + li.tag, 'AC MODULE-LEVEL — NO DC STRING (240 V AC)', 'N/A', '✓'];
    if (!(li.pps > 0) || !(li.voc > 0)) return ['PV-' + li.tag, 'STRING Voc UNRESOLVED — SEE PV-4B', '—', '—'];
    const beta = li.coeff ?? -0.28;
    const maxV = li.pps * li.voc * (1 + (beta / 100) * (_tMin - 25));
    return [
      'PV-' + li.tag,
      li.pps + ' × ' + li.voc.toFixed(1) + 'V × (1+(' + beta.toFixed(2) + '%)(' + _tMin + '−25))' + (li.coeff == null ? ' *' : ''),
      maxV.toFixed(0) + ' V',
      maxV <= 600 ? '≤600 ✓' : '>600 ✗',
    ];
  });
  // Content-sized: the right column stacks DESIGN TEMPS → MAX VOLTAGE →
  // EQUIPMENT SCHEDULE with no dead space (equipment absorbs the remainder).
  const T3B_H = 30 + t3bRows.length * 16 + 18;
  placeTable('t3b', X3, BAND_TOP + T3A_H + BGAP, W3, T3B_H,
    'MAX SYSTEM VOLTAGE — NEC 690.7(A)',
    [
      { label: 'CIRCUIT', w: 0.14 },
      { label: 'Voc × TEMP CORR @ EXTREME LOW', w: 0.54 },
      { label: 'MAX V', w: 0.16, align: 'end' as const },
      { label: 'LIMIT', w: 0.16, align: 'middle' as const },
    ], t3bRows,
    { rowH: 16, cellSz: 6.6,
      foot: '* βVoc −0.28%/°C assumed (conservative mono-Si) where datasheet coefficient unresolved — field verify' });

  // ── B1: MAX VOLTAGE DROP CALCULATION ─────────────────────────────────────
  const b1cols = [
    { label: 'TAG', w: 0.055, align: 'middle' as const },
    { label: 'CABLE', w: 0.10 },
    { label: 'DESCRIPTION', w: 0.365 },
    { label: 'ONE-WAY FT', w: 0.10, align: 'end' as const },
    { label: 'CURRENT', w: 0.10, align: 'end' as const },
    { label: 'R Ω/kFT', w: 0.09, align: 'end' as const },
    { label: 'VD %', w: 0.085, align: 'end' as const },
    { label: 'CHK', w: 0.105, align: 'middle' as const },
  ];
  const b1rows: string[][] = condTagRows.map(t => {
    const L = t.lenFt ?? 25;
    const R = rPerKft(t.gauge);
    const vd = (2 * L * t.currentA * R) / 1000;
    const pct = t.baseVolts > 0 && t.currentA > 0 ? (vd / t.baseVolts) * 100 : 0;
    return [
      t.tag, t.gauge, t.desc,
      String(L) + (t.lenFt == null ? ' *' : ''),
      t.currentA > 0 ? t.currentA.toFixed(1) + ' A' : '—',
      R.toFixed(3),
      t.currentA > 0 ? pct.toFixed(2) + '%' : '—',
      t.currentA > 0 ? (pct <= 3 ? '✓' : '✗ REVIEW') : '—',
    ];
  });
  const _b1RowH = Math.max(11.5, Math.min(22, (botH - 46) / Math.max(b1rows.length, 1)));
  placeTable('b1', X1, botY, W1, botH, 'MAX VOLTAGE DROP CALCULATION', b1cols, b1rows,
    { rowH: _b1RowH, cellSz: _b1RowH >= 14 ? 7 : 6.3,
      foot: '* one-way length assumed — field verify · R per NEC Ch.9 Table 8 (Cu, stranded) · VD% = 2·L·I·R / (1000·Vbase) · DC rows use string Voc base' });

  // ── B2: POINT OF INTERCONNECTION — NEC 705.12(B) (ONE 120% check — I-6) ──
  const _busAmps = input.panelBusRating ?? input.mainPanelAmps;
  const _batBfA = input.batteryBackfeedA ?? 0;
  const _busLimit = _busAmps * 1.2;
  // totalBackfeedAmps is already the authoritative TOTAL (incl. battery —
  // see contract above); the battery row below is informational only.
  const _120pass = isSupplySide ? true : (input.poiRulePasses ?? (_busLimit >= input.mainPanelAmps + totalBackfeedAmps));
  const p2rows: string[][] = [
    ['Total AC Output', totalAcKw.toFixed(2) + ' kW / ' + Math.round(totalAcKw*1000/240) + ' A'],
    ...lanes.map((b): string[] => ['PV-' + LANE_TAG[b.key] + ' Backfeed', laneBackfeed(b) + ' A']),
    ...(_batBfA > 0 ? [['Battery Backfeed (incl.)', _batBfA + ' A']] : []),
    ['Σ Backfeed (per-inverter OCPDs)', totalBackfeedAmps + ' A'],
    ['Main Breaker', input.mainPanelAmps + ' A'],
    ['Bus Rating', _busAmps + ' A'],
    ...(isSupplySide ? [
      ['Interconnection', 'Supply Side Tap — NEC 705.11'],
      ['120% Rule', 'N/A — Supply Side'],
    ] : [
      ['Bus 120% Limit', _busLimit.toFixed(0) + ' A'],
      ['120% Rule', _120pass ? 'PASS ✓' : 'FAIL ✗'],
    ]),
    ['Basis', 'Σ per-inverter rounded OCPDs'],
    // The site's consumption CTs — the single-lane schedule's row, the
    // composer's words verbatim. It sits HERE, with the service it measures,
    // because the equipment schedule's value column runs past E-1's border
    // (every value there crosses the frame line on the permit embed), and the
    // composer's longest value (450 uu) needs this table's width.
    ...consumptionCtScheduleRows(consMeter?.md),
  ];
  // With that row, the value column takes the width: the longest parameter
  // ('Σ Backfeed (per-inverter OCPDs)') is 135 uu of the 157 left to it.
  const _p2HasCt = !!consMeter?.md?.scheduleRow;
  placeTable('b2', X2, botY, W2, botH, 'POINT OF INTERCONNECTION — NEC 705.12(B)',
    _p2HasCt
      ? [{ label: 'PARAMETER', w: 0.24 }, { label: 'VALUE', w: 0.76, align: 'end' as const }]
      : [{ label: 'PARAMETER', w: 0.55 }, { label: 'VALUE', w: 0.45, align: 'end' as const }],
    p2rows, { rowH: Math.min(22, (botH - 34) / p2rows.length), cellSz: 7.2 });

  // ── B3: EQUIPMENT SCHEDULE (shared POI gear once — I-6) ──────────────────
  // Lives in the RIGHT column under the max-voltage table and absorbs the
  // remaining band height — no dead space in the column stack.
  const p3rows: string[][] = [
    // The module named as its lane names it on the drawing (a lane with no
    // model printed '12 × ' here — a cell that reads as cut off).
    ...lanes.map((b, i): string[] => ['PV-' + LANE_TAG[b.key] + ' Modules', (b.totalModules ?? 0) + ' × ' + laneFacts[i].panelModel]),
    ...lanes.map((b, i): string[] => ['PV-' + LANE_TAG[b.key] + ' Inverter', ((b.inverterManufacturer ?? '') + ' ' + (b.inverterModel ?? '')).trim() + (geoms[i].topo === 'MICRO' ? ' ×' + (b.deviceCount ?? b.totalModules ?? 0) : (b.inverterCount && b.inverterCount > 1 ? ' ×' + b.inverterCount : ''))]),
    ['System Size (DC)', dcKw.toFixed(2) + ' kW — ' + totalModules + ' modules'],
    ['System Size (AC)', totalAcKw.toFixed(2) + ' kW'],
    ['AC Combiner Panel', (acCollection.sharedPanel?.busbarA ?? totalBackfeedAmps) + ' A busbar'],
    ['System AC Disconnect', acCollection.disconnectA + ' A — NEC 690.13'],
    ['System EGC', input.egcGauge ?? getEGCSize(acCollection.disconnectA)],
    ['Main Panel', input.mainPanelAmps + ' A'],
    ['Utility', esc(input.utilityName)],
    ['Interconnection', esc(input.interconnection)],
    ['Battery Storage', input.hasBattery ? esc(input.batteryModel || input.batteryBrand || 'YES') : 'NONE'],
    ...(input.hasBattery ? [['Battery Capacity', batteryCapacityCell(input.batteryKwh, input.batteryKwhLabel)]] : []),
  ];
  const _eqY = BAND_TOP + T3A_H + BGAP + T3B_H + BGAP;
  const _eqH = BAND_BOT - _eqY;
  placeTable('b3', X3, _eqY, W3, _eqH, 'EQUIPMENT SCHEDULE',
    [{ label: 'ITEM', w: 0.38 }, { label: 'SPECIFICATION', w: 0.62, align: 'end' as const }],
    p3rows, { rowH: Math.min(24, (_eqH - 34) / p3rows.length), cellSz: 7 });

  // ── E-1.1: the same seven tables, stacked in two columns on the schedules
  //    canvas — the conductor schedule, the voltage drop and the max system
  //    voltage (the wide ones) left; the per-source summary, the POI check, the
  //    design temperatures and the equipment schedule right. Each column pitches
  //    its rows alike (15 uu, closing to LBL_PITCH when a column is long) and
  //    each table is as tall as its rows — stretched to the foot of the sheet,
  //    a three-row table was a tall ruled box of nothing. ─────────────────────
  if (bandOnly) {
    const SX0 = MAR, SX1 = STACK_W - MAR, SY0 = MAR, SY1 = STACK_H - MAR;
    const WL = Math.round((SX1 - SX0 - BGAP) * 0.52), WR = SX1 - SX0 - BGAP - WL;
    const tableChrome = (o: BandOpts) => 16 + 14 + 1.5 + 4 + (o.foot ? 12 : 0);   // see bandTable
    const stack = (keys: string[], x: number, w: number) => {
      const specs = keys.map(k => bandSpecs.find(s => s.key === k)).filter((s): s is typeof bandSpecs[number] => !!s);
      const avail = SY1 - SY0 - BGAP * (specs.length - 1);
      const nRows = specs.reduce((n, s) => n + Math.max(1, s.rows.length), 0);
      const chrome = specs.reduce((n, s) => n + tableChrome(s.opts), 0);
      const rh = Math.max(LBL_PITCH, Math.min(15, (avail - chrome) / Math.max(nRows, 1)));
      let y = SY0;
      specs.forEach(s => {
        const h = Math.min(tableChrome(s.opts) + Math.max(1, s.rows.length) * rh, SY1 - y);
        parts.push(bandTable(x, y, w, h, s.title, s.cols, s.rows, { ...s.opts, rowH: rh }));
        y += h + BGAP;
      });
    };
    stack(['t1', 'b1', 't3b'], SX0, WL);
    stack(['t2', 'b2', 't3a', 'b3'], SX0 + WL + BGAP, WR);
  }

  // ── Artifact version stamp + title block ─────────────────────────────────
  parts.push(`<!-- ${getBuildBadge()} | SLD MULTI-LANE wave5a lanes=${lanes.length} keys=${lanes.map(l => l.key).join('+')} -->`);
  if (input.suppressTitleBlock) {
    parts.push('</svg>');
    return applyTypeFloor(parts.join('\n'));
  }
  // The lanes are joined without spaces: with three lanes, 'HYBRID
  // MULTI-SOURCE (PV-R + PV-G + PV-F)' is 191 uu at the printed size and its
  // title-block cell holds 186 — it ran through the block's right edge.
  parts.push(titleBlockSvg(
    { ...input, topologyType: `HYBRID MULTI-SOURCE (${lanes.map(l => `PV-${LANE_TAG[l.key]}`).join('+')})` },
    dcKw,
  ));
  parts.push('</svg>');
  // Same floor on the hybrid path — it starts SMALLER than single-lane, not
  // larger, so omitting it here would leave the worst sheets unimproved.
  return applyTypeFloor(parts.join('\n'));
}
