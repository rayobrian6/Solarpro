// lib/fieldMeasurement/repository.ts
// WS-5 — THE MEASUREMENT REPOSITORY PORT, plus the in-memory adapter.
//
// WHY A PORT AT ALL. Every state transition in this domain has to be ATOMIC with
// its audit event: a verification that commits without its event row is an
// unaudited promotion to permit-grade authority, and an event row without its
// transition is a lie in the audit trail. Expressing that as "the service writes
// two rows" would put the atomicity requirement in the service, where the next
// caller can forget it. Expressing it as `transitionVerify(command)` puts it in
// the STORE contract, where both adapters must satisfy it and one shared
// contract suite proves they do.
//
// THE TWO ADAPTERS.
//   • postgresFieldMeasurementRepository — production, migration 118, one
//     sql.transaction() per transition.
//   • inMemoryFieldMeasurementRepository (below) — the same semantics over a
//     row array. It is what the reachability proof and the security suite run
//     against, because this environment has no local PostgreSQL and a proof that
//     cannot execute is not a proof.
//
// WHAT THE IN-MEMORY ADAPTER IS NOT: it is not a stub, and it is not a shortcut
// past the domain. Every service rule, every policy evaluation, every capability
// gate and the whole canonical-resolver → voltage-drop → procurement → release
// chain run for real above it. Only the storage driver differs, and the shared
// contract suite (tests/fieldMeasurement/repository-contract.test.ts) asserts
// both adapters agree on defaults, conflict detection, supersession linkage,
// tenant scoping and event atomicity.
//
// OPTIMISTIC, NOT LOCKING. Each transition is a CONDITIONAL write guarded on the
// state it expects to find. A caller that loses the race gets `applied: false`
// and NOTHING is written — no partial commit, no second event, no silent
// overwrite of someone else's verification.

import { randomUUID } from 'node:crypto';
import type {
  FieldRouteMeasurement, FieldRouteMeasurementEvent,
  MeasurementEventType, MeasurementVerificationState, VerificationMode,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

/** The event to write ALONGSIDE a transition, in the same transaction. */
export interface MeasurementEventDraft {
  eventType: MeasurementEventType;
  actorUserId: string | null;
  previousState: MeasurementVerificationState | null;
  newState: MeasurementVerificationState;
  snapshotId?: string | null;
  snapshotDigest?: string | null;
  calculationRecordId?: string | null;
  /** IDs and scalars only. The service is responsible for never putting
   *  attachment CONTENT here; `assertAuditSafeDetail` enforces it. */
  detail: Record<string, unknown>;
}

export interface RecordCommand {
  measurement: FieldRouteMeasurement;
  event: MeasurementEventDraft;
}

export interface VerifyCommand {
  measurementId: string;
  tenantId: string;
  projectId: string;
  verifiedByUserId: string;
  verifiedAt: string;
  verificationMode: VerificationMode;
  verificationNotes: string | null;
  evidenceExceptionReason: string | null;
  event: MeasurementEventDraft;
}

export interface RejectCommand {
  measurementId: string;
  tenantId: string;
  projectId: string;
  rejectedByUserId: string;
  rejectedAt: string;
  rejectionReason: string;
  event: MeasurementEventDraft;
}

export interface SupersedeCommand {
  /** the record being replaced. Must be REPORTED_UNVERIFIED or VERIFIED. */
  supersededMeasurementId: string;
  tenantId: string;
  projectId: string;
  /** the replacement — already fully built, already REPORTED_UNVERIFIED. */
  replacement: FieldRouteMeasurement;
  supersededAt: string;
  /** two events: the supersession of the old record and the recording of the new. */
  supersedeEvent: MeasurementEventDraft;
  recordEvent: MeasurementEventDraft;
}

/** Every transition returns this shape. `applied: false` means the guard did not
 *  match and NOTHING was written — never a partial commit. */
export interface TransitionResult {
  applied: boolean;
  /** the record as it now stands (or as it was found, when not applied). */
  measurement: FieldRouteMeasurement | null;
  /** why the guard did not match, for the conflict message. */
  conflictReason: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE PORT
// ═══════════════════════════════════════════════════════════════════════════

export interface FieldMeasurementRepository {
  /** name of the adapter, for evidence + the closure report. */
  readonly adapter: string;

  /** Insert a new REPORTED_UNVERIFIED record + its RECORDED event, atomically. */
  record(cmd: RecordCommand): Promise<FieldRouteMeasurement>;

  /** Promote REPORTED_UNVERIFIED → VERIFIED + its VERIFIED event, atomically.
   *  Guard: the record must still be REPORTED_UNVERIFIED. */
  verify(cmd: VerifyCommand): Promise<TransitionResult>;

  /** Move REPORTED_UNVERIFIED → REJECTED + its REJECTED event, atomically. */
  reject(cmd: RejectCommand): Promise<TransitionResult>;

  /** Insert the replacement, link both directions, mark the old SUPERSEDED and
   *  write BOTH events — all in one transaction. */
  supersede(cmd: SupersedeCommand): Promise<TransitionResult & { replacement: FieldRouteMeasurement | null }>;

  findById(tenantId: string, projectId: string, id: string): Promise<FieldRouteMeasurement | null>;
  listBySegment(tenantId: string, projectId: string, routeSegmentId: string): Promise<FieldRouteMeasurement[]>;
  listByProject(tenantId: string, projectId: string): Promise<FieldRouteMeasurement[]>;
  listEvents(tenantId: string, projectId: string, measurementId: string): Promise<FieldRouteMeasurementEvent[]>;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — AUDIT-SAFETY OF THE EVENT PAYLOAD
// ───────────────────────────────────────────────────────────────────────────
// The rule "audit logs reference attachment IDs, not attachment contents" is
// enforced, not merely intended. Anything that looks like file content, a URL or
// a data blob is refused before it reaches either adapter.
// ═══════════════════════════════════════════════════════════════════════════

const CONTENT_SHAPED_KEY = /(content|bytes|blob|base64|dataUrl|fileUrl|url|body|text|raw)/i;
const MAX_DETAIL_STRING = 512;

export function assertAuditSafeDetail(detail: Record<string, unknown>, where: string): void {
  for (const [k, v] of Object.entries(detail)) {
    if (CONTENT_SHAPED_KEY.test(k)) {
      throw new Error(`${where}: audit detail key '${k}' looks like attachment content — audit records carry ids and scalars only`);
    }
    if (typeof v === 'string' && v.length > MAX_DETAIL_STRING) {
      throw new Error(`${where}: audit detail '${k}' is ${v.length} chars — audit records carry ids and scalars only`);
    }
    if (typeof v === 'string' && /^data:|^https?:\/\//i.test(v)) {
      throw new Error(`${where}: audit detail '${k}' is a URL or data blob — audit records carry ids and scalars only`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — THE IN-MEMORY ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Create an in-memory repository. Semantics are IDENTICAL to the Postgres
 * adapter, including:
 *   • tenant + project scoping on every read and every guard (a cross-tenant id
 *     is NOT FOUND, never "found but forbidden" — the row must not be readable
 *     at all);
 *   • conditional transitions that write nothing when the guard fails;
 *   • the event row written in the same logical step as the transition, so a
 *     thrown error leaves neither behind.
 */
export function inMemoryFieldMeasurementRepository(seed: FieldRouteMeasurement[] = []): FieldMeasurementRepository & {
  /** test/inspection access — the raw rows. Not part of the port. */
  _rows(): FieldRouteMeasurement[];
  _events(): FieldRouteMeasurementEvent[];
} {
  const rows: FieldRouteMeasurement[] = seed.map(clone);
  const events: FieldRouteMeasurementEvent[] = [];

  const scoped = (tenantId: string, projectId: string, id: string): FieldRouteMeasurement | undefined =>
    rows.find(r => r.id === id && r.tenantId === tenantId && r.projectId === projectId);

  const writeEvent = (m: FieldRouteMeasurement, draft: MeasurementEventDraft, atIso: string): void => {
    assertAuditSafeDetail(draft.detail, 'inMemoryFieldMeasurementRepository');
    events.push({
      id: randomUUID(),
      tenantId: m.tenantId,
      tenantOrganizationId: m.tenantOrganizationId,
      projectId: m.projectId,
      routeSegmentId: m.routeSegmentId,
      measurementId: m.id,
      eventType: draft.eventType,
      actorUserId: draft.actorUserId,
      previousState: draft.previousState,
      newState: draft.newState,
      snapshotId: draft.snapshotId ?? null,
      snapshotDigest: draft.snapshotDigest ?? null,
      calculationRecordId: draft.calculationRecordId ?? null,
      detail: clone(draft.detail),
      occurredAt: atIso,
    });
  };

  return {
    adapter: 'in-memory',

    _rows: () => rows.map(clone),
    _events: () => events.map(clone),

    async record(cmd: RecordCommand): Promise<FieldRouteMeasurement> {
      // The storage-layer invariant migration 118 states as a DEFAULT and a
      // CHECK: a new row is REPORTED_UNVERIFIED and carries no verification or
      // rejection facts. Asserted here so the two adapters refuse identically.
      if (cmd.measurement.verificationState !== 'REPORTED_UNVERIFIED') {
        throw new Error('record(): a new measurement must be REPORTED_UNVERIFIED');
      }
      if (cmd.measurement.verifiedByUserId || cmd.measurement.verifiedAt || cmd.measurement.verificationMode) {
        throw new Error('record(): a new measurement may not carry verification facts');
      }
      const row = clone(cmd.measurement);
      rows.push(row);
      writeEvent(row, cmd.event, row.recordedAt);
      return clone(row);
    },

    async verify(cmd: VerifyCommand): Promise<TransitionResult> {
      const found = scoped(cmd.tenantId, cmd.projectId, cmd.measurementId);
      if (!found) return { applied: false, measurement: null, conflictReason: 'not found in this tenant/project' };
      if (found.verificationState !== 'REPORTED_UNVERIFIED') {
        return { applied: false, measurement: clone(found), conflictReason: `state is ${found.verificationState}, expected REPORTED_UNVERIFIED` };
      }
      found.verificationState = 'VERIFIED';
      found.verifiedByUserId = cmd.verifiedByUserId;
      found.verifiedAt = cmd.verifiedAt;
      found.verificationMode = cmd.verificationMode;
      found.verificationNotes = cmd.verificationNotes;
      found.evidenceExceptionReason = cmd.evidenceExceptionReason;
      found.updatedAt = cmd.verifiedAt;
      writeEvent(found, cmd.event, cmd.verifiedAt);
      return { applied: true, measurement: clone(found), conflictReason: null };
    },

    async reject(cmd: RejectCommand): Promise<TransitionResult> {
      const found = scoped(cmd.tenantId, cmd.projectId, cmd.measurementId);
      if (!found) return { applied: false, measurement: null, conflictReason: 'not found in this tenant/project' };
      // A VERIFIED record may be rejected — that is how a verification is
      // withdrawn, and it is exactly what must REOPEN the release requirement.
      if (found.verificationState !== 'REPORTED_UNVERIFIED' && found.verificationState !== 'VERIFIED') {
        return { applied: false, measurement: clone(found), conflictReason: `state is ${found.verificationState}, which cannot be rejected` };
      }
      const prev = found.verificationState;
      found.verificationState = 'REJECTED';
      found.rejectedByUserId = cmd.rejectedByUserId;
      found.rejectedAt = cmd.rejectedAt;
      found.rejectionReason = cmd.rejectionReason;
      found.updatedAt = cmd.rejectedAt;
      writeEvent(found, { ...cmd.event, previousState: prev }, cmd.rejectedAt);
      return { applied: true, measurement: clone(found), conflictReason: null };
    },

    async supersede(cmd: SupersedeCommand) {
      const old = scoped(cmd.tenantId, cmd.projectId, cmd.supersededMeasurementId);
      if (!old) return { applied: false, measurement: null, replacement: null, conflictReason: 'not found in this tenant/project' };
      if (old.verificationState !== 'REPORTED_UNVERIFIED' && old.verificationState !== 'VERIFIED') {
        return { applied: false, measurement: clone(old), replacement: null, conflictReason: `state is ${old.verificationState}, which cannot be superseded` };
      }
      if (cmd.replacement.verificationState !== 'REPORTED_UNVERIFIED') {
        throw new Error('supersede(): the replacement must be REPORTED_UNVERIFIED — a correction is not pre-verified');
      }
      const prev = old.verificationState;
      const next = clone(cmd.replacement);
      next.supersedesMeasurementId = old.id;
      rows.push(next);

      old.verificationState = 'SUPERSEDED';
      old.supersededByMeasurementId = next.id;
      old.updatedAt = cmd.supersededAt;

      writeEvent(old, { ...cmd.supersedeEvent, previousState: prev }, cmd.supersededAt);
      writeEvent(next, cmd.recordEvent, next.recordedAt);
      return { applied: true, measurement: clone(old), replacement: clone(next), conflictReason: null };
    },

    async findById(tenantId, projectId, id) {
      const f = scoped(tenantId, projectId, id);
      return f ? clone(f) : null;
    },

    async listBySegment(tenantId, projectId, routeSegmentId) {
      return rows
        .filter(r => r.tenantId === tenantId && r.projectId === projectId && r.routeSegmentId === routeSegmentId)
        .sort(byRecordedAtDesc)
        .map(clone);
    },

    async listByProject(tenantId, projectId) {
      return rows
        .filter(r => r.tenantId === tenantId && r.projectId === projectId)
        .sort(byRecordedAtDesc)
        .map(clone);
    },

    async listEvents(tenantId, projectId, measurementId) {
      return events
        .filter(e => e.tenantId === tenantId && e.projectId === projectId && e.measurementId === measurementId)
        .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
        .map(clone);
    },
  };
}

/** Newest first, with the id as the deterministic tie-break so two records
 *  written in the same millisecond never order differently between runs. */
function byRecordedAtDesc(a: FieldRouteMeasurement, b: FieldRouteMeasurement): number {
  const d = Date.parse(b.recordedAt) - Date.parse(a.recordedAt);
  return d !== 0 ? d : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
