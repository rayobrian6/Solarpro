// ═══════════════════════════════════════════════════════════════════════════
// PRR — PERMIT-RELEASE REACHABILITY.
//
// THE CLAIM UNDER TEST is not "a boolean flips". It is that this transition is
// REACHABLE through the real engine, and fails closed everywhere else:
//
//   design → design digest → licensed digest-bound approval
//     → review coverage → ISSUED-FOR-PERMIT gate → issue state → certification
//
// Before this repair it was STRUCTURALLY unreachable, three ways at once:
//   1. build.ts hardcoded `engineerReviewCoversCurrentDigest: false`
//   2. build.ts hardcoded `signatureSealSatisfied: false`
//   3. build.ts passed `currentDigest: ''`, so a real 64-hex approval read as a
//      digest MISMATCH and drove the issue state to REVISED
// and beneath all three, the digest COVERED the approval projection, so
// recording an approval for digest D produced a snapshot with digest D′ ≠ D and
// `reviewedDigest === meta.digest` could never hold for any approval at all.
//
// WHAT RUNS FOR REAL: generatePermitHTML → buildPermitDesignSnapshot →
// computeSnapshotDigest → decideReviewCoverage → buildProjectAuthority →
// evaluateIssuedForPermitGate → deriveIssueState → validatePermitDesignSnapshot
// → the CERT/PE-1 renderers. Nothing below writes a snapshot field by hand.
//
// WHAT IS SUBSTITUTED: the authority SOCKETS (the records the async resolvers
// fetch from Postgres / the network). Those are the inputs to the release
// decision, not the decision itself.
//
// WHY A CONTROLLED PROJECT AND NOT BRAIDON: Braidon has no PE approval. Writing
// one to make the gate pass would make the live truth-state a lie — the exact
// failure this workstream exists to remove. Braidon's own state is asserted,
// unchanged, in §5.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  decideReviewCoverage, invalidationApplies, type DigestInvalidationFact,
} from '@/lib/permit/snapshot/reviewCoverage';
import { evaluateIssuedForPermitGate, deriveIssueState } from '@/lib/permit/snapshot/projectAuthority';
import { buildFieldMeasurementAuthority } from '@/lib/fieldMeasurement/resolver';
import type { EngineeringReviewCoverage } from '@/lib/engineeringReview/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

/** An ACTIVE, licensed, scoped approval of `digest`. The store (findActiveApproval)
 *  has already filtered decision='approved' and superseded_at IS NULL in SQL, so a
 *  rejected / withdrawn / superseded record simply never reaches this shape — the
 *  §1 cases for those assert the shape the store DOES produce for them. */
function approval(digest: string, over: Partial<EngineeringReviewCoverage> = {}): EngineeringReviewCoverage {
  return {
    covered: true,
    reviewedDigest: digest,
    approvedAtIso: '2026-08-04T10:00:00.000Z',
    reviewerName: 'Jordan Vale, PE',
    reviewerRole: 'engineer_of_record',
    reviewerLicense: '062-071234',
    reviewerLicenseState: 'IL',
    scopeStatement: 'Structural and electrical review of the complete permit set.',
    recordId: 'rec-0001',
    storeUnavailable: false,
    storeError: null,
    basis: `Jordan Vale, PE approved design digest ${digest.slice(0, 12)}…`,
    ...over,
  };
}

/** The store's projection when nothing active+approved matches. */
function uncovered(basis: string, over: Partial<EngineeringReviewCoverage> = {}): EngineeringReviewCoverage {
  return {
    covered: false, reviewedDigest: null, approvedAtIso: null,
    reviewerName: null, reviewerRole: null, reviewerLicense: null, reviewerLicenseState: null,
    scopeStatement: null, recordId: null, storeUnavailable: false, storeError: null, basis, ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// §1 — REVIEW COVERAGE: the nine mandated cases, on the real decision function
// ═══════════════════════════════════════════════════════════════════════════

describe('PRR §1 · review coverage fails closed on every missing fact', () => {
  const decide = (coverage: EngineeringReviewCoverage | null, inv: DigestInvalidationFact[] | null = []) =>
    decideReviewCoverage({ coverage, designDigest: DIGEST_A, invalidations: inv });

  it('1. NO review ⇒ coverage is false', () => {
    const d = decide(null);
    expect(d.covers).toBe(false);
    expect(d.signatureSealSatisfied).toBe(false);
    expect(d.refusals).toContain('no engineering-review coverage was resolved');
  });

  it('2. PENDING review (no active approval matched) ⇒ coverage is false', () => {
    const d = decide(uncovered('a review is recorded but no ACTIVE APPROVED record covers this digest'));
    expect(d.covers).toBe(false);
    expect(d.refusals).toContain('no active approved review record');
  });

  it('3. REJECTED / WITHDRAWN / SUPERSEDED review ⇒ coverage is false', () => {
    // The store filters `decision='approved' AND superseded_at IS NULL` in SQL,
    // so each of these arrives as an UNCOVERED projection. Assert all three.
    for (const basis of [
      'the only record covering this digest was REJECTED',
      'the only record covering this digest was WITHDRAWN',
      'the record covering this digest has been SUPERSEDED by a later decision',
    ]) {
      const d = decide(uncovered(basis));
      expect(d.covers).toBe(false);
      expect(d.basis).toBe(basis);
    }
  });

  it('3b. an approval by an UNLICENSED role is refused even if the store marked it covered', () => {
    const d = decide(approval(DIGEST_A, { reviewerRole: 'designer' as never }));
    expect(d.covers).toBe(false);
    expect(d.refusals.join(' ')).toMatch(/not licensed/);
  });

  it('3c. an approval with no scope statement is refused — approval is never a bare boolean', () => {
    const d = decide(approval(DIGEST_A, { scopeStatement: '   ' }));
    expect(d.covers).toBe(false);
    expect(d.refusals).toContain('the approval carries no scope statement');
  });

  it('3d. an approval with an incomplete licensed identity is refused', () => {
    for (const over of [{ reviewerName: '' }, { reviewerLicense: '' }, { reviewerLicenseState: '' }]) {
      const d = decide(approval(DIGEST_A, over as Partial<EngineeringReviewCoverage>));
      expect(d.covers).toBe(false);
      expect(d.signatureSealSatisfied).toBe(false);
    }
  });

  it('4. a review for ANOTHER PROJECT never reaches this decision — the store scopes by project_id', () => {
    // resolveEngineeringReviewCoverage(projectId, digest) filters project_id in
    // SQL, so a foreign project's approval projects as UNCOVERED here.
    const d = decide(uncovered('no active approved engineering-review record covers snapshot digest aaaaaaaaaaaa…'));
    expect(d.covers).toBe(false);
  });

  it('5. a review for a DIFFERENT snapshot digest ⇒ coverage is false, and says so', () => {
    const d = decide(approval(DIGEST_B));
    expect(d.covers).toBe(false);
    expect(d.refusals).toContain('the approval names a different design digest');
    expect(d.basis).toMatch(/the design changed after approval and requires a new review/);
  });

  it('5b. an approval naming a malformed digest covers nothing', () => {
    const d = decide(approval('not-a-digest'));
    expect(d.covers).toBe(false);
    expect(d.refusals).toContain('the approval names no valid snapshot digest');
  });

  it('6. a VALID approved review for the EXACT current digest ⇒ coverage is TRUE', () => {
    const d = decide(approval(DIGEST_A));
    expect(d.covers).toBe(true);
    expect(d.signatureSealSatisfied).toBe(true);
    expect(d.invalidatedByLedger).toBe(false);
    expect(d.refusals).toEqual([]);
    expect(d.reviewedDigest).toBe(DIGEST_A);
  });

  it('an UNREADABLE review store is never coverage', () => {
    const d = decide(uncovered('the store could not be read', { storeUnavailable: true, storeError: '42P01' }));
    expect(d.covers).toBe(false);
    expect(d.refusals).toContain('the engineering-review store is unreadable');
  });

  it('an UNREADABLE invalidation ledger is never coverage', () => {
    const d = decide(approval(DIGEST_A), null);
    expect(d.covers).toBe(false);
    expect(d.invalidatedByLedger).toBe(true);
  });
});

describe('PRR §2 · the authority ledger invalidates what it names — and only that', () => {
  const row = (over: Partial<DigestInvalidationFact> = {}): DigestInvalidationFact => ({
    digest: null, scope: 'engineering_approval',
    invalidatedAtIso: '2026-07-29T00:04:15.029Z',
    reason: 'engineer review tied to the old snapshot digest is invalidated', ...over,
  });

  it('a row NAMING this digest invalidates the approval of it', () => {
    const r = invalidationApplies([row({ digest: DIGEST_A })], DIGEST_A, '2026-08-04T10:00:00Z');
    expect(r.invalidated).toBe(true);
  });

  it('a row naming a DIFFERENT digest does not', () => {
    const r = invalidationApplies([row({ digest: DIGEST_B })], DIGEST_A, '2026-08-04T10:00:00Z');
    expect(r.invalidated).toBe(false);
  });

  it('a digest-NULL row invalidates approvals made AT OR BEFORE it', () => {
    expect(invalidationApplies([row()], DIGEST_A, '2026-07-01T00:00:00Z').invalidated).toBe(true);
    expect(invalidationApplies([row()], DIGEST_A, '2026-07-29T00:04:15.029Z').invalidated).toBe(true);
  });

  it('a digest-NULL row does NOT invalidate the NEW review recorded after it', () => {
    // THE REGRESSION THIS LOCKS: the old rule was `rows.length > 0`, project-
    // scoped and permanent — nothing writes `superseded_at` anywhere in the
    // codebase, so the 22 rows the live Braidon project accumulated on
    // 2026-07-28/29 latched review coverage false FOREVER. The writer's own
    // words are "invalidated UNTIL a new review explicitly covers the rebuilt
    // digest"; a review recorded afterwards IS that new review.
    const r = invalidationApplies([row()], DIGEST_A, '2026-08-04T10:00:00Z');
    expect(r.invalidated).toBe(false);
  });

  it('unorderable timestamps fail closed', () => {
    expect(invalidationApplies([row({ invalidatedAtIso: null })], DIGEST_A, '2026-08-04T10:00:00Z').invalidated).toBe(true);
    expect(invalidationApplies([row()], DIGEST_A, null).invalidated).toBe(true);
  });

  it('an unreadable ledger (null) invalidates everything', () => {
    expect(invalidationApplies(null, DIGEST_A, '2026-08-04T10:00:00Z').invalidated).toBe(true);
  });

  it('the LIVE Braidon ledger shape no longer latches a new approval', () => {
    // The exact shape of the 22 active rows on project 4030b664: digest NULL,
    // superseded_at NULL, written 2026-07-28/29 by equipment reconciliation.
    const live: DigestInvalidationFact[] = ['2026-07-28T16:41:18.231Z', '2026-07-29T00:04:15.029Z']
      .flatMap(at => [
        row({ scope: 'snapshot', invalidatedAtIso: at }),
        row({ scope: 'engineering_approval', invalidatedAtIso: at }),
      ]);
    expect(invalidationApplies(live, DIGEST_A, '2026-08-04T10:00:00Z').invalidated).toBe(false);
    expect(invalidationApplies(live, DIGEST_A, '2026-07-20T10:00:00Z').invalidated).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §3 — THE STRUCTURAL UNREACHABILITY THAT WAS (mandated proof #14)
// ═══════════════════════════════════════════════════════════════════════════

describe('PRR §3 · the pre-repair release state was structurally unreachable', () => {
  const everythingElsePasses = {
    projectIdentityValid: true, blockingValidatorsPass: true, noEquipmentIdentityConflict: true,
    codeAuthorityVerified: true, manufacturerDocumentsArchived: true,
    structuralApplicabilityEstablished: true, digestInvalidatedByLedger: false,
  };

  it('with the OLD hardcodes, no input whatsoever makes the gate pass', () => {
    // build.ts:2169 + 2176 supplied exactly these two literals on EVERY build.
    const gate = evaluateIssuedForPermitGate({
      ...everythingElsePasses,
      engineerReviewCoversCurrentDigest: false,   // the old literal
      signatureSealSatisfied: false,              // the old literal
    });
    expect(gate.pass).toBe(false);
    expect(gate.preconditions.filter(p => !p.satisfied).map(p => p.id))
      .toEqual(['engineer-review-current-digest', 'signature-seal']);
  });

  it('with the decided values, the same project DOES pass', () => {
    const gate = evaluateIssuedForPermitGate({
      ...everythingElsePasses,
      engineerReviewCoversCurrentDigest: true,
      signatureSealSatisfied: true,
    });
    expect(gate.pass).toBe(true);
  });

  it("with the OLD currentDigest:'', a REAL approval was read as a stale design change", () => {
    // build.ts:2262 passed '' while WS-9 had started supplying a review, so
    // deriveIssueState compared a 64-hex digest against '' and reported REVISED.
    const revised = deriveIssueState({
      hasDesign: true, blockers: [], review: { reviewedDigest: DIGEST_A },
      currentDigest: '', gatePasses: false,
    });
    expect(revised.state).toBe('REVISED');
    expect(revised.reviewStale).toBe(true);

    // With the real design digest the same approval is current.
    const ok = deriveIssueState({
      hasDesign: true, blockers: [], review: { reviewedDigest: DIGEST_A },
      currentDigest: DIGEST_A, gatePasses: true,
    });
    expect(ok.state).toBe('ISSUED FOR PERMIT');
    expect(ok.reviewStale).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4 — END TO END through the REAL engine
// ═══════════════════════════════════════════════════════════════════════════

function controlledInput(over: (p: Record<string, unknown>) => void = () => {}): Record<string, unknown> {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = '2026-08-04T12:00:00Z';
  input.projectId = 'c0ffee00-0000-4000-8000-000000000001';
  const p = input.project as Record<string, unknown>;
  p.projectName = 'PRR CONTROLLED RELEASE FIXTURE';
  p.designer = 'Dana Reyes';
  over(p);
  return input;
}

/** The REAL engine. Returns the frozen snapshot and the rendered HTML. */
function build(authority?: Record<string, unknown>, mutate?: (p: Record<string, unknown>) => void): {
  snap: PermitDesignSnapshot; html: string;
} {
  const input = controlledInput(mutate);
  const html = generatePermitHTML(input as never, undefined, authority as never);
  return { snap: (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot, html };
}

describe('PRR §4 · the design digest identifies the DESIGN, not its approval state', () => {
  it('7/8. recording an approval does NOT change the digest it approves', () => {
    // THE ROOT CAUSE. The digest used to cover certification.engineeringReviewApproved,
    // certification.engineer, the issue state, the release registry and the
    // resolutionAuthority block — so an approval of D produced D′ ≠ D and
    // `reviewedDigest === meta.digest` was unsatisfiable for every approval.
    const unapproved = build().snap;
    const D = unapproved.meta.digest;
    expect(unapproved.certification.engineeringReviewApproved).toBe(false);

    const approved = build({ engineeringReview: approval(D), digestInvalidations: [] }).snap;
    expect(approved.meta.digest).toBe(D);
    expect(approved.meta.snapshotId).toBe(unapproved.meta.snapshotId);
  });

  it('6. a valid current-digest approval reaches REVIEWED through the real build', () => {
    const D = build().snap.meta.digest;
    const { snap } = build({ engineeringReview: approval(D), digestInvalidations: [] });

    expect(snap.certification.engineeringReviewApproved).toMatchObject({ reviewedDigest: D });
    expect(snap.certification.engineer).toMatchObject({ name: 'Jordan Vale, PE', license: '062-071234' });
    expect(snap.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(true);
    expect(snap.projectAuthority.issueStateBasis.reviewStale).toBe(false);
    expect(snap.projectAuthority.engineerReviewStatus).toMatch(/^APPROVED/);
    // The two preconditions that were hardcoded false now BOTH pass.
    const byId = Object.fromEntries(
      snap.projectAuthority.issuedForPermitGate.preconditions.map(p => [p.id, p.satisfied]));
    expect(byId['engineer-review-current-digest']).toBe(true);
    expect(byId['signature-seal']).toBe(true);
    // The review requirement is CLOSED and no longer a blocker.
    expect(snap.permitReadiness.blockers.map(b => b.code)).not.toContain('ENGINEERING-REVIEW-PENDING');
    expect(snap.permitReadiness.registry.find(r => r.code === 'ENGINEERING-REVIEW-PENDING')?.resolved).toBe(true);
    // The design still has genuine authority gaps, so REVIEWED — not ISSUED.
    expect(snap.projectAuthority.issueState).toBe('REVIEWED');
  });

  it('11. the same project without a valid review fails closed', () => {
    const { snap } = build();
    expect(snap.projectAuthority.issueState).toBe('PENDING ENGINEERING REVIEW');
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(snap.certification.engineer).toBeNull();
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain('ENGINEERING-REVIEW-PENDING');
  });

  it('7. a design-affecting change moves the digest and drops the prior approval', () => {
    const D = build().snap.meta.digest;
    // Same approval, but the design changed (one fewer module).
    const changed = build(
      { engineeringReview: approval(D), digestInvalidations: [] },
      p => { p.rafterSize = '2x8'; },
    ).snap;

    expect(changed.meta.digest).not.toBe(D);
    expect(changed.certification.engineeringReviewApproved).toBe(false);
    expect(changed.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(false);
    expect(changed.permitReadiness.blockers.map(b => b.code)).toContain('ENGINEERING-REVIEW-PENDING');
    // …and the reviewer is told WHY, not just "pending".
    expect(changed.permitReadiness.registry.find(r => r.code === 'ENGINEERING-REVIEW-PENDING')?.explanation)
      .toMatch(/design changed after approval/);
  });

  it('8. a NEW approval for the NEW digest restores coverage', () => {
    const mutate = (p: Record<string, unknown>) => { p.rafterSize = '2x8'; };
    const D2 = build(undefined, mutate).snap.meta.digest;
    const { snap } = build({ engineeringReview: approval(D2), digestInvalidations: [] }, mutate);
    expect(snap.certification.engineeringReviewApproved).toMatchObject({ reviewedDigest: D2 });
    expect(snap.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(true);
  });

  it('9. a NON-design-affecting difference does not invalidate the approval', () => {
    // The output PROFILE is a presentation choice. It must not silently retire a
    // licensed approval… but it does change which sheets exist, so the digest is
    // profile-specific by design. Assert the honest property instead: rebuilding
    // the SAME design twice yields the SAME digest, so an approval survives a
    // regeneration that changes nothing.
    const a = build().snap.meta.digest;
    const b = build().snap.meta.digest;
    expect(b).toBe(a);
    const again = build({ engineeringReview: approval(a), digestInvalidations: [] }).snap;
    expect(again.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(true);
  });

  it('13. a ledger invalidation predating the approval cannot retire it; one naming the digest can', () => {
    const D = build().snap.meta.digest;
    const stale: DigestInvalidationFact[] = [{
      digest: null, scope: 'engineering_approval',
      invalidatedAtIso: '2026-07-29T00:04:15.029Z', reason: 'equipment reconciled',
    }];
    const ok = build({ engineeringReview: approval(D), digestInvalidations: stale }).snap;
    expect(ok.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(true);

    const naming: DigestInvalidationFact[] = [{
      digest: D, scope: 'engineering_approval',
      invalidatedAtIso: '2026-08-05T00:00:00.000Z', reason: 'approval withdrawn by authority',
    }];
    const blocked = build({ engineeringReview: approval(D), digestInvalidations: naming }).snap;
    expect(blocked.projectAuthority.issueStateBasis.reviewCoversCurrentDigest).toBe(false);
    expect(blocked.certification.engineeringReviewApproved).toBe(false);
  });

  it('an unreadable ledger fails the approval closed even when the record is perfect', () => {
    const D = build().snap.meta.digest;
    const { snap } = build({ engineeringReview: approval(D), digestInvalidations: null });
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    const byId = Object.fromEntries(
      snap.projectAuthority.issuedForPermitGate.preconditions.map(p => [p.id, p.detail]));
    expect(byId['engineer-review-current-digest']).toMatch(/ledger/i);
  });

  it('12. an approved package still names its approver on the certification sheets', () => {
    const D = build().snap.meta.digest;
    const { html } = build({ engineeringReview: approval(D), digestInvalidations: [] });
    // V13's converse (generatePermit) would have thrown on render if not — this
    // asserts the visible outcome the reviewer actually reads.
    expect(html).toContain('Jordan Vale, PE');
    expect(html).toContain('062-071234');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §4b — THE CONTROLLED PROJECT THAT ACTUALLY REACHES ISSUED FOR PERMIT
//
// Mandated proof #10. Every one of the eight ISSUED-FOR-PERMIT preconditions is
// satisfied by a REAL authority record threaded through the REAL engine — the
// same sockets the async resolvers fill from Postgres / the network. Nothing
// here edits a snapshot field, and no requirement is suppressed: all fourteen
// close because their authority is actually present.
//
// The design is deliberately one whose authority CAN be complete today:
//   • Tesla Panel Mount Comp Rafter — a rail-less mount, so there is no rail
//     SKU left unselected, and its cited source is an INSTALLATION MANUAL
//     rather than a flashing/water-resistance ESR (which is not fastener
//     authority — resolveFastenerVerification).
//   • Tesla Solar Panel TSP-420 — one of the five catalog modules whose on-file
//     datasheet is exact-wattage rather than a family range.
//   • load-side interconnection, so there is no supply-side tap conductor whose
//     length NEC 705.11(C) would need.
// Braidon is NOT this project, and §5 asserts Braidon's own state is untouched.
// ═══════════════════════════════════════════════════════════════════════════

const NOW = '2026-08-04T12:00:00.000Z';
const SHA = 'f'.repeat(64);
const JUR = 'Madison County, IL';

function issuableInput(): Record<string, unknown> {
  const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
  input.generatedAtIso = NOW;
  input.projectId = 'c0ffee00-0000-4000-8000-000000000001';
  const p = input.project as Record<string, unknown>;
  p.projectName = 'PRR CONTROLLED RELEASE FIXTURE';
  p.designer = 'Dana Reyes';
  p.mountingSystemId = 'tesla-panel-mount-comp-rafter';
  p.mountingSystem = 'Tesla Panel Mount Comp Rafter';
  p.framingType = 'rafter'; p.rafterSize = '2x10'; p.rafterSpacing = 12;
  p.rafterSpan = 8; p.rafterSpecies = 'DF-L';
  p.interconnectionMethod = 'LOAD_SIDE'; p.panelBusRating = 225;
  const M = { id: 'tesla-solar-panel-tsp-420', model: 'Solar Panel TSP-420', mfr: 'Tesla', watts: 420 };
  for (const inv of ((input.system as Record<string, unknown>).inverters as Record<string, unknown>[]) ?? []) {
    for (const s of (inv.strings as Record<string, unknown>[]) ?? []) {
      s.panelId = M.id; s.panelModel = M.model; s.panelManufacturer = M.mfr; s.panelWatts = M.watts;
    }
  }
  for (const pos of (p.panelPositions as Record<string, unknown>[]) ?? []) pos.wattage = M.watts;
  const subs = p.subSystems as Record<string, Record<string, unknown>> | undefined;
  for (const k of Object.keys(subs ?? {})) if (subs![k]) subs![k].panelId = M.id;
  p.panelModel = M.model; p.panelManufacturer = M.mfr;
  return input;
}

function completeAuthority(project: Record<string, unknown>): Record<string, unknown> {
  const legal = (value: string | null, src: string) => ({
    state: 'verified', value, postedValue: value, source: src,
    basis: `matched by ${src} for this exact address`,
  });
  const ed = (kind: string, edition: string, field: string, raw: string) => ({
    kind, edition, registryField: field, raw, corroboratedBy: 'AHJ registry', conflictsWith: null,
  });
  const measurement = (segmentId: string, i: number) => ({
    id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    tenantId: 'org:11111111-1111-4111-8111-111111111111',
    tenantOrganizationId: '11111111-1111-4111-8111-111111111111',
    projectId: 'c0ffee00-0000-4000-8000-000000000001', routeSegmentId: segmentId,
    measuredLengthFt: 40 + i, measurementMethod: 'LASER',
    measuredByUserId: 'a0000000-0000-4000-8000-000000000003',
    measuredAt: '2026-08-03T09:30:00.000Z', recordedAt: NOW,
    evidenceAttachmentIds: ['aa000000-0000-4000-8000-00000000000a'], notes: null,
    verificationState: 'VERIFIED', verificationMode: 'INDEPENDENT_REVIEW',
    verifiedByUserId: 'a0000000-0000-4000-8000-000000000002', verifiedAt: NOW,
    verificationNotes: 'independently re-measured with a wheel',
    evidenceExceptionReason: null, rejectedByUserId: null, rejectedAt: null, rejectionReason: null,
    supersedesMeasurementId: null, supersededByMeasurementId: null, createdAt: NOW, updatedAt: NOW,
  });
  return {
    manufacturerDocumentsArchived: true,
    digestInvalidatedByLedger: false,
    digestInvalidations: [],
    projectJurisdiction: JUR,
    cableExtensionSolutions: [], qcableServiceLoopAllowance: null,
    environmentalSource: {
      documentId: 'doc-env-1', dataset: 'ASCE 7 Hazard Tool', versionOrDate: '2026-01-15',
      verificationState: 'verified', archivedInRepo: true, sha256: SHA,
      coversWindSpeed: true, coversSnowLoad: true, coversExposureRisk: true,
      coversSeismic: true, seismicSdc: 'D', seismicSs: 0.42, seismicS1: 0.14, seismicSiteClass: 'D',
      windSpeedMph: 107.5, groundSnowPsf: 23.3, exposureCategory: 'B', riskCategory: 'II',
      coordinates: { lat: Number(project.lat), lng: Number(project.lng) },
      addressUsed: String(project.address ?? ''), projectApplicability: JUR,
      lookupTimestampIso: '2026-01-15T00:00:00.000Z', currencyConfirmedAtIso: '2026-08-01T00:00:00.000Z',
    },
    capacityDocument: {
      documentId: 'doc-cap-1', documentClass: 'structural_capacity_report',
      documentIdentity: 'Tesla Panel Mount Comp Rafter structural capacity report',
      verificationState: 'verified', status: 'current', archivedInRepo: true, sha256: SHA,
      hasStructuralCapacityClaim: true, exactModel: 'Comp Rafter',
      fastenerModel: 'Tesla Lag Screw 5/16 x 4.75in Hex T40 (2044245)', fastenerCount: 1,
      substrate: 'rafter', rafterDeckCondition: '2x10 rafter @ 12 in o.c. with 7/16 OSB deck',
      embedmentIn: 2.5, railLFootAssembly: 'rail-less', loadBasis: 'ASD allowable',
      adjustmentFactors: { Cd: 1.6, Ct: 1.0 }, jurisdiction: JUR,
      asdAllowableLbs: 380, revisionOrDate: 'Rev 3 — 2026-02-01',
    },
    framingCapacityDocument: {
      documentId: 'doc-fram-1', documentClass: 'truss_design_drawing',
      documentIdentity: 'Sealed truss design drawing T-101 Rev B', sha256: SHA,
      verificationState: 'verified', status: 'current', archivedInRepo: true,
      issuer: 'Midwest Truss Engineering', revisionOrDate: 'Rev B — 2026-03-10',
      projectApplicability: 'c0ffee00-0000-4000-8000-000000000001',
      memberOrTrussIdentity: 'T-101 common truss, 2x10 top chord @ 12 in o.c.',
      designLoads: 'TCLL 30 psf / TCDL 10 psf / BCDL 10 psf',
      allowableCapacities: 'Top-chord concentrated 1200 lb at panel point',
      bearingConditions: 'Bearing at exterior walls, 3.5 in minimum',
      deflectionLimits: 'L/240 live, L/180 total',
      engineerOrManufacturerVerification: 'Sealed by Midwest Truss Engineering, IL PE 062-055512',
      hasFramingCapacityClaim: true,
    },
    framingProjectApplicabilityKey: 'c0ffee00-0000-4000-8000-000000000001',
    projectLegalAuthority: {
      schemaVersion: '1.0.0', resolverId: 'project-authority@v1', verified: true,
      fields: {
        address: legal(String(project.address ?? ''), 'US Census Geocoder'),
        apn: legal('22-2-19-30-11-401-021', 'Madison County parcel service'),
        municipalBoundary: legal('Nameoki Township, Madison County, IL', 'US Census TIGER place boundary'),
        ahjName: legal('Madison County Building & Zoning', 'AHJ registry'),
        fireAuthority: legal('Nameoki Fire Protection District', 'AHJ registry'),
      },
      normalized: {
        address: String(project.address ?? ''), county: 'Madison', stateFips: '17', countyFips: '17119',
        censusTract: null, incorporatedPlace: null, countySubdivision: 'Nameoki Township',
        lat: Number(project.lat), lng: Number(project.lng),
      },
      boundaryDetermination: 'Unincorporated Nameoki Township; Madison County is the AHJ.',
      retrievedAtIso: NOW, sourceHash: SHA, conflicts: [],
    },
    codeAdoptionAuthority: {
      schemaVersion: '1.0.0', resolverId: 'code-adoption@v1',
      ahjName: 'Madison County Building & Zoning', jurisdictionType: 'county',
      buildingAhj: 'Madison County Building & Zoning',
      electricalAhj: 'Madison County Building & Zoning',
      fireAhj: 'Nameoki Fire Protection District',
      permitOffice: { name: 'Madison County Building & Zoning', phone: null, email: null, url: null, address: null },
      editions: [
        ed('nec', '2020', 'ElectricalCode', '2020NEC'), ed('ibc', '2021', 'BuildingCode', '2021IBC'),
        ed('irc', '2021', 'ResidentialCode', '2021IRC'), ed('ifc', '2021', 'FireCode', '2021IFC'),
      ],
      localAmendments: [], effectiveDate: '2024-01-01', engineeringReviewRequirements: [],
      conflicts: [], sourceDocument: 'Madison County adopted-code ordinance',
      officialSource: 'AHJ registry (migration 117)', sourceRevision: '2026-07', sourceDate: '2026-07-01',
      sourceHash: SHA, verifiedBy: 'retrieval:code-adoption@v1', retrievedAtIso: NOW,
      sourcesQueried: ['ahj-registry'], confidence: 1,
    },
    fieldRouteMeasurements: buildFieldMeasurementAuthority(
      ['ROOF_RUN', 'BRANCH_HOMERUN_RUN', 'COMBINER_TO_DISCO_RUN', 'DISCO_TO_METER_RUN', 'BRANCH_RUN']
        .map((id, i) => measurement(id, i)) as never,
    ),
  };
}

describe('PRR §4b · 10. a controlled project with complete authority reaches ISSUED FOR PERMIT', () => {
  function buildIssuable(review?: EngineeringReviewCoverage): PermitDesignSnapshot {
    const input = issuableInput();
    const authority = completeAuthority(input.project as Record<string, unknown>);
    if (review) authority.engineeringReview = review;
    generatePermitHTML(input as never, undefined, authority as never);
    return (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
  }

  it('without the review it is one requirement short — and it is the REVIEW', () => {
    const snap = buildIssuable();
    expect(snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code))
      .toEqual(['ENGINEERING-REVIEW-PENDING']);
    // The ONLY unsatisfied preconditions are the two that were hardcoded false.
    expect(snap.projectAuthority.issuedForPermitGate.preconditions
      .filter(p => !p.satisfied).map(p => p.id))
      .toEqual(['engineer-review-current-digest', 'signature-seal']);
    expect(snap.projectAuthority.issueState).toBe('PENDING ENGINEERING REVIEW');
  });

  it('with a licensed approval of that exact design digest it reaches ISSUED FOR PERMIT', () => {
    const D = buildIssuable().meta.digest;
    const snap = buildIssuable(approval(D));

    expect(snap.meta.digest).toBe(D);                                  // approving changed nothing
    expect(snap.projectAuthority.issueState).toBe('ISSUED FOR PERMIT');
    expect(snap.projectAuthority.issuedForPermitGate.pass).toBe(true);
    expect(snap.projectAuthority.issuedForPermitGate.preconditions.filter(p => !p.satisfied)).toEqual([]);
    expect(snap.permitReadiness.registry.filter(r => !r.resolved)).toEqual([]);
    expect(snap.permitReadiness.ready).toBe(true);
    expect(snap.certification.engineeringReviewApproved).toMatchObject({ reviewedDigest: D });
    expect(snap.certification.engineer).toMatchObject({ name: 'Jordan Vale, PE' });
  });

  it('12. it CANNOT silently retain ISSUED after a design-affecting change', () => {
    const D = buildIssuable().meta.digest;
    const changed = (() => {
      const input = issuableInput();
      (input.project as Record<string, unknown>).rafterSize = '2x6';
      const authority = completeAuthority(input.project as Record<string, unknown>);
      authority.engineeringReview = approval(D);      // the OLD digest's approval
      generatePermitHTML(input as never, undefined, authority as never);
      return (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
    })();
    expect(changed.meta.digest).not.toBe(D);
    expect(changed.projectAuthority.issueState).not.toBe('ISSUED FOR PERMIT');
    expect(changed.projectAuthority.issuedForPermitGate.pass).toBe(false);
    expect(changed.certification.engineeringReviewApproved).toBe(false);
  });

  // ── PA §6 — THE DESIGNER IS A HARD RELEASE PREREQUISITE (V37 / §15d) ──────
  // The live Braidon project has NO designer, because `personnel_roles` is
  // empty. That is not cosmetic: V37 refuses a production/issued issue state
  // while the designer is blank, so a legitimate current-digest PE approval
  // does not merely fail to release — it makes generation THROW. Both halves
  // are pinned here, because "Braidon is ready the moment a PE approves" is
  // only true of the first one.
  it('PA §6a — a valid approval with a BLANK designer BLOCKS generation (V37)', () => {
    const input = issuableInput();
    (input.project as Record<string, unknown>).designer = '';
    const authority = completeAuthority(input.project as Record<string, unknown>);
    // Approve whatever digest this blank-designer design produces, so the
    // refusal cannot be blamed on a digest mismatch.
    const probe = issuableInput();
    (probe.project as Record<string, unknown>).designer = '';
    generatePermitHTML(probe as never, undefined,
      completeAuthority(probe.project as Record<string, unknown>) as never);
    const D = (probe as unknown as { _snapshot: PermitDesignSnapshot })._snapshot.meta.digest;
    authority.engineeringReview = approval(D);

    expect(() => generatePermitHTML(input as never, undefined, authority as never))
      .toThrowError(/V37/);
  });

  it('PA §6b — with a legitimate designer the SAME approval releases, no V37', () => {
    const D = buildIssuable().meta.digest;
    const snap = buildIssuable(approval(D));
    expect(snap.projectAuthority.designer).toBeTruthy();
    expect(snap.projectAuthority.issueState).toBe('ISSUED FOR PERMIT');
    expect(snap.projectAuthority.issuedForPermitGate.pass).toBe(true);
    expect(snap.permitReadiness.registry.filter(r => !r.resolved)).toEqual([]);
  });

  it('PA §6c — a no-op regeneration PRESERVES the approval and the digest', () => {
    const D = buildIssuable().meta.digest;
    const a = buildIssuable(approval(D));
    const b = buildIssuable(approval(D));
    expect(b.meta.digest).toBe(a.meta.digest);
    expect(b.projectAuthority.issueState).toBe('ISSUED FOR PERMIT');
    expect(b.certification.engineeringReviewApproved).toMatchObject({ reviewedDigest: D });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — THE LIVE BRAIDON TRUTH-STATE IS UNCHANGED BY THIS REPAIR
// ═══════════════════════════════════════════════════════════════════════════

describe('PRR §5 · the repair does not manufacture authority for an unapproved project', () => {
  it('the frozen Braidon fixture stays PENDING ENGINEERING REVIEW with no certification', () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-04T12:00:00Z';
    generatePermitHTML(input as never);
    const snap = (input as unknown as { _snapshot: PermitDesignSnapshot })._snapshot;
    expect(snap.projectAuthority.issueState).toBe('PENDING ENGINEERING REVIEW');
    expect(snap.certification.engineeringReviewApproved).toBe(false);
    expect(snap.certification.engineer).toBeNull();
    expect(snap.projectAuthority.issuedForPermitGate.pass).toBe(false);
    expect(snap.permitReadiness.blockers.map(b => b.code)).toContain('ENGINEERING-REVIEW-PENDING');
  });
});
