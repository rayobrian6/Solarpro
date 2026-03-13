export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/health/database
 *
 * Deep database health check:
 *   - Verifies DATABASE_URL is set
 *   - Tests DB connectivity (SELECT 1)
 *   - Verifies required tables exist
 *   - Checks row counts on key tables
 *
 * Returns HTTP 200 when healthy, 503 when degraded/failing.
 * Called on every deploy and available for uptime monitors.
 *
 * This endpoint is intentionally PUBLIC (no auth) — same as /api/health.
 * It returns no sensitive data (only table names and boolean statuses).
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
  const checks: Record<string, any> = {
    timestamp,
    env: envResult.details,
    env_valid: envResult.valid,
    env_missing: envResult.missing,
  };

  // ── DB not configured ──────────────────────────────────────────────────────
  if (!process.env.DATABASE_URL) {
    checks.database = 'not_configured';
    checks.tables = {};
    checks.status = 'unhealthy';
    checks.error = 'DATABASE_URL environment variable is not set';
    return NextResponse.json(checks, { status: 503 });
  }

  // ── DB connectivity ────────────────────────────────────────────────────────
  let sql: ReturnType<typeof neon>;
  try {
    sql = neon(process.env.DATABASE_URL);
    const ping = await sql`SELECT 1 AS ping, NOW() AS ts, version() AS pg_version`;
    checks.database = 'connected';
    checks.db_ping = {
      ok: true,
      ts: ping[0]?.ts,
      pg_version: (ping[0]?.pg_version as string)?.split(' ').slice(0, 2).join(' ') ?? 'unknown',
    };
  } catch (e: any) {
    checks.database = 'error';
    checks.db_ping = { ok: false, error: e.message };
    checks.tables = {};
    checks.status = 'unhealthy';
    const elapsed = Date.now() - startMs;
    console.error(`[HEALTH_DB] Connection failed in ${elapsed}ms:`, e.message);
    return NextResponse.json(checks, { status: 503 });
  }

  // ── Table existence check ──────────────────────────────────────────────────
  const tableChecks: Record<string, any> = {};
  let allRequiredPresent = true;

  // Check all tables in a single query
  const allTables = [...REQUIRED_TABLES, ...OPTIONAL_TABLES];
  try {
    const tableRows = await sql`
      SELECT table_name, 
             (SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name) AS approx_rows
      FROM information_schema.tables t
      WHERE table_schema = 'public'
        AND table_name = ANY(${allTables as unknown as string[]})
      ORDER BY table_name
    `;

    // Normalise: neon() returns an array, but other clients may return { rows: [...] }
    const rows: any[] = Array.isArray(tableRows)
      ? tableRows
      : (tableRows as any)?.rows ?? [];

    // If DB is connected but no tables found at all, return a safe diagnostic
    if (!rows.length) {
      checks.tables = {};
      checks.status = 'database_connected_but_no_tables_detected';
      checks.required_tables_present = false;
      checks.missing_required_tables = [...REQUIRED_TABLES];
      checks.elapsed_ms = Date.now() - startMs;
      console.log('[HEALTH_DB] DB connected but no public tables found');
      return NextResponse.json(checks, { status: 503 });
    }

    const foundTables = new Set(rows.map((r: any) => r.table_name as string));

    for (const tbl of REQUIRED_TABLES) {
      const present = foundTables.has(tbl);
      const row = rows.find((r: any) => r.table_name === tbl);
      tableChecks[tbl] = {
        exists: present,
        required: true,
        approx_rows: present ? (row?.approx_rows ?? 'unknown') : null,
      };
      if (!present) allRequiredPresent = false;
    }

    for (const tbl of OPTIONAL_TABLES) {
      const present = foundTables.has(tbl);
      const row = rows.find((r: any) => r.table_name === tbl);
      tableChecks[tbl] = {
        exists: present,
        required: false,
        approx_rows: present ? (row?.approx_rows ?? 'unknown') : null,
      };
    }
  } catch (e: any) {
    checks.tables = { error: e.message };
    checks.status = 'degraded';
    console.error('[HEALTH_DB] Table check failed:', e.message);
    const elapsed = Date.now() - startMs;
    checks.elapsed_ms = elapsed;
    return NextResponse.json(checks, { status: 503 });
  }

  checks.tables = tableChecks;

  // ── Overall status ─────────────────────────────────────────────────────────
  const isHealthy = allRequiredPresent && envResult.valid;
  const isDegraded = !envResult.valid || !allRequiredPresent;

  checks.status = isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy';
  checks.required_tables_present = allRequiredPresent;
  checks.missing_required_tables = REQUIRED_TABLES.filter(t => !tableChecks[t]?.exists);
  checks.elapsed_ms = Date.now() - startMs;

  console.log(`[HEALTH_DB] status=${checks.status} tables_ok=${allRequiredPresent} env_ok=${envResult.valid} elapsed=${checks.elapsed_ms}ms`);

  const httpStatus = isHealthy ? 200 : 503;
  return NextResponse.json(checks, { status: httpStatus });
}