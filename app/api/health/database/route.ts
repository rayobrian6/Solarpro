export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * GET /api/health/database
 *
 * Deep database health check:
 *   - Verifies DATABASE_URL is set
 *   - Tests DB connectivity (SELECT 1)
 *   - Verifies required tables exist
 *
 * Returns HTTP 200 when healthy, 503 when degraded/failing.
 * Called on every deploy and available for uptime monitors.
 *
 * SECURITY: This endpoint is PUBLIC (no auth required).
 * It returns only boolean statuses — no table names, row counts,
 * PostgreSQL version, env var names, or other infrastructure details.
 * Those details are available only via /api/health/env (productionGuard protected).
 */

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { validateEnv } from '@/lib/env-check';

// Required tables — if any of these are missing the app is broken
const REQUIRED_TABLES = ['users', 'clients', 'projects'] as const;

// Optional tables — missing is a warning not an error
const OPTIONAL_TABLES = ['proposals', 'utility_policies', 'bills'] as const;

export async function GET() {
  const startMs = Date.now();
  const timestamp = new Date().toISOString();

  const envResult = validateEnv();

  // ── DB not configured ──────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      timestamp,
      status: 'unhealthy',
      database: 'not_configured',
      env_valid: envResult.valid,
      elapsed_ms: Date.now() - startMs,
    }, { status: 503 });
  }

  // ── DB connectivity ────────────────────────────────────────────────────────
  let sql: ReturnType<typeof neon>;
  try {
    sql = neon(process.env.DATABASE_URL);
    await sql`SELECT 1 AS ping`;
  } catch (e: unknown) {
    console.error(`[HEALTH_DB] Connection failed:`, (e as Error).message);
    return NextResponse.json({
      timestamp,
      status: 'unhealthy',
      database: 'error',
      env_valid: envResult.valid,
      elapsed_ms: Date.now() - startMs,
    }, { status: 503 });
  }

  // ── Table existence check ──────────────────────────────────────────────────
  // SECURITY: We check required tables but do NOT include table names or row counts
  // in the response — those are internal schema details.
  let allRequiredPresent = true;
  let optionalCount = 0;

  const allTables = [...REQUIRED_TABLES, ...OPTIONAL_TABLES];
  try {
    const tableRows = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY(${allTables as unknown as string[]})
    `;

    const rows: { table_name: string }[] = Array.isArray(tableRows)
      ? tableRows as { table_name: string }[]
      : ((tableRows as unknown as { rows: { table_name: string }[] })?.rows ?? []);

    const foundTables = new Set(rows.map(r => r.table_name));

    for (const tbl of REQUIRED_TABLES) {
      if (!foundTables.has(tbl)) {
        allRequiredPresent = false;
        break;
      }
    }

    optionalCount = OPTIONAL_TABLES.filter(t => foundTables.has(t)).length;
  } catch (e: unknown) {
    console.error('[HEALTH_DB] Table check failed:', (e as Error).message);
    return NextResponse.json({
      timestamp,
      status: 'degraded',
      database: 'connected',
      required_tables: false,
      env_valid: envResult.valid,
      elapsed_ms: Date.now() - startMs,
    }, { status: 503 });
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  const isHealthy = allRequiredPresent && envResult.valid;
  const status = isHealthy ? 'healthy' : 'degraded';

  const elapsed = Date.now() - startMs;
  console.log(`[HEALTH_DB] status=${status} tables_ok=${allRequiredPresent} env_ok=${envResult.valid} elapsed=${elapsed}ms`);

  // SECURITY: Response contains only boolean/numeric statuses.
  // No table names, row counts, pg_version, or env var names are included.
  return NextResponse.json({
    timestamp,
    status,
    database: 'connected',
    env_valid: envResult.valid,
    required_tables: allRequiredPresent,
    optional_tables_present: optionalCount,
    optional_tables_total: OPTIONAL_TABLES.length,
    elapsed_ms: elapsed,
  }, { status: isHealthy ? 200 : 503 });
}