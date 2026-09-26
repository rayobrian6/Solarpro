export const maxDuration = 15;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { handleRouteDbError } from "@/lib/db-neon";
import { readLeadCheckoutOutcome } from "@/lib/network/leadPurchase";

// ---------------------------------------------------------------------------
// GET /api/network/lead-outcome?session=<stripe_checkout_session_id>
//
// 🚨 WHAT ACTUALLY HAPPENED TO MY MONEY.
//
// The return page used to announce "Payment received — lead unlocked. See My
// Claims for the full address." from the mere presence of a query parameter,
// without consulting any outcome. A contractor who lost an exclusive claim race
// was charged, silently refunded, and sent to look at an empty My Claims tab.
//
// This endpoint makes the outcome ADDRESSABLE. It resolves the Stripe checkout
// session to the assignment row that payment produced and reports what the row
// says RIGHT NOW — unlocked, refunded because the lead was taken, or a refund
// that has not completed. Nothing is cached and nothing is snapshotted, so the
// answer cannot go stale behind a concurrent refund.
//
// `processing` is a real answer, not a failure: Stripe redirects the browser
// before it delivers `checkout.session.completed`, so the first poll normally
// arrives before the webhook does.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = new URL(req.url).searchParams.get("session");
  if (!sessionId) {
    return NextResponse.json(
      { error: "A checkout session id is required." },
      { status: 400 },
    );
  }

  try {
    // Authorization is part of the resolution: a session that belongs to
    // another contractor resolves to `not_found`, never to their outcome.
    const outcome = await readLeadCheckoutOutcome({
      checkoutSessionId: sessionId,
      contractorId: user.id,
    });

    return NextResponse.json({ success: true, outcome });
  } catch (err: unknown) {
    return handleRouteDbError("[GET /api/network/lead-outcome]", err);
  }
}
