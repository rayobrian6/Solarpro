import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sql = getDb();
  const id = session.id;
  const results: any = { jwtId: id };

  // Test the EXACT primary query from /api/auth/me
  try {
    const rows = await sql`
      SELECT
        id, name, email, company, phone, role, email_verified, created_at,
        plan, subscription_status, trial_starts_at, trial_ends_at,
        is_free_pass, free_pass_note,
        company_logo_url, company_website, company_address, company_phone,
        brand_primary_color, brand_secondary_color, proposal_footer_text
      FROM users WHERE id = ${id} LIMIT 1
    `;
    results.exactPrimaryQuery = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
      name: rows[0]?.name,
      error: null,
    };
  } catch (e: any) {
    results.exactPrimaryQuery = { error: e.message, role: null };
  }

  // Test the EXACT fallback query from /api/auth/me
  try {
    const rows = await sql`
      SELECT id, name, email, company, phone, role, email_verified, created_at
      FROM users WHERE id = ${id} LIMIT 1
    `;
    results.exactFallbackQuery = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
      name: rows[0]?.name,
      error: null,
    };
  } catch (e: any) {
    results.exactFallbackQuery = { error: e.message, role: null };
  }

  // Test SELECT * to see all columns
  try {
    const rows = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
    results.starQuery = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: any) { results.starQuery = { error: e.message }; }

  // Test SELECT id, email, role (known to return "user")
  try {
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.idEmailRole = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: any) { results.idEmailRole = { error: e.message }; }

  // Test SELECT id, name, email, role (known to return "super_admin")
  try {
    const rows = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.idNameEmailRole = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: any) { results.idNameEmailRole = { error: e.message }; }

  // Check ALL columns in the users table
  try {
    const rows = await sql`
      SELECT column_name, ordinal_position, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    results.allColumns = rows.map((r: any) => `${r.ordinal_position}:${r.column_name}(${r.data_type})`);
  } catch (e: any) { results.allColumns = { error: e.message }; }

  // Check if there are multiple rows for this user ID
  try {
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`;
    results.rowCount = rows.length;
    results.allRows = rows.map((r: any) => ({ id: r.id?.substring(0, 8), role: r.role }));
  } catch (e: any) { results.rowCount = { error: e.message }; }

  // Check if there's a trigger or rule on the users table
  try {
    const rows = await sql`
      SELECT trigger_name, event_manipulation, action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'users' AND trigger_schema = 'public'
    `;
    results.triggers = rows.map((r: any) => `${r.trigger_name}:${r.event_manipulation}:${r.action_timing}`);
  } catch (e: any) { results.triggers = { error: e.message }; }

  // Check if there's a view named "users" shadowing the table
  try {
    const rows = await sql`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_name = 'users' AND table_schema = 'public'
    `;
    results.tableType = rows.map((r: any) => `${r.table_name}:${r.table_type}`);
  } catch (e: any) { results.tableType = { error: e.message }; }

  // CRITICAL: Check if /api/auth/me is hitting the fallback path
  // Simulate the try/catch from /api/auth/me
  let useFallback = false;
  let meRows: any[] = [];
  try {
    meRows = await sql`
      SELECT
        id, name, email, company, phone, role, email_verified, created_at,
        plan, subscription_status, trial_starts_at, trial_ends_at,
        is_free_pass, free_pass_note,
        company_logo_url, company_website, company_address, company_phone,
        brand_primary_color, brand_secondary_color, proposal_footer_text
      FROM users WHERE id = ${id} LIMIT 1
    `;
  } catch (colErr: any) {
    useFallback = true;
    try {
      meRows = await sql`
        SELECT id, name, email, company, phone, role, email_verified, created_at
        FROM users WHERE id = ${id} LIMIT 1
      `;
    } catch (e2: any) {
      results.meSimulation = { error: e2.message };
    }
  }
  
  results.meSimulation = {
    useFallback,
    role: meRows[0]?.role,
    allKeys: meRows[0] ? Object.keys(meRows[0]) : [],
    finalRole: meRows[0]?.role || 'user',
  };

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
  });
}