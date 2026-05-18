/**
 * lib/bill/hydrateBillData.ts
 *
 * Shared bill-data hydration utility — extracted from lib/db/core.ts (rowToProject)
 * and lib/db/production.ts (getProjectWithDetails) to eliminate the ~90-line duplicate.
 *
 * Given a raw `bill_data` JSONB object and the parent DB row (for utility_name /
 * utility_rate_per_kwh fallbacks), returns typed BillAnalysis + scalar utility fields.
 *
 * Two storage formats are handled:
 *   1. New format  — bill_data._billAnalysis is a pre-built BillAnalysis object
 *   2. Flat/legacy — bill_data contains raw OCR fields; synthesized here on read
 */

import { validateAndCorrectUtilityRate } from '@/lib/utility-rules';
import type { BillAnalysis } from '@/types';

export interface HydratedBillFields {
  billAnalysis: BillAnalysis | undefined;
  utilityName: string | undefined;
  utilityRatePerKwh: number | undefined;
  stateCode: string | undefined;
  city: string | undefined;
}

/**
 * Hydrate a raw `bill_data` JSONB blob into typed BillAnalysis + scalar utility fields.
 *
 * @param rawBillData  - The bill_data column value (may be undefined / null)
 * @param row          - The full DB row; used for utility_name / utility_rate_per_kwh fallbacks
 */
export function hydrateBillData(
  rawBillData: Record<string, unknown> | undefined | null,
  row: Record<string, unknown>,
): HydratedBillFields {
  let billAnalysis: BillAnalysis | undefined;
  let utilityName: string | undefined;
  let utilityRatePerKwh: number | undefined;
  let stateCode: string | undefined;
  let city: string | undefined;

  if (rawBillData) {
    if (rawBillData._billAnalysis) {
      // ── New format ───────────────────────────────────────────────────────────
      // bill_data._billAnalysis is the pre-computed BillAnalysis object saved by
      // handleBillComplete on the client side.
      billAnalysis = rawBillData._billAnalysis as BillAnalysis;
      utilityName = (rawBillData._utilityName as string) || undefined;
      utilityRatePerKwh = (rawBillData._utilityRatePerKwh as number) || undefined;
      stateCode = (rawBillData._stateCode as string) || undefined;
      // FIX v47.8: hydrate city from bill_data._city (stored by handleBillComplete)
      city = (rawBillData._city as string) || undefined;
    } else if (
      rawBillData.monthlyKwh ||
      rawBillData.annualKwh ||
      rawBillData.estimatedAnnualKwh ||
      rawBillData.monthlyUsageHistory ||
      rawBillData.utilityProvider ||
      rawBillData.electricityRate
    ) {
      // ── Flat / legacy format ─────────────────────────────────────────────────
      // bill_data contains raw OCR fields (from provision or legacy save).
      // Synthesize a BillAnalysis so BillTab can render without crashing.
      // Also triggered on utilityProvider/electricityRate alone so rate lookup works
      // even when kWh fields were not extracted.

      // Priority for monthly array: monthlyUsageHistory[] > monthlyKwh[] > fill from annual
      const rawHistory = rawBillData.monthlyUsageHistory;
      const rawMonthly = rawBillData.monthlyKwh;
      const monthlyKwhArray: number[] =
        Array.isArray(rawHistory) && (rawHistory as number[]).length >= 3
          ? (rawHistory as number[]).slice(0, 12)
          : Array.isArray(rawMonthly)
            ? (rawMonthly as number[])
            : (() => {
                const annKwh =
                  ((rawBillData.annualKwh as number) || 0) ||
                  ((rawBillData.estimatedAnnualKwh as number) || 0) ||
                  (typeof rawBillData.monthlyKwh === 'number'
                    ? (rawBillData.monthlyKwh as number) * 12
                    : 0);
                const avg = Math.round(annKwh / 12);
                return Array(12).fill(avg > 0 ? avg : 0);
              })();

      const annualKwh =
        ((rawBillData.annualKwh as number) || 0) ||
        ((rawBillData.estimatedAnnualKwh as number) || 0) ||
        monthlyKwhArray.reduce((a: number, b: number) => a + b, 0);
      const avgMonthlyKwh = Math.round(annualKwh / 12);

      // Rate: validate against utility DB to always get retail rate, not supply-only component
      const utilityNameForRate =
        (rawBillData.utilityProvider as string) || (row.utility_name as string) || null;
      const rawRate =
        ((rawBillData.electricityRate as number) > 0
          ? (rawBillData.electricityRate as number)
          : null) ??
        ((row.utility_rate_per_kwh as number) > 0
          ? (row.utility_rate_per_kwh as number)
          : null);
      const rateValidation = validateAndCorrectUtilityRate(rawRate, utilityNameForRate);
      const utilityRate = rateValidation.rate;

      const avgMonthlyBill =
        ((rawBillData.estimatedMonthlyBill as number) || 0) ||
        ((rawBillData.totalAmount as number) || 0) ||
        Math.round(avgMonthlyKwh * utilityRate * 100) / 100;

      const monthlyKwhSafe = monthlyKwhArray.length > 0 ? monthlyKwhArray : [0];
      const peakKwh = Math.max(...monthlyKwhSafe);
      const peakMonth = monthlyKwhSafe.indexOf(peakKwh);

      // Hydrate top-level utility scalar fields from flat data
      utilityName = utilityNameForRate || undefined;
      utilityRatePerKwh = utilityRate;
      stateCode =
        (rawBillData.stateCode as string) || (row.state_code as string) || undefined;
      city = (rawBillData.city as string) || (row.city as string) || undefined;

      billAnalysis = {
        monthlyKwh: monthlyKwhArray,
        annualKwh,
        averageMonthlyKwh: avgMonthlyKwh,
        averageMonthlyBill: avgMonthlyBill,
        annualBill: avgMonthlyBill * 12,
        utilityRate,
        peakMonthKwh: peakKwh,
        peakMonth: peakMonth >= 0 ? peakMonth : 0,
        recommendedSystemKw: (rawBillData.systemSizeKw as number) || 0,
        recommendedPanelCount: 0,
        offsetTarget: 100,
      } as BillAnalysis;
    }
  }

  return { billAnalysis, utilityName, utilityRatePerKwh, stateCode, city };
}
