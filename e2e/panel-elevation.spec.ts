import { expect, test } from '@playwright/test';
import { buildRoofPlane3D, latLngToECEF } from '../lib/roofPlane3D';
import { moduleStackHeightM } from '../lib/roofMountDatum';
import type { RoofPlane } from '../types';
import { waitForCesiumCanvas, buildGablePlanes, seedPlanes, runAutoLayout } from './support/seedRoof';

/**
 * e2e/panel-elevation.spec.ts
 *
 * DO THE PANELS SIT ON THE ROOF? — ASKED OF THE RUNNING APPLICATION.
 *
 * Ray's second production failure was "Auto Layout generated panels visually
 * intersect / disappear into the roof surface". Everything that guarded it
 * measured the wrong thing:
 *
 *   - `tests/panelSurfaceClearance.test.ts` asserts the elevation invariant, but
 *     against the placement LIBRARY. It cannot see the React state, the control
 *     layer, the mounting-system prop, or the 3D engine.
 *   - `e2e/design-studio.spec.ts` drives the real app, but only checked
 *     point-in-POLYGON — a horizontal test, satisfied perfectly by an array
 *     buried a storey underground — and it checked even that conditionally, so
 *     on a machine with no Google key it reported a pass over an empty array.
 *
 * So nothing anywhere asserted a panel's HEIGHT in the running application.
 * This does, through the real Auto Layout button, in a real browser:
 *
 *     for every panel Auto Layout placed:
 *         (panelECEF − plane.origin3D) · plane.normal  ==  moduleStackHeightM(racking)
 *
 * A SIGNED distance along the plane normal, so it goes negative exactly when a
 * panel is inside the roof.
 *
 * 🚨 WHY THE ROOF IS SEEDED. The quick-launch project has no roof geometry, and
 * acquiring one needs Google Solar, which needs a key this machine may not have.
 * That is precisely how the old guard came to pass vacuously. `seedDesign` puts
 * a real `buildRoofPlane3D` output — origin3D, ecefFrame3D, polygon3D and all —
 * on the active property through the studio's own setter. Everything after that
 * is the real path: the Auto Layout handler, the 3D routing chokepoint, the
 * control layer, the placement engine, and the mounting system the studio has
 * selected.
 *
 * 🚨 NO DATABASE. This writes nothing and reads nothing from Postgres.
 */

const DEMO = { lat: 38.6657, lng: -90.2266 };        // app/design/page.tsx quick-launch
const DEFAULT_RACKING = 'ironridge-xr100';           // DesignStudio's initial rackingId
const EXPECTED_CLEARANCE_M = moduleStackHeightM(DEFAULT_RACKING);

/** Same floor as the vitest layer: panels store lat/lng at 7 dp while height
 *  keeps full precision, so a reconstructed point can move ~0.7 cm horizontally,
 *  which tips into the normal as sin(tilt)·error. MEASURED, not chosen. */
const COPLANARITY_TOL_M = 1e-2;

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 111_320;
const TILT_DEG = 25;
const WIDTH_M = 14;   // along the eave
const DEPTH_M = 9;    // up the slope
const EAVE_H = 160;   // ellipsoidal

/** A real pitched roof face at the demo address, built by the same function the
 *  3D trace tool uses — so the seeded plane is not a hand-written approximation
 *  of one. */
function buildSeedPlane(): RoofPlane {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos(DEMO.lat * DEG);
  const dLng = WIDTH_M / 2 / mPerDegLng;
  const dLat = DEPTH_M / 2 / M_PER_DEG_LAT;
  const ridgeH = EAVE_H + DEPTH_M * Math.tan(TILT_DEG * DEG);
  return buildRoofPlane3D([
    latLngToECEF(DEMO.lat - dLat, DEMO.lng - dLng, EAVE_H),
    latLngToECEF(DEMO.lat - dLat, DEMO.lng + dLng, EAVE_H),
    latLngToECEF(DEMO.lat + dLat, DEMO.lng + dLng, ridgeH),
    latLngToECEF(DEMO.lat + dLat, DEMO.lng - dLng, ridgeH),
  ]);
}

type E2EPanel = {
  id: string; lat: number; lng: number; height?: number; planeId?: string;
};
type E2EPlane = {
  id: string;
  origin3D?: { x: number; y: number; z: number };
  ecefFrame3D?: { n: { x: number; y: number; z: number } };
};

/** Signed distance from a panel to its plane, along the plane normal. */
function clearanceM(panel: E2EPanel, plane: E2EPlane): number {
  const n = plane.ecefFrame3D!.n;
  const o = plane.origin3D!;
  const p = latLngToECEF(panel.lat, panel.lng, panel.height!);
  return (p.x - o.x) * n.x + (p.y - o.y) * n.y + (p.z - o.z) * n.z;
}

async function bootWithRoof(page: import('@playwright/test').Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(
    () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
    { message: 'NEXT_PUBLIC_E2E hook with seedDesign should be installed', timeout: 30_000 },
  ).toBe(true);

  const plane = buildSeedPlane();
  await page.evaluate(p => (window as any).__solarE2E.seedDesign({ roofPlanes: [p] }), plane as any);
  await page.waitForTimeout(500);

  // The seed must survive into studio state, or everything below is vacuous.
  const seeded = await page.evaluate(() => (window as any).__solarE2E.roofPlanes.length);
  expect(seeded, 'seedDesign did not put the roof plane on the active property').toBe(1);

  // And the 3D engine must have RECEIVED it before Auto Layout is pressed.
  // Clicking earlier sets the placement mode against an engine that has no
  // plane yet and silently places nothing — which is a timing artefact of the
  // harness, not a defect, and must not be allowed to look like one. The
  // entity count is the engine's own report that the plane is in the scene.
  await expect.poll(
    () => page.evaluate(() => (window as any).__solarE2E?.engineRoofPlaneCount ?? 0),
    { message: 'the 3D engine never received the seeded roof plane', timeout: 45_000 },
  ).toBeGreaterThan(0);

  return plane;
}

async function readPanels(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    panels: (window as any).__solarE2E.panels as E2EPanel[],
    roofPlanes: (window as any).__solarE2E.roofPlanes as E2EPlane[],
  }));
}

test.describe('panel elevation — the running application, not the library', () => {
  test('🚨 Auto Layout places every panel exactly one mount stack above the roof', async ({ page }) => {
    const seedPlane = await bootWithRoof(page);

    const canvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the 3D placement path cannot run at all.');

    const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
    await expect(autoLayout, 'the Auto Layout button should exist on /design').toBeVisible();
    await autoLayout.click();

    // Placement is async through the 3D engine; poll rather than sleep.
    await expect.poll(
      () => page.evaluate(() => (window as any).__solarE2E.panels.length),
      {
        message: 'Auto Layout placed no panels on a seeded roof plane — the elevation ' +
                 'invariant cannot run, and this test must not report a pass',
        timeout: 30_000,
      },
    ).toBeGreaterThan(0);

    const { panels, roofPlanes } = await readPanels(page);

    // Resolve each panel's plane from the app's own state where it names one,
    // and fall back to the seeded plane (the only one that exists).
    const planeById = new Map(roofPlanes.map(p => [p.id, p]));
    const withFrames = panels.filter(p => Number.isFinite(p.height));
    expect(withFrames.length,
      'every placed panel should carry an elevation — a panel with no height is the defect',
    ).toBe(panels.length);

    let worst = { dev: 0, clearance: EXPECTED_CLEARANCE_M, id: '' };
    for (const panel of withFrames) {
      const plane = (panel.planeId && planeById.get(panel.planeId)) || (seedPlane as unknown as E2EPlane);
      if (!plane.origin3D || !plane.ecefFrame3D) continue;
      const c = clearanceM(panel, plane);
      const dev = Math.abs(c - EXPECTED_CLEARANCE_M);
      if (dev > worst.dev) worst = { dev, clearance: c, id: panel.id };
    }

    expect(worst.dev,
      `panel ${worst.id} sits ${worst.clearance.toFixed(4)} m above its roof plane; ` +
      `every panel must sit ${EXPECTED_CLEARANCE_M} m above it (${DEFAULT_RACKING}). ` +
      'Negative means the panel is INSIDE the roof — Ray\'s "panels disappear into the surface".',
    ).toBeLessThan(COPLANARITY_TOL_M);
  });

  test('🚨 A GABLE — every panel on BOTH faces sits one mount stack above ITS OWN plane', async ({ page }) => {
    // Ray: "the panels are not ALL rendering above the roof when I do an auto
    // layout to fill the roof". Every elevation assertion before this one used a
    // SINGLE face, which cannot show a per-plane defect — and "fill the roof"
    // means more than one face on any real house.
    await page.goto('/design?e2eQuickDesign=1');
    await expect.poll(
      () => page.evaluate(() => Boolean((window as any).__solarE2E?.seedDesign)),
      { message: 'NEXT_PUBLIC_E2E hook with seedDesign should be installed', timeout: 30_000 },
    ).toBe(true);
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the 3D placement path cannot run at all.');

    const planes = await seedPlanes(page, buildGablePlanes());
    await runAutoLayout(page);

    const { panels, roofPlanes } = await readPanels(page);
    expect(panels.length, 'Auto Layout should fill both faces').toBeGreaterThan(0);

    const byId = new Map<string, E2EPlane>(
      [...roofPlanes, ...(planes as unknown as E2EPlane[])].map(p => [p.id, p]),
    );

    // 🚨 EVERY PANEL MUST NAME THE FACE IT IS ON. Without a planeId there is no
    // plane to measure against, and a panel that cannot be measured is exactly
    // the one that would be drawn in the wrong place unnoticed.
    const orphans = panels.filter(p => !p.planeId || !byId.get(p.planeId)?.origin3D);
    expect(orphans.map(p => p.id),
      'every placed panel should belong to a roof plane that carries a 3D frame',
    ).toEqual([]);

    // And both faces should actually have been filled — one face covered twice
    // would satisfy a naive "all panels are on a plane" check.
    const perPlane = new Map<string, number>();
    for (const p of panels) perPlane.set(p.planeId!, (perPlane.get(p.planeId!) ?? 0) + 1);
    expect([...perPlane.keys()].length, 'both faces of the gable should be filled').toBe(2);

    const bad: string[] = [];
    for (const panel of panels) {
      const plane = byId.get(panel.planeId!)!;
      const c = clearanceM(panel, plane);
      if (Math.abs(c - EXPECTED_CLEARANCE_M) > COPLANARITY_TOL_M) {
        bad.push(`${panel.id} on ${panel.planeId!.slice(0, 8)}: ${c.toFixed(4)} m`);
      }
    }
    expect(bad,
      `every panel must sit ${EXPECTED_CLEARANCE_M} m above its own face. ` +
      `A negative clearance means the panel is INSIDE the roof. ` +
      `${bad.length} of ${panels.length} are wrong: ${bad.slice(0, 8).join('; ')}`,
    ).toEqual([]);
  });

  test('🚨 a second Auto Layout does not lift the array — placement is idempotent', async ({ page }) => {
    // The ratchet: a plane rebuilt from a module and then treated as the deck
    // raised every subsequent panel by one stack height, and the next rebuild
    // measured from the raised one. Running the same layout twice is the
    // cheapest way to ask the running app whether any such loop survives.
    const seedPlane = await bootWithRoof(page);

    const canvas = page.locator('canvas').first();
    const hasCanvas = await waitForCesiumCanvas(page);
    test.skip(!hasCanvas, 'No WebGL canvas — the 3D placement path cannot run at all.');

    const autoLayout = page.getByRole('button', { name: /^auto layout$/i }).first();
    await expect(autoLayout).toBeVisible();
    await autoLayout.click();
    await expect.poll(() => page.evaluate(() => (window as any).__solarE2E.panels.length), {
      message: 'first Auto Layout placed nothing', timeout: 30_000,
    }).toBeGreaterThan(0);
    const first = await readPanels(page);

    await autoLayout.click();
    await page.waitForTimeout(3_000);
    const second = await readPanels(page);

    expect(second.panels.length, 'the second layout should produce the same array')
      .toBe(first.panels.length);

    const planeById = new Map(second.roofPlanes.map(p => [p.id, p]));
    for (const panel of second.panels) {
      const plane = (panel.planeId && planeById.get(panel.planeId)) || (seedPlane as unknown as E2EPlane);
      if (!plane.origin3D || !plane.ecefFrame3D) continue;
      const c = clearanceM(panel, plane);
      expect(Math.abs(c - EXPECTED_CLEARANCE_M),
        `after a second Auto Layout, panel ${panel.id} sits ${c.toFixed(4)} m above the roof ` +
        `instead of ${EXPECTED_CLEARANCE_M} m — the array drifted`,
      ).toBeLessThan(COPLANARITY_TOL_M);
    }
  });
});
