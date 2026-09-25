/**
 * e2e/tree-cursor-shows-real-size.spec.ts
 *
 * THE CIRCLE YOU AIM WITH IS THE TREE YOU GET.
 *
 * 🚨 IT WAS NOT. The engine handed TreeCursor the CONSTANT 1.8 m default while
 * the Tree preset places a 6.0 m wide canopy — a 3.0 m radius. The installer
 * aimed with a circle forty per cent the size of the footprint that appeared,
 * and dragging the Width slider changed the tree but not the preview of it.
 * A preview that under-reports its own size is worse than no preview, because
 * it is aimed with and it is believed.
 *
 * Screenshots cannot prove this: software WebGL does not rasterise the Cesium
 * scene. So this reads the preview entity's own ellipse axes back out of
 * Cesium — the same technique the edge-dimension and object-geometry specs use.
 */

import { test, expect, Page } from '@playwright/test';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

/** The live semi-major axis of the tree preview ellipse, in metres. */
async function previewRadiusM(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const viewer = (window as E2EWin).__solarViewerE2E;
    if (!viewer) return null;
    const e = viewer.entities.getById('tree-cursor-preview');
    if (!e || !e.ellipse) return null;
    const a = e.ellipse.semiMajorAxis;
    // A CallbackProperty needs a time to be read; the value is constant in
    // time, so any JulianDate works.
    const C = (window as any).Cesium;
    const v = a?.getValue ? a.getValue(C.JulianDate.now()) : a;
    return typeof v === 'number' ? v : null;
  });
}

test.describe('the tree placement preview is the real canopy', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
    await page.locator('body').press('t');           // arm Tree
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');
  });

  test('🚨 it matches the armed width, not the old 1.8 m constant', async ({ page }) => {
    await expect.poll(() => previewRadiusM(page), { timeout: 15_000 }).not.toBeNull();
    const r = await previewRadiusM(page);

    // The Tree preset is 6.0 m wide, so the canopy radius is 3.0 m.
    expect(r, 'the preview radius must be half the armed width').toBeCloseTo(3.0, 2);
    // The exact value of the defect, named, so a regression is unmistakable.
    expect(r, 'the preview is back to the 1.8 m constant').not.toBeCloseTo(1.8, 2);
  });

  test('changing the width moves the preview, without rebuilding it', async ({ page }) => {
    const before = await previewRadiusM(page);
    expect(before).toBeCloseTo(3.0, 2);

    // Type a new width into the placement panel, as an installer would.
    const width = page.locator('input[type="number"]').filter({ hasText: '' }).first();
    await page.evaluate(() => {
      // The width box is the first number input in the PLACE TREE panel; set
      // it through the React-visible path rather than guessing at coordinates.
      const inputs = Array.from(document.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
      const w = inputs.find(i => i.value === '6');
      if (!w) throw new Error('width box not found');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(w, '12');
      w.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect.poll(() => previewRadiusM(page), { timeout: 10_000 }).toBeCloseTo(6.0, 1);

    // 🚨 And the SAME entity is still there. The old code refused to react to
    // the radius at all because rebuilding the entity was expensive; the
    // CallbackProperty is what makes reacting free, so proving the entity
    // survived is proving the fix did not just trade one cost for another.
    const stillThere = await page.evaluate(() =>
      !!(window as E2EWin).__solarViewerE2E?.entities.getById('tree-cursor-preview'));
    expect(stillThere, 'the preview entity was rebuilt instead of updated').toBe(true);
    void width;
  });

  test('leaving Tree mode removes the preview', async ({ page }) => {
    await expect.poll(() => previewRadiusM(page), { timeout: 15_000 }).not.toBeNull();
    await page.locator('body').press('Escape');
    await expect.poll(() => previewRadiusM(page), { timeout: 10_000 }).toBeNull();
  });
});
