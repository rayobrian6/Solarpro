// ============================================================================
// Wave 2a — computeMultiSystem + per-sub compute scoping.
// docs/ARCHITECTURE-per-subsystem-equipment.md §1.7 / §3 "2a Compute".
//
// Locks (compute half): I-1 (N=1 deep-equal to plain computeSystem, bare run
// ids), I-6 (aggregator-owned POI: shared service runs emitted ONCE, exactly
// one 705.12(B) check), I-7 (roof-only rooftop temp adder), the acKwPerDevice
// guard (07-11 phantom-250A lesson), the runMap/facade contract (aggregate
// runs findable by `${sub}:` namespaced id), and Addendum B ruling 1
// (sharedTrenchFt metadata, conduits per-sub).
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeSystem, getTempDerating, nextStandardOCPD, type RunSegmentId } from '../../lib/computed-system';
import {
  computeMultiSystem,
  namespacedRunId,
  parseRunId,
  SHARED_SERVICE_RUN_IDS,
  type MultiSubSystemInput,
} from '../../lib/computed-multi-system';
import { deriveRunLengths } from '../../lib/bom/deriveRunLengths';
import { buildComputedRunsForPermit } from '../../lib/permit/utils/computedRuns';
import { generateCADLayout } from '../../lib/cad/cadEngine';
import { roofProject } from '../../test-fixtures/roofProject';
import { csMicroInput, csStringInput, stripVolatile } from './wave0-fixtures';

// ─── The contract's I-3 golden hybrid: Enphase micro roof (48) + Solis string
//     ground (26) + optimizer fence (17) ──────────────────────────────────────

function roofMicro48(): MultiSubSystemInput {
  return { ...csMicroInput(), totalPanels: 48, subSystemKey: 'roof' };
}

function groundSolis26(): MultiSubSystemInput {
  return {
    ...csStringInput(),
    subSystemKey: 'ground',
    totalPanels: 26, totalStrings: 2,
    inverterManufacturer: 'Solis', inverterModel: 'S6-GR1P7.6K-US',
    rooftopTempAdderC: 0, // ground runs never bake at roof-surface temps (I-7)
    trenchRunLengthFt: 80,
  };
}

function fenceOptimizer17(): MultiSubSystemInput {
  return {
    ...csStringInput(),
    subSystemKey: 'fence',
    topology: 'optimizer',
    totalPanels: 17, totalStrings: 1,
    optimizerMaxOutputCurrent: 15,
    inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H-US',
    rooftopTempAdderC: 0,
    trenchRunLengthFt: 120,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. N=1 parity — the I-10 golden basis (ids asserted bare)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeMultiSystem N=1 — deep-equal to plain computeSystem (I-1)', () => {
  it('STRING: aggregate deep-equals computeSystem(fixture); ids bare; no subSystem stamps', () => {
    const multi = computeMultiSystem([{ ...csStringInput(), subSystemKey: 'roof' }]);
    const plain = computeSystem(csStringInput());
    expect(stripVolatile(multi.aggregate)).toEqual(stripVolatile(plain));
    multi.aggregate.runs.forEach(r => {
      expect(String(r.id)).not.toContain(':');
      expect(r.subSystem).toBeUndefined();
    });
    expect(multi.subSystems.roof).toBe(multi.aggregate); // same object, zero re-derivation drift
    expect(multi.primaryKey).toBe('roof');
    expect(multi.subSystemKeys).toEqual(['roof']);
    expect(multi.sharedTrenchFt).toBeUndefined();
  });

  it('MICRO: aggregate deep-equals computeSystem(fixture)', () => {
    const multi = computeMultiSystem([{ ...csMicroInput(), subSystemKey: 'roof' }]);
    const plain = computeSystem(csMicroInput());
    expect(stripVolatile(multi.aggregate)).toEqual(stripVolatile(plain));
  });

  it('FENCE-only project stays fence (never default-roof — I-8)', () => {
    const multi = computeMultiSystem([fenceOptimizer17()]);
    expect(multi.primaryKey).toBe('fence');
    expect(multi.subSystems.fence).toBeDefined();
    expect(multi.subSystems.roof).toBeUndefined();
    // And N=1 output still equals the plain engine run of the same core input.
    const { subSystemKey: _k, trenchRunLengthFt: _t, ...core } = fenceOptimizer17();
    expect(stripVolatile(multi.aggregate)).toEqual(stripVolatile(computeSystem(core)));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. computed-system flags (Wave 2a deliverable 2)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeSystem — emitSharedServiceRuns flag + subSystemKey stamp', () => {
  it('default (absent) emits the full service tail — legacy path untouched', () => {
    const cs = computeSystem(csStringInput());
    for (const id of SHARED_SERVICE_RUN_IDS) {
      expect(cs.runs.some(r => r.id === id)).toBe(true);
    }
  });

  it('false suppresses DISCO_TO_METER_RUN + MSP_TO_UTILITY_RUN runs AND their schedule rows', () => {
    const legacy = computeSystem(csStringInput());
    const cs = computeSystem({ ...csStringInput(), emitSharedServiceRuns: false });
    for (const id of SHARED_SERVICE_RUN_IDS) {
      expect(cs.runs.some(r => r.id === id)).toBe(false);
    }
    expect(cs.runs.length).toBe(legacy.runs.length - 2);
    // segment-schedule rows dropped too — per-sub bomQuantities cannot
    // double-count service wire footage across N subs.
    expect(cs.segmentSchedule.some(s => s.segmentType === 'DISCO_TO_METER')).toBe(false);
    expect(cs.segmentSchedule.some(s => s.segmentType === 'MSP_TO_UTILITY')).toBe(false);
    expect(legacy.segmentSchedule.some(s => s.segmentType === 'DISCO_TO_METER')).toBe(true);
  });

  it('subSystemKey stamps every run ON THE MULTI-SYSTEM PER-SUB PATH (§1.3)', () => {
    const cs = computeSystem({ ...csStringInput(), subSystemKey: 'ground', emitSharedServiceRuns: false });
    expect(cs.runs.length).toBeGreaterThan(0);
    cs.runs.forEach(r => expect(r.subSystem).toBe('ground'));
  });

  it('tag presence ALONE never stamps — I-10 quarantine (behavior gates on N>1, not tags)', () => {
    const cs = computeSystem({ ...csStringInput(), subSystemKey: 'ground' });
    cs.runs.forEach(r => expect(r.subSystem).toBeUndefined());
  });
});

describe('computeSystem — acKwPerDevice guard (07-11 phantom-250A lesson)', () => {
  it('fires when a SYSTEM-level kW arrives on the per-device micro contract', () => {
    const cs = computeSystem({ ...csMicroInput(), inverterAcKw: 7.6 }); // 7.6 kW "per device" = a system rating
    const guard = cs.issues.find(i => i.code === 'MICRO_ACKW_PER_DEVICE');
    expect(guard).toBeDefined();
    expect(guard!.severity).toBe('warning');
  });

  it('silent on genuine per-device ratings (0.29 kW IQ8+) and on string topology', () => {
    expect(computeSystem(csMicroInput()).issues.some(i => i.code === 'MICRO_ACKW_PER_DEVICE')).toBe(false);
    expect(computeSystem(csStringInput()).issues.some(i => i.code === 'MICRO_ACKW_PER_DEVICE')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. The 3-sub hybrid (I-3 fixture: micro roof + string ground + optimizer fence)
// ═════════════════════════════════════════════════════════════════════════════

describe('computeMultiSystem N=3 hybrid — Enphase roof 48 + Solis ground 26 + optimizer fence 17', () => {
  const multi = computeMultiSystem([groundSolis26(), fenceOptimizer17(), roofMicro48()]); // deliberately unordered
  const { aggregate, subSystems } = multi;
  const roof = subSystems.roof!;
  const ground = subSystems.ground!;
  const fence = subSystems.fence!;

  it('fixed roof > ground > fence ordering regardless of caller array order (§1.4)', () => {
    expect(multi.subSystemKeys).toEqual(['roof', 'ground', 'fence']);
    expect(multi.primaryKey).toBe('roof');
  });

  it('each sub computes from its OWN equipment — topology never a project-wide winner (I-3)', () => {
    expect(roof.isMicro).toBe(true);
    expect(ground.isString).toBe(true);
    expect(ground.isOptimizer).toBe(false);
    expect(fence.isOptimizer).toBe(true);
    expect(roof.totalPanels + ground.totalPanels + fence.totalPanels).toBe(91);
  });

  it('AC output + kW summed at the POI', () => {
    const expectAcKw = roof.totalAcKw + ground.totalAcKw + fence.totalAcKw;
    expect(aggregate.totalAcKw).toBeCloseTo(expectAcKw, 9);
    expect(aggregate.totalAcKw).toBeCloseTo(48 * 0.29 + 7.6 + 7.6, 6);
    expect(aggregate.acOutputCurrentA).toBeCloseTo(
      roof.acOutputCurrentA + ground.acOutputCurrentA + fence.acOutputCurrentA, 9);
    expect(aggregate.totalPanels).toBe(91);
    expect(aggregate.bomQuantities.panels).toBe(91);
  });

  it('backfeed = Σ per-PHYSICAL-inverter rounded OCPDs across subs (§1.7 judge fix)', () => {
    // roof micro: combiner backfeed = the sub's rounded OCPD; ground/fence:
    // one physical inverter each → per-inverter OCPD = sub OCPD.
    const expected = roof.acOcpdAmps + ground.acOcpdAmps + fence.acOcpdAmps;
    expect(aggregate.backfeedBreakerAmps).toBe(expected);
    expect(ground.acOcpdAmps).toBe(nextStandardOCPD((7.6 * 1000 / 240) * 1.25)); // 40 A
  });

  it('exactly ONE aggregate 705.12(B) check; per-sub 120% issues suppressed (I-6)', () => {
    // 160 A backfeed + 200 A main = 360 A > 240 A (120% of 200 A bus) → POI fails.
    expect(aggregate.interconnectionPass).toBe(false);
    const poiIssues = aggregate.issues.filter(i => i.code === 'NEC_705_12B_120PCT');
    expect(poiIssues.length).toBe(1);
    expect(poiIssues[0].message).toContain('roof+ground+fence');
    // The roof sub ALONE fails its own 120% check (80+200 > 240) — that
    // per-sub verdict must not leak into the aggregate issue list.
    expect(roof.interconnectionPass).toBe(false);
    expect(poiIssues[0].message).not.toContain('[roof]');
  });

  it('run ids namespaced `${subKey}:`; shared service runs emitted ONCE, bare (I-6)', () => {
    for (const id of SHARED_SERVICE_RUN_IDS) {
      expect(aggregate.runs.filter(r => String(r.id) === id).length).toBe(1);
      expect(aggregate.runs.filter(r => String(r.id).endsWith(`:${id}`)).length).toBe(0);
    }
    const nonShared = aggregate.runs.filter(r => !SHARED_SERVICE_RUN_IDS.includes(r.id));
    nonShared.forEach(r => expect(String(r.id)).toMatch(/^(roof|ground|fence):/));
    // and the shared tail is sized at Σ acOutputCurrentA:
    const svc = aggregate.runs.find(r => String(r.id) === 'DISCO_TO_METER_RUN')!;
    expect(svc.continuousCurrent).toBeCloseTo(aggregate.acOutputCurrentA, 6);
    expect(svc.subSystem).toBeUndefined(); // shared — owned by no sub
    // exactly one service row in the merged segment schedule too:
    expect(aggregate.segmentSchedule.filter(s => s.segmentType === 'DISCO_TO_METER').length).toBe(1);
    expect(aggregate.segmentSchedule.filter(s => s.segmentType === 'MSP_TO_UTILITY').length).toBe(1);
  });

  it('roof-only rooftop temp adder (I-7): roof runs derated at ambient+30, ground/fence at ambient', () => {
    expect(roof.rooftopTempAdderC).toBe(30);
    expect(ground.rooftopTempAdderC).toBe(0);
    expect(fence.rooftopTempAdderC).toBe(0);
    const roofRun = aggregate.runMap[namespacedRunId('roof', 'ROOF_RUN') as RunSegmentId]!;
    const groundDc = aggregate.runMap[namespacedRunId('ground', 'DC_STRING_RUN') as RunSegmentId]!;
    expect(roofRun.tempDeratingFactor).toBe(getTempDerating(30 + 30)); // 0.71
    expect(groundDc.tempDeratingFactor).toBe(getTempDerating(30));    // 1.00
    expect(groundDc.tempDeratingFactor).toBeGreaterThan(roofRun.tempDeratingFactor);
  });

  it('runMap/facade contract: aggregate runs findable by namespaced id, stamped with their sub', () => {
    const branch = aggregate.runMap[namespacedRunId('roof', 'BRANCH_RUN') as RunSegmentId]!;
    expect(branch).toBeDefined();
    expect(branch.subSystem).toBe('roof');
    expect(aggregate.runs).toContain(branch);
    const fenceDc = aggregate.runMap[namespacedRunId('fence', 'DC_STRING_RUN') as RunSegmentId]!;
    expect(fenceDc.subSystem).toBe('fence');
    expect(parseRunId(String(fenceDc.id))).toEqual({ subSystem: 'fence', baseId: 'DC_STRING_RUN' });
    expect(Object.keys(aggregate.runMap).sort()).toEqual(aggregate.runs.map(r => String(r.id)).sort());
  });

  it('acBranchCount summed (micro subs only); string/micro facade blocks merged', () => {
    expect(roof.acBranchCount).toBeGreaterThan(0);
    expect(aggregate.acBranchCount).toBe(roof.acBranchCount); // only micro sub contributes
    expect(aggregate.stringCount).toBe(ground.stringCount + fence.stringCount);
    expect(aggregate.strings.length).toBe(ground.strings.length + fence.strings.length);
    expect(aggregate.microBranches.length).toBe(roof.microBranches.length);
    expect(aggregate.microDeviceCount).toBe(roof.microDeviceCount);
  });

  it('equipment tags suffixed PV-R1/INV-G1/… at N>1; POI gear appears once (§1.7)', () => {
    const tags = aggregate.equipmentSchedule.map(r => r.tag);
    expect(tags).toContain('PV-R1');
    expect(tags).toContain('MICRO-R1');
    expect(tags).toContain('PV-G1');
    expect(tags).toContain('INV-G1');
    expect(tags).toContain('PV-F1');
    expect(tags).toContain('INV-F1');
    expect(tags.filter(t => t === 'MSP-1').length).toBe(1);
    expect(tags.filter(t => t === 'AC-DISC-1').length).toBe(1);
    expect(tags.filter(t => t === 'METER-1').length).toBe(1);
    expect(tags).not.toContain('PV-1'); // unsuffixed per-sub tags never leak at N>1
  });

  it('shared trench metadata (Addendum B ruling 1): max(80, 120) ft, conduits stay per-sub', () => {
    expect(multi.sharedTrenchFt).toBe(120);
    // No raceway merge: ground and fence each keep their own conduit runs.
    const groundConduits = aggregate.conduitSchedule.filter(c =>
      aggregate.runs.some(r => String(r.id).startsWith('ground:') && r.from === c.from && r.to === c.to));
    expect(groundConduits.length).toBeGreaterThan(0);
  });

  it('per-device-kW assertion propagates through the aggregate, tagged with its sub', () => {
    const bad = computeMultiSystem([
      { ...roofMicro48(), inverterAcKw: 7.6 }, // system-level kW on the per-device contract
      groundSolis26(),
    ]);
    const guard = bad.aggregate.issues.find(i => i.code === 'MICRO_ACKW_PER_DEVICE');
    expect(guard).toBeDefined();
    expect(guard!.message.startsWith('[roof]')).toBe(true);
  });

  it('single-lane SLD surface absent at N>1 (I-8 — banner, never a plausible-wrong diagram)', () => {
    expect(aggregate.segments).toBeUndefined();
    expect(aggregate.segmentIssues).toBeUndefined();
  });

  it('guards: duplicate keys and empty input throw', () => {
    expect(() => computeMultiSystem([])).toThrow();
    expect(() => computeMultiSystem([roofMicro48(), roofMicro48()])).toThrow(/duplicate/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. deriveRunLengths + buildComputedRunsForPermit scoping (deliverable 3)
// ═════════════════════════════════════════════════════════════════════════════

describe('deriveRunLengths — explicit systemType beats cad.systemType', () => {
  // A hybrid-shaped CAD: whole-project systemType says roof, but ground
  // geometry exists. Legacy call must ignore it; scoped call must use it.
  const hybridCad = {
    systemType: 'roof',
    ground: {
      arrays: [{ originX: 0, originY: 0, dimensions: { arrayWidthM: 10, arrayDepthM: 4 } }],
    },
    conduitRoutes: [], electricalNodes: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 4 },
  } as never;

  it('legacy (no opts): roof branch only — no ground-derived lengths', () => {
    const { runLengths } = deriveRunLengths(hybridCad);
    expect(runLengths.DC_STRING_RUN).toBeUndefined(); // no cad.roof geometry
  });

  it("explicit systemType 'ground_mount' (and engineering spelling 'ground') derives ground lengths", () => {
    for (const st of ['ground_mount', 'ground']) {
      const { runLengths, derivationNotes } = deriveRunLengths(hybridCad, { systemType: st });
      expect(runLengths.DC_STRING_RUN).toBeGreaterThan(0);
      expect(derivationNotes.DC_STRING_RUN).toContain('ground array');
    }
  });
});

describe('buildComputedRunsForPermit — per-subsystem opts (kills the hardcoded 33 °C)', () => {
  const mk = () => {
    const input = JSON.parse(JSON.stringify(roofProject));
    const cad = generateCADLayout(input);
    return { input, cad };
  };

  it('legacy call unchanged: service tail present, 33 °C adder, no subSystem stamps', () => {
    const { input, cad } = mk();
    const runs = buildComputedRunsForPermit(input, cad as never)!;
    expect(runs.some(r => r.id === 'MSP_TO_UTILITY_RUN')).toBe(true);
    runs.forEach(r => expect(r.subSystem).toBeUndefined());
    const roofRun = runs.find(r => r.id === 'ROOF_RUN')!;
    expect(roofRun.tempDeratingFactor).toBe(getTempDerating(40 + 33)); // legacy 33 °C preserved
  });

  it('scoped call: rooftop adder from env (0 for non-roof), tail suppressed, runs stamped', () => {
    const { input, cad } = mk();
    const runs = buildComputedRunsForPermit(input, cad as never, {
      systemType: 'solar_fence',
      subSystemKey: 'fence',
      rooftopTempAdderC: 0,
      emitSharedServiceRuns: false,
    })!;
    expect(runs.some(r => r.id === 'DISCO_TO_METER_RUN')).toBe(false);
    expect(runs.some(r => r.id === 'MSP_TO_UTILITY_RUN')).toBe(false);
    runs.forEach(r => expect(r.subSystem).toBe('fence'));
    const roofRun = runs.find(r => r.id === 'ROOF_RUN')!;
    expect(roofRun.tempDeratingFactor).toBe(getTempDerating(40)); // no roof bake for fence conductors
  });

  it("scoped call without explicit adder derives it from systemType (roof→33, fence→0)", () => {
    const { input, cad } = mk();
    const roofScoped = buildComputedRunsForPermit(input, cad as never, { systemType: 'roof' })!;
    const fenceScoped = buildComputedRunsForPermit(input, cad as never, { systemType: 'fence' })!;
    expect(roofScoped.find(r => r.id === 'ROOF_RUN')!.tempDeratingFactor).toBe(getTempDerating(73));
    expect(fenceScoped.find(r => r.id === 'ROOF_RUN')!.tempDeratingFactor).toBe(getTempDerating(40));
  });

  it('panel subset: opts.totalPanels overrides the whole-project count', () => {
    const { input, cad } = mk();
    const whole = buildComputedRunsForPermit(input, cad as never)!;
    const subset = buildComputedRunsForPermit(input, cad as never, {
      totalPanels: 4, systemType: 'roof',
    })!;
    const wholeFeeder = whole.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    const subsetFeeder = subset.find(r => r.id === 'COMBINER_TO_DISCO_RUN')!;
    expect(subsetFeeder.continuousCurrent).toBeLessThan(wholeFeeder.continuousCurrent);
  });
});
