/**
 * POST /api/admin/projects/[id]/send-portal-invite
 *
 * Emails the homeowner their portal link + instructions.
 * The homeowner portal uses email-based OTP login — no password needed.
 * This route just sends them the URL and explains how to use it.
 */

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30; // bumped from 20 — getDbReady cold-start headroom

import { NextRequest, NextResponse }                    from 'next/server';
import { requireAdminApi }                              from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID }  from '@/lib/db-neon';
import { sendEmail }                                    from '@/lib/email';
import { getBaseUrl }                                   from '@/lib/env';
import { checkRateLimit, getClientIp }                  from '@/lib/rateLimiter';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });
  }

  try {
    const admin = await requireAdminApi(req);
    if (!admin) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    const { id: projectId } = await params;

    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID.' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Fetch project + client email
    const rows = await sql`
      SELECT
        p.id,
        p.name             AS project_name,
        p.address,
        p.homeowner_stage,
        c.name             AS client_name,
        c.email            AS client_email,
        u.name             AS rep_name,
        o.name             AS company_name
      FROM projects p
      LEFT JOIN clients      c ON c.id    = p.client_id
      LEFT JOIN users        u ON u.id    = p.user_id
      LEFT JOIN organizations o ON o.id  = u.org_id
      WHERE p.id      = ${projectId}
        AND p.user_id = ${admin.id}
        AND p.deleted_at IS NULL
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Project not found.' }, { status: 404 });
    }

    const row = rows[0];

    if (!row.client_email) {
      return NextResponse.json({
        success: false,
        error: 'No email address on file for this client. Please add one to the client profile first.',
      }, { status: 422 });
    }

    const portalUrl   = `${getBaseUrl()}/portal/login`;
    const companyName = row.company_name || 'Your Solar Company';
    const repName     = row.rep_name     || admin.name || 'Your Solar Rep';
    const clientName  = row.client_name  || 'Homeowner';
    const address     = row.address      || row.project_name || 'your property';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background:#0f172a;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="100%" style="max-width:520px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:28px 32px 20px;border-bottom:1px solid #334155;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">☀️</div>
            <h1 style="margin:0;font-size:20px;font-weight:800;color:#f1f5f9;">${companyName}</h1>
            <p style="margin:4px 0 0;font-size:13px;color:#64748b;">Project Status Portal</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 16px;font-size:15px;color:#94a3b8;line-height:1.6;">
              Hi ${clientName},
            </p>
            <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;line-height:1.6;">
              Your solar project for <strong style="color:#f1f5f9;">${address}</strong> is underway.
              You can track every step of your installation in your personal project portal —
              from survey to permit to your system going live.
            </p>

            <!-- How it works box -->
            <div style="background:#0f172a;border:1px solid #334155;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
              <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">How to access your portal</p>
              <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
                <div style="width:20px;height:20px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0f172a;flex-shrink:0;text-align:center;line-height:20px;">1</div>
                <p style="margin:0;font-size:13px;color:#94a3b8;">Click the button below to open the portal</p>
              </div>
              <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
                <div style="width:20px;height:20px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0f172a;flex-shrink:0;text-align:center;line-height:20px;">2</div>
                <p style="margin:0;font-size:13px;color:#94a3b8;">Enter this email address: <strong style="color:#f1f5f9;">${row.client_email}</strong></p>
              </div>
              <div style="display:flex;align-items:flex-start;gap:10px;">
                <div style="width:20px;height:20px;background:#f59e0b;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0f172a;flex-shrink:0;text-align:center;line-height:20px;">3</div>
                <p style="margin:0;font-size:13px;color:#94a3b8;">A 6-digit code will be emailed to you — enter it to sign in</p>
              </div>
            </div>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
              <tr>
                <td align="center">
                  <a href="${portalUrl}"
                     style="display:inline-block;padding:14px 36px;
                            background:linear-gradient(135deg,#f59e0b,#fbbf24);
                            color:#0f172a;font-size:15px;font-weight:800;
                            text-decoration:none;border-radius:12px;">
                    View My Project Portal →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:12px;color:#475569;text-align:center;">
              Questions? Reply to this email or contact ${repName}.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding:16px 32px 24px;border-top:1px solid #334155;">
            <p style="margin:0;font-size:11px;color:#475569;">${companyName} — Powered by SolarPro</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

    const text = `
Hi ${clientName},

Your solar project for ${address} is underway. Track every step in your project portal:

${portalUrl}

How to log in:
1. Go to the link above
2. Enter your email: ${row.client_email}
3. A 6-digit code will be sent to you — enter it to sign in

Questions? Contact ${repName}.

— ${companyName}
`.trim();

    const result = await sendEmail({
      to:      row.client_email,
      subject: `Your solar project portal — ${address}`,
      html,
      text,
    });

    if (!result.success) {
      return NextResponse.json({
        success: false,
        error: `Email delivery failed: ${result.error ?? 'unknown error'}`,
      }, { status: 500 });
    }

    console.log(`[PORTAL_INVITE] sent projectId=${projectId} to=${row.client_email} by=${admin.id}`);

    return NextResponse.json({ success: true, sentTo: row.client_email });

  } catch (e: unknown) {
    return handleRouteDbError('[POST /api/admin/projects/[id]/send-portal-invite]', e);
  }
}
