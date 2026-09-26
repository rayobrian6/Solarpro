/**
 * lib/incentives/section48eOffer.ts
 *
 * 🚨 A 30% FEDERAL CREDIT WAS REACHING RESIDENTIAL HOMEOWNERS AS MARKETING PROSE.
 *
 * The §48E lease/PPA banner on both proposal surfaces was gated on
 * `isSection48eEnabled()` alone — which is two frozen `true` literals in
 * GLOBAL_INCENTIVES_CONFIG (`incentives_enabled` and `allow_section48e`) and
 * nothing about this project, this product or today's date. So every homeowner
 * opening a share link — cash or loan, any state — was urged to "Act Before
 * July 4, 2026" for a deadline that passed on 2026-07-04, and promised "a 30%
 * federal tax credit" passed through via a lease or PPA that this product cannot
 * model or quote.
 *
 * That was the ONE remaining path by which a 30% federal credit reached a
 * residential homeowner's proposal, and it arrived as prose rather than a
 * number, which is exactly why the numeric ITC guards (isItcEnabled /
 * guardItcValue) never caught it: there was no dollar amount to guard.
 *
 * THREE CONDITIONS, ALL REQUIRED:
 *   1. §48E is enabled at all (the config gate — necessary, never sufficient).
 *   2. The project is genuinely a LEASE or PPA. §48E is a company-level credit
 *      claimed by the system's OWNER. On a cash or financed purchase the
 *      homeowner owns the system, so there is no §48E to pass through to them
 *      and the banner is simply false.
 *   3. The safe-harbor deadline has not passed. Construction must begin by
 *      `section48e_safe_harbor_deadline`; a countdown to a date in the past is
 *      not urgency, it is a wrong claim.
 *
 * WHY IT RETURNS FALSE FOR EVERYTHING TODAY, DELIBERATELY:
 * there is no lease/PPA product in this codebase. `purchaseMode` is
 * `'finance' | 'cash'` and nothing writes a lease or PPA finance type anywhere,
 * so condition (2) cannot be satisfied and the banner must not render. That is
 * the honest state: the day a lease/PPA product exists, pass its finance type in
 * and the banner becomes correct without touching the pages.
 */

import {
  isSection48eEnabled,
  getSection48eSafeHarborDeadline,
} from '../incentivesConfig';

/** Finance types for which §48E can legitimately be passed through. */
const PASS_THROUGH_FINANCE_TYPES = new Set(['lease', 'ppa']);

export interface Section48eOfferInput {
  /**
   * The project's finance type, if one is on file. §48E pass-through only
   * applies to a third-party-owned product ('lease' | 'ppa').
   *
   * Today NOTHING in the repo produces 'lease' or 'ppa' — `purchaseMode` is
   * only 'finance' | 'cash' — so this is undefined in practice and the offer is
   * correctly not made.
   */
  financeType?: string | null;
  /** Evaluation date. Defaults to now. Injectable so the deadline is testable. */
  now?: Date;
}

/**
 * True only when a §48E lease/PPA pass-through can honestly be offered to this
 * homeowner today. Every §48E banner, deadline and rate on a customer-facing
 * surface must be gated on this.
 */
export function isSection48eOfferable(input: Section48eOfferInput = {}): boolean {
  if (!isSection48eEnabled()) return false;

  const ft = (input.financeType ?? '').toString().trim().toLowerCase();
  if (!PASS_THROUGH_FINANCE_TYPES.has(ft)) return false;

  const deadline = getSection48eSafeHarborDeadline();
  if (!deadline) return false;

  const deadlineMs = new Date(deadline).getTime();
  if (!isFinite(deadlineMs)) return false;

  const nowMs = (input.now ?? new Date()).getTime();
  return nowMs <= deadlineMs;
}

/**
 * The safe-harbor deadline formatted for display, from the config accessor —
 * NEVER a hardcoded "July 4, 2026" string. Two such literals were frozen into
 * the banner copy, so the date could not follow the config it was quoting.
 * Returns null when §48E is disabled.
 */
export function formatSection48eDeadline(): string | null {
  const deadline = getSection48eSafeHarborDeadline();
  if (!deadline) return null;
  // Parse as a plain calendar date — `new Date('2026-07-04')` is UTC midnight,
  // which renders as July 3 in any negative-offset timezone.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(deadline);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(deadline);
  if (!isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
