import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady , handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  try {
    const sql = await getDbReady();
    const start = Date.now();

    // DB latency ping
    await sql`SELECT 1`;
    const dbLatencyMs = Date.now() - start;

    // Table row counts
    const [
      userCount, projectCount, proposalCount,
      layoutCount, fileCount, clientCount,
    ] = await Promise.all([
      sql`SELECT COUNT(*) AS cnt FROM users`,
      sql`SELECT COUNT(*) AS cnt FROM projects`,
      sql`SELECT COUNT(*) AS cnt FROM proposals`,
      sql`SELECT COUNT(*) AS cnt FROM layouts`,
      sql`SELECT COUNT(*) AS cnt FROM project_files`,
      sql`SELECT COUNT(*) AS cnt FROM clients`,
    ]);

    // Table sizes
    const tableSizes = await sql`
      SELECT relname AS table_name,
             pg_size_pretty(pg_total_relation_size(relid)) AS size,
             pg_total_relation_size(relid) AS size_bytes
      FROM pg_catalog.pg_statio_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 15
    `;

    // DB total size
    const dbSize = await sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `;

    return NextResponse.json({
      success: true,
      dbLatencyMs,
      dbSizeHuman: dbSize[0]?.size ?? 'unknown',
      rowCounts: {
        users:         Number(userCount[0]?.cnt ?? 0),
        projects:      Number(projectCount[0]?.cnt ?? 0),
        proposals:     Number(proposalCount[0]?.cnt ?? 0),
        layouts:       Number(layoutCount[0]?.cnt ?? 0),
        project_files: Number(fileCount[0]?.cnt ?? 0),
        clients:       Number(clientCount[0]?.cnt ?? 0),
      },
      tableSizes: tableSizes.map(r => ({
        table:     r.table_name,
        size:      r.size,
        sizeBytes: Number(r.size_bytes),
      })),
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/health/route.ts]', e);
  }
}