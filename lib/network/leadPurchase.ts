/**
 * lib/network/leadPurchase.ts
 * One-time "pay to claim" checkout for SolarPro Network leads.
 *
 * Reuses the existing Stripe client (lib/stripe.ts) that already powers
 * subscription billing. A lead is a ONE-TIME purchase, so we use Stripe
 * Checkout in `payment` mode with a dynamic price built from the
 * opportunity's own `asking_price` — no Stripe Products / line items to
 * pre-create.
 *
 * The claim is NOT finalized here. This only sends the contractor to pay.
 * Finalization (mark claimed, unlock address, stamp payment ids) happens in
 * the Stripe webhook once `checkout.session.completed` arrives.
 */

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/env";
import { getDbReady } from "@/lib/db-neon";
import { logNetworkEvent } from "@/lib/network/attributionTracker";

export interface LeadCheckoutResult {
  url?: string;
  error?: string;
  status?: number;
}

export async function createLeadCheckoutSession(params: {
  opportunityId: string;
  contractorId: string;
}): Promise<LeadCheckoutResult> {
  const { opportunityId, contractorId } = params;
  const sql = await getDbReady();

  const rows = await sql`
    SELECT
      id,
      status,
      COALESCE(marketplace_status, 'live') AS marketplace_status,
      claim_mode,
      max_claims,
      claim_count,
      asking_price,
      location_city,
      location_state,
      estimated_system_size_kw,
      opportunity_grade
    FROM network_opportunities
    WHERE id = ${opportunityId}
    LIMIT 1
  `;

  if (!rows.length) return { error: "Lead not found.", status: 404 };
  const opp = rows[0] as Record<string, unknown>;

  // ── Availability guard (re-checked atomically again at webhook finalize) ──
  const claimMode = opp.claim_mode === "shared" ? "shared" : "exclusive";
  const maxClaims = Math.max(1, Math.floor(Number(opp.max_claims ?? 1)));
  const claimCount = Number(opp.claim_count ?? 0);

  if (opp.status !== "live" || opp.marketplace_status !== "live") {
    return { error: "This lead is no longer available.", status: 409 };
  }
  if (
    (claimMode === "exclusive" && claimCount >= 1) ||
    (claimMode === "shared" && claimCount >= maxClaims)
  ) {
    return { error: "This lead is no longer available.", status: 409 };
  }

  // ── Price guard — never charge $0 ──
  const price = Number(opp.asking_price ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      error:
        "This lead has no price set yet. An admin needs to price it before it can be sold.",
      status: 409,
    };
  }

  const buyer = await sql`
    SELECT email, name FROM users WHERE id = ${contractorId} LIMIT 1
  `;
  if (!buyer.length) return { error: "Contractor not found.", status: 404 };

  const baseUrl = getBaseUrl();
  const unitAmount = Math.round(price * 100);
  const location =
    [opp.location_city, opp.location_state].filter(Boolean).join(", ") ||
    "Solar lead";
  const gradePrefix = opp.opportunity_grade
    ? `Grade ${String(opp.opportunity_grade)} `
    : "";
  const sizeNote = opp.estimated_system_size_kw
    ? ` · ~${Number(opp.estimated_system_size_kw).toFixed(1)} kW`
    : "";

  const metadata = {
    kind: "lead_claim",
    opportunityId,
    contractorId,
  } as const;

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: (buyer[0].email as string) || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          product_data: {
            name: `${gradePrefix}SolarPro Lead — ${location}`,
            description: `Exclusive solar lead${sizeNote}. Homeowner contact unlocks immediately after purchase.`,
          },
        },
      },
    ],
    success_url: `${baseUrl}/network?purchased=${opportunityId}`,
    cancel_url: `${baseUrl}/network?canceled=${opportunityId}`,
    metadata,
    payment_intent_data: { metadata },
  });

  return { url: session.url ?? undefined };
}

async function refundPaymentIntent(paymentIntentId: string | null): Promise<void> {
  if (!paymentIntentId) return;
  try {
    await getStripe().refunds.create({ payment_intent: paymentIntentId });
  } catch (err: unknown) {
    console.error(
      "[lead_claim] auto-refund failed:",
      (err as Error)?.message ?? err,
    );
  }
}

/**
 * Finalize a paid lead claim. Called from the Stripe webhook once
 * `checkout.session.completed` arrives for a session whose metadata.kind is
 * "lead_claim". Mirrors the exclusive-claim logic of the claim route, but
 * stamps the Stripe payment ids — and AUTO-REFUNDS if the lead was taken in
 * the meantime (a contractor never pays for a lead they don't receive).
 *
 * Idempotent: Stripe may deliver the same event more than once.
 */
export async function finalizeLeadClaim(
  session: Stripe.Checkout.Session,
): Promise<{ success: boolean; message: string }> {
  const opportunityId = session.metadata?.opportunityId;
  const contractorId = session.metadata?.contractorId;
  if (!opportunityId || !contractorId) {
    return { success: false, message: "lead_claim: missing metadata." };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const amount =
    session.amount_total != null ? session.amount_total / 100 : null;

  const sql = await getDbReady();

  // ── Idempotency — already finalized for this payment? no-op. ──
  const already = await sql`
    SELECT id, status FROM opportunity_assignments
     WHERE opportunity_id = ${opportunityId}
       AND contractor_id = ${contractorId}
       AND payment_intent_id = ${paymentIntentId}
     LIMIT 1
  `;
  if (
    already.length &&
    ["claimed", "contacted", "appointment", "proposal", "won"].includes(
      String(already[0].status),
    )
  ) {
    return { success: true, message: `lead_claim already finalized: ${opportunityId}` };
  }

  const oppRows = await sql`
    SELECT claim_mode, max_claims, claim_count, status,
           COALESCE(marketplace_status, 'live') AS marketplace_status
      FROM network_opportunities
     WHERE id = ${opportunityId}
     LIMIT 1
  `;
  if (!oppRows.length) {
    await refundPaymentIntent(paymentIntentId);
    return { success: false, message: `lead_claim: opportunity missing, refunded ${opportunityId}` };
  }
  const opp = oppRows[0] as Record<string, unknown>;
  const claimMode = opp.claim_mode === "shared" ? "shared" : "exclusive";
  const maxClaims = Math.max(1, Math.floor(Number(opp.max_claims ?? 1)));

  // ── Claim the assignment (update an existing offer, else insert) ──
  let updated = await sql`
    UPDATE opportunity_assignments
       SET status = 'claimed', claimed_at = NOW(), claim_amount = ${amount},
           payment_intent_id = ${paymentIntentId}, payment_status = 'succeeded',
           updated_at = NOW()
     WHERE opportunity_id = ${opportunityId}
       AND contractor_id = ${contractorId}
       AND status IN ('offered','viewed')
       AND (offer_expires_at IS NULL OR offer_expires_at > NOW())
    RETURNING id
  `;
  if (!updated.length) {
    try {
      updated = await sql`
        INSERT INTO opportunity_assignments (
          opportunity_id, contractor_id, status, assignment_type,
          offered_at, claimed_at, claim_amount, payment_intent_id, payment_status
        ) VALUES (
          ${opportunityId}, ${contractorId}, 'claimed', 'marketplace',
          NOW(), NOW(), ${amount}, ${paymentIntentId}, 'succeeded'
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
    } catch {
      updated = [];
    }
  }
  if (!updated.length) {
    await refundPaymentIntent(paymentIntentId);
    await logNetworkEvent({
      event_type: "assignment.claim_refunded",
      event_category: "assignment",
      opportunity_id: opportunityId,
      contractor_id: contractorId,
      data: { source: "lead_checkout_v1", reason: "already_claimed", payment_intent_id: paymentIntentId, amount },
      triggered_by: "system",
    });
    return { success: false, message: `lead_claim: lost race, refunded ${opportunityId}` };
  }

  const assignmentId = (updated[0] as Record<string, unknown>).id as string;

  // ── Capacity/status guard on the opportunity itself ──
  const oppUpdated = await sql`
    UPDATE network_opportunities
       SET status = CASE WHEN ${claimMode} = 'exclusive' THEN 'claimed' ELSE status END,
           marketplace_status = CASE WHEN ${claimMode} = 'exclusive' THEN 'claimed' ELSE marketplace_status END,
           claimed_at = COALESCE(claimed_at, NOW()),
           claim_count = LEAST(COALESCE(claim_count, 0) + 1, ${maxClaims}),
           updated_at = NOW()
     WHERE id = ${opportunityId}
       AND status = 'live'
       AND COALESCE(marketplace_status, 'live') = 'live'
       AND (
         (${claimMode} = 'exclusive' AND COALESCE(claim_count, 0) = 0)
         OR (${claimMode} = 'shared' AND COALESCE(claim_count, 0) < ${maxClaims})
       )
    RETURNING id
  `;
  if (!oppUpdated.length) {
    await sql`
      UPDATE opportunity_assignments
         SET status = 'refunded', payment_status = 'refunded',
             refund_amount = ${amount}, refund_at = NOW(),
             refund_reason = 'race_lost_auto_refund', updated_at = NOW()
       WHERE id = ${assignmentId}
    `;
    await refundPaymentIntent(paymentIntentId);
    await logNetworkEvent({
      event_type: "assignment.claim_refunded",
      event_category: "assignment",
      opportunity_id: opportunityId,
      assignment_id: assignmentId,
      contractor_id: contractorId,
      data: { source: "lead_checkout_v1", reason: "capacity_or_status_changed", payment_intent_id: paymentIntentId, amount },
      triggered_by: "system",
    });
    return { success: false, message: `lead_claim: capacity lost, refunded ${opportunityId}` };
  }

  await logNetworkEvent({
    event_type: "assignment.purchased",
    event_category: "assignment",
    opportunity_id: opportunityId,
    assignment_id: assignmentId,
    contractor_id: contractorId,
    from_status: "live",
    to_status: claimMode === "exclusive" ? "claimed" : "live",
    data: { source: "lead_checkout_v1", payment_intent_id: paymentIntentId, amount, claim_mode: claimMode },
    triggered_by: "contractor",
  });

  return { success: true, message: `lead_claim finalized: ${opportunityId} ($${amount})` };
}
