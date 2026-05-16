// ============================================================================
// /api/organizations/member
//
// DELETE — remove a member from the org (owner only, body: { memberId })
//          or a member leaving themselves (body: { memberId: self })
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function DELETE(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const { memberId } = await req.json();
    if (!memberId) return NextResponse.json({ success: false, error: 'memberId required' }, { status: 400 });

    const sql = await getDbReady();
    const callerRow = await sql`SELECT org_id, org_role FROM users WHERE id = ${user.id} LIMIT 1`;
    if (!callerRow[0]?.org_id) return NextResponse.json({ success: false, error: 'Not in an org' }, { status: 400 });

    // Only owner can remove others; members can remove themselves
    if (memberId !== user.id && callerRow[0].org_role !== 'owner') {
      return NextResponse.json({ success: false, error: 'Only the owner can remove other members' }, { status: 403 });
    }
    // Owner cannot remove themselves (would orphan the org)
    if (memberId === user.id && callerRow[0].org_role === 'owner') {
      return NextResponse.json({ success: false, error: 'Owner cannot leave — delete the org or transfer ownership first' }, { status: 400 });
    }

    await sql`UPDATE users SET org_id = NULL, org_role = 'owner' WHERE id = ${memberId} AND org_id = ${callerRow[0].org_id}`;
    return NextResponse.json({ success: true });
  } catch (e) {
    return handleRouteDbError('[DELETE /api/organizations/member]', e);
  }
}
