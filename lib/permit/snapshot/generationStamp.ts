// ═══════════════════════════════════════════════════════════════════════════
// D14 — THE GENERATION STAMP: ONE VALUE, AND ITS NAME IS TRUE.
//
// THE DEFECT. Two DIGESTED fields declared as ISO held a US-localised date on
// every live package:
//
//   meta.generatedAtIso                      "7/30/2026"
//   permitReadiness.registry[].createdAtIso  "7/30/2026"
//
// Both were computed from the same expression, written out twice:
//
//   (input as any).generatedAtIso ?? proj.date ?? ''
//
// `input.generatedAtIso` is a genuine ISO instant — the frozen clock the whole
// suite injects — so the name is true on that branch. `proj.date` is an
// operator-facing `M/D/YYYY` label, and on the live path that is what lands in a
// slot the schema calls ISO.
//
// WHY IT SURVIVED. build.ts recorded the reason rather than papering over it:
// substituting the resolved context's true sub-second UTC instant made every
// unfrozen render produce a new snapshot id, breaking the byte-identical-render
// invariant. That reasoning is sound and its conclusion was still wrong, because
// the choice was never "localised date OR sub-second instant". `2026-07-30` is
// ISO 8601, carries no time component, and is a pure REFORMAT of the same
// calendar date. It moves no design fact and admits no clock.
//
// AND THE SUB-SECOND INSTANT REMAINS FORBIDDEN, for a reason that now has a
// test: D9's `payloadGeneric` drops any payload string matching
// /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ from the artifact. A time component here
// would either vanish from the render or reinstate the moving-artifact defect
// D9 closed. A date-only ISO value is clear of that guard by construction.
//
// PRECISION IS PART OF THE CONTRACT. "ISO" does not tell a consumer whether
// there is a time component, and at least one consumer depends on exactly that.
// An unrecognized format is preserved verbatim and LABELLED unrecognized rather
// than inheriting the ISO claim — which is the defect itself, generalized.
// ═══════════════════════════════════════════════════════════════════════════

export type GenerationStampPrecision =
  /** a full ISO instant, as injected by the caller (frozen clock, stored input). */
  | 'instant'
  /** an ISO calendar date, no time component. */
  | 'date'
  /** a value we could not classify — preserved verbatim, never called ISO. */
  | 'unrecognized'
  /** nothing was supplied. Empty, never invented. */
  | 'absent';

export interface GenerationStamp {
  /** THE value both `meta.generatedAtIso` and every `registry[].createdAtIso`
   *  carry. One resolution, so the two can never drift. */
  value: string;
  precision: GenerationStampPrecision;
  /** WHY it has this form, in one sentence. */
  basis: string;
}

/** `2026-07-30T12:00:00Z`, `2026-07-30 12:00`, … — an instant. */
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
/** `2026-07-30` — an ISO calendar date. */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `7/30/2026`, `07/30/2026` — the operator-facing US label on `project.date`. */
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** A real calendar date, checked without constructing a Date in a host zone. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const len = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= len;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Resolve THE generation stamp. Pure, total, and clock-free: it reads the two
 * values it is given and reformats — it never calls `Date.now()`, never parses
 * through a host timezone (which would shift the calendar date; see the
 * jurisdiction-zone rule the permit dates already follow), and never invents a
 * value it was not given.
 */
export function resolveGenerationStamp(args: {
  /** `input.generatedAtIso` — a genuine ISO instant when the caller injects one. */
  injectedIso?: string | null;
  /** `project.date` — the operator-facing issue-date label. */
  projectDate?: string | null;
}): GenerationStamp {
  const injected = (args.injectedIso ?? '').trim();
  if (injected) {
    if (ISO_INSTANT_RE.test(injected)) {
      return {
        value: injected, precision: 'instant',
        basis: 'the caller injected an ISO instant (a frozen clock or the stored generation time)',
      };
    }
    const d = injected.match(ISO_DATE_RE);
    if (d && isRealDate(+d[1], +d[2], +d[3])) {
      return { value: injected, precision: 'date', basis: 'the caller injected an ISO calendar date' };
    }
    return {
      value: injected, precision: 'unrecognized',
      basis: `the injected generation stamp '${injected}' is not a recognized ISO instant or date — `
        + 'it is preserved verbatim and is NOT reported as ISO',
    };
  }

  const raw = (args.projectDate ?? '').trim();
  if (!raw) {
    return { value: '', precision: 'absent', basis: 'no generation instant was injected and the project carries no date' };
  }

  const iso = raw.match(ISO_DATE_RE);
  if (iso && isRealDate(+iso[1], +iso[2], +iso[3])) {
    return { value: raw, precision: 'date', basis: "the project's date is already an ISO calendar date" };
  }

  const us = raw.match(US_DATE_RE);
  if (us) {
    const m = +us[1], d = +us[2], y = +us[3];
    if (isRealDate(y, m, d)) {
      return {
        value: `${y}-${pad(m)}-${pad(d)}`, precision: 'date',
        basis: `the project's localised issue date '${raw}' reformatted to ISO — the same calendar date, `
          + 'no timezone conversion and no time component',
      };
    }
  }

  return {
    value: raw, precision: 'unrecognized',
    basis: `the project's date '${raw}' is not a recognized ISO or M/D/YYYY date — it is preserved `
      + 'verbatim and is NOT reported as ISO',
  };
}
