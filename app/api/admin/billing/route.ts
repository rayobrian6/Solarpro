/**
 * GET /api/admin/billing
 *
 * Admin billing tracker — pulls live subscriptions from Stripe so you can see
 * exactly what's being charged: each account's plan, extra seats, monthly amount,
 * status, and renewal. Computes MRR + seat totals. Source of truth = Stripe.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { getStripe } from "@/lib/stripe";

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ success: false, error: "STRIPE_SECRET_KEY not set" }, { status: 500 });
  }

  const planByPrice: Record<string, string> = {};
  if (process.env.STRIPE_PRICE_STARTER) planByPrice[process.env.STRIPE_PRICE_STARTER] = "Starter";
  if (process.env.STRIPE_PRICE_PROFESSIONAL) planByPrice[process.env.STRIPE_PRICE_PROFESSIONAL] = "Professional";
  if (process.env.STRIPE_PRICE_CONTRACTOR) planByPrice[process.env.STRIPE_PRICE_CONTRACTOR] = "Contractor";
  const seatPrice = process.env.STRIPE_PRICE_EXTRA_SEAT || "";

  try {
    const stripe = getStripe();
    const res = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      expand: ["data.customer", "data.items.data.price"],
    });

    let mrr = 0, activeCount = 0, totalSeats = 0;
    const subs = res.data.map((s) => {
      let plan = "—", seats = 0, amount = 0;
      for (const it of s.items.data) {
        const unit = (it.price.unit_amount ?? 0) / 100;
        const qty = it.quantity ?? 1;
        amount += unit * qty;
        if (seatPrice && it.price.id === seatPrice) seats += qty;
        else if (planByPrice[it.price.id]) plan = planByPrice[it.price.id];
      }
      const active = s.status === "active" || s.status === "trialing";
      if (active) { mrr += amount; activeCount++; totalSeats += seats; }
      const cust = s.customer as { email?: string; name?: string; deleted?: boolean } | string;
      return {
        id: s.id,
        status: s.status,
        plan,
        seats,
        amount,
        email: typeof cust === "object" && !cust.deleted ? (cust.email || "") : "",
        name: typeof cust === "object" && !cust.deleted ? (cust.name || "") : "",
        created: s.created,
        renewsAt: (s as unknown as { current_period_end?: number }).current_period_end ?? null,
      };
    });
    subs.sort((a, b) => b.amount - a.amount);

    return NextResponse.json({ success: true, stats: { mrr, activeCount, totalSeats, total: subs.length }, subs });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Billing fetch failed", message: (e as Error).message }, { status: 500 });
  }
}
