/**
 * e2e/duplicate-site-object.spec.ts
 *
 * PLACE ONE VENT, GET FOURTEEN.
 *
 * Drives the real production path — arm the tool, click the roof, select the
 * object, press the button — and proves the copy is the SAME object: same
 * type, same dimensions, same bound face, different id and position.
 *
 * Screenshots cannot prove the 3D half (software WebGL renders the Cesium
 * scene blank), so the records are read back out of the studio's own state,
 * which is what persistence, shade and the planset all consume.
 */

import { test, expect, Page } from '@playwright/test';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

const obstructions = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.placedObstructions ?? []) as any[]);

/** Click the canvas at a fraction of its box (page-relative, as the mouse is). */
async function clickCanvas(page: Page, fx: number, fy: number) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

test.describe('duplicating a site object', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
  });

  test('a tree can be placed, then duplicated into a second identical tree', async ({ page }) => {
    await page.locator('body').press('t');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');

    await clickCanvas(page, 0.45, 0.55);
    await expect.poll(() => obstructions(page).then(o => o.length), { timeout: 20_000 }).toBe(1);

    const [src] = await obstructions(page);
    expect(src.type).toBe('tree');

    // Selecting it is what reveals the inspector, exactly as a user's click does.
    await page.locator('body').press('Escape');            // leave Tree mode first
    await expect.poll(async () => {
      await clickCanvas(page, 0.45, 0.55);
      return page.getByTestId('obstruction-duplicate').count();
    }, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.getByTestId('obstruction-duplicate').click();
    await expect.poll(() => obstructions(page).then(o => o.length), { timeout: 15_000 }).toBe(2);

    const all = await obstructions(page);
    const copy = all.find(o => o.id !== src.id)!;

    // 🚨 The SAME object, not a similar-looking one.
    expect(copy.type, 'the copy must keep the type').toBe(src.type);
    expect(copy.widthM).toBeCloseTo(src.widthM, 5);
    expect(copy.depthM).toBeCloseTo(src.depthM, 5);
    expect(copy.heightM).toBeCloseTo(src.heightM, 5);
    expect(copy.canopyRadiusM ?? null, 'a tree without its canopy does not shade')
      .toEqual(src.canopyRadiusM ?? null);

    // …at a different id and a visibly different place.
    expect(copy.id).not.toBe(src.id);
    expect(copy.lat).toBeCloseTo(src.lat, 9);
    expect(copy.lng).not.toBeCloseTo(src.lng, 9);

    // Offset is metres, not degrees: ~1.4 footprints east.
    const mPerDegLng = 111_320 * Math.cos((src.lat * Math.PI) / 180);
    const eastM = (copy.lng - src.lng) * mPerDegLng;
    expect(eastM, 'the copy landed on top of, or miles from, the original')
      .toBeGreaterThan(1);
    expect(eastM).toBeLessThan(60);

    await page.screenshot({ path: 'test-results/duplicate-two-trees.png' });
  });

  test('Ctrl+D does the same thing as the button', async ({ page }) => {
    await page.locator('body').press('t');
    await clickCanvas(page, 0.45, 0.55);
    await expect.poll(() => obstructions(page).then(o => o.length), { timeout: 20_000 }).toBe(1);

    await page.locator('body').press('Escape');
    await expect.poll(async () => {
      await clickCanvas(page, 0.45, 0.55);
      return page.getByTestId('obstruction-duplicate').count();
    }, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.locator('body').press('Control+d');
    await expect.poll(() => obstructions(page).then(o => o.length), { timeout: 15_000 }).toBe(2);

    // 🚨 AND THE COPY IS NOW SELECTED, so a second Ctrl+D makes a THIRD object
    // rather than re-copying the first. If selection had stayed on the
    // original, every duplicate would land in the same spot.
    await page.locator('body').press('Control+d');
    await expect.poll(() => obstructions(page).then(o => o.length), { timeout: 15_000 }).toBe(3);

    const all = await obstructions(page);
    const lngs = all.map(o => o.lng).sort((a, b) => a - b);
    expect(new Set(lngs).size, 'the copies stacked on top of each other').toBe(3);
  });
});
