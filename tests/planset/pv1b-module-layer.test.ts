// ═══════════════════════════════════════════════════════════════════════════
// PV-1B MODULE LAYER — canonical-projection parity with PV-1 + branch membership.
//
// Regression guard for the PV-1B "missing module polygons" defect: the circuit
// sheet must render the SAME canonical module polygons PV-1 draws (read only from
// PermitDesignSnapshot.moduleInstances, projected viewport∘DT-SITE(drawnPolygon)),
// never a locally-recreated rectangle from generic dims. Modules carry their
// branch membership (Braidon 11/10/10) as branch-colored outlines + light fills;
// the branch wires + micro symbols OVERLAY — never replace — the module layer.
// Uses the frozen Braidon fixture (zero DB) exactly like the truth-matrix tests.
import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { braidonOriginalAuditFixture } from '../fixtures/braidon-original-audit-fixture';
import {
  parsePlacementManifests, checkRenderParity, checkRenderedIdCoverage, scanRenderedObjectIds,
} from '@/lib/permit/snapshot/coordinateAuthority';
import type { PermitDesignSnapshot } from '@/lib/permit/snapshot/types';

const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o));

function generate(): { html: string; snap: PermitDesignSnapshot } {
  const input = clone(braidonOriginalAuditFixture) as any;
  const html = generatePermitHTML(input);
  return { html, snap: input._snapshot as PermitDesignSnapshot };
}

const pageOf = (html: string, id: string): string => {
  const pages = html.split(/<div class="page(?: sld-page)?"[ >]/).slice(1);
  const idOf = (p: string) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
  const page = pages.find(p => idOf(p) === id);
  if (!page) throw new Error(`sheet ${id} not found in planset`);
  return page;
};

/** every module element (rect OR polygon) tag carrying a canonical mi- id */
const moduleTags = (page: string): string[] =>
  page.match(/<(?:rect|polygon)\b[^>]*\bdata-object-id="mi-[^"]+"[^>]*\/>/g) ?? [];
const moduleIds = (page: string): string[] =>
  moduleTags(page).map(t => (t.match(/data-object-id="(mi-[^"]+)"/) ?? [])[1]).filter(Boolean) as string[];
const attr = (tag: string, name: string): string | null =>
  (tag.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? null;

const { html, snap } = generate();
const pv1 = pageOf(html, 'PV-1');
const pv1b = pageOf(html, 'PV-1B');
const manifests = parsePlacementManifests(html);
const pv1Manifest = manifests.find(m => m.sheetId === 'PV-1');
const pv1bManifest = manifests.find(m => m.sheetId === 'PV-1B');
const CANON_MODULE_COUNT = snap.geometry.moduleInstances.length; // 31

// established string/branch palette (arrayPages.ts stringColors[0..2] = B1/B2/B3)
const BRANCH_COLORS = ['#1b3f74', '#cc0000', '#cc6600'];
const WHITE = new Set(['#fff', '#ffffff', '#fdfdfd', 'white', 'none', '']);

describe('PV-1B module layer — canonical polygons (not local rects)', () => {
  it('PV-1B renders exactly 31 module polygons, all as <polygon> (canonical projection, no legacy rects)', () => {
    const tags = moduleTags(pv1b);
    expect(tags.length).toBe(CANON_MODULE_COUNT);
    expect(tags.length).toBe(31);
    // every drawn module is a projected <polygon> — the legacy <rect> path is gone
    for (const t of tags) expect(t.startsWith('<polygon')).toBe(true);
    expect(moduleTags(pv1b).filter(t => t.startsWith('<rect')).length).toBe(0);
  });

  it('PV-1 and PV-1B draw the SAME canonical module-ID set (no omission/duplication)', () => {
    const a = moduleIds(pv1), b = moduleIds(pv1b);
    expect(new Set(a).size).toBe(CANON_MODULE_COUNT); // no dup on PV-1
    expect(new Set(b).size).toBe(CANON_MODULE_COUNT); // no dup on PV-1B
    expect([...new Set(b)].sort()).toEqual([...new Set(a)].sort());
    // and both equal the canonical instance-id universe
    const canonIds = snap.geometry.moduleInstances.map(m => m.instanceId).sort();
    expect([...new Set(b)].sort()).toEqual(canonIds);
  });
});

describe('PV-1B module layer — per-sheet canonical-projection parity (V31) + coverage (V29/V30)', () => {
  it('both sheets emit a placement manifest carrying every module', () => {
    expect(pv1Manifest, 'PV-1 manifest').toBeTruthy();
    expect(pv1bManifest, 'PV-1B manifest').toBeTruthy();
    const modCount = (m: typeof pv1bManifest) => m!.entries.filter(e => e.kind === 'module').length;
    expect(modCount(pv1Manifest)).toBe(CANON_MODULE_COUNT);
    expect(modCount(pv1bManifest)).toBe(CANON_MODULE_COUNT);
  });

  it('PV-1B modules == viewport∘DT-SITE(canonical drawnPolygon) within 0.5 sheet units (each sheet its OWN viewport)', () => {
    // the invariant is per-sheet: each sheet projects the SAME canonical coords
    // through its OWN declared viewport. checkRenderParity re-projects against the
    // manifest's viewport, so this holds even though PV-1 and PV-1B fit differently.
    const v1 = checkRenderParity(snap, pv1Manifest!, { kinds: ['module'], tolSheet: 0.5 });
    const v1b = checkRenderParity(snap, pv1bManifest!, { kinds: ['module'], tolSheet: 0.5 });
    expect(v1, JSON.stringify(v1.slice(0, 3))).toEqual([]);
    expect(v1b, JSON.stringify(v1b.slice(0, 3))).toEqual([]);
  });

  it('every PV-1B module manifest entry consumed the canonical coordinate (no re-derivation)', () => {
    // requireCoverage over modules: every canonical module appears on PV-1B
    const v = checkRenderParity(snap, pv1bManifest!, { kinds: ['module'], requireCoverage: true, tolSheet: 0.5 });
    expect(v, JSON.stringify(v.slice(0, 3))).toEqual([]);
  });

  it('V29: every rendered mi- id on PV-1B resolves to a canonical snapshot object', () => {
    const ids = scanRenderedObjectIds(pv1b).filter(id => /^mi-/.test(id));
    expect(ids.length).toBe(CANON_MODULE_COUNT);
    expect(checkRenderedIdCoverage(snap, ids).ok).toBe(true);
  });

  it('perturbing a PV-1B drawn module trips V31 (parity is genuinely enforced on the circuit sheet)', () => {
    const m = clone(pv1bManifest!);
    const mod = m.entries.find(e => e.kind === 'module')!;
    mod.sheetXY = { x: mod.sheetXY.x + 4, y: mod.sheetXY.y };
    const v = checkRenderParity(snap, m, { kinds: ['module'], tolSheet: 0.5 });
    expect(v.some(x => x.code === 'RENDER-COORD-PARITY-EXCEEDED' && x.objectId === mod.objectId)).toBe(true);
  });
});

describe('PV-1B module layer — branch membership + visible styling', () => {
  it('branch plan covers every module exactly once with counts 11/10/10', () => {
    const counts = snap.electrical.branches.map(b => b.moduleCount);
    expect(counts).toEqual([11, 10, 10]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(CANON_MODULE_COUNT);
  });

  it('PV-1B module outlines are branch-colored with the established B1/B2/B3 palette, multiset {11,10,10}', () => {
    const strokeByColor = new Map<string, number>();
    for (const t of moduleTags(pv1b)) {
      const s = (attr(t, 'stroke') ?? '').toLowerCase();
      strokeByColor.set(s, (strokeByColor.get(s) ?? 0) + 1);
    }
    // exactly the three branch colors, nothing else
    expect([...strokeByColor.keys()].sort()).toEqual([...BRANCH_COLORS].sort());
    expect([...strokeByColor.values()].sort((a, b) => a - b)).toEqual([10, 10, 11]);
  });

  it('every PV-1B module has VISIBLE styling — stroke ≠ none/white, sane light fill-opacity (no white-on-white)', () => {
    const tags = moduleTags(pv1b);
    expect(tags.length).toBe(31);
    for (const t of tags) {
      const stroke = (attr(t, 'stroke') ?? '').toLowerCase();
      expect(WHITE.has(stroke)).toBe(false);                 // border visible on white roof
      expect(BRANCH_COLORS).toContain(stroke);
      const fillOp = Number(attr(t, 'fill-opacity'));
      expect(Number.isFinite(fillOp)).toBe(true);
      expect(fillOp).toBeGreaterThan(0.03);                  // fill actually visible
      expect(fillOp).toBeLessThanOrEqual(0.5);               // light — borders stay crisp
      // fill is the branch color (a real color map), never white-on-white
      expect(WHITE.has((attr(t, 'fill') ?? '').toLowerCase())).toBe(false);
    }
  });

  it('branch wires + IQ8 micro symbols OVERLAY the module layer (present in addition to the 31 modules)', () => {
    // 31 micro device boxes (one under each module) — the electronics overlay
    expect((pv1b.match(/fill="#2b2f36"/g) ?? []).length).toBe(31);
    // branch homerun labels B1/B2/B3 present on the circuit sheet
    for (const lbl of ['>B1<', '>B2<', '>B3<']) expect(pv1b.includes(lbl)).toBe(true);
  });
});
