import { NextRequest, NextResponse } from 'next/server';
import { getPricingConfig, upsertPricingConfig } from '@/lib/db-neon';

// Default fallback config (used when DB table not yet migrated)
const DEFAULT_CONFIG = {
  pricingMode:          'per_panel',
  pricePerWatt:         3.10,
  laborCostPerWatt:     0.75,
  equipmentCostPerWatt: 0.55,
  fixedCost:            2000,
  profitMargin:         40,
  taxCreditRate:        0,
  utilityEscalation:    3,
  systemLife:           25,
  roofPricePerWatt:     3.10,
  groundPricePerWatt:   2.35,
  fencePricePerWatt:    4.25,
  carportPricePerWatt:  3.75,
  // Per-panel pricing
  roofPricePerPanel:    1364,
  groundPricePerPanel:  1034,
  fencePricePerPanel:   1870,
  defaultPanelWattage:  440,
  // Cost-plus pricing
  materialCostPerPanel: 350,
  laborCostPerPanel:    200,
  overheadPercent:      15,
  marginPercent:        25,
  // ITC
  isCommercial:         false,
  itcRateCommercial:    30,
  itcRateResidential:   0,
};

/**
 * GET /api/pricing
 * Returns the active pricing configuration.
 * Falls back to defaults if DB table not yet created.
 */
export async function GET(_req: NextRequest) {
  try {
    const config = await getPricingConfig();
    return NextResponse.json({
      success: true,
      data: config ?? { id: 'default', ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error('[GET /api/pricing]', err);
    return NextResponse.json({
      success: true,
      data: { id: 'default', ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() },
    });
  }
}

/**
 * POST /api/pricing
 * Upserts the pricing configuration (single active row).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Ensure all new columns exist (idempotent migration)
    const { getDb } = await import('@/lib/db-neon');
    const sql = getDb();

    // Create table if not exists (with all columns)
    await sql`
      CREATE TABLE IF NOT EXISTS pricing_config (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pricing_mode            TEXT             NOT NULL DEFAULT 'per_panel',
        price_per_watt          DOUBLE PRECISION NOT NULL DEFAULT 3.10,
        labor_cost_per_watt     DOUBLE PRECISION NOT NULL DEFAULT 0.75,
        equipment_cost_per_watt DOUBLE PRECISION NOT NULL DEFAULT 0.55,
        fixed_cost              DOUBLE PRECISION NOT NULL DEFAULT 2000,
        profit_margin           DOUBLE PRECISION NOT NULL DEFAULT 40,
        tax_credit_rate         DOUBLE PRECISION NOT NULL DEFAULT 0,
        utility_escalation      DOUBLE PRECISION NOT NULL DEFAULT 3,
        system_life             INTEGER          NOT NULL DEFAULT 25,
        roof_price_per_watt     DOUBLE PRECISION,
        ground_price_per_watt   DOUBLE PRECISION,
        fence_price_per_watt    DOUBLE PRECISION,
        carport_price_per_watt  DOUBLE PRECISION,
        roof_price_per_panel    DOUBLE PRECISION,
        ground_price_per_panel  DOUBLE PRECISION,
        fence_price_per_panel   DOUBLE PRECISION,
        default_panel_wattage   DOUBLE PRECISION NOT NULL DEFAULT 440,
        material_cost_per_panel DOUBLE PRECISION NOT NULL DEFAULT 350,
        labor_cost_per_panel    DOUBLE PRECISION NOT NULL DEFAULT 200,
        overhead_percent        DOUBLE PRECISION NOT NULL DEFAULT 15,
        margin_percent          DOUBLE PRECISION NOT NULL DEFAULT 25,
        is_commercial           BOOLEAN          NOT NULL DEFAULT false,
        itc_rate_commercial     DOUBLE PRECISION NOT NULL DEFAULT 30,
        itc_rate_residential    DOUBLE PRECISION NOT NULL DEFAULT 0,
        updated_at              TIMESTAMPTZ      NOT NULL DEFAULT NOW()
      )
    `;

    const n = (v: unknown) => typeof v === 'number' ? v : undefined;
    const b = (v: unknown) => typeof v === 'boolean' ? v : undefined;
    const s = (v: unknown) => typeof v === 'string' ? v : undefined;

    const config = await upsertPricingConfig({
      pricingMode:          s(body.pricingMode) as 'per_panel' | 'per_watt' | 'cost_plus' | undefined,
      pricePerWatt:         n(body.pricePerWatt),
      laborCostPerWatt:     n(body.laborCostPerWatt),
      equipmentCostPerWatt: n(body.equipmentCostPerWatt),
      fixedCost:            n(body.fixedCost),
      profitMargin:         n(body.profitMargin),
      utilityEscalation:    n(body.utilityEscalation),
      systemLife:           n(body.systemLife),
      roofPricePerWatt:     n(body.roofPricePerWatt),
      groundPricePerWatt:   n(body.groundPricePerWatt),
      fencePricePerWatt:    n(body.fencePricePerWatt),
      carportPricePerWatt:  n(body.carportPricePerWatt),
      roofPricePerPanel:    n(body.roofPricePerPanel),
      groundPricePerPanel:  n(body.groundPricePerPanel),
      fencePricePerPanel:   n(body.fencePricePerPanel),
      defaultPanelWattage:  n(body.defaultPanelWattage),
      materialCostPerPanel: n(body.materialCostPerPanel),
      laborCostPerPanel:    n(body.laborCostPerPanel),
      overheadPercent:      n(body.overheadPercent),
      marginPercent:        n(body.marginPercent),
      isCommercial:         b(body.isCommercial),
      itcRateCommercial:    n(body.itcRateCommercial),
      itcRateResidential:   n(body.itcRateResidential),
    });

    return NextResponse.json({ success: true, data: config });
  } catch (err) {
    console.error('[POST /api/pricing]', err);
    const message = err instanceof Error ? err.message : 'Failed to save pricing config';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}