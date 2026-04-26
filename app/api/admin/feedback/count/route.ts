/**
 * GET /api/admin/feedback/count
 * Lightweight endpoint — returns count of 'new' feedback items.
 * Admin only. Used for notification badges.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { requireAdminApi } from '@/lib/adminAuth';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdminApi(req);
    console.log('[feedback/count] admin:', admin ? `${admin.email} (${admin.role})` : 'null');

    if (!admin) {
      return NextResponse.json({ count: 0, reason: 'not_admin' });
    }

    const sql = await getDbReady();

    const rows = await sql`
      SELECT COUNT(*)::int AS count FROM feedback WHERE status = 'new'
    `;

    const count = rows[0]?.count ?? 0;
    console.log('[feedback/count] new feedback count:', count);

    return NextResponse.json({ count });
  } catch (err: unknown) {
    console.error('[feedback/count] error:', (err as Error).message);
    // Table may not exist yet, or other error — return 0
    return NextResponse.json({ count: 0, reason: 'error' });
  }
}