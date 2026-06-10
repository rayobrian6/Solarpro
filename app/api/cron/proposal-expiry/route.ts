/**
 * GET /api/cron/proposal-expiry
 *
 * Vercel Cron Job — runs daily at 08:00 UTC.
 * Finds proposals with share tokens expiring in exactly 3 days (±12h window)
 * that have been sent to a client (sent_at IS NOT NULL) and are not yet signed.
 *
 * For each expiring proposal, sends a reminder email to the rep (user).
 *
 * Security:
 *   - Vercel automatically adds an Authorization: Bearer header with the CRON_SECRET.
 *   - We verify this header before executing any DB operations.
 *   - The route is also listed in vercel.json under "crons" with a schedule.
 *
 * To test locally:
 *   curl -X GET http://localhost:3000/api/cron/proposal-expiry \
 *     -H "Authorization: Bearer <CRON_SECRET>"
 */
export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse }       from 'next/server';
import { timingSafeEqual }                 from 'crypto';
import { getDbReady, handleRouteDbError }  from '@/lib/db-neon';
import { sendProposalExpiryReminderEmail } from '@/lib/email';
import { getBaseUrl }                      from '@/lib/env';

/** Constant-time string comparison to prevent timing attacks. */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const REMINDER_DAYS_BEFORE = 3;    // send reminder 3 days before expiry
const WINDOW_HOURS         = 12;   // ±12h window to avoid duplicate sends

export async function GET(req: NextRequest) {
  // ── Auth: verify Vercel cron secret ───────────────────────────────────────
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    const expectedBearer = `Bearer ${cronSecret}`;
    if (!authHeader || !safeStrEqual(authHeader, expectedBearer)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
  } else if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') {
    // In production, CRON_SECRET MUST be set
    console.error('[cron/proposal-expiry] CRON_SECRET is not set — aborting');
    return NextResponse.json({ success: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  // In dev with no CRON_SECRET set, allow through (for testing)

  const results: string[] = [];
  const sentCount = { ok: 0, fail: 0 };

  try {
    const sql     = await getDbReady();
    const baseUrl = getBaseUrl();

    const now        = new Date();
    const windowLow  = new Date(now.getTime() + (REMINDER_DAYS_BEFORE * 24 - WINDOW_HOURS) * 3600_000);
    const windowHigh = new Date(now.getTime() + (REMINDER_DAYS_BEFORE * 24 + WINDOW_HOURS) * 3600_000);

    // Find proposals that:
    //   - Have been sent to a client (sent_at IS NOT NULL)
    //   - Have a share token expiring in the 3-day reminder window
    //   - Are not yet signed
    //   - The client column sent_to_email is not null
    const rows = await sql`
      SELECT
        p.id,
        p.title,
        p.share_token,
        p.share_expires_at,
        p.sent_to_email,
        c.name   AS client_name,
        u.name   AS rep_name,
        u.email  AS rep_email
      FROM proposals   p
      JOIN projects    pr ON pr.id   = p.project_id
      JOIN clients     c  ON c.id    = pr.client_id
      JOIN users       u  ON u.id    = pr.user_id
      WHERE p.sent_at         IS NOT NULL
        AND p.signed_at       IS NULL
        AND p.share_expires_at BETWEEN ${windowLow} AND ${windowHigh}
        AND p.share_token     IS NOT NULL
        AND u.email           IS NOT NULL
    `;

    if (rows.length === 0) {
      return NextResponse.json({
        success:   true,
        message:   'No expiring proposals found in window.',
        window:    { from: windowLow.toISOString(), to: windowHigh.toISOString() },
        sent:      0,
      });
    }

    for (const row of rows) {
      const proposalUrl = `${baseUrl}/proposals/view/${row.id}?token=${row.share_token}`;
      const expiresAt   = new Date(row.share_expires_at as string);

      try {
        const emailResult = await sendProposalExpiryReminderEmail({
          to:            row.rep_email as string,
          repName:       row.rep_name  as string,
          clientName:    row.client_name as string,
          proposalTitle: row.title     as string,
          proposalUrl,
          expiresAt,
        });

        if (emailResult.success) {
          sentCount.ok++;
          results.push(`✅ ${row.id} → ${row.rep_email} (expires ${expiresAt.toDateString()})`);
        } else {
          sentCount.fail++;
          results.push(`⚠️ ${row.id} email failed: ${emailResult.error}`);
        }
      } catch (emailErr: unknown) {
        sentCount.fail++;
        results.push(`❌ ${row.id} exception: ${(emailErr as Error)?.message}`);
      }
    }

    return NextResponse.json({
      success:   true,
      processed: rows.length,
      sent:      sentCount.ok,
      failed:    sentCount.fail,
      results,
    });

  } catch (e: unknown) {
    return handleRouteDbError('[cron/proposal-expiry]', e);
  }
}
