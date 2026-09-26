/**
 * tests/distributorOverridePrecedence.test.ts
 *
 * A COMPANY'S OWN CONTRACT PRICE WAS THROWN AWAY BY THE PLATFORM SEED.
 *
 * `distributor_prices` is the top-priority price authority for every BOM dollar
 * figure, the $/W KPI and the BOM Cost tile. Migration 015 seeds 21 GLOBAL rows
 * (`user_id NULL`) for the highest-dollar SKUs — panels, string/hybrid inverters,
 * micros, optimizers, batteries. (The Phase-4 finding said 22; counted from the
 * migration it is 21, and tests/distributorPriceOverridesAreWritable.test.ts
 * pins that against the real schema.)
 *
 * `app/api/engineering/bom/route.ts` fetches company rows AND global rows in one
 * query and orders them `CASE WHEN user_id IS NULL THEN 1 ELSE 0 END`, i.e.
 * COMPANY FIRST — highest priority first. `buildOverrideMaps` then built its
 * lookup with a bare `map.set()` per row, which is LAST-wins. So for any of
 * those seeded SKUs the company override was fetched, sorted first, and then
 * silently overwritten by the seed. A company whose real Powerwall 3 net is
 * $7,100 still paid $8,280 per battery in Est. Hardware Cost and in the $/W
 * tile, with nothing saying its override had been ignored.
 *
 * Overrides for part numbers OUTSIDE the seeded SKUs DID work, which is why
 * this read as random rather than systematic.
 *
 * These are behavioural tests: they call the real pricing entry points with a
 * real seeded SKU and assert WHICH PRICE WINS. Only the last `describe` reads
 * source text, and it says so.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyDistributorPricing,
  resolveUnitCost,
  type DistributorPriceOverride,
} from '../lib/bom/distributorPricing';
import { stripComments } from './support/stripSource';
import type { BOMLineItemV4 } from '../lib/bom-types-v4';

const ROOT = join(__dirname, '..');

/** PW3-US is one of migration 015's seeded globals, at 8280.00. */
const SEEDED_PART = 'PW3-US';
const PLATFORM_SEED_COST = 8280.0;
const COMPANY_CONTRACT_COST = 7100.0;

/** Exactly the row order `app/api/engineering/bom/route.ts` produces: company first. */
const OVERRIDES_AS_THE_ROUTE_ORDERS_THEM: DistributorPriceOverride[] = [
  { partNumber: SEEDED_PART, category: 'battery', unitCost: COMPANY_CONTRACT_COST }, // user_id SET  → 0
  { partNumber: SEEDED_PART, category: 'battery', unitCost: PLATFORM_SEED_COST },    // user_id NULL → 1
];

function battery(overrides: Partial<BOMLineItemV4> = {}): BOMLineItemV4 {
  return {
    id: 'bat-1',
    stageId: 'inverter',
    stageLabel: 'Stage 3 — Inverter / Storage / Combiner',
    category: 'battery',
    manufacturer: 'Tesla',
    model: 'Powerwall 3',
    partNumber: SEEDED_PART,
    description: 'Tesla Powerwall 3',
    quantity: 2,
    unit: 'ea',
    derivedFrom: 'test',
    required: true,
    ...overrides,
  } as BOMLineItemV4;
}

describe('🚨 the company override beats the platform seed for the same SKU', () => {
  it('applyDistributorPricing prices the battery at the company contract cost', () => {
    const result = applyDistributorPricing([battery()], OVERRIDES_AS_THE_ROUTE_ORDERS_THEM);

    // This asserted 8280 before the repair: the seed, not the contract.
    expect(result.items[0].unitCost).toBeCloseTo(COMPANY_CONTRACT_COST, 2);
    expect(result.items[0].unitCost).not.toBeCloseTo(PLATFORM_SEED_COST, 2);
  });

  it('the BOM total and therefore the $/W tile carry the company price', () => {
    const result = applyDistributorPricing([battery({ quantity: 2 })], OVERRIDES_AS_THE_ROUTE_ORDERS_THEM);

    expect(result.items[0].totalCost).toBeCloseTo(COMPANY_CONTRACT_COST * 2, 2);
    expect(result.totalBomCost).toBeCloseTo(COMPANY_CONTRACT_COST * 2, 2);
    // $2,360 of phantom hardware cost per project, on one line item.
    expect(result.totalBomCost).toBeLessThan(PLATFORM_SEED_COST * 2);
  });

  it('resolveUnitCost — the admin price preview — agrees with the engine', () => {
    const price = resolveUnitCost(SEEDED_PART, 'battery', OVERRIDES_AS_THE_ROUTE_ORDERS_THEM);
    expect(price).toBeCloseTo(COMPANY_CONTRACT_COST, 2);
  });

  it('a category wildcard follows the same precedence', () => {
    // Company-wide `*` for batteries first, platform `*` second.
    const overrides: DistributorPriceOverride[] = [
      { partNumber: '*', category: 'battery', unitCost: 5000 },
      { partNumber: '*', category: 'battery', unitCost: 9999 },
    ];
    // An unseeded part number so nothing but the wildcard can match.
    const result = applyDistributorPricing(
      [battery({ partNumber: 'NO-SUCH-BATTERY-SKU' })],
      overrides,
    );
    expect(result.items[0].unitCost).toBeCloseTo(5000, 2);
  });

  it('the exact-part override still beats a higher-priority category wildcard', () => {
    // Precedence between KINDS is unchanged by the repair: exact part wins over
    // wildcard regardless of list order (resolvePriceForItem checks it first).
    const overrides: DistributorPriceOverride[] = [
      { partNumber: '*', category: 'battery', unitCost: 5000 },
      { partNumber: SEEDED_PART, category: 'battery', unitCost: COMPANY_CONTRACT_COST },
    ];
    const result = applyDistributorPricing([battery()], overrides);
    expect(result.items[0].unitCost).toBeCloseTo(COMPANY_CONTRACT_COST, 2);
  });

  it('an override for an UNSEEDED SKU still applies (this always worked)', () => {
    // Stated so a future reader knows the defect was partial, not total — that
    // is exactly what made it look random in the field.
    const result = applyDistributorPricing(
      [battery({ partNumber: 'SOME-CUSTOM-BATTERY' })],
      [{ partNumber: 'SOME-CUSTOM-BATTERY', unitCost: 1234.0 }],
    );
    expect(result.items[0].unitCost).toBeCloseTo(1234.0, 2);
  });
});

describe('the precedence CONTRACT the map build depends on', () => {
  // ⚠ SOURCE SCAN. `buildOverrideMaps` is first-wins, which is only correct
  // because the DB query hands it company rows first. That ordering lives in a
  // SQL string inside a route that also needs auth, a database and a full BOM
  // input to execute, so this one assertion reads the SQL text instead of
  // running it. Comments are stripped so the explanation of the fix cannot
  // satisfy the guard.
  const BOM_ROUTE = stripComments(
    readFileSync(join(ROOT, 'app', 'api', 'engineering', 'bom', 'route.ts'), 'utf8'),
  );

  it('the override query still sorts per-company rows BEFORE platform rows', () => {
    const normalised = BOM_ROUTE.replace(/\s+/g, ' ');
    // `user_id IS NULL THEN 1 ELSE 0` ⇒ NULL (platform) sorts last. If anyone
    // flips this to `THEN 0 ELSE 1`, first-wins starts preferring the seed and
    // the defect returns with the map build looking innocent.
    expect(normalised).toMatch(/CASE WHEN user_id IS NULL THEN 1 ELSE 0 END/);
    expect(normalised).not.toMatch(/CASE WHEN user_id IS NULL THEN 0 ELSE 1 END/);
  });
});
