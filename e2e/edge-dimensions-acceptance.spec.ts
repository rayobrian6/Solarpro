/**
 * e2e/edge-dimensions-acceptance.spec.ts
 *
 * THE EDGE LENGTHS ARE REALLY IN THE SCENE, AND THEY REALLY GO AWAY.
 *
 * 🚨 SCREENSHOTS CANNOT PROVE THIS ONE. Software WebGL does not rasterise the
 * Cesium scene, so a PNG here is blank — that is the renderer, not the
 * product (see e2e/object-geometry-acceptance.spec.ts, which documents the
 * same thing). So this reads the labels back out of Cesium's entity
 * collection by the `[DIM] ` name tag the renderer stamps on them, which is
 * the same technique the geometry acceptance spec uses.
 *
 * What it proves:
 *   - selecting a face draws one dimension label per edge
 *   - the TEXT is the measured length, in feet, not a placeholder
 *   - deselecting removes every one of them
 *   - selecting a different face swaps them rather than accumulating
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

/**
 * Setup, not the thing under test: give the design a site and a real
 * multi-section house so there are faces with edges to dimension. Same
 * fixture the object-geometry acceptance spec uses.
 */
async function seedHouse(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''), { timeout: 45_000 })
    .not.toBe('');

  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }
  await page.evaluate(ps => (window as E2EWin).__solarE2E.seedDesign({ roofPlanes: ps }), planes as any);

  // 🚨 The design state holding the faces is not the same as the ENGINE
  // holding them, and dimensions are drawn by the engine.
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0),
    { message: 'the 3D engine never received the faces', timeout: 60_000 })
    .toBe(planes.length);
  return planes.length;
}

/** Every dimension label currently in the scene, as {tag, text}. */
async function dimensions(page: Page) {
  return page.evaluate(() => {
    const viewer = (window as E2EWin).__solarViewerE2E;
    if (!viewer) return [];
    const out: Array<{ name: string; text: string | null }> = [];
    for (const e of viewer.entities.values) {
      const name = (e as any).name;
      if (typeof name !== 'string' || !name.startsWith('[DIM] ')) continue;
      const lbl = (e as any).label;
      if (!lbl) continue;   // the polyline half of the bundle
      const t = lbl.text?.getValue ? lbl.text.getValue() : lbl.text;
      out.push({ name, text: typeof t === 'string' ? t : null });
    }
    return out;
  });
}

/** The ids of roof faces currently in the engine. */
async function faceIds(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as E2EWin).__solarE2E?.roofPlanes ?? []).map((p: any) => p.id));
}

async function selectFace(page: Page, id: string | null) {
  await page.evaluate(fid => (window as E2EWin).__solarEngineE2E.selectRoofFace(fid), id);
}

test.describe('edge dimensions follow the selected face', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await seedHouse(page);
  });

  test('nothing is selected, so nothing is dimensioned', async ({ page }) => {
    expect(await dimensions(page)).toEqual([]);
  });

  test('selecting a face labels every edge, in feet', async ({ page }) => {
    const ids = await faceIds(page);
    test.skip(ids.length === 0, 'the quick-design fixture seeded no roof faces');

    await selectFace(page, ids[0]);
    await expect.poll(async () => (await dimensions(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(2);   // a face has at least three edges

    const dims = await dimensions(page);
    for (const d of dims) {
      expect(d.name, 'every label must be tagged to its wall').toMatch(/^\[DIM\] .+#\d+$/);
      // A real measurement, not a placeholder or an em dash.
      expect(d.text, `label "${d.text}" is not a length in feet`).toMatch(/^\d[\d.,]*\s*(ft|')/);
    }
    console.log('[DIMENSIONS]', JSON.stringify(dims.map(d => d.text)));
  });

  test('every label belongs to the SELECTED face, not another one', async ({ page }) => {
    const ids = await faceIds(page);
    test.skip(ids.length < 2, 'need two faces to prove scoping');

    await selectFace(page, ids[0]);
    await expect.poll(async () => (await dimensions(page)).length, { timeout: 15_000 }).toBeGreaterThan(2);
    for (const d of await dimensions(page)) {
      expect(d.name.startsWith(`[DIM] ${ids[0]}#`),
        `${d.name} is not an edge of the selected face`).toBe(true);
    }
  });

  test('selecting another face SWAPS the labels rather than accumulating', async ({ page }) => {
    const ids = await faceIds(page);
    test.skip(ids.length < 2, 'need two faces');

    await selectFace(page, ids[0]);
    await expect.poll(async () => (await dimensions(page)).length, { timeout: 15_000 }).toBeGreaterThan(2);
    const first = (await dimensions(page)).length;

    await selectFace(page, ids[1]);
    await expect.poll(async () => {
      const d = await dimensions(page);
      return d.length > 0 && d.every(x => x.name.startsWith(`[DIM] ${ids[1]}#`));
    }, { timeout: 15_000 }).toBe(true);

    // 🚨 The real risk is leaking: labels that are drawn again without the
    // previous set being removed look correct and multiply every reselect.
    const after = (await dimensions(page)).length;
    expect(after, 'the previous face\'s labels were not torn down')
      .toBeLessThanOrEqual(first * 2);
  });

  test('deselecting removes every label — the canvas declutters itself', async ({ page }) => {
    const ids = await faceIds(page);
    test.skip(ids.length === 0, 'no faces');

    await selectFace(page, ids[0]);
    await expect.poll(async () => (await dimensions(page)).length, { timeout: 15_000 }).toBeGreaterThan(2);

    await selectFace(page, null);
    await expect.poll(async () => (await dimensions(page)).length, { timeout: 15_000 }).toBe(0);
  });
});
