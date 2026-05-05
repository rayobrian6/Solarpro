import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/staff — returns all admin + super_admin users for assignment dropdowns
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();

    const rows = await sql`
      SELECT id, name, email, company, role
      FROM users
      WHERE role IN ('admin', 'super_admin')
      ORDER BY name ASC
    `;

    return NextResponse.json({ success: true, staff: rows });
  } catch (e: unknown) {
    return handleRouteDbError('[GET /api/admin/staff]', e);
  }
}