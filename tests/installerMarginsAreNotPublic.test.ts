// ═══════════════════════════════════════════════════════════════════════════
// 🚨 P0 — ANYONE ON THE INTERNET COULD READ THE INSTALLER'S MARGIN
//
// `/api/pricing` is listed in middleware's PUBLIC_PATHS under the heading
// "Safe public endpoints". It returned the WHOLE `pricing_config` row, which
// carries `laborCostPerWatt`, `equipmentCostPerWatt`, `profitMargin`,
// `overheadPercent`, `marginPercent`, `materialCostPerPanel`, `laborCostPerPanel`
// and `fixedCost` — the installer's cost structure and margins, to an
// unauthenticated GET.
//
// 🚨 WHY THE PATH MUST STAY PUBLIC. `app/proposals/view/[id]/page.tsx:178`
// fetches it from the HOMEOWNER SHARE LINK, which has no session — it is reached
// by share token. Simply requiring auth would 401 that fetch, and because the
// caller ends in `.catch(() => {})` the page would silently fall through to
// hardcoded defaults and quote the customer a DIFFERENT PRICE than the installer
// configured. A privacy fix that changes a customer's quoted number is a worse
// bug than the one it closes. So the payload is narrowed instead of the path.
//
// What the share view genuinely reads: `isCommercial`, the four per-system-type
// sell prices, `pricePerWatt`, `loanApr`, `loanTermYears`. It never reads a cost
// or a margin. That is the line the allowlist draws.
//
// (Unrelated and NOT fixed here: `loanApr`/`loanTermYears` have no writer in the
// repo at all — a separate verified finding. This suite only governs who may SEE
// the fields, not whether their values are trustworthy.)
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = { value: null as null | { id: string; email: string } };
const dbConfig = { throws: false };

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => session.value),
}));

vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp:    vi.fn(() => '127.0.0.1'),
}));

// A config whose confidential fields are unmistakable sentinels, so a leak is
// visible as a value and not only as a key.
const STORED = {
  id: 'cfg-1',
  pricingMode: 'per_panel',
  pricePerWatt: 3.10,
  roofPricePerWatt: 3.10,
  groundPricePerWatt: 2.35,
  fencePricePerWatt: 4.25,
  carportPricePerWatt: 3.75,
  isCommercial: false,
  itcRateResidential: 0,
  loanApr: 7.99,
  loanTermYears: 25,
  // ── confidential ──
  laborCostPerWatt: 0.75,
  equipmentCostPerWatt: 0.55,
  profitMargin: 40,
  fixedCost: 2000,
  materialCostPerPanel: 350,
  laborCostPerPanel: 200,
  overheadPercent: 15,
  marginPercent: 25,
  updatedAt: '2026-09-26T00:00:00.000Z',
};

vi.mock('@/lib/db-neon', () => ({
  getPricingConfig: vi.fn(async () => {
    if (dbConfig.throws) throw new Error('relation "pricing_config" does not exist');
    return STORED;
  }),
  upsertPricingConfig: vi.fn(),
  getDbReady: vi.fn(),
  handleRouteDbError: vi.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'db' }), { status: 503 })),
}));

import { GET } from '@/app/api/pricing/route';

const CONFIDENTIAL = [
  'laborCostPerWatt',
  'equipmentCostPerWatt',
  'profitMargin',
  'fixedCost',
  'materialCostPerPanel',
  'laborCostPerPanel',
  'overheadPercent',
  'marginPercent',
] as const;

/** What the homeowner share view at app/proposals/view/[id]/page.tsx actually reads. */
const NEEDED_BY_THE_SHARE_VIEW = [
  'isCommercial',
  'pricePerWatt',
  'roofPricePerWatt',
  'groundPricePerWatt',
  'fencePricePerWatt',
  'carportPricePerWatt',
  'loanApr',
  'loanTermYears',
] as const;

const req = () => new Request('http://localhost/api/pricing') as never;

async function get() {
  const res = await GET(req());
  return (await res.json()).data as Record<string, unknown>;
}

describe('🚨 an unauthenticated GET /api/pricing cannot read costs or margins', () => {
  beforeEach(() => { session.value = null; dbConfig.throws = false; });

  it('withholds every confidential field from an anonymous caller', async () => {
    const data = await get();
    for (const key of CONFIDENTIAL) {
      expect(data, `${key} was published to an unauthenticated caller`).not.toHaveProperty(key);
    }
  });

  it('still serves everything the homeowner share view needs', async () => {
    const data = await get();
    for (const key of NEEDED_BY_THE_SHARE_VIEW) {
      expect(data, `the share view reads ${key} and it is no longer served`).toHaveProperty(key);
    }
    // The sell price must be the CONFIGURED one, not a fallback default — a
    // privacy fix that changes the customer's quoted number is a worse bug.
    expect(data.roofPricePerWatt).toBe(3.10);
    expect(data.groundPricePerWatt).toBe(2.35);
  });

  it('🚨 withholds them on the ERROR path too — a fallback must not become the leak', async () => {
    dbConfig.throws = true;
    const data = await get();
    // The DEFAULT_CONFIG fallback carries the same labor/overhead/margin numbers.
    for (const key of CONFIDENTIAL) {
      expect(data, `${key} leaked through the DB-error fallback`).not.toHaveProperty(key);
    }
    expect(data, 'the error fallback stopped serving a usable sell price').toHaveProperty('pricePerWatt');
  });

  it('an AUTHENTICATED caller still gets the full config — the installer needs it', async () => {
    session.value = { id: 'installer-1', email: 'rep@installer.test' };
    const data = await get();
    for (const key of CONFIDENTIAL) {
      expect(data, `${key} is withheld from an authenticated installer`).toHaveProperty(key);
    }
    expect(data.profitMargin).toBe(40);
  });

  it('the allowlist is an allowlist — a newly added confidential field is withheld by default', async () => {
    // A field nobody has classified must not be published just because it exists.
    (STORED as Record<string, unknown>).secretDealerFeePct = 12.5;
    try {
      const data = await get();
      expect(data, 'an unclassified field was published to an anonymous caller')
        .not.toHaveProperty('secretDealerFeePct');
    } finally {
      delete (STORED as Record<string, unknown>).secretDealerFeePct;
    }
  });
});
