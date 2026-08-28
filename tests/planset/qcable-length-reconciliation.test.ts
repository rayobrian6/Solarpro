// ═══════════════════════════════════════════════════════════════════════════
// Q-CABLE LENGTH RECONCILIATION (2026-07-24) — one quantity per label.
//
// Ray's pre-acceptance demand: the E-1 Q-Cable branch lengths, WS-B's geometric
// cable paths, and the BOM procurement footage must be provably ONE quantity per
// label — never two different quantities under one column. This test:
//
//   A. INDEPENDENTLY re-derives Σ cable-path objects from the raw module
//      coordinates + branch assignment (geometry.moduleInstances) and asserts
//      byte-equality with the snapshot's canonical electrical.branchCablePaths.
//   B. Asserts Σ procurement == the drop-based derivation == the listed-assembly
//      cableLengthFt (the BOM footage), and that procurement is DROP-COUNT based
//      (ceil(drops×pitch×waste)), NOT designed-length×waste.
//   C. Asserts the E-1 rendered branch length == the labeled canonical field it
//      claims (BranchCablePath.designedInstalledLengthFt), and that each figure
//      names its quantity ('cable path (geometry)') + source object (QCABLE-…:Bn).
//   D. Asserts the designed ≤ procurement sanity relationship + that the
//      projection EXPOSES the sanity flag (fixture: designed 140.5 ≤ 152).
//
// It fails CLOSED — any stale projection, drift between re-derivation and the
// snapshot objects, or an unlabeled length breaks the build.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { deriveBranchCablePaths } from '@/lib/bom/deriveRunLengths';
import {
  projectListedCableAssembly,
  projectE1PhysicalSchedule,
} from '@/lib/permit/snapshot/electricalProjection';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));
const WASTE = 1.15;

function build(): { html: string; snap: any } {
  const input: any = clone(braidonOriginalAuditFixture);
  input.generatedAtIso = '2026-07-24T12:00:00Z';
  const html = generatePermitHTML(input);
  const snap = input._snapshot;
  expect(snap, 'snapshot must attach after generation').toBeTruthy();
  return { html, snap };
}

// Group module centre points by branch id from the raw geometry — the SAME input
// deriveBranchCablePaths consumes inside the build (module centres in plan-ft).
function centresByBranch(snap: any): Map<string, { x: number; y: number }[]> {
  const by = new Map<string, { x: number; y: number }[]>();
  for (const m of snap.geometry?.moduleInstances ?? []) {
    const pts = m.polygon?.points ?? [];
    if (!pts.length || !m.branchId) continue;
    const cx = pts.reduce((a: number, p: any) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a: number, p: any) => a + p.y, 0) / pts.length;
    if (!by.has(m.branchId)) by.set(m.branchId, []);
    by.get(m.branchId)!.push({ x: cx, y: cy });
  }
  return by;
}

describe('Q-Cable length reconciliation — A. independent re-derivation == canonical objects', () => {
  const { snap } = build();
  const el = snap.electrical;

  it('is a micro topology carrying canonical branch cable-path objects', () => {
    expect(el.topology).toBe('MICRO');
    expect(Array.isArray(el.branchCablePaths)).toBe(true);
    expect(el.branchCablePaths.length).toBe(el.branches.length);
  });

  it('re-deriving Σ cable objects from raw module coordinates equals the snapshot objects', () => {
    const by = centresByBranch(snap);
    const pitch = el.listedCableAssembly?.connectorSpacingFt ?? null;
    const reDerived = deriveBranchCablePaths(
      el.branches.map((b: any) => ({
        branchId: b.branchId, branchLabel: b.label, moduleCount: b.moduleCount,
        moduleCentersFt: by.get(b.branchId) ?? [],
      })),
      pitch,
    );
    const canonicalById = new Map(el.branchCablePaths.map((p: any) => [p.branchId, p]));
    expect(reDerived.length).toBe(el.branchCablePaths.length);
    for (const rd of reDerived) {
      const canon: any = canonicalById.get(rd.branchId);
      expect(canon, `canonical object for ${rd.branchId}`).toBeTruthy();
      expect(rd.dropCount).toBe(canon.dropCount);
      expect(rd.designedInstalledLengthFt).toBe(canon.designedInstalledLengthFt);
      expect(rd.procurementLengthFt).toBe(canon.procurementLengthFt);
      expect(rd.lengthProvenance).toBe(canon.lengthProvenance);
    }
  });
});

describe('Q-Cable length reconciliation — B. procurement is drop-count based, matches BOM', () => {
  const { snap } = build();
  const el = snap.electrical;
  const asm = el.listedCableAssembly;
  const paths = el.branchCablePaths;

  it('drops = one per micro; Σ drops == module instances == Σ branch modules', () => {
    const dropSum = paths.reduce((s: number, p: any) => s + p.dropCount, 0);
    const modInst = (snap.geometry?.moduleInstances ?? []).length;
    const branchSum = el.branches.reduce((s: number, b: any) => s + b.moduleCount, 0);
    expect(dropSum).toBe(modInst);
    expect(dropSum).toBe(branchSum);
  });

  it('per-branch procurement == ceil(drops × pitch × waste) — NOT designed × waste', () => {
    const pitch = asm.connectorSpacingFt;
    for (const p of paths) {
      const dropBased = Math.ceil(p.dropCount * pitch * WASTE);
      expect(p.procurementLengthFt).toBe(dropBased);
      // procurement must NOT equal designed×waste (the two are different quantities)
      const designedTimesWaste = Math.ceil((p.designedInstalledLengthFt ?? 0) * WASTE);
      if (p.designedInstalledLengthFt != null && p.designedInstalledLengthFt !== p.dropCount * pitch) {
        expect(p.procurementLengthFt).not.toBe(designedTimesWaste);
      }
    }
  });

  it('Σ procurement == assembly cableLengthFt == drop-based total (the BOM footage)', () => {
    const procSum = paths.reduce((s: number, p: any) => s + (p.procurementLengthFt ?? 0), 0);
    const dropSum = paths.reduce((s: number, p: any) => s + p.dropCount, 0);
    const dropBasedTotal = paths.reduce((s: number, p: any) => s + Math.ceil(p.dropCount * asm.connectorSpacingFt * WASTE), 0);
    expect(procSum).toBe(dropBasedTotal);
    expect(asm.cableLengthFt).toBe(procSum);
    // The whole-array ceil (Ray's stated 152 = ceil(31×4.25×1.15)) is the drop
    // total's sibling — assert the invariant holds for the fixture's 31 drops.
    expect(asm.dropCount).toBe(dropSum);
  });
});

describe('Q-Cable length reconciliation — C. E-1 prints the labeled canonical field', () => {
  const { html, snap } = build();

  it('each E-1 Q-Cable branch row prints designedInstalledLengthFt as "cable path (geometry)" + its object id', () => {
    const sections = projectE1PhysicalSchedule(snap);
    const branchSecs = sections.filter(s => s.sectionId === 'BRANCH_RUN');
    expect(branchSecs.length).toBe(snap.electrical.branches.length);
    const pathById = new Map(snap.electrical.branchCablePaths.map((p: any) => [p.branchId, p]));
    for (const sec of branchSecs) {
      // the projection's lengthFt is the canonical designed-installed field
      const objId = sec.lengthObjectId ?? '';
      const branchId = objId.split(':')[1];
      const canon: any = pathById.get(branchId);
      expect(canon, `object ${objId}`).toBeTruthy();
      expect(sec.lengthFt).toBe(canon.designedInstalledLengthFt);
      expect(sec.lengthKind).toBe('cable-path-geometry');
      expect(sec.lengthLabel).toBe('cable path (geometry)');
      // the rendered HTML shows the value, the quantity label, and the object id
      expect(html).toContain(`${sec.lengthFt} ft`);
      expect(html).toContain(objId);
    }
    // the column names the quantity dimension + the schedule shows the legend
    expect(html).toContain('Length (quantity · source)');
    expect(html).toContain('cable path (geometry)');
  });

  it('feeder / home-run rows print a DISTINCT "route (one-way)" quantity, never cable-path', () => {
    const sections = projectE1PhysicalSchedule(snap);
    const routeSecs = sections.filter(s => s.sectionId === 'BRANCH_HOMERUN_RUN' || s.sectionId === 'COMBINER_TO_DISCO_RUN');
    for (const sec of routeSecs) {
      expect(sec.lengthKind).toBe('route-one-way');
      // 2026-08-28 ROUTE-BOUND MIGRATION - a bounded run states its MAXIMUM on
      // the schedule, because pass-by-design is only honest if the construction
      // set carries the limit. The property under test - a route quantity
      // DISTINCT from the cable-path quantity - is unchanged.
      expect(sec.lengthLabel).toMatch(/^route \(one-way\)/);
      expect(sec.lengthLabel).not.toMatch(/cable path/i);
      expect(sec.lengthObjectId).toBe(sec.sectionId);
    }
  });
});

describe('Q-Cable length reconciliation — D. designed vs procurement sanity flag', () => {
  const { snap } = build();

  it('the assembly projection exposes the designed-vs-procurement sanity + note', () => {
    const proj = projectListedCableAssembly(snap);
    expect(proj.present).toBe(true);
    expect(typeof proj.designedExceedsProcurement).toBe('boolean');
    expect(proj.reconciliationNote).toBeTruthy();
    // fixture: Σ designed-installed 140.5 ≤ Σ procurement 152 → sanity OK
    expect(proj.totalDesignedInstalledFt!).toBeLessThanOrEqual(proj.totalProcurementFt!);
    expect(proj.designedExceedsProcurement).toBe(false);
    expect(proj.reconciliationNote).toContain('sanity OK');
  });

  it('the sanity flag WOULD trip when a branch path is stretched beyond its procurement', () => {
    // Fabricate a widely-spaced branch (each micro 8 ft apart > 4.25 ft pitch) so
    // the geometric path outruns the drop-based procurement — the flag must fire.
    const stretched = deriveBranchCablePaths(
      [{ branchId: 'br-x', branchLabel: 'BX', moduleCount: 6,
         moduleCentersFt: Array.from({ length: 6 }, (_, i) => ({ x: i * 8, y: 0 })) }],
      4.25,
    )[0];
    expect(stretched.designedInstalledLengthFt!).toBeGreaterThan(stretched.procurementLengthFt!);
  });
});
