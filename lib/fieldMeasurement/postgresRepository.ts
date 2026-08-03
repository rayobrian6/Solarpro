// lib/fieldMeasurement/postgresRepository.ts
// WS-5 — THE PRODUCTION MEASUREMENT REPOSITORY (migration 118, Neon).
//
// ONE TRANSACTION PER TRANSITION. Every write below is a single
// `sql.transaction([...])`: the state change and its audit event commit
// together or not at all. That is the whole reason migration 118 carries a
// second table — the compliance audit_log (migration 100) catches its own write
// failure and falls back to a console line, which is right for a best-effort
// security log and wrong for the durable record of a domain state change.
//
// THE GUARD IS IN THE `WHERE`, NOT IN A PRIOR READ. `UPDATE … WHERE id = $1 AND
// verification_state = 'REPORTED_UNVERIFIED'` is atomic against a concurrent
// verifier; a read-then-write would let two verifications of the same record
// both believe they won. When the guard does not match, zero rows change, the
// event insert (which selects from the row it just changed) writes nothing, and
// the caller gets `applied: false` with nothing committed.
//
// THE EVENT INSERT SELECTS FROM THE ROW IT DESCRIBES. `INSERT … SELECT … WHERE
// verified_at = $ts` matches only when OUR update is the one that landed, so a
// lost race can never leave an event claiming a transition that did not happen.
//
// TENANT SCOPING IS IN EVERY STATEMENT, including the guards. A cross-tenant id
// matches no row: the record is not readable, not merely not writable.
//
// Raw pg rows are `any` here exactly as in lib/engineeringReview/store.ts and
// lib/personnel/store.ts — the row shape is the migration's, and each field is
// narrowed on the way into the typed record. (No eslint suppression: this
// project extends `next/core-web-vitals`, which registers @typescript-eslint as
// a PARSER only, so `no-explicit-any` is not a defined rule and a disable
// directive naming it is an orphan ESLint rejects.)

import { getDbReady } from '@/lib/db/core';
import {
  assertAuditSafeDetail,
  type FieldMeasurementRepository, type MeasurementEventDraft,
  type RecordCommand, type RejectCommand, type SupersedeCommand,
  type TransitionResult, type VerifyCommand,
} from './repository';
import type {
  FieldRouteMeasurement, FieldRouteMeasurementEvent,
  MeasurementEventType, MeasurementVerificationState, MeasurementMethod, VerificationMode,
} from './types';

function rowToMeasurement(r: any): FieldRouteMeasurement {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    tenantOrganizationId: r.tenant_organization_id ? String(r.tenant_organization_id) : null,
    projectId: String(r.project_id),
    routeSegmentId: String(r.route_segment_id),
    measuredLengthFt: Number(r.measured_length_ft),
    measurementMethod: String(r.measurement_method) as MeasurementMethod,
    measuredByUserId: String(r.measured_by_user_id),
    measuredAt: new Date(r.measured_at).toISOString(),
    recordedAt: new Date(r.recorded_at).toISOString(),
    evidenceAttachmentIds: Array.isArray(r.evidence_attachment_ids) ? r.evidence_attachment_ids.map(String) : [],
    notes: r.notes ?? null,
    verificationState: String(r.verification_state) as MeasurementVerificationState,
    verificationMode: r.verification_mode ? String(r.verification_mode) as VerificationMode : null,
    verifiedByUserId: r.verified_by_user_id ? String(r.verified_by_user_id) : null,
    verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
    verificationNotes: r.verification_notes ?? null,
    evidenceExceptionReason: r.evidence_exception_reason ?? null,
    rejectedByUserId: r.rejected_by_user_id ? String(r.rejected_by_user_id) : null,
    rejectedAt: r.rejected_at ? new Date(r.rejected_at).toISOString() : null,
    rejectionReason: r.rejection_reason ?? null,
    supersedesMeasurementId: r.supersedes_measurement_id ? String(r.supersedes_measurement_id) : null,
    supersededByMeasurementId: r.superseded_by_measurement_id ? String(r.superseded_by_measurement_id) : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function rowToEvent(r: any): FieldRouteMeasurementEvent {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    tenantOrganizationId: r.tenant_organization_id ? String(r.tenant_organization_id) : null,
    projectId: String(r.project_id),
    routeSegmentId: String(r.route_segment_id),
    measurementId: String(r.measurement_id),
    eventType: String(r.event_type) as MeasurementEventType,
    actorUserId: r.actor_user_id ? String(r.actor_user_id) : null,
    previousState: r.previous_state ? String(r.previous_state) as MeasurementVerificationState : null,
    newState: String(r.new_state) as MeasurementVerificationState,
    snapshotId: r.snapshot_id ?? null,
    snapshotDigest: r.snapshot_digest ?? null,
    calculationRecordId: r.calculation_record_id ?? null,
    detail: (typeof r.detail === 'string' ? JSON.parse(r.detail) : (r.detail ?? {})) as Record<string, unknown>,
    occurredAt: new Date(r.occurred_at).toISOString(),
  };
}

export const postgresFieldMeasurementRepository: FieldMeasurementRepository = {
  adapter: 'postgres (migration 118)',

  async record(cmd: RecordCommand): Promise<FieldRouteMeasurement> {
    const m = cmd.measurement;
    if (m.verificationState !== 'REPORTED_UNVERIFIED') {
      throw new Error('record(): a new measurement must be REPORTED_UNVERIFIED');
    }
    assertAuditSafeDetail(cmd.event.detail, 'postgresFieldMeasurementRepository.record');
    const sql = await getDbReady();
    await sql.transaction((txn) => [
      txn`
        INSERT INTO field_route_measurements (
          id, tenant_id, tenant_organization_id, project_id, route_segment_id,
          measured_length_ft, measurement_method, measured_by_user_id, measured_at, recorded_at,
          evidence_attachment_ids, notes, verification_state,
          supersedes_measurement_id, created_at, updated_at
        ) VALUES (
          ${m.id}, ${m.tenantId}, ${m.tenantOrganizationId}, ${m.projectId}, ${m.routeSegmentId},
          ${m.measuredLengthFt}, ${m.measurementMethod}, ${m.measuredByUserId},
          ${m.measuredAt}::timestamptz, ${m.recordedAt}::timestamptz,
          ${m.evidenceAttachmentIds}::text[], ${m.notes}, 'REPORTED_UNVERIFIED',
          ${m.supersedesMeasurementId}, ${m.createdAt}::timestamptz, ${m.updatedAt}::timestamptz
        )
      `,
      eventInsert(txn, m, cmd.event, m.recordedAt),
    ]);
    const found = await this.findById(m.tenantId, m.projectId, m.id);
    if (!found) throw new Error(`field_route_measurements row '${m.id}' was not written`);
    return found;
  },

  async verify(cmd: VerifyCommand): Promise<TransitionResult> {
    assertAuditSafeDetail(cmd.event.detail, 'postgresFieldMeasurementRepository.verify');
    const sql = await getDbReady();
    const results = await sql.transaction((txn) => [
      // GUARD IN THE WHERE — atomic against a concurrent verifier.
      txn`
        UPDATE field_route_measurements
        SET verification_state = 'VERIFIED',
            verified_by_user_id = ${cmd.verifiedByUserId},
            verified_at = ${cmd.verifiedAt}::timestamptz,
            verification_mode = ${cmd.verificationMode},
            verification_notes = ${cmd.verificationNotes},
            evidence_exception_reason = ${cmd.evidenceExceptionReason},
            updated_at = ${cmd.verifiedAt}::timestamptz
        WHERE id = ${cmd.measurementId}
          AND tenant_id = ${cmd.tenantId}
          AND project_id = ${cmd.projectId}
          AND verification_state = 'REPORTED_UNVERIFIED'
        RETURNING id
      `,
      // The event selects from the row it describes, matched on OUR timestamp:
      // if the update above did not land, this inserts nothing.
      conditionalEventInsert(txn, cmd.measurementId, cmd.tenantId, cmd.projectId, cmd.event, cmd.verifiedAt, 'verified_at'),
    ]);
    const applied = ((results?.[0] as any[]) ?? []).length === 1;
    const measurement = await this.findById(cmd.tenantId, cmd.projectId, cmd.measurementId);
    return {
      applied,
      measurement,
      conflictReason: applied ? null
        : measurement ? `state is ${measurement.verificationState}, expected REPORTED_UNVERIFIED`
        : 'not found in this tenant/project',
    };
  },

  async reject(cmd: RejectCommand): Promise<TransitionResult> {
    assertAuditSafeDetail(cmd.event.detail, 'postgresFieldMeasurementRepository.reject');
    const sql = await getDbReady();
    const results = await sql.transaction((txn) => [
      // A VERIFIED record may be rejected — that is how a verification is
      // withdrawn, and it is exactly what must REOPEN the release requirement.
      txn`
        UPDATE field_route_measurements
        SET verification_state = 'REJECTED',
            rejected_by_user_id = ${cmd.rejectedByUserId},
            rejected_at = ${cmd.rejectedAt}::timestamptz,
            rejection_reason = ${cmd.rejectionReason},
            updated_at = ${cmd.rejectedAt}::timestamptz
        WHERE id = ${cmd.measurementId}
          AND tenant_id = ${cmd.tenantId}
          AND project_id = ${cmd.projectId}
          AND verification_state IN ('REPORTED_UNVERIFIED', 'VERIFIED')
        RETURNING id
      `,
      conditionalEventInsert(txn, cmd.measurementId, cmd.tenantId, cmd.projectId, cmd.event, cmd.rejectedAt, 'rejected_at'),
    ]);
    const applied = ((results?.[0] as any[]) ?? []).length === 1;
    const measurement = await this.findById(cmd.tenantId, cmd.projectId, cmd.measurementId);
    return {
      applied,
      measurement,
      conflictReason: applied ? null
        : measurement ? `state is ${measurement.verificationState}, which cannot be rejected`
        : 'not found in this tenant/project',
    };
  },

  async supersede(cmd: SupersedeCommand) {
    const next = cmd.replacement;
    if (next.verificationState !== 'REPORTED_UNVERIFIED') {
      throw new Error('supersede(): the replacement must be REPORTED_UNVERIFIED — a correction is not pre-verified');
    }
    assertAuditSafeDetail(cmd.supersedeEvent.detail, 'postgresFieldMeasurementRepository.supersede');
    assertAuditSafeDetail(cmd.recordEvent.detail, 'postgresFieldMeasurementRepository.supersede');
    const sql = await getDbReady();
    const results = await sql.transaction((txn) => [
      // 1. Retire the old record. The guard is what makes the whole operation
      //    conditional: if it does not match, statements 2-4 all find nothing.
      txn`
        UPDATE field_route_measurements
        SET verification_state = 'SUPERSEDED',
            superseded_by_measurement_id = ${next.id},
            updated_at = ${cmd.supersededAt}::timestamptz
        WHERE id = ${cmd.supersededMeasurementId}
          AND tenant_id = ${cmd.tenantId}
          AND project_id = ${cmd.projectId}
          AND verification_state IN ('REPORTED_UNVERIFIED', 'VERIFIED')
        RETURNING id
      `,
      // 2. Insert the replacement ONLY if the retirement landed.
      txn`
        INSERT INTO field_route_measurements (
          id, tenant_id, tenant_organization_id, project_id, route_segment_id,
          measured_length_ft, measurement_method, measured_by_user_id, measured_at, recorded_at,
          evidence_attachment_ids, notes, verification_state,
          supersedes_measurement_id, created_at, updated_at
        )
        SELECT
          ${next.id}, ${next.tenantId}, ${next.tenantOrganizationId}, ${next.projectId}, ${next.routeSegmentId},
          ${next.measuredLengthFt}, ${next.measurementMethod}, ${next.measuredByUserId},
          ${next.measuredAt}::timestamptz, ${next.recordedAt}::timestamptz,
          ${next.evidenceAttachmentIds}::text[], ${next.notes}, 'REPORTED_UNVERIFIED',
          ${cmd.supersededMeasurementId}, ${next.createdAt}::timestamptz, ${next.updatedAt}::timestamptz
        WHERE EXISTS (
          SELECT 1 FROM field_route_measurements
          WHERE id = ${cmd.supersededMeasurementId}
            AND tenant_id = ${cmd.tenantId}
            AND superseded_by_measurement_id = ${next.id}
        )
      `,
      // 3. The supersession event for the retired record.
      conditionalEventInsert(
        txn, cmd.supersededMeasurementId, cmd.tenantId, cmd.projectId,
        cmd.supersedeEvent, next.id, 'superseded_by_measurement_id',
      ),
      // 4. The RECORDED event for the replacement.
      conditionalEventInsert(
        txn, next.id, cmd.tenantId, cmd.projectId,
        cmd.recordEvent, cmd.supersededMeasurementId, 'supersedes_measurement_id',
      ),
    ]);
    const applied = ((results?.[0] as any[]) ?? []).length === 1;
    const measurement = await this.findById(cmd.tenantId, cmd.projectId, cmd.supersededMeasurementId);
    const replacement = applied ? await this.findById(cmd.tenantId, cmd.projectId, next.id) : null;
    return {
      applied,
      measurement,
      replacement,
      conflictReason: applied ? null
        : measurement ? `state is ${measurement.verificationState}, which cannot be superseded`
        : 'not found in this tenant/project',
    };
  },

  async findById(tenantId: string, projectId: string, id: string): Promise<FieldRouteMeasurement | null> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM field_route_measurements
      WHERE id = ${id} AND tenant_id = ${tenantId} AND project_id = ${projectId}
      LIMIT 1
    `;
    const r = (rows as any[])[0];
    return r ? rowToMeasurement(r) : null;
  },

  async listBySegment(tenantId: string, projectId: string, routeSegmentId: string): Promise<FieldRouteMeasurement[]> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM field_route_measurements
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND route_segment_id = ${routeSegmentId}
      ORDER BY recorded_at DESC, id DESC
    `;
    return (rows as any[]).map(rowToMeasurement);
  },

  async listByProject(tenantId: string, projectId: string): Promise<FieldRouteMeasurement[]> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM field_route_measurements
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId}
      ORDER BY recorded_at DESC, id DESC
    `;
    return (rows as any[]).map(rowToMeasurement);
  },

  async listEvents(tenantId: string, projectId: string, measurementId: string): Promise<FieldRouteMeasurementEvent[]> {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM field_route_measurement_events
      WHERE tenant_id = ${tenantId} AND project_id = ${projectId} AND measurement_id = ${measurementId}
      ORDER BY occurred_at ASC, id ASC
    `;
    return (rows as any[]).map(rowToEvent);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Event inserts. Both forms SELECT from the measurement row so the event can
// never describe a transition that did not commit, and both carry the tenant on
// the event itself so an audit query is tenant-scoped without a join.
// ═══════════════════════════════════════════════════════════════════════════

/** The tagged-template executor neon hands to a transaction callback. Named so
 *  the two event-insert helpers below return exactly what `sql.transaction`
 *  expects — a helper typed `unknown` breaks the array's element type. */
type Txn = import('@neondatabase/serverless').NeonQueryFunctionInTransaction<false, false>;

function eventInsert(txn: Txn, m: FieldRouteMeasurement, e: MeasurementEventDraft, atIso: string) {
  return txn`
    INSERT INTO field_route_measurement_events (
      tenant_id, tenant_organization_id, project_id, route_segment_id, measurement_id,
      event_type, actor_user_id, previous_state, new_state,
      snapshot_id, snapshot_digest, calculation_record_id, detail, occurred_at
    ) VALUES (
      ${m.tenantId}, ${m.tenantOrganizationId}, ${m.projectId}, ${m.routeSegmentId}, ${m.id},
      ${e.eventType}, ${e.actorUserId}, ${e.previousState}, ${e.newState},
      ${e.snapshotId ?? null}, ${e.snapshotDigest ?? null}, ${e.calculationRecordId ?? null},
      ${JSON.stringify(e.detail)}::jsonb, ${atIso}::timestamptz
    )
  `;
}

type MarkerColumn = 'verified_at' | 'rejected_at' | 'superseded_by_measurement_id' | 'supersedes_measurement_id';

/**
 * Insert the event ONLY when the measurement row carries the exact marker our
 * own UPDATE wrote in this same transaction — so a lost race can never leave an
 * event claiming a transition that did not happen.
 *
 * The guard column varies, and a tagged template cannot interpolate an
 * IDENTIFIER (an interpolation is always a bound parameter, so `${col}` would
 * compare the string 'verified_at' to the marker and match nothing). Rather than
 * splice raw SQL — which is how injection gets in — the four cases are four
 * complete literal templates. `marker` is a bound parameter in every one.
 */
function conditionalEventInsert(
  txn: Txn,
  measurementId: string,
  tenantId: string,
  projectId: string,
  e: MeasurementEventDraft,
  marker: string,
  column: MarkerColumn,
) {
  const v = eventValues(e);
  switch (column) {
    case 'verified_at':
      return txn`
        INSERT INTO field_route_measurement_events (
          tenant_id, tenant_organization_id, project_id, route_segment_id, measurement_id,
          event_type, actor_user_id, previous_state, new_state,
          snapshot_id, snapshot_digest, calculation_record_id, detail, occurred_at
        )
        SELECT m.tenant_id, m.tenant_organization_id, m.project_id, m.route_segment_id, m.id,
          ${v.eventType}, ${v.actorUserId}, ${v.previousState}, ${v.newState},
          ${v.snapshotId}, ${v.snapshotDigest}, ${v.calculationRecordId}, ${v.detail}::jsonb, now()
        FROM field_route_measurements m
        WHERE m.id = ${measurementId} AND m.tenant_id = ${tenantId} AND m.project_id = ${projectId}
          AND m.verified_at = ${marker}::timestamptz
      `;
    case 'rejected_at':
      return txn`
        INSERT INTO field_route_measurement_events (
          tenant_id, tenant_organization_id, project_id, route_segment_id, measurement_id,
          event_type, actor_user_id, previous_state, new_state,
          snapshot_id, snapshot_digest, calculation_record_id, detail, occurred_at
        )
        SELECT m.tenant_id, m.tenant_organization_id, m.project_id, m.route_segment_id, m.id,
          ${v.eventType}, ${v.actorUserId}, ${v.previousState}, ${v.newState},
          ${v.snapshotId}, ${v.snapshotDigest}, ${v.calculationRecordId}, ${v.detail}::jsonb, now()
        FROM field_route_measurements m
        WHERE m.id = ${measurementId} AND m.tenant_id = ${tenantId} AND m.project_id = ${projectId}
          AND m.rejected_at = ${marker}::timestamptz
      `;
    case 'superseded_by_measurement_id':
      return txn`
        INSERT INTO field_route_measurement_events (
          tenant_id, tenant_organization_id, project_id, route_segment_id, measurement_id,
          event_type, actor_user_id, previous_state, new_state,
          snapshot_id, snapshot_digest, calculation_record_id, detail, occurred_at
        )
        SELECT m.tenant_id, m.tenant_organization_id, m.project_id, m.route_segment_id, m.id,
          ${v.eventType}, ${v.actorUserId}, ${v.previousState}, ${v.newState},
          ${v.snapshotId}, ${v.snapshotDigest}, ${v.calculationRecordId}, ${v.detail}::jsonb, now()
        FROM field_route_measurements m
        WHERE m.id = ${measurementId} AND m.tenant_id = ${tenantId} AND m.project_id = ${projectId}
          AND m.superseded_by_measurement_id = ${marker}
      `;
    case 'supersedes_measurement_id':
      return txn`
        INSERT INTO field_route_measurement_events (
          tenant_id, tenant_organization_id, project_id, route_segment_id, measurement_id,
          event_type, actor_user_id, previous_state, new_state,
          snapshot_id, snapshot_digest, calculation_record_id, detail, occurred_at
        )
        SELECT m.tenant_id, m.tenant_organization_id, m.project_id, m.route_segment_id, m.id,
          ${v.eventType}, ${v.actorUserId}, ${v.previousState}, ${v.newState},
          ${v.snapshotId}, ${v.snapshotDigest}, ${v.calculationRecordId}, ${v.detail}::jsonb, now()
        FROM field_route_measurements m
        WHERE m.id = ${measurementId} AND m.tenant_id = ${tenantId} AND m.project_id = ${projectId}
          AND m.supersedes_measurement_id = ${marker}
      `;
  }
}

function eventValues(e: MeasurementEventDraft) {
  return {
    eventType: e.eventType,
    actorUserId: e.actorUserId,
    previousState: e.previousState,
    newState: e.newState,
    snapshotId: e.snapshotId ?? null,
    snapshotDigest: e.snapshotDigest ?? null,
    calculationRecordId: e.calculationRecordId ?? null,
    detail: JSON.stringify(e.detail),
  };
}
