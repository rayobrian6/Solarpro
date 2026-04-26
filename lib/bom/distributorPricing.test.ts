// ============================================================
// lib/bom/distributorPricing.test.ts
// Unit tests for the distributor pricing feed
// ============================================================

import { describe, test, expect } from 'vitest';
import {
  applyDistributorPricing,
  resolveUnitCost,
  bomCostByStage,
  bomCostByCategory,
  DISTRIBUTOR_PRICE_CATALOG,
  CATEGORY_FALLBACK_PRICES,
  type DistributorPriceOverride,
} from './distributorPricing';
import type { BOMLineItemV4 } from '../bom-engine-v4';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<BOMLineItemV4> = {}): BOMLineItemV4 {
  return {
    id:           overrides.id           ?? 'item-001',
    stageId:      overrides.stageId      ?? 'array',
    stageLabel:   overrides.stageLabel   ?? 'Stage 1 — Array',
    category:     overrides.category     ?? 'solar_panel',
    manufacturer: overrides.manufacturer ?? 'Qcells',
    model:        overrides.model        ?? 'Q.Peak Duo BLK ML-G10+ 400W',
    partNumber:   overrides.partNumber   ?? 'Q.PEAK DUO BLK ML-G10+400',
    description:  overrides.description  ?? 'Solar Panel 400W',
    quantity:     overrides.quantity     ?? 20,
    unit:         overrides.unit         ?? 'ea',
    derivedFrom:  overrides.derivedFrom  ?? 'moduleCount',
    required:     overrides.required     ?? true,
    unitCost:     overrides.unitCost,
    totalCost:    overrides.totalCost,
  };
}

function makeInverterItem(): BOMLineItemV4 {
  return makeItem({
    id:           'item-002',
    stageId:      'inverter',
    stageLabel:   'Stage 3 — Inverter',
    category:     'string_inverter',
    manufacturer: 'Fronius',
    model:        'Primo 8.2-1',
    partNumber:   'PRIMO-8.2-1-240',
    description:  'Fronius Primo 8.2kW String Inverter',
    quantity:     1,
    unit:         'ea',
  });
}

function makeWireItem(): BOMLineItemV4 {
  return makeItem({
    id:           'item-003',
    stageId:      'dc',
    stageLabel:   'Stage 2 — DC',
    category:     'wire',
    manufacturer: 'Southwire',
    model:        '#10 AWG THWN-2',
    partNumber:   'SW-10-THWN-BLK',
    description:  'DC Home Run Wire #10 AWG',
    quantity:     150,
    unit:         'ft',
  });
}

function makeUnknownItem(): BOMLineItemV4 {
  return makeItem({
    id:           'item-004',
    stageId:      'labels',
    stageLabel:   'Stage 7 — Labels',
    category:     'label',
    manufacturer: 'Brady',
    model:        'NEC-690-LABEL-SET',
    partNumber:   'BRADY-NEC690-KIT',
    description:  'NEC 690 Warning Label Set',
    quantity:     5,
    unit:         'ea',
  });
}

// ─── applyDistributorPricing ──────────────────────────────────────────────────

describe('applyDistributorPricing', () => {
  test('prices a solar panel from the static catalog', () => {
    const items = [makeItem()];
    const result = applyDistributorPricing(items);

    expect(result.catalogMatches).toBe(1);
    expect(result.overrideMatches).toBe(0);
    expect(result.fallbackMatches).toBe(0);
    expect(result.unpriced).toBe(0);

    const panel = result.items[0];
    // Q.Peak 400W: netPrice = 0.34 * 400 = $136.00/panel
    expect(panel.unitCost).toBeCloseTo(136.00, 2);
    expect(panel.totalCost).toBeCloseTo(136.00 * 20, 2);
  });

  test('prices an inverter from the static catalog', () => {
    const items = [makeInverterItem()];
    const result = applyDistributorPricing(items);

    expect(result.catalogMatches).toBe(1);
    const inv = result.items[0];
    expect(inv.unitCost).toBeCloseTo(1584.00, 2);
    expect(inv.totalCost).toBeCloseTo(1584.00, 2); // qty=1
  });

  test('prices wire from category fallback (unknown part number)', () => {
    const items = [makeWireItem()];
    const result = applyDistributorPricing(items);

    // Wire has an unknown part number — falls to category fallback
    expect(result.fallbackMatches).toBe(1);
    const wire = result.items[0];
    expect(wire.unitCost).toBeCloseTo(CATEGORY_FALLBACK_PRICES['wire'].unitCost, 4);
    expect(wire.totalCost).toBeCloseTo(CATEGORY_FALLBACK_PRICES['wire'].unitCost * 150, 2);
  });

  test('label item falls back to category default', () => {
    const items = [makeUnknownItem()];
    const result = applyDistributorPricing(items);

    expect(result.fallbackMatches).toBe(1);
    const label = result.items[0];
    expect(label.unitCost).toBeCloseTo(CATEGORY_FALLBACK_PRICES['label'].unitCost, 4);
    expect(label.totalCost).toBeCloseTo(CATEGORY_FALLBACK_PRICES['label'].unitCost * 5, 2);
  });

  test('completely unknown category yields unpriced item', () => {
    const items = [makeItem({ category: 'unobtanium', partNumber: 'XYZZY-999' })];
    const result = applyDistributorPricing(items);

    expect(result.unpriced).toBe(1);
    expect(result.items[0].unitCost).toBeUndefined();
    expect(result.items[0].totalCost).toBeUndefined();
  });

  test('DB override wins over catalog', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: 'PRIMO-8.2-1-240', unitCost: 1299.00 },
    ];
    const items = [makeInverterItem()];
    const result = applyDistributorPricing(items, overrides);

    expect(result.overrideMatches).toBe(1);
    expect(result.catalogMatches).toBe(0);
    const inv = result.items[0];
    expect(inv.unitCost).toBeCloseTo(1299.00, 2);
  });

  test('override matching is case-insensitive', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: 'primo-8.2-1-240', unitCost: 1250.00 },
    ];
    const items = [makeInverterItem()];
    const result = applyDistributorPricing(items, overrides);

    expect(result.overrideMatches).toBe(1);
    expect(result.items[0].unitCost).toBeCloseTo(1250.00, 2);
  });

  test('category wildcard override (*) applies to all items in that category', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: '*', category: 'solar_panel', unitCost: 120.00 },
    ];
    const panel1 = makeItem({ id: 'p1', partNumber: 'Q.PEAK DUO BLK ML-G10+400' });
    const panel2 = makeItem({ id: 'p2', partNumber: 'REC405AA-PURE-R' });
    const result = applyDistributorPricing([panel1, panel2], overrides);

    expect(result.overrideMatches).toBe(2);
    expect(result.items[0].unitCost).toBeCloseTo(120.00, 2);
    expect(result.items[1].unitCost).toBeCloseTo(120.00, 2);
  });

  test('exact part override takes priority over category wildcard', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: '*', category: 'solar_panel', unitCost: 120.00 },
      { partNumber: 'Q.PEAK DUO BLK ML-G10+400', unitCost: 99.00 },
    ];
    const panel = makeItem({ partNumber: 'Q.PEAK DUO BLK ML-G10+400' });
    const result = applyDistributorPricing([panel], overrides);

    expect(result.overrideMatches).toBe(1);
    expect(result.items[0].unitCost).toBeCloseTo(99.00, 2);
  });

  test('zero override price results in unpriced item (not stamped)', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: 'PRIMO-8.2-1-240', unitCost: 0 },
    ];
    const items = [makeInverterItem()];
    const result = applyDistributorPricing(items, overrides);

    // unitCost=0 -> override matches, but 0 cost -> unitCost undefined
    expect(result.overrideMatches).toBe(1);
    expect(result.items[0].unitCost).toBeUndefined();
  });

  test('totalBomCost is the sum of all line totalCosts', () => {
    const panel    = makeItem({ quantity: 20 });
    const inverter = makeInverterItem();
    const result   = applyDistributorPricing([panel, inverter]);

    const expected = (result.items[0].totalCost ?? 0) + (result.items[1].totalCost ?? 0);
    expect(result.totalBomCost).toBeCloseTo(expected, 2);
    expect(result.totalBomCost).toBeGreaterThan(0);
  });

  test('items already priced (unitCost set) are not re-priced', () => {
    const priced = makeItem({ unitCost: 200.00, totalCost: 4000.00 });
    const result = applyDistributorPricing([priced]);

    expect(result.items[0].unitCost).toBeCloseTo(200.00, 2);
    expect(result.items[0].totalCost).toBeCloseTo(4000.00, 2);
  });

  test('empty items array returns zero totals', () => {
    const result = applyDistributorPricing([]);
    expect(result.totalBomCost).toBe(0);
    expect(result.catalogMatches).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test('mixed catalog + fallback + unpriced items', () => {
    const items = [
      makeItem(),           // catalog: solar panel
      makeInverterItem(),   // catalog: inverter
      makeWireItem(),       // fallback: wire
      makeItem({ category: 'unobtanium', partNumber: 'XYZZY' }), // unpriced
    ];
    const result = applyDistributorPricing(items);

    expect(result.catalogMatches).toBe(2);
    expect(result.fallbackMatches).toBe(1);
    expect(result.unpriced).toBe(1);
    expect(result.items).toHaveLength(4);
  });

  test('Enphase IQ8+ microinverter priced from catalog', () => {
    const micro = makeItem({
      category:   'microinverter',
      partNumber: 'IQ8PLUS-72-2-US',
      quantity:   20,
    });
    const result = applyDistributorPricing([micro]);

    expect(result.catalogMatches).toBe(1);
    expect(result.items[0].unitCost).toBeCloseTo(156.00, 2);
    expect(result.items[0].totalCost).toBeCloseTo(156.00 * 20, 2);
  });

  test('Tesla Powerwall 3 battery priced from catalog', () => {
    const battery = makeItem({
      category:   'battery',
      partNumber: 'PW3-US',
      quantity:   1,
    });
    const result = applyDistributorPricing([battery]);

    expect(result.catalogMatches).toBe(1);
    expect(result.items[0].unitCost).toBeCloseTo(8280.00, 2);
  });

  test('totalCost is rounded to 2 decimal places', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: 'Q.PEAK DUO BLK ML-G10+400', unitCost: 133.33 },
    ];
    const panel = makeItem({ quantity: 3 });
    const result = applyDistributorPricing([panel], overrides);

    const total = result.items[0].totalCost ?? 0;
    expect(total).toBeCloseTo(399.99, 2);
    expect(Number(total.toFixed(2))).toBe(total);
  });
});

// ─── resolveUnitCost ──────────────────────────────────────────────────────────

describe('resolveUnitCost', () => {
  test('returns catalog price for known part number', () => {
    const price = resolveUnitCost('IQ8PLUS-72-2-US', 'microinverter');
    expect(price).toBeCloseTo(156.00, 2);
  });

  test('returns category fallback for unknown part number', () => {
    const price = resolveUnitCost('UNKNOWN-PART', 'breaker');
    expect(price).toBeCloseTo(CATEGORY_FALLBACK_PRICES['breaker'].unitCost, 4);
  });

  test('returns 0 for completely unknown part + category', () => {
    const price = resolveUnitCost('UNKNOWN-PART', 'unknown_category');
    expect(price).toBe(0);
  });

  test('override wins over catalog', () => {
    const overrides: DistributorPriceOverride[] = [
      { partNumber: 'IQ8PLUS-72-2-US', unitCost: 140.00 },
    ];
    const price = resolveUnitCost('IQ8PLUS-72-2-US', 'microinverter', overrides);
    expect(price).toBeCloseTo(140.00, 2);
  });

  test('case-insensitive part number lookup', () => {
    const lower = resolveUnitCost('iq8plus-72-2-us', 'microinverter');
    const upper = resolveUnitCost('IQ8PLUS-72-2-US', 'microinverter');
    expect(lower).toBe(upper);
  });
});

// ─── bomCostByStage ───────────────────────────────────────────────────────────

describe('bomCostByStage', () => {
  test('sums costs by stage', () => {
    const items: BOMLineItemV4[] = [
      makeItem({ stageId: 'array',    totalCost: 2720.00, quantity: 20 }),
      makeItem({ stageId: 'array',    totalCost:  300.00, quantity: 5  }),
      makeItem({ stageId: 'inverter', totalCost: 1584.00, quantity: 1  }),
    ];
    const result = bomCostByStage(items);

    expect(result['array']).toBeCloseTo(3020.00, 2);
    expect(result['inverter']).toBeCloseTo(1584.00, 2);
    expect(result['dc']).toBeUndefined();
  });

  test('ignores items with no totalCost', () => {
    const items: BOMLineItemV4[] = [
      makeItem({ stageId: 'array', totalCost: undefined }),
      makeItem({ stageId: 'array', totalCost: 500.00 }),
    ];
    const result = bomCostByStage(items);
    expect(result['array']).toBeCloseTo(500.00, 2);
  });

  test('returns empty object for empty array', () => {
    expect(bomCostByStage([])).toEqual({});
  });
});

// ─── bomCostByCategory ────────────────────────────────────────────────────────

describe('bomCostByCategory', () => {
  test('sums costs by category', () => {
    const items: BOMLineItemV4[] = [
      makeItem({ category: 'solar_panel',     totalCost: 2720.00 }),
      makeItem({ category: 'solar_panel',     totalCost:  544.00 }),
      makeItem({ category: 'string_inverter', totalCost: 1584.00 }),
    ];
    const result = bomCostByCategory(items);

    expect(result['solar_panel']).toBeCloseTo(3264.00, 2);
    expect(result['string_inverter']).toBeCloseTo(1584.00, 2);
  });

  test('returns empty object for empty array', () => {
    expect(bomCostByCategory([])).toEqual({});
  });
});

// ─── Static catalog integrity ─────────────────────────────────────────────────

describe('DISTRIBUTOR_PRICE_CATALOG integrity', () => {
  test('all entries have non-empty part numbers', () => {
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      expect(entry.partNumber.trim()).not.toBe('');
    }
  });

  test('all entries have positive netPrice', () => {
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      expect(entry.netPrice).toBeGreaterThan(0);
    }
  });

  test('all entries have a valid source', () => {
    const validSources = new Set(['CED', 'Soligent', 'KWh', 'Internal']);
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      expect(validSources.has(entry.source)).toBe(true);
    }
  });

  test('no duplicate part numbers in catalog', () => {
    const seen = new Set<string>();
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      const key = entry.partNumber.toUpperCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test('all listPrices >= netPrices (list is higher than net)', () => {
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      expect(entry.listPrice).toBeGreaterThanOrEqual(entry.netPrice);
    }
  });

  test('asOf dates are valid ISO date strings', () => {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      expect(dateRegex.test(entry.asOf)).toBe(true);
    }
  });
});

// ─── Category fallback integrity ──────────────────────────────────────────────

describe('CATEGORY_FALLBACK_PRICES integrity', () => {
  test('all fallback prices are positive', () => {
    for (const [_cat, entry] of Object.entries(CATEGORY_FALLBACK_PRICES)) {
      expect(entry.unitCost).toBeGreaterThan(0);
    }
  });

  test('core BOM categories have fallbacks', () => {
    const required = [
      'solar_panel', 'microinverter', 'string_inverter', 'optimizer',
      'battery', 'racking', 'wire', 'conduit', 'breaker', 'disconnect',
      'rapid_shutdown', 'label',
    ];
    for (const cat of required) {
      expect(CATEGORY_FALLBACK_PRICES[cat]).toBeDefined();
    }
  });
});