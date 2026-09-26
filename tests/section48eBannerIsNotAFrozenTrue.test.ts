/**
 * tests/section48eBannerIsNotAFrozenTrue.test.ts
 *
 * 🚨 THE LAST PATH BY WHICH A 30% FEDERAL CREDIT REACHED A RESIDENTIAL HOMEOWNER.
 *
 * Every numeric ITC guard in this repo works on dollars: isItcEnabled() gates the
 * rate, guardItcValue() zeroes a leaked amount, lib/db/pricing.ts refuses a
 * residential rate. The §48E lease/PPA banner defeated all of them by carrying no
 * number at all — it made the claim in PROSE:
 *
 *   "$0-Down Lease & PPA Options Available — Act Before July 4, 2026"
 *   "solar companies that own the system can still claim a 30% federal tax
 *    credit and pass those savings directly to you"
 *
 * It was gated on `isSection48eEnabled()` and nothing else. That function reads
 * `incentives_enabled && allow_section48e` out of GLOBAL_INCENTIVES_CONFIG — TWO
 * FROZEN `true` LITERALS — so the banner rendered for every homeowner opening
 * every share link: cash or loan, any state, any project. Today is past
 * 2026-07-04, so it also counted down to a deadline in the past, and it offered a
 * lease/PPA product this codebase cannot model or quote (`purchaseMode` is only
 * 'finance' | 'cash'; nothing anywhere produces 'lease' or 'ppa').
 *
 * WHAT IS GUARDED
 *   1. The three conditions, each proven to be LOAD-BEARING on its own: config
 *      gate, genuine lease/PPA finance type, unexpired safe-harbor deadline.
 *   2. Today's answer for the shipped product: false. No lease/PPA exists, so the
 *      banner must not render, and that is the honest state — not a bug.
 *   3. Neither proposal surface still hardcodes "July 4, 2026", and neither still
 *      gates the banner on `isSection48eEnabled()` alone.
 *
 * Part 3 is a SOURCE SCAN, and says so where it runs. Both files are 2,500–3,400
 * line client components wired to useParams/useSearchParams, an app store, live
 * fetches and Recharts; rendering either in jsdom to read one banner is not
 * feasible. The scan strips comments first with tests/support/stripSource.ts,
 * because Phase 4 had TWO guards satisfied by the offending text appearing in the
 * comment that documented its removal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { isSection48eOfferable, formatSection48eDeadline } from '@/lib/incentives/section48eOffer';
import {
  isSection48eEnabled,
  getSection48eSafeHarborDeadline,
  GLOBAL_INCENTIVES_CONFIG,
} from '@/lib/incentivesConfig';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const BEFORE_DEADLINE = new Date('2026-03-01T12:00:00Z');
const AFTER_DEADLINE  = new Date('2026-09-26T12:00:00Z'); // the day this was found

describe('🚨 the §48E offer needs more than two frozen true literals', () => {
  it('the config gate really is two frozen literals — which is why it is not enough', () => {
    // Stated so the next reader does not have to go looking for the mechanism.
    expect(GLOBAL_INCENTIVES_CONFIG.incentives_enabled).toBe(true);
    expect(GLOBAL_INCENTIVES_CONFIG.allow_section48e).toBe(true);
    expect(isSection48eEnabled(), 'the old gate, on its own').toBe(true);
  });

  it('a lease BEFORE the deadline is offerable — the happy path exists', () => {
    expect(isSection48eOfferable({ financeType: 'lease', now: BEFORE_DEADLINE })).toBe(true);
    expect(isSection48eOfferable({ financeType: 'ppa',   now: BEFORE_DEADLINE })).toBe(true);
    // Case and padding are the installer's, not ours.
    expect(isSection48eOfferable({ financeType: '  PPA ', now: BEFORE_DEADLINE })).toBe(true);
  });

  it('🚨 a CASH or LOAN purchase is never offerable — the homeowner owns the system', () => {
    // §48E is claimed by the OWNER. On a purchase there is no company-level
    // credit to pass through, so the banner is simply false. This is the
    // condition that made the banner appear on every proposal in the product.
    for (const ft of ['cash', 'finance', 'loan', '', null, undefined]) {
      expect(isSection48eOfferable({ financeType: ft as any, now: BEFORE_DEADLINE }),
        `financeType=${String(ft)} is being offered a §48E pass-through`).toBe(false);
    }
  });

  it('🚨 a lease AFTER the safe-harbor deadline is not offerable', () => {
    // A countdown to a date in the past is not urgency.
    expect(isSection48eOfferable({ financeType: 'lease', now: AFTER_DEADLINE })).toBe(false);
  });

  it('the deadline boundary is inclusive and is read from the config, not a literal', () => {
    const deadline = getSection48eSafeHarborDeadline()!;
    expect(deadline, 'the config no longer publishes a safe-harbor deadline').toBeTruthy();
    const onTheDay = new Date(deadline);
    expect(isSection48eOfferable({ financeType: 'lease', now: onTheDay })).toBe(true);
    expect(isSection48eOfferable({ financeType: 'lease', now: new Date(onTheDay.getTime() + 1) })).toBe(false);
  });

  it('🚨 TODAY, for the shipped product, the answer is NO', () => {
    // No lease/PPA product exists: `purchaseMode` is 'finance' | 'cash' and
    // nothing writes a lease or PPA finance type. So with no financeType passed —
    // which is every real call — the banner does not render, on today's date or
    // any other. That is the honest state, and it is what the pages now do.
    expect(isSection48eOfferable()).toBe(false);
    expect(isSection48eOfferable({ now: BEFORE_DEADLINE })).toBe(false);
    expect(isSection48eOfferable({ now: AFTER_DEADLINE })).toBe(false);
  });

  it('the displayed deadline comes from the config accessor', () => {
    const shown = formatSection48eDeadline();
    expect(shown).toBeTruthy();
    // Parsed as a plain calendar date — `new Date('2026-07-04')` is UTC midnight
    // and renders as July 3 in any negative-offset timezone, which is how a
    // "correct" accessor still prints the wrong day.
    expect(shown).toContain('2026');
    expect(shown).toContain('July');
    expect(shown).toContain('4');
  });
});

describe('🚨 both proposal surfaces gate on the offer, not on the config flag', () => {
  // ⚠️ SOURCE SCAN, DELIBERATELY. app/proposals/page.tsx is 3,400 lines and
  // app/proposals/view/[id]/page.tsx is 2,500, both client components bound to
  // Next navigation hooks, an app store and live fetches. Rendering either to
  // inspect one banner is not feasible, so the banner's GATE is checked in source
  // and its LOGIC is checked behaviourally above. Comments are stripped first:
  // the comment explaining this repair necessarily quotes "July 4, 2026" and
  // "isSection48eEnabled()", and a raw scan would match the explanation.
  const PAGES = [
    ['app/proposals/page.tsx',            read('app', 'proposals', 'page.tsx')],
    ['app/proposals/view/[id]/page.tsx',  read('app', 'proposals', 'view', '[id]', 'page.tsx')],
  ] as const;

  for (const [name, raw] of PAGES) {
    const src = stripComments(raw);

    it(`${name} no longer hardcodes the safe-harbor date`, () => {
      expect(src, `${name} still hardcodes a July 4, 2026 deadline in its copy`)
        .not.toMatch(/July\s*4,?\s*2026/);
      expect(src, `${name} does not call the deadline accessor`)
        .toContain('formatSection48eDeadline()');
    });

    it(`${name} gates the §48E banner on isSection48eOfferable`, () => {
      expect(src, `${name} does not call isSection48eOfferable`)
        .toContain('isSection48eOfferable(');
      // The old gate must not survive as the banner's condition. `{isSection48eEnabled() ?`
      // is the exact shape both pages used.
      expect(src, `${name} still opens the banner on isSection48eEnabled() alone`)
        .not.toMatch(/\{\s*isSection48eEnabled\(\)\s*\?/);
    });
  }
});
