import { describe, it, expect } from 'vitest';
import {
  buildRackingAssembly,
  resolveAsdAllowableLbs,
} from '@/lib/permit/snapshot/rackingAssembly';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';

describe('W3.1 §4 — RT-MINI capacity provenance (records only in-repo-verifiable evidence)', () => {
  const a = buildRackingAssembly(getMountingSystemById('rooftech-mini'))!;

  it('keeps the 600 lb ASD allowable authority (unchanged from W3)', () => {
    expect(a.publishedCapacityAllowableLbs).toBe(600);
    expect(a.capacityBasis).toBe('allowable');
    expect(a.recordRevision).toBeTruthy();
    expect(a.notes.join(' ')).toMatch(/600 lb ASD ALLOWABLE/);
    expect(a.notes.join(' ')).toMatch(/NOT structural authority/);
  });

  it('carries a full capacity-provenance record', () => {
    const p = a.capacityProvenance;
    expect(p).toBeTruthy();
    expect(p.mountModel).toBe('RT-MINI');
    expect(p.capacityBasis).toBe('allowable');
    expect(p.asdAllowableLbs).toBe(600);
    expect(p.ultimateBasisRefusedForAsd).toBe(false);
    expect(p.fastenerPattern).toMatch(/2× 5\/16"/);
    expect(p.substrateInstallationCondition).toMatch(/2×4 DF-L #2/);
    expect(p.jurisdictionApplicabilityBoundary).toMatch(/ASCE 7-10/);
    expect(p.adjustmentFactors.impliedUltimateToAllowableRatio).toBe(1.5);
    expect(String(p.adjustmentFactors.impliedRatioStatus)).toMatch(/UNVERIFIED/);
  });

  it('records the source document as NOT archived (documentHash null, honest note)', () => {
    const d = a.capacityProvenance.sourceDocument;
    expect(d.documentHash).toBeNull();
    expect(d.archivedInRepo).toBe(false);
    expect(d.hashNote).toMatch(/source-document-not-archived/);
    expect(d.identity).toMatch(/PE-stamped structural letter/);
    // ESR-3575 is explicitly disqualified as the capacity source
    expect(d.identity).toMatch(/ESR-3575/);
    expect(d.identity).toMatch(/EXCLUDES structural capacity/);
  });

  it('EXCLUDES the 900 lb "ultimate" registry records from allowable capacity', () => {
    const ex = a.capacityProvenance.excludedUltimateRecords;
    expect(ex.length).toBeGreaterThan(0);
    const nine = ex.find(r => r.value === 900);
    expect(nine).toBeTruthy();
    expect(nine!.basis).toBe('ultimate');
    expect(nine!.reason).toMatch(/REFUSED/);
  });

  it('assembly applicability: source covers the mount, NOT the mixed compatible rail', () => {
    const ap = a.capacityProvenance.assemblyApplicability;
    expect(ap.sourceCoversMount).toBe(true);
    expect(ap.sourceCoversRail).toBe(false);
    expect(ap.assessment).toMatch(/Do NOT apply generically/);
  });

  it('emits BLOCKING structural-authority gaps (not applied generically)', () => {
    const gaps = a.structuralAuthorityGaps;
    const codes = gaps.map(g => g.code);
    expect(codes).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
    for (const g of gaps) expect(g.severity).toBe('blocking');
  });
});

describe('W3.1 §4 — resolveAsdAllowableLbs refuses ultimate-basis values', () => {
  it('accepts an allowable-basis value directly', () => {
    const r = resolveAsdAllowableLbs(600, 'allowable');
    expect(r.refused).toBe(false);
    expect(r.allowableLbs).toBe(600);
    expect(r.basis).toBe('allowable');
  });

  it('REFUSES the 900 lb ultimate registry value for an ASD allowable check', () => {
    const r = resolveAsdAllowableLbs(900, 'ultimate');
    expect(r.refused).toBe(true);
    expect(r.allowableLbs).toBeNull();
    expect(r.basis).toBe('ultimate');
    expect(r.reason).toMatch(/REFUSED/);
  });

  it('REFUSES an unset basis (treated as ultimate, conservative)', () => {
    const r = resolveAsdAllowableLbs(900, undefined);
    expect(r.refused).toBe(true);
    expect(r.allowableLbs).toBeNull();
  });

  it('null/NaN capacity is refused', () => {
    expect(resolveAsdAllowableLbs(null, 'allowable').refused).toBe(true);
    expect(resolveAsdAllowableLbs(NaN, 'allowable').refused).toBe(true);
  });
});

describe('W3.1 §4 — a genuinely ultimate-basis mount is flagged, not laundered', () => {
  it('S-5! (ultimate basis) provenance refuses the raw value as an ASD allowable', () => {
    const a = buildRackingAssembly(getMountingSystemById('s5-pvkit'))!;
    expect(a.capacityBasis).toBe('ultimate');
    // the ASD resolver refuses the raw ultimate value on the provenance record
    expect(a.capacityProvenance.ultimateBasisRefusedForAsd).toBe(true);
    expect(a.capacityProvenance.asdAllowableLbs).toBeNull();
    const codes = a.structuralAuthorityGaps.map(g => g.code);
    expect(codes).toContain('RACKING-CAPACITY-ULTIMATE-BASIS-REFUSED');
  });
});
