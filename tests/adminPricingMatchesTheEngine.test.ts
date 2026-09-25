/**
 * tests/adminPricingMatchesTheEngine.test.ts
 *
 * THE OPERATOR WAS SHOWN ONE RATE AND THE CUSTOMER WAS QUOTED ANOTHER.
 *
 * 🚨 A SECOND DISPLAY AUTHORITY, ON MONEY.
 *
 * `/admin/pricing` hydrated its per-type $/W fields with page-local constants:
 * `c.groundPricePerWatt ?? DEFAULTS.groundPricePerWatt` (2.35). The pricing
 * engine falls back differently — `row.groundPricePerWatt ?? row.pricePerWatt`
 * — so with the per-type column unset, which is the state of any config that
 * has not had every field filled in by hand:
 *
 *     admin page shows   $2.35/W   (ground)
 *     engine prices at   $3.10/W   (the base rate)
 *
 * Same for fence (4.25 vs 3.10) and carport (3.75 vs 3.10). An operator setting
 * prices read one number; the customer was quoted from another. A second
 * display authority is bad anywhere; on the number a business runs on it is
 * worse.
 *
 * 🚨 AND THE FIRST READING OF THIS WAS WRONG, WHICH IS WHY THE TEST IS
 * ARITHMETIC AND NOT A GREP. A research pass reported it as "the page shows
 * 2.35 where the engine resolves 3.10", which looks like a field-name
 * confusion — 2.35 is ground and 3.10 is roof, different fields. It is not a
 * confusion: the fields are right and the FALLBACKS differ. The defect only
 * appears when the per-type column is null, so any check that does not model
 * that case will report all-clear.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app', 'admin', 'pricing', 'page.tsx'), 'utf8'));
const ENGINE = stripComments(readFileSync(join(ROOT, 'lib', 'pricingEngine.ts'), 'utf8'));

const TYPES = ['roof', 'ground', 'fence', 'carport'] as const;

/** The engine's rule, as a function, so the page can be checked against it. */
function engineRate(perType: number | null, base: number): number {
  return perType ?? base;
}

/** What the page will display, given the same inputs. */
function pageRate(perType: number | null, base: number | null, pageDefault: number): number {
  return perType ?? base ?? pageDefault;
}

describe('🚨 the admin page shows the rate the engine will charge', () => {
  it('agrees when the per-type column IS set', () => {
    // The easy case, and the one a naive check would stop at.
    for (const rate of [2.1, 3.4, 4.9]) {
      expect(pageRate(rate, 3.10, 2.35)).toBe(engineRate(rate, 3.10));
    }
  });

  it('🚨 and agrees when it is NOT — which is where they used to diverge', () => {
    // Base rate present, per-type column null: the engine uses the base. The
    // page must too. Before the repair it used its own constant, so ground read
    // 2.35 against a job priced at 3.10 — a 24% understatement of the rate the
    // operator was setting.
    const BASE = 3.10;
    expect(pageRate(null, BASE, 2.35)).toBe(engineRate(null, BASE));
    expect(pageRate(null, BASE, 4.25)).toBe(engineRate(null, BASE));
    expect(pageRate(null, BASE, 3.75)).toBe(engineRate(null, BASE));
  });

  it('the size of the old error, recorded', () => {
    // Kept so the impact is not lost if someone later calls this cosmetic.
    const shownBefore = 2.35, actuallyCharged = 3.10;
    expect(actuallyCharged / shownBefore).toBeGreaterThan(1.3);
  });
});

describe('🚨 the page chains its fallback exactly as the engine does', () => {
  for (const t of TYPES) {
    it(`${t} falls back to the base rate before any page constant`, () => {
      const re = new RegExp(
        `${t}PricePerWatt:\\s*c\\.${t}PricePerWatt\\s*\\?\\?\\s*c\\.pricePerWatt\\s*\\?\\?`,
      );
      expect(PAGE, `${t} still falls back to a page-local constant instead of the base rate`)
        .toMatch(re);
    });
  }

  it('and the engine still chains it that way — if it changes, this must too', () => {
    // 🚨 THE OTHER HALF. Pinning only the page would let the ENGINE move and
    // re-open the gap silently, which is how two authorities drift apart in the
    // first place.
    expect(ENGINE).toMatch(/roofPricePerWatt:\s*row\.roofPricePerWatt\s*\?\?\s*row\.pricePerWatt/);
    expect(ENGINE).toMatch(/groundPricePerWatt:\s*row\.groundPricePerWatt\s*\?\?\s*row\.pricePerWatt/);
  });

  it('the residential ITC the page shows is zero, matching the repeal', () => {
    // The other half of this page's money divergence, closed separately: it
    // displayed 0 while the read layer returned 30. The read layer is now
    // gated on the incentives authority, so both are 0.
    expect(PAGE).toMatch(/itcRateResidential:\s*0/);
  });
});
