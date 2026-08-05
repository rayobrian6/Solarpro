// ═══════════════════════════════════════════════════════════════════════════
// D4 — THE LEGAL AHJ, NOT THE MAILING CITY, STAMPS A DOCUMENT.
//
// THE LIFECYCLE THAT PRODUCED THE DEFECT
//   project-authority-key@v1   AUTO_DERIVED, runs FIRST
//     → authority.projectJurisdiction := compliance.jurisdiction.ahj
//                                     ?? project.ahjName ?? project.state
//     → on live Braidon that is "City of Granite City Building & Zoning"
//   project-authority@v1       AUTO_RETRIEVED, runs later
//     → determines the real legal AHJ from the parcel boundary (Madison County,
//       unincorporated) and corrects project.ahjName / project.ahjRecordId
//     → but patched ONLY projectLegalAuthority; projectJurisdiction stayed frozen
//   racking-documents@v1
//     → stamped jurisdictionBoundary from projectJurisdiction
//     → all four live registry rows carry the MAILING city
//
// The live lifecycle stabilises in ONE iteration, so nothing ever corrected it.
// And a second pass could not have: the document id is content-derived, so the
// re-run finds the existing row and leaves its jurisdiction untouched.
//
// The repair therefore had to prevent the FIRST wrong write, not repair it after.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  evaluateRackingCapacityClearance,
  normalizeJurisdictionName,
  type RackingCapacityDocumentEvidence,
} from '@/lib/permit/snapshot/rackingAssembly';
import { defaultAuthorityBundle } from '@/lib/permit/snapshot/resolution/lifecycle';

const MADISON = 'il-madison-county';
const GRANITE = 'il-madison-granite-city';

function evidence(over: Partial<RackingCapacityDocumentEvidence> = {}): RackingCapacityDocumentEvidence {
  return {
    documentId: 'doc-x', documentClass: 'structural_pe_letter',
    documentIdentity: 'RT-MINI structural analysis', verificationState: 'verified',
    status: 'current', archivedInRepo: true, sha256: 'a'.repeat(64),
    hasStructuralCapacityClaim: true,
    exactModel: 'RT-MINI', fastenerModel: '5/16" screw', fastenerCount: 2,
    substrate: 'asphalt_shingle', rafterDeckCondition: '15/32" sheathing over 2x4 DF-L #2',
    embedmentIn: 2.5, railLFootAssembly: 'XR100', loadBasis: 'ASD allowable',
    adjustmentFactors: { safetyFactor: 3.0 },
    jurisdiction: 'Madison County Building & Zoning',
    jurisdictionAuthorityId: MADISON,
    asdAllowableLbs: 613.2, revisionOrDate: 'ASCE 7-16',
    ...over,
  };
}
const ctx = (over: Record<string, unknown> = {}) => ({
  mountModel: 'RT-MINI', requiredSubstrate: 'asphalt_shingle', requiredRail: 'XR100',
  projectJurisdiction: 'Madison County Building & Zoning',
  projectJurisdictionAuthorityId: MADISON,
  ...over,
});

describe('D4 · the authority bundle carries a legal jurisdiction', () => {
  it('the default bundle seeds it NULL — the blocker-firing state', () => {
    const b = defaultAuthorityBundle();
    expect('legalJurisdiction' in b).toBe(true);
    expect(b.legalJurisdiction).toBeNull();
  });

  it('projectJurisdiction is retained but documented as posted-derived', () => {
    // It still exists for consumers that legitimately want the project record's
    // own answer. What must never happen again is a DOCUMENT being stamped from it.
    const b = defaultAuthorityBundle();
    expect('projectJurisdiction' in b).toBe(true);
  });
});

describe('D4 · stable identity governs applicability', () => {
  it('matching AHJ record ids clear the jurisdiction condition', () => {
    const r = evaluateRackingCapacityClearance(ctx(), evidence());
    expect(r.missing).not.toContain('jurisdiction');
  });

  it('MAILING-CITY AHJ id fails against the county project id', () => {
    // This is the exact live situation: the row is stamped Granite City, the
    // project's legal AHJ is Madison County.
    const r = evaluateRackingCapacityClearance(
      ctx(), evidence({ jurisdictionAuthorityId: GRANITE, jurisdiction: 'City of Granite City Building & Zoning' }));
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('jurisdiction');
    expect(r.reasons.join(' ')).toMatch(/bound to legal AHJ 'il-madison-granite-city'/);
  });

  it('the id comparison BEATS a coincidentally-matching name', () => {
    // Same display text, different authority. Identity must win.
    const r = evaluateRackingCapacityClearance(
      ctx({ projectJurisdictionAuthorityId: MADISON }),
      evidence({ jurisdictionAuthorityId: GRANITE, jurisdiction: 'Madison County Building & Zoning' }));
    expect(r.missing).toContain('jurisdiction');
  });
});

describe('D4 · the name fallback is normalized and fail-closed', () => {
  it('an ampersand no longer defeats the comparison', () => {
    // Pre-119 rows carry no stable id, so the name path is used. It must not be
    // decided by punctuation.
    const r = evaluateRackingCapacityClearance(
      ctx({ projectJurisdictionAuthorityId: null, projectJurisdiction: 'Madison County Building and Zoning' }),
      evidence({ jurisdictionAuthorityId: null, jurisdiction: 'Madison County Building & Zoning' }));
    expect(r.missing).not.toContain('jurisdiction');
  });

  it('normalizeJurisdictionName folds case, spacing, punctuation and & / and', () => {
    const a = normalizeJurisdictionName('Madison County Building & Zoning');
    expect(normalizeJurisdictionName('  madison county building  and zoning ')).toBe(a);
    expect(normalizeJurisdictionName('Madison County Building, & Zoning.')).toBe(a);
    expect(normalizeJurisdictionName('City of Granite City Building & Zoning')).not.toBe(a);
  });

  it('a genuinely different jurisdiction still fails on the name path', () => {
    const r = evaluateRackingCapacityClearance(
      ctx({ projectJurisdictionAuthorityId: null }),
      evidence({ jurisdictionAuthorityId: null, jurisdiction: 'City of Granite City Building & Zoning' }));
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('jurisdiction');
    expect(r.reasons.join(' ')).toMatch(/City of Granite City/);
    // NEITHER side carries an id, so name comparison is simply the pre-119 path
    // and needs no caveat. The caveat is reserved for the one-sided case below,
    // where a stable identity exists but could not be used.
    expect(r.reasons.join(' ')).not.toMatch(/one side carries no stable AHJ identity/);
  });

  it('no jurisdiction on the document at all fails closed', () => {
    const r = evaluateRackingCapacityClearance(
      ctx({ projectJurisdictionAuthorityId: null }),
      evidence({ jurisdictionAuthorityId: null, jurisdiction: null }));
    expect(r.missing).toContain('jurisdiction');
  });

  it('a one-sided stable id says so, rather than silently comparing prose', () => {
    const r = evaluateRackingCapacityClearance(
      ctx({ projectJurisdictionAuthorityId: MADISON }),
      evidence({ jurisdictionAuthorityId: null, jurisdiction: 'City of Granite City Building & Zoning' }));
    expect(r.reasons.join(' ')).toMatch(/one side carries no stable AHJ identity/);
  });
});

describe('D4 · authenticity is still not applicability', () => {
  it('a correct jurisdiction does NOT clear a wrong product', () => {
    const r = evaluateRackingCapacityClearance(ctx(), evidence({ exactModel: 'RT-MINI II' }));
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('exact_model');
    // …and the jurisdiction condition passed, proving the two are independent.
    expect(r.missing).not.toContain('jurisdiction');
  });
});
