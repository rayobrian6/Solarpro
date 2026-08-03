// lib/fieldMeasurement/types.ts
// WS-5 — THE FIELD ROUTE MEASUREMENT DOMAIN.
//
// WS-5 part 1 separated where a length CAME FROM (RouteLengthSource) from how
// well it is VERIFIED (RouteVerificationState). It could then express
// `field-reported` and `field-verified` — but nothing in the product could
// produce either, so `closesFieldVerification` answered a question no workflow
// could reach and ROUTE-LENGTH-ESTIMATE was structurally unclosable.
//
// This module is the domain half of the producer. Three rules are encoded here
// rather than in the API or the UI, because those are the two layers most likely
// to be bypassed or reimplemented:
//
//   1. RECORDING IS NOT VERIFICATION. `REPORTED_UNVERIFIED` is the ONLY state a
//      new record may hold. There is no input that sets another one, and
//      `newMeasurementState()` is a constant function for exactly that reason.
//
//   2. AUTHORITY IS A PAIR, NOT A FLAG. A measurement projects a
//      (RouteLengthSource, RouteVerificationState) pair that must be legal under
//      ROUTE_LENGTH_AUTHORITY_PAIRS. `measurementAuthorityPair()` is the only
//      place that mapping exists, so a reported measurement cannot acquire a
//      verified state by being read through a different accessor.
//
//   3. SELECTION PRECEDENCE IS NOT RELEASE AUTHORITY. A field REPORT outranks a
//      CAD route for CALCULATION (an operator who walked the run knows more than
//      a heuristic) and still does not close a field-verification requirement.
//      Those are two different questions and they get two different functions —
//      `measurementSelectionRank()` and `closesFieldVerification()` (the latter
//      already lives in the snapshot types and is imported, never re-declared).

import {
  isValidRouteLengthAuthority,
  type RouteLengthSource,
  type RouteVerificationState,
} from '@/lib/permit/snapshot/types';

// ═══════════════════════════════════════════════════════════════════════════
// §1 — THE VOCABULARY
// ═══════════════════════════════════════════════════════════════════════════

export const MEASUREMENT_METHODS = [
  'TAPE',
  'LASER',
  'MEASURING_WHEEL',
  'AS_BUILT_DRAWING',
  'OTHER',
] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

export function isMeasurementMethod(v: unknown): v is MeasurementMethod {
  return typeof v === 'string' && (MEASUREMENT_METHODS as readonly string[]).includes(v);
}

export const MEASUREMENT_VERIFICATION_STATES = [
  'REPORTED_UNVERIFIED',
  'VERIFIED',
  'REJECTED',
  'SUPERSEDED',
] as const;
export type MeasurementVerificationState = (typeof MEASUREMENT_VERIFICATION_STATES)[number];

/** WHY a verification was permitted — recorded AT verification time.
 *  Reconstructing this afterwards by comparing two user ids is a guess about
 *  intent; the tenant policy decision is the fact, so it is stored. */
export const VERIFICATION_MODES = [
  'INDEPENDENT_REVIEW',
  'AUTHORIZED_SELF_VERIFICATION',
  'SYSTEM_MIGRATED',
] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

export const MEASUREMENT_EVENT_TYPES = [
  'ROUTE_MEASUREMENT_RECORDED',
  'ROUTE_MEASUREMENT_VERIFIED',
  'ROUTE_MEASUREMENT_REJECTED',
  'ROUTE_MEASUREMENT_SUPERSEDED',
] as const;
export type MeasurementEventType = (typeof MEASUREMENT_EVENT_TYPES)[number];

// ═══════════════════════════════════════════════════════════════════════════
// §2 — THE RECORD
// ═══════════════════════════════════════════════════════════════════════════

export interface FieldRouteMeasurement {
  id: string;

  /** canonical tenant key — 'org:<uuid>' | 'user:<uuid>'. See §4. */
  tenantId: string;
  /** the relational half of the tenant, when the tenant IS an organization. */
  tenantOrganizationId: string | null;
  projectId: string;
  /** the canonical RouteSegmentRecord.segmentId this measurement is OF. */
  routeSegmentId: string;

  measuredLengthFt: number;
  measurementMethod: MeasurementMethod;

  measuredByUserId: string;
  /** when the tape was on the run (operator-supplied). */
  measuredAt: string;
  /** when the platform recorded it (system-generated, never client-supplied). */
  recordedAt: string;

  evidenceAttachmentIds: string[];
  notes: string | null;

  verificationState: MeasurementVerificationState;
  verificationMode: VerificationMode | null;

  verifiedByUserId: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  /** the DOCUMENTED authorised exception when verification proceeded with no
   *  attachment. A written reason someone can be held to — never a checkbox. */
  evidenceExceptionReason: string | null;

  rejectedByUserId: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;

  supersedesMeasurementId: string | null;
  supersededByMeasurementId: string | null;

  createdAt: string;
  updatedAt: string;
}

/** One row of the ATOMIC domain audit (migration 118's second table). Written by
 *  the SAME transaction as the transition it records. */
export interface FieldRouteMeasurementEvent {
  id: string;
  tenantId: string;
  tenantOrganizationId: string | null;
  projectId: string;
  routeSegmentId: string;
  measurementId: string;
  eventType: MeasurementEventType;
  actorUserId: string | null;
  previousState: MeasurementVerificationState | null;
  newState: MeasurementVerificationState;
  snapshotId: string | null;
  snapshotDigest: string | null;
  calculationRecordId: string | null;
  /** IDs and scalars ONLY. Never attachment bytes, never file contents. */
  detail: Record<string, unknown>;
  occurredAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE ONE STATE A NEW RECORD MAY HOLD
// ═══════════════════════════════════════════════════════════════════════════

/** A new measurement is ALWAYS unverified. This is a constant function, not a
 *  defaulted parameter, because a defaulted parameter can be overridden by a
 *  caller and this may not be. The DB default and CHECK constraints in migration
 *  118 say the same thing at the storage layer. */
export function newMeasurementState(): MeasurementVerificationState {
  return 'REPORTED_UNVERIFIED';
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — TENANCY
// ───────────────────────────────────────────────────────────────────────────
// SolarPro projects carry no organization column: projects.user_id is the only
// owner pointer, and the org lives on the USER (users.org_id / the
// organization_members membership table, migration 105). The tenant of a project
// is therefore DERIVED from its owner, and must be expressible for BOTH shapes —
// an org-owned project and a solo operator's project. One TEXT key does that;
// a UUID cannot.
// ═══════════════════════════════════════════════════════════════════════════

export interface TenantKey {
  /** 'org:<uuid>' | 'user:<uuid>' */
  tenantId: string;
  /** the organization id when this tenant IS an organization, else null. */
  organizationId: string | null;
  /** the project owner. Always present — it is what the key is derived from. */
  ownerUserId: string;
}

export function organizationTenant(organizationId: string, ownerUserId: string): TenantKey {
  return { tenantId: `org:${organizationId}`, organizationId, ownerUserId };
}

export function soloTenant(ownerUserId: string): TenantKey {
  return { tenantId: `user:${ownerUserId}`, organizationId: null, ownerUserId };
}

/** Fail-closed comparison. Two tenants are the same only when their canonical
 *  keys are byte-identical; there is no "close enough". */
export function sameTenant(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.length > 0 && a === b;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5 — DEFENSIBLE ENGINEERING BOUNDS
// ───────────────────────────────────────────────────────────────────────────
// The storage layer's CHECK is a sanity rail (0 < ft ≤ 10000). THIS is the
// engineering policy, and it is stated rather than assumed: a PV route segment
// on a residential or light-commercial site that measures under half a foot is a
// typo, and one over 2000 ft is either a different kind of project or a units
// error (2000 ft at 240 V is already far past any voltage-drop criterion, so a
// number beyond it cannot produce a passing design and is far more likely to be
// metres, inches or a mis-keyed digit).
//
// Both bounds are REFUSALS with a stated reason, never silent clamps — a clamped
// measurement is a fabricated one.
// ═══════════════════════════════════════════════════════════════════════════

export const MIN_MEASURED_LENGTH_FT = 0.5;
export const MAX_MEASURED_LENGTH_FT = 2000;

export const MEASURED_LENGTH_BOUNDS_BASIS =
  `A measured route length must be a finite number in [${MIN_MEASURED_LENGTH_FT}, ${MAX_MEASURED_LENGTH_FT}] ft. `
  + 'Under half a foot is a typo, not a run; over 2000 ft cannot satisfy any voltage-drop criterion at PV '
  + 'service voltages and is far more likely a unit error (metres/inches) or a mis-keyed digit. Out-of-bounds '
  + 'input is REFUSED with this reason — never clamped, because a clamped measurement is a fabricated one.';

// ═══════════════════════════════════════════════════════════════════════════
// §6 — AUTHORITY PROJECTION (the ONLY mapping from a record to a length pair)
// ═══════════════════════════════════════════════════════════════════════════

/** The (source, state) pair a measurement in this state projects onto the
 *  canonical route segment, or null when the record carries no authority at all
 *  (rejected / superseded — retained as history, never selected). */
export function measurementAuthorityPair(
  state: MeasurementVerificationState,
): { lengthSource: RouteLengthSource; verificationState: RouteVerificationState } | null {
  if (state === 'VERIFIED') {
    return { lengthSource: 'field-verified', verificationState: 'field-verified' };
  }
  if (state === 'REPORTED_UNVERIFIED') {
    return { lengthSource: 'field-reported', verificationState: 'field-reported' };
  }
  // REJECTED and SUPERSEDED carry NO authority. They are kept because history is
  // the point of an append-only ledger, not because they still mean something.
  return null;
}

/** Fail-closed self-check: every pair this module can project must be legal
 *  under the WS-5 part-1 pairing table. Exported so a test can assert it rather
 *  than a comment claiming it. */
export function measurementAuthorityPairsAreLegal(): boolean {
  return MEASUREMENT_VERIFICATION_STATES.every(s => {
    const p = measurementAuthorityPair(s);
    return p == null || isValidRouteLengthAuthority(p.lengthSource, p.verificationState);
  });
}

/** SELECTION rank — higher wins when choosing the ACTIVE measurement.
 *  This is NOT release authority: a field REPORT outranks nothing but the CAD
 *  sources for the purpose of CALCULATION, and still closes no requirement.
 *  Rejected and superseded records are not ranked at all (never selected). */
export function measurementSelectionRank(state: MeasurementVerificationState): number {
  switch (state) {
    case 'VERIFIED': return 2;
    case 'REPORTED_UNVERIFIED': return 1;
    default: return 0;
  }
}

/** Is this record eligible to be the ACTIVE authority for its segment? */
export function isSelectableMeasurement(m: FieldRouteMeasurement): boolean {
  return (m.verificationState === 'VERIFIED' || m.verificationState === 'REPORTED_UNVERIFIED')
    && m.supersededByMeasurementId == null;
}

// ═══════════════════════════════════════════════════════════════════════════
// §7 — ROUTE APPLICABILITY (what the service needs from the canonical snapshot)
// ───────────────────────────────────────────────────────────────────────────
// A route segment is a SNAPSHOT record, not a relational row, so "does this
// route exist and may it receive project field-measurement authority" is a
// DOMAIN read, not a foreign key. This is the shape of that answer.
// ═══════════════════════════════════════════════════════════════════════════

export interface RouteApplicabilityFact {
  segmentId: string;
  exists: boolean;
  /** D1 — 'PROJECT_OWNED' | 'UTILITY_OWNED'. Read fail-closed as PROJECT_OWNED. */
  routeOwnership: 'PROJECT_OWNED' | 'UTILITY_OWNED';
  /** D1 — 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE'. Fail-closed as REQUIRED. */
  routeAuthorityApplicability: 'REQUIRED' | 'EXCLUDED' | 'NOT_APPLICABLE';
  routeApplicabilityReason: string | null;
  electricalFunction: string | null;
  from: string | null;
  to: string | null;
  /** the CAD numbers the measurement will (or will not) displace. */
  cadEstimatedLengthFt: number | null;
  cadRoutedLengthFt: number | null;
  currentLengthSource: string | null;
  currentVerificationState: string | null;
}

/** D1 — utility-owned service equipment is not the installer's to measure. An
 *  EXCLUDED run refuses the ordinary project measurement workflow outright; a
 *  separate explicit policy would be required to change that, and none exists. */
export function routeAcceptsProjectMeasurement(fact: RouteApplicabilityFact): { ok: true } | { ok: false; reason: string } {
  if (!fact.exists) {
    return { ok: false, reason: `route segment '${fact.segmentId}' does not exist in this project's canonical snapshot` };
  }
  if (fact.routeAuthorityApplicability !== 'REQUIRED') {
    const why = fact.routeOwnership === 'UTILITY_OWNED'
      ? 'utility-owned service equipment is not the installer\'s to route, measure, procure or modify'
      : (fact.routeApplicabilityReason ?? 'project route authority does not apply to this run');
    return {
      ok: false,
      reason: `route segment '${fact.segmentId}' is ${fact.routeAuthorityApplicability} from project route authority — ${why}`,
    };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// §8 — INPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

export interface RecordMeasurementInput {
  tenant: TenantKey;
  projectId: string;
  routeSegmentId: string;
  measuredLengthFt: number;
  measurementMethod: string;
  /** server-stamped from the authenticated session — never client-supplied. */
  measuredByUserId: string;
  measuredAt: string;
  evidenceAttachmentIds?: string[];
  notes?: string | null;
  /** set ONLY by the supersede operation. */
  supersedesMeasurementId?: string | null;
}

export type ValidationOutcome = { ok: true } | { ok: false; error: string; code: string };

const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Pure input validation. Refuses; never repairs. */
export function validateRecordInput(input: RecordMeasurementInput, nowIso: string): ValidationOutcome {
  if (!input.tenant?.tenantId) return { ok: false, code: 'TENANT_REQUIRED', error: 'a tenant context is required' };
  if (!input.projectId?.trim()) return { ok: false, code: 'PROJECT_REQUIRED', error: 'projectId is required' };
  if (!input.routeSegmentId?.trim()) return { ok: false, code: 'ROUTE_REQUIRED', error: 'routeSegmentId is required' };
  if (!input.measuredByUserId?.trim()) {
    return { ok: false, code: 'MEASURER_REQUIRED', error: 'measuredByUserId is required — no anonymous measurement' };
  }
  const ft = input.measuredLengthFt;
  if (typeof ft !== 'number' || !Number.isFinite(ft)) {
    return { ok: false, code: 'LENGTH_NOT_FINITE', error: `measuredLengthFt must be a finite number. ${MEASURED_LENGTH_BOUNDS_BASIS}` };
  }
  if (ft < MIN_MEASURED_LENGTH_FT || ft > MAX_MEASURED_LENGTH_FT) {
    return {
      ok: false, code: 'LENGTH_OUT_OF_BOUNDS',
      error: `measuredLengthFt ${ft} is outside the defensible range. ${MEASURED_LENGTH_BOUNDS_BASIS}`,
    };
  }
  if (!isMeasurementMethod(input.measurementMethod)) {
    return {
      ok: false, code: 'METHOD_INVALID',
      error: `measurementMethod must be one of ${MEASUREMENT_METHODS.join(' | ')}; got '${String(input.measurementMethod)}'`,
    };
  }
  const at = input.measuredAt;
  if (typeof at !== 'string' || !ISO_RE.test(at) || Number.isNaN(Date.parse(at))) {
    return { ok: false, code: 'MEASURED_AT_INVALID', error: 'measuredAt must be an ISO-8601 timestamp' };
  }
  // A measurement taken in the future is not a measurement. One minute of skew is
  // allowed for a field device whose clock is a little ahead.
  if (Date.parse(at) > Date.parse(nowIso) + 60_000) {
    return { ok: false, code: 'MEASURED_AT_FUTURE', error: 'measuredAt is in the future — a measurement cannot precede itself' };
  }
  const ids = input.evidenceAttachmentIds ?? [];
  if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string' || !x.trim())) {
    return { ok: false, code: 'EVIDENCE_IDS_INVALID', error: 'evidenceAttachmentIds must be an array of non-empty ids' };
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// §9 — STRUCTURED ERRORS
// ───────────────────────────────────────────────────────────────────────────
// One error type across service and API so the HTTP layer maps rather than
// re-decides. A service that throws bare Errors forces the route handler to
// regex the message, which is how a 403 becomes a 500.
// ═══════════════════════════════════════════════════════════════════════════

export type MeasurementErrorKind =
  | 'VALIDATION'      // 400 — the input is malformed
  | 'FORBIDDEN'       // 403 — authenticated, but not permitted
  | 'NOT_FOUND'       // 404 — no such measurement/route IN THIS TENANT+PROJECT
  | 'CONFLICT'        // 409 — the record is not in a state that allows this
  | 'POLICY'          // 422 — permitted, but policy refuses (e.g. no evidence)
  | 'UNAVAILABLE';    // 503 — the store could not be read/written

export class MeasurementError extends Error {
  readonly kind: MeasurementErrorKind;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(kind: MeasurementErrorKind, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MeasurementError';
    this.kind = kind;
    this.code = code;
    this.details = details;
  }
}

export const MEASUREMENT_ERROR_STATUS: Record<MeasurementErrorKind, number> = {
  VALIDATION: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  POLICY: 422,
  UNAVAILABLE: 503,
};
