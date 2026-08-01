// ============================================================
// Proposal PDF Export API
// GET /api/proposals/[id]/pdf
// POST /api/proposals/[id]/pdf  (body: { branding? })
//
// Server-side PDF generation:
//   1. Load proposal from DB (verifies ownership or share token)
//   2. Build CanonicalProposal via buildCanonicalProposal()
//   3. Render HTML via renderProposalHTML()
//   4. Convert to PDF via Puppeteer+chromium (falls back to HTML if unavailable)
//   5. Return PDF buffer with Content-Disposition: attachment
// ============================================================

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 45;

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { buildCanonicalProposal } from '@/lib/proposal/buildCanonicalProposal';
import { resolveActualAnnualBill, resolveMonthlyUsageHistory } from '@/lib/proposal/resolveActualBill';
import { renderProposalHTML, ProposalBranding } from '@/lib/proposal/renderProposalHTML';
import { generatePdfFromHtml } from '@/lib/pdf/generatePdf';
import type { Proposal } from '@/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/** Constant-time string comparison to prevent timing attacks on share tokens. */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}


type RouteContext = { params: Promise<{ id: string }> };

// ── Load & authorise proposal ────────────────────────────────────────────────

async function loadProposal(id: string, req: NextRequest): Promise<Proposal | null> {
  const sql = await getDbReady();
  const rows = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;

  const row      = rows[0] as Record<string, unknown>;
  const dataJson = (row.data_json as Record<string, unknown>) || {};

  const user       = getUserFromRequest(req);
  const tokenParam = req.nextUrl.searchParams.get('token');

  // Allow access when: authenticated user owns the proposal (via project ownership)
  // OR a valid share token is supplied (unauthenticated homeowner link)
  if (!user && !tokenParam) return null;

  if (!user && tokenParam) {
    // Public share token path — validate token (timing-safe)
    if (!safeStrEqual(row.share_token as string, tokenParam)) return null;
  } else if (user) {
    // Auth path — verify ownership via projects JOIN
    const owned = await sql`
      SELECT p.id FROM proposals p
      JOIN projects proj ON proj.id = p.project_id
      WHERE p.id = ${id} AND proj.user_id = ${user.id}
      LIMIT 1
    `;
    if (owned.length === 0) return null;
  }

  // Reconstruct Proposal object from DB row (mirrors rowToProposal in proposals/route.ts)
  const snapshotProject = dataJson.project as Proposal['project'] | undefined;
  return {
    id:              row.id         as string,
    projectId:       row.project_id as string,
    project:         snapshotProject,
    status:          (dataJson.status as Proposal['status']) || 'draft',
    title:           (dataJson.title as string) || (row.name as string) || 'Solar Proposal',
    preparedBy:      (dataJson.preparedBy as string) || 'SolarPro Design Team',
    preparedDate:    (dataJson.preparedDate as string) || (row.created_at as string),
    validUntil:      (dataJson.validUntil as string) || new Date(Date.now() + 30 * 86400000).toISOString(),
    shareToken:      row.share_token as string | undefined,
    viewCount:       (dataJson.viewCount as number) || 0,
    createdAt:       row.created_at as string,
    updatedAt:       row.updated_at as string,
    pricingSnapshot: (dataJson.pricingSnapshot as Record<string, unknown>) ?? null,
    snapshotAt:      (dataJson.snapshotAt as string) ?? undefined,
    dbUtilityRate:   typeof dataJson.dbUtilityRate === 'number' ? dataJson.dbUtilityRate : null,
  } as Proposal;
}

// ── Load branding for user ────────────────────────────────────────────────────

async function loadBranding(userId: string): Promise<ProposalBranding> {
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT company_name, company_logo_url, company_website, company_address, company_phone, brand_primary_color
      FROM branding_settings WHERE user_id = ${userId} LIMIT 1
    `;
    if (rows.length === 0) return { companyName: 'SolarPro' };
    const b = rows[0] as Record<string, unknown>;
    return {
      companyName:       (b.company_name as string) || 'SolarPro',
      companyAddress:    (b.company_address as string) || null,
      companyPhone:      (b.company_phone as string) || null,
      companyWebsite:    (b.company_website as string) || null,
      brandPrimaryColor: (b.brand_primary_color as string) || '#f59e0b',
    };
  } catch {
    return { companyName: 'SolarPro' };
  }
}



// ── Sanitise filename ─────────────────────────────────────────────────────

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 60);
}

// ── Shared handler ────────────────────────────────────────────────────────────

async function handleRequest(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    // Rate limiting — reuse engineering rate limiter
        const rl = await checkRateLimit('engineering', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }

    // Load + authorise proposal
    const proposal = await loadProposal(id, req);
    if (!proposal) {
      return NextResponse.json({ success: false, error: 'Proposal not found or access denied' }, { status: 404 });
    }

    if (!proposal.project) {
      return NextResponse.json({ success: false, error: 'Proposal has no project snapshot — regenerate the proposal to enable PDF export' }, { status: 422 });
    }

    // Load branding (authenticated user only; public share gets defaults)
    const user = getUserFromRequest(req);
    const branding = user ? await loadBranding(user.id) : { companyName: 'SolarPro' };

    // Override branding from POST body if provided
    let bodyBranding: Partial<ProposalBranding> = {};
    if (req.method === 'POST') {
      try {
        const body = await req.json() as Record<string, unknown>;
        if (body.branding) bodyBranding = body.branding as Partial<ProposalBranding>;
      } catch {}
    }
    const finalBranding: ProposalBranding = { ...branding, ...bodyBranding };

    // Build canonical proposal from project snapshot
    // Mirrors the input construction in app/proposals/view/[id]/page.tsx
    let cp;
    try {
      const proj       = proposal.project!;
      const layout     = (proj as any).layout;
      const production = (proj as any).production;
      const client     = (proj as any).client;
      const pricingCfg = (proposal.pricingSnapshot ?? {}) as Record<string, any>;

      const selectedPanel     = (proj as any).selectedPanel;
      const layoutSystemSizeKw = (layout?.systemSizeKw && layout.systemSizeKw > 0)
        ? layout.systemSizeKw
        : ((proj as any).systemSizeKw ?? 0);
      const totalPanels = (layout?.totalPanels && layout.totalPanels > 0)
        ? layout.totalPanels
        : layoutSystemSizeKw > 0 ? Math.ceil(layoutSystemSizeKw / 0.44) : 0;
      const _extractState = (addr?: string) => { if (!addr) return ''; const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i); return m ? m[1].toUpperCase() : ''; };
      const projectStateCode = ((proj as any).stateCode || client?.state || _extractState((proj as any).address || client?.address || '') || '').toUpperCase().trim().slice(0, 2);
      const systemType = (proj as any).systemType || 'roof';
      const isCommercial = pricingCfg.isCommercial ?? false;
      const purchaseMode: 'finance' | 'cash' = pricingCfg.purchaseMode === 'cash' ? 'cash' : 'finance';

      cp = buildCanonicalProposal({
        // Panel
        panelSpec: selectedPanel ? {
          manufacturer: selectedPanel.manufacturer || '',
          model:        selectedPanel.model || selectedPanel.name || '',
          wattage:      selectedPanel.wattage ?? 0,
          efficiency:   selectedPanel.efficiency ?? undefined,
          width:        selectedPanel.width ?? undefined,
          height:       selectedPanel.height ?? undefined,
        } : null,
        panelCount:         totalPanels,
        layoutSystemSizeKw,

        // Production
        annualProductionKwh:  production?.annualProductionKwh ?? 0,
        monthlyProductionKwh: production?.monthlyProductionKwh ?? [],

        // Utility
        utilityName:         (proj as any).utilityName || '',
        stateCode:           projectStateCode,
        clientState:         client?.state || '',
        address:             (proj as any).address || client?.address || '',  // v48.17: ZIP lookup
        zip:                 (proj as any).zip || '',
        // v48.14: parsedBillRate intentionally undefined — OCR-extracted rates are supply-only.
        // See view/[id]/page.tsx for full explanation.
        parsedBillRate:      undefined,
        utilityRateOverride: (proj as any).utilityRatePerKwh,
        clientUtilityRate:   client?.utilityRate,
        dbUtilityRate:       proposal.dbUtilityRate ?? undefined,
        annualUsageKwh:      client?.annualKwh ?? 0,
        actualAnnualBill:    resolveActualAnnualBill(client),  // real bill (same source as Bill tab)
        monthlyUsageHistoryKwh: resolveMonthlyUsageHistory(client), // real seasonal shape for the bill chart

        // Pricing
        systemType,
        storedCashPrice:     (proj as any).costEstimate?.cashPrice ?? (proj as any).costEstimate?.grossCost ?? 0,
        roofPricePerWatt:    pricingCfg.roofPricePerWatt    ?? pricingCfg.pricePerWatt,
        groundPricePerWatt:  pricingCfg.groundPricePerWatt  ?? pricingCfg.pricePerWatt,
        fencePricePerWatt:   pricingCfg.fencePricePerWatt   ?? pricingCfg.pricePerWatt,
        carportPricePerWatt: pricingCfg.carportPricePerWatt ?? pricingCfg.pricePerWatt,
        defaultPricePerWatt: pricingCfg.pricePerWatt,

        // Financing
        loanApr:       pricingCfg.loanApr,
        loanTermYears: pricingCfg.loanTermYears,
        purchaseMode,

        // Policy
        isCommercial,
        noItc: (proj as any).noItc ?? false,
      });
    } catch (buildErr) {
      console.error('[proposal-pdf] buildCanonicalProposal failed:', buildErr);
      return NextResponse.json({
        success: false,
        error: 'Could not build proposal data — project may be missing required fields',
        detail: (buildErr as Error).message,
      }, { status: 422 });
    }

    // Render HTML
    const html = renderProposalHTML(cp, proposal, finalBranding);

    // Check if HTML-only mode requested
    const format = req.nextUrl.searchParams.get('format');
    if (format === 'html') {
      return new NextResponse(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="proposal-${id}.html"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Generate PDF via Puppeteer+chromium (Vercel-compatible)
    const projectLabel = safeFilename(proposal.project?.name ?? proposal.title ?? 'Solar-Proposal');
    const filename = `SolarPro-Proposal-${projectLabel}.pdf`;

    const pdfResult = await generatePdfFromHtml(html, { format: 'Letter', printBackground: true });

    if (pdfResult) {
      return new NextResponse(pdfResult.pdf as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          'X-Pdf-Method': pdfResult.method,
        },
      });
    }

    // Fallback: return HTML if PDF generation failed
    console.warn('[proposal-pdf] Falling back to HTML — PDF generation unavailable');
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${projectLabel}.html"`,
        'Cache-Control': 'no-store',
        'X-Pdf-Method': 'html-fallback',
      },
    });

  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/proposals/[id]/pdf]', err);
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handleRequest(req, /* @next-codemod-ignore 'context' is passed as an argument. Any asynchronous properties of 'props' must be awaited when accessed. (handleRequest already does `await context.params` on line 134.) */
  context);
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handleRequest(req, /* @next-codemod-ignore 'context' is passed as an argument. Any asynchronous properties of 'props' must be awaited when accessed. (handleRequest already does `await context.params` on line 134.) */
  context);
}