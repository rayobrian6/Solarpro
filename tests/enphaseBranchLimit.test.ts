// ============================================================================
// Enphase AC branch limit — Ray's report, 2026-09-25.
//
// "32 panels, Enphase topology, it put the strings at 16 and 16. Max is 13."
//
// The engineering page hands computeSystem `invData.branchLimit ?? 16` — the
// Microinverter record has no `branchLimit` field, so every Enphase job
// arrived as 16. The breaker picker then tried 20 A (13/branch → 3 branches,
// uneven) and 30 A (min(19, 16) = 16 → 2 branches, even), preferred the even
// split, and drew 16 + 16 on a 30 A breaker. Enphase publishes 13 IQ8+ per
// 20 A branch and a 20 A maximum branch OCPD, so both numbers were illegal.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { computeSystem } from '../lib/computed-system';
import { csMicroInput } from './goldens/wave0-fixtures';

// The engineering page's exact shape for an IQ8+ job (app/engineering/page.tsx
// buildCsInputFor): model 'IQ8+', acKw 0.290, and the 16 fallback.
const pageInput = (totalPanels: number, over: Record<string, unknown> = {}) => ({
  ...csMicroInput(),
  totalPanels,
  inverterManufacturer: 'Enphase',
  inverterModel: 'IQ8+',
  inverterAcKw: 0.29,
  inverterAcCurrentMax: 1.21,
  inverterBranchLimit: 16,
  ...over,
});

const branchRun = (cs: ReturnType<typeof computeSystem>) =>
  cs.runs.find(r => r.id === 'BRANCH_RUN');

describe('Enphase branch limit — manufacturer authority, never the 16 fallback', () => {
  it('32 × IQ8+ is three 20 A branches of 11/11/10 — never 16 + 16', () => {
    const cs = computeSystem(pageInput(32) as any);
    expect(cs.microBranches.map(b => b.deviceCount)).toEqual([11, 11, 10]);
    expect(cs.microBranches.every(b => b.ocpdAmps === 20)).toBe(true);
    expect(cs.acBranchCount).toBe(3);
  });

  it('no Enphase branch exceeds its datasheet max, at any size', () => {
    const cases: Array<[string, number, number]> = [
      // model, acKw (max continuous), datasheet max per 20 A branch
      ['IQ8+', 0.29, 13],
      ['IQ8M', 0.325, 11],
      ['IQ8A', 0.349, 11],
      ['IQ8H', 0.38, 10],
    ];
    for (const [model, acKw, max] of cases) {
      for (let n = 1; n <= 80; n++) {
        const cs = computeSystem(pageInput(n, { inverterModel: model, inverterAcKw: acKw }) as any);
        const sizes = cs.microBranches.map(b => b.deviceCount);
        expect(sizes.reduce((s, x) => s + x, 0), `${model} n=${n}`).toBe(n);
        expect(Math.max(...sizes), `${model} n=${n} sizes=${sizes}`).toBeLessThanOrEqual(max);
        expect(cs.microBranches.every(b => b.ocpdAmps <= 20), `${model} n=${n} ocpd`).toBe(true);
        // minimum legal homerun count — no extra branches either
        expect(sizes.length, `${model} n=${n}`).toBe(Math.ceil(n / max));
      }
    }
  });

  it('the Enphase OCPD cap holds even when acKw is the PEAK rating (33 × IQ8A @ 366 VA)', () => {
    // 20 A → floor(20 / (1.525 × 1.25)) = 10 → 4 branches (uneven);
    // 30 A → 11 → 3 branches (even). The even split must not buy a 30 A breaker.
    const cs = computeSystem(pageInput(33, { inverterModel: 'IQ8A', inverterAcKw: 0.366 }) as any);
    expect(cs.microBranches.every(b => b.ocpdAmps === 20)).toBe(true);
    expect(Math.max(...cs.microBranches.map(b => b.deviceCount))).toBeLessThanOrEqual(11);
  });

  it('the conductor schedule agrees with the branch table (same count, 20 A)', () => {
    const cs = computeSystem(pageInput(32) as any);
    const run = branchRun(cs);
    expect(run?.ocpdAmps).toBe(20);
    // Segment 1 (array → j-box) carries one BLK + one RED per branch.
    const seg = cs.segmentSchedule.find(s => s.segmentType === 'ARRAY_TO_JBOX');
    expect(seg, 'ARRAY_TO_JBOX segment').toBeTruthy();
    expect(seg!.conductorBundle.find(c => c.color === 'BLK')?.qty).toBe(3);
    expect(seg!.ocpdAmps).toBe(20);
  });

  it('APsystems DS3 keeps its datasheet 30 A branch option (not an Enphase rule)', () => {
    const cs = computeSystem(pageInput(48, {
      inverterManufacturer: 'APsystems', inverterModel: 'DS3',
      inverterAcKw: 0.88, inverterAcCurrentMax: 3.7, inverterModulesPerDevice: 2,
      manufacturerMaxPerBranch20A: 4, manufacturerMaxPerBranch30A: 6,
    }) as any);
    // 24 devices: 20 A → 4/branch → 6 branches; 30 A → 6/branch → 4 branches.
    // Both even → the picker's tie-break keeps 20 A (pre-patch behaviour).
    expect(cs.microBranches.map(b => b.deviceCount)).toEqual([4, 4, 4, 4, 4, 4]);

    // 30 devices: 20 A → 8 branches (uneven) vs 30 A → 5 × 6 (even). 30 A is
    // legal for DS3 (datasheet: 6 per 30 A branch) and must survive the cap.
    const cs30 = computeSystem(pageInput(60, {
      inverterManufacturer: 'APsystems', inverterModel: 'DS3',
      inverterAcKw: 0.88, inverterAcCurrentMax: 3.7, inverterModulesPerDevice: 2,
      manufacturerMaxPerBranch20A: 4, manufacturerMaxPerBranch30A: 6,
    }) as any);
    expect(cs30.microBranches.map(b => b.deviceCount)).toEqual([6, 6, 6, 6, 6]);
    expect(cs30.microBranches.every(b => b.ocpdAmps === 30)).toBe(true);
  });
});
