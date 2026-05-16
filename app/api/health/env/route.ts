/**
 * app/api/health/env/route.ts
 *
 * Environment variable health check.
 * Returns the status of all required environment variables.
 *
 * GET /api/health/env
 * Returns: { status: 'ok'|'degraded', checks: {...} }
 *
 * This route is PUBLIC (no auth required) — diagnostics only.
 * Never returns actual secret values — only presence/length info.
 */

export const dynamic    = 'force-dynamic';
export const revalidate = 0;
export const runtime    = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { productionGuard } from '@/lib/security';

interface EnvCheck {
  present:  boolean;
  status:   'ok' | 'missing' | 'invalid';
  note?:    string;
}

function checkEnv(name: string, minLen = 1, prefix?: string): EnvCheck {
  const val = process.env[name];
  if (!val || val === `YOUR_${name}_HERE`) {
    // BUG-21-01 FIX: Don't include env var name in note — prevents variable enumeration via response body
    return { present: false, status: 'missing', note: 'Variable is not set in environment' };
  }
  if (val.length < minLen) {
    // BUG-21-01 FIX: Don't leak actual length or minimum — prevents value guessing
    return { present: true, status: 'invalid', note: 'Variable value is too short' };
  }
  if (prefix && !val.startsWith(prefix)) {
    // BUG-21-01 FIX: Don't leak expected prefix — prevents format fingerprinting
    return { present: true, status: 'invalid', note: 'Variable value has unexpected format' };
  }
  return { present: true, status: 'ok' };
}

export async function GET(_req: NextRequest) {
  // SECURITY: Block in production — env var status is internal diagnostics only.
  // Use /api/health (no auth, status-only) for public health checks.
  const _blocked = productionGuard(); if (_blocked) return _blocked;

  try {
    const checks: Record<string, EnvCheck> = {};

    // ── Auth (server-side) ──────────────────────────────────────────────────
    checks.DATABASE_URL            = checkEnv('DATABASE_URL', 20, 'postgresql');
    checks.JWT_SECRET              = checkEnv('JWT_SECRET', 20);

    // ── Google Maps / 3D Tiles (client-side — NEXT_PUBLIC_*) ────────────────
    checks.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = checkEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 20);

    // ── Google server-side APIs ──────────────────────────────────────────────
    checks.GOOGLE_MAPS_API_KEY     = checkEnv('GOOGLE_MAPS_API_KEY', 20);
    checks.GOOGLE_SOLAR_API_KEY    = checkEnv('GOOGLE_SOLAR_API_KEY', 20);

    // ── Optional but useful ─────────────────────────────────────────────────
    checks.NEXT_PUBLIC_CESIUM_ION_TOKEN = checkEnv('NEXT_PUBLIC_CESIUM_ION_TOKEN', 10);
    checks.OPENAI_API_KEY               = checkEnv('OPENAI_API_KEY', 20);

    // ── Critical checks (login + 3D tiles) ──────────────────────────────────
    const criticalKeys = ['DATABASE_URL', 'JWT_SECRET', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'];
    const allCriticalOk = criticalKeys.every(k => checks[k].status === 'ok');
    const anyMissing    = Object.values(checks).some(c => c.status !== 'ok');

    const result = {
      timestamp:   new Date().toISOString(),
      status:      allCriticalOk ? 'ok' : 'degraded',
      critical_ok: allCriticalOk,
      checks,
      // Actionable fix instructions if anything is wrong
      ...(anyMissing && {
        fix: [
          // BUG-21-01 FIX: Removed hardcoded Vercel project name (solarpro-v31) — internal infrastructure detail
          'Go to: Vercel Dashboard → Your Project → Settings → Environment Variables',
          'Add each missing variable shown in the checks above',
          'Check ALL THREE boxes: Production ✓  Preview ✓  Development ✓',
          'Click Save, then redeploy (env vars are NOT hot-reloaded)',
          'Required for login: DATABASE_URL, JWT_SECRET',
          'Required for 3D tiles: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
        ],
      }),
    };

    console.log(`[ENV_HEALTH] status=${result.status}`, Object.fromEntries(
      Object.entries(checks).map(([k, v]) => [k, v.status])
    ));

    return NextResponse.json(result, {
      status: allCriticalOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err: unknown) {
    console.error(`[API_ERROR] /api/health/env: ${(err as Error).message}`);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}