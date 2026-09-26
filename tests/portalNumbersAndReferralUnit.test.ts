/**
 * tests/portalNumbersAndReferralUnit.test.ts
 *
 * THE ARITHMETIC AND THE LINK, ON THEIR OWN.
 *
 * tests/portalDashboardTellsOneTruth.component.test.tsx renders the portal and
 * proves the two cards AGREE. That is the finding. This file pins what they agree
 * ON — the actual numbers, from one system size — and the referral URL's shape,
 * because both are now single-sourced and a later "tidy-up" of either module would
 * otherwise only be caught by a React render.
 *
 * No source strings are matched here. Every assertion calls the real function.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateAnnualKwh,
  estimateCo2Tons,
  estimateAnnualSavingsUsd,
  estimateTreesEquivalent,
  projectedBenefits,
  US_AVG_RETAIL_RATE_USD_PER_KWH,
  TREES_PER_CO2_TON_YEAR,
} from '../lib/portal/production';
import {
  buildReferralUrl,
  REFERRAL_LANDING_PATH,
  REFERRAL_UTM_SOURCE,
} from '../lib/portal/referral';

// ═══════════════════════════════════════════════════════════════════════════
// 1. ONE SYSTEM, ONE SET OF NUMBERS
// ═══════════════════════════════════════════════════════════════════════════

describe('projectedBenefits — the portal\'s only source of these four figures', () => {
  it('derives everything from the one production estimate', () => {
    // 8.4 kW × 1370 = 11,508 kWh/yr. Everything else follows from that number,
    // not from a second multiplier.
    const b = projectedBenefits(8.4)!;
    expect(b.annualKwh).toBe(11508);
    expect(b.annualKwh).toBe(estimateAnnualKwh(8.4));
    expect(b.co2Tons).toBe(estimateCo2Tons(b.annualKwh));
    expect(b.annualSavings).toBe(estimateAnnualSavingsUsd(b.annualKwh));
    expect(b.treesEq).toBe(estimateTreesEquivalent(b.co2Tons));
  });

  it('and the figures are what the arithmetic says they are', () => {
    const b = projectedBenefits(8.4)!;
    expect(b.co2Tons).toBe(4.6);                       // 11,508 × 0.4 kg = 4,603 kg
    expect(b.annualSavings).toBe(1554);                // 11,508 × $0.135
    expect(b.treesEq).toBe(76);                        // 4.6 × 16.5
  });

  it('🚨 and NOT the figures the deleted local helper produced', () => {
    // `calcBenefits` used 1400 kWh/kW/yr and 0.386 kg/kWh. Spelled out once, so a
    // reintroduction by any route is caught here as well as in the render test.
    const b = projectedBenefits(8.4)!;
    expect(b.annualKwh).not.toBe(Math.round(8.4 * 1400));                 // 11,760
    expect(b.co2Tons).not.toBe(Math.round((11760 * 0.386) / 1000 * 10) / 10); // 4.5
  });

  it('returns null rather than zeros when there is no system size yet', () => {
    // A homeowner pre-design must not be shown "0 kWh/yr" — that is a claim.
    for (const v of [null, undefined, 0, -3, NaN, Infinity]) {
      expect(projectedBenefits(v as number | null)).toBeNull();
    }
  });

  it('the savings rate and trees factor are exported, so there is one of each', () => {
    expect(US_AVG_RETAIL_RATE_USD_PER_KWH).toBe(0.135);
    expect(TREES_PER_CO2_TON_YEAR).toBe(16.5);
    expect(estimateAnnualSavingsUsd(10000)).toBe(1350);
    expect(estimateTreesEquivalent(0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE REFERRAL LINK
// ═══════════════════════════════════════════════════════════════════════════

describe('buildReferralUrl', () => {
  const ID = '33333333-3333-4333-8333-333333333333';

  it('lands on the public intake funnel, never the portal login wall', () => {
    const url = buildReferralUrl('https://solarpro.solutions', ID)!;
    expect(url.startsWith(`https://solarpro.solutions${REFERRAL_LANDING_PATH}?`)).toBe(true);
    expect(url).not.toContain('/portal');
  });

  it('carries the referring client\'s id in a parameter the funnel forwards', () => {
    // /free-solar-estimate reads utm_* off its own query string and POSTs them to
    // /api/intake/homeowner, which persists them. That is why the id rides in
    // utm_content and not only in `ref`.
    const params = new URL(buildReferralUrl('https://x.test', ID)!).searchParams;
    expect(params.get('utm_content')).toBe(ID);
    expect(params.get('ref')).toBe(ID);
    expect(params.get('utm_source')).toBe(REFERRAL_UTM_SOURCE);
    expect(params.get('utm_medium')).toBe('referral');
  });

  it('never leaks the referrer\'s name', () => {
    expect(buildReferralUrl('https://x.test', ID)).not.toMatch(/braidon|dave/i);
  });

  it('returns null with no client id — a link that cannot be credited is not offered', () => {
    expect(buildReferralUrl('https://x.test', null)).toBeNull();
    expect(buildReferralUrl('https://x.test', '')).toBeNull();
    expect(buildReferralUrl('https://x.test', '   ')).toBeNull();
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildReferralUrl('https://x.test/', ID))
      .toContain(`https://x.test${REFERRAL_LANDING_PATH}?`);
  });
});
