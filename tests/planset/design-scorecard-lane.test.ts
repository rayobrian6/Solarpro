// ═══════════════════════════════════════════════════════════════════════════
// THE DESIGN SCORECARD (2026-08-29) — Ray's ruling:
//
//   "If the remaining are ones that we can never truly fix, like the PE stamp,
//    remove them. That is no qualifier for us. Our objective is to get this
//    ready to be stamped."
//
// An unstamped engineering set is the TERMINAL state of a correct workflow — it
// IS the product. Counting the engineer-of-record's signature among OUR
// unresolved requirements said the package was deficient when it was finished,
// and it made "2 requirements outstanding" mean the same thing whether we still
// owed real work or owed nothing at all.
//
// So the count SolarPro is judged on is the DESIGN lane. The professional lane
// is reported, and named as the next step, but never counted against the design.
//
// NOTHING IS DELETED, and these tests exist mostly to prove that. The
// professional requirements stay in the registry, stay on RS-1, keep their gates
// OPEN, and keep `readyForPermitSubmission` false — ENGINEERING-REVIEW-PENDING
// is precisely what stops an unsealed set from printing ISSUED FOR PERMIT.
// Removing it to make a number look better would have been the one change that
// could put an unstamped drawing in front of a building department.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  projectReleaseGates, releasePackageLine, releaseHeadline, requirementLane,
} from '@/lib/permit/snapshot/releaseGates';
import { deriveReleasePhase, submissionLine } from '@/lib/permit/snapshot/releasePhase';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

type Row = { code: string; severity: 'blocking' | 'warning' };
const b = (code: string): Row => ({ code, severity: 'blocking' });
const RAIL: Row = { code: 'PENDING-RACKING-ASSEMBLY-SELECTION', severity: 'warning' };

/** A snapshot carrying exactly these registry rows, through the REAL model. */
const modelOf = (rows: Row[]) => projectReleaseGates({
  derived: { moduleCount: 31 },
  permitReadiness: {
    ready: rows.every(r => r.severity === 'warning'),
    blockers: rows.filter(r => r.severity === 'blocking').map(r => ({ code: r.code, message: 'x' })),
    registry: rows.map(r => ({
      code: r.code, severity: r.severity, resolved: false,
      explanation: 'x', affectedSheets: ['PV-3'],
    })),
  },
  meta: { snapshotId: 'S', digest: 'd'.repeat(64) },
} as unknown as PermitDesignSnapshot);

const phaseOf = (m: ReturnType<typeof modelOf>) => deriveReleasePhase({
  model: m,
  reviewCoversCurrentDigest: false,
  gatePasses: m.issueStatePredicates.readyForPermitSubmission,
  hasDesign: true,
});

// The state Ray's package lands in once a designer and an exposure category are
// stated: everything left is a licensed professional's.
const PE_ONLY = [b('FRAMING-AUTHORITY-UNVERIFIED'), b('ENGINEERING-REVIEW-PENDING'), RAIL];

describe('a PE-only package reads as FINISHED, not deficient', () => {
  it('DESIGN COMPLETE with zero open design requirements', () => {
    const m = modelOf(PE_ONLY);
    expect(m.summary.designComplete).toBe(true);
    expect(m.summary.designRequirementCount).toBe(0);
    expect(m.summary.openDesignGateCount).toBe(0);
    expect(m.summary.professionalRequirementCount).toBe(2);
  });

  it('the drawing line states the achievement and names the next step', () => {
    const line = releasePackageLine(modelOf(PE_ONLY).summary);
    expect(line).toMatch(/DESIGN COMPLETE — 0 OPEN DESIGN REQUIREMENTS/);
    expect(line).toMatch(/READY FOR ENGINEER-OF-RECORD REVIEW AND SEAL/);
    // and it no longer calls the signature one of our unresolved requirements
    expect(line).not.toMatch(/\d+ UNRESOLVED DESIGN REQUIREMENT/);
  });

  it('the phase is a WORKFLOW state, amber, not a defect', () => {
    const p = phaseOf(modelOf(PE_ONLY));
    expect(p.id).toBe('AWAITING_PROFESSIONAL_REVIEW');
    expect(p.kind).toBe('workflow');
    expect(p.label).toBe('DESIGN COMPLETE — READY FOR PROFESSIONAL REVIEW');
    expect(p.designRequirementCodes).toEqual([]);
  });
});

describe('nothing was deleted to get there', () => {
  it('the requirements are still open, still counted, still on the gates', () => {
    const m = modelOf(PE_ONLY);
    expect(m.summary.unresolvedRequirementCount).toBe(2);
    expect(m.summary.openGateCount).toBeGreaterThan(0);
    expect(m.requirements.filter(q => q.status === 'OPEN' && q.findingType !== 'ADVISORY')
      .map(q => q.requirementCode).sort())
      .toEqual(['ENGINEERING-REVIEW-PENDING', 'FRAMING-AUTHORITY-UNVERIFIED']);
  });

  it('RS-1 keeps the FULL account — it is the record, not the scorecard', () => {
    const h = releaseHeadline(modelOf(PE_ONLY).summary);
    expect(h).toMatch(/2 UNRESOLVED REQUIREMENTS/);
    expect(h).toMatch(/\(0 DESIGN \/ 2 ENGINEER OF RECORD\)/);
    expect(h).toMatch(/DESIGN COMPLETE/);
  });

  it('THE SAFETY PROPERTY: an unsealed set can still never claim permit submission', () => {
    const m = modelOf(PE_ONLY);
    expect(m.summary.permitReady).toBe(false);
    expect(m.issueStatePredicates.readyForPermitSubmission).toBe(false);
    const p = phaseOf(m);
    expect(p.submittable).toBe(false);
    expect(submissionLine(p)).toMatch(/NOT FOR PERMIT SUBMISSION/);
  });
});

describe('the split is not a way out of real work', () => {
  it('one open DESIGN requirement and the package is INCOMPLETE again', () => {
    const m = modelOf([b('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'), ...PE_ONLY]);
    expect(m.summary.designComplete).toBe(false);
    expect(m.summary.designRequirementCount).toBe(1);
    const line = releasePackageLine(m.summary);
    expect(line).toMatch(/1 UNRESOLVED DESIGN REQUIREMENT/);
    expect(line).not.toMatch(/DESIGN COMPLETE/);
    expect(phaseOf(m).kind).toBe('defect');
  });

  it("Ray's live registry: 2 of the 4 were ours, and they are the 2 that count", () => {
    // The exact live set decoded from the sheet: RG-3 environmental, RG-4
    // framing, RG-7 designer, RG-7 engineering review, + the rail advisory.
    const m = modelOf([
      b('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED'), b('FRAMING-AUTHORITY-UNVERIFIED'),
      b('DESIGNER-OF-RECORD-MISSING'), b('ENGINEERING-REVIEW-PENDING'), RAIL,
    ]);
    expect(m.summary.unresolvedRequirementCount).toBe(4);   // unchanged total
    expect(m.summary.designRequirementCount).toBe(2);       // what we owe
    expect(m.summary.professionalRequirementCount).toBe(2); // what the PE owes
    expect(releasePackageLine(m.summary)).toMatch(/2 UNRESOLVED DESIGN REQUIREMENTS/);
  });

  it('the lane is read from the DECLARATION and fails closed to DESIGN', () => {
    // An undeclared code is a design requirement: calling an unknown gap
    // "awaiting a signature" would understate it.
    expect(requirementLane('ENGINEERING-REVIEW-PENDING')).toBe('professional');
    expect(requirementLane('FRAMING-AUTHORITY-UNVERIFIED')).toBe('professional');
    expect(requirementLane('ENVIRONMENTAL-LOAD-AUTHORITY-UNVERIFIED')).toBe('design');
    expect(requirementLane('DESIGNER-OF-RECORD-MISSING')).toBe('design');
    expect(requirementLane('SOME-CODE-THAT-DOES-NOT-EXIST')).toBe('design');
  });
});
