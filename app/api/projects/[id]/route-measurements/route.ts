// app/api/projects/[id]/route-measurements/route.ts
// WS-5 — THE PROJECT ROLL-UP the operator panel reads.
//
// One request returns every applicable route, its CAD lengths, its current
// source/verification state, and the measurement history + active selection per
// route. The panel therefore renders from ONE authority read rather than
// fanning out per segment and assembling a per-route opinion in the browser —
// which is how a UI ends up showing a state the server does not hold.
//
// It is a READ. Every write goes to the per-route endpoints, where the service
// evaluates capabilities and policy.

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { measurementErrorResponse, productionMeasurementService } from '@/lib/fieldMeasurement/production';
import { resolveMeasurementActor, productionAuthorizationSource } from '@/lib/fieldMeasurement/capabilities';
import { selectActiveMeasurement } from '@/lib/fieldMeasurement/resolver';
import { MEASUREMENT_METHODS } from '@/lib/fieldMeasurement/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const rl = await checkRateLimit('engineering', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.', code: 'RATE_LIMITED' }, { status: 429 });

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ success: false, error: 'Invalid project ID format.', code: 'BAD_PROJECT_ID' }, { status: 400 });
  }
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { measurements, routes } = await productionMeasurementService().listProject(user.id, id);
    // The capability set is returned so the panel can HIDE actions the actor
    // cannot perform. Hiding is a courtesy, not the control: every write is
    // re-authorised server-side regardless of what the panel rendered.
    const actor = await resolveMeasurementActor(user.id, id, productionAuthorizationSource);

    const bySegment = new Map<string, typeof measurements>();
    for (const m of measurements) {
      const list = bySegment.get(m.routeSegmentId) ?? [];
      list.push(m);
      bySegment.set(m.routeSegmentId, list);
    }

    return NextResponse.json({
      success: true,
      routes: routes.map(r => {
        const history = bySegment.get(r.segmentId) ?? [];
        return {
          route: r,
          measurements: history,
          active: selectActiveMeasurement(history),
          // NOTE the distinction the panel must render: "there were never any"
          // and "there were some and none of them stand" look identical in a
          // bare count, and they are not the same fact.
          hasOnlyRetiredRecords: history.length > 0 && selectActiveMeasurement(history) == null,
        };
      }),
      capabilities: [...actor.capabilities],
      accessBasis: actor.accessBasis,
      allowAuthorizedSelfVerification: actor.allowAuthorizedSelfVerification,
      currentUserId: user.id,
      methods: MEASUREMENT_METHODS,
    });
  } catch (err) {
    return measurementErrorResponse('[GET /api/projects/:id/route-measurements]', err);
  }
}
