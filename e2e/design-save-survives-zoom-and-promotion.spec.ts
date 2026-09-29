import { expect, test, type Page, type Response } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { seedRoofPlane, runAutoLayout, waitForCesiumCanvas, DEMO_SITE } from './support/seedRoof';

/**
 * e2e/design-save-survives-zoom-and-promotion.spec.ts
 *
 * REAL BROWSER → REAL ROUTES → REAL POSTGRES (PGlite via SOLARPRO_LOCAL_PG=1).
 *
 *   1. design → zoom → save → reload
 *      One wheel notch on the 2D map sets zoom 19.75 (0.75 per notch). The
 *      autosave sent it into INTEGER map_zoom, Postgres refused the cast AFTER
 *      the version claim, and every later save was refused ("saved somewhere
 *      else") until a reload.
 *
 *   2. Quick Design → address → design → promote → same geometry/equipment/state
 *      A Quick Design could not save at all ("saving is disabled"), and
 *      promoting it (choosing Nearmap) hydrated the new project's EMPTY row
 *      over the design on screen.
 *
 * Every layout POST the studio makes is recorded, so a refusal cannot hide
 * behind a later success.
 */

const ARMED = process.env.SOLARPRO_LOCAL_PG === '1';
const DEMO_ADDRESS = 'St Louis, MO';   // city-level: the studio does not re-geocode it (see persistence-join)

type LayoutBody = {
  success?: boolean;
  data?: {
    panels?: Array<{ id: string; wattage?: number }>;
    roofPlanes?: Array<{ id: string }>;
    obstructions?: Array<{ id: string }>;
    mapZoom?: number;
    designElectrical?: Record<string, unknown> | null;
  } | null;
};

async function layoutFromDb(page: Page, id: string): Promise<LayoutBody> {
  const res = await page.request.get(`/api/projects/${id}/layout`);
  expect(res.status()).toBe(200);
  return res.json() as Promise<LayoutBody>;
}

function recordLayoutSaves(page: Page) {
  const saves: Array<{ url: string; status: number }> = [];
  page.on('response', (r: Response) => {
    if (r.request().method() === 'POST' && /\/api\/projects\/[^/]+\/layout/.test(r.url())) {
      saves.push({ url: r.url(), status: r.status() });
    }
  });
  return saves;
}

async function waitForRestore(page: Page) {
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'the studio never mounted', timeout: 60_000 },
  ).toBe(true);
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.activeSiteKey ?? ''),
    { message: 'the studio never resolved which property it is on', timeout: 60_000 },
  ).not.toBe('');
  await page.waitForTimeout(3_000);   // StrictMode's second restore pass (see persistence-join)
}

const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__solarE2E;
  return {
    panels: (s?.panels ?? []).map((p: { id: string; wattage?: number }) => `${p.id}:${p.wattage}`).sort(),
    roofPlanes: (s?.roofPlanes ?? []).map((p: { id: string }) => p.id).sort(),
    obstructions: (s?.placedObstructions ?? []).map((o: { id: string }) => o.id).sort(),
  };
});

const obstruction = (id: string, dLat = 0) => ({
  id, lat: DEMO_SITE.lat + dLat, lng: DEMO_SITE.lng, height: 3, radiusM: 0.5, type: 'vent',
});

test.describe('the design survives a wheel zoom and a Quick Design promotion', () => {
  test.skip(!ARMED, 'SOLARPRO_LOCAL_PG is not set — no database is attached to this server.');

  // Harness-only, opt-in: where the CesiumJS CDN is unreachable (a sandbox
  // with no route to cesium.com), serve the build shipped in node_modules/cesium
  // so the studio can mount. This spec is about persistence, not rendering.
  test.beforeEach(async ({ page }) => {
    if (process.env.E2E_LOCAL_CESIUM !== '1') return;
    const root = join(process.cwd(), 'node_modules', 'cesium', 'Build', 'Cesium');
    await page.route(/^https:\/\/cesium\.com\/downloads\/cesiumjs\/releases\/[^/]+\/Build\/Cesium\//, async (route, req) => {
      const rel = decodeURIComponent(new URL(req.url()).pathname.replace(/^.*\/Build\/Cesium\//, ''));
      const file = join(root, rel);
      if (!file.startsWith(root + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
      await route.fulfill({ path: file });
    });
  });

  test('🚨 design → zoom → save → reload', async ({ page }) => {
    test.slow();
    const created = await page.request.post('/api/projects', {
      data: { name: 'Zoom survives', address: DEMO_ADDRESS, lat: DEMO_SITE.lat, lng: DEMO_SITE.lng, systemType: 'roof', status: 'lead' },
    });
    expect([200, 201]).toContain(created.status());
    const id = (await created.json())?.data?.id as string;
    expect((await page.request.put(`/api/projects/${id}`, { data: { lat: DEMO_SITE.lat, lng: DEMO_SITE.lng, address: DEMO_ADDRESS } })).status()).toBe(200);

    const saves = recordLayoutSaves(page);
    await page.goto(`/design?projectId=${id}`);
    await waitForRestore(page);
    test.skip(!(await waitForCesiumCanvas(page)), 'No WebGL canvas — the placement path cannot run.');

    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), { ...DEMO_SITE, address: DEMO_ADDRESS });
    await seedRoofPlane(page);
    await runAutoLayout(page);
    const designed = await state(page);
    expect(designed.panels.length).toBeGreaterThan(0);
    await expect.poll(async () => (await layoutFromDb(page, id)).data?.panels?.length ?? 0,
      { message: 'the design never reached the database', timeout: 45_000, intervals: [2000] })
      .toBe(designed.panels.length);

    // ── 2D map, one wheel notch → zoom 19.75 ──────────────────────────────
    await page.getByTitle('Toggle 3D Digital Twin').click();
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 30_000 });
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(500);

    // ── two edits after the zoom: each must SAVE (the second is the one the wedge refused) ──
    const before = saves.length;
    await page.evaluate(o => (window as any).__solarE2E.seedDesign({ obstructions: [o] }), obstruction('vent-1'));
    await expect.poll(() => saves.length, { message: 'the first edit after the zoom never autosaved', timeout: 30_000 })
      .toBeGreaterThan(before);
    await page.waitForTimeout(1_000);
    const middle = saves.length;
    await page.evaluate(os => (window as any).__solarE2E.seedDesign({ obstructions: os }),
      [obstruction('vent-1'), obstruction('vent-2', 0.00002)]);
    await expect.poll(() => saves.length, { message: 'the second edit after the zoom never autosaved', timeout: 30_000 })
      .toBeGreaterThan(middle);

    const after = saves.slice(before);
    expect(after.map(s => s.status), 'a save after the wheel zoom was refused or failed').toEqual(after.map(() => 200));

    const stored = await layoutFromDb(page, id);
    expect(stored.data?.obstructions?.map(o => o.id).sort()).toEqual(['vent-1', 'vent-2']);
    expect(Number.isInteger(stored.data?.mapZoom)).toBe(true);

    // ── reload: the same design comes back ────────────────────────────────
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRestore(page);
    const back = await state(page);
    expect(back.panels).toEqual(designed.panels);
    expect(back.roofPlanes).toEqual(designed.roofPlanes);
    expect(back.obstructions).toEqual(['vent-1', 'vent-2']);
  });

  test('🚨 Quick Design → address → design → promote → the same design, saved and restored', async ({ page }) => {
    test.slow();
    const saves = recordLayoutSaves(page);
    const disabledToasts: string[] = [];
    page.on('console', m => { if (/saving is disabled/i.test(m.text())) disabledToasts.push(m.text()); });

    await page.goto('/design?e2eQuickDesign=1');
    await waitForRestore(page);
    test.skip(!(await waitForCesiumCanvas(page)), 'No WebGL canvas — the placement path cannot run.');

    // address → design
    await page.evaluate(a => (window as any).__solarE2E.pickHouse(a.lat, a.lng, a.address), { ...DEMO_SITE, address: DEMO_ADDRESS });
    await seedRoofPlane(page);
    await runAutoLayout(page);
    await page.evaluate(o => (window as any).__solarE2E.seedDesign({ obstructions: [o] }), obstruction('qd-vent'));
    const designed = await state(page);
    expect(designed.panels.length).toBeGreaterThan(0);
    expect(designed.obstructions).toEqual(['qd-vent']);
    await page.waitForTimeout(4_000);   // an autosave tick of the Quick Design
    await expect(page.getByText(/saving is disabled/i)).toHaveCount(0);
    expect(saves.filter(s => /\/api\/projects\/demo-/.test(s.url)), 'a Quick Design POSTed to a route that can only 400').toEqual([]);

    // promote — what choosing Nearmap does
    const createdP = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/projects$/.test(r.url()), { timeout: 60_000 });
    await page.getByTestId('imagery-nearmap').click();
    const createdRes = await createdP;
    expect(createdRes.status(), 'promotion could not create the project').toBeLessThan(300);
    const newId = (await createdRes.json())?.data?.id as string;
    expect(newId).toMatch(/^[0-9a-f-]{36}$/);

    // the design on screen is untouched …
    await page.waitForTimeout(2_000);
    expect(await state(page), 'promotion changed the design on screen').toEqual(designed);

    // … and is saved under the new project
    await expect.poll(async () => (await layoutFromDb(page, newId)).data?.panels?.length ?? 0,
      { message: 'the promoted design never reached the database', timeout: 45_000, intervals: [2000] })
      .toBe(designed.panels.length);
    const stored = await layoutFromDb(page, newId);
    expect(stored.data?.roofPlanes?.map(p => p.id).sort()).toEqual(designed.roofPlanes);
    expect(stored.data?.obstructions?.map(o => o.id).sort()).toEqual(designed.obstructions);
    expect(stored.data?.designElectrical, 'the electrical design did not travel with it').toBeTruthy();
    expect(saves.filter(s => s.url.includes(newId)).map(s => s.status)).not.toContain(409);

    // reopen the promoted project from scratch: the same geometry, equipment and state
    await page.goto(`/design?projectId=${newId}`);
    await waitForRestore(page);
    expect(await state(page), 'the promoted project did not reopen with the same design').toEqual(designed);
    expect(disabledToasts).toEqual([]);
  });
});
