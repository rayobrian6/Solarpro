// ═══════════════════════════════════════════════════════════════════════════
// NEC Chapter 9, Table 8 — Conductor Properties. ONE copy.
//
// Circular mils and DC resistance (Ω per 1000 ft) for uncoated STRANDED COPPER at
// 75 °C, which is the column every voltage-drop calculation in this repo cites.
//
// 🚨 WHY THIS MODULE EXISTS. `lib/equipment-db.ts` CONDUCTORS — the roster that
// `getConductorSpec` and therefore `calcVoltageDrop` read — stopped at #2/0 AWG and
// SKIPPED #3 AWG entirely. `calcVoltageDrop` returned **0** for an unresolvable
// gauge, and `0 <= anyLimit` is true, so three selectable conductors silently
// reported a PERFECT voltage drop:
//
//   · a #3/0 or #4/0 AC service feeder, or a #3 AWG feeder, made
//     lib/electrical/routeLengthBound.ts return state 'unbounded', so
//     `designMaxOneWayFt` was never set, no "MAXIMUM ONE-WAY LENGTH n FT AT 3% Vd"
//     note printed, and the ROUTE-LENGTH-ESTIMATE requirement stayed BLOCKING — the
//     whole mechanism built to close a package without an attic walk failed for
//     exactly the three largest gauges the engine can select, which are precisely
//     the long service runs it was built for;
//   · a field measurement landing on such a run made routeVoltageDropRecalc return
//     null and flipped the sheet's voltage-drop cell to 'PENDING';
//   · `lib/wire-autosizer.ts` could not search past #2/0 and fell through to a
//     hard-coded '#2/0 AWG' with `ampacityPass: false, voltageDropPass: false` — a
//     conductor reported as SELECTED while flagged FAILED.
//
// Values are the published Table 8 rows. They are literals here on purpose: a
// resistance derived from another resistance is not a second source.
// ═══════════════════════════════════════════════════════════════════════════

export interface Table8Row {
  /** Area in circular mils (Table 8 column 'Area, cmil'). */
  circularMils: number;
  /** DC resistance, Ω per 1000 ft, uncoated stranded copper at 75 °C. */
  dcResistanceOhmsPerKft: number;
}

/**
 * NEC Chapter 9 Table 8 — uncoated stranded copper. Every row the table has in the
 * range this product designs in, including the three that were missing.
 */
export const NEC_TABLE_8_COPPER: Record<string, Table8Row> = {
  '#14 AWG':    { circularMils: 4110,   dcResistanceOhmsPerKft: 3.14   },
  '#12 AWG':    { circularMils: 6530,   dcResistanceOhmsPerKft: 1.98   },
  '#10 AWG':    { circularMils: 10380,  dcResistanceOhmsPerKft: 1.24   },
  '#8 AWG':     { circularMils: 16510,  dcResistanceOhmsPerKft: 0.778  },
  '#6 AWG':     { circularMils: 26240,  dcResistanceOhmsPerKft: 0.491  },
  '#4 AWG':     { circularMils: 41740,  dcResistanceOhmsPerKft: 0.308  },
  '#3 AWG':     { circularMils: 52620,  dcResistanceOhmsPerKft: 0.245  }, // was MISSING
  '#2 AWG':     { circularMils: 66360,  dcResistanceOhmsPerKft: 0.194  },
  '#1 AWG':     { circularMils: 83690,  dcResistanceOhmsPerKft: 0.154  },
  '#1/0 AWG':   { circularMils: 105600, dcResistanceOhmsPerKft: 0.122  },
  '#2/0 AWG':   { circularMils: 133100, dcResistanceOhmsPerKft: 0.0967 },
  '#3/0 AWG':   { circularMils: 167800, dcResistanceOhmsPerKft: 0.0766 }, // was MISSING
  '#4/0 AWG':   { circularMils: 211600, dcResistanceOhmsPerKft: 0.0608 }, // was MISSING
  '250 kcmil':  { circularMils: 250000, dcResistanceOhmsPerKft: 0.0515 },
  '300 kcmil':  { circularMils: 300000, dcResistanceOhmsPerKft: 0.0429 },
  '350 kcmil':  { circularMils: 350000, dcResistanceOhmsPerKft: 0.0367 },
  '400 kcmil':  { circularMils: 400000, dcResistanceOhmsPerKft: 0.0321 },
  '500 kcmil':  { circularMils: 500000, dcResistanceOhmsPerKft: 0.0258 },
};

/** Normalises '4/0', '#4/0 AWG', '250 KCMIL' etc. to a Table 8 key. */
function key(gauge: string | null | undefined): string | null {
  const raw = String(gauge ?? '').trim();
  if (!raw) return null;
  const kc = raw.match(/^(\d+)\s*(?:kcmil|mcm)$/i);
  if (kc) return `${Number(kc[1])} kcmil`;
  const k = `#${raw.replace(/^#/, '').replace(/\s*AWG$/i, '').trim()} AWG`;
  return Object.keys(NEC_TABLE_8_COPPER).find(x => x.toLowerCase() === k.toLowerCase()) ?? null;
}

/**
 * DC resistance in Ω/1000 ft for a conductor, or **null** when the gauge is not a
 * Table 8 row.
 *
 * 🚨 null, NEVER 0. A zero resistance yields a zero voltage drop, and a zero
 * voltage drop passes every limit — which is how an unresolvable conductor came to
 * report perfect compliance. A caller that cannot resolve a resistance has not
 * computed a voltage drop and must say so.
 */
export function dcResistanceOhmsPerKft(gauge: string | null | undefined): number | null {
  const k = key(gauge);
  return k ? NEC_TABLE_8_COPPER[k].dcResistanceOhmsPerKft : null;
}

/** Circular mils for a conductor, or null when the gauge is not a Table 8 row. */
export function circularMils(gauge: string | null | undefined): number | null {
  const k = key(gauge);
  return k ? NEC_TABLE_8_COPPER[k].circularMils : null;
}

/** Every gauge Table 8 covers, smallest area first. */
export const TABLE_8_GAUGES = Object.keys(NEC_TABLE_8_COPPER);
