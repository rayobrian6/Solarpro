export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';

/**
 * GET /api/health
 *
 * Lightweight production health endpoint.
 * Returns HTTP 200 when healthy, 503 when degraded or misconfigured.
 *
 * Response shape:
 * {
 *   status:       "healthy" | "degraded" | "unhealthy",
 *   database:     "connected" | "error" | "not_configured",
 *   env_valid:    boolean,
 *   missing_env:  string[],          // required vars that are absent
 *   warned_env:   string[],          // recommended vars that are absent
 *   version:      string,            // BUILD_VERSION from lib/version.ts
 *   timestamp:    string,            // ISO-8601
 *   elapsed_ms:   number,
 * }
 *
 * For a deeper check (table existence, row counts) use /api/health/database.
 * This endpoint is PUBLIC (no auth) — returns no sensitive data.
 */

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { validateEnv, getMissingVars } from '@/lib/env-check';

// BUILD_VERSION is injected by next.config.js at build time
declare const process: NodeJS.Process & { env: Record<string, string | undefined> };

export async function GET() {
  const startMs  = Date.now();
  const timestamp = new Date().toISOString();

  // ── 1. Environment validation ────────────────────────────────────────────
  const envResult  = validateEnv();
  const missingVars = getMissingVars();

  // ── 2. Database connectivity ─────────────────────────────────────────────
  let dbStatus: 'connected' | 'error' | 'not_configured' = 'not_configured';
  let dbError: string | undefined;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    dbStatus = 'not_configured';
    dbError  = 'DATABASE_URL environment variable is not set';
  } else {
    try {
      // Use a fresh neon() instance here (not the cached singleton) so that
      // the health endpoint is independent of the main request path.
      // This is intentional — health must reflect real-time DB reachability.
      const sql  = neon(dbUrl);
      await sql`SELECT 1 AS ping`;
      dbStatus = 'connected';
    } catch (e: any) {
      dbStatus = 'error';
      dbError  = e?.message ?? 'Unknown database error';
      console.error('[HEALTH] DB connectivity check failed:', dbError);
    }
  }

  // ── 3. Overall status ────────────────────────────────────────────────────
  const isHealthy = dbStatus === 'connected' && envResult.valid;
  const isDegraded = dbStatus === 'connected' && !envResult.valid;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (isHealthy) {
    status = 'healthy';
  } else if (isDegraded || (dbStatus === 'connected' && missingVars.recommended.length > 0)) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  // ── 4. Build response ────────────────────────────────────────────────────
  const elapsed = Date.now() - startMs;

  const body = {
    status,
    database:    dbStatus,
    env_valid:   envResult.valid,
    missing_env: missingVars.required,      // required vars that are absent
    warned_env:  missingVars.recommended,   // recommended vars that are absent
    env_details: envResult.details,         // per-var boolean map
    ...(dbError ? { db_error: dbError } : {}),
    version:     process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'unknown',
    node_env:    process.env.NODE_ENV ?? 'unknown',
    vercel_env:  process.env.VERCEL_ENV ?? 'local',
    timestamp,
    elapsed_ms:  elapsed,
  };

  console.log(
    `[HEALTH] status=${status} db=${dbStatus} env_valid=${envResult.valid}` +
    (missingVars.required.length   ? ` missing_required=${missingVars.required.join(',')}` : '') +
    (missingVars.recommended.length ? ` missing_recommended=${missingVars.recommended.join(',')}` : '') +
    ` elapsed=${elapsed}ms`
  );

  return NextResponse.json(body, { status: isHealthy ? 200 : 503 });
}