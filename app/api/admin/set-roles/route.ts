import { NextRequest, NextResponse } from 'next/server';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/set-roles?secret=YOUR_SECRET
// Emergency endpoint to set admin roles — bypasses JWT auth, uses migrate secret
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  const migrateSecret = process.env.MIGRATE_SECRET;

  if (!migrateSecret) {
    return NextResponse.json({ success: false, error: 'MIGRATE_SECRET not configured' }, { status: 500 });
  }
  if (secret !== migrateSecret) {
    return NextResponse.json({ success: false, error: 'Invalid secret' }, { status: 401 });
  }

  try {
    const sql = await getDbReady();
    const results: string[] = [];

    // Step 1: Drop old constraint
    try {
      await sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`;
      results.push('✅ Dropped old users_role_check constraint');
    } catch (e: any) {
      results.push(`⚠️ Drop constraint: ${e.message}`);
    }

    // Step 2: Normalize invalid roles
    try {
      await sql`UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'admin', 'super_admin')`;
      results.push('✅ Normalized invalid role values to user');
    } catch (e: any) {
      results.push(`⚠️ Normalize roles: ${e.message}`);
    }

    // Step 3: Add new constraint
    try {
      await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'))`;
      results.push('✅ Added new users_role_check constraint');
    } catch (e: any) {
      results.push(`⚠️ Add constraint: ${e.message}`);
    }

    // Step 4: Set roles
    const roleUpdates = [
      { email: 'raymond.obrian@yahoo.com',   role: 'super_admin' },
      { email: 'carpenterjames88@gmail.com',  role: 'admin' },
      { email: 'cody@underthesun.solutions',  role: 'admin' },
    ];

    for (const { email, role } of roleUpdates) {
      try {
        const result = await sql`UPDATE users SET role = ${role}, updated_at = NOW() WHERE email = ${email} RETURNING email, role`;
        if (result.length > 0) {
          results.push(`✅ ${email} → role = ${role}`);
        } else {
          results.push(`⚠️ ${email} — user not found in DB`);
        }
      } catch (e: any) {
        results.push(`❌ ${email}: ${e.message}`);
      }
    }

    // Step 5: Verify
    const verify = await sql`SELECT email, role FROM users WHERE email IN ('raymond.obrian@yahoo.com','carpenterjames88@gmail.com','cody@underthesun.solutions') ORDER BY email`;
    results.push('--- Verification ---');
    for (const row of verify) {
      results.push(`  ${row.email}: role = ${row.role}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/set-roles/route.ts]', e);
  }
}