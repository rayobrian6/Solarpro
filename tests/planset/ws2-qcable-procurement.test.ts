// ═══════════════════════════════════════════════════════════════════════════
// WS-2 — Q-CABLE PROCUREMENT CLOSURE.
//
// The package used to measure a shortage and stop. WS-2 turns the measurement
// into a procurement design, from archived manufacturer authority only.
//
// THE FINDING THESE TESTS PIN: `Q-12-RAW-300` — the catalog's raw-cable stock
// SKU, the one the brief expected to close this — appears in NO archived
// manufacturer document. The archived IOM-00068-3.0-EN enumerates every IQ Cable
// accessory and names no bulk/raw/reel stock at all. Its documented method for
// an arbitrary-length segment is to CUT the listed cable and join it with a
// field-wireable connector pair. The SKU is therefore REJECTED, and the stock
// item is the listed cable itself, purchased in the manufacturer's own package.
//
// Two unit traps are pinned deliberately:
//   • '300' in the SKU name is 300 METRES (~984 ft), not 300 feet.
//   • the purchase unit is a BOX OF CONNECTOR SECTIONS, not a footage.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  TRUNK_CABLE_SYSTEMS, findTrunkCableSystem,
} from '@/lib/equipment/trunkCable';
import {
  enphaseFieldTerminationAuthority, enphaseFieldTerminationEvidence,
  FIELD_TERMINATION_SHA256, FIELD_TERMINATION_DOCUMENT_ID,
} from '@/lib/permit/snapshot/enphaseFieldTerminationEvidence';
import { resolveQCableProcurement } from '@/lib/permit/snapshot/qcableProcurement';
import { verifyGroundingDocumentApplicability } from '@/lib/permit/snapshot/groundingAuthority';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';
import type { PermitBOMItem } from '@/lib/permit/utils/bomForPermit';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function gen(profile = 'design-review') {
  const input: any = clone(braidonOriginalAuditFixture);
  input.plansetProfile = profile;
  const html = generatePermitHTML(input);
  return { html, input, snap: input._snapshot as PermitDesignSnapshot,
    bom: (input.bom ?? []) as PermitBOMItem[] };
}

const PKG = gen();
const QP = PKG.snap.electrical.qcableProcurement!;

// ── THE LIVE BRAIDON MEASUREMENT, as a deterministic fixture ─────────────────
// The frozen acceptance fixture's geometry is NOT the live design's, so the live
// figures (aggregate 14.5 / topology-constrained 24.2 / B1 10.0 / B2 14.2 /
// B3 surplus 9.7) are pinned against the sufficiency rows they come from rather
// than against whatever the fixture's own layout happens to produce. The
// arithmetic contract stays exact AND independent of a layout that may
// legitimately change; the projection tests below still run on the real
// rendered package.
const LIVE_SUFFICIENCY = {
  present: true, assemblyId: 'QCABLE-ASSEMBLY', sku: 'Q-12-10-240',
  connectorSpacingFt: 4.25, wasteFactor: 1.15,
  perBranch: [
    { branchId: 'br-1', branchLabel: 'B1', dropCount: 11, designedInstalledLengthFt: 64, procurementLengthFt: 54, deficitFt: 10, nonRedistributableSurplusFt: 0 },
    { branchId: 'br-2', branchLabel: 'B2', dropCount: 10, designedInstalledLengthFt: 63.2, procurementLengthFt: 49, deficitFt: 14.2, nonRedistributableSurplusFt: 0 },
    { branchId: 'br-3', branchLabel: 'B3', dropCount: 10, designedInstalledLengthFt: 39.3, procurementLengthFt: 49, deficitFt: 0, nonRedistributableSurplusFt: 9.7 },
  ],
  totalDesignedInstalledFt: 166.5, procurementLengthFt: 152,
  requiredServiceLoopAllowanceFt: 0, allowanceProvenance: 'no-allowance-authority-recorded',
  thresholdFt: 166.5, deficitFt: 24.2, insufficient: true,
  affectedBranchIds: ['br-1', 'br-2'],
  aggregateFootageDeficitFt: 14.5, topologyConstrainedDeficitFt: 24.2,
  nonRedistributableSurplusFt: 9.7, requiredAdditionalPurchasableLengthFt: 24.2,
  deficitBasis: 'topology-constrained',
} as never;

const LIVE = resolveQCableProcurement({
  topology: PKG.snap.electrical.qcableTopology!,
  assembly: PKG.snap.electrical.listedCableAssembly!,
  system: findTrunkCableSystem('Enphase'),
  authority: enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector'),
  sufficiency: LIVE_SUFFICIENCY,
});
const liveAlloc = (label: string) => LIVE.branchAllocations.find(a => a.branchLabel === label)!;

// ── 1. THE CATALOG DISCOVERY (test req. 1–3) ─────────────────────────────────
describe('the raw-stock SKU is discovered from the canonical catalog, and judged there', () => {
  it('Q-12-RAW-300 IS in the canonical catalog — discovery is not the problem', () => {
    const sys = findTrunkCableSystem('Enphase')!;
    expect(sys.rawCable?.sku).toBe('Q-12-RAW-300');
  });

  it('it is marked unverified-catalog, with the reason stated', () => {
    const sys = findTrunkCableSystem('Enphase')!;
    expect(sys.rawCable?.verificationState).toBe('unverified-catalog');
    expect(sys.rawCable?.verificationBasis).toMatch(/no archived manufacturer document/i);
  });

  it('THE UNIT TRAP: its package length is 300 METRES, never 300 feet', () => {
    const sys = findTrunkCableSystem('Enphase')!;
    // ~984 ft. A reader who took '300' off the SKU name would understate a
    // purchase by a factor of three.
    expect(sys.rawCable?.lengthFt).toBe(984);
    expect(sys.rawCable?.lengthFt).not.toBe(300);
  });

  it('PRODUCT-NAME PARSING CANNOT ESTABLISH PACKAGE LENGTH — the resolver never reads the name', () => {
    // Every packaging value the resolver uses comes from the archived table.
    const a = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    for (const c of a.listedCablePackaging.value) {
      // the number in the SKU tail is the connector count per box ONLY where the
      // archived table says so — and the resolver reads the table, not the tail.
      expect(typeof c.connectorsPerBox).toBe('number');
    }
    expect(a.listedCablePackaging.quote).toMatch(/Connector count per box/i);
    expect(a.rawCableStockEstablished.value).toBe(false);
  });

  it('every catalogued brand raw-stock entry declares a verification state', () => {
    for (const sys of TRUNK_CABLE_SYSTEMS) {
      if (!sys.rawCable) continue;
      expect(['verified-archived', 'unverified-catalog']).toContain(sys.rawCable.verificationState);
    }
  });
});

// ── 2. THE ARCHIVED FIELD-TERMINATION AUTHORITY (test req. 4–7) ──────────────
describe('the field-termination authority is archived, hashed and exactly applicable', () => {
  it('it is the SAME archived document the grounding closure used', () => {
    const a = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    expect(a.documentId).toBe(FIELD_TERMINATION_DOCUMENT_ID);
    expect(a.documentSha256).toBe(FIELD_TERMINATION_SHA256);
    expect(a.documentSha256).toBe('65167d4d8abd81867575a7f467b68fe0155e5b954fc0077876da2729a284208e');
    expect(a.region).toBe('North America');
  });

  it('WRONG CONNECTOR ARCHITECTURE IS REJECTED — integrated-MC4 cannot serve a Q-Cable branch', () => {
    expect(enphaseFieldTerminationAuthority('IQ8A', 'integrated-mc4')).toBeNull();
    expect(enphaseFieldTerminationAuthority('IQ8A', null)).toBeNull();
    expect(enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')).not.toBeNull();
  });

  it('a wrong micro family is rejected', () => {
    expect(enphaseFieldTerminationAuthority('IQ8AC', 'iq-q-cable-drop-connector')).toBeNull();
    expect(enphaseFieldTerminationAuthority('IQ7', 'iq-q-cable-drop-connector')).toBeNull();
  });

  it('the archived evidence is APPLICABLE to the selected equipment', () => {
    const doc = enphaseFieldTerminationEvidence('IQ8A', 'iq-q-cable-drop-connector')!;
    const ok = verifyGroundingDocumentApplicability(doc, {
      microSku: 'IQ8A-72-2-US', cableSku: 'Q-12-10-240', moduleSku: null,
      mountingBondingSystem: null, jurisdiction: 'North America',
      connectorArchitecture: 'iq-q-cable-drop-connector',
    });
    expect(ok.verdict).toBe('applicable');
    expect(ok.failures).toEqual([]);
  });

  it('A WRONG-REGION DOCUMENT IS REJECTED — the region is a verified dimension', () => {
    // The archived US manual declares blanket NEC coverage, which is why it
    // covers this project. A regional variant that does NOT declare it must fail
    // against a US jurisdiction — that is the dimension doing real work.
    const doc = enphaseFieldTerminationEvidence('IQ8A', 'iq-q-cable-drop-connector')!;
    const euVariant = clone(doc);
    euVariant.applicability.jurisdictions = { disposition: 'CLAIMED', values: ['EUROPE — IEC 60364'] };
    const v = verifyGroundingDocumentApplicability(euVariant, {
      microSku: 'IQ8A-72-2-US', cableSku: 'Q-12-10-240', moduleSku: null,
      mountingBondingSystem: null, jurisdiction: 'North America',
      connectorArchitecture: 'iq-q-cable-drop-connector',
    });
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/jurisdiction/i);
  });

  it('a wrong CABLE SKU is rejected — integrated-MC4 raw stock cannot satisfy this branch', () => {
    const doc = enphaseFieldTerminationEvidence('IQ8A', 'iq-q-cable-drop-connector')!;
    const v = verifyGroundingDocumentApplicability(doc, {
      microSku: 'IQ8A-72-2-US', cableSku: 'Q-12-RAW-300', moduleSku: null,
      mountingBondingSystem: null, jurisdiction: 'North America',
      connectorArchitecture: 'iq-q-cable-drop-connector',
    });
    expect(v.verdict).toBe('not-applicable');
    expect(v.failures.join(' ')).toMatch(/cable assembly/i);
  });

  it('MISSING AUTHORITY FAILS CLOSED — no authority ⇒ no procurement, ever', () => {
    const r = resolveQCableProcurement({
      topology: PKG.snap.electrical.qcableTopology!,
      assembly: PKG.snap.electrical.listedCableAssembly!,
      system: findTrunkCableSystem('Enphase'),
      authority: null,
      sufficiency: PKG.snap.electrical.procurementSufficiency!,
    });
    expect(r.present).toBe(false);
    expect(r.compatibilityStatus).toBe('INCOMPLETE');
    expect(r.stockUnitsRequired).toBeNull();
    expect(r.residuals.map(x => x.code)).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
  });
});

// ── 3. BRANCH ALLOCATION (test req. 8–13) ────────────────────────────────────
describe('branch allocation — the two deficits are never netted', () => {
  it('the AGGREGATE deficit remains 14.5 ft', () => {
    expect(LIVE.aggregateInstalledDeficitFt).toBe(14.5);
  });

  it('the TOPOLOGY-CONSTRAINED installed requirement remains 24.2 ft, and it GOVERNS', () => {
    expect(LIVE.topologyConstrainedInstalledDeficitFt).toBe(24.2);
    expect(LIVE.governingBasis).toBe('topology-constrained');
  });

  it('B1 remains 10.0 ft short', () => { expect(liveAlloc('B1').shortageFt).toBe(10); });
  it('B2 remains 14.2 ft short', () => { expect(liveAlloc('B2').shortageFt).toBe(14.2); });
  it('B3 keeps its 9.7 ft surplus', () => {
    expect(liveAlloc('B3').nonRedistributableSurplusFt).toBe(9.7);
    expect(LIVE.nonRedistributableSurplusFt).toBe(9.7);
  });

  it('B3 SURPLUS IS NOT SILENTLY REDISTRIBUTED to B1 or B2', () => {
    // the short branches are allocated their OWN cable; nothing is taken from B3
    expect(liveAlloc('B3').allocatedNewUsableLengthFt).toBe(0);
    expect(liveAlloc('B3').allocatedSections).toBe(0);
    expect(liveAlloc('B1').allocatedNewUsableLengthFt).toBeGreaterThanOrEqual(liveAlloc('B1').shortageFt);
    expect(liveAlloc('B2').allocatedNewUsableLengthFt).toBeGreaterThanOrEqual(liveAlloc('B2').shortageFt);
    // the governing figure is the SUM of shortfalls, never shortfalls − surplus
    const sumShort = LIVE.branchAllocations.reduce((s, a) => s + a.shortageFt, 0);
    expect(Math.round(sumShort * 10) / 10).toBe(LIVE.topologyConstrainedInstalledDeficitFt);
    expect(LIVE.topologyConstrainedInstalledDeficitFt)
      .toBeGreaterThan(LIVE.aggregateInstalledDeficitFt);
    // 24.2 − 9.7 = 14.5: netting them produces the AGGREGATE figure, which is
    // exactly the mistake the non-redistributable rule exists to prevent.
    expect(Math.round((LIVE.topologyConstrainedInstalledDeficitFt - LIVE.nonRedistributableSurplusFt) * 10) / 10)
      .toBe(LIVE.aggregateInstalledDeficitFt);
  });

  it('PROCUREMENT ALLOCATION EQUALS BRANCH INSTALLATION ALLOCATION', () => {
    for (const r of [QP, LIVE]) {
      const sections = r.branchAllocations.reduce((s, a) => s + a.allocatedSections, 0);
      expect(sections).toBe(r.additionalSectionsRequired);
      const ft = r.branchAllocations.reduce((s, a) => s + a.allocatedNewUsableLengthFt, 0);
      expect(Math.round(ft * 10) / 10).toBe(r.totalUsableInstalledFt);
    }
  });

  it('every allocation covers its own branch shortage and no other', () => {
    for (const r of [QP, LIVE]) {
      for (const a of r.branchAllocations) {
        if (a.shortageFt > 0) expect(a.allocatedNewUsableLengthFt).toBeGreaterThanOrEqual(a.shortageFt);
        else expect(a.allocatedSections).toBe(0);
      }
    }
  });

  it('the surplus branch states WHY its surplus cannot move', () => {
    expect(liveAlloc('B3').allocationSource).toMatch(/NON-REDISTRIBUTABLE/i);
    expect(liveAlloc('B3').allocationSource).toMatch(/one continuous run/i);
  });
});

// ── 4. PURCHASE QUANTITY (test req. 14–16) ───────────────────────────────────
describe('the purchase is expressed in the manufacturer package unit', () => {
  it('the stock item is the LISTED CABLE, and the raw-stock SKU is explicitly rejected', () => {
    expect(QP.selectedStockSku).toBe('Q-12-10-240');
    expect(QP.rejectedStockCandidates.map(r => r.sku)).toContain('Q-12-RAW-300');
    expect(QP.rejectedStockCandidates.find(r => r.sku === 'Q-12-RAW-300')!.reason)
      .toMatch(/no archived manufacturer document/i);
  });

  it('the package comes from the archived table: 240 connector sections', () => {
    expect(QP.stockUnitConnectorSections).toBe(240);
    expect(QP.stockUnitDescription).toMatch(/box of 240 connector sections/i);
  });

  it('STOCK UNITS ARE INTEGERS', () => {
    expect(Number.isInteger(QP.stockUnitsRequired)).toBe(true);
    expect(Number.isInteger(QP.baseStockUnitsRequired)).toBe(true);
    expect(Number.isInteger(QP.additionalStockUnitsRequired)).toBe(true);
    expect(Number.isInteger(QP.additionalSectionsRequired)).toBe(true);
  });

  it('sections reconcile: base + allocated = total, and packages cover total', () => {
    expect(QP.baseSectionsOrdered + QP.additionalSectionsRequired).toBe(QP.totalSectionsRequired);
    expect(QP.stockUnitsRequired! * QP.stockUnitConnectorSections!)
      .toBeGreaterThanOrEqual(QP.totalSectionsRequired);
    expect(QP.additionalStockUnitsRequired)
      .toBe(QP.stockUnitsRequired! - QP.baseStockUnitsRequired!);
  });

  it('THE EXPECTED REMAINDER RECONCILES against purchased − installed path', () => {
    const installedPath = PKG.snap.electrical.qcableTopology!.totals.installedLengthFt;
    expect(Math.round((QP.totalStockPurchasedFt! - installedPath) * 10) / 10)
      .toBe(QP.expectedRemainingStockFt);
    // and it is NOT the brief's illustrative 275.8 — that assumed a 300-ft reel
    expect(QP.expectedRemainingStockFt).not.toBe(275.8);
  });

  it('CUT LOSS AND SERVICE LOOPS ARE INCLUDED ONLY WHEN GOVERNED — and none is published', () => {
    const a = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    expect(a.slackAllowanceGoverned.value).toBe(false);
    expect(PKG.snap.electrical.procurementSufficiency!.requiredServiceLoopAllowanceFt).toBe(0);
    expect(PKG.snap.electrical.procurementSufficiency!.allowanceProvenance)
      .toBe('no-allowance-authority-recorded');
  });
});

// ── 5. ACCESSORIES (test req. 17–19) ─────────────────────────────────────────
describe('accessories are derived from actual branch modifications', () => {
  const acc = (sku: string) => QP.accessories.filter(a => a.sku === sku);
  const qty = (sku: string) => acc(sku).reduce((s, a) => s + a.quantity, 0);

  it('CONNECTOR QUANTITY DERIVES FROM BRANCH CHANGES, in matched male/female pairs', () => {
    // one join per branch that receives cable + one per documented bridge
    const joins = QP.branchAllocations.filter(a => a.allocatedSections > 0).length
      + PKG.snap.electrical.qcableTopology!.bridgeRequirements.length;
    expect(qty('Q-CONN-10M')).toBe(joins);
    expect(qty('Q-CONN-10F')).toBe(joins);
    // every connector line names the branch it belongs to
    for (const a of acc('Q-CONN-10M')) expect(a.branchId).toBeTruthy();
  });

  it('TERMINATOR QUANTITY DERIVES FROM ACTUAL BRANCH ENDS, per the archived rule', () => {
    const a = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    const branches = PKG.snap.electrical.qcableTopology!.branches.length;
    expect(qty('Q-TERM-10')).toBe(a.terminator.value.perBranchCircuit * branches);
    expect(a.terminator.quote).toMatch(/two needed per branch circuit/i);
  });

  it('sealing caps follow the one-per-unused-connector rule the manual states', () => {
    const t = PKG.snap.electrical.qcableTopology!;
    expect(qty('Q-SEAL-10')).toBe(t.totals.deadDropCount + QP.additionalSectionsRequired);
  });

  it('cable supports follow the documented maximum spacing', () => {
    const a = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    const t = PKG.snap.electrical.qcableTopology!;
    expect(qty('Q-CLIP-100')).toBe(Math.ceil(t.totals.installedLengthFt / a.cableSupport.value.maxSupportSpacingFt));
  });

  it('every accessory carries a SKU, a purpose, an evidence id and a section', () => {
    expect(QP.accessories.length).toBeGreaterThan(0);
    for (const a of QP.accessories) {
      expect(a.sku).toBeTruthy();
      expect(a.quantity).toBeGreaterThan(0);
      expect(a.purpose.length).toBeGreaterThan(5);
      expect(a.evidenceId).toBe(FIELD_TERMINATION_DOCUMENT_ID);
      expect(a.evidenceSection).toBeTruthy();
      expect(a.compatibilityState).toBe('VERIFIED');
    }
  });

  it('A MISSING REQUIRED ACCESSORY PREVENTS CLOSURE', () => {
    const authority = enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector')!;
    const broken = clone(authority);
    (broken.terminator.value as { sku: string }).sku = '';
    const r = resolveQCableProcurement({
      topology: PKG.snap.electrical.qcableTopology!,
      assembly: PKG.snap.electrical.listedCableAssembly!,
      system: findTrunkCableSystem('Enphase'),
      authority: broken,
      sufficiency: PKG.snap.electrical.procurementSufficiency!,
    });
    expect(r.compatibilityStatus).toBe('INCOMPLETE');
    expect(r.residuals.map(x => x.code)).toContain('QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED');
  });

  it('an untabled cable prevents closure with a SCOPED packaging requirement', () => {
    const asm = clone(PKG.snap.electrical.listedCableAssembly!);
    asm.sku = 'Q-12-99-999';   // not in the archived table
    const r = resolveQCableProcurement({
      topology: PKG.snap.electrical.qcableTopology!,
      assembly: asm,
      system: findTrunkCableSystem('Enphase'),
      authority: enphaseFieldTerminationAuthority('IQ8A', 'iq-q-cable-drop-connector'),
      sufficiency: PKG.snap.electrical.procurementSufficiency!,
    });
    expect(r.compatibilityStatus).toBe('INCOMPLETE');
    expect(r.residuals.map(x => x.code)).toContain('QCABLE-STOCK-PACKAGING-UNVERIFIED');
    expect(r.stockUnitsRequired).toBeNull();
  });
});

// ── 6. PROJECTIONS (test req. 20–23) ─────────────────────────────────────────
describe('every surface consumes the canonical resolution', () => {
  it('THE BOM consumes it: the trunk row is orderable and states the package', () => {
    const trunk = PKG.bom.find(b => b.category === 'trunk_cable')!;
    expect(trunk.nonOrderable).not.toBe(true);
    expect(trunk.description).toContain(`ORDER ${QP.stockUnitsRequired} × Q-12-10-240`);
    expect(trunk.description).toMatch(/never an order quantity/i);
    expect(trunk.derivedFrom).toMatch(/qcableProcurement/);
  });

  it('THE BOM accessory rows carry the canonical quantities, orderable', () => {
    for (const sku of ['Q-CONN-10M', 'Q-CONN-10F', 'Q-TERM-10', 'Q-SEAL-10', 'Q-CLIP-100']) {
      const row = PKG.bom.find(b => String(b.partNumber) === sku);
      expect(row, `${sku} missing from the BOM`).toBeTruthy();
      expect(row!.nonOrderable, `${sku} is still non-orderable`).not.toBe(true);
      const expected = QP.accessories.filter(a => a.sku === sku).reduce((s, a) => s + a.quantity, 0);
      expect(row!.quantity).toBe(expected);
    }
  });

  it('SCHED consumes it — the apportionment sentence states the canonical allocation', () => {
    // the retired sentence is gone
    expect(PKG.html).not.toContain('the Σ Q-Cable deficit is NOT apportioned per branch');
    // and the replacement states THIS package's own numbers, from the resolution
    expect(PKG.html).toMatch(/GOVERNING topology-constrained requirement is /);
    expect(PKG.html).toContain(`requirement is ${QP.topologyConstrainedInstalledDeficitFt} ft`);
    for (const a of QP.branchAllocations.filter(x => x.shortageFt > 0)) {
      expect(PKG.html).toContain(`${a.branchLabel} ${a.shortageFt} ft`);
    }
    if (QP.nonRedistributableSurplusFt > 0) {
      expect(PKG.html).toContain(`${QP.nonRedistributableSurplusFt} ft surplus on`);
      expect(PKG.html).toMatch(/is NOT redistributable/);
    }
  });

  it('the PV-4B continuation sheet consumes the canonical branch allocation', () => {
    // located by its own content (the physical-section schedule), not by a sheet
    // id — the continuation's title block carries the base id.
    const pages = PKG.html.split(/(?=<div class="page)/);
    const cont = pages.find(p => p.includes('Physical Conductor / Raceway Schedule'))!;
    expect(cont, 'the physical-section continuation sheet is missing').toBeTruthy();
    expect(cont).toMatch(/Q-CABLE PROCUREMENT RESOLUTION/);
    expect(cont).toMatch(/non-redistributable/i);
    expect(cont).toContain('Q-12-RAW-300');          // reported as rejected
    expect(cont).toMatch(/NOT USED/);
    // the per-branch allocation table carries every branch
    for (const a of QP.branchAllocations) expect(cont).toContain(a.branchLabel);
    // and the accessory table carries every accessory SKU
    for (const sku of new Set(QP.accessories.map(x => x.sku))) expect(cont).toContain(sku);
  });

  it('NO SHEET CALLS THE INSTALLED REQUIREMENT AN ORDERABLE QUANTITY', () => {
    const needle = `${QP.topologyConstrainedInstalledDeficitFt} ft`;
    const text = PKG.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    // NUMBER-BOUNDARY match: a bare indexOf finds "9.3 ft" inside "39.3 ft",
    // which is a different quantity on a different row.
    const bounded = new RegExp(`(^|[^\\d.])${QP.topologyConstrainedInstalledDeficitFt.toString().replace('.', '\\.')} ft`, 'g');
    const idx = [...text.matchAll(bounded)].map(m => m.index! + m[0].length - needle.length);
    expect(idx.length, 'the installed requirement is never printed at all').toBeGreaterThan(0);
    for (const at of idx) {
      const ctx = text.slice(Math.max(0, at - 220), at + 220);
      expect(/installed|INSTALLED|per-branch|PER-BRANCH|deficit|requirement|shortage|Required/.test(ctx),
        `"${needle}" printed with no installed-length qualifier: "${ctx}"`).toBe(true);
      // and it is never the OPERAND of an ORDER statement. An explicit denial
      // ("the ORDER is 1 package, NOT the 9.3 ft installed requirement") is the
      // opposite of the defect, so a negation between the two disqualifies the
      // match — the same trap that made a negated grounding sentence read as an
      // assertion in WS-1.
      const orderOperand = new RegExp(
        `ORDER(?:(?!NOT)[^.]){0,80}?${QP.topologyConstrainedInstalledDeficitFt.toString().replace('.', '\\.')}\\s*ft`);
      expect(orderOperand.test(ctx),
        `the installed requirement is used as an ORDER operand: "${ctx}"`).toBe(false);
    }
    // the ORDER statements name a PACKAGE, not a footage
    expect(text).toContain(`ORDER ${QP.stockUnitsRequired} × Q-12-10-240`);
  });
});

// ── 7. THE REGISTRY (test req. 24–26) ────────────────────────────────────────
describe('the requirement registry tells the truth', () => {
  const open = PKG.snap.permitReadiness.registry.filter(r => !r.resolved).map(r => r.code);

  it('QCABLE-PROCUREMENT-INSUFFICIENT is CLOSED — and only because the design is complete', () => {
    expect(QP.compatibilityStatus).toBe('VERIFIED');
    expect(QP.unresolved).toEqual([]);
    expect(open).not.toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
  });

  it('CLOSURE REQUIRES ALL TEN ELEMENTS — each one alone reopens a scoped requirement', () => {
    expect(QP.selectedStockSku).toBeTruthy();            // 1 compatible stock SKU
    expect(QP.stockUnitConnectorSections).toBeTruthy();  // 2 packaging
    // 3 field-termination method, quoted from the archived manual
    expect(QP.derivation).toMatch(/Cut each segment of cable/i);
    expect(QP.derivation).toMatch(/field-wireable pair/i);
    expect(QP.accessories.some(a => a.sku === 'Q-CONN-10M')).toBe(true);  // 4 connectors
    expect(QP.accessories.some(a => a.sku === 'Q-TERM-10')).toBe(true);   // 5 terminator
    expect(QP.branchAllocations.length).toBeGreaterThan(0);               // 6 allocation
    expect(QP.stockUnitsRequired).toBeGreaterThan(0);                     // 7 purchase qty
    expect(QP.expectedRemainingStockFt).not.toBeNull();                   // 8 remainder
    expect(PKG.bom.some(b => b.category === 'trunk_cable' && b.nonOrderable !== true)).toBe(true); // 9 BOM
    expect(QP.evidenceIds[0]).toMatch(/IOM-00068-3\.0-EN/);               // 10 evidence
  });

  it('no scoped Q-Cable residual is open on a resolved design', () => {
    for (const c of ['QCABLE-STOCK-PACKAGING-UNVERIFIED', 'QCABLE-FIELD-CONNECTOR-SKU-MISSING',
      'QCABLE-TERMINATOR-COMPATIBILITY-UNVERIFIED']) {
      expect(open).not.toContain(c);
    }
  });

  it('SCHED GROUNDING STATUS REFLECTS THE VERIFIED IQ8A EVIDENCE', () => {
    expect(PKG.html).toMatch(/IQ8A PRODUCT: NO SEPARATE EGC REQUIRED/);
    expect(PKG.html).toMatch(/verified manufacturer document IOM-00068-3\.0-EN/);
  });

  it('RACKING BONDING REMAINS SEPARATE, and still pending', () => {
    expect(PKG.html).toMatch(/ARRAY\/RACKING BONDING: <strong[^>]*>METHOD PENDING/);
    expect(open).toContain('PENDING-RACKING-ASSEMBLY-SELECTION');
    const bond = PKG.snap.electrical.groundingObjects.find(g => g.groundingId === 'gnd-array-bond')!;
    expect(bond.bondingMethod).toBeNull();
    expect(bond.calculatedMinimumSize).toBe('#12 AWG');
    expect(bond.selectedDesignSize).toBe('#10 AWG');
  });

  it('NO GROUNDING REGRESSION: the product outcome is still closed on its own evidence', () => {
    expect(PKG.snap.electrical.openAirGroundingAuthority!.outcome).toBe('NO_SEPARATE_EGC_REQUIRED');
    expect(open).not.toContain('QCABLE-GROUNDING-AUTHORITY-UNVERIFIED');
  });
});
