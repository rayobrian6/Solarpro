// ═══════════════════════════════════════════════════════════════════════════
// NEC 310.15(B)(3)(c) — the rooftop temperature adder. ONE gate.
//
// 🚨 THIS RULE DOES NOT EXIST IN THE ADOPTED EDITION. 310.15(B)(3)(c) was DELETED
// for PV circuits by NEC 2017 690.31(A) and is absent from the 2020 and 2023
// editions. `lib/engineering/reportGenerator.ts` STATE_NEC puts every US state on
// NEC 2020 or NEC 2022, so on this product's own jurisdiction data the adder is
// **zero everywhere**, and only a pre-2017 adopted edition reinstates it.
//
// This module is EXTRACTED, not invented. `lib/computed-system.ts` already decided
// both halves correctly and privately:
//
//   lines 990-993   `_applies = _necYear != null && _necYear < 2017`
//   line  3151      `_adder = (_onRoof && rooftopAdderApplies) ? rooftopAdderC : null`
//
// — i.e. the edition gate AND the per-segment scope, keyed on the segment's own
// roof-ness rather than on which branch of a topology `if` the code sits in. That
// was right. The defect was that it was the ONLY place that knew:
//
//   · `lib/wire-autosizer.ts` applies the adder UNCONDITIONALLY at lines 154, 381
//     and 535 (`input.ambientTempC + (input.rooftopTempAdderC ?? 0)`) — the file has
//     no `necEdition` parameter at all;
//   · `app/engineering/page.tsx` passed a literal 30, the permit path a literal 33,
//     and a third site 35, for the same physical roof run;
//   · `lib/permit/utils/computedRuns.ts` defaulted an UNSCOPED 33, so ground- and
//     fence-mount packages were sized with a rooftop adder while PV-4A printed
//     "No rooftop temperature adder applies — ground-mounted system".
//
// 🚨 DIRECTION, stated plainly because the original finding implied the opposite:
// applying a deleted adder OVER-derates. It buys a larger conductor than the code
// requires — a cost, not a hazard. The UNDER-derating defect in the same area is the
// 40 °C clamp on the engineering page's design ambient, which credits more ampacity
// than the site's own ASHRAE authority allows in AZ (43 °C) and NV (41 °C). The two
// partially cancel, which is the most likely reason neither was noticed for so long.
//
// The four-row table below is the real 310.15(B)(3)(c) table as it stood in NEC 2014
// and earlier, keyed on the distance above the roof surface. It is carried so that a
// genuinely pre-2017 jurisdiction gets the right number rather than a flat 33.
// ═══════════════════════════════════════════════════════════════════════════

/** NEC 310.15(B)(3)(c), NEC 2014 and earlier: added ambient by height above roof. */
const ADDER_BY_HEIGHT_IN: ReadonlyArray<{ maxHeightIn: number; adderC: number }> = [
  { maxHeightIn: 0.5,  adderC: 33 },  // 0 to 1/2 in.
  { maxHeightIn: 3.5,  adderC: 22 },  // above 1/2 through 3-1/2 in.
  { maxHeightIn: 12,   adderC: 17 },  // above 3-1/2 through 12 in.
  { maxHeightIn: 36,   adderC: 14 },  // above 12 through 36 in.
  // Above 36 in. the section applied no adder.
];

/** The most conservative row, used when the height above the roof is not recorded. */
export const ROOFTOP_ADDER_MAX_C = 33;

export type RooftopAdderSystemType = 'roof' | 'ground' | 'fence' | 'carport' | string;

export interface RooftopAdderResolution {
  /** °C to add to the design ambient. 0 when the section does not apply. */
  adderC: number;
  /** True only when the adopted edition still contains 310.15(B)(3)(c). */
  applies: boolean;
  /** Why, in the words a plan reviewer needs. Always populated. */
  basis: string;
}

/**
 * Does the ADOPTED edition still contain the rooftop adder?
 *
 * An unknown edition does NOT invent one. That is deliberate and matches
 * computed-system's original behaviour: fabricating a code requirement from a
 * missing input is the defect class this campaign exists to remove, and the
 * ampacity chain states the basis either way so the absence is visible.
 */
export function rooftopAdderAppliesToEdition(necEdition: string | number | null | undefined): boolean {
  const raw = String(necEdition ?? '').trim();
  const year = /(\d{4})/.exec(raw)?.[1];
  if (!year) return false;
  return Number(year) < 2017;
}

/**
 * The effective rooftop adder for ONE run.
 *
 * `onRoof` is the SEGMENT's own property — a raceway or cable on the roof surface —
 * not the project's system type and not which branch of a topology conditional the
 * caller happens to be in. A ground-mount project has no on-roof segments, so
 * passing its system type yields 0 without the caller special-casing anything.
 *
 * `heightAboveRoofIn` selects the real table row when it is recorded. When it is
 * not, the most conservative row (33 °C) is used and the basis says so — the adder
 * is a derating, so the conservative default costs conductor rather than safety.
 */
export function rooftopAmbientAdderC(opts: {
  systemType?: RooftopAdderSystemType | null;
  necEdition?: string | number | null;
  /** The segment's own roof-ness. Overrides systemType when given. */
  onRoof?: boolean | null;
  heightAboveRoofIn?: number | null;
}): RooftopAdderResolution {
  const applies = rooftopAdderAppliesToEdition(opts.necEdition);
  const editionNote = applies
    ? `NEC ${String(opts.necEdition).trim()} retains 310.15(B)(3)(c)`
    : 'NEC 310.15(B)(3)(c) was deleted for PV circuits by NEC 2017 690.31(A) and is absent '
      + `from the 2020/2023 editions${String(opts.necEdition ?? '').trim() ? ` (adopted NEC ${String(opts.necEdition).trim()})` : ' (adopted edition not established)'}`;

  if (!applies) {
    return { adderC: 0, applies: false, basis: `No rooftop temperature adder applied — ${editionNote}` };
  }

  // The edition retains it; now decide whether THIS run is on the roof.
  const onRoof = typeof opts.onRoof === 'boolean'
    ? opts.onRoof
    : String(opts.systemType ?? '').toLowerCase() === 'roof';
  if (!onRoof) {
    const st = String(opts.systemType ?? 'non-roof');
    return {
      adderC: 0,
      applies: true,
      basis: `No rooftop temperature adder applied — this run is not on a roof surface (${st}); `
        + '310.15(B)(3)(c) addressed raceways and cables on rooftops',
    };
  }

  const h = Number(opts.heightAboveRoofIn);
  if (!Number.isFinite(h)) {
    return {
      adderC: ROOFTOP_ADDER_MAX_C,
      applies: true,
      basis: `${ROOFTOP_ADDER_MAX_C} °C rooftop adder — ${editionNote}; height above the roof surface `
        + 'not recorded, so the most conservative row of 310.15(B)(3)(c) is used',
    };
  }
  const row = ADDER_BY_HEIGHT_IN.find(r => h <= r.maxHeightIn);
  if (!row) {
    return {
      adderC: 0,
      applies: true,
      basis: `No rooftop temperature adder applied — the run is ${h} in. above the roof surface, `
        + 'above the 36 in. limit of 310.15(B)(3)(c)',
    };
  }
  return {
    adderC: row.adderC,
    applies: true,
    basis: `${row.adderC} °C rooftop adder — ${editionNote}; run is ${h} in. above the roof surface`,
  };
}
