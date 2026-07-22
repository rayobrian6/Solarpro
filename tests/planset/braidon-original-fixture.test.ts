// W3.1 §1/§4/§5 — the frozen braidon-original-audit-fixture is an IMMUTABLE
// acceptance record. This test proves it still reconstructs the ORIGINAL audited
// Braidon design deterministically (zero DB), that the originally-audited failure
// classes are corrected, and that the §4 RT-MINI racking-capacity blocking gaps
// are promoted into permit-readiness blockers (build.ts) and covered by V32.
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function fixtureSnapshot(): PermitDesignSnapshot {
  const input = clone(braidonOriginalAuditFixture) as any;
  generatePermitHTML(input);
  return input._snapshot as PermitDesignSnapshot;
}

describe('W3.1 §1 — frozen original Braidon audit fixture identity', () => {
  const snap = fixtureSnapshot();

  it('reconstructs the original audited design (31 × Qcells 400W + IQ8A, 12.40 kW)', () => {
    expect(snap.derived.moduleCount).toBe(31);
    expect(Math.round(snap.derived.dcWattsStc)).toBe(12400);
    expect(snap.equipment.modules[0].catalogId).toBe('qcells-peak-duo-400');
    expect(snap.equipment.microInverters[0].model).toMatch(/IQ8A/);
  });

  it('plans 3 legal micro branches at 11/10/10', () => {
    expect(snap.electrical.branches.map(b => b.moduleCount)).toEqual([11, 10, 10]);
    for (const b of snap.electrical.branches) expect(b.ocpdA).toBeLessThanOrEqual(20);
  });

  it('is roof-mounted on the RT-MINI assembly', () => {
    expect(snap.structural.rackingAssembly?.mountModel).toMatch(/RT-?MINI/i);
    expect(snap.structural.rails.length).toBeGreaterThan(0);
  });

  it('the frozen snapshot has zero blocking invariant violations', () => {
    expect(blockingViolations(validatePermitDesignSnapshot(snap))).toEqual([]);
  });
});

describe('W3.1 §1/§5 — originally-audited failure classes corrected on the fixture', () => {
  const snap = fixtureSnapshot();

  it('wind 115-vs-90 is single-sourced (env == loads)', () => {
    expect(snap.structural.env.ultimateWindSpeedMph).toBe(snap.structural.loads.windSpeedMph);
    expect(snap.structural.env.ultimateWindSpeedMph).toBe(115);
  });

  it('module footprints use exact catalog dims (no generic size)', () => {
    const rec = snap.equipment.modules[0];
    for (const m of snap.geometry.moduleInstances) {
      expect(m.widthIn).toBe(rec.spec.widthIn);
      expect(m.heightIn).toBe(rec.spec.lengthIn);
    }
  });

  it('structural BOM reconciles with the canonical objects', () => {
    expect(snap.structural.bomReconciliation.ok).toBe(true);
  });

  it('deterministic Qcells selection ⇒ NO production equipment-identity conflict', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).not.toContain('EQUIPMENT-IDENTITY-CONFLICT');
  });
});

describe('W3.1 §4 — RT-MINI racking-capacity blocking gaps promoted to blockers', () => {
  const snap = fixtureSnapshot();

  it('capacity provenance carries a null documentHash (source not archived in-repo)', () => {
    const cp = (snap.structural.rackingAssembly as any)?.capacityProvenance;
    expect(cp).toBeTruthy();
    expect(cp.sourceDocument.documentHash).toBeNull();
    expect(cp.sourceDocument.archivedInRepo).toBe(false);
  });

  it('both blocking gaps are surfaced as permit-readiness blockers (build.ts + V32)', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('RACKING-CAPACITY-SOURCE-NOT-ARCHIVED');
    expect(codes).toContain('RACKING-CAPACITY-APPLICABILITY-GAP');
    expect(snap.permitReadiness.ready).toBe(false);
  });

  it('V32 fires if a blocking racking gap is NOT surfaced as a blocker', () => {
    const tampered = clone(snap) as any;
    // remove the promoted blockers but keep the blocking gaps on the record
    tampered.permitReadiness.blockers = tampered.permitReadiness.blockers.filter(
      (b: any) => !/^RACKING-CAPACITY/.test(b.code));
    const v = validatePermitDesignSnapshot(tampered);
    expect(v.some(x => x.invariant === 'V32')).toBe(true);
  });
});
