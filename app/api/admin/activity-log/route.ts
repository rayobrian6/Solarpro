import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// GET /api/admin/activity-log?page=1&limit=50&action=&adminId=
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit   = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset  = (page - 1) * limit;
  const action  = searchParams.get('action') || '';
  const adminId = searchParams.get('adminId') || '';

  try {
    const sql = getDb();

    // Try to query the activity log — if table doesn't exist yet, return empty
    try {
      const actionPattern = action ? `%${action}%` : '%';
      const adminFilter   = adminId || null;

      const [rows, countRows] = await Promise.all([
        adminFilter
          ? sql`
              SELECT
                l.id, l.action, l.target_company, l.metadata, l.created_at,
                a.name AS admin_name, a.email AS admin_email,
                t.name AS target_name, t.email AS target_email
              FROM admin_activity_log l
              LEFT JOIN users a ON a.id = l.admin_id
              LEFT JOIN users t ON t.id = l.target_user_id
              WHERE l.action ILIKE ${actionPattern}
                AND l.admin_id = ${adminFilter}
              ORDER BY l.created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `
          : sql`
              SELECT
                l.id, l.action, l.target_company, l.metadata, l.created_at,
                a.name AS admin_name, a.email AS admin_email,
                t.name AS target_name, t.email AS target_email
              FROM admin_activity_log l
              LEFT JOIN users a ON a.id = l.admin_id
              LEFT JOIN users t ON t.id = l.target_user_id
              WHERE l.action ILIKE ${actionPattern}
              ORDER BY l.created_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `,
        adminFilter
          ? sql`SELECT COUNT(*) AS total FROM admin_activity_log WHERE action ILIKE ${actionPattern} AND admin_id = ${adminFilter}`
          : sql`SELECT COUNT(*) AS total FROM admin_activity_log WHERE action ILIKE ${actionPattern}`,
      ]);

      return NextResponse.json({
        success: true,
        logs: rows,
        total: Number(countRows[0]?.total ?? 0),
        page,
        limit,
      });
    } catch (tableErr: any) {
      // Table doesn't exist yet — return empty with migration hint
      if (tableErr.message?.includes('does not exist') || tableErr.message?.includes('relation')) {
        return NextResponse.json({
          success: true,
          logs: [],
          total: 0,
          page,
          limit,
          migrationRequired: true,
          hint: 'Run migration 008_admin_activity_log.sql to enable activity logging',
        });
      }
      throw tableErr;
    }
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}