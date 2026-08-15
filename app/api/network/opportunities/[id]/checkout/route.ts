export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError, isValidUUID } from "@/lib/db-neon";
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";
import { evaluateContractorEligibility } from "@/lib/network/contractorEligibility";
import { createLeadCheckoutSession } from "@/lib/network/leadPurchase";
import { logNetworkEvent } from "@/lib/network/attributionTracker";

type Params = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// POST /api/network/opportunities/[id]/checkout
// Start a one-time Stripe Checkout to PAY for (and thereby claim) a lead.
// The claim is finalized in the Stripe webhook on checkout.session.completed.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await checkRateLimit("standard", getClientIp(req));
  if (!rl.allowed)
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const { id } = params;
  if (!isValidUUID(id))
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  try {
    const sql = await getDbReady();

    // Same eligibility gate as the claim flow — don't send an ineligible
    // contractor to a payment page they can't complete.
    const eligibility = await evaluateContractorEligibility({
      sql,
      contractorId: user.id,
      opportunityId: id,
    });

    if (!eligibility.eligible) {
      await logNetworkEvent({
        event_type: "assignment.checkout_blocked",
        event_category: "assignment",
        opportunity_id: id,
        contractor_id: user.id,
        data: { source: "lead_checkout_v1", eligibility },
        triggered_by: "contractor",
      });
      return NextResponse.json(
        { error: "You are not eligible to claim this lead.", eligibility },
        { status: 409 },
      );
    }

    const result = await createLeadCheckoutSession({
      opportunityId: id,
      contractorId: user.id,
    });

    if (result.error || !result.url) {
      return NextResponse.json(
        { error: result.error || "Could not start checkout." },
        { status: result.status ?? 400 },
      );
    }

    await logNetworkEvent({
      event_type: "assignment.checkout_started",
      event_category: "assignment",
      opportunity_id: id,
      contractor_id: user.id,
      data: { source: "lead_checkout_v1" },
      triggered_by: "contractor",
    });

    return NextResponse.json({ success: true, url: result.url });
  } catch (err: unknown) {
    return handleRouteDbError(
      "[POST /api/network/opportunities/:id/checkout]",
      err,
    );
  }
}
