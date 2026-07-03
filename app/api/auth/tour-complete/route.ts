import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';
import { rateLimitGuard } from '@/lib/rateLimitGuard';

export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/auth/tour-complete
 *
 * Marks the onboarding tour as seen for the authenticated user.
 * Safe to call multiple times (idempotent via UPDATE WHERE).
 *
 * Called by SolarDogWithTour when the tour finishes or is skipped.
 */
export async function POST(req: NextRequest) {
  const rlGuard = await rateLimitGuard(req, 'standard');
  if (rlGuard.blocked) return rlGuard.response;

  const session = getUserFromRequest(req);
  if (!session?.id) {
    return NextResponse.json(
      { success: false, error: 'Not authenticated' },
      { status: 401 }
    );
  }

  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Database unavailable' },
      { status: 503 }
    );
  }

  try {
    await sql`
      UPDATE users
      SET has_seen_tour = true,
          tour_completed_at = NOW()
      WHERE id = ${session.id}
        AND has_seen_tour = false
    `;
    return NextResponse.json({ success: true });
  } catch {
    // Non-critical — the tour state can be re-set on next login
    return NextResponse.json({ success: true });
  }
}