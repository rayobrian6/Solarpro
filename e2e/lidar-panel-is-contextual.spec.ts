/**
 * e2e/lidar-panel-is-contextual.spec.ts
 *
 * THE LIDAR PANEL LEFT THE SCREEN — AND TOOK NOTHING UNREACHABLE WITH IT.
 *
 * The panel rendered its Point-cloud/Mesh selector, three offset steppers and
 * Lift/Flatten ALWAYS, including with no dataset loaded: five controls that
 * decide nothing, permanently occupying the left of the canvas on every design.
 *
 * 🚨 THE RISK IS NOT THE HIDING, IT IS THE STRANDING. `handleLiDARLoad` has
 * exactly ONE call site — the "Load .las File" button inside this panel — so
 * gating it wrongly repeats the `setShowBuilding3D` defect recorded in the
 * header of lib/3d/overlayLayers.ts, where the only entry point to a whole
 * feature became unreachable and nothing noticed. This spec proves the loader
 * is still reachable through an always-on control.
 */

import { test, expect, Page } from '@playwright/test';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

const panel = (p: Page) => p.getByTestId('lidar-properties-panel');

test.describe('the LiDAR panel is contextual, and its loader is not stranded', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('map-source-tabs')).toBeVisible({ timeout: 120_000 });
  });

  test('it is NOT on screen at rest, with no dataset and no LiDAR tab', async ({ page }) => {
    await expect(panel(page)).toHaveCount(0);
  });

  test('🚨 the LiDAR tab is always on, so the loader is always reachable', async ({ page }) => {
    const tab = page.getByTestId('map-source-tab-lidar');
    // Always-on and hit-testable — not merely present in the DOM. The whole
    // failure mode this guards against is a control that is there and cannot
    // be pressed.
    await expect(tab).toBeVisible();
    const reachable = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="map-source-tab-lidar"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === top || el.contains(top);
    });
    expect(reachable, 'the LiDAR tab is covered — the loader is stranded').toBe(true);

    await tab.click();
    await expect(panel(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Load .las File')).toBeVisible();
    await page.screenshot({ path: 'test-results/lidar-contextual-open.png' });
  });

  test('leaving the tab puts it away again', async ({ page }) => {
    await page.getByTestId('map-source-tab-lidar').click();
    await expect(panel(page)).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('map-source-tab-streetView').click();
    // No dataset was loaded, so there is nothing to keep editing.
    await expect(panel(page)).toHaveCount(0, { timeout: 10_000 });
  });
});
