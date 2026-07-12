// ============================================================================
// Wave 2d — permit authority per-subsystem tests.
// See docs/ARCHITECTURE-per-subsystem-equipment.md §3 Wave 2d, Invariants
// I-1 (single-system byte parity), I-3 (own-equipment topology), I-4 (no
// cross-sub bleed), I-7 (per-sub scoping).
//
// The baseline JSON (wave2d-authority.baseline.json) was captured from the
// PRE-change buildConductorAuthority on the frozen roofProject fixture —
// the top-level authority output must stay deep-equal to it forever on the
// single-system path.
// ============================================================================
import { describe, it, expect } from 'vitest';
import baseline from './wave2d-authority.baseline.json';
import { buildConductorAuthority } from '@/lib/permit/utils/conductorAuthority';
import { resolveEquipment, resolveEquipmentBySubSystem } from '@/lib/permit/utils/helpers';
import { microMaxPerBranch, planMicroBranches, type BranchPlanPanel } from '@/lib/permit/utils/branching';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

// ── Hybrid 3-sub fixture: Enphase micro roof + Solis string ground +
//    SolFence OPTIMIZER fence (contract I-3 golden shape) ────────────────────
function mkHybrid() {
  const input: any = clone(roofProject);
  (input.project.panelPositions as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  if (input.layout?.panels) (input.layout.panels as any[]).forEach((p: any, i: number) => {
    p.systemType = i < 4 ? 'fence' : i < 8 ? 'ground' : 'roof';
  });
  input.system.inverters = [
    {
      manufacturer: 'Enphase', model: 'IQ8M', type: 'micro',
      acOutputKw: 0.33, maxDcVoltage: 60, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'roof', strings: [],
    },
    {
      manufacturer: 'Solis', model: 'S6-GR1P6K', type: 'string',
      acOutputKw: 6.0, maxDcVoltage: 600, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'ground',
      strings: [{
        label: 'G-1', panelCount: 4, panelManufacturer: 'Tesla', panelModel: 'TSP-420',
        panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03, isc: 13.03,
        wireGauge: '#10 AWG', wireLength: 80,
      }],
    },
    {
      manufacturer: 'SolFence', model: 'SF-OPT-3800', type: 'optimizer',
      acOutputKw: 3.8, maxDcVoltage: 480, efficiency: 0.97, ulListing: 'UL 1741',
      subSystemKey: 'fence',
      strings: [{
        label: 'F-1', panelCount: 4, panelManufacturer: 'SolFence', panelModel: 'SF-BIF-400',
        panelWatts: 400, panelVoc: 37.1, panelIsc: 13.6, isc: 13.6,
        wireGauge: '#10 AWG', wireLength: 60,
      }],
    },
  ];
  return input;
}

// Minimal CAD carriage (structural — only what the authority reads).
function mkHybridCad(): any {
  return {
    systemType: 'roof',
    totalPanels: 12,
    hybrid: {
      sections: [
        { key: 'roof',   totalPanels: 4, equipment: { topology: 'micro', inverterMfr: 'Enphase', inverterModel: 'IQ8M', acKwPerDevice: 0.33 } },
        { key: 'ground', totalPanels: 4, equipment: { topology: 'string', inverterMfr: 'Solis', inverterModel: 'S6-GR1P6K' } },
        { key: 'fence',  totalPanels: 4, equipment: { topology: 'optimizer', inverterMfr: 'SolFence', inverterModel: 'SF-OPT-3800', panelModel: 'SF-BIF-400', panelWatts: 400, voc: 37.1, isc: 13.6 } },
      ],
    },
  };
}

// ═════ 1. Single-system byte parity (I-1) ═════════════════════════════════
describe('wave 2d — single-system parity', () => {
  it('top-level authority output is deep-equal to the pre-change baseline', () => {
    const auth = buildConductorAuthority(clone(roofProject), null);
    // The baseline predates the per-sub set — compare the legacy projection.
    const { subSystems, isHybrid, ...legacyView } = auth as any;
    expect(legacyView).toEqual(baseline);
  });

  it('single-system sub view MIRRORS the top level (one entry, derived)', () => {
    const auth = buildConductorAuthority(clone(roofProject), null);
    expect(auth.isHybrid).toBe(false);
    expect(auth.subSystems).toHaveLength(1);
    const solo = auth.subSystems[0];
    expect(solo.key).toBe('roof');
    expect(solo.topology).toBe(auth.topology);
    expect(solo.microBranches).toBe(auth.microBranches);   // same reference — derived, not recomputed
    expect(solo.dcStrings).toBe(auth.dcStrings);
    expect(solo.governingOcpd).toBe(auth.governingOcpd);
    expect(solo.egc).toEqual(auth.egc);
    expect(solo.panelCount).toBe(12);
    expect(solo.deviceCount).toBe(12);
  });
});

// ═════ 2. Hybrid 3-sub authority set (I-3 / I-4 / I-7) ═════════════════════
describe('wave 2d — hybrid per-sub authority', () => {
  it('produces one authority per sub with each sub\'s OWN topology', () => {
    const auth = buildConductorAuthority(mkHybrid(), mkHybridCad());
    expect(auth.isHybrid).toBe(true);
    expect(auth.subSystems.map(s => s.key)).toEqual(['roof', 'ground', 'fence']);
    const [roof, ground, fence] = auth.subSystems;
    expect(roof.topology).toBe('MICRO');
    expect(ground.topology).toBe('STRING');
    expect(fence.topology).toBe('OPTIMIZER');   // SolFence = optimizers, from ITS OWN equipment
  });

  it('micro branches cover ONLY the roof panels; perMicroA from roof per-device kW', () => {
    const auth = buildConductorAuthority(mkHybrid(), mkHybridCad());
    const roof = auth.subSystems.find(s => s.key === 'roof')!;
    expect(roof.panelCount).toBe(4);
    expect(roof.deviceCount).toBe(4);
    // perMicroA = the ROOF sub's own per-device kW (0.33 kW → 1.375 A),
    // never totalAcKw/totalPanels across sub boundaries.
    expect(roof.perMicroA).toBeCloseTo((0.33 * 1000) / 240, 6);
    const devicesOnBranches = roof.microBranches.reduce((s, b) => s + b.deviceCount, 0);
    expect(devicesOnBranches).toBe(4);
    // Aggregate micro branches = roof's only (ground/fence contribute none).
    expect(auth.microBranches.reduce((s, b) => s + b.deviceCount, 0)).toBe(4);
  });

  it('string/optimizer subs produce DC string groupings, never fake AC branches', () => {
    const auth = buildConductorAuthority(mkHybrid(), mkHybridCad());
    const ground = auth.subSystems.find(s => s.key === 'ground')!;
    const fence = auth.subSystems.find(s => s.key === 'fence')!;
    expect(ground.microBranches).toHaveLength(0);
    expect(fence.microBranches).toHaveLength(0);
    expect(ground.dcStrings).toHaveLength(1);
    expect(fence.dcStrings).toHaveLength(1);
    // Each sub's strings come from ITS OWN tagged inverter.
    expect(ground.dcStrings[0].invIdx).toBe(1);
    expect(fence.dcStrings[0].invIdx).toBe(2);
    // The roof (micro) sub carries no DC strings.
    const roof = auth.subSystems.find(s => s.key === 'roof')!;
    expect(roof.dcStrings).toHaveLength(0);
  });

  it('aggregate view is consistent with the set (derived, reindexed)', () => {
    const auth = buildConductorAuthority(mkHybrid(), mkHybridCad());
    // Aggregate strings = ground + fence, reindexed 1..n.
    expect(auth.dcStrings).toHaveLength(2);
    expect(auth.dcStrings.map(d => d.index)).toEqual([1, 2]);
    // Primary sub (roof-first rule) drives the legacy topology fields.
    expect(auth.topology).toBe('MICRO');
    expect(auth.isMicro).toBe(true);
    // Governing OCPD = max across subs.
    const maxSub = Math.max(...auth.subSystems.map(s => s.governingOcpd));
    expect(auth.governingOcpd).toBe(maxSub);
    // Per-sub AC feeders carry each sub's own amps.
    const ground = auth.subSystems.find(s => s.key === 'ground')!;
    expect(ground.acSubFeeder.currentA).toBeCloseTo((6.0 * 1000) / 240, 6);
  });
});

// ═════ 3. resolveEquipmentBySubSystem precedence chain ═════════════════════
describe('wave 2d — resolveEquipmentBySubSystem precedence', () => {
  it('untagged / N=1 payload falls back to legacy resolveEquipment exactly', () => {
    const input: any = clone(roofProject);
    expect(resolveEquipmentBySubSystem(input, 'roof', null)).toEqual(resolveEquipment(input));
  });

  it('1: the sub\'s tagged fleet wins over the CAD section carriage', () => {
    const input = mkHybrid();
    const cad = mkHybridCad();
    cad.hybrid.sections.find((s: any) => s.key === 'fence').equipment.inverterModel = 'WRONG-MODEL';
    const eq = resolveEquipmentBySubSystem(input, 'fence', cad);
    expect(eq.inverterModel).toBe('SF-OPT-3800');       // tagged inverter, not section
    expect(eq.panelModel).toBe('SF-BIF-400');           // from the fence fleet's own strings
    expect(eq.inverterManufacturer).toBe('SolFence');
  });

  it('2: section equipment fills the gaps when the sub has no tagged inverter', () => {
    const input = mkHybrid();
    input.system.inverters = input.system.inverters.filter((i: any) => i.subSystemKey !== 'fence');
    const eq = resolveEquipmentBySubSystem(input, 'fence', mkHybridCad());
    expect(eq.inverterModel).toBe('SF-OPT-3800');       // from cad.hybrid.sections[fence].equipment
    expect(eq.inverterType).toBe('optimizer');
    expect(eq.panelWatts).toBe(400);
    expect(eq.panelVoc).toBeCloseTo(37.1, 6);
  });

  it('3: canonical partition panel wattage backfills when fleet+section lack it', () => {
    const input = mkHybrid();
    input.system.inverters = input.system.inverters.filter((i: any) => i.subSystemKey !== 'ground');
    input.project._canonical = {
      subSystems: [{ key: 'ground', panels: [{ wattage: 415 }] }],
    };
    const cad = mkHybridCad();
    delete cad.hybrid.sections.find((s: any) => s.key === 'ground').equipment.panelWatts;
    const eq = resolveEquipmentBySubSystem(input, 'ground', cad);
    expect(eq.panelWatts).toBe(415);
  });

  it('never backfills a sub\'s panel from the project-wide winner (partial carriage)', () => {
    const input = mkHybrid();
    // Fence sub keeps only section inverter data — no panel model anywhere per-sub.
    input.system.inverters = input.system.inverters.filter((i: any) => i.subSystemKey !== 'fence');
    const cad = mkHybridCad();
    const fenceSec = cad.hybrid.sections.find((s: any) => s.key === 'fence');
    delete fenceSec.equipment.panelModel;
    const eq = resolveEquipmentBySubSystem(input, 'fence', cad);
    expect(eq.panelModel).toBe('—');   // blank, NOT the roof fleet's panel
  });
});

// ═════ 4. planMicroBranches sub-system fencing (I-4) ═══════════════════════
describe('wave 2d — branch fencing + capability profiles', () => {
  it('never mixes panels across systemType boundaries, even on one plane', () => {
    // 13 roof + 3 fence on the SAME plane: the legacy planner would pack one
    // 13-module branch straight through the boundary.
    const panels: BranchPlanPanel[] = Array.from({ length: 16 }, (_, i) => ({
      id: `p${i}`, planeId: 'plane-1', row: Math.floor(i / 4), col: i % 4,
      systemType: i < 13 ? 'roof' : 'fence',
    }));
    const plan = planMicroBranches(panels, 'IQ8PLUS');
    const branchTypes = new Map<number, Set<string>>();
    for (const p of panels) {
      const b = plan.assign.get(p.id)!;
      if (!branchTypes.has(b)) branchTypes.set(b, new Set());
      branchTypes.get(b)!.add(p.systemType!);
    }
    for (const types of branchTypes.values()) expect(types.size).toBe(1);
    // All 16 assigned; roof gets its own full branch of 13, fence its own 3.
    expect(plan.assign.size).toBe(16);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([13, 3]);
  });

  it('single-system payloads take the byte-identical legacy path', () => {
    const panels: BranchPlanPanel[] = Array.from({ length: 16 }, (_, i) => ({
      id: `p${i}`, planeId: 'plane-1', row: Math.floor(i / 4), col: i % 4,
    }));
    const withStamps = panels.map(p => ({ ...p, systemType: 'roof' }));
    const legacy = planMicroBranches(panels, 'IQ8PLUS');
    const stamped = planMicroBranches(withStamps, 'IQ8PLUS');
    expect(stamped.sizes).toEqual(legacy.sizes);
    expect([...stamped.assign.entries()]).toEqual([...legacy.assign.entries()]);
  });

  it('non-Enphase capability profiles resolve from the trunk-cable catalog', () => {
    expect(microMaxPerBranch('DS3')).toBe(4);            // APsystems flagship
    expect(microMaxPerBranch('DS3-S')).toBe(5);          // per-model override
    expect(microMaxPerBranch('DS3-L')).toBe(6);
    expect(microMaxPerBranch('HMS-800-2T')).toBe(5);     // Hoymiles
    expect(microMaxPerBranch('BDM-800')).toBe(5);        // NEP
    expect(microMaxPerBranch('QT2', 'APsystems')).toBe(4);
    expect(microMaxPerBranch('unknown-model', 'Hoymiles')).toBe(5);
    // Enphase + unknowns unchanged (legacy defaults preserved).
    expect(microMaxPerBranch('IQ8M')).toBe(11);
    expect(microMaxPerBranch('Mystery X1')).toBe(13);
    expect(microMaxPerBranch(undefined)).toBe(13);
  });
});

// ═════ 5. generatePermit — per-sub electrical fleet ════════════════════════
describe('wave 2d — generatePermit per-sub InverterInputs', () => {
  it('hybrid tagged fleet reaches the compliance run per-sub (micro deviceCount from ITS sub)', () => {
    const input = mkHybrid();
    generatePermitHTML(input);
    const e: any = input.compliance?.electrical;
    expect(e).toBeTruthy();
    expect(e.inverters).toHaveLength(3);
    // Micro fleet sized from the ROOF sub (4 modules × 0.33), not 12 modules;
    // totalAcKw = 1.32 (roof) + 6.0 (ground) + 3.8 (fence) = 11.12 kW.
    expect(e.summary?.totalAcKw).toBeCloseTo(4 * 0.33 + 6.0 + 3.8, 2);
  });

  it('legacy single-system permit generation is unaffected (fixture regression)', () => {
    const input = clone(roofProject);
    const html = generatePermitHTML(input);
    expect(html).toContain('IQ8M');
  });
});
