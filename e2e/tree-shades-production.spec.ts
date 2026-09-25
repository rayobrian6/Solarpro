/**
 * e2e/tree-shades-production.spec.ts
 *
 * DOES THE TREE ACTUALLY SHADE ANYTHING?
 *
 * Tree placement and tree GEOMETRY are both proven (object-geometry-acceptance,
 * tree-cursor-shows-real-size). What was never proven live is the chain that
 * makes a tree matter:
 *
 *     tree record -> buildShadeScene -> profileForPanel
 *                 -> per-panel annualShadeFactor -> system derate -> production
 *
 * 🚨 EVERY LINK OF THAT CHAIN HAS PASSED ITS OWN UNIT TESTS BEFORE WHILE THE
 * WHOLE CHAIN DID NOTHING. Five placement handlers were once dead because they
 * read custom properties nothing ever set, and a completely clear roof once
 * reported 26.6% shade loss. Green parts do not make a working whole, and a
 * shade number nobody can trust is worse than no shade number — it goes into a
 * production estimate, and a customer is quoted from it.
 *
 * So this asserts DIRECTION and LOCALITY against real geometry:
 *   - a clear roof shades nothing
 *   - a tall tree beside the array shades SOME modules, not all of them
 *   - the modules it shades are the ones NEAR it
 *   - removing the tree returns the array to clear
 *
 * It deliberately does not assert an exact percentage. The physics belongs to
 * lib/shadeAnalysis; what is unproven, and what this settles, is whether the
 * tree reaches the physics at all.
 */

import { test, expect, Page } from '@playwright/test';
import { buildSectionRoofPlanes } from '../lib/3d/buildingSection';
import { multiSectionHouse } from '../tests/fixtures/multiSectionHouse';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any; __solarEngineE2E?: any };

const SITE = { lat: 38.70615, lng: -90.04625, address: '3 Melvin Dr, Granite City, IL' };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

async function seedHouseWithPanels(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''), { timeout: 45_000 })
    .not.toBe('');

  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }

  // A small grid of modules on the first face, at its own corner positions, so
  // they sit where the roof actually is rather than at invented coordinates.
  const face = planes[0];
  const panels = await page.evaluate((f: any) => {
    const C = (window as any).Cesium;
    const poly = (f.polygon3D ?? []) as any[];
    const pts = poly.map(v => {
      const c = C.Cartographic.fromCartesian(v);
      return { lat: C.Math.toDegrees(c.latitude), lng: C.Math.toDegrees(c.longitude), h: c.height };
    });
    const out: any[] = [];
    // 🚨 ONE ROW, DELIBERATELY. `computeShadeAnalysis` also models
    // INTER-ROW self-shading: "panels in later rows are shaded by earlier
    // rows", at the studio's row spacing. A first version of this fixture laid
    // out a 4x3 grid with row indices 0-3, and the clear roof came back with
    // nine of twelve modules at a 0.044 shade factor — which looked exactly
    // like a catastrophic product defect and was nothing of the kind: the
    // inter-row model was correctly punishing a fabricated array whose rows had
    // no real spacing. The bug was in the fixture.
    //
    // This spec is about whether a TREE reaches production. Keeping every
    // module in row 0 removes the inter-row term entirely, so the horizon
    // profile — the thing a tree feeds — is the only contributor, and a change
    // in the numbers can only have come from the tree.
    for (let r = 0; r < 4; r++) {
      for (let c2 = 0; c2 < 3; c2++) {
        const u = (r + 0.5) / 4, v = (c2 + 0.5) / 3;
        const top = { lat: pts[0].lat + (pts[1].lat - pts[0].lat) * u, lng: pts[0].lng + (pts[1].lng - pts[0].lng) * u, h: pts[0].h + (pts[1].h - pts[0].h) * u };
        const bot = { lat: pts[3].lat + (pts[2].lat - pts[3].lat) * u, lng: pts[3].lng + (pts[2].lng - pts[3].lng) * u, h: pts[3].h + (pts[2].h - pts[3].h) * u };
        out.push({
          id: `p-${r}-${c2}`,
          lat: top.lat + (bot.lat - top.lat) * v,
          lng: top.lng + (bot.lng - top.lng) * v,
          height: top.h + (bot.h - top.h) * v,
          planeId: f.id, tilt: f.pitch ?? 20, azimuth: f.azimuth ?? 180,
          row: 0, col: r * 3 + c2, wattage: 400,
        });
      }
    }
    return out;
  }, face as any);

  await page.evaluate(d => (window as E2EWin).__solarE2E.seedDesign(d), { roofPlanes: planes, panels } as any);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0), { timeout: 60_000 })
    .toBe(planes.length);
  return { planes, panels };
}

/** Per-panel shade factors after a study, keyed by panel id. 1 = unshaded. */
async function shadeFactors(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    for (const p of ((window as E2EWin).__solarE2E?.panels ?? []) as any[]) {
      if (typeof p.annualShadeFactor === 'number') out[p.id] = p.annualShadeFactor;
    }
    return out;
  });
}

async function runShade(page: Page) {
  await page.evaluate(() => (window as E2EWin).__solarE2E.runShadeAnalysis());
}

test.describe('a tree changes production, or it is decoration', () => {
  test('🚨 the full chain: clear roof -> tall tree -> shaded modules -> clear again', async ({ page }) => {
    await openStudio(page);
    const { panels } = await seedHouseWithPanels(page);
    expect(panels.length).toBe(12);

    // ── 1. CLEAR ROOF ────────────────────────────────────────────────────
    await runShade(page);
    await expect.poll(async () => Object.keys(await shadeFactors(page)).length, { timeout: 30_000 })
      .toBeGreaterThan(0);

    const clear = await shadeFactors(page);
    const clearShaded = Object.values(clear).filter(f => f < 0.97).length;
    console.log('[CLEAR]', JSON.stringify(clear));
    expect(clearShaded,
      `a roof with nothing on it reported ${clearShaded} shaded modules — this is the 26.6%-on-a-clear-roof defect returning`)
      .toBe(0);

    // ── 2. PLANT A TALL TREE RIGHT BESIDE THE ARRAY ──────────────────────
    // South of the array (northern hemisphere), close, and tall enough that a
    // shadow is not a matter of opinion.
    const target = panels[0];
    await page.evaluate((t: any) => {
      const w = window as E2EWin;
      const obs = [...(w.__solarE2E.placedObstructions ?? [])];
      obs.push({
        id: 'tree-under-test',
        lat: t.lat - 0.00009,      // ~10 m south
        lng: t.lng,
        height: t.height - 6,      // trunk base below the roof
        heightM: 18,               // a genuinely tall tree
        widthM: 8, depthM: 8,
        canopyRadiusM: 4,
        radiusM: 4,
        type: 'tree',
      });
      w.__solarE2E.seedDesign({ obstructions: obs });
    }, target);

    await expect.poll(() => page.evaluate(() =>
      ((window as E2EWin).__solarE2E?.placedObstructions ?? []).length), { timeout: 20_000 }).toBe(1);

    await runShade(page);

    // 🚨 DIRECTION. Some module must now be shaded. If nothing changes, the
    // tree is decoration and every downstream production number is a fiction.
    await expect.poll(async () => {
      const f = await shadeFactors(page);
      return Object.values(f).filter(x => x < 0.97).length;
    }, {
      message: 'the tree shaded NOTHING — the tree->shade->production chain is broken',
      timeout: 30_000,
    }).toBeGreaterThan(0);

    const shaded = await shadeFactors(page);
    console.log('[WITH TREE]', JSON.stringify(shaded));

    // 🚨 LOCALITY. A tree shades the modules beside it, not the whole array.
    // "Everything is shaded" is the failure mode of a per-SYSTEM profile being
    // used where a per-PANEL one was promised, and it looks like it works.
    const shadedCount = Object.values(shaded).filter(f => f < 0.97).length;
    expect(shadedCount,
      'every module went dark — that is a system-wide profile, not a per-panel one')
      .toBeLessThan(panels.length);

    // The nearest module must be among the shaded ones.
    expect(shaded[target.id], 'the module right next to the tree is unshaded')
      .toBeLessThan(0.97);

    // ── 3. REMOVE THE TREE ───────────────────────────────────────────────
    await page.evaluate(() => (window as E2EWin).__solarE2E.seedDesign({ obstructions: [] }));
    await expect.poll(() => page.evaluate(() =>
      ((window as E2EWin).__solarE2E?.placedObstructions ?? []).length), { timeout: 20_000 }).toBe(0);

    await runShade(page);
    await expect.poll(async () => {
      const f = await shadeFactors(page);
      return Object.values(f).filter(x => x < 0.97).length;
    }, {
      message: 'the shade did not lift when the tree was removed — the factor is stuck',
      timeout: 30_000,
    }).toBe(0);
  });
});
