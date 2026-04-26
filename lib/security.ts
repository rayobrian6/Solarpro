// ═══════════════════════════════════════════════════════════════════════
// Security Utilities — Production Exposure Hardening
//
// Shared guards for:
//   - Production environment detection
//   - Debug route gating
//   - Auth requirement enforcement
//   - Safe logging
// ═══════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

// ── Environment Detection ───────────────────────────────────────────

/**
 * True when running in a production deployment.
 * Uses VERCEL_ENV (reliable on Vercel) with NODE_ENV fallback.
 */
export const isProduction: boolean =
  process.env.VERCEL_ENV === 'production' ||
  (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV);

/**
 * True when NOT in production — dev/preview/local.
 */
export const isDev: boolean = !isProduction;

// ── Route Guards ────────────────────────────────────────────────────

/**
 * Production guard for debug/dev routes.
 * Returns a 404 response if in production, null otherwise.
 *
 * Usage:
 *   const _blocked = productionGuard(); if (_blocked) return _blocked;
 */
export function productionGuard(): NextResponse | null {
  if (isProduction) {
    return NextResponse.json(
      { error: 'Not Found' },
      { status: 404 }
    );
  }
  return null;
}

/**
 * Require authenticated user. Returns 401 if not authenticated.
 */
export async function requireAuth(req: NextRequest): Promise<
  | { user: { id: string; email: string; name?: string }; response?: never }
  | { user?: never; response: NextResponse }
> {
  const user = await getUserFromRequest(req);
  if (!user?.id) {
    return {
      response: NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      ),
    };
  }
  return { user };
}

// ── Safe Logging ────────────────────────────────────────────────────

/**
 * Redact sensitive values for logging.
 */
export function redact(value: string | undefined | null, showChars = 4): string {
  if (!value) return '[empty]';
  if (value.length <= showChars) return '***';
  return value.substring(0, showChars) + '***';
}

/**
 * Safe log helper — never logs full secrets, tokens, or passwords.
 */
export function safeLog(tag: string, data: Record<string, any>): void {
  const safe: Record<string, any> = {};
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'hash', 'key', 'authorization', 'cookie'];

  for (const [k, v] of Object.entries(data)) {
    const isSecret = SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s));
    if (isSecret && typeof v === 'string') {
      safe[k] = redact(v);
    } else if (isSecret && v != null) {
      safe[k] = '[REDACTED]';
    } else {
      safe[k] = v;
    }
  }
  console.debug(`[${tag}]`, JSON.stringify(safe));
}

// ── Environment Validation ──────────────────────────────────────────

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'JWT_SECRET'] as const;
const RECOMMENDED_ENV_VARS = [
  'GOOGLE_MAPS_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'NEXT_PUBLIC_BASE_URL',
] as const;

export interface EnvValidationResult {
  valid: boolean;
  missing_required: string[];
  missing_recommended: string[];
}

/**
 * Validate that critical environment variables are set.
 */
export function validateRequiredEnv(): EnvValidationResult {
  const missing_required = REQUIRED_ENV_VARS.filter(
    key => !process.env[key] || process.env[key] === `YOUR_${key}_HERE`
  );
  const missing_recommended = RECOMMENDED_ENV_VARS.filter(
    key => !process.env[key]
  );
  return {
    valid: missing_required.length === 0,
    missing_required: [...missing_required],
    missing_recommended: [...missing_recommended],
  };
}
