/**
 * lib/db/pricing.ts
 * Pricing config DB operations — extracted from lib/db-neon.ts.
 *
 * Note: DbPricingConfig type is defined in lib/db/core.ts and re-exported
 * from lib/db-neon.ts. This module imports it from core.
 */

import { getDbReady } from './core';
import type { DbPricingConfig, PricingMode } from './core';
import { isItcEnabled } from '../incentivesConfig';

// ============================================================
// PRICING CONFIG — Single-row upsert pattern
// ============================================================

function rowToPricingConfig(row: Record<string, unknown>): DbPricingConfig {
  return {
    id:                   row.id as string,
    pricingMode:          (row.pricing_mode as PricingMode) || 'per_panel',
    // Per-watt
    pricePerWatt:         (row.price_per_watt as number) || 3.10,
    laborCostPerWatt:     (row.labor_cost_per_watt as number) || 0.75,
    equipmentCostPerWatt: (row.equipment_cost_per_watt as number) || 0.55,
    roofPricePerWatt:     (row.roof_price_per_watt as number | null) ?? null,
    groundPricePerWatt:   (row.ground_price_per_watt as number | null) ?? null,
    fencePricePerWatt:    (row.fence_price_per_watt as number | null) ?? null,
    carportPricePerWatt:  (row.carport_price_per_watt as number | null) ?? null,
    // Per-panel
    roofPricePerPanel:    (row.roof_price_per_panel as number | null) ?? null,
    groundPricePerPanel:  (row.ground_price_per_panel as number | null) ?? null,
    fencePricePerPanel:   (row.fence_price_per_panel as number | null) ?? null,
    defaultPanelWattage:  (row.default_panel_wattage as number) || 440,
    // Cost-plus
    materialCostPerPanel: (row.material_cost_per_panel as number) || 350,
    laborCostPerPanel:    (row.labor_cost_per_panel as number) || 200,
    overheadPercent:      (row.overhead_percent as number) || 15,
    marginPercent:        (row.margin_percent as number) || 25,
    // Shared
    fixedCost:            (row.fixed_cost as number) || 2000,
    profitMargin:         (row.profit_margin as number) || 40,
    utilityEscalation:    (row.utility_escalation as number) || 3,
    systemLife:           (row.system_life as number) || 25,
    // ITC
    isCommercial:         (row.is_commercial as boolean) || false,
    // §48E is LIVE at 30% through the safe-harbor deadline — this default is right.
    itcRateCommercial:    (row.itc_rate_commercial as number) ?? 30,
    /**
     * 🚨 RESIDENTIAL §25D IS REPEALED, AND THIS LINE WAS RE-ENABLING IT.
     *
     * It read `?? 30`. The column is nullable and no registered migration
     * creates it, so for most databases the row value is null and every
     * residential quote received a 30% federal credit that no longer exists —
     * persisted into `costEstimate.taxCredit`/`netCost` by
     * `app/api/production/route.ts` and shown to the customer as a payback year.
     *
     * The downstream guard could never fire: `lib/pricingEngine.ts` has
     * `row.itcRateResidential ?? 0`, but by then the value is 30, not null. A
     * defaulted-away null is the same defect class as a regex that cannot match
     * — the protection is present, reads correctly, and is unreachable.
     * `app/api/production/route.ts` even carries a comment stating the rate is
     * "0 after the P.L.119-21 repeal" while reading 30.
     *
     * `isItcEnabled()` is now the authority, so a rate can only survive when
     * §25D is actually allowed. That matters beyond the default: an admin
     * typing 30 into the pricing config must not be able to reinstate a
     * repealed credit, and before this it could.
     *
     * Commercial §48E is deliberately untouched — it is live, and zeroing it
     * would be the opposite error.
     */
    itcRateResidential:   isItcEnabled() ? ((row.itc_rate_residential as number) ?? 0) : 0,
    updatedAt:            row.updated_at as string,
  };
}

/**
 * Get the active pricing config row.
 * Returns null if the table doesn't exist yet (migration not run).
 */
export async function getPricingConfig(): Promise<DbPricingConfig | null> {
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM pricing_config ORDER BY updated_at DESC LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  } catch (err) {
    // Table may not exist yet — return null gracefully
    console.warn('[getPricingConfig] pricing_config table not ready:', err);
    return null;
  }
}

/**
 * Upsert pricing config — always keeps exactly one row.
 * If a row exists, updates it. If not, inserts one.
 */
export async function upsertPricingConfig(data: Partial<Omit<DbPricingConfig, 'id' | 'updatedAt'>>): Promise<DbPricingConfig> {
  const sql = await getDbReady();

  // Check if a row exists
  const existing = await sql`SELECT id FROM pricing_config LIMIT 1`;

  if (existing.length > 0) {
    const id = existing[0].id as string;
    const rows = await sql`
      UPDATE pricing_config SET
        pricing_mode             = COALESCE(${data.pricingMode ?? null}, pricing_mode),
        price_per_watt           = COALESCE(${data.pricePerWatt ?? null}, price_per_watt),
        labor_cost_per_watt      = COALESCE(${data.laborCostPerWatt ?? null}, labor_cost_per_watt),
        equipment_cost_per_watt  = COALESCE(${data.equipmentCostPerWatt ?? null}, equipment_cost_per_watt),
        fixed_cost               = COALESCE(${data.fixedCost ?? null}, fixed_cost),
        profit_margin            = COALESCE(${data.profitMargin ?? null}, profit_margin),
        utility_escalation       = COALESCE(${data.utilityEscalation ?? null}, utility_escalation),
        system_life              = COALESCE(${data.systemLife ?? null}, system_life),
        roof_price_per_watt      = COALESCE(${data.roofPricePerWatt ?? null}, roof_price_per_watt),
        ground_price_per_watt    = COALESCE(${data.groundPricePerWatt ?? null}, ground_price_per_watt),
        fence_price_per_watt     = COALESCE(${data.fencePricePerWatt ?? null}, fence_price_per_watt),
        carport_price_per_watt   = COALESCE(${data.carportPricePerWatt ?? null}, carport_price_per_watt),
        roof_price_per_panel     = COALESCE(${data.roofPricePerPanel ?? null}, roof_price_per_panel),
        ground_price_per_panel   = COALESCE(${data.groundPricePerPanel ?? null}, ground_price_per_panel),
        fence_price_per_panel    = COALESCE(${data.fencePricePerPanel ?? null}, fence_price_per_panel),
        default_panel_wattage    = COALESCE(${data.defaultPanelWattage ?? null}, default_panel_wattage),
        material_cost_per_panel  = COALESCE(${data.materialCostPerPanel ?? null}, material_cost_per_panel),
        labor_cost_per_panel     = COALESCE(${data.laborCostPerPanel ?? null}, labor_cost_per_panel),
        overhead_percent         = COALESCE(${data.overheadPercent ?? null}, overhead_percent),
        margin_percent           = COALESCE(${data.marginPercent ?? null}, margin_percent),
        is_commercial            = COALESCE(${data.isCommercial ?? null}, is_commercial),
        itc_rate_commercial      = COALESCE(${data.itcRateCommercial ?? null}, itc_rate_commercial),
        itc_rate_residential     = COALESCE(${data.itcRateResidential ?? null}, itc_rate_residential),
        updated_at               = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  } else {
    // Insert default row with provided values
    const rows = await sql`
      INSERT INTO pricing_config (
        pricing_mode,
        price_per_watt, labor_cost_per_watt, equipment_cost_per_watt,
        fixed_cost, profit_margin, utility_escalation, system_life,
        roof_price_per_watt, ground_price_per_watt, fence_price_per_watt, carport_price_per_watt,
        roof_price_per_panel, ground_price_per_panel, fence_price_per_panel, default_panel_wattage,
        material_cost_per_panel, labor_cost_per_panel, overhead_percent, margin_percent,
        is_commercial, itc_rate_commercial, itc_rate_residential
      ) VALUES (
        ${data.pricingMode ?? 'per_panel'},
        ${data.pricePerWatt ?? 3.10},
        ${data.laborCostPerWatt ?? 0.75},
        ${data.equipmentCostPerWatt ?? 0.55},
        ${data.fixedCost ?? 2000},
        ${data.profitMargin ?? 40},
        ${data.utilityEscalation ?? 3},
        ${data.systemLife ?? 25},
        ${data.roofPricePerWatt ?? 3.10},
        ${data.groundPricePerWatt ?? 2.35},
        ${data.fencePricePerWatt ?? 4.25},
        ${data.carportPricePerWatt ?? 3.75},
        ${data.roofPricePerPanel ?? 1364},
        ${data.groundPricePerPanel ?? 1034},
        ${data.fencePricePerPanel ?? 1870},
        ${data.defaultPanelWattage ?? 440},
        ${data.materialCostPerPanel ?? 350},
        ${data.laborCostPerPanel ?? 200},
        ${data.overheadPercent ?? 15},
        ${data.marginPercent ?? 25},
        ${data.isCommercial ?? false},
        ${data.itcRateCommercial ?? 30},
        -- Residential §25D is repealed; a new config row must not be born
        -- carrying a credit that no longer exists. Commercial §48E above is
        -- live and keeps its 30.
        ${data.itcRateResidential ?? 0}
      )
      RETURNING *
    `;
    return rowToPricingConfig(rows[0] as Record<string, unknown>);
  }
}
