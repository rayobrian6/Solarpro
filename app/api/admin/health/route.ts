import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const sql = getDb();
  const checks: Record<string, any> = {};

  // DB latency
  const dbStart = Date.now();
  try {
    await sql`SELECT 1`;
    checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch (e: any) {
    checks.database = { status: 'error', error: e.message };
  }

  // Table counts
  try {
    const tables = await sql`
      SELECT schemaname, tablename,
             pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;
    checks.tables = tables;
  } catch (e: any) {
    checks.tables = { error: e.message };
  }

  // DB size
  try {
    const dbSize = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
    checks.dbSize = dbSize[0].size;
  } catch {}

  // Row counts
  try {
    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM users)::int         AS users,
        (SELECT COUNT(*) FROM projects)::int      AS projects,
        (SELECT COUNT(*) FROM clients)::int       AS clients,
        (SELECT COUNT(*) FROM proposals)::int     AS proposals,
        (SELECT COUNT(*) FROM layouts)::int       AS layouts,
        (SELECT COUNT(*) FROM productions)::int   AS productions,
        (SELECT COUNT(*) FROM project_files)::int AS project_files
    `;
    checks.rowCounts = counts[0];
  } catch (e: any) {
    checks.rowCounts = { error: e.message };
  }

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    checks,
  });
}
