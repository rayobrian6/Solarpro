// app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/reject/route.ts
// WS-5 — REJECT a field report, or WITHDRAW a verification.
//
// Both are the same transition, and both have to be reachable: withdrawing a
// verification is precisely what REOPENS the release requirement, and a model
// where a verification can never be undone is a model where one mistake becomes
// permanent permit-grade authority.
//
// A written reason is MANDATORY. The rejected value is retained — nothing is
// deleted — so the history shows what was claimed, by whom, and why it was
// refused.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { measurementErrorResponse, productionMeasurementService } from '@/lib/fieldMeasurement/production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string; routeSegmentId: string; measurementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, { status: 429 });

  const { id, routeSegmentId, measurementId } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID format.', code: 'BAD_PROJECT_ID' }, { status: 400 });
  }
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body', code: 'BAD_JSON' }, { status: 400 }); }

  try {
    const result = await productionMeasurementService().reject({
      userId: user.id,
      projectId: id,
      routeSegmentId: decodeURIComponent(routeSegmentId),
      measurementId,
      rejectionReason: String(body.rejectionReason ?? ''),
    });
    return NextResponse.json({
      success: true,
      measurement: result.measurement,
      invalidated: result.invalidated,
      events: result.events,
    });
  } catch (err) {
    return measurementErrorResponse('[POST …/measurements/:id/reject]', err);
  }
}
