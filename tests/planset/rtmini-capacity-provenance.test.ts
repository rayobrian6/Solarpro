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
    // ── D3 (2026-08-05) — NO HARDCODED DESIGN BASIS ────────────────────────
    // This used to assert the boundary text contained "ASCE 7-10", which came
    // from a hardcoded literal reading "Source basis = ASCE 7-10, Kentucky".
    // The archived letters are the ILLINOIS issues, so that string was doubly
    // wrong. With no document supplied, the honest statement is that no
    // jurisdiction is established — and nothing is inferred from the catalog.
    expect(p.jurisdictionApplicabilityBoundary).toMatch(/No capacity document is selected/i);
    expect(p.jurisdictionApplicabilityBoundary).not.toMatch(/Kentucky/i);
    expect(p.jurisdictionApplicabilityBoundary).not.toMatch(/ASCE 7-10/);
    expect(p.adjustmentFactors.impliedUltimateToAllowableRatio).toBe(1.5);
    expect(String(p.adjustmentFactors.impliedRatioStatus)).toMatch(/UNVERIFIED/);
  });

  // ── D3 — the module states what it KNOWS, not what it assumes ─────────────
  // Previously: hashNote asserted "no PDF/datasheet file exists in this
  // repository (searched docs/, public/, assets, _tesla_docs)". That is a claim
  // about the ARCHIVE, which a pure function cannot make — and the live registry
  // holds two archived, SHA-256'd RT-MINI II letters that contradict it.
  it('with NO document, records nothing as SELECTED — and asserts nothing about the archive', () => {
    const d = a.capacityProvenance.sourceDocument;
    expect(d.documentHash).toBeNull();
    expect(d.archivedInRepo).toBe(false);
    expect(d.identity).toBeNull();
    expect(d.hashNote).toMatch(/no applicable verified capacity document is currently SELECTED/i);
    // The false archive claim is gone.
    expect(d.hashNote).not.toMatch(/no PDF/i);
    expect(d.hashNote).not.toMatch(/searched docs\//i);
    // …and it names the registry as the owner of that question.
    expect(d.hashNote).toMatch(/manufacturer_document_registry/);
  });

  it('ESR-3575 is disqualified as the capacity source via the STRUCTURED role, not prose', () => {
    // D6 — the disqualification used to live only inside a prose `identity`
    // string while `capacitySource` still named ESR-3575.
    expect(a.documentRoles.structuralCapacityAuthority.established).toBe(false);
    expect(a.documentRoles.structuralCapacityAuthority.basis).toMatch(/excludes structural capacity/i);
    expect(a.documentRoles.listingFlashingBasis.established).toBe(true);
    expect(a.documentRoles.listingFlashingBasis.documentIdentity).toMatch(/ESR-3575/);
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
