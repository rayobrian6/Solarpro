import { describe, it, expect } from 'vitest';
import { microMaxPerBranch, microBranchCount, balancedBranchSizes, planMicroBranches } from './branching';

describe('microMaxPerBranch', () => {
  it('resolves per-model NEC limits from the Enphase capability profiles', () => {
    // IQ8A = 11 per the Enphase datasheet's published "max units per 20A
    // branch" (continuous 349 VA basis — profile override, 2026-07-20).
    expect(microMaxPerBranch('IQ8A')).toBe(11);
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
// W=4 @ (38.7061, -90.0464), E=4 @ (38.7061, -90.0460). IQ8A max 11
// (datasheet continuous basis, 2026-07-20).
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
  it('plane-contained BALANCED splits at minimum per-plane count (Ray 2026-07-20)', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    // N=23 → ceil(23/11)=3 balanced [8,8,7]; S=22 → 2 × [11,11];
    // W+E caps (4+4) → one merged remainder branch of 8 → 6 homeruns total.
    expect(plan.count).toBe(6);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(53);
    expect([...plan.sizes].sort((a, b) => a - b)).toEqual([7, 8, 8, 8, 11, 11]);
    // no runt branches — balanced splits keep every branch ≥ 7 here
    expect(Math.min(...plan.sizes)).toBeGreaterThanOrEqual(7);
    // no branch exceeds the 30A single-branch ceiling (cap × 1.5)
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(16);
  });

  it('keeps each hip cap intact on one branch (never split across branches)', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    const branchOf = (id: string) => plan.assign.get(id);
    expect(new Set(['W-0','W-1','W-2','W-3'].map(branchOf)).size).toBe(1);
    expect(new Set(['E-0','E-1','E-2','E-3'].map(branchOf)).size).toBe(1);
  });

  // ⚠ OPEN RULING (Ray): with plane-contained balanced splits the main faces
  // no longer shed remainders, so tiny hip caps now merge with EACH OTHER —
  // on Melvin that pairs the W and E caps on ONE branch across the roof,
  // which conflicts with the standing 2026-07-03 ruling ("not linking
  // strings across opposite sides of the roof"). Options: attach caps to the
  // nearest face branch with room (5 homeruns, no cross-roof run) or accept
  // the cap-to-cap merge. Un-skip and pin whichever Ray rules.
  it.skip('merges hip caps with the NEAREST face branch, not across the roof (awaiting ruling)', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    const branchOf = (id: string) => plan.assign.get(id);
    expect(branchOf('W-0')).not.toBe(branchOf('E-0'));
  });

  it('single plane still chunks to minimum count', () => {
    // 21 @ cap 11 (over the 16-module single-branch ceiling) → 2 balanced
    // branches [11, 10].
    const panels = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, planeId: 'A', row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(2);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([11, 10]);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(21);
  });

  it('single plane at or under cap × 1.5 stays ONE branch (30A rule, Ray 2026-07-20)', () => {
    // Braidon's 12-module face: one branch on a 30A breaker, never 10 + a runt.
    const panels = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, planeId: 'A', row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(1);
    expect(plan.sizes).toEqual([12]);
  });

  it('no planeId → one global group, still NEC-sized and minimal', () => {
    const panels = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    // 25 > 16 (single-branch ceiling) → ceil(25/11) = 3 balanced branches.
    expect(plan.count).toBe(3);
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(11);
  });
});
