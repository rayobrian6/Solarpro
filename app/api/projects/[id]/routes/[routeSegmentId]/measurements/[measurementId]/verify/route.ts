// app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/verify/route.ts
// WS-5 — VERIFY a field route measurement.
//
// THIS ROUTE DOES NOT SET A STATE. It calls the service, which evaluates the
// verification policy — route applicability, evidence (re-resolved now, not
// trusted from record time), separation of duties, the tenant's explicit
// self-verification policy, and written notes where the policy requires them —
// and records WHY verification was permitted alongside the transition.
//
// A refusal returns 422 with every reason, because the operator needs to know
// which of them to fix. The verifier's identity and the verification instant are
// server-supplied; there is no request field for either.

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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is legal here */ }

  try {
    const result = await productionMeasurementService().verify({
      // SERVER-STAMPED verifier. There is no request field for it, and no field
      // for verifiedAt — a client cannot forge either.
      userId: user.id,
      projectId: id,
      routeSegmentId: decodeURIComponent(routeSegmentId),
      measurementId,
      verificationNotes: typeof body.verificationNotes === 'string' ? body.verificationNotes : null,
      authorizedExceptionReason: typeof body.authorizedExceptionReason === 'string' ? body.authorizedExceptionReason : null,
    });
    return NextResponse.json({
      success: true,
      measurement: result.measurement,
      decision: result.decision,
      invalidated: result.invalidated,
      events: result.events,
    });
  } catch (err) {
    return measurementErrorResponse('[POST …/measurements/:id/verify]', err);
  }
}
