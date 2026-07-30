// ═══════════════════════════════════════════════════════════════════════════
// ECD WS-2 — AUTHORITY / IDENTITY / LANGUAGE (docs/ENGINE-CLOSURE-DIRECTIVE.md
// §6 §7 §8 §9; docs/ECD-ROOT-CAUSE-MAP.md W2-A … W2-D).
//
// The §12 closure gates this file owns:
//   11  physical grounding segment IDs unique  (+ the mandated ANTI-VACUITY probe:
//       the previous gate could not fail because only ONE id was ever rendered)
//   12  a grouped authority object is never counted as a physical segment
//   13  a PENDING racking assembly cannot assert integrated UL 2703 bonding
//       (+ a synthetic VERIFIED assembly that renders the verified wording, so the
//        gate is non-vacuous in both directions)
//   14  APP-A cannot globally approve equipment
//   15  ARCHIVED ≠ APPLICABLE
//   16  a supply-side design cannot render load-side-only citations — package-wide
//       over E-1 / PV-4A / PV-4B / PV-5 / SCHED / warning labels / evidence
//
// Everything is asserted on the REAL frozen Braidon package regenerated through
// the public API — no injected snapshot, no patched HTML.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import {
  projectGroundingSegments, projectE1PhysicalSchedule,
  BRANCH_EGC_AUTHORITY_GROUP_ID,
} from '@/lib/permit/snapshot/electricalProjection';
import {
  buildRackingBondingAuthority, projectRackingBondingAuthority,
  BONDING_METHOD_PENDING_LABEL, BONDING_REQUIREMENT_CODE_BASIS,
} from '@/lib/permit/snapshot/rackingBonding';
import {
  projectEquipmentListingConclusion,
  EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE,
  EQUIPMENT_LISTING_ESTABLISHED_SENTENCE,
} from '@/lib/permit/snapshot/equipmentListingConclusion';
import {
  evaluateDocumentApplicability, getManufacturerAsset,
  DOCUMENT_APPLICABILITY_STATES, APPLICABILITY_ESTABLISHED_STATES,
  type DocumentApplicabilityState,
} from '@/lib/manufacturer-assets-db';
import { selectFieldLabels } from '@/lib/permit/utils/fieldLabels';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(): { html: string; input: any; snap: PermitDesignSnapshot } {
  const input = clone(braidonOriginalAuditFixture) as any;
  const html = generatePermitHTML(input);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot };
}
const PKG = gen();

/** Strip markup + decode entities so prose assertions survive inline spans. */
const text = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/data:image[^"')]+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
    .replace(/&times;/g, '×').replace(/&deg;/g, '°').replace(/&Sigma;/g, 'Σ')
    .replace(/&check;/g, '✓').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const sheets = (html: string): string[] => html.split(/<div class="page"/).slice(1);
const sheetWith = (html: string, needle: string): string =>
  sheets(html).find(p => p.includes(needle)) ?? '';

const attrValues = (html: string, attr: string): string[] =>
  (html.match(new RegExp(`${attr}="([^"]*)"`, 'g')) ?? [])
    .map(t => (t.match(/="([^"]*)"/) ?? [])[1] ?? '');

// ═══════════════════════════════════════════════════════════════════════════
// §6 — GROUNDING IDENTITY (gates 11 + 12)
// ═══════════════════════════════════════════════════════════════════════════
describe('ECD §6 — grounding identity: three physical branch segments, ONE group authority', () => {
  it('the snapshot still holds the three unique canonical records gnd-br-1/2/3', () => {
    const branchRecords = (PKG.snap.electrical?.groundingObjects ?? [])
      .filter(g => g.purpose === 'branch-egc');
    expect(branchRecords.map(g => g.groundingId).sort())
      .toEqual(['gnd-br-1', 'gnd-br-2', 'gnd-br-3']);
  });

  it('gate 12 — the grouped branch-EGC node carries its OWN id and is NOT a physical segment', () => {
    const segs = projectGroundingSegments(PKG.snap);
    const groups = segs.filter(s => s.identityKind === 'group-authority');
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.groundingSegmentId).toBe(BRANCH_EGC_AUTHORITY_GROUP_ID);
    // it projects THREE canonical records, so it names none of them as ITS id
    expect(g.groundingId).toBeNull();
    expect(g.memberGroundingIds.sort()).toEqual(['gnd-br-1', 'gnd-br-2', 'gnd-br-3']);
    expect(g.branchScope.length).toBe(3);
    // THE regression: the group id must never be a physical segment identity
    expect(g.groundingSegmentId).not.toMatch(/^gnd-br-\d$/);
    const physicalIds = segs.filter(s => s.identityKind === 'physical-segment')
      .map(s => s.groundingSegmentId);
    expect(physicalIds).not.toContain(BRANCH_EGC_AUTHORITY_GROUP_ID);
  });

  it('gate 11 — every PHYSICAL grounding id is unique across the projection', () => {
    const physical = projectGroundingSegments(PKG.snap)
      .filter(s => s.identityKind === 'physical-segment')
      .map(s => s.groundingSegmentId);
    expect(new Set(physical).size).toBe(physical.length);
  });

  it('gate 11 ANTI-VACUITY — at least THREE distinct physical grounding ids RENDER', () => {
    // The historical failure this probe exists for: the artifact rendered
    // `gnd-br-1` ×8 and gnd-br-2 / gnd-br-3 ZERO times, so a uniqueness assertion
    // over rendered ids could not fail. Uniqueness alone is not the property —
    // the three canonical objects must each RENDER their own identity.
    const rendered = attrValues(PKG.html, 'data-grounding-segment-id');
    const distinct = [...new Set(rendered)];
    expect(distinct.length).toBeGreaterThanOrEqual(3);
    for (const id of ['gnd-br-1', 'gnd-br-2', 'gnd-br-3']) {
      expect(PKG.html).toContain(`data-grounding-segment-id="${id}"`);
    }
    // the grouped authority renders too, tagged as a GROUP, exactly once
    expect(attrValues(PKG.html, 'data-grounding-identity-kind')
      .filter(v => v === 'group-authority').length).toBe(1);
  });

  it("E-1's three branch rows each carry their OWN physical segment id", () => {
    const branchSections = projectE1PhysicalSchedule(PKG.snap)
      .filter(s => s.sectionId === 'BRANCH_RUN');
    expect(branchSections.length).toBe(3);
    const ids = branchSections.map(s => s.groundingSegmentId);
    expect(ids).toEqual(['gnd-br-1', 'gnd-br-2', 'gnd-br-3']);
    expect(new Set(ids).size).toBe(3);
    // and each reconciles to the ONE shared authority result
    for (const s of branchSections) {
      expect(s.groundingAuthorityGroupId).toBe(BRANCH_EGC_AUTHORITY_GROUP_ID);
    }
  });

  it('every rendered grounding row reconciles to exactly ONE canonical object', () => {
    const segs = projectGroundingSegments(PKG.snap);
    const e1 = projectE1PhysicalSchedule(PKG.snap).filter(s => s.groundingSegmentId);
    const canonicalIds = new Set([
      ...segs.map(s => s.groundingSegmentId),
      ...(PKG.snap.electrical?.groundingObjects ?? []).map(g => g.groundingId),
      // the E-1 sectioned schedule's own projected per-raceway ids
      ...e1.map(s => s.groundingSegmentId as string),
    ]);
    for (const id of attrValues(PKG.html, 'data-grounding-segment-id')) {
      expect(id).not.toBe('');
      expect(canonicalIds.has(id)).toBe(true);
    }
    // a group tag always names a group node that exists
    for (const gid of attrValues(PKG.html, 'data-grounding-authority-group')) {
      expect(segs.some(s => s.identityKind === 'group-authority'
        && s.groundingSegmentId === gid)).toBe(true);
    }
  });

  it('RENDERED distinct physical ids == EVIDENCE physical ids (no collapse, no invention)', () => {
    const evidencePhysical = new Set(projectGroundingSegments(PKG.snap)
      .filter(s => s.identityKind === 'physical-segment')
      .map(s => s.groundingSegmentId));
    // the three branch segments render on E-1, not in the PV-4B group row
    for (const id of ['gnd-br-1', 'gnd-br-2', 'gnd-br-3']) evidencePhysical.add(id);
    // plus the E-1 sectioned schedule's own projected per-raceway / service-bond
    // ids (each carries its own raceway, length, NEC basis and BOM derivation —
    // see the HOME-RUN-EGC-PROMOTION follow-up in the PPC evidence artifacts)
    for (const s of projectE1PhysicalSchedule(PKG.snap)) {
      if (s.groundingSegmentId) evidencePhysical.add(s.groundingSegmentId);
    }
    const renderedPhysical = new Set(
      attrValues(PKG.html, 'data-grounding-segment-id')
        .filter(id => id !== BRANCH_EGC_AUTHORITY_GROUP_ID));
    for (const id of renderedPhysical) expect(evidencePhysical.has(id)).toBe(true);
    for (const id of ['gnd-br-1', 'gnd-br-2', 'gnd-br-3']) {
      expect(renderedPhysical.has(id)).toBe(true);
    }
  });

  it('PV-4B labels the grouped row VISIBLY as a group-authority row', () => {
    const pv4b = sheetWith(PKG.html, 'data-grounding-identity-kind="group-authority"');
    expect(pv4b).not.toBe('');
    const t = text(pv4b);
    expect(t).toContain('GROUP AUTHORITY');
    expect(pv4b).toContain(`data-grounding-identity-kind="group-authority"`);
    expect(pv4b).toContain(`data-grounding-branch-scope=`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §7 — BONDING REQUIREMENT vs METHOD (gate 13)
// ═══════════════════════════════════════════════════════════════════════════
describe('ECD §7 — a pending racking assembly cannot assert integrated UL 2703 bonding', () => {
  it('the canonical authority resolves METHOD_PENDING_ASSEMBLY_SELECTION on this design', () => {
    const b = projectRackingBondingAuthority(PKG.snap);
    expect(b.result).toBe('METHOD_PENDING_ASSEMBLY_SELECTION');
    expect(b.verificationState).not.toBe('verified');
    // honest nulls — nothing invented while pending
    expect(b.bondingMethod).toBeNull();
    expect(b.selectedAssemblyId).toBeNull();
    expect(b.ul2703ListingSource).toBeNull();
    expect(b.compatibleModuleFrame).toBeNull();
    expect(b.compatibleRailOrMount).toBeNull();
    expect(b.selectedBondingComponents).toEqual([]);
    expect(b.bomLineIds).toEqual([]);
    // the REQUIREMENT is never gated
    expect(b.bondingRequired).toBe(true);
    expect(b.requirementCodeBasis).toBe(BONDING_REQUIREMENT_CODE_BASIS);
    expect(b.methodLabel).toBe(BONDING_METHOD_PENDING_LABEL);
    expect(b.reasons.length).toBeGreaterThan(0);
  });

  it('gate 13 — the banned method claims appear NOWHERE in the package', () => {
    const t = text(PKG.html);
    expect(t).not.toMatch(/UL 2703 INTEGRATED/i);
    expect(t).not.toMatch(/BONDING JUMPER/i);
    expect(t).not.toMatch(/bonding hardware selected/i);
    // and the specific literal that survived four campaigns
    expect(PKG.html).not.toContain('UL 2703 INTEGRATED — NEC 690.43');
  });

  it('ALL FOUR literal sites now project the authority', () => {
    // 1+2 PV-3 hardware schedule (both branches share one projected row)
    const pv3 = text(sheetWith(PKG.html, 'ATTACHMENT DETAIL'));
    expect(pv3).toContain('BONDING METHOD');
    expect(pv3).toContain('PENDING VERIFIED RACKING ASSEMBLY');
    expect(pv3).toContain(BONDING_REQUIREMENT_CODE_BASIS);
    // 3 the PV-3 callout ⑦ (drafting composition) — no jumper claim
    expect(pv3).not.toMatch(/JUMPER/i);
    // 4 the grounding/bonding SVG detail
    const detail = sheetWith(PKG.html, 'MODULE RAIL');
    expect(detail).toContain(`MODULE RAIL — BONDED PER ${BONDING_REQUIREMENT_CODE_BASIS}`);
    expect(detail).toContain('data-bonding-result="METHOD_PENDING_ASSEMBLY_SELECTION"');
    // 5 the APP-A listing row (the fail-OPEN 'UL 2703' default)
    const appA = sheetWith(PKG.html, 'data-app-a-source="racking-assembly"');
    expect(appA).toContain('data-app-a-bonding-result="METHOD_PENDING_ASSEMBLY_SELECTION"');
  });

  it('the general NEC bonding REQUIREMENT language is PRESERVED', () => {
    const t = text(PKG.html);
    expect(t).toMatch(/BONDING PER NEC 250 AND 690\.43/);
    expect(t).toContain('BONDING REQUIRED');
  });

  it('the source literals are DELETED from the four emitters', () => {
    for (const f of [
      'lib/drafting/templates/roof.ts',
      'lib/drafting/sheetComposition.ts',
      'lib/permit/sections/electricalPages.ts',
    ]) {
      const src = fs.readFileSync(f, 'utf8');
      // the historical strings survive only inside explanatory comments; no
      // executable string literal may still carry them.
      const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect(code).not.toContain(`'UL 2703 INTEGRATED — NEC 690.43'`);
      expect(code).not.toContain(`'BONDING JUMPER'`);
    }
  });

  it('gate 13 NON-VACUITY — a synthetic VERIFIED assembly renders the verified wording', () => {
    const verified = buildRackingBondingAuthority({
      assembly: {
        ...(PKG.snap.structural.rackingAssembly as any),
        mountSku: 'SYNTHETIC-MOUNT-SKU',
        railSku: 'SYNTHETIC-RAIL-SKU',
        railModel: 'XR100',
        railManufacturer: 'IronRidge',
        ul2703ListingBasis: 'SYNTHETIC UL 2703 FILE REF (TEST HARNESS — NOT REAL EVIDENCE)',
        assemblySupported: true,
        assemblyVerification: { overall: 'verified', fastener: 'verified', railSku: 'verified' },
      },
      documentApplicability: {
        state: 'APPLICABLE', applicabilityVerified: true,
        documentTitle: 'SYNTHETIC INSTALL MANUAL (TEST HARNESS)',
      },
      moduleFrame: 'Q.PEAK DUO BLK ML-G10+',
    });
    expect(verified.result).toBe('INTEGRATED_LISTED_BONDING_VERIFIED');
    expect(verified.verificationState).toBe('verified');
    expect(verified.bondingMethod).toBe('integrated-listed');
    expect(verified.methodShortLabel).toBe('UL 2703 INTEGRATED BONDING — VERIFIED');
    expect(verified.ul2703ListingSource).toContain('UL 2703');
    expect(verified.compatibleRailOrMount).toContain('XR100');
    expect(verified.reasons).toEqual([]);
    // …and one missing precondition drops it straight back to PENDING
    const noListing = buildRackingBondingAuthority({
      assembly: {
        ...(PKG.snap.structural.rackingAssembly as any),
        mountSku: 'SYNTHETIC-MOUNT-SKU', railSku: 'SYNTHETIC-RAIL-SKU', railModel: 'XR100',
        ul2703ListingBasis: null, groundingBonding: null, assemblySupported: true,
        assemblyVerification: { overall: 'verified' },
      },
      documentApplicability: {
        state: 'APPLICABLE', applicabilityVerified: true, documentTitle: 'SYNTHETIC',
      },
    });
    expect(noListing.result).toBe('METHOD_PENDING_ASSEMBLY_SELECTION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §8 — APP-A DOCUMENT STATES (gates 14 + 15)
// ═══════════════════════════════════════════════════════════════════════════
describe('ECD §8 — APP-A cannot globally approve; archived ≠ applicable', () => {
  it('the seven document states exist as an enum', () => {
    expect([...DOCUMENT_APPLICABILITY_STATES].sort()).toEqual([
      'APPLICABLE', 'ARCHIVED', 'AUTHORITATIVE', 'NOT_APPLICABLE',
      'PENDING_APPLICABILITY', 'SUPERSEDED', 'VERIFIED',
    ]);
  });

  it('gate 14 — the blanket approval sentence is GONE and the conclusion is registry-derived', () => {
    const t = text(PKG.html);
    expect(t).not.toMatch(/All equipment is CEC Listed, UL Listed, and approved for grid interconnection/i);
    // no blanket-approval phrasing survives anywhere in the package
    expect(t).not.toMatch(/all equipment is[^.]{0,60}approved/i);
    const conclusion = projectEquipmentListingConclusion(PKG.snap);
    expect(conclusion.established).toBe(false);
    expect(conclusion.openCodes.length).toBeGreaterThan(0);
    expect(conclusion.sentence).toBe(EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE);
    expect(t).toContain(EQUIPMENT_LISTING_NOT_ESTABLISHED_SENTENCE);
    expect(PKG.html).toContain('data-app-a-listing-conclusion="NOT_ESTABLISHED"');
  });

  it('gate 14 — the conclusion FAILS CLOSED with no snapshot, and can turn positive only when clear', () => {
    const none = projectEquipmentListingConclusion(null);
    expect(none.registryRead).toBe(false);
    expect(none.established).toBe(false);
    // a synthetic snapshot with an EMPTY registry is the only positive path
    const clear = clone(PKG.snap) as any;
    clear.permitReadiness.registry = [];
    const ok = projectEquipmentListingConclusion(clear as PermitDesignSnapshot);
    expect(ok.established).toBe(true);
    expect(ok.sentence).toBe(EQUIPMENT_LISTING_ESTABLISHED_SENTENCE);
  });

  it('gate 15 — ARCHIVED is never an applicability verdict (the RT-MINI row)', () => {
    const asset = getManufacturerAsset('rooftech-mini', 'racking_detail');
    expect(asset).toBeTruthy();
    const appl = evaluateDocumentApplicability('RT-MINI', asset, null);
    // ARCHIVED yes (a retained copy exists) …
    expect(appl.archived).toBe(true);
    expect(appl.states).toContain('ARCHIVED');
    // … APPLICABLE-TO-RT-MINI pending …
    expect(appl.state).toBe('PENDING_APPLICABILITY');
    expect(appl.applicabilityVerified).toBe(false);
    // … AUTHORITATIVE no.
    expect(appl.authoritative).toBe(false);
    // and the scrape flag is reported under its true name, driving nothing
    expect(appl.sourceUrlConfirmed).toBe(true);
    expect(APPLICABILITY_ESTABLISHED_STATES).not.toContain('ARCHIVED' as DocumentApplicabilityState);
  });

  it('gate 15 — an archived document never becomes AUTHORITATIVE without a content hash', () => {
    const asset = getManufacturerAsset('rooftech-mini', 'racking_detail');
    // archived in repo but NO sha256 ⇒ still not authoritative
    const noHash = evaluateDocumentApplicability('RT-MINI II', asset, null,
      { archivedInRepo: true, sha256: null, status: 'current' });
    expect(noHash.applicabilityVerified).toBe(true);   // the doc IS the II manual
    expect(noHash.authoritative).toBe(false);
    // archived + hashed ⇒ AUTHORITATIVE
    const hashed = evaluateDocumentApplicability('RT-MINI II', asset, null,
      { archivedInRepo: true, sha256: 'a'.repeat(64), status: 'current' });
    expect(hashed.authoritative).toBe(true);
    expect(hashed.state).toBe('AUTHORITATIVE');
    // a SUPERSEDED registry status is never applicable authority
    const superseded = evaluateDocumentApplicability('RT-MINI II', asset, null,
      { archivedInRepo: true, sha256: 'a'.repeat(64), status: 'superseded' });
    expect(superseded.state).toBe('SUPERSEDED');
    expect(superseded.applicabilityVerified).toBe(false);
    expect(superseded.authoritative).toBe(false);
  });

  it('APP-A renders a document-state chip on EVERY cited row — and no positive tick', () => {
    const appA = sheetWith(PKG.html, 'Manufacturer Data Sheets');
    expect(appA).not.toBe('');
    // the retired scrape tick
    expect(appA).not.toContain('✓ on file');
    expect(appA).not.toContain('&check; on file');
    const listItems = (appA.match(/<li><strong>[^<]+:<\/strong>[\s\S]*?<\/li>/g) ?? []);
    expect(listItems.length).toBeGreaterThanOrEqual(3);
    for (const li of listItems) {
      expect(li).toMatch(/data-ds-doc-state="[A-Z_]+"/);
    }
    // the RT-MINI row shows ARCHIVED + PENDING and states NOT AUTHORITATIVE
    const racking = listItems.find(li => /Racking:/.test(li)) ?? '';
    expect(racking).toContain('data-ds-doc-state="ARCHIVED"');
    expect(racking).toContain('data-ds-doc-state="PENDING_APPLICABILITY"');
    expect(text(racking)).toMatch(/NOT AUTHORITATIVE/);
    // applicability is evaluated for MORE than one row (the coverage gap)
    const stateRows = listItems.filter(li => /data-ds-doc-state=/.test(li));
    expect(stateRows.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// §9 — TOPOLOGY / CITATION (gate 16), package-wide
// ═══════════════════════════════════════════════════════════════════════════
describe('ECD §9 (gate 16) — a supply-side package renders no load-side-only citation', () => {
  const LOAD_SIDE_ONLY = /705\.12(\([A-Z]\)[\dA-Za-z()]*)?/;

  it('the design IS supply-side on the canonical record (anti-vacuity)', () => {
    expect(PKG.snap.project.interconnection.rule).toBe('705.11');
    const labels = selectFieldLabels(PKG.input, PKG.input.cad ?? (PKG.input as any).cadModel ?? undefined as any);
    expect(labels.length).toBeGreaterThan(0);
  });

  it('705.12(A) is gone from BOTH sites (data + classifier)', () => {
    // site 1 — the placard dataset
    const json = fs.readFileSync('lib/data/placards/field-placards-research.json', 'utf8');
    const data = JSON.parse(json);
    const tap = data.labels.find((p: any) => p.id === 'line-side-tap-warning');
    expect(tap).toBeTruthy();
    for (const ref of tap.codeRefs) expect(ref.section).not.toMatch(/705\.12/);
    // site 2 — the side classifier's special case
    const src = fs.readFileSync('lib/permit/utils/fieldLabels.ts', 'utf8');
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/705\\\.12\\\(A\\\)[\s\S]{0,40}return 'supply'/);
    // and 705.12(A) classifies LOAD-side now (so it can never survive the filter)
    expect(json).not.toContain('705.12(A)');
  });

  it('no rendered PLACARD code-ref cell carries a load-side-only citation', () => {
    // The PV-5 placard schedule was outside the old gate's reach: its code-ref
    // cells were untagged. They now carry the label's own topology classification.
    const pv5 = sheetWith(PKG.html, 'data-label-nec-ref');
    expect(pv5).not.toBe('');
    const cells = (pv5.match(/data-label-nec-ref="([^"]*)"[^>]*data-label-side="([^"]*)"[^>]*data-label-required="([^"]*)"/g) ?? []);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const [, ref, , required] = c.match(/data-label-nec-ref="([^"]*)"[^>]*data-label-side="([^"]*)"[^>]*data-label-required="([^"]*)"/)!;
      if (required !== 'true') continue;
      expect(ref, `required label cites a load-side clause: ${ref}`).not.toMatch(LOAD_SIDE_ONLY);
    }
    expect(pv5).not.toContain('705.12(A)');
  });

  it('the package-wide scan: E-1 / PV-4A / PV-4B / PV-5 / SCHED carry no load-side-only CITATION', () => {
    const targets = ['E-1', 'PV-4A', 'PV-4B', 'PV-5', 'SCHED'];
    for (const p of sheets(PKG.html)) {
      const id = (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '';
      if (!targets.some(t => id.startsWith(t))) continue;
      const t = text(p);
      expect(t, `${id} cites 705.12(A)`).not.toContain('705.12(A)');
      expect(t, `${id} cites 705.12(D)`).not.toMatch(/705\.12\(D\)/);
      expect(t, `${id} cites 705.13`).not.toMatch(/705\.13\b/);
      // a 705.12 mention is allowed ONLY as an explicit non-applicability statement
      for (const m of t.match(/705\.12[^.]{0,80}/g) ?? []) {
        expect(m, `${id}: 705.12 cited as authority — "${m}"`)
          .toMatch(/does not apply|applies only load-side|only load-side|N\/A|not applicable/i);
      }
    }
  });

  it('the evidence JSON carries no 705.12(A) either', () => {
    const f = 'docs/evidence/braidon-label-topology-report.json';
    if (!fs.existsSync(f)) return;   // regenerated by the closer
    expect(fs.readFileSync(f, 'utf8')).not.toContain('705.12(A)');
  });
});
