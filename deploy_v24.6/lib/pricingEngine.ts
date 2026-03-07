// ============================================================
// PRICING ENGINE — Single Source of Truth
//
// Calculates system price using two methods, returns the higher:
//   1. Price-per-watt method  (market rate × system size)
//   2. Cost-plus-margin method (material + labor + overhead + margin)
//
// Config is loaded from the pricing_config DB table (set in Admin → Pricing).
// Falls back to companyPricing.ts constants if DB is unavailable.
// ============================================================

import { companyPricing, toSystemTypeKey, type SystemTypeKey } from './companyPricing';
import type { Client } from '@/types';

// ─── Public result types ──────────────────────────────────────────────────────

export interface PricingResult {
  // Customer-facing
  cashPrice: number;            // Final price shown to customer
  pricePerWatt: number;         // $/W shown to customer
  costAfterIncentives: number;  // cashPrice minus ITC
  itcAmount: number;            // Federal ITC dollar amount
  itcPercent: number;           // ITC rate used

  // Internal (not shown to customer)
  revenue: number;              // = cashPrice
  estimatedCost: number;        // material + labor + overhead + fixed
  grossProfit: number;          // revenue - estimatedCost
  marginPercent: number;        // grossProfit / revenue * 100

  // Breakdown
  pricePerWattMethod: number;   // price from $/W × watts
  costPlusMethod: number;       // price from cost + margin
  methodUsed: 'price_per_watt' | 'cost_plus';

  // Savings
  annualSavings: number;
  paybackYears: number;
  lifetimeSavings: number;
  roi: number;

  // Raw inputs
  systemSizeKw: number;
  systemType: SystemTypeKey;
}

export interface SalesOverride {
  pricePerWatt?: number;    // Override $/W rate
  marginPercent?: number;   // Override margin %
  finalPrice?: number;      // Hard override final price
}

// ─── Resolved config shape (from DB or fallback) ─────────────────────────────

export type PricingMode = 'per_panel' | 'per_watt' | 'cost_plus';

export interface ResolvedPricingConfig {
  // Pricing mode
  pricingMode: PricingMode;
  // Per-watt pricing
  pricePerWatt: number;
  laborCostPerWatt: number;
  equipmentCostPerWatt: number;
  fixedCost: number;
  profitMargin: number;       // as a percentage (e.g. 40 = 40%)
  taxCreditRate: number;      // as a percentage (e.g. 30 = 30%) -- legacy field
  utilityEscalation: number;  // % per year
  systemLife: number;         // years
  // Per-system-type $/W overrides
  roofPricePerWatt: number;
  groundPricePerWatt: number;
  fencePricePerWatt: number;
  carportPricePerWatt: number;
  // Per-panel pricing
  roofPricePerPanel: number;
  groundPricePerPanel: number;
  fencePricePerPanel: number;
  defaultPanelWattage: number;
  // Cost-plus pricing
  materialCostPerPanel: number;
  laborCostPerPanel: number;
  overheadPercent: number;
  marginPercent: number;
  // ITC (split commercial vs residential)
  isCommercial: boolean;
  itcRateCommercial: number;   // e.g. 30
  itcRateResidential: number;  // e.g. 0
}

// Itemized line item for a single installation type
export interface PricingLineItem {
  type: 'roof' | 'ground' | 'fence' | 'carport';
  label: string;
  panelCount: number;
  pricePerPanel: number;
  subtotal: number;
}

// ─── Default fallback (matches companyPricing.ts) ────────────────────────────

const DEFAULT_CONFIG: ResolvedPricingConfig = {
  pricingMode:          'per_panel',
  pricePerWatt:         companyPricing.residentialPricePerWatt,
  laborCostPerWatt:     companyPricing.laborCostPerWatt,
  equipmentCostPerWatt: companyPricing.equipmentCostPerWatt.ROOF_MOUNT,
  fixedCost:            companyPricing.fixedCosts,
  profitMargin:         companyPricing.defaultMarginPercent * 100,
  taxCreditRate:        0,  // legacy — use itcRateCommercial/itcRateResidential
  utilityEscalation:    companyPricing.utilityEscalationRate,
  systemLife:           companyPricing.systemLifeYears,
  roofPricePerWatt:     companyPricing.residentialPricePerWatt,
  groundPricePerWatt:   companyPricing.commercialPricePerWatt,
  fencePricePerWatt:    companyPricing.solFencePricePerWatt,
  carportPricePerWatt:  companyPricing.carportPricePerWatt,
  // Per-panel defaults (440W panel × $/W rate)
  roofPricePerPanel:    Math.round(companyPricing.residentialPricePerWatt * 440),
  groundPricePerPanel:  Math.round(companyPricing.commercialPricePerWatt * 440),
  fencePricePerPanel:   Math.round(companyPricing.solFencePricePerWatt * 440),
  defaultPanelWattage:  440,
  // Cost-plus defaults
  materialCostPerPanel: 350,
  laborCostPerPanel:    200,
  overheadPercent:      15,
  marginPercent:        25,
  // ITC
  isCommercial:         false,
  itcRateCommercial:    30,
  itcRateResidential:   0,
};

// ─── Fetch config from DB (server-side only) ─────────────────────────────────

/**
 * Load pricing config from Neon DB.
 * Returns DEFAULT_CONFIG if DB is unavailable or table not yet created.
 * This is called server-side only (API routes, not client components).
 */
export async function loadPricingConfig(): Promise<ResolvedPricingConfig> {
  try {
    const { getPricingConfig } = await import('./db-neon');
    const row = await getPricingConfig();
    if (!row) return DEFAULT_CONFIG;

    const wattage = row.defaultPanelWattage ?? 440;
    return {
      pricingMode:          row.pricingMode          ?? 'per_panel',
      pricePerWatt:         row.pricePerWatt,
      laborCostPerWatt:     row.laborCostPerWatt,
      equipmentCostPerWatt: row.equipmentCostPerWatt,
      fixedCost:            row.fixedCost,
      profitMargin:         row.profitMargin,
      taxCreditRate:        0,
      utilityEscalation:    row.utilityEscalation,
      systemLife:           row.systemLife,
      roofPricePerWatt:     row.roofPricePerWatt    ?? row.pricePerWatt,
      groundPricePerWatt:   row.groundPricePerWatt  ?? row.pricePerWatt,
      fencePricePerWatt:    row.fencePricePerWatt   ?? row.pricePerWatt,
      carportPricePerWatt:  row.carportPricePerWatt ?? row.pricePerWatt,
      roofPricePerPanel:    row.roofPricePerPanel   ?? Math.round((row.roofPricePerWatt   ?? row.pricePerWatt) * wattage),
      groundPricePerPanel:  row.groundPricePerPanel ?? Math.round((row.groundPricePerWatt ?? row.pricePerWatt) * wattage),
      fencePricePerPanel:   row.fencePricePerPanel  ?? Math.round((row.fencePricePerWatt  ?? row.pricePerWatt) * wattage),
      defaultPanelWattage:  wattage,
      materialCostPerPanel: row.materialCostPerPanel ?? 350,
      laborCostPerPanel:    row.laborCostPerPanel    ?? 200,
      overheadPercent:      row.overheadPercent      ?? 15,
      marginPercent:        row.marginPercent        ?? 25,
      isCommercial:         row.isCommercial         ?? false,
      itcRateCommercial:    row.itcRateCommercial    ?? 30,
      itcRateResidential:   row.itcRateResidential   ?? 0,
    };
  } catch (err) {
    console.warn('[loadPricingConfig] falling back to defaults:', err);
    return DEFAULT_CONFIG;
  }
}

// ─── Per-system-type price per watt ──────────────────────────────────────────

function getPpwForType(cfg: ResolvedPricingConfig, typeKey: SystemTypeKey): number {
  const map: Record<SystemTypeKey, number> = {
    ROOF_MOUNT:   cfg.roofPricePerWatt,
    GROUND_MOUNT: cfg.groundPricePerWatt,
    SOL_FENCE:    cfg.fencePricePerWatt,
    CARPORT:      cfg.carportPricePerWatt,
  };
  return map[typeKey] ?? cfg.pricePerWatt;
}

// ─── Core calculation functions ───────────────────────────────────────────────

/**
 * Calculate price using the price-per-watt method.
 */
export function calculateSystemPrice(
  systemSizeKw: number,
  systemType: SystemTypeKey,
  cfg: ResolvedPricingConfig,
  overridePpw?: number
): number {
  const watts = systemSizeKw * 1000;
  const ppw = overridePpw ?? getPpwForType(cfg, systemType);
  return Math.round(watts * ppw);
}

/**
 * Calculate total system cost (material + labor + overhead + fixed).
 */
export function calculateSystemCost(
  systemSizeKw: number,
  cfg: ResolvedPricingConfig
): number {
  const watts = systemSizeKw * 1000;
  const materialCost = Math.round(watts * cfg.equipmentCostPerWatt);
  const laborCost    = Math.round(watts * cfg.laborCostPerWatt);
  const overhead     = Math.round((materialCost + laborCost) * companyPricing.overheadPercent);
  return materialCost + laborCost + overhead + cfg.fixedCost;
}

/**
 * Calculate price using cost-plus-margin method.
 */
export function calculateCostBasedPrice(
  systemSizeKw: number,
  cfg: ResolvedPricingConfig,
  overrideMargin?: number
): number {
  const totalCost = calculateSystemCost(systemSizeKw, cfg);
  const marginPct = overrideMargin ?? cfg.profitMargin;
  // price = cost / (1 - margin%)
  const price = totalCost / (1 - marginPct / 100);
  return Math.round(price);
}

/**
 * Calculate profit margin given a price and cost.
 */
export function calculateProfitMargin(price: number, cost: number): number {
  if (price <= 0) return 0;
  return parseFloat(((price - cost) / price * 100).toFixed(1));
}


// ─── Itemized pricing by panel type ──────────────────────────────────────────

/**
 * Calculate itemized price breakdown from a list of placed panels.
 * Groups panels by systemType, applies per-panel price for each type.
 * PRIMARY pricing method: price per panel × count per type + fixed cost.
 */
export function calculateItemizedPrice(
  panels: Array<{ systemType?: string; wattage?: number }>,
  layoutSystemType: string,
  cfg: ResolvedPricingConfig
): {
  lineItems: PricingLineItem[];
  subtotalBeforeFixed: number;
  totalCashPrice: number;
  totalPanels: number;
} {
  const counts: Record<string, number> = {};
  const wattages: Record<string, number> = {};
  for (const p of panels) {
    const t = (p.systemType || layoutSystemType || 'roof').toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
    wattages[t] = (wattages[t] || 0) + (p.wattage || cfg.defaultPanelWattage || 440);
  }

  const TYPE_LABELS: Record<string, string> = {
    roof:    'Roof-Mounted Solar',
    ground:  'Ground-Mounted Solar',
    fence:   'Sol Fence (Vertical)',
    carport: 'Solar Carport',
  };

  // Compute effective price-per-panel based on pricingMode
  const getPricePerPanel = (type: string, count: number, totalWatts: number): number => {
    switch (cfg.pricingMode) {
      case 'per_watt': {
        // $/W × total watts for this type, divided by panel count
        const ppw = type === 'ground'  ? cfg.groundPricePerWatt
                  : type === 'fence'   ? cfg.fencePricePerWatt
                  : type === 'carport' ? cfg.carportPricePerWatt
                  :                      cfg.roofPricePerWatt;
        return count > 0 ? Math.round((ppw * totalWatts) / count) : 0;
      }
      case 'cost_plus': {
        const matCost  = cfg.materialCostPerPanel;
        const labCost  = cfg.laborCostPerPanel;
        const overhead = (matCost + labCost) * (cfg.overheadPercent / 100);
        const total    = matCost + labCost + overhead;
        const mPct     = cfg.marginPercent;
        return Math.round(total / (1 - mPct / 100));
      }
      case 'per_panel':
      default:
        switch (type) {
          case 'ground':  return cfg.groundPricePerPanel;
          case 'fence':   return cfg.fencePricePerPanel;
          case 'carport': return Math.round(cfg.carportPricePerWatt * cfg.defaultPanelWattage);
          default:        return cfg.roofPricePerPanel;
        }
    }
  };

  const lineItems: PricingLineItem[] = Object.entries(counts).map(([type, count]) => {
    const totalWatts  = wattages[type] || count * (cfg.defaultPanelWattage || 440);
    const pricePerPanel = getPricePerPanel(type, count, totalWatts);
    return {
      type: type as PricingLineItem['type'],
      label: TYPE_LABELS[type] || type,
      panelCount: count,
      pricePerPanel,
      subtotal: count * pricePerPanel,
    };
  });

  const subtotalBeforeFixed = lineItems.reduce((sum, li) => sum + li.subtotal, 0);
  const totalCashPrice = subtotalBeforeFixed + cfg.fixedCost;
  const totalPanels = panels.length;

  return { lineItems, subtotalBeforeFixed, totalCashPrice, totalPanels };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Calculate final system price — returns the HIGHER of price-per-watt or cost-plus.
 * Uses the provided config (loaded from DB via loadPricingConfig()).
 *
 * @param systemSizeKw        - System size in kilowatts
 * @param systemType          - System type string (roof/ground/fence/carport)
 * @param annualProductionKwh - Annual kWh production (for savings calc)
 * @param client              - Client data (for utility rate, annual usage)
 * @param salesOverride       - Optional sales rep overrides
 * @param cfg                 - Pricing config (from loadPricingConfig() or DEFAULT_CONFIG)
 */
export function calculateFinalPrice(
  systemSizeKw: number,
  systemType: string,
  annualProductionKwh: number,
  client: Client,
  salesOverride?: SalesOverride,
  cfg: ResolvedPricingConfig = DEFAULT_CONFIG
): PricingResult {
  const typeKey = toSystemTypeKey(systemType);
  const watts = systemSizeKw * 1000;

  // Material and labor costs (used for cost-plus and internal margin calc)
  const materialCost  = Math.round(watts * cfg.equipmentCostPerWatt);
  const laborCost     = Math.round(watts * cfg.laborCostPerWatt);
  const overhead      = Math.round((materialCost + laborCost) * companyPricing.overheadPercent);
  const estimatedCost = materialCost + laborCost + overhead + cfg.fixedCost;

  // Method 1: Price per watt
  const pricePerWattMethod = calculateSystemPrice(systemSizeKw, typeKey, cfg, salesOverride?.pricePerWatt);

  // Method 2: Cost plus margin (legacy watt-based)
  const marginPct      = salesOverride?.marginPercent ?? cfg.profitMargin;
  const costPlusMethod = calculateCostBasedPrice(systemSizeKw, cfg, marginPct);

  // Final price: determined by pricingMode (or hard override)
  let cashPrice: number;
  let methodUsed: 'price_per_watt' | 'cost_plus';

  if (salesOverride?.finalPrice && salesOverride.finalPrice > 0) {
    cashPrice  = salesOverride.finalPrice;
    methodUsed = pricePerWattMethod >= costPlusMethod ? 'price_per_watt' : 'cost_plus';
  } else {
    switch (cfg.pricingMode) {
      case 'per_watt':
        cashPrice  = pricePerWattMethod;
        methodUsed = 'price_per_watt';
        break;
      case 'cost_plus': {
        const panelCount = Math.round(watts / (cfg.defaultPanelWattage || 440));
        const matCost    = panelCount * cfg.materialCostPerPanel;
        const labCost    = panelCount * cfg.laborCostPerPanel;
        const ovhd       = Math.round((matCost + labCost) * (cfg.overheadPercent / 100));
        const totalCost  = matCost + labCost + ovhd + cfg.fixedCost;
        const mPct       = salesOverride?.marginPercent ?? cfg.marginPercent;
        cashPrice  = Math.round(totalCost / (1 - mPct / 100));
        methodUsed = 'cost_plus';
        break;
      }
      case 'per_panel':
      default:
        // per_panel mode: calculateItemizedPrice() is the source of truth
        // but for calculateFinalPrice() we use pricePerWatt as approximation
        cashPrice  = pricePerWattMethod;
        methodUsed = 'price_per_watt';
        break;
    }
  }

  // ITC calculation: commercial vs residential
  const itcPercent          = cfg.isCommercial ? cfg.itcRateCommercial : cfg.itcRateResidential;
  const itcAmount           = Math.round(cashPrice * (itcPercent / 100));
  const costAfterIncentives = cashPrice - itcAmount;

  // ── Effective $/W ───────────────────────────────────────────────────────────
  const effectivePpw = watts > 0 ? parseFloat((cashPrice / watts).toFixed(2)) : 0;

  // ── Internal profit ─────────────────────────────────────────────────────────
  const grossProfit   = cashPrice - estimatedCost;
  const marginPercent = calculateProfitMargin(cashPrice, estimatedCost);

  // ── Savings & ROI ───────────────────────────────────────────────────────────
  const utilityRate   = client.utilityRate || 0.13;
  const annualSavings = Math.round(annualProductionKwh * utilityRate);

  let lifetimeSavings = 0;
  let rate = utilityRate;
  for (let y = 0; y < cfg.systemLife; y++) {
    lifetimeSavings += annualProductionKwh * rate;
    rate *= (1 + cfg.utilityEscalation / 100);
  }
  lifetimeSavings = Math.round(lifetimeSavings);

  const paybackYears = annualSavings > 0
    ? parseFloat((costAfterIncentives / annualSavings).toFixed(1))
    : 0;
  const roi = costAfterIncentives > 0
    ? parseFloat((((lifetimeSavings - costAfterIncentives) / costAfterIncentives) * 100).toFixed(1))
    : 0;

  return {
    // Customer-facing
    cashPrice,
    pricePerWatt:         effectivePpw,
    costAfterIncentives,
    itcAmount,
    itcPercent,

    // Internal
    revenue:        cashPrice,
    estimatedCost,
    grossProfit,
    marginPercent,

    // Breakdown
    pricePerWattMethod,
    costPlusMethod,
    methodUsed,

    // Savings
    annualSavings,
    paybackYears,
    lifetimeSavings,
    roi,

    // Raw inputs
    systemSizeKw,
    systemType: typeKey,
  };
}