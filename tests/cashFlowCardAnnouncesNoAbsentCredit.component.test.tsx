/** @vitest-environment jsdom */
/**
 * tests/cashFlowCardAnnouncesNoAbsentCredit.component.test.tsx
 *
 * 🚨 THE CUSTOMER PROPOSAL PRINTED "Tax credit (0%) −$0 … federal ITC applied"
 *    ON EVERY PROJECT.
 *
 * §25D was repealed for expenditures after 2025-12-31 (P.L. 119-21), so the
 * canonical pipeline computes itcRate 0 and itcAmount $0 for every residential
 * proposal — correctly. The Cash-Flow Story Card rendered the tax-credit tile
 * anyway, unconditionally, in emerald, with a rising-trend icon and the caption
 * "federal ITC applied". Beside it sat "Net cost … after incentives" showing a
 * figure identical to the gross price.
 *
 * So the homeowner read an explicit claim that a federal credit HAD been applied,
 * and then a zero. An absent credit is not a $0 credit; it is not a line item.
 * And "after incentives" on a number equal to the gross price is a claim that
 * incentives were deducted when none were.
 *
 * WHAT IS GUARDED, AND IN BOTH DIRECTIONS:
 *   • itcRate 0  → no tile, no "federal ITC applied", and the net figure is
 *                  labelled "Total investment … no incentives deducted".
 *   • itcRate 30 → the tile is BACK, with its dollar amount and "after
 *                  incentives". Commercial §48E is live at 30% and a repair that
 *                  hid a real credit would be the opposite error — this repo has
 *                  made that mistake before, which is why the gate reads the
 *                  canonical rate and NOT isItcEnabled().
 *
 * This is a real render in jsdom, not a source scan: the defect was what the
 * homeowner SAW.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CashFlowStoryCard } from '@/components/proposal/CashFlowStoryCard';
import type {
  CanonicalUtility,
  CanonicalFinancial,
  CanonicalTruth25yr,
} from '@/lib/proposal/canonicalProposal';

afterEach(() => cleanup());

const GROSS = 30_000;

function utility(): CanonicalUtility {
  return {
    provider: 'Ameren Illinois',
    rate: 0.13,
    annualUsageKwh: 12_000,
    escalationRate: 0.03,
    escalationRateSource: 'profile',
    escalationRateSourceLabel: 'utility profile',
    netMeteringType: 'retail_1to1',
    exportRate: 0.13,
    rateHistory: [],
  } as unknown as CanonicalUtility;
}

/** A financial block with the ITC fields under test; everything else is inert. */
function financial(itcRate: number): CanonicalFinancial {
  const itcAmount = Math.round(GROSS * (itcRate / 100));
  return {
    gross_system_cost: GROSS,
    systemCost: GROSS,
    pricePerWatt: 3.1,
    solarPaymentMonthly: 0,
    utilityBillMonthly: 40,
    totalMonthlyCost: 40,
    currentMonthlyBill: 150,
    ownershipDeltaMonthly: -110,
    financeApr: 0,
    financeTermYears: 0,
    financeTermMonths: 0,
    lenderTermsOnFile: false,
    year1BillWithoutSolar: 1800,
    year1BillWithSolar: 480,
    annualEnergyValue: 1_500,
    itcRate,
    itcAmount,
    netCost: GROSS - itcAmount,
    paybackYears: 15,
    energyValueBreakdown: { selfConsumed: 1_400, exported: 100, total: 1_500 },
  } as unknown as CanonicalFinancial;
}

/** Empty yearlyFlow so the inline chart is skipped — this card's own fallback. */
function truth25yr(): CanonicalTruth25yr {
  return {
    utilityCostWithoutSolar: 60_000,
    solarCostTotal: GROSS,
    remainingUtilityCost: 12_000,
    netDifference: 18_000,
    netDifferenceFinanced: 18_000,
    estimatedEnergyValue: 48_000,
    netFinancialDifference: 18_000,
    srec_income_25yr: 0,
    monthlyBillChart: [],
    projectionChart: [],
    yearlyFlow: [],
  } as unknown as CanonicalTruth25yr;
}

const renderCard = (itcRate: number) =>
  render(
    <CashFlowStoryCard
      utility={utility()}
      financial={financial(itcRate)}
      truth25yr={truth25yr()}
    />,
  ).container.textContent ?? '';

describe('🚨 a repealed credit gets no tile on the customer proposal', () => {
  it('itcRate 0 prints no tax-credit tile at all', () => {
    const text = renderCard(0);
    expect(text, 'the card still claims a federal ITC was applied')
      .not.toContain('federal ITC applied');
    expect(text, 'the card still shows a Tax credit line')
      .not.toContain('Tax credit');
    // The specific rendered string a homeowner used to read.
    expect(text).not.toContain('Tax credit (0%)');
  });

  it('the net figure is not captioned "after incentives" when none were deducted', () => {
    const text = renderCard(0);
    expect(text, '"after incentives" on a figure equal to the gross price')
      .not.toContain('after incentives');
    expect(text).toContain('Total investment');
    expect(text).toContain('no incentives deducted');
    // And it is still the gross price — the arithmetic was never the problem.
    expect(text).toContain('$30,000');
  });

  it('the upfront cost is still shown — this is a suppression, not a deletion', () => {
    const text = renderCard(0);
    expect(text).toContain('Upfront cost');
    expect(text).toContain('gross system price');
  });
});

describe('a credit that DOES exist is still shown — no collateral zeroing', () => {
  it('itcRate 30 restores the tile, the amount and the "after incentives" caption', () => {
    // Commercial §48E is live at 30%. Hiding it would be the opposite error.
    const text = renderCard(30);
    expect(text, 'a real 30% credit is being suppressed').toContain('Tax credit (30%)');
    expect(text).toContain('federal ITC applied');
    expect(text).toContain('$9,000');
    expect(text).toContain('Net cost');
    expect(text).toContain('after incentives');
    expect(text).not.toContain('no incentives deducted');
  });
});
