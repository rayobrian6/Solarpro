// ═══════════════════════════════════════════════════════════════════════════
// R2 + R4 — THE FASTENER FACETS, AND A DOCUMENT THAT STOPS VOUCHING FOR ITSELF
//
// ── R4: THE APPLICABILITY GATE ASKED THE DOCUMENT ABOUT ITSELF ─────────────
// `evaluateDocumentApplicability` began:
//
//     if (!assetModel || !docProduct || assetModel === docProduct)
//       return APPLICABLE;
//
// — the asset's own model against the product parsed from the asset's OWN title.
// Those agree by construction for any well-formed row, so the branch fired first
// and `selectedModel` was NEVER COMPARED. The `racking_detail:rooftech-mini` row
// (model "RT-MINI", title "Roof Tech RT-MINI Installation Manual") is perfectly
// self-consistent, so it came back APPLICABLE for an installed RT-MINI **II**.
// PV-3 printed "DOCUMENT APPLICABILITY: VERIFIED FOR SELECTED RT-MINI II" two
// notes above the note naming that first-generation manual, and DS-3 attached it.
//
// A document is not evidence about itself. The gate now compares the SELECTED
// product's version against both the row it resolved to and the document that row
// carries.
//
// ── R2: ONE FASTENER, TWO QUESTIONS ───────────────────────────────────────
// "Which fastener?" and "how is it installed?" are answered by different
// documents, and one boolean was answering both. A stamped structural PE letter
// for the exact mount names the assembly — 2 × SS304 5.0 mm × 90 mm wood screw,
// 3.07" embedment, no pilot hole, archived in-repo with a SHA-256 — and
// `documentRoles.fastenerAuthority` recorded it as established. The projection
// never asked: the `fastenerAuthorityDocument` argument that short-circuits the
// verdict was never passed, so the branch was dead code.
//
// The package therefore printed "SS304 5.0 mm x 90 mm wood screw (no pilot hole)"
// on PE-1, computed a 613 lb allowable from that exact screw, and said "FASTENER
// ASSEMBLY: PENDING VERIFIED SELECTION" on the same sheet.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { evaluateDocumentApplicability, getManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { projectFastenerAssembly } from '@/lib/permit/snapshot/structuralProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const input: any = clone(braidonOriginalAuditFixture);
input.plansetProfile = 'design-review';
generatePermitHTML(input);
const FA: any = projectFastenerAssembly(input);

const rtMini = getManufacturerAsset('rooftech-mini', 'racking_detail');

describe('a document does not vouch for itself', () => {
  it('a self-consistent gen-1 row is NOT applicable to the gen-2 product', () => {
    // The live defect, exactly: the row and its document agree with each other
    // perfectly, and that agreement used to be the whole answer.
    const a = evaluateDocumentApplicability('RT-MINI II', rtMini);
    expect(a.applicabilityVerified, 'a gen-1 manual must not cover a gen-2 mount').toBe(false);
    expect(a.state).toBe('PENDING_APPLICABILITY');
  });

  it('...and IS applicable to the product it actually covers', () => {
    // The gate must not become a blanket refusal.
    expect(evaluateDocumentApplicability('RT-MINI', rtMini).applicabilityVerified).toBe(true);
  });

  it('naming variance is not a version difference', () => {
    // mount "IronRidge XR100" vs a row modelled "XR100 rail" whose manual is
    // titled "XR Flush Mount Installation Manual" — one product, three names, no
    // version token anywhere.
    const xr = getManufacturerAsset('ironridge-xr100', 'racking_detail');
    if (xr) expect(evaluateDocumentApplicability('IronRidge XR100', xr).applicabilityVerified).toBe(true);
  });

  it('an unanswerable question fails CLOSED', () => {
    // No selected model ⇒ nothing can be shown to cover anything. Returning
    // APPLICABLE here is how an unanswerable question read as a cleared one.
    expect(evaluateDocumentApplicability(null, rtMini).applicabilityVerified).toBe(false);
  });

  it('a verified alias record is still the way across a real version difference', () => {
    const a = evaluateDocumentApplicability('RT-MINI II', rtMini, {
      selectedModel: 'RT-MINI II', documentProduct: 'RT-MINI', verified: true, evidenceRef: 'doc-registry:x',
    });
    expect(a.applicabilityVerified).toBe(true);
    expect(a.state).toBe('VERIFIED');
  });
});

describe('the fastener has two facets, and each names its own source', () => {
  it('SELECTION is established by the stamped letter that names the assembly', () => {
    expect(FA.selection.established).toBe(true);
    expect(FA.selection.sourceDocument).toMatch(/Starling Madison Lofquist|SML Job/i);
  });

  it('INSTALLATION is established too, now that the manual is archived', () => {
    // 2026-08-29 - the RT-MINI II Installation Manual (Jun 2025) is archived
    // in-repo and the lookup follows supersession, so the gen-2 mount resolves to
    // the gen-2 manual. This case asserted the honest PENDING state on the day the
    // document was missing; the document is here now.
    expect(FA.installation.established).toBe(true);
    expect(FA.installation.sourceDocument).toMatch(/RT-MINI II Installation Manual/i);
  });

  it('so the assembly is DESCRIBED, not withheld', () => {
    // The visible defect: "PENDING VERIFIED SELECTION" printed beside the sheet's
    // own "SS304 5.0 mm x 90 mm wood screw".
    expect(FA.line).toMatch(/SS304/);
    expect(FA.line).toMatch(/embedment/i);
  });

  it('and with both facets established the label says so', () => {
    expect(FA.certLabel).toBe('VERIFIED FASTENER ASSEMBLY');
  });

  it('procurement follows BOTH facets — and both are now established', () => {
    // Deliberately not widened: whether a row may be ORDERED is a third question
    // (it needs a part number), and moving it was not this repair. The memory of
    // a requirement closure silently flipping BOM rows to VERIFIED_ORDERABLE is
    // exactly why this is pinned.
    // The rule is unchanged: `verification` is selection AND installation, and
    // `nonOrderable` follows it. Both are established now, so the row is orderable
    // - which is the correct consequence of holding both documents, not a
    // loosening of the rule.
    expect(FA.verification).toBe('verified');
    expect(FA.nonOrderable).toBe(false);
  });
});
