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
