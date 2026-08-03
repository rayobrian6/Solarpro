// app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/supersede/route.ts
// WS-5 — SUPERSEDE a measurement with a corrected one.
//
// THE OLD RECORD'S VALUE IS NEVER EDITED. A new row is written, the two are
// linked in both directions, and the old one is marked SUPERSEDED. That is what
// makes "what did we believe last Tuesday, and on what evidence" answerable.
//
// THE REPLACEMENT IS UNVERIFIED, ALWAYS. Superseding a VERIFIED record does not
// inherit its verification — the new number is a new claim and has to earn its
// own. That is exactly why superseding without a verified replacement REOPENS
// the release requirement, and it is enforced in the repository, not merely
// intended here.

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
    const result = await productionMeasurementService().supersede({
      userId: user.id,
      projectId: id,
      routeSegmentId: decodeURIComponent(routeSegmentId),
      measurementId,
      measuredLengthFt: typeof body.measuredLengthFt === 'number' ? body.measuredLengthFt : Number.NaN,
      measurementMethod: String(body.measurementMethod ?? ''),
      measuredAt: String(body.measuredAt ?? ''),
      evidenceAttachmentIds: Array.isArray(body.evidenceAttachmentIds) ? body.evidenceAttachmentIds.map(String) : [],
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return NextResponse.json({
      success: true,
      measurement: result.measurement,     // the REPLACEMENT — REPORTED_UNVERIFIED
      superseded: result.superseded,       // the retired record, value intact
      invalidated: result.invalidated,
      events: result.events,
    }, { status: 201 });
  } catch (err) {
    return measurementErrorResponse('[POST …/measurements/:id/supersede]', err);
  }
}
