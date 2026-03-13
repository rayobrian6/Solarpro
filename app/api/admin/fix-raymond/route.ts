import { NextRequest, NextResponse } from 'next/server';
import { getDbReady } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/fix-raymond?token=solarpro-fix-2024
 * Emergency one-time endpoint to set raymond.obrian@yahoo.com role to super_admin
 * Token is hardcoded for this emergency fix only
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  
  // Simple hardcoded token for this emergency fix
  if (token !== 'solarpro-fix-2024') {
    return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 401 });
  }

  try {
    const sql = await getDbReady();
    const results: string[] = [];

    // Step 1: Check current state
    const before = await sql`
      SELECT email, role, subscription_status, is_free_pass, plan 
      FROM users 
      WHERE email = 'raymond.obrian@yahoo.com' 
      LIMIT 1
    `;
    
    if (before.length === 0) {
      return NextResponse.json({ success: false, error: 'raymond.obrian@yahoo.com not found in DB' }, { status: 404 });
    }
    
    results.push(`BEFORE: email=${before[0].email}, role=${before[0].role}, plan=${before[0].plan}, subscription_status=${before[0].subscription_status}, is_free_pass=${before[0].is_free_pass}`);

    // Step 2: Drop constraint if it blocks super_admin
    try {
      await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
      results.push('✅ Dropped users_role_check constraint');
    } catch (e: any) {
      results.push(`⚠️ Drop constraint: ${e.message}`);
    }

    // Step 3: Set raymond to super_admin
    const updated = await sql`
      UPDATE users 
      SET role = 'super_admin', updated_at = NOW() 
      WHERE email = 'raymond.obrian@yahoo.com' 
      RETURNING email, role
    `;
    
    if (updated.length > 0) {
      results.push(`✅ raymond.obrian@yahoo.com → role = super_admin`);
    } else {
      results.push(`❌ Update returned no rows`);
    }

    // Step 4: Re-add constraint
    try {
      await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'))`;
      results.push('✅ Re-added users_role_check constraint');
    } catch (e: any) {
      results.push(`⚠️ Re-add constraint: ${e.message}`);
    }

    // Step 5: Verify final state
    const after = await sql`
      SELECT email, role, subscription_status, is_free_pass, plan 
      FROM users 
      WHERE email = 'raymond.obrian@yahoo.com' 
      LIMIT 1
    `;
    
    results.push(`AFTER: email=${after[0].email}, role=${after[0].role}, plan=${after[0].plan}, subscription_status=${after[0].subscription_status}, is_free_pass=${after[0].is_free_pass}`);

    return NextResponse.json({ 
      success: true, 
      results,
      final_role: after[0]?.role,
      is_super_admin: after[0]?.role === 'super_admin'
    });

  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/fix-raymond/route.ts]', e);
  }
}