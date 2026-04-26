import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { requireAdminApi } from '@/lib/adminAuth';
import { productionGuard } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // SECURITY: Block debug routes in production
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // v47.258: Require admin role for debug endpoints
  const adminCheck = await requireAdminApi(req);
  if (adminCheck instanceof NextResponse) return adminCheck;

  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sql = await getDbReady();
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
  } catch (e: unknown) {
    results.exactPrimaryQuery = { error: (e as Error).message, role: null };
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
  } catch (e: unknown) {
    results.exactFallbackQuery = { error: (e as Error).message, role: null };
  }

  // Test SELECT * to see all columns
  try {
    const rows = await sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`;
    results.starQuery = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: unknown) { results.starQuery = { error: (e as Error).message }; }

  // Test SELECT id, email, role (known to return "user")
  try {
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.idEmailRole = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: unknown) { results.idEmailRole = { error: (e as Error).message }; }

  // Test SELECT id, name, email, role (known to return "super_admin")
  try {
    const rows = await sql`SELECT id, name, email, role FROM users WHERE id = ${id} LIMIT 1`;
    results.idNameEmailRole = {
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
      role: rows[0]?.role,
    };
  } catch (e: unknown) { results.idNameEmailRole = { error: (e as Error).message }; }

  // Check ALL columns in the users table
  try {
    const rows = await sql`
      SELECT column_name, ordinal_position, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position
    `;
    results.allColumns = rows.map((r: any) => `${r.ordinal_position}:${r.column_name}(${r.data_type})`);
  } catch (e: unknown) { results.allColumns = { error: (e as Error).message }; }

  // Check if there are multiple rows for this user ID
  try {
    const rows = await sql`SELECT id, email, role FROM users WHERE id = ${id}`;
    results.rowCount = rows.length;
    results.allRows = rows.map((r: any) => ({ id: r.id?.substring(0, 8), role: r.role }));
  } catch (e: unknown) { results.rowCount = { error: (e as Error).message }; }

  // Check if there's a trigger or rule on the users table
  try {
    const rows = await sql`
      SELECT trigger_name, event_manipulation, action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'users' AND trigger_schema = 'public'
    `;
    results.triggers = rows.map((r: any) => `${r.trigger_name}:${r.event_manipulation}:${r.action_timing}`);
  } catch (e: unknown) { results.triggers = { error: (e as Error).message }; }

  // Check if there's a view named "users" shadowing the table
  try {
    const rows = await sql`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_name = 'users' AND table_schema = 'public'
    `;
    results.tableType = rows.map((r: any) => `${r.table_name}:${r.table_type}`);
  } catch (e: unknown) { results.tableType = { error: (e as Error).message }; }

  // NEW: Check Row Level Security policies
  try {
    const rows = await sql`
      SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
      FROM pg_policies
      WHERE tablename = 'users'
    `;
    results.rlsPolicies = rows.map((r: any) => ({
      policy: r.policyname,
      cmd: r.cmd,
      roles: r.roles,
      qual: r.qual,
    }));
  } catch (e: unknown) { results.rlsPolicies = { error: (e as Error).message }; }

  // NEW: Check if RLS is enabled on users table
  try {
    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = 'users' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `;
    results.rlsEnabled = rows[0] ? {
      relrowsecurity: rows[0].relrowsecurity,
      relforcerowsecurity: rows[0].relforcerowsecurity,
    } : null;
  } catch (e: unknown) { results.rlsEnabled = { error: (e as Error).message }; }

  // NEW: Use a FRESH neon() instance (not cached) to run the primary query
  try {
    const freshSql = neon(process.env.DATABASE_URL!);
    const rows = await freshSql`
      SELECT
        id, name, email, company, phone, role, email_verified, created_at,
        plan, subscription_status, trial_starts_at, trial_ends_at,
        is_free_pass, free_pass_note,
        company_logo_url, company_website, company_address, company_phone,
        brand_primary_color, brand_secondary_color, proposal_footer_text
      FROM users WHERE id = ${id} LIMIT 1
    `;
    results.freshNeonPrimaryQuery = {
      role: rows[0]?.role,
      name: rows[0]?.name,
    };
  } catch (e: unknown) { results.freshNeonPrimaryQuery = { error: (e as Error).message }; }

  // NEW: Test with explicit role::text cast to bypass any type coercion
  try {
    const rows = await sql`
      SELECT id, name, email, role::text AS role_cast
      FROM users WHERE id = ${id} LIMIT 1
    `;
    results.roleCast = {
      role_cast: rows[0]?.role_cast,
      allKeys: rows[0] ? Object.keys(rows[0]) : [],
    };
  } catch (e: unknown) { results.roleCast = { error: (e as Error).message }; }

  // NEW: Check if there are other users with role='user' that might be getting returned
  try {
    const rows = await sql`
      SELECT id, email, role FROM users WHERE email = 'raymond.obrian@yahoo.com'
    `;
    results.raymondByEmail = rows.map((r: any) => ({
      id: r.id?.substring(0, 8),
      email: r.email,
      role: r.role,
    }));
  } catch (e: unknown) { results.raymondByEmail = { error: (e as Error).message }; }

  // NEW: Check what the DB returns for the EXACT user ID with explicit cast
  try {
    const rows = await sql`
      SELECT id::text, email::text, role::text
      FROM users WHERE id = ${id} LIMIT 1
    `;
    results.explicitCastQuery = {
      id: rows[0]?.id,
      email: rows[0]?.email,
      role: rows[0]?.role,
    };
  } catch (e: unknown) { results.explicitCastQuery = { error: (e as Error).message }; }

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
  } catch (colErr: unknown) {
    useFallback = true;
    try {
      meRows = await sql`
        SELECT id, name, email, company, phone, role, email_verified, created_at
        FROM users WHERE id = ${id} LIMIT 1
      `;
    } catch (e2: unknown) {
      results.meSimulation = { error: (e2 as Error).message };
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
