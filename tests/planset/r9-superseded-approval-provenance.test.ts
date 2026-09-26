// ═══════════════════════════════════════════════════════════════════════════
// R9 — "PE APPROVED" MUST NEVER DESCRIBE A CALCULATION NOBODY APPROVED
//
// An approval names a DESIGN DIGEST. Correcting the structural basis — the repair
// that stopped the permit hardcoding a 15 ft building, which moves Kz, qz, the net
// uplift and the attachment schedule — changes that digest. `findActiveApproval`
// matches on an EXACT digest, so after such a correction it matches nothing.
//
// 🚨 AND THE PRODUCT THEN SAID THE SAME THING IT SAYS ABOUT A DESIGN NOBODY HAS EVER
// OPENED: "no active approved engineering-review record covers snapshot digest X…".
// The engineer who sealed the earlier revision, the date they sealed it, and the
// digest they accepted responsibility for were all absent from the answer, even
// though the row was still sitting in `engineering_review_records` and had never been
// withdrawn. That is a PROVENANCE failure, not a badge: nobody could tell
// "unreviewed" from "approved, then the calculation changed".
//
// TWO defects are fixed here and each has its own cases below:
//
//  1. THE STORE NEVER ASKED. `resolveEngineeringReviewCoverage` returned a bare
//     uncovered record. It now also reports the prior approval, as provenance only.
//
//  2. 🚨 THE SURFACING GUARD COULD NOT FIRE FOR THE CASE IT WAS WRITTEN FOR.
//     build.ts fired its "a record EXISTS but does not release this package" branch
//     on `_reviewCoverage.covered` alone — true only when the store matched THIS
//     exact digest. So it reached the narrow cases (unlicensed, unscoped, incomplete
//     identity, ledger invalidation) and never the commonest one, a design that
//     changed after approval. The explanation stayed the PASS-1 "pending" text — the
//     precise outcome that branch's own comment forbids: "'pending' would hide a
//     stale or invalidated approval from the reviewer."
//
// NOTHING HERE GRANTS COVERAGE. Every case asserts `covers === false`.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { decideReviewCoverage } from '@/lib/permit/snapshot/reviewCoverage';
import { elideOperationalAuthority, OPERATIONAL_ELIDED } from '@/lib/permit/snapshot/resolution/authorityProjection';
import { uncoveredReview } from '@/lib/engineeringReview/types';
import type { EngineeringReviewCoverage, SupersededApproval } from '@/lib/engineeringReview/types';

const OLD_DIGEST = 'a'.repeat(64);
const NEW_DIGEST = 'b'.repeat(64);

const SUPERSEDED: SupersededApproval = {
  recordId: 'rec-0001',
  reviewerName: 'Jordan Vale, PE',
  reviewerRole: 'engineer_of_record',
  reviewerLicense: '062-071234',
  reviewerLicenseState: 'IL',
  approvedAtIso: '2026-08-04T10:00:00.000Z',
  approvedDigest: OLD_DIGEST,
  currentDigest: NEW_DIGEST,
};

/** The store's projection when nothing active+approved matches THIS digest. */
function uncovered(over: Partial<EngineeringReviewCoverage> = {}): EngineeringReviewCoverage {
  return {
    covered: false, reviewedDigest: null, approvedAtIso: null,
    reviewerName: null, reviewerRole: null, reviewerLicense: null, reviewerLicenseState: null,
    scopeStatement: null, recordId: null,
    sealRecordId: null, sealArtifactSha256: null, sealedAtIso: null,
    sealLicenseState: null, sealVerified: false,
    storeUnavailable: false, storeError: null,
    basis: `no active approved engineering-review record covers snapshot digest ${NEW_DIGEST.slice(0, 12)}…`,
    ...over,
  };
}

const decide = (coverage: EngineeringReviewCoverage) =>
  decideReviewCoverage({ coverage, designDigest: NEW_DIGEST, invalidations: [] });

describe('🚨 a design approved at an earlier digest', () => {
  it('is NEVER covered — the provenance releases nothing', () => {
    // The whole repair is a reporting one. If it ever granted coverage it would be
    // far worse than the defect: a package released on an approval of different
    // numbers. This is the case to read first.
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.covers).toBe(false);
    expect(d.signatureSealSatisfied).toBe(false);
  });

  it('🚨 says RE-REVIEW REQUIRED, not "no record"', () => {
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.basis).toMatch(/RE-REVIEW REQUIRED/);
    expect(d.basis, 'the stale case must not reuse the never-reviewed sentence')
      .not.toMatch(/^no active approved/);
  });

  it('names WHO approved it, WHEN, and BOTH digests', () => {
    // Ray's requirement verbatim: preserve who approved, when, old digest, new
    // digest, and the reason it became stale. A reviewer cannot act on "stale".
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.basis).toContain('Jordan Vale, PE');
    expect(d.basis).toContain('062-071234');
    expect(d.basis).toContain('2026-08-04T10:00:00.000Z');
    expect(d.basis).toContain(OLD_DIGEST.slice(0, 12));
    expect(d.basis).toContain(NEW_DIGEST.slice(0, 12));
  });

  it('says the approval is RETAINED and cites the record', () => {
    // "Do NOT delete the historical approval." The sentence must not read as a
    // withdrawal — the engineer did nothing wrong and their record still stands.
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.basis).toMatch(/retained|NOT been withdrawn/i);
    expect(d.basis).toContain('rec-0001');
  });

  it('carries the structured provenance on the decision, not just prose', () => {
    // A sentence is for a human; the record is for every other consumer.
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.supersededApproval).toEqual(SUPERSEDED);
    expect(d.reviewedDigest, 'the digest that WAS approved must be reported').toBe(OLD_DIGEST);
  });

  it('records the refusal in the refusal list, where the gate reads it', () => {
    const d = decide(uncovered({ supersededApproval: SUPERSEDED }));
    expect(d.refusals.join(' | ')).toMatch(/RE-REVIEW REQUIRED/);
  });
});

describe('a design that genuinely has never been reviewed', () => {
  it('keeps the old sentence and gains no provenance', () => {
    // The two facts must stay distinguishable in BOTH directions — a repair that
    // made every unreviewed design claim a phantom approval would be its own defect.
    const d = decide(uncovered());
    expect(d.covers).toBe(false);
    expect(d.basis).toMatch(/no active approved/);
    expect(d.basis).not.toMatch(/RE-REVIEW REQUIRED/);
    expect(d.supersededApproval ?? null).toBeNull();
  });

  it('an unreadable store is still its own answer, and never a stale one', () => {
    // storeUnavailable is checked BEFORE the uncovered branch and must stay that
    // way: "the store is down" may never be reported as "approved earlier".
    const d = decide(uncovered({ storeUnavailable: true, storeError: 'connection refused', supersededApproval: SUPERSEDED }));
    expect(d.covers).toBe(false);
    expect(d.basis).toMatch(/could not be read/);
    expect(d.basis).not.toMatch(/RE-REVIEW REQUIRED/);
  });
});

describe('🚨 the provenance must not reach the digested authority projection', () => {
  // `snapshot.resolutionAuthority` IS digested. `supersededApproval` is a fact about
  // the REVIEW LEDGER, not the design, and it appears only for projects that have
  // ever been approved — so leaving it in the digested bag would make one unchanged
  // design hash differently before and after an unrelated approval was recorded.
  // That is the defect class that once retired every live PE approval.
  it('is elided from the digested copy, like storeError', () => {
    const bag = { engineeringReview: uncovered({ supersededApproval: SUPERSEDED, storeError: 'boom' }) };
    const out = elideOperationalAuthority(bag as never) as unknown as
      { engineeringReview: Record<string, unknown> };
    expect(out.engineeringReview.supersededApproval).toBe(OPERATIONAL_ELIDED);
    expect(out.engineeringReview.storeError).toBe(OPERATIONAL_ELIDED);
  });

  it('and the input bag is not mutated — the real value survives for the evidence container', () => {
    const coverage = uncovered({ supersededApproval: SUPERSEDED });
    const bag = { engineeringReview: coverage };
    elideOperationalAuthority(bag as never);
    expect(coverage.supersededApproval).toEqual(SUPERSEDED);
  });

  it('🚨 an absent approval leaves NO KEY AT ALL, not a null', () => {
    // JSON.stringify({a: null}) keeps the key; {a: undefined} drops it. A null leaf
    // here would alter the serialisation of every package carrying a coverage
    // record — which is exactly how a "harmless" snapshot change has retired live
    // approvals in this repo before.
    const none = uncoveredReview('nothing on file');
    expect('supersededApproval' in none).toBe(false);
    expect(JSON.stringify(none)).not.toContain('supersededApproval');

    const some = uncoveredReview('nothing on file', { supersededApproval: SUPERSEDED });
    expect('supersededApproval' in some).toBe(true);
  });
});
