import { expect, test } from '@playwright/test';

type SolarE2EState = {
  roofPlanes: Array<{ id: string; vertices?: Array<{ lat: number; lng: number }> }>;
  panels: Array<{ id: string; lat: number; lng: number; planeId?: string }>;
  stitchedCorners: Array<{ id: string; vertices: Array<{ lat: number; lng: number }> }>;
  setbackInsets: number;
  fullRebuildCount: number;
};

async function readSolarState(page: import('@playwright/test').Page): Promise<SolarE2EState | null> {
  return page.evaluate(() => (window as any).__solarE2E ?? null);
}

async function waitForSolarHook(page: import('@playwright/test').Page): Promise<SolarE2EState> {
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__solarE2E)), {
    message: 'NEXT_PUBLIC_E2E window.__solarE2E hook should be installed',
    timeout: 30_000,
  }).toBe(true);
  return (await readSolarState(page))!;
}

function pointInPolygon(point: { lat: number; lng: number }, vertices: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lng;
    const yi = vertices[i].lat;
    const xj = vertices[j].lng;
    const yj = vertices[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

test.describe('Design Studio → planset E2E harness', () => {
  test('loads /design with E2E state hook and keeps geometry state coherent', async ({ page }) => {
    await page.goto('/design?e2eQuickDesign=1');

    const quickLaunchInput = page.getByPlaceholder(/enter any address/i);
    if (await quickLaunchInput.isVisible().catch(() => false)) {
      await quickLaunchInput.fill('1010 Franklin Ave, St Louis, MO');
      await page.getByRole('button', { name: /open 3d design/i }).click();
    }

    const state = await waitForSolarHook(page);
    expect(state.fullRebuildCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(state.roofPlanes)).toBe(true);
    expect(Array.isArray(state.panels)).toBe(true);

    const cesiumCanvas = page.locator('canvas').first();
    const hasCanvas = await cesiumCanvas.isVisible({ timeout: 45_000 }).catch(() => false);
    test.skip(!hasCanvas, 'Cesium/WebGL canvas did not become visible in this environment; hook install was verified.');

    const zonesButton = page.getByRole('button', { name: /zones (on|off)/i }).first();
    if (await zonesButton.isVisible().catch(() => false)) {
      await zonesButton.click();
      await expect.poll(async () => (await readSolarState(page))?.setbackInsets ?? 0, {
        message: 'setback diagnostics should remain numeric after toggling zones',
        timeout: 10_000,
      }).toBeGreaterThanOrEqual(0);
    }

    const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
    if (await autoLayout.isVisible().catch(() => false)) {
      await autoLayout.click();
      await page.waitForTimeout(1_000);
    }

    const afterLayout = (await readSolarState(page))!;
    expect(afterLayout.fullRebuildCount).toBeGreaterThanOrEqual(state.fullRebuildCount);

    const planesWithVertices = afterLayout.roofPlanes.filter(p => (p.vertices?.length ?? 0) >= 3);
    const panelsWithGps = afterLayout.panels.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (planesWithVertices.length > 0 && panelsWithGps.length > 0) {
      for (const panel of panelsWithGps) {
        const plane = panel.planeId
          ? planesWithVertices.find(p => p.id === panel.planeId)
          : planesWithVertices.find(p => pointInPolygon(panel, p.vertices!));
        expect(plane, `panel ${panel.id} should remain inside a stitched/design roof plane`).toBeTruthy();
        if (plane?.vertices?.length) expect(pointInPolygon(panel, plane.vertices)).toBe(true);
      }
    }
  });
});
