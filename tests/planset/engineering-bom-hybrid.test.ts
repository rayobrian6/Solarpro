// ============================================================
// Engineering BOM — Hybrid multi-system (P3)
// tests/planset/engineering-bom-hybrid.test.ts
//
// A hybrid project (51 roof + 26 ground + 17 fence panels) must NOT collapse
// to a single-system BOM:
//   • fence structural scales to the fence SUBSET with correct section math
//     (6' config = 2 panels/section → ceil(17/2) = 9 sections, NOT 94 sections
//     at $253.35 each — the $61.8k lie),
//   • ground structural scales to the ground subset (26),
//   • the roof subset gets NEC 690.12 RSD (TS4) devices + racking lines,
//   • legacy single-type payloads (no subsystem fields) keep their behavior,
//     EXCEPT the deliberate per-panel-section guard (solarSectionCount ===
//     moduleCount on a 6' config is the 1:1 client bug → halved, loudly).
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  deriveStructuralBOM,
  deriveStructuralBOMForSubsystems,
} from '@/lib/bom-system-profiles';

// ── Route dependency mocks (auth / rate limit / DB are not under test) ──
vi.mock('@/lib/security', () => ({
  requireAuth: vi.fn(async () => ({ user: { id: 'test-user' }, response: null })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  // Pricing block catches this and falls back to the static catalog.
  getDbReady: vi.fn(async () => { throw new Error('no db in tests'); }),
  // If the route's outer catch fires, surface the REAL error to the test.
  handleRouteDbError: (_tag: string, err: unknown) => {
    throw err instanceof Error ? err : new Error(String(err));
  },
}));

async function postBom(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/engineering/bom/route');
  const req = new Request('http://solarpro.test/api/engineering/bom', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req as any);
  const json = await res.json();
  return { status: res.status, json };
}

type AnyItem = { category: string; partNumber?: string; quantity: number };
const itemsOf = (json: any): AnyItem[] => json.bom?.items ?? [];
const byPart = (json: any, partNumber: string): AnyItem | undefined =>
  itemsOf(json).find(i => i.partNumber === partNumber);
const qtyByCategory = (json: any, category: string): number =>
  itemsOf(json).filter(i => i.category === category).reduce((s, i) => s + i.quantity, 0);

// Full fenceData shape the engineering client sends (CAD-derived fields).
const fenceData = (overrides: Record<string, unknown> = {}) => ({
  totalPosts: 0,
  postSpacingFt: 8,
  postEmbedFt: 3,
  postHeightFt: 6,          // 6' config → 2 panels/section
  railCount: 2,
  totalFenceLengthFt: 400,
  segmentCount: 1,
  gateCount: 0,
  gateWidthsFt: [],
  solarSectionCount: 0,
  vinylSectionCount: 0,
  panelWidthFt: 3.3,
  panelHeightFt: 5.5,
  ...overrides,
});

const groundData = {
  pileCount: 12,
  pileSpacingFt: 8,
  pileEmbedmentFt: 5,
  structureType: 'driven_pile',
  rowCount: 2,
  panelsPerRow: 13,
  arrayWidthFt: 45,
  railsPerRow: 2,
  groundClearanceFt: 2,
};

const baseBody = (overrides: Record<string, unknown> = {}) => ({
  systemType: 'fence',
  inverterId: 'fronius-primo-8.2',      // string inverter, NO integrated RSD
  panelId: 'rec-alpha-pure-r-405',
  moduleCount: 94,
  stringCount: 4,
  inverterCount: 1,
  systemKw: 38.1,
  mainPanelAmps: 200,
  acOCPD: 40,
  backfeedAmps: 40,
  attachmentCount: 0,                    // page sends 0 for non-roof (legacy)
  railSections: 0,
  ...overrides,
});

describe('engineering BOM route — hybrid multi-system payload', () => {
  it('(a) hybrid 51 roof / 26 ground / 17 fence → fence sections 9, posts 10, ground scaled to 26, RSD 51, roof racking lines', async () => {
    const { status, json } = await postBom(baseBody({
      subSystemCounts: { roof: 51, ground: 26, fence: 17 },
      // Client bug shape: solarSectionCount = TOTAL panels (94). fencePanelCount wins.
      fenceData: fenceData({ solarSectionCount: 94, fencePanelCount: 17 }),
      groundData,
      roofData: { attachmentCount: 24, railSections: 8, mountingSystemId: 'rooftech-mini', panelCount: 51 },
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // ── FENCE subset: 17 panels on 6' sections → ceil(17/2) = 9, NOT 94/17 ──
    expect(byPart(json, 'SOLFENCE-SECTION-6')?.quantity).toBe(9);
    expect(byPart(json, 'SOLFENCE-POST-6.5')?.quantity).toBe(10);   // sections + 1
    expect(byPart(json, 'SOLFENCE-APEX-CAP')?.quantity).toBe(10);   // 1 per post
    expect(byPart(json, 'SOLFENCE-DONUT')?.quantity).toBe(18);      // 2 per section
    expect(byPart(json, 'SOLFENCE-RCP')?.quantity).toBe(9);         // 1 per section
    expect(byPart(json, 'LOCAL-DRIVEN-STEEL-POST')?.quantity).toBe(10); // 1 per post

    // ── GROUND subset: structural scaled to 26 panels ──
    expect(byPart(json, 'UNIRAC-RM10-DRIVEN')?.quantity).toBe(12);  // pileCount from CAD
    expect(byPart(json, 'UNIRAC-RM10-BOND')?.quantity).toBe(26);    // bonding clips = ground subset
    expect(byPart(json, 'GNDMNT-GNDLUG')?.quantity).toBe(13);       // ceil(26 / 2)
    // Ground rails COEXIST with roof rails (different physical assemblies)
    expect(byPart(json, 'UNIRAC-RM10-RAIL')).toBeDefined();

    // ── ROOF subset: NEC 690.12 RSD for the 51 on-building modules ──
    const rsd = byPart(json, 'TS4-A-F');
    expect(rsd?.category).toBe('rapid_shutdown');
    expect(rsd?.quantity).toBe(51);

    // ── ROOF subset: racking lines from roofData (attachmentCount/railSections threaded) ──
    expect(byPart(json, 'RT-MINI-ASSY')?.quantity).toBe(24);        // perAttachment
    expect(byPart(json, 'LAG-516-3-SS')?.quantity).toBe(48);        // attachments × 2
    expect(byPart(json, 'XR-100-168B')).toBeDefined();              // roof rail line emitted

    // merge diagnostics present for hybrid
    expect(json.merge).toBeDefined();
    expect(json.merge.structuralItemCount).toBeGreaterThan(0);
  });

  it('(b) legacy pure-fence: real CAD solarSectionCount=40 for 80 panels → CAD wins (40 sections, 41 posts)', async () => {
    const { status, json } = await postBom(baseBody({
      moduleCount: 80,
      systemKw: 32,
      fenceData: fenceData({ solarSectionCount: 40 }),   // plausible: 40 < 80
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(byPart(json, 'SOLFENCE-SECTION-6')?.quantity).toBe(40);
    expect(byPart(json, 'SOLFENCE-POST-6.5')?.quantity).toBe(41);
    // Legacy fence project without subSystemCounts: no on-roof modules → no RSD
    expect(byPart(json, 'TS4-A-F')).toBeUndefined();
    // No ground structural without groundData
    expect(qtyByCategory(json, 'pile')).toBe(0);
  });

  it('(c) legacy fence with the 1:1 bug shape (solarSectionCount === moduleCount = 94) → halved to 47 sections', async () => {
    const { status, json } = await postBom(baseBody({
      fenceData: fenceData({ solarSectionCount: 94 }),   // per-panel slots, NOT sections
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(byPart(json, 'SOLFENCE-SECTION-6')?.quantity).toBe(47);  // ceil(94/2)
    expect(byPart(json, 'SOLFENCE-POST-6.5')?.quantity).toBe(48);
  });

  it('legacy pure-roof payload is untouched: no merge block, no fence/ground structural, RSD = full module count', async () => {
    const { status, json } = await postBom(baseBody({
      systemType: 'roof',
      moduleCount: 20,
      systemKw: 8,
      rackingId: 'rooftech-mini',
      attachmentCount: 10,
      railSections: 4,
    }));

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.merge).toBeUndefined();
    expect(qtyByCategory(json, 'fence_section')).toBe(0);
    expect(qtyByCategory(json, 'pile')).toBe(0);
    expect(byPart(json, 'TS4-A-F')?.quantity).toBe(20);
  });
});

describe('bom-system-profiles — subsystem partition + fence section math', () => {
  it('partition runs BOTH fence and ground branches, each scoped to its subset', () => {
    const r = deriveStructuralBOMForSubsystems({
      systemType: 'fence',
      moduleCount: 94,
      subSystemCounts: { roof: 51, ground: 26, fence: 17 },
      fencePanelCount: 17,
      fence: fenceData({ solarSectionCount: 94 }) as any,
      ground: groundData as any,
    });
    expect(r.subsystemsRun.sort()).toEqual(['fence', 'ground']);
    const q = (pn: string) => r.items.find(i => i.partNumber === pn)?.quantity;
    expect(q('SOLFENCE-SECTION-6')).toBe(9);
    expect(q('UNIRAC-RM10-BOND')).toBe(26);   // moduleCount scoped to ground subset
    expect(q('GNDMNT-GNDLUG')).toBe(13);
  });

  it('a genuinely physical CAD solar-section count (< fencePanelCount) still wins', () => {
    const r = deriveStructuralBOMForSubsystems({
      systemType: 'fence',
      moduleCount: 17,
      fencePanelCount: 17,
      fence: fenceData({ solarSectionCount: 8 }) as any,   // 8 < 17 → plausible
    });
    expect(r.items.find(i => i.category === 'fence_section')?.quantity).toBe(8);
  });

  it("4' config is 1 panel per section: fencePanelCount 17 → 17 sections (SOLFENCE-SECTION-4)", () => {
    const r = deriveStructuralBOMForSubsystems({
      systemType: 'fence',
      moduleCount: 17,
      fencePanelCount: 17,
      fence: fenceData({ postHeightFt: 4, solarSectionCount: 17 }) as any,
    });
    const section = r.items.find(i => i.category === 'fence_section');
    expect(section?.partNumber).toBe('SOLFENCE-SECTION-4');
    expect(section?.quantity).toBe(17);       // 1:1 is CORRECT for the 4' config
    expect(r.items.find(i => i.category === 'fence_post')?.quantity).toBe(18);
  });

  it('permit-path shape: deriveStructuralBOM with per-PANEL fenceCAD sections (17 for 17 panels, 6\' config) → guard yields 9', () => {
    // bomForPermit calls deriveStructuralBOM directly for hybrid fence subs with
    // moduleCount = sec.totalPanels. If fenceCAD emits one 'solar' section per
    // panel, the per-panel guard must catch it (17 → 9, not 17).
    const r = deriveStructuralBOM({
      systemType: 'fence',
      moduleCount: 17,
      fence: fenceData({ solarSectionCount: 17 }) as any,
    });
    expect(r.items.find(i => i.category === 'fence_section')?.quantity).toBe(9);
    expect(r.items.find(i => i.category === 'fence_post')?.quantity).toBe(10);
  });

  it('legacy no-partition params reduce to the single-branch behavior (ground)', () => {
    const r = deriveStructuralBOMForSubsystems({
      systemType: 'ground',
      moduleCount: 26,
      ground: groundData as any,
    });
    expect(r.subsystemsRun).toEqual(['ground']);
    expect(r.items.find(i => i.partNumber === 'UNIRAC-RM10-BOND')?.quantity).toBe(26);
    expect(r.items.some(i => i.category === 'fence_section')).toBe(false);
  });
});
