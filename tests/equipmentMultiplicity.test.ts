// ============================================================================
// CAPACITY DETERMINES MULTIPLICITY. TOPOLOGY DETERMINES ASSIGNMENT.
//
// Ray, 2026-09-26: "Do not implement one Envoy per site, one Envoy per array,
// one inverter per system, one combiner per brand … SolarPro must model as many
// physical devices as the engineered system actually requires." And: "For each
// equipment type with a capacity limit, test limit − 1, limit, limit + 1,
// 2 × limit, 2 × limit + 1. The device count must increment exactly at the
// real physical boundary. Also mutation-test the old shortcut quantity = 1."
//
// This file pins the generic solver (lib/equipment/equipmentMultiplicity.ts)
// on every dimension it knows, and the Enphase gateway adapter on every
// topology the catalogue offers.
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  solveMultiplicity,
  explainMultiplicity,
  type CapacityDimension,
  type CapacityLoad,
  type CapacityProfile,
} from '@/lib/equipment/equipmentMultiplicity';
import {
  ENPHASE_GATEWAY_MAX_EXPORT_A,
  enphaseBranches,
  enphaseUnitContinuousCurrentA,
  resolveGatewayMultiplicity,
  branchRangeText,
} from '@/lib/equipment/enphaseGatewayMultiplicity';
import {
  resolveIntegratedEquipment,
  planGatewayCount,
  planGatewayInstances,
  resolveHybridAcCollection,
  type HybridSourceInput,
} from '@/lib/equipment/integratedBos';

const profileOf = (dimension: CapacityDimension, max: number): CapacityProfile => ({
  deviceId: `test-${dimension}`, deviceLabel: `Test ${dimension} device`, instanceNoun: 'UNIT',
  limits: [{ dimension, max, source: 'test limit', basis: 'manufacturer' }],
});

/** `total` units of demand, split into loads of `unit` (the last one smaller). */
const loadsOf = (dimension: CapacityDimension, total: number, unit = 1): CapacityLoad[] => {
  const out: CapacityLoad[] = [];
  let left = total;
  let i = 0;
  while (left > 1e-9) {
    const d = Math.min(unit, left);
    out.push({ id: `L${++i}`, demand: { [dimension]: d } });
    left -= d;
  }
  return out;
};

// ── The boundary matrix, as a function so the shortcut can be run through it ──
type CountFn = (dimension: CapacityDimension, max: number, total: number) => number;
const realCount: CountFn = (dimension, max, total) =>
  solveMultiplicity(profileOf(dimension, max), loadsOf(dimension, total)).count;

const DIMENSIONS: Array<{ dimension: CapacityDimension; max: number }> = [
  { dimension: 'continuousCurrentA', max: 80 },   // Ray's gateway rule
  { dimension: 'branchPositions', max: 4 },       // IQ Combiner 4C/5C
  { dimension: 'branchOcpdSumA', max: 80 },
  { dimension: 'dcInputW', max: 11_400 },
  { dimension: 'acOutputW', max: 7_600 },
  { dimension: 'mpptInputs', max: 2 },
  { dimension: 'stringInputs', max: 3 },
  { dimension: 'devices', max: 600 },
  { dimension: 'batteryUnits', max: 4 },
];

function boundaryFailures(count: CountFn): string[] {
  const bad: string[] = [];
  for (const { dimension, max } of DIMENSIONS) {
    const cases: Array<[number, number]> = [
      [max - 1, 1], [max, 1], [max + 1, 2], [2 * max, 2], [2 * max + 1, 3],
    ];
    for (const [total, want] of cases) {
      const got = count(dimension, max, total);
      if (got !== want) bad.push(`${dimension} ${total}/${max}: got ${got}, want ${want}`);
    }
  }
  return bad;
}

describe('the generic solver increments exactly at the physical boundary, on every dimension', () => {
  it('limit − 1 → 1, limit → 1, limit + 1 → 2, 2×limit → 2, 2×limit + 1 → 3', () => {
    expect(boundaryFailures(realCount)).toEqual([]);
  });

  it('MUTATION — the old shortcut `quantity = 1` fails the matrix on every dimension', () => {
    const shortcut: CountFn = () => 1;
    const failures = boundaryFailures(shortcut);
    // limit+1, 2×limit and 2×limit+1 fail for all nine dimensions.
    expect(failures.length).toBe(DIMENSIONS.length * 3);
    for (const { dimension } of DIMENSIONS) {
      expect(failures.some(f => f.startsWith(dimension))).toBe(true);
    }
  });

  it("Ray's examples on the 80 A gateway rule: 62 → 1, 80 → 1, 81 → 2, 145 → 2, 161 → 3", () => {
    for (const [amps, want] of [[62, 1], [80, 1], [81, 2], [145, 2], [161, 3]] as const) {
      expect(realCount('continuousCurrentA', 80, amps), `${amps} A`).toBe(want);
    }
  });

  it('whole loads: 16 branches of 15 A on 80 A need FOUR instances, not ⌈240 ÷ 80⌉ = 3', () => {
    const loads = Array.from({ length: 16 }, (_, i) => ({ id: `B${i + 1}`, demand: { continuousCurrentA: 15 } }));
    const s = solveMultiplicity(profileOf('continuousCurrentA', 80), loads);
    expect(s.count).toBe(4);
    expect(s.instances.every(inst => (inst.totals.continuousCurrentA ?? 0) <= 80)).toBe(true);
    expect(s.instances.map(i => i.loadIds.length)).toEqual([5, 5, 5, 1]);
    expect(s.governing.kind).toBe('packing');
  });

  it('fills in design order — never an even split of amperes: 6 positions on a 4-position device → 4 + 2', () => {
    const loads = Array.from({ length: 6 }, (_, i) => ({ id: `B${i + 1}`, demand: { branchPositions: 1 } }));
    const s = solveMultiplicity(profileOf('branchPositions', 4), loads);
    expect(s.instances.map(i => i.loadIds)).toEqual([['B1', 'B2', 'B3', 'B4'], ['B5', 'B6']]);
  });

  it('keeps an array on one instance when that costs nothing: roof 3 + ground 3 → [roof] [ground], not [R R R G] [G G]', () => {
    const loads: CapacityLoad[] = [
      ...[1, 2, 3].map(n => ({ id: `roof:B${n}`, group: 'roof', demand: { branchPositions: 1 } })),
      ...[1, 2, 3].map(n => ({ id: `ground:B${n}`, group: 'ground', demand: { branchPositions: 1 } })),
    ];
    const s = solveMultiplicity(profileOf('branchPositions', 4), loads);
    expect(s.count).toBe(2);
    expect(s.instances.map(i => i.groups)).toEqual([['roof'], ['ground']]);
  });

  it('two small arrays SHARE one instance — arrays are not devices', () => {
    const loads: CapacityLoad[] = [
      { id: 'roof:B1', group: 'roof', demand: { branchPositions: 1 } },
      { id: 'ground:B1', group: 'ground', demand: { branchPositions: 1 } },
    ];
    const s = solveMultiplicity(profileOf('branchPositions', 4), loads);
    expect(s.count).toBe(1);
    expect(s.instances[0].groups).toEqual(['roof', 'ground']);
  });

  it('a load over a limit on its own sits alone and is reported, never dropped', () => {
    const loads: CapacityLoad[] = [
      { id: 'A', demand: { continuousCurrentA: 90 } },
      { id: 'B', demand: { continuousCurrentA: 10 } },
    ];
    const s = solveMultiplicity(profileOf('continuousCurrentA', 80), loads);
    expect(s.count).toBe(2);
    expect(s.oversized).toEqual([{ loadId: 'A', dimension: 'continuousCurrentA', demand: 90, max: 80 }]);
    expect(s.governing.kind).toBe('oversized');
    expect(explainMultiplicity(s)).toMatch(/A alone needs 90 A/);
  });

  it('nothing to carry → 0 instances; every limit is checked at once (the tightest governs)', () => {
    expect(solveMultiplicity(profileOf('branchPositions', 4), []).count).toBe(0);
    const p: CapacityProfile = {
      deviceId: 'x', deviceLabel: 'X', instanceNoun: 'UNIT',
      limits: [
        { dimension: 'continuousCurrentA', max: 80, source: 'rule', basis: 'installer-rule' },
        { dimension: 'branchPositions', max: 4, source: 'datasheet', basis: 'manufacturer' },
      ],
    };
    // 5 branches of 10 A = 50 A (one instance by current) but 5 positions (two by positions).
    const loads = Array.from({ length: 5 }, (_, i) => ({ id: `B${i + 1}`, demand: { continuousCurrentA: 10, branchPositions: 1 } }));
    const s = solveMultiplicity(p, loads);
    expect(s.count).toBe(2);
    expect(s.governing).toMatchObject({ kind: 'limit', dimension: 'branchPositions', source: 'datasheet' });
    expect(explainMultiplicity(s)).toBe('2 × X: branch breaker positions 5 exceeds the 4 one instance supports (datasheet).');
  });
});

// ── Enphase: the first proven implementation ────────────────────────────────

const IQ8PLUS = 'IQ8PLUS-72-2-US';
const single = (combinerId: string, devices: number, branches: number) => resolveIntegratedEquipment({
  inverterManufacturer: 'Enphase', inverterModel: IQ8PLUS, isMicro: true,
  totalDevices: devices, branchCount: branches, hasBattery: false,
  selectedCombinerId: combinerId,
});

describe('Enphase gateway capacity — Ray\'s 80 A and each device\'s own datasheet limits', () => {
  it('the per-unit rating comes from the manufacturer profile (IQ8+ 1.21 A; IQ8AC not via IQ8A)', () => {
    expect(ENPHASE_GATEWAY_MAX_EXPORT_A).toBe(80);
    expect(enphaseUnitContinuousCurrentA('IQ8PLUS-72-2-US')).toBe(1.21);
    expect(enphaseUnitContinuousCurrentA('IQ8AC-72-M-US')).toBe(1.6);
    expect(enphaseUnitContinuousCurrentA('IQ8A-72-2-US')).toBe(1.53);
    expect(enphaseUnitContinuousCurrentA('IQ7PLUS')).toBeNull();
  });

  it('branches use the engine\'s balanced split and each counts its micros × the rating', () => {
    const b = enphaseBranches({ laneKey: '', inverterModel: IQ8PLUS, deviceCount: 34, branchCount: 3 });
    expect(b.map(x => x.deviceCount)).toEqual([12, 11, 11]);
    expect(b.map(x => x.continuousA)).toEqual([14.52, 13.31, 13.31]);
    expect(b.every(x => x.ocpdA === 20)).toBe(true);
    // No rating on file: each branch counts at 80 % of its OCPD — never low.
    expect(enphaseBranches({ laneKey: 'roof', inverterModel: 'IQ7PLUS', deviceCount: 10, branchCount: 2 })
      .map(x => [x.id, x.continuousA])).toEqual([['roof:B1', 16], ['roof:B2', 16]]);
  });

  // IQ Combiner 4C / 5C: 4 branch positions (their 64 A and 80 A-of-breakers
  // limits bind at the same branch count for full 20 A branches).
  for (const id of ['enphase-iq-combiner-5c', 'enphase-iq-combiner-4c']) {
    it(`${id}: 3 → 1, 4 → 1, 5 → 2, 8 → 2, 9 → 3 branches (positions 4)`, () => {
      for (const [branches, want] of [[3, 1], [4, 1], [5, 2], [8, 2], [9, 3]] as const) {
        const plan = single(id, branches * 13, branches);
        expect(planGatewayCount(plan), `${branches} branches`).toBe(want);
        expect(plan.devices[0].quantity).toBe(want);
        if (want > 1) {
          expect(plan.gatewayMultiplicity?.explanation).toMatch(/branch breaker positions/);
          expect(plan.branchSlotWarning).toBeUndefined();   // the overflow IS the second combiner
        } else {
          expect(plan.gatewayMultiplicity).toBeUndefined();  // absent, not count 1 — digest-safe
        }
      }
    });
  }

  it('IQ Combiner 6C: 5 positions (quadplex) — 4 → 1, 5 → 1, 6 → 2, 10 → 2, 11 → 3', () => {
    for (const [branches, want] of [[4, 1], [5, 1], [6, 2], [10, 2], [11, 3]] as const) {
      expect(planGatewayCount(single('enphase-iq-combiner-6c', branches * 13, branches)), `${branches}`).toBe(want);
    }
  });

  it('standalone IQ Gateway: the 80 A rule governs — 66 IQ8+ (79.86 A) → 1, 67 (81.07 A) → 2', () => {
    const at = (devices: number) => {
      const branches = Math.ceil(devices / 13);
      return single('enphase-iq-gateway-standalone', devices, branches);
    };
    const p66 = at(66);
    expect(planGatewayCount(p66)).toBe(1);
    const p67 = at(67);
    expect(planGatewayCount(p67)).toBe(2);
    expect(p67.gatewayMultiplicity?.solution.governing).toMatchObject({ kind: 'limit', dimension: 'continuousCurrentA' });
    expect(p67.gatewayMultiplicity?.explanation).toMatch(/continuous output current 81\.07 A exceeds the 80 A/);
    // Each instance gets its own landing panel AND gateway.
    expect(p67.devices.map(d => [d.kind, d.quantity])).toEqual([['ac_combiner', 2], ['gateway', 2]]);
    expect(p67.aggregation?.quantity).toBe(2);
    expect(p67.gateway?.quantity).toBe(2);
    for (const inst of planGatewayInstances(p67)) expect(inst.continuousCurrentA).toBeLessThanOrEqual(80);
  });

  it('standalone: 2 × 80 A of whole branches — the count follows the branches, not ⌈A ÷ 80⌉', () => {
    // 132 IQ8+ on 11 branches of 12 = 14.52 A each (159.72 A): five fit one
    // gateway (72.6 A), six do not (87.1 A) — so 11 branches need 3, not 2.
    const p = single('enphase-iq-gateway-standalone', 132, 11);
    expect(p.gatewayMultiplicity?.solution.bounds.find(b => b.dimension === 'continuousCurrentA')?.lowerBound).toBe(2);
    expect(planGatewayCount(p)).toBe(3);
    expect(planGatewayInstances(p).map(i => i.branches.length)).toEqual([5, 5, 1]);
  });

  it('instances name their branches, and a single instance plan is the untouched legacy plan', () => {
    const p = single('enphase-iq-combiner-5c', 78, 6);
    const inst = planGatewayInstances(p);
    expect(inst.map(i => [i.label, branchRangeText(i.branches)])).toEqual([['GATEWAY 1', 'B1–B4'], ['GATEWAY 2', 'B5–B6']]);
    expect(inst.map(i => i.outputOcpdA)).toEqual([80, 40]);
    const one = single('enphase-iq-combiner-5c', 52, 4);
    expect(Object.keys(one)).not.toContain('gatewayMultiplicity');
  });

  it('a string job carrying a leftover Enphase pick counts nothing', () => {
    const p = resolveIntegratedEquipment({
      inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H', isMicro: false,
      totalDevices: 0, branchCount: 9, hasBattery: false, selectedCombinerId: 'enphase-iq-combiner-5c',
    });
    expect(p.gatewayMultiplicity).toBeUndefined();
  });

  it('the resolver agrees with the adapter directly (one rule, two entry points)', () => {
    const direct = resolveGatewayMultiplicity({
      topology: { id: 'enphase-iq-combiner-5c', brand: 'Enphase', model: 'IQ Combiner 5C' },
      sources: [{ laneKey: '', inverterModel: IQ8PLUS, deviceCount: 117, branchCount: 9 }],
    });
    expect(direct.count).toBe(planGatewayCount(single('enphase-iq-combiner-5c', 117, 9)));
  });
});

// ── Hybrid: gateways are counted over every array that shares the topology ──

const lane = (key: 'roof' | 'ground' | 'fence', devices: number, branches: number, over: Partial<HybridSourceInput> = {}): HybridSourceInput => ({
  key, inverterManufacturer: 'Enphase', inverterModel: IQ8PLUS, isMicro: true,
  branchCount: branches, deviceCount: devices, backfeedA: 20 * branches <= 80 ? 40 : 80,
  selectedCombinerId: 'enphase-iq-combiner-5c', ...over,
});
const stringLane = (key: 'roof' | 'ground' | 'fence'): HybridSourceInput => ({
  key, inverterManufacturer: 'SolarEdge', inverterModel: 'SE7600H', isMicro: false,
  branchCount: 2, deviceCount: 0, backfeedA: 40,
});

describe('hybrid AC collection pools arrays by topology — not one gateway per array', () => {
  it('two small Enphase arrays on the same 5C share ONE gateway (and there is no shared panel to feed)', () => {
    const c = resolveHybridAcCollection([lane('roof', 26, 2), lane('ground', 13, 1)]);
    expect(c.gateways.map(g => [g.index, g.laneKeys, g.branches.length])).toEqual([[1, ['roof', 'ground'], 3]]);
    expect(c.perSource.map(p => p.gatewayIndexes)).toEqual([[1], [1]]);
    expect(c.sources).toEqual([{ kind: 'gateway', gatewayIndex: 1, backfeedA: c.gateways[0].backfeedA }]);
    expect(c.gateways[0].wholeLaneKey).toBeUndefined();
    expect(c.sharedPanel).toBeNull();
  });

  it('one array too big for one 5C takes TWO gateways, and they land on the shared panel', () => {
    const c = resolveHybridAcCollection([lane('roof', 78, 6), stringLane('ground')]);
    expect(c.gateways.map(g => [g.label, branchRangeText(g.branches)])).toEqual([['GATEWAY 1', 'B1–B4'], ['GATEWAY 2', 'B5–B6']]);
    expect(c.perSource[0].gatewayIndexes).toEqual([1, 2]);
    expect(c.sources.map(s => s.kind)).toEqual(['gateway', 'gateway', 'lane']);
    expect(c.sharedPanel).not.toBeNull();
    expect(c.gateways[0].plan.devices[0].quantity).toBe(2);
  });

  it('an array that fits its own 5C collects EXACTLY as before (same backfeed, same panel)', () => {
    const roof = lane('roof', 26, 2);
    const c = resolveHybridAcCollection([roof, stringLane('ground')]);
    expect(c.gateways).toHaveLength(1);
    expect(c.gateways[0].wholeLaneKey).toBe('roof');
    expect(c.gateways[0].backfeedA).toBe(roof.backfeedA);
    expect(c.aggregateBackfeedA).toBe(roof.backfeedA + 40);
    expect(c.sharedPanel?.positions).toBeGreaterThanOrEqual(2);
  });

  it('different recorded topologies cannot share: roof 5C + ground 6C → two gateways', () => {
    const c = resolveHybridAcCollection([lane('roof', 13, 1), lane('ground', 13, 1, { selectedCombinerId: 'enphase-iq-combiner-6c' })]);
    expect(c.gateways.map(g => g.deviceId)).toEqual(['enphase-iq-combiner-5c', 'enphase-iq-combiner-6c']);
    expect(c.gateways.map(g => g.index)).toEqual([1, 2]);
  });

  it('roof 3 branches + ground 3 branches on a 5C: two gateways, one per array (no array split)', () => {
    const c = resolveHybridAcCollection([lane('roof', 39, 3), lane('ground', 39, 3)]);
    expect(c.gateways.map(g => g.laneKeys)).toEqual([['roof'], ['ground']]);
    expect(c.gateways.map(g => g.wholeLaneKey)).toEqual(['roof', 'ground']);
  });
});
