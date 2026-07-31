// ═══════════════════════════════════════════════════════════════════════════
// P13 CLOSURE — THE CANONICAL CONNECTOR ARCHITECTURE, AND THE IQ8A PRODUCT-
// GROUNDING REQUIREMENT IT CLOSES.
//
// The archived Enphase evidence (IOM-00068-3.0-EN, sha256 65167d4d…) was already
// exactly applicable in every dimension — micro SKU IQ8A-72-2-US, cable SKU
// Q-12-10-240 (part 840-00387), North America, module and mounting scope
// explicitly NOT_APPLICABLE. The verdict stayed PENDING for one reason and one
// reason only: the SELECTED connector architecture was never populated, so the
// dimension the document positively claims had nothing to be tested against.
//
// The architecture is EQUIPMENT IDENTITY. It is now carried by the canonical
// trunk-cable system — the same object that supplies the cable SKU, the branch
// system, the connector family, the terminator, the field-wireable connector
// compatibility and the procurement inputs — onto the selected ListedCableAssembly,
// and from there into the grounding selection. It is never inferred from a
// product name, a display string or a document title, and there is NO default:
// a project with no catalogued trunk system yields null and stays PENDING.
//
// WHAT THIS MAY NOT DO, and is asserted not to do: close the RACKING bonding
// question, choose a rail, populate gnd-array-bond.bondingMethod, change the #12
// calculated minimum or the #10 selected design size, or create an IQ8A
// microinverter EGC.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { pendingGroundingAuthority, syntheticApplicableDoc } from '../fixtures/synthetic-pending-grounding';
import {
  TRUNK_CABLE_SYSTEMS, findTrunkCableSystem, resolveTrunkCablePlan,
} from '@/lib/equipment/trunkCable';
import {
  enphaseProductGroundingEvidence, IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE,
  IQ8_SERIES_IOM_DOCUMENT_ID, IQ8_SERIES_IOM_SHA256,
} from '@/lib/permit/snapshot/enphaseProductGroundingEvidence';
import {
  verifyGroundingDocumentApplicability, outcomeFromDocument, claimed,
} from '@/lib/permit/snapshot/groundingAuthority';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(authority?: unknown) {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = 'design-review';
  const html = generatePermitHTML(input, undefined, (authority ?? null) as any);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot };
}

// ── 1. THE CATALOG CARRIES THE ARCHITECTURE ──────────────────────────────────
describe('the connector architecture is a property of the canonical trunk system', () => {
  it('every catalogued brand declares one, and no two brands share it', () => {
    expect(TRUNK_CABLE_SYSTEMS.length).toBeGreaterThan(1);
    const seen = new Set<string>();
    for (const sys of TRUNK_CABLE_SYSTEMS) {
      expect(sys.connectorArchitecture, `${sys.brand} has no connector architecture`).toBeTruthy();
      expect(seen.has(sys.connectorArchitecture), `${sys.brand} reuses another brand's architecture`).toBe(false);
      seen.add(sys.connectorArchitecture);
    }
  });

  it('the Enphase system IS the Q-Cable drop-connector architecture the archived IOM covers', () => {
    const sys = findTrunkCableSystem('Enphase')!;
    expect(sys.connectorArchitecture).toBe('iq-q-cable-drop-connector');
    expect(sys.connectorArchitecture).toBe(IQ8_SERIES_IOM_CONNECTOR_ARCHITECTURE);
  });

  it('it travels with the SELECTED cable, not with the brand name', () => {
    // the resolver picks the portrait 60/72-cell default for this array; the
    // architecture rides the SAME plan object that carries that SKU.
    const plan = resolveTrunkCablePlan({
      brand: 'Enphase', model: 'IQ8A', deviceCount: 31, orientation: 'portrait',
    })!;
    expect(plan.cable.sku).toBe('Q-12-10-240');
    expect(plan.system.connectorArchitecture).toBe('iq-q-cable-drop-connector');
  });

  it('an uncatalogued brand yields NO system and therefore NO architecture — never a default', () => {
    expect(findTrunkCableSystem('Totally Fictional Microinverters Inc.')).toBeNull();
    expect(resolveTrunkCablePlan({
      brand: 'Totally Fictional Microinverters Inc.', model: 'X', deviceCount: 10, orientation: 'portrait',
    })).toBeNull();
  });
});

// ── 2. THE SNAPSHOT DERIVES IT FROM THE SELECTED ASSEMBLY ────────────────────
describe('the snapshot derives the architecture from the canonical selected assembly', () => {
  const { snap } = gen();

  it('the listed cable assembly carries the architecture of its own trunk system', () => {
    const asm = snap.electrical.listedCableAssembly!;
    expect(asm.sku).toBe('Q-12-10-240');
    expect(asm.connectorArchitecture).toBe(findTrunkCableSystem(asm.manufacturer)!.connectorArchitecture);
  });

  it('the grounding selection reads the SAME object that supplies the cable SKU', () => {
    const auth = snap.electrical.openAirGroundingAuthority!;
    const asm = snap.electrical.listedCableAssembly!;
    expect(auth.selectedCableAssemblySku).toBe(asm.sku);
    expect(auth.selectedConnectorArchitecture).toBe(asm.connectorArchitecture);
    expect(auth.selectedMicroinverterSku).toBe('IQ8A-72-2-US');
  });
});

// ── 3. THE MISMATCH CASES STILL FAIL CLOSED ──────────────────────────────────
describe('integrated-MC4 is a DIFFERENT architecture and can never establish this method', () => {
  it('the evidence accessor refuses to return the document for another architecture', () => {
    expect(enphaseProductGroundingEvidence('IQ8A', 'integrated-mc4')).toBeNull();
    expect(enphaseProductGroundingEvidence('IQ8A', 'iq-q-cable-drop-connector')).not.toBeNull();
  });

  it('a document claiming integrated-mc4 is NOT APPLICABLE to a Q-Cable branch', () => {
    const doc = syntheticApplicableDoc({
      applicabilityOver: { connectorArchitectures: claimed('integrated-mc4') },
    });
    const v = verifyGroundingDocumentApplicability(doc, {
      microSku: 'IQ8A-72-2-US', cableSku: 'Q-12-10-240', moduleSku: null,
      mountingBondingSystem: null, jurisdiction: 'ALL US NEC JURISDICTIONS',
      connectorArchitecture: 'iq-q-cable-drop-connector',
    });
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/connector architecture/i);
    expect(outcomeFromDocument(doc, v)).toBe('PENDING_MANUFACTURER_AUTHORITY');
  });

  it('an unpopulated architecture is still a failure — the original PENDING cause', () => {
    const doc = syntheticApplicableDoc();
    const v = verifyGroundingDocumentApplicability(doc, {
      microSku: 'IQ8A-72-2-US', cableSku: 'Q-12-10-240', moduleSku: null,
      mountingBondingSystem: null, jurisdiction: 'ALL US NEC JURISDICTIONS',
      connectorArchitecture: null,
    });
    expect(v.verdict).toBe('not-applicable');
    expect(outcomeFromDocument(doc, v)).toBe('PENDING_MANUFACTURER_AUTHORITY');
  });

  it('the package built with a wrong-architecture document stays PENDING end to end', () => {
    const { snap } = gen(pendingGroundingAuthority('wrongConnectorArchitecture'));
    expect(snap.electrical.openAirGroundingAuthority!.outcome).toBe('PENDING_MANUFACTURER_AUTHORITY');
    expect(snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code))
      .toContain('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
  });
});

// ── 4. THE CLOSURE ───────────────────────────────────────────────────────────
describe('IQ8A PRODUCT grounding closes on the archived evidence', () => {
  const { snap } = gen();
  const auth = snap.electrical.openAirGroundingAuthority!;
  const open = snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);

  it('outcome NO_SEPARATE_EGC_REQUIRED, verdict applicable, zero failures', () => {
    expect(auth.outcome).toBe('NO_SEPARATE_EGC_REQUIRED');
    expect(auth.applicabilityVerification.verdict).toBe('applicable');
    expect(auth.applicabilityVerification.failures).toEqual([]);
  });

  it('it closed on the REAL archived document, by hash', () => {
    expect(auth.documentId).toBe(IQ8_SERIES_IOM_DOCUMENT_ID);
    expect(auth.documentHash).toBe(IQ8_SERIES_IOM_SHA256);
    expect(auth.applicabilityVerification.scopeIsExactSku).toBe(true);
    expect(auth.applicabilityVerification.microSkuExactMatch).toBe(true);
    expect(auth.applicabilityVerification.cableSkuExactMatch).toBe(true);
  });

  it('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED is CLOSED', () => {
    expect(open).not.toContain('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
  });
});

// ── 5. AUTHORITY SEPARATION — WHAT THE CLOSURE MAY NOT TOUCH ─────────────────
describe('the product closure does not leak into the racking authority', () => {
  const { snap } = gen();
  const open = snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);
  const bond = snap.electrical.groundingObjects.find(g => g.groundingId === 'gnd-array-bond')!;

  it('the racking-selection and equipment-document requirements stay OPEN', () => {
    expect(open).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
    expect(open).toContain('EQUIPMENT-DOCUMENT-APPLICABILITY');
  });

  it('gnd-array-bond.bondingMethod stays null until the racking assembly is verified', () => {
    expect(bond.bondingMethod).toBeNull();
    expect(bond.manufacturerEvidenceId).toBeNull();
  });

  it('the #12 calculated minimum and the #10 selected design size are unchanged', () => {
    expect(bond.calculatedMinimumSize).toBe('#12 AWG');
    expect(bond.selectedDesignSize).toBe('#10 AWG');
    expect(bond.conductorSize).toBe('#10 AWG');
    expect(bond.selectionSource).toBe('project-design-standard');
  });

  it('no rail is silently selected', () => {
    const ra = snap.structural.rackingAssembly as unknown as { railSku: string | null; railModel: string };
    expect(ra.railSku).toBeNull();
    expect(String(ra.railModel)).toMatch(/PENDING/i);
  });

  it('NO IQ8A microinverter EGC is created — the document says none is required', () => {
    const micro = snap.electrical.groundingObjects
      .filter(g => /micro|inverter/i.test(`${g.sourceNode ?? ''} ${g.destinationNode ?? ''} ${g.segmentRole ?? ''}`));
    for (const g of micro) {
      expect(g.groundingId).not.toMatch(/iq8a|microinverter-egc/i);
    }
    // and the open-air branch object asserts no installed conductor
    const branch = snap.electrical.groundingObjects.find(g => g.purpose === 'branch-egc');
    if (branch) expect(branch.groundingId).not.toMatch(/iq8a/i);
  });

  it('the array/rack bonding segment keeps its own canonical identity', () => {
    expect(bond.segmentRole).toBe('ARRAY_RACK_BONDING_EGC');
    expect(bond.installationMethod).toBe('free-air');
    expect(bond.sourceNode).toMatch(/module frames and racking/i);
    expect(bond.destinationNode).toMatch(/junction box equipment-ground bus/i);
  });
});
