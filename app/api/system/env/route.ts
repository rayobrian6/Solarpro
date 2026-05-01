// ============================================================
// GET /api/system/env
//
// Deployment diagnostics endpoint — returns env var presence
// status without exposing actual values.
//
// Response shape:
// {
//   status:       "ok" | "degraded" | "critical",
//   version:      string,
//   timestamp:    string,
//   required: {
//     database:   boolean,   // DATABASE_URL present + not placeholder
//     jwt:        boolean,   // JWT_SECRET present
//   },
//   recommended: {
//     google_maps: boolean,
//     openai:      boolean,
//     resend:      boolean,
//     base_url:    boolean,
//   },
//   missing_required:     string[],
//   missing_recommended:  string[],
//   runtime: {
//     node_version:  string,
//     vercel_env:    string | null,
//     region:        string | null,
//     buffer:        boolean,
//   }
// }
//
// Returns HTTP 200 always so uptime monitors don't false-alarm.
// Use `status` field to determine health.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { BUILD_VERSION } from '@/lib/version';
import { requireAuth } from '@/lib/security';

export const dynamic   = 'force-dynamic';
export const runtime   = 'nodejs';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    // SECURITY: Require authenticated user — env status is sensitive
    const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

    const timestamp = new Date().toISOString();

    // ── Required vars ──────────────────────────────────────────────────────────
    const dbUrl     = process.env.DATABASE_URL;
    const jwtSecret = process.env.JWT_SECRET;

    const dbOk  = !!(dbUrl  && dbUrl  !== 'YOUR_NEON_DATABASE_URL_HERE');
    const jwtOk = !!(jwtSecret);

    // ── Recommended vars ───────────────────────────────────────────────────────
    const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
    const openaiKey     = process.env.OPENAI_API_KEY;
    const resendKey     = process.env.RESEND_API_KEY;
    const baseUrl       = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

    const googleMapsOk = !!(googleMapsKey && googleMapsKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE');
    const openaiOk     = !!(openaiKey     && !openaiKey.startsWith('sk-YOUR'));
    const resendOk     = !!(resendKey     && resendKey !== 're_YOUR_RESEND_API_KEY_HERE');
    const baseUrlOk    = !!(baseUrl);

    // ── Missing lists ──────────────────────────────────────────────────────────
    const missingRequired: string[]    = [];
    const missingRecommended: string[] = [];

    if (!dbOk)        missingRequired.push('DATABASE_URL');
    if (!jwtOk)       missingRequired.push('JWT_SECRET');
    if (!googleMapsOk) missingRecommended.push('GOOGLE_MAPS_API_KEY');
    if (!openaiOk)    missingRecommended.push('OPENAI_API_KEY');
    if (!resendOk)    missingRecommended.push('RESEND_API_KEY');
    if (!baseUrlOk)   missingRecommended.push('NEXT_PUBLIC_BASE_URL');

    // ── Overall status ─────────────────────────────────────────────────────────
    const status: 'ok' | 'degraded' | 'critical' =
      missingRequired.length > 0 ? 'critical' :
      missingRecommended.length > 0 ? 'degraded' : 'ok';

    // ── Log on cold start ──────────────────────────────────────────────────────
    const statusIcon = status === 'ok' ? '✅' : status === 'degraded' ? '⚠️' : '🔴';
    console.log(
      `[/api/system/env] ${statusIcon} status=${status}` +
      ` database=${dbOk} jwt=${jwtOk}` +
      ` google_maps=${googleMapsOk} openai=${openaiOk} resend=${resendOk}` +
      (missingRequired.length ? ` MISSING_REQUIRED=${missingRequired.join(',')}` : '')
    );

    // BUG-21-02 FIX: Replace var name arrays with counts only.
    // Runtime fingerprinting fields (node_version, vercel_env, region) removed.
    // requireAuth already restricts to authenticated users, but env var names
    // should not be enumerable by regular users — counts suffice for monitoring.
    return NextResponse.json({
      status,
      version: BUILD_VERSION,
      timestamp,

      required: {
        database:  dbOk,
        jwt:       jwtOk,
      },
      recommended: {
        google_maps: googleMapsOk,
        openai:      openaiOk,
        resend:      resendOk,
        base_url:    baseUrlOk,
      },

      // Counts only — no env var name enumeration
      missing_required_count:    missingRequired.length,
      missing_recommended_count: missingRecommended.length,

      // Feature availability derived from env vars
      features: {
        database_queries:  dbOk,
        authentication:    dbOk && jwtOk,
        geocoding:         googleMapsOk,
        aerial_roof_plan:  googleMapsOk,
        ai_bill_extract:   openaiOk,
        email:             resendOk,
        absolute_urls:     baseUrlOk,
      },
    }, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: unknown) {
    console.error(`[API_ERROR] /api/system/env: ${(err as Error).message}`);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}