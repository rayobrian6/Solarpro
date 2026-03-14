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

import { NextResponse } from 'next/server';
import { BUILD_VERSION } from '@/lib/version';

export const dynamic   = 'force-dynamic';
export const runtime   = 'nodejs';
export const revalidate = 0;

export async function GET() {
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

    missing_required:    missingRequired,
    missing_recommended: missingRecommended,

    runtime: {
      node_version: process.version,
      vercel_env:   process.env.VERCEL_ENV   || null,
      region:       process.env.VERCEL_REGION || null,
      buffer:       typeof Buffer !== 'undefined',
    },

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
}