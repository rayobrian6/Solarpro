// ============================================================
// lib/bom/distributorPricing.ts
// ─────────────────────────────────────────────────────────────
// Distributor pricing feed for BOM line items.
//
// ARCHITECTURE
//   1. STATIC CATALOG  — market-rate baseline for every registered
//      part number and category, drawn from CED Greentech / Soligent
//      / KWh Analytics published price sheets (Q1 2025 baseline).
//   2. DB OVERRIDES    — `distributor_prices` table rows win over
//      the static catalog (admin-editable, per-company).
//   3. CATEGORY FALLBACK — when no SKU match exists, a per-category
//      cost-per-unit estimate is used so every line always gets a price.
//
// ENTRY POINT
//   applyDistributorPricing(items, overrides?) → BOMLineItemV4[]
//     Stamps unitCost + totalCost onto every line item.
//     Never throws — falls back silently to category defaults.
//
// DISTRIBUTOR PRIORITY (for static catalog source notes)
//   1. CED Greentech (ced.com)     — panels, inverters, optimizers, racking
//   2. Soligent (soligent.com)     — batteries, BOS, wire, conduit
//   3. KWh Analytics (kwh.com)     — commodity wire, conduit, breakers
//   4. Internal estimate           — structural, labels, misc
// ============================================================

import type { BOMLineItemV4 } from '../bom-engine-v4';

// ─── Public types ─────────────────────────────────────────────────────────────

export type DistributorSource = 'CED' | 'Soligent' | 'KWh' | 'Internal';

export interface DistributorPriceEntry {
  /** Part number (primary lookup key). */
  partNumber: string;
  /** Human-readable description. */
  description: string;
  /** BOM category (used as secondary lookup key). */
  category: string;
  /** Unit (matches BOMLineItemV4.unit). */
  unit: 'ea' | 'ft' | 'lf' | 'roll' | 'set' | 'lot';
  /** Distributor list price per unit (USD). */
  listPrice: number;
  /** Typical contractor net price after standard discount (USD). */
  netPrice: number;
  /** Source distributor. */
  source: DistributorSource;
  /** Price sheet date (YYYY-MM-DD). */
  asOf: string;
}

export interface DistributorPriceOverride {
  /** Part number — matches BOMLineItemV4.partNumber. Use '*' for category-wide override. */
  partNumber: string;
  /** Category — used when partNumber is '*'. */
  category?: string;
  /** Unit cost (USD) to apply. */
  unitCost: number;
  /** Optional: override label for display. */
  label?: string;
}

export interface PricingApplyResult {
  items: BOMLineItemV4[];
  /** Count of items priced from static catalog. */
  catalogMatches: number;
  /** Count of items priced from DB overrides. */
  overrideMatches: number;
  /** Count of items priced from category fallback. */
  fallbackMatches: number;
  /** Count of items that got zero pricing (no match anywhere). */
  unpriced: number;
  /** Total BOM cost (sum of all totalCost values). */
  totalBomCost: number;
}

// ─── Static price catalog (CED / Soligent / KWh Q1 2025 baseline) ─────────────
// Prices represent typical contractor net after standard distributor discount.
// List price → Net price mapping uses published distributor discount schedules:
//   CED Greentech: ~18–22% off list for qualified contractors
//   Soligent: ~15–20% off list for registered installers
//   KWh Analytics: ~10–15% off list (commodity items, tighter margins)

export const DISTRIBUTOR_PRICE_CATALOG: DistributorPriceEntry[] = [

  // ─── Solar Panels ──────────────────────────────────────────────────────────
  {
    partNumber: 'Q.PEAK DUO BLK ML-G10+400',
    description: 'Qcells Q.Peak Duo BLK ML-G10+ 400W Monocrystalline',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.42, netPrice: 0.34,   // $/W → per panel: listPrice * 400W
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'REC405AA-PURE-R',
    description: 'REC Alpha Pure 405W Black Frame',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.46, netPrice: 0.37,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SIL-380-BK',
    description: 'Silfab SIL-380-BK 380W Black Frame',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.38, netPrice: 0.31,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PS-MNB108-HCBF-440W',
    description: 'Panasonic EverVolt 440W Black Frame',
    category: 'solar_panel', unit: 'ea',
    listPrice: 0.55, netPrice: 0.44,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── String Inverters ──────────────────────────────────────────────────────
  {
    partNumber: 'PRIMO-8.2-1-240',
    description: 'Fronius Primo 8.2-1 Single Phase String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1980.00, netPrice: 1584.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SB7.7-1SP-US-40',
    description: 'SMA Sunny Boy 7.7-US String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1650.00, netPrice: 1320.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SG8K-D-US',
    description: 'Sungrow SG8K-D 8kW String Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1450.00, netPrice: 1160.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE7600H-US000BNU4',
    description: 'SolarEdge HD-Wave SE7600H 7.6kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 1890.00, netPrice: 1512.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE10000H-US000BNU4',
    description: 'SolarEdge HD-Wave SE10000H 10kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 2100.00, netPrice: 1680.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE11400H-US000BNU4',
    description: 'SolarEdge HD-Wave SE11400H 11.4kW Inverter',
    category: 'string_inverter', unit: 'ea',
    listPrice: 2350.00, netPrice: 1880.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SE10K-RWS',
    description: 'SolarEdge StorEdge SE10K-RWS Hybrid Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 2850.00, netPrice: 2280.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-5K-HV',
    description: 'EcoFlow PowerOcean 5kW Single Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 2200.00, netPrice: 1870.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-10K-HV',
    description: 'EcoFlow PowerOcean 10kW Three Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 3400.00, netPrice: 2890.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-PO-20K-HV-PRO',
    description: 'EcoFlow PowerOcean 20kW Pro Three Phase Inverter',
    category: 'hybrid_inverter', unit: 'ea',
    listPrice: 5800.00, netPrice: 4930.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Microinverters ────────────────────────────────────────────────────────
  {
    partNumber: 'IQ8PLUS-72-2-US',
    description: 'Enphase IQ8+ Microinverter',
    category: 'microinverter', unit: 'ea',
    listPrice: 195.00, netPrice: 156.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'IQ8M-72-2-US',
    description: 'Enphase IQ8M Microinverter',
    category: 'microinverter', unit: 'ea',
    listPrice: 215.00, netPrice: 172.00,
    source: 'CED', asOf: '2025-01-15',
  },

  // ─── Power Optimizers ──────────────────────────────────────────────────────
  {
    partNumber: 'P401-5R2MRM',
    description: 'SolarEdge P401 Power Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 62.00, netPrice: 49.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'P505-5R2MRM',
    description: 'SolarEdge P505 Power Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 68.00, netPrice: 54.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'TAP-TS4-A-O',
    description: 'Tigo TS4-A-O Smart Module Optimizer',
    category: 'optimizer', unit: 'ea',
    listPrice: 45.00, netPrice: 36.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Batteries ─────────────────────────────────────────────────────────────
  {
    partNumber: 'IQ-BAT-5P-1P-240',
    description: 'Enphase IQ Battery 5P (5kWh)',
    category: 'battery', unit: 'ea',
    listPrice: 3800.00, netPrice: 3230.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PW3-US',
    description: 'Tesla Powerwall 3 (13.5kWh)',
    category: 'battery', unit: 'ea',
    listPrice: 9200.00, netPrice: 8280.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-BATT-5K-LFP',
    description: 'EcoFlow PowerOcean 5kWh LFP Battery Module',
    category: 'battery', unit: 'ea',
    listPrice: 3200.00, netPrice: 2720.00,
    source: 'Soligent', asOf: '2025-01-15',
  },

  // ─── Racking / Mounting ────────────────────────────────────────────────────
  {
    partNumber: 'RT-MINI-01',
    description: 'IronRidge RT Mini Rail-Free Mount',
    category: 'racking', unit: 'ea',
    listPrice: 18.50, netPrice: 14.80,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'PP-DRIVEN-PILE-01',
    description: 'IronRidge Ground Mount Driven Pile',
    category: 'racking', unit: 'ea',
    listPrice: 85.00, netPrice: 68.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'XR-100-168B',
    description: 'IronRidge XR100 Rail 168" Black',
    category: 'racking', unit: 'ea',
    listPrice: 62.00, netPrice: 49.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'XR-1000-168B',
    description: 'IronRidge XR1000 Rail 168" Black (Heavy Duty)',
    category: 'racking', unit: 'ea',
    listPrice: 78.00, netPrice: 62.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'GFT-01',
    description: 'IronRidge Ground Foot (Flush)',
    category: 'racking', unit: 'ea',
    listPrice: 22.00, netPrice: 17.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SNR-100-RAIL',
    description: 'SnapNrack Series 100 Roof Rail',
    category: 'racking', unit: 'ea',
    listPrice: 58.00, netPrice: 46.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'SNR-UL-01',
    description: 'SnapNrack UL-Listed L-Foot Attachment',
    category: 'racking', unit: 'ea',
    listPrice: 12.50, netPrice: 10.00,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'UR-SF-168',
    description: 'Unirac SolarFoot Roof Mount 168"',
    category: 'racking', unit: 'ea',
    listPrice: 65.00, netPrice: 52.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'UR-RM-BALLAST',
    description: 'Unirac Roof Mount Ballast Block Set',
    category: 'racking', unit: 'set',
    listPrice: 145.00, netPrice: 116.00,
    source: 'Soligent', asOf: '2025-01-15',
  },
  {
    partNumber: 'QM-CLASSIC-1',
    description: 'QuickMount Classic Composition Flashing',
    category: 'racking', unit: 'ea',
    listPrice: 24.00, netPrice: 19.20,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'QM-TILE-1',
    description: 'QuickMount Tile Replacement Mount',
    category: 'racking', unit: 'ea',
    listPrice: 32.00, netPrice: 25.60,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'EF-ROCKIT-01',
    description: 'EcoFasten RockIt Roof Mount',
    category: 'racking', unit: 'ea',
    listPrice: 19.00, netPrice: 15.20,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'S5-PVKIT2-01',
    description: 'S-5! PV Kit 2.0 Standing Seam Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 28.00, netPrice: 22.40,
    source: 'CED', asOf: '2025-01-15',
  },
  {
    partNumber: 'S5-CORR-01',
    description: 'S-5! CorruBracket Corrugated Roof Clamp',
    category: 'racking', unit: 'ea',
    listPrice: 14.00, netPrice: 11.20,
    source: 'CED', asOf: '2025-01-15',
  },
];

// ─── Category fallback pricing ────────────────────────────────────────────────
// Used when no exact part-number match is found in catalog or overrides.
// Unit should match what the BOM engine emits for that category.

export const CATEGORY_FALLBACK_PRICES: Record<string, { unitCost: number; unit: string; source: DistributorSource }> = {
  // Equipment
  solar_panel:       { unitCost: 0.34 * 400,  unit: 'ea',   source: 'CED' },      // ~$136/panel at 400W avg
  microinverter:     { unitCost: 160.00,        unit: 'ea',   source: 'CED' },
  string_inverter:   { unitCost: 1500.00,       unit: 'ea',   source: 'CED' },
  hybrid_inverter:   { unitCost: 2400.00,       unit: 'ea',   source: 'Soligent' },
  optimizer:         { unitCost: 52.00,         unit: 'ea',   source: 'CED' },
  battery:           { unitCost: 4200.00,       unit: 'ea',   source: 'Soligent' },
  // Racking
  racking:           { unitCost: 18.00,         unit: 'ea',   source: 'CED' },
  // Electrical BOS
  wire:              { unitCost: 0.85,          unit: 'ft',   source: 'KWh' },      // $/ft — #10 AWG THWN avg
  trunk_cable:       { unitCost: 2.40,          unit: 'ft',   source: 'Soligent' },
  conduit:           { unitCost: 0.75,          unit: 'ft',   source: 'KWh' },      // 3/4" EMT avg
  breaker:           { unitCost: 24.00,         unit: 'ea',   source: 'KWh' },
  disconnect:        { unitCost: 185.00,        unit: 'ea',   source: 'KWh' },
  rapid_shutdown:    { unitCost: 95.00,         unit: 'ea',   source: 'CED' },
  combiner:          { unitCost: 145.00,        unit: 'ea',   source: 'CED' },
  junction_box:      { unitCost: 18.00,         unit: 'ea',   source: 'KWh' },
  meter:             { unitCost: 320.00,        unit: 'ea',   source: 'KWh' },
  // Monitoring
  gateway:           { unitCost: 175.00,        unit: 'ea',   source: 'CED' },
  monitoring:        { unitCost: 95.00,         unit: 'ea',   source: 'CED' },
  // Structural (fence/ground)
  post:              { unitCost: 95.00,         unit: 'ea',   source: 'Internal' },
  rail:              { unitCost: 55.00,         unit: 'ea',   source: 'Internal' },
  clamp:             { unitCost: 8.50,          unit: 'ea',   source: 'Internal' },
  footer:            { unitCost: 45.00,         unit: 'ea',   source: 'Internal' },
  hardware:          { unitCost: 2.50,          unit: 'ea',   source: 'Internal' },
  panel_frame:       { unitCost: 85.00,         unit: 'ea',   source: 'Internal' },
  // Labels
  label:             { unitCost: 4.50,          unit: 'ea',   source: 'KWh' },
  // Misc
  terminator:        { unitCost: 3.50,          unit: 'ea',   source: 'Soligent' },
};

// ─── Panel wattage inference for $/W → $/panel conversion ─────────────────────
// Part numbers that use $/W pricing need wattage to compute per-panel dollar cost.
const PANEL_WATTAGE_BY_PART: Record<string, number> = {
  'Q.PEAK DUO BLK ML-G10+400': 400,
  'REC405AA-PURE-R':            405,
  'SIL-380-BK':                 380,
  'PS-MNB108-HCBF-440W':       440,
};

function isPerWattPricing(entry: DistributorPriceEntry): boolean {
  return entry.category === 'solar_panel';
}

function resolveNetPrice(entry: DistributorPriceEntry): number {
  if (isPerWattPricing(entry)) {
    const watts = PANEL_WATTAGE_BY_PART[entry.partNumber] ?? 400;
    return Math.round(entry.netPrice * watts * 100) / 100;
  }
  return entry.netPrice;
}

// ─── Build lookup maps (lazy, built once) ─────────────────────────────────────

let _catalogByPartNumber: Map<string, DistributorPriceEntry> | null = null;

function getCatalogByPartNumber(): Map<string, DistributorPriceEntry> {
  if (!_catalogByPartNumber) {
    _catalogByPartNumber = new Map();
    for (const entry of DISTRIBUTOR_PRICE_CATALOG) {
      _catalogByPartNumber.set(entry.partNumber.toUpperCase(), entry);
    }
  }
  return _catalogByPartNumber;
}

// ─── Core pricing resolution ──────────────────────────────────────────────────

function resolvePriceForItem(
  item: BOMLineItemV4,
  overrideMap: Map<string, number>,
  overrideCategoryMap: Map<string, number>,
): { unitCost: number; source: 'override' | 'catalog' | 'fallback' | 'none' } {
  const partUpper = (item.partNumber ?? '').toUpperCase();

  // 1. Exact part-number override (highest priority)
  if (partUpper && overrideMap.has(partUpper)) {
    return { unitCost: overrideMap.get(partUpper)!, source: 'override' };
  }

  // 2. Category-level override
  if (overrideCategoryMap.has(item.category)) {
    return { unitCost: overrideCategoryMap.get(item.category)!, source: 'override' };
  }

  // 3. Static catalog — exact part number
  if (partUpper) {
    const catalog = getCatalogByPartNumber();
    const entry = catalog.get(partUpper);
    if (entry) {
      return { unitCost: resolveNetPrice(entry), source: 'catalog' };
    }
  }

  // 4. Category fallback
  const fallback = CATEGORY_FALLBACK_PRICES[item.category];
  if (fallback) {
    return { unitCost: fallback.unitCost, source: 'fallback' };
  }

  return { unitCost: 0, source: 'none' };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Stamps `unitCost` and `totalCost` onto every BOM line item.
 *
 * Resolution order:
 *   DB/admin overrides → static catalog → category fallback → zero (unpriced)
 *
 * @param items     BOM line items from the V4 engine (or merged result).
 * @param overrides Optional array of DB-sourced price overrides (from
 *                  `distributor_prices` table, fetched by the calling route).
 *                  When undefined/empty, only catalog + category defaults apply.
 */
export function applyDistributorPricing(
  items: BOMLineItemV4[],
  overrides: DistributorPriceOverride[] = [],
): PricingApplyResult {
  // Build override lookup maps
  const overrideMap = new Map<string, number>();
  const overrideCategoryMap = new Map<string, number>();
  for (const o of overrides) {
    if (o.partNumber === '*') {
      if (o.category) overrideCategoryMap.set(o.category, o.unitCost);
    } else {
      overrideMap.set(o.partNumber.toUpperCase(), o.unitCost);
    }
  }

  let catalogMatches = 0;
  let overrideMatches = 0;
  let fallbackMatches = 0;
  let unpriced = 0;
  let totalBomCost = 0;

  const pricedItems: BOMLineItemV4[] = items.map(item => {
    // Skip items already priced (e.g. if called twice)
    if (item.unitCost !== undefined && item.unitCost > 0) {
      totalBomCost += item.totalCost ?? item.unitCost * item.quantity;
      catalogMatches++;
      return item;
    }

    const { unitCost, source } = resolvePriceForItem(item, overrideMap, overrideCategoryMap);
    const totalCost = Math.round(unitCost * item.quantity * 100) / 100;

    if (source === 'override')  overrideMatches++;
    else if (source === 'catalog')  catalogMatches++;
    else if (source === 'fallback') fallbackMatches++;
    else                            unpriced++;

    if (unitCost > 0) totalBomCost += totalCost;

    return {
      ...item,
      unitCost:  unitCost  > 0 ? Math.round(unitCost  * 100) / 100 : undefined,
      totalCost: totalCost > 0 ? totalCost                          : undefined,
    };
  });

  totalBomCost = Math.round(totalBomCost * 100) / 100;

  return {
    items: pricedItems,
    catalogMatches,
    overrideMatches,
    fallbackMatches,
    unpriced,
    totalBomCost,
  };
}

// ─── Convenience: resolve single-item price (used in admin price preview) ─────

/**
 * Returns the effective unit cost for a given part number + category,
 * applying the same resolution order as applyDistributorPricing.
 */
export function resolveUnitCost(
  partNumber: string,
  category: string,
  overrides: DistributorPriceOverride[] = [],
): number {
  const fakeItem: BOMLineItemV4 = {
    id: 'preview',
    stageId: 'array',
    stageLabel: '',
    category,
    manufacturer: '',
    model: '',
    partNumber,
    description: '',
    quantity: 1,
    unit: 'ea',
    derivedFrom: '',
    required: false,
  };
  const overrideMap = new Map<string, number>();
  const overrideCategoryMap = new Map<string, number>();
  for (const o of overrides) {
    if (o.partNumber === '*') {
      if (o.category) overrideCategoryMap.set(o.category, o.unitCost);
    } else {
      overrideMap.set(o.partNumber.toUpperCase(), o.unitCost);
    }
  }
  return resolvePriceForItem(fakeItem, overrideMap, overrideCategoryMap).unitCost;
}

// ─── Summary helpers ──────────────────────────────────────────────────────────

/**
 * Computes a cost breakdown by BOM stage (for proposal + engineering UI display).
 */
export function bomCostByStage(items: BOMLineItemV4[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    if (!item.totalCost) continue;
    result[item.stageId] = Math.round(((result[item.stageId] ?? 0) + item.totalCost) * 100) / 100;
  }
  return result;
}

/**
 * Computes a cost breakdown by category (for detailed cost analysis).
 */
export function bomCostByCategory(items: BOMLineItemV4[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    if (!item.totalCost) continue;
    result[item.category] = Math.round(((result[item.category] ?? 0) + item.totalCost) * 100) / 100;
  }
  return result;
}