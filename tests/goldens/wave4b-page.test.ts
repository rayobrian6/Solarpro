// ============================================================================
// Wave 4B (Lane B) — hybrid migration-collapse fix + degenerate-fleet detector
// (docs/ARCHITECTURE-per-subsystem-equipment.md §1.5 + Ray live-test bugs A/B/D,
//  project 4d720c49: 48 roof / 20 ground / 17 fence stamps, ONE untagged
//  85-panel IQ8+ fleet, stored subSystems = {fence: …source:'migration'} only).
//
// Covers:
//   A. ensureSubSystemShape opts.presentKeys —
//      • absent map + hybrid partition ⇒ ONE entry PER present key
//        (never the old winner-vote single bucket);
//      • stored single-entry 'migration' map on a hybrid layout ⇒ degenerate,
//        re-synthesized per present key (source!=='migration' never discarded);
//      • roof-only fields only on roof; env adder 30 roof / 0 ground+fence;
//      • idempotent; no presentKeys / single key ⇒ legacy byte-identical.
//   B/D. detectDegenerateSingleFleet — the whole-project single fleet that
//      must not be partitioned into per-sub engine inputs.
//
// Determinism rule: injectable clock (opts.now) — no live Date.now assertions.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  ensureSubSystemShape,
  detectDegenerateSingleFleet,
  type SubSystemEquipment,
  type SubSystemKey,
} from '../../lib/system/subSystemEquipment';

const NOW = () => '2026-07-12T00:00:00.000Z';

/** Ray's live shape: fence-voted legacy scalars + ONE untagged 85-panel micro fleet. */
function rayHybridConfig(overrides: Record<string, unknown> = {}) {
  return {
    systemType: 'fence',
    inverters: [{
      id: 'inv-1', inverterId: 'enphase-iq8plus', type: 'micro',
      strings: [{ id: 's1', label: 'All Panels', panelCount: 85, panelId: 'qcells-peak-duo-400' }],
    }],
    mountingId: 'ironridge-xr100',
    roofType: 'shingle',
    trenchRunLengthFt: 40,
    conduitType: 'EMT',
    wireLength: 60,
    selectedBrand: 'enphase',
    ...overrides,
  };
}

const RAY_PRESENT: SubSystemKey[] = ['roof', 'ground', 'fence'];

describe('ensureSubSystemShape — presentKeys hybrid synthesis (Wave 4B.A)', () => {
  it('absent map + 3-key partition ⇒ one migration entry PER present key', () => {
    const out = ensureSubSystemShape(rayHybridConfig(), { presentKeys: RAY_PRESENT, now: NOW });
    expect(Object.keys(out.subSystems).sort()).toEqual(['fence', 'ground', 'roof']);
    for (const k of RAY_PRESENT) {
      const e = out.subSystems[k]!;
      expect(e.key).toBe(k);
      expect(e.source).toBe('migration');
      expect(e.inverterId).toBe('enphase-iq8plus');
      expect(e.topology).toBe('micro');
      expect(e.panelId).toBe('qcells-peak-duo-400');
      expect(e.updatedAt).toBe(NOW());
    }
  });

  it('roof-only fields only on roof; trench only on ground/fence; env adder 30/0', () => {
    const out = ensureSubSystemShape(rayHybridConfig(), { presentKeys: RAY_PRESENT, now: NOW });
    expect(out.subSystems.roof!.roofType).toBe('shingle');
    expect(out.subSystems.roof!.trenchRunLengthFt).toBeUndefined();
    expect(out.subSystems.roof!.env?.rooftopTempAdderC).toBe(30);
    for (const k of ['ground', 'fence'] as const) {
      expect(out.subSystems[k]!.roofType).toBeUndefined();
      expect(out.subSystems[k]!.trenchRunLengthFt).toBe(40);
      expect(out.subSystems[k]!.env?.rooftopTempAdderC).toBe(0);
    }
  });

  it("Ray's stored degenerate {fence: migration} map is re-synthesized per key", () => {
    // Wave 6.1: fence synthesis now FORCES the SolFence mounting id, so the
    // idempotence fixture carries it too (a cloned roof mountingId is the
    // contamination case — covered by the dedicated test below).
    const storedFence: SubSystemEquipment = {
      key: 'fence', inverterId: 'enphase-iq8plus', topology: 'micro',
      panelId: 'qcells-peak-duo-400', mountingId: 'solfence-8ft',
      ecosystemBrand: 'enphase', trenchRunLengthFt: 40,
      env: { rooftopTempAdderC: 0, conduitType: 'EMT', wireLengthFt: 60 },
      source: 'migration', updatedAt: '2026-07-10T00:00:00.000Z',
    };
    const out = ensureSubSystemShape(
      rayHybridConfig({ subSystems: { fence: storedFence } }),
      { presentKeys: RAY_PRESENT, now: NOW },
    );
    expect(Object.keys(out.subSystems).sort()).toEqual(['fence', 'ground', 'roof']);
    // matching id-tuple ⇒ the stored fence entry survives BY REFERENCE (idempotence)
    expect(out.subSystems.fence).toBe(storedFence);
    expect(out.subSystems.roof!.source).toBe('migration');
    expect(out.subSystems.roof!.roofType).toBe('shingle');
    expect(out.subSystems.ground!.source).toBe('migration');
  });

  it('Wave 6.1: fence entries never keep a cloned roof mountingId (SolFence forced)', () => {
    // Fresh synthesis: the flat legacy mountingId (roof racking) must NOT be
    // cloned into the fence entry; roof/ground keep it, fence gets SolFence.
    const out = ensureSubSystemShape(rayHybridConfig(), { presentKeys: RAY_PRESENT, now: NOW });
    expect(out.subSystems.roof!.mountingId).toBe('ironridge-xr100');
    expect(out.subSystems.ground!.mountingId).toBe('ironridge-xr100');
    expect(out.subSystems.fence!.mountingId).toBe('solfence-8ft');
    // Stored contaminated migration entry (Ray's live Stowell shape): healed.
    const contaminated: SubSystemEquipment = {
      key: 'fence', inverterId: 'enphase-iq8plus', topology: 'micro',
      panelId: 'qcells-peak-duo-400', mountingId: 'rooftech-mini',
      source: 'migration', updatedAt: '2026-07-10T00:00:00.000Z',
    };
    const healed = ensureSubSystemShape(
      rayHybridConfig({ subSystems: { fence: contaminated } }),
      { presentKeys: RAY_PRESENT, now: NOW },
    );
    expect(healed.subSystems.fence!.mountingId).toBe('solfence-8ft');
    // Idempotent: a second pass leaves the healed entry alone (by reference).
    const again = ensureSubSystemShape(healed, { presentKeys: RAY_PRESENT, now: NOW });
    expect(again.subSystems.fence).toBe(healed.subSystems.fence);
    // Non-migration provenance is NEVER rewritten, even when contaminated.
    const userFence: SubSystemEquipment = {
      key: 'fence', inverterId: 'enphase-iq8plus', topology: 'micro',
      mountingId: 'rooftech-mini', source: 'engineering', updatedAt: '2026-07-11T00:00:00.000Z',
    };
    const kept = ensureSubSystemShape(
      rayHybridConfig({ subSystems: { fence: userFence } }),
      { presentKeys: RAY_PRESENT, now: NOW },
    );
    expect(kept.subSystems.fence).toBe(userFence);
  });

  it('degenerate migration entry with a DIFFERENT id-tuple is replaced by fresh synthesis', () => {
    const staleFence: SubSystemEquipment = {
      key: 'fence', inverterId: 'some-old-inverter', topology: 'string',
      source: 'migration', updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const out = ensureSubSystemShape(
      rayHybridConfig({ subSystems: { fence: staleFence } }),
      { presentKeys: RAY_PRESENT, now: NOW },
    );
    expect(out.subSystems.fence).not.toBe(staleFence);
    expect(out.subSystems.fence!.inverterId).toBe('enphase-iq8plus');
    expect(out.subSystems.fence!.updatedAt).toBe(NOW());
  });

  it("source !== 'migration' entries are NEVER discarded (user provenance survives)", () => {
    const userRoof: SubSystemEquipment = {
      key: 'roof', inverterId: 'enphase-iq8m', topology: 'micro',
      source: 'engineering', updatedAt: '2026-07-11T09:00:00.000Z',
    };
    // single-entry map but NON-migration source ⇒ not degenerate; missing
    // present keys are additively filled, the user entry is untouched.
    const out = ensureSubSystemShape(
      rayHybridConfig({ subSystems: { roof: userRoof } }),
      { presentKeys: RAY_PRESENT, now: NOW },
    );
    expect(out.subSystems.roof).toBe(userRoof);
    expect(out.subSystems.ground!.source).toBe('migration');
    expect(out.subSystems.fence!.source).toBe('migration');
  });

  it('idempotent under a stable clock (second pass deep-equals first)', () => {
    const once = ensureSubSystemShape(rayHybridConfig(), { presentKeys: RAY_PRESENT, now: NOW });
    const twice = ensureSubSystemShape(once, { presentKeys: RAY_PRESENT, now: NOW });
    expect(twice).toEqual(once);
    // and the healthy 3-entry map passes through by reference
    expect(twice.subSystems.roof).toBe(once.subSystems.roof);
    expect(twice.subSystems.fence).toBe(once.subSystems.fence);
  });

  it('no presentKeys / single present key ⇒ legacy single-bucket behavior unchanged', () => {
    const legacy = ensureSubSystemShape(rayHybridConfig(), { now: NOW });
    expect(Object.keys(legacy.subSystems)).toEqual(['fence']);
    const single = ensureSubSystemShape(rayHybridConfig(), { presentKeys: ['fence'], now: NOW });
    expect(single.subSystems).toEqual(legacy.subSystems);
    // a stored single-entry migration map on a SINGLE-type layout is NOT degenerate
    const stored = ensureSubSystemShape(rayHybridConfig(), { now: NOW });
    const again = ensureSubSystemShape(stored, { presentKeys: ['fence'], now: NOW });
    expect(again.subSystems.fence).toBe(stored.subSystems.fence);
  });

  it('untagged inverters still inherit the §1.5 chain key (tags unchanged by presentKeys)', () => {
    const out = ensureSubSystemShape(rayHybridConfig(), { presentKeys: RAY_PRESENT, now: NOW });
    expect((out.inverters![0] as any).subSystemKey).toBe('fence');
    expect((out.inverters![0].strings![0] as any).subSystemKey).toBe('fence');
  });
});

describe('detectDegenerateSingleFleet (Wave 4B items B/D)', () => {
  const RAY_STAMPS = { roof: 48, ground: 20, fence: 17 };
  const singleFleet = (panelCount: number, key?: SubSystemKey) => ([{
    ...(key ? { subSystemKey: key } : {}),
    strings: [{ panelCount }],
  }]);

  it("Ray's case: one 85-panel fleet tagged fence on a 48/20/17 layout ⇒ degenerate", () => {
    const r = detectDegenerateSingleFleet(singleFleet(85, 'fence'), 'fence', RAY_STAMPS);
    expect(r.degenerate).toBe(true);
    expect(r.key).toBe('fence');
    expect(r.fleetPanelTotal).toBe(85);
    expect(r.projectPanelTotal).toBe(85);
  });

  it('untagged fleet uses the fallback key', () => {
    const r = detectDegenerateSingleFleet(singleFleet(85), 'fence', RAY_STAMPS);
    expect(r.degenerate).toBe(true);
    expect(r.key).toBe('fence');
  });

  it('a correctly scoped sub fleet (total == its own stamp count) is NOT degenerate', () => {
    const r = detectDegenerateSingleFleet(singleFleet(17, 'fence'), 'fence', RAY_STAMPS);
    expect(r.degenerate).toBe(false);
  });

  it('a properly split multi-key fleet is NOT degenerate', () => {
    const fleet = [
      { subSystemKey: 'roof' as const, strings: [{ panelCount: 48 }] },
      { subSystemKey: 'ground' as const, strings: [{ panelCount: 20 }] },
      { subSystemKey: 'fence' as const, strings: [{ panelCount: 17 }] },
    ];
    expect(detectDegenerateSingleFleet(fleet, 'fence', RAY_STAMPS).degenerate).toBe(false);
  });

  it('single-type layouts and empty fleets are never degenerate', () => {
    expect(detectDegenerateSingleFleet(singleFleet(85, 'fence'), 'fence', { fence: 85 }).degenerate).toBe(false);
    expect(detectDegenerateSingleFleet([], 'fence', RAY_STAMPS).degenerate).toBe(false);
    expect(detectDegenerateSingleFleet(null, 'fence', RAY_STAMPS).degenerate).toBe(false);
  });

  it('a partial fleet far from the project total (placeholder 10-panel) is NOT degenerate', () => {
    const r = detectDegenerateSingleFleet(singleFleet(10, 'fence'), 'fence', RAY_STAMPS);
    expect(r.degenerate).toBe(false);
  });

  it('tolerance: within max(1, 2%) of the project total still counts as covering it', () => {
    // 85-panel project, fleet of 84 (one panel deleted in CAD moments ago)
    const r = detectDegenerateSingleFleet(singleFleet(84, 'fence'), 'fence', RAY_STAMPS);
    expect(r.degenerate).toBe(true);
  });
});
