import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

/**
 * This endpoint is an EXACT copy of /api/auth/me but returns debug info
 * to diagnose why /api/auth/me returns role: "user"
 * 
 * v2: Uses fresh neon() instance each time to bypass any caching
 */
export async function GET(req: NextRequest) {
  try {
    const session = getUserFromRequest(req);
    if (!session?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.id;
    
    // Test 1: Using getDbReady() with retry - same as /api/auth/me
    const sql = await getDbReady();

    let rows: any[] = [];
    let useFallback = false;
    let primaryError: string | null = null;

    try {
      rows = await sql`
        SELECT
          id, name, email, company, phone, role, email_verified, created_at,
          plan, subscription_status, trial_starts_at, trial_ends_at,
          is_free_pass, free_pass_note,
          company_logo_url, company_website, company_address, company_phone,
          brand_primary_color, brand_secondary_color, proposal_footer_text
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    } catch (colErr: any) {
      primaryError = colErr.message;
      useFallback = true;
      rows = await sql`
        SELECT id, name, email, company, phone, role, email_verified, created_at
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    }

    const db = rows[0];
    const cachedResult = {
      useFallback,
      primaryError,
      rawRole: db?.role,
      name: db?.name,
      email: db?.email,
    };

    // Test 2: Using a FRESH neon() instance (not cached)
    const freshSql = neon(process.env.DATABASE_URL!);
    let freshRows: any[] = [];
    let freshError: string | null = null;
    try {
      freshRows = await freshSql`
        SELECT
          id, name, email, company, phone, role, email_verified, created_at,
          plan, subscription_status, trial_starts_at, trial_ends_at,
          is_free_pass, free_pass_note,
          company_logo_url, company_website, company_address, company_phone,
          brand_primary_color, brand_secondary_color, proposal_footer_text
        FROM users WHERE id = ${userId} LIMIT 1
      `;
    } catch (e: any) {
      freshError = e.message;
    }
    const freshDb = freshRows[0];
    const freshResult = {
      rawRole: freshDb?.role,
      name: freshDb?.name,
      error: freshError,
    };

    // Test 3: Simple SELECT role only
    let simpleRole: string | null = null;
    try {
      const simpleRows = await sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`;
      simpleRole = simpleRows[0]?.role;
    } catch (e: any) {
      simpleRole = `ERROR: ${e.message}`;
    }

    // Test 4: SELECT * 
    let starRole: string | null = null;
    try {
      const starRows = await sql`SELECT * FROM users WHERE id = ${userId} LIMIT 1`;
      starRole = starRows[0]?.role;
    } catch (e: any) {
      starRole = `ERROR: ${e.message}`;
    }

    return NextResponse.json({
      userId,
      cachedNeonResult: cachedResult,
      freshNeonResult: freshResult,
      simpleSelectRole: simpleRole,
      starSelectRole: starRole,
      // What /api/auth/me would return
      finalRole: db?.role || 'user',
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    });

  } catch (error: unknown) {
    return handleRouteDbError('[app/api/admin/me-exact-debug/route.ts]', error);
  }
}