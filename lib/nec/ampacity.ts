/**
 * lib/nec/ampacity.ts
 *
 * NEC 310.16 — COPPER CONDUCTOR AMPACITY. ONE TABLE.
 *
 * 🚨 WHY THIS EXISTS — TWO COPIES OF ONE NEC TABLE DISAGREED, AND THE WRONG COPY
 * PICKED THE CONDUCTOR.
 *
 * The 90 °C column existed twice:
 *
 *   lib/computed-system.ts   AMPACITY_TABLE_90C   '#1 AWG': 145   ← correct
 *   lib/segment-schedule.ts  AMPACITY_90C         '#1 AWG': 150   ← wrong
 *
 * Every other row was identical, so this was a single-row transcription slip, not a
 * different basis — and the slipped value is exactly 1/0's 75 °C ampacity, which sits
 * one row down and one column left in the printed table.
 *
 * It mattered because the two copies had different jobs:
 *
 *   • segment-schedule's table SELECTS THE INSTALLED CONDUCTOR. `autoSizeGauge` walks
 *     the AWG order and returns the first gauge whose derated ampacity clears
 *     `continuousCurrent × 1.25`, and `buildSegmentSchedule` — called in
 *     computed-system as "the single source of truth for ALL wiring" — back-populates
 *     the conductor callout onto every run segment. That is what PV-4B and E-1 print.
 *
 *   • computed-system's table PRINTS THE DERIVATION. `ampacityTable90C()` feeds
 *     `projectAmpacityAdjustment`, and E-1 renders it verbatim: "base 145 (90 °C col.,
 *     310.16) … Corrected ampacity 145 × 1.00 × 0.87 = 126.15 … FINAL ALLOWABLE".
 *
 * So one number chose the wire and a different number was published as the arithmetic
 * proving that choice. On a hot-ambient feeder (43 °C ⇒ 0.87, three CCC ⇒ 1.00) the
 * sizer accepted #1 AWG at 150 × 0.87 = 130.5 A while the sheet beside it printed a
 * FINAL ALLOWABLE of 126.15 A — and graded it FAIL. In the window where the required
 * continuous current lands between those two figures, the package installs #1 AWG
 * where NEC 310.16 with 110.14(C) requires #1/0.
 *
 * 🚨 AND A COMMENT ASSERTED THIS COULD NOT HAPPEN. computed-system.ts carried
 * "No logic is duplicated: each accessor delegates to the module-private table /
 * factor the wire-sizer already uses, so E-1's ampacity evidence and the sizer can
 * never disagree." True of computed-system's own `autoSizeWire`. False of the
 * segment-schedule sizer that actually owns the callout — which is the one that
 * matters, and the one the sentence was read as covering.
 *
 * The values below are NEC 310.16, copper, 60/75/90 °C columns. The 90 °C column is
 * used for the derating arithmetic and the 75 °C column caps the result under
 * 110.14(C) terminal ratings; both live here so a fix to either lands once.
 *
 * 🚨 DO NOT ADD A FOURTH COPY. If a module needs an ampacity, it imports it from
 * here. `tests/necAmpacityIsSingleSourced.test.ts` fails when a table literal with
 * these values reappears anywhere in lib/.
 */

/** The gauges this table covers, smallest to largest. Canonical `#`-prefixed spelling. */
export const NEC_AWG_ORDER = [
  '#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG', '#4 AWG',
  '#3 AWG', '#2 AWG', '#1 AWG', '#1/0 AWG', '#2/0 AWG', '#3/0 AWG', '#4/0 AWG',
] as const;

export type NecGauge = (typeof NEC_AWG_ORDER)[number];

/** NEC 310.16 — copper, 60 °C column (TW, UF). */
export const NEC_310_16_COPPER_60C: Record<string, number> = {
  '#14 AWG': 15, '#12 AWG': 20, '#10 AWG': 30, '#8 AWG': 40,
  '#6 AWG': 55, '#4 AWG': 70, '#3 AWG': 85, '#2 AWG': 95,
  '#1 AWG': 110, '#1/0 AWG': 125, '#2/0 AWG': 145,
  '#3/0 AWG': 165, '#4/0 AWG': 195,
};

/** NEC 310.16 — copper, 75 °C column (THWN-2 terminals, the 110.14(C) cap). */
export const NEC_310_16_COPPER_75C: Record<string, number> = {
  '#14 AWG': 20, '#12 AWG': 25, '#10 AWG': 35, '#8 AWG': 50,
  '#6 AWG': 65, '#4 AWG': 85, '#3 AWG': 100, '#2 AWG': 115,
  '#1 AWG': 130, '#1/0 AWG': 150, '#2/0 AWG': 175,
  '#3/0 AWG': 200, '#4/0 AWG': 230,
};

/**
 * NEC 310.16 — copper, 90 °C column (USE-2 / PV Wire / THWN-2 insulation).
 *
 * 🚨 `'#1 AWG'` IS 145, NOT 150. 150 is 1/0's 75 °C value — one row down, one column
 * left — and copying it here is the defect this module exists to end.
 */
export const NEC_310_16_COPPER_90C: Record<string, number> = {
  '#14 AWG': 25, '#12 AWG': 30, '#10 AWG': 40, '#8 AWG': 55,
  '#6 AWG': 75, '#4 AWG': 95, '#3 AWG': 115, '#2 AWG': 130,
  '#1 AWG': 145, '#1/0 AWG': 170, '#2/0 AWG': 195,
  '#3/0 AWG': 225, '#4/0 AWG': 260,
};

/**
 * NEC 310.15(B)(1) — AMBIENT TEMPERATURE CORRECTION, 90 °C column.
 *
 * 🚨 THERE WERE THREE OF THESE, AND ONE DISAGREED WITH THE OTHER TWO BY A THIRD.
 * `lib/computed-system.ts` and `lib/segment-schedule.ts` carried identical ladders;
 * `lib/segment-builder.ts` carried a per-degree map covering only 26–50 °C, returning
 * 0.64 at 43 °C where the others return 0.87, and falling back to 0.41 for ANY ambient
 * outside that window — so a 20 °C design, whose correct 90 °C factor is 1.08, got
 * 0.41. That is not a rounding difference; it is a different column.
 *
 * segment-builder's sizing output is consumed by nothing today (`segments`,
 * `segmentIssues` and `segmentInterconnectionPass` leave `computeSystem` and no sheet,
 * route, component or test reads them), so nothing shipped wrong because of it. It was
 * a loaded gun: a third conductor-sizing authority, one wiring change from being
 * believed. The ampacity table two functions up had exactly this shape and DID reach
 * the conductor schedule.
 */
export function necAmbientCorrection90C(ambientC: number): number {
  if (ambientC <= 10) return 1.15;
  if (ambientC <= 15) return 1.12;
  if (ambientC <= 20) return 1.08;
  if (ambientC <= 25) return 1.04;
  if (ambientC <= 30) return 1.00;
  if (ambientC <= 35) return 0.96;
  if (ambientC <= 40) return 0.91;
  if (ambientC <= 45) return 0.87;
  if (ambientC <= 50) return 0.82;
  if (ambientC <= 55) return 0.76;
  if (ambientC <= 60) return 0.71;
  // 🚨 THE TOP OF THE TABLE, WHICH TWO OF THE FOUR COPIES DID NOT HAVE.
  //
  // computed-system's and segment-schedule's ladders both stopped at 60 °C and returned
  // a flat 0.58 above it. The real 90 °C column keeps falling: 0.65, 0.58, 0.50, 0.41,
  // 0.29. So at 78 °C they applied 0.58 where the code requires 0.41 — LESS conservative
  // than NEC, on the hot-rooftop end, which is exactly where a PV conductor lives.
  // `lib/manufacturer-specs.ts` had these rows and was right here; it was missing the
  // BELOW-30 rows instead and returned 1.00 where the table allows up to 1.15. Neither
  // copy was the table. This is.
  if (ambientC <= 65) return 0.65;
  if (ambientC <= 70) return 0.58;
  if (ambientC <= 75) return 0.50;
  if (ambientC <= 80) return 0.41;
  return 0.29;
}

/**
 * NEC 310.15(C)(1) — ADJUSTMENT FOR MORE THAN THREE CURRENT-CARRYING CONDUCTORS.
 *
 * Also had three copies, and segment-builder's also disagreed: it stepped to 0.50 at
 * ≤12 and 0.45 at ≤20, where the code table holds 0.50 through 20. Between 13 and 20
 * conductors the two answers differ by a tenth of the conductor's ampacity.
 */
export function necConductorCountAdjustment(currentCarryingCount: number): number {
  if (currentCarryingCount <= 3) return 1.00;
  if (currentCarryingCount <= 6) return 0.80;
  if (currentCarryingCount <= 9) return 0.70;
  if (currentCarryingCount <= 20) return 0.50;
  if (currentCarryingCount <= 30) return 0.45;
  if (currentCarryingCount <= 40) return 0.40;
  return 0.35;
}

/**
 * Look a gauge up, tolerating the `1/0 AWG` spelling some callers use for the
 * aught sizes. Returns `undefined` for a gauge outside the table rather than 0 —
 * a 0 ampacity silently fails every comparison it takes part in.
 */
export function necAmpacity(
  table: Record<string, number>,
  gauge: string,
): number | undefined {
  if (gauge in table) return table[gauge];
  const hashed = gauge.startsWith('#') ? gauge : `#${gauge}`;
  return table[hashed];
}
