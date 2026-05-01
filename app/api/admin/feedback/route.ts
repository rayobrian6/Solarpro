/**
 * GET  /api/admin/feedback       — List all feedback (admin only)
 * POST /api/admin/feedback       — Update feedback status (admin only)
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/** Ensure feedback table exists */
async function ensureTable(sql: any) {
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id              VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
      type            VARCHAR(20)   NOT NULL,
      message         TEXT          NOT NULL,
      page_url        TEXT,
      user_id         VARCHAR(36)   NOT NULL,
      user_email      VARCHAR(255),
      screenshot_data BYTEA,
      screenshot_name VARCHAR(255),
      screenshot_mime VARCHAR(100),
      browser_info    TEXT,
      screen_size     VARCHAR(50),
      app_version     VARCHAR(50),
      status          VARCHAR(20)   NOT NULL DEFAULT 'new',
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;
}

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

    const sql = await getDbReady();
    await ensureTable(sql);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status'); // optional filter
    const limitRaw = parseInt(searchParams.get('limit') || '50', 10);
    const offsetRaw = parseInt(searchParams.get('offset') || '0', 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 200);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    let rows;
    if (status && ['new', 'reviewed', 'resolved'].includes(status)) {
      rows = await sql`
        SELECT
          id, type, message, page_url, user_id, user_email,
          screenshot_name, screenshot_mime,
          browser_info, screen_size, app_version,
          status, created_at, updated_at,
          CASE WHEN screenshot_data IS NOT NULL THEN true ELSE false END AS has_screenshot
        FROM feedback
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT
          id, type, message, page_url, user_id, user_email,
          screenshot_name, screenshot_mime,
          browser_info, screen_size, app_version,
          status, created_at, updated_at,
          CASE WHEN screenshot_data IS NOT NULL THEN true ELSE false END AS has_screenshot
        FROM feedback
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    // Get counts
    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'new') AS new_count,
        COUNT(*) FILTER (WHERE status = 'reviewed') AS reviewed_count,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
        COUNT(*) AS total
      FROM feedback
    `;

    return NextResponse.json({
      success: true,
      data: rows,
      counts: counts[0] || { new_count: 0, reviewed_count: 0, resolved_count: 0, total: 0 },
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/admin/feedback]', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

    const sql = await getDbReady();
    const body = await req.json();
    const { id, status } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Feedback ID required' }, { status: 400 });
    }
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid feedback ID format.' }, { status: 400 });
    }
    if (!status || !['new', 'reviewed', 'resolved'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Status must be new, reviewed, or resolved' }, { status: 400 });
    }

    const rows = await sql`
      UPDATE feedback
      SET status = ${status}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, status, updated_at
    `;

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Feedback not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/admin/feedback]', err);
  }
}