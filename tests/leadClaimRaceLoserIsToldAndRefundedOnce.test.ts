/**
 * tests/leadClaimRaceLoserIsToldAndRefundedOnce.test.ts
 *
 * THE CONTRACTOR WHO LOSES A CLAIM RACE WAS CHARGED, REFUNDED, AND TOLD HE
 * OWNED THE LEAD — AND A RETRIED WEBHOOK REFUNDED THE WINNER.
 *
 * Two contractors complete Stripe Checkout for the same EXCLUSIVE lead seconds
 * apart. Detection of that race is correct and is deliberately left alone: the
 * capacity mutation is a conditional `UPDATE network_opportunities ... WHERE
 * claim_count = 0`, and Postgres re-evaluates that predicate after the first
 * writer commits, so exactly one contractor wins. Migration 072's partial
 * unique index on (opportunity_id, contractor_id) keeps one contractor from
 * holding two active rows. Nothing below replaces either mechanism.
 *
 * What happened AFTER detection was wrong in four ways, and each one has a
 * behavioural test here:
 *
 *   D1  REFUND ORDER. `payment_status = 'refunded'` — plus a `refund_amount`
 *       and a `refund_at` — was written BEFORE Stripe was asked for the refund,
 *       inside a try/catch that swallowed the failure into a console.error. A
 *       failed refund therefore left a row asserting the money had been
 *       returned while it was still ours. `refunds_30d` in admin health and
 *       `refunded` in the contractor performance producer both read exactly
 *       those columns, so the lie propagated into reporting.
 *
 *   D2  UNADDRESSABLE OUTCOME. success_url was `/network?purchased=<id>` and
 *       the page fired "Payment received — lead unlocked. See My Claims for the
 *       full address." from the presence of that parameter alone, consulting
 *       nothing. The refunded loser was sent to look at an empty tab.
 *
 *   D3  A RE-DELIVERY OF A REFUNDED PAYMENT REFUNDED IT AGAIN. The `already`
 *       pre-check listed only the ACTIVE statuses, so a second delivery of an
 *       already-refunded payment fell through it, INSERTed a second assignment
 *       row (status 'refunded' sits outside 072's partial index, so nothing
 *       blocked it) and asked Stripe for a second refund.
 *
 *   D4  🚨 TWO SIMULTANEOUS DELIVERIES OF THE WINNING PAYMENT REFUNDED THE
 *       WINNER. Both missed the pre-check; one lost the INSERT to 072's index
 *       and read that as "another contractor took the lead". It refunded — the
 *       buyer's own payment — while the row stayed 'claimed'/'succeeded' and
 *       the lead stayed his. SolarPro gave the lead away and the database said
 *       it had been paid for. This one was not in the original finding; it is
 *       the same detection being misread in the opposite direction.
 *
 * 🚨 THIS FILE EXECUTES REAL SQL AGAINST REAL POSTGRES. The governed migration
 * chain is applied as shipped, in numeric order, into PGlite (in-process, no
 * credential), and the REAL `finalizeLeadClaim` / REAL route handler run against
 * it through a Neon-shaped tagged-template adapter. `logNetworkEvent` is kept
 * REAL so the "alert" for an unconfirmed refund is proven to be a QUERYABLE row
 * and not just a server log nobody greps. Only Stripe is a stub, because the
 * point is to count and fail its calls.
 *
 * 🚨 ON THE CONCURRENCY MODEL. PGlite is one in-process backend, so two
 * `finalizeLeadClaim` calls under `Promise.all` interleave at STATEMENT
 * granularity rather than by row-level blocking. That is the interleaving that
 * matters here: every assertion below depends on one call observing state the
 * other committed between two of its own statements, which is exactly how the
 * production race presents. What this file does NOT prove is lock-wait
 * behaviour under two separate Neon connections; the conditional UPDATE that
 * covers that case is unchanged from what shipped.
 *
 * Everything is behavioural except the ONE assertion labelled SOURCE SCAN,
 * which covers the client toast (no DOM harness in this suite).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { stripComments } from './support/stripSource';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

process.env.NEXT_PUBLIC_BASE_URL = 'https://solarpro.test';

// ── Stripe: the ONLY stub. We count its calls and make it fail on demand. ───
const refundCreate = vi.fn();
const checkoutSessionCreate = vi.fn();
const stripeStub = {
  refunds: { create: refundCreate },
  checkout: { sessions: { create: checkoutSessionCreate } },
};
vi.mock('@/lib/stripe', () => ({
  getStripe: () => stripeStub,
  stripe: stripeStub,
}));

// ── Auth for the outcome route ──────────────────────────────────────────────
let currentUser: { id: string } | null = null;
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: () => currentUser,
}));

// ── The Neon-shaped adapter over real Postgres ──────────────────────────────
let db: PGlite;

function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return `{${value.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
  }
  return value;
}

async function sqlTag(strings: TemplateStringsArray, ...values: unknown[]) {
  let text = '';
  strings.forEach((chunk, i) => {
    text += chunk;
    if (i < values.length) text += `$${i + 1}`;
  });
  const res = await db.query(text, values.map(toParam));
  return res.rows as Array<Record<string, unknown>>;
}

vi.mock('@/lib/db-neon', () => ({
  getDbReady: async () => sqlTag,
  isValidUUID: (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: (tag: string, err: unknown) => {
    // Surface it — a swallowed 500 is how this campaign loses an afternoon.
    console.error(`[test] ${tag}`, err);
    return new Response(
      JSON.stringify({ error: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  },
}));

/** Direct, unparameterized access for fixture setup and for reading rows back. */
const q = async (text: string) => (await db.query(text)).rows as any[];

const CONTRACTOR_X = '22222222-2222-2222-2222-222222222222';
const CONTRACTOR_Y = '33333333-3333-3333-3333-333333333333';

beforeAll(async () => {
  db = new PGlite();
  // `users` is stubbed, but with the two columns createLeadCheckoutSession
  // actually SELECTs — a fixture missing a column accuses the product of the
  // fixture's own fault.
  await db.exec('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT, name TEXT);');
  await db.exec('CREATE TABLE IF NOT EXISTS opportunities (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');
  await db.exec('CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid());');

  // 🚨 THE GOVERNED CHAIN, AS SHIPPED, IN NUMERIC ORDER — not a hand copy.
  // 051 creates opportunity_assignments, 053 the event log the alert lands in,
  // 057 the webhook_ingestion_log whose UNIQUE(idempotency_key) is the refund
  // gate, 067 re-asserts 051 for databases that missed it, and 072 replaces
  // 051's opportunity-only unique index with the (opportunity_id, contractor_id)
  // one that makes the duplicate-delivery misread possible at all.
  for (const m of [
    '044_contractor_profiles.sql',
    '047_network_opportunities.sql',
    '048_opportunity_sources.sql',
    '049_opportunity_screening_queue.sql',
    '050_opportunity_intelligence.sql',
    '051_opportunity_assignments.sql',
    '053_network_events.sql',
    '054_alter_network_opportunities_intake_columns.sql',
    '055_intake_events.sql',
    '057_webhook_ingestion_log.sql',
    '062_network_opportunities_canonical_column_harmonization.sql',
    '063_opportunity_screening_queue_repair.sql',
    '064_opportunity_intelligence_repair.sql',
    '065_network_events_repair.sql',
    '066_intake_events_repair.sql',
    '067_opportunity_assignments_repair.sql',
    '069_opportunity_sources_repair.sql',
    '070_opportunity_intelligence_enrichment.sql',
    '072_marketplace_inventory_claim_v1.sql',
    '088_network_opportunities_county_fips.sql',
    '089_intake_idempotency_key.sql',
  ]) {
    await db.exec(read('lib', 'migrations', m));
  }

  await q(`INSERT INTO users (id, email, name) VALUES
             ('${CONTRACTOR_X}', 'x@contractor.test', 'Contractor X'),
             ('${CONTRACTOR_Y}', 'y@contractor.test', 'Contractor Y')
           ON CONFLICT DO NOTHING`);
}, 240_000);

afterAll(async () => { await db?.close(); });

beforeEach(() => {
  refundCreate.mockReset().mockResolvedValue({ id: 're_test_ok' });
  checkoutSessionCreate.mockReset().mockResolvedValue({
    id: 'cs_test_created',
    url: 'https://checkout.stripe.test/cs_test_created',
  });
  currentUser = null;
});

/** A live, exclusive, priced marketplace lead — ready to be claimed once. */
async function insertLiveExclusiveLead(tag: string): Promise<string> {
  const rows = await q(`
    INSERT INTO network_opportunities (
      source_type, status, marketplace_status,
      claim_mode, max_claims, claim_count,
      asking_price, opportunity_grade,
      homeowner_name, homeowner_email, homeowner_phone,
      address, location_city, location_state, location_zip,
      monthly_bill_amount, utility_provider, estimated_system_size_kw
    ) VALUES (
      'google_ads', 'live', 'live',
      'exclusive', 1, 0,
      45.00, 'B',
      'Dana ${tag}', 'dana.${tag}@example.test', '+1312555${tag}',
      '${tag} West Madison Drive', 'Chicago', 'IL', '60601',
      265.00, 'ComEd', 9.4
    ) RETURNING id
  `);
  return rows[0].id as string;
}

/** The shape the Stripe webhook hands to finalizeLeadClaim. */
function checkoutSession(args: {
  sessionId: string;
  paymentIntentId: string;
  opportunityId: string;
  contractorId: string;
  amountTotal?: number;
}): any {
  return {
    id: args.sessionId,
    payment_intent: args.paymentIntentId,
    amount_total: args.amountTotal ?? 4500,
    payment_status: 'paid',
    metadata: {
      kind: 'lead_claim',
      opportunityId: args.opportunityId,
      contractorId: args.contractorId,
    },
  };
}

const outcomeReq = (sessionId: string) =>
  new Request(
    `https://solarpro.test/api/network/lead-outcome?session=${encodeURIComponent(sessionId)}`,
    { headers: { cookie: 'solarpro_session=test' } },
  ) as any;

async function assignmentsFor(oppId: string, contractorId: string) {
  return q(`
    SELECT id, status, payment_status, payment_intent_id,
           claim_amount, refund_amount, refund_at, refund_reason
      FROM opportunity_assignments
     WHERE opportunity_id = '${oppId}' AND contractor_id = '${contractorId}'
     ORDER BY created_at
  `);
}

// ════════════════════════════════════════════════════════════════════════════
// D2 — the outcome is ADDRESSABLE, and the loser is told the truth
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 D2 — the race loser can find out what happened to his money', () => {
  it('two simultaneous checkouts: winner reads "unlocked", loser reads "refunded", from the SAME endpoint', async () => {
    const oppId = await insertLiveExclusiveLead('2001');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');
    const { GET } = await import('@/app/api/network/lead-outcome/route');

    // 🚨 TWO CONCURRENT FINALIZES AGAINST ONE EXCLUSIVE LEAD. This is the race.
    const [resX, resY] = await Promise.all([
      finalizeLeadClaim(checkoutSession({
        sessionId: 'cs_x_2001', paymentIntentId: 'pi_x_2001',
        opportunityId: oppId, contractorId: CONTRACTOR_X,
      })),
      finalizeLeadClaim(checkoutSession({
        sessionId: 'cs_y_2001', paymentIntentId: 'pi_y_2001',
        opportunityId: oppId, contractorId: CONTRACTOR_Y,
      })),
    ]);

    // Exactly one winner, and the capacity mutation stayed atomic.
    const winners = [resX, resY].filter((r) => r.success);
    expect(winners, 'the race produced more than one winner').toHaveLength(1);
    const [opp] = await q(`SELECT claim_count, status FROM network_opportunities WHERE id = '${oppId}'`);
    expect(Number(opp.claim_count)).toBe(1);
    expect(opp.status).toBe('claimed');

    const xRows = await assignmentsFor(oppId, CONTRACTOR_X);
    const yRows = await assignmentsFor(oppId, CONTRACTOR_Y);
    expect(xRows).toHaveLength(1);
    expect(yRows).toHaveLength(1);
    const claimed = [...xRows, ...yRows].filter((r) => r.status === 'claimed');
    const refunded = [...xRows, ...yRows].filter((r) => r.status === 'refunded');
    expect(claimed, 'two contractors both hold an exclusive lead').toHaveLength(1);
    expect(refunded, 'the loser was not refunded').toHaveLength(1);

    // 🚨 ONE refund, for the LOSER's payment intent only.
    expect(refundCreate).toHaveBeenCalledTimes(1);
    const loserPi = refunded[0].payment_intent_id as string;
    expect(refundCreate.mock.calls[0][0]).toEqual({ payment_intent: loserPi });

    // The Stripe request carries the same idempotency key the gate uses, so the
    // money cannot move twice even if the gate table is unreachable.
    expect(
      refundCreate.mock.calls[0][1],
      'the refund was issued without a Stripe idempotency key',
    ).toEqual({ idempotencyKey: `lead_claim:refund:${loserPi}` });

    // ── And now the part the contractor actually experiences ──
    const winnerId = claimed[0].contractor_id ?? (xRows[0].status === 'claimed' ? CONTRACTOR_X : CONTRACTOR_Y);
    const winnerSession = winnerId === CONTRACTOR_X ? 'cs_x_2001' : 'cs_y_2001';
    const loserId = winnerId === CONTRACTOR_X ? CONTRACTOR_Y : CONTRACTOR_X;
    const loserSession = winnerId === CONTRACTOR_X ? 'cs_y_2001' : 'cs_x_2001';

    currentUser = { id: winnerId };
    const winnerRes = await GET(outcomeReq(winnerSession));
    expect(winnerRes.status).toBe(200);
    const winnerBody = await winnerRes.json();
    expect(winnerBody.outcome.state).toBe('unlocked');
    expect(winnerBody.outcome.opportunityId).toBe(oppId);

    currentUser = { id: loserId };
    const loserRes = await GET(outcomeReq(loserSession));
    expect(loserRes.status).toBe(200);
    const loserBody = await loserRes.json();
    // 🚨 THE WHOLE POINT. He must not be told the lead is unlocked.
    expect(
      loserBody.outcome.state,
      'the refunded loser is still being told he owns the lead',
    ).toBe('refunded_lead_taken');
    expect(Number(loserBody.outcome.refundedAmount)).toBe(45);
  });

  it('a checkout session belonging to another contractor resolves to not_found, never to their outcome', async () => {
    const oppId = await insertLiveExclusiveLead('2002');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');
    const { GET } = await import('@/app/api/network/lead-outcome/route');

    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_2002', paymentIntentId: 'pi_x_2002',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));

    currentUser = { id: CONTRACTOR_Y };
    const res = await GET(outcomeReq('cs_x_2002'));
    const body = await res.json();
    expect(body.outcome.state).toBe('not_found');
    expect(body.outcome.opportunityId).toBeNull();
  });

  it('before the webhook lands, the endpoint says processing — it does not guess', async () => {
    const { GET } = await import('@/app/api/network/lead-outcome/route');
    currentUser = { id: CONTRACTOR_X };
    const res = await GET(outcomeReq('cs_never_delivered'));
    const body = await res.json();
    expect(body.outcome.state).toBe('processing');
  });

  it('the checkout success_url carries the session id instead of asserting a purchase', async () => {
    const oppId = await insertLiveExclusiveLead('2003');
    const { createLeadCheckoutSession } = await import('@/lib/network/leadPurchase');

    const result = await createLeadCheckoutSession({
      opportunityId: oppId,
      contractorId: CONTRACTOR_X,
    });
    expect(result.url).toBeTruthy();
    const successUrl = String(checkoutSessionCreate.mock.calls[0][0].success_url);
    expect(
      successUrl,
      'the return page cannot address the outcome without the session id',
    ).toContain('{CHECKOUT_SESSION_ID}');
    expect(
      successUrl,
      'the old parameter is what the unconditional green toast fired on',
    ).not.toContain('purchased=');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D1 — a row must never claim money was returned when it was not
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 D1 — a failed Stripe refund cannot be written as a completed one', () => {
  it('Stripe refuses the refund: the row says refund_pending with NO amount and NO timestamp', async () => {
    const oppId = await insertLiveExclusiveLead('1001');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    // Winner first, so the second contractor is the loser and must be refunded.
    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_1001', paymentIntentId: 'pi_x_1001',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));

    refundCreate.mockRejectedValueOnce(new Error('card_declined_refund_unavailable'));

    const loser = await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_y_1001', paymentIntentId: 'pi_y_1001',
      opportunityId: oppId, contractorId: CONTRACTOR_Y,
    }));
    expect(loser.success).toBe(false);

    const [row] = await assignmentsFor(oppId, CONTRACTOR_Y);
    // 🚨 THE MONEY IS STILL OURS. The row is not allowed to say otherwise.
    expect(
      row.payment_status,
      'the row claims the money was refunded when Stripe refused',
    ).not.toBe('refunded');
    expect(row.status).not.toBe('refunded');
    expect(row.payment_status).toBe('refund_pending');
    expect(
      row.refund_at,
      'a refund timestamp was stamped for a refund that never happened',
    ).toBeNull();
    expect(
      row.refund_amount,
      'a refund amount was stamped for a refund that never happened',
    ).toBeNull();
    // The amount owed is not lost — it is what he paid.
    expect(Number(row.claim_amount)).toBe(45);
    expect(String(row.refund_reason)).toContain('refund_failed');

    // The alert is a QUERYABLE row, not only a console.error.
    const alerts = await q(`
      SELECT event_type, is_error, data FROM network_events
       WHERE opportunity_id = '${oppId}' AND event_type = 'assignment.claim_refund_failed'
    `);
    expect(alerts.length, 'an unconfirmed refund raised no queryable alert').toBeGreaterThan(0);
    expect(alerts[0].is_error).toBe(true);

    // And the contractor is told the refund has NOT completed.
    const { GET } = await import('@/app/api/network/lead-outcome/route');
    currentUser = { id: CONTRACTOR_Y };
    const body = await (await GET(outcomeReq('cs_y_1001'))).json();
    expect(body.outcome.state).toBe('refund_pending');
    expect(body.outcome.refundedAmount).toBeNull();
  });

  it('reporting does not count an unconfirmed refund as a refund', async () => {
    // `refunds_30d` in admin health is COUNT(*) FILTER (WHERE status='refunded'
    // AND refund_at > ...), and the performance producer counts
    // `!!refund_at || status === 'refunded'`. Both must see zero here.
    const rows = await q(`
      SELECT COUNT(*) AS n FROM opportunity_assignments
       WHERE status = 'refunded' AND refund_at IS NOT NULL
         AND payment_intent_id = 'pi_y_1001'
    `);
    expect(Number(rows[0].n)).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D3 — a re-delivered webhook must not refund twice or duplicate the row
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 D3 — re-delivery of an already-refunded payment is a no-op', () => {
  it('the same losing session delivered twice refunds ONCE and leaves ONE row', async () => {
    const oppId = await insertLiveExclusiveLead('3001');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_3001', paymentIntentId: 'pi_x_3001',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));

    const loserSession = checkoutSession({
      sessionId: 'cs_y_3001', paymentIntentId: 'pi_y_3001',
      opportunityId: oppId, contractorId: CONTRACTOR_Y,
    });
    await finalizeLeadClaim(loserSession);
    expect(refundCreate).toHaveBeenCalledTimes(1);

    // Stripe re-delivers checkout.session.completed. Nothing may move.
    await finalizeLeadClaim(loserSession);
    await finalizeLeadClaim(loserSession);

    expect(
      refundCreate,
      'a re-delivered webhook refunded the same payment again',
    ).toHaveBeenCalledTimes(1);

    const yRows = await assignmentsFor(oppId, CONTRACTOR_Y);
    expect(
      yRows,
      'a re-delivered webhook created a second assignment row',
    ).toHaveLength(1);
    expect(yRows[0].status).toBe('refunded');
    expect(Number(yRows[0].refund_amount)).toBe(45);

    const [opp] = await q(`SELECT claim_count FROM network_opportunities WHERE id = '${oppId}'`);
    expect(Number(opp.claim_count)).toBe(1);
  });

  it('a genuinely SECOND payment by the same contractor is still refunded, and is recorded', async () => {
    // The discriminator must be the payment intent, not "does this contractor
    // already hold the lead" — otherwise a real double purchase is kept.
    const oppId = await insertLiveExclusiveLead('3002');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_3002a', paymentIntentId: 'pi_x_3002a',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));
    expect(refundCreate).toHaveBeenCalledTimes(0);

    const second = await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_3002b', paymentIntentId: 'pi_x_3002b',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));
    expect(second.success).toBe(false);
    expect(refundCreate).toHaveBeenCalledTimes(1);
    expect(refundCreate.mock.calls[0][0]).toEqual({ payment_intent: 'pi_x_3002b' });

    // The second payment has its own row, so the second session is resolvable.
    const rows = await assignmentsFor(oppId, CONTRACTOR_X);
    expect(rows).toHaveLength(2);
    const dup = rows.find((r) => r.payment_intent_id === 'pi_x_3002b');
    expect(dup?.status).toBe('refunded');

    const { GET } = await import('@/app/api/network/lead-outcome/route');
    currentUser = { id: CONTRACTOR_X };
    expect((await (await GET(outcomeReq('cs_x_3002a'))).json()).outcome.state).toBe('unlocked');
    expect((await (await GET(outcomeReq('cs_x_3002b'))).json()).outcome.state)
      .toBe('refunded_lead_taken');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// D4 — two simultaneous deliveries of the WINNING payment
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 D4 — a concurrent duplicate delivery must not refund the winner', () => {
  it('the winner keeps his lead AND his money; no refund is issued at all', async () => {
    const oppId = await insertLiveExclusiveLead('4001');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    const session = checkoutSession({
      sessionId: 'cs_x_4001', paymentIntentId: 'pi_x_4001',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    });

    // 🚨 THE SAME EVENT, TWICE, AT ONCE. One of the two loses the INSERT to
    // migration 072's partial unique index. It used to read that as "another
    // contractor took the lead" and refund the buyer.
    const results = await Promise.all([
      finalizeLeadClaim(session),
      finalizeLeadClaim({ ...session }),
    ]);

    expect(
      refundCreate,
      'a duplicate webhook delivery refunded the contractor who WON the lead',
    ).toHaveBeenCalledTimes(0);

    const rows = await assignmentsFor(oppId, CONTRACTOR_X);
    expect(rows, 'a duplicate delivery created a second assignment row').toHaveLength(1);
    expect(rows[0].status).toBe('claimed');
    expect(rows[0].payment_status).toBe('succeeded');
    expect(rows[0].refund_at, 'the winner has a refund stamped against him').toBeNull();

    const [opp] = await q(`SELECT claim_count, status FROM network_opportunities WHERE id = '${oppId}'`);
    expect(Number(opp.claim_count)).toBe(1);
    expect(opp.status).toBe('claimed');

    // Neither delivery may report an outcome that contradicts the row.
    expect(results.every((r) => r.success), `finalize reported: ${results.map((r) => r.message).join(' | ')}`).toBe(true);

    const { GET } = await import('@/app/api/network/lead-outcome/route');
    currentUser = { id: CONTRACTOR_X };
    expect((await (await GET(outcomeReq('cs_x_4001'))).json()).outcome.state).toBe('unlocked');
  });

  it('a FAILED refund parks the gate so once-only does not become never', async () => {
    // Once-only must not lock a genuine retry out: if the gate stayed closed
    // after a Stripe failure, the contractor's money would be stranded behind
    // our own idempotency key, which is a worse state than the defect.
    const oppId = await insertLiveExclusiveLead('4002');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_4002', paymentIntentId: 'pi_x_4002',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));

    refundCreate.mockRejectedValueOnce(new Error('stripe_502'));
    const loserSession = checkoutSession({
      sessionId: 'cs_y_4002', paymentIntentId: 'pi_y_4002',
      opportunityId: oppId, contractorId: CONTRACTOR_Y,
    });
    await finalizeLeadClaim(loserSession);

    const [row] = await assignmentsFor(oppId, CONTRACTOR_Y);
    expect(row.payment_status).toBe('refund_pending');

    // The gate row records the failure — it is not left claimed-and-succeeded,
    // which is what would strand the money. The Stripe error is on the row.
    const gate = await q(`
      SELECT status, processing_error FROM webhook_ingestion_log
       WHERE idempotency_key = 'lead_claim:refund:pi_y_4002'
    `);
    expect(gate, 'the refund left no audit row at all').toHaveLength(1);
    expect(gate[0].status).toBe('failed');
    expect(String(gate[0].processing_error)).toContain('stripe_502');

    // And a re-delivery of that session stays a no-op rather than creating a
    // second row or a second charge attempt against a resolved payment.
    const before = refundCreate.mock.calls.length;
    await finalizeLeadClaim(loserSession);
    expect(refundCreate.mock.calls.length - before).toBe(0);
    expect(await assignmentsFor(oppId, CONTRACTOR_Y)).toHaveLength(1);
  });

  it('the gate refuses a SECOND Stripe refund for a payment already refunded', async () => {
    // Reached through the product, not through hand-written SQL: an 'offered'
    // assignment row is a state the product really writes, and a webhook
    // delivery re-claims it — so finalize genuinely re-enters the refund branch
    // for a payment intent it has already refunded once. Before the gate, that
    // second entry sent Stripe a second refund and wrote 'refunded' again.
    const oppId = await insertLiveExclusiveLead('4003');
    const { finalizeLeadClaim } = await import('@/lib/network/leadPurchase');

    await finalizeLeadClaim(checkoutSession({
      sessionId: 'cs_x_4003', paymentIntentId: 'pi_x_4003',
      opportunityId: oppId, contractorId: CONTRACTOR_X,
    }));
    const loserSession = checkoutSession({
      sessionId: 'cs_y_4003', paymentIntentId: 'pi_y_4003',
      opportunityId: oppId, contractorId: CONTRACTOR_Y,
    });
    await finalizeLeadClaim(loserSession);
    expect(refundCreate).toHaveBeenCalledTimes(1);

    // 🚨 ONE layouts-row-has-many-writers situation: another writer puts the
    // refunded row back into an offer state. The money has already been
    // returned; a second refund would be a real second loss.
    await q(`
      UPDATE opportunity_assignments
         SET status = 'offered', payment_status = NULL,
             refund_amount = NULL, refund_at = NULL, refund_reason = NULL
       WHERE opportunity_id = '${oppId}' AND contractor_id = '${CONTRACTOR_Y}'
    `);

    await finalizeLeadClaim(loserSession);

    expect(
      refundCreate,
      'the same payment intent was refunded a second time',
    ).toHaveBeenCalledTimes(1);

    const [row] = await assignmentsFor(oppId, CONTRACTOR_Y);
    // We did not confirm a refund on THIS pass, so the row must not assert one.
    expect(row.payment_status).toBe('refund_pending');
    expect(row.refund_at).toBeNull();
    expect(row.refund_amount).toBeNull();
    expect(String(row.refund_reason)).toContain('refund_in_flight_elsewhere');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The client half of D2
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 D2 (client) — the green toast no longer fires without an outcome', () => {
  it('SOURCE SCAN: /network does not announce an unlocked lead from a query parameter', () => {
    // SOURCE SCAN, and labelled as one: there is no DOM harness in this suite,
    // so this cannot prove the poll renders. What it CAN prove is that the
    // unconditional claim is gone and that the outcome endpoint is consulted.
    //
    // 🚨 COMMENTS ARE STRIPPED, STRINGS ARE NOT. `stripComments` is the right
    // stripper for a LITERAL-VALUE scan: the old toast text is the thing being
    // searched for, so blanking string bodies would make this vacuous. And
    // without stripping comments at all it fails on the repair's OWN comment,
    // which quotes the defect it removed.
    const page = stripComments(read('app', 'network', 'page.tsx'));
    expect(
      page,
      'the unconditional "lead unlocked" toast is still in the return handler',
    ).not.toContain('Payment received — lead unlocked');
    expect(page).not.toContain('params.get("purchased")');
    expect(page).toContain('/api/network/lead-outcome?session=');
    expect(page).toContain('refunded_lead_taken');
    expect(page).toContain('refund_pending');
  });
});
