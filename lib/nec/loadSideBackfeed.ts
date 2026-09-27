// ═══════════════════════════════════════════════════════════════════════════
// NEC 705.12(B)(3)(2) — WHAT IS LEFT FOR THE PV BREAKER, once everything else on
// the busbar has been counted.
//
// 🚨 THE BOM'S 120% ALLOWANCE HAD NO BATTERY TERM. `lib/bom-engine-v4.ts` computed
//
//     const maxPVBreaker = Math.floor(busRating * 1.2 - mainAmps);
//
// in two duplicated blocks, with no term for any other source. `BOMInputV4` has
// `batteryId` and `batteryCount` and used both only for a line quantity.
//
// The rule is a SUM: every overcurrent device supplying the busbar other than the main
// must together stay within 120% of the busbar rating. So a battery branch consumes the
// same allowance the PV breaker draws on. `lib/computed-system.ts` — the permit's engine —
// includes the battery term, so the same package carried a stamped busbar verdict that
// counted the battery beside a BOM compliance note asserting an allowance the battery had
// already spent, and purchased a breaker sized for PV alone. A 200 A bus with a 200 A main
// has 40 A of allowance; a 2 × IQ Battery 10C branch is an 80 A OCPD, which takes all of it
// and more. The BOM still emitted a PV backfeed breaker and certified it compliant.
//
// 🚨 AND `backfeedAmps` MEANS DIFFERENT THINGS TO DIFFERENT CALLERS, which is why this
// cannot simply subtract and be done. `lib/permit/utils/bomForPermit.ts` passes
// `_auth.acFeeder.ocpdAmps` — PV only. `app/engineering/page.tsx`'s hybrid path passes
// `cs.backfeedBreakerAmps`, which `lib/computed-system.ts` sets from `totalBackfeedA` —
// PV **plus** storage. Subtracting the battery from an allowance while sizing against a
// figure that already includes it would double-count it, produce a needlessly small
// breaker, and print a violation warning on a compliant design.
//
// So the split has to be ASSERTED by the caller, not assumed here. When it is not
// established, this resolver refuses to state a verdict — `evaluated: false` — rather than
// picking whichever reading makes the design pass. That is the same discipline as
// `resolveInterconnectionMethod`, which answers `'unresolved'` instead of fabricating a
// busbar rating, and as the battery refusal in `computed-system`.
//
// The allowance itself comes from `maxLoadSideBackfeedA` in `./rule705_12` — the one
// implementation of (busbar × 1.2) − main. This file adds no copy of that arithmetic.
// ═══════════════════════════════════════════════════════════════════════════

import { maxLoadSideBackfeedA } from './rule705_12';
import { prevStandardOcpd } from '../electrical/stdSizes';

export interface LoadSideBackfeedRequest {
  busRatingA: number;
  mainBreakerA: number;
  /**
   * The breaker rating the design asks for, already on the NEC 240.6(A) ladder.
   * PV ALONE when `pvFigureEstablished` is true.
   */
  requestedBreakerA: number;
  /**
   * Whether `requestedBreakerA` is known to cover PV only. False means the caller passed a
   * figure that may already include storage, and the split has not been established.
   */
  pvFigureEstablished: boolean;
  /**
   * Backfeed OCPD already landing on this busbar from sources OTHER than this PV breaker —
   * the battery branch, a generator. Resolved from the equipment authority by the caller
   * (`resolveBatteryBranch(...).busbarContributionA`), never inferred here and never
   * derived from a device count.
   */
  otherSourceBackfeedA?: number | null;
  /** How that figure was established, for the printed derivation. */
  otherSourceBasis?: string | null;
}

export interface LoadSideBackfeedResolution {
  /** (busbar × 1.2) − main, from rule705_12. Unrounded: the true allowance. */
  busAllowanceA: number;
  /** What is left for the PV breaker once other sources are counted. Null when not evaluable. */
  pvAllowanceA: number | null;
  /** The breaker to emit. Always a real NEC 240.6(A) rating, never raw arithmetic. */
  breakerA: number;
  /** Whether the requested breaker fits the PV allowance. Null when not evaluable. */
  fits: boolean | null;
  /** True when even the smallest standard rating (15 A) exceeds the allowance. */
  noCompliantSize: boolean;
  /**
   * False ⇒ the 120% rule was NOT evaluated and no consumer may print a compliance
   * conclusion from this result. The breaker is still sized, so the BOM can be ordered.
   */
  evaluated: boolean;
  /** The printable derivation, or the reason the rule could not be evaluated. */
  basis: string;
  /** A warning to surface, or null. */
  warning: string | null;
}

export function resolveLoadSideBackfeedBreaker(
  req: LoadSideBackfeedRequest,
): LoadSideBackfeedResolution {
  const bus = Number(req.busRatingA) || 0;
  const main = Number(req.mainBreakerA) || 0;
  const other = Math.max(0, Number(req.otherSourceBackfeedA) || 0);
  const requested = Number(req.requestedBreakerA) || 0;
  const busAllowanceA = maxLoadSideBackfeedA(bus, main);

  // The case that used to be silently wrong: another source is on the busbar and the
  // caller has not said whether the requested figure already includes it.
  if (other > 0 && !req.pvFigureEstablished) {
    const breakerA = Math.min(requested, prevStandardOcpd(busAllowanceA));
    return {
      busAllowanceA,
      pvAllowanceA: null,
      breakerA,
      fits: null,
      noCompliantSize: false,
      evaluated: false,
      basis: `NEC 705.12(B) NOT EVALUATED — ${other}A of non-PV backfeed is on this busbar `
        + `(${req.otherSourceBasis || 'source not stated'}), and the requested ${requested}A `
        + `is not established as PV-only. The allowance is a SUM over every device other than `
        + `the main, so it cannot be split without knowing which figure this is.`,
      warning: `NEC 705.12(B) NOT EVALUATED for this BOM: ${other}A of non-PV backfeed `
        + `(${req.otherSourceBasis || 'source not stated'}) shares the `
        + `${busAllowanceA}A allowance with the PV breaker, and the caller did not establish `
        + `the PV-only figure. The ${breakerA}A breaker is sized but NOT certified — read the `
        + `busbar verdict from the engineering authority, not from this BOM.`,
    };
  }

  const pvAllowanceA = busAllowanceA - other;
  // `prevStandardOcpd` takes the largest REAL rating at or below the allowance, so the
  // emitted part is always orderable and never above the limit. The allowance stays
  // unrounded in the derivation so the sheet still states the true number.
  const ladderCappedMax = prevStandardOcpd(pvAllowanceA);
  const breakerA = Math.min(requested, ladderCappedMax);
  const fits = requested <= pvAllowanceA;
  // When even the smallest standard rating exceeds what is left, there is no compliant
  // load-side breaker at all. `prevStandardOcpd` floors at 15, so the cap alone would read
  // as a fix.
  const noCompliantSize = breakerA > pvAllowanceA;

  const otherTerm = other > 0
    ? ` − ${other}A non-PV backfeed (${req.otherSourceBasis || 'equipment authority'})`
    : '';
  const basis = `NEC 705.12(B): (${bus}A bus × 1.2) − ${main}A main${otherTerm} = `
    + `${pvAllowanceA}A available to the PV breaker; requested ${requested}A `
    + `${fits ? '≤' : '>'} ${pvAllowanceA}A`;

  return {
    busAllowanceA,
    pvAllowanceA,
    breakerA,
    fits,
    noCompliantSize,
    evaluated: true,
    basis,
    warning: fits ? null
      : `NEC 705.12(B) VIOLATION: Requested ${requested}A backfeed exceeds the `
        + `${pvAllowanceA}A available to PV for ${bus}A bus / ${main}A main`
        + (other > 0 ? ` with ${other}A of non-PV backfeed already on the busbar` : '') + '. '
        + (noCompliantSize
          ? `NO standard NEC 240.6(A) rating fits a ${pvAllowanceA}A allowance — the smallest `
            + `is 15A. This design cannot be interconnected load-side; use SUPPLY_SIDE_TAP `
            + `(NEC 705.11) or upgrade the service.`
          : `BOM capped to ${breakerA}A (largest standard rating at or below the allowance) — `
            + `use SUPPLY_SIDE_TAP (NEC 705.11) to use full ${requested}A.`),
  };
}
