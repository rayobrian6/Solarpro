import { describe, it, expect } from 'vitest';
import {
  pickVerifiedDocument,
  toRackingClearanceEvidence,
  validateDocumentInput,
  type DocumentInput,
} from '@/lib/documents/registry';
import type { RegistryDocument } from '@/lib/documents/types';

const SHA = 'a'.repeat(64);

function doc(over: Partial<RegistryDocument>): RegistryDocument {
  return {
    id: over.id ?? 'd1',
    documentClass: over.documentClass ?? 'structural_pe_letter',
    manufacturerOrIssuer: 'Roof Tech',
    equipmentId: 'rooftech-mini',
    equipmentModelApplicability: 'RT-MINI',
    title: 'RT-MINI II PE letter',
    revision: 'A', documentDate: '2026-01',
    archivedFileIdentity: 'docs/rtmini.pdf',
    archivedInRepo: true, sha256: SHA,
    source: null, jurisdictionBoundary: 'Kentucky',
    applicabilityNotes: null,
    status: 'current', supersedesId: null, supersededById: null,
    extractedClaims: {
      structural: {
        exactModel: 'RT-MINI', fastenerModel: '5/16 screw', fastenerCount: 2,
        substrate: '15/32 sheathing, 2x4 DF-L #2', rafterDeckCondition: 'sound rafter',
        embedmentIn: 2.5, railLFootAssembly: 'IronRidge XR100 compatible rail',
        loadBasis: 'ASD allowable', adjustmentFactors: { omega: 1.5 },
        jurisdiction: 'Kentucky', asdAllowableLbs: 600, hasStructuralCapacityClaim: true,
      },
    },
    verificationState: 'verified', reviewer: 'r', verifiedBy: 'u', verifiedAt: '2026-01-02',
    verificationNotes: null, createdBy: 'u', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
    ...over,
  };
}

describe('W4 §8 — findVerifiedDocument resolver (verified-exact-match only)', () => {
  const criteria = { documentClass: ['structural_pe_letter', 'evaluation_report'] as any, equipmentId: 'rooftech-mini', requireStructuralCapacity: true };

  it('returns a verified, current, archived, exact-equipment structural doc', () => {
    expect(pickVerifiedDocument([doc({})], criteria)?.id).toBe('d1');
  });

  it('refuses an UNVERIFIED document', () => {
    expect(pickVerifiedDocument([doc({ verificationState: 'in_review' })], criteria)).toBeNull();
  });

  it('refuses a SUPERSEDED document', () => {
    expect(pickVerifiedDocument([doc({ status: 'superseded' })], criteria)).toBeNull();
  });

  it('refuses a non-archived document (no sha256)', () => {
    expect(pickVerifiedDocument([doc({ archivedInRepo: false, sha256: null })], criteria)).toBeNull();
  });

  it('refuses a document for a DIFFERENT equipment', () => {
    expect(pickVerifiedDocument([doc({ equipmentId: 'ironridge-flush', equipmentModelApplicability: 'XR100' })], criteria)).toBeNull();
  });

  it('refuses a doc missing a structural capacity claim when structural required', () => {
    const flashing = doc({ extractedClaims: { structural: { hasStructuralCapacityClaim: false } } });
    expect(pickVerifiedDocument([flashing], criteria)).toBeNull();
  });

  it('honours a jurisdiction filter', () => {
    expect(pickVerifiedDocument([doc({})], { ...criteria, jurisdiction: 'Illinois' })).toBeNull();
    expect(pickVerifiedDocument([doc({})], { ...criteria, jurisdiction: 'Kentucky' })?.id).toBe('d1');
  });

  it('newest genuine match wins (timestamp only breaks ties among valid matches)', () => {
    const a = doc({ id: 'old', createdAt: '2025-01-01T00:00:00Z' });
    const b = doc({ id: 'new', createdAt: '2026-06-01T00:00:00Z' });
    expect(pickVerifiedDocument([a, b], criteria)?.id).toBe('new');
    // but a newer INVALID doc never overrides an older valid one
    const invalidNew = doc({ id: 'newbad', createdAt: '2027-01-01T00:00:00Z', verificationState: 'in_review' });
    expect(pickVerifiedDocument([a, invalidNew], criteria)?.id).toBe('old');
  });
});

describe('W4 §8 — validateDocumentInput', () => {
  const base: DocumentInput = { documentClass: 'structural_pe_letter', manufacturerOrIssuer: 'Roof Tech', title: 't' };
  it('accepts a minimal draft', () => expect(validateDocumentInput(base).ok).toBe(true));
  it('rejects an unknown class', () => expect(validateDocumentInput({ ...base, documentClass: 'brochure' }).ok).toBe(false));
  it('rejects archived without sha256', () => expect(validateDocumentInput({ ...base, archivedInRepo: true }).ok).toBe(false));
  it('rejects verifying an un-archived doc', () => expect(validateDocumentInput({ ...base, verificationState: 'verified' }).ok).toBe(false));
  it('accepts verified when archived+hashed', () => expect(validateDocumentInput({ ...base, archivedInRepo: true, sha256: SHA, verificationState: 'verified' }).ok).toBe(true));
});

describe('W4 §8 — toRackingClearanceEvidence', () => {
  it('maps structural claims onto clearance evidence', () => {
    const ev = toRackingClearanceEvidence(doc({}))!;
    expect(ev.hasStructuralCapacityClaim).toBe(true);
    expect(ev.asdAllowableLbs).toBe(600);
    expect(ev.fastenerCount).toBe(2);
    expect(ev.jurisdiction).toBe('Kentucky');
    expect(ev.sha256).toBe(SHA);
  });
  it('a doc with no structural claim maps hasStructuralCapacityClaim=false', () => {
    const ev = toRackingClearanceEvidence(doc({ extractedClaims: { values: {} } }))!;
    expect(ev.hasStructuralCapacityClaim).toBe(false);
  });
});
