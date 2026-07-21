import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { validatePermitDesignSnapshot, blockingViolations } from '@/lib/permit/snapshot/validate';
import { contentRevision } from '@/lib/permit/snapshot/digest';
import { buildRackingAssembly } from '@/lib/permit/snapshot/rackingAssembly';
import { runSnapshotStructuralEngine, isFramingVerified } from '@/lib/permit/snapshot/structuralEngine';
import { deriveStructuralBom, reconcileStructuralBom } from '@/lib/permit/snapshot/structuralBom';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Build the real Braidon-like snapshot by running the full permit engine and
 *  reading the stashed authority object (generatePermit sets input._snapshot). */
function realSnapshot(mutate?: (p: any) => void): PermitDesignSnapshot {
  const input = clone(roofProject) as any;
  if (mutate) mutate(input);
  generatePermitHTML(input);
  return input._snapshot as PermitDesignSnapshot;
}

describe('W3 structural authority — canonical objects on the real snapshot', () => {
  const snap = realSnapshot();
  const gi = snap.geometry.moduleInstances;
  const rec = snap.equipment.modules[0];

  it('module-count invariant: one canonical instance per module', () => {
    expect(gi.length).toBe(snap.geometry.modules.length);
    expect(gi.length).toBe(snap.derived.moduleCount);
    expect(gi.length).toBeGreaterThan(0);
  });

  it('exact-dims invariant: every footprint uses the versioned record dims (no generic 66×40)', () => {
    expect(rec.spec.widthIn).toBeTruthy();
    expect(rec.spec.lengthIn).toBeTruthy();
    for (const m of gi) {
      expect(m.widthIn).toBe(rec.spec.widthIn);
      expect(m.heightIn).toBe(rec.spec.lengthIn);
      expect(m.equipmentRevision).toBeTruthy();
    }
  });

  it('array area = Σ canonical module polygon areas (exact catalog footprint)', () => {
    const per = (rec.spec.widthIn! * rec.spec.lengthIn!) / 144;
    const sum = gi.reduce((s, m) => s + m.areaFt2, 0);
    expect(sum).toBeCloseTo(gi.length * per, 1); // per-instance areas are rounded to 3 dp

    for (const m of gi) expect(m.areaFt2).toBeCloseTo(per, 3);
  });

  it('rail ↔ attachment reconciliation math holds', () => {
    const st = snap.structural;
    expect(st.rails.length).toBeGreaterThan(0);
    expect(st.attachments.length).toBeGreaterThan(0);
    const railIds = new Set(st.rails.map(r => r.railId));
    for (const a of st.attachments) expect(railIds.has(a.railId)).toBe(true);
    // Σ rail attachment refs = attachment objects
    const refSum = st.rails.reduce((s, r) => s + r.attachmentIds.length, 0);
    expect(refSum).toBe(st.attachments.length);
    // every module supported by a rail
    const supported = new Set(st.rails.flatMap(r => r.supportedModuleIds));
    for (const m of snap.geometry.modules) expect(supported.has(m.moduleId)).toBe(true);
    // scheduled rail length mirror = Σ physical rail lengths
    const railFt = st.rails.reduce((s, r) => s + r.physicalLengthIn, 0) / 12;
    expect(st.railTotalFt).toBeCloseTo(Math.round(railFt * 100) / 100, 2);
    expect(st.railCount).toBe(st.rails.length);
    expect(st.spliceCount).toBe(st.rails.reduce((s, r) => s + r.spliceCount, 0));
  });

  it('environmental authority is single-sourced (no 115-vs-90 split)', () => {
    expect(snap.structural.env.ultimateWindSpeedMph).toBe(snap.structural.loads.windSpeedMph);
  });

  it('framing-unverified blocker fires (Braidon: framing defaulted)', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('STRUCTURAL-FRAMING-UNVERIFIED');
    expect(snap.structural.engine.engineeringReviewRequired).toBe(true);
    const framing = snap.structural.checks.find(c => c.limitState === 'framing-capacity');
    expect(framing?.passes).toBeNull(); // never a fabricated pass
  });

  it('carry-forward electrical blockers remain', () => {
    const codes = snap.permitReadiness.blockers.map(b => b.code);
    expect(codes).toContain('ROUTE-LENGTH-ESTIMATE');
    expect(snap.permitReadiness.ready).toBe(false);
  });

  it('the real snapshot is internally consistent (no blocking invariant violations)', () => {
    expect(blockingViolations(validatePermitDesignSnapshot(snap))).toEqual([]);
  });
});

describe('W3 §10 — structural BOM derived from canonical objects', () => {
  const snap = realSnapshot();
  const st = snap.structural;

  it('every structural BOM row is quantity-traceable (source object IDs or aggregation)', () => {
    expect(st.bom.length).toBeGreaterThan(0);
    for (const r of st.bom) {
      const hasSource = (r.sourceObjectIds !== undefined) || (r.aggregation !== undefined);
      expect(hasSource, `row ${r.key} must carry source IDs or an aggregation ref`).toBe(true);
      expect(r.derivedFrom).toBeTruthy();
    }
  });

  it('rail/mount/splice/clamp/bonding rows equal the object quantities', () => {
    const q = (k: string) => st.bom.find(r => r.key === k)?.qty ?? -1;
    // mounts = attachment objects
    expect(q('mounts')).toBe(st.attachments.length);
    // splices = Σ rail.spliceCount
    expect(q('railSplices')).toBe(st.rails.reduce((s, r) => s + r.spliceCount, 0));
    // rails = Σ ceil(len ÷ stock)
    const railGeom = st.rails.reduce((s, r) => s + Math.ceil(r.physicalLengthIn / (r.stockLengthIn || r.physicalLengthIn)), 0);
    expect(q('rails')).toBe(railGeom);
    // mid clamps = Σ (modules_on_rail − 1) — actual module adjacency
    expect(q('midClamps')).toBe(st.rails.reduce((s, r) => s + Math.max(0, r.supportedModuleIds.length - 1), 0));
    // end clamps = 2 × rails
    expect(q('endClamps')).toBe(2 * st.rails.length);
    // bonding = one per module instance
    expect(q('bondingClips')).toBe(snap.geometry.moduleInstances.length);
    // lag bolts = Σ attachment.fastenerCount
    expect(q('lagBolts')).toBe(st.attachments.reduce((s, a) => s + (a.fastenerCount ?? 0), 0));
  });

  it('reconciliation passes and cross-checks the V4 producer (single-system scope)', () => {
    expect(st.bomReconciliation.ok).toBe(true);
    expect(st.bomReconciliation.basis).toBe('object-vs-engine'); // roofProject is single-system → scope matches
    // includes the V4 producer cross-checks, all ok
    const v4Checks = st.bomReconciliation.checks.filter(c => /v4-calcRackingBOM/.test(c.name));
    expect(v4Checks.length).toBeGreaterThan(0);
    for (const c of v4Checks) expect(c.ok, `${c.name} exp ${c.expected} act ${c.actual}`).toBe(true);
  });

  it('a fabricated BOM quantity FAILS reconciliation (V10 would block)', () => {
    const objects = {
      rails: st.rails, attachments: st.attachments,
      moduleInstances: snap.geometry.moduleInstances, rackingAssembly: st.rackingAssembly,
    };
    const rows = deriveStructuralBom(objects);
    // tamper with one row (a renderer guess)
    const tampered = rows.map(r => r.key === 'mounts' ? { ...r, qty: r.qty + 7 } : r);
    const recon = reconcileStructuralBom(tampered, objects);
    expect(recon.ok).toBe(false);
    expect(recon.checks.some(c => c.name === 'mounts-vs-attachment-objects' && !c.ok)).toBe(true);
  });
});

describe('W3 — RT-MINI capacity sourcing (600 allowable is authority)', () => {
  it('RT-MINI cites the 600 lb ASD allowable and records the 900-ultimate discrepancy', () => {
    const a = buildRackingAssembly(getMountingSystemById('rooftech-mini'))!;
    expect(a.publishedCapacityAllowableLbs).toBe(600);
    expect(a.capacityBasis).toBe('allowable');
    expect(a.capacitySource).toBeTruthy();
    expect(a.notes.join(' ')).toMatch(/600 lb ASD ALLOWABLE/);
    expect(a.notes.join(' ')).toMatch(/NOT structural authority/);
    // RT-MINI has no own rail spec → compatible rail (documented) → supported.
    expect(a.mixedManufacturer).toBe(true);
    expect(a.assemblySupported).toBe(true);
    expect(a.recordRevision).toBeTruthy();
  });

  it('IronRidge XR100 is a same-manufacturer railed assembly at its 500 lb allowable', () => {
    const a = buildRackingAssembly(getMountingSystemById('ironridge-xr100'))!;
    expect(a.capacityBasis).toBe('allowable');
    expect(a.publishedCapacityAllowableLbs).toBe(500);
    expect(a.mixedManufacturer).toBe(false);
    expect(a.railModel).toBeTruthy();
  });
});

describe('W3 — framing honesty in the structural engine', () => {
  const baseResult: any = {
    mountLayout: { safetyFactor: 1.49, mountCapacityLbs: 500, upliftPerMountLbs: 336,
      downwardPerMountLbs: 0, mountsPerRail: 4, mountSpacingIn: 48, tributaryAreaPerMountFt2: 5.3 },
    railAnalysis: undefined,
    rafterAnalysis: { bendingMomentDemandFtLbs: 200, bendingMomentCapacityFtLbs: 520,
      overallUtilization: 0.38, totalLoadPsf: 18, framingType: 'truss', size: '2x6',
      spacingIn: 24, species: 'Douglas Fir-Larch' },
    arrayGeometry: { railSpacingIn: 40.9 },
    snow: { roofSnowLoadPsf: 0 }, wind: { roofZone: 'zone1', netUpliftPressurePsf: 20, netDownwardPressurePsf: 15 },
    addedDeadLoadPsf: 3.2,
  };
  const baseInput: any = { panelCount: 12, panelWeightLbs: 49, rackingWeightPerPanelLbs: 4,
    framingType: 'truss', rafterSize: '2x6' };

  it('unverified framing ⇒ review required, framing pass is null, but attachment check still verified', () => {
    const out = runSnapshotStructuralEngine(baseResult, baseInput, {}); // no framing authority
    expect(out.framingVerified).toBe(false);
    expect(out.engine.engineeringReviewRequired).toBe(true);
    const framing = out.checks.find(c => c.limitState === 'framing-capacity')!;
    expect(framing.passes).toBeNull();
    expect(framing.demand).toBeNull();      // did NOT emit fabricated truss capacity
    const att = out.checks.find(c => c.limitState === 'attachment-uplift')!;
    expect(att.passes).toBe(true);          // attachment check is verified regardless
    expect(out.engine.passes).toBeNull();   // cannot certify PASS under review
  });

  it('fully-specified framing ⇒ review not required and the framing check is verified', () => {
    const framing = { framingType: 'rafter', rafterSize: '2x6', rafterSpacing: 16,
      rafterSpecies: 'Douglas Fir-Larch', rafterSpan: 12 };
    expect(isFramingVerified(framing)).toBe(true);
    const out = runSnapshotStructuralEngine(baseResult, baseInput, framing);
    expect(out.engine.engineeringReviewRequired).toBe(false);
    const chk = out.checks.find(c => c.limitState === 'framing-capacity')!;
    expect(chk.passes).toBe(true);
    expect(chk.dcRatio).toBeCloseTo(0.38, 2);
    expect(out.engine.passes).toBe(true);
  });
});

describe('W3 — digest invalidation on equipment change', () => {
  it('contentRevision is deterministic and change-sensitive', () => {
    const a = { catalogId: 'x', w: 41.7, h: 70.9 };
    expect(contentRevision(a)).toBe(contentRevision({ ...a }));
    expect(contentRevision(a)).not.toBe(contentRevision({ ...a, w: 40.9 }));
  });

  it('changing the mounting system changes the snapshot digest (approval invalidation)', () => {
    const d1 = realSnapshot().meta.digest;
    const d2 = realSnapshot(p => { p.project.mountingSystemId = 'rooftech-mini'; }).meta.digest;
    expect(d1).toBeTruthy();
    expect(d2).not.toBe(d1);
  });

  it('changing the module changes module footprints and the digest', () => {
    const s1 = realSnapshot();
    const s2 = realSnapshot(p => {
      for (const inv of p.system.inverters) for (const s of inv.strings) s.panelModel = 'Q.PEAK DUO BLK ML-G10+ 400W';
    });
    expect(s2.meta.digest).not.toBe(s1.meta.digest);
    // equipment revision on the instances tracks the record change
    if (s1.geometry.moduleInstances.length && s2.geometry.moduleInstances.length) {
      expect(s2.geometry.moduleInstances[0].equipmentRevision)
        .not.toBe(s1.geometry.moduleInstances[0].equipmentRevision);
    }
  });
});
