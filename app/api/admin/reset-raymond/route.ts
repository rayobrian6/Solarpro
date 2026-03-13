import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/reset-raymond?token=solarpro-fix-2024
 * Reset Raymond's password to ChangeMe123! and verify role
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  
  if (token !== 'solarpro-fix-2024') {
    return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
  }

  try {
    const sql = await getDbReady();
    const bcrypt = await import('bcryptjs');
    
    // Hash the password
    const newHash = await bcrypt.hash('ChangeMe123!', 10);
    
    // Update password and ensure role is super_admin
    const result = await sql`
      UPDATE users 
      SET 
        password_hash = ${newHash},
        role = 'super_admin',
        updated_at = NOW()
      WHERE email = 'raymond.obrian@yahoo.com'
      RETURNING id, email, role, subscription_status, is_free_pass, plan
    `;
    
    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Password reset to ChangeMe123! and role set to super_admin',
      user: result[0]
    });

  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/reset-raymond/route.ts]', e);
  }
}