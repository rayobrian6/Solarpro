// ═══════════════════════════════════════════════════════════════════════════
// THE SHIPPED MANUFACTURER STRUCTURAL CATALOGUE (2026-08-28)
//
// Four blockers on every Roof Tech project — RACKING-CAPACITY-SOURCE-NOT-
// ARCHIVED, RACKING-CAPACITY-APPLICABILITY-GAP, FASTENER-ASSEMBLY-UNVERIFIED and
// (derivatively) MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED — all rested on ONE
// missing product fact: nothing in the system carried Roof Tech's stamped
// structural PE letter. It is now shipped, archived and hashed in-repo.
//
// These tests are the anti-vacuity proof. It is not enough that the blockers
// cleared: the gate has to still REFUSE the wrong document. So every refusal
// path is exercised with a document that is wrong in exactly one way — wrong
// generation, wrong state, wrong class, unarchived, no capacity claim — and each
// must leave the requirement standing.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  MANUFACTURER_STRUCTURAL_CATALOGUE,
  findManufacturerStructuralDocument,
  toRackingClearanceEvidenceFromCatalogue,
  governingAllowableRow,
} from '@/lib/documents/manufacturerStructuralCatalogue';
import {
  evaluateRackingCapacityClearance,
  jurisdictionCovers,
  jurisdictionStateCode,
  type RackingCapacityDocumentEvidence,
} from '@/lib/permit/snapshot/rackingAssembly';
import {
  getMountingSystemById,
  getMountingSystemRecordById,
  mountingSystemSupersession,
} from '@/lib/mounting-hardware-db';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const IL_DOC = () => findManufacturerStructuralDocument({ mountModel: 'RT-MINI II', stateCode: 'IL' })!;
const EVIDENCE = (): RackingCapacityDocumentEvidence =>
  toRackingClearanceEvidenceFromCatalogue(IL_DOC(), {
    engagesFraming: true, fastenerCount: 2, screwLengthMm: 90,
  })!;
const CTX = {
  mountModel: 'RT-MINI II',
  requiredRail: null,
  projectJurisdiction: 'City of Granite City Building & Zoning',
  projectStateCode: 'IL',
  requiredSubstrate: null,
};

describe('the archived document is what it claims to be', () => {
  it('carries full custody — identity, seal, date, source URL, hash and an in-repo path', () => {
    const d = IL_DOC();
    expect(d.documentClass).toBe('structural_pe_letter');
    expect(d.issuingEntity).toMatch(/Starling Madison Lofquist/);
    expect(d.sealedBy.length).toBeGreaterThan(0);
    expect(d.sealedBy.every(x => /P\.E\./.test(x.credential))).toBe(true);
    expect(d.documentDate).toBe('2023-03-07');
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.sourceUrl).toMatch(/^https:\/\/design\.roof-tech\.us\//);
    expect(d.archivedPath).toMatch(/^public\/manufacturer-assets\/structural\//);
    expect(d.pageCount).toBeGreaterThan(200);
  });

  it('the archived bytes on disk match the recorded SHA-256', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { resolve } = await import('node:path');
    const d = IL_DOC();
    const bytes = readFileSync(resolve(process.cwd(), d.archivedPath));
    expect(bytes.byteLength).toBe(d.byteLength);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(d.sha256);
  });

  it('names the EXACT generation, never a family prefix', () => {
    for (const d of MANUFACTURER_STRUCTURAL_CATALOGUE) {
      expect(d.equipmentModelApplicability.length).toBeGreaterThan(0);
      for (const m of d.equipmentModelApplicability) expect(m.trim()).toBe(m);
    }
    expect(IL_DOC().equipmentModelApplicability).toEqual(['RT-MINI II']);
  });

  it('records the licensed residual the source itself assigns to the project EOR', () => {
    const d = IL_DOC();
    expect(d.engineerOfRecordResponsibilities.length).toBeGreaterThanOrEqual(3);
    expect(d.engineerOfRecordResponsibilities.join(' ')).toMatch(/ENGINEER OF RECORD|EOR/);
    expect(d.engineerOfRecordResponsibilities.join(' ')).toMatch(/framing/i);
  });

  it('takes the WEAKEST matching allowable row, never the friendliest', () => {
    const d = IL_DOC();
    // deck-only: 7/16" OSB (113.7) vs 15/32" plywood (138.0) → the OSB row
    const deck = governingAllowableRow(d, { engagesFraming: false, fastenerCount: 5 })!;
    expect(deck.upliftLbs).toBe(113.7);
    // framing, 2 screws, no length given: 2x60 mm (569.9) vs 2x90 mm (613.2)
    const anyFraming = governingAllowableRow(d, { engagesFraming: true, fastenerCount: 2 })!;
    expect(anyFraming.upliftLbs).toBe(569.9);
    // …and the design's actual 90 mm screw selects its own row
    const ninety = governingAllowableRow(d, { engagesFraming: true, fastenerCount: 2, screwLengthMm: 90 })!;
    expect(ninety.upliftLbs).toBe(613.2);
  });
});

describe('the gate still refuses the wrong document', () => {
  const bad = (patch: Partial<RackingCapacityDocumentEvidence>) =>
    evaluateRackingCapacityClearance(CTX, { ...EVIDENCE(), ...patch });

  it('CLEARS on the correct document (the positive control)', () => {
    const r = evaluateRackingCapacityClearance(CTX, EVIDENCE());
    expect(r.missing).toEqual([]);
    expect(r.cleared).toBe(true);
  });

  it('WRONG GENERATION — an RT-MINI II letter does not cover an RT-MINI selection', () => {
    const r = evaluateRackingCapacityClearance({ ...CTX, mountModel: 'RT-MINI' }, EVIDENCE());
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('exact_model');
  });

  it('WRONG STATE — an Illinois letter does not cover an Indiana project', () => {
    const r = evaluateRackingCapacityClearance(
      { ...CTX, projectStateCode: 'IN', projectJurisdiction: 'Marion County' }, EVIDENCE());
    expect(r.cleared).toBe(false);
    expect(r.missing).toContain('jurisdiction');
  });

  it('WRONG CLASS — a datasheet or flashing report can never carry capacity', () => {
    expect(bad({ documentClass: 'datasheet' }).missing).toContain('document_class');
    expect(bad({ hasStructuralCapacityClaim: false }).missing).toContain('structural_capacity_claim');
  });

  it('NOT ARCHIVED / NO HASH — custody is required, not just a citation', () => {
    expect(bad({ archivedInRepo: false }).missing).toContain('archived_file');
    expect(bad({ sha256: null }).missing).toContain('sha256');
  });

  it('NOT VERIFIED / NOT CURRENT — a superseded or draft document is refused', () => {
    expect(bad({ verificationState: 'draft' }).missing).toContain('verification_state');
    expect(bad({ status: 'superseded' }).missing).toContain('status');
  });

  it('NO ALLOWABLE VALUE — a document with no number establishes nothing', () => {
    expect(bad({ asdAllowableLbs: null }).missing).toContain('asd_allowable_value');
    expect(bad({ loadBasis: 'ultimate (mean to failure)' }).missing).toContain('load_basis');
  });

  it('missing evidence entirely is refused, not defaulted', () => {
    const r = evaluateRackingCapacityClearance(CTX, null);
    expect(r.cleared).toBe(false);
    expect(r.missing).toEqual(['document']);
  });
});

describe('jurisdiction is a container, not a string', () => {
  it('a STATE-scoped document covers a county / municipal AHJ inside it', () => {
    expect(jurisdictionCovers('Illinois', 'Madison County Building & Zoning', 'IL')).toBe(true);
    expect(jurisdictionCovers('Illinois', 'City of Granite City Building and Zoning', 'IL')).toBe(true);
  });

  it('…but not one outside it, and a narrow boundary never covers a broad one', () => {
    expect(jurisdictionCovers('Illinois', 'Marion County', 'IN')).toBe(false);
    expect(jurisdictionCovers('Madison County Building & Zoning', 'Illinois', 'IL')).toBe(false);
  });

  it('exact-name equality still covers (the original rule is intact)', () => {
    expect(jurisdictionCovers('Madison County Building & Zoning', 'Madison County Building and Zoning', null)).toBe(true);
  });

  it('fails closed on an unrecognised or empty boundary', () => {
    expect(jurisdictionCovers(null, 'Madison County', 'IL')).toBe(false);
    expect(jurisdictionCovers('Somewhere', 'Madison County', 'IL')).toBe(false);
    expect(jurisdictionStateCode('Illinois')).toBe('IL');
    expect(jurisdictionStateCode('Madison County')).toBeNull();
  });
});

describe('product supersession', () => {
  it('RT-MINI resolves to the generation that actually ships', () => {
    const raw = getMountingSystemRecordById('rooftech-mini')!;
    expect(raw.model).toBe('RT-MINI');
    expect(raw.supersededById).toBe('rooftech-mini-ii');
    expect(getMountingSystemById('rooftech-mini')!.model).toBe('RT-MINI II');
  });

  it('the substitution is STATED, never silent', () => {
    const chain = mountingSystemSupersession('rooftech-mini');
    expect(chain).toHaveLength(1);
    expect(chain[0].to.model).toBe('RT-MINI II');
    expect(chain[0].basis).toMatch(/second generation/i);
  });

  it('the successor publishes the capacity the SOURCE states, with an allowable basis', () => {
    const m = getMountingSystemById('rooftech-mini')!;
    expect(m.mount.upliftCapacityLbs).toBe(613.2);
    expect(m.mount.capacityBasis).toBe('allowable');
    expect(m.engineeringDataSource).toMatch(/Starling Madison Lofquist/);
    // ESR-3575 is confined to its real role and never cited as capacity
    expect(m.engineeringDataSource).toMatch(/LISTING \/ flashing basis only/);
  });

  it('a mount with no supersession is returned unchanged', () => {
    const u = getMountingSystemById('rooftech-mini-ii');
    expect(u?.id).toBe('rooftech-mini-ii');
    expect(mountingSystemSupersession('rooftech-mini-ii')).toEqual([]);
  });
});

describe('the live Braidon package', () => {
  const build = () => {
    const input = clone(braidonOriginalAuditFixture) as unknown as Record<string, unknown>;
    input.generatedAtIso = '2026-08-28T12:00:00Z';
    const html = generatePermitHTML(input as never);
    return { html, snap: (input as { _snapshot?: PermitDesignSnapshot })._snapshot! };
  };

  it('all four RT-MINI-family requirements are CLEARED by the one product fact', () => {
    const { snap } = build();
    const codes = snap.permitReadiness.registry.map(r => r.code);
    for (const c of [
      'RACKING-CAPACITY-SOURCE-NOT-ARCHIVED',
      'RACKING-CAPACITY-APPLICABILITY-GAP',
      'FASTENER-ASSEMBLY-UNVERIFIED',
      'MIXED-MANUFACTURER-ASSEMBLY-UNSUPPORTED',
    ]) expect(codes, `${c} should be cleared`).not.toContain(c);
    // …and they cleared because a document was RESOLVED, not because the gate
    // stopped asking: the racking record names it.
    const ra = snap.structural.rackingAssembly as unknown as {
      structuralAuthorityGaps: unknown[];
      documentRoles: Record<string, { established: boolean; documentHash: string | null }>;
    };
    expect(ra.structuralAuthorityGaps).toEqual([]);
    expect(ra.documentRoles.structuralCapacityAuthority.established).toBe(true);
    expect(ra.documentRoles.structuralCapacityAuthority.documentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ra.documentRoles.fastenerAuthority.established).toBe(true);
  });

  it('ESR-3575 keeps its real role and never becomes the capacity source', () => {
    const { snap } = build();
    const ra = snap.structural.rackingAssembly as unknown as {
      capacitySource: string | null;
      documentRoles: Record<string, { established: boolean; documentIdentity: string | null }>;
    };
    expect(ra.documentRoles.listingFlashingBasis.documentIdentity).toMatch(/ESR-3575/);
    expect(ra.capacitySource).toMatch(/Starling Madison Lofquist/);
    expect(ra.capacitySource).not.toMatch(/^ICC-ES ESR-3575/);
  });

  it('the rail stays ADVISORY — the source itself delegates it', () => {
    const { snap } = build();
    const reg = snap.permitReadiness.registry;
    const rail = reg.find(r => r.code === 'PENDING-RACKING-ASSEMBLY-SELECTION');
    expect(rail, 'the rail advisory must still exist').toBeTruthy();
    expect(rail!.severity).toBe('warning');
    // it never became a blocker again, by any route
    expect(reg.some(r => r.code === 'RACKING-RAIL-CAPACITY-UNBOUNDED')).toBe(false);
    // and the capacity document is what makes the mixed assembly supported
    const ev = EVIDENCE();
    expect(ev.railLFootAssembly).toMatch(/by others/i);
  });

  it('the FRAMING residual is untouched — the source assigns it to the project EOR', () => {
    const { snap } = build();
    const codes = snap.permitReadiness.registry.map(r => r.code);
    expect(codes).toContain('FRAMING-AUTHORITY-UNVERIFIED');
  });
});
