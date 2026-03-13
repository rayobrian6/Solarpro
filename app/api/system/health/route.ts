export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

/**
 * GET /api/system/health
 *
 * Infrastructure-level health check endpoint for ops monitoring,
 * uptime services, and deployment verification.
 *
 * Checks:
 *   1. Database connectivity (live SELECT 1 probe)
 *   2. Environment variable completeness
 *   3. Base URL configuration (no wrong-domain fallback)
 *   4. Email configuration (Resend API key present)
 *
 * Status codes:
 *   200 — healthy or degraded (app is running; degraded means optional vars missing)
 *   503 — unhealthy (required vars missing or DB unreachable)
 *
 * Response shape:
 * {
 *   status:        'healthy' | 'degraded' | 'unhealthy',
 *   version:       string,               // pkg version from package.json
 *   node_env:      string,
 *   vercel_env:    string,
 *   timestamp:     string,               // ISO 8601
 *   elapsed_ms:    number,
 *
 *   checks: {
 *     database:    { ok: boolean; latency_ms: number; error?: string },
 *     env_required:{ ok: boolean; missing: string[] },
 *     env_optional:{ ok: boolean; missing: string[] },
 *     base_url:    { ok: boolean; value: string; source: string },
 *     email:       { ok: boolean; configured: boolean },
 *   }
 * }
 */

import { NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { getBaseUrl } from '@/lib/env';

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectBaseUrlSource(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return 'NEXT_PUBLIC_APP_URL';
  if (process.env.NEXT_PUBLIC_BASE_URL) return 'NEXT_PUBLIC_BASE_URL';
  if (process.env.VERCEL_URL) return 'VERCEL_URL (ephemeral — set NEXT_PUBLIC_APP_URL)';
  return 'hardcoded fallback (set NEXT_PUBLIC_APP_URL)';
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const start = Date.now();

  // ── 1. Database check ──────────────────────────────────────────────────────
  let dbOk = false;
  let dbLatency = 0;
  let dbError: string | undefined;

  try {
    const dbStart = Date.now();
    const sql = await getDbReady();
    await sql`SELECT 1`;
    dbLatency = Date.now() - dbStart;
    dbOk = true;
  } catch (err: any) {
    dbError = err?.message ?? 'unknown error';
  }

  // ── 2. Required env vars ───────────────────────────────────────────────────
  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];
  const missingRequired = REQUIRED.filter(v => !process.env[v]);

  // ── 3. Optional/recommended env vars ──────────────────────────────────────
  const OPTIONAL = [
    'RESEND_API_KEY',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_BASE_URL',
    'OPENAI_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  ];
  const missingOptional = OPTIONAL.filter(v => {
    const val = process.env[v];
    if (!val) return true;
    // Treat placeholder values as missing
    if (val.includes('YOUR_') || val === 're_YOUR_RESEND_API_KEY_HERE') return true;
    return false;
  });

  // ── 4. Base URL check ──────────────────────────────────────────────────────
  const baseUrlValue = getBaseUrl();
  const baseUrlSource = detectBaseUrlSource();
  // Warn if falling back to ephemeral Vercel URL or hardcoded fallback
  const baseUrlOk = !!(
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL
  );

  // ── 5. Email check ─────────────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY;
  const emailConfigured = !!(
    resendKey &&
    resendKey !== 're_YOUR_RESEND_API_KEY_HERE' &&
    !resendKey.includes('YOUR_')
  );

  // ── Overall status ─────────────────────────────────────────────────────────
  const unhealthy = !dbOk || missingRequired.length > 0;
  const degraded  = !unhealthy && (missingOptional.length > 0 || !baseUrlOk || !emailConfigured);
  const status    = unhealthy ? 'unhealthy' : degraded ? 'degraded' : 'healthy';

  // ── Build response ─────────────────────────────────────────────────────────
  let version = 'unknown';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    version = (require('@/../package.json') as { version: string }).version;
  } catch {
    // package.json not available at runtime in some build configs — ignore
  }

  const body = {
    status,
    version,
    node_env:   process.env.NODE_ENV   ?? 'unknown',
    vercel_env: process.env.VERCEL_ENV ?? 'local',
    timestamp:  new Date().toISOString(),
    elapsed_ms: Date.now() - start,

    checks: {
      database: {
        ok:         dbOk,
        latency_ms: dbLatency,
        ...(dbError ? { error: dbError } : {}),
      },
      env_required: {
        ok:      missingRequired.length === 0,
        missing: missingRequired,
      },
      env_optional: {
        ok:      missingOptional.length === 0,
        missing: missingOptional,
      },
      base_url: {
        ok:     baseUrlOk,
        value:  baseUrlValue,
        source: baseUrlSource,
      },
      email: {
        ok:           emailConfigured,
        configured:   emailConfigured,
      },
    },
  };

  const httpStatus = status === 'unhealthy' ? 503 : 200;
  return NextResponse.json(body, { status: httpStatus });
}