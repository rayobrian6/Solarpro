import { describe, it, expect } from 'vitest';
import { microMaxPerBranch, microBranchCount, microBranchMaxOcpdA, balancedBranchSizes, planMicroBranches } from './branching';

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

describe('microBranchMaxOcpdA — manufacturer branch OCPD authority (D-1)', () => {
  it('IQ8A-72-2-US branch OCPD max is 20A — never 30A', () => {
    expect(microBranchMaxOcpdA('IQ8A')).toBe(20);
    expect(microBranchMaxOcpdA('IQ8A-72-2-US')).toBe(20);
    expect(microBranchMaxOcpdA('Unknown')).toBe(20);
  });
});

describe('balancedBranchSizes', () => {
  it('spreads the remainder across the first branches', () => {
    expect(balancedBranchSizes(53, 6)).toEqual([9, 9, 9, 9, 9, 8]);
  });
});

// Melvin-shaped hip roof: N=23, S=22, W=4, E=4. IQ8A max 11.
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

// Braidon-shaped roof: two planes, 19 + 12 modules. IQ8A max 11.
function braidonPanels() {
  const mk = (plane: string, n: number, lat: number, lng: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${plane}-${i}`, planeId: plane,
      row: Math.floor(i / 10), col: i % 10,
      lat: lat + (Math.floor(i / 10)) * 1e-5, lng: lng + (i % 10) * 1e-5,
    }));
  return [...mk('P1', 19, 38.7062, -90.0463), ...mk('P2', 12, 38.7060, -90.0462)];
}

describe('planMicroBranches — D-1 manufacturer-authority plan (Ray 2026-07-20)', () => {
  it('Braidon shape: 31 IQ8A resolve to THREE legal branches 11/10/10', () => {
    const plan = planMicroBranches(braidonPanels(), 'IQ8A');
    expect(plan.count).toBe(3);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([11, 10, 10]);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(31);
    // manufacturer limit is a hard wall — never 12 on a branch
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(11);
  });

  it('physical roof grouping does NOT define branch boundaries (crossing allowed)', () => {
    // 19+12 with max 11 cannot be plane-contained at 3 branches — at least one
    // branch must span both planes, and D-1 explicitly permits it.
    const plan = planMicroBranches(braidonPanels(), 'IQ8A');
    const planesPerBranch = new Map<number, Set<string>>();
    for (const p of braidonPanels()) {
      const b = plan.assign.get(p.id)!;
      if (!planesPerBranch.has(b)) planesPerBranch.set(b, new Set());
      planesPerBranch.get(b)!.add(p.planeId);
    }
    const crossing = [...planesPerBranch.values()].filter(s => s.size > 1).length;
    expect(crossing).toBeGreaterThanOrEqual(1);
    // routing stays economical: at most one branch crosses on this shape
    expect(crossing).toBe(1);
  });

  it('Melvin shape: 53 @ max 11 → 5 balanced branches, no runts, none over limit', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    expect(plan.count).toBe(5);
    expect(plan.sizes.reduce((a, b) => a + b, 0)).toBe(53);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([11, 11, 11, 10, 10]);
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(11);
  });

  it('single plane chunks to minimum count', () => {
    const panels = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, planeId: 'A', row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(2);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([11, 10]);
  });

  it('a 12-module plane on IQ8A SPLITS (no 30A single-branch allowance)', () => {
    const panels = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, planeId: 'A', row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(2);
    expect([...plan.sizes].sort((a, b) => b - a)).toEqual([6, 6]);
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(11);
  });

  it('no planeId → one global group, still manufacturer-sized and minimal', () => {
    const panels = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}`, row: 0, col: i }));
    const plan = planMicroBranches(panels, 'IQ8A');
    expect(plan.count).toBe(3);
    expect(Math.max(...plan.sizes)).toBeLessThanOrEqual(11);
  });

  it('every panel lands in exactly one branch (partition invariant V4)', () => {
    const plan = planMicroBranches(melvinPanels(), 'IQ8A');
    const seen = new Set<string>();
    for (const p of melvinPanels()) {
      expect(plan.assign.has(p.id)).toBe(true);
      expect(seen.has(p.id)).toBe(false);
      seen.add(p.id);
    }
    expect(seen.size).toBe(53);
  });
});
