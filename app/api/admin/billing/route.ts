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

    // 🚨 MRR WAS ARITHMETIC OVER THE FIRST STRIPE PAGE ONLY.
    //
    // This was a single `subscriptions.list({ status: "all", limit: 100 })` and
    // every tile below was summed over `res.data` — so once the account held
    // more than 100 subscription objects the MRR figure silently understated
    // revenue, "Extra seats sold" undercounted, and "Total subs" froze at
    // exactly 100 and never moved again. No banner, no flag, no error: a
    // confident dollar figure computed over an arbitrary subset.
    //
    // `status: "all"` makes it worse than it sounds. CANCELLED subscriptions
    // consume page slots, so the cap is burned on churn and the undercount
    // arrives well before 100 PAYING customers exist. `status` is deliberately
    // left as "all" — the table below is meant to show churn — and the cap is
    // fixed by paging instead.
    //
    // PAGE_LIMIT is a real bound, not decoration: a 30s route cannot page
    // without one. If it is ever hit, `partial` says so rather than letting the
    // tiles present a subset as a total.
    const PAGE_SIZE = 100;
    const PAGE_LIMIT = 100; // 10,000 subscription objects
    const data: Awaited<ReturnType<typeof stripe.subscriptions.list>>["data"] = [];
    let startingAfter: string | undefined;
    let pagesFetched = 0;
    let partial = false;

    for (;;) {
      const page = await stripe.subscriptions.list({
        status: "all",
        limit: PAGE_SIZE,
        expand: ["data.customer", "data.items.data.price"],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      pagesFetched++;
      data.push(...page.data);
      if (!page.has_more || page.data.length === 0) break;
      if (pagesFetched >= PAGE_LIMIT) { partial = true; break; }
      startingAfter = page.data[page.data.length - 1].id;
    }

    let mrr = 0, activeCount = 0, totalSeats = 0;
    const subs = data.map((s) => {
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

    // `partial` travels with the numbers so a consumer can never render a capped
    // subset as a total. app/admin/billing/page.tsx does not read it yet — when
    // it does, a true `partial` must suppress the bare figures (e.g. "10,000+")
    // rather than print them.
    return NextResponse.json({
      success: true,
      stats: { mrr, activeCount, totalSeats, total: subs.length, partial, pagesFetched },
      subs,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Billing fetch failed", message: (e as Error).message }, { status: 500 });
  }
}
