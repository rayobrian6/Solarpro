/**
 * e2e/chimney-clears-the-array.spec.ts
 *
 * MARK A CHIMNEY ON A FINISHED ARRAY AND THE MODULES OVER IT MUST GO.
 *
 * 🚨 THEY DID NOT. The placement path asked whether a panel's CENTRE sat inside
 * the chimney's bare footprint — a 0.54 m² target for a 0.9 x 0.6 m chimney,
 * against the ~9.45 m² that a module plus its required 0.45 m clearance
 * actually occupies. So marking a chimney removed nought or one module where it
 * should have removed about four, and the array was built with panels lying
 * across the flue. The tool's own hint, one line above the click, reads
 * "Panels keep 0.45 m clear of it".
 *
 * The unit guard (tests/panelKeepOutIsTheOneFilter.test.ts) pins the arithmetic.
 * This proves the arithmetic is what the PRODUCT runs when a person clicks a
 * roof — which is the part that was wrong, since the correct implementation
 * already existed and simply was not the one being called.
 *
 * The decisive assertion is not "some panels went". It is that EVERY SURVIVING
 * MODULE IS GENUINELY CLEAR: a centre test leaves survivors inside the
 * clearance, and measuring the closest survivor is what tells the two
 * implementations apart.
 */

import { test, expect, Page } from '@playwright/test';
import { buildSectionRoofPlanes } from '../lib/3d/buildingSection';
import { multiSectionHouse } from '../tests/fixtures/multiSectionHouse';
import { DEFAULT_CLEARANCE_M } from '../lib/3d/panelKeepOut';

type E2EWin = Window & { __solarE2E?: any; __solarViewerE2E?: any; __solarEngineE2E?: any };

const SITE = { lat: 38.70615, lng: -90.04625, address: '3 Melvin Dr, Granite City, IL' };
const T = 60_000;
const M_PER_DEG_LAT = 111_132;

async function openStudio(page: Page) {
  await page.goto('/design?e2eQuickDesign=1');
  await expect.poll(() => page.evaluate(() => Boolean((window as E2EWin).__solarE2E?.seedDesign)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => !!(window as E2EWin).__solarViewerE2E), { timeout: 90_000 }).toBe(true);
}

const objects = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.placedObstructions ?? []) as any[]);
const panels = (p: Page) =>
  p.evaluate(() => ((window as E2EWin).__solarE2E?.panels ?? []) as any[]);

/** Seed the house and a DENSE grid of modules across the first face. */
async function seedHouseAndArray(page: Page) {
  await page.evaluate(a => (window as E2EWin).__solarE2E.pickHouse(a.lat, a.lng, a.address), SITE);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.activeSiteKey ?? ''), { timeout: 45_000 })
    .not.toBe('');

  const planes: any[] = [];
  for (const s of multiSectionHouse()) {
    const built = buildSectionRoofPlanes(s);
    if (!built.ok) throw new Error(`fixture refused: ${JSON.stringify(built.refusals)}`);
    planes.push(...built.planes);
  }

  const face = planes[0];
  const grid = await page.evaluate((f: any) => {
    const C = (window as any).Cesium;
    const pts = ((f.polygon3D ?? []) as any[]).map(v => {
      const c = C.Cartographic.fromCartesian(v);
      return { lat: C.Math.toDegrees(c.latitude), lng: C.Math.toDegrees(c.longitude), h: c.height };
    });
    const out: any[] = [];
    // 6 x 5 across the face — dense enough that a chimney at the centroid has
    // real neighbours inside its clearance.
    for (let r = 0; r < 6; r++) {
      for (let c2 = 0; c2 < 5; c2++) {
        const u = (r + 0.5) / 6, v = (c2 + 0.5) / 5;
        const top = { lat: pts[0].lat + (pts[1].lat - pts[0].lat) * u, lng: pts[0].lng + (pts[1].lng - pts[0].lng) * u, h: pts[0].h + (pts[1].h - pts[0].h) * u };
        const bot = { lat: pts[3].lat + (pts[2].lat - pts[3].lat) * u, lng: pts[3].lng + (pts[2].lng - pts[3].lng) * u, h: pts[3].h + (pts[2].h - pts[3].h) * u };
        out.push({
          id: `p-${r}-${c2}`,
          lat: top.lat + (bot.lat - top.lat) * v,
          lng: top.lng + (bot.lng - top.lng) * v,
          height: top.h + (bot.h - top.h) * v,
          planeId: f.id, tilt: f.pitch ?? 20, azimuth: f.azimuth ?? 180,
          row: 0, col: r * 5 + c2, wattage: 400,
          widthM: 1.13, heightM: 1.72,
        });
      }
    }
    return out;
  }, face as any);

  await page.evaluate(d => (window as E2EWin).__solarE2E.seedDesign(d), { roofPlanes: planes, panels: grid } as any);
  await expect.poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.engineRoofPlaneCount ?? 0), { timeout: T })
    .toBe(planes.length);
  return { planes, face, grid };
}

/**
 * Aim the camera at the roof and WAIT UNTIL IT ARRIVED.
 *
 * 🚨 AIMING IS NOT ARRIVING, and skipping this is why the first version of this
 * spec reported "clicking the roof with Chimney armed placed nothing" — which
 * reads exactly like the tool being unwired. Cesium keeps re-aiming as tiles
 * load, so a face can still project outside the canvas after the flight is
 * requested, and every click then lands on the sidebar.
 */
async function frame(page: Page) {
  const collect = `
    const viewer = window.__solarViewerE2E;
    const C = window.Cesium;
    const now = C.JulianDate.now();
    const pts = [];
    for (const ent of viewer.entities.values) {
      if (!String(ent?.name ?? '').startsWith('[PLANE3D-')) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }`;

  for (let i = 0; i < 8; i++) {
    const ok = await page.evaluate(new Function(`${collect}
      if (pts.length < 3) return false;
      const sphere = C.BoundingSphere.fromPoints(pts);
      try { viewer.camera.cancelFlight(); } catch {}
      viewer.camera.viewBoundingSphere(
        sphere, new C.HeadingPitchRange(0, C.Math.toRadians(-89), Math.max(70, sphere.radius * 7)));
      viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
      viewer.scene.requestRender();
      return true;`) as any);

    if (ok) {
      await page.waitForTimeout(900);
      const inside = await page.evaluate(new Function(`${collect}
        if (!pts.length) return false;
        const sphere = C.BoundingSphere.fromPoints(pts);
        const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
        const w = fn(viewer.scene, sphere.center);
        const cv = viewer.scene.canvas;
        return !!(w && isFinite(w.x) && isFinite(w.y)
          && w.x > 8 && w.y > 8 && w.x < cv.clientWidth - 8 && w.y < cv.clientHeight - 8);`) as any);
      if (inside) return;
    }
    await page.waitForTimeout(400);
  }
}

/** Project a roof face's centroid to canvas coordinates. */
async function faceCentreOnScreen(page: Page, faceId: string) {
  return page.evaluate((id: string) => {
    const viewer = (window as E2EWin).__solarViewerE2E;
    const C = (window as any).Cesium;
    const now = C.JulianDate.now();
    const pts: any[] = [];
    for (const ent of viewer.entities.values) {
      const nm = String(ent?.name ?? '');
      if (!nm.startsWith('[PLANE3D-') || !nm.endsWith(` ${id}`)) continue;
      const poly = ent.polygon?.hierarchy?.getValue?.(now);
      if (poly?.positions?.length) pts.push(...poly.positions);
      // The face is drawn as an OUTLINE, i.e. a polyline — reading only
      // `polygon` finds nothing and reports "the roof never projected".
      const line = ent.polyline?.positions?.getValue?.(now);
      if (line?.length) pts.push(...line);
    }
    if (pts.length < 3) return null;
    const c = pts.reduce((a: any, p: any) => ({
      x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length,
    }), { x: 0, y: 0, z: 0 });
    const fn = C.SceneTransforms.worldToWindowCoordinates ?? C.SceneTransforms.wgs84ToWindowCoordinates;
    const w = fn(viewer.scene, new C.Cartesian3(c.x, c.y, c.z));
    return w && isFinite(w.x) ? { x: w.x, y: w.y } : null;
  }, faceId);
}

/** Ground distance in metres between two lat/lng points. */
function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  return {
    dx: Math.abs((b.lng - a.lng) * M_PER_DEG_LAT * cosLat),
    dy: Math.abs((b.lat - a.lat) * M_PER_DEG_LAT),
  };
}

test.describe('a chimney takes the modules over it', () => {
  test('🚨 every surviving module is genuinely clear of the flue', async ({ page }) => {
    await openStudio(page);
    const { face, grid } = await seedHouseAndArray(page);
    await expect.poll(() => panels(page).then(p => p.length), { timeout: T }).toBe(grid.length);

    await frame(page);

    // Arm Chimney and drop it in the middle of the array.
    await page.getByTestId('toolgroup-tools').waitFor({ timeout: 120_000 });
    await page.locator('body').press('o');
    await expect
      .poll(() => page.evaluate(() => (window as E2EWin).__solarE2E?.placementMode ?? ''), { timeout: T })
      .toBe('obstruction');
    const chip = page.locator('[data-testid="obstruction-preset-chimney"]');
    await expect(chip).toBeVisible({ timeout: T });
    await chip.click();
    await page.waitForTimeout(400);

    const pt = await faceCentreOnScreen(page, face.id);
    expect(pt, 'the roof face never projected into the canvas').toBeTruthy();

    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.click(box.x + pt!.x, box.y + pt!.y);

    await expect.poll(() => objects(page).then(o => o.length), {
      message: 'clicking the roof with Chimney armed placed nothing', timeout: T,
    }).toBe(1);

    const [chimney] = await objects(page);
    expect(chimney.type).toBe('chimney');
    expect(chimney.planeId, 'the chimney did not bind to the face it was dropped on')
      .toBe(face.id);

    const after = await panels(page);
    const removed = grid.length - after.length;

    // 🚨 SOMETHING MUST GO. A chimney dropped into the middle of a 30-module
    // grid that removes nothing is the centre test's answer.
    expect(removed,
      `the chimney removed ${removed} of ${grid.length} modules — the centre-point test is back`)
      .toBeGreaterThan(0);
    expect(after.length, 'the keep-out swallowed the whole array').toBeGreaterThan(0);

    // 🚨 AND NOTHING THAT SHOULD HAVE GONE MAY REMAIN. This is the assertion
    // that separates the two implementations: a centre test leaves survivors
    // standing inside the clearance, which is a module mounted over a flue.
    const clearance = DEFAULT_CLEARANCE_M.chimney;
    const halfX = chimney.widthM / 2 + clearance + 1.13 / 2;
    const halfY = chimney.depthM / 2 + clearance + 1.72 / 2;

    const offenders = after.filter(p => {
      const d = metresApart(chimney, p);
      return d.dx < halfX - 0.01 && d.dy < halfY - 0.01;
    });

    expect(offenders.length,
      `${offenders.length} module(s) survived inside the chimney's ${clearance} m clearance: ` +
      offenders.map(o => o.id).join(', '))
      .toBe(0);

    console.log('[KEEP-OUT]', JSON.stringify({
      placed: grid.length, removed, survivors: after.length,
      exclusionHalfExtentsM: { x: +halfX.toFixed(3), y: +halfY.toFixed(3) },
    }));
  });

  test('a tree on the ground still removes nothing — it shades, it does not occupy', async ({ page }) => {
    // 🚨 THE BEHAVIOUR THE SWAP MUST NOT CHANGE. Dropping a 6 m tree near the
    // house once deleted every module within 3 m of it, unrecoverably, while
    // the tool promised it would only shade. Both keep-out implementations
    // return early on a site object; this proves the one now in use still does,
    // on the real placement path rather than in a unit fixture.
    await openStudio(page);
    const { grid } = await seedHouseAndArray(page);
    await expect.poll(() => panels(page).then(p => p.length), { timeout: T }).toBe(grid.length);

    await page.getByTestId('toolgroup-tools').waitFor({ timeout: 120_000 });
    await page.locator('body').press('t');
    await expect(page.getByTestId('active-mode-banner')).toHaveAttribute('data-mode', 'tree');

    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('no canvas');
    await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);

    await expect.poll(() => objects(page).then(o => o.length), { timeout: T }).toBe(1);
    expect((await panels(page)).length,
      'a tree removed modules — shaded production is a derate, not a no-build')
      .toBe(grid.length);
  });
});
