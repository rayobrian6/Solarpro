export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// GET /api/network/my-claims
// Opportunities the current user has claimed.
// Includes full address since they're the claimer.
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
        c.id            AS claim_id,
        c.status        AS claim_status,
        c.price_paid,
        c.contractor_notes,
        c.outcome,
        c.outcome_notes,
        c.outcome_at,
        c.first_contact_at,
        c.claim_expires_at,
        c.created_at    AS claimed_at
      FROM opportunity_claims c
      JOIN opportunities o ON o.id = c.opportunity_id
      WHERE c.claimed_by_user_id = ${user.id}
      ORDER BY c.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countRows = await sql`
      SELECT COUNT(*) AS total
        FROM opportunity_claims
       WHERE claimed_by_user_id = ${user.id}
    `;

    return NextResponse.json({
      success: true,
      claims: rows,
      total: parseInt(String(countRows[0]?.total ?? '0')),
      page,
      limit,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/network/my-claims]', err);
  }
}
