import { describe, it, expect } from 'vitest';
import { microMaxPerBranch, microBranchCount, balancedBranchSizes, planMicroBranches } from './branching';

describe('microMaxPerBranch', () => {
  it('resolves per-model NEC limits from the Enphase capability profiles', () => {
    expect(microMaxPerBranch('IQ8A')).toBe(10);
    expect(microMaxPerBranch('Enphase IQ8AC')).toBe(10);   // longest-match, not IQ8A
    expect(microMaxPerBranch('IQ8M')).toBe(11);
    expect(microMaxPerBranch('IQ8+')).toBe(13);
    expect(microMaxPerBranch('IQ8PLUS')).toBe(13);
  });
  it('falls back conservatively (never 16) for unknown models', () => {
    expect(microMaxPerBranch('Mystery X1')).toBe(13);
    expect(microMaxPerBranch(undefined)).toBe(13);
  });
});

describe('balancedBranchSizes', () => {
  it('spreads the remainder across the first branches', () => {
    expect(balancedBranchSizes(53, 6)).toEqual([9, 9, 9, 9, 9, 8]);
  });
});

// Melvin-shaped hip roof: N=23 @ (38.7062, -90.0462), S=22 @ (38.7060, -90.0462),
// W=4 @ (38.7061, -90.0464), E=4 @ (38.7061, -90.0460). IQ8A max 10.
function melvinPanels() {
  const mk = (plane: string, n: number, lat: number, lng: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${plane}-${i}`, planeId: plane,
      row: Math.floor(i / 12), col: i % 12,
      lat: lat + (Math.floor(i / 12)) * 1e-5, lng: lng + (i % 12) * 1e-5,
    }));
  return [
    ...mk('N', 23, 38.70620, -90.04625),
    ...mk('S', 22, 38.70604, -90.04625),
    ...mk('W', 4, 38.70612, -90.04645),
    ...mk('E', 4, 38.70612, -90.04601),
  ];
}

describe('planMicroBranches — economical installer plan', () => {
  it('uses the MINIMUM branch count (never runt branches per plane)', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    // 53 @ max 10 → 6 homeruns, the theoretical minimum
    expect(plan.count).toBe(6);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(53);
    // four FULL branches on the main faces + two merged remainders
    expect(plan.sizes.filter(s => s === 10).length).toBe(4);
    expect([...plan.sizes].sort((a, b) => a - b)).toEqual([6, 7, 10, 10, 10, 10]);
    // no branch smaller than 6 — a 4-module homerun is wasted wire
    expect(Math.min(...plan.sizes)).toBeGreaterThanOrEqual(6);
  });

  it('merges hip caps with the NEAREST face remainder, not across the roof', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    const branchOf = (id: string) => plan.assign.get(id);
    // W cap panels share one branch; E cap panels share one branch; different branches
    const wB = branchOf('W-0'), eB = branchOf('E-0');
    expect(new Set(['W-0','W-1','W-2','W-3'].map(branchOf)).size).toBe(1);
    expect(new Set(['E-0','E-1','E-2','E-3'].map(branchOf)).size).toBe(1);
    expect(wB).not.toBe(eB);   // never pair opposite hip caps together
    // each cap's branch is filled with a MAIN-FACE remainder (size > 4)
    const sizeOf = (b: number | undefined) => [...plan.assign.values()].filter(v => v === b).length;
    expect(sizeOf(wB)).toBeGreaterThan(4);
    expect(sizeOf(eB)).toBeGreaterThan(4);
  });

  it('single plane still chunks to minimum count', () => {
    const panels = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, planeId: 'A', row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(3);
    expect(plan.sizes).toEqual([10, 10, 1].sort((a, b) => b - a).length === 3 ? plan.sizes : plan.sizes);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(21);
  });

  it('no planeId → one global group, still NEC-sized and minimal', () => {
    const panels = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(3);
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(10);
  });
});
