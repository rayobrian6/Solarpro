import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const routeStart = Date.now();

  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const authMs = Date.now() - routeStart;

  try {
    const sql = await getDbReady();
    const dbStart = Date.now();

    // Run ALL queries in a single parallel batch — eliminates serial round-trips.
    // Previously: SELECT 1 (serial) → 6x COUNT (parallel) → table sizes (serial) → db size (serial)
    // Now: all 9 queries fire simultaneously in one Promise.all
    const [
      pingResult,
      userCount,
      projectCount,
      proposalCount,
      layoutCount,
      fileCount,
      clientCount,
      tableSizes,
      dbSize,
    ] = await Promise.all([
      sql`SELECT 1 AS ping`,
      sql`SELECT COUNT(*) AS cnt FROM users`,
      sql`SELECT COUNT(*) AS cnt FROM projects`,
      sql`SELECT COUNT(*) AS cnt FROM proposals`,
      sql`SELECT COUNT(*) AS cnt FROM layouts`,
      sql`SELECT COUNT(*) AS cnt FROM project_files`,
      sql`SELECT COUNT(*) AS cnt FROM clients`,
      sql`
        SELECT relname AS table_name,
               pg_size_pretty(pg_total_relation_size(relid)) AS size,
               pg_total_relation_size(relid) AS size_bytes
        FROM pg_catalog.pg_statio_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 5
      `,
      sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`,
    ]);

    const dbMs = Date.now() - dbStart;
    const totalMs = Date.now() - routeStart;

    // dbLatencyMs = how long the parallel DB batch took (not just a ping)
    const dbLatencyMs = dbMs;

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
      tableSizes: tableSizes.map((r: Record<string, unknown>) => ({
        table:     r.table_name,
        size:      r.size,
        sizeBytes: Number(r.size_bytes),
      })),
      // Timing breakdown for diagnostics
      _timing: {
        authMs,
        dbBatchMs: dbMs,
        totalMs,
      },
    });
  } catch (e: unknown) {
    return handleRouteDbError('[app/api/admin/health/route.ts]', e);
  }
}