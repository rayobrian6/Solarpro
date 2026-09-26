/**
 * tests/internalMarginMatchesTheQuotedPrice.test.ts
 *
 * THE INSTALLER'S MARGIN CARD WAS COMPUTED FROM A PRICE THE CUSTOMER NEVER SEES.
 *
 * DesignStudio renders a "Your margin - Internal only" panel from
 * `costEstimate.internalRevenue / internalCost / internalProfit / internalMargin`,
 * and its own comment asserts the revenue is "the same number the proposal is
 * priced from". It was not. `/api/production` quoted the customer
 * `calculateItemizedPrice(...).totalCashPrice` — per-panel price x count, PLUS
 * fixed costs — while `internalRevenue` came from `calculateFinalPrice`, whose
 * per-watt method never adds the fixed cost and DOES scale with panel wattage.
 *
 * Two different price models, one labelled as the other, and the error changes
 * SIGN with panel wattage:
 *
 *   20 x 440 W  customer $29,280   card showed Revenue $27,280, Margin 42.3%
 *                                  true margin on the quote  46.3%
 *                                  -> understated by exactly the $2,000 fixed cost
 *
 *   20 x 500 W  customer $29,280   card showed Revenue $31,000, Margin 43.2%
 *                                  true margin on the quote  39.9%
 *                                  -> OVERSTATED, the direction that makes an
 *                                     installer discount a job into a loss
 *
 * And on a Sol Fence job the cost side compounded it: `equipmentCostPerWatt` is a
 * single scalar sourced from the ROOF_MOUNT entry of the company table, so fence
 * equipment was costed at 0.55 $/W when the company's own figure is 0.95.
 *
 * WHAT THIS SUITE IS FOR. It is behavioural: it calls the real POST handler and
 * asserts the exact worked numbers above, and — separately, because this is the
 * thing that must not break — that every CUSTOMER-FACING figure the route
 * persists is byte-for-byte what it was before the repair. The repair is only
 * correct if the internal card moved and the quote did not.
 *
 * Fixtures are the SHIPPED pricing defaults: `getPricingConfig` returns null, so
 * `loadPricingConfig` falls back to DEFAULT_CONFIG, which is built from
 * lib/companyPricing.ts. If those defaults change, the arithmetic below changes
 * with them and this file must be re-derived, not re-baselined.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────
// Everything the route touches except the pricing engine itself, which is the
// code under test and runs for real.

const upsertProductionCalls: any[] = [];

vi.mock('@/lib/db-neon', () => ({
  getProjectById: vi.fn(),
  getClientById: vi.fn(),
  getLayoutByProject: vi.fn(),
  upsertLayout: vi.fn(),
  updateProject: vi.fn(async () => ({})),
  upsertProduction: vi.fn(async (args: any) => { upsertProductionCalls.push(args); return {}; }),
  upsertSelectedEquipment: vi.fn(async () => ({})),
  handleRouteDbError: vi.fn(() => new Response(JSON.stringify({ success: false }), { status: 503 })),
  // loadPricingConfig() dynamically imports this module and returns DEFAULT_CONFIG
  // when the row is null — which is exactly the shipped-defaults case we want.
  getPricingConfig: vi.fn(async () => null),
}));

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => ({ id: 'user-1' })),
}));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/pvwatts', () => ({
  calculateProduction: vi.fn(async () => ({ annualProductionKwh: 12000 })),
  calculateProductionFromDefinition: vi.fn(async () => ({ annualProductionKwh: 12000 })),
}));

vi.mock('@/lib/multiArrayEngine', () => ({
  buildArraysFromLayout: vi.fn(() => undefined),
  buildSystemConfig: vi.fn(() => ({})),
  buildArrayBreakdown: vi.fn(() => []),
}));

vi.mock('@/lib/system/selectedEquipment', () => ({
  designEquipmentPatch: vi.fn(() => null),
}));

vi.mock('@/lib/system/designToEngineering', () => ({
  designSubSystemBlocks: vi.fn(() => null),
}));

import { getProjectById, getClientById, upsertLayout } from '@/lib/db-neon';
import { POST } from '@/app/api/production/route';

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';

function panels(count: number, wattage: number, systemType: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, systemType, wattage,
  }));
}

/**
 * Drive the real handler for `count` panels of `wattage` watts on `systemType`.
 * `upsertLayout` is what the route costs from, so the saved layout IS the input.
 */
async function runProduction(count: number, wattage: number, systemType: string, body: Record<string, unknown> = {}) {
  upsertProductionCalls.length = 0;
  const p = panels(count, wattage, systemType);
  const systemSizeKw = (count * wattage) / 1000;

  (getProjectById as any).mockResolvedValue({
    id: PROJECT_ID, clientId: 'client-1', systemType,
    selectedPanel: null, selectedInverter: null,
  });
  (getClientById as any).mockResolvedValue({
    id: 'client-1', lat: 40, lng: -89, utilityRate: 0.13, annualKwh: 12000,
  });
  (upsertLayout as any).mockResolvedValue({
    id: 'layout-1', projectId: PROJECT_ID, systemType,
    panels: p, totalPanels: count, systemSizeKw,
  });

  const req = new Request('http://localhost/api/production', {
    method: 'POST',
    body: JSON.stringify({
      projectId: PROJECT_ID,
      layout: { systemType, panels: p, totalPanels: count, systemSizeKw },
      ...body,
    }),
  });
  const res = await POST(req as any);
  const json = await res.json();
  expect(json.success, JSON.stringify(json)).toBe(true);
  return json.data.costEstimate;
}

beforeEach(() => { vi.clearAllMocks(); });

// ── The two cases whose error has opposite sign ─────────────────────────────

describe('the margin card is derived from the quoted price', () => {
  it('20 x 440 W roof: revenue IS the $29,280 quote, not the $27,280 per-watt figure', async () => {
    const ce = await runProduction(20, 440, 'roof');

    // What the customer pays: 20 x $1,364 + $2,000 fixed.
    expect(ce.cashPrice).toBe(29280);
    expect(ce.grossCost).toBe(29280);
    expect(ce.totalBeforeCredit).toBe(29280);

    // The internal card, now computed from that same number.
    // cost = 8,800 W x (0.55 equip + 0.75 labor) = 11,440, +20% overhead 2,288,
    // + 2,000 fixed = 15,728.
    expect(ce.internalCost).toBe(15728);
    expect(ce.internalRevenue).toBe(29280);   // was 27280 — the per-watt method
    expect(ce.internalProfit).toBe(13552);    // was 11552 — understated by the $2,000 fixed cost
    expect(ce.internalMargin).toBe(46.3);     // was 42.3
  });

  it('20 x 500 W roof: the old error INVERTED here, overstating margin', async () => {
    const ce = await runProduction(20, 500, 'roof');

    // Per-panel pricing does not follow wattage, so the quote is unchanged.
    expect(ce.cashPrice).toBe(29280);

    // cost = 10,000 W x 1.30 = 13,000, +20% overhead 2,600, + 2,000 = 17,600.
    expect(ce.internalCost).toBe(17600);
    expect(ce.internalRevenue).toBe(29280);   // was 31000 — per-watt DOES follow wattage
    expect(ce.internalProfit).toBe(11680);    // was 13400 — overstated
    expect(ce.internalMargin).toBe(39.9);     // was 43.2 — overstated by 3.3 points
  });

  it('the two wattages disagree on cost but never on the quoted price', async () => {
    const a = await runProduction(20, 440, 'roof');
    const b = await runProduction(20, 500, 'roof');
    expect(a.cashPrice).toBe(b.cashPrice);
    // The defect's signature: revenue used to move with wattage while the quote
    // did not. Now revenue tracks the quote and only the COST moves.
    expect(a.internalRevenue).toBe(b.internalRevenue);
    expect(a.internalCost).not.toBe(b.internalCost);
  });
});

// ── The cost side has to know which system it is costing ────────────────────

describe('equipmentCostPerWatt resolves per SystemTypeKey', () => {
  it('a Sol Fence job is costed at 0.95 $/W equipment, not the roof 0.55', async () => {
    const ce = await runProduction(20, 440, 'fence');

    // Quote: 20 x round(4.25 x 440) = 20 x 1,870 + 2,000 fixed.
    expect(ce.cashPrice).toBe(39400);

    // cost = 8,800 W x (0.95 equip + 0.75 labor) = 14,960, +20% overhead 2,992,
    // + 2,000 fixed = 19,952. At the roof rate it was 15,728 — $4,224 lower,
    // which is the $3,520 equipment gap plus the 20% overhead levied on it.
    expect(ce.internalCost).toBe(19952);
    expect(ce.internalProfit).toBe(19448);
    expect(ce.internalMargin).toBe(49.4);
  });

  it('a roof job keeps the configured scalar, so nothing moves for the common case', async () => {
    const ce = await runProduction(20, 440, 'roof');
    expect(ce.internalCost).toBe(15728);
  });

  it('resolving equipment cost does not touch any customer-facing figure', async () => {
    // Fence and roof quotes differ because of the PRICE table, never the cost
    // table. Proven by holding the cost table's effect to internalCost alone.
    const fence = await runProduction(20, 440, 'fence');
    const roof  = await runProduction(20, 440, 'roof');
    expect(fence.cashPrice).toBe(39400);        // 20 x 1,870 + 2,000
    expect(roof.cashPrice).toBe(29280);         // 20 x 1,364 + 2,000
    expect(fence.taxCredit).toBe(0);            // residential ITC is 0 post-P.L.119-21
    expect(roof.taxCredit).toBe(0);
    expect(fence.netCost).toBe(39400);
    expect(roof.netCost).toBe(29280);
  });
});

// ── The persisted customer price must not have moved ────────────────────────

describe('no customer-facing number moved', () => {
  it('every customer figure the route PERSISTS is the pre-repair value', async () => {
    const ce = await runProduction(20, 440, 'roof');

    expect(upsertProductionCalls).toHaveLength(1);
    const persisted = upsertProductionCalls[0].costEstimate;

    // 🚨 These are the numbers the canonical proposal reads back. Each one is the
    // value the route produced BEFORE the internal-margin repair, recomputed here
    // from the shipped defaults rather than copied from a previous run:
    //   subtotalBeforeFixed 20 x 1,364            = 27,280
    //   fixedCosts          DEFAULT_CONFIG        =  2,000
    //   cashPrice           27,280 + 2,000        = 29,280
    //   taxCredit           residential ITC 0%    =      0
    //   netCost             29,280 - 0            = 29,280
    //   pricePerWatt        29,280 / 8,800 W      =   3.33
    //   annualSavings       12,000 kWh x $0.13    =  1,560
    expect(persisted.subtotalBeforeFixed).toBe(27280);
    expect(persisted.fixedCosts).toBe(2000);
    expect(persisted.grossCost).toBe(29280);
    expect(persisted.cashPrice).toBe(29280);
    expect(persisted.totalBeforeCredit).toBe(29280);
    expect(persisted.taxCredit).toBe(0);
    expect(persisted.netCost).toBe(29280);
    expect(persisted.costAfterIncentives).toBe(29280);
    expect(persisted.pricePerWatt).toBe(3.33);
    expect(persisted.annualSavings).toBe(1560);
    expect(persisted.systemSizeKw).toBe(8.8);

    // The line items are what the proposal itemises. Unchanged shape and values.
    expect(persisted.lineItems).toEqual([
      { type: 'roof', label: 'Roof-Mounted Solar', panelCount: 20, pricePerPanel: 1364, subtotal: 27280 },
    ]);

    // And the response the studio renders carries the same figures.
    expect(ce.cashPrice).toBe(persisted.cashPrice);
    expect(ce.netCost).toBe(persisted.netCost);
  });

  it('the internal card and the persisted quote agree, which was the whole defect', async () => {
    await runProduction(20, 440, 'roof');
    const persisted = upsertProductionCalls[0].costEstimate;
    expect(persisted.internalRevenue).toBe(persisted.cashPrice);
    expect(persisted.internalProfit).toBe(persisted.cashPrice - persisted.internalCost);
  });
});

// ── salesOverride is gone from the contract ────────────────────────────────

describe('salesOverride is inert', () => {
  it('a salesOverride on the body moves nothing, customer-facing or internal', async () => {
    const plain = await runProduction(20, 440, 'roof');
    const withOverride = await runProduction(20, 440, 'roof', {
      salesOverride: { finalPrice: 99999, pricePerWatt: 9.99, marginPercent: 90 },
    });

    // 🚨 This is the point of dropping it. It used to move internalRevenue via
    // calculateFinalPrice while leaving the customer's itemized quote alone —
    // the exact split the margin card exists to prevent.
    expect(withOverride.cashPrice).toBe(plain.cashPrice);
    expect(withOverride.internalRevenue).toBe(plain.internalRevenue);
    expect(withOverride.internalProfit).toBe(plain.internalProfit);
    expect(withOverride.internalMargin).toBe(plain.internalMargin);
    expect(withOverride.internalRevenue).toBe(29280);
  });
});

// ── The no-client path: a zero that a consumer can read ─────────────────────

describe('a cost that was never computed stays 0 and the card hides', () => {
  it('no client -> internal block is all zero, so DesignStudio renders nothing', async () => {
    upsertProductionCalls.length = 0;
    const p = panels(20, 440, 'roof');
    (getProjectById as any).mockResolvedValue({
      id: PROJECT_ID, clientId: null, systemType: 'roof', lat: 40, lng: -89,
      selectedPanel: null, selectedInverter: null,
    });
    (getClientById as any).mockResolvedValue(null);
    (upsertLayout as any).mockResolvedValue({
      id: 'layout-1', projectId: PROJECT_ID, systemType: 'roof',
      panels: p, totalPanels: 20, systemSizeKw: 8.8,
    });

    const req = new Request('http://localhost/api/production', {
      method: 'POST',
      body: JSON.stringify({
        projectId: PROJECT_ID,
        layout: { systemType: 'roof', panels: p, totalPanels: 20, systemSizeKw: 8.8 },
      }),
    });
    const json = await (await POST(req as any)).json();
    expect(json.success, JSON.stringify(json)).toBe(true);
    const ce = json.data.costEstimate;

    // The customer price is still real on this path.
    expect(ce.cashPrice).toBe(29280);
    // The cost is genuinely not computed. DesignStudio gates the card on
    // `internalCost > 0`, so 0 here reads as "not computed" and nothing renders —
    // which is why a zero is admissible in this one place.
    expect(ce.internalCost).toBe(0);
    expect(ce.internalRevenue).toBe(0);
    expect(ce.internalProfit).toBe(0);
    expect(ce.internalMargin).toBe(0);
  });
});
