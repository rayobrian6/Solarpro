// app/api/projects/[id]/routes/[routeSegmentId]/measurements/route.ts
// WS-5 — RECORD a field route measurement, and READ the history for one route.
//
// WHAT THE SERVER SUPPLIES, AND THE CLIENT THEREFORE CANNOT:
//   • the tenant (derived from the project's owner, never from the request);
//   • the project authorization context;
//   • measuredByUserId — the authenticated session, so a client cannot file a
//     measurement under someone else's name;
//   • recordedAt — the platform clock;
//   • verificationState — always REPORTED_UNVERIFIED, with no input that
//     changes it. `body.verificationState` is not read anywhere below, and the
//     service would refuse it if it were.
//
// The client supplies the number, the method, when the tape was on the run, the
// evidence ids and the notes. That is the whole surface.
//
// THIS HANDLER MAKES NO AUTHORITY DECISION. Capability checks, route
// applicability, evidence validation, the audit event and the snapshot
// invalidation all happen in the service. What is here is HTTP: parse, delegate,
// map the error.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { measurementErrorResponse, productionMeasurementService } from '@/lib/fieldMeasurement/production';
import { MEASUREMENT_METHODS } from '@/lib/fieldMeasurement/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string; routeSegmentId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, routeSegmentId } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID format.', code: 'BAD_PROJECT_ID' }, { status: 400 });
  }
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const history = await productionMeasurementService()
      .listHistory(user.id, id, decodeURIComponent(routeSegmentId));
    return NextResponse.json({
      success: true,
      routeSegmentId: history.routeSegmentId,
      route: history.route,
      measurements: history.measurements,
      active: history.active,
      methods: MEASUREMENT_METHODS,
    });
  } catch (err) {
    return measurementErrorResponse('[GET /api/projects/:id/routes/:segment/measurements]', err);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('standard', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, { status: 429 });

  const { id, routeSegmentId } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID format.', code: 'BAD_PROJECT_ID' }, { status: 400 });
  }
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body', code: 'BAD_JSON' }, { status: 400 }); }

  try {
    const result = await productionMeasurementService().record({
      // SERVER-STAMPED. body.measuredByUserId / body.verificationState are never
      // read — a client-supplied identity or state has no path into the record.
      userId: user.id,
      projectId: id,
      routeSegmentId: decodeURIComponent(routeSegmentId),
      measuredLengthFt: typeof body.measuredLengthFt === 'number' ? body.measuredLengthFt : Number.NaN,
      measurementMethod: String(body.measurementMethod ?? ''),
      measuredAt: String(body.measuredAt ?? ''),
      evidenceAttachmentIds: Array.isArray(body.evidenceAttachmentIds) ? body.evidenceAttachmentIds.map(String) : [],
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return NextResponse.json({
      success: true,
      measurement: result.measurement,
      invalidated: result.invalidated,
      events: result.events,
    }, { status: 201 });
  } catch (err) {
    return measurementErrorResponse('[POST /api/projects/:id/routes/:segment/measurements]', err);
  }
}
