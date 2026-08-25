/**
 * tests/portalProduction.test.ts
 *
 * Unit tests for the homeowner portal production estimation helpers.
 * The math is the load-bearing part of the new SystemPerformance section
 * in app/portal/dashboard/page.tsx — if the multipliers are wrong, the
 * homeowner sees the wrong "expected production" number.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateAnnualKwh,
  estimateMonthlyKwh,
  estimateCo2Tons,
  US_AVG_KWH_PER_KW_YEAR,
  US_GRID_CO2_KG_PER_KWH,
} from '../lib/portal/production';

describe('estimateAnnualKwh', () => {
  it('uses US-average specific yield (1370 kWh/kW/yr)', () => {
    expect(US_AVG_KWH_PER_KW_YEAR).toBe(1370);
  });

  it('returns 0 for non-positive system sizes', () => {
    expect(estimateAnnualKwh(0)).toBe(0);
    expect(estimateAnnualKwh(-5)).toBe(0);
  });

  it('returns 0 for non-finite values', () => {
    expect(estimateAnnualKwh(NaN)).toBe(0);
    expect(estimateAnnualKwh(Infinity)).toBe(0);
  });

  it('computes annual kWh from system size (rounded to integer)', () => {
    // 8.4 kW * 1370 = 11,508 kWh/yr
    expect(estimateAnnualKwh(8.4)).toBe(11508);
    // 10 kW * 1370 = 13,700 kWh/yr
    expect(estimateAnnualKwh(10)).toBe(13700);
    // 5.5 kW * 1370 = 7,535 kWh/yr
    expect(estimateAnnualKwh(5.5)).toBe(7535);
    // 1 kW * 1370 = 1,370 kWh/yr
    expect(estimateAnnualKwh(1)).toBe(1370);
  });

  it('handles fractional kW with rounding', () => {
    // 7.3 kW * 1370 = 10,001 → rounds to 10,001
    expect(estimateAnnualKwh(7.3)).toBe(10001);
    // 4.95 kW * 1370 = 6,781.5 → rounds to 6,782
    expect(estimateAnnualKwh(4.95)).toBe(6782);
  });
});

describe('estimateMonthlyKwh', () => {
  it('returns 0 for non-positive annual kWh', () => {
    expect(estimateMonthlyKwh(0)).toBe(0);
    expect(estimateMonthlyKwh(-100)).toBe(0);
  });

  it('spreads annual across 12 months (rounded)', () => {
    // 11,508 / 12 = 959
    expect(estimateMonthlyKwh(11508)).toBe(959);
    // 13,700 / 12 = 1141.67 → 1142
    expect(estimateMonthlyKwh(13700)).toBe(1142);
    // 1,370 / 12 = 114.17 → 114
    expect(estimateMonthlyKwh(1370)).toBe(114);
  });

  it('is consistent with estimateAnnualKwh for realistic system sizes', () => {
    const sizes = [4, 6, 8, 10, 12, 15];
    for (const kw of sizes) {
      const annual = estimateAnnualKwh(kw);
      const monthly = estimateMonthlyKwh(annual);
      // 12 * monthly should be within 6 of annual (rounding)
      expect(Math.abs(12 * monthly - annual)).toBeLessThanOrEqual(6);
    }
  });
});

describe('estimateCo2Tons', () => {
  it('uses US grid-average CO2 factor (0.4 kg/kWh)', () => {
    expect(US_GRID_CO2_KG_PER_KWH).toBe(0.4);
  });

  it('returns 0 for non-positive annual kWh', () => {
    expect(estimateCo2Tons(0)).toBe(0);
    expect(estimateCo2Tons(-100)).toBe(0);
  });

  it('computes CO2 offset in tons (1 decimal)', () => {
    // 11,508 * 0.4 = 4,603.2 kg = 4.6032 tons → 4.6
    expect(estimateCo2Tons(11508)).toBe(4.6);
    // 13,700 * 0.4 = 5,480 kg = 5.48 tons → 5.5
    expect(estimateCo2Tons(13700)).toBe(5.5);
    // 1,370 * 0.4 = 548 kg = 0.548 tons → 0.5
    expect(estimateCo2Tons(1370)).toBe(0.5);
  });

  it('scales linearly with system size', () => {
    const fourKw = estimateCo2Tons(estimateAnnualKwh(4));
    const eightKw = estimateCo2Tons(estimateAnnualKwh(8));
    // 8 kW should produce ~2x the CO2 offset of 4 kW
    expect(eightKw / fourKw).toBeCloseTo(2, 1);
  });
});

describe('end-to-end (realistic system sizes)', () => {
  it('4 kW residential: 5,480 kWh/yr, 457 kWh/mo, 2.2 tons CO2', () => {
    const annual = estimateAnnualKwh(4);
    expect(annual).toBe(5480);
    expect(estimateMonthlyKwh(annual)).toBe(457);
    expect(estimateCo2Tons(annual)).toBe(2.2);
  });

  it('10 kW residential: 13,700 kWh/yr, 1,142 kWh/mo, 5.5 tons CO2', () => {
    const annual = estimateAnnualKwh(10);
    expect(annual).toBe(13700);
    expect(estimateMonthlyKwh(annual)).toBe(1142);
    expect(estimateCo2Tons(annual)).toBe(5.5);
  });

  it('handles very small (1 kW) and large (1 MW) systems', () => {
    // 1 kW tiny
    const tiny = estimateAnnualKwh(1);
    expect(tiny).toBe(1370);
    expect(estimateCo2Tons(tiny)).toBe(0.5);

    // 1000 kW = 1 MW utility-scale
    const big = estimateAnnualKwh(1000);
    expect(big).toBe(1370000);
    expect(estimateCo2Tons(big)).toBe(548);
  });
});
