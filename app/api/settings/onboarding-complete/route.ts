import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady } from '@/lib/db-neon';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/settings/onboarding-complete
 *
 * Marks the guided onboarding tour as completed for the authenticated user.
 * Uses the same `has_seen_tour` + `tour_completed_at` columns as
 * /api/auth/tour-complete (SolarDog tour) so a single DB flag covers both
 * tour surfaces. Idempotent — safe to call multiple times.
 *
 * Called by GuidedTour.tsx (visual overlay) when user finishes or skips
 * the first-run guided tour.
 *
 * Response: { success: true }
 */
export async function POST(req: NextRequest) {
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
    // Idempotent: only writes when has_seen_tour is currently false
    await sql`
      UPDATE users
      SET has_seen_tour    = true,
          tour_completed_at = NOW()
      WHERE id = ${session.id}
        AND has_seen_tour = false
    `;
    return NextResponse.json({ success: true });
  } catch (err) {
    // Non-critical — log but don't fail the client
    console.error('[onboarding-complete] DB error:', err);
    return NextResponse.json({ success: true });
  }
}
