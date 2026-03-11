import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/check-raymond?token=solarpro-fix-2024
 * Diagnostic: check Raymond's DB records by both email and ID
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  
  if (token !== 'solarpro-fix-2024') {
    return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
  }

  try {
    const sql = getDb();

    // Check by email
    const byEmail = await sql`
      SELECT id, email, role, subscription_status, is_free_pass, plan 
      FROM users 
      WHERE email = 'raymond.obrian@yahoo.com'
    `;

    // Check by ID from JWT
    const byId = await sql`
      SELECT id, email, role, subscription_status, is_free_pass, plan 
      FROM users 
      WHERE id = '011526da-28fc-4c01-85a0-d52c0f578fdf'
    `;

    // Check all raymond-like records
    const allRaymond = await sql`
      SELECT id, email, role, subscription_status, is_free_pass, plan, created_at
      FROM users 
      WHERE email ILIKE '%raymond%' OR email ILIKE '%obrian%'
      ORDER BY created_at
    `;

    return NextResponse.json({
      success: true,
      byEmail,
      byId,
      allRaymond,
      jwtId: '011526da-28fc-4c01-85a0-d52c0f578fdf',
      emailMatch: byEmail.length > 0 ? byEmail[0].id === '011526da-28fc-4c01-85a0-d52c0f578fdf' : false
    });

  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}