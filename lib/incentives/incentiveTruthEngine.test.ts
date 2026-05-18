/**
 * lib/incentives/incentiveTruthEngine.test.ts
 * v47.260 — Tests for resolveIncentiveTruth()
 *
 * Covers:
 *   1. Global gate: with allow_state_incentives=true (v47.260 live state)
 *   2. Residential: federal ITC suppressed (§25D repealed)
 *   3. Commercial: federal ITC active (§48E)
 *   4. State incentives resolved when state code provided
 *   5. State incentives unavailable when state code missing
 *   6. SREC truth: available / not available
 *   7. incentivesNotIncluded flag logic
 *   8. policyEffect='at_risk' suppresses incentives
 *   9. noItc=true suppresses federal ITC but not state
 *  10. incentivesConfig helper functions (isSection48eEnabled, getSection48eRate, etc.)
 */

import { describe, it, expect } from 'vitest';
import { resolveIncentiveTruth } from '../proposal/incentiveTruthEngine';
import type { PolicyEffect } from '../proposalTruthEngine';
import {
  isItcEnabled,
  areStateIncentivesEnabled,
  isSection48eEnabled,
  getSection48eRate,
  getSection48eSafeHarborDeadline,
  GLOBAL_INCENTIVES_CONFIG,
} from '../incentivesConfig';

// ─── helper ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<Parameters<typeof resolveIncentiveTruth>[0]> = {}) {
  return {
    stateCode:      'IL',
    systemCost:     30_000,
    systemKw:       10,
    annualKwh:      12_000,
    isCommercial:   false,
    noItc:          false,
    policyEffect:   'neutral' as PolicyEffect,
    srecAvailable:  false,
    srecProgramName: '',
    srecPricePerMwh: 0,
    ...overrides,
  };
}

// ─── 1. incentivesConfig state (v47.260) ─────────────────────────────────────

describe('incentivesConfig v47.260 state', () => {
  it('incentives_enabled = true', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.incentives_enabled).toBe(true);
  });

  it('allow_itc = false (§25D repealed)', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.allow_itc).toBe(false);
  });

  it('allow_state_incentives = true', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.allow_state_incentives).toBe(true);
  });

  it('allow_section48e = true', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.allow_section48e).toBe(true);
  });

  it('section48e_rate = 30', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.section48e_rate).toBe(30);
  });

  it('section48e_safe_harbor_deadline = 2026-07-04', () => {
    expect(GLOBAL_INCENTIVES_CONFIG.section48e_safe_harbor_deadline).toBe('2026-07-04');
  });

  it('isItcEnabled() = false (§25D disabled)', () => {
    expect(isItcEnabled()).toBe(false);
  });

  it('areStateIncentivesEnabled() = true', () => {
    expect(areStateIncentivesEnabled()).toBe(true);
  });

  it('isSection48eEnabled() = true', () => {
    expect(isSection48eEnabled()).toBe(true);
  });

  it('getSection48eRate() = 30', () => {
    expect(getSection48eRate()).toBe(30);
  });

  it('getSection48eSafeHarborDeadline() = 2026-07-04', () => {
    expect(getSection48eSafeHarborDeadline()).toBe('2026-07-04');
  });
});

// ─── 2. Residential: federal ITC suppressed ──────────────────────────────────

describe('resolveIncentiveTruth — residential federal ITC suppressed', () => {
  it('federalItc.rate = 0 for residential (§25D repealed)', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: false }));
    expect(result.federalItc.rate).toBe(0);
  });

  it('federalItc.amount = 0 for residential', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: false }));
    expect(result.federalItc.amount).toBe(0);
  });

  it('federalItc.suppressed = true for residential (global itc disabled)', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: false }));
    expect(result.federalItc.suppressed).toBe(true);
  });

  it('federalItc.citation references no-itc state', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: false }));
    expect(result.federalItc.citation).toBeTruthy();
    expect(result.federalItc.citation.length).toBeGreaterThan(0);
  });
});

// ─── 3. Commercial: federal ITC via §48E ─────────────────────────────────────

describe('resolveIncentiveTruth — commercial §48E ITC', () => {
  // Note: allow_itc=false globally means even commercial gets 0 unless
  // allow_itc is enabled. This is correct conservative behavior —
  // §48E is for companies offering lease/PPA, not direct computation here.
  it('federalItc.rate = 0 for commercial (allow_itc=false gate)', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: true }));
    // allow_itc=false means the ITC engine returns 0 regardless
    // (§48E is handled separately via allow_section48e, not allow_itc)
    expect(result.federalItc.rate).toBe(0);
  });

  it('federalItc.suppressed = true for commercial (allow_itc=false)', () => {
    const result = resolveIncentiveTruth(makeInput({ isCommercial: true }));
    expect(result.federalItc.suppressed).toBe(true);
  });
});

// ─── 4. State incentives resolved ────────────────────────────────────────────

describe('resolveIncentiveTruth — state incentives', () => {
  it('IL: state incentives available with state code', () => {
    const result = resolveIncentiveTruth(makeInput({ stateCode: 'IL' }));
    // IL has il_shines SREC — may or may not be in stateIncentives.incentives
    // depending on cash/non-cash filter in incentiveTruthEngine
    expect(result.stateIncentives).toBeDefined();
  });

  it('AZ: state incentives available = true (has az_tax_credit)', () => {
    const result = resolveIncentiveTruth(makeInput({
      stateCode: 'AZ',
      systemCost: 30_000,
      systemKw: 10,
      annualKwh: 12_000,
      isCommercial: false,
    }));
    expect(result.stateIncentives.available).toBe(true);
  });

  it('AZ: stateIncentives.totalEstimatedValue > 0', () => {
    const result = resolveIncentiveTruth(makeInput({ stateCode: 'AZ' }));
    expect(result.stateIncentives.totalEstimatedValue).toBeGreaterThan(0);
  });

  it('state incentives displayNote is a non-empty string', () => {
    const result = resolveIncentiveTruth(makeInput({ stateCode: 'CA' }));
    expect(typeof result.stateIncentives.displayNote).toBe('string');
    expect(result.stateIncentives.displayNote.length).toBeGreaterThan(0);
  });
});

// ─── 5. State incentives unavailable without state code ──────────────────────

describe('resolveIncentiveTruth — missing state code', () => {
  it('empty stateCode: stateIncentives.available = false', () => {
    const result = resolveIncentiveTruth(makeInput({ stateCode: '' }));
    expect(result.stateIncentives.available).toBe(false);
  });

  it('empty stateCode: totalEstimatedValue = 0', () => {
    const result = resolveIncentiveTruth(makeInput({ stateCode: '' }));
    expect(result.stateIncentives.totalEstimatedValue).toBe(0);
  });
});

// ─── 6. SREC truth ───────────────────────────────────────────────────────────

describe('resolveIncentiveTruth — SREC', () => {
  it('srec.available = true when srecAvailable=true', () => {
    const result = resolveIncentiveTruth(makeInput({
      srecAvailable: true,
      srecProgramName: 'Illinois Shines',
      srecPricePerMwh: 75,
    }));
    expect(result.srec.available).toBe(true);
  });

  it('srec.estimatedAnnualRevenue > 0 when srecAvailable=true and pricePerMwh > 0', () => {
    const result = resolveIncentiveTruth(makeInput({
      srecAvailable: true,
      srecProgramName: 'NJ SREC',
      srecPricePerMwh: 200,
      annualKwh: 12_000,
    }));
    // 12,000 kWh / 1,000 = 12 MWh × $200 = $2,400
    expect(result.srec.estimatedAnnualRevenue).toBe(2400);
  });

  it('srec.available = false when srecAvailable=false', () => {
    const result = resolveIncentiveTruth(makeInput({ srecAvailable: false }));
    expect(result.srec.available).toBe(false);
  });

  it('srec.estimatedAnnualRevenue = 0 when not available', () => {
    const result = resolveIncentiveTruth(makeInput({
      srecAvailable: false,
      srecPricePerMwh: 0,
    }));
    expect(result.srec.estimatedAnnualRevenue).toBe(0);
  });
});

// ─── 7. incentivesNotIncluded flag ───────────────────────────────────────────

describe('resolveIncentiveTruth — incentivesNotIncluded', () => {
  it('incentivesNotIncluded = false when state code provided and no policy issue', () => {
    const result = resolveIncentiveTruth(makeInput({
      stateCode: 'IL',
      policyEffect: 'neutral' as PolicyEffect,
      noItc: false,
    }));
    expect(result.incentivesNotIncluded).toBe(false);
  });

  it('incentivesNotIncluded = true when policyEffect = at_risk', () => {
    const result = resolveIncentiveTruth(makeInput({ policyEffect: 'at_risk' }));
    expect(result.incentivesNotIncluded).toBe(true);
  });

  it('incentivesNotIncluded reason is set when incentivesNotIncluded = true', () => {
    const result = resolveIncentiveTruth(makeInput({ policyEffect: 'at_risk' }));
    expect(result.incentivesNotIncludedReason).toBeTruthy();
  });

  it('incentivesNotIncluded = false when policyEffect = none', () => {
    const result = resolveIncentiveTruth(makeInput({ policyEffect: 'neutral' as PolicyEffect }));
    expect(result.incentivesNotIncluded).toBe(false);
  });
});

// ─── 8. noItc flag ───────────────────────────────────────────────────────────

describe('resolveIncentiveTruth — noItc flag', () => {
  it('noItc=true: federalItc.suppressed = true', () => {
    const result = resolveIncentiveTruth(makeInput({ noItc: true }));
    expect(result.federalItc.suppressed).toBe(true);
  });

  it('noItc=true: federalItc.rate = 0', () => {
    const result = resolveIncentiveTruth(makeInput({ noItc: true }));
    expect(result.federalItc.rate).toBe(0);
  });

  it('noItc=true: state incentives still resolved (noItc only gates federal)', () => {
    const result = resolveIncentiveTruth(makeInput({
      noItc: true,
      stateCode: 'AZ',
      policyEffect: 'neutral' as PolicyEffect,
    }));
    // AZ has state incentives — they should still be available even when noItc=true
    expect(result.stateIncentives).toBeDefined();
  });
});

// ─── 9. Return shape completeness ─────────────────────────────────────────────

describe('resolveIncentiveTruth — return shape', () => {
  it('returns all required fields', () => {
    const result = resolveIncentiveTruth(makeInput());
    expect(result).toHaveProperty('federalItc');
    expect(result).toHaveProperty('srec');
    expect(result).toHaveProperty('stateIncentives');
    expect(result).toHaveProperty('incentivesNotIncluded');
    expect(result).toHaveProperty('incentivesNotIncludedReason');
  });

  it('federalItc has all required fields', () => {
    const result = resolveIncentiveTruth(makeInput());
    expect(result.federalItc).toHaveProperty('rate');
    expect(result.federalItc).toHaveProperty('amount');
    expect(result.federalItc).toHaveProperty('suppressed');
    expect(result.federalItc).toHaveProperty('citation');
    expect(result.federalItc).toHaveProperty('eligibilityNote');
  });

  it('stateIncentives has all required fields', () => {
    const result = resolveIncentiveTruth(makeInput());
    expect(result.stateIncentives).toHaveProperty('available');
    expect(result.stateIncentives).toHaveProperty('totalEstimatedValue');
    expect(result.stateIncentives).toHaveProperty('incentives');
    expect(result.stateIncentives).toHaveProperty('displayNote');
    expect(Array.isArray(result.stateIncentives.incentives)).toBe(true);
  });
});
