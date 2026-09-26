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

import { describe, it, expect, vi } from 'vitest';
import { computeSystem } from '../lib/computed-system';
import { csMicroInput } from './goldens/wave0-fixtures';

// SLD route dependencies that are not under test (auth / rate limit / DB).
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  handleRouteDbError: (_tag: string, err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

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

describe('the drawn SLD — what Ray actually looks at', () => {
  // The engineering page's request: its own computeSystem's microBranches plus
  // the 16 fallback it still sends as inverterBranchLimit (app/engineering/
  // page.tsx fetchSLD). The route re-runs computeSystem from that body too.
  const postSld = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/engineering/sld/route');
    const req = new Request('http://localhost/api/engineering/sld', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('svg') || ct.includes('xml')
      ? await res.text()
      : ((await res.json()) as any).svg as string;
  };

  it('32 × IQ8+ draws "3 branches (11/11/10)" at 20 A — never 16/16', async () => {
    const cs = computeSystem(pageInput(32) as any);
    const svg = await postSld({
      format: 'svg',
      projectName: 'ENPHASE-32', clientName: 'Ray', address: '1 Test St, Pocahontas IL 62275',
      topologyType: 'MICROINVERTER', selectedBrand: 'enphase', systemType: 'roof',
      totalModules: 32, deviceCount: 32, totalStrings: 0,
      inverterManufacturer: 'Enphase', inverterModel: 'IQ8+',
      inverterAcKwPerDevice: 0.29, inverterAcCurrentMax: 1.21,
      acOutputKw: 32 * 0.29,
      panelModel: 'TSP-420', panelWatts: 420, panelVoc: 40.92, panelIsc: 13.03,
      mainPanelAmps: 200, panelBusRating: 200, interconnection: 'LOAD_SIDE',
      microBranches: cs.microBranches,
      inverterModulesPerDevice: 1,
      inverterBranchLimit: 16,
    });
    expect(svg).toContain('3 branches (11/11/10)');
    expect(svg).toContain('20A OCPD ea.');
    expect(svg).not.toContain('16/16');
    expect(svg).not.toContain('30A OCPD');
  });
});

// ── Every other place that COUNTS Enphase branches must agree with the SLD ──
// The sweep that followed 73404a66 found four more counters still on 16/branch
// (sizing engine, Explain Logic, BOM trunk table) or on a split of their own
// (the engineering card's branch bars). Each is pinned to the SLD's count here.
import { sizeSystemFromBrand } from '../lib/system/sizingEngine';
import { resolveTopology } from '../lib/topology-manager';
import { resolveTrunkCablePlan } from '../lib/equipment/trunkCable';
import { microBranchCount, enphaseBranchBasis } from '../lib/permit/utils/branching';

describe('every Enphase branch counter agrees with the SLD', () => {
  it('sizing engine: 32 × IQ8+ is 3 branches, and 3 terminators', () => {
    const r = sizeSystemFromBrand({
      systemType: 'roof', panelCount: 32, panelWattage: 420,
      selectedBrand: 'enphase', selectedInverterId: 'enphase-iq8plus',
    } as any);
    expect(r.acBranchCount).toBe(3);
    const term = r.requiredComponents.find(c => c.category === 'terminator');
    expect(term?.qtyPolicy).toBe('per_branch');
    expect(term?.qty).toBe(3);
  });

  it('Explain Logic (resolveTopology): Q-Cable sections and terminators are per branch', () => {
    for (const [id, n, branches] of [
      ['enphase-iq8plus', 32, 3], ['enphase-iq8m', 24, 3], ['enphase-iq8a', 32, 3],
      ['enphase-iq8h', 30, 3], ['enphase-iq8ac', 21, 3],
    ] as Array<[string, number, number]>) {
      const t = resolveTopology({ inverterId: id, moduleCount: n, stringCount: 0, inverterCount: 1 });
      const trunk = t.resolvedAccessories.find(a => a.category === 'trunk_cable');
      const term = t.resolvedAccessories.find(a => a.category === 'terminator');
      expect(trunk?.quantity, `${id} × ${n} trunk`).toBe(branches);
      expect(term?.quantity, `${id} × ${n} terminators`).toBe(branches);
    }
  });

  it('BOM trunk table: per-model max matches the datasheet (IQ8M 11, IQ8A 11), longest key wins', () => {
    const plan = (model: string, n: number) =>
      resolveTrunkCablePlan({ brand: 'Enphase', model, deviceCount: n })!.branchCount;
    expect(plan('IQ8+', 32)).toBe(3);
    expect(plan('IQ8M', 24)).toBe(3);   // was 2 on the old 12/branch
    expect(plan('IQ8M', 12)).toBe(2);   // was 1
    expect(plan('IQ8A', 32)).toBe(3);   // was 4 on the old 10/branch
    expect(plan('IQ8A', 22)).toBe(2);   // was 3
    expect(plan('IQ8AC', 21)).toBe(3);  // resolves via 'IQ8AC', not 'IQ8A'
    for (const [model, n] of [['IQ8+', 32], ['IQ8M', 24], ['IQ8A', 32], ['IQ8H', 30], ['IQ8AC', 21]] as const) {
      expect(plan(model, n), model).toBe(microBranchCount(n, model, 'Enphase'));
    }
  });

  it('a placeholder manufacturer on an IQ8+ still gets the Enphase 20 A cap', () => {
    expect(enphaseBranchBasis('IQ8+', 'Inverter Mfr')).toEqual({ maxPerBranch: 13, maxBranchOcpdA: 20 });
    expect(enphaseBranchBasis('IQ8+', '—')).toEqual({ maxPerBranch: 13, maxBranchOcpdA: 20 });
    expect(enphaseBranchBasis('DS3', 'APsystems')).toBeNull();
    const cs = computeSystem(pageInput(26, {
      inverterManufacturer: 'Inverter Mfr', inverterAcKw: 0.30, inverterBranchLimit: 13,
    }) as any);
    expect(cs.microBranches.every(b => b.ocpdAmps === 20)).toBe(true);
    expect(Math.max(...cs.microBranches.map(b => b.deviceCount))).toBeLessThanOrEqual(13);
  });

  it('a per-branch OCPD never exceeds 20 A for Enphase, even with a manufacturer 20 A max + peak kW', () => {
    const cs = computeSystem(pageInput(26, {
      inverterAcKw: 0.30, manufacturerMaxPerBranch20A: 13,
    }) as any);
    expect(cs.microBranches.every(b => b.ocpdAmps === 20)).toBe(true);
    expect(cs.runs.find(r => r.id === 'BRANCH_RUN')?.ocpdAmps).toBe(20);
    expect(cs.segmentSchedule.every(s => s.segmentType !== 'ARRAY_TO_JBOX' || s.ocpdAmps <= 20)).toBe(true);
  });

  it('non-Enphase inverterSpec.branchLimit output is unchanged (legacy passthrough)', () => {
    const cs = computeSystem({ ...pageInput(24, {
      inverterManufacturer: 'APsystems', inverterModel: 'DS3', inverterAcKw: 0.88,
      inverterAcCurrentMax: 3.7, inverterModulesPerDevice: 2,
    }), inverterBranchLimit: 0 } as any);
    expect(cs.inverterSpec).toBeTruthy();
    expect(cs.inverterSpec!.branchLimit).toBe(0);
    // …while an Enphase job reports the datasheet limit it was sized to.
    expect(computeSystem(pageInput(32) as any).inverterSpec!.branchLimit).toBe(13);
  });
});
