// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-5 + WS-7 — Q-CABLE TOPOLOGY / PROCUREMENT ENGINE + ELECTRICAL CLOSURE
//
// THE Q-CABLE SET (the directive's 12):
//   Q1  a connector-SPACING change moves the totals (nothing is a constant)
//   Q2  a BRANCH-ORDER / assignment change moves the totals
//   Q3  ROW transitions are included in the installed path (not dropped)
//   Q4  the service-loop allowance is counted EXACTLY ONCE (Σ shares == total)
//   Q5  DEAD DROPS are deterministic (same geometry ⇒ same count, every time)
//   Q6  BRANCH-END requirements: one cable-end object per end, terminator at the
//       far end, home-run transition at the other — never a per-branch constant
//   Q7  AGGREGATE-vs-PER-BRANCH: a cable sufficient in aggregate but invalid for
//       one branch topology MUST fail
//   Q8  EXTENSION COMPATIBILITY is verified: a document naming a different SKU,
//       or a solution that does not name the deficient branch, cannot clear it
//   Q9  REBRANCH resolves where valid — and is REFUSED where the binding D-1
//       ruling forbids the extra homerun (with the arithmetic that proves it)
//   Q10 MISSING GEOMETRY ⇒ a scoped FIELD requirement, never a fabricated path
//   Q11 NO project constants in production code (grep-proof)
//   Q12 procurement CONSUMES the topology — one derivation, drop count is its
//       lower bound, and the BOM/assembly read the same number
//
// THE CONDUIT-FILL SET (WS-7):
//   C1  the COMPUTED NEC Ch.9 Table 1 fill clears CONDUIT-FILL-PENDING, with
//       resolver evidence + the audit reference deriveRequirementStatus demands
//   C2  a genuinely missing input ⇒ precise REQUIRES_INPUT naming that input
//   C3  the FOUR field-name mismatches are PINNED so they cannot regress
//   C4  the per-segment fill reaches the route segments (the same bug class)
//
// THE ROUTE-LENGTH SET (WS-7 split):
//   R1  the branch cable path is CAD-routed; only the un-routed runs remain
//   R2  the blocker names the residual segments and excludes the derived ones
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { unresolvedProcurementAuthority } from '../fixtures/synthetic-unresolved-procurement';
import { roofProject } from '../../test-fixtures/roofProject';
import {
  buildQCableTopology, evaluateQCableSolutions, evaluateBranchReassignment,
  type BuildQCableTopologyArgs, type QCableBranchInput,
} from '@/lib/permit/snapshot/qcableTopology';
import { evaluateConduitFillAuthority } from '@/lib/permit/snapshot/conduitFillAuthority';
import { runDerivedResolutionStage, DERIVED_RESOLVER_IDS } from '@/lib/permit/snapshot/resolution/derived';
import { buildProcurementSufficiency } from '@/lib/permit/snapshot/procurementSufficiency';
import { findTrunkCableSystem, listTrunkCableVariants, TRUNK_CABLE_SYSTEMS } from '@/lib/equipment/trunkCable';
import { deriveRequirementStatus, REQUIREMENT_DECLARATIONS } from '@/lib/permit/snapshot/releaseGates';
import type { PermitDesignSnapshot, CableExtensionSolution, QCableTopology } from '@/lib/permit/snapshot/types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const ENPHASE = findTrunkCableSystem('Enphase')!;
const PORTRAIT = ENPHASE.cables.find(c => c.orientation === 'portrait' && c.isDefaultForOrientation)!;

/** A synthetic array: `rows` rows of `perRow` modules at `pitch` ft spacing, with
 *  `rowGap` between rows. Purely test data — the engine takes coordinates only. */
function grid(opts: {
  rows: number; perRow: number; pitchFt: number; rowGapFt: number; planeId?: string; startRow?: number;
}): QCableBranchInput['modules'] {
  const out: QCableBranchInput['modules'] = [];
  for (let r = 0; r < opts.rows; r++) {
    for (let c = 0; c < opts.perRow; c++) {
      out.push({
        moduleInstanceId: `m-${opts.planeId ?? 'p1'}-${r}-${c}`,
        roofPlaneId: opts.planeId ?? 'p1',
        row: (opts.startRow ?? 0) + r, col: c,
        xFt: c * opts.pitchFt, yFt: r * opts.rowGapFt,
      });
    }
  }
  return out;
}

function topo(over?: Partial<BuildQCableTopologyArgs>): QCableTopology {
  const modules = grid({ rows: 1, perRow: 8, pitchFt: 3.5, rowGapFt: 7 });
  const t = buildQCableTopology({
    system: ENPHASE,
    cable: PORTRAIT,
    orientation: 'portrait',
    modulePitchFt: 3.5,
    wasteFactor: 1.15,
    branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: modules.length, modules }],
    ...over,
  })!;
  expect(t, 'topology must build').toBeTruthy();
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════
// Q1 — a connector-SPACING change moves the totals
// ═══════════════════════════════════════════════════════════════════════════
describe('Q1 — connector spacing is an input, and changing it moves every total', () => {
  it('a longer molded pitch changes the ordered sections and the procurement length', () => {
    const a = topo();
    const wide = ENPHASE.cables.find(c => c.sku === 'Q-12-25-200')!;
    const b = topo({ cable: wide });
    expect(a.connectorSpacingFt).not.toBe(b.connectorSpacingFt);
    expect(b.totals.procurementLengthFt).not.toBe(a.totals.procurementLengthFt);
    expect(b.totals.dropBasisProcurementLengthFt).toBeGreaterThan(a.totals.dropBasisProcurementLengthFt);
    // the drop COUNT is invariant (one connector per micro) — only footage moves
    expect(b.totals.dropCount).toBe(a.totals.dropCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q2 — a BRANCH-ORDER / assignment change moves the totals
// ═══════════════════════════════════════════════════════════════════════════
describe('Q2 — the branch assignment is an input, and changing it moves the totals', () => {
  it('splitting one branch into two changes the installed path and the ordered cable', () => {
    const all = grid({ rows: 1, perRow: 8, pitchFt: 3.5, rowGapFt: 7 });
    const one = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: all }] });
    const two = topo({
      branches: [
        { branchId: 'b1', branchLabel: 'B1', moduleCount: 4, modules: all.slice(0, 4) },
        { branchId: 'b2', branchLabel: 'B2', moduleCount: 4, modules: all.slice(4) },
      ],
    });
    // two branches ⇒ two home-run lead-ins ⇒ a longer TOTAL installed path
    expect(two.totals.installedLengthFt).toBeGreaterThan(one.totals.installedLengthFt);
    expect(two.totals.terminatorsRequired).toBe(2);
    expect(one.totals.terminatorsRequired).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q3 — ROW transitions are included in the installed path
// ═══════════════════════════════════════════════════════════════════════════
describe('Q3 — row transitions are part of the path, and are classified from the layout indices', () => {
  it('a two-row branch is LONGER than a one-row branch of the same device count', () => {
    const flat = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: grid({ rows: 1, perRow: 8, pitchFt: 3.5, rowGapFt: 7 }) }] });
    const twoRow = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: grid({ rows: 2, perRow: 4, pitchFt: 3.5, rowGapFt: 7 }) }] });
    expect(twoRow.branches[0].rowTransitionCount).toBeGreaterThan(0);
    expect(twoRow.branches[0].rowTransitionFt).toBeGreaterThan(0);
    expect(twoRow.totals.installedLengthFt).toBeGreaterThan(flat.totals.installedLengthFt);
    // the transition class comes from the ROW INDEX, not a length threshold
    const hop = twoRow.branches[0].drops.find(d => d.transition === 'row-transition')!;
    expect(hop).toBeTruthy();
    expect(hop.segmentFromPreviousFt).toBeGreaterThan(0);
  });

  it('a hop to another roof PLANE is an array transition, not a row transition', () => {
    const a = grid({ rows: 1, perRow: 4, pitchFt: 3.5, rowGapFt: 7, planeId: 'pA' });
    const b = grid({ rows: 1, perRow: 4, pitchFt: 3.5, rowGapFt: 7, planeId: 'pB' })
      .map(m => ({ ...m, xFt: m.xFt + 40 }));
    const t = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: [...a, ...b] }] });
    expect(t.branches[0].arrayTransitionCount).toBe(1);
    expect(t.totals.bridgeCount).toBe(1);
    expect(t.bridgeRequirements[0].gapFt).toBeGreaterThan(t.connectorSpacingFt!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q4 — the service-loop allowance is counted EXACTLY ONCE
// ═══════════════════════════════════════════════════════════════════════════
describe('Q4 — a documented service-loop allowance is applied once, apportioned by path', () => {
  const ALLOW = {
    allowanceFt: 26,
    documentId: 'SYNTHETIC-TEST-ALLOWANCE (not manufacturer evidence)',
    note: 'stricter-only synthetic allowance', provenance: 'aac-ws5-test-synthetic-allowance',
  };
  it('Σ per-branch shares equals the total allowance exactly, and it is never double-counted', () => {
    const t = topo({
      serviceLoopAllowance: ALLOW,
      branches: [
        { branchId: 'b1', branchLabel: 'B1', moduleCount: 6, modules: grid({ rows: 1, perRow: 6, pitchFt: 3.5, rowGapFt: 7 }) },
        { branchId: 'b2', branchLabel: 'B2', moduleCount: 4, modules: grid({ rows: 1, perRow: 4, pitchFt: 3.5, rowGapFt: 7, planeId: 'p1' }) },
      ],
    });
    const sum = t.branches.reduce((s, b) => s + b.serviceLoopAllowanceShareFt, 0);
    expect(Math.round(sum * 10) / 10).toBe(ALLOW.allowanceFt);
    expect(t.serviceLoopAllowanceFt).toBe(ALLOW.allowanceFt);
    expect(t.allowanceProvenance).toBe(ALLOW.provenance);
    // the requirement rises by EXACTLY the allowance (counted once, not per branch)
    const without = topo({ branches: t.branches.map(b => ({ branchId: b.branchId, branchLabel: b.branchLabel, moduleCount: b.moduleCount, modules: b.drops.map(d => ({ moduleInstanceId: d.moduleInstanceId, roofPlaneId: d.roofPlaneId, row: d.row, col: d.col, xFt: d.xFt, yFt: d.yFt })) })) });
    const delta = t.totals.requiredLengthFt - without.totals.requiredLengthFt;
    expect(Math.round(delta)).toBe(ALLOW.allowanceFt);
  });

  it('no allowance ⇒ 0 with recorded provenance (never an invented number)', () => {
    const t = topo();
    expect(t.serviceLoopAllowanceFt).toBe(0);
    expect(t.allowanceProvenance).toBe('no-allowance-authority-recorded');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q5 — DEAD DROPS are deterministic
// ═══════════════════════════════════════════════════════════════════════════
describe('Q5 — dead drops are derived, deterministic and cappable only when documented', () => {
  it('identical geometry produces an identical dead-drop count, every time', () => {
    const mk = () => topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: grid({ rows: 2, perRow: 4, pitchFt: 3.5, rowGapFt: 9 }) }] });
    const a = mk(), b = mk();
    expect(a.totals.deadDropCount).toBe(b.totals.deadDropCount);
    expect(JSON.stringify(a.branches[0].drops)).toBe(JSON.stringify(b.branches[0].drops));
  });

  it('a brand with no documented unused-connector rule cannot treat a dead drop as cappable', () => {
    const noRule = { ...ENPHASE, spliceInstallRule: null };
    const t = buildQCableTopology({
      system: noRule, cable: PORTRAIT, orientation: 'portrait', modulePitchFt: 3.5, wasteFactor: 1.15,
      branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: grid({ rows: 2, perRow: 4, pitchFt: 3.5, rowGapFt: 9 }) }],
    })!;
    expect(t.deadDropTreatment.established).toBe(false);
    expect(t.totals.sealingCapsRequired).toBe(0);
    expect(t.fieldDependentPortion.join(' ')).toMatch(/no documented unused-connector/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q6 — BRANCH-END requirements
// ═══════════════════════════════════════════════════════════════════════════
describe('Q6 — cable ends are objects: a far-end terminator and a home-run transition', () => {
  it('each branch enumerates exactly two ends, and the terminator belongs to the far end', () => {
    const t = topo({
      branches: [
        { branchId: 'b1', branchLabel: 'B1', moduleCount: 5, modules: grid({ rows: 1, perRow: 5, pitchFt: 3.5, rowGapFt: 7 }) },
        { branchId: 'b2', branchLabel: 'B2', moduleCount: 5, modules: grid({ rows: 1, perRow: 5, pitchFt: 3.5, rowGapFt: 7 }) },
      ],
    });
    for (const b of t.branches) {
      expect(b.cableEnds).toHaveLength(2);
      const far = b.cableEnds.find(e => e.kind === 'far-end')!;
      const home = b.cableEnds.find(e => e.kind === 'homerun-transition')!;
      expect(far.treatment).toBe('terminator');
      expect(far.treatmentSku).toBe(ENPHASE.connectors.terminator.sku);
      expect(home.treatment).toBe('homerun-transition');
      expect(b.terminatorsRequired).toBe(1);
    }
    expect(t.totals.terminatorsRequired).toBe(2);
    // the home-run transition POINT is not in the model — stated, never invented
    expect(t.branches[0].homerunTransition.established).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q7 — AGGREGATE-vs-PER-BRANCH (the mandated failure mode)
// ═══════════════════════════════════════════════════════════════════════════
describe('Q7 — sufficient in AGGREGATE but invalid for one branch MUST fail', () => {
  const PATH = (id: string, label: string, drops: number, designed: number, procurement: number) => ({
    branchId: id, branchLabel: label, moduleCount: drops, dropCount: drops,
    designedInstalledLengthFt: designed, connectorSpacingFt: 4.25,
    procurementLengthFt: procurement, wasteFactor: 1.15,
    lengthProvenance: 'geometry-derived' as const, derivation: 'test',
    provenance: { source: 'test' },
  });
  const ASM = () => ({
    assemblyId: 'A', manufacturer: 'Enphase', ecosystem: 'IQ Q-Cable', model: 'Q-12-10-240', sku: 'Q-12-10-240',
    skuNote: null, conductorConstruction: 'two-wire', conductorCount: 2, conductorGauge: '#12 AWG',
    insulationListing: 'UL 9703', wiringMethodLabel: 'ENPHASE Q CABLE (TC-ER)',
    connectorArchitecture: 'iq-q-cable-drop-connector' as const, connectorSpacingFt: 4.25,
    maxBranchCurrentA: 20, compatibleMicroModels: ['IQ8A'], cableLengthFt: 150, dropCount: 30,
    unusedDropCapSku: 'Q-SEAL-10', terminatorSku: 'Q-TERM-10', sourceDocument: 'test',
    verificationStatus: 'catalog-sourced' as const, provenance: { source: 'test' },
  });

  it('Σ designed ≤ Σ procurement, yet ONE short branch makes the package insufficient', () => {
    // aggregate: 130 designed vs 150 procurement (clears); branch B2: 70 vs 50 (short)
    const ps = buildProcurementSufficiency({
      assembly: ASM(),
      branchPaths: [PATH('b1', 'B1', 10, 30, 50), PATH('b2', 'B2', 10, 70, 50), PATH('b3', 'B3', 10, 30, 50)],
      selectedSystem: 'Enphase IQ8A',
    })!;
    expect(ps.totalDesignedInstalledFt!).toBeLessThanOrEqual(ps.procurementLengthFt!);   // aggregate clears
    expect(ps.insufficient).toBe(true);                                                  // per branch it does not
    expect(ps.affectedBranchIds).toEqual(['b2']);
    expect(ps.deficitFt).toBeGreaterThan(0);
  });

  it('an option that covers the aggregate but leaves a branch short is NOT viable', () => {
    const t = topo({
      branches: [
        { branchId: 'b1', branchLabel: 'B1', moduleCount: 3, modules: grid({ rows: 1, perRow: 3, pitchFt: 3.5, rowGapFt: 7 }) },
        // B2's devices are strung out at 8 ft — far beyond the 4.25 ft molded pitch
        { branchId: 'b2', branchLabel: 'B2', moduleCount: 3, modules: grid({ rows: 1, perRow: 3, pitchFt: 8, rowGapFt: 7 }) },
      ],
    });
    const ev = evaluateQCableSolutions({
      topology: t, system: ENPHASE, selectedSystem: 'Enphase IQ8A', maxDevicesPerBranch: 10,
    });
    const asOrdered = ev.options.find(o => o.optionId === 'stock-as-ordered')!;
    const shortBranch = asOrdered.perBranch.find(p => !p.sufficient);
    expect(shortBranch, 'anti-vacuity: a short branch must exist').toBeTruthy();
    expect(asOrdered.viable).toBe(false);
    expect(asOrdered.blockingReasons.join(' ')).toContain(shortBranch!.branchId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q8 — EXTENSION COMPATIBILITY is verified
// ═══════════════════════════════════════════════════════════════════════════
describe('Q8 — a listed extension clears only when it is verified AND covers the branch', () => {
  const bridged = () => topo({
    branches: [{
      branchId: 'b1', branchLabel: 'B1', moduleCount: 8,
      modules: [
        ...grid({ rows: 1, perRow: 4, pitchFt: 3.5, rowGapFt: 7, planeId: 'pA' }),
        ...grid({ rows: 1, perRow: 4, pitchFt: 3.5, rowGapFt: 7, planeId: 'pB' }).map(m => ({ ...m, xFt: m.xFt + 40 })),
      ],
    }],
  });
  const SOL = (over?: Partial<CableExtensionSolution>): CableExtensionSolution => ({
    solutionId: 'sol-1', kind: 'verified-jumper-extension', selectedSku: 'Q-EXT-TEST',
    quantity: 1, addedLengthFt: 200, locations: ['b1'], compatibilityVerified: true,
    compatibleSystemNote: 'Enphase IQ8A', manufacturerDocument: {
      documentId: 'doc-1', documentClass: 'ul_listing', documentIdentity: 'test',
      verificationState: 'verified', status: 'current', archivedInRepo: true,
      sha256: 'a'.repeat(64), coversExtensionSku: 'Q-EXT-TEST', compatibleSystem: 'Enphase IQ8A',
      revisionOrDate: '2026-01-01',
    },
    representedInDrawings: true, representedInSchedules: true, representedInBom: true,
    vdInstallationRecalculated: true, note: null, provenance: { source: 'test' },
    ...over,
  });

  it('a document naming a DIFFERENT product cannot clear the deficit', () => {
    const t = bridged();
    const wrongDoc = SOL();
    wrongDoc.manufacturerDocument = { ...wrongDoc.manufacturerDocument!, coversExtensionSku: 'SOME-OTHER-SKU' };
    const ev = evaluateQCableSolutions({
      topology: t, system: ENPHASE, selectedSystem: 'Enphase IQ8A', maxDevicesPerBranch: 10,
      cableExtensionSolutions: [wrongDoc],
    });
    const opt = ev.options.find(o => o.optionId.startsWith('verified-listed-extension:'))!;
    expect(opt.viable).toBe(false);
    expect(opt.blockingReasons.join(' ')).toMatch(/document covers/i);
  });

  it('a verified solution that does not NAME the deficient branch cannot clear it', () => {
    const t = bridged();
    const elsewhere = SOL({ locations: ['b-other'], cableSegmentIds: [] });
    const ev = evaluateQCableSolutions({
      topology: t, system: ENPHASE, selectedSystem: 'Enphase IQ8A', maxDevicesPerBranch: 10,
      cableExtensionSolutions: [elsewhere],
    });
    const opt = ev.options.find(o => o.optionId.startsWith('verified-listed-extension:'))!;
    expect(opt.viable).toBe(false);
    expect(opt.blockingReasons.join(' ')).toMatch(/not named by this solution/i);
  });

  it('with no solution at all the option states the exact retrieval failure', () => {
    const ev = evaluateQCableSolutions({
      topology: bridged(), system: ENPHASE, selectedSystem: 'Enphase IQ8A', maxDevicesPerBranch: 10,
      extensionLookupNote: 'no verified extension document resolved (manufacturer_document_registry — migration 113)',
    });
    const opt = ev.options.find(o => o.optionId === 'verified-listed-extension')!;
    expect(opt.viable).toBe(false);
    expect(opt.blockingReasons[0]).toMatch(/migration 113/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q9 — REBRANCH resolves where valid, and is REFUSED where D-1 forbids it
// ═══════════════════════════════════════════════════════════════════════════
describe('Q9 — branch reassignment is proposed where valid and refused where the ruling forbids it', () => {
  it('REFUSED when plane containment would need more than the D-1 minimum branch count', () => {
    // 12 devices on plane A + 19 on plane B at an 11-device limit: minimum 3
    // branches, but plane containment needs 2 + 2 = 4 ⇒ refuse with the arithmetic.
    const a = grid({ rows: 2, perRow: 6, pitchFt: 3.5, rowGapFt: 7, planeId: 'pA' });
    const b = grid({ rows: 2, perRow: 10, pitchFt: 3.5, rowGapFt: 7, planeId: 'pB' }).slice(0, 19)
      .map(m => ({ ...m, xFt: m.xFt + 60 }));
    const all = [...a, ...b];
    const t = topo({ branches: [
      { branchId: 'b1', branchLabel: 'B1', moduleCount: 11, modules: all.slice(0, 11) },
      { branchId: 'b2', branchLabel: 'B2', moduleCount: 10, modules: all.slice(11, 21) },
      { branchId: 'b3', branchLabel: 'B3', moduleCount: 10, modules: all.slice(21) },
    ] });
    const opt = evaluateBranchReassignment(t, { maxDevicesPerBranch: 11 })!;
    expect(opt.viable).toBe(false);
    expect(opt.blockingReasons[0]).toMatch(/D-1 branch-assignment ruling/);
    expect(opt.blockingReasons[0]).toMatch(/extra homerun/);
    expect((opt.payload as { minBranchCount: number }).minBranchCount).toBe(3);
    expect((opt.payload as { planeContainedCount: number }).planeContainedCount).toBe(4);
  });

  it('PROPOSED (never applied) when plane containment fits inside the minimum count', () => {
    const a = grid({ rows: 1, perRow: 5, pitchFt: 3.5, rowGapFt: 7, planeId: 'pA' });
    const b = grid({ rows: 1, perRow: 5, pitchFt: 3.5, rowGapFt: 7, planeId: 'pB' }).map(m => ({ ...m, xFt: m.xFt + 60 }));
    // one branch currently CROSSES the two planes; the minimum count is 2 and a
    // plane-contained partition also needs 2 ⇒ a valid reassignment exists.
    const t = topo({ branches: [
      { branchId: 'b1', branchLabel: 'B1', moduleCount: 5, modules: [...a.slice(0, 3), ...b.slice(0, 2)] },
      { branchId: 'b2', branchLabel: 'B2', moduleCount: 5, modules: [...a.slice(3), ...b.slice(2)] },
    ] });
    const opt = evaluateBranchReassignment(t, { maxDevicesPerBranch: 5 })!;
    expect((opt.payload as { proposedBranches: unknown[] }).proposedBranches).toHaveLength(2);
    expect(opt.autoAdoptable, 'a design change is never auto-adopted').toBe(false);
    expect(opt.changesPhysicalDesign).toBe(true);
    if (opt.viable) expect(opt.requiresAction).toMatch(/DESIGN action/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q10 — MISSING GEOMETRY ⇒ a scoped FIELD requirement
// ═══════════════════════════════════════════════════════════════════════════
describe('Q10 — absent per-device coordinates produce a scoped field requirement, not a path', () => {
  it('the branch is labelled ESTIMATED, the coverage drops, and the branch is named', () => {
    const t = topo({
      branches: [
        { branchId: 'b1', branchLabel: 'B1', moduleCount: 5, modules: grid({ rows: 1, perRow: 5, pitchFt: 3.5, rowGapFt: 7 }) },
        { branchId: 'b2', branchLabel: 'B2', moduleCount: 5, modules: [] },
      ],
    });
    expect(t.geometryCoverage).toBe('partial');
    expect(t.branches[1].geometryCoverage).toBe('none');
    expect(t.fieldDependentPortion.join(' ')).toContain('B2');
    expect(t.branches[1].derivation).toMatch(/ESTIMATE, not a routed path/);
  });

  it('a reassignment cannot be evaluated without the geometry (it says so)', () => {
    const t = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 5, modules: [] }] });
    const opt = evaluateBranchReassignment(t, { maxDevicesPerBranch: 10 })!;
    expect(opt.viable).toBe(false);
    expect(opt.blockingReasons[0]).toMatch(/coordinates are not established/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q11 — NO project constants in production code (grep-proof)
// ═══════════════════════════════════════════════════════════════════════════
describe('Q11 — the engine carries no project constants', () => {
  it('no Braidon figure (31 drops / 152 / 166.5 / 140.5 / 14.5) is hardcoded in the engine', () => {
    const files = [
      'lib/permit/snapshot/qcableTopology.ts',
      'lib/permit/snapshot/conduitFillAuthority.ts',
      'lib/permit/snapshot/resolution/derived.ts',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
        // strip comments — the prose explains the defect using its numbers
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const lit of ['166.5', '140.5', '14.5', '152', '31']) {
        expect(src, `${rel} hardcodes the project figure ${lit}`).not.toMatch(new RegExp(`(^|[^\\w.])${lit.replace('.', '\\.')}([^\\w]|$)`));
      }
    }
  });

  it('every quantity the engine emits traces to an input (catalog, geometry or authority)', () => {
    const t = topo();
    expect(t.connectorSpacingFt).toBe(PORTRAIT.connectorSpacingFt);   // catalog
    expect(t.totals.dropCount).toBe(8);                               // the branch input
    expect(t.wasteFactor).toBe(1.15);                                 // the passed authority
    expect(t.deadDropTreatment.basis).toContain('DSH-00247');         // the datasheet
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Q12 — procurement CONSUMES the topology (one derivation)
// ═══════════════════════════════════════════════════════════════════════════
describe('Q12 — the drop-count order is the LOWER BOUND of the topology derivation', () => {
  it('ordered sections are never fewer than the drops, and the derivation states both', () => {
    const t = topo({ branches: [{ branchId: 'b1', branchLabel: 'B1', moduleCount: 8, modules: grid({ rows: 2, perRow: 4, pitchFt: 3.5, rowGapFt: 9 }) }] });
    expect(t.totals.orderedSections).toBeGreaterThanOrEqual(t.totals.dropCount);
    expect(t.derivation).toContain('LOWER BOUND');
    expect(t.totals.dropBasisProcurementLengthFt).toBeGreaterThan(0);
  });

  it('a design with no transition beyond the pitch orders exactly one section per drop', () => {
    const t = topo();      // a single row at 3.5 ft spacing, under the 4.25 ft pitch
    expect(t.totals.orderedSections).toBe(t.totals.dropCount);
    expect(t.totals.deadDropCount).toBe(0);
  });

  it('the alternate-variant option space reaches the WHOLE catalog, not two SKUs', () => {
    const variants = listTrunkCableVariants(ENPHASE, { orientation: 'portrait', modulePitchFt: 3.5 });
    expect(variants.length).toBeGreaterThanOrEqual(7);
    expect(variants.every(v => v.applicable)).toBe(true);
    // a pitch SHORTER than the module spacing cannot reach the next module
    const tooShort = listTrunkCableVariants(ENPHASE, { orientation: 'portrait', modulePitchFt: 5 })
      .filter(v => !v.applicable);
    expect(tooShort.length).toBeGreaterThan(0);
    expect(tooShort[0].reason).toMatch(/cannot reach/);
  });

  it('every brand system in the catalog is reachable (no silent two-SKU ceiling)', () => {
    for (const sys of TRUNK_CABLE_SYSTEMS) {
      expect(findTrunkCableSystem(sys.brand)?.brand).toBe(sys.brand);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C1..C4 — CONDUIT FILL (WS-7)
// ═══════════════════════════════════════════════════════════════════════════
describe('C — the conduit-fill authority', () => {
  const COMPLETE = {
    segmentId: 'COMBINER_TO_DISCO_RUN', racewayType: 'PVC Sch 80', racewaySize: '1-1/4"',
    conductorCount: 3, conductorGauge: '#6 AWG', insulation: 'THWN-2', egcGauge: '#10 AWG',
    codeEdition: '2020', computedFillPct: 29, computedPass: true,
  };

  it('C1 — a COMPUTED fill clears the requirement and carries its derivation', () => {
    const ev = evaluateConduitFillAuthority(COMPLETE);
    expect(ev.cleared).toBe(true);
    expect(ev.record.state).toBe('computed');
    expect(ev.record.fillPct).toBe(29);
    expect(ev.record.limitPct).toBe(40);
    expect(ev.record.necBasis).toMatch(/Chapter 9, Table 1/);
    expect(ev.record.derivation).toContain('2020');
  });

  it('C2 — a missing input produces a PRECISE REQUIRES_INPUT naming that input', () => {
    for (const [field, patch] of [
      ['electrical.feeder.raceway.type', { racewayType: null }],
      ['electrical.feeder.raceway.tradeSize', { racewaySize: null }],
      ['electrical.feeder.conductorGauge', { conductorGauge: null }],
      ['electrical.feeder.insulation', { insulation: null }],
      ['codeAuthority.editions.nec', { codeEdition: null }],
      ['electrical.conduitFill.fillPercent', { computedFillPct: null }],
    ] as const) {
      const ev = evaluateConduitFillAuthority({ ...COMPLETE, ...(patch as object) });
      expect(ev.cleared, field).toBe(false);
      expect(ev.missing, field).toContain(field);
      expect(ev.record.state).toBe('incomplete');
    }
  });

  it('C1b — the derived resolver records evidence + the clearing audit reference', () => {
    const out = runDerivedResolutionStage({
      nowIso: '2026-07-27T12:00:00.000Z',
      conduitFill: evaluateConduitFillAuthority(COMPLETE),
      routeSegments: [], physicalRaceways: [], feederRacewayResolved: true,
      isMicro: false, branchRacewayAmbiguous: false, branchRacewayReasons: [],
      racewaySegmentConflicts: [], qcableTopology: null, qcableEvaluation: null,
      procurementSufficiency: null, qcableProcurement: null,
    });
    const st = out.states['CONDUIT-FILL-PENDING'];
    expect(st.cleared).toBe(true);
    expect(st.resolverId).toBe('conduit-fill@v1');
    expect(st.resolutionAuditRef).toBeTruthy();
    expect(st.resolutionEvidence.some(e => e.outcome === 'RESOLVED')).toBe(true);
    // the clearing contract: resolved WITHOUT an audit ref stays OPEN
    const status = deriveRequirementStatus({ resolved: true, resolutionAuditRef: st.resolutionAuditRef } as never);
    expect(status).not.toBe('OPEN');
    expect(deriveRequirementStatus({ resolved: true, resolutionAuditRef: null } as never)).toBe('OPEN');
  });

  it('C1c — an INCOMPLETE fill never clears, and the resolver says REQUIRES_INPUT', () => {
    const out = runDerivedResolutionStage({
      nowIso: '2026-07-27T12:00:00.000Z',
      conduitFill: evaluateConduitFillAuthority({ ...COMPLETE, computedFillPct: null }),
      routeSegments: [], physicalRaceways: [], feederRacewayResolved: true,
      isMicro: false, branchRacewayAmbiguous: false, branchRacewayReasons: [],
      racewaySegmentConflicts: [], qcableTopology: null, qcableEvaluation: null,
      procurementSufficiency: null, qcableProcurement: null,
    });
    const st = out.states['CONDUIT-FILL-PENDING'];
    expect(st.cleared).toBe(false);
    expect(st.resolutionAuditRef).toBeNull();
    expect(st.retryability).toBe('REQUIRES_INPUT');
    expect(st.blockingReason).toMatch(/canonical electrical engine/);
  });

  it('C3 — the FOUR field-name mismatches are pinned (they cannot regress)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/permit/snapshot/computeSystemProjection.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    // (1) the schedule row is found by the feeder's own from/to, not by a
    //     `contains` / `segments` field the row does not have
    expect(src).not.toMatch(/r\?\.contains|r\?\.segments/);
    expect(src).toMatch(/r\?\.from/);
    // (2)(3)(4) every field is read by its REAL name
    expect(src).not.toMatch(/conduitRow\?\.fillPercent/);
    expect(src).not.toMatch(/\.conduitFillPercent/);
    expect(src).not.toMatch(/conduitRow\?\.passes/);
    expect(src).toMatch(/conduitRow\?\.fillPct/);
    expect(src).toMatch(/feeder\?\.conduitFillPct/);
    expect(src).toMatch(/feeder\?\.conduitFillPass/);
    // the same class in the snapshot build
    const build = fs.readFileSync(path.join(process.cwd(), 'lib/permit/snapshot/build.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(build).not.toMatch(/r\.conduitFillPercent/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE RENDERED PACKAGE — the fixture proves the whole path end to end
// ═══════════════════════════════════════════════════════════════════════════
describe('the built package: WS-7 clears the fill, WS-5 evaluates the option space', () => {
  const input: any = clone(braidonOriginalAuditFixture);
  // WS-2 — the option-space evaluation is what the engine produces while the
  // procurement is UNRESOLVED. The live design now resolves it from archived
  // manufacturer authority, so that state is manufactured here by refusing the
  // field-termination authority (tests/fixtures/synthetic-unresolved-procurement).
  const html = generatePermitHTML(input, undefined, unresolvedProcurementAuthority() as any);
  const snap = input._snapshot as PermitDesignSnapshot;
  const el = snap.electrical as unknown as Record<string, any>;

  it('C4 — the computed fill reaches the snapshot AND the per-segment records', () => {
    expect(el.conduitFillAuthority?.state).toBe('computed');
    expect(el.conduitFillAuthority?.fillPct).toBeGreaterThan(0);
    const inConduit = (el.routeSegments as any[]).filter(r => r.raceway && r.raceway !== 'FREE_AIR');
    expect(inConduit.length).toBeGreaterThan(0);
    for (const r of inConduit) expect(r.fillPct, `${r.segmentId} fill`).not.toBeNull();
    // an open-air run carries NO fill (a raceway percentage without a raceway is meaningless)
    for (const r of (el.routeSegments as any[]).filter(r => r.raceway === 'FREE_AIR')) {
      expect(r.fillPct).toBeNull();
    }
  });

  it('CONDUIT-FILL-PENDING no longer fires (it was a discarded calculation, not a field condition)', () => {
    const codes = (snap.permitReadiness.registry ?? []).map(r => r.code);
    expect(codes).not.toContain('CONDUIT-FILL-PENDING');
  });

  it('R1 — the branch cable path is CAD-ROUTED; the un-routed runs remain estimates', () => {
    const segs = el.routeSegments as any[];
    const branch = segs.find(s => s.segmentId === 'BRANCH_RUN');
    expect(branch.lengthSource).toBe('cad-route');
    // …but the VERIFICATION state is unchanged: nothing short of a field
    // measurement is verified.
    // WS-5: this assertion PINNED the BRANCH_RUN contradiction — it required the
    // verification state to say 'estimate' on a segment whose lengthSource says
    // 'cad-route'. Source and verification are different questions; a routed CAD
    // geometry is geometry-derived, and still not field evidence.
    expect(branch.lengthSource).toBe('cad-route');
    expect(branch.verificationStatus).toBe('geometry-derived');
    expect(segs.some(s => s.lengthSource === 'cad-derived-estimate')).toBe(true);
  });

  it('R2 — ROUTE-LENGTH-ESTIMATE names ONLY the residual segments', () => {
    const entry = (snap.permitReadiness.registry ?? []).find(r => r.code === 'ROUTE-LENGTH-ESTIMATE')!;
    expect(entry).toBeTruthy();
    const p = entry.payload as any;
    expect(p.residualSegmentIds).not.toContain('BRANCH_RUN');
    expect(p.geometryDerivedSegmentIds).toContain('BRANCH_RUN');
    expect(p.residualSegmentIds.length).toBeGreaterThan(0);
    expect(entry.explanation).not.toMatch(/^Electrical run lengths are CAD-derived estimates/);
  });

  it('the topology object is on the snapshot with the directive field list', () => {
    const t = el.qcableTopology;
    expect(t?.present).toBe(true);
    for (const f of ['branches', 'totals', 'deadDropTreatment', 'extensionStock', 'geometryCoverage',
      'confidence', 'fieldDependentPortion', 'derivation', 'bridgeRequirements'] as const) {
      expect(t[f], `topology.${f}`).toBeDefined();
    }
    const b = t.branches[0];
    for (const f of ['orderedModuleIds', 'drops', 'interModuleSegmentsFt', 'rowTransitionCount',
      'arrayTransitionCount', 'homerunTransition', 'cableEnds', 'installedLengthFt',
      'procurementLengthFt', 'orderedSections', 'deadDropCount', 'sufficient'] as const) {
      expect(b[f], `branch.${f}`).toBeDefined();
    }
    expect(t.totals.dropCount).toBe(t.branches.reduce((s: number, x: any) => s + x.dropCount, 0));
  });

  it('the deficit blocker carries the OPTION EVALUATION and a precise unresolved reason', () => {
    const entry = (snap.permitReadiness.registry ?? []).find(r => r.code === 'QCABLE-PROCUREMENT-INSUFFICIENT');
    expect(entry, 'the fixture has a genuine per-branch deficit').toBeTruthy();
    const ev = (entry!.payload as any).optionEvaluation;
    expect(ev.options.length).toBeGreaterThan(5);
    expect(ev.unresolvedReason).toBeTruthy();
    expect(ev.unresolvedReason).not.toMatch(/^Q-Cable procurement \d+ ft is SHORT/);   // never a bare deficit
    // the evaluation names the manufacturer's documented method for the bridge
    expect(JSON.stringify(ev)).toMatch(/raw-cable-jumper/);
    // …and the RS-1 sheet renders the deficit payload for THAT blocker
    expect(html).toContain('DEFICIT PAYLOAD:');
  });

  it('Q12b — where the composition IS adopted, the BOM orders the topology quantity', () => {
    // The frozen fixture cannot adopt (its sub-array bridge blocks the
    // composition), so the BOM-consumption path is proven on a package that
    // does: a single-plane roof whose module spacing exceeds the molded pitch.
    const inp: any = clone(roofProject);
    inp.project = inp.project ?? {};
    inp.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    generatePermitHTML(inp);
    const s2 = inp._snapshot as PermitDesignSnapshot;
    const t = (s2.electrical as unknown as Record<string, any>).qcableTopology;
    const ps = (s2.electrical as unknown as Record<string, any>).procurementSufficiency;
    expect(t?.present, 'this control package must build a topology').toBe(true);
    expect(ps.adoptedOptionId, 'the control package must adopt the composition').toBe('derived-stock-order-composition');
    const bom = (inp.bom ?? []) as Array<Record<string, any>>;
    const trunk = bom.find(r => r.category === 'trunk_cable')!;
    const caps = bom.find(r => r.category === 'sealing_cap')!;
    // ONE derivation: the ordered quantity IS the topology's section count, and
    // the drop count is its lower bound.
    expect(trunk.quantity).toBe(t.totals.orderedSections);
    expect(trunk.quantity).toBeGreaterThanOrEqual(t.totals.dropCount);
    expect(String(trunk.derivedFrom)).toMatch(/topology/i);
    // the caps follow the dead drops the composition creates — no longer PENDING
    expect(caps.quantity).toBe(t.totals.sealingCapsRequired);
    expect(caps.quantityState).toBe('established');
    // and the assembly's own footage claim states the same number
    expect((s2.electrical as unknown as Record<string, any>).listedCableAssembly.cableLengthFt)
      .toBe(Math.round(ps.procurementLengthFt));
  });

  it('the derived resolvers are declared, implemented and evidenced', () => {
    for (const code of ['CONDUIT-FILL-PENDING', 'ROUTE-LENGTH-ESTIMATE', 'QCABLE-PROCUREMENT-INSUFFICIENT',
      'FEEDER-RACEWAY-AUTHORITY', 'BRANCH-RACEWAY-AUTHORITY', 'RACEWAY-SEGMENT-CONFLICT']) {
      const d = REQUIREMENT_DECLARATIONS[code];
      expect(d.resolverId, `${code} owner`).toBeTruthy();
      expect(d.resolverStage, `${code} stage`).toBe('derived');
      expect((DERIVED_RESOLVER_IDS as readonly string[])).toContain(d.resolverId!);
    }
  });
});
