import { describe, it, expect } from 'vitest';
import {
  buildRackingAssembly,
  evaluateRackingCapacityClearance,
  type RackingCapacityDocumentEvidence,
} from '@/lib/permit/snapshot/rackingAssembly';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';

// A verified structural document that COVERS the exact RT-MINI assembly.
function goodEvidence(over: Partial<RackingCapacityDocumentEvidence> = {}): RackingCapacityDocumentEvidence {
  return {
    documentId: 'doc-1', documentClass: 'structural_pe_letter',
    documentIdentity: 'RT-MINI II PE letter (archived)', verificationState: 'verified',
    status: 'current', archivedInRepo: true, sha256: 'b'.repeat(64),
    hasStructuralCapacityClaim: true,
    exactModel: 'RT-MINI', fastenerModel: '5/16 structural wood screw', fastenerCount: 2,
    substrate: '15/32 sheathing, 2x4 DF-L #2', rafterDeckCondition: 'sound rafter',
    embedmentIn: 2.5, railLFootAssembly: 'compatible-rail (SKU unpinned)',
    loadBasis: 'ASD allowable', adjustmentFactors: { omega: 1.5 },
    jurisdiction: 'Kentucky', asdAllowableLbs: 600, revisionOrDate: '2026-01',
    ...over,
  };
}

// A generic Roof Tech brochure / flashing report: NO structural capacity claim,
// missing §9 fields.
const brochure: RackingCapacityDocumentEvidence = {
  documentId: 'doc-brochure', documentClass: 'evaluation_report',
  documentIdentity: 'ESR-3575 flashing / water-resistance report', verificationState: 'verified',
  status: 'current', archivedInRepo: true, sha256: 'c'.repeat(64),
  hasStructuralCapacityClaim: false,
  exactModel: 'RT-MINI', fastenerModel: null, fastenerCount: null,
  substrate: null, rafterDeckCondition: null, embedmentIn: null,
  railLFootAssembly: null, loadBasis: 'water resistance', adjustmentFactors: null,
  jurisdiction: null, asdAllowableLbs: null, revisionOrDate: '2023',
};

const ctx = { mountModel: 'RT-MINI', requiredRail: 'compatible-rail (SKU unpinned)', projectJurisdiction: 'Kentucky' };

describe('W4 §9 — evaluateRackingCapacityClearance (pure, both directions)', () => {
  it('CLEARS when a verified structural doc covers every §9 field', () => {
    const r = evaluateRackingCapacityClearance(ctx, goodEvidence());
    expect(r.cleared).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it('REFUSES a generic brochure / flashing report (no structural claim, missing fields)', () => {
    const r = evaluateRackingCapacityClearance(ctx, brochure);
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('structural_capacity_claim');
    expect(r.missing).toContain('fastener_model');
  });

  it('REFUSES when no document is supplied', () => {
    expect(evaluateRackingCapacityClearance(ctx, null).cleared).toBe(false);
  });

  it('REFUSES an un-verified document', () => {
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ verificationState: 'in_review' })).cleared).toBe(false);
  });

  it('REFUSES a superseded document', () => {
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ status: 'superseded' })).cleared).toBe(false);
  });

  it('REFUSES a non-archived / un-hashed document', () => {
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ archivedInRepo: false })).cleared).toBe(false);
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ sha256: null })).cleared).toBe(false);
  });

  it('REFUSES a doc for a different model', () => {
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ exactModel: 'RT-BUTYL' })).cleared).toBe(false);
  });

  it('REFUSES a doc whose jurisdiction does not match the project', () => {
    const r = evaluateRackingCapacityClearance(ctx, goodEvidence({ jurisdiction: 'Illinois' }));
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('jurisdiction');
  });

  it('REFUSES a doc missing embedment / adjustment factors', () => {
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ embedmentIn: null })).cleared).toBe(false);
    expect(evaluateRackingCapacityClearance(ctx, goodEvidence({ adjustmentFactors: {} })).cleared).toBe(false);
  });
});

describe('W4 §9 — buildRackingAssembly consults the registry evidence', () => {
  const sys = getMountingSystemById('rooftech-mini')!;

  it('KEEPS both blockers with no document (legacy behaviour, digest unchanged)', () => {
    const a = buildRackingAssembly(sys)!;
    const codes = a.structuralAuthorityGaps.map(g => g.code);
    expect(codes).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
    // no-opts output identical to legacy => digest reproducible
    const b = buildRackingAssembly(sys)!;
    expect(a.recordRevision).toBe(b.recordRevision);
  });

  it('KEEPS both blockers when only a generic brochure is supplied', () => {
    const a = buildRackingAssembly(sys, { capacityDocument: brochure, projectJurisdiction: 'Kentucky' })!;
    const codes = a.structuralAuthorityGaps.map(g => g.code);
    expect(codes).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
    expect(a.capacityProvenance.sourceDocument.archivedInRepo).toBe(false);
  });

  it('CLEARS both blockers with a verified matching structural document', () => {
    const a = buildRackingAssembly(sys, { capacityDocument: goodEvidence(), projectJurisdiction: 'Kentucky' })!;
    const codes = a.structuralAuthorityGaps.map(g => g.code);
    expect(codes).not.toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).not.toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
    // provenance now reflects the archived, verified source of record
    expect(a.capacityProvenance.sourceDocument.archivedInRepo).toBe(true);
    expect(a.capacityProvenance.sourceDocument.documentHash).toBe('b'.repeat(64));
    expect(a.notes.join(' ')).toMatch(/NOW ARCHIVED and VERIFIED/);
    // 600 lb authority is unchanged
    expect(a.publishedCapacityAllowableLbs).toBe(600);
  });

  it('does NOT clear when the document jurisdiction is wrong for the project', () => {
    const a = buildRackingAssembly(sys, { capacityDocument: goodEvidence({ jurisdiction: 'Illinois' }), projectJurisdiction: 'Kentucky' })!;
    expect(a.structuralAuthorityGaps.map(g => g.code)).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
  });
});
