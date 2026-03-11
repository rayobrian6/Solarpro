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

  // Query 2: Fallback query (base columns only) - EXACT copy from /api/auth/me
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
      email: rows2[0]?.email,
      name: rows2[0]?.name,
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

  // Query 4: Check ALL users with this ID (should be exactly 1)
  try {
    const rows4 = await sql`SELECT id, email, role FROM users WHERE id = ${session.id}`;
    results.queries.allById = {
      count: rows4.length,
      rows: rows4.map((r: any) => ({ id: r.id, email: r.email, role: r.role })),
    };
  } catch (e: any) {
    results.queries.allById = { success: false, error: e.message };
  }

  // Query 5: Check if there's a "phone" column that might be causing issues
  try {
    const rows5 = await sql`
      SELECT id, email, role, phone 
      FROM users WHERE id = ${session.id} LIMIT 1
    `;
    results.queries.withPhone = {
      success: true,
      role: rows5[0]?.role,
      phone: rows5[0]?.phone,
    };
  } catch (e: any) {
    results.queries.withPhone = { success: false, error: e.message };
  }

  // Query 6: Check if the primary query actually fails
  let primaryFailed = false;
  let primaryError = null;
  try {
    await sql`
      SELECT
        id, name, email, company, phone, role, email_verified, created_at,
        plan, subscription_status, trial_starts_at, trial_ends_at,
        is_free_pass, free_pass_note,
        company_logo_url, company_website, company_address, company_phone,
        brand_primary_color, brand_secondary_color, proposal_footer_text
      FROM users WHERE id = ${session.id} LIMIT 1
    `;
  } catch (e: any) {
    primaryFailed = true;
    primaryError = e.message;
  }
  results.primaryQueryFails = primaryFailed;
  results.primaryQueryError = primaryError;

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}
