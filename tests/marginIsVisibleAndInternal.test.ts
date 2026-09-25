/**
 * tests/marginIsVisibleAndInternal.test.ts
 *
 * THE INSTALLER'S MARGIN LIVED IN A SPREADSHEET OUTSIDE THE PRODUCT.
 *
 * The competitor failure hunt catalogued what makes operators distrust or
 * abandon design tools. One finding had no counterexample anywhere in the
 * category: **nobody shows an installer their margin on the design screen.**
 *
 *   - An Aurora user, on camera, calls it a "half product": "There's no way for
 *     solar installers to see their profit margins using this software."
 *   - A UK installer names the artefact the hunt was looking for: "we use a
 *     separate pricing spreadsheet and just add the manual total into Open
 *     Solar."
 *
 * A spreadsheet outside the product is where a design tool loses the person
 * using it — every number in it is one the tool could have been trusted with.
 *
 * 🚨 AND SOLARPRO WAS ALREADY COMPUTING IT AND THROWING IT AWAY.
 * `lib/pricingEngine.ts` computes `grossProfit` and `marginPercent` under a
 * heading that literally reads "Internal"; `/api/production` returns them as
 * `internalProfit` / `internalMargin`; `DesignStudio` has held them in
 * `costEstimate` state the whole time. Nothing rendered them. This is a
 * presentation layer over an existing authority, not a second one.
 *
 * TWO PROPERTIES ARE GUARDED, AND THE SECOND MATTERS MORE:
 *   1. the design screen shows it;
 *   2. it NEVER reaches a homeowner — not a proposal, not a plan set, not the
 *      customer portal. An installer's cost basis leaking to the customer they
 *      are quoting is a commercial injury, and it is the kind of leak that
 *      happens by a well-meaning copy-paste of a panel that "already works".
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/stripSource';
import { calculateProfitMargin } from '../lib/pricingEngine';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => stripComments(readFileSync(join(ROOT, ...p), 'utf8'));

const STUDIO = read('components', 'design', 'DesignStudio.tsx');

/** Every surface a homeowner can see. */
const CUSTOMER_FACING = [
  ['app', 'proposals', 'view', '[id]', 'page.tsx'],
  ['app', 'portal', 'dashboard', 'page.tsx'],
  ['lib', 'proposal', 'buildCanonicalProposal.ts'],
  ['lib', 'proposalPDF.ts'],
  ['lib', 'drafting', 'templates', 'roof.ts'],
];

const INTERNAL_FIELDS = ['internalMargin', 'internalProfit', 'internalCost', 'internalRevenue'];

describe('🚨 the design screen shows the installer their margin', () => {
  it('all four internal figures are DISPLAYED, not merely referenced', () => {
    // 🚨 REFERENCED IS NOT DISPLAYED. A first version asserted only that the
    // field appeared somewhere in the file — and a mutation that replaced the
    // rendered margin with a dash sailed through, because the colour-class
    // expression still referenced it. Each field must reach a formatter, which
    // is the only thing a person actually reads.
    const display: Record<string, RegExp> = {
      internalMargin:  /costEstimate\.internalMargin \?\? 0\)\.toFixed\(/,
      internalProfit:  /Math\.round\(costEstimate\.internalProfit \?\? 0\)\.toLocaleString\(/,
      internalCost:    /Math\.round\(costEstimate\.internalCost\)\.toLocaleString\(/,
      internalRevenue: /Math\.round\(costEstimate\.internalRevenue \?\? 0\)\.toLocaleString\(/,
    };
    for (const f of INTERNAL_FIELDS) {
      expect(STUDIO, `${f} is computed and returned by the API but is not formatted for display`)
        .toMatch(display[f]);
    }
  });

  it('it is labelled as internal, so nobody screenshots it for a customer', () => {
    expect(STUDIO).toMatch(/Your margin/);
    expect(STUDIO).toMatch(/Internal only/);
  });

  it('🚨 it is hidden when there is no cost basis, rather than claiming 100%', () => {
    // A margin computed against a zero cost is not a margin. An installer would
    // quote from it.
    expect(STUDIO).toMatch(/costEstimate\.internalCost > 0 \?/);
  });

  it('it renders no figure of its own — the engine is the authority', () => {
    // If this block ever computed a margin locally it would drift from the
    // number the proposal is priced against, which is the whole defect class
    // this campaign has been closing.
    const i = STUDIO.indexOf('Your margin');
    expect(i).toBeGreaterThan(-1);
    const block = STUDIO.slice(i, STUDIO.indexOf('Generate Proposal', i));
    expect(block, 'the margin panel is computing a figure instead of displaying one')
      .not.toMatch(/internalRevenue\s*-\s*internalCost|\/\s*costEstimate\.internalRevenue/);
  });
});

describe('🚨 and it never reaches the homeowner', () => {
  for (const parts of CUSTOMER_FACING) {
    const rel = parts.join('/');
    it(`${rel} carries no internal cost or margin`, () => {
      const full = join(ROOT, ...parts);
      if (!existsSync(full)) return;             // file moved; other guards cover it
      const src = stripComments(readFileSync(full, 'utf8'));
      for (const f of INTERNAL_FIELDS) {
        expect(src, `${rel} references ${f} — an installer's cost basis must never reach the customer they are quoting`)
          .not.toMatch(new RegExp(`\\b${f}\\b`));
      }
      expect(src, `${rel} references grossProfit`).not.toMatch(/\bgrossProfit\b/);
    });
  }
});

describe('the margin arithmetic itself', () => {
  it('is margin ON REVENUE, not markup on cost', () => {
    // The two differ and installers quote on the first. $10,000 revenue against
    // $7,500 cost is a 25% margin and a 33% markup; reporting the larger number
    // would flatter every job.
    expect(calculateProfitMargin(10_000, 7_500)).toBeCloseTo(25, 6);
  });

  it('a job sold below cost reports a NEGATIVE margin', () => {
    // It must not clamp at zero. A loss the installer cannot see is the one
    // thing worse than no margin display at all.
    expect(calculateProfitMargin(8_000, 10_000)).toBeLessThan(0);
  });

  it('and a zero-revenue job does not divide by zero', () => {
    expect(Number.isFinite(calculateProfitMargin(0, 5_000))).toBe(true);
  });
});
