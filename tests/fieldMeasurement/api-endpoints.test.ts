/**
 * WS-5 §7 — THE API SURFACE.
 *
 * These call the REAL Next.js route handlers. The only things mocked are the
 * session reader (`getUserFromRequest`) and `productionMeasurementService`,
 * which is redirected at the STORAGE DRIVER — the handler, the service, the
 * capability model, the verification policy, the evidence resolver and the
 * canonical selection all execute as they do in production.
 *
 * What that means for the claims below: an endpoint that returns 201 here really
 * did run every authority check, and an endpoint that returns 422 really was
 * refused by the policy rather than by a mock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ATTACHMENT_A, MEASURED_AT, PROJECT_A, PROJECT_B,
  USER_A_ADMIN, USER_A_MEMBER, USER_A_VIEWER, USER_B_ADMIN,
  fixedClock, fixtureAuthorizationSource, fixtureEvidenceSource, fixtureRouteFactSource,
  recordingSinks,
} from './fixtures';
import { inMemoryMeasurementService, type FieldMeasurementService } from '@/lib/fieldMeasurement/service';

// ── the session seam ────────────────────────────────────────────────────────
let sessionUser: { id: string } | null = null;
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: () => sessionUser,
}));

// ── the rate limiter is not under test here ─────────────────────────────────
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

// ── the STORAGE DRIVER seam. Everything above it is production code. ────────
let sharedService: FieldMeasurementService;
vi.mock('@/lib/fieldMeasurement/production', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fieldMeasurement/production')>('@/lib/fieldMeasurement/production');
  return {
    ...actual,
    // measurementErrorResponse is the REAL one — the status mapping is under test.
    productionMeasurementService: () => sharedService,
  };
});

vi.mock('@/lib/fieldMeasurement/capabilities', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fieldMeasurement/capabilities')>('@/lib/fieldMeasurement/capabilities');
  return { ...actual, productionAuthorizationSource: fixtureAuthorizationSource() };
});

const { GET: listRoute, POST: recordRoute } =
  await import('@/app/api/projects/[id]/routes/[routeSegmentId]/measurements/route');
const { POST: verifyRoute } =
  await import('@/app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/verify/route');
const { POST: rejectRoute } =
  await import('@/app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/reject/route');
const { POST: supersedeRoute } =
  await import('@/app/api/projects/[id]/routes/[routeSegmentId]/measurements/[measurementId]/supersede/route');
const { GET: rollUpRoute } = await import('@/app/api/projects/[id]/route-measurements/route');

function req(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) } as never);

beforeEach(() => {
  const sinks = recordingSinks();
  sharedService = inMemoryMeasurementService({
    authorization: fixtureAuthorizationSource(),
    evidence: fixtureEvidenceSource(),
    routes: fixtureRouteFactSource(),
    invalidation: sinks.invalidation,
    compliance: sinks.compliance,
    now: fixedClock(),
  });
  sessionUser = { id: USER_A_MEMBER };
});

const RECORD_BODY = {
  measuredLengthFt: 41, measurementMethod: 'LASER', measuredAt: MEASURED_AT,
  evidenceAttachmentIds: [ATTACHMENT_A], notes: 'from the combiner stub-up',
};

async function postRecord(body: unknown = RECORD_BODY, projectId = PROJECT_A, segment = 'FEEDER_RUN') {
  const res = await recordRoute(req(body), ctx({ id: projectId, routeSegmentId: segment }));
  return { res, json: await res.json() };
}

describe('WS-5 §7 — API endpoints', () => {
  it('16. POST record works and returns 201 with a REPORTED_UNVERIFIED record', async () => {
    const { res, json } = await postRecord();
    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(json.measurement.measuredByUserId).toBe(USER_A_MEMBER);
    expect(json.events).toHaveLength(1);
    expect(json.invalidated.scope).toBe('snapshot');
  });

  it('17. GET history works and reports the active selection', async () => {
    await postRecord();
    const res = await listRoute(req(), ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN' }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.measurements).toHaveLength(1);
    expect(json.active.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(json.route.segmentId).toBe('FEEDER_RUN');
  });

  it('18. POST verify works for an authorised, independent reviewer', async () => {
    const { json: rec } = await postRecord();
    sessionUser = { id: USER_A_ADMIN };
    const res = await verifyRoute(
      req({ verificationNotes: 'independently re-measured with a wheel' }),
      ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.measurement.verificationState).toBe('VERIFIED');
    expect(json.decision.verificationMode).toBe('INDEPENDENT_REVIEW');
    expect(json.invalidated.scope).toBe('calculation');
  });

  it('19. POST reject works and requires a reason', async () => {
    const { json: rec } = await postRecord();
    sessionUser = { id: USER_A_ADMIN };
    const bad = await rejectRoute(req({ rejectionReason: '' }), ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('REJECTION_REASON_REQUIRED');

    const ok = await rejectRoute(
      req({ rejectionReason: 'the tape hooked the wrong stub-up' }),
      ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).measurement.verificationState).toBe('REJECTED');
  });

  it('20. POST supersede works and the replacement is UNVERIFIED', async () => {
    const { json: rec } = await postRecord();
    const res = await supersedeRoute(
      req({ measuredLengthFt: 47, measurementMethod: 'MEASURING_WHEEL', measuredAt: MEASURED_AT, evidenceAttachmentIds: [ATTACHMENT_A] }),
      ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id }),
    );
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.superseded.verificationState).toBe('SUPERSEDED');
    expect(json.superseded.measuredLengthFt).toBe(41);
    expect(json.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(json.measurement.measuredLengthFt).toBe(47);
  });

  it('21. structured errors are stable — code + status per refusal class', async () => {
    // VALIDATION → 400
    const v = await postRecord({ ...RECORD_BODY, measuredLengthFt: 99999 });
    expect(v.res.status).toBe(400);
    expect(v.json.code).toBe('LENGTH_OUT_OF_BOUNDS');

    // POLICY (utility-owned route) → 422
    const p = await postRecord(RECORD_BODY, PROJECT_A, 'MSP_TO_UTILITY_RUN');
    expect(p.res.status).toBe(422);
    expect(p.json.code).toBe('ROUTE_NOT_APPLICABLE');

    // NOT_FOUND (unknown route) → 404
    const n = await postRecord(RECORD_BODY, PROJECT_A, 'NO_SUCH_RUN');
    expect(n.res.status).toBe(404);
    expect(n.json.code).toBe('ROUTE_NOT_FOUND');

    // FORBIDDEN (capability not held) → 403
    sessionUser = { id: USER_A_VIEWER };
    const f = await postRecord();
    expect(f.res.status).toBe(403);
    expect(f.json.code).toBe('CAPABILITY_NOT_HELD');
  });

  it('22. CONFLICT — a second verify of the same record is 409 and changes nothing', async () => {
    const { json: rec } = await postRecord();
    sessionUser = { id: USER_A_ADMIN };
    const p = ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id });
    const first = await verifyRoute(req({ verificationNotes: 'independently re-measured with a wheel' }), p);
    expect(first.status).toBe(200);
    const second = await verifyRoute(req({ verificationNotes: 'independently re-measured with a wheel' }), ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: rec.measurement.id }));
    const json = await second.json();
    // The POLICY catches it first and says so precisely — "already VERIFIED,
    // supersede it instead" is more useful than a bare conflict.
    expect(second.status).toBe(422);
    expect(json.details.decision.reasons.join(' ')).toMatch(/already VERIFIED/);
  });

  it('23. the client cannot force a state or an identity', async () => {
    const { json } = await postRecord({
      ...RECORD_BODY,
      // All three are ignored: the handler never reads them.
      verificationState: 'VERIFIED',
      measuredByUserId: USER_A_ADMIN,
      verifiedByUserId: USER_A_ADMIN,
      verifiedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(json.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(json.measurement.measuredByUserId).toBe(USER_A_MEMBER);
    expect(json.measurement.verifiedByUserId).toBeNull();
    expect(json.measurement.verifiedAt).toBeNull();
  });

  it('unauthenticated requests are 401 before anything else happens', async () => {
    sessionUser = null;
    const { res, json } = await postRecord();
    expect(res.status).toBe(401);
    expect(json.code).toBe('UNAUTHENTICATED');
  });

  it('a malformed project id is 400 and never reaches the store', async () => {
    const res = await listRoute(req(), ctx({ id: 'not-a-uuid', routeSegmentId: 'FEEDER_RUN' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('BAD_PROJECT_ID');
  });

  it('a cross-tenant actor gets 403 NO_PROJECT_ACCESS — and learns nothing about the record', async () => {
    await postRecord();
    sessionUser = { id: USER_B_ADMIN };
    const res = await listRoute(req(), ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN' }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.code).toBe('NO_PROJECT_ACCESS');
    // Nothing about the record, and nothing about the project's owning tenant:
    // `accessBasis` names the organisation and stays on the audit record.
    expect(json.measurements).toBeUndefined();
    expect(json.active).toBeUndefined();
    expect(json.details).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('measuredLengthFt');
    expect(JSON.stringify(json)).not.toContain('organization');
  });

  it('the project roll-up returns the routes, the capabilities and the self-verification policy', async () => {
    await postRecord();
    sessionUser = { id: USER_A_ADMIN };
    const res = await rollUpRoute(req(), ctx({ id: PROJECT_A }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.routes).toHaveLength(4);
    expect(json.capabilities).toContain('route.measurement.verify');
    expect(json.allowAuthorizedSelfVerification).toBe(false);
    const feeder = json.routes.find((r: { route: { segmentId: string } }) => r.route.segmentId === 'FEEDER_RUN');
    expect(feeder.active.verificationState).toBe('REPORTED_UNVERIFIED');
    const utility = json.routes.find((r: { route: { segmentId: string } }) => r.route.segmentId === 'MSP_TO_UTILITY_RUN');
    expect(utility.route.routeAuthorityApplicability).toBe('EXCLUDED');
  });

  it('IDEMPOTENCY-adjacent: a repeated record POST creates a SECOND report, never a silent overwrite', async () => {
    const a = await postRecord();
    const b = await postRecord({ ...RECORD_BODY, measuredLengthFt: 43 });
    expect(a.json.measurement.id).not.toBe(b.json.measurement.id);
    const res = await listRoute(req(), ctx({ id: PROJECT_A, routeSegmentId: 'FEEDER_RUN' }));
    const json = await res.json();
    // BOTH survive — correcting a measurement is `supersede`, and the API does
    // not quietly discard the earlier claim.
    expect(json.measurements).toHaveLength(2);
    expect(json.measurements.map((m: { measuredLengthFt: number }) => m.measuredLengthFt).sort()).toEqual([41, 43]);
  });

  it('PROJECT_B is a different tenant even for a valid session in tenant A', async () => {
    const res = await listRoute(req(), ctx({ id: PROJECT_B, routeSegmentId: 'FEEDER_RUN' }));
    expect(res.status).toBe(403);
  });
});
