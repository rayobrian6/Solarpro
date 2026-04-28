import { NextRequest, NextResponse } from 'next/server';
import { productionGuard } from '@/lib/security';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/set-roles?secret=YOUR_SECRET
// Emergency endpoint to normalise DB role constraints — dev/staging only.
// Requires: productionGuard (blocks in production) + requireAdminApi (super_admin JWT).
// Hardcoded email list removed — use /api/admin/users PATCH to assign roles instead.
export async function GET(req: NextRequest) {
  // SECURITY: Block in production — use admin panel instead
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  // SECURITY: Require super_admin session even in dev/staging
  const adminCheck = await requireAdminApi(req);
  if (!adminCheck) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

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
    } catch (e: unknown) {
      results.push(`⚠️ Drop constraint: ${(e as Error).message}`);
    }

    // Step 2: Normalize invalid roles
    try {
      await sql`UPDATE users SET role = 'user' WHERE role NOT IN ('user', 'admin', 'super_admin')`;
      results.push('✅ Normalized invalid role values to user');
    } catch (e: unknown) {
      results.push(`⚠️ Normalize roles: ${(e as Error).message}`);
    }

    // Step 3: Add new constraint
    try {
      await sql`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin', 'super_admin'))`;
      results.push('✅ Added new users_role_check constraint');
    } catch (e: unknown) {
      results.push(`⚠️ Add constraint: ${(e as Error).message}`);
    }

    // Note: to assign admin/super_admin roles to specific users, use:
    //   PATCH /api/admin/users  { userId, role }
    // That endpoint is already admin-only and audit-logged.

    return NextResponse.json({ success: true, results });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/set-roles/route.ts]', e);
  }
}