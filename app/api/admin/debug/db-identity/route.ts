// ============================================================================
// GET /api/admin/debug/db-identity
//
// Returns identifying information about the database the app is CURRENTLY
// connected to. Read-only, no secrets, no PII.
//
// PURPOSE: When env vars get mass-edited, it's vital to verify which Neon
// database/branch the app is actually talking to. Without this, we're
// guessing whether password-reset fixes hit the right DB.
//
// GATE: requireAdminApi() - session cookie + DB-role=admin/super_admin
//
// RETURNS:
//   {
//     host:                  neon hostname (e.g. ep-xxx-pooler.us-east-1.aws.neon.tech)
//     database:              database name
//     user:                  role name (NO password)
//     ssl_mode:              connection ssl flag if present
//     current_database:      SELECT current_database()
//     current_user:          SELECT current_user
//     version:               PostgreSQL server_version_num
//     users_count:           SELECT COUNT(*) FROM users
//     users_last_updated_at: MAX(updated_at) FROM users (ISO 8601 UTC)
//     projects_count:        COUNT of projects table rows
//     migration_markers:     list of tables that exist (schema fingerprint)
//     env:
//       NODE_ENV
//       VERCEL_ENV
//       VERCEL_REGION
//       VERCEL_GIT_COMMIT_SHA (first 7 chars only)
//   }
// ============================================================================

export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { getDbReady } from '@/lib/db-neon';

function parseDbUrl(url: string | undefined) {
  if (!url) return { host: null, database: null, user: null, ssl_mode: null };
  try {
    // postgres://USER:PASS@HOST:PORT/DBNAME?sslmode=require
    const u = new URL(url);
    const search = new URLSearchParams(u.search);
    return {
      host:     u.hostname || null,
      database: u.pathname.replace(/^\//, '') || null,
      user:     u.username || null,   // role name only, NOT password
      ssl_mode: search.get('sslmode'),
    };
  } catch {
    return { host: null, database: null, user: null, ssl_mode: null, parse_error: true };
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const connInfo = parseDbUrl(process.env.DATABASE_URL);

  let serverFacts: Record<string, unknown> = {};
  let usersCount: number | null = null;
  let usersLastUpdatedAt: string | null = null;
  let projectsCount: number | null = null;
  let tables: string[] = [];

  try {
    const sql = await getDbReady();

    // Server identity
    const facts = await sql`
      SELECT
        current_database() AS db,
        current_user       AS usr,
        current_setting('server_version_num') AS ver,
        inet_server_addr()::text AS server_addr
    `;
    if (facts[0]) {
      serverFacts = {
        current_database: facts[0].db,
        current_user:     facts[0].usr,
        server_version:   facts[0].ver,
        server_addr:      facts[0].server_addr,
      };
    }

    // User metrics (no PII)
    const u = await sql`SELECT COUNT(*)::int AS n, MAX(updated_at) AS last FROM users`;
    if (u[0]) {
      usersCount = u[0].n;
      usersLastUpdatedAt = u[0].last ? new Date(u[0].last).toISOString() : null;
    }

    // Projects count (sanity)
    try {
      const p = await sql`SELECT COUNT(*)::int AS n FROM projects`;
      if (p[0]) projectsCount = p[0].n;
    } catch { /* table may not exist in this env */ }

    // Schema fingerprint - list of public tables
    const t = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    tables = t.map((r: { table_name: string }) => r.table_name);

  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: (err as Error)?.message || 'DB probe failed',
      connection_from_env: connInfo,
    }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    timestamp_utc: new Date().toISOString(),
    connection_from_env: connInfo,
    server_reports:     serverFacts,
    users_count:        usersCount,
    users_last_updated_at: usersLastUpdatedAt,
    projects_count:     projectsCount,
    table_count:        tables.length,
    tables,
    env: {
      NODE_ENV:              process.env.NODE_ENV || null,
      VERCEL_ENV:            process.env.VERCEL_ENV || null,
      VERCEL_REGION:         process.env.VERCEL_REGION || null,
      VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    },
    caller: {
      id:   admin.id,
      role: admin.role,
    },
  });
}