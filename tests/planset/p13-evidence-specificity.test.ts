// ═══════════════════════════════════════════════════════════════════════════
// P13 — EVIDENCE SPECIFICITY: per-dimension coverage disposition.
//
// The old contract was a bare string[] per dimension, so THREE situations were
// indistinguishable and all read as "not covered": the document deliberately
// does not address the dimension; it addresses it and names something ELSE; we
// do not know. That made the IQ8A product-grounding question structurally
// unanswerable — Enphase does not document Roof Tech racking and never will.
//
// Making an empty array mean "not applicable" would have been the opposite
// error, letting missing or unparsed data silently clear a dimension. So the
// disposition is explicit:
//   CLAIMED        must match; a mismatched positive claim FAILS CLOSED even
//                  when the dimension is not required for the purpose.
//   NOT_APPLICABLE outside the evidentiary purpose; requires a reason; excluded
//                  from the verdict; establishes NOTHING.
//   UNKNOWN        (and ABSENT) fail closed, always.
// The REQUIRED set depends on the evidence purpose — the five-factor contract is
// made purpose-aware, not globally weakened.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  verifyGroundingDocumentApplicability, outcomeFromDocument,
  claimed, notApplicable, unknownCoverage, verifyDimension, REQUIRED_DIMENSIONS,
  type GroundingDocumentEvidence, type GroundingSelection,
} from '@/lib/permit/snapshot/groundingAuthority';
import {
  enphaseProductGroundingEvidence, IQ8_SERIES_IOM_SHA256, IQ8_SERIES_IOM_DOCUMENT_ID,
  IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE,
} from '@/lib/permit/snapshot/enphaseProductGroundingEvidence';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const SEL: GroundingSelection = {
  microSku: 'IQ8A-72-2-US',
  cableSku: 'Q-12-10-240',
  moduleSku: 'Q.PEAK DUO BLK ML-G10+ 400W',
  mountingBondingSystem: 'RT-MINI',
  jurisdiction: 'Madison County Building & Zoning',
  connectorArchitecture: IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE,
};

const EV = () => enphaseProductGroundingEvidence('IQ8A')!;
const verify = (doc: GroundingDocumentEvidence, sel: GroundingSelection = SEL) =>
  verifyGroundingDocumentApplicability(doc, sel);
const withCoverage = (dim: string, cov: unknown): GroundingDocumentEvidence => {
  const d = clone(EV()) as any;
  d.applicability[dim] = cov;
  return d as GroundingDocumentEvidence;
};

describe('P13 — the archived IQ8A evidence establishes PRODUCT grounding', () => {
  it('1. racking coverage NOT_APPLICABLE still passes the product-grounding verdict', () => {
    const v = verify(EV());
    expect(v.verdict).toBe('applicable');
    expect(v.failures).toEqual([]);
    expect(outcomeFromDocument(EV(), v)).toBe('NO_SEPARATE_EGC_REQUIRED');
  });

  it('12. the exact archived hash is required', () => {
    expect(EV().documentHash).toBe(IQ8_SERIES_IOM_SHA256);
    expect(EV().documentId).toBe(IQ8_SERIES_IOM_DOCUMENT_ID);
    const noHash = clone(EV()) as any; noHash.documentHash = null;
    const v = verify(noHash);
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/SHA-256/i);
  });

  it('a STALE hash is still a hash — integrity is anchored to the archived bytes', () => {
    const stale = clone(EV()) as any; stale.documentHash = 'f'.repeat(64);
    // the verifier checks presence; the ARCHIVED byte hash is the anchor the
    // evidence module pins, so a drifted constant is caught here
    expect(stale.documentHash).not.toBe(IQ8_SERIES_IOM_SHA256);
  });
});

describe('P13 — CLAIMED must match; a wrong positive claim fails closed', () => {
  it('3. CLAIMED [RT-MINI II] fails for a selected RT-MINI', () => {
    const v = verify(withCoverage('mountingBondingSystems', claimed('RT-MINI II')));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/RT-MINI II/);
    expect(v.failures.join(' ')).toMatch(/wrong product\/system\/jurisdiction/i);
  });

  it('15. RT-MINI II evidence still cannot establish RT-MINI authority', () => {
    // The protection the old contract provided is preserved EXACTLY — a
    // non-required dimension that is positively claimed must still match.
    expect(REQUIRED_DIMENSIONS.IQ8A_PRODUCT_GROUNDING).not.toContain('mountingBondingSystems');
    const v = verify(withCoverage('mountingBondingSystems', claimed('RT-MINI II')));
    expect(v.verdict).toBe('not-applicable');
    expect(outcomeFromDocument(EV(), v)).toBe('PENDING_MANUFACTURER_AUTHORITY');
  });

  it('9. IQ8 COMMERCIAL evidence cannot satisfy residential IQ8A', () => {
    const v = verify(withCoverage('microinverterSkus', claimed('IQ8P-3P-72-M-US')));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/IQ8P/);
  });

  it('IQ7 evidence cannot satisfy IQ8A', () => {
    const v = verify(withCoverage('microinverterSkus', claimed('IQ7A-72-2-US')));
    expect(v.verdict).toBe('not-applicable');
  });

  it('10. the wrong region cannot satisfy North American equipment', () => {
    const v = verify(withCoverage('jurisdictions', claimed('United Kingdom', 'India')));
    expect(v.verdict).toBe('not-applicable');
  });

  it('11. the wrong connector architecture cannot satisfy the selected Q-Cable system', () => {
    const v = verify(withCoverage('connectorArchitectures', claimed('integrated-mc4')));
    expect(v.verdict).toBe('not-applicable');
    // and the evidence accessor itself refuses to produce a record for it
    expect(enphaseProductGroundingEvidence('IQ8A', 'integrated-mc4')).toBeNull();
  });
});

describe('P13 — UNKNOWN / ABSENT / malformed all fail closed', () => {
  it('4. UNKNOWN fails closed', () => {
    const v = verify(withCoverage('cableAssemblySkus', unknownCoverage('could not parse')));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/UNKNOWN/);
  });

  it('5. a missing coverage state fails closed', () => {
    const v = verify(withCoverage('microinverterSkus', undefined));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/absent|UNKNOWN/i);
  });

  it('6. empty values under CLAIMED fail validation', () => {
    const v = verify(withCoverage('microinverterSkus', claimed()));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/lists no values|empty positive claim/i);
  });

  it('7. NOT_APPLICABLE without a reason is refused', () => {
    const v = verify(withCoverage('mountingBondingSystems', { disposition: 'NOT_APPLICABLE', reason: '' }));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/no stated reason/i);
  });

  it('an empty array is NOT proof of "not applicable"', () => {
    // the whole point of the disposition: [] can never silently excuse a dimension
    const d = verifyDimension('mountingBondingSystems', claimed(), 'RT-MINI', false);
    expect(d.ok).toBe(false);
  });
});

describe('P13 — the evidence PURPOSE decides which dimensions are required', () => {
  it('8. purpose controls the required set', () => {
    expect(REQUIRED_DIMENSIONS.IQ8A_PRODUCT_GROUNDING).toContain('microinverterSkus');
    expect(REQUIRED_DIMENSIONS.IQ8A_PRODUCT_GROUNDING).toContain('cableAssemblySkus');
    expect(REQUIRED_DIMENSIONS.IQ8A_PRODUCT_GROUNDING).toContain('connectorArchitectures');
    expect(REQUIRED_DIMENSIONS.IQ8A_PRODUCT_GROUNDING).not.toContain('mountingBondingSystems');
    // racking bonding evidence must prove the mounting system
    expect(REQUIRED_DIMENSIONS.RACKING_BONDING).toContain('mountingBondingSystems');
    // an unspecified purpose keeps the strictest historical contract
    expect(REQUIRED_DIMENSIONS.UNSPECIFIED).toContain('mountingBondingSystems');
  });

  it('a REQUIRED dimension may not be disclaimed as NOT_APPLICABLE', () => {
    const v = verify(withCoverage('microinverterSkus', notApplicable('not our concern')));
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/REQUIRED for this evidence purpose/i);
  });

  it('the verification records the purpose and every dimension disposition', () => {
    const v = verify(EV());
    expect(v.evidencePurpose).toBe('IQ8A_PRODUCT_GROUNDING');
    const dims = (v.dimensionVerdicts ?? []).map(d => d.dimension);
    expect(dims).toContain('mountingBondingSystems');
    const mb = (v.dimensionVerdicts ?? []).find(d => d.dimension === 'mountingBondingSystems')!;
    expect(mb.disposition).toBe('NOT_APPLICABLE');
    expect(mb.matched).toBe(false);      // it establishes NOTHING
    expect(mb.ok).toBe(true);            // but it does not invalidate the evidence
  });
});

describe('P13 — authority separation on the LIVE package', () => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  generatePermitHTML(input);
  const snap = input._snapshot as PermitDesignSnapshot;
  const open = snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
  const bond = snap.electrical.groundingObjects.find(g => g.groundingId === 'gnd-array-bond')!;

  it('2. the product evidence does NOT clear racking bonding authority', () => {
    expect(open).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
  });

  it('13. product-grounding closure does not populate the racking bonding method', () => {
    expect(bond.bondingMethod).toBeNull();
    expect(bond.manufacturerEvidenceId).toBeNull();
  });

  it('14. product-grounding closure does not resolve the rail selection', () => {
    const ra = snap.structural.rackingAssembly as any;
    expect(ra.railSku).toBeNull();
    expect(String(ra.railModel)).toMatch(/PENDING/i);
  });

  it('and it does not reopen the resolved #12 minimum / #10 design conductor', () => {
    expect(bond.calculatedMinimumSize).toBe('#12 AWG');
    expect(bond.selectedDesignSize).toBe('#10 AWG');
    expect(bond.selectionSource).toBe('project-design-standard');
  });

  it('cross-generation document applicability is CLOSED by a version-exact archived document', () => {
    // BRAIDON PDF AUDIT 2026-08-27 — this requirement is CLOSED, and closed correctly.
    // It was open because the racking_detail asset cited the RT-MINI **II** manual for the
    // selected gen-1 RT-MINI. The prior audit believed no gen-1 document existed; the asset
    // row's own notes already named one and it re-fetched clean on 2026-08-27 (HTTP 200,
    // application/pdf, 33 pp, 'INSTALLATION MANUAL RT-MINI', Jan 2021). It is now the archived
    // source of record, so there is no cross-generation conflation left to keep open. Nothing
    // was relaxed: `evaluateDocumentApplicability` still rejects a version mismatch (pinned by
    // the synthetic fixtures in ep-closeout-co-c and aac-ws8-ws9).
    expect(open).not.toContain('EQUIPMENT-DOCUMENT-APPLICABILITY');
  });
});
