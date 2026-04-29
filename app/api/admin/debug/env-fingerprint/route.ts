/**
 * GET /api/admin/debug/env-fingerprint
 *
 * Reports presence, length, and a short SHA-256 fingerprint for a fixed
 * allow-list of env vars. NEVER returns the raw value. Admin-gated.
 *
 * Purpose: triage-only. Prove what the runtime actually sees for secrets
 * we cannot decrypt via the Vercel API (encrypted-at-rest).
 *
 * Allow-list is hard-coded to prevent arbitrary env enumeration.
 *
 * GATE: requireAdminApi() - session cookie + DB-role=admin/super_admin
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireAdminApi } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Hard-coded allow-list. Adding to this requires code review.
const ALLOWED = [
  'SOLARPRO_HANDOFF_SECRET',
  'SURVEY_WEBHOOK_SECRET',
  'JWT_SECRET',
  'HANDOFF_TOKEN_TTL_SECONDS',
  'WEBHOOK_PRE_INGEST_ACCEPT_202',
  'SURVEY_INGEST_DEFAULT_USER_ID',
] as const;

function fingerprint(value: string) {
  const h = createHash('sha256').update(value, 'utf8').digest('hex');
  return {
    length: value.length,
    sha256_prefix: h.slice(0, 12),
    // Character classes help spot accidental placeholders
    looks_like_placeholder:
      /^(undefined|null|change.?me|placeholder|todo|xxx+|test|example)$/i.test(value),
    starts_with_whsec: value.startsWith('whsec_'),
    meets_32_char_min: value.length >= 32,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: 'Admin authentication required' },
      { status: 401 }
    );
  }

  const report: Record<string, unknown> = {};
  for (const key of ALLOWED) {
    const raw = process.env[key];
    if (raw === undefined || raw === null) {
      report[key] = { present: false };
    } else if (raw === '') {
      report[key] = { present: true, empty: true, length: 0 };
    } else {
      report[key] = { present: true, ...fingerprint(raw) };
    }
  }

  return NextResponse.json({
    ok: true,
    runtime: {
      node_env: process.env.NODE_ENV ?? null,
      vercel_env: process.env.VERCEL_ENV ?? null,
      vercel_region: process.env.VERCEL_REGION ?? null,
      commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
    },
    env: report,
    caller_role: admin.role,
    note: 'Fingerprints only. No raw values returned.',
  });
}