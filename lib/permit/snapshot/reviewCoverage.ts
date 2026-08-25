// ═══════════════════════════════════════════════════════════════════════════
// PRR §1 — THE REVIEW-COVERAGE DECISION (pure).
//
// THE ONE place that answers "does a licensed approval cover THIS design?".
// Before this module the answer was three literals in build.ts
// (`engineerReviewCoversCurrentDigest: false`, `signatureSealSatisfied: false`,
// `currentDigest: ''`), so the ISSUED-FOR-PERMIT gate was unreachable no matter
// what a reviewer actually recorded — and worse, supplying a REAL approval drove
// the issue state to REVISED, because a 64-char digest never equals `''`.
//
// WHAT AN APPROVAL BINDS TO — THE DESIGN DIGEST, NOT THE ARTIFACT DIGEST.
// The snapshot digest used to be computed over the WHOLE snapshot, including the
// projection of the approval itself (`certification.engineeringReviewApproved`,
// `certification.engineer`, the issue state, the release registry). Recording an
// approval for digest D therefore produced a snapshot whose digest was D′ ≠ D, so
// `reviewedDigest === meta.digest` — the test every consumer applies (validate
// V33/V34, certPages, plansetProfile.certificationIsCompleted, peLetterIdentity)
// — could never be true for any approval whatsoever. That circularity is fixed in
// build.ts by digesting the REVIEW-NEUTRAL snapshot: `meta.digest` now identifies
// the DESIGN, and an approval names a design. Signing a document may not change
// the document it signs.
//
// FAIL-CLOSED, EVERY FACT REQUIRED. Coverage is granted only when all of these
// are positively established; anything missing, ambiguous, stale, revoked,
// superseded, digest-mismatched or unreadable refuses, with the reason recorded.
//   1. a coverage record exists and the store was readable
//   2. the store matched an ACTIVE, 'approved', non-superseded record
//      (decision/supersession filtering happens in the SQL — store.ts
//      findActiveApproval — so a rejected or withdrawn record never arrives here)
//   3. the reviewer's role is LICENSED
//   4. the reviewer's identity is complete: name + licence number + licence state
//   5. the approval carries a scope statement ("approved" is never a bare boolean)
//   6. the approval names a 64-hex digest
//   7. that digest is EXACTLY this build's design digest
//   8. no active authority-ledger invalidation applies to it
// ═══════════════════════════════════════════════════════════════════════════
import type { EngineeringReviewCoverage } from '@/lib/engineeringReview/types';
import { SNAPSHOT_DIGEST_RE, isLicensedReviewRole } from '@/lib/engineeringReview/types';

/** One ACTIVE `snapshot_digest_invalidations` row, projected for the decision.
 *  `digest === null` is the reconciliation writer's "every digest current at the
 *  time of writing is stale" form (lib/reconciliation/reconcile.ts). */
export interface DigestInvalidationFact {
  digest: string | null;
  scope: string | null;
  invalidatedAtIso: string | null;
  reason: string | null;
}

export interface ReviewCoverageDecisionInput {
  /** the resolver's projection of the migration-116 store (null ⇒ never asked). */
  coverage: EngineeringReviewCoverage | null;
  /** THIS build's review-neutral design digest — what an approval must name. */
  designDigest: string;
  /** ACTIVE invalidation rows for the project. `null` ⇒ the ledger could not be
   *  read, which is NOT "no invalidations" and fails closed. */
  invalidations: DigestInvalidationFact[] | null;
}

export interface ReviewCoverageDecision {
  /** the ISSUED-FOR-PERMIT `engineerReviewCoversCurrentDigest` precondition. */
  covers: boolean;
  /** the ISSUED-FOR-PERMIT `signatureSealSatisfied` precondition. */
  signatureSealSatisfied: boolean;
  /** the digest the approval names (recorded even when it does not cover). */
  reviewedDigest: string | null;
  /** an active ledger entry applies to this approval. */
  invalidatedByLedger: boolean;
  /** every fact that refused, in order. Empty ⇔ `covers`. */
  refusals: string[];
  /** one sentence for the artifact / the gate detail. */
  basis: string;
}

/**
 * Does an ACTIVE ledger invalidation apply to this approval?
 *
 * THE BUG THIS REPLACES: the ledger read was project-scoped and the verdict was
 * `rows.length > 0`, so ANY row ever written blocked review coverage FOREVER.
 * Nothing supersedes a row (`superseded_at` is written nowhere in the codebase —
 * only read, in reconcile.ts:399), and the reconciliation writer records
 * `digest: null`. The live Braidon project carries 22 such rows from equipment
 * reconciliations on 2026-07-28/29, so its review-coverage precondition was
 * latched false permanently and no approval could ever have released it.
 *
 * THE HONEST RULE, matching what the writer says it means
 * ("engineer review tied to the OLD snapshot digest is invalidated until a NEW
 *  review explicitly covers the rebuilt digest"):
 *   • a row that NAMES a digest invalidates an approval of exactly that digest;
 *   • a row with a NULL digest invalidates approvals recorded AT OR BEFORE the
 *     moment it was written — those are the approvals "tied to the old digest".
 *     An approval recorded AFTER it is, by the writer's own words, the new review
 *     that covers the rebuilt digest.
 *   • an unreadable ledger invalidates everything (unknown never releases).
 * A design change is already caught by the digest itself; the ledger exists for
 * authority changes that do NOT move the digest, and it may not outlive them.
 */
export function invalidationApplies(
  invalidations: DigestInvalidationFact[] | null,
  designDigest: string,
  approvedAtIso: string | null,
): { invalidated: boolean; reason: string | null } {
  if (invalidations === null) {
    return { invalidated: true, reason: 'the snapshot_digest_invalidations ledger could not be read — an unreadable authority ledger never releases a package' };
  }
  const approvedAt = approvedAtIso ? Date.parse(approvedAtIso) : NaN;
  for (const row of invalidations) {
    if (row.digest && row.digest.toLowerCase() === designDigest.toLowerCase()) {
      return {
        invalidated: true,
        reason: `an active authority-ledger entry invalidates design digest ${designDigest.slice(0, 12)}…`
          + (row.reason ? ` (${row.reason})` : ''),
      };
    }
    if (!row.digest) {
      const invalidatedAt = row.invalidatedAtIso ? Date.parse(row.invalidatedAtIso) : NaN;
      // Unknown timestamps on either side cannot be ordered ⇒ fail closed.
      if (Number.isNaN(invalidatedAt) || Number.isNaN(approvedAt) || approvedAt <= invalidatedAt) {
        return {
          invalidated: true,
          reason: `an active authority-ledger entry recorded ${row.invalidatedAtIso ?? 'at an unrecorded time'} invalidates approvals made at or before it`
            + (row.reason ? ` (${row.reason})` : ''),
        };
      }
    }
  }
  return { invalidated: false, reason: null };
}

/** THE decision. Pure; every refusal is named. */
export function decideReviewCoverage(input: ReviewCoverageDecisionInput): ReviewCoverageDecision {
  const c = input.coverage;
  const refusals: string[] = [];
  const reviewedDigest = c?.reviewedDigest ?? null;

  const refuse = (basis: string): ReviewCoverageDecision => ({
    covers: false, signatureSealSatisfied: false, reviewedDigest,
    invalidatedByLedger: false, refusals, basis,
  });

  if (!c) {
    refusals.push('no engineering-review coverage was resolved');
    return refuse('no engineering-review record was looked up for this build');
  }
  if (c.storeUnavailable) {
    refusals.push('the engineering-review store is unreadable');
    return refuse(`the engineering-review store could not be read (${c.storeError ?? 'no detail'}) — an unreadable store never satisfies a professional-release gate`);
  }
  if (!c.covered) {
    refusals.push('no active approved review record');
    return refuse(c.basis || 'no active approved engineering-review record');
  }
  if (!isLicensedReviewRole(c.reviewerRole)) {
    refusals.push(`reviewer role '${c.reviewerRole ?? 'none'}' is not licensed`);
    return refuse(`the review names role '${c.reviewerRole ?? 'none'}', which may not record a professional approval`);
  }
  const identityComplete = !!c.reviewerName?.trim() && !!c.reviewerLicense?.trim() && !!c.reviewerLicenseState?.trim();
  if (!identityComplete) {
    refusals.push('the reviewer identity is incomplete (name / licence number / licence state)');
    return refuse('the approval does not carry a complete licensed identity (name, licence number and licence state)');
  }
  if (!c.scopeStatement?.trim()) {
    refusals.push('the approval carries no scope statement');
    return refuse('the approval states no scope — a professional approval may never be a bare boolean');
  }
  if (!reviewedDigest || !SNAPSHOT_DIGEST_RE.test(reviewedDigest)) {
    refusals.push('the approval names no valid snapshot digest');
    return refuse('the approval does not name a valid 64-character snapshot digest, so it covers nothing');
  }
  if (reviewedDigest.toLowerCase() !== input.designDigest.toLowerCase()) {
    refusals.push('the approval names a different design digest');
    return refuse(
      `the approval covers design digest ${reviewedDigest.slice(0, 12)}… but this package is `
      + `${input.designDigest.slice(0, 12)}… — the design changed after approval and requires a new review`,
    );
  }

  const led = invalidationApplies(input.invalidations, input.designDigest, c.approvedAtIso);
  if (led.invalidated) {
    refusals.push('an active authority-ledger invalidation applies');
    return { covers: false, signatureSealSatisfied: false, reviewedDigest, invalidatedByLedger: true, refusals, basis: led.reason ?? 'invalidated by the authority ledger' };
  }

  // ── A.1.1 §2 — THE SEAL IS ITS OWN AUTHORITY EVENT ───────────────────────
  // This used to return `signatureSealSatisfied: true` for ANY covering review,
  // reasoning that "the digest-bound record IS the signature". That inferred a
  // formal legal instrument from a database row. A review says a licensed
  // professional accepted these exact bytes; a seal is how they attest it to the
  // AHJ. They are recorded at different moments and revocable independently.
  //
  // The seal now requires its own governed evidence: a seal record, a content
  // hash of the sealed instrument (a seal with no artifact is a claim, not a
  // seal), a verification flag, and a licence state matching the reviewer's —
  // a seal is state-scoped, so a seal from another jurisdiction satisfies
  // nothing here. Absent ⇒ the SEAL precondition fails while the REVIEW still
  // legitimately covers the design. `covers` is deliberately unaffected.
  const _sealStateOk = !!c.sealLicenseState?.trim()
    && c.sealLicenseState.trim().toUpperCase() === (c.reviewerLicenseState ?? '').trim().toUpperCase();
  const sealSatisfied =
    c.sealVerified === true
    && !!c.sealRecordId?.trim()
    && !!c.sealArtifactSha256?.trim()
    && !!c.sealedAtIso?.trim()
    && _sealStateOk;
  if (!sealSatisfied) {
    refusals.push(
      c.sealRecordId?.trim()
        ? 'a seal record exists but is unverified, unhashed, undated, or scoped to a different licence state'
        : 'no governed signature/seal evidence is recorded — the review covers the design, the seal does not exist',
    );
  }

  return {
    covers: true,
    signatureSealSatisfied: sealSatisfied,
    reviewedDigest,
    invalidatedByLedger: false,
    refusals,
    basis: c.basis
      || `${c.reviewerName} (${c.reviewerRole}, licence ${c.reviewerLicense} ${c.reviewerLicenseState}) approved design digest ${reviewedDigest.slice(0, 12)}…`,
  };
}
