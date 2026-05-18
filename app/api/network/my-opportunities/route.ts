export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// GET /api/network/my-opportunities
// Opportunities the current user has shared (all statuses).
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page  = Math.max(1, parseInt(searchParams.get('page')  || '1'));
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20'));
  const offset = (page - 1) * limit;

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT
        o.*,
        c.id                AS claim_id,
        c.status            AS claim_status,
        c.claimed_by_user_id,
        c.created_at        AS claimed_at,
        cu.company          AS claimer_company,
        cu.name             AS claimer_name,
        cu.phone            AS claimer_phone,
        cu.email            AS claimer_email
      FROM opportunities o
      LEFT JOIN opportunity_claims c
        ON c.opportunity_id = o.id
       AND c.status NOT IN ('released', 'expired')
      LEFT JOIN users cu ON cu.id = c.claimed_by_user_id
      WHERE o.created_by_user_id = ${user.id}
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*) AS total FROM opportunities WHERE created_by_user_id = ${user.id}
    `;

    return NextResponse.json({
      success: true,
      opportunities: rows,
      total: parseInt(String(countRows[0]?.total ?? '0')),
      page,
      limit,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/network/my-opportunities]', err);
  }
}
