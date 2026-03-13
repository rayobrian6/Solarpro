import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/me-debug
 * Same logic as /api/auth/me but returns raw DB data for debugging
 */
export async function GET(req: NextRequest) {
  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sql = await getDbReady();
  
  // Query 1: by ID (same as /api/auth/me)
  const byId = await sql`
    SELECT id, email, role, subscription_status, is_free_pass, plan 
    FROM users WHERE id = ${session.id} LIMIT 1
  `;

  // Query 2: by email from JWT
  const byEmail = await sql`
    SELECT id, email, role, subscription_status, is_free_pass, plan 
    FROM users WHERE email = ${session.email} LIMIT 1
  `;

  return NextResponse.json({
    jwtId: session.id,
    jwtEmail: session.email,
    byId: byId[0] || null,
    byEmail: byEmail[0] || null,
    idMatchesEmail: byId.length > 0 && byEmail.length > 0 && byId[0].id === byEmail[0].id,
    roleFromId: byId[0]?.role || null,
    roleFromEmail: byEmail[0]?.role || null,
  }, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    }
  });
}