// ═══════════════════════════════════════════════════════════════════════════
// ENVIRONMENTAL DESIGN CRITERIA, AS PRINTED. ONE PRODUCER.
//
// ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
// Every consumer tested the VALUE and never the BASIS:
//
//     _proj.groundSnowPsf != null ? String(_proj.groundSnowPsf) : '—'
//
// `groundSnowPsf` is `0` when nothing was established — not null — so the sheets
// printed `0 psf` as though zero were the answer. The canonical authority was
// saying the opposite the whole time:
//
//     environmentalLoadAuthority.snowLoadBasis   'not-established'
//     environmentalLoadAuthority.snowLoadSource  null
//     environmentalLoadAuthority.riskCategory    null
//
// Three consequences, all printed:
//   1. `Ground Snow Load (pg) | 0 psf` on PV-0 / PV-4C / PE-1. There is no
//      0 psf ground-snow code default; Granite City IL is roughly 20 psf. An
//      Illinois reviewer rejects a D+S analysis with S = 0.
//   2. `Snow loading is not a controlling factor at this location.` — an
//      AFFIRMATIVE ENGINEERING CONCLUSION drawn from a value that does not
//      exist, emitted by the `> 0 ? … : …` else-branch.
//   3. `Ground Snow Load Verified | PASS`, because the check was
//      `groundSnowLoad >= 0` and zero satisfies it.
//
// ─── THE RULE ──────────────────────────────────────────────────────────────
// Unknown is acceptable if honestly labelled. A fabricated zero is not, and a
// conclusion drawn from a fabricated zero is worse than the zero.
// ═══════════════════════════════════════════════════════════════════════════

export const ENV_NOT_ESTABLISHED = 'NOT ESTABLISHED';

/** The shape both the snapshot projection and the raw authority satisfy. */
export interface EnvSource {
  groundSnowPsf?: number | null;
  roofSnowPsf?: number | null;
  riskCategory?: string | null;
  environmentalLoadAuthority?: {
    snowLoadBasis?: string | null;
    snowLoadSource?: string | null;
    groundSnowLoadPsf?: number | null;
    riskCategory?: string | null;
  } | null;
}

/**
 * Is the ground snow load ESTABLISHED, as opposed to defaulted to zero?
 *
 * Keys on the BASIS, never on the value: `snowLoadBasis: 'not-established'` is
 * the authority telling us plainly that nobody resolved it. A positive value
 * with a stated basis is established; anything else is not.
 */
export function isGroundSnowEstablished(src: EnvSource | null | undefined): boolean {
  const ela = src?.environmentalLoadAuthority;
  const basis = (ela?.snowLoadBasis ?? '').toString().trim().toLowerCase();
  if (basis === 'not-established' || basis === 'unknown' || basis === '') {
    // No basis stated. A positive value still counts — a legacy row may carry a
    // real figure with no basis field — but zero never does.
    return Number(src?.groundSnowPsf ?? ela?.groundSnowLoadPsf ?? 0) > 0;
  }
  return true;
}

/** `"20 psf"` when established, `"NOT ESTABLISHED"` when not. Never `"0 psf"`. */
export function groundSnowLabel(src: EnvSource | null | undefined): string {
  if (!isGroundSnowEstablished(src)) return ENV_NOT_ESTABLISHED;
  const v = src?.groundSnowPsf ?? src?.environmentalLoadAuthority?.groundSnowLoadPsf;
  return v == null ? ENV_NOT_ESTABLISHED : `${v} psf`;
}

/** Roof snow follows ground snow: it is derived from it, so it cannot be
 *  established when its input is not. */
export function roofSnowLabel(src: EnvSource | null | undefined): string {
  if (!isGroundSnowEstablished(src)) return ENV_NOT_ESTABLISHED;
  const v = src?.roofSnowPsf;
  return v == null ? ENV_NOT_ESTABLISHED : `${v.toFixed(1)} psf`;
}

/**
 * The ASCE risk category, or the honest unresolved state.
 *
 * Deliberately NOT inferred. Risk category is a code determination about the
 * building's occupancy and consequence of failure (ASCE 7 Table 1.5-1); a
 * renderer guessing "II" because most houses are II would be substituting its
 * own judgement for the engineer's on a stamped sheet.
 */
export function riskCategoryLabel(src: EnvSource | null | undefined): string {
  const rc = (src?.riskCategory ?? src?.environmentalLoadAuthority?.riskCategory ?? '')
    .toString().trim();
  return rc && rc.toLowerCase() !== 'unknown' ? rc : ENV_NOT_ESTABLISHED;
}

/**
 * The snow sentence for a structural narrative.
 *
 * Returns null when nothing may be concluded — the caller omits the sentence
 * entirely rather than printing the old else-branch, which asserted that snow
 * was not controlling on the strength of a value nobody established.
 */
export function snowNarrativeSentence(
  src: EnvSource | null | undefined,
  established: (groundPsf: number) => string,
): string | null {
  if (!isGroundSnowEstablished(src)) return null;
  const v = Number(src?.groundSnowPsf ?? src?.environmentalLoadAuthority?.groundSnowLoadPsf ?? 0);
  return v > 0 ? established(v) : null;
}
