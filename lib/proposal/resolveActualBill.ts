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

  try {
    const h = hydrateBillData(
      (c.billData as Record<string, unknown> | undefined) ?? undefined,
      { average_monthly_bill: c.averageMonthlyBill, annual_bill: c.annualBill },
    );
    const ba = h?.billAnalysis as
      | { annualBill?: number; averageMonthlyBill?: number }
      | undefined;
    if (ba && typeof ba.annualBill === 'number' && ba.annualBill > 0) {
      candidates.push(ba.annualBill);
    }
    if (ba && typeof ba.averageMonthlyBill === 'number' && ba.averageMonthlyBill > 0) {
      candidates.push(ba.averageMonthlyBill * 12);
    }
  } catch {
    /* hydration is best-effort — fall back to the client columns */
  }

  const best = Math.max(...candidates);
  return best > 0 ? best : undefined;
}
