/**
 * e2e/mode-banner-acceptance.spec.ts
 *
 * RAY MUST BE ABLE TO SEE WHICH TOOL HE IS IN.
 *
 * This drives the REAL production path — the same tool buttons a user clicks —
 * and asserts the banner that names the armed tool, then proves both exits
 * (the ✕ and the Escape key) actually disarm it.
 *
 * 🚨 UNLIKE THE GEOMETRY SPECS, THESE SCREENSHOTS ARE REAL EVIDENCE. Software
 * WebGL does not rasterise the Cesium scene, so e2e/object-geometry-acceptance
 * captures blank canvases and says so in its own header. The mode banner is
 * DOM, not WebGL, so it paints normally and the PNGs below show what a user
 * would actually see.
 */

import { test, expect, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SHOTS = path.join('test-results', 'mode-banner');

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any };

async function shot(page: Page, name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[SHOT] ${file}`);
}

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect
    .poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 })
    .toBe(true);
}

/** Open a tool group in the left spine, then click a tool inside its flyout. */
async function armTool(page: Page, groupId: string, mode: string) {
  await page.getByTestId(`toolgroup-${groupId}`).click();
  const tool = page.getByTestId(`tool-${mode}`);
  await expect(tool).toBeVisible({ timeout: 15_000 });
  await tool.click();
}

test.describe('the armed tool announces itself', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await expect(page.getByTestId('toolgroup-tools')).toBeVisible({ timeout: 120_000 });
  });

  test('no tool armed means no banner', async ({ page }) => {
    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0);
    await shot(page, '00-idle-no-banner');
  });

  test('arming Tree names it in words, with an exit that says ESC', async ({ page }) => {
    await armTool(page, 'tools', 'tree');

    const banner = page.getByTestId('active-mode-banner');
    await expect(banner).toBeVisible({ timeout: 15_000 });
    // The NAME, not a glyph. That is the whole point.
    await expect(banner).toContainText('Tree');
    await expect(banner).toHaveAttribute('data-mode', 'tree');
    // The keyboard route is printed on the control, not left as folklore.
    await expect(page.getByTestId('active-mode-exit')).toContainText('ESC');

    await shot(page, '01-tree-armed');
  });

  test('the banner follows the tool — arming Obstruction renames it', async ({ page }) => {
    await armTool(page, 'tools', 'tree');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');

    await armTool(page, 'tools', 'obstruction');
    const banner = page.getByTestId('active-mode-banner');
    await expect(banner).toHaveAttribute('data-mode', 'obstruction');
    await expect(banner).toContainText('Obstruction');

    await shot(page, '02-obstruction-armed');
  });

  test('a Building tool is named too, not just the Tools group', async ({ page }) => {
    await armTool(page, 'building', 'roof_gable');
    const banner = page.getByTestId('active-mode-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Gable');
    await shot(page, '03-gable-armed');
  });

  test('the ✕ disarms the tool', async ({ page }) => {
    await armTool(page, 'tools', 'tree');
    await expect(page.getByTestId('active-mode-banner')).toBeVisible();

    await page.getByTestId('active-mode-exit').click();

    // Gone means disarmed: the banner only renders while a tool is armed.
    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0, { timeout: 10_000 });
    await shot(page, '04-after-click-exit');
  });

  /**
   * 🚨 THE BANNER MUST NOT BURY A BUTTON.
   *
   * First cut sat at top:10 and landed exactly on the map-source toolbar,
   * making 'Street View' and 'LiDAR' unclickable for as long as ANY tool was
   * armed. That is the same class of defect lib/3d/overlayLayers.ts was
   * written after — eighteen controls a click could not reach — and an
   * announcement that costs you two buttons is not a win.
   *
   * This asserts the real thing (hit-testing via elementFromPoint), not a
   * coordinate, so it keeps holding when the layout moves.
   */
  test('it covers no interactive control, in every mode it can be armed in', async ({ page }) => {
    for (const [group, mode] of [['tools', 'tree'], ['tools', 'obstruction'], ['tools', 'measure'],
                                 ['building', 'roof_gable'], ['place', 'roof']] as const) {
      await armTool(page, group, mode);
      await expect(page.getByTestId('active-mode-banner')).toBeVisible();

      const covered = await page.evaluate(() => {
        const banner = document.querySelector('[data-testid="active-mode-banner"]') as HTMLElement;
        const b = banner.getBoundingClientRect();
        const out: Array<{ text: string; testid: string | null }> = [];
        for (const el of Array.from(document.querySelectorAll('button,[role="button"],input,select'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (banner.contains(el)) continue;
          const overlaps = !(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom);
          if (!overlaps) continue;
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (el !== top && !el.contains(top)) {
            out.push({ text: (el.textContent || '').trim().slice(0, 30), testid: el.getAttribute('data-testid') });
          }
        }
        return out;
      });

      expect(covered, `the ${mode} banner buried: ${JSON.stringify(covered)}`).toEqual([]);
    }
    await shot(page, '06-covers-nothing');
  });

  /**
   * The shortcut and the button must be the SAME operation. Pressing T has to
   * set the obstruction PRESET to tree, not merely the mode — otherwise the
   * next click plants a vent that claims to be a tree.
   */
  test('a single keypress arms the tool, exactly as the button does', async ({ page }) => {
    await page.locator('body').press('t');
    const banner = page.getByTestId('active-mode-banner');
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveAttribute('data-mode', 'tree');
    // The preset came with it: the Tree chip is the selected one.
    await expect(page.getByTestId('obstruction-preset-tree')).toBeVisible();
    await shot(page, '07-armed-by-keypress');

    await page.locator('body').press('o');
    await expect(banner).toHaveAttribute('data-mode', 'obstruction');

    await page.locator('body').press('m');
    await expect(banner).toHaveAttribute('data-mode', 'measure');

    await page.locator('body').press('g');
    await expect(banner).toHaveAttribute('data-mode', 'roof_gable');
  });

  test('typing in a field never arms a tool', async ({ page }) => {
    await page.locator('body').press('t');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');

    // The rise:run box is a text input. Typing "6:12" contains no tool letter,
    // but the width box below accepts digits and the search box accepts words
    // full of them — "t" in an address must not plant a tree.
    const search = page.locator('input[type="text"]').first();
    await search.click();
    await search.type('tomato street');
    // Still tree: no tool changed underneath the typing.
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');
  });

  test('ESCAPE disarms the tool — the fix the banner advertises', async ({ page }) => {
    await armTool(page, 'tools', 'tree');
    await expect(page.getByTestId('active-mode-banner')).toBeVisible();

    // 🚨 THE REGRESSION THIS EXISTS FOR. Escape used to clear every selection
    // and leave the user still ARMED, so the next click on the roof planted a
    // second tree. Pressed on the body, not on an input: the handler
    // deliberately ignores Escape while the user is typing.
    await page.locator('body').press('Escape');

    await expect(page.getByTestId('active-mode-banner')).toHaveCount(0, { timeout: 10_000 });
    await shot(page, '05-after-escape');
  });
});
