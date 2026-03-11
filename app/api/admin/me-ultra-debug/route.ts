import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sql = getDb();
  const results: any = {
    jwtId: session.id,
    jwtEmail: session.email,
    queries: {}
  };

  // Query 1: Exact same as /api/auth/me primary query
  try {
    const rows1 = await sql`
      SELECT
        id, name, email, company, phone, role, email_verified, created_at,
        plan, subscription_status, trial_starts_at, trial_ends_at,
        is_free_pass, free_pass_note,
        company_logo_url, company_website, company_address, company_phone,
        brand_primary_color, brand_secondary_color, proposal_footer_text
      FROM users WHERE id = ${session.id} LIMIT 1
    `;
    results.queries.fullQuery = {
      success: true,
      rowCount: rows1.length,
      role: rows1[0]?.role,
      id: rows1[0]?.id,
      email: rows1[0]?.email,
    };
  } catch (e: any) {
    results.queries.fullQuery = { success: false, error: e.message };
  }

  // Query 2: Fallback query (base columns only)
  try {
    const rows2 = await sql`
      SELECT id, name, email, company, phone, role, email_verified, created_at
      FROM users WHERE id = ${session.id} LIMIT 1
    `;
    results.queries.fallbackQuery = {
      success: true,
      rowCount: rows2.length,
      role: rows2[0]?.role,
      id: rows2[0]?.id,
    };
  } catch (e: any) {
    results.queries.fallbackQuery = { success: false, error: e.message };
  }

  // Query 3: Raw role check
  try {
    const rows3 = await sql`SELECT id, email, role FROM users WHERE id = ${session.id}`;
    results.queries.rawRole = {
      success: true,
      data: rows3[0] || null,
    };
  } catch (e: any) {
    results.queries.rawRole = { success: false, error: e.message };
  }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
