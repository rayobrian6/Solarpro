// ═══════════════════════════════════════════════════════════════════════════
// D3 / D6 — THE REGISTRY OWNS DOCUMENT FACTS; ONE DOCUMENT, ONE ROLE.
//
// D3: buildRackingAssembly hardcoded that the PE structural letter is NOT
// archived, that its hash is null, that "no PDF/datasheet file exists in this
// repository", and that the design basis is "ASCE 7-10, Kentucky". The live
// registry holds TWO archived, SHA-256'd RT-MINI II PE letters — and they are
// the ILLINOIS issues. The package asserted a false negative about its own
// archive while naming the wrong jurisdiction.
//
// D6: the record's structured fields named ICC-ES ESR-3575 as the capacity
// source while its own notes said ESR-3575 carries no structural value. Prose
// negated data.
//
// CRITICAL: none of this may CLEAR a requirement. An RT-MINI II document is not
// applicable to an RT-MINI mount, and authenticity is not applicability. These
// tests pin that the reasons became TRUE, not that the gaps went away.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  buildRackingAssembly,
  evaluateRackingCapacityClearance,
  type RackingCapacityDocumentEvidence,
} from '@/lib/permit/snapshot/rackingAssembly';
import { getMountingSystemById, getMountingSystemRecordById } from '@/lib/mounting-hardware-db';

// 2026-08-28 RT-MINI MIGRATION — this suite is ABOUT the wrong-generation
// refusal, so it needs a gen-1 selection to refuse. `getMountingSystemById`
// now follows the manufacturer's stated supersession and returns RT-MINI II,
// which would have quietly turned every case here into a matching-document
// case. The LITERAL record keeps the scenario intact; the rule under test
// (authenticity is not applicability) is unchanged.
const RT_MINI = getMountingSystemRecordById('rooftech-mini')!;

/** The live ASCE 7-10 RT-MINI II letter, as the registry actually records it. */
function rtMiniIiPeLetter(over: Partial<RackingCapacityDocumentEvidence> = {}): RackingCapacityDocumentEvidence {
  return {
    documentId: 'doc-rooftech-rtmini2-pe-letter-3b9a2a9588d2',
    documentClass: 'structural_pe_letter',
    documentIdentity: 'Roof Tech RT-Mini II Mount — Structural Analysis (PE-stamped letter, ASCE 7-10)',
    verificationState: 'verified',
    status: 'current',
    archivedInRepo: true,
    sha256: '3b9a2a9588d237af626aef50ad3b00c30d561851be02b0149fc1360fcada362e',
    hasStructuralCapacityClaim: true,
    exactModel: 'RT-MINI II',                 // ← NOT the selected RT-MINI
    fastenerModel: '5/16" structural wood screw',
    fastenerCount: 2,
    substrate: 'asphalt_shingle, wood_shake',
    rafterDeckCondition: '15/32" sheathing over 2x4 DF-L #2',
    embedmentIn: 2.5,
    railLFootAssembly: 'Roof Tech L-Foot',
    loadBasis: 'ASD allowable',
    adjustmentFactors: { safetyFactor: 3.0 },
    jurisdiction: 'Madison County Building & Zoning',
    asdAllowableLbs: 613.2,
    revisionOrDate: 'ASCE 7-10',
    ...over,
  };
}

describe('D3 · the module never asserts facts the registry owns', () => {
  it('with NO document, it does not claim "no PDF exists"', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    const note = a.capacityProvenance.sourceDocument.hashNote;
    expect(note).not.toMatch(/no PDF/i);
    expect(note).not.toMatch(/file exists in this repository/i);
    expect(note).not.toMatch(/searched docs\//i);
    // It says the honest thing instead: nothing is SELECTED.
    expect(note).toMatch(/no applicable verified capacity document is currently SELECTED/i);
  });

  it('THE KENTUCKY CLAIM IS GONE from every field and note', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    const blob = JSON.stringify(a);
    expect(blob).not.toMatch(/Kentucky/i);
    expect(blob).not.toMatch(/ASCE 7-10, KY/);
    expect(blob).not.toMatch(/\(KY\)/);
  });

  it('with a document supplied, archive state and hash come FROM the document', () => {
    const doc = rtMiniIiPeLetter();
    const a = buildRackingAssembly(RT_MINI, { capacityDocument: doc, projectJurisdiction: 'Madison County Building & Zoning' })!;
    const sd = a.capacityProvenance.sourceDocument;
    expect(sd.archivedInRepo).toBe(true);
    expect(sd.documentHash).toBe(doc.sha256);
    expect(sd.identity).toBe(doc.documentIdentity);
    expect(sd.hashNote).toMatch(/source-archived/i);
    // and it must NOT claim the thing that was false before
    expect(sd.hashNote).not.toMatch(/not archived/i);
  });

  it('the jurisdiction boundary is DERIVED from the document, never hardcoded', () => {
    const a = buildRackingAssembly(RT_MINI, {
      capacityDocument: rtMiniIiPeLetter({ jurisdiction: 'City of Granite City Building & Zoning' }),
      projectJurisdiction: 'Madison County Building & Zoning',
    })!;
    expect(a.capacityProvenance.jurisdictionApplicabilityBoundary)
      .toContain('City of Granite City Building & Zoning');
    expect(a.capacityProvenance.jurisdictionApplicabilityBoundary).toMatch(/NOT confirmed/i);
  });
});

describe('D3 · AUTHENTICITY IS NOT APPLICABILITY — the gaps stay open', () => {
  it('an archived, hashed, VERIFIED RT-MINI II letter does NOT clear RT-MINI capacity', () => {
    const doc = rtMiniIiPeLetter();
    const res = evaluateRackingCapacityClearance(
      { mountModel: 'RT-MINI', requiredRail: null, projectJurisdiction: 'Madison County Building & Zoning' },
      doc,
    );
    expect(res.cleared).toBe(false);
    expect(res.missing).toContain('exact_model');
    expect(res.reasons.join(' ')).toMatch(/covers 'RT-MINI II', not the selected mount 'RT-MINI'/);
  });

  it('both RACKING-CAPACITY-* gaps remain even with the document supplied', () => {
    const a = buildRackingAssembly(RT_MINI, {
      capacityDocument: rtMiniIiPeLetter(),
      projectJurisdiction: 'Madison County Building & Zoning',
    })!;
    const codes = a.structuralAuthorityGaps.map(g => g.code);
    expect(codes).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
  });

  it('the gap message now names the REAL reason (wrong product), not a false archive claim', () => {
    const a = buildRackingAssembly(RT_MINI, {
      capacityDocument: rtMiniIiPeLetter(),
      projectJurisdiction: 'Madison County Building & Zoning',
    })!;
    const src = a.structuralAuthorityGaps.find(g => g.code === 'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED')!;
    // It acknowledges the document IS archived — the old text denied it.
    expect(src.message).toMatch(/archived with a SHA-256/);
    expect(src.message).not.toMatch(/NOT\s+archived in-repo/i);
    const gap = a.structuralAuthorityGaps.find(g => g.code === 'RACKING-CAPACITY-APPLICABILITY-GAP')!;
    expect(gap.message).toMatch(/covers 'RT-MINI II', which is NOT the selected mount 'RT-MINI'/);
  });

  it('a jurisdiction match alone still does not clear it (product mismatch governs)', () => {
    const a = buildRackingAssembly(RT_MINI, {
      capacityDocument: rtMiniIiPeLetter({ jurisdiction: 'Madison County Building & Zoning' }),
      projectJurisdiction: 'Madison County Building & Zoning',
    })!;
    expect(a.assemblyVerification.capacitySource).not.toBe('verified');
    expect(a.documentRoles.structuralCapacityAuthority.established).toBe(false);
  });
});

describe('D6 · one document, one role', () => {
  it('ESR-3575 fills the listing/flashing role and ONLY that role', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    const roles = a.documentRoles;
    expect(roles.listingFlashingBasis.established).toBe(true);
    expect(roles.listingFlashingBasis.documentIdentity).toMatch(/ESR-3575/);

    // …and is NOT the structural capacity authority.
    expect(roles.structuralCapacityAuthority.established).toBe(false);
    expect(roles.structuralCapacityAuthority.documentIdentity).toBeNull();
    expect(roles.structuralCapacityAuthority.basis).toMatch(/excludes structural capacity/i);
  });

  it('fastener authority is NOT established by a flashing report', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    expect(a.documentRoles.fastenerAuthority.established).toBe(false);
    expect(a.documentRoles.fastenerAuthority.basis).toMatch(/no fastener-installation authority/i);
  });

  it('installation authority is not claimed without a version-exact document', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    expect(a.documentRoles.installationAuthority.established).toBe(false);
  });

  it('a structured field no longer contradicts the record prose', () => {
    const a = buildRackingAssembly(RT_MINI)!;
    // The note says ESR-3575 carries no structural value…
    expect(a.notes.join(' ')).toMatch(/ESR-3575 is a flashing/i);
    // …and now the STRUCTURED role agrees.
    expect(a.documentRoles.structuralCapacityAuthority.established).toBe(false);
  });

  it('the per-generation capacity rule is stated on the record', () => {
    // 2026-08-28 RT-MINI MIGRATION — the note used to REPORT the defect as live
    // ("the 613.2 figure is published for RT-MINI II; the selected mount is
    // RT-MINI"). It is fixed at source, so the note states the RULE and what
    // covers the selection. The words that carry the rule are unchanged.
    const a = buildRackingAssembly(RT_MINI)!;
    expect(a.notes.join(' ')).toMatch(/PRODUCT GENERATION/);
    expect(a.notes.join(' ')).toMatch(/authenticity is not applicability/i);
    expect(a.notes.join(' ')).toMatch(/No capacity document covers this exact generation/);
  });
});

describe('D3/D6 · determinism preserved', () => {
  it('the record is byte-stable for identical inputs', () => {
    const a = JSON.stringify(buildRackingAssembly(RT_MINI));
    const b = JSON.stringify(buildRackingAssembly(RT_MINI));
    expect(a).toBe(b);
  });

  it('supplying a document CHANGES the record revision (document identity is digest-relevant)', () => {
    const bare = buildRackingAssembly(RT_MINI)!;
    const withDoc = buildRackingAssembly(RT_MINI, { capacityDocument: rtMiniIiPeLetter() })!;
    expect(withDoc.recordRevision).not.toBe(bare.recordRevision);
  });
});
