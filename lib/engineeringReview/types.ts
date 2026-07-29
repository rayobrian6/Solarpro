// lib/engineeringReview/types.ts
// AAC WS-8 / WS-9 — DIGEST-BOUND ENGINEERING REVIEW: the pure type layer.
//
// Mirrors `engineering_review_records` (migration 116). Pure (no DB import) so
// engines, the resolver, the API and tests share one contract.
//
// THE THREE HARD RULES, expressed as types + validators here and enforced by the
// store, never by a renderer:
//   1. an approval covers ONE snapshot digest, exactly;
//   2. only a LICENSED role may approve, and a licence number + state are
//      mandatory on the record;
//   3. records are APPEND-ONLY — a change supersedes.

/** The migration-115 role vocabulary, narrowed to the roles that may APPROVE. */
export const LICENSED_REVIEW_ROLES = ['engineer_of_record', 'approving_engineer'] as const;
export type LicensedReviewRole = (typeof LICENSED_REVIEW_ROLES)[number];

export function isLicensedReviewRole(v: unknown): v is LicensedReviewRole {
  return typeof v === 'string' && (LICENSED_REVIEW_ROLES as readonly string[]).includes(v);
}

export const REVIEW_DECISIONS = ['approved', 'rejected', 'withdrawn'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export function isReviewDecision(v: unknown): v is ReviewDecision {
  return typeof v === 'string' && (REVIEW_DECISIONS as readonly string[]).includes(v);
}

/** A 64-char hex SHA-256 — the snapshot digest form computeSnapshotDigest emits. */
export const SNAPSHOT_DIGEST_RE = /^[0-9a-f]{64}$/i;

export interface EngineeringReviewRecord {
  id: string;
  projectId: string;
  snapshotDigest: string;
  snapshotId: string | null;
  plansetEngineVersion: string | null;
  reviewerRole: LicensedReviewRole;
  reviewerUserId: string | null;
  reviewerName: string;
  reviewerLicense: string;
  reviewerLicenseState: string;
  reviewerLicenseExpiresOn: string | null;
  decision: ReviewDecision;
  decidedAt: string;
  scopeStatement: string | null;
  notes: string | null;
  evidenceRef: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface EngineeringReviewInput {
  id?: string;
  projectId: string;
  snapshotDigest: string;
  snapshotId?: string | null;
  plansetEngineVersion?: string | null;
  reviewerRole: string;
  reviewerUserId?: string | null;
  reviewerName: string;
  reviewerLicense: string;
  reviewerLicenseState: string;
  reviewerLicenseExpiresOn?: string | null;
  decision: string;
  scopeStatement?: string | null;
  notes?: string | null;
  evidenceRef?: string | null;
  createdBy?: string | null;
}

/**
 * THE validator. Fail-CLOSED: anything it cannot positively establish is a
 * refusal with the exact reason. Shared by the store and the API so a route can
 * never accept a record the store would.
 */
export function validateEngineeringReviewInput(
  input: EngineeringReviewInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.projectId?.trim()) return { ok: false, error: 'projectId is required' };
  if (!input.snapshotDigest?.trim()) {
    return { ok: false, error: 'snapshotDigest is required — an approval that names no snapshot covers nothing' };
  }
  if (!SNAPSHOT_DIGEST_RE.test(input.snapshotDigest)) {
    return { ok: false, error: 'snapshotDigest must be the 64-char hex SHA-256 the snapshot digest emits' };
  }
  if (!isReviewDecision(input.decision)) {
    return { ok: false, error: `decision must be one of ${REVIEW_DECISIONS.join('|')}; got '${input.decision}'` };
  }
  if (!isLicensedReviewRole(input.reviewerRole)) {
    return {
      ok: false,
      error: `reviewerRole must be a LICENSED role (${LICENSED_REVIEW_ROLES.join('|')}); got '${input.reviewerRole}'. `
        + 'A designer, preparer or internal reviewer may never record an engineering approval.',
    };
  }
  if (!input.reviewerName?.trim()) return { ok: false, error: 'reviewerName is required' };
  if (!input.reviewerLicense?.trim()) {
    return { ok: false, error: 'reviewerLicense is required — a licensed approval must name the licence it is made under' };
  }
  if (!input.reviewerLicenseState?.trim()) {
    return { ok: false, error: 'reviewerLicenseState is required — a licence is jurisdictional' };
  }
  if (input.decision === 'approved' && !input.scopeStatement?.trim()) {
    return {
      ok: false,
      error: 'scopeStatement is required for an approval — the reviewer must state what they accepted responsibility for; '
        + '"approved" may never be a bare boolean',
    };
  }
  if (input.reviewerLicenseExpiresOn) {
    const exp = Date.parse(input.reviewerLicenseExpiresOn);
    if (Number.isNaN(exp)) return { ok: false, error: 'reviewerLicenseExpiresOn must be an ISO date' };
    if (input.decision === 'approved' && exp < Date.now()) {
      return { ok: false, error: 'the reviewer licence recorded on this approval is expired' };
    }
  }
  return { ok: true };
}

/** The projection the snapshot consumes — the EXISTING shape
 *  `certification.engineeringReviewApproved` is typed as
 *  (`false | { reviewedDigest; approvedAtIso }`), plus the licensed identity so
 *  the artifact can say WHO approved rather than just THAT it was approved. */
export interface EngineeringReviewCoverage {
  /** true only when an ACTIVE approval exists for the EXACT digest queried. */
  covered: boolean;
  reviewedDigest: string | null;
  approvedAtIso: string | null;
  reviewerName: string | null;
  reviewerRole: LicensedReviewRole | null;
  reviewerLicense: string | null;
  reviewerLicenseState: string | null;
  scopeStatement: string | null;
  recordId: string | null;
  /** true ⇔ the store could not be read (migration 116 unrun / DB down). A
   *  DIFFERENT fact from "no approval exists", and never a clearance. */
  storeUnavailable: boolean;
  storeError: string | null;
  /** why coverage is what it is, in one sentence. */
  basis: string;
}

export function uncoveredReview(basis: string, opts?: {
  storeUnavailable?: boolean; storeError?: string | null;
}): EngineeringReviewCoverage {
  return {
    covered: false, reviewedDigest: null, approvedAtIso: null,
    reviewerName: null, reviewerRole: null, reviewerLicense: null, reviewerLicenseState: null,
    scopeStatement: null, recordId: null,
    storeUnavailable: opts?.storeUnavailable ?? false,
    storeError: opts?.storeError ?? null,
    basis,
  };
}
