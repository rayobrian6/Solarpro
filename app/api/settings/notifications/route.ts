export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// ── Default notification preferences ─────────────────────────────────────────
export const DEFAULT_NOTIFICATION_PREFS = {
  // Email notifications
  email_proposal_signed:    true,  // When a client signs a proposal
  email_proposal_expiry:    true,  // 3 days before proposal expires
  email_stage_change:       true,  // When project stage changes
  email_new_lead:           true,  // When a new lead is added
  email_survey_completed:   true,  // When a site survey is submitted
  email_weekly_summary:     false, // Weekly activity digest
  email_billing_alerts:     true,  // Billing and subscription events
  // In-app notifications (bell icon)
  inapp_proposal_signed:    true,
  inapp_stage_change:       true,
  inapp_new_lead:           true,
  inapp_survey_completed:   true,
  inapp_system_alerts:      true,
} as const;

export type NotificationPrefs = Partial<typeof DEFAULT_NOTIFICATION_PREFS>;

// ── GET /api/settings/notifications ──────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sql = await getDbReady();
    const rows = await sql`
      SELECT notification_prefs FROM users WHERE id = ${user.id} LIMIT 1
    `;

    const stored: NotificationPrefs = rows[0]?.notification_prefs ?? {};
    // Merge with defaults so new keys are always present
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...stored };

    return NextResponse.json({ success: true, prefs });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/settings/notifications]', err);
  }
}

// ── PATCH /api/settings/notifications ────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
    }

    // Only allow known keys; strip unknown keys for safety
    const validKeys = new Set(Object.keys(DEFAULT_NOTIFICATION_PREFS));
    const clean: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body)) {
      if (validKeys.has(k) && typeof v === 'boolean') {
        clean[k] = v;
      }
    }

    const sql = await getDbReady();

    // Try to update. If notification_prefs column doesn't exist, run migration first.
    try {
      await sql`
        UPDATE users
        SET notification_prefs = notification_prefs || ${JSON.stringify(clean)}::jsonb
        WHERE id = ${user.id}
      `;
    } catch (updateErr: unknown) {
      const msg = (updateErr as Error).message ?? '';
      if (msg.includes('notification_prefs') || msg.includes('column')) {
        // Run migration inline
        await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb`;
        await sql`
          UPDATE users
          SET notification_prefs = notification_prefs || ${JSON.stringify(clean)}::jsonb
          WHERE id = ${user.id}
        `;
      } else {
        throw updateErr;
      }
    }

    // Return updated prefs
    const rows = await sql`
      SELECT notification_prefs FROM users WHERE id = ${user.id} LIMIT 1
    `;
    const stored: NotificationPrefs = rows[0]?.notification_prefs ?? {};
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...stored };

    return NextResponse.json({ success: true, prefs });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/settings/notifications]', err);
  }
}
