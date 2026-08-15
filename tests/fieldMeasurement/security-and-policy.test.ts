/**
 * WS-5 — TENANT ISOLATION, RBAC AND THE VERIFICATION POLICY.
 *
 * Every case here runs the REAL service, the REAL capability model and the REAL
 * policy evaluator. Only the storage driver and the four external reads are
 * fixtures. Nothing below writes a state field directly.
 */

import { describe, it, expect } from 'vitest';
import { inMemoryMeasurementService } from '@/lib/fieldMeasurement/service';
import { MeasurementError } from '@/lib/fieldMeasurement/types';
import {
  CAPABILITIES_BY_ORG_ROLE, resolveMeasurementActor, ROUTE_MEASUREMENT_CAPABILITIES,
} from '@/lib/fieldMeasurement/capabilities';
import {
  ATTACHMENT_A, ATTACHMENT_B, MEASURED_AT, ORG_A, PROJECT_A, PROJECT_B, PROJECT_SOLO,
  USER_A_ADMIN, USER_A_MEMBER, USER_A_OWNER, USER_A_VIEWER, USER_B_ADMIN, USER_SOLO,
  fixedClock, fixtureAuthorizationSource, fixtureEvidenceSource, fixtureRouteFactSource,
  recordingSinks,
} from './fixtures';

function service(opts: { selfVerificationOrgs?: string[] } = {}) {
  const sinks = recordingSinks();
  const svc = inMemoryMeasurementService({
    authorization: fixtureAuthorizationSource({ selfVerificationOrgs: opts.selfVerificationOrgs }),
    evidence: fixtureEvidenceSource(),
    routes: fixtureRouteFactSource(),
    invalidation: sinks.invalidation,
    compliance: sinks.compliance,
    now: fixedClock(),
  });
  return { svc, sinks };
}

const record = (svc: ReturnType<typeof service>['svc'], userId: string, projectId = PROJECT_A, segment = 'FEEDER_RUN', extra: Record<string, unknown> = {}) =>
  svc.record({
    userId, projectId, routeSegmentId: segment,
    measuredLengthFt: 41, measurementMethod: 'LASER', measuredAt: MEASURED_AT,
    evidenceAttachmentIds: [ATTACHMENT_A], notes: 'pulled from the combiner stub-up',
    ...extra,
  });

async function expectMeasurementError(fn: () => Promise<unknown>, code: string) {
  await expect(fn()).rejects.toThrowError(MeasurementError);
  await fn().catch((e: MeasurementError) => expect(e.code).toBe(code));
}

// ═══════════════════════════════════════════════════════════════════════════
// §18 — MULTI-TENANT SECURITY (the twelve required proofs)
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §18 — multi-tenant security', () => {
  it('1. Tenant A cannot READ tenant B measurements', async () => {
    const a = service();
    await record(a.svc, USER_A_MEMBER);
    // USER_A_MEMBER against PROJECT_B (org B): no capability, no project access.
    await expectMeasurementError(
      () => a.svc.listHistory(USER_A_MEMBER, PROJECT_B, 'FEEDER_RUN'),
      'NO_PROJECT_ACCESS',
    );
  });

  it('2. Tenant A cannot VERIFY tenant B measurements', async () => {
    const a = service();
    await expectMeasurementError(
      () => a.svc.verify({ userId: USER_A_ADMIN, projectId: PROJECT_B, routeSegmentId: 'FEEDER_RUN', measurementId: 'x' }),
      'NO_PROJECT_ACCESS',
    );
  });

  it('3. PROJECT ACCESS is required — a solo owner has no reach into an org project', async () => {
    const a = service();
    await expectMeasurementError(
      () => a.svc.listHistory(USER_SOLO, PROJECT_A, 'FEEDER_RUN'),
      'NO_PROJECT_ACCESS',
    );
  });

  it('4. the ROUTE must belong to the project — an unknown segment is NOT FOUND', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'NO_SUCH_RUN'),
      'ROUTE_NOT_FOUND',
    );
  });

  it('5. an ATTACHMENT from another project is refused, not silently dropped', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'FEEDER_RUN', { evidenceAttachmentIds: [ATTACHMENT_B] }),
      'EVIDENCE_INVALID',
    );
  });

  it('6. the RECORDER identity comes from the session — a client-supplied one has no path in', async () => {
    const a = service();
    const r = await a.svc.record({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measuredLengthFt: 41, measurementMethod: 'TAPE', measuredAt: MEASURED_AT,
      // The service signature has no field for another identity; this asserts the
      // recorded value IS the session user.
    });
    expect(r.measurement.measuredByUserId).toBe(USER_A_MEMBER);
  });

  it('7. the VERIFIER identity comes from the session', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'checked against the as-built stub-up positions',
    });
    expect(v.measurement.verifiedByUserId).toBe(USER_A_ADMIN);
    expect(v.measurement.measuredByUserId).toBe(USER_A_MEMBER);
  });

  it('8. a client cannot submit a VERIFIED state — record() always yields REPORTED_UNVERIFIED', async () => {
    const a = service();
    const r = await a.svc.record({
      userId: USER_A_OWNER,                        // the MOST privileged actor
      projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measuredLengthFt: 41, measurementMethod: 'TAPE', measuredAt: MEASURED_AT,
      // `verificationState` is not a parameter. Even the owner's entry is a report.
    } as never);
    expect(r.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(r.measurement.verifiedByUserId).toBeNull();
  });

  it('9. a client cannot submit a different MEASURED-BY identity (owner records as themself)', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_OWNER);
    expect(r.measurement.measuredByUserId).toBe(USER_A_OWNER);
  });

  it('10. a client cannot forge a verification timestamp — it is server-supplied', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'independently re-measured with a wheel',
    });
    // The fixed clock issues strictly increasing instants; the verification time
    // is one of THOSE, never anything a caller passed.
    expect(v.measurement.verifiedAt).toMatch(/^2026-08-02T12:00:0/);
    expect(Date.parse(v.measurement.verifiedAt!)).toBeGreaterThan(Date.parse(r.measurement.recordedAt));
  });

  it('11. a UTILITY-OWNED excluded route refuses the ordinary project workflow', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'MSP_TO_UTILITY_RUN'),
      'ROUTE_NOT_APPLICABLE',
    );
  });

  it('12. audit events preserve TENANT context', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].tenantId).toBe(`org:${ORG_A}`);
    expect(r.events[0].tenantOrganizationId).toBe(ORG_A);
    expect(r.events[0].projectId).toBe(PROJECT_A);
    // …and the compliance mirror carries the org too.
    expect(a.sinks.mirrored[0].organizationId).toBe(ORG_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — RBAC
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §4 — capabilities', () => {
  it('the capability set is exactly the five WS-5 names', () => {
    expect([...ROUTE_MEASUREMENT_CAPABILITIES]).toEqual([
      'route.measurement.read', 'route.measurement.record', 'route.measurement.verify',
      'route.measurement.reject', 'route.measurement.supersede',
    ]);
  });

  it('no grant is keyed on a job title — the map keys are the platform org roles', () => {
    expect(Object.keys(CAPABILITIES_BY_ORG_ROLE).sort()).toEqual(['admin', 'member', 'owner', 'viewer']);
    const asText = JSON.stringify(CAPABILITIES_BY_ORG_ROLE).toLowerCase();
    for (const title of ['installer', 'manager', 'engineer', 'foreman', 'technician', 'electrician']) {
      expect(asText).not.toContain(title);
    }
  });

  it('a member may RECORD but may not VERIFY', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    expect(r.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    await expectMeasurementError(
      () => a.svc.verify({ userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: r.measurement.id }),
      'CAPABILITY_NOT_HELD',
    );
  });

  it('a viewer may READ and may not RECORD (project access without the capability)', async () => {
    const a = service();
    await expect(a.svc.listHistory(USER_A_VIEWER, PROJECT_A, 'FEEDER_RUN')).resolves.toBeTruthy();
    await expectMeasurementError(() => record(a.svc, USER_A_VIEWER), 'CAPABILITY_NOT_HELD');
  });

  it('a capability held in ANOTHER tenant grants nothing here', async () => {
    const actor = await resolveMeasurementActor(USER_B_ADMIN, PROJECT_A, fixtureAuthorizationSource());
    expect(actor.projectAccess).toBe(false);
    expect(actor.capabilities.size).toBe(0);
    expect(actor.accessBasis).toMatch(/not an active member/);
  });

  it('a solo owner holds every capability over their OWN project only', async () => {
    const own = await resolveMeasurementActor(USER_SOLO, PROJECT_SOLO, fixtureAuthorizationSource());
    expect(own.projectAccess).toBe(true);
    expect(own.capabilities.size).toBe(5);
    const other = await resolveMeasurementActor(USER_SOLO, PROJECT_A, fixtureAuthorizationSource());
    expect(other.projectAccess).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — THE VERIFICATION POLICY
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §5 — verification policy', () => {
  it('INDEPENDENT_REVIEW: a different authorised person verifies, and the mode says so', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 're-measured independently with a wheel',
    });
    expect(v.decision?.allowed).toBe(true);
    expect(v.measurement.verificationMode).toBe('INDEPENDENT_REVIEW');
    expect(v.decision?.evidenceSufficient).toBe(true);
    expect(v.decision?.routeApplicable).toBe(true);
  });

  it('UNAUTHORIZED self-verification is REFUSED by default — recording is not verification', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_ADMIN);       // admin CAN verify…
    await expect(a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'I measured it myself and it is right',
    })).rejects.toThrow(/does not hold an explicit authorized-self-verification policy/);
    // …and the record is untouched.
    const after = await a.svc.listHistory(USER_A_ADMIN, PROJECT_A, 'FEEDER_RUN');
    expect(after.active?.verificationState).toBe('REPORTED_UNVERIFIED');
  });

  it('AUTHORIZED_SELF_VERIFICATION is permitted ONLY with an explicit tenant policy, and is recorded as such', async () => {
    const a = service({ selfVerificationOrgs: [ORG_A] });
    const r = await record(a.svc, USER_A_ADMIN);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'sole reviewer on site; re-walked the run before signing',
    });
    expect(v.measurement.verificationMode).toBe('AUTHORIZED_SELF_VERIFICATION');
  });

  it('a self-verification with NO written notes is refused — the notes are the record of what was checked', async () => {
    const a = service({ selfVerificationOrgs: [ORG_A] });
    const r = await record(a.svc, USER_A_ADMIN);
    await expect(a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'ok',
    })).rejects.toThrow(/written verification notes/);
  });

  it('verification with NO evidence and NO exception is refused', async () => {
    const a = service();
    const r = await a.svc.record({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measuredLengthFt: 41, measurementMethod: 'TAPE', measuredAt: MEASURED_AT,
      evidenceAttachmentIds: [],
    });
    await expect(a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'looks about right',
    })).rejects.toThrow(/no evidence attachment resolved/);
  });

  it('verification proceeds on a DOCUMENTED authorised exception, and the exception is stored', async () => {
    const a = service();
    const r = await a.svc.record({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measuredLengthFt: 41, measurementMethod: 'TAPE', measuredAt: MEASURED_AT,
      evidenceAttachmentIds: [],
    });
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id,
      verificationNotes: 'attended the re-measure in person on 2026-08-02',
      authorizedExceptionReason: 'attic access was sealed after the pull; verifier witnessed the re-measure directly',
    });
    expect(v.decision?.usedEvidenceException).toBe(true);
    expect(v.decision?.evidenceSufficient).toBe(false);
    expect(v.measurement.evidenceExceptionReason).toMatch(/attic access/);
  });

  it('a one-word "exception" is not a documented exception', async () => {
    const a = service();
    const r = await a.svc.record({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measuredLengthFt: 41, measurementMethod: 'TAPE', measuredAt: MEASURED_AT, evidenceAttachmentIds: [],
    });
    await expect(a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'fine, verified it', authorizedExceptionReason: 'n/a',
    })).rejects.toThrow(/too short to be a documented reason/);
  });

  it('evidence deleted AFTER recording stops satisfying verification', async () => {
    const sinks = recordingSinks();
    // The attachment exists at record time…
    let present: Record<string, string> = { [ATTACHMENT_A]: PROJECT_A };
    const svc = inMemoryMeasurementService({
      authorization: fixtureAuthorizationSource(),
      evidence: { async lookup(projectId, ids) {
        return ids.filter(id => present[id] === projectId)
          .map(id => ({ attachmentId: id, present: true, projectId, kind: 'photo', label: 'route photo' }));
      } },
      routes: fixtureRouteFactSource(),
      invalidation: sinks.invalidation, compliance: sinks.compliance, now: fixedClock(),
    });
    const r = await record(svc, USER_A_MEMBER);
    expect(r.measurement.evidenceAttachmentIds).toEqual([ATTACHMENT_A]);
    // …and is gone by verification time.
    present = {};
    await expect(svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'reviewed the photo evidence',
    })).rejects.toThrow(/no evidence attachment resolved/);
  });

  it('an out-of-bounds length is REFUSED, never clamped', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'FEEDER_RUN', { measuredLengthFt: 9999 }),
      'LENGTH_OUT_OF_BOUNDS',
    );
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'FEEDER_RUN', { measuredLengthFt: 0 }),
      'LENGTH_OUT_OF_BOUNDS',
    );
  });

  it('a future measuredAt is refused — a measurement cannot precede itself', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'FEEDER_RUN', { measuredAt: '2030-01-01T00:00:00.000Z' }),
      'MEASURED_AT_FUTURE',
    );
  });

  it('an invalid method is refused', async () => {
    const a = service();
    await expectMeasurementError(
      () => record(a.svc, USER_A_MEMBER, PROJECT_A, 'FEEDER_RUN', { measurementMethod: 'EYEBALL' }),
      'METHOD_INVALID',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 — REJECTION, SUPERSESSION AND INVALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('WS-5 §7 — rejection, supersession, invalidation', () => {
  it('a rejection REQUIRES a written reason', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    await expectMeasurementError(
      () => a.svc.reject({ userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN', measurementId: r.measurement.id, rejectionReason: '' }),
      'REJECTION_REASON_REQUIRED',
    );
  });

  it('supersession preserves the old record and starts the replacement unverified', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'independently checked against the as-built',
    });
    expect(v.measurement.verificationState).toBe('VERIFIED');

    const s = await a.svc.supersede({
      userId: USER_A_MEMBER, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: v.measurement.id,
      measuredLengthFt: 47, measurementMethod: 'MEASURING_WHEEL', measuredAt: MEASURED_AT,
      evidenceAttachmentIds: [ATTACHMENT_A],
    });
    expect(s.superseded.verificationState).toBe('SUPERSEDED');
    expect(s.superseded.measuredLengthFt).toBe(41);          // the old value survives
    expect(s.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(s.measurement.supersedesMeasurementId).toBe(v.measurement.id);
  });

  it('every transition invalidates the dependent artifact', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    expect(a.sinks.invalidations.at(-1)?.scope).toBe('snapshot');
    await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'independently checked against the as-built',
    });
    expect(a.sinks.invalidations.at(-1)?.scope).toBe('calculation');
    expect(a.sinks.invalidations.at(-1)?.reason).toMatch(/VERIFIED/);
  });

  it('an invalidation failure is REPORTED, not swallowed — and does not roll back the audited transition', async () => {
    const svc = inMemoryMeasurementService({
      authorization: fixtureAuthorizationSource(),
      evidence: fixtureEvidenceSource(),
      routes: fixtureRouteFactSource(),
      invalidation: { async invalidate() { throw new Error('ledger table absent'); } },
      now: fixedClock(),
    });
    const r = await record(svc, USER_A_MEMBER);
    expect(r.measurement.verificationState).toBe('REPORTED_UNVERIFIED');
    expect(r.invalidated?.reason).toMatch(/INVALIDATION FAILED: ledger table absent/);
  });

  it('the durable audit event commits WITH the transition (the events come back from the store)', async () => {
    const a = service();
    const r = await record(a.svc, USER_A_MEMBER);
    const v = await a.svc.verify({
      userId: USER_A_ADMIN, projectId: PROJECT_A, routeSegmentId: 'FEEDER_RUN',
      measurementId: r.measurement.id, verificationNotes: 'independently checked against the as-built',
    });
    const events = await a.svc.listEvents(USER_A_ADMIN, PROJECT_A, v.measurement.id);
    expect(events.map(e => e.eventType)).toEqual(['ROUTE_MEASUREMENT_RECORDED', 'ROUTE_MEASUREMENT_VERIFIED']);
    expect(events[1].previousState).toBe('REPORTED_UNVERIFIED');
    expect(events[1].newState).toBe('VERIFIED');
    // ATTACHMENT IDS, never content.
    expect(events[1].detail.evidenceAttachmentIds).toEqual([ATTACHMENT_A]);
    expect(JSON.stringify(events[1].detail)).not.toMatch(/data:|https?:\/\//);
  });
});
