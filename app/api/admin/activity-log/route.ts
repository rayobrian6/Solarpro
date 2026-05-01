import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/admin/activity-log?page=1&limit=50&action=&adminId=&targetEmail=&dateFrom=&dateTo=
export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const page    = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit   = Math.min(100, parseInt(searchParams.get('limit') || '50'));
  const offset  = (page - 1) * limit;

  // Field length caps — prevent excessively long ILIKE patterns causing slow DB queries
  const action      = (searchParams.get('action') || '').slice(0, 100);
  const adminId     = (searchParams.get('adminId') || '').slice(0, 36);
  const targetEmail = (searchParams.get('targetEmail') || '').slice(0, 254);
  const dateFrom    = (searchParams.get('dateFrom') || '').slice(0, 32);
  const dateTo      = (searchParams.get('dateTo') || '').slice(0, 32);

  // Validate dates — must be ISO date strings (YYYY-MM-DD) or empty
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]*)?$/;
  const validDateFrom = ISO_DATE.test(dateFrom) ? dateFrom : null;
  const validDateTo   = ISO_DATE.test(dateTo)   ? dateTo   : null;

  try {
    const sql = await getDbReady();

    try {
      const actionPattern      = action      ? `%${action}%`      : '%';
      const targetEmailPattern = targetEmail ? `%${targetEmail}%` : '%';
      const adminFilter        = adminId     || null;

      // Build WHERE conditions dynamically using raw SQL function call syntax
      // to support conditional date range filtering
      const [rows, countRows] = await Promise.all([
        sql`
          SELECT
            l.id, l.action, l.target_company, l.metadata, l.created_at,
            a.name  AS admin_name,  a.email  AS admin_email,
            t.name  AS target_name, t.email  AS target_email
          FROM admin_activity_log l
          LEFT JOIN users a ON a.id = l.admin_id
          LEFT JOIN users t ON t.id = l.target_user_id
          WHERE l.action           ILIKE ${actionPattern}
            AND (${adminFilter}::uuid IS NULL OR l.admin_id = ${adminFilter}::uuid)
            AND (t.email ILIKE ${targetEmailPattern} OR ${targetEmail} = '')
            AND (${validDateFrom}::timestamptz IS NULL OR l.created_at >= ${validDateFrom}::timestamptz)
            AND (${validDateTo}::timestamptz   IS NULL OR l.created_at <  (${validDateTo}::timestamptz + INTERVAL '1 day'))
          ORDER BY l.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        sql`
          SELECT COUNT(*) AS total
          FROM admin_activity_log l
          LEFT JOIN users t ON t.id = l.target_user_id
          WHERE l.action           ILIKE ${actionPattern}
            AND (${adminFilter}::uuid IS NULL OR l.admin_id = ${adminFilter}::uuid)
            AND (t.email ILIKE ${targetEmailPattern} OR ${targetEmail} = '')
            AND (${validDateFrom}::timestamptz IS NULL OR l.created_at >= ${validDateFrom}::timestamptz)
            AND (${validDateTo}::timestamptz   IS NULL OR l.created_at <  (${validDateTo}::timestamptz + INTERVAL '1 day'))
        `,
      ]);

      return NextResponse.json({
        success: true,
        logs: rows,
        total: Number(countRows[0]?.total ?? 0),
        page,
        limit,
      });
    } catch (tableErr: unknown) {
      // Table doesn't exist yet — return empty with migration hint
      if ((tableErr as Error).message?.includes('does not exist') || (tableErr as Error).message?.includes('relation')) {
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
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/activity-log/route.ts]', e);
  }
}