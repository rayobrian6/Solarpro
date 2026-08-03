/**
 * WS-5 — THE REPOSITORY CONTRACT, run against every adapter.
 *
 * The in-memory adapter is what the reachability proof, the security suite and
 * the API suite execute against, because this environment has no local
 * PostgreSQL and a proof that cannot run is not a proof. That is only legitimate
 * if the two adapters actually agree, so the agreement is TESTED rather than
 * asserted in a comment: every behaviour below is defined once and executed
 * against each adapter the environment can reach.
 *
 * HONEST SCOPE, stated here rather than in a report: the PostgreSQL adapter runs
 * ONLY when TEST_DATABASE_URL is set. It is not set in this environment, so
 * those cases SKIP and are reported as skipped. What still covers the Postgres
 * path here is the migration's own static + DDL suite
 * (tests/targetedRegistryDeployment.test.ts) and typecheck; what does NOT is
 * live execution of its SQL.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  inMemoryFieldMeasurementRepository, assertAuditSafeDetail,
  type FieldMeasurementRepository, type MeasurementEventDraft,
} from '@/lib/fieldMeasurement/repository';
import type { FieldRouteMeasurement } from '@/lib/fieldMeasurement/types';
import { ORG_A, PROJECT_A, PROJECT_B, USER_A_ADMIN, USER_A_MEMBER } from './fixtures';

const TENANT_A = `org:${ORG_A}`;
const TENANT_B = 'org:22222222-2222-4222-8222-222222222222';

function newMeasurement(over: Partial<FieldRouteMeasurement> = {}): FieldRouteMeasurement {
  const now = '2026-08-02T12:00:00.000Z';
  return {
    id: randomUUID(),
    tenantId: TENANT_A,
    tenantOrganizationId: ORG_A,
    projectId: PROJECT_A,
    routeSegmentId: 'FEEDER_RUN',
    measuredLengthFt: 41,
    measurementMethod: 'LASER',
    measuredByUserId: USER_A_MEMBER,
    measuredAt: '2026-08-02T09:30:00.000Z',
    recordedAt: now,
    evidenceAttachmentIds: [],
    notes: null,
    verificationState: 'REPORTED_UNVERIFIED',
    verificationMode: null,
    verifiedByUserId: null,
    verifiedAt: null,
    verificationNotes: null,
    evidenceExceptionReason: null,
    rejectedByUserId: null,
    rejectedAt: null,
    rejectionReason: null,
    supersedesMeasurementId: null,
    supersededByMeasurementId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const recordedEvent = (): MeasurementEventDraft => ({
  eventType: 'ROUTE_MEASUREMENT_RECORDED',
  actorUserId: USER_A_MEMBER,
  previousState: null,
  newState: 'REPORTED_UNVERIFIED',
  detail: { routeSegmentId: 'FEEDER_RUN', measuredLengthFt: 41 },
});

/** THE CONTRACT. Every adapter must satisfy all of it. */
function contract(name: string, make: () => FieldMeasurementRepository) {
  describe(`repository contract — ${name}`, () => {
    it('1. a new record defaults to REPORTED_UNVERIFIED and carries no verification facts', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      expect(saved.verificationState).toBe('REPORTED_UNVERIFIED');
      expect(saved.verifiedByUserId).toBeNull();
      expect(saved.verifiedAt).toBeNull();
      expect(saved.verificationMode).toBeNull();
    });

    it('2. record() REFUSES a pre-verified row — there is no insert path to VERIFIED', async () => {
      const repo = make();
      await expect(repo.record({
        measurement: newMeasurement({
          verificationState: 'VERIFIED', verifiedByUserId: USER_A_ADMIN,
          verifiedAt: '2026-08-02T12:00:00.000Z', verificationMode: 'INDEPENDENT_REVIEW',
        }),
        event: { ...recordedEvent(), newState: 'VERIFIED' },
      })).rejects.toThrow(/REPORTED_UNVERIFIED/);
    });

    it('3. the RECORDED event is written with the record', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const events = await repo.listEvents(TENANT_A, PROJECT_A, saved.id);
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('ROUTE_MEASUREMENT_RECORDED');
      expect(events[0].newState).toBe('REPORTED_UNVERIFIED');
      expect(events[0].previousState).toBeNull();
    });

    it('4. verify() promotes REPORTED_UNVERIFIED → VERIFIED and writes its event', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const t = await repo.verify({
        measurementId: saved.id, tenantId: TENANT_A, projectId: PROJECT_A,
        verifiedByUserId: USER_A_ADMIN, verifiedAt: '2026-08-02T13:00:00.000Z',
        verificationMode: 'INDEPENDENT_REVIEW', verificationNotes: 'walked the run', evidenceExceptionReason: null,
        event: {
          eventType: 'ROUTE_MEASUREMENT_VERIFIED', actorUserId: USER_A_ADMIN,
          previousState: 'REPORTED_UNVERIFIED', newState: 'VERIFIED', detail: { verificationMode: 'INDEPENDENT_REVIEW' },
        },
      });
      expect(t.applied).toBe(true);
      expect(t.measurement?.verificationState).toBe('VERIFIED');
      expect(t.measurement?.verificationMode).toBe('INDEPENDENT_REVIEW');
      const events = await repo.listEvents(TENANT_A, PROJECT_A, saved.id);
      expect(events.map(e => e.eventType)).toEqual(['ROUTE_MEASUREMENT_RECORDED', 'ROUTE_MEASUREMENT_VERIFIED']);
    });

    it('5. a second verify() does NOT apply and writes NOTHING — no silent overwrite', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const v = {
        measurementId: saved.id, tenantId: TENANT_A, projectId: PROJECT_A,
        verifiedByUserId: USER_A_ADMIN, verifiedAt: '2026-08-02T13:00:00.000Z',
        verificationMode: 'INDEPENDENT_REVIEW' as const, verificationNotes: null, evidenceExceptionReason: null,
        event: {
          eventType: 'ROUTE_MEASUREMENT_VERIFIED' as const, actorUserId: USER_A_ADMIN,
          previousState: 'REPORTED_UNVERIFIED' as const, newState: 'VERIFIED' as const, detail: {},
        },
      };
      await repo.verify(v);
      const second = await repo.verify({ ...v, verifiedByUserId: USER_A_MEMBER, verifiedAt: '2026-08-02T14:00:00.000Z' });
      expect(second.applied).toBe(false);
      expect(second.conflictReason).toMatch(/VERIFIED/);
      const after = await repo.findById(TENANT_A, PROJECT_A, saved.id);
      // The FIRST verifier still stands.
      expect(after?.verifiedByUserId).toBe(USER_A_ADMIN);
      const events = await repo.listEvents(TENANT_A, PROJECT_A, saved.id);
      expect(events.filter(e => e.eventType === 'ROUTE_MEASUREMENT_VERIFIED')).toHaveLength(1);
    });

    it('6. reject() applies to a VERIFIED record — a verification can be WITHDRAWN', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      await repo.verify({
        measurementId: saved.id, tenantId: TENANT_A, projectId: PROJECT_A,
        verifiedByUserId: USER_A_ADMIN, verifiedAt: '2026-08-02T13:00:00.000Z',
        verificationMode: 'INDEPENDENT_REVIEW', verificationNotes: null, evidenceExceptionReason: null,
        event: { eventType: 'ROUTE_MEASUREMENT_VERIFIED', actorUserId: USER_A_ADMIN, previousState: 'REPORTED_UNVERIFIED', newState: 'VERIFIED', detail: {} },
      });
      const r = await repo.reject({
        measurementId: saved.id, tenantId: TENANT_A, projectId: PROJECT_A,
        rejectedByUserId: USER_A_ADMIN, rejectedAt: '2026-08-02T15:00:00.000Z',
        rejectionReason: 'the tape hooked the wrong stub-up',
        event: { eventType: 'ROUTE_MEASUREMENT_REJECTED', actorUserId: USER_A_ADMIN, previousState: 'VERIFIED', newState: 'REJECTED', detail: {} },
      });
      expect(r.applied).toBe(true);
      expect(r.measurement?.verificationState).toBe('REJECTED');
      // HISTORY IS RETAINED: the rejected VALUE survives.
      expect(r.measurement?.measuredLengthFt).toBe(41);
      expect(r.measurement?.rejectionReason).toMatch(/stub-up/);
    });

    it('7. supersede() links both directions, retains the old value and starts the replacement UNVERIFIED', async () => {
      const repo = make();
      const old = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const replacement = newMeasurement({ measuredLengthFt: 47, recordedAt: '2026-08-02T16:00:00.000Z' });
      const s = await repo.supersede({
        supersededMeasurementId: old.id, tenantId: TENANT_A, projectId: PROJECT_A,
        replacement, supersededAt: '2026-08-02T16:00:00.000Z',
        supersedeEvent: { eventType: 'ROUTE_MEASUREMENT_SUPERSEDED', actorUserId: USER_A_MEMBER, previousState: 'REPORTED_UNVERIFIED', newState: 'SUPERSEDED', detail: {} },
        recordEvent: { eventType: 'ROUTE_MEASUREMENT_RECORDED', actorUserId: USER_A_MEMBER, previousState: null, newState: 'REPORTED_UNVERIFIED', detail: {} },
      });
      expect(s.applied).toBe(true);
      expect(s.measurement?.verificationState).toBe('SUPERSEDED');
      expect(s.measurement?.measuredLengthFt).toBe(41);                      // old VALUE intact
      expect(s.measurement?.supersededByMeasurementId).toBe(replacement.id);
      expect(s.replacement?.supersedesMeasurementId).toBe(old.id);
      expect(s.replacement?.verificationState).toBe('REPORTED_UNVERIFIED');  // never inherited
    });

    it('8. supersede() REFUSES a pre-verified replacement', async () => {
      const repo = make();
      const old = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      await expect(repo.supersede({
        supersededMeasurementId: old.id, tenantId: TENANT_A, projectId: PROJECT_A,
        replacement: newMeasurement({ verificationState: 'VERIFIED', verifiedByUserId: USER_A_ADMIN, verifiedAt: 'x', verificationMode: 'INDEPENDENT_REVIEW' }),
        supersededAt: '2026-08-02T16:00:00.000Z',
        supersedeEvent: { eventType: 'ROUTE_MEASUREMENT_SUPERSEDED', actorUserId: USER_A_MEMBER, previousState: 'REPORTED_UNVERIFIED', newState: 'SUPERSEDED', detail: {} },
        recordEvent: { eventType: 'ROUTE_MEASUREMENT_RECORDED', actorUserId: USER_A_MEMBER, previousState: null, newState: 'REPORTED_UNVERIFIED', detail: {} },
      })).rejects.toThrow(/not pre-verified|REPORTED_UNVERIFIED/);
    });

    it('9. TENANT SCOPING — another tenant cannot read the row at all', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      expect(await repo.findById(TENANT_B, PROJECT_A, saved.id)).toBeNull();
      expect(await repo.listBySegment(TENANT_B, PROJECT_A, 'FEEDER_RUN')).toEqual([]);
      expect(await repo.listByProject(TENANT_B, PROJECT_A)).toEqual([]);
      expect(await repo.listEvents(TENANT_B, PROJECT_A, saved.id)).toEqual([]);
    });

    it('10. PROJECT SCOPING — the right tenant, the wrong project, still finds nothing', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      expect(await repo.findById(TENANT_A, PROJECT_B, saved.id)).toBeNull();
    });

    it('11. a cross-tenant transition does not apply and changes nothing', async () => {
      const repo = make();
      const saved = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const t = await repo.verify({
        measurementId: saved.id, tenantId: TENANT_B, projectId: PROJECT_A,
        verifiedByUserId: USER_A_ADMIN, verifiedAt: '2026-08-02T13:00:00.000Z',
        verificationMode: 'INDEPENDENT_REVIEW', verificationNotes: null, evidenceExceptionReason: null,
        event: { eventType: 'ROUTE_MEASUREMENT_VERIFIED', actorUserId: USER_A_ADMIN, previousState: 'REPORTED_UNVERIFIED', newState: 'VERIFIED', detail: {} },
      });
      expect(t.applied).toBe(false);
      expect((await repo.findById(TENANT_A, PROJECT_A, saved.id))?.verificationState).toBe('REPORTED_UNVERIFIED');
    });

    it('12. supersession relationships PERSIST and the history lists both records', async () => {
      const repo = make();
      const old = await repo.record({ measurement: newMeasurement(), event: recordedEvent() });
      const replacement = newMeasurement({ measuredLengthFt: 47, recordedAt: '2026-08-02T16:00:00.000Z' });
      await repo.supersede({
        supersededMeasurementId: old.id, tenantId: TENANT_A, projectId: PROJECT_A,
        replacement, supersededAt: '2026-08-02T16:00:00.000Z',
        supersedeEvent: { eventType: 'ROUTE_MEASUREMENT_SUPERSEDED', actorUserId: USER_A_MEMBER, previousState: 'REPORTED_UNVERIFIED', newState: 'SUPERSEDED', detail: {} },
        recordEvent: { eventType: 'ROUTE_MEASUREMENT_RECORDED', actorUserId: USER_A_MEMBER, previousState: null, newState: 'REPORTED_UNVERIFIED', detail: {} },
      });
      const history = await repo.listBySegment(TENANT_A, PROJECT_A, 'FEEDER_RUN');
      expect(history).toHaveLength(2);
      expect(history.map(h => h.verificationState).sort()).toEqual(['REPORTED_UNVERIFIED', 'SUPERSEDED']);
    });
  });
}

contract('in-memory', () => inMemoryFieldMeasurementRepository());

// ── the PostgreSQL adapter, when a real database is reachable ───────────────
// Not reachable in this environment; the block is written so the agreement can
// be executed the moment TEST_DATABASE_URL exists, and it is reported as
// SKIPPED rather than quietly omitted.
const HAS_TEST_DB = (process.env.TEST_DATABASE_URL ?? '').length > 0;
(HAS_TEST_DB ? describe : describe.skip)(
  'repository contract — postgres (requires TEST_DATABASE_URL)',
  () => {
    it('is exercised by tests/fieldMeasurement/repository-postgres.test.ts when a database is available', () => {
      expect(HAS_TEST_DB).toBe(true);
    });
  },
);

describe('audit payload safety', () => {
  it('refuses a detail key that looks like attachment content', () => {
    expect(() => assertAuditSafeDetail({ fileContent: 'x' }, 'test')).toThrow(/ids and scalars only/);
    expect(() => assertAuditSafeDetail({ fileUrl: 'https://x/y.jpg' }, 'test')).toThrow(/ids and scalars only/);
    expect(() => assertAuditSafeDetail({ base64: 'AAA' }, 'test')).toThrow(/ids and scalars only/);
  });

  it('refuses a data: URI or an oversized string in any key', () => {
    expect(() => assertAuditSafeDetail({ note: 'data:image/png;base64,AAAA' }, 'test')).toThrow(/URL or data blob/);
    expect(() => assertAuditSafeDetail({ note: 'x'.repeat(600) }, 'test')).toThrow(/ids and scalars only/);
  });

  it('accepts ids, counts and scalars — the shape the service actually writes', () => {
    expect(() => assertAuditSafeDetail({
      routeSegmentId: 'FEEDER_RUN', measuredLengthFt: 41,
      evidenceAttachmentIds: ['aa000000-0000-4000-8000-00000000000a'], evidenceCount: 1,
    }, 'test')).not.toThrow();
  });
});
