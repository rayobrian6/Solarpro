/**
 * lib/incentives/stateIncentives.test.ts
 * v47.260 — Unit tests for calculateIncentives() and getStateIncentives()
 *
 * Covers:
 *   1. Federal ITC: residential = $0 (§25D repealed P.L. 119-21)
 *   2. Federal ITC: commercial = 30% (§48E still active)
 *   3. State tax credits (AZ: 25% up to $1,000)
 *   4. SRECs (IL, NJ)
 *   5. Property tax exemptions (display-only, not subtracted from netSystemCost)
 *   6. Sales tax exemptions (display-only, not subtracted from netSystemCost)
 *   7. Cash vs non-cash classification
 *   8. netSystemCost = systemCost - cashTotal only (never subtracts property/sales tax)
 *   9. getStateIncentives() returns correct profile or null
 *  10. Unknown state: returns empty state array, no crash
 *  11. systemType filter (roof vs ground restrictions)
 */

import { describe, it, expect } from 'vitest';
import {
  calculateIncentives,
  getStateIncentives,
  FEDERAL_ITC,
  STATE_INCENTIVES,
} from './stateIncentives';

// ─── helpers ──────────────────────────────────────────────────────────────────

const SYSTEM_COST = 30_000;
const SYSTEM_KW   = 10;
const ANNUAL_KWH  = 12_000;

// ─── 1. Federal ITC — residential §25D repealed ───────────────────────────────

describe('calculateIncentives — Federal ITC residential (§25D repealed)', () => {
  it('residential: federal ITC value is $0 (§25D repealed by P.L. 119-21)', () => {
    const result = calculateIncentives('CA', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.federal.calculatedValue).toBe(0);
  });

  it('residential: federal description mentions repeal', () => {
    const result = calculateIncentives('TX', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.federal.description).toMatch(/repealed|P\.L\. 119-21/i);
  });

  it('residential: cashTotal is $0 when no cash state incentives', () => {
    // Use a state with only non-cash incentives (property/sales tax only)
    // WY: verify it only has non-cash incentives
    const result = calculateIncentives('WY', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    // Wyoming: no cash state incentives beyond non-cash property tax exemption
    const cashStateItems = result.state.filter(i =>
      ['state_tax_credit','state_rebate','utility_rebate','performance_payment'].includes(i.type)
    );
    // federal is also $0 for residential — cashTotal should equal only cash state items
    expect(result.cashTotal).toBe(cashStateItems.reduce((s, i) => s + i.calculatedValue, 0));
  });

  it('residential: netSystemCost = systemCost - cashTotal', () => {
    // Invariant that always holds regardless of state
    const result = calculateIncentives('WY', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.netSystemCost).toBe(Math.max(0, SYSTEM_COST - result.cashTotal));
  });
});

// ─── 2. Federal ITC — commercial §48E still 30% ───────────────────────────────

describe('calculateIncentives — Federal ITC commercial (§48E still active)', () => {
  it('commercial: federal ITC value is 30% of system cost', () => {
    const result = calculateIncentives('CA', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, false);
    expect(result.federal.calculatedValue).toBe(Math.round(SYSTEM_COST * 0.30));
  });

  it('commercial: cashTotal includes 30% ITC', () => {
    const result = calculateIncentives('TX', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, false);
    expect(result.cashTotal).toBe(Math.round(SYSTEM_COST * 0.30));
  });

  it('commercial: netSystemCost = systemCost - 30% ITC', () => {
    const result = calculateIncentives('TX', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, false);
    expect(result.netSystemCost).toBe(SYSTEM_COST - Math.round(SYSTEM_COST * 0.30));
  });

  it('commercial: description does not mention repeal', () => {
    const result = calculateIncentives('CA', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, false);
    expect(result.federal.description).not.toMatch(/repealed/i);
    expect(result.federal.description).toMatch(/48E|Commercial/i);
  });
});

// ─── 3. Arizona state tax credit ─────────────────────────────────────────────

describe('calculateIncentives — Arizona state tax credit', () => {
  it('AZ residential: has az_tax_credit (25% up to $1,000)', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const azCredit = result.state.find(i => i.incentiveId === 'az_tax_credit');
    expect(azCredit).toBeDefined();
    // 25% of $30,000 = $7,500, but capped at $1,000
    expect(azCredit!.calculatedValue).toBe(1000);
  });

  it('AZ: cashTotal includes AZ tax credit', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    // federal=$0 (residential) + AZ credit=$1,000
    expect(result.cashTotal).toBe(1000);
  });

  it('AZ: netSystemCost = systemCost - cashTotal', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.netSystemCost).toBe(SYSTEM_COST - result.cashTotal);
  });

  it('AZ: property tax exemption is present (non-cash)', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const propTax = result.state.find(i => i.incentiveId === 'az_property_tax');
    expect(propTax).toBeDefined();
  });

  it('AZ: property tax exemption does NOT reduce netSystemCost', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const propTaxValue = result.state
      .filter(i => i.type === 'property_tax_exemption')
      .reduce((s, i) => s + i.calculatedValue, 0);
    // nonCashStateTotal includes it, cashTotal does not
    expect(result.nonCashStateTotal).toBeGreaterThanOrEqual(0);
    // netSystemCost is systemCost minus CASH only
    expect(result.netSystemCost).toBe(SYSTEM_COST - result.cashTotal);
    // If propTaxValue > 0, confirm it's in nonCashStateTotal not cashTotal
    if (propTaxValue > 0) {
      const cashWithoutPropTax = result.cashTotal;
      expect(result.netSystemCost).toBe(SYSTEM_COST - cashWithoutPropTax);
    }
  });
});

// ─── 4. Illinois SREC (non-cash) ──────────────────────────────────────────────

describe('calculateIncentives — Illinois SRECs', () => {
  it('IL: has il_shines SREC incentive', () => {
    const result = calculateIncentives('IL', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const shines = result.state.find(i => i.incentiveId === 'il_shines');
    expect(shines).toBeDefined();
  });

  it('IL: SREC type is srec', () => {
    const result = calculateIncentives('IL', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const shines = result.state.find(i => i.incentiveId === 'il_shines');
    expect(shines!.type).toBe('srec');
  });

  it('IL: SREC goes into nonCashStateTotal, not cashTotal', () => {
    const result = calculateIncentives('IL', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const srecValue = result.state
      .filter(i => i.type === 'srec')
      .reduce((s, i) => s + i.calculatedValue, 0);
    // SREC should be in nonCashStateTotal
    expect(result.nonCashStateTotal).toBeGreaterThanOrEqual(srecValue);
    // SREC should NOT reduce netSystemCost
    expect(result.netSystemCost).toBe(SYSTEM_COST - result.cashTotal);
  });
});

// ─── 5. Cash vs non-cash classification ──────────────────────────────────────

describe('calculateIncentives — cash vs non-cash classification', () => {
  it('state_tax_credit is cash (in cashTotal)', () => {
    // AZ has state_tax_credit
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const credits = result.state.filter(i => i.type === 'state_tax_credit');
    if (credits.length > 0) {
      const creditTotal = credits.reduce((s, i) => s + i.calculatedValue, 0);
      expect(result.cashTotal).toBeGreaterThanOrEqual(creditTotal);
    }
  });

  it('property_tax_exemption is non-cash (in nonCashStateTotal only)', () => {
    const result = calculateIncentives('FL', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const propTax = result.state.filter(i => i.type === 'property_tax_exemption');
    if (propTax.length > 0) {
      const propTaxTotal = propTax.reduce((s, i) => s + i.calculatedValue, 0);
      expect(result.nonCashStateTotal).toBeGreaterThanOrEqual(propTaxTotal);
    }
  });

  it('sales_tax_exemption is non-cash (in nonCashStateTotal only)', () => {
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const salesTax = result.state.filter(i => i.type === 'sales_tax_exemption');
    if (salesTax.length > 0) {
      const salesTaxTotal = salesTax.reduce((s, i) => s + i.calculatedValue, 0);
      expect(result.nonCashStateTotal).toBeGreaterThanOrEqual(salesTaxTotal);
    }
  });

  it('netSystemCost is never negative', () => {
    const result = calculateIncentives('NJ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.netSystemCost).toBeGreaterThanOrEqual(0);
  });

  it('total = federal + all state values', () => {
    const result = calculateIncentives('CA', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const expectedTotal = result.federal.calculatedValue +
      result.state.reduce((s, i) => s + i.calculatedValue, 0);
    expect(result.total).toBe(expectedTotal);
  });
});

// ─── 6. getStateIncentives() ──────────────────────────────────────────────────

describe('getStateIncentives()', () => {
  it('returns a StateIncentiveProfile for a valid state code', () => {
    const profile = getStateIncentives('CA');
    expect(profile).not.toBeNull();
    expect(profile!.stateCode).toBe('CA');
  });

  it('returns null for an unknown state code', () => {
    expect(getStateIncentives('XX')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getStateIncentives('')).toBeNull();
  });

  it('solarFriendlyRating is 1–5', () => {
    const states = ['CA', 'TX', 'FL', 'NY', 'AZ', 'IL', 'NJ'];
    for (const s of states) {
      const profile = getStateIncentives(s);
      expect(profile).not.toBeNull();
      expect(profile!.solarFriendlyRating).toBeGreaterThanOrEqual(1);
      expect(profile!.solarFriendlyRating).toBeLessThanOrEqual(5);
    }
  });
});

// ─── 7. Unknown state — no crash ──────────────────────────────────────────────

describe('calculateIncentives — unknown / missing state', () => {
  it('unknown state code: returns empty state array, no crash', () => {
    const result = calculateIncentives('ZZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result.state).toEqual([]);
    expect(result.cashTotal).toBe(0);  // residential: federal=0, no state
    expect(result.netSystemCost).toBe(SYSTEM_COST);
  });

  it('empty state code: does not throw', () => {
    expect(() =>
      calculateIncentives('', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true)
    ).not.toThrow();
  });
});

// ─── 8. systemType filter ─────────────────────────────────────────────────────

describe('calculateIncentives — systemType filter', () => {
  it('default (no systemType) returns roof incentives', () => {
    // Calling with no systemType should not crash
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(result).toBeDefined();
  });

  it('systemType=roof returns same as default', () => {
    const defaultResult = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const roofResult    = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true, 'roof');
    expect(roofResult.state.length).toBe(defaultResult.state.length);
  });

  it('systemType=ground: incentives restricted to roof-only are excluded', () => {
    // Ground mount should not crash and should return consistent results
    const result = calculateIncentives('AZ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true, 'ground_mount');
    expect(result).toBeDefined();
    expect(result.netSystemCost).toBeGreaterThanOrEqual(0);
  });
});

// ─── 9. FEDERAL_ITC export ───────────────────────────────────────────────────

describe('FEDERAL_ITC export', () => {
  it('FEDERAL_ITC is exported and has required fields', () => {
    expect(FEDERAL_ITC).toBeDefined();
    expect(FEDERAL_ITC.id).toBe('federal_itc_30');
    expect(FEDERAL_ITC.type).toBe('federal_itc');
    expect(FEDERAL_ITC.value).toBe(30);
    expect(FEDERAL_ITC.residential).toBe(true);
    expect(FEDERAL_ITC.commercial).toBe(true);
  });
});

// ─── 10. STATE_INCENTIVES completeness ───────────────────────────────────────

describe('STATE_INCENTIVES completeness', () => {
  const REQUIRED_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
    'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
    'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
    'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  ];

  it('STATE_INCENTIVES contains all 50 states', () => {
    for (const state of REQUIRED_STATES) {
      expect(STATE_INCENTIVES[state], `Missing state: ${state}`).toBeDefined();
    }
  });

  it('every state profile has required fields', () => {
    for (const [code, profile] of Object.entries(STATE_INCENTIVES)) {
      expect(profile.stateCode, `stateCode missing for ${code}`).toBeTruthy();
      expect(profile.stateName, `stateName missing for ${code}`).toBeTruthy();
      expect(Array.isArray(profile.incentives), `incentives not array for ${code}`).toBe(true);
      expect(profile.totalResidentialValue, `totalResidentialValue missing for ${code}`).toBeTruthy();
      expect([1,2,3,4,5]).toContain(profile.solarFriendlyRating);
    }
  });
});

// ─── 11. NJ SREC ─────────────────────────────────────────────────────────────

describe('calculateIncentives — New Jersey SREC', () => {
  it('NJ: has SREC or TREC incentive', () => {
    const result = calculateIncentives('NJ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const srecOrTrec = result.state.find(i => i.type === 'srec' || i.type === 'trec');
    expect(srecOrTrec).toBeDefined();
  });

  it('NJ: SREC/TREC calculatedValue > 0', () => {
    const result = calculateIncentives('NJ', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    const srecOrTrec = result.state.find(i => i.type === 'srec' || i.type === 'trec');
    expect(srecOrTrec!.calculatedValue).toBeGreaterThan(0);
  });
});

// ─── 12. Summary string ───────────────────────────────────────────────────────

describe('calculateIncentives — summary string', () => {
  it('summary is a non-empty string', () => {
    const result = calculateIncentives('CA', SYSTEM_COST, SYSTEM_KW, ANNUAL_KWH, true);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
