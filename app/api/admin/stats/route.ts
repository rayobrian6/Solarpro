import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const sql = getDb();
    const today = new Date().toISOString().split('T')[0];

    const [
      userStats, projectStats, proposalStats,
      layoutStats, fileStats, planStats,
    ] = await Promise.all([
      sql`SELECT
            COUNT(*)::int                                                          AS total,
            COUNT(*) FILTER (WHERE subscription_status NOT IN ('suspended','cancelled'))::int AS active,
            COUNT(*) FILTER (WHERE created_at::date = ${today}::date)::int        AS today,
            COUNT(*) FILTER (WHERE role = 'admin' OR role = 'super_admin')::int   AS admins,
            COUNT(*) FILTER (WHERE is_free_pass = true)::int                      AS free_pass,
            COUNT(*) FILTER (WHERE subscription_status = 'trialing')::int         AS trialing,
            COUNT(*) FILTER (WHERE subscription_status = 'active')::int           AS paid
          FROM users`,
      sql`SELECT
            COUNT(*)::int                                                          AS total,
            COUNT(*) FILTER (WHERE created_at::date = ${today}::date)::int        AS today,
            COUNT(*) FILTER (WHERE status = 'active')::int                        AS active,
            COUNT(*) FILTER (WHERE status = 'completed')::int                     AS completed
          FROM projects WHERE deleted_at IS NULL`,
      sql`SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE created_at::date = ${today}::date)::int AS today
          FROM proposals`,
      sql`SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE created_at::date = ${today}::date)::int AS today
          FROM layouts`,
      sql`SELECT COUNT(*)::int AS total,
            COALESCE(SUM(file_size),0)::bigint AS total_bytes
          FROM project_files`,
      sql`SELECT plan, COUNT(*)::int AS cnt FROM users GROUP BY plan ORDER BY cnt DESC`,
    ]);

    // 30-day trend: projects per day
    const trend = await sql`
      SELECT created_at::date AS day, COUNT(*)::int AS cnt
      FROM projects
      WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL
      GROUP BY day ORDER BY day
    `;

    // 30-day proposals trend
    const proposalTrend = await sql`
      SELECT created_at::date AS day, COUNT(*)::int AS cnt
      FROM proposals
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day
    `;

    return NextResponse.json({
      success: true,
      data: {
        users:       userStats[0],
        projects:    projectStats[0],
        proposals:   proposalStats[0],
        layouts:     layoutStats[0],
        files:       fileStats[0],
        planBreakdown: planStats,
        trends: {
          projects:  trend,
          proposals: proposalTrend,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
