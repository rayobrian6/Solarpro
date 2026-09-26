/**
 * tests/proposalEmailAndPdfQuoteTheProposal.test.ts
 *
 * TWO SERVER SURFACES THAT DID NOT AGREE WITH THE PROPOSAL THEY POINT AT.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A9 — THE "Send to client" EMAIL COULD NEVER PRINT A SAVINGS FIGURE.
 *
 * The route read `production.annualSavingsFirstYear ?? production.annualSavings`
 * off the stored snapshot. Neither field is written there by anything, so the
 * value was always 0, `annualSavings > 0 ? … : undefined` dropped it, and
 * lib/email.ts omits the line entirely rather than printing $0. The homeowner's
 * first impression of the proposal was a large price with no counterweight — and
 * because the line was absent rather than zero, it looked deliberate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A10 — THE SAME EMAIL'S "Total investment" SUBTRACTED AN UNGATED COMMERCIAL 30%.
 *
 * It read `costEstimate.netCost`, the one stored figure still carrying a
 * commercial §48E deduction. With `pricing_config.is_commercial = true` a
 * $100,000 system was announced in the email as $70,000 and priced at $100,000 on
 * the page the email links to — a company-level credit passed off as the
 * homeowner's discount, in the first thing they read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A11 — THE SERVER PDF LOST THE SYSTEM TYPE (AND THEREFORE THE PRICE AND SIZE).
 *
 * `const systemType = (proj as any).systemType || 'roof'`. `projects.system_type`
 * is commonly NULL — the mount type lives on the panels, which is why both React
 * proposal pages have always resolved it through resolveProposalSystemType. So a
 * fence / ground / carport project was labelled "Roof Mount", priced at the roof
 * $/W and degraded at the roof rate for 25 years.
 *
 * It also broke the system SIZE: buildCanonicalProposal injects the default Sol
 * Fence module when systemType is 'fence' and no panel is selected, so a fence
 * project mis-resolved as 'roof' got wattage 0 and a different kW from the page.
 *
 * ⚠️ REACH, STATED HONESTLY: no in-app button points at this route today — both
 * download paths capture the client DOM — so this bites direct/API callers and
 * whoever wires it up. The mechanism is certain; the blast radius is not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(),
  isValidUUID: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  handleRouteDbError: vi.fn(() =>
    new Response(JSON.stringify({ success: false, error: 'db' }), { status: 503 })),
}));
vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn(() => ({ id: 'user-1', name: 'Rep' })) }));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/email', () => ({
  sendProposalToClientEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock('@/lib/env', () => ({ getBaseUrl: () => 'https://solarpro.test' }));
// The PDF binary is irrelevant here; the HTML is what carries the claims.
vi.mock('@/lib/pdf/generatePdf', () => ({ generatePdfFromHtml: vi.fn(async () => null) }));
vi.mock('@/lib/proposalAccess', () => ({ authorizeProposalRead: vi.fn(async () => ({ ok: true, via: 'session' })) }));

import { getDbReady } from '@/lib/db-neon';
import { sendProposalToClientEmail } from '@/lib/email';
import { POST as SEND_EMAIL } from '@/app/api/proposals/[id]/send-email/route';
import { GET as PDF_GET } from '@/app/api/proposals/[id]/pdf/route';

const PID = '11111111-2222-4333-8444-555555555555';

function makeSql(handler: (q: string, values: unknown[]) => unknown) {
  const stmts: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join(' ? ').replace(/\s+/g, ' ').trim();
    stmts.push(q);
    return Promise.resolve(handler(q, values));
  };
  return Object.assign(tag, { stmts });
}
function install(handler: (q: string, values: unknown[]) => unknown) {
  const sql = makeSql(handler);
  vi.mocked(getDbReady).mockResolvedValue(sql as never);
  return sql;
}

/**
 * A $100,000 COMMERCIAL project whose stored costEstimate.netCost already has a
 * 30% deduction baked in — the exact shape that made the email announce $70,000.
 */
function commercialSnapshot() {
  return {
    status: 'sent',
    title: 'Solar Proposal',
    pricingSnapshot: { isCommercial: true, pricePerWatt: 3.1, roofPricePerWatt: 3.1 },
    project: {
      name: 'Acme Warehouse',
      address: '1 Industrial Way, Phoenix AZ 85004',
      utilityName: 'APS',
      stateCode: 'AZ',
      systemType: 'roof',
      costEstimate: { cashPrice: 100_000, grossCost: 100_000, netCost: 70_000 },
      layout: { systemSizeKw: 40, totalPanels: 100 },
      production: { annualProductionKwh: 60_000, monthlyProductionKwh: Array(12).fill(5_000) },
      client: { name: 'Acme', state: 'AZ', annualKwh: 70_000, utilityRate: 0.127 },
      selectedPanel: { manufacturer: 'Maxeon', model: 'MAX3-400', wattage: 400, efficiency: 22.3, warranty: 40 },
    },
  };
}

function emailReq() {
  return new Request(`http://localhost/api/proposals/${PID}/send-email`, { method: 'POST' }) as never;
}

beforeEach(() => vi.clearAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// A9 + A10
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A9/A10 — the email quotes the proposal it links to', () => {
  async function send(snapshot: Record<string, unknown>) {
    install((q) => {
      if (/FROM proposals/i.test(q) && /JOIN clients/i.test(q)) {
        return [{
          id: PID,
          title: 'Solar Proposal',
          share_token: 'abcdef0123456789',
          data_json: snapshot,
          project_id: 'proj-1',
          project_name: 'Acme Warehouse',
          user_id: 'user-1',
          client_id: 'c-1',
          client_name: 'Acme',
          client_email: 'buyer@acme.test',
          rep_name: 'Rep',
          company_name: 'SolarPro',
        }];
      }
      return [];
    });
    const res = await SEND_EMAIL(emailReq(), { params: Promise.resolve({ id: PID }) } as never);
    expect(res.status, 'the send-email route failed before it could send').toBe(200);
    return vi.mocked(sendProposalToClientEmail).mock.calls[0][0] as unknown as Record<string, number | undefined>;
  }

  it('🚨 the savings line is populated — it could never render before', () => {
    return (async () => {
      const opts = await send(commercialSnapshot());
      expect(opts.annualSavings,
        'annualSavings is still undefined, so the email omits the savings line entirely')
        .toBeDefined();
      expect(opts.annualSavings!).toBeGreaterThan(0);
    })();
  });

  it('🚨 the total investment is the GROSS price, not an ungated commercial 30% off', () => {
    return (async () => {
      const opts = await send(commercialSnapshot());
      expect(opts.netCost,
        'the email still announces $70,000 for a $100,000 system')
        .not.toBe(70_000);
      expect(opts.netCost).toBe(100_000);
    })();
  });

  it('the system size comes from the canonical count × wattage, not layout.systemSizeKw', () => {
    return (async () => {
      // The snapshot's layout says 40 kW; 100 × 400 W is 40 kW too, so they
      // agree here — what is asserted is that the figure is the CANONICAL one and
      // is present at all.
      const opts = await send(commercialSnapshot());
      expect(opts.systemSizeKw).toBe(40);
    })();
  });

  it('a snapshot with no project omits the figures rather than inventing them', () => {
    return (async () => {
      const opts = await send({ status: 'sent', title: 'Old Proposal' });
      expect(opts.annualSavings).toBeUndefined();
      expect(opts.netCost).toBeUndefined();
      expect(opts.systemSizeKw).toBeUndefined();
    })();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A11
// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 A11 — the server PDF resolves the system type it prices with', () => {
  /** A fence project whose `projects.system_type` column is NULL — the common case. */
  function fenceSnapshot() {
    return {
      status: 'sent',
      title: 'Solar Proposal',
      pricingSnapshot: { isCommercial: false, pricePerWatt: 3.1, roofPricePerWatt: 3.1, fencePricePerWatt: 4.25 },
      project: {
        name: 'Braidon Sol Fence',
        address: '100 Main St, Springfield IL 62701',
        utilityName: 'Ameren Illinois',
        stateCode: 'IL',
        systemType: null,
        costEstimate: {},
        layout: {
          systemSizeKw: 8.8,
          totalPanels: 20,
          systemType: 'fence',
          panels: Array.from({ length: 20 }, () => ({ placementType: 'FENCE' })),
        },
        production: { annualProductionKwh: 11_200, monthlyProductionKwh: Array(12).fill(933) },
        client: { name: 'Braidon', state: 'IL', annualKwh: 12_000, utilityRate: 0.128 },
        selectedPanel: null,
      },
    };
  }

  async function pdfHtml(snapshot: Record<string, unknown>) {
    install((q) => {
      if (/^SELECT \* FROM proposals/i.test(q)) {
        return [{
          id: PID, project_id: 'proj-1', name: 'Solar Proposal', status: 'sent',
          share_token: 'abcdef0123456789', data_json: snapshot,
          created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
        }];
      }
      if (/branding_settings/i.test(q)) return [];
      return [];
    });
    // `nextUrl` is required: the handler reads `req.nextUrl.searchParams` for the
    // share token and the ?format= switch, and a bare Request has none — the
    // TypeError is swallowed by the route's single try/catch and answers 503,
    // which is indistinguishable from a database failure.
    const url = `http://localhost/api/proposals/${PID}/pdf`;
    const request = new Request(url);
    Object.defineProperty(request, 'nextUrl', { value: new URL(url), configurable: true });
    const res = await PDF_GET(request as never, { params: Promise.resolve({ id: PID }) } as never);
    expect(res.status, 'the PDF route failed before it rendered').toBe(200);
    return res.text();
  }

  it('🚨 a fence project is not labelled "Roof Mount"', async () => {
    // Discriminates against the RENDERER half of A11: renderProposalHTML printed
    // `project?.systemType ?? 'Roof Mount'`, and this project's column is null.
    const html = await pdfHtml(fenceSnapshot());
    expect(html, 'the PDF still calls a fence array a Roof Mount')
      .not.toMatch(/System Type<\/td><td>Roof Mount/);
    expect(html).toMatch(/System Type<\/td><td>Solar Fence/);
  });

  it('🚨 a fence project is PRICED at the fence $/W, not the roof $/W', async () => {
    // Discriminates against the ROUTE half of A11, which is the expensive one.
    // The route's `systemType` is what buildCanonicalProposal uses to pick the
    // $/W and the degradation rate. With no stored cash price, 8.8 kW at the
    // fence rate (4.25) is $37,400 and at the roof rate (3.10) is $27,280 — the
    // homeowner was quoted $10,120 less than the fence product costs, and then
    // degraded at the roof rate for 25 years.
    const html = await pdfHtml(fenceSnapshot());
    expect(html, 'the PDF priced the fence array at the ROOF $/W')
      .not.toContain('$27,280');
    expect(html).toContain('$37,400');
  });

  it('a genuine roof project is still Roof Mount — no collateral relabelling', async () => {
    const roof = fenceSnapshot() as any;
    roof.project.name = 'Doe Residence';
    roof.project.layout.systemType = 'roof';
    roof.project.layout.panels = Array.from({ length: 20 }, () => ({ placementType: 'ROOF' }));
    roof.project.selectedPanel = { manufacturer: 'Maxeon', model: 'MAX3-400', wattage: 400, efficiency: 22.3 };
    const html = await pdfHtml(roof);
    expect(html).toMatch(/System Type<\/td><td>Roof Mount/);
  });

  it('the PDF prints no invented APR — pricing_config has no loan_apr writer', async () => {
    // A5's suppression is what keeps a cash buyer (purchase_mode also has no
    // writer, so this route always resolves 'finance') from reading a 7.99% loan
    // payment they never asked for.
    const html = await pdfHtml(fenceSnapshot());
    expect(html, 'the PDF still prints an invented 7.99% APR').not.toContain('7.99%');
    expect(html).not.toContain('Finance APR');
  });
});
