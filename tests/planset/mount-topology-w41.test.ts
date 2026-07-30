// ═══════════════════════════════════════════════════════════════════════════
// W4.1 — ROOF TECH MOUNTING-TOPOLOGY CORRECTION (RT-MINI rail-paired).
// docs/W4.1-DIRECTIVE.md §1–§3, Ray corrective mandate.
//
// Proves, with BLOCKING tests, that:
//   (a) RT-MINI (rail-paired) — and every confirmed variant — CANNOT enter the
//       rail-less/direct-mount structural path (no att-dm-* objects; not the
//       4-per-module direct-mount pattern);
//   (b) a VERIFIED rail-less record CAN enter the rail-less path (RT-APEX/E Mount
//       AIR are not cataloged — no fabrication; an existing verified rail-less
//       record is the exemplar);
//   (c) an UNKNOWN Roof Tech alias BLOCKS generation (MOUNT-TOPOLOGY-UNKNOWN in
//       the blockers; permit-ready false; no rails, no att-dm-*);
//   (d) changing a product's mounting topology invalidates the snapshot digest;
//   (e) BOM + structural objects follow the corrected topology.
//
// The structural engine guards on the TOPOLOGY VALUE (classifyMountTopology),
// never the product name — a mislabeled 'rail_less' systemType (an unverified
// RT-MINI alias → 'unknown') can no longer reach buildDirectMountAttachments.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';
import { getMountingSystemById, classifyMountTopology } from '@/lib/mounting-hardware-db';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

/** Build a real snapshot from the roof fixture with the given mounting system. */
function snapshotFor(mountingSystemId: string): PermitDesignSnapshot {
  const input = clone(roofProject) as any;
  input.project.mountingSystemId = mountingSystemId;
  const sys = getMountingSystemById(mountingSystemId)!;
  input.project.mountingSystem = `${sys.manufacturer} ${sys.model}`;
  generatePermitHTML(input);
  return input._snapshot as PermitDesignSnapshot;
}

const dmAtts = (s: PermitDesignSnapshot) => s.structural.attachments.filter(a => a.attachmentId.startsWith('att-dm-'));

// ── §1 — classification authority ────────────────────────────────────────────
describe('W4.1 §1 — mounting topology classification (equipment authority)', () => {
  it('RT-MINI / RT-MINI II family + RT-HOOK are rail_paired', () => {
    expect(classifyMountTopology(getMountingSystemById('rooftech-mini')!).topology).toBe('rail_paired');
    expect(getMountingSystemById('rooftech-mini')!.mountTopology).toBe('rail_paired');
    expect(classifyMountTopology(getMountingSystemById('rooftech-hook')!).topology).toBe('rail_paired');
  });

  it('the unverified RT-MINI-S / -T / -M aliases are UNKNOWN (do not guess from "mini")', () => {
    for (const id of ['rooftech-mini-s', 'rooftech-mini-t', 'rooftech-mini-m']) {
      const sys = getMountingSystemById(id)!;
      const { topology, basis } = classifyMountTopology(sys);
      expect(topology).toBe('unknown');
      expect(sys.mountTopology).toBe('unknown');
      expect(basis).toMatch(/AMBIGUOUS/i);
    }
  });

  it('verified rail-less products classify rail_less; conventional railed mounts classify rail_paired', () => {
    expect(classifyMountTopology(getMountingSystemById('tesla-panel-mount-comp-rafter')!).topology).toBe('rail_less');
    expect(classifyMountTopology(getMountingSystemById('ecofasten-rockit')!).topology).toBe('rail_less');
    // derived from systemType (no explicit override) — railed path
    expect(classifyMountTopology(getMountingSystemById('ironridge-xr100')!).topology).toBe('rail_paired');
  });
});

// ── §3(a) — RT-MINI cannot enter the direct-mount path ───────────────────────
describe('W4.1 §3(a) — RT-MINI (rail-paired) cannot enter the rail-less/direct-mount engine', () => {
  const snap = snapshotFor('rooftech-mini');

  it('produces NO direct-mount attachment objects (no att-dm-*, no 4-per-module pattern)', () => {
    expect(dmAtts(snap)).toEqual([]);
    // it is the RAILED path: rail objects exist and every attachment carries a rail id
    expect(snap.structural.rails.length).toBeGreaterThan(0);
    expect(snap.structural.attachments.length).toBeGreaterThan(0);
    for (const a of snap.structural.attachments) expect(a.railId).not.toBe('');
    // not the direct-mount 4-mounts-per-module fingerprint
    const gi = snap.geometry.moduleInstances.length;
    expect(snap.structural.attachments.length).not.toBe(gi * 4);
  });
});

// ── §3(b) — a verified rail-less record CAN enter the rail-less path ──────────
describe('W4.1 §3(b) — a VERIFIED rail-less record enters the direct-mount path', () => {
  // RT-APEX / E Mount AIR are the directive's rail_less exemplars but are NOT in
  // the catalog (no verified in-repo data — deliberately NOT fabricated). An
  // existing verified rail-less record stands in for the rail-less path.
  const snap = snapshotFor('ecofasten-rockit');

  it('produces canonical direct-mount attachment objects and EMPTY rails', () => {
    expect(snap.structural.rails).toEqual([]);
    const dm = dmAtts(snap);
    expect(dm.length).toBeGreaterThan(0);
    expect(dm.length).toBe(snap.geometry.moduleInstances.length * 4);
    for (const a of dm) expect(a.railId).toBe('');
  });
});

// ── §3(c) — an unknown alias BLOCKS generation ───────────────────────────────
describe('W4.1 §3(c) — an UNKNOWN Roof Tech alias blocks permit-ready generation', () => {
  for (const id of ['rooftech-mini-s', 'rooftech-mini-t', 'rooftech-mini-m']) {
    it(`${id}: MOUNT-TOPOLOGY-UNKNOWN blocker present, permit-ready false, no rail/direct-mount objects`, () => {
      const snap = snapshotFor(id);
      const codes = snap.permitReadiness.blockers.map(b => b.code);
      expect(codes).toContain('MOUNT-TOPOLOGY-UNKNOWN');
      expect(snap.permitReadiness.ready).toBe(false);
      // never silently routed either way
      expect(snap.structural.rails).toEqual([]);
      expect(dmAtts(snap)).toEqual([]);
    });
  }
});

// ── §3(d) — topology change invalidates the snapshot digest ──────────────────
describe('W4.1 §3(d) — changing mounting topology invalidates the snapshot digest', () => {
  it('a rail-paired mount and a rail-less mount produce DIFFERENT digests + different objects', () => {
    const railed = snapshotFor('rooftech-mini');      // rail_paired
    const railless = snapshotFor('ecofasten-rockit'); // rail_less
    expect(railed.meta.digest).not.toBe(railless.meta.digest);
    // the difference is the topology-driven structural objects (digest-covered)
    expect(railed.structural.rails.length).toBeGreaterThan(0);
    expect(dmAtts(railed)).toEqual([]);
    expect(railless.structural.rails).toEqual([]);
    expect(dmAtts(railless).length).toBeGreaterThan(0);
  });
});

// ── §3(e) — BOM + structural objects follow the corrected topology ───────────
describe('W4.1 §3(e) — BOM + structural calcs follow the corrected topology', () => {
  it('rail-paired RT-MINI emits rail/mount BOM rows and NO direct-mount rows', () => {
    const snap = snapshotFor('rooftech-mini');
    const keys = snap.structural.bom.map(r => r.key);
    expect(keys).toContain('rails');
    expect(keys).toContain('mounts');
    expect(dmAtts(snap)).toEqual([]);
    expect(snap.structural.bomReconciliation.ok).toBe(true);
  });

  it('rail-less product emits mount/fastener rows with NO rail/splice/clamp rows', () => {
    const snap = snapshotFor('ecofasten-rockit');
    const keys = snap.structural.bom.map(r => r.key);
    expect(keys).toContain('mounts');
    expect(keys).not.toContain('rails');
    expect(keys).not.toContain('railSplices');
    expect(keys).not.toContain('midClamps');
    expect(snap.structural.bomReconciliation.basis).toBe('object-internal');
    expect(snap.structural.bomReconciliation.ok).toBe(true);
  });
});
