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
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🚨 THE LOSER OF A CLAIM RACE IS A PAYING CUSTOMER, AND HE MUST BE TOLD.
 * ════════════════════════════════════════════════════════════════════════════
 * Two contractors can complete checkout for the same exclusive lead seconds
 * apart. Detection of that race is correct and must not be touched: the
 * capacity mutation is a conditional `UPDATE ... WHERE claim_count = 0`, and
 * migration 072 holds the partial unique index that keeps one contractor from
 * ever holding two active rows for one opportunity. Postgres re-evaluates that
 * WHERE clause after the first writer commits, so exactly one contractor wins.
 *
 * Everything that happened AFTER detection was wrong, in three ways:
 *
 *   1. ORDER. The row was set to `payment_status = 'refunded'` — with a
 *      `refund_amount` and a `refund_at` — and only THEN was Stripe asked for
 *      the refund, inside a try/catch that swallowed the failure into a
 *      console.error. A failed refund therefore produced a row asserting the
 *      money had been returned while it was still ours. Every reconciliation
 *      reader trusts those columns (`refunds_30d` in admin health,
 *      `refunded` in the contractor performance producer), so the lie
 *      propagated. Stripe is now called FIRST and `refunded` is written only
 *      against a real Stripe refund object; otherwise the row says
 *      `refund_pending`, leaves refund_amount / refund_at NULL, and raises a
 *      queryable event.
 *
 *   2. ADDRESSABILITY. `success_url` was `/network?purchased=<id>`, and the
 *      page fired "Payment received — lead unlocked. See My Claims" from the
 *      mere presence of that parameter, without ever consulting the outcome.
 *      The refunded loser was sent to look for an address that was not there.
 *      The success_url now carries the checkout session id, which
 *      `readLeadCheckoutOutcome` resolves to the actual assignment row.
 *
 *   3. IDEMPOTENCY OF THE MONEY. Stripe re-delivers
 *      `checkout.session.completed`, and two deliveries can be in flight at
 *      once. The old `already` pre-check was a plain SELECT restricted to the
 *      ACTIVE statuses, so a re-delivery of an ALREADY-REFUNDED payment fell
 *      straight through it and ran the whole claim path again — inserting
 *      another assignment row (status 'refunded' is outside 072's partial
 *      index, so nothing stopped it) and asking Stripe for a second refund.
 *      Worse, two SIMULTANEOUS deliveries of the same winning payment both
 *      missed the pre-check; one lost the INSERT to 072's index, read that as
 *      "someone else took the lead", and refunded the winner — who kept the
 *      lead. Refunds are now gated on `webhook_ingestion_log.idempotency_key`
 *      (UNIQUE, migration 057 — the mechanism intake already uses) and carry
 *      the same key to Stripe as a request idempotency key.
 */

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/env";
import { getDbReady } from "@/lib/db-neon";
import { logNetworkEvent } from "@/lib/network/attributionTracker";

type Sql = Awaited<ReturnType<typeof getDbReady>>;

/**
 * The assignment statuses that mean "this contractor holds this lead". Kept in
 * one place because three different decisions read it: the finalize
 * idempotency pre-check, the duplicate-delivery discriminator, and the outcome
 * reader that the return page polls.
 */
const ACTIVE_CLAIM_STATUSES = [
  "claimed",
  "contacted",
  "appointment",
  "proposal",
  "won",
] as const;

/** Money was taken and has NOT been given back. Never write these loosely. */
const REFUND_PENDING_STATUS = "refund_pending";

export interface LeadCheckoutResult {
  url?: string;
  error?: string;
  status?: number;
}

/**
 * Starter price by lead grade (SolarPro's pricing model). Used when a lead has
 * no explicit `asking_price` set, so every graded lead is sellable without
 * manual pricing — and the displayed price always matches what we charge.
 */
export function gradeDefaultPrice(grade: unknown): number {
  const g = String(grade ?? "").trim().toUpperCase().charAt(0);
  switch (g) {
    case "A":
      return 75;
    case "B":
      return 45;
    case "C":
      return 25;
    case "D":
      return 15;
    default:
      return 25;
  }
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

  // ── Price: explicit asking_price, else the grade's starter price ──
  const explicitPrice = Number(opp.asking_price ?? 0);
  const price =
    Number.isFinite(explicitPrice) && explicitPrice > 0
      ? explicitPrice
      : gradeDefaultPrice(opp.opportunity_grade);
  if (!Number.isFinite(price) || price <= 0) {
    return {
      error: "This lead has no price set yet.",
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
    // 🚨 The outcome is ADDRESSABLE, not assumed. `{CHECKOUT_SESSION_ID}` is
    // substituted by Stripe on redirect; the return page resolves it through
    // readLeadCheckoutOutcome instead of announcing success from the mere
    // presence of a query parameter. Losing this placeholder re-creates the
    // original defect, so the checkout test asserts on it.
    success_url: `${baseUrl}/network?session={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/network?canceled=${opportunityId}`,
    metadata,
    payment_intent_data: { metadata },
  });

  return { url: session.url ?? undefined };
}

// ════════════════════════════════════════════════════════════════════════════
// Idempotency + outcome addressing, both carried on webhook_ingestion_log
// ════════════════════════════════════════════════════════════════════════════
// Migration 057 gives that table `idempotency_key TEXT UNIQUE NOT NULL`, and
// the intake webhooks already use it as an atomic once-only claim
// (`INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` returns a
// row to exactly one caller). Extending that mechanism is deliberate: a second,
// parallel idempotency store would be one more thing to keep consistent, and
// the existing one is already an immutable audit log — which is what a record
// of "we moved this contractor's money" should be.

const LEAD_CLAIM_PLATFORM = "stripe_lead_claim";

/** Resolves a Stripe Checkout session id to the payment it finalized. */
export function leadOutcomeIndexKey(checkoutSessionId: string): string {
  return `lead_claim:session:${checkoutSessionId}`;
}

/** One refund per payment intent, ever. */
export function leadRefundGateKey(paymentIntentId: string): string {
  return `lead_claim:refund:${paymentIntentId}`;
}

/**
 * Make the checkout session resolvable to (opportunity, contractor, payment
 * intent) WITHOUT a schema change and WITHOUT a Stripe round-trip on every
 * poll of the return page. Written on every finalize attempt, including the
 * ones that end in a refund — a loser whose outcome cannot be looked up is the
 * defect this repair exists to remove.
 *
 * Best-effort: a failure here must not block the claim or the refund, so it is
 * logged and swallowed. The page then reports "processing", which is honest.
 */
async function indexCheckoutOutcome(
  sql: Sql,
  args: {
    checkoutSessionId: string | null;
    opportunityId: string;
    contractorId: string;
    paymentIntentId: string | null;
  },
): Promise<void> {
  if (!args.checkoutSessionId) return;
  try {
    await sql`
      INSERT INTO webhook_ingestion_log (
        idempotency_key, platform, http_method, status, action,
        opportunity_id, parsed_payload, signature_verified, verification_method
      ) VALUES (
        ${leadOutcomeIndexKey(args.checkoutSessionId)},
        ${LEAD_CLAIM_PLATFORM},
        'POST',
        'received',
        'lead_claim_finalize',
        ${args.opportunityId},
        ${JSON.stringify({
          kind: "lead_claim",
          checkout_session_id: args.checkoutSessionId,
          opportunity_id: args.opportunityId,
          contractor_id: args.contractorId,
          payment_intent_id: args.paymentIntentId,
        })},
        true,
        'stripe_signature'
      )
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
  } catch (err: unknown) {
    console.error(
      "[lead_claim] outcome index write failed (return page will report processing):",
      (err as Error)?.message ?? err,
    );
  }
}

type RefundGate =
  | { state: "acquired"; id: string | null }
  | { state: "held_elsewhere" };

/**
 * Atomically take ownership of "the refund for this payment intent".
 *
 * Reclaimable only from a RECORDED failure or from a lease older than ten
 * minutes, so a genuine Stripe retry can still complete while a concurrent
 * duplicate delivery cannot. A row sitting at 'processed' never matches, which
 * is what makes a second refund impossible.
 *
 * Fails OPEN if the gate table is unreachable, because the Stripe request
 * idempotency key (the same string) independently prevents the money from
 * moving twice — and refusing to refund a contractor because an audit table is
 * down would be the worse failure.
 */
async function acquireRefundGate(
  sql: Sql,
  key: string,
  opportunityId: string,
): Promise<RefundGate> {
  try {
    const rows = await sql`
      INSERT INTO webhook_ingestion_log (
        idempotency_key, platform, http_method, status, action, opportunity_id
      ) VALUES (
        ${key}, ${LEAD_CLAIM_PLATFORM}, 'POST', 'refunding',
        'lead_claim_refund', ${opportunityId}
      )
      ON CONFLICT (idempotency_key) DO UPDATE
         SET status = 'refunding',
             retry_count = webhook_ingestion_log.retry_count + 1,
             processing_error = NULL,
             processed_at = NULL,
             received_at = NOW()
       WHERE webhook_ingestion_log.status = 'failed'
          OR webhook_ingestion_log.received_at < NOW() - INTERVAL '10 minutes'
      RETURNING id
    `;
    if (rows.length) return { state: "acquired", id: rows[0].id as string };
    return { state: "held_elsewhere" };
  } catch (err: unknown) {
    console.warn(
      "[lead_claim] refund idempotency gate unavailable; relying on the Stripe request key:",
      (err as Error)?.message ?? err,
    );
    return { state: "acquired", id: null };
  }
}

async function closeRefundGate(
  sql: Sql,
  id: string | null,
  status: "processed" | "failed",
  error: string | null,
): Promise<void> {
  if (!id) return;
  try {
    await sql`
      UPDATE webhook_ingestion_log
         SET status = ${status},
             processing_error = ${error},
             processed_at = NOW()
       WHERE id = ${id}
    `;
  } catch (err: unknown) {
    console.warn(
      "[lead_claim] refund gate close failed (non-fatal):",
      (err as Error)?.message ?? err,
    );
  }
}

export interface LeadRefundOutcome {
  /** A Stripe refund object exists. Only now may a row say "refunded". */
  refunded: boolean;
  /** Another delivery owns this refund, or it is already done. Do not retry. */
  alreadyHandled: boolean;
  refundId: string | null;
  error: string | null;
}

/**
 * 🚨 STRIPE FIRST. The caller writes `refunded` only when `refunded === true`.
 */
async function refundLeadPayment(
  sql: Sql,
  paymentIntentId: string | null,
  context: {
    opportunityId: string;
    contractorId: string;
    assignmentId: string | null;
    reason: string;
    amount: number | null;
  },
): Promise<LeadRefundOutcome> {
  if (!paymentIntentId) {
    // No captured payment, so there is nothing to give back. Saying
    // "refunded" here would be the same lie in a different costume.
    return {
      refunded: false,
      alreadyHandled: false,
      refundId: null,
      error: "no_payment_intent",
    };
  }

  const key = leadRefundGateKey(paymentIntentId);
  const gate = await acquireRefundGate(sql, key, context.opportunityId);
  if (gate.state === "held_elsewhere") {
    return {
      refunded: false,
      alreadyHandled: true,
      refundId: null,
      error: null,
    };
  }

  try {
    const refund = await getStripe().refunds.create(
      { payment_intent: paymentIntentId },
      { idempotencyKey: key },
    );
    await closeRefundGate(sql, gate.id, "processed", null);
    return {
      refunded: true,
      alreadyHandled: false,
      refundId: (refund as { id?: string })?.id ?? null,
      error: null,
    };
  } catch (err: unknown) {
    const message = (err as Error)?.message ?? String(err);
    await closeRefundGate(sql, gate.id, "failed", message);
    // 🚨 ALERT. A server log is not a record: nobody greps for money. The
    // event row is queryable, flagged is_error, and carries the amount owed.
    console.error(
      `[lead_claim] 🚨 REFUND FAILED — funds are still held for payment_intent ${paymentIntentId} (${context.reason}): ${message}`,
    );
    await logNetworkEvent({
      event_type: "assignment.claim_refund_failed",
      event_category: "assignment",
      opportunity_id: context.opportunityId,
      assignment_id: context.assignmentId ?? undefined,
      contractor_id: context.contractorId,
      data: {
        source: "lead_checkout_v1",
        reason: context.reason,
        payment_intent_id: paymentIntentId,
        amount_owed: context.amount,
        stripe_error: message,
      },
      triggered_by: "system",
      is_error: true,
      error_code: "refund_failed",
      error_message: message,
    });
    return {
      refunded: false,
      alreadyHandled: false,
      refundId: null,
      error: message,
    };
  }
}

/**
 * Write the truth about a payment we could not keep, onto an existing row.
 *
 * `refunded` is written ONLY against a Stripe refund object. Anything else
 * writes `refund_pending` and leaves refund_amount / refund_at NULL — the
 * amount owed is already durable in `claim_amount`, so nothing is lost by
 * refusing to fill in a refund that did not happen.
 *
 * The pending write is guarded so it can never overwrite a confirmed refund
 * that a concurrent actor recorded first.
 */
async function recordRefundOutcomeOnRow(
  sql: Sql,
  assignmentId: string,
  amount: number | null,
  reason: string,
  outcome: LeadRefundOutcome,
): Promise<void> {
  if (outcome.refunded) {
    await sql`
      UPDATE opportunity_assignments
         SET status = 'refunded', payment_status = 'refunded',
             refund_amount = ${amount}, refund_at = NOW(),
             refund_reason = ${reason}, updated_at = NOW()
       WHERE id = ${assignmentId}
    `;
    return;
  }
  const pendingReason = outcome.alreadyHandled
    ? `${reason}:refund_in_flight_elsewhere`
    : `${reason}:refund_failed:${outcome.error ?? "unknown"}`;
  await sql`
    UPDATE opportunity_assignments
       SET status = ${REFUND_PENDING_STATUS},
           payment_status = ${REFUND_PENDING_STATUS},
           refund_amount = NULL, refund_at = NULL,
           refund_reason = ${pendingReason}, updated_at = NOW()
     WHERE id = ${assignmentId}
       AND payment_status IS DISTINCT FROM 'refunded'
  `;
}

// ════════════════════════════════════════════════════════════════════════════
// The outcome the return page reads
// ════════════════════════════════════════════════════════════════════════════

export type LeadClaimOutcomeState =
  /** The webhook has not landed yet, or the row is not terminal. Keep polling. */
  | "processing"
  /** The contractor holds the lead. The address is genuinely in My Claims. */
  | "unlocked"
  /** Lost the race; money confirmed back on the card. */
  | "refunded_lead_taken"
  /** Lost the race; the refund has NOT completed. Say so, do not claim it did. */
  | "refund_pending"
  /** Not this contractor's session, or no such session. */
  | "not_found";

export interface LeadClaimOutcome {
  state: LeadClaimOutcomeState;
  opportunityId: string | null;
  assignmentId: string | null;
  /** What the contractor paid. */
  amount: number | null;
  /** What Stripe confirmed back — null unless state is refunded_lead_taken. */
  refundedAmount: number | null;
  reason: string | null;
}

const UNRESOLVED: LeadClaimOutcome = {
  state: "processing",
  opportunityId: null,
  assignmentId: null,
  amount: null,
  refundedAmount: null,
  reason: null,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 🚨 READ THE ASSIGNMENT, DO NOT ASSUME THE OUTCOME.
 *
 * Resolves a Stripe Checkout session id to the CURRENT state of the assignment
 * that payment produced. Never cached and never snapshotted, so it cannot go
 * stale behind a concurrent refund: whatever the row says at request time is
 * what the contractor is told.
 *
 * Authorization is part of the resolution — a session belonging to another
 * contractor resolves to `not_found`, never to that contractor's outcome.
 */
export async function readLeadCheckoutOutcome(params: {
  checkoutSessionId: string;
  contractorId: string;
}): Promise<LeadClaimOutcome> {
  const { checkoutSessionId, contractorId } = params;
  if (!checkoutSessionId) return { ...UNRESOLVED, state: "not_found" };

  const sql = await getDbReady();

  const idx = await sql`
    SELECT parsed_payload
      FROM webhook_ingestion_log
     WHERE idempotency_key = ${leadOutcomeIndexKey(checkoutSessionId)}
     LIMIT 1
  `;
  // Stripe redirects the browser before it delivers the webhook, so an absent
  // index row is the NORMAL first state, not an error.
  if (!idx.length) return UNRESOLVED;

  const payload = asRecord((idx[0] as Record<string, unknown>).parsed_payload);
  const opportunityId = payload.opportunity_id ? String(payload.opportunity_id) : null;
  const ownerId = payload.contractor_id ? String(payload.contractor_id) : null;
  const paymentIntentId = payload.payment_intent_id
    ? String(payload.payment_intent_id)
    : null;

  if (!opportunityId || !ownerId || ownerId !== contractorId) {
    return { ...UNRESOLVED, state: "not_found" };
  }

  const rows = await sql`
    SELECT id, status, payment_status, claim_amount, refund_amount, refund_reason
      FROM opportunity_assignments
     WHERE opportunity_id = ${opportunityId}
       AND contractor_id = ${contractorId}
       AND payment_intent_id IS NOT DISTINCT FROM ${paymentIntentId}
     ORDER BY updated_at DESC
     LIMIT 1
  `;
  if (!rows.length) return { ...UNRESOLVED, opportunityId };

  const row = rows[0] as Record<string, unknown>;
  const status = String(row.status ?? "");
  const base: LeadClaimOutcome = {
    state: "processing",
    opportunityId,
    assignmentId: row.id ? String(row.id) : null,
    amount: toNumberOrNull(row.claim_amount),
    refundedAmount: null,
    reason: row.refund_reason ? String(row.refund_reason) : null,
  };

  if ((ACTIVE_CLAIM_STATUSES as readonly string[]).includes(status)) {
    return { ...base, state: "unlocked", reason: null };
  }
  if (status === "refunded") {
    return {
      ...base,
      state: "refunded_lead_taken",
      refundedAmount: toNumberOrNull(row.refund_amount),
    };
  }
  if (status === REFUND_PENDING_STATUS) {
    return { ...base, state: "refund_pending" };
  }
  return base;
}

/**
 * Finalize a paid lead claim. Called from the Stripe webhook once
 * `checkout.session.completed` arrives for a session whose metadata.kind is
 * "lead_claim". Mirrors the exclusive-claim logic of the claim route, but
 * stamps the Stripe payment ids — and AUTO-REFUNDS if the lead was taken in
 * the meantime (a contractor never pays for a lead they don't receive).
 *
 * Idempotent in BOTH directions: a re-delivery of a winning payment is a
 * no-op, and a re-delivery of an already-refunded payment is also a no-op. The
 * second half is the one that was missing, and it was the expensive half.
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
  const checkoutSessionId = session.id ?? null;

  const sql = await getDbReady();

  // Make the outcome addressable before anything can go wrong, so even the
  // refund paths are resolvable from the return page.
  await indexCheckoutOutcome(sql, {
    checkoutSessionId,
    opportunityId,
    contractorId,
    paymentIntentId,
  });

  // ── Idempotency — already RESOLVED for this payment, either way? no-op. ──
  // IS NOT DISTINCT FROM so a null payment_intent_id (rare — asking prices are
  // always > 0) still matches a prior null-PI assignment instead of the equality
  // silently never matching and re-running the claim logic on re-delivery.
  //
  // 🚨 This must consider the REFUNDED outcomes too. When it only listed the
  // active statuses, a re-delivery of a refunded payment fell through, inserted
  // a SECOND assignment row (status 'refunded' is outside migration 072's
  // partial unique index, so nothing blocked it) and asked Stripe for a second
  // refund. A different payment by the same contractor for the same lead is
  // still handled correctly, because the lookup keys on the payment intent.
  const already = await sql`
    SELECT id, status FROM opportunity_assignments
     WHERE opportunity_id = ${opportunityId}
       AND contractor_id = ${contractorId}
       AND payment_intent_id IS NOT DISTINCT FROM ${paymentIntentId}
     ORDER BY updated_at DESC
     LIMIT 1
  `;
  if (already.length) {
    const priorStatus = String(already[0].status);
    if ((ACTIVE_CLAIM_STATUSES as readonly string[]).includes(priorStatus)) {
      return {
        success: true,
        message: `lead_claim already finalized: ${opportunityId}`,
      };
    }
    if (priorStatus === "refunded" || priorStatus === REFUND_PENDING_STATUS) {
      return {
        success: true,
        message: `lead_claim already resolved as ${priorStatus}, no further action: ${opportunityId}`,
      };
    }
  }

  const oppRows = await sql`
    SELECT claim_mode, max_claims, claim_count, status,
           COALESCE(marketplace_status, 'live') AS marketplace_status
      FROM network_opportunities
     WHERE id = ${opportunityId}
     LIMIT 1
  `;
  if (!oppRows.length) {
    const outcome = await refundLeadPayment(sql, paymentIntentId, {
      opportunityId,
      contractorId,
      assignmentId: null,
      reason: "opportunity_missing",
      amount,
    });
    return {
      success: false,
      message: `lead_claim: opportunity missing, refund ${outcome.refunded ? "issued" : "NOT confirmed"} ${opportunityId}`,
    };
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
    // 🚨 WHOSE CLAIM BLOCKED THIS INSERT. Migration 072's partial unique index
    // is on (opportunity_id, contractor_id) — it can only be THIS contractor's
    // own active row. Two readings are possible and they are financially
    // opposite:
    //
    //   (a) the SAME payment already claimed this lead — a concurrent or
    //       retried webhook delivery. Refunding here refunds the WINNER while
    //       he keeps the lead: SolarPro gives the lead away and the row still
    //       reads 'claimed'/'succeeded'. This is what used to happen.
    //   (b) a DIFFERENT payment by this contractor for a lead he already holds
    //       — a genuine double purchase, which must be refunded.
    //
    // The payment intent is the discriminator, so read it rather than assume.
    const mine = await sql`
      SELECT id, payment_intent_id, status FROM opportunity_assignments
       WHERE opportunity_id = ${opportunityId}
         AND contractor_id = ${contractorId}
         AND status IN ('claimed','contacted','appointment','proposal','won')
       ORDER BY updated_at DESC
       LIMIT 1
    `;
    const mineRow = mine.length ? (mine[0] as Record<string, unknown>) : null;
    const minePi = mineRow?.payment_intent_id ?? null;
    const samePayment =
      mineRow != null &&
      (minePi == null ? paymentIntentId == null : minePi === paymentIntentId);

    if (samePayment) {
      return {
        success: true,
        message: `lead_claim already finalized by a concurrent delivery: ${opportunityId}`,
      };
    }

    // A genuine second payment for a lead this contractor already holds. Give
    // it back — and leave a row for it, so the contractor's return page can
    // resolve THIS session's outcome instead of polling forever.
    const outcome = await refundLeadPayment(sql, paymentIntentId, {
      opportunityId,
      contractorId,
      assignmentId: null,
      reason: "duplicate_payment_already_claimed",
      amount,
    });
    let recordId: string | null = null;
    try {
      const recorded = await sql`
        INSERT INTO opportunity_assignments (
          opportunity_id, contractor_id, status, assignment_type,
          offered_at, claim_amount, payment_intent_id, payment_status,
          refund_amount, refund_at, refund_reason
        ) VALUES (
          ${opportunityId}, ${contractorId},
          ${outcome.refunded ? "refunded" : REFUND_PENDING_STATUS},
          'marketplace', NOW(), ${amount}, ${paymentIntentId},
          ${outcome.refunded ? "refunded" : REFUND_PENDING_STATUS},
          ${outcome.refunded ? amount : null},
          ${outcome.refunded ? new Date().toISOString() : null},
          ${outcome.refunded ? "duplicate_payment_auto_refund" : "duplicate_payment_refund_unconfirmed"}
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      recordId = recorded.length ? String((recorded[0] as Record<string, unknown>).id) : null;
    } catch (err: unknown) {
      console.error(
        "[lead_claim] could not record the refunded duplicate payment:",
        (err as Error)?.message ?? err,
      );
    }
    await logNetworkEvent({
      event_type: outcome.refunded
        ? "assignment.claim_refunded"
        : "assignment.claim_refund_failed",
      event_category: "assignment",
      opportunity_id: opportunityId,
      assignment_id: recordId ?? undefined,
      contractor_id: contractorId,
      data: {
        source: "lead_checkout_v1",
        reason: "duplicate_payment_already_claimed",
        payment_intent_id: paymentIntentId,
        amount,
        refund_confirmed: outcome.refunded,
        refund_id: outcome.refundId,
        refund_already_handled: outcome.alreadyHandled,
      },
      triggered_by: "system",
      is_error: !outcome.refunded,
    });
    return {
      success: false,
      message: `lead_claim: duplicate payment, refund ${outcome.refunded ? "issued" : "NOT confirmed"} ${opportunityId}`,
    };
  }

  const assignmentId = (updated[0] as Record<string, unknown>).id as string;

  // ── Capacity/status guard on the opportunity itself ──
  // Unchanged on purpose: this conditional UPDATE is the atomic race detector.
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
    // 🚨 STRIPE FIRST, THEN THE ROW. The old order wrote 'refunded' here and
    // then tried Stripe, so a Stripe failure left the row asserting a refund
    // that never happened.
    const outcome = await refundLeadPayment(sql, paymentIntentId, {
      opportunityId,
      contractorId,
      assignmentId,
      reason: "race_lost_auto_refund",
      amount,
    });
    await recordRefundOutcomeOnRow(
      sql,
      assignmentId,
      amount,
      "race_lost_auto_refund",
      outcome,
    );
    await logNetworkEvent({
      event_type: outcome.refunded
        ? "assignment.claim_refunded"
        : "assignment.claim_refund_failed",
      event_category: "assignment",
      opportunity_id: opportunityId,
      assignment_id: assignmentId,
      contractor_id: contractorId,
      data: {
        source: "lead_checkout_v1",
        reason: "capacity_or_status_changed",
        payment_intent_id: paymentIntentId,
        amount,
        refund_confirmed: outcome.refunded,
        refund_id: outcome.refundId,
        refund_already_handled: outcome.alreadyHandled,
        stripe_error: outcome.error,
      },
      triggered_by: "system",
      is_error: !outcome.refunded,
    });
    return {
      success: false,
      message: outcome.refunded
        ? `lead_claim: capacity lost, refunded ${opportunityId}`
        : `lead_claim: capacity lost, REFUND PENDING (funds still held) ${opportunityId}`,
    };
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
