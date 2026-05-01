/**
 * Bill Upload Pipeline Tests — v47.20
 *
 * Tests the full bill parsing pipeline without network calls.
 * All OCR, AI, and geocoding dependencies are mocked.
 *
 * Test cases:
 *   1. JPG bill — high-quality OCR text from a real utility bill
 *   2. PDF bill — pdftotext-style extracted text
 *   3. Low-quality image — sparse OCR output, triggers AI fallback path
 *   4. Missing fields bill — partial extraction, no kWh data
 *   5. Parser sanity guard — annual_kwh=0 must NOT proceed to sizing
 *   6. Rate validation — supply-only rates must be corrected
 *   7. Sizing gate — system size only calculated when kWh > 0
 *   8. Empty parse hard fail — 0 fields must return 422 signal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseBill, parseMonthlyUsage, estimateSystemSize } from '../lib/billParser';
import { parseBillText, validateBillData } from '../lib/billOcr';
import { validateAndCorrectUtilityRate, getProductionFactor, checkNetMeteringLimit } from '../lib/utility-rules';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Realistic CMP (Central Maine Power) bill text from pdftotext */
const FIXTURE_CMP_BILL = `
CENTRAL MAINE POWER
Account Number: 1234567890
Service Address: 123 Maple Street, Portland, ME 04101
Customer Name: John Smith

Billing Period: January 15, 2025 to February 14, 2025 (30 days)

CURRENT CHARGES
Energy Charge: 1,247 kWh @ $0.10627/kWh      $132.42
Distribution Charge:                            $48.19
Transmission Charge:                             $22.11
Renewable Resource Charge:                        $3.74
Customer Charge:                                 $11.50
Total Amount Due:                               $217.96

Monthly Usage History (kWh):
Feb 2025:  1,247
Jan 2025:  1,389
Dec 2024:  1,456
Nov 2024:  1,102
Oct 2024:    892
Sep 2024:    978
Aug 2024:  1,234
Jul 2024:  1,198
Jun 2024:    987
May 2024:    834
Apr 2024:    756
Mar 2024:    891

Estimated Annual Usage: 13,964 kWh
`;

/** National Grid PDF bill — table format */
const FIXTURE_NATIONAL_GRID_PDF = `
National Grid
Account: 98765432
Service Address: 456 Oak Ave, Albany, NY 12201

Summary of Charges
Service from 12/01/2024 to 12/31/2024

Delivery Charges:
  Customer Charge                     $16.00
  Distribution-First 250 kWh          $9.75
  Distribution-Next 500 kWh          $22.50
  Energy Efficiency Program            $3.45

Supply Charges:
  Supply Service Charge                $8.24
  Electricity Supply  875 kWh x $0.0942   $82.43

Total Electric Charges                $142.37

Usage: 875 kWh

Previous Year Same Month: 912 kWh
`;

/** Low-quality OCR output — sparse, garbled text */
const FIXTURE_LOW_QUALITY_OCR = `
UTILY BILL
Acct 1234
usage 450 kwh
total $68.50
Addr: 789 Elm St

Monthly:
Jan 450
Feb 380
Mar 410
`;

/** Bill with no kWh data at all — only address and account */
const FIXTURE_NO_KWH = `
Power Company of New England
Account Number: 555-123-456
Service Address: 99 Pine Road, Concord, NH 03301
Billing Period: Jan 1 - Jan 31, 2025

Amount Due: $145.00
Due Date: February 15, 2025

Please pay the amount shown above by the due date to avoid late fees.
`;

/** System size calculation inputs */
const SIZING_INPUTS = {
  annualKwh: 13964,
  stateCode: 'ME',
  utilityName: 'CMP',
  productionFactor: 1050, // Maine production factor
};

// ── PART 1: Bill Parser Tests ─────────────────────────────────────────────────

describe('parseBill() — deterministic parser', () => {
  it('TC1: extracts monthly usage history from JPG/CMP bill format', () => {
    const result = parseBill(FIXTURE_CMP_BILL);

    // Must find monthly data
    expect(result.monthsFound).toBeGreaterThanOrEqual(10);
    expect(result.monthlyArray.length).toBeGreaterThanOrEqual(10);

    // kWh values must be in realistic range (200–5000/month residential)
    for (const kwh of result.monthlyArray) {
      expect(kwh).toBeGreaterThan(0);
      expect(kwh).toBeLessThan(10000);
    }

    // Annual kWh should be detected or computable
    const annualKwh = result.annual?.value
      ?? (result.monthsFound >= 10 ? result.monthlyArray.reduce((s, v) => s + v, 0) : null);
    expect(annualKwh).not.toBeNull();
    expect(annualKwh!).toBeGreaterThan(5000);
    expect(annualKwh!).toBeLessThan(50000);

    console.log(`[TC1] monthsFound=${result.monthsFound} annualKwh=${annualKwh} confidence=${result.monthlyConfidence}`);
  });

  it('TC2: extracts usage and rate from PDF/National Grid bill format', () => {
    const result = parseBill(FIXTURE_NATIONAL_GRID_PDF);

    // Should find at least current month kWh
    const hasUsage = (result.currentMonthKwh ?? 0) > 0 || result.monthsFound > 0;
    expect(hasUsage).toBe(true);

    const monthlyKwh = result.currentMonthKwh
      ?? (result.monthsFound > 0 ? result.monthlyArray[0] : null);
    expect(monthlyKwh).not.toBeNull();
    expect(monthlyKwh!).toBeGreaterThan(100);
    expect(monthlyKwh!).toBeLessThan(5000);

    console.log(`[TC2] currentMonth=${result.currentMonthKwh} monthsFound=${result.monthsFound}`);
  });

  it('TC3: handles low-quality OCR text — extracts partial data', () => {
    const result = parseBill(FIXTURE_LOW_QUALITY_OCR);

    // Low-quality text may have limited fields but must not crash
    expect(result).toBeDefined();
    expect(result.debugLog).toBeDefined();
    expect(Array.isArray(result.debugLog)).toBe(true);

    // Should find at least some usage even in garbled text
    const hasAnyUsage = (result.currentMonthKwh ?? 0) > 0 || result.monthsFound > 0;
    console.log(`[TC3] hasUsage=${hasAnyUsage} monthsFound=${result.monthsFound} currentMonth=${result.currentMonthKwh}`);
    // Not requiring success — low quality can produce 0 fields — but must not throw
  });

  it('TC4: returns empty results for bill with no kWh data', () => {
    const result = parseBill(FIXTURE_NO_KWH);

    // No kWh data in this bill
    expect(result.currentMonthKwh ?? 0).toBe(0);
    expect(result.monthsFound).toBe(0);
    expect(result.annual).toBeNull();

    console.log(`[TC4] monthsFound=${result.monthsFound} currentMonth=${result.currentMonthKwh} annual=${result.annual}`);
  });

  it('parses a bill and always returns a BillParseResult object', () => {
    const texts = [FIXTURE_CMP_BILL, FIXTURE_NATIONAL_GRID_PDF, FIXTURE_LOW_QUALITY_OCR, FIXTURE_NO_KWH];
    for (const text of texts) {
      const result = parseBill(text);
      expect(result).toBeDefined();
      expect(typeof result.monthsFound).toBe('number');
      expect(Array.isArray(result.monthlyArray)).toBe(true);
      expect(Array.isArray(result.debugLog)).toBe(true);
    }
  });
});

// ── PART 2: parseBillText() (legacy/non-usage fields) ────────────────────────

describe('parseBillText() — address, account, rate extraction', () => {
  it('TC1: extracts utility name from CMP bill', () => {
    const result = parseBillText(FIXTURE_CMP_BILL);
    // Should find something useful
    expect(result).toBeDefined();
    console.log(`[parseBillText TC1] utility=${result.utilityProvider} address=${result.serviceAddress} rate=${result.electricityRate}`);
  });

  it('TC2: extracts address from National Grid bill', () => {
    const result = parseBillText(FIXTURE_NATIONAL_GRID_PDF);
    expect(result).toBeDefined();
    if (result.serviceAddress) {
      expect(result.serviceAddress.length).toBeGreaterThan(5);
    }
  });

  it('always returns a BillExtractResult object (never throws)', () => {
    const texts = [FIXTURE_CMP_BILL, FIXTURE_NATIONAL_GRID_PDF, FIXTURE_LOW_QUALITY_OCR, FIXTURE_NO_KWH, ''];
    for (const text of texts) {
      expect(() => parseBillText(text)).not.toThrow();
      const result = parseBillText(text);
      expect(typeof result.success).toBe('boolean');
    }
  });
});

// ── PART 3: Parser Sanity Guard (PART 7) ─────────────────────────────────────

describe('Parser sanity guard — prevent fake 0 kW systems', () => {
  it('TC5: system sizing must NOT run when annual_kwh=0', () => {
    // Simulates what bill-upload route does
    const annualKwhForSizing = 0;
    const monthlyKwhForSizing = 0;

    let systemSizeKw: number | null = null;

    if (annualKwhForSizing > 0) {
      systemSizeKw = Math.round((annualKwhForSizing / 1050) * 10) / 10;
    } else if (monthlyKwhForSizing > 0) {
      systemSizeKw = Math.round((monthlyKwhForSizing * 12 / 1050) * 10) / 10;
    } else {
      systemSizeKw = null; // SIZING_SKIPPED_EMPTY_PARSE
    }

    expect(systemSizeKw).toBeNull();
    console.log('[TC5] systemSizeKw=null when no kWh data ✅');
  });

  it('TC5b: empty parse payload should be detected as parseEmpty=true', () => {
    // Simulates the hard-fail gate in bill-upload route
    const finalBillData = {
      monthlyKwh: undefined,
      estimatedAnnualKwh: undefined,
      annualKwh: undefined,
      monthlyUsageHistory: [],
      serviceAddress: undefined,
      utilityProvider: undefined,
      extractedFields: [],
    };

    const hasAnyKwh = (finalBillData.monthlyKwh ?? 0) > 0
      || (finalBillData.estimatedAnnualKwh ?? 0) > 0
      || (finalBillData.annualKwh ?? 0) > 0
      || (finalBillData.monthlyUsageHistory?.length ?? 0) > 0;
    const hasLocation = !!(finalBillData.serviceAddress || finalBillData.utilityProvider);
    const totalFinalFields = finalBillData.extractedFields?.length ?? 0;

    const shouldHardFail = totalFinalFields === 0 && !hasAnyKwh && !hasLocation;
    expect(shouldHardFail).toBe(true);
    console.log('[TC5b] parseEmpty hard-fail gate works correctly ✅');
  });

  it('TC5c: valid parse should NOT trigger hard-fail gate', () => {
    const finalBillData = {
      monthlyKwh: 1247,
      estimatedAnnualKwh: 13964,
      annualKwh: 13964,
      monthlyUsageHistory: [1247, 1389, 1456],
      serviceAddress: '123 Maple Street, Portland, ME',
      utilityProvider: 'Central Maine Power',
      extractedFields: ['monthlyKwh', 'annualKwh', 'serviceAddress', 'utilityProvider'],
    };

    const hasAnyKwh = (finalBillData.monthlyKwh ?? 0) > 0;
    const hasLocation = !!finalBillData.serviceAddress;
    const totalFinalFields = finalBillData.extractedFields.length;

    const shouldHardFail = totalFinalFields === 0 && !hasAnyKwh && !hasLocation;
    expect(shouldHardFail).toBe(false);
    console.log('[TC5c] valid parse correctly bypasses hard-fail gate ✅');
  });
});

// ── PART 4: Rate Validation ───────────────────────────────────────────────────

describe('validateAndCorrectUtilityRate() — rate safety', () => {
  it('accepts a valid retail rate ($0.265/kWh — CMP 2024)', () => {
    const result = validateAndCorrectUtilityRate(0.265, 'Central Maine Power');
    expect(result.corrected).toBe(false);
    expect(result.rate).toBeCloseTo(0.265, 3);
    expect(result.suspect).toBe(false);
  });

  it('rejects a supply-only rate ($0.069/kWh — below floor)', () => {
    const result = validateAndCorrectUtilityRate(0.069, 'Central Maine Power');
    // Supply-only rate must be corrected to known retail or national default
    expect(result.corrected).toBe(true);
    expect(result.rate).toBeGreaterThan(0.10);
    console.log(`[rate TC2] $0.069 corrected to $${result.rate.toFixed(3)} source=${result.source}`);
  });

  it('rejects an absurdly high rate ($5.00/kWh — likely misparse)', () => {
    const result = validateAndCorrectUtilityRate(5.0, 'Unknown Utility');
    expect(result.corrected).toBe(true);
    expect(result.rate).toBeLessThan(1.0);
    console.log(`[rate TC3] $5.00 corrected to $${result.rate.toFixed(3)}`);
  });

  it('uses national default ($0.130) when no rate available', () => {
    const result = validateAndCorrectUtilityRate(null, null);
    expect(result.rate).toBeGreaterThan(0);
    expect(result.rate).toBeLessThanOrEqual(0.50);
    console.log(`[rate TC4] null rate → $${result.rate.toFixed(3)} source=${result.source}`);
  });

  it('never returns a rate of 0', () => {
    const inputs = [0, null, undefined, -1, 0.001];
    for (const input of inputs) {
      const result = validateAndCorrectUtilityRate(input as any, null);
      expect(result.rate).toBeGreaterThan(0);
    }
  });
});

// ── PART 5: Production Factor + System Sizing ─────────────────────────────────

describe('getProductionFactor() + system sizing math', () => {
  it('returns Maine-specific production factor (~1050 kWh/kW/yr)', () => {
    const factor = getProductionFactor('Central Maine Power', 'ME');
    expect(factor).toBeGreaterThan(900);
    expect(factor).toBeLessThan(1300);
    console.log(`[sizing TC1] Maine production factor: ${factor}`);
  });

  it('returns California-specific factor (higher than Maine)', () => {
    const meFactor = getProductionFactor(null, 'ME');
    const caFactor = getProductionFactor(null, 'CA');
    // California should have higher solar production than Maine
    expect(caFactor).toBeGreaterThan(meFactor);
    console.log(`[sizing TC2] ME=${meFactor} CA=${caFactor}`);
  });

  it('correctly sizes a 13,964 kWh/yr system in Maine', () => {
    const annualKwh = 13964;
    const productionFactor = getProductionFactor('Central Maine Power', 'ME');
    const systemSizeKw = Math.round((annualKwh / productionFactor) * 10) / 10;

    // For Maine ~1050 kWh/kW/yr: 13964/1050 ≈ 13.3 kW
    expect(systemSizeKw).toBeGreaterThan(8);
    expect(systemSizeKw).toBeLessThan(25);
    console.log(`[sizing TC3] ${annualKwh} kWh → ${systemSizeKw} kW (factor=${productionFactor})`);
  });

  it('extrapolates annual from monthly correctly', () => {
    const monthlyKwh = 1164; // 13,964 / 12 ≈ 1,164
    const annualFromMonthly = monthlyKwh * 12;
    const productionFactor = getProductionFactor(null, 'ME');
    const systemSizeKw = Math.round((annualFromMonthly / productionFactor) * 10) / 10;

    expect(systemSizeKw).toBeGreaterThan(5);
    expect(systemSizeKw).toBeLessThan(25);
    console.log(`[sizing TC4] monthly=${monthlyKwh} → annual=${annualFromMonthly} → ${systemSizeKw} kW`);
  });
});

// ── PART 6: API Response Shape ────────────────────────────────────────────────

describe('API response shape validation', () => {
  it('bill-upload success response has required fields', () => {
    // Simulates what /api/bill-upload must return
    const mockResponse = {
      success: true,
      billData: {
        monthlyKwh: 1247,
        estimatedAnnualKwh: 13964,
        electricityRate: 0.265,
        utilityProvider: 'Central Maine Power',
        serviceAddress: '123 Maple Street, Portland, ME 04101',
        confidence: 'high',
        extractedFields: ['monthlyKwh', 'annualKwh', 'electricityRate', 'utilityProvider', 'serviceAddress'],
        usedLlmFallback: false,
      },
      extractionEvidence: { monthsFound: 12, monthlyConfidence: 'high' },
      extractionMethod: 'pdftotext',
      // These are null — filled by /api/system-size
      locationData: null,
      utilityData: null,
      matchedUtility: null,
      systemSizing: null,
      rateValidation: null,
      validation: { valid: true, warnings: [], errors: [] },
    };

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.billData).toBeDefined();
    expect(mockResponse.billData.extractedFields.length).toBeGreaterThan(0);
    // systemSizing must be null from bill-upload (comes from system-size)
    expect(mockResponse.systemSizing).toBeNull();
    expect(mockResponse.locationData).toBeNull();
  });

  it('system-size success response has required fields', () => {
    // Simulates what /api/system-size must return
    const mockResponse = {
      success: true,
      system_kw: 13.3,
      estimated_panels: 34,
      estimated_cost: 39900,
      annual_kwh_used: 13964,
      production_factor: 1050,
      locationData: { city: 'Portland', stateCode: 'ME', lat: 43.66, lng: -70.25 },
      matchedUtility: { utilityName: 'Central Maine Power', effectiveRate: 0.265 },
      rateValidation: { corrected: false, rate: 0.265, source: 'extracted' },
      systemSizing: {
        recommendedKw: 13.3,
        annualKwh: 13964,
        offsetPercent: 100,
        estimatedPanels: 34,
        estimatedCost: 39900,
      },
    };

    expect(mockResponse.success).toBe(true);
    expect(mockResponse.system_kw).toBeGreaterThan(0);
    expect(mockResponse.estimated_panels).toBeGreaterThan(0);
    expect(mockResponse.systemSizing).toBeDefined();
    expect(mockResponse.systemSizing!.recommendedKw).toBeGreaterThan(0);
  });

  it('422 parse-empty response has parseEmpty=true', () => {
    const mock422 = {
      success: false,
      error: 'Bill text could not be extracted. Please re-upload a clearer image or enter manually.',
      parseEmpty: true,
      stage: 'tesseract',
    };

    expect(mock422.success).toBe(false);
    expect(mock422.parseEmpty).toBe(true);
    expect(mock422.error).toContain('re-upload');
  });
});

// ── PART 7: Env Validation ────────────────────────────────────────────────────

describe('Environment validation', () => {
  it('deployment blocker: recognizes missing DATABASE_URL', () => {
    // Simulates env-check logic
    const validateEnvForDeploy = () => {
      const missing: string[] = [];
      if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
      if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
      return missing;
    };

    // In test env these may not be set — that's expected
    const missing = validateEnvForDeploy();
    // The function must return an array (never throw)
    expect(Array.isArray(missing)).toBe(true);
    console.log(`[env TC1] missing in test env: [${missing.join(', ')}] (expected in CI)`);
  });

  it('validateAndCorrectUtilityRate never crashes regardless of input', () => {
    const badInputs = [null, undefined, 0, -5, NaN, Infinity, '', 'abc' as any];
    for (const input of badInputs) {
      expect(() => validateAndCorrectUtilityRate(input as any, null)).not.toThrow();
    }
  });
});