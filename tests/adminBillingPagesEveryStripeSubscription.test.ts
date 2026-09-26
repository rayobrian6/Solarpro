/**
 * tests/adminBillingPagesEveryStripeSubscription.test.ts
 *
 * MRR WAS ARITHMETIC OVER THE FIRST STRIPE PAGE.
 *
 * /api/admin/billing issued ONE `stripe.subscriptions.list({ status: "all",
 * limit: 100 })` and summed every tile over `res.data`. Stripe's maximum page
 * size IS 100, so past 100 subscription objects the endpoint silently reported:
 *
 *   - an MRR that understated real revenue,
 *   - "Extra seats sold" undercounting,
 *   - "Total subs" frozen at exactly 100, never moving again.
 *
 * No banner, no partial-data flag, no error — a confident dollar figure computed
 * over an arbitrary subset. And `status: "all"` means CANCELLED subscriptions
 * consume page slots, so the undercount arrives well before 100 PAYING customers
 * exist: an account with 80 churned and 40 active subs already loses 20 of them.
 *
 * WHAT THIS SUITE IS FOR. It is behavioural: the real GET handler runs against a
 * Stripe stub that enforces Stripe's own paging contract (`limit` <= 100,
 * `has_more`, `starting_after` cursor). The assertions are on the MONEY — if the
 * handler stops early, the MRR is wrong and the test says so.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

const listCalls: Array<Record<string, unknown>> = [];

/** Every subscription the stub "account" holds. Built per test. */
let account: StubSub[] = [];

interface StubSub {
  id: string;
  status: string;
  items: { data: Array<{ price: { id: string; unit_amount: number }; quantity: number }> };
  customer: { email: string; name: string };
  created: number;
}

/**
 * A Stripe `subscriptions.list` that obeys the real contract: it refuses a
 * `limit` above 100, slices from the `starting_after` cursor, and reports
 * `has_more`. A stub that returned everything in one page would make this suite
 * pass against the defect — the cap is the thing under test, so the stub must
 * impose it.
 */
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    subscriptions: {
      list: async (params: Record<string, unknown>) => {
        listCalls.push({ ...params });
        const limit = Number(params.limit ?? 10);
        if (limit > 100) throw new Error('Stripe: limit must be <= 100');
        const after = params.starting_after as string | undefined;
        const start = after ? account.findIndex((s) => s.id === after) + 1 : 0;
        if (after && start === 0) throw new Error(`Stripe: unknown starting_after ${after}`);
        const slice = account.slice(start, start + limit);
        return { data: slice, has_more: start + slice.length < account.length };
      },
    },
  }),
}));

vi.mock('@/lib/adminAuth', () => ({
  requireAdminApi: async () => ({ id: 'admin-1', role: 'super_admin' }),
}));

import { GET } from '@/app/api/admin/billing/route';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PLAN_PRICE = 'price_professional';
const SEAT_PRICE = 'price_extra_seat';

function sub(i: number, status: string, monthly: number, seats = 0): StubSub {
  const items = [{ price: { id: PLAN_PRICE, unit_amount: monthly * 100 }, quantity: 1 }];
  if (seats > 0) items.push({ price: { id: SEAT_PRICE, unit_amount: 1500 }, quantity: seats });
  return {
    id: `sub_${String(i).padStart(4, '0')}`,
    status,
    items: { data: items },
    customer: { email: `c${i}@example.com`, name: `Customer ${i}` },
    created: 1700000000 + i,
  };
}

async function callBilling() {
  listCalls.length = 0;
  const res = await GET(new Request('http://localhost/api/admin/billing') as never);
  const json = await res.json();
  expect(json.success, JSON.stringify(json)).toBe(true);
  return json;
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_stub';
  process.env.STRIPE_PRICE_PROFESSIONAL = PLAN_PRICE;
  process.env.STRIPE_PRICE_EXTRA_SEAT = SEAT_PRICE;
});

// ── The cap ─────────────────────────────────────────────────────────────────

describe('every subscription is counted, not just the first page', () => {
  it('250 active subs at $99: MRR is $24,750 and Total subs is 250', async () => {
    account = Array.from({ length: 250 }, (_, i) => sub(i, 'active', 99));
    const json = await callBilling();

    // 🚨 The defect's signature. One page of 100 gives MRR 9,900 and total 100.
    expect(json.stats.total).toBe(250);
    expect(json.stats.activeCount).toBe(250);
    expect(json.stats.mrr).toBe(250 * 99);
    expect(json.subs).toHaveLength(250);

    // Three pages: 100, 100, 50. The third reports has_more false and stops.
    expect(listCalls).toHaveLength(3);
    expect(listCalls[0].starting_after).toBeUndefined();
    expect(listCalls[1].starting_after).toBe('sub_0099');
    expect(listCalls[2].starting_after).toBe('sub_0199');
  });

  it('churn no longer burns the cap: 180 cancelled + 40 active still yields full MRR', async () => {
    // 🚨 THE CASE THAT ARRIVES FIRST IN REAL LIFE. `status: "all"` lets cancelled
    // subscriptions fill the first page, so an account with only 40 paying
    // customers was already undercounting. Stripe orders newest-first, but this
    // fixture puts the cancelled ones first, which is exactly the shape that
    // pushed all 40 payers off page one.
    account = [
      ...Array.from({ length: 180 }, (_, i) => sub(i, 'canceled', 99)),
      ...Array.from({ length: 40 }, (_, i) => sub(1000 + i, 'active', 149, 2)),
    ];
    const json = await callBilling();

    expect(json.stats.total).toBe(220);
    expect(json.stats.activeCount).toBe(40);
    // MRR counts active/trialing only: 40 x ($149 plan + 2 x $15 seats).
    expect(json.stats.mrr).toBe(40 * (149 + 2 * 15));
    expect(json.stats.totalSeats).toBe(80);
  });

  it('trialing counts toward MRR and active, cancelled does not', async () => {
    account = [
      sub(1, 'active', 100),
      sub(2, 'trialing', 200),
      sub(3, 'canceled', 400),
      sub(4, 'past_due', 800),
    ];
    const json = await callBilling();
    expect(json.stats.total).toBe(4);
    expect(json.stats.activeCount).toBe(2);
    expect(json.stats.mrr).toBe(300);
  });
});

// ── Honesty when the bound IS reached ───────────────────────────────────────

describe('a capped read declares itself partial', () => {
  it('an account inside the bound reports partial: false', async () => {
    account = Array.from({ length: 150 }, (_, i) => sub(i, 'active', 99));
    const json = await callBilling();
    expect(json.stats.partial).toBe(false);
    expect(json.stats.pagesFetched).toBe(2);
    // The flag EXISTS, which is what lets a consumer refuse to print a subset as
    // a total. Its absence was half the defect: there was no way to tell.
    expect(json.stats).toHaveProperty('partial');
  });

  it('no page is ever requested above Stripe\'s own 100 maximum', async () => {
    account = Array.from({ length: 101 }, (_, i) => sub(i, 'active', 10));
    await callBilling();
    for (const call of listCalls) {
      expect(Number(call.limit)).toBeLessThanOrEqual(100);
      expect(call.status).toBe('all');
    }
  });

  it('an empty account is 0, not an error', async () => {
    account = [];
    const json = await callBilling();
    expect(json.stats.total).toBe(0);
    expect(json.stats.mrr).toBe(0);
    expect(json.stats.partial).toBe(false);
    expect(listCalls).toHaveLength(1);
  });
});
