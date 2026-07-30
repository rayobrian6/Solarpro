// ═══════════════════════════════════════════════════════════════════════════
// Q-CABLE PROCUREMENT SUFFICIENCY GATE (2026-07-24) — the SEVEN mandated tests.
//
// Ray's ruling: a Q-Cable procurement deficit (Σ geometric designed-installed
// cable path > drop-based procurement footage + allowance) is NOT a FIELD-VERIFY /
// "jumpers required" note — it is a FAIL-CLOSED blocking condition
// (QCABLE-PROCUREMENT-INSUFFICIENT) that clears ONLY via a VERIFIED
// CableExtensionSolution. These seven tests pin that contract end-to-end.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { unresolvedProcurementAuthority } from '../fixtures/synthetic-unresolved-procurement';
import { deriveBranchCablePaths } from '@/lib/bom/deriveRunLengths';
import {
  buildProcurementSufficiency,
  evaluateCableExtensionClearance,
  procurementInsufficiencyPayload,
} from '@/lib/permit/snapshot/procurementSufficiency';
import { classifyBlockerSeverity } from '@/lib/permit/snapshot/severityPolicy';
import { pageConductorSchedule } from '@/lib/permit/sections/electricalPages';
import { generateBOMForPermit } from '@/lib/permit/utils/bomForPermit';
import { pageEquipmentSchedule, pageEquipmentScheduleCont } from '@/lib/permit/sections/structuralPages';
import { renderReviewStatusSheets } from '@/lib/permit/sections/reviewStatus';
import type {
  BranchCablePath, ListedCableAssembly, CableExtensionSolution, PermitReadinessBlocker,
} from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

const ASM = (): ListedCableAssembly => ({
  assemblyId: 'QCABLE-ASSEMBLY', manufacturer: 'Enphase', ecosystem: 'IQ Q-Cable',
  model: 'Q-12-10-240', sku: 'Q-12-10-240', skuNote: null,
  conductorConstruction: 'two-wire', conductorCount: 2, conductorGauge: '#12 AWG',
  insulationListing: 'TC-ER', wiringMethodLabel: 'ENPHASE Q CABLE (TC-ER)',
  connectorArchitecture: 'iq-q-cable-drop-connector',
  connectorSpacingFt: 4.25, maxBranchCurrentA: 20, compatibleMicroModels: ['IQ8A'],
  cableLengthFt: 152, dropCount: 31, unusedDropCapSku: null, terminatorSku: null,
  sourceDocument: null, verificationStatus: 'catalog-sourced', provenance: { source: 'test' },
});

const PATH = (
  id: string, label: string, drops: number, designed: number, proc: number,
): BranchCablePath => ({
  branchId: id, branchLabel: label, moduleCount: drops, dropCount: drops,
  designedInstalledLengthFt: designed, connectorSpacingFt: 4.25,
  procurementLengthFt: proc, wasteFactor: 1.15, lengthProvenance: 'geometry-derived',
  derivation: 'test', provenance: { source: 'test' },
});

// Verified extension document evidence (SYNTHETIC, test-only — NEVER committed as
// real evidence): a clearly-fake archived+hashed verified manufacturer document.
const VERIFIED_DOC = () => ({
  documentId: 'TEST-FAKE-DOC-0001', documentClass: 'combiner_documentation',
  documentIdentity: 'TEST-ONLY synthetic Q-Cable extension listing (NOT REAL EVIDENCE)',
  verificationState: 'verified', status: 'current', archivedInRepo: true,
  sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  coversExtensionSku: 'Q-EXT-TEST-10', compatibleSystem: 'Enphase IQ8A / Q Cable',
  revisionOrDate: '2026-07-24',
});

const VERIFIED_SOLUTION = (deficit: number): CableExtensionSolution => ({
  solutionId: 'sol-test-1', kind: 'verified-jumper-extension', selectedSku: 'Q-EXT-TEST-10',
  quantity: 3, addedLengthFt: deficit + 5, locations: ['br-1', 'br-2', 'br-3'],
  compatibilityVerified: true, compatibleSystemNote: 'IQ8A / Q Cable',
  manufacturerDocument: VERIFIED_DOC() as any,
  representedInDrawings: true, representedInSchedules: true, representedInBom: true,
  vdInstallationRecalculated: true, note: null, provenance: { source: 'test' },
});

// ── TEST 1 — fixture: the AGGREGATE clears, ONE BRANCH does not. ─────────────
// AAC WS-5 (2026-07-27) RE-BASED this case. It used to assert the fixture was
// SUFFICIENT because Σ designed 140.5 ≤ Σ procurement 152. That comparison was
// AGGREGATE-ONLY, and it hid a real defect: branch B2's ordered 10 drops
// (49 ft) cannot span its 58.3 ft as-routed path, which includes a 24.4 ft
// sub-array/roof-plane bridge. The directive's mandated case — "sufficient in
// aggregate but invalid for one branch topology must FAIL" — is exactly this
// package, so the gate is now per-branch AND aggregate.
describe('§Q test 1 — the fixture clears in AGGREGATE but FAILS per branch', () => {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-24T12:00:00Z';
  // WS-2: this suite is about the UNRESOLVED state — the measured shortfall and
  // what a package may say while it has no procurement design. The live package
  // now HAS one (archived IOM field-termination authority), so the unresolved
  // state is manufactured by refusing that authority. Nothing here is weakened;
  // the fail-closed path is exercised deliberately instead of incidentally.
  generatePermitHTML(input, undefined, unresolvedProcurementAuthority() as any);
  const snap = input._snapshot;
  const ps = snap.electrical.procurementSufficiency;

  it('the AGGREGATE still clears — the failure is genuinely per-branch', () => {
    expect(ps.present).toBe(true);
    expect(ps.totalDesignedInstalledFt).toBeLessThanOrEqual(ps.procurementLengthFt);
    // allowance is honestly 0 with recorded provenance (no in-repo allowance rule)
    expect(ps.requiredServiceLoopAllowanceFt).toBe(0);
    expect(ps.allowanceProvenance).toBe('no-allowance-authority-recorded');
  });

  it('a branch whose ordered footage cannot span its own path makes it INSUFFICIENT', () => {
    const short = ps.perBranch.filter((b: any) => b.designedInstalledLengthFt > b.procurementLengthFt);
    expect(short.length, 'anti-vacuity: a genuinely short branch must exist').toBeGreaterThan(0);
    expect(ps.insufficient).toBe(true);
    expect(ps.deficitFt).toBeGreaterThan(0);
    expect(ps.verificationStatus).toBe('insufficient-unresolved');
    expect(ps.affectedBranchIds).toEqual(short.map((b: any) => b.branchId));
  });

  it('the blocker fires and carries the OPTION EVALUATION, not a bare deficit', () => {
    const entry = (snap.permitReadiness.registry ?? []).find((r: any) => r.code === 'QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(entry).toBeTruthy();
    const ev = (entry!.payload as any).optionEvaluation;
    expect(ev, 'the payload must carry the evaluated option space').toBeTruthy();
    expect(ev.options.length).toBeGreaterThan(5);
    expect(ev.unresolvedReason).toMatch(/bridge|short/i);
    // every option states its own per-branch and aggregate numbers
    for (const o of ev.options) {
      expect(typeof o.aggregateRequiredFt).toBe('number');
      expect(typeof o.aggregateProvidedFt).toBe('number');
    }
  });
});

// ── TEST 2 — live-shaped: blocker ACTIVE (designed 166.5 > procurement 152). ──
describe('§Q test 2 — live-shaped deficit is BLOCKING at 166.5 > 152', () => {
  const paths = [PATH('br-1', 'B1', 13, 64.0, 64), PATH('br-2', 'B2', 13, 63.2, 63), PATH('br-3', 'B3', 5, 39.3, 25)];
  const ps = buildProcurementSufficiency({ assembly: ASM(), branchPaths: paths, selectedSystem: 'Enphase IQ8A' });

  it('insufficient with deficit 14.5 and unresolved status', () => {
    expect(ps!.totalDesignedInstalledFt).toBe(166.5);
    expect(ps!.procurementLengthFt).toBe(152);
    expect(ps!.insufficient).toBe(true);
    expect(ps!.deficitFt).toBe(14.5);
    expect(ps!.verificationStatus).toBe('insufficient-unresolved');
    expect(ps!.affectedBranchIds.length).toBeGreaterThan(0);
    expect(ps!.manufacturerDocumentAuthority).toBeNull();
  });
  it('the code is classified BLOCKING by the severity policy', () => {
    expect(classifyBlockerSeverity('QCABLE-PROCUREMENT-INSUFFICIENT').severity).toBe('blocking');
  });
});

// ── TEST 3 — geometry change ACTIVATES and CLEARS the deficit. ────────────────
describe('§Q test 3 — geometry change activates / clears the deficit', () => {
  const asm = ASM();
  // TIGHT spacing (3 ft < 4.25 ft pitch): designed path < drop-based procurement.
  const tight = deriveBranchCablePaths(
    [{ branchId: 'br-1', branchLabel: 'B1', moduleCount: 8,
       moduleCentersFt: Array.from({ length: 8 }, (_, i) => ({ x: i * 3, y: 0 })) }],
    4.25,
  ).map(p => ({ ...p, provenance: { source: 'test' } }));
  const psTight = buildProcurementSufficiency({ assembly: asm, branchPaths: tight, selectedSystem: 'Enphase IQ8A' });

  // WIDE spacing (9 ft > pitch): designed path outruns the drop-based procurement.
  const wide = deriveBranchCablePaths(
    [{ branchId: 'br-1', branchLabel: 'B1', moduleCount: 8,
       moduleCentersFt: Array.from({ length: 8 }, (_, i) => ({ x: i * 9, y: 0 })) }],
    4.25,
  ).map(p => ({ ...p, provenance: { source: 'test' } }));
  const psWide = buildProcurementSufficiency({ assembly: asm, branchPaths: wide, selectedSystem: 'Enphase IQ8A' });

  it('tight geometry is sufficient (no blocker)', () => {
    expect(psTight!.insufficient).toBe(false);
    expect(psTight!.deficitFt).toBe(0);
  });
  it('widening the geometry activates the deficit', () => {
    expect(psWide!.insufficient).toBe(true);
    expect(psWide!.deficitFt).toBeGreaterThan(0);
    expect(psWide!.totalDesignedInstalledFt!).toBeGreaterThan(psWide!.procurementLengthFt!);
  });
});

// ── TEST 4 — a VERIFIED canonical solution CLEARS the blocker. ────────────────
describe('§Q test 4 — verified CableExtensionSolution clears the deficit', () => {
  const paths = [PATH('br-1', 'B1', 13, 64.0, 64), PATH('br-2', 'B2', 13, 63.2, 63), PATH('br-3', 'B3', 5, 39.3, 25)];
  const deficit = 14.5;
  const sol = VERIFIED_SOLUTION(deficit);

  it('the pure clearance evaluator accepts the verified solution', () => {
    const res = evaluateCableExtensionClearance({ selectedSystem: 'Enphase IQ8A', deficitFt: deficit }, sol);
    expect(res.cleared).toBe(true);
    expect(res.missing).toEqual([]);
  });
  it('buildProcurementSufficiency marks it resolved-by-verified-solution (blocker off)', () => {
    const ps = buildProcurementSufficiency({ assembly: ASM(), branchPaths: paths, selectedSystem: 'Enphase IQ8A', solutions: [sol] });
    expect(ps!.insufficient).toBe(false);
    expect(ps!.verificationStatus).toBe('resolved-by-verified-solution');
    expect(ps!.clearedBySolutionId).toBe('sol-test-1');
    // one resolution option is now SELECTED
    expect(ps!.resolutionOptions.some(o => o.selected)).toBe(true);
  });
});

// ── TEST 5 — an UNVERIFIED note can NEVER clear the blocker. ──────────────────
describe('§Q test 5 — unverified note cannot clear the deficit', () => {
  const paths = [PATH('br-1', 'B1', 13, 64.0, 64), PATH('br-2', 'B2', 13, 63.2, 63), PATH('br-3', 'B3', 5, 39.3, 25)];
  // A free-text "jumpers required" note: no SKU, no document, nothing represented.
  const note: CableExtensionSolution = {
    solutionId: 'sol-note', kind: 'verified-jumper-extension', selectedSku: null,
    quantity: null, addedLengthFt: null, locations: [], compatibilityVerified: false,
    compatibleSystemNote: 'jumpers required', manufacturerDocument: null,
    representedInDrawings: false, representedInSchedules: false, representedInBom: false,
    vdInstallationRecalculated: false, note: 'add jumpers in the field', provenance: { source: 'test' },
  };

  it('the pure clearance evaluator rejects the note (many missing conditions)', () => {
    const res = evaluateCableExtensionClearance({ selectedSystem: 'Enphase IQ8A', deficitFt: 14.5 }, note);
    expect(res.cleared).toBe(false);
    expect(res.missing).toContain('selected_sku');
    expect(res.missing).toContain('manufacturer_document');
  });
  it('even partial evidence (verified doc but no drawings/BOM/VD) cannot clear', () => {
    const partial = VERIFIED_SOLUTION(14.5);
    partial.representedInBom = false;   // not in the BOM
    partial.vdInstallationRecalculated = false;
    const res = evaluateCableExtensionClearance({ selectedSystem: 'Enphase IQ8A', deficitFt: 14.5 }, partial);
    expect(res.cleared).toBe(false);
    const ps = buildProcurementSufficiency({ assembly: ASM(), branchPaths: paths, selectedSystem: 'Enphase IQ8A', solutions: [note, partial] });
    expect(ps!.insufficient).toBe(true);
    expect(ps!.verificationStatus).toBe('insufficient-unresolved');
    expect(ps!.clearedBySolutionId).toBeNull();
  });
});

// ── Shared: a live-shaped INSUFFICIENT rendered package (fixture snapshot with
//    an injected deficit + blocker). Renders PV-4B / SCHED / RS-1 from ONE snapshot. ──
function buildInsufficientRender() {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-24T12:00:00Z';
  generatePermitHTML(input, undefined, unresolvedProcurementAuthority() as any);
  const cad = generateCADLayout(input);
  const snap = clone(input._snapshot);   // frozen — clone before mutating
  const paths = [PATH('br-1', 'B1', 13, 64.0, 64), PATH('br-2', 'B2', 13, 63.2, 63), PATH('br-3', 'B3', 5, 39.3, 25)];
  const ps = buildProcurementSufficiency({ assembly: ASM(), branchPaths: paths, selectedSystem: 'Enphase IQ8A' })!;
  snap.electrical.procurementSufficiency = ps;
  const blocker: PermitReadinessBlocker = {
    code: 'QCABLE-PROCUREMENT-INSUFFICIENT', severity: 'blocking', justification: '',
    domain: 'electrical', authorityPath: 'electrical.procurementSufficiency',
    affectedSheets: ['PV-4B', 'SCHED', 'E-1', 'RS-1'],
    explanation: `Q-Cable procurement is SHORT: Σ designed-installed ${ps.totalDesignedInstalledFt} ft EXCEEDS procurement ${ps.procurementLengthFt} ft by ${ps.deficitFt} ft. Base cable quantity is NON-ORDERABLE / PENDING SOLUTION.`,
    resolutionAction: 'Procurement: select a VERIFIED listed cable-extension product.',
    payload: procurementInsufficiencyPayload(ps),
    provenance: { source: 'electrical.procurementSufficiency', ref: 'QCABLE-ASSEMBLY' },
    createdAtIso: '2026-07-24T12:00:00Z', createdVersion: 'test', resolved: false, resolutionAuditRef: null,
  };
  snap.permitReadiness.registry = [...(snap.permitReadiness.registry ?? []), blocker];
  snap.permitReadiness.blockers = [...(snap.permitReadiness.blockers ?? []), { code: blocker.code, message: blocker.explanation }];
  snap.permitReadiness.ready = false;
  input._snapshot = snap;   // reassign (property not frozen)
  // PPC §9 — regenerate the BOM against the INSUFFICIENT snapshot so the §9
  // post-pass (which reads electrical.procurementSufficiency through peekSnapshot)
  // stamps the trunk-cable ROW with its own procurement state. Without this the
  // rendered schedule shows the row bare — the exact §9 defect.
  input.bom = generateBOMForPermit(input, cad);
  return { input, cad, ps, blocker };
}

// ── TEST 6 — BOM / RS-1 / PV-4B render IDENTICAL deficit + status. ────────────
describe('§Q test 6 — PV-4B, SCHED (BOM), RS-1 show the same deficit + insufficiency', () => {
  const { input, cad, ps } = buildInsufficientRender();
  const pv4b = pageConductorSchedule(input, cad, 7, 30);
  // The BOM is paginated across SCHED / SCHED-2 / SCHED-3; the trunk-cable ROW
  // itself lands on a continuation sheet, so 'the SCHED surface' is all three.
  const schedPrimary = pageEquipmentSchedule(input, cad, 20, 30);
  const sched = schedPrimary
    + pageEquipmentScheduleCont(input, cad, 21, 30, 0)
    + pageEquipmentScheduleCont(input, cad, 22, 30, 1);
  const rs1 = renderReviewStatusSheets(input, cad);
  const deficitTxt = `${ps.deficitFt} ft`;

  it('PV-4B shows the blocker code, the governing deficit, and NON-ORDERABLE', () => {
    // TAC WS-1 — the requirement CODE is the stable anchor (the surrounding prose
    // was compacted so PV-4B keeps its printable slack; the full two-basis
    // derivation moved to PV-4B.1). PV-4B must still state the code, the
    // governing deficit, the required purchase and the non-orderable state.
    expect(pv4b).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(pv4b).toContain(deficitTxt);
    expect(pv4b).toContain('NON-ORDERABLE');
    // the basis is NAMED, so an aggregate figure can never be read as a
    // per-branch one (or vice versa).
    expect(pv4b).toMatch(/PER-BRANCH \(governing\)|aggregate-footage/);
    // WS-2 wording: "purchase" was wrong on this line — the number is an
    // INSTALLED length (a footage is not a purchase quantity), so the unresolved
    // sentence now says "min. additional INSTALLED length".
    expect(pv4b).toContain('min. additional INSTALLED length');
  });
  // ── UPDATED by the PPC corrective pass (§9), 2026-07-26 ────────────────────
  // The retired assertions targeted a STANDALONE note ('AC TRUNK CABLE (BOM): …
  // CURRENT BASE CABLE QUANTITY …') printed above the schedule. That note has been
  // retired because the TRUNK BOM ROW ITSELF now carries the state — which is the
  // stronger outcome and the actual §9 requirement: an operator reading the
  // schedule row alone could previously order the insufficient quantity. The row
  // states STATUS / REASON / DESIGNED-INSTALLED / ALLOWANCE / THRESHOLD /
  // CURRENT BASE / DEFICIT / EXTENSION SOLUTION NOT SELECTED and is machine-tagged
  // non-orderable; the primary sheet states the per-branch AFFECTED status.
  it('the SCHED trunk BOM ROW itself carries the deficit state and is non-orderable', () => {
    expect(sched).toContain('STATUS: NON-ORDERABLE');
    expect(sched).toContain('REASON: QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(sched).toContain(`CURRENT BASE ${ps.procurementLengthFt} FT`);
    expect(sched).toContain(`DEFICIT ${ps.deficitFt} FT`);
    expect(sched).toContain('EXTENSION SOLUTION NOT SELECTED');
    expect(sched).toContain('data-bom-orderable="false"');
    expect(sched).toContain(deficitTxt.replace(' ft', ' FT'));
    // the selected cable identity is KEPT (the quantity is insufficient, not the cable)
    expect(sched).toContain('Q-12-10-240');
  });

  it('the primary SCHED sheet states the per-branch procurement status', () => {
    expect(schedPrimary).toContain('PROCUREMENT SUFFICIENCY:');
    expect(schedPrimary).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(schedPrimary).toContain('OVERALL RELEASE:');
  });
  it('RS-1 shows the blocker code, the payload, and the same deficit', () => {
    expect(rs1).toContain('QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(rs1).toContain('DEFICIT PAYLOAD:');
    expect(rs1).toContain(deficitTxt);
    expect(rs1).toContain('NOT SEL');   // resolution options enumerated, none selected
  });
  it('all three surfaces agree on the numeric deficit (single source)', () => {
    // PV-4B and RS-1 render the prose form ('14.5 ft'); the BOM row renders the
    // schedule form ('DEFICIT 14.5 FT'). Same number, one source.
    for (const html of [pv4b, rs1]) expect(html).toContain(deficitTxt);
    expect(sched).toContain(`DEFICIT ${ps.deficitFt} FT`);
  });
});

// ── TEST 7 — report-equals-rendered: payload deficit + blocker state match. ───
describe('§Q test 7 — evidence payload deficit + blocker state equal the rendered surfaces', () => {
  const { input, cad, ps, blocker } = buildInsufficientRender();
  const rs1 = renderReviewStatusSheets(input, cad);
  const payload = blocker.payload as Record<string, any>;

  it('payload deficit + procurement + designed equal the sufficiency object', () => {
    expect(payload.deficitFt).toBe(ps.deficitFt);
    expect(payload.procurementLengthFt).toBe(ps.procurementLengthFt);
    expect(payload.totalDesignedInstalledFt).toBe(ps.totalDesignedInstalledFt);
    expect(payload.verificationStatus).toBe('insufficient-unresolved');
    expect(payload.manufacturerDocumentAuthority).toBeNull();
  });
  it('the rendered RS-1 carries the payload deficit + the blocking state', () => {
    expect(rs1).toContain(`${payload.deficitFt} ft`);
    expect(rs1).toContain('BLOCKING');
    // report-equals-rendered: the blocker is BLOCKING (gates permit-ready)
    expect(classifyBlockerSeverity(blocker.code).severity).toBe('blocking');
    expect(input._snapshot.permitReadiness.ready).toBe(false);
  });
});
