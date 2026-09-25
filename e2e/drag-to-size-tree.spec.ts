/**
 * e2e/drag-to-size-tree.spec.ts
 *
 * DRAG THE TREE TO THE SIZE OF THE TREE.
 *
 * Aurora's flow is one gesture — "click, hold and drag until the circle is
 * approximately the same size as the tree in the satellite imagery"
 * (30YIHPdAI0g @00:04). SolarPro made the installer type width, depth and
 * height first, then click: guess the number before looking at the thing.
 *
 * What this proves on the real path:
 *   - a short press still places at the armed size (the old behaviour survives)
 *   - a long drag places a BIGGER object, sized by the drag
 *   - one gesture makes exactly ONE object
 *   - the size is clamped to the preset's own range, not to invented limits
 */

import { test, expect, Page } from '@playwright/test';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

const objects = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.placedObstructions ?? []) as any[]);

async function canvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('no canvas');
  return box;
}

test.describe('sizing a site object by dragging it out', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
    await page.locator('body').press('t');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');
  });

  test('a short press still places at the armed size', async ({ page }) => {
    const b = await canvasBox(page);
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.55);

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);
    // The Tree preset's own width. Unchanged behaviour — a click is a click.
    expect(o.type).toBe('tree');
    expect(o.widthM).toBeCloseTo(6, 1);
  });

  test('🚨 a drag places a BIGGER tree, sized by the gesture', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.4, cy = b.y + b.height * 0.55;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Well past the 6 px threshold, in steps so MOUSE_MOVE actually fires.
    for (const f of [0.25, 0.5, 0.75, 1]) {
      await page.mouse.move(cx + 120 * f, cy + 120 * f, { steps: 4 });
    }
    await page.mouse.up();

    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);
    const [o] = await objects(page);

    expect(o.type).toBe('tree');
    // Bigger than the preset default, which is the whole point.
    expect(o.widthM, `dragged tree came out ${o.widthM} m — the drag did not size it`)
      .toBeGreaterThan(6.5);
    // Round object: the two footprint axes track each other.
    expect(o.depthM).toBeCloseTo(o.widthM, 3);
    // And the canopy that shades follows the footprint, not a stale default.
    expect(o.canopyRadiusM).toBeCloseTo(o.widthM / 2, 2);

    // Within the Tree preset's declared range — no invented limits.
    expect(o.widthM).toBeLessThanOrEqual(30);
    expect(o.widthM).toBeGreaterThanOrEqual(1);

    console.log('[DRAGGED]', JSON.stringify({ w: o.widthM, d: o.depthM, r: o.canopyRadiusM }));
  });

  test('one gesture makes exactly one object', async ({ page }) => {
    const b = await canvasBox(page);
    const cx = b.x + b.width * 0.45, cy = b.y + b.height * 0.5;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 90, cy + 90, { steps: 8 });
    await page.mouse.up();

    // 🚨 THE TRAILING CLICK. If the suppression is wrong, mouse-up commits and
    // then a synthesised LEFT_CLICK commits AGAIN, and the installer gets two
    // trees for one gesture — which looks like a double-click habit, not a bug.
    await page.waitForTimeout(1200);
    expect((await objects(page)).length, 'the gesture produced more than one object').toBe(1);
  });

  test('dragging does not disturb the panel-array grab registration', async ({ page }) => {
    // The size drag lives inside the SAME LEFT_DOWN/MOUSE_MOVE/LEFT_UP trio as
    // the array grab. Proving the array tools still respond after a size drag
    // is the live counterpart of the source guard on registration counts.
    const b = await canvasBox(page);
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.4 + 100, b.y + b.height * 0.55 + 100, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => objects(page).then(o => o.length), { timeout: 20_000 }).toBe(1);

    // Back to select; the engine must still accept an ordinary selection click.
    await page.locator('body').press('Escape');
    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0);
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.55);
    // The object inspector appearing proves LEFT_CLICK selection still works.
    await expect(page.getByTestId('obstruction-duplicate')).toBeVisible({ timeout: 15_000 });
  });
});
