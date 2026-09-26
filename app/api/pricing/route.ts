export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getPricingConfig, upsertPricingConfig, handleRouteDbError, getDbReady } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
// v47.342: Admin guard removed — pricing accessible to all authenticated users
// import { requireAdminApi } from '@/lib/adminAuth';

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
  // §25D repealed by P.L. 119-21. `isItcEnabled()` is the authority; this
  // fallback must not contradict it. Commercial §48E above is live.
  itcRateResidential:   0,
};

// ── SECURITY: this route is in middleware's PUBLIC_PATHS, and must stay there ──
// `app/proposals/view/[id]/page.tsx:178` fetches it from the HOMEOWNER share link,
// which has no session — it is reached by share token. Requiring auth here would
// make that fetch 401, and because the caller ends in `.catch(() => {})` the page
// would silently fall through to hardcoded defaults and quote the customer a
// different price. So the path stays public and the PAYLOAD is narrowed instead.
//
// What the share view actually reads off this config: `isCommercial`, the four
// per-system-type sell prices, `pricePerWatt`, `loanApr`, `loanTermYears`. It never
// reads a cost or a margin. Everything else in the config is the installer's
// internal cost structure, and "anyone on the internet can GET /api/pricing and
// read the labor cost, overhead percent and profit margin" is the finding.
const PUBLIC_PRICING_FIELDS = [
  'id',
  'pricingMode',
  'pricePerWatt',
  'roofPricePerWatt',
  'groundPricePerWatt',
  'fencePricePerWatt',
  'carportPricePerWatt',
  'roofPricePerPanel',
  'groundPricePerPanel',
  'fencePricePerPanel',
  'defaultPanelWattage',
  'utilityEscalation',
  'systemLife',
  'isCommercial',
  'itcRateCommercial',
  'itcRateResidential',
  'taxCreditRate',
  'loanApr',
  'loanTermYears',
  'purchaseMode',
  'updatedAt',
] as const;

/**
 * Strip the installer's cost structure and margins from a config destined for an
 * unauthenticated caller. Allowlist, not denylist: a field added to the config
 * later is withheld by default rather than published by default.
 */
function toPublicPricing(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_PRICING_FIELDS) {
    if (key in config) out[key] = config[key];
  }
  return out;
}

/**
 * GET /api/pricing
 * Returns the active pricing configuration.
 * Authenticated callers get the full config; unauthenticated callers (the
 * homeowner share view) get the customer-facing sell prices only.
 * Falls back to defaults if DB table not yet created.
 */
export async function GET(req: NextRequest) {
  // Cheap signature-only session check — no DB hit. We are deciding whether to
  // include costs and margins, for which a validly signed session is sufficient;
  // WRITES are separately gated on requireAdminApi below.
  const { getUserFromRequest } = await import('@/lib/auth');
  const viewer = getUserFromRequest(req);

  const project = (config: Record<string, unknown>) =>
    viewer ? config : toPublicPricing(config);

  try {
    const config = await getPricingConfig();
    const resolved = (config ?? { id: 'default', ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() }) as Record<string, unknown>;
    return NextResponse.json({ success: true, data: project(resolved) });
  } catch (err) {
    console.error('[GET /api/pricing]', err);
    // The fallback carries the same labor/overhead/margin defaults, so it needs
    // the same projection — an error path must not become the leak.
    return NextResponse.json({
      success: true,
      data: project({ id: 'default', ...DEFAULT_CONFIG, updatedAt: new Date().toISOString() }),
    });
  }
}

/**
 * POST /api/pricing
 * Upserts the pricing configuration (single active row).
 */
export async function POST(req: NextRequest) {
  // SECURITY: BUG-22-07 FIX — Pricing config is global and shared across all users.
  // Only admins should be able to modify it. Require admin role.
  const { requireAdminApi } = await import('@/lib/adminAuth');
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: 'Admin role required to modify pricing configuration.' }, { status: 403 });
  }

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  try {
    const body = await req.json();

    // Ensure all new columns exist (idempotent migration)
    const sql = await getDbReady();

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
        -- §25D repealed. This DEFAULT only affects databases created from here
        -- on; existing rows keep whatever they were born with, which is why the
        -- READ path gates on isItcEnabled() rather than trusting the column.
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
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/pricing]', err);
  }
}