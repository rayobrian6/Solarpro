import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, getDb } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * This endpoint is an EXACT copy of /api/auth/me but returns debug info
 * to diagnose why /api/auth/me returns role: "user"
 */
export async function GET(req: NextRequest) {
  try {
    const session = getUserFromRequest(req);
    if (!session?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const userId = session.id;
    const sql = getDb();

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

    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const db = rows[0];

    return NextResponse.json({
      debug: {
        userId,
        useFallback,
        primaryError,
        allKeys: Object.keys(db),
        rawRole: db.role,
        rawRoleType: typeof db.role,
        rawRoleLength: db.role?.length,
        name: db.name,
        email: db.email,
      },
      // This is what /api/auth/me would return
      finalRole: db.role || 'user',
    }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}