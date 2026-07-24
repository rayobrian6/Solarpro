// ═══════════════════════════════════════════════════════════════════════════
// Post-campaign correction 2026-07-22 — ELECTRICAL workstream regressions.
// These are PURE-unit tests over the canonical projection helpers + resolvers so
// they verify the §3/§4/§6/§13 fixes independent of full-package generation
// (which is gated concurrently by the structural reaction-reconciliation work).
// ═══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import {
  projectCanonicalFeeder, routeProvenanceLabel,
} from '@/lib/permit/snapshot/electricalProjection';
import { pv1bTitle } from '@/lib/permit/sheetManifest';
import { resolveTrunkCablePlan } from '@/lib/equipment/trunkCable';
import { generatePermitHTML } from '@/lib/permit';
import { validatePermitDesignSnapshot } from '@/lib/permit/snapshot/validate';
import { roofProject } from '../../test-fixtures/roofProject';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// A minimal snapshot carrying ONLY the electrical slice the projection reads.
function snap(electrical: Partial<PermitDesignSnapshot['electrical']>,
             blockers: { code: string; message: string }[] = []): PermitDesignSnapshot {
  return {
    electrical: {
      topology: 'MICRO', engineOfRecord: 'computeSystem',
      microInverterUnits: [], branches: [], conductors: [],
      groundingObjects: [], routeSegments: [],
      feeder: { conductorId: 'c-1', ocpdA: null, continuousA: null, currentA: null,
                voltageDropPct: null, conduit: { raceway: null, tradeSizeIn: null, fillPct: null } },
      poi: { method: 'SUPPLY_SIDE_TAP', busbarA: 200, mainBreakerA: 200, backfeedA: 60, rulePasses: true },
      parity: { legacyEngine: 'runElectricalCalc', legacyRan: true, checks: [], unresolved: [] },
      provenance: { source: 'test' }, gaps: [],
      ...electrical,
    } as PermitDesignSnapshot['electrical'],
    permitReadiness: { ready: false, blockers },
  } as unknown as PermitDesignSnapshot;
}

describe('§3 SEGMENT AUTHORITY — canonical feeder projection (electricalProjection)', () => {
  const canonical = snap({
    conductors: [{ conductorId: 'c-1', gauge: '#6 AWG', material: 'Cu', insulation: 'THWN-2', count: null, ampacityA: 75, provenance: { source: 't' } }],
    groundingObjects: [{ groundingId: 'gnd-feeder', segmentId: 'COMBINER_TO_DISCO_RUN', purpose: 'feeder-egc', required: true, method: 'conductor', conductorMaterial: 'Cu', conductorSize: '#10 AWG', sizingBasis: '', associatedOcpdA: 60, associatedEquipment: '', manufacturerListingBasis: null, codeBasis: 'NEC 250.122', provenance: { source: 't' } }],
    feeder: { conductorId: 'c-1', ocpdA: 60, continuousA: 45.1, currentA: 36.1, voltageDropPct: 0.37,
              conduit: { raceway: 'EMT', tradeSizeIn: '1"', fillPct: 28.5 } },
    routeSegments: [{ segmentId: 'COMBINER_TO_DISCO_RUN', from: 'COMBINER', to: 'AC DISCO', oneWayFt: 60,
      lengthSource: 'cad-derived-estimate', raceway: 'EMT', tradeSizeIn: '1"', fillPct: 28.5,
      conductorGauge: '#6 AWG', conductorCallout: null, egcGauge: '#10 AWG', voltageDropPct: 0.37,
      ocpdA: 60, tempDeratingFactor: 1, provenance: { source: 't' } }],
  });

  it('single-sources ONE raceway + size + VD + length (no 3/4-vs-1-1/4 conflict, no 1.11%)', () => {
    const f = projectCanonicalFeeder(canonical);
    expect(f.raceway).toBe('EMT');
    expect(f.tradeSizeIn).toBe('1"');
    expect(f.conduitLabel).toBe('EMT 1"');
    expect(f.voltageDropPct).toBe(0.37);       // routed canonical, never 1.11
    expect(f.oneWayFt).toBe(60);
    expect(f.hasHole).toBe(false);
  });

  it('builds a CLEAN callout from canonical parts (never the merged "1-1/4\\" 3/4\\" EMT")', () => {
    const f = projectCanonicalFeeder(canonical);
    expect(f.conductorCallout).toBe('3×#6 AWG THWN-2 + 1×#10 AWG EGC IN EMT 1"');
    expect(f.conductorCallout).not.toMatch(/1-1\/4.*3\/4/);   // the malformed concatenation is gone
  });

  it('flags a hole (never PASS) when a displayed feeder value is missing', () => {
    const f = projectCanonicalFeeder(snap({}));   // empty feeder
    expect(f.hasHole).toBe(true);
    expect(f.holes).toContain('feeder raceway');
    expect(f.voltageDropPct).toBeNull();          // → sheet renders PENDING, not undefined%
  });
});

describe('§6 ROUTE PROVENANCE', () => {
  it('prints CAD-DERIVED ESTIMATE — FIELD VERIFY while lengths are estimates', () => {
    const s = snap({ routeSegments: [{ segmentId: 'X', from: 'a', to: 'b', oneWayFt: 60, lengthSource: 'cad-derived-estimate', raceway: 'EMT', tradeSizeIn: '1"', fillPct: 10, conductorGauge: '#6 AWG', conductorCallout: null, egcGauge: '#10 AWG', voltageDropPct: 0.3, ocpdA: 60, tempDeratingFactor: 1, provenance: { source: 't' } }] });
    expect(routeProvenanceLabel(s)).toBe('CAD-DERIVED ESTIMATE — FIELD VERIFY');
    expect(routeProvenanceLabel(s)).not.toBe('ROUTE FIELD-VERIFIED');
  });
  it('only claims ROUTE FIELD-VERIFIED when lengths are truly routed/measured', () => {
    const s = snap({ routeSegments: [{ segmentId: 'X', from: 'a', to: 'b', oneWayFt: 60, lengthSource: 'field-measurement', raceway: 'EMT', tradeSizeIn: '1"', fillPct: 10, conductorGauge: '#6 AWG', conductorCallout: null, egcGauge: '#10 AWG', voltageDropPct: 0.3, ocpdA: 60, tempDeratingFactor: 1, provenance: { source: 't' } }] });
    expect(routeProvenanceLabel(s)).toBe('ROUTE FIELD-VERIFIED');
  });
  it('never claims verified with no segment authority', () => {
    expect(routeProvenanceLabel(snap({}))).toBe('CAD-DERIVED ESTIMATE — FIELD VERIFY');
  });
});

describe('§4 PV-1B title — topology-aware', () => {
  it('micro ⇒ AC BRANCH CIRCUIT LAYOUT', () => {
    expect(pv1bTitle(true)).toBe('AC BRANCH CIRCUIT LAYOUT');
    expect(pv1bTitle(true, ' — ROOF')).toBe('AC BRANCH CIRCUIT LAYOUT — ROOF');
  });
  it('string/optimizer keep the array-geometry string-layout title', () => {
    expect(pv1bTitle(false)).toContain('STRING LAYOUT');
    expect(pv1bTitle(undefined)).toContain('ARRAY GEOMETRY');
  });
});

describe('§5 SERVICE TOPOLOGY — canonical objects (build + projection + validator)', () => {
  // Build a supply-side design and read the snapshot generatePermit stashes on input.
  function buildSupplySide(): { input: any; snap: PermitDesignSnapshot; html: string } {
    const input: any = clone(roofProject);
    input.project = input.project ?? {};
    input.project.interconnectionMethod = 'SUPPLY_SIDE_TAP';
    const html = generatePermitHTML(input);
    const snap = (input as { _snapshot?: PermitDesignSnapshot })._snapshot!;
    return { input, snap, html };
  }

  it('models the canonical service chain — §9 folds the utility disconnect onto the ONE listed fused device', () => {
    const { snap } = buildSupplySide();
    const topo = snap.electrical.serviceTopology;
    expect(topo).toBeTruthy();
    const types = topo.map(o => o.type);
    // The always-separate objects.
    for (const t of ['tap-point', 'tap-conductors', 'fused-ocpd', 'meter', 'service-disconnect']) {
      expect(types).toContain(t);
    }
    // §9 (closeout): with no separate utility disconnect specified, the fused AC
    // disconnect is a DUAL-PURPOSE listed device — it carries the utility role and
    // NO phantom standalone utility-disconnect object is emitted.
    const fused = topo.find(o => o.type === 'fused-ocpd')!;
    expect(fused.dualPurposeListing).toBe(true);
    expect(fused.utilityRole).toBe('utility-accessible-disconnect');
    expect((fused.dualPurposeRoles ?? []).some(r => /utility/i.test(r))).toBe(true);
    expect(types).not.toContain('utility-disconnect');   // never a duplicate device
    // physical-order graph edges are present (upstream/downstream chain).
    expect(fused.upstreamObjectId).toBeTruthy();
    expect(fused.downstreamObjectId).toBeTruthy();
    // each object has an id + provenance (digest-covered authority)
    for (const o of topo) { expect(o.objectId).toBeTruthy(); expect(o.provenance?.source).toBeTruthy(); }
  });

  it('tap-conductor 10-ft rule is PENDING while its length is unknown (no fabricated compliant claim)', () => {
    const { snap } = buildSupplySide();
    const tap = snap.electrical.serviceTopology.find(o => o.type === 'tap-conductors')!;
    expect(tap.lengthFt).toBeNull();               // no CAD datum → honest PENDING
    expect(tap.lengthSource).toBe('unknown');
    const rule = tap.constraints.find(c => c.code === 'NEC-705.11(C)-TAP-10FT')!;
    expect(rule.limitFt).toBe(10);
    expect(rule.state).toBe('pending');            // never 'pass' on an unknown length
    // the 60-ft feeder run is a SEPARATE object (route segment), not this one
    expect(tap.lengthFt).not.toBe(60);
  });

  it('PV-4B projects the objects (not restated) — service chain table + PENDING tap rule', () => {
    const { html } = buildSupplySide();
    expect(html).toContain('Tap conductors');
    // §9: the fused device label now names its dual role (tap OCPD + utility-accessible).
    expect(html).toContain('Fused AC disconnect (tap OCPD');
    expect(html).toContain('Main service disconnect');
    expect(html).toMatch(/PENDING[^<]*length/i);   // honest tap-length state rendered
  });

  it('V42 — no object may claim a PASS length-limit rule without a known length', () => {
    const { snap } = buildSupplySide();
    // correct data ⇒ no V42 violation
    expect(validatePermitDesignSnapshot(snap).some(v => v.invariant === 'V42')).toBe(false);
    // fabricate a compliant 10-ft claim with an unknown length ⇒ V42 fires
    const bad = clone(snap);
    const tap = bad.electrical.serviceTopology.find(o => o.type === 'tap-conductors')!;
    tap.constraints.find(c => c.code === 'NEC-705.11(C)-TAP-10FT')!.state = 'pass';
    tap.lengthFt = null;
    expect(validatePermitDesignSnapshot(bad).some(v => v.invariant === 'V42')).toBe(true);
  });

  it('V42 — a supply-side design missing service-topology objects is flagged', () => {
    const { snap } = buildSupplySide();
    const bad = clone(snap);
    bad.electrical.serviceTopology = bad.electrical.serviceTopology.filter(o => o.type !== 'fused-ocpd');
    const v = validatePermitDesignSnapshot(bad).filter(x => x.invariant === 'V42');
    expect(v.some(x => String(x.offendingValue).includes('fused-ocpd'))).toBe(true);
  });
});

describe('§13 BOM topology — terminator/cap qty from canonical branch count', () => {
  it('3 real branches ⇒ 3 terminators (not the branches+1 heuristic)', () => {
    // 30 IQ8A devices: the flat heuristic would over/under-count; the canonical
    // plane-aware branch count (3) must govern terminators + sealing caps.
    const heuristic = resolveTrunkCablePlan({ brand: 'Enphase', model: 'IQ8A', deviceCount: 30 });
    const canonical = resolveTrunkCablePlan({ brand: 'Enphase', model: 'IQ8A', deviceCount: 30, branchCountOverride: 3 });
    expect(canonical?.branchCount).toBe(3);
    expect(canonical?.terminators).toBe(3);
    expect(canonical?.sealingCaps).toBe(3);
    // the override is authoritative even where the heuristic disagrees
    expect(canonical?.terminators).not.toBeGreaterThan(3);
    expect(heuristic).toBeTruthy();
  });
});
