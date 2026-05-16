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
    const rows = await sql`
      SELECT
        p.id,
        p.title,
        p.share_token,
        p.data_json,
        pr.id          AS project_id,
        pr.name        AS project_name,
        pr.user_id,
        c.id           AS client_id,
        c.name         AS client_name,
        c.email        AS client_email,
        u.name         AS rep_name,
        o.company_name AS company_name
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
    const companyName = row.company_name || 'SolarPro';
    const repName     = row.rep_name    || user.name || 'Your Solar Rep';

    // Extract system stats from data_json for the email highlights
    const dj       = (row.data_json as Record<string, any>) ?? {};
    const proj      = dj?.project ?? {};
    const cost      = proj?.costEstimate ?? dj?.costEstimate ?? {};
    const production = proj?.production ?? dj?.production ?? {};
    const layout    = proj?.layout ?? dj?.layout ?? {};

    const systemSizeKw   = Number(layout?.systemSizeKw)   || 0;
    const annualSavings  = Number(production?.annualSavingsFirstYear ?? production?.annualSavings) || 0;
    const netCost        = Number(cost?.netCost)           || 0;

    // Send the email
    const emailResult = await sendProposalToClientEmail({
      to:            row.client_email,
      clientName:    row.client_name,
      proposalTitle: row.title,
      companyName,
      repName,
      proposalUrl,
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
    // Temporary diagnostic: expose real error message to identify root cause
    const errMsg = e instanceof Error ? e.message : String(e);
    const errStack = e instanceof Error ? (e.stack ?? '') : '';
    console.error('[send-email] DIAGNOSTIC ERROR:', errMsg, errStack);
    // Return real error in response for debugging (remove once fixed)
    return NextResponse.json(
      {
        success: false,
        error: 'Service temporarily unavailable. Please try again in a moment.',
        code: 'DB_STARTING',
        _debug_error: errMsg,
        _debug_stack: errStack.split('\n').slice(0, 5).join(' | '),
      },
      { status: 503, headers: { 'Retry-After': '3' } }
    );
  }
}
