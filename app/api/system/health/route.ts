export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

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
 *   5. Monitoring configuration (Sentry DSN present)
 *
 * Status codes:
 *   200 -- healthy or degraded (app is running; degraded means optional vars missing)
 *   503 -- unhealthy (required vars missing or DB unreachable)
 */

import { NextResponse } from 'next/server';
import { getDbReady } from '@/lib/db-neon';
import { getBaseUrl } from '@/lib/env';
import { BUILD_VERSION } from '@/lib/version';

function detectBaseUrlSource(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return 'NEXT_PUBLIC_APP_URL';
  if (process.env.NEXT_PUBLIC_BASE_URL) return 'NEXT_PUBLIC_BASE_URL';
  if (process.env.VERCEL_URL) return 'VERCEL_URL (ephemeral -- set NEXT_PUBLIC_APP_URL)';
  return 'hardcoded fallback (set NEXT_PUBLIC_APP_URL)';
}

export async function GET() {
  const start = Date.now();

  // 1. Database check
  let dbOk = false;
  let dbLatency = 0;
  let dbError: string | undefined;

  try {
    const dbStart = Date.now();
    const sql = await getDbReady();
    await sql`SELECT 1`;
    dbLatency = Date.now() - dbStart;
    dbOk = true;
  } catch (err: unknown) {
    dbError = (err as Error)?.message ?? 'unknown error';
  }

  // 2. Required env vars — only report count, not names (prevents enumeration)
  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'];
  const missingRequiredCount = REQUIRED.filter(v => !process.env[v]).length;

  // 3. Optional/recommended env vars — only report count, not names (prevents enumeration)
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
  const missingOptionalCount = OPTIONAL.filter(v => {
    const val = process.env[v];
    if (!val) return true;
    if (val.includes('YOUR_') || val === 're_YOUR_RESEND_API_KEY_HERE') return true;
    return false;
  }).length;

  // 4. Base URL check
  const baseUrlValue = getBaseUrl();
  const baseUrlSource = detectBaseUrlSource();
  const baseUrlOk = !!(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL);

  // 5. Email check
  const resendKey = process.env.RESEND_API_KEY;
  const emailConfigured = !!(
    resendKey &&
    resendKey !== 're_YOUR_RESEND_API_KEY_HERE' &&
    !resendKey.includes('YOUR_')
  );

  // 6. MFA encryption key check — validates presence and key length
  // SECURITY: NEVER expose the key, decoded bytes, hash, or any derivative.
  // Only reports: name, configured (present), valid_length (base64-decoded === 32 bytes).
  const mfaKey = process.env.MFA_ENCRYPTION_KEY;
  let mfaConfigured = false;
  let mfaValidLength = false;
  if (mfaKey) {
    mfaConfigured = true;
    try {
      const decoded = Buffer.from(mfaKey, 'base64');
      mfaValidLength = decoded.length === 32;
    } catch {
      mfaValidLength = false;
    }
  }

  // 7. Monitoring (Sentry) check
  const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || '';
  const monitoringOk = !!(sentryDsn && sentryDsn.startsWith('https://') && sentryDsn.includes('@'));
  const monitoringProvider = monitoringOk ? 'sentry' : 'console-only';

  // Overall status
  const unhealthy = !dbOk || missingRequiredCount > 0;
  const degraded  = !unhealthy && (missingOptionalCount > 0 || !baseUrlOk || !emailConfigured);
  const status    = unhealthy ? 'unhealthy' : degraded ? 'degraded' : 'healthy';

  const body = {
    status,
    version:    BUILD_VERSION,
    timestamp:  new Date().toISOString(),
    elapsed_ms: Date.now() - start,

    checks: {
      database: {
        ok:         dbOk,
        latency_ms: dbLatency,
        ...(dbError ? { error: dbError } : {}),
      },
      env_required: {
        ok:            missingRequiredCount === 0,
        missing_count: missingRequiredCount,
      },
      env_optional: {
        ok:            missingOptionalCount === 0,
        missing_count: missingOptionalCount,
      },
      base_url: {
        ok:     baseUrlOk,
        // Don't expose the actual base URL value or source to unauthenticated callers
      },
      email: {
        ok:         emailConfigured,
        configured: emailConfigured,
      },
      mfa_encryption: {
        name:          'MFA_ENCRYPTION_KEY',
        configured:    mfaConfigured,
        valid_length:  mfaValidLength,
      },
      monitoring: {
        ok:       monitoringOk,
        provider: monitoringProvider,
      },
    },
  };

  const httpStatus = status === 'unhealthy' ? 503 : 200;
  return NextResponse.json(body, { status: httpStatus });
}
