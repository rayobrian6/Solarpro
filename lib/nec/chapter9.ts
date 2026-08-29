// ═══════════════════════════════════════════════════════════════════════════
// NEC CHAPTER 9 — THE ONE RACEWAY-FILL AUTHORITY
//
// ── WHAT WAS HERE BEFORE ──────────────────────────────────────────────────
// Five independent conduit-area tables and five independent conductor-area
// sources, of which exactly one was both correct and correctly applied:
//
//   lib/computed-system.ts:682   CONDUIT_40PCT_AREA   — the SELECTION threshold,
//       written as `X * 0.40` where X is ALREADY the NEC 40% column. Every entry
//       was therefore 16% of the true interior (0.40 × 0.40), so a raceway was
//       only accepted when the bundle fitted in a sixth of it — over-sizing
//       conduit by roughly two trade sizes on every job.
//   lib/computed-system.ts:716   CONDUIT_FULL_AREA    — the FILL DENOMINATOR,
//       commented "Full conduit areas (100%)" and populated with the 40% column,
//       so every printed fill percentage was 2.5× the truth. The audited package
//       printed 29.0% where the real figure is 13.5%.
//   lib/segment-schedule.ts:191  a byte-identical copy of the same wrong table —
//       and the one that actually produced the numbers on the sheets.
//   lib/segment-builder.ts:61    a type-BLIND table (one column for EMT, PVC 40
//       and PVC 80 alike) that also drifts from the code: 2-1/2" at 4.860 where
//       EMT is 5.858, 3" at 7.928 where EMT is 8.846.
//   lib/equipment-db.ts:2460     the only correct data — and incomplete: no PVC
//       Sch 80 rows at all, nothing above 2", no RMC, no FMC. So a PVC Sch 80
//       project found nothing, reported 100% fill, raised E-CONDUIT-FILL, and the
//       autosizer fell back to a hardcoded 3/4".
//
// And the UI offers "PVC Schedule 80" / "Rigid Metal (RMC)" / "Flexible Metal
// (FMC)" while every table is keyed "PVC Sch 80" — so a key miss fell back to the
// EMT column and the sheet printed a PVC raceway whose fill was computed against
// steel. That is the live 23.4%.
//
// ── THE RULE ──────────────────────────────────────────────────────────────
// Table 4 holds TOTAL areas. Table 1 holds the ALLOWABLE FILL as a percentage of
// that total — 53% for one conductor, 31% for two, 40% for more. Those are two
// different numbers and the code must never store one under the other's name.
// Everything below is the published table; the percentage is applied at the point
// of use, where it can be seen.
//
// Source: NFPA 70 (NEC) 2020, Chapter 9, Tables 1, 4 and 5.
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical conduit-type keys. Every consumer resolves to one of these. */
export type ConduitType = 'EMT' | 'PVC Sch 40' | 'PVC Sch 80' | 'RMC' | 'FMC';

export const CONDUIT_TRADE_SIZES = [
  '1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"', '3-1/2"', '4"',
] as const;
export type ConduitTradeSize = (typeof CONDUIT_TRADE_SIZES)[number];

/**
 * NEC Chapter 9, Table 4 — TOTAL internal area (100%), in².
 * These are the published areas, not a fill allowance. Compare a conductor
 * bundle against `conduitAllowableFillIn2()`, never against these directly.
 */
export const CONDUIT_TOTAL_AREA_IN2: Record<ConduitType, Partial<Record<ConduitTradeSize, number>>> = {
  'EMT': {
    '1/2"': 0.304, '3/4"': 0.533, '1"': 0.864, '1-1/4"': 1.496, '1-1/2"': 2.036,
    '2"': 3.356, '2-1/2"': 5.858, '3"': 8.846, '3-1/2"': 11.545, '4"': 14.753,
  },
  'PVC Sch 40': {
    '1/2"': 0.285, '3/4"': 0.508, '1"': 0.832, '1-1/4"': 1.453, '1-1/2"': 1.986,
    '2"': 3.291, '2-1/2"': 4.695, '3"': 7.268, '3-1/2"': 9.737, '4"': 12.554,
  },
  'PVC Sch 80': {
    '1/2"': 0.217, '3/4"': 0.409, '1"': 0.688, '1-1/4"': 1.237, '1-1/2"': 1.711,
    '2"': 2.874, '2-1/2"': 4.119, '3"': 6.442, '3-1/2"': 8.688, '4"': 11.258,
  },
  'RMC': {
    '1/2"': 0.314, '3/4"': 0.549, '1"': 0.887, '1-1/4"': 1.526, '1-1/2"': 2.071,
    '2"': 3.408, '2-1/2"': 4.866, '3"': 7.499, '3-1/2"': 10.010, '4"': 12.882,
  },
  'FMC': {
    '1/2"': 0.317, '3/4"': 0.533, '1"': 0.817, '1-1/4"': 1.277, '1-1/2"': 1.858,
    '2"': 3.269, '2-1/2"': 4.909, '3"': 7.069, '3-1/2"': 9.621, '4"': 12.566,
  },
};

/**
 * NEC Chapter 9, Table 5 — conductor cross-sectional area including insulation,
 * in², for THHN / THWN-2. Keyed by the AWG label this codebase already uses.
 */
export const CONDUCTOR_AREA_IN2: Record<string, number> = {
  '#14 AWG': 0.0097,
  '#12 AWG': 0.0133,
  '#10 AWG': 0.0211,
  '#8 AWG':  0.0366,
  '#6 AWG':  0.0507,
  '#4 AWG':  0.0824,
  '#3 AWG':  0.0973,
  '#2 AWG':  0.1158,
  '#1 AWG':  0.1562,
  '#1/0 AWG': 0.1855,
  '#2/0 AWG': 0.2223,
  '#3/0 AWG': 0.2679,
  '#4/0 AWG': 0.3237,
  '250 kcmil': 0.3970,
  '350 kcmil': 0.5242,
  '500 kcmil': 0.7073,
};

/** NEC Chapter 9, Table 1 — allowable fill as a percentage of total area. */
export function fillLimitPct(conductorCount: number): number {
  if (conductorCount <= 0) return 40;
  if (conductorCount === 1) return 53;
  if (conductorCount === 2) return 31;
  return 40;
}

/**
 * Resolve any conduit-type string this codebase or its UI produces to a canonical
 * key. The UI dropdown offers "PVC Schedule 80" / "Rigid Metal (RMC)" / "Flexible
 * Metal (FMC)" while every table was keyed "PVC Sch 80" — the miss fell through
 * to the EMT column, so a sheet could print a PVC raceway whose fill had been
 * computed against steel. Returns null rather than guessing: a type nobody
 * recognises must not silently become EMT.
 */
export function normalizeConduitType(raw: string | null | undefined): ConduitType | null {
  const s = String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return null;
  if (s.includes('emt') || s.includes('electricalmetallic')) return 'EMT';
  if (s.includes('flexible') || s === 'fmc' || s.includes('flexiblemetal')) return 'FMC';
  // PVC: schedule 80 before 40, and before the bare-PVC fallback.
  if (s.includes('pvc') || s.includes('rnc') || s.includes('nonmetallic')) {
    if (s.includes('80')) return 'PVC Sch 80';
    if (s.includes('40')) return 'PVC Sch 40';
    return 'PVC Sch 40';
  }
  if (s.includes('rmc') || s.includes('rigidmetal') || s.includes('rigid')) return 'RMC';
  if (s.includes('imc')) return 'RMC';
  return null;
}

/** Total interior area for a trade size, or null when the pair is not tabulated. */
export function conduitTotalAreaIn2(
  type: string | null | undefined, size: string | null | undefined,
): number | null {
  const t = normalizeConduitType(type);
  if (!t) return null;
  const a = CONDUIT_TOTAL_AREA_IN2[t][String(size) as ConduitTradeSize];
  return typeof a === 'number' ? a : null;
}

/** The allowable fill AREA (in²) for a trade size at the Table 1 percentage. */
export function conduitAllowableFillIn2(
  type: string | null | undefined, size: string | null | undefined, conductorCount: number,
): number | null {
  const total = conduitTotalAreaIn2(type, size);
  return total == null ? null : total * (fillLimitPct(conductorCount) / 100);
}

/** Table 5 area for one conductor, or null when the gauge is not tabulated. */
export function conductorAreaIn2(gauge: string | null | undefined): number | null {
  const g = String(gauge ?? '').trim();
  if (CONDUCTOR_AREA_IN2[g] != null) return CONDUCTOR_AREA_IN2[g];
  // tolerate '12 AWG', '#12', '12'
  const m = /(\d+\/?\d*)\s*(?:awg)?/i.exec(g.replace(/^#/, ''));
  if (m) {
    const k = `#${m[1]} AWG`;
    if (CONDUCTOR_AREA_IN2[k] != null) return CONDUCTOR_AREA_IN2[k];
  }
  return null;
}

export interface ConduitFill {
  conduitType: ConduitType | null;
  tradeSize: string | null;
  /** Table 4 total interior area. */
  totalAreaIn2: number | null;
  /** Σ Table 5 conductor areas. */
  conductorAreaIn2: number;
  /** conductorArea / totalArea × 100 — a TRUE fill percentage. */
  fillPct: number | null;
  /** the Table 1 limit that applies to this conductor count. */
  limitPct: number;
  withinLimit: boolean | null;
}

/**
 * THE fill computation. `fillPct` is a percentage of the TOTAL area, which is
 * what NEC Chapter 9 means by fill and what a plan reviewer will recompute.
 */
export function computeConduitFill(args: {
  conduitType: string | null | undefined;
  tradeSize: string | null | undefined;
  conductorAreaIn2: number;
  conductorCount: number;
}): ConduitFill {
  const t = normalizeConduitType(args.conduitType);
  const total = conduitTotalAreaIn2(args.conduitType, args.tradeSize);
  const limitPct = fillLimitPct(args.conductorCount);
  const fillPct = total != null && total > 0 ? (args.conductorAreaIn2 / total) * 100 : null;
  return {
    conduitType: t,
    tradeSize: args.tradeSize == null ? null : String(args.tradeSize),
    totalAreaIn2: total,
    conductorAreaIn2: args.conductorAreaIn2,
    fillPct,
    limitPct,
    withinLimit: fillPct == null ? null : fillPct <= limitPct,
  };
}

/**
 * The smallest trade size whose Table 1 allowance holds this bundle. Returns null
 * when the type is unknown or nothing in the table is large enough — never a
 * silent fallback, because a fallback is how a PVC Sch 80 run came to be sized as
 * 3/4" EMT.
 */
export function selectSmallestConduit(
  type: string | null | undefined, conductorAreaIn2Total: number, conductorCount: number,
): { tradeSize: ConduitTradeSize; totalAreaIn2: number; allowableIn2: number } | null {
  const t = normalizeConduitType(type);
  if (!t) return null;
  const limit = fillLimitPct(conductorCount) / 100;
  for (const size of CONDUIT_TRADE_SIZES) {
    const total = CONDUIT_TOTAL_AREA_IN2[t][size];
    if (typeof total !== 'number') continue;
    if (conductorAreaIn2Total <= total * limit) {
      return { tradeSize: size, totalAreaIn2: total, allowableIn2: total * limit };
    }
  }
  return null;
}
