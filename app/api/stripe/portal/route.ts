export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { handleRouteDbError } from '@/lib/db-neon';
import { createPortalSession } from '@/lib/stripe';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function POST(req: NextRequest) {
  try {
    // ── Rate limiting ──────────────────────────────────────────────────────────
    const rl = await checkRateLimit('stripe', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const result = await createPortalSession(user.id);

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, url: result.url });
  } catch (error: unknown) {
    return handleRouteDbError('[P]', error);
  }
}
