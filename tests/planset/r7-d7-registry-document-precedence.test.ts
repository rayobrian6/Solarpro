// ═══════════════════════════════════════════════════════════════════════════
// D7 — REGISTRY DOCUMENT AUTHORITY AND PRECEDENCE.
//
// THE DEFECT, AS IT ACTUALLY STOOD ON LIVE BRAIDON. `buildEquipmentDocumentAuthority`
// received registry FACTS (archive state, hash, status) but never registry
// document IDENTITY. It resolved the static `manufacturer_assets` entry, then
// attached whatever facts sat under the same `category:equipmentId` key. Those
// are two different documents whenever the asset and the registry disagree:
//
//   entry.documentTitle   "Roof Tech RT-MINI II Installation Manual (Jun 2025)"  ← static asset
//   entry.sourceUrl       …/Installation-Manual-RT-MINI-II.pdf                   ← static asset
//   registryFacts.sha256  2f6035586e94…                                          ← RT-MINI manual
//
// One object asserting that the RT-MINI II manual has the RT-MINI manual's
// SHA-256. Not a precedence `if` — the canonical document was absent from the
// consumer's input entirely, so the version-exact RT-MINI manual was invisible
// while the II asset spoke for it.
//
// THE RULE THESE TESTS PIN: identity, custody and applicability always describe
// the SAME document. A document is selected whole, or not at all.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  selectEquipmentDocument, buildEquipmentDocumentAuthority, documentAuthorityKey,
  type RegistryDocumentIdentity,
} from '@/lib/permit/snapshot/documentAuthority';

const SHA_RTMINI = '2f6035586e948758ff1892f2775a1a6905120750eaf2158f206a2155687486be';
const SHA_RTMINI2 = '3b9a2a9588d237af626aef50ad3b00c30d561851be02b0149fc1360fcada362e';

function doc(over: Partial<RegistryDocumentIdentity> = {}): RegistryDocumentIdentity {
  return {
    documentId: 'doc-rooftech-rtmini-install-manual-2f6035586e94',
    documentClass: 'racking_installation_manual',
    manufacturerOrIssuer: 'Roof Tech, Inc.',
    equipmentId: 'rooftech-mini',
    equipmentModelApplicability: 'RT-MINI',
    title: 'Roof Tech RT-MINI Installation Manual (Jan 2021)',
    revision: null,
    documentDate: '2026-07-28',
    sourceUrl: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    archivedFileIdentity: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    archivedInRepo: true,
    sha256: SHA_RTMINI,
    status: 'current',
    verificationState: 'unverified',
    verificationActor: null,
    verificationActorKind: null,
    verificationBasis: null,
    jurisdictionAuthorityId: null,
    jurisdictionBoundary: 'City of Granite City Building & Zoning',
    ...over,
  };
}

/** the live static asset: it points at the RT-MINI **II** manual. */
const RT_MINI_II_ASSET = {
  id: 'racking_detail:rooftech-mini',
  docTitle: 'Roof Tech RT-MINI II Installation Manual (Jun 2025)',
  sourceUrl: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI-II.pdf',
  model: 'RT-MINI',
};

// ═══════════════════════════════════════════════════════════════════════════
// PRECEDENCE
// ═══════════════════════════════════════════════════════════════════════════

describe('D7 · precedence', () => {
  it('1 — a VERIFIED, applicable registry document beats a conflicting static asset', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [doc({ verificationState: 'verified' })],
      staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.tier).toBe('REGISTRY_AUTHORITY');
    expect(s.authoritative).toBe(true);
    expect(s.documentId).toBe('doc-rooftech-rtmini-install-manual-2f6035586e94');
    expect(s.title).toMatch(/RT-MINI Installation Manual \(Jan 2021\)/);
    // the II asset's identity is nowhere in the selection
    expect(s.title).not.toMatch(/RT-MINI II/);
    expect(String(s.sourceUrl)).not.toMatch(/RT-MINI-II/);
  });

  it('2 — an archived but UNVERIFIED registry row is a visible CANDIDATE, never authoritative', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [doc()], staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.tier).toBe('REGISTRY_CANDIDATE');
    expect(s.authoritative).toBe(false);
    expect(s.documentId).toBe('doc-rooftech-rtmini-install-manual-2f6035586e94');
    expect(s.selectionReason).toMatch(/NOT authoritative/);
    expect(s.selectionReason).toMatch(/verification is 'unverified'/);
  });

  it('3 — the static asset is the fallback when no registry candidate exists', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [], staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.tier).toBe('STATIC_ASSET');
    expect(s.authoritative).toBe(false);
    expect(s.title).toMatch(/RT-MINI II/);
    // …and it carries NO borrowed custody
    expect(s.documentId).toBeNull();
    expect(s.sha256).toBeNull();
    expect(s.archivedInRepo).toBe(false);
    expect(s.verificationState).toBeNull();
  });

  it('4 — with neither, the unavailable state is EXPLICIT, not implied by nulls', () => {
    const s = selectEquipmentDocument({ selectedModel: 'RT-MINI', candidates: [], staticAsset: null });
    expect(s.tier).toBe('UNAVAILABLE');
    expect(s.authoritative).toBe(false);
    expect(s.selectionReason).toMatch(/no registry document and no static asset/);
  });

  it('a product-exact candidate outranks a non-exact one', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [
        doc({ documentId: 'pe-ii', equipmentModelApplicability: 'RT-MINI II', sha256: SHA_RTMINI2, documentClass: 'structural_pe_letter' }),
        doc(),   // the RT-MINI one
      ],
      staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.documentId).toBe('doc-rooftech-rtmini-install-manual-2f6035586e94');
    expect(s.coversSelectedModelExactly).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RT-MINI vs RT-MINI II — the version distinction
// ═══════════════════════════════════════════════════════════════════════════

describe('D7 · RT-MINI and RT-MINI II are different products', () => {
  it('the RT-MINI registry manual does not become RT-MINI II', () => {
    const s = selectEquipmentDocument({ selectedModel: 'RT-MINI', candidates: [doc()], staticAsset: RT_MINI_II_ASSET });
    expect(s.documentProduct).toBe('RT-MINI');
    expect(s.coversSelectedModelExactly).toBe(true);
  });

  it('an RT-MINI II document cannot satisfy an RT-MINI selection as AUTHORITY', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [doc({ documentId: 'pe-ii', equipmentModelApplicability: 'RT-MINI II', verificationState: 'verified', sha256: SHA_RTMINI2 })],
      staticAsset: null,
    });
    // verified — but for the WRONG product, so it is a candidate at most
    expect(s.tier).toBe('REGISTRY_CANDIDATE');
    expect(s.authoritative).toBe(false);
    expect(s.coversSelectedModelExactly).toBe(false);
    expect(s.selectionReason).toMatch(/covers 'RT-MINI II', not the selected 'RT-MINI'/);
  });

  it('the version suffix is significant — RT-MINI never compares equal to RT-MINI II', () => {
    const exact = selectEquipmentDocument({ selectedModel: 'RT-MINI II', candidates: [doc({ equipmentModelApplicability: 'RT-MINI II' })], staticAsset: null });
    expect(exact.coversSelectedModelExactly).toBe(true);
    const cross = selectEquipmentDocument({ selectedModel: 'RT-MINI II', candidates: [doc()], staticAsset: null });
    expect(cross.coversSelectedModelExactly).toBe(false);
  });

  it('a static asset pointing at the WRONG version cannot claim product identity', () => {
    // the asset's own `model` is what it claims to cover
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [],
      staticAsset: { ...RT_MINI_II_ASSET, model: 'RT-MINI II' },
    });
    expect(s.tier).toBe('STATIC_ASSET');
    expect(s.coversSelectedModelExactly).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE CORE INVARIANT — one document, whole
// ═══════════════════════════════════════════════════════════════════════════

describe('D7 · identity and custody always describe the SAME document', () => {
  it('THE REGRESSION: an asset never inherits another document\'s hash', () => {
    // The exact live shape: static asset = RT-MINI II, registry facts = RT-MINI.
    const region = buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      { 'racking_detail:rooftech-mini': { archivedInRepo: true, sha256: SHA_RTMINI, status: 'current' } },
      null,
      { 'racking_detail:rooftech-mini': [doc()] },
    );
    const e = region.entries[documentAuthorityKey('racking_detail', 'rooftech-mini')];
    const sd = e.selectedDocument;
    // the selected document's title and hash belong to the same row
    expect(sd.documentId).toBe('doc-rooftech-rtmini-install-manual-2f6035586e94');
    expect(sd.title).toMatch(/RT-MINI Installation Manual \(Jan 2021\)/);
    expect(sd.sha256).toBe(SHA_RTMINI);
    expect(sd.documentProduct).toBe('RT-MINI');
    // and the II identity is NOT the selection
    expect(sd.title).not.toMatch(/RT-MINI II/);
  });

  it('when the STATIC ASSET wins, no registry hash is attached to it', () => {
    // facts exist under the key, but they belong to a document that is NOT on the
    // candidate list. The asset must not borrow them.
    const region = buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      { 'racking_detail:rooftech-mini': { archivedInRepo: true, sha256: SHA_RTMINI, status: 'current' } },
      null,
      { 'racking_detail:rooftech-mini': [] },   // no candidates
    );
    const sd = region.entries['racking_detail:rooftech-mini'].selectedDocument;
    expect(sd.tier).toBe('STATIC_ASSET');
    expect(sd.sha256).toBeNull();
    expect(sd.archivedInRepo).toBe(false);
  });

  it('verification identity belongs to the selected document', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [doc({ verificationState: 'verified', verificationActor: 'registrar-1', verificationActorKind: 'human', verificationBasis: 'REGISTRAR_REVIEW' })],
      staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.verificationActor).toBe('registrar-1');
    expect(s.verificationActorKind).toBe('human');
    expect(s.verificationBasis).toBe('REGISTRAR_REVIEW');
  });

  it('the jurisdiction binding travels with the document (D4 ↔ D7)', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [doc({ jurisdictionAuthorityId: 'il-madison-county' })],
      staticAsset: null,
    });
    expect(s.jurisdictionAuthorityId).toBe('il-madison-county');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEPENDENCE OF FACTS
// ═══════════════════════════════════════════════════════════════════════════

describe('D7 · authenticity, product, assembly and jurisdiction stay independent', () => {
  it('archived + hashed does NOT make a document product-applicable', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI',
      candidates: [doc({ equipmentModelApplicability: 'RT-MINI II', sha256: SHA_RTMINI2, documentId: 'pe-ii' })],
      staticAsset: null,
    });
    expect(s.archivedInRepo).toBe(true);
    expect(s.sha256).toBeTruthy();
    expect(s.coversSelectedModelExactly).toBe(false);   // authenticity ≠ applicability
    expect(s.authoritative).toBe(false);
  });

  it('a withdrawn document is not selectable as a candidate', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [doc({ status: 'withdrawn' })], staticAsset: RT_MINI_II_ASSET,
    });
    expect(s.tier).toBe('STATIC_ASSET');
  });

  it('an unhashed registry row cannot become a candidate', () => {
    const s = selectEquipmentDocument({
      selectedModel: 'RT-MINI', candidates: [doc({ sha256: null, archivedInRepo: false })], staticAsset: null,
    });
    expect(s.tier).toBe('UNAVAILABLE');
  });

  it('NO code path can claim a document is nonexistent when an archived row exists', () => {
    const s = selectEquipmentDocument({ selectedModel: 'RT-MINI', candidates: [doc()], staticAsset: null });
    expect(s.tier).not.toBe('UNAVAILABLE');
    expect(s.documentId).toBeTruthy();
    expect(s.archivedInRepo).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISM
// ═══════════════════════════════════════════════════════════════════════════

describe('D7 · determinism', () => {
  it('the same inputs produce a byte-identical region', () => {
    const mk = () => JSON.stringify(buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      null, null, { 'racking_detail:rooftech-mini': [doc()] }));
    expect(mk()).toBe(mk());
  });

  it('a MATERIAL selection change changes the region (document identity is digest-relevant)', () => {
    const asCandidate = JSON.stringify(buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      null, null, { 'racking_detail:rooftech-mini': [doc()] }));
    const asAuthority = JSON.stringify(buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }],
      null, null, { 'racking_detail:rooftech-mini': [doc({ verificationState: 'verified' })] }));
    expect(asAuthority).not.toBe(asCandidate);
  });

  it('omitting registryDocuments reproduces the pre-D7 static-asset behaviour', () => {
    const region = buildEquipmentDocumentAuthority(
      [{ category: 'racking_detail', equipmentId: 'rooftech-mini', selectedModel: 'RT-MINI' }]);
    expect(region.entries['racking_detail:rooftech-mini'].selectedDocument.tier).toBe('STATIC_ASSET');
  });
});
