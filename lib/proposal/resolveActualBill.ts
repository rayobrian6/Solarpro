import { hydrateBillData } from '@/lib/bill/hydrateBillData';

/**
 * Resolve the homeowner's REAL total annual bill ($) for the proposal — the same
 * number the project Bill tab shows. It is NOT reliably on the client.annualBill
 * column; the authoritative value comes from the hydrated bill_data (_billAnalysis
 * / flat OCR fields). We try every real-bill source and take the largest non-zero
 * one (the true total bill is always ≥ the energy-only estimate).
 *
 * Returns undefined when no bill is on file (proposal then falls back to the
 * energy-only estimate — no fixed-charge adjustment applied).
 */
export function resolveActualAnnualBill(client: unknown): number | undefined {
  if (!client || typeof client !== 'object') return undefined;
  const c = client as Record<string, unknown>;

  const candidates: number[] = [
    Number(c.annualBill) || 0,
    (Number(c.averageMonthlyBill) || 0) * 12,
  ];
  let usageReference = 0; // annualKwh × blended retail rate (energy-only floor)

  try {
    const h = hydrateBillData(
      (c.billData as Record<string, unknown> | undefined) ?? undefined,
      { average_monthly_bill: c.averageMonthlyBill, annual_bill: c.annualBill },
    );
    const ba = h?.billAnalysis as
      | { annualBill?: number; averageMonthlyBill?: number; annualKwh?: number; utilityRate?: number }
      | undefined;
    if (ba && typeof ba.annualBill === 'number' && ba.annualBill > 0) {
      candidates.push(ba.annualBill);
    }
    if (ba && typeof ba.averageMonthlyBill === 'number' && ba.averageMonthlyBill > 0) {
      candidates.push(ba.averageMonthlyBill * 12);
    }
    if (ba && (ba.annualKwh ?? 0) > 0 && (ba.utilityRate ?? 0) > 0) {
      usageReference = (ba.annualKwh as number) * (ba.utilityRate as number);
    }
  } catch {
    /* hydration is best-effort — fall back to the client columns */
  }

  const nonZero = candidates.filter(v => v > 0);
  if (nonZero.length === 0) return undefined;

  // Usage-aware selection (audit 2026-07-16): blind Math.max let a single
  // high-usage bill ×12 win — a $271.38 bill from a 2,208 kWh month became a
  // $3,257/yr baseline on a 1,479 kWh/mo home. When usage + rate are known,
  // prefer the candidate closest to the usage-anchored reference (fixed
  // charges legitimately put the real bill somewhat ABOVE energy-only, so
  // distance is measured against reference ×1.12 ≈ typical fixed uplift).
  if (usageReference > 0) {
    const anchor = usageReference * 1.12;
    return nonZero.reduce((best, v) =>
      Math.abs(v - anchor) < Math.abs(best - anchor) ? v : best);
  }
  return Math.max(...nonZero);
}

/**
 * Real per-month usage history (12 kWh values) from the hydrated bill data —
 * for the seasonal shape of the before/after bill chart. Returns undefined
 * when there is no REAL monthly variation (hydration flat-fills the array
 * from the annual average when actual months are absent, so an all-equal
 * array means "no real history", not "perfectly flat usage").
 */
export function resolveMonthlyUsageHistory(client: unknown): number[] | undefined {
  if (!client || typeof client !== 'object') return undefined;
  const c = client as Record<string, unknown>;
  try {
    const h = hydrateBillData(
      (c.billData as Record<string, unknown> | undefined) ?? undefined,
      { average_monthly_bill: c.averageMonthlyBill, annual_bill: c.annualBill },
    );
    const arr = (h?.billAnalysis as { monthlyKwh?: number[] } | undefined)?.monthlyKwh;
    if (!Array.isArray(arr) || arr.length !== 12) return undefined;
    const nz = arr.filter(v => v > 0);
    if (nz.length < 3) return undefined;
    const distinct = new Set(nz.map(v => Math.round(v)));
    if (distinct.size < 2) return undefined; // flat-filled synthetic array
    return arr;
  } catch {
    return undefined;
  }
}
