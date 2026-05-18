/**
 * tests/hydrate-bill-data.test.ts
 *
 * Unit tests for lib/bill/hydrateBillData.ts
 *
 * Verifies:
 *   1. No bill_data → all fields undefined
 *   2. New format (_billAnalysis present) → direct pass-through
 *   3. Flat/legacy format → BillAnalysis synthesized from raw OCR fields
 *   4. Flat format with monthlyUsageHistory priority over monthlyKwh
 *   5. Flat format with annualKwh but no monthly array → filled from annual
 *   6. utilityProvider / utility_name / utility_rate_per_kwh fallback chain
 *   7. city: flat bill_data.city vs bill_data._city vs row.city priority
 *   8. stateCode: bill_data.stateCode vs row.state_code fallback
 *   9. Source-scanning: lib/bill/hydrateBillData.ts is the canonical location
 *  10. core.ts and production.ts delegate to hydrateBillData (no inline copy)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { hydrateBillData } from '../lib/bill/hydrateBillData';

// ─── helpers ─────────────────────────────────────────────────────────────────
function readSrc(relPath: string): string {
  return readFileSync(relPath, 'utf8');
}

// A minimal DB row with no utility fallback columns
const EMPTY_ROW: Record<string, unknown> = {};

// ─── 1. No bill_data ─────────────────────────────────────────────────────────
describe('hydrateBillData: no bill_data', () => {
  it('returns all undefined when rawBillData is undefined', () => {
    const result = hydrateBillData(undefined, EMPTY_ROW);
    expect(result.billAnalysis).toBeUndefined();
    expect(result.utilityName).toBeUndefined();
    expect(result.utilityRatePerKwh).toBeUndefined();
    expect(result.stateCode).toBeUndefined();
    expect(result.city).toBeUndefined();
  });

  it('returns all undefined when rawBillData is null', () => {
    const result = hydrateBillData(null, EMPTY_ROW);
    expect(result.billAnalysis).toBeUndefined();
    expect(result.utilityName).toBeUndefined();
  });

  it('returns all undefined when rawBillData is an empty object', () => {
    const result = hydrateBillData({}, EMPTY_ROW);
    expect(result.billAnalysis).toBeUndefined();
  });
});

// ─── 2. New format (_billAnalysis present) ───────────────────────────────────
describe('hydrateBillData: new format (_billAnalysis)', () => {
  const billAnalysisObj = {
    monthlyKwh: [800, 900, 1000, 950, 850, 800, 780, 760, 770, 790, 810, 830],
    annualKwh: 10040,
    averageMonthlyKwh: 837,
    averageMonthlyBill: 125.5,
    annualBill: 1506,
    utilityRate: 0.15,
    peakMonthKwh: 1000,
    peakMonth: 2,
    recommendedSystemKw: 8.5,
    recommendedPanelCount: 20,
    offsetTarget: 100,
  };

  const rawBillData = {
    _billAnalysis: billAnalysisObj,
    _utilityName: 'Green Light Power',
    _utilityRatePerKwh: 0.148,
    _stateCode: 'TX',
    _city: 'Austin',
  };

  it('passes through _billAnalysis directly', () => {
    const result = hydrateBillData(rawBillData, EMPTY_ROW);
    expect(result.billAnalysis).toBe(rawBillData._billAnalysis);
  });

  it('reads utilityName from _utilityName', () => {
    const result = hydrateBillData(rawBillData, EMPTY_ROW);
    expect(result.utilityName).toBe('Green Light Power');
  });

  it('reads utilityRatePerKwh from _utilityRatePerKwh', () => {
    const result = hydrateBillData(rawBillData, EMPTY_ROW);
    expect(result.utilityRatePerKwh).toBe(0.148);
  });

  it('reads stateCode from _stateCode', () => {
    const result = hydrateBillData(rawBillData, EMPTY_ROW);
    expect(result.stateCode).toBe('TX');
  });

  it('reads city from _city (FIX v47.8)', () => {
    const result = hydrateBillData(rawBillData, EMPTY_ROW);
    expect(result.city).toBe('Austin');
  });

  it('does NOT synthesize from flat fields when _billAnalysis is present', () => {
    // Even if flat fields exist alongside _billAnalysis, we only use the nested object
    const mixed = {
      _billAnalysis: billAnalysisObj,
      _utilityName: 'Green Light Power',
      monthlyKwh: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      annualKwh: 9999,
    };
    const result = hydrateBillData(mixed, EMPTY_ROW);
    expect(result.billAnalysis).toBe(mixed._billAnalysis);
    // annualKwh in billAnalysis should come from the nested object, not from flat 9999
    expect((result.billAnalysis as typeof billAnalysisObj)?.annualKwh).toBe(10040);
  });
});

// ─── 3. Flat/legacy format ───────────────────────────────────────────────────
describe('hydrateBillData: flat/legacy format', () => {
  const flatData = {
    utilityProvider: 'Pacific Gas & Electric',
    monthlyKwh: [700, 720, 750, 780, 800, 850, 920, 910, 880, 820, 760, 710],
    annualKwh: 9600,
    electricityRate: 0.22,
  };

  it('synthesizes a BillAnalysis from flat fields', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    expect(result.billAnalysis).toBeDefined();
    expect(result.billAnalysis?.annualKwh).toBeGreaterThan(0);
    expect(result.billAnalysis?.monthlyKwh).toHaveLength(12);
    expect(result.billAnalysis?.utilityRate).toBeGreaterThan(0);
  });

  it('synthesized BillAnalysis has the required shape fields', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    const ba = result.billAnalysis!;
    expect(ba).toHaveProperty('monthlyKwh');
    expect(ba).toHaveProperty('annualKwh');
    expect(ba).toHaveProperty('averageMonthlyKwh');
    expect(ba).toHaveProperty('averageMonthlyBill');
    expect(ba).toHaveProperty('annualBill');
    expect(ba).toHaveProperty('utilityRate');
    expect(ba).toHaveProperty('peakMonthKwh');
    expect(ba).toHaveProperty('peakMonth');
    expect(ba).toHaveProperty('recommendedSystemKw');
    expect(ba).toHaveProperty('recommendedPanelCount');
    expect(ba).toHaveProperty('offsetTarget');
  });

  it('reads utilityName from flat utilityProvider', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    expect(result.utilityName).toBe('Pacific Gas & Electric');
  });

  it('annualBill = averageMonthlyBill * 12', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    const ba = result.billAnalysis!;
    expect(ba.annualBill).toBeCloseTo(ba.averageMonthlyBill * 12, 0);
  });

  it('peakMonth is the index of max monthlyKwh', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    const ba = result.billAnalysis!;
    const maxKwh = Math.max(...ba.monthlyKwh);
    const maxIdx = ba.monthlyKwh.indexOf(maxKwh);
    expect(ba.peakMonth).toBe(maxIdx);
    expect(ba.peakMonthKwh).toBe(maxKwh);
  });

  it('recommendedPanelCount defaults to 0 (client sets it)', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    expect(result.billAnalysis?.recommendedPanelCount).toBe(0);
  });

  it('offsetTarget defaults to 100', () => {
    const result = hydrateBillData(flatData, EMPTY_ROW);
    expect(result.billAnalysis?.offsetTarget).toBe(100);
  });
});

// ─── 4. monthlyUsageHistory priority ─────────────────────────────────────────
describe('hydrateBillData: monthlyUsageHistory priority', () => {
  it('prefers monthlyUsageHistory over monthlyKwh when length >= 3', () => {
    const data = {
      monthlyUsageHistory: [500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610],
      monthlyKwh: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      annualKwh: 1200,
    };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.billAnalysis?.monthlyKwh[0]).toBe(500);
  });

  it('falls back to monthlyKwh when monthlyUsageHistory has fewer than 3 entries', () => {
    const data = {
      monthlyUsageHistory: [500, 510], // too short
      monthlyKwh: [200, 210, 220, 230, 240, 250, 260, 270, 280, 290, 300, 310],
    };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.billAnalysis?.monthlyKwh[0]).toBe(200);
  });

  it('monthlyUsageHistory is sliced to 12 entries max', () => {
    const longHistory = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 999, 999];
    const result = hydrateBillData({ monthlyUsageHistory: longHistory }, EMPTY_ROW);
    expect(result.billAnalysis?.monthlyKwh).toHaveLength(12);
    expect(result.billAnalysis?.monthlyKwh[12]).toBeUndefined();
  });
});

// ─── 5. annualKwh fill ────────────────────────────────────────────────────────
describe('hydrateBillData: annual fill when no monthly array', () => {
  it('fills 12-month array from annualKwh when no monthly array', () => {
    const data = { annualKwh: 12000, utilityProvider: 'TestCo' };
    const result = hydrateBillData(data, EMPTY_ROW);
    const ba = result.billAnalysis!;
    expect(ba.monthlyKwh).toHaveLength(12);
    expect(ba.monthlyKwh[0]).toBe(1000); // 12000/12
    expect(ba.annualKwh).toBe(12000);
  });

  it('fills from estimatedAnnualKwh when annualKwh is missing', () => {
    const data = { estimatedAnnualKwh: 9600, utilityProvider: 'TestCo' };
    const result = hydrateBillData(data, EMPTY_ROW);
    const ba = result.billAnalysis!;
    expect(ba.annualKwh).toBe(9600);
    expect(ba.monthlyKwh[0]).toBe(800); // 9600/12
  });

  it('fills from scalar monthlyKwh * 12 when no array and no annual', () => {
    // monthlyKwh is a number (single month), not an array
    const data = { monthlyKwh: 900 as unknown as number[], utilityProvider: 'TestCo' };
    const result = hydrateBillData(data, EMPTY_ROW);
    const ba = result.billAnalysis!;
    expect(ba.annualKwh).toBe(10800); // 900 * 12
  });
});

// ─── 6. Rate fallback chain ───────────────────────────────────────────────────
describe('hydrateBillData: rate fallback chain', () => {
  it('prefers electricityRate from bill_data over row.utility_rate_per_kwh', () => {
    const data = { utilityProvider: 'TestCo', annualKwh: 6000, electricityRate: 0.25 };
    const row = { utility_rate_per_kwh: 0.10 };
    const result = hydrateBillData(data, row);
    // Rate may be validated/corrected but should be closer to 0.25 than 0.10
    expect(result.utilityRatePerKwh).toBeGreaterThan(0.10);
  });

  it('falls back to row.utility_rate_per_kwh when electricityRate is 0', () => {
    const data = { utilityProvider: 'TestCo', annualKwh: 6000, electricityRate: 0 };
    const row = { utility_rate_per_kwh: 0.18 };
    const result = hydrateBillData(data, row);
    // electricityRate=0 is falsy so should fall back to row rate
    expect(result.utilityRatePerKwh).toBeGreaterThan(0);
  });

  it('falls back to row.utility_name when utilityProvider not in bill_data', () => {
    const data = { annualKwh: 6000 };
    const row = { utility_name: 'Row Utility' };
    const result = hydrateBillData(data, row);
    // annualKwh alone doesn't trigger flat path; needs utilityProvider or electricityRate
    // so this tests the fallback specifically:
    const data2 = { annualKwh: 6000, electricityRate: 0.15 };
    const result2 = hydrateBillData(data2, row);
    expect(result2.utilityName).toBe('Row Utility');
  });
});

// ─── 7. city priority ────────────────────────────────────────────────────────
describe('hydrateBillData: city field priority', () => {
  it('new format: reads city from _city', () => {
    const data = { _billAnalysis: {}, _city: 'San Diego' };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.city).toBe('San Diego');
  });

  it('flat format: reads city from bill_data.city', () => {
    const data = { annualKwh: 5000, utilityProvider: 'TestCo', city: 'Phoenix' };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.city).toBe('Phoenix');
  });

  it('flat format: falls back to row.city when bill_data.city absent', () => {
    const data = { annualKwh: 5000, utilityProvider: 'TestCo' };
    const row = { city: 'Denver' };
    const result = hydrateBillData(data, row);
    expect(result.city).toBe('Denver');
  });
});

// ─── 8. stateCode fallback ───────────────────────────────────────────────────
describe('hydrateBillData: stateCode fallback', () => {
  it('new format: reads stateCode from _stateCode', () => {
    const data = { _billAnalysis: {}, _stateCode: 'CA' };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.stateCode).toBe('CA');
  });

  it('flat format: reads stateCode from bill_data.stateCode', () => {
    const data = { annualKwh: 5000, utilityProvider: 'TestCo', stateCode: 'NY' };
    const result = hydrateBillData(data, EMPTY_ROW);
    expect(result.stateCode).toBe('NY');
  });

  it('flat format: falls back to row.state_code', () => {
    const data = { annualKwh: 5000, utilityProvider: 'TestCo' };
    const row = { state_code: 'FL' };
    const result = hydrateBillData(data, row);
    expect(result.stateCode).toBe('FL');
  });
});

// ─── 9. Source-scan: canonical location ──────────────────────────────────────
describe('hydrateBillData: source structure', () => {
  const src = readSrc('lib/bill/hydrateBillData.ts');

  it('exports hydrateBillData function', () => {
    expect(src).toContain('export function hydrateBillData(');
  });

  it('exports HydratedBillFields interface', () => {
    expect(src).toContain('export interface HydratedBillFields');
  });

  it('imports validateAndCorrectUtilityRate from utility-rules', () => {
    expect(src).toContain("from '@/lib/utility-rules'");
    expect(src).toContain('validateAndCorrectUtilityRate');
  });

  it('imports BillAnalysis type from @/types', () => {
    expect(src).toContain("from '@/types'");
    expect(src).toContain('BillAnalysis');
  });

  it('handles new format (_billAnalysis path)', () => {
    expect(src).toContain('rawBillData._billAnalysis');
  });

  it('handles flat/legacy format', () => {
    expect(src).toContain('monthlyUsageHistory');
    expect(src).toContain('estimatedAnnualKwh');
    expect(src).toContain('electricityRate');
  });
});

// ─── 10. core.ts and production.ts delegate — no inline copy ─────────────────
describe('hydrateBillData: callers use shared helper (no inline duplication)', () => {
  const coreSrc = readSrc('lib/db/core.ts');
  const prodSrc = readSrc('lib/db/production.ts');

  it('lib/db/core.ts imports hydrateBillData from lib/bill/hydrateBillData', () => {
    expect(coreSrc).toContain("from '@/lib/bill/hydrateBillData'");
    expect(coreSrc).toContain('hydrateBillData(');
  });

  it('lib/db/core.ts does NOT have the inline rawHistory extraction loop', () => {
    // The flat-format local variable names were rawHistory / rawMonthly
    expect(coreSrc).not.toContain('const rawHistory =');
    expect(coreSrc).not.toContain('const rawMonthly =');
    expect(coreSrc).not.toContain('const monthlyKwhArray:');
  });

  it('lib/db/core.ts does NOT directly call validateAndCorrectUtilityRate', () => {
    expect(coreSrc).not.toContain('validateAndCorrectUtilityRate(');
  });

  it('lib/db/production.ts imports hydrateBillData from lib/bill/hydrateBillData', () => {
    expect(prodSrc).toContain("from '@/lib/bill/hydrateBillData'");
    expect(prodSrc).toContain('hydrateBillData(');
  });

  it('lib/db/production.ts does NOT have the inline rawHistory2 extraction loop', () => {
    expect(prodSrc).not.toContain('const rawHistory2 =');
    expect(prodSrc).not.toContain('const rawMonthly2 =');
    expect(prodSrc).not.toContain('const monthlyKwhArray2:');
  });

  it('lib/db/production.ts does NOT directly call validateAndCorrectUtilityRate', () => {
    expect(prodSrc).not.toContain('validateAndCorrectUtilityRate(');
  });

  it('lib/db/production.ts does NOT import validateAndCorrectUtilityRate', () => {
    // The missing import was a latent bug — it should not reappear
    expect(prodSrc).not.toContain("from '@/lib/utility-rules'");
  });
});
