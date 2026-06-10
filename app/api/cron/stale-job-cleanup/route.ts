/**
 * GET /api/cron/stale-job-cleanup
 *
 * Vercel Cron Job endpoint that marks stale geometry reconstruction
 * jobs as failed. Called automatically by Vercel Cron (configured in
 * vercel.json) or manually by admins.
 *
 * A job is considered stale if:
 *   - It's been "running" with no heartbeat for 10+ minutes (crashed)
 *   - It's been "queued" for 30+ minutes (orphaned, never picked up)
 *
 * Auth: Requires CRON_SECRET header to prevent unauthorized invocation.
 * Vercel Cron automatically sends this header.
 *
 * SECURITY: This endpoint does NOT require user auth — it's called by
 * the Vercel platform, not by end users. The CRON_SECRET header prevents
 * abuse.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { markStaleJobsAsFailed } from '@/lib/siteSurveys/geometryReconstruction/staleJobCleanup';

/** Constant-time string comparison to prevent timing attacks. */
function safeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(req: NextRequest) {
  // Verify CRON_SECRET to prevent unauthorized access (timing-safe)
  const cronSecret = req.headers.get('X-CRON-SECRET') ?? req.headers.get('Authorization')?.replace('Bearer ', '');
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret) {
    if (!cronSecret || !safeStrEqual(cronSecret, expectedSecret)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing CRON_SECRET' },
        { status: 401 },
      );
    }
  } else if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') {
    // In Vercel production/preview, CRON_SECRET MUST be set to prevent
    // unauthorized invocation of this endpoint.
    console.error('[cron/stale-job-cleanup] CRON_SECRET is not set in production — aborting');
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  // In dev with no CRON_SECRET set, allow through (for local testing)

  try {
    const result = await markStaleJobsAsFailed();
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[cron/stale-job-cleanup] Error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
