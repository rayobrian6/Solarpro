import { expect } from '@playwright/test';
import { buildRoofPlane3D, latLngToECEF } from '../../lib/roofPlane3D';
import type { RoofPlane } from '../../types';

/**
 * e2e/support/seedRoof.ts
 *
 * A REAL ROOF, ON EVERY MACHINE.
 *
 * The quick-launch demo project carries no roof geometry, and acquiring one
 * needs Google Solar, which needs a key. Specs that depended on that key did not
 * fail without it — they went quiet: two skipped with "No panels placed", and
 * the one guarding Ray's "panels disappear into the roof" wrapped its whole body
 * in `if (planes > 0 && panels > 0)` and reported a pass over an empty array.
 *
 * So the roof is seeded, by the same `buildRoofPlane3D` the 3D trace tool calls.
 * Everything downstream — Auto Layout, the 3D routing chokepoint, the control
 * layer, the placement engine — is the real path.
 */

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;

/** app/design/page.tsx quick-launch project. */
export const DEMO_SITE = { lat: 38.6657, lng: -90.2266 };
/** DesignStudio's initial rackingId — the mount the seeded design will use. */
export const DEFAULT_RACKING = 'ironridge-xr100';

const TILT_DEG = 25;
const WIDTH_M = 14;   // along the eave
const DEPTH_M = 9;    // up the slope
const EAVE_H = 160;   // ellipsoidal

/** A real pitched roof face at the demo address — not a hand-written stand-in. */
export function buildSeedPlane(): RoofPlane {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO_SITE.lat * DEG);
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(TILT_DEG * DEG);
  return buildRoofPlane3D([
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng - dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat - dLat, DEMO_SITE.lng + dLng, EAVE_H),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng + dLng, ridgeH),
    latLngToECEF(DEMO_SITE.lat + dLat, DEMO_SITE.lng - dLng, ridgeH),
  ]);
}

/**
 * Put that roof on the active property and wait until the 3D ENGINE has it.
 *
 * The engine count is not the same as the studio count, and pressing a placement
 * button in the gap between them places nothing at all — a harness artefact that
 * would read exactly like a defect.
 */
export async function seedRoofPlane(page: import('@playwright/test').Page): Promise<RoofPlane> {
  const plane = buildSeedPlane();
  await page.evaluate(p => (window as any).__solarE2E.seedDesign({ roofPlanes: [p] }), plane as any);

  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.roofPlanes.length ?? 0),
    { message: 'seedDesign did not put the roof plane on the active property', timeout: 10_000 },
  ).toBe(1);

  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.engineRoofPlaneCount ?? 0),
    { message: 'the 3D engine never received the seeded roof plane', timeout: 45_000 },
  ).toBeGreaterThan(0);

  return plane;
}

/** Press the real Auto Layout button and wait for panels to land. */
export async function runAutoLayout(page: import('@playwright/test').Page): Promise<void> {
  const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
  await expect(autoLayout, 'the Auto Layout button should exist on /design').toBeVisible();
  await autoLayout.click();
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.panels.length ?? 0),
    {
      message: 'Auto Layout placed no panels on a seeded roof plane — the guard ' +
               'cannot run, and must not report a pass',
      timeout: 30_000,
    },
  ).toBeGreaterThan(0);
}

/**
 * Wait for the Cesium canvas, and report honestly whether it arrived.
 *
 * 🚨 EVERY SPEC HERE USED `canvas.isVisible({ timeout: 45_000 })`, WHICH DOES
 * NOT WAIT. `Locator.isVisible()` is an INSTANTANEOUS predicate — the options
 * bag is accepted and ignored. So the check asked "is the canvas up right now?",
 * got `false` because Cesium had not mounted yet, and every canvas-gated test
 * skipped with a message that read like a machine limitation:
 *
 *     test.skip(!hasCanvas, 'No WebGL canvas — skipping on-roof panel check.')
 *
 * Five of the seven Design Studio guards skipped that way against a production
 * build, including the one guarding Ray's "panels disappear into the roof". It
 * looked like a careful degradation and was a timing bug — the same shape as a
 * guard wrapped in `if (panels.length > 0)`, and just as quiet.
 *
 * `waitFor` actually waits.
 */
export async function waitForCesiumCanvas(
  page: import('@playwright/test').Page,
  timeout = 45_000,
): Promise<boolean> {
  try {
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}
