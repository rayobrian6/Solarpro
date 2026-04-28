// ============================================================================
// v47.434 Stage 9.1 — Admin Webhook Replay (STUB)
//
// POST /api/admin/survey-webhook-log/:id/replay
//
// v47.434 SCOPE: returns 501 NOT IMPLEMENTED. The endpoint shape is locked so
// the admin UI can wire to it; the actual replay semantics (re-fetch + re-transform
// + mark status='replayed') land in v47.437.
// ============================================================================
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdminApi(req);
  if (!admin) {

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ success: false, error: 'Delivery id required' }, { status: 400 });
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Replay not implemented',
      reason: 'REPLAY_NOT_IMPLEMENTED',
      note: 'Ships in v47.437 alongside the full ingest pipeline.',
      deliveryId: id,
    },
    { status: 501 },
  );
}