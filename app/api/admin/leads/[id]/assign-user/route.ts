export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const { id } = params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid lead ID' }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { userId } = body;

    if (!userId || !isValidUUID(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid userId' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify user exists
    const userRows = await sql`
      SELECT id, name, email FROM users WHERE id = ${userId} LIMIT 1
    `;
    if (!userRows.length) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Update lead with user_id
    const rows = await sql`
      UPDATE leads
      SET user_id = ${userId},
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, user_id
    `;

    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      lead: { ...rows[0], owner_name: userRows[0].name, owner_email: userRows[0].email },
    });
  } catch (e: unknown) {
    return handleRouteDbError('[POST /api/admin/leads/:id/assign-user]', e);
  }
}