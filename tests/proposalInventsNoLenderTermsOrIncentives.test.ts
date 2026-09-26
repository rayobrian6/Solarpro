/**
 * tests/proposalInventsNoLenderTermsOrIncentives.test.ts
 *
 * THREE DEFECTS IN THE CANONICAL MONEY OBJECT AND THE DOCUMENT RENDERED FROM IT.
 * All three are behavioural: build a CanonicalProposal, render the HTML, and
 * assert what the object and the document actually contain.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A5 — A 25-YEAR LOAN AT 7.99% APR THAT NO LENDER HAD QUOTED.
 *
 * `loanApr`, `loanTermYears` and `purchaseMode` are read off the pricing config
 * and NOTHING in the repo writes them: `rowToPricingConfig` (lib/db/pricing.ts)
 * maps neither `loan_apr` nor `loan_term_years` nor `purchase_mode`, the pricing
 * route's DEFAULT_CONFIG does not carry them, and there is no admin field,
 * column or API parameter. So `?? 7.99` / `?? 25` in buildCanonicalProposal was
 * not a fallback — it was the resting state of every financed proposal in the
 * product, printed beside the words "Subject to lender approval".
 *
 * On shipped defaults that is $226/mo on a $29,280 system. A real dealer product
 * at 5.99% is $189 and at 9.99% is $266, so the payment the homeowner read could
 * be ±20% out with no way for the installer to correct it — and every derived
 * figure inherited it: total_energy_cost_monthly, ownershipDeltaMonthly, the
 * "fixed at $X/mo" copy and the three-column Loan Term Comparison.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A6 — `cp.incentives.state_incentives` HAD NO WRITER, AND THE §25D DISCLOSURE
 *      SAT BEHIND AN IMPORT THAT WAS NEVER CALLED.
 *
 * The array was initialised to `[]` with the comment "populated below only when
 * state incentives are globally on", and nothing below it ever populated it.
 * `areStateIncentivesEnabled` and `getIncentivesComplianceMessage` were both
 * imported into buildCanonicalProposal and neither was called. Consequence: in
 * Arizona the web proposal page showed "Arizona Solar Tax Credit $1,000" and a
 * cash total (it calls calculateIncentives itself), while the server-rendered
 * document said "State & Local Incentives — Ask Us", omitted the $1,000 from
 * Total Potential Value, and told a residential homeowner "Federal incentives
 * may apply" — a hedge, where the codebase's own P.L. 119-21 disclosure was
 * sitting one unused import away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A2 (companion) — THE DOCUMENT WOULD HAVE PRINTED "3000%".
 *
 * `renderProposalHTML` formatted the ITC rate as `fmtPct(f.itcRate * 100)` in
 * three places. `itcRate` is ALREADY a percent (30, not 0.30) — the line four
 * rows below correctly treats `financeApr` as a decimal, which is what made the
 * mistake look right. Latent only because the rate is 0 today: the day any ITC is
 * enabled the proposal prints a 3000% federal credit.
 */

import { describe, it, expect } from 'vitest';
import { buildCanonicalProposal, type BuildCanonicalProposalInput } from '@/lib/proposal/buildCanonicalProposal';
import { renderProposalHTML } from '@/lib/proposal/renderProposalHTML';
import type { CanonicalProposal } from '@/lib/proposal/canonicalProposal';
import type { Proposal } from '@/types';
import { getIncentivesComplianceMessage } from '@/lib/incentivesConfig';

const GROSS = 29_280;

function makeInput(overrides: Partial<BuildCanonicalProposalInput> = {}): BuildCanonicalProposalInput {
  return {
    panelSpec: { manufacturer: 'Maxeon', model: 'MAX3-400-BLK', wattage: 400, efficiency: 22.3 },
    panelCount:           20,
    layoutSystemSizeKw:   8.0,
    annualProductionKwh:  11_200,
    monthlyProductionKwh: [700, 800, 1000, 1050, 1100, 1080, 1070, 1040, 940, 820, 620, 580],
    utilityName:          'ComEd',
    stateCode:            'IL',
    clientState:          'Illinois',
    annualUsageKwh:       12_000,
    systemType:           'roof',
    storedCashPrice:      GROSS,
    purchaseMode:         'finance',
    ...overrides,
  };
}

/** A Proposal shell just rich enough for renderProposalHTML. */
function shell(cp: CanonicalProposal): Proposal {
  return {
    id: 'p1',
    projectId: 'proj1',
    title: 'Solar Proposal',
    status: 'sent',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    project: {
      name: 'Test Project',
      client: { name: 'Jane Doe' },
      layout: { totalPanels: cp.panel.count },
    },
  } as unknown as Proposal;
}

const html = (cp: CanonicalProposal) => renderProposalHTML(cp, shell(cp), { companyName: 'SolarPro' });

// ═══════════════════════════════════════════════════════════════════════════
// A5
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A5 — no lender terms on file means no APR and no payment', () => {
  it('the pipeline reports lenderTermsOnFile false and zeroes every finance field', () => {
    // This is the SHIPPED input: pricingCfg.loanApr and .loanTermYears are
    // undefined on every real call, because nothing writes them.
    const cp = buildCanonicalProposal(makeInput());
    expect(cp.financial.lenderTermsOnFile,
      'the pipeline claims lender terms exist when nothing wrote any').toBe(false);
    expect(cp.financial.financeApr, 'an APR was invented').toBe(0);
    expect(cp.financial.financeTermYears, 'a loan term was invented').toBe(0);
    expect(cp.financial.financeTermMonths).toBe(0);
    expect(cp.financial.solarPaymentMonthly, 'a monthly payment was invented').toBe(0);
  });

  it('🚨 specifically: not 7.99%, not 25 years, and not $226/mo', () => {
    // The exact numbers the product used to print. Named so a future reader can
    // see what "invented" meant in dollars.
    const cp = buildCanonicalProposal(makeInput());
    expect(cp.financial.financeApr).not.toBeCloseTo(0.0799, 4);
    expect(cp.financial.financeTermYears).not.toBe(25);
    expect(cp.financial.solarPaymentMonthly).not.toBe(226);
  });

  it('the rendered document prints no APR row and no monthly payment row', () => {
    const out = html(buildCanonicalProposal(makeInput()));
    expect(out, 'the document still prints a Finance APR row').not.toContain('Finance APR');
    expect(out, 'the document still prints a Monthly Solar Payment row')
      .not.toContain('Monthly Solar Payment');
    expect(out, 'the document still prints an invented 7.99% APR').not.toContain('7.99%');
    // And it says why, rather than silently dropping the rows.
    expect(out).toContain('no lender terms are on file');
  });

  it('a REAL lender term restores the APR, the term and the payment', () => {
    // The suppression must be conditional, not a deletion: the day a lender
    // product exists the proposal has to quote it.
    const cp = buildCanonicalProposal(makeInput({ loanApr: 5.99, loanTermYears: 20 }));
    expect(cp.financial.lenderTermsOnFile).toBe(true);
    expect(cp.financial.financeApr).toBeCloseTo(0.0599, 4);
    expect(cp.financial.financeTermYears).toBe(20);
    expect(cp.financial.solarPaymentMonthly).toBeGreaterThan(0);

    const out = html(cp);
    expect(out).toContain('Finance APR');
    expect(out).toContain('5.99%');
    expect(out).not.toContain('no lender terms are on file');
  });

  it('a CASH purchase prints no finance rows even with lender terms on file', () => {
    // `pricing_config.purchase_mode` has no writer either, so the server PDF
    // route always resolved 'finance' and showed a cash buyer a loan payment.
    // Two independent conditions; both are required.
    const cp = buildCanonicalProposal(makeInput({ loanApr: 5.99, loanTermYears: 20, purchaseMode: 'cash' }));
    const out = html(cp);
    expect(out, 'a cash proposal still prints an APR row').not.toContain('Finance APR');
    expect(out).toContain('Cash — no financing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A6
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A6 — one state-incentive authority feeds both surfaces', () => {
  it('Arizona populates state_incentives and total_incentives on the canonical object', () => {
    // The web page has always shown the Arizona Solar Tax Credit. The canonical
    // object — and therefore the document — showed nothing.
    const cp = buildCanonicalProposal(makeInput({ stateCode: 'AZ', clientState: 'Arizona', utilityName: 'APS' }));
    expect(cp.incentives.state_incentives.length,
      'state_incentives is still the empty array with no writer').toBeGreaterThan(0);
    expect(cp.incentives.state_incentives_enabled).toBe(true);

    const azCredit = cp.incentives.state_incentives.find(s => s.type === 'state_tax_credit');
    expect(azCredit, 'the Arizona state tax credit is missing from the document').toBeTruthy();
    expect(azCredit!.estimated_value).toBeGreaterThan(0);
    expect(cp.incentives.total_incentives,
      'total_incentives still ignores state cash incentives').toBeGreaterThan(0);
  });

  it('the document names the Arizona credit and its dollar amount', () => {
    const cp = buildCanonicalProposal(makeInput({ stateCode: 'AZ', clientState: 'Arizona', utilityName: 'APS' }));
    const out = html(cp);
    expect(out, 'the document still says "Ask Us" for a known state credit')
      .toContain('State &amp; Local Programs');
    const az = cp.incentives.state_incentives.find(s => s.type === 'state_tax_credit')!;
    expect(out).toContain(az.name);
  });

  it('the document carries the §25D repeal disclosure, not "Federal incentives may apply"', () => {
    const cp = buildCanonicalProposal(makeInput({ stateCode: 'AZ', clientState: 'Arizona', utilityName: 'APS' }));
    expect(cp.incentives.compliance_message).toBe(getIncentivesComplianceMessage());
    expect(cp.incentives.compliance_message).toContain('§25D');
    expect(cp.incentives.compliance_message).toContain('P.L. 119-21');

    const out = html(cp);
    expect(out, 'the document still hedges where the codebase is certain')
      .not.toContain('Federal incentives may apply');
    expect(out).toContain('P.L. 119-21');
  });

  it('🚨 an SREC/TREC row never carries a dollar value — the REC contract has ONE number', () => {
    // calculateIncentives derives a generic $/kWh REC estimate; the canonical
    // projection derives the program-year contract value. Both on one proposal
    // was a ~$3,400 disagreement about the same REC contract.
    const cp = buildCanonicalProposal(makeInput({ stateCode: 'IL', utilityName: 'Ameren Illinois' }));
    for (const s of cp.incentives.state_incentives) {
      if (s.type === 'srec' || s.type === 'trec') {
        expect(s.estimated_value,
          `${s.name} carries a second, contradictory REC dollar value`).toBe(0);
      }
    }
    // And it is not excluded from total_incentives via a different route either.
    const recRows = cp.incentives.state_incentives.filter(s => s.type === 'srec' || s.type === 'trec');
    expect(recRows.length, 'the IL fixture no longer produces an SREC row — test is vacuous')
      .toBeGreaterThan(0);
  });

  it('an unknown state degrades to an empty list while a known one does not', () => {
    // 🚨 THE KNOWN-STATE HALF IS WHAT MAKES THIS DISCRIMINATE. Asserting only
    // that 'ZZ' yields [] passes against the original defect too, because the
    // array was ALWAYS [] — a guard satisfied by the bug it exists to catch.
    const unknown = buildCanonicalProposal(makeInput({ stateCode: 'ZZ', clientState: '' }));
    expect(unknown.incentives.state_incentives).toEqual([]);
    expect(unknown.incentives.total_incentives).toBe(0);

    const known = buildCanonicalProposal(makeInput({ stateCode: 'AZ', clientState: 'Arizona', utilityName: 'APS' }));
    expect(known.incentives.state_incentives.length,
      'a known state is as empty as an unknown one — the writer is still missing')
      .toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A2 companion
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A2 companion — the ITC rate is a percent, and the document formats it as one', () => {
  it('a 30% credit prints "30%", never "3000%"', () => {
    // itcRate cannot be non-zero through the shipped pipeline today (§25D is
    // repealed and commercial §48E is gated the same way), so the object is
    // patched directly. That is the point: the formatting bug is LATENT, and it
    // fires the day any credit is enabled.
    const cp = buildCanonicalProposal(makeInput());
    const patched: CanonicalProposal = {
      ...cp,
      financial: { ...cp.financial, itcRate: 30, itcAmount: Math.round(GROSS * 0.3), netCost: GROSS - Math.round(GROSS * 0.3) },
    };
    const out = html(patched);
    expect(out, 'the document prints a 3000% federal tax credit').not.toContain('3000%');
    expect(out).toContain('Federal ITC (30%)');
  });

  it('the finance APR beside it is still treated as a decimal', () => {
    // ⚠️ NOT A DEFECT DISCRIMINATOR — SAID PLAINLY. `financeApr` was already
    // formatted correctly, so this assertion passes against the original file
    // too. It is here only as a regression guard: the two fields have DIFFERENT
    // units, and "fix the ITC row by copying the APR row" is exactly how the
    // 3000% bug got written in the first place. Do not count it as evidence.
    const cp = buildCanonicalProposal(makeInput({ loanApr: 7.5, loanTermYears: 15 }));
    const out = html(cp);
    expect(out).toContain('7.50%');
    expect(out).not.toContain('750.00%');
  });
});
