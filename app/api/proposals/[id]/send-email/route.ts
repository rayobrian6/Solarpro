/**
 * POST /api/proposals/[id]/send-email
 *
 * "Send to Client" workflow — emails the proposal link to the client.
 *
 * 1. Auth + ownership check
 * 2. Ensure proposal has a share token (generates one if missing)
 * 3. Look up client email from project → clients table
 * 4. Send branded proposal email via Resend
 * 5. Record sent_at + sent_to_email on the proposal row
 */
export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse }            from 'next/server';
import { getUserFromRequest }                    from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp }           from '@/lib/rateLimiter';
import { sendProposalToClientEmail }             from '@/lib/email';
import { getBaseUrl }                            from '@/lib/env';
import { v4 as uuidv4 }                          from 'uuid';
import { buildCanonicalProposal }                from '@/lib/proposal/buildCanonicalProposal';
import { resolveActualAnnualBill, resolveMonthlyUsageHistory } from '@/lib/proposal/resolveActualBill';
import { resolveProposalSystemType }             from '@/lib/proposalSystemType';
import type { CanonicalProposal }                from '@/lib/proposal/canonicalProposal';

/**
 * Build the CanonicalProposal from a proposal's stored `data_json` snapshot.
 *
 * Mirrors app/api/proposals/[id]/pdf/route.ts so the "Send to client" email, the
 * server PDF and the web proposal all read ONE set of numbers. Returns null when
 * the snapshot is too thin to build from (pre-v47.222 proposals have no project
 * snapshot) — the caller then omits the figures rather than inventing them.
 */
function buildEmailCanonicalProposal(dj: Record<string, any>): CanonicalProposal | null {
  const proj = dj?.project;
  if (!proj) return null;

  try {
    const layout     = proj.layout;
    const production = proj.production;
    const client     = proj.client;
    const pricingCfg = (dj.pricingSnapshot ?? {}) as Record<string, any>;

    const selectedPanel      = proj.selectedPanel;
    const layoutSystemSizeKw = (layout?.systemSizeKw && layout.systemSizeKw > 0)
      ? layout.systemSizeKw
      : (proj.systemSizeKw ?? 0);
    const totalPanels = (layout?.totalPanels && layout.totalPanels > 0)
      ? layout.totalPanels
      : layoutSystemSizeKw > 0 ? Math.ceil(layoutSystemSizeKw / 0.44) : 0;

    const _extractState = (addr?: string) => {
      if (!addr) return '';
      const m = addr.match(/\b([A-Z]{2})\s+\d{5}/i) || addr.match(/,\s*([A-Z]{2})\s*$/i);
      return m ? m[1].toUpperCase() : '';
    };
    const projectStateCode = (
      proj.stateCode || client?.state || _extractState(proj.address || client?.address || '') || ''
    ).toUpperCase().trim().slice(0, 2);

    // One resolver, same as both proposal pages and the PDF route — never the raw
    // `projects.system_type` column, which is commonly null on non-roof jobs.
    const systemType = resolveProposalSystemType({
      panels:           layout?.panels,
      layoutSystemType: layout?.systemType,
      projSystemType:   proj.systemType,
      projectName:      proj.name,
    });

    return buildCanonicalProposal({
      panelSpec: selectedPanel ? {
        manufacturer: selectedPanel.manufacturer || '',
        model:        selectedPanel.model || selectedPanel.name || '',
        wattage:      selectedPanel.wattage ?? 0,
        efficiency:   selectedPanel.efficiency ?? undefined,
        width:        selectedPanel.width ?? undefined,
        height:       selectedPanel.height ?? undefined,
      } : null,
      panelCount:           totalPanels,
      layoutSystemSizeKw,
      annualProductionKwh:  production?.annualProductionKwh ?? 0,
      monthlyProductionKwh: production?.monthlyProductionKwh ?? [],
      utilityName:          proj.utilityName || '',
      stateCode:            projectStateCode,
      clientState:          client?.state || '',
      address:              proj.address || client?.address || '',
      zip:                  proj.zip || '',
      parsedBillRate:       undefined,
      utilityRateOverride:  proj.utilityRatePerKwh,
      clientUtilityRate:    client?.utilityRate,
      dbUtilityRate:        typeof dj.dbUtilityRate === 'number' ? dj.dbUtilityRate : undefined,
      annualUsageKwh:       client?.annualKwh ?? 0,
      actualAnnualBill:     resolveActualAnnualBill(client),
      monthlyUsageHistoryKwh: resolveMonthlyUsageHistory(client),
      systemType,
      storedCashPrice:      proj.costEstimate?.cashPrice ?? proj.costEstimate?.grossCost ?? 0,
      roofPricePerWatt:     pricingCfg.roofPricePerWatt    ?? pricingCfg.pricePerWatt,
      groundPricePerWatt:   pricingCfg.groundPricePerWatt  ?? pricingCfg.pricePerWatt,
      fencePricePerWatt:    pricingCfg.fencePricePerWatt   ?? pricingCfg.pricePerWatt,
      carportPricePerWatt:  pricingCfg.carportPricePerWatt ?? pricingCfg.pricePerWatt,
      defaultPricePerWatt:  pricingCfg.pricePerWatt,
      loanApr:              pricingCfg.loanApr,
      loanTermYears:        pricingCfg.loanTermYears,
      purchaseMode:         pricingCfg.purchaseMode === 'cash' ? 'cash' : 'finance',
      isCommercial:         pricingCfg.isCommercial ?? false,
      noItc:                proj.noItc ?? false,
    });
  } catch (err) {
    // An email must never fail because a snapshot was thin. Omit the figures.
    console.warn('[send-email] buildCanonicalProposal failed:', (err as Error)?.message);
    return null;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id: proposalId } = await params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Fetch proposal + project + client in one query
    // NOTE: proposals table uses "name" (not "title") — aliased to title for clarity
    // NOTE: organizations table uses "name" (not "company_name")
    const rows = await sql`
      SELECT
        p.id,
        p.name         AS title,
        p.share_token,
        p.data_json,
        pr.id          AS project_id,
        pr.name        AS project_name,
        pr.user_id,
        c.id           AS client_id,
        c.name         AS client_name,
        c.email        AS client_email,
        u.name         AS rep_name,
        o.name         AS company_name
      FROM proposals   p
      JOIN projects    pr ON pr.id   = p.project_id
      JOIN clients     c  ON c.id    = pr.client_id
      JOIN users       u  ON u.id    = pr.user_id
      LEFT JOIN organizations o ON o.id = u.org_id
      WHERE p.id       = ${proposalId}
        AND pr.user_id = ${user.id}
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Proposal not found.' }, { status: 404 });
    }

    const row = rows[0];

    if (!row.client_email) {
      return NextResponse.json({
        success: false,
        error: 'Client does not have an email address on file. Please add one in the client profile.',
      }, { status: 422 });
    }

    // Ensure share token exists (generate if missing)
    let shareToken: string = row.share_token;
    if (!shareToken) {
      shareToken = uuidv4().replace(/-/g, '').substring(0, 16);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      await sql`
        UPDATE proposals
        SET share_token  = ${shareToken},
            share_expires_at = ${expiresAt}
        WHERE id = ${proposalId}
      `;
    }

    const baseUrl     = getBaseUrl();
    const proposalUrl = `${baseUrl}/proposals/view/${proposalId}?token=${shareToken}`;
    const portalUrl   = `${baseUrl}/portal/login?email=${encodeURIComponent(row.client_email)}`;
    const companyName = row.company_name || 'SolarPro';
    const repName     = row.rep_name    || user.name || 'Your Solar Rep';

    // ── System stats for the email highlights ─────────────────────────────────
    //
    // 🚨 THESE THREE NUMBERS USED TO BE READ OFF RAW SNAPSHOT FIELDS, AND TWO OF
    // THEM WERE WRONG.
    //
    //   • `annualSavings` read `production.annualSavingsFirstYear ?? production
    //     .annualSavings`. Neither field is produced anywhere for the proposal
    //     snapshot, so the value was always 0, `annualSavings > 0 ? … :
    //     undefined` dropped it, and the template silently omitted the savings
    //     line rather than printing $0 — so it looked deliberate. The
    //     homeowner's first impression was a large price with no counterweight.
    //
    //   • `netCost` read `costEstimate.netCost`, the ONE stored figure that
    //     still subtracts an ungated commercial 30%. With
    //     `pricing_config.is_commercial = true` a $100,000 system was announced
    //     in the email as $70,000 and priced at $100,000 on the page the email
    //     links to — a company-level §48E credit passed off as the homeowner's
    //     discount.
    //
    //   • `systemSizeKw` read `layout.systemSizeKw`, which the canonical
    //     pipeline treats as a HINT only (it overrides with count × wattage).
    //
    // All three now come from the CanonicalProposal, built exactly the way
    // app/api/proposals/[id]/pdf/route.ts builds it, so the email and the
    // proposal it links to quote the same numbers.
    const dj = (row.data_json as Record<string, any>) ?? {};
    const cp = buildEmailCanonicalProposal(dj);

    const systemSizeKw  = cp ? cp.panel.systemSizeKw        : 0;
    const annualSavings = cp ? cp.financial.annualEnergyValue : 0;
    const netCost       = cp ? cp.financial.netCost          : 0;

    // Send the email
    const emailResult = await sendProposalToClientEmail({
      to:            row.client_email,
      clientName:    row.client_name,
      proposalTitle: row.title,
      companyName,
      repName,
      proposalUrl,
      portalUrl,
      systemSizeKw:  systemSizeKw  > 0 ? systemSizeKw  : undefined,
      annualSavings: annualSavings > 0 ? annualSavings : undefined,
      netCost:       netCost       > 0 ? netCost       : undefined,
    });

    if (!emailResult.success) {
      return NextResponse.json({
        success: false,
        error: `Email delivery failed: ${emailResult.error ?? 'unknown error'}`,
      }, { status: 500 });
    }

    // Record sent_at and recipient on the proposal
    await sql`
      UPDATE proposals
      SET sent_at       = NOW(),
          sent_to_email = ${row.client_email}
      WHERE id = ${proposalId}
    `.catch(() => {
      // Non-fatal — columns may not exist in older schemas (migration adds them)
      console.warn('[send-email] Could not update sent_at — run migration 035');
    });

    return NextResponse.json({
      success:   true,
      sentTo:    row.client_email,
      clientName: row.client_name,
      proposalUrl,
    });

  } catch (e: unknown) {
    return handleRouteDbError('[api/proposals/[id]/send-email]', e);
  }
}
