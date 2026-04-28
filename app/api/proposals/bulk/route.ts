export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';

// POST /api/proposals/bulk
// Body: { action: 'delete' | 'archive' | 'status' | 'clear_test', ids?: string[], status?: string }
export async function POST(req: NextRequest) {
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as {
      action: 'delete' | 'archive' | 'status' | 'clear_test';
      ids?: string[];
      status?: string;
    };

    const { action, ids, status } = body;
    const sql = await getDbReady();

    // ── clear_test: delete all proposals with viewCount = 0 owned by user ──
    if (action === 'clear_test') {
      const result = await sql`
        DELETE FROM proposals
        WHERE user_id = ${user.id}
          AND (data_json->>'viewCount')::int = 0
        RETURNING id
      `;
      return NextResponse.json({ success: true, deleted: result.length });
    }

    // All other actions require ids
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: false, error: 'ids array required' }, { status: 400 });
    }

    // Validate all IDs — filter out anything that isn't a valid UUID
    const validIds = ids.filter(isValidUUID);
    if (validIds.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid UUIDs provided' }, { status: 400 });
    }

    // Safety cap — prevent runaway requests (ownership check is the real guard)
    if (validIds.length > 200) {
      return NextResponse.json({ success: false, error: 'Maximum 200 proposals per bulk action' }, { status: 400 });
    }

    if (action === 'delete') {
      // Delete one-by-one to avoid driver issues with large UUID arrays
      // Ownership is checked on every row — safe against cross-user attacks
      let deleted = 0;
      for (const id of validIds) {
        const result = await sql`
          DELETE FROM proposals
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id
        `;
        if (result.length > 0) deleted++;
      }
      return NextResponse.json({ success: true, deleted });
    }

    if (action === 'archive') {
      let updated = 0;
      for (const id of validIds) {
        const result = await sql`
          UPDATE proposals
          SET data_json = jsonb_set(data_json, '{status}', '"archived"'),
              updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id
        `;
        if (result.length > 0) updated++;
      }
      return NextResponse.json({ success: true, updated });
    }

    if (action === 'status') {
      const allowedStatuses = ['draft', 'sent', 'viewed', 'signed', 'accepted', 'rejected', 'archived'];
      if (!status || !allowedStatuses.includes(status)) {
        return NextResponse.json({ success: false, error: 'Invalid status value' }, { status: 400 });
      }
      const safeStatus = JSON.stringify(status);
      let updated = 0;
      for (const id of validIds) {
        const result = await sql`
          UPDATE proposals
          SET data_json = jsonb_set(data_json, '{status}', ${safeStatus}::jsonb),
              updated_at = NOW()
          WHERE id = ${id} AND user_id = ${user.id}
          RETURNING id
        `;
        if (result.length > 0) updated++;
      }
      return NextResponse.json({ success: true, updated });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/proposals/bulk]', err);
  }
}