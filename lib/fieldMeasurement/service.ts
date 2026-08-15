// lib/fieldMeasurement/service.ts
// WS-5 — THE ONE AUTHORITATIVE FIELD-MEASUREMENT SERVICE.
//
// EVERY authority decision in this domain happens here. Not in a route handler,
// not in a React component, not in the repository. That is not a style
// preference: the specific failure this workstream exists to prevent is a
// `POST …/verify` handler that sets a state field, and the only structural
// defence against it is that no other module can perform a transition.
//
// THE SHAPE OF EVERY OPERATION IS THE SAME, and the order is load-bearing:
//   1. resolve the tenant OF THE PROJECT (never of the caller);
//   2. resolve the actor's capabilities WITHIN that tenant;
//   3. assert the capability + project access (fail-closed, structured error);
//   4. read the route fact from the canonical snapshot and check applicability;
//   5. resolve evidence FRESH (never trusted from record time);
//   6. evaluate the explicit policy and keep its verdict;
//   7. perform the transition and its audit event in ONE store transaction;
//   8. invalidate the dependent artifact, then mirror to the compliance log.
//
// STEP 8 IS ORDERED, NOT INCIDENTAL. Invalidation is what stops a stored,
// pre-measurement planset being served as current after field authority changed.
// The compliance-log mirror comes LAST and is explicitly best-effort — the
// durable audit is the event row written in step 7, inside the transaction.
// Claiming durability for the best-effort log would be the exact overstatement
// this workstream is auditing for.

import { randomUUID } from 'node:crypto';
import {
  requireCapability, resolveMeasurementActor, resolveProjectTenant,
  productionAuthorizationSource,
  type AuthorizationSource, type MeasurementActor,
} from './capabilities';
import {
  resolveEvidence, productionEvidenceSource,
  type EvidenceResolution, type EvidenceSource,
} from './evidence';
import {
  evaluateVerificationPolicy, type FieldMeasurementVerificationDecision,
} from './verificationPolicy';
import {
  inMemoryFieldMeasurementRepository,
  type FieldMeasurementRepository, type MeasurementEventDraft,
} from './repository';
import {
  MeasurementError, newMeasurementState, routeAcceptsProjectMeasurement, validateRecordInput,
  type FieldRouteMeasurement, type FieldRouteMeasurementEvent,
  type MeasurementMethod, type RouteApplicabilityFact, type TenantKey,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE PORTS
// ═══════════════════════════════════════════════════════════════════════════

/** Reads the project's CANONICAL route segments. There is exactly one
 *  derivation of route ownership + applicability in this codebase
 *  (buildPermitDesignSnapshot, D1) and this port returns a projection of it —
 *  never a second inference from a segment-name regex. */
export interface RouteFactSource {
  listRouteFacts(projectId: string): Promise<RouteApplicabilityFact[]>;
  /** D11 — the design digest that is CURRENT right now, i.e. the one every
   *  existing approval names. Read BEFORE a transition so an invalidation can be
   *  scoped to the design it actually affects instead of watermarking the whole
   *  project. OPTIONAL: a source that cannot answer leaves the digest `null`,
   *  which is the honest "not knowable at write time" — never a guess. */
  currentDesign?(projectId: string): Promise<{ digest: string | null; snapshotId: string | null } | null>;
}

/** Invalidates the project's current artifact/snapshot after a field-authority
 *  change. Writes the migration-114 ledger in production. */
export interface InvalidationSink {
  invalidate(rec: {
    projectId: string;
    reason: string;
    invalidatedBy: string;
    scope: 'snapshot' | 'calculation';
    atIso: string;
    /** D11 — the PRE-CHANGE design digest: the digest that was current at the
     *  moment this measurement changed the field authority under it. That is the
     *  digest every approval in existence right now names, so it is the one an
     *  invalidation must scope to.
     *
     *  This parameter did not exist, so the production sink wrote `digest: null`
     *  by construction — a time watermark invalidating EVERY approval on the
     *  project made at or before it, including approvals for designs this
     *  measurement never touched. `reconcile.ts` has always recorded the
     *  pre-change digest; one ledger had two writers with two behaviours.
     *
     *  `null` remains legal and remains honest: it means the digest was NOT
     *  knowable at write time. It is never guessed, and never reconstructed
     *  afterwards. */
    digest?: string | null;
    /** the snapshot id that digest belonged to, when known. */
    snapshotId?: string | null;
  }): Promise<void>;
}

/** Best-effort mirror into the tamper-evident compliance log (migration 100).
 *  Explicitly NOT the durable record — see the module header. */
export interface ComplianceAuditSink {
  mirror(rec: {
    action: string;
    description: string;
    actorUserId: string | null;
    organizationId: string | null;
    projectId: string;
    measurementId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
}

export interface MeasurementServiceDeps {
  repository: FieldMeasurementRepository;
  authorization: AuthorizationSource;
  evidence: EvidenceSource;
  routes: RouteFactSource;
  invalidation?: InvalidationSink;
  compliance?: ComplianceAuditSink;
  /** deterministic clock (tests + digest-safe callers pass one). */
  now?: () => string;
}

// ═══════════════════════════════════════════════════════════════════════════
// §2 — RESULT SHAPES
// ═══════════════════════════════════════════════════════════════════════════

export interface MeasurementTransitionResult {
  measurement: FieldRouteMeasurement;
  /** the policy verdict, when one was evaluated (verify only). */
  decision: FieldMeasurementVerificationDecision | null;
  /** what the transition invalidated, so a caller can report it honestly. */
  invalidated: { scope: string; reason: string } | null;
  /** the durable event rows written with the transition. */
  events: FieldRouteMeasurementEvent[];
}

export interface RouteMeasurementHistory {
  routeSegmentId: string;
  route: RouteApplicabilityFact | null;
  measurements: FieldRouteMeasurement[];
  /** the ACTIVE selection, by the deterministic rule in resolver.ts. */
  active: FieldRouteMeasurement | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE SERVICE
// ═══════════════════════════════════════════════════════════════════════════

export class FieldMeasurementService {
  private readonly d: Required<Pick<MeasurementServiceDeps, 'repository' | 'authorization' | 'evidence' | 'routes'>>
    & Pick<MeasurementServiceDeps, 'invalidation' | 'compliance'>
    & { now: () => string };

  constructor(deps: MeasurementServiceDeps) {
    this.d = {
      repository: deps.repository,
      authorization: deps.authorization,
      evidence: deps.evidence,
      routes: deps.routes,
      invalidation: deps.invalidation,
      compliance: deps.compliance,
      now: deps.now ?? (() => new Date().toISOString()),
    };
  }

  /** The adapter behind this service — surfaced so evidence and the closure
   *  report can state which storage actually ran. */
  get adapter(): string { return this.d.repository.adapter; }

  // ── shared preamble ─────────────────────────────────────────────────────

  private async context(userId: string, projectId: string): Promise<{ tenant: TenantKey; actor: MeasurementActor }> {
    const actor = await resolveMeasurementActor(userId, projectId, this.d.authorization);
    return { tenant: actor.tenant, actor };
  }

  private async routeFact(projectId: string, routeSegmentId: string): Promise<RouteApplicabilityFact> {
    const facts = await this.d.routes.listRouteFacts(projectId);
    const found = facts.find(f => f.segmentId === routeSegmentId);
    if (found) return found;
    // A route the canonical snapshot does not carry does not exist for this
    // purpose. Fail-closed: absent ⇒ not measurable, never "assume REQUIRED".
    return {
      segmentId: routeSegmentId, exists: false,
      routeOwnership: 'PROJECT_OWNED', routeAuthorityApplicability: 'REQUIRED',
      routeApplicabilityReason: null, electricalFunction: null, from: null, to: null,
      cadEstimatedLengthFt: null, cadRoutedLengthFt: null,
      currentLengthSource: null, currentVerificationState: null,
    };
  }

  // ── READ ────────────────────────────────────────────────────────────────

  /** The per-route history + the active selection. Requires route.measurement.read. */
  async listHistory(userId: string, projectId: string, routeSegmentId: string): Promise<RouteMeasurementHistory> {
    const { tenant, actor } = await this.context(userId, projectId);
    requireCapability(actor, 'route.measurement.read', { tenantId: tenant.tenantId, projectId });
    const [measurements, facts] = await Promise.all([
      this.d.repository.listBySegment(tenant.tenantId, projectId, routeSegmentId),
      this.d.routes.listRouteFacts(projectId),
    ]);
    const { selectActiveMeasurement } = await import('./resolver');
    return {
      routeSegmentId,
      route: facts.find(f => f.segmentId === routeSegmentId) ?? null,
      measurements,
      active: selectActiveMeasurement(measurements),
    };
  }

  /** Every measurement in the project, for the operator panel's roll-up. */
  async listProject(userId: string, projectId: string): Promise<{ measurements: FieldRouteMeasurement[]; routes: RouteApplicabilityFact[] }> {
    const { tenant, actor } = await this.context(userId, projectId);
    requireCapability(actor, 'route.measurement.read', { tenantId: tenant.tenantId, projectId });
    const [measurements, routes] = await Promise.all([
      this.d.repository.listByProject(tenant.tenantId, projectId),
      this.d.routes.listRouteFacts(projectId),
    ]);
    return { measurements, routes };
  }

  /** The durable audit trail for one measurement. */
  async listEvents(userId: string, projectId: string, measurementId: string): Promise<FieldRouteMeasurementEvent[]> {
    const { tenant, actor } = await this.context(userId, projectId);
    requireCapability(actor, 'route.measurement.read', { tenantId: tenant.tenantId, projectId });
    return this.d.repository.listEvents(tenant.tenantId, projectId, measurementId);
  }

  // ── RECORD ──────────────────────────────────────────────────────────────

  /**
   * Record a FIELD REPORT. The result is ALWAYS REPORTED_UNVERIFIED — there is
   * no argument, header or role that changes that. The identity and the recorded
   * timestamp are server-stamped; the client supplies the number, the method,
   * when the tape was on the run, the attachments and the notes, and nothing
   * else.
   */
  async record(args: {
    userId: string;
    projectId: string;
    routeSegmentId: string;
    measuredLengthFt: number;
    measurementMethod: string;
    measuredAt: string;
    evidenceAttachmentIds?: string[];
    notes?: string | null;
  }): Promise<MeasurementTransitionResult> {
    const nowIso = this.d.now();
    const { tenant, actor } = await this.context(args.userId, args.projectId);
    requireCapability(actor, 'route.measurement.record', { tenantId: tenant.tenantId, projectId: args.projectId });

    const input = {
      tenant,
      projectId: args.projectId,
      routeSegmentId: args.routeSegmentId,
      measuredLengthFt: args.measuredLengthFt,
      measurementMethod: args.measurementMethod,
      measuredByUserId: args.userId,          // SERVER-STAMPED, never client-supplied
      measuredAt: args.measuredAt,
      evidenceAttachmentIds: args.evidenceAttachmentIds ?? [],
      notes: args.notes ?? null,
    };
    const v = validateRecordInput(input, nowIso);
    if (v.ok !== true) throw new MeasurementError('VALIDATION', v.code, v.error);

    const route = await this.routeFact(args.projectId, args.routeSegmentId);
    const applicable = routeAcceptsProjectMeasurement(route);
    if (applicable.ok !== true) {
      // D1 — a utility-owned run refuses the ordinary project workflow outright.
      throw new MeasurementError(
        route.exists ? 'POLICY' : 'NOT_FOUND',
        route.exists ? 'ROUTE_NOT_APPLICABLE' : 'ROUTE_NOT_FOUND',
        applicable.reason,
        { routeSegmentId: args.routeSegmentId, ownership: route.routeOwnership, applicability: route.routeAuthorityApplicability },
      );
    }

    // Evidence at RECORD time is validated but NOT required: a field report is a
    // claim, and a claim with no photo is still a claim. Evidence is what
    // VERIFICATION requires. A reference that does not resolve is refused here
    // rather than stored, so the record never carries a pointer to nothing.
    const evidence = await resolveEvidence(args.projectId, input.evidenceAttachmentIds, this.d.evidence);
    if (evidence.invalid.length > 0) {
      throw new MeasurementError('VALIDATION', 'EVIDENCE_INVALID',
        `One or more evidence attachments could not be used: ${evidence.invalid.map(i => `${i.attachmentId} — ${i.reason}`).join('; ')}`,
        { invalid: evidence.invalid });
    }

    const measurement = this.newRecord(tenant, args.projectId, args.routeSegmentId, {
      measuredLengthFt: args.measuredLengthFt,
      measurementMethod: args.measurementMethod as MeasurementMethod,
      measuredByUserId: args.userId,
      measuredAt: new Date(args.measuredAt).toISOString(),
      evidenceAttachmentIds: evidence.validIds,
      notes: input.notes,
      nowIso,
    });

    const event: MeasurementEventDraft = {
      eventType: 'ROUTE_MEASUREMENT_RECORDED',
      actorUserId: args.userId,
      previousState: null,
      newState: 'REPORTED_UNVERIFIED',
      detail: {
        routeSegmentId: args.routeSegmentId,
        measuredLengthFt: args.measuredLengthFt,
        measurementMethod: args.measurementMethod,
        measuredAt: measurement.measuredAt,
        // IDS AND COUNTS ONLY — never attachment content.
        evidenceAttachmentIds: evidence.validIds,
        evidenceCount: evidence.validIds.length,
        priorLengthSource: route.currentLengthSource,
        priorVerificationState: route.currentVerificationState,
      },
    };

    const saved = await this.d.repository.record({ measurement, event });

    const invalidated = await this.invalidate(args.projectId, saved.id,
      `field route measurement RECORDED for ${args.routeSegmentId} (${args.measuredLengthFt} ft, REPORTED_UNVERIFIED) — the stored artifact predates this field report`,
      'snapshot');

    await this.mirror('route_measurement_recorded', actor, saved,
      `Field route measurement recorded for ${args.routeSegmentId}: ${args.measuredLengthFt} ft (${args.measurementMethod}), REPORTED_UNVERIFIED`,
      { evidenceCount: evidence.validIds.length, routeSegmentId: args.routeSegmentId });

    return {
      measurement: saved,
      decision: null,
      invalidated,
      events: await this.d.repository.listEvents(tenant.tenantId, args.projectId, saved.id),
    };
  }

  // ── VERIFY ──────────────────────────────────────────────────────────────

  /**
   * Promote a field report to FIELD-VERIFIED authority. The API cannot do this
   * by writing a field: the policy is evaluated here, its verdict is recorded
   * with the transition, and a refusal names every reason.
   */
  async verify(args: {
    userId: string;
    projectId: string;
    routeSegmentId: string;
    measurementId: string;
    verificationNotes?: string | null;
    authorizedExceptionReason?: string | null;
  }): Promise<MeasurementTransitionResult> {
    const nowIso = this.d.now();
    const { tenant, actor } = await this.context(args.userId, args.projectId);
    requireCapability(actor, 'route.measurement.verify', { tenantId: tenant.tenantId, projectId: args.projectId });

    const measurement = await this.mustFind(tenant.tenantId, args.projectId, args.routeSegmentId, args.measurementId);
    const route = await this.routeFact(args.projectId, args.routeSegmentId);
    // Evidence is resolved FRESH: an attachment deleted since the report was
    // filed stops satisfying the policy rather than keeping it silently alive.
    const evidence = await resolveEvidence(args.projectId, measurement.evidenceAttachmentIds, this.d.evidence);

    const decision = evaluateVerificationPolicy({
      measurement, actor, route, evidence,
      verificationNotes: args.verificationNotes ?? null,
      authorizedExceptionReason: args.authorizedExceptionReason ?? null,
      nowIso,
    });

    if (!decision.allowed || !decision.verificationMode) {
      throw new MeasurementError('POLICY', 'VERIFICATION_REFUSED',
        `Verification refused: ${decision.reasons.join('; ')}`,
        { decision });
    }

    const event: MeasurementEventDraft = {
      eventType: 'ROUTE_MEASUREMENT_VERIFIED',
      actorUserId: args.userId,
      previousState: 'REPORTED_UNVERIFIED',
      newState: 'VERIFIED',
      detail: {
        routeSegmentId: args.routeSegmentId,
        measuredLengthFt: measurement.measuredLengthFt,
        verificationMode: decision.verificationMode,
        measuredByUserId: measurement.measuredByUserId,
        verifiedByUserId: args.userId,
        evidenceAttachmentIds: measurement.evidenceAttachmentIds,
        evidenceCount: evidence.validIds.length,
        evidenceSufficient: decision.evidenceSufficient,
        usedEvidenceException: decision.usedEvidenceException,
        // The verdict itself is evidence: what was checked, not merely that
        // nothing objected.
        policySatisfied: decision.satisfied.length,
      },
    };

    const t = await this.d.repository.verify({
      measurementId: args.measurementId,
      tenantId: tenant.tenantId,
      projectId: args.projectId,
      verifiedByUserId: args.userId,
      verifiedAt: nowIso,
      verificationMode: decision.verificationMode,
      verificationNotes: (args.verificationNotes ?? '').trim() || null,
      evidenceExceptionReason: decision.usedEvidenceException ? (args.authorizedExceptionReason ?? '').trim() : null,
      event,
    });
    if (!t.applied || !t.measurement) {
      throw new MeasurementError('CONFLICT', 'VERIFY_CONFLICT',
        `Verification did not apply: ${t.conflictReason ?? 'the record changed underneath this request'}`,
        { conflictReason: t.conflictReason });
    }

    const invalidated = await this.invalidate(args.projectId, t.measurement.id,
      `field route measurement VERIFIED for ${args.routeSegmentId} (${t.measurement.measuredLengthFt} ft) — the canonical calculation length, voltage drop and procurement footage must be rebuilt from the verified value`,
      'calculation');

    await this.mirror('route_measurement_verified', actor, t.measurement,
      `Field route measurement VERIFIED for ${args.routeSegmentId}: ${t.measurement.measuredLengthFt} ft (${decision.verificationMode})`,
      { verificationMode: decision.verificationMode, evidenceSufficient: decision.evidenceSufficient, routeSegmentId: args.routeSegmentId });

    return {
      measurement: t.measurement,
      decision,
      invalidated,
      events: await this.d.repository.listEvents(tenant.tenantId, args.projectId, t.measurement.id),
    };
  }

  // ── REJECT ──────────────────────────────────────────────────────────────

  /**
   * Reject a report — or WITHDRAW a verification. Both are the same transition
   * and both must be possible: withdrawing a verification is precisely what has
   * to REOPEN the release requirement, and a model where a verification can
   * never be undone is a model where a mistake becomes permanent authority.
   * A written reason is mandatory; the rejected VALUE is retained.
   */
  async reject(args: {
    userId: string;
    projectId: string;
    routeSegmentId: string;
    measurementId: string;
    rejectionReason: string;
  }): Promise<MeasurementTransitionResult> {
    const nowIso = this.d.now();
    const { tenant, actor } = await this.context(args.userId, args.projectId);
    requireCapability(actor, 'route.measurement.reject', { tenantId: tenant.tenantId, projectId: args.projectId });

    const reason = (args.rejectionReason ?? '').trim();
    if (reason.length < 8) {
      throw new MeasurementError('VALIDATION', 'REJECTION_REASON_REQUIRED',
        'A written rejection reason is required — a rejection with no reason cannot be reviewed.');
    }
    const measurement = await this.mustFind(tenant.tenantId, args.projectId, args.routeSegmentId, args.measurementId);
    const wasVerified = measurement.verificationState === 'VERIFIED';

    const event: MeasurementEventDraft = {
      eventType: 'ROUTE_MEASUREMENT_REJECTED',
      actorUserId: args.userId,
      previousState: measurement.verificationState,
      newState: 'REJECTED',
      detail: {
        routeSegmentId: args.routeSegmentId,
        measuredLengthFt: measurement.measuredLengthFt,
        rejectedByUserId: args.userId,
        withdrewVerification: wasVerified,
        reasonLength: reason.length,
      },
    };

    const t = await this.d.repository.reject({
      measurementId: args.measurementId,
      tenantId: tenant.tenantId,
      projectId: args.projectId,
      rejectedByUserId: args.userId,
      rejectedAt: nowIso,
      rejectionReason: reason,
      event,
    });
    if (!t.applied || !t.measurement) {
      throw new MeasurementError('CONFLICT', 'REJECT_CONFLICT',
        `Rejection did not apply: ${t.conflictReason ?? 'the record changed underneath this request'}`,
        { conflictReason: t.conflictReason });
    }

    const invalidated = await this.invalidate(args.projectId, t.measurement.id,
      wasVerified
        ? `field route VERIFICATION WITHDRAWN for ${args.routeSegmentId} — the verified length no longer stands and the release requirement reopens`
        : `field route measurement REJECTED for ${args.routeSegmentId} — the reported length no longer stands`,
      'calculation');

    await this.mirror('route_measurement_rejected', actor, t.measurement,
      `Field route measurement REJECTED for ${args.routeSegmentId}${wasVerified ? ' (verification withdrawn)' : ''}`,
      { withdrewVerification: wasVerified, routeSegmentId: args.routeSegmentId });

    return {
      measurement: t.measurement,
      decision: null,
      invalidated,
      events: await this.d.repository.listEvents(tenant.tenantId, args.projectId, t.measurement.id),
    };
  }

  // ── SUPERSEDE ───────────────────────────────────────────────────────────

  /**
   * Replace a measurement with a corrected one. The OLD RECORD'S VALUE IS NEVER
   * EDITED: a new row is written, the two are linked in both directions and the
   * old one is marked SUPERSEDED. The replacement is REPORTED_UNVERIFIED —
   * superseding a verified record does NOT inherit its verification, which is
   * why superseding without a verified replacement reopens the requirement.
   */
  async supersede(args: {
    userId: string;
    projectId: string;
    routeSegmentId: string;
    measurementId: string;
    measuredLengthFt: number;
    measurementMethod: string;
    measuredAt: string;
    evidenceAttachmentIds?: string[];
    notes?: string | null;
  }): Promise<MeasurementTransitionResult & { superseded: FieldRouteMeasurement }> {
    const nowIso = this.d.now();
    const { tenant, actor } = await this.context(args.userId, args.projectId);
    requireCapability(actor, 'route.measurement.supersede', { tenantId: tenant.tenantId, projectId: args.projectId });

    const input = {
      tenant, projectId: args.projectId, routeSegmentId: args.routeSegmentId,
      measuredLengthFt: args.measuredLengthFt,
      measurementMethod: args.measurementMethod,
      measuredByUserId: args.userId,
      measuredAt: args.measuredAt,
      evidenceAttachmentIds: args.evidenceAttachmentIds ?? [],
      notes: args.notes ?? null,
      supersedesMeasurementId: args.measurementId,
    };
    const v = validateRecordInput(input, nowIso);
    if (v.ok !== true) throw new MeasurementError('VALIDATION', v.code, v.error);

    const old = await this.mustFind(tenant.tenantId, args.projectId, args.routeSegmentId, args.measurementId);
    const route = await this.routeFact(args.projectId, args.routeSegmentId);
    const applicable = routeAcceptsProjectMeasurement(route);
    if (applicable.ok !== true) {
      throw new MeasurementError(route.exists ? 'POLICY' : 'NOT_FOUND',
        route.exists ? 'ROUTE_NOT_APPLICABLE' : 'ROUTE_NOT_FOUND', applicable.reason);
    }
    const evidence = await resolveEvidence(args.projectId, input.evidenceAttachmentIds, this.d.evidence);
    if (evidence.invalid.length > 0) {
      throw new MeasurementError('VALIDATION', 'EVIDENCE_INVALID',
        `One or more evidence attachments could not be used: ${evidence.invalid.map(i => `${i.attachmentId} — ${i.reason}`).join('; ')}`,
        { invalid: evidence.invalid });
    }

    const replacement = this.newRecord(tenant, args.projectId, args.routeSegmentId, {
      measuredLengthFt: args.measuredLengthFt,
      measurementMethod: args.measurementMethod as MeasurementMethod,
      measuredByUserId: args.userId,
      measuredAt: new Date(args.measuredAt).toISOString(),
      evidenceAttachmentIds: evidence.validIds,
      notes: input.notes,
      nowIso,
      supersedesMeasurementId: old.id,
    });

    const wasVerified = old.verificationState === 'VERIFIED';
    const t = await this.d.repository.supersede({
      supersededMeasurementId: old.id,
      tenantId: tenant.tenantId,
      projectId: args.projectId,
      replacement,
      supersededAt: nowIso,
      supersedeEvent: {
        eventType: 'ROUTE_MEASUREMENT_SUPERSEDED',
        actorUserId: args.userId,
        previousState: old.verificationState,
        newState: 'SUPERSEDED',
        detail: {
          routeSegmentId: args.routeSegmentId,
          supersededLengthFt: old.measuredLengthFt,
          replacementLengthFt: args.measuredLengthFt,
          replacementMeasurementId: replacement.id,
          supersededAVerifiedRecord: wasVerified,
        },
      },
      recordEvent: {
        eventType: 'ROUTE_MEASUREMENT_RECORDED',
        actorUserId: args.userId,
        previousState: null,
        newState: 'REPORTED_UNVERIFIED',
        detail: {
          routeSegmentId: args.routeSegmentId,
          measuredLengthFt: args.measuredLengthFt,
          measurementMethod: args.measurementMethod,
          supersedesMeasurementId: old.id,
          evidenceAttachmentIds: evidence.validIds,
          evidenceCount: evidence.validIds.length,
        },
      },
    });
    if (!t.applied || !t.replacement || !t.measurement) {
      throw new MeasurementError('CONFLICT', 'SUPERSEDE_CONFLICT',
        `Supersession did not apply: ${t.conflictReason ?? 'the record changed underneath this request'}`,
        { conflictReason: t.conflictReason });
    }

    const invalidated = await this.invalidate(args.projectId, t.replacement.id,
      wasVerified
        ? `field route measurement SUPERSEDED for ${args.routeSegmentId} — a VERIFIED length was replaced by an UNVERIFIED report; the release requirement reopens until the replacement is verified`
        : `field route measurement SUPERSEDED for ${args.routeSegmentId} — the replacement is REPORTED_UNVERIFIED`,
      'calculation');

    await this.mirror('route_measurement_superseded', actor, t.replacement,
      `Field route measurement superseded for ${args.routeSegmentId}: ${old.measuredLengthFt} ft → ${args.measuredLengthFt} ft (replacement is REPORTED_UNVERIFIED)`,
      { supersededMeasurementId: old.id, supersededAVerifiedRecord: wasVerified, routeSegmentId: args.routeSegmentId });

    return {
      measurement: t.replacement,
      superseded: t.measurement,
      decision: null,
      invalidated,
      events: [
        ...await this.d.repository.listEvents(tenant.tenantId, args.projectId, t.measurement.id),
        ...await this.d.repository.listEvents(tenant.tenantId, args.projectId, t.replacement.id),
      ],
    };
  }

  // ── internals ───────────────────────────────────────────────────────────

  private newRecord(
    tenant: TenantKey,
    projectId: string,
    routeSegmentId: string,
    f: {
      measuredLengthFt: number; measurementMethod: MeasurementMethod; measuredByUserId: string;
      measuredAt: string; evidenceAttachmentIds: string[]; notes: string | null; nowIso: string;
      supersedesMeasurementId?: string | null;
    },
  ): FieldRouteMeasurement {
    return {
      id: randomUUID(),
      tenantId: tenant.tenantId,
      tenantOrganizationId: tenant.organizationId,
      projectId,
      routeSegmentId,
      measuredLengthFt: f.measuredLengthFt,
      measurementMethod: f.measurementMethod,
      measuredByUserId: f.measuredByUserId,
      measuredAt: f.measuredAt,
      recordedAt: f.nowIso,                    // SYSTEM-generated
      evidenceAttachmentIds: f.evidenceAttachmentIds,
      notes: f.notes,
      verificationState: newMeasurementState(), // ALWAYS REPORTED_UNVERIFIED
      verificationMode: null,
      verifiedByUserId: null,
      verifiedAt: null,
      verificationNotes: null,
      evidenceExceptionReason: null,
      rejectedByUserId: null,
      rejectedAt: null,
      rejectionReason: null,
      supersedesMeasurementId: f.supersedesMeasurementId ?? null,
      supersededByMeasurementId: null,
      createdAt: f.nowIso,
      updatedAt: f.nowIso,
    };
  }

  private async mustFind(tenantId: string, projectId: string, routeSegmentId: string, id: string): Promise<FieldRouteMeasurement> {
    const m = await this.d.repository.findById(tenantId, projectId, id);
    // NOT_FOUND, not FORBIDDEN: a cross-tenant or cross-project probe must not
    // learn that the record exists.
    if (!m) {
      throw new MeasurementError('NOT_FOUND', 'MEASUREMENT_NOT_FOUND',
        `Measurement ${id} was not found in this project.`);
    }
    if (m.routeSegmentId !== routeSegmentId) {
      throw new MeasurementError('NOT_FOUND', 'MEASUREMENT_ROUTE_MISMATCH',
        `Measurement ${id} does not belong to route segment '${routeSegmentId}'.`);
    }
    return m;
  }

  /** Invalidate the dependent artifact. Best-effort by DESIGN — an invalidation
   *  the ledger could not accept must not roll back a committed, audited field
   *  transition — but the failure is REPORTED to the caller rather than
   *  swallowed, so "the planset may be stale" is never silent. */
  private async invalidate(
    projectId: string, measurementId: string, reason: string, scope: 'snapshot' | 'calculation',
  ): Promise<{ scope: string; reason: string } | null> {
    if (!this.d.invalidation) return null;
    try {
      // D11 — scope the invalidation to the design it actually affects. This is
      // read INSIDE the try and fail-soft to null on purpose: a digest we cannot
      // establish must degrade to the honest project-wide watermark, and must
      // never abort an invalidation that has to be recorded either way. It is
      // never reconstructed after the fact.
      let digest: string | null = null;
      let snapshotId: string | null = null;
      if (this.d.routes.currentDesign) {
        try {
          const cur = await this.d.routes.currentDesign(projectId);
          digest = cur?.digest ?? null;
          snapshotId = cur?.snapshotId ?? null;
        } catch (err: unknown) {
          console.warn('[fieldMeasurement] current design digest unreadable — the invalidation will be',
            'recorded as a project-wide watermark rather than scoped:', err instanceof Error ? err.message : String(err));
        }
      }
      await this.d.invalidation.invalidate({
        projectId, reason, invalidatedBy: `field-route-measurement:${measurementId}`, scope, atIso: this.d.now(),
        digest, snapshotId,
      });
      return { scope, reason };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[fieldMeasurement] snapshot invalidation failed —',
        'the transition is committed and audited, but the stored artifact was NOT marked stale:', msg);
      return { scope, reason: `${reason} [INVALIDATION FAILED: ${msg}]` };
    }
  }

  /** Mirror into the compliance log. Explicitly best-effort; the durable audit
   *  is the event row written inside the store transaction. */
  private async mirror(
    action: string, actor: MeasurementActor, m: FieldRouteMeasurement,
    description: string, metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!this.d.compliance) return;
    try {
      await this.d.compliance.mirror({
        action, description,
        actorUserId: actor.userId,
        organizationId: actor.tenant.organizationId,
        projectId: m.projectId,
        measurementId: m.id,
        metadata: { ...metadata, tenantId: m.tenantId, measurementId: m.id },
      });
    } catch {
      // Intentionally swallowed: the durable record already committed.
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — CONSTRUCTION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** A service over the in-memory adapter, for the reachability proof, the
 *  security suite and offline development. Every layer above the driver is the
 *  production one. */
export function inMemoryMeasurementService(deps: {
  authorization: AuthorizationSource;
  evidence: EvidenceSource;
  routes: RouteFactSource;
  invalidation?: InvalidationSink;
  compliance?: ComplianceAuditSink;
  now?: () => string;
  seed?: FieldRouteMeasurement[];
}): FieldMeasurementService {
  return new FieldMeasurementService({
    repository: inMemoryFieldMeasurementRepository(deps.seed ?? []),
    authorization: deps.authorization,
    evidence: deps.evidence,
    routes: deps.routes,
    invalidation: deps.invalidation,
    compliance: deps.compliance,
    now: deps.now,
  });
}

/** Re-exported so callers can build the production service without importing
 *  five modules; the API layer uses `productionMeasurementService()`. */
export { productionAuthorizationSource, productionEvidenceSource, resolveProjectTenant };
export type { AuthorizationSource, EvidenceSource, EvidenceResolution, MeasurementActor };
