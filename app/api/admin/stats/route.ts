import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const today = new Date().toISOString().split('T')[0];

    const [
      userStats, projectStats, proposalStats,
      layoutStats, fileStats, planStats,
    ] = await Promise.all([
      sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS last30
          FROM users`,
      sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS last30
          FROM projects`,
      sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS last30
          FROM proposals`,
      // 🚨 A FIELD WITH NO WRITER READS AS A MEASURED ZERO.
      //
      // This query selected `total` only, and the response emitted
      // `layouts: { total }` with no `last30`. The dashboard card
      // (app/admin/page.tsx) renders `${l.last30 ?? 0} in last 30 days` for it,
      // exactly like the three cards beside it whose `last30` IS real — so it
      // read "0 in last 30 days" forever, next to a non-zero all-time total, and
      // the zero looked measured. Design velocity appeared permanently flatlined.
      //
      // `layouts.created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` exists
      // (lib/migrations/001_initial_schema.sql), so the same expression the users,
      // projects and proposals queries use applies unchanged — no migration.
      //
      // SEMANTICS, because the number is only honest if they are stated: `layouts`
      // is UPSERTED one row per (project_id, user_id), so this counts layout rows
      // FIRST CREATED in the window, not engineering runs and not saves. The card
      // is labelled to match.
      sql`SELECT COUNT(*) AS total,
               SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END) AS last30
          FROM layouts`,
      sql`SELECT COUNT(*) AS total,
               COALESCE(SUM(file_size), 0) AS total_bytes
          FROM project_files`,
      sql`SELECT plan, COUNT(*) AS cnt FROM users GROUP BY plan ORDER BY cnt DESC`,
    ]);

    // 30-day daily trend for new users
    const userTrend = await sql`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day
    `;

    // 30-day daily trend for new projects
    const projectTrend = await sql`
      SELECT DATE(created_at) AS day, COUNT(*) AS cnt
      FROM projects
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day
    `;

    return NextResponse.json({
      success: true,
      stats: {
        users:     { total: Number(userStats[0]?.total ?? 0),     last30: Number(userStats[0]?.last30 ?? 0) },
        projects:  { total: Number(projectStats[0]?.total ?? 0),  last30: Number(projectStats[0]?.last30 ?? 0) },
        proposals: { total: Number(proposalStats[0]?.total ?? 0), last30: Number(proposalStats[0]?.last30 ?? 0) },
        layouts:   { total: Number(layoutStats[0]?.total ?? 0),    last30: Number(layoutStats[0]?.last30 ?? 0) },
        files:     { total: Number(fileStats[0]?.total ?? 0), totalBytes: Number(fileStats[0]?.total_bytes ?? 0) },
        plans:     planStats.map(r => ({ plan: r.plan, count: Number(r.cnt) })),
        userTrend: userTrend.map(r => ({ day: r.day, count: Number(r.cnt) })),
        projectTrend: projectTrend.map(r => ({ day: r.day, count: Number(r.cnt) })),
      },
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/stats/route.ts]', e);
  }
}