/**
 * tests/repealedItcNeverReachesAQuote.test.ts
 *
 * A HOMEOWNER WAS BEING SHOWN A 30% FEDERAL CREDIT THAT NO LONGER EXISTS.
 *
 * 🚨 THE GUARD WAS PRESENT, CORRECT, AND UNREACHABLE.
 *
 * `lib/incentivesConfig.ts` has carried `allow_itc: false` since P.L. 119-21
 * repealed §25D for residential expenditures after 2025-12-31, and says so in
 * its own comment. `lib/pricingEngine.ts` reads `row.itcRateResidential ?? 0`,
 * which looks like exactly the right protection.
 *
 * It could never fire. `lib/db/pricing.ts` returned `?? 30` when the column was
 * null, so by the time the engine applied `?? 0` the value was 30, not null.
 * The column is nullable and NO REGISTERED MIGRATION CREATES IT — the only DDL
 * is an inline `CREATE TABLE` with `DEFAULT 30` — so 30% was the resting state.
 *
 * That number did not stay in the pricing layer. `app/api/production/route.ts`
 * multiplies it into `itcAmount`, subtracts it to get `netCost`, and divides
 * that by annual savings to produce a PAYBACK YEAR which is persisted in the
 * stored cost estimate and shown to the customer. The same file carries a
 * comment stating the residential rate is "0 after the P.L.119-21 repeal"
 * while reading 30.
 *
 * This is the same defect class as a regex that cannot match: the protection
 * reads correctly, passes review, and does nothing. A defaulted-away null is
 * indistinguishable from a real value, and `?? ` is where it happens.
 *
 * WHAT IS GUARDED
 *   1. `isItcEnabled()` — not a literal — decides whether a residential rate
 *      survives at all, so an admin typing 30 into the pricing config cannot
 *      reinstate a repealed credit.
 *   2. Commercial §48E is untouched. It is LIVE at 30% through the safe-harbor
 *      deadline, and zeroing it would be the opposite error.
 *   3. No `?? 30` residential fallback survives anywhere on a quoting path.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import {
  isItcEnabled,
  guardItcValue,
  isSection48eEnabled,
  getSection48eRate,
  GLOBAL_INCENTIVES_CONFIG,
} from '../lib/incentivesConfig';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const DB_PRICING = read('lib', 'db', 'pricing.ts');
const PRICING_ROUTE = read('app', 'api', 'pricing', 'route.ts');
const PROPOSALS_PAGE = read('app', 'proposals', 'page.tsx');
const DB_LEGACY = read('lib', 'db.ts');

describe('🚨 the residential credit is repealed and the code agrees', () => {
  it('§25D is off, and that is the authority', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.allow_itc,
      'allow_itc was re-enabled — §25D is repealed for expenditures after 2025-12-31')
      .toBe(false);
    expect(isItcEnabled()).toBe(false);
  });

  it('the failsafe still zeroes a leaked amount', () => {
    expect(guardItcValue(7500, 'test')).toBe(0);
  });

  it('commercial §48E is LIVE and must not be collaterally zeroed', () => {
    // The opposite error. §48E is a real credit through the safe harbor, and a
    // repair that zeroed it would understate every commercial quote.
    expect(isSection48eEnabled()).toBe(true);
    expect(getSection48eRate()).toBe(30);
  });
});

describe('🚨 the read layer cannot hand a repealed rate downstream', () => {
  it('the residential rate is gated on the authority, not on a literal', () => {
    // 🚨 THE POINT IS THE GATE, NOT THE DEFAULT. Defaulting to 0 alone would
    // still let an admin type 30 into the pricing config and reinstate a
    // repealed credit for every quote after it.
    expect(DB_PRICING).toMatch(
      /itcRateResidential:\s*isItcEnabled\(\) \? \(\(row\.itc_rate_residential as number\) \?\? 0\) : 0/,
    );
    expect(DB_PRICING).toMatch(/import \{ isItcEnabled \} from '\.\.\/incentivesConfig'/);
  });

  it('🚨 no `?? 30` residential fallback survives on a quoting path', () => {
    // Each of these fed a customer-visible number.
    for (const [name, src] of [
      ['lib/db/pricing.ts', DB_PRICING],
      ['app/api/pricing/route.ts', PRICING_ROUTE],
      ['app/proposals/page.tsx', PROPOSALS_PAGE],
    ] as const) {
      expect(src, `${name} still defaults the residential ITC to 30`)
        .not.toMatch(/itcRateResidential[^\n]*\?\?\s*30/);
      expect(src, `${name} still defaults the residential ITC to 30`)
        .not.toMatch(/itcRateResidential:\s*30/);
    }
  });

  it('a NEW config row is not born carrying the credit', () => {
    expect(DB_PRICING, 'the insert still writes 30 for residential')
      .toMatch(/\$\{data\.itcRateResidential \?\? 0\}/);
    expect(PRICING_ROUTE, 'the table DDL still defaults residential to 30')
      .toMatch(/itc_rate_residential\s+DOUBLE PRECISION NOT NULL DEFAULT 0/);
  });

  it('commercial keeps its 30 in all of those places', () => {
    // Proving the sweep was surgical rather than a blanket find-and-replace.
    expect(DB_PRICING).toMatch(/itcRateCommercial:\s*\(row\.itc_rate_commercial as number\) \?\? 30/);
    expect(PRICING_ROUTE).toMatch(/itc_rate_commercial\s+DOUBLE PRECISION NOT NULL DEFAULT 30/);
    expect(PROPOSALS_PAGE).toMatch(/itcRateCommercial \?\? 30/);
  });

  it('🚨 the legacy in-memory default no longer contradicts the authority', () => {
    // It carried `taxCreditRate: 30` with a comment asserting P.L. 119-21 "has
    // NOT been enacted" — an instruction to the next reader to keep applying a
    // repealed credit. A wrong comment outlives a wrong number, because the
    // number gets fixed and the comment teaches someone to put it back.
    expect(DB_LEGACY).toMatch(/taxCreditRate:\s*0/);

    // 🚨 SEARCHED IN THE COMMENTS, WHICH IS WHERE THIS DEFECT LIVED. Reading
    // raw source on purpose — the claim was never code. It appeared TWICE, and
    // the second copy (in the proposals page) said the repealing act was "a
    // hypothetical future bill", which is why an earlier attempt to fix the
    // number was evidently abandoned.
    for (const f of [['lib', 'db.ts'], ['app', 'proposals', 'page.tsx']] as const) {
      const raw = readFileSync(join(ROOT, ...f), 'utf8');
      expect(raw, `${f.join('/')} still tells the reader the repeal never happened`)
        .not.toMatch(/has NOT been enacted/);
      expect(raw, `${f.join('/')} still calls the repealing act hypothetical`)
        .not.toMatch(/hypothetical future bill/);
    }
  });
});

describe('the arithmetic that reaches the customer', () => {
  /** The exact shape app/api/production/route.ts computes. */
  function quote(cashPrice: number, isCommercial: boolean, cfg: { itcRateCommercial: number; itcRateResidential: number }) {
    const itcPercent = isCommercial ? cfg.itcRateCommercial : cfg.itcRateResidential;
    const itcAmount = Math.round(cashPrice * ((itcPercent ?? 0) / 100));
    const netCost = cashPrice - itcAmount;
    const annualSavings = 2000;
    return { itcAmount, netCost, paybackYears: parseFloat((netCost / annualSavings).toFixed(1)) };
  }

  it('🚨 a residential quote carries no federal credit, and its payback is honest', () => {
    // With the old default this returned a $9,000 credit and a 10.5-year
    // payback on a $30,000 system. Both were fiction.
    const cfg = { itcRateCommercial: 30, itcRateResidential: 0 };
    const q = quote(30_000, false, cfg);
    expect(q.itcAmount, 'a repealed credit is still being subtracted').toBe(0);
    expect(q.netCost).toBe(30_000);
    expect(q.paybackYears).toBe(15);
  });

  it('and the number it used to show, for contrast', () => {
    // Kept as an explicit record of the size of the error: 30% of the system
    // price, and a payback understated by four and a half years.
    const wrong = quote(30_000, false, { itcRateCommercial: 30, itcRateResidential: 30 });
    expect(wrong.itcAmount).toBe(9_000);
    expect(wrong.paybackYears).toBe(10.5);
  });

  it('a commercial quote still gets §48E', () => {
    const q = quote(30_000, true, { itcRateCommercial: 30, itcRateResidential: 0 });
    expect(q.itcAmount).toBe(9_000);
  });
});
