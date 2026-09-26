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
  // ── A.1.1 §2 — SIGNATURE / SEAL IS A SEPARATE AUTHORITY EVENT ─────────────
  // A digest-bound review says a licensed professional accepted these exact
  // bytes. A signature/seal is the formal instrument by which they attest it to
  // the AHJ. They are recorded at different moments, can be revoked
  // independently, and one does not imply the other. `signatureSealSatisfied`
  // used to be returned `true` for any covering review, on the reasoning that
  // "the digest-bound record IS the signature" — that inferred a legal
  // instrument from a database row. These fields carry the seal as its own
  // governed evidence; absent ⇒ the seal precondition is NOT satisfied, while
  // the review itself may still legitimately cover the design.
  /** the governed seal artifact id, when one has been recorded. */
  sealRecordId: string | null;
  /** content hash of the sealed instrument — a seal with no artifact is a claim. */
  sealArtifactSha256: string | null;
  sealedAtIso: string | null;
  /** the jurisdiction the seal is valid in. A seal is state-scoped. */
  sealLicenseState: string | null;
  /** true only when the seal record itself passed governed verification. */
  sealVerified: boolean;
  /** true ⇔ the store could not be read (migration 116 unrun / DB down). A
   *  DIFFERENT fact from "no approval exists", and never a clearance. */
  storeUnavailable: boolean;
  storeError: string | null;
  // ── R9 — A PRIOR APPROVAL THAT THE DESIGN HAS MOVED ON FROM ───────────────
  // 🚨 "NOT APPROVED" AND "APPROVED, THEN THE CALCULATION CHANGED" ARE DIFFERENT
  // FACTS, AND THE PRODUCT USED TO REPORT THEM IDENTICALLY.
  //
  // An approval names a design digest. Change anything the design digest covers
  // — and the structural-basis correction that stopped the permit hardcoding a
  // 15 ft building changes qz, net uplift and the attachment schedule — and
  // `findActiveApproval` matches nothing, so the package fell back to the same
  // "no active approved record" sentence a never-reviewed design gets. The
  // engineer who sealed it, the date they sealed it, and the digest they
  // accepted responsibility for all disappeared from the answer.
  //
  // That is a PROVENANCE failure, not a badge: the record still exists in
  // `engineering_review_records` and is never deleted, but nothing surfaced it,
  // so no one could tell "nobody has reviewed this" from "a PE approved an
  // earlier revision and this one needs re-review".
  //
  // Populated ONLY when coverage is refused and a prior approved record exists
  // for the project. It NEVER grants coverage — `covered` stays false — and it
  // is ELIDED from the digested authority projection (see
  // elideOperationalAuthority), with the real value kept on
  // `resolverAttemptEvidence`, exactly as `storeError` is handled.
  //
  // OPTIONAL, and set ONLY when one exists — that is deliberate and it is a digest
  // property, not a style choice. `JSON.stringify({a: null})` KEEPS the key while
  // `{a: undefined}` DROPS it, and this object is projected into
  // `snapshot.resolutionAuthority`, which IS digested. A `null` leaf here would
  // therefore alter every package that carries a coverage record; an absent key
  // alters none of them.
  supersededApproval?: SupersededApproval | null;
  /** why coverage is what it is, in one sentence. */
  basis: string;
}

/**
 * The provenance of an approval that no longer covers the current design.
 *
 * Every field here answers a question an operator or a reviewing engineer will
 * ask about a package that says RE-REVIEW REQUIRED: who accepted the earlier
 * revision, under what licence, when, and which two digests are in play.
 */
export interface SupersededApproval {
  /** the `engineering_review_records` row — never deleted, always citable. */
  recordId: string;
  reviewerName: string | null;
  reviewerRole: LicensedReviewRole | null;
  reviewerLicense: string | null;
  reviewerLicenseState: string | null;
  /** when they approved it. */
  approvedAtIso: string | null;
  /** the design digest they accepted responsibility for. */
  approvedDigest: string;
  /** the design digest this build produced — what they have NOT reviewed. */
  currentDigest: string;
}

export function uncoveredReview(basis: string, opts?: {
  storeUnavailable?: boolean; storeError?: string | null;
  supersededApproval?: SupersededApproval | null;
}): EngineeringReviewCoverage {
  return {
    covered: false, reviewedDigest: null, approvedAtIso: null,
    reviewerName: null, reviewerRole: null, reviewerLicense: null, reviewerLicenseState: null,
    scopeStatement: null, recordId: null,
    sealRecordId: null, sealArtifactSha256: null, sealedAtIso: null,
    sealLicenseState: null, sealVerified: false,
    storeUnavailable: opts?.storeUnavailable ?? false,
    storeError: opts?.storeError ?? null,
    // Spread, never `?? null` — see the field's own note: an absent key is dropped
    // by JSON.stringify, a null one is not, and this lands in a digested container.
    ...(opts?.supersededApproval ? { supersededApproval: opts.supersededApproval } : {}),
    basis,
  };
}
