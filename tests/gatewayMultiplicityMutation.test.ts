// ============================================================================
// MUTATION — THE OLD SHORTCUT `quantity = 1` IS RESTORED HERE, AND THE CHECKS FAIL.
//
// Ray, 2026-09-26: "Also mutation-test the old shortcut quantity = 1. The test
// must fail for oversized systems."
//
// The shortcut is restored by its behaviour, byte for byte in effect: before
// the capacity solver, every Enphase design got ONE IQ Combiner / Envoy
// whatever its branches, the plan carried no multiplicity, every device row
// read quantity 1 and every consumer followed. The mock below makes the
// adapter answer exactly that — one instance holding every branch — and the
// SAME checks tests/gatewayMultiplicityEveryConsumer.test.ts runs against the
// real code are run here: they must report every consumer wrong on an
// oversized design, and nothing wrong on a design one combiner carries.
// ============================================================================

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('@/lib/equipment/enphaseGatewayMultiplicity', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/equipment/enphaseGatewayMultiplicity')>();
  return {
    ...orig,
    // "One Envoy per site": one instance, every branch on it, whatever the limits.
    resolveGatewayMultiplicity: (args: Parameters<typeof orig.resolveGatewayMultiplicity>[0]) => {
      const real = orig.resolveGatewayMultiplicity(args);
      if (real.count <= 1) return real;
      const branches = real.instances.flatMap(i => i.branches);
      const one = {
        ...real.instances[0],
        branches,
        laneKeys: [...new Set(branches.map(b => b.laneKey))],
        deviceCount: branches.reduce((s, b) => s + b.deviceCount, 0),
        continuousCurrentA: branches.reduce((s, b) => s + b.continuousA, 0),
        branchOcpdSumA: branches.reduce((s, b) => s + b.ocpdA, 0),
      };
      return { ...real, count: 1, instances: [one] };
    },
  };
});

import { engineeringCounts, countMismatches, FIVE_C_BOUNDARY, bigRoofPermit } from './support/gatewayMultiplicityCases';
import { generateCADLayout } from '@/lib/cad/cadEngine';
import { buildIntegratedEquipment } from '@/lib/permit/utils/integratedEquipment';
import { planGatewayCount } from '@/lib/equipment/integratedBos';

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy.mockRestore(); warnSpy.mockRestore(); });

describe('with the old `quantity = 1` shortcut restored', () => {
  it.each(FIVE_C_BOUNDARY.filter(([, need]) => need > 1))(
    '%i branches (needs %i): the every-consumer check FAILS on every consumer', (branches, need) => {
      const bad = countMismatches(engineeringCounts(branches), need);
      // All seven consumers — plan, drawing fields, drawing, engine feeders, the
      // engine's combiner row and BOM quantity, and the BOM — say 1.
      expect(bad).toHaveLength(7);
      expect(bad.every(b => b.includes('=1 '))).toBe(true);
    });

  it.each(FIVE_C_BOUNDARY.filter(([, need]) => need === 1))(
    '%i branches (needs 1): the shortcut happens to be right, and the check passes', (branches) => {
      expect(countMismatches(engineeringCounts(branches), 1)).toEqual([]);
    });

  it('the oversized permit package collapses to one combiner — the check that it needs two fails', () => {
    const p = bigRoofPermit();
    const bos = buildIntegratedEquipment(p, generateCADLayout(p as never));
    expect(planGatewayCount(bos)).toBe(1);
    expect(bos.gatewayMultiplicity).toBeUndefined();
  });
});
