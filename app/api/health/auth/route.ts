/**
 * app/api/health/auth/route.ts
 * 
 * Auth system diagnostic endpoint.
 * Returns the status of all auth prerequisites:
 *   - Session cookie detection
 *   - JWT secret loaded
 *   - Database connection working
 * 
 * GET /api/health/auth
 * Returns: { auth: "ok"|"no_cookie", database: "ok"|"error", jwt: "ok"|"missing", ... }
 * 
 * This route is PUBLIC (no auth required) — it is used for diagnostics only.
 * Add /api/health/auth to PUBLIC_PATHS in middleware.ts (already covered by /api/health).
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET(req: NextRequest) {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'unknown',
  };

  // ── Check 1: JWT Secret ────────────────────────────────────────────────────
  const hasJwt = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length > 10;
  result.jwt = hasJwt ? 'ok' : 'missing';
  if (!hasJwt) {
    result.jwt_error = 'JWT_SECRET env var is not set or too short';
    console.error('[AUTH_HEALTH] JWT_SECRET missing or invalid');
  }

  // ── Check 2: Database URL ──────────────────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL;
  const hasDb = !!dbUrl && dbUrl.startsWith('postgresql');
  result.database_url = hasDb ? 'ok' : 'missing';
  if (!hasDb) {
    result.database_error = 'DATABASE_URL env var is not set or invalid';
    console.error('[AUTH_HEALTH] DATABASE_URL missing or invalid');
  }

  // ── Check 3: Database Connection ──────────────────────────────────────────
  if (hasDb) {
    try {
      const sql = neon(dbUrl!);
      const rows = await sql`SELECT 1 AS ping, NOW() AS ts, current_database() AS db`;
      result.database = 'ok';
      result.database_ts = rows[0]?.ts;
      result.database_name = rows[0]?.db;
      console.log(`[AUTH_HEALTH] DB connected: ${rows[0]?.db} at ${rows[0]?.ts}`);
    } catch (e: any) {
      result.database = 'error';
      result.database_error = e.message;
      console.error('[AUTH_HEALTH] DB connection failed:', e.message);
    }
  } else {
    result.database = 'error';
  }

  // ── Check 4: Session Cookie ────────────────────────────────────────────────
  const sessionCookie = req.cookies.get('solarpro_session');
  result.auth = sessionCookie ? 'cookie_present' : 'no_cookie';
  result.auth_note = sessionCookie
    ? 'Session cookie found — user may be authenticated'
    : 'No session cookie — user is not logged in (expected for unauthenticated requests)';

  // ── Check 5: Users table accessible ───────────────────────────────────────
  if (result.database === 'ok') {
    try {
      const sql = neon(dbUrl!);
      const rows = await sql`SELECT COUNT(*) AS user_count FROM users LIMIT 1`;
      result.users_table = 'ok';
      result.user_count = Number(rows[0]?.user_count ?? 0);
    } catch (e: any) {
      result.users_table = 'error';
      result.users_table_error = e.message;
      console.error('[AUTH_HEALTH] Users table query failed:', e.message);
    }
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  const allOk = result.jwt === 'ok' && result.database === 'ok' && result.users_table === 'ok';
  result.status = allOk ? 'healthy' : 'degraded';

  console.log(`[AUTH_HEALTH] status=${result.status} jwt=${result.jwt} db=${result.database} users=${result.users_table}`);

  return NextResponse.json(result, {
    status: allOk ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}