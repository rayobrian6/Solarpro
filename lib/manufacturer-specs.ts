// ============================================================
// Manufacturer Specification Lookup Layer
// Typed helpers for deterministic engineering calculations
// All data sourced from equipment-db.ts — no hardcoded fallbacks
// ============================================================

import {
  selectSmallestConduit as necSelectSmallestConduit,
  normalizeConduitType as necNormalizeConduitType,
  conductorAreaIn2 as necConductorAreaIn2,
} from '@/lib/nec/chapter9';
import { necAmbientCorrection90C, necConductorCountAdjustment } from '@/lib/nec/ampacity';
import {
  SOLAR_PANELS,
  STRING_INVERTERS,
  MICROINVERTERS,
  CONDUCTORS,
  CONDUITS,
  SolarPanel,
  StringInverter,
  Microinverter,
  Conductor,
  Conduit,
} from './equipment-db';
// NEC Chapter 9 Table 8 — the ONE resistance source. Read through it rather than off
// the CONDUCTORS roster, so a gauge missing from that roster is a REFUSAL (null)
// instead of a fabricated zero resistance.
import { dcResistanceOhmsPerKft } from './nec/table8';

// ─── Panel Spec Lookup ────────────────────────────────────────────────────────

export function getPanelSpec(panelId: string): SolarPanel | null {
  return SOLAR_PANELS.find(p => p.id === panelId) ?? null;
}

export function getPanelSpecOrThrow(panelId: string): SolarPanel {
  const p = SOLAR_PANELS.find(p => p.id === panelId);
  if (!p) throw new Error(`Panel spec not found: ${panelId}`);
  return p;
}

// ─── Inverter Spec Lookup ─────────────────────────────────────────────────────

export function getStringInverterSpec(inverterId: string): StringInverter | null {
  return STRING_INVERTERS.find(i => i.id === inverterId) ?? null;
}

export function getMicroinverterSpec(inverterId: string): Microinverter | null {
  return MICROINVERTERS.find(i => i.id === inverterId) ?? null;
}

export function getInverterSpecOrThrow(inverterId: string, type: 'string' | 'micro' | 'optimizer'): StringInverter | Microinverter {
  if (type === 'micro') {
    const m = MICROINVERTERS.find(i => i.id === inverterId);
    if (!m) throw new Error(`Microinverter spec not found: ${inverterId}`);
    return m;
  }
  const s = STRING_INVERTERS.find(i => i.id === inverterId);
  if (!s) throw new Error(`String inverter spec not found: ${inverterId}`);
  return s;
}

// ─── Conductor Lookup ─────────────────────────────────────────────────────────

// AWG order from smallest to largest (for auto-sizing iteration)
// 🚨 THE AUTO-SIZE SEARCH ORDER. It stopped at #2/0, so lib/wire-autosizer.ts could
// not reach a larger conductor and fell through to a hard-coded '#2/0 AWG' flagged
// `ampacityPass: false, voltageDropPass: false` — selected AND failed. #3/0 and #4/0
// are added because their ABSENCE was the defect: they are the long service feeders
// this product exists to size, and no compliant answer existed above #2/0.
//
// 🚨 #3 AWG IS NOW IN, AND MY EARLIER REASONING FOR LEAVING IT OUT WAS WRONG.
// I had recorded this as a product ruling (R14: "does the sizing authority intend to
// select #3?"), on the grounds that Table 8 carrying its resistance is not a reason to
// recommend it. That framing was right, and the answer was still IN — because this
// product's sizing authorities ALREADY select #3, in four independent ladders:
//
//   lib/permit/utils/conductorAuthority.ts:182  `if (ocpdAmps <= 100) return '#3 AWG'`
//                                               — the permit sheet's conductor authority
//   lib/segment-schedule.ts:276-279             AWG_ORDER contains '#3 AWG' — and
//                                               lib/nec/ampacity.ts:60 calls that "the
//                                               sizer that ACTUALLY OWNS THE CALLOUT"
//   lib/computed-system.ts:603-607              AWG_ORDER contains '#3 AWG'
//   app/api/engineering/bom/route.ts:343        `if (ocpd <= 100) return '#3 AWG'`
//                                               — it already reaches a BOM
// plus lib/segment-schedule.ts:894 (service entrance) and this file's own AWG_UPSIZE
// at :295, which contains #3 for conduit-fill upsizing.
//
// So this file imported a #3-less ladder for the ampacity/voltage-drop search while
// carrying a #3-bearing one for conduit fill — one file, two ladders, disagreeing. That
// is an OUTPUT-CONSISTENCY violation, not a withheld decision.
//
// The "rarely stocked" argument cannot discriminate and that is itself an answer: the
// repo holds NO gauge-specific wire procurement data. DISTRIBUTOR_PRICE_CATALOG has
// exactly one wire SKU (BARE-CU-6, a #6 ground) and everything else prices off a flat
// $0.85/ft `wire` category fallback. There is no SKU for #4 or #2 either, so "not
// stocked" would exclude gauges that are already in this ladder.
//
// NEC 310.16 supports it in all three columns (60/75/90 °C = 85/100/115 A) and
// Chapter 9 Table 5 has its area. R14 is retired.
export const AWG_ORDER: string[] = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG',
  '#4 AWG', '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG',
  '#3/0 AWG', '#4/0 AWG',
];

export function getConductorSpec(gauge: string): Conductor | null {
  return CONDUCTORS.find(c => c.gauge === gauge) ?? null;
}

export function getNextLargerGauge(currentGauge: string): string | null {
  const idx = AWG_ORDER.indexOf(currentGauge);
  if (idx === -1 || idx >= AWG_ORDER.length - 1) return null;
  return AWG_ORDER[idx + 1];
}

export function getConductorByMinAmpacity(
  requiredAmpacity: number,
  ratingColumn: '60c' | '75c' | '90c' = '75c'
): Conductor | null {
  const col = `ampacity_${ratingColumn}` as keyof Conductor;
  // AWG_ORDER is smallest to largest — find first that meets requirement
  for (const gauge of AWG_ORDER) {
    const cond = CONDUCTORS.find(c => c.gauge === gauge);
    if (cond && (cond[col] as number) >= requiredAmpacity) return cond;
  }
  return null;
}

// ─── Conduit Lookup ───────────────────────────────────────────────────────────

export function getSmallestConduit(
  conduitType: string,
  totalFillAreaSqIn: number,
  conductorCount = 3,
): Conduit | null {
  // 2026-08-29 - SOURCED FROM NEC CHAPTER 9, not from the partial CONDUITS table.
  // That table held the only CORRECT areas in the repo and was missing the rows
  // that matter: no PVC Sch 80 at ALL, nothing above 2", no RMC, no FMC. Its
  // `c.type === conduitType` was also an exact string match, so the UI's
  // "PVC Schedule 80" found nothing - and a null here made electrical-calc report
  // conduitFillPercent = 100, raise E-CONDUIT-FILL on a perfectly sound raceway,
  // and the autosizer fall back to a hardcoded 3/4".
  const picked = necSelectSmallestConduit(conduitType, totalFillAreaSqIn, conductorCount);
  if (!picked) return null;
  const t = necNormalizeConduitType(conduitType) ?? conduitType;
  const total = picked.totalAreaIn2;
  return {
    id: `${String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${picked.tradeSize.replace(/[^0-9a-z]+/gi, '')}`,
    type: String(t),
    tradeSize: picked.tradeSize,
    innerDiameter: 2 * Math.sqrt(total / Math.PI),
    area: total,
    maxFillArea_1wire: total * 0.53,
    maxFillArea_2wire: total * 0.31,
    maxFillArea_3plus: total * 0.40,
  };
}

// ─── NEC Standard OCPD Sizes ─────────────────────────────────────────────────

// 🚨 DELEGATED — this was a SECOND full NEC 240.6 ladder, capped at 400 A with a
// `Math.ceil(amps / 10) * 10` tail. `sizeAcBranch().ocpdAmps` is the AC OCPD the
// engineering page's Electrical tab reports and the per-inverter / per-sub / POI
// aggregate value in lib/electrical-calc.ts, so above 400 A continuous (96 kW at
// 240 V, or any 208/480 V three-phase commercial design — Sungrow, SolarEdge,
// Fronius, Sol-Ark 30K-3P-208V) it returned a rating in 10 A steps that no
// manufacturer lists, while `totalInterconnectionBackfeedA` in the very same file
// rounded the same current to a real 240.6 size. The two then disagreed on one
// sheet, and the drawing called out a device that cannot be bought.
//
// Worse, lib/electrical-calc.ts imported BOTH ladders under names differing only in
// letter case — `nextStandardOCPD` here and `nextStandardOcpd` from stdSizes — so
// which answer a call site got depended on a capital letter.
//
// Same shape as getTempDeratingFactor and getConduitFillDeratingFactor below: the
// old name is kept as a re-export so no call site has to move, and there is now
// exactly one ladder.
export { NEC_STANDARD_OCPD as STANDARD_OCPD_SIZES } from './electrical/stdSizes';
export { nextStandardOcpd as nextStandardOCPD } from './electrical/stdSizes';

// ─── Temperature Derating (NEC Table 310.15(B)(2)(a)) ────────────────────────
// Based on 90°C rated conductors, 30°C ambient base

// 🚨 DELEGATED - this was the FOURTH copy of NEC 310.15(B)(1), and the four
// disagreed in two different places. This one had the rows ABOVE 60 °C, which
// computed-system's and segment-schedule's did not (they returned a flat 0.58 where
// the code requires 0.41 at 76-80 °C - less conservative than NEC on the hot-rooftop
// end). It was missing the rows BELOW 30 °C instead, returning 1.00 where the table
// allows up to 1.15. Neither was the table; lib/nec/ampacity.ts is.
export const getTempDeratingFactor = necAmbientCorrection90C;

// ─── Conduit Fill Derating (NEC 310.15(C)(1)) ────────────────────────────────

// Delegated for the same reason - see above. This copy happened to AGREE with the
// canonical ladder; segment-builder's did not.
export const getConduitFillDeratingFactor = necConductorCountAdjustment;

// ─── Grounding Conductor Sizing (NEC Table 250.122) ──────────────────────────

export function getEGCSize(ocpdAmps: number): string {
  if (ocpdAmps <= 15)  return '#14 AWG';
  if (ocpdAmps <= 20)  return '#12 AWG';
  if (ocpdAmps <= 60)  return '#10 AWG';
  if (ocpdAmps <= 100) return '#8 AWG';
  if (ocpdAmps <= 200) return '#6 AWG';
  if (ocpdAmps <= 300) return '#4 AWG';
  if (ocpdAmps <= 400) return '#3 AWG';
  if (ocpdAmps <= 500) return '#2 AWG';
  if (ocpdAmps <= 600) return '#1 AWG';
  return '#1/0 AWG';
}

// ─── Voltage Drop Calculation ─────────────────────────────────────────────────
// Returns voltage drop as a percentage
// VD% = (2 × I × R × L) / (V × 1000) × 100
// R = DC resistance in ohms/1000ft

/**
 * Voltage drop as a percentage, or **null** when the conductor's resistance cannot
 * be resolved.
 *
 * 🚨 IT USED TO RETURN 0 FOR AN UNRESOLVABLE GAUGE, and `0 <= anyLimit` is true, so
 * a conductor whose resistance was never looked up reported a PERFECT voltage drop.
 * That is a refusal converted into a pass — the most dangerous shape in this repo,
 * because every downstream check then agrees.
 *
 * The genuinely-zero-input guards below still return 0 and that is correct: no
 * current, no length or no voltage is a real zero drop, not an unresolved one. Only
 * an unknown CONDUCTOR is a refusal.
 */
export function calcVoltageDrop(
  currentAmps: number,
  onewayLengthFt: number,
  gauge: string,
  systemVoltage: number
): number | null {
  const r = dcResistanceOhmsPerKft(gauge);
  // null, not 0 — the caller must decide what to do with "not computed".
  if (r === null) return null;
  // FIX v57.1: Guard against NaN/0/Infinity inputs that cause NaN VDrop,
  // which then makes vdropPass = (NaN <= limit) = false, forcing #2/0 AWG fallback.
  if (!Number.isFinite(currentAmps) || currentAmps <= 0) return 0;
  if (!Number.isFinite(onewayLengthFt) || onewayLengthFt <= 0) return 0;
  if (!Number.isFinite(systemVoltage) || systemVoltage <= 0) return 0;
  const vd = (2 * currentAmps * r * onewayLengthFt) / 1000;
  return (vd / systemVoltage) * 100;
}

// ─── String Voc Temperature Correction (NEC 690.7) ───────────────────────────

export function calcStringVocCorrected(
  panelVoc: number,
  panelCount: number,
  tempCoeffVocPctPerC: number, // negative value e.g. -0.27
  designTempMinC: number
): number {
  // ΔV = Voc_STC × (tempCoeff/100) × (Tmin - 25)
  const tempDelta = designTempMinC - 25; // negative when cold
  const correctionFactor = 1 + (tempCoeffVocPctPerC / 100) * tempDelta;
  return panelVoc * panelCount * correctionFactor;
}

// ─── String Isc Temperature Correction (NEC 690.8) ───────────────────────────

export function calcStringIscCorrected(
  panelIsc: number,
  tempCoeffIscPctPerC: number, // positive value e.g. 0.05
  designTempMaxC: number,
  rooftopTempAdderC: number
): number {
  const hotTemp = designTempMaxC + rooftopTempAdderC;
  const correctionFactor = 1 + (tempCoeffIscPctPerC / 100) * (hotTemp - 25);
  return panelIsc * correctionFactor;
}

// ─── Conductor Wire Area (for conduit fill) ───────────────────────────────────

export function getConductorArea(gauge: string): number {
  // NEC Chapter 9 Table 5 IS the insulated conductor area, and it is what a plan
  // reviewer recomputes. Deriving it from the catalogue's outer diameter produced
  // a materially larger number, which then inflated every conduit-fill percentage
  // and drove needless upsizing. The geometric form survives only for a gauge
  // Table 5 does not tabulate.
  const tabulated = necConductorAreaIn2(gauge);
  if (tabulated != null) return tabulated;
  const cond = getConductorSpec(gauge);
  if (!cond) return 0;
  return Math.PI * Math.pow(cond.outerDiameter / 2, 2);
}