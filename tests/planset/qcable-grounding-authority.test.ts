// ═══════════════════════════════════════════════════════════════════════════
// Q-CABLE GROUNDING AUTHORITY — the TEN mandated regression tests (2026-07-25).
//
// Ray's correction: conductor count alone is NOT manufacturer or code authority.
// A listed two-conductor cable assembly serving a double-insulated (Class II)
// microinverter system may intentionally require NO additional equipment
// grounding conductor. Only the EXACT selected equipment's manufacturer documents
// decide, and the resolution must be specific to the selected micro SKU + cable
// SKU + module + mounting/bonding system + project jurisdiction.
//
//   1  a 2-conductor assembly ALONE can never select SEPARATE_EGC_REQUIRED
//   2  an exact, verified document CAN select NO_SEPARATE_EGC_REQUIRED
//   3  an exact, verified document CAN select SEPARATE_EGC_REQUIRED
//   4  a missing / mismatched document ⇒ PENDING_MANUFACTURER_AUTHORITY
//   5  an IQ-Commercial QD-Cable document cannot clear residential IQ8A/Q-Cable
//   6  PENDING ⇒ the candidate EGC row is NON-ORDERABLE (design quantity)
//   7  all SEVEN surfaces render the SAME outcome
//   8  racking / module-frame bonding is INDEPENDENT of the outcome
//   9  report == rendered: zero grounding mismatches
//  10  page-fit + blocker-multiset gates stay green with the new blocker
//
// EVERY document object below is a SYNTHETIC TEST FIXTURE, clearly labelled as
// such. None of it is committed as real manufacturer evidence, and none of it
// reaches a rendered package — the live outcome stays PENDING.
// ═══════════════════════════════════════════════════════════════════════════
import { claimed, notApplicable, unknownCoverage } from '@/lib/permit/snapshot/groundingAuthority';
import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatePermitHTML } from '@/lib/permit';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { projectOpenAirBranchGrounding } from '@/lib/permit/snapshot/electricalProjection';
import {
  resolveOpenAirGroundingAuthority, outcomeFromDocument,
  verifyGroundingDocumentApplicability, buildGroundingDomainGraph,
  GROUNDING_AUTHORITY_BLOCKER_CODE, GROUNDING_PENDING_LABEL, GROUNDING_NON_ORDERABLE_LABEL,
  type GroundingDocumentEvidence, type GroundingSelection, type ResolveGroundingAuthorityArgs,
} from '@/lib/permit/snapshot/groundingAuthority';
import { classifyBlockerSeverity } from '@/lib/permit/snapshot/severityPolicy';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function gen(): { html: string; snap: PermitDesignSnapshot; input: any } {
  const input: any = clone(roofProject);
  input.project = input.project ?? {};
  input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
  const html = generatePermitHTML(input);
  const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
  return { html, snap, input };
}

// ── SYNTHETIC test fixtures (never real evidence) ───────────────────────────
const SELECTION: GroundingSelection = {
  microSku: 'IQ8A-72-2-US',
  cableSku: 'Q-12-10-240',
  moduleSku: 'Q.PEAK DUO BLK ML-G10+ 400',
  mountingBondingSystem: 'RT-MINI',
  jurisdiction: 'Madison County Building & Zoning',
  // P13 — the project's branch cabling architecture is now a verified dimension.
  connectorArchitecture: 'iq-q-cable-drop-connector',
};

/** A SYNTHETIC, clearly-fake exactly-applicable document. */
function syntheticExactDoc(
  method: GroundingDocumentEvidence['statedGroundingMethod'],
  over: Partial<GroundingDocumentEvidence> = {},
): GroundingDocumentEvidence {
  return {
    documentId: 'SYNTHETIC-TEST-DOC-EXACT-0001',
    documentClass: 'microinverter_installation_manual',
    title: 'SYNTHETIC TEST DOCUMENT — NOT REAL MANUFACTURER EVIDENCE',
    revision: 'TEST-REV-0',
    documentHash: '0'.repeat(64),
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',
    sectionOrPage: '§SYNTHETIC-4.2, p.SYNTHETIC-17',
    statedGroundingMethod: method,
    statedText: 'SYNTHETIC TEST TEXT — used only to prove the resolver requires an explicit document statement.',
    equipmentClassification: 'SYNTHETIC: Class II double-insulated (test fixture)',
    applicability: {
      // P13 — coverage dispositions are EXPLICIT. This synthetic doc CLAIMS every
      // dimension, so it exercises the strictest path: each claim must match.
      microinverterSkus: claimed('IQ8A-72-2-US'),
      cableAssemblySkus: claimed('Q-12-10-240'),
      moduleSkus: claimed('Q.PEAK DUO BLK ML-G10+ 400'),
      mountingBondingSystems: claimed('RT-MINI'),
      jurisdictions: claimed('Madison County Building & Zoning'),
      connectorArchitectures: claimed('iq-q-cable-drop-connector'),
      scope: 'exact-sku',
      productLine: 'SYNTHETIC IQ8 residential (test fixture)',
    },
    ...over,
  };
}

/** A SYNTHETIC IQ-Commercial QD-Cable document — different product line, different
 *  cable, family-level scope. It must NEVER clear the residential IQ8A/Q-Cable. */
function syntheticCommercialQdDoc(): GroundingDocumentEvidence {
  return {
    documentId: 'SYNTHETIC-TEST-DOC-COMMERCIAL-QD-0002',
    documentClass: 'microinverter_installation_manual',
    title: 'SYNTHETIC TEST DOCUMENT (IQ Commercial / QD-Cable) — NOT REAL MANUFACTURER EVIDENCE',
    revision: 'TEST-REV-0',
    documentHash: '1'.repeat(64),
    archivedInRepo: true,
    verificationState: 'verified',
    status: 'current',
    sectionOrPage: '§SYNTHETIC-9.1',
    statedGroundingMethod: 'no-additional-equipment-grounding-conductor',
    statedText: 'SYNTHETIC TEST TEXT — commercial QD-Cable guidance.',
    equipmentClassification: 'SYNTHETIC: Class II (test fixture)',
    applicability: {
      microinverterSkus: claimed('IQ8P-3P-72-M-US', 'IQ8H-208-72-2-US'),
      cableAssemblySkus: claimed('QD-CABLE-3P-2M'),
      moduleSkus: claimed('Q.PEAK DUO BLK ML-G10+ 400'),
      mountingBondingSystems: claimed('RT-MINI'),
      jurisdictions: claimed('Madison County Building & Zoning'),
      connectorArchitectures: claimed('qd-cable-3-phase'),
      scope: 'product-line',
      productLine: 'SYNTHETIC IQ Commercial (test fixture)',
    },
  };
}

/** Baseline resolver args for the selected Braidon-shaped design. */
function baseArgs(over: Partial<ResolveGroundingAuthorityArgs> = {}): ResolveGroundingAuthorityArgs {
  return {
    present: true,
    selection: SELECTION,
    equipmentFacts: {
      // THE fact that used to (wrongly) decide the outcome:
      cableConductorConstruction: 'two-wire, double-insulated (factory-connectorized)',
      cableConductorCount: 2,
      equipmentInsulationClassification: null,
    },
    documentEvidence: null,
    conductorMaterial: 'Cu',
    conductorSizeNecDerived: '#12 AWG',
    conductorSizingBasis: 'NEC 250.122 @ 20A branch OCPD',
    branchIds: ['br-1', 'br-2', 'br-3'],
    segmentIds: ['BRANCH_RUN'],
    pathBasis: 'Σ per-branch BranchCablePath',
    designedInstalledFt: 140.5,
    lengthProvenance: 'geometry-derived',
    wasteFactor: 1.15,
    quantityFt: 162,
    ...over,
  };
}

// ── one real rendered package, shared by the rendered-surface tests ─────────
let PKG: { html: string; snap: PermitDesignSnapshot; input: any };
beforeAll(() => { PKG = gen(); });

// ═══ TEST 1 ═════════════════════════════════════════════════════════════════
describe('1 — a 2-conductor assembly ALONE can never select SEPARATE_EGC_REQUIRED', () => {
  it('no equipment fact reaches the outcome selector: outcomeFromDocument takes only the document + applicability', () => {
    // STRUCTURAL PROOF: the selector's arity is 2 (document, applicability). There
    // is no parameter through which a conductor count could ever be supplied.
    expect(outcomeFromDocument.length).toBe(2);
  });

  it('a 2-conductor, double-insulated assembly with NO document resolves to PENDING, not B', () => {
    const r = resolveOpenAirGroundingAuthority(baseArgs());
    expect(r.cableConductorCount).toBe(2);                       // the fact IS recorded
    expect(r.cableConductorConstruction).toMatch(/two-wire/i);
    expect(r.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');    // …and it decides NOTHING
    expect(r.conductorCountIsNonDeterminative).toBe(true);
    expect(r.nonDeterminativeNote).toMatch(/Conductor count alone can never select an outcome/i);
  });

  it('every conductor count resolves to PENDING without a document (1, 2, 3, 4 — no arithmetic path to B)', () => {
    for (const n of [1, 2, 3, 4, null]) {
      const r = resolveOpenAirGroundingAuthority(baseArgs({
        equipmentFacts: {
          cableConductorConstruction: `${n ?? '?'}-conductor test construction`,
          cableConductorCount: n,
          equipmentInsulationClassification: null,
        },
      }));
      expect(r.outcome, `conductorCount=${n}`).toBe('PENDING_MANUFACTURER_AUTHORITY');
    }
  });

  it('a document that states NO method cannot be rescued by the conductor count', () => {
    const doc = syntheticExactDoc(null);
    const applic = verifyGroundingDocumentApplicability(doc, SELECTION);
    expect(applic.statesMethodExplicitly).toBe(false);
    expect(outcomeFromDocument(doc, applic)).toBe('PENDING_MANUFACTURER_AUTHORITY');
  });
});

// ═══ TEST 2 ═════════════════════════════════════════════════════════════════
describe('2 — an exact, verified document CAN select NO_SEPARATE_EGC_REQUIRED (A)', () => {
  it('resolves A, cites the document, and emits NO BOM row for this section', () => {
    const doc = syntheticExactDoc('no-additional-equipment-grounding-conductor');
    const r = resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: doc }));
    expect(r.outcome).toBe('NO_SEPARATE_EGC_REQUIRED');
    expect(r.verificationStatus).toBe('verified-document');
    expect(r.documentId).toBe(doc.documentId);
    expect(r.documentHash).toBe(doc.documentHash);
    expect(r.documentSectionOrPage).toBe(doc.sectionOrPage);
    expect(r.applicabilityVerification.verdict).toBe('applicable');
    expect(r.applicabilityVerification.failures).toEqual([]);
    // no conductor is modeled for this section, and no BOM row is emitted
    expect(r.bomRowState).toBe('no-row');
    expect(r.quantityFt).toBeNull();
    expect(r.conductorSizeNecDerived).toBeNull();
    expect(r.blocking).toBe(false);
    expect(r.blockerCode).toBeNull();
    // the NEC basis is the listed-method basis, not a 250.122 sizing claim
    expect(r.necBasis).toMatch(/110\.3\(B\)/);
    expect(r.necBasis).toMatch(/no additional grounding conductor/i);
    // the equipment classification now comes from the DOCUMENT, not a guess
    expect(r.equipmentInsulationClassification).toBe(doc.equipmentClassification);
  });
});

// ═══ TEST 3 ═════════════════════════════════════════════════════════════════
describe('3 — an exact, verified document CAN select SEPARATE_EGC_REQUIRED (B)', () => {
  it('resolves B with the citation, the NEC 250.122 sizing basis and an ORDERABLE quantity', () => {
    const doc = syntheticExactDoc('additional-equipment-grounding-conductor');
    const r = resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: doc }));
    expect(r.outcome).toBe('SEPARATE_EGC_REQUIRED');
    expect(r.verificationStatus).toBe('verified-document');
    expect(r.documentId).toBe(doc.documentId);
    expect(r.necBasis).toMatch(/250\.122/);
    expect(r.conductorSizeNecDerived).toBe('#12 AWG');
    expect(r.quantityFt).toBe(162);
    expect(r.designedInstalledFt).toBe(140.5);
    expect(r.branchIds).toEqual(['br-1', 'br-2', 'br-3']);
    expect(r.bomRowState).toBe('orderable');
    expect(r.excludedFromProcurementTotals).toBe(false);
    expect(r.blocking).toBe(false);
  });
});

// ═══ TEST 4 ═════════════════════════════════════════════════════════════════
describe('4 — a missing or mismatched document resolves to PENDING (C), fail-closed', () => {
  const cases: { name: string; doc: GroundingDocumentEvidence | null; failMatch: RegExp }[] = [
    { name: 'no document at all', doc: null, failMatch: /no manufacturer document/i },
    {
      name: 'unverified document',
      doc: syntheticExactDoc('additional-equipment-grounding-conductor', { verificationState: 'pending' }),
      failMatch: /verification state/i,
    },
    {
      name: 'superseded document',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', { status: 'superseded' }),
      failMatch: /not 'current'/i,
    },
    {
      name: 'not archived in repo',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', { archivedInRepo: false }),
      failMatch: /not archived/i,
    },
    {
      name: 'no SHA-256',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', { documentHash: null }),
      failMatch: /SHA-256/i,
    },
    {
      name: 'no exact section/page',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', { sectionOrPage: '  ' }),
      failMatch: /section\/page/i,
    },
    {
      name: 'FAMILY-level scope (IQ8 series datasheet)',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, scope: 'family' },
      }),
      failMatch: /family \/ series \/ product-line/i,
    },
    {
      name: 'different micro SKU (IQ8PLUS instead of IQ8A)',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, microinverterSkus: claimed('IQ8PLUS-72-2-US') },
      }),
      failMatch: /selected microinverter/i,
    },
    {
      name: 'different cable SKU',
      doc: syntheticExactDoc('additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, cableAssemblySkus: claimed('Q-12-17-240') },
      }),
      failMatch: /selected cable assembly/i,
    },
    {
      name: 'module not covered',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, moduleSkus: claimed('SOME-OTHER-MODULE-400') },
      }),
      failMatch: /selected module/i,
    },
    {
      name: 'mounting / bonding system not covered',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, mountingBondingSystems: claimed('RT-MINI II') },
      }),
      failMatch: /mounting \/ bonding system/i,
    },
    {
      name: 'jurisdiction not covered',
      doc: syntheticExactDoc('no-additional-equipment-grounding-conductor', {
        applicability: { ...syntheticExactDoc(null).applicability, jurisdictions: claimed('City of Phoenix') },
      }),
      failMatch: /project jurisdiction/i,
    },
  ];

  for (const c of cases) {
    it(`${c.name} ⇒ PENDING with an enumerated failure`, () => {
      const r = resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: c.doc }));
      expect(r.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
      expect(r.verificationStatus).toBe('pending-manufacturer-authority');
      expect(r.blocking).toBe(true);
      expect(r.blockerCode).toBe(GROUNDING_AUTHORITY_BLOCKER_CODE);
      // no document is CITED on a pending record (no half-credit citation)
      expect(r.documentId).toBeNull();
      expect(r.documentHash).toBeNull();
      expect(r.statedGroundingMethod).toBeNull();
      expect(r.applicabilityVerification.failures.join(' | ')).toMatch(c.failMatch);
    });
  }

  it('the PENDING record states what would resolve it and refuses inference explicitly', () => {
    const r = resolveOpenAirGroundingAuthority(baseArgs());
    expect(r.resolutionRequirement).toMatch(/exactly-applicable|EXACT selected equipment/i);
    expect(r.resolutionRequirement).toMatch(/conductor-count inference/i);
    expect(r.renderLabel).toBe(GROUNDING_PENDING_LABEL);
  });
});

// ═══ TEST 5 ═════════════════════════════════════════════════════════════════
describe('5 — an IQ-Commercial QD-Cable document cannot clear the residential IQ8A / Q-Cable', () => {
  it('rejects it on BOTH the product-line scope AND the exact micro/cable SKUs', () => {
    const doc = syntheticCommercialQdDoc();
    const applic = verifyGroundingDocumentApplicability(doc, SELECTION);
    expect(applic.verdict).toBe('not-applicable');
    expect(applic.scopeIsExactSku).toBe(false);
    expect(applic.microSkuExactMatch).toBe(false);
    expect(applic.cableSkuExactMatch).toBe(false);
    // it is a VERIFIED, archived, hashed, current document that states a method —
    // and it STILL cannot decide, because it is not about this equipment.
    expect(applic.documentVerified).toBe(true);
    expect(applic.documentArchived).toBe(true);
    expect(applic.documentHashed).toBe(true);
    expect(applic.statesMethodExplicitly).toBe(true);
    expect(outcomeFromDocument(doc, applic)).toBe('PENDING_MANUFACTURER_AUTHORITY');

    const r = resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: doc }));
    expect(r.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    expect(r.documentId).toBeNull();
  });
});

// ═══ TEST 6 ═════════════════════════════════════════════════════════════════
describe('6 — PENDING ⇒ the candidate open-air EGC row is a NON-ORDERABLE design quantity', () => {
  it('the authority marks the row non-orderable and excluded from procurement totals', () => {
    const r = resolveOpenAirGroundingAuthority(baseArgs());
    expect(r.bomRowState).toBe('design-quantity-non-orderable');
    expect(r.excludedFromProcurementTotals).toBe(true);
    // the calculated quantity is RETAINED so the orderable row regenerates on verification
    expect(r.quantityFt).toBe(162);
  });

  it('the REAL generated BOM row carries nonOrderable + the pending label + a retained quantity', () => {
    const cad = generateCADLayout(PKG.input) as any;
    const bom = generateBOMForPermit(PKG.input, cad);
    const g = projectOpenAirBranchGrounding(PKG.snap);
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    const row = bom.find(i => i.partNumber?.startsWith('GRN-OPENAIR-'));
    expect(row, 'the candidate open-air EGC row must still exist as a design quantity').toBeTruthy();
    expect(row!.nonOrderable).toBe(true);
    expect(row!.quantity).toBe(g.bomFootageFt);
    expect(row!.model).toContain(GROUNDING_NON_ORDERABLE_LABEL);
    expect(row!.description).toMatch(/NOT ORDERABLE/i);
    expect(row!.description).toMatch(/EXCLUDED from procurement totals/i);
    expect(row!.description).toMatch(/NOT\s+determinative/i);
    expect(row!.necReference).toMatch(/110\.3\(B\)/);
    // it is still NOT merged with the in-raceway green-EGC rows (distinct line)
    const inRaceway = bom.filter(i => /Green EGC/i.test(i.model) && !/open-air/i.test(i.model));
    expect(inRaceway.length).toBeGreaterThan(0);
    expect(inRaceway.every(i => i.partNumber !== row!.partNumber)).toBe(true);
  });

  it('the blocker is BLOCKING per the severity policy (all five axes) and fires on the package', () => {
    const c = classifyBlockerSeverity(GROUNDING_AUTHORITY_BLOCKER_CODE);
    expect(c.severity).toBe('blocking');
    expect(c.justification).toBe('');
    const reg = (PKG.snap.permitReadiness?.registry ?? []).filter(r => !r.resolved);
    const entry = reg.find(r => r.code === GROUNDING_AUTHORITY_BLOCKER_CODE);
    expect(entry, 'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED must be an active registry blocker').toBeTruthy();
    expect(entry!.severity).toBe('blocking');
    expect(entry!.domain).toBe('electrical');
    expect(PKG.snap.permitReadiness?.ready).toBe(false);
  });
});

// ═══ TEST 7 ═════════════════════════════════════════════════════════════════
describe('7 — all SEVEN surfaces state the SAME outcome', () => {
  it('E-1 note, E-1 SLD segment, PV-1B, PV-4B, SCHED, BOM and RS-1 agree (and none asserts a method)', () => {
    const noB64 = PKG.html.replace(/data:image[^"')]+/g, '');
    const g = projectOpenAirBranchGrounding(PKG.snap);
    expect(g.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');

    // 1-5: the pending label is rendered on the note surfaces (E-1 / PV-1B / PV-4B / SCHED)
    const labelHits = (noB64.match(new RegExp(GROUNDING_PENDING_LABEL, 'g')) ?? []).length;
    expect(labelHits).toBeGreaterThanOrEqual(4);
    // 2: the E-1 SLD open-air segment prints the pending grounding line, not an EGC
    expect(noB64).toContain('EGC: PENDING MFR AUTHORITY');
    // 6: the BOM row carries the non-orderable label
    expect(noB64).toContain(GROUNDING_NON_ORDERABLE_LABEL);
    // 7: RS-1 carries the blocking registry entry
    expect(noB64).toContain(GROUNDING_AUTHORITY_BLOCKER_CODE);

    // NO surface asserts EITHER grounding method while pending (fail-closed)
    expect(noB64).not.toMatch(/SEPARATE\s+(EQUIPMENT GROUNDING CONDUCTOR|EGC)/i);
    expect(noB64).not.toMatch(/SEPARATE\s+#?\d+[^.]{0,40}EGC/i);
    expect(noB64).not.toMatch(/no (separate |additional )?EGC (is )?required/i);
    expect(noB64).not.toMatch(/NO integrated EGC/i);
    // and no PASS / VERIFIED grounding claim for this section
    expect(noB64).not.toMatch(/grounding[^.<]{0,60}✓\s*PASS/i);
    expect(noB64).not.toMatch(/GROUNDING(?![-A-Z])[^.<]{0,60}(?<![A-Za-z-])VERIFIED/);

    // the E-1 evidence stamp exports the SAME object the sheets rendered
    const m = noB64.match(/data-bar-wse="([^"]*)"/);
    expect(m).toBeTruthy();
    const ev = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'));
    expect(ev.openAirBranchGrounding.outcome).toBe(g.outcome);
    expect(ev.openAirBranchGrounding.renderLabel).toBe(g.renderLabel);
    expect(ev.openAirBranchGrounding.bomRowState).toBe(g.bomRowState);
  });

  it('the in-raceway home-run EGC is UNAFFECTED — it is still rendered and independently required', () => {
    const noB64 = PKG.html.replace(/data:image[^"')]+/g, '');
    const hrEgc = (PKG.snap.electrical.routeSegments ?? [])
      .find(r => r.segmentId === 'BRANCH_HOMERUN_RUN')?.egcGauge;
    expect(hrEgc, 'the shared home-run raceway must still carry its own EGC').toBeTruthy();
    const n = String(hrEgc).replace('#', '').replace(' AWG', '').trim();
    expect(noB64).toContain(`1×#${n} GRN EGC`);
  });
});

// ═══ TEST 8 ═════════════════════════════════════════════════════════════════
describe('8 — racking / module-frame bonding is INDEPENDENT of the grounding outcome', () => {
  it('the bonding requirement is required + independent + hardware-retained under ALL THREE outcomes', () => {
    const outcomes: [string, GroundingDocumentEvidence | null][] = [
      ['A', syntheticExactDoc('no-additional-equipment-grounding-conductor')],
      ['B', syntheticExactDoc('additional-equipment-grounding-conductor')],
      ['C', null],
    ];
    for (const [name, doc] of outcomes) {
      const r = resolveOpenAirGroundingAuthority(baseArgs({ documentEvidence: doc }));
      const b = r.rackingModuleBondingRequirement;
      expect(b.required, name).toBe(true);
      expect(b.independentOfCableGrounding, name).toBe(true);
      expect(b.hardwareRetained, name).toBe(true);
      expect(b.codeBasis, name).toMatch(/690\.43/);
      expect(b.mountingBondingSystem, name).toBe('RT-MINI');
    }
  });

  it('the five grounding domains are separate objects and only the open-air one is governed', () => {
    const graph = (PKG.snap.electrical as any).groundingDomainGraph as any[];
    expect(graph).toHaveLength(5);
    expect(graph.map(d => d.domain).sort()).toEqual([
      'grounding-electrode-conductor',
      'home-run-raceway-egc',
      'open-air-micro-branch-cable-section',
      'racking-module-frame-bonding',
      'service-bonding',
    ]);
    expect(graph.filter(d => d.governedByOpenAirGroundingResolver)).toHaveLength(1);
    expect(graph.find(d => d.domain === 'open-air-micro-branch-cable-section')!.governedByOpenAirGroundingResolver).toBe(true);
    // (b) the in-raceway home-run EGC — independently required, own basis, KEPT
    const hr = graph.find(d => d.domain === 'home-run-raceway-egc')!;
    expect(hr.required).toBe(true);
    expect(hr.basis).toMatch(/250\.122/);
    expect(hr.basis).toMatch(/wiring-method/i);
    expect(hr.independenceNote).toMatch(/NOT affected by the open-air grounding outcome/i);
    // (c) racking bonding, (d) GEC, (e) service bonding — none governed by the resolver
    for (const d of graph.filter(x => x.domain !== 'open-air-micro-branch-cable-section')) {
      expect(d.governedByOpenAirGroundingResolver, d.domain).toBe(false);
    }
  });

  it('the domain graph never lets the open-air outcome leak into another domain', () => {
    const g = buildGroundingDomainGraph({
      outcome: 'NO_SEPARATE_EGC_REQUIRED',
      openAirLabel: 'LISTED METHOD',
      homeRunEgcSize: '#12 AWG',
      homeRunRacewayLabel: 'PVC Sch 80 1-1/4"',
      homeRunPresent: true,
      bonding: resolveOpenAirGroundingAuthority(baseArgs()).rackingModuleBondingRequirement,
      gecRequired: false,
      gecBasis: 'NEC 250.64 / 690.47',
    });
    // outcome A does NOT switch off the raceway EGC or the bonding requirement
    expect(g.find(d => d.domain === 'home-run-raceway-egc')!.required).toBe(true);
    expect(g.find(d => d.domain === 'racking-module-frame-bonding')!.required).toBe(true);
    expect(g.find(d => d.domain === 'open-air-micro-branch-cable-section')!.required).toBe(false);
  });
});

// ═══ TESTS 9 + 10 ═══════════════════════════════════════════════════════════
// The rendered-truth harness owns both: gate 12 = report-equals-rendered (zero
// mismatches), gate 13 = page-fit (true geometry), gate 1 = blocker multiset
// across every surface. Run it on THIS package so the tests fail if any of them
// regress — never a re-implementation of the gate inside the test.
describe('9 + 10 — report==rendered (0 mismatches), page-fit and blocker-multiset gates', () => {
  it('the BAR rendered-truth harness passes every gate on the generated package', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcable-gnd-'));
    const htmlPath = path.join(dir, 'pkg.html');
    const snapPath = path.join(dir, 'pkg.snapshot.json');
    const outPath = path.join(dir, 'pkg.evidence.json');
    fs.writeFileSync(htmlPath, PKG.html);
    fs.writeFileSync(snapPath, JSON.stringify(PKG.snap));

    const res = spawnSync(process.execPath,
      [path.resolve(process.cwd(), 'scripts/planset-evidence-bar.mjs'), htmlPath, snapPath, outPath],
      { encoding: 'utf8', timeout: 300_000 });

    const report = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
    expect(report, `harness produced no report — ${String(res.stderr).slice(0, 400)}`).toBeTruthy();
    const byGate = (n: number) => report.gates.find((g: any) => g.gate === n);

    // TEST 9 — report == rendered, ZERO mismatches (gate 12)
    const g12 = byGate(12);
    expect(g12, 'gate 12 must run').toBeTruthy();
    expect(g12.evidence?.mismatches ?? [], JSON.stringify(g12.evidence?.mismatches ?? [])).toHaveLength(0);
    expect(g12.ok).toBe(true);

    // TEST 10 — page-fit (gate 13) + blocker multiset across surfaces (gate 1)
    expect(byGate(13).ok, `page-fit: ${byGate(13).detail}`).toBe(true);
    expect(byGate(1).ok, `multiset: ${byGate(1).detail}`).toBe(true);
    // …and the grounding gates themselves (6, 7)
    expect(byGate(6).ok, `gate 6: ${byGate(6).detail}`).toBe(true);
    expect(byGate(7).ok, `gate 7: ${byGate(7).detail}`).toBe(true);
    // nothing else regressed
    expect(report.gates.filter((g: any) => !g.ok).map((g: any) => g.gate)).toEqual([]);
  }, 420_000);
});
