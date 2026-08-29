// ═══════════════════════════════════════════════════════════════════════════
// THE ROOF PITCH FORMATTER — one number, one precision, every sheet.
//
// Braidon's roof is two planes: 16.5178° and 18.2491°. The package described
// them six different ways, because six places converted and rounded the same
// value independently:
//
//   PV-0 cover              `(tan × 12).toFixed(1)`      → 3.6:12
//   CERT / PE-1             `(tan × 12).toFixed(1)` + `toFixed(1)` → 3.6:12 (16.5°)
//   sheetComposition        `round(tan × 12 × 10) / 10`  → 3.6:12
//   PV-2 site-plan label    `round(tan × 12)`            → 4/12   ← a different roof
//   PV-2 plane table        `Math.round(pitch)`          → 17°, 18°
//   PV-1 array parameters   `toFixed(0)` range           → 17–18°
//
// So one plane was 16.5° on the certification page, 17° in the plane table, and
// 4:12 on the site plan. None of those disagree about the ROOF — they disagree
// about how to print it — and a reviewer cannot tell those two kinds of
// disagreement apart. Rounding 3.558 to "4:12" is the one that is simply wrong:
// 4:12 is 18.4°, a different roof, and the drawing said it in a box on the plan.
//
// A measured pitch is one fact. Its representations are derived HERE, at one
// precision, so no sheet can round it into a second answer. The precision is a
// single decimal: enough to distinguish 16.5 from 18.2, honest about a value
// that came from aerial geometry, and it is what the structural analysis and the
// certification page were already using.
// ═══════════════════════════════════════════════════════════════════════════

/** Degrees and rise:12 both print to ONE decimal. Not a per-sheet choice. */
export const PITCH_DECIMALS = 1;

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** rise per 12 of run, from a pitch in degrees. */
export function pitchRatioFromDeg(deg: number | null | undefined): number | null {
  if (!isNum(deg)) return null;
  const r = Math.tan(deg * Math.PI / 180) * 12;
  return Math.round(r * 10 ** PITCH_DECIMALS) / 10 ** PITCH_DECIMALS;
}

/** '3.6:12' — the ratio a roofer reads. Null pitch ⇒ null, never a default. */
export function formatPitchRatio(deg: number | null | undefined): string | null {
  const r = pitchRatioFromDeg(deg);
  return r == null ? null : `${r.toFixed(PITCH_DECIMALS)}:12`;
}

/** '16.5°' — the angle the structural analysis ran on. */
export function formatPitchDeg(deg: number | null | undefined): string | null {
  return isNum(deg) ? `${deg.toFixed(PITCH_DECIMALS)}°` : null;
}

/** '3.6:12 (16.5°)' — both representations of ONE value, never assembled
 *  separately by a caller (which is how they came to disagree). */
export function formatPitchBoth(deg: number | null | undefined): string | null {
  const ratio = formatPitchRatio(deg);
  const d = formatPitchDeg(deg);
  return ratio && d ? `${ratio} (${d})` : null;
}

/** '16.5–18.2°' across planes, or '16.5°' when they agree at the printed
 *  precision. A range printed at a COARSER precision than the individual planes
 *  is how PV-1 said "17–18°" beside PV-2's "16.5°" for the same two facets. */
export function formatPitchRangeDeg(degs: ReadonlyArray<number | null | undefined>): string | null {
  const vals = degs.filter(isNum);
  if (vals.length === 0) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const loS = lo.toFixed(PITCH_DECIMALS), hiS = hi.toFixed(PITCH_DECIMALS);
  return loS === hiS ? `${loS}°` : `${loS}–${hiS}°`;
}

/** The compact plan-label form: '3.6/12', or 'FLAT' at zero pitch. Used on the
 *  site plan, where the label box is 34px wide — the width is why it was rounded
 *  to an integer, and a narrow box is not a reason to state a different roof. */
export function formatPitchPlanLabel(deg: number | null | undefined): string | null {
  const r = pitchRatioFromDeg(deg);
  if (r == null) return null;
  return r > 0 ? `${r.toFixed(PITCH_DECIMALS)}/12` : 'FLAT';
}

// ═══════════════════════════════════════════════════════════════════════════
// THE FRAMING MEMBER — is it a rafter or a truss, and what do we call it.
//
// Braidon's roof is a PRE-ENGINEERED TRUSS. The package said so on CERT ("Roof
// Framing (Truss) Analysis", "Pre-Engineered Truss (2×6 chords)") and in PV-3's
// own spec table ("TRUSS SIZE 2x6", "TRUSS SPACING 24 O.C.") — and, on that same
// PV-3 sheet, hardcoded the other word eight times:
//
//     "SHEATHING (5/8" OSB) + 2x6 RAFTER @ 24" O.C."
//     "24" RAFTER O.C. (TYP.)"          "3.07" MIN INTO RAFTER"
//     "VERIFY RAFTER SIZE + SPACING IN FIELD."
//     "CROSS-SECTION SCHEMATIC — VERIFY RAFTER SIZE, SPACING + EMBEDMENT"
//
// The distinction is not cosmetic. Cutting, notching or drilling a truss chord
// voids its engineering; a rafter is site-framed lumber a carpenter may size in
// the field. A sheet that says both is telling an installer two different things
// about what they may do to the member they are screwing into.
//
// THREE PLACES DERIVED IT INDEPENDENTLY, and they did not agree on the test:
// certPages asked `framingType === 'truss'`; sheetComposition and
// structuralPages ALSO inferred truss-ness from a zero bending moment with a
// non-zero allowable. PV-3's prose asked nothing at all.
// ═══════════════════════════════════════════════════════════════════════════

export interface FramingMemberAuthority {
  isTruss: boolean;
  /** 'TRUSS' / 'RAFTER' — for drawing labels, which are upper case. */
  term: string;
  /** 'truss' / 'rafter' — for prose. */
  termLower: string;
  /** how the determination was made, for the review record. */
  basis: string;
}

interface RafterRecordLike {
  framingType?: string;
  bendingMoment?: number;
  allowableBendingMoment?: number;
}

/** THE framing-member determination. `framingType` is the declared answer; the
 *  zero-demand fallback is retained because the structural engine analyses a
 *  truss by load capacity (PSF) rather than bending, so an older record can be
 *  identifiably a truss without carrying the field. Both tests live here, once,
 *  rather than in two of the three call sites and neither of the others. */
export function framingMember(rafter: RafterRecordLike | null | undefined): FramingMemberAuthority {
  // A DECLARED type wins outright. Both prior copies wrote the inference as an
  // OR against the declared test, so `framingType: 'rafter'` with a zero bending
  // moment came back TRUSS - the inference overrode the record it was meant to
  // stand in for. It is a fallback, and it only runs when nothing is declared.
  const declared = rafter?.framingType === 'truss' ? true
    : rafter?.framingType === 'rafter' ? false
    : null;
  const zeroDemandWithCapacity = rafter?.bendingMoment === 0
    && (rafter?.allowableBendingMoment ?? 0) > 0;
  const isTruss = declared ?? zeroDemandWithCapacity;
  return {
    isTruss,
    term: isTruss ? 'TRUSS' : 'RAFTER',
    termLower: isTruss ? 'truss' : 'rafter',
    basis: declared === true
      ? 'the structural record declares framingType = truss'
      : declared === false
        ? 'the structural record declares framingType = rafter'
        : zeroDemandWithCapacity
          ? 'no framing type is declared; the record carries no bending demand against a non-zero allowable, which is how a truss is analysed (load capacity, not bending)'
          : 'no framing type is declared and the record carries a bending demand, which is stick framing',
  };
}
