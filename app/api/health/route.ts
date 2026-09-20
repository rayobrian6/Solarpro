export const dynamic   = 'force-dynamic';
export const revalidate = 0;
export const runtime   = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/health
 *
 * Lightweight production health endpoint.
 * Returns HTTP 200 when healthy, 503 when degraded or misconfigured.
 *
 * Response shape (public-safe — no env var names or infrastructure details):
 * {
 *   status:    "healthy" | "degraded" | "unhealthy",
 *   database:  "connected" | "error" | "not_configured",
 *   version:   string,
 *   timestamp: string,
 *   elapsed_ms: number,
 * }
 *
 * SECURITY: env var names, missing var lists, and infrastructure details
 * are NOT included in the public response. Use /api/health/env (dev/preview only,
 * productionGuard protected) for internal diagnostics.
 */

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { validateEnv, getMissingVars } from '@/lib/env-check';

// BUILD_VERSION is injected by next.config.js at build time
declare const process: NodeJS.Process & { env: Record<string, string | undefined> };

export async function GET() {
  const startMs  = Date.now();
  const timestamp = new Date().toISOString();

  // ── 1. Environment validation ─────────────────────────────────────────────
  const envResult  = validateEnv();
  const missingVars = getMissingVars();

  // ── 2. Database connectivity ──────────────────────────────────────────────
  let dbStatus: 'connected' | 'error' | 'not_configured' = 'not_configured';
  let dbError: string | undefined;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    dbStatus = 'not_configured';
    dbError  = 'DATABASE_URL environment variable is not set';
  } else {
    try {
      const sql  = neon(dbUrl);
      await sql`SELECT 1 AS ping`;
      dbStatus = 'connected';
    } catch (e: unknown) {
      dbStatus = 'error';
      dbError  = (e as Error)?.message ?? 'Unknown database error';
      console.error('[HEALTH] DB connectivity check failed:', dbError);
    }
  }

  // ── 3. Overall status ─────────────────────────────────────────────────────
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

  // ── 4. Build response ─────────────────────────────────────────────────────
  const elapsed = Date.now() - startMs;

  // SECURITY: Do NOT expose env var names, missing var lists, env_details,
  // node_env, or vercel_env in the public response — these leak infrastructure
  // information (API key names, deployment environment) to unauthenticated callers.
  const body = {
    status,
    database:   dbStatus,
    // 🚨 `version` DOES NOT IDENTIFY THE DEPLOYED CODE, and trusting it has
    // already misled us. next.config.js injects NEXT_PUBLIC_BUILD_VERSION from
    // lib/version.ts at build time, but a project-level environment variable of
    // the same name overrides it at RUNTIME — and production has one pinned. On
    // 2026-09-20 production reported `v60.3` while serving code from a commit
    // that had set it to `v60.5` five months earlier. Anyone asking "did my
    // deploy land?" got a confident wrong answer.
    version:    process.env.NEXT_PUBLIC_BUILD_VERSION ?? 'unknown',
    // THIS is the answer to that question. Vercel sets it per deployment from
    // the git ref actually built; nothing in the dashboard can pin it, and a
    // short sha is not infrastructure information — it is a public commit id in
    // a repository whose owner is asking whether it shipped. Absent outside
    // Vercel (local, CI), which is honest rather than misleading.
    commit:     process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
    ref:        process.env.VERCEL_GIT_COMMIT_REF ?? null,
    timestamp,
    elapsed_ms: elapsed,
    ...(dbError ? { db_error: dbError } : {}),
  };

  console.log(
    `[HEALTH] status=${status} db=${dbStatus} env_valid=${envResult.valid}` +
    (missingVars.required.length   ? ` missing_required_count=${missingVars.required.length}` : '') +
    (missingVars.recommended.length ? ` missing_recommended_count=${missingVars.recommended.length}` : '') +
    ` elapsed=${elapsed}ms`
  );

  return NextResponse.json(body, { status: isHealthy ? 200 : 503 });
}